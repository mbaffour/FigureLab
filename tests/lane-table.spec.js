// @ts-check
// The lane condition table: the +/− matrix over or under a blot (rows such as IPTG, phage,
// MOI; one cell per lane). A panel field (im.laneTable) drawn by the renderer as the panel's
// furniture, through emitText, in a strip of the panel's own cell; its columns sit on the
// detected lane centres of a current analysis with as many lanes, else evenly across the panel.
//
// Every test here fails on the code before the table existed: openLaneTable, laneTable* and
// the 'lanetable' text records did not exist, so the first call throws.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// A dark-on-light blot with n lanes of known position (x0 = 30 + pitch·k, 50 px wide),
// one band each (amplitude 60, or opts.amps[k]), through a lossless PNG and the real _commitImage path.
const GEN = () => {
  window.__blot = (n, name, opts) => {
    opts = opts || {};
    const pitch = opts.pitch || 90, W = opts.w || (60 + pitch * n), H = opts.h || 160;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (i + 0.5 >= 30 + pitch * k && i + 0.5 < 80 + pitch * k) s += (opts.amps ? opts.amps[k] : 60) * Math.exp(-((j + 0.5 - H / 2) ** 2) / 18);
      const v = Math.max(0, Math.min(255, Math.round(225 - s + (rnd() - 0.5) * 4))), o = (j * W + i) * 4;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const src = c.toDataURL('image/png');
    return new Promise((res, rej) => { const img = new Image();
      img.onload = () => { _commitImage(img, src, name || 'blot.png'); render(); res(images.length - 1); };
      img.onerror = rej; img.src = src; });
  };
  // The table's drawn text, from the renderer's own records.
  window.__lt = (idx) => { render(); return figTextItems.filter(t => t.kind === 'lanetable' && (idx == null || t.idx === idx))
    .map(t => ({ str: t.str, x: t.x, y: t.y, bbox: t.bbox })); };
  window.__centres = (idx) => { const a = images[idx].gelAnalysis, M = _gelFigMap(idx); return a.lanes.map(L => M.fx((L.x0 + L.x1) / 2)); };
  window.__fill = (idx, rows) => { rows.forEach((r, ri) => { if (ri) laneTableAddRow(idx, r.name); else laneTableSetName(idx, 0, r.name);
    r.cells.forEach((v, c) => laneTableSetCell(idx, ri, c, v)); }); };
};
async function setup(page) { const errors = await loadApp(page); await page.evaluate(GEN); return errors; }

