// @ts-check
// Three engine-level behaviours that each removed a whole class of "it's missing / it
// broke" reports: every dialog closes the same way and holds the keyboard while open;
// the panel list keeps its open drawers, ticks, scroll and the selection across
// rebuilds and undo; and hiding a panel in a named grid leaves its cell blank instead
// of sliding the rest under the wrong headings. Each test names what it saw before.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

// Open a dialog the way the app does, by id.
async function openDialog(page, id) {
  await page.evaluate((id) => {
    if (id === 'info-modal-bg') showInfoModal('Report', '<p>body</p>');
    else if (id === 'confirm-modal-bg') showConfirmModal('Sure?', 'body', () => {});
    else if (id === 'help-modal') openHelp();
    else document.getElementById(id).classList.add('open');
  }, id);
}
const isOpen = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  return !!el && el.isConnected && getComputedStyle(el).display !== 'none';
}, id);

// ── 1. Dialogs ───────────────────────────────────────────────────────────────

test('Escape closes every dialog in the registry', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  // Every registered dialog that opens without a session of its own: the crop editor
  // needs a crop session (and already had its own Escape — crop.spec covers it), and
  // the before/after and compare viewers are built by their commands.
  const ids = ['kb-modal', 'help-modal', 'cmd-palette', 'preflight-modal', 'customize-modal',
    'ff-adjust-modal', 'calib-modal', 'chart-modal', 'genemap-modal', 'info-modal-bg', 'confirm-modal-bg'];
  const stuck = [];
  for (const id of ids) {
    await openDialog(page, id);
    expect(await isOpen(page, id), `${id} opened`).toBe(true);
    await page.keyboard.press('Escape');
    if (await isOpen(page, id)) stuck.push(id);
    // tidy up whatever stayed open, the way its own × would
    await page.evaluate((id) => { const el = document.getElementById(id);
      if (el && el.classList.contains('modal-bg')) el.classList.remove('open'); else if (el) el.remove(); }, id);
  }
  // Before: Escape closed only the palette (with its input focused) and the crop
  // editor; the help, shortcuts, calibration, chart, gene map, Save, customise and
  // adjustment dialogs, the compliance report and the confirm box all stayed open.
  expect(stuck).toEqual([]);
  // and the list above is the registry, not a sample of it
  const registered = await page.evaluate(() => Object.keys(_DIALOGS));
  expect(ids.filter(id => !registered.includes(id))).toEqual([]);
  expect(errors).toEqual([]);
});

test('Escape closes only the topmost dialog, one per press', async ({ page }) => {
  const errors = await loadApp(page);
  await openDialog(page, 'help-modal');
  await openDialog(page, 'kb-modal');        // opened second, so on top (same z-index)
  await page.keyboard.press('Escape');
  // Before: neither closed. Closing by DOM order would shut help first (kb is
  // declared earlier in the markup), so this also pins the open-order stamp.
  expect(await isOpen(page, 'kb-modal')).toBe(false);
  expect(await isOpen(page, 'help-modal')).toBe(true);
  await page.keyboard.press('Escape');
  expect(await isOpen(page, 'help-modal')).toBe(false);
  expect(errors).toEqual([]);
});

