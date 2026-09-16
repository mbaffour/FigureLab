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

test('typed column and row headings survive a resize, a hide and an undo', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    const colVals = () => [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value);
    const rowVals = () => [...document.querySelectorAll('#row-label-inputs input')].map(i => i.value);
    sv('cols', 3); sv('rows', 2);
    sc('show-col-labels', true); sc('show-row-labels', true); onLayoutChange();
    const type = (sel, vals) => [...document.querySelectorAll(sel)].forEach((inp, i) => { if (vals[i]) inp.value = vals[i]; });
    type('#col-label-inputs input', ['0 h', '6 h', '24 h']);
    type('#row-label-inputs input', ['WT', 'ΔfliC']);

    // grow the grid: the new column is a placeholder, the three typed ones are not
    sv('cols', 4); onLayoutChange();
    const afterGrow = colVals();
    // and shrink back
    sv('cols', 3); onLayoutChange();
    const afterShrink = colVals();

    // hide the headings and show them again — the inputs are destroyed in between
    toggleAllLabels(); const whileHidden = colVals().length;
    toggleAllLabels();
    const afterToggle = { col: colVals(), row: rowVals() };

    // what an export would draw
    const drawn = { col: axisLabelValues('col').slice(0, 3), row: axisLabelValues('row').slice(0, 2) };

    // and an undo of something else must not take them with it
    pushUndo(); sv('gap-h', 30); onLayoutChange(); undo();
    const afterUndo = colVals();
    return { afterGrow, afterShrink, whileHidden, afterToggle, drawn, afterUndo };
  });
  expect(r.afterGrow).toEqual(['0 h', '6 h', '24 h', 'Col 4']);
  expect(r.afterShrink).toEqual(['0 h', '6 h', '24 h']);
  expect(r.whileHidden).toBe(0);
  expect(r.afterToggle.col).toEqual(['0 h', '6 h', '24 h']);
  expect(r.afterToggle.row).toEqual(['WT', 'ΔfliC']);
  expect(r.drawn.col).toEqual(['0 h', '6 h', '24 h']);
  expect(r.drawn.row).toEqual(['WT', 'ΔfliC']);
  expect(r.afterUndo).toEqual(['0 h', '6 h', '24 h']);
  expect(errors).toEqual([]);
});

test('a saved session round-trips headings that are hidden at save time', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 2);
    sc('show-col-labels', true); onLayoutChange();
    [...document.querySelectorAll('#col-label-inputs input')].forEach((inp, i) => { inp.value = ['pH 5', 'pH 7'][i]; });
    sc('show-col-labels', false); onLayoutChange();          // hidden — no inputs exist
    const saved = captureLayout();
    setAxisLabels('col', ['x', 'y']);                        // clobber, then restore
    applyLayoutSnapshot(saved);
    sc('show-col-labels', true); onLayoutChange();
    return {
      saved: saved.colLabels,
      restored: [...document.querySelectorAll('#col-label-inputs input')].map(i => i.value),
    };
  });
  expect(r.saved).toEqual(['pH 5', 'pH 7']);
  expect(r.restored).toEqual(['pH 5', 'pH 7']);
  expect(errors).toEqual([]);
});

test('the per-panel adjustment buttons are undoable', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    const open = () => {
      const item = document.querySelectorAll('.img-item')[0];
      item.querySelector('.gear-btn, [class*=gear]')?.click();
      return item;
    };
    const item = open();
    const im = () => images[0];
    im().brightness = 1.6; im().contrast = 1.4; im().gamma = 0.7; im().lut = 'green';
    const before = { br: im().brightness, ct: im().contrast, gm: im().gamma, lut: im().lut };

    item.querySelector('.f-gray').click();
    const greyOn = im().grayscale;
    undo();
    const greyUndone = images[0].grayscale;

    item.querySelector('.f-inv').click();
    const invOn = images[0].invert;
    undo();
    const invUndone = images[0].invert;

    // Reset wipes seven settings at once — by far the most destructive of the three
    document.querySelectorAll('.img-item')[0].querySelector('.f-reset').click();
    const wiped = { br: images[0].brightness, lut: images[0].lut };
    undo();
    const restored = { br: images[0].brightness, ct: images[0].contrast, gm: images[0].gamma, lut: images[0].lut };
    return { before, greyOn, greyUndone, invOn, invUndone, wiped, restored };
  });
  expect(r.greyOn).toBe(true);   expect(r.greyUndone).toBe(false);
  expect(r.invOn).toBe(true);    expect(r.invUndone).toBe(false);
  expect(r.wiped.br).toBe(1);    expect(r.wiped.lut).toBe('none');
  expect(r.restored).toEqual(r.before);
  expect(errors).toEqual([]);
});

test('one press of undo undoes a typed panel tilt', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    const item = document.querySelectorAll('.img-item')[0];
    const rd = item.querySelector('.f-rotdeg');
    rd.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));   // arms the snapshot
    rd.value = '12';
    rd.dispatchEvent(new Event('input', { bubbles: true }));
    rd.dispatchEvent(new Event('change', { bubbles: true }));
    const tilted = images[0].rotate;
    undo();
    return { tilted, afterOneUndo: images[0].rotate };
  });
  expect(r.tilted).toBe(12);
  expect(r.afterOneUndo).toBe(0);
  expect(errors).toEqual([]);
});

