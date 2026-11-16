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
