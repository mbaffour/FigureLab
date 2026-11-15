// @ts-check
// Usability round 1 — typography, journal presets, compliance honesty and the legend key.
// Six testers built real figures through the visible UI; these are their findings in this
// group, each driven the way they met it. Every test fails on the build they tested.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1400, height: 900 } });

const HELPERS = `
  window.__txt = (cap) => new TextDecoder().decode(cap.data);
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fix: e.querySelector('button') ? e.querySelector('button').textContent.trim() : null }));
  window.__report = () => { checkCompliance(); return { title: document.getElementById('im-title').textContent, rows: __rows() }; };
  window.__row = (l) => __report().rows.find(r => r.label === l) || null;
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
  // a freeform chart with given data, as the chart dialog would leave it
  window.__chart = (kind, columns, rows, x, y, w, h) => {
    addChartElement(kind); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns, rows, source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = columns.slice(1).map((_, i) => i + 1);
    el.chart.style.showLegend = false;
    Object.assign(el, { x, y, w, h }); el._chartKey = ''; el._chartStat = null;
    return el;
  };
  // every <text> font-size and family the chart writes into an SVG
  window.__svgTexts = (svg) => [...svg.matchAll(/<text [^>]*font-family="([^"]*)" font-size="([\\d.]+)"/g)].map(m => ({ fam: m[1], size: +m[2] }));
`;

