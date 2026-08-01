// @ts-check
// Information-architecture tests. These guard the reorganisation itself: that every
// tool has one findable home, that nothing is hidden from a default user, and — most
// importantly for a re-parenting change — that no control got orphaned in the move.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');
const fs = require('fs'), path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'figure_lab.html'), 'utf8');

test('no orphaned ids — everything the script reaches for exists in the markup', async ({ page }) => {
  await loadApp(page);
  // Collect the literal ids the script looks up, then ask the live DOM for each.
  const wanted = [...new Set(
    [...APP.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)].map(m => m[1])
  )];
  expect(wanted.length).toBeGreaterThan(100);      // sanity: we really scanned the file
  const missing = await page.evaluate(ids => ids.filter(id => !document.getElementById(id)), wanted);
  // These ids belong to elements built at runtime (before/after slider, guided tour,
  // panel context menu, confirm dialog, compare modal, generic info modal), so they are
  // legitimately absent at load. Snapshotting them as a baseline — rather than trying to
  // enumerate them by hand — means this test's real job is catching anything NEW that
  // goes missing, which is exactly the failure a re-parenting change can introduce.
  const runtimeBuilt = new Set([
    'info-modal-bg', 'im-title', 'im-body',
    'ba-modal-bg', 'ba-canvas', 'ba-handle', 'ba-slider',
    'confirm-modal-bg', 'cm-ok', 'cm-cancel', 'cm-msg', 'cm-title', 'cm-body',
    'compare-modal', 'cmp-left', 'cmp-right', 'cmp-zoom', 'cmp-zoom-v',
    'cmp-diff', 'cmp-canvas-l', 'cmp-canvas-r', 'cmp-pixel-info',
    'tour-ov', 'panel-ctx-menu',
  ]);
  const real = missing.filter(id => !runtimeBuilt.has(id));
  expect(real, `ids the script looks up but the markup no longer has: ${real.join(', ')}`).toEqual([]);
});

test('the crop tools live in one section, reachable without Advanced mode', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => {
    applyUiMode('simple');
    const acc = document.getElementById('crop-acc');
    acc.open = true;
    const txt = acc.innerText;
    return {
      heading: acc.querySelector('summary').innerText.trim(),
      hasCropPanel: /Crop a panel/i.test(txt),
      hasMulti: /Multi-crop into panels/i.test(txt),
      hasBatch: /Batch crop all images/i.test(txt),
      hasReset: /Reset all crops/i.test(txt),
      hasPhysical: /same physical area/i.test(txt),
      hasPixel: /same pixel size/i.test(txt),
      hasImportPref: /Crop images as I import/i.test(txt),
      // and none of it is inside an advanced-gated wrapper
      anyAdv: !!acc.querySelector('.adv'),
    };
  });
  expect(r.heading).toMatch(/crop/i);
  expect(r.hasCropPanel).toBe(true);
  expect(r.hasMulti).toBe(true);
  expect(r.hasBatch).toBe(true);
  expect(r.hasReset).toBe(true);
  expect(r.hasPhysical).toBe(true);
  expect(r.hasPixel).toBe(true);
  expect(r.hasImportPref).toBe(true);
  expect(r.anyAdv).toBe(false);
});

test('searching the palette for "crop" surfaces every crop tool, not one', async ({ page }) => {
  await loadApp(page);
  const n = await page.evaluate(() => CMD_REGISTRY.filter(c =>
    /crop/i.test(c.label + ' ' + (c.keys || ''))).length);
  // was 1 of 12 before the consolidation
  expect(n).toBeGreaterThanOrEqual(8);
});

test('multi-crop has exactly one name across the whole UI', async ({ page }) => {
  await loadApp(page);
  // The sidebar said "Multi-Crop → Panels" and the gear drawer said
  // "Multi-crop into panels…" for the same feature.
  expect(APP).not.toContain('Multi-Crop → Panels');
  const n = (APP.match(/Multi-crop into panels/g) || []).length;
  expect(n).toBeGreaterThanOrEqual(2);   // section + gear drawer, same wording
});

