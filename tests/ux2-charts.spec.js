// @ts-check
// Usability round 2 — charts and densitometry → chart. Each test follows a tester's
// finding (charts2-NN, blot2-NN, or an item of docs/guides/verify/ISSUES.md) through the
// app's own controls — files dropped, dialog fields, buttons — and checks what the chart
// draws, what the key lists and what the files carry.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

const CFU = `strain,replicate,cfu_per_ml
PAO1,1,1348220000
PAO1,2,1119510000
PAO1,3,1183530000
dpilA,1,28290000
dpilA,2,21050000
dpilA,3,25730000
dfliC,1,147750000
dfliC,2,102970000
dfliC,3,148320000`;
const TWITCH = `strain,twitch_mm
PAO1,17.4
PAO1,12.8
PAO1,12.6
dpilA,7.0
dpilA,4.2
dpilA,6.4`;
const GROWTH = `strain,time_h,replicate,cfu_per_ml
PAO1,0,1,1000000
PAO1,0,2,1057000
PAO1,0,3,951000
PAO1,4,1,67414000
PAO1,4,2,70123000
PAO1,4,3,61002000
dpilA,0,1,990000
dpilA,0,2,1010000
dpilA,0,3,1030000
dpilA,4,1,9000000
dpilA,4,2,700000000
dpilA,4,3,11000000`;

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

const modal = page => page.locator('#chart-modal');
// Drop a CSV into the grid through the app's file path; wait for its Chart dialog.
async function drop(page, csv, name) {
  const n0 = await page.evaluate(() => images.filter(p => p && p.type === 'chart').length);
  await page.evaluate(([csv, name]) => addFiles([new File([csv], name, { type: 'text/csv' })]), [csv, name]);
  await page.waitForFunction(n0 => images.filter(p => p && p.type === 'chart').length > n0 && document.getElementById('chart-modal').classList.contains('open'), n0);
}
const apply = page => modal(page).getByRole('button', { name: 'Apply' }).click();
// Open a chart panel's editor the way a double-click does.
const edit = (page, letter) => page.evaluate(l => openDataPanelEditor(images.findIndex(p => p && p.type === 'chart' && _rtText(formatLabel(p.label)) === l)), letter);
// The colour each drawn sample has in one chart panel, by the name shown.
const colours = (page, letter) => page.evaluate(l => {
  const el = images.find(p => p && p.type === 'chart' && _rtText(formatLabel(p.label)) === l); el._chartKey = '';
  const st = _chartStatsCached(el), L = st.catColours || st.boxes || st.series || st.seriesNames || [];
  return Object.fromEntries(L.map(x => [_rtText(x.name), x.color]));
}, letter);
// Look is open on a fresh page; open it if it is not.
async function openLook(page) {
  const sum = page.locator('summary', { hasText: /^Look$/ });
  if (!(await sum.evaluate(s => s.parentElement.open))) await sum.click();
  await page.locator('#sample-colours-list').scrollIntoViewIfNeeded();
}
const keyRows = page => page.evaluate(() => _figureKey().filter(r => r.kind === 'series').map(r => `${_rtText(r.name)} ${r.color}`));

// ── Sample identity: one colour and one name per sample, across panels and reorders ──
test('charts2-27: moving a group in one chart keeps its colour, as in the other panels, and the key gains no second row', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv'); await apply(page);
  await drop(page, TWITCH, 'twitch.csv');
  await modal(page).locator('#chart-kind').selectOption('beeswarm');
  await apply(page);
  const A = await colours(page, 'A'), B0 = await colours(page, 'B');
  expect(B0.PAO1).toBe(A.PAO1);
  expect(B0.dpilA).toBe(A.dpilA);
  // Names & colours › ↓ on PAO1, Apply
  await edit(page, 'B');
  await modal(page).locator('#chart-names [data-key="PAO1"] button[title="Move right"]').click();
  await apply(page);
  const B1 = await colours(page, 'B');
  const order = await page.evaluate(() => _chartStatsCached(images.find(p => p && p.type === 'chart' && p.chart.kind === 'beeswarm')).categories);
  expect(order).toEqual(['dpilA', 'PAO1']);
  expect(B1.PAO1).toBe(A.PAO1);
  expect(B1.dpilA).toBe(A.dpilA);
  const rows = await keyRows(page);
  expect(rows.filter(r => r.startsWith('PAO1 ')).length).toBe(1);
  expect(rows.filter(r => r.startsWith('dpilA ')).length).toBe(1);
  expect(errors).toEqual([]);
});

