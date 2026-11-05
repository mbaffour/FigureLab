// @ts-check
// Round 2 tester findings on measurement, the Counter, layout and import undo:
//   R2-14  an ROI or Count dragged over a Grid panel measured the background bars
//          around the contain-fitted picture;
//   R2-10  the Counter's number was a running global, not the marks on the figure;
//   R2-12  with rows hugging, a hidden panel's gap kept its columns but not its height;
//   R2-13  Split channels re-lettered every panel in the figure;
//   R2-08  one drop recorded one undo step per image.
// The measure and counter cases use the real mouse. Each test says what it saw at
// b1c6ec4, before the fix.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

const FX = path.join(__dirname, 'fixtures');

// Logical figure coordinates → client pixels on #ann-canvas.
async function toClient(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const lw = canvasLogicalW || c.width, lh = canvasLogicalH || c.height;
    return [r.left + x * r.width / lw, r.top + y * r.height / lh];
  }, [x, y]);
}
async function drag(page, x0, y0, x1, y1) {
  const [a, b] = await toClient(page, x0, y0), [c, d] = await toClient(page, x1, y1);
  await page.mouse.move(a, b); await page.mouse.down();
  await page.mouse.move(c, d, { steps: 6 }); await page.mouse.up();
}
async function click(page, x, y) { const [cx, cy] = await toClient(page, x, y); await page.mouse.click(cx, cy); }
async function pickTool(page, tool) {
  await page.evaluate(t => _tutOpen(document.querySelector(`.ann-tool[data-tool="${t}"]`)), tool);
  await page.locator(`.ann-tool[data-tool="${tool}"]`).first().click();
}

// One 100 x 50 black image with a white disc of radius 8 at its centre, calibrated
// 1 µm/px, in a 300 x 300 cell: the picture is drawn 300 x 150 with 75 px of white
// background above and below it. Labels and the scale bar off, so the picture is only
// the image. Returns the cell [x, y, w, h].
async function letterboxedPanel(page, shape) {
  return page.evaluate(async (shape) => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 50;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 100, 50);
    x.fillStyle = '#fff'; x.beginPath(); x.arc(50, 25, 8, 0, 7); x.fill();
    const src = c.toDataURL();
    await new Promise(r => { const i = new Image(); i.onload = () => { _commitImage(i, src, 'one_cell.png', null, { umPerPx: 1, source: 'test' }); r(); }; i.src = src; });
    sc('show-labels', false); images[0].sbOn = false;
    if (shape) images[0].cropShape = shape;
    render();
    const b = panelBounds.find(p => p.idx === 0);
    return [b.x, b.y, b.w, b.h];
  }, shape || null);
}
const lastMeasure = page => page.evaluate(() => {
  const m = measurements[measurements.length - 1];
  return { n: measurements.length, type: m && m.type, mean: m && +m.meanGray, area: m && m.area, areaUm: m && m.areaUm,
           count: m && m.count, clipped: m && m.clipped, html: document.getElementById('roi-results').innerHTML };
});

// ── R2-14 ───────────────────────────────────────────────────────────────────
test('R2-14: an ROI dragged across a letterboxed panel measures the picture, not the bars around it', async ({ page }) => {
  // At b1c6ec4: mean 130.19 (the white bars averaged in), area 9604 source px² =
  // 9604.00 µm² on a 5000 µm² image, and nothing said the drag left the picture.
  const errors = await loadApp(page);
  const [x, y, w, h] = await letterboxedPanel(page);
  await pickTool(page, 'measure-roi');
  await drag(page, x + 3, y + 3, x + w - 3, y + h - 3);
  const m = await lastMeasure(page);
  expect(m.type).toBe('roi');
  // The picture is 300 x 150 on screen = 100 x 50 source px; the drag is about 3 px
  // inside the cell (the mouse lands on whole client pixels), so it covers about 294 of
  // the 300 columns and all 50 rows: about 98 x 50 = 4900 source px, never past 5000.
  expect(m.area).toBeGreaterThan(4800);
  expect(m.area).toBeLessThanOrEqual(5000);
  expect(+m.areaUm).toBeLessThanOrEqual(5000);
  // ~201 white disc pixels in 4900 → mean ≈ 10.5; with the bars it was 130.
  expect(m.mean).toBeGreaterThan(5);
  expect(m.mean).toBeLessThan(20);
  expect(m.clipped).toBe(true);
  expect(m.html).toContain('extended past the panel image');
  expect(errors).toEqual([]);
});

