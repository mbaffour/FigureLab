// @ts-check
// PDF vector text: the figure's labels are laid down as real PDF text operators
// over the image, not baked into the raster.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

/**
 * Export a PDF and return its bytes as a latin1 string (so byte offsets in the
 * xref table line up with string indices) plus the raw byte length.
 */
async function grabPDF(page, before) {
  return page.evaluate(async (beforeBody) => {
    if (beforeBody) new Function(beforeBody)();
    let captured = null;
    const realDl = window.dl;
    // dl(url, filename) — intercept and read the blob back
    window.dl = async (url, fn) => { captured = { url, fn }; };
    try {
      await _exportPDFWithText('probe', 300, { lossless: true });
      if (!captured) return { err: 'no download' };
      const buf = await (await fetch(captured.url)).arrayBuffer();
      const u8 = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return { name: captured.fn, len: u8.length, bytes: s };
    } finally { window.dl = realDl; }
  }, before || null);
}

test('the PDF carries a real font resource and text operators', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await grabPDF(page, `
    sv('show-labels', true); sv('label-format', 'ABC'); render();
  `);
  expect(r.err).toBeUndefined();
  expect(r.name).toBe('probe.pdf');
  expect(r.bytes.startsWith('%PDF-1.4')).toBe(true);
  expect(r.bytes).toContain('/Type /Font');
  expect(r.bytes).toContain('/Subtype /Type1');
  expect(r.bytes).toContain('/BaseFont /Helvetica');
  expect(r.bytes).toContain('/Encoding /WinAnsiEncoding');
  expect(r.bytes).toContain('/Font <<');          // the page resource dict
  // text-showing operators inside the content stream
  expect(r.bytes).toMatch(/BT \/F\d+ [\d.]+ Tf/);
  expect(r.bytes).toContain(' Tj ET');
  // no font FILE is embedded — base-14 only, so the single-file constraint holds
  expect(r.bytes).not.toContain('/FontFile');
  expect(errors).toEqual([]);
});

test('panel letters appear as literal, selectable text', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await grabPDF(page, `
    sv('show-labels', true); sv('label-format', 'ABC'); render();
  `);
  // A/B/C/D are drawn as text, so the letters are in the content stream verbatim
  for (const L of ['A', 'B', 'C', 'D']) expect(r.bytes).toContain(`(${L}) Tj`);
  expect(errors).toEqual([]);
});

test('a micron scale-bar label survives as WinAnsi text', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await grabPDF(page, `
    images[0].umPerPx = 0.5; images[0].sbUm = 20; images[0].sbOn = true;
    images[0].sbUnit = '\\u00b5m';
    sv('sb-text', true); render();
  `);
  // µ is 0xB5 in WinAnsi, emitted as an octal escape inside the literal string
  expect(r.bytes).toMatch(/\(20 \\265m\) Tj/);
  expect(errors).toEqual([]);
});

test('text the base-14 font cannot represent stays in the raster, never mangled', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    // Greek and comparison operators have no WinAnsi code point
    const ok = _pdfCanTypeset({ str: 'Control 20 \u00b5m' });
    const greek = _pdfCanTypeset({ str: '\u03b1-tubulin' });
    const cmp = _pdfCanTypeset({ str: 'p \u2265 0.05' });
    const tick = _pdfCanTypeset({ str: '\u2713 done' });
    const empty = _pdfCanTypeset({ str: '' });
    return { ok, greek, cmp, tick, empty };
  });
  expect(r.ok).toBe(true);
  expect(r.greek).toBe(false);      // α — must stay raster
  expect(r.cmp).toBe(false);        // ≥
  expect(r.tick).toBe(false);       // ✓
  expect(r.empty).toBe(false);
  expect(errors).toEqual([]);
});

test('an unrepresentable label is still drawn — it is skipped from text, not dropped', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('show-labels', true); sv('label-format', 'custom');
    images[0].label = '\u03b1-tubulin';        // no WinAnsi representation
    images[1].label = 'GAPDH';                 // plain ASCII
    render();
    // the raster render used for the PDF skips ONLY what the text layer will draw
    const painted = [];
    const off = document.createElement('canvas');
    const origFill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y) {
      painted.push(s); return origFill.apply(this, arguments);
    };
    try { render(off, 2, { skipLabels: _pdfCanTypeset }); }
    finally { CanvasRenderingContext2D.prototype.fillText = origFill; }
    return { painted, items: figTextItems.map(i => i.str) };
  });
  // the Greek label was painted into the raster; the ASCII one was held back for text
  expect(r.painted).toContain('\u03b1-tubulin');
  expect(r.painted).not.toContain('GAPDH');
  // both are still recorded as text items (the PDF layer filters again)
  expect(r.items).toContain('\u03b1-tubulin');
  expect(r.items).toContain('GAPDH');
  expect(errors).toEqual([]);
});

