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
const { GEN, GEN_REAL } = require('./dup-gen');

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

// ── Same pixels, not the same composition ──────────────────────
// The tester's realistic generators (GEN_REAL in dup-gen.js): images that share a LAYOUT by design (one lane
// layout, one dish, one letterbox with a label and a scale bar, a lattice) but are
// different acquisitions, and copies of one acquisition through every re-save a figure
// meets. The expected class of every pair is written down; the confusion tables in the
// README are these runs.
async function setupReal(page) {
  const errors = await setup(page);
  await page.addScriptTag({ content: GEN_REAL });
  return errors;
}
const COUNTED = ['identical', 'same', 'near'];

// Different acquisitions: [generator, seeds → expected class of each of three pairs].
const FP_CASES = {
  'blots, one lane layout':            ['s=>__wblot({seed:s})', 'similar'],
  'blots, noise σ 2, no stains':       ['s=>__wblot({seed:s,noise:2,blotches:0})', 'similar'],
  'blots, noise σ 1, no stains':       ['s=>__wblot({seed:s,noise:1,blotches:0})', 'similar'],
  'blots, noise σ 6':                  ['s=>__wblot({seed:s,noise:6})', 'similar'],
  'blots, clipped white background':   ['s=>__wblot({seed:s,blotches:0,noise:2,bg:262})', 'similar'],
  'blots, same lane amplitudes ±7%':   ['s=>__wblot({seed:s,amp:(k,bi)=>[50,80][bi]+k*8})', 'similar'],
  'blots, one noise σ 1, one σ 5':    ['s=>s%2?__wblot({seed:s,noise:1,blotches:0}):__wblot({seed:s,noise:5,blotches:0})', 'similar'],
  'blots, one blurred σ 2':            ['s=>s%2?__wblot({seed:s,noise:2,blotches:0}):__blur(__wblot({seed:s,noise:2,blotches:0}),2)', 'similar'],
  'blot vs its loading control':       ['s=>s%2?__wblot({seed:s}):__wblot({seed:s,bands:[{y:150,s:5}],amp:()=>90})', 'none'],
  'plaque plates':                     ['s=>__plate(s,360,360)', 'similar'],
  'plaque plates, 12 plaques':         ['s=>__plate(s,360,360,{n:12})', 'similar'],
  'cell fields, letterbox+label+bar':  ['s=>__stamp(__cells(s,400,300),{letterbox:40,label:"WT"})', 'none'],
  'dim cells, letterbox+label+bar':    ['s=>__stamp(__cells(s,400,300,{amp:30,noise:2}),{letterbox:40,label:"WT"})', 'similar'],
  'very dim cells, letterbox+label':   ['s=>__stamp(__cells(s,400,300,{amp:12,noise:1}),{letterbox:40,label:"WT"})', 'similar'],
  'hemocytometer grids':               ['s=>__hemo(s,400,300)', 'periodic'],
  'hemocytometer grids, aligned':      ['s=>__hemo(s,400,300,{ox:10,oy:10})', 'periodic'],
  'EM lattices, noise σ 20':           ['s=>__lattice(s,300,300)', 'periodic'],
  'EM lattices, noise σ 5':            ['s=>__lattice(s,300,300,{noise:5})', 'periodic'],
  'cell fields':                       ['s=>__cells(s,400,300)', 'none'],
};
for (const [name, [gen, want]] of Object.entries(FP_CASES)) {
  test(`false positives: ${name} — never counted as reuse (expected: ${want})`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = await setupReal(page);
    const got = await page.evaluate(async (gen) => {
      const fn = eval(gen), out = [];
      for (let i = 0; i < 3; i++) out.push(await __classOf(fn(201 + 2 * i), fn(202 + 2 * i)));
      return out;
    }, gen);
    for (const c of got) expect(COUNTED).not.toContain(c);
    const map = { similar: 'layout (not counted)', periodic: 'periodic (not counted)', none: 'none' };
    expect(got).toEqual([map[want], map[want], map[want]]);
    expect(errors).toEqual([]);
  });
}

