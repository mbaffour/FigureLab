// @ts-check
// Homogenizer, deliverable presets, token labels and duplicate row/column.
//
// Three unrelated features from the competitor survey, sharing one property: they
// replace work a scientist currently does by hand, one object or one panel at a time.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform, state } = require('./helpers');

// ── Homogenizer ───────────────────────────────────────────────

test('the homogenizer finds drifted properties and reports how many use each value', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'text', text: 'A', fontSize: 12, fontFamily: 'Arial', x: 0, y: 0, w: 50, h: 20 },
    { type: 'text', text: 'B', fontSize: 12, fontFamily: 'Arial', x: 0, y: 30, w: 50, h: 20 },
    { type: 'text', text: 'C', fontSize: 18, fontFamily: 'Georgia', x: 0, y: 60, w: 50, h: 20 },
  ]);
  const r = await page.evaluate(() => _homoScan().map(f => ({
    key: f.key, n: f.values.length, majority: f.majority, total: f.total })));
  const size = r.find(x => x.key === 'fontSize');
  const font = r.find(x => x.key === 'fontFamily');
  expect(size).toMatchObject({ n: 2, majority: 12, total: 3 });   // 12 used twice, wins
  expect(font).toMatchObject({ n: 2, majority: 'Arial', total: 3 });
  expect(errors).toEqual([]);
});

test('applying it converges every object in one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'text', text: 'A', fontSize: 12, x: 0, y: 0, w: 50, h: 20 },
    { type: 'text', text: 'B', fontSize: 18, x: 0, y: 30, w: 50, h: 20 },
    { type: 'text', text: 'C', fontSize: 24, x: 0, y: 60, w: 50, h: 20 },
  ]);
  const r = await page.evaluate(() => {
    const before = freeformElements.map(e => e.fontSize);
    const undoBefore = undoStack.length;
    auditConsistency();                       // builds the modal with the selects
    document.getElementById('homo-fontSize').value = '18';
    applyHomogenize();
    const after = freeformElements.map(e => e.fontSize);
    const undoDelta = undoStack.length - undoBefore;
    undo();
    return { before, after, undoDelta, restored: freeformElements.map(e => e.fontSize) };
  });
  expect(r.before).toEqual([12, 18, 24]);
  expect(r.after).toEqual([18, 18, 18]);
  expect(r.undoDelta).toBe(1);                // ONE step, not one per object
  expect(r.restored).toEqual([12, 18, 24]);   // and it reverses the whole sweep
  expect(errors).toEqual([]);
});

test('a figure that is already consistent says so instead of offering a no-op', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'text', text: 'A', fontSize: 12, x: 0, y: 0, w: 50, h: 20 },
    { type: 'text', text: 'B', fontSize: 12, x: 0, y: 30, w: 50, h: 20 },
  ]);
  const r = await page.evaluate(() => {
    auditConsistency();
    const m = document.getElementById('info-modal-bg');
    const t = m ? m.textContent : ''; if (m) m.remove();
    return t;
  });
  expect(r).toMatch(/Nothing to homogenize/);
  expect(errors).toEqual([]);
});

// ── Deliverable presets ───────────────────────────────────────

test('each deliverable sets the real canvas and states its caveat', async ({ page }) => {
  const errors = await loadApp(page);
  for (const [key, w, h, dpi, caveat] of [
    ['graphicalAbstract', 1328, 531, '300', /Elsevier/],
    ['tocImage', 1063, 591, '300', /do NOT accept graphical abstracts/],
    ['posterA0', 2384, 3370, '150', /print shop/],
    ['slide169', 1920, 1080, '96', /16:9/],
  ]) {
    const r = await page.evaluate((k) => {
      applyDeliverable(k);
      const m = document.getElementById('info-modal-bg');
      const t = m ? m.textContent : ''; if (m) m.remove();
      return { w: gv('fm-canvas-w'), h: gv('fm-canvas-h'), dpi: gv('export-dpi'),
               mm: gv('export-width-mm'), text: t };
    }, key);
    expect(Number(r.w)).toBe(w);
    expect(Number(r.h)).toBe(h);
    expect(r.dpi).toBe(dpi);
    expect(Number(r.mm)).toBeGreaterThan(0);   // a real physical width, not just pixels
    expect(r.text).toMatch(caveat);
  }
  expect(errors).toEqual([]);
});

// ── Token labels ──────────────────────────────────────────────

test('labels resolve from the filename fields the parser already knows', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[0].name = 'ATC_24h_GFP_r1.png';
    images[1].name = 'noATC_48h_GFP_r2.png';
    sv('fname-pattern', 'condition_time_channel_rep');
    sv('label-template', '{condition} {time}');
    applyLabelTemplate();
    return images.map(i => i.label);
  });
  expect(r).toEqual(['ATC 24h', 'noATC 48h']);
  expect(errors).toEqual([]);
});

test('positional tokens work without a named pattern', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    images[0].name = 'plate3_T7_rep1.tif';
    sv('fname-pattern', '');
    sv('label-template', '{1} {2}');
    applyLabelTemplate();
    return images[0].label;
  });
  expect(r).toBe('plate3 T7');
  expect(errors).toEqual([]);
});

test('an unknown token leaves a gap rather than printing braces into the figure', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    images[0].name = 'ATC_24h.png';
    sv('fname-pattern', 'condition_time');
    sv('label-template', '{condition} {conditon}');   // deliberate typo
    applyLabelTemplate();
    return images[0].label;
  });
  expect(r).toBe('ATC');
  expect(r).not.toMatch(/[{}]/);        // never publish a literal template token
  expect(errors).toEqual([]);
});

// ── Duplicate row / column ────────────────────────────────────

test('duplicating a row copies its panels and grows the grid', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); selectedPanel = 0; });
  const r = await page.evaluate(() => {
    const before = images.filter(Boolean).length;
    duplicateGridLine('row');
    return { before, after: images.filter(Boolean).length,
             rows: gi('rows'), cols: gi('cols'),
             // the duplicated row holds copies, not the same objects
             distinct: images[0] !== images[2] && images[0].name === images[2].name };
  });
  expect(r.after).toBe(r.before + 2);
  expect(r.rows).toBe(3);
  expect(r.cols).toBe(2);
  expect(r.distinct).toBe(true);
  expect(errors).toEqual([]);
});

test('duplicating a column grows the other axis', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 2); onLayoutChange(); selectedPanel = 0; });
  const r = await page.evaluate(() => {
    duplicateGridLine('col');
    return { n: images.filter(Boolean).length, cols: gi('cols'), rows: gi('rows') };
  });
  expect(r.n).toBe(6);
  expect(r.cols).toBe(3);
  expect(r.rows).toBe(2);
  expect(errors).toEqual([]);
});

test('duplicating is undoable', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange(); selectedPanel = 0;
    const before = images.filter(Boolean).length;
    duplicateGridLine('row');
    undo();
    return { before, after: images.filter(Boolean).length };
  });
  expect(r.after).toBe(r.before);
  expect(errors).toEqual([]);
});
