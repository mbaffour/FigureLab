// @ts-check
// Usability round 2 — images, channels, 16-bit samples, scale bars, crop/trim and the
// measurement tools. Each test reproduces a tester's finding (ids in the titles) through
// the UI where it was a UI problem, and through exported text or numbers where it was an
// output problem, and says what the old build did.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// ── A 16-bit greyscale TIFF writer (uncompressed, little-endian) ─────────────────────
// pages: array of Uint16Array(w*h). desc goes into page 0's ImageDescription (ImageJ
// header or OME-XML). umPerPx writes X/YResolution as pixels per unit (ImageJ style).
function tiff16(pages, { w, h, desc = '', umPerPx = 0 }) {
  const enc = Buffer.from(desc ? desc + '\0' : '', 'utf8');
  let off = 8;
  const layout = pages.map((px, p) => {
    const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 1]];
    if (p === 0 && enc.length) tags.push([270, 2, enc.length, 'DESC']);
    tags.push([273, 4, 1, 'DATA'], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, w * h * 2]);
    if (umPerPx > 0) tags.push([282, 5, 1, 'XRES'], [283, 5, 1, 'XRES'], [296, 3, 1, 1]);
    const ifdOff = off, ifdSize = 2 + tags.length * 12 + 4;
    let extra = ifdOff + ifdSize;
    const descOff = (p === 0 && enc.length) ? extra : 0; if (descOff) extra += enc.length + (enc.length & 1);
    const resOff = umPerPx > 0 ? extra : 0; if (resOff) extra += 8;
    const dataOff = extra; off = dataOff + w * h * 2; off += off & 1;
    return { tags, ifdOff, descOff, resOff, dataOff, px };
  });
  const buf = Buffer.alloc(off);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  layout.forEach((L, p) => {
    buf.writeUInt16LE(L.tags.length, L.ifdOff);
    L.tags.forEach(([tag, type, count, v], k) => {
      const o = L.ifdOff + 2 + k * 12;
      buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(count, o + 4);
      const val = v === 'DESC' ? L.descOff : v === 'DATA' ? L.dataOff : v === 'XRES' ? L.resOff : v;
      if (type === 3 && count === 1) buf.writeUInt16LE(val, o + 8); else buf.writeUInt32LE(val, o + 8);
    });
    buf.writeUInt32LE(p === layout.length - 1 ? 0 : layout[p + 1].ifdOff, L.ifdOff + 2 + L.tags.length * 12);
    if (L.descOff) enc.copy(buf, L.descOff);
    if (L.resOff) { const den = 1000000; buf.writeUInt32LE(Math.round(den / umPerPx), L.resOff); buf.writeUInt32LE(den, L.resOff + 4); }
    for (let i = 0; i < L.px.length; i++) buf.writeUInt16LE(L.px[i], L.dataOff + i * 2);
  });
  return buf.toString('base64');
}
const IJ = () => `ImageJ=1.54f\nunit=micron\n`;
// One single-channel OME-TIFF page named `name`, coloured `color` (OME signed RGBA).
const OME1 = (name, color) => `<?xml version="1.0"?><OME><Image ID="Image:0"><Pixels DimensionOrder="XYCZT" SizeX="32" SizeY="32" SizeC="1" SizeZ="1" SizeT="1" Type="uint16" PhysicalSizeX="0.1032" PhysicalSizeXUnit="µm">`
  + `<Channel ID="Channel:0:0" Name="${name}" Color="${color}"/></Pixels></Image></OME>`;
