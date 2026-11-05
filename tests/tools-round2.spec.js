// @ts-check
// Round 2 of the adversarial pass on tools and editors. Two families:
//   - tools that did nothing: the Counter could not place a mark, and the ROI, profile
//     and count tools measured nothing in Grid layout (the existing measure tests call
//     measureAndShowROI() directly, which is why they passed). These are driven with the
//     real mouse here.
//   - editors that remembered a panel by its slot in images[]: the crop editor, batch
//     crop, multi-crop, the right-click menu, the 📌 toolbar, the selection, rulers.
//     Anything that changed the list while they were open made them act on another panel
//     or throw. The dialog engine now keeps Ctrl+Z from reaching the figure behind a
//     dialog, so these tests change the list the ways still open — undo() as the palette,
//     the gel dialog's ↶ and an autosave restore call it, swaps and splices — and check
//     the editor follows its panel or cancels with no undo step.
// Each test says what it saw at 1bfe83b, before the fix.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

// Logical figure coordinates → client pixels on #ann-canvas.
async function toClient(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    const lw = canvasLogicalW || c.width, lh = canvasLogicalH || c.height;
    return [r.left + x * r.width / lw, r.top + y * r.height / lh];
  }, [x, y]);
}
// Source pixel (u,v) of panel i → logical figure coordinates (exact contain-fit map).
async function srcToFig(page, i, u, v) {
  return page.evaluate(([i, u, v]) => {
    const pb = panelBounds.find(p => p.idx === i), m = _panelSourceMap(pb, images[i]);
    return [m.dx + (u - m.sx) / m.kx, m.dy + (v - m.sy) / m.ky];
  }, [i, u, v]);
}
async function dragSrc(page, i, [u0, v0], [u1, v1]) {
  const [a, b] = await srcToFig(page, i, u0, v0), [c, d] = await srcToFig(page, i, u1, v1);
  const [x0, y0] = await toClient(page, a, b), [x1, y1] = await toClient(page, c, d);
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
}
async function pickTool(page, tool) {
  await page.evaluate(t => _tutOpen(document.querySelector(`.ann-tool[data-tool="${t}"]`)), tool);
  await page.locator(`.ann-tool[data-tool="${tool}"]`).first().click();
}
// Drag a box on the crop editor's canvas with the mouse, in fractions of the image.
async function drawCropBox(page, [fx0, fy0], [fx1, fy1]) {
  await page.waitForFunction(() => document.getElementById('crop-ed-canvas').width > 0);
  const r = await page.locator('#crop-ed-canvas').boundingBox();
  await page.mouse.move(r.x + fx0 * r.width, r.y + fy0 * r.height); await page.mouse.down();
  await page.mouse.move(r.x + fx1 * r.width, r.y + fy1 * r.height, { steps: 6 }); await page.mouse.up();
}
const names = page => page.evaluate(() => images.filter(Boolean).map(im => im.name));
const crops = page => page.evaluate(() => Object.fromEntries(images.filter(Boolean).map(im => [im.name, Math.round(im.cropL)])));

test('M01: the Counter places one numbered mark per real mouse click', async ({ page }) => {
  // At 1bfe83b setTool('counter') left #ann-canvas with no pointer-events class, so the
  // clicks landed on #fig-canvas: counters 0, "Count: 0", elementFromPoint = fig-canvas.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await pickTool(page, 'counter');
  const pts = [[60, 60], [90, 70], [120, 80]];
  for (const [x, y] of pts) { const [cx, cy] = await toClient(page, x, y); await page.mouse.click(cx, cy); }
  const [cx, cy] = await toClient(page, 60, 60);
  const r = await page.evaluate(([cx, cy]) => ({
    under: document.elementFromPoint(cx, cy).id,
    marks: annotations.filter(a => a.type === 'counter').map(a => a.n),
    chip: document.getElementById('counter-display').textContent,
    undo: undoStack.length,
  }), [cx, cy]);
  expect(r.under).toBe('ann-canvas');
  expect(r.marks).toEqual([1, 2, 3]);
  expect(r.chip).toBe('Count: 3');
  expect(errors).toEqual([]);
});

