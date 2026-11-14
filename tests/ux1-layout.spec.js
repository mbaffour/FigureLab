// @ts-check
// Usability round 1, layout group: mixing images, charts and gene maps in one figure; grid
// and freeform; marks that must follow their panel when the layout changes.
// blot-02, phage-03, phage-21, charts-20 — a chart or gene map is a grid panel
// phage-20, freeform-11 — Pop out keeps what it can and says what it cannot, one undo
// phage-26, freeform-45 — a freeform canvas resize moves nothing
// phage-19, blot-04, phage-22 — rulers, MW labels and labels follow their panel / object
// freeform-10 — a freeform crop keeps the picture's scale
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform, gesture } = require('./helpers');

const CSV = 'strain,OD\nWT,1.2\nKO,0.4\nRescue,1.0\n';

// Run a command from the ⌘K palette, as a user would.
async function palette(page, text) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('#cmdp-input').fill(text);
  await page.keyboard.press('Enter');
}
// Drop a file onto the app's import path (the same addFiles the drop zone calls).
async function dropText(page, name, text, type) {
  await page.evaluate(async ({ name, text, type }) => {
    await addFiles([new File([text], name, { type })]);
  }, { name, text, type });
}
const H = `
  window.__thick = (canvas, x, y0, y1) => {   // darkest run along a vertical line, in device px
    const d = canvas.getContext('2d').getImageData(x, y0, 1, y1 - y0).data; let best = 0, run = 0;
    for (let i = 0; i < d.length; i += 4) { const dark = d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90; run = dark ? run + 1 : 0; best = Math.max(best, run); }
    return best; };
  window.__txt = (cap) => new TextDecoder().decode(cap.data);
`;

