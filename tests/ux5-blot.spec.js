// @ts-check
// Usability round 5, blot persona: a phospho-ERK1/2 time course (pERK ÷ total ERK, GAPDH),
// its linked chart, and two revisions. Each test drives the path a tester took (finding IDs
// in the titles). The blots are made here, as the tester's generator made them: a p44/p42
// doublet 13.6 px apart (σ 4.5 px, p44 = 0.45 × p42 — partly resolved), 16 lanes (ladder +
// 0/5/15/30/60 min × 3), 16-bit, a background gradient, a smile, noise and dust. Truth:
// pERK/ERK relative to lane 2 is the phospho fraction relative to lane 2, whichever of
// ERK1, ERK2 or their sum is measured, as long as every lane is measured the same way.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// ── The blots ───────────────────────────────────────────────────
function rng(seed) { let s = seed >>> 0 || 1; const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  let spare = null; return { u, n() { if (spare != null) { const v = spare; spare = null; return v; } const a = u(), b = u(), r = Math.sqrt(-2 * Math.log(a)); spare = r * Math.sin(2 * Math.PI * b); return r * Math.cos(2 * Math.PI * b); } }; }
const W = 1700, H = 340, Y0 = 380, PITCH = 98, HALF = 30;
const ymw = mw => 90 + (Math.log10(250) - Math.log10(mw)) / (Math.log10(250) - 1) * 940;
const TOT = [1.00, 1.06, 0.95, 1.03, 0.97, 1.01, 0.98, 1.04, 0.96, 0.94, 1.05, 1.00, 0.99, 1.02, 0.97];
const LOAD = [1.00, 0.90, 1.10, 0.95, 1.12, 0.88, 1.05, 0.92, 1.08, 0.97, 1.03, 0.86, 1.15, 0.94, 1.02];
const P1 = [0.15, 0.12, 0.18, 1.00, 0.90, 1.10, 0.70, 0.62, 0.78, 0.40, 0.34, 0.45, 0.18, 0.21, 0.15];
const P2 = [0.14, 0.16, 0.13, 1.20, 1.05, 1.32, 0.80, 0.74, 0.86, 0.38, 0.42, 0.35, 0.20, 0.17, 0.22];
const TRUTH = P1.map(v => v / P1[0]), TRUTH_GAPDH = P1.map((v, i) => v * TOT[i] / (P1[0] * TOT[0]));
function make(bands, { angle = 0, seed = 1, bg = 52000, noise = 420, x0 = 100, dy = 0, smile = 4, gain = 1 } = {}) {
  const R = rng(seed), a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), cx = W / 2, cy = 550, img = new Float64Array(W * H);
  const lp = (xu, xc) => 1 / (1 + Math.exp((Math.abs(xu - xc) - HALF) / 5 * 2.2));
  for (let r = 0; r < H; r++) { const yy = r + Y0; for (let x = 0; x < W; x++) {
    const xu = cx + (x - cx) * ca + (yy - cy) * sa, yu = cy - (x - cx) * sa + (yy - cy) * ca; let s = 0;
    for (const [li, ym, amp, sy] of bands) { const xc = x0 + PITCH * li; if (Math.abs(xu - xc) > HALF + 30) continue;
      const d = (yu - (ym + dy + smile * (1 - ((xc - W / 2) / (W / 2)) ** 2))) / sy; if (Math.abs(d) > 8) continue;
      s += gain * amp * lp(xu, xc) * Math.exp(-0.5 * d * d); }
    img[r * W + x] = bg - 2400 * (x / W) - 1600 * (yy / 1100) + 1000 * Math.exp(-(((x - 1000) / 260) ** 2 + ((yy - 300) / 200) ** 2)) - s + R.n() * noise; } }
  for (let k = 0; k < 10; k++) { const sx = Math.floor(R.u() * W), sy = Math.floor(R.u() * H), rr = 1 + Math.floor(R.u() * 3), d = 3000 + R.u() * 6000;
    for (let y = Math.max(0, sy - rr); y < Math.min(H, sy + rr); y++) for (let x = Math.max(0, sx - rr); x < Math.min(W, sx + rr); x++) img[y * W + x] -= d; }
  const out = new Uint16Array(W * H); for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round(img[i]))); return out;
}
const ladder = () => [75, 50, 37].map(m => [0, ymw(m), 11000, 5.5]);
// The doublet: ERK2 (42 kDa) and ERK1 (44 kDa, 0.45×); sep moves them apart (the control).
function erkBands(amp, sep) { const b = ladder(), c = (ymw(42) + ymw(44)) / 2, h = (sep || ymw(42) - ymw(44)) / 2;
  for (let i = 0; i < 15; i++) b.push([i + 1, c + h, amp(i), 4.5], [i + 1, c - h, 0.45 * amp(i), 4.5]); return b; }
