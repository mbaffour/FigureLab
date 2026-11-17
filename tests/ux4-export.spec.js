// @ts-check
// Usability round 4, group `export` — the PDF, SVG and PowerPoint writers, the legend key
// placed on the figure, the compliance check and the Save dialog's integrity line, layout
// defaults and presets, and labels and tags on panels. Each test is a round-4 finding driven
// the way the tester met it, and each fails on the build they tested (41f6721).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const HELPERS = `
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fixes: [...e.querySelectorAll('button')].map(b => b.textContent.trim()) }));
  window.__report = () => { checkCompliance(); const r = { title: document.getElementById('im-title').textContent, rows: __rows() }; __close(); return r; };
  window.__row = (l) => __report().rows.find(r => r.label === l) || null;
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
  window.__latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  window.__pdfOf = async (lossless) => { _captureSkips = []; const d = await _captureDownload(() => _exportPDFWithText('f', 300, { lossless }), 'pdf');
    return { pdf: d ? __latin1(d.data) : null, skips: _captureSkips.slice() }; };
  window.__zip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el, raw = bytes.subarray(at, at + size);
      out.push({ name, data: (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw) });
      p = at + size;
    }
    return out;
  };
  window.__pkg = async () => { const z = await _captureDownload(() => exportSubmissionPackage()); const files = {};
    (await __zip(z.data)).forEach(e => { files[e.name] = /\\.(png|tiff?|pdf)$/i.test(e.name) ? '(binary)' : new TextDecoder().decode(e.data); }); return files; };
