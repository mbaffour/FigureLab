// @ts-check
// Image reuse across figures, and the scale-tolerant within-figure pass.
//
// Journals screen whole papers for the same micrograph or blot in two figures, flipped,
// rotated, re-scaled or cropped differently. These tests build images whose relationship
// is known exactly — a seeded texture of smooth cells and blobs, then a copy made by the
// browser's own canvas transforms — and assert the check finds every true reuse, names
// its transform, measures its scale and outlines its region, and stays silent on
// different images and on featureless ones, saying what it did not compare.
//
// Every test here fails without the change: the functions and the dialog it drives
// (_xdRun, openCrossFigureCheck, _reuse, _reuseComplianceRow, the scale section of the
// duplication report) do not exist before it, and the existing check compares at one
// scale only and has no decisions.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// In-page generators: deterministic LCG textures (no Math.random) and exact transforms.
const GEN = `
window.__mkTex = function(seed, w, h){
  let s = seed >>> 0;
  const rnd = () => (s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const cell = 24, gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = [];
  for (let i = 0; i < gw * gh; i++) g.push(rnd());
  const im = x.createImageData(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const fx = xx / cell, fy = yy / cell, x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    const v = (g[y0*gw+x0]*(1-ax) + g[y0*gw+x0+1]*ax)*(1-ay) + (g[(y0+1)*gw+x0]*(1-ax) + g[(y0+1)*gw+x0+1]*ax)*ay;
    const i = (yy * w + xx) * 4, t = 40 + v * 120;
    im.data[i] = im.data[i+1] = im.data[i+2] = t; im.data[i+3] = 255;
  }
  x.putImageData(im, 0, 0);
  for (let b = 0, nb = Math.round(w * h / 2500); b < nb; b++) {
    const r = 3 + rnd() * 14, cx = rnd() * w, cy = rnd() * h, l = Math.round(rnd() * 255);
    x.fillStyle = 'rgb(' + l + ',' + l + ',' + l + ')'; x.beginPath();
    x.ellipse(cx, cy, r, r * (0.4 + rnd()), rnd() * 3, 0, 7); x.fill();
  }
  return c;
};
// k: 0-3 clockwise quarter turns, +4 = mirrored left-right first. Built with canvas
// transforms, independently of the app's own mapping, so the NAMES are checked too.
window.__tf = function(src, k, scale){
  const W = src.width, H = src.height, odd = k & 1, Wk = odd ? H : W, Hk = odd ? W : H;
  const c = document.createElement('canvas'); c.width = Math.round(Wk * scale); c.height = Math.round(Hk * scale);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.scale(c.width / Wk, c.height / Hk);
  const r = k & 3;
  if (r === 1) { x.translate(H, 0); x.rotate(Math.PI / 2); }
  else if (r === 2) { x.translate(W, H); x.rotate(Math.PI); }
  else if (r === 3) { x.translate(0, W); x.rotate(-Math.PI / 2); }
  if (k >= 4) { x.translate(W, 0); x.scale(-1, 1); }
  x.drawImage(src, 0, 0);
  return c;
};
window.__crop = function(src, sx, sy, w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, sx, sy, w, h, 0, 0, w, h); return c; };
window.__flat = function(kind, w, h, seed){
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  if (kind === 'blank') { x.fillStyle = '#808080'; x.fillRect(0, 0, w, h); }
  else if (kind === 'saturated') { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); }
  else { const im = x.createImageData(w, h); let s = seed >>> 0;
    for (let i = 0; i < im.data.length; i += 4) { s = (1664525 * s + 1013904223) >>> 0; const v = s >>> 24; im.data[i] = im.data[i+1] = im.data[i+2] = v; im.data[i+3] = 255; }
    x.putImageData(im, 0, 0); }
  return c;
};
// A panel of THIS figure, through the app's real import path.
window.__commit = function(canvas, name){
  const u = canvas.toDataURL('image/png');
  return new Promise(res => { const im = new Image(); im.onload = () => { _commitImage(im, u, name); res(); }; im.src = u; });
};
window.__others = function(list){ return list.map(([label, c]) => ({ label, fig: label, kind: 'file', load: async () => ({ src: c }) })); };
window.__pngFile = function(canvas, name){ return new Promise(r => canvas.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png')); };
`;