test('false positives: unrelated 64, 96 and 128 px textures (8 × 8 pairs each) — none reported', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const out = {};
    for (const sz of [64, 96, 128]) {
      const P = [], O = [];
      for (let i = 0; i < 8; i++) { const c = __mkTex(800 + i, sz, sz); P.push({ label: 'P' + i, key: 'P' + i, load: async () => ({ src: c }) }); O.push(['O' + i, __mkTex(900 + i, sz, sz)]); }
      const res = await _xdRun(P, __others(O), {});
      out[sz] = { pairs: res.pairs, found: res.findings.length };
    }
    return out;
  });
  for (const sz of [64, 96, 128]) expect(r[sz].found, sz + ' px').toBe(0);   // 12 of 64 at 96 px before
  expect(r[96].pairs).toBe(64);
  expect(errors).toEqual([]);
});

test('time-lapse: the next frame is "nearly identical", never "identical"; five frames on is not counted', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const res = await _xdRun([{ label: 'A', key: 'A', load: async () => ({ src: __timelapse(0) }) }], __others([['t+1', __timelapse(2)], ['t+5', __timelapse(10)]]), {});
    return { f: res.findings.map(f => f.b.label + ' ' + f.cls + ' | ' + _xdDescribe(f, 'panel A')), alike: res.alike.map(f => f.b.label + ' ' + f.cls) };
  });
  expect(r.f).toEqual(['t+1 near | nearly identical — alike in coarse detail; finest detail differs (consecutive frames, a re-exposure, a heavily compressed re-save, or two near-twin images); the whole image']);
  expect(r.alike).toEqual(['t+5 layout']);
  expect(errors).toEqual([]);
});

// The stated limit: two blots whose every band agrees within ~5% and that carry under
// one grey level of noise. They are worded "nearly identical", never "identical".
test('limit: near-noiseless blots with equal lane intensities can read as nearly identical, never identical', async ({ page }) => {
  const errors = await setupReal(page);
  const got = await page.evaluate(async () => {
    const o = s => __wblot({ seed: s, noise: 0.7, yJit: 0, blotches: 0, ampJit: 0.05, amp: (k, bi) => [60, 90][bi] });
    const out = []; for (let i = 0; i < 5; i++) out.push(await __classOf(o(301 + 2 * i), o(302 + 2 * i)));
    return out;
  });
  expect(got).toEqual(['near', 'near', 'near', 'near', 'near']);
  expect(errors).toEqual([]);
});