test('M26: in Grid layout the ROI, profile and count tools measure a real mouse drag, with the right numbers', async ({ page }) => {
  // At 1bfe83b these drags produced measurements [] and three invisible annotations of
  // type measure-roi / measure-line / measure-count, each with an undo step.
  const errors = await loadApp(page);
  await seedPanels(page, 4);           // panel 0: grey 30 with a white 20×20 square at (10,10)
  // Panel letters are drawn onto the figure and would count as a blob; this is about the pixels.
  await page.evaluate(() => { sc('show-labels', false); render(); });
  expect(await page.evaluate(() => layoutMode)).toBe('grid');
  const undo0 = await page.evaluate(() => undoStack.length);

  await pickTool(page, 'measure-roi');
  await dragSrc(page, 0, [50, 50], [90, 90]);          // the plain grey part
  await dragSrc(page, 0, [12, 12], [28, 28]);          // inside the white square
  await pickTool(page, 'measure-line');
  await dragSrc(page, 0, [45, 70], [95, 70]);          // a row through grey only
  await pickTool(page, 'measure-count');
  await dragSrc(page, 0, [2, 2], [98, 98]);            // the whole picture: one bright blob

  const r = await page.evaluate(() => ({
    types: measurements.map(m => m.type),
    roiMeans: measurements.filter(m => m.type === 'roi').map(m => +m.meanGray),
    profile: (measurements.find(m => m.type === 'lineProfile') || { values: '' }).values.split(',').map(Number),
    count: (measurements.find(m => m.type === 'cellCount') || {}).count,
    shown: document.getElementById('roi-results').className,
    junk: annotations.map(a => a.type),
    undo: undoStack.length,
  }));
  expect(r.types).toEqual(['roi', 'roi', 'lineProfile', 'cellCount']);
  expect(r.roiMeans[0]).toBeCloseTo(30, 0);
  expect(r.roiMeans[1]).toBeCloseTo(255, 0);
  expect(r.profile.length).toBeGreaterThan(10);
  expect(Math.min(...r.profile)).toBeGreaterThanOrEqual(29);
  expect(Math.max(...r.profile)).toBeLessThanOrEqual(31);
  expect(r.count).toBe(1);
  expect(r.shown).toBe('show');
  expect(r.junk).toEqual([]);                            // nothing stored as an annotation
  // One undo step per measurement, none for a junk annotation. The undo snapshot holds
  // the measurements, so a measurement that recorded no step was dropped by the next
  // Ctrl+Z together with the unrelated edit before it (undo-round2.spec.js).
  expect(r.undo).toBe(undo0 + r.types.length);
  expect(errors).toEqual([]);
});

test('M02: the crop editor’s panel removed behind it — Apply cancels with no undo step and the redo stays', async ({ page }) => {
  // At 1bfe83b Apply pushed its undo step first (emptying redo) and then threw
  // "Cannot set properties of undefined (setting 'cropT')": panel D was unrecoverable.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { renderImgList(); });
  await page.evaluate(() => _tutDrawer(3));
  await page.locator('#img-list [data-opencrop]').nth(3).click();   // the crop editor on panel D, from its drawer
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  await page.evaluate(() => undo());           // the last step was adding D: the palette's "Undo" does this
  const mid = await page.evaluate(() => ({ n: images.filter(Boolean).length, redo: redoStack.length, undo: undoStack.length }));
  expect(mid.n).toBe(3);
  await drawCropBox(page, [0.2, 0.2], [0.7, 0.7]);
  await page.click('#crop-apply-btn');
  const after = await page.evaluate(() => ({ open: document.getElementById('crop-modal').classList.contains('open'),
    redo: redoStack.length, undo: undoStack.length, toast: document.getElementById('toast').textContent,
    crops: images.filter(Boolean).map(im => im.cropL) }));
  expect(after.open).toBe(false);
  expect(after.toast).toMatch(/no longer in the figure/);
  expect(after.undo).toBe(mid.undo);           // no step for an Apply that did nothing
  expect(after.redo).toBe(mid.redo);           // …so D is still one redo away
  expect(after.crops).toEqual([0, 0, 0]);
  await page.evaluate(() => redo());
  expect(await names(page)).toEqual(['panel0.png', 'panel1.png', 'panel2.png', 'panel3.png']);
  expect(errors).toEqual([]);
});

