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

test('ISSUES: a caption note reaches the untouched caption without pressing Render', async ({ page }) => {
  const errors = await loadApp(page);
  await revisionFigure(page);
  await openExport(page);
  await page.getByRole('button', { name: '✦ Generate Caption' }).click();
  await page.evaluate(() => { renderImgList(); document.querySelector('[data-gear="1"]').click(); });
  await page.locator('#settings-1 input.f-cap').fill('Plaque assay, 1e-6 dilution');
  await expect(page.locator('#caption-out')).toHaveValue(/\(B\) Plaque assay, 1e-6 dilution/);
  expect(errors).toEqual([]);
});
