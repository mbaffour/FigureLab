// @ts-check
// Tilted crops: the crop region can be rotated, and the panel comes out upright.
//
// The whole feature rests on one claim — that cropL/T/R/B keep their meaning in a frame
// rotated about the image centre, and that at 0° every path collapses to exactly what
// the app did before. Most of these tests exist to hold that claim down, because the
// failure modes are silent: a sheared box still looks like a box, and a resampled
// measurement still looks like a number.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

/** Commit one panel with a known bitmap, drawn by `paint` on a w×h canvas. */
async function seedPainted(page, w, h, paintBody) {
  await page.evaluate(async ({ w, h, paintBody }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    new Function('ctx', 'W', 'H', paintBody)(c.getContext('2d'), w, h);
    const src = c.toDataURL('image/png');
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { _commitImage(img, src, 'tilt.png'); res(); };
      img.onerror = rej;
      img.src = src;
    });
    render();
  }, { w, h, paintBody });
  await page.waitForFunction(() => images[0] && images[0].img && images[0].img.naturalWidth > 0);
}

// ── Geometry ──────────────────────────────────────────────────

test('at 0 degrees the geometry is exactly the old plain source rect', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const g = _cropGeomOf(400, 300, 10, 20, 30, 40, 0);
    return { sx: g.sx, sy: g.sy, sw: g.sw, sh: g.sh, rotated: g.rotated,
             identity: g.toSrc(123, 45) };
  });
  // The pre-tilt formulas, spelled out rather than recomputed with the same helper.
  expect(r).toMatchObject({ sx: 40, sy: 60, sw: 240, sh: 120, rotated: false });
  expect(r.identity).toEqual([123, 45]);
  expect(errors).toEqual([]);
});

test('rotating the crop is rigid — the region keeps its size', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const out = [];
    for (const a of [0, 7, 30, 45, 90, -33.5, 180]) {
      const g = _cropGeomOf(400, 300, 10, 20, 30, 40, a);
      // Shoelace area of the tilted quad must equal sw*sh at every angle. A rotation
      // that leaked into the normalised space would stretch this.
      const q = g.corners();
      let area = 0;
      for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; area += x1 * y2 - x2 * y1; }
      out.push({ a, sw: g.sw, sh: g.sh, area: Math.abs(area / 2) });
    }
    return out;
  });
  for (const { sw, sh, area } of r) {
    expect(sw).toBeCloseTo(240, 9);
    expect(sh).toBeCloseTo(120, 9);
    expect(area).toBeCloseTo(240 * 120, 6);
  }
  expect(errors).toEqual([]);
});

