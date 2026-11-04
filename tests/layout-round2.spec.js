// @ts-check
// Grid layout and import robustness, second round of the adversarial review.
//
// Each test names the defect it pins down and why it failed before the fix:
//  - a blank cell made Sort by name, Parse names, Auto-channels and Panel comparison throw;
//  - a column span was laid over a row span already holding the cell;
//  - an inset frame on a flipped or turned parent was missing from the SVG and its
//    letter was drawn mirrored or sideways in every raster;
//  - images past cols x rows were listed but silently left out of the figure;
//  - a TIFF stack past 60 pages was cut to 60 without a word;
//  - past Z a delete-then-add handed out a label already in use, and compliance
//    counted the duplicate as labelled;
//  - a drop of images with a CSV split the images between the grid and the canvas.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

// Commit named solid-colour panels through the real import path.
async function seedNamed(page, specs) {
  await page.evaluate(async (specs) => {
    for (const s of specs) {
      const c = document.createElement('canvas'); c.width = s.w || 100; c.height = s.h || 100;
      const x = c.getContext('2d'); x.fillStyle = s.fill || '#888'; x.fillRect(0, 0, c.width, c.height);
      const src = c.toDataURL('image/png');
      await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, s.name); res(); }; img.src = src; });
    }
    render();
  }, specs);
}

// A minimal uncompressed 8-bit greyscale TIFF with `pages` 4 x 4 pages.
function tiffStack(pages) {
  const W = 4, H = 4, ENTRIES = 9, ifdSize = 2 + ENTRIES * 12 + 4;
  const pageBytes = W * H, per = ifdSize + pageBytes;
  const buf = Buffer.alloc(8 + pages * per);
  buf.write('II', 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  for (let p = 0; p < pages; p++) {
    const ifd = 8 + p * per, data = ifd + ifdSize;
    buf.writeUInt16LE(ENTRIES, ifd);
    const tags = [[256, 3, W], [257, 3, H], [258, 3, 8], [259, 3, 1], [262, 3, 1],
                  [273, 4, data], [277, 3, 1], [278, 3, H], [279, 4, pageBytes]];
    tags.forEach(([tag, type, v], k) => {
      const o = ifd + 2 + k * 12;
      buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(1, o + 4);
      if (type === 3) buf.writeUInt16LE(v, o + 8); else buf.writeUInt32LE(v, o + 8);
    });
    buf.writeUInt32LE(p === pages - 1 ? 0 : ifd + per, ifd + 2 + ENTRIES * 12);
    buf.fill((p * 3) & 0xff, data, data + pageBytes);
  }
  return buf.toString('base64');
}

test('F05 a blank cell no longer breaks Sort, Parse names, Auto-channels or Panel comparison', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNamed(page, [{ name: 'z_DAPI.png', fill: '#22f' }, { name: 'a_GFP.png', fill: '#2f2' }, { name: 'm_RFP.png', fill: '#f2f' }]);
  const r = await page.evaluate(() => {
    const snap = () => images.map(i => i ? `${i.name}/${i.label}/${i.lut}` : '-');
    selectedPanel = 0; insertBlankCell(); render();
    const u0 = undoStack.length;
    sortImagesByName();
    const sorted = snap(), uSort = undoStack.length - u0;
    undo();
    const undone = snap();
    redo();
    autoDetectChannels();
    const chans = snap();
    parseFilenames();
    const notes = images.map(i => i ? i.captionNote : '-');
    openPanelComparison();
    const opts = [...document.querySelectorAll('#cmp-left option')].map(o => o.value);
    const right = document.getElementById('cmp-right').value;
    document.getElementById('compare-modal').remove();
    return { sorted, uSort, undone, chans, notes, opts, right };
  });
  // The blank keeps its slot (2); the three panels sort into the others and are relettered.
  expect(r.sorted).toEqual(['a_GFP.png/A/none', '-', 'm_RFP.png/B/none', 'z_DAPI.png/C/none']);
  expect(r.uSort).toBe(1);
  expect(r.undone).toEqual(['z_DAPI.png/A/none', '-', 'a_GFP.png/B/none', 'm_RFP.png/C/none']);
  // Every panel gets its channel, not only the ones before the blank.
  expect(r.chans).toEqual(['a_GFP.png/A/green', '-', 'm_RFP.png/B/magenta', 'z_DAPI.png/C/blue']);
  expect(r.notes).toEqual(['a GFP', '-', 'm RFP', 'z DAPI']);
  // The comparison offers the three panels by their true index and never the blank.
  expect(r.opts).toEqual(['0', '2', '3']);
  expect(r.right).toBe('2');
  expect(errors).toEqual([]);
});

