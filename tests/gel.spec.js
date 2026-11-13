// @ts-check
// Gel / blot lane and band densitometry.
//
// Every gel here is synthesised in the page with a known truth: lanes at known columns,
// bands with a Gaussian row profile of known amplitude and width across a rectangular
// lane, so a band's integrated volume is amp × laneWidth × σ√(2π) and bands that share
// a σ have volumes in exactly the ratio of their amplitudes. The pixel values go
// through a lossless PNG (and, for the 16-bit case, an attached im.raw), and the
// analysis has to recover the truth from them.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// The generator. `spec.lanes` are in crop-frame coordinates (local to the crop); with a
// tilted crop every source pixel is mapped into the frame by _cropGeomOf, so the gel is
// upright in the frame and tilted in the file. `bgExpr` adds to the background (a ramp,
// a scratch: an expression in x, y, W, H); `clip` and `floor` clip the samples.
const GEN = () => {
  window.__gelMake = (spec) => {
    const W = spec.w, H = spec.h;
    const geom = spec.crop ? _cropGeomOf(W, H, spec.crop.l, spec.crop.t, spec.crop.r, spec.crop.b, spec.crop.ang) : null;
    let seed = spec.seed || 11;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const model = (x, y) => {
      let s = 0;
      for (const L of spec.lanes) if (x >= L.x0 && x < L.x1)
        for (const b of (L.bands || [])) s += b.amp * Math.exp(-((y - b.y) ** 2) / (2 * b.s * b.s));
      return s;
    };
    const full = spec.raw ? 65535 : 255;
    const clip = spec.clip != null ? spec.clip : full, floor = spec.floor || 0;
    const bgf = spec.bgExpr ? new Function('x', 'y', 'W', 'H', 'return ' + spec.bgExpr) : null;
    const vals = new Float64Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let x = i + 0.5, y = j + 0.5;
      if (geom) { const f = geom.toFrame(x, y); x = f[0] - geom.sx; y = f[1] - geom.sy; }
      const sg = model(x, y), n = spec.noise ? (rnd() - 0.5) * 2 * spec.noise : 0;
      const bg = spec.bg + (bgf ? bgf(x, y, W, H) : 0);
      const v = spec.pol === 'dark' ? bg - sg + n : bg + sg + n;
      vals[j * W + i] = Math.max(floor, Math.min(clip, Math.round(v)));
    }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let k = 0; k < W * H; k++) {
      const g = spec.raw ? Math.round(vals[k] / full * 255) : vals[k];
      id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = g; id.data[k * 4 + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const src = c.toDataURL('image/png');
    let raw = null;
    if (spec.raw) {
      const d = Uint16Array.from(vals); let mn = Infinity, mx = -Infinity;
      for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
      raw = { data: d, w: W, h: H, bps: 16, spp: 1, min: mn, max: mx, format: 1, full: 65535 };
    }
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        _commitImage(img, src, spec.name || 'gel.png', null, null, raw);
        const im = images[images.length - 1];
        if (spec.crop) { im.cropL = spec.crop.l; im.cropT = spec.crop.t; im.cropR = spec.crop.r; im.cropB = spec.crop.b; im.cropAngle = spec.crop.ang; }
        render(); res(images.length - 1);
      };
      img.onerror = rej; img.src = src;
    });
  };
};

// A six-lane blot. Lanes 1–3: a dose series at y=100 (1:2:4) plus a common band at
// y=200 twice lane 1's first; lane 4 empty; lane 5's top band saturates; lane 6 one band.
const PITCH = 90, LW = 50, X0 = 30;
const laneAt = k => ({ x0: X0 + PITCH * k, x1: X0 + PITCH * k + LW });
function blotSpec(pol, bg, amps, satAmp, extra) {
  const [a1, a2, a3] = amps;
  return Object.assign({
    w: 600, h: 300, pol, bg, noise: 3, name: 'blot.png',
    lanes: [
      { ...laneAt(0), bands: [{ y: 100, s: 3, amp: a1 }, { y: 200, s: 3, amp: 2 * a1 }] },
      { ...laneAt(1), bands: [{ y: 100, s: 3, amp: a2 }, { y: 200, s: 3, amp: 2 * a1 }] },
      { ...laneAt(2), bands: [{ y: 100, s: 3, amp: a3 }, { y: 200, s: 3, amp: 2 * a1 }] },
      { ...laneAt(3), bands: [] },
      { ...laneAt(4), bands: [{ y: 100, s: 3, amp: satAmp }, { y: 200, s: 3, amp: 2 * a1 }] },
      { ...laneAt(5), bands: [{ y: 150, s: 3, amp: 2 * a1 }] },
    ],
  }, extra || {});
}
const TRUE_CENTRES = [0, 1, 2, 3, 4, 5].map(k => X0 + PITCH * k + LW / 2);

async function setup(page) {
  const errors = await loadApp(page);
  await page.evaluate(GEN);
  return errors;
}
const make = (page, spec) => page.evaluate(s => window.__gelMake(s), spec);

// A compact read of an analysis for assertions.
const SUMMARY = `window.__sum = (a) => ({
  source: a.source, sourceLabel: a.sourceLabel, polarity: a.polarity, guess: a.polarityGuess, setBy: a.polaritySetBy,
  clipHi: a.clipHi, clipLo: a.clipLo,
  lanes: a.lanes.map(L => ({ c: (L.x0 + L.x1) / 2, x0: L.x0, x1: L.x1, inferred: L.inferred,
    bands: L.bands.map(b => ({ yc: b.yc, y0: b.y0, y1: b.y1, v: b.volume, sat: b.saturated })) })) });`;

function checkBlot(s, expectPol) {
  expect(s.polarity).toBe(expectPol);
  expect(s.guess).toBe(expectPol);
  expect(s.lanes.length).toBe(6);
  s.lanes.forEach((L, k) => expect(Math.abs(L.c - TRUE_CENTRES[k])).toBeLessThanOrEqual(2));
  expect(s.lanes.map(L => L.bands.length)).toEqual([2, 2, 2, 0, 2, 1]);
  const top = k => s.lanes[k].bands.find(b => Math.abs(b.yc - 100) < 4);
  const low = k => s.lanes[k].bands.find(b => Math.abs(b.yc - 200) < 4);
  // the dose series, across lanes
  expect(top(1).v / top(0).v).toBeGreaterThan(2 * 0.9); expect(top(1).v / top(0).v).toBeLessThan(2 * 1.1);
  expect(top(2).v / top(0).v).toBeGreaterThan(4 * 0.9); expect(top(2).v / top(0).v).toBeLessThan(4 * 1.1);
  // and within one lane
  expect(low(0).v / top(0).v).toBeGreaterThan(2 * 0.9); expect(low(0).v / top(0).v).toBeLessThan(2 * 1.1);
  // saturation flagged on exactly the one clipped band
  const sat = [];
  s.lanes.forEach((L, li) => L.bands.forEach(b => { if (b.sat) sat.push([li, Math.round(b.yc)]); }));
  expect(sat.length).toBe(1);
  expect(sat[0][0]).toBe(4);
  expect(Math.abs(sat[0][1] - 100)).toBeLessThan(4);
  // the empty lane is found (inferred from the pitch) and has no bands
  expect(s.lanes[3].inferred).toBe(true);
  expect(s.lanes[3].bands.length).toBe(0);
  expect(s.lanes.filter(L => L.inferred).length).toBe(1);
}

test('dark-on-light blot: lanes, 1:2:4 volumes, one saturated band, the empty lane, polarity', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  await page.evaluate(SUMMARY);
  const r = await page.evaluate(() => {
    const auto = _gelAnalyse(images[0]);
    const forced = _gelAnalyse(images[0], { laneCount: 6 });
    return { auto: __sum(auto), forced: __sum(forced) };
  });
  expect(r.auto.source).toBe('8bit');
  expect(r.auto.sourceLabel).toBe('8-bit image pixels');
  expect(r.auto.clipLo).toBe(0);           // dark bands saturate toward zero
  expect(r.auto.setBy).toBe('image');
  checkBlot(r.auto, 'dark');
  // a forced lane count fits six evenly pitched lanes; the empty one keeps its place
  expect(r.forced.lanes.length).toBe(6);
  r.forced.lanes.forEach((L, k) => expect(Math.abs(L.c - TRUE_CENTRES[k])).toBeLessThanOrEqual(2));
  expect(r.forced.lanes[3].bands.length).toBe(0);
  expect(r.forced.lanes.map(L => L.bands.length)).toEqual([2, 2, 2, 0, 2, 1]);
  expect(errors).toEqual([]);
});

test('light-on-dark fluorescent gel: polarity guessed light, saturation at 255', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('light', 20, [30, 60, 120], 320));
  await page.evaluate(SUMMARY);
  const s = await page.evaluate(() => __sum(_gelAnalyse(images[0])));
  expect(s.clipHi).toBe(255);
  checkBlot(s, 'light');
  // Polarity comes from the samples, not the display flag: inverting the display
  // must not flip the guess.
  const inv = await page.evaluate(() => { images[0].invert = true; return _gelAnalyse(images[0]).polarityGuess; });
  expect(inv).toBe('light');
  expect(errors).toEqual([]);
});

test('16-bit raw: native samples are measured, recorded as such, and clip at the ceiling', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('light', 1000, [4000, 8000, 16000], 90000, { raw: true, noise: 40, name: 'gel16.tif' }));
  await page.evaluate(SUMMARY);
  const s = await page.evaluate(() => __sum(_gelAnalyse(images[0])));
  expect(s.source).toBe('raw');
  expect(s.sourceLabel).toBe('16-bit source samples');
  expect(s.clipHi).toBe(65535);
  checkBlot(s, 'light');
  // Absolute volume in source units: amp × lane width × σ√(2π), less the ~3% beyond
  // the 10% band edges. The 8-bit display would give ~1/257 of this.
  const top0 = s.lanes[0].bands.find(b => Math.abs(b.yc - 100) < 4).v;
  const truth = 4000 * LW * 3 * Math.sqrt(2 * Math.PI);
  expect(top0 / truth).toBeGreaterThan(0.9);
  expect(top0 / truth).toBeLessThan(1.03);

  // 12-bit data in a 16-bit file clips at 4095, not 65535.
  const r12 = await page.evaluate(async () => {
    await window.__gelMake({ w: 300, h: 200, pol: 'light', bg: 200, raw: true, clip: 4095, noise: 10, name: 'g12.tif',
      lanes: [{ x0: 40, x1: 90, bands: [{ y: 80, s: 3, amp: 6000 }] }, { x0: 130, x1: 180, bands: [{ y: 80, s: 3, amp: 1500 }] },
              { x0: 220, x1: 270, bands: [{ y: 120, s: 3, amp: 1500 }] }] });
    const a = _gelAnalyse(images[1]);
    return { clipHi: a.clipHi, note: a.clipNote, sat: a.lanes.map(L => L.bands.map(b => b.saturated)) };
  });
  expect(r12.clipHi).toBe(4095);
  expect(r12.note).toMatch(/12-bit/);
  expect(r12.sat).toEqual([[true], [false], [false]]);

  // Float data has no ceiling of its own: none is invented, and the "none" survives JSON.
  const rf = await page.evaluate(async () => {
    const W = 200, H = 120, d = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++)
      d[j * W + i] = 0.1 + ((i >= 40 && i < 90) || (i >= 120 && i < 170) ? 2.5 * Math.exp(-((j + 0.5 - 60) ** 2) / 18) : 0) + (Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1) * 0.01;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const src = c.toDataURL('image/png');
    let mn = Infinity, mx = -Infinity; for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
    await new Promise(r => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'f.tif', null, null,
      { data: d, w: W, h: H, bps: 32, spp: 1, min: mn, max: mx, format: 3, full: mx }); r(); }; img.src = src; });
    const i = images.length - 1; runGelAnalysis(i);
    const a = JSON.parse(JSON.stringify(images[i].gelAnalysis));
    return { label: a.sourceLabel, hi: a.clipHi, lo: a.clipLo, lanes: a.lanes.length };
  });
  expect(rf.label).toBe('32-bit float source samples');
  expect(rf.hi).toBeNull();
  expect(rf.lo).toBeNull();
  expect(rf.lanes).toBe(2);
  expect(errors).toEqual([]);
});

