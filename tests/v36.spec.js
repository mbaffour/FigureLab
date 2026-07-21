// @ts-check
// Tests for the v3.6+ feature work (charts, flowcharts, assets).
// Phase 0: freeform render & export fidelity.
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform, seedPanels } = require('./helpers');

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

// ── Phase 1a: icon library ──

test('icon library is large, grouped, and every source is valid single-colour SVG', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const entries = Object.entries(SCIENCE_ICONS);
    const bad = [], offColour = [], ungrouped = [];
    for (const [k, ic] of entries) {
      const doc = new DOMParser().parseFromString(ic.svg, 'image/svg+xml');
      if (doc.querySelector('parsererror')) bad.push(k);
      // Every literal colour in the source must be the sentinel, or recolour breaks.
      const hexes = ic.svg.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      if (hexes.some(h => h.toLowerCase() !== '#222222')) offColour.push(k + ':' + hexes.join(','));
      if (!ic.group || !ICON_GROUPS[ic.group]) ungrouped.push(k);
    }
    return {
      count: entries.length, bad, offColour, ungrouped,
      groups: [...new Set(entries.map(([, ic]) => ic.group))].sort(),
    };
  });
  expect(r.count).toBeGreaterThanOrEqual(40);
  expect(r.bad).toEqual([]);
  expect(r.offColour).toEqual([]);
  expect(r.ungrouped).toEqual([]);
  expect(r.groups).toEqual(['cell', 'labware', 'marks', 'molecule', 'organism']);
  expect(errors).toEqual([]);
});

test('icon palette groups when browsing and filters when searching', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const pal = document.getElementById('icon-palette');
    renderIconPalette('');
    const browsing = {
      groupLabels: pal.querySelectorAll('.icon-group-lbl').length,
      buttons: pal.querySelectorAll('.icon-btn-sci').length,
    };
    renderIconPalette('mouse');
    const hits = [...pal.querySelectorAll('.icon-btn-sci')].map(b => b.dataset.icon);
    renderIconPalette('zzzznope');
    const empty = pal.querySelectorAll('.icon-btn-sci').length;
    return { browsing, hits, empty };
  });
  expect(r.browsing.groupLabels).toBe(5);
  expect(r.browsing.buttons).toBeGreaterThanOrEqual(40);
  expect(r.hits).toContain('mouse');
  expect(r.hits.length).toBeLessThan(r.browsing.buttons);   // actually filtered
  expect(r.empty).toBe(0);                                   // no matches → no buttons
  expect(errors).toEqual([]);
});

test('icon recolour works from the pristine source and round-trips', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => insertIcon('cell'));
  await page.waitForFunction(() => freeformElements.length === 1 && freeformElements[0].isIcon);
  const r = await page.evaluate(async () => {
    const wait = () => new Promise(res => setTimeout(res, 60));
    const el = freeformElements[0];
    const pristine = el.iconSrc0;
    recolorIcon('#ff0000'); await wait();
    const red = el.svgSource, redColor = el.iconColor;
    recolorIcon('#00ff00'); await wait();
    const green = el.svgSource;
    recolorIcon('#222222'); await wait();
    return {
      hasPristine: !!pristine, pristine,
      redHasRed: red.includes('#ff0000'), redColor,
      greenHasRed: green.includes('#ff0000'),   // must not compound
      greenHasGreen: green.includes('#00ff00'),
      backToPristine: el.svgSource === pristine,
    };
  });
  expect(r.hasPristine).toBe(true);
  expect(r.redHasRed).toBe(true);
  expect(r.redColor).toBe('#ff0000');
  expect(r.greenHasRed).toBe(false);        // recoloured from pristine, not from red
  expect(r.greenHasGreen).toBe(true);
  expect(r.backToPristine).toBe(true);      // sentinel round-trip is exact
  expect(errors).toEqual([]);
});

// ── Phase 1b: built-in themes ──

test('built-in theme applies the house-style layer and undoes in one step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('bg-color', '#123456'); sv('label-color', '#abcdef'); sc('axis-auto-color', true);
    render();
    const before = { bg: gv('bg-color'), label: gv('label-color'), auto: gc('axis-auto-color') };
    const undoLen = undoStack.length;
    applyBuiltinTheme('grayscale-print');
    const after = { bg: gv('bg-color'), label: gv('label-color'), auto: gc('axis-auto-color'),
                    sb: gv('sb-color'), border: gv('panel-border-c') };
    const grew = undoStack.length - undoLen;
    undo();
    const restored = { bg: gv('bg-color'), label: gv('label-color'), auto: gc('axis-auto-color') };
    return { before, after, grew, restored, logged: reproLog.some(e => e.action === 'theme') };
  });
  expect(r.after.bg).toBe('#ffffff');
  expect(r.after.label).toBe('#000000');
  expect(r.after.sb).toBe('#000000');
  expect(r.after.auto).toBe(false);        // forced off so the axis really is black
  expect(r.grew).toBe(1);                  // exactly one undo step
  expect(r.restored).toEqual(r.before);
  expect(r.logged).toBe(true);             // recorded in the provenance log
  expect(errors).toEqual([]);
});