test('M03: the panel moves behind the crop editor — Apply crops the photo on screen, not the slot', async ({ page }) => {
  // At 1bfe83b the crop landed on panel0.png (now in slot 0) and panel1.png, the one
  // shown in the editor, stayed uncropped.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { pushUndo(); swapImages(0, 1); renderImgList(); render(); });   // slot 0 = panel1
  await page.evaluate(() => _tutDrawer(0));
  await page.locator('#img-list [data-opencrop]').first().click();
  expect(await page.evaluate(() => cropEdState.img === images[0].img && images[0].name)).toBe('panel1.png');
  await page.evaluate(() => undo());           // un-swaps: panel1 is back in slot 1
  await drawCropBox(page, [0.25, 0.25], [0.75, 0.75]);
  await page.click('#crop-apply-btn');
  const c = await crops(page);
  expect(c['panel1.png']).toBeGreaterThan(20);
  expect(c['panel0.png']).toBe(0);
  expect(errors).toEqual([]);
});

test('M04/M28: batch crop follows its images by id, and Apply with no box spends no undo step', async ({ page }) => {
  // At 1bfe83b (a) an Apply before any box was drawn pushed an undo step and emptied
  // redo; (b) after two undos behind the editor, Apply & Next cropped panel1.png while the
  // editor was showing panel0.png.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { pushUndo(); images[0].label = 'X'; undo(); });   // one redo step
  await page.evaluate(() => startBatchCrop());
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  const a0 = await page.evaluate(() => [undoStack.length, redoStack.length]);
  await page.click('#crop-apply-btn');                                         // nothing drawn
  expect(await page.evaluate(() => [undoStack.length, redoStack.length])).toEqual(a0);
  await page.evaluate(() => closeCropModal());

  await page.evaluate(() => { undoStack = []; redoStack = []; pushUndo(); swapImages(0, 1); renderImgList(); render(); });
  await page.evaluate(() => startBatchCrop());
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  await drawCropBox(page, [0.2, 0.2], [0.6, 0.6]);
  await page.click('#crop-apply-btn');                      // crops panel1 (slot 0), shows slot 1 = panel0
  const shown = await page.evaluate(() => images.find(im => im.img === cropEdState.img).name);
  expect(shown).toBe('panel0.png');
  await page.evaluate(() => { undo(); undo(); });           // undo that crop, then the swap
  await page.click('#crop-apply-btn');                      // Apply & Next on panel0.png
  const c = await crops(page);
  expect(c['panel0.png']).toBeGreaterThan(10);
  expect(c['panel1.png']).toBe(0);
  await page.evaluate(() => closeCropModal());
  expect(errors).toEqual([]);
});

