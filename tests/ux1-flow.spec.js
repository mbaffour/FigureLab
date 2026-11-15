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
      'how do i add a scale bar': /^Scale bar: add one to a micrograph/,   // ux2 newcomer2-01: to the calibration, not Look › Bar height
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

// ── Blots: lane table, package, S1, journal width ──────────────────────────
// A dark-on-light blot with n lanes (x0 = 30 + 90k, 50 px wide), one band each, through _commitImage.
async function blot(page, n, name) {
  return page.evaluate(({ n, name }) => {
    const pitch = 90, W = 60 + pitch * n, H = 160;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (i + 0.5 >= 30 + pitch * k && i + 0.5 < 80 + pitch * k) {
        s += 60 * Math.exp(-((j + 0.5 - 50) ** 2) / 18) + 60 * Math.exp(-((j + 0.5 - 80) ** 2) / 18) + 60 * Math.exp(-((j + 0.5 - 115) ** 2) / 18); }
      const v = Math.max(0, Math.min(255, Math.round(225 - s))), o = (j * W + i) * 4;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const src = c.toDataURL('image/png');
    return new Promise((res, rej) => { const img = new Image();
      img.onload = () => { _commitImage(img, src, name || 'blot.png'); render(); res(images.length - 1); };
      img.onerror = rej; img.src = src; });
  }, { n, name });
}

test('blot-03: the lane table editor shows the lanes under its columns, marks the ladder, and takes a whole row', async ({ page }) => {
  const errors = await loadApp(page);
  await blot(page, 6, 'phoA_blot.png');
  await page.evaluate(() => { runGelAnalysis(0); gelSetLadder(0, 0, '75,50,37'); openLaneTable(0); });
  // + Row puts the cursor in the new row's name, so typing names it (it used to land in a lane cell)
  await page.getByRole('button', { name: '+ Row' }).click();
  await page.keyboard.type('IPTG');
  await page.keyboard.press('Tab');
  let r = await page.evaluate(() => images[0].laneTable.rows.map(x => x.name));
  expect(r[r.length - 1]).toBe('IPTG');
  // a whole row pasted into lane 2's cell fills lanes 2–6
  const cell = page.locator('#lt-grid .lt-cell[data-r="1"][data-c="1"]');
  await cell.focus();
  await page.evaluate(() => {
    const el = document.querySelector('#lt-grid .lt-cell[data-r="1"][data-c="1"]');
    const dt = new DataTransfer(); dt.setData('text/plain', '-\t+\t-\t+\t-');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  r = await page.evaluate(() => images[0].laneTable.rows[1].cells);
  expect(r).toEqual(['', '–', '+', '–', '+', '–']);
  // typed: "- + - + - +" into lane 1 of the first row
  await page.locator('#lt-grid .lt-cell[data-r="0"][data-c="0"]').fill('- + - + - +');
  await page.locator('#lt-grid .lt-cell[data-r="0"][data-c="0"]').press('Tab');
  r = await page.evaluate(() => images[0].laneTable.rows[0].cells);
  expect(r).toEqual(['–', '+', '–', '+', '–', '+']);
  // the picture: drawn, wide enough to read, and the ladder lane's column says M
  const pv = await page.evaluate(() => { const c = document.getElementById('lt-preview');
    const x = c.getContext('2d').getImageData(0, 20, c.width, c.height - 20).data; let dark = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i] < 120) dark++;
    return { w: c.width, h: c.height, shown: c.style.display, dark,
      head: [...document.querySelectorAll('#lt-grid th')].map(t => t.textContent.trim()) }; });
  expect(pv.shown).toBe('block');
  expect(pv.w).toBeGreaterThanOrEqual(300);
  expect(pv.dark).toBeGreaterThan(200);        // the blot's bands are in the picture
  expect(pv.head[1]).toBe('1 M');
  expect(errors).toEqual([]);
});

const ZIPREAD = `window._zipRead = async (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset); const out = {}; let p = 0;
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const csize = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen)), off = p + 30 + nlen + elen, raw = bytes.subarray(off, off + csize);
    out[name] = (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw);
    p = off + csize;
  }
  return out; };`;