async function setup(page) {
  const errors = await loadApp(page);
  await page.addScriptTag({ content: GEN });
  await page.evaluate(() => { images.length = 0; });
  return errors;
}

test('an identical copy and each of the 8 flips/rotations are found and named correctly', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const P = __mkTex(7, 360, 240);
    await __commit(P, 'p.png'); render();
    const others = __others([0, 1, 2, 3, 4, 5, 6, 7].map(k => ['k' + k, __tf(P, k, 1)]));
    const res = await _xdRun(_xdThisPanels(), others, {});
    return { n: res.findings.length, compared: res.compared,
      f: res.findings.map(f => ({ b: f.b.label, k: f.k, name: _XD_TF[f.k], s: f.s, score: f.score, desc: _xdDescribe(f, 'A') })) };
  });
  expect(r.compared).toBe(8);
  expect(r.n).toBe(8);                                    // one finding per copy, no extras
  const expectName = ['same orientation', 'rotated 90° clockwise', 'rotated 180°', 'rotated 90° anticlockwise',
    'mirrored left–right', 'mirrored, then rotated 90° clockwise', 'flipped top–bottom', 'mirrored, then rotated 90° anticlockwise'];
  for (let k = 0; k < 8; k++) {
    const f = r.f.find(x => x.b === 'k' + k);
    expect(f, 'copy k' + k).toBeTruthy();
    expect(f.k).toBe(k);
    expect(f.name).toBe(expectName[k]);
    expect(f.score).toBeGreaterThan(0.95);
    expect(Math.abs(f.s - 1)).toBeLessThan(0.03);
  }
  expect(r.f.find(x => x.b === 'k0').desc).toBe('identical image');
  expect(r.f.find(x => x.b === 'k6').desc).toContain('flipped top–bottom');
  expect(errors).toEqual([]);
});

test('re-scaled copies (0.6× and 1.7×, also flipped) are found with the scale within 10%', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const P = __mkTex(11, 400, 300);
    await __commit(P, 'p.png'); render();
    const others = __others([['s06', __tf(P, 0, 0.6)], ['s17', __tf(P, 0, 1.7)], ['s06k5', __tf(P, 5, 0.6)], ['s17k3', __tf(P, 3, 1.7)]]);
    const res = await _xdRun(_xdThisPanels(), others, {});
    return res.findings.map(f => ({ b: f.b.label, k: f.k, s: f.s, score: f.score, desc: _xdDescribe(f, 'panel A') }));
  });
  const want = { s06: [0, 0.6], s17: [0, 1.7], s06k5: [5, 0.6], s17k3: [3, 1.7] };
  for (const [lbl, [k, s]] of Object.entries(want)) {
    const f = r.find(x => x.b === lbl);
    expect(f, lbl).toBeTruthy();
    expect(f.k).toBe(k);
    expect(Math.abs(f.s / s - 1)).toBeLessThan(0.10);
    expect(f.desc).toMatch(/× scale/);
  }
  expect(r.length).toBe(4);
  expect(errors).toEqual([]);
});

