// @ts-check
// Regression tests for the September 2026 independent audit (AUDIT-2026-09.md).
//
// The audit's central finding was that the "Printed width" control corrupted every
// physical-size number FigureLab writes into a file while the on-screen readout and
// the compliance check both said the figure was fine. What caught it was reading the
// EXPORTED BYTES — the pHYs chunk, the TIFF resolution tags, the PDF /MediaBox — not
// the app's own idea of what it had produced. Every test below does the same: it
// asserts what a journal's pre-flight would see, not what a variable holds.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { loadApp, seedPanels, seedFreeform, APP_URL } = require('./helpers');

const REPO = path.resolve(__dirname, '..');

// ── in-page byte parsers, injected as source so page.evaluate can use them ──────
// Kept as strings because page.evaluate cannot close over Node-side functions.
const PARSERS = `
  // PNG pHYs → { ppmX, dpi } (unit specifier 1 = metre). Returns null if absent.
  window._pngPhys = (bytes) => {
    let p = 8;
    while (p + 8 <= bytes.length) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset);
      const len = dv.getUint32(p);
      const type = String.fromCharCode(bytes[p+4], bytes[p+5], bytes[p+6], bytes[p+7]);
      if (type === 'pHYs') {
        const ppmX = dv.getUint32(p+8), ppmY = dv.getUint32(p+12);
        return { ppmX, ppmY, dpi: ppmX * 0.0254 };
      }
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return null;
  };
  // PNG IHDR → { w, h }
  window._pngSize = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  };
  // Little-endian TIFF → XResolution as a number (RATIONAL num/den).
  window._tiffXRes = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const ifd = dv.getUint32(4, true);
    const n = dv.getUint16(ifd, true);
    for (let i = 0; i < n; i++) {
      const off = ifd + 2 + i*12;
      if (dv.getUint16(off, true) === 282) {
        const vo = dv.getUint32(off+8, true);
        return dv.getUint32(vo, true) / dv.getUint32(vo+4, true);
      }
    }
    return null;
  };
  // Every /MediaBox in a PDF, as [wPt, hPt] pairs.
  window._pdfMediaBoxes = (bytes) => {
    const txt = new TextDecoder('latin1').decode(bytes);
    const out = [];
    const re = /\\/MediaBox\\s*\\[\\s*0\\s+0\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\]/g;
    let m; while ((m = re.exec(txt))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
    return out;
  };
  // Stored (method 0) ZIP → { name: Uint8Array }. The app's writer never deflates.
  window._zipRead = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const csize = dv.getUint32(p+18, true);
      const nlen = dv.getUint16(p+26, true), elen = dv.getUint16(p+28, true);
      const name = new TextDecoder().decode(bytes.subarray(p+30, p+30+nlen));
      const dataOff = p + 30 + nlen + elen;
      out[name] = bytes.subarray(dataOff, dataOff + csize);
      p = dataOff + csize;
    }
    return out;
  };
`;

const inject = (page) => page.evaluate(PARSERS);

// ═══════════════════════════════════════════════════════════════════════════════
// FL-1 — the printed-width target must reach the exported bytes
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-1: a printed-width target writes the right DPI and physical size into PNG, TIFF and PDF', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await inject(page);

  const r = await page.evaluate(async () => {
    sv('export-dpi', '300');
    sv('export-width-mm', '183');          // Nature double column
    render();

    const c = renderExportCanvas(300);
    const png = await _captureDownload(() => exportPNGWithMeta('t', c._effDpi || 300, c));
    const tc  = renderExportCanvas(300);
    const tif = await _captureDownload(() => exportTIFF('t', tc._effDpi || 300, tc, true));
    const pdf = await _captureDownload(() => _exportPDFWithText('t', 300, { lossless: false }));

    const phys = _pngPhys(png.data);
    const mb = _pdfMediaBoxes(pdf.data)[0];
    return {
      logicalW: canvasLogicalW,
      exportPx: c.width,
      effDpi: c._effDpi,
      pngDpi: phys.dpi,
      pngClaimsMm: c.width / phys.dpi * 25.4,
      tiffDpi: _tiffXRes(tif.data),
      pdfWidthMm: mb[0] / 72 * 25.4,
      readoutMm: _physFacts().wMm,
    };
  });

  // The figure was targeted at 183 mm and 300 DPI. Everything a journal reads must
  // say so — this used to be 210 dpi and 261 mm in all three formats at once.
  expect(r.readoutMm).toBeCloseTo(183, 1);
  expect(r.effDpi).toBe(300);
  expect(r.pngDpi).toBeGreaterThan(299);
  expect(r.pngDpi).toBeLessThan(301);
  expect(r.pngClaimsMm).toBeGreaterThan(182.5);
  expect(r.pngClaimsMm).toBeLessThan(183.5);
  expect(r.tiffDpi).toBe(300);
  expect(r.pdfWidthMm).toBeGreaterThan(182.5);
  expect(r.pdfWidthMm).toBeLessThan(183.5);
  expect(errors).toEqual([]);
});

