// @ts-check
// Usability round 5 — charts: brackets that follow their groups, plate-reader exports with
// an instrument header, zeros on a log axis, brackets between the bars of one group, and
// charts printed narrow. Each test follows a tester's finding (charts5-NN, phage5-NN,
// newcomer5-NN, freeform5-NN, blot5-NN, fluor5-NN) through the app's own controls, with the
// testers' own files (tests/fixtures/ux5), and checks what the chart draws and what the
// caption, source data, key and compliance check say. Each fails on the build they tested
// (1cedb76).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loadApp, seedPanels } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const FX = path.join(__dirname, 'fixtures', 'ux5');
const read = f => fs.readFileSync(path.join(FX, f), 'utf8');
const TRUTH = JSON.parse(read('TRUTH.json'));

const modal = page => page.locator('#chart-modal');
const apply = async page => { await modal(page).getByRole('button', { name: 'Apply' }).click(); await expect(modal(page)).toBeHidden(); };
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
const ROWS = `window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({ label: e.querySelector('.c-label').textContent.trim(), text: e.textContent.replace(/\\s+/g, ' ').trim() }));`;
const sourceData = async page => { const f = await page.evaluate(() => __pkg()); return Object.entries(f).filter(([k]) => k.startsWith('source-data/')).map(([, v]) => v).join('\n'); };
// Drop the tester's file through the app's own file path; the Chart dialog opens.
async function drop(page, file, text) {
  const n0 = await page.evaluate(() => images.filter(p => p && p.type === 'chart').length);
  await page.evaluate(([T, n]) => addFiles([new File([T], n, { type: 'text/csv' })]), [text ?? read(file), file]);
  await page.waitForFunction(n0 => images.filter(p => p && p.type === 'chart').length > n0, n0);
  await expect(modal(page)).toBeVisible();
}
const chartEl = (page, k = 0) => page.evaluate(k => images.filter(p => p && p.type === 'chart')[k].label, k);
const openChart = async (page, k = 0) => { await page.evaluate(k => openDataPanelEditor(images.indexOf(images.filter(p => p && p.type === 'chart')[k])), k); await expect(modal(page)).toBeVisible(); };
const caption = page => page.evaluate(() => { images.forEach(p => { if (p && p.type === 'chart') { p._chartKey = ''; p._chartStat = null; } }); render(); return _captionText(); });
const sigSection = page => modal(page).locator('#chart-sig-list');
// Move a group with Names & colours › ↑ / ↓.
const moveGroup = async (page, key, dir, times = 1) => { for (let i = 0; i < times; i++) await modal(page).locator(`#chart-names [data-key="${key}"] button[title="${dir < 0 ? 'Move left' : 'Move right'}"]`).first().click(); };
// Where each bracket is drawn: its horizontal line's ends, from the chart's own drawing.
const bracketXs = (page, k = 0) => page.evaluate(k => { const el = images.filter(p => p && p.type === 'chart')[k]; el._chartKey = ''; const L = [], T = [];
  _chartDraw(el, { rect() {}, poly() {}, circle() {}, line(x1, y1, x2, y2) { L.push([x1, y1, x2, y2]); }, text(s, x, y) { T.push([String(s), x, y]); } });
  const st = _chartStatsCached(el), n = st.categories.length;
  // a bracket is the vertical–horizontal–vertical triple; its top line is horizontal and has drops at both ends
  const hz = L.filter(([x1, y1, x2, y2], i) => y1 === y2 && x2 > x1 && L.some(q => q[0] === x1 && q[2] === x1 && (q[1] === y1 || q[3] === y1) && q[1] !== q[3]) && L.some(q => q[0] === x2 && q[2] === x2 && (q[1] === y1 || q[3] === y1) && q[1] !== q[3]));
  return { hz: hz.map(q => [q[0], q[2]]), cats: st.categories.map(c => _rtText(String(c))), texts: T }; }, k);

// ── charts5-01 (blocker): a bracket follows its groups when they are reordered ───────────
const INV = 'invasion_A549_EU_v2.csv';
async function invasionWithBrackets(page) {
  await drop(page, INV);
  await sigSection(page).locator('xpath=..').getByRole('button', { name: '+ Add' }).click();
  await sigSection(page).locator('xpath=..').getByRole('button', { name: '+ Add' }).click();
  const rows = sigSection(page).locator('> div');
  // p = 0.002 for PA14 vs dlasR, p = 0.004 for dlasR vs dmexB (the file's order: PA14, dlasR, dmexB, dlasR + plasR)
  for (const [i, a, b, t] of [[0, 'PA14', 'dlasR', 'p = 0.002'], [1, 'dlasR', 'dmexB', 'p = 0.004']]) {
    await rows.nth(i).locator('select').nth(0).selectOption({ label: a });
    await rows.nth(i).locator('select').nth(1).selectOption({ label: b });
    await rows.nth(i).locator('input[type=text]').fill(t);
  }
  await apply(page);
}

