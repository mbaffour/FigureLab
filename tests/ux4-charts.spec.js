// @ts-check
// Usability round 4 — getting tables into charts, and sample names and colours across
// charts. Each test follows a tester's finding (charts4-NN, phage4-NN, fluor4-NN, blot4-NN)
// through the app's own controls, mostly with the testers' own files (tests/fixtures/ux4),
// and checks what the chart draws, what the key, caption and compliance check say. Each
// fails on the build they tested (41f6721).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const FX = path.join(__dirname, 'fixtures', 'ux4');
const read = f => fs.readFileSync(path.join(FX, f), 'utf8');
const TRUTH = JSON.parse(read('TRUTH.json'));
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

const modal = page => page.locator('#chart-modal');
const apply = page => modal(page).getByRole('button', { name: 'Apply' }).click();
const TOASTS = () => { window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; };
const toasts = page => page.evaluate(() => { const t = window.__toasts.slice(); window.__toasts.length = 0; return t; });
async function drop(page, files) {
  const n0 = await page.evaluate(() => images.filter(p => p && p.type === 'chart').length);
  await page.evaluate(F => addFiles(F.map(([t, n]) => new File([t], n, { type: 'text/csv' }))), files.map(f => [read(f), f]));
  await page.waitForFunction(([n0, k]) => images.filter(p => p && p.type === 'chart').length >= n0 + k, [n0, files.length]);
}
const chartIdx = (page, k = 0) => page.evaluate(k => images.map((p, i) => p && p.type === 'chart' ? i : -1).filter(i => i >= 0)[k], k);
const openChart = async (page, k = 0) => { const i = await chartIdx(page, k); await page.evaluate(i => openDataPanelEditor(i), i); await expect(modal(page)).toBeVisible(); };
const series = (page, k = 0) => page.evaluate(k => { const el = images.filter(p => p && p.type === 'chart')[k]; el._chartKey = ''; const s = _chartStatsCached(el);
  return (s.series || s.seriesNames || []).map(x => ({ name: _rtText(x.name), key: x.key, color: String(x.color).toLowerCase(), pts: (x.points || []).map(p => [p.x, p.y, p.err, p.n]) })); }, k);

// ── phage4-01, charts4-01: a plate-reader export opens as one, whatever its length ──
const PLATES = [
  ['Lr3_Gen5_export_20261112.csv', 15, 'A1–E3'],   // the phage tester's 8 h export, 49 reads
  ['Lr3_V5_30rows.csv', 15, 'A1–E3'], ['Lr3_V5_40rows.csv', 15, 'A1–E3'],
  ['Lr3_V2_12wells.csv', 12, 'A1–D3'], ['Lr3_V1_constT.csv', 15, 'A1–E3'],
  ['plate_reader_growth.csv', 12, 'A1–D3'],         // the charts tester's export with a medium-only blank row
];
for (const [file, n, span] of PLATES) {
  test(`phage4-01 / charts4-01: ${file} opens as a line of every well against Time with the Plate wells row`, async ({ page }) => {
    const errors = await loadApp(page);
    await drop(page, [file]);
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('#chart-kind')).toHaveValue('line');
    await expect(modal(page).locator('#chart-xcol option:checked')).toHaveText('Time');
    await expect(modal(page).locator('#chart-seriescol option:checked')).toHaveText('— none —');
    const ticked = await modal(page).locator('#chart-ycols input:checked').evaluateAll(b => b.map(x => x.parentElement.textContent.trim()));
    expect(ticked.length).toBe(n);
    expect(ticked.every(t => /^[A-H]\d{1,2}$/.test(t))).toBe(true);           // the temperature is not, no well is a series
    await expect(modal(page).locator('#chart-wells-wrap')).toBeVisible();
    await expect(modal(page).locator('#chart-wells-wrap')).toContainText(`Plate wells (${n}: ${span})`);
    await expect(modal(page).locator('#chart-wells-blank option')).toHaveCount(n + 1);   // blank subtraction offered
    // charts4-07: no Y title taken from the last well ("D3", "E3")
    await expect(modal(page).locator('#chart-ytitle')).toHaveValue('');
    expect(errors).toEqual([]);
  });
}

