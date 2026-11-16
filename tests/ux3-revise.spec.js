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

const ZIPREAD = () => {
  window._zipRead = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset); const out = {}; let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true), csize = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
      const off = p + 30 + nlen + elen; let data = bytes.subarray(off, off + csize);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out[name] = data; p = off + csize;
    }
    return out;
  };
};
// A grid of four pictures popped out to freeform; D has a caption note.
async function poppedFigure(page) {
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange();
    images[3].name = 'AcrB_2D_classes_3to1.png'; images[3].captionNote = 'Reference-free 2D class averages of AcrB'; render(); _popOut(); render(); });
}
async function pngOf(page, w, h, fill) {
  const b64 = await page.evaluate(([w, h, fill]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h, fill]);
  return Buffer.from(b64, 'base64');
}

test('freeform3-12: right-click a freeform picture › ⇄ Replace image keeps its place, size, crop, letter and note, and the records name the new file', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await loadApp(page);
  await poppedFigure(page);
  const before = await page.evaluate(() => { const d = freeformElements.find(e => e.type === 'image' && e.label === 'D'); d.cropL = 0.1; render(); return { x: d.x, y: d.y, w: d.w, h: d.h, cropL: d.cropL }; });
  // right-click D on the canvas
  await page.evaluate(() => { zoomToFit(); render(); });
  const pt = await page.evaluate(() => { const d = freeformElements.find(e => e.type === 'image' && e.label === 'D');
    const r = annCanvas.getBoundingClientRect(); return { x: r.left + (d.x + d.w / 2) * r.width / canvasLogicalW, y: r.top + (d.y + d.h / 2) * r.height / canvasLogicalH }; });
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  const items = await page.locator('#panel-ctx-menu > div').allTextContents();
  expect(items.map(t => t.trim())).toEqual(['⇄  Replace image…', '✕  Delete object'].map(t => t.trim()));
  await lastToast(page);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#panel-ctx-menu > div', { hasText: 'Replace image' }).click()]);
  await fc.setFiles({ name: 'AcrB_2D_classes_v2_round3_3to1.png', mimeType: 'image/png', buffer: await pngOf(page, 100, 100, '#c33') });
  await page.waitForFunction(() => freeformElements.some(e => e.type === 'image' && e.name === 'AcrB_2D_classes_v2_round3_3to1.png'));
  const r = await page.evaluate(() => { const d = freeformElements.find(e => e.type === 'image' && e.label === 'D');
    return { x: d.x, y: d.y, w: d.w, h: d.h, cropL: d.cropL, note: d.captionNote, twin: images.find(im => im.id === d.fromPanel).name, n: freeformElements.length }; });
  expect(r).toEqual({ ...before, note: 'Reference-free 2D class averages of AcrB', twin: 'AcrB_2D_classes_v2_round3_3to1.png', n: 4 });
  expect(await lastToast(page)).toMatch(/Picture D: AcrB_2D_classes_3to1\.png → AcrB_2D_classes_v2_round3_3to1\.png — place, crop, letter and settings kept/);
  await page.evaluate(ZIPREAD);
  const z = await page.evaluate(async () => { const c = await _captureDownload(() => exportSubmissionPackage()); const z = await _zipRead(c.data);
    const t = k => new TextDecoder().decode(z[Object.keys(z).find(n => n.endsWith(k))]); return { hist: t('PANEL_HISTORY.txt') }; });
  expect(z.hist).toMatch(/── D ── \(source: AcrB_2D_classes_v2_round3_3to1\.png\)/);   // was: the deleted file
  // Undo is one step: the old picture back
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => freeformElements.find(e => e.type === 'image' && e.label === 'D').name)).toBe('AcrB_2D_classes_3to1.png');
  expect(errors).toEqual([]);
});

test('freeform3-13 / freeform3-14: package panel files carry their own letters after a delete-and-add; a deleted picture leaves the caption and the grid', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await loadApp(page);
  await poppedFigure(page);
  // delete D, add a new picture lettered D (it goes last in the object list)
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(freeformElements.findIndex(e => e.type === 'image' && e.label === 'D')); deleteSelectedElems(); });
  const cap = await page.evaluate(() => _captionText());
  expect(cap).not.toContain('Reference-free 2D class averages');                    // was: still captioned from the deleted file
  await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 120; c.height = 60; c.getContext('2d').fillRect(0, 0, 120, 60);
    addFreeformElement({ type: 'image', src: c.toDataURL('image/png'), x: 400, y: 380, w: 240, h: 120, label: 'D', name: 'v2.png' });
    await new Promise(r => setTimeout(r, 200)); render(); });
  // order the objects so the grid's own order and the canvas's differ
  await page.evaluate(() => { const b = freeformElements.findIndex(e => e.label === 'B'); const [el] = freeformElements.splice(b, 1); freeformElements.push(el); render(); });
  await page.evaluate(ZIPREAD);
  const files = await page.evaluate(async () => { const c = await _captureDownload(() => exportSubmissionPackage()); const z = await _zipRead(c.data);
    const out = {}; for (const k of Object.keys(z).filter(k => k.startsWith('panels/'))) { const bm = await createImageBitmap(new Blob([z[k]], { type: 'image/png' })); out[k] = (bm.width / bm.height).toFixed(1); } return out; });
  expect(Object.keys(files)).toEqual(['panels/panel_1_A.png', 'panels/panel_2_B.png', 'panels/panel_3_C.png', 'panels/panel_4_D.png']);
  expect(files['panels/panel_4_D.png']).toBe('2.0');                               // the new 2:1 picture, not another panel
  // back to the grid: the deleted picture is not drawn there either, and the grid says the new one is not in it
  await page.locator('#layout-mode').selectOption('grid');
  await expect(page.locator('#toast')).toContainText('1 picture added on the freeform canvas (D) is not in it');
  expect(await page.evaluate(() => _figurePanels().map(im => im.label))).toEqual(['A', 'B', 'C']);
  expect(errors).toEqual([]);
});