`;

// ── blot4-02 ─────────────────────────────────────────────────────────────────────────
// A row label emptied to hide it stopped both PDFs: "Cannot read properties of undefined
// (reading 'sym')", and the package went out without its PDF, its README advising a lower DPI.
test('blot4-02: an emptied row label no longer stops the PDF exports, and a fault is not blamed on the DPI', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', '1'); sv('rows', '4'); onLayoutChange(); });
  await page.locator('#show-row-labels').check();
  const ins = page.locator('#row-label-inputs input');
  const names = ['pAKT (S473)', 'AKT', 'GAPDH', ''];
  for (let i = 0; i < 4; i++) { await ins.nth(i).fill(names[i]); await ins.nth(i).dispatchEvent('input'); await ins.nth(i).dispatchEvent('change'); }
  const r = await page.evaluate(async () => {
    render();
    const lossless = await __pdfOf(true), jpeg = await __pdfOf(false);
    const f = await __pkg();
    const readme = f['README.txt'] || '';
    // a fault that is not about size: the advice names it as FigureLab's, not the DPI
    const advice = _packageManifest('f', 300, [], '', [{ label: 'PDF (lossless)', why: "Cannot read properties of undefined (reading 'sym')" }], []);
    const big = _packageManifest('f', 300, [], '', [{ label: 'TIFF', why: 'the canvas is too large for this browser (out of memory)' }], []);
    return { lossless: !!lossless.pdf, jpeg: !!jpeg.pdf, skips: lossless.skips.concat(jpeg.skips),
      rows: lossless.pdf.includes('(pAKT \\(S473\\)) Tj'),
      pkgPdf: Object.keys(f).some(k => /\.pdf$/i.test(k)), readmeMissing: /NOT INCLUDED/.test(readme), advice, big };
  });
  expect(r.lossless).toBe(true);
  expect(r.jpeg).toBe(true);
  expect(r.skips).toEqual([]);
  expect(r.rows).toBe(true);                               // the other headings are still real text
  expect(r.pkgPdf).toBe(true);
  expect(r.readmeMissing).toBe(false);
  expect(r.advice).not.toMatch(/lower export DPI usually resolves/);
  expect(r.advice).toMatch(/a lower DPI will not help/);
  expect(r.big).toMatch(/lower export DPI usually resolves/);
  expect(errors).toEqual([]);
});

// ── blot4-03 ─────────────────────────────────────────────────────────────────────────
// A chart's slanted group names were placed in the PDF starting at the tick and running up
// across the bars; on the canvas (and in the TIFF) each ends at its tick, below the axis.
test('blot4-03: in the PDF a slanted group name ends at its tick, below the axis, as on the canvas', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['cond', 'v'], rows: [['Vehicle', 1], ['EGF', 2], ['MK-2206', 3], ['EGF + MK-2206', 1.5]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1]; el.chart.kind = 'bar'; el.w = 260; el.h = 220;
    el._chartKey = ''; el._chartStat = null; render();
    const { pdf } = await __pdfOf(true);
    // the same render the PDF used: where each slanted word is anchored, in points
    renderExportCanvas(300, { skipLabels: _pdfCanTypeset, dataText: _pdfCanTypeset });
    const items = figTextItems.filter(t => t.kind === 'data' && t.rotDeg && t.align === 'right');
    scheduleRender(0);
    const H = +/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(pdf)[1], W = +/\/MediaBox \[0 0 ([\d.]+)/.exec(pdf)[1];
    const k = W / canvasLogicalW, mc = document.createElement('canvas').getContext('2d');
    return items.map(it => {
      const re = new RegExp('([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) Tm (?:([-\\d.]+) ([-\\d.]+) Td )?(?:/F\\d+ [\\d.]+ Tf )?\\(' + it.str.replace(/[+]/g, '\\+') + '\\) Tj');
      const m = re.exec(pdf); if (!m) return { s: it.str, found: false };
      const [a, b, c, d, e, f] = m.slice(1, 7).map(Number), tx = +(m[7] || 0), ty = +(m[8] || 0);
      const ox = e + a * tx + c * ty, oy = f + b * tx + d * ty;          // where the glyphs start
      mc.font = it.font; const w = mc.measureText(it.str).width * k;
      const ex = ox + a * w, ey = oy + b * w;                            // where they end (on the baseline)
      return { s: it.str, found: true, ax: it.x * k, ay: H - it.y * k, ox, oy, ex, ey, fs: it.fs * k };
    });
  });
  expect(r.length).toBeGreaterThanOrEqual(3);
  for (const t of r.filter(t => t.found)) {
    // the word ends at its tick (within its own size, the baseline drop of a middle-anchored word)…
    expect(Math.hypot(t.ex - t.ax, t.ey - t.ay)).toBeLessThan(t.fs);
    // …and starts below and to the left of it, not on the bars above
    expect(t.ox).toBeLessThan(t.ax - t.fs);
    expect(t.oy).toBeLessThan(t.ay);
  }
  expect(r.filter(t => t.found).length).toBeGreaterThanOrEqual(3);
  // the SVG ends each word at its tick too, and PowerPoint keeps the slanted words in the
  // chart's picture (it sets level and quarter-turned text only), drawn as on the canvas
  const o = await page.evaluate(async () => {
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 96, document.getElementById('fig-canvas')))).data);
    const z = await _captureDownload(() => exportPPTX()); const files = await __zip(z.data);
    const slide = new TextDecoder().decode(files.find(f => /slides\/slide1\.xml$/.test(f.name)).data);
    return { svg: (svg.match(/<text[^>]*>Vehicle<\/text>/) || [''])[0], pptxText: />Vehicle</.test(slide) };
  });
  expect(o.svg).toMatch(/text-anchor="end"/);
  expect(o.svg).toMatch(/transform="rotate\(-40 /);
  expect(o.pptxText).toBe(false);
  expect(errors).toEqual([]);
});

// ── freeform4-08 ─────────────────────────────────────────────────────────────────────
async function ffKeyFigure(page, imgH) {
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 450, h: imgH, label: 'A', iw: 300, ih: 200 }]);
  await page.evaluate(() => {
    sv('fm-canvas-w', '1200'); sv('fm-canvas-h', '700'); if (typeof onFreeformCanvasSize === 'function') onFreeformCanvasSize();
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['t', 'WT', 'ΔluxS', 'ΔlsrR', 'lsrA-mNeonGreen', 'BF'], rows: [['1', 1, 2, 3, 4, 5], ['2', 2, 3, 4, 5, 6]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1, 2, 3, 4, 5]; el.chart.kind = 'line';
    el.x = 500; el.y = 20; el.w = 600; el.h = 400; el.label = 'B';
    el._chartKey = ''; el._chartStat = null; render();
  });
}
const keyState = (page) => page.evaluate(() => { const k = annotations.find(a => a.type === 'legend');
  return { H: canvasLogicalH, top: k.yf * canvasLogicalH, bottom: k.yf * canvasLogicalH + k._h, w: k._w, h: k._h, fmH: +gv('fm-canvas-h') }; });

test('freeform4-08: a key placed Below follows an object moved into its band, and the export carries every name', async ({ page }) => {
  const errors = await loadApp(page);
  await ffKeyFigure(page, 678);
  // the key needs room at once (the picture fills the canvas height)
  // Export › Legend key › Where › Below, with no key yet: it is placed there
  await page.evaluate(() => { const s = document.getElementById('key-where'); s.value = 'bottom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(50);
  const a = await keyState(page);
  expect(a.H).toBeGreaterThan(700);
  expect(a.bottom).toBeLessThanOrEqual(a.H + 0.5);
  // then, as the guide's revision asks, the picture is moved down into the key's band
  await page.evaluate(() => { freeformElements[0].y = 80; render(); });
  await page.waitForTimeout(100);
  const b = await keyState(page);
  expect(b.H).toBeGreaterThan(a.H);                                 // the canvas grew again
  expect(b.bottom).toBeLessThanOrEqual(b.H + 0.5);                  // and the key is inside it
  expect(b.top).toBeGreaterThanOrEqual(80 + 678);                   // below the moved picture
  const r = await page.evaluate(async () => {
    const row = __row('Legend key on the figure');
    const { pdf } = await __pdfOf(true);
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 96, document.getElementById('fig-canvas')))).data);
    const vb = +/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)[1];
    const ys = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>ΔlsrR</g)].map(m => +m[1]);
    // the standalone key is laid out exactly as the placed one
    const placed = annotations.find(a => a.type === 'legend'), st = _keyCanvas(300);
    return { row: row && row.icon, pdfHas: /\(D\)[^]*?\(lsrR\)|\(\\306lsrR\)|lsrR\) Tj/.test(pdf), svgYs: ys, vb,
      sameSize: Math.abs(st._keyW - placed._w) < 1e-6 && Math.abs(st._keyH - placed._h) < 1e-6,
      sameNames: JSON.stringify(st._keyItems.map(t => t.str)) };
  });
  expect(r.row).toBe('✓');
  expect(r.pdfHas).toBe(true);
  expect(r.svgYs.length).toBeGreaterThan(0);
  r.svgYs.forEach(y => expect(y).toBeLessThan(r.vb));
  expect(r.sameSize).toBe(true);
  expect(r.sameNames).toContain('ΔlsrR');
  expect(errors).toEqual([]);
});

test('freeform4-08: after the figure is saved and opened again, the placed key still follows a move', async ({ page }) => {
  const errors = await loadApp(page);
  await ffKeyFigure(page, 678);
  await page.evaluate(() => { sv('key-where', 'bottom'); setKeyOnFigure(true); });
  await page.waitForTimeout(50);
  const a = await keyState(page);
  expect(a.H).toBeGreaterThan(700);                                 // grown at placement
  await page.evaluate(async () => {
    window.prompt = () => 'Fig3 v2'; await saveToLibrary();
    const rec = (await new Promise(r => { _tx('readonly').then(st => { const q = st.getAll(); q.onsuccess = () => r(q.result); }); })).find(x => x.name === 'Fig3 v2');
    confirmNewFigure(); document.getElementById('cm-ok').click();
    await loadFromLibrary(rec.id); render();
  });
  await page.waitForFunction(() => layoutMode === 'freeform' && freeformElements.filter(e => e.type === 'image').every(e => e._imgEl && e._imgEl.complete));
  await page.waitForTimeout(200);
  const b0 = await keyState(page);
  await page.evaluate(() => { freeformElements.find(e => e.type === 'image').y = 80; render(); });
  await page.waitForTimeout(150);
  const b = await keyState(page);
  expect(b.H).toBeGreaterThan(b0.H);                                // the opened figure's key made room again
  expect(b.bottom).toBeLessThanOrEqual(b.H + 0.5);
  expect(await page.evaluate(() => __row('Legend key on the figure').icon)).toBe('✓');
  expect(errors).toEqual([]);
});

test('freeform4-08: a key that cannot be freed does not grow the figure without end', async ({ page }) => {
  const errors = await loadApp(page);
  await ffKeyFigure(page, 678);
  await page.evaluate(() => { sv('key-where', 'bottom'); setKeyOnFigure(true); });
  await page.waitForTimeout(50);
  const h1 = await page.evaluate(async () => {
    // a canvas narrower than the key: no place on it is free, however tall it grows
    sv('fm-canvas-w', '90'); if (typeof onFreeformCanvasSize === 'function') onFreeformCanvasSize();
    freeformElements.forEach(e => { e.x = 0; e.w = 90; }); freeformElements[0].y = 120; render();
    for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 20)); render(); }
    return +gv('fm-canvas-h');
  });
  const h2 = await page.evaluate(async () => { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 20)); render(); } return +gv('fm-canvas-h'); });
  expect(h2).toBe(h1);                                              // settled, not creeping
  expect(errors).toEqual([]);
});

test('freeform4-08: the Save dialog names a cut key instead of "No integrity warnings", and its button frees it', async ({ page }) => {
  const errors = await loadApp(page);
  await ffKeyFigure(page, 678);
  await page.evaluate(() => { sv('key-where', 'bottom'); setKeyOnFigure(true); });
  await page.waitForTimeout(50);
  // the author shrinks the canvas by hand: the key is now cut at the bottom edge
  await page.evaluate(() => { sv('fm-canvas-h', '700'); if (typeof onFreeformCanvasSize === 'function') onFreeformCanvasSize(); render(); });
  await page.waitForTimeout(50);
  const row = await page.evaluate(() => __row('Legend key on the figure'));
  expect(row.icon).toBe('⚠');
  expect(row.text).toMatch(/placed key runs off the figure edge/);
  expect(row.text).not.toMatch(/covers runs off/);
  await page.evaluate(() => doExportPreflight('tiff'));
  const body = page.locator('#preflight-body');
  await expect(body).toContainText('Legend key on the figure');
  await expect(body).not.toContainText('No integrity warnings');
  await body.getByRole('button', { name: 'Move to free space' }).click();
  await expect(body).not.toContainText('Legend key on the figure');
  const s = await keyState(page);
  expect(s.bottom).toBeLessThanOrEqual(s.H + 0.5);
  expect(errors).toEqual([]);
});

// ── freeform4-11 / newcomer4-04 / newcomer4-14 ────────────────────────────────────────
test('freeform4-11: a key placed Below runs across the figure in columns, and the standalone key matches it', async ({ page }) => {
  const errors = await loadApp(page);
  await ffKeyFigure(page, 300);
  // Export › Legend key › Where › Below, with no key yet: it is placed there
  await page.evaluate(() => { const s = document.getElementById('key-where'); s.value = 'bottom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  const r = await page.evaluate(() => {
    const k = annotations.find(a => a.type === 'legend'), fs = _keyFs();
    const L = _keyLayout(_figureKey(), fs, _keyFont(fs)), st = _keyCanvas(300);
    return { cols: L.cols, rows: L.rows.length, h: k._h, lh: L.lh, w: k._w, W: canvasLogicalW, stW: st._keyW, stH: st._keyH };
  });
  expect(r.cols).toBeGreaterThan(1);
  expect(r.h).toBeLessThan(r.rows * r.lh);                         // shorter than one stacked column
  expect(r.w).toBeLessThanOrEqual(r.W);
  expect(r.stW).toBeCloseTo(r.w, 6);
  expect(r.stH).toBeCloseTo(r.h, 6);
  expect(errors).toEqual([]);
});

test('newcomer4-04: ⌘K legend key says how much the margin grew', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange();
    images.forEach((im, i) => { im.lut = ['green', 'magenta', 'blue', 'red'][i]; }); render();
    _cmdpKeyOnFigure();
  });
  const t = await page.evaluate(() => document.getElementById('toast').textContent);
  expect(t).toMatch(/Legend key placed on the figure/);
  expect(t).toMatch(/margin grew from \d+ to \d+ px/);
  expect(errors).toEqual([]);
});

test('newcomer4-14: narrowing the printed width with a key placed shows the width warning and the key line together', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange();
    images.forEach((im, i) => { im.lut = ['green', 'magenta', 'blue', 'red'][i]; });
    sv('export-width-mm', '183'); render();
    sv('key-where', 'bottom'); setKeyOnFigure(true);
  });
  await page.waitForTimeout(50);
  // Export › Printed width 183 → 89 mm, as the select reports it (focus, then change)
  await page.evaluate(() => { const s = document.getElementById('export-width-mm'); s.dispatchEvent(new Event('focus'));
    s._wasMm = _physFacts().wMm; s.value = '89'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  const t = await page.evaluate(() => document.getElementById('toast').textContent);
  expect(t).toMatch(/Printed width 183 → 89 mm: text keeps its point size/);
  expect(t).toMatch(/legend key needed free space/);
  expect(errors).toEqual([]);
});

// ── fluor4-01 ────────────────────────────────────────────────────────────────────────
async function fluorFigure(page, journal) {
  await page.evaluate(HELPERS);
  await page.evaluate(async (journal) => {
    const mk = (g) => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(0, 0, 200, 200); return c.toDataURL(); };
    for (let i = 0; i < 10; i++) { const src = mk(20 + i * 5); await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'cell' + i + '.png'); r(); }; im.src = src; }); }
    sv('cols', '5'); sv('rows', '2'); onLayoutChange();
    const L = ['blue', 'magenta', 'green'];
    images.forEach((im, i) => { const k = i % 5; if (k < 3) im.lut = L[k]; else if (k === 3) { im.lut = 'blue';
      im.channels = [{ img: images[1].img, src: images[1].src, lut: 'magenta', name: 'm.tif', blackPt: 0, whitePt: 255 }, { img: images[2].img, src: images[2].src, lut: 'green', name: 'g.tif', blackPt: 0, whitePt: 255 }]; } });
    sv('key-names', JSON.stringify({ blue: 'DAPI', magenta: 'mScarlet-Parkin', green: 'mito-GFP' }));
    sc('tag-channels', true); sc('show-labels', true);
    applyPreset(journal); render();
  }, journal);
}
const overlapsLetter = () => {
  const L = figTextItems.filter(t => t.kind === 'panel'), T = figTextItems.filter(t => t.kind === 'tag');
  const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
  return T.filter(t => L.some(l => ov(t.bbox, l.bbox))).map(t => `${t.str}@${t.idx}`);
};
for (const journal of ['elife', 'embo']) {
  test(`fluor4-01: a merge's channel names fit beside its letter at ${journal} width, on screen and in the export`, async ({ page }) => {
    const errors = await loadApp(page);
    await fluorFigure(page, journal);
    const r = await page.evaluate((fn) => {
      const f = new Function('return (' + fn + ')()');
      render(); const screen = f();
      renderExportCanvas(300); const exp = f();
      const tags = figTextItems.filter(t => t.kind === 'tag' && t.idx === 3).map(t => t.str);
      const inPanel = figTextItems.filter(t => t.kind === 'tag').every(t => { const b = panelBounds.find(p => p.idx === t.idx); return !b || (t.bbox.x >= b.x - 0.5 && t.bbox.x + t.bbox.w <= b.x + b.w + 0.5); });
      scheduleRender(0);
      return { screen, exp, tags, inPanel, fit: images[3]._tagFit, row: __row('Text over text') };
    }, overlapsLetter.toString());
    expect(r.screen).toEqual([]);
    expect(r.exp).toEqual([]);
    expect(r.inPanel).toBe(true);                                   // no tag runs into the next panel
    expect(r.tags.join(' ')).toMatch(/DAPI|Merge/);
    expect(['wrapped', 'merge']).toContain(r.fit);
    expect(r.row && r.row.icon).toBe('ℹ');                          // said, not counted
    expect(r.row.text).toMatch(/Tags fitted to clear their letters: D/);
    expect(errors).toEqual([]);
  });
}

