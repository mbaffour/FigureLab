// @ts-check
// Tests for the v3.5 UX / integrity / export features.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('empty state shows initially, hides once images load', async ({ page }) => {
  const errors = await loadApp(page);
  const shown = await page.evaluate(() => {
    const e = document.getElementById('empty-state');
    return !!e && getComputedStyle(e).display !== 'none';
  });
  expect(shown).toBe(true);
  await seedPanels(page, 3);
  const hidden = await page.evaluate(
    () => getComputedStyle(document.getElementById('empty-state')).display === 'none'
  );
  expect(hidden).toBe(true);
  expect(errors).toEqual([]);
});

test('Simple/Advanced mode toggles advanced-control visibility, keeps core visible', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => applyUiMode('simple'));
  let advVisible = await page.evaluate(() => document.getElementById('scale-match-target').offsetParent !== null);
  expect(advVisible).toBe(false);                    // advanced hidden in Simple
  const dpiVisible = await page.evaluate(() => document.getElementById('export-dpi').offsetParent !== null);
  expect(dpiVisible).toBe(true);                     // core stays visible
  await page.evaluate(() => applyUiMode('advanced'));
  advVisible = await page.evaluate(() => document.getElementById('scale-match-target').offsetParent !== null);
  expect(advVisible).toBe(true);                     // revealed in Advanced
});

test('command palette opens and runs a command', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => openCmdPalette());
  expect(await page.evaluate(() => document.getElementById('cmd-palette').classList.contains('open'))).toBe(true);
  const n = await page.evaluate(() => {
    const i = document.getElementById('cmdp-input');
    i.value = 'theme'; i.dispatchEvent(new Event('input'));
    return document.querySelectorAll('#cmdp-list .cmdp-item').length;
  });
  expect(n).toBeGreaterThan(0);
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => { _cmdpSel = 0; _cmdpRun(); });   // run "Toggle theme"
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(after).not.toBe(before);
});

test('export preflight reports dimensions and a sub-300-DPI warning', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { sv('export-dpi', '150'); doExportPreflight('tiff'); });
  const body = await page.evaluate(() => document.getElementById('preflight-body').innerText);
  expect(body).toMatch(/Pixel dimensions/);
  expect(body).toMatch(/Physical size/);
  expect(body).toMatch(/150 DPI is below/);
  await page.evaluate(() => closePreflight());
  expect(await page.evaluate(() => document.getElementById('preflight-modal').classList.contains('open'))).toBe(false);
});

test('save dialog: editable name/format/DPI, and fallback download uses a sanitised name', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  // open for PNG, then change format + DPI + name — the readout must track the new choices live
  const readout = await page.evaluate(() => {
    doExportPreflight('png');
    document.getElementById('pf-format').value = 'jpeg';
    document.getElementById('pf-dpi').value = '600';
    document.getElementById('pf-name').value = 'blot final';
    _refreshPreflight();
    return {
      ext: document.getElementById('pf-ext').textContent,
      go: document.getElementById('preflight-go').textContent,
      body: document.getElementById('preflight-body').innerText,
    };
  });
  expect(readout.ext).toBe('.jpg');
  expect(readout.go).toMatch(/Save JPG/);
  expect(readout.body).toMatch(/blot final\.jpg/);
  expect(readout.body).toMatch(/600 DPI/);
  // with no native Save-As available, saving falls back to a normal download with the chosen
  // format and a filesystem-safe name (illegal characters replaced)
  const saved = await page.evaluate(async () => {
    window.__dlName = null;
    const savedPicker = window.showSaveFilePicker; window.showSaveFilePicker = undefined;
    const origDl = window.dl; window.dl = (u, n) => { window.__dlName = n; };
    document.getElementById('pf-format').value = 'png';
    document.getElementById('pf-name').value = 'fig 2/final*';   // '/' and '*' are illegal
    _refreshPreflight();
    await _saveFromDialog();
    await new Promise(r => setTimeout(r, 600));                  // fallback doExport() encodes async
    window.dl = origDl; window.showSaveFilePicker = savedPicker;
    return {
      name: window.__dlName,
      exportName: document.getElementById('export-name').value,
      closed: !document.getElementById('preflight-modal').classList.contains('open'),
    };
  });
  expect(saved.name).toBe('fig 2_final_.png');
  expect(saved.exportName).toBe('fig 2_final_');
  expect(saved.closed).toBe(true);
});