test('a 40% overlapping crop of the same field is found and outlined within a few pixels on both images', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const S = __mkTex(9, 640, 300);
    await __commit(__crop(S, 0, 0, 400, 300), 'left.png'); render();    // this panel: x 0–400 of the field
    const others = __others([['right', __crop(S, 240, 0, 400, 300)]]);  // the other figure: x 240–640
    const res = await _xdRun(_xdThisPanels(), others, {});
    const f = res.findings[0];
    return f && { n: res.findings.length, a: f.rectApx, b: f.rectBpx, fracA: f.fracA, k: f.k, s: f.s, desc: _xdDescribe(f, 'panel A') };
  });
  expect(r).toBeTruthy();
  expect(r.n).toBe(1);
  // Truth: x 240–400 of this panel is x 0–160 of the other, full height.
  expect(Math.abs(r.a.x - 240)).toBeLessThan(4);
  expect(Math.abs(r.a.w - 160)).toBeLessThan(4);
  expect(Math.abs(r.a.y)).toBeLessThan(3);
  expect(Math.abs(r.a.h - 300)).toBeLessThan(4);
  expect(Math.abs(r.b.x)).toBeLessThan(4);
  expect(Math.abs(r.b.w - 160)).toBeLessThan(4);
  expect(Math.abs(r.fracA - 0.4)).toBeLessThan(0.02);
  expect(r.desc).toMatch(/overlapping region ~40% of panel A/);
  expect(errors).toEqual([]);
});

test('a copy with changed brightness, contrast, gamma and a LUT is found — source pixels are compared', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const P = __mkTex(13, 360, 280);
    await __commit(P, 'p.png');
    // This panel is DISPLAYED very differently too; the check must not see that.
    Object.assign(images[0], { brightness: 1.8, contrast: 1.6, gamma: 0.5, lut: 'green' }); render();
    const c = __crop(P, 0, 0, 360, 280), x = c.getContext('2d'), im = x.getImageData(0, 0, 360, 280);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = im.data[i] / 255, g = Math.pow(Math.min(1, Math.max(0, (v - 0.1) * 1.6)), 0.6);  // levels, contrast, gamma
      im.data[i] = g * 40; im.data[i+1] = g * 230 + 10; im.data[i+2] = g * 60;                       // a green-ish LUT baked in
    }
    x.putImageData(im, 0, 0);
    // and a copy with its contrast inverted (a negative), which the description names
    const inv = __crop(P, 0, 0, 360, 280), xi = inv.getContext('2d'), ii = xi.getImageData(0, 0, 360, 280);
    for (let i = 0; i < ii.data.length; i += 4) ii.data[i] = ii.data[i+1] = ii.data[i+2] = 255 - ii.data[i];
    xi.putImageData(ii, 0, 0);
    const res = await _xdRun(_xdThisPanels(), __others([['adjusted', c], ['inverted', inv]]), {});
    return res.findings.map(f => ({ b: f.b.label, k: f.k, s: f.s, score: f.score, inverted: f.inverted, desc: _xdDescribe(f, 'A') }));
  });
  expect(r.length).toBe(2);
  const adj = r.find(f => f.b === 'adjusted'), inv = r.find(f => f.b === 'inverted');
  expect(adj.k).toBe(0);
  expect(adj.inverted).toBe(false);
  expect(adj.score).toBeGreaterThan(0.9);
  expect(inv.k).toBe(0);
  expect(inv.inverted).toBe(true);
  expect(inv.score).toBeGreaterThan(0.9);
  expect(inv.desc).toMatch(/contrast inverted/);
  expect(errors).toEqual([]);
});

test('different images with the same statistics are NOT reported', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __commit(__mkTex(21, 400, 300), 'a.png');
    await __commit(__mkTex(22, 400, 300), 'b.png'); render();
    const list = []; for (let s = 100; s < 112; s++) list.push(['other' + s, __mkTex(s, 400, 300)]);
    // also re-scaled and rotated versions of DIFFERENT textures
    list.push(['r', __tf(__mkTex(300, 400, 300), 1, 0.7)], ['m', __tf(__mkTex(301, 400, 300), 4, 1.5)]);
    const res = await _xdRun(_xdThisPanels(), __others(list), {});
    return { n: res.findings.length, compared: res.compared, excluded: res.excluded.length, pairs: res.pairs };
  });
  expect(r.compared).toBe(14);
  expect(r.excluded).toBe(0);
  expect(r.pairs).toBe(28);
  expect(r.n).toBe(0);
  expect(errors).toEqual([]);
});

