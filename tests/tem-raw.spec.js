// @ts-check
// Two figure-integrity features for the raw material behind a phage paper:
//   1. the Ruler, finished for TEM: a ruler on a calibrated panel reads its length from
//      the panel's SOURCE pixels and µm/px (nm below 1 µm), collects into a table with
//      n / mean / SD per name, exports CSV with each panel's calibration source, and
//      reaches the SVG as text; an uncalibrated or unmappable panel gets no length;
//   2. the uncropped-originals sheet (S1) journals ask for with blots and gels: each
//      ticked panel's whole source image with the crop outlined at its source
//      coordinates, as a multi-page PDF that also goes into the submission package.
// Each test says why it fails without its feature.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// In-page helpers, injected as source because page.evaluate cannot close over Node code.
const HELPERS = `
  // One grid panel from a generated bitmap; returns its index in images[].
  window._seed = async (iw, ih, name, fill) => {
    const c = document.createElement('canvas'); c.width = iw; c.height = ih;
    const x = c.getContext('2d'); x.fillStyle = fill || '#404040'; x.fillRect(0, 0, iw, ih);
    const src = c.toDataURL('image/png');
    await new Promise((res, rej) => { const img = new Image();
      img.onload = () => { _commitImage(img, src, name || 'tem.png'); res(); }; img.onerror = rej; img.src = src; });
    return images.length - 1;
  };
  // Figure point for a SOURCE pixel of panel i, through the inverse of _panelSourceMap
  // (frame -> figure; a tilted crop goes source -> frame first).
  window._fig = (i, u, v) => {
    const im = images[i], pb = panelBounds.find(p => p.idx === i), map = _panelSourceMap(pb, im);
    const g = _cropGeom(im);
    const [fu, fv] = g.rotated ? g.toFrame(u, v) : [u, v];
    return [map.dx + (fu - map.sx) / map.kx, map.dy + (fv - map.sy) / map.ky];
  };
  // A ruler between two SOURCE points of panel i.
  window._ruler = (i, u1, v1, u2, v2, extra) => {
    const W = canvasLogicalW, H = canvasLogicalH;
    const [a, b] = _fig(i, u1, v1), [c, d] = _fig(i, u2, v2);
    annotations.push(Object.assign({ type: 'ruler', xf: a / W, yf: b / H, x2f: c / W, y2f: d / H, color: '#ffffff', width: 2 }, extra || {}));
    render();
    return annotations.length - 1;
  };
  // Every string fillText draws during fn().
  window._drawn = (fn) => {
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, out = [];
    P.fillText = function (t, ...r) { out.push(String(t)); return orig.call(this, t, ...r); };
    try { fn(); } finally { P.fillText = orig; }
    return out;
  };
  window._grid = (cols, rows, w, h) => { sv('cols', cols); sv('rows', rows); sv('panel-w', w); sv('panel-h', h); onLayoutChange(); render(); };
  window._capture = async (fn) => { const r = await _captureDownload(fn); return r ? { name: r.name, text: new TextDecoder().decode(r.data), bytes: Array.from(r.data.subarray(0, 8)) } : null; };
`;

// A structural PDF check that shares nothing with the writer: header, trailer, the
// startxref offset lands on "xref", every xref entry lands on its own "N 0 obj", and the
// page tree's /Count matches the /Type /Page objects.
function pdfCheck(text) {
  const r = { header: text.startsWith('%PDF-'), eof: /%%EOF\s*$/.test(text) };
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  r.xrefAt = !!sx && text.substr(+sx[1], 4) === 'xref';
  const xr = /xref\s+0 (\d+)\s+([\s\S]*?)trailer/.exec(text);
  let ok = !!xr;
  if (xr) {
    const ents = xr[2].trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    ents.slice(1).forEach((l, k) => { const off = +l.slice(0, 10); if (!text.startsWith(`${k + 1} 0 obj`, off)) ok = false; });
    if (ents.length !== +xr[1]) ok = false;
  }
  r.xrefOk = ok;
  r.pages = (text.match(/\/Type \/Page\b(?!s)/g) || []).length;
  const c = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text);
  r.count = c ? +c[1] : -1;
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. The ruler
// ═══════════════════════════════════════════════════════════════════════════════

