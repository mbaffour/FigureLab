// @ts-check
// Usability round 1 — images, microscopy channels, insets, scale bars and measurement
// tools. Each test reproduces a tester's finding (ids in the titles) through the UI
// where the finding was a UI problem, and through the exported numbers or pixels where
// it was an output problem. Each says what the old build did.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// ── A 16-bit greyscale TIFF writer (uncompressed, little-endian) ─────────────────────
// pages: array of Uint16Array(w*h). desc goes into page 0's ImageDescription (ImageJ
// header or OME-XML). umPerPx writes X/YResolution as pixels per unit (ImageJ style).
function tiff16(pages, { w, h, desc = '', umPerPx = 0 }) {
  const enc = Buffer.from(desc ? desc + '\0' : '', 'utf8');
  const parts = [];
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
const IJ = um => `ImageJ=1.54f\nunit=micron\n`;
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
  await row.locator('[data-gear]').click();
  await expect(row.locator('.img-settings')).toHaveClass(/open/);
  return row;
}
// The display value a panel gives the raw block at (8..24, 8..24), through the renderer's
// own adjust path (applyAdjust on the whole frame).
const BLOCK = (i) => { const im = images[i]; const w = im.img.naturalWidth, h = im.img.naturalHeight;
  const r = applyAdjust(im, 0, 0, w, h, null); const c = r.off ? r.canvas : (() => { const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').drawImage(im.img, 0, 0); return t; })();
  const d = c.getContext('2d').getImageData(12, 12, 1, 1).data; return [d[0], d[1], d[2]]; };

test.describe('fluor-01/07/08 16-bit display ranges in the file’s own values', () => {
  test('a white point typed in counts and Sync by channel show the same counts as the same grey on every GFP panel', async ({ page }) => {
    // Old build: each 16-bit file was decoded 0…its own max and the levels were 8-bit
    // numbers of that decode, with no number box. Sync copied 255 to every panel, so a
    // 6000-count block was 6000/20441 grey on one panel and 6000/65535 on another.
    const errors = await loadApp(page);
    const W = 64, H = 64;
    const files = [
      [tiff16([field(W, H, 200, 6000, 20441)], { w: W, h: H, desc: IJ(), umPerPx: 0.108 }), 'DMSO_GFP.tif'],
      [tiff16([field(W, H, 200, 6000, 65535)], { w: W, h: H, desc: IJ(), umPerPx: 0.108 }), 'BafA1_GFP.tif'],
      [tiff16([field(W, H, 200, 6000, 63532)], { w: W, h: H, desc: IJ(), umPerPx: 0.108 }), 'Torin1_GFP.tif'],
    ];
    await drop(page, files);
    await page.evaluate(() => autoDetectChannels());
    const before = await page.evaluate((B) => { const f = eval(B); return [0, 1, 2].map(f); }, BLOCK.toString());
    // the three blocks hold the same counts and are shown differently on import — that is
    // each file's own range, which the drawer now states
    expect(new Set(before.map(c => c[1])).size).toBeGreaterThan(1);
    const row = await openDrawer(page, 0);
    await expect(row.locator('.f-lv-note')).toContainText('16-bit file');
    await row.locator('.f-wpt-v').fill('12000');
    await row.locator('.f-wpt-v').dispatchEvent('change');
    await row.locator('[data-synclevels]').click();
    const r = await page.evaluate((B) => { const f = eval(B);
      return { ranges: images.map(im => _rangeText(im)), block: [0, 1, 2].map(f), toast: document.querySelector('#toast')?.textContent || '' }; }, BLOCK.toString());
    expect(r.ranges).toEqual(['0–12000', '0–12000', '0–12000']);
    // 6000 of 12000 counts is mid-grey green on all three
    r.block.forEach(c => expect(Math.abs(c[1] - 128)).toBeLessThanOrEqual(1));
    expect(errors).toEqual([]);
  });

  test('Match all, Apply to all and Sync group copy a 16-bit range in counts too, and skip an 8-bit panel by name', async ({ page }) => {
    // Old build: all three copied the 8-bit black/white numbers, so two 16-bit files with
    // different maxima got different camera ranges under matching numbers.
    const errors = await loadApp(page);
    const W = 64, H = 64;
    await drop(page, [
      [tiff16([field(W, H, 200, 6000, 20441)], { w: W, h: H }), 'a_GFP.tif'],
      [tiff16([field(W, H, 200, 6000, 65535)], { w: W, h: H }), 'b_GFP.tif'],
    ]);
    await page.evaluate(SEED);
    await page.evaluate(async () => { await _seedPic(64, 64, 'photo.png'); });
    const r = await page.evaluate(() => {
      _setLevelNative(images[0], 'white', 12000);
      matchPanelToAll(0);
      const match = [_rangeText(images[1]), images[2].whitePt, document.getElementById('toast').textContent];
      images[1].whitePt = 255; images[0].group = images[1].group = 'g';
      syncGroupToPanel(0);
      const group = _rangeText(images[1]);
      images[1].whitePt = 255;
      applySettingsToAll(0); document.querySelector('.modal-bg.open .btn-primary, #confirm-ok')?.click();
      return { match, group, all: _rangeText(images[1]) };
    });
    expect(r.match[0]).toBe('0–12000');
    expect(r.match[1]).toBe(255);
    expect(r.match[2]).toContain('levels not copied to C');
    expect(r.group).toBe('0–12000');
    expect(errors).toEqual([]);
  });

  test('the intensity bar reads the native window, and says "(8-bit)" when a 16-bit file lost its samples', async ({ page }) => {
    // Old build: the bar mapped 0–255 onto the file's min…max (the decode is 0…max), and
    // a 16-bit panel without its samples printed bare 8-bit numbers.
    const errors = await loadApp(page);
    await drop(page, [[tiff16([field(64, 64, 200, 6000, 20000)], { w: 64, h: 64 }), 'a_GFP.tif']]);
    const r = await page.evaluate(() => {
      const im = images[0]; im.lut = 'green'; im.cbar = true;
      _setLevelNative(im, 'white', 10000); _setLevelNative(im, 'black', 1000);
      const P = CanvasRenderingContext2D.prototype, orig = P.fillText, out = [];
      P.fillText = function (t, ...a) { out.push(String(t)); return orig.call(this, t, ...a); };
      try { render(); } finally { P.fillText = orig; }
      const native = out.filter(t => /^\d+$/.test(t));
      const lost = { ...im, raw: null };            // a 16-bit panel whose samples were not kept
      images[0] = lost; out.length = 0;
      P.fillText = function (t, ...a) { out.push(String(t)); return orig.call(this, t, ...a); };
      try { render(); } finally { P.fillText = orig; }
      return { native, lost: out.slice() };
    });
    expect(r.native).toEqual(expect.arrayContaining(['10000', '1000']));
    expect(r.lost.some(t => /\(8-bit\)/.test(t))).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('fluor-02/03/15/17 channel identity', () => {
  test('Auto-channels reads the channel at the end of a Fiji split-channel name, not the cell line', async ({ page }) => {
    // Old build: "GFP-LC3" in every name made all three files GFP (green), CellMask included.
    const errors = await loadApp(page);
    const f = n => [tiff16([field(32, 32, 100, 3000, 4000)], { w: 32, h: 32 }), n];
    await drop(page, [f('C1-HeLa_GFP-LC3_DMSO_60x_f01_DAPI.tif'), f('C2-HeLa_GFP-LC3_DMSO_60x_f01_GFP-LC3.tif'), f('C3-HeLa_GFP-LC3_DMSO_60x_f01_CellMask.tif')]);
    await page.locator('button', { hasText: 'Auto-channels' }).first().click();
    const r = await page.evaluate(() => images.map(im => [im.lut, _channelName(im)]));
    expect(r).toEqual([['blue', 'DAPI'], ['green', 'GFP-LC3'], ['magenta', 'CellMask']]);
    expect(errors).toEqual([]);
  });

  test('two files of one field on one channel are flagged, and the chip opens a field to rename the channel', async ({ page }) => {
    const errors = await loadApp(page);
    const f = n => [tiff16([field(32, 32, 100, 3000, 4000)], { w: 32, h: 32 }), n];
    // two channels of one field, both named GFP (C2 and C3 of the same split)
    await drop(page, [f('C2-ctrl_f01_GFP.tif'), f('C3-ctrl_f01_GFP.tif')]);
    await page.locator('button', { hasText: 'Auto-channels' }).first().click();
    await expect(page.locator('#toast')).toContainText('both GFP');
    const row = page.locator('#img-list .img-item').nth(1);
    await row.locator('[data-chanchip]').click();
    await expect(row.locator('.f-chan')).toBeFocused();
    await row.locator('.f-chan').fill('CellMask');
    await row.locator('.f-chan').dispatchEvent('change');
    const r = await page.evaluate(() => ({ key: _levelKey(images[1]), chip: document.querySelectorAll('#img-list [data-chanchip]')[1].textContent }));
    expect(r).toEqual({ key: 'CellMask', chip: 'CellMask' });
    expect(errors).toEqual([]);
  });

  test('recolouring a mis-detected panel says it still counts as GFP; naming its channel takes it out of a GFP sync', async ({ page }) => {
    // Old build: no visible field set a panel's channel; the LUT change said nothing and
    // Sync by channel from the real GFP panel rewrote the membrane panels too.
    const errors = await loadApp(page);
    const f = n => [tiff16([field(32, 32, 100, 3000, 4000)], { w: 32, h: 32 }), n];
    await drop(page, [f('a_GFP.tif'), f('b_GFP.tif')]);
    await page.evaluate(() => autoDetectChannels());
    const row = await openDrawer(page, 1);
    await row.locator('.f-lut[data-lut="magenta"]').click();
    await expect(page.locator('#toast')).toContainText('still counts as GFP');
    await row.locator('.f-chan').fill('CellMask');
    await row.locator('.f-chan').dispatchEvent('change');
    await page.evaluate(() => { _setLevelNative(images[0], 'white', 3500); images[1].whitePt = 255; syncLevelsByChannel(0); });
    const r = await page.evaluate(() => [_levelKey(images[0]), _levelKey(images[1]), images[1].whitePt, document.querySelectorAll('#img-list [data-chanchip]')[1].textContent]);
    expect(r).toEqual(['GFP', 'CellMask', 255, 'CellMask']);
    expect(errors).toEqual([]);
  });

  test('one channel name everywhere: ⚙ › Channel reaches the key, and a key Channel name the drawer contradicts follows it', async ({ page }) => {
    // The legend key's per-colour Channel names and the panel's own Channel field are one
    // path: the key prints a typed panel channel, and typing one updates a different
    // per-colour name so the tag, key and drawer never disagree.
    const errors = await loadApp(page);
    const f = n => [tiff16([field(32, 32, 100, 3000, 4000)], { w: 32, h: 32 }), n];
    await drop(page, [f('x_DAPI.tif'), f('x_membrane_GFP.tif')]);
    await page.evaluate(() => { images[0].lut = 'blue'; images[1].lut = 'magenta'; renderImgList(); render(); });
    const row = await openDrawer(page, 1);
    await row.locator('.f-chan').fill('CellMask');
    await row.locator('.f-chan').dispatchEvent('change');
    let r = await page.evaluate(() => _keyText());
    expect(r).toContain('CellMask (magenta)');
    await page.evaluate(() => setKeyChannelName('magenta', 'WGA'));
    // the drawer stays open across the list rebuild
    const row2 = page.locator('#img-list .img-item').nth(1);
    if (!(await row2.locator('.img-settings').evaluate(e => e.classList.contains('open')))) await row2.locator('[data-gear]').click();
    await row2.locator('.f-chan').fill('CellMask');
    await row2.locator('.f-chan').dispatchEvent('change');
    r = await page.evaluate(() => [_keyText(), _keyRename('magenta'), _levelKey(images[1])]);
    expect(r[0]).toContain('CellMask (magenta)');
    expect(r[1]).toBe('CellMask');
    expect(r[2]).toBe('CellMask');
    expect(errors).toEqual([]);
  });

  test('an OME-TIFF’s channel names and colours name and colour its pages', async ({ page }) => {
    // Old build: three grey pages, all tagged GFP from the file name, OME names ignored.
    const errors = await loadApp(page);
    const ome = `<?xml version="1.0"?><OME><Image ID="Image:0"><Pixels DimensionOrder="XYCZT" SizeX="32" SizeY="32" SizeC="3" SizeZ="1" SizeT="1" Type="uint16" PhysicalSizeX="0.108333" PhysicalSizeXUnit="µm">`
      + `<Channel ID="Channel:0:0" Name="DAPI" Color="65535"/><Channel ID="Channel:0:1" Name="GFP-LC3" Color="16711935"/><Channel ID="Channel:0:2" Name="CellMask" Color="-16711681"/></Pixels></Image></OME>`;
    const pg = v => field(32, 32, 100, v, v + 500);
    await drop(page, [[tiff16([pg(1000), pg(2000), pg(3000)], { w: 32, h: 32, desc: ome }), 'HeLa_GFP-LC3_DMSO_3ch.ome.tif']]);
    const r = await page.evaluate(() => images.map(im => [im.chan, im.lut, _channelName(im), +im.umPerPx.toFixed(6)]));
    expect(r).toEqual([['DAPI', 'blue', 'DAPI', 0.108333], ['GFP-LC3', 'green', 'GFP-LC3', 0.108333], ['CellMask', 'magenta', 'CellMask', 0.108333]]);
    expect(errors).toEqual([]);
  });
});

test('fluor-04/34 Merge then Split gives back the channel files: native samples, file names, channel names', async ({ page }) => {
  // Old build: split parts were new 8-bit images named DAPI.png / GFP.png / RFP.png and
  // every row carried "⚠ duplicate name".
  const errors = await loadApp(page);
  const f = (n, v) => [tiff16([field(32, 32, 100, v, v + 900)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1 }), n];
  await drop(page, [f('C1-x_DMSO_DAPI.tif', 1000), f('C2-x_DMSO_GFP-LC3.tif', 2000), f('C3-x_DMSO_CellMask.tif', 3000)]);
  await page.evaluate(() => { autoDetectChannels(); document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = true; }); mergeTickedPanels(); });
  const mi = await page.evaluate(() => images.findIndex(im => im && im.channels && im.channels.length));
  await page.evaluate(i => splitChannelRow(i), mi);
  await page.waitForFunction(() => images.filter(Boolean).every(im => im.img && im.img.complete));
  const r = await page.evaluate(() => {
    const parts = images.filter(im => im && im._splitOf != null);
    return { parts: parts.map(p => [p.name, _channelName(p), !!_rawOf(p), _rangeText(p)]),
      dupBadges: document.querySelectorAll('#img-list .img-meta').length ? [...document.querySelectorAll('#img-list .img-meta')].filter(m => /duplicate name/.test(m.textContent)).length : -1 };
  });
  expect(r.parts).toEqual([
    ['C1-x_DMSO_DAPI.tif', 'DAPI', true, '0–1900'],
    ['C2-x_DMSO_GFP-LC3.tif', 'GFP-LC3', true, '0–2900'],
    ['C3-x_DMSO_CellMask.tif', 'CellMask', true, '0–3900'],
  ]);
  expect(r.dupBadges).toBe(0);
  expect(errors).toEqual([]);
});

test('newcomer-08 a saved session reopens a 16-bit panel with its native samples', async ({ page }) => {
  // Old build: the session held the 8-bit display PNG only; after reopening, levels and
  // densitometry read 8-bit display values without a word.
  const errors = await loadApp(page);
  const px = field(48, 40, 26, 3000, 4223);
  await drop(page, [[tiff16([px], { w: 48, h: 40, desc: IJ(), umPerPx: 0.2 }), 'cells_16bit.tif']]);
  const json = await page.evaluate(() => { _setLevelNative(images[0], 'white', 3500); return JSON.stringify(_withRawSave(() => serializeSession(true))); });
  await page.evaluate(j => applySession(JSON.parse(j), { origin: 'file' }), json);
  await page.waitForFunction(() => images[0] && images[0].img && images[0].img.complete && images[0].img.naturalWidth > 0);
  const r = await page.evaluate(() => { const im = images[0], rw = _rawOf(im);
    return { kept: !!rw, depth: rw && _rawDepth(rw), v: rw && [rw.data[0], rw.data[12 * 48 + 12], rw.data[38 * 48 + 46]], range: _rangeText(im),
      hist: JSON.stringify(_panelHistory(im)) }; });
  expect(r.kept).toBe(true);
  expect(r.depth).toBe('16-bit');
  expect(r.v).toEqual([26, 3000, 4223]);
  expect(r.range).toBe('0–3500');
  expect(r.hist).toContain('retained (16-bit)');
  // Autosave does not carry them (browser storage would overflow)
  const auto = await page.evaluate(() => JSON.stringify(serializeSession(true)).includes('"rawRec"'));
  expect(auto).toBe(false);
  expect(errors).toEqual([]);
});

test('newcomer-09 Methods, metadata CSV and PANEL_HISTORY state the 16-bit display range', async ({ page }) => {
  // Old build: Methods said nothing about the bit depth and the CSV/PNG said Levels 0-255.
  const errors = await loadApp(page);
  await drop(page, [[tiff16([field(48, 40, 26, 3000, 4223)], { w: 48, h: 40, desc: IJ(), umPerPx: 0.2 }), 'cells_16bit.tif']]);
  const r = await page.evaluate(async () => {
    const m = generateMethodsParagraph();
    const csv = await _captureDownload(() => exportCSV());
    return { m, csv: csv ? new TextDecoder().decode(csv.data) : '', hist: JSON.stringify(_panelHistory(images[0])) };
  });
  expect(r.m).toContain('16-bit images were mapped linearly to 8 bits for display');
  expect(r.m).toContain('0–4223');
  expect(r.csv.split('\n')[0]).toMatch(/,DisplayRange$/);
  expect(r.csv).toContain('16-bit, displayed linearly from 0 to 4223 (native values)');
  expect(r.hist).toContain('displayRange');
  expect(errors).toEqual([]);
});

test('fluor-29 Grayscale on a pseudocoloured panel turns it grey and shows its state', async ({ page }) => {
  // Old build: grayscale ran before the LUT, so a green panel stayed green, and the
  // Methods then claimed the panel "was converted to grayscale".
  const errors = await loadApp(page);
  await drop(page, [[tiff16([field(32, 32, 100, 3000, 4000)], { w: 32, h: 32 }), 'a_GFP.tif']]);
  await page.evaluate(() => { images[0].lut = 'green'; renderImgList(); });
  const row = await openDrawer(page, 0);
  await row.locator('.f-gray').click();
  const r = await page.evaluate((B) => { const f = eval(B); const c = f(0); return { lut: images[0].lut, grey: c[0] === c[1] && c[1] === c[2], m: generateMethodsParagraph() }; }, BLOCK.toString());
  expect(r.lut).toBe('none');
  expect(r.grey).toBe(true);
  expect(r.m).not.toContain('converted to grayscale');
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scale bars
// ═══════════════════════════════════════════════════════════════════════════════
// One grid panel from a generated picture: w×h, grey, optional draw code and a
// calibration. Returns its index.
const SEED = `window._seedPic = async (w, h, name, umPerPx, draw) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, w, h);
  if (draw) (new Function('x', 'w', 'h', draw))(x, w, h);
  const src = c.toDataURL('image/png');
  await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name, null, umPerPx ? { umPerPx, source: 'test' } : null); res(); }; img.src = src; });
  render(); return images.length - 1; };`;

test('newcomer-05/blot-08 scale bars start off on uncalibrated panels; compliance offers "No scale bar on these"', async ({ page }) => {
  // Old build: every import had its bar on, so a blot, a chart and a photo each carried
  // "⚠ calibrate" and failed compliance, and the only fix button opened the calibrator.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(200, 120, 'blot.png'); await _seedPic(200, 120, 'chart.png'); await _seedPic(512, 512, 'cells.tif', 0.2); });
  let r = await page.evaluate(() => ({ on: images.map(im => im.sbOn), badges: document.querySelectorAll('#img-list .f-calib-warn').length }));
  expect(r.on).toEqual([false, false, true]);
  expect(r.badges).toBe(0);
  // a figure from an older session can still have them on: one click switches them off
  await page.evaluate(() => { images[0].sbOn = true; images[1].sbOn = true; renderImgList(); render(); checkCompliance(); });
  const row = page.locator('.compliance-row', { hasText: 'Scale-bar calibration' });
  await expect(row.locator('button', { hasText: 'Calibrate' })).toBeVisible();
  await row.locator('button', { hasText: 'No scale bar on these' }).click();
  r = await page.evaluate(() => ({ on: images.map(im => im.sbOn) }));
  expect(r.on).toEqual([false, false, true]);
  // and the command palette finds it
  const found = await page.evaluate(() => CMD_REGISTRY.filter(c => _cmdpScore(c, 'scale bar off') > 0).map(c => c.label));
  expect(found.some(l => /uncalibrated/i.test(l))).toBe(true);
  expect(errors).toEqual([]);
});

test('phage-07/newcomer-07 Auto bar length is a fifth of the field in source pixels, in nm for TEM and mm for a plate', async ({ page }) => {
  // Old build: 20 % of the CELL's display width × source µm/px — 20 nm on a 1 µm TEM field
  // (a 6-px bar) and 2 mm on a 90 mm plate.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(2048, 64, 'tem.png', 0.000507); await _seedPic(1000, 1000, 'plate.jpg', 90); });
  await page.evaluate(() => { images.forEach(im => { im.sbUm = 10; im.sbUnit = 'µm'; }); renderImgList(); });
  const row = await openDrawer(page, 0);
  await row.locator('[data-autosb]').click();
  const row1 = await openDrawer(page, 1);
  await row1.locator('[data-autosb]').click();
  const r = await page.evaluate(() => images.map(im => _sbLabel(im)));
  expect(r).toEqual(['200 nm', '20 mm']);
  // and a calibrated import gets a fitted bar straight away
  const imp = await page.evaluate(async () => { await _seedPic(2048, 64, 'tem2.png', 0.000507); const im = images[2]; return [im.sbOn, _sbLabel(im)]; });
  expect(imp).toEqual([true, '200 nm']);
  expect(errors).toEqual([]);
});

test('phage-06 Auto-detect finds the white bar in a TEM info strip and takes nm', async ({ page }) => {
  // Old build: ReferenceError refV before any dialog; µm choices only.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(2048, 600, 'tem.tif', 0,
    "x.fillStyle='#000'; x.fillRect(0, 520, w, 80); x.fillStyle='#fff'; x.fillRect(100, 550, 400, 8); x.fillRect(560, 545, 30, 20);"); });
  await page.evaluate(() => autoDetectScaleBar(0));
  const dlg = page.locator('#sbdetect-modal');
  await expect(dlg).toContainText('400 px');
  await dlg.locator('.sbd-pick', { hasText: '200 nm' }).click();
  const r = await page.evaluate(() => { render(); const im = images[0]; return { um: im.umPerPx, label: _sbLabel(im), on: im.sbOn, drawn: _scaleBarDrawn(im) }; });
  expect(r.um).toBeCloseTo(0.0005, 9);
  expect(r.on).toBe(true);
  expect(r.drawn).toBe(true);
  expect(r.label).toMatch(/nm$/);
  expect(errors).toEqual([]);
});

test('phage-08/10 calibration clicks snap to the bar ends, the pixel distance can be typed, and the bar is redrawn to fit', async ({ page }) => {
  // Old build: clicks on a 320-px preview of a 2048-px image measured 394 px for a 400-px
  // bar; there was no pixel field; the bar stayed at 10 µm (wider than the field) and
  // vanished; the toast said 0.0005 µm/px.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(2048, 600, 'tem.tif', 0,
    "x.fillStyle='#000'; x.fillRect(0, 520, w, 80); x.fillStyle='#fff'; x.fillRect(100, 550, 400, 8);"); });
  await page.evaluate(() => openCalib(0));
  const cc = page.locator('#calib-canvas');
  const sc = await page.evaluate(() => calibState.scale);
  const box = await cc.boundingBox();
  const k = box.width / (await page.evaluate(() => document.getElementById('calib-canvas').width));
  // two clicks, each a screen pixel or so off the bar's ends
  await cc.click({ position: { x: (100 * sc + 1.5) * k, y: 554 * sc * k } });
  await cc.click({ position: { x: (500 * sc - 1.2) * k, y: 554 * sc * k } });
  await expect(page.locator('#calib-status')).toContainText('snapped');
  expect(await page.locator('#calib-px').inputValue()).toBe('400');
  await page.locator('#calib-um').fill('200');
  await page.locator('#calib-unit').selectOption('0.001');
  await page.locator('#calib-apply').click();
  const r = await page.evaluate(() => { render(); const im = images[0]; return { um: im.umPerPx, on: im.sbOn, label: _sbLabel(im), drawn: _scaleBarDrawn(im), toast: document.getElementById('toast').textContent }; });
  expect(r.um).toBeCloseTo(0.0005, 9);
  expect(r.on).toBe(true);
  expect(r.drawn).toBe(true);
  expect(r.toast).toContain('0.5 nm/px');
  // a typed pixel distance wins over the clicks
  await page.evaluate(() => openCalib(0));
  await page.locator('#calib-px').fill('250');
  await page.locator('#calib-um').fill('100');
  await page.locator('#calib-unit').selectOption('0.001');
  await page.locator('#calib-apply').click();
  expect(await page.evaluate(() => images[0].umPerPx)).toBeCloseTo(0.0004, 9);
  expect(errors).toEqual([]);
});

