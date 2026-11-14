// @ts-check
// Usability round 1 — charts (data → plot). Each test follows a tester's finding
// (charts-NN, phage-NN, blot-NN): what they did, and what the chart now draws. Plotted
// numbers are read back from the chart's own geometry (the pass that writes the SVG)
// through its tick labels, and compared with the means and SDs of the data.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// ── Data the testers used (inlined so the spec stands alone) ──────────────────────
const CFU24 = `strain,replicate,cfu_per_ml
WT,1,2042807000
WT,2,1882351000
WT,3,1989097000
dfliC,1,339826000
dfliC,2,426089000
dfliC,3,333649000
dmotA,1,734064000
dmotA,2,744439000
dmotA,3,876163000
dfliC_pFliC,1,1364263000
dfliC_pFliC,2,1775327000
dfliC_pFliC,3,1951272000`;
const CFU24_UNITS = CFU24.replace('strain,replicate,cfu_per_ml\n', 'strain,replicate,CFU\n,,CFU/mL\n');
const CFU24_WIDE = `WT,dfliC,dmotA,dfliC_pFliC
2042807000,339826000,734064000,1364263000
1882351000,426089000,744439000,1775327000
1989097000,333649000,876163000,1951272000`;
const REPS_AS_ROWS = `time_h,WT,dfliC,dmotA,dfliC_pFliC
0,1058000,855000,1176000,1070000
0,826000,1176000,991000,1079000
0,1148000,1154000,967000,1083000
4,75032000,12743000,17601000,74359000
4,44047000,15495000,24992000,46504000
4,49639000,13721000,19393000,45606000
24,2042807000,339826000,734064000,1364263000
24,1882351000,426089000,744439000,1775327000
24,1989097000,333649000,876163000,1951272000`;
const MEAN_SD = `time_h,WT,WT_SD,dfliC,dfliC_SD,dmotA,dmotA_SD,dfliC_pFliC,dfliC_pFliC_SD
0,1010667,166136,1061667,179316,1044667,114369,1077333,6658
4,56239333,16513354,13986333,1395055,20662000,3855450,55489667,16347489
24,1971418333,81675782,366521333,51679484,784888667,79215927,1696954000,301250123`;
const LYSIS_WIDE = `time_min,MOI_0_rep1,MOI_0_rep2,MOI_0_rep3,MOI_1_rep1,MOI_1_rep2,MOI_1_rep3
0,0.044,0.078,0.065,0.024,0.046,0.031
10,0.057,0.081,0.052,0.060,0.037,0.053
20,0.055,0.078,0.080,0.067,0.086,0.070`;
const LYSIS_LONG = `time_min,MOI,replicate,OD600
0,0,1,0.044
0,0,2,0.078
0,0,3,0.065
0,1,1,0.024
0,1,2,0.046
0,1,3,0.031
10,0,1,0.057
10,0,2,0.081
10,0,3,0.052
10,1,1,0.060
10,1,2,0.037
10,1,3,0.053`;
const SWIM = `group,swim_diameter_mm
Untreated,46.0
Untreated,41.4
Untreated,39.5
Untreated,41.5
Untreated,31.9
Untreated,33.3
Untreated,34.1
Untreated,36.0
Phage-treated,29.8
Phage-treated,20.7
Phage-treated,24.4
Phage-treated,36.1
Phage-treated,24.5
Phage-treated,32.2
Phage-treated,20.5
Phage-treated,25.6`;
const EU = `Stamm;Ampicillin;OD600
;µg/mL;AU
WT;0;0,848
WT;0,25;0,86
WT;0,5;0,824
dfliC;0;0,862
dfliC;0,25;0,796
dfliC;0,5;0,801`;

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const close = (a, b, rel) => Math.abs(a - b) <= (rel || 0.005) * Math.abs(b);

// In the page: build a chart from CSV text the way a dropped file is read, record the
// geometry it draws, and read values back through its own y-axis tick labels.
const HELPERS = () => {
  window.__chart = (csv, over) => {
    const p = _parseDelimited(csv), ch = _defaultChart('bar');
    ch.data = { columns: p.columns, rows: p.rows, source: 'file', units: p.units };
    _chartApplyGuess(ch, _chartGuess(p), false);
    if (over) over(ch);
    return { type: 'chart', x: 0, y: 0, w: 420, h: 300, chart: ch };
  };
  window.__rec = (el) => {
    el._chartKey = ''; el._chartStat = null;
    const R = { texts: [], lines: [], rects: [], circles: [], polys: [] };
    _chartDraw(el, {
      rect(x, y, w, h, f) { R.rects.push({ x, y, w, h, f }); },
      line(x1, y1, x2, y2, s, w, d) { R.lines.push({ x1, y1, x2, y2, s, w, d: !!d }); },
      poly(p, s, f) { R.polys.push({ p, s, f }); },
      circle(cx, cy, r, f) { R.circles.push({ cx, cy, r, f }); },
      text(str, x, y, font, fill, align, base, rot) { R.texts.push({ str: String(str), x, y, align, base, rot: rot || 0, fill }); },
    });
    return R;
  };
  // "1.5×10^{9}" → 1.5e9, "10^{9}" → 1e9, "0.5" → 0.5
  window.__num = (s) => {
    let m = /^(-?[\d.]+)×10\^\{(-?\d+)\}$/.exec(s); if (m) return +m[1] * Math.pow(10, +m[2]);
    m = /^10\^\{(-?\d+)\}$/.exec(s); if (m) return Math.pow(10, +m[1]);
    return /^-?[\d.]+(e-?\d+)?$/.test(s) ? +s : NaN;
  };
  // The y-axis tick labels (right-aligned, middle baseline), and a y → value reader.
  window.__yAxis = (R) => {
    const t = R.texts.filter(t => t.align === 'right' && t.base === 'middle' && !t.rot).map(t => ({ y: t.y, v: __num(t.str), s: t.str }));
    const a = t[0], b = t[t.length - 1];
    const log = t.length > 2 && t.every(q => q.v > 0) && Math.abs((t[1].y - t[0].y) - (t[2].y - t[1].y)) < 0.01 && Math.abs(t[1].v / t[0].v - t[2].v / t[1].v) < 1e-6 && t[1].v / t[0].v !== 2;
    const f = log ? (y => Math.pow(10, Math.log10(a.v) + (y - a.y) / (b.y - a.y) * (Math.log10(b.v) - Math.log10(a.v))))
                  : (y => a.v + (y - a.y) / (b.y - a.y) * (b.v - a.v));
    return { ticks: t, log, value: f };
  };
};
async function setup(page) {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  return errors;
}
// Drop a CSV through the real file path and wait for the chart (and its dialog).
// Most tests drop onto the freeform canvas; the grid-panel tests at the end drop into the grid.
async function drop(page, csv, name, grid) {
  await page.evaluate(async ([csv, name, grid]) => {
    const sel = document.getElementById('layout-mode');
    if (!grid && layoutMode !== 'freeform') { sel.value = 'freeform'; setLayoutMode('freeform'); }
    addFiles([new File([csv], name, { type: 'text/csv' })]);
  }, [csv, name, !!grid]);
  await page.waitForFunction(() => _allCharts().length && document.getElementById('chart-modal').classList.contains('open'));
}

