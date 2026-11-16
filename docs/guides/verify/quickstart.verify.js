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

  await step(T, '2. Arrange › Columns 2, Rows 2', async () => {
    await L.openSection(T, 'Arrange');
    await p.getByLabel('Columns', { exact: true }).fill('2');
    await p.getByLabel('Columns', { exact: true }).press('Tab');
    await p.getByLabel('Rows', { exact: true }).fill('2');
    await p.getByLabel('Rows', { exact: true }).press('Tab');
    await p.waitForTimeout(400);
    const g = await p.evaluate(() => [document.getElementById('cols').value, document.getElementById('rows').value]);
    expect(g[0] === '2' && g[1] === '2', 'grid is ' + g);
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

  // ux2: the preset now checks the height too — a 2 × 2 at 183 mm printed 177.5 mm tall, over
  // Nature's 170 mm, so it picks 89 mm (single column) and says so in its toast.
  await step(T, '4. ⌘K → type "nature" → Enter applies the Nature preset (89 mm: the widest that keeps a 2 × 2 within 170 mm)', async () => {
    const hits = await L.cmdk(T, 'nature');
    expect(/^Journal: Nature/.test(hits[0]), 'top hit: ' + hits[0]);
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ j: document.getElementById('target-journal').value, w: document.getElementById('export-width-mm').value, t: document.getElementById('toast').textContent }));
    expect(/nature/i.test(st.j) && +st.w === 89, JSON.stringify(st));
    expect(/89 mm wide — the widest that keeps it within 170 mm tall/.test(st.t), 'toast: ' + st.t);
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
    const r = await L.exportVia(T, 'PDF lossless', { name: 'Fig1' });
    pdfFile = r.file;
    const s = fs.readFileSync(pdfFile, 'latin1');
    const mb = s.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
    expect(mb, 'no MediaBox');
    const mm = (+mb[1]) / 72 * 25.4;
    expect(Math.abs(mm - 89) < 0.6, 'page width ' + mm.toFixed(1) + ' mm');
    return path.basename(pdfFile) + ': ' + mm.toFixed(1) + ' × ' + ((+mb[2]) / 72 * 25.4).toFixed(1) + ' mm';
  });

  await step(T, '6b. ↓ TIFF → Save TIFF is 300 dpi at 89 mm (saved after the PDF)', async () => {
    const r = await L.exportVia(T, 'TIFF', { name: 'Fig1' });
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

  await L.finish(T);
})();