test('a tilted crop is measured in its straightened frame, by nearest neighbour', async ({ page }) => {
  const errors = await setup(page);
  const lanes = [0, 1, 2, 3, 4].map(k => ({ x0: 40 + 95 * k, x1: 40 + 95 * k + 55,
    bands: [{ y: 120, s: 3, amp: 25 * Math.pow(2, Math.min(k, 2)) }, { y: 230, s: 3, amp: 60 }] }));
  await make(page, { w: 640, h: 420, pol: 'light', bg: 25, noise: 3, lanes, crop: { l: 10, t: 10, r: 10, b: 10, ang: 7 } });
  const r = await page.evaluate(() => {
    const a = _gelAnalyse(images[0]);
    return { sx: a.frame.sx, sy: a.frame.sy, angle: a.frame.angle,
      lanes: a.lanes.map(L => ({ c: (L.x0 + L.x1) / 2, bands: L.bands.map(b => ({ y: b.yc - a.frame.sy, v: b.volume })) })) };
  });
  expect(r.angle).toBe(7);
  expect(r.lanes.length).toBe(5);
  r.lanes.forEach((L, k) => expect(Math.abs(L.c - (r.sx + 40 + 95 * k + 27.5))).toBeLessThanOrEqual(2));
  r.lanes.forEach(L => expect(L.bands.length).toBe(2));
  const top = k => r.lanes[k].bands.find(b => Math.abs(b.y - 120) < 4).v;
  expect(top(1) / top(0)).toBeGreaterThan(1.8); expect(top(1) / top(0)).toBeLessThan(2.2);
  expect(top(2) / top(0)).toBeGreaterThan(3.6); expect(top(2) / top(0)).toBeLessThan(4.4);
  r.lanes.forEach(L => expect(L.c).toBeGreaterThan(0));
  // Not vacuous: read without the angle, the same file's lanes smear across the tilt
  // (336 px tall at 7° is ~41 px of drift), so they come out wider than the tilted reading.
  const flat = await page.evaluate(() => { images[0].cropAngle = 0; const a = _gelAnalyse(images[0]);
    return a.lanes.map(L => L.x1 - L.x0); });
  const tilted = await page.evaluate(() => { images[0].cropAngle = 7; return _gelAnalyse(images[0]).lanes.map(L => L.x1 - L.x0); });
  // (detected spans run a few px generous: the edge is taken at 15% of the lane's height
  // on a lightly smoothed profile, so a lane never loses its own edge columns)
  tilted.forEach(w => expect(Math.abs(w - 55)).toBeLessThanOrEqual(6));
  expect(Math.min(...flat)).toBeGreaterThan(Math.max(...tilted) + 8);
  expect(errors).toEqual([]);
});

test('brightness, contrast, gamma, levels, invert and LUT change no measurement', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  const r = await page.evaluate(() => {
    const strip = a => JSON.stringify({ p: a.polarity, g: a.polarityGuess, l: a.lanes, s: a.sourceLabel });
    const before = strip(_gelAnalyse(images[0]));
    render();
    const map = _panelSourceMap(panelBounds[0], images[0]), ctx = document.getElementById('fig-canvas').getContext('2d');
    const at = [Math.round(map.dx + map.dw * 0.5), Math.round(map.dy + map.dh * 0.2)];
    const px0 = Array.from(ctx.getImageData(at[0], at[1], 1, 1).data);
    const im = images[0];
    Object.assign(im, { brightness: 1.7, contrast: 1.6, gamma: 0.55, invert: true, lut: 'fire', blackPt: 40, whitePt: 190, grayscale: true });
    render();
    const px1 = Array.from(ctx.getImageData(at[0], at[1], 1, 1).data);
    const after = strip(_gelAnalyse(images[0]));
    return { same: before === after, displayChanged: px0.join() !== px1.join() };
  });
  expect(r.displayChanged).toBe(true);     // the adjustments really did change the display
  expect(r.same).toBe(true);               // ...and not one number
  expect(errors).toEqual([]);
});

test('molecular weight: the ladder fit recovers known sizes, flags extrapolation, refuses 2 markers', async ({ page }) => {
  const errors = await setup(page);
  const H = 400, kd = [250, 130, 100, 70, 55, 35, 25];
  const yOf = m => H * (0.1 + 0.8 * (Math.log10(250) - Math.log10(m)) / (Math.log10(250) - Math.log10(25)));
  const lanes = [
    { x0: 30, x1: 80, bands: kd.map(m => ({ y: yOf(m), s: 2.5, amp: 70 })) },
    { x0: 120, x1: 170, bands: [{ y: yOf(60), s: 3, amp: 80 }, { y: yOf(40), s: 3, amp: 80 }] },
    { x0: 210, x1: 260, bands: [{ y: yOf(150), s: 3, amp: 80 }, { y: yOf(22), s: 3, amp: 80 }] },
  ];
  await make(page, { w: 300, h: H, pol: 'dark', bg: 225, noise: 3, lanes });
  const r = await page.evaluate(() => {
    runGelAnalysis(0);
    gelSetLadder(0, 0, '250,130,100,70,55,35,25');
    const a = images[0].gelAnalysis;
    const rows = _gelRows(a).filter(x => x.lane !== 1).map(x => ({ lane: x.lane, kda: x.kda, ex: x.extrapolated }));
    const two = gelMWFit([{ rf: 0.1, kda: 250 }, { rf: 0.5, kda: 50 }]);
    const ladderBands = a.lanes[0].bands.length;
    gelSetLadder(0, 0, '250,130');
    return { fit: a.ladder.fit, rows, two, ladderBands, err2: images[0].gelAnalysis.ladder.error, fit2: images[0].gelAnalysis.ladder.fit };
  });
  expect(r.ladderBands).toBe(7);
  expect(r.fit.r2).toBeGreaterThan(0.98);
  expect(r.fit.n).toBe(7);
  const want = { 2: [60, 40], 3: [150, 22] };
  for (const lane of [2, 3]) {
    const got = r.rows.filter(x => x.lane === lane).map(x => x.kda);
    want[lane].forEach((m, i) => expect(Math.abs(got[i] - m) / m).toBeLessThan(0.05));
  }
  expect(r.rows.filter(x => x.ex).map(x => x.lane)).toEqual([3]);   // only the 22 kDa band is off the ladder
  expect(r.two.error).toMatch(/At least 3 ladder markers/);
  expect(r.err2).toMatch(/At least 3 ladder markers/);
  expect(r.fit2).toBeNull();
  expect(errors).toEqual([]);
});

test('editing: one drag, one delete, one add, one polarity flip — each exactly one undo step', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  // A figure annotation behind the dialog must survive the dialog's Delete key.
  await page.evaluate(() => { annotations.push({ type: 'text', xf: 0.1, yf: 0.1, text: 'keep', fontSize: 12, color: '#000' }); selectedAnnotation = 0; });
  await page.evaluate(() => openGelAnalysis(0));
  await expect(page.locator('#gel-modal-bg')).toBeVisible();
  const base = await page.evaluate(() => ({ n: undoStack.length, x1: images[0].gelAnalysis.lanes[0].x1,
    v: images[0].gelAnalysis.lanes[0].bands[0].volume }));

  // 1. drag lane 1's right edge 8 canvas px to the left, with the real mouse
  const pt = await page.evaluate(() => {
    const cv = document.getElementById('gel-canvas'), r = cv.getBoundingClientRect(), a = images[0].gelAnalysis;
    const s = (r.width / cv.width) * _gelUI.k;
    return { x: r.left + (a.lanes[0].x1 - a.frame.sx) * s, y: r.top + r.height * 0.5, s };
  });
  await page.mouse.move(pt.x - 1, pt.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(pt.x - 1 - 2 * i, pt.y);
  await page.mouse.up();
  const d = await page.evaluate(() => ({ n: undoStack.length, x1: images[0].gelAnalysis.lanes[0].x1,
    v: images[0].gelAnalysis.lanes[0].bands[0].volume, edits: images[0].gelAnalysis.edits }));
  expect(d.n).toBe(base.n + 1);
  expect(d.x1).toBeLessThan(base.x1 - 3);
  expect(d.v).not.toBe(base.v);               // re-quantified over the narrower lane
  expect(d.v).toBeLessThan(base.v);
  expect(d.edits).toBe(1);
  await page.evaluate(() => { undo(); _gelRefresh(); });
  expect(await page.evaluate(() => images[0].gelAnalysis.lanes[0].x1)).toBe(base.x1);

  // 2. click a band, press Delete
  const bpt = await page.evaluate(() => {
    const cv = document.getElementById('gel-canvas'), r = cv.getBoundingClientRect(), a = images[0].gelAnalysis;
    const s = (r.width / cv.width) * _gelUI.k, L = a.lanes[1], b = L.bands[0];
    return { x: r.left + ((L.x0 + L.x1) / 2 - a.frame.sx) * s, y: r.top + (b.yc - a.frame.sy) * s, yc: b.yc, v: b.volume };
  });
  const n0 = await page.evaluate(() => undoStack.length);
  await page.mouse.click(bpt.x, bpt.y);
  expect(await page.evaluate(() => undoStack.length)).toBe(n0);           // selecting is not an edit
  await page.keyboard.press('Delete');
  const del = await page.evaluate(() => ({ n: undoStack.length, bands: images[0].gelAnalysis.lanes[1].bands.length, ann: annotations.length }));
  expect(del.n).toBe(n0 + 1);
  expect(del.bands).toBe(1);
  expect(del.ann).toBe(1);                                                 // the figure's annotation is untouched

  // 3. click the now-empty spot: the band comes back, measured the same way
  await page.mouse.click(bpt.x, bpt.y);
  const add = await page.evaluate(() => { const L = images[0].gelAnalysis.lanes[1];
    return { n: undoStack.length, bands: L.bands.map(b => ({ yc: b.yc, v: b.volume, manual: !!b.manual })) }; });
  expect(add.n).toBe(n0 + 2);
  expect(add.bands.length).toBe(2);
  const back = add.bands.find(b => b.manual);
  expect(Math.abs(back.yc - bpt.yc)).toBeLessThan(1.5);
  expect(Math.abs(back.v - bpt.v) / bpt.v).toBeLessThan(0.05);
  await page.evaluate(() => { undo(); _gelRefresh(); });
  expect(await page.evaluate(() => images[0].gelAnalysis.lanes[1].bands.length)).toBe(1);

  // 4. flipping the polarity re-detects, once
  const pol = await page.evaluate(() => { const n = undoStack.length; gelSetPolarity(0, 'light');
    const a = images[0].gelAnalysis; const out = { d: undoStack.length - n, pol: a.polarity, by: a.polaritySetBy };
    undo(); return { ...out, restored: images[0].gelAnalysis.polarity }; });
  expect(pol).toEqual({ d: 1, pol: 'light', by: 'user', restored: 'dark' });
  expect(errors).toEqual([]);
});