test('frame and source coordinates invert each other', async ({ page }) => {
  const errors = await loadApp(page);
  const bad = await page.evaluate(() => {
    const g = _cropGeomOf(640, 480, 5, 5, 5, 5, 41.7);
    const bad = [];
    for (const [x, y] of [[0, 0], [639, 479], [123, 45], [320, 240]]) {
      const [u, v] = g.toSrc(x, y);
      const [bx, by] = g.toFrame(u, v);
      if (Math.abs(bx - x) > 1e-9 || Math.abs(by - y) > 1e-9) bad.push([x, y, bx, by]);
    }
    return bad;
  });
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

// ── The shear trap ────────────────────────────────────────────

test('the crop box stays a rectangle on a non-square image', async ({ page }) => {
  const errors = await loadApp(page);
  // Rotating the normalised [0,1] box directly — the obvious implementation — turns a
  // rectangle into a parallelogram on any image that is not square. This is the test
  // that distinguishes the two, and it fails loudly for the wrong one.
  const r = await page.evaluate(() => {
    const cc = document.getElementById('crop-ed-canvas');
    cc.width = 400; cc.height = 300;                     // deliberately 4:3
    cropEdState = { cx: 0.1, cy: 0.15, cw: 0.35, ch: 0.2, hasBox: true, ang: 33, imgIdx: -1 };
    const q = _ceQuad();
    const len = (a, b) => Math.hypot(q[b][0] - q[a][0], q[b][1] - q[a][1]);
    return {
      top: len(0, 1), bottom: len(3, 2), left: len(0, 3), right: len(1, 2),
      // dot product of two adjacent edges — zero iff the corner is a right angle
      corner: (q[1][0] - q[0][0]) * (q[3][0] - q[0][0]) + (q[1][1] - q[0][1]) * (q[3][1] - q[0][1]),
    };
  });
  expect(r.top).toBeCloseTo(r.bottom, 6);
  expect(r.left).toBeCloseTo(r.right, 6);
  expect(r.corner).toBeCloseTo(0, 6);
  expect(errors).toEqual([]);
});

test('setting an angle spins the box in place instead of swinging it', async ({ page }) => {
  const errors = await loadApp(page);
  // The frame turns about the IMAGE centre, so changing only the angle would sweep the
  // box across the picture. cx/cy are re-solved to hold the region over its pixels.
  const r = await page.evaluate(() => {
    const cc = document.getElementById('crop-ed-canvas');
    cc.width = 400; cc.height = 300;
    cropEdState = { cx: 0.05, cy: 0.05, cw: 0.3, ch: 0.2, hasBox: true, ang: 0, imgIdx: -1 };
    const mid = () => { const q = _ceQuad(); return [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]; };
    const before = mid();
    setCropAngle(37);
    const after = mid();
    return { before, after, cw: cropEdState.cw, ch: cropEdState.ch, ang: cropEdState.ang };
  });
  expect(r.after[0]).toBeCloseTo(r.before[0], 6);
  expect(r.after[1]).toBeCloseTo(r.before[1], 6);
  expect(r.cw).toBeCloseTo(0.3, 9);      // tilting must not resize
  expect(r.ch).toBeCloseTo(0.2, 9);
  expect(r.ang).toBe(37);
  expect(errors).toEqual([]);
});

// ── Pixels ────────────────────────────────────────────────────

test('a tilted crop straightens the content it was aimed at', async ({ page }) => {
  const errors = await loadApp(page);
  // A white bar that is horizontal in the 30-degree frame: drawn into the source by
  // rotating +30 about the centre, exactly the mapping _cropGeom describes.
  await seedPainted(page, 200, 200, `
    ctx.fillStyle='#000'; ctx.fillRect(0,0,200,200);
    ctx.translate(100,100); ctx.rotate(30*Math.PI/180); ctx.translate(-100,-100);
    ctx.fillStyle='#fff'; ctx.fillRect(60,90,80,20);
  `);
  const r = await page.evaluate(() => {
    const im = images[0];
    const measure = (ang) => {
      Object.assign(im, { cropL: 30, cropR: 30, cropT: 45, cropB: 45, cropAngle: ang,
                          _cropCache: undefined, _cropKey: undefined });
      const cd = _cropDraw(im);
      const o = document.createElement('canvas');
      o.width = Math.round(cd.sw); o.height = Math.round(cd.sh);
      o.getContext('2d').drawImage(cd.img, cd.sx, cd.sy, cd.sw, cd.sh, 0, 0, o.width, o.height);
      const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
      let white = 0, black = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 200) white++; else if (d[i] < 55) black++; }
      const n = d.length / 4;
      return { w: o.width, h: o.height, white: white / n, black: black / n, rotated: cd.rotated };
    };
    return { tilted: measure(30), upright: measure(0) };
  });
  // Aimed at the bar and tilted to match: the region is the bar.
  expect(r.tilted.rotated).toBe(true);
  expect(r.tilted.white).toBeGreaterThan(0.9);
  expect(r.tilted.black).toBeLessThan(0.02);
  // Same rectangle, no tilt: it cuts across the bar and takes a lot of background.
  expect(r.upright.rotated).toBe(false);
  expect(r.upright.black).toBeGreaterThan(0.3);
  // The straightened canvas is 1:1 with source pixels — no resolution is invented.
  expect(r.tilted.w).toBe(80);
  expect(r.tilted.h).toBe(20);
  expect(errors).toEqual([]);
});

test('an untilted crop resamples nothing at all', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  // The guarantee that made this change safe to make everywhere: at 0° the draw path
  // hands back the ORIGINAL bitmap and the original rect, not a re-rendered canvas.
  const r = await page.evaluate(() => {
    const im = images[0];
    Object.assign(im, { cropL: 10, cropT: 20, cropR: 5, cropB: 5, cropAngle: 0,
                        _cropCache: undefined, _cropKey: undefined });
    const cd = _cropDraw(im);
    const iw = im.img.naturalWidth, ih = im.img.naturalHeight;
    return { isOriginalBitmap: cd.img === im.img, rotated: cd.rotated,
             sx: cd.sx, sy: cd.sy, sw: cd.sw, sh: cd.sh,
             expect: [0.10 * iw, 0.20 * ih, iw * 0.85, ih * 0.75],
             cachedNothing: im._cropCache === undefined };
  });
  expect(r.isOriginalBitmap).toBe(true);
  expect(r.rotated).toBe(false);
  expect(r.cachedNothing).toBe(true);
  expect([r.sx, r.sy, r.sw, r.sh]).toEqual(r.expect);
  expect(errors).toEqual([]);
});