// A freeform results figure on a 1200 px canvas, as charts / phage / freeform built it.
async function freeformFigure(page) {
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 360, h: 280, label: 'A', name: 'plate.png' }]);
  await page.evaluate(HELPERS);
  await page.evaluate(() => {
    sv('fm-canvas-w', '1200'); sv('fm-canvas-h', '900');
    __chart('bar', ['Strain', 'WT', 'KO'], [['a', 1, 2], ['b', 2, 3]], 400, 20, 380, 280);
    render();
  });
}
const setSelect = (page, id, value) => page.evaluate(([id, v]) => {
  const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

// ── charts-18, charts-31, phage-31: one font across the figure ───────────────────────
// Before: Look › Font family changed the letters only; every chart, gene-map and key
// <text> in the SVG stayed system-ui.
test('charts-18: the figure font reaches chart, gene-map and key text, in the SVG too', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  await page.evaluate(() => { addGenemapElement('linear'); closeGenemapModal();
    const g = freeformElements[freeformElements.length - 1]; Object.assign(g, { x: 20, y: 400, w: 700, h: 160 }); render(); });
  await page.locator('#label-font').selectOption({ label: 'Arial' });
  await page.evaluate(() => { document.getElementById('export-acc').open = true; });
  await page.locator('#key-on-figure').check();
  const r = await page.evaluate(async () => {
    render();
    const svg = __txt(await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas'))));
    const key = __txt(await _captureDownload(() => doExport('svg', { key: true })));
    const fams = __svgTexts(svg).map(t => t.fam);
    return { n: fams.length, sys: fams.filter(f => /system-ui/.test(f)).length, arial: fams.filter(f => /^Arial/.test(f)).length,
      keyFont: (/<text [^>]*style="font:([^"]*)"/.exec(key) || [])[1] || '' };
  });
  expect(r.n).toBeGreaterThan(10);
  expect(r.sys).toBe(0);                         // was every one of them
  expect(r.arial).toBe(r.n);
  expect(r.keyFont).toMatch(/Arial/);
  expect(errors).toEqual([]);
});

// ── charts-19, charts-43, phage-31, fluor-19: sizes in points at the printed width ──
// Before: chart text was 11 px whatever the chart or the printed width (≈ 4.5 pt at
// 173 mm on a 1200 px canvas), gene-map text 9–13 px, scale-bar text 10 px per 300 px of
// panel, and nothing set any of it.
test('charts-19: chart, gene-map, scale-bar text and the key print at Text size pt, whatever the width or the chart size', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  await page.evaluate(() => { addGenemapElement('linear'); closeGenemapModal();
    const g = freeformElements[freeformElements.length - 1]; Object.assign(g, { x: 20, y: 400, w: 700, h: 160 });
    const im = freeformElements[0]; im.umPerPx = 0.5; im.sbUm = 20; im.sbOn = true; render(); });
  await setSelect(page, 'export-width-mm', '173');
  await page.locator('#text-pt').fill('8');
  const pts = () => page.evaluate(() => { render(); const k = _physFacts().ptPerPx, T = _figTextSizes();
    const by = kind => T.filter(t => t.kind === kind).map(t => t.fs * k);
    return { k, chart: Math.min(...by('chart')), genemap: Math.min(...by('genemap')), sb: Math.min(...by('sb')),
      readout: document.getElementById('type-readout').textContent }; });
  const a = await pts();
  expect(a.chart).toBeGreaterThanOrEqual(7.99);      // was 11 px × 0.41 = 4.5 pt
  expect(a.genemap).toBeGreaterThanOrEqual(7.99);
  expect(a.sb).toBeCloseTo(8, 1);
  expect(a.readout).toMatch(/173 mm/);
  // resize the chart: same printed size
  await page.evaluate(() => { const c = freeformElements.find(e => e.type === 'chart'); c.w = 560; c.h = 400; render(); });
  expect((await pts()).chart).toBeCloseTo(a.chart, 2);
  // a narrower printed width: the points stand, the px grow
  await setSelect(page, 'export-width-mm', '89');
  const b = await pts();
  expect(b.k).toBeLessThan(a.k);
  expect(b.chart).toBeCloseTo(a.chart, 2);
  expect(b.sb).toBeCloseTo(8, 1);
  // the key placed on the figure and the key file are at the text size too
  const key = await page.evaluate(() => _keyFs() * _physFacts().ptPerPx);
  expect(key).toBeCloseTo(8, 1);
  expect(errors).toEqual([]);
});

// ── charts-27, freeform-24, fluor-19: journal presets in points ──────────────────────
// Before: presets wrote 8–9 into the px fields: on a 1200 px canvas at 173–183 mm that is
// 2.6–3.7 pt, and the Export readout then warned about the preset's own letters.
test('charts-27: choosing a journal sets letters, headings and text in points that print at that size', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  for (const [j, min] of [['plos', 8], ['embo', 7.9], ['elife', 7]]) {
    await setSelect(page, 'target-journal', j);
    const r = await page.evaluate(() => { render(); const k = _physFacts().ptPerPx, T = _figTextSizes();
      const letters = T.filter(t => t.kind === 'panel').map(t => t.fs * k), chart = T.filter(t => t.kind === 'chart').map(t => t.fs * k);
      return { letters: Math.min(...letters), chart: Math.min(...chart), toast: document.getElementById('toast').textContent,
        readout: document.getElementById('phys-readout').textContent }; });
    expect(r.letters, j).toBeGreaterThanOrEqual(min);
    expect(r.chart, j).toBeGreaterThanOrEqual(Math.min(min, 7) - 0.01);
    expect(r.toast, j).toMatch(/letters [\d.]+ pt/);
    expect(r.readout, j).not.toMatch(/below the/);
  }
  // PLOS states 8–12 pt: its compliance text row passes with the whole figure measured
  await page.evaluate(() => { applyPreset('plos'); render(); });
  const row = await page.evaluate(() => { const r = __row('Text size'); __close(); return r; });
  expect(row.icon).toBe('✓');
  expect(row.text).toMatch(/chart text/);
  expect(errors).toEqual([]);
});

// ── freeform-26: letter size reachable in freeform ───────────────────────────────────
// Before: Look › Panel letters was hidden in freeform behind a note pointing at a props
// bar with no size control, and the Export readout read the grid's letter size.
test('freeform-26: in freeform the panel-letter size is in Look, in pt, and the readout follows it', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  await setSelect(page, 'export-width-mm', '180');
  await page.evaluate(() => { document.querySelectorAll('details').forEach(d => { if (/Look/.test(d.querySelector('summary').textContent)) d.open = true; }); });
  const pt = page.locator('#label-pt');
  await expect(pt).toBeVisible();
  await pt.fill('8');
  const r = await page.evaluate(() => { render(); const k = _physFacts().ptPerPx, fu = _ffFurniture(freeformElements[0]);
    return { pt: fu.label.fs * k, readout: document.getElementById('phys-readout').textContent,
      note: document.getElementById('look-ff-note').textContent }; });
  expect(r.pt).toBeCloseTo(8, 1);
  expect(r.readout).toMatch(/smallest text ≈ [\d.]+ pt/);
  expect(r.note).not.toMatch(/properties bar above the canvas\.$/);
  await expect(page.locator('#label-pos')).toBeHidden();      // grid-only parts stay hidden
  expect(errors).toEqual([]);
});