test('charts2-27: a new panel whose first group is another strain does not take a colour a strain already has', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, GROWTH, 'growth.csv'); await apply(page);
  await drop(page, 'strain,time_h,v\ndpilA,0,1\ndpilA,4,2\nnewS,0,3\nnewS,4,4\n', 'b.csv'); await apply(page);
  const A = await colours(page, 'A'), B = await colours(page, 'B');
  expect(Object.keys(A)).toEqual(['PAO1', 'dpilA']);
  expect(B.dpilA).toBe(A.dpilA);
  expect(Object.values(A)).not.toContain(B.newS);
  expect(errors).toEqual([]);
});

test('ISSUES "Sample colours switches…": a one-series bar chart is coloured by its groups from the start, and Look lists the groups', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv'); await apply(page);
  const A = await colours(page, 'A');
  expect(Object.keys(A)).toEqual(['PAO1', 'dpilA', 'dfliC']);
  expect(new Set(Object.values(A)).size).toBe(3);
  await openLook(page);
  const names = await page.locator('#sample-colours-list [data-name]').evaluateAll(r => r.map(e => e.dataset.name));
  expect(names).toEqual(['PAO1', 'dpilA', 'dfliC']);
  // × on one strain set by hand brings back its palette colour, and the list keeps the strains
  await page.locator('#sample-colours-list [data-name="PAO1"] input[type=color]').evaluate(i => { i.value = '#882255'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  expect((await colours(page, 'A')).PAO1).toBe('#882255');
  await page.locator('#sample-colours-list [data-name="PAO1"] button').click();
  expect((await colours(page, 'A')).PAO1).toBe(A.PAO1);
  expect(await page.locator('#sample-colours-list [data-name]').evaluateAll(r => r.map(e => e.dataset.name))).toEqual(['PAO1', 'dpilA', 'dfliC']);
  expect(errors).toEqual([]);
});

test('charts2-08: Look › Sample colours, open while charts are added, lists them at once — under the names shown', async ({ page }) => {
  const errors = await loadApp(page);
  await openLook(page);
  await drop(page, CFU, 'cfu.csv');
  await modal(page).locator('#chart-names [data-key="dpilA"] input[type=text]').fill('Δ*pilA*');
  await apply(page);
  await page.waitForTimeout(150);
  const rows = await page.locator('#sample-colours-list [data-name]').evaluateAll(r => r.map(e => e.innerText.trim()));
  expect(rows.length).toBe(3);
  expect(rows[0]).toContain('PAO1');
  expect(rows[1]).toContain('ΔpilA');
  expect(rows[1]).toContain('(dpilA)');
  // a mean column shown without " mean" is the same sample as the tidy file's group
  await drop(page, 'time_h,PAO1 mean,PAO1 SD\n0,1,0.1\n4,2,0.2\n', 'ms.csv'); await apply(page);
  await page.waitForTimeout(150);
  const names = await page.locator('#sample-colours-list [data-name]').evaluateAll(r => r.map(e => e.dataset.name));
  expect(names.filter(n => /PAO1/.test(n))).toEqual(['PAO1']);
  expect(errors).toEqual([]);
});

test('charts2-06: a "shown as" name typed in one chart is the sample\'s name in every chart', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv'); await apply(page);
  await drop(page, TWITCH, 'twitch.csv'); await apply(page);
  await edit(page, 'A');
  await modal(page).locator('#chart-names [data-key="dpilA"] input[type=text]').fill('Δ*pilA*');
  await apply(page);
  const cats = await page.evaluate(() => _allCharts().map(el => { el._chartKey = ''; return _chartStatsCached(el).categories; }));
  expect(cats[0]).toContain('Δ*pilA*');
  expect(cats[1]).toContain('Δ*pilA*');
  // the other chart's dialog shows the name it now has
  await edit(page, 'B');
  expect(await modal(page).locator('#chart-names [data-key="dpilA"] input[type=text]').inputValue()).toBe('Δ*pilA*');
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  // one undo step takes it back everywhere
  await page.evaluate(() => undo());
  const back = await page.evaluate(() => _allCharts().map(el => { el._chartKey = ''; return _chartStatsCached(el).categories.includes('dpilA'); }));
  expect(back).toEqual([true, true]);
  expect(errors).toEqual([]);
});

test('charts2-09/18: paper_style.json keeps every strain\'s colour, palette ones too; the status line claims no lab style', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv');
  await modal(page).locator('#chart-names [data-key="dpilA"] input[type=color]').evaluate(i => { i.value = '#882255'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await apply(page);
  await openLook(page);
  const st = await page.locator('#lab-style-status').innerText();
  expect(st).not.toMatch(/Lab style/);
  expect(st).toMatch(/Sample colours: 1 set by hand/);
  const A = await colours(page, 'A');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save as paper_style\.json/ }).click()]);
  const json = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  expect(json.settings.sample_palette).toEqual({ PAO1: A.PAO1.toLowerCase(), dpilA: '#882255', dfliC: A.dfliC.toLowerCase() });
  expect(errors).toEqual([]);
});

