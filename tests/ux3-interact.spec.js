// @ts-check
// Usability round 3, group "interact": ⌘K and which panel a command acts on, dialogs,
// toasts, the lane table editor, scale-bar detection and drawing, the sidebar and the
// annotation tools. Each test drives the path a tester took and failed on (finding IDs in
// the titles), and fails on the build they tested (69576f7).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

// Type into ⌘K the way a person does and press Enter.
async function palette(page, q) {
  await page.keyboard.press('Control+k');
  await page.locator('#cmdp-input').fill(q);
  await page.keyboard.press('Enter');
}
async function top(page, q) {
  return page.evaluate((q) => { openCmdPalette(); _cmdpRender(q); const t = _cmdpFiltered.slice(0, 3).map(c => c.label); closeCmdPalette(); return t; }, q);
}
// A light blot with n dark lanes, through a lossless PNG and the real _commitImage path.
async function addBlot(page, n, name) {
  return page.evaluate(({ n, name }) => {
    const pitch = 60, W = 40 + pitch * n, H = 120;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#e1e1e1'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#333'; for (let k = 0; k < n; k++) x.fillRect(25 + pitch * k, 52, 34, 12);
    const src = c.toDataURL('image/png');
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name); render(); res(images.length - 1); }; img.src = src; });
  }, { n, name });
}
// A chart panel, the kind ⌘K lane table and densitometry used to pick as "the first picture".
async function addChart(page) {
  await page.evaluate(() => {
    const ch = _defaultChart('bar');
    ch.data = { columns: ['strain', 'cfu'], rows: [['WT', 9], ['WT', 11], ['dfliC', 2], ['dfliC', 3]], source: 'file', sourceName: 'cfu.csv' };
    ch.mapping.xCol = 0; ch.mapping.yCols = [1];
    _addDataPanel('chart', ch, 300, 220, 'bar chart'); selectedPanel = -1; render();
  });
}
// Client coordinates of a point in the figure's logical pixels.
async function client(page, x, y) {
  return page.evaluate(([x, y]) => { const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const lw = canvasLogicalW || c.width, lh = canvasLogicalH || c.height; return [r.left + x * r.width / lw, r.top + y * r.height / lh]; }, [x, y]);
}
async function clickFig(page, x, y) { const [cx, cy] = await client(page, x, y); await page.mouse.click(cx, cy); }

// ── Which panel ⌘K means ─────────────────────────────────────────────

test('phage3-07 / phage2-10: a click on a panel\'s letter or its lane-table labels, then ⌘K lane table, opens that panel', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlot(page, 4, 'tem.png'); await addBlot(page, 6, 'spots.png');
  await page.evaluate(() => { laneTableSetName(1, 0, 'Dilution'); laneTableSetCell(1, 0, 0, '10^{-2}'); selectedPanel = -1; render(); });
  const items = await page.evaluate(() => figTextItems.filter(t => t.idx === 1 && (t.kind === 'panel' || t.kind === 'lanetable'))
    .map(t => ({ kind: t.kind, x: t.bbox.x + t.bbox.w / 2, y: t.bbox.y + t.bbox.h / 2 })));
  expect(items.length).toBeGreaterThanOrEqual(2);
  for (const it of items) {
    await page.evaluate(() => { selectedPanel = -1; _lastPickedPanelId = null; });
    await clickFig(page, it.x, it.y);        // was: selectedPanel stayed -1, and ⌘K opened panel A
    await palette(page, 'lane table');
    await expect(page.locator('#lt-modal-bg h3'), it.kind).toContainText('panel B');
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});