// The same export with its time written as plain minutes, decimal hours and h:mm.
for (const [form, head, conv] of [['minutes', 'Time (min)', m => String(m)], ['decimal hours', 'Time [h]', m => (m / 60).toFixed(4)], ['h:mm', 'Time', m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`]]) {
  test(`phage4-01: the 8 h export with its time as ${form} opens as a plate too`, async ({ page }) => {
    const errors = await loadApp(page);
    const L = read('Lr3_Gen5_export_20261112.csv').trim().split('\n'), H = L[0].split(',');
    H[0] = head;
    const csv = [H.join(',')].concat(L.slice(1).map(l => { const c = l.split(','); const [h, m] = c[0].split(':').map(Number); c[0] = conv(h * 60 + m); return c.join(','); })).join('\n');
    const n0 = await page.evaluate(() => images.filter(p => p && p.type === 'chart').length);
    await page.evaluate(T => addFiles([new File([T], 'export.csv', { type: 'text/csv' })]), csv);
    await page.waitForFunction(n0 => images.filter(p => p && p.type === 'chart').length > n0, n0);
    await expect(modal(page).locator('#chart-kind')).toHaveValue('line');
    await expect(modal(page).locator('#chart-xcol option:checked')).toHaveText(head);
    await expect(modal(page).locator('#chart-seriescol option:checked')).toHaveText('— none —');
    await expect(modal(page).locator('#chart-wells-wrap')).toContainText('Plate wells (15: A1–E3)');
    expect(await modal(page).locator('#chart-ycols input:checked').count()).toBe(15);
    expect(errors).toEqual([]);
  });
}

test('phage4-01: the 8 h export, wells by row with Row A as the blank, plots the tester\'s blank-subtracted means and SDs', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['Lr3_Gen5_export_20261112.csv']);
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  await apply(page);
  const S = await series(page), T = TRUTH['Lr3_Gen5_export_20261112.csv'];
  expect(S.map(s => s.name)).toEqual(['Row B', 'Row C', 'Row D', 'Row E']);
  S.forEach(s => {
    expect(s.pts.length).toBe(49);
    s.pts.forEach((p, i) => {
      expect(p[0] * (T.times_min[48] > 100 ? 60 : 1)).toBeCloseTo(T.times_min[i], 4);   // read in hours, the truth in minutes
      expect(p[1]).toBeCloseTo(T.blank_subtracted_mean[s.name][i], 3);
      expect(p[2]).toBeCloseTo(T.blank_subtracted_sd[s.name][i], 3);
      expect(p[3]).toBe(3);
    });
  });
  expect(errors).toEqual([]);
});

test('charts4-01: the export with a medium-only blank row matches the tester\'s truth after Plate wells › by row, blank Row A', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['plate_reader_growth.csv']);
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  await apply(page);
  const S = await series(page), T = TRUTH['plate_reader_growth.csv'];
  expect(S.map(s => s.name)).toEqual(['Row B', 'Row C', 'Row D']);
  S.forEach(s => s.pts.forEach(p => { const t = T[s.name][String(Math.round(p[0] * 60))];
    expect(p[1]).toBeCloseTo(t.mean, 9); expect(p[2]).toBeCloseTo(t.sd, 9); expect(p[3]).toBe(t.n); }));
  expect(errors).toEqual([]);
});

test('charts4-07: 16 h of reads end the x axis at 16 h, not on a 0–20 h axis', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { addChartElement('line');
    document.getElementById('chart-data-ta').value = 'Time (h)\tOD600\n' + Array.from({ length: 33 }, (_, i) => `${i / 2}\t${(0.05 * Math.exp(i / 10)).toFixed(4)}`).join('\n'); applyChartModal(); });
  const ticks = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); const T = []; el._chartKey = '';
    _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s, x, y, f, c, a, b, r) { if (!r) T.push(String(s)); } }); return T; });
  expect(ticks).toContain('16');
  expect(ticks).not.toContain('20');
  expect(errors).toEqual([]);
});

test('phage4-01: in a mixed pick with a picture the toast names a line of the wells, not "E3 against Time and A1"', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(TOASTS);
  await page.evaluate(async T => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40);
    const png = await new Promise(r => c.toBlob(b => r(new File([b], 'plate.png', { type: 'image/png' }))));
    await addFiles([png, new File([T], 'Lr3_Gen5_export_20261112.csv', { type: 'text/csv' })]);
  }, read('Lr3_Gen5_export_20261112.csv'));
  await page.waitForFunction(() => images.some(p => p && p.type === 'chart'));
  const t = (await toasts(page)).join(' | ');
  expect(t).toMatch(/line chart of 15 columns against Time/);
  expect(t).not.toMatch(/against Time and A1/);
  expect(errors).toEqual([]);
});

// ── charts4-02, charts4-03: one sample, one name and one colour in every chart ──
async function cfuAndPlate(page) {
  await page.evaluate(TOASTS);
  await drop(page, ['cfu_cipro_24h.csv', 'Lr3_V4_guide_like.csv']);
  for (let k = 0; k < 3 && await modal(page).isVisible(); k++) { await apply(page); await page.waitForTimeout(150); }
  await openChart(page, 1);
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  for (const [k, v] of [['Row B', 'MG1655'], ['Row C', 'dacrB'], ['Row D', 'dtolC']]) await modal(page).locator(`#chart-names [data-key="${k}"] input[type=text]`).fill(v);
  await apply(page);
  await toasts(page);
}
const texts = page => page.evaluate(() => { const el = images.filter(p => p && p.type === 'chart')[1]; el._chartKey = '';
  return { key: _keyText(), cap: _dataCaption(el), rows: _sampleColourNames().map(o => ({ name: _rtText(o.name), color: String(o.color).toLowerCase() })) }; });

test('charts4-02: a rename in the CFU chart reaches the plate-reader chart whose row is shown as that sample, and the toast says so', async ({ page }) => {
  const errors = await loadApp(page);
  await cfuAndPlate(page);
  await openChart(page, 0);
  await modal(page).locator('#chart-names [data-key="dacrB"] input[type=text]').fill('Δ*acrB*');
  await apply(page);
  expect((await toasts(page)).join(' | ')).toMatch(/also shows in panel B/);
  expect((await series(page, 1)).map(s => s.name)).toEqual(['MG1655', 'ΔacrB', 'dtolC']);
  const T = await texts(page);
  expect(T.key.match(/ΔacrB/g)).toHaveLength(1);
  expect(T.key).not.toMatch(/dacrB/);
  expect(T.cap).toMatch(/series: MG1655, ΔacrB and dtolC/);
  // the dialog says where the plate row's name comes from
  await openChart(page, 1);
  await expect(modal(page).locator('#chart-names [data-key="Row C"] .chart-name-via')).toHaveText('→ ΔacrB');
  expect(errors).toEqual([]);
});

test('charts4-03: the same shown name typed in the plate chart keeps the CFU chart\'s colour — one key row, one Sample colours row', async ({ page }) => {
  const errors = await loadApp(page);
  await cfuAndPlate(page);
  await openChart(page, 0);
  await modal(page).locator('#chart-names [data-key="dacrB"] input[type=text]').fill('Δ*acrB*');
  await apply(page);
  await openChart(page, 1);
  await modal(page).locator('#chart-names [data-key="Row C"] input[type=text]').fill('Δ*acrB*');
  await modal(page).locator('#chart-names [data-key="Row D"] input[type=text]').fill('Δ*tolC*');
  await apply(page);
  const bar = await page.evaluate(() => { const el = images.filter(p => p && p.type === 'chart')[0]; el._chartKey = ''; const s = _chartStatsCached(el);
    return Object.fromEntries(s.groups.map(g => [_rtText(g.cat), String(g.bars[0].color).toLowerCase()])); });
  const line = Object.fromEntries((await series(page, 1)).map(s => [s.name, s.color]));
  expect(line['ΔacrB']).toBe(bar['ΔacrB']);
  const T = await texts(page);
  expect(T.key.match(/ΔacrB/g)).toHaveLength(1);
  expect(T.rows.filter(r => r.name === 'ΔacrB')).toEqual([{ name: 'ΔacrB', color: bar['ΔacrB'] }]);
  expect(errors).toEqual([]);
});

test('charts4-03 / ISSUES "dfliC shown as Δ*fliC*": two samples already drawn in two colours and then given one name are drawn in one colour', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => {
    addChartElement('bar'); document.getElementById('chart-data-ta').value = 'strain\tv\nWT\t1\ndfliC\t2'; applyChartModal();
    addChartElement('bar'); document.getElementById('chart-data-ta').value = 'strain\tv\nWT\t1\nΔfliC\t3'; applyChartModal();
  });
  const colOf = (k, n) => page.evaluate(([k, n]) => { const el = images.filter(p => p && p.type === 'chart')[k]; el._chartKey = ''; const s = _chartStatsCached(el);
    return String(s.groups.find(g => _rtText(g.cat) === n).bars[0].color).toLowerCase(); }, [k, n]);
  expect(await colOf(0, 'dfliC')).not.toBe(await colOf(1, 'ΔfliC'));     // two samples, two colours
  await openChart(page, 0);
  await modal(page).locator('#chart-names [data-key="dfliC"] input[type=text]').fill('Δ*fliC*');
  await apply(page);
  expect(await colOf(0, 'ΔfliC')).toBe(await colOf(1, 'ΔfliC'));
  expect((await page.evaluate(() => _keyText())).match(/ΔfliC/g)).toHaveLength(1);
  expect(errors).toEqual([]);
});