test.describe('a chart or gene map is a grid panel (blot-02, phage-03, phage-21)', () => {
  test('Add bar chart in a grid adds a lettered chart panel and keeps the grid', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    await palette(page, 'Add bar chart');
    await expect(page.locator('#chart-modal')).toHaveClass(/open/);
    const r = await page.evaluate(() => {
      closeChartModal(); render();
      const im = images[images.length - 1];
      const b = panelBounds.find(p => p.idx === images.length - 1);
      return { mode: layoutMode, n: images.length, type: im.type, label: im.label, ff: freeformElements.length,
        cell: b && { w: b.w, h: b.h, dw: b.dw, dh: b.dh } };
    });
    expect(r.mode).toBe('grid');                 // no silent switch to freeform
    expect(r.n).toBe(3);
    expect(r.type).toBe('chart');
    expect(r.label).toBe('C');                   // the next letter
    expect(r.ff).toBe(0);
    expect(r.cell.dw).toBe(r.cell.w);            // it fills its cell
    expect(r.cell.dh).toBe(r.cell.h);
    expect(errors).toEqual([]);
  });

  test('a CSV dropped on a grid becomes a chart panel; a span, the legend key and undo work on it', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await dropText(page, 'lysis.csv', CSV, 'text/csv');
    const r = await page.evaluate(() => {
      closeChartModal(); render();
      const i = images.findIndex(im => im && im.type === 'chart');
      const im = images[i];
      const keyNames = _figureKey().map(k => k.name);
      // span the chart across two columns: the cell it draws in is twice as wide
      const b1 = panelBounds.find(p => p.idx === i);
      pushUndo(); im.colSpan = 2; onLayoutChange(); render();
      const b2 = panelBounds.find(p => p.idx === i);
      return { mode: layoutMode, i, label: im.label, keyNames, w1: b1.w, w2: b2.w, drawnW: im.w };
    });
    expect(r.mode).toBe('grid');
    expect(r.i).toBe(4);
    expect(r.label).toBe('E');
    expect(r.keyNames).toContain('OD');          // the chart's series, as a freeform chart keys it
    expect(r.w2).toBeGreaterThan(r.w1 * 1.9);
    expect(r.drawnW).toBe(r.w2);                // drawn at the spanned cell's size
    // Editing the data through the editor is one undo step, and undo gives the old data back.
    const u = await page.evaluate(() => {
      const i = images.findIndex(im => im && im.type === 'chart');
      openDataPanelEditor(i);
      document.getElementById('chart-data-ta').value = 'strain\tOD\nWT\t2\nKO\t1\n';
      applyChartModal();
      const after = images[i].chart.data.rows.length;
      undo();
      const j = images.findIndex(im => im && im.type === 'chart');
      return { after, back: images[j].chart.data.rows.length, mode: layoutMode };
    });
    expect(u.after).toBe(2);
    expect(u.back).toBe(3);
    expect(errors).toEqual([]);
  });

  test('a chart panel is redrawn at the export resolution, and is vector in both SVG modes', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 1);
    await page.evaluate(H);
    await page.evaluate(() => { addChartElement('bar'); closeChartModal(); sv('cols', '2'); sv('rows', '1'); onLayoutChange(); render(); });
    const r = await page.evaluate(async () => {
      const i = images.findIndex(im => im && im.type === 'chart');
      const b = panelBounds.find(p => p.idx === i);
      // The y axis is a 1-px line at the plot's left (padL 48 + offset); find it on screen and at 4x.
      const one = document.createElement('canvas'); render(one, 1);
      const four = document.createElement('canvas'); render(four, 4);
      let x1 = -1, t1 = 0;
      for (let x = Math.round(b.x); x < b.x + 80; x++) { const t = __thick(one, x, Math.round(b.y + 20), Math.round(b.y + b.h - 40)); if (t > 60) { x1 = x; t1 = t; break; } }
      // The same line at 4x is a run 4x as long (drawn, not enlarged from the screen picture)
      const t4 = __thick(four, x1 * 4 + 1, Math.round((b.y + 20) * 4), Math.round((b.y + b.h - 40) * 4));
      // its width at 4x: count dark columns across the line
      // Crisp, not enlarged: across the line at 4x there are at most two part-grey pixels
      // (its antialiased edges). The screen picture scaled up 4x smears it over many.
      const grey = (c, X, Y) => { let n = 0; for (let dx = -10; dx <= 10; dx++) { const d = c.getContext('2d').getImageData(X + dx, Y, 1, 1).data; if (d[0] > 70 && d[0] < 200) n++; } return n; };
      const up = document.createElement('canvas'); up.width = four.width; up.height = four.height;
      { const x = up.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(one, 0, 0, up.width, up.height); }
      const Y4 = Math.round((b.y + b.h / 2) * 4);
      const w4 = grey(four, x1 * 4 + 2, Y4), wUp = grey(up, x1 * 4 + 2, Y4);
      const layered = __txt(await _captureDownload(() => doExport('svg')));
      sv('export-svg-mode', 'flat');
      const flat = __txt(await _captureDownload(() => doExport('svg')));
      const png = await _captureDownload(() => doExport('png'));
      const pdf = await _captureDownload(() => doExport('pdf'));
      return { x1, t1, t4, w4, wUp, layeredVec: /chart drawn from its data, as vector/.test(layered) && />WT<|>Group A<|<text/.test(layered),
        flatVec: /chart drawn from its data, as vector/.test(flat), png: !!png, pdf: !!pdf };
    });
    expect(r.x1).toBeGreaterThan(0);
    expect(r.t4).toBeGreaterThan(r.t1 * 3.5);
    expect(r.w4).toBeLessThanOrEqual(2);
    expect(r.wUp).toBeGreaterThan(r.w4);
    expect(r.layeredVec).toBe(true);
    expect(r.flatVec).toBe(true);
    expect(r.png).toBe(true);
    expect(r.pdf).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a chart panel and a gene map panel survive save and load, and the preflight runs', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    const r = await page.evaluate(async () => {
      addChartElement('bar'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      render();
      const s = JSON.parse(JSON.stringify(serializeSession(true)));
      const settingsOnly = JSON.parse(JSON.stringify(serializeSession(false)));
      applySession(s, { silent: true }); render();
      const types = images.map(im => im && (im.type || 'image'));
      applySession(settingsOnly, { silent: true }); render();
      const types2 = images.map(im => im && (im.type || 'image'));
      doExportPreflight('png');
      const pf = document.body.innerText.length > 0;
      // every format the figure exports in, with the chart and gene map panels in it
      const files = [];
      for (const f of ['png', 'jpeg', 'tiff', 'pdf', 'svg']) { const c = await _captureDownload(() => doExport(f)); files.push(c ? c.name.split('.').pop() : null); }
      const pptx = await _captureDownload(() => exportPPTX()); files.push(pptx ? 'pptx' : null);
      const key = await _captureDownload(() => doExport('png', { key: true })); files.push(key ? 'key' : null);
      return { types, types2, waiting: _pendingPanels.filter(p => p.rec.type).length, pf, mode: layoutMode, files };
    });
    expect(r.types).toEqual(['image', 'image', 'chart', 'genemap']);
    expect(r.types2.slice(2)).toEqual(['chart', 'genemap']);   // data needs no file dropped again
    expect(r.waiting).toBe(0);
    expect(r.mode).toBe('grid');
    expect(r.files).toEqual(['png', 'jpg', expect.stringMatching(/^tiff?$/), 'pdf', 'svg', 'pptx', 'key']);
    expect(errors).toEqual([]);
  });

  test('in freeform, Add bar chart still adds a freeform object', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 150 }]);
    await page.evaluate(() => { addChartElement('bar'); closeChartModal(); render(); });
    const r = await page.evaluate(() => ({ mode: layoutMode, types: freeformElements.map(e => e.type), grid: images.filter(Boolean).length }));
    expect(r.mode).toBe('freeform');
    expect(r.types).toEqual(['image', 'chart']);
    expect(r.grid).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ── marks that follow their panel ───────────────────────────────