const pERK = (P, o = {}) => make(erkBands(i => 15000 * P[i] * TOT[i] * LOAD[i], o.sep), o);
const ERK = (o = {}) => make(erkBands(i => 13000 * TOT[i] * LOAD[i]), o);
const GAPDH = (o = {}) => make(ladder().concat(LOAD.map((l, i) => [i + 1, ymw(37), 15000 * l, 6])), o);
function tiff16(px) {
  const tags = [[256, 3, 1, W], [257, 3, 1, H], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, 'DATA'], [277, 3, 1, 1], [278, 3, 1, H], [279, 4, 1, W * H * 2]];
  const ifd = 8, off = ifd + 2 + tags.length * 12 + 4, buf = Buffer.alloc(off + W * H * 2);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifd, 4); buf.writeUInt16LE(tags.length, ifd);
  tags.forEach(([t, ty, c, v], k) => { const o = ifd + 2 + k * 12; buf.writeUInt16LE(t, o); buf.writeUInt16LE(ty, o + 2); buf.writeUInt32LE(c, o + 4);
    const val = v === 'DATA' ? off : v; if (ty === 3) buf.writeUInt16LE(val, o + 8); else buf.writeUInt32LE(val, o + 8); });
  Buffer.from(px.buffer, px.byteOffset, px.byteLength).copy(buf, off); return buf; }
const tif = (name, px) => ({ name, mimeType: 'image/tiff', buffer: tiff16(px) });

// ── Driving the app ─────────────────────────────────────────────
async function addBlots(page, files) {
  await page.setInputFiles('#file-input', files);
  await page.waitForFunction(n => images.filter(Boolean).length === n && images.every(im => im.img && im.img.complete), files.length, { timeout: 150000 });
  await page.evaluate(() => { window.__T = []; const t = document.getElementById('toast');
    new MutationObserver(() => { const s = t.textContent; if (s && window.__T[window.__T.length - 1] !== s) window.__T.push(s); }).observe(t, { childList: true, subtree: true, characterData: true }); });
}
const toasts = page => page.evaluate(() => window.__T.splice(0).join(' ‖ '));
// The strips cropped as the tester did (margins off), analysed: ladder 75/50/37 in lane 1,
// reference lane 2; pERK ÷ total ERK as another target.
async function analyse(page, n) {
  await page.evaluate(n => { images.slice(0, n).forEach(im => { im.cropT = 3; im.cropB = 3; im.cropL = 2.35; im.cropR = 2.35; }); render();
    for (let i = 0; i < n; i++) { runGelAnalysis(i); gelSetLadder(i, 0, '75, 50, 37'); gelSetRefLane(i, 1); }
    if (n > 1) gelSetLoading(0, 1, 'target'); }, n);
}
const chartVals = page => page.evaluate(() => images.find(p => p && p.type === 'chart').chart.data.rows.map(r => r[1]));
const chartIdx = page => page.evaluate(() => images.findIndex(p => p && p.type === 'chart'));
async function complianceRow(page, re) {
  return page.evaluate(src => { checkCompliance(); const re = new RegExp(src);
    const row = [...document.querySelectorAll('.compliance-row')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(t => re.test(t)) || '';
    const m = document.getElementById('info-modal-bg'); if (m) m.remove(); return row; }, re.source);
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const groups = v => [0, 1, 2, 3, 4].map(k => v.slice(3 * k, 3 * k + 3));
// The chart's dialog, ↻ Update from densitometry, Apply — as the tester did.
async function updateChart(page) {
  await page.evaluate(i => openDataPanelEditor(i), await chartIdx(page));
  await page.click('#chart-link-note button:has-text("Update from densitometry")');
  const t = await toasts(page);
  const note = await page.locator('#chart-link-note').innerText();
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  return { t, note };
}
async function replace(page, idx, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(i => openReplaceImage(i), idx)]);
  await fc.setFiles(file);
  await page.waitForFunction(([i, n]) => images[i] && images[i].name === n && images[i].img && images[i].img.complete, [idx, file.name]);
  await page.evaluate(() => render());
}

