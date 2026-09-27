// @ts-check
// Three export features that meet in the Save dialog, the compliance check and the
// submission package:
//   1. each panel's effective resolution (ppi) — the number the journals' 300 dpi rule
//      is actually about, which the figure-level DPI row never measured;
//   2. the image-processing paragraph for the Methods, written from the figure's state;
//   3. LZW-compressed TIFF (lossless, Predictor 2), which PLOS asks for.
// Each test says why it fails without its feature. The LZW round trip also writes its
// files to tests/.tiffout/ so validate_tiff.py can check them with Pillow, a decoder
// that shares none of FigureLab's code.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { loadApp, seedPanels } = require('./helpers');

const TIFF_OUT = path.join(__dirname, '.tiffout');

// In-page readers, injected as source because page.evaluate cannot close over Node code.
const PARSERS = `
  // Little-endian TIFF, first IFD → { tag: value } (offset for anything not inline),
  // plus the tags in file order so ascending order can be checked.
  window._tiffTags = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ifd = dv.getUint32(4, true), n = dv.getUint16(ifd, true), t = { _order: [] };
    for (let i = 0; i < n; i++) {
      const o = ifd + 2 + i * 12, tag = dv.getUint16(o, true), type = dv.getUint16(o + 2, true), cnt = dv.getUint32(o + 4, true);
      t[tag] = (type === 3 && cnt === 1) ? dv.getUint16(o + 8, true) : dv.getUint32(o + 8, true);
      t._order.push(tag);
    }
    t.xres = t[282] ? dv.getUint32(t[282], true) / dv.getUint32(t[282] + 4, true) : null;
    return t;
  };
  // Stored (method 0) ZIP → { name: Uint8Array }. The app's writer never deflates.
  window._zipRead = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const csize = dv.getUint32(p + 18, true);
      const nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
      const dataOff = p + 30 + nlen + elen;
      out[name] = bytes.subarray(dataOff, dataOff + csize);
      p = dataOff + csize;
    }
    return out;
  };
  window._b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
`;

