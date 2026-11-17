// @ts-check
// Usability round 4 — a picture surviving a revision: ⇄ Replace image, a re-analysis, ✕ New
// and a reopened session. Counts, rulers, densitometry, MW labels, insets, provenance
// records and 16-bit samples made on the old picture must never be passed off as made on
// the new one. Each test drives the path a tester took (finding IDs in the titles).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

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
function field(w, h, bg, block, hot, at) { const a = new Uint16Array(w * h).fill(bg); const o = at || 8;
  for (let y = o; y < o + 16; y++) for (let x = o; x < o + 16; x++) a[y * w + x] = block; a[(h - 2) * w + (w - 2)] = hot; return a; }
async function dropTiffs(page, files) {
  const n0 = await page.evaluate(() => images.filter(Boolean).length);
  await page.evaluate(async (fs) => { await addFiles(fs.map(([b64, name]) => { const b = atob(b64), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], name, { type: 'image/tiff' }); })); }, files);
  await page.waitForFunction((n) => images.filter(Boolean).length === n && images.filter(Boolean).every(im => !im.img || (im.img.complete && im.img.naturalWidth > 0)), n0 + files.length);
}
const tifFile = (b64, name) => ({ name, mimeType: 'image/tiff', buffer: Buffer.from(b64, 'base64') });

// A plate photo: a light lawn with `n` dark plaques of radius r, as a PNG made in the page.
async function platePng(page, n, r, seed) {
  const b64 = await page.evaluate(([n, r, seed]) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(205,200,190)'; x.fillRect(0, 0, 320, 240);
    x.fillStyle = 'rgb(60,55,50)';
    let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const pts = [];
    while (pts.length < n) { const px = 30 + rnd() * 260, py = 30 + rnd() * 180;
      if (pts.every(([a, b]) => Math.hypot(a - px, b - py) > 4 * r)) pts.push([px, py]); }
    pts.forEach(([px, py]) => { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); });
    return c.toDataURL('image/png').split(',')[1];
  }, [n, r, seed]);
  return b64;
}
async function addPng(page, b64, name) {
  const n0 = await page.evaluate(() => images.filter(Boolean).length);
  await page.evaluate(async ([b64, name]) => { const b = atob(b64), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    await addFiles([new File([u], name, { type: 'image/png' })]); }, [b64, name]);
  await page.waitForFunction((n) => images.filter(Boolean).length === n && images.filter(Boolean).every(im => !im.img || (im.img.complete && im.img.naturalWidth > 0)), n0 + 1);
  await page.evaluate(() => render());
}
async function replaceWith(page, idx, b64, name, mime) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate((i) => openReplaceImage(i), idx)]);
  await fc.setFiles({ name, mimeType: mime || 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(([i, n]) => images[i] && images[i].name === n && images[i].img && images[i].img.complete, [idx, name]);
  await page.evaluate(() => render());
}
// The text of the toast on screen now (one #toast element shows the latest only).
async function shownToast(page) { return page.evaluate(() => (document.getElementById('toast') || {}).textContent || ''); }
// Count dark objects over the whole picture of panel idx, as the Count tool does on a drag.
async function countPanel(page, idx) {
  await page.evaluate((i) => { setTool('measure-count');
    const s = document.getElementById('count-polarity'); if (s) s.value = 'dark';
    document.getElementById('count-threshold').value = '128';
    const pb = panelBounds.find(b => b.idx === i), map = _panelSourceMap(pb, images[i]);
    countCellsROI(document.getElementById('fig-canvas').getContext('2d'), map.dx + 2, map.dy + 2, map.dw - 4, map.dh - 4); }, idx);
}
async function csvOf(page, fn) {
  return page.evaluate(async (src) => { const cap = await _captureDownload(() => (0, eval)(src)());
    return cap ? new TextDecoder().decode(cap.data) : ''; }, fn);
}

test('phage4-02: ⇄ Replace image marks the count made on the old plate out of date — named in the toast, never exported as current, its marks not drawn on the new photo', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await platePng(page, 12, 5, 7), 'IMG_7702_plate.png');
  await countPanel(page, 0);
  const m0 = await page.evaluate(() => measurements.map(m => [m.type, m.count, m.file]));
  expect(m0).toEqual([['cellCount', 12, 'IMG_7702_plate.png']]);
  expect(await page.evaluate(() => !!_countOverlay)).toBe(true);
  await replaceWith(page, 0, await platePng(page, 20, 5, 99), 'IMG_7731_plate_repeat.png');
  const t = await shownToast(page);
  expect(t).toMatch(/Count 1 \(12 objects\)/);                     // was: "crop, label and settings kept"
  expect(t).toMatch(/out of date/);
  expect(t).not.toMatch(/settings kept/);
  // the Measure list says so
  const row = await page.locator('#meas-list .meas-row').first().textContent();
  expect(row).toMatch(/out of date/);
  expect(row).toMatch(/IMG_7702_plate\.png/);
  // the old marks are not drawn over the new photo
  expect(await page.evaluate(() => _countOverlay)).toBeNull();
  // the CSV leaves it out of the rows and says why; a new count is current and names its file
  await countPanel(page, 0);
  const csv = await csvOf(page, '() => exportMeasurements()');
  const lines = csv.split('\n').filter(l => !l.startsWith('#'));
  expect(lines.length).toBe(2);                                     // header + the new count
  expect(lines[1]).toMatch(/IMG_7731_plate_repeat\.png/);
  expect(lines[1]).toMatch(/"20","128"/);
  expect(csv).toMatch(/# Left out.*Count 1.*12 objects.*IMG_7702_plate\.png/);
  // the reproducibility log says the count was made on a picture that was replaced
  const log = await page.evaluate(() => reproLog.map(e => JSON.stringify(e)).join('\n'));
  expect(log).toMatch(/measurementsOutOfDate/);
  // undo brings the count back as current
  await page.evaluate(() => { undo(); undo(); });
  expect(await page.evaluate(() => measurements.map(m => [m.count, !!m.stale]))).toEqual([[12, false]]);
  expect(errors).toEqual([]);
});

