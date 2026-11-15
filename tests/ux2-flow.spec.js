// @ts-check
// Usability round 2 — caption, Methods and alt text after a revision, search (⌘K),
// keyboard and first use, Help and tutorials. Each test drives the path a tester took
// and failed on (finding IDs in the titles).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { loadApp, seedPanels } = require('./helpers');

// Type into ⌘K the way a person does and press Enter.
async function palette(page, q) {
  await page.keyboard.press('Control+k');
  await page.locator('#cmdp-input').fill(q);
  await page.keyboard.press('Enter');
}
async function top(page, q) {
  return page.evaluate((q) => { openCmdPalette(); _cmdpRender(q); const t = _cmdpFiltered.slice(0, 3).map(c => c.label); closeCmdPalette(); return t; }, q);
}

test('newcomer2-16: ⌘K "plos" + Enter switches to PLOS ONE and adds no chart', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const rows0 = await page.evaluate(() => gi('rows'));
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await palette(page, 'plos');
  const r = await page.evaluate(() => ({ journal: gv('target-journal'), n: images.filter(Boolean).length,
    charts: images.filter(im => im && im.type === 'chart').length, rows: gi('rows') }));
  expect(r).toEqual({ journal: 'plos', n: 4, charts: 0, rows: rows0 });   // was: a box plot added, grid grown to 3 rows
  expect(errors).toEqual([]);
});

test('newcomer2-16: journal names, abbreviations and "journal X" phrasing reach the journal; adding rows never win on a fragment', async ({ page }) => {
  const errors = await loadApp(page);
  const want = {
    plos: /^Journal: PLOS ONE/, 'plos one': /^Journal: PLOS ONE/, 'journal plos': /^Journal: PLOS ONE/,
    'target journal plos': /^Journal: PLOS ONE/, 'switch to plos': /^Journal: PLOS ONE/,
    jbc: /^Journal: JBC/, elife: /^Journal: eLife/, embo: /^Journal: EMBO J/, 'embo journal': /^Journal: EMBO J/,
    mbio: /^Journal: ASM/, 'j bacteriol': /^Journal: ASM/, 'journal of bacteriology': /^Journal: ASM/,
    pnas: /^Journal: PNAS/, nature: /^Journal: Nature$/, 'set journal to elife': /^Journal: eLife/,
    'export for nature': /^Journal: Nature$/,
    // no preset: found and said so, not a near miss that changes the figure
    'nat comms': /no preset for Nature Communications/, 'nature communications': /no preset for Nature Communications/,
  };
  const bad = [];
  for (const [q, re] of Object.entries(want)) { const t = await top(page, q); if (!re.test(t[0] || '')) bad.push(`${q} -> ${t[0]}`); }
  // a fragment never puts an "Add …" row first
  for (const q of ['pl', 'plo', 'plos', 'bo', 'hea']) { const t = await top(page, q); if (/^(Add|Insert|Starter:|Flow:)/.test(t[0] || '')) bad.push(`${q} -> ${t[0]}`); }
  // nor among the letters-in-order guesses offered when nothing matches ("strtr" guessed the starters)
  for (const q of ['strtr', 'prsm', 'flwch']) { const g = await page.evaluate((q) => { openCmdPalette(); _cmdpRender(q); const l = _cmdpFiltered.map(c => c.label); closeCmdPalette(); return l; }, q);
    g.filter(l => /^(Add|Insert|Starter:|Flow:|Canvas:)/.test(l)).forEach(l => bad.push(`guess ${q} -> ${l}`)); }
  expect(bad).toEqual([]);
  // whole words still add: "box plot" is the box plot
  expect((await top(page, 'box plot'))[0]).toBe('Add box plot');
  expect(errors).toEqual([]);
});