test('freeform text: per-object styling controls + editable multi-line content', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => {
    setLayoutMode('freeform');
    addFreeformElement({ type:'text', x:100, y:80, w:320, h:90, text:'Hello', label:'Hello',
      fontFamily:'system-ui', fontSize:24, color:'#111111', align:'left' });
    const idx = freeformElements.length - 1;
    selectedElems.clear(); selectedElems.add(idx); drawFreeformOverlay();
    // the text style bar shows and the panel-Label field hides for a text object
    const propsShown = document.getElementById('ep-text-props').style.display === 'flex'
      && document.getElementById('ep-label-wrap').style.display === 'none';
    toggleTextStyle('bold');
    updateElemProp('align', 'center');
    updateElemProp('fontSize', 36);
    // inline editor opens prefilled and commits multi-line content
    editFreeformText(idx);
    const ta = document.getElementById('ff-text-input');
    const opened = ta.style.display === 'block', prefill = ta.value;
    ta.value = 'Panel A\nline two';
    commitFreeformText(false);
    const el = freeformElements[idx];
    render();
    return { propsShown, opened, prefill, bold: el.bold, align: el.align, size: el.fontSize,
      text: el.text, editorHidden: ta.style.display === 'none' };
  });
  expect(r.propsShown).toBe(true);
  expect(r.opened).toBe(true);
  expect(r.prefill).toBe('Hello');            // placeholder not forced onto the user
  expect(r.bold).toBe(true);
  expect(r.align).toBe('center');
  expect(r.size).toBe(36);
  expect(r.text).toBe('Panel A\nline two');   // real editable content, newline preserved
  expect(r.editorHidden).toBe(true);
});

test('freeform: rotate handle rotates an object, snaps to 45/90, hit-test follows rotation', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    setLayoutMode('freeform');
    addFreeformElement({ type:'rect', x:200, y:170, w:200, h:100, color:'#5b8dee', fillColor:'#5b8dee', fillOpacity:0.3 });
    render(); await wait(60);                        // ensure canvasLogicalW is set
    const idx = freeformElements.length - 1, el = freeformElements[idx];
    selectedElems.clear(); selectedElems.add(idx); drawFreeformOverlay();
    const rect = annCanvas.getBoundingClientRect();
    const W = canvasLogicalW || annCanvas.width, H = canvasLogicalH || annCanvas.height;
    const laidOut = rect.width > 0 && W > 0;
    const cx = el.x + el.w/2, cy = el.y + el.h/2;
    const mk = (lx, ly, mod={}) => ({ clientX: rect.left + lx*rect.width/W, clientY: rect.top + ly*rect.height/H,
      shiftKey: !!mod.shift, altKey: !!mod.alt });
    const rh = getFreeformRotateHandle(el);
    // grab the rotate handle (top, ≡ -90°) and drag to the right → +90°, snaps
    freeformMousedown(mk(rh.x, rh.y));
    const grabbed = !!elemRotateState;
    freeformMousemove(mk(cx + 90, cy));
    const rot90 = Math.round(el.rotation);
    freeformMouseup(mk(cx + 90, cy));
    const cleared = elemRotateState === null;
    const hitCentreRotated = hitFreeformElement(el, cx, cy);
    const missOutside = !hitFreeformElement(el, cx + 400, cy + 400);
    // 45° snap
    el.rotation = 0; freeformMousedown(mk(rh.x, rh.y));
    freeformMousemove(mk(cx + 90, cy - 90));
    const rot45 = Math.round(el.rotation);
    freeformMouseup(mk(cx + 90, cy - 90));
    return { laidOut, grabbed, rot90, cleared, hitCentreRotated, missOutside, rot45 };
  });
  expect(r.laidOut).toBe(true);
  expect(r.grabbed).toBe(true);
  expect(r.rot90).toBe(90);
  expect(r.cleared).toBe(true);
  expect(r.hitCentreRotated).toBe(true);
  expect(r.missOutside).toBe(true);
  expect(r.rot45).toBe(45);
});