test('blot5-01: a partly resolved doublet is read one way in every lane — the pERK/ERK chart matches truth; untick "Count the doublet as one band" and every lane is two bands', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK-T202Y204.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 }))]);
  await analyse(page, 2);
  await toasts(page);
  await page.evaluate(() => chartFromDensitometry(0));
  expect(await toasts(page)).not.toMatch(/n\.d\./);                    // ISSUES: n.d. said only when a lane is n.d.
  const v = await chartVals(page);
  v.forEach((x, i) => expect(Math.abs(x / TRUTH[i] - 1)).toBeLessThan(0.05));
  const g = groups(v), gt = groups(TRUTH);
  expect(Math.abs(mean(g[1]) / mean(gt[1]) - 1)).toBeLessThan(0.03);   // 5 min: was 4.74 for 6.67
  expect(sd(g[2])).toBeLessThan(1.3 * sd(gt[2]));                       // 15 min: was 2.5× its SD
  expect(await page.evaluate(() => images.find(p => p.type === 'chart').chart.caption)).toMatch(/a doublet: both bands summed in every lane/);
  // Detection split the doublet in the strong lanes and read it as one band in the others;
  // the panel now counts it as one band in every lane, and the dialog says so.
  const site = await page.evaluate(() => images[0].gelAnalysis.doubletSites);
  expect(site.length).toBe(1);
  expect(site[0].split.length).toBeGreaterThanOrEqual(2);          // the mix the tester found…
  expect(site[0].one.length).toBeGreaterThanOrEqual(2);
  expect(site[0].applied).toBe('one');                              // …is gone
  await page.evaluate(() => openGelAnalysis(0));
  const ban = await page.locator('#gel-banner').innerText();
  expect(ban).toMatch(/doublet at 4\d\.\d–4\d\.\d kDa was split into two bands in lanes .* and read as one band in lanes .* — counted as one band \(both summed\) in every lane/);
  await expect(page.locator('#gel-banner .gel-doublet-one')).toBeChecked();
  expect(await page.locator('#gel-table').innerText()).toMatch(/doublet, both bands/);
  // Methods and the CSV say how the doublet was measured
  const methods = await page.evaluate(() => _gelMethodsSentences([images[0]]).join(' '));
  expect(methods).toMatch(/a partly resolved doublet, both bands were measured together as one band in every lane \(detection divided it at the valley in lanes .* only\)/);
  expect(await page.evaluate(() => gelCSV(0))).toMatch(/# Doublet: .*counted as one band/);
  // Unticked: two bands in every lane, the lanes read as one band cut at the valley the
  // others show — and the chart (now ERK2 alone) still matches truth, lane for lane, within
  // what dividing two overlapping bands at a valley allows (each side keeps the other's tail).
  await page.evaluate(() => openGelAnalysis(0));
  await page.locator('#gel-banner .gel-doublet-one').uncheck();
  const two = await page.evaluate(() => { const a = images[0].gelAnalysis, F = a.frame, s = a.doubletSites[0], y1 = F.sy + s.rf1 * F.sh, y2 = F.sy + s.rf2 * F.sh;
    return { n: a.lanes.slice(1).map(L => L.bands.filter(b => b.yc > y1 - 10 && b.yc < y2 + 10).length), applied: s.applied, mode: a.doublets }; });
  expect(two.mode).toBe('two'); expect(two.applied).toBe('two');
  expect(two.n.every(k => k === 2)).toBe(true);
  await page.evaluate(() => chartFromDensitometry(0));
  (await chartVals(page)).forEach((x, i) => expect(Math.abs(x / TRUTH[i] - 1)).toBeLessThan(0.1));
  // A lane whose band count differs at the doublet is named — dialog, chart and compliance
  await page.evaluate(() => { const a = images[0].gelAnalysis, F = a.frame, s = a.doubletSites[0], y1 = F.sy + s.rf1 * F.sh;
    const L = a.lanes[6], bi = L.bands.findIndex(b => Math.abs(b.yc - y1) < 6); gelDeleteBand(0, 6, bi); openGelAnalysis(0); });
  expect(await page.locator('#gel-banner').innerText()).toMatch(/lane 7 holds a different number of bands there/);
  expect(await complianceRow(page, /Densitometry/)).toMatch(/lane 7 holds a different number of bands at the doublet/);
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/✗.*lane 7 holds a different number of bands at the doublet .* it is charted at/);
  expect(errors).toEqual([]);
});

