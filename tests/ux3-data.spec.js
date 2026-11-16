// @ts-check
// Usability round 3 — getting data into charts correctly, and how charts draw. Each test
// follows a tester's finding (blot3-NN, charts3-NN, phage3-NN, …) through the app's own
// controls — the lanes & bands dialog, the Chart dialog's boxes, dropped files — and
// checks what the chart draws, what the caption, compliance and the package say.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

// ── Synthetic blots (as ux2-charts.spec.js): Gaussian bands on a light ground ──
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
  window.__blot = (name, lanes, seed) => ({ w: 60 + 70 * lanes.length, h: 160, bg: 228, name, seed,
    lanes: lanes.map((bands, k) => ({ x0: 30 + 70 * k, x1: 75 + 70 * k, bands: bands.map(([y, amp]) => ({ y, s: 3, amp })) })) });
  window.__replace = async (idx, amps, seed) => {
    const src = __gelPng(__blot('HA_reprobe.png', amps.map(x => [[50, x]]), seed));
    const blob = await (await fetch(src)).blob();
    await replacePanelImage(images[idx].id, new File([blob], 'HA_reprobe.png', { type: 'image/png' }));
    render();
  };
  // What a chart draws as text (its notes among them).
  window.__texts = el => { const T = []; el._chartKey = ''; _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s) { T.push(String(s)); } }); return T; };
};
// Parkin-HA: lane 1 is the reference (WT), lanes 1–3 WT, 4–6 R42P, 7–9 C431S; the loading control is flat.
const HA = [40, 44, 38, 80, 84, 76, 120, 110, 125];
async function gelSetup(page) {
  const errors = await loadApp(page);
  await page.evaluate(GEL);
  await page.evaluate(() => { const t = window.toast; window.__toasts = []; window.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; });
  await page.evaluate(async HA => {
    await __gelMake(__blot('HA.png', HA.map(x => [[50, x]]), 3));
    await __gelMake(__blot('tubulin.png', HA.map(() => [[50, 60]]), 7));
    runGelAnalysis(0); gelSetLoading(0, 1); gelSetRefLane(0, 0);
  }, HA);
  return errors;
}
const toasts = page => page.evaluate(() => { const t = window.__toasts.slice(); window.__toasts.length = 0; return t; });
const modal = page => page.locator('#chart-modal');
const apply = page => modal(page).getByRole('button', { name: 'Apply' }).click();
const chartIdx = page => page.evaluate(() => images.findIndex(p => p && p.type === 'chart'));
const openChart = async page => page.evaluate(i => openDataPanelEditor(i), await chartIdx(page));
async function chartFromBlot(page) {
  await page.evaluate(() => openGelAnalysis(0));
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
}
const ZIPREAD = `window._zipRead = async (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset); const out = {}; let p = 0;
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const csize = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen)), off = p + 30 + nlen + elen, raw = bytes.subarray(off, off + csize);
    out[name] = (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw);
    p = off + csize;
  }
  return out; };`;
const GROUPS = ['WT', 'WT', 'WT', 'R42P', 'R42P', 'R42P', 'C431S', 'C431S', 'C431S'];
// What the chart plots, the key lists, the caption and the source state say.
const chartNow = page => page.evaluate(() => {
  const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; el._chartStat = null;
  const st = _chartStatsCached(el);
  return { link: !!el.chart.link, state: _chartSourceState(el).state, error: el.chart.error, points: !!el.chart.style.showPoints,
    cats: st.categories.map(c => _rtText(c)), bars: st.groups.map(g => ({ v: g.bars[0].value, e: g.bars[0].err, n: g.bars[0].n, vals: g.bars[0].vals })),
    colours: st.groups.map(g => g.bars[0].color), rows: el.chart.data.rows,
    key: _figureKey().filter(r => r.kind === 'series').map(r => _rtText(r.name)),
    starter: _keyText(_figureKey()),
    caption: _dataCaption(el), notes: __texts(el).filter(t => /⚠/.test(t)) };
});

