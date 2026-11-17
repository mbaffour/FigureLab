// @ts-check
// Usability round 4, group "misc": per-panel channel names, gene maps, the calibration
// dialog, dialogs and toasts, and the remaining polish (finding IDs in the titles). Each test
// drives the path the tester took and fails on the build they tested (41f6721).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { loadApp, seedPanels } = require('./helpers');

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


// Two conditions, DAPI and a magenta channel each, plus a merge of condition 1 (DAPI + its
// magenta channel) and a linked inset of panel B — the fluorescence tester's B, G, merges and insets.
async function seedMagenta(page) {
  const f = (v) => field(32, 32, 200, v, 20000);
  await drop(page, [
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C1-U2OS_DMSO_f01_DAPI.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C2-U2OS_DMSO_f01_Parkin.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C1-U2OS_CCCP_f01_DAPI.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ(), umPerPx: 0.1032 }), 'C2-U2OS_CCCP_f01_Parkin.tif'],
  ]);
  await page.evaluate(() => {
    images[0].lut = 'blue'; images[1].lut = 'magenta'; images[2].lut = 'blue'; images[3].lut = 'magenta';
    const ck = document.getElementById('tag-channels'); if (ck && !ck.checked) { ck.checked = true; }
    images.forEach((im, i) => { im.label = 'ABCD'[i]; });
    // E: a merge of condition 1 (its own DAPI and the magenta channel)
    const m = cloneImageForUndo(images[0]); m.id = Date.now() + Math.random(); m.label = 'E'; m.name = 'U2OS_DMSO_f01_merge';
    m.channels = [{ name: images[1].name, img: images[1].img, src: images[1].src, lut: 'magenta', blackPt: 0, whitePt: 255 }];
    images.push(m);
    // F: a linked inset of B
    const ins = cloneImageForUndo(images[1]); ins.id = Date.now() + Math.random() + 1; ins.label = 'F';
    ins.insetOf = images[1].id; ins.insetRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }; ins.panelAnns = [];
    images.push(ins);
    sv('cols', '3'); sv('rows', '2'); onLayoutChange(); renderImgList(); render();
  });
}
async function renameInKey(page, lut, name) {
  await page.evaluate(() => render());
  const inp = page.locator(`#key-names-ui .key-name-in[data-lut="${lut}"]`);
  await expect(inp).toHaveCount(1);
  await inp.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, name);
}
const tagsOf = (page) => page.evaluate(() => { render(); return images.map(im => _panelTagParts(im, '#fff').map(p => p.str).join(' ')); });
async function typeChannel(page, idx, name) {
  const row = page.locator('#img-list .img-item').nth(idx);
  await row.locator('button.f-chan-chip').click();
  await expect(row.locator('.f-chan')).toBeFocused();
  await row.locator('.f-chan').fill(name); await row.locator('.f-chan').press('Enter');
  await row.locator('.f-chan').blur();
}

