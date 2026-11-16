// @ts-check
// Usability round 3 — revising a finished figure: replace or swap a panel (grid and
// freeform, a merge's channels), switch grid ↔ freeform, undo, the tutorial's restore,
// a printed width or journal changed after the fact, a reopened session, and ✕ New.
// Each test drives the path a tester took and failed on (finding IDs in the titles).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

// A 16-bit greyscale TIFF (uncompressed, little-endian) with an ImageJ pixel size.
function tiff16(px, w, h, umPerPx) {
  const desc = Buffer.from('ImageJ=1.54f\nunit=micron\n\0', 'utf8');
  const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 1], [270, 2, desc.length, 'DESC'],
    [273, 4, 1, 'DATA'], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, w * h * 2], [282, 5, 1, 'RES'], [283, 5, 1, 'RES'], [296, 3, 1, 1]];
  const ifd = 8, descOff = ifd + 2 + tags.length * 12 + 4, resOff = descOff + desc.length + (desc.length & 1), dataOff = resOff + 8;
  const buf = Buffer.alloc(dataOff + w * h * 2);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifd, 4); buf.writeUInt16LE(tags.length, ifd);
  tags.forEach(([t, ty, c, v], k) => { const o = ifd + 2 + k * 12; buf.writeUInt16LE(t, o); buf.writeUInt16LE(ty, o + 2); buf.writeUInt32LE(c, o + 4);
    const val = v === 'DESC' ? descOff : v === 'DATA' ? dataOff : v === 'RES' ? resOff : v; if (ty === 3) buf.writeUInt16LE(val, o + 8); else buf.writeUInt32LE(val, o + 8); });
  desc.copy(buf, descOff); buf.writeUInt32LE(Math.round(1e6 / umPerPx), resOff); buf.writeUInt32LE(1e6, resOff + 4);
  for (let i = 0; i < px.length; i++) buf.writeUInt16LE(px[i], dataOff + i * 2);
  return buf.toString('base64');
}
function field(w, h, bg, block, hot) { const a = new Uint16Array(w * h).fill(bg);
  for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) a[y * w + x] = block; a[(h - 2) * w + (w - 2)] = hot; return a; }
async function dropTiffs(page, files) {
  const n0 = await page.evaluate(() => images.filter(Boolean).length);
  await page.evaluate(async (fs) => { await addFiles(fs.map(([b64, name]) => { const b = atob(b64), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], name, { type: 'image/tiff' }); })); }, files);
  await page.waitForFunction((n) => images.filter(Boolean).length === n && images.filter(Boolean).every(im => !im.img || (im.img.complete && im.img.naturalWidth > 0)), n0 + files.length);
}
// A file for a hidden <input type=file>, as the picker hands it over.
function tiffFile(b64, name) { return { name, mimeType: 'image/tiff', buffer: Buffer.from(b64, 'base64') }; }
async function waitDecoded(page) {
  await page.waitForFunction(() => images.filter(Boolean).every(im => !im.img || (im.img.complete && im.img.naturalWidth > 0))
    && images.filter(Boolean).every(im => (im.channels || []).every(c => !c.img || (c.img.complete && c.img.naturalWidth > 0))));
}

test('fluor3-01: Restore my figure after a tutorial keeps the 16-bit samples, so levels stay in camera counts', async ({ page }) => {
  const errors = await loadApp(page);
  await dropTiffs(page, [[tiff16(field(64, 64, 200, 6000, 56346), 64, 64, 0.108), 'DMSO_GFP.tif'],
    [tiff16(field(64, 64, 200, 6000, 30000), 64, 64, 0.108), 'Torin_GFP.tif']]);
  await page.evaluate(() => { images.forEach(im => { _setLevelNative(im, 'black', 300); _setLevelNative(im, 'white', 12000); }); render(); });
  page.once('dialog', d => d.accept());
  await page.evaluate(async () => { await startTutorial('channels'); });
  await page.waitForSelector('#tour-ov');
  await page.keyboard.press('Escape');
  await page.locator('#cm-ok').click();                       // Restore my figure
  await waitDecoded(page);
  await page.waitForFunction(() => images.filter(Boolean).length === 2 && images.every(im => _rawOf(im)));
  const r = await page.evaluate(() => images.map(im => _rangeText(im)));
  expect(r).toEqual(['300–12000', '300–12000']);              // was: 8-bit values, "native samples not kept"
  const meth = await page.evaluate(() => generateMethodsParagraph());
  expect(meth).not.toMatch(/native samples were not available/);
  expect(errors).toEqual([]);
});