// ── Sessions saved in px still open at the size they were saved at ──────────────────
test('a figure saved before points existed opens with its letters at the same px and printed size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('export-width-mm', '89'); sv('label-size', '30'); sv('axis-fs', '15'); render();
    const s = JSON.parse(JSON.stringify(serializeSession(true)));
    delete s.style.labelPt; delete s.style.axisPt; delete s.style.textPt;     // as an older FigureLab wrote it
    sv('label-size', '12'); sv('export-width-mm', '0'); render();
    applySession(s, { noUndo: true }); render();
    const k = _physFacts().ptPerPx;
    const lp = figTextItems.find(t => t.kind === 'panel');
    return { px: gf('label-size'), drawn: lp && lp.fs, pt: +gv('label-pt'), k, session: s };
  });
  expect(r.px).toBe(30);
  expect(r.drawn).toBe(30);
  expect(r.pt).toBeCloseTo(30 * r.k, 1);
  // …and opened into a fresh tab, where no layout has been drawn yet to measure from
  await page.goto('about:blank');
  const errors2 = await loadApp(page);
  const r2 = await page.evaluate(async (s) => {
    await applySession(s, { noUndo: true });
    await new Promise(res => { const t0 = Date.now(); (function w() { if (images.length && images.every(im => !im || im.img) || Date.now() - t0 > 5000) res(); else setTimeout(w, 30); })(); });
    render(); render();
    const lp = figTextItems.find(t => t.kind === 'panel');
    return { px: gf('label-size'), drawn: lp && lp.fs, pt: +gv('label-pt'), k: _physFacts().ptPerPx };
  }, r.session);
  expect(r2.px).toBe(30);
  expect(r2.drawn).toBe(30);
  expect(r2.pt).toBeCloseTo(30 * r2.k, 1);
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

// ── charts-32, phage-30: the text-size rows measure all text and name the smallest ──
// Before: PLOS read "Text size: scale-bar text 8.6 pt ✓" and ASM "15/15 passed" while
// every chart label printed at 4.5–5.6 pt; neither row looked at charts or annotations.
test('charts-32 / phage-30: compliance measures chart, gene-map and annotation text, and fails the smallest', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  await page.evaluate(() => { annotations.push({ type: 'text', xf: 0.05, yf: 0.9, text: '10^{-3} dilution', fontSize: 10, color: '#000000' }); render(); });
  const r = await page.evaluate(() => {
    sv('export-width-mm', '173'); sv('text-pt', '4.5'); render();
    applyPreset('plos'); sv('text-pt', '4.5'); render();
    const plos = __row('Text size'); __close();
    applyPreset('asm'); sv('text-pt', '4.5'); render();
    const asmRep = __report(); const asm = asmRep.rows.find(x => x.label === 'Text size'); __close();
    return { plos, asm, asmTitle: asmRep.title };
  });
  expect(r.plos.icon).toBe('✗');
  expect(r.plos.text).toMatch(/chart text/);
  expect(r.plos.text).toMatch(/smallest: /);
  expect(r.asm.icon).toBe('✗');                        // ASM states no size: FigureLab's 5 pt floor
  expect(r.asm.text).toMatch(/smallest text: (chart text|annotation text)/);
  expect(r.asm.text).toMatch(/ASM states no type size/);
  // the fix raises everything Fit can set, as one undo step
  const fixed = await page.evaluate(() => { checkCompliance(); const d0 = undoStack.length;
    const b = [...document.querySelectorAll('#info-modal-bg .compliance-row')].find(e => e.querySelector('.c-label').textContent.trim() === 'Text size').querySelector('button');
    b.click(); const row = __rows().find(x => x.label === 'Text size'); __close(); return { row, steps: undoStack.length - d0, textPt: +gv('text-pt'), sm: _figSmallestText(_physFacts().ptPerPx) }; });

  expect(fixed.steps).toBe(1);
  // ux2 (phage2-06): the button raises to 6 pt, the size production desks accept; the
  // annotation's 10⁻³ exponent, at 70 % of its text, may still be flagged as a warning
  expect(fixed.textPt).toBeGreaterThanOrEqual(6);
  expect(fixed.row.icon).not.toBe('✗');
  expect(errors).toEqual([]);
});

