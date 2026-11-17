// Verifies docs/guides/charts.md through the visible UI: six CSV layouts dropped into a grid
// become chart panels; error bars, log Y, axis limits, a significance bracket, Names & colours,
// Look › Sample colours and a lab style, Typography, the SVG and the source data in the
// submission package. The plotted means and SDs are checked against the generated truth.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { step, expect, btn } = L;

// ---- inputs and their truth --------------------------------------------------------------
const CSV = {
  'cfu_24h.csv': 'strain,replicate,cfu_per_ml\nWT,1,1.9e9\nWT,2,2.0e9\nWT,3,2.02e9\ndfliC,1,8.1e8\ndfliC,2,7.6e8\ndfliC,3,8.4e8\ndmotA,1,1.2e9\ndmotA,2,1.1e9\ndmotA,3,1.3e9\n',
  'lysis_replicates.csv': 'time_min,MOI_0_r1,MOI_0_r2,MOI_0_r3,MOI_1_r1,MOI_1_r2,MOI_1_r3\n0,0.10,0.11,0.12,0.10,0.11,0.12\n30,0.20,0.22,0.24,0.18,0.20,0.22\n60,0.40,0.44,0.48,0.25,0.30,0.35\n90,0.70,0.75,0.80,0.15,0.20,0.25\n120,0.95,1.00,1.05,0.05,0.08,0.11\n',
  'lysis_tidy.csv': 'time_min,MOI,replicate,OD600\n' + [[0, [0.10, 0.11, 0.12], [0.10, 0.11, 0.12]], [60, [0.40, 0.44, 0.48], [0.25, 0.30, 0.35]], [120, [0.95, 1.00, 1.05], [0.05, 0.08, 0.11]]]
    .map(([t, a, b]) => a.map((v, i) => `${t},0,${i + 1},${v}`).concat(b.map((v, i) => `${t},1,${i + 1},${v}`)).join('\n')).join('\n') + '\n',
  'lysis_mean_sd.csv': 'time_min,MOI 0 mean,MOI 0 SD,MOI 1 mean,MOI 1 SD\n0,0.11,0.01,0.11,0.01\n60,0.44,0.04,0.30,0.05\n120,1.00,0.05,0.08,0.03\n',
  'swim_wide.csv': 'Untreated,Phage-treated\n36.1,26.0\n38.5,27.9\n41.2,24.8\n35.9,28.1\n38.1,26.8\n',
  'swim_semicolon.csv': 'Stamm;Durchmesser\n;mm\nWT;12,5\nWT;13,1\nWT;12,8\ndfliC;3,2\ndfliC;3,6\ndfliC;3,4\n',
  // a tidy German file: strain, replicate number, value, a units row and decimal commas
  'biofilm_de.csv': 'Stamm;Replikat;Biofilm\n;;A550\nWT;1;1,20\nWT;2;1,31\nWT;3;1,25\nΔpelA;1;0,40\nΔpelA;2;0,38\nΔpelA;3;0,45\n',
  // ux3 (charts3-01): a tidy table with two text columns (antibiotic × strain), MICs from 0.03 to 2
  'mic_tidy.csv': 'antibiotic,strain,replicate,MIC_ug_per_ml\n' + [['tobramycin', { PA14: [0.5, 1, 1], dlasR: [0.5, 0.5, 0.5], dmexB: [0.125, 0.25, 0.25] }],
    ['ciprofloxacin', { PA14: [0.06, 0.125, 0.125], dlasR: [0.03, 0.06, 0.06], dmexB: [1, 2, 2] }]]
    .flatMap(([a, o]) => Object.entries(o).flatMap(([st, v]) => v.map((x, i) => `${a},${st},${i + 1},${x}`))).join('\n') + '\n',
  // several files at once
  'growth_A.csv': 'strain,replicate,OD600\nWT,1,1.10\nWT,2,1.20\nWT,3,1.15\nKO,1,0.60\nKO,2,0.55\nKO,3,0.65\n',
  'growth_B.csv': 'strain,replicate,OD600\nWT,1,0.90\nWT,2,0.95\nWT,3,1.00\nKO,1,0.40\nKO,2,0.45\nKO,3,0.35\n',
  // two text columns besides the x: the guess cannot place the medium
  'mic_media.csv': 'antibiotic,strain,medium,MIC\n' + ['LB', 'M9'].flatMap(md => ['PA14', 'dlasR'].flatMap(st => ['tobramycin', 'ciprofloxacin'].map((a, k) => `${a},${st},${md},${k + 1 + (md === 'M9' ? 2 : 0)}`))).join('\n') + '\n',
};
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const TRUTH = {
  A: { WT: [1.9e9, 2.0e9, 2.02e9], dfliC: [8.1e8, 7.6e8, 8.4e8], dmotA: [1.2e9, 1.1e9, 1.3e9] },
  B: { 'MOI_0@60': [0.40, 0.44, 0.48], 'MOI_1@120': [0.05, 0.08, 0.11] },
  E: { Untreated: [36.1, 38.5, 41.2, 35.9, 38.1], 'Phage-treated': [26.0, 27.9, 24.8, 28.1, 26.8] },
  F: { WT: [12.5, 13.1, 12.8], dfliC: [3.2, 3.6, 3.4] },
  MIC: { 'tobramycin|PA14': [0.5, 1, 1], 'tobramycin|dlasR': [0.5, 0.5, 0.5], 'tobramycin|dmexB': [0.125, 0.25, 0.25],
    'ciprofloxacin|PA14': [0.06, 0.125, 0.125], 'ciprofloxacin|dlasR': [0.03, 0.06, 0.06], 'ciprofloxacin|dmexB': [1, 2, 2] },
};