test('FL-1: every column-width preset lands within half a millimetre of its target', async ({ page }) => {
  // The arithmetic reproduction from the audit (effdpi.mjs), run against the real
  // export path instead of a model of it. The old error scaled as dpi*25.4*lw/(96*mm),
  // so the narrow single-column presets at high DPI were the worst cases.
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await inject(page);

  const cases = [
    { mm: 183,   dpi: 300 },   // Nature double column
    { mm: 89,    dpi: 600 },   // Nature single column, line art
    { mm: 174,   dpi: 300 },   // Cell double column
    { mm: 55,    dpi: 600 },   // Science single column — narrowest preset
    { mm: 183.5, dpi: 300 },
  ];

  const rows = await page.evaluate(async (cs) => {
    const out = [];
    for (const c of cs) {
      sv('export-dpi', String(c.dpi));
      sv('export-width-mm', String(c.mm));
      render();
      const cv = renderExportCanvas(c.dpi);
      const png = await _captureDownload(() => exportPNGWithMeta('t', cv._effDpi || c.dpi, cv));
      const dpi = _pngPhys(png.data).dpi;
      out.push({ ...c, effDpi: cv._effDpi, claimsMm: cv.width / dpi * 25.4 });
    }
    return out;
  }, cases);

  for (const row of rows) {
    expect(Math.abs(row.claimsMm - row.mm),
      `${row.mm} mm @ ${row.dpi} dpi claimed ${row.claimsMm.toFixed(2)} mm`).toBeLessThan(0.5);
    expect(Math.abs(row.effDpi - row.dpi),
      `${row.mm} mm @ ${row.dpi} dpi tagged ${row.effDpi} dpi`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('FL-1: free width is unchanged — logical px stay 1/96 inch', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await inject(page);
  const r = await page.evaluate(async () => {
    sv('export-dpi', '300'); sv('export-width-mm', '0'); render();
    const c = renderExportCanvas(300);
    const png = await _captureDownload(() => exportPNGWithMeta('t', c._effDpi || 300, c));
    return { effDpi: c._effDpi, pngDpi: _pngPhys(png.data).dpi,
             expectMm: canvasLogicalW / 96 * 25.4, claimsMm: c.width / _pngPhys(png.data).dpi * 25.4 };
  });
  expect(r.effDpi).toBe(300);
  expect(Math.round(r.pngDpi)).toBe(300);
  expect(Math.abs(r.claimsMm - r.expectMm)).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FL-3 — per-panel PNGs in the submission package
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-3: submission-package panel PNGs are cropped at the render scale, not dpi/96', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await inject(page);

  const r = await page.evaluate(async () => {
    sv('export-dpi', '300');
    sv('export-width-mm', '183');
    render();
    const scale = renderExportCanvas(300)._exportScale;
    const bounds = panelBounds.map(b => ({ idx: b.idx, w: b.w, h: b.h }));
    const zipCap = await _captureDownload(() => exportSubmissionPackage());
    const files = _zipRead(zipCap.data);
    const panels = Object.keys(files).filter(n => /^panels\/panel_/.test(n))
      .map(n => ({ name: n, ...(_pngSize(files[n])) }));
    return { scale, wrongScale: Math.max(1, 300/96), bounds, panels, exportW: renderExportCanvas(300).width };
  });

  expect(r.panels.length).toBe(4);
  // The crop scale the code used to apply (3.125) differs from the real render scale,
  // so this only passes if the crop rectangle is in the canvas's own coordinates.
  expect(Math.abs(r.scale - r.wrongScale)).toBeGreaterThan(0.5);
  for (const p of r.panels) {
    const expected = Math.round(r.bounds[0].w * r.scale);
    expect(Math.abs(p.w - expected), `${p.name} is ${p.w}px, expected ~${expected}px`).toBeLessThanOrEqual(1);
    // A crop that ran off the right edge of the canvas produced a blank/partial panel.
    expect(p.w).toBeLessThanOrEqual(r.exportW);
  }
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FL-2 / FL-4 — the caption is the artefact that reaches the manuscript
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-2: the caption reports µm/px and never invents a magnification', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const cap = await page.evaluate(() => {
    // A 100x oil objective on a 6.5 µm camera pixel. The old code printed this as "15×".
    images.forEach(im => { im.umPerPx = 0.065; im.sbOn = true; im.sbUm = 10; im.sbUnit = 'µm'; });
    render(); generateCaption();
    return document.getElementById('caption-out').value;
  });
  expect(cap).not.toMatch(/\d\s*×\)/);       // no fabricated magnification
  expect(cap).not.toContain('15×');
  expect(cap).toContain('0.065 µm per pixel');
  expect(cap).toContain('Scale bar, 10 µm');
  expect(errors).toEqual([]);
});

