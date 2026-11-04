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
// upright in the frame and tilted in the file.
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
    const clip = spec.clip != null ? spec.clip : full;
    const vals = new Float64Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let x = i + 0.5, y = j + 0.5;
      if (geom) { const f = geom.toFrame(x, y); x = f[0] - geom.sx; y = f[1] - geom.sy; }
      const sg = model(x, y), n = spec.noise ? (rnd() - 0.5) * 2 * spec.noise : 0;
      const v = spec.pol === 'dark' ? spec.bg - sg + n : spec.bg + sg + n;
      vals[j * W + i] = Math.max(0, Math.min(clip, Math.round(v)));
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