test('freeform3-14: a TextBox made on the freeform canvas comes back where it was after a visit to the grid', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); render(); _popOut(); render(); sv('fm-canvas-w', 1000); sv('fm-canvas-h', 800); render();
    const b = freeformElements.find(e => e.type === 'image' && e.label === 'B'); const W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'textbox', xf: (b.x + 20) / W, yf: (b.y + 20) / H, x2f: (b.x + 176) / W, y2f: (b.y + 60) / H, text: 'AcrB-msfGFP', color: '#fff', fill: true, fillColor: '#000', fillOpacity: .6, fontSize: 16, width: 2 });
    render(); render(); });
  const px = () => page.evaluate(() => { render(); const a = annotations[0], W = canvasLogicalW; return [Math.round(a.xf * W), Math.round((a.x2f - a.xf) * W)]; });
  const p0 = await px();
  await page.locator('#layout-mode').selectOption('grid');
  await page.evaluate(() => render());                                                 // the grid drawn as it was
  await page.evaluate(() => { sv('panel-w', 250); sv('panel-h', 250); onLayoutChange(); render(); });   // then changed while visited
  await page.locator('#layout-mode').selectOption('freeform');
  expect(await px()).toEqual(p0);                                                      // was 8 px off and narrower
  expect(errors).toEqual([]);
});

test('charts2-13 / blot2-08: removing a panel offers Relabel when the letters skip, and a full grid gives back its empty row', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  await page.evaluate(() => { sv('cols', 3); sv('rows', 2); onLayoutChange(); render(); });
  // × beside panel C in Images
  await page.locator('#img-list [data-del]').nth(2).click();
  await expect(page.locator('#toast')).toContainText('The letters now skip C');
  const btn = page.locator('#toast button', { hasText: 'Relabel' });
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => images.map(im => im.label))).toEqual(['A', 'B', 'C', 'D', 'E']);
  // a 3 × 2 grid with 4 panels after a second removal: the empty row is not kept
  await page.evaluate(() => { sv('cols', 2); sv('rows', 3); onLayoutChange(); render(); });
  await page.locator('#img-list [data-del]').nth(4).click();
  expect(await page.evaluate(() => [gi('cols'), gi('rows')])).toEqual([2, 2]);      // was: 2 × 3 with two empty numbered cells
  await expect(page.locator('#toast')).toContainText('grid now 2 × 2');
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => [images.length, gi('rows')])).toEqual([5, 3]);
  expect(errors).toEqual([]);
});

test('newcomer2-19: ↻ with nothing selected still turns every photo, but says so, names them, skips charts and offers Undo', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => addFiles([new File(['strain,cfu\nWT,10\nWT,12\nKO,3\nKO,4\n'], 'cfu.csv', { type: 'text/csv' })]));
  await page.waitForFunction(() => document.getElementById('chart-modal').classList.contains('open'));
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  await page.evaluate(() => { selectedPanel = -1; render(); });
  await page.locator('button[aria-label="Rotate 90 degrees clockwise"]').click();
  await expect(page.locator('#toast')).toContainText('No panel was selected, so all 3 photos (A, B and C) turned clockwise');   // was "All 4 photos"
  expect(await page.evaluate(() => images.map(im => im.rotate || 0))).toEqual([90, 90, 90, 0]);
  await page.locator('#toast button', { hasText: 'Undo' }).click();
  expect(await page.evaluate(() => images.map(im => im.rotate || 0))).toEqual([0, 0, 0, 0]);
  expect(errors).toEqual([]);
});

test('freeform2-15: ✕ New keeps the font family and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(() => { _ensureFontOption('Arial, sans-serif'); sv('label-font', 'Arial, sans-serif'); sv('axis-font', 'Arial, sans-serif'); render(); });
  await page.getByRole('button', { name: '✕ New' }).click();
  await expect(page.locator('#cm-body')).toContainText('except the font (Arial), which the new figure keeps');
  await page.locator('#cm-ok').click();
  expect(await page.evaluate(() => [images.length, gv('label-font'), gv('axis-font')])).toEqual([0, 'Arial, sans-serif', 'Arial, sans-serif']);   // was System Sans
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => images.length)).toBe(1);
  expect(errors).toEqual([]);
});