test('fluor4-01: a typed tag over a letter is caught by the compliance check and the Save dialog, with a fix', async ({ page }) => {
  const errors = await loadApp(page);
  await fluorFigure(page, 'embo');
  await page.evaluate(() => { images[3].tag = 'DAPI mScarlet-Parkin mito-GFP merge'; images[8].tag = 'DAPI mScarlet-Parkin mito-GFP merge'; render(); });
  const row = await page.evaluate(() => __row('Text over text'));
  expect(row.icon).toBe('⚠');
  expect(row.text).toMatch(/letter D/);
  expect(row.fixes).toContain('Move tags to the other edge');
  const title = await page.evaluate(() => __report().title);
  expect(title).not.toMatch(/(\d+)\/\1 passed/);                  // the headline no longer reads all-passed
  await page.evaluate(() => doExportPreflight('png'));
  await expect(page.locator('#preflight-body')).toContainText('Text over text');
  await page.evaluate(() => closePreflight());
  await page.evaluate(() => { checkCompliance(); const b = [...document.querySelectorAll('#info-modal-bg .compliance-row button')].find(b => b.textContent.trim() === 'Move tags to the other edge'); b.click(); __close(); });
  const pos = await page.evaluate(() => gv('tag-pos'));
  expect(pos).toBe('br');
  const left = await page.evaluate((fn) => { render(); return new Function('return (' + fn + ')()')(); }, overlapsLetter.toString());
  expect(left).toEqual([]);
  expect(errors).toEqual([]);
});