test('blot5-01 control: a resolved doublet (28 px apart) stays two bands in every lane, and no doublet is reported', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('control_wide-doublet.tif', pERK(P1, { seed: 507, sep: 28 }))]);
  await analyse(page, 1);
  const r = await page.evaluate(() => { const a = images[0].gelAnalysis, F = a.frame, c = F.sy + ((((90 + (Math.log10(250) - Math.log10(42)) / (Math.log10(250) - 1) * 940) + (90 + (Math.log10(250) - Math.log10(44)) / (Math.log10(250) - 1) * 940)) / 2) - 380 - F.sy) / F.sh * F.sh;
    return { sites: a.doubletSites || null, n: a.lanes.slice(1).map(L => L.bands.filter(b => Math.abs(b.yc - c) < 30).length) }; });
  expect(r.sites).toBeNull();
  expect(r.n.every(k => k === 2)).toBe(true);
  expect(errors).toEqual([]);
});

test('blot5-02: after ⇄ Replace and ↻ Update, a band widened by hand over a deleted neighbour comes back whole, and a band added by hand is made again; the toast says so', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 }))]);
  await analyse(page, 2);
  // Two bands in every lane; in lane 5 the user deletes ERK1 and widens ERK2 over it (the
  // tester's workaround), and adds a band by hand low in lane 3.
  const made = await page.evaluate(() => { gelSetDoublets(0, 'two');
    const a = () => images[0].gelAnalysis, s = a().doubletSites[0], F = a().frame, y1 = F.sy + s.rf1 * F.sh, y2 = F.sy + s.rf2 * F.sh;
    const pair = () => a().lanes[4].bands.filter(b => b.yc > y1 - 10 && b.yc < y2 + 10).sort((p, q) => p.yc - q.yc);
    const [up, lo] = pair(), top = up.y0, bot = lo.y1;
    gelDeleteBand(0, 4, a().lanes[4].bands.indexOf(up));
    gelSetBandBounds(0, 4, a().lanes[4].bands.indexOf(pair()[0]), top, bot);
    gelAddBand(0, 2, F.sy + 290);
    chartFromDensitometry(0);
    return { lane5: pair().map(b => [b.y0, b.y1, !!b.resized]), lane3: a().lanes[2].bands.filter(b => b.manual).length }; });
  expect(made.lane5.length).toBe(1); expect(made.lane5[0][2]).toBe(true); expect(made.lane3).toBe(1);
  // The re-probe: another blot of the same samples, shifted, dimmer, its doublet in other lanes split
  await replace(page, 0, tif('pERK_reprobe.tif', pERK(P2, { seed: 504, gain: 0.8, dy: 14, x0: 114 })));
  await toasts(page);
  const u = await updateChart(page);
  expect(u.t).toMatch(/2 band edits made by hand were made again \(lane 3 band added at \d+\.\d kDa, lane 5 edges at 4\d\.\d kDa\)/);
  const r = await page.evaluate(() => { const a = images[0].gelAnalysis, s = a.doubletSites[0], F = a.frame, y1 = F.sy + s.rf1 * F.sh, y2 = F.sy + s.rf2 * F.sh;
    const at = L => L.bands.filter(b => b.yc > y1 - 12 && b.yc < y2 + 12);
    // what the whole doublet in lane 5 measures on the new scan, detected as one band
    const ref = _gelAnalyse(images[0], { doublets: 'one' }), refAt = at(ref.lanes[4]);
    return { l5: at(a.lanes[4]).map(b => [b.volume, !!b.resized]), ref: refAt.map(b => b.volume), l3: a.lanes[2].bands.filter(b => b.manual).length, lost: a.editsLost || null }; });
  // was: ERK1 deleted again, the widened edge dropped — ERK2 alone, 30% low
  expect(r.l5.length).toBe(1); expect(r.l5[0][1]).toBe(true);
  expect(r.ref.length).toBe(1);
  expect(Math.abs(r.l5[0][0] / r.ref[0] - 1)).toBeLessThan(0.04);
  expect(r.l3).toBe(1);
  expect(r.lost).toBeNull();
  // Lane 5 now holds one band where the others hold two: named until the user says it is right
  const ss = () => page.evaluate(() => _chartSourceState(images.find(p => p.type === 'chart')));
  expect((await ss()).why).toMatch(/lane 5 holds a different number of bands at the doublet .* or ✓ These lanes are right/);
  await page.evaluate(() => openGelAnalysis(0));
  await page.locator('#gel-banner button:has-text("These lanes are right")').click();
  expect((await ss()).state).toBe('linked');
  expect(await page.locator('#gel-banner').innerText()).not.toMatch(/different number of bands/);
  expect(errors).toEqual([]);
});