test('blot3-02: after Esc, or a click on the strip\'s row in Images, ⌘K densitometry opens that strip — never the chart listed first', async ({ page }) => {
  const errors = await loadApp(page);
  await addChart(page); await addBlot(page, 5, 'strip_a.png'); await addBlot(page, 5, 'strip_b.png');
  // (1) click strip B on the canvas, Esc, ⌘K densitometry
  const c = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 2); return [b.x + b.w / 2, b.y + b.h - 6]; });
  await clickFig(page, c[0], c[1]);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => selectedPanel)).toBe(-1);
  await palette(page, 'densitometry');
  await expect(page.locator('#gel-modal-bg h3')).toContainText('panel C');
  await page.keyboard.press('Escape');
  // (2) a click on strip A's row in the image list selects it
  await page.locator('#img-list .img-item').nth(1).locator('.img-name').click();
  expect(await page.evaluate(() => selectedPanel)).toBe(1);
  await palette(page, 'lane table');
  await expect(page.locator('#lt-modal-bg h3')).toContainText('panel B');
  await page.keyboard.press('Escape');
  // (3) nothing picked, two strips: it asks, and the chart is not offered
  await page.evaluate(() => { selectedPanel = -1; _lastPickedPanelId = null; });
  await palette(page, 'lane table');
  const ask = page.locator('#panelpick-modal-bg');
  await expect(ask).toBeVisible();
  expect(await ask.locator('[data-pick]').count()).toBe(2);
  await expect(page.locator('#lt-modal-bg')).toHaveCount(0);
  await ask.locator('[data-pick="2"]').click();
  await expect(page.locator('#lt-modal-bg h3')).toContainText('panel C');
  await page.keyboard.press('Escape');
  // (4) the chart picked: never analysed, never given a lane table
  await page.evaluate(() => { selectedPanel = 0; });
  await palette(page, 'densitometry');
  await expect(page.locator('#panelpick-modal-bg')).toBeVisible();
  await expect(page.locator('#panelpick-modal-bg p')).toContainText('Panel A is a chart');
  await page.keyboard.press('Escape');
  const r = await page.evaluate(() => ({ ga: !!images[0].gelAnalysis, lt: !!images[0].laneTable, refuse: _gelRefusal(images[0]), lt2: openLaneTable(0) }));
  expect(r).toEqual({ ga: false, lt: false, refuse: expect.stringContaining('chart'), lt2: false });
  expect(errors).toEqual([]);
});

test('blot3-02: an analysis opened on the wrong panel can be removed — one undo step, its MW labels too', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlot(page, 5, 'strip.png');
  await page.evaluate(() => openGelAnalysis(0));
  await expect(page.locator('#gel-modal-bg')).toBeVisible();
  const n0 = await page.evaluate(() => ({ ga: !!images[0].gelAnalysis, u: undoStack.length }));
  expect(n0.ga).toBe(true);
  await page.locator('#gel-modal-bg button', { hasText: '✕ Remove analysis' }).click();
  await expect(page.locator('#gel-modal-bg')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Lane analysis removed from panel A');
  expect(await page.evaluate(() => ({ ga: !!images[0].gelAnalysis, u: undoStack.length }))).toEqual({ ga: false, u: n0.u + 1 });
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => !!images[0].gelAnalysis)).toBe(true);
  expect(errors).toEqual([]);
});

test('ISSUES "a click on a panel does not give the figure the keyboard": click a panel, → picks the next one', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const c = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 0); return [b.x + b.w / 2, b.y + b.h / 2]; });
  await clickFig(page, c[0], c[1]);
  expect(await page.evaluate(() => ({ sel: selectedPanel, focus: document.activeElement && document.activeElement.id }))).toEqual({ sel: 0, focus: 'ann-canvas' });
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => selectedPanel)).toBe(1);
  expect(errors).toEqual([]);
});

// ── ⌘K: journals and the legend key ─────────────────────────────────

test('newcomer3-22: ⌘K "check against plos" on a Nature figure reports PLOS ONE and leaves the target journal Nature', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await palette(page, 'nature');
  expect(await page.evaluate(() => gv('target-journal'))).toBe('nature');
  const u0 = await page.evaluate(() => undoStack.length);
  await palette(page, 'check against plos');
  await expect(page.locator('#im-title')).toContainText('PLOS ONE compliance');
  await expect(page.locator('#ck-as-note')).toContainText('your target journal is still Nature');
  expect(await page.evaluate(() => ({ j: gv('target-journal'), u: undoStack.length }))).toEqual({ j: 'nature', u: u0 });
  await page.keyboard.press('Escape');
  // the next ✓ Check reports Nature
  await page.evaluate(() => checkCompliance());
  await expect(page.locator('#im-title')).toContainText('Nature compliance');
  await expect(page.locator('#ck-as-note')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // and the report's own link switches, when that is what you want
  await palette(page, 'check against plos');
  await page.locator('#ck-as-note a').click();
  expect(await page.evaluate(() => gv('target-journal'))).toBe('plos');
  await expect(page.locator('#im-title')).toContainText('PLOS ONE compliance');
  expect(errors).toEqual([]);
});