// ── freeform4-05 ─────────────────────────────────────────────────────────────────────
test('freeform4-05: format marks in caption notes are converted in the caption and the alt text, as axis titles are', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 200, label: 'B', iw: 300, ih: 200 }]);
  const r = await page.evaluate(() => {
    freeformElements[0].captionNote = 'P_{lsrA}-mNeonGreen reporter cells 120 min after AI-2 addition';
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['strain', 'v'], rows: [['WT', 1], ['dluxS', 2]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1]; el.label = 'E'; el.x = 360; el.y = 20; el.w = 300; el.h = 220;
    el.chart.caption = 'GFP normalised to OD_{600}; mean ± SD';
    el._chartKey = ''; el._chartStat = null; render();
    const cap = _captionText();
    sv('caption-out', ''); const alt = _buildStructuralAltText();
    return { cap, alt };
  });
  expect(r.cap).not.toMatch(/_\{/);
  expect(r.cap).toMatch(/OD₆₀₀/);
  expect(r.cap).toMatch(/P_?lsrA|Pₗₛᵣₐ|P lsrA/);
  expect(r.alt).not.toMatch(/_\{/);
  expect(r.alt).toMatch(/lsrA/);
  expect(errors).toEqual([]);
});

// ── freeform4-06 ─────────────────────────────────────────────────────────────────────
test('freeform4-06: a circle clip keeps the scale bar inside the circle, or says it does not fit', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 40, y: 40, w: 300, h: 300, label: 'A', iw: 400, ih: 400 }]);
  const r = await page.evaluate(async () => {
    const el = freeformElements[0]; el.umPerPx = 0.1; el.sbOn = true; el.sbUm = 10; sc('sb-text', true); render();
    selectedElems.clear(); selectedElems.add(0); ffSetClip('circle'); render();
    const t = document.getElementById('toast').textContent, f = _ffFurniture(el);
    const R = el.w / 2, cx = el.x + R, cy = el.y + R, inC = (x, y) => Math.hypot(x - cx, y - cy) <= R + 0.01;
    const corners = [[f.sb.x, f.sb.y], [f.sb.x + f.sb.w, f.sb.y], [f.sb.x, f.sb.y + f.sb.h], [f.sb.x + f.sb.w, f.sb.y + f.sb.h]];
    const { pdf } = await __pdfOf(true);
    // the longest bar the object allows (under 60 % of its width) still fits inside
    el.sbUm = 23; render(); const g = _ffFurniture(el);
    const long = g.sb && [[g.sb.x, g.sb.y], [g.sb.x + g.sb.w, g.sb.y + g.sb.h]].every(([x, y]) => inC(x, y));
    return { t, inside: corners.every(([x, y]) => inC(x, y)) && inC(f.sbText.x, f.sbText.y - f.sbText.fs), pdfText: /\(10 \\265m\) Tj|\(10 µm\) Tj/.test(pdf), long };
  });
  expect(r.t).toMatch(/scale bar moved inside the clip/);
  expect(r.inside).toBe(true);
  expect(r.pdfText).toBe(true);
  expect(r.long).toBe(true);
  expect(errors).toEqual([]);
});