// ── blot3-01 / blot3-06 / blot3-12: replicate lanes as one sample, and an honest link ──
test('blot3-06: lanes given one shown-as name are one sample — mean ± SD with n and the points — and the chart stays linked', async ({ page }) => {
  const errors = await gelSetup(page);
  await chartFromBlot(page);
  await openChart(page);
  for (let k = 0; k < 9; k++) await modal(page).locator(`#chart-names [data-key="Lane ${k + 1}"] input[type=text]`).fill(GROUPS[k]);
  // the dialog says what the names do, and switches the error bars to SD with the points
  await expect(modal(page).locator('#chart-merge-note')).toContainText('WT: Lane 1, Lane 2, Lane 3 (n = 3)');
  await expect(modal(page).locator('#chart-merge-note')).toContainText('stays linked');
  await expect(modal(page).locator('#chart-err')).toHaveValue('sd');
  await expect(modal(page).locator('#chart-points')).toBeChecked();
  await expect(modal(page).locator('#chart-link-note')).toContainText('Linked to the densitometry of panel A');
  // every lane keeps a row of its own, so a name can be changed back
  await expect(modal(page).locator('#chart-names [data-key="Lane 2"] input[type=text]')).toHaveValue('WT');
  await apply(page);
  const c = await chartNow(page);
  expect(c.link).toBe(true);
  expect(c.state).toBe('linked');
  expect(c.cats).toEqual(['WT', 'R42P', 'C431S']);
  expect(c.bars.map(b => b.n)).toEqual([3, 3, 3]);
  // the means and SDs of the charted lane values, as the source data list them
  const lanes = c.rows.map(r => r[1]);
  [0, 3, 6].forEach((s, g) => {
    expect(c.bars[g].v).toBeCloseTo(mean(lanes.slice(s, s + 3)), 9);
    expect(c.bars[g].e).toBeCloseTo(sd(lanes.slice(s, s + 3)), 9);
  });
  expect(c.error).toBe('sd');
  expect(c.points).toBe(true);
  expect(new Set(c.colours).size).toBe(3);                       // one colour per sample, not per lane
  expect(c.key).toEqual(['WT', 'R42P', 'C431S']);                // the legend key and its text follow the names
  expect(c.starter).toMatch(/^WT \([^)]*\); R42P \([^)]*\); C431S \([^)]*\)\.?$/);
  expect(c.caption).toMatch(/Mean ± SD, n = 3 per point/);
  expect(c.caption).toMatch(/for WT, R42P and C431S/);
  // the names are this chart's own: "Lane 2" is no sample name for the whole figure
  expect(await page.evaluate(() => _sampleNames())).toEqual({});
  // the plotted table names the lanes each mean pools
  const P = await page.evaluate(() => _chartPlotted(images.find(p => p && p.type === 'chart')).rows.map(r => [r.xkey, r.x, r.n]));
  expect(P[0]).toEqual(['Lane 1 + Lane 2 + Lane 3', 'WT', 3]);
  // still linked: a re-probe re-analysed updates the pooled bars
  await page.evaluate(async () => { await __replace(0, [40, 60, 38, 80, 84, 76, 120, 110, 125], 21); runGelAnalysis(0); });
  const c2 = await chartNow(page);
  expect(c2.link).toBe(true);
  expect(c2.state).toBe('linked');
  expect(c2.bars[0].v).toBeGreaterThan(c.bars[0].v * 1.1);       // lane 2 grew from 44 to 60
  expect(c2.cats).toEqual(['WT', 'R42P', 'C431S']);
  expect(errors).toEqual([]);
});

test('blot3-06: a lane table naming the lanes WT WT WT R42P … charts them as three samples at once, linked (ISSUES: bars named Lane 2 … not by the lane table)', async ({ page }) => {
  const errors = await gelSetup(page);
  await page.evaluate(G => { laneTableSetCell(0, 0, 0, G[0]); for (let k = 0; k < 9; k++) laneTableSetCell(0, 0, k, G[k]); }, GROUPS);
  await chartFromBlot(page);
  const c = await chartNow(page);
  expect(c.link).toBe(true);
  expect(c.cats).toEqual(['WT', 'R42P', 'C431S']);
  expect(c.bars.map(b => b.n)).toEqual([3, 3, 3]);
  expect(c.error).toBe('sd');
  expect(c.points).toBe(true);
  const t = (await toasts(page)).join(' ');
  expect(t).toMatch(/lanes named from the lane table — WT: Lane 1, Lane 2, Lane 3/);
  expect(t).not.toMatch(/n\.d\.\./);                               // ISSUES: the toast ended in a double full stop
  expect(errors).toEqual([]);
});