test('newcomer3-06 / phage3-12: a journal with no preset is said so and changes nothing; a kept width is said', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  for (const [q, re] of [['scientific reports', /no preset for Scientific Reports/], ['frontiers', /no preset for Frontiers/],
    ['mol microbiol', /no preset for Molecular Microbiology/], ['cell reports', /no preset for Cell Reports/]]) {
    expect((await top(page, q))[0], q).toMatch(re);
  }
  // a letters-in-order guess never offers a journal, preset or theme
  const g = await page.evaluate(() => { openCmdPalette(); _cmdpRender('scntfc rprts'); const l = _cmdpFiltered.map(c => c.label); closeCmdPalette(); return l; });
  expect(g.filter(l => /^(Journal|Preset|Theme):/.test(l) && !/no preset|other journals/.test(l))).toEqual([]);
  const u0 = await page.evaluate(() => undoStack.length);
  await palette(page, 'scientific reports');
  expect(await page.evaluate(() => ({ j: gv('target-journal'), u: undoStack.length }))).toEqual({ j: 'none', u: u0 });
  await expect(page.locator('#toast')).toContainText('no Scientific Reports preset');
  // PLOS ONE (173 mm), then J Virol: ASM keeps 173 mm and says so
  await palette(page, 'plos');
  await palette(page, 'j virol');
  expect(await page.evaluate(() => ({ j: gv('target-journal'), w: gv('export-width-mm') }))).toEqual({ j: 'asm', w: '173' });
  await expect(page.locator('#toast')).toContainText('printed width kept at 173 mm');
  expect(errors).toEqual([]);
});

test('newcomer3-05: ⌘K "legend key" + Enter puts the key on the figure, and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { images[0].lut = 'green'; images[0].captionNote = 'GFP'; images[1].lut = 'blue'; images[1].captionNote = 'DAPI'; render(); });
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await palette(page, 'legend key');
  expect(await page.evaluate(() => ({ placed: _keyPlaced(), tool: activeTool, box: document.getElementById('key-on-figure').checked }))).toEqual({ placed: true, tool: 'none', box: true });
  await expect(page.locator('#toast')).toContainText('Legend key placed on the figure');
  expect(errors).toEqual([]);
});

// ── The lane table editor ──────────────────────────────────────────

test('phage3-03: name the row, click the first cell, type the row, Enter — it fills across, no "+" and no page error', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlot(page, 6, 'spots.png');
  await page.evaluate(() => { laneTableSet(0, { lanes: 6 }); openLaneTable(0); });
  await page.locator('#lt-grid .lt-name[data-r="0"]').click();
  await page.keyboard.type('Dilution');
  await page.locator('#lt-grid .lt-cell[data-r="0"][data-c="0"]').click();   // was: cycled to "+", focus lost
  await page.keyboard.type('10^{-2}, 10^{-3}, 10^{-4}, 10^{-5}, 10^{-6}, 10^{-7}');
  await page.keyboard.press('Enter');
  const t = await page.evaluate(() => images[0].laneTable.rows[0]);
  expect(t.name).toBe('Dilution');
  expect(t.cells).toEqual(['10^{-2}', '10^{-3}', '10^{-4}', '10^{-5}', '10^{-6}', '10^{-7}']);
  await expect(page.locator('#toast')).toContainText('Filled 6 cells');
  expect(errors).toEqual([]);   // was: "Failed to set the innerHTML property …"
});

test('blot3-05: one click on a cell with text puts the cursor there (no "+"); Ctrl+Z in a cell undoes the table edit', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlot(page, 4, 'blot.png');
  await page.evaluate(() => { laneTableSet(0, { lanes: 4 }); openLaneTable(0); });
  const c0 = page.locator('#lt-grid .lt-cell[data-r="0"][data-c="0"]');
  await c0.click(); await page.keyboard.type('WT, WT, R42P, R42P'); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => images[0].laneTable.rows[0].cells)).toEqual(['WT', 'WT', 'R42P', 'R42P']);
  const c2 = page.locator('#lt-grid .lt-cell[data-r="0"][data-c="2"]');
  await c2.click();                                    // was: R42P → "+"
  expect(await page.evaluate(() => images[0].laneTable.rows[0].cells[2])).toBe('R42P');
  expect(await page.evaluate(() => document.activeElement.matches('.lt-cell[data-r="0"][data-c="2"]'))).toBe(true);
  await page.keyboard.type('R42Q'); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => images[0].laneTable.rows[0].cells[2])).toBe('R42Q');
  await c2.click();
  await page.keyboard.press('Control+z');             // was: nothing undone with the caret in a cell
  expect(await page.evaluate(() => images[0].laneTable.rows[0].cells[2])).toBe('R42P');
  // empty and +/– cells still cycle with one click
  await page.evaluate(() => laneTableSetCell(0, 0, 3, ''));
  await page.locator('#lt-grid .lt-cell[data-r="0"][data-c="3"]').click();
  expect(await page.evaluate(() => images[0].laneTable.rows[0].cells[3])).toBe('+');
  await expect(page.locator('#lt-modal-bg')).toContainText('separated by commas');
  expect(errors).toEqual([]);
});