const SEED = `
  window.__img = async (iw, ih, name) => {
    const c = document.createElement('canvas'); c.width = iw; c.height = ih;
    const x = c.getContext('2d'); x.fillStyle = '#404040'; x.fillRect(0, 0, iw, ih);
    x.fillStyle = '#fff'; for (let k = 0; k < 12; k++) x.fillRect((k * 53) % iw, (k * 37) % ih, 6, 6);
    const src = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name); res(); }; img.src = src; });
    return images.length - 1; };
  // figure point of source pixel (u,v) of panel i
  window.__fig = (i, u, v) => { const pb = panelBounds.find(p => p.idx === i), m = _panelSourceMap(pb, images[i]);
    return [m.dx + (u - m.sx) / m.kx, m.dy + (v - m.sy) / m.ky]; };
  window.__ruler = (i, u1, v1, u2, v2) => { const [a, b] = __fig(i, u1, v1), [c, d] = __fig(i, u2, v2);
    annotations.push({ type: 'ruler', xf: a / canvasLogicalW, yf: b / canvasLogicalH, x2f: c / canvasLogicalW, y2f: d / canvasLogicalH, color: '#fff', width: 2 });
    return annotations.length - 1; };
  window.__rulers = () => annotations.filter(a => a.type === 'ruler').map(a => { const m = _rulerMeasure(a);
    return { status: m.status, label: m.label, src: m.src && m.src.flat().map(v => Math.round(v)), panel: m.im && m.im.name }; });
`;

test('phage-19: rulers stay on what they measure through a span change, a reorder and a width change', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => {
    for (const n of ['tem.tif', 'b.png', 'c.png', 'd.png']) await __img(400, 368, n);
    images[0].umPerPx = 0.002; images[0].colSpan = 2; images[0].rowSpan = 2;
    sv('cols', 3); sv('rows', 2); onLayoutChange(); render();
    __ruler(0, 100, 100, 160, 100); __ruler(0, 200, 300, 200, 340); __ruler(0, 300, 50, 340, 80);
    render();
  });
  const before = await page.evaluate(() => __rulers());
  expect(before.every(r => r.status === 'ok')).toBe(true);
  // Panel span back to 1 x 1 through the panel's drawer, as the tester did.
  await page.evaluate(() => { renderImgList(); document.querySelector('[data-gear="0"]').click(); });
  await page.locator('#settings-0 .f-colspan').fill('1');
  await page.locator('#settings-0 .f-rowspan').fill('1');
  const afterSpan = await page.evaluate(() => { render(); return __rulers(); });
  expect(afterSpan).toEqual(before);                       // same pixels, same lengths, all still measuring
  const afterMoves = await page.evaluate(() => {
    pushUndo(); swapImages(0, 2); render();
    const swapped = __rulers();
    sv('panel-w', 220); onLayoutChange(); render();
    return { swapped, narrow: __rulers() };
  });
  expect(afterMoves.swapped).toEqual(before);
  expect(afterMoves.narrow).toEqual(before);
  // Undo puts the layout back, and the rulers with it.
  const undone = await page.evaluate(() => { undo(); render(); return __rulers(); });
  expect(undone).toEqual(before);
  expect(errors).toEqual([]);
});

