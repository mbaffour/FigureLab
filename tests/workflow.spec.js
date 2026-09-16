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

test('rows hug their panels, so a blot stack has no dead space', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const blot = (w, h, name) => new Promise(res => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#000';
      for (let i = 0; i < 4; i++) x.fillRect(w * (0.1 + i * 0.22), h * 0.3, w * 0.12, h * 0.3);
      const src = c.toDataURL('image/png');
      const img = new Image(); img.onload = () => { _commitImage(img, src, name); res(); }; img.src = src;
    });
    await blot(600, 180, 'target.png');          // the blot
    await blot(600, 90, 'loading.png');          // the loading control, half as tall
    sv('cols', 1); sv('rows', 2); sv('gap-v', 4); onLayoutChange(); render();

    const box = () => panelBounds.map(p => ({ cell: [p.y, p.h], ink: [p.iy, p.ih] }));
    const off = box();
    const offH = canvasLogicalH || document.getElementById('fig-canvas').height;

    sc('auto-row-h', true); render();
    const on = box();
    const onH = canvasLogicalH || document.getElementById('fig-canvas').height;
    return { off, on, offH, onH, ink: panelBounds.map(p => [p.ix, p.iw]) };
  });
  // Uniform rows: 90 px and 45 px of ink floating in 300 px cells
  expect(r.off[0].cell[1]).toBe(300);
  expect(r.off[1].cell[1]).toBe(300);
  expect(r.off[0].ink[1]).toBeLessThan(150);

  // Hugging: each cell collapses onto its own panel, within a pixel of rounding
  expect(Math.abs(r.on[0].cell[1] - r.on[0].ink[1])).toBeLessThanOrEqual(1);
  expect(Math.abs(r.on[1].cell[1] - r.on[1].ink[1])).toBeLessThanOrEqual(1);
  // the two rows are genuinely different heights now
  expect(r.on[0].cell[1]).toBeGreaterThan(r.on[1].cell[1] + 20);
  // the panels sit one above the other with only the v-gap between them
  expect(r.on[1].cell[0] - (r.on[0].cell[0] + r.on[0].cell[1])).toBe(4);
  // ink still registers horizontally, and the figure got shorter, not wider
  expect(r.ink[0]).toEqual(r.ink[1]);
  expect(r.onH).toBeLessThan(r.offH);
  expect(errors).toEqual([]);
});

test('hugging rows keeps the headings, bands, gutters and export in step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    // two panels of very different shape, so the two rows end up different heights
    const reshape = (im, w, h) => new Promise(res => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, w, h);
      const src = c.toDataURL('image/png');
      const img = new Image(); img.onload = () => { im.img = img; im.src = src; res(); }; img.src = src;
    });
    images.length = 2;
    await reshape(images[0], 600, 150);
    await reshape(images[1], 300, 300);
    sv('cols', 1); sv('rows', 2); sv('gap-v', 10);
    sc('show-row-labels', true); onLayoutChange();
    setAxisLabels('row', ['anti-FLAG', 'anti-GAPDH']);
    figGroups = [{ axis: 'row', from: 1, to: 2, label: 'lysate' }];
    sc('auto-row-h', true); render();

    const cells = panelBounds.map(p => ({ y: p.y, h: p.h }));
    const rowLbls = figTextItems.filter(t => t.kind === 'row').map(t => ({ i: t.idx, y: t.y }));
    const band = figTextItems.find(t => t.kind === 'group');
    const G = gridGeom();
    // the gutter between the two rows, probed where it actually sits now
    const midY = cells[0].y + cells[0].h + 5;
    const hit = gutterAtPoint(G.x0 + G.gridW / 2, midY);

    // exporting must use the same geometry
    const ex = renderExportCanvas(300);
    const ratio = ex.height / (canvasLogicalH || document.getElementById('fig-canvas').height);
    return { cells, rowLbls, band: band ? band.y : null, hit: hit && { axis: hit.axis, index: hit.index }, gridH: G.gridH, ratio };
  });
  expect(r.cells[0].h).not.toBe(r.cells[1].h);            // the rows really do differ
  // each row heading sits inside its own row, not at the uniform-grid position
  expect(r.rowLbls[0].y).toBeGreaterThan(r.cells[0].y);
  expect(r.rowLbls[0].y).toBeLessThan(r.cells[0].y + r.cells[0].h);
  expect(r.rowLbls[1].y).toBeGreaterThan(r.cells[1].y);
  expect(r.rowLbls[1].y).toBeLessThan(r.cells[1].y + r.cells[1].h);
  // the group band spans both rows, so it centres between them
  expect(r.band).toBeGreaterThan(r.cells[0].y);
  expect(r.band).toBeLessThan(r.cells[1].y + r.cells[1].h);
  // the row gutter is findable where the shrunken rows put it
  expect(r.hit).toEqual({ axis: 'row', index: 1 });
  expect(r.gridH).toBeCloseTo(r.cells[0].h + 10 + r.cells[1].h, 0);
  expect(r.ratio).toBeGreaterThan(1);                      // export scaled, not reshaped
  expect(errors).toEqual([]);
});