test('cells cycle + / – / blank, typing overrides, each change one undo step — by API and with the mouse', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(4));
  const r = await page.evaluate(() => {
    const n0 = undoStack.length, seq = [];
    for (let i = 0; i < 4; i++) { laneTableCycle(0, 0, 0); seq.push(images[0].laneTable.rows[0].cells[0]); }
    const n1 = undoStack.length;
    laneTableSetCell(0, 0, 1, '-'); laneTableSetCell(0, 0, 2, '−'); laneTableSetCell(0, 0, 3, ' 10 ');
    const cells = images[0].laneTable.rows[0].cells.slice();
    undo(); const afterUndo = images[0].laneTable.rows[0].cells[3];
    return { seq, steps: n1 - n0, cells, afterUndo, lanes: images[0].laneTable.lanes, pos: images[0].laneTable.pos };
  });
  expect(r.seq).toEqual(['+', '–', '', '+']);
  expect(r.steps).toBe(4);
  expect(r.cells).toEqual(['+', '–', '–', '10']);   // any minus is drawn as an en dash, which a PDF can typeset
  expect(r.afterUndo).toBe('');
  expect(r.lanes).toBe(4);                          // no analysis: the lane count you type (default 4)
  expect(r.pos).toBe('above');
  // the editor: a click cycles; typing replaces what the click left selected
  await page.evaluate(() => openLaneTable(0));
  await expect(page.locator('#lt-modal-bg')).toBeVisible();
  const cell = () => page.locator('#lt-grid .lt-cell[data-r="0"][data-c="1"]');
  const n0 = await page.evaluate(() => undoStack.length);
  await cell().click();
  expect(await page.evaluate(() => ({ v: images[0].laneTable.rows[0].cells[1], n: undoStack.length }))).toEqual({ v: '', n: n0 + 1 });  // – → blank
  await cell().click();
  expect(await page.evaluate(() => images[0].laneTable.rows[0].cells[1])).toBe('+');
  await page.keyboard.type('0.1');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => ({ v: images[0].laneTable.rows[0].cells[1], n: undoStack.length }))).toEqual({ v: '0.1', n: n0 + 3 });
  await page.locator('#lt-grid .lt-name[data-r="0"]').fill('IPTG');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => images[0].laneTable.rows[0].name)).toBe('IPTG');
  expect(await page.evaluate(() => _topDialog() && _topDialog().id)).toBe('lt-modal-bg');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lt-modal-bg')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('columns sit within 2 px of the detected lane centres, and follow a moved lane', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(6));
  const r = await page.evaluate(() => {
    runGelAnalysis(0);
    __fill(0, [{ name: 'IPTG', cells: ['–', '+', '–', '+', '–', '+'] }, { name: 'phage T4', cells: ['–', '–', '–', '+', '+', '+'] }, { name: 'MOI', cells: ['', '', '', '0.1', '1', '10'] }]);
    const t = __lt(0), cen = __centres(0), pb = panelBounds.find(p => p.idx === 0);
    const before = t.filter(x => x.str !== 'IPTG' && x.str !== 'phage T4' && x.str !== 'MOI');
    // move lane 2's edges 6 px right: its column follows
    const L = images[0].gelAnalysis.lanes[1]; gelSetLane(0, 1, L.x0 + 6, L.x1 + 6);
    const cen2 = __centres(0), t2 = __lt(0).filter(x => x.y === t[1].y);
    // lane numbers placed from the analysis go above the table, not into it
    const n0 = annotations.length; gelPlaceLaneNumbers(0); render();
    const H = annCanvas.height, nums = annotations.slice(n0).map(an => [an.yf * H, an.yf * H + an.fontSize]);
    const tab = __lt(0), tTop = Math.min(...tab.map(x => x.bbox.y)), tBot = Math.max(...tab.map(x => x.bbox.y + x.bbox.h));
    return { t, before, cen, cen2, t2, pb, align: _ltAlign(images[0]).mode, lanes: images[0].laneTable.lanes, nums, tTop, tBot };
  });
  expect(r.lanes).toBe(6);                // a new table takes the analysis's lane count
  expect(r.align).toBe('lanes');
  // every cell's x within 2 px of its lane's centre
  const row0 = r.before.filter(x => Math.abs(x.y - r.before[0].y) < 0.5);
  expect(row0.length).toBe(6);
  row0.forEach((x, k) => expect(Math.abs(x.x - r.cen[k])).toBeLessThanOrEqual(2));
  const moi = r.before.filter(x => ['0.1', '1', '10'].includes(x.str));
  moi.forEach((x, k) => expect(Math.abs(x.x - r.cen[3 + k])).toBeLessThanOrEqual(2));
  // three rows, stacked above the picture and clear of it
  expect(new Set(r.t.map(x => Math.round(x.y))).size).toBe(3);
  r.t.forEach(x => expect(x.bbox.y + x.bbox.h).toBeLessThanOrEqual(r.pb.iy + 0.5));
  // the names end left of the picture
  r.t.filter(x => /[A-Za-z]/.test(x.str)).forEach(x => expect(x.bbox.x + x.bbox.w).toBeLessThanOrEqual(r.pb.ix));
  expect(r.cen2[1] - r.cen[1]).toBeGreaterThan(2);
  const moved = r.t2.filter(x => Math.abs(x.x - r.cen2[1]) <= 2);
  expect(moved.length).toBe(1);
  expect(r.nums.length).toBe(6);
  r.nums.forEach(([y0, y1]) => expect(y1 <= r.tTop + 0.5 || y0 >= r.tBot - 0.5).toBe(true));
  expect(errors).toEqual([]);
});