test('ruler: 200 source px at 2 nm/px reads 400 nm on the canvas, whatever the panel size, crop or tilt', async ({ page }) => {
  // Fails at HEAD: a ruler's label was rulerLabel:'' and nothing ever set it, so no
  // length is drawn at all (and _rulerMeasure does not exist).
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const i = await _seed(400, 400, 'capsids.tif');
    images[i].umPerPx = 0.002;                     // 2 nm per source pixel
    const out = [];
    const cases = [
      { w: 300, h: 300, crop: [0, 0, 0, 0], ang: 0 },
      { w: 700, h: 500, crop: [0, 0, 0, 0], ang: 0 },
      { w: 300, h: 300, crop: [10, 25, 15, 20], ang: 0 },   // T, L, B, R in %
      { w: 520, h: 260, crop: [5, 5, 5, 5], ang: 12 },      // tilted: the rotation is rigid
    ];
    for (const c of cases) {
      const im = images[i];
      [im.cropT, im.cropL, im.cropB, im.cropR] = c.crop; im.cropAngle = c.ang;
      im._cropCache = undefined; im._cropKey = undefined;
      _grid(1, 1, c.w, c.h);
      annotations.length = 0;
      const k = _ruler(i, 120, 200, 320, 200);   // 200 source px, inside every crop above
      const m = _rulerMeasure(annotations[k]);
      const drawn = _drawn(() => render());
      const map = _panelSourceMap(panelBounds[0], im);
      out.push({ status: m.status, label: m.label, um: m.um, srcPx: m.srcPx, drawn: drawn.filter(s => /nm|µm/.test(s)), kx: map.kx });
    }
    return out;
  });
  for (const c of r) {
    expect(c.status).toBe('ok');
    expect(Math.abs(c.um * 1000 - 400) / 400).toBeLessThan(0.01);   // within 1 %
    expect(c.label).toBe('400 nm');
    expect(c.drawn).toContain('400 nm');                            // and it is on the canvas
  }
  // The display scale really differed between the cases, so the length did not follow it.
  expect(new Set(r.map(c => c.kx.toFixed(3))).size).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('ruler: an uncalibrated or unmappable panel shows no length, only why', async ({ page }) => {
  // Fails at HEAD: no "uncalibrated" / "cannot map" note exists, and _rulerMeasure is missing.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const a = await _seed(400, 400, 'nocal.tif'), b = await _seed(400, 400, 'turned.tif');
    images[a].umPerPx = 0;                         // never calibrated
    images[b].umPerPx = 0.002; images[b].rotate = 90;   // calibrated, but turned
    _grid(2, 1, 300, 300);
    const ka = _ruler(a, 100, 200, 300, 200);
    // the turned panel has no exact inverse, so place its ruler by figure fractions
    const pb = panelBounds.find(p => p.idx === b), W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'ruler', xf: (pb.x + pb.w * 0.3) / W, yf: (pb.y + pb.h / 2) / H, x2f: (pb.x + pb.w * 0.7) / W, y2f: (pb.y + pb.h / 2) / H, color: '#fff', width: 2 });
    const kb = annotations.length - 1;
    const screen = _drawn(() => render());
    const exp = _drawn(() => renderExportCanvas(150));
    render();
    const csv = await _capture(() => exportRulerCSV());
    return { ma: _rulerMeasure(annotations[ka]), mb: _rulerMeasure(annotations[kb]), screen, exp, csv: csv.text };
  });
  expect(r.ma.status).toBe('uncal');
  expect(r.ma.label).toBe('');
  expect(r.ma.um).toBeNull();
  expect(r.mb.status).toBe('nomap');
  expect(r.mb.um).toBeNull();
  const lengthRe = /\d\s*(nm|µm|mm)\b/;
  expect(r.screen.filter(s => lengthRe.test(s))).toEqual([]);
  expect(r.screen).toContain('uncalibrated');
  expect(r.screen).toContain('cannot map');
  // the note is an editing aid; an export draws the bare ruler
  expect(r.exp.filter(s => /uncalibrated|cannot map/.test(s) || lengthRe.test(s))).toEqual([]);
  // the CSV rows carry no length either
  const rows = r.csv.split('\n').filter(l => /^[12],/.test(l));
  expect(rows.length).toBe(2);
  rows.forEach(l => { const f = l.split(','); expect(f[4]).toBe(''); expect(f[5]).toBe(''); expect(f[6]).toBe(''); });
  expect(errors).toEqual([]);
});