// ── charts-01 / charts-12 / charts-13: log Y on bar charts, decade ticks ─────────
test('charts-01/12/13: log Y works on Bar and Grouped bar — bars from the axis floor, decades labelled 10ⁿ, values exact', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(([csv, wide]) => {
    const el = __chart(csv, ch => { ch.axes.y.log = true; });
    const R = __rec(el), A = __yAxis(R);
    const bars = R.rects.filter(q => q.w > 12 && q.w < 300 && q.h > 0.5 && q.f !== '#ffffff');
    // Grouped: the reps-as-rows time course as grouped bars on log Y
    const g = __chart(wide, ch => { ch.kind = 'groupedBar'; ch.axes.y.log = true; });
    const G = __rec(g), GA = __yAxis(G);
    return { ticks: A.ticks.map(t => t.s), log: A.log, tops: bars.map(b => A.value(b.y)), bottoms: bars.map(b => b.y + b.h),
      floorY: Math.max(...A.ticks.map(t => t.y)), gTicks: GA.ticks.map(t => t.s), gLog: GA.log,
      gBars: G.rects.filter(q => q.w > 2 && q.w < 300 && q.h > 0.5 && q.f !== '#ffffff' && !(q.w === 10 && q.h === 10)).map(b => GA.value(b.y)) };
  }, [CFU24, REPS_AS_ROWS]);
  expect(r.log).toBe(true);
  expect(r.ticks).toEqual(['10^{8}', '10^{9}', '10^{10}']);              // whole decades, never 1e+9
  const truth = ['WT', 'dfliC', 'dmotA', 'dfliC_pFliC'].map(s => mean(CFU24.split('\n').slice(1).filter(l => l.startsWith(s + ',')).map(l => +l.split(',')[2])));
  r.tops.forEach((v, i) => expect(close(v, truth[i], 0.002)).toBe(true));
  r.bottoms.forEach(b => expect(Math.abs(b - r.floorY)).toBeLessThan(0.01));   // every bar rises from the 10⁸ floor
  expect(r.gLog).toBe(true);
  expect(r.gTicks[0]).toBe('10^{5}');
  // 0 h WT mean 1.01e6 — readable on the log axis (it was a 0.1 px sliver on the linear one)
  expect(close(r.gBars[0], 1010666.67, 0.003)).toBe(true);
  expect(errors).toEqual([]);
});

test('charts-13: beeswarm on log Y has decade ticks and its SD whisker stays inside the plot', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate((csv) => {
    const el = __chart(csv, ch => { ch.kind = 'beeswarm'; ch.axes.y.log = true; });
    const R = __rec(el), A = __yAxis(R);
    const yAxis = R.lines.find(l => l.x1 === l.x2 && l.x1 < 80 && l.y2 - l.y1 > 100);
    const vert = R.lines.filter(l => l.x1 === l.x2 && l.x1 > yAxis.x1 + 5);
    return { ticks: A.ticks.map(t => t.s), lowest: Math.max(...vert.map(l => Math.max(l.y1, l.y2))), axisBottom: yAxis.y2, axisTop: yAxis.y1 };
  }, CFU24);
  expect(r.ticks.length).toBeGreaterThanOrEqual(2);
  expect(r.ticks).toContain('10^{9}');
  expect(r.lowest).toBeLessThanOrEqual(r.axisBottom + 0.01);   // was 11 px below the x axis
  expect(errors).toEqual([]);
});

test('log axis is offered only where it means something: stacked bars say why', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24, 'cfu_24h_long.csv');
  await page.selectOption('#chart-kind', 'stackedBar');
  expect(await page.locator('#chart-ylog').isDisabled()).toBe(true);
  expect(await page.locator('#chart-ylog-lbl').getAttribute('title')).toMatch(/Stacked bars cannot be read on a log axis/);
  await page.selectOption('#chart-kind', 'bar');
  expect(await page.locator('#chart-ylog').isDisabled()).toBe(false);
  expect(await page.locator('#chart-xlog').isDisabled()).toBe(true);     // categories on x
  expect(errors).toEqual([]);
});