const BLOT = `
  window.__blot = (n, name) => {
    const pitch = 90, W = 60 + pitch * n, H = 160;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (i + 0.5 >= 30 + pitch * k && i + 0.5 < 80 + pitch * k) s += 60 * Math.exp(-((j + 0.5 - H / 2) ** 2) / 18);
      const v = Math.max(0, Math.min(255, Math.round(225 - s))), o = (j * W + i) * 4;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const src = c.toDataURL('image/png');
    return new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, name || 'blot.png'); render(); res(images.length - 1); }; img.src = src; });
  };
  // each MW label's offset from its blot's picture: the gap to the picture's left edge, and
  // its top against the picture's top (in figure px)
  // (and how far its middle is from the ladder band it names)
  window.__mw = (i) => { render(); const pb = panelBounds.find(p => p.idx === i), m = _panelSourceMap(pb, images[i]);
    const band = images[i].gelAnalysis.lanes[0].bands[0], fy = m.dy + (band.yc - m.sy) / m.ky;
    return annotations.filter(a => a.mw && a.blotPanel === images[i].id).map(a => ({ t: a.text,
      gap: Math.round(pb.dx - a.xf * canvasLogicalW), off: Math.round(a.yf * canvasLogicalH + a.fontSize / 2 - fy) })); };
`;

test('blot-04: MW labels follow their blot when a lane table makes its row taller; placing again replaces them', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(BLOT);
  const r = await page.evaluate(async () => {
    await __blot(4, 'A.png'); await __blot(4, 'B.png');
    sv('cols', 1); sv('rows', 2); sc('auto-row-h', true); onLayoutChange(); render();   // rows hug their panels, as the tester had
    runGelAnalysis(0); gelSetLadder(0, 0, '50'); gelPlaceMWLabels(0);
    runGelAnalysis(1); gelSetLadder(1, 0, '37'); gelPlaceMWLabels(1);
    const a0 = __mw(0), b0 = __mw(1), y0 = panelBounds.find(p => p.idx === 1).dy;
    // a three-row lane table over A pushes B down
    laneTableSetName(0, 0, 'IPTG'); ['–', '+', '–', '+'].forEach((v, c) => laneTableSetCell(0, 0, c, v));
    laneTableAddRow(0, 'MOI'); laneTableAddRow(0, 'Time');
    render();
    const a1 = __mw(0), b1 = __mw(1), y1 = panelBounds.find(p => p.idx === 1).dy;
    gelPlaceMWLabels(1);                                  // again: replaces, never doubles
    const again = __mw(1).length;
    const removed = gelRemoveMWLabels(0);
    return { a0, a1, b0, b1, moved: y1 - y0, again, removed, left: annotations.filter(a => a.mw).length };
  });
  expect(r.moved).toBeGreaterThan(20);                    // B's row really moved
  expect(r.a0.length).toBe(1);
  expect(r.a1).toEqual(r.a0);
  expect(r.b1).toEqual(r.b0);
  expect(r.again).toBe(1);
  expect(r.removed).toBe(1);
  expect(r.left).toBe(1);                                 // B's label stays
  expect(errors).toEqual([]);
});