// Every panel's cell in the preview, the export and the walker that feeds the caption.
async function geometry(page) {
  return page.evaluate(() => {
    render();
    const prev = panelBounds.filter(b => b.idx >= 0).map(b => ({ idx: b.idx, x: b.x, y: b.y, w: b.w, h: b.h }));
    renderExportCanvas(150);
    const exp = [..._lastCells].map(([idx, c]) => ({ idx, x: c.x, y: c.y, w: c.w, h: c.h }));
    render();
    const overlaps = [];
    for (let i = 0; i < prev.length; i++) for (let j = i + 1; j < prev.length; j++) {
      const a = prev[i], b = prev[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([a.idx, b.idx]);
    }
    const listed = _figurePanels().map(im => images.indexOf(im)).sort((a, b) => a - b);
    return { prev: prev.sort((a, b) => a.idx - b.idx), exp: exp.sort((a, b) => a.idx - b.idx), overlaps, listed };
  });
}

test('F17 a column span never claims a cell a row span already holds, in preview, export and caption', async ({ page }) => {
  const errors = await loadApp(page);
  // B is twice as tall as wide, so across its two rows it fills the column top to bottom.
  await seedNamed(page, [{ name: 'a.png', fill: '#f00' }, { name: 'b.png', fill: '#0a0', h: 200 }, { name: 'c.png', fill: '#00f' }]);
  await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); sv('bg-color', '#ffffff'); sc('show-labels', false); onLayoutChange();
    images.forEach(im => { im.sbOn = false; });
    renderImgList();
    // through the panels' own span boxes, as a user sets them
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('#settings-1 .f-rowspan', 2); set('#settings-2 .f-colspan', 2); render();
  });
  const g = await geometry(page);
  expect(g.overlaps).toEqual([]);                 // was [[1,2]]: C drawn across B's lower half
  expect(g.exp).toEqual(g.prev);                  // the export places every panel where the preview does
  expect(g.listed).toEqual([0, 1, 2]);
  const r = await page.evaluate(() => {
    const B = panelBounds.find(b => b.idx === 1), C = panelBounds.find(b => b.idx === 2);
    const c = renderExportCanvas(150), k = c.width / canvasLogicalW;
    const px = c.getContext('2d').getImageData(Math.round((B.x + B.w / 2) * k), Math.round((B.y + B.h * 0.8) * k), 1, 1).data;
    render();
    return { B, C, lowerB: [...px].slice(0, 3),
             notes: [...document.querySelectorAll('#img-list .f-span-note')].map(e => e.textContent) };
  });
  expect(r.B.h).toBeGreaterThan(r.C.h * 1.5);     // B keeps both rows
  expect(r.C.w).toBeLessThan(r.B.w * 1.5);        // C is shortened to the one free column
  expect(r.lowerB).toEqual([0, 170, 0]);           // B's lower half is B, in the export (was white)
  expect(r.notes).toEqual(['', '', '⚠ span cut to 1 × 1']);   // and C's row says why it is narrower than set
  // The SVG export walks the same cells: after it, the recorded cells are the preview's.
  const svgOk = await page.evaluate(async () => {
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')))).data);
    return { cells: [..._lastCells].map(([i, c]) => [i, c.x, c.y, c.w, c.h]).sort((a, b) => a[0] - b[0]), hasImage: /<image /.test(svg) };
  });
  expect(svgOk.hasImage).toBe(true);
  expect(svgOk.cells).toEqual(g.prev.map(b => [b.idx, b.x, b.y, b.w, b.h]));
  expect(errors).toEqual([]);
});