test('a click on the backdrop closes the dialog; a click inside, or a drag that ends outside, does not', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => checkCompliance());
  expect(await isOpen(page, 'info-modal-bg')).toBe(true);
  const box = await page.locator('#info-modal-bg > div').boundingBox();
  // inside the report: stays
  await page.mouse.click(box.x + 20, box.y + box.height - 10);
  expect(await isOpen(page, 'info-modal-bg')).toBe(true);
  // a drag from inside the report released over the backdrop: stays
  await page.mouse.move(box.x + 20, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 4 });
  await page.mouse.up();
  expect(await isOpen(page, 'info-modal-bg')).toBe(true);
  // a real click on the dimmed backdrop: closes. Before: the compliance report had no
  // backdrop handler at all, so it stayed.
  await page.mouse.click(8, 8);
  expect(await isOpen(page, 'info-modal-bg')).toBe(false);

  // The help dialog closed on any click whose target was its backdrop — including the
  // drag above, whose click lands on the common ancestor. Before: this drag closed it.
  await openDialog(page, 'help-modal');
  const hb = await page.locator('#help-modal .modal').boundingBox();
  await page.mouse.move(hb.x + 40, hb.y + 40);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 4 });
  await page.mouse.up();
  expect(await isOpen(page, 'help-modal')).toBe(true);
  await page.mouse.click(4, 4);
  expect(await isOpen(page, 'help-modal')).toBe(false);

  // Dialogs holding uncommitted work do not close on a stray click outside.
  await openDialog(page, 'calib-modal');
  await page.mouse.click(4, 4);
  expect(await isOpen(page, 'calib-modal')).toBe(true);
  await page.keyboard.press('Escape');       // …but Escape (a deliberate key) does
  expect(await isOpen(page, 'calib-modal')).toBe(false);
  expect(errors).toEqual([]);
});

test('Ctrl+Z with the compliance report open does not undo the figure behind it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => { pushUndo(); sv('cols', '2'); onLayoutChange(); checkCompliance(); });
  const depth = await page.evaluate(() => undoStack.length);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('a');            // the arrow-tool key
  await page.keyboard.press('Delete');
  const during = await page.evaluate(() => ({ cols: gv('cols'), depth: undoStack.length, tool: activeTool }));
  // Before: Ctrl+Z went straight to undo() — cols snapped back to 3 underneath the
  // report — and 'a' switched the figure to the arrow tool.
  expect(during.cols).toBe('2');
  expect(during.depth).toBe(depth);
  expect(during.tool).toBe('none');
  expect(await isOpen(page, 'info-modal-bg')).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');    // with the report gone the shortcut works again
  expect(await page.evaluate(() => gv('cols'))).toBe('3');
  expect(errors).toEqual([]);
});

test('typing in a dialog field reaches the field, and Escape from it closes the dialog', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => openCustomize());
  await page.locator('#cust-name').fill('');
  await page.locator('#cust-name').click();
  await page.keyboard.type('Vera tab');      // v, a, t, b, e are all figure shortcuts
  const r = await page.evaluate(() => ({ v: document.getElementById('cust-name').value, tool: activeTool }));
  expect(r.v).toBe('Vera tab');
  expect(r.tool).toBe('none');
  await page.keyboard.press('Escape');
  // Before: the customise dialog ignored Escape.
  expect(await isOpen(page, 'customize-modal')).toBe(false);
  expect(errors).toEqual([]);
});

// ── 2. The panel list keeps its state ────────────────────────────────────────

const drawerOpenFor = (page, name) => page.evaluate((name) => {
  const i = images.findIndex(im => im && im.name === name);
  const d = document.getElementById('settings-' + i);
  return !!d && d.classList.contains('open');
}, name);

test('an open ⚙ drawer stays open through a list rebuild, a reorder and an undo', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.locator('[data-gear="1"]').click();
  expect(await drawerOpenFor(page, 'panel1.png')).toBe(true);
  // a mutation that rebuilds the list (hide another panel)
  await page.locator('[data-eye="0"]').click();
  // Before: renderImgList rebuilt the rows closed, so the drawer snapped shut here.
  expect(await drawerOpenFor(page, 'panel1.png')).toBe(true);
  // a reorder: the drawer follows its panel, not its old row
  await page.evaluate(() => { swapImages(1, 2); renderImgList(); });
  expect(await drawerOpenFor(page, 'panel1.png')).toBe(true);
  expect(await drawerOpenFor(page, 'panel2.png')).toBe(false);
  // undo with the real shortcut (focus off any field)
  await page.locator('#fig-canvas').click({ position: { x: 2, y: 2 }, force: true });
  await page.keyboard.press('Control+z');
  expect(await drawerOpenFor(page, 'panel1.png')).toBe(true);
  expect(errors).toEqual([]);
});

