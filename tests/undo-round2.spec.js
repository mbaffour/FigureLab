// @ts-check
// Undo, round 2: an undo step records exactly one gesture, every control that changes
// the figure records one, and redo is only ever cleared by a change that was recorded.
// The input defects found alongside (Space, tool letters in a select, drags past the
// canvas edge, a gutter dragged past its field's range) are here too, driven with the
// real keyboard and mouse.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1400, height: 900 } });

const Z = 'ControlOrMeta+z';
const depth = page => page.evaluate(() => undoStack.length);
const redoDepth = page => page.evaluate(() => redoStack.length);
// The figure as a saved file would hold it — what an undo step has to put back.
const figure = page => page.evaluate(() => JSON.stringify(serializeSession(false)));
const blur = page => page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur(); });

// Every control in `root` that is inside undo (by the app's own rule, _undoCtl) and on
// screen, with a handle that survives the list being rebuilt by an undo.
async function armedControls(page, root) {
  return page.evaluate((root) => {
    const out = [];
    document.querySelectorAll(root).forEach(r => r.querySelectorAll('input,select,textarea').forEach(el => {
      // (before the rule existed, every control counts — that is what is being tested)
      if (typeof _undoCtl === 'function' ? !_undoCtl(el) : el.type === 'file') return;
      if (!(el.offsetWidth || el.offsetHeight) || el.disabled) return;
      const anc = el.id ? null : el.closest('[id]');
      const idx = anc ? [...anc.querySelectorAll('input,select,textarea')].indexOf(el) : -1;
      out.push({ key: el.id ? '#' + el.id : `#${anc.id} ${el.tagName.toLowerCase()}.${el.className || ''}[${idx}]`,
        id: el.id || null, anc: anc ? anc.id : null, idx });
    }));
    return out;
  }, root);
}
const locate = (page, c) => c.id ? page.locator('#' + c.id)
  : page.locator('#' + c.anc).locator('input,select,textarea').nth(c.idx);

