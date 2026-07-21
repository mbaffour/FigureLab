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

// ── Phase 2: chart element ──

test('CSV parser handles delimiters, quotes, embedded newlines, escapes, BOM, numeric coercion', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => ({
    comma: _parseDelimited('a,b,c\n1,2,3'),
    tab: _parseDelimited('a\tb\n1\t2'),
    semi: _parseDelimited('a;b\n1;2'),
    quotedComma: _parseDelimited('x,y\n"a,b",2'),
    embeddedNL: _parseDelimited('x,y\n"line1\nline2",5'),
    escapedQuote: _parseDelimited('x\n"she said ""hi"""'),
    bom: _parseDelimited('﻿a,b\n1,2'),
    sci: _parseDelimited('v\n1e-3'),
    leadingZero: _parseDelimited('code\n007'),
    floaty: _parseDelimited('v\n3.14'),
  }));
  expect(r.comma.columns).toEqual(['a', 'b', 'c']);
  expect(r.comma.rows[0]).toEqual([1, 2, 3]);
  expect(r.tab.delim).toBe('\t');
  expect(r.tab.rows[0]).toEqual([1, 2]);
  expect(r.semi.delim).toBe(';');
  expect(r.quotedComma.rows[0]).toEqual(['a,b', 2]);       // embedded delimiter preserved
  expect(r.embeddedNL.rows[0][0]).toBe('line1\nline2');    // embedded newline preserved
  expect(r.escapedQuote.rows[0][0]).toBe('she said "hi"'); // "" → "
  expect(r.bom.columns).toEqual(['a', 'b']);               // BOM stripped
  expect(r.sci.rows[0][0]).toBe(0.001);                    // scientific notation coerced
  expect(r.leadingZero.rows[0][0]).toBe(7);                // 007 is numeric here (strict number match)
  expect(r.floaty.rows[0][0]).toBeCloseTo(3.14, 5);
  expect(errors).toEqual([]);
});

test('a dropped CSV creates a chart, not an image panel', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    const csv = 'Group,Value\nCtrl,3\nDrug,7\nWash,5';
    const f = new File([csv], 'data.csv', { type: 'text/csv' });
    addFiles([f]);
    await new Promise(res => setTimeout(res, 120));   // FileReader is async
  });
  await page.waitForFunction(() => freeformElements.some(e => e.type === 'chart'));
  const r = await page.evaluate(() => {
    closeChartModal();
    const ch = freeformElements.find(e => e.type === 'chart');
    return { images: images.length, rows: ch.chart.data.rows.length, cols: ch.chart.data.columns.length,
             source: ch.chart.data.source, logged: reproLog.some(e => e.action === 'chartImport') };
  });
  expect(r.images).toBe(0);            // no failed <img> panel
  expect(r.rows).toBe(3);
  expect(r.cols).toBe(2);
  expect(r.source).toBe('file');
  expect(r.logged).toBe(true);
  expect(errors).toEqual([]);
});

test('SD and SEM match the documented formulae and SEM shrinks the whisker by √n', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];              // mean 5, SD (n−1) = 2.13809, n = 8
    const sd = _sd(data), sem = _sem(data);
    // Build a one-group chart with those replicates and read the drawn whisker half-height.
    const mk = (err) => {
      const el = { type: 'chart', x: 0, y: 0, w: 300, h: 240,
        chart: { kind: 'bar', data: { columns: ['g', 'v'], rows: data.map(v => ['A', v]), source: 't' },
          mapping: { xCol: 0, yCols: [1], seriesCol: null, errCol: null }, agg: 'mean', error: err,
          axes: { x: {}, y: {} }, style: { palette: 'okabeIto' }, annos: [] } };
      return _chartStatsCached(el).groups[0].bars[0].err;
    };
    return { sd, sem, barErrSD: mk('sd'), barErrSEM: mk('sem') };
  });
  expect(r.sd).toBeCloseTo(2.138090, 5);
  expect(r.sem).toBeCloseTo(2.138090 / Math.sqrt(8), 5);
  expect(r.barErrSD).toBeCloseTo(r.sd, 6);
  expect(r.barErrSEM).toBeCloseTo(r.sem, 6);
  expect(r.barErrSD / r.barErrSEM).toBeCloseTo(Math.sqrt(8), 5);   // SEM = SD/√n exactly
  expect(errors).toEqual([]);
});

