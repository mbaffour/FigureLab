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

// ── The plate → panels workflow ───────────────────────────────────────────────
// Cutting several plates into several named regions each is the case multi-crop
// exists for. Without names it produces a wall of A…R panels you have to decode
// afterwards, which is exactly how a figure gets mixed up.

test('regions can be named as they are cut, and the names become the panels', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    // three "plates"
    const mk = (seed) => new Promise(ok => {
      const c = document.createElement('canvas'); c.width = 180; c.height = 180;
      const x = c.getContext('2d'); let s = seed;
      const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
      x.fillStyle = '#ddd'; x.fillRect(0, 0, 180, 180);
      for (let i = 0; i < 30; i++) { x.fillStyle = '#333';
        x.beginPath(); x.arc(rnd() * 180, rnd() * 180, 3 + rnd() * 5, 0, 6.284); x.fill(); }
      const src = c.toDataURL('image/png');
      const im = new Image(); im.onload = () => { _commitImage(im, src, 'plate.png'); ok(); }; im.src = src;
    });
    await mk(11); await mk(22); await mk(33);
    render();

    const phages = ['T4', 'T7', 'lambda'];
    startMultiCrop();
    for (let plate = 1; plate <= 3; plate++) {
      document.getElementById('mc-source-label').value = 'Plate ' + plate;
      const spots = [[0.05, 0.05], [0.40, 0.05], [0.05, 0.40]];
      phages.forEach((ph, i) => {
        cropEdState.cx = spots[i][0]; cropEdState.cy = spots[i][1];
        cropEdState.cw = 0.3; cropEdState.ch = 0.3;
        document.getElementById('mc-region-label').value = ph;
        mcAddRegion();
      });
      mcDoneSource();
    }
    return {
      panels: images.filter(Boolean).length,
      labels: images.filter(Boolean).map(im => im.label),
      cols: +gv('cols'), rows: +gv('rows'),
    };
  });
  expect(r.panels).toBe(9);                       // 3 plates x 3 regions
  // every panel says which plate and which phage — no decoding afterwards
  expect(r.labels).toContain('Plate 1 T4');
  expect(r.labels).toContain('Plate 2 T7');
  expect(r.labels).toContain('Plate 3 lambda');
  expect(r.labels.filter(l => /^Plate \d (T4|T7|lambda)$/.test(l)).length).toBe(9);
  // each plate reads as a column by default, so the grid matches the experiment
  expect(r.cols).toBe(3);
  expect(r.rows).toBe(3);
  expect(errors).toEqual([]);
});

test('naming stays optional — unnamed regions still get A, B, C', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 120;
    const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, 120, 120);
    x.fillStyle = '#222'; x.fillRect(10, 10, 40, 40); x.fillRect(60, 60, 40, 40);
    const src = c.toDataURL('image/png');
    await new Promise(ok => { const i = new Image(); i.onload = () => { _commitImage(i, src, 'p.png'); ok(); }; i.src = src; });
    render();
    startMultiCrop([0]);
    cropEdState.cx = .05; cropEdState.cy = .05; cropEdState.cw = .4; cropEdState.ch = .4;
    document.getElementById('mc-region-label').value = 'named';
    mcAddRegion();
    cropEdState.cx = .5; cropEdState.cy = .5;      // second one left blank
    mcAddRegion();
    mcDoneSource();
    return images.filter(Boolean).map(im => im.label);
  });
  expect(r).toContain('named');
  expect(r.some(l => /^[A-Z]$/.test(l))).toBe(true);   // the unnamed one still lettered
  expect(errors).toEqual([]);
});

