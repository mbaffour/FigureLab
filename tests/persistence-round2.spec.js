// @ts-check
// What a figure carries across its boundaries, round two. The saved session, autosave,
// the session library and the share link each kept their own list of what a panel and
// a figure carry, and the lists drifted: linked insets, background keying, acquisition
// times, seven style controls, spans, rotation, hidden panels, borders and group bands
// were lost somewhere. Now one panel record (_panelRecord) and one control list
// (_FIG_CONTROLS) serve all of them, and one reset (_resetFigureState) runs at every
// figure boundary — New, opening a file or a link, a tutorial, the example.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { loadApp, seedPanels, APP_URL } = require('./helpers');

const FX = path.join(__dirname, 'fixtures');
const OME = fs.readFileSync(path.join(FX, 'tiff', 'cal_ome_multi.ome.tif')).toString('base64');

// Drop real files through addFiles, as a drop or the file picker does.
async function dropFiles(page, files) {
  await page.evaluate(async (fl) => {
    const list = fl.map(f => { const b = atob(f.b64); const u = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], f.name, { type: f.type }); });
    await addFiles(list);
  }, files);
}
// Commit a generated image under a given file name, the path every import ends in.
async function commit(page, specs) {
  await page.evaluate(async (specs) => {
    for (const s of specs) {
      const c = document.createElement('canvas'); c.width = s.w || 100; c.height = s.h || 80;
      const x = c.getContext('2d');
      if (s.gel) {      // a light gel with three dark lanes of bands
        x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, c.width, c.height);
        [30, 110, 190].forEach((lx, k) => { x.fillStyle = '#303030';
          x.fillRect(lx, 40, 50, 6); x.fillRect(lx, 90 + k * 8, 50, 6); });
      } else {
        x.fillStyle = s.fill || '#888'; x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width / 4, c.height / 4);
      }
      const src = c.toDataURL('image/png');
      await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, s.name); res(); }; img.src = src; });
    }
    render();
  }, specs);
}
const geom = page => page.evaluate(() => { render(); return { b: panelBounds.filter(b => b.idx >= 0).map(b => [b.idx, b.x, b.y, b.w, b.h]), size: [canvasLogicalW, canvasLogicalH] }; });
const freshPage = async (page) => { const p = await page.context().newPage(); const errors = await loadApp(p); return { p, errors }; };
async function shareLink(page) {
  return page.evaluate(async () => {
    let href = null;
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    navigator.clipboard.writeText = async (t) => { href = t; };
    shareSession(); await new Promise(r => setTimeout(r, 60));
    return href.slice(href.indexOf('#share='));
  });
}
const SEVEN = ['label-bg', 'label-auto-color', 'sb-auto-color', 'tag-pos', 'inset-frames', 'inset-connectors', 'panel-border-inset', 'show-tags', 'tag-channels'];

// ── F03 + F14: a saved session reopens as the same figure ──────────────────────
// Every feature the record now carries: OME acquisition times, background keying, a
// linked inset, densitometry, the S1 tick and import-crop record, a named ruler, rows
// that hug, the hidden-panel gap, and the style controls that were never saved.
async function buildEverything(page) {
  await dropFiles(page, [{ name: 'cal_ome_multi.ome.tif', b64: OME, type: 'image/tiff' }]);
  await page.waitForFunction(() => images.filter(Boolean).length >= 3);
  await commit(page, [{ name: 'keyed.png', fill: '#c33' }, { name: 'gel.png', gel: true, w: 280, h: 140 }]);
  return page.evaluate(() => {
    sv('cols', 3); sv('rows', 3); onLayoutChange();
    images[3].bgKey = { on: true, mode: 'white', tol: 30, feather: 0 };
    images[1].s1 = true; images[3]._importCrop = { l: 1, t: 2, r: 3, b: 4, w: 120, h: 90 };
    images[0].tag = '0 s'; images[1].tag = '30 s';
    const gelOk = runGelAnalysis(4);
    selectedPanel = 0; addLinkedInset(0.25, 0.25, 0.5, 0.5);
    annotations.push({ type: 'ruler', x1: 30, y1: 30, x2: 90, y2: 30, rulerName: 'capsid', color: '#fff', width: 2 });
    sc('auto-row-h', true); sv('hidden-gap', 'gap'); images[2].excluded = true;
    sc('label-bg', false); sc('label-auto-color', true); sc('sb-auto-color', true); sv('tag-pos', 'bl');
    sc('inset-frames', false); sc('inset-connectors', true); sv('panel-border-w', 2); sv('panel-border-inset', 6);
    sc('show-tags', true); sc('tag-channels', true);
    onLayoutChange(); render(); generateCaption();
    return gelOk;
  });
}

