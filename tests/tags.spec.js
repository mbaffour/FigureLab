// @ts-check
// Panel tags — a condition, a time point, or the channel names in their colours — and
// intensity bars. What QuickFigures and OMERO.figure generate from metadata; here from
// the panel's LUT, its extra channels, and its filename.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

const tagItems = () => figTextItems.filter(t => t.kind === 'tag').map(t => ({ str: t.str, fill: t.fill, bbox: t.bbox }));

test('with channel names on, an empty tag names each channel in its LUT colour, in the chosen corner', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const tagItems = () => figTextItems.filter(t => t.kind === 'tag').map(t => ({ str: t.str, fill: t.fill, bbox: t.bbox }));
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    images[0].name = 'cells_GFP.tif'; images[0].lut = 'green';
    images[0].channels.push({ name: 'cells_DAPI.tif', img: images[1].img, src: images[1].src, lut: 'blue', blackPt: 0, whitePt: 255 });
    images[1].name = 'cells_BF.tif';                     // brightfield, no LUT
    render();
    const off = tagItems();
    document.getElementById('tag-channels').checked = true; render();
    const on = tagItems();
    const pb = panelBounds.find(b => b.idx === 0);
    sv('tag-pos', 'bl'); render();
    const bl = tagItems().filter(t => true);
    images[0].tag = '+ATc'; render();
    const custom = tagItems();
    document.getElementById('show-tags').checked = false; render();
    const hidden = tagItems();
    return { off, on, pb, bl, custom, hidden, lblClr: gv('label-color') };
  });
  expect(r.off).toEqual([]);
  expect(r.on.map(t => t.str)).toEqual(['GFP', 'DAPI', 'BF']);
  expect(r.on[0].fill).toBe('#4ee04e'); expect(r.on[1].fill).toBe('#6a9cff');   // each in its LUT colour
  expect(r.on[2].fill).toBe(r.lblClr);                                            // brightfield: plain
  // Top-right of panel 0: both parts inside the cell, DAPI to the right of GFP.
  for (const t of r.on.slice(0, 2)) { expect(t.bbox.x).toBeGreaterThanOrEqual(r.pb.x); expect(t.bbox.x + t.bbox.w).toBeLessThanOrEqual(r.pb.x + r.pb.w + 0.01); }
  expect(r.on[1].bbox.x).toBeGreaterThan(r.on[0].bbox.x + r.on[0].bbox.w);
  expect(r.on[0].bbox.y).toBeLessThan(r.pb.y + r.pb.h / 2);
  expect(r.bl[0].bbox.y).toBeGreaterThan(r.pb.y + r.pb.h / 2);                    // moved to the bottom
  expect(r.custom.map(t => t.str)).toEqual(['+ATc', 'BF']);                        // a typed tag wins
  expect(r.custom[0].fill).toBe(r.lblClr);
  expect(r.hidden).toEqual([]);
  expect(errors).toEqual([]);
});

test('series tags write a numbered sequence into the visible panels in grid order, as one undo step', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange();
    images[2].excluded = true;                           // hidden: not tagged, and the series skips it
    sv('tag-series-start', '0'); sv('tag-series-step', '5'); sv('tag-series-unit', 'min'); sv('tag-series-fmt', 't = {v} {u}');
    applySeriesTags();
    const tags = images.map(im => im.tag || '');
    render();
    const drawn = figTextItems.filter(t => t.kind === 'tag').map(t => t.str);
    sv('tag-series-start', '2.5'); sv('tag-series-step', '0.5'); sv('tag-series-unit', ''); sv('tag-series-fmt', '{n}: {v}{u}');
    applySeriesTags();
    const second = images.map(im => im.tag || '');
    undo();
    const undone = images.map(im => im.tag || '');
    return { tags, drawn, second, undone, logged: reproLog.filter(e => e.action === 'seriesTags').length };
  });
  expect(r.tags).toEqual(['t = 0 min', 't = 5 min', '', 't = 10 min']);
  expect(r.drawn).toEqual(['t = 0 min', 't = 5 min', 't = 10 min']);
  expect(r.second).toEqual(['1: 2.5', '2: 3', '', '3: 3.5']);                     // no trailing space when the unit is blank
  expect(r.undone).toEqual(r.tags);
  expect(r.logged).toBe(2);
  expect(errors).toEqual([]);
});

test('an intensity bar labels the display range in native units when raw samples are kept, and skips RGB photos', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    const bars = idx => figTextItems.filter(t => t.kind === 'cbar' && t.idx === idx).map(t => t.str);
    sv('cols', '3'); sv('rows', '1'); onLayoutChange();
    images[0].lut = 'fire'; images[0].blackPt = 20; images[0].whitePt = 200; images[0].cbar = true;
    images[1].grayscale = true; images[1].cbar = true;
    images[1].raw = { data: new Uint16Array(4), w: 2, h: 2, min: 100, max: 4000 };
    images[2].cbar = true;                                // an RGB photo: no LUT, not grayscale
    render();
    return { fire: bars(0), raw: bars(1), rgb: bars(2), pb: panelBounds.find(b => b.idx === 0),
             items: figTextItems.filter(t => t.kind === 'cbar' && t.idx === 0).map(t => t.bbox) };
  });
  expect(r.fire).toEqual(['200', '20']);                  // display units: high at the top, low at the bottom
  expect(r.raw).toEqual(['4000', '100']);                 // full range in native units
  expect(r.rgb).toEqual([]);
  for (const b of r.items) { expect(b.x).toBeGreaterThanOrEqual(r.pb.x); expect(b.x + b.w).toBeLessThanOrEqual(r.pb.x + r.pb.w + 0.01); }
  expect(errors).toEqual([]);
});