test('blot3-01: editing a linked chart\'s data says it unlinks; once unlinked and the blot replaced, the figure, caption, compliance and package all say so', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await gelSetup(page);
  await chartFromBlot(page);
  await openChart(page);
  // the tester's route: retype the lane column of the data box
  const ta = modal(page).locator('#chart-data-ta');
  const lines = (await ta.inputValue()).split('\n');
  await ta.fill([lines[0], ...lines.slice(1).map((l, i) => l.replace(/^Lane \d+/, GROUPS[i]))].join('\n'));
  await page.waitForTimeout(400);
  const note = modal(page).locator('#chart-link-note');
  await expect(note).toContainText('You edited the data: Apply unlinks this chart');
  await expect(note).not.toContainText('has changed since');      // the old note blamed the analysis
  await apply(page);
  expect((await toasts(page)).join(' ')).toMatch(/no longer linked to the densitometry of panel A/);
  let c = await chartNow(page);
  expect(c.link).toBe(false);
  expect(c.state).toBe('unlinked');
  expect(c.caption).toMatch(/Values entered by hand from the densitometry of panel A\./);
  expect(c.caption).not.toMatch(/Data from densitometry/);
  expect(c.notes).toEqual([]);                                     // nothing in the export yet: the blot has not changed
  // the ⚙ row and the dialog say it is typed by hand
  await page.evaluate(() => { selectedPanel = images.findIndex(p => p && p.type === 'chart'); updateElemPropsBar(); });
  await openChart(page);
  await expect(note).toContainText('Not linked: typed by hand');
  await expect(note.getByRole('button', { name: /Link again/ })).toBeVisible();
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  // the re-probe replaces panel A and is re-analysed
  await page.evaluate(async () => { await __replace(0, [40, 60, 38, 80, 84, 76, 120, 110, 125], 21); runGelAnalysis(0); render(); });
  expect((await toasts(page)).join(' ')).toMatch(/a chart typed by hand from its densitometry no longer matches it/);
  c = await chartNow(page);
  expect(c.state).toBe('unlinkedChanged');
  expect(c.notes).toEqual(['⚠ typed values — the densitometry of panel A has changed since']);
  expect(c.caption).toMatch(/\[⚠ Not current: the densitometry of panel A has changed since/);
  expect(c.caption).not.toMatch(/Data from densitometry|Densitometry of panel A \(FigureLab/);
  // compliance: a failing row of its own, under a journal too
  const row = await page.evaluate(() => _chartDataComplianceRow());
  expect(row.label).toBe('Charts from densitometry');
  expect(row.ok).toBe(false);
  expect(row.warn).toBe(false);
  expect(row.note).toMatch(/C: typed by hand .* which has changed since/);
  expect(await page.evaluate(() => _GENERAL_ROWS.includes('Charts from densitometry'))).toBe(true);
  // the package: the chart's source data say it is typed by hand and no longer current
  await page.evaluate(ZIPREAD);
  const csv = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportSubmissionPackage());
    const files = await _zipRead(cap.data);
    return new TextDecoder().decode(files['source-data/C.csv'] || new Uint8Array());
  });
  expect(csv).toMatch(/^# WARNING: Values entered by hand; typed by hand and no longer linked to the densitometry of panel A, which has changed since/m);
  // ↻ Link again reads the re-probe's values; the chart is linked and current
  await openChart(page);
  await note.getByRole('button', { name: /Link again/ }).click();
  await apply(page);
  c = await chartNow(page);
  expect(c.link).toBe(true);
  expect(c.state).toBe('linked');
  expect(c.rows[1][1]).toBeCloseTo(60 / 40, 1);
  expect(errors).toEqual([]);
});

test('blot3-01: a chart unlinked by an older build (no record kept) is still caught once its blot no longer matches; "These are my own values" ends the claim', async ({ page }) => {
  const errors = await gelSetup(page);
  await chartFromBlot(page);
  // as the tester's saved session has it: no link, pasted data still named "densitometry, panel A"
  await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el.chart.link = null; el.chart.data.source = 'paste';
    el.chart.data.rows = el.chart.data.rows.map((r, i) => [['WT', 'WT', 'WT', 'R42P', 'R42P', 'R42P', 'C431S', 'C431S', 'C431S'][i], r[1]]); el._chartKey = ''; });
  let c = await chartNow(page);
  expect(c.state).toBe('unlinked');
  expect(c.caption).not.toMatch(/Data from densitometry/);
  await page.evaluate(async () => { await __replace(0, [40, 60, 38, 80, 84, 76, 120, 110, 125], 21); runGelAnalysis(0); render(); });
  c = await chartNow(page);
  expect(c.state).toBe('unlinkedChanged');
  expect(c.notes.join(' ')).toMatch(/typed values — the densitometry of panel A has changed since/);
  // the author's own values: nothing claims panel A any more, nothing is flagged
  await openChart(page);
  await modal(page).locator('#chart-link-note').getByRole('button', { name: 'These are my own values' }).click();
  await apply(page);
  c = await chartNow(page);
  expect(c.state).toBe('own');
  expect(c.notes).toEqual([]);
  expect(c.caption).not.toMatch(/densitometry/i);
  expect(await page.evaluate(() => _chartDataComplianceRow())).toBeNull();
  expect(errors).toEqual([]);
});

// ── Files into charts ──
const MIC = `antibiotic,strain,replicate,MIC_ug_per_ml
tobramycin,PA14,1,0.5
tobramycin,PA14,2,1
tobramycin,PA14,3,1
ciprofloxacin,PA14,1,0.125
ciprofloxacin,PA14,2,0.125
ciprofloxacin,PA14,3,0.125
tobramycin,dlasR,1,0.5
tobramycin,dlasR,2,1
tobramycin,dlasR,3,0.5
ciprofloxacin,dlasR,1,0.25
ciprofloxacin,dlasR,2,0.125
ciprofloxacin,dlasR,3,0.25
tobramycin,dmexB,1,0.125
tobramycin,dmexB,2,0.25
tobramycin,dmexB,3,0.25
ciprofloxacin,dmexB,1,0.125
ciprofloxacin,dmexB,2,0.125
ciprofloxacin,dmexB,3,0.125`;
async function drop(page, csv, name) {
  const n0 = await page.evaluate(() => images.filter(p => p && p.type === 'chart').length);
  await page.evaluate(([csv, name]) => addFiles([new File([csv], name, { type: 'text/csv' })]), [csv, name]);
  await page.waitForFunction(n0 => images.filter(p => p && p.type === 'chart').length > n0 && document.getElementById('chart-modal').classList.contains('open'), n0);
}