test('newcomer2-04: plain beginner phrases reach save, add images, remove panel and text size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const want = {
    'save my work': /^Save session/, 'add images': /^Add images/, 'add image': /^Add images/,
    'delete panel': /^Remove the selected panel/, 'remove panel': /^Remove the selected panel/,
    'make text bigger': /^Text size/,
  };
  const bad = [];
  for (const [q, re] of Object.entries(want)) { const t = await top(page, q); if (!re.test(t[0] || '')) bad.push(`${q} -> ${t[0]}`); }
  expect(bad).toEqual([]);
  // the remove row removes the panel clicked on the canvas, and says how to get it back
  const pb = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 1); const r = document.getElementById('ann-canvas').getBoundingClientRect();
    return { x: (b.x + b.w / 2) * r.width / annCanvas.width, y: (b.y + b.h / 2) * r.height / annCanvas.height }; });
  await page.locator('#ann-canvas').click({ position: pb });
  await palette(page, 'delete panel');
  const r = await page.evaluate(() => ({ n: images.filter(Boolean).length, names: images.filter(Boolean).map(im => im.name || im.fileName || '') }));
  expect(r.n).toBe(2);
  await expect(page.locator('#toast')).toContainText(/removed — Ctrl\+Z brings it back/);
  // the add-images row opens the picker
  await page.evaluate(() => { window._picks = 0; document.getElementById('file-input').addEventListener('click', e => { window._picks++; e.preventDefault(); }); });
  await palette(page, 'add images');
  expect(await page.evaluate(() => window._picks)).toBe(1);
  expect(errors).toEqual([]);
});

// ── Caption, Methods and alt text after a revision ─────────────────────────────
const ZIP = `
  window.__zip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el, raw = bytes.subarray(at, at + size);
      out.push({ name, data: (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw) });
      p = at + size;
    }
    return out;
  };
  window.__pkg = async () => { const z = await _captureDownload(() => exportSubmissionPackage()); const files = {};
    (await __zip(z.data)).forEach(e => { files[e.name] = new TextDecoder().decode(e.data); }); return files; };
  // the Alt-Text the toolbar's PNG export writes into the file
  window.__pngAlt = async () => { const c = await _captureDownload(() => doExport('png')); const t = new TextDecoder('latin1').decode(c.data);
    const i = t.indexOf('Alt-Text\\0'); if (i < 0) return null; const s = t.slice(i + 9); return s.slice(0, s.search(/[\\0]|(?:tEXt|iTXt|IDAT|IEND)/)); };
`;
async function openExport(page) {
  await page.evaluate(() => { let d = document.getElementById('caption-out').closest('details'); while (d) { d.open = true; d = d.parentElement.closest('details'); } });
}
// A two-panel figure: A a calibrated micrograph with a caption note, B a plate.
async function revisionFigure(page) {
  await seedPanels(page, 2);
  await page.evaluate(() => { images[0].captionNote = 'Confocal of GFP cells'; images[0].umPerPx = 0.154; images[0].sbOn = true; images[0].sbUm = 2;
    images[1].captionNote = 'Plaque assay'; render(); });
}

test('newcomer2-15: after reopening, untouched caption, Methods and alt text follow a new calibration and a swap — in the exported PNG too', async ({ page }, info) => {
  const errors = await loadApp(page);
  await revisionFigure(page);
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await page.getByRole('button', { name: '✎ Write Methods paragraph' }).click();
  await page.getByRole('button', { name: '✦ Draft from figure' }).click();
  await expect(page.locator('#alt-text')).toHaveValue(/\(A\) Confocal of GFP cells/);
  const file = info.outputPath('fig1.json');
  fs.writeFileSync(file, await page.evaluate(() => JSON.stringify(serializeSession(true))));
  // reopen the saved session the way the tester did
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate(ZIP);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Load a session/ }).click();
  await (await chooser).setFiles(file);
  await page.waitForFunction(() => images.filter(Boolean).length === 2);
  await expect(page.locator('#caption-out')).toHaveValue(/\(A\) Confocal of GFP cells/);
  // the revision: A re-imaged at a new pixel size, then the two panels swapped
  await page.evaluate(() => { images[0].umPerPx = 0.0769; swapImages(0, 1); render(); });
  await openExport(page);
  await expect(page.locator('#caption-out')).toHaveValue(/\(B\) Confocal of GFP cells.*0\.0769 µm per pixel/s);
  await expect(page.locator('#caption-out')).toHaveValue(/\(A\) Plaque assay/);
  await expect(page.locator('#methods-out')).toHaveValue(/panel B \(0\.0769 µm per pixel\)/);
  await expect(page.locator('#alt-text')).toHaveValue(/\(B\) Confocal of GFP cells/);
  for (const id of ['#caption-stale', '#methods-stale', '#alt-stale']) await expect(page.locator(id)).toBeHidden();
  // a change exported in the same moment: the PNG carries the alt text for the figure as saved
  const alt = await page.evaluate(async () => { images[0].captionNote = 'Spot assay'; render(); return __pngAlt(); });
  expect(alt).toContain('(A) Spot assay');
  expect(alt).not.toContain('Plaque assay');
  expect(errors).toEqual([]);
});