test('freeform: aspect-locked corner resize + snap-to-object alignment guides', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    setLayoutMode('freeform');
    snapGrid = false;                                       // isolate from grid snapping
    // ---- aspect lock: image corner resize keeps the 2:1 ratio ----
    addFreeformElement({ type:'image', x:100, y:100, w:200, h:100 });
    render(); await wait(50);
    const iA = freeformElements.length - 1, A = freeformElements[iA];
    selectedElems.clear(); selectedElems.add(iA); drawFreeformOverlay();
    const rect = annCanvas.getBoundingClientRect(), W = canvasLogicalW || annCanvas.width, H = canvasLogicalH || annCanvas.height;
    const mk = (lx, ly, mod={}) => ({ clientX: rect.left + lx*rect.width/W, clientY: rect.top + ly*rect.height/H,
      shiftKey: !!mod.shift, altKey: !!mod.alt });
    freeformMousedown(mk(A.x + A.w, A.y + A.h));            // grab bottom-right corner
    freeformMousemove(mk(A.x + A.w + 100, A.y + A.h));      // widen by 100 → height auto-tracks
    freeformMouseup(mk(A.x + A.w + 100, A.y + A.h));
    const lockedW = Math.round(A.w), lockedH = Math.round(A.h);
    // Shift frees the ratio (drag height only)
    freeformMousedown(mk(A.x + A.w, A.y + A.h));
    freeformMousemove(mk(A.x + A.w, A.y + A.h + 80, { shift:true }));
    freeformMouseup(mk(A.x + A.w, A.y + A.h + 80, { shift:true }));
    const freeH = Math.round(A.h);
    // ---- snap guides: drag one rect's left edge onto another's left edge ----
    freeformElements.length = 0; selectedElems.clear();
    addFreeformElement({ type:'rect', x:120, y:120, w:100, h:100 });
    addFreeformElement({ type:'rect', x:400, y:300, w:120, h:80 });
    render(); await wait(50);
    const B = freeformElements[1];
    freeformMousedown(mk(B.x + B.w/2, B.y + B.h/2));        // grab B by its body
    freeformMousemove(mk(120 + B.w/2, B.y + B.h/2));        // move so B.x ≈ 120 (== other rect's left)
    const snappedX = Math.round(B.x), guideGx = _snapGuides && _snapGuides.gx;
    freeformMouseup(mk(120 + B.w/2, B.y + B.h/2));
    const guidesClearedAfterUp = _snapGuides;
    return { lockedW, lockedH, freeH, snappedX, guideGx, guidesClearedAfterUp };
  });
  expect(r.lockedW).toBe(300);
  expect(r.lockedH).toBe(150);          // 2:1 aspect preserved on corner drag
  expect(r.freeH).toBe(230);            // Shift frees the ratio (150 + 80)
  expect(r.snappedX).toBe(120);         // B's left edge snapped to the other rect's left
  expect(r.guideGx).toBe(120);          // magenta guide drawn at x = 120
  expect(r.guidesClearedAfterUp).toBe(null);
});