test('the analysis survives save and load, and undo snapshots do not share it', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  await page.evaluate(() => { runGelAnalysis(0); gelSetRefLane(0, 0); gelSetLadder(0, 5, '50'); });
  const r = await page.evaluate(async () => {
    const snap = snapshotState();
    const shared = snap.images[0].gelAnalysis === images[0].gelAnalysis;
    const before = JSON.stringify(images[0].gelAnalysis);
    const s = JSON.parse(JSON.stringify(serializeSession()));
    images = []; render();
    applySession(s, { silent: true });
    await new Promise(res => { const t = () => (images[0] && images[0].img && images[0].img.complete) ? res() : setTimeout(t, 20); t(); });
    return { shared, same: JSON.stringify(images[0].gelAnalysis) === before, fresh: _gelFresh(images[0]),
             ref: images[0].gelAnalysis.refLane };
  });
  expect(r.shared).toBe(false);
  expect(r.same).toBe(true);
  expect(r.fresh).toBe(true);
  expect(r.ref).toBe(0);
  expect(errors).toEqual([]);
});

test('a crop change makes the analysis stale: no Methods claim, a compliance warning', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  const r = await page.evaluate(() => {
    const none = generateMethodsParagraph();
    runGelAnalysis(0);
    const withA = generateMethodsParagraph();
    const row = () => { checkCompliance(); const t = [...document.querySelectorAll('#info-modal-bg .compliance-row')]
      .map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(x => /Densitometry/.test(x)) || '';
      const m = document.getElementById('info-modal-bg'); if (m) m.remove(); return t; };
    const png = row();
    images[0].name = 'blot.jpg'; const jpg = row();
    images[0].name = 'pasted image'; const unk = row();
    images[0].cropL = 5; render();
    const stale = row(), staleMethods = generateMethodsParagraph();
    return { none, withA, png, jpg, unk, stale, staleMethods };
  });
  expect(r.none).not.toMatch(/densitometry/i);
  expect(r.withA).toMatch(/Band densitometry of panel A/);
  expect(r.withA).toMatch(/8-bit image pixels/);
  expect(r.withA).toMatch(/rolling-minimum background \(window \d+ px\)/);
  expect(r.withA).toMatch(/1 band was saturated/);
  expect(r.withA).toMatch(/lane 4 being inferred from the lane pitch/);
  expect(r.withA).toMatch(/lanes were detected from the column intensity profile/);
  expect(r.png).toContain('⚠');
  expect(r.png).toMatch(/1 saturated band/);
  expect(r.jpg).toMatch(/lossy-compressed import/);
  expect(r.unk).toMatch(/cannot tell whether this image was ever lossy-compressed/);
  expect(r.stale).toMatch(/stale/);
  expect(r.staleMethods).not.toMatch(/densitometry/i);
  expect(errors).toEqual([]);
});

test('loading control: lanes paired by order, divided, named in the table and the Methods', async ({ page }) => {
  const errors = await setup(page);
  // target bands 40, 80, 80, 120; loading 1×, 2×, 1×, 1.5× → normalised 1 : 1 : 2 : 2
  const tgt = [40, 80, 80, 120], load = [30, 60, 30, 45];
  const mk = (amps, y) => ({ w: 400, h: 120, pol: 'dark', bg: 228, noise: 2,
    lanes: amps.map((a, k) => ({ x0: 30 + 90 * k, x1: 30 + 90 * k + 50, bands: [{ y, s: 3, amp: a }] })) });
  await make(page, { ...mk(tgt, 60), name: 'target.png' });
  await make(page, { ...mk(load, 60), name: 'actin.png' });
  const r = await page.evaluate(() => {
    runGelAnalysis(0); gelSetRefLane(0, 0); gelSetLoading(0, 1);
    const a = images[0].gelAnalysis, rows = _gelRows(a);
    return { lc: a.loading && a.loading.label, n: a.loading && a.loading.lanes.length,
      rel: rows.map(x => x.relRef), norm: rows.map(x => x.normLCRef), methods: generateMethodsParagraph(),
      banner: (openGelAnalysis(0), document.getElementById('gel-banner').textContent) };
  });
  expect(r.lc).toBe('B');
  expect(r.n).toBe(4);
  [1, 2, 2, 3].forEach((t, i) => expect(Math.abs(r.rel[i] - t) / t).toBeLessThan(0.1));
  [1, 1, 2, 2].forEach((t, i) => expect(Math.abs(r.norm[i] - t) / t).toBeLessThan(0.1));
  expect(r.methods).toMatch(/normalised to the loading control in panel B, lanes paired by order/);
  expect(r.methods).toMatch(/relative to lane 1/);
  expect(r.banner).toMatch(/loading control in panel B/);
  expect(errors).toEqual([]);
});

