// @ts-check
// The legend key: one model of what the figure plots (_figureKey), drawn by one renderer
// (_keyDraw) for the key placed on the figure, the standalone key file in every format,
// the bundles and the legend text starter — and following the figure as it changes.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

// In-page helpers: a ZIP reader (inflating deflated entries), a PNG decoder that finds a colour, and the key's
// names and swatch fills read back out of an SVG.
const HELPERS = `
  window.__zip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el;
      const raw = bytes.subarray(at, at + size);
      out[name] = (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw);
      p = at + size;
    }
    return out;
  };
  window.__hasPixel = async (data, type, rgb) => {
    const bmp = await createImageBitmap(new Blob([data], { type }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) return { w: c.width, h: c.height, found: true };
    return { w: c.width, h: c.height, found: false };
  };
  window.__svgKey = (svg) => ({
    names: [...svg.matchAll(/dominant-baseline="central">([^<]*)<\\/text>/g)].map(m => m[1]),
    rectFills: [...svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/g)].map(m => m[1]),
    circleFills: [...svg.matchAll(/<circle [^>]*fill="(#[0-9a-f]{6})"/g)].map(m => m[1]),
    circleStrokes: [...svg.matchAll(/<circle [^>]*stroke="(#[0-9a-f]{6})"/g)].map(m => m[1]),
    lineStrokes: [...svg.matchAll(/<line [^>]*stroke="(#[0-9a-f]{6})"/g)].map(m => m[1]),
  });
  window.__txt = (cap) => new TextDecoder().decode(cap.data);
`;

// Three grid panels: DAPI (blue LUT), GFP (green LUT) and a brightfield panel named BF.
async function seedChannels(page) {
  await seedPanels(page, 3);
  await page.evaluate(HELPERS);
  await page.evaluate(() => {
    const [A, B, C] = images;
    A.name = 'a_DAPI.tif'; A.lut = 'blue';
    B.name = 'b_GFP.tif'; B.lut = 'green';
    C.name = 'c_BF.tif';
    sv('tag-channels', false);              // channel names come from the key alone, not panel tags
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); render();
  });
}