test('a group band generator does not destroy the names you typed', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 3); onLayoutChange();
    sv('group-axis', 'row'); sv('group-block', 1);
    _grpFromBlocksUI();
    figGroups.forEach((g, i) => { g.label = ['untreated', '+ATc', '+ATc +IPTG'][i]; });
    renderGroupList();
    const named = figGroups.map(g => g.label);

    // re-running the generator with the same block size must keep those names
    _grpFromBlocksUI();
    const afterRerun = figGroups.map(g => g.label);

    // and a generator that genuinely replaces them must be undoable
    sv('group-block', 3); _grpFromBlocksUI();
    const replaced = figGroups.map(g => g.label);
    undo();
    const afterUndo = figGroups.map(g => g.label);
    const listRows = document.querySelectorAll('#group-list [data-glabel]').length;

    return { named, afterRerun, replaced, afterUndo, listRows };
  });
  expect(r.named).toEqual(['untreated', '+ATc', '+ATc +IPTG']);
  expect(r.afterRerun).toEqual(['untreated', '+ATc', '+ATc +IPTG']);
  expect(r.replaced).toEqual(['']);                // one band over all three rows
  expect(r.afterUndo).toEqual(['untreated', '+ATc', '+ATc +IPTG']);
  expect(r.listRows).toBe(3);                      // the editor shows them again too
  expect(errors).toEqual([]);
});

test('panels arrive in the order the files were picked, not the order they decode', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    // A big noisy bitmap takes far longer to decode than a 2 px one. Picked first,
    // it used to land last, and with it the panel letter A.
    const mk = (side, seed) => new Promise(res => {
      const c = document.createElement('canvas'); c.width = c.height = side;
      const x = c.getContext('2d'), d = x.createImageData(side, side);
      let s = seed;
      for (let i = 0; i < d.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;      // noise defeats PNG compression
        d.data[i] = s & 255; d.data[i + 1] = (s >> 8) & 255; d.data[i + 2] = (s >> 16) & 255; d.data[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      c.toBlob(b => res(b), 'image/png');
    });
    const files = [
      new File([await mk(900, 1)], 'first_big.png', { type: 'image/png' }),
      new File([await mk(4, 2)], 'second.png', { type: 'image/png' }),
      new File([await mk(4, 3)], 'third.png', { type: 'image/png' }),
      new File([await mk(4, 4)], 'fourth.png', { type: 'image/png' }),
    ];
    await addFiles(files);
    return {
      names: images.map(im => im.name),
      labels: images.map(im => im.label),
    };
  });
  expect(r.names).toEqual(['first_big.png', 'second.png', 'third.png', 'fourth.png']);
  expect(r.labels).toEqual(['A', 'B', 'C', 'D']);
  expect(errors).toEqual([]);
});

test('relabelling with a panel hidden does not create two panels with the same letter', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    togglePanelExcluded(1);                 // hide B
    relabelPanels();
    const labels = images.map(im => im.label);
    const visible = images.filter(im => !im.excluded).map(im => im.label);
    togglePanelExcluded(1);                 // show it again
    const shown = images.map(im => im.label);
    return { labels, visible, dupes: labels.length - new Set(labels).size, shown };
  });
  expect(r.visible).toEqual(['A', 'B', 'C']);   // the reader sees no gaps
  expect(r.dupes).toBe(0);                      // and nothing is lettered twice
  expect(new Set(r.shown).size).toBe(4);
  expect(errors).toEqual([]);
});

test('blot furniture lands on the blot, not on the whole sheet', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate(async () => {
    sv('cols', 3); sv('rows', 2); onLayoutChange(); render();
    selectedPanel = 4;                                     // bottom-middle panel
    const b = panelBounds.find(p => p.idx === 4);
    const W = annCanvas.width, H = annCanvas.height;
    const box = { l: (b.ix != null ? b.ix : b.x) / W, t: (b.iy != null ? b.iy : b.y) / H,
                  r: ((b.ix != null ? b.ix : b.x) + (b.iw != null ? b.iw : b.w)) / W,
                  bt: ((b.iy != null ? b.iy : b.y) + (b.ih != null ? b.ih : b.h)) / H };

    window.prompt = () => '4';
    addLaneLabels();
    const lanes = annotations.filter(a => a.type === 'text').map(a => ({ x: a.xf, y: a.yf }));

    window.prompt = () => '250,100,25';
    addLadderLabels();
    const mw = annotations.filter(a => a.type === 'text').slice(4).map(a => ({ x: a.xf, y: a.yf }));

    addSpliceMarker();
    const line = annotations.find(a => a.type === 'line');
    return { box, lanes, mw, line, panelCount: panelBounds.length };
  });
  // Lane numbers: spread across the panel's width, at or just above its top edge
  for (const l of r.lanes) {
    expect(l.x).toBeGreaterThan(r.box.l); expect(l.x).toBeLessThan(r.box.r);
    expect(l.y).toBeGreaterThan(r.box.t - 0.08); expect(l.y).toBeLessThan(r.box.t + 0.1);
  }
  expect(r.lanes[0].x).toBeLessThan(r.lanes[3].x);
  // MW weights: down the panel's own height, at or just left of its left edge
  for (const m of r.mw) {
    expect(m.x).toBeGreaterThan(r.box.l - 0.08); expect(m.x).toBeLessThan(r.box.l + 0.1);
    expect(m.y).toBeGreaterThan(r.box.t); expect(m.y).toBeLessThan(r.box.bt);
  }
  expect(r.mw[0].y).toBeLessThan(r.mw[2].y);
  // Splice marker: vertical, inside the panel, not bisecting the figure
  expect(r.line.xf).toBe(r.line.x2f);
  expect(r.line.xf).toBeGreaterThan(r.box.l); expect(r.line.xf).toBeLessThan(r.box.r);
  expect(r.line.yf).toBeGreaterThan(r.box.t - 0.01); expect(r.line.y2f).toBeLessThan(r.box.bt + 0.01);
  expect(errors).toEqual([]);
});