test('a saved session keeps linked insets, background keying, acquisition times and every style control (F03, F14)', async ({ page }) => {
  const errors = await loadApp(page);
  expect(await buildEverything(page)).toBe(true);
  const A = await page.evaluate(() => ({
    S: JSON.stringify(serializeSession(true)), cap: gv('caption-out'),
    vals: ['label-bg', 'label-auto-color', 'sb-auto-color', 'tag-pos', 'inset-frames', 'inset-connectors', 'panel-border-inset', 'show-tags', 'tag-channels']
      .map(id => { const e = document.getElementById(id); return e.type === 'checkbox' ? e.checked : e.value; }),
    px: document.getElementById('fig-canvas').toDataURL(),
  }));
  const before = await geom(page);
  // A fresh page, so nothing can survive in the controls by accident.
  const { p, errors: e2 } = await freshPage(page);
  const B = await p.evaluate(async (S) => {
    applySession(JSON.parse(S), { origin: 'file' });
    await new Promise(r => setTimeout(r, 400)); render(); generateCaption();
    const inset = images.find(i => i && i.insetOf);
    return {
      S: JSON.stringify(serializeSession(true)), cap: gv('caption-out'),
      vals: ['label-bg', 'label-auto-color', 'sb-auto-color', 'tag-pos', 'inset-frames', 'inset-connectors', 'panel-border-inset', 'show-tags', 'tag-channels']
        .map(id => { const e = document.getElementById(id); return e.type === 'checkbox' ? e.checked : e.value; }),
      px: document.getElementById('fig-canvas').toDataURL(),
      insetBound: !!(inset && images.some(q => q && q.id === inset.insetOf)), insetHasPixels: !!(inset && inset.img),
      keyed: !!(images[3].bgKey && images[3].bgKey.on), dT: images.slice(0, 3).map(i => i._metaDeltaT),
      gelFresh: _gelFresh(images[4]), s1: images[1].s1, ruler: annotations.find(a => a.type === 'ruler').rulerName,
      modal: !!document.getElementById('info-modal-bg'),
    };
  }, A.S);
  // Without the fix: insetOf, bgKey, _metaDeltaT and the panel id are missing from the
  // file, the inset becomes an ordinary panel and the caption loses its magnification
  // sentence; the nine style controls come back at the page defaults.
  expect(B.insetBound).toBe(true);
  expect(B.insetHasPixels).toBe(true);
  expect(B.keyed).toBe(true);
  expect(B.dT).toEqual([0, 30, 60]);
  expect(B.gelFresh).toBe(true);
  expect(B.s1).toBe(true);
  expect(B.ruler).toBe('capsid');
  expect(B.vals).toEqual(A.vals);
  expect(B.cap).toBe(A.cap);
  expect(B.cap).toMatch(/Magnified view/);
  expect(B.S).toBe(A.S);                          // the whole file, byte for byte
  expect(B.px).toBe(A.px);                        // and the figure, pixel for pixel
  expect(B.modal).toBe(false);                    // nothing to re-drop
  expect(await geom(p)).toEqual(before);
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});

test('the inset is stored once: its pixels are its parent’s', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [{ name: 'a.png', w: 200, h: 200 }]);
  const r = await page.evaluate(() => {
    selectedPanel = 0; addLinkedInset(0.1, 0.1, 0.4, 0.4);
    const s = serializeSession(true);
    return { parent: !!s.images[0].src, inset: 'src' in s.images[1], bound: s.images[1].insetOf === s.images[0].id };
  });
  expect(r).toEqual({ parent: true, inset: false, bound: true });
  expect(errors).toEqual([]);
});