// One real gesture that changes the control's value.
async function gesture(page, c) {
  const loc = locate(page, c);
  await loc.scrollIntoViewIfNeeded();
  const el = await loc.evaluate(e => ({ type: e.type, tag: e.tagName, value: e.value, min: e.min, max: e.max, step: e.step,
    opts: e.tagName === 'SELECT' ? [...e.options].filter(o => !o.disabled).map(o => o.value) : null }));
  if (el.type === 'checkbox' || el.type === 'radio') { await loc.click(); return; }
  if (el.tag === 'SELECT') {
    const v = el.opts.find(o => o !== el.value);
    await loc.focus(); await loc.selectOption(v); return;
  }
  if (el.type === 'range') {
    const b = await loc.boundingBox();
    const lo = +el.min || 0, hi = el.max === '' ? 100 : +el.max, f = (+el.value - lo) / ((hi - lo) || 1);
    await page.mouse.click(b.x + b.width * (f > 0.5 ? 0.15 : 0.85), b.y + b.height / 2); return;
  }
  if (el.type === 'color') {
    // The picker is the OS's own window; focus is what reaches the page before it.
    await loc.focus();
    await loc.evaluate(e => { e.value = e.value.toLowerCase() === '#123456' ? '#654321' : '#123456';
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
    return;
  }
  let v;
  if (el.type === 'number') {
    const cur = parseFloat(el.value) || 0, st = parseFloat(el.step) || 1, hi = el.max === '' ? Infinity : +el.max, lo = el.min === '' ? -Infinity : +el.min;
    v = String(cur + st <= hi ? +(cur + st).toFixed(4) : +(cur - st).toFixed(4));
    if (+v < lo) v = String(lo);
  } else v = (el.value || '') + 'x';
  // Click near the left edge: the middle of a narrow number field is its spinner, and
  // three clicks there are three changes (three steps — correctly, but not this gesture).
  await loc.click({ position: { x: 4, y: 6 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(v);
  await page.keyboard.press('Tab');
}

// Drive every armed control in `root`: one gesture is exactly one step that changed the
// figure, and one Ctrl+Z puts the figure (and the control) back exactly.
async function driveAll(page, root, { prepare, skip } = {}) {
  const fails = [], driven = [];
  if (prepare) await prepare();
  const list = await armedControls(page, root);
  for (const c of list) {
    if (skip && skip(c)) continue;
    if (prepare) await prepare();
    await blur(page);
    const d0 = await depth(page), f0 = await figure(page);
    const v0 = await locate(page, c).evaluate(e => e.type === 'checkbox' ? e.checked : e.value).catch(() => null);
    await gesture(page, c);
    await blur(page);
    await page.waitForTimeout(30);
    const d1 = await depth(page), f1 = await figure(page);
    if (d1 !== d0 + 1) { fails.push(`${c.key}: ${d1 - d0} undo steps for one change (want 1)`); }
    if (f1 === f0) fails.push(`${c.key}: the change did not reach the figure`);
    await page.keyboard.press(Z);
    await page.waitForTimeout(30);
    const d2 = await depth(page), f2 = await figure(page);
    if (d2 !== d0) fails.push(`${c.key}: undo depth ${d2} after Ctrl+Z (want ${d0})`);
    if (f2 !== f0) fails.push(`${c.key}: Ctrl+Z did not put the figure back`);
    if (prepare) await prepare();
    const v2 = await locate(page, c).evaluate(e => e.type === 'checkbox' ? e.checked : e.value).catch(() => null);
    if (v0 !== null && v2 !== v0) fails.push(`${c.key}: control shows ${JSON.stringify(v2)} after Ctrl+Z (was ${JSON.stringify(v0)})`);
    driven.push(c.key);
  }
  return { fails, driven };
}

test.describe('every control that changes the figure is one undo step', () => {
  test('side panel: every armed control, enumerated, records one step that Ctrl+Z reverses', async ({ page }) => {
    test.setTimeout(240000);
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await page.evaluate(() => {
      document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; });
      sc('show-col-labels', true); sc('show-row-labels', true); onLayoutChange();
      figGroups.push({ axis: 'row', from: 1, to: 1, label: 'G1' }); renderGroupList();
      selectedPanel = 0; renderImgList(); render();
      // the first panel's settings, opened as its ⚙ would
      const s = document.getElementById('settings-0'); if (s) s.style.display = 'block';
    });
    // An unrelated earlier edit: no control's step may take it along.
    await page.evaluate(() => { pushUndo(); sv('fig-title', 'Earlier edit'); render(); });
    const prepare = async () => page.evaluate(() => {
      document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; });
      const s = document.getElementById('settings-0'); if (s) s.style.display = 'block';
    });
    // The other panels' settings are the same controls as the first's.
    const skip = c => /^settings-[1-9]/.test(c.anc || '') || c.id === 'layout-mode';
    const { fails, driven } = await driveAll(page, 'aside.sidebar', { prepare, skip });
    expect(fails).toEqual([]);
    // The controls the reports found outside undo are all among those driven.
    for (const id of ['bg-color', 'label-size', 'label-color', 'label-pos', 'sb-h', 'sb-color', 'label-font', 'panel-border-w',
      'panel-border-c', 'label-format', 'tag-pos', 'show-labels', 'label-bg', 'sb-text', 'label-bold', 'label-italic',
      'inset-frames', 'inset-connectors', 'show-tags', 'tag-channels', 'label-auto-color', 'sb-auto-color', 'export-tiff-lzw',
      'export-dpi', 'export-width-mm', 'group-bracket', 'cols', 'gap-h'])
      expect(driven, id).toContain('#' + id);
    expect(driven.some(k => k.startsWith('#settings-0'))).toBe(true);
    expect(driven.some(k => k.startsWith('#group-list'))).toBe(true);
    expect(driven.some(k => k.startsWith('#col-label-inputs'))).toBe(true);
    expect(driven.length).toBeGreaterThan(60);
    expect(await page.evaluate(() => gv('fig-title'))).toBe('Earlier edit');
    expect(errors).toEqual([]);
  });

  test('every control outside undo is named by the rule, and changing one records nothing', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    const outside = await page.evaluate(() => {
      document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; });
      return [...document.querySelectorAll('aside.sidebar input,aside.sidebar select,aside.sidebar textarea')]
        .filter(el => !_undoCtl(el)).map(el => el.id || el.className || el.type);
    });
    // Each is listed in _UNDO_OUTSIDE (or is a file picker) — nothing is outside by accident.
    const unlisted = await page.evaluate(() => [...document.querySelectorAll('aside.sidebar input,aside.sidebar select,aside.sidebar textarea')]
      .filter(el => !_undoCtl(el) && !el.matches(_UNDO_OUTSIDE)).map(el => el.id || el.className));
    expect(unlisted).toEqual([]);
    expect(outside).toEqual(expect.arrayContaining(['ann-color', 'fm-snap', 'autosave-toggle', 'caption-out']));
    // A pen colour is a setting for the next mark: changing it is not a figure change.
    await page.evaluate(() => { pushUndo(); sv('fig-title', 'x'); undo(); });
    const d0 = await depth(page), r0 = await redoDepth(page);
    await page.locator('#ann-width').click({ clickCount: 3 });
    await page.keyboard.type('7'); await page.keyboard.press('Tab');
    expect(await depth(page)).toBe(d0);
    expect(await redoDepth(page)).toBe(r0);
    expect(errors).toEqual([]);
  });

  test('freeform canvas size and the object bar are undo steps', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'text', x: 100, y: 100, w: 160, h: 40, text: 'Hello', label: 'Hello', color: '#111111', fontSize: 20, fontFamily: 'system-ui', align: 'left' }]);
    const prepare = async () => page.evaluate(() => {
      document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; });
      selectedElems.clear(); selectedElems.add(0); updateFreeformElemList(); updateElemPropsBar();
    });
    const a = await driveAll(page, '#freeform-controls', { prepare });
    expect(a.driven).toEqual(expect.arrayContaining(['#fm-canvas-w', '#fm-canvas-h']));
    const b = await driveAll(page, '#elem-props-bar', { prepare });
    expect(b.driven).toEqual(expect.arrayContaining(['#ep-opacity', '#ep-color', '#ep-fs', '#ep-font', '#ep-align']));
    expect([...a.fails, ...b.fails]).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('the floating toolbar', () => {
  for (const kind of ['rect', 'textbox', 'text']) {
    test(`restyling a selected ${kind} is one undo step per change, and Ctrl+Z keeps the mark`, async ({ page }) => {
      test.setTimeout(90000);
      const errors = await loadApp(page);
      await seedPanels(page, 2);
      await page.evaluate((kind) => {
        pushUndo();
        const a = { type: kind, xf: 0.2, yf: 0.3, x2f: 0.5, y2f: 0.6, color: '#ffffff', width: 2, fontSize: 16 };
        if (kind === 'textbox') Object.assign(a, { text: 'Label', fill: true, fillColor: '#000000', fillOpacity: 0.6, shape: 'rect' });
        if (kind === 'text') Object.assign(a, { text: 'note', halo: true });
        annotations.push(a); render();
      }, kind);
      const prepare = async () => page.evaluate(() => { selectedAnnotation = 0; showAnnFloat(0); });
      const { fails, driven } = await driveAll(page, '#ann-float', { prepare });
      expect(fails).toEqual([]);
      expect(driven).toEqual(expect.arrayContaining(['#ann-float-color']));
      if (kind !== 'text') expect(driven).toContain('#ann-float-width');
      if (kind === 'textbox') expect(driven).toEqual(expect.arrayContaining(['#ann-float-tb-text', '#ann-float-fill-opacity']));
      expect(await page.evaluate(() => annotations.length)).toBe(1);
      expect(errors).toEqual([]);
    });
  }

  test('a 📌 panel mark restyled in the toolbar: Ctrl+Z restores its width, not the panel before it', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 3);
    await page.evaluate(() => {
      pushUndo(); images[1].panelAnns = [{ type: 'rect', xf: 0.2, yf: 0.2, x2f: 0.7, y2f: 0.7, color: '#ffffff', width: 2 }];
      selectedPanelAnn = { imgIdx: 1, annIdx: 0 }; const pb = panelBounds.find(p => p.idx === 1); showPanelAnnFloat(1, 0, pb);
    });
    const d0 = await depth(page);
    await page.locator('#ann-float-width').click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('9'); await page.keyboard.press('Tab');
    expect(await page.evaluate(() => images[1].panelAnns[0].width)).toBe(9);
    expect(await depth(page)).toBe(d0 + 1);
    await blur(page); await page.keyboard.press(Z);
    expect(await page.evaluate(() => images[1].panelAnns.map(a => a.width))).toEqual([2]);
    expect(await page.evaluate(() => images.filter(Boolean).length)).toBe(3);
    expect(errors).toEqual([]);
  });
});

