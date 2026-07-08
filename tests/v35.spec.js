// @ts-check
// Tests for the v3.5 UX / integrity / export features.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('empty state shows initially, hides once images load', async ({ page }) => {
  const errors = await loadApp(page);
  const shown = await page.evaluate(() => {
    const e = document.getElementById('empty-state');
    return !!e && getComputedStyle(e).display !== 'none';
  });
  expect(shown).toBe(true);
  await seedPanels(page, 3);
  const hidden = await page.evaluate(
    () => getComputedStyle(document.getElementById('empty-state')).display === 'none'
  );
  expect(hidden).toBe(true);
  expect(errors).toEqual([]);
});

test('Simple/Advanced mode toggles advanced-control visibility, keeps core visible', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => applyUiMode('simple'));
  let advVisible = await page.evaluate(() => document.getElementById('scale-match-target').offsetParent !== null);
  expect(advVisible).toBe(false);                    // advanced hidden in Simple
  const dpiVisible = await page.evaluate(() => document.getElementById('export-dpi').offsetParent !== null);
  expect(dpiVisible).toBe(true);                     // core stays visible
  await page.evaluate(() => applyUiMode('advanced'));
  advVisible = await page.evaluate(() => document.getElementById('scale-match-target').offsetParent !== null);
  expect(advVisible).toBe(true);                     // revealed in Advanced
});

test('command palette opens and runs a command', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => openCmdPalette());
  expect(await page.evaluate(() => document.getElementById('cmd-palette').classList.contains('open'))).toBe(true);
  const n = await page.evaluate(() => {
    const i = document.getElementById('cmdp-input');
    i.value = 'theme'; i.dispatchEvent(new Event('input'));
    return document.querySelectorAll('#cmdp-list .cmdp-item').length;
  });
  expect(n).toBeGreaterThan(0);
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => { _cmdpSel = 0; _cmdpRun(); });   // run "Toggle theme"
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(after).not.toBe(before);
});

test('export preflight reports dimensions and a sub-300-DPI warning', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { sv('export-dpi', '150'); doExportPreflight('tiff'); });
  const body = await page.evaluate(() => document.getElementById('preflight-body').innerText);
  expect(body).toMatch(/Pixel dimensions/);
  expect(body).toMatch(/Physical size/);
  expect(body).toMatch(/150 DPI is below/);
  await page.evaluate(() => closePreflight());
  expect(await page.evaluate(() => document.getElementById('preflight-modal').classList.contains('open'))).toBe(false);
});

test('CVD simulation filters the display only, never the export buffer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const sample = () => 'return document.getElementById("fig-canvas").getContext("2d").getImageData(0,0,4,4).data.join(",")';
  const before = await page.evaluate(new Function(sample()));
  await page.evaluate(() => setCvdMode('deuter'));
  const filter = await page.evaluate(() => document.getElementById('canvas-container').style.filter);
  expect(filter).toContain('cvd-deuter');
  const after = await page.evaluate(new Function(sample()));
  expect(after).toBe(before);                        // pixel buffer untouched
  expect(errors).toEqual([]);
});

test('help chips are present and carry tooltip copy', async ({ page }) => {
  await loadApp(page);
  const n = await page.evaluate(() => document.querySelectorAll('.help-chip').length);
  expect(n).toBeGreaterThanOrEqual(4);
  const hasTip = await page.evaluate(() => !!document.querySelector('.help-chip').getAttribute('data-tip'));
  expect(hasTip).toBe(true);
});

test('load example figure builds a labelled, calibrated 4-panel figure', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  expect(await page.evaluate(() => images.map(i => i.label))).toEqual(['A', 'B', 'C', 'D']);
  expect(await page.evaluate(() => images[0].umPerPx > 0 && images[0].sbOn)).toBe(true);
});

test('auto-arrange produces a balanced grid from the panel count', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 5); sv('rows', 5); onLayoutChange(); autoArrange(); });
  const dims = await page.evaluate(() => ({ cols: gi('cols'), rows: gi('rows') }));
  expect(dims).toEqual({ cols: 2, rows: 2 });
});