// ── newcomer4-01 ─────────────────────────────────────────────────────────────────────
test('newcomer4-01: the check notes a lopsided blank margin, Balance evens it, and a journal preset keeps typed margins', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', '2'); sv('rows', '2'); onLayoutChange(); applyPreset('asm'); render(); });
  const row = await page.evaluate(() => __row('Blank margins'));
  expect(row.icon).toBe('⚠');                                       // ASM asks for whitespace cropped
  expect(row.text).toMatch(/on the left [\d.]+ mm against [\d.]+ mm on the right/);
  expect(row.fixes).toContain('Balance margins');
  await page.evaluate(() => { checkCompliance(); [...document.querySelectorAll('#info-modal-bg .compliance-row button')].find(b => b.textContent.trim() === 'Balance margins').click(); __close(); });
  const after = await page.evaluate(() => ({ l: gi('m-left'), t: gi('m-top'), row: __row('Blank margins') }));
  expect(after.l).toBeLessThan(60);
  expect(after.t).toBeLessThan(40);
  expect(after.row).toBeNull();
  // typed margins survive a journal preset (it used to reset them to 50 / 30)
  await page.evaluate(() => { sv('m-left', '16'); sv('m-top', '16'); render(); applyPreset('nature'); });
  expect(await page.evaluate(() => [gi('m-left'), gi('m-top')])).toEqual([16, 16]);
  // the stock margins are still replaced by the preset's
  await page.evaluate(() => { sv('m-left', '60'); sv('m-top', '40'); applyPreset('plos'); });
  expect(await page.evaluate(() => [gi('m-left'), gi('m-top')])).toEqual([52, 32]);
  expect(errors).toEqual([]);
});