test('blank, saturated and pure-noise images are not matched — even identical ones — and are reported as excluded', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __commit(__flat('blank', 300, 300), 'blank.png');
    await __commit(__flat('saturated', 300, 300), 'sat.png');
    await __commit(__flat('noise', 300, 300, 5), 'noise.png');
    await __commit(__mkTex(31, 300, 300), 'real.png'); render();
    const others = __others([['blank2', __flat('blank', 300, 300)], ['sat2', __flat('saturated', 300, 300)],
                             ['noise-same', __flat('noise', 300, 300, 5)], ['noise-other', __flat('noise', 300, 300, 6)]]);
    const res = await _xdRun(_xdThisPanels(), others, {});
    return { n: res.findings.length, ex: res.excluded.map(x => x.label + ': ' + x.why), compared: res.compared, panels: res.panelsCompared };
  });
  expect(r.n).toBe(0);
  expect(r.panels).toBe(1);                        // only the textured panel
  expect(r.compared).toBe(0);                      // nothing on the other side carries structure
  expect(r.ex.length).toBe(7);
  expect(r.ex.join('\n')).toMatch(/blank or uniform/);
  expect(r.ex.join('\n')).toMatch(/noise — pixel-to-pixel variation with no spatial structure/);
  expect(errors).toEqual([]);
});

test('a comparison set over the image cap: the skipped images are counted and named, not dropped silently', async ({ page }) => {
  const errors = await setup(page);
  const txt = await page.evaluate(async () => {
    await __commit(__mkTex(41, 200, 160), 'a.png'); render();
    openCrossFigureCheck();
    const files = [];
    for (let i = 0; i < _XDUP_CAPS.images + 2; i++) files.push(await __pngFile(__mkTex(500 + i, 160, 120), `img${i}.png`));
    await _xdAddFiles(files);
    await _xdStart();
    return document.getElementById('xdup-results').textContent.replace(/\s+/g, ' ');
  });
  expect(txt).toMatch(/with 40 of 42 images/);
  expect(txt).toMatch(/2 skipped/);
  expect(txt).toMatch(/img41\.png — over the 40-image limit for one run/);
  expect(errors).toEqual([]);
});

// A figure saved with its images, as a File, for use as a comparison source.
async function sessionFileWithPanel(page) {
  return page.evaluate(async () => {
    const S = __mkTex(51, 700, 400);
    window.__S = S;
    await __commit(__crop(S, 0, 0, 420, 400), 'fig1-a.png');
    await __commit(__mkTex(52, 300, 300), 'fig1-b.png'); render();
    window.__fig1 = JSON.stringify(serializeSession(true));
    // the figure being checked: a new figure
    _resetFigureState(); images.length = 0;
    await __commit(__tf(__crop(S, 200, 0, 420, 400), 4, 1), 'fig2-a.png');   // same field, shifted and mirrored
    await __commit(__mkTex(53, 300, 300), 'fig2-b.png');
    await __commit(__mkTex(52, 300, 300), 'fig2-c.png');                      // fig1-b exactly
    render();
    return true;
  });
}

test('a session file with embedded images is a comparison source; findings carry the figure and panel names', async ({ page }) => {
  const errors = await setup(page);
  await sessionFileWithPanel(page);
  const r = await page.evaluate(async () => {
    openCrossFigureCheck();
    await _xdAddFiles([new File([__fig1], 'Figure1.json', { type: 'application/json' })]);
    await _xdStart();
    const res = _reuse.lastRun;
    return { compared: res.compared, total: res.total, f: res.findings.map(f => f.a + ' | ' + f.b + ' | ' + f.desc),
      txt: document.getElementById('xdup-results').textContent };
  });
  expect(r.total).toBe(2);
  expect(r.compared).toBe(2);
  expect(r.f.length).toBe(2);
  expect(r.f.find(x => x.startsWith('A |'))).toMatch(/Figure1 · panel A \| mirrored left–right, overlapping region/);
  expect(r.f.find(x => x.startsWith('C |'))).toMatch(/Figure1 · panel B \| identical image/);
  expect(r.txt).toMatch(/Intentional reuse — say so in the legend/);
  expect(errors).toEqual([]);
});