test('the region list shows what has been banked so far', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 120;
    c.getContext('2d').fillRect(0, 0, 120, 120);
    const src = c.toDataURL('image/png');
    await new Promise(ok => { const i = new Image(); i.onload = () => { _commitImage(i, src, 'p.png'); ok(); }; i.src = src; });
    render();
    startMultiCrop([0]);
    cropEdState.cx = .05; cropEdState.cy = .05; cropEdState.cw = .3; cropEdState.ch = .3;
    document.getElementById('mc-region-label').value = 'T4'; mcAddRegion();
    cropEdState.cx = .5; cropEdState.cy = .5;
    document.getElementById('mc-region-label').value = 'T7'; mcAddRegion();
    const list = document.getElementById('mc-region-list');
    const cleared = document.getElementById('mc-region-label').value;
    mcFinishNow();
    return { text: list.innerText, shown: list.style.display !== 'none', cleared };
  });
  expect(r.shown).toBe(true);
  expect(r.text).toContain('T4');
  expect(r.text).toContain('T7');
  expect(r.cleared).toBe('');       // field clears so you can type the next name
  expect(errors).toEqual([]);
});

// ── Mode awareness ───────────────────────────────────────────────────────────
// Sections that do nothing in the current layout mode used to render unchanged
// and silently ignore clicks — worse than being absent, because you cannot tell
// it apart from a broken tool.

test('annotation tools work in freeform, not just grid', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    document.querySelectorAll('.sidebar > details').forEach(d => { d.open = true; });
    setLayoutMode('freeform');
    render();
    const before = annotations.length;
    // draw an arrow the way the canvas handlers see it
    const cv = annCanvas, R = cv.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: R.left + R.width * fx, clientY: R.top + R.height * fy,
                              preventDefault(){}, button: 0, shiftKey: false });
    setTool('arrow');
    cv.dispatchEvent(new MouseEvent('mousedown', at(0.2, 0.2)));
    cv.dispatchEvent(new MouseEvent('mousemove', at(0.6, 0.5)));
    cv.dispatchEvent(new MouseEvent('mouseup',   at(0.6, 0.5)));
    const made = annotations.length - before;
    const a = annotations[annotations.length - 1];
    // and it is baked into the freeform render, not just the overlay
    const off = document.createElement('canvas');
    let drew = 0;
    const realStroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function () { drew++; return realStroke.apply(this, arguments); };
    try { render(off, 2); } finally { CanvasRenderingContext2D.prototype.stroke = realStroke; }
    return { made, type: a && a.type, xf: a && +a.xf.toFixed(2), drew,
             toolsVisible: document.getElementById('annotate-grid-only').style.display !== 'none' };
  });
  expect(r.made).toBe(1);                 // the arrow was actually created
  expect(r.type).toBe('arrow');
  expect(r.xf).toBeCloseTo(0.2, 1);       // at the point that was clicked
  expect(r.drew).toBeGreaterThan(0);      // and drawn into the freeform render
  expect(r.toolsVisible).toBe(true);      // so the tools are no longer hidden
  expect(errors).toEqual([]);
});

test('an existing annotation can still be selected and moved in freeform', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    setLayoutMode('freeform'); render();
    annotations.push({ type: 'rect', xf: 0.2, yf: 0.2, x2f: 0.5, y2f: 0.5, color: '#fff', width: 2 });
    renderAnnotationList(); render();
    const cv = annCanvas, R = cv.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: R.left + R.width * fx, clientY: R.top + R.height * fy,
                              preventDefault(){}, button: 0, shiftKey: false });
    setTool('none');                       // Select — objects normally own this
    cv.dispatchEvent(new MouseEvent('mousedown', at(0.2, 0.2)));
    const picked = selectedAnnotation;
    cv.dispatchEvent(new MouseEvent('mousemove', at(0.3, 0.3)));
    cv.dispatchEvent(new MouseEvent('mouseup',   at(0.3, 0.3)));
    return { picked, movedTo: +annotations[0].xf.toFixed(2) };
  });
  expect(r.picked).toBe(0);               // the annotation won the click, not the canvas
  expect(r.movedTo).toBeGreaterThan(0.25); // and it moved with the drag
  expect(errors).toEqual([]);
});