test('F17 random spans, blanks, hidden panels and hugged rows never overlap and agree preview to export', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 7);
  let overlapping = 0, disagree = 0;
  for (let t = 0; t < 40; t++) {
    await page.evaluate((seed) => {
      let s = seed * 7919 + 13; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      images = images.filter(Boolean);
      sv('cols', 2 + Math.floor(rnd() * 3)); sv('rows', 2 + Math.floor(rnd() * 3));
      sc('auto-row-h', rnd() < 0.5); sv('hidden-gap', rnd() < 0.5 ? 'gap' : 'reflow'); onLayoutChange();
      images.forEach(im => { im.colSpan = 1 + Math.floor(rnd() * 3); im.rowSpan = 1 + Math.floor(rnd() * 3); im.excluded = rnd() < 0.15; });
      if (rnd() < 0.5) images.splice(Math.floor(rnd() * images.length), 0, null);
    }, t + 1);
    const g = await geometry(page);
    if (g.overlaps.length) overlapping++;
    if (JSON.stringify(g.exp) !== JSON.stringify(g.prev)) disagree++;
  }
  expect(overlapping).toBe(0);
  expect(disagree).toBe(0);
  expect(errors).toEqual([]);
});

test('F06 an inset frame on a flipped or turned parent is upright in the PNG and present in the SVG', async ({ page }) => {
  const errors = await loadApp(page);
  // A solid parent and a region symmetric under the flip and the quarter turn: the frame
  // lands in the same place either way, so the export must be pixel-identical to the
  // untransformed parent's — a mirrored or sideways letter is not.
  const run = (variant) => page.evaluate(async (variant) => {
    images = []; undoStack.length = 0;
    const c = document.createElement('canvas'); c.width = 200; c.height = 200;
    const x = c.getContext('2d'); x.fillStyle = '#3060a0'; x.fillRect(0, 0, 200, 200);
    const src = c.toDataURL();
    await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'parent.png'); r(); }; im.src = src; });
    sv('cols', 2); sv('rows', 1); sc('show-labels', false); sv('label-size', 40); onLayoutChange();
    images[0].sbOn = false;
    if (variant === 'flipH') images[0].flipH = true;
    if (variant === 'rot90') images[0].rotate = 90;
    if (variant === 'flipV') images[0].flipV = true;
    if (variant === 'tilt') images[0].rotate = 30;
    selectedPanel = 0; addLinkedInset(0.3, 0.3, 0.4, 0.4); images[1].sbOn = false; render();
    const preview = _insetFrames.map(f => [f.x, f.y, f.w, f.h]);
    const cv = renderExportCanvas(96);
    const frames = _lastFrames.map(f => [f.x, f.y, f.w, f.h, f.letter]);
    const P = panelBounds.find(b => b.idx === 0);
    const k = cv.width / canvasLogicalW;
    const pix = Array.from(cv.getContext('2d').getImageData(Math.round(P.x * k), Math.round(P.y * k), Math.round(P.w * k), Math.round(P.h * k)).data);
    render();
    const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')))).data);
    return { preview, frames, sum: pix.reduce((a, v, i) => a + v * ((i % 97) + 1), 0),
             svgRects: (svg.match(/<rect [^>]*fill="none"/g) || []).length,
             svgPolys: (svg.match(/<polygon [^>]*fill="none"/g) || []).length,
             svgLetter: (svg.match(/>B<\/text>/g) || []).length };
  }, variant);
  const none = await run('none');
  expect(none.svgRects).toBe(2);
  for (const v of ['flipH', 'flipV', 'rot90']) {
    const r = await run(v);
    expect(r.frames, v).toEqual(none.frames);       // recorded in figure space (was missing)
    expect(r.preview, v).toEqual(none.preview);     // and grabbable on screen
    expect(r.sum, v).toBe(none.sum);                // letter upright: same pixels as unflipped
    expect(r.svgRects, v).toBe(2);                  // was 0
    expect(r.svgLetter, v).toBe(1);                 // was 0
  }
  // A free tilt turns the region: a quadrilateral, drawn as a polygon in the SVG.
  const tilt = await run('tilt');
  expect(tilt.svgPolys).toBe(2);                    // was 0
  expect(tilt.svgRects).toBe(0);
  expect(tilt.svgLetter).toBe(1);
  expect(errors).toEqual([]);
});

