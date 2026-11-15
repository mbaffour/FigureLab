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

// ── Synthetic micrographs with burned-in scale bars ──────────────────────────────────
// Drawn on a canvas with seeded noise and objects, so a bar sits on a textured field or
// in an info strip as it does on a real one; fractional bar coordinates give anti-
// aliased ends, as a bar burned in by a camera at a non-integer scale has.
const MICRO = `window._micro = async (spec) => {
  const { w, h, name } = spec;
  let s = spec.seed || 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = spec.bg; x.fillRect(0, 0, w, h);
  // objects: cells, virions, nuclei
  for (let k = 0; k < (spec.blobs || 0); k++) { x.fillStyle = spec.blob; x.beginPath();
    x.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 40, 6 + rnd() * 30, rnd() * 3, 0, Math.PI * 2); x.fill(); }
  // sensor noise
  const id = x.getImageData(0, 0, w, h), d = id.data, amp = spec.noise || 0;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 2 * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(id, 0, 0);
  if (spec.strip) { x.fillStyle = spec.strip.fill; x.fillRect(spec.strip.x || 0, spec.strip.y, spec.strip.w || w, spec.strip.h); }
  if (spec.box) { x.fillStyle = spec.box.fill; x.fillRect(spec.box.x, spec.box.y, spec.box.w, spec.box.h); }
  if (spec.bar) { x.fillStyle = spec.bar.fill; x.fillRect(spec.bar.x, spec.bar.y, spec.bar.w, spec.bar.h);
    if (spec.bar.text) { x.font = (spec.bar.font || 28) + 'px sans-serif'; x.textAlign = 'center';
      x.fillText(spec.bar.text, spec.bar.x + spec.bar.w / 2, spec.bar.y - 8); } }
  const src = c.toDataURL('image/png');
  await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name, null, null); res(); }; img.src = src; });
  render(); return images.length - 1; };`;

