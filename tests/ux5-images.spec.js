// @ts-check
// Usability round 5 — pictures, channels, calibration and scale bars, and their words in the
// caption and Methods. Each test drives the path a tester took (finding IDs in the titles)
// and fails on the round-4 build (1cedb76).
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// A negative-stain TEM as the microscope saves it: 1024 × 800 px, a grey field with dark
// "virions", a black info strip at the bottom holding a white burned-in bar of `barPx` px.
async function temPng(page, barPx, seed) {
  return page.evaluate(([barPx, seed]) => {
    const W = 1024, H = 800, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(150,150,150)'; x.fillRect(0, 0, W, H);
    let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    x.fillStyle = 'rgb(70,70,70)';
    for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(80 + rnd() * 860, 60 + rnd() * 560, 18 + rnd() * 10, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#000'; x.fillRect(0, H - 64, W, 64);
    x.fillStyle = '#fff'; x.fillRect(W - 60 - barPx, H - 30, barPx, 7);
    return c.toDataURL('image/png').split(',')[1];
  }, [barPx, seed]);
}
async function addPng(page, b64, name) {
  const n0 = await page.evaluate(() => images.filter(Boolean).length);
  await page.evaluate(async ([b64, name]) => { const b = atob(b64), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    await addFiles([new File([u], name, { type: 'image/png' })]); }, [b64, name]);
  await page.waitForFunction((n) => images.filter(Boolean).length === n && images.filter(Boolean).every(im => !im.img || (im.img.complete && im.img.naturalWidth > 0)), n0 + 1);
  await page.evaluate(() => render());
}
async function shownToast(page) { return page.evaluate(() => (document.getElementById('toast') || {}).textContent || ''); }
async function openGear(page, i) {
  const s = page.locator(`#settings-${i}`);
  if (!(await s.evaluate(e => e.classList.contains('open')))) await page.locator(`[data-gear="${i}"]`).click();
}
async function complianceRow(page, re) {
  return page.evaluate((src) => { checkCompliance(); const rx = new RegExp(src);
    const t = [...document.querySelectorAll('.compliance-row')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(t => rx.test(t)) || '';
    const m = document.getElementById('info-modal-bg'); if (m) m.remove(); return t; }, re.source);
}

test('phage5-01: ⇄ Replace image never keeps a pixel size measured on the old picture — the toast, compliance, caption and Methods say so, and the new bar is one click away', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await temPng(page, 323, 5), 'Tq4_negstain_2241.png');
  // ⚙ › 🔍 Auto-detect scale bar › 200 nm, as the tester did
  await openGear(page, 0);
  await page.locator('#settings-0').getByRole('button', { name: /Auto-detect scale bar/ }).click();
  await page.locator('#sbdetect-modal').getByRole('button', { name: '200 nm', exact: true }).click();
  const um0 = await page.evaluate(() => images[0].umPerPx);
  expect(Math.abs(um0 - 0.2 / 323)).toBeLessThan(1e-8);
  expect(await page.evaluate(() => _captionText())).toMatch(/200 nm/);
  // ⇄ Replace image… in ⚙ with the same-size TEM at twice the magnification (320 px = 100 nm)
  const hi = await temPng(page, 320, 9);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#settings-0').getByRole('button', { name: /Replace image/ }).click()]);
  await fc.setFiles({ name: 'Tq4_negstain_2263_hiMag.png', mimeType: 'image/png', buffer: Buffer.from(hi, 'base64') });
  await page.waitForFunction(() => images[0].name === 'Tq4_negstain_2263_hiMag.png' && images[0].img.complete);
  await page.evaluate(() => render());
  // was: "crop, label and settings kept" and µm/px 0.000619195 kept, a "200 nm" bar 2× too short
  const t = await shownToast(page);
  expect(t).toMatch(/crop and label kept, but calibration cleared: 0\.6192 nm\/px was measured on the scale bar burned into the image \(323 px = 200 nm\) of the old file/);
  expect(t).toMatch(/the new picture has a 320 px bar/);
  expect(await page.evaluate(() => images[0].umPerPx)).toBe(0);
  const row = await complianceRow(page, /^\W*Scale-bar calibration/);
  expect(row).toMatch(/calibration predates the replaced image/);
  expect(row).toMatch(/Tq4_negstain_2241\.png, which ⇄ Replace image swapped for Tq4_negstain_2263_hiMag\.png/);
  expect(row).not.toMatch(/All calibrated/);
  const words = await page.evaluate(() => ({ c: _captionText(), m: generateMethodsParagraph() }));
  expect(words.c).not.toMatch(/200 nm|0\.619/);
  expect(words.m).not.toMatch(/323 px = 200 nm|0\.619/);
  // no bar is drawn at the old length
  expect(await page.evaluate(() => _scaleBarDrawn(images[0]))).toBeFalsy();
  // the toast's button finds the new bar and asks one thing: what length it shows
  await page.locator('#toast').getByRole('button', { name: /Calibrate on its bar/ }).click();
  await expect(page.locator('#sbdetect-modal')).toContainText('320 px');
  await page.locator('#sbdetect-modal').getByRole('button', { name: '100 nm', exact: true }).click();
  expect(Math.abs(await page.evaluate(() => images[0].umPerPx) - 0.1 / 320)).toBeLessThan(1e-8);
  expect(await complianceRow(page, /^\W*Scale-bar calibration/)).not.toMatch(/predates/);
  expect(await page.evaluate(() => generateMethodsParagraph())).toMatch(/320 px = 100 nm/);
  // undo brings the replace's state back, flagged again
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => [images[0].umPerPx, !!images[0]._calibDropped])).toEqual([0, true]);
  expect(errors).toEqual([]);
});