test('newcomer2-15: edited caption and alt text are kept and flagged with Regenerate / Keep mine; the package and exports say so', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(ZIP);
  await revisionFigure(page);
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await page.getByRole('button', { name: '✦ Draft from figure' }).click();
  await expect(page.locator('#alt-text')).toHaveValue(/\(A\) Confocal of GFP cells/);
  const cap = await page.locator('#caption-out').inputValue();
  await page.locator('#caption-out').fill(cap + ' Representative of three experiments.');
  await page.locator('#alt-text').fill('Two panels: GFP cells in A and a plaque assay in B.');
  await page.evaluate(() => { swapImages(0, 1); render(); });
  await expect(page.locator('#caption-stale')).toBeVisible();
  await expect(page.locator('#alt-stale')).toBeVisible();
  await expect(page.locator('#caption-out')).toHaveValue(/three experiments/);
  // Keep mine: the note goes, the words stay
  await page.locator('#caption-stale').getByText('Keep mine').click();
  await expect(page.locator('#caption-stale')).toBeHidden();
  await expect(page.locator('#caption-out')).toHaveValue(/three experiments/);
  // the PNG embeds the edited alt text as written, and the export says it may be out of date
  const r = await page.evaluate(async () => { const t = []; const o = window.toast; window.toast = (m, k) => { t.push(m); return o(m, k); };
    const ol = window.dl; window.dl = () => {}; await doExport('png'); window.dl = ol; window.toast = o; return t.join('\n'); });
  expect(r).toMatch(/with your alt text as written, though the figure has changed since/);
  // the package ships it with the draft for the figure as exported, and the README says so
  const files = await page.evaluate(() => { sv('export-name', 'rev'); return __pkg(); });
  expect(files['rev-alt.txt']).toContain('a plaque assay in B');
  // (the draft quotes the caption as the author kept it)
  expect(files['rev-alt-generated.txt']).toContain('Representative of three experiments');
  expect(files['README.txt']).toContain('CHECK THESE TEXTS');
  expect(files['README.txt']).toMatch(/rev-alt\.txt is your alt text, as written/);
  // the kept caption is not flagged again until the figure changes again
  expect(files['README.txt']).not.toMatch(/rev-caption\.txt is your edited caption/);
  await expect(page.locator('#info-modal-bg')).toContainText('rev-alt-generated.txt');
  await page.evaluate(() => document.querySelectorAll('#info-modal-bg').forEach(n => n.remove()));
  // Redraft on the alt note replaces it
  await page.locator('#alt-stale').getByText('✦ Redraft').click();
  await expect(page.locator('#alt-text')).toHaveValue(/^A 3×2 panel grid.*three experiments/s);
  await expect(page.locator('#alt-stale')).toBeHidden();
  expect(errors).toEqual([]);
});

test('newcomer2-15: a caption and alt text from an older session (no record of who wrote them) are flagged when the figure changes', async ({ page }) => {
  const errors = await loadApp(page);
  await revisionFigure(page);
  const json = await page.evaluate(() => { generateCaption(); _setAltText('Two micrographs.'); const s = serializeSession(true); delete s.genTexts; return JSON.stringify(s); });
  await page.evaluate((j) => { applySession(JSON.parse(j), { origin: 'file' }); render(); }, json);
  await openExport(page);
  await page.waitForTimeout(1700);
  for (const id of ['#caption-stale', '#alt-stale']) await expect(page.locator(id)).toBeHidden();   // nothing has changed yet
  await page.evaluate(() => { images[1].captionNote = 'Spot assay'; render(); });
  await expect(page.locator('#caption-stale')).toBeVisible();
  await expect(page.locator('#alt-stale')).toBeVisible();
  await expect(page.locator('#caption-out')).toHaveValue(/\(B\) Plaque assay/);          // kept, not overwritten
  expect(errors).toEqual([]);
});

