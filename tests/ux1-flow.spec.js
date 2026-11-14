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

// ── Search (⌘K) ────────────────────────────────────────────────────────────
const TOP = `window._top = (q) => { _cmdpCtlCache = null; _cmdpRender(q);
  const ul = document.getElementById('cmdp-list');
  return { top: (_cmdpFiltered[0] || {}).label || null,
           guess: /Nothing matches/.test(ul.textContent || ''), n: _cmdpFiltered.length }; };`;

test('newcomer-12 / freeform-01 / freeform-15: plain phrases with leading verbs find the right tool', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(TOP);
  const bad = await page.evaluate(() => {
    const want = {
      'add arrow': /^Draw an arrow/, 'remove white border': /Trim borders|Crop a panel/, 'change font': /^Font \(typeface\)/,
      'make bigger': /^Panel width/, 'copy style': /Apply to all/, 'split channels': /^Split a merge/,
      'export for journal': /submission package/, 'span': /span two columns or rows/, 'row span': /span two columns/,
      'two rows': /span two columns/, 'large panel': /Panel width|span two columns/, 'merge cells': /span two columns/,
      'align': /^Align selected objects/, 'reorder': /reorder panels/, 'swap panels': /reorder panels/,
      'lowercase labels': /^Letter style/, 'scale bar text': /^Scale bar length and style/, 'font family': /^Font \(typeface\)/,
      'lock': /^Lock \/ unlock/, 'front': /to front/, 'background colour': /Background — Color/, 'margin': /^Margins/,
      'how do i add a scale bar': /^Scale bar length and style/,
    };
    const out = [];
    for (const [q, re] of Object.entries(want)) {
      const h = _top(q);
      if (!h.top || !re.test(h.top) || h.guess) out.push(`${q} -> ${h.top}${h.guess ? ' (guess)' : ''}`);
    }
    // 'large panel' must offer the span row on the first screen
    _top('large panel'); if (!_cmdpFiltered.slice(0, 5).some(c => /span two columns/.test(c.label))) out.push('large panel: no span row');
    return out;
  });
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test('newcomer-13 / newcomer-28: one row per journal with what it does; palette exports open the Save dialog', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(TOP);
  const r = await page.evaluate(() => {
    _top('nature');
    const rows = _cmdpFiltered.map(c => c.label);
    const j = _cmdpFiltered.find(c => c.label === 'Journal: Nature');
    _top('export tiff'); const ex = _cmdpFiltered[0];
    window._dl = 0; const o = window.dl; window.dl = () => { window._dl++; };
    ex.run();
    const open = document.getElementById('preflight-modal').classList.contains('open');
    window.dl = o;
    return { presetRows: rows.filter(l => /^Preset: Nature/.test(l)).length, hint: j && j.hint, top: ex.label, open, dl: window._dl };
  });
  expect(r.presetRows).toBe(0);                 // the duplicate "Preset: Nature" row ran the same command
  expect(r.hint).toMatch(/width, font, DPI/);
  expect(r.top).toBe('Export TIFF');
  expect(r.open).toBe(true);                    // the dialog with its warnings, as the toolbar button
  expect(r.dl).toBe(0);
  expect(errors).toEqual([]);
});

test('freeform-01: the span row opens the panel\'s span field', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  await page.keyboard.press('Control+k');
  await page.locator('#cmdp-input').fill('span');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const cls = await page.evaluate(() => (document.activeElement && document.activeElement.className) || '');
  expect(cls).toContain('f-colspan');
  expect(errors).toEqual([]);
});

// ── Undo / redo keys ───────────────────────────────────────────────────────
test('freeform-43: Ctrl/⌘+Shift+Z redoes even when the key arrives as lowercase "z"', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const press = (key, shift) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: !!shift, bubbles: true }));
    pushUndo(); sv('gap-h', '20'); render();
    pushUndo(); sv('gap-h', '30'); render();
    press('z'); press('z');
    const afterUndo = gi('gap-h');
    press('z', true);                      // Shift held, lowercase key: was a third undo
    const afterRedo1 = gi('gap-h');
    press('Z', true);
    const afterRedo2 = gi('gap-h');
    press('Z', false);                     // Caps Lock, no Shift: an undo
    return { afterUndo, afterRedo1, afterRedo2, capsUndo: gi('gap-h') };
  });
  expect(r).toEqual({ afterUndo: 6, afterRedo1: 20, afterRedo2: 30, capsUndo: 20 });
  expect(errors).toEqual([]);
});