test('bar chart draws bars in data order with the palette colours', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'chart', x: 40, y: 40, w: 500, h: 400,
    chart: null, label: 'c' }]);
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    el.chart = { kind: 'bar', data: { columns: ['g', 'v'], rows: [['A', 2], ['B', 8]], source: 't' },
      mapping: { xCol: 0, yCols: [1], seriesCol: null, errCol: null }, agg: 'none', error: 'none',
      axes: { x: {}, y: {} }, style: { palette: 'okabeIto', showLegend: false, frame: 'lb', fontSize: 12 }, annos: [] };
    el._chartKey = ''; el._chartStat = null;
    render();
    // Sample the fig canvas near the base of each bar. Bar B (value 8) is taller than A (value 2).
    const c = document.getElementById('fig-canvas');
    const cx = c.getContext('2d');
    const sx = c.width / (canvasLogicalW || c.width), sy = c.height / (canvasLogicalH || c.height);
    // Local plot x: padL=48, plotW=w-48-16=436 across 2 categories → centres at ~48+109 and 48+327.
    const sample = (lx, ly) => { const d = cx.getImageData(Math.round((el.x + lx) * sx), Math.round((el.y + ly) * sy), 1, 1).data; return d[0] < 40 && d[1] < 40 && d[2] < 40; };
    // A dark pixel (Okabe-Ito[0] = black) exists high up only over the tall bar B.
    const aHigh = sample(157, 90);   // over bar A column, high up — should be empty (white)
    const bHigh = sample(375, 90);   // over bar B column, high up — should be inked (tall bar)
    return { aHigh, bHigh };
  });
  expect(r.bHigh).toBe(true);     // tall bar reaches high
  expect(r.aHigh).toBe(false);    // short bar does not
  expect(errors).toEqual([]);
});

test('log axis drops non-positive values with a visible warning, never clamps', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const el = { type: 'chart', x: 0, y: 0, w: 300, h: 240,
      chart: { kind: 'scatter', data: { columns: ['x', 'y'], rows: [[1, 10], [2, 0], [3, 100], [4, -5]], source: 't' },
        mapping: { xCol: 0, yCols: [1], seriesCol: null, errCol: null }, agg: 'none', error: 'none',
        axes: { x: { log: false }, y: { log: true } }, style: { palette: 'okabeIto' }, annos: [] } };
    const withLog = _chartStatsCached(el);
    el.chart.axes.y.log = false; el._chartKey = ''; el._chartStat = null;
    const noLog = _chartStatsCached(el);
    return { logPts: withLog.series[0].points.length, logDropped: withLog.warn.dropped, noLogPts: noLog.series[0].points.length };
  });
  expect(r.noLogPts).toBe(4);       // all four points when linear
  expect(r.logPts).toBe(2);         // 0 and −5 dropped on a log axis
  expect(r.logDropped).toBe(2);
  expect(errors).toEqual([]);
});

test('FigureLab never computes a p-value: no such function, marks are user strings', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[0];
    _chartAddSig();
    const an = el.chart.annos[0];
    // No p-value machinery must exist anywhere on the global surface.
    const globals = Object.keys(window).filter(k => /^(p_?value|compute.*p|t_?test|wilcoxon|mann.?whitney|anova|kruskal)/i.test(k));
    const anKeys = Object.keys(an);
    return { annoText: an.text, annoIsString: typeof an.text === 'string', kind: an.kind,
             hasP: anKeys.includes('p') || anKeys.includes('pvalue'),
             globals, logged: reproLog.some(e => e.action === 'chartSigAnno') };
  });
  expect(r.kind).toBe('sig');
  expect(r.annoIsString).toBe(true);       // user-entered symbol, not a number
  expect(r.hasP).toBe(false);              // no p field on the annotation
  expect(r.globals).toEqual([]);           // no p-value function anywhere
  expect(r.logged).toBe(true);
  expect(errors).toEqual([]);
});

test('chart survives undo/redo and session round-trip with no cached canvases', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { addChartElement('groupedBar'); closeChartModal(); render(); });
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    el._chartCache && (el._chartCache.__mark = 1);   // ensure a live cache exists
    const ser = serializeSession(true).freeformElements[0];
    const snap = cloneElemForUndo(el);
    // Mutate then undo.
    pushUndo(); el.chart.kind = 'line'; el._chartKey = '';
    undo();
    return {
      serHasData: !!(ser.chart && ser.chart.data && ser.chart.data.rows.length),
      serTransients: Object.keys(ser).filter(k => k === '_chartCache' || k === '_chartStat' || k === '_chartKey'),
      snapTransients: Object.keys(snap).filter(k => k === '_chartCache' || k === '_chartStat' || k === '_chartKey'),
      snapDeepCopied: snap.chart !== el.chart,        // deep copy, not a shared ref
      afterUndoKind: freeformElements[0].chart.kind,
    };
  });
  expect(r.serHasData).toBe(true);
  expect(r.serTransients).toEqual([]);      // no cache/stat/key in the session JSON
  expect(r.snapTransients).toEqual([]);     // nor in the undo snapshot
  expect(r.snapDeepCopied).toBe(true);
  expect(r.afterUndoKind).toBe('groupedBar');
  expect(errors).toEqual([]);
});