test('fluor4-05 / fluor3-06: a name typed in one panel\'s Channel field renames that panel (and its inset) only, after the colour was named under Channel names', async ({ page }) => {
  const errors = await loadApp(page);
  await seedMagenta(page);
  await renameInKey(page, 'magenta', 'mScarlet-Parkin');
  expect(await tagsOf(page)).toEqual(['DAPI', 'mScarlet-Parkin', 'DAPI', 'mScarlet-Parkin', 'DAPI mScarlet-Parkin', 'mScarlet-Parkin']);
  const row = page.locator('#img-list .img-item').nth(1);
  await row.locator('button.f-chan-chip').click();
  await expect(row.locator('.f-chan-note')).toContainText('renames this panel only');
  await row.locator('.f-chan').fill('TOM20'); await row.locator('.f-chan').press('Enter'); await row.locator('.f-chan').blur();
  // was: B, D, the merge E and the inset F all became "TOM20"
  expect(await tagsOf(page)).toEqual(['DAPI', 'TOM20', 'DAPI', 'mScarlet-Parkin', 'DAPI mScarlet-Parkin', 'TOM20']);
  await expect(page.locator('#toast')).toContainText('this panel only');
  await expect(page.locator('#img-list .img-item').nth(5).locator('.f-chan')).toBeDisabled();      // the inset goes by its panel
  const r = await page.evaluate(() => { generateCaption(); return {
    key: document.getElementById('key-text').value,
    keyField: document.querySelector('#key-names-ui .key-name-in[data-lut="magenta"]').value,
    groups: channelIdentityGroups().map(g => g.name).sort(),
    methods: generateMethodsParagraph(), caption: gv('caption-out') }; });
  expect(r.key).toMatch(/TOM20 \/ mScarlet-Parkin \(magenta\)|mScarlet-Parkin \/ TOM20 \(magenta\)/);
  expect(r.keyField).toContain('TOM20');
  expect(r.groups).toEqual(['DAPI', 'TOM20', 'mScarlet-Parkin']);
  expect(r.methods).toContain('TOM20');
  expect(r.caption).toContain('TOM20');
  expect(r.caption).toContain('mScarlet-Parkin');
  // one undo step
  await page.evaluate(() => { undo(); render(); });
  expect((await tagsOf(page))[1]).toBe('mScarlet-Parkin');
  await page.evaluate(() => { redo(); render(); });
  expect((await tagsOf(page))[1]).toBe('TOM20');
  // a session saved and loaded keeps B's own name
  const json = await page.evaluate(() => JSON.stringify(serializeSession(true)));
  await page.evaluate(async (j) => { applySession(JSON.parse(j), { origin: 'file' }); await new Promise(r => setTimeout(r, 600)); render(); }, json);
  await page.waitForFunction(() => images.filter(Boolean).every(im => im.img && (im.img.complete !== false)));
  expect(await tagsOf(page)).toEqual(['DAPI', 'TOM20', 'DAPI', 'mScarlet-Parkin', 'DAPI mScarlet-Parkin', 'TOM20']);
  // Ctrl/⌘+S from the untouched "A / B" Channel names box saves without renaming anything
  await page.evaluate(() => render());
  const kf = page.locator('#key-names-ui .key-name-in[data-lut="magenta"]');
  await kf.evaluate(el => el.focus());
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.keyboard.press('Control+s'); await dl;
  expect(await page.evaluate(() => _keyRename('magenta'))).toBe('mScarlet-Parkin');
  expect((await tagsOf(page))[1]).toBe('TOM20');
  // one name typed under Channel names names every magenta panel again (guide §7)
  await renameInKey(page, 'magenta', 'Membrane');
  expect(await tagsOf(page)).toEqual(['DAPI', 'Membrane', 'DAPI', 'Membrane', 'DAPI Membrane', 'Membrane']);
  expect(errors).toEqual([]);
});

test('fluor4-05: each magenta panel given its own name in turn keeps it — the last one does not rename the rest', async ({ page }) => {
  const errors = await loadApp(page);
  await seedMagenta(page);
  await page.evaluate(() => { images.splice(4, 2); images[0].lut = 'magenta'; images[2].lut = 'magenta'; renderImgList(); render(); });
  await renameInKey(page, 'magenta', 'Shared');
  await typeChannel(page, 0, 'One'); await typeChannel(page, 1, 'Two'); await typeChannel(page, 2, 'Three');
  expect(await tagsOf(page)).toEqual(['One', 'Two', 'Three', 'Shared']);
  await typeChannel(page, 3, 'Four');
  expect(await tagsOf(page)).toEqual(['One', 'Two', 'Three', 'Four']);
  expect(errors).toEqual([]);
});

