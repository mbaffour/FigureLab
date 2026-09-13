// @ts-check
// Crop storage precision, border trimming, and "Reset all crops".
//
// A crop was stored as a whole percent of the image. That is a 1 % grid — 40 px on a
// 4000 px micrograph — so every drag in the editor was quantised to it and a typed
// pixel value could not survive Apply. Crops now keep two decimals. Trimming finds the
// single-colour margin a saved plot or a scan arrives with.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

/** Commit one panel painted by `paintBody` on a w×h canvas. */
async function seedPainted(page, w, h, paintBody, name = 'painted.png') {
  await page.evaluate(async ({ w, h, paintBody, name }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    new Function('ctx', 'W', 'H', paintBody)(c.getContext('2d'), w, h);
    const src = c.toDataURL('image/png');
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { _commitImage(img, src, name); res(); };
      img.onerror = rej;
      img.src = src;
    });
    render();
  }, { w, h, paintBody, name });
  await page.waitForFunction(() => images.every(im => !im || (im.img && im.img.naturalWidth > 0)));
}

const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

test('a crop applied from the editor keeps two decimals, so a typed pixel value survives Apply', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 800, 600, `ctx.fillStyle='#888'; ctx.fillRect(0,0,W,H);`);
  const r = await page.evaluate(async (tf) => {
    const twoFrames = new Function('return ' + tf)();
    openCropModal(0); await twoFrames();
    cropEdState.cx = 0.1; cropEdState.cy = 0.1; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    setCropPx('x', 100); setCropPx('y', 75); setCropPx('w', 501); setCropPx('h', 333);
    applyCropModal();
    const im = images[0];
    const g = _cropGeom(im);
    return { L: im.cropL, T: im.cropT, R: im.cropR, B: im.cropB, sx: g.sx, sy: g.sy, sw: g.sw, sh: g.sh };
  }, twoFrames.toString());
  expect([r.L, r.T]).toEqual([12.5, 12.5]);              // used to be 13, 13
  expect(r.R).toBeCloseTo(100 - 12.5 - 501 / 8, 2);      // 24.88
  expect(r.B).toBeCloseTo(100 - 12.5 - 333 / 6, 2);      // 32
  // …and the geometry the renderer samples is the pixels that were typed
  expect(Math.round(r.sx)).toBe(100); expect(Math.round(r.sy)).toBe(75);
  expect(Math.round(r.sw)).toBe(501); expect(Math.round(r.sh)).toBe(333);
  expect(errors).toEqual([]);
});