test('chart rotates and hit-tests like any other element', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'chart', x: 200, y: 150, w: 300, h: 200,
    chart: null, label: 'c' }]);
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    el.chart = { kind: 'bar', data: { columns: ['g', 'v'], rows: [['A', 3]], source: 't' },
      mapping: { xCol: 0, yCols: [1] }, agg: 'none', error: 'none', axes: { x: {}, y: {} }, style: { palette: 'okabeIto' }, annos: [] };
    el.rotation = 30;
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    return { centre: hitFreeformElement(el, cx, cy), farCorner: hitFreeformElement(el, el.x - 40, el.y - 40) };
  });
  expect(r.centre).toBe(true);
  expect(r.farCorner).toBe(false);
  expect(errors).toEqual([]);
});

test('dragging a chart does not recompute its stats', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { addChartElement('bar'); closeChartModal(); render(); });
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    render();                                  // warm the cache
    const before = _chartStatsCalls;
    // Simulate a drag: proxy blit path must not call _chartStats.
    elemDragState = { moving: true, indices: [0] };
    for (let i = 0; i < 5; i++) { el.x += 4; render(); }
    elemDragState = null;
    return { before, after: _chartStatsCalls };
  });
  expect(r.after).toBe(r.before);    // stats untouched across five drag frames
  expect(errors).toEqual([]);
});

// ── Phase 3: chart vector SVG + code generation ──

async function seedBarChart(page) {
  await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0; selectedElems.clear();
    addFreeformElement({ type: 'chart', x: 80, y: 60, w: 400, h: 300,
      chart: { kind: 'bar', data: { columns: ['Group', 'Value'], rows: [['Ctrl', 3], ['Drug', 7], ['Wash', 5]], source: 'test' },
        mapping: { xCol: 0, yCols: [1], seriesCol: null, errCol: null }, agg: 'mean', error: 'sem',
        axes: { x: { title: 'Condition' }, y: { title: 'Signal' } },
        style: { palette: 'okabeIto', showLegend: false, showGrid: false, frame: 'lb', fontSize: 12 }, annos: [] } });
    selectedElems.clear(); render();
  });
}

test('SVG export emits true vector chart geometry with literal text', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBarChart(page);
  const svg = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')));
    return new TextDecoder().decode(cap.data);
  });
  expect(svg).toMatch(/<g transform="translate/);        // chart group present
  expect((svg.match(/<rect/g) || []).length).toBeGreaterThan(3);   // bars + frame as vector rects
  expect((svg.match(/<line/g) || []).length).toBeGreaterThan(3);   // axes + ticks as vector lines
  expect(svg).toContain('>Signal<');                     // axis title as literal <text>
  expect(svg).toContain('>Condition<');
  expect(svg).toContain('>Ctrl<');                       // category labels as literal text
  expect(errors).toEqual([]);
});

test('SVG chart is not double-drawn: one background image, chart absent from the raster', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBarChart(page);
  const r = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')));
    const svg = new TextDecoder().decode(cap.data);
    const images = (svg.match(/<image /g) || []).length;
    // Extract the background PNG and sample the chart's centre — it must be blank
    // background (skipCharts worked), not painted bars.
    const m = svg.match(/<image x="0" y="0"[^>]*xlink:href="([^"]+)"/);
    const bgAlpha = await new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
        // chart centre ≈ logical (280,210); background PNG is at export scale.
        const sx = c.width / (canvasLogicalW || 1200), sy = c.height / (canvasLogicalH || 900);
        const d = cx.getImageData(Math.round(280 * sx), Math.round(210 * sy), 1, 1).data;
        res({ r: d[0], g: d[1], b: d[2] });
      };
      im.onerror = () => res(null);
      im.src = m[1];
    });
    return { images, bgAlpha };
  });
  expect(r.images).toBe(1);                        // exactly one <image> = the background
  // Chart centre on the background is white canvas, not an inked bar.
  expect(r.bgAlpha.r).toBeGreaterThan(240);
  expect(r.bgAlpha.g).toBeGreaterThan(240);
  expect(r.bgAlpha.b).toBeGreaterThan(240);
  expect(errors).toEqual([]);
});

test('rotated chart emits a rotate transform about its local centre', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBarChart(page);
  const svg = await page.evaluate(async () => {
    freeformElements[0].rotation = 30;
    const cap = await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')));
    return new TextDecoder().decode(cap.data);
  });
  // w=400,h=300 → centre (200,150).
  expect(svg).toMatch(/rotate\(30 200\.00 150\.00\)/);
  expect(errors).toEqual([]);
});

test('Python export contains the data, the SD/SEM formula, and the no-p-value comment', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBarChart(page);
  const py = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportPython());
    return new TextDecoder().decode(cap.data);
  });
  expect(py).toMatch(/SEM = SD\/sqrt\(n\)/);
  expect(py).toMatch(/ddof=1/);
  expect(py).toMatch(/does not compute p-values/i);
  expect(py).toContain('"Ctrl"');                  // dataset inlined
  expect(py).toContain('ax0.bar(');                // matplotlib bar call
  expect(errors).toEqual([]);
});