test('ISSUES: ✦ Generate Caption asks before replacing an edited caption, with Replace / Keep mine', async ({ page }) => {
  const errors = await loadApp(page);
  await revisionFigure(page);
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await page.locator('#caption-out').fill('My own caption.');
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await expect(page.locator('#cm-title')).toHaveText('Replace your caption?');
  await expect(page.locator('#cm-cancel')).toHaveText('Keep mine');
  await page.locator('#cm-cancel').click();
  await expect(page.locator('#caption-out')).toHaveValue('My own caption.');
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await expect(page.locator('#cm-ok')).toHaveText('Replace');
  await expect(page.locator('#cm-ok')).toHaveClass(/btn-primary/);
  await page.locator('#cm-ok').click();
  await expect(page.locator('#caption-out')).toHaveValue(/\(A\) Confocal of GFP cells/);
  // an untouched caption is simply rewritten, no question
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await expect(page.locator('#confirm-modal-bg')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── Caption and Methods wording ────────────────────────────────────────────────
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
  await page.evaluate(async (fs) => { await addFiles(fs.map(([b64, name]) => { const b = atob(b64), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], name, { type: 'image/tiff' }); })); }, files);
  await page.waitForFunction((n) => images.filter(Boolean).length === n && images.filter(Boolean).every(im => im.img && im.img.complete && im.img.naturalWidth > 0), files.length);
}