test('FL-4: the caption discloses every adjustment actually applied', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const a = images[0];
    a.gamma = 0.45; a.brightness = 1.6; a.contrast = 1.3; a.invert = true;
    a.blackPt = 12; a.whitePt = 240; a.lut = 'fire';
    images[1].gamma = 1; images[1].brightness = 1; images[1].contrast = 1;
    render(); generateCaption();
    return document.getElementById('caption-out').value;
  });
  expect(r).toContain('gamma 0.45');
  expect(r).toMatch(/non-linear/i);          // the wording journals ask for
  expect(r).toContain('brightness ×1.60');
  expect(r).toContain('contrast ×1.30');
  expect(r).toMatch(/signal inverted/i);
  expect(r).toMatch(/levels 12–240/i);
  expect(r).toMatch(/fire/i);                // the LUT is named
  // Panels differ, so the legend must say so rather than let a reader assume uniformity.
  expect(r).toMatch(/differ between panels/i);
  expect(errors).toEqual([]);
});

test('FL-4: identical settings across panels are declared as uniform', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    images.forEach(im => { im.gamma = 0.8; });
    render(); generateCaption();
    return document.getElementById('caption-out').value;
  });
  expect(r).toMatch(/same adjustment settings were applied to every panel/i);
  expect(errors).toEqual([]);
});

test('FL-4: an untouched figure gets no adjustment sentence at all', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => { render(); generateCaption();
    return document.getElementById('caption-out').value; });
  expect(r).not.toMatch(/gamma|brightness ×|levels \d/i);
  expect(r).not.toMatch(/adjustment settings/i);
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FL-5 / FL-10 — the multi-page PDF
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-5: multi-page PDF pages are the same physical size as the single-page PDF', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await inject(page);

  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '2'); sv('export-dpi', '300'); sv('export-width-mm', '183');
    document.getElementById('pdf-rows-per-page').value = '1';
    onLayoutChange(); render();
    const multi = await _captureDownload(() => exportMultiPagePDF());
    const boxes = _pdfMediaBoxes(multi.data);
    return { boxes, panels: images.filter(Boolean).length };
  });

  expect(r.boxes.length).toBe(2);                 // 2 rows, 1 row per page
  for (const [wPt] of r.boxes) {
    const mm = wPt / 72 * 25.4;
    // Was 83.7 mm (the 1x preview canvas divided by the requested DPI) for a figure
    // whose single-page PDF was 261 mm — and the printed width was ignored outright.
    expect(Math.abs(mm - 183), `page is ${mm.toFixed(1)} mm wide`).toBeLessThan(0.6);
  }
  expect(errors).toEqual([]);
});

