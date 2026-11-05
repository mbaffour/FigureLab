// @ts-check
// Round 2 of the stress test: panels waiting for their file, what every writer keeps,
// and the export plumbing. A panel opened without its pixels (a settings-only file, a
// share link, an autosave too big for storage) now survives every save, moves with the
// grid, is listed as waiting and is forgotten when removed; a multi-page TIFF fills its
// panels by page; duplicated ids keep an inset on its own panel; the reproducibility log
// starts again with each figure; a built-in template replaces the gutters and is one
// undo step; the multi-page PDF no longer lends the figure to one page across an await;
// ZIP entry names fit every file system; the measurements CSV keeps zeros and counts.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { loadApp, APP_URL, gesture, panelCenter } = require('./helpers');

const MULTI = fs.readFileSync(path.join(__dirname, 'fixtures', 'tiff', 'multipage.tif')).toString('base64');

async function commit(page, specs) {
  await page.evaluate(async (specs) => {
    for (const s of specs) {
      const c = document.createElement('canvas'); c.width = s.w || 100; c.height = s.h || 80;
      const x = c.getContext('2d'); x.fillStyle = s.fill || '#888'; x.fillRect(0, 0, c.width, c.height);
      if (!s.flat) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width / 4, c.height / 4); }
      const src = c.toDataURL('image/png');
      await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, s.name); res(); }; img.src = src; });
    }
    render();
  }, specs);
}
async function dropTiff(page, name) {
  await page.evaluate(async ([b64, name]) => {
    const b = atob(b64); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    await addFiles([new File([u], name, { type: 'image/tiff' })]);
  }, [MULTI, name]);
}
async function shareLink(page) {
  return page.evaluate(async () => {
    let href = null;
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    navigator.clipboard.writeText = async (t) => { href = t; };
    shareSession(); await new Promise(r => setTimeout(r, 60));
    return href.slice(href.indexOf('#share='));
  });
}
const closeModal = page => page.evaluate(() => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); });

// A settings-only file of three panels in a 3 × 1 grid; KO is rotated, cropped and noted.
async function settingsFile(page) {
  await commit(page, [{ name: 'a.png', fill: '#c33' }, { name: 'b.png', fill: '#3c3' }, { name: 'c.png', fill: '#33c' }]);
  return page.evaluate(() => {
    sv('cols', 3); sv('rows', 1); onLayoutChange();
    images[0].label = 'WT'; images[1].label = 'KO'; images[1].rotate = 90; images[1].cropT = 7;
    images[1].captionNote = 'knockout'; images[2].label = 'RES';
    return JSON.parse(JSON.stringify(serializeSession(false)));
  });
}
async function openWaiting(page, S) {
  await page.goto('about:blank'); await page.goto(APP_URL);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate(s => applySession(s, { origin: 'file' }), S);
  await closeModal(page);
  await commit(page, [{ name: 'a.png', fill: '#c33' }, { name: 'c.png', fill: '#33c' }]);   // KO waits in cell 2
}
const panels = page => page.evaluate(() => images.map(i => i && [i.name, i.label, i.rotate]));