test('blot-14: the submission package carries each analysed blot\'s densitometry and lane profiles as source data', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await loadApp(page);
  await blot(page, 4, 'phoA_blot.png');
  await blot(page, 4, 'phoB_blot.png');
  await page.evaluate(ZIPREAD);
  const r = await page.evaluate(async () => {
    sv('cols', 1); sv('rows', 2); onLayoutChange();
    images[1].label = '';                     // an unlettered strip is named by its file
    render(); runGelAnalysis(0); runGelAnalysis(1);
    const cap = await _captureDownload(() => exportSubmissionPackage());
    const files = await _zipRead(cap.data);
    const names = Object.keys(files).filter(n => n.startsWith('source-data/'));
    const dens = new TextDecoder().decode(files['source-data/panel_A-densitometry.csv'] || new Uint8Array());
    return { names, head: dens.split('\n')[0], same: dens === gelCSV(0) };
  });
  expect(r.names).toEqual(expect.arrayContaining(['source-data/panel_A-densitometry.csv', 'source-data/panel_A-lane-profiles.csv',
    'source-data/panel_phoB_blot-densitometry.csv', 'source-data/panel_phoB_blot-lane-profiles.csv']));
  expect(r.head).toMatch(/densitometry, panel A \(phoA_blot\.png\)/);
  expect(r.same).toBe(true);                  // the same file the dialog's CSV button writes
  expect(errors).toEqual([]);
});

test('blot-16: the S1 sheet titles an unlettered strip by its file and marks the ladder sizes and lanes', async ({ page }) => {
  const errors = await loadApp(page);
  await blot(page, 4, 'pstS_blot.png');
  const r = await page.evaluate(() => {
    images[0].label = ''; images[0].cropT = 5; images[0].cropB = 5; render();
    runGelAnalysis(0); gelSetLadder(0, 0, '75,50,37');
    const pg = _s1PageCanvas(images[0], { forPdf: true });
    const text = pg.items.map(i => i.str).join(' ');
    // magenta marker text drawn left of the ladder lane, inside the scan area
    const x = pg.canvas.getContext('2d'), d = x.getImageData(0, pg.imgY, pg.canvas.width, pg.imgH).data;
    let magenta = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200) magenta++;
    const bare = _s1PageCanvas(Object.assign({}, images[0], { gelAnalysis: null }), { forPdf: true });
    const y = bare.canvas.getContext('2d').getImageData(0, bare.imgY, bare.canvas.width, bare.imgH).data;
    let magenta0 = 0; for (let i = 0; i < y.length; i += 4) if (y[i] > 200 && y[i + 1] < 80 && y[i + 2] > 200) magenta0++;
    return { text, magenta, magenta0 };
  });
  expect(r.text).toContain('pstS_blot.png — uncropped original (no panel letter)');
  expect(r.text).not.toContain('Panel ?');
  expect(r.text).toMatch(/Molecular-weight markers \(kDa\) from the ladder fit in lane 1, drawn beside the ladder: 75, 50, 37/);
  expect(r.magenta).toBeGreaterThan(r.magenta0 + 100);   // the sizes and lane numbers are drawn on the scan
  expect(errors).toEqual([]);
});

test('blot-12: a journal preset never picks a width that prints the figure taller than the journal allows', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 5);
  const r = await page.evaluate(() => {
    sv('cols', 1); sv('rows', 5); onLayoutChange(); render();   // a tall single-column stack
    const sel = document.getElementById('target-journal'); sel.value = 'asm'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    render(); const pf = _physFacts();
    return { w: getTargetWidthMm(), h: pf.hMm, shown: document.getElementById('export-width-mm').selectedOptions[0].textContent };
  });
  expect(r.h).toBeLessThanOrEqual(228.6 + 0.5);   // was 177.8 mm wide and ~ 900 mm tall
  expect(r.w).toBeGreaterThan(0);
  expect(r.w).toBeLessThan(177.8);
  expect(r.shown).toMatch(/fits ASM's 228.6 mm height/);
  expect(errors).toEqual([]);
});

