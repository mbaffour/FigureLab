// Verifies docs/guides/tips-and-tricks.md and the "old habit → new way" rows of
// troubleshooting.md that no figure-type guide already checks: ⌘K phrases, keyboard
// shortcuts, zoom and pan, pt vs px, marks pinned to panels, Trim borders, tutorials.
'use strict';
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

// ⌘K phrase → what the top hit must be (the table in tips-and-tricks.md).
const PHRASES = {
  'add arrow': /^Draw an arrow/,
  'remove white border': /^Trim borders/,
  'change font': /^Font \(typeface\)/,
  'font size': /^Text size in points/,
  'letter size': /Size of the panel letters|Panel letter size/,
  'span': /span two columns or rows/,
  'make bigger': /^Panel width/,
  'copy style': /Apply to all/,
  'swap panels': /^Swap or reorder panels/,
  'batch crop': /^Batch crop all images/,
  'densitometry': /^Analyse lanes & bands/,
  'lane table': /^Lane table/,
  'calibrate': /^Calibrate a panel/,
  'auto-detect scale bar': /^Auto-detect a burned-in scale bar/,
  'scale bar off': /^Scale bars off on uncalibrated panels/,
  'ruler': /^Ruler/,
  'count plaques': /^Count objects/,
  'split channels': /^Split a merge/,
  'linked inset': /^Add linked inset/,
  'sample colours': /^Sample colours/,
  'nature': /^Journal: Nature/,
  'plos': /^Journal: PLOS ONE/,
  'mbio': /^Journal: ASM/,
  'j bacteriol': /^Journal: ASM/,
  'jbc': /^Journal: JBC/,
  'nat comms': /^Journal: no preset for Nature Communications/,
  'add scale bar': /^Scale bar: add one to a micrograph/,
  'save my work': /^Save session/,
  'add images': /^Add images/,
  'delete panel': /^Remove the selected panel/,
  'make text bigger': /^Text size in points/,
  'check against plos': /^Check against PLOS ONE/,
  'legend key': /^Legend key: place it on the figure/,
  'alt text': /^Alt text/,
  'submission': /^Export submission package/,
  'replace image': /^Replace image/,
  'load session': /^Load a saved session/,
  'position': /^Position and size: type X, Y, W, H/,
  'graphical abstract': /^Canvas: graphical abstract \(Elsevier\)/,
  'tutorial': /^Tutorials/,
  // round 3
  'copy calibration': /^Same µm\/px on ticked panels/,
  'fit panels to images': /^Fit panels to images/,
  'rename channel': /^Rename a channel in the legend key/,
  'relabel': /^Relabel panels A, B, C/,
  'scale bar corner': /^Scale bar: which corner/,
  'session library': /^Save to session library/,
};