test('charts5-01: brackets follow their groups through ↑↓ — the drawing, caption and source data keep the pairs they were typed for', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await invasionWithBrackets(page);
  expect(await caption(page)).toContain('Brackets: p = 0.002 (PA14 vs dlasR); p = 0.004 (dlasR vs dmexB)');
  // the tester's revision: move the complemented strain up, then ΔmexB to second place
  await openChart(page);
  await moveGroup(page, 'dlasR + plasR', -1);
  await moveGroup(page, 'dmexB', -1, 2);
  await apply(page);
  const order = await page.evaluate(() => _chartStatsCached(images.find(p => p && p.type === 'chart')).catKeys);
  expect(order).toEqual(['PA14', 'dmexB', 'dlasR', 'dlasR + plasR']);
  const cap = await caption(page);
  expect(cap).toContain('Brackets: p = 0.002 (PA14 vs dlasR); p = 0.004 (dlasR vs dmexB)');
  expect(cap).not.toContain('PA14 vs dmexB');
  const csv = await sourceData(page);
  expect(csv).toContain('# Significance mark "p = 0.002" between PA14 and dlasR (groups 1 and 3)');
  expect(csv).toContain('# Significance mark "p = 0.004" between dlasR and dmexB (groups 3 and 2)');
  // drawn from PA14's centre to dlasR's, and from dmexB's to dlasR's
  const d = await bracketXs(page);
  const el = await page.evaluate(() => { const e = images.find(p => p && p.type === 'chart'); return { w: e.w }; });
  const centres = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); const C = [];
    _chartDraw(el, { rect(x, y, w, h, f, s) { if (f && f !== '#ffffff' && s && h > 0 && w > 4) C.push(x + w / 2); }, poly() {}, circle() {}, line() {}, text() {} }); return C; });
  const near = (x, c) => Math.abs(x - c) < 2;
  expect(d.hz.length).toBe(2);
  const spans = d.hz.map(([a, b]) => [centres.findIndex(c => near(a, c)), centres.findIndex(c => near(b, c))].sort());
  expect(spans).toContainEqual([0, 2]);   // PA14 – dlasR
  expect(spans).toContainEqual([1, 2]);   // dmexB – dlasR
  expect(el.w).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('charts5-01: a session saved with brackets by position opens with them on the groups at those positions, and they follow a reorder', async ({ page }) => {
  const errors = await loadApp(page);
  // saved by build 1cedb76: order PA14, dlasR, dlasR + plasR, dmexB; brackets {a:0,b:1} and {a:1,b:2}
  await page.evaluate(t => _loadSessionText(t, 'v3-session.json'), read('legacy-brackets-session.json'));
  expect(await caption(page)).toContain('Brackets: p = 0.002 (PA14 vs dlasR); p = 0.004 (dlasR vs dlasR + plasR)');
  // the tester's probe: ΔmexB ↑ twice → PA14, dmexB, dlasR, dlasR + plasR
  await openChart(page);
  await moveGroup(page, 'dmexB', -1, 2);
  // the dialog's menus show the pairs as typed, now at their new places
  const sel = await sigSection(page).locator('> div').evaluateAll(R => R.map(r => [...r.querySelectorAll('select')].map(s => s.selectedOptions[0].text)));
  expect(sel).toEqual([['PA14', 'dlasR'], ['dlasR', 'dlasR + plasR']]);
  await apply(page);
  const cap = await caption(page);
  expect(cap).toContain('Brackets: p = 0.002 (PA14 vs dlasR); p = 0.004 (dlasR vs dlasR + plasR)');
  expect(cap).not.toMatch(/PA14 vs dmexB|dmexB vs dlasR/);
  expect(errors).toEqual([]);
});

