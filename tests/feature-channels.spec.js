// @ts-check
// Split channels and its inverse, Merge channels, share one model: a panel whose
// channels[] holds the other colours of the same field. A split must give every part
// that field (crop, tilt, rotation, scale bar), and a merge of ticked single-channel
// panels must be something a split turns back into the same row.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

/** Give panel 0 an extra channel so it is a real merge (as in channels.spec.js). */
const MAKE_MERGE = `window._makeMerge = (n) => {
  images[0].name = 'cells_DAPI.tif'; images[0].lut = 'blue';
  for (let k = 1; k <= n; k++) images[0].channels.push({
    name: 'cells_' + (k === 1 ? 'GFP' : 'RFP') + '.tif', img: images[1].img, src: images[1].src,
    lut: k === 1 ? 'green' : 'magenta', blackPt: 0, whitePt: 255 });
};`;

/** Name three seeded panels as Fiji's Split Channels would, and tick them all. */
const TICK_FIJI = `window._tickFiji = () => {
  ['C1-DAPI.tif', 'C2-GFP.tif', 'C3-mCherry.tif'].forEach((nm, i) => { images[i].name = nm; });
  renderImgList();
  document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = true; });
};`;

const TOP = `window._top = (q) => { _cmdpRender(q);
  const ul = document.getElementById('cmdp-list');
  return { top: (_cmdpFiltered[0] || {}).label || null,
           guess: /Nothing matches/.test(ul.textContent || '') }; };`;

test('split parts show the same field as the merge', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(MAKE_MERGE);
  const r = await page.evaluate(() => {
    _makeMerge(1); images.splice(1, 1);
    const m = images[0];
    // an asymmetric crop, so the framed field is 60 x 80 and, turned, landscape
    Object.assign(m, { cropT: 10, cropB: 10, cropL: 30, cropR: 10, cropAngle: 3, rotate: 90,
                       sbOn: true, umPerPx: 0.2, cbar: true, metaNote: '60x oil' });
    splitChannelRow(0); render();
    const K = ['cropT', 'cropL', 'cropB', 'cropR', 'cropAngle', 'rotate', 'sbOn', 'cbar', 'metaNote'];
    const pick = p => K.map(k => p[k]);
    const ext = images.map((p, i) => {
      const b = panelBounds.find(q => q.idx === i);
      return b ? [Math.round(b.iw != null ? b.iw : b.w), Math.round(b.ih != null ? b.ih : b.h)] : null;
    });
    return { caps: images.map(p => p.captionNote), fields: images.map(pick), ext };
  });
  expect(r.caps).toEqual(['DAPI', 'GFP', 'Merge']);
  // Without the fix the DAPI and GFP parts come back with crop 0, rotate 0, sbOn false,
  // cbar undefined and metaNote '' while the merge keeps all of it.
  expect(r.fields[0]).toEqual(r.fields[2]);
  expect(r.fields[1]).toEqual(r.fields[2]);
  expect(r.fields[2]).toEqual([10, 30, 10, 10, 3, 90, true, true, '60x oil']);
  // And they are drawn at the same extent: uncropped parts would be square beside a
  // landscape merge.
  expect(r.ext[0]).not.toBeNull();
  expect(r.ext[0]).toEqual(r.ext[2]);
  expect(r.ext[1]).toEqual(r.ext[2]);
  expect(errors).toEqual([]);
});

test('a split keeps insets linked to the merged panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(MAKE_MERGE);
  const r = await page.evaluate(() => {
    _makeMerge(1); images.splice(1, 1);
    const ins = cloneImageForUndo(images[0]);
    ins.id = Date.now() + 1; ins.channels = []; ins.captionNote = 'Inset';
    ins.insetOf = images[0].id; ins.insetRect = { x: .3, y: .3, w: .3, h: .3 };
    images.push(ins);
    splitChannelRow(0); render();
    const host = _findPanelById(ins.insetOf);
    const ids = images.filter(Boolean).map(p => p.id);
    return { host: host && host.captionNote, uniqueIds: new Set(ids).size === ids.length };
  });
  // Without the fix the merge is given a fresh id, so the inset's insetOf points at
  // nothing and _findPanelById returns null.
  expect(r.host).toBe('Merge');
  expect(r.uniqueIds).toBe(true);
  expect(errors).toEqual([]);
});

