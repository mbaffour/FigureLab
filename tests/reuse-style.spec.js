// @ts-check
// Reusing a figure: replace a panel's image (or every panel's) and keep the work done on
// it; a lab style file (paper_style.json, shared with the author's other figure apps);
// house styles as a file; perceptually uniform look-up tables and the HiLo preview; alt
// text as part of the figure; and the small integration items (format marks in reports,
// PLOS's .tif).
//
// Every test below fails on the code before this change: the functions, controls and
// file entries it calls or reads did not exist (replacePanelImage, replaceAllImages,
// loadLabStyle, the viridis/magma/inferno/cividis tables, the alt-text box, the PDF
// /Info dictionary, the -alt.txt ZIP entry), or — for the integration items — the old
// code produced the opposite result (raw *marks* in the compliance report, `.tiff`
// under PLOS). Each test says which.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loadApp, seedPanels } = require('./helpers');

const TIFF = n => Array.from(fs.readFileSync(path.join(__dirname, 'fixtures', 'tiff', n)));

// A PNG File of w × h in a solid grey with a marker, built in the page.
const PNG_FILE = () => {
  window.__pngFile = async (name, w, h, g) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff'; x.fillRect(2, 2, Math.max(2, w / 5), Math.max(2, h / 5));
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return new File([blob], name, { type: 'image/png' });
  };
};

// ── 1. Replace an image ────────────────────────────────────────────
// Fails before: replacePanelImage did not exist (the only way was delete and start over).
test('replace keeps id, letter, crop, adjustments, annotations, span, tags — one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(PNG_FILE);
  const r = await page.evaluate(async () => {
    const im = images[0];
    Object.assign(im, { cropT: 10, cropL: 5, cropB: 7, cropR: 3, cropAngle: 4, rotate: 90, flipH: true,
      brightness: 1.3, gamma: 0.8, blackPt: 12, whitePt: 240, lut: 'green', tag: 'WT', colSpan: 1,
      sbUm: 20, sbOn: true, panelAnns: [{ type: 'arrow', x1: .1, y1: .1, x2: .5, y2: .5, color: '#ff0' }] });
    render();
    const before = { id: im.id, label: im.label, n: undoStack.length };
    const ok = await replacePanelImage(im.id, await __pngFile('next_week.png', 100, 100, 90));
    const a = images[0];
    const out = { ok, id: a.id, label: a.label, name: a.name, crop: [a.cropT, a.cropL, a.cropB, a.cropR, a.cropAngle],
      rot: a.rotate, flipH: a.flipH, adj: [a.brightness, a.gamma, a.blackPt, a.whitePt, a.lut], tag: a.tag,
      sb: a.sbUm, anns: a.panelAnns.length, steps: undoStack.length - before.n, before,
      hist: _panelHistoryText(), w: a.img.naturalWidth };
    undo();
    out.afterUndo = images[0].name;
    return out;
  });
  expect(r.ok).toBe(true);
  expect(r.id).toBe(r.before.id);
  expect(r.label).toBe(r.before.label);
  expect(r.name).toBe('next_week.png');
  expect(r.crop).toEqual([10, 5, 7, 3, 4]);
  expect(r.rot).toBe(90); expect(r.flipH).toBe(true);
  expect(r.adj).toEqual([1.3, 0.8, 12, 240, 'green']);
  expect(r.tag).toBe('WT'); expect(r.sb).toBe(20); expect(r.anns).toBe(1);
  expect(r.steps).toBe(1);                               // one undo step
  expect(r.hist).toContain('image replaced: panel0.png → next_week.png');
  expect(r.afterUndo).toBe('panel0.png');                // and that step takes it back
  expect(errors).toEqual([]);
});