// One panel of a known size in a 1 × 1 grid, drawn into a cell of cw × ch logical px.
async function onePanel(page, iw, ih, cw, ch) {
  await page.evaluate(async ([iw, ih, cw, ch]) => {
    const c = document.createElement('canvas'); c.width = iw; c.height = ih;
    const x = c.getContext('2d'); x.fillStyle = '#556677'; x.fillRect(0, 0, iw, ih);
    x.fillStyle = '#fff'; x.fillRect(4, 4, 10, 10);
    const src = c.toDataURL('image/png');
    await new Promise((res, rej) => { const img = new Image();
      img.onload = () => { _commitImage(img, src, 'p.png'); res(); }; img.onerror = rej; img.src = src; });
    sv('cols', 1); sv('rows', 1); sv('panel-w', cw); sv('panel-h', ch);
    sv('export-width-mm', '0'); sv('export-dpi', '300');
    onLayoutChange(); render();
  }, [iw, ih, cw, ch]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Effective resolution per panel
// ═══════════════════════════════════════════════════════════════════════════════

test('ppi: a 100 px panel drawn 200 px wide prints at 48 ppi, whatever the DPI', async ({ page }) => {
  // Fails at HEAD: _panelEffPpi does not exist, and nothing measures a panel's own density.
  const errors = await loadApp(page);
  await onePanel(page, 100, 100, 200, 200);
  const r = await page.evaluate(() => ({
    at300: _panelEffPpi(0, 300), at600: _panelEffPpi(0, 600),
    // the list row, filled at the end of render()
    row: document.querySelector('.f-ppi[data-ppi="0"]')?.textContent,
    rowColour: document.querySelector('.f-ppi[data-ppi="0"]')?.style.color,
  }));
  // Contain-fit at 2×; one logical px prints at 1/96 in, so 100 px / (200/96 in) = 48 ppi.
  expect(Math.round(r.at300.ppi)).toBe(48);
  expect(Math.round(r.at600.ppi)).toBe(48);            // the DPI adds pixels, not detail
  expect(r.at300.enlarge).toBeCloseTo(6.25, 5);         // 2 × 300/96 export px per source px
  expect(r.at600.enlarge).toBeCloseTo(12.5, 5);
  expect(r.row).toBe('48 ppi · enlarged 6.3×');
  expect(r.rowColour).toBe('var(--warn)');
  expect(errors).toEqual([]);
});

test('ppi: the printed column width sets it, the crop divides it, a turn uses the turned extent', async ({ page }) => {
  // Fails at HEAD: _panelEffPpi is undefined. Each expectation below also fails for a
  // version that ignored the target width, the crop, or the rotation.
  const errors = await loadApp(page);
  await onePanel(page, 100, 100, 200, 200);
  const r = await page.evaluate(() => {
    sv('export-width-mm', '89'); render();
    const lw = canvasLogicalW;
    const col = { got: _panelEffPpi(0, 300).ppi, got600: _panelEffPpi(0, 600).ppi,
                  // 100 source px across 200 logical px, and the figure is 89 mm across lw px
                  want: 100 / (200 * (89 / 25.4) / lw) };
    sv('export-width-mm', '0');
    Object.assign(images[0], { cropL: 25, cropR: 25, cropT: 25, cropB: 25 }); render();
    const crop = _panelEffPpi(0, 300).ppi;               // 50 px across the same 200 px
    return { col, crop };
  });
  expect(Math.abs(r.col.got - r.col.want)).toBeLessThan(1);
  expect(Math.abs(r.col.got600 - r.col.got)).toBeLessThan(1e-9);
  expect(Math.abs(r.col.got - 48)).toBeGreaterThan(1);  // the width really changed it
  expect(Math.round(r.crop)).toBe(24);
  expect(errors).toEqual([]);
});

test('ppi: a quarter-turned panel is measured along the extent it is drawn at', async ({ page }) => {
  // Fails at HEAD: no _panelEffPpi. A fit that ignored the turn would put the 200 × 100
  // picture in the 100 × 200 cell at 0.5× and report 192 ppi instead of 96.
  const errors = await loadApp(page);
  await onePanel(page, 200, 100, 100, 200);
  const r = await page.evaluate(() => {
    images[0].rotate = 90; render();
    const turned = _panelEffPpi(0, 300).ppi;
    images[0].rotate = 0; sv('panel-w', 200); sv('panel-h', 100); onLayoutChange(); render();
    return { turned, flat: _panelEffPpi(0, 300).ppi };
  });
  expect(Math.round(r.turned)).toBe(96);
  expect(Math.round(r.flat)).toBe(96);
  expect(errors).toEqual([]);
});

test('ppi: the compliance check and the Save dialog name the panel printed below 300 ppi', async ({ page }) => {
  // Fails at HEAD: there is no Panel resolution row (the report only checks the figure's
  // DPI, which is 300 and passes), and the Save dialog shows "✓ No integrity warnings".
  const errors = await loadApp(page);
  await onePanel(page, 100, 100, 200, 200);
  const r = await page.evaluate(() => {
    const row = () => { checkCompliance();
      return [...document.querySelectorAll('#info-modal-bg .compliance-row')]
        .map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(t => /Panel resolution/.test(t)) || ''; };
    const low = row();
    const fixBtn = !![...document.querySelectorAll('#info-modal-bg button')].find(b => b.textContent === 'Select panel');
    doExportPreflight('png');
    const dialog = document.getElementById('preflight-body').textContent;
    closePreflight();
    // shrink the panel until its 100 px are packed into 20 logical px: 480 ppi
    sv('panel-w', 20); sv('panel-h', 20); onLayoutChange(); render();
    const fine = row();
    return { low, fixBtn, dialog, fine };
  });
  expect(r.low).toContain('⚠');
  expect(r.low).toContain('A 48 ppi');
  expect(r.low).toContain('below 300');
  expect(r.fixBtn).toBe(true);
  expect(r.dialog).toContain('below 300 ppi');
  expect(r.dialog).toContain('A 48 ppi');
  expect(r.fine).toContain('✓');
  expect(r.fine).toContain('lowest 480 ppi');
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Methods paragraph
// ═══════════════════════════════════════════════════════════════════════════════

test('methods: names the software, version and DOI, and agrees with the caption on uniformity', async ({ page }) => {
  // Fails at HEAD: generateMethodsParagraph, writeMethodsParagraph and #methods-out do not exist.
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    sv('cols', 3); sv('rows', 1); onLayoutChange(); render();
    images.forEach(im => { im.blackPt = 10; im.whitePt = 240; });
    writeMethodsParagraph();
    const uniform = document.getElementById('methods-out').value;
    generateCaption(); const capUniform = document.getElementById('caption-out').value;
    images[1].gamma = 0.8;
    const differ = generateMethodsParagraph();
    generateCaption(); const capDiffer = document.getElementById('caption-out').value;
    return { v: APP_VERSION, uniform, capUniform, differ, capDiffer, again: generateMethodsParagraph() };
  });
  expect(r.uniform).toContain('FigureLab v' + r.v);
  expect(r.uniform).toContain('zenodo.21269456');
  expect(r.uniform).toMatch(/identical settings on every panel/);
  expect(r.uniform).not.toMatch(/gamma/i);
  expect(r.capUniform).toMatch(/same adjustment settings were applied to every panel/);
  expect(r.differ).toMatch(/non-linear gamma adjustment was applied to panel B \(γ = 0\.80\)/);
  expect(r.differ).toMatch(/Adjustment settings differ between panels/);
  expect(r.capDiffer).toMatch(/differ between panels/);  // one predicate, so they cannot disagree
  expect(r.again).toBe(r.differ);                          // no dates: the same figure, the same text
  expect(errors).toEqual([]);
});

test('methods: says where the pixel size came from', async ({ page }) => {
  // Fails at HEAD: generateMethodsParagraph is undefined.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const t = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 1); onLayoutChange(); render();
    Object.assign(images[0], { umPerPx: 0.108, _metaUmPerPx: 0.108, _metaCalibSource: 'OME-TIFF' });
    Object.assign(images[1], { umPerPx: 0.65 });
    return generateMethodsParagraph();
  });
  expect(t).toMatch(/read from OME-TIFF metadata for panel A \(0\.108 µm per pixel\)/);
  expect(t).toMatch(/set by hand for panel B \(0\.65 µm per pixel\)/);
  expect(errors).toEqual([]);
});