// ── newcomer4-02 ─────────────────────────────────────────────────────────────────────
test('newcomer4-02: FigureLab\'s bar takes the detected bar\'s length, and a copied calibration draws the same length', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    const bar = { px: 40, x: 20, y: 90, bright: true };   // 40 px of a 100 px field: the bar shows 5 µm
    applyScaleDetect(0, 40, 5, { bar });                            // "also draw FigureLab's bar", 5 µm
    const drawn = { um: images[0].sbUm, on: images[0].sbOn };
    applyScaleDetect(1, 40, 5, { bar, keep: true });                // keep the bar in the image
    renderImgList();
    const picks = [...document.querySelectorAll('#img-list .panel-pick')]; picks.forEach((cb, i) => { cb.checked = i === 2; });
    copyCalibrationToTicked(1);
    return { drawn, copy: images[2].sbUm, t: document.getElementById('toast').textContent };
  });
  expect(r.drawn).toEqual({ um: 5, on: true });
  expect(r.copy).toBe(5);
  expect(r.t).toMatch(/5 µm bar/);
  expect(errors).toEqual([]);
});

// ── phage4-18 ────────────────────────────────────────────────────────────────────────
test('phage4-18: the Nature format row says the PDF is one image with real text, and points to the SVG for vector', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    applyPreset('nature'); render();
    await _captureDownload(() => doExport('pdf-lossless'));
    const a = __row('Export format');
    await _captureDownload(() => doExport('svg'));
    return { a, b: __row('Export format') };
  });
  expect(r.a.text).toMatch(/holds the figure as one image/);
  expect(r.a.text).toMatch(/export SVG/);
  expect(r.b.text).toMatch(/the SVG is the vector file/);
  expect(errors).toEqual([]);
});