// Drift guards: a control the figure is drawn with and a field a panel carries must be
// in the one list, or this fails — the scan the tester used to find F14.
test('every control the figure is drawn with is saved; every panel field is saved or named as transient', async ({ page }) => {
  const errors = await loadApp(page);
  expect(await buildEverything(page)).toBe(true);
  const r = await page.evaluate(() => {
    const saved = new Set(_FIG_CONTROLS.map(c => c[1]));
    // Inputs of the figure's own layout and look; builders and generators are not state.
    const exempt = new Set(['advanced-spacing', 'group-axis', 'group-block', 'tag-series-start', 'tag-series-step', 'tag-series-unit', 'tag-series-fmt']);
    const dom = [...document.querySelectorAll('#grid-controls input[id],#grid-controls select[id],#look-grid-only input[id],#look-grid-only select[id]')].map(e => e.id);
    // and every control render() reads by id
    const src = render.toString() + _insetFramesOn.toString();
    const read = [...src.matchAll(/\bg[vci]\('([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)].map(m => m[1] || m[2])
      .filter(id => { const e = document.getElementById(id); return e && /^(INPUT|SELECT)$/.test(e.tagName); });
    const missing = [...new Set([...dom, ...read])].filter(id => !saved.has(id) && !exempt.has(id));
    // Everything the undo snapshot restores is saved too.
    const undoNotSaved = [..._layoutTextIds, ..._layoutCheckIds].filter(id => !saved.has(id));
    const keys = new Set(); images.forEach(im => im && Object.keys(im).forEach(k => keys.add(k)));
    const rec = new Set(); serializeSession(false).images.forEach(d => d && Object.keys(d).forEach(k => rec.add(k)));
    const lost = [...keys].filter(k => !rec.has(k) && !_PANEL_TRANSIENT.has(k) && images.some(im => im && im[k] !== undefined && im[k] !== null));
    return { missing, undoNotSaved, lost };
  });
  expect(r.missing).toEqual([]);
  expect(r.undoNotSaved).toEqual([]);
  expect(r.lost).toEqual([]);
  expect(errors).toEqual([]);
});

// ── F04: the share link ───────────────────────────────────────────────────────
test('a share link restores the same figure after a blank cell: labels, spans, rotation, hidden, borders, groups, width (F04)', async ({ page }) => {
  const errors = await loadApp(page);
  const files = [0, 1, 2, 3].map(i => ({ name: `s${i}.png`, fill: ['#c33', '#3c3', '#33c', '#cc3'][i] }));
  await commit(page, files);
  await page.evaluate(() => {
    sv('cols', 3); sv('rows', 2); onLayoutChange();
    images[0].colSpan = 2; images[1].rotate = 90; images[1].flipH = true; images[2].excluded = true; images[3].borderW = 3;
    images[0].bgKey = { on: true, mode: 'white', tol: 20, feather: 0 }; images[2].s1 = false;
    images[0]._metaUmPerPx = 0.5; images[0]._metaCalibSource = 'TIFF tags';   // as if read from the file
    images.splice(1, 0, null);                                                   // a blank cell after A
    images[2].label = 'Ctrl'; images[4].label = 'KO';
    figGroups = [{ axis: 'col', from: 1, to: 2, label: 'Treated' }]; renderGroupList();
    sv('export-width-mm', 85); sv('fig-title', 'T'); sc('auto-row-h', true); sv('hidden-gap', 'gap');
    sc('label-bg', false); sv('tag-pos', 'bl'); labelOffsets.title = { dx: 12, dy: 3 };
    selectedPanel = 0; addLinkedInset(0.2, 0.2, 0.3, 0.3);
    measurements.push({ type: 'roi', label: 'ROI 1', meanGray: '99' });
    onLayoutChange(); render();
  });
  const hash = await shareLink(page);
  const sent = await page.evaluate(() => JSON.stringify(serializeSession(false, 'share')));
  const before = await geom(page);
  const payload = JSON.parse(decodeURIComponent(Buffer.from(hash.slice(7), 'base64').toString('latin1')));
  // A link carries no pixels, so nothing measured on them or read from the files.
  expect(payload.measurements).toBeUndefined();
  expect(payload.images[0]._metaUmPerPx).toBeUndefined();
  expect(payload.images.some(d => d && 'src' in d)).toBe(false);
  expect(payload._imageCount).toBe(4);              // the inset needs no file

  // The recipient: a fresh page, then the same files in the same order.
  await page.goto('about:blank');
  await page.goto(APP_URL + hash);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  const waiting = await page.evaluate(() => _pendingPanels.filter(p => !p.inset).length);
  expect(waiting).toBe(4);
  await commit(page, files);
  const got = await page.evaluate(() => ({
    S: JSON.stringify(serializeSession(false, 'share')),
    names: images.map(i => i && [i.name, i.label]), w: gv('export-width-mm'), left: _pendingPanels.length,
    insetBound: images.some(i => i && i.insetOf && images.some(q => q && q.id === i.insetOf)),
    meta: images[0]._metaUmPerPx,
  }));
  // Without the fix: 'Ctrl' lands on s2.png (the blank consumed s1), 'KO' is lost, and
  // span, rotation, flip, hidden, border, groups and width come back as defaults.
  expect(got.names).toEqual([['s0.png', 'A'], null, ['s1.png', 'Ctrl'], ['s2.png', 'C'], ['s3.png', 'KO'], ['s0.png', 'B']]);   // the inset, on its parent's pixels
  expect(got.left).toBe(0);
  expect(got.insetBound).toBe(true);
  expect(got.meta).toBe(0);                          // the recipient's file speaks for itself
  expect(got.w).toBe('85');
  // The recipient's figure is the sender's, less only what a link leaves out on purpose.
  const strip = j => { const o = JSON.parse(j); delete o.measurements; return JSON.stringify(o); };
  expect(strip(got.S)).toBe(strip(sent));
  expect(await geom(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('a share link matches dropped files by name, so the drop order does not matter', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [{ name: 'wt.png' }, { name: 'ko.png' }]);
  await page.evaluate(() => { images[0].label = 'WT'; images[1].label = 'KO'; images[1].rotate = 180; });
  const hash = await shareLink(page);
  await page.goto('about:blank'); await page.goto(APP_URL + hash);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await commit(page, [{ name: 'ko.png' }, { name: 'wt.png' }]);
  const r = await page.evaluate(() => images.map(i => [i.name, i.label, i.rotate]));
  expect(r).toEqual([['wt.png', 'WT', 0], ['ko.png', 'KO', 180]]);
  expect(errors).toEqual([]);
});

// ── F07: crash recovery when the figure is too big to autosave whole ──────────
test('an autosave too big for storage keeps every panel, says which files to drop, and takes them back (F07)', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => { try { localStorage.removeItem('fl-autosave-v2'); localStorage.setItem('fl-autosave-enabled', '1'); } catch (e) {} });
  await commit(page, [{ name: 'wt.png', fill: '#c33' }]);
  // A 1600×1600 noise PNG: about 10 M characters as a data URL, over the storage quota.
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 1600; const x = c.getContext('2d');
    const id = x.createImageData(1600, 1600); let s = 7;
    for (let i = 0; i < id.data.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; id.data[i] = (i & 3) === 3 ? 255 : s >>> 24; }
    x.putImageData(id, 0, 0); window.__noise = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, window.__noise, 'noise.png'); res(); }; img.src = window.__noise; });
  });
  await commit(page, [{ name: 'rescue.png', fill: '#3c3' }]);
  const stored = await page.evaluate(() => {
    window.__t = []; const o = toast; window.toast = (m, k) => { window.__t.push(String(m)); return o(m, k); };
    images[0].label = 'WT'; images[0].cropT = 10; images[1].label = 'KO'; images[1].rotate = 90;
    images[2].label = 'Rescue'; images[2].captionNote = 'rescued'; sv('fig-title', 'Important'); render();
    autosaveNow();
    const d = JSON.parse(localStorage.getItem('fl-autosave-v2'));
    return { bundle: d.bundle, unstored: d.unstored, src: d.s.images.map(i => !!i.src), toasts: window.__t };
  });
  // Without the fix every image falls back to settings-only, silently.
  expect(stored.bundle).toBe('partial');
  expect(stored.unstored).toEqual(['noise.png']);
  expect(stored.src).toEqual([true, false, true]);
  expect(stored.toasts.join(' ')).toMatch(/cannot hold the pixels of 1 image/);

  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  const bar = page.locator('div', { hasText: /Recover unsaved session/ }).last();
  await expect(bar).toContainText('1 image too large to store');
  await bar.locator('.btn-primary').click();
  const after = await page.evaluate(() => ({
    imgs: images.map(i => i && [i.name, i.label, i.cropT, i.captionNote]),
    title: gv('fig-title'), modal: document.getElementById('im-body')?.textContent || '',
    head: document.getElementById('im-title')?.textContent || '',
  }));
  // Without the fix: images is [] (every record dropped as "legacy") and the alert
  // blames a session saved before pixel data was embedded.
  expect(after.imgs).toEqual([['wt.png', 'WT', 10, ''], null, ['rescue.png', 'Rescue', 0, 'rescued']]);
  expect(after.title).toBe('Important');
  expect(after.head).toMatch(/1 panel needs the image file again/);
  expect(after.modal).toMatch(/Browser storage could not hold their pixels/);
  expect(after.modal).toMatch(/noise\.png — panel KO/);
  expect(after.modal).not.toMatch(/before pixel data/);
  // Dropping the file again puts it back in its place with its settings.
  await page.evaluate(() => document.getElementById('info-modal-bg').remove());
  await commit(page, [{ name: 'noise.png', w: 64, h: 64 }]);
  const back = await page.evaluate(() => images.map(i => i && [i.name, i.label, i.rotate]));
  expect(back).toEqual([['wt.png', 'WT', 0], ['noise.png', 'KO', 90], ['rescue.png', 'Rescue', 0]]);
  await page.evaluate(() => { undo(); });           // that drop is one undo step, and the slot waits again
  expect(await page.evaluate(() => [images[1], _pendingPanels.length])).toEqual([null, 1]);
  await page.evaluate(() => { try { localStorage.removeItem('fl-autosave-v2'); } catch (e) {} });
  expect(errors).toEqual([]);
});