// ── Gene maps ─────────────────────────────────────────────────────────────────
async function openSection(page, name) {
  const summary = page.locator('details > summary').filter({ hasText: new RegExp('^\\s*' + name) }).first();
  if (!(await summary.evaluate(s => s.parentElement.open))) await summary.click();
  await summary.scrollIntoViewIfNeeded();
}
// The guides' phage record (verify/inputs.js phageGenBank): 10.8 kb, 12 features.
function phageGB(len = 10800, locus = 'phiGuide_late') {
  const genes = [['terS', 120, 680, 1], ['terL', 700, 2300, 1], ['portal', 2320, 3900, 1], ['scaf', 3920, 4600, 1],
    ['mcp', 4620, 5800, 1], ['tail tube', 5820, 6400, 1], ['tape measure', 6420, 9100, 1], ['holin', 9200, 9500, -1],
    ['endolysin', 9510, 10050, -1], ['Rz', 10060, 10400, -1]];
  const L = [`LOCUS       ${locus}          ${len} bp    DNA     linear   PHG 14-NOV-2026`,
    'DEFINITION  Escherichia phage phiGuide, late region (synthetic).', 'FEATURES             Location/Qualifiers', `     source          1..${len}`,
    '     promoter        60..110', '                     /label="pLate"'];
  for (const [g, a, b, s] of genes) L.push(`     CDS             ${s > 0 ? `${a}..${b}` : `complement(${a}..${b})`}`, `                     /gene="${g}"`);
  L.push('     terminator      10500..10560', '                     /label="tLate"', 'ORIGIN', '//');
  return L.join('\n');
}
// Every word a gene map draws at w × h, with its box (from the font it is drawn in).
function mapWords(page, map, w, h, title) {
  return page.evaluate(({ map, w, h, title }) => {
    const m = JSON.parse(JSON.stringify(map)); if (title != null) m.style.title = title;
    const el = { type: 'genemap', map: m, w, h, label: '' };
    const out = [], mc = document.createElement('canvas').getContext('2d');
    _genemapDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, path() {}, clipStart() {}, clipEnd() {},
      text(s, x, y, f, c, al, bl) {
        mc.font = f; const fs = parseFloat(/([\d.]+)px/.exec(f)[1]); const tw = mc.measureText(_rtText(String(s))).width;
        const l = al === 'center' ? x - tw / 2 : al === 'right' ? x - tw : x;
        const t = bl === 'top' ? y : bl === 'middle' ? y - fs / 2 : y - fs * 0.78;
        out.push({ s: _rtText(String(s)), l, r: l + tw, t, b: t + fs * (bl === 'top' ? 0.95 : 1) - (bl === 'alphabetic' || !bl ? fs * 0.0 : 0) });
      } });
    return out;
  }, { map, w, h, title });
}
function clashes(W, w, h) {
  const bad = [];
  W.forEach(a => { if (a.l < -0.5 || a.r > w + 0.5 || a.t < -0.5 || a.b > h + 0.5) bad.push(`${a.s} outside ${w}×${h}`); });
  for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
    const a = W[i], b = W[j];
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5) bad.push(`${a.s} × ${b.s}`);
  }
  return bad;
}