test('phage-22: labels placed over or beside a freeform picture move with it when it is dragged', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 300, h: 200, iw: 300, ih: 200 }, { type: 'image', x: 600, y: 100, w: 200, h: 200 }]);
  const before = await page.evaluate(() => {
    const W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'text', xf: 150 / W, yf: 80 / H, text: '10^{-1}', fontSize: 12, color: '#000' });   // just above the picture
    annotations.push({ type: 'arrow', xf: 120 / W, yf: 330 / H, x2f: 200 / W, y2f: 200 / H, color: '#000', width: 2 }); // points into it
    annotations.push({ type: 'text', xf: 500 / W, yf: 500 / H, text: 'free', fontSize: 12, color: '#000' });     // on nothing
    render();
    return annotations.map(a => [a.xf * W, a.yf * H, (a.x2f ?? a.xf) * W, (a.y2f ?? a.yf) * H]);
  });
  // drag the first picture with the mouse
  await gesture(page, 'drag', [[250, 200], [280, 220], [310, 240]]);
  const after = await page.evaluate(() => { render(); const W = canvasLogicalW, H = canvasLogicalH;
    return { el: [freeformElements[0].x, freeformElements[0].y], a: annotations.map(a => [a.xf * W, a.yf * H, (a.x2f ?? a.xf) * W, (a.y2f ?? a.yf) * H]) }; });
  const dx = after.el[0] - 100, dy = after.el[1] - 100;
  expect(dx).toBeGreaterThan(30);
  for (const k of [0, 1]) after.a[k].forEach((v, j) => expect(v).toBeCloseTo(before[k][j] + (j % 2 ? dy : dx), 3));
  after.a[2].forEach((v, j) => expect(v).toBeCloseTo(before[2][j], 3));    // the free label stays
  expect(errors).toEqual([]);
});

test('phage-26 / freeform-45: a freeform canvas resize moves no annotation, and names what is left off the canvas', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 100, y: 600, w: 300, h: 200 }, { type: 'image', x: 900, y: 100, w: 250, h: 200 }]);
  const px = () => page.evaluate(() => { render(); return annotations.map(a => [a.xf * canvasLogicalW, a.yf * canvasLogicalH,
    (a.x2f ?? a.xf) * canvasLogicalW, (a.y2f ?? a.yf) * canvasLogicalH].map(v => Math.round(v * 100) / 100)); });
  await page.evaluate(() => {
    const W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'text', xf: 120 / W, yf: 820 / H, text: '10^{0}', fontSize: 12, color: '#000' });   // just under the picture
    annotations.push({ type: 'rect', xf: 20 / W, yf: 20 / H, x2f: 700 / W, y2f: 400 / H, color: '#000', width: 2 });   // a frame on nothing
    annotations.push({ type: 'text', xf: 1150 / W, yf: 850 / H, text: 'corner', fontSize: 12, color: '#000' });
    render();
    window.__toasts = []; const o = window.toast; window.toast = function (m, k) { window.__toasts.push(String(m)); return o.apply(this, arguments); };
  });
  const px0 = await px();
  await page.locator('#fm-canvas-h').fill('845');
  await page.locator('#fm-canvas-h').press('Enter');
  await page.locator('#fm-canvas-w').fill('1100');
  await page.locator('#fm-canvas-w').press('Enter');
  const px1 = await px();
  const r = await page.evaluate(() => ({ W: canvasLogicalW, H: canvasLogicalH, els: freeformElements.map(e => [e.x, e.y, e.w, e.h]), toasts: window.__toasts }));
  expect([r.W, r.H]).toEqual([1100, 845]);
  expect(px1).toEqual(px0);                               // nothing moved, nothing stretched
  expect(r.els).toEqual([[100, 600, 300, 200], [900, 100, 250, 200]]);
  expect(r.toasts.some(m => /past the edge/.test(m) && /annotation/.test(m))).toBe(true);
  expect(errors).toEqual([]);
});

test('freeform-10: a typed freeform crop keeps the picture\'s scale and leaves the kept pixels where they were', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 100, w: 512, h: 144, iw: 2560, ih: 720 }]);
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); updateElemPropsBar(); });
  await page.locator('#ep-cropL').fill('22');
  await page.locator('#ep-cropR').fill('21');
  await page.locator('#ep-cropL').fill('40');
  const r = await page.evaluate(() => { const e = freeformElements[0]; render();
    return { x: e.x, y: e.y, w: e.w, h: e.h, srcAspect: (2560 * (1 - 0.40 - 0.21)) / 720 }; });
  expect(r.w / r.h).toBeCloseTo(r.srcAspect, 3);         // the cropped picture keeps its shape: not stretched
  expect(r.h).toBeCloseTo(144, 6);
  expect(r.x).toBeCloseTo(50 + 0.40 * 512, 6);            // the kept pixels did not move on the canvas
  expect(errors).toEqual([]);
});