test('ruler: dragging an end, recalibrating and re-cropping all update the label and the table; a drag is one undo step', async ({ page }) => {
  // Fails at HEAD: the label never exists, a ruler gets bounding-box corner handles (its
  // second end cannot be dragged on its own), and there is no ruler table.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const pts = await page.evaluate(async () => {
    const i = await _seed(400, 400, 'tails.tif'); images[i].umPerPx = 0.002;
    _grid(1, 1, 400, 400);
    setTool('none');
    const k = _ruler(i, 100, 200, 300, 200);       // 200 px -> 400 nm
    const toClient = (u, v) => { const [fx, fy] = _fig(i, u, v); const rc = annCanvas.getBoundingClientRect();
      return [rc.left + fx * rc.width / canvasLogicalW, rc.top + fy * rc.height / canvasLogicalH]; };
    return { mid: toClient(200, 200), end: toClient(300, 200), to: toClient(200, 260), k };
  });
  const before = await page.evaluate(() => ({ label: _rulerMeasure(annotations[0]).label, undo: undoStack.length }));
  expect(before.label).toBe('400 nm');
  await page.mouse.click(pts.mid[0], pts.mid[1]);                     // select the ruler
  await page.mouse.move(pts.end[0], pts.end[1]);
  await page.mouse.down();                                            // grab its second end
  await page.mouse.move((pts.end[0] + pts.to[0]) / 2, (pts.end[1] + pts.to[1]) / 2, { steps: 4 });
  await page.mouse.move(pts.to[0], pts.to[1], { steps: 4 });
  await page.mouse.up();
  const r = await page.evaluate(async () => {
    await new Promise(res => setTimeout(res, 50)); render();
    const m = _rulerMeasure(annotations[0]);
    const table1 = document.getElementById('ruler-results').innerHTML;
    const undoAfterDrag = undoStack.length;
    images[0].umPerPx = 0.004; render();                              // recalibrate
    const recal = _rulerMeasure(annotations[0]).label, table2 = document.getElementById('ruler-results').innerHTML;
    images[0].umPerPx = 0.002; Object.assign(images[0], { cropT: 10, cropL: 10, cropB: 10, cropR: 10 }); render();   // re-crop: same figure line, other source pixels
    const rc = _rulerMeasure(annotations[0]), recrop = rc.srcPx, recropStatus = rc.status;
    Object.assign(images[0], { cropT: 0, cropL: 0, cropB: 0, cropR: 0 }); render();
    undo(); render();
    return { srcPx: m.srcPx, label: m.label, table1, undoAfterDrag, recal, table2, recrop, recropStatus,
      afterUndo: _rulerMeasure(annotations[0]).label };
  });
  // the end moved from source (300,200) to about (200,260): 100 px across, 60 down
  expect(Math.abs(r.srcPx - Math.hypot(100, 60))).toBeLessThan(3);
  expect(r.label).not.toBe('400 nm');
  expect(r.table1).toContain(r.label);
  expect(r.undoAfterDrag).toBe(before.undo + 1);
  expect(parseFloat(r.recal)).toBeCloseTo(parseFloat(r.label) * 2, -1);   // twice the µm/px, twice the length
  expect(r.table2).toContain(r.recal);
  expect(r.recropStatus).toBe('ok');
  expect(r.recrop).toBeCloseTo(r.srcPx * 0.8, 0);                  // 320 source px now fill 400 figure px
  expect(r.afterUndo).toBe('400 nm');                                // one undo puts the end back
  expect(errors).toEqual([]);
});