// ── R2-02: a waiting panel is written back by every writer ─────────────────────────
test('a panel waiting for its file is kept by Save session, the share link and the autosave', async ({ page }) => {
  const errors = await loadApp(page);
  const S = await settingsFile(page);
  await page.goto('about:blank'); await page.goto(APP_URL);
  await page.waitForFunction(() => typeof render === 'function');
  const r = await page.evaluate((s) => {
    localStorage.setItem('fl-autosave-enabled', '1');
    applySession(s, { origin: 'file' });
    const rec = d => d && [d.name, d.label, d.rotate, d.cropT, d.captionNote];
    autosaveNow();
    const stored = JSON.parse(localStorage.getItem('fl-autosave-v2'));
    return {
      waiting: _pendingPanels.length,
      bundle: serializeSession(true).images.map(rec),
      settings: serializeSession(false).images.map(rec),
      share: serializeSession(false, 'share').images.map(rec),
      stored: { bundle: stored.bundle, waiting: stored.waiting, images: stored.s.images.map(rec) },
    };
  }, S);
  // Without the fix every writer maps images[] alone, where the three cells are empty:
  // [null, null, null] — the labels, KO's rotation, crop and note gone from each file.
  const want = [['a.png', 'WT', 0, 0, ''], ['b.png', 'KO', 90, 7, 'knockout'], ['c.png', 'RES', 0, 0, '']];
  expect(r.waiting).toBe(3);
  expect(r.bundle).toEqual(want);
  expect(r.settings).toEqual(want);
  expect(r.share).toEqual(want);
  expect(r.stored.images).toEqual(want);
  expect(r.stored.bundle).toBe('partial');            // so the recovery bar asks for the files
  expect(r.stored.waiting).toEqual(['a.png', 'b.png', 'c.png']);
  expect(errors).toEqual([]);
});

test('a partial recovery survives the autosave its own restore schedules, and a second recovery', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [{ name: 'wt.png', fill: '#c33' }, { name: 'noise.png', fill: '#3c3' }]);
  await page.evaluate(() => {
    localStorage.setItem('fl-autosave-enabled', '1');
    images[0].label = 'WT'; images[1].label = 'KO'; images[1].rotate = 90; images[1].cropT = 7;
    const s = serializeSession(true); delete s.images[1].src;   // what autosaveNow writes when storage is full
    localStorage.setItem('fl-autosave-v2', JSON.stringify({ t: Date.now(), bundle: 'partial', unstored: ['noise.png'], s }));
    clearTimeout(_autosaveDebounce); clearInterval(_autosaveTimer); window.removeEventListener('beforeunload', autosaveNow);
  });
  const restore = async () => {
    await page.reload(); await page.waitForFunction(() => typeof render === 'function');
    const bar = page.locator('div', { hasText: 'Recover unsaved session' }).filter({ has: page.locator('.btn-primary') }).last();
    await expect(bar).toBeVisible();
    const text = (await bar.textContent()).replace(/\s+/g, ' ');
    const t0 = await page.evaluate(() => Date.now());
    await bar.locator('.btn-primary').click();
    await closeModal(page);
    return { text, t0 };
  };
  const { t0 } = await restore();
  // The restore's undo step schedules an autosave 2.5 s later; let it run.
  await page.waitForFunction(t => JSON.parse(localStorage.getItem('fl-autosave-v2')).t > t, t0, { timeout: 6000 });
  const stored = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fl-autosave-v2')); return { bundle: d.bundle, ko: d.s.images[1] && [d.s.images[1].label, d.s.images[1].rotate, d.s.images[1].cropT] }; });
  // Without the fix the autosave stores {bundle:true, images:['WT', null]}: KO is gone.
  expect(stored).toEqual({ bundle: 'partial', ko: ['KO', 90, 7] });
  const bar2 = (await restore()).text;
  expect(bar2).toMatch(/1 image still to be dropped/);
  const after = await page.evaluate(() => _pendingPanels.map(p => [p.slot, p.rec.name, p.rec.label, p.rec.rotate, p.rec.cropT]));
  expect(after).toEqual([[1, 'noise.png', 'KO', 90, 7]]);
  expect(errors).toEqual([]);
});

