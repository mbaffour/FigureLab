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
  const plateC2 = await I.platePhoto(T, path.join(inp, 'IMG_4431_BW25113_repeat.jpg'), { n: 38, seed: 23 });   // §6: a replaced plate, re-counted
  // NCBI files list most genes twice, as a gene and its CDS: write the file that way.
  const gb = I.phageGenBank(path.join(inp, 'phiGuide_late.gb'));
  fs.writeFileSync(gb, fs.readFileSync(gb, 'utf8').replace(/^     CDS             (\S+)\n(                     \/gene="[^"]+")$/gm,
    '     gene            $1\n$2\n     CDS             $1\n$2'));
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

  // A plate reader's export (Gen5-like): Time as h:mm:ss, a temperature column, one column
  // per well. Row A holds the blank (medium only); rows B–D are three cultures in triplicate.
  // Truth at each time: the mean of (well − mean of A1–A3) over the row's three wells.
  const pr = L.rng(77);
  const wells = ['A', 'B', 'C', 'D'].flatMap(R => [1, 2, 3].map(c => R + c));
  let plate = 'Time,T° 600,' + wells.join(',') + '\n';
  const plateTruth = {};          // { minutes: [rowB, rowC, rowD] }
  for (let t = 0; t <= 150; t += 15) {
    const g = 0.04 * Math.exp(t / 50), lysed = t < 75 ? g : Math.max(0.01, 0.04 * Math.exp(75 / 50) * Math.exp(-(t - 75) / 20));
    const base = { A: 0.085, B: 0.085 + g, C: 0.085 + lysed, D: 0.085 + g * 0.8 };
    const v = {}; for (const w of wells) v[w] = +(base[w[0]] + (pr() - 0.5) * 0.006).toFixed(3);
    const hh = Math.floor(t / 60), mm = t % 60;
    plate += [`${hh}:${String(mm).padStart(2, '0')}:00`, '37.0', ...wells.map(w => v[w].toFixed(3))].join(',') + '\n';
    const blank = (v.A1 + v.A2 + v.A3) / 3;
    plateTruth[t] = ['B', 'C', 'D'].map(R => [1, 2, 3].map(c => v[R + c] - blank).reduce((s, x) => s + x, 0) / 3);
  }
  const plateCsv = path.join(inp, 'Kz7_platereader_Gen5.csv'); fs.writeFileSync(plateCsv, plate);

  // A phase-contrast micrograph with a 10 µm bar burned into its bottom-right corner (the
  // microscope software's own), for Auto-detect's "Keep the bar in the image" choice.
  const phase = path.join(inp, 'phase_100x_burnedbar.png');
  await L.canvasImage(T, phase, 800, 600, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 50; i++) {
      const x = rnd() * w, y = rnd() * h * 0.8, a = rnd() * Math.PI;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(0, 0, 22, 7, 0, 0, 7); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(560, 560, 200, 8);          // 200 px = 10 µm
  }, { seed: 41 });

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
  await step(T, 'TEM: right-click › 📏 Scale bar / calibrate… and ⌘K "add scale bar" lead to the panel\'s calibration', async () => {
    const q = await at(0, 512, 400, 1024);
    await p.mouse.click(q.x, q.y, { button: 'right' }); await p.waitForTimeout(300);
    await p.locator('body *:visible').filter({ hasText: /^📏\s*Scale bar \/ calibrate…$/ }).last().click(); await p.waitForTimeout(400);
    const a = await p.evaluate(() => { const e = document.activeElement; return { tag: e && e.tagName, cls: e && e.className, txt: e && (e.innerText || e.value || '').slice(0, 40) }; });
    const vis1 = await row(0).locator('button', { hasText: '🔍 Auto-detect scale bar' }).isVisible();
    await p.keyboard.press('Escape');
    const hits = await L.cmdk(T, 'add scale bar', { enter: false });
    expect(vis1, 'right-click › Scale bar / calibrate… did not open the panel\'s calibration: ' + JSON.stringify(a));
    expect(/scale bar|calibrat/i.test(hits[0] || ''), '⌘K add scale bar → ' + hits[0]);
    return `right-click opened panel A's ⚙ at its calibration; ⌘K "add scale bar" → ${hits[0]}`;
  });

  await step(T, 'TEM: ⚙ › 🔍 Auto-detect scale bar finds the burned-in bar → pick 200 nm', async () => {
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
    // ux3 (newcomer3-01): two choices under the lengths; the default also draws FigureLab's bar
    const choices = await det.locator('label:has(input[name="sbd-draw"])').allInnerTexts();
    const dflt = await det.locator('input[name="sbd-draw"]:checked').evaluate(e => e.parentElement.innerText.trim());
    expect(choices.length === 2 && /^Also draw FigureLab's bar/.test(dflt) && choices.some(c => /^Keep the bar in the image as the scale bar — calibrate only, draw no second bar/.test(c.trim())), JSON.stringify(choices));
    await det.locator('.sbd-pick', { hasText: '200 nm' }).click();
    await p.waitForTimeout(300);
    const um = await p.evaluate(() => images[0].umPerPx);
    const t = await L.toasts(T);
    expect(Math.abs(um * 1000 - 0.5) / 0.5 < 0.01, 'nm/px ' + um * 1000);
    // ux3 (newcomer3-01): the toast says where FigureLab's bar is drawn (clear of the burned-in one)
    expect(/Scale set: 0\.5 nm\/px \(400 px = 200 nm\) · FigureLab's 200 nm bar is drawn bottom (right|left)/.test(t), 'toast: ' + t);
    return `auto-detect found the bar (${said[1]} px); default "${dflt.slice(0, 40)}…"; toast "${t}"`;
  });

  // The by-hand path the guide gives for a bar Auto-detect does not find, replayed on the
  // same TEM: it must give the same 0.5 nm/px.
  await step(T, 'TEM: ⚙ › 🔬 Calibrate from image → click both bar ends (snaps to 400 px) → 200 nm → Apply', async () => {
    const it = await settings(0);
    await it.locator('button', { hasText: '🔬 Calibrate from image' }).click();
    const m = p.locator('#calib-modal'); await m.waitFor({ state: 'visible' });
    const cv = m.locator('#calib-canvas'); const bb = await cv.boundingBox(); const s = bb.width / 1024;
    // a click a few pixels inside each end: the dialog snaps to the bar's real ends
    await cv.click({ position: { x: 44 * s, y: 989 * s } });
    await cv.click({ position: { x: 434 * s, y: 990 * s } });
    const px = +(await m.locator('#calib-px').inputValue());
    const said = (await m.innerText()).match(/Distance:[^\n]*/);
    expect(Math.abs(px - 400) <= 2 && said && /snapped to the ends of the bar/.test(said[0]), 'snapped distance ' + px + ' px; ' + (said && said[0]));
    const zooms = await m.locator('button.calib-zoom').allInnerTexts();
    expect(zooms.join('|') === 'Fit|1:1|2:1', 'zoom buttons ' + zooms);
    await m.locator('#calib-um').fill('200');
    await m.locator('#calib-unit').selectOption('nm');
    await L.shot(T, 'phage-calibrate', m.locator('.modal').first().or(m.locator('xpath=./*[1]')).first(), { doc: true });
    await m.locator('button', { hasText: 'Apply' }).click();
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ um: images[0].umPerPx, on: images[0].sbOn, unit: images[0].sbUnit, len: images[0].sbUm }));
    expect(Math.abs(st.um * 1000 - 0.5) / 0.5 < 0.02, 'nm/px ' + st.um * 1000);
    expect(st.on && st.unit === 'nm', 'bar not switched on in nm: ' + JSON.stringify(st));
    return `${said[0]} → ${(st.um * 1000).toFixed(3)} nm/px; bar ${Math.round(st.len * 1000)} nm, on; zoom ${zooms.join(' / ')}`;
  });

  await step(T, 'TEM: ⚙ › Clip shape › Crop % B = 7, then R with the cursor in the box: the info strip is gone; calibration kept', async () => {
    const it = await settings(0);
    const lbl = await it.getByText('Crop % cut from each edge').count();
    // count renders, to see that R pressed with the cursor still in the box redraws
    await p.evaluate(() => { window.__rc = 0; const o = window.render; window.render = function () { window.__rc++; return o.apply(this, arguments); }; });
    await it.locator('input.f-cb').fill('7');
    await p.keyboard.press('r'); await p.waitForTimeout(600);
    const st = await p.evaluate(() => ({ b: images[0].cropB, um: images[0].umPerPx, rc: window.__rc, v: document.activeElement && document.activeElement.value }));
    expect(lbl === 1, 'no "Crop % cut from each edge" label');
    expect(st.b === 7 && Math.abs(st.um - 0.0005) < 1e-9 && st.rc > 0 && st.v === '7', JSON.stringify(st));
    return `R in the box rendered (${st.rc}×), the box still reads ${st.v}; 7 % of 1024 px = 72 px ≥ the 70 px strip`;
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

  // ISSUES.md "Ruler labels stick out of a panel after its span shrinks": span back to 1 × 1
  // with the rulers still on, then look at panel A and its margin (shots/phage-rulers-1x1.png).
  await step(T, 'Panel span back to 1 × 1 with the rulers on (they follow the panel); Annotate & Draw › ✕ Clear → Confirm removes them', async () => {
    const it = await settings(0);
    await setField(it.locator('input.f-colspan'), 1);
    await setField(it.locator('input.f-rowspan'), 1);
    await render();
    const cv = await p.locator('#fig-canvas').boundingBox();
    const b = await p.evaluate(() => panelBounds.find(q => q.idx === 0));
    await L.shot(T, 'phage-rulers-1x1', { x: Math.max(0, cv.x + b.x - 60), y: cv.y + Math.max(0, b.y - 20), width: b.w + 120, height: b.h + 40 });
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '✕ Clear').click();
    await btn(T, /^Confirm$/).click();
    await p.waitForTimeout(300);
    await render();
    const n = await p.evaluate(() => annotations.length);
    expect(n === 0, n + ' annotations left');
  });

  // ---- 4 plates -------------------------------------------------------------------------
  await step(T, 'Plate B: ⚙ › 🔬 Calibrate from image → click 0 and 10 on the ruler sticker, type Pixel distance 220, 10 mm', async () => {
    const it = await settings(1);
    await it.locator('button', { hasText: '🔬 Calibrate from image' }).click();
    const m = p.locator('#calib-modal'); await m.waitFor({ state: 'visible' });
    const cv = m.locator('#calib-canvas');
    // 1:1 shows one photo pixel per screen pixel (for clicking ruler ticks); Fit shows it all
    await m.locator('button.calib-zoom', { hasText: '1:1' }).click(); await p.waitForTimeout(200);
    const w11 = Math.round((await cv.boundingBox()).width);
    await m.locator('button.calib-zoom', { hasText: 'Fit' }).click(); await p.waitForTimeout(200);
    expect(Math.abs(w11 - 1200) <= 4, '1:1 canvas width ' + w11);
    const bb = await cv.boundingBox(); const s = bb.width / 1200;
    await cv.click({ position: { x: 81 * s, y: 1140 * s } });
    await cv.click({ position: { x: 301 * s, y: 1140 * s } });
    const clicked = +(await m.locator('#calib-px').inputValue());
    await setField(m.locator('#calib-px'), 220);
    await m.locator('#calib-um').fill('10');
    await m.locator('#calib-unit').selectOption('mm');
    await L.toasts(T);
    await m.locator('button', { hasText: 'Apply' }).click();
    await p.waitForTimeout(400);
    const t = await L.toasts(T);
    await render();
    const st = await p.evaluate(() => ({ um: images[1].umPerPx, unit: images[1].sbUnit, len: images[1].sbUm, on: images[1].sbOn, corner: images[1]._sbCornerUsed, avoid: !!images[1].sbAvoid }));
    expect(Math.abs(st.um - 1000 / 22) < 0.05 && st.on && st.unit === 'mm', JSON.stringify(st));
    // ux3 (phage3-05): the bar is drawn in a corner clear of the ruler that was clicked on
    const cornerOpt = await (await settings(1)).locator('select.f-sbcorner option:checked').innerText().catch(() => '');
    return `1:1 shows the photo ${w11} px wide; clicks gave ${clicked} px; typed 220 px = 10 mm → ${st.um.toFixed(2)} µm/px, ${st.len / 1000} mm bar drawn ${st.corner} (Corner: "${cornerOpt}"); toast "${t}"`;
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
      // a click on the words "round (a dish)" ticks the box
      if (!(await p.locator('#count-ellipse').isChecked())) await p.locator('label', { hasText: 'round (a dish)' }).click();
      expect(await p.locator('#count-ellipse').isChecked(), 'clicking "round (a dish)" did not tick it');
      await drag(await at(idx, 96, 96, 1200), await at(idx, 1104, 1104, 1200));
      await p.waitForTimeout(800);
      const sec = p.locator('details:has(> summary:text-matches("Measure"))');
      const txt = await sec.innerText();
      const got = +((txt.match(/Objects detected: (\d+)/g) || []).pop() || '').replace(/\D/g, '');
      const dia = (txt.match(/Equivalent diameter: ([^\n]*)/g) || []).pop();
      const objLine = (txt.match(/Objects detected: [^\n]*/g) || []).pop();
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
        const lines = fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith('#'));
        const head = lines[0];
        const want = ['Objects', 'Region', 'Cut by the rim (not counted)', 'Dish wall (left out)', 'Diameter mean', 'Diameter SD', 'Diameter median', 'Diameter unit', 'Object diameters', 'Source file'];
        expect(want.every(w => head.includes(w)) && /ellipse \(round, a dish\)/.test(lines[1]), 'CSV: ' + head + ' | ' + lines[1]);
        csvNote = '; ' + path.basename(f) + ' has ' + want.join(', ');
      }
      return `"${objLine}" (made ${n}); ${dia}${csvNote}`;
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
    // ux3 (phage3-03): as the guide says it: click the row's name box, type the name, click
    // the first cell, type the row with commas, Enter. (The click used to cycle the cell to +.)
    const hint = (await m.innerText()).match(/Type a whole row into its first cell[^\n]*/);
    expect(hint && /separated by commas/.test(hint[0]), 'hint: ' + (hint && hint[0]));
    await m.locator('input.lt-name').first().click();
    await p.keyboard.type('Dilution');
    await m.locator('input.lt-cell').first().click();
    await L.toasts(T);
    await p.keyboard.type('10^{0}, 10^{-1}, 10^{-2}, 10^{-3}, 10^{-4}, 10^{-5}, 10^{-6}, 10^{-7}');
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const t = await L.toasts(T);
    const lt = await p.evaluate(() => images[3].laneTable);
    expect(lt && lt.rows[0].name === 'Dilution' && lt.rows[0].cells.length === 8 && lt.rows[0].cells[0] === '10^{0}' && lt.rows[0].cells[7] === '10^{-7}', JSON.stringify(lt));
    await m.locator('.modal-close, button:has-text("×")').first().click();
    await render();
    const cv = await p.locator('#fig-canvas').boundingBox();
    const b = await p.evaluate(() => panelBounds.find(q => q.idx === 3));
    await L.shot(T, 'phage-spot', { x: cv.x + b.x - 70, y: cv.y + b.y - 8, width: b.w + 80, height: b.h + 16 }, { doc: false });
    return `${lt.rows[0].name}: ${lt.rows[0].cells.join(' ')}; toast "${t}"`;
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
  await step(T, 'Gene map: Annotate & Draw › 🧬 Linear, then Cancel: the sample map it added is taken away again', async () => {
    const n0 = (await panels()).length;
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '🧬 Linear').click();
    const m = p.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
    const n1 = (await panels()).length;
    await m.locator('button', { hasText: /^Cancel$/ }).click(); await p.waitForTimeout(300);
    const n2 = (await panels()).length;
    expect(n1 === n0 + 1 && n2 === n0, `panels ${n0} → ${n1} → ${n2}`);
    return `panels ${n0} → ${n1} (sample map) → ${n2} after Cancel`;
  });

  await step(T, 'Gene map: Annotate & Draw › 🧬 Linear → 📄 GenBank / FASTA… (genes listed as gene + CDS) → title → Apply (the dialog closes)', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '🧬 Linear').click();
    const m = p.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
    await L.toasts(T);
    await L.pickFiles(T, m.getByText('GenBank / FASTA…'), [gb]);
    await p.waitForTimeout(500);
    const info = await m.innerText();
    const line = (info.match(/[\d.]+ kb · \d+ features[^\n]*/) || [''])[0];
    const t = await L.toasts(T);
    expect(/^10\.8 kb · 12 features · [\d.]+ bp per pixel$/.test(line), 'import summary: ' + line);
    expect(/10 genes listed twice \(gene \+ CDS or RNA\) drawn once each/.test(t), 'toast: ' + t);
    T._gmNote = line + ' — toast "' + t + '"';
    // ux3 (data): the dialog's ruler checkbox is "ruler", and a Unit menu reads bp (DNA) / aa (protein)
    const rul = (await m.locator('label:has(#gm-ruler)').innerText()).trim();
    const units = await m.locator('#gm-unit option').allInnerTexts();
    const unit = await m.locator('#gm-unit option:checked').innerText();
    expect(rul === 'ruler' && units.join('|') === 'bp (DNA)|aa (protein)' && unit === 'bp (DNA)', JSON.stringify({ rul, units, unit }));
    T._gmNote += `; "${rul}" ticked ${await m.locator('#gm-ruler').isChecked()}, Unit ${unit}`;
    await m.locator('#gm-title').fill('*Escherichia* phage phiGuide, late region');
    await m.locator('button', { hasText: /^Apply$/ }).click();
    await p.waitForTimeout(300);
    await m.waitFor({ state: 'hidden' });   // Apply closes the dialog
    const st = await p.evaluate(() => { const g = images.find(i => i && i.type === 'genemap'); return g && { label: formatLabel(g.label), n: g.map.features.length, len: g.map.length, topo: g.map.topology }; });
    expect(st && st.label === 'F' && st.n === 12 && st.len === 10800 && st.topo === 'linear', JSON.stringify(st));
    return `panel ${st.label}: ${st.n} features, ${st.len} bp, ${st.topo}; ${T._gmNote}`;
  });

  // ---- 8 layout -------------------------------------------------------------------------
  // ux2: a journal preset now scales lane tables to the figure's text size, and at 7 pt the
  // dilution labels no longer fit eight columns of a one-cell spot assay (each cell drew "…").
  // Two columns for the spot assay give every label room.
  await step(T, 'Layout: spot assay and chart ⚙ › Col span 2, gene map ⚙ › Col span 3, then Arrange › ⊞ Fit grid to panels', async () => {
    await setField((await settings(3)).locator('input.f-colspan'), 2);
    await setField((await settings(4)).locator('input.f-colspan'), 2);
    await setField((await settings(5)).locator('input.f-colspan'), 3);
    await L.openSection(T, 'Arrange');
    await L.toasts(T);
    await btn(T, '⊞ Fit grid to panels').click();
    await p.waitForTimeout(400);
    const msg = await L.toasts(T);
    await render();
    const st = await p.evaluate(() => ({ g: [document.getElementById('cols').value, document.getElementById('rows').value], drawn: panelBounds.length,
      spans: panelBounds.filter(b => b.idx >= 4).map(b => b.w) }));
    const rowsOf = await p.evaluate(() => panelBounds.map(b => formatLabel(images[b.idx].label) + '@' + Math.round(b.y)));
    expect(st.drawn === 6 && st.g.join('x') === '5x2' && st.spans[0] > 550 && st.spans[1] > 850, JSON.stringify(st));
    return `grid ${st.g.join(' × ')}, ${st.drawn} panels drawn (${rowsOf.join(' ')}); toast "${msg}"`;
  });

  // ---- 9 journal ------------------------------------------------------------------------
  await step(T, '⌘K "asm" → Journal: ASM sets 177.8 mm and Arial', async () => {
    const fs0 = await p.evaluate(() => images[3].laneTable.fs);
    const hits = await L.cmdk(T, 'asm');
    expect(/^Journal: ASM/.test(hits[0]), 'top hit ' + hits[0]);
    const st = await p.evaluate(() => ({ w: document.getElementById('export-width-mm').value, f: document.getElementById('label-font').value, fs: images[3].laneTable.fs }));
    expect(+st.w === 177.8 && st.fs !== fs0, JSON.stringify(st) + ' lane table size before ' + fs0);
    return `${st.w} mm, ${st.f}; the dilution row's size ${fs0} → ${(+st.fs).toFixed(1)} px`;
  });

  // The key goes into free space; this grid has none, so a margin grows and says so. A wide
  // figure keeps its panel sizes with the key below: choosing a place in Where with no key
  // yet places it there. (Moving a key placed in the right margin to Below later leaves the
  // grown right margin behind: ISSUES.md.)
  await step(T, 'Export › Legend key › Where › Below places the key under the panels; the bottom margin grows to hold it', async () => {
    await L.openSection(T, 'Export');
    await L.toasts(T);
    await p.locator('#key-where').selectOption({ label: 'Below' }); await p.waitForTimeout(800);
    const g = await p.evaluate(() => { const k = annotations.filter(a => a && a.type === 'legend'), cv = document.getElementById('fig-canvas');
      return { n: k.length, where: k[0] && k[0].where, y: k[0] && Math.round(k[0].yf * cv.height), bottom: Math.round(panelBounds.reduce((m, b) => Math.max(m, b.y + b.h), 0)),
        right: document.getElementById('m-right').value, ticked: document.getElementById('key-on-fig') ? document.getElementById('key-on-fig').checked : null }; });
    const t = await L.toasts(T);
    const ticked = await p.getByLabel('Place the key on the figure').isChecked();
    expect(g.n === 1 && g.where === 'bottom' && g.y >= g.bottom && g.right === '16' && ticked, JSON.stringify(g) + ' ticked ' + ticked);
    expect(/The legend key needed free space, so the bottom margin grew from 16 to \d+ px — it sits there without covering anything/.test(t), 'toast: ' + t);
    return `key at y ${g.y}, under the panels (${g.bottom}); Place the key on the figure ticked; toast "${t.split(' — ')[0]}"`;
  });

  const readReport = async () => {
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' }); const txt = await rep.innerText();
    return { title: await p.locator('#im-title').innerText(), tc: (txt.match(/Text contrast\n([^\n]*)/) || [])[1] || '', ts: (txt.match(/Text size\n([^\n]*)/) || [])[1] || '',
      kr: (txt.match(/Legend key on the figure\n([^\n]*)/) || [])[1] || '', open: [...txt.matchAll(/\n([⚠✗])\n([^\n]+)/g)].map(m => m[1] + ' ' + m[2]) };
  };
  // ux2 (phage2-04): contrast is measured under each letter's strokes, and the row's Auto
  // contrast button picks black or white per panel and darkens the chips. ux3 (phage3-01):
  // bar text takes its ink from the pixels under the text, with a backing chip where neither
  // black nor white reads, so the TEM's bar text passes too.
  await step(T, 'Check › ✓ Check journal compliance: Text contrast ⚠ on E and F, Blank margins ⚠; Auto contrast passes every text and Balance margins the margins', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const r0 = await readReport();
    expect(/^⚠/.test(r0.open.find(o => /Text contrast/.test(o)) || '') && /panel letters “E”/.test(r0.tc) && /sits in free space/.test(r0.kr), JSON.stringify(r0));
    const b = p.locator('#info-modal-bg .compliance-row', { hasText: 'Text contrast' }).getByRole('button', { name: 'Auto contrast' });
    expect(await b.count() === 1, 'no Auto contrast button on the Text contrast row');
    await b.click(); await p.waitForTimeout(600);
    const t = await p.locator('#toast').textContent();
    const r1 = await readReport();
    expect(/^Auto contrast on/.test(t) && /every text over a picture now reads at 4\.5:1 or better/.test(t) && /✓/.test(r1.tc), 'toast: ' + t + ' | ' + r1.tc);
    // ux4: ASM asks for whitespace cropped; the default margins leave a wider strip on the left
    const bm = p.locator('#info-modal-bg .compliance-row', { hasText: 'Blank margins' });
    const bmNote = (await bm.innerText()).replace(/\s+/g, ' ');
    expect(/^⚠/.test(bmNote) && /ASM.* asks for whitespace cropped/.test(bmNote), 'Blank margins: ' + bmNote);
    await L.toasts(T);
    await bm.getByRole('button', { name: 'Balance margins' }).click(); await p.waitForTimeout(800);
    const bt = await L.toasts(T);
    const r2 = await readReport();
    await p.keyboard.press('Escape');
    expect(!r2.open.some(o => /Blank margins/.test(o)) && !r2.open.length, 'after Balance margins: ' + JSON.stringify(r2.open) + ' | ' + bt);
    const mg = await p.evaluate(() => ['m-top', 'm-left', 'm-btm', 'm-right'].map(id => document.getElementById(id).value));
    return `${r0.title} (${r0.open.join(', ')}: ${r0.tc.slice(0, 200)}) → Auto contrast → ${r1.title}; Blank margins "${bmNote.slice(0, 160)}" → Balance margins: toast "${bt}", margins T/L/B/R ${mg.join('/')} → ${r2.title}`;
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
    const want = ['Uninfected', 'MOI 1', 'portal', 'tape measure', '200 nm', '10 mm', 'Dilution'];   // ux4: FigureLab's bar takes the detected 200 nm
    const miss = want.filter(w => !new RegExp('>[^<]*' + w.replace(/ /g, '\\s') + '[^<]*<').test(svg));
    expect(!miss.length, 'not text in the SVG: ' + miss.join(', '));
    // ux3 (phage3-04): a map of 10 kb or more has its ruler in kb, with fewer ticks that keep apart
    const kb = [...svg.matchAll(/>\s*([\d.]+ kb)\s*</g)].map(x => x[1]);
    expect(kb.length >= 2, 'ruler in kb: ' + kb.join(', '));
    return path.basename(r.file) + ' carries ' + want.join(', ') + ' as <text>; gene-map ruler ' + kb.join(', ');
  });

  // ux2: the PDF writes chart and gene-map words (and the minus sign, in the standard Symbol
  // font) as real text, as the SVG does.
  await step(T, 'Export: ↓ PDF lossless → chart, gene map and dilution row are selectable text', async () => {
    const r = await L.exportVia(T, 'PDF lossless', { name: 'Fig1_phiGuide' });
    const zlib = require('zlib'); const d = fs.readFileSync(r.file).toString('latin1'); let tj = [];
    for (const m of d.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let b = Buffer.from(m[1], 'latin1'); try { b = zlib.inflateSync(b); } catch (_) {}
      tj = tj.concat([...b.toString('latin1').matchAll(/\(([^)]*)\)\s*Tj/g)].map(x => x[1]));
    }
    const want = ['Uninfected', 'MOI 1', 'portal', 'tape measure', 'Dilution', '200 nm', '10 mm'];
    const miss = want.filter(w => !tj.includes(w));
    expect(!miss.length, 'not text in the PDF: ' + miss.join(', '));
    expect(!tj.includes('\\205') && tj.filter(t => t === '10').length >= 8, 'dilution labels cut to "…": ' + tj.join('|').slice(0, 300));
    const fonts = [...new Set((d.match(/\/BaseFont \/[A-Za-z-]+/g) || []).map(x => x.slice(11)))];
    return path.basename(r.file) + ' carries ' + want.join(', ') + ' as text; fonts ' + fonts.join(', ');
  });

  await step(T, 'Export › Legend key › ⬇ Download key (PDF, the last export format) lists the curves and the gene-map glyphs', async () => {
    await L.openSection(T, 'Export');
    const lbl = await btn(T, /⬇ Download key/).innerText();
    expect(lbl === '⬇ Download key (PDF)', lbl);
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
    fs.writeFileSync(path.join(T.out, 'methods.txt'), m);
    // no display range typed in this guide: Methods gives the TEM's range as it opened, in the
    // file's own counts, and where each pixel size came from
    expect(/\d+–\d+ \(panel A\)/.test(m), 'display range missing: ' + m.slice(0, 300));
    expect(/copied from panel B/.test(m), 'calibration source missing');
    expect(/measured on the image \(400 px = 200 nm\) for panel A/.test(m), 'TEM pixel-size source missing');
    // ux4: the plaque counts reach the caption and Methods
    const cnt = (m.match(/Objects in panel B were counted[^.]*\./) || [''])[0];
    expect(/inside an ellipse drawn around the dish, objects cut by its edge being left out/.test(cnt) && /Objects in panel C were counted/.test(m), 'no count in Methods: ' + m);
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(400);
    const rp = p.locator('.modal-bg.open').filter({ hasText: 'Replace your caption?' });
    if (await rp.count()) await rp.locator('button', { hasText: 'Replace' }).first().click();
    const cap = await p.locator('#caption-out').inputValue();
    expect(/45 objects counted inside the dish; equivalent diameter 861 ± 115 µm \(mean ± SD\)\./.test(cap) && /30 objects counted inside the dish/.test(cap), 'caption: ' + cap);
    T._countCap = (cap.match(/45 objects counted[^.]*\./) || [''])[0]; T._countMeth = cnt.trim();
    return 'Methods "' + T._countMeth.slice(0, 200) + '"; caption "' + T._countCap + '" | ' + (m.match(/display ranges? in native values:[^.]*/) || m.match(/[^.]*\(panel A\)[^.]*/) || [''])[0] + ' | ' + (m.match(/measured on the image \(400 px = 200 nm\) for panel A[^,]*/) || [''])[0] + ' | ' + (m.match(/copied from panel B[^)]*\)/) || [''])[0];
  });

  // ---- §6, revision: a counted plate replaced (round 4) -----------------------------------
  await step(T, 'Revision: right-click plate C › ⇄ Replace image… → its count is marked out of date (toast, Measure, Measurements row) and left out of the CSV; 🔢 Count again counts the new photo', async () => {
    await p.keyboard.press('Escape');
    await L.toasts(T);
    await render();
    const q = await p.evaluate(() => { const cv = document.getElementById('fig-canvas'), c = cv.getBoundingClientRect(), k = c.width / (cv.width / (window.devicePixelRatio || 1));
      const b = panelBounds.find(x => x.idx === 2); return { x: c.x + (b.x + b.w / 2) * k, y: c.y + (b.y + b.h / 2) * k, name: images[2].name }; });
    expect(/IMG_4415/.test(q.name), 'panel 3 is ' + q.name);
    await p.mouse.click(q.x, q.y);
    await p.mouse.click(q.x, q.y, { button: 'right' });
    const menu = p.locator('#panel-ctx-menu'); await menu.waitFor({ state: 'visible' });
    await L.pickFiles(T, menu.getByText('⇄ Replace image…'), [plateC2]);
    await p.waitForTimeout(800);
    await p.waitForTimeout(800);
    const all = await L.toasts(T);
    const rt = all.split(' | ').find(x => /IMG_4415_BW25113\.jpg → /.test(x)) || ('(none of: ' + all + ')');
    expect(/IMG_4415_BW25113\.jpg → IMG_4431_BW25113_repeat\.jpg/.test(rt) && /out of date and left out of the Measurements CSV, the caption and Methods/.test(rt), 'replace toast: ' + rt);
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const mr = ((await rep.innerText()).match(/\n([⚠✗✓ℹ])\nMeasurements\n([^\n]*)/) || []);
    await p.keyboard.press('Escape');
    expect(mr[1] === '⚠' && /was made on IMG_4415_BW25113\.jpg, since replaced by IMG_4431_BW25113_repeat\.jpg — left out of the CSV; measure again or remove it \(× in Measure\)/.test(mr[2]), 'Measurements row: ' + JSON.stringify(mr.slice(1)));
    // count the new photo
    await L.openSection(T, 'Measure');
    if (!(await p.locator('#count-polarity').isVisible())) await btn(T, '🔢 Count').click();
    await p.locator('#count-polarity').selectOption({ label: 'dark objects (plaques)' });
    if (!(await p.locator('#count-ellipse').isChecked())) await p.locator('label', { hasText: 'round (a dish)' }).click();
    // the figure is shown scaled to the window now: aim by the drawn size (as the eye does)
    const atK = (fx, fy) => p.evaluate(([fx, fy]) => { const cv = document.getElementById('fig-canvas'), c = cv.getBoundingClientRect(), k = c.width / (cv.width / (window.devicePixelRatio || 1));
      const b = panelBounds.find(x => x.idx === 2); return { x: c.x + (b.ix + b.iw * fx) * k, y: c.y + (b.iy + b.ih * fy) * k }; }, [fx, fy]);
    await drag(await atK(0.08, 0.08), await atK(0.92, 0.92));
    await p.waitForTimeout(800);
    const sec = p.locator('details:has(> summary:text-matches("Measure"))');
    const txt = await sec.innerText();
    const got = +((txt.match(/Objects detected: (\d+)/g) || []).pop() || '').replace(/\D/g, '');
    expect(Math.abs(got - 38) <= 3, `counted ${got}, made 38: ` + (txt.match(/Objects detected: [^\n]*/g) || []).pop());
    const stale = (txt.match(/[^\n]*out of date[^\n]*/) || [''])[0];
    const f = await L.download(T, () => sec.locator('button', { hasText: '⬇ Export Measurements CSV' }).click(), /\.csv$/);
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
    const head = lines[0].split(','); const src = head.indexOf('Source file'), obj = head.indexOf('Objects');
    const rowsC = lines.slice(1).filter(l => /IMG_44(15|31)/.test(l));
    expect(rowsC.length === 1 && /IMG_4431_BW25113_repeat\.jpg/.test(rowsC[0]) && !lines.some(l => /IMG_4415/.test(l)), 'CSV rows for plate C: ' + JSON.stringify(rowsC) + ' | ' + lines.join(' / ').slice(0, 600));
    if (await p.locator('#count-polarity').isVisible()) await btn(T, '🔢 Count').click();   // turn the tool off
    return `toast "${rt.slice(0, 330)}…"; Measurements ⚠ "${mr[2].slice(0, 200)}"; Measure lists "${stale.slice(0, 150)}"; new count ${got} (made 38); CSV: one plate-C row, Source file IMG_4431_BW25113_repeat.jpg`;
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

  // ISSUES.md (fixed in ux3, freeform3-16): the margin grown for the key's old place is
  // given back when Where moves it; the key sits below the panels.
  await step(T, 'Export › Legend key: key moved Free space → Below gives the right margin back (16) and sits below the panels', async () => {
    await L.openSection(T, 'Export');
    const mr = () => p.evaluate(() => document.getElementById('m-right').value);
    // start again as a reader who ticks the switch first: no key, margins back to 16
    await p.getByLabel('Place the key on the figure').uncheck(); await p.waitForTimeout(300);
    await L.openSection(T, 'Arrange');
    await p.locator('#m-btm').fill('16'); await p.locator('#m-btm').press('Tab'); await p.waitForTimeout(300);
    await L.openSection(T, 'Export');
    await p.locator('#key-where').selectOption({ label: 'Free space' }).catch(() => {});
    if (await p.evaluate(() => annotations.some(a => a && a.type === 'legend'))) await p.getByLabel('Place the key on the figure').uncheck();
    await p.getByLabel('Place the key on the figure').check(); await p.waitForTimeout(800);
    const a = await mr();
    await p.locator('#key-where').selectOption({ label: 'Below' }); await p.waitForTimeout(800);
    const b = await mr();
    const k = await p.evaluate(() => { const k = annotations.find(a => a && a.type === 'legend'), cv = document.getElementById('fig-canvas');
      return { where: k.where, y: Math.round(k.yf * cv.height), bottom: Math.round(panelBounds.reduce((m, q) => Math.max(m, q.y + q.h), 0)), right: document.getElementById('m-right').value }; });
    expect(+a > 16 && b === '16' && k.where === 'bottom' && k.y >= k.bottom && k.right === '16', JSON.stringify({ a, b, k }));
    return `right margin 16 → ${a} (Free space) → ${b} after Where › Below; key below the panels`;
  });

  // ---- ISSUES.md re-checks on this build ------------------------------------------------
  const pdfWords = file => {
    const zlib = require('zlib'); const d = fs.readFileSync(file).toString('latin1'); let tj = [];
    for (const m of d.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let b = Buffer.from(m[1], 'latin1'); try { b = zlib.inflateSync(b); } catch (_) {}
      tj = tj.concat([...b.toString('latin1').matchAll(/\(([^)]*)\)\s*Tj/g)].map(x => x[1]));
    }
    return tj;
  };
  // "A journal preset can turn a one-cell lane table into '…'": the spot assay back in one
  // cell under ASM; the PDF's dilution labels and the Text size row.
  await step(T, 'ISSUES: the spot assay in one grid cell under ASM keeps its eight dilution labels (no "…")', async () => {
    await setField((await settings(3)).locator('input.f-colspan'), 1);
    await render();
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const r = await readReport();
    const tsBtns = await p.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' }).first().locator('button').allInnerTexts();
    await p.keyboard.press('Escape');
    const f = (await L.exportVia(T, 'PDF lossless', { name: 'Fig1_spot1cell' })).file;
    const tj = pdfWords(f);
    const tens = tj.filter(t => t === '10').length, dots = tj.filter(t => t === '\\205' || /…/.test(t)).length;
    const lt = await p.evaluate(() => images[3].laneTable.fs);
    await setField((await settings(3)).locator('input.f-colspan'), 2);
    await render();
    expect(dots === 0 && tens >= 8, `${tens} "10" labels, ${dots} "…" in the PDF`);
    return `${tens} "10" labels and no "…" in the PDF; table ${(+lt).toFixed(1)} px; ${r.title}; open rows: ${r.open.join(' | ')}; Text size: ${r.ts.slice(0, 160)}; buttons: ${tsBtns.join(', ')}`;
  });

  // "A chart in one grid cell runs its tick labels together at journal size": the lysis
  // chart at Col span 1 under ASM. Evidence only (shots/phage-chart-1cell-figure.png); the
  // guide keeps the chart at Col span 2.
  await step(T, 'ISSUES (evidence): the lysis chart in one grid cell under ASM, screenshot; Chart room ⚠ flags it; then back to Col span 2', async () => {
    await setField((await settings(4)).locator('input.f-colspan'), 1);
    await render(); await p.waitForTimeout(600); await render();
    await L.shot(T, 'phage-chart-1cell-figure', p.locator('#canvas-container'));
    const b = await p.evaluate(() => panelBounds.find(q => q.idx === 4));
    // ux4: the compliance check's Chart room row flags the squeezed chart
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const cr = ((await rep.innerText()).match(/\n([⚠✗✓ℹ])\nChart room\n([^\n]*)/) || []);
    const title = await p.locator('#im-title').innerText();
    await p.keyboard.press('Escape');
    expect(cr[1] === '⚠', 'Chart room row: ' + JSON.stringify(cr.slice(1)));
    await setField((await settings(4)).locator('input.f-colspan'), 2);
    await render();
    return `chart panel ${Math.round(b.w)} × ${Math.round(b.h)} px at Col span 1 — see shots/phage-chart-1cell-figure.png; ${title}; Chart room ⚠ "${cr[2].slice(0, 220)}"`;
  });

  // ---- Keep the bar in the image (Auto-detect's second choice) --------------------------
  await step(T, 'A micrograph whose bar stays in the picture: ⚙ › 🔍 Auto-detect › "Keep the bar in the image as the scale bar" → 10 µm: no second bar; the caption names the bar in the image', async () => {
    const n0 = (await panels()).length;
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [phase]);
    await p.waitForFunction(n => images.filter(Boolean).length === n + 1, n0, { timeout: 15000 });
    const i = n0;
    const it = await settings(i);
    await L.toasts(T);
    await it.locator('button', { hasText: '🔍 Auto-detect scale bar' }).click(); await p.waitForTimeout(800);
    const det = p.locator('#sbdetect-modal');
    expect(await det.isVisible().catch(() => false), 'no bar found: ' + await L.toasts(T));
    const said = (await det.textContent()).match(/([\d.]+) px/);
    await det.locator('label', { hasText: 'Keep the bar in the image as the scale bar' }).click();
    await det.locator('.sbd-pick', { hasText: /^10 µm$/ }).click(); await p.waitForTimeout(400);
    const t = await L.toasts(T);
    const st = await p.evaluate(i => ({ um: images[i].umPerPx, on: images[i].sbOn, kept: images[i].sbBurnedIn }), i);
    expect(Math.abs(st.um - 0.05) < 0.002 && !st.on && st.kept, JSON.stringify(st));
    expect(/the 10 µm bar in the image is the scale bar — FigureLab draws none/.test(t), 'toast: ' + t);
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(400);
    const rep = p.locator('#info-modal-bg .modal, .modal-bg.open').filter({ hasText: 'Replace your caption?' });
    if (await rep.count()) await rep.locator('button', { hasText: 'Replace' }).first().click();
    const cap = await p.locator('#caption-out').inputValue();
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const txt = await p.locator('#info-modal-bg').innerText(); await p.keyboard.press('Escape');
    const sb = (txt.match(/\nScale bars\n([^\n]*)/) || [])[1] || '(no Scale bars row)';
    const capLine = (cap.match(/Scale bar \(in the image\)[^.]*\([^)]*\)\./) || [''])[0];
    expect(capLine && !/calibrated but showing no scale bar/.test(sb), 'caption: ' + cap.slice(-300) + ' | row: ' + sb);
    // take it out again: the figure above is the guide's
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300);
    const x = row(i).locator('button[title*="Remove" i], button:has-text("×")').first();
    if (await x.count()) { await x.click(); await p.waitForTimeout(300); const c = btn(T, /^Confirm$/); if (await c.isVisible().catch(() => false)) await c.click(); }
    return `bar ${said && said[1]} px; toast "${t}"; caption "${capLine}"; Scale bars: ${sb.slice(0, 80)}`;
  });

  // ---- Plate-reader export (§8) ---------------------------------------------------------
  await step(T, 'Plate reader: Drop or click to add images → the export (Time h:mm:ss, T° 600, wells A1–D3): Line, Time in minutes, temperature left out and said so, a Plate wells row', async () => {
    await p.keyboard.press('Escape');
    await L.toasts(T);
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [plateCsv]);
    const m = p.locator('#chart-modal'); await m.waitFor({ state: 'visible' });
    const info = (await m.locator('#chart-delim-info').innerText()).replace(/\s+/g, ' ');
    const st = await m.evaluate(e => ({ kind: e.querySelector('#chart-kind').selectedOptions[0].text, x: e.querySelector('#chart-xcol').selectedOptions[0].text,
      xt: e.querySelector('#chart-xtitle').value, wells: e.querySelector('#chart-wells-wrap').offsetParent !== null, lbl: e.querySelector('#chart-wells-lbl').textContent }));
    expect(st.kind === 'Line' && st.x === 'Time' && st.xt === 'Time (min)' && st.wells && st.lbl === 'Plate wells (12: A1–D3)', JSON.stringify(st));
    expect(/Time read as h:mm:ss time, in minutes/.test(info) && /T° 600 \(temperature\) not plotted — tick it under Y columns to plot it/.test(info), 'status: ' + info);
    T._prInfo = info;
    return `${st.kind}, X ${st.x}, X title "${st.xt}", "${st.lbl}"; status "${info.slice(0, 200)}"`;
  });

  await step(T, 'Plate reader: Plate wells › replicates by plate row, blank › subtract Row A; name the rows; Apply → mean ± SD of each row, blank taken away, at each time', async () => {
    const m = p.locator('#chart-modal');
    await m.locator('#chart-wells-by').selectOption({ label: 'by plate row (A, B, C…)' }); await p.waitForTimeout(200);
    const blanks = await m.locator('#chart-wells-blank option').allInnerTexts();
    await m.locator('#chart-wells-blank').selectOption({ label: 'subtract Row A' }); await p.waitForTimeout(200);
    const err = await m.locator('#chart-err').evaluate(e => e.selectedOptions[0].text);
    const names = { 'Row B': 'BW25113', 'Row C': 'BW25113 + Kz7', 'Row D': 'ΔfhuA + Kz7' };
    for (const [k, v] of Object.entries(names)) await setField(m.locator(`#chart-names [data-key="${k}"] input[type=text]`), v);
    await m.locator('#chart-ytitle').fill('OD_{600} (blank-subtracted)');
    await m.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(600);
    const st = await p.evaluate(() => { const el = images.filter(i => i && i.type === 'chart').pop(); return { label: formatLabel(el.label), s: el._chartStat }; });
    let worst = 0, npts = 0;
    st.s.series.forEach((sr, k) => sr.points.forEach(pt => { npts++; const t = plateTruth[Math.round(pt.x)][k]; worst = Math.max(worst, Math.abs(pt.y - t)); if (pt.n !== 3 || !(pt.err >= 0)) worst = 1; }));
    expect(npts === 33 && worst < 1e-9, `${npts} points, worst |mean − truth| ${worst}`);
    expect(st.s.series.map(x => x.name).join('|') === 'BW25113|BW25113 + Kz7|ΔfhuA + Kz7', st.s.series.map(x => x.name).join('|'));
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(400);
    const rep = p.locator('.modal-bg.open').filter({ hasText: 'Replace your caption?' });
    if (await rep.count()) await rep.locator('button', { hasText: 'Replace' }).first().click();
    const cap = await p.locator('#caption-out').inputValue();
    const bl = (cap.match(/[^.;(]*blank-subtracted[^.;]*/) || [''])[0];
    expect(/blank-subtracted: the mean of A1, A2, A3 at each time point/.test(cap), 'caption: ' + cap.slice(-400));
    return `blank menu: ${blanks.join(' / ')}; Error bars ${err}; chart ${st.label}: ${npts} points = row means minus the blank (n = 3, worst error ${worst.toExponential(1)}); caption "${bl.trim()}"`;
  });

  // ---- Plate readers, round 4: any run length, every time format, with or without a blank row
  // A plate export as written: `rowsL` plate rows of three wells, `n` reads `every` minutes apart,
  // the time written by `fmt`. Row A (when present) is medium only. Returns the file and the truth:
  // { minutes: [mean of each culture row minus the blank mean] }.
  const plateExport = (name, { rowsL, n, every, fmt, header = 'Time', temp = true, seed = 91 }) => {
    const rr = L.rng(seed), wl = rowsL.flatMap(R => [1, 2, 3].map(c => R + c)), truth = {};
    let out = [header, ...(temp ? ['T° 600'] : []), ...wl].join(',') + '\n';
    for (let k = 0; k < n; k++) {
      const t = k * every, v = {};
      for (const w of wl) v[w] = +(0.085 + (w[0] === 'A' ? 0 : 0.6 / (1 + Math.exp(-(t - 120 * 'ABCDE'.indexOf(w[0])) / 40))) + (rr() - 0.5) * 0.004).toFixed(4);
      out += [fmt(t), ...(temp ? ['37.0'] : []), ...wl.map(w => v[w].toFixed(4))].join(',') + '\n';
      const blank = rowsL.includes('A') ? (v.A1 + v.A2 + v.A3) / 3 : 0;
      truth[t] = rowsL.filter(R => R !== 'A').map(R => [1, 2, 3].reduce((sum, c) => sum + v[R + c] - blank, 0) / 3);
    }
    const f = path.join(inp, name); fs.writeFileSync(f, out); return { f, truth };
  };
  const hms = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}:00`;
  const chartState = () => p.locator('#chart-modal').evaluate(e => ({ kind: e.querySelector('#chart-kind').selectedOptions[0].text, x: e.querySelector('#chart-xcol').selectedOptions[0].text,
    xt: e.querySelector('#chart-xtitle').value, wells: e.querySelector('#chart-wells-wrap').offsetParent !== null, lbl: e.querySelector('#chart-wells-lbl').textContent,
    info: e.querySelector('#chart-delim-info').innerText.replace(/\s+/g, ' ') }));

  await step(T, 'Plate reader: an 8-hour run read every 10 min (49 rows, h:mm:ss, wells A1–E3, row A blank) opens as plates: Time in hours, a Plate wells row; Y title typed before the row names keeps every name', async () => {
    const { f, truth } = plateExport('Gen5_8h_every10min.csv', { rowsL: ['A', 'B', 'C', 'D', 'E'], n: 49, every: 10, fmt: hms });
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [f]);
    const m = p.locator('#chart-modal'); await m.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const st = await chartState();
    expect(st.kind === 'Line' && st.x === 'Time' && st.xt === 'Time (h)' && st.wells && st.lbl === 'Plate wells (15: A1–E3)' && /Time read as h:mm:ss time, in hours/.test(st.info), JSON.stringify(st));
    await m.locator('#chart-wells-by').selectOption({ label: 'by plate row (A, B, C…)' }); await p.waitForTimeout(200);
    await m.locator('#chart-wells-blank').selectOption({ label: 'subtract Row A' }); await p.waitForTimeout(200);
    // the Y title first, then the names (round-4 testers lost the first name in this order)
    await m.locator('#chart-ytitle').fill('OD_{600}');
    const names = { 'Row B': 'MG1655', 'Row C': 'MG1655 + Lr3', 'Row D': 'ΔfhuA', 'Row E': 'ΔfhuA + Lr3' };
    for (const [k, v] of Object.entries(names)) await setField(m.locator(`#chart-names [data-key="${k}"] input[type=text]`), v);
    await m.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(600);
    const s2 = await p.evaluate(() => { const el = images.filter(i => i && i.type === 'chart').pop(); el._chartStat = null; el._chartKey = ''; const S = _chartStatsCached(el); return { names: S.series.map(x => x.name), pts: S.series.map(x => x.points.map(q => [q.x, q.y, q.n])) }; });
    expect(s2.names.join('|') === Object.values(names).join('|'), 'names: ' + s2.names.join('|'));
    let worst = 0, npts = 0;
    s2.pts.forEach((sr, k) => sr.forEach(([x, y, nn]) => { npts++; const t = truth[Math.round(x * 60)][k]; worst = Math.max(worst, Math.abs(y - t)); if (nn !== 3) worst = 1; }));
    expect(npts === 4 * 49 && worst < 1e-9, `${npts} points, worst ${worst}`);
    return `${st.kind}, X title "${st.xt}", "${st.lbl}"; status "${st.info.split(' · ').slice(2).join(' · ')}"; names kept: ${s2.names.join(', ')}; ${npts} points = row means minus the blank (worst ${worst.toExponential(1)})`;
  });

  await step(T, 'Plate reader: h:mm under a Time header, minutes, decimal hours, and an export with no blank row each open as a line chart with a Plate wells row', async () => {
    const cases = [
      ['h:mm', 'Gen5_hmm.csv', { rowsL: ['A', 'B', 'C'], n: 25, every: 10, fmt: t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }, st => st.xt === 'Time (h)' && /Time read as h:mm time, in hours/.test(st.info)],
      ['minutes', 'SoftMax_min.csv', { rowsL: ['A', 'B', 'C'], n: 25, every: 10, fmt: t => String(t), header: 'Time (min)' }, st => st.x === 'Time (min)'],
      ['decimal hours', 'export_hours.csv', { rowsL: ['A', 'B', 'C'], n: 33, every: 15, fmt: t => String(+(t / 60).toFixed(4)), header: 'Time (h)' }, st => st.x === 'Time (h)'],
      ['no blank row', 'Gen5_noblank.csv', { rowsL: ['B', 'C', 'D'], n: 25, every: 10, fmt: hms }, st => st.lbl === 'Plate wells (9: B1–D3)'],
    ];
    const out = [];
    const m = p.locator('#chart-modal');
    for (const [label, name, o, ok] of cases) {
      const { f } = plateExport(name, o);
      await L.pickFiles(T, p.getByText('Drop or click to add images'), [f]);
      await m.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
      const st = await chartState();
      await m.locator('#chart-wells-by').selectOption({ label: 'by plate row (A, B, C…)' }); await p.waitForTimeout(200);
      const series = await m.evaluate(e => [...e.querySelectorAll('#chart-names [data-key]')].map(r => r.dataset.key));
      await m.locator('button', { hasText: /^Cancel$/ }).click(); await p.waitForTimeout(300);
      expect(st.kind === 'Line' && st.wells && ok(st) && series.length === o.rowsL.length, label + ': ' + JSON.stringify(st) + ' series ' + series);
      out.push(`${label}: X "${st.x}", X title "${st.xt}", "${st.lbl}", ${series.length} rows`);
    }
    return out.join('; ');
  });

  await step(T, 'A line chart that can draw nothing says why (x column of words), and Cancel takes it away', async () => {
    const odf = path.join(inp, 'od_by_day.csv'); fs.writeFileSync(odf, 'timepoint,od\nday one,0.1\nday two,0.2\nday three,0.3\n');
    const n0 = (await panels()).length;
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [odf]);
    const m = p.locator('#chart-modal'); await m.waitFor({ state: 'visible' });
    await m.locator('#chart-kind').selectOption({ label: 'Line' }); await p.waitForTimeout(300);
    const info = (await m.locator('#chart-delim-info').innerText()).replace(/\s+/g, ' ');
    await m.locator('button', { hasText: /^Cancel$/ }).click(); await p.waitForTimeout(300);
    const n1 = (await panels()).length;
    const msg = (info.match(/⚠ nothing drawn[^⚠]*/) || [''])[0].trim();
    expect(/⚠ nothing drawn: the x column “timepoint” holds no numbers/.test(info) && n1 === n0, info + ' panels ' + n0 + ' → ' + n1);
    return `"${msg}"; Cancel: panels ${n0} → ${n1}`;
  });

  await L.finish(T);
})();