// ── Densitometry → chart ─────────────────────────────────────────────────────────
// Synthetic blots: Gaussian bands on a light background, committed as panels.
const GEL = () => {
  window.__gelPng = (spec) => {
    const W = spec.w, H = spec.h, vals = new Float64Array(W * H);
    let seed = spec.seed || 11; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let sg = 0; const x = i + 0.5, y = j + 0.5;
      for (const L of spec.lanes) if (x >= L.x0 && x < L.x1) for (const b of L.bands) sg += b.amp * Math.exp(-((y - b.y) ** 2) / (2 * b.s * b.s));
      vals[j * W + i] = Math.max(0, Math.min(255, Math.round(spec.bg - sg + (rnd() - 0.5) * 2)));
    }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let k = 0; k < W * H; k++) { id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = vals[k]; id.data[k * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  };
  window.__gelMake = (spec) => {
    const src = __gelPng(spec);
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, spec.name); render(); res(); }; img.src = src; });
  };
  // lanes: one entry per lane, a list of [y, amp] bands
  window.__blot = (name, lanes, seed) => ({ w: 60 + 70 * lanes.length, h: 160, bg: 228, name, seed,
    lanes: lanes.map((bands, k) => ({ x0: 30 + 70 * k, x1: 75 + 70 * k, bands: bands.map(([y, amp]) => ({ y, s: 3, amp })) })) });
  // Whether the chart draws its "out of date" note, read from what it draws
  window.__recNotes = el => { const T = []; el._chartKey = ''; _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s) { T.push(String(s)); } }); return T.some(s => /out of date with the densitometry/.test(s)); };
};
async function gelSetup(page) {
  const errors = await loadApp(page);
  await page.evaluate(GEL);
  await page.evaluate(() => { const t = window.toast; window.__toasts = []; window.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; });
  return errors;
}
const chartPanels = page => page.evaluate(() => images.filter(p => p && p.type === 'chart').map(p => ({ label: _rtText(formatLabel(p.label)), link: !!p.chart.link,
  cols: p.chart.data.columns, rows: p.chart.data.rows, title: p.chart.axes.y.title, caption: p.chart.caption })));
const toasts = page => page.evaluate(() => { const t = window.__toasts.slice(); window.__toasts.length = 0; return t; });

test('blot2-01: a lane without the target band is n.d. — not its nonspecific band — and the chart says which band it took', async ({ page }) => {
  const errors = await gelSetup(page);
  // KatG at y 50 in lanes 1–3 and 5 (none in lane 4); a faint nonspecific band at y 110 in every lane
  await page.evaluate(async () => {
    await __gelMake(__blot('KatG.png', [[[50, 60], [110, 20]], [[50, 120], [110, 20]], [[50, 90], [110, 20]], [[110, 22]], [[50, 30], [110, 20]]]));
    await __gelMake(__blot('stain.png', [[[80, 40]], [[80, 40]], [[80, 40]], [[80, 40]], [[80, 40]]], 7));
    runGelAnalysis(0); gelSetLoading(0, 1); gelSetRefLane(0, 0);
    openGelAnalysis(0);
  });
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  const [c] = await chartPanels(page);
  const v = c.rows.map(r => r[1]);
  expect(v[3]).toBe('');                                   // lane 4: n.d.
  [1, 2, 1.5, 0.5].forEach((t, i) => expect(Math.abs(v[[0, 1, 2, 4][i]] - t) / t).toBeLessThan(0.1));
  expect(c.caption).toMatch(/the band at Rf 0\.3\d \(the largest band in reference lane 1\)/);
  expect(c.caption).not.toMatch(/largest quantifiable band in each lane/);
  expect((await toasts(page)).join(' ')).toMatch(/band at Rf 0\.3\d/);
  // the band to chart can be picked in the dialog: the nonspecific one, in every lane
  await page.evaluate(() => openGelAnalysis(0));
  const opts = await page.locator('#gel-chart-band option').allTextContents();
  expect(opts[0]).toMatch(/auto — at Rf 0\.3/);
  await page.locator('#gel-chart-band').selectOption({ index: 2 });
  const [c2] = await chartPanels(page);
  expect(c2.rows.map(r => r[1]).every(x => x !== '' && Math.abs(x - 1) < 0.15)).toBe(true);   // the same band everywhere
  expect(errors).toEqual([]);
});

