// @ts-check
// Usability round 1 — first use, session loading, captions and Methods text, search,
// keyboard and mobile, the lane table editor and the submission package.
// Each test drives the path a tester took and failed on (finding IDs in the titles).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { loadApp, seedPanels } = require('./helpers');

// A saved session of a 1-big + 3-small grid, built the way the tester built it: five
// images, one hidden, 4 × 2, A spanning 2 × 2 and D spanning 2 × 1.
async function spanSession(page) {
  await seedPanels(page, 5);
  return page.evaluate(() => {
    sv('cols', 4); sv('rows', 2); onLayoutChange();
    images[1].excluded = true;
    images[0].colSpan = 2; images[0].rowSpan = 2;
    images[4].colSpan = 2;
    ['A', 'E', 'B', 'C', 'D'].forEach((l, i) => { images[i].label = l; });
    render();
    return JSON.stringify(serializeSession(true));
  });
}

test('newcomer-01 / fluor-24: the welcome card\'s "Load a session" opens a saved session', async ({ page }, info) => {
  const errors = await loadApp(page);
  const json = await spanSession(page);
  const file = info.outputPath('figure-session.json');
  fs.writeFileSync(file, json);
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await expect(page.locator('#empty-state')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Load a session/ }).click();
  await (await chooser).setFiles(file);
  await page.waitForFunction(() => images.filter(Boolean).length === 5, null, { timeout: 8000 });
  const r = await page.evaluate(() => ({ cols: gi('cols'), rows: gi('rows'),
    drawn: _figurePanels().map(im => im.label), tpls: getSavedTemplates().length }));
  expect(r).toEqual({ cols: 4, rows: 2, drawn: ['A', 'B', 'C', 'D'], tpls: 0 });
  expect(errors).toEqual([]);
});

test('newcomer-01: a session picked in the Templates importer opens as a session; a non-session JSON is refused in words', async ({ page }, info) => {
  const errors = await loadApp(page);
  const json = await spanSession(page);
  const file = info.outputPath('s.json'); fs.writeFileSync(file, json);
  const junk = info.outputPath('junk.json'); fs.writeFileSync(junk, '{"hello": 1}');
  const notjson = info.outputPath('notes.json'); fs.writeFileSync(notjson, 'just some notes');
  await page.evaluate(() => { images.length = 0; render(); window._t = []; const o = toast; window.toast = (m, k) => { window._t.push(m); return o(m, k); }; });
  await page.locator('input[onchange="importTemplates(this)"]').setInputFiles(file);
  await page.waitForFunction(() => images.filter(Boolean).length === 5);
  await page.locator('#session-load-input').setInputFiles(junk);
  await page.locator('#session-load-input').setInputFiles(notjson);
  await page.waitForFunction(() => window._t.length >= 3);
  const t = await page.evaluate(() => window._t);
  expect(t.join('\n')).toMatch(/is a saved session, so it was opened/);
  expect(t.join('\n')).toMatch(/junk\.json is JSON, but not a FigureLab session/);
  expect(t.join('\n')).toMatch(/notes\.json is not a FigureLab session — it is not JSON/);
  expect(await page.evaluate(() => images.filter(Boolean).length)).toBe(5);   // the refused files changed nothing
  expect(errors).toEqual([]);
});

test('freeform-47: Fit grid to panels counts spans, and the status bar counts the panels drawn', async ({ page }) => {
  const errors = await loadApp(page);
  const json = await spanSession(page);
  const r = await page.evaluate((j) => {
    applySession(JSON.parse(j), { origin: 'file' }); render();
    const loaded = { cols: gi('cols'), rows: gi('rows'), drawn: _figurePanels().length };
    fitGridToPanels(); render();
    const P = _gridPlacements();
    const fitted = { cols: gi('cols'), rows: gi('rows'), unplaced: P.unplaced, cut: P.filter(p => p.want).length,
      drawn: _figurePanels().map(im => im.label) };
    // a grid too small for the spans: the panels left out are counted and named
    sv('cols', 2); sv('rows', 2); onLayoutChange(); render();
    const status = document.getElementById('status-l').textContent;
    return { loaded, fitted, status };
  }, json);
  expect(r.loaded).toEqual({ cols: 4, rows: 2, drawn: 4 });          // the file loads as saved
  expect(r.fitted).toEqual({ cols: 4, rows: 2, unplaced: 0, cut: 0, drawn: ['A', 'B', 'C', 'D'] }); // was 2 × 2 with B–D gone
  expect(r.status).toMatch(/1 panel\(s\) · 3 not drawn/);             // was "4 panel(s)"
  expect(errors).toEqual([]);
});