test('M04: multi-crop cuts its regions from the image they were drawn on, after the slots change', async ({ page }) => {
  // At 1bfe83b Finish cut the region from panel0.png (now at the remembered slot) and
  // left panel1.png — the image the region was drawn on — untouched.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { pushUndo(); swapImages(0, 1); renderImgList(); render(); });
  await page.evaluate(() => startMultiCrop([0]));
  await expect(page.locator('#crop-modal')).toHaveClass(/open/);
  expect(await page.evaluate(() => mcSession.cur.name)).toBe('panel1.png');
  await drawCropBox(page, [0.1, 0.1], [0.5, 0.5]);
  await page.click('#crop-apply-btn');                      // bank the region
  await page.evaluate(() => undo());                        // un-swap behind the editor
  await page.evaluate(() => mcFinishNow());
  const r = await page.evaluate(() => images.filter(Boolean).map(im => ({ name: im.name, cropL: Math.round(im.cropL) })));
  const cut = r.filter(p => p.cropL > 0);
  expect(cut.map(p => p.name)).toEqual(['panel1.png']);     // cut from the image it was drawn on
  expect(r.map(p => p.name).filter(n => n === 'panel0.png')).toHaveLength(1);   // panel0 kept, uncut
  expect(r.find(p => p.name === 'panel0.png').cropL).toBe(0);
  expect(errors).toEqual([]);
});

test('M18: the panel menu closes on Ctrl+Z, and acts on the panel it was opened on', async ({ page }) => {
  // At 1bfe83b the menu stayed open over the undo and "Remove panel" removed panel0.png
  // although panel1.png had been right-clicked.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { pushUndo(); swapImages(0, 1); renderImgList(); render(); });
  const pb = await page.evaluate(() => panelBounds.find(p => p.idx === 0));
  const [cx, cy] = await toClient(page, pb.x + pb.w / 2, pb.y + pb.h / 2);
  await page.mouse.click(cx, cy, { button: 'right' });
  await expect(page.locator('#panel-ctx-menu')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#panel-ctx-menu')).toHaveCount(0);

  // Open it again on panel1.png, and move the panels by another route while it is up.
  await page.evaluate(() => { pushUndo(); swapImages(0, 1); renderImgList(); render(); });
  await page.mouse.click(cx, cy, { button: 'right' });
  await page.evaluate(() => { swapImages(0, 1); render(); });   // e.g. a drag-reorder elsewhere
  const undo0 = await page.evaluate(() => undoStack.length);
  await page.locator('#panel-ctx-menu div', { hasText: 'Remove panel' }).click();
  expect(await names(page)).toEqual(['panel0.png', 'panel2.png', 'panel3.png']);
  expect(await page.evaluate(() => undoStack.length)).toBe(undo0 + 1);

  // …and if its panel has gone, the item says so and changes nothing.
  await page.mouse.click(cx, cy, { button: 'right' });            // panel0.png
  await page.evaluate(() => { images.splice(0, 1); render(); });
  const undo1 = await page.evaluate(() => undoStack.length);
  await page.locator('#panel-ctx-menu div', { hasText: 'Remove panel' }).click();
  expect(await names(page)).toEqual(['panel2.png', 'panel3.png']);
  expect(await page.evaluate(() => undoStack.length)).toBe(undo1);
  expect(await page.locator('#toast').textContent()).toMatch(/no longer in the figure/);
  expect(errors).toEqual([]);
});

test('M11: the 📌 toolbar keeps editing the mark it opened on after earlier panels are removed', async ({ page }) => {
  // At 1bfe83b, after removing panel A, width 9 went to panel D's arrow, and after a second
  // removal the toolbar threw "Cannot read properties of undefined (reading 'panelAnns')".
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => {
    images[2].panelAnns = [{ type: 'arrow', xf: .1, yf: .1, x2f: .6, y2f: .6, color: '#ffffff', width: 2 }];
    images[3].panelAnns = [{ type: 'arrow', xf: .2, yf: .7, x2f: .7, y2f: .2, color: '#ffffff', width: 2 }];
    if (!panelAnnMode) togglePanelAnnMode(); setTool('none'); renderImgList(); render();
  });
  const pb = await page.evaluate(() => panelBounds.find(p => p.idx === 2));
  const [cx, cy] = await toClient(page, pb.x + 0.35 * pb.w, pb.y + 0.35 * pb.h);
  await page.mouse.click(cx, cy);                           // select C's arrow
  await expect(page.locator('#ann-float')).toBeVisible();
  await page.locator('#img-list .img-item [data-del]').first().click();    // remove A
  await page.locator('#ann-float-width').fill('9');
  await page.locator('#ann-float-width').dispatchEvent('input');
  let w = await page.evaluate(() => Object.fromEntries(images.map(im => [im.name, (im.panelAnns || []).map(a => a.width)])));
  expect(w['panel2.png']).toEqual([9]);
  expect(w['panel3.png']).toEqual([2]);
  await page.locator('#img-list .img-item [data-del]').first().click();    // remove B
  await page.locator('#ann-float-width').fill('5');
  await page.locator('#ann-float-width').dispatchEvent('input');
  w = await page.evaluate(() => Object.fromEntries(images.map(im => [im.name, (im.panelAnns || []).map(a => a.width)])));
  expect(w['panel2.png']).toEqual([5]);
  expect(w['panel3.png']).toEqual([2]);
  // Remove C itself: the selection and the toolbar go with it.
  await page.locator('#img-list .img-item [data-del]').first().click();
  await page.locator('#ann-float-width').dispatchEvent('input');
  expect(await page.evaluate(() => [selectedPanelAnn, document.getElementById('ann-float').style.display])).toEqual([null, 'none']);
  expect(await page.evaluate(() => images[0].panelAnns.map(a => a.width))).toEqual([2]);
  expect(errors).toEqual([]);
});