test('R export is syntactically plausible with balanced parentheses', async ({ page }) => {
  const errors = await loadApp(page);
  await seedBarChart(page);
  const r = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportR());
    const txt = new TextDecoder().decode(cap.data);
    const open = (txt.match(/\(/g) || []).length, close = (txt.match(/\)/g) || []).length;
    return { txt, open, close };
  });
  expect(r.txt).toContain('data.frame(');
  expect(r.txt).toContain('ggplot(');
  expect(r.txt).toMatch(/does not compute p-values/i);
  expect(r.open).toBe(r.close);                    // parens balance
  expect(errors).toEqual([]);
});

test('a chart with no data exports to SVG without throwing', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0;
    addFreeformElement({ type: 'chart', x: 60, y: 60, w: 300, h: 200,
      chart: { kind: 'bar', data: { columns: [], rows: [], source: 'test' },
        mapping: { xCol: 0, yCols: [1] }, agg: 'none', error: 'none', axes: { x: {}, y: {} },
        style: { palette: 'okabeIto' }, annos: [] } });
    render();
    await _captureDownload(() => exportSVG('t', 96, document.getElementById('fig-canvas')));
  });
  expect(errors).toEqual([]);       // loadApp's collector stays empty
});

// ── Phase 4: stable string ids + grouping ──

test('elements get unique string ids across every creation path', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0; selectedElems.clear();
    addFreeformElement({ type: 'rect', x: 10, y: 10, w: 50, h: 50 });
    addFreeformElement({ type: 'text', x: 80, y: 10, w: 100, h: 30, text: 'hi' });
    selectedElems.add(0); duplicateSelectedElems();
    const ids = freeformElements.map(e => e.id);
    return { ids, allStrings: ids.every(id => typeof id === 'string' && id.length > 0), unique: new Set(ids).size === ids.length };
  });
  expect(r.allStrings).toBe(true);
  expect(r.unique).toBe(true);
  expect(errors).toEqual([]);
});

test('legacy numeric ids are normalised to strings on session load', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const s = { layoutMode: 'freeform',
      freeformElements: [
        { id: 1234.5678, type: 'rect', x: 10, y: 10, w: 40, h: 40, groupId: 1234.5678 },
        { id: 9999.1111, type: 'rect', x: 60, y: 10, w: 40, h: 40, groupId: 1234.5678 },
      ] };
    applySession(s);
    const els = freeformElements;
    return {
      types: els.map(e => typeof e.id),
      // The group reference must have been remapped to the same NEW string id.
      groupMatches: els[0].groupId === els[0].id && els[1].groupId === els[0].id,
    };
  });
  expect(r.types).toEqual(['string', 'string']);
  expect(r.groupMatches).toBe(true);    // legacy numeric groupId → the new string id
  expect(errors).toEqual([]);
});

test('grouping: click selects the whole group, Alt selects one member', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'rect', x: 100, y: 100, w: 80, h: 80 },
    { type: 'rect', x: 250, y: 100, w: 80, h: 80 },
  ]);
  const mk = (page, lx, ly, mod) => page.evaluate(({ lx, ly, mod }) => {
    const c = document.getElementById('ann-canvas'); const r = c.getBoundingClientRect();
    const w = canvasLogicalW || c.width, h = canvasLogicalH || c.height;
    const ev = new MouseEvent('mousedown', { bubbles: true, clientX: r.left + lx * r.width / w, clientY: r.top + ly * r.height / h, button: 0, altKey: !!(mod && mod.alt) });
    freeformMousedown(ev); freeformMouseup(new MouseEvent('mouseup', { bubbles: true }));
  }, { lx, ly, mod });
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); groupSelectedElems(); });
  // Plain click on member 0 selects both.
  await mk(page, 140, 140, null);
  let sel = await page.evaluate(() => [...selectedElems].sort());
  expect(sel).toEqual([0, 1]);
  // Alt-click on member 0 selects only it.
  await mk(page, 140, 140, { alt: true });
  sel = await page.evaluate(() => [...selectedElems].sort());
  expect(sel).toEqual([0]);
  expect(errors).toEqual([]);
});