test('a settings-only file says so, not that it predates embedded pixels', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[1].label = 'KO'; images[1].cropL = 12;
    const s = JSON.parse(JSON.stringify(serializeSession(false)));
    applySession(s, { origin: 'file' });
    return { n: images.length, nulls: images.every(i => i === null), body: document.getElementById('im-body').textContent,
      pending: _pendingPanels.map(p => [p.slot, p.rec.label, p.rec.cropL]) };
  });
  expect(r.n).toBe(2); expect(r.nulls).toBe(true);
  expect(r.pending).toEqual([[0, 'A', 0], [1, 'KO', 12]]);
  expect(r.body).toMatch(/saved as settings only/);
  expect(errors).toEqual([]);
});

test('densitometry put back on a re-dropped file is kept but stale until re-detected', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [{ name: 'gel.png', gel: true, w: 280, h: 140 }]);
  const r = await page.evaluate(() => {
    const ok = runGelAnalysis(0); const ref = images[0].gelAnalysis.lanes.length;
    const s = JSON.parse(JSON.stringify(serializeSession(false)));
    applySession(s, { origin: 'file' }); document.getElementById('info-modal-bg').remove();
    return { ok, ref, kept: !!s.images[0].gelAnalysis };
  });
  expect(r).toEqual({ ok: true, ref: 3, kept: true });
  await commit(page, [{ name: 'gel.png', gel: true, w: 280, h: 140 }]);
  const after = await page.evaluate(() => ({ has: !!images[0].gelAnalysis, fresh: _gelFresh(images[0]) }));
  // The numbers were measured on pixels the file did not store: kept for the user's
  // ladder and reference lane, but never reported as current until re-detected.
  expect(after).toEqual({ has: true, fresh: false });
  expect(errors).toEqual([]);
});