test('freeform: duplicate, z-order on all selected, lock, and context toolbar', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    setLayoutMode('freeform'); snapGrid = false;
    addFreeformElement({ type:'rect', x:100, y:100, w:80, h:80 });
    addFreeformElement({ type:'rect', x:300, y:100, w:80, h:80 });
    addFreeformElement({ type:'rect', x:500, y:100, w:80, h:80 });
    render(); await wait(50);
    const n0 = freeformElements.length;
    // z-order: select first TWO, bring to front → both above the third (fixes single-element bug)
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); drawFreeformOverlay();
    changeZOrder('front');
    const z = freeformElements.map(e => e.zIndex);
    const frontOK = z[0] > z[2] && z[1] > z[2];
    // duplicate → +1 element, offset by 16, copy selected
    selectedElems.clear(); selectedElems.add(0);
    duplicateSelectedElems();
    const dupAdded = freeformElements.length === n0 + 1;
    const copy = freeformElements[freeformElements.length - 1];
    const offsetOK = copy.x === 116 && copy.y === 116;
    const copySelected = selectedElems.size === 1 && selectedElems.has(freeformElements.length - 1);
    // lock → no handles, and mousedown selects but doesn't start a move
    toggleLockSelected();
    const locked = copy.locked === true;
    const noHandles = hitFreeformHandle(copy, copy.x, copy.y) === null;
    const rect = annCanvas.getBoundingClientRect(), W = canvasLogicalW || annCanvas.width, H = canvasLogicalH || annCanvas.height;
    const mk = (lx, ly) => ({ clientX: rect.left + lx*rect.width/W, clientY: rect.top + ly*rect.height/H, shiftKey:false, altKey:false });
    selectedElems.clear();
    freeformMousedown(mk(copy.x + copy.w/2, copy.y + copy.h/2));
    const noDragOnLocked = !elemDragState;
    freeformMouseup(mk(copy.x + copy.w/2, copy.y + copy.h/2));
    // context toolbar appears for a selection
    selectedElems.clear(); selectedElems.add(0); drawFreeformOverlay();
    const toolbarShown = document.getElementById('ctx-toolbar').style.display === 'flex';
    return { frontOK, dupAdded, offsetOK, copySelected, locked, noHandles, noDragOnLocked, toolbarShown };
  });
  expect(r.frontOK).toBe(true);
  expect(r.dupAdded).toBe(true);
  expect(r.offsetOK).toBe(true);
  expect(r.copySelected).toBe(true);
  expect(r.locked).toBe(true);
  expect(r.noHandles).toBe(true);
  expect(r.noDragOnLocked).toBe(true);
  expect(r.toolbarShown).toBe(true);
});

test('freeform: cover patch is an opaque object with a match-background sampler', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    setLayoutMode('freeform');
    document.getElementById('fm-canvas-w').value = 400; document.getElementById('fm-canvas-h').value = 300;
    addFreeformElement({ type:'rect', x:0, y:0, w:400, h:300, color:'#3366cc', fillColor:'#3366cc', fillOpacity:1, strokeWidth:0 });
    addCoverPatch();
    render(); await wait(60);
    const patch = freeformElements[freeformElements.length - 1];
    const isPatch = patch.type === 'patch';
    const selected = selectedElems.has(freeformElements.length - 1);
    drawFreeformOverlay();
    const patchPropsShown = document.getElementById('ep-patch-props').style.display === 'flex';
    const c = document.getElementById('fig-canvas'), cx = c.getContext('2d');
    const W = canvasLogicalW || c.width, H = canvasLogicalH || c.height, sx = c.width/W, sy = c.height/H;
    const smp = (lx, ly) => cx.getImageData(Math.round(lx*sx), Math.round(ly*sy), 1, 1).data;
    let px = smp(patch.x + patch.w/2, patch.y + patch.h/2);
    const drawsWhite = px[0] > 240 && px[1] > 240 && px[2] > 240;      // opaque white cover
    updateElemProp('color', '#00ff00'); render(); await wait(40);
    px = smp(patch.x + patch.w/2, patch.y + patch.h/2);
    const recolored = px[1] > 200 && px[0] < 80 && px[2] < 80;         // recolour works
    // move fully over the blue backdrop and match its colour
    patch.x = 150; patch.y = 120; patch.color = '#ffffff'; render(); await wait(40);
    matchPatchBackground();
    const matched = /^#[0-9a-f]{6}$/i.test(patch.color) && patch.color.toLowerCase() !== '#ffffff';
    return { isPatch, selected, patchPropsShown, drawsWhite, recolored, matched };
  });
  expect(r.isPatch).toBe(true);
  expect(r.selected).toBe(true);
  expect(r.patchPropsShown).toBe(true);
  expect(r.drawsWhite).toBe(true);
  expect(r.recolored).toBe(true);
  expect(r.matched).toBe(true);
});