test('ISSUES / freeform3-15 / phage4-09: a small gene map\'s title, labels, ruler and length never overlap and stay in the panel', async ({ page }) => {
  const errors = await loadApp(page);
  const map = await page.evaluate((txt) => { const p = _parseGenBank(txt); const m = _defaultGenemap(); m.length = p.length; m.features = p.features; return m; }, phageGB());
  // was: "phiGuide_late" over "scaf" and "tail tube"; "Rz" over "10.8 kb"; "rz" on the ruler
  for (const [w, h] of [[446, 160], [560, 200], [380, 150], [900, 260], [446, 220]]) {
    const W = await mapWords(page, map, w, h, 'phiGuide_late');
    expect(clashes(W, w, h), `${w}×${h}: ${W.map(x => x.s).join(',')}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('freeform4-02: a 12 kb map whose ruler ends at "12 kb" writes the length once', async ({ page }) => {
  const errors = await loadApp(page);
  const map = await page.evaluate((txt) => { const p = _parseGenBank(txt); const m = _defaultGenemap(); m.length = p.length; m.features = p.features; return m; }, phageGB(12000, 'lsr_operon_region'));
  const W = await mapWords(page, map, 446, 160, 'lsr_operon_region');
  expect(W.filter(x => x.s === '12 kb').length).toBe(1);      // was 2: the last tick and the bold length under it
  expect(clashes(W, 446, 160)).toEqual([]);
  expect(errors).toEqual([]);
});

test('blot4-06: a protein domain map — domain and site types, domains keyed by name, end labels inside the panel', async ({ page }) => {
  const errors = await loadApp(page);
  await openSection(page, 'Annotate & Draw');
  await page.getByRole('button', { name: '🧬 Linear' }).click();
  const m = page.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
  await m.locator('#gm-unit').selectOption('aa');
  await m.locator('#gm-length').fill('480');
  await m.locator('#gm-title').fill('AKT1 (human)');
  await m.locator('#gm-table').fill(['PH domain\tdomain\t5\t108\t+', 'Kinase domain\tdomain\t150\t408\t+', 'AGC-kinase C-term\tdomain\t409\t480\t+',
    'T308\tsite\t308\t308\t+', 'S473\tsite\t473\t473\t+'].join('\n'));
  await m.getByRole('button', { name: 'Apply', exact: true }).click();
  const r = await page.evaluate(() => {
    const im = images.find(p => p && p.type === 'genemap');
    return { types: im.map.features.map(f => f.type), key: _keyText(), map: im.map };
  });
  expect(r.types).toEqual(['domain', 'domain', 'domain', 'site', 'site']);   // was misc ×5
  expect(r.key).toContain('PH domain');
  expect(r.key).toContain('Kinase domain');
  expect(r.key).toContain('AGC-kinase C-term');
  expect(r.key).not.toContain('Other feature');
  // "AGC-kinase C-te" was cut at the panel edge, and the title drawn over T308
  for (const [w, h] of [[300, 120], [446, 160], [600, 200]]) {
    const W = await mapWords(page, r.map, w, h);
    expect(W.some(x => x.s === 'AGC-kinase C-term'), `${w}`).toBe(true);
    expect(clashes(W, w, h), `${w}×${h}: ${W.map(x => x.s).join(',')}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('phage4-05 / freeform4-01: a new GenBank region keeps the typed title, and PANEL_HISTORY names the file it was read from', async ({ page }) => {
  const errors = await loadApp(page);
  await openSection(page, 'Annotate & Draw');
  await page.getByRole('button', { name: '🧬 Linear' }).click();
  const m = page.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
  const file = (name, txt) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(txt) });
  await m.locator('input[type=file]').setInputFiles(file('lsr_operon_region.gb', phageGB(12000, 'lsr_operon_region')));
  await expect(m.locator('#gm-title')).toHaveValue('lsr_operon_region');     // a file's own name for a new map
  await m.locator('#gm-title').fill('*Escherichia* phage Lr3 morphogenesis and lysis genes');
  await m.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'genemap')));
  await m.waitFor({ state: 'visible' });
  await m.locator('input[type=file]').setInputFiles(file('Lr3_lysis_cassette.gb', phageGB(10800, 'PX904412_lys')));
  await expect(m.locator('#gm-stat')).toContainText('10.8 kb');
  // was: the title became "PX904412_lys" and the toast said nothing about it
  await expect(m.locator('#gm-title')).toHaveValue('*Escherichia* phage Lr3 morphogenesis and lysis genes');
  await expect(page.locator('#toast')).toContainText('kept');
  await m.getByRole('button', { name: 'Apply', exact: true }).click();
  const h = await page.evaluate(() => ({ t: _panelHistoryText(), title: images.find(p => p && p.type === 'genemap').map.style.title }));
  expect(h.title).toBe('*Escherichia* phage Lr3 morphogenesis and lysis genes');
  // was: "geneMap: file=(drawn by hand)" under the LOCUS name
  expect(h.t).toContain('(source: Lr3_lysis_cassette.gb)');
  expect(h.t).toMatch(/geneMap: file=Lr3_lysis_cassette\.gb, read=read from GenBank \(12 features/);
  expect(h.t).not.toContain('drawn by hand');
  expect(errors).toEqual([]);
});