test.describe('deleting with the Delete key', () => {
  test('a selected annotation: Ctrl+Z brings back just it, not the edit before', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    await page.evaluate(() => {
      pushUndo(); annotations.push({ type: 'rect', xf: 0.1, yf: 0.1, x2f: 0.3, y2f: 0.3, color: '#ffffff', width: 2 });
      pushUndo(); images[0].rotate = 90; render();
      selectedAnnotation = 0; showAnnFloat(0);
    });
    const d0 = await depth(page);
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => annotations.length)).toBe(0);
    expect(await depth(page)).toBe(d0 + 1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => [annotations.length, images[0].rotate])).toEqual([1, 90]);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    expect(await page.evaluate(() => [annotations.length, images[0].rotate])).toEqual([0, 90]);
    expect(errors).toEqual([]);
  });

  test('a named ruler comes back with its name', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 1);
    await page.evaluate(() => {
      images[0].umPerPx = 0.5; sv('cols', 1); sv('rows', 1); onLayoutChange(); render();
      const pb = panelBounds.find(p => p.idx === 0), W = canvasLogicalW, H = canvasLogicalH;
      pushUndo();
      annotations.push({ type: 'ruler', xf: (pb.x + 20) / W, yf: (pb.y + 30) / H, x2f: (pb.x + 120) / W, y2f: (pb.y + 30) / H, color: '#ffffff', width: 2 });
      document.getElementById('measure-acc').open = true; render();
    });
    await page.waitForSelector('#ruler-results .ruler-name');
    await page.locator('#ruler-results .ruler-name').click();
    await page.keyboard.type('capsid'); await page.keyboard.press('Enter');
    expect(await page.evaluate(() => annotations[0].rulerName)).toBe('capsid');
    await page.evaluate(() => { selectedAnnotation = 0; showAnnFloat(0); });
    await blur(page);
    const d0 = await depth(page);
    await page.keyboard.press('Delete');
    expect(await depth(page)).toBe(d0 + 1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => annotations.map(a => a.rulerName))).toEqual(['capsid']);
    expect(errors).toEqual([]);
  });

  test('a freeform object: Ctrl+Z restores it and keeps the object added after it', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [
      { type: 'text', x: 100, y: 100, w: 120, h: 30, text: 'keep me', label: 'keep me' },
      { type: 'text', x: 100, y: 300, w: 120, h: 30, text: 'second', label: 'second' }]);
    await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); updateFreeformElemList(); });
    const d0 = await depth(page);
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => freeformElements.map(e => e.text))).toEqual(['second']);
    expect(await depth(page)).toBe(d0 + 1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => freeformElements.map(e => e.text).sort())).toEqual(['keep me', 'second']);
    expect(errors).toEqual([]);
  });
});