test('panel-pin mode is grid-only — it has no cell to pin to in freeform', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    document.querySelectorAll('.sidebar > details').forEach(d => { d.open = true; });
    const btn = document.getElementById('panel-ann-mode-btn');
    setLayoutMode('grid');   const g = btn.style.display !== 'none';
    setLayoutMode('freeform'); const f = btn.style.display !== 'none';
    return { g, f, mode: panelAnnMode };
  });
  expect(r.g).toBe(true);
  expect(r.f).toBe(false);
  expect(r.mode).toBe(false);   // and it is switched off on the way in, not left stuck
  expect(errors).toEqual([]);
});

test('object creators stay reachable in BOTH modes', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    document.querySelectorAll('.sidebar > details').forEach(d => { d.open = true; });
    const seen = () => {
      const e = document.getElementById('icon-palette');
      return !!e && e.offsetParent !== null;
    };
    setLayoutMode('grid'); const g = seen();
    setLayoutMode('freeform'); const f = seen();
    return { g, f };
  });
  // these switch to freeform themselves, so hiding them in grid would be a dead end
  expect(r.g).toBe(true);
  expect(r.f).toBe(true);
  expect(errors).toEqual([]);
});

test('PowerPoint export says why it is unavailable, before the click', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    setLayoutMode('grid');
    const g = { disabled: document.getElementById('pptx-btn').disabled };
    setLayoutMode('freeform');
    const btn = document.getElementById('pptx-btn');
    return { g, disabled: btn.disabled, title: btn.title };
  });
  expect(r.g.disabled).toBe(false);
  expect(r.disabled).toBe(true);
  expect(r.title).toMatch(/switch to Grid/i);
  expect(errors).toEqual([]);
});

test('one name per concept — the collisions are resolved', async ({ page }) => {
  await loadApp(page);
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('.sidebar .sec-lbl')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  const has = re => headings.some(h => re.test(h));
  // "Presets" used to name four different things across three sections
  expect(headings.filter(h => /preset/i.test(h)).length).toBeLessThanOrEqual(1);
  expect(has(/Quick start/)).toBe(true);
  expect(has(/Layout templates/)).toBe(true);
  expect(has(/Journal house style/)).toBe(true);
  // "Themes" meant both app chrome and figure look
  expect(has(/Figure themes/)).toBe(true);
  // "Save" meant five things
  expect(has(/Save this layout as a template/)).toBe(true);
  expect(has(/Session library/)).toBe(true);
});

test('the version badge tracks APP_VERSION and cannot drift', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => ({
    badge: document.getElementById('version-badge').textContent,
    constant: 'v' + APP_VERSION,
  }));
  expect(r.badge).toBe(r.constant);
});

// ── White space ──────────────────────────────────────────────────────────────
// Panel cells are a fixed size and images are contain-fit inside them, so content
// whose shape differs from the cell's is drawn with blank bars around it. A 4:3
// crop in the default square cell wastes a quarter of every cell.

/** Seed one non-square (4:3) image, the normal shape for a plate photograph. */
async function seedWide(page, n = 2) {
  await page.evaluate(async (count) => {
    for (let k = 0; k < count; k++) {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      const x = c.getContext('2d'); let s = 7 + k * 91;
      const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
      x.fillStyle = '#e8e4d8'; x.fillRect(0, 0, 800, 600);
      for (let i = 0; i < 50; i++) { x.fillStyle = 'rgba(30,30,30,.8)';
        x.beginPath(); x.arc(rnd() * 800, rnd() * 600, 3 + rnd() * 6, 0, 6.284); x.fill(); }
      const src = c.toDataURL('image/png');
      await new Promise(ok => { const i = new Image(); i.onload = () => { _commitImage(i, src, 'p.png'); ok(); }; i.src = src; });
    }
    render();
  }, n);
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
}