// Copies: the class every re-save is expected to get. "same" = the same image with its
// finest detail lost; "near" = fine detail present on both sides but different (a
// compressed or noisy re-save reads like a re-exposure). Misses are listed and named.
const TP_EXPECT = {
  cells: { gen: '[__cells(41,500,380),__cells(42,500,380)]',
    want: { copy: 'identical', jpeg90: 'identical', jpeg50: 'near', jpeg20: 'same', jpeg5: 'layout (not counted)', gamma04: 'identical', gamma25: 'identical', inverted: 'identical', fireLUT: 'identical', redOnly: 'identical', blueOnly: 'identical',
      blur1: 'identical', blur2: 'same', blur3: 'same', blur4: 'same', noise10: 'near', noise25: 'same', noise50: 'layout (not counted)',
      s045: 'identical', s050: 'identical', s070: 'identical', s150: 'identical', s200: 'identical', s220: 'identical', k1: 'identical', k5s06: 'identical', crop10: 'identical', crop25: 'identical', mirScaleCrop: 'identical', montage: 'identical' } },
  texture: { gen: '[__mkTex(41,500,380),__mkTex(42,500,380)]',
    want: { copy: 'identical', jpeg90: 'identical', jpeg50: 'same', jpeg20: 'identical', jpeg5: 'same', gamma04: 'identical', gamma25: 'identical', inverted: 'identical', fireLUT: 'identical', redOnly: 'identical', blueOnly: 'identical',
      blur1: 'identical', blur2: 'same', blur3: 'same', blur4: 'same', noise10: 'identical', noise25: 'same', noise50: 'layout (not counted)',
      s045: 'identical', s050: 'identical', s070: 'identical', s150: 'identical', s200: 'identical', s220: 'identical', k1: 'identical', k5s06: 'identical', crop10: 'identical', crop25: 'identical', mirScaleCrop: 'identical', montage: 'identical' } },
  blot: { gen: '[__wblot({seed:41}),__wblot({seed:42})]',
    want: { copy: 'identical', jpeg90: 'identical', jpeg50: 'near', jpeg20: 'same', jpeg5: 'layout (not counted)', gamma04: 'identical', gamma25: 'identical', inverted: 'identical', fireLUT: 'identical', redOnly: 'identical', blueOnly: 'identical',
      blur1: 'identical', blur2: 'same', blur3: 'same', blur4: 'same', noise10: 'near', noise25: 'layout (not counted)', noise50: 'none',
      s045: 'identical', s050: 'identical', s070: 'identical', s150: 'identical', s200: 'identical', s220: 'identical', k1: 'identical', k5s06: 'identical', crop10: 'none', crop25: 'identical', mirScaleCrop: 'none', montage: 'identical' } },
  'blot on a clipped white background': { gen: '[__wblot({seed:41,blotches:0,noise:2,bg:262}),__wblot({seed:42,blotches:0,noise:2,bg:262})]',
    want: { copy: 'identical', jpeg90: 'same', jpeg50: 'same', jpeg20: 'same', jpeg5: 'layout (not counted)', gamma04: 'identical', gamma25: 'same', inverted: 'identical', fireLUT: 'identical', redOnly: 'identical', blueOnly: 'identical',
      blur1: 'same', blur2: 'same', blur3: 'same', blur4: 'layout (not counted)', noise10: 'same', noise25: 'same', noise50: 'none',
      s045: 'same', s050: 'identical', s070: 'identical', s150: 'identical', s200: 'identical', s220: 'identical', k1: 'identical', k5s06: 'identical', crop10: 'none', crop25: 'none', mirScaleCrop: 'none', montage: 'none' } },
  'plaque plate': { gen: '[__plate(41,360,360),__plate(42,360,360)]',
    want: { copy: 'identical', jpeg90: 'identical', jpeg50: 'same', jpeg20: 'same', jpeg5: 'same', gamma04: 'identical', gamma25: 'identical', inverted: 'identical', fireLUT: 'identical', redOnly: 'identical', blueOnly: 'identical',
      blur1: 'identical', blur2: 'same', blur3: 'same', blur4: 'layout (not counted)', noise10: 'same', noise25: 'same', noise50: 'same',
      s045: 'identical', s050: 'identical', s070: 'identical', s150: 'identical', s200: 'identical', s220: 'identical', k1: 'identical', k5s06: 'identical', crop10: 'identical', crop25: 'identical', mirScaleCrop: 'identical', montage: 'identical' } },
};
for (const [name, { gen, want }] of Object.entries(TP_EXPECT)) {
  test(`true positives: copies of a ${name} through every re-save get their expected class`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = await setupReal(page);
    const got = await page.evaluate(async (gen) => {
      const [P, O] = eval(gen), L = await __tpSet(P, O), out = {};
      for (const [k, c] of Object.entries(L)) out[k] = await __classOf(P, c);
      return out;
    }, gen);
    const found = Object.values(got).filter(c => COUNTED.includes(c)).length;
    console.log(`[crossfig-dup] true positives, ${name}: ${found} of ${Object.keys(got).length} counted; ` +
      Object.entries(got).filter(([, c]) => !COUNTED.includes(c)).map(([k, c]) => `${k} → ${c}`).join(', '));
    expect(got).toEqual(want);
    expect(errors).toEqual([]);
  });
}

