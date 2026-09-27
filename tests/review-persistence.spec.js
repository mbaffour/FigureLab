// @ts-check
// What a figure carries across its boundaries: the session file, the share link, a
// template, and New figure. "Rows hug their panels" was saved only in the undo
// snapshot, and the heading store outlived the figure it belonged to.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, APP_URL } = require('./helpers');

// save() below is a saved file as the loader would see it. serializeSession(false)
// leaves the pixel data out, which applySession treats as legacy images to re-drop —
// so the images entry is removed and the seeded panels stay in place.

test('Rows hug their panels survives a saved session, with the same row heights', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const save = () => { const s = JSON.parse(JSON.stringify(serializeSession(false))); delete s.images; return s; };
    // Tall narrow cells around square blots, so hugging really shrinks the rows.
    sv('cols', 1); sv('rows', 2); sv('panel-w', 100); sv('panel-h', 300); onLayoutChange();
    sc('auto-row-h', false); const uniformH = gridGeom().gridH;
    sc('auto-row-h', true);  const huggedH = gridGeom().gridH;
    const s = save();
    sc('auto-row-h', false);                       // clobber, then load the file
    applySession(s);
    return { saved: s.layout.autoRowH, ticked: gc('auto-row-h'), uniformH, huggedH, afterH: gridGeom().gridH };
  });
  // Without the fix the file has no autoRowH (undefined, not true) and applySession
  // leaves the box unticked, so the reloaded grid is the uniform height again.
  expect(r.huggedH).toBeLessThan(r.uniformH);      // the setting changes this figure
  expect(r.saved).toBe(true);
  expect(r.ticked).toBe(true);
  expect(r.afterH).toBe(r.huggedH);
  expect(errors).toEqual([]);
});

test('a session saved before rows could hug reloads with uniform rows', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const ticked = await page.evaluate(() => {
    const save = () => { const s = JSON.parse(JSON.stringify(serializeSession(false))); delete s.images; return s; };
    sc('auto-row-h', true);
    const s = save();
    delete s.layout.autoRowH;                      // the shape of an older file
    applySession(s);
    return gc('auto-row-h');
  });
  // Without the fix applySession never touches the box, so it stays ticked and the
  // old figure reopens with a layout it was never drawn with.
  expect(ticked).toBe(false);
  expect(errors).toEqual([]);
});

test('a share link carries Rows hug their panels and the headings, and opening it restores both', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 1);
    sc('show-col-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['pH 5', 'pH 7'][i]; });
    sc('auto-row-h', true);
    let href = null;
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    const realWrite = navigator.clipboard.writeText;
    try {
      navigator.clipboard.writeText = async (t) => { href = t; };
      shareSession();
      await new Promise(r => setTimeout(r, 60));
    } finally { if (realWrite) navigator.clipboard.writeText = realWrite; }
    if (!href || href.indexOf('#share=') < 0) return { unreadable: true, link: String(href).slice(0, 60) };
    const hash = href.slice(href.indexOf('#share='));
    // shareSession encodes with btoa(encodeURIComponent(json)).
    const payload = JSON.parse(decodeURIComponent(atob(hash.slice(7))));
    return { hash, autoRowH: payload.layout.autoRowH, colLabels: payload.layout.colLabels };
  });
  expect(r.unreadable, `share payload unreadable: ${r.link || ''}`).toBeUndefined();
  // Without the fix the payload has no autoRowH at all.
  expect(r.autoRowH).toBe(true);
  expect(r.colLabels).toEqual(['pH 5', 'pH 7']);

  // Open the link in a fresh page, as the recipient does. about:blank first, because a
  // goto that only changes the hash is a same-document navigation and loads nothing.
  await page.goto('about:blank');
  await page.goto(APP_URL + r.hash);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  const opened = await page.evaluate(() => ({
    // the loader stores these for the recipient's images just before it restores the headings
    loaderRan: Array.isArray(window._sharedPanelSettings),
    ticked: gc('auto-row-h'),
    heads: [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value),
  }));
  expect(opened.loaderRan).toBe(true);
  // A fresh page starts unticked (#auto-row-h has no `checked`), so without the fix
  // the loader, which restores the layout itself rather than through applySession,
  // leaves it unticked.
  expect(opened.ticked).toBe(true);
  expect(opened.heads).toEqual(['pH 5', 'pH 7']);
  expect(errors).toEqual([]);
});

