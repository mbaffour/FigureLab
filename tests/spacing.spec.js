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