test('a similar-layout pair is listed apart, neutral, with its reason — nothing in the caption, Methods or compliance warnings', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    await __commit(__wblot({ seed: 1 }), 'antiX.png'); render();
    generateCaption(); writeMethodsParagraph();
    openCrossFigureCheck();
    await _xdAddFiles([await __pngFile(__wblot({ seed: 2 }), 'other_blot_same_layout.png'), await __pngFile(__hemo(1, 400, 300), 'grid1.png')]);
    await _xdStart();
    const res = document.getElementById('xdup-results');
    return { txt: res.textContent.replace(/\s+/g, ' '), alikeRows: res.querySelectorAll('[data-xd-alike]').length,
      buttons: res.querySelectorAll('[data-xd-alike] [data-xd-act]').length, fails: res.querySelectorAll('.cc-fail').length, ticks: [...res.querySelectorAll('.cc-pass .cc-icon')].map(e => e.textContent).filter(t => t === '✓').length,
      findings: _reuse.lastRun.findings.length, alike: _reuse.lastRun.alike.map(a => a.cls), row: _reuseComplianceRow(),
      cap: gv('caption-out'), meth: gv('methods-out'), pkg: _reuseReportText() };
  });
  expect(r.findings).toBe(0);
  expect(r.alike).toEqual(['layout']);
  expect(r.alikeRows).toBe(1);
  expect(r.buttons).toBe(0);                       // not a finding: no decision to make
  expect(r.fails).toBe(0);
  expect(r.ticks).toBe(0);                         // no green tick while something looks alike
  expect(r.txt).toMatch(/Alike at a glance — not counted as reuse/);
  expect(r.txt).toMatch(/similar layout — not counted as reuse/);
  expect(r.txt).toMatch(/these look alike at a glance; their fine detail differs, so they are different acquisitions/i);
  expect(r.row.ok).toBe(true);
  expect(r.row.warn).toBeFalsy();
  expect(r.row.note).toMatch(/1 pair only alike in layout \(not counted\)/);
  expect(r.cap).not.toMatch(/reuse|reused/i);
  expect(r.meth).not.toMatch(/reuse|reused/i);
  expect(r.pkg).toMatch(/NOT counted as reuse[\s\S]*similar layout — not counted as reuse/);
  expect(errors).toEqual([]);
});

test('periodic pairs (a lattice, a counting grid) are listed as "periodic pattern", never as reuse', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const res = await _xdRun([{ label: 'L', key: 'L', load: async () => ({ src: __lattice(201, 300, 300) }) }, { label: 'H', key: 'H', load: async () => ({ src: __hemo(1, 400, 300) }) }],
      __others([['lattice2', __lattice(202, 300, 300)], ['grid2', __hemo(2, 400, 300)]]), {});
    return { f: res.findings.length, alike: res.alike.map(a => a.a.label + '-' + a.b.label + ' ' + a.cls + ' | ' + _xdDescribe(a, 'A')) };
  });
  expect(r.f).toBe(0);
  expect(r.alike).toContain('L-lattice2 periodic | periodic pattern — cannot be told apart by this check');
  expect(r.alike).toContain('H-grid2 periodic | periodic pattern — cannot be told apart by this check');
  expect(errors).toEqual([]);
});