test('fluor-23 Same bar on all calibrated: a 1-2-5 length, and an inset too small for it gets its own and is named', async ({ page }) => {
  // Old build: 40 µm everywhere (1.5/4 steps), and a 43 µm-wide inset silently lost its bar.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(2048, 256, 'a.tif', 0.108); await _seedPic(2048, 256, 'b.tif', 0.108); await _seedPic(400, 400, 'zoom.tif', 0.108); selectedPanel = -1; uniformScaleBars(); render(); });
  const r = await page.evaluate(() => ({ labels: images.map(im => _sbLabel(im)), drawn: images.map(im => _scaleBarDrawn(im)), toast: document.getElementById('toast').textContent }));
  expect(r.labels).toEqual(['50 µm', '50 µm', '10 µm']);
  expect(r.drawn).toEqual([true, true, true]);
  expect(r.toast).toContain('C 10 µm');
  expect(errors).toEqual([]);
});

test('phage-09/newcomer-26 the list badges follow the bar without a list rebuild', async ({ page }) => {
  // Old build: "⚠ no bar" and "⚠ calibrate" were written when the list was built and stayed
  // after the bar length or calibration was fixed.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(2048, 64, 'tem.png', 0.000507); images[0].sbUm = 10; images[0].sbUnit = 'µm'; renderImgList(); render(); render(); });
  await expect(page.locator('#img-list .img-item').first()).toContainText('no bar');
  const row = await openDrawer(page, 0);
  await row.locator('.f-sbunit').selectOption('nm');
  await row.locator('.f-sbum').fill('200');
  await page.evaluate(() => render());
  await expect(page.locator('#img-list .img-item').first()).not.toContainText('no bar');
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Linked insets and hidden panels
// ═══════════════════════════════════════════════════════════════════════════════
// Three channel files merged (sources hidden), plus two more panels: [hidden×3, merge, P, Q].
async function mergedFigure(page) {
  // only the GFP file has the bright block at (8..24, 8..24)
  const f = (n, v) => [tiff16([field(64, 64, 50, v, 3100)], { w: 64, h: 64, desc: IJ(), umPerPx: 0.1 }), n];
  await drop(page, [f('C1-x_DMSO_DAPI.tif', 50), f('C2-x_DMSO_GFP.tif', 3000), f('C3-x_DMSO_CellMask.tif', 50)]);
  await page.evaluate(() => { autoDetectChannels(); document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = true; }); mergeTickedPanels(); });
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(64, 64, 'p.png'); await _seedPic(64, 64, 'q.png'); sv('cols', 3); sv('rows', 1); onLayoutChange(); render(); });
}