test('phage2-01 Auto-detect finds standard burned-in bars, in or out of an info strip, white or black, with ends between pixels', async ({ page }) => {
  // Old build (shrunk to 1000 px before searching): "No scale bar found" for the 250-px
  // bar in a 2048-px TEM's black strip and the 400-px bar on a 1024-px TEM.
  const errors = await loadApp(page);
  await page.evaluate(MICRO);
  const cases = [
    { name: 'phiKBA3_UA_stain_0117.tif', w: 2048, h: 1536, bg: '#7d7d7d', blob: '#4a4a4a', blobs: 60, noise: 22,
      strip: { fill: '#000', y: 1416, h: 120 }, bar: { fill: '#fff', x: 1730.4, y: 1488, w: 250, h: 13, text: '100 nm' }, want: 250 },
    { name: 'tem_1024.tif', w: 1024, h: 1024, bg: '#808080', blob: '#555', blobs: 30, noise: 18,
      strip: { fill: '#000', y: 954, h: 70 }, bar: { fill: '#efefef', x: 40, y: 985, w: 400, h: 9, text: '200 nm', font: 20 }, want: 400 },
    { name: 'tem_1024_offgrid.tif', w: 1024, h: 1024, bg: '#808080', blob: '#555', blobs: 30, noise: 18,
      strip: { fill: '#000', y: 954, h: 70 }, bar: { fill: '#fff', x: 40.5, y: 985, w: 400.3, h: 9 }, want: 400.3 },
    { name: 'brightfield_40x.png', w: 1600, h: 1200, bg: '#d8d8d8', blob: '#8c8c8c', blobs: 80, noise: 14,
      bar: { fill: '#000', x: 1220.3, y: 1130, w: 300.6, h: 10, text: '50 µm' }, want: 300.6 },
    { name: 'GFP_63x.png', w: 1280, h: 1024, bg: '#0a0a0a', blob: '#2a9a2a', blobs: 50, noise: 10,
      bar: { fill: '#fff', x: 1040.5, y: 980, w: 200, h: 8 }, want: 200 },
    { name: 'he_section_box.png', w: 1400, h: 1050, bg: '#b0a0b0', blob: '#705070', blobs: 90, noise: 16,
      box: { fill: '#fff', x: 1000, y: 900, w: 300, h: 110 }, bar: { fill: '#000', x: 1040.25, y: 975, w: 180, h: 6, text: '100 µm', font: 22 }, want: 180 },
    { name: 'sem_whitestrip.png', w: 1360, h: 1024, bg: '#6a6a6a', blob: '#999', blobs: 40, noise: 25,
      strip: { fill: '#fff', y: 960, h: 64 }, bar: { fill: '#000', x: 60.7, y: 990, w: 500, h: 10 }, want: 500 },
  ];
  const got = [];
  for (const c of cases) {
    const i = await page.evaluate(spec => _micro(spec), c);
    const bar = await page.evaluate(k => _findBurnedBar(images[k].img), i);
    got.push([c.name, bar && bar.px, bar && bar.bright]);
    expect(bar, c.name).not.toBeNull();
    expect(Math.abs(bar.px - c.want), `${c.name}: ${bar.px} px for ${c.want}`).toBeLessThanOrEqual(0.6);
    expect(bar.bright, c.name).toBe(c.bar.fill !== '#000');
  }
  // no bar: a textured micrograph with cells and nothing burned in
  const none = await page.evaluate(() => _micro({ name: 'nobar.png', w: 1200, h: 900, bg: '#c8c8c8', blob: '#707070', blobs: 120, noise: 20 }));
  expect(await page.evaluate(k => _findBurnedBar(images[k].img), none)).toBeNull();
  // through the UI on the phage TEM: ⚙ › 🔍 Auto-detect scale bar, 100 nm
  const row = await openDrawer(page, 0);
  await row.locator('button', { hasText: 'Auto-detect scale bar' }).click();
  const dlg = page.locator('#sbdetect-modal');
  await expect(dlg).toContainText('250 px');
  await dlg.locator('.sbd-pick', { hasText: '100 nm' }).click();
  expect(await page.evaluate(() => images[0].umPerPx)).toBeCloseTo(0.0004, 6);
  expect(errors).toEqual([]);
});

// Right-click a panel on the canvas, as a person does.
async function rightClickPanel(page, i) {
  await page.evaluate((i) => { render(); const b = panelBounds.find(p => p.idx === i);
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const k = r.width / canvasLogicalW;
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + (b.x + b.w / 2) * k, clientY: r.top + (b.y + b.h / 2) * k })); }, i);
}

test('newcomer2-01 a scale bar on an uncalibrated micrograph: ⌘K "add scale bar" and the right-click menu lead to the calibration', async ({ page }) => {
  // Old build: ⌘K "add scale bar" jumped to Look › Bar height ("length is per panel"),
  // the right-click menu had no scale-bar item, and Help still pointed at a "⚠ calibrate"
  // badge uncalibrated panels no longer show.
  const errors = await loadApp(page);
  await page.evaluate(MICRO);
  await page.evaluate(async () => { await _micro({ name: 'tile_scan.jpg', w: 600, h: 400, bg: '#d0d0d0', blob: '#888', blobs: 30, noise: 10 });
    await _micro({ name: 'blot.png', w: 300, h: 120, bg: '#fff' }); });
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('#cmdp-input').fill('add scale bar');
  await page.keyboard.press('Enter');
  const row = rowOf(page, 0);
  await expect(row.locator('.img-settings')).toHaveClass(/open/);
  await expect(row.locator('.f-obj')).toBeFocused();
  await expect(page.locator('#toast')).toContainText('has no calibration yet');
  await row.locator('.f-obj').selectOption({ index: 3 });
  let r = await page.evaluate(() => { render(); return { um: images[0].umPerPx > 0, on: images[0].sbOn, drawn: _scaleBarDrawn(images[0]) }; });
  expect(r).toEqual({ um: true, on: true, drawn: true });
  // the right-click menu names it too
  await rightClickPanel(page, 1);
  await expect(page.locator('#panel-ctx-menu')).toContainText('Scale bar / calibrate…');
  await page.locator('#panel-ctx-menu').getByText('Scale bar / calibrate…').click();
  await expect(rowOf(page, 1).locator('.f-obj')).toBeFocused();
  // Help no longer sends people to a badge that is not there
  const help = await page.evaluate(() => document.body.innerHTML.includes("badge under a panel's name opens it"));
  expect(help).toBe(false);
  expect(errors).toEqual([]);
});