test('methods: a panel whose calibration source was never recorded is not said to be set by hand', async ({ page }) => {
  // A panel from a session saved before _metaUmPerPx was kept has no record of where
  // its pixel size came from. "Set by hand" would be a false disclosure; the value
  // alone is the honest sentence. Fails before the three-way split, which printed
  // "set by hand for panel B" here.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const t = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 1); onLayoutChange(); render();
    Object.assign(images[0], { umPerPx: 0.108, _metaUmPerPx: 0.108, _metaCalibSource: 'OME-TIFF' });
    images[1].umPerPx = 0.65; delete images[1]._metaUmPerPx; delete images[1]._metaCalibSource;
    return generateMethodsParagraph();
  });
  expect(t).toMatch(/read from OME-TIFF metadata for panel A/);
  expect(t).toMatch(/0\.65 µm per pixel for panel B/);
  expect(t).not.toMatch(/set by hand/);
  expect(errors).toEqual([]);
});

test('methods: projections and splices are recorded, not guessed, and a hidden panel is not described', async ({ page }) => {
  // Fails at HEAD: projectTickedPanels sets no _projection and addSpliceMarker pushes a
  // plain line with no splice flag, so there is nothing for the paragraph to read — and
  // the paragraph itself does not exist.
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    const picks = document.querySelectorAll('#img-list .panel-pick');
    picks[0].checked = true; picks[1].checked = true;
    projectTickedPanels('max');
  });
  await page.waitForFunction(() => images.some(im => im && im._projection));
  const r = await page.evaluate(() => {
    render();
    // gamma on the last panel only; hidden later, the paragraph must stop describing it
    const last = images.length - 1;
    images[last].gamma = 1.4;
    const lastLabel = formatLabel(images[last].label);
    selectedPanel = 0;                 // the splice goes on panel A, whatever was selected
    const before = undoStack.length;
    addSpliceMarker();
    const steps = undoStack.length - before;   // read before hiding, which is its own step
    const a = annotations[annotations.length - 1];
    const withSplice = generateMethodsParagraph();
    togglePanelExcluded(last);
    return { splice: a.splice, onPanel: a.splicePanel === images[0].id, steps,
             proj: images.find(im => im._projection)._projection, withSplice, lastLabel,
             hidden: generateMethodsParagraph() };
  });
  expect(r.proj).toEqual({ mode: 'max', n: 2 });
  expect(r.withSplice).toMatch(/maximum-intensity projection of 2 source panels, computed on 8-bit display values/);
  expect(r.splice).toBe(true);
  expect(r.onPanel).toBe(true);
  expect(r.steps).toBe(1);
  expect(r.withSplice).toMatch(/Splice boundaries are marked with dividing lines \(panel A\)/);
  expect(r.withSplice).toMatch(/gamma/);
  expect(r.hidden).not.toMatch(/gamma/);
  expect(r.withSplice).toMatch(new RegExp('\\b' + r.lastLabel + '\\b'));   // it was named while shown…
  expect(r.hidden).not.toMatch(new RegExp('\\b' + r.lastLabel + '\\b'));   // …and not at all once hidden
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LZW-compressed TIFF
// ═══════════════════════════════════════════════════════════════════════════════