test('blot5-02: hand edits that cannot be placed again (no ladder, a new crop) are said — toast, dialog, chart, caption and compliance — never "current", until the lanes are edited or marked checked', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 }))]);
  await page.evaluate(() => { images.forEach(im => { im.cropT = 3; im.cropB = 3; im.cropL = 2.35; im.cropR = 2.35; }); render();
    [0, 1].forEach(i => { runGelAnalysis(i); gelSetRefLane(i, 1); }); gelSetLoading(0, 1, 'target');
    const a = () => images[0].gelAnalysis, b = a().lanes[5].bands.slice().sort((p, q) => q.volume - p.volume)[0];
    gelSetBandBounds(0, 5, a().lanes[5].bands.indexOf(b), b.y0 - 4, b.y1 + 4);
    chartFromDensitometry(0); });
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/current with it ✓/);
  await toasts(page);
  await page.evaluate(() => { images[0].cropT = 5; render(); });
  const u = await updateChart(page);
  expect(u.t).toMatch(/hand edits were not carried over to the new crop \(lane 6: the band with edges set by hand at Rf 0\.\d\d\)/);
  expect(u.t).not.toMatch(/^1 chart updated/);
  const ss = await page.evaluate(() => _chartSourceState(images.find(p => p.type === 'chart')));
  expect(ss.state).toBe('check');
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/✗.*not carried over.*lane 6 is measured as detected/);
  expect(await complianceRow(page, /Densitometry/)).toMatch(/hand edits were not carried over/);
  const cap = await page.evaluate(() => _captionText());
  expect(cap).toMatch(/\[⚠ Check before submitting: .*not carried over/);
  await page.evaluate(() => openGelAnalysis(0));
  expect(await page.locator('#gel-banner').innerText()).toMatch(/Hand edits NOT carried over to the new crop: lane 6: the band with edges set by hand/);
  await page.locator('#gel-banner button:has-text("Checked")').click();
  expect(await page.evaluate(() => _chartSourceState(images.find(p => p.type === 'chart')).state)).toBe('linked');
  // ⇄ Replace with a shifted scan on the same crop, still no ladder: the same rows are not
  // the same band, so the edge set by hand is not placed there blind
  await page.evaluate(() => { const a = images[0].gelAnalysis, b = a.lanes[5].bands.slice().sort((p, q) => q.volume - p.volume)[0];
    gelSetBandBounds(0, 5, a.lanes[5].bands.indexOf(b), b.y0 - 3, b.y1 + 3); });
  await page.evaluate(() => closeGelAnalysis());
  await replace(page, 0, tif('pERK_rerun.tif', pERK(P1, { seed: 511, dy: 12 })));
  await toasts(page);
  const u2 = await updateChart(page);
  expect(u2.t).toMatch(/hand edits were not carried over to the new image \(lane 6: the band with edges set by hand/);
  expect(await page.evaluate(() => _chartSourceState(images.find(p => p.type === 'chart')).state)).toBe('check');
  expect(errors).toEqual([]);
});

test('blot5-01: divided by another target\'s whole lane, a doublet every lane split is summed too — and the toast says so', async ({ page }) => {
  const errors = await loadApp(page);
  // total ERK over total ERK: the doublet splits in all 15 lanes of both
  await addBlots(page, [tif('ERK-a.tif', ERK({ seed: 502, dy: 5 })), tif('ERK-b.tif', ERK({ seed: 512, dy: 2 }))]);
  await page.evaluate(() => { images.forEach(im => { im.cropT = 3; im.cropB = 3; im.cropL = 2.35; im.cropR = 2.35; }); render();
    [0, 1].forEach(i => { runGelAnalysis(i); gelSetLadder(i, 0, '75, 50, 37'); gelSetRefLane(i, 1); }); });
  const before = await page.evaluate(() => images[0].gelAnalysis.doubletSites);
  expect(before.length).toBe(1); expect(before[0].one).toEqual([]); expect(before[0].applied).toBeNull();   // all split: two bands, as before
  await toasts(page);
  await page.evaluate(() => gelSetLoading(0, 1, 'target'));
  expect(await toasts(page)).toMatch(/the doublet at (4\d\.\d–4\d\.\d kDa|Rf 0\.\d\d) now counted as one band \(both summed\) in every lane, as the other target's whole lane is/i);
  const after = await page.evaluate(() => { const a = images[0].gelAnalysis, s = a.doubletSites[0], F = a.frame, y1 = F.sy + s.rf1 * F.sh, y2 = F.sy + s.rf2 * F.sh;
    return { applied: s.applied, n: a.lanes.slice(1).map(L => L.bands.filter(b => b.yc > y1 - 12 && b.yc < y2 + 12).length) }; });
  expect(after.applied).toBe('one');
  expect(after.n.every(k => k === 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('blot5-07: ⇄ Replace on the total-ERK blot of a phospho/total pair — the toast says the chart reads it, ↻ Update measures it again and pairs it again, and the bars come back', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 }))]);
  await analyse(page, 2);
  await page.evaluate(() => chartFromDensitometry(0));
  await toasts(page);
  await replace(page, 1, tif('ERK-total_reexposure.tif', ERK({ seed: 602, dy: 9, gain: 1.3 })));
  expect(await toasts(page)).toMatch(/panel A is normalised to it — ↻ Update from densitometry in the linked chart measures it again and pairs it again/);
  expect(await page.evaluate(() => _chartSourceState(images.find(p => p.type === 'chart')).why)).toMatch(/panel B has a different image now — ↻ Update from densitometry measures it again/);
  const u = await updateChart(page);
  expect(u.t).toMatch(/panel B, the other target panel A is divided by, was measured again on its new image and paired again/);
  expect(u.t).not.toMatch(/bars are gone/);
  const v = await chartVals(page);
  v.forEach((x, i) => expect(Math.abs(x / TRUTH[i] - 1)).toBeLessThan(0.06));      // was: every bar empty
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/current with it ✓/);
  expect(errors).toEqual([]);
});