test('CSV: the header states the source pixels, polarity, background and saturation', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  const csv = await page.evaluate(() => { runGelAnalysis(0); return gelCSV(0); });
  const head = csv.split('\n').filter(l => l.startsWith('#')).join('\n');
  expect(head).toContain(`FigureLab v`);
  expect(head).toMatch(/# Source pixels: 8-bit image pixels.*before any brightness/);
  expect(head).toMatch(/# Polarity: dark bands on a light background \(guessed from the image/);
  expect(head).toMatch(/# Baseline: rolling minimum .*window \d+ px/);
  expect(head).toMatch(/# Saturated bands: 1 — clipped at 0/);
  const rows = csv.split('\n').filter(l => l && !l.startsWith('#'));
  const cols = rows[0].split(',');
  expect(cols).toContain('volume');
  expect(rows.slice(1).filter(l => /SATURATED/.test(l)).length).toBe(1);
  expect(rows.slice(1).every(l => l.split(',').length === cols.length)).toBe(true);
  // the empty lane still has its row
  expect(rows.slice(1).some(l => /^4,,/.test(l))).toBe(true);
  expect(errors).toEqual([]);
});

test('placed lane numbers sit on the detected lanes; MW labels on the ladder bands', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  const r = await page.evaluate(() => {
    runGelAnalysis(0); gelSetLadder(0, 0, '100,50');
    const n0 = annotations.length, u0 = undoStack.length;
    gelPlaceLaneNumbers(0);
    const lanesAdded = annotations.slice(n0), u1 = undoStack.length;
    const n1 = annotations.length;
    gelPlaceMWLabels(0);
    const mwAdded = annotations.slice(n1);
    render();
    const map = _panelSourceMap(panelBounds.find(p => p.idx === 0), images[0]);
    const W = annCanvas.width, H = annCanvas.height, a = images[0].gelAnalysis;
    const fx = u => map.dx + (u - map.sx) / map.kx, fy = v => map.dy + (v - map.sy) / map.ky;
    return {
      steps: [u1 - u0, undoStack.length - u1],
      lanes: lanesAdded.map((t, i) => { const L = a.lanes[i], tw = t.text.length * t.fontSize * 0.58;
        return { text: t.text, left: t.xf * W, right: t.xf * W + tw, lo: fx(L.x0), hi: fx(L.x1), top: t.yf * H, panelTop: map.dy }; }),
      mw: mwAdded.map((t, i) => { const b = a.lanes[0].bands.slice().sort((p, q) => p.yc - q.yc)[i];
        return { text: t.text, mid: t.yf * H + t.fontSize / 2, want: fy(b.yc), right: t.xf * W + t.text.length * t.fontSize * 0.58, panelLeft: fx(a.lanes[0].x0) }; }),
    };
  });
  expect(r.steps).toEqual([1, 1]);
  expect(r.lanes.map(l => l.text)).toEqual(['1', '2', '3', '4', '5', '6']);
  r.lanes.forEach(l => { expect(l.left).toBeGreaterThanOrEqual(l.lo); expect(l.right).toBeLessThanOrEqual(l.hi); });
  expect(r.mw.map(m => m.text)).toEqual(['100', '50']);
  r.mw.forEach(m => { expect(Math.abs(m.mid - m.want)).toBeLessThan(1.5); expect(m.right).toBeLessThanOrEqual(m.panelLeft); });
  expect(errors).toEqual([]);
});

test('refuses panels it cannot map exactly, and is reachable from the sidebar, drawer and palette', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  const r = await page.evaluate(() => {
    const im = images[0], out = {};
    const tryIt = (k, set, unset) => { set(); out[k] = { why: _gelRefusal(im), opened: openGelAnalysis(0), has: !!im.gelAnalysis }; unset(); };
    tryIt('composite', () => { im.channels = [{ name: 'c2', img: im.img, lut: 'green' }]; }, () => { im.channels = []; });
    tryIt('circle', () => { im.cropShape = 'circle'; }, () => { im.cropShape = 'rect'; });
    tryIt('rotated', () => { im.rotate = 90; }, () => { im.rotate = 0; });
    tryIt('mirrored', () => { im.flipH = true; }, () => { im.flipH = false; });
    out.sidebar = !!document.querySelector('button[onclick="openGelAnalysis()"][title]');
    renderImgList();
    out.drawer = !!document.querySelector('[data-gelanalyse="0"][title]');
    _cmdpRender('densitometry'); out.q1 = (_cmdpFiltered[0] || {}).label;
    _cmdpRender('kda'); out.q2 = (_cmdpFiltered[0] || {}).label;
    _cmdpRender('imagej gel analyzer'); out.q3 = (_cmdpFiltered[0] || {}).label;
    _cmdpRender('quantify western blot'); out.q4 = (_cmdpFiltered[0] || {}).label;
    return out;
  });
  for (const k of ['composite', 'circle', 'rotated', 'mirrored']) {
    expect(r[k].why).toBeTruthy();
    expect(r[k].opened).toBe(false);
    expect(r[k].has).toBe(false);
  }
  expect(r.composite.why).toMatch(/composite/);
  expect(r.circle.why).toMatch(/shaped crop/);
  expect(r.sidebar).toBe(true);
  expect(r.drawer).toBe(true);
  expect(r.q1).toMatch(/Analyse lanes & bands/);
  expect(r.q2).toMatch(/molecular weight|Analyse lanes/i);
  expect(r.q3).toMatch(/Analyse lanes & bands/);
  expect(r.q4).toMatch(/Analyse lanes & bands/);
  expect(errors).toEqual([]);
});

test('a short loading-control strip: the background window widens to fit the bands; a short one is warned', async ({ page }) => {
  const errors = await setup(page);
  // 70 px tall, bands ~17 rows: the H/6 default (13 px) would ride up every band.
  await make(page, { w: 400, h: 70, pol: 'dark', bg: 230, noise: 2, name: 'actin.png',
    lanes: [40, 80, 40, 80].map((amp, k) => ({ x0: 30 + 90 * k, x1: 30 + 90 * k + 50, bands: [{ y: 35, s: 4, amp }] })) });
  const r = await page.evaluate(() => {
    runGelAnalysis(0);
    const a = images[0].gelAnalysis, tall = _gelTallestBand(a);
    const auto = { win: a.baseline.window, from: a.baseline.widenedFrom, tall, short: _gelWindowShort(a),
      vols: a.lanes.map(L => L.bands.map(b => b.volume)) };
    runGelAnalysis(0, { window: 13 });
    const b = images[0].gelAnalysis;
    checkCompliance();
    const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(t => /Densitometry/.test(t)) || '';
    return { auto, userWin: b.baseline.window, userShort: _gelWindowShort(b), csv: gelCSV(0), row };
  });
  expect(r.auto.from).toBe(13);
  expect(r.auto.win).toBeGreaterThanOrEqual(2 * r.auto.tall);
  expect(r.auto.short).toBe(false);
  expect(r.auto.vols.map(v => v.length)).toEqual([1, 1, 1, 1]);
  r.auto.vols.forEach(v => expect(v[0]).toBeGreaterThan(0));
  const ratio = r.auto.vols[1][0] / r.auto.vols[0][0];
  expect(ratio).toBeGreaterThan(1.8); expect(ratio).toBeLessThan(2.2);
  expect(r.userWin).toBe(13);                 // a window the user typed is theirs
  expect(r.userShort).toBe(true);
  expect(r.csv).toMatch(/WARNING: the window is barely taller than the tallest band/);
  expect(r.row).toMatch(/barely taller than the bands/);
  expect(errors).toEqual([]);
});

// ── Hardening against an adversarial tester's gels (each with a known truth) ────────
// Six 50-px lanes at x = 30 + 90k on a 600-px crop; σ-3 bands; truth per band =
// amp × 50 × 3√(2π). A detected lane runs a few px generous (its edges are taken at 15%
// of the lane's height on a lightly smoothed profile), so centres are checked, not edges.
const SIX = (bands) => [0, 1, 2, 3, 4, 5].map(k => ({ ...laneAt(k), bands: typeof bands === 'function' ? bands(k) : bands }));
const TWO = [{ y: 100, s: 3, amp: 60 }, { y: 200, s: 3, amp: 60 }];
const VOL = (amp, s = 3, w = LW) => amp * w * s * Math.sqrt(2 * Math.PI);
// A band integrated to 10% of its peak holds ~97% of the Gaussian; allow -5%..+3%, or
// ±8% where the noise is a third of the band's height (it is, at amp 20 and ±6 noise).
const nearTruth = (v, t, tol) => { expect(v / t).toBeGreaterThan(tol ? 1 - tol : 0.95); expect(v / t).toBeLessThan(tol ? 1 + tol : 1.03); };
const centresOK = (lanes, n = 6) => {
  expect(lanes.length).toBe(n);
  lanes.forEach((L, k) => expect(Math.abs((L.x0 + L.x1) / 2 - TRUE_CENTRES[k])).toBeLessThanOrEqual(3));
};
const lanesOf = a => a.lanes.map(L => ({ x0: L.x0, x1: L.x1, inferred: L.inferred, end: !!L.end,
  bands: L.bands.map(b => ({ yc: b.yc, v: b.volume, sat: !!b.saturated, partial: !!b.partial, merged: !!b.merged })) }));

test('noisy blots: one lane per lane, never split, never one in a gap (GEL-01)', async ({ page }) => {
  const errors = await setup(page);
  // The tester's case (8 lanes found, lane 6 split) and the worst corners of their sweep.
  const cases = [{ h: 500, noise: 3, amp: 100, seed: 7 }, { h: 300, noise: 6, amp: 20, seed: 5 }, { h: 300, noise: 3, amp: 40, seed: 5 },
    { h: 500, noise: 6, amp: 40, seed: 5 }, { h: 120, noise: 6, amp: 20, seed: 5 }];
  for (const c of cases) {
    const r = await page.evaluate(async (c) => {
      images = [];
      await __gelMake({ w: 600, h: c.h, pol: 'dark', bg: 230, noise: c.noise, seed: c.seed, name: 'blot.png',
        lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: Math.round(c.h / 3), s: 3, amp: c.amp }] })) });
      const a = _gelAnalyse(images[0]);
      return a.lanes.map(L => ({ x0: L.x0, x1: L.x1, inferred: L.inferred, n: L.bands.length, v: L.bands.map(b => b.volume) }));
    }, c);
    centresOK(r);
    r.forEach(L => { expect(L.inferred).toBe(false); expect(L.n).toBe(1); nearTruth(L.v[0], VOL(c.amp), c.amp / c.noise <= 4 ? 0.08 : 0); });
  }
  // The toast after placing numbers says six, and they sit over the six real lanes.
  const t = await page.evaluate(async () => {
    images = [];
    await __gelMake({ w: 600, h: 500, pol: 'dark', bg: 230, noise: 3, seed: 7, name: 'blot.png',
      lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 166, s: 3, amp: 100 }] })) });
    runGelAnalysis(0);
    let msg = null; const t0 = window.toast; window.toast = m => { msg = m; }; gelPlaceLaneNumbers(0); window.toast = t0;
    return msg;
  });
  expect(t).toMatch(/^Placed 6 lane numbers/);
  expect(errors).toEqual([]);
});

test('an illumination ramp across the gel: six lanes, equal bands, auto and forced (GEL-02)', async ({ page }) => {
  const errors = await setup(page);
  for (const ramp of [60, 20]) {
    const r = await page.evaluate(async (ramp) => {
      images = [];
      // 200 → 260 clips at 255 over the last columns: a rise into the edge, not a lane.
      await __gelMake({ w: 600, h: 300, pol: 'dark', bg: ramp === 60 ? 200 : 220, noise: 1, name: 'ramp.png', bgExpr: `${ramp}*x/W`,
        lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: 60 }, { y: 200, s: 3, amp: 60 }] })) });
      const L = a => a.lanes.map(L => ({ x0: L.x0, x1: L.x1, inferred: L.inferred, v: L.bands.map(b => b.volume) }));
      const a = _gelAnalyse(images[0]);
      return { auto: L(a), forced: L(_gelAnalyse(images[0], { laneCount: 6 })), note: _gelLaneNote(a) };
    }, ramp);
    for (const k of ['auto', 'forced']) {
      centresOK(r[k]);
      r[k].forEach(L => { expect(L.v.length).toBe(2); L.v.forEach(v => nearTruth(v, VOL(60))); });
    }
    if (ramp === 60) expect(r.note).toMatch(/a rise into the crop edge at x 5\d\d–600 was not counted as a lane/);
  }
  expect(errors).toEqual([]);
});

test('empty lanes at either end are inferred from the pitch, and said to be (GEL-04)', async ({ page }) => {
  const errors = await setup(page);
  await make(page, { w: 600, h: 300, pol: 'dark', bg: 230, noise: 1, name: 'blot.png',
    lanes: SIX(k => (k === 0 || k === 5) ? [] : [{ y: 100, s: 3, amp: 40 + 20 * k }, { y: 200, s: 3, amp: 60 }]) });
  const r = await page.evaluate(() => {
    runGelAnalysis(0); gelSetRefLane(0, 1);
    const a = images[0].gelAnalysis;
    let t = null; const t0 = window.toast; window.toast = m => { t = m; }; gelPlaceLaneNumbers(0); window.toast = t0;
    openGelAnalysis(0); const banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' '); closeGelAnalysis();
    checkCompliance(); const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Densitometry/.test(x)) || '';
    return { lanes: a.lanes.map(L => ({ x0: L.x0, x1: L.x1, inferred: L.inferred, end: !!L.end, n: L.bands.length })),
      rel: _gelRows(a).filter(x => Math.abs(x.yc - 100) < 4).map(x => x.relRef), toast: t, banner, row,
      csv: gelCSV(0).split('\n').find(l => l.startsWith('# Lanes')), methods: generateMethodsParagraph() };
  });
  centresOK(r.lanes);
  expect(r.lanes.map(L => [L.inferred, L.end, L.n])).toEqual([[true, true, 0], [false, false, 2], [false, false, 2], [false, false, 2], [false, false, 2], [true, true, 0]]);
  // lane 2 is reported as lane 2, so the dose series reads 1 : 1.33 : 1.67 : 2 against it
  [1, 4 / 3, 5 / 3, 2].forEach((t, i) => expect(Math.abs(r.rel[i] - t) / t).toBeLessThan(0.05));
  expect(r.toast).toMatch(/lanes 1 and 6 inferred from the lane pitch/);
  expect(r.banner).toMatch(/Lanes at x: 1 2\d–8\d inferred/);
  expect(r.banner).toMatch(/inferred at the end of the gel/);
  expect(r.csv).toMatch(/1: 2\d–8\d \(inferred\)/);
  expect(r.csv).toMatch(/lanes 1 and 6 inferred at the end of the gel/);
  expect(r.methods).toMatch(/lanes 1 and 6 being inferred from the lane pitch/);
  expect(r.row).toMatch(/end lanes inferred from the lane pitch/);
  expect(errors).toEqual([]);
});

test('a crop that is one lane: auto refuses, Lanes = 1 measures the whole width (GEL-15, GEL-16)', async ({ page }) => {
  const errors = await setup(page);
  for (const W of [6, 20, 40, 80]) {
    const r = await page.evaluate(async (W) => {
      images = [];
      await __gelMake({ w: W, h: 200, pol: 'dark', bg: 230, noise: 1, name: 'strip.png', lanes: [{ x0: 0, x1: W, bands: [{ y: 60, s: 3, amp: 60 }, { y: 140, s: 3, amp: 30 }] }] });
      const toasts = []; const t0 = window.toast; window.toast = m => toasts.push(m);
      runGelAnalysis(0);
      const placed = gelPlaceLaneNumbers(0);
      window.toast = t0;
      const auto = { n: images[0].gelAnalysis.lanes.length, methods: generateMethodsParagraph(), csv: gelCSV(0) };
      checkCompliance(); auto.row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Densitometry/.test(x)) || '';
      document.getElementById('info-modal-bg')?.remove();
      runGelAnalysis(0, { laneCount: 1 });
      const a = images[0].gelAnalysis;
      return { auto, toasts, placed, one: { x0: a.lanes[0].x0, x1: a.lanes[0].x1, v: a.lanes[0].bands.map(b => b.volume) },
        oneMethods: generateMethodsParagraph() };
    }, W);
    expect(r.auto.n).toBe(0);
    expect(r.toasts[0]).toMatch(/No lanes found .* type 1 in Lanes/);
    expect(r.placed).toBe(false);
    expect(r.toasts[1]).toMatch(/nothing to number/);
    expect(r.auto.methods).not.toMatch(/densitometry/i);
    expect(r.auto.row).toMatch(/no lanes were found/);
    expect(r.auto.row).not.toMatch(/✓/);
    expect(r.auto.csv).toMatch(/# Lanes: NONE FOUND/);
    expect([r.one.x0, r.one.x1]).toEqual([0, W]);
    if (W >= 20) { expect(r.one.v.length).toBe(2); nearTruth(r.one.v[0], VOL(60, 3, W)); nearTruth(r.one.v[1], VOL(30, 3, W)); }
    expect(r.oneMethods).toMatch(/the whole crop width was measured as one lane/);
  }
  expect(errors).toEqual([]);
});