// ── Calibration ─────────────────────────────────────────────────────────────
// A 16-bit TEM: grey field, a dark info strip, a white 250 × 12 px bar burned into it.
function temTiff() {
  const w = 800, h = 640, a = new Uint16Array(w * h).fill(22000);
  for (let y = 580; y < 640; y++) for (let x = 0; x < w; x++) a[y * w + x] = 1500;
  for (let y = 600; y < 612; y++) for (let x = 500; x < 750; x++) a[y * w + x] = 64000;
  return tiff16([a], { w, h, desc: IJ() });
}
test('phage4-07: clicks a little inside a 16-bit TEM\'s scale bar snap to its ends, and the dialog does not move under the pointer', async ({ page }) => {
  const errors = await loadApp(page);
  await drop(page, [[temTiff(), 'Lr3_UA_0117.tif']]);
  await page.evaluate(() => openCalib(0));
  const rect = () => page.evaluate(() => { const c = document.getElementById('calib-canvas'), r = c.getBoundingClientRect(); return { x: r.x, y: r.y, k: r.width / c.width * calibState.scale }; });
  const pair = async (x1, x2, y = 605.5) => {
    const r = await rect();
    await page.mouse.click(r.x + x1 * r.k, r.y + y * r.k);
    const r1 = await rect();
    await page.mouse.click(r1.x + x2 * r1.k, r1.y + y * r1.k);
    const r2 = await rect();
    return { moved: Math.abs(r2.y - r.y), s: await page.locator('#calib-status').textContent(), px: await page.locator('#calib-px').inputValue() };
  };
  // Fit: 20 px inside each end (the tester's "near each end" was 13–20 px in)
  let a = await pair(520, 730);
  expect(a.px).toBe('250');                  // was 210 — "placed where you clicked"
  expect(a.s).toContain('snapped to the ends of the bar');
  expect(a.s).toMatch(/your clicks were 2(09|10|11)\.\d px apart/);
  expect(a.moved).toBeLessThan(1);           // was 16.5 px: the status grew a line and the dialog re-centred
  a = await pair(510, 740);
  expect(a.px).toBe('250'); expect(a.moved).toBeLessThan(1);
  // two clicks on a short stretch of the bar measure what was clicked
  a = await pair(560, 660);
  expect(+a.px).toBeLessThan(110); expect(a.s).not.toContain('snapped');
  // 1:1, clicks 20 px in
  await page.evaluate(() => { _calibZoom(1); const w = document.getElementById('calib-wrap'); w.scrollLeft = 400; w.scrollTop = 400; });
  a = await pair(520, 730);
  expect(a.px).toBe('250');
  expect(errors).toEqual([]);
});

// ── Records ─────────────────────────────────────────────────────────────────
test('newcomer4-07: Methods writes a copied calibration without nested brackets; Crop to fill leaves a chart alone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => {
    const ch = _defaultChart('bar');
    ch.data = { columns: ['strain', 'cfu'], rows: [['WT', 9], ['KO', 3]], source: 'file', sourceName: 'cfu.csv' };
    ch.mapping.xCol = 0; ch.mapping.yCols = [1];
    _addDataPanel('chart', ch, 300, 220, 'bar chart'); render();
    const C = images[2]; C.umPerPx = 0.05; C._calibHow = { um: 0.05, kind: 'burned', how: 'measured on the scale bar burned into the image (100 px = 5 µm)' };
    images[1]._calibSel = true; selectedPanel = 2;
    images[1].umPerPx = 0.05; images[1]._calibCopy = { from: 'C', fromId: C.id, fromFile: '', how: C._calibHow.how, um: 0.05 };
    render();
  });
  const meth = await page.evaluate(() => generateMethodsParagraph());
  expect(meth).toContain('copied from panel C — measured on the scale bar burned into the image (100 px = 5 µm)');
  expect(meth).not.toMatch(/\(measured on the scale bar burned into the image \(100 px = 5 µm\)\)/);
  // Crop to fill cells: the chart is drawn from its data at its cell's shape, nothing to crop
  await page.evaluate(() => { sv('panel-h', 180); onLayoutChange(); fillCellsAll(); });
  const c = await page.evaluate(() => { const im = images.find(p => p && p.type === 'chart'); return [im.cropL, im.cropR, im.cropT, im.cropB]; });
  expect(c).toEqual([0, 0, 0, 0]);
  expect(errors).toEqual([]);
});