test('phage4-02: a ruler drawn on the old picture gives no length after ⇄ Replace image, until it is dragged onto the new one; compliance names it and the count', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await platePng(page, 6, 5, 3), 'IMG_7702_plate.png');
  await page.evaluate(() => { images[0].umPerPx = 50; render();
    const pb = panelBounds[0], map = _panelSourceMap(pb, images[0]), W = canvasLogicalW, H = canvasLogicalH;
    pushUndo(); annotations.push({ type: 'ruler', xf: (map.dx + 20) / W, yf: (map.dy + 20) / H, x2f: (map.dx + 120) / W, y2f: (map.dy + 20) / H, color: '#ffffff', width: 2 });
    _rulerBind(annotations[annotations.length - 1]); render(); });
  await countPanel(page, 0);
  expect(await page.evaluate(() => _rulerRows()[0].m.status)).toBe('ok');
  await replaceWith(page, 0, await platePng(page, 9, 5, 4), 'IMG_7731_plate_repeat.png');
  expect(await shownToast(page)).toMatch(/1 ruler drawn on the old picture gives no length/);
  const r = await page.evaluate(() => { const m = _rulerRows()[0].m; return [m.status, m.label]; });
  expect(r).toEqual(['stale', '']);                                  // was: a length read off the new photo at the old spot
  const rulers = await csvOf(page, '() => exportRulerCSV()');
  expect(rulers).toMatch(/drawn on the old picture/);
  const row = await page.evaluate(() => { checkCompliance(); return [...document.querySelectorAll('.compliance-row')].map(e => e.textContent.replace(/\s+/g, ' ')).find(t => /^\W*Measurements/.test(t.trim())) || ''; });
  expect(row).toMatch(/Count 1 \(6 objects\) on panel A was made on IMG_7702_plate\.png/);
  expect(row).toMatch(/1 ruler was drawn on a picture since replaced/);
  // dragged again: bound to the new picture, measured
  await page.evaluate(() => { _rulerBind(annotations[0]); render(); });
  expect(await page.evaluate(() => _rulerRows()[0].m.status)).toBe('ok');
  expect(errors).toEqual([]);
});