test('T1-04: a "different images" verdict covers that exact pair only — a later exact copy is open; Replace image retires the verdict', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const o = { blotches: 0, noise: 2, bg: 262 };              // clipped white background: the old fingerprint was all zeros
    const X = __wblot({ ...o, seed: 21 }), Z = __wblot({ ...o, seed: 23, bands: [{ y: 50, s: 4 }, { y: 100, s: 4 }, { y: 150, s: 5 }] });
    await __commit(X, 'my_blot.png'); render();
    const run = async files => { closeCrossFigureCheck(); openCrossFigureCheck(); await _xdAddFiles(files); await _xdStart();
      return document.getElementById('xdup-results').textContent.replace(/\s+/g, ' '); };
    const t1 = await run([await __pngFile(__tf(X, 4, 1), 'fig1_mirrored.png')]);
    document.querySelector('#xdup-results [data-xd-act="different"]').click();
    const t2 = await run([await __pngFile(X, 'fig3_panelB_exact_copy.png')]);
    const open2 = _reuseOpen().length, pkg2 = _reuseReportText();
    // run the mirrored copy again: still hidden (the verdict is for exactly that pair)
    const t3 = await run([await __pngFile(__tf(X, 4, 1), 'fig1_mirrored.png')]);
    await replacePanelImage(images[0].id, await __pngFile(Z, 'new_blot.png')); await new Promise(r => setTimeout(r, 300));
    const row = _reuseComplianceRow(), pkg4 = _reuseReportText();
    // the replaced image against the same file: examined afresh (no verdict hides anything)
    await replacePanelImage(images[0].id, await __pngFile(X, 'my_blot_again.png')); await new Promise(r => setTimeout(r, 300));
    const sameAgain = _xdThisPanels()[0].key;
    return { t1, t2, open2, pkg2, t3, row, pkg4, n: Object.keys(_reuse.decisions).length };
  });
  expect(r.t1).toMatch(/the whole image, mirrored left–right/);
  expect(r.t2).toMatch(/Panel A ↔ fig3_panelB_exact_copy\.png — identical image/);
  expect(r.t2).not.toMatch(/you marked “different images”/);
  expect(r.open2).toBe(1);
  expect(r.pkg2).toMatch(/fig3_panelB_exact_copy\.png: identical image; correlation 1\.000 — OPEN \(not decided\)/);
  expect(r.pkg2).not.toMatch(/fig3_panelB_exact_copy\.png[^\n]*DIFFERENT IMAGES/);
  expect(r.t3).toMatch(/1 pair you marked “different images” is not listed/);
  expect(r.row.warn).toBe(true);
  expect(r.row.note).toMatch(/1 decision retired: A ↔ fig1_mirrored\.png — the image or crop of panel A changed/);
  expect(r.pkg4).toMatch(/Decisions RETIRED because the image they were made on changed[\s\S]*fig1_mirrored\.png \(was different\)/);
  expect(errors).toEqual([]);
});

test('F11: an intentional reuse leaves the caption and Methods when its panel\'s image is replaced, is named as retired, and the pair is open again on the next run', async ({ page }) => {
  const errors = await setupReal(page);
  await sessionFileWithPanel(page);
  const r = await page.evaluate(async () => {
    generateCaption(); writeMethodsParagraph();
    const file = new File([__fig1], 'Figure1.json', { type: 'application/json' });
    openCrossFigureCheck(); await _xdAddFiles([file]); await _xdStart();
    const rowOf = lbl => [...document.querySelectorAll('#xdup-results .cc-row')].find(x => x.textContent.includes('Panel ' + lbl + ' ↔'));
    rowOf('C').querySelector('[data-xd-act="intentional"]').click();
    const capBefore = gv('caption-out');
    await replacePanelImage(images[2].id, await __pngFile(__mkTex(99, 300, 300), 'new.png')); await new Promise(r => setTimeout(r, 300));
    generateCaption(); writeMethodsParagraph();
    const capAfter = gv('caption-out'), methAfter = gv('methods-out'), row = _reuseComplianceRow(), pkg = _reuseReportText();
    // put the original image back: the same pixels and crop, so the decision applies again
    await replacePanelImage(images[2].id, await __pngFile(__mkTex(52, 300, 300), 'fig2-c.png')); await new Promise(r => setTimeout(r, 300));
    generateCaption();
    const capBack = gv('caption-out');
    // a mirrored copy instead (other pixels, the same picture), then a re-run: the pair is
    // examined afresh, found open, and the retired verdict dropped
    await replacePanelImage(images[2].id, await __pngFile(__tf(__mkTex(52, 300, 300), 4, 1), 'fig2-c-mirrored.png')); await new Promise(r => setTimeout(r, 300));
    closeCrossFigureCheck(); openCrossFigureCheck(); await _xdAddFiles([file]); await _xdStart();
    return { capBefore, capAfter, methAfter, row, pkg, capBack, open: _reuseOpen().map(f => f.a + ' ' + f.b), n: Object.keys(_reuse.decisions).length, capEnd: (generateCaption(), gv('caption-out')) };
  });
  const s = /The image in panel C is reused from panel B of “Figure1”\./;
  expect(r.capBefore).toMatch(s);
  expect(r.capAfter).not.toMatch(/reused/);
  expect(r.methAfter).not.toMatch(/reused/);
  expect(r.row.warn).toBe(true);
  expect(r.row.note).toMatch(/1 decision retired: C ↔ Figure1 · panel B — the image or crop of panel C changed/);
  expect(r.pkg).toMatch(/RETIRED[\s\S]*C <-> Figure1 · panel B \(was intentional\)/);
  expect(r.pkg).not.toMatch(/INTENTIONAL REUSE, stated/);
  expect(r.capBack).toMatch(s);                   // identical pixels again: the decision applies again
  expect(r.open).toContain('C Figure1 · panel B');
  expect(r.n).toBe(0);
  expect(r.capEnd).not.toMatch(/reused/);
  expect(errors).toEqual([]);
});