// Fails before: no replace path, so no calibration rule existed.
test('calibration: kept only for identical pixel dimensions, taken from metadata, cleared otherwise', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(PNG_FILE);
  const cal = TIFF('cal_imagej.tif'), none = TIFF('cal_none.tif');   // both 40 × 24; ImageJ says 0.16 µm/px
  const g16 = TIFF('g16_raw.tif');                                    // 40 × 24, 16-bit, no calibration
  const r = await page.evaluate(async ({ cal, none, g16 }) => {
    const add = async (name, w, h) => { const f = await __pngFile(name, w, h, 80);
      const img = new Image(); const src = await new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(f); });
      await new Promise(r => { img.onload = r; img.src = src; }); _commitImage(img, src, name); return images[images.length - 1]; };
    const a = await add('same.png', 40, 24); a.umPerPx = 0.5;
    const b = await add('diff.png', 64, 64); b.umPerPx = 0.5;
    const c = await add('meta.png', 64, 64); c.umPerPx = 0.5;
    await replacePanelImage(a.id, new File([new Uint8Array(none)], 'none.tif', { type: 'image/tiff' }));   // same dims, no metadata
    await replacePanelImage(b.id, new File([new Uint8Array(none)], 'none.tif', { type: 'image/tiff' }));   // other dims, no metadata
    await replacePanelImage(c.id, new File([new Uint8Array(cal)], 'cal.tif', { type: 'image/tiff' }));     // metadata wins
    const g = id => images[_pidx(id)];
    const out = { a: g(a.id).umPerPx, b: g(b.id).umPerPx, c: g(c.id).umPerPx, cSrc: g(c.id)._metaCalibSource,
      rawBefore: !!g(a.id).raw };
    await replacePanelImage(a.id, new File([new Uint8Array(g16)], 'g16.tif', { type: 'image/tiff' }));
    out.rawAfter = !!g(a.id).raw; out.a2 = g(a.id).umPerPx;
    return out;
  }, { cal, none, g16 });
  expect(r.a).toBe(0.5);                         // identical 40 × 24: the old µm/px is still right
  expect(r.b).toBe(0);                           // 64 × 64 → 40 × 24 and no metadata: cleared, not guessed
  expect(Math.abs(r.c - 0.16)).toBeLessThan(1e-4);
  expect(r.cSrc).toBe('ImageJ');
  expect(r.rawBefore).toBe(false);               // native samples come from the new file:
  expect(r.rawAfter).toBe(true);                 // none from an 8-bit file, the 16-bit ones from g16
  expect(r.a2).toBe(0.5);
});

// Fails before: no replace. The fingerprint is the gel dialog's own (_gelFingerprint).
test('a gel analysis goes stale when the image is replaced by one of the same size', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(PNG_FILE);
  const r = await page.evaluate(async () => {
    const im = images[0];
    im.gelAnalysis = { cropKey: _gelCropKey(im), fp: _gelFingerprint(im), lanes: [] };
    const before = _gelStaleWhy(im);
    await replacePanelImage(im.id, await __pngFile('blot2.png', 100, 100, 200));
    return { before, after: _gelStaleWhy(images[0]) };
  });
  expect(r.before).toBe(null);
  expect(r.after).toBe('image');
});

// Fails before: replaceAllImages / _replaceMatch did not exist.
test('replace all: by name first, then the rest in order; summary lists old → new and unchanged; one undo step', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);          // panel0.png … panel3.png
  await page.evaluate(PNG_FILE);
  const r = await page.evaluate(async () => {
    const files = [await __pngFile('fresh_a.png', 100, 100, 10), await __pngFile('panel2.png', 100, 100, 20),
                   await __pngFile('fresh_b.png', 100, 100, 30)];
    const n0 = undoStack.length;
    const bg = await replaceAllImages(files);
    const text = bg.querySelector('#ra-list').textContent;
    const unchanged = bg.querySelector('#ra-unchanged') ? bg.querySelector('#ra-unchanged').textContent : '';
    const mid = images.map(im => im.name);          // nothing changes before Replace
    bg.querySelector('#ra-apply').click();
    return { text, unchanged, mid, after: images.map(im => im.name), labels: images.map(im => im.label),
      steps: undoStack.length - n0 };
  });
  expect(r.mid).toEqual(['panel0.png', 'panel1.png', 'panel2.png', 'panel3.png']);
  // panel2.png matched by name; fresh_a and fresh_b fill panels 0 and 1 in order; panel 3 is left
  expect(r.after).toEqual(['fresh_a.png', 'fresh_b.png', 'panel2.png', 'panel3.png']);
  expect(r.labels).toEqual(['A', 'B', 'C', 'D']);
  expect(r.text).toContain('panel0.png → fresh_a.png');
  expect(r.text).toContain('same name');
  expect(r.unchanged).toContain('panel3.png');
  expect(r.steps).toBe(1);
});

