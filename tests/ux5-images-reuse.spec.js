// @ts-check
// Usability round 5 — 🧬 Check against other figures, given FigureLab's own exported
// panels (newcomer5-09). A figure package's panels/*.png are the very pictures of the
// figure, but drawn: a micrograph at about 0.4× with its letter chip and FigureLab's scale
// bar on it, a phone photo of a plate at about 0.15×. The check said "✓ No reuse found"
// for both — the photo was outside the 0.45–2.2× it searched, and the chip and bar on a
// sparse field pulled the micrograph's score under the bar. These tests export a real
// package from the app, feed its panels back, and expect both found; a pair whose sizes
// are further apart than the search is named as not checked, never passed with a ✓.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');
const { GEN, GEN_REAL } = require('./dup-gen');

const HELPERS = `
  // A Gram-stain-like field: short pink rods on a light beige background, sensor noise.
  window.__rods = (seed, W, H, n) => {
    const r = __rng(seed), c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(228,222,210)'; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgb(205,70,110)';
    for (let q = 0; q < n; q++) { x.save(); x.translate(r() * W, r() * H); x.rotate(r() * 3.14);
      x.fillRect(-W / 80, -W / 320, W / 40, W / 160); x.restore(); }
    const im = x.getImageData(0, 0, W, H), nr = __rng(seed * 7 + 3);
    for (let i = 0; i < im.data.length; i += 4) { const e = 5 * __gauss(nr);
      for (let k = 0; k < 3; k++) im.data[i + k] = Math.max(0, Math.min(255, im.data[i + k] + e)); }
    x.putImageData(im, 0, 0); return c;
  };
  // A phone photo of a plate: 4032 × 3024, a dish with plaques, fine noise at full size.
  window.__photo = (seed) => {
    const p = __plate(seed, 1008, 756, { n: 80, rad: 6 });
    const c = document.createElement('canvas'); c.width = 4032; c.height = 3024;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(p, 0, 0, 4032, 3024);
    const im = x.getImageData(0, 0, 4032, 3024), nr = __rng(seed * 5 + 1);
    for (let i = 0; i < im.data.length; i += 4) { const e = 3 * __gauss(nr);
      for (let k = 0; k < 3; k++) im.data[i + k] = Math.max(0, Math.min(255, im.data[i + k] + e)); }
    x.putImageData(im, 0, 0); return c;
  };
  window.__commitFile = async (canvas, name) => { const f = await __pngFile(canvas, name);
    const n0 = images.filter(Boolean).length; await addFiles([f]);
    for (let t = 0; t < 200 && !(images.filter(Boolean).length > n0 && images.filter(Boolean).every(im => im.img && im.img.complete && im.img.naturalWidth)); t++) await new Promise(r => setTimeout(r, 25)); };
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
  // Figure 1 — the micrograph (calibrated, its bar drawn, letters on) and the photo — as
  // a submission package; its panels/*.png as Files. Then a new figure is started.
  window.__fig1Panels = async () => {
    window.__M = __rods(11, 1600, 1200, 70); window.__P = __photo(5);
    await __commitFile(__M, 'WT_gram_100x_01.png'); await __commitFile(__P, 'IMG_5531.png');
    const m = images.find(im => im && im.name === 'WT_gram_100x_01.png');
    m.umPerPx = 0.0625; m.sbOn = true; m.sbUm = 10; m.sbUnit = 'µm';
    sv('cols', 2); sv('rows', 1); onLayoutChange(); render();
    const z = await _captureDownload(() => exportSubmissionPackage());
    const files = [];
    for (const e of await __zip(z.data)) if (/^panels\\/.*\\.png$/.test(e.name))
      files.push(new File([e.data], e.name.split('/')[1], { type: 'image/png' }));
    _resetFigureState(); images.length = 0; render();
    return files;
  };
  window.__crossRun = async (files) => {
    openCrossFigureCheck(); await _xdAddFiles(files); await _xdStart();
    const r = _reuse.lastRun;
    return { findings: r.findings.map(f => ({ a: f.a, b: f.b, s: f.s, desc: f.desc })), alike: r.alike.length, pairs: r.pairs,
      txt: document.getElementById('xdup-results').textContent.replace(/\\s+/g, ' '),
      pass: [...document.querySelectorAll('#xdup-results .cc-row.cc-pass')].some(e => /No reuse found/.test(e.textContent)),
      row: _reuseComplianceRow(), report: _reuseReportText() };
  };
`;