// ── R2-06: a waiting panel moves with the grid, is named, and is gone when removed ─────
test('a waiting panel follows its neighbours when a cell before it is removed or inserted', async ({ page }) => {
  const errors = await loadApp(page);
  const S = await settingsFile(page);

  // (a) Remove WT with its ✕ in the list, then drop b.png.
  await openWaiting(page, S);
  const listed = await page.evaluate(() => [...document.querySelectorAll('#img-list .blank-slot')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  expect(listed).toEqual(['⧗ waiting for b.png — panel KO×']);     // was "▭ blank cell (slot 2)"
  await page.evaluate(() => document.querySelector('#img-list [data-del]').click());
  await commit(page, [{ name: 'b.png', fill: '#3c3' }]);
  // Without the fix: [null, RES, KO] — a stray blank first and KO after RES.
  expect(await panels(page)).toEqual([['b.png', 'KO', 90], ['c.png', 'RES', 0]]);

  // (b) A blank cell inserted after WT puts KO one cell later, and it is drawn.
  await openWaiting(page, S);
  await page.evaluate(() => { selectedPanel = 0; insertBlankCell(); });
  await commit(page, [{ name: 'b.png', fill: '#3c3' }]);
  const b = await page.evaluate(() => ({ imgs: images.map(i => i && i.label), drawn: _gridPlacements().some(p => p.im && p.im.label === 'KO') }));
  // Without the fix KO keeps slot 1 and fills the blank just inserted: [WT, KO, null, RES].
  expect(b.imgs).toEqual(['WT', null, 'KO', 'RES']);
  expect(b.drawn).toBe(true);
  expect(errors).toEqual([]);
});

test('dragging a panel past a waiting cell and undoing it leaves an empty cell, not a marker', async ({ page }) => {
  const errors = await loadApp(page);
  const S = await settingsFile(page);
  await openWaiting(page, S);
  await page.evaluate(() => render());
  const from = await panelCenter(page, 0), to = await panelCenter(page, 2);
  await gesture(page, 'drag', [from, [(from[0] + to[0]) / 2, from[1]], to]);      // WT onto RES, across KO's cell
  const dragged = await page.evaluate(() => ({ imgs: images.map(i => i && i.name), waiting: _pendingPanels.map(p => p.slot) }));
  expect(dragged).toEqual({ imgs: ['c.png', null, 'a.png'], waiting: [1] });
  // The swap records its step inside the edit that holds the waiting cell's marker.
  // Without the snapshot treating it as the empty cell it is, Ctrl+Z put a pixel-less
  // marker object into the figure.
  await page.evaluate(() => undo());
  const undone = await page.evaluate(() => { render(); return { imgs: images.map(i => i && i.name), marker: images.some(i => i && i._waitMark), waiting: _pendingPanels.map(p => p.slot) }; });
  expect(undone).toEqual({ imgs: ['a.png', null, 'c.png'], marker: false, waiting: [1] });
  await commit(page, [{ name: 'b.png', fill: '#3c3' }]);
  expect(await panels(page)).toEqual([['a.png', 'WT', 0], ['b.png', 'KO', 90], ['c.png', 'RES', 0]]);
  expect(errors).toEqual([]);
});

test('removing a waiting panel forgets it: the next file is a new panel, and Ctrl+Z brings it back', async ({ page }) => {
  const errors = await loadApp(page);
  const S = await settingsFile(page);
  await openWaiting(page, S);
  const before = await page.evaluate(() => undoStack.length);
  await page.evaluate(() => document.querySelector('#img-list [data-delblank]').click());
  const r = await page.evaluate(() => ({ steps: undoStack.length, waiting: _pendingPanels.length, n: images.length }));
  expect(r).toEqual({ steps: before + 1, waiting: 0, n: 2 });
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => _pendingPanels.map(p => [p.slot, p.rec.label]))).toEqual([[1, 'KO']]);
  await page.evaluate(() => redo());
  await commit(page, [{ name: 'unrelated.png', fill: '#999' }]);
  const last = await page.evaluate(() => { const im = images[images.length - 1]; return [im.name, im.label, im.rotate, im.cropT]; });
  // Without the fix the record stays behind and the unrelated file becomes panel KO,
  // turned 90° with b.png's crop.
  expect(last).toEqual(['unrelated.png', 'A', 0, 0]);
  expect(errors).toEqual([]);
});