// ── charts-02: distinct, journal-style tick labels ────────────────────────────────
test('charts-02: linear ticks are all different and written 1.5×10⁹, in the chart and in the exported SVG', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async (csv) => {
    const el = __chart(csv);
    const A = __yAxis(__rec(el));
    const sel = document.getElementById('layout-mode'); sel.value = 'freeform'; setLayoutMode('freeform');
    freeformElements.length = 0; el.x = 40; el.y = 40; addFreeformElement(el); render();
    const cap = await _captureDownload(() => exportSVG('t', 96, document.getElementById('fig-canvas')));
    return { labels: A.ticks.map(t => t.s), svg: new TextDecoder().decode(cap.data) };
  }, CFU24);
  // WT's mean + SD (2.05×10⁹) runs past 2×10⁹, so the axis ends on the next tick
  expect(r.labels).toEqual(['0', '5×10^{8}', '1×10^{9}', '1.5×10^{9}', '2×10^{9}', '2.5×10^{9}']);
  expect(new Set(r.labels).size).toBe(r.labels.length);
  expect(r.svg).not.toMatch(/>\d(\.\d+)?e\+\d+</);       // no 2e+9 in the export
  expect(r.svg).toMatch(/1\.5×10<tspan[^>]*>9<\/tspan>/); // superscript exponent
  expect(errors).toEqual([]);
});

// ── charts-03/04/06, phage-01: line charts with error bars ───────────────────────
test('charts-03/04: a line through replicate rows is drawn through the means, with SD whiskers', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate((csv) => {
    const el = __chart(csv);
    const R = __rec(el), A = __yAxis(R), st = el._chartStat;
    const wt = st.series.find(s => s.name === 'WT'), col = wt.color;
    const poly = R.polys.find(p => p.s === col);
    const whisk = R.lines.filter(l => l.s === col && Math.abs(l.x1 - l.x2) < 1e-9);
    return { kind: el.chart.kind, error: el.chart.error, nPts: poly.p.length, ys: poly.p.map(q => A.value(q[1])),
      w24: whisk.map(l => [A.value(l.y1), A.value(l.y2)]).sort((a, b) => b[0] - a[0])[0] };
  }, REPS_AS_ROWS);
  expect(r.kind).toBe('line');
  expect(r.error).toBe('sd');
  expect(r.nPts).toBe(3);                                   // one point per time, not 9 zig-zagging
  const rows = REPS_AS_ROWS.split('\n').slice(1).map(l => l.split(',').map(Number));
  const wt24 = rows.filter(q => q[0] === 24).map(q => q[1]);
  expect(close(r.ys[2], mean(wt24), 0.003)).toBe(true);
  // the 24 h whisker spans mean − SD … mean + SD
  const lo = Math.min(...r.w24), hi = Math.max(...r.w24);
  expect(close(hi - lo, 2 * sd(wt24), 0.01)).toBe(true);
  expect(errors).toEqual([]);
});

test('phage-01: replicate columns (MOI_0_rep1…3) average into one series per MOI with SD bars', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, LYSIS_WIDE, 'phiMBA1_lysis_OD600_wide.csv');
  expect(await page.locator('#chart-repcols').isChecked()).toBe(true);
  expect(await page.locator('#chart-rep-note').textContent()).toContain('MOI_0: 3');
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const el = freeformElements.find(e => e.type === 'chart');
    const R = __rec(el), A = __yAxis(R), st = el._chartStat;
    const s0 = st.series[0];
    const wh = R.lines.filter(l => l.s === s0.color && Math.abs(l.x1 - l.x2) < 1e-9);
    return { names: st.series.map(s => s.name), kind: el.chart.kind, nWh: wh.length,
      first: wh.map(l => Math.abs(A.value(l.y1) - A.value(l.y2)) / 2)[0], err0: s0.points[0].err, n0: s0.points[0].n };
  });
  expect(r.kind).toBe('line');
  expect(r.names).toEqual(['MOI_0', 'MOI_1']);
  expect(r.n0).toBe(3);
  expect(r.err0).toBeCloseTo(sd([0.044, 0.078, 0.065]), 9);
  expect(r.nWh).toBeGreaterThanOrEqual(3);
  expect(close(r.first, sd([0.044, 0.078, 0.065]), 0.01)).toBe(true);
  expect(errors).toEqual([]);
});

test('charts-06: error bars from columns pair each series with its own SD column', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, MEAN_SD, 'cfu_timecourse_mean_sd.csv');
  expect(await page.locator('#chart-err').inputValue()).toBe('column');
  const picks = await page.$$eval('#chart-errcols select[data-yc]', ss => ss.map(s => [s.dataset.yc, s.options[s.selectedIndex].text]));
  expect(picks).toEqual([['1', 'WT_SD'], ['3', 'dfliC_SD'], ['5', 'dmotA_SD'], ['7', 'dfliC_pFliC_SD']]);
  // SD columns are error columns, not plotted series
  const ticked = await page.$$eval('#chart-ycols input:checked', cs => cs.map(c => c.parentElement.textContent.trim()));
  expect(ticked).toEqual(['WT', 'dfliC', 'dmotA', 'dfliC_pFliC']);
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const el = freeformElements.find(e => e.type === 'chart'), st = _chartStatsCached(el);
    return st.series.map(s => s.points.map(p => p.err));
  });
  expect(r[0][2]).toBe(81675782);      // WT 24 h
  expect(r[1][2]).toBe(51679484);      // dfliC 24 h — its own, not WT's
  expect(r[3][0]).toBe(6658);
  expect(errors).toEqual([]);
});