test('phage5-01: the cleared calibration is still flagged after the session is saved and opened again, and compliance offers Auto-detect on the new bar', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await temPng(page, 323, 5), 'Tq4_negstain_2241.png');
  await page.evaluate(() => { const b = _findBurnedBar(images[0].img); applyScaleDetect(0, b.px, 0.2, { bar: b }); });
  const hi = await temPng(page, 320, 9);
  await page.evaluate(async (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    await replacePanelImage(images[0].id, new File([u], 'Tq4_negstain_2263_hiMag.png', { type: 'image/png' })); }, hi);
  const json = await page.evaluate(() => JSON.stringify(serializeSession(true)));
  await page.evaluate(async (j) => { applySession(JSON.parse(j), { origin: 'file' }); await new Promise(r => setTimeout(r, 400)); }, json);
  await page.waitForFunction(() => images[0] && images[0].img && images[0].img.complete && images[0].img.naturalWidth > 0);
  expect(await page.evaluate(() => [images[0].umPerPx, (images[0]._calibDropped || {}).from])).toEqual([0, 'Tq4_negstain_2241.png']);
  expect(await complianceRow(page, /^\W*Scale-bar calibration/)).toMatch(/calibration predates the replaced image/);
  // its fix button opens Auto-detect on the new picture's bar
  await page.evaluate(() => { checkCompliance(); [...document.querySelectorAll('#info-modal-bg .compliance-row button')].find(b => /Calibrate the new picture/.test(b.textContent)).click(); });
  await expect(page.locator('#sbdetect-modal')).toContainText('320 px');
  expect(errors).toEqual([]);
});

test('phage5-01: a pixel size set from the objective is kept on a same-size file — and the toast says it was kept; a file whose burned-in bar has another length clears it', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await temPng(page, 323, 5), 'a.png');
  await page.evaluate(() => { images[0].umPerPx = 0.5; images[0]._calibHow = { at: new Date().toISOString(), um: 0.5, how: 'from the 20× objective preset', kind: 'objective' }; });
  const same = await temPng(page, 323, 11), other = await temPng(page, 200, 12);
  const put = (b64, name) => page.evaluate(async ([b64, name]) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    await replacePanelImage(images[0].id, new File([u], name, { type: 'image/png' })); return [images[0].umPerPx, document.getElementById('toast').textContent]; }, [b64, name]);
  const [u1, t1] = await put(same, 'b.png');
  expect(u1).toBe(0.5);
  expect(t1).toMatch(/calibration 0\.5 µm\/px kept \(from the 20× objective preset\) — the new file has the same pixel dimensions and no pixel size of its own/);
  const [u2, t2] = await put(other, 'c.png');
  expect(u2).toBe(0);
  expect(t2).toMatch(/calibration cleared: the bar burned into the new picture is 200 px long and the old one’s 323 px/);
  expect(errors).toEqual([]);
});

test('phage5-17: ⚙ shows a TEM pixel size in nm/px to four figures, not "0.00061" cut off in the µm/px box', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await temPng(page, 323, 5), 'Tq4_negstain_2241.png');
  await page.evaluate(() => { const b = _findBurnedBar(images[0].img); applyScaleDetect(0, b.px, 0.2, { bar: b }); });
  await openGear(page, 0);
  await expect(page.locator('#settings-0 .f-pxsize')).toHaveText('0.6192 nm/px (0.0006192 µm/px)');
  // typing a value updates it as you type
  await page.locator('#settings-0 .f-umppx').fill('0.0003125');
  await expect(page.locator('#settings-0 .f-pxsize')).toHaveText('0.3125 nm/px (0.0003125 µm/px)');
  expect(errors).toEqual([]);
});

test('phage5-12: the count result block is marked out of date when ⇄ Replace image swaps the picture, as the list below it is', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await temPng(page, 323, 5), 'plate_C.png');
  await page.evaluate(() => { setTool('measure-count');
    const s = document.getElementById('count-polarity'); if (s) s.value = 'dark';
    document.getElementById('count-threshold').value = '110';
    const pb = panelBounds.find(b => b.idx === 0), map = _panelSourceMap(pb, images[0]);
    countCellsROI(document.getElementById('fig-canvas').getContext('2d'), map.dx + 2, map.dy + 2, map.dw - 4, map.dh * 0.6); });
  await expect(page.locator('#roi-results')).toContainText('Objects detected');
  await expect(page.locator('#roi-results')).not.toContainText('Out of date');
  await page.evaluate(async (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    await replacePanelImage(images[0].id, new File([u], 'plate_C_repeat.png', { type: 'image/png' })); }, await temPng(page, 323, 77));
  await expect(page.locator('#roi-results .roi-stale')).toContainText('Out of date: made on plate_C.png, which ⇄ Replace image swapped for plate_C_repeat.png');
  await expect(page.locator('#roi-results .roi-stale')).toContainText('count again');
  expect(errors).toEqual([]);
});

test('phage5-13: a gene map titled with *italic* markup is listed under its plain title', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => _addDataPanel('genemap', { topology: 'linear', length: 1000, features: [{ name: 'nosZ', start: 10, end: 400, strand: 1, type: 'CDS' }], style: { title: '*Escherichia* phage vB_EcoS_Tq4' } }, 300, 120, '*Escherichia* phage vB_EcoS_Tq4'));
  const row = page.locator('.img-item').first();
  await expect(row.locator('.img-name')).toHaveText('Escherichia phage vB_EcoS_Tq4');
  await expect(row.locator('.f-fname')).toHaveText('Escherichia phage vB_EcoS_Tq4');
  expect(errors).toEqual([]);
});