/** Blank bars around the drawn image inside panel 0's cell. */
const LETTERBOX = () => {
  const im = images[0];
  const iw = im.img.naturalWidth, ih = im.img.naturalHeight;
  const sw = iw * (1 - (im.cropL + im.cropR) / 100), sh = ih * (1 - (im.cropT + im.cropB) / 100);
  const pw = gi('panel-w'), ph = gi('panel-h'), sc = Math.min(pw / sw, ph / sh);
  return { v: Math.round((ph - sh * sc) / 2), h: Math.round((pw - sw * sc) / 2),
           wasted: 1 - (sw * sc * sh * sc) / (pw * ph), cw: canvasLogicalW, chh: canvasLogicalH };
};

test('fitting panels to the images removes the letterbox', async ({ page }) => {
  const errors = await loadApp(page);
  await seedWide(page);
  const r = await page.evaluate((LB) => {
    const lb = new Function('return ' + LB)();
    sv('panel-w', '300'); sv('panel-h', '300'); onLayoutChange(); render();
    const before = lb();
    fitPanelsToContent(); render();
    return { before, after: lb(), h: gi('panel-h') };
  }, LETTERBOX.toString());
  // 4:3 content in a square cell wastes a quarter of it
  expect(r.before.v).toBeGreaterThan(30);
  expect(r.before.wasted).toBeGreaterThan(0.2);
  // fitted: no bars at all, and the canvas got shorter rather than wider
  expect(r.after.v).toBe(0);
  expect(r.after.h).toBe(0);
  expect(r.after.wasted).toBeCloseTo(0, 2);
  expect(r.h).toBe(225);                        // 300 / (4/3)
  expect(r.after.chh).toBeLessThan(r.before.chh);
  expect(r.after.cw).toBe(r.before.cw);         // width is what journals specify — unchanged
  expect(errors).toEqual([]);
});

test('multi-crop fits the cells to the regions automatically', async ({ page }) => {
  const errors = await loadApp(page);
  await seedWide(page, 2);
  const r = await page.evaluate((LB) => {
    const lb = new Function('return ' + LB)();
    sv('panel-w', '300'); sv('panel-h', '300'); onLayoutChange();
    startMultiCrop();
    for (let img = 0; img < 2; img++) {
      [[0.05, 0.05], [0.55, 0.05], [0.05, 0.55]].forEach(p => {
        cropEdState.cx = p[0]; cropEdState.cy = p[1];
        cropEdState.cw = 0.35; cropEdState.ch = 0.35; mcAddRegion();
      });
      mcDoneSource();
    }
    render();
    return { lb: lb(), panels: images.filter(Boolean).length };
  }, LETTERBOX.toString());
  expect(r.panels).toBe(6);
  // the regions all share one shape, so this should be exact — no bars at all
  expect(r.lb.v).toBe(0);
  expect(r.lb.h).toBe(0);
  expect(errors).toEqual([]);
});

test('tighten spacing closes the gaps but keeps room for what is switched on', async ({ page }) => {
  const errors = await loadApp(page);
  await seedWide(page);
  const r = await page.evaluate(() => {
    // NB: sv() writes .value, so it does nothing to a checkbox — set .checked directly
    const chk = (id, on) => { const e = document.getElementById(id); if (e) e.checked = on; };
    sv('fig-title', ''); chk('show-row-labels', false); chk('show-col-labels', false);
    tightenSpacing(); render();
    const bare = { gh: gi('gap-h'), top: gi('m-top'), left: gi('m-left'), w: canvasLogicalW };
    // with a title and row headers on, the margins must not clip them
    sv('fig-title', 'Figure 1'); chk('show-row-labels', true); onLayoutChange();
    tightenSpacing(); render();
    return { bare, titled: { top: gi('m-top'), left: gi('m-left') } };
  });
  expect(r.bare.gh).toBe(2);
  expect(r.bare.top).toBe(6);
  expect(r.bare.left).toBe(6);
  expect(r.titled.top).toBeGreaterThan(r.bare.top);    // room kept for the title
  expect(r.titled.left).toBeGreaterThan(r.bare.left);  // and for the row headers
  expect(errors).toEqual([]);
});