const GREEN = 16711935, MAGENTA = -16711681;
// A field: background `bg`, a 16×16 block of `blockV` at (8,8), and one hot pixel `hot`.
function field(w, h, bg, blockV, hot) {
  const a = new Uint16Array(w * h).fill(bg);
  for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) a[y * w + x] = blockV;
  a[(h - 2) * w + (w - 2)] = hot;
  return a;
}
// Drop files through the real import path (addFiles), as a drop or the file picker does.
async function drop(page, files) {
  await page.evaluate(async (fs) => {
    const list = fs.map(([b64, name]) => {
      const b = atob(b64); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      return new File([u], name, { type: 'image/tiff' });
    });
    await addFiles(list);
  }, files);
  await page.waitForFunction(() => images.filter(Boolean).every(im => im.img && im.img.complete && im.img.naturalWidth > 0));
  await page.evaluate(() => render());
}
// Open a panel's ⚙ drawer in the list (by index) and return a locator for its row.
async function openDrawer(page, idx) {
  const row = page.locator('#img-list .img-item').nth(idx);
  if (!(await row.locator('.img-settings').evaluate(e => e.classList.contains('open')))) await row.locator('[data-gear]').click();
  await expect(row.locator('.img-settings')).toHaveClass(/open/);
  return row;
}
const rowOf = (page, idx) => page.locator('#img-list .img-item').nth(idx);
// Type a value into a field and leave it, as a person does (change fires on blur).
async function typeIn(loc, v) { await loc.fill(String(v)); await loc.dispatchEvent('change'); }

// Two conditions as ImageJ TIFFs (Fed, EBSS) and one as single-channel OME-TIFFs
// (BafA1), GFP and CellMask each — the fluorescence tester's mix of files.
async function seedMixedChannels(page) {
  const f = (v) => field(32, 32, 200, v, 20000);
  await drop(page, [
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C2-U2OS_TFEB-GFP_Fed_63x_f03_GFP.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C3-U2OS_TFEB-GFP_Fed_63x_f03_CellMask.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C2-U2OS_TFEB-GFP_EBSS_63x_f03_GFP.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C3-U2OS_TFEB-GFP_EBSS_63x_f03_CellMask.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: OME1('GFP', GREEN) }), 'C2-U2OS_TFEB-GFP_EBSS-BafA1_63x_f03_GFP.ome.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: OME1('CellMask', MAGENTA) }), 'C3-U2OS_TFEB-GFP_EBSS-BafA1_63x_f03_CellMask.ome.tif'],
  ]);
  await page.locator('button', { hasText: 'Auto-channels' }).first().click();
}
async function renameInKey(page, lut, name) {
  // Export › Legend key › Channel names: the box for that colour
  await page.evaluate(() => render());
  const inp = page.locator(`#key-names-ui .key-name-in[data-lut="${lut}"]`);
  await expect(inp).toHaveCount(1);
  await inp.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, name);
}