test('TIFF decoder: decodes the full compression/bit-depth/layout matrix in-browser', async ({ page }) => {
  const fs = require('fs'), path = require('path');
  await loadApp(page);
  const fxDir = path.join(__dirname, 'fixtures', 'tiff');
  const manifest = JSON.parse(fs.readFileSync(path.join(fxDir, 'manifest.json'), 'utf8'));
  const samples = manifest.samples;
  const failures = [];
  let checked = 0;
  for (const [name, exp] of Object.entries(manifest.cases)) {
    const file = path.join(fxDir, name + '.tif');
    if (!fs.existsSync(file)) continue;
    const bytes = Array.from(fs.readFileSync(file));
    const res = await page.evaluate(async ({ bytes, samples }) => {
      const r = await decodeTIFF(new Uint8Array(bytes));
      return { w: r.width, h: r.height, note: r.note,
        px: samples.map(([y, x]) => { const b = (y * r.width + x) * 4;
          return [r.rgba[b], r.rgba[b + 1], r.rgba[b + 2], r.rgba[b + 3]]; }) };
    }, { bytes, samples });
    if (res.w !== exp.w || res.h !== exp.h) failures.push(`${name}: dims ${res.w}x${res.h} != ${exp.w}x${exp.h}`);
    res.px.forEach((got, k) => { const want = exp.rgba[k];
      for (let c = 0; c < 4; c++) if (Math.abs(got[c] - want[c]) > 2)
        failures.push(`${name} sample${k} ch${c}: ${got[c]} != ${want[c]}`); });
    checked++;
  }
  expect(failures).toEqual([]);          // pixel-exact across raw/LZW/PackBits/Deflate, 8/16-bit/float, gray/RGB/RGBA/palette, LE/BE, strips/tiles, predictor
  expect(checked).toBeGreaterThanOrEqual(20);
});

test('TIFF import: addFiles routes .tif through the decoder into the crop pipeline', async ({ page }) => {
  const fs = require('fs'), path = require('path');
  await loadApp(page);
  const bytes = Array.from(fs.readFileSync(path.join(__dirname, 'fixtures', 'tiff', 'g16_lzw_pred.tif')));
  const r = await page.evaluate(async (bytes) => {
    const f = new File([new Uint8Array(bytes)], 'scan.tif', { type: 'image/tiff' });
    let queued = null;
    const origDrain = window._drainPreCrop;
    window._drainPreCrop = () => { queued = _preCropQueue[_preCropQueue.length - 1]; };   // capture instead of opening the modal
    addFiles([f]);
    await new Promise(resolve => { const iv = setInterval(() => { if (queued) { clearInterval(iv); resolve(); } }, 25); setTimeout(() => { clearInterval(iv); resolve(); }, 4000); });
    window._drainPreCrop = origDrain;
    return { name: queued && queued.name, isPng: !!(queued && /^data:image\/png/.test(queued.src || '')) };
  }, bytes);
  expect(r.isPng).toBe(true);            // TIFF was decoded and rasterized to a PNG the pipeline can use
  expect(r.name).toMatch(/\.png$/);
});

test('SVG import stays vector: source retained, round-trips, and SVG export re-embeds vector', async ({ page }) => {
  await loadApp(page);
  const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#eef"/><circle cx="60" cy="40" r="30" fill="#ff8800"/></svg>';
  const r = await page.evaluate(async (svgMarkup) => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const until = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return true; await wait(25); } return false; };
    setLayoutMode('freeform');
    addFiles([new File([svgMarkup], 'diagram.svg', { type: 'image/svg+xml' })]);
    await until(() => cropEdState && cropEdState._preCrop);     // pre-crop modal armed
    skipPreCrop();                                              // add without cropping → keep the vector source
    await until(() => freeformElements.some(e => e.isVector));
    const el = freeformElements.find(e => e.isVector);
    render(); await wait(60);
    const state = serializeSession(true);                       // session round-trip
    const serEl = (state.freeformElements || []).find(e => e.isVector);
    sv('export-name', 'vectest');                               // SVG export re-embeds vector
    const cap = await _captureDownload(() => doExport('svg'));
    const text = new TextDecoder().decode(cap.data);
    return {
      isVector: !!(el && el.isVector),
      sourceKept: !!(el && el.svgSource && /<circle/.test(el.svgSource)),
      serializedKept: !!(serEl && serEl.isVector && /<circle/.test(serEl.svgSource || '')),
      imageCount: (text.match(/<image/g) || []).length,
      hasVectorHref: /data:image\/svg\+xml/.test(text),
      encodesMarker: /%23ff8800/i.test(text),
    };
  }, svgMarkup);
  expect(r.isVector).toBe(true);
  expect(r.sourceKept).toBe(true);
  expect(r.serializedKept).toBe(true);
  expect(r.imageCount).toBeGreaterThanOrEqual(2);   // raster background + vector overlay
  expect(r.hasVectorHref).toBe(true);
  expect(r.encodesMarker).toBe(true);
});