test('_trimBounds finds a white margin, rounds outward, and refuses when the corners disagree', async ({ page }) => {
  const errors = await loadApp(page);
  // A "saved plot": white page, dark content block at (80,60) of 200×100 on 400×300.
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#123'; ctx.fillRect(80, 60, 200, 100);
  `);
  // A photo whose corners differ: no single border to remove.
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 200, 300);
  `);
  // Content to every edge with matching corners (a plus sign): nothing to trim.
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(180, 0, 40, H); ctx.fillRect(0, 130, W, 40);
  `);
  const r = await page.evaluate(() => [
    _trimBounds(images[0].img), _trimBounds(images[1].img), _trimBounds(images[2].img),
  ]);
  expect(r[0]).not.toBeNull();
  expect(r[0].l).toBeCloseTo(0.2, 2);            // 80/400
  expect(r[0].t).toBeCloseTo(0.2, 2);            // 60/300
  expect(r[0].r).toBeCloseTo(0.3, 2);            // (400-280)/400
  expect(r[0].b).toBeCloseTo(0.4667, 2);         // (300-160)/300
  // Outward rounding: the reported border never exceeds the true one.
  expect(r[0].l).toBeLessThanOrEqual(0.2); expect(r[0].t).toBeLessThanOrEqual(0.2);
  expect(r[0].r).toBeLessThanOrEqual(0.3); expect(r[0].b).toBeLessThanOrEqual(140 / 300);
  expect(r[1]).toBeNull();                       // corners disagree
  expect(r[2] && r[2].none).toBe(true);          // nothing to trim
  expect(errors).toEqual([]);
});

test('Trim borders on all panels sets each crop to its content, skips the unbordered, and can be undone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#123'; ctx.fillRect(80, 60, 200, 100);
  `);
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 200, 300);
  `);
  const r = await page.evaluate(() => {
    images[0].cropAngle = 5;                       // a stale tilt: a border is axis-aligned
    trimBordersAll();
    const after = images.map(im => [im.cropL, im.cropT, im.cropR, im.cropB, im.cropAngle || 0]);
    const last = reproLog[reproLog.length - 1];
    undo();
    const undone = images.map(im => [im.cropL, im.cropT, im.cropR, im.cropB]);
    return { after, log: last && last.action, undone };
  });
  expect(r.after[0]).toEqual([20, 20, 30, 46.66, 0]);
  expect(r.after[1]).toEqual([0, 0, 0, 0, 0]);          // corners disagree: left alone
  expect(r.log).toBe('trimBorders');
  expect(r.undone[0]).toEqual([0, 0, 0, 0]);
  expect(errors).toEqual([]);
});

test('Trim borders in the editor sets the box and clears the tilt; nothing happens on a pinned size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 400, 300, `
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#123'; ctx.fillRect(80, 60, 200, 100);
  `);
  await seedPanels(page, 1);
  const r = await page.evaluate(async (tf) => {
    const twoFrames = new Function('return ' + tf)();
    openCropModal(0); await twoFrames();
    setCropAngle(6);
    trimCropBorders();
    const box = [cropEdState.cx, cropEdState.cy, cropEdState.cw, cropEdState.ch].map(v => +v.toFixed(3));
    const ang = +cropEdState.ang;
    closeCropModal();
    // Batch mode with the size pinned: trimming must not resize the pinned box.
    startBatchCrop(); await twoFrames();
    cropEdState.cx = 0.3; cropEdState.cy = 0.3; cropEdState.cw = 0.4; cropEdState.ch = 0.4; cropEdState.hasBox = true;
    applyCropModal(); await twoFrames();
    const pinned = [cropEdState.cw, cropEdState.ch];
    trimCropBorders();
    const still = [cropEdState.cw, cropEdState.ch];
    closeCropModal();
    return { box, ang, pinned, still };
  }, twoFrames.toString());
  expect(r.box).toEqual([0.2, 0.2, 0.5, 0.333]);
  expect(r.ang).toBe(0);
  expect(r.still).toEqual(r.pinned);
  expect(errors).toEqual([]);
});

test('Reset all crops clears the tilt as well, and is one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    Object.assign(images[0], { cropL: 10, cropT: 10, cropR: 5, cropB: 5, cropAngle: 12 });
    Object.assign(images[1], { cropL: 3, cropAngle: -4 });
    resetScaleMatch();
    const after = images.map(im => [im.cropL, im.cropT, im.cropR, im.cropB, im.cropAngle || 0]);
    undo();
    const undone = images.map(im => [im.cropL, im.cropAngle]);
    return { after, undone };
  });
  expect(r.after).toEqual([[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]);   // the tilt used to survive
  expect(r.undone).toEqual([[10, 12], [3, -4]]);
  expect(errors).toEqual([]);
});

// ── Loupe ─────────────────────────────────────────────────────
// The editor is a ≤520 px thumbnail of an image that may be 4000 px wide. While a box
// is being placed, a loupe shows the source at no less than 1:1, centred on the
// pointer, in the corner farthest from it.

const CE_FIRE = `
  window._ceFire = (type, px, py) => {
    const c = document.getElementById('crop-ed-canvas');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0,
      clientX: r.left + px * r.width / c.width, clientY: r.top + py * r.height / c.height }));
  };