test('freeform3-02: × in the Elements list is its own undo step — Ctrl+Z brings the object back and keeps a label added before', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 40, y: 40, w: 200, h: 150, label: 'Bacterium', name: 'cell.png' }]);
  // a text object added after the picture (one undo step of its own)
  await page.evaluate(() => { pushUndo(); annotations.push({ type: 'text', xf: 0.5, yf: 0.1, text: 'probe', color: '#000000', fontSize: 14 }); renderAnnotationList(); render(); });
  const row = page.locator('#fm-elem-list .tpl-saved', { hasText: 'Bacterium' });
  await row.locator('button').click();
  expect(await page.evaluate(() => [freeformElements.length, annotations.map(a => a.text)])).toEqual([0, ['probe']]);
  await page.evaluate(() => undo());
  const back = await page.evaluate(() => [freeformElements.map(e => e.label), annotations.map(a => a.text)]);
  expect(back).toEqual([['Bacterium'], ['probe']]);           // was: Bacterium back, 'probe' gone
  expect(errors).toEqual([]);
});

test('charts3-05: a session reopens at the printed width it was saved with, even one the preset computed', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 1); sv('rows', 4); onLayoutChange(); render(); });
  await page.locator('#target-journal').selectOption('plos');
  const w0 = await page.evaluate(() => getTargetWidthMm());
  expect(w0).toBeGreaterThan(0);
  // a width that is no option of the list (the preset's "fits the height" one, or one typed)
  await page.evaluate(() => { _ckSetWidthOption(JOURNALS.plos, 156.1); sv('export-width-mm', '156.1'); render(); });
  const saved = await page.evaluate(() => JSON.stringify(serializeSession(true)));
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate((t) => _loadSessionText(t, 'Fig3-session.json'), saved);
  const r = await page.evaluate(() => ({ w: getTargetWidthMm(), sel: gv('export-width-mm'), j: gv('target-journal') }));
  expect(r).toEqual({ w: 156.1, sel: '156.1', j: 'plos' });   // was: blank select, Free, 178 mm
  expect(errors).toEqual([]);
});

// The Display ranges row of the compliance report, as text.
async function rangeRow(page) {
  return page.evaluate(() => { checkCompliance(); const rows = [...document.querySelectorAll('.compliance-row')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
    return rows.find(t => /Display ranges by channel/.test(t)) || ''; });
}
// Every toast since the last call, newest last (one #toast element shows only the latest).
async function lastToast(page) {
  return page.evaluate(() => { if (!window.__toasts) { window.__toasts = []; const t = toast; window.toast = (m, ty) => { window.__toasts.push(m); return t(m, ty); }; return ''; }
    const all = window.__toasts.join('\n'); window.__toasts = []; return all; });
}

test('fluor3-02: ⇄ Replace image keeps the display range in camera counts, and the compliance row compares a greyscale panel too', async ({ page }) => {
  const errors = await loadApp(page);
  await dropTiffs(page, [[tiff16(field(64, 64, 200, 6000, 56346), 64, 64, 0.108), 'Ctrl_s02_GFP.tif'],
    [tiff16(field(64, 64, 200, 6000, 30000), 64, 64, 0.108), 'Torin1_s02_GFP.tif']]);
  await page.evaluate(() => { images.forEach(im => { _setLevelNative(im, 'black', 300); _setLevelNative(im, 'white', 12000); });
    images[0].lut = 'green'; images[1].lut = 'none'; images[1].grayscale = true; render(); });
  await lastToast(page);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => openReplaceImage(1))]);
  await fc.setFiles(tiffFile(tiff16(field(64, 64, 180, 7000, 48000), 64, 64, 0.108), 'Torin1_s05_GFP.tif'));
  await page.waitForFunction(() => images[1].name === 'Torin1_s05_GFP.tif' && _rawOf(images[1]));
  expect(await page.evaluate(() => _rangeText(images[1]))).toBe('300–12000');      // was 278–11119 (8-bit numbers kept)
  expect(await lastToast(page)).toContain('display range 300–12000 (native values) kept');
  expect(await rangeRow(page)).toMatch(/✓/);
  // a greyscale panel off its channel's range is caught by the row, as Methods says it
  await page.evaluate(() => { _setLevelNative(images[1], 'white', 11119); render(); });
  const row = await rangeRow(page);
  expect(row).not.toMatch(/Same range per channel across panels ✓/);              // was ✓ while Methods said they differ
  expect(row).toMatch(/300–11119/);
  // an 8-bit file cannot hold the range: said before and after, never "kept"
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => openReplaceImage(1))]);
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 8, 8); return c.toDataURL('image/png').split(',')[1]; });
  await fc2.setFiles({ name: 'Torin1_s05_GFP.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => images[1].name === 'Torin1_s05_GFP.png');
  const t = await lastToast(page);
  expect(t).toMatch(/display range 300–11119 \(native values\) cannot be kept/);
  expect(await page.evaluate(() => images[1].srcBits || 0)).toBe(0);               // no "16-bit file, samples not kept" for an 8-bit file
  expect(errors).toEqual([]);
});