test('a thin vertical scratch is set aside, reported, and cannot set the pitch (GEL-18)', async ({ page }) => {
  const errors = await setup(page);
  for (const depth of [40, 15]) {
    const r = await page.evaluate(async (depth) => {
      images = [];
      await __gelMake({ w: 600, h: 300, pol: 'dark', bg: 230, noise: 1, name: 'scratch.png', bgExpr: `(x>=97&&x<103)?-${depth}:0`,
        lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: 60 }, { y: 200, s: 3, amp: 60 }] })) });
      const L = a => a.lanes.map(L => ({ x0: L.x0, x1: L.x1, inferred: L.inferred, v: L.bands.map(b => b.volume) }));
      const a = _gelAnalyse(images[0]);
      return { auto: L(a), forced: L(_gelAnalyse(images[0], { laneCount: 6 })), rejected: a.laneInfo.rejected, note: _gelLaneNote(a) };
    }, depth);
    for (const k of ['auto', 'forced']) {
      centresOK(r[k]);
      r[k].forEach(L => { expect(L.inferred).toBe(false); expect(L.v.length).toBe(2); L.v.forEach(v => nearTruth(v, VOL(60))); });
    }
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0].x0).toBeGreaterThanOrEqual(93); expect(r.rejected[0].x1).toBeLessThanOrEqual(107);
    expect(r.note).toMatch(/too narrow for a lane .* at x 9\d–10\d was not counted as a lane/);
  }
  expect(errors).toEqual([]);
});

test('doublets: resolved ones are split at the valley, unresolved ones flagged, and no volume is dropped (GEL-03)', async ({ page }) => {
  const errors = await setup(page);
  for (const sep of [7, 5, 3]) {
    const r = await page.evaluate(async (sep) => {
      images = [];
      await __gelMake({ w: 600, h: 300, pol: 'dark', bg: 230, noise: 1, name: 'doublet.png',
        lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k,
          bands: k === 2 ? [{ y: 100, s: 2, amp: 60 }, { y: 100 + sep, s: 2, amp: 30 }, { y: 200, s: 3, amp: 60 }] : [{ y: 100, s: 3, amp: 60 }, { y: 200, s: 3, amp: 60 }] })) });
      const a = _gelAnalyse(images[0]);
      return a.lanes[2].bands.filter(b => b.yc < 150).map(b => ({ yc: b.yc, v: b.volume, merged: !!b.merged, split: !!b.split }));
    }, sep);
    const total = r.reduce((s, b) => s + b.v, 0);
    nearTruth(total, VOL(60, 2) + VOL(30, 2));          // the minor band's volume is never lost
    if (sep === 7) {
      expect(r.length).toBe(2);
      expect(Math.abs(r[1].yc - 107)).toBeLessThan(1.5);
      // divided at the valley: each within 20% of its own truth (their flanks overlap)
      expect(Math.abs(r[0].v / VOL(60, 2) - 1)).toBeLessThan(0.2); expect(Math.abs(r[1].v / VOL(30, 2) - 1)).toBeLessThan(0.2);
      expect(r[0].split && r[1].split).toBe(true);
    }
    if (sep === 5) { expect(r.length).toBe(1); expect(r[0].merged).toBe(true); }
    if (sep === 3) expect(r.length).toBe(1);             // below the resolution: one band, the total
  }
  // ordinary single bands are not flagged
  const flags = await page.evaluate(async () => {
    images = []; await __gelMake({ w: 600, h: 300, pol: 'dark', bg: 230, noise: 3, name: 'b.png',
      lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: 60 }, { y: 200, s: 3, amp: 60 }] })) });
    const a = _gelAnalyse(images[0]); return a.lanes.flatMap(L => L.bands.map(b => !!(b.merged || b.split || b.nearNoise)));
  });
  expect(flags.filter(Boolean).length).toBe(0);
  expect(errors).toEqual([]);
});

test('clipping below the format ceiling is saturation: 8-bit at 250, 16-bit at 65520, a dark blot at 6 (GEL-05)', async ({ page }) => {
  const errors = await setup(page);
  const specs = [
    { name: 'clip250.png', w: 400, h: 200, pol: 'light', bg: 20, clip: 250, noise: 2, amps: [600, 100], end: 250 },
    { name: 'g12in16.tif', w: 400, h: 200, pol: 'light', bg: 1000, raw: true, clip: 65520, noise: 30, amps: [120000, 20000], end: 65520 },
    { name: 'floor6.png', w: 400, h: 200, pol: 'dark', bg: 230, floor: 6, noise: 2, amps: [600, 100], end: 6 },
  ];
  for (const s of specs) {
    const r = await page.evaluate(async (s) => {
      images = [];
      await __gelMake({ ...s, lanes: [0, 1, 2, 3].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 80, s: 3, amp: k === 0 ? s.amps[0] : s.amps[1] }] })) });
      runGelAnalysis(0); gelSetRefLane(0, 1);
      const a = images[0].gelAnalysis;
      openGelAnalysis(0); const table = document.getElementById('gel-table').textContent; closeGelAnalysis();
      return { clipHi: a.clipHi, clipLo: a.clipLo, sat: a.lanes.map(L => L.bands.map(b => !!b.saturated)), rel0: _gelRows(a)[0].relRef,
        csv: gelCSV(0).split('\n').find(l => l.startsWith('# Saturated')), methods: generateMethodsParagraph(), table };
    }, s);
    expect(s.pol === 'dark' ? r.clipLo : r.clipHi).toBe(s.end);
    expect(r.sat).toEqual([[true], [false], [false], [false]]);
    expect(r.rel0).toBeNull();                                  // the clipped band takes part in no ratio
    expect(r.csv).toMatch(new RegExp(`# Saturated bands: 1 — clipped at ${s.end}.*pile-up`));
    expect(r.methods).toMatch(/1 band was saturated/);
    expect(r.table).toContain(`SATURATED (clipped at ${s.end})`);
  }
  expect(errors).toEqual([]);
});