// ── charts-05 / phage-02: tidy data, a series column ──────────────────────────────
test('charts-05/phage-02: tidy rows get a series column — one averaged line per MOI', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, LYSIS_LONG, 'phiMBA1_lysis_OD600_long.csv');
  expect(await page.locator('#chart-series-wrap').isVisible()).toBe(true);
  expect(await page.$eval('#chart-seriescol', s => s.options[s.selectedIndex].text)).toBe('MOI');
  // the user can change it: none → one line through everything; back to MOI
  await page.selectOption('#chart-seriescol', '');
  await page.selectOption('#chart-seriescol', { label: 'MOI' });
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const st = _chartStatsCached(freeformElements.find(e => e.type === 'chart'));
    return st.series.map(s => ({ name: s.name, pts: s.points.map(p => [p.x, +p.y.toFixed(6), p.n]) }));
  });
  expect(r.map(s => s.name)).toEqual(['MOI 0', 'MOI 1']);
  expect(r[0].pts[0]).toEqual([0, +mean([0.044, 0.078, 0.065]).toFixed(6), 3]);
  expect(r[1].pts[1]).toEqual([10, +mean([0.060, 0.037, 0.053]).toFixed(6), 3]);
  expect(errors).toEqual([]);
});

// ── charts-07 / blot-17: the editor re-reads pasted data at once ─────────────────
test('charts-07/blot-17: pasting a new table updates columns, X and status before Apply; Apply plots it right', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24, 'cfu_24h_long.csv');
  await page.click('#chart-modal button.btn-primary');
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(freeformElements.findIndex(e => e.type === 'chart')); openChartModal(); });
  await page.selectOption('#chart-kind', 'line');
  await page.locator('#chart-data-ta').fill(REPS_AS_ROWS.replace(/,/g, '\t'));
  await page.waitForFunction(() => /5 columns · 9 rows/.test(document.getElementById('chart-delim-info').textContent));
  const ui = await page.evaluate(() => ({
    x: (s => s.options[s.selectedIndex].text)(document.getElementById('chart-xcol')),
    ys: [...document.querySelectorAll('#chart-ycols input:checked')].map(c => c.parentElement.textContent.trim()),
  }));
  expect(ui.x).toBe('time_h');
  expect(ui.ys).toEqual(['WT', 'dfliC', 'dmotA', 'dfliC_pFliC']);
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const el = freeformElements.find(e => e.type === 'chart'), st = _chartStatsCached(el);
    return { kind: el.chart.kind, x: el.chart.data.columns[el.chart.mapping.xCol], xs: st.series[0].points.map(p => p.x), n: st.series.length };
  });
  expect(r).toEqual({ kind: 'line', x: 'time_h', xs: [0, 4, 24], n: 4 });
  // blot-17: a 4-column table into Grouped bar plots all three numeric columns
  await page.evaluate(() => openChartModal());
  await page.selectOption('#chart-kind', 'groupedBar');
  await page.locator('#chart-data-ta').fill('Lane\tPhoA\tPhoB\tPstS\n1\t0.3\t0.5\t0.498\n2\t1\t1\t1');
  await page.locator('#chart-data-ta').blur();
  await page.click('#chart-modal button.btn-primary');
  const s2 = await page.evaluate(() => _chartStatsCached(freeformElements.find(e => e.type === 'chart')).seriesNames.map(s => s.name));
  expect(s2).toEqual(['PhoA', 'PhoB', 'PstS']);
  expect(errors).toEqual([]);
});

test('Cancel leaves a chart exactly as it was, even after ticking columns', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24, 'cfu_24h_long.csv');
  await page.click('#chart-modal button.btn-primary');
  const before = await page.evaluate(() => { selectedElems.clear(); selectedElems.add(freeformElements.findIndex(e => e.type === 'chart')); openChartModal(); return JSON.stringify(freeformElements.find(e => e.type === 'chart').chart); });
  await page.locator('#chart-ycols input').first().check();
  await page.selectOption('#chart-kind', 'line');
  await page.click('#chart-modal .modal-close');
  expect(await page.evaluate(() => JSON.stringify(freeformElements.find(e => e.type === 'chart').chart))).toBe(before);
  expect(errors).toEqual([]);
});

// ── charts-08 / phage-04: import defaults ────────────────────────────────────────
test('charts-08/phage-04: import picks Bar with the value column only, SD for replicates; numeric time → Line', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(([a, b]) => {
    const A = __chart(a).chart, B = __chart(b).chart;
    return { a: { kind: A.kind, y: A.mapping.yCols.map(i => A.data.columns[i]), err: A.error, pts: A.style.showPoints },
      b: { kind: B.kind, x: B.data.columns[B.mapping.xCol], err: B.error } };
  }, [CFU24, LYSIS_WIDE]);
  expect(r.a).toEqual({ kind: 'bar', y: ['cfu_per_ml'], err: 'sd', pts: true });   // replicate is an id, not a series
  expect(r.b).toEqual({ kind: 'line', x: 'time_min', err: 'sd' });
  expect(errors).toEqual([]);
});

// ── charts-10: Cancel on a new chart removes it ───────────────────────────────────
test('charts-10: Add line chart then Cancel adds nothing', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => { const s = document.getElementById('layout-mode'); s.value = 'freeform'; setLayoutMode('freeform'); addChartElement('line'); });
  expect(await page.evaluate(() => freeformElements.filter(e => e.type === 'chart').length)).toBe(1);
  await page.click('#chart-modal button:has-text("Cancel")');
  expect(await page.evaluate(() => freeformElements.filter(e => e.type === 'chart').length)).toBe(0);
  // Apply keeps it
  await page.evaluate(() => addChartElement('bar'));
  await page.click('#chart-modal button.btn-primary');
  expect(await page.evaluate(() => freeformElements.filter(e => e.type === 'chart').length)).toBe(1);
  expect(errors).toEqual([]);
});