test('the key of a grid figure downloads as PNG and as SVG, with each channel\'s name and exact colour', async ({ page }) => {
  const errors = await loadApp(page);
  await seedChannels(page);
  const r = await page.evaluate(async () => {
    sv('export-name', 'fig1'); sv('export-dpi', '300');
    const png = await _captureDownload(() => doExport('png', { key: true }));
    const px = await __hasPixel(png.data, 'image/png', [0, 255, 0]);           // the GFP swatch, #00ff00
    const svgCap = await _captureDownload(() => doExport('svg', { key: true }));
    const svg = __txt(svgCap);
    return { pngName: png.name, px, svgName: svgCap.name, key: __svgKey(svg),
      viewBox: (/viewBox="([^"]+)"/.exec(svg) || [])[1], rows: _figureKey().map(k => [k.name, k.color, k.marker]) };
  });
  expect(r.rows).toEqual([['DAPI', '#4787ff', 'square'], ['GFP', '#00ff00', 'square'], ['BF', null, 'none']]);
  expect(r.pngName).toBe('fig1-key.png');
  expect(r.px.found).toBe(true);
  // 300 DPI: the key is drawn at the figure's export scale, not at screen size.
  expect(r.px.w).toBeGreaterThan(100);
  expect(r.svgName).toBe('fig1-key.svg');
  expect(r.key.names).toEqual(['DAPI', 'GFP', 'BF']);
  expect(r.key.rectFills).toEqual(expect.arrayContaining(['#4787ff', '#00ff00']));
  expect(r.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
  expect(errors).toEqual([]);
});

test('Download key writes the format the figure was last exported in', async ({ page }) => {
  const errors = await loadApp(page);
  await seedChannels(page);
  const r = await page.evaluate(async () => {
    const before = document.getElementById('key-dl-btn').textContent;
    await _captureDownload(() => doExport('svg'));                 // the figure goes out as SVG
    const after = document.getElementById('key-dl-btn').textContent;
    const key = await _captureDownload(() => downloadKey());
    await _captureDownload(() => doExport('pdf'));
    const pdf = await _captureDownload(() => downloadKey());
    const pdfText = new TextDecoder('latin1').decode(pdf.data);
    return { before, after, keyName: key.name, keyIsSvg: /<svg /.test(__txt(key)), pdfName: pdf.name,
      typeset: ['DAPI', 'GFP', 'BF'].map(n => pdfText.includes(`(${n}) Tj`)) };
  });
  expect(r.before).toMatch(/PNG/);
  expect(r.after).toMatch(/SVG/);
  expect(r.keyName).toBe('figure-key.svg');
  expect(r.keyIsSvg).toBe(true);
  expect(r.pdfName).toBe('figure-key.pdf');
  expect(r.typeset).toEqual([true, true, true]);              // the PDF key's names are real text
  expect(errors).toEqual([]);
});

test('a chart figure keys each series with its own marker and line, not a square', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    addChartElement('line'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['t', 'WT', 'KO'], rows: [[0, 1, 2], [1, 2, 3], [2, 4, 3]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1, 2];
    el.chart.style.showPoints = true;
    el._chartKey = ''; el._chartStat = null; render();
    const line = _figureKey().map(k => ({ name: k.name, color: k.color, marker: k.marker, line: k.line }));
    const lineSvg = __svgKey(__txt(await _captureDownload(() => doExport('svg', { key: true }))));
    el.chart.kind = 'scatter'; el._chartKey = ''; el._chartStat = null; render();
    const scatter = _figureKey().map(k => ({ name: k.name, marker: k.marker, stroke: k.stroke, line: k.line }));
    const scatterSvg = __svgKey(__txt(await _captureDownload(() => doExport('svg', { key: true }))));
    el.chart.kind = 'groupedBar'; el._chartKey = ''; el._chartStat = null; render();
    const bars = _figureKey().map(k => k.marker);
    return { line, lineSvg, scatter, scatterSvg, bars, text: document.getElementById('key-text').value };
  });
  // Okabe–Ito: WT black, KO orange; a line with points
  expect(r.line).toEqual([
    { name: 'WT', color: '#000000', marker: 'circle', line: 'solid' },
    { name: 'KO', color: '#e69f00', marker: 'circle', line: 'solid' }]);
  expect(r.lineSvg.names).toEqual(['WT', 'KO']);
  expect(r.lineSvg.circleFills).toEqual(['#000000', '#e69f00']);     // the markers are circles…
  expect(r.lineSvg.lineStrokes).toEqual(['#000000', '#e69f00']);     // …on the series' line
  expect(r.lineSvg.rectFills).not.toContain('#e69f00');              // …and no square swatch
  // a scatter's points are white-edged circles, with no line
  expect(r.scatter.map(s => [s.name, s.marker, s.stroke, s.line])).toEqual([['WT', 'circle', '#ffffff', null], ['KO', 'circle', '#ffffff', null]]);
  expect(r.scatterSvg.circleStrokes).toEqual(['#ffffff', '#ffffff']);
  expect(r.scatterSvg.lineStrokes).toEqual([]);
  expect(r.bars).toEqual(['square', 'square']);
  expect(r.text).toBe('WT (black, filled bars); KO (orange, filled bars).');
  expect(errors).toEqual([]);
});

test('a freeform figure keys its images and gene map, and the key placed on it shows them', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 20, y: 20, w: 200, h: 200, lut: 'green', name: 'cells_GFP.tif' },
    { type: 'image', x: 240, y: 20, w: 200, h: 200, lut: 'magenta', name: 'cells_mCherry.tif' },
  ]);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const images0 = _figureKey().map(k => [k.name, k.color]);
    const text0 = document.getElementById('key-text').value;
    addGenemapElement('linear'); closeGenemapModal(); render();
    const rows = _figureKey().map(k => [k.name, k.marker, k.glyph || null]);
    setKeyOnFigure(true); render();
    const placed = annotations.filter(a => a.type === 'legend');
    const svg = __txt(await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas'))));
    return { images0, text0, rows, placed: placed.length, w: placed[0] && placed[0]._w, names: __svgKey(svg).names,
      text: document.getElementById('key-text').value };
  });
  expect(r.images0).toEqual([['GFP', '#00ff00'], ['RFP', '#ff00ff']]);
  expect(r.text0).toBe('GFP (green); RFP (magenta).');
  expect(r.rows).toEqual([
    ['GFP', 'square', null], ['RFP', 'square', null],
    ['Promoter', 'glyph', 'promoter'], ['RBS', 'glyph', 'rbs'], ['CDS / gene', 'glyph', 'cds'],
    ['Terminator', 'glyph', 'terminator'], ['Origin of replication', 'glyph', 'ori']]);
  expect(r.text).toContain('CDS / gene (blue, arrow)');
  expect(r.placed).toBe(1);
  expect(r.w).toBeGreaterThan(40);
  // the key placed on a freeform figure is written as vector text in its SVG
  expect(r.names).toEqual(expect.arrayContaining(['GFP', 'RFP', 'Promoter', 'Origin of replication']));
  expect(errors).toEqual([]);
});