test('charts3-01: a tidy MIC table with antibiotic and strain columns is a grouped bar by antibiotic with strain as series — not every strain pooled', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, MIC, 'mic_table.csv');
  await expect(modal(page).locator('#chart-kind')).toHaveValue('groupedBar');
  await expect(modal(page).locator('#chart-seriescol option:checked')).toHaveText('strain');
  await expect(modal(page).locator('#chart-delim-info')).not.toContainText('not used');
  await apply(page);
  const st = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const s = _chartStatsCached(el);
    return { cats: s.categories, series: s.seriesNames.map(x => x.name), tob: s.groups[0].bars.map(b => [b.value, b.n]), y: el.chart.axes.y.title }; });
  expect(st.cats).toEqual(['tobramycin', 'ciprofloxacin']);
  expect(st.series).toEqual(['PA14', 'dlasR', 'dmexB']);
  // PA14 0.83, ΔlasR 0.67, ΔmexB 0.21 — not one pooled 0.57 ± 0.38
  [[0.5, 1, 1], [0.5, 1, 0.5], [0.125, 0.25, 0.25]].forEach((v, i) => { expect(st.tob[i][0]).toBeCloseTo(mean(v), 9); expect(st.tob[i][1]).toBe(3); });
  expect(st.y).toBe('MIC_ug_per_ml');                              // newcomer3-11: the value axis is titled
  // switching Series back to none says what that pools
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'chart')));
  await modal(page).locator('#chart-seriescol').selectOption({ label: '— none —' });
  await expect(modal(page).locator('#chart-delim-info')).toContainText('⚠ strain not used: 3 strain values (PA14, dlasR, dmexB) averaged together per group');
  expect(errors).toEqual([]);
});

test('charts3-01: a chart added with images whose guess pools a text column opens its dialog and the toast says what was left out', async ({ page }) => {
  const errors = await loadApp(page);
  // a table the guess cannot fully place: two text columns besides the x, both varying
  const T = 'antibiotic,strain,medium,MIC\n' + ['LB', 'M9'].flatMap(md => ['PA14', 'dlasR'].flatMap(s => ['tob', 'cip'].map((a, k) => `${a},${s},${md},${k + 1 + (md === 'M9' ? 2 : 0)}`))).join('\n');
  await page.evaluate(async ([T, MIC]) => {
    window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); };
    const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40);
    const png = await new Promise(r => c.toBlob(b => r(new File([b], 'plate.png', { type: 'image/png' }))));
    await addFiles([png, new File([MIC], 'mic_table.csv', { type: 'text/csv' }), new File([T], 'mic_media.csv', { type: 'text/csv' })]);
  }, [T, MIC]);
  await expect(modal(page)).toBeVisible();
  const t = (await page.evaluate(() => window.__toasts.join(' | ')));
  expect(t).toMatch(/B: grouped bar chart of MIC_ug_per_ml by antibiotic and strain/);
  expect(t).toMatch(/Check this chart: C — medium not used \(2 values averaged together\)/);
  await expect(modal(page).locator('#chart-delim-info')).toContainText('⚠ medium not used');
  expect(errors).toEqual([]);
});