// ── charts4-04, charts4-06: a tidy time course sorted by MOI ──
test('charts4-04: a tidy file with a numeric MOI column is a line of OD600 against time_min with MOI as the series', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['lysis_tidy.csv']);
  await expect(modal(page).locator('#chart-kind')).toHaveValue('line');
  await expect(modal(page).locator('#chart-xcol option:checked')).toHaveText('time_min');
  await expect(modal(page).locator('#chart-seriescol option:checked')).toHaveText('MOI');
  expect(await modal(page).locator('#chart-ycols input:checked').evaluateAll(b => b.map(x => x.parentElement.textContent.trim()))).toEqual(['OD600']);
  await apply(page);
  const S = await series(page), T = TRUTH['lysis_tidy.csv'];
  expect(S.map(s => s.name)).toEqual(['MOI 0', 'MOI 1', 'MOI 10']);
  S.forEach(s => s.pts.forEach(p => { const t = T[s.name.replace('MOI ', '')][String(p[0])]; expect(p[1]).toBeCloseTo(t.mean, 9); expect(p[2]).toBeCloseTo(t.sd, 9); }));
  expect(errors).toEqual([]);
});

test('charts4-04: switched from a bar of every column to a line by MOI, the X, Series and replicate columns are unticked', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['lysis_tidy.csv']);
  // the bar of every column the tester got (and Apply pins its bogus groups' colours)
  await modal(page).locator('#chart-kind').selectOption('bar');
  await modal(page).locator('#chart-layout').selectOption('columns');
  await apply(page);
  await openChart(page);
  await modal(page).locator('#chart-kind').selectOption('line');
  await modal(page).locator('#chart-xcol').selectOption({ label: 'time_min' });
  await modal(page).locator('#chart-seriescol').selectOption({ label: 'MOI' });
  expect(await modal(page).locator('#chart-ycols input:checked').evaluateAll(b => b.map(x => x.parentElement.textContent.trim()))).toEqual(['OD600']);
  await apply(page);
  expect((await series(page)).map(s => s.name)).toEqual(['MOI 0', 'MOI 1', 'MOI 10']);
  expect(errors).toEqual([]);
});