test('grouped members move together; ungroup detaches them', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'rect', x: 100, y: 100, w: 60, h: 60 },
    { type: 'rect', x: 220, y: 100, w: 60, h: 60 },
  ]);
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); groupSelectedElems();
    // Drag member 0 by (30,0): both should move.
    selectedElems.clear(); selectedElems.add(0); _expandSelectionToGroups();
    const x0 = [freeformElements[0].x, freeformElements[1].x];
    freeformElements.forEach(e => { if (selectedElems.has(freeformElements.indexOf(e))) e.x += 30; });
    const movedBoth = freeformElements[0].x - x0[0] === 30 && freeformElements[1].x - x0[1] === 30;
    // Ungroup, then a plain selection of member 0 stays just member 0.
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); ungroupSelectedElems();
    selectedElems.clear(); selectedElems.add(0); _expandSelectionToGroups();
    const soloAfterUngroup = selectedElems.size === 1;
    return { movedBoth, soloAfterUngroup, noGroupIds: freeformElements.every(e => !e.groupId) };
  });
  expect(r.movedBoth).toBe(true);
  expect(r.soloAfterUngroup).toBe(true);
  expect(r.noGroupIds).toBe(true);
  expect(errors).toEqual([]);
});

test('duplicating a group makes a distinct new group and keeps originals intact', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'rect', x: 100, y: 100, w: 60, h: 60 },
    { type: 'rect', x: 220, y: 100, w: 60, h: 60 },
  ]);
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); groupSelectedElems();
    const origGid = freeformElements[0].groupId;
    selectedElems.clear(); selectedElems.add(0); duplicateSelectedElems();   // one member → whole group duplicates
    const copies = [...selectedElems].map(i => freeformElements[i]);
    const copyGids = new Set(copies.map(e => e.groupId));
    return {
      count: freeformElements.length,                 // 2 originals + 2 copies
      copyCount: copies.length,
      copyGid: [...copyGids][0], origGid,
      oneCopyGroup: copyGids.size === 1,
      distinct: [...copyGids][0] !== origGid,
      origUntouched: freeformElements[0].groupId === origGid && freeformElements[1].groupId === origGid,
    };
  });
  expect(r.count).toBe(4);
  expect(r.copyCount).toBe(2);
  expect(r.oneCopyGroup).toBe(true);
  expect(r.distinct).toBe(true);           // copies share a NEW group, not the original's
  expect(r.origUntouched).toBe(true);
  expect(errors).toEqual([]);
});

test('groupId round-trips through a session save/load', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'rect', x: 100, y: 100, w: 60, h: 60 },
    { type: 'rect', x: 220, y: 100, w: 60, h: 60 },
  ]);
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); groupSelectedElems();
    const gid = freeformElements[0].groupId;
    const ser = serializeSession(true);
    applySession(JSON.parse(JSON.stringify(ser)));
    const els = freeformElements;
    return { bothGrouped: !!els[0].groupId && els[0].groupId === els[1].groupId, stringId: typeof els[0].id === 'string' };
  });
  expect(r.bothGrouped).toBe(true);
  expect(r.stringId).toBe(true);
  expect(errors).toEqual([]);
});

// ── Phase 5: connectors ──

async function seedTwoBoxesAndConnect(page) {
  await seedFreeform(page, [
    { type: 'rect', x: 100, y: 100, w: 120, h: 80, label: 'A' },
    { type: 'rect', x: 400, y: 300, w: 120, h: 80, label: 'B' },
  ]);
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); connectSelected(); render(); });
}

test('connector follows both endpoints on move and on resize', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(() => {
    const conn = freeformElements.find(e => e.type === 'connector');
    const g0 = _connGeom(conn);
    freeformElements[0].x += 50; freeformElements[0].y += 20; _syncConnectorBBoxes();
    const g1 = _connGeom(conn);
    // Resize box B by dragging its left edge (x and w both change) — the anchored face moves.
    freeformElements[1].x -= 50; freeformElements[1].w += 50; _syncConnectorBBoxes();
    const g2 = _connGeom(conn);
    return {
      fromTrackedMove: g1.from.x !== g0.from.x || g1.from.y !== g0.from.y,
      toUnchangedByAMove: g1.to.x === g0.to.x && g1.to.y === g0.to.y,
      toTrackedResize: g2.to.x !== g1.to.x || g2.to.y !== g1.to.y,
    };
  });
  expect(r.fromTrackedMove).toBe(true);
  expect(r.toUnchangedByAMove).toBe(true);
  expect(r.toTrackedResize).toBe(true);
  expect(errors).toEqual([]);
});

test('anchoring is correct under rotation and auto picks the post-rotation face', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(() => {
    const A = freeformElements[0];               // 100,100 120x80
    A.rotation = 90;
    _syncConnectorBBoxes();
    // The 'r' anchor at rotation 0 is (220,140); rotated 90° about centre (160,140) → (160,200).
    const a = _connAnchor(A, 'r', 0, 0);
    const conn = freeformElements.find(e => e.type === 'connector');
    const g = _connGeom(conn);
    // Auto face must be the one nearest B's centre (460,340) — below/right of A.
    const centre = { x: A.x + A.w / 2, y: A.y + A.h / 2 };
    const distAuto = Math.hypot(g.from.x - 460, g.from.y - 340);
    // Compare with the worst (top) face to prove auto didn't just pick a fixed side.
    const top = _connAnchor(A, 't', 0, 0);
    const distTop = Math.hypot(top.x - 460, top.y - 340);
    return { ax: a.x, ay: a.y, distAuto, distTop };
  });
  expect(r.ax).toBeCloseTo(160, 1);
  expect(r.ay).toBeCloseTo(200, 1);
  expect(r.distAuto).toBeLessThanOrEqual(r.distTop);   // auto chose the nearest face after rotation
  expect(errors).toEqual([]);
});

