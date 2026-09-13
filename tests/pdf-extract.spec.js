// @ts-check
// Writes a real exported PDF to disk so an INDEPENDENT parser (pypdf) can be run
// against it — proving the file is valid and its text is genuinely extractable,
// rather than only matching this project's own idea of the PDF spec.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');
const fs = require('fs'), path = require('path');

const OUT = path.join(__dirname, '.pdfout');

test('write exported PDFs to disk for external validation', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  fs.mkdirSync(OUT, { recursive: true });

  const grab = (setup, lossless) => page.evaluate(async ({ setup, lossless }) => {
    new Function(setup)();
    let cap = null;
    const realDl = window.dl;
    window.dl = (url) => { cap = url; };
    try {
      await _exportPDFWithText('probe', 300, { lossless });
      const buf = await (await fetch(cap)).arrayBuffer();
      return Array.from(new Uint8Array(buf));
    } finally { window.dl = realDl; }
  }, { setup, lossless });

  // 1. Panel letters + a micron scale bar, lossless (Flate) image
  const a = await grab(`
    sv('show-labels', true); sv('label-format', 'ABC'); sv('sb-text', true);
    images[0].umPerPx = 0.5; images[0].sbUm = 20; images[0].sbOn = true;
    images[0].sbUnit = '\\u00b5m';
    sv('fig-title', 'Figure 1 (n=3)');
    render();
  `, true);
  fs.writeFileSync(path.join(OUT, 'labels.pdf'), Buffer.from(a));

  // 2. Same figure as a JPEG-image PDF, with a Greek label that must stay raster
  const b = await grab(`
    sv('show-labels', true); sv('label-format', 'custom');
    images[0].label = '\\u03b1-tubulin'; images[1].label = 'GAPDH';
    render();
  `, false);
  fs.writeFileSync(path.join(OUT, 'mixed.pdf'), Buffer.from(b));

  // 3. The same four panels as a two-page lossless PDF with row labels: the second
  //    page must continue the lettering (C, D) and carry the second row's label.
  const c = await page.evaluate(async () => {
    sv('show-labels', true); sv('label-format', 'ABC'); sv('cols', '2'); sv('rows', '2');
    images[0].label = 'A'; images[1].label = 'B';      // step 2 renamed these
    sv('show-row-labels', true); onLayoutChange();
    const ins = [...document.querySelectorAll('#row-label-inputs input')];
    ins[0].value = 'mock'; ins[1].value = 'treated';
    document.getElementById('pdf-rows-per-page').value = '1';
    render();
    let cap = null;
    const realDl = window.dl;
    window.dl = (url) => { cap = url; };
    try {
      await exportMultiPagePDF();
      return Array.from(new Uint8Array(await (await fetch(cap)).arrayBuffer()));
    } finally { window.dl = realDl; }
  });
  fs.writeFileSync(path.join(OUT, 'multipage.pdf'), Buffer.from(c));

  expect(a.length).toBeGreaterThan(1000);
  expect(b.length).toBeGreaterThan(1000);
  expect(c.length).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});