test('CVD simulation filters the display only, never the export buffer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const sample = () => 'return document.getElementById("fig-canvas").getContext("2d").getImageData(0,0,4,4).data.join(",")';
  const before = await page.evaluate(new Function(sample()));
  await page.evaluate(() => setCvdMode('deuter'));
  const filter = await page.evaluate(() => document.getElementById('canvas-container').style.filter);
  expect(filter).toContain('cvd-deuter');
  const after = await page.evaluate(new Function(sample()));
  expect(after).toBe(before);                        // pixel buffer untouched
  expect(errors).toEqual([]);
});

test('help chips are present and carry tooltip copy', async ({ page }) => {
  await loadApp(page);
  const n = await page.evaluate(() => document.querySelectorAll('.help-chip').length);
  expect(n).toBeGreaterThanOrEqual(4);
  const hasTip = await page.evaluate(() => !!document.querySelector('.help-chip').getAttribute('data-tip'));
  expect(hasTip).toBe(true);
});

test('load example figure builds a labelled, calibrated 4-panel figure', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  expect(await page.evaluate(() => images.map(i => i.label))).toEqual(['A', 'B', 'C', 'D']);
  expect(await page.evaluate(() => images[0].umPerPx > 0 && images[0].sbOn)).toBe(true);
});

test('auto-arrange produces a balanced grid from the panel count', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 5); sv('rows', 5); onLayoutChange(); autoArrange(); });
  const dims = await page.evaluate(() => ({ cols: gi('cols'), rows: gi('rows') }));
  expect(dims).toEqual({ cols: 2, rows: 2 });
});

test('on-device AI caption preserves the rule-based caption when the model is not really available', async ({ page }) => {
  // Chromium exposes LanguageModel but only echoes the prompt; the echo guard must
  // reject that and keep the good structured caption rather than clobbering it.
  await loadApp(page);
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  const draft = await page.evaluate(() => { generateCaption(); return document.getElementById('caption-out').value; });
  await page.evaluate(async () => { await aiPolishCaption(); });
  const after = await page.evaluate(() => document.getElementById('caption-out').value);
  expect(after).toBe(draft);                 // never leaves a degenerate/echoed caption
  expect(after.startsWith('Figure.')).toBe(true);
});

test('submission package builds a valid multi-entry ZIP', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  const res = await page.evaluate(async () => {
    sv('export-dpi', '96');                       // keep the TIFF small for CI
    const realDl = window.dl; let zipUrl = null;
    window.dl = (url, name) => { if (String(name).endsWith('.zip')) zipUrl = url; else realDl(url, name); };
    await exportSubmissionPackage();
    window.dl = realDl;
    if (!zipUrl) return { error: 'no zip' };
    const buf = new Uint8Array(await (await fetch(zipUrl)).arrayBuffer());
    const dv = new DataView(buf.buffer);
    let e = buf.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;              // EOCD
    const total = dv.getUint16(e + 10, true);
    const localSigOK = dv.getUint32(0, true) === 0x04034b50;                 // first local header
    // collect central-directory names
    let cd = dv.getUint32(e + 16, true); const names = []; const dec = new TextDecoder();
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(cd, true) !== 0x02014b50) break;
      const nlen = dv.getUint16(cd + 28, true), elen = dv.getUint16(cd + 30, true), clen = dv.getUint16(cd + 32, true);
      names.push(dec.decode(buf.slice(cd + 46, cd + 46 + nlen)));
      cd += 46 + nlen + elen + clen;
    }
    return { total, localSigOK, names };
  });
  expect(res.error).toBeUndefined();
  expect(res.localSigOK).toBe(true);
  expect(res.total).toBeGreaterThanOrEqual(10);
  expect(res.names).toContain('README.txt');
  expect(res.names.some(n => n.endsWith('.tiff'))).toBe(true);
  expect(res.names.some(n => n.startsWith('panels/'))).toBe(true);
});