test('ruler: rulers named alike give n, mean and SD per panel; names are one undo step each', async ({ page }) => {
  // Fails at HEAD: there is no name field, no table and no _rulerStats.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const a = await _seed(400, 400, 'A.tif'), b = await _seed(400, 400, 'B.tif'), c = await _seed(400, 400, 'C.tif');
    images[a].umPerPx = 0.002; images[b].umPerPx = 0.001; images[c].umPerPx = 0;
    _grid(3, 1, 300, 300);
    _ruler(a, 50, 50, 80, 50);      // 30 px  -> 60 nm
    _ruler(a, 50, 100, 81, 100);    // 31 px  -> 62 nm
    _ruler(a, 50, 150, 82, 150);    // 32 px  -> 64 nm
    _ruler(a, 50, 250, 150, 250);   // 100 px -> 200 nm, a tail
    _ruler(b, 50, 50, 100, 50);     // 50 px at 1 nm/px -> 50 nm, another panel
    _ruler(c, 50, 50, 100, 50);     // uncalibrated: not a measurement
    render();
    const names = ['capsid', 'capsid', 'capsid', 'tail', 'capsid', 'capsid'];
    const steps = [];
    for (let k = 0; k < names.length; k++) {
      const inp = document.querySelector(`#ruler-results .ruler-name[data-ann="${k}"]`);
      const u0 = undoStack.length;
      inp.value = names[k]; inp.dispatchEvent(new Event('change', { bubbles: true }));
      steps.push(undoStack.length - u0);
    }
    render();
    return { stats: _rulerStats(), steps, html: document.getElementById('ruler-results').innerHTML,
      names: annotations.map(x => x.rulerName) };
  });
  expect(r.steps).toEqual([1, 1, 1, 1, 1, 1]);
  expect(r.names).toEqual(['capsid', 'capsid', 'capsid', 'tail', 'capsid', 'capsid']);
  const capA = r.stats.find(s => s.name === 'capsid' && s.panel === 'A');
  expect(capA.n).toBe(3);
  expect(capA.unit).toBe('nm');
  expect(capA.umMean * 1000).toBeCloseTo(62, 6);
  expect(capA.umSd * 1000).toBeCloseTo(2, 6);                        // SD of 60, 62, 64 with n−1
  const tailA = r.stats.find(s => s.name === 'tail' && s.panel === 'A');
  expect(tailA.n).toBe(1); expect(tailA.umSd).toBeNull(); expect(tailA.meanText).toBe('200');
  const capB = r.stats.find(s => s.name === 'capsid' && s.panel === 'B');
  expect(capB.n).toBe(1); expect(capB.meanText).toBe('50');
  expect(r.stats.find(s => s.panel === 'C')).toBeUndefined();        // the uncalibrated ruler is no measurement
  expect(r.stats.length).toBe(3);
  expect(r.html).toContain('n = 3, 62 ± 2 nm');
  expect(errors).toEqual([]);
});

test('ruler CSV: the header states where each panel\'s calibration came from, and the Methods paragraph still agrees', async ({ page }) => {
  // Fails at HEAD: exportRulerCSV does not exist.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const ids = [];
    for (const n of ['meta.tif', 'hand.tif', 'old.tif', 'none.tif']) ids.push(await _seed(400, 400, n));
    const [A, B, C, D] = ids.map(i => images[i]);
    A.umPerPx = 0.002; A._metaUmPerPx = 0.002; A._metaCalibSource = 'TEM TIFF';
    B.umPerPx = 0.001; B._metaUmPerPx = 0;                          // typed in
    C.umPerPx = 0.005; delete C._metaUmPerPx;                       // provenance never recorded
    D.umPerPx = 0;
    _grid(4, 1, 250, 250);
    ids.forEach(i => _ruler(i, 100, 100, 131, 100, { rulerName: 'capsid' }));
    const csv = await _capture(() => exportRulerCSV());
    return { csv: csv.text, name: csv.name, methods: generateMethodsParagraph() };
  });
  expect(r.name).toBe('figurelab-rulers.csv');
  const head = r.csv.split('\n').filter(l => l.startsWith('# Calibration'));
  expect(head.length).toBe(4);
  expect(head[0]).toMatch(/panel A \(meta\.tif\): 0\.002 µm\/px, read from TEM TIFF metadata/);
  expect(head[1]).toMatch(/panel B \(hand\.tif\): 0\.001 µm\/px, set by hand/);
  expect(head[2]).toMatch(/panel C \(old\.tif\): 0\.005 µm\/px, source unknown/);
  expect(head[3]).toMatch(/panel D \(none\.tif\): uncalibrated — no lengths reported/);
  // rows: A 31 px x 2 nm = 62 nm; B 31 nm; C 155 nm; D none
  const rows = r.csv.split('\n').filter(l => /^[1-4],capsid,/.test(l)).map(l => l.split(','));
  expect(rows.map(f => f[4] + ' ' + f[5])).toEqual(['62 nm', '31 nm', '155 nm', ' ']);
  expect(rows[0][9]).toBe('read from TEM TIFF metadata');
  expect(r.csv).toMatch(/^Name,Panel,n,Mean,SD,Unit$/m);
  // the refactor kept the Methods paragraph's three cases
  expect(r.methods).toMatch(/read from TEM TIFF metadata for panel A/);
  expect(r.methods).toMatch(/set by hand for panel B/);
  expect(r.methods).toMatch(/0\.005 µm per pixel for panel C/);
  expect(errors).toEqual([]);
});