test('blot2-02: panels without the dialog panel\'s normalisation and loading controls are left out and named; Chart again updates the linked chart', async ({ page }) => {
  const errors = await gelSetup(page);
  await page.evaluate(async () => {
    const L = a => a.map(x => [[50, x]]);
    await __gelMake(__blot('KatG.png', L([40, 80, 120, 60]), 3));
    await __gelMake(__blot('AhpC.png', L([50, 50, 100, 75]), 5));
    await __gelMake(__blot('rerun.png', L([40, 90, 100, 60]), 9));
    await __gelMake(__blot('DnaK_loading.png', L([60, 60, 60, 60]), 13));
    await __gelMake(__blot('stain.png', [[[80, 40]], [[80, 40]], [[80, 40]], [[80, 40]]], 7));
    for (const i of [0, 1]) { runGelAnalysis(i); gelSetLoading(i, 4, 'total'); gelSetRefLane(i, 0); }
    runGelAnalysis(2);                                    // analysed, not normalised
    runGelAnalysis(3); gelSetLoading(3, 4, 'total'); gelSetRefLane(3, 0);   // a loading control, normalised too
    openGelAnalysis(0);
  });
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  let C = await chartPanels(page);
  expect(C.length).toBe(1);
  expect(C[0].cols).toEqual(['Lane', 'Panel A', 'Panel B']);
  expect(C[0].title).toBe('Band volume ÷ total protein, relative to lane 1');
  const t = (await toasts(page)).join(' ');
  expect(t).toMatch(/left out Panel C \(no loading control and no reference lane\)/);
  expect(t).toMatch(/Panel D not charted \(a loading control\)/);
  // normalise C, chart again from A: the same chart panel is updated, now with C
  await page.evaluate(() => { gelSetLoading(2, 4, 'total'); gelSetRefLane(2, 0); openGelAnalysis(0); });
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  C = await chartPanels(page);
  expect(C.length).toBe(1);
  expect(C[0].cols).toEqual(['Lane', 'Panel A', 'Panel B', 'Panel C']);
  expect((await toasts(page)).join(' ')).toMatch(/Updated the linked chart/);
  // a panel with no normalisation at all charts raw volumes and says so
  await page.evaluate(() => { gelSetLoading(1, null); gelSetRefLane(1, null); openGelAnalysis(1); });
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  expect((await toasts(page)).join(' ')).toMatch(/raw volumes: panel B has no reference lane or loading control/);
  expect(errors).toEqual([]);
});

test('blot2-03: the link survives a cleared letter and a session reload, ↻ Update keeps names, Apply keeps the link; a replaced scan makes it out of date and Update re-analyses it', async ({ page }) => {
  const errors = await gelSetup(page);
  await page.evaluate(async () => {
    const L = a => a.map(x => [[50, x]]);
    await __gelMake(__blot('KatG.png', L([40, 80, 120, 60]), 3));
    await __gelMake(__blot('AhpC.png', L([50, 50, 100, 75]), 5));
    await __gelMake(__blot('stain.png', [[[80, 40]], [[80, 40]], [[80, 40]], [[80, 40]]], 7));
    for (const i of [0, 1]) { runGelAnalysis(i); gelSetLoading(i, 2); gelSetRefLane(i, 0); }
    openGelAnalysis(0);
  });
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  // clear B's letter (a one-panel stack), name the series, save and reload the session
  const st = await page.evaluate(async () => {
    images[1].label = ''; render();
    const el = images.find(p => p.type === 'chart'); el.chart.names = { 'Panel A': 'KatG', 'Panel B': 'AhpC' }; el._chartKey = '';
    const before = _chartLinkState(el).stale;
    const s = JSON.parse(JSON.stringify(serializeSession(true)));
    await applySession(s, { noUndo: true, silent: true });
    await new Promise(r => setTimeout(r, 400)); render();
    const el2 = images.find(p => p.type === 'chart');
    return { before, after: _chartLinkState(el2).stale, link: !!el2.chart.link };
  });
  expect(st).toEqual({ before: false, after: false, link: true });
  // Replace the KatG scan with a re-run (stronger lane 3): the chart says it is out of date
  await page.evaluate(async () => {
    const src = __gelPng(__blot('KatG_rerun.png', [[[50, 40]], [[50, 80]], [[50, 160]], [[50, 60]]], 21));
    const blob = await (await fetch(src)).blob();
    await replacePanelImage(images[0].id, new File([blob], 'KatG_rerun.png', { type: 'image/png' }));
    render();
  });
  expect((await toasts(page)).join(' ')).toMatch(/chart linked to its densitometry is out of date/);
  const stale = await page.evaluate(() => { const el = images.find(p => p.type === 'chart'); return { st: _chartLinkState(el).stale, note: __recNotes(el) }; });
  expect(stale.st).toBe(true);
  expect(stale.note).toBe(true);
  // ↻ Update from densitometry in the chart's dialog re-analyses the replaced scan and updates; Apply keeps the link
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p.type === 'chart')));
  await page.click('#chart-link-note button:has-text("Update from densitometry")');
  await apply(page);
  const r = await page.evaluate(() => { const el = images.find(p => p.type === 'chart'); el._chartKey = '';
    const s = _chartStatsCached(el); return { link: !!el.chart.link, stale: _chartLinkState(el).stale, series: s.seriesNames.map(x => x.name), cols: el.chart.data.columns,
      katg: el.chart.data.rows.map(r => r[1]) }; });
  expect(r.link).toBe(true);
  expect(r.stale).toBe(false);
  expect(r.cols).toEqual(['Lane', 'Panel A', 'Panel B']);    // not renamed to a file name
  expect(r.series).toEqual(['KatG', 'AhpC']);
  expect(Math.abs(r.katg[2] - 4) / 4).toBeLessThan(0.12);       // 160/40, the re-run's value
  expect(errors).toEqual([]);
});