test('charts4-06: after the bogus bar of every column, a line by MOI is applied in the colours its dialog showed', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['lysis_tidy.csv']);
  await modal(page).locator('#chart-kind').selectOption('bar');
  await modal(page).locator('#chart-layout').selectOption('columns');
  await apply(page);                                  // pins time_min, MOI, replicate, OD600
  await openChart(page);
  await modal(page).locator('#chart-kind').selectOption('line');
  await modal(page).locator('#chart-xcol').selectOption({ label: 'time_min' });
  await modal(page).locator('#chart-seriescol').selectOption({ label: 'MOI' });
  for (const v of ['0', '1', '2']) { const b = modal(page).locator(`#chart-ycols input[value="${v}"]`); if (await b.isChecked()) await b.uncheck(); }
  await modal(page).locator('#chart-ycols input[value="3"]').check();
  const swatches = await modal(page).locator('#chart-names [data-key] input[type=color]').evaluateAll(b => b.map(x => x.value.toLowerCase()));
  await apply(page);
  const S = await series(page);
  expect(S.map(s => s.name)).toEqual(['MOI 0', 'MOI 1', 'MOI 10']);
  expect(S.map(s => s.color)).toEqual(swatches);
  expect(errors).toEqual([]);
});

// ── fluor4-02: Condition, Rep1, Rep2, Rep3 ──
test('fluor4-02: a table of replicate columns is one bar per condition, mean ± SD of the three, with the points', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['parkin_recruitment.csv']);
  await expect(modal(page).locator('#chart-kind')).toHaveValue('bar');
  await expect(modal(page).locator('#chart-rep-wrap')).toBeVisible();
  await expect(modal(page).locator('#chart-repcols')).toBeChecked();
  await expect(modal(page).locator('#chart-err')).toHaveValue('sd');
  await apply(page);
  const st = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const s = _chartStatsCached(el);
    return { cats: s.categories, bars: s.groups.map(g => g.bars.map(b => [b.value, b.err, b.n])), pts: !!el.chart.style.showPoints }; });
  expect(st.cats).toEqual(['DMSO', 'CCCP', 'OA']);
  expect(st.bars.map(b => b.length)).toEqual([1, 1, 1]);
  [[7.67, 1.55], [78.1, 3.06], [60.77, 8.90]].forEach(([m, e], i) => { expect(st.bars[i][0][0]).toBeCloseTo(m, 1); expect(st.bars[i][0][1]).toBeCloseTo(e, 1); expect(st.bars[i][0][2]).toBe(3); });
  expect(st.pts).toBe(true);
  // a Bar chart switched to by hand offers the tick too
  await openChart(page);
  await modal(page).locator('#chart-kind').selectOption('groupedBar');
  await expect(modal(page).locator('#chart-rep-wrap')).toBeVisible();
  expect(errors).toEqual([]);
});