test('the caption, CSV, compliance and manifest describe the panels the figure draws', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate(async () => {
    sv('cols', 3); sv('rows', 2); onLayoutChange();
    images.forEach((im, i) => { im.captionNote = `note for ${im.name}`; });
    togglePanelExcluded(1);                       // hide the second panel…
    togglePanelExcluded(4);                       // …and the fifth
    relabelPanels();

    // capture the CSV instead of downloading it
    let csv = '';
    const realBlobUrl = window.blobUrl, realDl = window.dl;
    window.blobUrl = t => { csv = t; return 'blob:stub'; };
    window.dl = () => {};
    exportCSV();
    window.blobUrl = realBlobUrl; window.dl = realDl;

    generateCaption();
    const caption = document.getElementById('caption-out').value;

    checkCompliance();
    const report = (document.querySelector('#info-modal-bg') || document.body).textContent;
    const labelLine = (report.match(/[^✓✗⚠]*panels? labelled[^✓✗⚠]*/i) || [''])[0].trim();
    document.querySelector('#info-modal-bg')?.remove();

    const shown = _figurePanels();
    return {
      shownNames: shown.map(im => im.name),
      shownLabels: shown.map(im => im.label),
      csvRows: csv.split('\n').slice(1).filter(Boolean).map(l => l.split(',')[0]),
      csvNames: csv.split('\n').slice(1).filter(Boolean).map(l => l.split(',')[1]),
      caption, labelLine,
      manifestPanels: _packageManifest('fig', 300, [], 'hash', []).match(/Panels\s*:\s*(\d+)/)?.[1],
    };
  });
  // the figure draws four panels: the two hidden ones are out, and panel 6 —
  // which used to fall off the end of images.slice(0, cols*rows) — is back in
  expect(r.shownNames).toEqual(['panel0.png', 'panel2.png', 'panel3.png', 'panel5.png']);
  expect(r.shownLabels).toEqual(['A', 'B', 'C', 'D']);

  // the CSV numbers them 1..4 with no gap, and names only those four
  expect(r.csvRows).toEqual(['1', '2', '3', '4']);
  expect(r.csvNames).toEqual(r.shownNames);

  // the caption describes four panels and never mentions a hidden one
  expect(r.caption).toContain('note for panel0.png');
  expect(r.caption).toContain('note for panel5.png');
  expect(r.caption).not.toContain('note for panel1.png');
  expect(r.caption).not.toContain('note for panel4.png');

  // and the compliance report counts what the reader will see
  expect(r.labelLine).toMatch(/\b4\s*\/\s*4\b/);
  expect(r.manifestPanels).toBe('4');
  expect(errors).toEqual([]);
});

test('every plane of an OME-TIFF is calibrated, not just the first', async ({ page }) => {
  const errors = await loadApp(page);
  const bytes = Array.from(require('fs').readFileSync(
    require('path').join(__dirname, 'fixtures', 'tiff', 'cal_ome_multi.ome.tif')));
  const r = await page.evaluate(async (b) => {
    // OME-TIFF carries PhysicalSizeX in PAGE 0's description only, and this file
    // has no usable resolution tags — which is what tifffile and Bio-Formats emit.
    await addFiles([new File([new Uint8Array(b)], 'series.ome.tif', { type: 'image/tiff' })]);
    await new Promise(r => setTimeout(r, 400));
    return images.filter(Boolean).map(im => ({
      um: im.umPerPx, src: im._metaCalibSource, sbOn: im.sbOn, dt: im._metaDeltaT,
    }));
  }, bytes);
  expect(r).toHaveLength(3);
  for (const p of r) {
    expect(p.um).toBeCloseTo(0.25, 6);          // every plane, not just plane 1
    expect(p.src).toBe('OME-TIFF');             // and from the same reader, so no silent fallback
  }
  // the per-plane times are still per-plane — the page-0 fallback must not flatten them
  expect(r.map(p => p.dt)).toEqual([0, 30, 60]);
  expect(errors).toEqual([]);
});

test('in panel mode the channel key belongs to its panel, like every other tool', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('cols', 2); sv('rows', 2); sv('gap-h', 6); onLayoutChange(); render();
    panelAnnMode = true;
    const target = panelBounds.find(p => p.idx === 3);
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const at = (x, y) => ({ clientX: rect.left + x * rect.width / c.width,
                            clientY: rect.top + y * rect.height / c.height });
    const click = (x, y) => {
      const p = at(x, y);
      c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, ...p }));
      c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0, ...p }));
    };
    const cx = target.x + target.w * 0.4, cy = target.y + target.h * 0.4;
    activeTool = 'legend';
    click(cx, cy);
    const landed = { global: annotations.filter(a => a.type === 'legend').length,
                     onPanel: (images[3].panelAnns || []).filter(a => a.type === 'legend').length };

    // move the panel out from under where the key was dropped
    activeTool = 'none';
    sv('gap-h', 90); render();
    const moved = panelBounds.find(p => p.idx === 3);
    const key = (images[3].panelAnns || []).find(a => a.type === 'legend');
    const drawnX = moved.x + (key ? key.xf : 0) * moved.w;
    return { landed, movedX: moved.x, drawnX, keyXf: key ? key.xf : null,
             w: key ? key._w : null };
  });
  expect(r.landed.global).toBe(0);              // not on the figure…
  expect(r.landed.onPanel).toBe(1);             // …on the panel
  expect(r.keyXf).toBeGreaterThan(0.3); expect(r.keyXf).toBeLessThan(0.5);
  // after the panel moves, the key is still inside it
  expect(r.drawnX).toBeGreaterThan(r.movedX);
  expect(r.w).toBeGreaterThan(0);               // and it actually drew (sets its own box)
  expect(errors).toEqual([]);
});