test('the straightened canvas is cached, and the cache notices the angle', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    const im = images[0];
    Object.assign(im, { cropL: 10, cropT: 10, cropR: 10, cropB: 10, cropAngle: 20,
                        _cropCache: undefined, _cropKey: undefined });
    const a = _cropDraw(im).img;
    const b = _cropDraw(im).img;              // same geometry -> same canvas object
    im.cropAngle = 21;
    const c = _cropDraw(im).img;              // angle changed -> must be rebuilt
    im.cropL = 12;
    const d = _cropDraw(im).img;              // rect changed  -> must be rebuilt
    return { reused: a === b, angleBusted: b !== c, rectBusted: c !== d };
  });
  expect(r).toEqual({ reused: true, angleBusted: true, rectBusted: true });
  expect(errors).toEqual([]);
});

// ── Measurement ───────────────────────────────────────────────

test('region statistics on a tilted crop read original samples, never interpolated ones', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const g = _cropGeomOf(200, 200, 25, 25, 25, 25, 45);   // 100x100 region, tilted 45
    const W = 200, H = 200;
    // Alternating 1000/2000 samples: any averaging shows up immediately as a value
    // strictly between the two, which no real pixel has.
    const data = new Uint16Array(W * H);
    for (let i = 0; i < data.length; i++) data[i] = (i % 2) ? 1000 : 2000;
    const st = _rawStatsQuad({ w: W, h: H, data, full: 65535 }, g.corners(), null);
    return { n: st.n, min: st.min, max: st.max, mean: st.mean };
  });
  expect(r.min).toBe(1000);          // exactly a stored value
  expect(r.max).toBe(2000);          // exactly a stored value
  expect(r.mean).toBeGreaterThan(1400);
  expect(r.mean).toBeLessThan(1600);
  // Pixel centres inside a 45-degree quad: close to the true area, never wildly over.
  expect(r.n).toBeGreaterThan(10000 * 0.97);
  expect(r.n).toBeLessThanOrEqual(10000);
  expect(errors).toEqual([]);
});

test('a selection on a tilted panel maps to a tilted quad in the source', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    const im = images[0];
    Object.assign(im, { cropL: 10, cropT: 10, cropR: 10, cropB: 10, cropAngle: 25,
                        _cropCache: undefined, _cropKey: undefined });
    render();
    const pb = panelBounds[0];
    const map = _panelSourceMap(pb, im);
    if (!map) return { map: null };
    const q = map.srcQuad(pb.x + 10, pb.y + 10, pb.x + 40, pb.y + 30);
    // A tilted quad has no axis-aligned edge: every corner differs in both coordinates
    // from its neighbour. An implementation that forgot the rotation returns a rect.
    const axisAligned = q.every((p, i) => {
      const n = q[(i + 1) % 4];
      return Math.abs(p[0] - n[0]) < 1e-6 || Math.abs(p[1] - n[1]) < 1e-6;
    });
    return { rotated: map.rotated, axisAligned, hasCropQuad: Array.isArray(map.cropQuad) };
  });
  expect(r.rotated).toBe(true);
  expect(r.axisAligned).toBe(false);
  expect(r.hasCropQuad).toBe(true);
  expect(errors).toEqual([]);
});

test('an untilted panel still maps with the plain rect it always did', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    const im = images[0];
    Object.assign(im, { cropL: 10, cropT: 20, cropR: 0, cropB: 0, cropAngle: 0 });
    render();
    const map = _panelSourceMap(panelBounds[0], im);
    const iw = im.img.naturalWidth, ih = im.img.naturalHeight;
    return { rotated: map.rotated, cropQuad: map.cropQuad,
             toSrc: map.toSrc(map.dx, map.dy), expect: [0.10 * iw, 0.20 * ih] };
  });
  expect(r.rotated).toBe(false);
  expect(r.cropQuad).toBeNull();
  expect(r.toSrc[0]).toBeCloseTo(r.expect[0], 6);
  expect(r.toSrc[1]).toBeCloseTo(r.expect[1], 6);
  expect(errors).toEqual([]);
});

