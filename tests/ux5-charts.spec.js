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