test('ISSUES: ⊞ Fit grid to panels counts the cells a spanning panel covers as filled', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  await page.evaluate(() => { images[4].colSpan = 2; images[5].colSpan = 2; sv('cols', 3); sv('rows', 3); onLayoutChange(); render(); fitGridToPanels(); });
  const t = await page.locator('#toast').textContent();
  const g = await page.evaluate(() => [gi('cols'), gi('rows')]);
  const empty = g[0] * g[1] - 8;
  if (empty) expect(t).toContain(`(${empty} empty)`); else expect(t).not.toContain('empty');
  expect(errors).toEqual([]);
});

// ── Dialogs and toasts ─────────────────────────────────────────────────────
test('blot4-12: the "no cell" warning goes as soon as Rows holds every panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.locator('#cols').fill('1'); await page.locator('#cols').dispatchEvent('input');
  await page.locator('#rows').fill('2'); await page.locator('#rows').dispatchEvent('input');
  await page.evaluate(() => render());
  await expect(page.locator('#toast')).toContainText('no cell in the 1 × 2 grid');
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await page.locator('#rows').fill('3'); await page.locator('#rows').dispatchEvent('input');
  // at once, not when its timer runs out (it stayed up for seconds after Rows fixed it)
  expect(await page.evaluate(() => { render(); return document.getElementById('toast').className; })).not.toMatch(/show/);
  expect(errors).toEqual([]);
});

test('blot4-13: typing a crop size and 📐 Level do not move the batch-crop picture under the pointer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => startBatchCrop());
  const y = () => page.evaluate(() => document.getElementById('crop-ed-canvas').getBoundingClientRect().y);
  const y0 = await y();
  await page.locator('#crop-px-x').fill('10'); await page.locator('#crop-px-x').dispatchEvent('change');
  await page.locator('#crop-px-w').fill('60'); await page.locator('#crop-px-w').dispatchEvent('change');
  const y1 = await y();
  await page.locator('#crop-level-btn').click();
  const y2 = await y();
  await page.locator('#crop-level-btn').click();
  const y3 = await y();
  expect([y1 - y0, y2 - y0, y3 - y0].map(d => Math.abs(d) < 1)).toEqual([true, true, true]);   // was ±17 px
  expect(errors).toEqual([]);
});

test('blot4-15: a right-click on a panel brings the open settings over to that panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.locator('#img-list .img-item').nth(2).locator('[data-gear]').click();
  await expect(page.locator('#settings-2')).toHaveClass(/open/);
  const c = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 0), cv = document.getElementById('ann-canvas'), r = cv.getBoundingClientRect();
    const lw = canvasLogicalW || cv.width, lh = canvasLogicalH || cv.height; return [r.left + (b.x + b.w / 2) * r.width / lw, r.top + (b.y + b.h / 2) * r.height / lh]; });
  await page.mouse.click(c[0], c[1], { button: 'right' });
  await expect(page.locator('#panel-ctx-menu')).toBeVisible();
  await expect(page.locator('#settings-0')).toHaveClass(/open/);      // was: C's stayed open, A's closed
  await expect(page.locator('#settings-2')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => selectedPanel)).toBe(0);
  expect(errors).toEqual([]);
});

test('charts4-09: Ctrl/⌘+S in the alt text box saves the session', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.locator('details > summary').filter({ hasText: /^\s*Export/ }).first().click().catch(() => {});
  await page.locator('#alt-text').evaluate(el => { el.scrollIntoView(); el.focus(); });
  await page.keyboard.type('Two grey squares.');
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.keyboard.press('Control+s');                               // was: nothing, no file and no word
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.(json|figlab)$/);
  expect(errors).toEqual([]);
});