test('ISSUES fluorescence: ≡ Same bar on all calibrated keeps the length just typed in a panel’s ⚙; a new inset gets a bar that fits; fluor2-09 the inset picker says the ppi', async ({ page }) => {
  // Old build: the button gave every panel the median 10 µm, overwriting the 20 µm just
  // typed in A's ⚙ (only a click on A made it count); an inset inherited 20 µm on a
  // 13 µm field and drew no bar; the inset picker said nothing about resolution.
  const errors = await loadApp(page);
  const f = () => field(512, 512, 200, 3000, 4000);
  await drop(page, [[tiff16([f()], { w: 512, h: 512, desc: IJ(), umPerPx: 0.1 }), 'a_GFP.tif'],
    [tiff16([f()], { w: 512, h: 512, desc: IJ(), umPerPx: 0.1 }), 'b_GFP.tif']]);
  const row = await openDrawer(page, 0);
  await row.locator('.f-sbum').fill('20');
  await row.locator('.f-sbum').dispatchEvent('input');
  await row.locator('[data-gear]').click();             // close ⚙ again
  await page.evaluate(() => { selectedPanel = -1; document.querySelector('button[onclick="uniformScaleBars()"]').click(); });
  await expect(page.locator('#toast')).toContainText('the length typed last');
  expect(await page.evaluate(() => images.map(im => _sbLabel(im)))).toEqual(['20 µm', '20 µm']);
  // an inset of A from its right-click menu: a 100-px region of a 51 µm field
  await rightClickPanel(page, 0);
  await page.locator('#panel-ctx-menu div', { hasText: 'Add linked inset' }).click();
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  await page.evaluate(() => { Object.assign(cropEdState, { cx: 0.2, cy: 0.2, cw: 100 / 512, ch: 100 / 512, hasBox: true }); drawCropEd(); });
  const vals = await page.locator('#crop-ed-vals').textContent();
  expect(vals).toMatch(/region 100×100 px, prints at about \d+ ppi/);
  expect(vals).toContain('draw a region at least');
  await page.evaluate(() => applyCropModal());
  const r = await page.evaluate(() => { render(); const ins = images[1]; return { of: ins.insetOf === images[0].id, drawn: _scaleBarDrawn(ins), um: ins.sbUm }; });
  expect(r.of).toBe(true);
  expect(r.drawn).toBe(true);
  expect(r.um).toBeLessThan(10);
  expect(errors).toEqual([]);
});

// ── Count, the measurements CSV, crop fields, Trim borders and Batch crop ─────────────
const PLATE = async (page) => {
  await page.evaluate(MICRO);
  // 900 px, 100 µm/px: black around a light lawn, six dark 20-px plaques and two on the rim
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 900; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 900, 900); x.fillStyle = '#ddd'; x.beginPath(); x.arc(450, 450, 400, 0, 7); x.fill(); x.fillStyle = '#555';
    [[300, 300], [600, 300], [450, 450], [300, 600], [600, 600], [450, 700]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 10, 0, 7); x.fill(); });
    const src = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'plate_B.jpg', null, { umPerPx: 100, source: 'test' }); res(); }; img.src = src; });
    sv('cols', 1); sv('rows', 1); onLayoutChange(); render(); });
};
async function dragOnFigure(page, x0, y0, x1, y1) {
  await page.evaluate(([x0, y0, x1, y1]) => {
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const P = (fx, fy) => ({ bubbles: true, clientX: r.left + fx * r.width / canvasLogicalW, clientY: r.top + fy * r.height / canvasLogicalH, button: 0 });
    c.dispatchEvent(new MouseEvent('mousedown', { ...P(x0, y0), buttons: 1 }));
    c.dispatchEvent(new MouseEvent('mousemove', { ...P(x1, y1), buttons: 1 }));
    c.dispatchEvent(new MouseEvent('mouseup', { ...P(x1, y1), buttons: 0 }));
  }, [x0, y0, x1, y1]);
}

