// @ts-check
// Stalls found by building whole figures end to end, which per-task probing missed.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('after straightening a panel you can still draw a crop box', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    openCropModal(0); await twoFrames();
    const fresh = { hasBox: cropEdState.hasBox, cw: cropEdState.cw };
    // any of the tilt controls — Level's result, Auto's result, the nudges, the field
    setCropAngle(7);
    const afterTilt = { hasBox: cropEdState.hasBox, ang: cropEdState.ang };
    // now draw a box with the mouse, as the whole point of straightening is to then crop
    const c = document.getElementById('crop-ed-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, px, py) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0, buttons: t === 'mouseup' ? 0 : 1,
      clientX: rect.left + px * rect.width / c.width, clientY: rect.top + py * rect.height / c.height }));
    fire('mousedown', c.width * 0.25, c.height * 0.25);
    fire('mousemove', c.width * 0.70, c.height * 0.75);
    fire('mouseup',   c.width * 0.70, c.height * 0.75);
    const drawn = { cw: +cropEdState.cw.toFixed(2), ch: +cropEdState.ch.toFixed(2), hasBox: cropEdState.hasBox };
    applyCropModal();
    return { fresh, afterTilt, drawn, crop: [images[0].cropL, images[0].cropR].map(v => Math.round(v)) };
  });
  expect(r.fresh.hasBox).toBe(false);
  expect(r.fresh.cw).toBe(1);
  expect(r.afterTilt.ang).toBe(7);
  expect(r.afterTilt.hasBox).toBe(false);          // a never-drawn full frame is not a box
  // A real box roughly the size dragged. Not pinned tighter than that: the box lives in
  // the TILTED frame, so its normalised size is not the raw canvas fraction of the drag.
  expect(r.drawn.hasBox).toBe(true);
  expect(r.drawn.cw).toBeGreaterThan(0.25); expect(r.drawn.cw).toBeLessThan(0.8);
  expect(r.drawn.ch).toBeGreaterThan(0.25); expect(r.drawn.ch).toBeLessThan(0.8);
  expect(r.crop[0]).toBeGreaterThan(10);           // …and a real crop reached the panel
  expect(errors).toEqual([]);
});

test('the crop editor shows this panel’s tilt, not the last one’s', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    openCropModal(0); await twoFrames();
    setCropAngle(7);
    cropEdState.cx = 0.2; cropEdState.cy = 0.2; cropEdState.cw = 0.5; cropEdState.ch = 0.5; cropEdState.hasBox = true;
    drawCropEd(); applyCropModal();
    // panel B has never been cropped or tilted
    openCropModal(1); await twoFrames();
    return { angleField: document.getElementById('crop-angle').value,
             note: document.getElementById('crop-angle-note').textContent.trim(),
             realAngle: +cropEdState.ang || 0,
             vals: document.getElementById('crop-ed-vals').textContent };
  });
  expect(r.realAngle).toBe(0);
  expect(r.angleField).toBe('0.0');                // showed 7.0 from the previous panel
  expect(r.note).toBe('');                         // and "resampled — pixels are interpolated", untruthfully
  expect(r.vals).toMatch(/Draw a region/);
  expect(errors).toEqual([]);
});

test('the annotation toolbar stops eating the pointer while an endpoint is dragged', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const f = document.getElementById('ann-float');
    annotations.push({ type: 'line', xf: 0.4, yf: 0.5, x2f: 0.6, y2f: 0.5, color: '#fff', width: 2 });
    selectedAnnotation = 0; showAnnFloat(0);
    const before = getComputedStyle(f).pointerEvents;
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, x, y, buttons) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: rect.left + x * rect.width / canvasLogicalW, clientY: rect.top + y * rect.height / canvasLogicalH }));
    fire('mousedown', 0.4 * canvasLogicalW, 0.5 * canvasLogicalH);
    const during = getComputedStyle(f).pointerEvents;
    fire('mousemove', 0.4 * canvasLogicalW, 0.08 * canvasLogicalH);
    fire('mouseup',   0.4 * canvasLogicalW, 0.08 * canvasLogicalH, 0);
    return { before, during, after: getComputedStyle(f).pointerEvents, movedTo: +annotations[0].yf.toFixed(2) };
  });
  expect(r.before).not.toBe('none');
  expect(r.during).toBe('none');                   // the toolbar steps out of the way mid-drag
  expect(r.after).not.toBe('none');                // …and comes back
  expect(r.movedTo).toBeLessThan(0.2);             // the endpoint reached the top of the figure
  expect(errors).toEqual([]);
});