test('T1-07: a figure built from last week\'s figure is compared with it — an image kept from it is found; its own unchanged saved copy is skipped, counted and named', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __commit(__mkTex(71, 400, 300), 'wk1_ctrl.png'); await __commit(__mkTex(72, 400, 300), 'wk1_treated.png'); render();
    const lib = async () => { for (let i = 0; i < 50 && !(_xdUI.lib && _xdUI.lib.length); i++) await new Promise(r => setTimeout(r, 20)); };
    // Figure 1 saved to the library, then opened from it as the template for Figure 2
    const id = 'lib_fig1'; _reuse.libId = id;
    await _dbPut({ id, name: 'Figure 1', savedAt: 1, thumb: '', data: serializeSession(true) });
    // unchanged: the entry is this figure saved earlier — skipped and named
    openCrossFigureCheck(); await lib();
    const libSelf = _xdUI.lib.map(l => ({ on: l.on, self: l.self, related: l.related }));
    _xdUI.lib.forEach(l => { l.on = true; }); await _xdStart();
    const self = { n: _reuse.lastRun.findings.length, selfPairs: _reuse.lastRun.selfPairs, list: _reuse.lastRun.selfList, row: _reuseComplianceRow().note,
      pkg: _reuseReportText().split('\n').filter(l => /own saved copy/.test(l)) };
    closeCrossFigureCheck();
    await loadFromLibrary(id); await new Promise(r => setTimeout(r, 400)); render();
    await replacePanelImage(images[1].id, await __pngFile(__mkTex(73, 400, 300), 'wk2_treated.png')); await new Promise(r => setTimeout(r, 300));
    openCrossFigureCheck(); await lib();
    const libRel = _xdUI.lib.map(l => ({ on: l.on, self: l.self, related: l.related }));
    const libTxt = document.getElementById('xdup-lib').textContent.replace(/\s+/g, ' ');
    await _xdStart();
    return { libSelf, self, libRel, libTxt, f: _reuse.lastRun.findings.map(f => f.a + ' | ' + f.b + ' | ' + f.desc), selfPairs: _reuse.lastRun.selfPairs };
  });
  expect(r.libSelf).toEqual([{ on: false, self: true, related: false }]);
  expect(r.self.n).toBe(0);
  expect(r.self.selfPairs).toBe(2);
  expect(r.self.list).toEqual(['A ↔ Figure 1 · panel A', 'B ↔ Figure 1 · panel B']);
  expect(r.self.row).toMatch(/2 pairs of a panel with its own saved copy skipped \(A ↔ Figure 1 · panel A, B ↔ Figure 1 · panel B\)/);
  expect(r.self.pkg.join('\n')).toMatch(/Skipped as this figure's own saved copy .*A ↔ Figure 1 · panel A; B ↔ Figure 1 · panel B/);
  expect(r.libRel).toEqual([{ on: true, self: false, related: true }]);
  expect(r.libTxt).toMatch(/opened from or saved as this entry, but its images differ now — compared/);
  expect(r.selfPairs).toBe(0);
  expect(r.f).toEqual(['A | Figure 1 · panel A | identical image']);
  expect(errors).toEqual([]);
});