// ── Toasts ───────────────────────────────────────────────────────────

test('blot3-04: a long toast wraps inside a 1440 px window and stays up long enough to read', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await loadApp(page);
  const msg = 'Charted 9 lanes × 1 panel: Band volume ÷ the loading control, relative to lane 2; a lane with no band there is n.d. Linked — a re-analysis updates it, and pressing the button again updates this chart instead of adding another. Left out Panel B (no loading control and no reference lane).';
  await page.evaluate((m) => toast(m, 'ok'), msg);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const b = document.getElementById('toast').getBoundingClientRect(); return { l: b.left, r: b.right, h: b.height, b: b.bottom, W: innerWidth, H: innerHeight }; });
  expect(r.l).toBeGreaterThanOrEqual(0);
  expect(r.r).toBeLessThanOrEqual(r.W);
  expect(r.b).toBeLessThanOrEqual(r.H);
  expect(r.h).toBeGreaterThan(30);                    // wrapped, not one clipped line
  await page.waitForTimeout(4000);                    // past the old 3.2 s
  expect(await page.evaluate(() => document.getElementById('toast').className)).toContain('show');
  expect(errors).toEqual([]);
});

// ── Scale bars ───────────────────────────────────────────────────────

// A dark micrograph with a white 10 µm bar burned in at the bottom right (126 px).
async function addBurned(page) {
  return page.evaluate(() => {
    const W = 800, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#202020'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#5a5a5a'; for (let k = 0; k < 30; k++) x.fillRect((k * 97) % 760, (k * 53) % 420, 22, 14);
    x.fillStyle = '#ffffff'; x.fillRect(640, 548, 126, 8);
    const src = c.toDataURL('image/png');
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'phase.png'); images[images.length - 1].sbOn = false; render(); res(images.length - 1); }; img.src = src; });
  });
}

test('newcomer3-01: Auto-detect reads the burned-in bar and draws FigureLab\'s bar clear of it — or keeps the burned-in one', async ({ page }) => {
  const errors = await loadApp(page);
  await addBurned(page);
  await page.evaluate(() => autoDetectScaleBar(0));
  const dlg = page.locator('#sbdetect-modal');
  await expect(dlg).toContainText('126');
  await dlg.locator('.sbd-pick', { hasText: /^10 µm$/ }).click();
  const r = await page.evaluate(() => {
    render(); const im = images[0], b = panelBounds.find(p => p.idx === 0), k = b.dw / 800;
    const burned = { x0: b.dx + 640 * k, x1: b.dx + 766 * k, y0: b.dy + 548 * k, y1: b.dy + 556 * k };
    const s = im._sbRect, t = figTextItems.find(t => t.kind === 'sb' && t.idx === 0).bbox;
    const ov = (a, x0, y0, x1, y1) => a.x0 < x1 && a.x1 > x0 && a.y0 < y1 && a.y1 > y0;
    return { um: im.umPerPx, on: im.sbOn, corner: im._sbCornerUsed,
      barOver: ov(burned, s.x, s.y, s.x + s.w, s.y + s.h), textOver: ov(burned, t.x, t.y, t.x + t.w, t.y + t.h) };
  });
  expect(r.um).toBeCloseTo(10 / 126, 4);
  expect(r).toMatchObject({ on: true, corner: 'bl', barOver: false, textOver: false });   // was: br, exactly on top
  await expect(page.locator('#toast')).toContainText('drawn bottom left, clear of the bar in the image');
  // the exported pixels: the bottom-left corner now carries a white bar
  const px = await page.evaluate(() => { const s = images[0]._sbRect; const c = renderExportCanvas(150); render();
    const k = c.width / canvasLogicalW; const d = c.getContext('2d').getImageData(Math.round((s.x + s.w / 2) * k), Math.round((s.y + s.h / 2) * k), 1, 1).data; return [d[0], d[1], d[2]]; });
  expect(Math.min(...px)).toBeGreaterThan(200);
  // keep the burned-in bar instead: calibrated, no second bar, the caption says so
  await page.evaluate(() => autoDetectScaleBar(0));
  await dlg.locator('input[value="keep"]').check();
  await dlg.locator('.sbd-pick', { hasText: /^10 µm$/ }).click();
  const k2 = await page.evaluate(() => { render(); return { on: images[0].sbOn, burned: images[0].sbBurnedIn, drawn: _scaleBarDrawn(images[0]), cap: _captionText() }; });
  expect(k2).toMatchObject({ on: false, drawn: false, burned: { um: 10 } });
  expect(k2.cap).toContain('Scale bar (in the image), 10 µm');
  await expect(page.locator('#toast')).toContainText('the 10 µm bar in the image is the scale bar');
  expect(errors).toEqual([]);
});