// ── R2-01: a multi-page TIFF re-dropped on a share link fills its panels by page ─────
test('a share link of a multi-page TIFF puts each page back in the panel that cites it', async ({ page }) => {
  const errors = await loadApp(page);
  const grey = () => images.map(i => { if (!i) return null; const c = document.createElement('canvas'); c.width = c.height = 1;
    const x = c.getContext('2d'); x.drawImage(i.img, 0, 0, 1, 1); return [i.label, i.srcPage, x.getImageData(0, 0, 1, 1).data[0]]; });
  await dropTiff(page, 'multipage.tif');
  await page.waitForFunction(() => images.filter(Boolean).length === 3);
  const sender = await page.evaluate((g) => {
    images.splice(1, 1); images.forEach(im => { im.label = 'P' + im.srcPage; }); render();
    return eval(g)();
  }, `(${grey})`);
  const hash = await shareLink(page);
  expect(JSON.parse(decodeURIComponent(Buffer.from(hash.slice(7), 'base64').toString('latin1'))).images.map(d => d.srcPage)).toEqual([1, 3]);
  await page.goto('about:blank'); await page.goto(APP_URL + hash);
  await page.waitForFunction(() => typeof render === 'function' && _pendingPanels.length === 2);
  await dropTiff(page, 'multipage.tif');
  await page.waitForFunction(() => images.filter(Boolean).length === 3);
  const got = await page.evaluate((g) => ({ px: eval(g)(), src: images.map(i => _sourceName(i)) }), `(${grey})`);
  // Without the fix page 2 fills P3's cell by file name (grey 118 under "page 3 of 3") and
  // page 3 is appended citing page 3 as well.
  expect(got.px.slice(0, 2)).toEqual(sender);
  expect(got.px[2][1]).toBe(2);
  expect(got.src).toEqual(['multipage.tif (page 1 of 3)', 'multipage.tif (page 3 of 3)', 'multipage.tif (page 2 of 3)']);
  expect(errors).toEqual([]);
});

// ── R2-07: duplicate ids split on load keep an inset on the panel it was cut from ─────
test('an inset of the second of two panels sharing an id stays on that panel when the ids are split', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [{ name: 'p.png', fill: '#cc3333', w: 200, h: 200, flat: true }, { name: 'q.png', fill: '#3333cc', w: 200, h: 200, flat: true }]);
  const r = await page.evaluate(async () => {
    sc('show-labels', false);
    selectedPanel = 1; addLinkedInset(0.5, 0.5, 0.4, 0.4);
    const mid = i => { render(); const b = panelBounds.find(p => p.idx === i);
      const d = document.getElementById('fig-canvas').getContext('2d').getImageData(b.x + b.w / 2 - 2, b.y + b.h / 2 - 2, 4, 4).data; return [d[0], d[1], d[2]]; };
    const before = mid(2);
    const s = JSON.parse(JSON.stringify(serializeSession(true))); s.images[0].id = s.images[1].id;   // what the old Duplicate row wrote
    applySession(s, { origin: 'file' }); await new Promise(r => setTimeout(r, 300));
    const ids = images.map(i => i.id);
    return { before, after: mid(2), parent: images.find(q => q.id === images[2].insetOf).name, unique: new Set(ids).size };
  });
  // Without the fix the inset re-binds to p.png and turns red (204,51,51).
  expect(r.before).toEqual([51, 51, 204]);
  expect(r.after).toEqual([51, 51, 204]);
  expect(r.parent).toBe('q.png');
  expect(r.unique).toBe(3);
  expect(errors).toEqual([]);
});