test('phage4-06: ✕ New puts the Count tool down and clears its result; the Count button toggles off', async ({ page }) => {
  const errors = await loadApp(page);
  await addPng(page, await platePng(page, 5, 5, 11), 'plate.png');
  await page.locator('#measure-acc > summary').click();
  await page.locator('#measure-acc [data-tool="measure-count"]').click();
  expect(await page.evaluate(() => activeTool)).toBe('measure-count');
  await page.locator('#measure-acc [data-tool="measure-count"]').click();      // was: stayed active
  expect(await page.evaluate(() => activeTool)).toBe('none');
  await countPanel(page, 0);
  expect(await page.locator('#roi-results').textContent()).toMatch(/Objects detected/);
  await page.evaluate(() => { _resetFigureState(); });
  const r = await page.evaluate(() => ({ tool: activeTool, ov: _countOverlay, res: document.getElementById('roi-results').textContent,
    active: [...document.querySelectorAll('.ann-tool.active')].map(b => b.dataset.tool).filter(t => t !== 'none') }));
  expect(r).toEqual({ tool: 'none', ov: null, res: '', active: [] });
  expect(errors).toEqual([]);
});

// A 6-lane blot strip (dark bands on a light membrane), as a PNG data URL. `smear` adds
// signal between lanes 5 and 6, so auto-detection on that scan merges them into one lane.
const BLOT = () => {
  window.__strip = (amps, y, smear) => { const W = 520, H = 120, v = new Uint8ClampedArray(W * H * 4);
    let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0;
      amps.forEach((a, k) => { const x0 = 20 + 80 * k; if (i >= x0 && i < x0 + 44) s += a * Math.exp(-((j + 0.5 - y) ** 2) / 18); });
      if (smear && i >= 364 && i < 420) s += smear * Math.exp(-((j + 0.5 - y) ** 2) / 18);
      const g = Math.max(0, Math.min(255, Math.round(228 - s + (rnd() - 0.5) * 4))), o = (j * W + i) * 4; v[o] = v[o + 1] = v[o + 2] = g; v[o + 3] = 255; }
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(v, W, H), 0, 0);
    return c.toDataURL('image/png'); };
  window.__addStrip = (src, name) => new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name); render(); res(images.length - 1); }; img.src = src; });
  window.__fileOf = async (src, name) => new File([await (await fetch(src)).blob()], name, { type: 'image/png' });
};

test('blot4-01: a re-analysis after ⇄ Replace keeps the lane count and the loading control; ↻ Update never says "updated" over a series it emptied', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(BLOT);
  await page.evaluate(async () => {
    await __addStrip(__strip([40, 60, 80, 100, 120, 140], 60), 'pAKT.png');
    await __addStrip(__strip([60, 60, 60, 60, 60, 60], 60), 'AKT.png');
    runGelAnalysis(0); gelSetRefLane(0, 0); gelSetLoading(0, 1); chartFromDensitometry(0); render();
  });
  expect(await page.evaluate(() => [images[0].gelAnalysis.lanes.length, !!images[0].gelAnalysis.loading])).toEqual([6, true]);
  // the repeat scan: lanes 5 and 6 run into each other, so auto-detection finds 5
  await page.evaluate(async () => { await replacePanelImage(images[0].id, await __fileOf(__strip([40, 60, 80, 100, 120, 140], 60, 120), 'pAKT_repeat.png')); render(); });
  expect(await page.evaluate(() => _gelAnalyse(images[0], {}).lanes.length)).toBe(5);
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p.type === 'chart')));
  await page.click('#chart-link-note button:has-text("Update from densitometry")');
  const t = await shownToast(page);
  const r = await page.evaluate(() => { const a = images[0].gelAnalysis; return { lanes: a.lanes.length, lc: !!a.loading, mode: a.laneMode,
    vals: _chartDraft.data.rows.map(r => r[1]) }; });
  expect(r.lanes).toBe(6);                                           // was 5: lanes 5 and 6 merged
  expect(r.lc).toBe(true);                                           // was: loading control reset to none
  // was: every bar n.d. (lane 5 runs into the smear on this synthetic scan, so it alone may be n.d.)
  expect(r.vals.filter(v => typeof v === 'number' && v > 0).length).toBeGreaterThanOrEqual(5);
  expect(r.vals[5]).toBeGreaterThan(3);
  expect(t).toMatch(/6 lanes kept as before/);
  expect(t).toMatch(/found 5/);
  expect(errors).toEqual([]);
});