(async () => {
  const T = await L.start('charts');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');
  const file = n => { const f = path.join(inp, n); fs.writeFileSync(f, CSV[n]); return f; };
  const chart = p.locator('#chart-modal');
  const dropZone = () => p.getByText('Drop or click to add images');
  const apply = async () => { await chart.getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(500); };
  const draft = () => chart.evaluate(m => ({
    kind: m.querySelector('#chart-kind').selectedOptions[0].text,
    layout: m.querySelector('#chart-layout').selectedOptions[0].text,
    x: (m.querySelector('#chart-xcol').selectedOptions[0] || {}).text,
    series: (m.querySelector('#chart-seriescol').selectedOptions[0] || {}).text,
    err: m.querySelector('#chart-err').selectedOptions[0].text,
    ycols: [...m.querySelectorAll('#chart-ycols label')].filter(l => l.querySelector('input').checked).map(l => l.innerText.trim()),
    rep: m.querySelector('#chart-rep-wrap').offsetParent ? m.querySelector('#chart-rep-wrap').innerText.trim() + (m.querySelector('#chart-repcols').checked ? ' [ticked]' : ' [unticked]') : '',
    errcols: [...m.querySelectorAll('#chart-errcols select')].map(s => s.selectedOptions[0].text),
    status: (m.innerText.match(/\d+ columns · [^\n]*/) || [''])[0],
    ytitle: m.querySelector('#chart-ytitle').value,
  }));
  const charts = () => p.evaluate(() => images.filter(Boolean).map(im => ({ type: im.type, label: im.label, name: im.name })));
  // Screen point at the centre of a panel, from the panel's place in the drawn figure.
  const panelPoint = async (label) => p.evaluate((label) => {
    const idx = images.findIndex(im => im && im.label === label);
    const b = panelBounds.find(q => q.idx === idx);
    const c = document.getElementById('fig-canvas'); const r = c.getBoundingClientRect();
    const s = r.width / (c.width / (window.devicePixelRatio || 1));
    return { x: r.x + (b.x + b.w / 2) * s, y: r.y + (b.y + b.h / 2) * s };
  }, label);
  const importCsv = async (name) => {
    await L.pickFiles(T, dropZone(), [file(name)]);
    await chart.waitFor({ state: 'visible', timeout: 8000 });
    await p.waitForTimeout(400);
    return draft();
  };

  await step(T, 'Setup: dismiss the tip bubble', async () => {
    const g = p.getByRole('button', { name: 'Got it' });
    if (await g.count()) await g.first().click().catch(() => {});
  });

  // ---- Task 1: tidy table → bar chart panel ----------------------------------------------
  // ux3 (charts3-19, newcomer3-11): the chart is panel A as soon as the file is dropped (that
  // toast); Apply says "Chart updated". The Y title starts as the value column's name.
  await step(T, 'T1.1 Drop or click to add images → a tidy CSV is chart panel A at once and opens the Chart dialog with a guessed mapping; Y title is the value column', async () => {
    await L.toasts(T);
    const d = await importCsv('cfu_24h.csv');
    const t = await L.toasts(T);
    expect(d.kind === 'Bar' && d.x === 'strain' && d.ycols.join() === 'cfu_per_ml' && d.err === 'SD (n−1)' && d.ytitle === 'cfu_per_ml', JSON.stringify(d));
    expect(/Imported 9 rows from cfu_24h\.csv — chart panel A in the grid/.test(t), 'toast: ' + t);
    expect(await chart.locator('#chart-points').isChecked(), 'points not ticked');
    return `toast "${t}"; ${d.status}; ${d.kind}, X ${d.x}, Y ${d.ycols}, error bars ${d.err}, Y title "${d.ytitle}"`;
  });
  await step(T, 'T1.2 Y title and log Y, Apply ("Chart updated") → lettered chart panel A in the grid', async () => {
    await chart.locator('#chart-ytitle').fill('CFU/mL');
    await chart.getByLabel('log Y').check();
    await apply();
    const t = await L.toasts(T);
    const c = await charts();
    expect(c.length === 1 && c[0].type === 'chart' && c[0].label === 'A', JSON.stringify(c));
    expect(/Chart updated/.test(t), 'toast: ' + t);
    expect(await p.locator('#layout-mode').inputValue() === 'grid', 'figure left the grid');
    return 'toast "' + t + '"';
  });

  // ---- Task 2: replicate columns → line with SD --------------------------------------------
  await step(T, 'T2 Replicate columns: Line, "Average replicate columns into one series each" ticked, SD', async () => {
    const d = await importCsv('lysis_replicates.csv');
    expect(d.kind === 'Line' && /Average replicate columns into one series each \(MOI_0: 3, MOI_1: 3\) \[ticked\]/.test(d.rep) && d.err === 'SD (n−1)', JSON.stringify(d));
    await chart.locator('#chart-xtitle').fill('Time (min)');
    await chart.locator('#chart-ytitle').fill('OD_{600}');
    await apply();
    return d.rep;
  });

  // ---- Task 3: tidy rows with a series column ---------------------------------------------
  await step(T, 'T3 Tidy rows with a Series (group) column: one averaged line per MOI', async () => {
    const d = await importCsv('lysis_tidy.csv');
    expect(d.kind === 'Line' && d.x === 'time_min' && d.series === 'MOI' && d.ycols.join() === 'OD600', JSON.stringify(d));
    expect(!(await chart.locator('#chart-layout').isVisible()), 'Data layout shown for a line chart');
    await apply();
    return `X ${d.x}, Series ${d.series}, Y ${d.ycols}; no Data layout field for Line`;
  });
  await step(T, 'T3b Box, violin and beeswarm with a Series column draw each series side by side; Error bars sets the beeswarm whisker', async () => {
    const pt = await panelPoint('C');
    await p.mouse.dblclick(pt.x, pt.y);
    await chart.waitFor({ state: 'visible' });
    await chart.locator('#chart-kind').selectOption({ label: 'Beeswarm (dots)' });
    const got = [];
    for (const [lab, want] of [['SEM (SD/√n)', 'sem'], ['SD (n−1)', 'sd']]) {
      await chart.locator('#chart-err').selectOption({ label: lab }); await p.waitForTimeout(300);
      const st = await p.evaluate(() => { const s = _chartStats({ chart: _chartDraft, w: 300, h: 200 }); return { n: s.boxes.length, kinds: [...new Set(s.boxes.map(b => b.errKind))], series: [...new Set(s.boxes.map(b => b.name))] }; });
      expect(st.n === 6 && st.kinds.join() === want && st.series.length === 2, JSON.stringify(st));
      got.push(`${lab}: ${st.n} clouds (${st.series.join(', ')} side by side at each time), whisker ${want}`);
    }
    // ux3 (charts3-02, charts3-20): a beeswarm draws its mean as a short line, and the caption says so
    const cap = await p.evaluate(() => _dataCaption({ type: 'chart', name: 'lysis_tidy.csv', chart: _chartDraft }));
    expect(/the line marks the mean, whiskers ± SD/.test(cap), 'caption: ' + cap);
    got.push('caption "' + cap + '"');
    for (const k of ['Box & whisker', 'Violin']) {
      await chart.locator('#chart-kind').selectOption({ label: k }); await p.waitForTimeout(300);
      const st = await p.evaluate(() => { const s = _chartStats({ chart: _chartDraft, w: 300, h: 200 }); return { n: s.boxes.length, series: [...new Set(s.boxes.map(b => b.name))] }; });
      expect(st.n === 6 && st.series.length === 2, k + ' ' + JSON.stringify(st));
      got.push(`${k}: ${st.n} boxes`);
    }
    await chart.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(300);
    expect(await p.evaluate(() => images.find(im => im && im.label === 'C').chart.kind) === 'line', 'Cancel did not keep the line chart');
    return got.join('; ');
  });

  // ---- Task 4: mean and SD columns --------------------------------------------------------
  await step(T, 'T4 Mean + SD columns: Error bars › from a column, each series paired with its SD column', async () => {
    const d = await importCsv('lysis_mean_sd.csv');
    expect(d.err === 'from a column' && d.ycols.join('|') === 'MOI 0 mean|MOI 1 mean' && d.errcols.join('|') === 'MOI 0 SD|MOI 1 SD', JSON.stringify(d));
    await apply();
    return 'pickers: ' + d.errcols.join(', ');
  });

  // ---- Task 5: wide table, one column per group, bracket -------------------------------------
  await step(T, 'T5.1 Wide table: guessed as Bar with Data layout › Columns, both groups ticked, SD and points', async () => {
    const d0 = await importCsv('swim_wide.csv');
    const lbl = await chart.locator('#chart-ycols-lbl').innerText();
    expect(d0.kind === 'Bar' && /^Columns/.test(d0.layout) && d0.ycols.join('|') === 'Untreated|Phage-treated' && d0.err === 'SD (n−1)' && lbl === 'Group columns (each is one group)', JSON.stringify(d0));
    expect(await chart.locator('#chart-points').isChecked(), 'points not ticked');
    await chart.locator('#chart-ytitle').fill('Swim diameter (mm)');
    return `guessed: ${d0.kind}, ${d0.layout}, ${lbl}: ${d0.ycols.join(', ')}`;
  });
  await step(T, 'T5.2 Significance brackets › + Add: Untreated – Phage-treated, label "p = 0.0008 (Welch t-test)"', async () => {
    const sec = chart.locator('.sec-lbl', { hasText: 'Significance brackets' }).locator('xpath=..');
    await sec.getByRole('button', { name: '+ Add' }).click();
    const sels = sec.locator('select');
    await sels.nth(0).selectOption({ label: 'Untreated' });
    await sels.nth(1).selectOption({ label: 'Phage-treated' });
    const box = sec.locator('input[type=text]');
    expect(await box.getAttribute('maxlength') === '40', 'label limit is not 40');
    await box.fill('p = 0.0008 (Welch t-test)');
    await p.waitForTimeout(200);
    expect(/25\/40/.test(await sec.innerText()), 'no 25/40 counter: ' + (await sec.innerText()).replace(/\s+/g, ' '));
    await p.waitForTimeout(3300);   // let the import toast fade before the screenshot
    await L.shot(T, 'charts-dialog', chart.locator('xpath=./*[1]'), { doc: true });
    await apply();
  });

  // ---- Task 6: semicolons, decimal commas, units row -----------------------------------------
  await step(T, 'T6 Semicolon CSV with decimal commas and a units row: numbers, and the unit in the Y title', async () => {
    const d = await importCsv('swim_semicolon.csv');
    expect(/units row: Durchmesser mm/.test(d.status) && d.ytitle === 'Durchmesser (mm)' && d.kind === 'Bar', JSON.stringify(d));
    await apply();
    return d.status + '; Y title "' + d.ytitle + '"';
  });

  await step(T, 'T6b A tidy German file (Stamm;Replikat;Biofilm) is guessed as a bar per strain; Cancel takes the just-dropped chart away', async () => {
    const n0 = (await charts()).length, rows0 = await p.evaluate(() => rows.value);
    const d = await importCsv('biofilm_de.csv');
    expect(d.kind === 'Bar' && d.x === 'Stamm' && d.series === '— none —' && d.ycols.join() === 'Biofilm' && d.err === 'SD (n−1)' && d.ytitle === 'Biofilm (A550)', JSON.stringify(d));
    await L.toasts(T);
    await chart.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(400);
    const t = await L.toasts(T);
    const n1 = (await charts()).length, rows1 = await p.evaluate(() => rows.value);
    expect(n1 === n0 && rows1 === rows0 && /Cancelled — the chart was not added/.test(t), `${n0} → ${n1} panels, rows ${rows0} → ${rows1}, toast ${t}`);
    return `${d.kind}, X ${d.x}, Y ${d.ycols}, ${d.err}, Y title "${d.ytitle}"; Cancel: "${t}", ${n1} panels`;
  });

  await step(T, 'Six chart panels A–F, still a grid', async () => {
    const c = await charts();
    expect(c.length === 6 && c.every(x => x.type === 'chart') && c.map(x => x.label).join('') === 'ABCDEF', JSON.stringify(c));
  });

  // ---- Editing: three ways in, axis limits, Cancel -------------------------------------------
  await step(T, 'E1 Right-click a chart panel › 📊 Edit chart…; Y max 0.8 shows "1 value outside the axis range not shown"', async () => {
    const pt = await panelPoint('B');
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    await p.locator('div:visible', { hasText: /^📊\s+Edit chart…$/ }).last().click();
    await chart.waitFor({ state: 'visible' });
    await chart.locator('#chart-ymax').fill('0.8');
    await p.waitForTimeout(600);
    // The note is drawn inside the preview picture; read it from the dialog's preview state.
    const note = await chart.evaluate(m => { const t = m.innerText; return /outside the axis range/.test(t) ? 'in text' : ''; });
    const drawn = await p.evaluate(() => typeof _chartDraft === 'object' && _chartDraft && JSON.stringify(_chartDraft).includes('0.8'));
    expect(drawn, 'Y max not in the draft');
    await L.shot(T, 'E1-ymax-preview', chart.locator('canvas, svg').first());
    return note || 'note checked by eye in out/charts/shots/E1-ymax-preview.png';
  });
  await step(T, 'E2 Cancel leaves the chart exactly as it was', async () => {
    const before = await p.evaluate(() => JSON.stringify(images.find(im => im && im.label === 'B').chart));
    await chart.getByRole('button', { name: 'Cancel' }).click();
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => JSON.stringify(images.find(im => im && im.label === 'B').chart));
    expect(before === after && !/"yMax":0\.8|"ymax":0\.8/.test(after), 'chart changed after Cancel');
  });
  await step(T, 'E3 ⚙ › 📊 Edit chart data and style… opens the same dialog; Y max 0.8 → Apply', async () => {
    const row = p.locator('#img-list > *').nth(1);
    await row.locator('button', { hasText: '⚙' }).click();
    await btn(T, '📊 Edit chart data and style…').click();
    await chart.waitFor({ state: 'visible' });
    await chart.locator('#chart-ymax').fill('0.8');
    await apply();
    await row.locator('button', { hasText: '⚙' }).click();   // close the settings again
  });
  await step(T, 'E4 Double-click a chart panel opens the dialog; Stacked bar greys out log Y and says why', async () => {
    const pt = await panelPoint('A');
    await p.mouse.dblclick(pt.x, pt.y);
    await chart.waitFor({ state: 'visible' });
    await chart.locator('#chart-kind').selectOption({ label: 'Stacked bar' });
    await p.waitForTimeout(300);
    const why = await chart.locator('#chart-log-why').innerText();
    expect(await chart.locator('#chart-ylog').isDisabled() && /Stacked bars cannot be read on a log axis/.test(why), why);
    await chart.locator('#chart-kind').selectOption({ label: 'Bar' });
    return why;
  });

  // ---- Names & colours --------------------------------------------------------------------
  // Colours and shown names as each chart draws them, by data name.
  const drawn = (label) => p.evaluate((label) => { const el = images.find(im => im && im.label === label); const s = _chartStats({ chart: el.chart, w: 300, h: 200 }); return Object.fromEntries(s.catColours.map(c => [c.key, { name: c.name, color: c.color }])); }, label);
  await step(T, 'N0 Names & colours ↑: moving dfliC left keeps every colour', async () => {
    const before = await drawn('A');
    const names = chart.locator('#chart-names');
    await names.locator('[data-key="dfliC"] button', { hasText: '↑' }).click(); await p.waitForTimeout(300);
    const order = await names.locator('[data-key]').evaluateAll(r => r.map(e => e.dataset.key));
    expect(order.join() === 'dfliC,WT,dmotA', order.join());
    const after = await p.evaluate(() => { const s = _chartStats({ chart: _chartDraft, w: 300, h: 200 }); return Object.fromEntries(s.catColours.map(c => [c.key, { name: c.name, color: c.color }])); });
    const moved = Object.keys(before).filter(k => before[k].color !== after[k].color);
    expect(!moved.length, 'colour changed for ' + moved.join(', '));
    return `order ${order.join(', ')}; colours ${Object.entries(after).map(([k, v]) => k + ' ' + v.color).join(', ')}`;
  });
  await step(T, 'N1 Names & colours: WT swatch → blue, dfliC shown as Δ*fliC*, Apply: the name also shows in panel F', async () => {
    const names = chart.locator('#chart-names');
    // A colour input opens the system picker; set its value the way the picker does.
    await names.locator('[data-key="WT"] input[type=color]').evaluate(el => { el.value = '#0072b2'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    const shown = names.locator('input[placeholder="shown as dfliC"]');
    await shown.click(); await shown.fill('Δ*fliC*');
    await p.waitForTimeout(300);
    await L.toasts(T);
    await apply();
    const t = await L.toasts(T, { all: true });
    expect(/Chart updated — the new name also shows in panel F/.test(t), 'toast: ' + t.split(' | ').slice(-2).join(' | '));
    const f = await drawn('F'), a = await drawn('A');
    expect(f.dfliC.name === 'Δ*fliC*' && f.dfliC.color === a.dfliC.color && a.WT.color === '#0072b2' && f.WT.color === '#0072b2', JSON.stringify({ a, f }));
    const row = await p.locator('#sample-colours-list [data-name="WT"]').getAttribute('data-name').catch(() => null);
    expect(row === 'WT', 'WT not in Look › Sample colours');
    return 'toast "' + t.split(' | ').filter(x => /new name/.test(x)).pop() + '"; panel F shows Δ*fliC* in ' + f.dfliC.color;
  });
  await step(T, 'N2 The key text follows: WT blue, ΔfliC by its shown name', async () => {
    await L.openSection(T, 'Export');
    const key = await p.evaluate(() => document.getElementById('key-text') ? document.getElementById('key-text').value || document.getElementById('key-text').textContent : '');
    expect(/WT \(blue, filled bars\)/.test(key) && (key.match(/ΔfliC/g) || []).length === 1, key);
    return key.slice(0, 160) + '…';
  });
  await step(T, 'N3 MOI_0 (panel B) and "MOI 0 mean" (panel D) share one colour and one key row; shown as "MOI 0" in B the row reads MOI 0', async () => {
    await L.openSection(T, 'Export');
    const keyText = () => p.evaluate(() => document.getElementById('key-text').value);
    const k0 = await keyText();
    // ux4: one sample written two ways in one colour is one key row already (charts4-03)
    const c0 = (k0.match(/MOI_0 \(([^)]*)\)/) || [])[1], c1 = c0;
    expect(c0 && !/MOI 0 \(/.test(k0), 'before: ' + k0);
    const pt = await panelPoint('B');
    await p.mouse.dblclick(pt.x, pt.y);
    await chart.waitFor({ state: 'visible' });
    await chart.locator('#chart-names input[placeholder="shown as MOI_0"]').fill('MOI 0');
    await p.waitForTimeout(300);
    await apply();
    const k1 = await keyText();
    expect(!/MOI_0/.test(k1) && (k1.match(/MOI 0 \(/g) || []).length === 1, 'after: ' + k1);
    // the chart made from "… mean" columns has its own shown-as box, filled in without " mean"
    const ptD = await panelPoint('D');
    await p.mouse.dblclick(ptD.x, ptD.y);
    await chart.waitFor({ state: 'visible' });
    const dBox = await chart.locator('#chart-names input[placeholder="shown as MOI 0 mean"]').inputValue();
    await chart.getByRole('button', { name: 'Cancel' }).click(); await p.waitForTimeout(300);
    expect(dBox === 'MOI 0', 'panel D shown as: ' + dBox);
    return `before: one row MOI_0 (${c0}); after: ${(k1.match(/MOI 0 \([^)]*\)/) || [''])[0]} once; panel D's own box reads "${dBox}"`;
  });

  // ---- Look › Sample colours, lab style -----------------------------------------------------
  let styleFile;
  await step(T, 'S0 Look › Sample colours lists each sample by its shown name, with the data names behind it in brackets', async () => {
    await L.openSection(T, 'Look');
    const rows = await p.evaluate(() => [...document.querySelectorAll('#sample-colours-list [data-name]')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    expect(rows.some(r => /^ΔfliC \(dfliC\)/.test(r)) && rows.some(r => /^MOI 0 \(MOI_0, MOI 0 mean\)/.test(r)) && rows.some(r => /^WT ×/.test(r)), rows.join(' | '));
    return rows.join(' | ');
  });
  await step(T, 'S1 Look › Sample colours › ⬇ Save as paper_style.json writes every sample colour, palette ones too', async () => {
    await L.openSection(T, 'Look');
    await L.toasts(T);
    styleFile = await L.download(T, () => btn(T, '⬇ Save as paper_style.json').click(), /paper_style\.json$/);
    const js = JSON.parse(fs.readFileSync(styleFile, 'utf8'));
    const pal = js.settings.sample_palette;
    const t = await L.toasts(T);
    expect(pal.WT.toLowerCase() === '#0072b2' && pal.dmotA && pal.dfliC && pal.Untreated && /paper_style\.json saved with \d+ sample colours \(1 set by hand, \d+ from the palette[^)]*; sample_palette and \d+ shown-as names? \(sample_names\)\)/.test(t), JSON.stringify(js) + ' | ' + t);
    // ux3 (charts3-10): the counts are of samples, so they add up
    const [, n, hand, pl] = t.match(/saved with (\d+) sample colours \((\d+) set by hand, (\d+) from the palette/);
    expect(+n === +hand + +pl, 'counts do not add up: ' + t);
    // ux4: the shown-as names go with the colours (sample_names), under their data names
    expect(js.settings.sample_names && js.settings.sample_names.dfliC === 'Δ*fliC*', 'no shown-as names in the file: ' + JSON.stringify(js.settings));
    const h = p.locator('.sec-lbl', { hasText: /^Sample colours/i });
    await h.scrollIntoViewIfNeeded();
    const b1 = await h.boundingBox(), b2 = await btn(T, '⬇ Save as paper_style.json').boundingBox();
    await L.shot(T, 'charts-sample-colours', { x: b1.x - 6, y: b1.y - 6, width: 296, height: b2.y + b2.height - b1.y + 12 }, { doc: true });
    return `${Object.keys(pal).length} names; toast "${t}"`;
  });
  await step(T, 'S2 × beside WT puts it back on the palette', async () => {
    await p.locator('#sample-colours-list [data-name="WT"] button', { hasText: '×' }).click();
    await p.waitForTimeout(400);
    const wt = await p.evaluate(() => { const r = document.querySelector('#sample-colours-list [data-name="WT"]'); return r ? r.innerText : '(row gone)'; });
    expect(!/×/.test(wt), wt);
    return 'WT row now: ' + wt.replace(/\s+/g, ' ');
  });
  await step(T, 'S3 📄 Load lab style (paper_style.json)… sets every named colour and the font, and replaces the whole list', async () => {
    // A colour picked in the Look list first: the loaded file replaces it.
    await p.locator('#sample-colours-list [data-name="Untreated"] input[type=color]').evaluate(el => { el.value = '#d55e00'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);
    const pre = await p.evaluate(() => document.querySelector('#sample-colours-list [data-name="Untreated"]').innerText);
    expect(/×/.test(pre), 'Untreated colour not set from the Look list');
    const f = path.join(inp, 'lab_paper_style.json');
    fs.writeFileSync(f, JSON.stringify({ app: 'CFU Plot Studio', settings: { sample_palette: { WT: '#000000', dfliC: '#cc79a7', dmotA: '#009e73' }, font_family: 'Arial' } }));
    await L.pickFiles(T, p.getByText('📄 Load lab style (paper_style.json)…'), [f]);
    await p.waitForTimeout(800);
    const title = await p.locator('#im-title').innerText().catch(() => '');
    // each row: the name shown, and the data names behind it (dfliC is shown as Δ*fliC*)
    const list = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#sample-colours-list [data-name]')].flatMap(r => [r.dataset.name, ...JSON.parse(r.dataset.keys || '[]')].map(k => [k, r.querySelector('input').value]))));
    await p.keyboard.press('Escape');
    expect(list.dfliC === '#cc79a7' && list.dmotA === '#009e73' && /Arial/.test(await p.locator('#label-font').inputValue()), JSON.stringify(list));
    const untreated = await p.evaluate(() => document.querySelector('#sample-colours-list [data-name="Untreated"]').innerText);
    expect(/palette/.test(untreated), 'Untreated kept its hand-picked colour: ' + untreated);
    const rowsAfter = await p.evaluate(() => [...document.querySelectorAll('#sample-colours-list [data-name]')].map(r => r.innerText.replace(/\s+/g, ' ').trim()).join(' | '));
    return title + ' — dfliC ' + list.dfliC + ', dmotA ' + list.dmotA + '; rows: ' + rowsAfter;
  });

  // ---- Typography ------------------------------------------------------------------------
  await step(T, 'Y1 Look › Typography › Text size 7 pt', async () => {
    await p.locator('#label-font').selectOption({ label: 'Arial' });
    await p.locator('#text-pt').fill('7'); await p.locator('#text-pt').press('Tab');
    await p.waitForTimeout(400);
  });

  let svgFile;
  await step(T, 'Y2 ↓ SVG: chart text is Arial, tick labels 7 pt at the printed size, bracket label kept', async () => {
    const r = await L.exportVia(T, 'SVG', { name: 'Fig2_charts' });
    svgFile = r.file;
    const s = fs.readFileSync(svgFile, 'utf8');
    const head = s.match(/<svg[^>]*width="([\d.]+)in"[^>]*viewBox="0 0 ([\d.]+)/);
    const ptPerUnit = (+head[1] * 72) / +head[2];
    const fams = [...new Set([...s.matchAll(/font-family="([^"]*)"/g)].map(m => m[1]))];
    const sizes = [...s.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>(\d[\d.]*)<\/text>/g)].map(m => +m[1] * ptPerUnit);
    const tick = sizes.length ? Math.min(...sizes) : 0;
    expect(fams.every(f => /^Arial/.test(f)), 'fonts: ' + fams);
    expect(Math.abs(tick - 7) < 0.15, 'tick label size ' + tick.toFixed(2) + ' pt');
    expect(s.includes('p = 0.0008 (Welch t-test)'), 'bracket label missing');
    return `fonts ${fams.join(' / ')}; tick labels ${tick.toFixed(2)} pt`;
  });

  await step(T, 'Y3 Check › ✓ Check journal compliance: the Text size row measures chart text, superscripts at their printed size', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const row = ((await rep.innerText()).match(/Text size\n([^\n]*)/) || [])[1] || '';
    await p.keyboard.press('Escape');
    expect(/charts/.test(row) && /Superscripts and subscripts print at 70%/.test(row), row);
    return row.slice(0, 400);
  });

  // ux3 (charts3-06): superscripts under 5 pt get a "Text to N pt" button on the row
  await step(T, 'Y3b The Text size row\'s "Text to 7.5 pt" button raises Text size so the 10⁸ superscripts reach 5 pt', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const b = rep.locator('button', { hasText: /^Text to [\d.]+ pt/ }).first();
    const label = (await b.innerText()).trim();
    await b.click(); await p.waitForTimeout(800);
    if (!(await rep.isVisible())) { await btn(T, '✓ Check journal compliance').click(); await rep.waitFor({ state: 'visible' }); }
    const row = ((await rep.innerText()).match(/Text size\n([^\n]*)/) || [])[1] || '';
    await p.keyboard.press('Escape');
    const pt = await p.locator('#text-pt').inputValue();
    expect(label === 'Text to 7.5 pt' && pt === '7.5' && !/below 5 pt/.test(row), `${label} → ${pt} pt; row: ${row}`);
    return `"${label}" → Text size ${pt} pt; row: ${row.slice(0, 160)}`;
  });

  // ---- Source data -----------------------------------------------------------------------
  await step(T, 'D1 📦 Export submission package (ZIP) carries source-data/<letter>.csv with the plotted mean, SD, n', async () => {
    await L.openSection(T, 'Export');
    const zip = await L.download(T, () => btn(T, '📦 Export submission package (ZIP)').click(), /submission-package\.zip$/, 120000);
    const names = L.zipList(zip);
    const src = names.filter(n => /^source-data\//.test(n));
    expect(src.length === 6, 'source data: ' + src.join(', '));
    const plotted = (letter) => {
      const t = L.zipRead(zip, `source-data/${letter}.csv`).toString('utf8');
      const part = t.split(/# Plotted values[^\n]*\n/)[1];
      const [hdr, ...rows] = part.trim().split('\n');
      const H = hdr.split(',');
      return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [H[i], v])));
    };
    const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    const bad = [];
    for (const r of plotted('A')) { const key = r.category === 'Δ*fliC*' ? 'dfliC' : r.category; const tr = TRUTH.A[key]; if (!tr || !close(+r.mean, mean(tr)) || !close(+r.error, sd(tr)) || +r.n !== 3) bad.push('A ' + JSON.stringify(r)); }
    for (const r of plotted('B')) { const tr = TRUTH.B[`${r.series}@${r.x}`]; if (tr && (!close(+r.mean, mean(tr)) || !close(+r.error, sd(tr)))) bad.push('B ' + JSON.stringify(r)); }
    for (const r of plotted('E')) { const tr = TRUTH.E[r.category]; if (!tr || !close(+r.mean, mean(tr)) || !close(+r.error, sd(tr)) || +r.n !== 5) bad.push('E ' + JSON.stringify(r)); }
    for (const r of plotted('F')) { const tr = TRUTH.F[r.category]; if (!tr || !close(+r.mean, mean(tr)) || !close(+r.error, sd(tr))) bad.push('F ' + JSON.stringify(r)); }
    // series: the data's name ("MOI 1 mean"); series_shown_as: the name the chart shows ("MOI 1")
    const D = plotted('D'); if (!D.some(r => r.series === 'MOI 1 mean' && r.series_shown_as === 'MOI 1' && r.x === '60' && +r.error === 0.05 && r.error_type === 'from a column')) bad.push('D pairing');
    if (!plotted('A').some(r => r.category === 'dfliC' && r.category_shown_as === 'ΔfliC')) bad.push('A: dfliC not written with its shown name ΔfliC');
    const fRaw = L.zipRead(zip, 'source-data/F.csv').toString('utf8').split(/# Plotted values/)[0];
    if (!/WT,12\.5/.test(fRaw) || /12,5/.test(fRaw)) bad.push('F: decimal commas not written as points: ' + fRaw.replace(/\n/g, ' / '));
    expect(!bad.length, bad.join('; '));
    return `${src.length} source-data CSVs; means and SDs match the truth (A WT ${(mean(TRUTH.A.WT) / 1e9).toFixed(4)}e9 ± ${(sd(TRUTH.A.WT) / 1e7).toFixed(3)}e7, E Untreated ${mean(TRUTH.E.Untreated).toFixed(2)} ± ${sd(TRUTH.E.Untreated).toFixed(3)}, F decimal commas ${mean(TRUTH.F.WT).toFixed(1)})`;
  });

  await step(T, 'Screenshot: the six chart panels', async () => {
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(600);
    const g = p.getByText('Got it', { exact: true });
    if (await g.count()) await g.first().click().catch(() => {});
    await p.keyboard.press('Escape');   // deselect the panel
    await p.waitForTimeout(3500);   // let the last toast fade
    await L.shot(T, 'charts-figure', p.locator('#fig-canvas'), { doc: true });
  });

  // ---- ⌘K Add bar chart and Cancel ---------------------------------------------------------
  await step(T, 'K1 ⌘K "add bar chart" → Enter adds a chart panel; Cancel removes it again and the grid keeps its size', async () => {
    const n0 = (await charts()).length, g0 = await p.evaluate(() => cols.value + '×' + rows.value);
    const hits = await L.cmdk(T, 'add bar chart');
    expect(/^Add bar chart/.test(hits[0]), 'top hit ' + hits[0]);
    await chart.waitFor({ state: 'visible' });
    const n1 = (await charts()).length;
    await chart.getByRole('button', { name: 'Cancel' }).click();
    await p.waitForTimeout(400);
    const n2 = (await charts()).length;
    const g2 = await p.evaluate(() => cols.value + '×' + rows.value);
    expect(n1 === n0 + 1 && n2 === n0 && g2 === g0, `${n0} → ${n1} → ${n2}, grid ${g0} → ${g2}`);
    return `${n0} → ${n1} → ${n2} panels; grid ${g0} → ${g2}`;
  });

  // ---- Source data read back ---------------------------------------------------------------
  await step(T, 'D2 source-data/A.csv from the package, dropped back in, charts the same means and SDs', async () => {
    const zip = T.downloads.filter(f => /submission-package\.zip$/.test(f)).pop();
    const back = path.join(inp, 'A_source-data.csv');
    fs.writeFileSync(back, L.zipRead(zip, 'source-data/A.csv'));
    await L.toasts(T);
    await L.pickFiles(T, dropZone(), [back]);
    await chart.waitFor({ state: 'visible', timeout: 8000 }); await p.waitForTimeout(400);
    const d = await draft();
    await apply();
    const t = await L.toasts(T);
    expect(/2 comment lines \(#\) over the table skipped; the “Plotted values” block below it left out/.test(t), 'toast: ' + t);
    const rowsP = await p.evaluate(() => _chartPlotted(images.filter(Boolean).slice(-1)[0]).rows.map(r => ({ k: r.xkey, mean: r.mean, err: r.err, n: r.n })));
    const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    const bad = rowsP.filter(r => { const tr = TRUTH.A[r.k]; return !tr || !close(r.mean, mean(tr)) || !close(r.err, sd(tr)) || r.n !== 3; });
    expect(d.kind === 'Bar' && d.x === 'strain' && rowsP.length === 3 && !bad.length, JSON.stringify({ d, rowsP }));
    return `${d.kind}, X ${d.x}, Y ${d.ycols}; toast "${t.split(' | ').find(x => /Imported/.test(x))}"`;
  });

  // ---- ux3: brackets that share a group stack ----------------------------------------------
  await step(T, 'T5.3 Two brackets sharing a group (A: 1st–2nd and 2nd–3rd) → Apply: drawn at two heights (checked in the SVG, X1)', async () => {
    const pt = await panelPoint('A');
    await p.mouse.dblclick(pt.x, pt.y);
    await chart.waitFor({ state: 'visible' });
    const sec = chart.locator('.sec-lbl', { hasText: 'Significance brackets' }).locator('xpath=..');
    for (const [a, b, lab] of [[0, 1, 'p = 0.011'], [1, 2, 'p = 0.022']]) {
      await sec.getByRole('button', { name: '+ Add' }).click(); await p.waitForTimeout(200);
      const row = sec.locator('input[type=text]').last().locator('xpath=..');
      const sels = row.locator('select');
      await sels.nth(0).selectOption({ index: a });
      await sels.nth(1).selectOption({ index: b });
      await row.locator('input[type=text]').fill(lab);
    }
    await p.waitForTimeout(300);
    await apply();
    const annos = await p.evaluate(() => images.find(im => im && im.label === 'A').chart.annos.map(a => [a.a, a.b, a.text]));
    expect(annos.length === 2 && annos[0][1] === annos[1][0], JSON.stringify(annos));
    return JSON.stringify(annos);
  });

  // ---- ux3: tidy with two text columns → grouped bar, series from the second -------------------
  await step(T, 'T7 Tidy table with two text columns (antibiotic, strain): Grouped bar, X antibiotic, Series strain; Series none names what it averages; log Y', async () => {
    const d = await importCsv('mic_tidy.csv');
    expect(d.kind === 'Grouped bar' && d.x === 'antibiotic' && d.series === 'strain' && d.ycols.join() === 'MIC_ug_per_ml' && d.ytitle === 'MIC_ug_per_ml' && !/not used/.test(d.status), JSON.stringify(d));
    await chart.locator('#chart-seriescol').selectOption({ label: '— none —' }); await p.waitForTimeout(300);
    const pooled = await chart.locator('#chart-delim-info').innerText();
    expect(/⚠ strain not used: 3 strain values \(PA14, dlasR, dmexB\) averaged together per group — pick strain as Series to show them apart/.test(pooled), pooled);
    await chart.locator('#chart-seriescol').selectOption({ label: 'strain' }); await p.waitForTimeout(300);
    await chart.locator('#chart-ytitle').fill('MIC (µg/mL)');
    await chart.getByLabel('log Y').check();
    await apply();
    const c = (await charts()).pop();
    expect(c.type === 'chart' && c.name === 'mic_tidy.csv', JSON.stringify(c));
    return `${d.status}; guessed ${d.kind}, X ${d.x}, Series ${d.series}, Y title "${d.ytitle}"; with Series none: "${pooled.split(' · ').pop()}"; panel ${c.label}`;
  });

  // ---- ux3: several files at once ------------------------------------------------------------
  await step(T, 'T8a Two CSVs picked at once: each becomes a chart panel; the dialog opens on the last one', async () => {
    const n0 = (await charts()).length;
    await L.toasts(T);
    await L.pickFiles(T, dropZone(), [file('growth_A.csv'), file('growth_B.csv')]);
    await chart.waitFor({ state: 'visible', timeout: 8000 }); await p.waitForTimeout(500);
    const d = await draft();
    const t = await L.toasts(T);
    expect(/growth_B\.csv/.test(d.status) && /growth_A\.csv — chart panel \w in the grid/.test(t) && /growth_B\.csv — chart panel \w in the grid/.test(t), d.status + ' | ' + t);
    await apply();
    const n1 = (await charts()).length;
    expect(n1 === n0 + 2, `${n0} → ${n1}`);
    return `toasts "${t}"; dialog: ${d.status}`;
  });
  await step(T, 'T8b An image and a CSV picked together: the toast says what the chart was guessed as; the dialog opens when the guess averaged a text column together', async () => {
    const img = await L.canvasImage(T, path.join(inp, 'plate.png'), 240, 180, (c, w, h) => { c.fillStyle = '#d8d0b0'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a6a40'; c.beginPath(); c.arc(w / 2, h / 2, 60, 0, 7); c.fill(); });
    await L.toasts(T);
    await L.pickFiles(T, dropZone(), [img, file('mic_media.csv')]);
    await p.waitForTimeout(1200);
    const t = await L.toasts(T);
    const open = await chart.isVisible();
    const info = open ? await chart.locator('#chart-delim-info').innerText() : '';
    expect(/1 image and 1 chart added to the grid as panels — \w: grouped bar chart of MIC by antibiotic and strain\. Check this chart: \w — medium not used \(2 values averaged together\)/.test(t) && open && /⚠ medium not used: 2 medium values \(LB, M9\) averaged together per group/.test(info), t + ' | dialog ' + open + ' ' + info);
    await apply();
    return `toast "${t.split(' | ').pop()}"; dialog: "${info.split(' · ').pop()}"`;
  });

  // ---- ux3: captions describe what each chart draws ---------------------------------------
  await step(T, 'C1 Export › ✦ Generate Caption describes each chart as drawn: bars with dots, the averaged series of a line chart, grouped bars by series', async () => {
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(600);
    const dlg = p.locator('.modal-bg.open', { hasText: 'Replace your caption?' });
    if (await dlg.count()) await dlg.getByRole('button', { name: 'Replace' }).click();
    const cap = await p.locator('#caption-out').inputValue();
    const need = [/\(A\) Bar chart of CFU\/mL for ΔfliC, WT and dmotA, on a log scale\. Bars show the mean ± SD \(n−1\); dots, individual replicates; n = 3 per bar\./,
      /Brackets: p = 0\.011 \(ΔfliC vs WT\); p = 0\.022 \(WT vs dmotA\), from the author’s own statistical test/, /Bars show the mean ± SD \(n−1\); dots, individual replicates; n = 3 per bar/, /Line chart of OD₆₀₀ against Time \(min\) \(series: MOI 0 and MOI_1\)/, /Grouped bar chart of MIC \(µg\/mL\)[^.]*\(bars: PA14, dlasR and dmexB\)/];
    const miss = need.filter(r => !r.test(cap));
    expect(!miss.length && !/MOI_0_r1/.test(cap), 'missing ' + miss.join(', ') + ' in: ' + cap);
    return cap.split(/ (?=\([A-Z]\) )/).filter(x => /^\((A|B|H)\)/.test(x)).join(' … ').slice(0, 700);
  });

  // ---- ux3: the SVG — log axis below 1, stacked brackets --------------------------------------
  await step(T, 'X1 ↓ SVG: the MIC log axis reads 0.01, 0.1, 1, 10; the two brackets on A sit at two heights', async () => {
    const r = await L.exportVia(T, 'SVG', { name: 'Fig2_charts_more' });
    const s = fs.readFileSync(r.file, 'utf8');
    const txt = [...s.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map(m => ({ a: m[1], s: m[2] }));
    const ticks = ['0.01', '0.1', '1', '10'].filter(v => txt.some(t => t.s === v));
    const y = lab => { const t = txt.find(t => t.s === lab); return t ? +(t.a.match(/ y="([\d.]+)"/) || [])[1] : NaN; };
    const y1 = y('p = 0.011'), y2 = y('p = 0.022');
    const fsz = +((txt.find(t => t.s === 'p = 0.011') || { a: '' }).a.match(/font-size="([\d.]+)"/) || [])[1];
    expect(ticks.length === 4 && isFinite(y1) && isFinite(y2) && Math.abs(y1 - y2) >= fsz, JSON.stringify({ ticks, y1, y2, fsz }));
    return `log ticks ${ticks.join(', ')}; bracket labels at y ${y1.toFixed(1)} and ${y2.toFixed(1)} (font ${fsz})`;
  });

  // ---- ux3: source data of the grouped bars, a zero error written as 0 --------------------------
  await step(T, 'D3 📦 package: the grouped-bar source data match the truth, and dlasR (0.5, 0.5, 0.5) has error 0, not a blank', async () => {
    await L.openSection(T, 'Export');
    const zip = await L.download(T, () => btn(T, '📦 Export submission package (ZIP)').click(), /submission-package\.zip$/, 180000);
    const letter = (await charts()).find(c => c.name === 'mic_tidy.csv').label;
    const t = L.zipRead(zip, `source-data/${letter}.csv`).toString('utf8');
    const [hdr, ...rows] = t.split(/# Plotted values[^\n]*\n/)[1].trim().split('\n');
    const H = hdr.split(',');
    const R = rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [H[i], v])));
    const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    const bad = [];
    for (const [k, v] of Object.entries(TRUTH.MIC)) {
      const [cat, ser] = k.split('|');
      const r = R.find(r => r.category === cat && r.series === ser);
      if (!r || !close(+r.mean, mean(v)) || !close(+r.error, sd(v)) || +r.n !== 3 || r.error === '') bad.push(k + ' ' + JSON.stringify(r));
    }
    const z = R.find(r => r.category === 'tobramycin' && r.series === 'dlasR');
    expect(!bad.length && z && z.error === '0', bad.join('; ') + ' | ' + JSON.stringify(z));
    return `${R.length} rows match; tobramycin dlasR: mean ${z.mean}, error ${z.error} (${z.error_type})`;
  });

  // ---- ux3: under a journal the Text size row offers a raise, or says why it cannot ------------------
  await step(T, 'J1 ⌘K "plos" → Journal: PLOS ONE; the Text size row: the 10⁸ superscripts print 5.6 pt, no Text to button, "no text size clears both"', async () => {
    await L.cmdk(T, 'plos');
    await p.waitForTimeout(600);
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Text size[^\n]*\n([^\n]*)/) || [])[1] || '';
    const fix = await rep.locator('button', { hasText: /^Text to [\d.]+ pt/ }).count();
    await p.keyboard.press('Escape');
    expect(/PLOS ONE/.test(txt) && /is 5\.6 pt, below 8 pt/.test(row) && fix === 0 && /no text size clears both/.test(row), row);
    return (fix ? 'button offered; ' : 'no button; ') + row.slice(row.indexOf('Superscripts'), row.indexOf('Superscripts') + 420);
  });

  // ISSUES "A shown-as name that equals another file's data name gives two colours": fixed in ux4
  await step(T, 'Troubleshooting: dfliC shown as Δ*fliC* (A) beside a file whose data say ΔfliC: one colour, and the key lists ΔfliC once', async () => {
    fs.writeFileSync(path.join(inp, 'swim_delta.csv'), 'strain,replicate,swim_mm\nWT,1,30\nWT,2,32\nΔfliC,1,5\nΔfliC,2,6\n');
    await L.pickFiles(T, dropZone(), [path.join(inp, 'swim_delta.csv')]);
    await chart.waitFor({ state: 'visible', timeout: 8000 }); await p.waitForTimeout(400);
    await apply();
    const label = (await charts()).pop().label;
    const a = await drawn('A'), n = await drawn(label);
    await L.openSection(T, 'Export');
    const key = await p.evaluate(() => document.getElementById('key-text').value);
    const twice = (key.match(/ΔfliC \(/g) || []).length;
    expect(a.dfliC.color === n['ΔfliC'].color && twice === 1, JSON.stringify({ a: a.dfliC, n: n['ΔfliC'], key }));
    return `A dfliC "${a.dfliC.name}" ${a.dfliC.color}; ${label} ΔfliC ${n['ΔfliC'].color}; key lists ΔfliC ${twice}×`;
  });

  await L.finish(T);
})();
