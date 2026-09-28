// @ts-check
// Batch crop: resize the shared size mid-batch, edit each image without leaving the
// batch, carry those edits forward, step Back to re-edit, and bring done images to a
// new size. The size used to be frozen after the first draw and the only edit possible
// inside the batch was position and tilt.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

const TF = `() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`;

test('resize handles are live in batch mode and a click outside the box still moves it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async (tfSrc) => {
    const tf = new Function('return ' + tfSrc)();
    startBatchCrop(); await tf();
    cropEdState.cx = 0.3; cropEdState.cy = 0.3; cropEdState.cw = 0.4; cropEdState.ch = 0.4; cropEdState.hasBox = true;
    applyCropModal(); await tf();
    const locked = _ceSizeLocked(), sized = _ceBatchSized();
    closeCropModal();
    return { locked, sized };
  }, TF);
  expect(r.locked).toBe(false);   // handles and W/H work
  expect(r.sized).toBe(true);     // …but a stray click moves rather than redraws
  expect(errors).toEqual([]);
});

test('edits made in the batch are written to the panel and carried to the next image', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(async (tfSrc) => {
    const tf = new Function('return ' + tfSrc)();
    startBatchCrop(); await tf();
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    setBatchEdit('brightness', 1.5);
    setBatchEdit('gamma', 0.8);
    setBatchEdit('lut', 'green');
    batchEditRotate(90);
    setBatchEdit('flipH', true);
    applyCropModal(); await tf();
    const carried = { ...cropEdState.batchEdit };
    // Untick carry: image 3 should come up with its own (untouched) settings
    cropEdState.batchCarry = false;
    applyCropModal(); await tf();
    const own = { ...cropEdState.batchEdit };
    applyCropModal(); await tf();
    const pick = im => ({ brightness: im.brightness, gamma: im.gamma, lut: im.lut, rotate: im.rotate, flipH: im.flipH });
    return { carried, own, panels: images.map(pick),
      open: document.getElementById('crop-modal').classList.contains('open') };
  }, TF);
  expect(r.carried).toMatchObject({ brightness: 1.5, gamma: 0.8, lut: 'green', rotate: 90, flipH: true });
  expect(r.own).toMatchObject({ brightness: 1, gamma: 1, lut: 'none', rotate: 0, flipH: false });
  expect(r.panels[0]).toEqual({ brightness: 1.5, gamma: 0.8, lut: 'green', rotate: 90, flipH: true });
  expect(r.panels[1]).toEqual({ brightness: 1.5, gamma: 0.8, lut: 'green', rotate: 90, flipH: true });
  expect(r.panels[2]).toEqual({ brightness: 1, gamma: 1, lut: 'none', rotate: 0, flipH: false });
  expect(r.open).toBe(false);
  expect(errors).toEqual([]);
});

test('untouched edits never overwrite a panel\'s existing adjustments', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async (tfSrc) => {
    const tf = new Function('return ' + tfSrc)();
    images[1].contrast = 1.7; images[1].invert = true;
    startBatchCrop(); await tf();
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    applyCropModal(); await tf();
    const shown = { ...cropEdState.batchEdit };
    applyCropModal(); await tf();
    return { shown, c: images[1].contrast, inv: images[1].invert };
  }, TF);
  expect(r.shown).toMatchObject({ contrast: 1.7, invert: true });
  expect(r.c).toBe(1.7);
  expect(r.inv).toBe(true);
  expect(errors).toEqual([]);
});