// ── charts-14 / charts-34: axis limits, points inside the axes ──────────────────
test('charts-14/34: the auto axis holds every point; Y max clips with a note, never draws outside the plot', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate((csv) => {
    const el = __chart(csv);                             // bar + SD + points
    const R = __rec(el), A = __yAxis(R);
    const top = Math.min(...A.ticks.map(t => t.y));
    const auto = { topTick: A.ticks[A.ticks.length - 1].v, pointsAbove: R.circles.filter(c => c.cy < top - 0.01).length };
    el.chart.axes.y.max = 40;
    const R2 = __rec(el), A2 = __yAxis(R2), top2 = Math.min(...A2.ticks.map(t => t.y));
    return { auto, maxTick: A2.ticks[A2.ticks.length - 1].v, above: R2.circles.filter(c => c.cy < top2 - 0.01).length,
      note: R2.texts.map(t => t.str).find(s => /outside the axis range/.test(s)) || '' };
  }, SWIM);
  expect(r.auto.topTick).toBeGreaterThanOrEqual(46);        // 46.0 mm is inside (the axis used to end at 43)
  expect(r.auto.pointsAbove).toBe(0);
  expect(r.maxTick).toBe(40);
  expect(r.above).toBe(0);
  expect(r.note).toMatch(/^3 values outside the axis range not shown/);   // 46.0, 41.4, 41.5
  expect(errors).toEqual([]);
});

test('charts-14: the Y min / Y max fields set the axis from the dialog', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, SWIM, 'swim.csv');
  await page.fill('#chart-ymin', '0');
  await page.fill('#chart-ymax', '60');
  await page.click('#chart-modal button.btn-primary');
  const t = await page.evaluate(() => __yAxis(__rec(freeformElements.find(e => e.type === 'chart'))).ticks.map(q => q.v));
  expect(t[0]).toBe(0); expect(t[t.length - 1]).toBe(60);
  expect(errors).toEqual([]);
});

// ── charts-15 / 16 / 17: significance brackets ───────────────────────────────────
test('charts-15/16/17: brackets on beeswarm and box, full label text, above the highest point', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, SWIM, 'swim.csv');
  await page.click('#chart-modal button:has-text("+ Add")');
  const box = page.locator('#chart-sig-list input[type=text]').first();
  expect(+(await box.getAttribute('maxlength'))).toBeGreaterThanOrEqual(20);
  await box.fill('p = 0.0008');
  await page.selectOption('#chart-kind', 'beeswarm');
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const el = freeformElements.find(e => e.type === 'chart'), out = {};
    for (const k of ['beeswarm', 'box', 'violin', 'bar']) {
      el.chart.kind = k; if (k === 'bar') el.chart.style.showPoints = true;
      const R = __rec(el), t = R.texts.find(q => q.str === 'p = 0.0008');
      const yAxis = R.lines.find(l => l.x1 === l.x2 && l.y2 - l.y1 > 100);
      const bracket = t && R.lines.filter(l => l.y1 === l.y2 && l.y1 > t.y && l.y1 < t.y + 6 && Math.min(l.x1, l.x2) > yAxis.x1 + 2 && Math.abs(l.x2 - l.x1) > 20)[0];
      const px1 = Math.max(...R.lines.filter(l => l.y1 === l.y2 && Math.abs(l.x2 - l.x1) > 100).map(l => Math.max(l.x1, l.x2)));
      const dots = R.circles.filter(c => c.cx < px1);            // not the legend's
      out[k] = { drawn: !!t, bracketY: bracket ? bracket.y1 : null, highest: Math.min(...dots.map(c => c.cy - c.r), ...(k === 'box' || k === 'violin' ? [yAxis.y1] : [])) };
    }
    return out;
  });
  for (const k of ['beeswarm', 'box', 'violin', 'bar']) {
    expect(r[k].drawn, k).toBe(true);
    expect(r[k].bracketY, k).not.toBeNull();
  }
  expect(r.beeswarm.bracketY).toBeLessThan(r.beeswarm.highest);   // above the 46.0 mm dot
  expect(r.bar.bracketY).toBeLessThan(r.bar.highest);
  expect(errors).toEqual([]);
});