test('blot5-13: ÷ total ERK → ÷ GAPDH — a generated Y title follows; a typed one is flagged in the toast, the chart dialog, the caption and compliance until it is edited or confirmed', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 })), tif('GAPDH.tif', GAPDH({ seed: 503, dy: -6 }))]);
  await analyse(page, 3);
  await page.evaluate(() => chartFromDensitometry(0));
  // generated title: follows
  expect(await page.evaluate(() => images.find(p => p.type === 'chart').chart.axes.y.title)).toMatch(/÷ ERK-total/);
  await page.evaluate(() => gelSetLoading(0, 2, 'bands'));
  expect(await page.evaluate(() => images.find(p => p.type === 'chart').chart.axes.y.title)).toBe('Band volume ÷ the loading control, relative to lane 2');
  (await chartVals(page)).forEach((x, i) => expect(Math.abs(x / TRUTH_GAPDH[i] - 1)).toBeLessThan(0.06));
  // typed title (in the chart's dialog), then back to ÷ total ERK
  await page.evaluate(() => gelSetLoading(0, 1, 'target'));
  await page.evaluate(i => openDataPanelEditor(i), await chartIdx(page));
  await page.fill('#chart-ytitle', 'pERK1/2 / total ERK1/2 (fold of 0 min)');
  await page.locator('#chart-ytitle').press('Tab');
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/current with it ✓/);
  await toasts(page);
  await page.evaluate(() => gelSetLoading(0, 2, 'bands'));
  const t = await toasts(page);
  expect(t).toMatch(/the Y title “pERK1\/2 \/ total ERK1\/2 \(fold of 0 min\)” was typed for “Band volume ÷ ERK-total, relative to lane 2”, and the values are now “Band volume ÷ the loading control, relative to lane 2”/);
  expect(t).not.toMatch(/^1 chart updated/);
  expect(await page.evaluate(() => images.find(p => p.type === 'chart').chart.axes.y.title)).toBe('pERK1/2 / total ERK1/2 (fold of 0 min)');
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/✗.*Y title .*typed for/);
  const cap = await page.evaluate(() => _captionText());
  expect(cap).toMatch(/\[⚠ Check before submitting: the Y title/);
  await page.evaluate(i => openDataPanelEditor(i), await chartIdx(page));
  await expect(page.locator('#chart-link-note')).toContainText('was typed for');
  await page.locator('#chart-link-note button:has-text("Y title is right")').click();
  await page.locator('#chart-modal').getByRole('button', { name: 'Apply' }).click();
  expect(await complianceRow(page, /Charts from densitometry/)).toMatch(/current with it ✓/);
  expect(errors).toEqual([]);
});