test('re-detecting with a different lane count: never re-mapped silently — evenly spaced and warned, then matched to the new lanes', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(6));
  const r = await page.evaluate(() => {
    const toasts = []; const t0 = window.toast; window.toast = (m, k) => toasts.push([m, k]);
    runGelAnalysis(0);
    __fill(0, [{ name: 'IPTG', cells: ['+', '+', '+', '+', '+', '+'] }]);
    const c6 = __centres(0), x6 = __lt(0).filter(x => x.str === '+').map(x => x.x);
    runGelAnalysis(0, { laneCount: 5 });                  // forced to five evenly pitched lanes
    const pb = panelBounds.find(p => p.idx === 0), xEven = __lt(0).filter(x => x.str === '+').map(x => x.x);
    const warn = toasts.find(t => /lane table has 6 columns/.test(t[0]));
    openGelAnalysis(0); const banner = document.getElementById('gel-banner').textContent; closeGelAnalysis();
    openLaneTable(0); const status = document.getElementById('lt-status').textContent, matchBtn = document.getElementById('lt-match').textContent; closeLaneTable();
    checkCompliance(); const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Densitometry/.test(x)) || '';
    document.getElementById('info-modal-bg')?.remove();
    const n0 = undoStack.length; laneTableMatchLanes(0); const steps = undoStack.length - n0;
    const c5 = __centres(0), x5 = __lt(0).filter(x => x.str === '+').map(x => x.x);
    window.toast = t0;
    return { c6, x6, xEven, pb, warn: !!warn, banner, status, matchBtn, row, steps, c5, x5, mode: _ltAlign(images[0]).mode };
  });
  r.x6.forEach((x, k) => expect(Math.abs(x - r.c6[k])).toBeLessThanOrEqual(2));
  expect(r.xEven.length).toBe(6);
  r.xEven.forEach((x, k) => expect(Math.abs(x - (r.pb.ix + (k + 0.5) / 6 * r.pb.iw))).toBeLessThanOrEqual(0.5));
  expect(r.warn).toBe(true);
  expect(r.banner).toMatch(/lane table has 6 columns and 5 lanes were found/);
  expect(r.status).toMatch(/found 5 lanes and the table has 6 columns — spaced evenly/);
  expect(r.matchBtn).toMatch(/Match the 5 detected lanes/);
  expect(r.row).toMatch(/lane table has 6 columns but 5 lanes were detected/);
  expect(r.steps).toBe(1);
  expect(r.mode).toBe('lanes');
  expect(r.x5.length).toBe(5);
  r.x5.forEach((x, k) => expect(Math.abs(x - r.c5[k])).toBeLessThanOrEqual(2));
  expect(errors).toEqual([]);
});

test('without an analysis the columns are spaced evenly across the panel for the lane count typed', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(5));
  const r = await page.evaluate(() => {
    laneTableSet(0, { lanes: 3 }); __fill(0, [{ name: 'Drug', cells: ['+', '–', '+'] }]);
    const pb = panelBounds.find(p => p.idx === 0);
    openLaneTable(0); const status = document.getElementById('lt-status').textContent; closeLaneTable();
    return { xs: __lt(0).filter(x => x.str !== 'Drug').map(x => x.x), pb, status };
  });
  expect(r.xs.length).toBe(3);
  r.xs.forEach((x, k) => expect(Math.abs(x - (r.pb.ix + (k + 0.5) / 3 * r.pb.iw))).toBeLessThanOrEqual(0.5));
  expect(r.status).toMatch(/No lane analysis on this panel — the 3 columns are spaced evenly/);
  expect(errors).toEqual([]);
});

test('survives save and load, undo and duplicate; undo snapshots never share it', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(4));
  const r = await page.evaluate(async () => {
    __fill(0, [{ name: 'IPTG', cells: ['–', '+', '–', '+'] }, { name: 'MOI', cells: ['', '1', '', '10'] }]);
    laneTableSet(0, { pos: 'below', fs: 14 });
    const before = JSON.stringify(images[0].laneTable), drawn = JSON.stringify(__lt(0).map(t => [t.str, Math.round(t.x), Math.round(t.y)]));
    const snap = snapshotState(); const shared = snap.images[0].laneTable === images[0].laneTable;
    const s = JSON.parse(JSON.stringify(serializeSession()));
    images = []; render();
    applySession(s, { silent: true });
    await new Promise(res => { const t = () => (images[0] && images[0].img && images[0].img.complete) ? res() : setTimeout(t, 20); t(); });
    const loaded = JSON.stringify(images[0].laneTable), drawnLoaded = JSON.stringify(__lt(0).map(t => [t.str, Math.round(t.x), Math.round(t.y)]));
    // undo of an edit restores the table exactly
    laneTableSetCell(0, 1, 0, '0.1'); const edited = images[0].laneTable.rows[1].cells[0];
    undo(); const undone = JSON.stringify(images[0].laneTable);
    // duplicate: the copy has the table, and editing the copy leaves the original alone
    renderImgList(); document.querySelector('[data-dup="0"]').click();
    laneTableSetCell(1, 0, 0, '+');
    return { before, loaded, drawn, drawnLoaded, shared, edited, undone, orig: images[0].laneTable.rows[0].cells[0], copy: images[1].laneTable.rows[0].cells[0],
      copyDrawn: __lt(1).length };
  });
  expect(r.shared).toBe(false);
  expect(r.loaded).toBe(r.before);
  expect(r.drawnLoaded).toBe(r.drawn);
  expect(JSON.parse(r.before).pos).toBe('below');
  expect(r.edited).toBe('0.1');
  expect(r.undone).toBe(r.before);
  expect(r.orig).toBe('–');
  expect(r.copy).toBe('+');
  expect(r.copyDrawn).toBe(8);    // 2 names + 6 non-blank cells on the copy
  expect(errors).toEqual([]);
});

