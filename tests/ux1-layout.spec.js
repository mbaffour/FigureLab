// @ts-check
// Usability round 1, layout group: mixing images, charts and gene maps in one figure; grid
// and freeform; marks that must follow their panel when the layout changes.
// blot-02, phage-03, phage-21, charts-20 — a chart or gene map is a grid panel
// phage-20, freeform-11 — Pop out keeps what it can and says what it cannot, one undo
// phage-26, freeform-45 — a freeform canvas resize moves nothing
// phage-19, blot-04, phage-22 — rulers, MW labels and labels follow their panel / object
// freeform-10 — a freeform crop keeps the picture's scale
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

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
      return { types, types2, waiting: _pendingPanels.filter(p => p.rec.type).length, pf, mode: layoutMode };
    });
    expect(r.types).toEqual(['image', 'image', 'chart', 'genemap']);
    expect(r.types2.slice(2)).toEqual(['chart', 'genemap']);   // data needs no file dropped again
    expect(r.waiting).toBe(0);
    expect(r.mode).toBe('grid');
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