test('decisions: intentional writes the legend sentence, different suppresses the pair on re-run, both survive save → load and undo', async ({ page }) => {
  const errors = await setup(page);
  await sessionFileWithPanel(page);
  const r = await page.evaluate(async () => {
    generateCaption(); writeMethodsParagraph();                      // boxes hold FigureLab's text
    openCrossFigureCheck();
    const file = new File([__fig1], 'Figure1.json', { type: 'application/json' });
    await _xdAddFiles([file]);
    await _xdStart();
    const rowOf = lbl => [...document.querySelectorAll('#xdup-results .cc-row')].find(r => r.textContent.includes('Panel ' + lbl + ' ↔'));
    const undoBefore = undoStack.length;
    rowOf('A').querySelector('[data-xd-act="intentional"]').click();
    rowOf('C').querySelector('[data-xd-act="different"]').click();
    const steps = undoStack.length - undoBefore;
    const cap = gv('caption-out'), meth = gv('methods-out');
    const row = _reuseComplianceRow();
    // save → load
    const saved = JSON.stringify(serializeSession(true));
    _resetFigureState();
    const cleared = Object.keys(_reuse.decisions).length;
    applySession(JSON.parse(saved), { silent: true });
    await new Promise(r => setTimeout(r, 300)); render();
    const back = Object.values(_reuse.decisions).map(d => d.verdict).sort();
    const capFn = _captionText(), methFn = generateMethodsParagraph();
    // re-run: the "different" pair is not listed, the intentional one is listed as decided
    closeCrossFigureCheck(); openCrossFigureCheck();
    await _xdAddFiles([file]); await _xdStart();
    const txt = document.getElementById('xdup-results').textContent.replace(/\s+/g, ' ');
    const listed = [...document.querySelectorAll('#xdup-results .cc-row')].filter(r => r.textContent.includes('↔')).length;
    // undo the intentional decision (applySession pushed a boundary, then nothing else)
    const pkg = _reuseReportText();
    return { steps, cap, meth, row, cleared, back, capFn, methFn, txt, listed, pkg };
  });
  const sentence = /The image in panel A is reused from panel A of “Figure1”, mirrored left–right\./;
  expect(r.steps).toBe(2);                         // one undo step per decision
  expect(r.cap).toMatch(sentence);
  expect(r.meth).toMatch(sentence);
  expect(r.row.ok).toBe(true);                     // every finding decided
  expect(r.row.note).toMatch(/2 findings, each decided/);
  expect(r.cleared).toBe(0);                       // a figure boundary forgets them
  expect(r.back).toEqual(['different', 'intentional']);
  expect(r.capFn).toMatch(sentence);
  expect(r.methFn).toMatch(sentence);
  expect(r.listed).toBe(1);                        // the "different" pair is suppressed
  expect(r.txt).toMatch(/1 pair you marked “different images” is not listed/);
  expect(r.pkg).toMatch(/INTENTIONAL REUSE, stated: "The image in panel A is reused/);
  expect(r.pkg).toMatch(/marked DIFFERENT IMAGES by the author/);
  expect(errors).toEqual([]);
});

test('a decision is one undo step, and Ctrl+Z takes its sentence back out of the caption', async ({ page }) => {
  const errors = await setup(page);
  await sessionFileWithPanel(page);
  const r = await page.evaluate(async () => {
    generateCaption();
    openCrossFigureCheck();
    await _xdAddFiles([new File([__fig1], 'Figure1.json', { type: 'application/json' })]);
    await _xdStart();
    document.querySelector('#xdup-results [data-xd-act="intentional"]').click();
    const withIt = gv('caption-out');
    // edit the sentence: one more step, and the caption follows
    const inp = document.querySelector('#xdup-results .xd-sentence');
    inp.value = 'The control image in Fig. 2A is reused from Fig. 1A.'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    const edited = gv('caption-out');
    undo();
    const afterOne = gv('caption-out');
    undo();
    return { withIt, edited, afterOne, after: gv('caption-out'), n: Object.keys(_reuse.decisions).length };
  });
  expect(r.withIt).toMatch(/is reused from panel/);
  expect(r.edited).toMatch(/The control image in Fig\. 2A is reused from Fig\. 1A\./);
  expect(r.afterOne).toMatch(/is reused from panel . of “Figure1”/);
  expect(r.after).not.toMatch(/reused/);
  expect(r.n).toBe(0);
  expect(errors).toEqual([]);
});

test('the compliance report has one row: not run, then open findings (warn), then clean', async ({ page }) => {
  const errors = await setup(page);
  await sessionFileWithPanel(page);
  const r = await page.evaluate(async () => {
    const rowText = () => { checkCompliance(); const m = document.getElementById('info-modal-bg');
      const row = [...m.querySelectorAll('.compliance-row')].find(x => x.textContent.includes('Image reuse across figures'));
      const t = row ? row.textContent.replace(/\s+/g, ' ') : null; m.remove(); return t; };
    const notRun = rowText();
    openCrossFigureCheck();
    await _xdAddFiles([new File([__fig1], 'Figure1.json', { type: 'application/json' })]);
    await _xdStart();
    const open = rowText(), openRow = _reuseComplianceRow();
    // each decision re-renders the list, so click the first open one until none is left
    for (let b, i = 0; i < 10 && (b = document.querySelector('#xdup-results [data-xd-act="different"]')); i++) b.click();
    const clean = rowText(), cleanRow = _reuseComplianceRow();
    // with a target journal, the row is still there
    sv('target-journal', 'asm'); _syncJournalFromControl();
    const journal = rowText();
    return { notRun, open, openWarn: openRow.warn && !openRow.ok, clean, cleanOk: cleanRow.ok, journal };
  });
  expect(r.notRun).toMatch(/Not run/);
  expect(r.open).toMatch(/2 open findings/);
  expect(r.open).toMatch(/3 panels × 2 images compared/);
  expect(r.openWarn).toBe(true);
  expect(r.cleanOk).toBe(true);
  expect(r.clean).toMatch(/each decided/);
  expect(r.journal).toMatch(/Image reuse across figures/);
  expect(errors).toEqual([]);
});

test('figures in the session library are a comparison source; this figure saved there is recognised, not matched with itself', async ({ page }) => {
  const errors = await setup(page);
  await sessionFileWithPanel(page);
  const r = await page.evaluate(async () => {
    // Figure 1 in the library, and this figure (figure 2) saved there too.
    await _dbPut({ id: 'lib1', name: 'Figure 1', savedAt: 1, thumb: '', data: JSON.parse(__fig1) });
    await _dbPut({ id: 'lib2', name: 'Figure 2 (this one)', savedAt: 2, thumb: '', data: serializeSession(true) });
    const waitLib = async () => { for (let i = 0; i < 50 && !(_xdUI.lib && _xdUI.lib.length); i++) await new Promise(r => setTimeout(r, 20)); };
    openCrossFigureCheck(); await waitLib();
    const lib = _xdUI.lib.map(l => ({ name: l.name, on: l.on, self: l.self }));
    const libTxt = document.getElementById('xdup-lib').textContent.replace(/\s+/g, ' ');
    await _xdStart();
    const first = _reuse.lastRun.findings.map(f => f.b).sort();
    // Tick this figure's own library copy as well: each panel meets its own saved copy,
    // and those pairs are skipped and counted, never reported as reuse.
    closeCrossFigureCheck(); openCrossFigureCheck(); await waitLib();
    _xdUI.lib.forEach(l => { l.on = true; });
    await _xdStart();
    return { lib, libTxt, first, second: _reuse.lastRun.findings.map(f => f.b).sort(), selfPairs: _reuse.lastRun.selfPairs,
      txt: document.getElementById('xdup-results').textContent.replace(/\s+/g, ' ') };
  });
  expect(r.lib).toEqual([{ name: 'Figure 2 (this one)', on: false, self: true }, { name: 'Figure 1', on: true, self: false }]);
  expect(r.libTxt).toMatch(/the same images as this figure — unticked/);
  expect(r.first).toEqual(['Figure 1 · panel A', 'Figure 1 · panel B']);
  expect(r.second).toEqual(r.first);
  expect(r.selfPairs).toBe(3);
  expect(r.txt).toMatch(/3 pairs of a panel with its own saved copy in the library skipped/);
  expect(errors).toEqual([]);
});

test('a TIFF file is read by the app\'s own decoder and compared', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const P = __mkTex(61, 320, 240);
    await __commit(P, 'p.png'); render();
    const Q = __tf(P, 2, 1), d = Q.getContext('2d').getImageData(0, 0, Q.width, Q.height).data;
    const rgb = new Uint8Array(Q.width * Q.height * 3);
    for (let i = 0, j = 0; i < d.length; i += 4) { rgb[j++] = d[i]; rgb[j++] = d[i+1]; rgb[j++] = d[i+2]; }
    const bytes = _tiffBytes(rgb, Q.width, Q.height, 300);
    openCrossFigureCheck();
    await _xdAddFiles([new File([bytes], 'blot.tif', { type: 'image/tiff' })]);
    await _xdStart();
    return _reuse.lastRun.findings.map(f => f.b + ' | ' + f.desc);
  });
  expect(r).toEqual(['blot.tif | the whole image, rotated 180°']);
  expect(errors).toEqual([]);
});

