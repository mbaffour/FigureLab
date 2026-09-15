// @ts-check
// Places where the interface said something that was not true, or offered a cue that
// did nothing. All found by a findability audit that drove the real app.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('the Save dialog reports the size the file will really be, with a column width set', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); sv('export-dpi', '300');
    sv('export-width-mm', '89');                    // Nature single column
    onLayoutChange(); render();
    doExportPreflight('png');
    const txt = document.getElementById('preflight-body').textContent;
    const dlgW = +(txt.match(/([\d.]+)\s*×\s*[\d.]+\s*px/) || [])[1];
    const dlgMm = +(txt.match(/([\d.]+)\s*×\s*[\d.]+\s*mm/) || [])[1];
    const real = renderExportCanvas(300);
    const realMm = _physFacts().wMm;
    closePreflight();
    return { dlgW, dlgMm, realW: real.width, realMm };
  });
  // The dialog used to say 2131 px / 180 mm for an export that is really 1051 px / 89 mm.
  expect(Math.abs(r.dlgW - r.realW)).toBeLessThanOrEqual(2);
  expect(Math.abs(r.dlgMm - r.realMm)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(r.dlgMm - 89)).toBeLessThanOrEqual(0.5);
  expect(errors).toEqual([]);
});

test('the compliance report names the journal preset you actually applied', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    const read = () => { const m = document.getElementById('info-modal-bg');
      const t = m ? m.innerText : ''; if (m) m.remove(); return t; };
    checkCompliance(); const none = read();
    applyPreset('plos'); checkCompliance(); const plos = read();
    return { none, plos };
  });
  expect(r.none).toMatch(/Nature\/Science\/Cell/);
  expect(r.none).not.toMatch(/preset applied/);
  expect(r.plos).toMatch(/plos/i);                  // it used to claim Nature/Science/Cell only
  expect(r.plos).toMatch(/check its own spec/i);
  expect(errors).toEqual([]);
});

test('the ⚠ beside an uncalibrated panel is a button that opens the calibration dialog', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    // every panel ships with sbOn true and no calibration, so the badge is showing
    const on = images.map(im => [im.sbOn, im.umPerPx]);
    renderImgList();
    const badge = document.querySelector('#img-list .f-calib-warn');
    const before = document.getElementById('calib-modal').classList.contains('open');
    badge.click();
    return { on, badgeText: badge.textContent.trim(), before,
             after: document.getElementById('calib-modal').classList.contains('open'),
             forPanel: calibState.imgIdx };
  });
  expect(r.on[0]).toEqual([true, 0]);               // switched on, nothing drawable
  expect(r.badgeText).toMatch(/calibrate/);         // it used to be a bare ⚠ with no text
  expect(r.before).toBe(false);
  expect(r.after).toBe(true);                       // …and inert; now it opens Calibrate
  expect(r.forPanel).toBe(0);
  expect(errors).toEqual([]);
});

test('the "Rotate:" caption cannot wrap away from its own buttons', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const bad = [];
  for (let w = 1180; w <= 1520; w += 20) {
    await page.setViewportSize({ width: w, height: 800 });
    const r = await page.evaluate(() => {
      // the innermost span holding the word, not the wrapper that now contains the group
      const cap = [...document.querySelectorAll('.canvas-toolbar span')]
        .filter(s => /Rotate:/.test(s.textContent || '') && !s.querySelector('span,button')).pop();
      const btn = [...document.querySelectorAll('.canvas-toolbar button')]
        .find(b => /rotateFromToolbar\(-90\)/.test(b.getAttribute('onclick') || ''));
      if (!cap || !btn) return null;
      const a = cap.getBoundingClientRect(), b = btn.getBoundingClientRect();
      return { sameRow: Math.abs(a.top - b.top) < 6, gap: Math.round(Math.abs(b.left - a.right)) };
    });
    if (r && (!r.sameRow || r.gap > 40)) bad.push(`${w}px: sameRow=${r.sameRow} gap=${r.gap}`);
  }
  expect(bad).toEqual([]);                          // 1340–1420 used to orphan the caption by 955 px
  expect(errors).toEqual([]);
});

test('the decoy "Label style" block is named for what it actually styles', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.sec-lbl')].map(e => e.textContent.trim());
    return { hasDecoy: heads.some(h => h === 'Label style'),
             hasHonest: heads.some(h => /Row \/ column header style/.test(h)),
             scaleBar: heads.find(h => /Scale bar/i.test(h)) };
  });
  expect(r.hasDecoy).toBe(false);                   // it styles row/column headers, not panel letters
  expect(r.hasHonest).toBe(true);
  expect(r.scaleBar).toMatch(/appearance/);         // not "(global defaults)", which promised more
  expect(errors).toEqual([]);
});