test('SVG export carries the row names and +/– as <text>; every item can be typeset in the PDF', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(4));
  const r = await page.evaluate(async () => {
    runGelAnalysis(0);
    __fill(0, [{ name: 'IPTG', cells: ['–', '+', '–', '+'] }, { name: 'phage T4', cells: ['–', '–', '+', '+'] }]);
    const cap = await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')));
    const svg = new TextDecoder().decode(cap.data);
    const items = (render(), figTextItems.filter(t => t.kind === 'lanetable'));
    return { svg, pdf: items.every(_pdfCanTypeset), n: items.length };
  });
  const texts = [...r.svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  expect(texts).toContain('IPTG');
  expect(texts).toContain('phage T4');
  expect(texts.filter(t => t === '+').length).toBe(4);
  expect(texts.filter(t => t === '–').length).toBe(4);
  expect(r.n).toBe(10);
  expect(r.pdf).toBe(true);
  expect(errors).toEqual([]);
});

test('moves with its panel (H gap), keeps clear of the neighbouring panel, and rows-hug makes room for it', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(async () => { await __blot(4, 'other.png'); await __blot(4, 'blot.png'); sv('cols', 2); sv('rows', 1); onLayoutChange(); render(); });
  const r = await page.evaluate(() => {
    runGelAnalysis(1);
    __fill(1, [{ name: 'IPTG', cells: ['–', '+', '–', '+'] }, { name: 'phage T4', cells: ['–', '–', '+', '+'] }, { name: 'MOI', cells: ['', '', '1', '10'] }]);
    const g0 = gi('gap-h'), t0 = __lt(1), left = panelBounds.find(p => p.idx === 0), b0 = panelBounds.find(p => p.idx === 1);
    sv('gap-h', g0 + 40); render();
    const t1 = __lt(1), cen1 = __centres(1), b1 = panelBounds.find(p => p.idx === 1);
    // rows hug their panels: the row is tall enough for the picture and the table
    sc('auto-row-h', true); onLayoutChange(); render();
    const G = gridGeom(), t2 = __lt(1), pb2 = panelBounds.find(p => p.idx === 1);
    return { g0, t0, t1, cen1, left, G, t2, pb2, b0, b1 };
  });
  // The wider gap moved the panel (and, with the figure width held, shrank it a little):
  // the table went with it — names still end the same distance left of the picture, the
  // rows still end the same distance above it, the cells still on the lanes.
  expect(r.b1.ix - r.b0.ix).toBeGreaterThan(5);
  const names = t => t.filter(x => /[A-Za-z]/.test(x.str)), gapAbove = (t, b) => b.iy - Math.max(...t.map(x => x.bbox.y + x.bbox.h));
  names(r.t0).forEach((x, i) => expect((r.b1.ix - (names(r.t1)[i].bbox.x + names(r.t1)[i].bbox.w)) - (r.b0.ix - (x.bbox.x + x.bbox.w))).toBeCloseTo(0, 0));
  expect(gapAbove(r.t1, r.b1)).toBeCloseTo(gapAbove(r.t0, r.b0), 0);
  expect(Math.min(...r.t1.map(x => x.x))).toBeGreaterThan(Math.min(...r.t0.map(x => x.x)) + 5);
  r.t1.filter(x => !/[A-Za-z]/.test(x.str)).forEach(x => expect(Math.min(...r.cen1.map(c => Math.abs(c - x.x)))).toBeLessThanOrEqual(2));
  // never over the panel to its left
  r.t0.forEach(x => expect(x.bbox.x).toBeGreaterThanOrEqual(r.left.x + r.left.w));
  // hugged: the table is inside the row, not above it, and clear of the picture
  r.t2.forEach(x => { expect(x.bbox.y).toBeGreaterThanOrEqual(r.G.y0 - 0.5); expect(x.bbox.y + x.bbox.h).toBeLessThanOrEqual(r.pb2.iy + 0.5); });
  expect(errors).toEqual([]);
});