test('fluor-09 in 📌 Panel mode a click selects the panel, the inset is of that panel, and never of a hidden one', async ({ page }) => {
  // Old build: in Panel mode a click selected nothing and the inset fell back to the
  // FIRST panel in the list — a hidden source file — and was appended hidden, silently.
  const errors = await loadApp(page);
  await mergedFigure(page);
  // nothing selected and several panels shown: it asks, instead of guessing
  await page.evaluate(() => { selectedPanel = -1; pickInsetRegion(); });
  await expect(page.locator('#toast')).toContainText('Click the panel you want to magnify');
  expect(await page.evaluate(() => document.getElementById('crop-modal').classList.contains('open'))).toBe(false);
  // Panel mode on, select tool: click panel Q
  await page.evaluate(() => { if (!panelAnnMode) togglePanelAnnMode(); setTool('none'); render(); });
  const q = await page.evaluate(() => { const i = images.findIndex(im => im && im.name === 'q.png'); const b = panelBounds.find(p => p.idx === i); return { i, x: b.x + b.w / 2, y: b.y + b.h / 2 }; });
  await page.evaluate(({ x, y }) => { const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + x * r.width / canvasLogicalW, clientY: r.top + y * r.height / canvasLogicalH, button: 0 };
    c.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 })); c.dispatchEvent(new MouseEvent('mouseup', o)); }, q);
  expect(await page.evaluate(() => selectedPanel)).toBe(q.i);
  await expect(page.locator('#inset-target-note')).toContainText('Inset of: panel');
  await page.evaluate(() => pickInsetRegion());
  await expect(page.locator('#crop-modal-title')).toContainText(await page.evaluate(i => formatLabel(images[i].label), q.i));
  expect(errors).toEqual([]);
});

