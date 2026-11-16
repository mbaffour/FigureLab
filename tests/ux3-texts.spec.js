// @ts-check
// Usability round 3 — the words FigureLab writes about a figure: the caption, Methods, alt
// text, the legend text starter, PANEL_HISTORY / metadata.csv, the submission package and
// source data, and the export toasts. The rule each test checks: after any revision they
// are current and true. Finding IDs (newcomer3-02, charts3-02, …) are in the titles.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

const ZIP = `
  window.__zip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el, raw = bytes.subarray(at, at + size);
      out.push({ name, data: (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw) });
      p = at + size;
    }
    return out;
  };
  window.__pkg = async () => { const z = await _captureDownload(() => exportSubmissionPackage()); const files = {};
    (await __zip(z.data)).forEach(e => { files[e.name] = /\\.(png|tiff?|pdf)$/i.test(e.name) ? '(binary)' : new TextDecoder().decode(e.data); }); return files; };
`;
const CFU = `strain,replicate,cfu\nWT,1,10\nWT,2,12\nWT,3,11\ndfliC,1,5\ndfliC,2,6\ndfliC,3,4`;
const openExport = page => page.evaluate(() => { let d = document.getElementById('caption-out').closest('details'); while (d) { d.open = true; d = d.parentElement.closest('details'); } });
// Drop a CSV into the grid through the app's file path, Apply its Chart dialog.
async function dropChart(page, csv, name) {
  await page.evaluate(([csv, name]) => addFiles([new File([csv], name, { type: 'text/csv' })]), [csv, name]);
  await page.waitForFunction(() => document.getElementById('chart-modal').classList.contains('open'));
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(() => !document.getElementById('chart-modal').classList.contains('open'));
}
const chartOf = (page, fn, arg) => page.evaluate(([f, a]) => { const el = images.find(p => p && p.type === 'chart'); new Function('el', 'a', f)(el, a); el._chartKey = ''; el._chartStat = null; render(); return _captionText(); }, [fn, arg]);

// ── newcomer3-02 (hard): the caption's "figure has changed" line ─────────────────────
test('newcomer3-02: an edited caption shows its "figure has changed" line within seconds of a swap, a caption note, a rename and a Replace — with a chart in the figure', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await dropChart(page, CFU, 'cfu.csv');
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  // type at the end of the caption, as the tester did
  await page.locator('#caption-out').click();
  await page.keyboard.press('Control+End'); await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' My own sentence.'); await page.keyboard.press('Tab');
  await page.waitForTimeout(1700);
  await expect(page.locator('#caption-stale')).toBeHidden();               // nothing has changed yet
  const quick = { timeout: 3000 };
  const keep = () => page.locator('#caption-stale').getByText('Keep mine').click();
  // 1. drag the chart (C) onto panel A on the canvas — no ⟳ Render
  { const cr = await page.locator('#ann-canvas').boundingBox();
    const [a, c] = await page.evaluate(() => [panelBounds.find(x => x.idx === 0), panelBounds.find(x => x.idx === 2)]);
    const sx = cr.width / await page.evaluate(() => canvasLogicalW), sy = cr.height / await page.evaluate(() => canvasLogicalH);
    const x0 = cr.x + (c.x + c.w / 2) * sx, y0 = cr.y + (c.y + c.h / 2) * sy, x1 = cr.x + (a.x + a.w / 2) * sx, y1 = cr.y + (a.y + a.h / 2) * sy;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12); await page.waitForTimeout(25); }
    await page.mouse.up(); }
  await expect.poll(() => page.evaluate(() => images[0] && images[0].type)).toBe('chart');
  await expect(page.locator('#caption-stale')).toBeVisible(quick);         // old code: ~10 s (a chart's canvas held the sync back)
  await expect(page.locator('#caption-out')).toHaveValue(/My own sentence\./);
  await keep();
  await expect(page.locator('#caption-stale')).toBeHidden();
  // 2. a caption note typed in ⚙
  await page.locator('[data-gear]').nth(1).click();
  await page.locator('.f-cap').nth(1).fill('Swim plate, 0.3 % agar');
  await expect(page.locator('#caption-stale')).toBeVisible(quick);
  await keep();
  // 3. a letter changed in the panel list
  await page.locator('.img-label-input').nth(1).fill('D'); await page.locator('.img-label-input').nth(1).press('Tab');
  await expect(page.locator('#caption-stale')).toBeVisible(quick);
  await keep();
  // 4. a sample renamed in the Chart dialog's Names & colours (shown as)
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'chart')));
  await page.waitForFunction(() => document.getElementById('chart-modal').classList.contains('open'));
  await page.locator('#chart-names [data-key="dfliC"] input[type="text"]').fill('Δ*fliC*');
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#caption-stale')).toBeVisible(quick);
  await keep();
  // 5. ⇄ Replace image… through its file chooser
  { const chooser = page.waitForEvent('filechooser');
    await page.evaluate(() => openReplaceImage(images.findIndex(p => p && p.type !== 'chart' && !p.captionNote)));
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 60; c.getContext('2d').fillRect(0, 0, 9, 9); return c.toDataURL().split(',')[1]; });
    await (await chooser).setFiles({ name: 'swim_plate.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); }
  await expect.poll(() => page.evaluate(() => images.some(p => p && p.name === 'swim_plate.png'))).toBe(true);
  await expect(page.locator('#caption-stale')).toBeVisible(quick);
  // the box keeps the author's words throughout
  await expect(page.locator('#caption-out')).toHaveValue(/My own sentence\./);
  expect(errors).toEqual([]);
});