test('Cancel stops the comparison and the result says it is incomplete', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __commit(__mkTex(71, 400, 300), 'a.png'); render();
    openCrossFigureCheck();
    const files = []; for (let i = 0; i < 20; i++) files.push(await __pngFile(__mkTex(700 + i, 400, 300), `o${i}.png`));
    await _xdAddFiles(files);
    const p = _xdStart();
    await new Promise(r => setTimeout(r, 60));
    document.getElementById('xdup-cancel').click();
    await p;
    const row = _reuseComplianceRow();
    return { cancelled: _reuse.lastRun.cancelled, compared: _reuse.lastRun.compared,
      notReached: _reuse.lastRun.skipped.filter(s => /cancelled/.test(s.why)).length,
      txt: document.getElementById('xdup-results').textContent, row };
  });
  expect(r.cancelled).toBe(true);
  expect(r.compared).toBeLessThan(20);
  expect(r.compared + r.notReached).toBe(20);
  expect(r.txt).toMatch(/Cancelled/);
  expect(r.row.warn).toBe(true);
  expect(r.row.note).toMatch(/Cancelled before it finished/);
  expect(errors).toEqual([]);
});

test('the within-figure duplication check now finds a re-scaled copy, offers the decisions, and states its caps', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const S = __mkTex(81, 500, 400);
    await __commit(S, 'field.png');
    await __commit(__tf(__crop(S, 100, 80, 300, 240), 0, 1.6), 'zoom.png');   // B: a 1.6× zoom of part of A
    await __commit(__mkTex(82, 400, 300), 'other.png'); render();
    runDuplicateScan();
    const modal = [...document.querySelectorAll('.modal-bg.open')].pop();
    const sec = modal.querySelector('[data-xd-scale]');
    for (let i = 0; i < 100 && /Comparing panel pairs/.test(sec.textContent); i++) await new Promise(r => setTimeout(r, 50));
    const txt = sec.textContent.replace(/\s+/g, ' ');
    sec.querySelector('[data-xd-act="different"]').click();
    const steps0 = undoStack.length;
    sec.querySelector('[data-xd-act="different"]').click();              // the same verdict again: no step
    const sameAgain = undoStack.length - steps0;
    const rr = _regionDupScan();
    modal.remove();
    runDuplicateScan();
    const m2 = [...document.querySelectorAll('.modal-bg.open')].pop();
    const s2 = m2.querySelector('[data-xd-scale]');
    for (let i = 0; i < 100 && /Comparing panel pairs/.test(s2.textContent); i++) await new Promise(r => setTimeout(r, 50));
    const txt2 = s2.textContent.replace(/\s+/g, ' ');
    m2.remove();
    return { txt, txt2, sameAgain, unverified: rr.unverified, kpCapped: rr.kpCapped, foot: m2.textContent };
  });
  expect(r.txt).toMatch(/A and B show the same field — 1\.6\d× scale \(the other image is larger\), overlapping region ~36% of A and ~100% of B/);
  expect(r.txt).toMatch(/Different images/);
  expect(r.txt2).toMatch(/1 pair you marked “different images” not listed/);
  expect(r.sameAgain).toBe(0);
  expect(r.unverified).toBe(0);                    // the cap is now a count
  expect(typeof r.kpCapped).toBe('number');
  expect(errors).toEqual([]);
});