// ── blot4-08 + ISSUES "printed width kept" ────────────────────────────────────────────
test('blot4-08: the JBC preset says it set no width; a preset says "kept" only for a width set before it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange(); sv('export-width-mm', '0');
    applyPreset('jbc'); const jbc = document.getElementById('toast').textContent;
    sv('export-width-mm', '0'); applyPreset('nature'); const nat = document.getElementById('toast').textContent;
    applyPreset('plos'); applyPreset('asm'); const asm = document.getElementById('toast').textContent;
    return { jbc, nat, asm, w: gv('export-width-mm') };
  });
  expect(r.jbc).toMatch(/no printed width set — JBC’s data-presentation page states none/);
  expect(r.nat).not.toMatch(/kept at 183/);
  expect(r.nat).toMatch(/printed width 89 mm — the widest that keeps it within 170 mm tall/);
  expect(r.asm).toMatch(/printed width kept at 173 mm/);
  expect(errors).toEqual([]);
});

// ── freeform4-04 ─────────────────────────────────────────────────────────────────────
test('freeform4-04: Raise to 6 pt lifts text with a superscript far enough that the superscript passes too', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 60, w: 500, h: 380, label: 'A', iw: 400, ih: 300 }]);
  await page.evaluate(() => {
    sv('fm-canvas-w', '1328'); sv('fm-canvas-h', '700'); if (typeof onFreeformCanvasSize === 'function') onFreeformCanvasSize();
    sv('export-width-mm', '114');
    annotations.push({ type: 'textbox', xf: 0.6, yf: 0.5, x2f: 0.8, y2f: 0.56, text: '10^{8} cells', fontSize: 12, color: '#000000' });
    render();
  });
  await page.evaluate(() => { checkCompliance(); [...document.querySelectorAll('#info-modal-bg .compliance-row')].find(e => e.querySelector('.c-label').textContent.trim() === 'Text size')
    .querySelectorAll('button').forEach(b => { if (/^Raise to 6 pt/.test(b.textContent.trim())) b.click(); }); __close(); });
  const r = await page.evaluate(() => ({ row: __row('Text size'), t: document.getElementById('toast').textContent,
    pt: annotations.find(a => a.type === 'textbox').fontSize * _physFacts().ptPerPx }));
  expect(r.pt * 0.7).toBeGreaterThanOrEqual(4.95);
  expect(r.row.icon).toBe('✓');
  expect(r.t).toMatch(/superscripts and subscripts print at 5 pt/);
  expect(errors).toEqual([]);
});

// ── freeform4-09 ─────────────────────────────────────────────────────────────────────
test('freeform4-09: an icon is not counted as an unlettered panel', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 200, label: 'A' }, { type: 'image', x: 240, y: 20, w: 200, h: 200, label: 'B' }]);
  await page.evaluate(() => insertIcon('bacterium'));
  await page.waitForFunction(() => freeformElements.some(e => e && e.isIcon));
  const r = await page.evaluate(() => { render(); return __row('Panel labels'); });
  expect(r.icon).toBe('✓');
  expect(r.text).toMatch(/2\/2 panels labelled/);
  expect(errors).toEqual([]);
});

