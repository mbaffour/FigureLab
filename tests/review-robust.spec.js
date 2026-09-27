// @ts-check
// Robustness gaps found by reviewing the loop-2026-09-14 series: a drop that stalls on
// one bad file, a crop editor that will not draw after a tilt, a phantom undo step, a
// chip that stays lit, lane numbers across the blot's edge.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

test('an SVG that fails to rasterise does not strand the files dropped after it', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    // Stand-in for Firefox's SecurityError on a canvas tainted by a <foreignObject> SVG.
    // A 2048 x 100 SVG rasterises to exactly 4096 x 200 (scale 2); nothing else in this
    // test makes a canvas that size, so only _rasterizeSVG's toDataURL throws.
    const orig = HTMLCanvasElement.prototype.toDataURL;
    window.__origToDataURL = orig;
    HTMLCanvasElement.prototype.toDataURL = function (...a) {
      if (this.width === 4096 && this.height === 200) throw new DOMException('tainted', 'SecurityError');
      return orig.apply(this, a);
    };
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="100">'
      + '<rect width="2048" height="100" fill="#c33"/></svg>'], 'diagram.svg', { type: 'image/svg+xml' });
    const c = document.createElement('canvas'); c.width = 60; c.height = 40;
    const x = c.getContext('2d'); x.fillStyle = '#246'; x.fillRect(0, 0, 60, 40);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const png = new File([blob], 'lane1.png', { type: 'image/png' });
    window.__addDone = false;
    // Not awaited here: without the fix this promise never settles, and the wait below
    // is what reports it.
    addFiles([svg, png]).then(() => { window.__addDone = true; });
  });
  // Without the fix: the throw escapes img.onload, neither callback runs, fin() is never
  // called, addFiles waits on the SVG forever and lane1.png never opens — this times out
  // (and the uncaught throw also lands in `errors` as a pageerror).
  await page.waitForFunction(() => window.__addDone === true, null, { timeout: 5000 });
  const r = await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = window.__origToDataURL;
    return images.filter(Boolean).map(im => im.name);
  });
  expect(r).toEqual(['lane1.png']);                // the SVG failed; the file after it did not
  expect(errors).toEqual([]);
});

test('the freeform crop editor can draw a box on an element that was only straightened', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 50, w: 200, h: 150, iw: 400, ih: 300, fill: '#4a4' }]);
  const r = await page.evaluate(async (twoFramesSrc) => {
    const twoFrames = new Function('return ' + twoFramesSrc)();
    selectedElems.clear(); selectedElems.add(0);
    openFreeformCropEditor(); await twoFrames();
    setCropAngle(3);                               // Level / Auto / the Tilt field — no box drawn
    applyCropModal();
    const saved = { ang: freeformElements[0].cropAngle, l: freeformElements[0].cropL, r: freeformElements[0].cropR };

    selectedElems.clear(); selectedElems.add(0);
    openFreeformCropEditor(); await twoFrames();
    const reopened = { hasBox: cropEdState.hasBox, cw: cropEdState.cw, ang: +cropEdState.ang,
                       field: document.getElementById('crop-angle').value };

    const c = document.getElementById('crop-ed-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, px, py) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0, buttons: t === 'mouseup' ? 0 : 1,
      clientX: rect.left + px * rect.width / c.width, clientY: rect.top + py * rect.height / c.height }));
    fire('mousedown', c.width * 0.25, c.height * 0.25);
    fire('mousemove', c.width * 0.70, c.height * 0.75);
    fire('mouseup',   c.width * 0.70, c.height * 0.75);
    const drawn = { hasBox: cropEdState.hasBox, cw: cropEdState.cw, ch: cropEdState.ch };
    closeCropModal();
    return { saved, reopened, drawn };
  }, twoFrames.toString());
  expect(r.saved.ang).toBe(3);
  expect(r.saved.l).toBe(0); expect(r.saved.r).toBe(0);   // a tilt, and no crop
  // Without the fix hasBox reopens true (seeded from cropAngle), the mousedown lands
  // inside the full-frame "box" and is a clamped move, so cw stays 1 and these fail.
  expect(r.reopened.hasBox).toBe(false);
  expect(r.reopened.cw).toBe(1);
  // …and the tilt is not lost by it: ang is still seeded, and the no-box branch of
  // drawCropEd writes it to the readout (item 4a — the angle IS shown).
  expect(r.reopened.ang).toBe(3);
  expect(r.reopened.field).toBe('3.0');
  expect(r.drawn.hasBox).toBe(true);
  // Loose bounds, as in workflow.spec.js: the box lives in the tilted frame.
  expect(r.drawn.cw).toBeGreaterThan(0.25); expect(r.drawn.cw).toBeLessThan(0.8);
  expect(r.drawn.ch).toBeGreaterThan(0.25); expect(r.drawn.ch).toBeLessThan(0.8);
  expect(errors).toEqual([]);
});