test('phage2-02/03 Count: clicking "round (a dish)" ticks it, and the CSV carries the panel, the settings, the rim count and every diameter', async ({ page }) => {
  // Old build: the words were a label for the Threshold slider, so clicking them did
  // nothing and the count ran on the whole box; the CSV had no panel, no diameters, no
  // rim count and no polarity or region, so a wrong count could not be told apart.
  const errors = await loadApp(page);
  await PLATE(page);
  await page.locator('#measure-acc summary').click();
  await page.locator('#measure-acc [data-tool="measure-count"]').click();
  await page.locator('#count-polarity').selectOption('dark');
  await page.getByText('round (a dish)').click();
  await expect(page.locator('#count-ellipse')).toBeChecked();
  const pb = await page.evaluate(() => { const b = panelBounds[0]; return [b.ix, b.iy, b.iw, b.ih]; });
  const [x, y, w, h] = pb;
  await dragOnFigure(page, x + w * 50 / 900, y + h * 50 / 900, x + w * 850 / 900, y + h * 850 / 900);
  const csv = await page.evaluate(() => { let t = ''; const d = window.dl, b = window.blobUrl;
    window.dl = () => {}; window.blobUrl = s => { t = s; return 'blob:x'; };
    try { document.getElementById('export-measurements-btn').click(); } finally { window.dl = d; window.blobUrl = b; } return t; });
  const rows = csv.split('\n').filter(l => !l.startsWith('#')).map(l => JSON.parse('[' + l + ']'));
  const col = n => rows[1][rows[0].indexOf(n)];
  expect(col('Count')).toBe('6');
  expect(col('Panel')).toBe('A');
  expect(col('Objects')).toBe('dark (plaques)');
  expect(col('Region')).toBe('ellipse (round, a dish)');
  const rim = await page.locator('#roi-results').textContent();
  expect(rim).toContain(`+${col('Cut by the rim (not counted)')} cut by the ellipse`);
  expect(col('Diameter unit')).toBe('mm');
  expect(+col('Diameter mean')).toBeGreaterThan(1.8);
  expect(+col('Diameter mean')).toBeLessThan(2.3);
  expect(col('Object diameters').split(' ').length).toBe(6);
  expect(errors).toEqual([]);
});

test('phage2-15 R in a crop box renders and keeps the value; the boxes say they are % of the image', async ({ page }) => {
  // Old build: after Tab the cursor sat in the next box and R replaced its value with
  // nothing; the four boxes were marked only T, L, B, R.
  const errors = await loadApp(page);
  await drop(page, [[tiff16([field(64, 64, 200, 3000, 4000)], { w: 64, h: 64, desc: IJ(), umPerPx: 0.1 }), 'spots.tif']]);
  const row = await openDrawer(page, 0);
  await row.locator('.f-ct').fill('10');
  await row.locator('.f-ct').press('Tab');
  await expect(row.locator('.f-cl')).toBeFocused();
  await page.keyboard.press('r');
  await expect(row.locator('.f-cl')).toHaveValue('0');
  expect(await page.evaluate(() => images[0].cropT)).toBe(10);
  await expect(row.locator('.img-settings')).toContainText('Crop % cut from each edge');
  expect(await row.locator('.f-cr').getAttribute('title')).toContain('% of the image');
  expect(errors).toEqual([]);
});