test('blot2-04: bands deleted by hand stay deleted when the panel is re-detected, and the dialog says so', async ({ page }) => {
  const errors = await gelSetup(page);
  await page.evaluate(async () => {
    await __gelMake(__blot('KatG.png', [[[50, 60], [110, 30]], [[50, 120], [110, 30]], [[110, 30]]]));
    runGelAnalysis(0);
  });
  const n0 = await page.evaluate(() => images[0].gelAnalysis.lanes.map(L => L.bands.length));
  expect(n0).toEqual([2, 2, 1]);
  await page.evaluate(() => { gelDeleteBand(0, 0, 1); gelDeleteBand(0, 1, 1); gelDeleteBand(0, 2, 0); });
  await page.evaluate(() => { images[0].cropT = 2; render(); runGelAnalysis(0); });
  const n1 = await page.evaluate(() => images[0].gelAnalysis.lanes.map(L => L.bands.length));
  expect(n1).toEqual([1, 1, 0]);
  expect((await toasts(page)).join(' ')).toMatch(/3 bands you had deleted were found again and deleted again/);
  expect(errors).toEqual([]);
});

test('blot2-05: deleting a band does not move the band table under the pointer (the ladder line keeps its height)', async ({ page }) => {
  const errors = await gelSetup(page);
  await page.evaluate(async () => {
    await __gelMake(__blot('blot.png', [[[30, 60], [60, 60], [100, 60]], [[50, 100], [110, 30]], [[50, 100], [110, 30]], [[50, 100], [110, 30]]]));
    runGelAnalysis(0); gelSetLadder(0, 0, '100,50,25'); openGelAnalysis(0);
  });
  // the table's place in the dialog's layout, whatever the dialog is scrolled to
  const top = () => page.evaluate(() => { let y = 0, e = document.getElementById('gel-table'); while (e) { y += e.offsetTop; e = e.offsetParent; } return y; });
  const y0 = await top();
  // delete a ladder band: the fit fails and the warning appears in the same line
  await page.locator('#gel-table tr').nth(1).locator('button:has-text("✕")').click();
  expect(await page.locator('#gel-fit').textContent()).toMatch(/No molecular weights/);
  expect(Math.abs((await top()) - y0)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

// ── Beeswarm, box and violin with a series column ─────────────────────────────────
test('charts2-04: a strain × time table switched to Beeswarm keeps one cloud per strain in each time, and log Y stays on through Stacked bar', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, GROWTH, 'growth.csv');
  await modal(page).locator('#chart-ylog').check();
  for (const k of ['groupedBar', 'stackedBar', 'beeswarm']) await modal(page).locator('#chart-kind').selectOption(k);
  expect(await modal(page).locator('#chart-ylog').isChecked()).toBe(true);
  expect(await modal(page).locator('#chart-series-wrap').isVisible()).toBe(true);
  await modal(page).locator('#chart-xcol').selectOption({ label: 'time_h' });
  await modal(page).locator('#chart-seriescol').selectOption({ label: 'strain' });
  await apply(page);
  const r = await page.evaluate(() => {
    const el = images.find(p => p && p.type === 'chart'); el._chartKey = '';
    const st = _chartStatsCached(el), T = [], C = [];
    _chartDraw(el, { rect() {}, line() {}, poly() {}, circle(x, y, r, f) { C.push({ x, f }); }, text(s, x, y, f, fi, al) { if (al === 'right') T.push(s); } });
    return { log: el.chart.axes.y.log, boxes: st.boxes.map(b => [b.cat, b.name, b.n, b.mean, b.err]), ticks: T, legend: (st.seriesNames || []).map(s => s.name),
      xs: [...new Set(C.map(c => c.f))].map(f => C.filter(c => c.f === f).map(c => c.x)) };
  });
  expect(r.log).toBe(true);
  expect(r.ticks.every(t => /^10\^\{\d+\}$/.test(t))).toBe(true);     // decades, no negative tick
  expect(r.boxes.map(b => b.slice(0, 3))).toEqual([['0', 'PAO1', 3], ['0', 'dpilA', 3], ['4', 'PAO1', 3], ['4', 'dpilA', 3]]);
  const pao4 = [67414000, 70123000, 61002000], dp4 = [9000000, 700000000, 11000000];
  expect(Math.abs(r.boxes[2][3] - mean(pao4)) / mean(pao4)).toBeLessThan(1e-9);
  expect(Math.abs(r.boxes[3][4] - sd(dp4)) / sd(dp4)).toBeLessThan(1e-9);
  expect(r.legend).toEqual(['PAO1', 'dpilA']);
  // the two strains' dots are drawn apart in each time, each in its own colour
  expect(r.xs.length).toBe(2);
  const m3 = a => a.slice().sort((x, y) => x - y).slice(0, 3).reduce((s, v) => s + v, 0) / 3;
  expect(Math.abs(m3(r.xs[0]) - m3(r.xs[1]))).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('charts2-17: a beeswarm\'s whisker follows Error bars — SD, SEM or none — and starts at SD', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'PAO1,dpilA\n17.4,7.0\n12.8,4.2\n12.6,6.4\n12.0,7.9\n', 'twitch_wide.csv');
  await modal(page).locator('#chart-kind').selectOption('beeswarm');
  expect(await modal(page).locator('#chart-err').inputValue()).toBe('sd');
  const whisk = () => page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = '';
    const L = []; _chartDraw(el, { rect() {}, line(x1, y1, x2, y2, s, w) { if (x1 === x2 && w === 1.2) L.push(Math.abs(y2 - y1)); }, poly() {}, circle() {}, text() {} }); return L; });
  await apply(page);
  const sdW = await whisk();
  expect(sdW.length).toBe(2);
  await edit(page, 'A'); await modal(page).locator('#chart-err').selectOption('sem'); await apply(page);
  const semW = await whisk();
  semW.forEach((w, i) => expect(w / sdW[i]).toBeCloseTo(1 / 2, 2));          // n = 4: SEM = SD/2
  await edit(page, 'A'); await modal(page).locator('#chart-err').selectOption('none'); await apply(page);
  expect(await whisk()).toEqual([]);
  expect(errors).toEqual([]);
});