test('a click on an annotation released off the canvas records no undo step; a real drag still does', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    annotations.push({ type: 'line', xf: 0.4, yf: 0.5, x2f: 0.6, y2f: 0.5, color: '#fff', width: 2 });
    selectedAnnotation = -1; render();
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, x, y, buttons) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0, buttons,
      clientX: rect.left + x * rect.width / canvasLogicalW, clientY: rect.top + y * rect.height / canvasLogicalH }));
    // the release lands outside the canvas: only the window listener sees it
    const releaseElsewhere = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0 }));

    const n0 = undoStack.length;
    fire('mousedown', 0.5 * canvasLogicalW, 0.5 * canvasLogicalH, 1);   // on the line's body
    const grabbed = !!annDragState;
    releaseElsewhere();
    const click = { n: undoStack.length - n0, cleared: annDragState === null, yf: annotations[0].yf };

    const n1 = undoStack.length;
    fire('mousedown', 0.5 * canvasLogicalW, 0.5 * canvasLogicalH, 1);
    fire('mousemove', 0.5 * canvasLogicalW, 0.3 * canvasLogicalH, 1);
    releaseElsewhere();
    const drag = { n: undoStack.length - n1, cleared: annDragState === null, yf: annotations[0].yf };
    return { grabbed, click, drag };
  });
  expect(r.grabbed).toBe(true);                    // the mousedown really started a drag
  // Without the fix _endStrandedDrags pushes preDrag unconditionally: click.n is 1.
  expect(r.click.n).toBe(0);
  expect(r.click.cleared).toBe(true);
  expect(r.click.yf).toBe(0.5);
  // The movement test must not swallow a real stranded drag.
  expect(r.drag.yf).toBeCloseTo(0.3, 2);
  expect(r.drag.n).toBe(1);
  expect(r.drag.cleared).toBe(true);
  expect(errors).toEqual([]);
});

test('the heading chip stops glowing when the pointer leaves the canvas', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2);
    sc('show-col-labels', true); onLayoutChange(); render(); drawAnnOverlay();
    const hit = labelToggleHit;
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const cx = hit.x + hit.w / 2, cy = hit.y + hit.h / 2;
    const at = { clientX: rect.left + cx * rect.width / canvasLogicalW, clientY: rect.top + cy * rect.height / canvasLogicalH };
    c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 0, ...at }));
    const over = labelChipHover;
    // count redraws, so the unlit chip is actually painted, not just flagged
    const real = window.drawAnnOverlay; let redraws = 0;
    window.drawAnnOverlay = function () { redraws++; return real.apply(this, arguments); };
    c.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, ...at }));
    window.drawAnnOverlay = real;
    return { over, after: labelChipHover, redraws };
  });
  expect(r.over).toBe(true);                       // the hover really lit it
  // Without the fix nothing on mouseleave touches labelChipHover: it stays true, no redraw.
  expect(r.after).toBe(false);
  expect(r.redraws).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('lane numbers sit above the blot, not across its top edge, when there is room', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 1); sv('m-top', 48); onLayoutChange(); render();
    selectedPanel = 0;
    window.prompt = () => '4';
    addLaneLabels();
    render();
    const b = panelBounds.find(p => p.idx === 0);
    const iy = b.iy != null ? b.iy : b.y;
    const H = annCanvas.height;
    // the ink, measured the way the app draws a text annotation (textBaseline 'top')
    const m = document.createElement('canvas').getContext('2d');
    const fam = gv('label-font') || 'system-ui,sans-serif';
    const lanes = annotations.filter(a => a.type === 'text').map(a => {
      m.font = `${gc('label-italic') ? 'italic' : 'normal'} ${gc('label-bold') ? 'bold' : 'normal'} ${a.fontSize}px ${fam}`;
      m.textBaseline = 'top';
      const top = a.yf * H;
      return { top, emBottom: top + a.fontSize, inkBottom: top + m.measureText(a.text).actualBoundingBoxDescent, fs: a.fontSize };
    });
    return { iy, lanes };
  });
  expect(r.lanes.length).toBe(4);
  expect(r.iy).toBeGreaterThan(24);                // there is room above the blot
  for (const l of r.lanes) {
    // Without the fix top = iy - 0.6*fs, so the em box ends 6.4 px inside the blot and
    // the digits' ink (most of a font size below the top) ends inside it too: both fail.
    expect(l.emBottom).toBeLessThan(r.iy);
    expect(l.inkBottom).toBeLessThan(r.iy);
    // …and just above it, not somewhere up the margin
    expect(l.top).toBeGreaterThan(r.iy - l.fs - 8);
  }
  expect(errors).toEqual([]);
});