test('blot5-08 / blot5-03: a lane-table rename reaches the linked chart; a line chart takes its times as x (1 h read as 60 min) and stays linked', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 }))]);
  await analyse(page, 2);
  const r = await page.evaluate(() => {
    const T = [''].concat(...['0 min', '5 min', '15 min', '30 min', '60 min'].map(t => [t, t, t]));
    _ltEdit(0, t => { t.lanes = 16; t.rows = [{ name: 'EGF', cells: T }]; });
    chartFromDensitometry(0);
    const el = images.find(p => p.type === 'chart'); el._chartKey = '';
    const c0 = _chartStatsCached(el).categories;
    [13, 14, 15].forEach(c => laneTableSetCell(0, 0, c, '1 h'));
    el._chartKey = ''; el._chartStat = null;
    const c1 = _chartStatsCached(el).categories;
    el.chart.kind = 'line'; el._chartKey = ''; el._chartStat = null;
    const s = _chartStatsCached(el).series[0].points.map(p => [p.x, +p.y.toFixed(2), p.n]);
    return { c0, c1, s, empty: _chartEmptyWhy(el.chart, true), link: !!el.chart.link, cap: _laneTableWords(images[0]) };
  });
  expect(r.c0).toEqual(['0 min', '5 min', '15 min', '30 min', '60 min']);
  expect(r.c1).toEqual(['0 min', '5 min', '15 min', '30 min', '1 h']);          // was: still "60 min"
  expect(r.s.map(p => p[0])).toEqual([0, 5, 15, 30, 60]);                        // was: nothing drawn
  expect(r.s.every(p => p[2] === 3)).toBe(true);
  expect(Math.abs(r.s[1][1] / (TRUTH.slice(3, 6).reduce((a, b) => a + b) / 3) - 1)).toBeLessThan(0.03);
  expect(r.empty).toBeFalsy();
  expect(r.link).toBe(true);
  expect(r.cap).toMatch(/^Lanes, left to right — EGF: M \(marker\), 0 min/);    // blot5-11: not "blank"
  expect(errors).toEqual([]);
});

test('blot5-14: a lane twice the width of the others (two faint lanes run together) is flagged in the dialog and in compliance, with the lane count to type', async ({ page }) => {
  const errors = await loadApp(page);
  // lanes 2 and 3 faint and close together, as the tester's control strip read them
  const b = ladder();
  for (let i = 0; i < 15; i++) { const a = i < 2 ? 900 : 9000; b.push([i + 1 + (i === 0 ? 0.32 : i === 1 ? -0.32 : 0), ymw(42), a, 6]); }
  await addBlots(page, [tif('control.tif', make(b, { seed: 77, noise: 300 }))]);
  await page.evaluate(() => { const im = images[0]; im.cropT = 3; im.cropB = 3; im.cropL = 2.35; im.cropR = 2.35; render(); runGelAnalysis(0); openGelAnalysis(0); });
  const n = await page.evaluate(() => images[0].gelAnalysis.lanes.length);
  expect(n).toBe(15);
  expect(await page.locator('#gel-banner').innerText()).toMatch(/⚠ Lane 2 is \d+ px wide against \d+ px for most lanes — it may be two lanes run together .* type 16 in Lanes and ↻ Re-detect/);
  expect(await complianceRow(page, /Densitometry/)).toMatch(/lane 2 is \d+ px wide/);
  expect(errors).toEqual([]);
});

test('blot5-11 / blot2-09: an unlettered total-ERK strip is named by its row heading — in the chart\'s Y title, Methods and compliance — never by its file or "?"', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('2026-11-12_pERK.tif', pERK(P1, { seed: 501 })), tif('2026-11-12_ERK-total_iBright_16bit.tif', ERK({ seed: 502, dy: 5 }))]);
  await page.evaluate(() => { sv('cols', '1'); sv('rows', '3'); sv('show-row-labels', true); onLayoutChange();
    images[1].label = ''; render();
    const ins = [...document.querySelectorAll('#row-label-inputs input')]; ins[0].value = 'pERK1/2'; ins[1].value = 'ERK1/2'; ins.forEach(i => i.dispatchEvent(new Event('input'))); render(); });
  await analyse(page, 2);
  await page.evaluate(() => chartFromDensitometry(0));
  const r = await page.evaluate(() => ({ y: images.find(p => p.type === 'chart').chart.axes.y.title, m: _gelMethodsSentences(images.filter(p => p && p.gelAnalysis)).join(' ') }));
  expect(r.y).toBe('Band volume ÷ ERK1/2, relative to lane 2');                   // was: ÷ 2026-11-12_ERK-total_iBright_16bit
  expect(r.m).toMatch(/normalised to a second target, ERK1\/2, probed on its own blot/);
  expect(r.m).toMatch(/Band densitometry of the ERK1\/2 strip was performed/);    // was: "of panel the ERK1/2 strip"
  expect(r.m).not.toMatch(/panel the /);
  const d = await complianceRow(page, /Densitometry/);
  expect(d).toMatch(/the ERK1\/2 strip: 16-bit/);
  expect(d).not.toMatch(/\?:/);
  expect(errors).toEqual([]);
});