// Kz7 lysis on a BioTek reader (the phage tester's Gen5 export, its first 2 h 45 min): Time as h:mm:ss, a
// temperature column, wells A1–D3 with A1–A3 blank, B = BW25113, C = + Kz7, D = ΔfhuA + Kz7.
const GEN5 = `Time,T° 600,A1,A2,A3,B1,B2,B3,C1,C2,C3,D1,D2,D3
0:00:00,37.0,0.082,0.088,0.087,0.128,0.132,0.127,0.126,0.132,0.126,0.127,0.135,0.125
0:15:00,37.0,0.084,0.087,0.089,0.142,0.148,0.147,0.143,0.142,0.134,0.147,0.141,0.137
0:30:00,37.0,0.089,0.093,0.091,0.164,0.161,0.165,0.155,0.165,0.161,0.168,0.161,0.168
0:45:00,37.0,0.090,0.084,0.090,0.179,0.170,0.196,0.181,0.180,0.193,0.188,0.183,0.183
1:00:00,37.0,0.084,0.088,0.081,0.210,0.204,0.216,0.212,0.203,0.208,0.218,0.202,0.194
1:15:00,37.0,0.090,0.089,0.089,0.249,0.241,0.249,0.228,0.234,0.239,0.264,0.238,0.236
1:30:00,37.0,0.095,0.092,0.092,0.287,0.312,0.303,0.230,0.224,0.226,0.301,0.307,0.301
1:45:00,37.0,0.087,0.088,0.087,0.352,0.346,0.351,0.185,0.185,0.179,0.348,0.356,0.357
2:00:00,37.0,0.088,0.089,0.086,0.423,0.421,0.425,0.139,0.139,0.141,0.409,0.413,0.405
2:15:00,37.0,0.087,0.088,0.085,0.516,0.504,0.507,0.125,0.133,0.120,0.439,0.451,0.431
2:30:00,37.0,0.097,0.086,0.085,0.595,0.584,0.602,0.122,0.123,0.118,0.362,0.347,0.352
2:45:00,37.0,0.088,0.085,0.080,0.691,0.701,0.677,0.121,0.120,0.117,0.214,0.230,0.216`;
test('phage3-02: a plate-reader export reads Time h:mm:ss as time, leaves the temperature out, groups wells by row and subtracts the blank wells', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, GEN5, 'Kz7_platereader_Gen5.csv');
  const info = modal(page).locator('#chart-delim-info');
  await expect(modal(page).locator('#chart-kind')).toHaveValue('line');
  await expect(modal(page).locator('#chart-xcol option:checked')).toHaveText('Time');
  await expect(modal(page).locator('#chart-xtitle')).toHaveValue('Time (min)');
  await expect(info).toContainText('Time read as h:mm:ss time, in minutes');
  await expect(info).toContainText('T° 600 (temperature) not plotted — tick it under Y columns to plot it');
  await expect(modal(page).locator('#chart-ycols input[value="1"]')).not.toBeChecked();
  // the wells: replicates by plate row, Row A as the blank
  await expect(modal(page).locator('#chart-wells-wrap')).toBeVisible();
  await expect(modal(page).locator('#chart-wells-wrap')).toContainText('Plate wells (12: A1–D3)');
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  await expect(modal(page).locator('#chart-err')).toHaveValue('sd');
  for (const [k, v] of [['Row B', 'BW25113'], ['Row C', 'BW25113 + Kz7'], ['Row D', 'ΔfhuA + Kz7']]) await modal(page).locator(`#chart-names [data-key="${k}"] input[type=text]`).fill(v);
  await apply(page);
  const st = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const s = _chartStatsCached(el);
    return { series: s.series.map(x => x.name), pts: s.series.map(x => x.points.map(p => [p.x, p.y, p.err, p.n])), cap: _dataCaption(el) }; });
  expect(st.series).toEqual(['BW25113', 'BW25113 + Kz7', 'ΔfhuA + Kz7']);
  // the same numbers worked out here from the raw wells: mean(row − mean(A1–A3)) and its SD, at each time
  const L = GEN5.split('\n').slice(1).map(l => l.split(','));
  const min = s => { const [h, m, x] = s.split(':').map(Number); return h * 60 + m + x / 60; };
  L.forEach((r, i) => {
    const blank = mean([2, 3, 4].map(c => +r[c]));
    [[5, 6, 7], [8, 9, 10], [11, 12, 13]].forEach((cs, g) => {
      const v = cs.map(c => +r[c] - blank), p = st.pts[g][i];
      expect(p[0]).toBeCloseTo(min(r[0]), 6); expect(p[1]).toBeCloseTo(mean(v), 9); expect(p[2]).toBeCloseTo(sd(v), 9); expect(p[3]).toBe(3);
    });
  });
  expect(st.pts[0][0][1]).toBeCloseTo(0.0433, 4);                  // the tester's truth: 0.129 − 0.0857
  expect(st.cap).toMatch(/series: BW25113, BW25113 \+ Kz7 and ΔfhuA \+ Kz7/);
  expect(st.cap).toMatch(/blank-subtracted: the mean of A1, A2, A3 at each time point/);
  expect(errors).toEqual([]);
});

test('phage3-02: "1:10", "1:100" stay dilution labels; a line against a text column draws no empty plot without saying why', async ({ page }) => {
  const errors = await loadApp(page);
  const P = _ => page.evaluate(t => { const p = _parseDelimited(t); return { rows: p.rows.map(r => r[0]), d: p.durations }; }, _);
  expect((await P('dilution,pfu\n1:10,5\n1:100,3')).rows).toEqual(['1:10', '1:100']);
  expect((await P('time,od\n0:30,0.1\n1:15,0.2')).rows).toEqual([30, 75]);            // h:mm under a time header, in minutes
  await drop(page, 'timepoint,od\nday one,0.1\nday two,0.2\nday three,0.3', 'od.csv');
  await modal(page).locator('#chart-kind').selectOption('line');
  await expect(modal(page).locator('#chart-delim-info')).toContainText('⚠ nothing drawn: the x column “timepoint” holds no numbers (“day one”)');
  await apply(page);
  const notes = await page.evaluate(() => { const T = []; const el = images.find(p => p && p.type === 'chart'); el._chartKey = '';
    _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s) { T.push(String(s)); } }); return T.filter(t => /⚠/.test(t)); });
  expect(notes).toEqual(['⚠ nothing drawn: x column “timepoint” holds no numbers']);
  expect(errors).toEqual([]);
});