test('the ladder fit refuses a missing or extra marker, reversed or garbled sizes, and a poor fit (GEL-06)', async ({ page }) => {
  const errors = await setup(page);
  const H = 400, kd = [250, 130, 100, 70, 55, 35, 25];
  const yOf = m => H * (0.1 + 0.8 * (Math.log10(250) - Math.log10(m)) / (Math.log10(250) - Math.log10(25)));
  const sample = [{ x0: 120, x1: 170, bands: [{ y: yOf(60), s: 3, amp: 80 }, { y: yOf(40), s: 3, amp: 80 }] },
    { x0: 210, x1: 260, bands: [{ y: yOf(150), s: 3, amp: 80 }, { y: yOf(30), s: 3, amp: 80 }] }];
  const ladder = ms => ({ x0: 30, x1: 80, bands: ms.map(m => ({ y: yOf(m), s: 2.5, amp: 70 })) });
  const cases = [
    { name: 'missing', bands: kd.filter(m => m !== 100), sizes: kd.join(','), err: /7 sizes typed for 6 bands/ },
    { name: 'extra', bands: [180, ...kd], sizes: kd.join(','), err: /7 sizes typed for 8 bands/ },
    { name: 'reversed', bands: kd, sizes: kd.slice().reverse().join(','), err: /rise down the list/ },
    { name: 'typo', bands: kd, sizes: '250 kDa, 130kDa, 1e3, -5, abc, 70', err: /"-5" is not a marker size/ },
    { name: 'outOfOrder', bands: kd, sizes: '250,130,100,55,70,35,25', err: /70 follows 55/ },
    { name: 'poorFit', bands: kd, sizes: '1000,990,980,970,20,10,5', err: /R² = 0\.\d+, below 0\.95/ },
  ];
  for (const c of cases) {
    const r = await page.evaluate(async ({ c, lanes }) => {
      images = [];
      await __gelMake({ w: 300, h: 400, pol: 'dark', bg: 225, noise: 3, name: 'mw.png', lanes });
      runGelAnalysis(0); gelSetLadder(0, 0, c.sizes);
      const a = images[0].gelAnalysis;
      openGelAnalysis(0); const fitText = document.getElementById('gel-fit').textContent; closeGelAnalysis();
      const placed = gelPlaceMWLabels(0);
      return { fit: a.ladder.fit, err: a.ladder.error, kda: _gelRows(a).map(x => x.kda).filter(v => v != null), placed,
        csv: gelCSV(0).split('\n').find(l => l.startsWith('# MW fit')), methods: generateMethodsParagraph(), fitText, markers: _gelRows(a).map(x => x.marker).filter(v => v != null) };
    }, { c, lanes: [ladder(c.bands), ...sample] });
    expect(r.fit).toBeNull();
    expect(r.err).toMatch(c.err);
    expect(r.kda).toEqual([]);                               // no kDa anywhere from a refused fit
    expect(r.csv).toMatch(/# MW fit: REFUSED/);
    expect(r.methods).not.toMatch(/Molecular weights/);
    expect(r.fitText).toMatch(/No molecular weights/);
    if (c.name === 'missing' || c.name === 'extra' || c.name === 'reversed') { expect(r.placed).toBe(false); expect(r.markers).toEqual([]); }
  }
  // and the right sizes for the gel with its 100 kDa band missing do fit
  const ok = await page.evaluate(async (lanes) => {
    images = [];
    await __gelMake({ w: 300, h: 400, pol: 'dark', bg: 225, noise: 3, name: 'mw.png', lanes });
    runGelAnalysis(0); gelSetLadder(0, 0, '250, 130, 70, 55, 35, 25');
    return { r2: images[0].gelAnalysis.ladder.fit.r2, kda: _gelRows(images[0].gelAnalysis).map(x => x.kda).filter(v => v != null) };
  }, [ladder(kd.filter(m => m !== 100)), ...sample]);
  expect(ok.r2).toBeGreaterThan(0.98);
  [60, 40, 150, 30].forEach((m, i) => expect(Math.abs(ok.kda[i] - m) / m).toBeLessThan(0.06));
  expect(errors).toEqual([]);
});

test('loading control: refused on a lane-count mismatch, held by panel id, stale when it changes (GEL-07/08/09)', async ({ page }) => {
  const errors = await setup(page);
  const mk = (amps, name, w) => ({ w: w || 400, h: 120, pol: 'dark', bg: 228, noise: 1, name,
    lanes: amps.map((a, k) => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 60, s: 3, amp: a }] })) });
  const tgt = [40, 80, 80, 120], load = [30, 60, 30, 45];   // normalised 1 : 1 : 2 : 2
  const r = await page.evaluate(async ({ mk6, mkT, mkL, mkO }) => {
    const out = {}, toasts = []; const t0 = window.toast; window.toast = m => toasts.push(m);
    const norm = () => _gelRows(images.find(p => p.name === 'target.png').gelAnalysis).map(x => x.normLC);
    // 1. six actin lanes for four target lanes: refused, both counts named
    images = []; await __gelMake(mkT); await __gelMake(mk6);
    runGelAnalysis(0); out.mismatch = { ok: gelSetLoading(0, 1), loading: images[0].gelAnalysis.loading, toast: toasts.pop() };
    // 2. reorder: the control follows actin.png, not slot 1
    images = []; await __gelMake(mkT); await __gelMake(mkL); await __gelMake(mkO);
    runGelAnalysis(0); gelSetLoading(0, 1); const before = norm();
    swapImages(1, 2); render();
    out.reorder = { before, after: norm(), methods: generateMethodsParagraph().match(/loading control in panel (\w)/)[1],
      actinLabel: formatLabel(images.find(p => p.name === 'actin.png').label) };
    runGelAnalysis(0);
    out.reorder.redetect = norm();
    // 3. the target swapped into the control's slot, then re-detected: never its own control
    images = []; await __gelMake(mkT); await __gelMake(mkL);
    runGelAnalysis(0); gelSetLoading(0, 1); swapImages(0, 1); render();
    const ti = images.findIndex(p => p.name === 'target.png'), n0 = toasts.length;
    out.self = { stillLinked: _gelLoadingIdx(images[ti].gelAnalysis) === images.findIndex(p => p.name === 'actin.png') };
    runGelAnalysis(ti); out.self.after = norm(); out.self.loading = images[ti].gelAnalysis.loading && images[ti].gelAnalysis.loading.label;
    // 4. the control re-cropped: stale in the table, CSV, Methods, banner and compliance
    images = []; await __gelMake(mkT); await __gelMake(mkL);
    runGelAnalysis(0); gelSetLoading(0, 1); const n1 = norm();
    images[1].cropL = 30; render();
    openGelAnalysis(0); const banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' '); closeGelAnalysis();
    checkCompliance(); const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Densitometry/.test(x)) || '';
    document.getElementById('info-modal-bg')?.remove();
    out.recrop = { n1, after: norm(), banner, row, csv: gelCSV(0), methods: generateMethodsParagraph() };
    // 5. the control deleted
    images.splice(1, 1); render();
    out.deleted = { after: norm(), csv: gelCSV(0).split('\n').find(l => l.startsWith('# Loading')) };
    window.toast = t0;
    return out;
  }, { mk6: mk([30, 60, 30, 45, 60, 60], 'actin6.png', 580), mkT: mk(tgt, 'target.png'), mkL: mk(load, 'actin.png'), mkO: mk([200, 10, 200, 10], 'other.png') });
  expect(r.mismatch.ok).toBe(false);
  expect(r.mismatch.loading).toBeNull();
  expect(r.mismatch.toast).toMatch(/panel B has 6 lanes .* this panel has 4/);
  const ratio = v => v.map(x => x / v[0]);
  ratio(r.reorder.before).forEach((x, i) => expect(Math.abs(x - [1, 1, 2, 2][i]) / [1, 1, 2, 2][i]).toBeLessThan(0.1));
  expect(r.reorder.after).toEqual(r.reorder.before);
  expect(r.reorder.methods).toBe(r.reorder.actinLabel);
  expect(r.reorder.methods).toBe('C');
  ratio(r.reorder.redetect).forEach((x, i) => expect(Math.abs(x - [1, 1, 2, 2][i]) / [1, 1, 2, 2][i]).toBeLessThan(0.1));
  expect(r.self.stillLinked).toBe(true);
  expect(r.self.after.every(v => v != null)).toBe(true);   // still divided by actin, not by itself
  ratio(r.self.after).forEach((x, i) => expect(Math.abs(x - [1, 1, 2, 2][i]) / [1, 1, 2, 2][i]).toBeLessThan(0.1));
  expect(r.recrop.n1.every(v => v != null)).toBe(true);
  expect(r.recrop.after.every(v => v == null)).toBe(true);
  expect(r.recrop.banner).toMatch(/Normalisation is stale: the loading-control panel B was re-cropped/);
  expect(r.recrop.row).toMatch(/re-cropped after it was measured/);
  expect(r.recrop.csv).toMatch(/# STALE: the loading-control normalisation/);
  expect(r.recrop.csv).toMatch(/# Loading control: STALE/);
  expect(r.recrop.methods).toMatch(/Band densitometry of panel A/);
  expect(r.recrop.methods).not.toMatch(/normalised to the loading control/);
  expect(r.deleted.after.every(v => v == null)).toBe(true);
  expect(r.deleted.csv).toMatch(/STALE — the loading-control panel B is no longer in the figure/);
  expect(errors).toEqual([]);
});

test('a replaced image makes the analysis stale, though the size is the same (GEL-17)', async ({ page }) => {
  const errors = await setup(page);
  const mk = (amps, name) => ({ w: 400, h: 200, pol: 'dark', bg: 228, noise: 1, name,
    lanes: amps.map((a, k) => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: a }] })) });
  const r = await page.evaluate(async ({ m1, m2 }) => {
    images = []; await __gelMake(m1); await __gelMake(m2);
    runGelAnalysis(0);
    const fresh0 = _gelFresh(images[0]);
    images[0].img = images[1].img; images[0].src = images[1].src; render();   // what pasting into the panel does
    const n = undoStack.length, edit = gelSetLane(0, 0, images[0].gelAnalysis.lanes[0].x0 + 1, images[0].gelAnalysis.lanes[0].x1);
    return { fresh0, fresh: _gelFresh(images[0]), edit, steps: undoStack.length - n, methods: generateMethodsParagraph(),
      csv: gelCSV(0).split('\n').filter(l => l.startsWith('# STALE')) };
  }, { m1: mk([20, 40, 60, 80], 'blot1.png'), m2: mk([80, 80, 10, 10], 'blot2.png') });
  expect(r.fresh0).toBe(true);
  expect(r.fresh).toBe(false);
  expect(r.edit).toBe(false);
  expect(r.steps).toBe(0);
  expect(r.methods).not.toMatch(/densitometry/i);
  expect(r.csv[0]).toMatch(/# STALE: The panel's image was replaced/);
  expect(errors).toEqual([]);
});

test('faint bands: no systematic over-estimate (GEL-12)', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const out = [];
    for (const amp of [3, 6, 12]) for (const seed of [3, 11, 29]) {
      images = [];
      await __gelMake({ w: 600, h: 300, pol: 'dark', bg: 230, noise: 1, seed, name: 'f.png',
        lanes: [0, 1, 2, 3, 4, 5].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: k === 3 ? amp : 150 }, { y: 200, s: 3, amp: 150 }] })) });
      const L = _gelAnalyse(images[0]).lanes[3];
      const f = L.bands.find(b => Math.abs(b.yc - 100) < 6), s = L.bands.find(b => Math.abs(b.yc - 200) < 6);
      out.push({ amp, err: f ? (f.volume / s.volume) / (amp / 150) - 1 : null });
    }
    return out;
  });
  // Before the fix: +9% to +44% at amp 3, every seed high. Now within ±8%, either side;
  // a band at 2% of the strongest may fall under the detection bar (not detected, not wrong).
  const errs = r.filter(x => x.err != null);
  errs.forEach(x => expect(Math.abs(x.err)).toBeLessThan(x.amp === 3 ? 0.08 : 0.06));
  expect(errs.filter(x => x.amp >= 6).length).toBe(6);
  expect(errs.some(x => x.err < 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('a heavily loaded dark blot is read dark on light, and the guess is marked uncertain (GEL-13)', async ({ page }) => {
  const errors = await setup(page);
  await make(page, { w: 400, h: 200, pol: 'dark', bg: 230, noise: 1, name: 'heavy.png',
    lanes: [0, 1, 2, 3].map(k => ({ x0: 5 + 100 * k, x1: 95 + 100 * k, bands: [{ y: 60, s: 25, amp: 150 }, { y: 140, s: 25, amp: 150 }] })) });
  const r = await page.evaluate(() => {
    runGelAnalysis(0); const a = images[0].gelAnalysis;
    openGelAnalysis(0); const banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' '); closeGelAnalysis();
    return { pol: a.polarity, unc: a.polarityUncertain, lanes: a.lanes.map(L => [(L.x0 + L.x1) / 2, L.bands.length]), banner,
      csv: gelCSV(0).split('\n').find(l => l.startsWith('# Polarity')) };
  });
  expect(r.pol).toBe('dark');
  expect(r.lanes.map(L => L[1])).toEqual([2, 2, 2, 2]);
  r.lanes.forEach((L, k) => expect(Math.abs(L[0] - (50 + 100 * k))).toBeLessThanOrEqual(3));
  expect(r.unc).toBe(true);
  expect(r.banner).toMatch(/polarity is a low-confidence guess/);
  expect(r.csv).toMatch(/UNCERTAIN/);
  // the ordinary blots are not marked uncertain
  const plain = await page.evaluate(async () => { images = []; await __gelMake({ w: 600, h: 300, pol: 'dark', bg: 230, noise: 3, name: 'b.png',
    lanes: [0, 1, 2].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: 60 }] })) }); return _gelAnalyse(images[0]).polarityUncertain; });
  expect(plain).toBe(false);
  expect(errors).toEqual([]);
});

