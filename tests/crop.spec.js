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