// ── freeform-25: no journal's report passes 3.4 pt letters, or claims embedded fonts ──
test('freeform-25: EMBO J fails 3.4 pt letters and does not vouch for embedded fonts', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  const r = await page.evaluate(() => { applyPreset('embo'); sv('label-pt', '3.4'); render();
    const rep = __report(); __close(); return { text: rep.rows.find(x => x.label === 'Text size'), letters: rep.rows.find(x => x.label === 'Panel letters') }; });
  expect(r.text.icon).toBe('✗');
  expect(r.text.text).toMatch(/3\.4 pt/);
  expect(r.letters.text).toMatch(/embedding is not checked/i);
  expect(errors).toEqual([]);
});

// ── newcomer-02: a panel-resolution row for every journal ────────────────────────────
test('newcomer-02: the Nature check flags a 90 ppi panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(() => { applyPreset('nature'); render(); const row = __row('Panel resolution'); __close(); return row; });
  expect(r).not.toBeNull();                             // the row did not exist for Nature
  expect(r.icon).toBe('⚠');
  expect(r.text).toMatch(/ppi/);
  expect(r.text).toMatch(/Nature states no resolution for photographs/);
  expect(errors).toEqual([]);
});

// ── newcomer-03: text contrast is measured; white on white fails ────────────────────
// Before: "Text contrast ✓ … panel letters sit over image pixels — not checked".
test('newcomer-03: white letters on a white panel fail Text contrast, and Auto contrast fixes it', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 200; const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 200); x.fillStyle = '#222'; x.fillRect(80, 80, 40, 40);
    const src = c.toDataURL('image/png');
    for (const n of ['white_chart.png', 'white_blot.png']) await new Promise(res => { const im = new Image(); im.onload = () => { _commitImage(im, src, n); res(); }; im.src = src; });
    render();
  });
  await page.evaluate(HELPERS);
  await page.evaluate(() => { document.querySelectorAll('details').forEach(d => { if (/Look/.test(d.querySelector('summary').textContent)) d.open = true; }); });
  await page.evaluate(() => sc('label-auto-color', false));
  // untick the chip: Auto contrast switches itself on…
  await page.locator('#label-bg').uncheck();
  expect(await page.evaluate(() => gc('label-auto-color'))).toBe(true);
  // …and a figure that turned it off again is caught by the report
  const r = await page.evaluate(() => { sc('label-auto-color', false); sv('label-color', '#ffffff'); render();
    const rep = __report(); return rep.rows.find(x => x.label === 'Text contrast'); });
  expect(r.icon).toBe('✗');
  expect(r.text).toMatch(/panel letters “A”/);
  expect(r.text).not.toMatch(/not checked/);
  await page.locator('#info-modal-bg .compliance-row').filter({ has: page.locator('.c-label', { hasText: /^Text contrast$/ }) }).locator('button').click();
  const after = await page.evaluate(() => { const row = __rows().find(x => x.label === 'Text contrast') || null; __close(); return row; });
  expect(after).toBeNull();                             // no journal: the row shows only while it flags something
  expect(await page.evaluate(() => gc('label-auto-color'))).toBe(true);
  expect(errors).toEqual([]);
});

// ── An information row is not a pass ─────────────────────────────────────────────────
test('rows that checked nothing say so (ℹ) and are not counted as passed', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(() => { applyPreset('plos'); render(); const rep = __report(); __close(); return rep; });
  const fmt = r.rows.find(x => x.label === 'Export format');
  expect(fmt.icon).toBe('ℹ');
  expect(fmt.text).toMatch(/not checked/);
  const [, pass, total] = /(\d+)\/(\d+) passed/.exec(r.title).map(Number);
  expect(pass).toBe(r.rows.filter(x => x.icon === '✓').length);
  expect(total).toBe(r.rows.filter(x => ['✓', '✗', '⚠'].includes(x.icon)).length);
  expect(r.rows.filter(x => x.icon === '✓' && /Does not apply|not checked/.test(x.text))).toEqual([]);
  expect(errors).toEqual([]);
});