test('charts5-01: brackets follow a rename and an added group; a removed group\'s bracket is flagged on the chart, in the caption, source data and compliance — never re-attached', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await invasionWithBrackets(page);
  // rename dlasR → Δ*lasR* (Names & colours), and add a fifth group in the data box
  await openChart(page);
  await modal(page).locator('#chart-names [data-key="dlasR"] input[type=text]').fill('Δ*lasR*');
  const ta = modal(page).locator('#chart-data-ta');
  await ta.fill((await ta.inputValue()) + '\nPAO1\t1\t90000\nPAO1\t2\t95000\nPAO1\t3\t99000');
  await page.waitForTimeout(700);
  await moveGroup(page, 'PAO1', -1, 4);   // to the front
  await apply(page);
  let cap = await caption(page);
  expect(cap).toContain('Brackets: p = 0.002 (PA14 vs ΔlasR); p = 0.004 (ΔlasR vs dmexB)');
  // now take dlasR's rows out of the data box
  await openChart(page);
  const t2 = (await ta.inputValue()).split('\n').filter(l => !/^dlasR\t/.test(l)).join('\n');
  await ta.fill(t2); await page.waitForTimeout(700);
  // the dialog says which brackets lost a group
  await expect(sigSection(page)).toContainText('⚠ Not drawn: ΔlasR is no longer in the chart');
  await apply(page);
  cap = await caption(page);
  expect(cap).not.toMatch(/Brackets: p = 0\.00[24]/);
  expect(cap).toContain('[⚠ Bracket “p = 0.002” is not drawn: ΔlasR is no longer in the chart; Bracket “p = 0.004” is not drawn: ΔlasR is no longer in the chart');
  // nothing is drawn between the groups left, and the chart says why under its plot
  const d = await bracketXs(page);
  expect(d.hz).toEqual([]);
  expect(d.texts.map(t => t[0])).toContain('⚠ bracket “p = 0.002” not drawn: ΔlasR is no longer in the chart');
  const csv = await sourceData(page);
  expect(csv).toContain('# WARNING: significance mark "p = 0.002" is NOT drawn: ΔlasR is no longer in the chart');
  expect(csv).not.toContain('# Significance mark "p = 0.002"');
  // compliance: a failed row
  await page.evaluate(ROWS);
  const row = await page.evaluate(() => { checkCompliance(); return __rows().find(r => r.label === 'Brackets') || null; });
  expect(row && row.text).toMatch(/^✗ Brackets .*bracket “p = 0\.002” is not drawn — ΔlasR is no longer in the chart/);
  expect(errors).toEqual([]);
});

// ── charts5-07: a bracket between two series in one group ────────────────────────────
test('charts5-07: on a grouped bar with a Series column a bracket joins two strains within one serum, drawn over those two bars', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await drop(page, 'serum_killing_tidy.csv');
  await expect(modal(page).locator('#chart-kind')).toHaveValue('groupedBar');
  await sigSection(page).locator('xpath=..').getByRole('button', { name: '+ Add' }).click();
  const row = sigSection(page).locator('> div').first();
  const opts = await row.locator('select').first().locator('option').allInnerTexts();
  expect(opts).toEqual(expect.arrayContaining(['NHS', 'NHS · PA14', 'NHS · dlasR', 'HI-NHS', 'HI-NHS · PA14']));
  await row.locator('select').nth(0).selectOption({ label: 'NHS · PA14' });
  await row.locator('select').nth(1).selectOption({ label: 'NHS · dlasR' });
  await row.locator('input[type=text]').fill('p = 0.01');
  await apply(page);
  expect(await caption(page)).toContain('Brackets: p = 0.01 (NHS · PA14 vs NHS · dlasR)');
  // the bracket's ends are the two bars' centres, inside the NHS group
  const bars = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); const B = [];
    _chartDraw(el, { rect(x, y, w, h, f, s) { if (f && f !== '#ffffff' && h > 0 && w > 2 && s) B.push([x + w / 2, f]); }, poly() {}, circle() {}, line() {}, text() {} });
    const st = _chartStatsCached(el); return { B, cols: st.groups[0].bars.map(b => b.color) }; });
  const d = await bracketXs(page);
  expect(d.hz.length).toBe(1);
  const [x1, x2] = d.hz[0];
  const pa14 = bars.B.find(b => b[1] === bars.cols[0])[0], dlas = bars.B.find(b => b[1] === bars.cols[1])[0];
  expect(Math.abs(x1 - pa14)).toBeLessThan(1.5);
  expect(Math.abs(x2 - dlas)).toBeLessThan(1.5);
  const csv = await sourceData(page);
  expect(csv).toContain('# Significance mark "p = 0.01" between NHS · PA14 and NHS · dlasR');
  expect(errors).toEqual([]);
});