test('a whole-panel duplicate marked "different images" is not raised again by the report or the deep audit', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const P = __mkTex(91, 300, 300);
    await __commit(P, 'a.png'); await __commit(__crop(P, 0, 0, 300, 300), 'a-again.png'); render();
    const auditText = () => { runAdvancedConsistency(); const m = [...document.querySelectorAll('.modal-bg.open')].pop();
      const t = m.textContent.replace(/\s+/g, ' '); m.remove(); return t; };
    const before = auditText();
    runDuplicateScan();
    const m = [...document.querySelectorAll('.modal-bg.open')].pop();
    const row = [...m.querySelectorAll('.cc-row')].find(x => /similar/.test(x.textContent));
    row.querySelector('[data-xd-act="different"]').click();
    m.remove();
    runDuplicateScan();
    const m2 = [...document.querySelectorAll('.modal-bg.open')].pop();
    const rep = m2.textContent.replace(/\s+/g, ' '); m2.remove();
    return { before, after: auditText(), rep };
  });
  expect(r.before).toMatch(/A and B are 100\.0% identical/);
  expect(r.after).not.toMatch(/A and B are .*identical/);
  expect(r.after).toMatch(/you marked “different images” in the 🧬 Duplication check not listed/);
  expect(r.rep).not.toMatch(/A and B are .*similar/);
  expect(r.rep).toMatch(/you marked “different images” (is|are) not listed/);
  expect(errors).toEqual([]);
});