// ── Persistence and disclosure ────────────────────────────────

test('the tilt survives a session round-trip', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[0].cropAngle = 12.5; images[1].cropAngle = 0;
    const s = serializeSession();
    const j = (typeof s === 'string') ? JSON.parse(s) : s;
    // The loader reconstructs each panel with {...d}, so what is written is what returns.
    return { saved: j.images.map(i => i.cropAngle),
             reloaded: j.images.map(d => ({ ...d }).cropAngle) };
  });
  expect(r.saved).toEqual([12.5, 0]);
  expect(r.reloaded).toEqual([12.5, 0]);
  expect(errors).toEqual([]);
});

test('a tilt changes the provenance hash', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  // The hash exists so a reader can check which settings produced a figure. A tilt that
  // did not disturb it would make two different figures claim the same provenance.
  const r = await page.evaluate(async () => {
    images[0].cropAngle = 0; const a = await _provenanceHash();
    images[0].cropAngle = 9; const b = await _provenanceHash();
    return { a, b };
  });
  expect(r.a).toBeTruthy();
  expect(r.b).not.toBe(r.a);
  expect(errors).toEqual([]);
});

test('the metadata CSV states the angle and the resampling', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[0].cropAngle = 15; images[1].cropAngle = 0;
    let csv = null;
    const realDl = window.dl;
    window.dl = (url) => { csv = url; };
    try { exportCSV(); } finally { window.dl = realDl; }
    return csv;
  });
  const text = await page.evaluate(u => fetch(u).then(x => x.text()), r);
  const rows = text.trim().split('\n');
  expect(rows[0]).toContain('CropAngle');
  expect(rows[0]).toContain('Resampling');
  expect(rows[1]).toContain('resampled (bilinear)');
  expect(rows[2]).toContain('none');
  expect(errors).toEqual([]);
});

// ── Multi-crop ────────────────────────────────────────────────

test('multi-crop regions each keep their own tilt while sharing one size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    startMultiCrop([0]);
    Object.assign(cropEdState, { cx: 0.1, cy: 0.1, cw: 0.3, ch: 0.3, hasBox: true, ang: 0 });
    mcSession.cropW = 0.3; mcSession.cropH = 0.3;
    mcAddRegion();                                   // upright
    Object.assign(cropEdState, { cx: 0.5, cy: 0.5, ang: 18 });
    mcAddRegion();                                   // tilted
    return {
      angles: mcSession.regions.map(x => x.ang),
      widths: mcSession.regions.map(x => x.cw),      // size stays pinned across both
      heights: mcSession.regions.map(x => x.ch),
    };
  });
  expect(r.angles).toEqual([0, 18]);
  expect(r.widths).toEqual([0.3, 0.3]);
  expect(r.heights).toEqual([0.3, 0.3]);
  expect(errors).toEqual([]);
});

test('a banked region can be reopened, moved and updated in place', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  // Multi-crop used to be forward-only: a region placed wrong three back could not be
  // reached, because Undo only removes the last one.
  const r = await page.evaluate(() => {
    startMultiCrop([0]);
    Object.assign(cropEdState, { cx: 0.1, cy: 0.1, cw: 0.25, ch: 0.25, hasBox: true, ang: 0 });
    mcSession.cropW = 0.25; mcSession.cropH = 0.25;
    document.getElementById('mc-region-label').value = 'T4';
    mcAddRegion();
    Object.assign(cropEdState, { cx: 0.5, cy: 0.1 });
    document.getElementById('mc-region-label').value = 'T7';
    mcAddRegion();
    const before = mcSession.regions.map(x => ({ ...x }));

    mcEditRegion(0);                                  // go back to the first one
    const loaded = { cx: cropEdState.cx, label: document.getElementById('mc-region-label').value,
                     editIdx: mcSession.editIdx };
    Object.assign(cropEdState, { cx: 0.2, cy: 0.3, ang: 12 });
    document.getElementById('mc-region-label').value = '';   // left blank on purpose
    mcAddRegion();                                    // = Update

    return { before, loaded, after: mcSession.regions.map(x => ({ ...x })),
             editCleared: mcSession.editIdx };
  });
  expect(r.before.map(x => x.label)).toEqual(['T4', 'T7']);
  // Reopening loads that region back into the editor, name and all.
  expect(r.loaded).toEqual({ cx: 0.1, label: 'T4', editIdx: 0 });
  // Updating replaces it in place — it does not append a third region...
  expect(r.after.length).toBe(2);
  expect(r.after[0].cx).toBe(0.2);
  expect(r.after[0].ang).toBe(12);
  // ...and a blank name keeps the one it already had, rather than silently clearing it.
  expect(r.after[0].label).toBe('T4');
  expect(r.after[1].label).toBe('T7');
  expect(r.editCleared).toBe(-1);
  expect(errors).toEqual([]);
});