test('lzw: an LZW TIFF decodes back to exactly the pixels of the uncompressed one', async ({ page }) => {
  // Fails at HEAD: exportTIFF ignores its fifth argument, so tag 259 is 1, there is no
  // Predictor tag, and the "compressed" file is the same size as the uncompressed one.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(PARSERS);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 2); sv('panel-w', 100); sv('panel-h', 100); sv('export-width-mm', '0');
    onLayoutChange(); render();
    const tc = renderExportCanvas(300);
    const plain = await _captureDownload(() => exportTIFF('t', 300, tc, true));
    const off = await _captureDownload(() => exportTIFF('t', 300, tc, true, { lzw: false }));
    const lzw = await _captureDownload(() => exportTIFF('t', 300, tc, true, { lzw: true }));
    const T = _tiffTags(lzw.data), P = _tiffTags(plain.data);
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const d = await decodeTIFF(lzw.data, 0);
    // the uncompressed file's strip is the ground truth, read straight from its bytes
    const strip = plain.data.subarray(P[273], P[273] + P[279]);
    let firstBad = -1;
    for (let i = 0; i < d.width * d.height; i++) {
      if (d.rgba[i*4] !== strip[i*3] || d.rgba[i*4+1] !== strip[i*3+1] || d.rgba[i*4+2] !== strip[i*3+2]) { firstBad = i; break; }
    }
    return { W: tc.width, H: tc.height, T, P, dW: d.width, dH: d.height, firstBad,
             stripIsWholeLzwTail: T[273] + T[279] === lzw.data.length,
             defaultEqualsOff: same(plain.data, off.data),
             sizes: { plain: plain.data.length, lzw: lzw.data.length },
             lzwB64: _b64(lzw.data), plainB64: _b64(plain.data) };
  });
  expect(r.T[259]).toBe(5);                 // LZW
  expect(r.T[317]).toBe(2);                 // horizontal differencing
  expect(r.P[259]).toBe(1);                 // the default is still uncompressed…
  expect(r.P[317]).toBeUndefined();
  expect(r.defaultEqualsOff).toBe(true);    // …and {lzw:false} writes the same bytes
  expect(r.T._order).toEqual([...r.T._order].sort((a, b) => a - b));   // TIFF wants ascending tags
  expect(r.T.xres).toBe(300);
  expect(r.stripIsWholeLzwTail).toBe(true);
  expect(r.sizes.lzw).toBeLessThan(r.sizes.plain);
  expect([r.dW, r.dH]).toEqual([r.W, r.H]);
  expect(r.firstBad).toBe(-1);              // every sample identical to the uncompressed export
  // Hand both files to validate_tiff.py, which checks them with Pillow.
  fs.mkdirSync(TIFF_OUT, { recursive: true });
  fs.writeFileSync(path.join(TIFF_OUT, 'figure_lzw.tif'), Buffer.from(r.lzwB64, 'base64'));
  fs.writeFileSync(path.join(TIFF_OUT, 'figure_raw.tif'), Buffer.from(r.plainB64, 'base64'));
  expect(errors).toEqual([]);
});