test('runtime: 12 panels × 12 images of 1000×1000 px', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const A = [], B = [];
    for (let i = 0; i < 12; i++) { A.push(__mkTex(500 + i, 1000, 1000)); B.push(__mkTex(900 + i, 1000, 1000)); }
    B[3] = __tf(A[5], 2, 0.8);
    B[8] = __crop(A[1], 300, 200, 700, 800);
    const panels = A.map((c, i) => ({ label: 'P' + i, key: 'P' + i, load: async () => ({ src: c }) }));
    const res = await _xdRun(panels, __others(B.map((c, i) => ['O' + i, c])), {});
    return { ms: res.ms, pairs: res.pairs, f: res.findings.map(f => f.a.label + '-' + f.b.label).sort() };
  });
  console.log(`[crossfig-dup] 12 × 12 images of 1000×1000 px: ${r.ms} ms for ${r.pairs} pairs`);
  expect(r.pairs).toBe(144);
  expect(r.f).toEqual(['P1-O8', 'P5-O3']);
  expect(r.ms).toBeLessThan(60000);
  expect(errors).toEqual([]);
});

test('screenshot of the results dialog', async ({ page }) => {
  const errors = await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await sessionFileWithPanel(page);
  await page.evaluate(async () => {
    openCrossFigureCheck();
    await _xdAddFiles([new File([__fig1], 'Figure1.json', { type: 'application/json' })]);
    await _xdStart();
    document.querySelector('#xdup-results [data-xd-act="intentional"]').click();
    _xdView(0);
  });
  const out = process.env.XDUP_SHOT;
  if (out) await page.screenshot({ path: out });
  expect(errors).toEqual([]);
});