// ── newcomer4-05 ─────────────────────────────────────────────────────────────────────
test('newcomer4-05: sparse fields whose regions were compared are not reported as "nothing was checked"', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const mk = () => { const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d');
      x.fillStyle = 'rgb(150,150,150)'; x.fillRect(0, 0, 512, 512);
      const d = x.getImageData(0, 0, 512, 512); for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 6; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } x.putImageData(d, 0, 0);
      for (let k = 0; k < 40; k++) { const cx = rnd() * 512, cy = rnd() * 512, a = rnd() * Math.PI; x.save(); x.translate(cx, cy); x.rotate(a);
        x.fillStyle = 'rgb(110,110,110)'; x.fillRect(-12, -3, 24, 6); x.fillStyle = 'rgb(185,185,185)'; x.fillRect(-12, -4, 24, 1.5); x.restore(); }
      return c.toDataURL('image/jpeg', 0.9); };
    for (let i = 0; i < 3; i++) { const src = mk(); await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'WT_DIC_63x_00' + i + '.jpg'); r(); }; im.src = src; }); }
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); render();
    runDuplicateScan();
  });
  const txt = await page.locator('.modal-bg.open').last().innerText();
  expect(txt).not.toMatch(/Nothing was checked/);
  expect(txt).not.toMatch(/no duplicate check has been performed/);
  expect(txt).toMatch(/Whole-panel comparison skipped/);
  expect(txt).toMatch(/Their regions were compared/);
  expect(txt).toMatch(/textured patches compared across 3 panels/);
  expect(errors).toEqual([]);
});

// ── newcomer4-06 / newcomer4-08 ──────────────────────────────────────────────────────
test('newcomer4-06/08: the headline names the export still to do; PLOS names the files without losing the typed name', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    sv('export-name', 'Figure 1'); applyPreset('plos');
    const t1 = __report().title, name1 = gv('export-name'), toast1 = document.getElementById('toast').textContent;
    await _captureDownload(() => doExport('tiff'));
    const t2 = __report().title;
    const readme = _packageManifest(gv('export-name'), 300, [], '', [], []);
    applyPreset('nature');
    return { t1, t2, name1, toast1, readme, name2: gv('export-name') };
  });
  expect(r.t1).toMatch(/passed · 1 to do: export as TIFF/);
  expect(r.t2).not.toMatch(/to do/);
  expect(r.name1).toBe('Fig1');
  expect(r.toast1).toMatch(/your name “Figure 1” is kept/);
  expect(r.readme).toMatch(/Figure name : Fig1 \(the journal's file name; you named it “Figure 1”\)/);
  expect(r.name2).toBe('Figure 1');
  expect(errors).toEqual([]);
});

// ── blot4-10 / blot4-16 / fluor4-08 ─────────────────────────────────────────────────
test('blot4-10/16: unlettered strips are named by their row heading in the reports and the S1 dialog; MW labels are called that', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '3'); onLayoutChange();
    sc('show-row-labels', true); onLayoutChange(); setAxisLabels('row', ['pAKT', 'AKT', 'GAPDH']);
    images[1].label = ''; images[2].label = ''; render();
    annotations.push({ type: 'text', xf: 0.02, yf: 0.5, text: '55', fontSize: 13, color: '#000', halo: false, blotPanel: images[2].id, mw: true });
    render();
    const who = [_panelWho(images[1]), _panelWho(images[2])];
    const ppi = _panelPpiList(2400).map(p => p.label);
    openS1Dialog(); const s1 = document.getElementById('s1-list').innerText; document.getElementById('s1-modal-bg').remove();
    return { who, ppi, s1, glyph: [...document.querySelectorAll('button')].filter(b => /Export uncropped originals/.test(b.textContent)).map(b => b.textContent.trim()[0]) };
  });
  expect(r.who).toEqual(['the AKT strip', 'the GAPDH strip']);
  expect(r.ppi).toContain('the GAPDH strip');
  expect(r.s1).toMatch(/the GAPDH strip/);
  expect(r.s1).not.toMatch(/^\?/m);
  expect(r.s1).toMatch(/MW labels/);
  r.glyph.forEach(g => expect(g).not.toBe('🗎'));
  expect(errors).toEqual([]);
});

test('fluor4-08: Insert blank cell says which panel it follows', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const t = await page.evaluate(() => { selectedPanel = 1; insertBlankCell(); return document.getElementById('toast').textContent; });
  expect(t).toMatch(/Blank cell inserted after panel B/);
  expect(t).not.toMatch(/slot/);
  expect(errors).toEqual([]);
});
