// Verifies docs/guides/western-blot.md through the visible UI: stack the blots, straighten and
// crop them to one size, measure the bands against total protein, MW labels, lane table,
// chart the values, a journal preset and printed width, uncropped originals (S1), and a revision
// by replacing an image. A second figure (one blot with WT and R42P replicate lanes) checks
// "Which panel?", ✕ Remove analysis, replicates pooled by name, a chart typed by hand, and Widen.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { expect, btn } = L;
// WB_ONLY_D=1 runs only the fourth figure (the doublet), for working on it; run-all runs everything.
const ONLY_D = process.env.WB_ONLY_D === '1';
const step = (T, name, fn) => (ONLY_D && !/^D/.test(name)) ? Promise.resolve() : L.step(T, name, fn);

// ---------------------------------------------------------------- The round-5 doublet blots
// pERK1/2 (T202/Y204), total ERK1/2 and GAPDH, 16-bit, 16 lanes (ladder + 0/5/15/30/60 min × 3),
// as tests/ux5-blot.spec.js makes them: a p44/p42 doublet 13.6 px apart (σ 4.5 px, p44 =
// 0.45 × p42, partly resolved), a background gradient, a smile, noise and dust. Truth: pERK ÷
// ERK relative to lane 2 is the phospho fraction relative to lane 2, however the doublet is
// read, as long as every lane is read the same way.
const D = (() => {
  function rng(seed) { let s = seed >>> 0 || 1; const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
    let spare = null; return { u, n() { if (spare != null) { const v = spare; spare = null; return v; } const a = u(), b = u(), r = Math.sqrt(-2 * Math.log(a)); spare = r * Math.sin(2 * Math.PI * b); return r * Math.cos(2 * Math.PI * b); } }; }
  const W = 1700, H = 340, Y0 = 380, PITCH = 98, HALF = 30;
  const ymw = mw => 90 + (Math.log10(250) - Math.log10(mw)) / (Math.log10(250) - 1) * 940;
  const TOT = [1.00, 1.06, 0.95, 1.03, 0.97, 1.01, 0.98, 1.04, 0.96, 0.94, 1.05, 1.00, 0.99, 1.02, 0.97];
  const LOAD = [1.00, 0.90, 1.10, 0.95, 1.12, 0.88, 1.05, 0.92, 1.08, 0.97, 1.03, 0.86, 1.15, 0.94, 1.02];
  const P1 = [0.15, 0.12, 0.18, 1.00, 0.90, 1.10, 0.70, 0.62, 0.78, 0.40, 0.34, 0.45, 0.18, 0.21, 0.15];
  const P2 = [0.14, 0.16, 0.13, 1.20, 1.05, 1.32, 0.80, 0.74, 0.86, 0.38, 0.42, 0.35, 0.20, 0.17, 0.22];
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
    return (x, y) => img[y * W + x];
  }
  const ladder = () => [75, 50, 37].map(m => [0, ymw(m), 11000, 5.5]);
  function erkBands(amp) { const b = ladder(), c = (ymw(42) + ymw(44)) / 2, h = (ymw(42) - ymw(44)) / 2;
    for (let i = 0; i < 15; i++) b.push([i + 1, c + h, amp(i), 4.5], [i + 1, c - h, 0.45 * amp(i), 4.5]); return b; }
  const tif = (file, fn) => L.writeTiff16(file, W, H, fn);
  return {
    P1, P2, TRUTH: P1.map(v => v / P1[0]), TRUTH2: P2.map(v => v / P2[0]), TRUTH_GAPDH: P1.map((v, i) => v * TOT[i] / (P1[0] * TOT[0])),
    pERK: (file, P, o = {}) => tif(file, make(erkBands(i => 15000 * P[i] * TOT[i] * LOAD[i]), o)),
    ERK: (file, o = {}) => tif(file, make(erkBands(i => 13000 * TOT[i] * LOAD[i]), o)),
    GAPDH: (file, o = {}) => tif(file, make(ladder().concat(LOAD.map((l, i) => [i + 1, ymw(37), 15000 * l, 6])), o)),
  };
})();

// What the synthetic blots hold: band amount per sample lane (lanes 2–7; lane 1 is the ladder).
const TRUTH = {
  PhoA: [0.3, 1, 0, 0, 0.4, 1.6],
  PhoB: [0.5, 1, 0.5, 1, 0.5, 1],
};
const LANE_X = [348.75, 798.75];          // two sample lanes along the band row, source px (lanes 3 and 7)