(async () => {
  const T = await L.start('tips');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');
  const files = [
    I.fluorTiff(path.join(inp, 'C1-HeLa_DMSO_DAPI.tif'), 'DAPI'),
    I.fluorTiff(path.join(inp, 'C2-HeLa_DMSO_GFP.tif'), 'GFP'),
    await I.bacteriaPhoto(T, path.join(inp, 'phase_contrast.png')),
    I.blotTiff(path.join(inp, 'PhoA_blot.tif')),
  ];
  const clickPanel = async (letter, fx = 0.5, fy = 0.5, how = 'click') => {
    const pt = await p.evaluate(([Lt, fx, fy]) => {
      const cv = document.getElementById('fig-canvas'), c = cv.getBoundingClientRect(), k = c.width / cv.width;
      const b = panelBounds.find(q => images[q.idx] && formatLabel(images[q.idx].label) === Lt);
      return b && { x: c.x + (b.x + b.w * fx) * k, y: c.y + (b.y + b.h * fy) * k };
    }, [letter, fx, fy]);
    if (!pt) throw new Error('panel ' + letter + ' is not on the canvas');
    if (how === 'none') return pt;
    if (how === 'dbl') await p.mouse.dblclick(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y);
    await p.waitForTimeout(300);
    return pt;
  };

  await step(T, 'Tab once from page load, then Enter, reaches the figure toolbar', async () => {
    await p.keyboard.press('Tab');
    const a = await p.evaluate(() => document.activeElement.textContent.trim());
    expect(/Skip to the figure toolbar/.test(a), 'first Tab: ' + a);
    // ux2: a second Tab skips to the welcome card (add images, load a session, tutorials)
    await p.keyboard.press('Tab');
    const w = await p.evaluate(() => document.activeElement.textContent.trim());
    expect(/^Skip to the welcome card/.test(w), 'second Tab: ' + w);
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const wl = await p.evaluate(() => { const a = document.activeElement; return (a.innerText || a.getAttribute('aria-label') || a.id || '').replace(/\s+/g, ' ').trim().slice(0, 60); });
    expect(/Drop images|add images|Load|Tutorial/i.test(wl), 'after Enter on the welcome-card link: ' + wl);
    await p.locator('#render-btn').focus(); await p.keyboard.press('Shift+Tab');
    while (!/^Skip to the figure toolbar/.test(await p.evaluate(() => document.activeElement.textContent.trim()))) await p.keyboard.press('Shift+Tab');
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const b = await p.evaluate(() => document.activeElement.textContent.trim());
    expect(/Render/.test(b), 'after Enter: ' + b);
    return `"${a}" → ${b}; second Tab: "${w}" → Enter lands on "${wl}"`;
  });

  await step(T, 'add four images', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), files);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 15000 });
    const got = p.locator('button', { hasText: 'Got it' });
    if (await got.count()) await got.first().click().catch(() => {});
  });

  await step(T, `⌘K: ${Object.keys(PHRASES).length} plain phrases each put the right tool first`, async () => {
    const bad = [];
    for (const [q, re] of Object.entries(PHRASES)) {
      const hits = await L.cmdk(T, q, { enter: false });
      if (!hits[0] || !re.test(hits[0])) bad.push(`${q} → ${hits[0]}`);
    }
    expect(!bad.length, bad.join('; '));
  });

  await step(T, 'Trim borders (⌘K "trim") previews each panel; the blot and the dark fluorescence fields start unticked', async () => {
    await L.cmdk(T, 'trim');
    const m = p.locator('#info-modal-bg');
    await m.waitFor({ state: 'visible' });
    const txt = await m.innerText();
    expect(/Trim borders/.test(txt), txt.slice(0, 80));
    const rows = await m.locator('input[type=checkbox]').evaluateAll(els =>
      els.map(e => ({ t: (e.closest('label') || e.parentElement).innerText.replace(/\s+/g, ' ').trim(), on: e.checked })));
    const blot = rows.find(r => /PhoA_blot/.test(r.t)), dapi = rows.find(r => /DAPI/.test(r.t)), gfp = rows.find(r => /GFP/.test(r.t));
    expect(blot && !blot.on, 'blot row: ' + JSON.stringify(blot));
    // ux2 (was ISSUES.md): dark-background fluorescence fields used to start ticked
    expect(dapi && !dapi.on && gfp && !gfp.on, 'fluorescence rows: ' + JSON.stringify([dapi, gfp]));
    await L.shot(T, 'tips-trim', m.locator('xpath=./*[1]'), { doc: true });
    await p.keyboard.press('Escape');
    return rows.map(r => `${r.on ? '☑' : '☐'} ${r.t.slice(0, 60)}`).join(' | ');
  });

  // ux2: panels can be picked, swapped and opened from the keyboard.
  // A click on a panel does not give the figure the keyboard: Tab to it. It comes right
  // after the figure toolbar, so: Skip to the figure toolbar, then Tab past the toolbar.
  await step(T, 'Keyboard: Tab to the figure (after the toolbar), → picks a panel, Shift+← swaps it with A, Enter opens its settings; Ctrl/⌘+Z undoes the swap', async () => {
    const names0 = await p.evaluate(() => images.filter(Boolean).map(i => formatLabel(i.label) + ':' + i.name.split('_').pop()).join(' '));
    // where "Skip to the figure toolbar" lands (checked in the first step)
    await p.locator('#render-btn').focus();
    let n = 0;
    while (n < 40 && await p.evaluate(() => document.activeElement.id) !== 'ann-canvas') { await p.keyboard.press('Tab'); n++; }
    expect(n < 40, 'Tab never reached the figure');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
    let live1 = await p.locator('#panel-kb-live').innerText();
    if (!/^Panel B /.test(live1)) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250); live1 = await p.locator('#panel-kb-live').innerText(); }
    expect(/^Panel B .*selected/.test(live1), 'after →: ' + live1);
    const tabs = n;
    await p.keyboard.press('Shift+ArrowLeft'); await p.waitForTimeout(400);
    const live2 = await p.locator('#panel-kb-live').innerText();
    const names1 = await p.evaluate(() => images.filter(Boolean).map(i => formatLabel(i.label) + ':' + i.name.split('_').pop()).join(' '));
    expect(/^Moved: .* is now panel A/.test(live2) && names1.startsWith('A:GFP.tif B:DAPI.tif'), live2 + ' | ' + names1);
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const live3 = await p.locator('#panel-kb-live').innerText();
    const open = await p.evaluate(() => { const a = document.activeElement, it = a && a.closest('.img-item'); return it ? it.innerText.split('\n').find(l => /\.tif|\.png/.test(l)) : ''; });
    expect(/^Settings of Panel A/.test(live3) && /GFP/.test(open), live3 + ' | focus in ' + open);
    await p.keyboard.press('Escape');
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(400);
    const names2 = await p.evaluate(() => images.filter(Boolean).map(i => formatLabel(i.label) + ':' + i.name.split('_').pop()).join(' '));
    expect(names2 === names0, 'undo: ' + names2 + ' (was ' + names0 + ')');
    return `${tabs} Tabs after ⟳ Render; ${live1} → ${live2} → ${live3}; Ctrl+Z → ${names2}`;
  });

  // ux3 (was ISSUES.md "a click on a panel does not give the figure the keyboard")
  await step(T, 'Keyboard: a click on a panel gives the figure the keyboard — → then picks the next panel', async () => {
    await clickPanel('A');
    const a = await p.evaluate(() => document.activeElement.id);
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
    const live = await p.locator('#panel-kb-live').innerText();
    expect(a === 'ann-canvas' && /^Panel B .*selected/.test(live), 'focus ' + a + ' | ' + live);
    await p.keyboard.press('Escape');
    return live;
  });

  // ux3 (newcomer2-19): ↻ with nothing selected turns every photo, and says so with an Undo button
  await step(T, '↻ in the toolbar with no panel selected turns every photo; the toast names them, and its ↶ Undo turns them back', async () => {
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } }); await p.keyboard.press('Escape');
    await L.toasts(T);
    const rot = () => p.evaluate(() => images.map((im, i) => im ? _panelAngle(i) : null).filter(v => v !== null).join(','));
    const r0 = await rot();
    await p.locator('button[aria-label="Rotate 90 degrees clockwise"]').click(); await p.waitForTimeout(500);
    const t = await L.toasts(T), r1 = await rot();
    await p.locator('#toast button', { hasText: 'Undo' }).click(); await p.waitForTimeout(500);
    const r2 = await rot();
    expect(/^No panel was selected, so all 4 photos \(A, B, C and D\) turned clockwise/.test(t) && r1 !== r0 && r2 === r0, `${t} | ${r0} → ${r1} → ${r2}`);
    return `"${t.replace(/↶ Undo$/, '').trim()}" [↶ Undo] → rotations ${r0} → ${r1} → ${r2}`;
  });

  await step(T, 'Ctrl+Z undoes a Columns change and Ctrl/⌘+Shift+Z redoes it', async () => {
    await L.openSection(T, 'Arrange');
    const cols = p.getByLabel('Columns', { exact: true });
    const c0 = await cols.inputValue();
    await cols.fill('2'); await cols.press('Tab'); await p.waitForTimeout(400);
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(400);
    const c1 = await cols.inputValue();
    await p.keyboard.press('ControlOrMeta+Shift+z'); await p.waitForTimeout(400);
    const c2 = await cols.inputValue();
    expect(c1 === c0 && c2 === '2', `${c0} → 2 → undo ${c1} → redo ${c2}`);
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300);
    await p.keyboard.press('Control+y'); await p.waitForTimeout(300);
    const c3 = await cols.inputValue();
    expect(c3 === '2', 'Ctrl+Y redo gave ' + c3);
    await cols.fill('2'); await cols.press('Tab');
    await p.getByLabel('Rows', { exact: true }).fill('2'); await p.getByLabel('Rows', { exact: true }).press('Tab');
    return `${c0} → 2, undo → ${c1}, redo → ${c2}`;
  });

  await step(T, 'Ctrl+scroll zooms about the pointer; Space+drag pans', async () => {
    const zoom = p.locator('button[title="Reset zoom"]');
    const z0 = await zoom.innerText();
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });   // focus out of any field first
    await p.mouse.move(900, 400);
    await p.keyboard.down('Control'); await p.mouse.wheel(0, -300); await p.waitForTimeout(150); await p.mouse.wheel(0, -300); await p.keyboard.up('Control');
    await p.waitForTimeout(400);
    const z1 = await zoom.innerText();
    expect(parseInt(z1) > parseInt(z0), `zoom ${z0} → ${z1}`);
    const s0 = await p.evaluate(() => { const w = document.getElementById('canvas-wrap'); return [w.scrollLeft, w.scrollTop]; });
    await p.keyboard.down('Space'); await p.mouse.move(900, 400); await p.mouse.down();
    await p.mouse.move(700, 300, { steps: 6 }); await p.mouse.up(); await p.keyboard.up('Space');
    await p.waitForTimeout(300);
    const s1 = await p.evaluate(() => { const w = document.getElementById('canvas-wrap'); return [w.scrollLeft, w.scrollTop]; });
    await zoom.click();
    expect(s1[0] !== s0[0] || s1[1] !== s0[1], 'did not pan');
    return `zoom ${z0} → ${z1}; scroll ${s0} → ${s1}`;
  });

  await step(T, 'pt vs px: Look › Panel letter Size in pt sets the px beside it; a new printed width keeps the pt', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#label-pt').fill('8'); await p.locator('#label-pt').press('Tab'); await p.waitForTimeout(400);
    const px1 = +(await p.locator('#label-size').inputValue());
    await L.openSection(T, 'Export');
    await p.locator('#export-width-mm').selectOption({ index: 1 });            // 89 mm
    await p.waitForTimeout(500);
    const pt2 = +(await p.locator('#label-pt').inputValue()), px2 = +(await p.locator('#label-size').inputValue());
    expect(Math.abs(pt2 - 8) < 0.05 && Math.abs(px2 - px1) > 0.5, `pt ${pt2}, px ${px1} → ${px2}`);
    return `8 pt = ${px1.toFixed(1)} px at the first width, ${px2.toFixed(1)} px at 89 mm`;
  });

  await step(T, 'Annotate & Draw › 📌 Panel mode, ↗ Arrow on B, ↖ Select it, ⧉ Repeat on… › panels in this row', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '📌 Panel mode').click();
    await btn(T, '↗ Arrow').click();
    const a = await clickPanel('B', 0.2, 0.2, 'none');
    const b = await clickPanel('B', 0.5, 0.5, 'none');
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 6 }); await p.mouse.up();
    await p.waitForTimeout(300);
    await btn(T, '↖ Select').click();
    await p.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2); await p.waitForTimeout(300);
    const sel = p.locator('select:visible').filter({ hasText: 'Repeat on' }).first();
    await sel.selectOption({ label: 'panels in this row' }); await p.waitForTimeout(400);
    const t = await L.toasts(T);
    const st = await p.evaluate(() => images.filter(Boolean).map(im => formatLabel(im.label) + ':' + (im.panelAnns || []).filter(x => x.type === 'arrow').length));
    expect(/repeated on 1 panel/.test(t) && st.includes('A:1') && st.includes('B:1'), t + ' ' + st);
    await p.keyboard.press('Escape');
    return t.split(' | ').pop() + ' — ' + st.join(' ');
  });

  await step(T, 'With 📌 Panel mode still on, click panel C › Check › ⧉ Add linked inset…: the dialog is for C', async () => {
    await clickPanel('C');
    await L.openSection(T, 'Check');
    await btn(T, '⧉ Add linked inset…').click();
    const m = p.locator('#crop-modal'); await m.waitFor({ state: 'visible' });
    const title = await m.locator('text=/Inset of/').first().innerText();
    expect(/Inset of C\b/.test(title), 'dialog title: ' + title);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    if (await m.isVisible()) await m.locator('button', { hasText: /^Cancel$/ }).first().click().catch(() => {});
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '📌 Panel mode').click();                                  // off again
    return title;
  });

  await step(T, 'Ctrl/⌘+I in a text field wraps the selection in italic marks', async () => {
    await L.openSection(T, 'Arrange');
    const f = p.locator('#fig-title');
    await f.fill('E. coli'); await f.press('ControlOrMeta+a'); await f.press('ControlOrMeta+i');
    const v = await f.inputValue();
    expect(v === '*E. coli*', 'title field: ' + v);
    await f.fill(''); await f.press('Tab');
    return v;
  });

  await step(T, 'Double-click a panel, type, Enter: the text is pinned to that panel', async () => {
    await clickPanel('A', 0.3, 0.3, 'dbl');
    await p.keyboard.type('GFP-LC3'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const ann = await p.evaluate(() => { const im = images.find(i => formatLabel(i.label) === 'A'); return (im.panelAnns || []).map(a => a.text); });
    expect(ann.includes('GFP-LC3'), 'panel A marks: ' + ann);
  });

  await step(T, '⌘K "span" opens the panel\'s span fields; Col span 2 widens panel A and its pinned text goes with it', async () => {
    const w0 = await p.evaluate(() => panelBounds.find(q => formatLabel(images[q.idx].label) === 'A').w);
    await clickPanel('A');
    await L.cmdk(T, 'span');
    const f = p.locator('input:focus');
    await f.fill('2'); await f.press('Tab'); await p.waitForTimeout(600);
    await p.keyboard.press('r'); await p.waitForTimeout(300);
    const st = await p.evaluate(() => { const im = images.find(i => formatLabel(i.label) === 'A'); const b = panelBounds.find(q => images[q.idx] === im); return { span: im.colSpan || im.span || null, w: b.w, ann: (im.panelAnns || []).map(a => a.text) }; });
    expect(st.ann.includes('GFP-LC3') && st.w > w0 * 1.8, 'width ' + w0 + ' → ' + JSON.stringify(st));
    await L.shot(T, 'tips-span', p.locator('#canvas-container'));
    return JSON.stringify(st);
  });

  // ux3 (newcomer3-10, newcomer3-12): Fit panels to images with mixed shapes offers ⛶ Crop to
  // fill cells; a journal preset keeps the panel shape Fit made
  await step(T, '⌘K "fit panels to images" on mixed shapes offers ⛶ Crop to fill cells', async () => {
    const shape = () => p.evaluate(() => { const b = panelBounds.find(q => formatLabel(images[q.idx].label) === 'B'); return +(b.w / b.h).toFixed(3); });
    await L.openSection(T, 'Arrange');
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });
    await L.toasts(T);
    await L.cmdk(T, 'fit panels to images'); await p.waitForTimeout(600);
    const t = await L.toasts(T), btns = await p.locator('#toast button').allInnerTexts();
    const s1 = await shape();
    await L.cmdk(T, 'plos'); await p.waitForTimeout(600);
    const s2 = await shape();
    await L.toasts(T);
    await L.cmdk(T, 'fit panels to images'); await p.waitForTimeout(600);
    await p.locator('#toast button', { hasText: 'Crop to fill cells' }).click(); await p.waitForTimeout(600);
    const t2 = await L.toasts(T);
    expect(/aren.t all the same shape/.test(t) && btns.some(b => /⛶ Crop to fill cells/.test(b)) && /cropped to fill their cells/.test(t2), JSON.stringify({ t, btns, s1, s2, t2 }));
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300);   // the crops back
    await L.openSection(T, 'Look'); await p.locator('#target-journal').selectOption({ index: 0 }); await p.waitForTimeout(400);   // back to no journal
    return `"${t.slice(0, 110)}…" [${btns.join(', ')}]; ${t2}`;
  });

  await step(T, 'Ctrl/⌘+S downloads the session file', async () => {
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });
    const f = await L.download(T, () => p.keyboard.press('ControlOrMeta+s'), /\.json$/);
    return path.basename(f);
  });

  await step(T, 'Help ❔ lists the Tutorials', async () => {
    await p.locator('button[aria-label="Help and FAQ"]').click(); await p.waitForTimeout(400);
    const vis = await p.getByText('Tutorials', { exact: false }).filter({ visible: true }).count();
    expect(vis > 0, 'no Tutorials entry visible in Help');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  });

  await step(T, 'A tutorial puts the figure aside; End › "Bring your own figure back?" › Restore my figure restores it', async () => {
    const before = await p.evaluate(() => images.filter(Boolean).map(i => i.name).join(','));
    await L.cmdk(T, 'tutorial western');
    await p.waitForTimeout(1500);
    const during = await p.evaluate(() => images.filter(Boolean).map(i => i.name).join(','));
    expect(during !== before, 'tutorial did not load its figure');
    await btn(T, /^End$/).click(); await p.waitForTimeout(800);
    await expectVisible(p.getByText('Bring your own figure back?'));
    await btn(T, /^Restore my figure$/).click(); await p.waitForTimeout(1200);
    const after = await p.evaluate(() => images.filter(Boolean).map(i => i.name).join(','));
    expect(after === before, `before ${before} / after ${after}`);
    return 'restored ' + after.split(',').length + ' panels';
  });

  // ux3 (freeform2-15): ✕ New keeps a font chosen by hand, and says so
  await step(T, 'Look › Font family Times New Roman, then ✕ New › Confirm: the new figure keeps the font and the toast says so', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#label-font').selectOption({ label: 'Times New Roman' }); await p.waitForTimeout(300);
    await L.toasts(T);
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(600);
    const t = await L.toasts(T), f = await p.locator('#label-font').inputValue();
    expect(/New figure started — font Times New Roman kept/.test(t) && /Times New Roman/.test(f), t + ' | ' + f);
    return t + ' — Font family ' + f;
  });

  // ux3 (newcomer3-10): a journal preset keeps the panel shape Fit panels to images made (two
  // 900 × 420 blots, so the fitted cells are not the default square)
  await step(T, 'Two blots › ⌘K "fit panels to images" makes wide cells; ⌘K "plos" keeps that panel shape', async () => {
    const blots = [I.blotTiff(path.join(inp, 'blot_1.tif')), I.blotTiff(path.join(inp, 'blot_2.tif'), { seed: 5 })];
    await L.pickFiles(T, p.getByText('Drop or click to add images'), blots);
    await p.waitForFunction(() => images.filter(Boolean).length === 2, null, { timeout: 15000 });
    await btn(T, 'Got it').click({ timeout: 800 }).catch(() => {});
    const shape = () => p.evaluate(() => { const b = panelBounds.find(q => images[q.idx]); return +(b.w / b.h).toFixed(2); });
    const s0 = await shape();
    await L.cmdk(T, 'fit panels to images'); await p.waitForTimeout(600);
    const s1 = await shape();
    await L.cmdk(T, 'plos'); await p.waitForTimeout(800);
    const s2 = await shape();
    expect(Math.abs(s1 - 900 / 420) < 0.05 && Math.abs(s2 - s1) < 0.02, JSON.stringify({ s0, s1, s2 }));
    return `panel shape ${s0}:1 → Fit ${s1}:1 → PLOS ONE preset ${s2}:1`;
  });

  // ---- round 4 tips -------------------------------------------------------------------------
  // (on the two-blot figure the step above left)
  await step(T, 'Right-click a panel while another panel\'s ⚙ is open: the open settings move to the panel you right-clicked', async () => {
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(300);
    const rows = p.locator('#img-list > .img-item');
    await rows.nth(0).locator('button', { hasText: '⚙' }).first().click(); await p.waitForTimeout(300);
    const pt = await clickPanel('B', 0.5, 0.5, 'none');
    await p.mouse.click(pt.x, pt.y, { button: 'right' }); await p.waitForTimeout(400);
    const open = await p.evaluate(() => [...document.querySelectorAll('#img-list > .img-item')].map((r, i) => r.querySelector('.img-settings.open') ? i : -1).filter(i => i >= 0));
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    expect(open.length === 1 && open[0] === 1, 'settings open on rows ' + JSON.stringify(open));
    for (const r of await rows.all()) if (await r.locator('.img-settings.open').count()) await r.locator('button', { hasText: '⚙' }).first().click();
    return 'settings open on panel B only (row ' + (open[0] + 1) + ')';
  });

  await step(T, 'Ctrl/⌘+S saves the session from inside a text box (the caption box)', async () => {
    await L.openSection(T, 'Export');
    await p.locator('#caption-out').click();
    const f = await L.download(T, () => p.keyboard.press('ControlOrMeta+s'), /\.json$/);
    return 'focus in the caption box → ' + path.basename(f);
  });

  await step(T, 'Caption: a sentence typed at the end of the caption is replaced by ✦ Regenerate; the same sentence as the Chart dialog\'s Caption note stays', async () => {
    const csv = path.join(inp, 'od_tips.csv');
    require('fs').writeFileSync(csv, 'strain,replicate,OD600\nWT,1,1.10\nWT,2,1.20\nWT,3,1.15\nKO,1,0.60\nKO,2,0.55\nKO,3,0.65\n');
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [csv]);
    const chart = p.locator('#chart-modal'); await chart.waitFor({ state: 'visible' }); await p.waitForTimeout(300);
    const NOTE = 'Mean ± SD of three biological replicates; Welch t-test.';
    await chart.locator('#chart-caption').fill(NOTE);
    await chart.getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(600);
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(500);
    const cap0 = await p.locator('#caption-out').inputValue();
    const TYPED = ' Strains were grown in LB at 37 °C.';
    await p.locator('#caption-out').fill(cap0 + TYPED); await p.locator('#caption-out').press('Tab'); await p.waitForTimeout(300);
    // a change to the figure: a caption note on the first blot
    const r0 = p.locator('#img-list > .img-item').first();
    if (!(await r0.locator('.img-settings.open').count())) await r0.locator('button', { hasText: '⚙' }).first().click();
    await r0.locator('input.f-cap').fill('PhoA western blot'); await r0.locator('input.f-cap').press('Enter'); await p.waitForTimeout(800);
    await r0.locator('button', { hasText: '⚙' }).first().click();
    await L.openSection(T, 'Export');
    const flag = p.locator('#caption-stale');
    await flag.waitFor({ state: 'visible', timeout: 5000 });
    const ft = (await flag.innerText()).replace(/\s+/g, ' ');
    await flag.locator('a', { hasText: 'Regenerate' }).click(); await p.waitForTimeout(500);
    const cap1 = await p.locator('#caption-out').inputValue();
    expect(cap0.includes(NOTE) && cap1.includes(NOTE) && cap1.includes('PhoA western blot') && !cap1.includes('Strains were grown'), JSON.stringify({ cap0: cap0.slice(-200), cap1: cap1.slice(-200) }));
    return `flag "${ft}"; after ✦ Regenerate the chart's note stays ("${NOTE}") and the typed sentence is gone`;
  });

  await round5(T, clickPanel, inp);
  await L.finish(T);
})();

