// @ts-check
// Usability round 5, group `images` (polish part): insets in a channels | merge grid, the
// Undo toast, ✕ New and the export record, the alt-text draft and the legend key placed
// under the panels. Each test drives the round-5 finding (IDs in the titles) and fails on
// the build the testers used (1cedb76).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const HELPERS = `
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fixes: [...e.querySelectorAll('button')].map(b => b.textContent.trim()) }));
  window.__report = () => { checkCompliance(); const r = { rows: __rows() }; __close(); return r; };
  window.__row = (l) => __report().rows.find(r => r.label === l) || null;
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
`;
const toastText = (page) => page.evaluate(() => document.getElementById('toast').textContent);

// A channels | merge grid: rows of DAPI, GFP, mCherry and their merge, 4 columns.
async function channelGrid(page, rows, cols) {
  await page.evaluate(HELPERS);
  await page.evaluate(async ([rows, cols]) => {
    const mk = (g) => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(0, 0, 200, 200); return c.toDataURL(); };
    for (let i = 0; i < rows * 4; i++) { const src = mk(20 + i * 3); await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'f' + i + '.png'); r(); }; im.src = src; }); }
    sv('cols', String(cols)); sv('rows', String(Math.ceil(rows * 4 / cols) + 1)); onLayoutChange();
    const L = ['blue', 'green', 'magenta'];
    images.forEach((im, i) => { const k = i % 4; if (k < 3) im.lut = L[k]; else { im.lut = 'blue';
      im.channels = [{ img: images[i - 2].img, src: images[i - 2].src, lut: 'green', name: 'g.tif', blackPt: 0, whitePt: 255 },
        { img: images[i - 1].img, src: images[i - 1].src, lut: 'magenta', name: 'm.tif', blackPt: 0, whitePt: 255 }]; } });
    render();
  }, [rows, cols]);
}

// ── fluor5-07 ──────────────────────────────────────────────────────────────────────────
test('fluor5-07: an inset in a channels | merge grid with a free cell goes there by default, and no row shifts', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 3, 4);                                   // 12 panels in 4 × 4: a free row
  const before = await page.evaluate(() => _gridPlacements().filter(c => c.im).map(c => `${c.r},${c.c}:${c.im.label}`));
  // a merge at the end of its row keeps "right after it" (the zoom column of ux1 fluor-11)
  await page.evaluate(() => { selectedPanel = 3; pickInsetRegion(); });
  await expect(page.locator('#inset-place')).toHaveValue('after');
  await page.evaluate(() => closeCropModal());
  await page.evaluate(() => { selectedPanel = 5; pickInsetRegion(); });     // row 2's GFP
  await expect(page.locator('#inset-place-row')).toBeVisible();
  await expect(page.locator('#inset-place')).toHaveValue('free');
  await page.click('#crop-apply-btn');
  const r = await page.evaluate(() => {
    const ins = images.find(im => im && im.insetOf != null);
    const cells = _gridPlacements().filter(c => c.im);
    return { cells: cells.filter(c => c.im !== ins).map(c => `${c.r},${c.c}:${c.im.label}`), insAt: cells.find(c => c.im === ins), label: ins.label,
      t: document.getElementById('toast').textContent };
  });
  expect(r.cells).toEqual(before);                                // every merge stays at the end of its row
  expect(r.insAt.r).toBe(3);
  expect(r.label).toBe('M');
  expect(r.t).toMatch(/Inset M of F placed in the first free cell — no other panel moved/);
  expect(errors).toEqual([]);
});

test('fluor5-07: hidden source panels holding the letters do not make the new inset "28"', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 2, 4);
  // 20 hidden source files after the 8 shown panels hold I … Z and 27
  await page.evaluate(async () => {
    const src = images[0].src;
    for (let i = 0; i < 19; i++) await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'src' + i + '.tif'); r(); }; im.src = src; });
    images.forEach((im, i) => { if (i >= 8) im.excluded = true; });
    render();
  });
  const held = await page.evaluate(() => images.filter(im => im.excluded).map(im => im.label));
  expect(held).toContain('I');
  await page.evaluate(() => { selectedPanel = 1; addLinkedInset(0.3, 0.3, 0.3, 0.3, 'free'); });
  const r = await page.evaluate(() => {
    const ins = images.find(im => im && im.insetOf != null);
    const labels = images.map(im => im.label);
    return { label: ins.label, unique: new Set(labels).size === labels.length };
  });
  expect(r.label).toBe('I');
  expect(r.unique).toBe(true);
  expect(errors).toEqual([]);
});

// ── fluor5-09 (Undo names what it undid) ───────────────────────────────────────────────
test('fluor5-09: Ctrl+Z after adding an inset says it undid the inset', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { selectedPanel = 1; addLinkedInset(0.3, 0.3, 0.3, 0.3); });
  await page.evaluate(() => undo());
  expect(await toastText(page)).toMatch(/^Undone: linked inset \(\d+ left\)/);
  await page.evaluate(() => redo());
  expect(await toastText(page)).toMatch(/^Redone: linked inset/);
  expect(await page.evaluate(() => images.some(im => im.insetOf != null))).toBe(true);
  expect(errors).toEqual([]);
});

// ── fluor5-10 ──────────────────────────────────────────────────────────────────────────
test('fluor5-10: after ✕ New the export format row says "not exported yet", not that the new figure changed since', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 2);
  await page.evaluate(async () => { applyPreset('elife'); render(); await _captureDownload(() => doExport('tiff')); });
  expect((await page.evaluate(() => __row('Export format'))).text).toMatch(/exported as TIFF since the figure last changed/);
  await page.evaluate(() => confirmNewFigure());
  await page.click('#cm-ok');
  await seedPanels(page, 2);
  const row = await page.evaluate(() => { applyPreset('elife'); render(); return __row('Export format'); });
  expect(row.text).toMatch(/not checked — not exported yet this session/);
  expect(row.text).not.toMatch(/changed after it was last exported/);
  expect(errors).toEqual([]);
});

// ── fluor5-11 ──────────────────────────────────────────────────────────────────────────
test('fluor5-11: Draft from figure gives a short alt text — panels that show the same thing together, no scale bars or display ranges', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 4, 4);
  const r = await page.evaluate(async () => {
    images.forEach(im => { im.umPerPx = 0.0901; im.sbOn = true; im.sbUm = 5; im.blackPt = 10; im.whitePt = 200; });
    sv('key-names', JSON.stringify({ blue: 'DAPI', green: 'GCaMP6s', magenta: 'PSD95-mCherry' }));
    render(); generateCaption();
    const cap = gv('caption-out');
    await generateAltText();
    return { cap, alt: document.getElementById('alt-text').value };
  });
  expect(r.cap).toMatch(/Scale bar, 5 µm/);                          // the caption keeps its details
  expect(r.alt.split(/\s+/).length).toBeLessThanOrEqual(250);
  expect(r.alt.length).toBeLessThan(r.cap.length / 2);
  expect(r.alt).not.toMatch(/Scale bar,|per pixel|Field of view|Display range|Display settings|Levels|0–255/i);
  expect(r.alt).toMatch(/\(A, E, I and M\) DAPI \(blue\)\./);         // one sentence for the four DAPI panels
  expect(r.alt).toMatch(/A 4×5 panel grid of 16 image panels/);
  expect(errors).toEqual([]);
});

// ── fluor5-15 ──────────────────────────────────────────────────────────────────────────
test('fluor5-15: a key placed under a tall grid runs in a row, and the standalone key matches it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 12);
  const r = await page.evaluate(async () => {
    const L = ['blue', 'green', 'magenta', 'none'];
    images.forEach((im, i) => { im.lut = L[i % 4]; if (L[i % 4] === 'none') im.chan = 'MAP2'; });
    sv('cols', 2); sv('rows', 6); onLayoutChange(); applyPreset('elife'); render();
    const b0 = gi('m-btm');
    setKeyOnFigure(true); render(); await new Promise(r => setTimeout(r, 200)); render();
    const a = annotations.find(a => a.type === 'legend'), fs = _keyFs(), Lk = _keyLayout(_figureKey(), fs, _keyFont(fs)), c = _keyCanvas(300);
    const P = panelBounds.filter(b => images[b.idx]), bottom = Math.max(...P.map(b => b.y + b.h));
    return { rows: _figureKey().length, b0, b1: gi('m-btm'), cols: Lk.cols, h: Lk.h, fs, placed: [a._w, a._h], standalone: [c._keyW, c._keyH],
      under: a.yf * canvasLogicalH >= bottom - 0.5 };
  });
  expect(r.rows).toBe(4);
  expect(r.cols).toBe(4);                                          // one line of four, not a list of four rows
  expect(r.h).toBeLessThan(r.fs * 3);
  expect(r.b1 - r.b0).toBeLessThan(r.fs * 3.5);                       // the band added is one line high
  expect(r.under).toBe(true);
  expect(r.standalone).toEqual(r.placed);                           // the file and the placed key are one layout
  expect(errors).toEqual([]);
});

// ── fluor5-03 ──────────────────────────────────────────────────────────────────────────
const tagOverFrame = () => {
  const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
  const T = figTextItems.filter(t => t.kind === 'tag');
  return _insetFrames.flatMap(f => T.filter(t => t.idx === f.parentIdx && (ov(t.bbox, f) || (f.lbox && ov(t.bbox, f.lbox)))).map(t => t.str));
};
test('fluor5-03: a merge tag steps aside from an inset outline and its letter, in the export too', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 2, 4);
  const r = await page.evaluate((fn) => {
    const f = new Function('return (' + fn + ')()');
    sv('key-names', JSON.stringify({ blue: 'DAPI', green: 'GCaMP6s', magenta: 'PSD95-mCherry' }));
    sc('tag-channels', true); sc('show-labels', true); sv('tag-pos', 'tr'); applyPreset('elife'); render();
    selectedPanel = 3; addLinkedInset(0.62, 0.02, 0.3, 0.3);       // a region in the merge's top-right corner
    render(); const screen = f(), frames = _insetFrames.filter(x => x.parentIdx === 3).length;
    const frames0 = _insetFrames.slice(); renderExportCanvas(300);
    const exp = figTextItems.filter(t => t.kind === 'tag' && t.idx === 3).map(t => t.str);
    _insetFrames = frames0; const expOver = f();                    // the export's tags against the same outlines
    scheduleRender(0);
    return { frames, screen, exp, expOver, row: __row('Text over text') };
  }, tagOverFrame.toString());
  expect(r.frames).toBe(1);
  expect(r.screen).toEqual([]);                                     // nothing of the tag on the outline
  expect(r.exp.length).toBeGreaterThan(0);                          // the export draws the tag as well
  expect(r.expOver).toEqual([]);
  expect(r.row && r.row.text).not.toMatch(/outline of inset/);
  expect(errors).toEqual([]);
});

test('fluor5-03: a tag that cannot step aside from a wide outline is reported under Text over text', async ({ page }) => {
  const errors = await loadApp(page);
  await channelGrid(page, 2, 4);
  const r = await page.evaluate(() => {
    sv('key-names', JSON.stringify({ blue: 'DAPI', green: 'GCaMP6s', magenta: 'PSD95-mCherry' }));
    sc('tag-channels', true); sc('show-labels', true); sv('tag-pos', 'tr'); applyPreset('elife'); render();
    selectedPanel = 3; addLinkedInset(0.04, 0.02, 0.92, 0.3);       // a band across the merge's whole top
    render();
    return { row: __row('Text over text') };
  });
  expect(r.row && r.row.icon).toBe('⚠');
  expect(r.row.text).toMatch(/the outline of inset [A-Z]/);
  expect(r.row.fixes).toContain('Move tags to the other edge');
  expect(errors).toEqual([]);
});