test('a burst of arrow-key nudges is one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'text', x: 100, y: 100, w: 120, h: 30, text: 'moved', label: 'moved' },
    { type: 'text', x: 100, y: 300, w: 120, h: 30, text: 'second', label: 'second' }]);
  await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); updateFreeformElemList(); });
  const d0 = await depth(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => freeformElements[0].x)).toBe(150);
  expect(await depth(page)).toBe(d0 + 1);
  await page.keyboard.press(Z);
  expect(await page.evaluate(() => freeformElements.map(e => `${e.text}@${e.x}`))).toEqual(['moved@100', 'second@100']);
  // A later burst, after something else was recorded, is a step of its own.
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  expect(await depth(page)).toBe(d0 + 1);
  expect(await page.evaluate(() => freeformElements[0].y)).toBe(102);
  expect(errors).toEqual([]);
});

test.describe('📌 panel marks are undo steps when made', () => {
  test('an arrow drawn on panel B: Ctrl+Z removes the arrow and nothing else', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await page.evaluate(() => { if (!panelAnnMode) togglePanelAnnMode(); setTool('arrow'); });
    const d0 = await depth(page);
    const [p, q] = await page.evaluate(() => {
      const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect(), pb = panelBounds.find(b => b.idx === 1);
      const k = r.width / canvasLogicalW;
      return [[r.left + (pb.x + 20) * k, r.top + (pb.y + 20) * k], [r.left + (pb.x + 120) * k, r.top + (pb.y + 90) * k]];
    });
    await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.move(q[0], q[1], { steps: 5 }); await page.mouse.up();
    expect(await page.evaluate(() => (images[1].panelAnns || []).length)).toBe(1);
    expect(await depth(page)).toBe(d0 + 1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => [(images[1].panelAnns || []).length, images.filter(Boolean).length])).toEqual([0, 4]);
    expect(errors).toEqual([]);
  });

  test('📌 text typed on a panel is one step', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    await page.evaluate(() => { if (!panelAnnMode) togglePanelAnnMode(); setTool('text'); });
    const d0 = await depth(page);
    const pt = await page.evaluate(() => {
      const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect(), pb = panelBounds.find(b => b.idx === 0);
      const k = r.width / canvasLogicalW; return [r.left + (pb.x + 40) * k, r.top + (pb.y + 40) * k];
    });
    await page.mouse.click(pt[0], pt[1]);
    await page.keyboard.type('note'); await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (images[0].panelAnns || []).map(a => a.text))).toEqual(['note']);
    expect(await depth(page)).toBe(d0 + 1);
    await blur(page); await page.keyboard.press(Z);
    expect(await page.evaluate(() => (images[0].panelAnns || []).length)).toBe(0);
    expect(await page.evaluate(() => images.filter(Boolean).length)).toBe(2);
    expect(errors).toEqual([]);
  });
});

