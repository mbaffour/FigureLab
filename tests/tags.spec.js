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

// ── Clipped-pixel preview ─────────────────────────────────────

test('the clipped-pixel preview marks saturated pixels red and zero pixels blue on the overlay only, and leaves exports alone', async ({ page }) => {
  const errors = await loadApp(page);
  // Left half saturated white, right half true black, a mid-grey band between.
  await seedPainted(page, 300, 300, `
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 120, H);
    ctx.fillStyle = '#808080'; ctx.fillRect(120, 0, 60, H);
    ctx.fillStyle = '#000000'; ctx.fillRect(180, 0, 120, H);
  `);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '300'); sv('bg-color', '#ffffff');
    document.getElementById('show-labels').checked = false; images[0].sbOn = false;
    onLayoutChange(); render();
    const pb = panelBounds[0];
    const octx = document.getElementById('ann-canvas').getContext('2d');
    const at = (fx, fy) => [...octx.getImageData(Math.round(pb.ix + fx * pb.iw), Math.round(pb.iy + fy * pb.ih), 1, 1).data];
    const before = at(0.2, 0.5);
    setClipPreview(true);
    const white = at(0.2, 0.5), grey = at(0.5, 0.5), black = at(0.8, 0.5);
    const m = _clipMask();
    const c = renderExportCanvas(150); const k = c.width / canvasLogicalW;
    const ex = [...c.getContext('2d').getImageData(Math.round((pb.ix + 0.2 * pb.iw) * k), Math.round((pb.iy + 0.5 * pb.ih) * k), 1, 1).data].slice(0, 3);
    setClipPreview(false);
    const after = at(0.2, 0.5);
    return { before, white, grey, black, hi: m.hi, lo: m.lo, total: m.total, ex, after, checked: document.getElementById('clip-preview').checked };
  });
  expect(r.before[3]).toBe(0);                                   // nothing on the overlay at rest
  expect(r.white.slice(0, 3)).toEqual([255, 40, 40]);            // saturated → red
  expect(r.black.slice(0, 3)).toEqual([40, 120, 255]);           // zero → blue
  expect(r.grey[3]).toBe(0);                                     // mid-grey: unmarked
  expect(r.hi / r.total).toBeCloseTo(0.4, 1); expect(r.lo / r.total).toBeCloseTo(0.4, 1);
  expect(r.ex).toEqual([255, 255, 255]);                         // the export is the picture, not the preview
  expect(r.after[3]).toBe(0);
  expect(r.checked).toBe(false);
  expect(errors).toEqual([]);
});

test('a typed tag becomes the caption description when there is no caption note', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    images[0].tag = '0 min'; images[1].tag = '10 min'; images[1].captionNote = 'Treated cells'; images[2].tag = '';
    generateCaption();
    return document.getElementById('caption-out').value;
  });
  expect(r).toContain('(A) 0 min.');
  expect(r).toContain('(B) Treated cells.');            // a note still wins over the tag
  expect(r).toContain('(C) Panel C.');
  expect(errors).toEqual([]);
});

// ── Spotlight annotation ──────────────────────────────────────