// ── Captions and Methods ───────────────────────────────────────────────────
test('fluor-21: the caption uses the row and column headings, not "RFP" for CellMask', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const cap = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2);
    sc('show-col-labels', true); sc('show-row-labels', true); onLayoutChange();
    setAxisLabels('col', ['DAPI', 'CellMask']); setAxisLabels('row', ['DMSO', 'BafA1']);
    images[1].lut = 'magenta'; images[1].tag = 'RFP';   // the stock tag a split gives a magenta channel
    images[3].lut = 'magenta'; images[3].tag = 'RFP';
    render(); return _captionText();
  });
  expect(cap).toContain('DMSO: (A) DAPI');
  expect(cap).toContain('(B) CellMask, Magenta');
  expect(cap).toContain('BafA1: (C) DAPI');
  expect(cap).not.toContain('RFP');
  expect(errors).toEqual([]);
});

test('blot-09: a panel with no letter is named, never "() Panel ."; Methods names it by file', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    sv('cols', 1); sv('rows', 3); onLayoutChange();
    images[1].label = ''; images[2].label = ''; images[1].grayscale = true;
    render(); return { cap: _captionText(), meth: generateMethodsParagraph() };
  });
  expect(r.cap).not.toMatch(/\(\s*\)/);
  expect(r.cap).not.toContain('Panel .');
  expect(r.cap).toContain('Unlettered panel (panel1.png), grayscale.'); expect(r.cap).toContain('Unlettered panel (panel2.png).');
  expect(r.meth).not.toContain('(unlabelled)');
  expect(r.meth).toContain('“panel1.png”');
  expect(errors).toEqual([]);
});

test('phage-29: charts and gene maps are in the caption, with the letter written beside them', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); sel.value = 'freeform'; setLayoutMode('freeform');
    const ch = _defaultChart('line');
    ch.data = { columns: ['Time', 'phiMBA1', 'Control'], rows: [[0, 0.1, 0.1], [30, 0.5, 0.6]], source: 'file', sourceName: 'lysis_OD600.csv' };
    ch.mapping.xCol = 0; ch.mapping.yCols = [1, 2];
    ch.axes.x.title = 'Time (min)'; ch.axes.y.title = 'OD_{600}';
    ch.caption = 'Mean of n = 3 biological replicates; SD not shown';
    addFreeformElement({ type: 'chart', x: 600, y: 40, w: 380, h: 280, chart: ch, label: 'lysis chart' });
    const mp = _defaultGenemap(); mp.style.title = 'phiMBA1 lysis cassette';
    addFreeformElement({ type: 'genemap', x: 100, y: 500, w: 520, h: 190, map: mp, label: 'linear gene map' });
    render();
    const W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'text', xf: 590 / W, yf: 30 / H, text: 'E', fontSize: 16, color: '#000' });
    annotations.push({ type: 'text', xf: 90 / W, yf: 485 / H, text: 'F', fontSize: 16, color: '#000' });
    render();
    generateCaption();
    return document.getElementById('caption-out').value;
  });
  expect(r).toContain('(E) Line chart of OD₆₀₀ against Time (min) (series: phiMBA1 and Control). Data from lysis_OD600.csv. Mean of n = 3 biological replicates; SD not shown.');
  expect(r).toMatch(/\(F\) Linear map of phiMBA1 lysis cassette \(5,000 bp\), showing pTet, RBS, gfp/);
  expect(errors).toEqual([]);
});

test('fluor-21: Methods states the display range of a merged channel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const m = await page.evaluate(() => {
    const im = images[0];
    im.channels = [{ img: images[1].img, src: images[1].src, lut: 'green', name: 'GFP', blackPt: 12, whitePt: 180 }];
    render(); return generateMethodsParagraph();
  });
  expect(m).toMatch(/In panel A the merged channel was displayed with its own linear display range \(GFP 12–180/);
  expect(errors).toEqual([]);
});