test('charts3-16 / fluor3-10: after a paste the "points" box shows what the preview draws, and Apply draws the same', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => addChartElement('bar'));
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator('#chart-points')).not.toBeChecked();
  await modal(page).locator('#chart-data-ta').fill('strain\tMIC\nPA14\t1\nPA14\t0.5\nPA14\t1\ndlasR\t0.5\ndlasR\t1\ndlasR\t0.5');
  await page.waitForTimeout(500);
  const draft = await page.evaluate(() => _chartDraft.style.showPoints);
  await expect(modal(page).locator('#chart-points')).toBeChecked({ checked: draft });
  expect(draft).toBe(true);
  await apply(page);
  expect(await page.evaluate(() => images.find(p => p && p.type === 'chart').chart.style.showPoints)).toBe(true);
  expect(errors).toEqual([]);
});

// ── How charts draw ──
// Every word a chart draws, with its box in the chart's units (measured as the canvas sets it).
const RECORD = `window.__words = (el) => { const W = []; el._chartKey = ''; const mc = _rtMc();
  _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, clipStart() {}, clipEnd() {}, text(s, x, y, f, c, al, bl, rot) {
    mc.font = f; const R = _rtDrawRuns(String(s)), w = R ? _rtLayout(mc, R, f).w : mc.measureText(String(s)).width, h = parseFloat(/([\\d.]+)px/.exec(f)[1]);
    const x0 = al === 'right' ? x - w : al === 'center' ? x - w / 2 : x, y0 = bl === 'middle' ? y - h * 0.6 : bl === 'top' ? y : y - h;
    W.push(rot ? { s: String(s), rot, l: x - h, r: x + h * 0.3, t: y - w / 2, b: y + w / 2, w } : { s: String(s), l: x0, r: x0 + w, t: y0, b: y0 + h * 1.2, w }); } });
  return W; };`;
// The letter's chip as the grid (top left) and freeform draw it, worked out here.
const LETTERBOX = `window.__lbox = (str, freeform) => { const fs = Math.max(7, gf('label-size')), mc = _rtMc();
  mc.font = (gc('label-bold') ? 'bold' : 'normal') + ' ' + fs + 'px ' + (gv('label-font') || 'system-ui,sans-serif'); const tw = mc.measureText(str).width;
  return freeform ? { x0: 2, y0: 3, x1: tw + 10, y1: fs + 9 } : { x0: 2, y0: 4, x1: tw + 10, y1: fs + 10 }; };`;
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const BIOFILM = `PA14,dlasR,dlasR_plasR,dmexB
1.301,0.557,1.226,1.397
1.392,0.686,1.402,1.449
1.683,0.661,1.308,1.4
1.207,0.607,1.345,1.488
1.555,0.506,1.433,1.421
1.456,0.608,1.419,1.571`;

test('charts3-03: two brackets sharing a group are stacked, their labels apart, at the dialog\'s size and in the figure', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, BIOFILM, 'biofilm_wide.csv');
  await apply(page);
  await page.evaluate(RECORD);
  for (const [w, h, ymax] of [[300, 300, null], [380, 230, null], [300, 300, 1.5], [220, 200, null]]) {
    const L = await page.evaluate(([w, h, ymax]) => { const el = images.find(p => p && p.type === 'chart');
      const e = { type: 'chart', w, h, chart: JSON.parse(JSON.stringify(el.chart)) };
      e.chart.annos = [{ kind: 'sig', a: 0, b: 1, text: 'p < 0.001' }, { kind: 'sig', a: 1, b: 2, text: 'p < 0.001' }]; e.chart.axes.y.max = ymax;
      return __words(e).filter(x => x.s === 'p < 0.001'); }, [w, h, ymax]);
    expect(L.length).toBe(2);
    expect(overlap(L[0], L[1]), `${w}×${h} ymax ${ymax}: ${JSON.stringify(L)}`).toBe(false);
    L.forEach(b => expect(b.t).toBeGreaterThanOrEqual(0));
  }
  expect(errors).toEqual([]);
});