test('a spotlight dims everything but its region — across the figure, or within its panel — and exports as an even-odd path', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 200, 200, `ctx.fillStyle='#c8c8c8'; ctx.fillRect(0,0,W,H);`, 'a.png');
  await seedPainted(page, 200, 200, `ctx.fillStyle='#c8c8c8'; ctx.fillRect(0,0,W,H);`, 'b.png');
  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '1'); sv('panel-w', '200'); sv('panel-h', '200'); sv('bg-color', '#ffffff');
    document.getElementById('show-labels').checked = false; images.forEach(im => im.sbOn = false);
    onLayoutChange(); render();
    const fc = document.getElementById('fig-canvas'), fx = fc.getContext('2d');
    const W = canvasLogicalW, H = canvasLogicalH;
    const A = panelBounds.find(b => b.idx === 0), B = panelBounds.find(b => b.idx === 1);
    const at = (x, y) => [...fx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    // 1. A panel-bound spotlight on A: the middle half of A is lit, the rest of A dimmed, B untouched.
    images[0].panelAnns = [{ type: 'spotlight', xf: 0.25, yf: 0.25, x2f: 0.75, y2f: 0.75, color: '#ffffff', width: 1, fill: true, fillColor: '#000000', fillOpacity: 0.6 }];
    render();
    const panel = { inside: at(A.ix + A.iw * 0.5, A.iy + A.ih * 0.5), edgeA: at(A.ix + A.iw * 0.1, A.iy + A.ih * 0.1), inB: at(B.ix + B.iw * 0.5, B.iy + B.ih * 0.5), gutter: at((A.x + A.w + B.x) / 2, A.y + A.h / 2) };
    // 2. A figure-wide spotlight: dims B and the gutter too.
    images[0].panelAnns = [];
    annotations.push({ type: 'spotlight', xf: (A.ix + A.iw * 0.25) / W, yf: (A.iy + A.ih * 0.25) / H, x2f: (A.ix + A.iw * 0.75) / W, y2f: (A.iy + A.ih * 0.75) / H, color: '#ffffff', width: 1, fill: true, fillColor: '#000000', fillOpacity: 0.6 });
    render();
    const global = { inside: at(A.ix + A.iw * 0.5, A.iy + A.ih * 0.5), inB: at(B.ix + B.iw * 0.5, B.iy + B.ih * 0.5), gutter: at((A.x + A.w + B.x) / 2, A.y + A.h / 2) };
    const hit = hitAnnotation(annotations[0], A.ix + A.iw * 0.5, A.iy + A.ih * 0.5, W, H);
    const miss = hitAnnotation(annotations[0], B.ix + B.iw * 0.5, B.iy + B.ih * 0.5, W, H);
    const svg = await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')));
    const txt = new TextDecoder().decode(svg.data);
    return { panel, global, hit, miss, evenodd: /fill-rule="evenodd"/.test(txt), veil: /fill="#000000" fill-opacity="0.6"/.test(txt) };
  });
  const dim = c => c[0] < 100;                                   // #c8c8c8 (200) under a 60 % black veil ≈ 80
  expect(dim(r.panel.inside)).toBe(false);  expect(r.panel.inside).toEqual([200, 200, 200]);
  expect(dim(r.panel.edgeA)).toBe(true);
  expect(r.panel.inB).toEqual([200, 200, 200]);                  // confined to its panel
  expect(r.panel.gutter).toEqual([255, 255, 255]);
  expect(r.global.inside).toEqual([200, 200, 200]);
  expect(dim(r.global.inB)).toBe(true);                          // the whole figure this time
  expect(r.global.gutter).not.toEqual([255, 255, 255]);
  expect(r.hit).toBe(true); expect(r.miss).toBe(false);
  expect(r.evenodd).toBe(true); expect(r.veil).toBe(true);
  expect(errors).toEqual([]);
});

// ── Orientation axes, and counters in the SVG ─────────────────

test('an axes marker draws crossed arrows with four editable letters, hit-tests at its centre, and exports as vector with counters', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPainted(page, 300, 300, `ctx.fillStyle='#303030'; ctx.fillRect(0,0,W,H);`);
  const r = await page.evaluate(async () => {
    sv('cols', '1'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '300'); onLayoutChange(); render();
    const W = canvasLogicalW, H = canvasLogicalH, pb = panelBounds[0];
    const cx = pb.ix + pb.iw * 0.5, cy = pb.iy + pb.ih * 0.5;
    annotations.push({ type: 'axes', xf: cx / W, yf: cy / H, text: 'D V A P', color: '#ffffff', width: 2, fontSize: 12 });
    annotations.push({ type: 'counter', xf: 0.2, yf: 0.2, n: 3, color: '#ff4444', width: 2 });
    render();
    const fx = document.getElementById('fig-canvas').getContext('2d');
    const onArm = [...fx.getImageData(Math.round(cx), Math.round(cy - 12), 1, 1).data].slice(0, 3);   // on the vertical arm
    const off = [...fx.getImageData(Math.round(cx + 12), Math.round(cy - 12), 1, 1).data].slice(0, 3);  // between the arms
    const hit = hitAnnotation(annotations[0], cx + 5, cy - 5, W, H), miss = hitAnnotation(annotations[0], cx + 80, cy, W, H);
    const svg1 = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')))).data);
    annotations[0].text = 'R C M L';
    const svg2 = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')))).data);
    const letters = t => [...t.matchAll(/paint-order="stroke">([A-Z])<\/text>/g)].map(m => m[1]);
    return { onArm, off, hit, miss, l1: letters(svg1), l2: letters(svg2), counter: /<circle [^>]*fill="#ff4444"/.test(svg1) && />3<\/text>/.test(svg1) };
  });
  expect(r.onArm).toEqual([255, 255, 255]);
  expect(r.off).toEqual([48, 48, 48]);
  expect(r.hit).toBe(true); expect(r.miss).toBe(false);
  expect(r.l1).toEqual(['D', 'V', 'A', 'P']);
  expect(r.l2).toEqual(['R', 'C', 'M', 'L']);              // the letters follow the text field
  expect(r.counter).toBe(true);                             // counters used to be missing from the SVG
  expect(errors).toEqual([]);
});

