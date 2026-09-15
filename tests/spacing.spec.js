// @ts-check
// Spacing between panels.
//
// In the grid the H/V gap fields work. In the freeform editor — the one the app calls
// the friendly figure editor — there was no way to set the space between objects at
// all: Distribute needed three or more and spread them between the outermost two, so
// with two objects selected it returned in silence, and at no count could you ask for
// an exact gap.
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform } = require('./helpers');

const boxes = () => freeformElements.filter(e => e.type === 'image').map(e => [e.x, e.y, e.w, e.h]);

test('Space puts an exact gap between two or more selected objects, on either axis', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 40, y: 60, w: 100, h: 80, iw: 100, ih: 80, fill: '#a33' },
    { type: 'image', x: 400, y: 200, w: 120, h: 60, iw: 120, ih: 60, fill: '#3a3' },
    { type: 'image', x: 220, y: 500, w: 90, h: 90, iw: 90, ih: 90, fill: '#33a' },
  ]);
  const r = await page.evaluate(() => {
    const boxes = () => freeformElements.filter(e => e.type === 'image').map(e => [e.x, e.y, e.w, e.h]);
    sv('ff-space', '12');
    // two objects: Distribute cannot help here at all
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1);
    spaceElems('h');
    const two = boxes();
    // three objects, vertically
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); selectedElems.add(2);
    sv('ff-space', '30');
    spaceElems('v');
    const three = boxes();
    undo();
    const undone = boxes();
    return { two, three, undone, logged: reproLog.filter(e => e.action === 'spaceElems').length };
  });
  // A stays put (leftmost), B is moved to sit exactly 12 px to its right.
  expect(r.two[0]).toEqual([40, 60, 100, 80]);
  expect(r.two[1][0]).toBe(40 + 100 + 12);
  // Vertically, in top-to-bottom order A(60) B(200) C(500), each 30 px below the last.
  const ys = r.three.map(b => b[1]), hs = r.three.map(b => b[3]);
  expect(ys[0]).toBe(60);
  expect(ys[1]).toBe(60 + hs[0] + 30);
  expect(ys[2]).toBe(ys[1] + hs[1] + 30);
  expect(r.undone.map(b => b[1])).toEqual([60, 200, 500]);       // one undo step
  expect(r.logged).toBe(2);
  expect(errors).toEqual([]);
});

test('Distribute explains itself instead of silently doing nothing with fewer than three', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 40, y: 60, w: 100, h: 80, iw: 100, ih: 80, fill: '#a33' },
    { type: 'image', x: 400, y: 200, w: 120, h: 60, iw: 120, ih: 60, fill: '#3a3' },
  ]);
  const r = await page.evaluate(() => {
    const boxes = () => freeformElements.filter(e => e.type === 'image').map(e => [e.x, e.y, e.w, e.h]);
    const said = [];
    const realToast = window.toast; window.toast = (m, k) => { said.push(String(m)); };
    try {
      selectedElems.clear(); selectedElems.add(0); selectedElems.add(1);
      const before = boxes();
      distributeElems('h');
      const after = boxes();
      selectedElems.clear(); selectedElems.add(0);
      distributeElems('h');
      return { before, after, said };
    } finally { window.toast = realToast; }
  });
  expect(r.after).toEqual(r.before);                              // still a no-op, correctly
  expect(r.said).toHaveLength(2);                                 // …but it now says why
  expect(r.said[0]).toMatch(/two objects, use Space/i);
  expect(r.said[1]).toMatch(/three or more/i);
  expect(errors).toEqual([]);
});

// ── The gutter drag, and the chips beside it ──────────────────
// Both of these made "I cannot change the space between panels" literally true.

/** Seed a grid and return a helper bound to the overlay canvas. */
async function seedGrid(page, n, cols, rows) {
  await page.evaluate(async ({ n, cols, rows }) => {
    const mk = i => { const c = document.createElement('canvas'); c.width = 100; c.height = 100;
      const x = c.getContext('2d'); x.fillStyle = `rgb(${40 + i * 50},80,80)`; x.fillRect(0, 0, 100, 100); return c.toDataURL(); };
    for (let i = 0; i < n; i++) { const s = mk(i);
      await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, s, 'p' + i + '.png'); r(); }; im.src = s; }); }
    sv('cols', String(cols)); sv('rows', String(rows)); sv('panel-w', '120'); sv('panel-h', '120');
    sv('gap-h', '10'); sv('gap-v', '10'); onLayoutChange(); render(); drawAnnOverlay();
  }, { n, cols, rows });
}

