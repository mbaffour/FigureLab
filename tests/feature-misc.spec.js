// @ts-check
// Repeat a panel annotation on other panels; a share link that keeps per-gutter
// spacing; a provenance record that knows the rows hug their panels; and an undo that
// does not leave a loaded figure's extra headings behind.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, APP_URL } = require('./helpers');

// A plain image of a given size, committed through the real import path.
const MK = `window.__mk = (w, h, name) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#333'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#fff'; x.fillRect(w * 0.2, h * 0.2, w * 0.1, h * 0.1);
  const src = c.toDataURL('image/png');
  const img = new Image(); img.onload = () => { _commitImage(img, src, name); res(); }; img.src = src;
});`;

const ARROW = { type: 'arrow', xf: 0.3, yf: 0.4, x2f: 0.5, y2f: 0.6, color: '#ffff00', width: 2 };

// ── Repeat a panel annotation ───────────────────────────────────────────────

test('an arrow repeats on the rest of its row, and one undo takes every copy back', async ({ page }) => {
  // Without the feature repeatPanelAnn does not exist and the evaluate throws.
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate((arrow) => {
    sv('cols', 3); sv('rows', 1); sv('panel-w', 200); sv('panel-h', 200); onLayoutChange(); render();
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    const before = undoStack.length;
    repeatPanelAnn('row');
    const steps = undoStack.length - before;
    const copies = [1, 2].map(i => images[i].panelAnns.map(a => ({ ...a })));
    const toastText = document.getElementById('toast').textContent;
    undo();
    return { steps, copies, toastText, afterUndo: [images[1].panelAnns.length, images[2].panelAnns.length], src: images[0].panelAnns.length };
  }, ARROW);
  expect(r.steps).toBe(1);
  for (const list of r.copies) {
    expect(list.length).toBe(1);
    // identical 100x100 panels in identical cells: the mapped fractions are the source's
    expect(list[0].type).toBe('arrow');
    expect(list[0].xf).toBeCloseTo(0.3, 4); expect(list[0].yf).toBeCloseTo(0.4, 4);
    expect(list[0].x2f).toBeCloseTo(0.5, 4); expect(list[0].y2f).toBeCloseTo(0.6, 4);
    expect(list[0].color).toBe('#ffff00');
  }
  expect(r.toastText).toBe('arrow repeated on 2 panels');
  expect(r.afterUndo).toEqual([0, 0]);
  expect(r.src).toBe(1);
  expect(errors).toEqual([]);
});

test('pressing Repeat twice does not stack a second copy or a second undo step', async ({ page }) => {
  // Without the feature the function is undefined; without the near-duplicate check
  // each target would hold two arrows and the second press would push another step.
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate((arrow) => {
    sv('cols', 3); sv('rows', 1); onLayoutChange(); render();
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    repeatPanelAnn('row');
    const mid = undoStack.length;
    repeatPanelAnn('row');
    return { counts: [images[1].panelAnns.length, images[2].panelAnns.length], extraSteps: undoStack.length - mid };
  }, ARROW);
  expect(r.counts).toEqual([1, 1]);
  expect(r.extraSteps).toBe(0);
  expect(errors).toEqual([]);
});

test('Repeat on… this row, picked from the floating toolbar, stays in the row', async ({ page }) => {
  // Without the feature there is no #ann-float-repeat select, so `sel` is null.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate((arrow) => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    showPanelAnnFloat(0, 0, panelBounds.find(b => b.idx === 0));
    const sel = document.getElementById('ann-float-repeat');
    if (!sel) return { missing: true };
    const shown = getComputedStyle(sel).display;
    sel.value = 'row'; sel.dispatchEvent(new Event('change'));
    return { shown, reset: sel.value, title: sel.title, counts: [1, 2, 3].map(i => images[i].panelAnns.length) };
  }, ARROW);
  expect(r.missing).toBeUndefined();
  expect(r.shown).not.toBe('none');
  expect(r.title.length).toBeGreaterThan(10);
  expect(r.reset).toBe('');                       // ready for the next pick
  expect(r.counts).toEqual([1, 0, 0]);            // panel 1 shares row 0; 2 and 3 are row 1
  expect(errors).toEqual([]);
});