test('charts3-15: a stacked bar with points and error bars set draws no "outside the axis range" note, and a short plot keeps its tick labels apart', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, BIOFILM, 'biofilm_wide.csv');
  await apply(page);
  await page.evaluate(RECORD);
  const r = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart');
    const mk = (mut, w, h) => { const e = { type: 'chart', w, h, chart: JSON.parse(JSON.stringify(el.chart)) }; mut(e.chart); return __words(e); };
    const stacked = mk(c => { c.kind = 'stackedBar'; c.error = 'sem'; c.style.showPoints = true; }, 300, 300);
    // the dialog's 380 × 230 preview, two brackets with a long label, rotated names
    const short = mk(c => { c.names = { dlasR_plasR: 'ΔlasR + plasR complemented' }; c.annos = [{ kind: 'sig', a: 0, b: 1, text: 'p < 0.001' }, { kind: 'sig', a: 1, b: 2, text: 'p < 0.001 (Welch two-sample t-test, two-sided)' }]; }, 380, 230);
    return { notes: stacked.filter(w => /outside|cut at/.test(w.s)).map(w => w.s), ticks: short.filter(w => /^\d(\.\d+)?$/.test(w.s)) };
  });
  expect(r.notes).toEqual([]);
  expect(r.ticks.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < r.ticks.length; i++) expect(overlap(r.ticks[i - 1], r.ticks[i]), JSON.stringify(r.ticks)).toBe(false);
  expect(errors).toEqual([]);
});

const CFU8 = 'strain,cfu\nWT,120000000\nWT,110000000\nWT,100000000\nKO,20000000\nKO,30000000\nKO,25000000';
test('charts3-07 / newcomer3-13 / phage3-10: the grid letter covers neither the top tick label nor the Y title, and a long Y title fits the plot', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU8, 'cfu_kill_tidy.csv');
  await apply(page);
  await page.evaluate(RECORD); await page.evaluate(LETTERBOX);
  for (const [title, size, lsz] of [['', 300, 14], ['swim diameter (mm)', 300, 14], ['OD_{600} (blank-subtracted)', 160, 14], ['Colony forming units per millilitre of culture (CFU/mL)', 200, 22]]) {
    const r = await page.evaluate(([title, size, lsz]) => { sv('label-size', lsz); const el = images.find(p => p && p.type === 'chart'); el.chart.axes.y.title = title;
      el.plotW = size; el.plotH = size; render(); const W = __words(el), LB = __lbox(_rtText(formatLabel(el.label)));
      return { LB, W: W.filter(w => w.rot || /×10|^\d/.test(w.s)), h: el.h }; }, [title, size, lsz]);
    expect(r.LB).not.toBeNull();
    const box = { l: r.LB.x0, r: r.LB.x1, t: r.LB.y0, b: r.LB.y1 };
    r.W.forEach(w => expect(overlap(box, w), `${title} @${size}: letter over “${w.s}” ${JSON.stringify(w)} ${JSON.stringify(box)}`).toBe(false));
    const yt = r.W.find(w => w.rot);
    if (title) { expect(yt.t).toBeGreaterThanOrEqual(0); expect(yt.b).toBeLessThanOrEqual(r.h); }
  }
  expect(errors).toEqual([]);
});

test('freeform3-05: a freeform chart\'s letter does not sit on its Y title', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => setLayoutMode('freeform'));
  await page.evaluate(() => { addChartElement('bar'); });
  await apply(page);
  await page.evaluate(RECORD); await page.evaluate(LETTERBOX);
  const r = await page.evaluate(() => { const el = freeformElements.find(e => e && e.type === 'chart'); el.letter = 'E'; el.w = 460; el.h = 170; el.chart.axes.y.title = 'EtBr fluorescence (a.u.)';
    render(); const LB = __lbox('E', true); return { LB, W: __words(el).filter(w => w.rot || /^\d/.test(w.s)) }; });
  expect(r.LB).not.toBeNull();
  const box = { l: r.LB.x0, r: r.LB.x1, t: r.LB.y0, b: r.LB.y1 };
  r.W.forEach(w => expect(overlap(box, w), `letter over “${w.s}”`).toBe(false));
  expect(errors).toEqual([]);
});

