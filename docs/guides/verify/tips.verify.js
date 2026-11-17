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

  await L.finish(T);
})();

async function expectVisible(loc) {
  await loc.first().waitFor({ state: 'visible', timeout: 4000 });
}