test('T1-05: red-only, green-only and blue-only images (a LUT baked into RGB) are compared, and an exact copy is found', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const chan = (c, ch, gain) => __px(c, (v) => { const o = [0, 0, 0]; o[ch] = Math.min(255, v * gain); return o; });
    const out = {};
    for (const [nm, ch] of [['red', 0], ['green', 1], ['blue', 2]]) for (const [lvl, gain, amp] of [['moderate', 1, 120], ['dim', 1, 60]]) {
      const g = __cells(5, 400, 300, { bg: 5, amp, rad: 10, noise: 3 }), P = chan(g, ch, gain);
      const res = await _xdRun([{ label: 'A', key: 'A', load: async () => ({ src: P }) }], __others([['copy', __crop(P, 0, 0, 400, 300)], ['other', chan(__cells(6, 400, 300, { bg: 5, amp, rad: 10, noise: 3 }), ch, gain)]]), {});
      out[nm + ' ' + lvl] = { ex: res.excluded.length, f: res.findings.map(f => f.b.label + ' ' + _xdDescribe(f, 'A')) };
    }
    return out;
  });
  for (const [k, v] of Object.entries(r)) { expect(v.ex, k).toBe(0); expect(v.f, k).toEqual(['copy identical image']); }
  expect(errors).toEqual([]);
});

test('T1-06: after panels are swapped the reuse sentence names the image\'s new letter; a deleted panel\'s sentence is dropped with a notice; an edited sentence follows and is flagged', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const S = __mkTex(51, 700, 400);
    await __commit(__crop(S, 0, 0, 420, 400), 'fig1-a.png'); render();
    const fig1 = JSON.stringify(serializeSession(true));
    _resetFigureState(); images.length = 0;
    await __commit(__crop(S, 0, 0, 420, 400), 'fig2-control.png');
    await __commit(__mkTex(53, 300, 300), 'fig2-new.png'); render();
    generateCaption(); writeMethodsParagraph();
    openCrossFigureCheck(); await _xdAddFiles([new File([fig1], 'Figure1.json', { type: 'application/json' })]); await _xdStart();
    document.querySelector('#xdup-results [data-xd-act="intentional"]').click();
    const pick = t => (t.match(/The image in panel [^.]*\./g) || []);
    const before = pick(gv('caption-out'));
    swapImages(0, 1); render(); generateCaption();
    const swapped = { cap: pick(gv('caption-out')), meth: pick(generateMethodsParagraph()), row: _reuseComplianceRow() };
    // the author edits the sentence (now naming panel B), then the panels swap back
    const key = Object.keys(_reuse.decisions)[0];
    _reuseSetSentence(key, 'The control image in panel B is reused from Fig. 1A.');
    swapImages(0, 1); render(); generateCaption();
    const edited = { cap: (gv('caption-out').match(/The control image in panel [^.]*\./g) || []), row: _reuseComplianceRow() };
    pushUndo(); images.splice(0, 1); render(); generateCaption();
    const deleted = { cap: gv('caption-out'), row: _reuseComplianceRow(), pkg: _reuseReportText() };
    return { before, swapped, edited, deleted };
  });
  expect(r.before).toEqual(['The image in panel A is reused from panel A of “Figure1”.']);
  expect(r.swapped.cap).toEqual(['The image in panel B is reused from panel A of “Figure1”.']);
  expect(r.swapped.meth).toEqual(['The image in panel B is reused from panel A of “Figure1”.']);
  expect(r.swapped.row.warn).toBe(true);              // relettered since the run
  expect(r.edited.cap).toEqual(['The control image in panel A is reused from Fig.']);
  expect(r.edited.row.note).toMatch(/Check the edited reuse sentence: panel B is now panel A/);
  expect(r.deleted.cap).not.toMatch(/reused/);
  expect(r.deleted.row.note).toMatch(/1 decision retired: .* — panel [AB] was deleted/);
  expect(r.deleted.pkg).toMatch(/RETIRED[\s\S]*\(was intentional\): panel [AB] was deleted/);
  expect(errors).toEqual([]);
});