test('the xref table matches the objects actually written', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await grabPDF(page, `sv('show-labels', true); render();`);
  const b = r.bytes;
  // /Size N in the trailer must equal 1 + the highest object number
  const size = +(/\/Size (\d+)/.exec(b) || [])[1];
  const objNums = [...b.matchAll(/(\d+) 0 obj/g)].map(m => +m[1]);
  expect(size).toBe(Math.max(...objNums) + 1);
  // every xref offset must actually point at "<n> 0 obj"
  const xrefStart = +(/startxref\s+(\d+)/.exec(b) || [])[1];
  expect(b.slice(xrefStart, xrefStart + 4)).toBe('xref');
  const rows = [...b.slice(xrefStart).matchAll(/^(\d{10}) 00000 n/gm)].map(m => +m[1]);
  expect(rows.length).toBe(size - 1);
  rows.forEach((off, i) => {
    expect(b.slice(off, off + 12)).toContain(`${i + 1} 0 obj`);
  });
  expect(errors).toEqual([]);
});

test('text sits at the right place on the page, in PDF y-up coordinates', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    // one item, top-left-ish, alphabetic baseline, left aligned
    const items = [{ str: 'X', x: 100, y: 50, fs: 10, font: '10px system-ui',
                     fill: '#000000', align: 'left', baseline: 'alphabetic', rot: 0 }];
    const k = 2, hPt = 400;
    const { ops, fonts } = _pdfTextOps(items, k, hPt);
    const m = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(ops);
    return { x: +m[1], y: +m[2], size: +(/\/F1 ([\d.]+) Tf/.exec(ops)[1]), nFonts: fonts.size, ops };
  });
  expect(r.x).toBeCloseTo(200, 2);          // 100 logical * k=2
  expect(r.y).toBeCloseTo(300, 2);          // hPt 400 - 50*2  → y flipped
  expect(r.size).toBeCloseTo(20, 2);        // 10 logical * k=2
  expect(r.nFonts).toBe(1);
  expect(errors).toEqual([]);
});

test('centred text is shifted to its left edge, since PDF has no text-anchor', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const mk = align => [{ str: 'WIDE LABEL', x: 100, y: 50, fs: 10, font: '10px system-ui',
                           fill: '#000000', align, baseline: 'alphabetic', rot: 0 }];
    const at = align => +(/1 0 0 1 ([\d.]+) /.exec(_pdfTextOps(mk(align), 1, 400).ops)[1]);
    const c = document.createElement('canvas').getContext('2d');
    c.font = '10px system-ui';
    return { left: at('left'), center: at('center'), w: c.measureText('WIDE LABEL').width };
  });
  expect(r.left).toBeCloseTo(100, 1);
  expect(r.center).toBeCloseTo(100 - r.w / 2, 1);   // shifted back by half the width
  expect(errors).toEqual([]);
});

test('rotated axis labels use a rotated text matrix', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const items = [{ str: 'Row 1', x: 30, y: 200, fs: 10, font: '10px system-ui',
                     fill: '#000000', align: 'center', baseline: 'alphabetic', rot: 1 }];
    return _pdfTextOps(items, 1, 400).ops;
  });
  expect(r).toMatch(/0 1 -1 0 [\d.]+ [\d.]+ Tm/);   // +90° in PDF space
  expect(r).toContain('(Row 1) Tj');
  expect(errors).toEqual([]);
});

test('bold and serif labels map to the matching base-14 face', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => ({
    plain: _pdfFontFor('10px system-ui, sans-serif'),
    bold: _pdfFontFor('bold 10px Arial'),
    ital: _pdfFontFor('italic 10px Helvetica'),
    both: _pdfFontFor('italic bold 12px sans-serif'),
    serif: _pdfFontFor('12px Georgia, serif'),
    serifBold: _pdfFontFor('bold 12px Times New Roman'),
    mono: _pdfFontFor('11px Consolas, monospace'),
  }));
  expect(r.plain).toBe('Helvetica');
  expect(r.bold).toBe('Helvetica-Bold');
  expect(r.ital).toBe('Helvetica-Oblique');
  expect(r.both).toBe('Helvetica-BoldOblique');
  expect(r.serif).toBe('Times-Roman');
  expect(r.serifBold).toBe('Times-Bold');
  expect(r.mono).toBe('Courier');
  expect(errors).toEqual([]);
});

test('parentheses and backslashes in a label are escaped, not left to corrupt the file', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const items = [{ str: 'A (n=3) \\ 50%', x: 10, y: 10, fs: 10, font: '10px system-ui',
                     fill: '#000000', align: 'left', baseline: 'alphabetic', rot: 0 }];
    return _pdfTextOps(items, 1, 100).ops;
  });
  expect(r).toContain('(A \\(n=3\\) \\\\ 50%) Tj');
  expect(errors).toEqual([]);
});

test('the figure still exports when it has no typesettable text at all', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await grabPDF(page, `sv('show-labels', false); sv('sb-text', false); render();`);
  expect(r.err).toBeUndefined();
  expect(r.bytes.startsWith('%PDF-1.4')).toBe(true);
  expect(r.bytes).toContain('%%EOF');
  expect(r.len).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('exporting a PDF leaves the on-screen canvas intact', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const before = await page.evaluate(() => {
    render();
    return { w: document.getElementById('fig-canvas').width, pb: panelBounds.length,
             ann: annCanvas.width, items: figTextItems.length };
  });
  await grabPDF(page, null);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    w: document.getElementById('fig-canvas').width, pb: panelBounds.length,
    ann: annCanvas.width, items: figTextItems.length,
  }));
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});