// ── 2. Lab style ───────────────────────────────────────────────────
// The real file's shape: what CFU Plot Studio's plot_settings_payload() writes —
// app/preset_version/created_at/kind at the top, every plot setting under `settings`,
// including the many that only mean something to a ggplot theme.
const PAPER_STYLE = {
  app: 'CFU Plot Studio', kind: 'paper_style', preset_version: 1, created_at: '2026-11-09 14:02:11 EST',
  settings: {
    plot_mode: 'bar', comparison: 'none', y_mode: 'log10', error_type: 'sd', show_points: true,
    plot_title: 'Phage killing', x_label: 'Strain', y_label: 'CFU/mL', legend_title: '', plot_theme: 'classic',
    y_tick_length: 0.15, axis_line_width: 0.6, box_line_width: 0.5, axis_color: '#262626', grid_color: '#e5e5e5',
    bar_outline_color: '#000000', bar_width: 0.7, point_size: 2, jitter_seed: 1,
    font_family: 'custom', font_family_custom: 'Source Sans Pro', font_size: 11, title_size: 14, subtitle_size: 10,
    stat_size: 3, x_angle: 35, legend_position: 'right', download_width: 6, download_height: 4, download_dpi: 600,
    sample_palette: { 'MG1655': '#000000', 'MG1655 + WT': '#E69F00', 'ΔbshC': '#56B4E9' },
  },
};

// Fails before: loadLabStyle did not exist, and charts had no sample colours.
test('lab style: font, sizes, colours and sample colours applied; unused keys listed; one undo step; saved', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async (style) => {
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['Strain', 'MG1655', 'MG1655 + WT', 'other'], rows: [['a', 1, 2, 3], ['b', 2, 3, 4]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1, 2, 3]; el.chart.kind = 'groupedBar';
    el._chartKey = ''; el._chartStat = null; render();
    const before = _chartStatsCached(el).seriesNames.map(s => s.color);
    const n0 = undoStack.length;
    const k = (render(), _physFacts().ptPerPx);
    loadLabStyle(style, 'paper_style.json');
    const summary = document.getElementById('lab-style-summary').textContent;
    const ignored = document.getElementById('lab-style-ignored').textContent;
    const after = _chartStatsCached(el).seriesNames.map(s => s.color);
    const key = _keyText();
    // the axis width reaches the drawn chart
    const widths = []; const emit = { rect() {}, line(x1, y1, x2, y2, s, w) { widths.push(w); }, poly() {}, circle() {}, text() {}, path() {} };
    try { _chartDraw(el, emit); } catch (e) {}
    const out = { k, before, after, key, summary, ignored, steps: undoStack.length - n0,
      font: gv('label-font'), axisFont: gv('axis-font'), axisFs: gi('axis-fs'), axisColor: gv('axis-color'), auto: gc('axis-auto-color'),
      axisW: _chartAxisW(), drawnW: Math.max(...widths), fontOpt: [...document.getElementById('label-font').options].some(o => o.value === gv('label-font')) };
    const sess = JSON.parse(JSON.stringify(serializeSession(true)));
    undo();
    out.undone = { font: gv('label-font'), colours: gv('sample-colours'), axisFs: gi('axis-fs') };
    applySession(sess, { noUndo: true });
    const el2 = freeformElements.find(e => e.type === 'chart');
    out.reloaded = { font: gv('label-font'), colours: _chartStatsCached(el2).seriesNames.map(s => s.color), status: document.getElementById('lab-style-status').textContent };
    return out;
  }, PAPER_STYLE);
  expect(r.font).toBe("'Source Sans Pro',sans-serif");
  expect(r.fontOpt).toBe(true);                       // the custom family is an option the select really holds
  expect(r.axisFont).toBe('');                        // headings follow the letters' font
  expect(r.axisFs).toBe(Math.round(11 / r.k));        // 11 pt → px at this print size
  expect(r.axisColor).toBe('#262626'); expect(r.auto).toBe(false);
  expect(r.axisW).toBeCloseTo(0.6 * 72.27 / 25.4 * 0.75 / r.k, 1);
  expect(r.drawnW).toBeCloseTo(r.axisW, 5);
  // exact names take the lab colours; 'other' keeps its palette colour
  expect(r.after).toEqual(['#000000', '#e69f00', r.before[2]]);
  expect(r.key).toContain('MG1655 (black');
  expect(r.key).toContain('MG1655 + WT (orange');
  expect(r.summary).toContain('pt');
  for (const k of ['plot_mode', 'y_mode', 'grid_color', 'x_angle', 'legend_position', 'download_dpi', 'subtitle_size', 'box_line_width'])
    expect(r.ignored).toContain(k);
  expect(r.ignored).not.toContain('font_size');
  expect(r.steps).toBe(1);
  expect(r.undone.colours).toBe('');
  expect(r.undone.font).not.toBe("'Source Sans Pro',sans-serif");
  expect(r.reloaded.font).toBe("'Source Sans Pro',sans-serif");
  expect(r.reloaded.colours.slice(0, 2)).toEqual(['#000000', '#e69f00']);
  expect(r.reloaded.status).toContain('CFU Plot Studio');
  expect(errors).toEqual([]);
});