// ── What a dropped table is guessed as ───────────────────────────────────────────
test('charts2-07: a German tidy file (Stamm;Replikat;Biofilm, units row, decimal commas) is guessed as a bar per strain with SD, not lines across replicates', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'Stamm;Replikat;Biofilm\n;;A550\nPAO1;1;1,109\nPAO1;2;1,394\nPAO1;3;1,306\ndpilA;1;0,412\ndpilA;2;0,388\ndpilA;3;0,455\n', 'biofilm_EU.csv');
  const d = await page.evaluate(() => ({ kind: gv('chart-kind'), x: document.getElementById('chart-xcol').selectedOptions[0].text, s: gv('chart-seriescol'), err: gv('chart-err'), pts: gc('chart-points'), y: gv('chart-ytitle') }));
  expect(d).toEqual({ kind: 'bar', x: 'Stamm', s: '', err: 'sd', pts: true, y: 'Biofilm (A550)' });
  // a replicate column with any header (1, 2, 3 in every group) counts replicates too
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  await drop(page, 'strain,Nr,value\nWT,1,5\nWT,2,6\nWT,3,7\nKO,1,2\nKO,2,3\nKO,3,2\n', 'nr.csv');
  expect(await page.evaluate(() => gv('chart-kind'))).toBe('bar');
  expect(errors).toEqual([]);
});

test('ISSUES "wide table guessed as scatter": two columns of groups are guessed as Bar, Data layout › Columns, both ticked; x against y stays a scatter', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'Untreated,Phage-treated\n36.1,26.0\n38.5,27.9\n41.2,24.8\n35.9,28.1\n38.1,26.8\n', 'swim_wide.csv');
  const d = await page.evaluate(() => ({ kind: gv('chart-kind'), layout: gv('chart-layout'), y: [...document.querySelectorAll('#chart-ycols input:checked')].map(i => i.parentElement.textContent.trim()), err: gv('chart-err') }));
  expect(d).toEqual({ kind: 'bar', layout: 'columns', y: ['Untreated', 'Phage-treated'], err: 'sd' });
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  await drop(page, 'OD600,CFU\n0.1,1e7\n0.4,5e7\n0.2,2e7\n', 'od.csv');
  expect(await page.evaluate(() => gv('chart-kind'))).toBe('scatter');
  // switching a table to Columns ticks every numeric column, the former X too
  await modal(page).locator('#chart-kind').selectOption('bar');
  await modal(page).locator('#chart-layout').selectOption('columns');
  expect(await page.evaluate(() => [...document.querySelectorAll('#chart-ycols input:checked')].map(i => i.parentElement.textContent.trim()))).toEqual(['OD600', 'CFU']);
  expect(errors).toEqual([]);
});