test('F06 an inset region on a flipped parent maps through the flip, and dragging its frame follows the pointer', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const x = c.getContext('2d'); x.fillStyle = '#3060a0'; x.fillRect(0, 0, 200, 100);
    const src = c.toDataURL();
    await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'parent.png'); r(); }; im.src = src; });
    sv('cols', 2); sv('rows', 1); onLayoutChange(); images[0].sbOn = false;
    selectedPanel = 0; addLinkedInset(0.1, 0.2, 0.2, 0.3); render();
    const plain = _insetFrames[0];
    images[0].flipH = true; render();
    const flipped = _insetFrames[0];
    const pb = panelBounds.find(b => b.idx === 0);
    // client coordinates of the flipped frame's top edge, for a real pointer drag
    const rc = annCanvas.getBoundingClientRect(), kx = rc.width / canvasLogicalW, ky = rc.height / canvasLogicalH;
    const at = (lx, ly) => ({ x: rc.left + lx * kx, y: rc.top + ly * ky });
    return { plain, flipped, pb, r0: { ...images[1].insetRect }, from: at(flipped.x + flipped.w / 2, flipped.y), kx };
  });
  // Drag the frame 20 px to the right: on a flipped parent the region moves LEFT in the
  // source, so the frame on screen still follows the pointer.
  await page.mouse.move(r.from.x, r.from.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(r.from.x + 5 * i * r.kx, r.from.y);
  await page.mouse.up();
  const d = await page.evaluate(() => { render(); return { after: { ...images[1].insetRect }, x: _insetFrames[0].x }; });
  r.after = d.after; r.moved = d.x - r.flipped.x;
  // Mirrored about the picture's centre line.
  const cx = r.pb.ix + r.pb.iw / 2;
  expect(Math.abs((r.flipped.x + r.flipped.w / 2) - (2 * cx - (r.plain.x + r.plain.w / 2)))).toBeLessThan(1.01);
  expect(r.flipped.y).toBeCloseTo(r.plain.y, 0);
  expect(r.after.x).toBeLessThan(r.r0.x);
  expect(r.moved).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('F11 importing more images than the grid holds grows the grid, and past the cap says how many are left out', async ({ page }) => {
  const errors = await loadApp(page);
  const files = async (n) => page.evaluate(async (n) => {
    window.__toasts = []; const o = window.toast; window.toast = function (m, k) { window.__toasts.push({ m: String(m), k }); return o.apply(this, arguments); };
    const list = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas'); c.width = 40; c.height = 30;
      const x = c.getContext('2d'); x.fillStyle = `rgb(${i * 6},80,120)`; x.fillRect(0, 0, 40, 30);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      list.push(new File([blob], `many_${String(i).padStart(2, '0')}.png`, { type: 'image/png' }));
    }
    await addFiles(list); render();
    window.toast = o;
    return { cols: gi('cols'), rows: gi('rows'), n: images.length, drawn: _figurePanels().length,
             badge: document.getElementById('img-count').textContent.trim(),
             outside: document.querySelectorAll('#img-list .f-offgrid').length, toasts: window.__toasts };
  }, n);
  const a = await files(8);
  expect([a.cols, a.rows]).toEqual([3, 3]);         // was 3 x 2 with two panels undrawn
  expect(a.drawn).toBe(8);
  expect(a.badge).toBe('8');
  expect(a.toasts.some(t => /grid.*3 × 3/i.test(t.m))).toBe(true);
  // One Ctrl+Z takes back the last image and nothing it did not cause.
  const u = await page.evaluate(() => { undo(); return { n: images.length, rows: gi('rows'), drawn: _figurePanels().length }; });
  expect(u).toEqual({ n: 7, rows: 3, drawn: 7 });
  // Past the 12-row cap the grid stops growing and the rest are named, not dropped silently.
  await page.evaluate(() => { images = []; sv('cols', 3); sv('rows', 2); onLayoutChange(); renderImgList(); });
  const b = await files(40);
  expect([b.cols, b.rows]).toEqual([3, 12]);
  expect(b.drawn).toBe(36);
  expect(b.badge).toBe('36 of 40');
  expect(b.outside).toBe(4);
  expect(b.toasts.some(t => t.k === 'warn' && /4 panels.*outside the grid/i.test(t.m))).toBe(true);
  expect(errors).toEqual([]);
});