test('M22: Ctrl+Z during a tutorial ends it, so its steps never act on your own figure', async ({ page }) => {
  // At 1bfe83b Ctrl+Z brought the user's panels back with the tutorial still running;
  // "Do it for me" then cropped and tilted the user's panel0.png.
  const errors = await loadApp(page);
  page.on('dialog', d => d.accept());
  await seedPanels(page, 4);
  await page.evaluate(async () => { await startTutorial('straighten'); });
  await expect(page.locator('#tour-ov')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  const r = await page.evaluate(() => ({ tut: _tut, ov: !!document.getElementById('tour-ov'),
    names: images.filter(Boolean).map(im => im.name), toast: document.getElementById('toast').textContent }));
  expect(r.tut).toBeNull();
  expect(r.ov).toBe(false);
  expect(r.names).toEqual(['panel0.png', 'panel1.png', 'panel2.png', 'panel3.png']);
  expect(r.toast).toMatch(/Tutorial .* ended/);
  expect(await page.evaluate(() => images.map(im => [im.cropL, im.cropAngle || 0]))).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  expect(errors).toEqual([]);
});

test('S1-01: Duplicate row gives the copies their own ids and letters; duplicate ids from a file are split on load', async ({ page }) => {
  // At 1bfe83b the copies shared the originals' ids (and letters A, B, A, B).
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { sv('cols', 2); sv('rows', 1); onLayoutChange(); selectedPanel = 0; duplicateGridLine('row'); });
  const r = await page.evaluate(() => ({ ids: new Set(images.map(im => im.id)).size, labels: images.map(im => im.label) }));
  expect(r.ids).toBe(4);
  expect(r.labels).toEqual(['A', 'B', 'C', 'D']);
  // A session saved by an older build, carrying the shared ids, is de-duplicated when it loads.
  const ids = await page.evaluate(async () => {
    const s = serializeSession(true);
    s.images[2].id = s.images[0].id; s.images[3].id = s.images[1].id;
    await applySession(s);
    await new Promise(r => setTimeout(r, 300));
    return images.map(im => im.id);
  });
  expect(ids).toHaveLength(4);
  expect(new Set(ids).size).toBe(4);
  expect(errors).toEqual([]);
});

