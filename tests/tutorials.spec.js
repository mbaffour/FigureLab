// @ts-check
// Tutorials: each builds its own demo figure and walks the real controls. The risk is
// the selectors — the app has ~800 controls and they get renamed — so the first test
// walks EVERY tutorial end to end through the engine and fails on the first step whose
// target is missing or invisible, or whose "Do it for me" does not satisfy its own
// completion check.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

const IDS = ['blot', 'channels', 'straighten', 'layout', 'submit'];

async function walk(page, id) {
  return page.evaluate(async (id) => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const card = async () => { for (let i = 0; i < 120; i++) { const c = document.getElementById('tour-card'); if (c && c.style.visibility === 'visible') return c; await wait(25); } return null; };
    localStorage.removeItem('fl-tut-done-' + id);
    await startTutorial(id);
    const T = TUTORIALS.find(t => t.id === id);
    const log = [];
    for (let i = 0; i < T.steps.length; i++) {
      const c = await card();
      if (!c) { log.push({ i, err: 'no card' }); break; }
      if (_tourI !== i) { log.push({ i, err: `engine is on step ${_tourI}` }); break; }
      const step = T.steps[i];
      const el = _tourTarget(step);
      const b = el && el.getBoundingClientRect();
      const entry = { i, title: step.title, found: !!el, visible: !!(b && b.width > 0 && b.height > 0) };
      if (step.waitFor) {
        entry.doneBefore = !!step.waitFor();
        c.querySelector('#tour-act').click();
        // Watch for the condition while the step is still current: the NEXT step's
        // before() may undo it (the compliance report is closed before the Methods step).
        let saw = false;
        for (let k = 0; k < 80 && _tourI === i && document.getElementById('tour-ov'); k++) {
          try { if (step.waitFor()) saw = true; } catch (e) {}
          await wait(50);
        }
        entry.satisfied = saw;
        entry.advancedByItself = _tourI !== i || !document.getElementById('tour-ov');
      } else {
        c.querySelector('#tour-next').click();
        await wait(60);
      }
      log.push(entry);
    }
    await wait(100);
    return { log, steps: T.steps.length, overlayGone: !document.getElementById('tour-ov'),
             done: localStorage.getItem('fl-tut-done-' + id) === '1' };
  }, id);
}

for (const id of IDS) {
  test(`tutorial "${id}": every step finds its control, and every "Do it for me" completes its step`, async ({ page }) => {
    const errors = await loadApp(page);
    const r = await walk(page, id);
    expect(r.log.length).toBe(r.steps);
    for (const s of r.log) {
      expect(s.err, `step ${s.i}`).toBeUndefined();
      expect(s.found, `step ${s.i} "${s.title}": target missing`).toBe(true);
      expect(s.visible, `step ${s.i} "${s.title}": target not visible`).toBe(true);
      if ('satisfied' in s) {
        // a "do" step must not already be done when it appears — it would skip itself
        expect(s.doneBefore, `step ${s.i} "${s.title}" was already satisfied`).toBe(false);
        expect(s.satisfied, `step ${s.i} "${s.title}": Do it for me did not do it`).toBe(true);
        expect(s.advancedByItself, `step ${s.i} "${s.title}": did not move on`).toBe(true);
      }
    }
    expect(r.overlayGone).toBe(true);
    expect(r.done).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('a step that asks you to do something moves on when you do it by hand', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => { await startTutorial('blot'); });
  const card = () => page.waitForFunction(() => { const c = document.getElementById('tour-card'); return c && c.style.visibility === 'visible'; });
  await card();
  await page.locator('#tour-next').click();                      // intro → greyscale
  await card();
  await page.locator('#tour-act').click();                        // greyscale done for us
  await page.waitForFunction(() => _tourI === 2);
  await card();
  // The overlay lets this click through to the real checkbox. Without that it would
  // land on the overlay, and the rows would never hug.
  await page.locator('#auto-row-h').click();
  await page.waitForFunction(() => _tourI === 3, null, { timeout: 5000 });
  const r = await page.evaluate(() => ({ hug: gc('auto-row-h'), rows: gridGeom().ph }));
  expect(r.hug).toBe(true);
  expect(Array.isArray(r.rows) && r.rows[1] < r.rows[0]).toBe(true);   // the loading-control row shrank
  expect(errors).toEqual([]);
});

test('Escape ends a tutorial, and starting one over your figure asks and is one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  page.once('dialog', d => d.accept());
  const r = await page.evaluate(async () => {
    const mine = images.map(im => im.name);
    const steps0 = undoStack.length;
    await startTutorial('layout');
    const seeded = images.length;
    const steps = undoStack.length - steps0;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const ended = !document.getElementById('tour-ov');
    undo();
    return { mine, seeded, steps, ended, back: images.map(im => im.name) };
  });
  expect(r.seeded).toBe(8);
  expect(r.steps).toBe(1);
  expect(r.ended).toBe(true);
  expect(r.back).toEqual(r.mine);
  expect(errors).toEqual([]);
});

test('declining the confirmation leaves your figure alone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  page.once('dialog', d => d.dismiss());
  const r = await page.evaluate(async () => {
    const before = images.map(im => im.name), steps0 = undoStack.length;
    await startTutorial('blot');
    return { same: JSON.stringify(images.map(im => im.name)) === JSON.stringify(before),
             steps: undoStack.length - steps0, tour: !!document.getElementById('tour-ov') };
  });
  expect(r).toEqual({ same: true, steps: 0, tour: false });
  expect(errors).toEqual([]);
});

test('the Tutorials tab lists every tutorial, and ⌘K finds them', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    openHelp('tutorials');
    const rows = [...document.querySelectorAll('#tutorial-list [data-tut]')].map(b => b.dataset.tut);
    const top = q => { _cmdpRender(q); return (_cmdpFiltered[0] || {}).label || ''; };
    return { rows, active: document.getElementById('help-pane-tutorials').classList.contains('active'),
             blot: top('tutorial western blot'), list: top('tutorials'), welcome: !!document.querySelector('#empty-state [onclick="openHelp(\'tutorials\')"]') };
  });
  expect(r.active).toBe(true);
  expect(r.rows).toEqual(['basics', ...IDS]);
  expect(r.blot).toMatch(/Tutorial: a western blot/);
  expect(r.list).toMatch(/Tutorials/);
  expect(r.welcome).toBe(true);
  expect(errors).toEqual([]);
});

test('the straighten tutorial leaves the gel level, and the Methods paragraph says it was resampled', async ({ page }) => {
  const errors = await loadApp(page);
  await walk(page, 'straighten');
  const r = await page.evaluate(() => ({ ang: images[0].cropAngle, crop: [images[0].cropL, images[0].cropT].map(Math.round),
                                          methods: generateMethodsParagraph() }));
  // The demo gel is drawn 7° clockwise. The SIGN matters: -7 doubles the tilt to 14°,
  // which a check on |angle| alone let through.
  expect(r.ang).toBeCloseTo(7, 1);
  expect(r.crop[0]).toBeGreaterThan(5);
  expect(r.methods).toMatch(/interpolation|resampl|tilt|rotat/i);
  expect(errors).toEqual([]);
});