test('fluor-10/11 the region picker shows the coloured merge, and the inset lands right after its panel', async ({ page }) => {
  // Old build: the picker drew the base channel (DAPI) in grey and the inset went to the
  // end of the list.
  const errors = await loadApp(page);
  await mergedFigure(page);
  const m = await page.evaluate(() => images.findIndex(im => im && im.channels && im.channels.length));
  // the merge's right-click menu offers it
  await page.evaluate(i => { render(); const b = panelBounds.find(p => p.idx === i); showPanelMenu(i, 100, 100); }, m);
  await page.locator('#panel-ctx-menu div', { hasText: 'Add linked inset' }).click();
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  // the GFP block (3000 counts, the brightest channel) is green in the picker's picture
  const px = await page.evaluate(() => { const c = cropEdState.img; const d = c.getContext('2d').getImageData(12, 12, 1, 1).data; return [d[0], d[1], d[2]]; });
  expect(px[1]).toBeGreaterThan(200);
  expect(px[1]).toBeGreaterThan(px[0] + 60);
  await page.evaluate(() => { Object.assign(cropEdState, { cx: 0.1, cy: 0.1, cw: 0.3, ch: 0.3 }); applyCropModal(); });
  const r = await page.evaluate(i => ({ next: images[i + 1] && images[i + 1].insetOf === images[i].id, hidden: images[i + 1].excluded }), m);
  expect(r).toEqual({ next: true, hidden: false });
  expect(errors).toEqual([]);
});