test('ruler SVG: the ruler is vector and its length is real <text>', async ({ page }) => {
  // Fails at HEAD: exportSVG had no ruler case, so a ruler vanished from the SVG.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const i = await _seed(400, 400, 'capsids.tif'); images[i].umPerPx = 0.002;
    const u = await _seed(400, 400, 'nocal.tif'); images[u].umPerPx = 0;
    _grid(2, 1, 300, 300);
    _ruler(i, 100, 200, 131, 200);   // 31 px -> 62 nm
    _ruler(u, 100, 200, 300, 200);   // uncalibrated
    const svg = await _capture(() => exportSVG('fig', 150, document.getElementById('fig-canvas')));
    return svg.text;
  });
  expect(r).toMatch(/<text[^>]*>62 nm<\/text>/);
  expect((r.match(/<path d="M[^"]*" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none"\/>/g) || []).length).toBe(2);
  expect(r).not.toMatch(/uncalibrated/);
  expect((r.match(/>\d+(\.\d+)? (nm|µm|mm)<\/text>/g) || []).length).toBe(1);
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Uncropped originals (S1)
// ═══════════════════════════════════════════════════════════════════════════════

test('S1: the dialog ticks cropped / spliced panels by default and the PDF holds exactly the ticked ones, one page each', async ({ page }) => {
  // Fails at HEAD: openS1Dialog, the button, the command and the sheet do not exist.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const a = await _seed(300, 200, 'blotA.tif', '#777'), b = await _seed(300, 200, 'blotB.tif', '#888'), c = await _seed(300, 200, 'gelC.tif', '#999');
    images[a].cropT = 10; images[a].cropB = 10;                          // A: cropped
    _grid(3, 1, 240, 160);
    selectedPanel = c; addSpliceMarker();                               // C: spliced
    render();
    const btn = !!document.querySelector('button[onclick="openS1Dialog()"][title]');
    const cmd = CMD_REGISTRY.some(x => /uncropped originals/i.test(x.label));
    openS1Dialog();
    const ticks = [...document.querySelectorAll('#s1-modal-bg .s1-tick')];
    const defaults = ticks.map(t => t.checked);
    // the author unticks C and ticks B
    ticks[1].checked = true; ticks[2].checked = false;
    let cap = null; const origDl = window.dl; window.dl = (u, n) => { cap = { u, n }; };
    const u0 = undoStack.length;
    document.getElementById('s1-pdf').click();
    for (let k = 0; k < 100 && !cap; k++) await new Promise(res => setTimeout(res, 50));
    window.dl = origDl;
    const text = new TextDecoder('latin1').decode(new Uint8Array(await (await fetch(cap.u)).arrayBuffer()));
    const steps = undoStack.length - u0;
    const s1 = images.map(im => im.s1);
    undo();
    return { btn, cmd, defaults, name: cap.n, text, steps, s1, s1AfterUndo: images.map(im => im.s1),
      reasons: images.map(im => _s1Reasons(im)) };
  });
  expect(r.btn).toBe(true);
  expect(r.cmd).toBe(true);
  expect(r.defaults).toEqual([true, false, true]);
  expect(r.reasons).toEqual([['cropped'], [], ['splice marker']]);
  expect(r.name).toBe('S1_uncropped_originals.pdf');
  const p = pdfCheck(r.text);
  expect(p).toEqual({ header: true, eof: true, xrefAt: true, xrefOk: true, pages: 2, count: 2 });
  expect(r.text).toContain('(Panel A ');
  expect(r.text).toContain('(Panel B ');
  expect(r.text).not.toContain('(Panel C ');
  expect(r.text).toContain('Source file: blotA.tif');
  expect(r.steps).toBe(1);                                            // the dialog's choice is one undo step
  expect(r.s1).toEqual([undefined, true, false]);
  expect(r.s1AfterUndo).toEqual([undefined, undefined, undefined]);
  expect(errors).toEqual([]);
});

