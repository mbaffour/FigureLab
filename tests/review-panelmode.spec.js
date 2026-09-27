// @ts-check
// Panel-mode annotations (panelAnns) had fallen behind the figure-level ones: no toolbar
// pass-through while dragging, no ending for a drag released off the canvas, a channel
// key that could only be grabbed by its top-left corner, and a key that went into the
// SVG as pixels. Each test below fails at 9c0732b for the reason in its comment.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('dragging a panel annotation takes the toolbar out of the pointer’s way', async ({ page }) => {
  // At HEAD the panel-mode mousedown never called _annFloatPassthrough(true), so `during`
  // is the toolbar's normal 'auto' and the first expectation on it fails.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    panelAnnMode = true; activeTool = 'none';
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, x, y, buttons) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: rect.left + x * rect.width / c.width, clientY: rect.top + y * rect.height / c.height }));
    images[3].panelAnns = [{ type: 'line', xf: 0.3, yf: 0.5, x2f: 0.7, y2f: 0.5, color: '#fff', width: 2 }];
    render();
    const pb = panelBounds.find(p => p.idx === 3);
    const f = document.getElementById('ann-float');
    const before = getComputedStyle(f).pointerEvents;
    const mx = pb.x + 0.5 * pb.w, my = pb.y + 0.5 * pb.h;
    fire('mousedown', mx, my);
    const grabbed = !!panelAnnDrag;
    const during = getComputedStyle(f).pointerEvents;
    fire('mousemove', mx, pb.y + 0.2 * pb.h);
    fire('mouseup',   mx, pb.y + 0.2 * pb.h, 0);
    return { before, grabbed, during, after: getComputedStyle(f).pointerEvents,
             yf: +images[3].panelAnns[0].yf.toFixed(2), ended: panelAnnDrag === null };
  });
  expect(r.grabbed).toBe(true);                    // the click really started a panel drag
  expect(r.before).not.toBe('none');
  expect(r.during).toBe('none');                   // toolbar steps aside mid-drag
  expect(r.after).not.toBe('none');                // …and comes back
  expect(r.yf).toBeCloseTo(0.2, 2);                // the drag itself still works
  expect(r.ended).toBe(true);
  expect(errors).toEqual([]);
});

test('a panel annotation released off the canvas stops following the pointer, recording the move once', async ({ page }) => {
  // At HEAD _dragStranded() did not list panelAnnDrag, so the buttons:0 mousemove fell
  // through to the drag handler: panelAnnDrag stays set (`ended` is false) and the
  // line jumps to the buttons:0 position instead of staying where it was released.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    panelAnnMode = true; activeTool = 'none';
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, x, y, buttons) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: rect.left + x * rect.width / c.width, clientY: rect.top + y * rect.height / c.height }));
    images[3].panelAnns = [{ type: 'line', xf: 0.3, yf: 0.5, x2f: 0.7, y2f: 0.5, color: '#fff', width: 2 }];
    render();
    const pb = panelBounds.find(p => p.idx === 3);
    const a = images[3].panelAnns[0];
    const mx = pb.x + 0.5 * pb.w, my = pb.y + 0.5 * pb.h;
    fire('mousedown', mx, my);
    const grabbed = !!panelAnnDrag;
    const n0 = undoStack.length;
    fire('mousemove', mx, my - 0.2 * pb.h);                 // button held: a real move
    const yfMoved = a.yf;
    // released outside the window: the next move over the canvas has no button down
    fire('mousemove', mx, my + 0.3 * pb.h, 0);
    return { grabbed, ended: panelAnnDrag === null, steps: undoStack.length - n0,
             yfMoved: +yfMoved.toFixed(3), yfNow: +a.yf.toFixed(3),
             pe: getComputedStyle(document.getElementById('ann-float')).pointerEvents };
  });
  expect(r.grabbed).toBe(true);
  expect(r.yfMoved).toBeCloseTo(0.3, 2);
  expect(r.ended).toBe(true);                      // the drag ended
  expect(r.yfNow).toBe(r.yfMoved);                 // and did not follow the button-less move
  expect(r.steps).toBe(1);                         // the move is one undo step
  expect(r.pe).not.toBe('none');                   // toolbar usable again
  expect(errors).toEqual([]);
});

test('a panel annotation clicked and released off the canvas without moving adds no undo step', async ({ page }) => {
  // At HEAD neither the buttons:0 mousemove nor the window mouseup ended panelAnnDrag:
  // the mousemove moved the line to the far point (yf check fails) and panelAnnDrag is
  // still set after the window mouseup (`ended` is false).
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    panelAnnMode = true; activeTool = 'none';
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, x, y, buttons) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: rect.left + x * rect.width / c.width, clientY: rect.top + y * rect.height / c.height }));
    images[3].panelAnns = [{ type: 'line', xf: 0.3, yf: 0.5, x2f: 0.7, y2f: 0.5, color: '#fff', width: 2 }];
    render();
    const pb = panelBounds.find(p => p.idx === 3);
    const a = images[3].panelAnns[0];
    const mx = pb.x + 0.5 * pb.w, my = pb.y + 0.5 * pb.h;
    // (1) a button-less move after an off-canvas release
    fire('mousedown', mx, my);
    const grabbed1 = !!panelAnnDrag, n0 = undoStack.length;
    fire('mousemove', mx + 0.3 * pb.w, my + 0.4 * pb.h, 0);
    const one = { ended: panelAnnDrag === null, steps: undoStack.length - n0, yf: +a.yf.toFixed(3), xf: +a.xf.toFixed(3) };
    // (2) the release is delivered to the window, not the canvas
    fire('mousedown', mx, my);
    const grabbed2 = !!panelAnnDrag, n1 = undoStack.length;
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0 }));
    const two = { ended: panelAnnDrag === null, steps: undoStack.length - n1 };
    return { grabbed1, grabbed2, one, two };
  });
  expect(r.grabbed1).toBe(true);
  expect(r.one.ended).toBe(true);
  expect(r.one.yf).toBe(0.5);                      // did not run away to the pointer
  expect(r.one.xf).toBe(0.3);
  expect(r.one.steps).toBe(0);                     // nothing moved, nothing to undo
  expect(r.grabbed2).toBe(true);
  expect(r.two.ended).toBe(true);
  expect(r.two.steps).toBe(0);
  expect(errors).toEqual([]);
});

