// @ts-check
// Regressions for the defects found by the whole-app audit (v3.9.1).
// Each test reproduces the ORIGINAL failure, so a revert fails loudly rather
// than quietly restoring a wrong number to a figure.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');
const fs = require('fs'), path = require('path');

const RAWFX = path.join(__dirname, 'fixtures', 'tiff');
const tifBytes = (name) => Array.from(fs.readFileSync(path.join(RAWFX, name + '.tif')));

/** Import a fixture TIFF through _commitImage with its decoded native samples. */
async function seedRawPanel(page, name) {
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

// ── Raw measurements must only ever read pixels that are in the figure ──────────

test('an ROI over the letterbox never reports raw values from cropped-away pixels', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    // Keep only the left half of a left-to-right gradient. The right of the panel cell
    // is now blank background, but it is still inside panelBounds.
    images[0].cropR = 50;
    render();
    const pb = panelBounds[0];
    const map = _panelSourceMap(pb, images[0]);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    const gap = (pb.x + pb.w) - (map.dx + map.dw);
    measureAndShowROI(ctx, map.dx + map.dw + 4, map.dy + 5, Math.max(6, gap - 8), 20);
    const m = measurements[measurements.length - 1];
    return { source: m.source, gap, html: document.getElementById('roi-results').innerHTML };
  });
  expect(r.gap).toBeGreaterThan(10);          // there really is a letterbox to click on
  expect(r.source).toBe('8-bit display');     // NOT "raw 16-bit" — the fabricated reading
  expect(r.html).not.toContain('Raw mean');
  expect(errors).toEqual([]);
});

test('an ROI spilling past a cropped edge measures only the visible pixels, and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    images[0].cropR = 50;
    render();
    const map = _panelSourceMap(panelBounds[0], images[0]);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    measureAndShowROI(ctx, map.dx + map.dw - 10, map.dy + 4, 40, 16);
    return { source: measurements[measurements.length - 1].source,
             html: document.getElementById('roi-results').innerHTML };
  });
  expect(r.source).toBe('raw 16-bit');
  expect(r.html).toContain('extended past the panel image');
  expect(errors).toEqual([]);
});

test('a line profile leaving the panel image falls back instead of reading edge pixels', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    images[0].cropR = 50;
    render();
    const pb = panelBounds[0], map = _panelSourceMap(pb, images[0]);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    const midY = map.dy + Math.round(map.dh / 2);
    measureAndShowLineProfile(ctx, map.dx + 2, midY, pb.x + pb.w - 2, midY);   // runs off the image
    const off = measurements[measurements.length - 1].source;
    measureAndShowLineProfile(ctx, map.dx, midY, map.dx + map.dw, midY);       // fully on it
    const on = measurements[measurements.length - 1].source;
    return { off, on };
  });
  expect(r.off).toBe('8-bit display');
  expect(r.on).toBe('raw 16-bit');            // the in-bounds case still uses raw
  expect(errors).toEqual([]);
});

test('um2 is withheld when the panel cannot be mapped back to source pixels', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    const map = _panelSourceMap(panelBounds[0], images[0]);
    measureAndShowROI(ctx, map.dx + 2, map.dy + 2, 20, 20);
    const okUm = measurements[measurements.length - 1].areaUm;
    images[0].cropShape = 'circle'; render();   // a shaped crop has no exact rect inverse
    measureAndShowROI(ctx, panelBounds[0].x + 20, panelBounds[0].y + 20, 20, 20);
    return { okUm, badUm: measurements[measurements.length - 1].areaUm,
             html: document.getElementById('roi-results').innerHTML };
  });
  expect(r.okUm).toBeTruthy();                 // a normal panel still reports um2
  expect(r.badUm).toBeFalsy();                 // a shaped crop must NOT invent one
  expect(r.html).toContain('unavailable');
  expect(errors).toEqual([]);
});

test('exposure analysis measures the cropped panel, not the whole sensor frame', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_saturated');
  const r = await page.evaluate(() => {
    const pct = () => {
      runExposureAnalysis();
      const t = document.body.innerText;
      const m = /Raw \([^)]+\): ([\d.]+)% of pixels saturated/.exec(t);
      document.querySelectorAll('.modal-bg').forEach(x => x.remove());
      return m ? parseFloat(m[1]) : null;
    };
    const whole = pct();
    images[0].cropL = 60; images[0].cropT = 60; render();
    return { whole, cropped: pct() };
  });
  expect(r.whole).toBeGreaterThan(0);          // the full frame really is saturated
  expect(r.cropped).toBeLessThan(r.whole);     // cropping it away must change the verdict
  expect(errors).toEqual([]);
});

// ── Scale bars, channel merges and imports must describe the real data ──────────