test('fluor2-04 / fluor2-05: caption and Methods give display ranges in the files’ own values, grouped, with the key’s channel names and natural wording', async ({ page }) => {
  const errors = await loadApp(page);
  // two conditions, GFP and a membrane dye; each file has its own maximum, so the same
  // camera range is a different 8-bit number on every panel
  await dropTiffs(page, [
    [tiff16(field(64, 64, 200, 6000, 20441), 64, 64, 0.108), 'DMSO_GFP.tif'],
    [tiff16(field(64, 64, 200, 6000, 65535), 64, 64, 0.108), 'BafA1_GFP.tif'],
    [tiff16(field(64, 64, 100, 2000, 9000), 64, 64, 0.108), 'DMSO_CellMask.tif'],
    [tiff16(field(64, 64, 100, 2000, 30000), 64, 64, 0.108), 'BafA1_CellMask.tif'],
  ]);
  await page.evaluate(() => {
    autoDetectChannels(); sv('cols', 2); sv('rows', 2); onLayoutChange();
    images.forEach(im => { const g = /GFP/.test(_sourceName(im)); _setLevelNative(im, 'black', g ? 300 : 150); _setLevelNative(im, 'white', g ? 10000 : 4000); });
    sv('key-names', JSON.stringify({ green: 'TFEB-GFP', magenta: 'Membrane' }));   // Legend key › Channel names
    render();
  });
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await page.getByRole('button', { name: '✎ Write Methods paragraph' }).click();
  const cap = await page.locator('#caption-out').inputValue(), meth = await page.locator('#methods-out').inputValue();
  expect(cap).not.toMatch(/[Ll]evels|\d\.\d{4,}/);              // was "Levels 1.18482–39.49386" per panel
  expect(cap).toContain('(A) TFEB-GFP (green)');
  expect(cap).toContain('(C) Membrane (magenta)');            // was "Magenta"; "CellMask, Magenta" with a heading
  expect(cap).toContain('Display ranges in the files’ own 16-bit values: TFEB-GFP 300–10000 (panels A and B); Membrane 150–4000 (panels C and D).');
  expect(cap).toContain('Each channel was displayed with the same settings on every panel that shows it.');
  expect(cap).not.toMatch(/differ between panels|RFP|Magenta/);
  expect(meth).toContain('identical settings on every panel of each channel');
  expect(meth).toContain('pseudocoloured with lookup tables: TFEB-GFP in green (panels A and B); Membrane in magenta (panels C and D)');
  expect(meth).not.toMatch(/differ between panels|RFP|0–255/);
  // one panel off its channel's range: said, by channel, with the values
  const drift = await page.evaluate(() => { _setLevelNative(images[1], 'white', 12000); render(); return { cap: _captionText(), meth: generateMethodsParagraph() }; });
  expect(drift.cap).toContain('Display settings differ between panels of the same channel (TFEB-GFP: A 300–10000; B 300–12000).');
  expect(drift.meth).toContain('Display settings differ between panels of the same channel (TFEB-GFP: A 300–10000; B 300–12000)');
  // a merge of 16-bit channels: no second range "on the 0–255 display scale"; a GFP
  // panel shown without its lookup table is said to be greyscale
  const merged = await page.evaluate(() => { _setLevelNative(images[1], 'white', 10000);
    const c = images[3]; images[1].channels = [{ img: c.img, raw: c.raw, lut: 'magenta', name: c.name, blackPt: c.blackPt, whitePt: c.whitePt }];
    images[0].lut = 'none'; render(); return generateMethodsParagraph(); });
  expect(merged).not.toMatch(/0–255 display scale/);
  // a merged channel off its channel's range is named too (it used to read as uniform)
  const mdrift = await page.evaluate(() => { _setLevelNative(images[1].channels[0], 'white', 5000); images[1]._adjCache = undefined; render();
    return { cap: _captionText(), meth: generateMethodsParagraph() }; });
  expect(mdrift.cap).toMatch(/Display settings differ between panels of the same channel \(Membrane: .*B \(merge\) 150–5000/);
  expect(mdrift.cap).not.toContain('Each channel was displayed with the same settings');
  expect(mdrift.meth).toMatch(/differ between panels of the same channel \(Membrane: .*B \(merge\) 150–5000/);
  expect(merged).toMatch(/Panel A shows TFEB-GFP in greyscale, without a lookup table/);
  expect(errors).toEqual([]);
});

test('phage2-07 / phage-29: an EM pixel size reads in nm, and a chart in a grid cell is captioned from its data', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(() => {
    const im = images[0]; im.umPerPx = 0.0004; im.sbOn = true; im.sbUm = 0.01; im.sbUnit = 'nm'; im.captionNote = 'Negative-stain TEM of phiKBA3';
    const ch = _defaultChart('bar');
    ch.data = { columns: ['strain', 'cfu'], rows: [['WT', 9.1e8], ['WT', 1.1e9], ['WT', 1.0e9], ['dfliC', 2e8], ['dfliC', 3e8], ['dfliC', 2.5e8]], source: 'file', sourceName: 'cfu.csv' };
    ch.mapping.xCol = 0; ch.mapping.yCols = [1]; ch.error = 'sd'; ch.axes.y.title = 'CFU/mL'; ch.axes.y.log = true;
    _addDataPanel('chart', ch, 360, 260, 'bar chart'); sv('cols', 2); sv('rows', 1); onLayoutChange(); render();
  });
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await page.getByRole('button', { name: '✎ Write Methods paragraph' }).click();
  const cap = await page.locator('#caption-out').inputValue(), meth = await page.locator('#methods-out').inputValue();
  expect(cap).toContain('(0.4 nm per pixel)');                // was "(0.0004 µm per pixel)"
  expect(meth).toContain('(0.4 nm per pixel)');
  expect(cap).toContain('(B) Bar chart of CFU/mL for WT and dfliC, on a log scale. Mean ± SD, n = 3 per point. Data from cfu.csv.');  // was "(B) Panel B."
  // the names the chart shows (Names & colours › shown as), as in its legend
  const shown = await page.evaluate(() => { images.find(im => im.type === 'chart').chart.names = { dfliC: 'Δ*fliC*' }; render(); return _captionText(); });
  expect(shown).toContain('for WT and ΔfliC, on a log scale');
  expect(errors).toEqual([]);
});

// ── Keyboard and first use ─────────────────────────────────────────────────────
test('newcomer2-21 / newcomer-10: the welcome card is two Tabs away, and Space works on its buttons', async ({ page }) => {
  const errors = await loadApp(page);
  // Tab 1 is still the toolbar skip link; Tab 2 goes to the welcome card
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.textContent)).toMatch(/Skip to the figure toolbar/);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.textContent)).toMatch(/Skip to the welcome card/);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement.classList.contains('es-drop'))).toBe(true);
  // "Load a session" within a few Tabs (it was Tab 145), and Space presses it
  let n = 0;
  while (n < 6 && !/Load a session/.test(await page.evaluate(() => document.activeElement.textContent || ''))) { await page.keyboard.press('Tab'); n++; }
  expect(n).toBeLessThanOrEqual(3);
  const chooser = page.waitForEvent('filechooser', { timeout: 4000 });
  await page.keyboard.press(' ');
  await chooser;                                     // the pan shortcut swallowed Space here
  // once the figure has panels the card and its skip link are gone
  await seedPanels(page, 1);
  await page.evaluate(() => updateEmptyState());
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('skip-welcome')).display)).toBe('none');
  expect(errors).toEqual([]);
});