test('T1-10 and zero pairs: no green tick after comparing nothing — within the figure and across figures', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    // Three copies of one image: every pair is a finding above, so the scale-tolerant pass
    // has nothing left. (Three different blots served here once, when the scans above
    // called every same-layout pair a duplicate; they are now verified as alike only, and
    // compared again at other scales.)
    const T = __mkTex(31, 360, 260);
    await __commit(T, 'X.png'); await __commit(__crop(T, 0, 0, 360, 260), 'Y.png'); await __commit(__tf(T, 4, 1), 'Z.png'); render();
    runDuplicateScan();
    const modal = [...document.querySelectorAll('.modal-bg.open')].pop(), sec = modal.querySelector('[data-xd-scale]');
    for (let i = 0; i < 200 && /Comparing panel pairs/.test(sec.textContent); i++) await new Promise(r => setTimeout(r, 50));
    const within = { txt: sec.textContent.replace(/\s+/g, ' '), ticks: [...sec.querySelectorAll('.cc-icon')].map(e => e.textContent) };
    modal.remove();
    // across figures, every image featureless: nothing compared
    images.length = 0; await __commit(__flat('blank', 300, 300), 'blank.png'); render();
    openCrossFigureCheck(); await _xdAddFiles([await __pngFile(__flat('saturated', 300, 300), 'white.png')]); await _xdStart();
    const res = document.getElementById('xdup-results');
    return { within, cross: { txt: res.textContent.replace(/\s+/g, ' '), ticks: [...res.querySelectorAll('.cc-icon')].map(e => e.textContent), row: _reuseComplianceRow(), pkg: _reuseReportText() } };
  });
  expect(r.within.ticks).not.toContain('✓');
  expect(r.within.txt).toMatch(/No pairs left to compare at other scales \(all 3 pairs already listed above\)/);
  expect(r.cross.ticks).not.toContain('✓');
  expect(r.cross.txt).toMatch(/Nothing was compared/);
  expect(r.cross.row.ok).toBe(false);
  expect(r.cross.row.note).toMatch(/Nothing was compared/);
  expect(r.cross.pkg).toMatch(/NOTHING WAS COMPARED/);
  expect(errors).toEqual([]);
});

test('T1-08: IMAGE_REUSE_CHECK.txt says which page of a multi-page TIFF was compared', async ({ page }) => {
  const errors = await setup(page);
  const mp = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'tiff', 'multipage.tif')).toString('base64');
  const r = await page.evaluate(async (b64) => {
    await __commit(__mkTex(5, 300, 200), 'a.png'); render();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    openCrossFigureCheck(); await _xdAddFiles([new File([bytes], 'multipage.tif', { type: 'image/tiff' })]); await _xdStart();
    return { pkg: _reuseReportText(), row: _reuseComplianceRow().note };
  }, mp);
  expect(r.pkg).toMatch(/Note: multipage\.tif — page 1 of \d+ compared — the other pages were not/);
  expect(r.row).toMatch(/multipage\.tif: page 1 of \d+ compared/);
  expect(errors).toEqual([]);
});

test('the content hash: two decodes of one PNG hash alike; one changed pixel or a clipped-white blot of another seed does not', async ({ page }) => {
  const errors = await setupReal(page);
  const r = await page.evaluate(async () => {
    const X = __wblot({ seed: 21, blotches: 0, noise: 2, bg: 262 }), Y = __wblot({ seed: 22, blotches: 0, noise: 2, bg: 262 });
    const dec = async c => { const im = new Image(); await new Promise(r => { im.onload = r; im.src = c.toDataURL('image/png'); }); return im; };
    const X2 = __crop(X, 0, 0, X.width, X.height); const x = X2.getContext('2d'); const p = x.getImageData(10, 10, 1, 1); p.data[0] ^= 1; x.putImageData(p, 10, 10);
    return { a: _xdHash(await dec(X)), b: _xdHash(await dec(X)), y: _xdHash(Y), one: _xdHash(X2) };
  });
  expect(r.a).toBe(r.b);
  expect(r.a).toMatch(/^[0-9a-f]{16}:480x200$/);
  expect(r.y).not.toBe(r.a);
  expect(r.one).not.toBe(r.a);
  expect(errors).toEqual([]);
});