// ── charts-29: one key row per sample, listing its marks ─────────────────────────────
test('charts-29: a strain drawn as beeswarm points and as a line is one key row listing both marks', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  const r = await page.evaluate(() => {
    freeformElements.length = 0;
    const a = __chart('beeswarm', ['Strain', 'v'], [['WT', 1], ['WT', 1.2], ['ΔfliC', 2], ['ΔfliC', 2.1]], 20, 20, 380, 280);
    a.mapping = Object.assign(a.chart.mapping, { xCol: 0, yCols: [1] });
    const b = __chart('line', ['t', 'WT', 'ΔfliC'], [[0, 1, 1], [1, 2, 1.5], [2, 3, 2]], 420, 20, 380, 280);
    b.chart.style.showPoints = true; b._chartKey = '';
    render();
    return { rows: _figureKey().map(k => k.name), text: _keyText() };
  });
  expect(r.rows).toEqual(['WT', 'ΔfliC']);
  expect(r.text).toMatch(/^WT \([a-z ]+, filled circles and solid line with filled circles\); ΔfliC/);
  expect(errors).toEqual([]);
});

// ── fluor-18: channels named by the author; the key follows the tags ─────────────────
test('fluor-18: one row per channel colour, named by its tag, renameable in Export › Legend key', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(HELPERS);
  await page.evaluate(async () => {
    const [A, B, C] = images;
    A.name = 'cells_dapi.tif'; A.lut = 'blue';
    B.name = 'cells_rfp.tif'; B.lut = 'magenta'; B.tag = 'CellMask';
    C.name = 'merge.tif'; C.lut = 'green';
    // the merge's second channel, guessed from its file name as "GFP", shown in magenta
    const cv = document.createElement('canvas'); cv.width = cv.height = 100;
    C.channels = [{ name: 'cells_gfp_membrane.tif', lut: 'magenta', img: cv }];
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); render();
  });
  const before = await page.evaluate(() => _keyText());
  expect(before).toBe('DAPI (blue); CellMask (magenta); GFP (green).');   // was "…; RFP (magenta); GFP (magenta)."
  // rename the green channel in the key's Channel names
  await page.evaluate(() => { document.getElementById('export-acc').open = true; render(); });
  const green = page.locator('#key-names-ui input[data-lut="green"]');
  await green.scrollIntoViewIfNeeded();
  await green.fill('GFP-LC3'); await green.press('Enter'); await green.blur();
  const r = await page.evaluate(() => { render(); sc('tag-channels', true); render();
    return { text: _keyText(), tag: _panelTagParts(images[2], '#fff').map(p => p.str), steps: undoStack.length }; });
  expect(r.text).toBe('DAPI (blue); CellMask (magenta); GFP-LC3 (green).');
  expect(r.tag[0]).toBe('GFP-LC3');                     // the tags' channel names follow
  await page.evaluate(() => { undo(); render(); });
  expect(await page.evaluate(() => _keyText())).toBe(before);
  expect(errors).toEqual([]);
});

// ── newcomer-17, fluor-31: a panel shown in grey has a grey swatch, not an invisible one ──
test('newcomer-17: a greyscale panel is keyed with a grey ramp and "greyscale", visible in the PNG and SVG', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    images[0].name = 'a_GFP.tif'; render();
    const svg = __txt(await _captureDownload(() => doExport('svg', { key: true })));
    const png = await _captureDownload(() => doExport('png', { key: true }));
    const bmp = await createImageBitmap(new Blob([png.data], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && Math.abs(d[i] - d[i + 1]) < 4) dark++;
    return { text: _keyText(), grad: /<linearGradient/.test(svg), outline: /stroke="#808080"/.test(svg), dark };
  });
  expect(r.text).toBe('GFP (greyscale).');
  expect(r.grad).toBe(true);
  expect(r.outline).toBe(true);
  expect(r.dark).toBeGreaterThan(20);                   // the ramp's dark end is on the page
  expect(errors).toEqual([]);
});