test('a panel with a different crop gets the same place in the panel, and the toast says so', async ({ page }) => {
  // The fraction branch: panel 2 is cropped, so it shares no pixels with the source and
  // its copy keeps xf = 0.3 exactly. Mapping it through the drawn picture instead would
  // give ~0.35 (asserted below, so the two branches really disagree here). Without the
  // feature the function is undefined.
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate((arrow) => {
    sv('cols', 3); sv('rows', 1); sv('panel-w', 200); sv('panel-h', 200); onLayoutChange();
    images[2].cropL = 25; render();
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    const b = panelBounds.find(p => p.idx === 2), s = panelBounds.find(p => p.idx === 0);
    const u = (s.x + arrow.xf * s.w - s.ix) / s.iw;
    const wouldMap = (b.ix + u * b.iw - b.x) / b.w;
    repeatPanelAnn('all');
    return { wouldMap, toastText: document.getElementById('toast').textContent,
      cropped: images[2].panelAnns.map(a => ({ ...a })), same: images[1].panelAnns.map(a => ({ ...a })) };
  }, ARROW);
  expect(Math.abs(r.wouldMap - 0.3)).toBeGreaterThan(0.02);
  expect(r.cropped.length).toBe(1);
  expect(r.cropped[0].xf).toBe(0.3); expect(r.cropped[0].yf).toBe(0.4);
  expect(r.cropped[0].x2f).toBe(0.5); expect(r.cropped[0].y2f).toBe(0.6);
  expect(r.same.length).toBe(1);
  expect(r.toastText).toMatch(/^arrow repeated on 2 panels — 1 has a different crop or source size/);
  expect(errors).toEqual([]);
});

test('when rows hug their panels, the copy lands on the same source pixels in a shorter cell', async ({ page }) => {
  // The picture branch. Two identical 400x100 images, A in row 0 (held 200 tall by a
  // 100x400 panel beside it) and B in row 1 (hugged to 50). A's picture sits 75 px down
  // its cell, B's fills its cell, so the cell fractions must change for the arrow to
  // stay on the same pixels. yf 0.4 / 0.6 are off-centre on purpose: at 0.5 both
  // branches agree. Without the feature the function is undefined; with fractions
  // copied unchanged, B's arrow would point 60 px (source) away.
  const errors = await loadApp(page);
  const r = await page.evaluate(async ({ code, arrow }) => {
    eval(code);
    await window.__mk(400, 100, 'A.png');
    await window.__mk(100, 400, 'tall.png');
    await window.__mk(400, 100, 'B.png');
    sv('cols', 2); sv('rows', 2); sv('panel-w', 200); sv('panel-h', 200); sv('gap-v', 4);
    onLayoutChange(); sc('auto-row-h', true); render();
    images[0].group = 'wt'; images[2].group = 'wt';
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    repeatPanelAnn('group');
    const pix = (idx, a) => {
      const b = panelBounds.find(p => p.idx === idx), im = images[idx];
      const at = (xf, yf) => [((b.x + xf * b.w) - b.ix) / b.iw * im.img.naturalWidth,
                              ((b.y + yf * b.h) - b.iy) / b.ih * im.img.naturalHeight];
      return { p1: at(a.xf, a.yf), p2: at(a.x2f, a.y2f), h: b.h };
    };
    return { A: pix(0, images[0].panelAnns[0]), B: images[2].panelAnns[0] ? pix(2, images[2].panelAnns[0]) : null,
      Byf: images[2].panelAnns[0] && images[2].panelAnns[0].yf, tallCopies: images[1].panelAnns.length };
  }, { code: MK, arrow: ARROW });
  expect(r.A.h).toBeGreaterThan(r.B.h);           // the cells really differ
  expect(Math.abs(r.Byf - 0.4)).toBeGreaterThan(0.05);
  for (const k of ['p1', 'p2']) for (const d of [0, 1]) expect(Math.abs(r.A[k][d] - r.B[k][d])).toBeLessThan(0.5);
  expect(r.tallCopies).toBe(0);                   // not in the match group
  expect(errors).toEqual([]);
});