// The row names need room left of the blot. Taking it from that panel alone shrank and
// shifted its picture, so its lanes no longer stood over those of the loading control
// stacked under it; the whole column gives the strip up instead.
test('a blot with a table and the loading control stacked under it keep their lanes in register', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(async () => { await __blot(6, 'target.png'); await __blot(6, 'actin.png', { h: 60 }); sv('cols', 1); sv('rows', 2); sv('m-left', 4); onLayoutChange(); render(); });
  const r = await page.evaluate(() => {
    const before = panelBounds.find(p => p.idx === 0).iw;
    __fill(0, [{ name: 'phage T4', cells: ['–', '–', '–', '+', '+', '+'] }]);
    render();
    const a = panelBounds.find(p => p.idx === 0), b = panelBounds.find(p => p.idx === 1), t = __lt(0);
    return { before, a, b, nameLeft: Math.min(...t.map(x => x.bbox.x)) };
  });
  expect(r.a.iw).toBeLessThan(r.before);            // the names did need room
  expect(r.b.ix).toBe(r.a.ix);                      // and both pictures gave it up alike
  expect(r.b.iw).toBe(r.a.iw);
  expect(r.nameLeft).toBeGreaterThanOrEqual(0);     // on the sheet
  expect(errors).toEqual([]);
});

test('the S1 sheet is unaffected; freeform refuses; reachable from the sidebar, the gel dialog and the palette', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => __blot(4));
  const r = await page.evaluate(() => {
    const s1a = _s1PageCanvas(images[0]).canvas.toDataURL();
    __fill(0, [{ name: 'IPTG', cells: ['–', '+', '–', '+'] }]);
    const s1b = _s1PageCanvas(images[0]).canvas.toDataURL();
    const out = { s1: s1a === s1b, sidebar: !!document.querySelector('button[onclick="openLaneTable()"]') };
    runGelAnalysis(0); openGelAnalysis(0); out.gelBtn = !!document.querySelector('#gel-modal-bg button[onclick="openLaneTable(_gelUI.idx)"]'); closeGelAnalysis();
    out.q = {};
    for (const q of ['lane table', 'condition table', 'plus minus', 'treatment matrix', 'sample key', 'blot labels']) { _cmdpRender(q); out.q[q] = (_cmdpFiltered[0] || {}).label; }
    out.dlg = !!_DIALOGS['lt-modal-bg'];
    const n = undoStack.length; layoutMode = 'freeform'; out.ff = openLaneTable(0); out.ffEdit = laneTableCycle(0, 0, 0); out.ffSteps = undoStack.length - n; layoutMode = 'grid';
    return out;
  });
  expect(r.s1).toBe(true);
  expect(r.sidebar).toBe(true);
  expect(r.gelBtn).toBe(true);
  for (const q of Object.keys(r.q)) expect(r.q[q], q).toMatch(/^Lane table/);
  expect(r.dlg).toBe(true);
  expect(r.ff).toBe(false); expect(r.ffEdit).toBe(false); expect(r.ffSteps).toBe(0);
  expect(errors).toEqual([]);
});

// ── Round 3 of the adversarial lane-table tests (T3-*) ────────────────────────────────
// The drawn lanes, read back from the figure canvas: runs of columns darker than the
// background along the band's row, each with how dark it gets (lane k is darker than k−1).
const DRAWN = () => {
  window.__drawnLanes = (idx) => {
    render();
    const pb = panelBounds.find(p => p.idx === idx), cv = document.getElementById('fig-canvas'), s = cv.width / canvasLogicalW;
    const x = cv.getContext('2d'), y = Math.round((pb.iy + pb.ih / 2) * s), W = Math.round(pb.iw * s);
    const d = x.getImageData(Math.round(pb.ix * s), y - 2, W, 4).data, col = [];
    for (let i = 0; i < W; i++) { let t = 0; for (let r = 0; r < 4; r++) t += d[(r * W + i) * 4]; col.push(t / 4); }
    const runs = []; let st = -1;
    for (let i = 0; i <= W; i++) { const dark = i < W && col[i] < 212; if (dark && st < 0) st = i;
      if (!dark && st >= 0) { if (i - st > 5) { let m = 255; for (let k = st; k < i; k++) m = Math.min(m, col[k]); runs.push({ x: pb.ix + (st + i) / 2 / s, min: m }); } st = -1; } }
    // lane number = rank by darkness (lightest is lane 1)
    const byDark = runs.slice().sort((p, q) => q.min - p.min);
    return runs.map(r => ({ x: r.x, lane: byDark.indexOf(r) + 1 }));
  };
};