// ── charts-24 / charts-26: one colour per strain, names that keep it ────────────
test('charts-24/26: a colour set in one chart recolours every chart and the key; a rename keeps it', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24, 'a.csv');
  await page.click('#chart-modal button.btn-primary');
  await drop(page, REPS_AS_ROWS, 'b.csv').catch(() => {});
  await page.waitForFunction(() => freeformElements.filter(e => e.type === 'chart').length === 2);
  await page.click('#chart-modal button.btn-primary');
  // In chart b (the line chart) pick dfliC's colour and show it as ΔfliC
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(freeformElements.length - 1); openChartModal(); });
  const row = page.locator('#chart-names [data-key="dfliC"]');
  await row.locator('input[type=color]').evaluate((i) => { i.value = '#882255'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await row.locator('input[type=text]').fill('ΔfliC');
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const [a, b] = freeformElements.filter(e => e.type === 'chart');
    const sa = _chartStatsCached(a), sb = _chartStatsCached(b);
    const key = _figureKey().filter(k => k.kind === 'series');
    return { reg: _sampleColours(), aCol: sa.catColours ? sa.catColours.find(c => c.key === 'dfliC').color : null,
      bName: sb.series[1].name, bCol: sb.series[1].color, key: key.map(k => k.name + ' ' + k.color),
      list: _sampleColourNames().map(o => o.name + ' ' + o.color) };
  });
  expect(r.reg.dfliC).toBe('#882255');
  expect(r.aCol).toBe('#882255');                 // the bar chart's dfliC follows
  expect(r.bName).toBe('ΔfliC');                  // shown under its new name …
  expect(r.bCol).toBe('#882255');                 // … in the same colour
  expect(r.key).toContain('ΔfliC #882255');
  expect(r.key).toContain('dfliC #882255');
  expect(r.list).toContain('dfliC #882255');
  // Look › Sample colours: change it there, every chart follows; undo puts it back
  const r2 = await page.evaluate(() => {
    setSampleColour('dfliC', '#117733');
    const after = freeformElements.filter(e => e.type === 'chart').map(e => { const s = _chartStatsCached(e); return (s.catColours || s.series).find(x => x.key === 'dfliC').color; });
    undo();
    const undone = _sampleColours().dfliC;
    const ses = serializeSession(true);
    return { after, undone, savedNames: ses.freeformElements.find(e => e.type === 'chart' && e.chart.names && e.chart.names.dfliC).chart.names.dfliC,
      savedReg: JSON.stringify(ses).includes('#882255') };
  });
  expect(r2.after).toEqual(['#117733', '#117733']);
  expect(r2.undone).toBe('#882255');
  expect(r2.savedNames).toBe('ΔfliC');
  expect(r2.savedReg).toBe(true);
  expect(errors).toEqual([]);
});

test('charts-25: the props-bar Color swatch, a no-op for charts, is not shown for them', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24, 'a.csv');
  await page.click('#chart-modal button.btn-primary');
  expect(await page.locator('#ep-color').isVisible()).toBe(false);
  expect(errors).toEqual([]);
});

// ── charts-37: European CSV, units row ──────────────────────────────────────────
test('charts-37: semicolons with decimal commas are numbers, and a units row goes into the axis titles', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(([eu, un]) => {
    const p = _parseDelimited(eu), q = _parseDelimited(un);
    const A = __chart(eu).chart, B = __chart(un).chart, sb = _chartStats({ chart: B, w: 300, h: 200 });
    return { rows: p.rows.slice(0, 2), units: p.units, dc: p.decimalComma, titles: [A.axes.x.title, A.axes.y.title],
      series: A.mapping.seriesCol, y: A.data.columns[A.mapping.yCols[0]], cats: sb.categories, bTitle: B.axes.y.title, qRows: q.rows.length };
  }, [EU, CFU24_UNITS]);
  expect(r.rows).toEqual([['WT', 0, 0.848], ['WT', 0.25, 0.86]]);
  expect(r.units).toEqual(['', 'µg/mL', 'AU']);
  expect(r.dc).toBe(10);
  expect(r.y).toBe('OD600');                      // OD600 is plotted, not the concentration
  expect(r.titles).toEqual(['Ampicillin (µg/mL)', 'OD600 (AU)']);
  expect(r.series).toBe(0);                       // Stamm is the series
  expect(r.qRows).toBe(12);                       // the CFU/mL row is not data …
  expect(r.cats).toEqual(['WT', 'dfliC', 'dmotA', 'dfliC_pFliC']);   // … and no empty category
  expect(r.bTitle).toBe('CFU (CFU/mL)');
  expect(errors).toEqual([]);
});

// ── charts-38: wide format, one column per group ────────────────────────────────
test('charts-38: a table with one column per strain plots each column as a group (explicit layout control)', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24_WIDE, 'cfu_24h_wide.csv');
  expect(await page.locator('#chart-layout').inputValue()).toBe('columns');
  expect(await page.locator('#chart-xcol-wrap').isVisible()).toBe(false);
  await page.selectOption('#chart-kind', 'box');
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const el = freeformElements.find(e => e.type === 'chart'), st = _chartStatsCached(el);
    el.chart.kind = 'bar'; el._chartKey = '';
    const sb = _chartStatsCached(el);
    return { cats: st.categories, n: st.boxes.map(b => b.n), barMeans: sb.groups.map(g => g.bars[0].value), barSd: sb.groups.map(g => g.bars[0].err) };
  });
  expect(r.cats).toEqual(['WT', 'dfliC', 'dmotA', 'dfliC_pFliC']);
  expect(r.n).toEqual([3, 3, 3, 3]);
  const cols = [0, 1, 2, 3].map(i => CFU24_WIDE.split('\n').slice(1).map(l => +l.split(',')[i]));
  r.barMeans.forEach((m, i) => expect(close(m, mean(cols[i]), 1e-9)).toBe(true));
  r.barSd.forEach((s, i) => expect(close(s, sd(cols[i]), 1e-9)).toBe(true));
  expect(errors).toEqual([]);
});

