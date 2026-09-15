// @ts-check
// Splitting a multi-channel panel into the classic DAPI | GFP | merge row.
//
// The function is called splitChannelRow, its button promises "a row of separate
// single-channel panels plus a merge", and it never touched the grid — a 2×2 figure
// stayed 2×2. Its toast then sent you to Auto-arrange, which lays 3 panels out as 2×2,
// so the advice could not produce the row it named either.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

/** Give panel 0 an extra channel so it is a real merge. */
const MAKE_MERGE = `window._makeMerge = (n) => {
  images[0].name = 'cells_DAPI.tif'; images[0].lut = 'blue';
  for (let k = 1; k <= n; k++) images[0].channels.push({
    name: 'cells_' + (k === 1 ? 'GFP' : 'RFP') + '.tif', img: images[1].img, src: images[1].src,
    lut: k === 1 ? 'green' : 'magenta', blackPt: 0, whitePt: 255 });
};`;

test('splitting a merge that is the whole figure lays the parts out as one row', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(MAKE_MERGE);
  const r = await page.evaluate(() => {
    // build the merge first, THEN make it the entire figure
    _makeMerge(1);
    images.splice(1, 1);
    sv('cols', '2'); sv('rows', '2'); onLayoutChange(); render();
    const before = [gv('cols'), gv('rows'), images.length];
    const said = []; const realToast = window.toast; window.toast = m => said.push(String(m));
    try { splitChannelRow(0); } finally { window.toast = realToast; }
    render();
    const rowsOfY = new Set(panelBounds.filter(b => b.idx >= 0).map(b => Math.round(b.y)));
    return { before, after: [gv('cols'), gv('rows'), images.length],
             distinctRows: rowsOfY.size, said,
             logged: reproLog.filter(e => e.action === 'splitChannels').pop() };
  });
  expect(r.before).toEqual(['2', '2', 1]);
  expect(r.after).toEqual(['3', '1', 3]);         // DAPI | GFP | merge — it used to stay 2×2
  expect(r.distinctRows).toBe(1);                 // genuinely one row on the canvas
  expect(r.said[0]).toMatch(/row of 3/);
  expect(r.said[0]).not.toMatch(/Auto-arrange/);  // the advice that produced a 2×2
  expect(r.logged.row).toBe(true);
  expect(errors).toEqual([]);
});

test('splitting inside a bigger figure leaves the other panels alone and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(MAKE_MERGE);
  const r = await page.evaluate(() => {
    _makeMerge(1);
    sv('cols', '2'); sv('rows', '2'); onLayoutChange(); render();
    const said = []; const realToast = window.toast; window.toast = m => said.push(String(m));
    try { splitChannelRow(0); } finally { window.toast = realToast; }
    return { grid: [gv('cols'), gv('rows')], panels: images.length, said,
             logged: reproLog.filter(e => e.action === 'splitChannels').pop() };
  });
  expect(r.grid).toEqual(['2', '2']);             // the other three panels keep their places
  expect(r.panels).toBe(6);
  expect(r.said[0]).toMatch(/kept their places/);
  expect(r.logged.row).toBe(false);
  expect(errors).toEqual([]);
});

test('the palette opens the right panel’s drawer and puts "+ Add channel" in view', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(async () => {
    selectedPanel = 1;
    renderImgList();
    const drawerBefore = document.getElementById('settings-1').classList.contains('open');
    _cmdpAddChannel();
    await new Promise(r => setTimeout(r, 120));
    const d = document.getElementById('settings-1');
    const btn = d.querySelector('.f-add-ch-btn');
    return { drawerBefore, drawerAfter: d.classList.contains('open'),
             flashed: btn.classList.contains('cmdp-flash'), hasTip: !!btn.getAttribute('title') };
  });
  expect(r.drawerBefore).toBe(false);             // it sits 1165 px down a closed drawer
  expect(r.drawerAfter).toBe(true);
  expect(r.flashed).toBe(true);
  expect(r.hasTip).toBe(true);                    // it was the one control there with no tooltip
  expect(errors).toEqual([]);
});