test('blot4-01: when the loading control cannot be kept, the chart update says the series is now n.d. and why — not "1 chart updated"', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(BLOT);
  await page.evaluate(async () => {
    await __addStrip(__strip([40, 60, 80, 100, 120, 140], 60), 'pAKT.png');
    await __addStrip(__strip([60, 60, 60, 60, 60, 60], 60), 'AKT.png');
    runGelAnalysis(0); gelSetRefLane(0, 0); gelSetLoading(0, 1); chartFromDensitometry(0); render();
    // the user types another lane count in the dialog and re-detects: 5 lanes, the control has 6
    runGelAnalysis(0, { laneCount: 5 });
  });
  const t = await shownToast(page);
  expect(t).not.toMatch(/^1 chart updated/);
  expect(t).toMatch(/Loading control dropped/);
  expect(t).toMatch(/n\.d\./);
  expect(await page.evaluate(() => images[0].gelAnalysis.loading)).toBeNull();
  expect(errors).toEqual([]);
});

// A strip with a 4-band ladder in lane 1 (100, 70, 55, 40 kDa at `ys`) and one band in lanes 2–4.
const LADDER = () => {
  window.__ladderStrip = (ys, shift) => { const W = 360, H = 160, v = new Uint8ClampedArray(W * H * 4);
    const lanes = [ys.map(y => [y + shift, 90]), [[70 + shift, 80]], [[70 + shift, 100]], [[70 + shift, 120]]];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0;
      lanes.forEach((bs, k) => { const x0 = 20 + 85 * k; if (i >= x0 && i < x0 + 44) bs.forEach(([y, a]) => { s += a * Math.exp(-((j + 0.5 - y) ** 2) / 8); }); });
      const g = Math.max(0, Math.min(255, Math.round(228 - s))), o = (j * W + i) * 4; v[o] = v[o + 1] = v[o + 2] = g; v[o + 3] = 255; }
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(v, W, H), 0, 0);
    return c.toDataURL('image/png'); };
};
async function mwRow(page) {
  return page.evaluate(() => { checkCompliance(); const rows = [...document.querySelectorAll('.compliance-row')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
    return rows.filter(t => /MW markers|Densitometry/.test(t)).join(' | '); });
}

test('blot4-04: MW labels follow the new ladder after ⇄ Replace and a re-analysis; until then, and when they cannot, compliance says they are off', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(BLOT); await page.evaluate(LADDER);
  await page.evaluate(async () => {
    await __addStrip(__ladderStrip([30, 55, 80, 110], 0), 'pAKT.png');
    runGelAnalysis(0); gelSetLadder(0, 0, '100, 70, 55, 40'); gelPlaceMWLabels(0); render();
    document.getElementById('target-journal').value = 'jbc'; document.getElementById('target-journal').dispatchEvent(new Event('change'));
  });
  const ys0 = await page.evaluate(() => annotations.filter(a => a.mw).map(a => a.yf));
  expect(ys0.length).toBe(4);
  expect(await mwRow(page)).toMatch(/4 markers, above and below every analysed band ✓/);
  // the repeat scan runs 9 px lower
  await page.evaluate(async () => { await replacePanelImage(images[0].id, await __fileOf(__ladderStrip([30, 55, 80, 110], 9), 'pAKT_repeat.png')); render(); });
  expect(await shownToast(page)).toMatch(/MW labels sit where the old scan’s ladder bands were/);
  expect(await mwRow(page)).toMatch(/MW labels were placed on the ladder of the analysis before the image was replaced/);   // was ✓
  // the re-analysis moves them onto the new bands
  await page.evaluate(() => { openGelAnalysis(0); closeGelAnalysis(); });
  const r = await page.evaluate(() => { const M = _gelFigMapNow(0), T = _gelMWTargets(images[0].gelAnalysis, M);
    return annotations.filter(a => a.mw).map(a => { const t = T.find(q => q.kda === +a.text); return Math.round(_mwCy(a, M.H) - t.y); }); });
  expect(r).toEqual([0, 0, 0, 0]);                                  // was: each ~9 px (scaled) off
  expect(await page.evaluate(() => annotations.filter(a => a.mw).map(a => a.yf))).not.toEqual(ys0);
  expect(await mwRow(page)).toMatch(/4 markers, above and below every analysed band ✓/);
  // a label dragged off its band is caught
  await page.evaluate(() => { const i = annotations.findIndex(a => a.mw && a.text === '55'); pushUndo(); annotations[i] = { ...annotations[i], yf: annotations[i].yf - 12 / annCanvas.height }; render(); });
  expect(await mwRow(page)).toMatch(/MW label 55 \(\d+ px above its band\)/);
  expect(errors).toEqual([]);
});