test('session serialize/apply round-trips and autosave writes a snapshot', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 3);
  const res = await page.evaluate(async () => {
    const state = serializeSession(true);
    const n0 = state.images.length;
    images = []; annotations = []; renderImgList();
    applySession(state, { silent: true });
    await new Promise(r => setTimeout(r, 150));
    // autosave writes a recoverable snapshot
    autosaveNow();
    const data = JSON.parse(localStorage.getItem('fl-autosave-v2') || '{}');
    return { n0, restored: images.length, autosaveImages: (data.s && data.s.images || []).length, bundle: data.bundle };
  });
  expect(res.n0).toBe(3);
  expect(res.restored).toBe(3);            // applySession restored every panel
  expect(res.autosaveImages).toBe(3);      // autosave snapshot includes panels
  expect(res.bundle).toBe(true);
});

test('lightweight session omits image pixel data; bundled keeps it', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  const res = await page.evaluate(() => ({
    light: JSON.stringify(serializeSession(false)),
    bundled: JSON.stringify(serializeSession(true)),
  }));
  expect(/"src":\s*"data:/.test(res.light)).toBe(false);
  expect(/"src":\s*"data:/.test(res.bundled)).toBe(true);
  expect(res.light.length).toBeLessThan(res.bundled.length);
});

test('customization: greeting by name, and the animated-background toggle', async ({ page }) => {
  await loadApp(page);
  const res = await page.evaluate(() => {
    try { localStorage.removeItem('fl-user-name'); } catch (e) {}
    const generic = _greeting();
    localStorage.setItem('fl-user-name', 'Ada'); updateGreeting();
    const named = _greeting();
    const el = document.getElementById('es-greeting');
    // background toggle
    setBgAnimation(false); const off = bgAnimationEnabled();
    setBgAnimation(true); const on = bgAnimationEnabled();
    return { genericHasWelcome: /welcome/i.test(generic), named, elText: el ? el.textContent : '', off, on };
  });
  expect(res.named).toContain('Ada');
  expect(res.elText).toContain('Ada');
  expect(res.off).toBe(false);
  expect(res.on).toBe(true);
});

test('session library exposes save/open helpers (IndexedDB or graceful)', async ({ page }) => {
  await loadApp(page);
  const res = await page.evaluate(() => ({
    save: typeof saveToLibrary, open: typeof loadFromLibrary,
    render: typeof renderSessionLibrary, hasList: !!document.getElementById('session-library'),
  }));
  expect(res.save).toBe('function');
  expect(res.open).toBe('function');
  expect(res.hasList).toBe(true);
});

test('house styles save and re-apply the aesthetic layer', async ({ page }) => {
  await loadApp(page);
  const res = await page.evaluate(() => {
    try { localStorage.removeItem('figurelab_housestyles'); } catch (e) {}
    sv('bg-color', '#eeeeee'); sv('label-size', '18'); sv('label-color', '#ff0000');
    sv('house-style-name', 'Lab'); saveHouseStyle();
    const count = getHouseStyles().length;
    sv('bg-color', '#ffffff'); sv('label-size', '8'); sv('label-color', '#000000');
    applyHouseStyle('Lab');
    return { count, bg: gv('bg-color'), size: gv('label-size'), color: gv('label-color') };
  });
  expect(res.count).toBe(1);
  expect(res.bg).toBe('#eeeeee');
  expect(res.size).toBe('18');
  expect(res.color).toBe('#ff0000');
});

test('split-channel row explodes a multi-channel panel into channels + merge', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 3);
  const res = await page.evaluate(() => {
    images[0].lut = 'green';
    images[0].channels = [{ name: 'c2.png', img: images[1].img, src: images[1].src, lut: 'magenta', blackPt: 0, whitePt: 255 }];
    const before = images.length;
    splitChannelRow(0);
    return {
      grew: images.length - before,                 // +2 (1 panel -> 3)
      caps: images.slice(0, 3).map(i => i.captionNote),
      singleChannelsHaveNoChannels: images[0].channels.length === 0 && images[1].channels.length === 0,
      mergeKeepsChannels: images[2].channels.length === 1,
    };
  });
  expect(res.grew).toBe(2);
  expect(res.caps).toEqual(['GFP', 'RFP', 'Merge']);
  expect(res.singleChannelsHaveNoChannels).toBe(true);
  expect(res.mergeKeepsChannels).toBe(true);
});