test('the legend text follows a rename, a colour change, a hidden panel and a chart edit', async ({ page }) => {
  const errors = await loadApp(page);
  await seedChannels(page);
  const r = await page.evaluate(() => {
    const txt = () => { render(); return document.getElementById('key-text').value; };
    const out = {};
    out.start = txt();
    images[1].lut = 'magenta'; out.recoloured = txt();             // GFP shown in magenta
    images[1].name = 'b_mCherry.tif'; out.renamed = txt();         // the file is renamed
    images[0].excluded = true; out.hidden = txt();                 // DAPI panel hidden
    // a chart: rename a series, change its palette
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['Strain', 'WT', 'KO'], rows: [['a', 1, 2], ['b', 2, 3]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1, 2]; el.chart.kind = 'groupedBar';
    el._chartKey = ''; el._chartStat = null;
    out.chart = txt();
    el.chart.data.columns[1] = 'Wild type'; el._chartKey = ''; el._chartStat = null;
    out.chartRenamed = txt();
    el.chart.style.palette = 'tolBright'; el._chartKey = ''; el._chartStat = null;
    out.chartRecoloured = txt();
    return out;
  });
  expect(r.start).toBe('DAPI (blue); GFP (green); BF.');
  expect(r.recoloured).toBe('DAPI (blue); GFP (magenta); BF.');
  expect(r.renamed).toBe('DAPI (blue); RFP (magenta); BF.');
  expect(r.hidden).toBe('RFP (magenta); BF.');
  expect(r.chart).toBe('WT (black, filled bars); KO (orange, filled bars).');
  expect(r.chartRenamed).toBe('Wild type (black, filled bars); KO (orange, filled bars).');
  expect(r.chartRecoloured).toBe('Wild type (blue, filled bars); KO (red, filled bars).');
  expect(errors).toEqual([]);
});

test('Place the key on the figure adds and removes the key as one undo step, and a PDF typesets it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedChannels(page);
  await page.evaluate(() => { document.getElementById('export-acc').open = true; });
  const sw = page.locator('#key-on-figure');
  await sw.scrollIntoViewIfNeeded();
  const count = () => page.evaluate(() => annotations.filter(a => a.type === 'legend').length
    + images.reduce((n, im) => n + ((im && im.panelAnns) || []).filter(a => a.type === 'legend').length, 0));
  const depth = () => page.evaluate(() => undoStack.length);
  const d0 = await depth();
  await sw.click();
  expect(await count()).toBe(1);
  expect(await depth()).toBe(d0 + 1);
  expect(await sw.isChecked()).toBe(true);
  // The placed key and the standalone key are one renderer: same rows, same order.
  const r = await page.evaluate(async () => {
    render();
    const a = annotations.find(x => x.type === 'legend');
    const pdf = new TextDecoder('latin1').decode((await _captureDownload(() => doExport('pdf'))).data);
    const svg = __txt(await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas'))));
    const keySvg = __txt(await _captureDownload(() => doExport('svg', { key: true })));
    return { inside: a.xf > 0.3 && a.xf < 1 && a._w > 30, pdfText: ['DAPI', 'GFP', 'BF'].map(n => pdf.includes(`(${n}) Tj`)),
      figNames: __svgKey(svg).names.filter(n => ['DAPI', 'GFP', 'BF'].includes(n)), keyNames: __svgKey(keySvg).names };
  });
  expect(r.inside).toBe(true);
  expect(r.pdfText).toEqual([true, true, true]);                 // names typeset, not pixels
  expect(r.figNames).toEqual(r.keyNames);
  await page.evaluate(() => undo());
  expect(await count()).toBe(0);
  expect(await sw.isChecked()).toBe(false);
  // on again, plus a key pinned to a panel: unticking removes both
  await sw.click();
  await page.evaluate(() => { images[1].panelAnns.push({ type: 'legend', xf: 0.1, yf: 0.1, color: '#ffffff', width: 1, fontSize: 12, fill: true, fillColor: '#000000', fillOpacity: 0.6 }); renderAnnotationList(); render(); });
  expect(await count()).toBe(2);
  await sw.click();
  expect(await count()).toBe(0);
  expect(await sw.isChecked()).toBe(false);
  expect(errors).toEqual([]);
});