test('fluor-22 an inset’s Crop Editor edits its region, and the inset follows', async ({ page }) => {
  // Old build: the inset's crop editor applied a crop that the next render overwrote with
  // the inset region — a silent no-op.
  const errors = await loadApp(page);
  await mergedFigure(page);
  const m = await page.evaluate(() => images.findIndex(im => im && im.channels && im.channels.length));
  await page.evaluate(i => { selectedPanel = i; addLinkedInset(0.1, 0.1, 0.25, 0.25); render(); }, m);
  const row = await openDrawer(page, m + 1);
  await expect(row.locator('[data-opencrop]')).toContainText('Edit inset region');
  await row.locator('[data-opencrop]').click();
  await expect(page.locator('#crop-modal-title')).toContainText('Region of inset');
  await page.evaluate(() => { Object.assign(cropEdState, { cx: 0.5, cy: 0.5, cw: 0.4, ch: 0.4 }); applyCropModal(); render(); });
  const r = await page.evaluate(i => { const ins = images[i + 1]; return { rect: ins.insetRect, l: +ins.cropL.toFixed(1), t: +ins.cropT.toFixed(1) }; }, m);
  expect(r.rect).toEqual({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 });
  expect([r.l, r.t]).toEqual([50, 50]);
  expect(errors).toEqual([]);
});