// ── Reading files back, Cancel, names, small drawing fixes ──────────────────────────
// The submission package's files, by name.
const packageFiles = page => page.evaluate(async () => {
  const cap = await _captureDownload(() => exportSubmissionPackage());
  const b = cap.data, dv = new DataView(b.buffer, b.byteOffset); let p = 0; const out = {};
  while (p + 30 <= b.length && dv.getUint32(p, true) === 0x04034b50) {
    const cs = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true), d0 = p + 30 + nl + el;
    let d = b.subarray(d0, d0 + cs);
    if (dv.getUint16(p + 8, true) === 8) d = new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    out[new TextDecoder().decode(b.subarray(p + 30, p + 30 + nl))] = new TextDecoder().decode(d);
    p = d0 + cs;
  }
  return out;
});

test('charts2-03/06: the package\'s source-data CSV reads back as its table, and its plotted values carry the data names and the shown name', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv');
  await modal(page).locator('#chart-names [data-key="dpilA"] input[type=text]').fill('Δ*pilA*');
  await apply(page);
  const files = await packageFiles(page);
  const name = Object.keys(files).find(n => /^source-data\/.*\.csv$/.test(n));
  const csv = files[name];
  const plotted = csv.split('\n').filter(l => l.startsWith('cfu_per_ml,'));
  expect(csv).toMatch(/\nseries,category,n,mean,error,error_type,series_shown_as,category_shown_as\n/);
  const dp = plotted.find(l => l.split(',')[1] === 'dpilA');
  expect(dp).toBeTruthy();                                  // the data name, as in the raw table
  expect(dp.endsWith(',ΔpilA')).toBe(true);                 // and the shown name, marks converted
  expect(csv).not.toContain('Δ*pilA*');
  // dropped back in: the raw table, three groups, no comment line as a header or group
  await drop(page, csv, 'A.csv');
  const d = await page.evaluate(() => ({ cols: _chartDraft.data.columns, n: _chartDraft.data.rows.length, x: document.getElementById('chart-xcol').selectedOptions[0].text,
    status: document.getElementById('chart-delim-info').textContent }));
  expect(d.cols).toEqual(['strain', 'replicate', 'cfu_per_ml']);
  expect(d.n).toBe(9);
  expect(d.x).toBe('strain');
  const cats = await page.evaluate(() => _chartStats({ chart: _chartDraft, w: 300, h: 200 }).categories);
  expect(cats).toEqual(['PAO1', 'Δ*pilA*', 'dfliC']);        // the figure's name for dpilA follows it in
  expect(errors).toEqual([]);
});

test('charts2-12: Cancel on a just-dropped CSV takes the import back — panel, grid size and key', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv'); await apply(page);
  const before = await page.evaluate(() => ({ n: images.length, rows: gv('grid-rows'), cols: gv('grid-cols'), key: _figureKey().map(k => k.name).join('|'), pins: gv('sample-pins') }));
  await drop(page, 'strain,v\nJunk1,1\nJunk2,2\n', 'junk.csv');
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  const after = await page.evaluate(() => ({ n: images.length, rows: gv('grid-rows'), cols: gv('grid-cols'), key: _figureKey().map(k => k.name).join('|'), pins: gv('sample-pins') }));
  expect(after).toEqual(before);
  // a chart added from the menu and cancelled leaves the grid as it was too
  await page.evaluate(() => addChartElement('bar'));
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => ({ n: images.length, rows: gv('grid-rows'), cols: gv('grid-cols'), key: _figureKey().map(k => k.name).join('|'), pins: gv('sample-pins') }))).toEqual(before);
  // Cancel on a chart opened again for editing keeps it
  await edit(page, 'A'); await modal(page).getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => images.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('charts2-05: every *…* pair in a name is italic — Δ*pilA* + p*pilA* — in the chart, the SVG and the key text', async ({ page }) => {
  const errors = await loadApp(page);
  const runs = await page.evaluate(() => _rtRuns('Δ*pilA* + p*pilA*').map(r => (r.i ? '/' + r.t + '/' : r.t)).join(''));
  expect(runs).toBe('Δ/pilA/ + p/pilA/');
  // footnote stars after a word still stay stars
  expect(await page.evaluate(() => ['WT*KO*', 'rec*A*', 'x*y* = 5', '*', 'p < 0.05*'].map(s => _rtHas(s)))).toEqual([false, false, false, false, false]);
  await drop(page, CFU, 'cfu.csv');
  await modal(page).locator('#chart-names [data-key="dpilA"] input[type=text]').fill('Δ*pilA* + p*pilA*');
  await apply(page);
  const svg = await page.evaluate(async () => { const cap = await _captureDownload(() => exportSVG('t', 96, document.getElementById('fig-canvas'))); return new TextDecoder().decode(cap.data); });
  expect(svg).not.toContain('p*pilA*');
  expect((svg.match(/font-style="italic">pilA</g) || []).length).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => _keyText())).toContain('ΔpilA + ppilA');
  expect(errors).toEqual([]);
});