test('S1: the outline is drawn at the crop\'s source coordinates, and a splice marker maps back to source pixels', async ({ page }) => {
  // Fails at HEAD: _s1PageCanvas / _s1Geometry do not exist.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const i = await _seed(300, 200, 'blot.tif', '#606060');
    const im = images[i];
    im.cropT = 20; im.cropL = 10; im.cropB = 10; im.cropR = 30;         // x 30–210, y 40–180
    im.contrast = 1.6;                                                   // a display adjustment the sheet must not apply
    _grid(1, 1, 500, 400);                                               // a different display scale from the source
    selectedPanel = i; addSpliceMarker(); render();                      // at the middle of the drawn crop
    const p = _s1PageCanvas(im, { forPdf: true });
    const px = (u, v) => Array.from(p.canvas.getContext('2d').getImageData(Math.round(p.imgX + u * p.scale), Math.round(p.imgY + v * p.scale), 1, 1).data).slice(0, 3);
    return { g: p.geom, scale: p.scale,
      topMid: px(120, 40), leftMid: px(30, 110), rightMid: px(210, 110), botMid: px(120, 180),
      outside: px(120, 30), inside: px(80, 70), farOut: px(260, 20),
      text: p.items.map(t => t.str).join(' | ') };
  });
  expect(r.scale).toBe(1);
  expect([r.g.sx, r.g.sy, r.g.sw, r.g.sh]).toEqual([30, 40, 180, 140]);
  const magenta = [255, 0, 255];
  expect(r.topMid).toEqual(magenta);
  expect(r.leftMid).toEqual(magenta);
  expect(r.rightMid).toEqual(magenta);
  expect(r.botMid).toEqual(magenta);
  // off the outline the original pixels are untouched: #606060, contrast not applied
  expect(r.outside).toEqual([96, 96, 96]);
  expect(r.inside).toEqual([96, 96, 96]);
  expect(r.farOut).toEqual([96, 96, 96]);
  // the splice marker addSpliceMarker drops at the middle of the drawn image is x = 120 in the source
  expect(r.g.splices.length).toBe(1);
  expect(r.g.splices[0].mapped).toBe(true);
  expect(Math.abs(r.g.splices[0].p1[0] - 120)).toBeLessThan(1);
  expect(Math.abs(r.g.splices[0].p2[0] - 120)).toBeLessThan(1);
  expect(r.text).toContain('Crop (source px): x 30–210, y 40–180 (180 × 140 px)');
  expect(r.text).toMatch(/without display adjustments\. The figure panel has: contrast 1\.6/);
  expect(r.text).toMatch(/Splice marker \(source px, dashed\): \(120, /);
  expect(errors).toEqual([]);
});

test('S1: a tilted crop is outlined through its rotated corners, not its axis-aligned box', async ({ page }) => {
  // Fails at HEAD: there is no sheet; and an outline drawn from sx/sy/sw/sh alone would
  // miss the rotated edge checked here by ~14 px.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const i = await _seed(400, 300, 'tilted.tif', '#505050');
    const im = images[i];
    im.cropT = 25; im.cropB = 25; im.cropL = 27.5; im.cropR = 27.5; im.cropAngle = 15;   // 180 × 150, centred
    _grid(1, 1, 300, 300);
    const p = _s1PageCanvas(im, { forPdf: true });
    // corners computed here from first principles: rotate the frame rect about the image centre
    const t = 15 * Math.PI / 180, Cx = 200, Cy = 150, sx = 110, sy = 75, sw = 180, sh = 150;
    const rot = ([x, y]) => [Cx + (x - Cx) * Math.cos(t) - (y - Cy) * Math.sin(t), Cy + (x - Cx) * Math.sin(t) + (y - Cy) * Math.cos(t)];
    const want = [[sx, sy], [sx + sw, sy], [sx + sw, sy + sh], [sx, sy + sh]].map(rot);
    const ctx = p.canvas.getContext('2d');
    const at = ([u, v]) => Array.from(ctx.getImageData(Math.round(p.imgX + u * p.scale), Math.round(p.imgY + v * p.scale), 1, 1).data).slice(0, 3);
    const lerp = (P, Q, f) => [P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f];
    return { got: p.geom.corners, want, rotated: p.geom.rotated,
      onRotEdge: at(lerp(want[0], want[1], 0.25)), onRotLeft: at(lerp(want[0], want[3], 0.5)),
      onAxisEdge: at(lerp([sx, sy], [sx + sw, sy], 0.25)),
      text: p.items.map(x => x.str).join(' ') };
  });
  expect(r.rotated).toBe(true);
  r.got.forEach((c, k) => { expect(c[0]).toBeCloseTo(r.want[k][0], 6); expect(c[1]).toBeCloseTo(r.want[k][1], 6); });
  // a rotated line is antialiased, so 'magenta' means strongly magenta, not exactly #ff00ff
  const isMagenta = ([R, G, B]) => R > 200 && G < 70 && B > 200;
  expect(isMagenta(r.onRotEdge)).toBe(true);
  expect(isMagenta(r.onRotLeft)).toBe(true);
  expect(r.onAxisEdge).toEqual([80, 80, 80]);       // the unrotated box's edge is just the image
  expect(r.text).toMatch(/tilted 15°/);
  expect(r.text).toMatch(/TL \(\d+(\.\d)?, \d+(\.\d)?\)/);
  expect(errors).toEqual([]);
});