// ── First use: errors, tutorials, empty state, readouts ────────────────────
test('newcomer-24: a bad file is refused in plain words', async ({ page }, info) => {
  const errors = await loadApp(page);
  const dir = info.outputPath('bad'); fs.mkdirSync(dir, { recursive: true });
  const bytes = Buffer.alloc(4096); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919 + 13) & 255;
  bytes.write('II*\0', 0, 'latin1'); bytes.writeUInt32LE(4000000, 4);     // a TIFF header pointing past the end
  fs.writeFileSync(dir + '/corrupt_scan.tif', bytes);
  fs.writeFileSync(dir + '/notes.txt', 'some notes, not an image');
  fs.writeFileSync(dir + '/empty.png', Buffer.alloc(0));
  await page.evaluate(() => { window._t = []; const o = toast; window.toast = (m, k) => { window._t.push(m); return o(m, k); }; });
  for (const f of ['corrupt_scan.tif', 'notes.txt', 'empty.png']) {
    await page.locator('#file-input').setInputFiles(dir + '/' + f);
    await page.waitForTimeout(300);
  }
  const t = (await page.evaluate(() => window._t)).join('\n');
  expect(t).toMatch(/corrupt_scan\.tif": the TIFF is damaged or cut short/);
  expect(t).toMatch(/notes\.txt": it is not an image file/);
  expect(t).toMatch(/empty\.png": the file is empty \(0 bytes\)/);
  expect(t).not.toMatch(/DataView|outside the bounds/);
  expect(await page.evaluate(() => images.filter(Boolean).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('newcomer-15 / newcomer-16: a tutorial gives your own figure back in one step; the tour closes Help', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => { images[0].captionNote = 'MY FIGURE'; images.forEach((im, i) => im.label = 'XYZ'[i]); render(); });
  page.on('dialog', d => d.accept());
  await page.evaluate(() => startTutorial(TUTORIALS.find(t => t.setup && t.id !== 'basics').id));
  // wait for the tutorial to be RUNNING: its setup swaps the images before it finishes, and
  // an abort before _tut is set is a no-op (the tutorial then starts over the dialog)
  await page.waitForFunction(() => !images.some(im => im && im.captionNote === 'MY FIGURE') && _tut && document.getElementById('tour-ov'));
  await page.evaluate(() => _tutAbort());                      // Esc / end of the tutorial
  await expect(page.locator('#confirm-modal-bg')).toBeVisible();
  await expect(page.locator('#confirm-modal-bg')).toContainText('Bring your own figure back?');
  await page.locator('#cm-ok').click();
  const back = await page.evaluate(() => images.filter(Boolean).map(im => im.label + ':' + (im.captionNote || '')));
  expect(back).toEqual(['X:MY FIGURE', 'Y:', 'Z:']);
  // the five-minute tour does not run under the Help dialog
  await page.evaluate(() => { openHelp('tutorials'); startTour(true); });
  expect(await page.evaluate(() => document.getElementById('help-modal').classList.contains('open'))).toBe(false);
  expect(errors).toEqual([]);
});

test('newcomer-15 / freeform-44: with nothing left in the figure, nothing is left painted under the welcome card', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    pushUndo({ boundary: true }); images.length = 0; renderImgList(); render();
    const c = document.getElementById('fig-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    return { card: getComputedStyle(document.getElementById('empty-state')).display, ink };
  });
  expect(r.card).toBe('flex');
  expect(r.ink).toBe(0);
  expect(errors).toEqual([]);
});

test('newcomer-25 / freeform-48: the size readouts follow a new printed width and a loaded freeform canvas', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => render());
  await page.locator('#export-width-mm').selectOption('190.5', { force: true });
  await expect(page.locator('#canvas-info')).toContainText('190.5×');
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); sel.value = 'freeform'; setLayoutMode('freeform');
    addFreeformElement({ type: 'rect', x: 50, y: 50, w: 100, h: 100 });
    sv('fm-canvas-w', 1328); render(); const a = document.getElementById('phys-readout').textContent;
    sv('fm-canvas-w', 1200); sv('fm-canvas-h', 536); render(); const b = document.getElementById('phys-readout').textContent;
    return { a, b };
  });
  expect(r.b).not.toEqual(r.a);
  expect(r.b).toMatch(/Prints 191 × 85 mm/);
  expect(errors).toEqual([]);
});

test('newcomer-19: Open settings from the canvas shows one panel\'s settings at a time', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  for (const i of [0, 1, 2]) {
    await page.evaluate((i) => { const b = panelBounds.find(p => p.idx === i);
      const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
      const k = r.width / canvasLogicalW;
      c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + (b.x + b.w / 2) * k, clientY: r.top + (b.y + b.h / 2) * k })); }, i);
    await page.getByText('Open settings').click();
  }
  const open = await page.evaluate(() => [...document.querySelectorAll('#img-list .img-settings.open')].map(d => d.id));
  expect(open).toEqual(['settings-2']);
  expect(errors).toEqual([]);
});

test('freeform-08: the autosave warning names the images it could not hold', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const t = await page.evaluate(() => {
    window._t = []; const o = toast; window.toast = (m, k) => { window._t.push(m); return o(m, k); };
    images[0].name = 'MG1655_tilescan_6000px.png';
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === AUTOSAVE_KEY && String(v).includes(images[0].src.slice(30, 90))) throw new Error('QuotaExceededError'); return orig.call(this, k, v); };
    try { autosaveNow(); } finally { Storage.prototype.setItem = orig; }
    return window._t.join('\n');
  });
  expect(t).toMatch(/Autosave cannot hold the pixels of 1 image \(MG1655_tilescan_6000px\.png; too large/);
  expect(errors).toEqual([]);
});
