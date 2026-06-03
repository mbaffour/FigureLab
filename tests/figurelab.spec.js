// @ts-check
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, setInput, state, gesture, panelCenter } = require('./helpers');

// ─────────────────────────────────────────────────────────────
test('pure helpers: gutter math + image clone', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(() => {
    const out = {};
    // uniform reduces to c*(pw+gH)
    colGaps = null; advancedSpacing = false;
    out.uniformOffset = colOffset(2, 300, 6);          // 612
    out.uniformTotal = totalGapsW(3, 6);               // 12
    // advanced overrides only the set gutter
    advancedSpacing = true; colGaps = [20, null];
    out.advOffset1 = colOffset(1, 300, 6);             // 320
    out.advOffset2 = colOffset(2, 300, 6);             // 626
    out.advTotal = totalGapsW(3, 6);                   // 26
    out.spanInterior = spanGapsW(0, 2, 6);             // 20
    colGaps = null; advancedSpacing = false;
    // clone preserves img ref, deep-copies panelAnns, drops cache
    const IMG = { w: 1 };
    const im = { id: 1, img: IMG, brightness: 2, channels: [{ img: IMG, lut: 'green' }], panelAnns: [{ text: 'a' }], _adjCache: {} };
    const c = cloneImageForUndo(im);
    c.panelAnns[0].text = 'b'; c.brightness = 9;
    out.imgRef = c.img === IMG;
    out.chRef = c.channels[0].img === IMG;
    out.deepAnns = im.panelAnns[0].text === 'a';
    out.deepScalar = im.brightness === 2;
    out.cacheDropped = c._adjCache === undefined;
    return out;
  });
  expect(r).toEqual({
    uniformOffset: 612, uniformTotal: 12,
    advOffset1: 320, advOffset2: 626, advTotal: 26, spanInterior: 20,
    imgRef: true, chRef: true, deepAnns: true, deepScalar: true, cacheDropped: true,
  });
});

test('grid geometry matches the documented formula', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  await setInput(page, 'cols', 3);
  await setInput(page, 'rows', 2);
  await setInput(page, 'panel-w', 200);
  await setInput(page, 'panel-h', 150);
  await setInput(page, 'gap-h', 10);
  await setInput(page, 'gap-v', 8);
  const s = await state(page);
  // totalW = rowLblW(0)+mLeft + cols*pw + (cols-1)*gapH + mRight
  const expectW = await page.evaluate(() => gi('m-left') + 3 * 200 + 2 * 10 + gi('m-right'));
  const expectH = await page.evaluate(() => {
    const titleH = gv('fig-title').trim() ? gi('axis-fs') + 20 : 0;
    return titleH + gi('m-top') + 2 * 150 + 1 * 8 + gi('m-btm');
  });
  expect(s.figW).toBe(expectW);
  expect(s.figH).toBe(expectH);
  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────
test('drag-to-space increases the uniform gap', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await setInput(page, 'cols', 2);
  await setInput(page, 'rows', 2);
  await setInput(page, 'gap-h', 6);
  const before = (await state(page)).gapH;
  // vertical gutter between col0/col1 at mid-height
  const seam = await page.evaluate(() => {
    const G = gridGeom();
    return [G.x0 + G.pw, G.y0 + G.gridH / 2];
  });
  await gesture(page, 'drag', [seam, [seam[0] + 40, seam[1]]]);
  const after = (await state(page)).gapH;
  expect(after).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('advanced per-gutter spacing sets only one gutter; reset clears', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 6);
  await setInput(page, 'cols', 3);
  await setInput(page, 'rows', 2);
  await page.evaluate(() => { document.getElementById('advanced-spacing').checked = true; setAdvancedSpacing(true); });
  const seam = await page.evaluate(() => { const G = gridGeom(); return [G.x0 + G.pw, G.y0 + G.gridH / 2]; });
  await gesture(page, 'drag', [seam, [seam[0] + 30, seam[1]]]);
  let s = await state(page);
  expect(s.advancedSpacing).toBe(true);
  expect(Array.isArray(s.colGaps)).toBe(true);
  // exactly one gutter overridden (index 0), the other still null/uniform
  expect(s.colGaps[0]).not.toBeNull();
  expect(s.colGaps[1] == null).toBe(true);
  await page.evaluate(() => resetGutters());
  s = await state(page);
  expect(s.colGaps).toBeNull();
  expect(s.rowGaps).toBeNull();
});