test('newcomer3-02: a figure saved under the older caption wording reopens with no "changed" line until the figure changes', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await dropChart(page, CFU, 'cfu.csv');
  const json = await page.evaluate(() => { generateCaption(); sv('caption-out', gv('caption-out') + ' Mine.');
    const s = serializeSession(true); delete s.genTexts.wording; s.genTexts.caption.base = 'an older wording of the caption'; return JSON.stringify(s); });
  await page.evaluate(j => { applySession(JSON.parse(j), { origin: 'file' }); render(); }, json);
  await openExport(page);
  await page.waitForTimeout(1800);
  await expect(page.locator('#caption-stale')).toBeHidden();
  await page.evaluate(() => { images[0].captionNote = 'Spot assay'; render(); });
  await expect(page.locator('#caption-stale')).toBeVisible({ timeout: 3000 });
  expect(errors).toEqual([]);
});

// ── charts3-02 (hard): the statistic described is the one drawn ─────────────────────
test('charts3-02: each chart kind is described by what it draws — dot plot mean ± SD/SEM, box median and quartiles, violin, bars with points', async ({ page }) => {
  const errors = await loadApp(page);
  await dropChart(page, CFU, 'cfu.csv');
  const bee = await chartOf(page, "el.chart.kind='beeswarm'; el.chart.error='sd'; delete el.chart.whiskerOff;");
  expect(bee).toContain('(A) Dot plot');
  expect(bee).toContain('Each dot is one value; the line marks the mean, whiskers ± SD (n−1); n = 3 per group.');
  expect(bee).not.toMatch(/Boxes|median|quartile/);
  const beeSem = await chartOf(page, "el.chart.error='sem';");
  expect(beeSem).toContain('whiskers ± SEM; n = 3 per group.');
  const beeNone = await chartOf(page, "el.chart.error='none'; el.chart.whiskerOff=true;");
  expect(beeNone).toContain('Each dot is one value; the line marks the mean; n = 3 per group.');
  const box = await chartOf(page, "el.chart.kind='box'; el.chart.style.showPoints=true;");
  expect(box).toContain('Boxes show the median and interquartile range; whiskers, minimum to maximum; dots, individual values; n = 3 per group.');
  const vio = await chartOf(page, "el.chart.kind='violin'; el.chart.style.showPoints=false;");
  expect(vio).toContain('Violins show the distribution of the values (kernel density estimate); the bar marks the interquartile range and the white dot the median; n = 3 per group.');
  const bar = await chartOf(page, "el.chart.kind='bar'; el.chart.error='sem'; el.chart.style.showPoints=true;");
  expect(bar).toContain('Bars show the mean ± SEM; dots, individual replicates; n = 3 per bar.');
  const barNone = await chartOf(page, "el.chart.error='none'; el.chart.style.showPoints=false;");
  expect(barNone).toContain('Bars show the mean; n = 3 per bar.');
  expect(errors).toEqual([]);
});