test('deleting a panel annotation can be undone', async ({ page }) => {
  // Without the fix the panel branch of the Del button spliced with no pushUndo, so
  // the undo stack does not grow and the annotation cannot be brought back.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate((arrow) => {
    render();
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    showPanelAnnFloat(0, 0, panelBounds.find(b => b.idx === 0));
    const before = undoStack.length;
    document.getElementById('ann-float-del').click();
    const steps = undoStack.length - before, gone = images[0].panelAnns.length;
    if (steps > 0) undo();
    return { steps, gone, back: images[0] ? images[0].panelAnns.length : -1 };
  }, ARROW);
  expect(r.gone).toBe(0);
  expect(r.steps).toBe(1);
  expect(r.back).toBe(1);
  expect(errors).toEqual([]);
});

test('Repeat on… is hidden for a figure-level annotation', async ({ page }) => {
  // Figure annotations are figure fractions with no panel to repeat from. Without the
  // feature the select does not exist, so both displays read null.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate((arrow) => {
    render();
    images[0].panelAnns.push({ ...arrow }); selectedPanelAnn = { imgIdx: 0, annIdx: 0 };
    showPanelAnnFloat(0, 0, panelBounds.find(b => b.idx === 0));
    const sel = () => document.getElementById('ann-float-repeat');
    const onPanel = sel() ? getComputedStyle(sel()).display : null;
    selectedPanelAnn = null;
    annotations.push({ type: 'arrow', xf: 0.1, yf: 0.1, x2f: 0.2, y2f: 0.2, color: '#fff', width: 2 });
    showAnnFloat(annotations.length - 1);
    return { onPanel, onFigure: sel() ? getComputedStyle(sel()).display : null };
  }, ARROW);
  expect(r.onPanel).not.toBeNull();
  expect(r.onPanel).not.toBe('none');
  expect(r.onFigure).toBe('none');
  expect(errors).toEqual([]);
});

// ── Share link keeps per-gutter spacing ─────────────────────────────────────

test('opening a share link restores per-gutter spacing', async ({ page }) => {
  // shareSession wrote colGaps/rowGaps/advancedSpacing but the loader never read them.
  // A fresh page starts with colGaps null and per-gutter spacing off, so without the
  // fix every assertion on the opened page fails.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 2); sv('gap-h', 8); sv('gap-v', 8); onLayoutChange();
    document.getElementById('advanced-spacing').checked = true; setAdvancedSpacing(true);
    setGutter('col', 1, 30); setGutter('row', 1, 17); render();
    let href = null;
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    const realWrite = navigator.clipboard.writeText;
    try {
      navigator.clipboard.writeText = async (t) => { href = t; };
      shareSession();
      await new Promise(res => setTimeout(res, 60));
    } finally { if (realWrite) navigator.clipboard.writeText = realWrite; }
    if (!href || href.indexOf('#share=') < 0) return { unreadable: true };
    return { hash: href.slice(href.indexOf('#share=')), sharedW: gridGeom().gridW };
  });
  expect(r.unreadable).toBeUndefined();

  // about:blank first: a goto that only changes the hash loads nothing.
  await page.goto('about:blank');
  await page.goto(APP_URL + r.hash);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  const opened = await page.evaluate(() => ({
    loaderRan: Array.isArray(window._sharedPanelSettings),
    colGaps, rowGaps, advancedSpacing,
    checked: document.getElementById('advanced-spacing').checked,
    col: gapBefore(1, gi('gap-h')), row: rGapBefore(1, gi('gap-v')),
    gridW: gridGeom().gridW,
  }));
  expect(opened.loaderRan).toBe(true);
  expect(opened.colGaps).toEqual([30]);
  expect(opened.rowGaps).toEqual([17]);
  expect(opened.advancedSpacing).toBe(true);
  expect(opened.checked).toBe(true);
  expect(opened.col).toBe(30);                    // the geometry uses it, not just the variable
  expect(opened.row).toBe(17);
  expect(opened.gridW).toBe(r.sharedW);
  expect(errors).toEqual([]);
});

