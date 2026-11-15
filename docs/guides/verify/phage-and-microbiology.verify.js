// Verifies docs/guides/phage-and-microbiology.md through the visible UI: a TEM with a
// burned-in bar (calibrate, crop the info strip, rulers on head and tail), two plaque
// plates (calibrate from a ruler sticker, copy the calibration, count plaques in the dish),
// a spot assay with a dilution row, lysis curves from replicate columns, a gene map from
// GenBank, all in one grid, checked against ASM and exported.
//
// Where the script needs to know WHERE to click (a bar end, a virion, the dish), it reads
// the panel's position on the canvas from the app; every action itself is a mouse click,
// drag or keystroke on the visible page.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

(async () => {
  const T = await L.start('phage-and-microbiology');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');

  // ---- inputs ---------------------------------------------------------------------------
  const tem = I.temTiff(path.join(inp, 'phiGuide_negstain_0042.tif'));          // 0.5 nm/px, 400 px = 200 nm bar
  const plateB = await I.platePhoto(T, path.join(inp, 'IMG_4412_MG1655.jpg'), { n: 45, seed: 21 });
  const plateC = await I.platePhoto(T, path.join(inp, 'IMG_4415_BW25113.jpg'), { n: 30, seed: 22 });
  const spot = await I.spotAssay(T, path.join(inp, 'spot_assay.jpg'));
  const gb = I.phageGenBank(path.join(inp, 'phiGuide_late.gb'));
  let csv = 'time_min,MOI_0_rep1,MOI_0_rep2,MOI_0_rep3,MOI_1_rep1,MOI_1_rep2,MOI_1_rep3\n';
  const truthMean = {};
  for (let t = 0; t <= 120; t += 15) {
    const g = 0.05 * Math.exp(t / 60);
    const l = t < 45 ? g : Math.max(0.03, 0.05 * Math.exp(45 / 60) * Math.exp(-(t - 45) / 30));
    const r0 = [g * 1.02, g * 0.98, g], r1 = [l * 1.05, l * 0.95, l];
    csv += [t, ...r0.map(v => v.toFixed(4)), ...r1.map(v => v.toFixed(4))].join(',') + '\n';
    truthMean[t] = [r0, r1].map(a => a.map(v => +v.toFixed(4)).reduce((s, v) => s + v, 0) / 3);
  }
  const lysis = path.join(inp, 'lysis_OD600.csv'); fs.writeFileSync(lysis, csv);

  // Virions in the synthetic TEM (same generator, same seed): centre, axis angle.
  const r = L.rng(11);
  const virions = Array.from({ length: 4 }, (_, i) => ({ x: 180 + (i % 2) * 450 + r() * 80, y: 200 + Math.floor(i / 2) * 400 + r() * 60, a: r() * Math.PI * 2 }));
  const HEAD_HALF = 70, TAIL_FROM = 70 / 0.866, TAIL_TO = 70 * 0.85 + 220;     // source px
  const TRUE_CAPSID = 2 * HEAD_HALF * 0.5, TRUE_TAIL = (TAIL_TO - TAIL_FROM) * 0.5;  // nm

  // Screen point for a source pixel of panel idx (zoom 100 %, crop from the top/left only).
  const at = async (idx, X, Y, srcW) => {
    const cv = await p.locator('#fig-canvas').boundingBox();
    const b = await p.evaluate(i => panelBounds.find(q => q.idx === i), idx);
    const s = b.iw / srcW;
    return { x: cv.x + b.ix + X * s, y: cv.y + b.iy + Y * s };
  };
  const drag = async (a, b) => {
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    await p.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await p.mouse.move(b.x, b.y, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
  };
  const row = i => p.locator('#img-list > .img-item').nth(i);
  const settings = async i => {             // open panel i's ⚙ settings if they are closed
    if (!(await row(i).locator('input.f-colspan').isVisible())) await row(i).locator('button', { hasText: '⚙' }).click();
    await p.waitForTimeout(200);
    return row(i);
  };
  const setField = async (loc, v) => { await loc.fill(String(v)); await loc.press('Tab'); await p.waitForTimeout(150); };
  const render = async () => { await btn(T, '⟳ Render').click(); await p.waitForTimeout(500); };
  // Put two screenshots side by side on one white sheet (docs/guides/img, < 150 KB).
  async function sideBySide(T, name, a, b) {
    const pg = await T.context.newPage();
    const b64 = await pg.evaluate(async ([a, b]) => {
      const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
      const A = await load(a), B = await load(b), gap = 12;
      const c = document.createElement('canvas'); c.width = A.width + gap + B.width; c.height = Math.max(A.height, B.height);
      const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(A, 0, 0); x.drawImage(B, A.width + gap, 0);
      return c.toDataURL('image/png').split(',')[1];
    }, [a.toString('base64'), b.toString('base64')]);
    await pg.close();
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(T.out, 'shots', name + '.png'), buf);
    if (buf.length > 150 * 1024) throw new Error(name + ' is ' + Math.round(buf.length / 1024) + ' KB');
    fs.writeFileSync(path.join(L.IMG_DIR, name + '.png'), buf);
  }
  const panels = () => p.evaluate(() => images.filter(Boolean).map(im => ({ type: im.type || 'image', label: formatLabel(im.label), name: im.name })));

  // ---- 1 --------------------------------------------------------------------------------
  await step(T, 'Images › Drop or click to add images → TEM, two plates, spot assay', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [tem, plateB, plateC, spot]);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 15000 });
    const gi = p.getByText('Got it'); if (await gi.isVisible().catch(() => false)) await gi.click();
    const st = await p.evaluate(() => images.filter(Boolean).map(im => formatLabel(im.label) + (im.sbOn ? ' bar' : ' no bar')));
    expect(st.join() === 'A no bar,B no bar,C no bar,D no bar', 'uncalibrated panels should start without a bar: ' + st);
    return st.join(', ');
  });

  // ---- 2 TEM calibration ----------------------------------------------------------------
  await step(T, 'TEM: ⚙ › 🔍 Auto-detect scale bar (falls back to 🔬 Calibrate from image if it finds nothing)', async () => {
    const it = await settings(0);
    await L.toasts(T);
    await it.locator('button', { hasText: '🔍 Auto-detect scale bar' }).click();
    await p.waitForTimeout(800);
    const det = p.locator('#sbdetect-modal');
    const found = await det.isVisible().catch(() => false);
    const msg = found ? '' : await L.toasts(T);
    expect(found, 'auto-detect should find the white 400-px bar in the black strip: ' + msg);
    if (!found) return 'auto-detect: "' + msg.slice(0, 70) + '…"';
    const said = (await det.textContent()).match(/([\d.]+) px/);
    expect(said && Math.abs(+said[1] - 400) <= 0.5, 'bar length ' + (said && said[1]));
    await det.locator('.sbd-pick', { hasText: '200 nm' }).click();
    await p.waitForTimeout(300);
    const um = await p.evaluate(() => images[0].umPerPx);
    expect(Math.abs(um * 1000 - 0.5) / 0.5 < 0.01, 'nm/px ' + um * 1000);
    return `auto-detect found the bar: ${said[1]} px = 200 nm → ${(um * 1000).toFixed(3)} nm/px`;
  });

  await step(T, 'TEM: ⚙ › 🔬 Calibrate from image → click both bar ends (snaps to 400 px) → 200 nm → Apply', async () => {
    const um0 = await p.evaluate(() => images[0].umPerPx || 0);
    if (Math.abs(um0 - 0.0005) < 1e-6) return 'already calibrated by auto-detect';
    const it = await settings(0);
    await it.locator('button', { hasText: '🔬 Calibrate from image' }).click();
    const m = p.locator('#calib-modal'); await m.waitFor({ state: 'visible' });
    const cv = m.locator('#calib-canvas'); const bb = await cv.boundingBox(); const s = bb.width / 1024;
    // a click a few pixels inside each end: the dialog snaps to the bar's real ends
    await cv.click({ position: { x: 44 * s, y: 989 * s } });
    await cv.click({ position: { x: 434 * s, y: 990 * s } });
    const px = +(await m.locator('#calib-px').inputValue());
    expect(Math.abs(px - 400) <= 2, 'snapped distance ' + px + ' px');
    await m.locator('#calib-um').fill('200');
    await m.locator('#calib-unit').selectOption('nm');
    await L.shot(T, 'phage-calibrate', m.locator('.modal').first().or(m.locator('xpath=./*[1]')).first(), { doc: true });
    await m.locator('button', { hasText: 'Apply' }).click();
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ um: images[0].umPerPx, on: images[0].sbOn, unit: images[0].sbUnit, len: images[0].sbUm }));
    expect(Math.abs(st.um * 1000 - 0.5) / 0.5 < 0.02, 'nm/px ' + st.um * 1000);
    expect(st.on && st.unit === 'nm', 'bar not switched on in nm: ' + JSON.stringify(st));
    return `${px} px = 200 nm → ${(st.um * 1000).toFixed(3)} nm/px; bar ${Math.round(st.len * 1000)} nm, on`;
  });

  await step(T, 'TEM: ⚙ › Clip shape B = 7 (% cut from the bottom) removes the info strip; calibration kept', async () => {
    const it = await settings(0);
    await setField(it.locator('input.f-cb'), 7);
    await render();
    const st = await p.evaluate(() => ({ b: images[0].cropB, um: images[0].umPerPx }));
    expect(st.b === 7 && Math.abs(st.um - 0.0005) < 1e-9, JSON.stringify(st));
    return '7 % of 1024 px = 72 px ≥ the 70 px strip';
  });

  // ---- 3 rulers -------------------------------------------------------------------------
  let rulerCsv;
  await step(T, 'TEM: ⚙ › Panel span 2 × 2, then Measure › ⊢ Ruler across 3 capsids and 3 tails', async () => {
    const it = await settings(0);
    await setField(it.locator('input.f-colspan'), 2);
    await setField(it.locator('input.f-rowspan'), 2);
    await render();
    await L.openSection(T, 'Measure');
    await btn(T, '⊢ Ruler').click();
    for (const v of virions.slice(0, 3)) {
      const n = [-Math.sin(v.a), Math.cos(v.a)], u = [Math.cos(v.a), Math.sin(v.a)];
      await drag(await at(0, v.x - HEAD_HALF * n[0], v.y - HEAD_HALF * n[1], 1024), await at(0, v.x + HEAD_HALF * n[0], v.y + HEAD_HALF * n[1], 1024));
      await drag(await at(0, v.x + TAIL_FROM * u[0], v.y + TAIL_FROM * u[1], 1024), await at(0, v.x + TAIL_TO * u[0], v.y + TAIL_TO * u[1], 1024));
    }
    const n = await p.locator('details:has(> summary:text-matches("Measure")) table input').count();
    expect(n === 6, n + ' rulers in the table');
    return '6 rulers drawn';
  });

  await step(T, 'Measure › Rulers table: name them capsid / tail → mean ± SD per name; ⬇ Ruler lengths CSV', async () => {
    const sec = p.locator('details:has(> summary:text-matches("Measure"))');
    const ins = sec.locator('table input');
    for (let i = 0; i < 6; i++) { await ins.nth(i).fill(i % 2 ? 'tail' : 'capsid'); await ins.nth(i).press('Tab'); }
    await p.waitForTimeout(300);
    const txt = await sec.innerText();
    const cap = txt.match(/capsid · panel A: n = 3, ([\d.]+) ± ([\d.]+) nm/), tail = txt.match(/tail · panel A: n = 3, ([\d.]+) ± ([\d.]+) nm/);
    expect(cap && tail, 'no per-name summary: ' + txt.slice(0, 300));
    expect(Math.abs(cap[1] - TRUE_CAPSID) / TRUE_CAPSID < 0.03, `capsid ${cap[1]} vs ${TRUE_CAPSID}`);
    expect(Math.abs(tail[1] - TRUE_TAIL) / TRUE_TAIL < 0.03, `tail ${tail[1]} vs ${TRUE_TAIL.toFixed(1)}`);
    rulerCsv = await L.download(T, () => sec.locator('button', { hasText: '⬇ Ruler lengths CSV' }).click(), /rulers.*\.csv$/);
    const c = fs.readFileSync(rulerCsv, 'utf8');
    expect(/,capsid,A,measured,/.test(c) && /,tail,A,measured,/.test(c), 'CSV lacks named rows');
    await L.shot(T, 'phage-rulers', sec, { doc: false });
    return `capsid ${cap[1]} ± ${cap[2]} nm (true ${TRUE_CAPSID}), tail ${tail[1]} ± ${tail[2]} nm (true ${TRUE_TAIL.toFixed(1)}); ${path.basename(rulerCsv)}`;
  });

  await step(T, 'Annotate & Draw › ✕ Clear → Confirm removes the rulers; Panel span back to 1 × 1', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '✕ Clear').click();
    await btn(T, /^Confirm$/).click();
    await p.waitForTimeout(300);
    const it = await settings(0);
    await setField(it.locator('input.f-colspan'), 1);
    await setField(it.locator('input.f-rowspan'), 1);
    await render();
    const n = await p.evaluate(() => annotations.length);
    expect(n === 0, n + ' annotations left');
  });

  // ---- 4 plates -------------------------------------------------------------------------
  await step(T, 'Plate B: ⚙ › 🔬 Calibrate from image → click 0 and 10 on the ruler sticker, type Pixel distance 220, 10 mm', async () => {
    const it = await settings(1);
    await it.locator('button', { hasText: '🔬 Calibrate from image' }).click();
    const m = p.locator('#calib-modal'); await m.waitFor({ state: 'visible' });
    const cv = m.locator('#calib-canvas'); const bb = await cv.boundingBox(); const s = bb.width / 1200;
    await cv.click({ position: { x: 81 * s, y: 1140 * s } });
    await cv.click({ position: { x: 301 * s, y: 1140 * s } });
    const clicked = +(await m.locator('#calib-px').inputValue());
    await setField(m.locator('#calib-px'), 220);
    await m.locator('#calib-um').fill('10');
    await m.locator('#calib-unit').selectOption('mm');
    await m.locator('button', { hasText: 'Apply' }).click();
    await p.waitForTimeout(400);
    const st = await p.evaluate(() => ({ um: images[1].umPerPx, unit: images[1].sbUnit, len: images[1].sbUm, on: images[1].sbOn }));
    expect(Math.abs(st.um - 1000 / 22) < 0.05 && st.on && st.unit === 'mm', JSON.stringify(st));
    return `clicks gave ${clicked} px; typed 220 px = 10 mm → ${st.um.toFixed(2)} µm/px, ${st.len / 1000} mm bar`;
  });

  await step(T, 'Plate C: tick B and C → B ⚙ › ⇉ Same µm/px on ticked panels', async () => {
    await row(1).locator('input.panel-pick').check(); await row(2).locator('input.panel-pick').check();
    await L.toasts(T);
    const it = await settings(1);
    await it.locator('button', { hasText: '⇉ Same µm/px on ticked panels' }).click();
    await p.waitForTimeout(400);
    const msg = await L.toasts(T);
    await row(1).locator('input.panel-pick').uncheck(); await row(2).locator('input.panel-pick').uncheck();
    const um = await p.evaluate(() => images[2].umPerPx);
    expect(Math.abs(um - 1000 / 22) < 0.05, 'C ' + um);
    return msg;
  });

  for (const [idx, n, letter] of [[1, 45, 'B'], [2, 30, 'C']]) {
    await step(T, `Plate ${letter}: Measure › 🔢 Count, dark objects (plaques) + round (a dish), drag around the dish`, async () => {
      await L.openSection(T, 'Measure');
      const cnt = btn(T, '🔢 Count');
      if (!(await p.locator('#count-polarity').isVisible())) await cnt.click();
      await p.locator('#count-polarity').selectOption({ label: 'dark objects (plaques)' });
      await p.locator('#count-ellipse').check();
      await drag(await at(idx, 96, 96, 1200), await at(idx, 1104, 1104, 1200));
      await p.waitForTimeout(800);
      const sec = p.locator('details:has(> summary:text-matches("Measure"))');
      const txt = await sec.innerText();
      const got = +((txt.match(/Objects detected: (\d+)/g) || []).pop() || '').replace(/\D/g, '');
      const dia = (txt.match(/Equivalent diameter: ([^\n]*)/g) || []).pop();
      expect(Math.abs(got - n) <= 3, `counted ${got}, made ${n}`);
      if (letter === 'B') {
        // the result box (sidebar) beside panel B with its marks, as one picture
        const box = sec.locator('div', { hasText: /^Count \(darker/ }).last();
        await box.scrollIntoViewIfNeeded();
        const left = await p.screenshot({ clip: await box.boundingBox() });
        const cv = await p.locator('#fig-canvas').boundingBox();
        const b = await p.evaluate(() => panelBounds.find(q => q.idx === 1));
        const right = await p.screenshot({ clip: { x: cv.x + b.x, y: cv.y + b.y, width: b.w, height: b.h } });
        await sideBySide(T, 'phage-count', left, right);
      }
      let csvNote = '';
      if (letter === 'B') {
        const f = await L.download(T, () => sec.locator('button', { hasText: '⬇ Export Measurements CSV' }).click(), /\.csv$/);
        csvNote = '; ' + path.basename(f);
      }
      return `${got} objects (made ${n}); ${dia}${csvNote}`;
    });
  }

  // ---- 5 spot assay ---------------------------------------------------------------------
  await step(T, 'Spot assay D: ⚙ › Clip shape T 10, B 10, L 5.6, R 5.6 so the spots fill the panel evenly', async () => {
    await L.openSection(T, 'Measure');
    if (await p.locator('#count-polarity').isVisible()) await btn(T, '🔢 Count').click();   // tool off
    await p.keyboard.press('Escape');
    const it = await settings(3);
    for (const [c, v] of [['f-ct', 10], ['f-cb', 10], ['f-cl', 5.6], ['f-cr', 5.6]]) await setField(it.locator('input.' + c), v);
    await render();
    const st = await p.evaluate(() => [images[3].cropT, images[3].cropB, images[3].cropL, images[3].cropR]);
    expect(st.join() === '10,10,5.6,5.6', st.join());
  });

  await step(T, 'Spot assay D: click the panel, ⌘K "lane table" → Lanes 8, row Dilution, type 10^{0}, 10^{-1}, … in one cell', async () => {
    const c = await at(3, 600, 300, 1400 * 0.888);
    await p.mouse.click(c.x, c.y);
    const hits = await L.cmdk(T, 'lane table');
    expect(/^Lane table/.test(hits[0]), 'top hit ' + hits[0]);
    const m = p.locator('#lt-modal-bg'); await m.waitFor({ state: 'visible' });
    expect(/panel D/.test(await m.innerText()), 'lane table is not for panel D');
    await setField(m.locator('#lt-lanes'), 8);
    await setField(m.locator('input.lt-name').first(), 'Dilution');
    const c0 = m.locator('input.lt-cell').first();
    await c0.click(); await p.keyboard.press('ControlOrMeta+a');
    await p.keyboard.type('10^{0}, 10^{-1}, 10^{-2}, 10^{-3}, 10^{-4}, 10^{-5}, 10^{-6}, 10^{-7}');
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const lt = await p.evaluate(() => images[3].laneTable);
    expect(lt && lt.rows[0].cells.length === 8 && lt.rows[0].cells[7] === '10^{-7}', JSON.stringify(lt));
    await m.locator('.modal-close, button:has-text("×")').first().click();
    await render();
    const cv = await p.locator('#fig-canvas').boundingBox();
    const b = await p.evaluate(() => panelBounds.find(q => q.idx === 3));
    await L.shot(T, 'phage-spot', { x: cv.x + b.x - 70, y: cv.y + b.y - 8, width: b.w + 80, height: b.h + 16 }, { doc: false });
    return lt.rows[0].cells.join(' ');
  });

  // ---- 6 lysis curves -------------------------------------------------------------------
  await step(T, 'Lysis CSV: Drop or click to add images → Chart dialog averages MOI_0_rep1…3 into one series with SD', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [lysis]);
    const m = p.locator('#chart-modal'); await m.waitFor({ state: 'visible' });
    const st = await m.evaluate(e => ({
      kind: e.querySelector('#chart-kind').selectedOptions[0].text, err: e.querySelector('#chart-err').selectedOptions[0].text,
      avg: [...e.querySelectorAll('input[type=checkbox]')].find(i => /Average replicate columns/.test(i.parentElement.innerText)).checked,
    }));
    expect(st.kind === 'Line' && /^SD/.test(st.err) && st.avg, JSON.stringify(st));
    await m.locator('#chart-xtitle').fill('Time (min)');
    await m.locator('#chart-ytitle').fill('OD_{600}');
    await m.getByLabel('points', { exact: true }).check();
    const shown = m.locator('input[placeholder^="shown as"]');
    await setField(shown.nth(0), 'Uninfected'); await setField(shown.nth(1), 'MOI 1');
    await m.locator('button', { hasText: /^Apply$/ }).click();
    await p.waitForTimeout(600);
    const ps = await panels();
    const chart = ps.find(q => q.type === 'chart');
    expect(chart && chart.label === 'E', JSON.stringify(ps));
    return `${st.kind}, ${st.err}, replicate columns averaged → chart panel ${chart.label}`;
  });

  await step(T, 'Lysis chart: each plotted point is the mean of its 3 replicates, with SD, and the key names follow', async () => {
    const st = await p.evaluate(() => images.find(i => i && i.type === 'chart')._chartStat);
    let worst = 0, npts = 0;
    st.series.forEach((sr, k) => sr.points.forEach(pt => {
      npts++;
      const t = truthMean[pt.x][k];
      worst = Math.max(worst, Math.abs(pt.y - t) / t);
      if (pt.n !== 3 || !(pt.err > 0)) worst = 1;
    }));
    expect(npts === 18 && worst < 1e-6, `${npts} points, worst mean error ${worst}`);
    expect(st.series.map(x => x.name).join() === 'Uninfected,MOI 1', st.series.map(x => x.name).join());
    const key = await p.locator('#key-text').inputValue();
    expect(/Uninfected/.test(key) && /MOI 1/.test(key), 'key text: ' + key);
    return `18 points = replicate means (n = 3, SD bars); key: ${key.slice(0, 90)}`;
  });

  // ---- 7 gene map -----------------------------------------------------------------------
  await step(T, 'Gene map: Annotate & Draw › 🧬 Linear → 📄 GenBank / FASTA… → title → Apply → ×', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '🧬 Linear').click();
    const m = p.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
    await L.pickFiles(T, m.getByText('GenBank / FASTA…'), [gb]);
    await p.waitForTimeout(500);
    const info = await m.innerText();
    expect(/10\.8 kb · 12 features/.test(info), 'import summary: ' + (info.match(/[\d.]+ kb · \d+ features[^\n]*/) || [''])[0]);
    await m.locator('#gm-title').fill('*Escherichia* phage phiGuide, late region');
    await m.locator('button', { hasText: /^Apply$/ }).click();
    await p.waitForTimeout(300);
    await m.locator('button', { hasText: '×' }).first().click();
    const st = await p.evaluate(() => { const g = images.find(i => i && i.type === 'genemap'); return g && { label: formatLabel(g.label), n: g.map.features.length, len: g.map.length, topo: g.map.topology }; });
    expect(st && st.label === 'F' && st.n === 12 && st.len === 10800 && st.topo === 'linear', JSON.stringify(st));
    return `panel ${st.label}: ${st.n} features, ${st.len} bp, ${st.topo}`;
  });

  // ---- 8 layout -------------------------------------------------------------------------
  await step(T, 'Layout: chart ⚙ › Col span 2, gene map ⚙ › Col span 2, then Arrange › ⊞ Fit grid to panels', async () => {
    await setField((await settings(4)).locator('input.f-colspan'), 2);
    await setField((await settings(5)).locator('input.f-colspan'), 2);
    await L.openSection(T, 'Arrange');
    await L.toasts(T);
    await btn(T, '⊞ Fit grid to panels').click();
    await p.waitForTimeout(400);
    const msg = await L.toasts(T);
    await render();
    const st = await p.evaluate(() => ({ g: [document.getElementById('cols').value, document.getElementById('rows').value], drawn: panelBounds.length,
      spans: panelBounds.filter(b => b.idx >= 4).map(b => b.w) }));
    expect(st.drawn === 6 && st.g.join('x') === '4x2' && st.spans.every(w => w > 550), JSON.stringify(st));
    return `grid ${st.g.join(' × ')}, ${st.drawn} panels drawn; toast "${msg}"`;
  });

  // ---- 9 journal ------------------------------------------------------------------------
  await step(T, '⌘K "asm" → Journal: ASM sets 177.8 mm and Arial', async () => {
    const hits = await L.cmdk(T, 'asm');
    expect(/^Journal: ASM/.test(hits[0]), 'top hit ' + hits[0]);
    const st = await p.evaluate(() => ({ w: document.getElementById('export-width-mm').value, f: document.getElementById('label-font').value }));
    expect(+st.w === 177.8, JSON.stringify(st));
    return `${st.w} mm, ${st.f}`;
  });

  await step(T, 'Text contrast: Look › untick Background; TEM ⚙ › Black pt 10000; Check › ✓ Check journal compliance passes', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#label-bg').uncheck();
    const it = await settings(0);
    await it.locator('input.f-bpt-v').fill('10000'); await it.locator('input.f-bpt-v').press('Enter');
    await p.waitForTimeout(400);
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const contrast = (txt.match(/Text contrast\n([^\n]*)/) || [])[1] || '';
    const size = (txt.match(/Text size\n([^\n]*)/) || [])[1] || '';
    const title = await p.locator('#im-title').innerText();
    await p.keyboard.press('Escape');
    expect(/✓/.test(contrast), 'Text contrast: ' + contrast);
    return title + ' · ' + size.slice(0, 80);
  });

  await step(T, 'screenshot: the finished figure', async () => {
    await p.keyboard.press('Escape');
    await p.mouse.click(320, 135);         // click the grey area beside the figure, so no panel is outlined
    await render();
    await L.shot(T, 'phage-figure', p.locator('#canvas-container'), { doc: true });
  });

  // ---- 10 export ------------------------------------------------------------------------
  await step(T, 'Export: ↓ TIFF → file name Fig1_phiGuide → Save TIFF (177.8 mm, 300 dpi)', async () => {
    const r = await L.exportVia(T, 'TIFF', { name: 'Fig1_phiGuide' });
    const info = L.tiffInfo(fs.readFileSync(r.file));
    const mm = info.w / info.xres * 25.4;
    expect(Math.abs(mm - 177.8) < 1 && Math.abs(info.xres - 300) < 1, JSON.stringify(info));
    return `${path.basename(r.file)}: ${info.w}×${info.h} px, ${info.xres} dpi, ${mm.toFixed(1)} mm`;
  });

  await step(T, 'Export: ↓ SVG → chart and gene map are vector text', async () => {
    const r = await L.exportVia(T, 'SVG', { name: 'Fig1_phiGuide' });
    const svg = fs.readFileSync(r.file, 'utf8');
    const want = ['Uninfected', 'MOI 1', 'portal', 'tape measure', '100 nm', '10 mm', 'Dilution'];
    const miss = want.filter(w => !new RegExp('>[^<]*' + w.replace(/ /g, '\\s') + '[^<]*<').test(svg));
    expect(!miss.length, 'not text in the SVG: ' + miss.join(', '));
    return path.basename(r.file) + ' carries ' + want.join(', ') + ' as <text>';
  });

  await step(T, 'Export › Legend key › ⬇ Download key lists the curves and the gene-map glyphs', async () => {
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => btn(T, /⬇ Download key/).click(), /key/);
    const key = await p.locator('#key-text').inputValue();
    expect(/Uninfected/.test(key) && /CDS|Promoter|Terminator/i.test(key), key);
    return path.basename(f) + ' · "' + key.slice(0, 140) + '…"';
  });

  await step(T, 'Export › ✎ Write Methods paragraph states the TEM display range and where each calibration came from', async () => {
    await L.openSection(T, 'Export');
    await btn(T, '✎ Write Methods paragraph').click();
    await p.waitForTimeout(400);
    const m = await p.locator('#methods-out').inputValue();
    expect(/10000–62000 \(panel A\)/.test(m), 'display range missing: ' + m.slice(0, 300));
    expect(/copied from panel B/.test(m), 'calibration source missing');
    return (m.match(/display ranges in native values:[^.]*/) || [''])[0] + '; ' + (m.match(/copied from panel B[^)]*\)/) || [''])[0];
  });

  await step(T, '⌘K finds the measuring tools by plain words', async () => {
    const want = { ruler: /^Ruler/, count: /^Count objects/, plaque: /^Count objects/, 'lane table': /^Lane table/, calibrate: /^Calibrate a panel/ };
    const out = [];
    for (const [q, re] of Object.entries(want)) {
      const hits = await L.cmdk(T, q, { enter: false });
      expect(re.test(hits[0] || ''), `"${q}" → ${hits[0]}`);
      out.push(`${q} → ${hits[0].slice(0, 30)}`);
    }
    return out.join('; ');
  });

  await L.finish(T);
})();