test('charts5-07: the bracket icon in Annotate & Draw adds a bracket to the chart in the grid, in its dialog — the figure stays a grid', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'serum_killing_tidy.csv');
  await apply(page);
  await page.evaluate(() => { const d = document.querySelector('details summary'); });
  await page.evaluate(() => insertIcon('bracket'));
  await expect(modal(page)).toBeVisible();
  await expect(sigSection(page).locator('> div')).toHaveCount(1);
  expect(await page.evaluate(() => layoutMode)).toBe('grid');
  expect(await page.evaluate(() => freeformElements.length)).toBe(0);
  expect(errors).toEqual([]);
});

// ── charts5-02 / 03 / 04, phage5-03: plate-reader exports as the reader wrote them ────
const status = page => modal(page).locator('#chart-delim-info').innerText();
const ticked = page => modal(page).locator('#chart-ycols input:checked').evaluateAll(b => b.map(x => x.parentElement.textContent.trim()));
const xs = page => page.evaluate(() => { const ch = _chartDraft; return ch.data.rows.map(r => r[ch.mapping.xCol]); });
for (const [file, extra] of [['tecan_OD600_cols.csv', ''], ['tecan_OD600_cols_padded.csv', ''], ['tecan_OD600_rows.csv', 'the wells ran down the rows: turned to one column per well'], ['tecan_OD600_rows_noheader.csv', 'the wells ran down the rows: turned to one column per well'], ['tecan_OD600_cols_noheader.csv', '']]) {
  test(`charts5-02/03/04: ${file} opens as a line of every well against Time (h), its header block skipped and said`, async ({ page }) => {
    const errors = await loadApp(page);
    await drop(page, file);
    await expect(modal(page).locator('#chart-kind')).toHaveValue('line');
    await expect(modal(page).locator('#chart-xcol option:checked')).toHaveText('Time (h)');
    await expect(modal(page).locator('#chart-xtitle')).toHaveValue('Time (h)');
    const t = await ticked(page);
    expect(t).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3']);   // no Cycle Nr., no temperature
    await expect(modal(page).locator('#chart-wells-wrap')).toContainText('Plate wells (12: A1–D3)');
    const st = await status(page);
    expect(st).toContain('Time [s] read as seconds, in hours (Time (h))');
    if (/noheader/.test(file)) expect(st).not.toContain('instrument line'); else expect(st).toContain('26 instrument lines above the table skipped (it starts at “Cycle Nr.”)');
    if (!/noheader/.test(file)) expect(st).toContain('1 line below it (“End Time”) left out');
    if (extra) expect(st).toContain(extra);
    // 49 reads, 0 to 12 h; the data box read again (any edit) does not divide the hours a second time
    let x = await xs(page);
    expect(x.length).toBe(49); expect(x[0]).toBe(0); expect(Math.abs(x[48] - 43200.4 / 3600)).toBeLessThan(1e-4);
    await page.evaluate(() => _chartReparse(false)); x = await xs(page);
    expect(Math.abs(x[48] - 43200.4 / 3600)).toBeLessThan(1e-4);
    await apply(page);
    expect(errors).toEqual([]);
  });
}

test('phage5-03: a Gen5 export with its 22-line instrument header opens exactly as the bare table does', async ({ page }) => {
  const errors = await loadApp(page);
  const pts = () => page.evaluate(() => { const el = images.filter(p => p && p.type === 'chart').pop(); el._chartKey = ''; const s = _chartStatsCached(el); return s.series.map(q => [q.key, q.points.map(p => [p.x, p.y])]); });
  await drop(page, 'Tq4_lysis_Gen5_20h_20261114.csv'); await apply(page);
  const bare = await pts();
  await drop(page, 'Tq4_lysis_Gen5_20h_with_header.csv');
  expect(await status(page)).toContain('22 instrument lines above the table skipped (it starts at “Time”)');
  await expect(modal(page).locator('#chart-wells-wrap')).toContainText('Plate wells (24: A1–F4)');
  await apply(page);
  const head = await pts();
  expect(head).toEqual(bare);
  expect(head.length).toBe(24);
  expect(errors).toEqual([]);
});

test('charts5-13: a Time (h) header is the X title as it stands', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'tecan_OD600_hours.csv');
  await expect(modal(page).locator('#chart-xtitle')).toHaveValue('Time (h)');
  expect(errors).toEqual([]);
});