// ── Gene maps ──
test('phage3-04: a 12.4 kb map in one cell writes its ruler in kb with labels apart; blot3-09: a protein map is measured in aa', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => addGenemapElement('linear'));
  await page.locator('#gm-table').waitFor({ state: 'visible' });
  await page.locator('#gm-length').fill('12384');
  await page.locator('#genemap-modal button', { hasText: /^Apply$/ }).click().catch(async () => { await page.evaluate(() => applyGenemapModal()); });
  const words = size => page.evaluate(size => { const im = images.find(p => p && p.type === 'genemap'); const e = Object.assign({}, im, { w: size, h: 160 });
    const W = []; const mc = _rtMc(); _genemapDraw(e, { rect() {}, line() {}, poly() {}, circle() {}, path() {}, clipStart() {}, clipEnd() {}, text(s, x, y, f, c, al) {
      mc.font = f; const w = mc.measureText(String(s)).width, x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x; W.push({ s: String(s), l: x0, r: x0 + w, y }); } }); return W; }, size);
  for (const size of [170, 260, 520]) {
    const W = await words(size), t0 = W.find(w => w.s === '0'), ticks = W.filter(w => /^\d+(\.\d+)?( kb)?$/.test(w.s) && w.y === t0.y);
    expect(ticks.length, `${size}: ${W.map(w => w.s)}`).toBeGreaterThanOrEqual(size > 200 ? 2 : 1);
    if (ticks.length > 1) expect(ticks[ticks.length - 1].s).toMatch(/ kb$/);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].l - ticks[i - 1].r, `${size}: ${ticks.map(t => t.s)}`).toBeGreaterThan(2);
    expect(W.some(w => w.s === '12.4 kb')).toBe(true);
  }
  // a protein domain map: Unit aa
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'genemap')));
  await page.locator('#gm-table').waitFor({ state: 'visible' });
  await page.locator('#gm-unit').selectOption('aa');
  await page.locator('#gm-length').fill('474');
  await page.locator('#gm-title').fill('Parkin-HA');
  await page.evaluate(() => applyGenemapModal());
  const r = await page.evaluate(() => { const im = images.find(p => p && p.type === 'genemap'); return { cap: _dataCaption(im), unit: im.map.unit }; });
  expect(r.unit).toBe('aa');
  expect(r.cap).toMatch(/Linear map of Parkin-HA \(474 aa\)/);
  const W = await words(400);
  expect(W.some(w => w.s === '474 aa')).toBe(true);
  expect(W.some(w => / bp$|kb$/.test(w.s))).toBe(false);
  expect(errors).toEqual([]);
});

test('blot3-11: a double-click on a chart panel opens its dialog with 📌 Panel mode on', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU8, 'cfu.csv');
  await apply(page);
  await page.evaluate(() => togglePanelAnnMode());               // Annotate & Draw › 📌 Panel mode
  expect(await page.evaluate(() => panelAnnMode)).toBe(true);
  const q = await page.evaluate(() => { const pb = panelBounds.find(p => images[p.idx] && images[p.idx].type === 'chart'); const c = document.getElementById('ann-canvas') || annCanvas;
    const R = c.getBoundingClientRect(), W = canvasLogicalW || c.width, H = canvasLogicalH || c.height;
    return { x: R.left + (pb.x + pb.w / 2) * R.width / W, y: R.top + (pb.y + pb.h / 2) * R.height / H }; });
  await page.mouse.dblclick(q.x, q.y);
  await expect(modal(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('charts3-12: replicate dots look the same inside a dark bar and above it', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'strain,v\nWT,1\nWT,1.6\nWT,3\nKO,2\nKO,2.2\nKO,1.4', 'v.csv');
  await apply(page);
  const dots = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el.chart.names = {}; sv('sample-colours', JSON.stringify({ WT: '#000000' })); el._chartKey = '';
    const D = []; _chartDraw(el, { rect() {}, line() {}, poly() {}, text() {}, clipStart() {}, clipEnd() {}, circle(x, y, r, f, s) { D.push([f, s]); } }); return D; });
  expect(dots.length).toBe(6);
  const wt = dots.slice(0, 3).map(d => d.join('/'));
  expect(new Set(wt).size).toBe(1);                                // one marker style for WT's three points
  // …that reads as the same filled dot on the black bar and on the white above it
  const lum = c => { const m = /#?([0-9a-f]{6})/i.exec(c) || [0, (/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c) || [0, 0, 0, 0]).slice(1, 4).map(v => (+v).toString(16).padStart(2, '0')).join('')];
    const v = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const [fill, edge] = dots[0];
  expect(cr(fill, '#000000')).toBeGreaterThan(3);                  // seen inside the black bar
  expect(Math.max(cr(fill, '#ffffff'), cr(edge, '#ffffff'))).toBeGreaterThan(3);   // and above it
  expect(errors).toEqual([]);
});

test('charts2-11: a sample drawn as bars in one chart and as a line in another keys as a square beside a line, not a line through a square', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, CFU8, 'cfu.csv'); await apply(page);
  await drop(page, 'time,WT,KO\n0,1,1\n1,2,1.5\n2,4,2', 'growth.csv'); await apply(page);
  const r = await page.evaluate(() => { const row = _figureKey().find(x => x.kind === 'series' && _rtText(x.name) === 'WT');
    const R = [], L = []; _keySwatch({ rect(x, y, w, h) { R.push([x, x + w]); }, line(x1, y1, x2) { L.push([x1, x2]); }, circle() {} }, row, 0, 10, { sw: 30, sh: 10, bg: '#ffffff' });
    return { desc: row.desc, R, L }; });
  expect(r.desc).toBe('filled bars and solid line');
  expect(r.R.length).toBe(1); expect(r.L.length).toBe(1);
  expect(r.L[0][0]).toBeGreaterThan(r.R[0][1]);                    // the line starts after the square
  expect(errors).toEqual([]);
});