test('phage3-05: a plate calibrated on its ruler sticker at the bottom right gets its bar bottom left; a bar label never runs off the panel', async ({ page }) => {
  const errors = await loadApp(page);
  const i = await page.evaluate(() => {
    const W = 1200, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#c9b98a'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.fillRect(900, 780, 260, 90);
    x.fillStyle = '#000'; for (let k = 0; k <= 20; k++) x.fillRect(910 + k * 12, 790, 1, k % 10 ? 12 : 24);
    const src = c.toDataURL('image/png');
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'plate.png'); render(); res(images.length - 1); }; img.src = src; });
  });
  await page.evaluate((i) => openCalib(i), i);
  // two clicks on the ruler's 0 and 2 cm ticks, in the dialog's own picture
  const cv = page.locator('#calib-canvas'), bb = await cv.boundingBox();
  const sc = await page.evaluate(() => calibState.scale);
  await page.mouse.click(bb.x + 910.5 * sc, bb.y + 800 * sc);
  await page.mouse.click(bb.x + 1150.5 * sc, bb.y + 800 * sc);
  await page.locator('#calib-um').fill('20'); await page.locator('#calib-unit').selectOption({ label: 'mm' });
  await page.locator('#calib-apply').click();
  const r = await page.evaluate((i) => { render(); const im = images[i], b = panelBounds.find(p => p.idx === i), s = im._sbRect;
    return { um: im.umPerPx, corner: im._sbCornerUsed, left: s.x < b.dx + b.dw / 2 }; }, i);
  expect(r.um).toBeGreaterThan(50);
  expect(r).toMatchObject({ corner: 'bl', left: true });     // was: br, on the white sticker
  // the corner can be chosen in ⚙, and ⌘K finds it
  expect((await top(page, 'scale bar position'))[0]).toMatch(/^Scale bar: which corner/);
  // a short bar at the right edge under a label wider than the bar's margin
  await page.evaluate((i) => { images[i].sbCorner = 'br'; images[i].sbUm = 3000; images[i].sbUnit = 'mm'; _ty.textPx = 0; sv('text-pt', '24');
    document.getElementById('text-pt').dispatchEvent(new Event('input', { bubbles: true })); render(); }, i);
  const t = await page.evaluate((i) => { const b = panelBounds.find(p => p.idx === i), t = figTextItems.find(t => t.kind === 'sb' && t.idx === i).bbox;
    const s = images[i]._sbRect; return { r: t.x + t.w, edge: b.ix + b.iw, l: t.x, ledge: b.ix, centredR: s.x + s.w / 2 + t.w / 2 }; }, i);
  expect(t.centredR).toBeGreaterThan(t.edge);               // centred on the bar it would run off
  expect(t.r).toBeLessThanOrEqual(t.edge + 0.5);             // was: "20 mm" cut at the panel's right edge
  expect(t.l).toBeGreaterThanOrEqual(t.ledge - 0.5);
  expect(errors).toEqual([]);
});

// ── Annotation tools, sidebar, polish ────────────────────────────────

test('freeform3-03: a new TextBox is white text on its dark box, whatever colour the T Text tool left', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { sv('ann-color', '#111111'); setTool('textbox'); });
  const [a, b] = await page.evaluate(() => { const p = panelBounds[0]; return [[p.x + 20, p.y + 20], [p.x + 140, p.y + 70]]; });
  const [ax, ay] = await client(page, a[0], a[1]), [bx, by] = await client(page, b[0], b[1]);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 }); await page.mouse.up();
  const t = await page.evaluate(() => { const a = annotations[annotations.length - 1]; return { type: a.type, color: a.color, fill: a.fillColor }; });
  expect(t).toEqual({ type: 'textbox', color: '#ffffff', fill: '#000000' });
  expect(errors).toEqual([]);
});