// ── phage-32 / charts-44: legend glyphs, notes clear of the axis title ──────────
test('phage-32/charts-44: a line legend shows line + marker; the log ≤0 note sits clear of the x title', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate((csv) => {
    const el = __chart(csv, ch => { ch.style.showPoints = true; ch.style.showLegend = true; ch.axes.x.log = true; ch.axes.x.title = 'Ampicillin'; ch.kind = 'scatter'; });
    const rows = [[0, 0.85, 0.86], [0.25, 0.86, 0.80], [0.5, 0.82, 0.80], [1, 0.8, 0.7], [32, 0.05, 0.04]];
    el.chart.data = { columns: ['amp', 'WT', 'dfliC'], rows, source: 't' };
    el.chart.mapping = { xCol: 0, yCols: [1, 2] }; el.chart.error = 'none';
    const R = __rec(el);
    const title = R.texts.find(t => t.str === 'Ampicillin'), note = R.texts.find(t => /omitted \(log axis\)/.test(t.str));
    el.chart.kind = 'line'; el.chart.axes.x.log = false;
    const L = __rec(el);
    const legendText = L.texts.find(t => t.str === 'WT' && t.align === 'left');
    const legendLine = L.lines.find(l => l.y1 === l.y2 && Math.abs(l.y1 - legendText.y) < 10 && l.x2 < legendText.x && legendText.x - l.x1 < 30);
    const legendRect = L.rects.find(q => q.w === q.h && q.w < 16 && q.x > legendText.x - 30 && q.x < legendText.x);
    return { gap: note.y - title.y, xTicks: R.texts.filter(t => t.align === 'center' && t.base === 'alphabetic' && t.y > 200).map(t => t.str), legendLine: !!legendLine, legendRect: !!legendRect };
  }, LYSIS_WIDE);
  expect(r.gap).toBeGreaterThanOrEqual(9);        // on its own line (it overlapped the title)
  expect(r.legendLine).toBe(true);
  expect(r.legendRect).toBe(false);
  expect(errors).toEqual([]);
});

// ── charts-36: source data names and plotted values ─────────────────────────────
test('charts-36: source data are named once (.csv) and carry the plotted mean, SD and n', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, CFU24, 'cfu_24h_long.csv');
  await page.click('#chart-modal button.btn-primary');
  const zip = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportSubmissionPackage());
    const b = cap.data, dv = new DataView(b.buffer, b.byteOffset); let p = 0, out = '';
    while (p + 30 <= b.length && dv.getUint32(p, true) === 0x04034b50) {
      const cs = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true), d0 = p + 30 + nl + el;
      let d = b.subarray(d0, d0 + cs);
      if (dv.getUint16(p + 8, true) === 8) d = new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out += '@@' + new TextDecoder().decode(b.subarray(p + 30, p + 30 + nl)) + '\n' + new TextDecoder().decode(d) + '\n';
      p = d0 + cs;
    }
    return out;
  });
  expect(zip).toContain('@@source-data/cfu_24h_long.csv\n');
  expect(zip).not.toContain('.csv.csv');
  const wt = zip.split('\n').find(l => l.startsWith('cfu_per_ml,WT,3,'));
  expect(wt).toBeTruthy();
  const [, , n, m, e, kind] = wt.split(',');
  expect(+n).toBe(3);
  expect(close(+m, 1971418333.33, 1e-6)).toBe(true);
  expect(close(+e, 81675782, 1e-5)).toBe(true);
  expect(kind).toBe('SD (n-1)');
  expect(errors).toEqual([]);
});

// ── blot-01: densitometry → chart, linked ───────────────────────────────────────
const GEL = () => {
  window.__gelMake = (spec) => {
    const W = spec.w, H = spec.h, vals = new Float64Array(W * H);
    let seed = 11; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let sg = 0; const x = i + 0.5, y = j + 0.5;
      for (const L of spec.lanes) if (x >= L.x0 && x < L.x1) for (const b of L.bands) sg += b.amp * Math.exp(-((y - b.y) ** 2) / (2 * b.s * b.s));
      vals[j * W + i] = Math.max(0, Math.min(255, Math.round(spec.bg - sg + (rnd() - 0.5) * 2)));
    }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let k = 0; k < W * H; k++) { id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = vals[k]; id.data[k * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    const src = c.toDataURL('image/png');
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, spec.name); render(); res(); }; img.src = src; });
  };
};
test('blot-01: “Chart these values” adds a linked grid chart panel of the normalised lanes, and says when it is out of date', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(GEL);
  const mk = (amps, name) => ({ w: 400, h: 120, bg: 228, name, lanes: amps.map((a, k) => ({ x0: 30 + 90 * k, x1: 80 + 90 * k, bands: [{ y: 60, s: 3, amp: a }] })) });
  await page.evaluate(async ([t, l]) => { await __gelMake(t); await __gelMake(l); runGelAnalysis(0); gelSetLoading(0, 1); gelSetRefLane(0, 0); },
    [mk([40, 80, 80, 120], 'target.png'), mk([30, 60, 30, 45], 'actin.png')]);
  await page.evaluate(() => openGelAnalysis(0));
  await page.click('#gel-modal-bg button:has-text("Chart these values")');
  const r = await page.evaluate(() => {
    const el = images.find(p => p.type === 'chart'), ch = el.chart;
    const st = _chartStatsCached(el);
    return { title: ch.axes.y.title, caption: ch.caption, cats: st.categories, vals: st.groups.map(g => g.bars[0].value), link: !!ch.link,
      dialog: !!document.getElementById('gel-modal-bg'), mode: layoutMode, panels: images.length, ff: freeformElements.length };
  });
  expect(r.dialog).toBe(false);
  expect(r.mode).toBe('grid');                  // the blots stay in view
  expect(r.panels).toBe(3);                     // a third panel beside the two blots
  expect(r.ff).toBe(0);
  expect(r.title).toBe('Band volume ÷ the loading control, relative to lane 1');
  expect(r.caption).toMatch(/largest quantifiable band in each lane/);
  expect(r.cats).toEqual(['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4']);
  [1, 1, 2, 2].forEach((v, i) => expect(Math.abs(r.vals[i] - v) / v).toBeLessThan(0.1));   // 40/30 : 80/60 : 80/30 : 120/45
  expect(r.link).toBe(true);
  // A re-analysis (a new reference lane) updates the chart panel in the same undo step
  const r2 = await page.evaluate(() => {
    gelSetRefLane(0, 2);
    const v = _chartStatsCached(images.find(p => p.type === 'chart')).groups.map(g => g.bars[0].value);
    undo(); const back = _chartStatsCached(images.find(p => p.type === 'chart')).groups.map(g => g.bars[0].value);
    return { v, back };
  });
  [0.5, 0.5, 1, 1].forEach((v, i) => expect(Math.abs(r2.v[i] - v) / v).toBeLessThan(0.1));
  [1, 1, 2, 2].forEach((v, i) => expect(Math.abs(r2.back[i] - v) / v).toBeLessThan(0.1));
  // A re-crop it cannot follow: the chart says so on the figure and in its editor
  await page.evaluate(() => { images[0].cropL = 30; render(); openDataPanelEditor(images.findIndex(p => p.type === 'chart')); });
  expect(await page.locator('#chart-link-note').textContent()).toMatch(/has changed since/);
  expect(await page.locator('#chart-link-note button').textContent()).toMatch(/Update from densitometry/);
  const note = await page.evaluate(() => __rec(images.find(p => p.type === 'chart')).texts.some(t => /out of date with the densitometry/.test(t.str)));
  expect(note).toBe(true);
  expect(errors).toEqual([]);
});