test('charts-20: Relabel in freeform letters charts as well as pictures, in reading order, dark on a chart', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 40, y: 40, w: 300, h: 200 }]);
  await page.evaluate(() => {
    addChartElement('bar'); closeChartModal(); Object.assign(freeformElements[1], { x: 400, y: 40 });
    addChartElement('line'); closeChartModal(); Object.assign(freeformElements[2], { x: 40, y: 320 });
    addChartElement('box'); closeChartModal(); Object.assign(freeformElements[3], { x: 400, y: 330 });
    render();
  });
  await page.locator('#freeform-controls button', { hasText: 'Relabel A, B, C' }).click();
  const r = await page.evaluate(async () => {
    render();
    const letters = freeformElements.map(e => e.type === 'image' ? e.label : e.letter);
    const names = freeformElements.slice(1).map(e => e.label);
    const chip = _ffFurniture(freeformElements[1]).label;          // the figure's letter style: a chip by default
    sc('label-bg', false); const fu = _ffFurniture(freeformElements[1]).label; sc('label-bg', true);
    // the letter is in the exported picture and in the SVG
    const svg = new TextDecoder().decode((await _captureDownload(() => doExport('svg'))).data);
    return { letters, names, fill: fu && fu.fill, chip: !!(chip && chip.bg), svgHasB: />B<\/text>|>B</.test(svg) };
  });
  expect(r.letters).toEqual(['A', 'B', 'C', 'D']);
  expect(r.names).toEqual(['bar chart', 'line chart', 'box chart']);   // names kept for the element list
  expect(r.chip).toBe(true);
  expect(r.fill).toBe('#000000');                       // without the chip, dark on the chart's white
  expect(r.svgHasB).toBe(true);
  expect(errors).toEqual([]);
});

test('phage-20 / freeform-11: Pop out keeps the freeform charts, scale bars, crop shape, lane table and headings; one undo', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(SEED);
  await page.evaluate(async () => {
    // two charts already on the freeform canvas
    document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
    addChartElement('bar'); closeChartModal(); addChartElement('line'); closeChartModal();
    freeformElements[1].y = 400;
    document.getElementById('layout-mode').value = 'grid'; setLayoutMode('grid');
    for (const n of ['tem.tif', 'plate.png', 'plate2.png', 'spot.png']) await __img(400, 368, n);
    Object.assign(images[0], { umPerPx: 0.002, sbOn: true, sbUm: 0.2, cropB: 8 });
    Object.assign(images[1], { cropShape: 'circle' });
    sv('cols', 2); sv('rows', 2); sc('show-col-labels', true); onLayoutChange();
    laneTableSetName(3, 0, 'dilution'); ['10^{0}', '10^{-1}', '10^{-2}', '10^{-3}'].forEach((v, c) => laneTableSetCell(3, 0, c, v));
    render();
    __ruler(0, 100, 100, 200, 100); render();
  });
  const before = await page.evaluate(() => ({ undo: undoStack.length, ruler: __rulers()[0], W: canvasLogicalW, H: canvasLogicalH,
    A: (() => { const pb = panelBounds.find(p => p.idx === 0); return [pb.dx, pb.dy, pb.dw, pb.dh]; })() }));
  // The circle clip now carries into freeform (freeform group, freeform-20), so nothing is
  // lost and Pop out no longer stops to name it.
  await page.locator('button', { hasText: 'Pop out to free layout' }).first().click();
  await expect(page.locator('#confirm-modal-bg')).toHaveCount(0);
  const r = await page.evaluate(() => {
    render();
    const els = freeformElements, A = els.find(e => e.type === 'image' && e.name === 'tem.tif');
    if (els.find(e => e.type === 'image' && e.name === 'plate.png').cropShape !== 'circle') throw new Error('circle clip not carried');
    const D = els.find(e => e.type === 'image' && e.name === 'spot.png');
    const lane = els.filter(e => e.type === 'text' && /10\^/.test(e.text));
    return { mode: layoutMode, charts: els.filter(e => e.type === 'chart').length, images: els.filter(e => e.type === 'image').length,
      A: [A.x, A.y, A.w, A.h], Acal: [A.umPerPx, A.sbOn, A.sbUm, !!A._sbSkip], cropAspect: (400) / (368 * 0.92),
      lane: lane.length, laneGrouped: lane.every(t => t.groupId && t.groupId === D.groupId),
      heading: els.some(e => e.type === 'text' && /Col 1/.test(e.text)),
      ruler: __rulers()[0], undo: undoStack.length };
  });
  expect(r.mode).toBe('freeform');
  expect(r.charts).toBe(2);                                  // the charts already there are kept
  expect(r.images).toBe(4);
  r.A.forEach((v, k) => expect(v).toBeCloseTo(before.A[k], 6));   // exactly where and as big as in the grid
  expect(r.A[2] / r.A[3]).toBeCloseTo(r.cropAspect, 2);      // the cropped TEM keeps its shape
  expect(r.Acal).toEqual([0.002, true, 0.2, false]);         // calibration and scale bar carried, and drawn
  expect(r.lane).toBe(4);
  expect(r.laneGrouped).toBe(true);
  expect(r.heading).toBe(true);
  expect(r.ruler).toEqual(before.ruler);                     // the ruler measures the same pixels in freeform
  expect(r.undo).toBe(before.undo + 1);
  // One undo brings the grid back exactly.
  const u = await page.evaluate(() => { undo(); render(); return { mode: layoutMode, ff: freeformElements.map(e => e.type), W: canvasLogicalW, H: canvasLogicalH, ruler: __rulers()[0] }; });
  expect(u.mode).toBe('grid');
  expect(u.ff).toEqual(['chart', 'chart']);
  expect([u.W, u.H]).toEqual([before.W, before.H]);
  expect(u.ruler).toEqual(before.ruler);
  expect(errors).toEqual([]);
});