test('LV-01: the selection stays on its panel when an earlier panel is removed, through undo and shortcuts', async ({ page }) => {
  // At 1bfe83b deleting p0 moved the selection to the next panel, undo kept it there, and
  // ] then turned that panel instead of the one selected.
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  await page.evaluate(() => { sv('cols', 3); sv('rows', 2); onLayoutChange(); setTool('none'); renderImgList(); render(); });
  const pb = await page.evaluate(() => panelBounds.find(p => p.idx === 3));
  const [cx, cy] = await toClient(page, pb.x + pb.w / 2, pb.y + pb.h / 2);
  await page.mouse.click(cx, cy);
  expect(await page.evaluate(() => images[selectedPanel].name)).toBe('panel3.png');
  await page.locator('#img-list .img-item [data-del]').first().click();       // remove panel0
  expect(await page.evaluate(() => images[selectedPanel].name)).toBe('panel3.png');
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => images[selectedPanel].name)).toBe('panel3.png');
  await page.locator('#img-list .img-item [data-del]').first().click();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press(']');
  const turned = await page.evaluate(() => images.filter(im => im.rotate || im.cropAngle).map(im => im.name));
  expect(turned).toEqual(['panel3.png']);
  // Removing the selected panel itself clears the selection rather than passing it on.
  await page.evaluate(() => { const i = selectedPanel; images.splice(i, 1); renderImgList(); });
  expect(await page.evaluate(() => selectedPanel)).toBe(-1);
  expect(errors).toEqual([]);
});

test('RUL-03: a ruler drawn on one image stops measuring when another image takes its place', async ({ page }) => {
  // At 1bfe83b, after swapping B and C the ruler read "C 800 nm" (C's pixels at C's
  // calibration) with no notice; it was drawn on B as 200 nm.
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => { images[0].umPerPx = 0.002; images[1].umPerPx = 0.001; images[2].umPerPx = 0.004;
    sv('cols', 3); sv('rows', 1); onLayoutChange(); render(); });
  await pickTool(page, 'ruler');
  await dragSrc(page, 1, [20, 50], [80, 50]);              // 60 source px on panel1 at 1 nm/px
  const m0 = await page.evaluate(() => { const m = _rulerMeasure(annotations.find(a => a.type === 'ruler')); return [m.status, m.label, m.im && m.im.name]; });
  expect(m0[0]).toBe('ok');
  expect(m0[2]).toBe('panel1.png');
  expect(m0[1]).toMatch(/^6\d nm$/);
  await page.evaluate(() => { pushUndo(); swapImages(1, 2); render(); });
  const m1 = await page.evaluate(() => { const m = _rulerMeasure(annotations.find(a => a.type === 'ruler')); return [m.status, m.label, m.note]; });
  expect(m1).toEqual(['moved', '', 'moved off its panel']);
  await page.evaluate(() => { swapImages(1, 2); render(); });
  const m2 = await page.evaluate(() => _rulerMeasure(annotations.find(a => a.type === 'ruler')).label);
  expect(m2).toBe(m0[1]);
  expect(errors).toEqual([]);
});

test('UX-01: the gel dialog follows the dialog engine — a drag out does not close it, Escape closes the top dialog', async ({ page }) => {
  // At 1bfe83b a text-selection drag released on the backdrop closed the gel dialog, and
  // Escape with an info box on top of it closed the gel dialog underneath.
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    const src = _tutMakeImage('blotWide', 1);
    await new Promise(r => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'blot.png'); r(); }; img.src = src; });
    render();
  });
  expect(await page.evaluate(() => openGelAnalysis(0))).toBe(true);
  const f = await page.locator('#gel-ladder-sizes').boundingBox();
  await page.mouse.move(f.x + 20, f.y + f.height / 2); await page.mouse.down();
  const vp = page.viewportSize();
  await page.mouse.move(vp.width - 4, vp.height - 4, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('#gel-modal-bg')).toHaveCount(1);
  await page.evaluate(() => showInfoModal('On top', '<p>a second dialog</p>'));
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => _dialogList().map(e => e.id))).toEqual(['gel-modal-bg']);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => [_dialogList().length, _gelUI])).toEqual([0, null]);
  expect(errors).toEqual([]);
});
