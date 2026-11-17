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