// Fails on 4bb72e9: mirrored, the columns kept their left-to-right order, so dose 6 was
// printed over lane 1 (and evenly spaced, up to 22 px off the lanes).
test('mirrored or turned 180°, the table reverses with the picture: each condition stays over its own lane (T3-01)', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(DRAWN);
  const r = await page.evaluate(async () => {
    const toasts = []; const t0 = window.toast; window.toast = m => toasts.push(m);
    await __blot(6, 'blot.png', { amps: [30, 50, 70, 90, 110, 130] });
    runGelAnalysis(0);
    __fill(0, [{ name: 'dose', cells: ['1', '2', '3', '4', '5', '6'] }]);
    const read = () => ({ lanes: __drawnLanes(0), cells: __lt(0).filter(t => /^\d$/.test(t.str)).map(t => ({ k: +t.str, x: t.x })) });
    const out = { plain: read() };
    images[0].flipH = true; out.flipH = read(); out.flipToast = toasts.filter(m => /mirrored/.test(m)).length;
    openLaneTable(0); out.flipStatus = document.getElementById('lt-status').textContent; closeLaneTable();
    images[0].flipH = false; images[0].rotate = 180; out.rot180 = read();
    images[0].flipH = true; out.both = read();      // mirrored AND turned 180°: the right way round again
    window.toast = t0;
    return out;
  });
  for (const k of ['plain', 'flipH', 'rot180', 'both']) {
    const { lanes, cells } = r[k];
    expect(lanes.length, k).toBe(6);
    cells.forEach(c => { const L = lanes.find(l => l.lane === c.k); expect(Math.abs(c.x - L.x), `${k}: dose ${c.k}`).toBeLessThanOrEqual(2); });
  }
  // and it is the drawing that moved: mirrored, lane 1 (dose 1) is the rightmost
  expect(r.flipH.cells.find(c => c.k === 1).x).toBeGreaterThan(r.flipH.cells.find(c => c.k === 6).x);
  expect(r.flipToast).toBe(1);
  expect(r.flipStatus).toMatch(/mirrored — the columns are reversed with the picture/);
  expect(errors).toEqual([]);
});

// Fails on 4bb72e9: turned, the table was silently spaced evenly — no toast, no banner or
// compliance warning, and nothing to confirm it with.
test('turned 90°, the table is flagged everywhere until it is re-mapped to the lanes as drawn, one undo step (T3-01)', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const toasts = []; const t0 = window.toast; window.toast = m => toasts.push(m);
    await __blot(4, 'blot.png');
    runGelAnalysis(0);
    __fill(0, [{ name: 'IPTG', cells: ['–', '+', '–', '+'] }]);
    __lt(0);
    const row = () => { checkCompliance(); const t = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Densitometry/.test(x)) || ''; document.getElementById('info-modal-bg')?.remove(); return t; };
    // the analysis dialog refuses a turned panel, so it is open when the panel is turned
    openGelAnalysis(0);
    pushUndo(); images[0].rotate = 90; __lt(0); _gelRefresh();
    const out = { toast: toasts.filter(m => /turned 90°/.test(m)), align: _ltAlign(images[0]) };
    out.banner = document.getElementById('gel-banner').textContent.replace(/\s+/g, ' '); closeGelAnalysis();
    out.row = row();
    openLaneTable(0); out.status = document.getElementById('lt-status').textContent; out.btn = !!document.getElementById('lt-remap');
    const n = undoStack.length; document.getElementById('lt-remap').click();
    out.steps = undoStack.length - n; out.after = { align: _ltAlign(images[0]), status: document.getElementById('lt-status').textContent, row: row() };
    closeLaneTable();
    images[0].rotate = 270; out.again = _ltAlign(images[0]);
    images[0].rotate = 90; undo(); out.undone = _ltAlign(images[0]);
    window.toast = t0;
    return out;
  });
  expect(r.toast.length).toBe(1);
  expect(r.align.why).toBe('turned'); expect(r.align.ok).toBe(false);
  expect(r.row).toMatch(/the panel is turned 90° — its lane table is spaced evenly and may not match the lanes/);
  expect(r.banner).toMatch(/The panel is turned 90° — its lanes are no longer columns/);
  expect(r.status).toMatch(/turned 90° — its lanes no longer run across the page/);
  expect(r.btn).toBe(true);
  expect(r.steps).toBe(1);
  expect(r.after.align.ok).toBe(true);
  expect(r.after.status).toMatch(/you accepted the table as drawn/);
  expect(r.after.row).not.toMatch(/turned 90°/);
  expect(r.again.ok).toBe(false);                    // turned again: flagged again
  expect(r.undone.ok).toBe(false);                   // and the acceptance undoes
  expect(errors).toEqual([]);
});