// ── charts3-11 / phage3-06: series, brackets, pasted data ───────────────────────────
test('charts3-11 / phage3-06: grouped bars name their series, a line chart its averaged series by their shown-as names, brackets are named, edited data are said to be', async ({ page }) => {
  const errors = await loadApp(page);
  const MIC = 'strain,antibiotic,mic\nPA14,cipro,0.125\nPA14,cipro,0.125\nPA14,gent,1\nPA14,gent,2\ndlasR,cipro,0.25\ndlasR,cipro,0.25\ndlasR,gent,4\ndlasR,gent,4';
  await dropChart(page, MIC, 'mic.csv');
  const g = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); const ch = el.chart;
    ch.kind = 'groupedBar'; ch.mapping.xCol = 1; ch.mapping.seriesCol = 0; ch.mapping.yCols = [2]; ch.error = 'sd';
    ch.names = { dlasR: 'Δ*lasR*' }; ch.annos = [{ kind: 'sig', a: 0, b: 1, text: 'p < 0.01' }]; el._chartKey = ''; render(); return _captionText(); });
  expect(g).toContain('(A) Grouped bar chart of mic for cipro and gent (bars: PA14 and ΔlasR).');   // Y title defaults to the value column (ux3-data)
  expect(g).toContain('Brackets: p < 0.01 (cipro vs gent), from the author’s own statistical test.');
  // replicate columns averaged into series: the caption names the series, not the columns
  const LINE = 'time,WT_r1,WT_r2,WT_r3,dfhuA_r1,dfhuA_r2,dfhuA_r3\n0,0.1,0.1,0.1,0.1,0.1,0.1\n1,0.2,0.21,0.19,0.15,0.16,0.14';
  await dropChart(page, LINE, 'growth.csv');
  const l = await page.evaluate(() => { const el = images.filter(p => p && p.type === 'chart')[1]; render(); return _dataCaption(el); });
  expect(l).not.toMatch(/WT_r1|values:/);
  // the data edited in the Chart dialog: the caption says so
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'chart')));
  await page.waitForFunction(() => document.getElementById('chart-modal').classList.contains('open'));
  await page.locator('#chart-data-ta').fill(MIC.replace('0.125', '0.5'));
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  const e = await page.evaluate(() => { render(); return _captionText(); });
  expect(e).toContain('Data from mic.csv, edited in FigureLab.');
  expect(errors).toEqual([]);
});

test('phage3-06: a gene map whose title gives its range is not given its length twice, and an 11-feature map lists every feature', async ({ page }) => {
  const errors = await loadApp(page);
  const t = await page.evaluate(() => {
    const feats = 'terS terL portal scaf mcp tube tail hol lys rz rz1'.split(' ').map((n, i) => ({ name: n, start: i * 100 + 1, end: i * 100 + 90, strand: 1, type: 'CDS' }));
    return _dataCaption({ type: 'genemap', map: { topology: 'linear', length: 17400, features: feats, style: { title: 'Kz7 late region (1–17,400 bp)' } } });
  });
  expect(t).toBe('Linear map of Kz7 late region (1–17,400 bp), showing terS, terL, portal, scaf, mcp, tube, tail, hol, lys, rz and rz1.');
  expect(errors).toEqual([]);
});

// ── charts3-04: the metadata note stays out of the legend ───────────────────────────
test('charts3-04: the Metadata note goes to metadata.csv and PANEL_HISTORY, not the caption, the alt text or the SVG desc', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await seedPanels(page, 1);
  await page.locator('[data-gear]').first().click();
  await page.locator('.f-meta').first().fill('plate 3, 2026-11-02, lab book p.45');
  await page.locator('.f-cap').first().fill('PA14 on LB agar');
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await expect(page.locator('#caption-out')).toHaveValue(/PA14 on LB agar/);
  await expect(page.locator('#caption-out')).not.toHaveValue(/lab book/);
  await page.getByRole('button', { name: '✦ Draft from figure' }).click();
  await expect(page.locator('#alt-text')).not.toHaveValue(/lab book/);
  const f = await page.evaluate(() => __pkg());
  const csv = Object.entries(f).find(([k]) => /metadata\.csv$/.test(k))[1];
  expect(csv).toContain('lab book p.45');
  expect(f['PANEL_HISTORY.txt']).toContain('metadataNote: text=plate 3, 2026-11-02, lab book p.45');
  expect(Object.entries(f).find(([k]) => /\.svg$/.test(k))[1]).not.toContain('lab book');
  expect(errors).toEqual([]);
});