test('newcomer-10 / newcomer2-21: panels on the canvas are picked, swapped and opened from the keyboard, with a focus ring and spoken names', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); render(); });
  // Tab from the last toolbar control lands on the figure
  await page.locator('#hilo-preview').focus();
  // (past the tip's "Got it" when the tip is up)
  for (let i = 0; i < 3 && await page.evaluate(() => document.activeElement.id) !== 'ann-canvas'; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('ann-canvas');
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).toBe('solid');
  await expect(page.locator('#panel-kb-live')).toContainText('Panel A (panel0.png) selected');
  await expect(page.getByRole('application', { name: /Figure panels/ })).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#panel-kb-live')).toContainText('Panel B (panel1.png) selected');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#panel-kb-live')).toContainText('Panel D (panel3.png) selected');
  expect(await page.evaluate(() => selectedPanel)).toBe(3);
  // Shift+Up moves D's picture into B's cell (a swap, letters stay with the cells)
  await page.keyboard.press('Shift+ArrowUp');
  const r = await page.evaluate(() => ({ files: images.map(im => _sourceName(im)), labels: images.map(im => im.label), sel: selectedPanel }));
  expect(r.files).toEqual(['panel0.png', 'panel3.png', 'panel2.png', 'panel1.png']);
  expect(r.labels).toEqual(['A', 'B', 'C', 'D']);
  expect(r.sel).toBe(1);                                    // the moved panel stays selected
  await expect(page.locator('#panel-kb-live')).toContainText('panel3.png is now panel B');
  // one undo step, as a drag
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => images.map(im => _sourceName(im)))).toEqual(['panel0.png', 'panel1.png', 'panel2.png', 'panel3.png']);
  // Enter opens the selected panel's settings and moves focus there
  await page.locator('#ann-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const open = await page.evaluate(() => ({ drawer: document.getElementById('settings-' + selectedPanel).classList.contains('open'),
    focus: document.activeElement.getAttribute('data-gear') }));
  expect(open.drawer).toBe(true);
  expect(open.focus).toBe(String(await page.evaluate(() => selectedPanel)));
  // the letter shortcuts still work with the figure focused
  await page.locator('#ann-canvas').focus();
  await page.keyboard.press('t');
  expect(await page.evaluate(() => activeTool)).toBe('text');
  expect(errors).toEqual([]);
});

// ── Help and tutorials ─────────────────────────────────────────────────────────
test('newcomer2-24 / newcomer2-01: Help no longer points to a "⚠ calibrate" badge, and lists every side-panel section', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => openHelp());
  const start = await page.locator('#help-pane-start').innerText();
  expect(start).not.toMatch(/⚠ calibrate|uncalibrated warning badge/);
  expect(start).toMatch(/Scale bar \/ calibrate…/);
  expect(start).toMatch(/Calibrate from image/);
  expect(start).toMatch(/Crop & Scale/);
  expect(start).toMatch(/Measure \(ruler/);
  expect(start).toMatch(/Shift\+arrow moves it/);
  const faq = await page.locator('#help-pane-faq').innerText();
  expect(faq).not.toMatch(/badge disappears/);
  // what Help says works: ⌘K "calibrate" reaches the calibration
  expect((await top(page, 'calibrate'))[0]).toMatch(/^Calibrate a panel/);
  expect(errors).toEqual([]);
});

test('newcomer2-11: a tutorial says one thing about getting your figure back, and offers it as the main action', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const said = [];
  page.on('dialog', d => { said.push(d.message()); d.accept(); });
  await page.evaluate(() => openHelp('tutorials'));
  const intro = await page.locator('#help-pane-tutorials').innerText();
  expect(intro).not.toMatch(/Ctrl\s*\+\s*Z brings it back/);
  expect(intro).toMatch(/offered it back in one click/);
  await page.locator('#tutorial-list [data-tut]').filter({ hasText: 'Start' }).nth(1).click();
  await page.waitForFunction(() => _tut && document.getElementById('tour-ov'));
  expect(said.join('\n')).not.toMatch(/Ctrl\+Z brings yours back/);
  expect(said.join('\n')).toMatch(/offered your figure back in one click/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#cm-title')).toHaveText('Bring your own figure back?');
  await expect(page.locator('#cm-ok')).toHaveText('Restore my figure');
  await expect(page.locator('#cm-ok')).toHaveClass(/btn-primary/);
  await expect(page.locator('#cm-cancel')).toHaveText('Keep the tutorial figure');
  await page.locator('#cm-ok').click();
  expect(await page.evaluate(() => images.filter(Boolean).map(im => _sourceName(im)))).toEqual(['panel0.png', 'panel1.png']);
  expect(errors).toEqual([]);
});