test('undoing a journal preset puts back its export DPI and printed width', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const before = await page.evaluate(() => [gv('export-dpi'), gv('export-width-mm'), gv('panel-w')]);
  await page.evaluate(() => applyPreset('science'));
  expect(await page.evaluate(() => [gv('export-dpi'), gv('export-width-mm')])).not.toEqual(before.slice(0, 2));
  await page.keyboard.press(Z);
  expect(await page.evaluate(() => [gv('export-dpi'), gv('export-width-mm'), gv('panel-w')])).toEqual(before);
  expect(errors).toEqual([]);
});

test.describe('modes and starters', () => {
  test('switching the layout mode is its own step; Ctrl+Z switches back and keeps the label edit before it', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    await page.evaluate(() => { pushUndo(); images[1].label = 'Q'; renderImgList(); render(); });
    const d0 = await depth(page);
    await page.locator('#layout-mode').click();
    await page.locator('#layout-mode').selectOption('freeform');
    await blur(page);
    expect(await page.evaluate(() => layoutMode)).toBe('freeform');
    expect(await depth(page)).toBe(d0 + 1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => [layoutMode, images[1].label])).toEqual(['grid', 'Q']);
    expect(errors).toEqual([]);
  });

  test('a grid starter is one step and says when panels no longer fit', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 6);
    await page.evaluate(() => { sv('cols', 3); sv('rows', 2); onLayoutChange(); render(); undoStack = []; redoStack = []; });
    await page.evaluate(() => applyStarter('grid2x2'));
    expect(await page.evaluate(() => [gv('cols'), gv('rows')])).toEqual(['2', '2']);
    expect(await depth(page)).toBe(1);
    await expect(page.locator('#toast')).toContainText('not shown');
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => [gv('cols'), gv('rows')])).toEqual(['3', '2']);
    // The pathway starter's five objects are one step too, and Ctrl+Z leaves freeform.
    await page.evaluate(() => applyStarter('pathway'));
    expect(await page.evaluate(() => [layoutMode, freeformElements.length])).toEqual(['freeform', 5]);
    expect(await depth(page)).toBe(1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => [layoutMode, freeformElements.length])).toEqual(['grid', 0]);
    expect(errors).toEqual([]);
  });
});