test('ticked panels and the sidebar scroll survive a rebuild', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 8);
  await page.locator('#img-list .panel-pick').nth(5).check();
  const r = await page.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    // Open a drawer so the list is long, then scroll the sidebar to its very end —
    // the position clearing the list clamps.
    document.getElementById('settings-6').classList.add('open');
    sb.scrollTop = sb.scrollHeight;
    const before = sb.scrollTop;
    togglePanelExcluded(0);
    return { before, after: sb.scrollTop, scrollable: sb.scrollHeight > sb.clientHeight + 200,
             ticked: _listSelection().map(i => images[i].name) };
  });
  expect(r.scrollable).toBe(true);
  // Before: the sidebar jumped upward and the ticks were rebuilt unticked.
  expect(Math.abs(r.after - r.before)).toBeLessThan(2);
  expect(r.ticked).toEqual(['panel5.png']);
  expect(errors).toEqual([]);
});

test('the selected panel survives undo by identity, and is cleared only if it is gone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    swapImages(0, 1); renderImgList();               // [p1, p0, p2], undoable
    selectedPanel = 0;                               // select p1
    undo();                                          // back to [p0, p1, p2]
    const kept = selectedPanel >= 0 ? images[selectedPanel].name : null;
    // a panel that the undo removes
    pushUndo();
    images.push({ ...images[2], id: 'fresh', name: 'fresh.png', label: 'Z' }); renderImgList();
    selectedPanel = 3;
    undo();
    return { kept, gone: selectedPanel };
  });
  // Before: restoreState set selectedPanel = -1 every time.
  expect(r.kept).toBe('panel1.png');
  expect(r.gone).toBe(-1);
  expect(errors).toEqual([]);
});

// ── 3. Hidden panels in a named grid ─────────────────────────────────────────

// Name of the panel drawn in each cell, '-' for an empty one.
const CELLS = () => panelBounds.map(p => images[p.idx] ? images[p.idx].name.replace('.png', '') : '-').join(',');

test('hiding a panel under column headings leaves its cell blank and the rest stay put', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate((S) => {
    const cells = new Function('return ' + S)();
    sv('cols', 3); sv('rows', 2); sc('show-col-labels', true); onLayoutChange(); render();
    const toasts = []; const real = window.toast; window.toast = (m) => toasts.push(String(m));
    try { togglePanelExcluded(1); } finally { window.toast = real; }
    render();
    return { cells: cells(), figure: _figurePanels().map(im => im.name), toast: toasts[0],
             mini: [...document.querySelectorAll('#mini-grid .mini-cell')].map(c => c.textContent.trim()).join('|'),
             gap: gv('hidden-gap'), note: document.getElementById('hidden-gap-note')?.textContent };
  }, CELLS.toString());
  // Before: panel2 slid into column 2 and panel3 under column 1 of row 2 —
  // "panel0,panel2,panel3,panel4,panel5,-".
  expect(r.cells).toBe('panel0,-,panel2,panel3,panel4,panel5');
  // caption / CSV / compliance enumerate exactly what is drawn
  expect(r.figure).toEqual(['panel0.png', 'panel2.png', 'panel3.png', 'panel4.png', 'panel5.png']);
  expect(r.toast).toMatch(/left blank/);
  expect(r.mini.split('|')[1]).toBe('–');
  expect(r.gap).toBe('auto');
  expect(r.note).toMatch(/Auto: a hidden panel leaves its cell blank — column headings are on/);
  expect(errors).toEqual([]);
});