test('newcomer-18: an untouched caption follows the figure; an edited one is marked out of date', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { images[0].captionNote = 'Plaque assay'; generateCaption(); });
  expect(await page.locator('#caption-out').inputValue()).toContain('(A) Plaque assay');
  // swap the two panels, as dragging one onto the other does
  await page.evaluate(() => { pushUndo(); const t = images[0]; images[0] = images[1]; images[1] = t;
    images[0].label = 'A'; images[1].label = 'B'; render(); });
  await expect(page.locator('#caption-out')).toHaveValue(/\(B\) Plaque assay/);
  await expect(page.locator('#caption-stale')).toBeHidden();
  // the author edits it; a later change marks it instead of overwriting it
  await page.evaluate(() => { const b = document.getElementById('export-body') || null; });
  await page.evaluate(() => { document.getElementById('caption-out').value = 'My own words about (B) Plaque assay.'; });
  await page.evaluate(() => { images[1].captionNote = 'Spot assay'; render(); });
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => document.getElementById('caption-stale').style.display)).toBe('');
  await expect(page.locator('#caption-out')).toHaveValue('My own words about (B) Plaque assay.');
  expect(errors).toEqual([]);
});

// ── Panel list, keyboard, mobile, zoom ─────────────────────────────────────
test('newcomer-06: a "⚠ calibrate" badge no longer pushes lock, ⚙ and × out of the panel card', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(async () => {
    images.forEach(im => { im.sbOn = true; im.umPerPx = 0; im.name = 'a_rather_long_file_name_from_the_microscope_001.tif'; });
    renderImgList(); render();
    const item = document.querySelectorAll('#img-list .img-item')[1];
    const card = item.getBoundingClientRect();
    const btns = [...item.querySelectorAll('.img-item-main .icon-btn')].map(b => b.getBoundingClientRect());
    const badge = item.querySelector('.f-calib-warn');
    // open its settings and scroll a field into view, as Open settings does
    document.getElementById('settings-1').classList.add('open');
    item.querySelector('.f-colspan').scrollIntoView();
    await new Promise(r => setTimeout(r, 50));
    return { inside: btns.every(b => b.right <= card.right + 0.5 && b.width > 0), n: btns.length, badge: !!badge,
      sw: item.scrollWidth - item.clientWidth, sl: item.scrollLeft };
  });
  expect(r.badge).toBe(true);
  expect(r.n).toBe(5);
  expect(r.inside).toBe(true);                 // were 152 px past the card's edge
  expect(r.sl).toBe(0);                        // the card no longer scrolls sideways
  expect(errors).toEqual([]);
});

test('newcomer-10: the drop zones are buttons a keyboard can reach and open; a skip link reaches the toolbar', async ({ page }) => {
  const errors = await loadApp(page);
  // the first Tab lands on the skip link; Enter jumps past the side panel to the toolbar
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.className)).toBe('skip-link');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => !!document.activeElement.closest('#canvas-toolbar'))).toBe(true);
  // the welcome card's drop zone
  // (the picker opening = the file input clicked; a headless filechooser wait set up
  // on a cold browser can miss the very first one)
  await page.evaluate(() => { window._picks = 0; document.getElementById('file-input').addEventListener('click', e => { window._picks++; e.preventDefault(); }); });
  await page.locator('#empty-state .es-drop').focus();
  await page.keyboard.press('Enter');
  await page.locator('#drop-zone').focus();
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => window._picks)).toBe(2);
  const roles = await page.evaluate(() => [...document.querySelectorAll('#drop-zone, .es-drop')].map(e => [e.getAttribute('role'), e.tabIndex]));
  expect(roles).toEqual([['button', 0], ['button', 0]]);
  // a keyboard focus ring on a number input (it had outline:none)
  await page.locator('#cols').focus();
  await page.keyboard.press('ArrowUp');
  const ring = await page.evaluate(() => getComputedStyle(document.getElementById('cols')).outlineStyle);
  expect(ring).toBe('solid');
  expect(errors).toEqual([]);
});