test('splitting with a blank cell in the grid does not throw', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(MAKE_MERGE);
  const r = await page.evaluate(() => {
    _makeMerge(1);
    selectedPanel = 0; insertBlankCell();            // images: [merge, null, panel1]
    let threw = null;
    try { splitChannelRow(0); } catch (e) { threw = String(e && e.message || e); }
    const labels = images.filter(Boolean).map(p => p.label);
    return { threw, labels, nulls: images.filter(p => !p).length };
  });
  // Without the fix the positional relabel sets .label on the null slot and throws
  // "Cannot set properties of null" (caught here, so it does not surface as a pageerror).
  expect(r.threw).toBeNull();
  expect(r.nulls).toBe(1);                         // the blank cell is kept
  expect(new Set(r.labels).size).toBe(r.labels.length);
  expect(r.labels).toEqual(['A', 'B', 'C', 'D']);
  expect(errors).toEqual([]);
});

test('ticked channel files combine into one merge, hidden not deleted, one undo', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(TICK_FIJI);
  const r = await page.evaluate(() => {
    const srcImgs = images.map(p => p.img);
    const steps0 = undoStack.length;
    const said = []; const realToast = window.toast; window.toast = m => said.push(String(m));
    try { mergeTickedPanels(); } finally { window.toast = realToast; }
    const m = images[3];
    const hist = _panelHistoryText();
    const out = {
      n: images.length, steps: undoStack.length - steps0,
      lut: m && m.lut, chLuts: m ? m.channels.map(c => c.lut) : null,
      sameImgs: !!m && m.img === srcImgs[0] && m.channels[0].img === srcImgs[1] && m.channels[1].img === srcImgs[2],
      excluded: images.slice(0, 3).map(p => !!p.excluded), mergeShown: !!m && !m.excluded,
      drawn: _figurePanels().length, label: m && m.label,
      labels: images.map(p => p.label),
      hiddenFlags: (hist.match(/\[hidden from the figure\]/g) || []).length,
      logged: (reproLog.filter(e => e.action === 'mergeTicked').pop() || {}).action || null,
      said,
    };
    undo();
    out.afterUndo = { n: images.length, excluded: images.map(p => !!p.excluded), labels: images.map(p => p.label) };
    return out;
  });
  // Every assertion here fails today: mergeTickedPanels does not exist, so the evaluate
  // throws a ReferenceError before any of this is returned.
  expect(r.n).toBe(4);
  expect(r.steps).toBe(1);                          // the whole merge is one undo step
  expect(r.lut).toBe('blue');                       // C1-DAPI
  expect(r.chLuts).toEqual(['green', 'magenta']);   // C2-GFP, C3-mCherry
  expect(r.sameImgs).toBe(true);
  expect(r.excluded).toEqual([true, true, true]);   // hidden, not deleted
  expect(r.mergeShown).toBe(true);
  expect(r.drawn).toBe(1);
  expect(r.label).toBe('A');                        // the merge continues the base panel
  expect(new Set(r.labels).size).toBe(4);           // no hidden source shares its letter
  expect(r.hiddenFlags).toBe(3);                    // PANEL_HISTORY flags the sources only
  expect(r.logged).toBe('mergeTicked');
  expect(r.said.join(' | ')).toMatch(/merged into A \(blue \+ green \+ magenta\).*hidden, not deleted/);
  expect(r.afterUndo).toEqual({ n: 3, excluded: [false, false, false], labels: ['A', 'B', 'C'] });
  expect(errors).toEqual([]);
});

test('mismatched frames are refused', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 50; c.height = 50;
    c.getContext('2d').fillRect(0, 0, 50, 50);
    const src = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'C2-GFP.tif'); res(); }; img.src = src; });
    renderImgList();
    document.querySelectorAll('#img-list .panel-pick').forEach(cb => { cb.checked = true; });
    const n0 = images.length, steps0 = undoStack.length;
    const said = []; const realToast = window.toast; window.toast = m => said.push(String(m));
    try { mergeTickedPanels(); } finally { window.toast = realToast; }
    return { n0, n: images.length, steps: undoStack.length - steps0, said,
             hidden: images.some(p => p.excluded) };
  });
  // Fails today: mergeTickedPanels is undefined, so the evaluate rejects.
  expect(r.n0).toBe(2);
  expect(r.n).toBe(2);
  expect(r.steps).toBe(0);
  expect(r.hidden).toBe(false);
  expect(r.said.join(' | ')).toMatch(/pixel size/);
  expect(errors).toEqual([]);
});