// ── fluor3-05: alt text counts what the figure draws ────────────────────────────────
test('fluor3-05: the alt-text draft counts the panels drawn — not hidden ones — and reads as one sentence with charts', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  await dropChart(page, CFU, 'cfu.csv');
  await page.evaluate(() => { images[1].excluded = true; images[3].excluded = true; images[4].excluded = true; render(); });
  await openExport(page);
  await page.getByRole('button', { name: '✦ Draft from figure' }).click();
  const alt = await page.locator('#alt-text').inputValue();
  expect(alt).toMatch(/panel grid of 4 panels: 3 image panels and 1 chart\./);
  expect(alt).not.toMatch(/holds .* as panels|6 image panels|5 image panels/);
  expect(errors).toEqual([]);
});

// ── freeform3-18: the draft appears at once, whatever the on-device model does ──────
test('freeform3-18: ✦ Draft from figure writes the rule-based draft at once even when the on-device model never answers', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { window.LanguageModel = { availability: () => new Promise(() => {}), create: () => new Promise(() => {}) }; });
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 150, name: 'cells.png', label: 'A' }, { type: 'image', x: 260, y: 20, w: 200, h: 150, fill: '#22aa44', name: 'gfp.png', label: 'B' }]);
  await openExport(page);
  await page.getByRole('button', { name: '✦ Draft from figure' }).click();
  await expect(page.locator('#alt-text')).toHaveValue(/A freeform figure of 2 image panels/, { timeout: 1500 });
  await expect(page.locator('#alt-text')).not.toHaveValue(/^A scientific figure\.$/);
  expect(errors).toEqual([]);
});

// ── freeform3-17 / 23 / 22: freeform captions from the canvas ───────────────────────
test('freeform3-23: a freeform figure built from scratch gets a lettered caption, caption notes, no false "Grayscale images", and the package records every object', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 150, name: 'cells.png', label: 'A' }, { type: 'image', x: 260, y: 20, w: 200, h: 150, fill: '#22aa44', name: 'gfp.png', label: 'B' }]);
  // a caption note through the object's own field
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(1); updateElemPropsBar(); });
  await page.locator('#ep-capnote').fill('GFP-tagged cells');
  await page.evaluate(() => { const ch = _defaultChart('bar'); addFreeformElement({ type: 'chart', x: 20, y: 200, w: 360, h: 260, chart: ch, label: 'growth', letter: 'C' }); render(); });
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  const cap = await page.locator('#caption-out').inputValue();
  expect(cap).toMatch(/^\(A\) Panel A\. \(B\) GFP-tagged cells\. \(C\) Bar chart/);
  expect(cap).not.toContain('Grayscale images');
  expect(cap.match(/Bar chart/g).length).toBe(1);
  const f = await page.evaluate(() => __pkg());
  expect(f['PANEL_HISTORY.txt']).toMatch(/── A ── \(source: cells\.png\)/);
  expect(f['PANEL_HISTORY.txt']).toMatch(/── C ──[\s\S]*1\. chart: kind=bar/);
  const csv = Object.entries(f).find(([k]) => /metadata\.csv$/.test(k))[1];
  expect(csv.trim().split('\n').length).toBe(4);   // header + A, B, C
  expect(Object.keys(f).filter(k => k.startsWith('panels/')).length).toBe(3);
  expect(errors).toEqual([]);
});

test('freeform3-17: a popped-out grid with a chart describes the chart once, under its letter, with its note', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await dropChart(page, CFU, 'cfu.csv');
  await page.evaluate(() => { images.find(p => p.type === 'chart').chart.caption = 'Mean of three days'; render(); convertGridToFreeform(); });
  await page.waitForFunction(() => layoutMode === 'freeform');
  await page.evaluate(() => { const b = document.querySelector('#confirm-modal-bg.open button.btn-primary'); if (b) b.click(); render(); });
  const cap = await page.evaluate(() => _captionText());
  expect(cap.match(/Bar chart/g).length).toBe(1);
  expect(cap).toMatch(/\(C\) Bar chart of cfu for WT and dfliC\..*Mean of three days\.$/);   // Y title defaults to the value column (ux3-data)
  expect(errors).toEqual([]);
});

