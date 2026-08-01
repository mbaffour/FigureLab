// @ts-check
// v3.9.1 feature tests: printed (physical) figure size and true point size.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('with no target, printed size follows the export scale, not logical px over DPI', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('export-width-mm', '0'); sv('export-dpi', '300'); render();
    const f = _physFacts();
    return { lw: canvasLogicalW, wMm: f.wMm, scale: f.scale, px: f.px,
             info: document.getElementById('canvas-info').textContent };
  });
  // export renders at dpi/96, so physical inches = logical/96 — NOT logical/dpi
  expect(r.scale).toBeCloseTo(300 / 96, 4);
  expect(r.wMm).toBeCloseTo((r.lw / 96) * 25.4, 1);
  expect(r.px).toBe(Math.round(r.lw * 300 / 96));
  // the on-canvas readout agrees with the real export size
  expect(r.info).toContain(r.wMm.toFixed(1));
  expect(errors).toEqual([]);
});

test('a target column width drives the exported pixel count', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('export-dpi', '300');
    sv('export-width-mm', '89'); render();              // Nature single column
    const single = _physFacts();
    sv('export-width-mm', '183'); render();             // Nature double column
    const dbl = _physFacts();
    const off = renderExportCanvas(300);
    return { singleMm: single.wMm, singlePx: single.px,
             dblMm: dbl.wMm, dblPx: dbl.px, actualPx: off.width };
  });
  expect(r.singleMm).toBeCloseTo(89, 1);
  expect(r.dblMm).toBeCloseTo(183, 1);
  // 89 mm at 300 dpi = 89/25.4*300 = 1051 px
  expect(r.singlePx).toBe(Math.round(89 / 25.4 * 300));
  expect(r.dblPx).toBe(Math.round(183 / 25.4 * 300));
  // and the export canvas really is that wide
  expect(Math.abs(r.actualPx - r.dblPx)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('the same target at a higher DPI gives more pixels but the same physical size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('export-width-mm', '183');
    sv('export-dpi', '300'); render(); const a = _physFacts();
    sv('export-dpi', '600'); render(); const b = _physFacts();
    return { aMm: a.wMm, bMm: b.wMm, aPx: a.px, bPx: b.px, aPt: a.ptPerPx, bPt: b.ptPerPx };
  });
  expect(r.aMm).toBeCloseTo(r.bMm, 1);          // physical size unchanged
  expect(r.bPx / r.aPx).toBeCloseTo(2, 2);      // twice the pixels (to rounding)
  expect(r.bPt).toBeCloseTo(r.aPt, 4);          // and text prints at the same point size
  expect(errors).toEqual([]);
});

test('point size is reported and small text is flagged', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('export-dpi', '300'); sv('export-width-mm', '183'); sv('label-size', '8'); render();
    const okPt = _physFacts().ptPerPx * 8;
    const okHtml = document.getElementById('phys-readout').innerHTML;
    // squeeze the same canvas into a single column: everything shrinks
    sv('export-width-mm', '55'); render();
    const smallPt = _physFacts().ptPerPx * 8;
    return { okPt, smallPt, okHtml, smallHtml: document.getElementById('phys-readout').innerHTML };
  });
  expect(r.okPt).toBeGreaterThan(r.smallPt);        // narrower column => smaller type
  expect(r.okHtml).toContain('pt');
  expect(r.smallHtml).toContain('pt');
  if (r.smallPt < 5) expect(r.smallHtml).toContain('below the');
  expect(errors).toEqual([]);
});

test('journal presets set a real column width, and compliance reports mm', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    applyPreset('nature'); render();
    const w = gv('export-width-mm');
    checkCompliance();                       // renders into the shared #info-modal-bg
    const m = document.getElementById('info-modal-bg');
    const txt = m ? m.innerText : '';
    if (m) m.remove();
    return { w, mm: _physFacts().wMm, txt };
  });
  expect(r.w).toBe('183');
  expect(r.mm).toBeCloseTo(183, 0);
  expect(r.txt).toContain('Printed width');
  expect(r.txt).toContain('mm');
  expect(r.txt).toContain('Text size');
  expect(errors).toEqual([]);
});

test('the target width survives a session round-trip', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('export-width-mm', '174');
    const s = JSON.parse(JSON.stringify(serializeSession(false)));   // as a saved file would be
    sv('export-width-mm', '0');
    applySession(s);
    return { now: gv('export-width-mm') };
  });
  expect(r.now).toBe('174');
  expect(errors).toEqual([]);
});