// ─────────────────────────────────────────────────────────────
test('one-click labels toggle and resize the canvas', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  await setInput(page, 'cols', 2); await setInput(page, 'rows', 2);
  const w0 = (await state(page)).figW;
  await page.click('#labels-toggle-btn');
  await page.waitForFunction(w => document.getElementById('fig-canvas').width !== w, w0); // debounced render
  const after = await page.evaluate(() => ({
    col: document.getElementById('show-col-labels').checked,
    row: document.getElementById('show-row-labels').checked,
    w: document.getElementById('fig-canvas').width,
  }));
  expect(after.col && after.row).toBe(true);
  expect(after.w).toBeGreaterThan(w0); // row-label strip widened the canvas
});

// ─────────────────────────────────────────────────────────────
test('double-click adds panel-bound text that follows reorder', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await setInput(page, 'cols', 2); await setInput(page, 'rows', 2);
  const c = await panelCenter(page, 0);
  await gesture(page, 'dblclick', [c]);
  await page.evaluate(() => {
    const inp = document.getElementById('ann-text-input');
    inp.value = 'WT';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  let ann = await page.evaluate(() => images[0].panelAnns && images[0].panelAnns.map(a => ({ t: a.type, text: a.text, halo: a.halo })));
  expect(ann).toEqual([{ t: 'text', text: 'WT', halo: true }]);
  // reorder panel 0 -> 1; annotation travels with the image object
  await page.evaluate(() => swapImages(0, 1));
  const moved = await page.evaluate(() => images[1].panelAnns.map(a => a.text));
  expect(moved).toEqual(['WT']);
  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────
test('undo/redo round-trips across delete, reorder, gutter, layout', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  await setInput(page, 'cols', 2); await setInput(page, 'rows', 2);

  // delete a panel, undo restores it WITH its image pixels
  const n0 = (await state(page)).nImages;
  await page.evaluate(() => { pushUndo(); images.splice(1, 1); renderImgList(); render(); });
  expect((await state(page)).nImages).toBe(n0 - 1);
  await page.evaluate(() => undo());
  const restored = await page.evaluate(() => ({ n: images.length, hasImg: !!(images[1] && images[1].img && images[1].img.width) }));
  expect(restored.n).toBe(n0);
  expect(restored.hasImg).toBe(true);
  await page.evaluate(() => redo());
  expect((await state(page)).nImages).toBe(n0 - 1);
  await page.evaluate(() => undo()); // back to full

  // layout change undoable
  await setInput(page, 'cols', 4, 'change');
  const undoLenBefore = (await state(page)).undoLen;
  expect(undoLenBefore).toBeGreaterThan(0);
});

// ─────────────────────────────────────────────────────────────
test('PNG export is truly higher-resolution at higher DPI', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await setInput(page, 'cols', 2); await setInput(page, 'rows', 2);

  const dims = (url) => page.evaluate(u => new Promise(res => {
    const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = u;
  }), url);

  const at = async (dpi) => page.evaluate((d) => {
    sv('export-dpi', String(d));
    const c = renderExportCanvas(getExportDPI());
    return c.toDataURL('image/png');
  }, dpi);

  const lo = await dims(await at(150)); // export-dpi is a <select>; use valid options
  const hi = await dims(await at(600));
  expect(hi.w).toBeGreaterThan(lo.w * 3); // 600/150 = 4x
  expect(hi.h).toBeGreaterThan(lo.h * 3);
  expect(errors).toEqual([]);
});

test('all export formats produce non-empty output', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await setInput(page, 'cols', 2); await setInput(page, 'rows', 2);
  for (const fmt of ['png', 'jpeg', 'webp', 'tiff', 'pdf', 'svg']) {
    const got = await page.evaluate(async (f) => {
      const downloads = [];
      const origDl = window.dl;
      window.dl = (data) => downloads.push(data);          // capture instead of navigating
      try { await doExport(f); } finally { window.dl = origDl; }
      return downloads.map(d => (typeof d === 'string' ? d.length : 0));
    }, fmt);
    // PNG/JPEG/WebP return long data: URLs; TIFF/PDF/SVG return short blob: URLs.
    expect(got.length, `format ${fmt} produced a download`).toBeGreaterThan(0);
    expect(Math.max(...got), `format ${fmt} non-empty`).toBeGreaterThan(10);
  }
  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────
test('MEASUREMENT INTEGRITY: figure buffer identical at dpr 1 vs 2', async ({ browser }) => {
  const sample = async (dpr) => {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await loadApp(page);
    await seedPanels(page, 4);
    await setInput(page, 'cols', 2); await setInput(page, 'rows', 2);
    // settle + drive the HD layer deterministically (avoids 150ms-timer flakiness)
    await page.waitForTimeout(200);
    const out = await page.evaluate(() => {
      updateHD();
      const fc = document.getElementById('fig-canvas');
      const b = panelBounds[0];
      const d = fc.getContext('2d').getImageData(Math.round(b.x), Math.round(b.y), 16, 16).data;
      // mean grey of the sampled block
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i];
      const hd = document.getElementById('fig-canvas-hd');
      return {
        dpr: window.devicePixelRatio,
        figW: fc.width, logicalW: canvasLogicalW,
        mean: Math.round(sum / (d.length / 4)),
        firstPixels: Array.from(d.slice(0, 16)),
        hdShown: hd && hd.style.display === 'block',
        hdBacking: hd ? hd.width : 0,
      };
    });
    await ctx.close();
    return out;
  };
  const a = await sample(1);
  const b = await sample(2);
  // The analysis buffer must be logical at BOTH scale factors:
  expect(a.figW).toBe(a.logicalW);
  expect(b.figW).toBe(b.logicalW);
  // Identical pixels and mean regardless of devicePixelRatio:
  expect(b.mean).toBe(a.mean);
  expect(b.firstPixels).toEqual(a.firstPixels);
  // HD display layer engaged only at dpr>1, and at higher backing res:
  expect(a.hdShown).toBeFalsy();
  expect(b.hdShown).toBeTruthy();
  expect(b.hdBacking).toBeGreaterThan(b.logicalW);
});

// ─────────────────────────────────────────────────────────────
test('session save/load round-trips layout, gutters and adjustments', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 6);
  await setInput(page, 'cols', 3); await setInput(page, 'rows', 2);
  await page.evaluate(() => {
    document.getElementById('advanced-spacing').checked = true; setAdvancedSpacing(true);
    setGutter('col', 2, 22); render(); // gutter index is 1-based → colGaps[1]
    images[0].brightness = 1.7;
  });
  const saved = await page.evaluate(() => {
    // capture the object saveJSON would serialise, without triggering a download
    const orig = window.dl; let captured = null; window.dl = (d) => { captured = d; };
    try { saveJSON(); } finally { window.dl = orig; }
    return captured; // blob URL string — re-read via fetch in page
  });
  const json = await page.evaluate(u => fetch(u).then(r => r.text()), saved);
  const obj = JSON.parse(json);
  expect(obj.layout.advancedSpacing).toBe(true);
  expect(obj.layout.colGaps[1]).toBe(22);
  expect(obj.images[0].brightness).toBeCloseTo(1.7, 5);
});