test('connector hit-test follows the polyline, not the bbox', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(() => {
    const conn = freeformElements.find(e => e.type === 'connector');
    conn.route = 'elbowH'; _syncConnectorBBoxes();
    const g = _connGeom(conn);
    // A point on the first segment should hit; the bbox's opposite empty corner should miss.
    const onSeg = { x: (g.pts[0][0] + g.pts[1][0]) / 2, y: g.pts[0][1] };
    const emptyCorner = { x: conn.x + 2, y: conn.y + conn.h - 2 };
    const hitSeg = hitFreeformElement(conn, onSeg.x, onSeg.y);
    // Make sure the empty corner is genuinely off every segment before asserting.
    let offAll = true;
    for (let i = 0; i < g.pts.length - 1; i++) if (distToSeg(emptyCorner.x, emptyCorner.y, g.pts[i][0], g.pts[i][1], g.pts[i + 1][0], g.pts[i + 1][1]) < 6) offAll = false;
    return { hitSeg, emptyMiss: offAll ? !hitFreeformElement(conn, emptyCorner.x, emptyCorner.y) : true };
  });
  expect(r.hitSeg).toBe(true);
  expect(r.emptyMiss).toBe(true);
  expect(errors).toEqual([]);
});

test('deleting an endpoint element leaves a flagged dangling connector, not a crash', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(() => {
    // Delete box A (index 0).
    selectedElems.clear(); selectedElems.add(0); deleteSelectedElems();
    render();                                   // must not throw
    const conn = freeformElements.find(e => e.type === 'connector');
    const dangling = _connGeom(conn).dangling;
    const hadDangling = _hasDangling();
    _pruneDanglingConnectors();
    return { stillPresent: !!conn, dangling, hadDangling, afterPrune: freeformElements.some(e => e.type === 'connector') };
  });
  expect(r.stillPresent).toBe(true);
  expect(r.dangling).toBe(true);
  expect(r.hadDangling).toBe(true);
  expect(r.afterPrune).toBe(false);             // prune removed it
  expect(errors).toEqual([]);
});

test('duplicating a box+connector pair rewires the copy to the copied box', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(() => {
    // Select both boxes and the connector, duplicate all three.
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1);
    const ci = freeformElements.findIndex(e => e.type === 'connector'); selectedElems.add(ci);
    const origAId = freeformElements[0].id, origBId = freeformElements[1].id;
    duplicateSelectedElems();
    const copies = [...selectedElems].map(i => freeformElements[i]);
    const copyConn = copies.find(e => e.type === 'connector');
    const copyBoxIds = new Set(copies.filter(e => e.type !== 'connector').map(e => e.id));
    return {
      rewired: copyBoxIds.has(copyConn.from.el) && copyBoxIds.has(copyConn.to.el),
      notOriginal: copyConn.from.el !== origAId && copyConn.to.el !== origBId,
    };
  });
  expect(r.rewired).toBe(true);         // copy points at the copied boxes
  expect(r.notOriginal).toBe(true);     // not at the originals
  expect(errors).toEqual([]);
});

test('connectors are excluded from align, distribute, and snap', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(() => {
    const conn = freeformElements.find(e => e.type === 'connector');
    const before = { fromEl: conn.from.el, toEl: conn.to.el };
    // Align a box + the connector to the left; the connector must be untouched.
    selectedElems.clear(); selectedElems.add(0);
    const ci = freeformElements.findIndex(e => e.type === 'connector'); selectedElems.add(ci);
    alignElems('left');
    const snapRes = _applyObjectSnap(conn, false);
    return { fromSame: conn.from.el === before.fromEl, toSame: conn.to.el === before.toEl, snapNull: snapRes === null };
  });
  expect(r.fromSame).toBe(true);
  expect(r.toSame).toBe(true);
  expect(r.snapNull).toBe(true);       // snap refuses to touch a connector
  expect(errors).toEqual([]);
});

test('connector exports as vector in SVG and round-trips through a session', async ({ page }) => {
  const errors = await loadApp(page);
  await seedTwoBoxesAndConnect(page);
  const r = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')));
    const svg = new TextDecoder().decode(cap.data);
    // Round-trip.
    const ser = serializeSession(true);
    applySession(JSON.parse(JSON.stringify(ser)));
    const conn = freeformElements.find(e => e.type === 'connector');
    const resolves = !!(freeformElements.find(e => e.id === conn.from.el) && freeformElements.find(e => e.id === conn.to.el));
    return { hasVectorLine: (svg.match(/<line/g) || []).length > 0, connInSvg: svg.includes('<g'), resolves };
  });
  expect(r.hasVectorLine).toBe(true);
  expect(r.resolves).toBe(true);        // endpoint ids still resolve after load
  expect(errors).toEqual([]);
});