// Fails before: a one-series bar chart of strains could not take strain colours at all.
test('lab style: a one-series bar chart of strains takes the colours by category, and the key lists them', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async (style) => {
    loadLabStyle(style, 'paper_style.json');
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['Strain', 'CFU'], rows: [['MG1655', 5], ['ΔbshC', 3], ['x', 1]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1]; el.chart.kind = 'bar';
    el._chartKey = ''; el._chartStat = null; render();
    const s = _chartStatsCached(el);
    return { bars: s.groups.map(g => g.bars[0].color), key: _figureKey().map(k => k.name + ' ' + k.color) };
  }, PAPER_STYLE);
  expect(r.bars[0]).toBe('#000000'); expect(r.bars[1]).toBe('#56b4e9');
  expect(r.key).toEqual(expect.arrayContaining(['MG1655 #000000', 'ΔbshC #56b4e9']));
});

// Fails before: house styles lived only in localStorage — no export or import.
test('house styles: export to a file and import it back', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    localStorage.setItem('figurelab_housestyles', JSON.stringify([{ name: 'Ramsey lab', style: { ..._collectHouseStyle(), labelSize: '11', labelColor: '#123456' } }]));
    const cap = await _captureDownload(() => exportHouseStyles());
    const text = new TextDecoder().decode(cap.data);
    localStorage.setItem('figurelab_housestyles', '[]');
    const parsed = JSON.parse(text);
    parsed.styles[0].style.evil = 'x';                // a key a house style does not have is not taken
    const n = importHouseStyles(parsed);
    const got = getHouseStyles();
    return { name: cap.name, kind: parsed.kind, n, got: got.map(s => [s.name, s.style.labelSize, s.style.labelColor, 'evil' in s.style]),
      listed: document.getElementById('house-style-list').textContent };
  });
  expect(r.name).toBe('figurelab-house-styles.json');
  expect(r.kind).toBe('house_styles');
  expect(r.n).toBe(1);
  expect(r.got).toEqual([['Ramsey lab', '11', '#123456', false]]);
  expect(r.listed).toContain('Ramsey lab');
});

// ── 3. Look-up tables ─────────────────────────────────────────────
// Fails before: LUTS had no viridis, magma, inferno, cividis or orange.
test('colour maps match matplotlib at the ends and the middle', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => {
    const h = (k, t) => _rgbHex(LUTS[k](Math.round(t * 255)));
    return { v0: h('viridis', 0), v5: h('viridis', 0.5), v1: h('viridis', 1), m0: h('magma', 0), m1: h('magma', 1),
      i1: h('inferno', 1), c0: h('cividis', 0), c1: h('cividis', 1), orange: h('orange', 1),
      info: Object.keys(LUTS).every(k => LUT_INFO[k]) };
  });
  expect(r.v0).toBe('#440154'); expect(r.v5).toBe('#21918c'); expect(r.v1).toBe('#fde725');
  expect(r.m0).toBe('#000004'); expect(r.m1).toBe('#fcfdbf');
  expect(r.i1).toBe('#fcffa4');
  expect(r.c0).toBe('#00224e'); expect(r.c1).toBe('#fee838');
  expect(r.orange).toBe('#ff8000');
  expect(r.info).toBe(true);            // every LUT is named for the pickers, caption and key
});