test('newcomer-31: the figure, margins, tick boxes and toolbar buttons have names', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => _setAltText('Two panels of E. coli.'));
  await expect(page.getByRole('img', { name: 'Two panels of E. coli.' })).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'Top margin (px)' })).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: 'Tick panel A' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export lossless PDF' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('newcomer-11 / newcomer-32: on a phone the drawer starts closed and the figure keeps its proportions', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await loadApp(page);
  expect(await page.evaluate(() => document.body.classList.contains('sb-open'))).toBe(false);
  await expect(page.locator('#empty-state .es-drop')).toBeInViewport();
  await seedPanels(page, 6);
  await page.evaluate(() => { sv('cols', 3); sv('rows', 2); onLayoutChange(); render(); updateHD(); });
  const r = await page.evaluate(() => {
    const a = document.getElementById('fig-canvas').getBoundingClientRect(), b = document.getElementById('fig-canvas-hd').getBoundingClientRect(),
      c = document.getElementById('ann-canvas').getBoundingClientRect();
    return { shown: getComputedStyle(document.getElementById('fig-canvas-hd')).display, fig: a.width / a.height, hd: b.width / b.height,
      hdH: b.height, annH: c.height, figH: a.height };
  });
  expect(r.shown).toBe('block');
  expect(Math.abs(r.hd - r.fig)).toBeLessThan(0.02);   // was 0.56 against 1.49
  expect(Math.abs(r.hdH - r.figH)).toBeLessThan(2);
  expect(Math.abs(r.annH - r.figH)).toBeLessThan(2);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('phage-11: zoomed in, every part of the figure can be scrolled to; Ctrl+scroll zooms about the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  await page.evaluate(() => { sv('cols', 3); sv('rows', 2); sv('panel-w', 400); sv('panel-h', 400); onLayoutChange(); render(); });
  // ＋ four times, then scroll to the top-left corner: panel A's corner must be in view
  for (let i = 0; i < 8; i++) await page.click('button[aria-label="Zoom in"]');
  const r = await page.evaluate(() => {
    const wrap = document.getElementById('canvas-wrap'); wrap.scrollLeft = 0; wrap.scrollTop = 0;
    const w = wrap.getBoundingClientRect(), f = document.getElementById('fig-canvas').getBoundingClientRect();
    const tl = f.left >= w.left - 1 && f.top >= w.top - 1;
    wrap.scrollLeft = wrap.scrollWidth; wrap.scrollTop = wrap.scrollHeight;
    const f2 = document.getElementById('fig-canvas').getBoundingClientRect();
    const br = f2.right <= w.right + 1 && f2.bottom <= w.bottom + 1;
    return { zoom, tl, br, focusOnButton: document.activeElement && document.activeElement.tagName === 'BUTTON' };
  });
  expect(r.zoom).toBe(3);
  expect(r.tl).toBe(true);                    // the top-left corner was at −982 px, out of reach
  expect(r.br).toBe(true);
  expect(r.focusOnButton).toBe(false);        // Space after ＋ pans instead of pressing ＋ again
  // Ctrl+scroll over a point keeps that point under the pointer
  const p = await page.evaluate(() => {
    const wrap = document.getElementById('canvas-wrap'); wrap.scrollLeft = 200; wrap.scrollTop = 150;
    const f = document.getElementById('fig-canvas').getBoundingClientRect();
    const cx = 500, cy = 400, fx = (cx - f.left) / f.width, fy = (cy - f.top) / f.height;
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    const g = document.getElementById('fig-canvas').getBoundingClientRect();
    return { dx: g.left + fx * g.width - cx, dy: g.top + fy * g.height - cy, z: zoom };
  });
  expect(p.z).toBeGreaterThan(3);
  expect(Math.abs(p.dx)).toBeLessThan(2);
  expect(Math.abs(p.dy)).toBeLessThan(2);
  expect(errors).toEqual([]);
});