test('a banked region can be deleted from the middle', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    startMultiCrop([0]);
    Object.assign(cropEdState, { cx: 0.1, cy: 0.1, cw: 0.2, ch: 0.2, hasBox: true, ang: 0 });
    mcSession.cropW = 0.2; mcSession.cropH = 0.2;
    for (const n of ['a', 'b', 'c']) {
      document.getElementById('mc-region-label').value = n;
      Object.assign(cropEdState, { cx: 0.1 + 0.2 * mcSession.regions.length });
      mcAddRegion();
    }
    mcDeleteRegion(1);
    return mcSession.regions.map(x => x.label);
  });
  expect(r).toEqual(['a', 'c']);
  expect(errors).toEqual([]);
});

test('multi-crop carries each region tilt onto the panel it becomes', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    startMultiCrop([0]);
    Object.assign(cropEdState, { cx: 0.1, cy: 0.1, cw: 0.25, ch: 0.25, hasBox: true, ang: 0 });
    mcSession.cropW = 0.25; mcSession.cropH = 0.25;
    mcAddRegion();
    Object.assign(cropEdState, { cx: 0.5, cy: 0.5, ang: 22 });
    mcAddRegion();
    mcFinishNow();
    return images.filter(Boolean).map(i => i.cropAngle);
  });
  expect(r).toEqual([0, 22]);
  expect(errors).toEqual([]);
});

// ── Batch crop and the freeform editor ────────────────────────
// The single, multi-crop and crop-on-import paths all carried the tilt. Batch crop
// drew the grip and turned the box on screen, then saved an upright crop; the freeform
// editor saved the tilt but reopened at 0°, so a second Apply straightened it.

const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

test('batch crop keeps one size for every image but lets each carry its own tilt', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async (twoFramesSrc) => {
    const twoFrames = new Function('return ' + twoFramesSrc)();
    startBatchCrop();
    await twoFrames();
    // Draw the shared size on image 1 — a 40 % × 30 % box about the centre — and tilt it.
    cropEdState.cx = 0.3; cropEdState.cy = 0.35; cropEdState.cw = 0.4; cropEdState.ch = 0.3; cropEdState.hasBox = true;
    setCropAngle(12);
    applyCropModal();                        // locks the size, saves image 1, advances
    const carried = +cropEdState.ang;        // each image starts upright, as in multi-crop…
    setCropAngle(-7);                        // …and each is free to have its own tilt
    applyCropModal();                        // image 2 saved, advance to image 3
    const startsAt = +cropEdState.ang;
    setCropAngle(3);
    applyBatchCropAll();                     // image 3 and the remaining image 4, both at 3°
    return {
      carried, startsAt,
      angles: images.map(im => im.cropAngle),
      sizes: images.map(im => [100 - im.cropL - im.cropR, 100 - im.cropT - im.cropB]),
      open: document.getElementById('crop-modal').classList.contains('open'),
    };
  }, twoFrames.toString());
  expect(r.carried).toBe(0);                          // not inherited from image 1
  expect(r.startsAt).toBe(0);                         // image 3 starts upright too
  expect(r.angles).toEqual([12, -7, 3, 3]);          // used to be [0, 0, 0, 0]
  for (const s of r.sizes) expect(s).toEqual([40, 30]);   // one size for all
  expect(r.open).toBe(false);
  expect(errors).toEqual([]);
});

