// @ts-check
// Cross-feature integration: the features shipped separately have to work TOGETHER.
// In particular multi-crop (added by a later PR, with no tests of its own) sets the
// same crop fields that the raw-measurement mapping, the scale bar and the duplicate
// check all depend on.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');
const fs = require('fs'), path = require('path');

const RAWFX = path.join(__dirname, 'fixtures', 'tiff');
const man = JSON.parse(fs.readFileSync(path.join(RAWFX, 'raw_manifest.json'), 'utf8'));
const tifBytes = (n) => Array.from(fs.readFileSync(path.join(RAWFX, n + '.tif')));

async function seedRaw(page, name) {
  await page.evaluate(async (bytes) => {
    const res = await decodeTIFF(new Uint8Array(bytes));
    const c = document.createElement('canvas'); c.width = res.width; c.height = res.height;
    c.getContext('2d').putImageData(new ImageData(res.rgba, res.width, res.height), 0, 0);
    const src = c.toDataURL('image/png');
    await new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => { _commitImage(img, src, 'raw.tif', null, { umPerPx: 0.5, source: 'test' }, res.raw); ok(); };
      img.onerror = no; img.src = src;
    });
    render();
  }, tifBytes(name));
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
}

test('a multi-cropped panel still measures its RAW pixels, and the right ones', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRaw(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    // multi-crop the single panel down to its right half
    startMultiCrop([0]);
    cropEdState.cx = 0.5; cropEdState.cy = 0; cropEdState.cw = 0.5; cropEdState.ch = 1;
    mcAddRegion(); mcDoneSource();
    return { cropL: images[0].cropL, cropR: images[0].cropR, hasRaw: !!(images[0].raw && images[0].raw.data) };
  });
  expect(r.hasRaw).toBe(true);              // multi-crop must carry im.raw to the new panel
  expect(r.cropL).toBe(50);
  expect(r.cropR).toBe(0);

  const m = await page.evaluate(() => {
    render();
    const map = _panelSourceMap(panelBounds[0], images[0]);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    measureAndShowROI(ctx, map.dx, map.dy, map.dw, map.dh);   // the whole visible panel
    const last = measurements[measurements.length - 1];
    return { source: last.source, rawMean: parseFloat(last.rawMean), sx: map.sx, sw: map.sw };
  });
  // the fixture is value = 1000 + 100*x over 64 columns; the right half is cols 32..63
  expect(m.source).toBe('raw 16-bit');
  expect(m.sx).toBeCloseTo(32, 0);
  expect(m.rawMean).toBeCloseTo(man.raw16_gradient.meanRightHalf, 0);   // 5750, not 4150
});

/** Seed one panel of deterministic, textured content — what a micrograph looks like. */
async function seedTextured(page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 240;
    const x = c.getContext('2d');
    x.fillStyle = '#111'; x.fillRect(0, 0, 240, 240);
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let i = 0; i < 160; i++) {
      x.fillStyle = 'rgb(' + (70 + rnd() * 185 | 0) + ',' + (70 + rnd() * 185 | 0) + ',90)';
      x.beginPath(); x.arc(rnd() * 240, rnd() * 240, 3 + rnd() * 9, 0, 6.284); x.fill();
    }
    const src = c.toDataURL('image/png');
    await new Promise(ok => { const i = new Image(); i.onload = () => { _commitImage(i, src, 'tex.png'); ok(); }; i.src = src; });
    render();
  });
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
}

test('two non-overlapping crops of one image are NOT called duplicates', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTextured(page);
  const r = await page.evaluate(() => {
    startMultiCrop([0]);
    cropEdState.cx = 0.00; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    cropEdState.cx = 0.55; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    mcDoneSource(); render();
    const s = _panelSimilarityScan();
    return { panels: images.filter(Boolean).length, hits: s.hits.length, compared: s.compared };
  });
  // different fields of view from one acquisition are legitimate, not a reuse
  expect(r.panels).toBe(2);
  expect(r.compared).toBe(2);
  expect(r.hits).toBe(0);
  expect(errors).toEqual([]);
});

test('adding the same region twice by mistake IS called a duplicate', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTextured(page);
  const r = await page.evaluate(() => {
    // the realistic multi-crop slip: the same region added twice
    startMultiCrop([0]);
    cropEdState.cx = 0.10; cropEdState.cy = 0.10; cropEdState.cw = 0.5; cropEdState.ch = 0.5; mcAddRegion();
    cropEdState.cx = 0.10; cropEdState.cy = 0.10; cropEdState.cw = 0.5; cropEdState.ch = 0.5; mcAddRegion();
    mcDoneSource(); render();
    const s = _panelSimilarityScan();
    return { hits: s.hits.length, score: s.hits[0] && s.hits[0].score, compared: s.compared };
  });
  expect(r.compared).toBe(2);
  expect(r.hits).toBe(1);
  expect(r.score).toBeGreaterThan(0.99);
  expect(errors).toEqual([]);
});

