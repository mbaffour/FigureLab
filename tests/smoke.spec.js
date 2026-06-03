// @ts-check
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, state } = require('./helpers');

test('boots, seeds panels, renders without errors', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const s = await state(page);
  expect(s.nImages).toBe(4);
  expect(s.panelBounds.length).toBeGreaterThanOrEqual(4);
  expect(s.figW).toBeGreaterThan(0);
  expect(s.canvasLogicalW).toBe(s.figW); // on-screen buffer is logical
  expect(errors).toEqual([]);
});