// ── fluor4-06: the Y title the preview shows is the one applied ──
test('fluor4-06: data retyped as tidy rows keep the Y title the preview drew after Apply', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => addChartElement('bar'));
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('#chart-data-ta').fill('Condition\tRep\tParkin on mitochondria (% cells)\nDMSO\t1\t6.4\nDMSO\t2\t7.2\nCCCP\t1\t80.3\nCCCP\t2\t74.6');
  await page.waitForTimeout(600);
  await expect(modal(page).locator('#chart-ytitle')).toHaveValue('Parkin on mitochondria (% cells)');
  await apply(page);
  expect(await page.evaluate(() => images.find(p => p && p.type === 'chart').chart.axes.y.title)).toBe('Parkin on mitochondria (% cells)');
  expect(errors).toEqual([]);
});

// ── charts4-07: the guessed Y title follows the value columns until typed over ──
test('charts4-07: a Y title the guess took from one column clears when more columns are ticked; a typed one stays', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => addChartElement('line'));
  await modal(page).locator('#chart-data-ta').fill('time\tWT\tKO\n0\t1\t1\n1\t2\t1.5\n2\t4\t2');
  await page.waitForTimeout(600);
  await modal(page).locator('#chart-ycols input[value="2"]').uncheck();
  await expect(modal(page).locator('#chart-ytitle')).toHaveValue('WT');
  await modal(page).locator('#chart-ycols input[value="2"]').check();
  await expect(modal(page).locator('#chart-ytitle')).toHaveValue('');
  await modal(page).locator('#chart-ytitle').fill('OD600');
  await modal(page).locator('#chart-ycols input[value="2"]').uncheck();
  await expect(modal(page).locator('#chart-ytitle')).toHaveValue('OD600');
  expect(errors).toEqual([]);
});

// ── charts4-10 ──
test('charts4-10: a Columns-layout bar chart\'s help line describes the Columns layout', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['zone_cipro_wide.csv']);
  await expect(modal(page).locator('#chart-layout')).toHaveValue('columns');
  await expect(modal(page).locator('#chart-kind-hint')).toContainText('One column per group');
  await expect(modal(page).locator('#chart-kind-hint')).not.toContainText('One row per replicate');
  expect(errors).toEqual([]);
});

// ── phage4-04: Y title typed first, then the names ──
test('phage4-04: typing the Y title and then clicking into the first name box keeps the first name typed', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['Lr3_V4_guide_like.csv']);              // the tester's nametest.js file
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  await modal(page).locator('#chart-ytitle').click();
  await page.keyboard.type('OD_{600}');
  const names = ['MG1655', 'MG1655 + Lr3', 'dompC + Lr3'];
  for (let i = 0; i < 3; i++) { await modal(page).locator('#chart-names input[placeholder^="shown as"]').nth(i).click(); await page.keyboard.type(names[i]); }
  expect(await modal(page).locator('#chart-names input[placeholder^="shown as"]').evaluateAll(b => b.map(x => x.value))).toEqual(names);
  await apply(page);
  expect((await series(page)).map(s => s.name)).toEqual(names);
  expect(errors).toEqual([]);
});

// ── phage4-16: no Okabe–Ito yellow for a line on white ──
test('phage4-16: a line chart of five series on white is not given Okabe–Ito yellow', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, ['Lr3_V3_11rows.csv']);
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await apply(page);
  const cols = (await series(page)).map(s => s.color);
  expect(cols.length).toBe(5);
  expect(cols).not.toContain('#f0e442');
  expect(errors).toEqual([]);
});

// ── phage4-03, charts4-05: a chart too small for what it holds is flagged ──
const ROWS = `window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({ label: e.querySelector('.c-label').textContent.trim(), text: e.textContent.replace(/\\s+/g, ' ').trim() }));`;
test('phage4-03: long shown-as names wrap in the legend instead of running off the panel; one that cannot fit is a compliance row', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ROWS);
  await drop(page, ['Lr3_V4_guide_like.csv']);
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  await modal(page).locator('#chart-legend').check();
  for (const [k, v] of [['Row B', 'MG1655 + vB_EcoM_Lr3'], ['Row C', 'ΔompC + vB_EcoM_Lr3'], ['Row D', 'ΔompC ΔlamB + vB_EcoM_Lr3']]) await modal(page).locator(`#chart-names [data-key="${k}"] input[type=text]`).fill(v);
  await apply(page);
  // what the legend draws stays inside the chart
  const out = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const mc = _rtMc(); const o = [];
    _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s, x, y, f, c, a, b, r) { if (!r && a === 'left') { mc.font = f; o.push({ s: String(s), r: x + mc.measureText(String(s)).width, W: el.w }); } } }); return o; });
  expect(out.length).toBeGreaterThan(3);
  out.forEach(t => expect(t.r).toBeLessThanOrEqual(t.W + 0.5));
  // a name with no space to wrap at, in a narrow chart, is named by the check
  await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el.chart.names['Row B'] = 'MG1655+vB_EcoM_Lr3_lysate_2026'; el._chartKey = ''; sv('cols', '3'); render(); });
  const row = await page.evaluate(() => { checkCompliance(); return __rows().find(r => r.label === 'Chart room') || null; });
  expect(row && row.text).toMatch(/legend name “MG1655\+vB_EcoM_Lr3_lysate_2026” cut at the panel edge/);
  expect(errors).toEqual([]);
});

