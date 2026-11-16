// @ts-check
// Usability round 3 — the compliance check and its fix buttons, text size and contrast,
// the journal presets' type handling, and what the legend key lists. Each test is a
// round-3 finding (or a round-2 one rechecked as not fixed) driven the way the tester met
// it, and each fails on the build they tested (69576f7).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const HELPERS = `
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fixes: [...e.querySelectorAll('button')].map(b => b.textContent.trim()) }));
  window.__report = () => { checkCompliance(); return { title: document.getElementById('im-title').textContent, rows: __rows() }; };
  window.__row = (l) => __report().rows.find(r => r.label === l) || null;
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
  window.__latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  window.__pdf = async () => __latin1((await _captureDownload(() => _exportPDFWithText('f', 300, { lossless: true }))).data);
  // every text run a PDF content stream sets: {size (pt), t}
  window.__pdfRuns = (pdf) => [...pdf.matchAll(/\\/F\\d+ ([\\d.]+) Tf[^(]*?\\(((?:\\\\.|[^\\\\)])*)\\) Tj/g)]
    .map(m => ({ size: +m[1], t: m[2].replace(/\\\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\\\(.)/g, '$1') }));
`;
// Click a fix button on a report row by its text, as the tester did.
const clickFix = (page, label, text) => page.evaluate(([label, text]) => {
  checkCompliance();
  const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].find(e => e.querySelector('.c-label').textContent.trim() === label);
  const b = row && [...row.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
  if (!b) return false; b.click(); return true;
}, [label, text]);

// ── Text size ────────────────────────────────────────────────────────────────────────
// freeform3-01: a ⬜ TextBox was never measured — Fnt 12 px (2.9 pt) passed the row, and
// "Raise to 6 pt" raised a T Text but left the box at 4.02 pt in the PDF.
test('freeform3-01: the Text size row measures text boxes, and Raise brings them to 6 pt in the PDF', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 60, w: 500, h: 380, label: 'A', iw: 400, ih: 300 }]);
  await page.evaluate(HELPERS);
  await page.evaluate(() => {
    sv('fm-canvas-w', '1328'); sv('fm-canvas-h', '700'); if (typeof onFreeformCanvasSize === 'function') onFreeformCanvasSize();
    sv('export-width-mm', '114');
    annotations.push({ type: 'text', xf: 0.6, yf: 0.2, text: 'AcrB trimer', fontSize: 28, color: '#000000' });
    annotations.push({ type: 'textbox', xf: 0.6, yf: 0.5, x2f: 0.8, y2f: 0.56, text: 'AcrB-msfGFP', fontSize: 12, color: '#ffffff' });
    render();
  });
  const before = await page.evaluate(() => { const r = __row('Text size'); __close(); return r; });
  expect(before.text).toContain('AcrB-msfGFP');
  expect(before.icon).toBe('✗');                                  // 12 px at this width is under 5 pt
  expect(await clickFix(page, 'Text size', 'Raise to 6 pt')).toBe(true);
  const after = await page.evaluate(async () => {
    __close();
    const k = _physFacts().ptPerPx, tb = annotations.find(a => a.type === 'textbox');
    const runs = __pdfRuns(await __pdf());
    const box = runs.filter(r => /AcrB-msfGFP/.test(r.t));
    return { pt: tb.fontSize * k, pdf: box.map(r => r.size), overflow: _tbLayout(tb, canvasLogicalW, canvasLogicalH).overflow, row: __row('Text size') };
  });
  expect(after.pt).toBeGreaterThanOrEqual(5.95);
  expect(after.pdf.length).toBeGreaterThan(0);
  after.pdf.forEach(s => expect(s).toBeGreaterThanOrEqual(5.95));
  expect(after.overflow).toBe(false);                             // the box grew with its words
  expect(after.row.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// ── Text contrast ────────────────────────────────────────────────────────────────────
// Plate photos: a bright plate at the bottom of the frame and the dark surround above, the
// bar on the plate and its text (moved up off it) on the surround — or on a mixed patch.
async function platePanels(page, kind) {
  await page.evaluate(HELPERS);
  await page.evaluate(async (kind) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d');
    x.fillStyle = '#151515'; x.fillRect(0, 0, 600, 600);
    x.fillStyle = '#e8e0c8';
    if (kind === 'stripes') for (let i = 0; i < 600; i += 8) x.fillRect(i, 0, 4, 600);   // too mixed for either ink
    else x.fillRect(0, 480, 600, 120);                                                     // the plate under the bar
    const src = c.toDataURL('image/png');
    for (let i = 0; i < 2; i++) await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, `IMG_44${i}_plate.jpg`); res(); }; img.src = src; });
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    images.forEach(im => { im.umPerPx = 150; im.sbUm = 20000; im.sbOn = true; im.sbUnit = 'mm'; if (kind !== 'stripes') im.sbDY = -60; });
    sc('sb-text', true); sv('sb-color', '#ffffff'); sc('sb-auto-color', false); sc('show-labels', true);
    // white letters with no chip sit on the plate at the bottom left: the ⚠/✗ that offers Auto contrast
    sc('label-bg', false); sv('label-color', '#ffffff'); sv('label-pos', 'bl');
    sv('target-journal', 'asm'); _syncJournalFromControl(); render();
  }, kind);
}
const sbInks = (page) => page.evaluate(() => { render(); return figTextItems.filter(t => t.kind === 'sb').map(t => ({ fill: t.fill, bg: !!t.bg })); });

test('phage3-01: Auto contrast picks scale-bar text ink on the pixels under the text, and never makes the row worse', async ({ page }) => {
  const errors = await loadApp(page);
  await platePanels(page, 'surround');
  const before = await page.evaluate(() => { const r = __row('Text contrast'); __close(); return r; });
  expect(await clickFix(page, 'Text contrast', 'Auto contrast')).toBe(true);
  const after = await page.evaluate(() => { const r = __rows().find(r => r.label === 'Text contrast'); const t = document.getElementById('toast').textContent; __close(); return { r, t }; });
  // white text on the dark surround, as it was; the bar itself goes dark on the bright plate
  expect((await sbInks(page)).every(s => s.fill === '#ffffff')).toBe(true);
  expect(await page.evaluate(() => images.every(im => im._sbRect && im._sbRect.ink === '#111111'))).toBe(true);
  expect(before.text).not.toMatch(/scale-bar text/);              // white on the surround read fine before
  expect(after.r.text).not.toMatch(/scale-bar text/);               // and still does
  expect(after.r.icon).toBe('✓');
  expect(errors).toEqual([]);
});

test('phage3-01: where neither black nor white reads under the bar text, Auto contrast gives it a backing chip, in the SVG and PDF too', async ({ page }) => {
  const errors = await loadApp(page);
  await platePanels(page, 'stripes');
  expect(await clickFix(page, 'Text contrast', 'Auto contrast')).toBe(true);
  const r = await page.evaluate(async () => { __close(); const row = __row('Text contrast'); __close();
    render(); const sb = figTextItems.filter(t => t.kind === 'sb').map(t => ({ fill: t.fill, bg: t.bg }));
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 96, document.getElementById('fig-canvas')))).data);
    const pdf = await __pdf();
    // the chip is drawn before its text in the PDF: a filled rectangle in the chip's grey
    return { row, sb,
      svgText: (svg.match(/>20 mm</g) || []).length, svgChip: /<rect[^>]*fill="(?:rgba\(0,\s*0,\s*0,\s*\.?0?\.62\)|#000000)"[^>]*>(?:(?!<rect)[^])*?20 mm/.test(svg),
      pdfText: __pdfRuns(pdf).filter(x => x.t === '20 mm').length, pdfChip: /re f Q\n(?:(?!re f)[^])*?\(20 mm\) Tj/.test(pdf) }; });
  expect(r.sb.length).toBe(2);
  r.sb.forEach(s => { expect(s.bg).toBeTruthy(); expect(s.fill).toBe('#ffffff'); });
  expect(r.row.text).not.toMatch(/scale-bar text/);              // the bar text now reads
  expect(r.pdfText).toBe(2);
  expect(r.pdfChip).toBe(true);
  expect(r.svgText).toBe(2);
  expect(r.svgChip).toBe(true);
  expect(errors).toEqual([]);
});

test('phage3-01: a scale-bar Color picked while Auto contrast is ticked says why it is not drawn', async ({ page }) => {
  const errors = await loadApp(page);
  await platePanels(page, 'surround');
  await page.evaluate(() => { sc('sb-auto-color', true); document.getElementById('look-acc') && (document.getElementById('look-acc').open = true); });
  await page.evaluate(() => { const i = document.getElementById('sb-color'); i.value = '#ffff00'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  const t = await page.evaluate(() => document.getElementById('toast').textContent);
  expect(t).toMatch(/untick Auto contrast/);
  expect(errors).toEqual([]);
});

// newcomer3-14: "3.35:1 — below 3:1" — each value is worded by its own band.
test('newcomer3-14: the Text contrast row says below 3:1 only of values below 3:1', async ({ page }) => {
  const errors = await loadApp(page);
  await platePanels(page, 'surround');
  const r = await page.evaluate(() => {
    const real = _textPixelContrast;
    _textPixelContrast = () => ({ n: 2, worst: 2.5, all: [], low: [['scale-bar text “10 µm” (#ffffff)', 2.5], ['panel letters “D” (#ffffff)', 3.35]] });
    try { const row = __row('Text contrast'); __close(); return row; } finally { _textPixelContrast = real; } });
  expect(r.text).toMatch(/“10 µm” \(#ffffff\) 2\.50:1 — below 3:1/);
  expect(r.text).toMatch(/“D” \(#ffffff\) 3\.35:1 — below 4\.5:1/);
  expect(r.text).not.toMatch(/3\.35:1 — below 3:1/);
  expect(errors).toEqual([]);
});

// fluor3-04: channel names in their colours (Look › Panel tags › Channel names) failed Text
// contrast in every journal, and Auto contrast could not fix them — the colour is the key.
test('fluor3-04: Auto contrast gives coloured channel tags a backing chip that keeps their colour', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d');
    x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, 300, 300);                 // a bright, crowded field
    const src = c.toDataURL('image/png');
    for (const nm of ['dapi.tif', 'membrane.tif']) await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, nm); res(); }; img.src = src; });
    images[0].lut = 'blue'; images[1].lut = 'magenta';
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    sc('tag-channels', true); sc('show-labels', true);
    sv('target-journal', 'embo'); _syncJournalFromControl(); render();
  });
  const before = await page.evaluate(() => { const r = __row('Text contrast'); __close(); return r; });
  expect(before.text).toMatch(/panel tags/);
  expect(await clickFix(page, 'Text contrast', 'Auto contrast')).toBe(true);
  const after = await page.evaluate(() => { __close(); const row = __row('Text contrast'); __close(); render();
    return { row, tags: figTextItems.filter(t => t.kind === 'tag').map(t => ({ str: t.str, fill: t.fill, bg: !!t.bg })) }; });
  expect(after.row.text).not.toMatch(/panel tags/);
  expect(after.tags.length).toBe(2);
  after.tags.forEach(t => expect(t.bg).toBe(true));
  expect(after.tags.map(t => t.fill)).toEqual(['#6a9cff', '#ff6bff']);   // the channel's own colour, kept
  expect(errors).toEqual([]);
});

// newcomer3-03: ⌘K nature on a figure with a chart — the preset set text to 7 pt, the
// chart's axis titles (a tenth larger) printed 7.7 pt, and Text size failed with no button
// while naming the smallest item.
test('newcomer3-03: the Nature preset leaves a chart inside 5–7 pt, and a later overshoot gets a Fit button naming the largest', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(`window.__gridChart = (kind, columns, rows) => { addChartElement(kind); closeChartModal();
    const el = images[images.length - 1]; el.chart.data = { columns, rows, source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = columns.slice(1).map((_, i) => i + 1); el._chartKey = ''; el._chartStat = null; return el; };`);
  await page.evaluate(HELPERS);
  await page.evaluate(() => {
    const el = __gridChart('bar', ['Strain', 'OD600'], [['WT', 0.8], ['KO', 0.4]]);
    el.chart.axes = { ...(el.chart.axes || {}), y: { ...((el.chart.axes || {}).y || {}), title: 'OD600' } };
    sv('cols', '2'); sv('rows', '2'); onLayoutChange(); render();
  });
  // ⌘K nature ⏎
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.keyboard.type('nature');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const r1 = await page.evaluate(() => { const r = __row('Text size'); __close(); return { r, j: gv('target-journal') }; });
  expect(r1.j).toBe('nature');
  expect(r1.r.icon).toBe('✓');
  // the author types 7 pt again: the row names the largest text and offers Fit
  const r2 = await page.evaluate(() => { sv('text-pt', '7'); render(); const r = __row('Text size'); __close(); return r; });
  expect(r2.icon).toBe('✗');
  expect(r2.text).toMatch(/largest: chart text/);
  expect(r2.fixes.some(f => /^Fit 5–7 pt/.test(f))).toBe(true);
  expect(await clickFix(page, 'Text size', 'Fit')).toBe(true);
  const r3 = await page.evaluate(() => { __close(); const r = __row('Text size'); __close(); return r; });
  expect(r3.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// charts3-06: PLOS (8–12 pt) and a log axis — the 10ⁿ exponents print at 70 % of the text,
// 5.6 pt, and the ⚠ named a "plain numbers" option the chart dialog does not have, with no
// button. Now: a button that raises the text size when that keeps every text inside the
// range, and a plain explanation when the chart's titles would break the maximum.
const GRID_CHART = `window.__gridChart = (kind, columns, rows) => { addChartElement(kind); closeChartModal();
  const el = images[images.length - 1]; el.chart.data = { columns, rows, source: 'demo', sourceName: '' };
  el.chart.mapping.xCol = 0; el.chart.mapping.yCols = columns.slice(1).map((_, i) => i + 1); el._chartKey = ''; el._chartStat = null; return el; };`;
test('charts3-06: superscripts under the journal minimum get a Text to N pt button, or an honest reason there is none', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(GRID_CHART); await page.evaluate(HELPERS);
  const mk = (titles) => page.evaluate((titles) => {
    images.length = 0;
    const el = __gridChart('bar', ['Strain', 'CFU'], [['WT', 1e2], ['KO', 1e8]]);
    el.chart.axes = { x: { title: titles ? 'Strain' : '' }, y: { title: titles ? 'CFU/mL' : '', log: true } };
    if (!titles) { el.chart.style = { ...(el.chart.style || {}), title: '' }; }
    el._chartKey = ''; el._chartStat = null;
    sv('cols', '1'); sv('rows', '1'); onLayoutChange(); sv('target-journal', 'plos'); _onTargetJournal('plos'); sv('text-pt', '8'); render();
    const big = _figTextSizes().filter(t => t.kind === 'chart').some(t => t.fs > _figTextPx() * 1.05);
    const r = __row('Text size'); __close(); return { r, big };
  }, titles);
  const a = await mk(true);
  expect(a.r.icon).toBe('⚠');
  expect(a.r.text).toMatch(/no text size clears both/);
  expect(a.r.text).not.toMatch(/plain numbers on the axis/);
  const b = await mk(false);
  expect(b.big).toBe(false);                                        // nothing drawn larger than the text size: the raise fits
  {
    expect(b.r.fixes.some(f => /^Text to 11\.5 pt/.test(f))).toBe(true);
    expect(await clickFix(page, 'Text size', 'Text to')).toBe(true);
    const c = await page.evaluate(() => { __close(); const r = __row('Text size'); __close(); return { r, pt: gv('text-pt') }; });
    expect(c.pt).toBe('11.5');
    expect(c.r.text).not.toMatch(/Superscripts and subscripts print/);
  }
  expect(errors).toEqual([]);
});

// ── Lane tables ──────────────────────────────────────────────────────────────────────
// blot3-03 (a regression from ISSUES.md): lane-table cells were fitted one by one, so three
// "C431S" in one row printed at 5.6, 5.6 and 4.6 pt; under JBC Text size failed and no
// button helped. One size per row; a button that widens the panel when its lanes are too narrow.
const BLOT = `window.__blot = (n, name, pitch) => {
  const W = 60 + pitch * n, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#e1e1e1'; x.fillRect(0, 0, W, H); x.fillStyle = '#333';
  for (let k = 0; k < n; k++) x.fillRect(30 + pitch * k, 70, Math.round(pitch * 0.6), 12);
  const src = c.toDataURL('image/png');
  return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name); render(); res(images.length - 1); }; img.src = src; }); };`;
test('blot3-03: a lane-table row prints at one size, and Text size offers to widen a panel whose lanes are too narrow', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(BLOT); await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    await __blot(9, 'parkin.png', 40); await __blot(9, 'tubulin.png', 40); await __blot(9, 'gapdh.png', 40);
    sv('cols', '3'); sv('rows', '1'); onLayoutChange();
    laneTableSet(0, { lanes: 12 }); laneTableSetName(0, 0, 'Parkin-HA');
    ['WT', 'WT', 'WT', 'WT', 'R42P', 'R42P', 'R42P', 'R42P', 'C431S', 'C431S', 'C431S', 'C431S'].forEach((v, c) => laneTableSetCell(0, 0, c, v));
    sv('target-journal', 'jbc'); _onTargetJournal('jbc'); render();
    const sizes = () => { render(); const k = _physFacts().ptPerPx;
      return figTextItems.filter(t => t.kind === 'lanetable' && t.idx === 0 && t.str !== 'Parkin-HA').map(t => ({ s: t.str, pt: +(t.fs * k).toFixed(2) })); };
    const s0 = sizes(), row = __row('Text size'); __close();
    return { s0, row };
  });
  // one size across the row
  expect(new Set(r.s0.map(x => x.pt)).size).toBe(1);
  expect(r.s0.every(x => !x.s.includes('…'))).toBe(true);
  expect(r.s0[0].pt).toBeLessThan(5);
  expect(r.row.icon).toBe('✗');                                    // under 5 pt fails
  {
    expect(r.row.fixes.some(f => /^Widen A/.test(f))).toBe(true);
    expect(await clickFix(page, 'Text size', 'Widen A')).toBe(true);
    const after = await page.evaluate(() => { __close(); render(); const k = _physFacts().ptPerPx;
      return { cs: images[0].colSpan, rows: gv('rows'), shown: _figurePanels().length,
        pts: figTextItems.filter(t => t.kind === 'lanetable' && t.idx === 0 && t.str !== 'Parkin-HA').map(t => t.fs * k) }; });
    expect(after.cs).toBe(3);
    expect(after.shown).toBe(3);                                    // the other panel keeps a cell
    expect(Math.min(...after.pts)).toBeGreaterThan(r.s0[0].pt);
  }
  expect(errors).toEqual([]);
});

// ── Export format and file size ──────────────────────────────────────────────────────
const saveVia = async (page, fmt) => {
  await page.locator('button:visible', { hasText: new RegExp('^↓ ' + fmt + '$') }).first().click();
  const m = page.locator('#preflight-modal'); await m.waitFor({ state: 'visible' });
  await m.locator('#pf-name').fill('Fig1');
  const [d] = await Promise.all([page.waitForEvent('download'), m.locator('button', { hasText: /^Save / }).first().click()]);
  return d;
};
// newcomer3-04, charts3-13: a PDF saved, then panels B and D swapped: the row still read
// ✓ "last exported as PDF (lossless), before the figure last changed ✓" and counted as passed.
test('newcomer3-04/charts3-13: an export made before the figure last changed is not counted, and the row offers to save again', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(HELPERS);
  await page.locator('#target-journal').selectOption('nature');
  await saveVia(page, 'PDF lossless');
  const fresh = await page.evaluate(() => { const r = __report(); __close(); return { row: r.rows.find(x => x.label === 'Export format'), title: r.title }; });
  expect(fresh.row.icon).toBe('✓');
  // swap B and D as the keyboard does (one undo step)
  await page.evaluate(() => { pushUndo(); const t = images[1]; images[1] = images[3]; images[3] = t; renderImgList(); render(); });
  const stale = await page.evaluate(() => { const r = __report(); __close(); return { row: r.rows.find(x => x.label === 'Export format'), title: r.title }; });
  expect(stale.row.icon).toBe('ℹ');
  expect(stale.row.text).toMatch(/changed after it was last exported/);
  expect(stale.row.fixes.some(f => /^Save as/.test(f))).toBe(true);
  const n = t => +/(\d+)\/(\d+) passed/.exec(t)[1], d = t => +/(\d+)\/(\d+) passed/.exec(t)[2];
  expect(n(stale.title)).toBe(n(fresh.title) - 1);                 // no longer counted as passed
  expect(d(stale.title)).toBe(d(fresh.title) - 1);                 // nor as a rule at all
  expect(errors).toEqual([]);
});

// newcomer3-16: PLOS, ↓ TIFF with LZW (1.7 MB on disk): File size kept the uncompressed
// estimate's ⚠ "≈ 12.2 MB … check the written file".
test('newcomer3-16: File size reads the TIFF actually written since the last change', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(HELPERS);
  await page.locator('#target-journal').selectOption('plos');
  await page.evaluate(() => { sv('cols', '2'); sv('rows', '2'); onLayoutChange(); sv('panel-h', '520'); render(); });
  const before = await page.evaluate(() => { const r = __row('File size'); __close(); return r; });
  expect(before.text).toMatch(/uncompressed TIFF ≈/);
  const d = await saveVia(page, 'TIFF');
  const size = require('fs').statSync(await d.path()).size;
  const after = await page.evaluate(() => { const r = __row('File size'); __close(); return r; });
  expect(after.icon).toBe('✓');
  expect(after.text).toMatch(/LZW-compressed TIFF written since the figure last changed is [\d.]+ MB ✓/);
  const mb = +/is ([\d.]+) MB/.exec(after.text)[1];
  expect(Math.abs(mb - size / 1048576)).toBeLessThan(0.06);
  expect(errors).toEqual([]);
});