// ── Sync display range by channel ─────────────────────────────

test('sync levels by channel copies the reference panel’s ranges to every panel and extra channel showing the same channel, and nothing else', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    const [A, B, C, D] = images;
    A.name = 'a_GFP.tif'; A.lut = 'green'; A.blackPt = 10; A.whitePt = 200; A.gamma = 0.8;
    A.channels.push({ name: 'a_DAPI.tif', img: B.img, src: B.src, lut: 'blue', blackPt: 5, whitePt: 150 });
    B.name = 'b_GFP.tif'; B.lut = 'green'; B.blackPt = 0; B.whitePt = 255; B.gamma = 1;
    B.channels.push({ name: 'b_DAPI.tif', img: A.img, src: A.src, lut: 'blue', blackPt: 0, whitePt: 255 });
    C.name = 'c_DAPI.tif'; C.lut = 'blue'; C.blackPt = 0; C.whitePt = 255;        // DAPI as a base panel
    D.name = 'd_RFP.tif'; D.lut = 'magenta'; D.blackPt = 3; D.whitePt = 250;      // a different channel
    syncLevelsByChannel(0);
    const after = {
      B: [B.blackPt, B.whitePt, B.gamma, B.channels[0].blackPt, B.channels[0].whitePt, B.lut],
      C: [C.blackPt, C.whitePt, C.lut],
      D: [D.blackPt, D.whitePt, D.lut],
    };
    undo();
    return { after, undone: [images[1].blackPt, images[1].channels[0].whitePt, images[2].whitePt], logged: reproLog.filter(e => e.action === 'syncLevelsByChannel').length };
  });
  expect(r.after.B).toEqual([10, 200, 0.8, 5, 150, 'green']);   // GFP base and DAPI channel both synced; LUT untouched
  expect(r.after.C).toEqual([5, 150, 'blue']);                  // a DAPI base panel takes the DAPI channel's range
  expect(r.after.D).toEqual([3, 250, 'magenta']);               // RFP: not in the reference, left alone
  expect(r.undone).toEqual([0, 255, 255]);
  expect(r.logged).toBe(1);
  expect(errors).toEqual([]);
});

// ── Channel key ───────────────────────────────────────────────

test('a channel key lists every channel the visible panels show, once, with its swatch, follows the panels, and exports as vector', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    const [A, B, C, D] = images;
    A.name = 'a_DAPI.tif'; A.lut = 'blue';
    B.name = 'b_GFP.tif'; B.lut = 'green';
    C.name = 'c_merge.tif'; C.lut = 'blue'; C.channels.push({ name: 'c_GFP.tif', img: B.img, src: B.src, lut: 'green', blackPt: 0, whitePt: 255 });
    D.name = 'd_BF.tif';
    sv('cols', '4'); sv('rows', '1'); onLayoutChange(); render();
    const rows1 = _figureChannels();
    annotations.push({ type: 'legend', xf: 0.02, yf: 0.02, color: '#ffffff', width: 1, fontSize: 12, fill: true, fillColor: '#000000', fillOpacity: 0.6 });
    render();
    const a = annotations[0];
    const hit = hitAnnotation(a, 0.02 * canvasLogicalW + 10, 0.02 * canvasLogicalH + 10, canvasLogicalW, canvasLogicalH);
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 300, document.getElementById('fig-canvas')))).data);
    D.excluded = true; render();                              // hide the brightfield panel → the key drops BF
    const rows2 = _figureChannels();
    return { rows1, hit, size: [a._w > 40, a._h > 20], svgNames: [...svg.matchAll(/dominant-baseline="central">([A-Za-z]+)<\/text>/g)].map(m => m[1]), swatches: (svg.match(/<rect [^>]*fill="#4ee04e"/g) || []).length, rows2 };
  });
  expect(r.rows1).toEqual([{ name: 'DAPI', color: '#6a9cff' }, { name: 'GFP', color: '#4ee04e' }, { name: 'BF', color: null }]);
  expect(r.hit).toBe(true);
  expect(r.size).toEqual([true, true]);
  expect(r.svgNames).toEqual(['DAPI', 'GFP', 'BF']);
  expect(r.swatches).toBe(1);
  expect(r.rows2.map(x => x.name)).toEqual(['DAPI', 'GFP']);
  expect(errors).toEqual([]);
});