test('a band partly outside the image on a tilted crop is flagged and left out of ratios (GEL-14)', async ({ page }) => {
  const errors = await setup(page);
  await make(page, { w: 500, h: 300, pol: 'dark', bg: 230, noise: 1, name: 'tilt.png', crop: { l: 0, t: 0, r: 0, b: 0, ang: 8 },
    lanes: [0, 1, 2, 3, 4].map(k => ({ x0: 20 + 95 * k, x1: 70 + 95 * k, bands: [{ y: 20, s: 3, amp: 60 }, { y: 150, s: 3, amp: 60 }, { y: 280, s: 3, amp: 60 }] })) });
  const r = await page.evaluate(() => {
    runGelAnalysis(0); gelSetRefLane(0, 2);
    const a = images[0].gelAnalysis, rows = _gelRows(a);
    return { rows: rows.map(x => ({ lane: x.lane, y: Math.round(x.yc - a.frame.sy), partial: x.partial, rel: x.relRef, pct: x.pctLane })),
      csv: gelCSV(0), methods: generateMethodsParagraph() };
  });
  const cut = r.rows.filter(x => x.partial);
  expect(cut.length).toBeGreaterThanOrEqual(1);
  cut.forEach(x => { expect(x.rel).toBeNull(); expect(x.pct).toBeNull(); });
  expect(cut.some(x => x.lane === 2 && Math.abs(x.y - 20) < 4)).toBe(true);    // the tester's -12% band
  // whole bands keep their ratios (≈1 against lane 3)
  r.rows.filter(x => !x.partial && x.rel != null).forEach(x => expect(Math.abs(x.rel - 1)).toBeLessThan(0.05));
  expect(r.csv).toMatch(/# Bands partly outside the image: [1-9]/);
  expect(r.csv.split('\n').filter(l => /,PARTIAL,/.test(l)).length).toBe(cut.length);
  expect(r.methods).toMatch(/partly outside the image and (was|were) not quantified/);
  expect(errors).toEqual([]);
});

test('undoing the panel away under the open dialog closes it cleanly (GEL-10)', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  await page.evaluate(() => openGelAnalysis(0));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(30); }
  const r = await page.evaluate(() => ({ panels: images.length, open: !!document.getElementById('gel-modal-bg'), ui: _gelUI }));
  expect(r.panels).toBe(0);
  expect(r.open).toBe(false);
  expect(r.ui).toBeNull();
  expect(errors).toEqual([]);
});

test('rulers: grouped by image, never by label; a length that rounds to 1000 takes the next unit (RUL-01, RUL-02)', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(() => {
    const A = { label: '', name: 'a.tif', umPerPx: 0.002 }, B = { label: '', name: 'b.tif', umPerPx: 0.001 }, C = { label: 'A', name: 'c.tif', umPerPx: 0.004 }, D = { label: 'A', name: 'd.tif', umPerPx: 0.004 };
    const row = (im, um) => ({ name: 'capsid', panel: String(im.label || '?'), m: { status: 'ok', um, im } });
    const st = _rulerStats([row(A, 0.06), row(B, 0.03), row(A, 0.064), row(C, 0.12), row(D, 0.2)]);
    return { st: st.map(s => [s.panel, s.n, s.meanText, s.unit]), f1: _rulerFmt(0.9996, 0.002).text, f2: _rulerFmt(999.7, 1).text, f3: _rulerFmt(0.062, 0.002).text };
  });
  expect(r.st).toEqual([['? (a.tif)', 2, '62', 'nm'], ['? (b.tif)', 1, '30', 'nm'], ['A (c.tif)', 1, '120', 'nm'], ['A (d.tif)', 1, '200', 'nm']]);
  expect(r.f1).toBe('1.000 µm');
  expect(r.f2).toBe('1.000 mm');
  expect(r.f3).toBe('62 nm');
  expect(errors).toEqual([]);
});

// ── Background methods, the lane profile, total-protein normalisation ─────────────────

// Two close bands (σ 3 px, 16 px apart, 2:1) on a flat background; truth = amp × 50 × σ√2π.
const DOUBLET = { w: 300, h: 200, pol: 'dark', bg: 220, noise: 3, name: 'doublet.png',
  lanes: [0, 1, 2].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 100, s: 3, amp: 60 }, { y: 116, s: 3, amp: 30 }] })) };
const TRUTH2 = [60, 30].map(a => a * 50 * 3 * Math.sqrt(2 * Math.PI));

// Without the background methods _gelAnalyse ignored opts.method: valley-to-valley and
// flat came back identical to the rolling minimum, so "V2V error is smaller" and the flat
// error bound both fail.
test('background methods against truth: valley-to-valley beats a short rolling window on two close bands; flat matches a flat background', async ({ page }) => {
  const errors = await setup(page);
  await make(page, DOUBLET);
  const r = await page.evaluate(() => {
    const v = a => a.lanes[1].bands.map(b => b.volume);
    // 31 px: shorter than the pair (~33 rows) but not flagged short (≥ 2 × the tallest band).
    const roll = _gelAnalyse(images[0], { window: 31 }), v2v = _gelAnalyse(images[0], { window: 31, method: 'valley-to-valley' });
    const flat = _gelAnalyse(images[0], { method: 'flat' }), auto = _gelAnalyse(images[0]);
    return { roll: v(roll), v2v: v(v2v), flat: v(flat), auto: v(auto), short: _gelWindowShort(roll), v2vBase: v2v.baseline, flatBase: flat.baseline };
  });
  const err = (vs) => vs.map((x, i) => Math.abs(x - TRUTH2[i]) / TRUTH2[i]);
  const eR = err(r.roll), eV = err(r.v2v), eF = err(r.flat), eA = err(r.auto);
  console.log(`truth ${TRUTH2.map(Math.round)} | rolling(31) ${r.roll.map(Math.round)} err ${eR.map(e => (100 * e).toFixed(1))}% | valley-to-valley ${r.v2v.map(Math.round)} err ${eV.map(e => (100 * e).toFixed(1))}% | flat ${r.flat.map(Math.round)} err ${eF.map(e => (100 * e).toFixed(1))}% | rolling(auto) ${r.auto.map(Math.round)} err ${eA.map(e => (100 * e).toFixed(1))}%`);
  expect(r.short).toBe(false);
  expect(r.v2vBase).toEqual({ method: 'valley-to-valley', window: 31, smooth: 3 });
  expect(r.flatBase.method).toBe('flat'); expect(r.flatBase.pct).toBe(10);
  // valley-to-valley is closer to the truth than the rolling minimum, on both bands
  expect(eV[0]).toBeLessThan(eR[0]); expect(eV[1]).toBeLessThan(eR[1]);
  expect(eV[0]).toBeLessThan(0.10); expect(eV[1]).toBeLessThan(0.18);   // its valley still sits on the overlapping tails
  expect(eR[0]).toBeGreaterThan(0.10);
  // flat background, flat method: within 3%
  expect(eF[0]).toBeLessThan(0.03); expect(eF[1]).toBeLessThan(0.03);
  // and the reason the default stays the rolling minimum: auto-widened, it beats both
  expect(eA[0]).toBeLessThan(Math.min(eV[0], 0.04)); expect(eA[1]).toBeLessThan(Math.min(eV[1], 0.04));
  expect(errors).toEqual([]);
});