test('self-connection is refused', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'rect', x: 100, y: 100, w: 120, h: 80, label: 'A' }]);
  const r = await page.evaluate(() => {
    // Force the same element into the selection twice is impossible (Set), so test connectSelected guard directly.
    selectedElems.clear(); selectedElems.add(0);
    connectSelected();                         // only one selected → refused
    const afterOne = freeformElements.filter(e => e.type === 'connector').length;
    return { afterOne };
  });
  expect(r.afterOne).toBe(0);           // no connector created from a single selection
  expect(errors).toEqual([]);
});

// ── Phase 6: flow templates ──

test('PRISMA template builds grouped boxes + connectors that all resolve', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0;
    applyFlowTemplate('prisma2020'); render();
    const conns = freeformElements.filter(e => e.type === 'connector');
    const rects = freeformElements.filter(e => e.type === 'rect');
    const texts = freeformElements.filter(e => e.type === 'text');
    const allResolve = conns.every(c => freeformElements.find(e => e.id === c.from.el) && freeformElements.find(e => e.id === c.to.el));
    const boxesGrouped = rects.every(rr => !!rr.groupId);
    return { conns: conns.length, rects: rects.length, texts: texts.length, allResolve, boxesGrouped };
  });
  expect(r.conns).toBeGreaterThan(4);
  expect(r.rects).toBe(r.texts);          // one text per box
  expect(r.allResolve).toBe(true);        // every connector endpoint resolves
  expect(r.boxesGrouped).toBe(true);      // each rect is grouped with its label
  expect(errors).toEqual([]);
});

test('flow template appends and never destroys existing elements', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'rect', x: 600, y: 500, w: 80, h: 60, label: 'keep1' },
    { type: 'rect', x: 700, y: 500, w: 80, h: 60, label: 'keep2' },
  ]);
  const r = await page.evaluate(() => {
    const before = freeformElements.slice(0, 2).map(e => ({ id: e.id, x: e.x, y: e.y }));
    applyFlowTemplate('consort');
    const survivors = before.filter(b => { const e = freeformElements.find(f => f.id === b.id); return e && e.x === b.x && e.y === b.y; });
    return { survived: survivors.length, grew: freeformElements.length > 2 };
  });
  expect(r.survived).toBe(2);             // originals untouched
  expect(r.grew).toBe(true);
  expect(errors).toEqual([]);
});

test('moving a flow box drags its label and reroutes its connectors', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0;
    applyFlowTemplate('consort'); render();
  });
  const r = await page.evaluate(() => {
    // Pick the first rect and its grouped text.
    const rectIdx = freeformElements.findIndex(e => e.type === 'rect');
    const rect = freeformElements[rectIdx];
    const text = freeformElements.find(e => e.type === 'text' && e.groupId === rect.groupId);
    const conn = freeformElements.find(e => e.type === 'connector' && (e.from.el === rect.id || e.to.el === rect.id));
    const g0 = _connGeom(conn);
    const tx0 = text.x, ty0 = text.y;
    // Select the box (expands to its group) and move it.
    selectedElems.clear(); selectedElems.add(rectIdx); _expandSelectionToGroups();
    selectedElems.forEach(i => { freeformElements[i].x += 40; freeformElements[i].y += 25; });
    _syncConnectorBBoxes();
    const g1 = _connGeom(conn);
    return {
      labelMoved: text.x === tx0 + 40 && text.y === ty0 + 25,
      connRerouted: (conn.from.el === rect.id ? (g1.from.x !== g0.from.x || g1.from.y !== g0.from.y) : (g1.to.x !== g0.to.x || g1.to.y !== g0.to.y)),
    };
  });
  expect(r.labelMoved).toBe(true);        // the grouped label moved with the box
  expect(r.connRerouted).toBe(true);      // the connector followed
  expect(errors).toEqual([]);
});

test('CONSORT and fishbone build and export to SVG without errors', async ({ page }) => {
  const errors = await loadApp(page);
  for (const name of ['consort', 'fishbone']) {
    await page.evaluate(async (nm) => {
      const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
      setLayoutMode('freeform'); freeformElements.length = 0;
      applyFlowTemplate(nm); render();
      await _captureDownload(() => exportSVG('t', 96, document.getElementById('fig-canvas')));
    }, name);
  }
  expect(errors).toEqual([]);             // both built and exported clean
});