test('the freeform crop editor reopens a tilted crop at its tilt, so Apply does not straighten it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 50, w: 200, h: 150, iw: 400, ih: 300, fill: '#4a4' }]);
  const r = await page.evaluate(async (twoFramesSrc) => {
    const twoFrames = new Function('return ' + twoFramesSrc)();
    selectedElems.clear(); selectedElems.add(0);
    openFreeformCropEditor();
    await twoFrames();
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    setCropAngle(9);
    applyCropModal();
    const saved = freeformElements[0].cropAngle;
    selectedElems.clear(); selectedElems.add(0);
    openFreeformCropEditor();
    await twoFrames();
    const reopened = +cropEdState.ang;
    // The box reopens where it was saved (frame coordinates: the tilt re-solved
    // cx/cy so the box spun in place, which is what the element stored).
    const el = freeformElements[0];
    const box = [cropEdState.cx, cropEdState.cy, cropEdState.cw, cropEdState.ch].map(v => v * 100);
    const stored = [el.cropL, el.cropT, 100 - el.cropL - el.cropR, 100 - el.cropT - el.cropB];
    applyCropModal();                        // a second Apply must be a no-op on the tilt
    return { saved, reopened, box, stored, after: freeformElements[0].cropAngle };
  }, twoFrames.toString());
  expect(r.saved).toBeCloseTo(9, 5);
  expect(r.reopened).toBeCloseTo(9, 5);     // used to reopen at 0
  r.box.forEach((v, i) => expect(v).toBeCloseTo(r.stored[i], 2));   // stored to 0.01 %
  expect(r.after).toBeCloseTo(9, 5);
  expect(errors).toEqual([]);
});

// ── Straightening by reference, and by search ─────────────────
// Turning a grip to eyeball a tilt is fine for a plate; a gel edge wants a number.
// Level takes two clicks along an edge; Auto searches for the angle at which the
// straight features in the box line up with its rows and columns.

/** Fire a mousedown/mousemove on the crop editor canvas at canvas-pixel coords. */
const CE_FIRE = `
  window._ceFire = (type, px, py) => {
    const c = document.getElementById('crop-ed-canvas');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0,
      clientX: r.left + px * r.width / c.width, clientY: r.top + py * r.height / c.height }));
  };
`;

test('level angle: a line at any angle, in either direction, becomes a tilt in (-45, 45]', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => [
    _ceLevelAngle(0, 0, 100, 10),      // gentle clockwise slope
    _ceLevelAngle(100, 10, 0, 0),      // the same edge clicked the other way round
    _ceLevelAngle(0, 0, 10, 100),      // a near-vertical edge leaning right going down
    _ceLevelAngle(0, 0, 100, 0),       // already level
    _ceLevelAngle(0, 0, 0, 100),       // already plumb
    _ceLevelAngle(0, 0, 2, 1),         // too short to mean anything
  ]);
  expect(r[0]).toBeCloseTo(5.71, 1);
  expect(r[1]).toBeCloseTo(5.71, 1);      // direction does not matter
  expect(r[2]).toBeCloseTo(-5.71, 1);     // read as a vertical reference
  expect(r[3]).toBeCloseTo(0, 5);
  expect(r[4]).toBeCloseTo(0, 5);
  expect(r[5]).toBeNull();
});

