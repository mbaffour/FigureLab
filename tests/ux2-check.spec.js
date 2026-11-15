// @ts-check
// Usability round 2 — the compliance check, where the legend key goes, and type sizes.
// Each test is a round-2 finding driven the way the tester met it (the visible control
// where there is one), and each fails on the build they tested (8f686a6).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const HELPERS = `
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fix: e.querySelector('button') ? e.querySelector('button').textContent.trim() : null }));
  window.__report = () => { checkCompliance(); return { title: document.getElementById('im-title').textContent, rows: __rows() }; };
  window.__row = (l) => __report().rows.find(r => r.label === l) || null;
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
  // the placed key's box, and what of the figure it covers (pictures, charts, text)
  window.__keyBox = () => { const a = annotations.find(x => x && x.type === 'legend'); if (!a) return null;
    const fs = _keyFs(), L = _keyLayout(_figureKey(), fs, _keyFont(fs)), W = canvasLogicalW, H = canvasLogicalH;
    return { x: a.xf * W, y: a.yf * H, w: L.w, h: L.h, W, H, auto: a.auto }; };
  window.__covers = () => { const k = __keyBox(); if (!k) return null;
    const ov = (b) => Math.max(0, Math.min(k.x + k.w, b.x + b.w) - Math.max(k.x, b.x)) * Math.max(0, Math.min(k.y + k.h, b.y + b.h) - Math.max(k.y, b.y));
    const rects = layoutMode === 'freeform' ? freeformElements.filter(e => e && !e.hidden).map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h, what: e.type }))
      : panelBounds.filter(b => images[b.idx]).map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, what: 'panel ' + formatLabel(images[b.idx].label) }));
    figTextItems.forEach(t => { if (t.bbox && String(t.str || '').trim()) rects.push({ ...t.bbox, what: t.kind + ' ' + t.str }); });
    return { hit: rects.filter(b => ov(b) > 1).map(b => b.what), off: k.x < -0.5 || k.y < -0.5 || k.x + k.w > k.W + 0.5 || k.y + k.h > k.H + 0.5 }; };
  // a grid chart panel with data, as the chart dialog leaves it
  window.__gridChart = (kind, columns, rows) => { addChartElement(kind); closeChartModal();
    const el = images[images.length - 1];
    el.chart.data = { columns, rows, source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = columns.slice(1).map((_, i) => i + 1);
    el._chartKey = ''; el._chartStat = null; return el; };
`;
const openExport = (page) => page.evaluate(() => { document.getElementById('export-acc').open = true; });

// A fluorescence grid: DAPI / GFP / magenta pictures with letters, as fluor and the
// journal guide built it.
async function channelGrid(page, n = 4, cols = 2) {
  await seedPanels(page, n);
  await page.evaluate(HELPERS);
  await page.evaluate(([cols]) => {
    const luts = ['blue', 'green', 'magenta', 'green', 'blue', 'magenta'];
    images.forEach((im, i) => { im.lut = luts[i % luts.length]; im.name = ['dapi', 'gfp', 'mcherry', 'gfp2', 'dapi2', 'rfp2'][i] + '.tif'; });
    sv('cols', String(cols)); sv('rows', String(Math.ceil(images.length / cols))); onLayoutChange(); render();
  }, [cols]);
}

// ── Legend key placement ─────────────────────────────────────────────────────────────
// ISSUES "The placed legend key covers panel letter A with default margins", phage2-13,
// newcomer2-06: the key went top-left over panel A's letter (or a few px into panel a).
test('ISSUES/phage2-13/newcomer2-06: Place the key on the figure never covers a panel or a letter, at default margins', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({ c: __covers(), k: __keyBox(), mr: gv('m-right') }));
  expect(r.c.hit).toEqual([]);
  expect(r.c.off).toBe(false);
  expect(r.k.auto).toBe(true);
  // the report has a row for it, and it passes
  const row = await page.evaluate(() => { const r = __row('Legend key on the figure'); __close(); return r; });
  expect(row.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// charts2-02: a 3 × 2 grid of charts with one empty cell; the key went over panel A.
test('charts2-02: on a grid with an empty cell the key goes into free space, not over chart A', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) __gridChart('bar', ['Strain', 'PAO1', 'dpilA'], [['a', 1e8, 2e9], ['b', 3e9, 4e8]]);
    sv('cols', '3'); sv('rows', '2'); onLayoutChange(); render();
  });
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({ c: __covers(), k: __keyBox(), cells: panelBounds.map(b => [b.x, b.y, b.w, b.h]) }));
  expect(r.c.hit).toEqual([]);
  expect(r.c.off).toBe(false);
  // the empty sixth cell is the free space: below panel C, right of panel E
  const C = r.cells[2], E = r.cells[4];
  expect(r.k.x).toBeGreaterThanOrEqual(E[0] + E[2]);
  expect(r.k.y).toBeGreaterThanOrEqual(C[1] + C[3]);
  expect(errors).toEqual([]);
});

// fluor2-06: a key placed in a 90 px right margin; the eLife preset raised the text to
// 8 pt and the key was cut at the figure edge in the exported TIFF ('TFEB-', 'Memb').
test('fluor2-06: after a journal preset enlarges the text, the placed key moves or makes room and is whole in the export', async ({ page }) => {
  const errors = await loadApp(page);
  // five conditions × two rows of 400 px fields, a 90 px right margin, no printed width
  await page.evaluate(async () => {
    const mk = () => { const c = document.createElement('canvas'); c.width = 400; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, 400, 400); return c.toDataURL('image/png'); };
    for (let i = 0; i < 10; i++) { const src = mk(); await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, ['DAPI', 'TFEB-GFP', 'Membrane'][i % 3] + '_' + i + '.tif'); res(); }; img.src = src; }); }
    images.forEach((im, i) => { im.lut = ['blue', 'green', 'magenta'][i % 3]; });
    sv('cols', '5'); sv('rows', '2'); onLayoutChange(); sv('m-right', '90'); render();
  });
  await page.evaluate(HELPERS);
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => __keyBox());
  await page.locator('#target-journal').selectOption('elife');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    render();
    const k = __keyBox(), c = __covers();
    // the figure at 300 DPI against the standalone key at the same scale, pixel for pixel
    const fig = renderExportCanvas(300), S = fig._exportScale, key = _keyCanvas(300);
    const X = Math.round(k.x * S), Y = Math.round(k.y * S);
    const inside = X >= 0 && Y >= 0 && X + key.width <= fig.width + 1 && Y + key.height <= fig.height + 1;
    const fx = fig.getContext('2d').getImageData(X, Y, key.width, key.height).data;
    const kx = key.getContext('2d').getImageData(0, 0, key.width, key.height).data;
    let diff = 0, n = 0; for (let i = 0; i < kx.length; i += 4) { diff += Math.abs(fx[i] - kx[i]) + Math.abs(fx[i + 1] - kx[i + 1]) + Math.abs(fx[i + 2] - kx[i + 2]); n++; }
    const row = __row('Legend key on the figure'); __close();
    return { k, c, inside, meanDiff: diff / n / 3, row };
  });
  expect(r.k.w).toBeGreaterThan(before.w);          // the key did grow with the text
  expect(r.c.off).toBe(false);
  expect(r.c.hit).toEqual([]);
  expect(r.inside).toBe(true);
  // the placed key is the standalone key, whole (up to sub-pixel placement at 1.25 px/px)
  expect(r.meanDiff).toBeLessThan(14);
  expect(r.row.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// phage2-13 / charts2-02: a key dragged over a panel is flagged by the check, and its
// button puts it back in free space; a key moved by hand is not moved by FigureLab.
test('phage2-13: a key dragged over panel A stays put, the check flags it, and "Move to free space" fixes it', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  // drag the key onto panel A's corner, as a user would with the Select tool
  await page.evaluate(() => {
    const a = annotations.find(x => x.type === 'legend'), i = annotations.indexOf(a), b = panelBounds.find(p => p.idx === 0);
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect(), W = c.width, H = c.height;
    annDragState = { idx: i, mx: a.xf * W, my: a.yf * H, ox0f: a.xf, oy0f: a.yf };
    const tx = (b.x + 2) / canvasLogicalW * W + (annDragState.mx - a.xf * W), ty = (b.y + 2) / canvasLogicalH * H;
    c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: r.left + tx * r.width / W, clientY: r.top + ty * r.height / H }));
    annDragState = null; render();
  });
  const moved = await page.evaluate(() => ({ auto: annotations.find(x => x.type === 'legend').auto, c: __covers() }));
  expect(moved.auto).toBe(false);
  expect(moved.c.hit.length).toBeGreaterThan(0);
  // a later layout change does not move a key put somewhere by hand
  const kept = await page.evaluate(() => { sv('gap-h', '14'); render(); return { auto: annotations.find(x => x.type === 'legend').auto, c: __covers() }; });
  expect(kept.auto).toBe(false);
  expect(kept.c.hit.length).toBeGreaterThan(0);
  await page.evaluate(() => checkCompliance());
  const row = page.locator('#info-modal-bg .compliance-row', { hasText: 'Legend key on the figure' });
  await expect(row).toContainText('covers');
  await expect(row).toContainText('panel letter A');
  await expect(row.locator('.c-icon')).toHaveText('⚠');
  await row.getByRole('button', { name: 'Move to free space' }).click();
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => { const o = { c: __covers(), auto: __keyBox().auto, row: __row('Legend key on the figure') }; __close(); return o; });
  expect(after.c.hit).toEqual([]);
  expect(after.auto).toBe(true);
  expect(after.row.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// The standing rule's one simple control: a corner or an edge. "Below" puts it under the
// figure, in a bottom margin grown for it, and says so.
test('legend key Where: Below puts the key under the panels, grows the bottom margin and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  const m0 = await page.evaluate(() => +gv('m-btm'));
  await page.locator('#key-where').selectOption('bottom');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ k: __keyBox(), c: __covers(), mb: +gv('m-btm'), panelsBottom: Math.max(...panelBounds.filter(b => images[b.idx]).map(b => b.y + b.h)) }));
  expect(r.c.hit).toEqual([]);
  expect(r.c.off).toBe(false);
  expect(r.k.y).toBeGreaterThanOrEqual(r.panelsBottom);
  expect(r.mb).toBeGreaterThan(m0);
  await expect(page.locator('#toast')).toContainText('bottom margin grew');
  // one undo step takes the place back
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => (annotations.find(a => a.type === 'legend') || {}).where || 'auto')).toBe('auto');
  expect(errors).toEqual([]);
});

// freeform2-03: the key was drawn bottom-right on top of gene map F (its 8000 tick and
// the 9.6 kb label). On a canvas with no free corner it gets room below the figure.
test('freeform2-03: on a full freeform canvas the key is not drawn over an object — the canvas grows for it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 0, y: 0, w: 600, h: 400, lut: 'green', name: 'ftsz_gfp.tif' },
    { type: 'image', x: 600, y: 0, w: 600, h: 400, lut: 'magenta', name: 'membrane.tif' },
  ]);
  await page.evaluate(HELPERS);
  await page.evaluate(() => { sv('fm-canvas-w', '1200'); sv('fm-canvas-h', '400'); render(); });
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ c: __covers(), H: canvasLogicalH, W: canvasLogicalW }));
  expect(r.c.hit).toEqual([]);
  expect(r.c.off).toBe(false);
  expect(r.H * r.W).toBeGreaterThan(1200 * 400);
  expect(errors).toEqual([]);
});

// ISSUES: a session saved before keys were marked carries a key over panel A's letter;
// opened again, it is moved into free space (a key that covers nothing is left alone).
test('ISSUES: a key from an older session that covers panel A is moved into free space when the figure is drawn', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  const r = await page.evaluate(async () => {
    annotations.push({ type: 'legend', xf: 0.01, yf: 0.01, width: 1 });   // as the old switch left it
    render();
    await new Promise(res => setTimeout(res, 50));                       // room is made after the render
    const old = __covers();
    return { old, auto: annotations.find(a => a.type === 'legend').auto };
  });
  expect(r.old.hit).toEqual([]);
  expect(r.auto).toBe(true);
  expect(errors).toEqual([]);
});

// ISSUES: "The key also keeps a stale place after layout changes until it is re-ticked."
test('ISSUES: the placed key follows a layout change (a column more) without being re-ticked', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  await page.evaluate(() => { sv('cols', '4'); sv('rows', '1'); onLayoutChange(); render(); });
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => __covers());
  expect(r.hit).toEqual([]);
  expect(r.off).toBe(false);
  expect(errors).toEqual([]);
});

// ── Text size: every text the figure prints ──────────────────────────────────────────
// charts2-01 (charts-32): at Look › Text size 5 pt the PLOS report still read "Text size ✓
// panel letters 10.0 pt" — chart panels in a grid were not measured, nor the log-axis
// exponents (10⁶…10¹⁰) and the ⁻¹ of CFU mL⁻¹ at 70% of their text (5.6 pt at 8 pt).
test('charts2-01: the Text size row measures chart text in grid chart panels, and their exponents', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) { const el = __gridChart('bar', ['Strain', 'PAO1', 'dpilA'], [['a', 1e8, 2e9], ['b', 3e9, 4e8]]);
      el.chart.axes.y.log = true; el.chart.axes.y.title = 'CFU mL^{-1}'; }
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); render();
  });
  await page.locator('#target-journal').selectOption('plos');
  await page.evaluate(() => { const e = document.getElementById('text-pt'); e.value = '5'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); render(); });
  let row = await page.evaluate(() => { const r = __row('Text size'); return r; });
  expect(row.icon).toBe('✗');
  expect(row.text).toContain('chart text');
  expect(row.text).toMatch(/chart text 5\.\d/);
  // Fit brings the chart text to 8 pt; the exponents, at 70 % of it, are still under 8 pt and
  // are flagged on their own — a warning that says how to raise them
  await page.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' }).getByRole('button', { name: /Fit/ }).click();
  await page.waitForTimeout(100);
  row = await page.evaluate(() => { const r = __row('Text size'); __close(); return r; });
  expect(row.icon).toBe('⚠');
  expect(row.text).toContain('Superscripts and subscripts print at 70%');
  expect(row.text).toMatch(/is 5\.\d pt, below 8 pt/);
  // the Export box names it too, in plain words (it read "legend key the placed key")
  const ro = await page.locator('#phys-readout').textContent();
  expect(ro).toContain('chart text');
  expect(ro).toMatch(/superscripts and subscripts 5\.\d pt/);
  expect(errors).toEqual([]);
});

// charts2-20: the Export box read "smallest text = 8.0 pt (legend key the placed key)".
test('charts2-20: the Export box names the placed key in plain words', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 2, 2);
  await page.evaluate(() => { sv('label-pt', '12'); sv('axis-pt', '12'); sv('text-pt', '6'); render(); });
  await openExport(page);
  await page.locator('#key-on-figure').check();
  await page.waitForTimeout(100);
  const ro = await page.locator('#phys-readout').textContent();
  expect(ro).toContain('legend key (placed on the figure)');
  expect(ro).not.toContain('legend key the placed key');
  expect(errors).toEqual([]);
});

// phage2-06 / phage2-19 / ISSUES: a lane table made before the ASM preset kept 13 px —
// 'Dilution' at 5.1 pt and its exponents at 3.5 pt — and Text size passed ✓ because "ASM
// states no type size". The preset now moves lane tables with the headings, and the row
// warns below 6 pt and about a lane table left smaller than the figure's text, with a button.
test('phage2-06: the ASM preset rescales lane tables; one left small is flagged and brought to the text size', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await page.evaluate(() => {
    images[3].laneTable = { rows: [{ name: 'Dilution', cells: ['10^{0}', '10^{-1}', '10^{-2}', '10^{-3}'] }], lanes: 4, pos: 'above', fs: 13 };
    sv('panel-w', '600'); sv('panel-h', '600'); render();
  });
  await page.locator('#target-journal').selectOption('asm');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ fs: images[3].laneTable.fs, ax: gf('axis-fs'), lane: _figTextSizes().filter(t => t.kind === 'lanetable').map(t => t.fs * _physFacts().ptPerPx) }));
  expect(after.fs).toBeGreaterThan(13);
  expect(Math.min(...after.lane)).toBeGreaterThanOrEqual(6);
  // a table left at 13 px (made in an older session, or set by hand) is flagged with a fix
  await page.evaluate(() => { images[3].laneTable = { ...images[3].laneTable, fs: 13 }; render(); });
  await page.evaluate(() => checkCompliance());
  const row = page.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' });
  await expect(row.locator('.c-icon')).toHaveText('⚠');
  await expect(row).toContainText('Lane-table text prints at');
  await expect(row).toContainText('below 6 pt');
  await row.getByRole('button', { name: /Lane tables to/ }).click();
  await page.waitForTimeout(100);
  const fixed = await page.evaluate(() => { const r = __row('Text size'); __close();
    return { r, pt: Math.min(..._figTextSizes().filter(t => t.kind === 'lanetable').map(t => t.fs * _physFacts().ptPerPx)), text: +gv('text-pt') }; });
  expect(fixed.pt).toBeGreaterThanOrEqual(fixed.text - 0.1);
  expect(fixed.r.text).not.toContain('Lane-table text prints at');
  expect(errors).toEqual([]);
});

// phage2-06 in the guide's own figure: a lane-table cell squeezed to fit its lane ("…")
// printed at 5.8 pt. A larger table size cannot help there, so the row says what does and
// offers no button that would do nothing.
test('phage2-06: lane-table text shrunk to fit its lane is flagged with what helps, and no button that cannot', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 4);
  await page.evaluate(() => {
    sv('export-width-mm', '89'); render();
    const fs = (+gv('text-pt')) / _physFacts().ptPerPx;
    images[0].laneTable = { rows: [{ name: 'Phage', cells: ['phiKBA3 wild type lysate', 'phiKBA3 ΔholA lysate', 'buffer only control', 'phiKBA3 + EDTA'] }], lanes: 4, pos: 'above', fs };
    render();
  });
  const r = await page.evaluate(() => { const row = __row('Text size'); __close();
    const set = images[0].laneTable.fs, drawn = Math.min(...figTextItems.filter(t => t.kind === 'lanetable').map(t => t.fs)); return { row, set, drawn }; });
  expect(r.drawn).toBeLessThan(r.set);
  expect(r.row.text).toContain('drawn smaller than its table’s size to fit');
  expect(r.row.text).not.toContain('Lane tables to');
  expect(r.row.icon).not.toBe('✓');
  expect(errors).toEqual([]);
});

// ── Text contrast ────────────────────────────────────────────────────────────────────
// Panels of one flat colour, with an optional dark spot in the top-left corner (where
// the letter goes), committed as an import would.
async function solidPanels(page, colours, spot) {
  await page.evaluate(async ([colours, spot]) => {
    for (let i = 0; i < colours.length; i++) {
      const c = document.createElement('canvas'); c.width = 300; c.height = 300;
      const x = c.getContext('2d'); x.fillStyle = colours[i]; x.fillRect(0, 0, 300, 300);
      if (spot) { x.fillStyle = spot; x.beginPath(); x.arc(22, 20, 11, 0, Math.PI * 2); x.fill(); }   // a spot under the letter's right half
      const src = c.toDataURL('image/png');
      await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, `plate_${i}.png`); res(); }; img.src = src; });
    }
    sv('cols', String(colours.length)); sv('rows', '1'); onLayoutChange(); render();
  }, [colours, spot || null]);
  await page.evaluate(HELPERS);
}

// newcomer2-02 / ISSUES: with Look › Panel Labels › Background ticked (the default), the
// report's Auto contrast button visibly did nothing (white on a .45 chip over a white
// panel, 3.36:1, before and after).
test('newcomer2-02: the Auto contrast button fixes Text contrast with Background ticked, and says what it did', async ({ page }) => {
  const errors = await loadApp(page);
  await solidPanels(page, ['#f4f4f4', '#ffffff', '#e8e8e8']);
  await page.locator('#target-journal').selectOption('nature');
  expect(await page.evaluate(() => gc('label-bg'))).toBe(true);
  await page.evaluate(() => checkCompliance());
  const row = page.locator('#info-modal-bg .compliance-row', { hasText: 'Text contrast' });
  await expect(row.locator('.c-icon')).not.toHaveText('✓');
  await row.getByRole('button', { name: 'Auto contrast' }).click();
  await expect(page.locator('#toast')).toContainText('Auto contrast on');
  const after = await page.evaluate(() => { const r = __row('Text contrast'); __close(); return r; });
  expect(after.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// ISSUES "Auto contrast keeps white text over mid-grey pictures": a phase-contrast photo
// (#8a8a8a) with Background unticked and Auto contrast on kept white letters, 3.45:1.
test('ISSUES: Auto contrast picks black letters on a mid-grey picture, and Text contrast passes', async ({ page }) => {
  const errors = await loadApp(page);
  await solidPanels(page, ['#8a8a8a', '#7d7d7d']);
  await page.evaluate(() => { sc('label-bg', false); sc('label-auto-color', true); render(); });
  const r = await page.evaluate(() => { const ink = figTextItems.filter(t => t.kind === 'panel').map(t => t.fill); const row = __row('Text contrast'); __close(); return { ink, row }; });
  expect(r.ink).toEqual(['#111111', '#111111']);
  expect(r.row === null || r.row.icon === '✓').toBe(true);      // with no journal a passing row is not listed
  expect(errors).toEqual([]);
});

// phage2-04: the black 'D' sat on the dark 10⁰ spot of a spot assay (black on black in the
// canvas, TIFF and SVG) and Text contrast read 19/19 passed: the dark pixels under it were
// taken for its own ink. Measured on the figure drawn without text, it is flagged.
test('phage2-04: a black letter over a dark spot is flagged by Text contrast', async ({ page }) => {
  const errors = await loadApp(page);
  await solidPanels(page, ['#f2f2f2', '#f2f2f2'], '#141414');
  await page.evaluate(() => { sc('label-bg', false); sc('label-auto-color', false); sv('label-color', '#000000'); render(); });
  await page.locator('#target-journal').selectOption('asm');
  const r = await page.evaluate(() => { const row = __row('Text contrast'); __close(); return row; });
  expect(r.icon).not.toBe('✓');
  expect(r.text).toMatch(/panel letters “A”/);
  // and the button fixes it, whatever the picture
  await page.evaluate(() => checkCompliance());
  await page.locator('#info-modal-bg .compliance-row', { hasText: 'Text contrast' }).getByRole('button', { name: 'Auto contrast' }).click();
  const after = await page.evaluate(() => { const row = __row('Text contrast'); __close(); return row; });
  expect(after.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// ── Export format, printed height, the Printed width menu ─────────────────────────────
// newcomer2-03: Nature, PDF (lossless) exported, then a TIFF as well — the row failed
// ("last exported as TIFF — not accepted") although an accepted PDF had just been written.
test('newcomer2-03: Export format passes when any accepted format was exported since the figure last changed', async ({ page }) => {
  // the browser's own Save window cannot be driven: fall back to a download, as the guides' harness does
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const errors = await loadApp(page);
  await channelGrid(page, 2, 2);
  await page.locator('#target-journal').selectOption('nature');
  // through the toolbar and the Save dialog, typing a name, as the tester did
  const save = async (fmt) => {
    await page.locator('button:visible', { hasText: new RegExp('^↓ ' + fmt + '$') }).first().click();
    const m = page.locator('#preflight-modal'); await m.waitFor({ state: 'visible' });
    await m.locator('#pf-name').fill('Fig1');
    const [d] = await Promise.all([page.waitForEvent('download'), m.locator('button', { hasText: /^Save / }).first().click()]);
    await d.path();
  };
  await save('PDF lossless');
  await save('TIFF');
  const both = await page.evaluate(() => { const r = __row('Export format'); __close(); return r; });
  expect(both.icon).toBe('✓');
  expect(both.text).toMatch(/exported as PDF \(lossless\), TIFF since the figure last changed ✓/);
  // a change afterwards: only what is exported from now on counts
  await page.evaluate(() => { pushUndo(); sv('gap-h', '12'); render(); });
  await save('TIFF');
  const tiffOnly = await page.evaluate(() => { const r = __row('Export format'); __close(); return r; });
  expect(tiffOnly.icon).not.toBe('✓');
  expect(errors).toEqual([]);
});

// ISSUES "The Nature preset keeps 183 mm when the figure then prints taller than 170 mm",
// newcomer2-08: the Printed height row was the only ✗ with no button.
test('ISSUES/newcomer2-08: the Nature preset fits a 2 × 2 within 170 mm; Printed height gets a "Set … mm" button', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await page.evaluate(() => { sv('export-width-mm', '0'); render(); });
  await page.locator('#target-journal').selectOption('nature');
  const r = await page.evaluate(() => ({ w: gv('export-width-mm'), h: _physFacts().hMm, toast: document.getElementById('toast').textContent }));
  expect(+r.w).toBe(89);
  expect(r.h).toBeLessThanOrEqual(170.5);
  expect(r.toast).toContain('the widest that keeps it within 170 mm tall');
  // a wider width chosen later fails the row, and its button narrows the figure
  await openExport(page);
  await page.locator('#export-width-mm').selectOption('183');
  await page.evaluate(() => checkCompliance());
  const row = page.locator('#info-modal-bg .compliance-row', { hasText: 'Printed height' });
  await expect(row.locator('.c-icon')).toHaveText('✗');
  await row.getByRole('button', { name: 'Set 89 mm' }).click();
  const after = await page.evaluate(() => { const r = __row('Printed height'); __close(); return { r, w: gv('export-width-mm') }; });
  expect(after.r.icon).toBe('✓');
  expect(+after.w).toBe(89);
  expect(errors).toEqual([]);
});

// A key placed below the figure grows the bottom margin; with a journal preset the height is
// fitted after the key has its room, so the figure stays within the journal's height, the
// key covers nothing and the preset's message is not replaced by the key's.
test('a key placed below the figure and the Nature preset: within 170 mm, key clear, one message', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await openExport(page);
  await page.locator('#key-where').selectOption('bottom');          // places the key below
  await page.waitForTimeout(150);
  await page.locator('#target-journal').selectOption('nature');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ h: _physFacts().hMm, c: __covers(), toast: document.getElementById('toast').textContent, n: annotations.filter(a => a.type === 'legend').length }));
  expect(r.n).toBe(1);
  expect(r.h).toBeLessThanOrEqual(170.5);
  expect(r.c.hit).toEqual([]);
  expect(r.c.off).toBe(false);
  expect(r.toast).toContain('Nature');
  expect(errors).toEqual([]);
});

// newcomer2-17 / freeform2-18: the Printed width menu was wider than the sidebar
// (scrollWidth 563 vs 309); choosing an option scrolled the whole sidebar sideways.
test('newcomer2-17: the Printed width menu fits the sidebar and choosing from it does not scroll it sideways', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 2, 2);
  await openExport(page);
  const sel = page.locator('#export-width-mm');
  await sel.scrollIntoViewIfNeeded();
  await sel.selectOption('183');
  const r = await page.evaluate(() => { const sb = document.getElementById('sidebar'), s = document.getElementById('export-width-mm');
    const a = sb.getBoundingClientRect(), b = s.getBoundingClientRect();
    return { sw: sb.scrollWidth, cw: sb.clientWidth, sl: sb.scrollLeft, selRight: b.right, sbRight: a.right }; });
  expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
  expect(r.sl).toBe(0);
  expect(r.selRight).toBeLessThanOrEqual(r.sbRight + 1);
  expect(errors).toEqual([]);
});

// fluor2-02: 'Same range per channel across panels ✓ (DAPI, GFP, CellMask, TFEB-GFP,
// Membrane)' — five "channels" for three, each matched with itself, so a real mismatch
// between conditions passed. The green channel named GFP (from OME) on one panel and
// TFEB-GFP on the others, at different ranges, is now flagged.
test('fluor2-02: Display ranges flags one colour shown at different ranges under two channel names', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 3, 3);
  const r = await page.evaluate(() => {
    images.forEach(im => { im.lut = 'green'; });
    images[0].chan = 'GFP'; images[0].whitePt = 200;                 // control, from the file's OME name
    images[1].chan = 'TFEB-GFP'; images[1].whitePt = 150;            // the treated conditions, typed
    images[2].chan = 'TFEB-GFP'; images[2].whitePt = 150;
    render();
    const row = __row('Display ranges by channel'); __close();
    images[0].whitePt = 150; render();                                // same range: nothing to flag
    const same = __row('Display ranges by channel'); __close();
    return { row, same };
  });
  expect(r.row.icon).toBe('⚠');
  expect(r.row.text).toContain('One colour under more than one name');
  expect(r.row.text).toMatch(/named GFP \(A: [^)]*\) and TFEB-GFP \(B, C: /);
  expect(r.same.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// ── Typography ──────────────────────────────────────────────────────────────────────
// ISSUES "Panel letter size field and the drawn letters disagree below 7 px", freeform2-19:
// 4 pt typed at 183 mm read 4.65 pt in the field, the letters were drawn at the 7 px floor,
// and the report measured 5.4 pt. The field now shows the size the letters are drawn at.
test('ISSUES/freeform2-19: a letter size below the drawn minimum shows the size drawn, the one the report measures', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await page.evaluate(() => { sv('export-width-mm', '183'); render(); });
  await page.locator('#label-pt').fill('4');
  await page.locator('#label-pt').press('Tab');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => { render(); const k = _physFacts().ptPerPx, drawn = figTextItems.find(t => t.kind === 'panel').fs;
    return { pt: +gv('label-pt'), px: +gv('label-size'), drawnPt: drawn * k, drawn }; });
  expect(r.px).toBeGreaterThanOrEqual(7);
  expect(r.drawn).toBe(r.px);
  expect(r.pt).toBeCloseTo(r.drawnPt, 1);
  expect(errors).toEqual([]);
});

// newcomer2-07: Fit brought letters into Nature's 5–7 pt at a whole px, 6.9 pt.
test('newcomer2-07: Fit puts letters at Nature\'s 7 pt, not a pixel under it', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  await page.locator('#target-journal').selectOption('nature');
  await page.evaluate(() => { sv('label-pt', '9'); render(); checkCompliance(); });
  await page.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' }).getByRole('button', { name: /Fit/ }).click();
  const r = await page.evaluate(() => { render(); const k = _physFacts().ptPerPx; const L = figTextItems.find(t => t.kind === 'panel');
    const row = __row('Text size'); __close(); return { pt: L.fs * k, field: gv('label-pt'), row }; });
  expect(r.pt.toFixed(1)).toBe('7.0');
  expect(r.field).toBe('7');
  expect(r.row.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// freeform2-24 / ISSUES guide note: until a printed width is chosen, mm and pt are at
// 1 px = 1/96 in, which nobody could tell from the pt fields. The Typography readout now
// says how wide the figure prints at that scale and that the points are at that size.
test('freeform2-24: with no printed width the type readout says the figure\'s printed width its points are at', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 2);
  const r = await page.evaluate(() => { sv('export-width-mm', '0'); render();
    return { ro: document.getElementById('type-readout').textContent, mm: _physFacts().wMm }; });
  expect(r.ro).toContain(`prints ${Math.round(r.mm)} mm wide`);
  expect(r.ro).toContain('choose Export › Printed width');
  expect(errors).toEqual([]);
});