// ---- round 5 tips (a fresh figure each) ------------------------------------------------------
async function round5(T, clickPanel, inp) {
  const p = T.page, fs = require('fs');
  const newFigure = async () => {
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } }).catch(() => {});
    await p.keyboard.press('Escape');
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(700);
    await L.toasts(T);
  };
  const margins = () => p.evaluate(() => ({ top: +gv('m-top'), right: +gv('m-right'), btm: +gv('m-btm'), left: +gv('m-left'), W: canvasLogicalW, H: canvasLogicalH }));
  const setWidth = async (v) => {
    await L.openSection(T, 'Export');
    const s = p.locator('#export-width-mm');
    await s.focus(); await s.selectOption(v); await p.waitForTimeout(700);
  };
  const drawn = () => p.evaluate(() => panelBounds.map(q => images[q.idx] && formatLabel(images[q.idx].label)).filter(Boolean).join(''));
  const four = [
    I.fluorTiff(path.join(inp, 'C1-HeLa_DMSO_DAPI.tif'), 'DAPI'),
    I.fluorTiff(path.join(inp, 'C2-HeLa_DMSO_GFP.tif'), 'GFP'),
    path.join(inp, 'phase_contrast.png'),
    path.join(inp, 'PhoA_blot.tif'),
  ];

  await step(T, 'R5 set-up: ✕ New, the four images again (2 × 2), 🎨 Auto-channels', async () => {
    await newFigure();
    await L.pickFiles(T, p.getByText('Drop or click to add images'), four);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 15000 });
    await btn(T, 'Got it').click({ timeout: 800 }).catch(() => {});
    await L.openSection(T, 'Images');
    await btn(T, 'Auto-channels').click(); await p.waitForTimeout(500);
    const g = await p.evaluate(() => [gi('cols'), gi('rows')]);
    expect(g.join('×') === '2×2', 'grid ' + g);
    return 'grid ' + g.join(' × ') + ', drawn ' + await drawn();
  });

  await step(T, 'Panels: ⌘K "span" › Col span 2 on A — the status bar says D has no cell; Arrange › Rows 3 gives it one', async () => {
    await clickPanel('A');
    await L.cmdk(T, 'span');
    const f = p.locator('input:focus');
    await f.fill('2'); await f.press('Tab'); await p.waitForTimeout(700);
    const t = await L.toasts(T);
    const off = await p.locator('#img-list > .img-item').evaluateAll(rows => rows.map(r => { const o = r.querySelector('.f-offgrid'); return o ? o.textContent.trim() : ''; }));
    const status = (await p.locator('#status-l').innerText()).trim();
    expect(/^3 panel\(s\) · 1 not drawn \(no cell\)/.test(status), 'status bar: ' + status + ' | Images rows: ' + JSON.stringify(off));
    // ISSUES (new in round 5): the "has no cell" toast is not shown while ⌘K's own hint toast is up
    const noCell = t.split(' | ').find(x => /no cell in the/.test(x)) || '(no "has no cell" toast: ⌘K\'s hint toast was showing)';
    const d0 = await drawn();
    await L.openSection(T, 'Arrange');
    const rows = p.getByLabel('Rows', { exact: true });
    await rows.fill('3'); await rows.press('Tab'); await p.waitForTimeout(500);
    const d1 = await drawn();
    const status1 = (await p.locator('#status-l').innerText()).trim();
    expect(!d0.includes('D') && d1.includes('D') && /^4 panel\(s\) ·/.test(status1), `drawn ${d0} → ${d1}; status ${status1}`);
    return `status "${status}" → Rows 3 → "${status1}"; drawn ${d0} → ${d1}; ${noCell}; D's Images row marker: "${off[3] || '(none until the list is redrawn)'}"`;
  });

  await step(T, 'Panels: Row span 2 on D in the grid\'s last row — the toast says it needs 1 more row, and its "Add 1 row" button adds it', async () => {
    // the grid is three rows now: ⊡ Fit brings panel D on screen first
    await p.locator('button', { hasText: /^⊡ Fit$/ }).first().click(); await p.waitForTimeout(400);
    await clickPanel('D');
    await L.toasts(T);
    await L.cmdk(T, 'span');
    const hint = await L.toasts(T);
    expect(/Panel D: /.test(hint), '⌘K span opened another panel: ' + hint);
    // the Row span box beside the Col span box ⌘K focused
    const row = await p.evaluate(() => [...document.querySelectorAll('#img-list > .img-item')].findIndex(r => r.contains(document.activeElement)));
    expect(row >= 0, 'no Images row holds the focused span box');
    const items = p.locator('#img-list > .img-item');
    const rs = items.nth(row).locator('.f-rowspan');
    let t = '', r = 0;
    try {
      await rs.fill('2'); await p.waitForTimeout(500);
      t = await L.toasts(T);
      expect(/D is in the grid's last row — Row span 2 needs 1 more row \(Arrange › Rows\)/.test(t), 'toast: ' + t);
      await p.locator('#toast button', { hasText: 'Add 1 row' }).click(); await p.waitForTimeout(500);
      r = await p.evaluate(() => gi('rows'));
      expect(r === 4, 'rows ' + r);
    } finally {
      // back to one cell each, 2 × 2
      await rs.fill('1', { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(200);
      await clickPanel('A').catch(() => {}); await L.cmdk(T, 'span');
      const cs = p.locator('#img-list .f-colspan:focus');
      if (await cs.count()) { await cs.fill('1', { timeout: 10000 }).catch(() => {}); await cs.press('Tab').catch(() => {}); }
      await p.waitForTimeout(200);
      await L.openSection(T, 'Arrange');
      await p.getByLabel('Rows', { exact: true }).fill('2'); await p.getByLabel('Rows', { exact: true }).press('Tab'); await p.waitForTimeout(400);
      await p.locator('#zoom-btn').click().catch(() => {});
      await L.toasts(T);
    }
    return `"${t.split(' | ').find(x => /last row/.test(x))}" [Add 1 row] → Rows ${r}`;
  });

  let fresh, narrow, wide;
  await step(T, 'Legend key: the "Where" menu is labelled; a margin the key grew at 55 mm is given back when the figure is widened to 177.8 mm', async () => {
    await L.openSection(T, 'Export');
    const lbl = (await p.locator('label[for="key-where"]').innerText()).trim();
    expect(lbl === 'Where' && await p.locator('label[for="key-where"]').isVisible(), 'label: ' + lbl);
    await setWidth('177.8');
    const box = p.getByLabel('Place the key on the figure');
    expect(!(await box.isChecked()), 'key already placed');
    // choosing a place in Where ticks the box by itself
    await p.locator('#key-where').selectOption({ label: 'Right edge' }); await p.waitForTimeout(800);
    const ticked = await box.isChecked();
    await p.locator('#key-where').selectOption({ label: 'Free space' }); await p.waitForTimeout(800);
    expect(ticked && await box.isChecked(), 'Where › Right edge did not tick the box');
    fresh = await margins();
    await box.uncheck(); await p.waitForTimeout(500);
    await setWidth('55');
    await box.check(); await p.waitForTimeout(800);
    narrow = await margins();
    await L.toasts(T);
    await setWidth('177.8');
    wide = await margins();
    const back = (await L.toasts(T)).split(' | ').find(x => /needs less room|went back/.test(x)) || '';
    expect(narrow.right + narrow.btm > fresh.right + fresh.btm, 'no more room at 55 mm: ' + JSON.stringify({ fresh, narrow }));
    expect(wide.right === fresh.right && wide.btm === fresh.btm, JSON.stringify({ fresh, narrow, wide }));
    return `"${lbl}" beside the menu; Where › Right edge ticked the box; right/bottom margin at 177.8 mm ${fresh.right}/${fresh.btm} px, placed at 55 mm ${narrow.right}/${narrow.btm}, widened back ${wide.right}/${wide.btm}; toast "${back}"`;
  });

  await step(T, 'Legend key: Ctrl/⌘+S, ✕ New, 📂 Load a session — the figure reopens at the size it was saved, margins included', async () => {
    await p.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } });
    const before = await margins();
    const f = await L.download(T, () => p.keyboard.press('ControlOrMeta+s'), /\.json$/);
    await newFigure();
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: '📂 Load a session' }).click()]);
    await fc.setFiles(f);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 20000 });
    await p.waitForTimeout(1200);
    const after = await margins();
    const on = await p.locator('#key-on-figure').isChecked();
    expect(on && JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after, on }));
    return `${before.W} × ${before.H} px, margins ${before.right}/${before.btm} → reopened ${after.W} × ${after.H}, ${after.right}/${after.btm}`;
  });

  // a chart: replicate columns, three strains
  const swim = path.join(inp, 'swim_diameters_mm.csv');
  fs.writeFileSync(swim, '﻿Strain,Rep 1,Rep 2,Rep 3\r\nWT,41.5,44.0,39.5\r\ndfliC,6.0,5.5,6.5\r\ndfliC + pfilC,33.0,30.5,35.0\r\n,,,\r\n');
  const chart = p.locator('#chart-modal');
  const sig = () => chart.locator('.sec-lbl', { hasText: 'Significance brackets' }).locator('xpath=..');

  await step(T, 'Charts: a bracket WT – dfliC stays on WT and dfliC when Names & colours › ↑ moves "dfliC + pfilC" to the front', async () => {
    await p.getByLabel('Place the key on the figure').uncheck().catch(() => {});
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [swim]);
    await chart.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    // an Excel CSV as saved (BOM, Windows line ends, an empty last row): three groups, Rep 1–3 averaged
    const groups = await chart.locator('#chart-names [data-key]').evaluateAll(els => els.map(e => e.dataset.key));
    const avg = await chart.locator('#chart-repcols').isChecked().catch(() => null);
    expect(groups.join('|') === 'WT|dfliC|dfliC + pfilC' && avg === true, 'groups ' + groups + ', averaged ' + avg);
    await sig().getByRole('button', { name: '+ Add' }).click();
    const sels = sig().locator('select');
    await sels.nth(0).selectOption({ label: 'WT' });
    await sels.nth(1).selectOption({ label: 'dfliC' });
    await sig().locator('input[type=text]').fill('p = 0.001');
    const row = chart.locator('#chart-names [data-key="dfliC + pfilC"]');
    for (let i = 0; i < 2; i++) { await row.locator('button[title="Move left"]').first().click(); await p.waitForTimeout(250); }
    const order = await chart.locator('#chart-names [data-key]').evaluateAll(els => els.map(e => e.dataset.key));
    const pair = [await sels.nth(0).locator('option:checked').innerText(), await sels.nth(1).locator('option:checked').innerText()];
    expect(order[0] === 'dfliC + pfilC' && pair.join('|') === 'WT|dfliC', JSON.stringify({ order, pair }));
    await chart.getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(600);
    return `order ${order.join(', ')}; bracket ${pair.join(' – ')}`;
  });

  await step(T, 'Pitfalls: at 55 mm the compliance Chart room row names the squeezed chart, and its "Give E a … cell" button spans it and adds the row it needs', async () => {
    await setWidth('55');
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click(); await p.waitForTimeout(800);
    const m = p.locator('#info-modal-bg');
    const row = m.locator('.compliance-row').filter({ has: p.locator('.c-label', { hasText: /^Chart room$/ }) });
    const txt = (await row.innerText()).replace(/\s+/g, ' ');
    const b = row.getByRole('button', { name: /^Give E a (taller|wider|bigger) cell$/ });
    const bt = await b.innerText();
    const g0 = await p.evaluate(() => [gi('cols'), gi('rows')]);
    await b.click(); await p.waitForTimeout(700);
    const t = await L.toasts(T);
    const st = await p.evaluate(() => { const el = images.find(q => q && q.type === 'chart'); return { cs: el.colSpan || 1, rs: el.rowSpan || 1, rows: gi('rows'), cols: gi('cols'), drawn: panelBounds.length }; });
    expect(/E now spans/.test(t) && st.cs * st.rs > 1, JSON.stringify({ t, st }));
    await p.keyboard.press('Escape'); await p.locator('#info-modal-bg').evaluate(e => e.remove()).catch(() => {});
    return `"${txt.slice(0, 160)}…" [${bt}] → "${t.split(' | ').find(x => /now spans/.test(x))}"; grid ${g0.join('×')} → ${st.cols}×${st.rows}`;
  });

  await step(T, 'Charts: zeros on a log axis stay in the mean and are drawn at the axis floor; the caption says so', async () => {
    const kill = path.join(inp, 'timekill_zeros.csv');
    fs.writeFileSync(kill, 'time_h,PA14_rep1,PA14_rep2,PA14_rep3,dmexB_rep1,dmexB_rep2,dmexB_rep3\n0,4.3E+06,2.5E+06,3.9E+06,3.4E+06,3.0E+06,5.1E+06\n2,6.0E+04,1.3E+05,8.1E+04,7.0E+03,6.1E+03,1.0E+04\n4,5.6E+03,7.7E+03,5.1E+03,3.9E+02,5.7E+02,4.2E+02\n8,1.2E+03,9.0E+02,1.5E+03,0,100,0\n24,3.0E+02,2.0E+02,4.0E+02,0,0,0\n');
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [kill]);
    await chart.waitFor({ state: 'visible' }); await p.waitForTimeout(400);
    await chart.locator('#chart-ylog').check(); await p.waitForTimeout(400);
    const note = (await chart.innerText()).match(/○[^\n]*axis floor[^\n]*/);
    await chart.getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(800);
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(500);
    const rep = p.getByRole('button', { name: /^Replace$/ });
    if (await rep.isVisible().catch(() => false)) { await rep.click(); await p.waitForTimeout(400); }
    const cap = await p.locator('#caption-out').inputValue();
    const s = (cap.match(/On the log axis, [^.]*include them\./) || [''])[0];
    expect(/drawn at the axis floor \([^)]*\) as open marks; means and n include them\./.test(s), 'caption: ' + cap.slice(-300));
    return `chart note "${note ? note[0].trim() : '(none)'}"; caption "${s}"`;
  });

  await step(T, 'Charts: a Tecan export with its instrument header, Cycle Nr. and Time [s] opens as the reader wrote it', async () => {
    const tecan = path.join(inp, 'tecan_OD600.csv');
    const head = ['Application: Tecan i-control,,', 'Tecan i-control ,3.9.1.0,', 'Device: infinite 200Pro,Serial number: 1408003921,', ',,', 'Date:,11/12/2026,', 'Time:,9:14:22 AM,', ',,',
      'Mode,Absorbance,', 'Measurement Wavelength,600,nm', 'Kinetic Cycles:,9,', 'Interval Time:,00:15:00,', 'Start Time:,11/12/2026 9:14:22 AM,', ',,'];
    const rows = ['Cycle Nr.,Time [s],Temp. [°C],A1,A2,A3,B1,B2,B3'];
    for (let i = 0; i < 9; i++) { const od = (b, k) => (b * Math.exp(0.35 * i * 0.25) + 0.001 * k).toFixed(4); rows.push([i + 1, (i * 900 + (i ? 0.4 : 0)).toFixed(1).replace(/\.0$/, ''), '37.1', od(0.09, 1), od(0.09, 2), od(0.09, 3), od(0.1, 1), od(0.1, 2), od(0.1, 3)].join(',')); }
    const tail = [',,', 'End Time:,11/12/2026 11:14:30 AM,'];
    fs.writeFileSync(tecan, head.concat(rows, tail).join('\r\n') + '\r\n');
    // the same run with "Data in rows": one row per well
    const cells = rows.map(r => r.split(','));
    const tecanRows = path.join(inp, 'tecan_OD600_rows.csv');
    fs.writeFileSync(tecanRows, head.concat(cells[0].map((_, j) => cells.map(r => r[j]).join(',')), tail).join('\r\n') + '\r\n');
    const out = [];
    for (const [file, rowsNote] of [[tecan, false], [tecanRows, true]]) {
      await L.pickFiles(T, p.getByText('Drop or click to add images'), [file]);
      await chart.waitFor({ state: 'visible' }); await p.waitForTimeout(500);
      const st = (await chart.locator('#chart-delim-info').innerText()).replace(/\s+/g, ' ');
      const kind = await chart.locator('#chart-kind').inputValue();
      const ticked = await chart.locator('#chart-ycols input:checked').evaluateAll(b => b.map(x => x.parentElement.textContent.trim()));
      expect(/instrument lines above the table skipped \(it starts at “Cycle Nr\.”\)/.test(st) && /Time \[s\] read as seconds, in minutes \(Time \(min\)\)/.test(st) && kind === 'line' && ticked.join(',') === 'A1,A2,A3,B1,B2,B3', JSON.stringify({ st, kind, ticked }));
      if (rowsNote) expect(/the wells ran down the rows: turned to one column per well/.test(st), 'rows file: ' + st);
      await chart.getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(500);
      out.push(`${path.basename(file)}: "${st.slice(0, 200)}" — ${kind}, wells ${ticked.join(' ')}`);
    }
    return out.join(' || ');
  });

  await step(T, 'Freeform: ⇱ Pop out to free layout, select two pictures, ⇢ connects them; the line follows a picture moved with Shift+↓', async () => {
    await L.openSection(T, 'Arrange');
    await btn(T, '⇱ Pop out to free layout').click(); await p.waitForTimeout(800);
    const go = p.getByRole('button', { name: /^(Pop out|Continue|OK)/ });
    if (await go.first().isVisible().catch(() => false)) { await go.first().click(); await p.waitForTimeout(800); }
    await p.locator('button', { hasText: /^⊡ Fit$/ }).first().click(); await p.waitForTimeout(800);
    await L.toasts(T);
    const pts = await p.evaluate(() => {
      const c = document.getElementById('fig-canvas').getBoundingClientRect(), k = c.width / +document.getElementById('fm-canvas-w').value;
      return freeformElements.map((e, i) => ({ i, type: e.type, x: c.x + (e.x + e.w / 2) * k, y: c.y + (e.y + e.h / 2) * k })).filter(e => e.type === 'image').slice(0, 2);
    });
    expect(pts.length === 2, 'pictures: ' + JSON.stringify(pts));
    await p.mouse.click(pts[0].x, pts[0].y); await p.waitForTimeout(300);
    await p.keyboard.down('Shift'); await p.mouse.click(pts[1].x, pts[1].y); await p.keyboard.up('Shift'); await p.waitForTimeout(400);
    const nsel = await p.evaluate(() => selectedElems.size);
    expect(nsel === 2, 'selected ' + nsel + ' objects after a click and a Shift-click');
    // the selection's floating toolbar holds ⇢ when it is on screen; ⌘K reaches the same command
    const cb = p.locator('#ctx-connect');
    const tip = await cb.getAttribute('title');
    const shown = await cb.isVisible().catch(() => false);
    if (shown) await cb.click({ timeout: 10000 }).catch(() => null);
    if (!(await p.evaluate(() => freeformElements.some(e => e.type === 'connector')))) await L.cmdk(T, 'Connect two objects');
    await p.waitForTimeout(500);
    const t = await L.toasts(T);
    const geom = () => p.evaluate(() => { const c = freeformElements.find(e => e.type === 'connector'); const g = c && _connGeom(c); return g ? JSON.stringify([g.from.x, g.from.y, g.to.x, g.to.y].map(v => Math.round(v))) : null; });
    const g0 = await geom();
    await p.mouse.click(pts[0].x, pts[0].y); await p.waitForTimeout(200);
    for (let i = 0; i < 3; i++) await p.keyboard.press('Shift+ArrowDown');
    await p.waitForTimeout(400);
    const g1 = await geom();
    const listed = await p.evaluate(() => (document.getElementById('ff-elem-list') || document.body).innerText.includes('connector'));
    expect(/^Connected — the line follows both objects as they move/.test(t.split(' | ').pop()) && g0 && g1 && g0 !== g1, JSON.stringify({ t, g0, g1 }));
    return `⇢ "${tip}" (${shown ? 'on screen' : 'toolbar off screen, ⌘K used'}) → "${t.split(' | ').pop()}"; line ${g0} → ${g1} after 3 × Shift+↓; listed as connector: ${listed}`;
  });

  await step(T, 'Marks: MW labels on a strip that is not charted move onto the new ladder when its own ⫼ Lanes & bands is opened after ⇄ Replace image', async () => {
    await newFigure();
    const b1 = I.blotTiff(path.join(inp, 'LC_strip.tif'), { amounts: [1, 1, 1, 1, 1, 1], tiltDeg: 1.2, seed: 3 });
    const b2 = I.blotTiff(path.join(inp, 'LC_strip_reprobe.tif'), { amounts: [1, 1, 1, 1, 1, 1], tiltDeg: -2.0, seed: 13 });
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [b1]);
    await p.waitForFunction(() => images.filter(Boolean).length === 1, null, { timeout: 15000 });
    await btn(T, 'Got it').click({ timeout: 800 }).catch(() => {});
    const g = p.locator('#gel-modal-bg');
    await clickPanel('A');
    await L.cmdk(T, 'densitometry'); await g.waitFor({ state: 'visible' }); await p.waitForTimeout(800);
    await g.locator('#gel-ladder-lane').selectOption({ label: 'lane 1' }); await p.waitForTimeout(300);
    await g.locator('#gel-ladder-sizes').fill('100, 75, 50, 37');
    await g.locator('button', { hasText: /^Fit$/ }).click(); await p.waitForTimeout(500);
    await g.locator('button', { hasText: '↕ Place MW labels on the ladder bands' }).click(); await p.waitForTimeout(600);
    const y0 = await p.evaluate(() => annotations.filter(a => a.mw).map(a => +a.yf.toFixed(3)));
    expect(y0.length >= 3, 'MW labels: ' + y0);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    if (await g.isVisible()) await g.locator('button.modal-close').click();
    const q = await clickPanel('A', 0.75, 0.5, 'none');
    await p.mouse.click(q.x, q.y, { button: 'right' }); await p.waitForTimeout(300);
    await L.pickFiles(T, p.locator('text=⇄ Replace image…').locator('visible=true').first(), [b2]);
    await p.waitForTimeout(1500);
    const rt = (await L.toasts(T)).split(' | ').find(x => /MW labels sit where/.test(x)) || '';
    const y1 = await p.evaluate(() => annotations.filter(a => a.mw).map(a => +a.yf.toFixed(3)));
    await clickPanel('A');
    await L.cmdk(T, 'densitometry'); await g.waitFor({ state: 'visible' }); await p.waitForTimeout(1000);
    const t = await L.toasts(T);
    const y2 = await p.evaluate(() => annotations.filter(a => a.mw).map(a => +a.yf.toFixed(3)));
    await p.keyboard.press('Escape');
    expect(rt && JSON.stringify(y1) === JSON.stringify(y0) && JSON.stringify(y2) !== JSON.stringify(y1) && /MW labels? of panel A moved onto the new ladder’s bands/.test(t), JSON.stringify({ rt, y0, y1, y2, t }));
    return `replace toast "…${rt.slice(rt.indexOf('its MW labels'), rt.indexOf('its MW labels') + 60)}…"; labels at ${y0.join('/')} → opened ⫼ Lanes & bands: "${(t.match(/\d+ MW labels? of panel A moved[^;|]*/) || [''])[0]}" (${y2.join('/')})`;
  });
}

async function expectVisible(loc) {
  await loc.first().waitFor({ state: 'visible', timeout: 4000 });
}