// ── F22 / M12, F23 / M14, M13: figure boundaries ──────────────────────────────
async function oldFigure(page) {
  await seedPanels(page, 3);
  await page.evaluate(() => {
    sv('fig-title', 'OLD FIGURE'); figGroups = [{ axis: 'col', from: 1, to: 2, label: 'Treated' }]; renderGroupList();
    advancedSpacing = true; colGaps = [80, 0]; labelOffsets.title = { dx: 40, dy: 0 };
    measurements.push({ type: 'roi', label: 'ROI 1', meanGray: '99' });
    document.getElementById('fig-notes').value = 'old notes';
    addFreeformElement({ type: 'text', x: 20, y: 20, w: 100, h: 30, text: 'old object' });
    sc('label-bg', false); sv('label-size', 22); sv('export-dpi', 600);
    render(); generateCaption(); writeMethodsParagraph(); _figAltText = 'old alt';
  });
}
test('New figure is a blank figure, the same as a fresh page, and Ctrl+Z brings the old one back (F22, M12)', async ({ page }) => {
  const errors = await loadApp(page);
  const blank = await page.evaluate(() => JSON.stringify(serializeSession(false)));
  await oldFigure(page);
  const old = await page.evaluate(() => JSON.stringify({ s: serializeSession(false), alt: _figAltText }));
  await page.evaluate(() => confirmNewFigure());
  await page.click('#cm-ok');
  const r = await page.evaluate(() => ({ s: JSON.stringify(serializeSession(false)), alt: _figAltText,
    btn: document.getElementById('export-measurements-btn').style.display }));
  // Without the fix the title, group band, gutters, title offset, measurement, notes,
  // object, caption and Methods all survive into the new figure.
  expect(r.s).toBe(blank);
  expect(r.alt).toBe('');
  expect(r.btn).toBe('none');
  await page.evaluate(() => undo());
  const back = await page.evaluate(() => JSON.stringify({ s: serializeSession(false), alt: _figAltText }));
  expect(back).toBe(old);
  expect(errors).toEqual([]);
});