test('charts4-05: stacked brackets that squeeze a small dot plot to a sliver are a compliance row', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ROWS);
  await drop(page, ['cfu_cipro_24h.csv']);
  await modal(page).locator('#chart-kind').selectOption('beeswarm');
  await apply(page);
  const before = await page.evaluate(() => { sv('panel-h', '150'); sv('panel-w', '150'); onLayoutChange(); render(); checkCompliance(); const r = __rows().find(r => r.label === 'Chart room'); return r ? r.text : ''; });
  console.log('[charts4-05 before]', JSON.stringify(before));
  expect(before).not.toMatch(/under its brackets/);   // without brackets the plot is not squeezed by them (a cut legend name may still be listed on another platform's fonts)
  await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart');
    el.chart.annos = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([a, b]) => ({ kind: 'sig', a, b, text: 'p < 0.01' }));
    el._chartKey = ''; render(); });
  const row = await page.evaluate(() => { checkCompliance(); return __rows().find(r => r.label === 'Chart room') || null; });
  expect(row && row.text).toMatch(/A: its plot is [\d.]+ mm tall \(\d+% of the panel\) under its brackets/);
  expect(errors).toEqual([]);
});

// ── blot4-07: the Y title clear of the panel letter ──
test('blot4-07: a two-line Y title in a chart cell starts below the panel letter', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => {
    addChartElement('bar'); document.getElementById('chart-data-ta').value = 'lane\tv\nL1\t1\nL2\t0.8\nL3\t1.2\nL4\t5'; _chartReparse(true);
    sv('chart-ytitle', 'Band volume ÷ the loading control, relative to lane 2'); applyChartModal();
    sv('panel-h', '130'); sv('panel-w', '200'); render(); });
  const r = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const LB = _chartLetterBox(el); const mc = _rtMc(); const o = [];
    _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s, x, y, f, c, a, b, r) { if (r === -90) { mc.font = f; o.push({ x, top: y - mc.measureText(String(s)).width / 2 }); } } });
    return { LB, o }; });
  expect(r.LB && r.LB.top).toBe(true);
  expect(r.o.length).toBeGreaterThan(0);
  r.o.forEach(t => { if (t.x - 12 < r.LB.x1) expect(t.top).toBeGreaterThanOrEqual(r.LB.y1 - 0.5); });
  expect(errors).toEqual([]);
});

// ── fluor4-07: a chart spanning the condition rows comes after the row groups ──
test('fluor4-07: a chart spanning two headed rows is captioned after the row groups, not under the first row', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) { const c = document.createElement('canvas'); c.width = 80; c.height = 80; c.getContext('2d').fillRect(0, 0, 80, 80);
      const src = c.toDataURL(); await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, `f${i}.png`); r(); }; im.src = src; }); }
    addChartElement('bar'); document.getElementById('chart-data-ta').value = 'cond\tv\nDMSO\t7\nCCCP\t78\nOA\t60'; applyChartModal();
    sv('cols', '3'); sv('rows', '2');
    const ch = images.find(p => p && p.type === 'chart'); ch.rowSpan = 2;
    images.splice(images.indexOf(ch), 1); images.splice(2, 0, ch);
    sc('show-row-labels', true); onLayoutChange(); setAxisLabels('row', ['CCCP', 'DMSO']); render(); relabelPanels(); render();
  });
  const cap = await page.evaluate(() => _captionText());
  expect(cap).toMatch(/Across rows: \(C\) Bar chart/);
  expect(cap).not.toMatch(/CCCP: \([A-Z]\)[^]*\(C\) Bar chart[^]*DMSO:/);
  expect(errors).toEqual([]);
});