test('Level: two clicks along an edge tilt the crop so that edge comes out straight', async ({ page }) => {
  const errors = await loadApp(page);
  // A dark "plate rim": a thick line at 8° through the middle of a light field.
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W/2, H/2); ctx.rotate(8 * Math.PI / 180);
    ctx.fillStyle = '#202020'; ctx.fillRect(-160, -6, 320, 12); ctx.restore();
  `);
  await page.evaluate(CE_FIRE);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.getElementById('crop-ed-canvas');
    cropEdState.cx = 0.1; cropEdState.cy = 0.1; cropEdState.cw = 0.8; cropEdState.ch = 0.8; cropEdState.hasBox = true;
    drawCropEd();
    toggleCropLevel();
    const on = cropEdState.leveling;
    // Click two points on the painted line: it passes through the centre at 8°.
    const t = Math.tan(8 * Math.PI / 180);
    _ceFire('mousedown', c.width * 0.25, c.height / 2 - (c.width * 0.25) * t);
    const afterOne = { leveling: cropEdState.leveling, pt1: !!cropEdState.levelPt1 };
    _ceFire('mousedown', c.width * 0.75, c.height / 2 + (c.width * 0.25) * t);
    return { on, afterOne, ang: +cropEdState.ang, leveling: cropEdState.leveling,
             desc: document.getElementById('crop-modal-desc').textContent,
             btnActive: document.getElementById('crop-level-btn').classList.contains('active') };
  });
  expect(r.on).toBe(true);
  expect(r.afterOne).toEqual({ leveling: true, pt1: true });   // one click down, waiting for the second
  expect(r.ang).toBeCloseTo(8, 0);                              // 0.1° granularity
  expect(r.leveling).toBe(false);                               // the mode ends itself
  expect(r.btnActive).toBe(false);
  expect(r.desc).not.toMatch(/two points/);                     // the prompt is gone
  expect(errors).toEqual([]);
});

test('Level: Escape cancels a half-placed line and leaves the tilt alone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(CE_FIRE);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    setCropAngle(3);
    toggleCropLevel(true);
    _ceFire('mousedown', 20, 20);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { leveling: cropEdState.leveling, pt1: cropEdState.levelPt1, ang: +cropEdState.ang,
             open: document.getElementById('crop-modal').classList.contains('open') };
  });
  expect(r.leveling).toBe(false);
  expect(r.pt1).toBeNull();
  expect(r.ang).toBeCloseTo(3, 5);
  expect(r.open).toBe(true);                                    // Escape did not close the editor
  expect(errors).toEqual([]);
});

test('Auto: finds the tilt of a rotated gel-like bar to within half a degree', async ({ page }) => {
  const errors = await loadApp(page);
  // Two dark bands and a light background, the whole thing turned by 7°.
  await seedPainted(page, 480, 360, `
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W/2, H/2); ctx.rotate(7 * Math.PI / 180);
    ctx.fillStyle = '#303030'; ctx.fillRect(-200, -60, 400, 18); ctx.fillRect(-200, 30, 400, 18);
    ctx.restore();
  `);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    cropEdState.cx = 0.15; cropEdState.cy = 0.15; cropEdState.cw = 0.7; cropEdState.ch = 0.7; cropEdState.hasBox = true;
    drawCropEd();
    const est = _ceAutoAngle();
    autoCropAngle();
    return { est, ang: +cropEdState.ang };
  });
  expect(r.est.confident).toBe(true);
  expect(Math.abs(r.est.angle - 7)).toBeLessThanOrEqual(0.5);
  expect(r.ang).toBeCloseTo(r.est.angle, 5);
  expect(errors).toEqual([]);
});

test('Auto: declines on a featureless field instead of picking a random angle', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  `);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    cropEdState.cx = 0.1; cropEdState.cy = 0.1; cropEdState.cw = 0.8; cropEdState.ch = 0.8; cropEdState.hasBox = true;
    setCropAngle(4);
    const est = _ceAutoAngle();
    autoCropAngle();
    return { confident: est.confident, ang: +cropEdState.ang };
  });
  expect(r.confident).toBe(false);
  expect(r.ang).toBeCloseTo(4, 5);                              // untouched
  expect(errors).toEqual([]);
});

// ── Ratio lock and exact pixels ───────────────────────────────

test('ratio lock: a drawn box keeps the ratio in pixels, and the lock conforms an existing box', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 400, 200, `ctx.fillStyle='#888'; ctx.fillRect(0,0,W,H);`);   // 2:1 image
  await page.evaluate(CE_FIRE);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.getElementById('crop-ed-canvas');
    setCropAspect('1:1');
    // Draw from (10%,10%) to (40%,90%): the width rules, the height follows.
    _ceFire('mousedown', c.width * 0.10, c.height * 0.10);
    _ceFire('mousemove', c.width * 0.40, c.height * 0.90);
    _ceFire('mouseup',   c.width * 0.40, c.height * 0.90);
    const drawn = { wPx: cropEdState.cw * c.width, hPx: cropEdState.ch * c.height, cw: cropEdState.cw, ch: cropEdState.ch };
    // Now free it, make it deliberately non-square, then lock 4:3: the box conforms.
    setCropAspect('free');
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.3; cropEdState.ch = 0.7; cropEdState.hasBox = true;
    setCropAspect('4:3');
    const conformed = { ratio: (cropEdState.cw * c.width) / (cropEdState.ch * c.height), key: cropEdState.aspectKey,
                        sel: document.getElementById('crop-aspect').value };
    return { drawn, conformed, W: c.width, H: c.height };
  });
  expect(r.drawn.wPx / r.drawn.hPx).toBeCloseTo(1, 2);          // square in pixels…
  expect(r.drawn.cw / r.drawn.ch).toBeCloseTo(0.5, 2);          // …which on a 2:1 image is not square in normalised units
  expect(r.drawn.cw).toBeCloseTo(0.3, 2);                       // the dragged width was kept
  expect(r.conformed.ratio).toBeCloseTo(4 / 3, 2);
  expect(r.conformed.key).toBe('4:3');
  expect(r.conformed.sel).toBe('4:3');
  expect(errors).toEqual([]);
});