test('a tutorial starts from a blank figure, and Ctrl+Z returns the user’s', async ({ page }) => {
  const errors = await loadApp(page);
  await oldFigure(page);
  const old = await page.evaluate(() => JSON.stringify(serializeSession(false)));
  const r = await page.evaluate(async () => {
    await _tutSeed([{ kind: 'nuclei', seed: 2, name: 't.png' }], { cols: 1, rows: 1 });
    return { title: gv('fig-title'), groups: figGroups.length, m: measurements.length, notes: gv('fig-notes'), cap: gv('caption-out'), ff: freeformElements.length };
  });
  expect(r).toEqual({ title: '', groups: 0, m: 0, notes: '', cap: '', ff: 0 });
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => JSON.stringify(serializeSession(false)))).toBe(old);
  expect(errors).toEqual([]);
});

test('opening a session replaces caption, Methods, measurements and notes, and is one undo step (F23, M13, M14)', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const fileB = await page.evaluate(() => {
    sv('fig-title', 'Figure B'); document.getElementById('fig-notes').value = '';
    const s = JSON.parse(JSON.stringify(serializeSession(true)));
    delete s.measurements; delete s.captionText; delete s.methodsText;    // an older file
    return s;
  });
  await page.evaluate(() => { images = []; undoStack = []; redoStack = []; });
  await oldFigure(page);
  const before = await page.evaluate(() => { pushUndo(); images[0].label = 'A-edited'; renderImgList(); render();
    return JSON.stringify({ s: serializeSession(true), alt: _figAltText }); });
  const r = await page.evaluate((B) => {
    const depth = undoStack.length;
    applySession(B, { origin: 'file' });
    return { title: gv('fig-title'), n: images.length, cap: gv('caption-out'), methods: gv('methods-out'),
      m: measurements.length, notes: gv('fig-notes'), dpi: gv('export-dpi'), steps: undoStack.length - depth };
  }, fileB);
  // Without the fix the caption still says "OLD FIGURE" with three panels, Methods
  // names panels A–C, the old ROI and notes stay, and the load is no undo step.
  expect(r).toEqual({ title: 'Figure B', n: 1, cap: '', methods: '', m: 0, notes: '', dpi: '300', steps: 1 });
  await page.evaluate(() => undo());
  const undone = await page.evaluate(() => JSON.stringify({ s: serializeSession(true), alt: _figAltText }));
  expect(undone).toBe(before);                       // exactly the figure before the load, its last edit included
  await page.evaluate(() => redo());
  expect(await page.evaluate(() => gv('fig-title'))).toBe('Figure B');
  // A file that has its caption and Methods brings them back.
  const r2 = await page.evaluate(() => { sv('caption-out', 'cap B'); sv('methods-out', 'methods B');
    const s = JSON.parse(JSON.stringify(serializeSession(true))); sv('caption-out', 'x'); sv('methods-out', 'y');
    applySession(s); return [gv('caption-out'), gv('methods-out')]; });
  expect(r2).toEqual(['cap B', 'methods B']);
  expect(errors).toEqual([]);
});