// ── blot4-05: pAKT normalised to total AKT is a phospho/total ratio, not a loading control ──
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
  window.__gelMake = (spec) => { const src = __gelPng(spec);
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, spec.name); render(); res(); }; img.src = src; }); };
  window.__blot = (name, lanes, seed) => ({ w: 60 + 70 * lanes.length, h: 160, bg: 228, name, seed,
    lanes: lanes.map((bands, k) => ({ x0: 30 + 70 * k, x1: 75 + 70 * k, bands: bands.map(([y, amp]) => ({ y, s: 3, amp })) })) });
};
test('blot4-05: "Another target (phospho/total)" normalises pAKT to total AKT and every text calls it that, not a loading control', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(GEL);
  await page.evaluate(TOASTS);
  const P = [40, 44, 120, 110], A = [80, 84, 82, 78];
  await page.evaluate(async ([P, A]) => {
    await __gelMake(__blot('pAKT_S473.png', P.map(x => [[50, x]]), 3));
    await __gelMake(__blot('AKT-total.png', A.map(x => [[50, x]]), 7));
    runGelAnalysis(0); runGelAnalysis(1); gelSetRefLane(0, 0);
    openGelAnalysis(0);
  }, [P, A]);
  // the dialog's own control
  await page.locator('#gel-lc').selectOption({ index: 1 });
  await page.locator('#gel-lc-mode').selectOption('target');
  await expect(page.locator('#gel-modal-bg')).toContainText('Normalised to another target, AKT-total (panel B)');
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  const t = (await toasts(page)).join(' | ');
  expect(t).toMatch(/Panel B not charted \(the other target of a phospho\/total ratio\)/);
  expect(t).not.toMatch(/a loading control/);
  const out = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const s = _chartStatsCached(el);
    return { y: el.chart.axes.y.title, cap: el.chart.caption, vals: s.groups.map(g => g.bars[0].value), meth: generateMethodsParagraph() }; });
  expect(out.y).toBe('Band volume ÷ AKT-total, relative to lane 1');
  expect(out.cap).toMatch(/band volume ÷ AKT-total, relative to lane 1/);
  // the ratio itself: (pAKT ÷ AKT) relative to lane 1, within the synthetic blots' noise
  out.vals.forEach((v, i) => expect(v).toBeCloseTo((P[i] / A[i]) / (P[0] / A[0]), 1));
  expect(out.meth).toMatch(/normalised to a second target, AKT-total \(panel B\), probed on its own blot \(each band divided by the summed band volume of the paired lane: a phospho\/total ratio\)/);
  expect(out.meth).not.toMatch(/normalised to the loading control/);
  await page.evaluate(() => applyPreset('embo'));
  const row = await page.evaluate(() => { checkCompliance(); const r = [...document.querySelectorAll('#info-modal-bg .compliance-row')].find(e => e.querySelector('.c-label').textContent.trim() === 'Loading control'); return r ? r.textContent.replace(/\s+/g, ' ') : null; });
  expect(row).toMatch(/A is normalised to another target, AKT-total \(panel B\) \(a phospho\/total ratio\), not to a loading control/);
  expect(errors).toEqual([]);
});

// ── ISSUES "one sample under several names", "paper_style.json does not carry shown-as names" ──
test('ISSUES: "Uninfected" typed for MOI_0 reaches a MOI 0 mean chart; paper_style.json carries the shown-as names and loads them back', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => {
    addChartElement('line'); document.getElementById('chart-data-ta').value = 'time\tMOI_0_r1\tMOI_0_r2\tMOI_1_r1\tMOI_1_r2\n0\t1\t1.1\t1\t0.9\n30\t2\t2.2\t1.2\t1.1'; applyChartModal();
    addChartElement('line'); document.getElementById('chart-data-ta').value = 'time\tMOI 0 mean\tMOI 0 SD\n0\t1\t0.1\n30\t2\t0.2'; applyChartModal();
  });
  await openChart(page, 0);
  await modal(page).locator('#chart-names [data-key="MOI_0"] input[type=text]').fill('Uninfected');
  await apply(page);
  expect((await series(page, 1)).map(s => s.name)).toEqual(['Uninfected']);
  expect((await page.evaluate(() => _keyText())).match(/Uninfected/g)).toHaveLength(1);
  // saved with the colours, and read back into a fresh figure
  const file = await page.evaluate(async () => { let blob = null; const u = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return u.call(URL, b); };
    try { saveSampleColoursStyle(); } finally { URL.createObjectURL = u; } return JSON.parse(await blob.text()); });
  expect(file.settings.sample_names).toEqual({ MOI_0: 'Uninfected' });
  await page.reload(); await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate(f => { loadLabStyle(f, 'paper_style.json'); addChartElement('line'); document.getElementById('chart-data-ta').value = 'time\tMOI_0\n0\t1\n30\t2'; applyChartModal(); }, file);
  expect((await series(page, 0)).map(s => s.name)).toEqual(['Uninfected']);
  expect(errors).toEqual([]);
});