test('fluor-12/30 headings on: the sources a merge hid stay out of the grid; hiding the last row shrinks it', async ({ page }) => {
  // Old build: turning headings on made every hidden source a gap (a 3 × 1 figure became
  // 6 × 1 worth of cells); hiding a whole last row left a row of blank cells.
  const errors = await loadApp(page);
  await mergedFigure(page);
  await page.locator('#labels-toggle-btn, button:has-text("⊞ Labels")').first().click().catch(async () => { await page.evaluate(() => { sc('show-col-labels', true); onLayoutChange(); }); });
  await page.evaluate(() => { if (!gc('show-col-labels')) { sc('show-col-labels', true); onLayoutChange(); } render(); });
  let r = await page.evaluate(() => ({ named: _gridIsNamed(), order: _gridOrder().length, unplaced: _gridPlacements().unplaced, cols: gi('cols'), rows: gi('rows') }));
  expect(r.named).toBe(true);
  expect(r.order).toBe(3);                 // the merge, P and Q — not the three parked sources
  expect(r.unplaced).toBe(0);
  // a second row, then hide it panel by panel
  await page.evaluate(async () => { await _seedPic(64, 64, 'r1.png'); await _seedPic(64, 64, 's1.png'); await _seedPic(64, 64, 't1.png'); sv('cols', 3); sv('rows', 2); onLayoutChange(); render(); });
  await page.evaluate(() => { ['r1.png', 's1.png', 't1.png'].forEach(n => togglePanelExcluded(images.findIndex(im => im && im.name === n))); render(); });
  r = await page.evaluate(() => ({ rows: gi('rows'), toast: document.getElementById('toast').textContent }));
  expect(r.rows).toBe(1);
  expect(r.toast).toContain('grid now 3 × 1');
  expect(errors).toEqual([]);
});