test('lzw: the Save dialog offers it for TIFF only, and ticking it is one undo step', async ({ page }) => {
  // Fails at HEAD: #pf-lzw-wrap, #pf-lzw and #export-tiff-lzw do not exist.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    doExportPreflight('tiff');
    const wrap = document.getElementById('pf-lzw-wrap');
    const onTiff = wrap.style.display;
    const before = undoStack.length;
    document.getElementById('pf-lzw').click();          // fires change → writes through
    const ticked = { sidebar: gc('export-tiff-lzw'), steps: undoStack.length - before,
                     body: document.getElementById('preflight-body').textContent };
    document.getElementById('pf-format').value = 'png'; _refreshPreflight();
    const onPng = wrap.style.display;
    closePreflight();
    undo();
    const afterUndo = gc('export-tiff-lzw');
    // the Export panel's own checkbox: also one step
    const b2 = undoStack.length;
    document.getElementById('export-tiff-lzw').click();
    return { onTiff, onPng, ticked, afterUndo, sidebarSteps: undoStack.length - b2, now: gc('export-tiff-lzw') };
  });
  expect(r.onTiff).toBe('flex');
  expect(r.onPng).toBe('none');
  expect(r.ticked.sidebar).toBe(true);
  expect(r.ticked.steps).toBe(1);
  expect(r.ticked.body).toMatch(/LZW makes it smaller/);
  expect(r.afterUndo).toBe(false);
  expect(r.sidebarSteps).toBe(1);
  expect(r.now).toBe(true);
  expect(errors).toEqual([]);
});

test('lzw: the PLOS preset switches it on, and the package carries the LZW TIFF and the Methods paragraph', async ({ page }) => {
  // Fails at HEAD: applyPreset('plos') leaves TIFFs uncompressed (tag 259 = 1), the
  // package README says "uncompressed", and there is no -methods.txt in the ZIP.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(PARSERS);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 1); onLayoutChange(); render();
    applyPreset('plos');
    const onAfterPlos = gc('export-tiff-lzw');
    applyPreset('nature');                               // another journal leaves it alone
    const keptAfterNature = gc('export-tiff-lzw');
    undo();                                              // back to PLOS: still on
    applyPreset('plos');
    render();
    const zipCap = await _captureDownload(() => exportSubmissionPackage());
    const files = _zipRead(zipCap.data);
    const names = Object.keys(files);
    const tiffName = names.find(n => /\.tiff$/.test(n) && !n.includes('/'));
    const methodsName = names.find(n => /-methods\.txt$/.test(n));
    return { onAfterPlos, keptAfterNature, names,
             tiff259: tiffName ? _tiffTags(files[tiffName])[259] : null,
             readme: new TextDecoder().decode(files['README.txt'] || new Uint8Array()),
             methods: methodsName ? new TextDecoder().decode(files[methodsName]) : null };
  });
  expect(r.onAfterPlos).toBe(true);
  expect(r.keptAfterNature).toBe(true);
  expect(r.tiff259).toBe(5);
  expect(r.readme).toMatch(/TIFF is LZW-compressed/);
  expect(r.methods).not.toBeNull();
  expect(r.methods).toMatch(/^Figures were assembled in FigureLab v/);
  expect(r.names).toContain('PANEL_HISTORY.txt');          // the file the paragraph points to
  expect(errors).toEqual([]);
});