test('matched panels: sync copies adjustments only within a group', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  const res = await page.evaluate(() => {
    images[0].group = 'g'; images[2].group = 'g';
    Object.assign(images[0], { brightness: 1.5, contrast: 1.3, gamma: 0.7, lut: 'fire', sbUm: 42 });
    syncGroupToPanel(0);
    return {
      synced: images[2].brightness === 1.5 && images[2].lut === 'fire' && images[2].sbUm === 42,
      untouched: images[1].lut !== 'fire' && images[1].brightness !== 1.5,
    };
  });
  expect(res.synced).toBe(true);
  expect(res.untouched).toBe(true);
});

test('import helpers: channel detection, auto-LUT, and natural sort', async ({ page }) => {
  await loadApp(page);
  const det = await page.evaluate(() => ({
    dapi: _detectChannel('cells_DAPI.tif') && _detectChannel('cells_DAPI.tif').lut,
    gfp: _detectChannel('img_GFP_488.png') && _detectChannel('img_GFP_488.png').lut,
    rfp: _detectChannel('s1_mCherry.png') && _detectChannel('s1_mCherry.png').lut,
    none: _detectChannel('random.png'),
  }));
  expect(det.dapi).toBe('blue');
  expect(det.gfp).toBe('green');
  expect(det.rfp).toBe('magenta');
  expect(det.none).toBeNull();
  // natural sort relabels positionally
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  const sorted = await page.evaluate(() => { sortImagesByName(); return { order: images.map(i => i.name), labels: images.map(i => i.label) }; });
  expect(sorted.labels).toEqual(['A', 'B', 'C', 'D']);
  expect(sorted.order[0]).toBe('actin_GFP.png');       // natural order
});

test('PowerPoint (.pptx) export is a valid OOXML package with well-formed XML', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  const res = await page.evaluate(async () => {
    const realDl = window.dl; let url = null;
    window.dl = (u, n) => { if (String(n).endsWith('.pptx')) url = u; else realDl(u, n); };
    await exportPPTX();
    window.dl = realDl;
    if (!url) return { error: 'no pptx' };
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const dv = new DataView(buf.buffer); const dec = new TextDecoder();
    let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    const total = dv.getUint16(e + 10, true); let cd = dv.getUint32(e + 16, true);
    const names = []; const xml = {};
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(cd, true) !== 0x02014b50) break;
      const nlen = dv.getUint16(cd + 28, true), elen = dv.getUint16(cd + 30, true), clen = dv.getUint16(cd + 32, true);
      const lho = dv.getUint32(cd + 42, true);
      const name = dec.decode(buf.slice(cd + 46, cd + 46 + nlen)); names.push(name);
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true), csize = dv.getUint32(lho + 18, true);
      const ds = lho + 30 + lnlen + lelen;
      if (name.endsWith('.xml') || name.endsWith('.rels')) xml[name] = dec.decode(buf.slice(ds, ds + csize));
      cd += 46 + nlen + elen + clen;
    }
    const parser = new DOMParser(); const xmlErrors = [];
    for (const n in xml) if (parser.parseFromString(xml[n], 'application/xml').getElementsByTagName('parsererror').length) xmlErrors.push(n);
    return { total, names, xmlErrors, media: names.filter(n => n.startsWith('ppt/media/')).length };
  });
  expect(res.error).toBeUndefined();
  expect(res.names).toContain('[Content_Types].xml');
  expect(res.names).toContain('ppt/slides/slide1.xml');
  expect(res.media).toBe(4);              // one movable picture per panel
  expect(res.xmlErrors).toEqual([]);      // every XML part well-formed
});

test("What's New tab renders dated content and clears the update indicator", async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => { try { localStorage.setItem('fl-seen-version', '0.0'); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => typeof openWhatsNew === 'function');
  expect(await page.evaluate(() => document.getElementById('help-btn').classList.contains('has-new'))).toBe(true);
  await page.evaluate(() => openWhatsNew());
  const paneActive = await page.evaluate(() => document.getElementById('help-pane-whatsnew').classList.contains('active'));
  expect(paneActive).toBe(true);
  const cleared = await page.evaluate(() => !document.getElementById('help-btn').classList.contains('has-new'));
  expect(cleared).toBe(true);
});