async function commitSized(page, w, h, name) {
  await page.evaluate(async ([w, h, name]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.fillStyle = '#446'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(w / 4, h / 4, w / 8, h / 8);
    const src = c.toDataURL('image/png'); await new Promise(r => { const i = new Image(); i.onload = () => { _commitImage(i, src, name); r(); }; i.src = src; }); render(); }, [w, h, name]);
}

test('fluor3-08: Edit inset region picks the inset’s bar again for its new field, as on creation', async ({ page }) => {
  const errors = await loadApp(page);
  await commitSized(page, 600, 600, 'field.png');
  await page.evaluate(() => { images[0].umPerPx = 0.065; images[0].sbOn = true; images[0].sbUm = 10; selectedPanel = 0; addLinkedInset(0.3, 0.3, 1 / 3, 1 / 3); render(); });
  const made = await page.evaluate(() => images[1].sbUm);
  expect(made).toBe(2);
  // ⚙ › ⧉ Edit inset region…, a wider region, ✓ Update inset
  await page.evaluate(() => pickInsetRegion(1));
  await page.evaluate(() => { cropEdState.cw = 440 / 600; cropEdState.ch = 440 / 600; cropEdState.cx = 0.1; cropEdState.cy = 0.1; });
  await page.locator('#crop-apply-btn').click();
  expect(await page.evaluate(() => images[1].sbUm)).toBe(5);                        // was 2 µm: a dash on a 28.6 µm field
  await expect(page.locator('#toast')).toContainText('its scale bar is 5 µm for the new field');
  // a length typed by the author is kept while it fits
  await page.evaluate(() => { images[1].sbUm = 4; pickInsetRegion(1); cropEdState.cw = 400 / 600; cropEdState.ch = 400 / 600; });
  await page.locator('#crop-apply-btn').click();
  expect(await page.evaluate(() => images[1].sbUm)).toBe(4);
  expect(errors).toEqual([]);
});

test('newcomer3-10: a journal preset keeps the panel shape Fit panels to images made', async ({ page }) => {
  const errors = await loadApp(page);
  for (const n of ['a', 'b', 'c', 'd']) await commitSized(page, 400, 300, n + '.png');
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); fitPanelsToContent(); render(); });
  expect(await page.evaluate(() => [gi('panel-w'), gi('panel-h')])).toEqual([300, 225]);
  await page.locator('#target-journal').selectOption('plos');
  const r = await page.evaluate(() => [gi('panel-w'), gi('panel-h')]);
  expect(r[1] / r[0]).toBeCloseTo(0.75, 2);                                          // was 300 × 300: the white bars came back
  await expect(page.locator('#toast')).toContainText('(their shape kept)');
  expect(errors).toEqual([]);
});

test('newcomer3-12: fitting mixed shapes offers Crop to fill cells for aligned edges', async ({ page }) => {
  const errors = await loadApp(page);
  await commitSized(page, 300, 400, 'plate.png'); await commitSized(page, 400, 300, 'm1.png'); await commitSized(page, 400, 300, 'm2.png');
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); render(); });
  await page.evaluate(() => fitPanelsToContent());
  const btn = page.locator('#toast button', { hasText: 'Crop to fill cells' });
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => images.map(im => +_panelContentAspect(im).toFixed(2)))).toEqual([1.33, 1.33, 1.33]);
  expect(errors).toEqual([]);
});

test('fluor2-12: an export with no printed width or journal says how wide it prints and leads to the journal', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await loadApp(page);
  await seedPanels(page, 5);
  await page.evaluate(() => { sv('cols', 5); sv('rows', 1); onLayoutChange(); render(); });
  await Promise.all([page.waitForEvent('download'), page.evaluate(() => doExport('png'))]);
  await expect(page.locator('#toast')).toContainText(/prints \d+ mm wide, because no printed width or journal is chosen/);   // was "Saved figure.png"
  await page.locator('#toast button', { hasText: 'Choose the journal' }).click();
  await expect(page.locator('#target-journal')).toBeFocused();
  // with a journal chosen, the plain "Saved"
  await page.locator('#target-journal').selectOption('elife');
  await Promise.all([page.waitForEvent('download'), page.evaluate(() => doExport('png'))]);
  await expect(page.locator('#toast')).toHaveText(/^Saved figure\.png$/);
  expect(errors).toEqual([]);
});

test('freeform3-15: making the printed width narrower after layout says the text grows against the pictures', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); render(); });
  await page.evaluate(() => _cmdpGoto('export-width-mm'));
  const w = page.locator('#export-width-mm');
  await w.focus(); await w.selectOption('174'); await w.blur();
  await w.focus(); await w.selectOption('114');
  await expect(page.locator('#toast')).toContainText('Printed width 174 → 114 mm: text keeps its point size, so it is 1.53× larger');
  expect(errors).toEqual([]);
});