test('freeform3-22: a hand-typed alt text on a freeform figure is flagged when a picture is replaced or a sample renamed', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 150, name: 'cells.png', label: 'A' }]);
  await page.evaluate(() => { const ch = _defaultChart('bar'); addFreeformElement({ type: 'chart', x: 20, y: 200, w: 360, h: 260, chart: ch, label: 'growth', letter: 'B' }); render(); });
  await openExport(page);
  await page.locator('#alt-text').fill('Two panels: cells, and a bar chart of AcrB D407A.');
  await page.waitForTimeout(1700);
  await expect(page.locator('#alt-stale')).toBeHidden();
  // the picture replaced by another file (the old draft said only "2 images", so nothing changed under it)
  await page.evaluate(async () => { const el = freeformElements.find(e => e.type === 'image'); const c = document.createElement('canvas'); c.width = 60; c.height = 40;
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); }); el.img = el._imgEl = img; el.src = img.src; el.name = 'cells_v2.png'; render(); });
  await expect(page.locator('#alt-stale')).toBeVisible({ timeout: 3000 });
  await page.locator('#alt-stale').getByText('Keep mine').click();
  await page.evaluate(() => { const el = freeformElements.find(e => e.type === 'chart'); el.chart.names = { A: 'AcrB^{D407A}' }; el._chartKey = ''; render(); });
  await expect(page.locator('#alt-stale')).toBeVisible({ timeout: 3000 });
  expect(errors).toEqual([]);
});

// ── newcomer3-08 / phage3-06: calibration provenance ────────────────────────────────
test('newcomer3-08 / phage3-06: Methods and PANEL_HISTORY say a pixel size came from an auto-detected bar, and a copied one names its source by the letter it has now', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await seedPanels(page, 3);
  await page.evaluate(() => { applyScaleDetect(1, 126, 10); render(); });
  // tick C in the list, then ⇉ copy B's µm/px to it
  await page.evaluate(() => { const cbs = document.querySelectorAll('#img-list .panel-pick'); cbs[2].checked = true; copyCalibrationToTicked(1); render(); });
  let m = await page.evaluate(() => generateMethodsParagraph());
  expect(m).toContain('measured on the scale bar burned into the image (126 px = 10 µm) for panel B');
  expect(m).toContain('copied from panel B (measured on the scale bar burned into the image (126 px = 10 µm)) for panel C');
  expect(m).not.toContain('set by hand');
  // C dragged onto B: the letters follow the panels, and no panel copies from itself
  await page.evaluate(() => { swapImages(1, 2); render(); });
  m = await page.evaluate(() => generateMethodsParagraph());
  expect(m).toContain('for panel C');
  expect(m).toContain('copied from panel C');
  expect(m).not.toMatch(/copied from panel B[^.]*for panel B/);
  const f = await page.evaluate(() => __pkg());
  expect(f['PANEL_HISTORY.txt']).toMatch(/calibrate: umPerPx=0\.0793651, scaleBarUm=\d+, source=measured on the scale bar burned into the image/);
  expect(errors).toEqual([]);
});

// ── newcomer3-17 / newcomer2-13: PANEL_HISTORY keeps the import, notes EXIF ─────────
test('newcomer3-17 / newcomer2-13: PANEL_HISTORY keeps the original import before a Replace, records an EXIF-rotated photo, and describes a chart as data', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  // a JPEG with EXIF orientation 6, dropped through the app's file path
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 10, 10);
    const jpg = Uint8Array.from(atob(c.toDataURL('image/jpeg').split(',')[1]), ch => ch.charCodeAt(0));
    // APP1: "Exif\0\0" + little-endian TIFF header + one IFD entry, Orientation (0x0112) = 6
    const tiff = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff], len = body.length + 2;
    const out = new Uint8Array(jpg.length + 4 + body.length);
    out.set(jpg.subarray(0, 2), 0); out.set([0xFF, 0xE1, len >> 8, len & 255, ...body], 2); out.set(jpg.subarray(2), 4 + body.length);
    await addFiles([new File([out], 'IMG_8812.JPG', { type: 'image/jpeg' })]);
  });
  await page.waitForFunction(() => images.filter(Boolean).length === 1);
  await seedPanels(page, 1);
  await dropChart(page, CFU, 'swim_diameters.csv');
  await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 80; c.height = 60;
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); });
    _replaceInto(images[1], { img, src: img.src, name: 'swim_plate.png' }); render(); });
  const f = await page.evaluate(() => __pkg());
  const H = f['PANEL_HISTORY.txt'];
  expect(H).toMatch(/source: IMG_8812\.JPG\)\n {2}1\. import: file=IMG_8812\.JPG, pixels=30×40px, nativeSamples=[^\n]*, converted=displayed upright per its EXIF orientation tag \(6: rotated 90° clockwise\)/);
  expect(H).toMatch(/source: swim_plate\.png\)\n {2}1\. import: file=panel0\.png, pixels=100×100px\n {2}2\. replaceImage: from=panel0\.png, to=swim_plate\.png/);
  expect(H).toMatch(/1\. chart: kind=bar, data=swim_diameters\.csv, rows=6, columns=3/);
  expect(H).not.toContain('file=swim_diameters.csv, pixels=');
  expect(errors).toEqual([]);
});