test('blot3-07: in Panel mode a Text click in the margin says why nothing was made', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { if (!panelAnnMode) togglePanelAnnMode(); setTool('text'); });
  await clickFig(page, 4, 4);
  await expect(page.locator('#toast')).toContainText('Panel mode pins each mark to a panel');
  expect(errors).toEqual([]);
});

test('phage3-08: an Insert icon clicked in the grid switches to freeform as one undo step — Ctrl+Z gives the grid back with its last edit', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { pushUndo(); images[0].umPerPx = 64.52; images[0].sbOn = true; render(); });
  const name = await page.evaluate(() => Object.keys(SCIENCE_ICONS)[0]);
  await page.evaluate((n) => insertIcon(n), name);
  await page.waitForFunction(() => freeformElements.length === 1);
  expect(await page.evaluate(() => layoutMode)).toBe('freeform');
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => ({ mode: layoutMode, sel: document.getElementById('layout-mode').value, icons: freeformElements.length, um: images[0].umPerPx })))
    .toEqual({ mode: 'grid', sel: 'grid', icons: 0, um: 64.52 });   // was: still freeform, then the calibration went too
  expect(errors).toEqual([]);
});

test('fluor3-09: an emptied column heading draws nothing — and stays empty when the headings are rebuilt', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 4); sc('show-col-labels', true); onLayoutChange(); render(); });
  await page.locator('#col-label-inputs input').nth(3).fill('');
  const r = await page.evaluate(() => { render(); return figTextItems.filter(t => t.kind === 'col').map(t => t.str); });
  expect(r).toEqual(['Col 1', 'Col 2', 'Col 3', '']);    // was: "Col 4" drawn
  await page.evaluate(() => { sv('rows', 2); onLayoutChange(); render(); });
  expect(await page.locator('#col-label-inputs input').nth(3).inputValue()).toBe('');
  expect(errors).toEqual([]);
});

test('freeform3-07 / freeform3-08 / charts3-14: the zoom readout is the scale shown; the letter size fields show 13.5; the welcome card names CSV', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await loadApp(page);
  await expect(page.locator('#empty-state')).toContainText('CSV/TSV → chart');
  await seedPanels(page, 2);
  await page.evaluate(() => { sv('label-pt', '13.5'); });
  const w = await page.evaluate(() => { const e = document.getElementById('label-pt'); return { w: e.offsetWidth }; });
  expect(w.w).toBeGreaterThanOrEqual(62);
  // a figure wider than its pane: the canvas is drawn smaller, and the readout says by how much
  await page.evaluate(() => { sv('panel-w', '900'); sv('cols', 2); onLayoutChange(); render(); zoomToFit(); });
  const z = await page.evaluate(() => { const fc = document.getElementById('fig-canvas'); const shown = fc.getBoundingClientRect().width / canvasLogicalW;
    return { shown: Math.round(shown * 100), btn: parseInt(document.getElementById('zoom-btn').textContent, 10) }; });
  expect(Math.abs(z.btn - z.shown)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('newcomer2-18: after ⊡ Fit the toolbar read-out keeps the printed size in mm', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => { render(); zoomToFit(); return document.getElementById('canvas-info').textContent; });
  expect(info).toContain('mm');      // was: "782×954px · 41%", the mm gone
  expect(errors).toEqual([]);
});

test('fluor2-09: when 300 ppi needs most of the picture, the inset advice says to print narrower instead', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);                       // 100 px pictures in 300 px cells
  const txt = await page.evaluate(() => {
    sv('export-width-mm', '0'); render();
    const keep = cropEdState; cropEdState = { _insetOf: 0, hasBox: true, cw: 0.3, ch: 0.3 };
    const n = _insetPpiNote(); cropEdState = keep; return n && n.txt;
  });
  expect(txt).toContain('under 300');
  expect(txt).toContain('choose a narrower printed width');     // was: "draw a region at least 469 px wide" of a 100 px image
  expect(txt).not.toContain('draw a region at least');
  expect(errors).toEqual([]);
});

test('ISSUES "the densitometry chart toast ends in a double full stop": no "n.d.."', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlot(page, 5, 'blot.png');
  const t = await page.evaluate(() => { runGelAnalysis(0); gelSetRefLane(0, 1); chartFromDensitometry(0); return document.getElementById('toast').textContent; });
  expect(t).toContain('n.d.');
  expect(t).not.toContain('n.d..');
  expect(errors).toEqual([]);
});