test('importing an image no longer forces the pre-crop dialog', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 60;
    const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, 80, 60);
    const src = c.toDataURL('image/png');
    const img = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    _preCropQueue.push({ img, src, name: 'a.png' });
    _drainPreCrop();
    return {
      modalOpen: document.getElementById('crop-modal').classList.contains('open'),
      panels: images.filter(Boolean).length,
      pref: preCropOnImport(),
    };
  });
  expect(r.pref).toBe(false);          // opt-in, and off by default
  expect(r.modalOpen).toBe(false);     // no forced dialog
  expect(r.panels).toBe(1);            // the image went straight into the figure
});

test('turning the import preference on restores the crop-first flow', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    setPreCropOnImport(true);
    const c = document.createElement('canvas'); c.width = 80; c.height = 60;
    c.getContext('2d').fillRect(0, 0, 80, 60);
    const src = c.toDataURL('image/png');
    const img = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    _preCropQueue.push({ img, src, name: 'a.png' });
    _drainPreCrop();
    const open = document.getElementById('crop-modal').classList.contains('open');
    skipPreCrop();
    setPreCropOnImport(false);
    return { open, panels: images.filter(Boolean).length };
  });
  expect(r.open).toBe(true);
  expect(r.panels).toBe(1);
});

test('multi-crop works in freeform: regions become placed objects', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async () => {
    setLayoutMode('freeform');
    const c = document.createElement('canvas'); c.width = 200; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#123'; x.fillRect(0, 0, 200, 200);
    x.fillStyle = '#eb4'; x.fillRect(20, 20, 60, 60);
    const src = c.toDataURL('image/png');
    await new Promise(ok => { const i = new Image(); i.onload = ok; i.src = src; });
    addFreeformElement({ type: 'image', src, x: 30, y: 30, w: 200, h: 200, label: 'src',
      cropT: 0, cropL: 0, cropB: 0, cropR: 0, brightness: 1, contrast: 1 });
    const el = freeformElements[freeformElements.length - 1];
    buildImgEl(el);
    await new Promise(ok => setTimeout(ok, 250));
    selectedElems.clear(); selectedElems.add(freeformElements.length - 1);
    const before = freeformElements.length;
    startMultiCrop();
    const started = mcSession.active && mcSession.mode === 'freeform';
    cropEdState.cx = 0.05; cropEdState.cy = 0.05; cropEdState.cw = 0.4; cropEdState.ch = 0.4; mcAddRegion();
    cropEdState.cx = 0.55; cropEdState.cy = 0.55; cropEdState.cw = 0.4; cropEdState.ch = 0.4; mcAddRegion();
    mcDoneSource();
    const added = freeformElements.slice(before);
    return {
      started,
      added: added.length,
      types: added.map(e => e.type),
      crops: added.map(e => `${e.cropL},${e.cropT},${e.cropR},${e.cropB}`),
      gridUntouched: images.filter(Boolean).length,
    };
  });
  expect(r.started).toBe(true);            // no longer refuses with "needs Grid layout"
  expect(r.added).toBe(2);                 // one placed object per region
  expect(r.types).toEqual(['image', 'image']);
  expect(r.crops[0]).toBe('5,5,55,55');    // the drawn region, as non-destructive crop %
  expect(r.crops[1]).toBe('55,55,5,5');
  expect(r.gridUntouched).toBe(0);         // grid panels are not involved
});

test('grid multi-crop still behaves exactly as before', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    const before = images.filter(Boolean).length;
    startMultiCrop([0]);
    const mode = mcSession.mode;
    cropEdState.cx = 0; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    cropEdState.cx = 0.55; cropEdState.cy = 0; cropEdState.cw = 0.45; cropEdState.ch = 1; mcAddRegion();
    mcDoneSource();
    return { mode, before, after: images.filter(Boolean).length,
             ffUntouched: freeformElements.length };
  });
  expect(r.mode).toBe('grid');
  expect(r.after).toBe(2);
  expect(r.ffUntouched).toBe(0);
});

test('crop a panel picks the selected panel, and does not dead-end in freeform', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    selectedPanel = 2;
    cropSelectedPanel();
    const chose = cropEdState.imgIdx;
    closeCropModal();
    setLayoutMode('freeform');
    selectedElems.clear();
    cropSelectedPanel();                       // nothing selected — must warn, not throw
    return { chose, stillOpen: document.getElementById('crop-modal').classList.contains('open') };
  });
  expect(r.chose).toBe(2);
  expect(r.stillOpen).toBe(false);
});