// ── blot3-10: an unlettered loading control is named, n.d. only when there is one ───
test('blot3-10: the loading control of a blot is named by its tag, not its list position', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => { images[2].label = ''; images[2].tag = 'α-tubulin'; return _gelLoadingLabel({ loading: { id: images[2].id, label: '3' } }); });
  expect(r).toBe('“α-tubulin”');
  expect(errors).toEqual([]);
});

// ── charts3-08 / phage3-11 / charts3-09: source data ────────────────────────────────
test('charts3-08 / phage3-11 / charts3-09: a point averaged from identical replicates has error 0 and its type, and a significance mark names its groups', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  const SAME = 'strain,mic\nPA14,0.125\nPA14,0.125\nPA14,0.125\ndlasR,0.25\ndlasR,0.5\ndlasR,0.25';
  await dropChart(page, SAME, 'mic.csv');
  await page.evaluate(() => { const el = images.find(p => p.type === 'chart'); el.chart.error = 'sd'; el.chart.names = { dlasR: 'ΔlasR' };
    el.chart.annos = [{ kind: 'sig', a: 0, b: 1, text: 'p < 0.001' }]; el._chartKey = ''; render(); });
  const f = await page.evaluate(() => __pkg());
  const csv = Object.entries(f).find(([k]) => k.startsWith('source-data/'))[1];
  expect(csv).toContain(',PA14,3,0.125,0,SD (n-1),');
  expect(csv).toContain('# Significance mark "p < 0.001" between PA14 and ΔlasR (dlasR) (groups 1 and 2)');
  expect(errors).toEqual([]);
});

// ── fluor3-11: ZIP entry names ──────────────────────────────────────────────────────
test('fluor3-11: file names inside the ZIP use ASCII hyphens (eLife source data)', async ({ page }) => {
  const errors = await loadApp(page);
  const n = await page.evaluate(() => _zipEntryNames([{ name: 'Figure 1—source data 1.pdf' }, { name: 'Fig – 2.png' }]).map(f => f.name));
  expect(n).toEqual(['Figure 1-source data 1.pdf', 'Fig - 2.png']);
  expect(errors).toEqual([]);
});

// ── freeform3-24: the reproducibility log of a figure opened from the library ───────
test('freeform3-24: a figure saved to the session library and reopened still ships its reproducibility log', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await seedPanels(page, 2);
  const f = await page.evaluate(async () => {
    logAction('test', { a: 1 });
    window.prompt = () => 'Fig3 v1'; await saveToLibrary();
    const rec = (await new Promise(r => { _tx('readonly').then(st => { const q = st.getAll(); q.onsuccess = () => r(q.result); }); })).find(x => x.name === 'Fig3 v1');
    confirmNewFigure(); document.getElementById('cm-ok').click();
    await loadFromLibrary(rec.id); render();
    await new Promise(r => setTimeout(r, 300));
    return __pkg();
  });
  const log = Object.entries(f).find(([k]) => /repro-log\.txt$/.test(k));
  expect(log).toBeTruthy();
  expect(log[1]).toContain('test');
  expect(f['README.txt']).not.toMatch(/reproducibility log: the exporter finished without producing a file/);
  expect(errors).toEqual([]);
});

// ── newcomer3-15: the toast names the file written ──────────────────────────────────
test('newcomer3-15: the TIFF toast names the .tif a PLOS figure is written as', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(async () => { applyPreset('plos'); sv('export-name', 'Fig3'); const t = []; const o = window.toast; window.toast = (m, k) => { t.push(m); return o(m, k); };
    const od = window.dl; let name = null; window.dl = (u, n) => { name = n; }; await doExport('tiff'); window.dl = od; window.toast = o; return { name, toasts: t }; });
  expect(r.name).toBe('Fig3.tif');
  expect(r.toasts.join('\n')).toContain('Saved Fig3.tif');
  expect(r.toasts.join('\n')).not.toContain('Fig3.tiff');
  expect(errors).toEqual([]);
});