test('fluor-25 a redraw reuses each merge’s composite, hidden panels drop their caches, and autosave serializes once', async ({ page }) => {
  // Old build: every redraw rebuilt every merge (and every inset of a merge) at full
  // resolution — three canvases and three getImageData copies per merge per frame — and
  // a too-big autosave re-serialized the whole figure once per panel. On fifteen 2048²
  // panels the compliance check's redraw (and the autosave after the preset) ended the tab.
  const errors = await loadApp(page);
  await mergedFigure(page);
  const m = await page.evaluate(() => images.findIndex(im => im && im.channels && im.channels.length));
  await page.evaluate(i => { selectedPanel = i; addLinkedInset(0.1, 0.1, 0.3, 0.3); }, m);
  const r = await page.evaluate(() => {
    render();
    let built = 0; const orig = _applyCompositeUncached;
    window._applyCompositeUncached = function (...a) { built++; return orig.apply(this, a); };
    // classic-script functions are globals: rebind the name the caller uses
    _applyCompositeUncached = window._applyCompositeUncached;
    render(); render(); checkCompliance();
    document.getElementById('info-modal-bg')?.remove();
    _applyCompositeUncached = orig;
    const hiddenCaches = images.filter(im => im && im.excluded).some(im => im._adjCache || im._compCache || im._cropCache);
    // autosave with pixels far past the storage budget: one JSON.stringify, not one per panel
    images.forEach(im => { if (im && !im.excluded) im.src = 'data:image/png;base64,' + 'A'.repeat(1.5e6); });
    let strs = 0; const S = JSON.stringify;
    JSON.stringify = function (...a) { strs++; return S.apply(this, a); };
    const set = Storage.prototype.setItem; Storage.prototype.setItem = function () {};
    try { autosaveNow(); } finally { JSON.stringify = S; Storage.prototype.setItem = set; }
    return { built, hiddenCaches, strs };
  });
  expect(r.built).toBe(0);
  expect(r.hiddenCaches).toBe(false);
  expect(r.strs).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('newcomer-04 Trim borders previews what it would cut, ignores a beige surround, and starts a blot unticked', async ({ page }) => {
  // Old build: trimmed every panel with a uniform edge at once — a plate photo was cut at
  // the dish rim and a blot cut to a strip — with only "Trimmed the borders of 4 panels".
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => {
    await _seedPic(300, 200, 'screenshot.png', 0, "x.fillStyle='#fff'; x.fillRect(0,0,w,h); x.fillStyle='#246'; x.fillRect(40,30,200,120);");
    await _seedPic(300, 300, 'plate_photo.jpg', 0, "x.fillStyle='#d8c8a8'; x.fillRect(0,0,w,h); x.fillStyle='#e8e0c0'; x.beginPath(); x.arc(150,150,120,0,7); x.fill();");
    await _seedPic(300, 120, 'western_blot.png', 0, "x.fillStyle='#f4f4f4'; x.fillRect(0,0,w,h); x.fillStyle='#333'; x.fillRect(40,30,40,12); x.fillRect(120,30,40,12);");
  });
  await page.evaluate(() => { document.getElementById('crop-acc').open = true; });
  await page.locator('#crop-acc button', { hasText: 'Trim borders…' }).click();
  const modal = page.locator('#info-modal-bg');
  await expect(modal).toContainText('screenshot.png');
  await expect(modal).not.toContainText('plate_photo.jpg');
  const ticks = await modal.locator('.trim-pick').evaluateAll(els => els.map(e => e.checked));
  expect(ticks).toEqual([true, false]);                 // the screenshot ticked, the blot not
  await modal.locator('#trim-apply-btn').click();
  const r = await page.evaluate(() => images.map(im => [im.cropL, im.cropT]));
  expect(r[0][0]).toBeGreaterThan(10);
  expect(r[1]).toEqual([0, 0]);
  expect(r[2]).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('phage-14 Count finds dark plaques inside a dish, on source pixels, with diameters in mm, and shows what it counted', async ({ page }) => {
  // Old build: only objects ≥ threshold (the lawn = 1 object), rectangle only, display
  // pixels, "µm² unavailable" on a calibrated photo, and nothing drawn on the figure.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  // a 900-px photo, 0.1 mm/px (100 µm/px): black background, a light lawn disc, six
  // dark plaques 20 px (2 mm) across
  await page.evaluate(async () => { await _seedPic(900, 900, 'plate.jpg', 100,
    "x.fillStyle='#000'; x.fillRect(0,0,w,h); x.fillStyle='#ddd'; x.beginPath(); x.arc(450,450,400,0,7); x.fill(); x.fillStyle='#555';"
    + "[[300,300],[600,300],[450,450],[300,600],[600,600],[450,700]].forEach(([a,b])=>{ x.beginPath(); x.arc(a,b,10,0,7); x.fill(); });");
    sv('cols', 1); sv('rows', 1); onLayoutChange(); render(); });
  await page.locator('#measure-acc summary').click();
  await page.locator('#measure-acc [data-tool="measure-count"]').click();
  await page.locator('#count-polarity').selectOption('dark');
  await page.locator('#count-ellipse').check();
  const pb = await page.evaluate(() => { const b = panelBounds[0]; return [b.ix, b.iy, b.iw, b.ih]; });
  // drag around the dish (its bounding box, a little inside the picture)
  await page.evaluate(([x, y, w, h]) => {
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const P = (fx, fy) => ({ bubbles: true, clientX: r.left + fx * r.width / canvasLogicalW, clientY: r.top + fy * r.height / canvasLogicalH, button: 0 });
    const a = P(x + w * 50 / 900, y + h * 50 / 900), b = P(x + w * 850 / 900, y + h * 850 / 900);
    c.dispatchEvent(new MouseEvent('mousedown', { ...a, buttons: 1 }));
    c.dispatchEvent(new MouseEvent('mousemove', { ...b, buttons: 1 }));
    c.dispatchEvent(new MouseEvent('mouseup', { ...b, buttons: 0 }));
  }, pb);
  const r = await page.evaluate(() => { const m = measurements[measurements.length - 1];
    return { count: m.count, source: m.source, roi: m.roi, html: document.getElementById('roi-results').textContent, marks: _countOverlay && _countOverlay.pts.length }; });
  expect(r.count).toBe(6);
  expect(r.source).toBe('source pixels (8-bit)');
  expect(r.roi).toBe('ellipse');
  expect(r.html).toMatch(/Equivalent diameter: 1\.\d+ ± [\d.]+ mm/);
  expect(r.html).toContain('µm²');
  expect(r.marks).toBe(6);
  expect(errors).toEqual([]);
});

test('fluor-14 the deuteranopia preview turns green yellowish and magenta bluish, so the pair stays apart', async ({ page }) => {
  // Old build: sRGB-space matrices applied in linear RGB made pure green and magenta both
  // neutral grey — the recommended colour-blind-safe pair looked identical.
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const out = {};
    for (const [k, col] of [['green', '#00ff00'], ['magenta', '#ff00ff']]) {
      const s = document.createElement('canvas'); s.width = s.height = 4; const sx = s.getContext('2d'); sx.fillStyle = col; sx.fillRect(0, 0, 4, 4);
      const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d');
      x.filter = 'url(#cvd-deuter)'; x.drawImage(s, 0, 0);
      out[k] = [...x.getImageData(1, 1, 1, 1).data.slice(0, 3)];
    }
    return out;
  });
  const [gr, gg, gb] = r.green, [mr, mg, mb] = r.magenta;
  expect(gr).toBeGreaterThan(150); expect(gg).toBeGreaterThan(150); expect(gb).toBeLessThan(110);   // yellowish
  expect(mb).toBeGreaterThan(200); expect(mb - Math.max(mr, mg)).toBeGreaterThan(60);                 // bluish
  expect(errors).toEqual([]);
});

test('phage-15 one calibration onto the ticked panels, each with a bar that fits, and Methods says where it came from', async ({ page }) => {
  // Old build: no copy action — read 46.2643 off one panel and type it into the next.
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await _seedPic(900, 900, 'plateB.jpg'); await _seedPic(600, 600, 'plateC.jpg'); images[0].umPerPx = 100; images[0]._metaUmPerPx = 0; renderImgList(); });
  await page.locator('#img-list .panel-pick').nth(1).check();
  const row = await openDrawer(page, 0);
  await row.locator('button', { hasText: 'Same µm/px on ticked panels' }).click();
  const r = await page.evaluate(() => ({ um: images[1].umPerPx, on: images[1].sbOn, bar: _sbLabel(images[1]), m: generateMethodsParagraph() }));
  expect(r.um).toBe(100);
  expect(r.on).toBe(true);
  expect(r.bar).toBe('10 mm');                           // a fifth of a 60 mm field
  expect(r.m).toContain('copied from panel A');
  expect(errors).toEqual([]);
});