// A 16-bit merge D (DAPI + GFP) with a linked inset of it, as the fluorescence figure has.
async function mergeWithInset(page) {
  await dropTiffs(page, [[tiff16(field(64, 64, 200, 6000, 30000), 64, 64, 0.108), 'CCCP_63x_f1_DAPI.tif'],
    [tiff16(field(64, 64, 150, 9000, 40000), 64, 64, 0.108), 'CCCP_63x_f1_GFP.tif']]);
  await page.evaluate(() => { renderImgList();
    document.querySelectorAll('#img-list .panel-pick').forEach(c => { c.checked = true; });
    mergeTickedPanels();
    const m = images.findIndex(im => (im.channels || []).length);
    _setLevelNative(images[m], 'black', 100); _setLevelNative(images[m], 'white', 16000);
    selectedPanel = m; addLinkedInset(0.1, 0.1, 0.4, 0.4); render(); });
  return page.evaluate(() => images.findIndex(im => (im.channels || []).length));
}

test('fluor4-03: after ⇄ Replace on a merge and ⇄ on its channel, the inset names the new field and PANEL_HISTORY / metadata say its 16-bit samples were kept', async ({ page }) => {
  const errors = await loadApp(page);
  const m = await mergeWithInset(page);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate((i) => openReplaceImage(i), m)]);
  await fc.setFiles(tifFile(tiff16(field(64, 64, 210, 7000, 31000, 20), 64, 64, 0.108), 'CCCP_63x_f3_DAPI.tif'));
  await page.waitForFunction((i) => images[i].name === 'CCCP_63x_f3_DAPI.tif', m);
  // the GFP channel's file, through the page
  await page.evaluate(([b64, i]) => { window.__gfp3 = b64; }, [tiff16(field(64, 64, 160, 9500, 41000, 20), 64, 64, 0.108), m]);
  await page.evaluate(async (i) => { await replaceChannelFile(images[i].id, 0,
    new File([Uint8Array.from(atob(window.__gfp3), c => c.charCodeAt(0))], 'CCCP_63x_f3_GFP.tif', { type: 'image/tiff' })); render(); }, m);
  const r = await page.evaluate(() => { render(); const ins = images.find(im => im.insetOf != null);
    const hist = _panelHistoryText(); const E = _rtText(formatLabel(ins.label)) || '(unlettered)';
    const blockOf = (L) => { const i = hist.indexOf(`── ${L} ──`); const j = hist.indexOf('\n── ', i + 5); return hist.slice(i, j < 0 ? undefined : j); };
    const D = _rtText(formatLabel(images.find(im => (im.channels || []).length && im.insetOf == null).label));
    return { name: ins.name, E: blockOf(E), D: blockOf(D), row: document.getElementById('img-list').textContent };
  });
  expect(r.name).toBe('CCCP_63x_f3_DAPI.tif');                        // was: f1
  expect(r.E).toMatch(/\(source: CCCP_63x_f3_DAPI\.tif\)/);
  expect(r.E).toMatch(/parentReplaced: from=CCCP_63x_f1_DAPI\.tif, to=CCCP_63x_f3_DAPI\.tif/);
  expect(r.E).not.toMatch(/not retained/);                            // was: "16-bit file scaled 0…its maximum"
  expect(r.D).toMatch(/replaceImage: .*nativeSamples=retained \(16-bit\)/);
  expect(r.D).toMatch(/replaceChannel: channel=\S+, from=CCCP_63x_f1_GFP\.tif, to=CCCP_63x_f3_GFP\.tif.*nativeSamples=retained \(16-bit\)/);
  expect(r.D).not.toMatch(/not retained/);
  expect(errors).toEqual([]);
});