test('blot4-11: a typed chart whose densitometry changed says so on the figure in words that fit a one-column chart', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const ch = _defaultChart('bar');
    ch.data = { columns: ['lane', 'ratio'], rows: [['WT', 1], ['R42P', 0.4]], source: 'paste' };
    ch.mapping.xCol = 0; ch.mapping.yCols = [1];
    const im = _addDataPanel('chart', ch, 170, 160, 'chart'); render();
    const was = _chartSourceState; _chartSourceState = () => ({ state: 'unlinkedChanged', from: 'panel A' });
    const T = [], mc = document.createElement('canvas').getContext('2d');
    try {
      const el = Object.assign({}, im, { w: 170, h: 160 }); el._chartKey = '';
      _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, path() {}, clipStart() {}, clipEnd() {}, chip() {}, gradient() {},
        text(s, x, y, f, c, al) { mc.font = f; const w = mc.measureText(_rtText(String(s))).width; const l = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x; T.push({ s: String(s), l, r: l + w }); } });
    } finally { _chartSourceState = was; }
    return T.filter(t => /typed values/.test(t.s));
  });
  expect(r.length).toBe(1);
  expect(r[0].s).toBe('⚠ typed values — out of date');
  expect(r[0].l).toBeGreaterThanOrEqual(0);
  expect(r[0].r).toBeLessThanOrEqual(170);                              // was cut: "⚠ typed values — the densitometry of"
  expect(errors).toEqual([]);
});

// ── Other polish ─────────────────────────────────────────────────────────────
test('fluor4-09: a file named …_mScarlet.tif is the mScarlet channel (magenta), not "RFP"', async ({ page }) => {
  const errors = await loadApp(page);
  const f = (v) => field(32, 32, 200, v, 20000);
  await drop(page, [
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ() }), 'C1-U2OS_DMSO_f01_DAPI.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ() }), 'C2-U2OS_DMSO_f01_mScarlet.tif'],
    [tiff16([f(3000)], { w: 32, h: 32, desc: IJ() }), 'C3-U2OS_DMSO_f01_TRITC.tif'],
  ]);
  await page.locator('button', { hasText: 'Auto-channels' }).first().click();
  const r = await page.evaluate(() => images.map(im => [im.lut, _channelName(im)]));
  expect(r).toEqual([['blue', 'DAPI'], ['magenta', 'mScarlet'], ['magenta', 'TRITC']]);
  await expect(page.locator('#img-list .img-item').nth(1).locator('button.f-chan-chip')).toHaveText('mScarlet');
  expect(errors).toEqual([]);
});

test('fluor4-10: Split on a merge that is already split asks first, and a split closes the merge\'s ⚙', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => {
    images[0].name = 'cells_DAPI.tif'; images[0].lut = 'blue';
    images[0].channels.push({ name: 'cells_GFP.tif', img: images[1].img, src: images[1].src, lut: 'green', blackPt: 0, whitePt: 255 });
    images.splice(1, 1); renderImgList(); render();
  });
  await page.locator('#img-list .img-item').nth(0).locator('[data-gear]').click();
  await page.locator('#settings-0 [data-splitch]').click();
  const n1 = await page.evaluate(() => images.filter(Boolean).length);
  expect(n1).toBe(3);
  await expect(page.locator('#img-list .img-settings.open')).toHaveCount(0);    // was: the merge's ⚙ stayed open
  const mi = await page.evaluate(() => images.findIndex(p => p && p.channels && p.channels.length));
  await page.evaluate((mi) => splitChannelRow(mi), mi);
  expect(await page.evaluate(() => images.filter(Boolean).length)).toBe(3);    // was 5: a second set of the same field
  await expect(page.locator('#toast')).toContainText('already split');
  await page.locator('#toast button', { hasText: 'Split again' }).click();
  expect(await page.evaluate(() => images.filter(Boolean).length)).toBe(5);
  expect(errors).toEqual([]);
});

test('newcomer4-09: four files dropped on an empty figure get a 2 × 2 grid, not 3 × 2 with two empty cells', async ({ page }) => {
  const errors = await loadApp(page);
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; c.getContext('2d').fillRect(5, 5, 10, 10); return c.toDataURL('image/png').split(',')[1]; });
  await page.evaluate(async (b64) => {
    const mk = n => { const b = atob(b64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], n, { type: 'image/png' }); };
    await addFiles(['plate.png', 'dic1.png', 'dic2.png', 'dic3.png'].map(mk));
  }, png);
  await page.waitForFunction(() => images.filter(Boolean).length === 4);
  expect(await page.evaluate(() => [gi('cols'), gi('rows')])).toEqual([2, 2]);
  // undo takes the drop and its grid back together
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => [images.filter(Boolean).length, gi('cols'), gi('rows')])).toEqual([0, 3, 2]);
  expect(errors).toEqual([]);
});