// Fails on 4bb72e9: 10 rows at 24 px gave the lower blot a picture of −79 × −30 px, the
// texts overprinted, and the stacked blots fell out of register.
test('a table too tall for its cell is set smaller to fit half the cell, the picture stays positive and in register, and a row past the floor is refused (T3-06)', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const toasts = []; const t0 = window.toast; window.toast = m => toasts.push(m);
    await __blot(4, 'top.png'); await __blot(4, 'bottom.png');
    sv('cols', 1); sv('rows', 2); sc('show-col-labels', true); onLayoutChange(); render();
    runGelAnalysis(1);
    const rows = []; for (let i = 0; i < 10; i++) rows.push({ name: 'cond ' + (i + 1), cells: ['+', '–', '+', '–'] });
    __fill(1, rows); laneTableSet(1, { fs: 24 }); render();
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const read = () => { render(); const all = figTextItems.filter(t => t.bbox), lt = all.filter(t => t.kind === 'lanetable');
      let self = 0, other = 0; for (let i = 0; i < lt.length; i++) { for (let j = i + 1; j < lt.length; j++) if (ov(lt[i].bbox, lt[j].bbox)) self++; all.forEach(o => { if (o.kind !== 'lanetable' && ov(lt[i].bbox, o.bbox)) other++; }); }
      const p0 = panelBounds.find(p => p.idx === 0), p1 = panelBounds.find(p => p.idx === 1);
      return { p0: { ix: p0.ix, iw: p0.iw, ih: p0.ih }, p1: { ix: p1.ix, iw: p1.iw, ih: p1.ih }, self, other, n: lt.length, fs: Math.max(...lt.map(t => t.fs)) }; };
    const out = { at24: read() };
    openLaneTable(1); out.status = document.getElementById('lt-status').textContent; closeLaneTable();
    // more rows until one is refused: the picture never goes below 20 px
    let k = 0; while (k < 40 && laneTableAddRow(1, 'more ' + k)) { laneTableSetCell(1, images[1].laneTable.rows.length - 1, 0, '+'); k++; }
    out.added = k; out.refusal = toasts.filter(m => /No room for another row/.test(m)).length; out.full = read();
    out.texts = images[1].laneTable.rows.reduce((s, row) => s + (row.name ? 1 : 0) + row.cells.filter(Boolean).length, 0);
    window.toast = t0;
    return out;
  });
  for (const s of [r.at24, r.full]) {
    expect(s.p1.iw).toBeGreaterThan(20); expect(s.p1.ih).toBeGreaterThanOrEqual(20);
    expect(s.p1.ix).toBe(s.p0.ix); expect(s.p1.iw).toBe(s.p0.iw);    // the stacked blots stay in register
    expect(s.self).toBe(0); expect(s.other).toBe(0);
  }
  expect(r.at24.fs).toBeLessThan(24);
  expect(r.status).toMatch(new RegExp(`Drawn at ${r.at24.fs} px, not 24 px`));
  expect(r.added).toBeLessThan(40);
  expect(r.refusal).toBe(1);
  expect(r.full.n).toBe(r.texts);                     // every row that was accepted is drawn
  expect(errors).toEqual([]);
});