test('a merge made here splits back into its row', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(TICK_FIJI);
  const r = await page.evaluate(() => {
    const srcImgs = images.map(p => p.img);
    mergeTickedPanels();
    splitChannelRow(3);
    const shown = images.filter(p => p && !p.excluded);
    return {
      n: images.length, hidden: images.filter(p => p.excluded).length,
      caps: shown.map(p => p.captionNote), luts: shown.map(p => p.lut),
      imgsBack: shown[0].img === srcImgs[0] && shown[1].img === srcImgs[1] && shown[2].img === srcImgs[2],
      shownLabels: shown.map(p => p.label), allLabels: images.map(p => p.label),
      grid: [gv('cols'), gv('rows')],
    };
  });
  // Fails today: there is no mergeTickedPanels to build the merge being split.
  expect(r.n).toBe(7);                              // 3 hidden sources + 3 parts + merge
  expect(r.hidden).toBe(3);
  expect(r.caps).toEqual(['DAPI', 'GFP', 'RFP', 'Merge']);
  expect(r.luts).toEqual(['blue', 'green', 'magenta', 'blue']);
  expect(r.imgsBack).toBe(true);                    // each part is the file it came from
  // The visible row reads A–D, not D–G behind the hidden sources, and no letter repeats.
  expect(r.shownLabels).toEqual(['A', 'B', 'C', 'D']);
  expect(new Set(r.allLabels).size).toBe(7);
  expect(r.grid).toEqual(['4', '1']);               // the parts are the whole figure: one row
  expect(errors).toEqual([]);
});

test('+ Add channel opens a TIFF, and can be undone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const steps0 = await page.evaluate(() => undoStack.length);
  await page.setInputFiles('#img-list .f-add-ch', path.join(__dirname, 'fixtures', 'tiff', 'g16_raw.tif'));
  // Fails today: Chromium's <img> cannot decode a TIFF and the old path had no onerror,
  // so channels stays empty with no toast and no error, and this wait times out.
  await page.waitForFunction(() => images[0].channels.length === 1, null, { timeout: 10000 });
  const r = await page.evaluate(() => {
    const ch = images[0].channels[0];
    const out = { name: ch.name, w: ch.img.naturalWidth, png: /^data:image\/png/.test(ch.src),
                  steps: undoStack.length, accept: document.querySelector('#img-list .f-add-ch').accept };
    undo();
    out.afterUndo = images[0].channels.length;
    return out;
  });
  expect(r.name).toBe('g16_raw.tif');
  expect(r.w).toBeGreaterThan(0);
  expect(r.png).toBe(true);
  expect(r.steps - steps0).toBe(1);                 // adding a channel is one undo step
  expect(r.afterUndo).toBe(0);
  expect(r.accept).toMatch(/\.tif/);
  expect(errors).toEqual([]);
});

test('the palette finds Merge channels from ticked panels without taking "split channels"', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  await page.evaluate(TOP);
  const r = await page.evaluate(() => ({
    combine: _top('combine ticked channels'), fiji: _top('c1 c2 fiji'),
    merge: _top('merge'), split: _top('split channels'),
    btnTip: (document.querySelector('button[onclick="mergeTickedPanels()"]') || {}).title || null,
  }));
  // Fails today: no registry entry or button runs mergeTickedPanels.
  expect(r.combine.top).toMatch(/ticked panels/);
  expect(r.fiji.top).toMatch(/ticked panels/);
  expect(r.merge.top).toMatch(/Merge channels/);    // palette.spec's pin still holds
  expect(r.split.top).toMatch(/Split a merge/);
  expect(r.btnTip).toMatch(/hidden, not deleted/);
  expect(errors).toEqual([]);
});