test('phage-12/fluor-06 the palette finds the measuring tools by the words a biologist types; each list row shows its file name', async ({ page }) => {
  // Old build: "ruler" found only the CSV export, "measure" and "plaque" nothing useful,
  // "count" an AI command; and a list row hid the file name behind the label box.
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const top = q => { const l = CMD_REGISTRY.map(c => ({ c, s: _cmdpScore(c, q) })).filter(o => o.s > 0).sort((a, b) => b.s - a.s); return l.length ? l[0].c.label : ''; };
    return { ruler: top('ruler'), measure: top('measure'), count: top('count'), plaque: top('plaque'), tem: top('tem scale bar'), trim: top('remove white border') };
  });
  expect(r.ruler).toMatch(/^Ruler/);
  expect(r.measure).toMatch(/Ruler|Count|ROI|profile/i);
  expect(r.count).toMatch(/^Count objects/);
  expect(r.plaque).toMatch(/^Count objects/);
  expect(r.tem).toMatch(/scale.bar/i);
  expect(r.trim).toMatch(/^Trim borders/);
  await drop(page, [[tiff16([field(32, 32, 100, 3000, 4000)], { w: 32, h: 32 }), 'C2-HeLa_GFP-LC3_BafA1_60x_f01_GFP-LC3.tif']]);
  await expect(page.locator('#img-list .img-item .f-fname').first()).toBeVisible();
  await expect(page.locator('#img-list .img-item .f-fname').first()).toContainText('BafA1');
  expect(errors).toEqual([]);
});