test('R2-14: Count over a letterboxed panel counts the one object on the picture', async ({ page }) => {
  // At b1c6ec4: Count = 3 — the disc and the two white background bars.
  const errors = await loadApp(page);
  const [x, y, w, h] = await letterboxedPanel(page);
  await pickTool(page, 'measure-count');
  await drag(page, x + 3, y + 3, x + w - 3, y + h - 3);
  const m = await lastMeasure(page);
  expect(m.type).toBe('cellCount');
  expect(m.count).toBe(1);
  // Figure px segmented: the picture's 150 rows by about 294 columns, not the 294 x 294
  // drag (86 436 px at b1c6ec4).
  expect(m.area).toBeGreaterThan(290 * 150);
  expect(m.area).toBeLessThanOrEqual(300 * 150);
  expect(m.clipped).toBe(true);
  expect(m.html).toContain('extended past the panel image');
  expect(errors).toEqual([]);
});

test('R2-14: a selection wholly on the background bar measures nothing and says so', async ({ page }) => {
  // At b1c6ec4 this recorded an ROI of the white bar: mean 255, a "measurement" of the
  // figure's background with nothing to say it was not the image.
  const errors = await loadApp(page);
  const [x, y, w] = await letterboxedPanel(page);
  await pickTool(page, 'measure-roi');
  await drag(page, x + 20, y + 10, x + w - 20, y + 60);   // the bar above the picture (75 px tall)
  const m = await lastMeasure(page);
  expect(m.n).toBe(0);
  expect(m.html).toContain('nothing was measured');
  expect(errors).toEqual([]);
});

test('R2-14: an ROI over a circle-cropped panel leaves out the corners outside the circle', async ({ page }) => {
  // At b1c6ec4 the white background around the circle (inside the picture's 300 x 150
  // box, a circle 150 across) was averaged in: mean 163.91 for a black picture with a
  // small white disc.
  const errors = await loadApp(page);
  const [x, y, w, h] = await letterboxedPanel(page, 'circle');
  const box = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 0); return [b.ix, b.iy, b.iw, b.ih]; });
  await pickTool(page, 'measure-roi');
  await drag(page, box[0] + 1, box[1] + 1, box[0] + box[2] - 1, box[1] + box[3] - 1);
  const m = await lastMeasure(page);
  expect(m.type).toBe('roi');
  expect(m.mean).toBeLessThan(30);             // the disc is ~201/(π·25²) of the circle ≈ 10 %
  expect(m.clipped).toBe(true);
  expect(errors).toEqual([]);
});

// ── R2-10 ───────────────────────────────────────────────────────────────────
test('R2-10: the Counter counts the marks on the figure through undo, redo and re-selecting the tool', async ({ page }) => {
  // At b1c6ec4: after Ctrl+Z the chip said "Count: 3" over marks 1,2; the next click made
  // mark 4 ("Count: 4"); re-selecting the tool restarted at 1 — marks 1,2,4,1, "Count: 1".
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const st = () => page.evaluate(() => ({
    marks: annotations.filter(a => a.type === 'counter').map(a => a.n).join(','),
    chip: document.getElementById('counter-display').textContent }));
  await pickTool(page, 'counter');
  for (const [x, y] of [[60, 60], [90, 70], [120, 80]]) await click(page, x, y);
  expect(await st()).toEqual({ marks: '1,2,3', chip: 'Count: 3' });
  await page.keyboard.press('Control+z'); await page.waitForTimeout(50);
  expect(await st()).toEqual({ marks: '1,2', chip: 'Count: 2' });
  await click(page, 150, 90);
  expect(await st()).toEqual({ marks: '1,2,3', chip: 'Count: 3' });
  await pickTool(page, 'arrow'); await pickTool(page, 'counter');
  expect((await st()).chip).toBe('Count: 3');
  await click(page, 180, 100);
  expect(await st()).toEqual({ marks: '1,2,3,4', chip: 'Count: 4' });
  await page.evaluate(() => undo()); await page.evaluate(() => redo());
  expect(await st()).toEqual({ marks: '1,2,3,4', chip: 'Count: 4' });
  // Delete mark 2: the count is the marks left, and the next number is still new.
  await page.evaluate(() => { pushUndo(); annotations.splice(annotations.findIndex(a => a.type === 'counter' && a.n === 2), 1); renderAnnotationList(); });
  expect(await st()).toEqual({ marks: '1,3,4', chip: 'Count: 3' });
  await click(page, 200, 110);
  expect(await st()).toEqual({ marks: '1,3,4,5', chip: 'Count: 4' });
  expect(errors).toEqual([]);
});