test('themes never recolour the user own freeform objects', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'rect', x: 100, y: 100, w: 150, h: 100, color: '#ff0000', fillColor: '#ff0000' },
    { type: 'text', x: 300, y: 100, w: 200, h: 50, text: 'Keep me', color: '#00ff00' },
  ]);
  const r = await page.evaluate(() => {
    applyBuiltinTheme('grayscale-print');
    applyBuiltinTheme('fluorescence');
    return freeformElements.map(e => e.color);
  });
  expect(r).toEqual(['#ff0000', '#00ff00']);
  expect(errors).toEqual([]);
});

test('theme buttons and command-palette entries are wired for every theme', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    renderThemePresets();
    const btns = [...document.querySelectorAll('#theme-presets button')].map(b => b.dataset.theme);
    const cmds = CMD_REGISTRY.filter(c => c.label.startsWith('Theme: ')).length;
    return { btns, keys: Object.keys(BUILTIN_THEMES), cmds };
  });
  expect(r.btns.sort()).toEqual(r.keys.sort());
  expect(r.cmds).toBe(r.keys.length);
  expect(errors).toEqual([]);
});

// ── Phase 1c: non-destructive background removal ──

// Helper: seed a freeform image whose bitmap has a light-grey border and a solid blue centre.
async function seedBorderedImage(page) {
  await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 200, h: 200, iw: 100, ih: 100 }]);
  await page.evaluate(async () => {
    const el = freeformElements[0];
    const c = document.createElement('canvas'); c.width = 100; c.height = 100;
    const x = c.getContext('2d');
    x.fillStyle = '#f0f0f0'; x.fillRect(0, 0, 100, 100);       // light-grey background
    x.fillStyle = '#1030c0'; x.fillRect(30, 30, 40, 40);       // blue subject
    el.src = c.toDataURL('image/png');
    el._imgEl = null;                                          // force rebuild from new src
    await new Promise(res => { const im = new Image(); im.onload = () => { el._imgEl = im; res(); }; im.src = el.src; });
    selectedElems.clear(); selectedElems.add(0);              // so _selectedImageEl() finds it
    render();
  });
}

test('background key is tolerance-driven and non-destructive', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBorderedImage(page);
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    const srcBefore = el.src;
    // Alpha at the object's rendered corner (over the grey background) and centre (over blue).
    const alphaAt = (fx, fy) => {
      const c = document.getElementById('fig-canvas');
      const px = Math.round(fx * c.width / (canvasLogicalW || c.width));
      const py = Math.round(fy * c.height / (canvasLogicalH || c.height));
      return c.getContext('2d').getImageData(px, py, 1, 1).data[3];
    };
    // The freeform canvas is opaque (bg fill), so read alpha off the adjust cache instead.
    const cornerAlpha = () => {
      const cache = el._adjCache; if (!cache) return null;
      return cache.getContext('2d').getImageData(2, 2, 1, 1).data[3];             // grey border
    };
    const centreAlpha = () => el._adjCache.getContext('2d').getImageData(50, 50, 1, 1).data[3]; // blue

    toggleBgRemove(true);
    el.bgKey.mode = 'white'; el.bgKey.tol = 8; render();
    const tolLow = { corner: cornerAlpha(), centre: centreAlpha() };   // #f0f0f0 dist 15 > 8: kept
    el.bgKey.tol = 40; render();
    const tolHigh = { corner: cornerAlpha(), centre: centreAlpha() };  // dist 15 <= 40: cleared
    toggleBgRemove(false); render();
    const off = { hasCache: !!el._adjCache };

    return { srcBefore, srcAfter: el.src, tolLow, tolHigh, off,
             logged: reproLog.some(e => e.action === 'bgRemove') };
  });
  expect(r.tolLow.corner).toBe(255);      // grey border stays opaque at low tolerance
  expect(r.tolLow.centre).toBe(255);      // subject always opaque
  expect(r.tolHigh.corner).toBe(0);       // grey border removed once tolerance covers it
  expect(r.tolHigh.centre).toBe(255);     // subject untouched
  expect(r.srcAfter).toBe(r.srcBefore);   // el.src byte-identical throughout — non-destructive
  expect(r.logged).toBe(true);
  expect(errors).toEqual([]);
});

test('background removal survives a session round-trip and undo', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBorderedImage(page);
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    const undoLen = undoStack.length;
    toggleBgRemove(true);
    el.bgKey.tol = 44; render();
    const ser = serializeSession(true).freeformElements[0];
    undo();                                         // toggleBgRemove pushed one undo frame
    return {
      serOn: ser.bgKey && ser.bgKey.on, serTol: ser.bgKey && ser.bgKey.tol,
      afterUndo: freeformElements[0].bgKey ? !!freeformElements[0].bgKey.on : false,
      grew: undoStack.length - (undoLen - 0) >= 0,
    };
  });
  expect(r.serOn).toBe(true);
  expect(r.serTol).toBe(44);
  expect(r.afterUndo).toBe(false);        // undo turns removal back off
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
