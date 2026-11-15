// @ts-check
// Usability round 2, exports / freeform / gene maps group.
// freeform2-01 — the PowerPoint slide is the figure's printed size, so 8 pt letters read 8 pt
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

const H = `
  window.__unzip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true), csize = dv.getUint32(p + 18, true);
      const nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el, raw = bytes.subarray(at, at + csize);
      let data = raw;
      if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out[name] = /\\.(xml|rels|txt|csv|json|md|R|py|svg)$/.test(name) ? new TextDecoder().decode(data) : data;
      p = at + csize;
    }
    return out;
  };
  window.__latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  window.__pptx = async () => __unzip((await _captureDownload(() => exportPPTX())).data);
  window.__pdf = async (lossless) => __latin1((await _captureDownload(() => _exportPDFWithText('f', 300, { lossless: !!lossless }))).data);
  // Every Tj string a content stream shows, decoded from its octal escapes.
  window.__pdfShown = (pdf) => [...pdf.matchAll(/\\(((?:\\\\.|[^\\\\)])*)\\) Tj/g)].map(m => m[1].replace(/\\\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\\\(.)/g, '$1'));
`;

test.describe('PowerPoint at the printed size', () => {
  test('freeform2-01: a freeform figure at 180 mm gives a 180 mm slide and 8 pt letters read 8 pt', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 400, h: 300, label: 'A' }, { type: 'image', x: 440, y: 20, w: 400, h: 300, label: 'B' }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      sv('export-width-mm', '180'); sv('label-pt', '8'); sc('show-labels', true); render();
      const z = await __pptx();
      const pres = z['ppt/presentation.xml'], slide = z['ppt/slides/slide1.xml'];
      const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres);
      const letter = /name="Panel letter: A"(?:(?!<\/p:sp>).)*?sz="(\d+)"/s.exec(slide);
      const pf = _physFacts();
      return { cx: +m[1], cy: +m[2], wMm: pf.wMm, hMm: pf.hMm, sz: letter && +letter[1], notes: z['ppt/notesSlides/notesSlide1.xml'] };
    });
    expect(Math.abs(r.cx / 36000 - 180)).toBeLessThan(0.05);
    expect(Math.abs(r.cy / 36000 - r.hMm)).toBeLessThan(0.05);
    expect(r.sz).toBe(800);
    expect(r.notes).toMatch(/the figure at its printed size/);
    expect(errors).toEqual([]);
  });

  test('freeform2-01: a grid figure at 89 mm gives an 89 mm slide; Free width uses the canvas at the export DPI', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      sv('export-width-mm', '89'); sv('label-pt', '7'); sc('show-labels', true); render();
      let z = await __pptx();
      const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(z['ppt/presentation.xml']);
      const sz = +(/name="Panel letter: A"(?:(?!<\/p:sp>).)*?sz="(\d+)"/s.exec(z['ppt/slides/slide1.xml']) || [])[1];
      sv('export-width-mm', '0'); render();
      const pf = _physFacts();
      z = await __pptx();
      const m2 = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(z['ppt/presentation.xml']);
      return { cx: +m[1], sz, freeCx: +m2[1], freeMm: pf.wMm };
    });
    expect(Math.abs(r.cx / 36000 - 89)).toBeLessThan(0.05);
    expect(r.sz).toBe(700);
    expect(Math.abs(r.freeCx / 36000 - r.freeMm)).toBeLessThan(0.05);
    expect(errors).toEqual([]);
  });
});