test('group bands also keep the cell; an unnamed grid still closes up and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate((S) => {
    const cells = new Function('return ' + S)();
    sv('cols', 3); sv('rows', 2); onLayoutChange();
    const toasts = []; const real = window.toast; window.toast = (m) => toasts.push(String(m));
    try { togglePanelExcluded(1); } finally { window.toast = real; }
    render();
    const unnamed = cells(), note = document.getElementById('hidden-gap-note')?.textContent;
    figGroups = [{ axis: 'row', from: 1, to: 2, label: 'Strain' }]; onLayoutChange(); render();
    return { unnamed, toast: toasts[0], note, banded: cells() };
  }, CELLS.toString());
  expect(r.unnamed).toBe('panel0,panel2,panel3,panel4,panel5,-');   // today's reflow, kept
  // Before: the toast only said "hidden from the figure".
  expect(r.toast).toMatch(/moved up a cell/);
  expect(r.note).toMatch(/close up.*no headings or group bands/);
  expect(r.banded).toBe('panel0,-,panel2,panel3,panel4,panel5');
  expect(errors).toEqual([]);
});

test('the gap option overrides Auto both ways, and the panel list matches the drawn cells', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 6);
  const r = await page.evaluate((S) => {
    const cells = new Function('return ' + S)();
    sv('cols', 3); sv('rows', 2); onLayoutChange();
    images[1].excluded = true;
    sv('hidden-gap', 'gap'); onLayoutChange(); render();
    const forcedGap = cells();
    sc('show-col-labels', true); sv('hidden-gap', 'reflow'); onLayoutChange(); render();
    const forcedReflow = cells();
    // The caption/CSV/compliance list, auto row heights and the export walk the same
    // order as the preview.
    sv('hidden-gap', 'gap'); sc('auto-row-h', true); onLayoutChange(); render();
    const drawn = panelBounds.filter(p => images[p.idx]).map(p => images[p.idx].name);
    const pv = document.getElementById('fig-canvas'), ex = renderExportCanvas(96);
    return { forcedGap, forcedReflow, drawn, listed: _figurePanels().map(im => im.name),
             rows: rowHeights(2, 3, gi('panel-w'), gi('panel-h'), gi('gap-h'), gi('gap-v')).length,
             aspect: [pv.width / pv.height, ex.width / ex.height] };
  }, CELLS.toString());
  expect(r.forcedGap).toBe('panel0,-,panel2,panel3,panel4,panel5');
  expect(r.forcedReflow).toBe('panel0,panel2,panel3,panel4,panel5,-');
  expect(r.listed).toEqual(r.drawn);
  expect(r.rows).toBe(2);
  expect(Math.abs(r.aspect[0] - r.aspect[1])).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});

test('the gap option persists through save/load, undo, and older files reopen as drawn', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    const save = () => { const s = JSON.parse(JSON.stringify(serializeSession(false))); delete s.images; return s; };
    sv('hidden-gap', 'gap');
    const s = save();
    sv('hidden-gap', 'reflow');
    applySession(s);
    const loaded = gv('hidden-gap');
    // undo restores it like any layout control
    pushUndo(); sv('hidden-gap', 'reflow'); undo();
    const undone = gv('hidden-gap');
    return { saved: s.layout.hiddenGap, loaded, undone };
  });
  // Before: there was no control, the session had no hiddenGap and applySession never
  // set it.
  expect(r.saved).toBe('gap');
  expect(r.loaded).toBe('gap');
  expect(r.undone).toBe('gap');
  // A file from before the option that hides a panel was drawn closed up, so it
  // reopens that way; one with nothing hidden gets Auto.
  const legacy = await page.evaluate(() => {
    const s = JSON.parse(JSON.stringify(serializeSession(false)));
    delete s.layout.hiddenGap; s.images = [{ name: 'x.png', excluded: true }];
    return [_hiddenGapFrom(s.layout.hiddenGap, s.images), _hiddenGapFrom(undefined, [{ name: 'x.png' }])];
  });
  expect(legacy).toEqual(['reflow', 'auto']);
  expect(errors).toEqual([]);
});