`;

test('the loupe appears while dragging, away from the pointer, and shows the source pixels under it', async ({ page }) => {
  const errors = await loadApp(page);
  // 1600×1200 source: grey, with a magenta block whose centre is source (500, 400).
  await seedPainted(page, 1600, 1200, `
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff0080'; ctx.fillRect(400, 300, 200, 200);
  `);
  await page.evaluate(CE_FIRE);
  const r = await page.evaluate(async (tf) => {
    const twoFrames = new Function('return ' + tf)();
    openCropModal(0); await twoFrames();
    const c = document.getElementById('crop-ed-canvas');
    const W = c.width, H = c.height, k = W / 1600;             // canvas px per source px
    const atRest = _ceLoupeRect(W, H);
    // Start a box at source (200,150) and drag to source (500,400): the pointer is
    // over the magenta block while the drag is live.
    _ceFire('mousedown', 200 * k, 150 * k);
    _ceFire('mousemove', 500 * k, 400 * k);
    const live = _ceLoupeRect(W, H);
    const ctx = c.getContext('2d');
    const [X, Y, S] = live;
    const px = ctx.getImageData(Math.round(X + S / 2) + 8, Math.round(Y + S / 2) + 8, 1, 1).data;   // just off the crosshair's open centre
    const farFromPointer = !(500 * k >= X && 500 * k <= X + S && 400 * k >= Y && 400 * k <= Y + S);
    _ceFire('mouseup', 500 * k, 400 * k);
    const afterUp = _ceLoupeRect(W, H);
    c.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    const afterLeave = _ceLoupeRect(W, H);
    return { atRest, live, px: [...px], farFromPointer, afterUp, afterLeave, hover: cropEdState.hoverPx };
  }, twoFrames.toString());
  expect(r.atRest).toBeNull();                       // nothing at rest
  expect(r.live).not.toBeNull();                     // present during the drag
  expect(r.live[2]).toBeGreaterThanOrEqual(96);      // big enough to read
  expect(r.farFromPointer).toBe(true);               // never under the pointer
  expect(r.px[0]).toBeGreaterThan(230); expect(r.px[1]).toBeLessThan(40); expect(r.px[2]).toBeGreaterThan(100);   // magenta: the source under the pointer
  expect(r.afterUp).toBeNull();                      // gone when the drag ends
  expect(r.afterLeave).toBeNull();
  expect(r.hover).toBeNull();
  expect(errors).toEqual([]);
});

test('the loupe also shows while the pointer rests on a resize handle', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 800, 600, `ctx.fillStyle='#777'; ctx.fillRect(0,0,W,H);`);
  await page.evaluate(CE_FIRE);
  const r = await page.evaluate(async (tf) => {
    const twoFrames = new Function('return ' + tf)();
    openCropModal(0); await twoFrames();
    const c = document.getElementById('crop-ed-canvas');
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true; drawCropEd();
    _ceFire('mousemove', c.width * 0.5, c.height * 0.5);      // inside the box, not on a handle
    const inside = _ceLoupeRect(c.width, c.height);
    _ceFire('mousemove', c.width * 0.2, c.height * 0.2);      // on the NW corner handle
    const onHandle = _ceLoupeRect(c.width, c.height);
    _ceFire('mousemove', c.width * 0.5, c.height * 0.5);
    const offAgain = _ceLoupeRect(c.width, c.height);
    return { inside, onHandle, offAgain };
  }, twoFrames.toString());
  expect(r.inside).toBeNull();
  expect(r.onHandle).not.toBeNull();
  expect(r.offAgain).toBeNull();
  expect(errors).toEqual([]);
});

// ── Fit grid, and the editor's keys ───────────────────────────

test('_fitGrid picks the fewest empty cells, then the most compact, with a landscape bias', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => Object.fromEntries([1,2,3,4,5,6,7,8,9,10,12,15,16].map(n => { const g = _fitGrid(n); return [n, `${g.cols}x${g.rows}`]; })));
  expect(r).toEqual({ 1:'1x1', 2:'2x1', 3:'3x1', 4:'2x2', 5:'3x2', 6:'3x2', 7:'4x2', 8:'4x2', 9:'3x3', 10:'5x2', 12:'4x3', 15:'5x3', 16:'4x4' });
});

test('Fit grid to panels sets rows × columns for the visible panels, as one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '3'); onLayoutChange();
    fitGridToPanels();
    const six = [gv('cols'), gv('rows')];
    images[5].excluded = true;                    // hide one → five visible
    fitGridToPanels();
    const five = [gv('cols'), gv('rows')];
    undo();
    const undone = [gv('cols'), gv('rows')];
    return { six, five, undone, logged: reproLog.filter(e => e.action === 'fitGrid').length };
  });
  expect(r.six).toEqual(['3', '2']);
  expect(r.five).toEqual(['3', '2']);             // 5 → 3×2 with one empty, not a strip
  expect(r.undone).toEqual(['2', '3']);           // back to the layout before the first fit
  expect(r.logged).toBe(1);                       // the no-op second call logs nothing
  expect(errors).toEqual([]);
});

test('in the crop editor, Enter applies and Escape closes; typing in a field is left alone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const key = (k, target) => `document.dispatchEvent(Object.assign(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }), {}))`;
  const r = await page.evaluate(async (tf) => {
    const twoFrames = new Function('return ' + tf)();
    const modal = document.getElementById('crop-modal');
    const fire = (k, el) => (el || document).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    openCropModal(0); await twoFrames();
    cropEdState.cx = 0.1; cropEdState.cy = 0.1; cropEdState.cw = 0.6; cropEdState.ch = 0.6; cropEdState.hasBox = true; drawCropEd();
    // Enter inside the angle field must not apply (the field owns Enter).
    const ang = document.getElementById('crop-angle'); ang.focus();
    fire('Enter', ang);
    const stillOpenAfterFieldEnter = modal.classList.contains('open');
    ang.blur(); document.body.focus();
    fire('Enter');
    const appliedL = images[0].cropL, closedAfterEnter = !modal.classList.contains('open');
    openCropModal(0); await twoFrames();
    fire('Escape');
    const closedAfterEscape = !modal.classList.contains('open');
    return { stillOpenAfterFieldEnter, appliedL, closedAfterEnter, closedAfterEscape };
  }, twoFrames.toString());
  expect(r.stillOpenAfterFieldEnter).toBe(true);
  expect(r.closedAfterEnter).toBe(true);
  expect(r.appliedL).toBe(10);
  expect(r.closedAfterEscape).toBe(true);
  expect(errors).toEqual([]);
});

// ── Crop to fill cells ────────────────────────────────────────

test('Crop to fill cells trims each panel to its cell shape about the crop centre, respecting a 90° turn', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 400, 200, `ctx.fillStyle='#888'; ctx.fillRect(0,0,W,H);`, 'wide.png');   // 2:1
  await seedPainted(page, 400, 200, `ctx.fillStyle='#777'; ctx.fillRect(0,0,W,H);`, 'turned.png'); // 2:1, shown turned
  await seedPainted(page, 300, 300, `ctx.fillStyle='#666'; ctx.fillRect(0,0,W,H);`, 'square.png'); // already fits
  const r = await page.evaluate(() => {
    sv('cols', '3'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '300'); onLayoutChange(); render();
    images[1].rotate = 90;
    images[0].cropL = 10; images[0].cropR = 10;      // an existing crop: 80 % visible, 320×200 → 1.6:1
    fillCellsAll();
    const crops = images.map(im => [im.cropL, im.cropT, im.cropR, im.cropB]);
    const shown = images.map(im => { const g = _cropGeom(im); const rot = (im.rotate || 0) % 180 !== 0; return +((rot ? g.sh / g.sw : g.sw / g.sh)).toFixed(3); });
    const logged = reproLog.filter(e => e.action === 'fillCells').pop();
    undo();
    return { crops, shown, logged: logged && logged.panels, undone: images[0].cropL };
  });
  // Panel 0: 320 px visible of 400, needs 200 wide → remove 120 px = 30 % of the image, 15 % a side, on top of the 10 %.
  expect(r.crops[0]).toEqual([25, 0, 25, 0]);
  // Panel 1 is turned 90°: its shown height is the source width, so the SOURCE X axis is trimmed.
  expect(r.crops[1]).toEqual([25, 0, 25, 0]);
  expect(r.crops[2]).toEqual([0, 0, 0, 0]);          // already square: untouched
  for (const a of r.shown) expect(a).toBeCloseTo(1, 2);   // everything now shows 1:1 in a square cell
  expect(r.logged).toBe(2);
  expect(r.undone).toBe(10);
  expect(errors).toEqual([]);
});

// ── Linked insets: pick the region, outline it on the parent ──

test('the inset picker opens the crop editor over the parent’s visible crop and adds an inset of the drawn box', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);                         // 100×100 panels
  const r = await page.evaluate(async (tf) => {
    const twoFrames = new Function('return ' + tf)();
    images[0].cropL = 20; images[0].cropR = 20;      // the parent shows its middle 60 %
    selectedPanel = 0; render();
    pickInsetRegion(); await twoFrames();
    const opened = {
      of: cropEdState._insetOf,
      view: [cropEdState.img.width, cropEdState.img.height],
      tiltHidden: document.getElementById('crop-tilt-row').style.display === 'none',
      grip: _ceGrip(),
      copyHidden: ['crop-copy-group', 'crop-copy-all'].map(id => document.getElementById(id).style.display === 'none'),
      button: document.getElementById('crop-apply-btn').textContent,
    };
    cropEdState.cx = 0.5; cropEdState.cy = 0; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    applyCropModal();
    const inset = images[2];
    const after = {
      count: images.length, closed: !document.getElementById('crop-modal').classList.contains('open'),
      rect: inset && inset.insetRect, of: inset && inset.insetOf === images[0].id,
      crop: inset && [inset.cropL, inset.cropT, inset.cropR, inset.cropB],
    };
    openCropModal(0); await twoFrames();
    const tiltBack = document.getElementById('crop-tilt-row').style.display !== 'none';
    const copyBack = ['crop-copy-group', 'crop-copy-all'].every(id => document.getElementById(id).style.display !== 'none');
    closeCropModal();
    return { opened, after, tiltBack, copyBack };
  }, twoFrames.toString());
  expect(r.opened.of).toBe(0);
  expect(r.opened.view).toEqual([60, 100]);          // the visible crop, not the whole image
  expect(r.opened.tiltHidden).toBe(true);            // an inset takes its parent's tilt
  expect(r.opened.grip).toBeNull();                  // …so there is no rotate grip either
  expect(r.opened.copyHidden).toEqual([true, true]); // copy-to-group/all mean nothing here
  expect(r.opened.button).toBe('⧉ Add inset');
  expect(r.after.count).toBe(3);
  expect(r.after.closed).toBe(true);
  expect(r.after.of).toBe(true);
  expect(r.after.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  expect(r.after.crop).toEqual([50, 0, 20, 50]);     // 20 + 60·0.5 … as a fraction of the visible crop
  expect(r.tiltBack).toBe(true);
  expect(r.copyBack).toBe(true);
  expect(errors).toEqual([]);
});

test('each inset’s region is outlined on its parent where that crop was drawn, and the toggle removes it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '200'); onLayoutChange(); render();
    selectedPanel = 0;
    addLinkedInset(0.25, 0.5, 0.5, 0.25);
    render();
    const pb = panelBounds.find(b => b.idx === 0);
    // The 100×100 parent is contain-fitted into the 300×200 cell: 200×200, centred.
    const dw = Math.min(pb.w, pb.h), dx = pb.x + Math.round((pb.w - dw) / 2), dy = pb.y + Math.round((pb.h - dw) / 2);
    const fr = _insetFrames.slice();
    const before = fr.length;
    document.getElementById('inset-frames').checked = false; render();
    const offCount = _insetFrames.length;
    document.getElementById('inset-frames').checked = true;
    images[1].excluded = true; render();             // a hidden inset draws no frame
    const hiddenCount = _insetFrames.length;
    return { fr, before, expected: { x: dx + 0.25 * dw, y: dy + 0.5 * dw, w: 0.5 * dw, h: 0.25 * dw }, offCount, hiddenCount };
  });
  expect(r.before).toBe(1);
  expect(r.fr[0].parentIdx).toBe(0);
  expect(r.fr[0].insetIdx).toBe(1);
  for (const k of ['x', 'y', 'w', 'h']) expect(r.fr[0][k]).toBeCloseTo(r.expected[k], 5);
  expect(r.offCount).toBe(0);
  expect(r.hiddenCount).toBe(0);
  expect(errors).toEqual([]);
});

test('dragging an inset’s outline on the parent moves the inset region, clamped to the parent, as one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '300'); onLayoutChange(); render();
    selectedPanel = 0;
    addLinkedInset(0.25, 0.25, 0.5, 0.5);
    render();
    const f = _insetFrames[0];
    const c = document.getElementById('ann-canvas');
    const rect = c.getBoundingClientRect();
    const lw = canvasLogicalW || c.width, lh = canvasLogicalH || c.height;
    const fire = (t, x, y) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0,
      clientX: rect.left + x * rect.width / lw, clientY: rect.top + y * rect.height / lh }));
    const dw = f.w / 0.5;                            // the parent's drawn width
    // Grab the top edge of the outline and drag it 0.1 of the parent right and down.
    fire('mousedown', f.x + f.w / 2, f.y);
    fire('mousemove', f.x + f.w / 2 + 0.1 * dw, f.y + 0.1 * dw);
    fire('mouseup',   f.x + f.w / 2 + 0.1 * dw, f.y + 0.1 * dw);
    const moved = { ...images[1].insetRect };
    // Drag far past the parent's edge: the region stops at the edge.
    render();
    const f2 = _insetFrames[0];
    fire('mousedown', f2.x + f2.w / 2, f2.y);
    fire('mousemove', f2.x + f2.w / 2 + 5 * dw, f2.y + 5 * dw);
    fire('mouseup',   f2.x + f2.w / 2 + 5 * dw, f2.y + 5 * dw);
    const clamped = { ...images[1].insetRect };
    undo();
    const undone = { ...images[1].insetRect };
    undo();
    const undone2 = { ...images[1].insetRect };
    return { moved, clamped, undone, undone2, logged: reproLog.filter(e => e.action === 'insetMove').length };
  });
  expect(r.moved.x).toBeCloseTo(0.35, 3); expect(r.moved.y).toBeCloseTo(0.35, 3);
  expect(r.moved.w).toBeCloseTo(0.5, 6);  expect(r.moved.h).toBeCloseTo(0.5, 6);   // size untouched
  expect(r.clamped.x).toBeCloseTo(0.5, 6); expect(r.clamped.y).toBeCloseTo(0.5, 6);
  expect(r.undone.x).toBeCloseTo(0.35, 3);
  expect(r.undone2.x).toBeCloseTo(0.25, 6);
  expect(r.logged).toBe(2);
  expect(errors).toEqual([]);
});