test('a channel key pinned to a panel can be grabbed anywhere on it, not just its top-left corner', async ({ page }) => {
  // At HEAD panelAnnToVirtual dropped _w/_h, so hitAnnotation used an 80x30 box: the
  // probe 3 px inside the lower-right corner (y offset > 40) misses and `hit` is false.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    panelAnnMode = true; activeTool = 'none';
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (t, x, y, buttons) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0,
      buttons: buttons === undefined ? 1 : buttons,
      clientX: rect.left + x * rect.width / c.width, clientY: rect.top + y * rect.height / c.height }));
    // Three named channels so the key is ~63 px tall — well past the 80x30 fallback box
    // plus its 10 px tolerance, which is what makes a lower-corner probe discriminate.
    images[0].name = 'a_DAPI.tif'; images[0].lut = 'blue';
    images[1].name = 'b_GFP.tif';  images[1].lut = 'green';
    images[3].name = 'd_BF.tif';
    render();
    images[1].panelAnns = [{ type: 'legend', xf: 0.1, yf: 0.1, color: '#ffffff', width: 1, fontSize: 12,
                             fill: true, fillColor: '#000000', fillOpacity: 0.6 }];
    render();                                        // _drawLegend stamps _w/_h
    const pb = panelBounds.find(p => p.idx === 1);
    const key = images[1].panelAnns[0];
    const kx = pb.x + key.xf * pb.w, ky = pb.y + key.yf * pb.h;
    const v = panelAnnToVirtual(key, pb, c.width, c.height);
    const hit = hitAnnotation(v, kx + key._w - 3, ky + key._h - 3, c.width, c.height);
    // and through the real canvas path: a Select-mode press there picks the key up
    fire('mousedown', kx + key._w - 3, ky + key._h - 3);
    const picked = selectedPanelAnn ? [selectedPanelAnn.imgIdx, selectedPanelAnn.annIdx] : null;
    fire('mouseup', kx + key._w - 3, ky + key._h - 3, 0);
    return { w: key._w, h: key._h, hit, picked };
  });
  expect(r.h).toBeGreaterThan(45);                 // the probe lies outside the 80x30(+10) fallback
  expect(r.hit).toBe(true);
  expect(r.picked).toEqual([1, 0]);
  expect(errors).toEqual([]);
});

test('SVG export writes a panel-pinned channel key as text, not into the raster', async ({ page }) => {
  // At HEAD exportSVG re-emitted only the figure-level annotations, so `names` is [] and
  // there is no key <rect>; and the export raster drew the key (rasterCalls is 1, not 0).
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    panelAnnMode = true; activeTool = 'none';
    // three named channels, so the key has three rows of text to emit
    images[0].name = 'a_DAPI.tif'; images[0].lut = 'blue';
    images[1].name = 'b_GFP.tif';  images[1].lut = 'green';
    images[3].name = 'd_BF.tif';
    render();
    images[1].panelAnns = [{ type: 'legend', xf: 0.1, yf: 0.15, color: '#ffffff', width: 1, fontSize: 12,
                             fill: true, fillColor: '#000000', fillOpacity: 0.6 }];
    render();
    const pb = panelBounds.find(p => p.idx === 1);
    const key = images[1].panelAnns[0];
    // Count only draws onto the detached export canvas — the on-screen re-render that
    // scheduleRender fires while the download is read draws the key too, legitimately.
    const orig = window._drawLegend; let rasterCalls = 0;
    window._drawLegend = function (ctx) { if (!ctx.canvas.isConnected) rasterCalls++; return orig.apply(this, arguments); };
    let svg;
    try {
      svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')))).data);
    } finally { window._drawLegend = orig; }
    // The key's own <text> shape (fill then dominant-baseline, no text-anchor), so panel
    // tags — which the label pass writes with a text-anchor — cannot stand in for it.
    const names = [...svg.matchAll(/<text x="[\d.]+" y="[\d.]+" style="font:[^"]*" fill="[^"]*" dominant-baseline="central">([A-Za-z]+)<\/text>/g)].map(m => m[1]);
    const keyRect = (svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="[\d.]+" rx="4"/) || []).slice(1);
    return { names, keyRect, want: [(pb.x + key.xf * pb.w).toFixed(2), (pb.y + key.yf * pb.h).toFixed(2)],
             rasterCalls, annotations: annotations.length };
  });
  expect(r.annotations).toBe(0);                   // no figure-level key to supply the text
  expect(r.names).toEqual(['DAPI', 'GFP', 'BF']);  // the channel names are <text>
  expect(r.keyRect).toEqual(r.want);               // placed from the panel's cell
  expect(r.rasterCalls).toBe(0);                   // and not also baked into the background
  expect(errors).toEqual([]);
});