test('ISSUES trim: a fluorescence field on black starts unticked in Trim borders; a screenshot is still ticked', async ({ page }) => {
  // Old build: the DAPI and GFP fields started ticked, about to lose up to 55 % of the
  // field to a "margin" that was their own black background.
  const errors = await loadApp(page);
  const N = 256, a = new Uint16Array(N * N).fill(0);
  for (let y = 90; y < 200; y++) for (let x = 40; x < 170; x++) a[y * N + x] = 3000;
  await drop(page, [[tiff16([a], { w: N, h: N, desc: IJ(), umPerPx: 0.1 }), 'C1-cells_DAPI.tif']]);
  await page.evaluate(MICRO);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#246'; x.fillRect(40, 30, 200, 120);
    const src = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'screenshot.png'); res(); }; img.src = src; }); render(); });
  await page.evaluate(() => { document.getElementById('crop-acc').open = true; });
  await page.locator('#crop-acc button', { hasText: 'Trim borders…' }).click();
  const modal = page.locator('#info-modal-bg');
  await expect(modal).toContainText('C1-cells_DAPI.tif');
  await expect(modal).toContainText('black background');
  const ticks = await modal.locator('.trim-pick').evaluateAll(els => els.map(e => e.checked));
  expect(ticks).toEqual([false, true]);
  expect(errors).toEqual([]);
});

test('blot2-06/07 Batch crop: typed boxes keep every typed value in either order, and the next scan keeps X', async ({ page }) => {
  // Old build: Y typed before H came back as 0; H typed before Y was cut to the room
  // below the old Y (860 → 680); every next scan opened centred, so X had to be retyped;
  // the status kept saying "Draw to set crop size" after a typed box.
  const errors = await loadApp(page);
  await page.evaluate(MICRO);
  await page.evaluate(async () => { for (const n of ['blot1.png', 'blot2.png', 'blot3.png']) await _micro({ name: n, w: 900, h: 1040, bg: '#eee', blob: '#333', blobs: 12 }); });
  await page.evaluate(() => startBatchCrop());
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  const typePx = async (k, v) => { await page.locator('#crop-px-' + k).fill(String(v)); };
  const box = () => page.evaluate(() => { const s = cropEdState; return [s.cx * 900, s.cy * 1040, s.cw * 900, s.ch * 1040].map(Math.round); });
  // Y first, then H (ISSUES order)
  await typePx('x', 0); await typePx('y', 120); await typePx('w', 900); await typePx('h', 150);
  expect(await box()).toEqual([0, 120, 900, 150]);
  await expect(page.locator('#batch-crop-hint')).not.toContainText('Draw to set crop size');
  // a box at Y 360, then a taller H typed before the new Y (blot2-06 order)
  await typePx('y', 360); await typePx('h', 860); await typePx('y', 100);
  expect(await box()).toEqual([0, 100, 900, 860]);
  await typePx('w', 600); await typePx('x', 136);
  expect(await box()).toEqual([136, 100, 600, 860]);
  await page.locator('#crop-apply-btn').click();
  // the next scan opens with the same box
  await expect(page.locator('#crop-modal-title')).toContainText('(2 / 3)');
  expect(await box()).toEqual([136, 100, 600, 860]);
  expect(errors).toEqual([]);
});