test('blot5-05: a panel letter drawn over the ladder\'s marker bands is a Densitometry compliance warning; in another corner it is not', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 }))]);
  await analyse(page, 1);
  await page.evaluate(() => { sv('show-labels', true); sv('label-pos', 'tl'); render(); });
  expect(await complianceRow(page, /Densitometry/)).toMatch(/its letter “A” covers the ladder's 75( and 50)? kDa marker band/);
  await page.evaluate(() => { sv('label-pos', 'tr'); render(); });
  expect(await complianceRow(page, /Densitometry/)).not.toMatch(/covers the ladder/);
  expect(errors).toEqual([]);
});

test('blot5-12: category labels that would sit under half an em apart are turned, not run together', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const ch = _defaultChart('bar');
    ch.data = { columns: ['Time', 'v'], rows: ['0 min', '5 min', '15 min', '30 min', '60 min'].map((t, i) => [t, i + 1]) };
    ch.mapping = { xCol: 0, yCols: [1], seriesCol: null, layout: 'xcol' };
    const out = [];
    for (let w = 200; w <= 420; w += 4) {
      const el = { type: 'chart', x: 0, y: 0, w, h: 160, chart: ch }, T = [];
      _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(str, x, y, font, fill, align, baseline, rot) { T.push({ str, x, font, align, rot }); } });
      const cats = T.filter(t => /^\d+ min$/.test(t.str));
      if (cats.some(t => t.rot)) { out.push({ w, rot: true }); continue; }
      const mc = _rtMc(); const ws = cats.map(t => { mc.font = t.font; return mc.measureText(t.str).width; });
      const fs = parseFloat(/([\d.]+)px/.exec(cats[0].font)[1]);
      const gaps = cats.slice(1).map((t, i) => (t.x - ws[i + 1] / 2) - (cats[i].x + ws[i] / 2));
      out.push({ w, rot: false, minGapEm: Math.min(...gaps) / fs });
    }
    return out;
  });
  r.filter(q => !q.rot).forEach(q => expect(q.minGapEm).toBeGreaterThanOrEqual(0.45));
  expect(r.some(q => q.rot)).toBe(true);
  expect(r[r.length - 1].rot).toBe(false);
  expect(errors).toEqual([]);
});

test('blot5-13 / blot5-01 after reopening: a saved session keeps the doublet setting, the hand edits not carried over and the flagged Y title', async ({ page }) => {
  const errors = await loadApp(page);
  await addBlots(page, [tif('pERK.tif', pERK(P1, { seed: 501 })), tif('ERK-total.tif', ERK({ seed: 502, dy: 5 })), tif('GAPDH.tif', GAPDH({ seed: 503, dy: -6 }))]);
  await analyse(page, 3);
  await page.evaluate(() => { gelSetDoublets(0, 'two'); chartFromDensitometry(0);
    const el = images.find(p => p.type === 'chart'); el.chart.axes.y.title = 'pERK1/2 / total ERK1/2'; el.chart.link.titleKey = _gelNormKey(el.chart.link.ids, el.chart.link.metric);
    gelSetLoading(0, 2, 'bands');
    images[0].gelAnalysis.editsLost = { what: ['lane 6: the band with edges set by hand at 42.6 kDa'], lanes: [5], on: 'image' }; });
  const before = await page.evaluate(() => _chartSourceState(images.find(p => p.type === 'chart')));
  expect(before.state).toBe('check');
  const S = await page.evaluate(() => JSON.stringify(serializeSession(true)));
  const p = await page.context().newPage(); const e2 = await loadApp(p);
  await p.evaluate(async S => { applySession(JSON.parse(S), { origin: 'file' }); await new Promise(r => setTimeout(r, 400)); render(); }, S);
  const after = await p.evaluate(() => ({ ss: _chartSourceState(images.find(p => p.type === 'chart')), mode: _gelDoubletMode(images[0].gelAnalysis), sites: (images[0].gelAnalysis.doubletSites || []).length }));
  expect(after.mode).toBe('two');
  expect(after.sites).toBe(1);
  expect(after.ss.state).toBe('check');
  expect(after.ss.why).toMatch(/not carried over/);
  expect(after.ss.why).toMatch(/Y title “pERK1\/2 \/ total ERK1\/2” was typed for/);
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});