// Fails on 4bb72e9: long cells were centred with no width check and overprinted their
// neighbours (36 px) and the row name; names with format marks stopped 19 px short of the
// picture instead of 7, measured with their asterisks.
test('cells fit their lanes (smaller, then cut with … and the full text in the editor); marked-up names sit the designed gap from the picture (T3-02, T3-03)', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __blot(6, 'blot.png');
    runGelAnalysis(0);
    __fill(0, [{ name: 'treatment', cells: ['ciprofloxacin', 'ampicillin 100', '+', 'kanamycin', '–', 'tetracycline 10'] },
               { name: '*E. coli* strain', cells: ['*WT*', 'Δ*fliC*', '', '', '', ''] }, { name: 'IPTG', cells: ['+', '–', '+', '–', '+', '–'] }]);
    laneTableSet(0, { fs: 14 });
    const ov = (a, b) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
    const lt = __lt(0), pb = panelBounds.find(p => p.idx === 0);
    let overlaps = 0; for (let i = 0; i < lt.length; i++) for (let j = i + 1; j < lt.length; j++) if (ov(lt[i].bbox, lt[j].bbox)) overlaps++;
    const names = ['treatment', '*E. coli* strain', 'IPTG'].map(s => { const t = lt.find(x => x.str === s); return { s, gap: pb.ix - (t.bbox.x + t.bbox.w) }; });
    const cells = lt.filter(t => !['treatment', '*E. coli* strain', 'IPTG'].includes(t.str));
    openLaneTable(0);
    const cutTitle = document.querySelector('#lt-grid .lt-cell[data-r="0"][data-c="0"]').title, status = document.getElementById('lt-status').textContent;
    closeLaneTable();
    // twenty columns of '10' / '0.1' on a narrow panel
    images = []; await __blot(4, 'narrow.png', { pitch: 60 });
    laneTableSet(0, { lanes: 20 }); for (let c = 0; c < 20; c++) laneTableSetCell(0, 0, c, c % 2 ? '0.1' : '10');
    const l20 = __lt(0); let o20 = 0; for (let i = 0; i < l20.length; i++) for (let j = i + 1; j < l20.length; j++) if (ov(l20[i].bbox, l20[j].bbox)) o20++;
    return { overlaps, names, inPicture: cells.every(t => t.bbox.x >= pb.ix - 0.5 && t.bbox.x + t.bbox.w <= pb.ix + pb.iw + 0.5), cutTitle, status, o20, n20: l20.length };
  });
  expect(r.overlaps).toBe(0);
  r.names.forEach(n => expect(Math.abs(n.gap - 7), n.s).toBeLessThanOrEqual(1));    // fs 14 × 0.5
  expect(r.inPicture).toBe(true);                    // every cell between the picture's edges, clear of the names
  expect(r.cutTitle).toMatch(/cut short with … on the figure\. Full text: ciprofloxacin/);
  expect(r.status).toMatch(/cut short with … on the figure/);
  expect(r.n20).toBe(20); expect(r.o20).toBe(0);
  expect(errors).toEqual([]);
});

// Fails on 4bb72e9: switching to freeform dropped the table from the figure with no word.
test('switching to freeform says the lane table is not drawn there, and that it is back on return to grid (T3-04)', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const toasts = []; const t0 = window.toast; window.toast = m => toasts.push(m);
    await __blot(4);
    __fill(0, [{ name: 'IPTG', cells: ['–', '+', '–', '+'] }]);
    setLayoutMode('freeform'); render();
    const out = { ff: toasts.slice(), drawnFF: figTextItems.filter(t => t.kind === 'lanetable').length, kept: !!images[0].laneTable };
    checkCompliance(); out.row = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => e.textContent).find(x => /Lane table|Densitometry/.test(x)) || '';
    document.getElementById('info-modal-bg')?.remove();
    setLayoutMode('grid'); out.back = toasts.slice(out.ff.length); out.drawn = __lt(0).length;
    window.toast = t0;
    return out;
  });
  expect(r.ff.length).toBe(1);
  expect(r.ff[0]).toMatch(/lane table on panel A is not drawn in freeform layout — kept, and drawn again when you switch back to Grid/);
  expect(r.drawnFF).toBe(0); expect(r.kept).toBe(true);
  expect(r.row).toMatch(/its lane table is not drawn in freeform layout/);
  expect(r.back.length).toBe(1); expect(r.back[0]).toMatch(/drawn again/);
  expect(r.drawn).toBe(5);
  expect(errors).toEqual([]);
});
