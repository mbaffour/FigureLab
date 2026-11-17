// @ts-check
// Usability round 4 — a picture surviving a revision: ⇄ Replace image, a re-analysis, ✕ New
// and a reopened session. Counts, rulers, densitometry, MW labels, insets, provenance
// records and 16-bit samples made on the old picture must never be passed off as made on
// the new one. Each test drives the path a tester took (finding IDs in the titles).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

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