test('a template carries Rows hug their panels, and an older template loads uniform', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sc('auto-row-h', true);
    document.getElementById('tpl-name-input').value = 'review-hug';
    saveTemplate();
    const t = getSavedTemplates().find(x => x.name === 'review-hug');
    sc('auto-row-h', false); loadTemplate(t);
    const afterLoad = gc('auto-row-h');
    const old = { ...t }; delete old.autoRowH;
    sc('auto-row-h', true); loadTemplate(old);
    return { saved: t.autoRowH, afterLoad, afterOld: gc('auto-row-h') };
  });
  // Without the fix the template has no autoRowH and loadTemplate never touches the
  // box: afterLoad stays false and afterOld stays true.
  expect(r.saved).toBe(true);
  expect(r.afterLoad).toBe(true);
  expect(r.afterOld).toBe(false);
  expect(errors).toEqual([]);
});

test('a saved session round-trips headings hidden at save time, and replaces the old figure’s', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    const save = () => { const s = JSON.parse(JSON.stringify(serializeSession(false))); delete s.images; return s; };
    sv('cols', 2); sv('rows', 2);
    sc('show-col-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['pH 5', 'pH 7'][i]; });
    sc('show-col-labels', false); onLayoutChange();          // hidden — no inputs exist
    const s = save();                                    // the real file path, not the undo snapshot
    setAxisLabels('col', ['x', 'y', 'z']);                   // clobber with a LONGER set, then load
    applySession(s);
    sc('show-col-labels', true); sv('cols', 3); onLayoutChange();
    return {
      saved: s.layout.colLabels,
      restored: [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value),
    };
  });
  expect(r.saved).toEqual(['pH 5', 'pH 7']);
  // Without the fix the load merges into the store, so the third column reads the
  // clobber's 'z' instead of its default.
  expect(r.restored).toEqual(['pH 5', 'pH 7', 'Col 3']);
  expect(errors).toEqual([]);
});

test('loading a figure with fewer headings, then growing it, shows none of the previous figure’s', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    const save = () => { const s = JSON.parse(JSON.stringify(serializeSession(false))); delete s.images; return s; };
    // Figure A: four headed columns, still on screen when B is loaded.
    sv('cols', 4); sv('rows', 1);
    sc('show-col-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['0 h', '6 h', '24 h', '48 h'][i]; });
    const heads = () => [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value);

    // Figure B: two columns, two headings.
    const b = save(); b.layout.cols = 2; b.layout.colLabels = ['pH 5', 'pH 7'];
    applySession(b);
    const loadedB = heads();
    sv('cols', 4); onLayoutChange();
    const grownB = heads();
    const savedB = serializeSession(false).layout.colLabels;

    // Figure C: an older file with no heading arrays and the headings off.
    sc('show-col-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['0 h', '6 h', '24 h', '48 h'][i]; });
    const c = save(); delete c.layout.colLabels; delete c.layout.rowLabels; c.layout.showColLabels = false;
    applySession(c);
    const storeC = axisLabelValues('col');
    sc('show-col-labels', true); onLayoutChange();
    return { loadedB, grownB, savedB, storeC, shownC: heads() };
  });
  expect(r.loadedB).toEqual(['pH 5', 'pH 7']);
  // Without the fix onLayoutChange harvests A's four fields into the store before
  // B's two headings are written over the first two, so columns 3 and 4 come back
  // as A's '24 h' and '48 h' — and save into B's file.
  expect(r.grownB).toEqual(['pH 5', 'pH 7', 'Col 3', 'Col 4']);
  expect(r.savedB).toEqual(['pH 5', 'pH 7', 'Col 3', 'Col 4']);
  // Without the fix setAxisLabels(undefined) is a no-op, so C inherits all of A's.
  expect(r.storeC).toEqual([]);
  expect(r.shownC).toEqual(['Col 1', 'Col 2', 'Col 3', 'Col 4']);
  expect(errors).toEqual([]);
});

test('New figure starts with no headings from the old one', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    sv('cols', 3); sv('rows', 1);
    sc('show-col-labels', true); sc('show-row-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['0 h', '6 h', '24 h'][i]; });
    document.querySelector('#row-label-inputs input').value = 'WT';
    confirmNewFigure();
    document.getElementById('cm-ok').click();
    return {
      images: images.length,
      col: [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value),
      row: [...document.querySelectorAll('#row-label-inputs input')].map(i => i.value),
      store: axisLabelValues('col'),
    };
  });
  expect(r.images).toBe(0);                        // the modal's OK really ran
  // Without the fix New figure never touches the heading fields or the store, so
  // the blank figure's fields still read the old figure's headings.
  expect(r.col).toEqual(['Col 1', 'Col 2', 'Col 3']);
  expect(r.row).toEqual(['Row 1']);
  expect(r.store).toEqual(['Col 1', 'Col 2', 'Col 3']);
  expect(errors).toEqual([]);
});
