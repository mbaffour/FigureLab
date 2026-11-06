// @ts-check
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

test('SiliCoDraw handoff button opens the editor and prompts import', async ({ page }) => {
  const errors = await loadApp(page);

  const btn = page.locator('#silicodraw-btn');
  await expect(btn).toHaveCount(1);
  await expect(btn).toContainText(/SiliCoDraw/i);

  // Capture window.open target without actually navigating, and watch the toast.
  const opened = await page.evaluate(() => new Promise((resolve) => {
    const origOpen = window.open;
    let url = null;
    window.open = (u) => { url = u; return null; };
    document.getElementById('silicodraw-btn').click();
    const toastEl = document.getElementById('toast');
    setTimeout(() => { window.open = origOpen; resolve({ url, toast: toastEl && toastEl.textContent }); }, 50);
  }));

  expect(opened.url).toBe('https://silicodraw.com/editor');
  expect(opened.toast).toMatch(/SVG|PNG|drop/i);
  expect(errors).toEqual([]);
});

test('app still imports SVG (the SiliCoDraw export path)', async ({ page }) => {
  await loadApp(page);
  const accepts = await page.evaluate(() => document.getElementById('file-input').getAttribute('accept'));
  expect(accepts).toContain('.svg');
  // _rasterizeSVG keeps a crisp raster + vector source for SVG export
  const hasRasterize = await page.evaluate(() => typeof _rasterizeSVG === 'function');
  expect(hasRasterize).toBe(true);
});