test('exact pixels: the fields read the crop in source pixels and typing one moves the box', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 800, 600, `ctx.fillStyle='#888'; ctx.fillRect(0,0,W,H);`);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    cropEdState.cx = 0.25; cropEdState.cy = 0.5; cropEdState.cw = 0.5; cropEdState.ch = 0.25; cropEdState.hasBox = true;
    drawCropEd();
    const read = ['x', 'y', 'w', 'h'].map(k => document.getElementById('crop-px-' + k).value);
    setCropPx('w', 400); setCropPx('h', 300); setCropPx('x', 100); setCropPx('y', 50);
    const box = [cropEdState.cx, cropEdState.cy, cropEdState.cw, cropEdState.ch];
    setCropPx('w', 5000);                                         // clamped to the image
    const clampedW = cropEdState.cw;
    return { read, box, clampedW };
  });
  expect(r.read).toEqual(['200', '300', '400', '150']);
  expect(r.box.map(v => +v.toFixed(4))).toEqual([0.125, 0.0833, 0.5, 0.5]);
  expect(r.clampedW).toBeCloseTo(1 - 0.125, 5);
  expect(errors).toEqual([]);
});

test('ratio lock and the size fields are disabled while batch crop pins the size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    startBatchCrop();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = document.getElementById('crop-px-w').disabled;
    cropEdState.cx = 0.3; cropEdState.cy = 0.3; cropEdState.cw = 0.4; cropEdState.ch = 0.4; cropEdState.hasBox = true;
    applyCropModal();                                             // pins the size, advances
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const after = ['crop-px-w', 'crop-px-h', 'crop-aspect'].map(id => document.getElementById(id).disabled);
    const cwBefore = cropEdState.cw;
    setCropPx('w', 10);                                           // must be ignored
    const cwAfter = cropEdState.cw;
    closeCropModal();
    return { before, after, cwBefore, cwAfter };
  });
  expect(r.before).toBe(false);
  expect(r.after).toEqual([true, true, true]);
  expect(r.cwAfter).toBe(r.cwBefore);
  expect(errors).toEqual([]);
});

test('Auto: an off-centre box straddling a large dark/light edge still finds the true tilt', async ({ page }) => {
  const errors = await loadApp(page);
  // A whole gel turned by 6° on a light bench, with lanes and bands. The first
  // scoring (variance of the profile means) was fooled by a box that straddled the
  // gel's corner: the dark/light step grew with the angle and the search ran off the
  // −20° end, confidently. The difference-energy score peaks at 6° for the same box.
  await seedPainted(page, 2400, 1600, `
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W/2, H/2); ctx.rotate(6 * Math.PI / 180);
    ctx.fillStyle = '#2a2622'; ctx.fillRect(-900, -500, 1800, 1000);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = '#4a4440'; ctx.fillRect(-820 + i * 220, -440, 160, 880); }
    for (let i = 0; i < 8; i++) { ctx.fillStyle = '#d8d0c0'; ctx.fillRect(-820 + i * 220, -200 + (i % 3) * 90, 160, 26); }
    ctx.restore();
  `);
  const r = await page.evaluate(async () => {
    openCropModal(0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    cropEdState.cx = 0.15; cropEdState.cy = 0.18; cropEdState.cw = 0.71; cropEdState.ch = 0.64; cropEdState.hasBox = true;
    drawCropEd();
    return _ceAutoAngle();
  });
  expect(r.confident).toBe(true);
  expect(r.atEdge).toBe(false);
  expect(Math.abs(r.angle - 6)).toBeLessThanOrEqual(0.5);      // was −20.5
  expect(r.score).toBeGreaterThan(r.mean * 3);                 // a peak, not a shoulder
  expect(errors).toEqual([]);
});