test('F16 a TIFF stack past 60 pages asks, and says which pages it left out when declined', async ({ page }) => {
  const errors = await loadApp(page);
  const b64 = tiffStack(70);
  const open = (accept) => page.evaluate(async ({ b64, accept }) => {
    images = []; window.__toasts = [];
    const o = window.toast; window.toast = function (m, k) { window.__toasts.push({ m: String(m), k }); return o.apply(this, arguments); };
    const oc = window.confirm; let asked = '';
    window.confirm = (m) => { asked = m; return accept; };
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await addFiles([new File([u], 'stack70.tif', { type: 'image/tiff' })]);
    window.toast = o; window.confirm = oc;
    const lastIm = images[images.length - 1];
    return { n: images.length, last: _sourceName(lastIm), asked, toasts: window.__toasts };
  }, { b64, accept });
  const declined = await open(false);
  expect(declined.asked).toMatch(/70 pages/);
  expect(declined.n).toBe(60);
  expect(declined.toasts.some(t => t.k === 'warn' && /61.70/.test(t.m) && /60 of 70/.test(t.m))).toBe(true);
  const accepted = await open(true);
  expect(accepted.n).toBe(70);
  // panels cite the file the author has, and which page of it (was "stack70_p70.png",
  // a file that never existed)
  expect(accepted.last).toBe('stack70.tif (page 70 of 70)');
  expect(errors).toEqual([]);
});

test('F18 labels past Z never repeat, and compliance flags a duplicated label', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 30);
  const r = await page.evaluate(async () => {
    sv('cols', 6); sv('rows', 5); onLayoutChange();
    images.splice(images.findIndex(im => im.label === '28'), 1);
    const c = document.createElement('canvas'); c.width = 20; c.height = 20; const src = c.toDataURL();
    await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'new.png'); r(); }; im.src = src; });
    const labels = images.map(im => im.label);
    const note = (label) => { checkCompliance(); const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')]
      .find(el => el.querySelector('.c-label').textContent.trim() === label);
      const out = row ? { icon: row.querySelector('.c-icon').textContent.trim(), note: row.querySelector('.c-note').textContent.trim() } : null;
      return out; };
    const clean = note('Panel labels unique');
    images[3].label = 'B';                            // typed by hand, the same as panel 2
    const dup = note('Panel labels unique');
    return { labels, unique: new Set(labels).size, clean, dup };
  });
  expect(r.labels.slice(-1)[0]).toBe('28');            // the free number, not a second '30'
  expect(r.unique).toBe(30);
  expect(r.clean.icon).toBe('✓');
  expect(r.dup.icon).not.toBe('✓');
  expect(r.dup.note).toMatch(/B/);
  expect(errors).toEqual([]);
});