// ── F21: templates ────────────────────────────────────────────────────────────
test('a template keeps 0 px margins, and loading one is an undo step (F21)', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    ['m-btm', 'm-right', 'm-top', 'm-left'].forEach(id => sv(id, 0)); onLayoutChange(); render();
    const size = [canvasLogicalW, canvasLogicalH];
    document.getElementById('tpl-name-input').value = 'tight'; saveTemplate();
    sv('m-btm', 40); sv('m-right', 40);
    const depth = undoStack.length;
    loadTemplate(getSavedTemplates().find(t => t.name === 'tight')); render();
    return { m: [gv('m-btm'), gv('m-right')], size, after: [canvasLogicalW, canvasLogicalH], steps: undoStack.length - depth };
  });
  // Without the fix `t.mBtm||16` turns 0 into 16 and the figure grows 16 px each way.
  expect(r.m).toEqual(['0', '0']);
  expect(r.after).toEqual(r.size);
  expect(r.steps).toBe(1);
  expect(errors).toEqual([]);
});

// ── Older files and links still open as they did ─────────────────────────────
const OLDX = path.join(FX, 'persistence');
const EXPECT = JSON.parse(fs.readFileSync(path.join(OLDX, 'expect-1bfe83b.json'), 'utf8'));
// Every key an older build wrote, with the value it wrote, is still there after loading.
function subsetDiff(a, b, at = '') {
  if (a === null || typeof a !== 'object') return a === b ? [] : [`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
  if (b === null || typeof b !== 'object') return [`${at}: missing`];
  return Object.keys(a).flatMap(k => subsetDiff(a[k], b[k], at + '.' + k));
}

test('a session saved by the build before this change opens with the same figure', async ({ page }) => {
  const errors = await loadApp(page);
  const file = JSON.parse(fs.readFileSync(path.join(OLDX, 'session-1bfe83b.json'), 'utf8'));
  const r = await page.evaluate(async (f) => {
    applySession(f, { origin: 'file' }); await new Promise(res => setTimeout(res, 300));
    return { settings: JSON.parse(JSON.stringify(serializeSession(false))), labels: images.map(i => i && i.label) };
  }, file);
  // The ids are new (older files had none); everything else the old build wrote is unchanged.
  expect(subsetDiff(EXPECT.settings, r.settings)).toEqual([]);
  expect(r.labels).toEqual(EXPECT.labels);
  const g = await geom(page);
  expect(g.b).toEqual(EXPECT.bounds);
  expect(g.size).toEqual(EXPECT.size);
  expect(errors).toEqual([]);
});

test('a share link made by the build before this change still opens, with its blank cell kept', async ({ page }) => {
  const errors = await loadApp(page);
  await page.goto('about:blank'); await page.goto(APP_URL + EXPECT.hash);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  const files = [0, 1, 2].map(i => ({ name: `old${i}.png`, b64: fs.readFileSync(path.join(OLDX, `old${i}.png`)).toString('base64'), type: 'image/png' }));
  for (const f of files) {             // one at a time, so the order is the drop order
    await page.evaluate(async (f) => { const b = atob(f.b64); const u = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      const src = 'data:image/png;base64,' + f.b64;
      await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, f.name); res(); }; img.src = src; }); }, f);
  }
  const r = await page.evaluate(() => ({ labels: images.map(i => i && [i.name, i.label, i.cropT, i.captionNote]), title: gv('fig-title') }));
  // The old link's list had the blank cell as null; it used to eat the next image.
  expect(r.labels).toEqual([['old0.png', 'A', 10, 'wild type'], null, ['old1.png', 'B', 0, ''], ['old2.png', 'KO', 0, '']]);
  expect(r.title).toBe('Old figure');
  expect(errors).toEqual([]);
});