test('S1: the submission package carries S1_uncropped_originals.pdf once a blot panel exists, one page per such panel', async ({ page }) => {
  // Fails at HEAD: the package never contains an S1 file.
  test.setTimeout(120000);
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(`
    window._zipRead = async (bytes) => {
      const dv = new DataView(bytes.buffer, bytes.byteOffset); const out = {}; let p = 0;
      while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
        const cs = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl)); const d = p + 30 + nl + el;
        const raw = bytes.subarray(d, d + cs); out[name] = (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw); p = d + cs; }
      return out; };
  `);
  const r = await page.evaluate(async () => {
    await _seed(240, 160, 'plain1.tif', '#777'); await _seed(240, 160, 'plain2.tif', '#888');
    _grid(2, 1, 200, 140); sv('export-dpi', '150');
    const pkg = async () => { const z = await _captureDownload(() => exportSubmissionPackage()); const f = await _zipRead(z.data);
      const s1 = f['S1_uncropped_originals.pdf']; return { names: Object.keys(f), s1: s1 ? new TextDecoder('latin1').decode(s1) : null }; };
    const none = await pkg();
    images[0].cropL = 20; images[0].cropR = 5; render();                 // a cropped blot
    const one = await pkg();
    selectedPanel = 1; addSpliceMarker(); render();                      // and a spliced one
    const two = await pkg();
    return { none: none.names.includes('S1_uncropped_originals.pdf'), one: one.s1, two: two.s1 };
  });
  expect(r.none).toBe(false);
  expect(r.one).not.toBeNull();
  expect(pdfCheck(r.one)).toEqual({ header: true, eof: true, xrefAt: true, xrefOk: true, pages: 1, count: 1 });
  expect(pdfCheck(r.two)).toEqual({ header: true, eof: true, xrefAt: true, xrefOk: true, pages: 2, count: 2 });
  expect(r.two).toContain('Source file: plain2.tif');
  expect(errors).toEqual([]);
});

test('S1: an image cropped as it was imported is not presented as the uncropped scan', async ({ page }) => {
  // Fails at HEAD: crop-on-import keeps no record of itself, so the sheet would show the
  // stored crop as though it were the whole original.
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    c.getContext('2d').fillStyle = '#777'; c.getContext('2d').fillRect(0, 0, 400, 300);
    const src = c.toDataURL('image/png');
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    _openPreCrop({ img, src, name: 'scan.tif' });
    Object.assign(cropEdState, { cx: 0.1, cy: 0.2, cw: 0.5, ch: 0.5, ang: 0 });
    applyCropModal();                                   // the real crop-on-import path
    for (let k = 0; k < 100 && !images.length; k++) await new Promise(res => setTimeout(res, 20));
    const im = images[0];
    const p = _s1PageCanvas(im, { forPdf: true });
    return { rec: im._importCrop, w: im.img.naturalWidth, text: p.items.map(t => t.str).join(' ') };
  });
  expect(r.w).toBe(200);
  expect(r.rec).toEqual({ x: 40, y: 60, w: 200, h: 150, iw: 400, ih: 300, ang: 0 });
  expect(r.text).toMatch(/Cropped when imported into FigureLab \(from a 400 × 300 px file/);
  expect(r.text).toMatch(/not the full scan/);
  expect(errors).toEqual([]);
});