test('fluor4-04: Restore my figure after a tutorial does not claim a 16-bit merge lost its samples', async ({ page }) => {
  const errors = await loadApp(page);
  await mergeWithInset(page);
  page.once('dialog', d => d.accept());
  await page.evaluate(async () => { await startTutorial('channels'); });
  await page.waitForSelector('#tour-ov');
  await page.keyboard.press('Escape');
  await page.locator('#cm-ok').click();                       // Restore my figure
  await page.waitForFunction(() => images.some(im => (im.channels || []).length && im.dispRaw));
  const t = await shownToast(page);
  expect(t).toMatch(/Your figure is back, as it was before the tutorial/);      // was: "D lost its 16-bit samples"
  expect(t).not.toMatch(/lost/);
  expect(errors).toEqual([]);
});

test('phage4-11: after Save session, a reload offers the saved file first, not "Recover unsaved session" with a degraded copy', async ({ page }) => {
  const errors = await loadApp(page);
  await dropTiffs(page, [[tiff16(field(64, 64, 200, 6000, 30000), 64, 64, 0.5), 'Lr3_UA_0117.tif']]);
  await page.evaluate(() => { sv('export-name', 'Fig5'); _captureDownload(() => saveJSON(true)); });
  await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('fl-autosave-v2')).saved; } catch (e) { return false; } });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  const bar = page.locator('div', { hasText: /saved as/ }).filter({ has: page.locator('button') }).last();
  await expect(bar).toContainText('Fig5-session.json');
  await expect(bar).toContainText('with no changes after');
  await expect(bar).not.toContainText('Recover unsaved session');
  expect(await bar.locator('.btn-primary').textContent()).toBe('Dismiss');
  // a change after the save: the ordinary recovery bar again
  await bar.locator('.btn-primary').click();
  await dropTiffs(page, [[tiff16(field(64, 64, 200, 6000, 30000), 64, 64, 0.5), 'Lr3_UA_0118.tif']]);
  await page.evaluate(() => autosaveNow());
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  await expect(page.locator('div', { hasText: /Recover unsaved session/ }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('freeform4-07: a freeform figure saved and reopened keeps its 16-bit picture in native values — same Methods, same caption display range', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform'); });
  await page.evaluate(async (b64) => { const b = atob(b64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    await addFiles([new File([u], 'lsrA-mNeonGreen_B.tif', { type: 'image/tiff' })]); }, tiff16(field(64, 64, 300, 15000, 19871), 64, 64, 0.1));
  await page.waitForFunction(() => freeformElements.some(e => e.type === 'image' && e.raw && e._imgEl && e._imgEl.complete));
  await page.evaluate(() => { const e = freeformElements.find(x => x.type === 'image'); e.label = 'B'; render(); });
  const before = await page.evaluate(() => ({ m: generateMethodsParagraph(), c: _captionText() }));
  expect(before.m).not.toMatch(/native samples were not available/);
  const saved = await page.evaluate(() => JSON.stringify(_withRawSave(() => serializeSession(true))));
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate((t) => _loadSessionText(t, 'Fig3-session.json'), saved);
  await page.waitForFunction(() => freeformElements.some(e => e.type === 'image' && e.img && e.img.complete && e.img.naturalWidth > 0));
  const after = await page.evaluate(() => { const e = freeformElements.find(x => x.type === 'image'); e._imgEl = e._imgEl || e.img; render();
    return { raw: !!_rawOf(e), m: generateMethodsParagraph(), c: _captionText() }; });
  expect(after.raw).toBe(true);                                      // was: the 8-bit PNG only
  expect(after.m).toBe(before.m);                                     // was: "native samples were not available"
  expect(after.c).toBe(before.c);
  expect(errors).toEqual([]);
});