// ── R2-11: the reproducibility log starts again with each figure ─────────────────────
test('the reproducibility log covers this figure only, and Ctrl+Z on New brings the old log back', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [{ name: 'other_project_patient042.png' }]);
  const named = () => page.evaluate(() => reproLog.filter(e => e.name).map(e => e.name));
  expect(await named()).toEqual(['other_project_patient042.png']);
  await page.evaluate(() => confirmNewFigure()); await page.click('#cm-ok');
  // Without the fix the previous figure's import is still listed.
  expect(await page.evaluate(() => reproLog.map(e => e.action))).toEqual(['newFigure']);
  await page.evaluate(() => undo());
  expect(await named()).toEqual(['other_project_patient042.png']);
  await page.evaluate(() => redo());
  await page.evaluate(async () => { await startTutorial('blot'); _tourEnd(); });
  expect(await named()).toEqual([]);
  await page.evaluate(() => applySession({ layout: { cols: 1, rows: 1 }, images: [] }, { origin: 'file' }));
  expect(await page.evaluate(() => reproLog.length)).toBe(0);
  await commit(page, [{ name: 'fig2_panel.png' }]);
  expect(await page.evaluate(() => reproLog.map(e => e.action + ':' + (e.name || '')))).toEqual(['addImage:fig2_panel.png']);
  // A style file applied to the panels on screen is not a new figure.
  await page.evaluate(() => applySession({ layout: { cols: 1, rows: 1 } }, { origin: 'file' }));
  expect(await named()).toEqual(['fig2_panel.png']);
  expect(errors).toEqual([]);
});

// ── R2-03: a built-in template replaces the gutters and is one undo step ─────────────
test('a built-in template applies its own gaps over per-gutter overrides and is one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [1, 2, 3, 4, 5, 6].map(i => ({ name: `p${i}.png` })));
  const r = await page.evaluate(() => {
    sv('cols', 3); sv('rows', 2); onLayoutChange();
    pushUndo(); advancedSpacing = true; document.getElementById('advanced-spacing').checked = true; colGaps = [80, null]; rowGaps = [60]; render();
    pushUndo(); sc('auto-row-h', true); render();
    const depth = undoStack.length;
    applyTemplate('supp3x3'); render();
    const b = i => panelBounds.find(p => p.idx === i);
    const out = { steps: undoStack.length - depth, colGaps, rowGaps, hug: gc('auto-row-h'),
      gutter: Math.round(b(1).x - (b(0).x + b(0).w)), rowGap: Math.round(b(3).y - (b(0).y + b(0).h)) };
    undo();
    out.undone = { cols: gv('cols'), rows: gv('rows'), hug: gc('auto-row-h'), colGaps };
    return out;
  });
  // Without the fix: no undo step (Ctrl+Z undid Rows hug instead), and the 80 px column
  // and 60 px row gutters survived the template's 4 px.
  expect(r.steps).toBe(1);
  expect([r.colGaps, r.rowGaps, r.hug]).toEqual([null, null, false]);
  expect([r.gutter, r.rowGap]).toEqual([4, 4]);
  expect(r.undone).toEqual({ cols: '3', rows: '2', hug: true, colGaps: [80, null] });
  expect(errors).toEqual([]);
});

// ── R2-04: the multi-page PDF never lends the figure to one page across an await ─────
test('a multi-page PDF export leaves the selection, undo, redo and the autosave with the whole figure', async ({ page }) => {
  const errors = await loadApp(page);
  await commit(page, [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ name: `p${i}.png`, fill: `hsl(${i * 40},60%,50%)` })));
  const r = await page.evaluate(async () => {
    localStorage.setItem('fl-autosave-enabled', '1');
    window.dl = () => {};                                   // no file written
    sv('cols', 2); sv('rows', 4); onLayoutChange(); sv('pdf-rows-per-page', 2); render();
    pushUndo(); images[0].label = 'WT'; render();           // the user's last edit
    selectedPanel = 5;
    const orig = _pdfPageFor; let k = 0; const seen = [];
    window._pdfPageFor = async function (...a) {
      autosaveNow(); seen.push(JSON.parse(localStorage.getItem('fl-autosave-v2')).s.images.length);
      if (k++ === 1) undo();                               // Ctrl+Z while page 2 is encoded
      return orig.apply(this, a);
    };
    await exportMultiPagePDF({ lossless: true });
    window._pdfPageFor = orig;
    const after = { sel: selectedPanel >= 0 ? images[selectedPanel].name : null, n: images.length, l0: images[0].label, seen };
    redo();
    after.redone = { n: images.length, l0: images[0].label };
    return after;
  });
  // Without the fix: the selection is forgotten (-1), each autosave holds one page (4),
  // the undo is overwritten by the export's restore, and Ctrl+Y brings back page 2 alone.
  expect(r.sel).toBe('p6.png');
  expect(r.seen).toEqual([8, 8]);
  expect([r.n, r.l0]).toEqual([8, 'A']);
  expect(r.redone).toEqual({ n: 8, l0: 'WT' });
  expect(errors).toEqual([]);
});