test.describe('fluor2-01/02/10 one channel identity', () => {
  test('a colour renamed under Channel names renames the OME-TIFF panels too: Sync, compliance groups, Methods and the key agree', async ({ page }) => {
    // Old build: the OME panels kept "GFP"/"CellMask" for Sync, compliance and Methods
    // while every tag read TFEB-GFP / Membrane; Sync from the OME panel reached none of
    // the ImageJ panels and Methods listed four channels for two.
    const errors = await loadApp(page);
    await seedMixedChannels(page);
    await renameInKey(page, 'green', 'TFEB-GFP');
    await renameInKey(page, 'magenta', 'Membrane');
    // ⚙ › Channel on the OME GFP panel shows the name it goes by, and says why
    const row = await openDrawer(page, 4);
    await expect(row.locator('.f-chan')).toHaveValue('TFEB-GFP');
    await expect(row.locator('.f-chan-note')).toContainText('every green panel');
    // a new white point on the OME panel, then ≡ Sync by channel from it
    await typeIn(row.locator('.f-wpt-v'), 12000);
    await row.locator('[data-synclevels]').click();
    const toast = await page.locator('#toast').textContent();
    expect(toast).toContain('TFEB-GFP');
    expect(toast).toContain('→ 2 panels');
    const r = await page.evaluate(() => ({
      ranges: images.map(im => _rangeText(im)),
      groups: channelIdentityGroups().map(g => [g.name, g.members.map(m => m.who).join(',')]),
      split: channelIdentityGroups().sameColourSplit,
      methods: generateMethodsParagraph(),
      key: document.getElementById('key-text').value,
    }));
    expect(r.ranges.filter((x, i) => i % 2 === 0)).toEqual(['0–12000', '0–12000', '0–12000']);
    expect(r.groups.map(g => g[0]).sort()).toEqual(['Membrane', 'TFEB-GFP']);
    expect(r.split).toEqual([]);
    expect(r.methods).toContain('TFEB-GFP');
    expect(r.methods).not.toMatch(/[ ;:(]GFP 0–/);
    expect(r.methods).not.toContain('CellMask');
    expect(r.key).toBe('TFEB-GFP (green); Membrane (magenta).');
    expect(errors).toEqual([]);
  });

  test('a mismatch between conditions now shows under one channel; panels in grey keep the name', async ({ page }) => {
    // Old build: the compliance row listed DAPI, GFP, CellMask, TFEB-GFP, Membrane, each
    // "matched" with itself, so 300–12000 on one condition beside 300–10000 passed.
    const errors = await loadApp(page);
    await seedMixedChannels(page);
    await renameInKey(page, 'green', 'TFEB-GFP');
    const row = await openDrawer(page, 4);
    await typeIn(row.locator('.f-wpt-v'), 12000);
    let r = await page.evaluate(() => {
      const g = channelIdentityGroups().find(x => x.name === 'TFEB-GFP');
      return { members: g.members.map(m => m.who), ranges: [...new Set(g.members.map(m => _rangeText(m.obj)))].sort(), lk: _levelKey(images[4]) };
    });
    expect(r.members.length).toBe(3);
    expect(r.ranges.length).toBe(2);           // one channel, two ranges: the compliance row can see it
    expect(r.lk).toBe('TFEB-GFP');
    // revision: the OME panel to greyscale keeps its channel name, and a later rename follows it
    await row.locator('.f-gray').click();
    r = await page.evaluate(() => ({ lk: _levelKey(images[4]), chan: images[4].chan, lut: images[4].lut }));
    expect(r).toEqual({ lk: 'TFEB-GFP', chan: 'TFEB-GFP', lut: 'none' });
    await renameInKey(page, 'green', 'TFEB');
    expect(await page.evaluate(() => [_levelKey(images[0]), _levelKey(images[4])])).toEqual(['TFEB', 'TFEB']);
    expect(errors).toEqual([]);
  });

  test('without a rename, an OME page and a file of the same colour under different names: Sync says so', async ({ page }) => {
    const errors = await loadApp(page);
    const f = () => field(32, 32, 200, 3000, 9000);
    await drop(page, [
      [tiff16([f()], { w: 32, h: 32, desc: IJ() }), 'Fed_GFP.tif'],
      [tiff16([f()], { w: 32, h: 32, desc: OME1('TFEB-GFP', GREEN) }), 'BafA1.ome.tif'],
    ]);
    await page.locator('button', { hasText: 'Auto-channels' }).first().click();
    const row = await openDrawer(page, 1);
    await expect(row.locator('.f-chan-note')).toContainText('OME-TIFF');
    await row.locator('[data-synclevels]').click();
    await expect(page.locator('#toast')).toContainText('also green but named GFP');
    expect(await page.evaluate(() => channelIdentityGroups().sameColourSplit)).toEqual([{ lut: 'green', names: ['GFP', 'TFEB-GFP'] }]);
    expect(errors).toEqual([]);
  });
});

test('fluor2-08 the pages of one OME-TIFF are not flagged as duplicate names', async ({ page }) => {
  // Old build: every page of a 3-channel OME-TIFF carried "⚠ duplicate name".
  const errors = await loadApp(page);
  const ome = `<?xml version="1.0"?><OME><Image ID="Image:0"><Pixels DimensionOrder="XYCZT" SizeX="32" SizeY="32" SizeC="3" SizeZ="1" SizeT="1" Type="uint16">`
    + `<Channel ID="Channel:0:0" Name="DAPI" Color="65535"/><Channel ID="Channel:0:1" Name="GFP" Color="16711935"/><Channel ID="Channel:0:2" Name="CellMask" Color="-16711681"/></Pixels></Image></OME>`;
  const pg = v => field(32, 32, 100, v, v + 500);
  await drop(page, [[tiff16([pg(1000), pg(2000), pg(3000)], { w: 32, h: 32, desc: ome }), 'U2OS_Fed_3ch.ome.tif']]);
  await expect(page.locator('#img-list .img-item')).toHaveCount(3);
  await expect(page.locator('#img-list', { hasText: 'duplicate name' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('fluor2-03 a reopened session shows 16-bit levels in counts at once, without re-importing', async ({ page, browser }) => {
  // Old build: for minutes after loading, ⚙ said "native samples not kept … Re-import" and
  // showed 1.18–39 until an export dialog happened to rebuild the list.
  const errors = await loadApp(page);
  // A camera-sized noisy field: its picture takes a moment to decode after loading, as
  // a real micrograph does.
  const N = 1024, px = new Uint16Array(N * N);
  for (let i = 0; i < px.length; i++) px[i] = 300 + (i * 7919) % 9700;
  px[5] = 300; px[7] = 10000;
  await drop(page, [[tiff16([px], { w: N, h: N, desc: IJ(), umPerPx: 0.2 }), 'cells_GFP.tif']]);
  const row0 = await openDrawer(page, 0);
  await typeIn(row0.locator('.f-wpt-v'), 6000);
  const json = await page.evaluate(() => JSON.stringify(_withRawSave(() => serializeSession(true))));
  // Another day, another browser window: nothing of the picture is cached
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  const errors2 = await loadApp(p2);
  // Load it through the session file input, as Load a session does
  await p2.locator('#session-load-input').setInputFiles({ name: 'fig-session.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(p2.locator('#img-list .img-item')).toHaveCount(1);
  const row = await openDrawer(p2, 0);
  await expect(row.locator('.f-wpt-v')).toHaveValue('6000');
  await expect(row.locator('.img-settings')).not.toContainText('native samples not kept');
  await expect(row.locator('.img-settings')).toContainText('this file 300–10000');
  await ctx.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test('fluor2-08 a 16-bit file with a few hot pixels opens with its cells visible, and ⚙ says why', async ({ page }) => {
  // Old build: the display ran 0…file max, so five hot pixels at 60 000 counts left
  // cells of 3000 counts nearly black (3000/60000 of full scale).
  const errors = await loadApp(page);
  const N = 512, a = new Uint16Array(N * N).fill(200);
  for (let y = 100; y < 300; y++) for (let x = 100; x < 300; x++) a[y * N + x] = 3000;
  for (let k = 0; k < 5; k++) a[(10 + k) * N + 400] = 60000;
  await drop(page, [[tiff16([a], { w: N, h: N, desc: IJ(), umPerPx: 0.1 }), 'cells_GFP.tif']]);
  const row = await openDrawer(page, 0);
  await expect(row.locator('.f-wpt-v')).toHaveValue('3000');
  await expect(row.locator('.f-lv-note')).toContainText('5 hot pixels up to 60000');
  // a field without hot pixels opens 0…its maximum, as before
  const b = new Uint16Array(N * N).fill(200); for (let i = 0; i < 40000; i++) b[i] = 3000;
  await drop(page, [[tiff16([b], { w: N, h: N, desc: IJ(), umPerPx: 0.1 }), 'plain_GFP.tif']]);
  expect(await page.evaluate(() => _rangeText(images[1]))).toBe('0–3000');
  expect(errors).toEqual([]);
});

test('newcomer2-20 recovering an autosave names the 16-bit panels that come back without their samples', async ({ page }) => {
  // Old build: Restore said only "Session recovered"; the loss was a note inside ⚙ and
  // Methods then said the file was "scaled from 0 to its own maximum".
  const errors = await loadApp(page);
  await drop(page, [[tiff16([field(64, 64, 200, 3000, 4000)], { w: 64, h: 64, desc: IJ(), umPerPx: 0.1 }), 'confocal_GFP.tif']]);
  await page.evaluate(() => autosaveNow());             // what the 2.5 s autosave timer runs
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  const bar = page.locator('div', { hasText: 'Recover unsaved session' }).last();
  await expect(bar).toContainText('1 panel comes back without its 16-bit values');
  await bar.locator('.btn-primary').click();
  await expect(page.locator('#toast')).toContainText('Replace image');
  await expect(page.locator('#toast')).toContainText('confocal_GFP.tif');
  expect(errors).toEqual([]);
});