// ── phage-28, charts-30: the placed key is the standalone key, in a free corner ──────
test('phage-28: the placed key avoids the pictures and matches the key file pixel for pixel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 20, y: 20, w: 300, h: 300, lut: 'green', name: 'gfp.tif', fill: '#202020' },
    { type: 'image', x: 340, y: 20, w: 300, h: 300, lut: 'magenta', name: 'rfp.tif', fill: '#202020' },
  ]);
  await page.evaluate(HELPERS);
  await page.evaluate(() => { sv('fm-canvas-w', '900'); sv('fm-canvas-h', '600'); render(); document.getElementById('export-acc').open = true; });
  await page.locator('#key-on-figure').check();
  const r = await page.evaluate(async () => {
    render(); sv('export-dpi', '300');
    const a = annotations.find(x => x.type === 'legend'), W = canvasLogicalW, H = canvasLogicalH;
    const box = { x: a.xf * W, y: a.yf * H, w: a._w, h: a._h };
    const over = freeformElements.some(e => !(box.x >= e.x + e.w || box.x + box.w <= e.x || box.y >= e.y + e.h || box.y + box.h <= e.y));
    // the figure at 300 DPI, and the key file at the same scale
    const fig = renderExportCanvas(300), S = fig._exportScale, key = _keyCanvas(300);
    const fx = fig.getContext('2d').getImageData(Math.round(box.x * S), Math.round(box.y * S), key.width, key.height).data;
    const kx = key.getContext('2d').getImageData(0, 0, key.width, key.height).data;
    let diff = 0, n = 0; for (let i = 0; i < kx.length; i += 4) { diff += Math.abs(fx[i] - kx[i]) + Math.abs(fx[i + 1] - kx[i + 1]) + Math.abs(fx[i + 2] - kx[i + 2]); n++; }
    // the chip: the figure's white background, black names (it was a translucent black chip)
    const st = _keyAnnStyle(a);
    return { over, meanDiff: diff / n / 3, st, keyW: key.width };
  });
  expect(r.over).toBe(false);                            // was the top-right corner, over the picture
  expect(r.st).toEqual({ ink: '#000000', bg: '#ffffff', bgOpacity: 1 });
  expect(r.meanDiff).toBeLessThan(6);                    // the same pixels, up to sub-pixel placement
  // the float toolbar no longer offers colours the key does not use
  expect(errors).toEqual([]);
});

// ── freeform-31, blot-14: a key with nothing in it says why ─────────────────────────
test('freeform-31: Download key on a figure with nothing to key says why, instead of nothing', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 200, name: 'colonies.png' }]);
  await page.evaluate(HELPERS);
  await page.evaluate(() => { document.getElementById('export-acc').open = true; render(); });
  await page.locator('#key-dl-btn').click();
  await expect(page.locator('#toast')).toContainText('nothing to key');
  await expect(page.locator('#key-why')).toBeVisible();
  await expect(page.locator('#key-why')).toContainText('Pictures without a lookup table');
  await page.locator('#key-on-figure').click();
  await expect(page.locator('#key-on-figure')).not.toBeChecked();
  expect(await page.evaluate(() => annotations.filter(a => a.type === 'legend').length)).toBe(0);   // no empty key placed
  // blot-14: a chart that came in as an SVG picture is named as the reason
  const why = await page.evaluate(() => { freeformElements[0].isVector = true; render(); return _keyEmptyWhy(); });
  expect(why).toMatch(/SVG picture/);
  // the ▤ Key tool does not drop an empty key either
  const click = () => page.evaluate(() => { setTool('legend');
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const at = { clientX: r.left + r.width * 0.8, clientY: r.top + r.height * 0.8, button: 0, bubbles: true };
    c.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1 })); c.dispatchEvent(new MouseEvent('mouseup', at));
    setTool('none'); return annotations.filter(a => a.type === 'legend').length; });
  expect(await click()).toBe(0);
  await page.evaluate(() => { freeformElements[0].isVector = false; freeformElements[0].lut = 'green'; render(); });
  expect(await click()).toBe(1);                         // with something to key, the same click places it
  expect(errors).toEqual([]);
});

// ── freeform-26: ⌘K finds the type sizes ─────────────────────────────────────────────
// Before: "font size" and "letter size" found nothing in the command palette.
test('freeform-26: ⌘K "font size" and "letter size" reach the point-size fields', async ({ page }) => {
  const errors = await loadApp(page);
  await freeformFigure(page);
  for (const [q, id] of [['font size', 'text-pt'], ['letter size', 'label-pt']]) {
    await page.evaluate(() => openCmdPalette());
    await page.locator('#cmdp-input').fill(q);
    await page.locator('#cmdp-input').press('Enter');
    await expect(page.locator('#' + id)).toBeFocused();
    await expect(page.locator('#' + id)).toBeVisible();
  }
  expect(errors).toEqual([]);
});