test('a gutter drag released off the canvas ends there, instead of running away on later hover', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  const r = await page.evaluate(() => {
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const G = gridGeom();
    const gx = G.x0 + colOffset(1, G.pw, G.gH) - G.gH / 2, gy = G.y0 + 30;
    const cl = (x, y) => ({ clientX: rect.left + x * rect.width / canvasLogicalW, clientY: rect.top + y * rect.height / canvasLogicalH });
    const on = (t, x, y, buttons) => { const q = cl(x, y);
      c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0, buttons: buttons === undefined ? 1 : buttons, ...q })); };
    on('mousedown', gx, gy);
    on('mousemove', gx + 30, gy);
    const mid = { gap: gi('gap-h'), dragging: !!gutterDragState };
    // The release happens off the canvas: the window hears it, the canvas does not.
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0 }));
    const released = { gap: gi('gap-h'), dragging: !!gutterDragState };
    // Now hover back across the canvas with NO button held.
    on('mousemove', gx + 200, gy, 0);
    on('mousemove', gx + 380, gy, 0);
    return { mid, released, afterHover: gi('gap-h'), stillDragging: !!gutterDragState };
  });
  expect(r.mid.dragging).toBe(true);
  expect(r.mid.gap).toBe(40);
  expect(r.released.dragging).toBe(false);          // the drag ended where it was released
  expect(r.released.gap).toBe(40);
  expect(r.afterHover).toBe(40);                    // used to run away to 240, then 420
  expect(r.stillDragging).toBe(false);
  expect(errors).toEqual([]);
});

test('a button-less move ends a drag whose release we never saw at all', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  const r = await page.evaluate(() => {
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const G = gridGeom();
    const gx = G.x0 + colOffset(1, G.pw, G.gH) - G.gH / 2, gy = G.y0 + 30;
    const cl = (x, y) => ({ clientX: rect.left + x * rect.width / canvasLogicalW, clientY: rect.top + y * rect.height / canvasLogicalH });
    const on = (t, x, y, buttons) => { const q = cl(x, y);
      c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0, buttons: buttons === undefined ? 1 : buttons, ...q })); };
    on('mousedown', gx, gy);
    on('mousemove', gx + 25, gy);
    const held = gi('gap-h');
    // No mouseup reaches us anywhere — the next move simply has no button down.
    on('mousemove', gx + 300, gy, 0);
    const after = { gap: gi('gap-h'), dragging: !!gutterDragState };
    on('mousemove', gx + 500, gy, 0);
    return { held, after, later: gi('gap-h') };
  });
  expect(r.held).toBe(35);
  expect(r.after.dragging).toBe(false);
  expect(r.after.gap).toBe(35);                     // the drag is abandoned where it stood
  expect(r.later).toBe(35);
  expect(errors).toEqual([]);
});

test('the − and + gutter chips are clickable at the default gap, not only above 41 px', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  const r = await page.evaluate(() => {
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const cl = (x, y) => ({ clientX: rect.left + x * rect.width / canvasLogicalW, clientY: rect.top + y * rect.height / canvasLogicalH });
    const on = (t, x, y) => { const q = cl(x, y); c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0, buttons: t === 'mousedown' ? 1 : 0, ...q })); };
    const tryGap = (gap) => {
      sv('gap-h', String(gap)); render(); drawAnnOverlay();
      const G = gridGeom();
      const gx = G.x0 + colOffset(1, G.pw, G.gH) - G.gH / 2, gy = G.y0 + G.gridH / 2;
      on('mousemove', gx, gy);                       // hover the divider: chips appear
      const chips = gutterChips.length;
      const plus = gutterChips.find(ch => ch.delta > 0);
      if (!plus) return { gap, chips, clicked: false, after: gi('gap-h') };
      const px = plus.x + plus.w / 2, py = plus.y + plus.h / 2;
      on('mousemove', px, py);                       // reach for it — this used to wipe the chips
      const aliveOnTheWay = gutterChips.length;
      on('mousedown', px, py);
      return { gap, chips, aliveOnTheWay, after: gi('gap-h') };
    };
    return { small: tryGap(6), mid: tryGap(20), big: tryGap(50) };
  });
  for (const k of ['small', 'mid', 'big']) {
    expect(r[k].chips, `no chips at gap ${r[k].gap}`).toBeGreaterThan(0);
    expect(r[k].aliveOnTheWay, `chips vanished on the way at gap ${r[k].gap}`).toBeGreaterThan(0);
    expect(r[k].after, `+ chip did nothing at gap ${r[k].gap}`).toBe(r[k].gap + 2);
  }
  expect(errors).toEqual([]);
});