test('F10 images dropped with a CSV all land in the current grid; the chart waits on the canvas', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    window.__toasts = []; const o = window.toast; window.toast = function (m, k) { window.__toasts.push({ m: String(m), k }); return o.apply(this, arguments); };
    const png = async (name, i) => { const c = document.createElement('canvas'); c.width = 30; c.height = 30;
      c.getContext('2d').fillStyle = `rgb(${i * 40},0,0)`; c.getContext('2d').fillRect(0, 0, 30, 30);
      return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name, { type: 'image/png' }); };
    const csv = new File(['x,y\na,1\nb,2\n'], 'data.csv', { type: 'text/csv' });
    await addFiles([await png('many_00.png', 0), await png('many_01.png', 1), csv, await png('many_02.png', 2), await png('many_03.png', 3)]);
    await new Promise(r => setTimeout(r, 300));
    window.toast = o;
    return { mode: layoutMode, grid: images.filter(Boolean).map(i => i.name),
             ffImages: freeformElements.filter(e => e.type === 'image').length,
             charts: freeformElements.filter(e => e.type === 'chart').length,
             modal: !!document.querySelector('#chart-modal.open'), toasts: window.__toasts.map(t => t.m) };
  });
  expect(r.mode).toBe('grid');                          // was flipped to freeform mid-drop
  expect(r.grid).toEqual(['many_00.png', 'many_01.png', 'many_02.png', 'many_03.png']);
  expect(r.ffImages).toBe(0);                           // was 2 images on the hidden canvas
  expect(r.charts).toBe(1);
  expect(r.modal).toBe(false);
  expect(r.toasts.some(m => /chart.*freeform/i.test(m))).toBe(true);
  // A drop of only a CSV still opens it as a chart, as before.
  const s = await page.evaluate(async () => {
    await addFiles([new File(['x,y\na,1\n'], 'only.csv', { type: 'text/csv' })]);
    await new Promise(r => setTimeout(r, 300));
    return { mode: layoutMode, modal: !!document.querySelector('#chart-modal.open') };
  });
  expect(s).toEqual({ mode: 'freeform', modal: true });
  expect(errors).toEqual([]);
});

test('HG-01 a hidden panel that spans keeps its whole footprint blank when hidden panels leave a gap', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 5);
  const cellsOf = () => page.evaluate(() => {
    render();
    const xs = [...new Set(panelBounds.map(p => p.x))].sort((a, b) => a - b), ys = [...new Set(panelBounds.map(p => p.y))].sort((a, b) => a - b);
    const prev = panelBounds.filter(p => p.idx >= 0 && !images[p.idx].excluded).map(p => `${images[p.idx].name}@${ys.indexOf(p.y)},${xs.indexOf(p.x)}`);
    const blank = panelBounds.filter(p => p.idx < 0).map(p => [p.w, p.h]);
    renderExportCanvas(150);
    const exp = [..._lastCells].map(([i, c]) => `${images[i].name}@${ys.indexOf(c.y)},${xs.indexOf(c.x)}`);
    render();
    return { prev, exp, blank, cell: [panelBounds[0].w, panelBounds[0].h], listed: _figurePanels().map(im => im.name) };
  });
  // A across two columns of a 3 x 2 grid with column headings.
  await page.evaluate(() => { sv('cols', 3); sv('rows', 2); sc('show-col-labels', true); sv('hidden-gap', 'gap'); onLayoutChange();
    images[0].colSpan = 2; render(); });
  const shown = await cellsOf();
  await page.evaluate(() => { images[0].excluded = true; onLayoutChange(); });
  const hid = await cellsOf();
  // Everyone else stays under the heading they were under (B was sliding to column 2).
  expect(hid.prev).toEqual(shown.prev.filter(s => !s.startsWith('panel0')));
  expect(hid.exp).toEqual(hid.prev);
  expect(hid.listed).toEqual(['panel1.png', 'panel2.png', 'panel3.png', 'panel4.png']);
  // and A's blank is exactly the footprint A had (panelBounds[0] is A while shown)
  expect(hid.blank).toEqual([shown.cell]);
  expect(shown.cell[0]).toBeGreaterThan(shown.cell[1] * 1.5);
  // The same for a row span.
  await page.evaluate(() => { images[0].excluded = false; images[0].colSpan = 1; images[0].rowSpan = 2; onLayoutChange(); });
  const shownR = await cellsOf();
  await page.evaluate(() => { images[0].excluded = true; onLayoutChange(); });
  const hidR = await cellsOf();
  expect(hidR.prev).toEqual(shownR.prev.filter(s => !s.startsWith('panel0')));
  expect(hidR.exp).toEqual(hidR.prev);
  expect(errors).toEqual([]);
});
