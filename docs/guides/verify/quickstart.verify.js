// Verifies the 2-minute quick start in docs/guides/README.md through the visible UI:
// add images → grid → letters → journal preset → check → export.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

(async () => {
  const T = await L.start('quickstart');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');
  const files = [
    I.fluorTiff(path.join(inp, 'C1-HeLa_DMSO_DAPI.tif'), 'DAPI'),
    I.fluorTiff(path.join(inp, 'C2-HeLa_DMSO_GFP.tif'), 'GFP'),
    I.fluorTiff(path.join(inp, 'C3-HeLa_DMSO_CellMask.tif'), 'CellMask'),
    I.blotTiff(path.join(inp, 'PhoA_blot.tif')),
  ];

  await step(T, '1. Drop or click to add images → pick four files', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), files);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 15000 });
    const rows = await L.panelRows(T);
    expect(rows.length === 4, 'image list has ' + rows.length + ' rows');
    return rows.map(r => r.split(' ')[1]).join(', ');
  });

  await step(T, '1b. ImageJ calibration is read: calibrated panels get a scale bar, the blot does not', async () => {
    const st = await p.evaluate(() => images.filter(Boolean).map(im => ({ n: im.name, um: im.umPerPx || 0, sb: !!(im.scaleBar && im.scaleBar.enabled !== false && im.umPerPx) })));
    expect(st.slice(0, 3).every(s => Math.abs(s.um - 0.108333) < 1e-4), 'µm/px not read: ' + JSON.stringify(st));
    return st.map(s => `${s.n.split('_').pop()}: ${s.um ? s.um.toFixed(5) + ' µm/px' : 'uncalibrated'}`).join('; ');
  });

  // ux2: a micrograph without calibration had no way to a scale bar from the quick start.
  await step(T, '1b2. Right-click a panel › 📏 Scale bar / calibrate… opens its ⚙ at the calibration (Objective, 🔬 Calibrate from image, 🔍 Auto-detect)', async () => {
    const cr = await p.locator('#fig-canvas').boundingBox();
    const b = await p.evaluate(() => panelBounds.find(x => (x.idx ?? x.i) === 3));
    await p.mouse.click(cr.x + b.x + b.w / 2, cr.y + b.y + b.h / 2, { button: 'right' });
    await p.locator('#panel-ctx-menu').waitFor({ state: 'visible' });
    await p.locator('#panel-ctx-menu').getByText('📏 Scale bar / calibrate…').click();
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => { const a = document.activeElement, it = a && a.closest('.img-item');
      return { cls: a && a.className, name: it ? it.querySelector('.img-name, .name')?.textContent || it.innerText.split('\n').find(l => /\.tif/.test(l)) : '', btns: it ? [...it.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => /Calibrate from image|Auto-detect/.test(t)) : [] }; });
    expect(/f-obj/.test(st.cls) && /PhoA_blot/.test(st.name) && st.btns.length === 2, JSON.stringify(st));
    await p.keyboard.press('Escape');
    // the same place by ⌘K: the selected panel (D, just right-clicked) or the first uncalibrated one
    await L.toasts(T);
    const hits = await L.cmdk(T, 'add scale bar');
    await p.waitForTimeout(400);
    const t = await p.locator('#toast').textContent();   // the same text as the right-click's, so read it directly
    const cls = await p.evaluate(() => document.activeElement && document.activeElement.className);
    await p.keyboard.press('Escape');
    expect(/^Scale bar: add one to a micrograph/.test(hits[0]) && /Panel D has no calibration yet/.test(t) && /f-obj/.test(cls), hits[0] + ' | ' + t + ' | ' + cls);
    return `focus in Objective of ${st.name.trim()}; buttons ${st.btns.join(', ')}; ⌘K "add scale bar" → ${hits[0]} → "${t.slice(0, 110)}…"`;
  });

  await step(T, '1c. Images › Auto-channels colours the channels from their file names', async () => {
    await btn(T, 'Auto-channels').click(); await p.waitForTimeout(500);
    const luts = await p.evaluate(() => images.filter(Boolean).map(im => im.lut || im.fluorLut || ''));
    expect(luts.slice(0, 3).every(Boolean), 'LUTs ' + luts);
    return luts.join(', ');
  });

  // ux4: four pictures dropped on an empty figure arrive as 2 × 2 (three as 3 × 1); nothing to type
  await step(T, '2. Four pictures arrive as a 2 × 2 grid: Arrange reads Columns 2, Rows 2 without typing', async () => {
    await L.openSection(T, 'Arrange');
    const g = await p.evaluate(() => [document.getElementById('cols').value, document.getElementById('rows').value]);
    expect(g[0] === '2' && g[1] === '2', 'grid is ' + g);
    return 'Columns ' + g[0] + ', Rows ' + g[1];
  });

  await step(T, '3. Letters A–D are on; Look › Label format › a b c changes them', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#label-format').selectOption({ label: 'a b c' });
    await p.waitForTimeout(300);
    const labs = await p.evaluate(() => images.filter(Boolean).map(im => formatLabel(im.label)));
    expect(labs.join('') === 'abcd', 'labels ' + labs.join(','));
    await p.locator('#label-format').selectOption({ label: 'A B C' });
    return labs.join(' ');
  });

  // ux4 (newcomer4): name the figure before the journal — PLOS takes the number from it, and the Save dialog uses it
  await step(T, '4a. Export › File name: type Fig1 before choosing the journal', async () => {
    await L.openSection(T, 'Export');
    await p.locator('#export-name').fill('Fig1'); await p.locator('#export-name').press('Tab');
    return 'File name ' + await p.locator('#export-name').inputValue();
  });

  // ux2: the preset now checks the height too — a 2 × 2 at 183 mm printed 177.5 mm tall, over
  // Nature's 170 mm, so it picks 89 mm (single column) and says so in its toast.
  await step(T, '4. ⌘K → type "nature" → Enter applies the Nature preset (89 mm: the widest that keeps a 2 × 2 within 170 mm)', async () => {
    const hits = await L.cmdk(T, 'nature');
    expect(/^Journal: Nature/.test(hits[0]), 'top hit: ' + hits[0]);
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ j: document.getElementById('target-journal').value, w: document.getElementById('export-width-mm').value, t: document.getElementById('toast').textContent }));
    expect(/nature/i.test(st.j) && +st.w === 89, JSON.stringify(st));
    // ux4: the toast says the width once, as chosen: "kept" only for a width set before the preset
    expect(/^Nature preset applied — printed width 89 mm — the widest that keeps it within 170 mm tall, Arial — letters 7 pt/.test(st.t), 'toast: ' + st.t);
    expect(!/kept at 183/.test(st.t), 'toast: ' + st.t);
    return 'Target journal ' + st.j + ', printed width ' + st.w + ' mm — toast: ' + st.t;
  });

  await step(T, '5. Check › ✓ Check journal compliance → the report opens with one row per rule', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg');
    await rep.waitFor({ state: 'visible' });
    const title = await p.locator('#im-title').innerText();
    expect(/Nature compliance — \d+\/\d+ passed/.test(title), title);
    await L.shot(T, 'quickstart-compliance', rep.locator('xpath=./*[1]'), { doc: true });
    await p.keyboard.press('Escape');
    return title;
  });

  // ux2: the report's "Auto contrast" button now fixes the Text contrast row with Look ›
  // Panel labels › Background ticked (the default): the chips darken and letters go white.
  await step(T, '5b. Text contrast: the row\'s Auto contrast button fixes it (Background stays ticked) and says what it did', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    let rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const tc = rep.locator('.compliance-row', { hasText: 'Text contrast' });
    const before = (await tc.innerText()).replace(/\s+/g, ' ');
    expect(await tc.getByRole('button', { name: 'Auto contrast' }).count() === 1 && !/^✓/.test(before), 'no Auto contrast button on a failing row: ' + before);
    await tc.getByRole('button', { name: 'Auto contrast' }).click();
    await p.waitForTimeout(400);
    const t = await p.locator('#toast').textContent();
    expect(/Auto contrast on/.test(t), 'toast: ' + t);
    expect(await p.locator('#label-bg').isChecked(), 'Background was unticked');
    rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Text contrast\n([^\n]*)/) || [])[1] || '';
    expect(/✓/.test(row), 'Text contrast row: ' + row);
    const title = await p.locator('#im-title').innerText();
    await p.keyboard.press('Escape');
    return title + ' — before: ' + before.slice(0, 60) + ' | toast: ' + t.slice(0, 90);
  });

  await step(T, '5c. Printed height passes: the preset already chose 89 mm — single column (Nature) for the 2 × 2', async () => {
    await L.openSection(T, 'Export');
    expect(await p.locator('#export-width-mm').inputValue() === '89', 'width ' + await p.locator('#export-width-mm').inputValue());
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Printed height\n([^\n]*)/) || [])[1] || '';
    expect(/✓/.test(row), 'Printed height: ' + row);
    const title = await p.locator('#im-title').innerText();
    await p.keyboard.press('Escape');
    return title + ' — ' + row;
  });

  let pdfFile;
  await step(T, '6a. ↓ PDF lossless → Save PDF writes an 89 mm wide page', async () => {
    const r = await L.exportVia(T, 'PDF lossless');
    expect(/Fig1/.test(path.basename(r.file)), 'the Save dialog did not take the File name: ' + r.file);
    pdfFile = r.file;
    const s = fs.readFileSync(pdfFile, 'latin1');
    const mb = s.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
    expect(mb, 'no MediaBox');
    const mm = (+mb[1]) / 72 * 25.4;
    expect(Math.abs(mm - 89) < 0.6, 'page width ' + mm.toFixed(1) + ' mm');
    return path.basename(pdfFile) + ': ' + mm.toFixed(1) + ' × ' + ((+mb[2]) / 72 * 25.4).toFixed(1) + ' mm';
  });

  await step(T, '6b. ↓ TIFF → Save TIFF is 300 dpi at 89 mm (saved after the PDF)', async () => {
    const r = await L.exportVia(T, 'TIFF');
    expect(/^Fig1\./.test(path.basename(r.file)), 'file ' + r.file);
    const info = L.tiffInfo(fs.readFileSync(r.file));
    const mm = info.w / info.xres * 25.4;
    expect(Math.abs(info.xres - 300) < 1 && Math.abs(mm - 89) < 1, JSON.stringify(info));
    return `${path.basename(r.file)}: ${info.w}×${info.h} px, ${info.xres} dpi, ${mm.toFixed(1)} mm`;
  });

  // ux2: the row used to check only the format saved last, so PDF then TIFF failed under Nature.
  await step(T, '7. Re-check: the Export format row passes — it counts every format saved since the figure last changed', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Export format\n([^\n]*)/) || [])[1] || '';
    expect(/✓/.test(row) && /since the figure last changed/.test(row), 'Export format: ' + row);
    const title = await p.locator('#im-title').innerText();
    const open = [...txt.matchAll(/\n([⚠✗])\n([^\n]+)/g)].map(m => m[1] + ' ' + m[2]);
    await p.keyboard.press('Escape');
    return title + ' — ' + row.split(' · ')[0] + (open.length ? ' — still open: ' + open.join(', ') : '');
  });

  await step(T, 'screenshot: the figure after the quick start', async () => {
    const got = p.locator('button', { hasText: 'Got it' });
    if (await got.count()) await got.first().click().catch(() => {});
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } }); await p.keyboard.press('Escape');   // deselect
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(600);
    await L.shot(T, 'quickstart-figure', p.locator('#canvas-container'), { doc: true });
  });

  // ux3 (newcomer3-04): an export made before the figure last changed no longer counts
  await step(T, '8. After a change, the Export format row is ℹ "not checked — the figure changed after it was last exported"; its Save as … button saves again and the row passes', async () => {
    // a change to the figure: the 2 × 2 laid out as 4 × 1 (Look › Label format alone is not
    // counted as a change — see ISSUES.md)
    await L.openSection(T, 'Arrange');
    await p.getByLabel('Columns', { exact: true }).fill('4'); await p.getByLabel('Columns', { exact: true }).press('Tab'); await p.waitForTimeout(400);
    await p.getByLabel('Rows', { exact: true }).fill('1'); await p.getByLabel('Rows', { exact: true }).press('Tab'); await p.waitForTimeout(400);
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    let rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const row = rep.locator('.compliance-row', { hasText: 'Export format' });
    const before = (await row.innerText({ timeout: 3000 }).catch(async () => 'NO ROW: ' + (await rep.innerText()).slice(0, 3000))).replace(/\s+/g, ' ').trim();
    if (/^NO ROW/.test(before)) throw new Error(before);
    const b = row.getByRole('button').first();
    const bt = (await b.innerText({ timeout: 3000 }).catch(() => 'NO BUTTON')).trim();
    expect(/^Save as /.test(bt), 'button: ' + bt + ' | row: ' + before);
    expect(/^ℹ/.test(before) && /not checked — the figure changed after it was last exported/.test(before), 'row: ' + before);
    await b.click();
    const m = p.locator('#preflight-modal'); await m.waitFor({ state: 'visible' });
    const f = await L.download(T, () => m.locator('button', { hasText: /^Save / }).first().click(), /./, 60000);
    await p.waitForTimeout(400);
    if (await rep.isVisible()) await p.keyboard.press('Escape');
    await btn(T, '✓ Check journal compliance').click();
    rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const after = ((await rep.innerText()).match(/Export format\n([^\n]*)/) || [])[1] || '';
    await p.keyboard.press('Escape');
    expect(/✓/.test(after), 'after saving again: ' + after);
    return `${before.slice(0, 150)} → [${bt}] → ${path.basename(f)} → ${after.split(' · ')[0]}`;
  });

  // ISSUES (round 3) "Look › Label format is not counted as a change": re-checked on this build
  await step(T, 'ISSUES: after the export, Look › Label format a b c — the Export format row, and what one Ctrl/⌘+Z undoes', async () => {
    await L.openSection(T, 'Look');
    const cols0 = await p.evaluate(() => document.getElementById('cols').value);
    await p.locator('#label-format').selectOption({ label: 'a b c' }); await p.waitForTimeout(400);
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const row = ((await rep.innerText()).match(/\n([⚠✗✓ℹ])\nExport format\n([^\n]*)/) || []);
    await p.keyboard.press('Escape');
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({ fmt: document.getElementById('label-format').selectedOptions[0].text, cols: document.getElementById('cols').value }));
    T._lf = { row: row.slice(1), after, cols0 };
    // still open: the label-format change is not counted (the row stays ✓); fixed: one undo takes back only it
    expect(row[1] === '✓' && /since the figure last changed/.test(row[2] || '') && after.fmt === 'A B C' && after.cols === cols0, JSON.stringify(T._lf));
    return JSON.stringify(T._lf);
  });

  // round 5 (newcomer5-03): a CSV picked with the pictures becomes a chart panel; replicate
  // columns are averaged and said so, and a file name ending in its unit gives the Y title.
  await step(T, '1d. (fresh page) Four pictures and swim_diameters_mm.csv (Strain, Rep 1–3) in one pick: a chart panel, the toast says "the mean of Rep 1, Rep 2, Rep 3", and a double-click shows the Y title "swim diameters (mm)"', async () => {
    const csv = path.join(inp, 'swim_diameters_mm.csv');
    fs.writeFileSync(csv, '\ufeffStrain,Rep 1,Rep 2,Rep 3\r\nWT,40.5,44.2,40.3\r\nfliC,6.1,5.5,6.4\r\nmotA,31.0,35.3,32.2\r\n,,,\r\n');
    const pics = [];
    for (let i = 0; i < 4; i++) pics.push(await L.canvasImage(T, path.join(inp, `IMG_77${i}.png`), 400, 300, (ctx, w, h, rnd) => {
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, h); for (let k = 0; k < 60; k++) { ctx.fillStyle = `hsl(${rnd() * 360},60%,60%)`; ctx.fillRect(rnd() * w, rnd() * h, 12, 12); } }, { seed: 70 + i }));
    const q = await T.context.newPage();
    q.setDefaultTimeout(90000);
    q.on('pageerror', e => T.errors.push('pageerror (CSV page): ' + e.message));
    const keep = { page: T.page, seen: T._toastSeen };
    T.page = q; T._toastSeen = 0;
    try {
      await q.goto(L.APP_URL);
      await q.waitForFunction(() => typeof render === 'function');
      await q.evaluate(() => { window.__toasts = []; const el = document.getElementById('toast');
        new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__toasts.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); });
      await q.getByRole('button', { name: /Dismiss/ }).click({ timeout: 1500 }).catch(() => {});
      await L.pickFiles(T, q.getByText('Drop or click to add images'), [...pics, csv]);
      await q.waitForFunction(() => images.filter(Boolean).length === 5 && images.some(p => p && p.type === 'chart'), null, { timeout: 20000 });
      await q.waitForTimeout(1000);
      const t = await L.toasts(T);
      const grid = await q.evaluate(() => [document.getElementById('cols').value, document.getElementById('rows').value].join(' × '));
      expect(/bar chart of the mean of Rep 1, Rep 2, Rep 3 by Strain/.test(t), 'toast: ' + t);
      await q.keyboard.press('Escape');
      await q.locator('#canvas-wrap').click({ position: { x: 5, y: 5 } }).catch(() => {});
      await q.evaluate(() => render());
      const ci = await q.evaluate(() => images.findIndex(p => p && p.type === 'chart'));
      const cr = await q.locator('#fig-canvas').boundingBox();
      const b = await q.evaluate(i => panelBounds.find(x => (x.idx ?? x.i) === i), ci);
      await q.mouse.dblclick(cr.x + b.x + b.w / 2, cr.y + b.y + b.h / 2);
      await q.locator('#chart-ytitle').waitFor({ state: 'visible', timeout: 15000 });
      const yt = await q.locator('#chart-ytitle').inputValue();
      await q.keyboard.press('Escape');
      expect(yt === 'swim diameters (mm)', 'Y title "' + yt + '"');
      return `grid ${grid}; Y title "${yt}"; toast: ${t.slice(0, 300)}`;
    } finally { T.page = keep.page; T._toastSeen = keep.seen; await q.close().catch(() => {}); }
  });

  await L.finish(T);
})();