// ── R2-12 ───────────────────────────────────────────────────────────────────
test('R2-12: with rows hugging, hiding a panel in gap mode moves no other panel', async ({ page }) => {
  // At b1c6ec4, hiding B (60 x 200, two rows tall): A 606x271 → 606x182, C and D moved up
  // from y=317 to y=228, E and F from 623 to 474. Hiding A moved C and D down 29 px.
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    for (const [name, w, h] of [['a.png', 200, 60], ['b.png', 60, 200], ['c.png', 100, 80], ['d.png', 100, 80], ['e.png', 100, 80], ['f.png', 100, 80]]) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, w, h);
      const src = c.toDataURL();
      await new Promise(r => { const i = new Image(); i.onload = () => { _commitImage(i, src, name); r(); }; i.src = src; });
    }
  });
  const r = await page.evaluate(() => {
    const out = {};
    for (const which of [0, 1]) {
      images.forEach(i => { i.excluded = false; });
      sv('cols', 3); sv('rows', 3); onLayoutChange();
      images[0].colSpan = 2; images[1].rowSpan = 2;
      sc('auto-row-h', true); sv('hidden-gap', 'gap'); onLayoutChange();
      const pos = () => { render(); const m = {}; panelBounds.filter(b => b.idx >= 0 && images[b.idx]).forEach(b => { m[images[b.idx].name] = [b.x, b.y, b.w, b.h].map(Math.round).join(','); }); return m; };
      const before = pos(); images[which].excluded = true; const after = pos();
      out[which] = { moved: Object.keys(after).filter(k => after[k] !== before[k]).map(k => `${k}: ${before[k]} -> ${after[k]}`),
                     hugged: Object.values(before).some(v => +v.split(',')[3] < 300) };
    }
    return out;
  });
  // Rows really hug (some row is below the 300 px panel height), so the option is live.
  expect(r[0].hugged || r[1].hugged).toBe(true);
  expect(r[1].moved).toEqual([]);              // hide B
  expect(r[0].moved).toEqual([]);              // hide A
  expect(errors).toEqual([]);
});

// ── R2-13 ───────────────────────────────────────────────────────────────────
test('R2-13: Split channels letters only the new panels; WT, KO and a hidden panel keep their labels', async ({ page }) => {
  // At b1c6ec4 the labels went WT, KO, C, B(hidden) → A, B, C, D, E, F(hidden).
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    images[0].label = 'WT'; images[1].label = 'KO'; images[3].label = 'B'; images[3].excluded = true;
    images[2].channels = [{ src: images[0].src, img: images[0].img, lut: 'green', blackPt: 0, whitePt: 255 }]; images[2].lut = 'magenta';
    const mergeId = images[2].id;
    splitChannelRow(2); render();
    return { labels: images.map(i => i.label + (i.excluded ? '(hidden)' : '')),
             mergeLabel: images.find(i => i.id === mergeId).label,
             unique: new Set(images.map(i => i.label)).size === images.length };
  });
  expect(r.labels[0]).toBe('WT');
  expect(r.labels[1]).toBe('KO');
  expect(r.labels[r.labels.length - 1]).toBe('B(hidden)');
  expect(r.mergeLabel).toBe('C');              // the merge is the panel that was there
  expect(r.labels).toEqual(['WT', 'KO', 'A', 'D', 'C', 'B(hidden)']);
  expect(r.unique).toBe(true);
  expect(errors).toEqual([]);
});

// ── R2-08 ───────────────────────────────────────────────────────────────────
test('R2-08: one drop — a 3-page TIFF and a PNG — is one undo step, grid growth included', async ({ page }) => {
  // At b1c6ec4 the drop recorded 4 steps (one per image): one Ctrl+Z took back only the
  // PNG, and the earlier edits were three more presses further away.
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const tif = Array.from(fs.readFileSync(path.join(FX, 'tiff', 'multipage.tif')));
  const r = await page.evaluate(async (tif) => {
    sv('cols', 2); sv('rows', 1); onLayoutChange();
    pushUndo(); sv('fig-title', 'before the drop');
    const png = await new Promise(res => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; c.toBlob(res, 'image/png'); });
    const d0 = undoStack.length, n0 = images.length, rows0 = gv('rows');
    await addFiles([new File([new Uint8Array(tif)], 'multipage.tif', { type: 'image/tiff' }), new File([png], 'extra.png', { type: 'image/png' })]);
    const d1 = undoStack.length, n1 = images.length, rows1 = gv('rows');
    undo();
    const afterUndo = { n: images.length, rows: gv('rows'), title: gv('fig-title') };
    redo();
    const afterRedo = { n: images.length, rows: gv('rows') };
    // A drop where nothing loads records nothing.
    const d2 = undoStack.length;
    await addFiles([new File([new Uint8Array([1, 2, 3, 4])], 'broken.png', { type: 'image/png' })]);
    return { steps: d1 - d0, n0, n1, rows0, rows1, afterUndo, afterRedo, failedDropSteps: undoStack.length - d2 };
  }, tif);
  expect(r.n1).toBe(r.n0 + 4);                 // three pages and the PNG
  expect(+r.rows1).toBeGreaterThan(+r.rows0);   // the grid grew to draw them
  expect(r.steps).toBe(1);
  expect(r.afterUndo).toEqual({ n: r.n0, rows: r.rows0, title: 'before the drop' });
  expect(r.afterRedo).toEqual({ n: r.n1, rows: r.rows1 });
  expect(r.failedDropSteps).toBe(0);
  expect(errors).toEqual([]);
});