test('tags and intensity bars survive a session round-trip', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    images[0].tag = '10 min'; images[1].cbar = true; images[1].lut = 'green';
    const s = JSON.parse(JSON.stringify(serializeSession(true)));      // bundled, as a saved file
    const saved = s.images.map(d => [d.tag, d.cbar]);
    images[0].tag = ''; images[1].cbar = false;
    applySession(s);
    await new Promise(r => setTimeout(r, 150));                        // images decode async
    return { saved, restored: images.map(im => [im.tag || '', !!im.cbar]) };
  });
  expect(r.saved).toEqual([['10 min', false], ['', true]]);
  expect(r.restored).toEqual([['10 min', false], ['', true]]);
  expect(errors).toEqual([]);
});

// ── Auto contrast, uniform scale bars ─────────────────────────

async function seedPainted(page, w, h, paintBody, name = 'painted.png') {
  await page.evaluate(async ({ w, h, paintBody, name }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    new Function('ctx', 'W', 'H', paintBody)(c.getContext('2d'), w, h);
    const src = c.toDataURL('image/png');
    await new Promise((res, rej) => { const img = new Image(); img.onload = () => { _commitImage(img, src, name); res(); }; img.onerror = rej; img.src = src; });
    render();
  }, { w, h, paintBody, name });
  await page.waitForFunction(() => images.every(im => !im || (im.img && im.img.naturalWidth > 0)));
}

test('auto contrast picks black ink on a bright panel and white on a dark one, for the letter, a typed tag and the scale bar', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 300, 300, `ctx.fillStyle='#f4f4f4'; ctx.fillRect(0,0,W,H);`, 'bright.png');   // a histology section
  await seedPainted(page, 300, 300, `ctx.fillStyle='#101010'; ctx.fillRect(0,0,W,H);`, 'dark.png');     // a micrograph
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    document.getElementById('label-bg').checked = false;
    images.forEach(im => { im.umPerPx = 0.5; im.sbUm = 20; im.sbOn = true; im.tag = 'WT'; });
    render();
    const fills = kind => figTextItems.filter(t => t.kind === kind).map(t => t.fill);
    const before = { panel: fills('panel'), sb: fills('sb'), tag: fills('tag') };
    document.getElementById('label-auto-color').checked = true;
    document.getElementById('sb-auto-color').checked = true;
    render();
    const after = { panel: fills('panel'), sb: fills('sb'), tag: fills('tag') };
    document.getElementById('label-bg').checked = true; render();
    const withChip = fills('panel');
    return { before, after, withChip, lbl: gv('label-color'), sbc: gv('sb-color') };
  });
  expect(r.before.panel).toEqual([r.lbl, r.lbl]);
  expect(r.before.sb).toEqual([r.sbc, r.sbc]);
  expect(r.after.panel).toEqual(['#111111', '#ffffff']);         // black on bright, white on dark
  expect(r.after.tag).toEqual(['#111111', '#ffffff']);
  expect(r.after.sb).toEqual(['#111111', '#ffffff']);
  expect(r.withChip).toEqual([r.lbl, r.lbl]);                     // a chip already guarantees contrast
  expect(errors).toEqual([]);
});

test('Same bar on all calibrated: the selected panel’s bar, or a clean value from the median field of view', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    images[0].umPerPx = 0.5; images[0].sbUm = 10; images[0].sbOn = true;
    images[1].umPerPx = 0.5; images[1].sbUm = 25; images[1].sbOn = false;
    images[2].umPerPx = 0.25; images[2].sbUm = 5; images[2].sbOn = true;
    images[3].umPerPx = 0;                                      // uncalibrated: left alone
    selectedPanel = 1;
    uniformScaleBars();
    const fromSel = images.map((im, i) => i < 3 ? [im.sbUm, im.sbOn] : [im.sbUm]);   // the uncalibrated one: only its length matters
    selectedPanel = -1; images[0].sbUm = 1; images[1].sbUm = 2; images[2].sbUm = 3;
    uniformScaleBars();
    const fromMedian = images.map(im => im.sbUm);
    undo();
    return { fromSel, fromMedian, undone: images.map(im => im.sbUm), logged: reproLog.filter(e => e.action === 'uniformScaleBars').length };
  });
  expect(r.fromSel).toEqual([[25, true], [25, true], [25, true], [10]]);       // the uncalibrated panel is left alone
  // Fields of view: 0.5×100 = 50 µm, 50 µm, 0.25×100 = 25 µm → median 50 → 0.18 × 50 = 9 → nice 10.
  expect(r.fromMedian.slice(0, 3)).toEqual([10, 10, 10]);
  expect(r.undone.slice(0, 3)).toEqual([1, 2, 3]);
  expect(r.logged).toBe(2);
  expect(errors).toEqual([]);
});

test('splitting a multi-channel panel into a row switches channel names on', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    images[0].name = 'x_GFP.tif'; images[0].lut = 'green';
    images[0].channels.push({ name: 'x_DAPI.tif', img: images[1].img, src: images[1].src, lut: 'blue', blackPt: 0, whitePt: 255 });
    splitChannelRow(0);
    render();
    return { on: document.getElementById('tag-channels').checked, tags: figTextItems.filter(t => t.kind === 'tag').map(t => t.str) };
  });
  expect(r.on).toBe(true);
  expect(r.tags.slice(0, 4)).toEqual(['GFP', 'DAPI', 'GFP', 'DAPI']);   // GFP panel, DAPI panel, then the merge naming both
  expect(errors).toEqual([]);
});