test('row and column headers sit exactly the requested distance from the figure', async ({ page }) => {
  const errors = await loadApp(page);
  await seedWide(page, 4);
  const r = await page.evaluate(() => {
    const chk = (id, on) => { const e = document.getElementById(id); if (e) e.checked = on; };
    sv('cols', '2'); sv('rows', '2');
    chk('show-col-labels', true); chk('show-row-labels', true);
    onLayoutChange();
    const probe = () => {
      render();
      const fs = gi('axis-fs'), pb = panelBounds[0];
      const col = figTextItems.find(t => t.kind === 'col');
      const row = figTextItems.find(t => t.kind === 'row');
      return { col: Math.round(pb.y - (col.y + fs / 2)),      // header bottom → panel top
               row: Math.round(pb.x - (row.x + fs / 2)),      // header right  → panel left
               h: canvasLogicalH };
    };
    sv('axis-gap', '6');  onLayoutChange(); const a = probe();
    sv('axis-gap', '0');  onLayoutChange(); const b = probe();
    sv('axis-gap', '30'); onLayoutChange(); const c = probe();
    return { a, b, c };
  });
  // the number in the box is the gap, on both axes — it used to be mLeft/2 for rows,
  // i.e. wherever the margin happened to put it
  expect(r.a.col).toBe(6);  expect(r.a.row).toBe(6);
  expect(r.b.col).toBe(0);  expect(r.b.row).toBe(0);
  expect(r.c.col).toBe(30); expect(r.c.row).toBe(30);
  expect(r.b.h).toBeLessThan(r.c.h);        // and the canvas follows
  expect(errors).toEqual([]);
});

test('the header gap survives a session round-trip', async ({ page }) => {
  const errors = await loadApp(page);
  await seedWide(page, 2);
  const r = await page.evaluate(() => {
    sv('axis-gap', '3');
    const s = JSON.parse(JSON.stringify(serializeSession(false)));
    sv('axis-gap', '20');
    applySession(s);
    return gv('axis-gap');
  });
  expect(String(r)).toBe('3');
  expect(errors).toEqual([]);
});

// ── Showing a subset of the panels ───────────────────────────────────────────
// Multi-crop can produce far more panels than a figure needs. Hiding has to be
// non-destructive: re-cropping is the expensive part, so the panels you don't
// show must stay recoverable.

async function seedNumbered(page, n) {
  await page.evaluate(async (count) => {
    for (let k = 1; k <= count; k++) {
      const c = document.createElement('canvas'); c.width = 200; c.height = 150;
      const x = c.getContext('2d');
      x.fillStyle = `hsl(${k * 40},50%,70%)`; x.fillRect(0, 0, 200, 150);
      const src = c.toDataURL('image/png');
      await new Promise(ok => { const i = new Image(); i.onload = () => { _commitImage(i, src, 'p' + k + '.png'); ok(); }; i.src = src; });
    }
    sv('cols', '3'); sv('rows', '2'); onLayoutChange(); render();
  }, n);
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
}

const SHOWN = () => panelBounds.map(p => images[p.idx] ? images[p.idx].name.replace('.png', '') : '-').join(',');

test('hiding a panel takes it out of the figure and the grid closes up', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate((S) => {
    const shown = new Function('return ' + S)();
    render(); const before = shown();
    togglePanelExcluded(1); togglePanelExcluded(4);   // hide p2 and p5
    render();
    return { before, after: shown(),
             badge: document.getElementById('img-count').textContent,
             stillThere: images.filter(Boolean).length };
  }, SHOWN.toString());
  expect(r.before).toBe('p1,p2,p3,p4,p5,p6');
  // the remaining panels move up — no holes where the hidden ones were
  expect(r.after.startsWith('p1,p3,p4,p6')).toBe(true);
  expect(r.badge).toBe('4 of 6');            // the hidden ones are never a surprise
  expect(r.stillThere).toBe(6);              // hidden, not deleted
  expect(errors).toEqual([]);
});