test('charts2-15: the error-bar caps at the first and last time of a line chart are drawn whole', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, GROWTH, 'growth.csv'); await apply(page);
  const r = await page.evaluate(() => {
    const el = images.find(p => p && p.type === 'chart'); el._chartKey = '';
    let clip = null; const caps = [];
    _chartDraw(el, { rect() {}, poly() {}, circle() {}, text() {}, clipStart(x, y, w, h) { clip = { x, w }; }, clipEnd() {},
      line(x1, y1, x2, y2) { if (y1 === y2 && Math.abs(x2 - x1 - 8) < 1e-6) caps.push([x1, x2, clip]); } });
    return caps.map(([a, b, c]) => a >= c.x - 1e-6 && b <= c.x + c.w + 1e-6);
  });
  expect(r.length).toBeGreaterThan(0);
  expect(r.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

test('charts2-16: a log-axis minimum typed as 1e6 reads 1e6 in the field when the dialog opens again', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv');
  await modal(page).locator('#chart-ylog').check();
  await modal(page).locator('#chart-ymin').fill('1e6');
  await apply(page);
  await edit(page, 'A');
  expect(await modal(page).locator('#chart-ymin').inputValue()).toBe('1e6');
  const w = await modal(page).locator('#chart-ymin').evaluate(i => i.scrollWidth <= i.clientWidth + 1);
  expect(w).toBe(true);
  expect(errors).toEqual([]);
});

test('charts2-10: a long bracket label sits above its line, not on it, and inside the plot; the field shows its length', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU, 'cfu.csv');
  await modal(page).getByRole('button', { name: '+ Add' }).first().click();
  const box = modal(page).locator('#chart-sig-list input[type=text]').first();
  await box.fill("p = 0.0004 (Welch's t-test)");
  expect(await modal(page).locator('#chart-sig-list').innerText()).toContain('27/40');
  await apply(page);
  const r = await page.evaluate(() => {
    const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; el.w = 220;
    const L = [], H = []; let yAxisX = Infinity;
    _chartDraw(el, { rect() {}, poly() {}, circle() {}, line(x1, y1, x2, y2) { if (y1 === y2) H.push({ x1, x2, y: y1 }); },
      text(s, x, y, f, fi, al) { if (/Welch|0\.0004/.test(s)) L.push({ s, x, y, f }); if (al === 'right') yAxisX = Math.min(yAxisX, x); } });
    const fs = parseFloat(/([\d.]+)px/.exec(L[0].f)[1]), low = L.reduce((a, b) => (b.y > a.y ? b : a));
    const bar = H.filter(h => h.y > low.y - 1).sort((a, b) => a.y - b.y)[0];
    return { gap: bar.y - low.y, fs, lines: L.map(l => l.s), left: Math.min(...L.map(l => l.x - _rtText(l.s).length * fs * 0.55 / 2)), yAxisX };
  });
  expect(r.gap).toBeGreaterThanOrEqual(r.fs * 0.22);          // the descenders clear the line
  expect(r.left).toBeGreaterThan(r.yAxisX);                     // not over the y tick labels
  expect(errors).toEqual([]);
});

test('ISSUES "one sample under several names": MOI_0, MOI 0 and "MOI 0 mean" take one palette colour and are one row in Look › Sample colours', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'time_min,MOI_0_r1,MOI_0_r2,MOI_1_r1,MOI_1_r2\n0,0.1,0.11,0.1,0.12\n60,0.4,0.44,0.25,0.3\n', 'reps.csv'); await apply(page);
  await drop(page, 'time_min,MOI,replicate,OD600\n0,1,1,0.1\n0,1,2,0.12\n0,0,1,0.1\n0,0,2,0.11\n60,1,1,0.25\n60,1,2,0.3\n60,0,1,0.4\n60,0,2,0.44\n', 'tidy.csv'); await apply(page);
  await drop(page, 'time_min,MOI 0 mean,MOI 0 SD\n0,0.105,0.007\n60,0.42,0.03\n', 'ms.csv'); await apply(page);
  const c = await page.evaluate(() => _allCharts().map(el => { el._chartKey = ''; const st = _chartStatsCached(el); return Object.fromEntries((st.series || st.seriesNames || []).map(s => [s.key, s.color]).concat([['kind', el.chart.kind]])); }));
  expect(c[1]['MOI 0']).toBe(c[0].MOI_0);
  expect(c[1]['MOI 1']).toBe(c[0].MOI_1);
  expect(c[2]['MOI 0 mean']).toBe(c[0].MOI_0);
  await openLook(page);
  const rows = await page.locator('#sample-colours-list [data-name]').evaluateAll(r => r.map(e => JSON.parse(e.dataset.keys)));
  expect(rows.find(k => k.includes('MOI_0')).sort()).toEqual(['MOI 0', 'MOI 0 mean', 'MOI_0']);
  expect(errors).toEqual([]);
});