(async () => {
  const T = await L.start('western-blot');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');
  const f = n => path.join(inp, n);
  // band rows (source px) and tilt of each scan, as the generator draws them
  const scans = [
    { file: I.blotTiff(f('2026-11-03_PhoA_ChemiDoc.tif'), { amounts: TRUTH.PhoA, tiltDeg: 1.2, seed: 3, bandY: 0.5 }), bandY: 210, tilt: 1.2, cropY: 75 },
    { file: I.blotTiff(f('2026-11-03_PhoB_ChemiDoc.tif'), { amounts: TRUTH.PhoB, tiltDeg: -0.8, seed: 4, bandY: 0.45 }), bandY: 189, tilt: -0.8, cropY: 70 },
    { file: I.blotTiff(f('2026-11-03_GapA_loading.tif'), { amounts: [1, 1, 1, 1, 1, 1], tiltDeg: 0.6, seed: 5, bandY: 0.6 }), bandY: 252, tilt: 0.6, cropY: 120 },
    { file: I.totalProteinTiff(f('2026-11-03_TotalProtein_stainfree.tif'), { tiltDeg: 1.0 }), tilt: 1.0, cropY: 20, cropH: 380 },
  ];
  const rerun = I.blotTiff(f('2026-11-12_PhoA_rerun_ChemiDoc.tif'), { amounts: TRUTH.PhoA, tiltDeg: -2.0, seed: 13, bandY: 0.5 });

  // Screenshot the top `h` px of a dialog (its first child box), for the guide.
  const topShot = async (name, loc, h) => { const bb = await loc.boundingBox(); return L.shot(T, name, { x: bb.x, y: bb.y, width: bb.width, height: Math.min(h, bb.height) }, { doc: true }); };
  const dismissTip = async () => { const g = p.getByText('Got it', { exact: true }); if (await g.isVisible().catch(() => false)) await g.click(); };
  // Where panel i is drawn on screen (used only to aim a real click at it).
  const panelPoint = async (i, fx = 0.5, fy = 0.5) => p.evaluate(([i, fx, fy]) => {
    const c = document.getElementById('fig-canvas'), r = c.getBoundingClientRect(), b = panelBounds.find(q => q.idx === i);
    const s = r.width / (c.width / (window.devicePixelRatio || 1));
    return { x: r.x + (b.x + b.w * fx) * s, y: r.y + (b.y + b.h * fy) * s };
  }, [i, fx, fy]);
  const clickPanel = async (i, opts) => { const q = await panelPoint(i, 0.75, 0.5); await p.mouse.click(q.x, q.y, opts); await p.waitForTimeout(250); };

  // ---------------------------------------------------------------- Task 1
  await step(T, '1.1 Drop or click to add images → pick the four scans in stack order', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), scans.map(s => s.file));
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 20000 });
    await p.waitForTimeout(800); await dismissTip();
    const t = await L.toasts(T);
    expect(/native samples kept for measurement/.test(t), 'no 16-bit toast: ' + t);
    return '16-bit kept: "native samples kept for measurement"';
  });

  await step(T, '1.2 Arrange › Columns 1, Rows 4, tick Rows hug their panels', async () => {
    await L.openSection(T, 'Arrange');
    for (const [lab, v] of [['Columns', '1'], ['Rows', '4']]) { const i = p.getByLabel(lab, { exact: true }); await i.fill(v); await i.press('Tab'); }
    await p.getByLabel('Rows hug their panels').check();
    await p.waitForTimeout(400);
    const g = await p.evaluate(() => [cols.value, rows.value, document.getElementById('auto-row-h').checked]);
    expect(g[0] === '1' && g[1] === '4' && g[2], String(g));
  });

  // ---------------------------------------------------------------- Task 2
  const m = p.locator('#crop-modal');
  // Types the px fields in the order given (ux2: any order works; a typed box counts as drawn).
  const setBox = async (o, order = ['w', 'h', 'x', 'y']) => { for (const k of order) if (o[k] != null) { const i = m.locator('#crop-px-' + k); await i.fill(String(o[k])); await i.press('Tab'); } await p.waitForTimeout(200); };
  const level = async (s) => {
    await m.locator('button', { hasText: '📐 Level' }).click(); await p.waitForTimeout(200);
    const c = p.locator('#crop-ed-canvas'); const bb = await c.boundingBox();
    const sx = bb.width / 900, sy = bb.height / 420;
    for (const x of LANE_X) { await c.click({ position: { x: x * sx, y: (s.bandY + (x - 450) * Math.tan(s.tilt * Math.PI / 180)) * sy } }); await p.waitForTimeout(200); }
    return +(await m.locator('#crop-angle').inputValue());
  };
  const boxNow = () => p.evaluate(() => ['x', 'y', 'w', 'h'].map(k => +document.getElementById('crop-px-' + k).value));
  const tilts = []; let lastBox = null;   // the box as the previous scan left it (Level turns it about its centre)
  await step(T, '2.1 ⌘K "batch crop" opens ✂ Batch Crop (1 / 4)', async () => {
    const hits = await L.cmdk(T, 'batch crop');
    expect(/Batch crop/.test(hits[0]), hits[0]);
    await m.waitFor({ state: 'visible' });
    expect(/Batch Crop \(1 \/ 4\)/.test(await m.innerText()), 'title');
  });
  await step(T, '2.2 Strip 1: type px X 20, Y 75, W 860, H 210 (Y before H); the box keeps all four; 📐 Level on the band row; ✓ Apply & Next', async () => {
    await setBox({ w: 860, h: 210, x: 20, y: scans[0].cropY }, ['x', 'y', 'w', 'h']);
    const box = await boxNow();
    expect(box.join(',') === '20,75,860,210', 'typed box became ' + box);
    const hint = await m.locator('#batch-crop-hint').innerText();
    expect(!/Draw to set crop size/.test(hint), 'status still says: ' + hint);
    tilts.push(await level(scans[0]));
    lastBox = await boxNow();
    expect(Math.abs(tilts[0] - scans[0].tilt) <= 0.3, 'tilt ' + tilts[0]);
    const warn = await m.innerText();
    expect(!/extends past the image/.test(warn), 'box extends past the image');
    await topShot('western-blot-batch-crop', m.locator('xpath=./*[1]'), 470);
    await m.locator('button', { hasText: '✓ Apply & Next' }).click(); await p.waitForTimeout(600);
    return 'box ' + box.join(', ') + ' (after Level ' + lastBox.join(', ') + '); status "' + hint + '"; Tilt ' + tilts[0] + '° (true ' + scans[0].tilt + '°)';
  });
  await step(T, '2.3 Strips 2–3 open with the same box (X, Y, W, H): type Y only, Level, Apply & Next', async () => {
    const carried = [], xs = [];
    for (const s of [scans[1], scans[2]]) {
      const keep = await boxNow(); carried.push(keep.join(','));
      expect(keep.join(',') === lastBox.join(','), 'box not carried: ' + keep + ' (previous scan ' + lastBox + ')');
      await setBox({ y: s.cropY }); tilts.push(await level(s));
      lastBox = await boxNow(); xs.push(lastBox[0]);
      await m.locator('button', { hasText: '✓ Apply & Next' }).click(); await p.waitForTimeout(600);
    }
    expect(Math.abs(tilts[1] - scans[1].tilt) <= 0.3 && Math.abs(tilts[2] - scans[2].tilt) <= 0.3, 'tilts ' + tilts);
    return 'opened with X,Y,W,H ' + carried.join(' / ') + '; X after Level ' + xs.join(', ') + '; tilts ' + tilts.slice(1).join('°, ') + '° (true −0.8°, 0.6°)';
  });
  await step(T, '2.4 Total-protein strip: taller box (Y 20, then H 380), ✨ Auto, ✓ Apply & Done', async () => {
    await setBox({ h: 380, y: 20 }, ['y', 'h']);
    const box = await boxNow();
    expect(box[1] === 20 && box[3] === 380, 'typed Y 20, H 380 became ' + box);
    await m.locator('button', { hasText: '✨ Auto' }).click(); await p.waitForTimeout(600);
    const a = +(await m.locator('#crop-angle').inputValue()); tilts.push(a);
    expect(Math.abs(a - 1.0) <= 0.3, 'Auto tilt ' + a);
    await m.locator('button', { hasText: '✓ Apply & Done' }).click(); await p.waitForTimeout(600);
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(500);
    const ang = await p.evaluate(() => images.map(im => im.cropAngle));
    expect(ang.every(x => x), 'crop angles ' + ang);
    return 'Auto ' + a + '° (true 1.0°)';
  });

  // ---------------------------------------------------------------- Task 3
  const g = p.locator('#gel-modal-bg');
  const openGel = async (i) => {
    await clickPanel(i);
    await L.cmdk(T, 'densitometry');
    await g.waitFor({ state: 'visible' });
    await p.waitForTimeout(800);
    return g.locator('text=/Lanes & bands — panel/').first().innerText();
  };
  const tableRows = async () => (await g.innerText()).split('\n').filter(l => /^\d+\t/.test(l)).map(l => l.split('\t'));
  await step(T, '3.1 Click strip A, ⌘K "densitometry" opens ⫼ Lanes & bands — panel A with 7 lanes', async () => {
    const title = await openGel(0);
    expect(/panel A/.test(title), title);
    const t = await g.innerText();
    expect(/7 lane\(s\)/.test(t), 'lane count');
    expect(/guessed from the image: dark on light/.test(t), 'polarity');
    return (t.match(/Lanes at x:[^\n]*/) || [''])[0].slice(0, 90);
  });
  await step(T, '3.2 Ladder lane = lane 1, sizes "75, 50, 37" → Fit', async () => {
    const pre = await g.locator('#gel-ladder-sizes').inputValue();
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await p.waitForTimeout(300);
    const fit0 = ((await g.locator('#gel-fit').innerText()).trim() + ' ' + await L.toasts(T)).trim();
    await g.locator('#gel-ladder-sizes').fill('75, 50, 37');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    const r = await tableRows();
    const kda = r.filter(x => x[0] === '1').map(x => x[9]);
    expect(kda.join(',') === '75,50,37', 'ladder kDa ' + kda);
    const fit = ((await g.innerText()).match(/R²\s*=?\s*[\d.]+/) || [''])[0];
    return `prefilled "${pre}" → on picking lane 1: "${fit0.slice(0, 90)}"; typed 75/50/37 kDa ${fit}`;
  });
  await step(T, '3.3 Reference lane = lane 3; Loading control = panel D, Total protein (whole lane)', async () => {
    await g.locator('#gel-ref').selectOption({ label: 'lane 3' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc').selectOption({ label: 'panel D' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Total protein (whole lane)' }); await p.waitForTimeout(1200);
    const head = (await g.innerText()).split('\n').find(l => /^Lane\tBand/.test(l));
    expect(/÷LC rel ref/.test(head), 'no normalised column: ' + head);
    const r = await tableRows();
    const col = head.split('\t').indexOf('÷LC rel ref');
    const got = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    TRUTH.measuredA = got;
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(got[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${got[k]} vs ${v}`));
    await topShot('western-blot-lanes-bands', g.locator('xpath=./*[1]'), 560);
    const band = await g.locator('#gel-chart-band option:checked').innerText();
    expect(/^Band to chart: auto — at [\d.]+ kDa \(the largest band in reference lane 3\)/.test(band), 'Band to chart: ' + band);
    return 'PhoA ÷ total protein, rel. lane 3: ' + got.map(v => v.toFixed(3)).join(' / ') + ' (truth 0.3 / 1 / 0 / 0 / 0.4 / 1.6); "' + band + '"';
  });
  await step(T, '3.3b Alternative: Loading control = panel C, Loading band(s) gives the same ratios; then back to total protein', async () => {
    await g.locator('#gel-lc').selectOption({ label: 'panel C' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Loading band(s)' }); await p.waitForTimeout(1200);
    const t = await g.innerText();
    const head = t.split('\n').find(l => /^Lane\tBand/.test(l)).split('\t'); const col = head.indexOf('÷LC rel ref');
    const r = await tableRows();
    const got = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(got[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${got[k]} vs ${v}`));
    await g.locator('#gel-lc').selectOption({ label: 'panel D' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Total protein (whole lane)' }); await p.waitForTimeout(1000);
    return '÷ GapA, rel. lane 3: ' + got.map(v => v.toFixed(3)).join(' / ');
  });
  await step(T, '3.4 ⬇ CSV saves the band table', async () => {
    const file = await L.download(T, () => g.locator('button', { hasText: /^⬇ CSV$/ }).click(), /\.csv$/);
    const csv = fs.readFileSync(file, 'utf8');
    expect(/kDa|kda/i.test(csv) && csv.split('\n').length > 6, 'csv content');
    return path.basename(file);
  });

  // A second target blot, analysed but not yet normalised (no reference lane, no loading
  // control): the chart in 6.1 must leave it out and name it.
  await step(T, '3.5 Strip B: ⫼ Lanes & bands, ladder lane 1 "75, 50, 37" → Fit, no reference lane or loading control yet; back to strip A', async () => {
    await g.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    const title = await openGel(1);
    expect(/panel B/.test(title), title);
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await g.locator('#gel-ladder-sizes').fill('75, 50, 37');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    const fitB = ((await g.locator('#gel-fit').innerText()).trim() + ' ' + await L.toasts(T)).trim();
    await g.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    const t2 = await openGel(0);
    expect(/panel A/.test(t2), t2);
    return title + ' analysed (' + fitB.slice(0, 160) + '); ' + t2 + ' open again';
  });

  // ---------------------------------------------------------------- Task 4
  await step(T, '4.1 ↕ Place MW labels on the ladder bands draws 75 / 50 / 37 beside strip A', async () => {
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(600);
    const t = await L.toasts(T);
    const n = await p.evaluate(() => annotations.filter(a => a.type === 'text' && /^(75|50|37)$/.test(String(a.text).trim())).length);
    expect(n === 3, 'MW labels found: ' + n + ' ' + t);
    return t.slice(0, 120);
  });
  await step(T, '4.2 Placing again replaces the set; ✕ Remove MW labels clears it', async () => {
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(500);
    const n2 = await p.evaluate(() => annotations.filter(a => a.type === 'text' && /^(75|50|37)$/.test(String(a.text).trim())).length);
    expect(n2 === 3, 'after placing twice: ' + n2);
    await g.locator('button', { hasText: '✕ Remove MW labels' }).click(); await p.waitForTimeout(500);
    const n3 = await p.evaluate(() => annotations.filter(a => a.type === 'text' && /^(75|50|37)$/.test(String(a.text).trim())).length);
    expect(n3 === 0, 'after remove: ' + n3);
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(500);
  });

  // ---------------------------------------------------------------- Task 5
  const lt = p.locator('#lt-modal-bg');
  await step(T, '5.1 ⊞ Lane table… opens with one column per detected lane; the ladder column says M', async () => {
    await g.locator('button', { hasText: '⊞ Lane table…' }).click();
    await lt.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const t = await lt.innerText();
    expect(/Lane table — panel A/.test(t), 'title');
    const hdr = t.split('\n').find(l => /^Row\t/.test(l)) || '';
    expect(/\bM\b/.test(hdr), 'ladder column header: ' + hdr);
    return 'header: ' + hdr.replace(/\t/g, ' ');
  });
  await step(T, '5.2 + Row twice; name the rows ΔphoA and IPTG; type "- + - + - +" into one cell to fill the row; clicking a +/– cell cycles + / – / blank', async () => {
    await lt.locator('button', { hasText: '+ Row' }).click(); await p.waitForTimeout(300);
    const names = lt.locator('.lt-name'); const n = await names.count();
    expect(n >= 2, 'rows: ' + n);
    await names.nth(0).fill('Δ*phoA*'); await names.nth(0).press('Tab');
    await names.nth(1).fill('IPTG'); await names.nth(1).press('Tab');
    const cells = lt.locator('.lt-cell');
    const per = (await cells.count()) / n;
    await cells.nth(1).fill('- - + + - -'); await cells.nth(1).press('Tab'); await p.waitForTimeout(300);
    await cells.nth(per + 1).fill('- + - + - +'); await cells.nth(per + 1).press('Tab'); await p.waitForTimeout(400);
    const vals = await cells.evaluateAll(cs => cs.map(c => c.value));
    const r2 = vals.slice(per, 2 * per).join(' ');
    expect(/– \+ – \+ – \+|- \+ - \+ - \+/.test(r2), 'IPTG row: ' + r2);
    // ux3 (blot3-05): a click on an empty or +/– cell cycles + / – / blank; three clicks come back
    const hint = (await lt.innerText()).replace(/\s+/g, ' ');
    expect(/Click an empty or \+\/– cell to cycle \+ \/ – \/ blank; click a cell with text, or type, to write anything else/.test(hint), 'hint: ' + hint.slice(0, 300));
    const cyc = [await cells.nth(per + 2).inputValue()];
    for (let k = 0; k < 3; k++) { await cells.nth(per + 2).click(); await p.waitForTimeout(200); cyc.push(await cells.nth(per + 2).inputValue()); }
    expect(new Set(cyc.slice(0, 3)).size === 3 && cyc[3] === cyc[0], 'IPTG lane 3 cell by clicks: ' + cyc.map(v => v || 'blank').join(' → '));
    await L.shot(T, 'western-blot-lane-table', lt.locator('xpath=./*[1]'));
    await lt.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    return 'ΔphoA: ' + vals.slice(0, per).join(' ') + ' | IPTG: ' + r2 + ' | IPTG lane 3 by clicks: ' + cyc.map(v => v || 'blank').join(' → ');
  });

  // ---------------------------------------------------------------- Task 6
  await step(T, '6.1 📊 Chart these values adds a linked chart panel E; n.d. lanes; strip B (not normalised) left out and named; the loading control is not charted', async () => {
    await L.toasts(T);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1200);
    const t = await L.toasts(T);
    expect(/Charted 6 lanes × 1 panel/.test(t) && /Linked/.test(t), t);
    expect(/a lane with no band there is n\.d\./.test(t), 'n.d. not said: ' + t);
    expect(!/n\.d\.\./.test(t), 'double full stop: ' + t);   // ISSUES (fixed in ux3)
    expect(/left out Panel B \(no loading control and no reference lane\)/.test(t), 'B not named as left out: ' + t);
    const st = await p.evaluate(() => ({ mode: layoutMode, n: images.length, last: images[images.length - 1].type, charts: images.filter(i => i && i.type === 'chart').length }));
    expect(st.mode === 'grid' && st.last === 'chart' && st.charts === 1, JSON.stringify(st));
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(400);
    await L.shot(T, 'chart-default-title', p.locator('#canvas-container'));   // to look at: the default Y title
    return t;
  });
  // Pressing 📊 Chart these values in the left-out strip B's own dialog adds a second chart
  // (the first is linked to A only; see ISSUES.md). The guide says: Ctrl/⌘+Z, then press it
  // again in strip A's dialog, which updates the chart A is in.
  await step(T, '6.1b Strip B: reference lane 3, loading control panel D Total protein, Band to chart picked; 📊 Chart these values there adds a second chart (Ctrl/⌘+Z), in strip A\'s dialog it updates the same chart (two series)', async () => {
    const title = await openGel(1);
    expect(/panel B/.test(title), title);
    await g.locator('#gel-ref').selectOption({ label: 'lane 3' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc').selectOption({ label: 'panel D' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Total protein (whole lane)' }); await p.waitForTimeout(1200);
    const opts = await g.locator('#gel-chart-band option').allInnerTexts();
    expect(opts.length >= 2 && /^Band to chart: auto/.test(opts[0]) && /^Band to chart: lane 3 band 1, at ([\d.]+ kDa|Rf [\d.]+)$/.test(opts[1]), 'options: ' + opts.join(' | '));
    await g.locator('#gel-chart-band').selectOption({ index: 1 }); await p.waitForTimeout(500);
    const picked = await g.locator('#gel-chart-band option:checked').innerText();
    await L.toasts(T);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1200);
    const tB = await L.toasts(T);
    const n1 = await p.evaluate(() => images.filter(i => i && i.type === 'chart').length);
    await p.mouse.click(5, 880); await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(800);
    const n2 = await p.evaluate(() => images.filter(i => i && i.type === 'chart').length);
    expect(n2 === 1, `charts after undo: ${n2} (before ${n1})`);
    const tA = await openGel(0);
    expect(/panel A/.test(tA), tA);
    await L.toasts(T);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1200);
    const t = await L.toasts(T);
    expect(/^Updated the linked chart \(panel E\)/.test(t), t);
    const st = await p.evaluate(() => { const c = images.filter(i => i && i.type === 'chart'); return { charts: c.length, series: c[0].chart.data.columns.slice(1), n: images.length }; });
    expect(st.charts === 1 && st.series.join('|') === 'Panel A|Panel B', JSON.stringify(st));
    return `options: ${opts.join(' | ')}; picked "${picked}"; from B's dialog: ${n1} charts ("${tB.slice(-30)}"), after undo ${n2}; from A's dialog → ${t}`;
  });
  const chartDlg = p.locator('#chart-modal');
  await step(T, '6.2 Double-click the chart panel: the Chart dialog shows the normalised values', async () => {
    const q = await panelPoint(4); await p.mouse.dblclick(q.x, q.y);
    await chartDlg.waitFor({ state: 'visible' });
    const data = await chartDlg.locator('textarea').first().inputValue();
    const cells = data.split('\n').slice(1).map(l => l.split('\t'));
    const vals = cells.map(c => c[1]).map(v => v === '' ? 0 : +v);
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(vals[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${vals[k]} vs ${v}`));
    expect(cells[2][1] === '' && cells[3][1] === '', 'lanes 4–5 (no band) should be empty (n.d.): ' + cells[2] + ' / ' + cells[3]);
    const b = cells.map(c => +c[2]);
    TRUTH.PhoB.forEach((v, k) => expect(Math.abs(b[k] - v / TRUTH.PhoB[1]) < 0.08 + 0.05 * v, `PhoB lane ${k + 2}: ${b[k]} vs ${v}`));
    return data.replace(/\n/g, ' | ');
  });
  await step(T, '6.3 Names & colours "shown as": the lanes WT −, WT +, … and the series PhoA, PhoB → Apply; the default Y title fits on two lines', async () => {
    const keys = await chartDlg.locator('[data-key]').evaluateAll(rs => rs.filter(r => r.querySelector('input[placeholder^="shown as"]')).map(r => r.dataset.key));
    const want = { 'Lane 2': 'WT −', 'Lane 3': 'WT +', 'Lane 4': 'Δ −', 'Lane 5': 'Δ +', 'Lane 6': 'C −', 'Lane 7': 'C +', 'Panel A': 'PhoA', 'Panel B': 'PhoB' };
    const filled = [];
    for (const k of keys) if (want[k]) { await chartDlg.locator(`[data-key="${k}"] input[placeholder^="shown as"]`).fill(want[k]); filled.push(k); }
    expect(filled.length === 8, 'shown-as rows: ' + keys.join(', '));
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    // ux3 (data): the default Y title is kept; a title longer than the plot is set smaller, then on two lines
    const yt = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); const T = []; el._chartKey = ''; _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s) { T.push(String(s)); } }); return T.filter(x => /total|relative|Band volume/.test(x)); });
    expect(yt.length === 2 && yt.join(' ') === 'Band volume ÷ total protein, relative to lane 3', 'Y title drawn as: ' + JSON.stringify(yt));
    const st = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); const S = _chartStatsCached(el); return { cats: S.categories, series: (S.seriesNames || []).map(x => x.name || x.key || x) }; });
    expect(st.cats.join(',') === 'WT −,WT +,Δ −,Δ +,C −,C +', 'categories ' + st.cats);
    return 'rows: ' + keys.join(', ') + ' → categories ' + st.cats.join(', ') + '; series ' + JSON.stringify(st.series) + '; Y title drawn as ' + JSON.stringify(yt);
  });

  await step(T, '6.4 A new reference lane in strip A\'s ⫼ Lanes & bands updates the linked chart by itself (lane 7, then back to lane 3)', async () => {
    const val = () => p.evaluate(() => { const el = images.find(i => i.type === 'chart'); return el.chart.data.rows.map(r => r[1]); });
    await openGel(0);
    await g.locator('#gel-ref').selectOption({ label: 'lane 7' }); await p.waitForTimeout(800);
    const v7 = await val();
    await g.locator('#gel-ref').selectOption({ label: 'lane 3' }); await p.waitForTimeout(800);
    const v3 = await val();
    await g.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    expect(Math.abs(+v7[5] - 1) < 1e-6 && Math.abs(+v3[1] - 1) < 1e-6, `rel. lane 7: ${v7} / rel. lane 3: ${v3}`);
    return `PhoA rel. lane 7: ${v7.map(v => v === '' ? 'n.d.' : (+v).toFixed(2)).join(' / ')}; back to lane 3: ${v3.map(v => v === '' ? 'n.d.' : (+v).toFixed(2)).join(' / ')}`;
  });

  // ---------------------------------------------------------------- Task 8 (letters)
  await step(T, '8.1 Clear the letters of strips 2–4 (label box in each image row); type B for the chart', async () => {
    const boxes = p.locator('#img-list .img-label-input');
    for (const k of [1, 2, 3]) { await boxes.nth(k).fill(''); await boxes.nth(k).press('Tab'); }
    await boxes.nth(4).fill('B'); await boxes.nth(4).press('Tab');
    await p.waitForTimeout(400);
    const labs = await p.evaluate(() => images.map(i => i.label || '·').join(''));
    expect(labs === 'A···B', labs);
    await p.keyboard.press('Escape'); await btn(T, '⟳ Render').click(); await p.mouse.click(5, 880); await p.waitForTimeout(500);
    await p.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(600);   // the toast slides away: none over the guide's picture
    await L.shot(T, 'western-blot-figure', p.locator('#canvas-container'), { doc: true });
    return labs;
  });


  // ---------------------------------------------------------------- Task 9: journal and printed width (round 3)
  const readReport = async () => p.locator('#info-modal-bg').evaluate(m => ({
    title: (m.querySelector('#im-title') || {}).textContent || '',
    rows: [...m.querySelectorAll('.compliance-row')].map(r => ({
      icon: (r.querySelector('.c-icon') || {}).textContent?.trim(),
      label: (r.querySelector('.c-label') || {}).textContent?.trim(),
      note: (r.querySelector('.c-note') || {}).textContent?.trim(),
      buttons: [...r.querySelectorAll('button')].map(b => b.innerText.trim()) })) }));
  const rowOf = (R, label) => R.rows.find(r => r.label === label) || { icon: '', note: '(no row)', buttons: [] };
  const check = async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click(); await p.waitForTimeout(800);
    const R = await readReport(); await p.keyboard.press('Escape'); await p.waitForTimeout(200); return R;
  };
  const widthNow = () => p.evaluate(() => document.getElementById('export-width-mm').value);
  await step(T, '9.1 ⌘K "embo" → Journal: EMBO J: 180 mm, Helvetica letters, 600 DPI, text 7 pt; at 180 mm the stack prints >300 mm tall and Panel resolution fails', async () => {
    const w0 = await widthNow();
    await L.toasts(T);
    const hits = await L.cmdk(T, 'embo');
    expect(/^Journal: EMBO J/.test(hits[0]), hits[0]);
    await p.waitForTimeout(800);
    const t = await L.toasts(T);
    expect(/^EMBO J preset applied/.test(t) && /180 mm/.test(t) && /Helvetica letters, 600 DPI/.test(t) && /text 7 pt/.test(t), t);
    expect(await widthNow() === '180', 'width ' + await widthNow());
    const R = await check();
    const pr = rowOf(R, 'Panel resolution'), ph = rowOf(R, 'Printed height');
    expect(pr.icon === '✗' && /below the 300 ppi EMBO J asks for/.test(pr.note), JSON.stringify(pr));
    return `Printed width before: ${w0 === '0' ? 'Free' : w0}; toast "${t}"; ${R.title}; Printed height ${ph.note}; Panel resolution ✗ "${pr.note.slice(0, 60)}…"`;
  });
  await step(T, '9.2 Export › Printed width › 87 mm — narrowest (EMBO J): the toast says text grows against the pictures', async () => {
    await L.openSection(T, 'Export');
    const sel = p.locator('#export-width-mm');
    await sel.focus();
    await L.toasts(T);
    await sel.selectOption({ label: '87 mm — narrowest (EMBO J); single column (PNAS, unverified)' }); await p.waitForTimeout(800);
    const t = await L.toasts(T);
    expect(await widthNow() === '87', 'width ' + await widthNow());
    expect(/^Printed width 180 → 87 mm: text keeps its point size/.test(t), t);
    return t;
  });
  await step(T, '9.3 ✓ Check journal compliance at 87 mm: the lane table now prints under 5 pt and Text size offers "Lane tables to 7 pt"; after it Panel resolution, Printed width and height, Text size, MW markers and Charts from densitometry pass; Panel labels warns for the unlettered strips', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click(); await p.waitForTimeout(800);
    const R0 = await readReport();
    const ts0 = rowOf(R0, 'Text size');
    expect(ts0.icon === '✗' && /Lane-table text prints at [\d.]+ pt/.test(ts0.note) && ts0.buttons.includes('Lane tables to 7 pt'), JSON.stringify(ts0));
    await p.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' }).locator('button', { hasText: 'Lane tables to 7 pt' }).click(); await p.waitForTimeout(800);
    const R = await readReport(); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const want = { 'Printed width': '✓', 'Printed height': '✓', 'Text size': '✓', 'MW markers': '✓', 'Charts from densitometry': '✓', 'Loading control': 'ℹ', 'Uncropped originals': 'ℹ', 'Panel labels': '⚠' };
    const bad = Object.entries(want).filter(([k, v]) => rowOf(R, k).icon !== v).map(([k]) => k + ' ' + rowOf(R, k).icon + ' ' + rowOf(R, k).note.slice(0, 160));
    const pr = rowOf(R, 'Panel resolution');
    expect(!bad.length, bad.join(' | '));
    expect(pr.icon === '✓' || !/below the 300 ppi/.test(pr.note), 'Panel resolution: ' + pr.icon + ' ' + pr.note);
    expect(/S1…/.test(rowOf(R, 'Uncropped originals').buttons.join(' ')), 'no S1… button');
    const open = R.rows.filter(r => r.icon === '⚠' || r.icon === '✗').map(r => r.icon + ' ' + r.label);
    // ISSUES (round 3) "MW labels keep their own size under a journal preset": evidence, in pt
    const mwPt = await p.evaluate(() => { const k = _physFacts().wMm / 25.4 * 72 / canvasLogicalW;
      return annotations.filter(a => a && a.mw && a.blotPanel === images[0].id).map(a => +(a.fontSize * k).toFixed(1)); });
    expect(mwPt.length === 3 && mwPt.every(v => v > 8), 'MW labels (pt): ' + mwPt);   // ISSUES: still larger than the 7 pt text
    return `MW labels print at ${[...new Set(mwPt)].join(', ')} pt (text 7 pt); MW markers row "${rowOf(R, 'MW markers').note.slice(0, 160)}"; before: Text size ✗ "${(ts0.note.match(/smallest text: [^(]*/) || [''])[0]}"; after "Lane tables to 7 pt": ${R.title}; Text size "${rowOf(R, 'Text size').note.slice(0, 80)}"; Printed height ${rowOf(R, 'Printed height').note}; Panel resolution ${pr.icon} ${pr.note.slice(0, 50)}; MW markers "${rowOf(R, 'MW markers').note.slice(0, 50)}…"; Charts from densitometry "${rowOf(R, 'Charts from densitometry').note.slice(0, 200)}"; Panel labels "${rowOf(R, 'Panel labels').note}"; still open: ${open.join(', ')}`;
  });

  // ---------------------------------------------------------------- Task 8
  await step(T, '10.1 Export › 📄 Export uncropped originals (S1)… → ⬇ PDF (one page per panel): one page per scan', async () => {
    await L.openSection(T, 'Export');
    await p.locator('button:visible', { hasText: '📄 Export uncropped originals (S1)…' }).last().click();
    const s1 = p.locator('#s1-modal-bg'); await s1.waitFor({ state: 'visible' });
    const listed = await s1.innerText();
    expect(/\(tilted crop\)/.test(listed), 'S1 list: ' + listed.slice(0, 200));
    const file = await L.download(T, () => s1.locator('button', { hasText: '⬇ PDF (one page per panel)' }).click(), /\.pdf$/i, 60000);
    const s = fs.readFileSync(file, 'latin1');
    const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages === 4, 'pages: ' + pages);
    return path.basename(file) + ', ' + pages + ' pages';
  });

  // ---------------------------------------------------------------- Task 9
  await step(T, '11.1 Right-click strip A › ⇄ Replace image… → pick the re-run scan; crop, letter, lane table, MW labels and analysis kept; the toast says the MW labels sit on the old ladder until the re-analysis', async () => {
    await p.keyboard.press('Escape');
    const q = await panelPoint(0, 0.75, 0.5);
    await p.mouse.click(q.x, q.y, { button: 'right' }); await p.waitForTimeout(300);
    await L.pickFiles(T, p.locator('text=⇄ Replace image…').locator('visible=true').first(), [rerun]);
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ name: images[0].name, label: images[0].label, ang: images[0].cropAngle, t: images[0].cropT,
      laneRows: images[0].laneTable && images[0].laneTable.rows ? images[0].laneTable.rows.length : 0,
      marks: (images[0].panelAnns || []).length + annotations.filter(a => a.mw && a.blotPanel === images[0].id).length }));
    expect(/rerun/.test(st.name) && st.label === 'A', JSON.stringify(st));
    expect(st.laneRows > 0, 'lane table lost: ' + JSON.stringify(st));
    expect(st.marks > 0, 'MW labels lost: ' + JSON.stringify(st));
    const rt = (await L.toasts(T)).split(' | ').find(x => /^Panel A: /.test(x)) || '';
    expect(/kept/.test(rt), 'replace toast: ' + rt);
    expect(/MW labels sit where the old scan’s ladder bands were/.test(rt), 'replace toast does not mention the MW labels: ' + rt);
    st.mwY = await p.evaluate(() => annotations.filter(a => a.mw && a.blotPanel === images[0].id).map(a => +a.yf.toFixed(4)));
    globalThis.__mwBefore = st.mwY;
    return JSON.stringify(st) + '; toast "' + rt + '"';
  });
  await step(T, '11.2 The kept tilt is wrong for the new scan: right-click › ⚙ Open settings › ✂ Open Crop Editor › 📐 Level › ✓ Apply Crop', async () => {
    const q = await panelPoint(0, 0.75, 0.5);
    await p.mouse.click(q.x, q.y, { button: 'right' }); await p.waitForTimeout(300);
    await p.getByText('⚙ Open settings').last().click(); await p.waitForTimeout(400);
    await btn(T, '✂ Open Crop Editor').click();
    await m.waitFor({ state: 'visible' }); await p.waitForTimeout(300);
    const before = +(await m.locator('#crop-angle').inputValue());
    const a = await level({ bandY: 210, tilt: -2.0 });
    expect(Math.abs(a + 2.0) <= 0.3, 'level ' + a);
    await m.locator('button', { hasText: '✓ Apply Crop' }).click(); await p.waitForTimeout(800);
    return 'kept tilt ' + before + '° → levelled ' + a + '° (true −2.0°)';
  });
  await step(T, '11.3 The chart panel is marked out of date; its dialog\'s ↻ Update from densitometry re-analyses strip A, updates it and moves the MW labels onto the new ladder; Apply keeps the link', async () => {
    const onFig = await p.evaluate(() => _chartLinkState(images.find(i => i.type === 'chart')).stale);
    expect(onFig, 'chart not marked stale after the re-crop');
    const q = await panelPoint(4); await p.mouse.dblclick(q.x, q.y);
    await chartDlg.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const note = p.locator('#chart-link-note');
    const nt = (await note.innerText()).replace(/\s+/g, ' ');
    expect(/has changed since/.test(nt), nt);
    await L.toasts(T);
    await note.locator('button', { hasText: '↻ Update from densitometry' }).click(); await p.waitForTimeout(800);
    const t = await L.toasts(T);
    const nt2 = (await note.innerText()).replace(/\s+/g, ' ');
    expect(/^Linked to the densitometry/.test(nt2), nt2);
    expect(/^1 chart updated from the re-analysed densitometry; 3 MW labels of panel A moved onto the new ladder’s bands/.test(t), 'update toast: ' + t);
    // each label now sits on its ladder band of the re-run scan (within a third of its height)
    const off = await p.evaluate(() => { const M = _gelFigMapNow(0), T = _gelMWTargets(images[0].gelAnalysis, M);
      return annotations.filter(a => a.mw && a.blotPanel === images[0].id).map(a => { const t = T.find(q => q.kda === +a.text); return t ? Math.round(Math.abs(_mwCy(a, M.H) - t.y)) : 99; }); });
    expect(off.length === 3 && off.every(d => d <= 4), 'MW labels off their bands (px): ' + JSON.stringify(off));
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(500);
    const st = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); return { link: !!el.chart.link, stale: _chartLinkState(el).stale }; });
    expect(st.link && !st.stale, JSON.stringify(st));
    return 'note: "' + nt.slice(0, 120) + '"; Update → toast "' + t.slice(0, 120) + '"; after Apply: linked, up to date';
  });
  await step(T, '11.4 ⫼ Lanes & bands on strip A shows the re-analysis (same 7 lanes, reference, loading control (the total-protein strip), ladder; the chart holds its values); ⬇ CSV saves the new numbers', async () => {
    await L.toasts(T);
    const title = await openGel(0);
    const t = await g.innerText();
    const ref = await g.locator('#gel-ref').inputValue(), lc = await g.locator('#gel-lc-mode').inputValue(), lad = await g.locator('#gel-ladder-lane').inputValue();
    const lcPanel = await g.locator('#gel-lc option:checked').innerText();
    const head = t.split('\n').find(l => /^Lane\tBand/.test(l)).split('\t'); const col = head.indexOf('÷LC rel ref');
    const r = await tableRows();
    const tab = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    const csv = await L.download(T, () => g.locator('button', { hasText: /^⬇ CSV$/ }).click(), /\.csv$/);
    await g.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(400);
    const toast = await L.toasts(T);
    const st = await p.evaluate(() => { const el = images.find(i => i.type === 'chart'); return { stale: _chartLinkState(el).stale, v: _chartStatsCached(el).groups.map(g => g.bars[0] ? g.bars[0].value : 0) }; });
    expect(/panel A/.test(title) && ref === '2' && lc === 'total' && lad === '0', `ref ${ref} lc ${lc} ladder ${lad}`);
    // ux4 (blot4-01/04): the re-analysis keeps the lane count and the loading control's panel
    expect(/7 lane\(s\)/.test(t) && /TotalProtein/.test(lcPanel), 'lanes / loading control after the re-analysis: ' + (t.match(/\d+ lane\(s\)/) || [''])[0] + ', ' + lcPanel);
    expect(!st.stale, 'chart still stale');
    tab.forEach((v, k) => expect(Math.abs(st.v[k] - v) < 1e-3, `chart ${st.v[k]} vs table ${v}`));
    TRUTH.PhoA.forEach((v, k) => expect(Math.abs(tab[k] - v) < 0.05 + 0.03 * v, `lane ${k + 2}: ${tab[k]} vs ${v}`));
    return path.basename(csv) + '; 7 lanes, loading control ' + lcPanel + ' total protein; re-run PhoA: ' + tab.map(v => v.toFixed(3)).join(' / ') + '; ' + ((t.match(/tilted crop [^,]*/) || [''])[0]);
  });

  await step(T, '10.2 Export › 📦 Export submission package (ZIP) carries the S1 originals and each analysed blot\'s densitometry', async () => {
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => L.btn(T, '📦 Export submission package (ZIP)').click(), /\.zip$/, 120000);
    const list = L.zipList(f);
    const dens = list.filter(e => /densitometry/i.test(e));
    const s1 = list.filter(e => /S1/.test(e));
    expect(dens.length >= 1 && s1.length >= 1, 'entries: ' + list.join(', '));
    return dens.concat(s1).join(', ');
  });


  // ---------------------------------------------------------------- A second figure: replicate lanes (round 3)
  // One Parkin blot with three WT and three R42P lanes (band amounts below) and a loading
  // control, no tilt. Used for: "Which panel?" and ✕ Remove analysis (task 3), pooling
  // replicates by shown-as names and by lane-table names (task 7), a chart typed by hand
  // through a replaced scan (task 11) and the Widen fix for long lane names (task 9).
  const REP = [1.0, 0.85, 1.15, 0.4, 0.5, 0.45];          // lanes 2–4 WT, 5–7 R42P
  const REP2 = [1.0, 1.4, 1.15, 0.4, 0.5, 0.45];          // the re-probe: lane 3 changed
  const repA = I.blotTiff(f('2026-11-14_Parkin_reps.tif'), { amounts: REP, tiltDeg: 0, seed: 21, bandY: 0.5 });
  const repLC = I.blotTiff(f('2026-11-14_tubulin_reps.tif'), { amounts: [1, 1, 1, 1, 1, 1], tiltDeg: 0, seed: 22, bandY: 0.6 });
  const repA2 = I.blotTiff(f('2026-11-15_Parkin_reprobe.tif'), { amounts: REP2, tiltDeg: 0, seed: 23, bandY: 0.5 });
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sdev = a => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  const chartNow = () => p.evaluate(() => { const el = images.find(i => i && i.type === 'chart'); if (!el) return null; el._chartStat = null; el._chartKey = ''; const S = _chartStatsCached(el);
    return { link: !!el.chart.link, state: _chartSourceState(el).state, rows: el.chart.data.rows, err: el.chart.error, pts: !!(el.chart.style && el.chart.style.showPoints),
      cats: S.categories.map(c => _rtText(c)), bars: S.groups.map(g => [g.bars[0].value, g.bars[0].err, g.bars[0].n]), key: _keyText(_figureKey()) }; });
  const chartIdx = () => p.evaluate(() => images.findIndex(i => i && i.type === 'chart'));
  const openChartDlg = async () => {
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(300);
    const q = await panelPoint(await chartIdx()); await p.mouse.dblclick(q.x, q.y);
    await chartDlg.waitFor({ state: 'visible' }); await p.waitForTimeout(300);
  };
  // The words drawn on the figure on screen (a render, with fillText recorded): read-only.
  const drawnOnScreen = () => p.evaluate(() => { const proto = CanvasRenderingContext2D.prototype, orig = proto.fillText, T = [];
    proto.fillText = function (s, ...a) { T.push(String(s)); return orig.call(this, s, ...a); };
    try { render(); } finally { proto.fillText = orig; } return T.filter(x => /⚠/.test(x)); });
  const linkNote = async () => (await chartDlg.locator('#chart-link-note').innerText()).replace(/\s+/g, ' ');
  const closeGel = async () => { if (await g.isVisible().catch(() => false)) { await g.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300); } };

  await step(T, '3.6 (second figure) ✕ New, add a blot and its loading control; with no panel picked ⌘K "densitometry" asks "Which panel?"; a wrong pick is taken off with ✕ Remove analysis', async () => {
    await p.keyboard.press('Escape');
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(500);
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [repA, repLC]);
    await p.waitForFunction(() => images.filter(Boolean).length === 2, null, { timeout: 20000 });
    await p.waitForTimeout(800); await dismissTip();
    await L.cmdk(T, 'densitometry'); await p.waitForTimeout(500);
    const pick = p.locator('#panelpick-modal-bg');
    await pick.waitFor({ state: 'visible' });
    const ask = (await pick.innerText()).replace(/\s+/g, ' ');
    expect(/Which panel\?/.test(ask) && /No panel is selected\. Pick the panel for lanes & bands/.test(ask), ask);
    await pick.locator('button', { hasText: 'tubulin' }).click(); await p.waitForTimeout(800);
    const t1 = await g.locator('text=/Lanes & bands — panel/').first().innerText();
    await L.toasts(T);
    await g.locator('button', { hasText: '✕ Remove analysis' }).click(); await p.waitForTimeout(600);
    const tr = await L.toasts(T);
    const gone = await p.evaluate(() => !images[1].gelAnalysis);
    expect(/panel B/.test(t1) && gone && /^Lane analysis removed from panel B \(Ctrl\/⌘\+Z brings it back\)/.test(tr), `${t1} | ${tr} | removed ${gone}`);
    await closeGel();
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(300);
    const t2 = await openGel(0);
    expect(/panel A/.test(t2), t2);
    return `"${ask.slice(0, 120)}…" → picked B by mistake → "${tr}" → click strip A, ⌘K: ${t2}`;
  });

  await step(T, '7.1 Replicate lanes by shown-as name: lanes 2–4 "WT", 5–7 "R42P" → two bars, mean ± SD (n = 3) with the points, still linked; the names are this chart\'s own', async () => {
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await g.locator('#gel-ladder-sizes').fill('75, 50, 37, 25');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    await g.locator('#gel-ref').selectOption({ label: 'lane 2' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc').selectOption({ label: 'panel B' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Loading band(s)' }); await p.waitForTimeout(1200);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1200);
    await L.toasts(T);
    await openChartDlg();
    const lanes = (await chartDlg.locator('#chart-data-ta').inputValue()).split('\n').slice(1).map(l => +l.split('\t')[1]);
    const names = { 'Lane 2': 'WT', 'Lane 3': 'WT', 'Lane 4': 'WT', 'Lane 5': 'R42P', 'Lane 6': 'R42P', 'Lane 7': 'R42P' };
    for (const [k, v] of Object.entries(names)) await chartDlg.locator(`[data-key="${k}"] input[placeholder^="shown as"]`).fill(v);
    await p.waitForTimeout(400);
    const note = (await chartDlg.locator('#chart-merge-note').innerText()).replace(/\s+/g, ' ');
    expect(/^One name, one sample — WT: Lane 2, Lane 3, Lane 4 \(n = 3\); R42P: Lane 5, Lane 6, Lane 7 \(n = 3\): drawn as one group, mean ± SD, with the points\. The chart stays linked to the densitometry\./.test(note), note);
    expect(await chartDlg.locator('#chart-err').inputValue() === 'sd' && await chartDlg.locator('#chart-points').isChecked(), 'error bars / points not switched on');
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const c = await chartNow();
    expect(c.link && c.state === 'linked' && c.cats.join(',') === 'WT,R42P' && c.bars.map(b => b[2]).join(',') === '3,3', JSON.stringify(c));
    [lanes.slice(0, 3), lanes.slice(3, 6)].forEach((v, k) => expect(Math.abs(c.bars[k][0] - mean(v)) < 1e-9 && Math.abs(c.bars[k][1] - sdev(v)) < 1e-9, `bar ${k}: ${c.bars[k]} vs lanes ${v}`));
    expect(Math.abs(c.bars[0][0] - mean(REP.slice(0, 3))) < 0.03 && Math.abs(c.bars[1][0] - mean(REP.slice(3))) < 0.02, 'vs truth ' + JSON.stringify(c.bars));
    const own = await p.evaluate(() => _sampleNames());
    expect(!Object.keys(own).length, 'lane names reached the figure-wide names: ' + JSON.stringify(own));
    return `"${note.slice(0, 150)}…"; WT ${c.bars[0][0].toFixed(3)} ± ${c.bars[0][1].toFixed(3)}, R42P ${c.bars[1][0].toFixed(3)} ± ${c.bars[1][1].toFixed(3)} (truth 1.00 ± 0.15, 0.45 ± 0.05); key "${c.key}"`;
  });

  await step(T, '7.2 Replicate lanes by lane table: remove the chart (× in Images), type "WT, WT, WT, R42P, R42P, R42P" in a lane-table row, 📊 Chart these values → pooled at once, linked; a click on a cell with text edits it', async () => {
    const row = p.locator('#img-list .img-item').nth(await chartIdx());
    await L.toasts(T);
    await row.locator('button[title="Remove"]').click(); await p.waitForTimeout(600);
    const dt = await L.toasts(T);
    expect(await chartIdx() === -1, 'chart still there: ' + dt);
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(300);
    await openGel(0);
    await g.locator('button', { hasText: '⊞ Lane table…' }).click();
    await lt.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const cells = lt.locator('.lt-cell');
    await lt.locator('.lt-name').nth(0).fill('Parkin');
    await cells.nth(1).click(); await p.keyboard.type('WT, WT, WT, R42P, R42P, R42P'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const vals = await cells.evaluateAll(cs => cs.map(c => c.value));
    expect(vals.slice(1).join(',') === 'WT,WT,WT,R42P,R42P,R42P', 'row: ' + vals);
    await cells.nth(3).click(); await p.waitForTimeout(200);
    const v3 = await cells.nth(3).inputValue(), focused = await cells.nth(3).evaluate(c => c === document.activeElement);
    expect(v3 === 'WT' && focused, `a click on "WT" gave "${v3}", focused ${focused}`);
    await lt.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    await L.toasts(T);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1200);
    const t = await L.toasts(T);
    expect(/lanes named from the lane table — WT: Lane 2, Lane 3, Lane 4; R42P: Lane 5, Lane 6, Lane 7 pooled as one sample each \(mean ± SD with the points\)\. Linked/.test(t), t);
    const c = await chartNow();
    expect(c.link && c.cats.join(',') === 'WT,R42P' && c.bars.map(b => b[2]).join(',') === '3,3' && c.err === 'sd' && c.pts, JSON.stringify(c));
    await closeGel();
    return `removed: "${dt}"; toast "…${t.slice(t.indexOf('lanes named'), t.indexOf('lanes named') + 150)}…"; WT ${c.bars[0][0].toFixed(3)} ± ${c.bars[0][1].toFixed(3)}, R42P ${c.bars[1][0].toFixed(3)} ± ${c.bars[1][1].toFixed(3)}`;
  });

  await step(T, '11.5 Typing over a linked chart\'s numbers: "Apply unlinks…" with Undo my edit (puts the linked values back); typed again and applied, the chart is typed by hand', async () => {
    await openChartDlg();
    const ta = chartDlg.locator('#chart-data-ta');
    const d0 = await ta.inputValue();
    await ta.fill(d0.replace(/^(Lane 3\t)[\d.]+/m, '$10.9')); await p.waitForTimeout(500);
    const n1 = await linkNote();
    expect(/^⚠ You edited the data: Apply unlinks this chart from the densitometry of panel A — a re-analysis will no longer update it, and the chart, caption and compliance check will say it is typed by hand\. Undo my edit$/.test(n1), n1);
    await chartDlg.locator('#chart-link-note').locator('button', { hasText: 'Undo my edit' }).click(); await p.waitForTimeout(400);
    expect(await ta.inputValue() === d0 && /^Linked to the densitometry of panel A/.test(await linkNote()), 'Undo my edit did not put the linked values back');
    await ta.fill(d0.replace(/^(Lane 3\t)[\d.]+/m, '$10.9')); await p.waitForTimeout(500);
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const c = await chartNow();
    expect(!c.link && c.state === 'unlinked', JSON.stringify(c));
    await openChartDlg();
    const n2 = await linkNote();
    await chartDlg.locator('button', { hasText: /^Cancel$/ }).click(); await p.waitForTimeout(300);
    expect(/^⚠ Not linked: typed by hand and no longer linked to the densitometry of panel A/.test(n2) && /↻ Link again These are my own values$/.test(n2), n2);
    const drawn = await drawnOnScreen();
    expect(drawn.includes('⚠ typed values · not linked to panel A'), 'on screen: ' + drawn);
    return `"${n1.slice(0, 90)}…"; after Apply the dialog reads "${n2}"; on screen "${drawn.join(' | ')}"`;
  });

  await step(T, '11.6 ⇄ Replace image on the strip under a typed chart: the toast, the chart on the figure, the caption, ✓ Check journal compliance (Charts from densitometry ✗) and the package CSV all say the typed values are not current', async () => {
    await p.keyboard.press('Escape');
    const qa = await panelPoint(0, 0.75, 0.5);
    await p.mouse.click(qa.x, qa.y, { button: 'right' }); await p.waitForTimeout(300);
    await L.toasts(T);
    await L.pickFiles(T, p.locator('text=⇄ Replace image…').locator('visible=true').first(), [repA2]);
    await p.waitForTimeout(1500);
    const t = await L.toasts(T);
    expect(/a chart typed by hand from its densitometry no longer matches it — the chart says so; ↻ Link again in its dialog reads the new values/.test(t), t);
    const drawn = await p.evaluate(() => { const el = images.find(i => i && i.type === 'chart'); const T = []; el._chartKey = ''; _chartDraw(el, { rect() {}, line() {}, poly() {}, circle() {}, text(s) { T.push(String(s)); } }); return T.filter(x => /⚠/.test(x)); });
    // ux4 blot4-11: short enough for a one-column chart; the caption and compliance row name panel A
    expect(drawn.join('|') === '⚠ typed values — out of date', 'drawn: ' + drawn);
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(500);
    const cap = await p.locator('#caption-out').inputValue();
    expect(/Values entered by hand\. \[⚠ Not current: the densitometry of panel A has changed since these values were entered — check them before submitting\.\]/.test(cap), cap);
    const R = await check();
    const cr = rowOf(R, 'Charts from densitometry');
    expect(cr.icon === '✗' && /double-click it › ↻ Link again, or check the typed values/.test(cr.note), JSON.stringify(cr));
    await L.openSection(T, 'Export');
    const zf = await L.download(T, () => L.btn(T, '📦 Export submission package (ZIP)').click(), /\.zip$/, 120000);
    const csvName = L.zipList(zf).find(e => /^source-data\/C\.csv$/.test(e));
    const head = csvName ? L.zipRead(zf, csvName).toString('utf8').split('\n').find(l => /^# WARNING/.test(l)) || '' : '(no source-data/C.csv)';
    expect(/^# WARNING: Values entered by hand; typed by hand and no longer linked to the densitometry of panel A, which has changed since/.test(head), head);
    // ISSUES (round 3) "A typed-by-hand chart is not marked in its Images row or ⚙": evidence
    const ci = await chartIdx();
    const crow = p.locator('#img-list > .img-item').nth(ci);
    const rowTxt = (await crow.innerText()).replace(/\s+/g, ' ');
    await crow.locator('button', { hasText: '⚙' }).first().click(); await p.waitForTimeout(300);
    const setTxt = (await crow.innerText()).replace(/\s+/g, ' ');
    await crow.locator('button', { hasText: '⚙' }).first().click(); await p.waitForTimeout(200);
    expect(!/typed/i.test(rowTxt) && !/typed/i.test(setTxt), 'the Images row or ⚙ now says typed: ' + setTxt.slice(0, 300));   // ISSUES: still open
    T._typedRow = `Images row ${/typed/i.test(rowTxt) ? 'says' : 'does not say'} "typed"; its ⚙ ${/typed/i.test(setTxt) ? 'says' : 'does not say'} "typed"` + (/typed/i.test(setTxt) ? ` ("${(setTxt.match(/[^.]*typed[^.]*/i) || [''])[0].trim().slice(0, 140)}")` : '');
    return `${T._typedRow}; toast "…${t.slice(t.indexOf('a chart typed'))}"; on the chart "${drawn[0]}"; caption "…${cap.slice(cap.indexOf('Values entered'), cap.indexOf('Values entered') + 150)}"; compliance ✗ "${cr.note.slice(0, 60)}…"; ${csvName}: "${head.slice(0, 80)}…"`;
  });

  await step(T, '11.7 The chart\'s dialog › ↻ Link again reads the re-probe and links the chart again (These are my own values is the other choice)', async () => {
    await openChartDlg();
    expect(await chartDlg.locator('#chart-link-note').locator('button', { hasText: 'These are my own values' }).count() === 1, 'no "These are my own values"');
    await chartDlg.locator('#chart-link-note').locator('button', { hasText: /Link again/ }).click(); await p.waitForTimeout(500);
    const n = await linkNote();
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const c = await chartNow();
    expect(c.link && c.state === 'linked' && /^Linked to the densitometry of panel A/.test(n), JSON.stringify(c));
    expect(Math.abs(c.rows[1][1] - REP2[1]) < 0.05, 'lane 3 after the re-probe: ' + c.rows[1][1]);
    const R = await check();
    expect(rowOf(R, 'Charts from densitometry').icon === '✓', JSON.stringify(rowOf(R, 'Charts from densitometry')));
    return `lane 3 now ${(+c.rows[1][1]).toFixed(3)} (re-probe truth 1.4); WT ${c.bars[0][0].toFixed(3)} ± ${c.bars[0][1].toFixed(3)}; Charts from densitometry ✓`;
  });

  await step(T, '9.4 (second figure, Nature) Long lane names cut to fit fail Text size, whose "Widen A" button gives the strip the whole row', async () => {
    await L.cmdk(T, 'nature'); await p.waitForTimeout(800);
    await clickPanel(0);
    await L.cmdk(T, 'lane table');
    await lt.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const cells = lt.locator('.lt-cell');
    await cells.nth(1).click(); await p.keyboard.press('ControlOrMeta+a');
    await p.keyboard.type('Parkin WT, Parkin WT, Parkin WT, Parkin R42P, Parkin R42P, Parkin R42P'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    await lt.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click(); await p.waitForTimeout(800);
    const ts = rowOf(await readReport(), 'Text size');
    expect(ts.icon === '✗' && /drawn smaller than its table’s size to fit its lanes/.test(ts.note) && ts.buttons.includes('Widen A'), JSON.stringify(ts));
    await L.toasts(T);
    await p.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' }).locator('button', { hasText: 'Widen A' }).click(); await p.waitForTimeout(800);
    const wt = await L.toasts(T);
    const ts2 = rowOf(await readReport(), 'Text size');
    await p.keyboard.press('Escape');
    expect(/^Panel A now spans all \d columns, so its lanes are wider — Ctrl\+Z undoes it/.test(wt) && ts2.icon === '✓', wt + ' | ' + JSON.stringify(ts2));
    return `before: "${ts.note.slice(0, 90)}…"; Widen A → "${wt}"; after: "${ts2.note.slice(0, 90)}…"`;
  });

  // ---------------------------------------------------------------- A third figure: phospho / total (round 4)
  // pAKT and total AKT on their own blots, plus GAPDH. pAKT is normalised to total AKT with
  // Loading control › Another target (phospho/total): each lane is pAKT ÷ AKT of the paired lane.
  const PAKT = [0.3, 1, 0.6, 1.2, 0.2, 0.8], AKT = [0.6, 1, 1, 1, 0.5, 1];
  const PT = PAKT.map((v, k) => (v / AKT[k]) / (PAKT[1] / AKT[1]));          // relative to lane 3
  const pakt = I.blotTiff(f('pAKT_S473.tif'), { amounts: PAKT, tiltDeg: 0, seed: 31, bandY: 0.5 });
  const akt = I.blotTiff(f('AKT_total.tif'), { amounts: AKT, tiltDeg: 0, seed: 32, bandY: 0.5 });
  const gapdh = I.blotTiff(f('GAPDH.tif'), { amounts: [1, 1, 1, 1, 1, 1], tiltDeg: 0, seed: 33, bandY: 0.6 });
  await step(T, '3.7 (third figure) Phospho/total: pAKT\'s ⫼ Lanes & bands › Loading control = the total-AKT panel, Another target (phospho/total) → pAKT ÷ AKT per lane; 📊 Chart these values names it in the Y title, caption and Methods', async () => {
    await p.keyboard.press('Escape');
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(500);
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [pakt, akt, gapdh]);
    await p.waitForFunction(() => images.filter(Boolean).length === 3, null, { timeout: 20000 });
    await p.waitForTimeout(800); await dismissTip();
    const title = await openGel(0);
    expect(/panel A/.test(title), title);
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await g.locator('#gel-ladder-sizes').fill('75, 50, 37, 25');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    await g.locator('#gel-ref').selectOption({ label: 'lane 3' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc').selectOption({ label: 'panel B' }); await p.waitForTimeout(300);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Another target (phospho/total)' }); await p.waitForTimeout(1500);
    const t = await g.innerText();
    const note = (t.match(/Normalised to another target[^\n]*/) || [''])[0];
    expect(/^Normalised to another target, AKT_total \(panel B\) \(a phospho\/total ratio: each band ÷ that blot's band volume in the paired lane\), lanes paired by order .*It is no loading control: show one as well where the journal asks\./.test(note), 'note: ' + note);
    const head = t.split('\n').find(l => /^Lane\tBand/.test(l)).split('\t'); const col = head.indexOf('÷LC rel ref');
    const r = await tableRows();
    const got = [2, 3, 4, 5, 6, 7].map(l => { const row = r.find(x => x[0] === String(l) && x[1] === '1'); return row ? +row[col] : 0; });
    PT.forEach((v, k) => expect(Math.abs(got[k] - v) < 0.03 + 0.03 * v, `lane ${k + 2}: ${got[k]} vs ${v}`));
    await L.toasts(T);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1500);
    const ct = await L.toasts(T);
    expect(/^Charted 6 lanes × 1 panel: Band volume ÷ AKT_total, relative to lane 3;/.test(ct), 'chart toast: ' + ct);
    globalThis.__ptToast = ct;
    const y = await p.evaluate(() => images.find(i => i && i.type === 'chart').chart.axes.y.title);
    expect(y === 'Band volume ÷ AKT_total, relative to lane 3', 'Y title: ' + y);
    await closeGel();
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(600);
    const cap = await p.locator('#caption-out').inputValue();
    await btn(T, '✎ Write Methods paragraph').click(); await p.waitForTimeout(600);
    const meth = await p.evaluate(() => document.getElementById('methods-out').value);
    expect(/band volume ÷ AKT_total, relative to lane 3/.test(cap), 'caption: ' + cap);
    expect(/volumes were normalised to a second target, AKT_total \(panel B\), probed on its own blot \(each band divided by the summed band volume of the paired lane: a phospho\/total ratio\)/.test(meth), 'Methods: ' + meth);
    return `chart toast "${ct.slice(0, 260)}"; pAKT ÷ AKT rel. lane 3: ${got.map(v => v.toFixed(3)).join(' / ')} (truth ${PT.map(v => v.toFixed(2)).join(' / ')}); note "${note.slice(0, 120)}…"; Y title "${y}"`;
  });
  await step(T, '9.5 (third figure) Under EMBO J the Loading control row says pAKT is normalised to another target, not to a loading control; JBC sets no printed width and says so', async () => {
    await L.cmdk(T, 'embo'); await p.waitForTimeout(800);
    const lcr = rowOf(await check(), 'Loading control');
    expect(lcr.icon === 'ℹ' && /^A is normalised to another target, AKT_total \(panel B\) \(a phospho\/total ratio\), not to a loading control — EMBO J asks for the loading control on the same blot: show one for this blot as well/.test(lcr.note), JSON.stringify(lcr));
    await L.toasts(T);
    await L.cmdk(T, 'jbc'); await p.waitForTimeout(800);
    const jt = (await L.toasts(T)).split(' | ').find(x => /^JBC/.test(x)) || '';
    expect(/^JBC figure guide applied — no printed width set — JBC’s data-presentation page states none \(180 mm kept\): pick the column width from JBC’s author instructions under Export › Printed width/.test(jt), 'JBC toast: ' + jt);
    return `Loading control ℹ "${lcr.note.slice(0, 140)}…"; JBC toast "${jt.slice(0, 200)}"`;
  });


  // ---------------------------------------------------------------- A fourth figure: a doublet (round 5)
  // pERK1/2 over total ERK1/2 (another target), with GAPDH: the p44/p42 doublet is split in
  // the strong lanes and read as one band in the weak ones. Checks: the doublet counted one
  // way in every lane, strips named by row labels, a lane table of times naming the bars and
  // a line over time, a hand edit made again after ⇄ Replace, a replaced total blot measured
  // again by ↻ Update, and a typed Y title flagged when the normalisation changes.
  const dPERK = D.pERK(f('pERK1-2_T202-Y204.tif'), D.P1, { seed: 501 });
  const dERK = D.ERK(f('ERK1-2_total.tif'), { seed: 502, dy: 5 });
  const dGAPDH = D.GAPDH(f('GAPDH.tif'), { seed: 503, dy: -6 });
  const dERK2 = D.ERK(f('ERK1-2_total_reexposure.tif'), { seed: 602, dy: 9, gain: 1.3 });
  const dPERK2 = D.pERK(f('pERK1-2_reprobe.tif'), D.P2, { seed: 504, gain: 0.8, dy: 14, x0: 114 });
  const rel = (got, truth, tol) => truth.forEach((v, k) => expect(Math.abs(got[k] / v - 1) < tol, `lane ${k + 2}: ${(+got[k]).toFixed(3)} vs ${v.toFixed(3)}`));
  const chartCol = () => p.evaluate(() => images.find(i => i && i.type === 'chart').chart.data.rows.map(r => +r[1]));
  const banner = async () => (await g.locator('#gel-banner').innerText()).replace(/\s+/g, ' ');
  // Where a lane's row y (source px) is on the dialog's blot picture, for a real click there.
  const gelPoint = (li, y) => p.evaluate(([li, y]) => { const cv = document.getElementById('gel-canvas'), r = cv.getBoundingClientRect(), a = images[_gelUI.idx].gelAnalysis, F = a.frame, k = _gelUI.k * (r.width / cv.width || 1), Ln = a.lanes[li];
    return { x: r.left + ((Ln.x0 + Ln.x1) / 2 - F.sx) * k, y: r.top + (y - F.sy) * k }; }, [li, y]);
  const doubletRows = () => p.evaluate(() => { const a = images[0].gelAnalysis, s = a.doubletSites[0], F = a.frame; return { y1: F.sy + s.rf1 * F.sh, y2: F.sy + s.rf2 * F.sh, sy: F.sy }; });
  const dTitle = () => p.evaluate(() => images.find(i => i && i.type === 'chart').chart.axes.y.title);

  await step(T, 'D.1 (fourth figure) ✕ New, add pERK1/2, total ERK1/2 and GAPDH; Arrange › Columns 1, Rows 4; tick Row labels and type pERK1/2, ERK1/2, GAPDH (chart row empty); clear the letters of strips 2–3', async () => {
    await p.keyboard.press('Escape');
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(500);
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [dPERK, dERK, dGAPDH]);
    await p.waitForFunction(() => images.filter(Boolean).length === 3 && images.every(im => im.img && im.img.complete), null, { timeout: 120000 });
    await p.waitForTimeout(800); await dismissTip();
    await L.openSection(T, 'Arrange');
    for (const [lab, v] of [['Columns', '1'], ['Rows', '4']]) { const i = p.getByLabel(lab, { exact: true }); await i.fill(v); await i.press('Tab'); }
    await p.getByLabel('Rows hug their panels').check();
    if (await p.locator('#show-col-labels').isChecked()) await p.locator('#show-col-labels').uncheck();
    await p.locator('#show-row-labels').check(); await p.waitForTimeout(300);
    const rows = p.locator('#row-label-inputs input');
    const names = ['pERK1/2', 'ERK1/2', 'GAPDH', ''];
    for (let k = 0; k < 4; k++) { await rows.nth(k).fill(names[k]); await rows.nth(k).press('Tab'); }
    const boxes = p.locator('#img-list .img-label-input');
    for (const k of [1, 2]) { await boxes.nth(k).fill(''); await boxes.nth(k).press('Tab'); }
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#row-label-inputs input')].map(i => i.value), labs: images.map(i => i.label || '·').join(''), who: [1, 2].map(i => _panelWho(images[i])) }));
    expect(st.rows.join('|') === 'pERK1/2|ERK1/2|GAPDH|' && st.labs === 'A··', JSON.stringify(st));
    expect(st.who.join('|') === 'the ERK1/2 strip|the GAPDH strip', 'strips named ' + st.who);
    return `row labels ${st.rows.filter(Boolean).join(', ')}; letters ${st.labs}; the unlettered strips are "${st.who.join('", "')}"`;
  });

  await step(T, 'D.2 Click strip A, ⌘K "densitometry": ladder lane 1 "75, 50, 37" Fit, reference lane 2, Loading control = the ERK1/2 strip, Another target → the doublet line says it is counted as one band (both summed) in every lane', async () => {
    const title = await openGel(0);
    expect(/panel A/.test(title), title);
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await g.locator('#gel-ladder-sizes').fill('75, 50, 37');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    await g.locator('#gel-ref').selectOption({ label: 'lane 2' }); await p.waitForTimeout(300);
    const lcOpts = await g.locator('#gel-lc option').allInnerTexts();
    await g.locator('#gel-lc').selectOption({ index: lcOpts.findIndex(o => /ERK/.test(o)) }); await p.waitForTimeout(300);
    await L.toasts(T);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Another target (phospho/total)' }); await p.waitForTimeout(1500);
    const t = await L.toasts(T);
    const b = await banner();
    const dl = (b.match(/The doublet at .*? in every lane[^.]*\./) || [''])[0];
    expect(/^The doublet at 4\d\.\d–4\d\.\d kDa was split into two bands in lanes [\d–, and]+ and read as one band in lanes [\d–, and]+ — counted as one band \(both summed\) in every lane\.$/.test(dl), 'doublet line: ' + b.slice(0, 600));
    expect(await g.locator('#gel-banner .gel-doublet-one').isChecked(), 'Count the doublet as one band not ticked');
    expect(/doublet, both bands/.test(await g.locator('#gel-table').innerText()), 'no "doublet, both bands" in the table');
    const band = await g.locator('#gel-chart-band option:checked').innerText();
    expect(/a doublet: both bands summed in every lane/.test(band), 'Band to chart: ' + band);
    return `lc options ${lcOpts.join(' | ')}; "${dl}"; "${band}"; toast "${t.slice(0, 200)}"`;
  });

  await step(T, 'D.3 Untick "Count the doublet as one band": two bands in every lane; delete one half in lane 7 (click it on the blot, ✕ Delete band) → lane 7 is named; ✓ These lanes are right clears it; ↶ Undo ×3 goes back to one band', async () => {
    await g.locator('#gel-banner .gel-doublet-one').uncheck(); await p.waitForTimeout(1500);
    const b2 = await banner();
    expect(/counted as two bands in every lane/.test(b2), 'unticked: ' + b2.slice(0, 500));
    const R = await doubletRows();
    await g.locator('#gel-canvas').scrollIntoViewIfNeeded();
    const q = await gelPoint(6, R.y1); await p.mouse.click(q.x, q.y); await p.waitForTimeout(400);
    await g.locator('button', { hasText: '✕ Delete band' }).click(); await p.waitForTimeout(1000);
    const b3 = await banner();
    expect(/lane 7 holds a different number of bands there — check it on the lane profile/.test(b3), 'after the delete: ' + b3.slice(0, 600));
    await closeGel();
    const cr = rowOf(await check(), 'Densitometry');
    expect(/lane 7 holds a different number of bands at the doublet/.test(cr.note), 'compliance: ' + JSON.stringify(cr));
    await clickPanel(0); await L.cmdk(T, 'densitometry'); await g.waitFor({ state: 'visible' }); await p.waitForTimeout(600);
    await g.locator('#gel-banner button', { hasText: '✓ These lanes are right' }).click(); await p.waitForTimeout(800);
    const b4 = await banner();
    expect(!/different number of bands/.test(b4), 'still named: ' + b4.slice(0, 400));
    for (let k = 0; k < 3; k++) { await g.locator('button', { hasText: '↶ Undo' }).click(); await p.waitForTimeout(900); }
    const b5 = await banner();
    expect(/counted as one band \(both summed\) in every lane/.test(b5) && await g.locator('#gel-banner .gel-doublet-one').isChecked(), 'after undo: ' + b5.slice(0, 400));
    return `unticked: "${(b2.match(/The doublet at .*? in every lane[^.]*\./) || [''])[0]}"; one half deleted: "…${(b3.match(/lane 7 holds[^.]*/) || [''])[0]}"; compliance "${cr.note.slice(0, 160)}…"; ✓ These lanes are right → not named; ↶ Undo ×3 → one band again`;
  });

  await step(T, 'D.4 ⊞ Lane table…: + Row "EGF", times typed with commas (0 min ×3 … 60 min ×3); 📊 Chart these values pools them (no n.d. in the toast); pERK ÷ ERK matches truth; the Y title names the ERK1/2 strip', async () => {
    await g.locator('button', { hasText: '⊞ Lane table…' }).click();
    await lt.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    if (await lt.locator('.lt-name').count() === 0) { await lt.locator('button', { hasText: '+ Row' }).click(); await p.waitForTimeout(300); }
    await lt.locator('.lt-name').nth(0).fill('EGF'); await lt.locator('.lt-name').nth(0).press('Tab');
    const times = ['0 min', '5 min', '15 min', '30 min', '60 min'].flatMap(t => [t, t, t]).join(', ');
    const cells = lt.locator('.lt-cell');
    await cells.nth(1).click(); await p.keyboard.type(times); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    const vals = await cells.evaluateAll(cs => cs.map(c => c.value));
    expect(vals.slice(1, 16).join(',') === times.replace(/, /g, ','), 'row: ' + vals.join(','));
    await lt.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(300);
    await L.toasts(T);
    await g.locator('button', { hasText: '📊 Chart these values' }).click(); await p.waitForTimeout(1500);
    const t = await L.toasts(T);
    expect(/^Charted 15 lanes/.test(t) && /Linked/.test(t), t);
    expect(!/n\.d\./.test(t), 'n.d. said with no lane n.d.: ' + t);          // ISSUES: n.d. only when a lane is n.d.
    rel(await chartCol(), D.TRUTH, 0.06);
    const c = await chartNow();
    expect(c.cats.join(',') === '0 min,5 min,15 min,30 min,60 min' && c.bars.every(b => b[2] === 3), JSON.stringify(c.cats) + ' ' + JSON.stringify(c.bars));
    const y = await dTitle();
    expect(y === 'Band volume ÷ ERK1/2, relative to lane 2', 'Y title: ' + y);
    await closeGel();
    return `toast "${t.slice(0, 330)}"; pERK/ERK ${(await chartCol()).map(v => v.toFixed(2)).join(' ')} (truth ${D.TRUTH.map(v => v.toFixed(2)).join(' ')}); bars ${c.cats.join(', ')} (n = 3 each); Y title "${y}"`;
  });

  await step(T, 'D.5 A later lane-table rename reaches the chart: "60 min" → "1 h" in the last three cells renames the bar', async () => {
    await clickPanel(0);
    await L.cmdk(T, 'lane table');
    await lt.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    const cells = lt.locator('.lt-cell');
    for (const k of [13, 14, 15]) { await cells.nth(k).click(); await p.keyboard.press('ControlOrMeta+a'); await p.keyboard.type('1 h'); await p.keyboard.press('Tab'); await p.waitForTimeout(200); }
    await lt.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(500);
    const c = await chartNow();
    expect(c.cats.join(',') === '0 min,5 min,15 min,30 min,1 h' && c.link, JSON.stringify(c.cats));
    return 'bars: ' + c.cats.join(', ');
  });

  await step(T, 'D.6 Chart dialog › Chart type Line: the times are the x axis (0, 5, 15, 30, 60 min; 1 h read as 60), mean ± SD of 3, still linked', async () => {
    await openChartDlg();
    await chartDlg.locator('#chart-kind').selectOption({ label: 'Line' }); await p.waitForTimeout(500);
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const s = await p.evaluate(() => { const el = images.find(i => i && i.type === 'chart'); el._chartKey = ''; el._chartStat = null; const S = _chartStatsCached(el);
      return { pts: S.series[0].points.map(q => [q.x, +q.y.toFixed(2), q.n]), empty: _chartEmptyWhy(el.chart, true), link: !!el.chart.link, state: _chartSourceState(el).state, x: el.chart.axes.x.title }; });
    expect(s.pts.map(q => q[0]).join(',') === '0,5,15,30,60' && s.pts.every(q => q[2] === 3) && !s.empty && s.link, JSON.stringify(s));
    return `points ${JSON.stringify(s.pts)}; X title "${s.x}"; ${s.state}`;
  });

  await step(T, 'D.7 Hand edits: a band added (click an empty stretch of lane 3) and lane 5\'s edge dragged; ⇄ Replace image… on strip A with the re-probe; ↻ Update says the added band was made again and the lane edge NOT carried over; the dialog, chart and compliance list it until ✓ Checked; the chart follows the re-probe', async () => {
    const title = await openGel(0);
    const R = await doubletRows();
    await g.locator('#gel-canvas').scrollIntoViewIfNeeded();
    const q = await gelPoint(2, R.sy + 300); await p.mouse.click(q.x, q.y); await p.waitForTimeout(1000);
    const man = await p.evaluate(() => images[0].gelAnalysis.lanes[2].bands.filter(b => b.manual).length);
    expect(man === 1, 'bands added by hand in lane 3: ' + man);
    // drag lane 5's right edge 4 source px outwards (one drag, one undo step)
    const e = await p.evaluate(() => { const cv = document.getElementById('gel-canvas'), r = cv.getBoundingClientRect(), a = images[_gelUI.idx].gelAnalysis, F = a.frame, k = _gelUI.k * (r.width / cv.width || 1), Ln = a.lanes[4];
      return { x: r.left + (Ln.x1 - F.sx) * k, y: r.top + (F.sh * 0.15) * k, d: 4 * k, x1: Ln.x1 }; });
    await p.mouse.move(e.x, e.y); await p.mouse.down(); await p.mouse.move(e.x + e.d / 2, e.y); await p.mouse.move(e.x + e.d, e.y); await p.mouse.up(); await p.waitForTimeout(1000);
    const lane5 = await p.evaluate(() => { const L = images[0].gelAnalysis.lanes[4]; return { manual: !!L.manual, x1: L.x1 }; });
    expect(lane5.manual && lane5.x1 > e.x1, 'lane 5 edge not set by hand: ' + JSON.stringify(lane5) + ' was ' + e.x1);
    await closeGel();
    await p.keyboard.press('Escape');
    const qa = await panelPoint(0, 0.75, 0.5);
    await p.mouse.click(qa.x, qa.y, { button: 'right' }); await p.waitForTimeout(300);
    await L.toasts(T);
    await L.pickFiles(T, p.locator('text=⇄ Replace image…').locator('visible=true').first(), [dPERK2]);
    await p.waitForFunction(() => /reprobe/.test(images[0].name) && images[0].img && images[0].img.complete, null, { timeout: 60000 });
    await p.waitForTimeout(1000);
    const rt = await L.toasts(T);
    await openChartDlg();
    await L.toasts(T);
    await chartDlg.locator('#chart-link-note').locator('button', { hasText: '↻ Update from densitometry' }).click(); await p.waitForTimeout(1500);
    const t = await L.toasts(T);
    expect(/1 band edit made by hand was made again \(lane 3 band added at [\d.]+ kDa\)/.test(t), 'update toast: ' + t);
    expect(/⚠ check before submitting: panel A: hand edits were not carried over to the new image \(lane 5's edges, set by hand\) — lane 5 is measured as detected/.test(t), 'not-carried-over not in the toast: ' + t);
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const v = await p.evaluate(() => images.find(i => i && i.type === 'chart').chart.data.rows.map(r => +r[1]));
    rel(v, D.TRUTH2, 0.1);
    const st = await p.evaluate(() => _chartSourceState(images.find(i => i && i.type === 'chart')));
    expect(st.state === 'check' && /not carried over/.test(st.why), JSON.stringify(st));
    const drawn = await drawnOnScreen();
    expect(drawn.includes('⚠ check the densitometry'), 'drawn: ' + drawn);
    const cr = rowOf(await check(), 'Charts from densitometry');
    expect(cr.icon === '✗' && /not carried over/.test(cr.note), JSON.stringify(cr));
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(500);
    const cap = await p.locator('#caption-out').inputValue();
    expect(/\[⚠ Check before submitting: [^\]]*not carried over/.test(cap), 'caption: ' + cap.slice(0, 400));
    await openGel(0);
    const b = await banner();
    expect(/⚠ Hand edits NOT carried over to the new image: lane 5's edges, set by hand/.test(b), 'dialog: ' + b.slice(0, 500));
    await g.locator('#gel-banner button', { hasText: '✓ Checked' }).click(); await p.waitForTimeout(800);
    await closeGel();
    const st2 = await p.evaluate(() => _chartSourceState(images.find(i => i && i.type === 'chart')).state);
    expect(st2 === 'linked', 'after ✓ Checked: ' + st2);
    return `${title}; replace toast "${rt.slice(0, 120)}…"; Update → "${t.slice(0, 420)}"; on the chart "${drawn.join(' | ')}"; compliance ✗ "${cr.note.slice(0, 200)}"; dialog "${(b.match(/⚠ Hand edits NOT[^✓]*/) || [''])[0].slice(0, 200)}"; ✓ Checked → ${st2}; re-probe ${v.map(x => x.toFixed(2)).join(' ')} (truth ${D.TRUTH2.map(x => x.toFixed(2)).join(' ')})`;
  });

  await step(T, 'D.8 ⇄ Replace image… on the total ERK1/2 strip: the toast says panel A is normalised to it; ↻ Update from densitometry measures it again and pairs it again; the bars come back, current', async () => {
    await p.keyboard.press('Escape');
    const qb = await panelPoint(1, 0.75, 0.5);
    await p.mouse.click(qb.x, qb.y, { button: 'right' }); await p.waitForTimeout(300);
    await L.toasts(T);
    await L.pickFiles(T, p.locator('text=⇄ Replace image…').locator('visible=true').first(), [dERK2]);
    await p.waitForFunction(() => /reexposure/.test(images[1].name) && images[1].img && images[1].img.complete, null, { timeout: 60000 });
    await p.waitForTimeout(1000);
    const rt = await L.toasts(T);
    expect(/panel A is normalised to it — ↻ Update from densitometry in the linked chart measures it again and pairs it again/.test(rt), 'replace toast: ' + rt);
    await openChartDlg();
    const n = await linkNote();
    await L.toasts(T);
    await chartDlg.locator('#chart-link-note').locator('button', { hasText: '↻ Update from densitometry' }).click(); await p.waitForTimeout(1500);
    const t = await L.toasts(T);
    expect(/the ERK1\/2 strip, the other target panel A is divided by, was measured again on its new image and paired again/.test(t), 'update toast: ' + t);
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const v = await p.evaluate(() => images.find(i => i && i.type === 'chart').chart.data.rows.map(r => +r[1]));
    rel(v, D.TRUTH2, 0.1);
    const cr = rowOf(await check(), 'Charts from densitometry');
    expect(cr.icon === '✓' && /current with it/.test(cr.note), JSON.stringify(cr));
    return `toast "…${rt.slice(rt.indexOf('panel A is normalised'), rt.indexOf('panel A is normalised') + 140)}"; note "${n.slice(0, 200)}"; Update → "${t.slice(0, 260)}"; values ${v.map(x => x.toFixed(2)).join(' ')}`;
  });

  await step(T, 'D.9 A typed Y title: "pERK1/2 / total ERK1/2", then Loading control → GAPDH, Loading band(s): the toast, the chart dialog and compliance say the title was typed for the old values; ✓ Y title is right clears it', async () => {
    await openChartDlg();
    await chartDlg.locator('#chart-ytitle').fill('pERK1/2 / total ERK1/2'); await chartDlg.locator('#chart-ytitle').press('Tab');
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    await openGel(0);
    const lcOpts = await g.locator('#gel-lc option').allInnerTexts();
    await L.toasts(T);
    await g.locator('#gel-lc').selectOption({ index: lcOpts.findIndex(o => /GAPDH/.test(o)) }); await p.waitForTimeout(800);
    await g.locator('#gel-lc-mode').selectOption({ label: 'Loading band(s)' }); await p.waitForTimeout(1500);
    const t = await L.toasts(T);
    await closeGel();
    expect(/Linked chart: ⚠ its Y title “pERK1\/2 \/ total ERK1\/2” was typed for “Band volume ÷ ERK1\/2, relative to lane 2” — the values are now “Band volume ÷ the loading control, relative to lane 2”; edit the title, or ✓ Y title is right in the chart's dialog/.test(t), 'toast: ' + t);
    expect(await dTitle() === 'pERK1/2 / total ERK1/2', 'title changed: ' + await dTitle());
    const cr = rowOf(await check(), 'Charts from densitometry');
    expect(cr.icon === '✗' && /Y title “pERK1\/2 \/ total ERK1\/2” was typed for/.test(cr.note), JSON.stringify(cr));
    await openChartDlg();
    const n = await linkNote();
    expect(/was typed for/.test(n), 'chart dialog: ' + n);
    await chartDlg.locator('#chart-link-note').locator('button', { hasText: '✓ Y title is right' }).click(); await p.waitForTimeout(400);
    await chartDlg.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(800);
    const cr2 = rowOf(await check(), 'Charts from densitometry');
    expect(cr2.icon === '✓', JSON.stringify(cr2));
    return `toast "…${t.slice(t.lastIndexOf('Linked chart:'), t.lastIndexOf('Linked chart:') + 330)}"; compliance ✗ "${cr.note.slice(0, 200)}"; dialog "${n.slice(0, 200)}"; after ✓ Y title is right: ${cr2.icon}`;
  });

  await L.finish(T);
})();