async function setup(page) {
  const errors = await loadApp(page);
  await page.addScriptTag({ content: GEN });
  await page.addScriptTag({ content: GEN_REAL });
  await page.addScriptTag({ content: HELPERS });
  await page.evaluate(() => { images.length = 0; });
  return errors;
}

test('newcomer5-09: a figure package\'s own panels — the micrograph with its letter chip and drawn bar, the phone photo at ~0.15× — are matched to their source images', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const files = await __fig1Panels();
    // Figure 2 uses the same two pictures as its panels A and B.
    await __commitFile(__M, 'WT_gram_100x_01.png'); await __commitFile(__P, 'IMG_5531.png'); render();
    const out = await __crossRun(files);
    out.names = files.map(f => f.name); out.sizes = await Promise.all(files.map(async f => { const b = await createImageBitmap(f); return [b.width, b.height]; }));
    return out;
  });
  expect(r.names).toEqual(['panel_1_A.png', 'panel_2_B.png']);
  // the package's panels are much smaller than their sources: the photo below 0.45×
  expect(r.sizes[1][0] / 4032).toBeLessThan(0.3);
  const fA = r.findings.find(f => f.a === 'A' && f.b === 'panel_1_A.png');
  const fB = r.findings.find(f => f.a === 'B' && f.b === 'panel_2_B.png');
  expect(fA, 'the micrograph under its letter chip and scale bar: ' + r.txt).toBeTruthy();
  expect(fB, 'the photo at its export scale: ' + r.txt).toBeTruthy();
  expect(Math.abs(fA.s - r.sizes[0][0] / 1600)).toBeLessThan(0.03);
  expect(Math.abs(fB.s - r.sizes[1][0] / 4032)).toBeLessThan(0.02);
  expect(fB.desc).toMatch(/the whole image, 0\.\d\d× scale/);
  // nothing else: A is not B's copy
  expect(r.findings.filter(f => !((f.a === 'A' && f.b === 'panel_1_A.png') || (f.a === 'B' && f.b === 'panel_2_B.png')))).toEqual([]);
  expect(r.pass).toBe(false);
  expect(r.txt).not.toMatch(/✓ ?No reuse found/);
  expect(r.row.ok).toBe(false);
  expect(errors).toEqual([]);
});

test('newcomer5-09: other figures\' exported panels of DIFFERENT pictures stay clean — overlays are not a licence to match', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const files = await __fig1Panels();
    // Figure 2: another field of the same strain and another plate — not reuse.
    await __commitFile(__rods(12, 1600, 1200, 70), 'WT_gram_100x_02.png'); await __commitFile(__photo(6), 'IMG_5540.png'); render();
    return await __crossRun(files);
  });
  expect(r.pairs).toBe(4);
  expect(r.findings, r.txt).toEqual([]);
  expect(r.txt).toMatch(/No reuse found/);
  expect(r.row.ok).toBe(true);
  expect(errors).toEqual([]);
});

test('newcomer5-09: a pair whose sizes are further apart than the searched scales is named "not checked at its scale", not passed with a ✓', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const P = __photo(5);
    await __commitFile(P, 'IMG_5531.png'); render();
    // a thumbnail of the photo at 0.06× (242 × 181 px): a whole copy that small is not searched
    const t = document.createElement('canvas'); t.width = 242; t.height = 181;
    const x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(P, 0, 0, 242, 181);
    return await __crossRun([await __pngFile(t, 'thumb.png')]);
  });
  expect(r.pairs).toBe(1);
  expect(r.txt).toMatch(/1 pair was not checked at its scale — the other image is outside 0\.1–10× the panel's size/);
  expect(r.txt).toMatch(/panel A ↔ thumb\.png \(0\.060×\)/);
  expect(r.pass).toBe(false);                                  // no ✓
  expect(r.txt).toMatch(/No reuse found among the pairs checked at their scale, but 1 pair was not checked at its scale/);
  expect(r.row.ok).toBe(false); expect(r.row.warn).toBe(true);
  expect(r.row.note).toMatch(/not checked at its scale/);
  expect(r.report).toMatch(/NOT CHECKED AT THIS SCALE: 1 pair was not checked/);
  expect(r.report).toMatch(/No reuse found among the pairs checked at their scale\./);
  expect(errors).toEqual([]);
});