test('FL-10: a throw mid-export cannot destroy the panel list', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '2');
    document.getElementById('pdf-rows-per-page').value = '1';
    onLayoutChange(); render();
    const before = images.map(im => im && im.label);
    const orig = window.renderExportCanvas;
    window.renderExportCanvas = () => { throw new Error('simulated OOM'); };
    let threw = false;
    try { await exportMultiPagePDF(); } catch (e) { threw = true; }
    window.renderExportCanvas = orig;
    return { threw, before, after: images.map(im => im && im.label), rows: gv('rows') };
  });
  expect(r.threw).toBe(true);                     // the failure is not swallowed
  expect(r.after).toEqual(r.before);              // …but the user's panels survive it
  expect(r.after.length).toBe(4);
  expect(r.rows).toBe('2');                       // and so does the row count
});

// ═══════════════════════════════════════════════════════════════════════════════
// FL-6 / FL-13 — scale bars
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-6: a scale bar that cannot be drawn fails the compliance check with a reason', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    // 25 µm of a 100 px source shown in one panel: a bar a quarter of the panel wide.
    images.forEach(im => { im.umPerPx = 1; im.sbOn = true; im.sbUm = 25; });
    render();
    const drawnOk = _scaleBarsNotDrawn().length;
    // A mistyped calibration or unit: metres of bar in a 300 px panel.
    images[0].sbUm = 100000;
    render();
    const skipped = _scaleBarsNotDrawn();
    checkCompliance();
    const html = document.getElementById('info-modal-bg').innerHTML;
    const row = html.split('<div class="compliance-row">').find(s => s.includes('Scale bar drawn')) || '';
    return { drawnOk, skipped, bars: _sbBars.length, failed: row.includes('✗'), row };
  });
  expect(r.drawnOk).toBe(0);                      // both bars drawn before the mistake
  expect(r.skipped.length).toBe(1);
  expect(r.skipped[0].why).toMatch(/longer than 75%/);
  expect(r.failed).toBe(true);                    // used to report "All calibrated ✓"
  expect(r.row).toMatch(/NOT drawn/);
  expect(errors).toEqual([]);
});