test('a shifted re-crop — once the documented limit — is now caught at region level', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTextured(page);
  const r = await page.evaluate(() => {
    // Same source, regions offset by ~1% of the image. The WHOLE-panel check compares
    // panels as displayed, so this shifted re-crop can fall under its threshold — that
    // used to be the report's documented limitation. The region-level scan anchors its
    // patches to content keypoints, which land on the same pixels wherever the crop
    // window sits, so exactly this case is what it exists to catch.
    startMultiCrop([0]);
    cropEdState.cx = 0.10; cropEdState.cy = 0.10; cropEdState.cw = 0.5; cropEdState.ch = 0.5; mcAddRegion();
    cropEdState.cx = 0.11; cropEdState.cy = 0.11; cropEdState.cw = 0.5; cropEdState.ch = 0.5; mcAddRegion();
    mcDoneSource(); render();
    const s = _panelSimilarityScan();
    const rr = _regionDupScan();
    runDuplicateScan();
    const all = document.querySelectorAll('.modal-bg');
    const txt = all.length ? all[all.length - 1].innerText : '';
    if (all.length) all[all.length - 1].remove();
    return { compared: s.compared, regionHits: rr.regions.length,
             tf: rr.regions[0] && rr.regions[0].tf, txt };
  });
  expect(r.compared).toBe(2);                    // whole-panel genuinely compared them
  expect(r.regionHits).toBeGreaterThanOrEqual(1);// and the region scan finds the reuse
  expect(r.tf).toBe('as-is');
  // The remaining honest limits must still be stated: rescaling, and flat background.
  expect(r.txt).toMatch(/rescaled far from the original size/i);
  expect(r.txt).toMatch(/blank background is not findable/i);
  expect(errors).toEqual([]);
});

test('a smooth gradient is reported as not-compared, never as a clean pass', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRaw(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    // Two near-identical crops of a pure intensity ramp. Cross-correlation is invariant
    // to offset and gain, so ANY two slices of a ramp correlate ~1.0 — the comparison
    // carries no information either way. The panels must therefore be excluded and the
    // user told, rather than passed as "no duplicates found".
    startMultiCrop([0]);
    cropEdState.cx = 0.10; cropEdState.cy = 0.10; cropEdState.cw = 0.5; cropEdState.ch = 0.5; mcAddRegion();
    cropEdState.cx = 0.11; cropEdState.cy = 0.11; cropEdState.cw = 0.5; cropEdState.ch = 0.5; mcAddRegion();
    mcDoneSource(); render();
    const s = _panelSimilarityScan();
    runDuplicateScan();
    const all = document.querySelectorAll('.modal-bg');
    const txt = all.length ? all[all.length - 1].innerText : '';
    if (all.length) all[all.length - 1].remove();
    return { compared: s.compared, skipped: s.skipped.length, hits: s.hits.length, txt };
  });
  expect(r.compared).toBe(0);           // nothing was comparable
  expect(r.skipped).toBe(2);            // and both panels are accounted for
  expect(r.hits).toBe(0);
  expect(r.txt).toMatch(/too uniform|comparable|detail/i);   // the user is told
  expect(errors).toEqual([]);
});

test('a multi-cropped panel exports a PDF whose text is still real text', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRaw(page, 'raw16_gradient');
  const r = await page.evaluate(async () => {
    startMultiCrop([0]);
    cropEdState.cx = 0.0; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    cropEdState.cx = 0.55; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    mcDoneSource();
    sv('show-labels', true); sv('label-format', 'ABC'); render();
    let cap = null; const real = window.dl;
    window.dl = (u) => { cap = u; };
    try {
      await _exportPDFWithText('t', 300, { lossless: true });
      const u8 = new Uint8Array(await (await fetch(cap)).arrayBuffer());
      let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return { len: u8.length, hasFont: s.includes('/BaseFont /Helvetica'), a: s.includes('(A) Tj'), b: s.includes('(B) Tj') };
    } finally { window.dl = real; }
  });
  expect(r.hasFont).toBe(true);
  expect(r.a).toBe(true);
  expect(r.b).toBe(true);
  expect(errors).toEqual([]);
});

test('the scale bar on a multi-cropped panel reflects the new magnification', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRaw(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    images[0].sbOn = true; images[0].sbUm = 5; images[0].sbUnit = 'um';
    sv('sb-text', true); render();
    const full = _sbBars[0] ? _sbBars[0].right - _sbBars[0].left : 0;
    const fullScale = _sbBars[0] ? _sbBars[0].scale : 0;
    startMultiCrop([0]);
    cropEdState.cx = 0.25; cropEdState.cy = 0.25; cropEdState.cw = 0.5; cropEdState.ch = 0.5;
    mcAddRegion(); mcDoneSource();
    images[0].sbOn = true; images[0].sbUm = 5; images[0].sbUnit = 'um';
    render();
    const half = _sbBars[0] ? _sbBars[0].right - _sbBars[0].left : 0;
    const halfScale = _sbBars[0] ? _sbBars[0].scale : 0;
    return { full, half, fullScale, halfScale };
  });
  // cropping to half the width doubles the magnification in the same panel cell,
  // so a bar of the same physical length must be drawn about twice as long
  expect(r.full).toBeGreaterThan(0);
  expect(r.halfScale / r.fullScale).toBeGreaterThan(1.5);
  expect(r.half / r.full).toBeGreaterThan(1.5);
  expect(errors).toEqual([]);
});

test('multi-crop is one undo step, and undo restores the original panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRaw(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const before = { n: images.filter(Boolean).length, cropL: images[0].cropL };
    startMultiCrop([0]);
    cropEdState.cx = 0.0; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    cropEdState.cx = 0.55; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    mcDoneSource();
    const after = { n: images.filter(Boolean).length, cropL: images[0].cropL };
    undo();
    const undone = { n: images.filter(Boolean).length, cropL: images[0] ? images[0].cropL : null,
                     hasRaw: !!(images[0] && images[0].raw) };
    return { before, after, undone };
  });
  expect(r.after.n).toBe(2);
  expect(r.undone.n).toBe(r.before.n);          // a single undo, not one per region
  expect(r.undone.cropL).toBe(r.before.cropL);
  expect(errors).toEqual([]);
});