test('phage2-12 Calibrate from image zooms to 1:1, so two clicks on ruler ticks of an 1800-px photo read the exact distance', async ({ page }) => {
  // Old build: the photo was shown at 320 px with no zoom (5.6 image px per screen px);
  // clicks on the 0 and 10 mm ticks gave 178.9 px for 180, and nothing said ticks are
  // not snapped to.
  const errors = await loadApp(page);
  await page.evaluate(MICRO);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1800; c.height = 1200; const x = c.getContext('2d');
    x.fillStyle = '#e8e2c8'; x.fillRect(0, 0, 1800, 1200);
    x.fillStyle = '#111'; for (let mm = 0; mm <= 10; mm++) x.fillRect(300 + mm * 18, 1000, 1, mm % 5 ? 20 : 40);   // a mm ruler, 18 px/mm
    const src = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'plate_B.jpg'); res(); }; img.src = src; }); render(); });
  const row = await openDrawer(page, 0);
  await row.locator('button', { hasText: 'Calibrate from image' }).click();
  const m = page.locator('#calib-modal');
  await expect(m).toContainText('Ruler ticks are not snapped to');
  await m.locator('.calib-zoom[data-z="1"]').click();
  const cc = m.locator('#calib-canvas');
  // scroll the 1:1 view to the ruler and click the 0 and 10 mm ticks' centres
  await page.evaluate(() => { const w = document.getElementById('calib-wrap'); w.scrollLeft = 200; w.scrollTop = 850; });
  await cc.click({ position: { x: 300.4, y: 1020 } });
  await cc.click({ position: { x: 480.6, y: 1020 } });
  expect(await m.locator('#calib-px').inputValue()).toBe('180');
  await expect(m.locator('#calib-status')).toContainText('180.0 px');
  expect(errors).toEqual([]);
});

test('ISSUES split: splitting a merge inside a bigger figure grows the grid so every new panel is drawn', async ({ page }) => {
  // Old build: "the grid was left as it is", and the parts past its last cell were
  // listed but not drawn until Columns/Rows were changed by hand.
  const errors = await loadApp(page);
  const f = v => field(32, 32, 100, v, v + 500);
  const files = [];
  for (const cond of ['Fed', 'EBSS']) for (const [c, ch] of [[1, 'DAPI'], [2, 'GFP'], [3, 'CellMask']]) files.push([tiff16([f(1000 * c)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1 }), `C${c}-U2OS_${cond}_f01_${ch}.tif`]);
  await drop(page, files);
  await page.locator('button', { hasText: 'Auto-channels' }).first().click();
  await page.evaluate(() => { sv('cols', 3); sv('rows', 2); onLayoutChange(); render(); });
  // tick Fed's three channels in the list and merge them
  for (const i of [0, 1, 2]) await rowOf(page, i).locator('.panel-pick').check();
  await page.evaluate(() => mergeTickedPanels());
  const m = await page.evaluate(() => images.findIndex(im => im && (im.channels || []).length));
  const row = await openDrawer(page, m);
  await row.locator('[data-splitch]').click();
  await expect(page.locator('#toast')).toContainText('kept their places');
  const r = await page.evaluate(() => { render(); return { out: _gridPlacements().unplaced, drawn: _figurePanels().length }; });
  expect(r.out).toBe(0);
  expect(r.drawn).toBe(7);                // EBSS's three channels, three split parts and the merge
  expect(errors).toEqual([]);
});

test('blot2-07 ✓ Apply & Next stays in view in a 1440 × 900 window', async ({ page }) => {
  // Old build: the button was below the fold of the Batch crop dialog at 900 px.
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await loadApp(page);
  await page.evaluate(MICRO);
  await page.evaluate(async () => { for (const n of ['blot1.png', 'blot2.png']) await _micro({ name: n, w: 900, h: 1040, bg: '#eee', blob: '#333', blobs: 8 }); });
  await page.evaluate(() => startBatchCrop());
  const btn = page.locator('#crop-apply-btn');
  await expect(btn).toContainText('Apply & Next');
  // a box typed, as the blot guide does, which brings up the batch's size and edit rows
  for (const [k, v] of [['w', 860], ['h', 210], ['x', 20], ['y', 75]]) await page.locator('#crop-px-' + k).fill(String(v));
  const r = await btn.evaluate(b => { const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { bottom: q.bottom, h: innerHeight, top: hit === b || b.contains(hit) }; });
  expect(r.bottom).toBeLessThanOrEqual(r.h);
  expect(r.top).toBe(true);
  expect(errors).toEqual([]);
});