test('the submission package, multi-page PDF, PowerPoint and batch export carry the key', async ({ page }) => {
  const errors = await loadApp(page);
  await seedChannels(page);
  const r = await page.evaluate(async () => {
    sv('export-name', 'fig2');
    const zip = await __zip((await _captureDownload(() => exportSubmissionPackage())).data);
    const names = Object.keys(zip);
    const keyTxt = new TextDecoder().decode(zip['fig2-key.txt'] || new Uint8Array());
    const keySvg = new TextDecoder().decode(zip['fig2-key.svg'] || new Uint8Array());
    const keyPdf = new TextDecoder('latin1').decode(zip['fig2-key.pdf'] || new Uint8Array());
    // multi-page: 1 row per page → 1 figure page, then the key page
    document.getElementById('pdf-rows-per-page').value = '1';
    const mp = new TextDecoder('latin1').decode((await _captureDownload(() => exportMultiPagePDF())).data);
    const pages = (mp.match(/\/Type \/Page\b(?!s)/g) || []).length;
    // PowerPoint: a second slide with the key picture
    let pptxUrl = null; const realDl = window.dl;
    window.dl = (u, n) => { if (String(n).endsWith('.pptx')) pptxUrl = u; };
    await exportPPTX();
    window.dl = realDl;
    // The package's XML parts are deflated now, so read them through the ZIP reader.
    const pptx = await __zip(new Uint8Array(await (await fetch(pptxUrl)).arrayBuffer()));
    const pres = new TextDecoder().decode(pptx['ppt/presentation.xml']);
    // batch export: the key as PNG and SVG beside the panels, in its one ZIP
    let batchUrl = null; window.dl = (u, n) => { batchUrl = u; };
    await batchExportPanels();
    window.dl = realDl;
    const got = Object.keys(await __zip(new Uint8Array(await (await fetch(batchUrl)).arrayBuffer())));
    return { names, keyTxt, keySvgNames: __svgKey(keySvg).names, keyPdfText: keyPdf.includes('(GFP) Tj'), pages,
      slide2: !!pptx['ppt/slides/slide2.xml'], keyMedia: !!pptx['ppt/media/key.png'],
      sldIds: (pres.match(/<p:sldId /g) || []).length, batch: got };
  });
  for (const f of ['fig2-key.png', 'fig2-key.tiff', 'fig2-key.pdf', 'fig2-key.svg', 'fig2-key.txt'])
    expect(r.names).toContain(f);
  expect(r.keyTxt.trim()).toBe('DAPI (blue); GFP (green); BF.');
  expect(r.keySvgNames).toEqual(['DAPI', 'GFP', 'BF']);
  expect(r.keyPdfText).toBe(true);
  expect(r.pages).toBe(2);
  expect(r.slide2).toBe(true);
  expect(r.keyMedia).toBe(true);
  expect(r.sldIds).toBe(2);
  expect(r.batch).toEqual(expect.arrayContaining(['fig2-key.png', 'fig2-key.svg']));
  expect(errors).toEqual([]);
});

test('colour words: every LUT, tag swatch and chart palette colour has its name', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => ({
    luts: Object.keys(LUTS).filter(k => !LUT_INFO[k].ramp).map(k => _colourName(_rgbHex(LUTS[k](255)))),
    // a ramp has no one hue: its key row names the ramp itself
    ramps: Object.keys(LUTS).filter(k => LUT_INFO[k].ramp).map(k => _keyChannelRow('x', k).words.split(',')[0]),
    swatch: Object.values(_LUT_SWATCH).map(_colourName),
    okabe: CB_PALETTES.okabeIto.map(_colourName),
    rgb: _colourName('rgb(68,1,84)'),
    none: _colourName(null),
  }));
  // red joined the lookup tables with the journal checks (journals.spec.js), and has its word
  expect(r.luts).toEqual(['green', 'cyan', 'magenta', 'red', 'yellow', 'blue', 'orange']);
  expect(r.ramps).toEqual(['fire LUT', 'viridis colour map', 'magma colour map', 'inferno colour map', 'cividis colour map']);
  expect(r.swatch).toEqual(['blue', 'green', 'magenta', 'red', 'cyan', 'yellow', 'orange', 'orange', 'green', 'orange', 'orange', 'yellow']);
  expect(r.okabe).toEqual(['black', 'orange', 'sky blue', 'bluish green', 'yellow', 'blue', 'vermilion', 'reddish purple']);
  expect(r.rgb).toBe('dark purple');
  expect(r.none).toBe('');
  expect(errors).toEqual([]);
});