// ── newcomer5-03, fluor5-08: numbered replicate columns are averaged, and say so ─────
test('fluor5-08: Culture1–3 are averaged into one bar per condition, mean ± SD matching the truth', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, 'psd95_puncta_per10um.csv');
  await expect(modal(page).locator('#chart-kind')).toHaveValue('bar');
  await expect(modal(page).locator('#chart-repcols')).toBeChecked();
  await apply(page);
  const g = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; const s = _chartStatsCached(el); return s.groups.map(q => [q.key, q.bars[0].value, q.bars[0].err, q.bars[0].n]); });
  const want = { shCtrl: [9.8, 10.04, 9.59], shNlgn1: [4.75, 4.92, 4.71], Rescue: [8.94, 9.91, 8.56] };
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length, sd = a => Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1));
  expect(g.map(q => q[0])).toEqual(Object.keys(want));
  g.forEach(([k, m, e, n]) => { expect(m).toBeCloseTo(mean(want[k]), 6); expect(e).toBeCloseTo(sd(want[k]), 6); expect(n).toBe(3); });
  expect(errors).toEqual([]);
});

test('newcomer5-03: replicate columns with images say "the mean of Rep 1, Rep 2, Rep 3", and the Y title comes from the file name', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { window.__toasts = []; const t = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; });
  await seedPanels(page, 2);
  await page.evaluate(T => addFiles([new File([T], 'swim_diameters_mm.csv', { type: 'text/csv' }), ...[0, 1].map(i => { const c = document.createElement('canvas'); c.width = c.height = 40; return new File([Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0))], `IMG_${i}.png`, { type: 'image/png' }); })]), read('swim_diameters_mm.csv'));
  await page.waitForFunction(() => images.some(p => p && p.type === 'chart'));
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => window.__toasts.join('\n'));
  expect(t).toContain('bar chart of the mean of Rep 1, Rep 2, Rep 3 by Strain');
  expect(await page.evaluate(() => images.find(p => p && p.type === 'chart').chart.axes.y.title)).toBe('swim diameters (mm)');
  expect(errors).toEqual([]);
});

// ── charts5-05: zeros on a log axis are averaged in, then drawn at the floor and said ──
test('charts5-05: on a log axis 0, 100, 0 is a mean of 33.3 with n = 3, and an all-zero time point is drawn at the floor, open, in the caption and source data', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await drop(page, 'timekill_zeros.csv');
  await modal(page).locator('#chart-ylog').check();
  await page.waitForTimeout(300);
  await apply(page);
  const s = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); el._chartKey = ''; return _chartStatsCached(el).series.map(q => ({ k: q.key, p: q.points.map(p => [p.x, p.y, p.n]) })); });
  const dm = s.find(q => q.k === 'dmexB').p;
  const at = x => dm.find(p => p[0] === x);
  expect(at(8)[1]).toBeCloseTo(100 / 3, 6); expect(at(8)[2]).toBe(3);
  expect(at(24)).toEqual([24, 0, 3]);
  // drawn: an open circle at the bottom of the plot for 24 h, and a note on the chart
  const d = await page.evaluate(() => { const el = images.find(p => p && p.type === 'chart'); const C = [], T = [], L = [];
    _chartDraw(el, { rect() {}, poly() {}, line(x1, y1, x2, y2) { L.push([x1, y1, x2, y2]); }, circle(x, y, r, f, s) { C.push({ x, y, f, s }); }, text(t) { T.push(String(t)); } });
    const axis = L.find(l => l[0] === l[2] && l[3] > l[1]); return { C, T, bottom: axis ? axis[3] : null }; });
  const open = d.C.filter(c => c.f === '#ffffff');
  expect(open.length).toBe(1);
  expect(Math.abs(open[0].y - d.bottom)).toBeLessThan(0.5);
  expect(d.T.some(t => /^○ 1 mean ≤ 0 drawn at the axis floor \(.+\), open$/.test(t))).toBe(true);
  expect(d.T.some(t => /omitted/.test(t))).toBe(false);
  const cap = await caption(page);
  expect(cap).toMatch(/On the log axis, 1 mean ≤ 0 is drawn at the axis floor \([^)]+\) as open marks; means and n include them\./);
  expect(cap).toContain('n = 3 per point');
  const csv = await sourceData(page);
  expect(csv).toMatch(/# Log axis: 1 mean ≤ 0 cannot be placed on it and is drawn at the axis floor \(y = [^)]+\) as open marks/);
  expect(csv).toContain("dmexB,8,3,33.333333333333336,"); expect(csv).toContain("dmexB,24,3,0,0,SD (n-1)");
  expect(errors).toEqual([]);
});