// ── R2-05: ZIP entry names extract on every system ───────────────────────────────────
test('ZIP entry names are cut to 100 characters, stay unique and avoid Windows device names', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const long = 'x'.repeat(300), wide = '😀'.repeat(150);   // 4 bytes each: the byte cap, not the character cap, cuts it
    // Three labels that differ only past the cut become one name, then _2 and _3.
    const files = ['panels/panel_3_' + long + 'a.png', 'panels/panel_3_' + long + 'b.png', 'panels/panel_3_' + long + 'c.png',
      'panels/CON.png', 'nul', 'LPT1.txt', 'panels/panel_2_CON.png', 'source-data/' + wide + '.csv', 'a'.repeat(94) + '. bbbbbb.png']
      .map(name => ({ name }));
    _zipEntryNames(files);
    return files.map(f => f.name);
  });
  const base = n => n.split('/').pop();
  for (const n of r) {
    expect([...base(n)].length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(base(n))).toBeLessThanOrEqual(240);
    expect(base(n)).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i);
    expect(base(n).replace(/\.[^.]+$/, '')).not.toMatch(/[ .]$/);
  }
  // Without the fix the long names are 312 characters and CON.png, nul, LPT1.txt pass.
  expect(new Set(r.map(n => n.toLowerCase())).size).toBe(r.length);
  expect(r.slice(0, 3).map(n => n.slice(-7))).toEqual(['xxx.png', 'x_2.png', 'x_3.png']);
  expect(r.slice(3, 7)).toEqual(['panels/_CON.png', '_nul', '_LPT1.txt', 'panels/panel_2_CON.png']);
  expect(r[7]).toBe('source-data/' + '😀'.repeat(59) + '.csv');
  expect(r[8]).toBe('a'.repeat(94) + '.png');        // the cut leaves no '. ' before the extension
  expect(errors).toEqual([]);
});

// ── R2-15: the measurements CSV keeps zeros and a count's result ─────────────────────
test('the measurements CSV writes 0 as 0 and carries a count and its threshold', async ({ page }) => {
  const errors = await loadApp(page);
  const csv = await page.evaluate(() => {
    let text = null; window.blobUrl = t => { text = t; return 'blob:x'; }; window.dl = () => {};
    measurements = [
      { type: 'roi', label: 'ROI 1', x: 0, y: 190, w: 30, h: 20, meanGray: '0.00', minV: 0, maxV: 0, area: 600, intDens: '0', source: '8-bit display' },
      { type: 'cellCount', label: 'Count 1', x: 62, y: 42, w: 296, h: 296, area: 87616, count: 2, threshold: 128 },
    ];
    exportMeasurements();
    return text;
  });
  const rows = csv.split('\n').filter(l => !l.startsWith('#')).map(l => JSON.parse('[' + l + ']'));
  const col = (row, name) => row[rows[0].indexOf(name)];
  // Without the fix X, Display Min and Display Max are '' and there is no Count column.
  expect([col(rows[1], 'X'), col(rows[1], 'Display Min'), col(rows[1], 'Display Max')]).toEqual(['0', '0', '0']);
  expect([col(rows[2], 'Count'), col(rows[2], 'Threshold')]).toEqual(['2', '128']);
  expect(col(rows[1], 'Count')).toBe('');
  expect(errors).toEqual([]);
});