// ── Provenance knows the rows hug their panels ─────────────────────────────

test('the provenance hash and the PNG settings record Rows hug their panels and the row heights', async ({ page }) => {
  // Without the fix the hash covers panel-h but not auto-row-h, so both hashes are equal,
  // and FigureLab-Settings has no autoRowH or rowH at all.
  const errors = await loadApp(page);
  const r = await page.evaluate(async (code) => {
    eval(code);
    await window.__mk(600, 180, 'target.png');
    await window.__mk(600, 90, 'loading.png');
    sv('cols', 1); sv('rows', 2); sv('panel-w', 300); sv('panel-h', 300); onLayoutChange();
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const settings = async () => {
      let meta = null;
      const realEmbed = window.embedPNGMetadata, realDl = window.dl;
      window.embedPNGMetadata = async (url, m) => { meta = m; return url; };
      window.dl = () => {};
      try { await exportPNGWithMeta('t', 300, c); }
      finally { window.embedPNGMetadata = realEmbed; window.dl = realDl; }
      return { set: JSON.parse(meta['FigureLab-Settings']), hash: meta['Provenance-SHA256'] };
    };
    sc('auto-row-h', false); render();
    const offHash = await _provenanceHash(), off = await settings();
    sc('auto-row-h', true); render();
    const onHash = await _provenanceHash(), on = await settings();
    return { offHash, onHash, off, on };
  }, MK);
  expect(r.offHash).toMatch(/^[0-9a-f]{64}$/);   // '' would mean the digest failed, not a match
  expect(r.onHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.onHash).not.toBe(r.offHash);
  expect(r.on.hash).toBe(r.onHash);
  expect(r.off.set.autoRowH).toBe(false);
  expect(r.off.set.rowH).toBe('300,300');
  expect(r.on.set.autoRowH).toBe(true);
  expect(r.on.set.rowH).toBe('90,45');            // 600x180 and 600x90 at 300 wide
  expect(errors).toEqual([]);
});

// ── Undo restores the headings exactly ─────────────────────────────────────

test('undo after loading a figure with more headings leaves none of them behind', async ({ page }) => {
  // applyLayoutSnapshot rebuilt the fields (harvesting the loaded figure's four
  // headings into the store) and then wrote only the snapshot's two, so 'y' and 'z'
  // survived the undo: axisLabelValues had four entries and growing the grid back to
  // four columns showed them again.
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 1); sc('show-col-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['a', 'b'][i]; });
    const file = JSON.parse(JSON.stringify(serializeSession(false))); delete file.images;
    file.layout.cols = 4; file.layout.showColLabels = true; file.layout.colLabels = ['w', 'x', 'y', 'z'];
    pushUndo();                                    // applySession pushes none itself
    applySession(file, { silent: true });
    const loaded = axisLabelValues('col');
    undo();
    const afterUndo = axisLabelValues('col');
    sv('cols', 4); onLayoutChange();
    const regrown = [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value);
    return { loaded, afterUndo, regrown };
  });
  expect(r.loaded).toEqual(['w', 'x', 'y', 'z']);
  expect(r.afterUndo).toEqual(['a', 'b']);
  expect(r.regrown).toEqual(['a', 'b', 'Col 3', 'Col 4']);
  expect(errors).toEqual([]);
});
