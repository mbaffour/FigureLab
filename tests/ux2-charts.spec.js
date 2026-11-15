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
