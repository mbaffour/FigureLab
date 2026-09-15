// @ts-check
// The command palette is the app's answer to "where is that tool?" — 800-odd controls,
// most of them behind a closed section. It has to answer the words a biologist types.
//
// It did not. It matched the WHOLE query as one literal substring, then fell back to a
// letters-in-order match that hit almost anything and rendered those guesses identically
// to real hits. Worst case: typing "undo" and pressing Enter ran "Reset all crops",
// because that entry's keywords contain the word "undo".
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

const TOP = `window._top = (q) => { _cmdpRender(q);
  const ul = document.getElementById('cmdp-list');
  return { top: (_cmdpFiltered[0] || {}).label || null, n: _cmdpFiltered.length,
           guess: /Nothing matches/.test(ul.textContent || ''),
           empty: /No matching commands/.test(ul.textContent || '') }; };`;

test('typing "undo" offers Undo, and running it does not reset every crop', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(TOP);
  const r = await page.evaluate(() => {
    // two undoable steps, so there is something real for undo to step back through
    pushUndo(); images[0].cropL = 12; images[0].cropT = 8; render();
    pushUndo(); sv('gap-h', '30'); render();
    const hit = _top('undo');
    // run the top hit exactly as Enter would
    _cmdpSel = 0; _cmdpFiltered[0].run();
    return { hit, cropAfter: [images[0].cropL, images[0].cropT], gapAfter: gi('gap-h') };
  });
  expect(r.hit.top).toBe('Undo last change');       // was "Reset all crops"
  expect(r.hit.guess).toBe(false);
  expect(r.cropAfter).toEqual([12, 8]);             // the crops survive — this used to wipe them
  expect(r.gapAfter).toBe(6);                       // it undid the gap change, which is what undo means
  expect(errors).toEqual([]);
});

test('the words a biologist types reach the right tool', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(TOP);
  const r = await page.evaluate(() => {
    const want = {
      'gap': /gutter|Space between panels/, 'space': /Space between panels/,
      'white space': /Space between panels|white space/i,
      'bigger': /Panel width/, 'smaller': /Panel width/, 'resize': /Panel width/,
      'make panels bigger': /Panel width/,
      'dpi': /Export resolution/, 'resolution': /Export resolution/, '300 dpi': /Export resolution/,
      'arrow': /Draw an arrow/, 'label': /panel letters/i, 'micron': /Scale bar/, 'um': /Scale bar/,
      'merge': /Merge channels/, 'split channels': /Split a merge/,
      'submit': /journal requirements/, 'load': /Load a saved session/,
      'redo': /^Redo$/, 'flip': /Rotate/, 'sideways': /Rotate/, 'gutter': /gutter/i,
    };
    const bad = [];
    for (const [q, re] of Object.entries(want)) {
      const h = _top(q);
      if (!h.top || !re.test(h.top)) bad.push(`${q} -> ${h.top}`);
      if (h.guess) bad.push(`${q} was only a guess`);
    }
    return bad;
  });
  expect(r).toEqual([]);
  expect(errors).toEqual([]);
});

test('a miss says it is a miss, instead of dressing a guess as an answer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(TOP);
  const r = await page.evaluate(() => ({
    nonsense: _top('asdfghjkl'),
    // letters that happen to appear in order somewhere: a guess, and labelled as one
    loose: _top('touch'),
    real: _top('export'),
  }));
  expect(r.nonsense.n).toBe(0);
  expect(r.nonsense.empty).toBe(true);
  expect(r.loose.guess).toBe(true);                 // shown, but announced as a guess
  expect(r.loose.n).toBeGreaterThan(0);
  expect(r.real.guess).toBe(false);                 // a real hit is never labelled a guess
  expect(errors).toEqual([]);
});

test('a palette entry can take you to a control, opening the section it hides in', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    // Export lives in a section that is closed at startup.
    const dpi = document.getElementById('export-dpi');
    let sect = dpi; while (sect && sect.tagName !== 'DETAILS') sect = sect.parentElement;
    const before = { open: sect.open, visible: dpi.offsetParent !== null };
    _cmdpGoto('export-dpi', 'test');
    await new Promise(r => setTimeout(r, 120));
    return { before, after: { open: sect.open, visible: dpi.offsetParent !== null,
                              focused: document.activeElement === dpi,
                              flashed: dpi.classList.contains('cmdp-flash') } };
  });
  expect(r.before.open).toBe(false);                // it was shut
  expect(r.after.open).toBe(true);                  // …and the palette opened it
  expect(r.after.visible).toBe(true);
  expect(r.after.focused).toBe(true);
  expect(r.after.flashed).toBe(true);
  expect(errors).toEqual([]);
});