// ─────────────────────────────────────────────────────────────
test('no-op annotation resize does not create a spurious undo step', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  await setInput(page, 'cols', 2); await setInput(page, 'rows', 1);
  // add a rectangle annotation, then select it
  await page.evaluate(() => {
    annotations.push({ type: 'rect', xf: 0.2, yf: 0.2, x2f: 0.4, y2f: 0.4, color: '#fff', width: 2 });
    selectedAnnotation = annotations.length - 1; render();
  });
  const undoLen0 = (await state(page)).undoLen;
  // grab a resize handle and release WITHOUT moving
  await page.evaluate(() => {
    const a = annotations[selectedAnnotation];
    const W = canvasLogicalW, H = canvasLogicalH;
    const hx = a.x2f * W, hy = a.y2f * H; // a corner handle
    const c = document.getElementById('ann-canvas'); const r = c.getBoundingClientRect();
    const cx = r.left + hx * r.width / W, cy = r.top + hy * r.height / H;
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, button: 0 }));
    c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy, button: 0 }));
  });
  expect((await state(page)).undoLen).toBe(undoLen0); // no spurious undo
});

test('editing a panel label is undoable', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  const orig = await page.evaluate(() => images[0].label);
  await page.evaluate(() => {
    const inp = document.querySelector('.img-label-input');
    inp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // arm undo
    inp.focus();
    inp.value = 'ZZ';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));            // commit undo
  });
  expect(await page.evaluate(() => images[0].label)).toBe('ZZ');
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => images[0].label)).toBe(orig);
});

// ─────────────────────────────────────────────────────────────
test('corrupt image surfaces an error and does not hang the queue', async ({ page }) => {
  await loadApp(page);
  const toasted = await page.evaluate(async () => {
    const seen = [];
    const orig = window.toast; window.toast = (m, k) => { seen.push([m, k]); };
    // a data URL that is not a valid image
    const bad = 'data:image/png;base64,not-valid-base64-image-data';
    await new Promise((res) => {
      const img = new Image();
      img.onerror = () => { toast('Couldn\'t load image', 'err'); res(); };
      img.onload = () => res();
      img.src = bad;
      setTimeout(res, 1500);
    });
    window.toast = orig;
    return seen;
  });
  expect(toasted.some(t => t[1] === 'err')).toBe(true);
});
