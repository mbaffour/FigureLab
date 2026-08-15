// @ts-check
// Linked insets and per-panel processing history.
//
// The inset test that matters is propagation: a hand-made inset is a copy that diverges
// the moment the parent is adjusted, and a figure then shows two different processings
// of one field with nothing to say so. A linked inset re-derives from the parent every
// render, and the binding is by panel id so reordering cannot break it.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

// ── Linked insets ─────────────────────────────────────────────

test('an inset crops a region of the parent and records its magnification', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    selectedPanel = 0;
    addLinkedInset(0.25, 0.25, 0.25, 0.25);      // middle quarter → 4× magnification
    const ins = images.find(im => im && im.insetOf);
    return { n: images.filter(Boolean).length,
             boundTo: ins.insetOf === images[0].id,
             crop: [ins.cropL, ins.cropT, ins.cropR, ins.cropB],
             mag: _insetMag(ins) };
  });
  expect(r.n).toBe(2);
  expect(r.boundTo).toBe(true);
  expect(r.crop).toEqual([25, 25, 50, 50]);      // 25%..50% of an uncropped parent
  expect(r.mag).toBe(4);
  expect(errors).toEqual([]);
});

test('the inset region is a fraction of what the parent actually shows', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    // Parent already cropped to its middle half: an inset drawn on the visible field
    // must land inside that field, not inside the original uncropped image.
    Object.assign(images[0], { cropL: 25, cropR: 25, cropT: 25, cropB: 25 });
    selectedPanel = 0;
    addLinkedInset(0, 0, 0.5, 0.5);              // top-left quarter OF THE VISIBLE crop
    const ins = images.find(im => im && im.insetOf);
    return [ins.cropL, ins.cropT, ins.cropR, ins.cropB];
  });
  // visible field is 25..75; its top-left quarter is 25..50
  expect(r).toEqual([25, 25, 50, 50]);
  expect(errors).toEqual([]);
});

test('adjusting the parent propagates to the inset on the next render', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    selectedPanel = 0;
    addLinkedInset(0.3, 0.3, 0.3, 0.3);
    const ins = images.find(im => im && im.insetOf);
    const before = { b: ins.brightness, lut: ins.lut };
    // The failure a hand-made inset has: parent changes, copy silently does not.
    Object.assign(images[0], { brightness: 1.8, gamma: 0.7, lut: 'fire', invert: true });
    render();
    const after = images.find(im => im && im.insetOf);
    return { before, b: after.brightness, g: after.gamma, lut: after.lut, inv: after.invert };
  });
  expect(r.b).toBe(1.8);
  expect(r.g).toBe(0.7);
  expect(r.lut).toBe('fire');
  expect(r.inv).toBe(true);
  expect(errors).toEqual([]);
});

test('the parent’s own crop moving carries the inset with it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    selectedPanel = 0;
    addLinkedInset(0, 0, 0.5, 0.5);
    const first = { ...images.find(im => im && im.insetOf) };
    images[0].cropL = 40;                        // parent re-cropped afterwards
    render();
    const after = images.find(im => im && im.insetOf);
    return { beforeL: first.cropL, afterL: after.cropL };
  });
  expect(r.beforeL).toBe(0);
  expect(r.afterL).toBe(40);                     // the inset followed
  expect(errors).toEqual([]);
});

test('the binding is by id, so reordering panels cannot break it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    selectedPanel = 0;
    const parentId = images[0].id;
    addLinkedInset(0.2, 0.2, 0.4, 0.4);
    images.reverse();                            // the classic index-invalidating move
    render();
    const ins = images.find(im => im && im.insetOf);
    return { stillBound: ins.insetOf === parentId, orphaned: !!ins.insetOrphaned,
             parentStillFound: !!_findPanelById(ins.insetOf) };
  });
  expect(r).toEqual({ stillBound: true, orphaned: false, parentStillFound: true });
  expect(errors).toEqual([]);
});