// Fails before: no viridis LUT, so neither the bar nor the key could show it.
test('a viridis panel: its intensity bar, key swatch, words, Methods and pickers agree', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    const im = images[0]; im.lut = 'viridis'; im.cbar = true;
    render();
    const b = panelBounds[0], c = document.getElementById('fig-canvas'), x = c.getContext('2d');
    const dx = b.dx, dw = b.dw, dy = b.dy, dh = b.dh;
    const bw = Math.max(4, Math.round(dw * 0.03)), bh = Math.max(20, Math.round(dh * 0.4)), pad = Math.max(6, Math.round(dw * .04));
    const S = c.width / canvasLogicalW;
    const bx = dx + dw - pad - bw + bw / 2, by = dy + Math.round((dh - bh) / 2);
    const px = (X, Y) => { const d = x.getImageData(Math.round(X * S), Math.round(Y * S), 1, 1).data; return _rgbHex([d[0], d[1], d[2]]); };
    const key = _figureKey()[0];
    renderImgList();
    return { top: px(bx, by), bottom: px(bx, by + bh - 1), stops: key.stops, marker: key.marker, words: _keyText(),
      methods: generateMethodsParagraph(), btn: !!document.querySelector('.f-lut[data-lut="viridis"]'),
      be: !!document.querySelector('#be-lut option[value="cividis"]'), chOpts: LUT_NAMES.inferno };
  });
  expect(r.top).toBe('#fde725');
  expect(r.bottom).toBe('#440154');
  expect(r.marker).toBe('gradient');
  expect(r.stops[0]).toBe('#440154'); expect(r.stops[4]).toBe('#fde725');
  expect(r.words).toContain('viridis colour map');
  expect(r.methods).toContain('viridis colour map');
  expect(r.btn).toBe(true); expect(r.be).toBe(true); expect(r.chOpts).toBe('inferno colour map');
  expect(errors).toEqual([]);
});

// Fails before: there was no HiLo view (setHiLoPreview did not exist).
test('HiLo is a display aid: on screen it shows, in an export it never appears', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[0].whitePt = 100; render();                    // plenty of over-range pixels
    const exp = () => { const c = renderExportCanvas(150); return c.toDataURL('image/png'); };
    const off = exp();
    setHiLoPreview(true); drawAnnOverlay();
    const on = exp();
    const ov = document.getElementById('ann-canvas'), ox = ov.getContext('2d');
    const d = ox.getImageData(0, 0, ov.width, ov.height).data;
    let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255) red++;
    const lut = images[0].lut;
    setHiLoPreview(false);
    return { same: on === off, red, lut };
  });
  expect(r.red).toBeGreaterThan(0);       // the overlay shows it
  expect(r.same).toBe(true);              // the export is byte-identical with it on and off
  expect(r.lut).toBe('none');             // and it is not a panel's LUT
});

// ── 4. Alt text ────────────────────────────────────────────────────
const ZIP = `
  window.__zip = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el;
      out[name] = bytes.subarray(at, at + size);
      p = at + size;
    }
    return out;
  };`;