// ── freeform3-06: the Export readout after New and a canvas-size change ─────────────
test('freeform3-06: the Export readout clears on ✕ New and follows a canvas-size preset on an empty canvas', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await expect(page.locator('#phys-readout')).toContainText('Prints');
  await page.getByRole('button', { name: '✕ New' }).click();
  await page.locator('#cm-ok').click();
  await expect(page.locator('#phys-readout')).toHaveText('');
  await page.evaluate(() => applyDeliverable('squareAbstract'));
  await expect(page.locator('#phys-readout')).toContainText('Prints 102 × 102 mm');
  expect(errors).toEqual([]);
});

// ── freeform3-19 / charts3-11: the legend text starter ──────────────────────────────
test('freeform3-19 / charts3-11: the legend text starter writes a superscripted name as plain characters and lists three marks as a list', async ({ page }) => {
  const errors = await loadApp(page);
  const t = await page.evaluate(() => _keyText([
    { name: 'AcrB^{D407A}', kind: 'series', color: '#000000', words: 'black, filled circles' },
    { name: 'WT', kind: 'series', color: '#000000', desc: _listAnd(['filled bars', 'solid line', 'filled circles']) }]));
  expect(t).toContain('AcrB(D407A) (black, filled circles)');
  expect(t).not.toContain('^(');
  expect(t).toContain('filled bars, solid line and filled circles');
  expect(errors).toEqual([]);
});

// ── ISSUES.md: a merge is named by its channels ─────────────────────────────────────
test('ISSUES: a three-channel merge is captioned by its channels and their colours, not one colour', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const cap = await page.evaluate(() => { const im = images[0]; im.captionNote = 'Merge'; im.lut = 'blue'; im.chan = 'DAPI';
    im.channels = [{ img: im.img, lut: 'green', name: 'GFP.tif', chan: 'GFP' }, { img: im.img, lut: 'magenta', name: 'mem.tif', chan: 'Membrane' }]; render(); return _captionText(); });
  expect(cap).toContain('(A) Merge of DAPI (blue), GFP (green) and Membrane (magenta).');
  expect(errors).toEqual([]);
});

// ── phage3-06 / blot3-10: a lane table in the caption ───────────────────────────────
test('phage3-06 / blot3-10: a spot assay\'s dilution row and a blot\'s condition rows are in the caption, reversed on a mirrored panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[0].laneTable = { rows: [{ name: 'dilution', cells: ['10⁻²', '10⁻³', '10⁻⁴', '10⁻⁵', '10⁻⁶', '10⁻⁷', '10⁻⁸'] }], lanes: 7, pos: 'above' };
    images[1].laneTable = { rows: [{ name: 'Parkin', cells: ['WT', 'C431S', '–'] }, { name: 'CCCP', cells: ['–', '+', '+'] }], lanes: 3, pos: 'above' };
    render(); const a = _captionText();
    images[0].flipH = true; render(); const b = _captionText();
    return { a, b };
  });
  expect(r.a).toContain('(A) Lanes, left to right — dilution: 10⁻² to 10⁻⁸.');
  expect(r.a).toContain('(B) Lanes, left to right — Parkin: WT, C431S, –; CCCP: –, +, +.');
  expect(r.b).toContain('(A) Lanes, left to right — dilution: 10⁻⁸ to 10⁻².');
  expect(errors).toEqual([]);
});

// ── newcomer3-08: an objective preset is named as the source ─────────────────────────
test('newcomer3-08: a pixel size picked from ⚙ › Objective is said to come from that preset, a typed one is set by hand', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.locator('[data-gear]').first().click();
  const obj = page.locator('.f-obj').first();
  const opt = await obj.evaluate(s => { const o = [...s.options].find(o => +o.value > 0); return { v: o.value, t: o.textContent }; });
  await obj.selectOption(opt.v);
  await page.locator('[data-gear]').nth(1).click();
  await page.locator('.f-umppx').nth(1).fill('0.25'); await page.locator('.f-umppx').nth(1).press('Tab');
  const m = await page.evaluate(() => { render(); return generateMethodsParagraph(); });
  expect(m).toContain(`from the ${opt.t} objective preset for panel A`);
  expect(m).toContain('set by hand for panel B');
  expect(errors).toEqual([]);
});