test('deleting the parent marks the inset orphaned and the audit says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    selectedPanel = 0;
    addLinkedInset(0.2, 0.2, 0.4, 0.4);
    const parentId = images[0].id;
    images = images.filter(im => !im || im.id !== parentId);   // parent removed
    render();
    const ins = images.find(im => im && im.insetOf);
    checkCompliance();
    const m = document.getElementById('info-modal-bg');
    const t = m ? m.textContent : ''; if (m) m.remove();
    return { orphaned: !!ins.insetOrphaned, audit: t };
  });
  expect(r.orphaned).toBe(true);
  expect(r.audit).toMatch(/lost their parent panel/);
  expect(errors).toEqual([]);
});

test('the metadata CSV names the parent and the magnification', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const url = await page.evaluate(() => {
    images[0].label = 'A';
    selectedPanel = 0;
    addLinkedInset(0.25, 0.25, 0.25, 0.25);
    let csv = null;
    const realDl = window.dl; window.dl = (u) => { csv = u; };
    try { exportCSV(); } finally { window.dl = realDl; }
    return csv;
  });
  const text = await page.evaluate(u => fetch(u).then(x => x.text()), url);
  const rows = text.trim().split('\n');
  expect(rows[0]).toContain('InsetOf');
  expect(rows[0]).toContain('Magnification');
  expect(rows[2]).toContain(',A,');        // the inset row names its parent
  expect(rows[2]).toContain('4×');
  expect(errors).toEqual([]);
});

// ── Processing history ────────────────────────────────────────

test('the history records the operations actually applied, in order', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    Object.assign(images[0], { label: 'A', cropL: 10, cropT: 5, cropAngle: 12,
      brightness: 1.4, gamma: 0.8, lut: 'fire', umPerPx: 0.32, sbUm: 20,
      bgKey: { on: true, mode: 'white', tol: 32, feather: 0 } });
    const h = _panelHistory(images[0]);
    return { ops: h.operations.map(o => o.op), h };
  });
  expect(r.ops).toEqual(['import', 'crop', 'adjust', 'lut', 'backgroundKey', 'calibrate']);
  const crop = r.h.operations.find(o => o.op === 'crop');
  // A tilted crop is the one that changes pixel values, and the record says so
  expect(crop.angleDeg).toBe(12);
  expect(crop.resampling).toMatch(/bilinear/);
  const adj = r.h.operations.find(o => o.op === 'adjust');
  expect(adj.note).toMatch(/source pixels unchanged/);
  expect(errors).toEqual([]);
});

test('an untouched panel records only its import', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => _panelHistory(images[0]).operations.map(o => o.op));
  expect(r).toEqual(['import']);
  expect(errors).toEqual([]);
});

test('the history text is honest about being unsigned', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => _panelHistoryText());
  expect(r).toMatch(/PER-PANEL PROCESSING HISTORY/);
  expect(r).toMatch(/no cryptographic/i);
  expect(r).toMatch(/author’s account rather than as proof/);
  expect(errors).toEqual([]);
});

test('both history files land in the submission package', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const names = await page.evaluate(async () => {
    const got = [];
    const realZip = window._zipMake || window.zipMake;
    const grab = (files) => { files.forEach(f => got.push(f.name)); return new Uint8Array([1]); };
    if (window._zipMake) window._zipMake = grab; else window.zipMake = grab;
    window.dl = () => {};
    await exportSubmissionPackage();
    await new Promise(r => setTimeout(r, 800));
    if (window._zipMake) window._zipMake = realZip; else window.zipMake = realZip;
    return got;
  });
  expect(names).toContain('PANEL_HISTORY.txt');
  expect(names).toContain('PANEL_HISTORY.json');
  expect(errors).toEqual([]);
});

test('the JSON history declares itself unsigned and carries every panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => JSON.parse(JSON.stringify({
    app: 'FigureLab', version: APP_VERSION, signed: false,
    panels: images.filter(Boolean).map(_panelHistory) })));
  expect(r.signed).toBe(false);
  expect(r.panels.length).toBe(3);
  expect(r.panels[0].operations[0].op).toBe('import');
  expect(errors).toEqual([]);
});