// ── Plate rows are each chart's own; sessions saved before keep working ──
async function plateByRow(page, file, k, names) {
  await drop(page, [file]);
  await modal(page).locator('#chart-wells-by').selectOption('row');
  await modal(page).locator('#chart-wells-blank').selectOption('Row A');
  for (const [r, v] of names) await modal(page).locator(`#chart-names [data-key="${r}"] input[type=text]`).fill(v);
  await apply(page);
}
test('charts4-02 design: two plates in one figure — Row B named differently in each is two samples, two colours and two key rows', async ({ page }) => {
  const errors = await loadApp(page);
  await plateByRow(page, 'Lr3_V4_guide_like.csv', 0, [['Row B', 'MG1655'], ['Row C', 'MG1655 + Lr3'], ['Row D', 'dompC + Lr3']]);
  await plateByRow(page, 'Lr3_V3_11rows.csv', 1, [['Row B', 'BW25113'], ['Row C', 'BW25113 + Lr3'], ['Row D', 'dfhuA + Lr3'], ['Row E', 'dfhuA dlamB + Lr3']]);
  const a = await series(page, 0), b = await series(page, 1);
  expect(a.map(s => s.name)).toEqual(['MG1655', 'MG1655 + Lr3', 'dompC + Lr3']);
  expect(b.map(s => s.name)).toEqual(['BW25113', 'BW25113 + Lr3', 'dfhuA + Lr3', 'dfhuA dlamB + Lr3']);
  expect(a[0].color).not.toBe(b[0].color);
  const key = await page.evaluate(() => _keyText());
  expect(key).toMatch(/MG1655 \(/); expect(key).toMatch(/BW25113 \(/);
  expect(errors).toEqual([]);
});

test('a session saved on 41f6721 with "Row C" shown as dacrB figure-wide: the name shows, can be changed and can be cleared', async ({ page }) => {
  const errors = await loadApp(page);
  await plateByRow(page, 'Lr3_V4_guide_like.csv', 0, []);
  await page.evaluate(() => { sv('sample-names', JSON.stringify({ 'Row C': 'dacrB' })); images.forEach(p => { if (p) { p._chartKey = ''; p._chartStat = null; } }); render(); });
  expect((await series(page)).map(s => s.name)).toEqual(['Row B', 'dacrB', 'Row D']);
  await openChart(page);
  await expect(modal(page).locator('#chart-names [data-key="Row C"] input[type=text]')).toHaveValue('dacrB');
  await modal(page).locator('#chart-names [data-key="Row C"] input[type=text]').fill('Δ*acrB*');
  await apply(page);
  expect((await series(page)).map(s => s.name)).toEqual(['Row B', 'ΔacrB', 'Row D']);
  await openChart(page);
  await modal(page).locator('#chart-names [data-key="Row C"] input[type=text]').fill('');
  await apply(page);
  expect((await series(page)).map(s => s.name)).toEqual(['Row B', 'Row C', 'Row D']);
  expect(await page.evaluate(() => gv('sample-names'))).toBe('');
  expect(errors).toEqual([]);
});

test('charts4-03 after reopening: a saved session keeps one name in one colour across the CFU and plate charts, and a phospho/total normalisation', async ({ page }) => {
  const errors = await loadApp(page);
  await cfuAndPlate(page);
  await openChart(page, 0);
  await modal(page).locator('#chart-names [data-key="dacrB"] input[type=text]').fill('Δ*acrB*');
  await apply(page);
  const before = { a: await series(page, 1), key: await page.evaluate(() => _keyText()) };
  const S = await page.evaluate(() => JSON.stringify(serializeSession(true)));
  const p = await page.context().newPage(); const e2 = await loadApp(p);
  await p.evaluate(async S => { applySession(JSON.parse(S), { origin: 'file' }); await new Promise(r => setTimeout(r, 400)); render(); }, S);
  const after = { a: await series(p, 1), key: await p.evaluate(() => _keyText()) };
  expect(after).toEqual(before);
  expect(after.key.match(/ΔacrB/g)).toHaveLength(1);
  // the rename typed after reopening still takes the CFU chart's colour
  await openChart(p, 1);
  await p.locator('#chart-modal #chart-names [data-key="Row D"] input[type=text]').fill('Δ*tolC*');
  await p.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  const k2 = await p.evaluate(() => _keyText());
  expect(k2.match(/ΔacrB/g)).toHaveLength(1);
  // a phospho/total normalisation survives the round trip as itself
  await p.evaluate(GEL);
  const t = await p.evaluate(async () => {
    await __gelMake(__blot('pAKT.png', [[[50, 40]], [[50, 90]]], 3)); await __gelMake(__blot('AKT-total.png', [[[50, 80]], [[50, 82]]], 7));
    const n = images.length; runGelAnalysis(n - 2); runGelAnalysis(n - 1); gelSetLoading(n - 2, n - 1, 'target');
    const S2 = JSON.stringify(serializeSession(true)); applySession(JSON.parse(S2), { origin: 'file' }); await new Promise(r => setTimeout(r, 400));
    const a = images[images.length - 2].gelAnalysis; return { target: _gelLoadTarget(a), what: _gelLoadingWhat(a) };
  });
  expect(t.target).toBe(true);
  expect(t.what).toMatch(/^another target, AKT-total/);
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});