test.describe('focus on a control', () => {
  test('Ctrl+Z right after ticking a checkbox undoes the tick', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    const d0 = await depth(page);
    await page.locator('#show-col-labels').click();
    expect(await page.evaluate(() => [gc('show-col-labels'), document.activeElement.id])).toEqual([true, 'show-col-labels']);
    expect(await depth(page)).toBe(d0 + 1);
    await page.keyboard.press(Z);
    expect(await page.evaluate(() => gc('show-col-labels'))).toBe(false);
    expect(await depth(page)).toBe(d0);
    // …and Space on the focused box still ticks it (the figure's Space-pan does not take it).
    await page.keyboard.press(' ');
    expect(await page.evaluate(() => gc('show-col-labels'))).toBe(true);
    expect(await depth(page)).toBe(d0 + 1);
    expect(errors).toEqual([]);
  });

  test('a letter typed in a select picks an option, not a drawing tool', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 1);
    await page.evaluate(() => { document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; }); setTool('none'); });
    await page.locator('#label-pos').focus();
    await page.keyboard.press('a');
    await page.keyboard.press('b');
    expect(await page.evaluate(() => activeTool)).toBe('none');
    expect(errors).toEqual([]);
  });

  test('Space activates a focused button and toggles a focused section header', async ({ page }) => {
    const errors = await loadApp(page);
    await page.locator('#help-btn').focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#help-modal')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    const sum = page.locator('#measure-acc > summary');
    const open0 = await page.evaluate(() => document.getElementById('measure-acc').open);
    await sum.focus();
    await page.keyboard.press(' ');
    expect(await page.evaluate(() => document.getElementById('measure-acc').open)).toBe(!open0);
    expect(errors).toEqual([]);
  });
});

test('an empty batch-crop Apply records nothing and keeps the redo history', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(() => { pushUndo(); images[0].label = 'X'; undo(); });
  const d0 = await depth(page), r0 = await redoDepth(page);
  expect(r0).toBe(1);
  await page.evaluate(() => startBatchCrop());
  await page.locator('#crop-apply-btn').click();
  await expect(page.locator('#toast')).toContainText('Draw a crop region first');
  expect([await depth(page), await redoDepth(page)]).toEqual([d0, r0]);
  await page.evaluate(() => closeCropModal());
  expect(errors).toEqual([]);
});

test.describe('the pointer past the edge', () => {
  test('a gutter dragged far right stops at the gap field\'s maximum', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 3);
    const [x, y] = await page.evaluate(() => {
      sv('cols', 3); sv('rows', 1); onLayoutChange(); render();
      const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect(), k = r.width / canvasLogicalW;
      const a = panelBounds.find(b => b.idx === 0), g = gi('gap-h');
      return [r.left + (a.x + a.w + g / 2) * k, r.top + (a.y + a.h / 2) * k];
    });
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(1390, y, { steps: 10 }); await page.mouse.up();
    const r = await page.evaluate(() => { const f = document.getElementById('gap-h'); return [+f.value, f.validity.valid]; });
    expect(r[0]).toBeGreaterThan(6);
    expect(r).toEqual([100, true]);
    expect(errors).toEqual([]);
  });

  test('a box released a few pixels past the canvas edge is still made, clamped to the canvas', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await page.evaluate(() => setTool('rect'));
    const d0 = await depth(page);
    const g = await page.evaluate(() => {
      const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect(), pb = panelBounds.find(b => b.idx === 2) || panelBounds[0];
      const k = r.width / canvasLogicalW;
      return { x0: r.left + (pb.x + 30) * k, y0: r.top + (pb.y + 30) * k, right: r.right, y1: r.top + (pb.y + 120) * k };
    });
    expect(g.right + 12).toBeLessThan(1400);
    await page.mouse.move(g.x0, g.y0); await page.mouse.down();
    await page.mouse.move(g.right + 12, g.y1, { steps: 8 }); await page.mouse.up();
    const a = await page.evaluate(() => annotations.map(a => [a.type, a.x2f]));
    expect(a.length).toBe(1);
    expect(a[0][0]).toBe('rect');
    expect(a[0][1]).toBeLessThanOrEqual(1);
    expect(a[0][1]).toBeGreaterThan(0.99);
    expect(await depth(page)).toBe(d0 + 1);
    expect(errors).toEqual([]);
  });
});