test('relabelling letters only the panels a reader will see', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(() => {
    togglePanelExcluded(1); togglePanelExcluded(4);
    relabelPanels(); render();
    return figTextItems.filter(f => f.kind === 'panel').map(f => f.str);
  });
  expect(r).toEqual(['A', 'B', 'C', 'D']);   // contiguous, no gap where p2/p5 were
  expect(errors).toEqual([]);
});

test('"show only ticked" keeps the ticked panels and hides the rest', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate((S) => {
    const shown = new Function('return ' + S)();
    document.querySelectorAll('.panel-pick').forEach((e, i) => { e.checked = (i === 0 || i === 2); });
    showOnlySelectedPanels(); render();
    const after = shown();
    showAllPanels(); render();
    return { after, restored: shown() };
  }, SHOWN.toString());
  expect(r.after.startsWith('p1,p3')).toBe(true);
  expect(r.restored).toBe('p1,p2,p3,p4,p5,p6');   // one click brings them all back
  expect(errors).toEqual([]);
});

test('hidden panels survive a saved session', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(async () => {
    togglePanelExcluded(1); togglePanelExcluded(4);
    const s = JSON.parse(JSON.stringify(serializeSession(true)));   // bundled, as a saved file
    showAllPanels();
    applySession(s);
    await new Promise(ok => setTimeout(ok, 500));
    return { flags: images.map(im => im && im.excluded ? 'H' : '.').join(''), n: images.filter(Boolean).length };
  });
  expect(r.flags).toBe('.H..H.');
  expect(r.n).toBe(6);
  expect(errors).toEqual([]);
});

test('deleting hidden panels is explicit, and undoable', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(() => {
    togglePanelExcluded(1); togglePanelExcluded(4);
    deleteHiddenPanels();
    const asked = !!document.getElementById('confirm-modal-bg');   // never silent
    document.getElementById('cm-ok').click();
    const after = images.filter(Boolean).length;
    undo();
    return { asked, after, undone: images.filter(Boolean).length };
  });
  expect(r.asked).toBe(true);
  expect(r.after).toBe(4);
  expect(r.undone).toBe(6);
  expect(errors).toEqual([]);
});

test('sv/gv work on checkboxes instead of silently doing nothing', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const id = 'show-col-labels';
    const el = document.getElementById(id);
    el.checked = false;
    sv(id, true);  const onT = el.checked, readT = gv(id);
    sv(id, false); const offT = el.checked, readF = gv(id);
    sv(id, '1');   const onStr = el.checked;
    // a text input must be completely unaffected by the change
    sv('fig-title', 'Figure 1');
    const text = gv('fig-title');
    sv('fig-title', '');
    return { onT, readT, offT, readF, onStr, text, gcAgrees: (sv(id, true), gc(id) === true) };
  });
  expect(r.onT).toBe(true);        // used to be a no-op: .value on a checkbox is inert
  expect(r.offT).toBe(false);
  expect(r.onStr).toBe(true);      // '1' from a serialised session works too
  expect(r.readT).toBeTruthy();    // gv used to return "on" regardless of state
  expect(r.readF).toBeFalsy();
  expect(r.gcAgrees).toBe(true);   // and agrees with the dedicated reader
  expect(r.text).toBe('Figure 1'); // text inputs unchanged
  expect(errors).toEqual([]);
});

// ── Group bands (spot-dilution style outer labels) ───────────────────────────