// Fails before: there was no alt-text box, the session did not save the text, the SVG had
// no <desc>, the PDF no /Info, and the package no -alt.txt.
test('alt text: a box under the caption, saved and loaded, reset on New, in SVG, PDF and the ZIP', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(ZIP);
  // typed in the box, like a person would
  await page.evaluate(() => { const d = document.getElementById('alt-text').closest('details'); if (d) d.open = true; });
  await page.locator('#alt-text').fill('Two panels of E. coli cells, (A) wild type and (B) mutant.');
  const r = await page.evaluate(async () => {
    const count = document.getElementById('alt-text-count').textContent;
    sv('export-name', 'fig3');
    const sess = serializeSession(false);
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 100, document.getElementById('fig-canvas')))).data);
    const pdf = new TextDecoder('latin1').decode((await _captureDownload(() => doExport('pdf'))).data);
    const zip = __zip((await _captureDownload(() => exportSubmissionPackage())).data);
    const alt = zip['fig3-alt.txt'] ? new TextDecoder().decode(zip['fig3-alt.txt']) : null;
    // New clears it; undo brings it back
    pushUndo({ boundary: true }); _resetFigureState();
    const afterNew = document.getElementById('alt-text').value;
    undo();
    const afterUndo = document.getElementById('alt-text').value;
    // a saved figure brings it back into the box
    _resetFigureState(); applySession(sess, { noUndo: true });
    return { count, saved: sess.altText, svgDesc: /<desc>Two panels of E\. coli cells/.test(svg),
      pdfSubject: /\/Subject \(Two panels of E\. coli cells, \\\(A\\\) wild type/.test(pdf), pdfInfo: /\/Info \d+ 0 R/.test(pdf),
      alt, afterNew, afterUndo, loaded: document.getElementById('alt-text').value };
  });
  expect(r.count).toBe('58 characters');
  expect(r.saved).toBe('Two panels of E. coli cells, (A) wild type and (B) mutant.');
  expect(r.svgDesc).toBe(true);
  expect(r.pdfSubject).toBe(true);
  expect(r.pdfInfo).toBe(true);
  expect(r.alt.trim()).toBe('Two panels of E. coli cells, (A) wild type and (B) mutant.');
  expect(r.afterNew).toBe('');
  expect(r.afterUndo).toBe('Two panels of E. coli cells, (A) wild type and (B) mutant.');
  expect(r.loaded).toBe('Two panels of E. coli cells, (A) wild type and (B) mutant.');
  expect(errors).toEqual([]);
});

// Fails before: the report's Alt text fix wrote a draft over the author's text instead
// of taking them to a box (there was none), and Draft wrote only to the clipboard.
test('alt text: the compliance link focuses the box, Draft fills it with a structural description', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    _auditFix('alttext');
    const focused = document.activeElement && document.activeElement.id;
    await generateAltText();
    return { focused, text: document.getElementById('alt-text').value };
  });
  expect(r.focused).toBe('alt-text');
  expect(r.text).toContain('panel grid of 2 image panels');
});

// ── 5. Integration items ───────────────────────────────────────────
// Fails before: the compliance rows printed the label as typed, stars and all
// ("*wt* merges a red channel…"), while the figure draws it in italic without them.
test('format marks: the compliance report and the S1 sheet show the label as the figure does', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('label-format', 'custom');
    const im = images[0]; im.label = '*wt*'; im.lut = 'red'; im.channels = [{ lut: 'green', name: 'gfp.png' }];
    render();
    const row = _accessRows(null).find(x => x.label === 'Red/green');
    // the S1 sheet draws its panel letter with fillText: catch what it is given
    const drawn = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { drawn.push(String(t)); return orig.call(this, t, ...a); };
    im.cropT = 10; im.cropL = 10;              // the letter is drawn at a crop outline
    try { _s1PageCanvas(im, {}); } catch (e) { drawn.push('ERR ' + e.message); }
    CanvasRenderingContext2D.prototype.fillText = orig;
    return { note: row.note, drawn };
  });
  expect(r.note).toContain('wt merges a red channel');
  expect(r.note).not.toContain('*wt*');
  expect(r.drawn).toContain('wt');
  expect(r.drawn.some(t => t.includes('*wt*'))).toBe(false);
});

// Fails before: the TIFF was always written as .tiff, PLOS included.
test('PLOS names the TIFF Fig1.tif; other journals keep .tiff', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(async () => {
    const name = async () => { const c = renderExportCanvas(100); return (await _captureDownload(() => exportTIFF('Fig1', 100, c, true))).name; };
    sv('target-journal', 'plos'); _syncJournalFromControl();
    const plos = await name(), pf = _pfExt('tiff');
    sv('target-journal', ''); _syncJournalFromControl();
    return { plos, pf, none: await name(), pf2: _pfExt('tiff') };
  });
  expect(r.plos).toBe('Fig1.tif'); expect(r.pf).toBe('tif');
  expect(r.none).toBe('Fig1.tiff'); expect(r.pf2).toBe('tiff');
});
