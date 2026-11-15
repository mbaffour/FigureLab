// @ts-check
// Usability round 2 — caption, Methods and alt text after a revision, search (⌘K),
// keyboard and first use, Help and tutorials. Each test drives the path a tester took
// and failed on (finding IDs in the titles).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { loadApp, seedPanels } = require('./helpers');

// Type into ⌘K the way a person does and press Enter.
async function palette(page, q) {
  await page.keyboard.press('Control+k');
  await page.locator('#cmdp-input').fill(q);
  await page.keyboard.press('Enter');
}
async function top(page, q) {
  return page.evaluate((q) => { openCmdPalette(); _cmdpRender(q); const t = _cmdpFiltered.slice(0, 3).map(c => c.label); closeCmdPalette(); return t; }, q);
}

test('newcomer2-16: ⌘K "plos" + Enter switches to PLOS ONE and adds no chart', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const rows0 = await page.evaluate(() => gi('rows'));
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await palette(page, 'plos');
  const r = await page.evaluate(() => ({ journal: gv('target-journal'), n: images.filter(Boolean).length,
    charts: images.filter(im => im && im.type === 'chart').length, rows: gi('rows') }));
  expect(r).toEqual({ journal: 'plos', n: 4, charts: 0, rows: rows0 });   // was: a box plot added, grid grown to 3 rows
  expect(errors).toEqual([]);
});

test('newcomer2-16: journal names, abbreviations and "journal X" phrasing reach the journal; adding rows never win on a fragment', async ({ page }) => {
  const errors = await loadApp(page);
  const want = {
    plos: /^Journal: PLOS ONE/, 'plos one': /^Journal: PLOS ONE/, 'journal plos': /^Journal: PLOS ONE/,
    'target journal plos': /^Journal: PLOS ONE/, 'switch to plos': /^Journal: PLOS ONE/,
    jbc: /^Journal: JBC/, elife: /^Journal: eLife/, embo: /^Journal: EMBO J/, 'embo journal': /^Journal: EMBO J/,
    mbio: /^Journal: ASM/, 'j bacteriol': /^Journal: ASM/, 'journal of bacteriology': /^Journal: ASM/,
    pnas: /^Journal: PNAS/, nature: /^Journal: Nature$/, 'set journal to elife': /^Journal: eLife/,
    'export for nature': /^Journal: Nature$/,
    // no preset: found and said so, not a near miss that changes the figure
    'nat comms': /no preset for Nature Communications/, 'nature communications': /no preset for Nature Communications/,
  };
  const bad = [];
  for (const [q, re] of Object.entries(want)) { const t = await top(page, q); if (!re.test(t[0] || '')) bad.push(`${q} -> ${t[0]}`); }
  // a fragment never puts an "Add …" row first
  for (const q of ['pl', 'plo', 'plos', 'bo', 'hea']) { const t = await top(page, q); if (/^(Add|Insert|Starter:|Flow:)/.test(t[0] || '')) bad.push(`${q} -> ${t[0]}`); }
  expect(bad).toEqual([]);
  // whole words still add: "box plot" is the box plot
  expect((await top(page, 'box plot'))[0]).toBe('Add box plot');
  expect(errors).toEqual([]);
});

test('newcomer2-04: plain beginner phrases reach save, add images, remove panel and text size', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const want = {
    'save my work': /^Save session/, 'add images': /^Add images/, 'add image': /^Add images/,
    'delete panel': /^Remove the selected panel/, 'remove panel': /^Remove the selected panel/,
    'make text bigger': /^Text size/,
  };
  const bad = [];
  for (const [q, re] of Object.entries(want)) { const t = await top(page, q); if (!re.test(t[0] || '')) bad.push(`${q} -> ${t[0]}`); }
  expect(bad).toEqual([]);
  // the remove row removes the panel clicked on the canvas, and says how to get it back
  const pb = await page.evaluate(() => { const b = panelBounds.find(p => p.idx === 1); const r = document.getElementById('ann-canvas').getBoundingClientRect();
    return { x: (b.x + b.w / 2) * r.width / annCanvas.width, y: (b.y + b.h / 2) * r.height / annCanvas.height }; });
  await page.locator('#ann-canvas').click({ position: pb });
  await palette(page, 'delete panel');
  const r = await page.evaluate(() => ({ n: images.filter(Boolean).length, names: images.filter(Boolean).map(im => im.name || im.fileName || '') }));
  expect(r.n).toBe(2);
  await expect(page.locator('#toast')).toContainText(/removed — Ctrl\+Z brings it back/);
  // the add-images row opens the picker
  await page.evaluate(() => { window._picks = 0; document.getElementById('file-input').addEventListener('click', e => { window._picks++; e.preventDefault(); }); });
  await palette(page, 'add images');
  expect(await page.evaluate(() => window._picks)).toBe(1);
  expect(errors).toEqual([]);
});