test('fluor3-03: a merge’s channel takes another field with ⇄ in ⚙ › Channels, keeping its colour and range; an added channel takes its channel’s range; the grid never shifts', async ({ page }) => {
  const errors = await loadApp(page);
  await dropTiffs(page, [
    [tiff16(field(64, 64, 100, 3000, 40000), 64, 64, 0.108), 'Ctrl_s02_DAPI.tif'],
    [tiff16(field(64, 64, 200, 6000, 56346), 64, 64, 0.108), 'Ctrl_s02_GFP.tif'],
    [tiff16(field(64, 64, 100, 3000, 41000), 64, 64, 0.108), 'Torin_s02_DAPI.tif'],
    [tiff16(field(64, 64, 200, 6000, 50000), 64, 64, 0.108), 'Torin_s02_GFP.tif'],
  ]);
  await page.evaluate(() => {
    autoDetectChannels();
    images.forEach(im => { const g = /GFP/.test(im.name); _setLevelNative(im, 'black', g ? 300 : 150); _setLevelNative(im, 'white', g ? 12000 : 7000); });
    // two merges (DAPI + GFP), made the way ⚙ › Add channel / Merge channels make them
    document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = false; });
    renderImgList(); document.querySelectorAll('#img-list .panel-pick').forEach((cb, k) => { cb.checked = k < 2; }); mergeTickedPanels();
  });
  await page.evaluate(() => { document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = false; });
    const idx = images.map((im, i) => im && !im.excluded && /Torin/.test(im.name) && !im.channels.length ? i : -1).filter(i => i >= 0);
    document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = idx.includes(+cb.dataset.pick); }); mergeTickedPanels();
    // the split parts hidden by hand while headings are on (a figure saved before sources were marked)
    images.forEach(im => { if (im && im.excluded) delete im._parked; });
    sc('show-col-labels', true); sv('cols', 2); sv('rows', 1); onLayoutChange(); render(); });
  await lastToast(page);
  const before = await page.evaluate(() => _gridPlacements().map(p => p.im ? p.im.name : (p.imgIdx === -1 ? '·' : '?')));
  expect(before.filter(n => n !== '·').length).toBe(2);
  // ⇄ beside the Torin merge's GFP channel, through its own file picker
  const mi = await page.evaluate(() => images.findIndex(im => im && im.channels.length && /Torin/.test(im.name)));
  await page.evaluate((i) => { document.querySelectorAll('#img-list .img-settings').forEach(d => d.classList.add('open')); }, mi);
  const rep = page.locator(`#settings-${mi} .ch-rep-in`).first();
  await rep.setInputFiles(tiffFile(tiff16(field(64, 64, 220, 7000, 61000), 64, 64, 0.108), 'Torin_s05_GFP.tif'));
  await page.waitForFunction((i) => images[i].channels[0].name === 'Torin_s05_GFP.tif', mi);
  const r = await page.evaluate((i) => ({ rng: _rangeText(images[i].channels[0]), lut: images[i].channels[0].lut, cells: _gridPlacements().map(p => p.im ? p.im.name : '·') }), mi);
  expect(r.rng).toBe('300–12000');
  expect(r.lut).toBe('green');
  expect(r.cells).toEqual(before);                                                  // was: a hidden source turned into a blank cell
  expect(await lastToast(page)).toMatch(/colour and display range 300–12000 \(native values\) kept/);
  // × the channel (one undo step) and + Add channel: the grid stays, and the new channel comes in at GFP's range
  await page.locator(`#settings-${mi} .ch-del`).first().click();
  expect(await page.evaluate(() => _gridPlacements().map(p => p.im ? p.im.name : '·'))).toEqual(before);
  await page.locator(`#settings-${mi} .f-add-ch`).setInputFiles(tiffFile(tiff16(field(64, 64, 220, 7000, 61000), 64, 64, 0.108), 'Torin_s05_GFP.tif'));
  await page.waitForFunction((i) => images[i].channels.length === 1, mi);
  expect(await page.evaluate((i) => _rangeText(images[i].channels[0]), mi)).toBe('300–12000');   // was 0–61000 (the file's min–max)
  expect(await page.evaluate(() => _gridPlacements().map(p => p.im ? p.im.name : '·'))).toEqual(before);
  await page.evaluate(() => undo());
  expect(await page.evaluate((i) => images[i].channels.length, mi)).toBe(0);
  expect(errors).toEqual([]);
});

test('newcomer3-09: the replace toast names the caption note it kept', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { images[0].captionNote = 'Colony PCR across fliC: lane 1, ladder'; render(); });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 75; c.height = 100; c.getContext('2d').fillRect(0, 0, 8, 8); return c.toDataURL('image/png').split(',')[1]; });
  await lastToast(page);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => openReplaceImage(0))]);
  await fc.setFiles({ name: 'IMG_8812.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => images[0].name === 'IMG_8812.png');
  expect(await lastToast(page)).toContain('caption note kept: “Colony PCR across fliC: lane 1, ladder” — edit it in ⚙ if it no longer fits');
  expect(errors).toEqual([]);
});