test('a measurement taken by mistake: Ctrl+Z removes it, and so does its ✕ (which Ctrl+Z undoes)', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 50, w: 400, h: 300, iw: 200, ih: 150, fill: '#808080' }]);
  await page.evaluate(() => { document.getElementById('measure-acc').open = true; setTool('measure-roi'); });
  const roi = async (x0, y0, x1, y1) => {
    const [a, b] = await page.evaluate(([x0, y0, x1, y1]) => {
      const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect(), k = r.width / canvasLogicalW;
      return [[r.left + x0 * k, r.top + y0 * k], [r.left + x1 * k, r.top + y1 * k]];
    }, [x0, y0, x1, y1]);
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
  };
  const d0 = await depth(page);
  await roi(100, 100, 200, 180);
  await roi(220, 120, 300, 200);
  expect(await page.evaluate(() => measurements.length)).toBe(2);
  expect(await depth(page)).toBe(d0 + 2);
  await page.keyboard.press(Z);
  expect(await page.evaluate(() => measurements.map(m => m.label))).toEqual(['ROI 1']);
  expect(await page.locator('#meas-list .meas-row').count()).toBe(1);
  await page.locator('#meas-list [data-meas-del="0"]').click();
  expect(await page.evaluate(() => measurements.length)).toBe(0);
  await expect(page.locator('#export-measurements-btn')).toBeHidden();
  await blur(page); await page.keyboard.press(Z);
  expect(await page.evaluate(() => measurements.map(m => m.label))).toEqual(['ROI 1']);
  await expect(page.locator('#export-measurements-btn')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the S1 sheet, its dialog and the ruler table name a panel as the figure prints it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 1); images.forEach(im => { im.cropL = 10; }); sv('label-format', 'abc'); onLayoutChange(); render();
    const out = { figure: images.map(im => formatLabel(im.label)) };
    const t = [], P = CanvasRenderingContext2D.prototype, of = P.fillText;
    P.fillText = function (s, ...x) { t.push(String(s)); return of.call(this, s, ...x); };
    try { _s1PageCanvas(images[1], {}); } finally { P.fillText = of; }
    out.header = t[0]; out.letters = t.filter(s => /^[A-Za-z]$/.test(s));
    openS1Dialog(); out.dialog = [...document.querySelectorAll('#s1-list b')].map(e => e.textContent); document.getElementById('s1-modal-bg').remove();
    images[1].umPerPx = 0.5; const pb = panelBounds.find(p => p.idx === 1), W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'ruler', xf: (pb.x + 20) / W, yf: (pb.y + 20) / H, x2f: (pb.x + 80) / W, y2f: (pb.y + 20) / H, color: '#fff', width: 2 });
    render(); out.ruler = _rulerRows().map(r => r.panel);
    sv('label-format', 'roman'); render(); out.rulerRoman = _rulerRows().map(r => r.panel);
    return out;
  });
  expect(r.figure).toEqual(['a', 'b']);
  expect(r.header).toBe('Panel b — uncropped original');
  expect(r.letters).toEqual(['b']);
  expect(r.dialog).toEqual(['a', 'b']);
  expect(r.ruler).toEqual(['b']);
  expect(r.rulerRoman).toEqual(['ii']);
  expect(errors).toEqual([]);
});