test('flow template round-trips through a session with connectors intact', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0;
    applyFlowTemplate('prisma2020');
    const ser = serializeSession(true);
    applySession(JSON.parse(JSON.stringify(ser)));
    const conns = freeformElements.filter(e => e.type === 'connector');
    const allResolve = conns.every(c => freeformElements.find(e => e.id === c.from.el) && freeformElements.find(e => e.id === c.to.el));
    return { conns: conns.length, allResolve };
  });
  expect(r.conns).toBeGreaterThan(4);
  expect(r.allResolve).toBe(true);        // ids still resolve after reload
  expect(errors).toEqual([]);
});

// ── Phase 7: heatmaps + survival curves ──

test('Kaplan–Meier step function matches a hand-computed reference incl. censoring', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    // 4 subjects: events at t=2,4,7; one censored at t=5.
    const km = _kmEstimate([{ time: 2, event: 1 }, { time: 4, event: 1 }, { time: 5, event: 0 }, { time: 7, event: 1 }]);
    return { steps: km.steps.map(s => [s.t, +s.s.toFixed(6)]), censors: km.censors.map(c => c.t), n: km.n };
  });
  // S: 1 → 1*(1-1/4)=0.75 → 0.75*(1-1/3)=0.5 → 0.5*(1-1/1)=0
  expect(r.steps).toEqual([[0, 1], [2, 0.75], [4, 0.5], [7, 0]]);
  expect(r.censors).toEqual([5]);          // the censored subject shows a tick at t=5
  expect(r.n).toBe(4);
  expect(errors).toEqual([]);
});

test('survival computes no inference: no log-rank function anywhere', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    addChartElement('survival'); closeChartModal();
    const globals = Object.keys(window).filter(k => /logrank|log_rank|coxph|hazard.*ratio|survdiff/i.test(k));
    const el = freeformElements[0];
    const stat = _chartStatsCached(el);
    // The stat object carries curves, never a p-value.
    const hasP = JSON.stringify(stat).match(/"p(value)?":/i);
    return { globals, hasCurves: Array.isArray(stat.curves) && stat.curves.length === 2, hasP: !!hasP };
  });
  expect(r.globals).toEqual([]);
  expect(r.hasCurves).toBe(true);
  expect(r.hasP).toBe(false);
  expect(errors).toEqual([]);
});

test('heatmap builds a matrix with the true numeric range for the colourbar', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    addChartElement('heatmap'); closeChartModal();
    const el = freeformElements[0];
    el.chart.data = { columns: ['g', 's1', 's2'], rows: [['A', -2, 5], ['B', 0, 3]], source: 't' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1, 2];
    el._chartKey = ''; el._chartStat = null;
    const stat = _chartStatsCached(el);
    return { rows: stat.matrix.length, cols: stat.matrix[0].length, min: stat.min, max: stat.max, rowLabels: stat.rowLabels, colLabels: stat.colLabels };
  });
  expect(r.rows).toBe(2);
  expect(r.cols).toBe(2);
  expect(r.min).toBe(-2);                  // true data min/max drive the colourbar
  expect(r.max).toBe(5);
  expect(r.rowLabels).toEqual(['A', 'B']);
  expect(r.colLabels).toEqual(['s1', 's2']);
  expect(errors).toEqual([]);
});

test('colour scale is monotonic and diverging centres on the explicit midpoint', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const lum = c => { const m = c.match(/(\d+),(\d+),(\d+)/); return +m[1] * 0.299 + +m[2] * 0.587 + +m[3] * 0.114; };
    // Sequential viridis: t=1 (yellow) is much brighter than t=0 (purple).
    const seqOrdered = lum(_colorScale(1, 'viridis')) > lum(_colorScale(0, 'viridis'));
    // Diverging midpoint renders near white/grey (high, balanced luminance).
    const midCol = _colorScale(0.5, 'diverging');
    const m = midCol.match(/(\d+),(\d+),(\d+)/);
    const midNeutral = Math.abs(+m[1] - +m[2]) < 40 && Math.abs(+m[2] - +m[3]) < 40 && lum(midCol) > 180;
    return { seqOrdered, midNeutral };
  });
  expect(r.seqOrdered).toBe(true);         // darker ≠ higher ambiguity: viridis is ordered
  expect(r.midNeutral).toBe(true);         // diverging centre is neutral, not a hue
  expect(errors).toEqual([]);
});

test('heatmap and survival export to SVG as vector without throwing', async ({ page }) => {
  const errors = await loadApp(page);
  const svgs = await page.evaluate(async () => {
    const out = {};
    for (const kind of ['heatmap', 'survival']) {
      freeformElements.length = 0;
      addChartElement(kind); closeChartModal(); render();
      const cap = await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')));
      out[kind] = new TextDecoder().decode(cap.data);
    }
    return out;
  });
  expect(svgs.heatmap).toMatch(/<rect/);   // matrix cells + colourbar as vector rects
  expect(svgs.survival).toMatch(/<polyline/); // KM step curve as a polyline
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