test('✓ All carries the edits to every remaining image; Edits → all reaches done images too', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async (tfSrc) => {
    const tf = new Function('return ' + tfSrc)();
    startBatchCrop(); await tf();
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    applyCropModal(); await tf();                    // image 1 done, no edits
    setBatchEdit('grayscale', true);
    batchEditsToAll();                               // reaches image 1 as well
    const afterAll = images.map(im => im.grayscale);
    setBatchEdit('contrast', 1.3);
    applyBatchCropAll();                             // images 2..4, carrying the contrast
    return { afterAll, gray: images.map(im => im.grayscale), ct: images.map(im => im.contrast) };
  }, TF);
  expect(r.afterAll).toEqual([true, false, true, true]);   // current one is written on Apply
  expect(r.gray).toEqual([true, true, true, true]);
  expect(r.ct).toEqual([1, 1.3, 1.3, 1.3]);
  expect(errors).toEqual([]);
});

test('Back reopens the previous image with its saved crop and edits, without changing the shared size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(async (tfSrc) => {
    const tf = new Function('return ' + tfSrc)();
    startBatchCrop(); await tf();
    cropEdState.cx = 0.1; cropEdState.cy = 0.1; cropEdState.cw = 0.4; cropEdState.ch = 0.4; cropEdState.hasBox = true;
    setBatchEdit('brightness', 2);
    applyCropModal(); await tf();                    // image 1 at 0.4
    setCropPx('w', 60); setCropPx('h', 60);          // image 2 resized → shared size 0.6
    setBatchEdit('brightness', 1.2);
    backBatchCrop(); await tf();                     // back to image 1
    const back = { idx: cropEdState.imgIdx, cw: +cropEdState.cw.toFixed(3), cx: +cropEdState.cx.toFixed(3),
      br: cropEdState.batchEdit.brightness, shared: +cropEdState.batchCropW.toFixed(3),
      queue: cropEdState.batchQueue.slice() };
    const note = document.getElementById('batch-size-note').textContent;
    applyCropModal(); await tf();                    // re-apply image 1 at 0.4, forward to image 2
    const fwd = { idx: cropEdState.imgIdx, cw: +cropEdState.cw.toFixed(3) };
    const mismatch = _batchSizeMismatch().slice();
    batchSizeToAll();                                // image 1 → 0.6 about its centre
    const im0 = images[0];
    const size0 = +((100 - im0.cropL - im0.cropR) / 100).toFixed(3);
    const ctr0 = +((im0.cropL + (100 - im0.cropL - im0.cropR) / 2) / 100).toFixed(3);
    closeCropModal();
    return { back, note, fwd, mismatch, size0, ctr0 };
  }, TF);
  expect(r.back).toEqual({ idx: 0, cw: 0.4, cx: 0.1, br: 2, shared: 0.6, queue: [1, 2] });
  expect(r.fwd).toEqual({ idx: 1, cw: 0.6 });          // image 2 gets the shared size
  expect(r.mismatch).toEqual([0]);
  expect(r.size0).toBe(0.6);
  expect(r.ctr0).toBeCloseTo(0.3, 2);                   // centred where it was (0.1 + 0.2)
  expect(errors).toEqual([]);
});

test('the editor previews the pending edits and draws a panel preview', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(async (tfSrc) => {
    const tf = new Function('return ' + tfSrc)();
    startBatchCrop(); await tf();
    cropEdState.cx = 0.4; cropEdState.cy = 0.4; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    const cc = document.getElementById('crop-ed-canvas');
    const px = () => Array.from(cc.getContext('2d').getImageData(Math.round(cc.width * 0.6), Math.round(cc.height * 0.6), 1, 1).data);
    drawCropEd(); const before = px();
    setBatchEdit('invert', true); const after = px();
    batchEditRotate(90);
    const rc = document.getElementById('be-result');
    const orient = document.getElementById('be-orient').textContent;
    closeCropModal();
    return { before, after, rw: rc.width, rh: rc.height, orient, applied: images[0].invert };
  }, TF);
  expect(r.after[0]).toBeGreaterThan(r.before[0] + 100);   // dark grey → light
  expect(r.orient).toContain('90');
  expect(r.rw).toBeGreaterThan(0);
  expect(r.applied).toBe(false);                           // closing without Apply writes nothing
  expect(errors).toEqual([]);
});