test('FL-13: the grid scale bar is not quantised to whole logical pixels', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    sv('panel-w', '300'); sv('panel-h', '300'); onLayoutChange();
    const im = images[0];
    im.umPerPx = 0.16; im.sbOn = true; im.sbUm = 2;   // the audit's worst case: +9.2 % when rounded
    render();
    const bar = _sbBars[0];
    const drawn = bar.right - bar.left;
    const exact = (im.sbUm / im.umPerPx) * bar.scale;
    return { drawn, exact, pctErr: Math.abs(drawn - exact) / exact * 100 };
  });
  expect(r.pctErr).toBeLessThan(0.001);           // sub-pixel, so export DPI reduces the error
  expect(Number.isInteger(r.drawn)).toBe(false);  // the round() is gone
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FL-7 — the offline claim
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-7: the app source contains no fetchable external URL', async () => {
  const html = fs.readFileSync(path.join(REPO, 'figure_lab.html'), 'utf8');
  // Anything that makes the browser go to the network on its own: a stylesheet or
  // script tag, a CSS url(), an <img>/<image> src, or an @import.
  const offenders = [];
  const scan = (re, what) => {
    let m; while ((m = re.exec(html))) offenders.push(`${what}: ${m[0].slice(0, 120)}`);
  };
  scan(/<link\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi, 'link');
  scan(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+["']/gi, 'script src');
  scan(/url\(\s*['"]?https?:\/\/[^)'"]+/gi, 'css url()');
  scan(/@import\s+(url\()?['"]?https?:\/\//gi, '@import');
  scan(/<(?:img|image)\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi, 'img src');
  scan(/xlink:href\s*=\s*["']https?:\/\//gi, 'xlink:href');
  expect(offenders, `figure_lab.html would fetch:\n${offenders.join('\n')}`).toEqual([]);
});

test('FL-7: opening the app issues zero network requests', async ({ page }) => {
  const external = [];
  page.on('request', req => { if (!req.url().startsWith('file://')) external.push(req.url()); });
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof render === 'function');
  // Give any deferred font/icon fetch a chance to fire before asserting.
  await page.waitForTimeout(400);
  expect(external, `the app requested:\n${external.join('\n')}`).toEqual([]);
});

test('FL-7: placing the line-chart icon does not reach a third-party font host', async ({ page }) => {
  const external = [];
  page.on('request', req => { if (!req.url().startsWith('file://')) external.push(req.url()); });
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof render === 'function');
  const hasRemoteFace = await page.evaluate(() => {
    const ic = SCIENCE_ICONS && SCIENCE_ICONS.bi_line;
    // The w3.org xmlns is inert; an @font-face or a url(https://…) is not.
    return !!(ic && (/@font-face/.test(ic.svg) || /url\(\s*['"]?https?:/.test(ic.svg)));
  });
  expect(hasRemoteFace).toBe(false);
  await page.waitForTimeout(300);
  expect(external).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FL-8 / FL-11 / FL-12
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-8: SVG export declares the printed width it was asked for', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('export-dpi', '300');
    sv('export-width-mm', '0'); render();
    const free = await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')));
    const freeTxt = new TextDecoder().decode(free.data);
    sv('export-width-mm', '183'); render();
    const tgt = await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')));
    const tgtTxt = new TextDecoder().decode(tgt.data);
    const wIn = s => parseFloat(/width="([\d.]+)in"/.exec(s)[1]);
    const vb = s => /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s).slice(1).map(Number);
    return { freeIn: wIn(freeTxt), tgtIn: wIn(tgtTxt), freeVb: vb(freeTxt), tgtVb: vb(tgtTxt),
             logicalW: canvasLogicalW };
  });
  expect(r.freeIn).toBeCloseTo(r.logicalW / 96, 3);       // unchanged with no target
  expect(r.tgtIn * 25.4).toBeCloseTo(183, 1);             // used to ignore the setting
  expect(r.tgtVb).toEqual(r.freeVb);                      // the vector layer is untouched
  expect(errors).toEqual([]);
});

test('FL-11: an artefact that fails is named, not silently dropped', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await inject(page);
  const r = await page.evaluate(async () => {
    const orig = window.exportTIFF;
    window.exportTIFF = () => { throw new Error('canvas too large'); };
    const cap = await _captureDownload(() => exportSubmissionPackage());
    window.exportTIFF = orig;
    const files = _zipRead(cap.data);
    const readme = new TextDecoder().decode(files['README.txt'] || new Uint8Array());
    const modal = document.getElementById('info-modal-bg');
    return {
      names: Object.keys(files),
      skips: _captureSkips.map(s => s.label),
      readme,
      modal: modal ? modal.textContent : '',
    };
  });
  expect(r.names.some(n => /\.tiff?$/.test(n))).toBe(false);   // it really is missing
  expect(r.skips).toContain('TIFF');
  expect(r.readme).toMatch(/NOT INCLUDED/);
  expect(r.readme).toMatch(/TIFF: canvas too large/);
  expect(r.modal).toMatch(/incomplete/i);                      // the user is told
  expect(errors).toEqual([]);
});

test('FL-12: the compliance megapixel estimate uses the printed-width scale', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('export-dpi', '300'); sv('export-width-mm', '183'); render();
    const real = renderExportCanvas(300);
    const realMP = real.width * real.height / 1e6;
    checkCompliance();
    const html = document.getElementById('info-modal-bg').innerHTML;
    const row = html.split('<div class="compliance-row">').find(s => s.includes('Export size')) || '';
    const claimed = parseFloat(/([\d.]+) MP/.exec(row)[1]);
    return { realMP, claimed };
  });
  // The old line over-reported by (3.125/2.187)^2 ~ 2x, which also mis-fired the
  // "exceeds ~60 MP cap" warning and its Lower-DPI button.
  expect(Math.abs(r.claimed - r.realMP)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Freeform parity — the same calibration must give the same bar in both modes
// ═══════════════════════════════════════════════════════════════════════════════

test('FL-13: freeform and grid draw the same bar for the same calibration', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300, iw: 1024, ih: 1024 }]);
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    el.sbOn = true; el.umPerPx = 0.16; el.sbUm = 20;
    render();
    const bar = _sbBars[0];
    const drawn = bar.right - bar.left;
    const exact = el.sbUm / el.umPerPx * (el.w / _ffSrcW(el));
    return { drawn, exact, skip: el._sbSkip };
  });
  expect(r.skip).toBe(null);
  expect(Math.abs(r.drawn - r.exact)).toBeLessThan(0.001);
  expect(errors).toEqual([]);
});