// Without gelSetBaseline (and the method in the CSV / Methods / stamp) every line here fails.
test('changing the background method: one undo step, re-measures without re-detecting, named in the CSV header, banner and Methods', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  await make(page, { ...blotSpec('dark', 230, [30, 60, 120], 320), name: 'control.png' });
  const r = await page.evaluate(() => {
    runGelAnalysis(1); runGelAnalysis(0); gelSetLoading(0, 1);
    const a0 = images[0].gelAnalysis, rows0 = JSON.stringify(a0.lanes.map(L => L.bands.map(b => [b.y0, b.y1]))), n0 = undoStack.length;
    const csv0 = gelCSV(0), m0 = generateMethodsParagraph();
    const ok = gelSetBaseline(0, 'valley-to-valley', '');
    const a1 = images[0].gelAnalysis;
    const out = { ok, steps: undoStack.length - n0, sameRows: JSON.stringify(a1.lanes.map(L => L.bands.map(b => [b.y0, b.y1]))) === rows0,
      volChanged: a1.lanes[0].bands[0].volume !== a0.lanes[0].bands[0].volume, edits: a1.edits, fresh: _gelFresh(images[0]),
      csv0: csv0.split('\n').find(l => l.startsWith('# Baseline')), csv1: gelCSV(0).split('\n').find(l => l.startsWith('# Baseline')),
      m0, m1: generateMethodsParagraph(), lcStale: _gelLoadingStale(a1, images[0]) };
    openGelAnalysis(0); out.banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' ');
    out.ui = document.getElementById('gel-bg').value; closeGelAnalysis();
    // a re-detection keeps the method
    runGelAnalysis(0); out.kept = images[0].gelAnalysis.baseline.method;
    gelSetBaseline(0, 'flat', 5); out.flatCsv = gelCSV(0).split('\n').find(l => l.startsWith('# Baseline')); out.flatM = generateMethodsParagraph();
    undo(); out.undone = images[0].gelAnalysis.baseline.method;
    // the method changed on the CONTROL panel: its band volumes are not the ones divided by
    gelSetBaseline(1, 'valley-to-valley', ''); out.ctrlStale = _gelLoadingStale(images[0].gelAnalysis, images[0]);
    return out;
  });
  expect(r.ok).toBe(true);
  expect(r.steps).toBe(1);
  expect(r.sameRows).toBe(true);          // the bands were not re-detected
  expect(r.volChanged).toBe(true);        // but every one was re-measured
  expect(r.edits).toBe(0);                // and it is not a hand edit
  expect(r.fresh).toBe(true);             // nor does it make the analysis stale
  expect(r.lcStale).toBeNull();           // the target's own method does not touch its loading control
  expect(r.csv0).toMatch(/# Baseline: rolling minimum/);
  expect(r.csv1).toMatch(/# Baseline: valley-to-valley — .*3-row running mean/);
  expect(r.m0).toMatch(/rolling-minimum background \(window \d+ px\)/);
  const sentA = m => m.split('Band densitometry of panel ').find(x => x.startsWith('A '));
  expect(sentA(r.m1)).toMatch(/above a valley-to-valley background \(straight lines joining the lowest points/);
  expect(sentA(r.m1)).not.toMatch(/rolling-minimum background/);
  expect(r.banner).toMatch(/background: valley-to-valley, valleys on a 3-row mean/);
  expect(r.ui).toBe('valley-to-valley');
  expect(r.kept).toBe('valley-to-valley');
  expect(r.flatCsv).toMatch(/# Baseline: none \/ flat — one level per lane, the 5th percentile/);
  expect(r.flatM).toMatch(/a flat background \(one level per lane, the 5th percentile/);
  expect(r.undone).toBe('valley-to-valley');
  expect(r.ctrlStale).toMatch(/re-analysed or edited after it was used/);
  expect(errors).toEqual([]);
});

// Client point of a band boundary on the profile canvas.
const PROFILE_PT = `window.__profPt = (y) => {
  const cv = document.getElementById('gel-profile'), rc = cv.getBoundingClientRect(), t = _gelUI.prof.t, G = _gelProfGeom(cv, t.H);
  const s = rc.width / cv.width;
  return { x: rc.left + G.X(y - t.sy) * s, y: rc.top + (G.P.mt + G.ph * 0.5) * s, s };
};`;

// Without the profile view there is no #gel-profile canvas and no gelSetBandBounds: the
// drag finds nothing to press, and the volume does not change.
test('the lane profile: dragging a band boundary with the mouse re-measures it, one undo step; clicking an unshaded stretch adds a band', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  await page.evaluate(PROFILE_PT);
  await page.evaluate(() => { runGelAnalysis(0); openGelAnalysis(0); _gelUI.lane = 0; _gelRenderModal(); });
  await expect(page.locator('#gel-profile')).toBeVisible();
  await page.locator('#gel-profile').scrollIntoViewIfNeeded();
  const base = await page.evaluate(() => { const b = images[0].gelAnalysis.lanes[0].bands[0];
    return { n: undoStack.length, v: b.volume, y0: b.y0, y1: b.y1, yc: b.yc }; });
  // drag the band's lower edge up to its centre: half the band is left out
  const from = await page.evaluate(y => __profPt(y), base.y1), to = await page.evaluate(y => __profPt(y), Math.round(base.yc) + 1);
  await page.mouse.move(from.x - 1, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x - 1 + (to.x - from.x) * i / 6, from.y);
  const mid = await page.evaluate(() => ({ n: undoStack.length, drag: !!_gelUI.pdrag }));
  await page.mouse.up();
  const d = await page.evaluate(() => { const b = images[0].gelAnalysis.lanes[0].bands[0];
    return { n: undoStack.length, v: b.volume, y0: b.y0, y1: b.y1, resized: !!b.resized, edits: images[0].gelAnalysis.edits, sel: _gelUI.sel,
      table: document.getElementById('gel-table').textContent }; });
  expect(mid).toEqual({ n: base.n, drag: true });            // nothing is committed while dragging
  expect(d.n).toBe(base.n + 1);                               // one drag, one undo step
  expect(d.y0).toBe(base.y0);
  expect(d.y1).toBeLessThan(base.y1 - 3);
  expect(Math.abs(d.y1 - (Math.round(base.yc) + 1))).toBeLessThanOrEqual(1);
  expect(d.v / base.v).toBeGreaterThan(0.4); expect(d.v / base.v).toBeLessThan(0.75);
  expect(d.resized).toBe(true); expect(d.edits).toBe(1);
  expect(d.sel).toEqual({ li: 0, bi: 0 });
  expect(d.table).toContain(`${Math.round(d.y0)}–${Math.round(d.y1)}`);   // the table shows the boundaries
  expect(d.table).toMatch(/edges set/);
  await page.evaluate(() => { undo(); _gelRefresh(); });
  expect(await page.evaluate(() => images[0].gelAnalysis.lanes[0].bands[0].volume)).toBe(base.v);

  // delete lane 2's top band, then click its spot on the profile: it comes back
  const gone = await page.evaluate(() => { const b = images[0].gelAnalysis.lanes[1].bands[0]; const o = { yc: b.yc, v: b.volume };
    gelDeleteBand(_gelUI.idx, 1, 0); _gelUI.lane = 1; _gelUI.sel = null; _gelRenderModal(); return { ...o, n: undoStack.length }; });
  const at = await page.evaluate(y => __profPt(y), gone.yc);
  await page.mouse.click(at.x, at.y);
  const add = await page.evaluate(() => ({ n: undoStack.length, bands: images[0].gelAnalysis.lanes[1].bands.map(b => ({ yc: b.yc, v: b.volume, manual: !!b.manual })) }));
  expect(add.n).toBe(gone.n + 1);
  const back = add.bands.find(b => b.manual);
  expect(Math.abs(back.yc - gone.yc)).toBeLessThan(1.5);
  expect(Math.abs(back.v - gone.v) / gone.v).toBeLessThan(0.05);
  // clicking inside a shaded band selects it — no edit
  const last = add.bands.length - 1;
  const inBand = await page.evaluate(y => __profPt(y), add.bands[last].yc);
  await page.mouse.click(inBand.x, inBand.y);
  expect(await page.evaluate(() => ({ n: undoStack.length, sel: _gelUI.sel }))).toEqual({ n: gone.n + 1, sel: { li: 1, bi: last } });
  expect(errors).toEqual([]);
});

// Without gelProfileCSV there is no lane-profile export at all.
test('lane profiles CSV: one row per frame row per lane, net = raw − baseline, header says what raw is', async ({ page }) => {
  const errors = await setup(page);
  await make(page, blotSpec('dark', 230, [30, 60, 120], 320));
  const r = await page.evaluate(() => { runGelAnalysis(0); gelSetBaseline(0, 'valley-to-valley', '');
    const a = images[0].gelAnalysis; return { csv: gelProfileCSV(0), H: a.frame.H, n: a.lanes.length, bands: a.lanes[0].bands.map(b => [b.y0, b.y1]) }; });
  const lines = r.csv.split('\n').filter(Boolean), head = lines.filter(l => l.startsWith('#')), rows = lines.filter(l => !l.startsWith('#'));
  expect(head.join('\n')).toMatch(/central 65% of the lane's width/);
  expect(head.join('\n')).toMatch(/# Baseline: valley-to-valley/);
  const cols = rows[0].split(',');
  expect(cols).toEqual(['lane', 'row', 'y', 'Rf', 'raw', 'baseline', 'net', 'in_band', 'outside_image']);
  const data = rows.slice(1).map(l => l.split(','));
  expect(data.length).toBe(r.n * r.H);
  for (let li = 1; li <= r.n; li++) expect(data.filter(d => +d[0] === li).length).toBe(r.H);
  data.forEach(d => expect(Math.abs(+d[6] - (+d[4] - +d[5]))).toBeLessThan(1e-3 * Math.max(1, Math.abs(+d[4]))));
  // the in_band column marks exactly the first band's rows
  const inB = data.filter(d => +d[0] === 1 && d[7] === '1').length;
  expect(inB).toBe(Math.round(r.bands[0][1] - r.bands[0][0]));
  expect(errors).toEqual([]);
});

// A total-protein stain: each lane a smear (a run of wide bands) whose whole-lane signal is in the
// ratio 1 : 2 : 1 : 2. Without the total-protein mode gelSetLoading ignored its third argument: the
// loading record had no mode and no whole-lane totals, and the Methods, CSV, banner and compliance
// row had no total-protein wording. (On this clean synthetic smear the band mode happens to give a
// similar ratio — it is logged — because every band of the smear is detected; a real smear is not.)
const stain = (amps, name, extra) => ({ w: 400, h: 160, pol: 'dark', bg: 215, noise: 2, name,
  lanes: amps.map((a, k) => ({ x0: 30 + 90 * k, x1: 80 + 90 * k,
    bands: [20, 34, 48, 62, 76, 90, 104, 118, 132].map((y, i) => ({ y, s: 5, amp: a * [1, 0.6, 1.3, 0.8, 1.1, 0.5, 0.9, 1.2, 0.7][i] })).concat((extra && extra[k]) || []) })) });
test('total-protein normalisation: whole-lane signal, 1:2:1:2 stain → 2:1:2:1, refusals, a saturated stain lane flagged, named everywhere', async ({ page }) => {
  const errors = await setup(page);
  const target = { w: 400, h: 120, pol: 'dark', bg: 228, noise: 2, name: 'target.png',
    lanes: [0, 1, 2, 3].map(k => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 60, s: 3, amp: 60 }] })) };
  const r = await page.evaluate(async ({ target, st, st6, stSat }) => {
    const out = {}, toasts = []; const t0 = window.toast; window.toast = (m) => toasts.push(m);
    await __gelMake(target); await __gelMake(st);
    runGelAnalysis(0); gelSetRefLane(0, 0);
    out.ok = gelSetLoading(0, 1, 'total');
    const a = images[0].gelAnalysis, rows = _gelRows(a);
    out.mode = a.loading && a.loading.mode; out.totals = a.loading.lanes.map(l => l.volume);
    out.norm = rows.map(x => x.normLC); out.rel = rows.map(x => x.normLCRef);
    out.methods = generateMethodsParagraph(); out.csv = gelCSV(0);
    checkCompliance(); out.row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Densitometry/.test(x)) || '';
    document.getElementById('info-modal-bg')?.remove();
    openGelAnalysis(0); out.banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' '); out.uiMode = document.getElementById('gel-lc-mode').value; closeGelAnalysis();
    // the band mode, on the same stain, is something else
    gelSetLoading(0, 1, 'bands'); out.bandsRel = _gelRows(images[0].gelAnalysis).map(x => x.normLCRef);
    // a stain with six lanes for four target lanes: refused, nothing set
    images.splice(1, 1); await __gelMake(st6); runGelAnalysis(0);
    out.mismatch = { ok: gelSetLoading(0, 1, 'total'), loading: images[0].gelAnalysis.loading, toast: toasts.pop() };
    // a stain whose third lane is clipped
    images.splice(1, 1); await __gelMake(stSat); runGelAnalysis(0); gelSetRefLane(0, 0);
    gelSetLoading(0, 1, 'total');
    const rs = _gelRows(images[0].gelAnalysis);
    out.sat = { norm: rs.map(x => x.normLC), flag: rs.map(x => x.lcFlag), csv: gelCSV(0), methods: generateMethodsParagraph() };
    openGelAnalysis(0); out.sat.table = document.getElementById('gel-table').textContent; out.sat.banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' '); closeGelAnalysis();
    window.toast = t0;
    return out;
  }, { target, st: stain([20, 40, 20, 40], 'stain.png'), st6: { ...stain([20, 40, 20, 40, 20, 40], 'stain6.png'), w: 580 },
       stSat: stain([20, 40, 20, 40], 'stainsat.png', [[], [], [{ y: 76, s: 4, amp: 300 }], []]) });
  console.log('total-protein lane totals', r.totals.map(Math.round), 'normalised rel. lane 1', r.rel.map(v => v.toFixed(3)), '| loading-band mode on the same stain', r.bandsRel.map(v => v == null ? null : v.toFixed(3)));
  expect(r.ok).toBe(true);
  expect(r.mode).toBe('total');
  [1, 2, 1, 2].forEach((t, i) => expect(Math.abs(r.totals[i] / r.totals[0] - t) / t).toBeLessThan(0.05));
  [1, 0.5, 1, 0.5].forEach((t, i) => expect(Math.abs(r.rel[i] - t) / t).toBeLessThan(0.05));   // 2 : 1 : 2 : 1
  expect(r.methods).toMatch(/normalised to total protein in panel B, whole-lane signal/);
  expect(r.csv).toMatch(/# Loading control: total protein in panel B, whole-lane signal, lanes paired by order/);
  expect(r.row).toMatch(/normalised to total protein in panel B, whole-lane signal/);
  expect(r.banner).toMatch(/Normalised to total protein in panel B, whole-lane signal/);
  expect(r.uiMode).toBe('total');
  expect(r.mismatch.ok).toBe(false);
  expect(r.mismatch.loading).toBeNull();
  expect(r.mismatch.toast).toMatch(/panel B has 6 lanes .* this panel has 4/);
  expect(r.sat.norm[2]).toBeNull();
  expect(r.sat.norm.filter(v => v != null).length).toBe(3);
  expect(r.sat.flag).toEqual(['', '', 'SATURATED', '']);
  expect(r.sat.csv).toMatch(/lane 3 of the total-protein image have clipped samples/);
  expect(r.sat.csv.split('\n').filter(l => /,SATURATED$/.test(l)).length).toBe(1);
  expect(r.sat.methods).toMatch(/lane 3 not normalised: clipped in the total-protein image/);
  expect(r.sat.table).toMatch(/LC lane saturated/);
  expect(r.sat.banner).toMatch(/Lane 3 of the total-protein image has clipped samples/);
  expect(errors).toEqual([]);
});
