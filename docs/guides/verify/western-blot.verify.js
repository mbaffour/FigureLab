// Verifies docs/guides/western-blot.md through the visible UI: stack the blots, straighten and
// crop them to one size, measure the bands against total protein, MW labels, lane table,
// chart the values, uncropped originals (S1), and a revision by replacing an image.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

// What the synthetic blots hold: band amount per sample lane (lanes 2–7; lane 1 is the ladder).
const TRUTH = {
  PhoA: [0.3, 1, 0, 0, 0.4, 1.6],
  PhoB: [0.5, 1, 0.5, 1, 0.5, 1],
};
const LANE_X = [348.75, 798.75];          // two sample lanes along the band row, source px (lanes 3 and 7)

(async () => {
  const T = await L.start('western-blot');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');
  const f = n => path.join(inp, n);
  // band rows (source px) and tilt of each scan, as the generator draws them
  const scans = [
    { file: I.blotTiff(f('2026-11-03_PhoA_ChemiDoc.tif'), { amounts: TRUTH.PhoA, tiltDeg: 1.2, seed: 3, bandY: 0.5 }), bandY: 210, tilt: 1.2, cropY: 75 },
    { file: I.blotTiff(f('2026-11-03_PhoB_ChemiDoc.tif'), { amounts: TRUTH.PhoB, tiltDeg: -0.8, seed: 4, bandY: 0.45 }), bandY: 189, tilt: -0.8, cropY: 70 },
    { file: I.blotTiff(f('2026-11-03_GapA_loading.tif'), { amounts: [1, 1, 1, 1, 1, 1], tiltDeg: 0.6, seed: 5, bandY: 0.6 }), bandY: 252, tilt: 0.6, cropY: 120 },
    { file: I.totalProteinTiff(f('2026-11-03_TotalProtein_stainfree.tif'), { tiltDeg: 1.0 }), tilt: 1.0, cropY: 20, cropH: 380 },
  ];
  const rerun = I.blotTiff(f('2026-11-12_PhoA_rerun_ChemiDoc.tif'), { amounts: TRUTH.PhoA, tiltDeg: -2.0, seed: 13, bandY: 0.5 });

  // Screenshot the top `h` px of a dialog (its first child box), for the guide.
  const topShot = async (name, loc, h) => { const bb = await loc.boundingBox(); return L.shot(T, name, { x: bb.x, y: bb.y, width: bb.width, height: Math.min(h, bb.height) }, { doc: true }); };
  const dismissTip = async () => { const g = p.getByText('Got it', { exact: true }); if (await g.isVisible().catch(() => false)) await g.click(); };
  // Where panel i is drawn on screen (used only to aim a real click at it).
  const panelPoint = async (i, fx = 0.5, fy = 0.5) => p.evaluate(([i, fx, fy]) => {
    const c = document.getElementById('fig-canvas'), r = c.getBoundingClientRect(), b = panelBounds.find(q => q.idx === i);
    const s = r.width / (c.width / (window.devicePixelRatio || 1));
    return { x: r.x + (b.x + b.w * fx) * s, y: r.y + (b.y + b.h * fy) * s };
  }, [i, fx, fy]);
  const clickPanel = async (i, opts) => { const q = await panelPoint(i, 0.75, 0.5); await p.mouse.click(q.x, q.y, opts); await p.waitForTimeout(250); };

  // ---------------------------------------------------------------- Task 1
  await step(T, '1.1 Drop or click to add images → pick the four scans in stack order', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), scans.map(s => s.file));
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 20000 });
    await p.waitForTimeout(800); await dismissTip();
    const t = await L.toasts(T);
    expect(/native samples kept for measurement/.test(t), 'no 16-bit toast: ' + t);
    return '16-bit kept: "native samples kept for measurement"';
  });

  await step(T, '1.2 Arrange › Columns 1, Rows 4, tick Rows hug their panels', async () => {
    await L.openSection(T, 'Arrange');
    for (const [lab, v] of [['Columns', '1'], ['Rows', '4']]) { const i = p.getByLabel(lab, { exact: true }); await i.fill(v); await i.press('Tab'); }
    await p.getByLabel('Rows hug their panels').check();
    await p.waitForTimeout(400);
    const g = await p.evaluate(() => [cols.value, rows.value, document.getElementById('auto-row-h').checked]);
    expect(g[0] === '1' && g[1] === '4' && g[2], String(g));
  });

  // ---------------------------------------------------------------- Task 2
  const m = p.locator('#crop-modal');
  const setBox = async (o) => { for (const k of ['w', 'h', 'x', 'y']) if (o[k] != null) { const i = m.locator('#crop-px-' + k); await i.fill(String(o[k])); await i.press('Tab'); } await p.waitForTimeout(200); };
  const level = async (s) => {
    await m.locator('button', { hasText: '📐 Level' }).click(); await p.waitForTimeout(200);
    const c = p.locator('#crop-ed-canvas'); const bb = await c.boundingBox();
    const sx = bb.width / 900, sy = bb.height / 420;
    for (const x of LANE_X) { await c.click({ position: { x: x * sx, y: (s.bandY + (x - 450) * Math.tan(s.tilt * Math.PI / 180)) * sy } }); await p.waitForTimeout(200); }
    return +(await m.locator('#crop-angle').inputValue());
  };
  const tilts = [];
  await step(T, '2.1 ⌘K "batch crop" opens ✂ Batch Crop (1 / 4)', async () => {
    const hits = await L.cmdk(T, 'batch crop');
    expect(/Batch crop/.test(hits[0]), hits[0]);
    await m.waitFor({ state: 'visible' });
    expect(/Batch Crop \(1 \/ 4\)/.test(await m.innerText()), 'title');
  });
  await step(T, '2.2 Strip 1: type px W 860, H 210, X 20, Y 75; 📐 Level on the band row; ✓ Apply & Next', async () => {
    await setBox({ w: 860, h: 210, x: 20, y: scans[0].cropY });
    tilts.push(await level(scans[0]));
    expect(Math.abs(tilts[0] - scans[0].tilt) <= 0.3, 'tilt ' + tilts[0]);
    const warn = await m.innerText();
    expect(!/extends past the image/.test(warn), 'box extends past the image');
    await topShot('western-blot-batch-crop', m.locator('xpath=./*[1]'), 470);
    await m.locator('button', { hasText: '✓ Apply & Next' }).click(); await p.waitForTimeout(600);
    return 'Tilt ' + tilts[0] + '° (true ' + scans[0].tilt + '°)';
  });
  await step(T, '2.3 Strips 2–3 keep the box size: type Y only, Level, Apply & Next', async () => {
    for (const s of [scans[1], scans[2]]) {
      const keep = await p.evaluate(() => [document.getElementById('crop-px-w').value, document.getElementById('crop-px-h').value]);
      expect(keep[0] === '860' && keep[1] === '210', 'box size not carried: ' + keep);
      await setBox({ y: s.cropY }); tilts.push(await level(s));
      await m.locator('button', { hasText: '✓ Apply & Next' }).click(); await p.waitForTimeout(600);
    }
    expect(Math.abs(tilts[1] - scans[1].tilt) <= 0.3 && Math.abs(tilts[2] - scans[2].tilt) <= 0.3, 'tilts ' + tilts);
    return 'tilts ' + tilts.slice(1).join('°, ') + '° (true −0.8°, 0.6°)';
  });
  await step(T, '2.4 Total-protein strip: taller box (H 380, Y 20), ✨ Auto, ✓ Apply & Done', async () => {
    await setBox({ h: 380, y: 20 });
    await m.locator('button', { hasText: '✨ Auto' }).click(); await p.waitForTimeout(600);
    const a = +(await m.locator('#crop-angle').inputValue()); tilts.push(a);
    expect(Math.abs(a - 1.0) <= 0.3, 'Auto tilt ' + a);
    await m.locator('button', { hasText: '✓ Apply & Done' }).click(); await p.waitForTimeout(600);
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(500);
    const ang = await p.evaluate(() => images.map(im => im.cropAngle));
    expect(ang.every(x => x), 'crop angles ' + ang);
    return 'Auto ' + a + '° (true 1.0°)';
  });

  // ---------------------------------------------------------------- Task 3
  const g = p.locator('#gel-modal-bg');
  const openGel = async (i) => {
    await clickPanel(i);
    await L.cmdk(T, 'densitometry');
    await g.waitFor({ state: 'visible' });
    await p.waitForTimeout(800);
    return g.locator('text=/Lanes & bands — panel/').first().innerText();
  };
  const tableRows = async () => (await g.innerText()).split('\n').filter(l => /^\d+\t/.test(l)).map(l => l.split('\t'));
  await step(T, '3.1 Click strip A, ⌘K "densitometry" opens ⫼ Lanes & bands — panel A with 7 lanes', async () => {
    const title = await openGel(0);
    expect(/panel A/.test(title), title);
    const t = await g.innerText();
    expect(/7 lane\(s\)/.test(t), 'lane count');
    expect(/guessed from the image: dark on light/.test(t), 'polarity');
    return (t.match(/Lanes at x:[^\n]*/) || [''])[0].slice(0, 90);
  });
  await step(T, '3.2 Ladder lane = lane 1, sizes "75, 50, 37" → Fit', async () => {
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await g.locator('#gel-ladder-sizes').fill('75, 50, 37');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    const r = await tableRows();
    const kda = r.filter(x => x[0] === '1').map(x => x[9]);
    expect(kda.join(',') === '75,50,37', 'ladder kDa ' + kda);
    const fit = ((await g.innerText()).match(/R²\s*=?\s*[\d.]+/) || [''])[0];
    return 'ladder bands 75/50/37 kDa ' + fit;
  });
  await step(T, '3.3 Reference lane = lane 3; Loading control = panel D, Total protein (whole lane)', async () => {
    await g.locator('#gel-ref').selectOption({ label: 'lane 3' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc').selectOption({ label: 'panel D' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Total protein (whole lane)' }); await p.waitForTimeout(1200);
    const head = (await g.innerText()).split('\n').find(l => /^Lane\tBand/.test(l));
    expect(/÷LC rel ref/.test(head), 'no normalised column: ' + head);
    const r = await tableRows();
    const col = head.split('\t').indexOf('÷LC rel ref');
    const got = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    TRUTH.measuredA = got;
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(got[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${got[k]} vs ${v}`));
    await topShot('western-blot-lanes-bands', g.locator('xpath=./*[1]'), 560);
    return 'PhoA ÷ total protein, rel. lane 3: ' + got.map(v => v.toFixed(3)).join(' / ') + ' (truth 0.3 / 1 / 0 / 0 / 0.4 / 1.6)';
  });
  await step(T, '3.3b Alternative: Loading control = panel C, Loading band(s) gives the same ratios; then back to total protein', async () => {
    await g.locator('#gel-lc').selectOption({ label: 'panel C' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Loading band(s)' }); await p.waitForTimeout(1200);
    const t = await g.innerText();
    const head = t.split('\n').find(l => /^Lane\tBand/.test(l)).split('\t'); const col = head.indexOf('÷LC rel ref');
    const r = await tableRows();
    const got = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(got[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${got[k]} vs ${v}`));
    await g.locator('#gel-lc').selectOption({ label: 'panel D' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Total protein (whole lane)' }); await p.waitForTimeout(1000);
    return '÷ GapA, rel. lane 3: ' + got.map(v => v.toFixed(3)).join(' / ');
  });
  await step(T, '3.4 ⬇ CSV saves the band table', async () => {
    const file = await L.download(T, () => g.locator('button', { hasText: /^⬇ CSV$/ }).click(), /\.csv$/);
    const csv = fs.readFileSync(file, 'utf8');
    expect(/kDa|kda/i.test(csv) && csv.split('\n').length > 6, 'csv content');
    return path.basename(file);
  });

  // ---------------------------------------------------------------- Task 4
  await step(T, '4.1 ↕ Place MW labels on the ladder bands draws 75 / 50 / 37 beside strip A', async () => {
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(600);
    const t = await L.toasts(T);
    const n = await p.evaluate(() => annotations.filter(a => a.type === 'text' && /^(75|50|37)$/.test(String(a.text).trim())).length);
    expect(n === 3, 'MW labels found: ' + n + ' ' + t);
    return t.slice(0, 120);
  });
  await step(T, '4.2 Placing again replaces the set; ✕ Remove MW labels clears it', async () => {
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(500);
    const n2 = await p.evaluate(() => annotations.filter(a => a.type === 'text' && /^(75|50|37)$/.test(String(a.text).trim())).length);
    expect(n2 === 3, 'after placing twice: ' + n2);
    await g.locator('button', { hasText: '✕ Remove MW labels' }).click(); await p.waitForTimeout(500);
    const n3 = await p.evaluate(() => annotations.filter(a => a.type === 'text' && /^(75|50|37)$/.test(String(a.text).trim())).length);
    expect(n3 === 0, 'after remove: ' + n3);
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(500);
  });

  // ---------------------------------------------------------------- Task 5
  const lt = p.locator('#lt-modal-bg');
  await step(T, '5.1 ⊞ Lane table… opens with one column per detected lane; the ladder column says M', async () => {
    await g.locator('button', { hasText: '⊞ Lane table…' }).click();
    await lt.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const t = await lt.innerText();
    expect(/Lane table — panel A/.test(t), 'title');
    const hdr = t.split('\n').find(l => /^Row\t/.test(l)) || '';
    expect(/\bM\b/.test(hdr), 'ladder column header: ' + hdr);
    return 'header: ' + hdr.replace(/\t/g, ' ');
  });
  await step(T, '5.2 + Row twice; name the rows ΔphoA and IPTG; type "- + - + - +" into one cell to fill the row', async () => {
    await lt.locator('button', { hasText: '+ Row' }).click(); await p.waitForTimeout(300);
    const names = lt.locator('.lt-name'); const n = await names.count();
    expect(n >= 2, 'rows: ' + n);
    await names.nth(0).fill('Δ*phoA*'); await names.nth(0).press('Tab');
    await names.nth(1).fill('IPTG'); await names.nth(1).press('Tab');
    const cells = lt.locator('.lt-cell');
    const per = (await cells.count()) / n;
    await cells.nth(1).fill('- - + + - -'); await cells.nth(1).press('Tab'); await p.waitForTimeout(300);
    await cells.nth(per + 1).fill('- + - + - +'); await cells.nth(per + 1).press('Tab'); await p.waitForTimeout(400);
    const vals = await cells.evaluateAll(cs => cs.map(c => c.value));
    const r2 = vals.slice(per, 2 * per).join(' ');
    expect(/– \+ – \+ – \+|- \+ - \+ - \+/.test(r2), 'IPTG row: ' + r2);
    await L.shot(T, 'western-blot-lane-table', lt.locator('xpath=./*[1]'));
    await lt.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    return 'ΔphoA: ' + vals.slice(0, per).join(' ') + ' | IPTG: ' + r2;
  });

  // ---------------------------------------------------------------- Task 6
  await step(T, '6.1 📊 Chart these values adds a linked chart panel E in the grid', async () => {
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1200);
    const t = await L.toasts(T);
    expect(/Charted 6 lanes/.test(t) && /Linked/.test(t), t);
    const st = await p.evaluate(() => ({ mode: layoutMode, n: images.length, last: images[images.length - 1].type }));
    expect(st.mode === 'grid' && st.last === 'chart', JSON.stringify(st));
    return t.slice(0, 140);
  });
  const chartDlg = p.locator('#chart-modal');
  await step(T, '6.2 Double-click the chart panel: the Chart dialog shows the normalised values', async () => {
    const q = await panelPoint(4); await p.mouse.dblclick(q.x, q.y);
    await chartDlg.waitFor({ state: 'visible' });
    const data = await chartDlg.locator('textarea').first().inputValue();
    const vals = data.split('\n').slice(1).map(l => l.split('\t')[1]).map(v => v === '' ? 0 : +v);
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(vals[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${vals[k]} vs ${v}`));
    return data.replace(/\n/g, ' | ');
  });
  await step(T, '6.3 Names & colours "shown as": WT −, WT +, … ; Y title "PhoA / total protein" → Apply', async () => {
    const shown = chartDlg.locator('input[placeholder^="shown as"]');
    const names = ['WT −', 'WT +', 'Δ −', 'Δ +', 'C −', 'C +'];
    const n = await shown.count(); expect(n === 6, 'shown-as fields: ' + n);
    for (let k = 0; k < 6; k++) { await shown.nth(k).fill(names[k]); }
    const yt = chartDlg.getByLabel('Y title').or(chartDlg.locator('input[placeholder*="Y"]')).first();
    await yt.fill('PhoA / total protein');
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const cats = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); return _chartStatsCached(el).categories; });
    return 'categories drawn as: ' + cats.join(', ');
  });

  // ---------------------------------------------------------------- Task 7
  await step(T, '7.1 Clear the letters of strips 2–4 (label box in each image row); type B for the chart', async () => {
    const boxes = p.locator('#img-list .img-label-input');
    for (const k of [1, 2, 3]) { await boxes.nth(k).fill(''); await boxes.nth(k).press('Tab'); }
    await boxes.nth(4).fill('B'); await boxes.nth(4).press('Tab');
    await p.waitForTimeout(400);
    const labs = await p.evaluate(() => images.map(i => i.label || '·').join(''));
    expect(labs === 'A···B', labs);
    await p.keyboard.press('Escape'); await btn(T, '⟳ Render').click(); await p.mouse.click(5, 880); await p.waitForTimeout(500);
    await L.shot(T, 'western-blot-figure', p.locator('#canvas-container'), { doc: true });
    return labs;
  });

  // ---------------------------------------------------------------- Task 8
  await step(T, '8.1 Export › 🗎 Export uncropped originals (S1)… → ⬇ PDF (one page per panel): one page per scan', async () => {
    await L.openSection(T, 'Export');
    await p.locator('button:visible', { hasText: '🗎 Export uncropped originals (S1)…' }).last().click();
    const s1 = p.locator('#s1-modal-bg'); await s1.waitFor({ state: 'visible' });
    const listed = await s1.innerText();
    expect(/\(tilted crop\)/.test(listed), 'S1 list: ' + listed.slice(0, 200));
    const file = await L.download(T, () => s1.locator('button', { hasText: '⬇ PDF (one page per panel)' }).click(), /\.pdf$/i, 60000);
    const s = fs.readFileSync(file, 'latin1');
    const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages === 4, 'pages: ' + pages);
    return path.basename(file) + ', ' + pages + ' pages';
  });

  // ---------------------------------------------------------------- Task 9
  await step(T, '9.1 Right-click strip A › ⇄ Replace image… → pick the re-run scan; crop, letter, lane table, MW labels and analysis kept', async () => {
    await p.keyboard.press('Escape');
    const q = await panelPoint(0, 0.75, 0.5);
    await p.mouse.click(q.x, q.y, { button: 'right' }); await p.waitForTimeout(300);
    await L.pickFiles(T, p.locator('text=⇄ Replace image…').locator('visible=true').first(), [rerun]);
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ name: images[0].name, label: images[0].label, ang: images[0].cropAngle, t: images[0].cropT,
      laneRows: images[0].laneTable && images[0].laneTable.rows ? images[0].laneTable.rows.length : 0,
      marks: (images[0].panelAnns || []).length + annotations.filter(a => a.mw && a.blotPanel === images[0].id).length }));
    expect(/rerun/.test(st.name) && st.label === 'A', JSON.stringify(st));
    expect(st.laneRows > 0, 'lane table lost: ' + JSON.stringify(st));
    expect(st.marks > 0, 'MW labels lost: ' + JSON.stringify(st));
    return JSON.stringify(st) + ' ' + (await L.toasts(T)).slice(0, 100);
  });
  await step(T, '9.2 The kept tilt is wrong for the new scan: right-click › ⚙ Open settings › ✂ Open Crop Editor › 📐 Level › ✓ Apply Crop', async () => {
    const q = await panelPoint(0, 0.75, 0.5);
    await p.mouse.click(q.x, q.y, { button: 'right' }); await p.waitForTimeout(300);
    await p.getByText('⚙ Open settings').last().click(); await p.waitForTimeout(400);
    await btn(T, '✂ Open Crop Editor').click();
    await m.waitFor({ state: 'visible' }); await p.waitForTimeout(300);
    const before = +(await m.locator('#crop-angle').inputValue());
    const a = await level({ bandY: 210, tilt: -2.0 });
    expect(Math.abs(a + 2.0) <= 0.3, 'level ' + a);
    await m.locator('button', { hasText: '✓ Apply Crop' }).click(); await p.waitForTimeout(800);
    return 'kept tilt ' + before + '° → levelled ' + a + '° (true −2.0°)';
  });
  await step(T, '9.3 The chart panel is marked out of date; its dialog\'s ↻ Update from densitometry re-analyses strip A and updates it; Apply keeps the link', async () => {
    const onFig = await p.evaluate(() => _chartLinkState(images.find(i => i.type === 'chart')).stale);
    expect(onFig, 'chart not marked stale after the re-crop');
    const q = await panelPoint(4); await p.mouse.dblclick(q.x, q.y);
    await chartDlg.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const note = p.locator('#chart-link-note');
    const nt = (await note.innerText()).replace(/\s+/g, ' ');
    expect(/has changed since/.test(nt), nt);
    await L.toasts(T);
    await note.locator('button', { hasText: '↻ Update from densitometry' }).click(); await p.waitForTimeout(800);
    const t = await L.toasts(T);
    const nt2 = (await note.innerText()).replace(/\s+/g, ' ');
    expect(/^Linked to the densitometry/.test(nt2), nt2);
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(500);
    const st = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); return { link: !!el.chart.link, stale: _chartLinkState(el).stale }; });
    expect(st.link && !st.stale, JSON.stringify(st));
    return 'note: "' + nt.slice(0, 120) + '"; Update → toast "' + t.slice(0, 120) + '"; after Apply: linked, up to date';
  });
  await step(T, '9.4 Re-open ⫼ Lanes & bands on strip A: the re-analysis kept reference/loading/ladder, and the chart holds its values', async () => {
    await L.toasts(T);
    const title = await openGel(0);
    const t = await g.innerText();
    const ref = await g.locator('#gel-ref').inputValue(), lc = await g.locator('#gel-lc-mode').inputValue(), lad = await g.locator('#gel-ladder-lane').inputValue();
    const head = t.split('\n').find(l => /^Lane\tBand/.test(l)).split('\t'); const col = head.indexOf('÷LC rel ref');
    const r = await tableRows();
    const tab = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    await g.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(400);
    const toast = await L.toasts(T);
    const st = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); return { stale: _chartLinkState(el).stale, v: _chartStatsCached(el).groups.map(g => g.bars[0] ? g.bars[0].value : 0) }; });
    expect(/panel A/.test(title) && ref === '2' && lc === 'total' && lad === '0', `ref ${ref} lc ${lc} ladder ${lad}`);
    expect(!st.stale, 'chart still stale');
    tab.forEach((v, k) => expect(Math.abs(st.v[k] - v) < 1e-3, `chart ${st.v[k]} vs table ${v}`));
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(tab[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${tab[k]} vs ${v}`));
    return 'toast "' + toast.slice(0, 90) + '"; re-run PhoA: ' + tab.map(v => v.toFixed(3)).join(' / ') + '; ' + ((t.match(/tilted crop [^,]*/) || [''])[0]);
  });

  await step(T, '10. Export › 📦 Export submission package (ZIP) carries the S1 originals and each analysed blot\'s densitometry', async () => {
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => L.btn(T, '📦 Export submission package (ZIP)').click(), /\.zip$/, 120000);
    const list = L.zipList(f);
    const dens = list.filter(e => /densitometry/i.test(e));
    const s1 = list.filter(e => /S1/.test(e));
    expect(dens.length >= 1 && s1.length >= 1, 'entries: ' + list.join(', '));
    return dens.concat(s1).join(', ');
  });

  await L.finish(T);
})();