// ── Grid chart panels: the same dialog, the same plotting, every export ─────────
test('grid: a CSV dropped in the grid is a chart panel with the guessed mapping, edited through the same draft dialog', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, LYSIS_WIDE, 'lysis.csv', true);
  const before = await page.evaluate(() => ({ mode: layoutMode, ff: freeformElements.length, im: images.filter(p => p.type === 'chart').length }));
  expect(before).toEqual({ mode: 'grid', ff: 0, im: 1 });
  expect(await page.locator('#chart-repcols').isChecked()).toBe(true);
  await page.fill('#chart-ymax', '0.2');
  await page.check('#chart-ylog');
  // Cancel on an imported panel keeps it, unchanged
  await page.click('#chart-modal button:has-text("Cancel")');
  const c = await page.evaluate(() => { const im = images.find(p => p.type === 'chart'); return { n: images.length, log: !!im.chart.axes.y.log, max: im.chart.axes.y.max }; });
  expect(c).toEqual({ n: 1, log: false, max: null });
  // Edit again by the panel editor, apply: the panel's stats follow
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p.type === 'chart')));
  await page.check('#chart-ylog');
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(() => {
    const im = images.find(p => p.type === 'chart'); im._chartKey = '';
    const A = __yAxis(__rec(im)), st = _chartStatsCached(im);
    return { log: A.log, ticks: A.ticks.map(t => t.s), series: st.series.map(s => s.name), err0: st.series[0].points[0].err };
  });
  expect(r.series).toEqual(['MOI_0', 'MOI_1']);
  expect(r.err0).toBeCloseTo(sd([0.044, 0.078, 0.065]), 9);
  expect(r.ticks).toContain('0.1');
  expect(errors).toEqual([]);
});

test('grid: Cancel on a chart just added from the menu removes the panel; Apply keeps it', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => addChartElement('line'));
  expect(await page.evaluate(() => images.filter(p => p.type === 'chart').length)).toBe(1);
  await page.click('#chart-modal button:has-text("Cancel")');
  expect(await page.evaluate(() => ({ n: images.length, mode: layoutMode }))).toEqual({ n: 0, mode: 'grid' });
  await page.evaluate(() => addChartElement('bar'));
  await page.click('#chart-modal button.btn-primary');
  expect(await page.evaluate(() => images.filter(p => p.type === 'chart').length)).toBe(1);
  expect(errors).toEqual([]);
});

test('grid: names & colours, brackets, limits and error bars on a chart panel reach the SVG (vector) and the PNG at export dpi', async ({ page }) => {
  const errors = await setup(page);
  await drop(page, SWIM, 'swim.csv', true);
  await page.click('#chart-modal button:has-text("+ Add")');
  await page.locator('#chart-sig-list input[type=text]').first().fill('p = 0.0008');
  const row = page.locator('#chart-names [data-key="Untreated"]');
  await row.locator('input[type=text]').fill('Control');
  await row.locator('input[type=color]').evaluate((i) => { i.value = '#882255'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#chart-ymax', '45');
  await page.click('#chart-modal button.btn-primary');
  const r = await page.evaluate(async () => {
    const im = images.find(p => p.type === 'chart'), st = _chartStatsCached(im);
    const cap = await _captureDownload(() => exportSVG('t', 96, document.getElementById('fig-canvas')));
    const svg = new TextDecoder().decode(cap.data);
    sv('export-dpi', '300');
    const png = await _captureDownload(() => doExport('png'));
    const d = png.data, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    return { cats: st.categories, col: st.groups[0].bars[0].color, reg: _sampleColours().Untreated, key: _figureKey().map(k => k.name + ' ' + k.color),
      svgCtrl: svg.includes('>Control<'), svgSig: svg.includes('p = 0.0008'), svgNote: /1 value outside the axis range not shown/.test(svg), svgClip: /<clipPath id="flclip/.test(svg),
      pngW: dv.getUint32(16), canvasW: canvasLogicalW };
  });
  expect(r.cats).toEqual(['Control', 'Phage-treated']);
  expect(r.col).toBe('#882255');
  expect(r.reg).toBe('#882255');
  expect(r.key).toContain('Control #882255');
  expect(r.svgCtrl).toBe(true);
  expect(r.svgSig).toBe(true);
  expect(r.svgNote).toBe(true);           // 46.0 mm past Y max 45, counted on the figure
  expect(r.svgClip).toBe(true);           // drawn inside the plot box, as vector
  expect(r.pngW).toBe(Math.round(r.canvasW * 300 / 96));
  expect(errors).toEqual([]);
});
