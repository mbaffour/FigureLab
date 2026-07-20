// @ts-check
// Tests for the v3.6+ feature work (charts, flowcharts, assets).
// Phase 0: freeform render & export fidelity.
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform } = require('./helpers');

// Default freeform canvas is 1200x900; 600 DPI => scale 6.25 => 7500x5625 (42.2 MP, under the cap).
test('freeform export supersamples to the target DPI', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 100, y: 100, w: 300, h: 300, iw: 120, ih: 120 },
    { type: 'text', x: 500, y: 120, w: 260, h: 60, text: 'Panel A', fontSize: 24 },
  ]);
  const r = await page.evaluate(() => {
    const off = renderExportCanvas(600);
    return { w: off.width, h: off.height, logicalW: canvasLogicalW, logicalH: canvasLogicalH };
  });
  expect(r.logicalW).toBe(1200);
  expect(r.logicalH).toBe(900);
  expect(r.w).toBe(Math.round(1200 * 6.25));   // 7500 — was stuck at 1200 before Phase 0
  expect(r.h).toBe(Math.round(900 * 6.25));
  expect(errors).toEqual([]);
});

test('freeform export leaves on-screen state untouched', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 60, y: 60, w: 240, h: 240, iw: 100, ih: 100, sbOn: true, umPerPx: 0.5, sbUm: 20, sbUnit: 'µm' },
  ]);
  const before = await page.evaluate(() => ({
    ann: document.getElementById('ann-canvas').width,
    annH: document.getElementById('ann-canvas').height,
    logicalW: canvasLogicalW, logicalH: canvasLogicalH,
    bounds: panelBounds.length, bars: _sbBars.length,
  }));
  await page.evaluate(() => { renderExportCanvas(600); });
  const after = await page.evaluate(() => ({
    ann: document.getElementById('ann-canvas').width,
    annH: document.getElementById('ann-canvas').height,
    logicalW: canvasLogicalW, logicalH: canvasLogicalH,
    bounds: panelBounds.length, bars: _sbBars.length,
  }));
  expect(after).toEqual(before);          // no clobbered overlay, no duplicated panelBounds/_sbBars
  expect(before.bars).toBe(1);            // the scale bar is still hit-testable for drag-resize
  expect(errors).toEqual([]);
});

test('freeform export honours the ~60MP cap', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'rect', x: 100, y: 100, w: 400, h: 300 }]);
  const r = await page.evaluate(() => {
    document.getElementById('fm-canvas-w').value = '2000';
    document.getElementById('fm-canvas-h').value = '1500';
    render();
    const off = renderExportCanvas(1200);          // would be 468 MP uncapped
    return { px: off.width * off.height, w: off.width };
  });
  expect(r.px).toBeLessThanOrEqual(60e6);
  expect(r.w).toBeGreaterThan(2000);               // still supersampled, just clamped
  expect(errors).toEqual([]);
});

test('freeform PNG export produces a high-resolution file', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 400, h: 400, iw: 150, ih: 150 }]);
  const r = await page.evaluate(async () => {
    document.getElementById('export-dpi').value = '300';
    const cap = await _captureDownload(() => doExport('png'));
    if (!cap || !cap.data) return null;
    // PNG: 8-byte signature, then IHDR length(4) + type(4), so width is at byte 16 (big-endian).
    const d = cap.data, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const sig = [...d.slice(0, 4)].join(',');
    return { sig, width: dv.getUint32(16), height: dv.getUint32(20), name: cap.name };
  });
  expect(r).not.toBeNull();
  expect(r.sig).toBe('137,80,78,71');              // real PNG signature
  expect(r.width).toBe(Math.round(1200 * 300 / 96));   // 3750 — was 1200 before Phase 0
  expect(r.height).toBe(Math.round(900 * 300 / 96));   // 2812
  expect(errors).toEqual([]);
});

test('freeform text wraps identically at preview and export scale', async ({ page }) => {
  const errors = await loadApp(page);
  // Long enough to wrap several times inside w:300 at 20px.
  await seedFreeform(page, [{
    type: 'text', x: 40, y: 40, w: 300, h: 400, fontSize: 20, color: '#000000',
    text: 'Fluorescence intensity was quantified across every treated replicate and normalised',
  }]);
  // Lowest row containing dark ink, in logical units, at S=1 and S=4.
  const inkBottom = await page.evaluate(() => {
    const measure = (canvas, S) => {
      const ctx = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let y = h - 1; y >= 0; y--) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) return y / S;
        }
      }
      return -1;
    };
    render();
    const one = measure(document.getElementById('fig-canvas'), 1);
    const off = document.createElement('canvas');
    render(off, 4);
    return { one, four: measure(off, 4) };
  });
  expect(inkBottom.one).toBeGreaterThan(0);
  // A changed wrap would shift the last baseline by a whole line (~26px logical).
  expect(Math.abs(inkBottom.four - inkBottom.one)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('freeform adjustment cache lands on the element and is reused', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 50, w: 200, h: 200, iw: 100, ih: 100, brightness: 1.4, contrast: 1 }]);
  const r = await page.evaluate(() => {
    render();
    const el = freeformElements[0];
    const key1 = el._adjKey;
    if (el._adjCache) el._adjCache.__probe = 'first';   // survives only on a cache hit
    render();
    return { key1, key2: el._adjKey, probe: el._adjCache && el._adjCache.__probe };
  });
  expect(typeof r.key1).toBe('string');
  expect(r.key1.length).toBeGreaterThan(0);
  expect(r.key2).toBe(r.key1);
  expect(r.probe).toBe('first');            // same canvas reused: no per-frame per-pixel pass
  expect(errors).toEqual([]);
});

test('an unadjusted freeform image skips the per-pixel pass entirely', async ({ page }) => {
  const errors = await loadApp(page);
  // No brightness/contrast set — addFreeformElement leaves them undefined.
  await seedFreeform(page, [{ type: 'image', x: 50, y: 50, w: 200, h: 200, iw: 100, ih: 100 }]);
  const r = await page.evaluate(() => {
    render();
    const el = freeformElements[0];
    return { key: el._adjKey, cache: !!el._adjCache };
  });
  expect(r.key).toBeUndefined();            // undefined !== 1 no longer forces the slow path
  expect(r.cache).toBe(false);
  expect(errors).toEqual([]);
});

test('freeform adjustment cache does not leak into sessions or undo snapshots', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 50, w: 200, h: 200, iw: 100, ih: 100, brightness: 1.4, contrast: 1 }]);
  const r = await page.evaluate(() => {
    render();
    const ser = serializeSession(true).freeformElements[0];
    const snap = cloneElemForUndo(freeformElements[0]);
    return {
      serKeys: Object.keys(ser).filter(k => k === '_adjCache' || k === '_adjKey' || k === 'img' || k === '_imgEl'),
      snapCache: snap._adjCache, snapKey: snap._adjKey,
      liveKey: typeof freeformElements[0]._adjKey,     // still cached on the live element
    };
  });
  expect(r.serKeys).toEqual([]);
  expect(r.snapCache).toBeUndefined();
  expect(r.snapKey).toBeUndefined();
  expect(r.liveKey).toBe('string');
  expect(errors).toEqual([]);
});