test('the ways in: double-click, the drawer and the right-click menu open a chart panel\'s editor; the gel dialog removes MW labels', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(() => { addChartElement('bar'); closeChartModal(); render(); });
  const centre = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 1); return [b.x + b.w / 2, b.y + b.h / 2]; });
  await gesture(page, 'dblclick', [centre]);
  await expect(page.locator('#chart-modal')).toHaveClass(/open/);
  await page.evaluate(() => closeChartModal());
  await page.evaluate(() => { renderImgList(); document.querySelector('[data-gear="1"]').click(); });
  await page.locator('#settings-1 button', { hasText: 'Edit chart data and style' }).click();
  await expect(page.locator('#chart-modal')).toHaveClass(/open/);
  await page.evaluate(() => closeChartModal());
  // the drawer hides the picture tools a chart has no pixels for
  expect(await page.locator('#settings-1 .f-sb-on').isVisible()).toBe(false);
  await page.evaluate(([x, y]) => { const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + x * r.width / canvasLogicalW, clientY: r.top + y * r.height / canvasLogicalH })); }, centre);
  await page.locator('#panel-ctx-menu div', { hasText: 'Edit chart' }).click();
  await expect(page.locator('#chart-modal')).toHaveClass(/open/);
  await page.evaluate(() => closeChartModal());
  // the gel dialog's Remove MW labels button
  await page.evaluate(BLOT);
  const n = await page.evaluate(async () => {
    images = []; render(); await __blot(4, 'A.png'); runGelAnalysis(0); gelSetLadder(0, 0, '50'); gelPlaceMWLabels(0);
    openGelAnalysis(0); return annotations.filter(a => a.mw).length; });
  expect(n).toBe(1);
  await page.locator('button', { hasText: 'Remove MW labels' }).click();
  expect(await page.evaluate(() => annotations.filter(a => a.mw).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('charts-20: in freeform, the Label field sets a chart\'s letter and the Elements list follows a renamed picture', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 40, y: 40, w: 300, h: 200, label: 'A' }]);
  await page.evaluate(() => { addChartElement('bar'); closeChartModal(); selectedElems.clear(); selectedElems.add(0); updateElemPropsBar(); });
  await page.locator('#ep-label').fill('D');
  expect(await page.locator('#fm-elem-list').innerText()).toContain('D');
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(1); updateElemPropsBar(); });
  await page.locator('#ep-label').fill('B');
  const r = await page.evaluate(() => ({ letter: freeformElements[1].letter, name: freeformElements[1].label }));
  expect(r).toEqual({ letter: 'B', name: 'bar chart' });
  expect(errors).toEqual([]);
});