test('a group band spans the rows you give it and draws a bracket', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(() => {
    sv('rows', '6'); sv('cols', '1');
    document.getElementById('show-row-labels').checked = true;
    onLayoutChange();
    sv('group-axis', 'row'); sv('group-block', '3');
    _grpFromBlocksUI();
    const generated = figGroups.map(g => `${g.axis}${g.from}-${g.to}`);
    figGroups[0].label = 'No ATC'; figGroups[1].label = '+ 5uM ATC';
    sv('group-bracket', 'bar'); render();
    const bands = figTextItems.filter(t => t.kind === 'group');
    const widthWith = canvasLogicalW;
    figGroups = []; render();
    return { generated, labels: bands.map(b => b.str), rotated: bands.every(b => !!b.rot),
             widthWith, widthWithout: canvasLogicalW };
  });
  // "Every N" builds the ranges; unlabelled bands are kept so you can name them
  expect(r.generated).toEqual(['row1-3', 'row4-6']);
  expect(r.labels).toEqual(['No ATC', '+ 5uM ATC']);
  expect(r.rotated).toBe(true);                       // row bands read vertically
  expect(r.widthWith).toBeGreaterThan(r.widthWithout); // the band reserves its own space
  expect(errors).toEqual([]);
});

test('an unnamed band draws nothing and costs no space', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(() => {
    sv('rows', '6'); sv('cols', '1'); onLayoutChange(); render();
    const bare = canvasLogicalW;
    sv('group-axis', 'row'); sv('group-block', '3'); _grpFromBlocksUI(); render();
    return { bare, unnamed: canvasLogicalW, kept: figGroups.length,
             drawn: figTextItems.filter(t => t.kind === 'group').length };
  });
  expect(r.kept).toBe(2);        // the ranges survive so you can type into them
  expect(r.drawn).toBe(0);       // but nothing is drawn until they are named
  expect(r.unnamed).toBe(r.bare);
  expect(errors).toEqual([]);
});

test('bands work across columns too, and the bracket style is selectable', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(() => {
    sv('cols', '3'); sv('rows', '2'); onLayoutChange();
    figGroups = [{ axis: 'col', from: 1, to: 2, label: 'treated' }];
    const styles = {};
    for (const s of ['bar', 'square', 'none']) {
      sv('group-bracket', s); render();
      styles[s] = { h: canvasLogicalH, drawn: figTextItems.filter(t => t.kind === 'group').length,
                    rot: !!figTextItems.find(t => t.kind === 'group').rot };
    }
    return styles;
  });
  // a column band reads horizontally, and the label shows whatever the bracket style
  expect(r.bar.rot).toBe(false);
  expect(r.bar.drawn).toBe(1);
  expect(r.none.drawn).toBe(1);      // "label only" still labels
  expect(r.square.h).toBe(r.bar.h);  // style doesn't change the reserved space
  expect(errors).toEqual([]);
});

test('group bands survive a session round-trip', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNumbered(page, 6);
  const r = await page.evaluate(async () => {
    figGroups = [{ axis: 'row', from: 1, to: 3, label: 'No ATC' },
                 { axis: 'row', from: 4, to: 6, label: '+ 5uM ATC' }];
    sv('group-bracket', 'square');
    const s = JSON.parse(JSON.stringify(serializeSession(true)));
    figGroups = []; sv('group-bracket', 'bar');
    applySession(s);
    await new Promise(ok => setTimeout(ok, 400));
    return { n: figGroups.length, first: figGroups[0] && figGroups[0].label,
             bracket: gv('group-bracket') };
  });
  expect(r.n).toBe(2);
  expect(r.first).toBe('No ATC');
  expect(r.bracket).toBe('square');
  expect(errors).toEqual([]);
});

test('mixed-shape panels are fitted to the middle one, and you are told', async ({ page }) => {
  const errors = await loadApp(page);
  await seedWide(page, 2);
  const r = await page.evaluate(() => {
    // make panel 1 a different shape than panel 0
    images[1].cropL = 30; images[1].cropR = 0; render();
    const toasts = [];
    const realToast = window.toast;
    window.toast = (m, k) => { toasts.push(String(m)); };
    try { fitPanelsToContent(); } finally { window.toast = realToast; }
    return { toasts };
  });
  // cells can only be one shape, so this is a real limit — it must be stated
  expect(r.toasts.some(t => /aren't all the same shape/i.test(t))).toBe(true);
  expect(errors).toEqual([]);
});