test.describe('PDF and PowerPoint text', () => {
  test('freeform2-11: Greek, Δ, φ, the true minus and ≥ are selectable text in the PDF (Symbol, with a ToUnicode map); ✓ stays in the picture', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 40, y: 120, w: 300, h: 300, label: 'A', fill: '#888888' }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      const W = canvasLogicalW, Hh = canvasLogicalH;
      annotations.push({ type: 'text', xf: 400 / W, yf: 150 / Hh, text: 'Δ*ompC* resists', fontSize: 24, color: '#000000' });
      annotations.push({ type: 'textbox', xf: 400 / W, yf: 300 / Hh, x2f: 900 / W, y2f: 350 / Hh, text: 'Phage φGuide at 10^{−3}', fill: false, fillColor: '#ffffff', fillOpacity: 1, shape: 'rect', fontSize: 20, color: '#000000' });
      annotations.push({ type: 'text', xf: 400 / W, yf: 450 / Hh, text: '✓ done', fontSize: 24, color: '#000000' });
      render();
      const pdf = await __pdf(true);
      // what the picture under the PDF's text holds where the Δ label is
      const c = renderExportCanvas(150, { skipLabels: _pdfCanTypeset, dataText: _pdfCanTypeset });
      const k = c.width / W, ink = (x, y, w, h) => { const d = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; };
      const out = { pdf, shown: __pdfShown(pdf), deltaInk: ink(400, 150, 200, 30), tickInk: ink(400, 450, 120, 30) };
      render();
      return out;
    });
    expect(r.pdf).toMatch(/\/BaseFont \/Symbol \/ToUnicode \d+ 0 R/);
    expect(r.pdf).toMatch(/<44> <0394>/);              // Δ
    expect(r.pdf).toMatch(/<66> <03C6>/);              // φ
    expect(r.pdf).toMatch(/<2D> <2212>/);              // −
    expect(r.shown).toContain('D');                    // Δ in Symbol
    expect(r.shown).toContain('ompC');
    expect(r.shown).toContain('f');                    // φ in Symbol
    expect(r.shown).toContain('Guide at 10');
    expect(r.deltaInk).toBe(0);                        // not also in the picture
    expect(r.tickInk).toBeGreaterThan(20);             // ✓ has no standard-font glyph: it stays painted
    expect(errors).toEqual([]);
  });

  test('freeform2-10 / phage2-14: chart and gene-map words are PDF text in freeform and in the grid, not pixels', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
      freeformElements.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const ch = freeformElements.find(e => e.type === 'chart'), gm = freeformElements.find(e => e.type === 'genemap');
      Object.assign(ch, { x: 20, y: 20, w: 520, h: 360 }); Object.assign(gm, { x: 20, y: 420, w: 700, h: 200 });
      ch.chart.axes.y.title = 'OD_{600} of Δ*ompC*'; ch._chartKey = null;
      render();
      const ff = __pdfShown(await __pdf(true));
      renderExportCanvas(96, { skipLabels: _pdfCanTypeset, dataText: _pdfCanTypeset });
      const items = figTextItems.filter(t => t.kind === 'data').map(t => t.str);
      render();
      const onScreen = figTextItems.filter(t => t.kind === 'data').length;
      // grid: a chart panel and a gene-map panel
      document.getElementById('layout-mode').value = 'grid'; setLayoutMode('grid');
      freeformElements.length = 0; images.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const gch = images.find(im => im.type === 'chart'); gch.chart.axes.y.title = 'OD_{600}'; gch._chartKey = null;
      sv('cols', '1'); sv('rows', '2'); render();
      const grid = __pdfShown(await __pdf(true));
      return { ff, items, grid, onScreen };
    });
    for (const w of ['pTet', 'gfp', 'ampR', 'ColE1 ori', '0.2', 'OD', '600', ' of ', 'D', 'ompC']) expect(r.ff).toContain(w);
    expect(r.items).toContain('gfp');
    for (const w of ['pTet', 'gfp', 'OD', '600']) expect(r.grid).toContain(w);
    expect(r.onScreen).toBe(0);                       // an on-screen render records nothing extra
    expect(errors).toEqual([]);
  });

  test('freeform2-10: in the PowerPoint, chart and gene-map words and the chart letter are editable text boxes', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
      freeformElements.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const ch = freeformElements.find(e => e.type === 'chart'), gm = freeformElements.find(e => e.type === 'genemap');
      Object.assign(ch, { x: 20, y: 20, w: 520, h: 360, letter: 'E' }); Object.assign(gm, { x: 20, y: 420, w: 700, h: 200, letter: 'F' });
      ch.chart.axes.y.title = 'Time (min)'; ch._chartKey = null;
      render();
      const s = (await __pptx())['ppt/slides/slide1.xml'];
      const names = [...s.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map(m => m[1]);
      const yTitle = (s.match(/<p:sp>(?:(?!<\/p:sp>).)*name="Chart text: Time \(min\)"(?:(?!<\/p:sp>).)*<\/p:sp>/s) || [''])[0];
      document.getElementById('layout-mode').value = 'grid'; setLayoutMode('grid');
      freeformElements.length = 0; images.length = 0;
      addGenemapElement('linear'); closeGenemapModal(); render();
      const g = (await __pptx())['ppt/slides/slide1.xml'];
      return { names, yRot: /rot="16200000"/.test(yTitle), gridNames: [...g.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map(m => m[1]) };
    });
    for (const n of ['Panel letter: E', 'Panel letter: F', 'Chart text: Time (min)', 'Gene map text: gfp', 'Gene map text: ampR']) expect(r.names).toContain(n);
    expect(r.yRot).toBe(true);
    expect(r.gridNames).toContain('Chart text: gfp');
    expect(errors).toEqual([]);
  });
});