// ── Channel levels, and the display-range compliance row ──────

test('each extra channel gets black/white sliders that change its range and redraw the composite', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(() => {
    const [A, B] = images;
    A.lut = 'green';
    A.channels.push({ name: 'a_DAPI.tif', img: B.img, src: B.src, lut: 'blue', blackPt: 0, whitePt: 255 });
    renderImgList();
    const item = document.querySelectorAll('#img-list .img-item')[0];
    const lv = item.querySelectorAll('.ch-levels');
    const bpt = lv[0].querySelector('.ch-bpt'), wpt = lv[0].querySelector('.ch-wpt');
    bpt.value = '40'; bpt.dispatchEvent(new Event('input', { bubbles: true }));
    wpt.value = '30'; wpt.dispatchEvent(new Event('input', { bubbles: true }));   // below the black point → clamped above it
    return { rows: lv.length, bp: A.channels[0].blackPt, wp: A.channels[0].whitePt, shown: lv[0].querySelector('.ch-wpt-v').textContent };
  });
  expect(r.rows).toBe(1);
  expect(r.bp).toBe(40);
  expect(r.wp).toBe(41);                                       // white point cannot cross the black point
  expect(r.shown).toBe('41');
  expect(errors).toEqual([]);
});

test('the compliance check warns when panels show the same channel at different ranges, and its fix syncs them', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(() => {
    const [A, B, C] = images;
    A.name = 'a_GFP.tif'; A.lut = 'green'; A.blackPt = 10; A.whitePt = 200;
    B.name = 'b_GFP.tif'; B.lut = 'green'; B.blackPt = 0; B.whitePt = 255;
    C.name = 'c_DAPI.tif'; C.lut = 'blue'; C.blackPt = 0; C.whitePt = 255;
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); render();
    const rowText = () => { checkCompliance(); const rows = [...document.querySelectorAll('.compliance-row')].map(e => e.textContent.replace(/\s+/g, ' ').trim()); return rows.find(t => /Display ranges by channel/.test(t)) || ''; };
    const before = rowText();
    selectedPanel = 0;
    _auditFix('synclevels');
    const after = rowText();
    return { before, after, B: [B.blackPt, B.whitePt], C: [C.blackPt, C.whitePt] };
  });
  expect(r.before).toMatch(/⚠/);
  expect(r.before).toMatch(/GFP: A 10–200, B 0–255/);
  expect(r.before).toMatch(/Sync by channel/);
  expect(r.B).toEqual([10, 200]);
  expect(r.C).toEqual([0, 255]);                               // DAPI was consistent and is untouched
  expect(r.after).toMatch(/✓/);
  expect(r.after).toMatch(/Same range per channel/);
  expect(errors).toEqual([]);
});

// ── Dragging a tag, and the letter it must not sit on ─────────