test('a cropped freeform panel draws its scale bar at the true magnification', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    setLayoutMode('freeform');
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    const cx = c.getContext('2d'); cx.fillStyle = '#888'; cx.fillRect(0, 0, 400, 200);
    const src = c.toDataURL('image/png');
    await new Promise(ok => { const i = new Image(); i.onload = ok; i.src = src; });
    addFreeformElement({ type: 'image', src, x: 50, y: 50, w: 400, h: 200,
      umPerPx: 0.5, sbUm: 20, sbOn: true, sbUnit: 'um',
      cropT: 0, cropL: 0, cropB: 0, cropR: 0, brightness: 1, contrast: 1 });
    const el = freeformElements[freeformElements.length - 1];
    render();
    const a = _sbBars[_sbBars.length - 1];
    const wideBar = a.right - a.left;
    el.cropL = 25; el.cropR = 25;              // half the width cropped away
    render();
    const b = _sbBars[_sbBars.length - 1];
    return { wideBar, cropBar: b.right - b.left };
  });
  // el.w is unchanged but only half the source is shown, so magnification doubles and a
  // bar of the same physical length must be drawn twice as long.
  expect(r.wideBar).toBeGreaterThan(0);
  expect(r.cropBar / r.wideBar).toBeCloseTo(2, 1);
  expect(errors).toEqual([]);
});

test('channel merges honour the panel crop, so channels stay registered', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const mk = (paint) => new Promise(ok => {
      const c = document.createElement('canvas'); c.width = 100; c.height = 100;
      paint(c.getContext('2d'));
      const i = new Image(); i.onload = () => ok(i); i.src = c.toDataURL('image/png');
    });
    // Base is uniformly dark, so it cannot mask where the channel lands (screen
    // blending only ever brightens). The channel's signal is confined to its RIGHT
    // half — exactly the region we then crop to.
    const base = await mk(x => { x.fillStyle = '#000'; x.fillRect(0, 0, 100, 100); });
    const chan = await mk(x => { x.fillStyle = '#000'; x.fillRect(0, 0, 100, 100);
                                 x.fillStyle = '#fff'; x.fillRect(50, 0, 50, 100); });
    const im = { img: base, brightness: 1, contrast: 1, cropT: 0, cropL: 50, cropB: 0, cropR: 0,
                 blackPt: 0, whitePt: 255, grayscale: false, invert: false, lut: 'none', gamma: 1,
                 channels: [{ img: chan, lut: 'green', blackPt: 0, whitePt: 255 }] };
    const out = applyComposite(im, 50, 0, 50, 100);   // crop to the channel's bright half
    const d = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
    let dark = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { n++; if (d[i] + d[i + 1] + d[i + 2] < 60) dark++; }
    return { darkFrac: dark / n };
  });
  // Cropping to the channel's bright half must show signal across the whole panel.
  // Before the fix the channel was drawn from its FULL frame squashed into the cropped
  // rect, so its dark left half covered half the panel — displacing every structure
  // relative to the base and fabricating colocalisation.
  expect(r.darkFrac).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test('a GenBank feature crossing the origin becomes two arcs, not the whole plasmid', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const gb = [
      'LOCUS       pWrap                   2686 bp    DNA     circular SYN 01-JAN-2026',
      'FEATURES             Location/Qualifiers',
      '     CDS             complement(join(2600..2686,1..100))',
      '                     /label="wrapORF"',
      '     CDS             join(300..400,500..600)',
      '                     /label="exonJoin"',
      '     promoter        150..200',
      '                     /label="P1"',
      'ORIGIN',
      '//',
    ].join('\n');
    const p = _parseGenBank(gb);
    return { length: p.length, topology: p.topology, wrapped: p.wrapped, joined: p.joined,
             feats: p.features.map(f => f.name + ':' + f.start + '-' + f.end + ':' + f.strand) };
  });
  expect(r.length).toBe(2686);
  expect(r.topology).toBe('circular');
  expect(r.wrapped).toBe(1);
  // the wrapping ORF is split at the origin, keeping name and strand on both arcs
  expect(r.feats).toContain('wrapORF:2600-2686:-1');
  expect(r.feats).toContain('wrapORF:1-100:-1');
  // and it is NOT the old inflated envelope covering the entire molecule
  expect(r.feats).not.toContain('wrapORF:1-2686:-1');
  // a plain multi-exon join still collapses to its span, and is disclosed
  expect(r.feats).toContain('exonJoin:300-600:1');
  expect(r.joined).toBe(1);
  expect(errors).toEqual([]);
});

// ── Duplicating a composite element must not brick the canvas ───────────────────

test('duplicating a gene map or chart does not break rendering', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    setLayoutMode('freeform');
    addGenemapElement('linear'); closeGenemapModal();
    addChartElement(); if (typeof closeChartModal === 'function') closeChartModal();
    render();                                   // populates the raster proxies
    const before = freeformElements.length;
    selectedElems.clear();
    freeformElements.forEach((_, i) => selectedElems.add(i));
    duplicateSelectedElems();
    const added = freeformElements.length - before;
    let threw = null;
    try { render(); render(); } catch (e) { threw = e.message; }
    return { threw, added };
  });
  expect(r.threw).toBeNull();                   // was: "cv.getContext is not a function"
  expect(r.added).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
