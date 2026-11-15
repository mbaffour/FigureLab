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

  await step(T, '4. ⌘K → type "nature" → Enter applies the Nature preset', async () => {
    const hits = await L.cmdk(T, 'nature');
    expect(/^Journal: Nature/.test(hits[0]), 'top hit: ' + hits[0]);
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ j: document.getElementById('target-journal').value, w: document.getElementById('export-width-mm').value }));
    expect(/nature/i.test(st.j) && +st.w === 183, JSON.stringify(st));
    return 'Target journal ' + st.j + ', printed width ' + st.w + ' mm';
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

  // ISSUES.md: the report's "Auto contrast" button leaves the Text contrast row failing while
  // Look › Panel labels › Background is ticked (the default); unticking Background fixes it.
  await step(T, '5b. Text contrast: untick Look › Background (letters then pick black or white) and re-check', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#label-bg').uncheck();
    await p.waitForTimeout(500);
    const auto = await p.locator('#label-auto-color').isChecked();
    expect(auto, 'Auto contrast did not switch on');
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Text contrast\n([^\n]*)/) || [])[1] || '';
    expect(/✓/.test(row), 'Text contrast row: ' + row);
    const title = await p.locator('#im-title').innerText();
    await p.keyboard.press('Escape');
    return title;
  });

  await step(T, '5c. Printed height fails at 183 mm for a 2 × 2: Export › Printed width › 89 mm — single column (Nature) fixes it', async () => {
    await L.openSection(T, 'Export');
    await p.locator('#export-width-mm').selectOption({ label: '89 mm — single column (Nature)' });
    await p.waitForTimeout(500);
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
  await step(T, '6a. ↓ TIFF → Save TIFF is 300 dpi at 89 mm', async () => {
    const r = await L.exportVia(T, 'TIFF', { name: 'Fig1' });
    const info = L.tiffInfo(fs.readFileSync(r.file));
    const mm = info.w / info.xres * 25.4;
    expect(Math.abs(info.xres - 300) < 1 && Math.abs(mm - 89) < 1, JSON.stringify(info));
    return `${info.w}×${info.h} px, ${info.xres} dpi, ${mm.toFixed(1)} mm`;
  });

  await step(T, '6b. ↓ PDF lossless → Save PDF writes an 89 mm wide page (saved last)', async () => {
    const r = await L.exportVia(T, 'PDF lossless', { name: 'Fig1' });
    pdfFile = r.file;
    const s = fs.readFileSync(pdfFile, 'latin1');
    const mb = s.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
    expect(mb, 'no MediaBox');
    const mm = (+mb[1]) / 72 * 25.4;
    expect(Math.abs(mm - 89) < 0.6, 'page width ' + mm.toFixed(1) + ' mm');
    return path.basename(pdfFile) + ': ' + mm.toFixed(1) + ' × ' + ((+mb[2]) / 72 * 25.4).toFixed(1) + ' mm';
  });

  await step(T, '7. Re-check: the Export format row now passes (PDF was saved last)', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Export format\n([^\n]*)/) || [])[1] || '';
    expect(/✓/.test(row), 'Export format: ' + row);
    const title = await p.locator('#im-title').innerText();
    const open = [...txt.matchAll(/\n([⚠✗])\n([^\n]+)/g)].map(m => m[1] + ' ' + m[2]);
    await p.keyboard.press('Escape');
    return title + (open.length ? ' — still open: ' + open.join(', ') : '');
  });

  await step(T, 'screenshot: the figure after the quick start', async () => {
    const got = p.locator('button', { hasText: 'Got it' });
    if (await got.count()) await got.first().click().catch(() => {});
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(600);
    await L.shot(T, 'quickstart-figure', p.locator('#canvas-container'), { doc: true });
  });

  await L.finish(T);
})();