test('a tag can be dragged, the drag survives a session round-trip, and a double-click resets it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    images[0].tag = 'WT';
    render();
    const tagOf = () => figTextItems.find(t => t.kind === 'tag');
    const t0 = tagOf();
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const lw = canvasLogicalW, lh = canvasLogicalH;
    const fire = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0,
      clientX: rect.left + x * rect.width / lw, clientY: rect.top + y * rect.height / lh }));
    const gx = t0.bbox.x + t0.bbox.w / 2, gy = t0.bbox.y + t0.bbox.h / 2;
    fire('mousedown', gx, gy);
    fire('mousemove', gx - 30, gy + 20);
    fire('mouseup', gx - 30, gy + 20);
    render();
    const moved = { off: [images[0].tagDX, images[0].tagDY], x: tagOf().x, y: tagOf().y };
    const s = JSON.parse(JSON.stringify(serializeSession(true)));
    const saved = [s.images[0].tagDX, s.images[0].tagDY];
    c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true,
      clientX: rect.left + tagOf().bbox.x * rect.width / lw + 4, clientY: rect.top + (tagOf().bbox.y + 4) * rect.height / lh }));
    render();
    return { before: { x: t0.x, y: t0.y }, moved, saved, reset: [images[0].tagDX, images[0].tagDY], resetX: tagOf().x };
  });
  expect(r.moved.off).toEqual([-30, 20]);                       // the drag used to do nothing at all
  expect(r.moved.x).toBeCloseTo(r.before.x - 30, 3);
  expect(r.moved.y).toBeCloseTo(r.before.y + 20, 3);
  expect(r.saved).toEqual([-30, 20]);
  expect(r.reset).toEqual([0, 0]);                              // double-click resets it, like any label
  expect(r.resetX).toBeCloseTo(r.before.x, 3);
  expect(errors).toEqual([]);
});

test('a tag sent to the same corner as the panel letter steps below it instead of over it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '300');
    sv('label-size', '18'); sv('label-pos', 'tl'); sv('tag-pos', 'tr');
    document.getElementById('show-labels').checked = true;
    images[0].tag = 'WT'; onLayoutChange(); render();
    const box = k => figTextItems.find(t => t.kind === k).bbox;
    const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    const apart = { letter: box('panel'), tag: box('tag') };
    sv('tag-pos', 'tl'); render();                              // both in the same corner
    const same = { letter: box('panel'), tag: box('tag') };
    sv('label-pos', 'bl'); render();                            // letter moved away again
    const moved = { letter: box('panel'), tag: box('tag') };
    document.getElementById('show-labels').checked = false; sv('label-pos', 'tl'); render();
    const noLetter = box('tag');
    return { apartOverlap: overlap(apart.letter, apart.tag), sameOverlap: overlap(same.letter, same.tag),
             stepped: same.tag.y > same.letter.y, movedOverlap: overlap(moved.letter, moved.tag),
             backUp: moved.tag.y, noLetterY: noLetter.y };
  });
  expect(r.apartOverlap).toBe(false);
  expect(r.sameOverlap).toBe(false);                            // the tag used to be drawn straight over the letter
  expect(r.stepped).toBe(true);                                 // …and it steps DOWN, where a reader looks
  expect(r.movedOverlap).toBe(false);
  expect(r.backUp).toBeCloseTo(r.noLetterY, 3);                 // no clash, no step
  expect(errors).toEqual([]);
});

test('a group band label can be dragged too, and the offset round-trips through a session', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange();
    setFigGroups([{ axis: 'row', from: 1, to: 2, label: 'Untreated' }], false);
    render();
    const g = () => figTextItems.find(t => t.kind === 'group');
    const g0 = g();
    const c = document.getElementById('ann-canvas'), rect = c.getBoundingClientRect();
    const fire = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0,
      clientX: rect.left + x * rect.width / canvasLogicalW, clientY: rect.top + y * rect.height / canvasLogicalH }));
    const gx = g0.bbox.x + g0.bbox.w / 2, gy = g0.bbox.y + g0.bbox.h / 2;
    fire('mousedown', gx, gy); fire('mousemove', gx + 12, gy - 18); fire('mouseup', gx + 12, gy - 18);
    render();
    const off = labelOffsets.group[0];
    const moved = [g().x - g0.x, g().y - g0.y];
    const s = JSON.parse(JSON.stringify(serializeSession(true)));   // bundled: the panels come back too
    labelOffsets.group = {};
    applySession(s);
    return { found: !!g0, off: off && [off.dx, off.dy], moved, restored: labelOffsets.group[0] };
  });
  expect(r.found).toBe(true);
  expect(r.off).toEqual([12, -18]);                             // the third dead drag, now live
  expect(r.moved[0]).toBeCloseTo(12, 3);
  expect(r.moved[1]).toBeCloseTo(-18, 3);
  expect(r.restored).toEqual({ dx: 12, dy: -18 });
  expect(errors).toEqual([]);
});