test('newcomer4-10: replacing an edited caption names the Caption note as the place a kept sentence goes', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { generateCaption(); sv('caption-out', gv('caption-out') + ' Crystal violet staining, n = 4 wells.'); });
  await page.evaluate(() => generateCaption({ ask: true }));
  await expect(page.locator('#confirm-modal-bg')).toContainText('Caption note');
  await expect(page.locator('#caption-stale')).toContainText('Caption note');
  expect(errors).toEqual([]);
});

test('newcomer2-18: the mouse tip does not cover the figure on a phone-width window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await loadApp(page);
  await page.evaluate(() => { try { localStorage.removeItem('fl-hints-seen'); } catch (e) {} });
  await seedPanels(page, 2);
  await page.evaluate(() => maybeShowHint());
  await expect(page.locator('#canvas-hint')).toBeHidden();             // was shown over the figure
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => maybeShowHint());
  await expect(page.locator('#canvas-hint')).toBeVisible();             // still shown on a desktop window
  expect(errors).toEqual([]);
});

// A JPEG with an EXIF orientation tag (8: rotated 90° counter-clockwise), 60 × 40 stored.
async function exifJpeg(page) {
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, 60, 40); x.fillStyle = '#000'; x.fillRect(5, 5, 20, 10); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  const jpg = Buffer.from(b64, 'base64');
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
}
test('newcomer4-07: PANEL_HISTORY says a phone photo is displayed upright at its shown size, and a calibration made before a replace is marked as kept', async ({ page }) => {
  const errors = await loadApp(page);
  await page.locator('#file-input').setInputFiles({ name: 'IMG_4410.jpg', mimeType: 'image/jpeg', buffer: await exifJpeg(page) });
  await page.waitForFunction(() => images.filter(Boolean).length === 1 && images[0].img && images[0].img.naturalWidth > 0, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  let t = await page.evaluate(() => _panelHistoryText());
  // was: "the stored pixels are 40×60 after that" — the file stores 60×40; 40×60 is what is shown
  expect(t).toContain('as 40×60 px (the file stores 60×40)');
  await page.evaluate(() => {
    const im = images[0]; im.umPerPx = 0.5; im._calibHow = { at: '2026-11-17T09:00:00.000Z', um: 0.5, kind: 'measured', how: 'measured on the image (100 px = 50 µm)' };
    im._replaced = [{ from: 'IMG_4410.jpg', to: 'IMG_4411.jpg', at: '2026-11-17T10:00:00.000Z', toPixels: '40×60px' }];
  });
  t = await page.evaluate(() => _panelHistoryText());
  expect(t).toMatch(/calibrate: .*when=before the image was replaced \(2026-11-17 09:00\), kept since/);
  expect(errors).toEqual([]);
});

test('freeform4-01: metadata.csv names the GenBank file a gene map was read from', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async (txt) => { await addFiles([new File([txt], 'lsr_operon_region.gb', { type: 'text/plain' })]); }, phageGB(12000, 'lsr_operon_region'));
  await page.waitForFunction(() => images.some(p => p && p.type === 'genemap'));
  await page.evaluate(() => { if (typeof closeGenemapModal === 'function') closeGenemapModal(); render(); });
  const csv = await page.evaluate(async () => { let out = ''; const b = window.Blob; window.Blob = function (parts, o) { out += parts.join(''); return new b(parts, o); }; try { exportCSV(); } finally { window.Blob = b; } return out; });
  expect(csv.split('\n')[1]).toContain('lsr_operon_region.gb');       // was the LOCUS name, "lsr_operon_region"
  expect(errors).toEqual([]);
});
