// @ts-check
// Usability round 2, exports / freeform / gene maps group.
// freeform2-01 — the PowerPoint slide is the figure's printed size, so 8 pt letters read 8 pt
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

const H = `
  window.__unzip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true), csize = dv.getUint32(p + 18, true);
      const nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el, raw = bytes.subarray(at, at + csize);
      let data = raw;
      if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out[name] = /\\.(xml|rels|txt|csv|json|md|R|py|svg)$/.test(name) ? new TextDecoder().decode(data) : data;
      p = at + csize;
    }
    return out;
  };
  window.__latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  window.__pptx = async () => __unzip((await _captureDownload(() => exportPPTX())).data);
  window.__pdf = async (lossless) => __latin1((await _captureDownload(() => _exportPDFWithText('f', 300, { lossless: !!lossless }))).data);
  // Every Tj string a content stream shows, decoded from its octal escapes.
  window.__pdfShown = (pdf) => [...pdf.matchAll(/\\(((?:\\\\.|[^\\\\)])*)\\) Tj/g)].map(m => m[1].replace(/\\\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\\\(.)/g, '$1'));
`;

test.describe('PowerPoint at the printed size', () => {
  test('freeform2-01: a freeform figure at 180 mm gives a 180 mm slide and 8 pt letters read 8 pt', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 400, h: 300, label: 'A' }, { type: 'image', x: 440, y: 20, w: 400, h: 300, label: 'B' }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      sv('export-width-mm', '180'); sv('label-pt', '8'); sc('show-labels', true); render();
      const z = await __pptx();
      const pres = z['ppt/presentation.xml'], slide = z['ppt/slides/slide1.xml'];
      const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres);
      const letter = /name="Panel letter: A"(?:(?!<\/p:sp>).)*?sz="(\d+)"/s.exec(slide);
      const pf = _physFacts();
      return { cx: +m[1], cy: +m[2], wMm: pf.wMm, hMm: pf.hMm, sz: letter && +letter[1], notes: z['ppt/notesSlides/notesSlide1.xml'] };
    });
    expect(Math.abs(r.cx / 36000 - 180)).toBeLessThan(0.05);
    expect(Math.abs(r.cy / 36000 - r.hMm)).toBeLessThan(0.05);
    expect(r.sz).toBe(800);
    expect(r.notes).toMatch(/the figure at its printed size/);
    expect(errors).toEqual([]);
  });

  test('freeform2-01: a grid figure at 89 mm gives an 89 mm slide; Free width uses the canvas at the export DPI', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      sv('export-width-mm', '89'); sv('label-pt', '7'); sc('show-labels', true); render();
      let z = await __pptx();
      const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(z['ppt/presentation.xml']);
      const sz = +(/name="Panel letter: A"(?:(?!<\/p:sp>).)*?sz="(\d+)"/s.exec(z['ppt/slides/slide1.xml']) || [])[1];
      sv('export-width-mm', '0'); render();
      const pf = _physFacts();
      z = await __pptx();
      const m2 = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(z['ppt/presentation.xml']);
      return { cx: +m[1], sz, freeCx: +m2[1], freeMm: pf.wMm };
    });
    expect(Math.abs(r.cx / 36000 - 89)).toBeLessThan(0.05);
    expect(r.sz).toBe(700);
    expect(Math.abs(r.freeCx / 36000 - r.freeMm)).toBeLessThan(0.05);
    expect(errors).toEqual([]);
  });
});

const path = require('path');
const GB = path.join(__dirname, 'fixtures', 'phage_lysis_ncbi.gb');
async function openSection(page, name) {
  const summary = page.locator('details > summary').filter({ hasText: new RegExp('^\\s*' + name) }).first();
  if (!(await summary.evaluate(s => s.parentElement.open))) await summary.click();
  await summary.scrollIntoViewIfNeeded();
}

test.describe('gene maps', () => {
  test('freeform2-02: an NCBI GenBank record (gene + CDS pairs, tRNAs, a join()) draws each gene once', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 200 }]);
    await openSection(page, 'Annotate & Draw');
    await page.getByRole('button', { name: '🧬 Linear' }).click();
    const m = page.locator('#genemap-modal');
    await m.waitFor({ state: 'visible' });
    await m.locator('input[type=file]').setInputFiles(GB);
    await expect(m.locator('#gm-stat')).toContainText('11 features');
    const note = await page.locator('#toast').innerText();
    await m.getByRole('button', { name: 'Apply', exact: true }).click();
    await m.waitFor({ state: 'hidden' });
    const r = await page.evaluate(() => {
      const g = freeformElements.find(e => e.type === 'genemap');
      return { n: freeformElements.filter(e => e.type === 'genemap').length, f: g.map.features.map(f => [f.name, f.type, f.start, f.end, f.strand].join(' ')) };
    });
    expect(r.n).toBe(1);
    expect(r.f).toEqual([
      'int cds 120 1430 1', 'cI cds 1500 2210 -1', 'cro cds 2300 2520 1', 'tRNA-Arg ncrna 2600 2676 1', 'tRNA-Met ncrna 2700 2775 -1',
      'G cds 3000 4380 1', 'G cds 3000 3935 1',                       // two CDSs of one gene are both kept
      "pR' promoter 4900 4935 1", 'S cds 5000 5250 1', 'R cds 5240 5740 1', 'orf62 cds 6000 6800 1']);   // a lone (pseudo)gene stays
    // the import says what it did, in one message
    expect(note).toMatch(/Loaded 11 features/);
    expect(note).toMatch(/8 genes listed twice \(gene \+ CDS or RNA\) drawn once each/);
    expect(note).toMatch(/1 multi-segment feature\(s\) drawn as their overall span/);
    expect(errors).toEqual([]);
  });

  test('ISSUES phage: 🧬 Linear then Cancel takes the sample map away again, in freeform and in the grid; Apply keeps it and closes', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 200 }]);
    await openSection(page, 'Annotate & Draw');
    const m = page.locator('#genemap-modal');
    const maps = () => page.evaluate(() => freeformElements.filter(e => e.type === 'genemap').length + images.filter(i => i && i.type === 'genemap').length);
    await page.getByRole('button', { name: '🧬 Linear' }).click();
    await m.waitFor({ state: 'visible' });
    expect(await maps()).toBe(1);
    await m.getByRole('button', { name: 'Cancel' }).click();
    expect(await maps()).toBe(0);
    await page.getByRole('button', { name: '🧬 Linear' }).click();
    await m.getByRole('button', { name: 'Apply', exact: true }).click();
    await m.waitFor({ state: 'hidden' });
    expect(await maps()).toBe(1);
    // Reopening the applied map and pressing Cancel keeps it
    await page.evaluate(() => { selectedElems.clear(); selectedElems.add(freeformElements.findIndex(e => e.type === 'genemap')); openGenemapModal(); });
    await m.getByRole('button', { name: 'Cancel' }).click();
    expect(await maps()).toBe(1);
    // grid
    await page.evaluate(() => { freeformElements.length = 0; document.getElementById('layout-mode').value = 'grid'; setLayoutMode('grid'); });
    await seedPanels(page, 2);
    const n0 = await page.evaluate(() => images.length);
    await openSection(page, 'Annotate & Draw');
    await page.getByRole('button', { name: '🧬 Linear' }).click();
    await m.waitFor({ state: 'visible' });
    expect(await page.evaluate(() => images.length)).toBe(n0 + 1);
    await page.keyboard.press('Escape');
    await m.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => images.length)).toBe(n0);
    expect(errors).toEqual([]);
  });
});

// Real mouse clicks on the freeform canvas at a logical point.
async function clickAt(page, x, y, modifiers) {
  const p = await page.evaluate(([x, y]) => { const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    return [r.left + x * r.width / (canvasLogicalW || c.width), r.top + y * r.height / (canvasLogicalH || c.height)]; }, [x, y]);
  if (modifiers) await page.keyboard.down(modifiers);
  await page.mouse.click(p[0], p[1]);
  if (modifiers) await page.keyboard.up(modifiers);
  await page.waitForTimeout(80);
}

test.describe('gene-map text', () => {
  // Boxes of every word a gene map draws, from a recording emitter (the canvas, SVG, PDF and
  // PowerPoint all take their words from the same calls).
  const BOXES = `window.__gmBoxes = (el) => {
    const out = [], mc = document.createElement('canvas').getContext('2d');
    const e = { rect() {}, line() {}, poly() {}, circle() {}, clipStart() {}, clipEnd() {},
      text(str, x, y, font, fill, align, baseline) { mc.font = font; const w = _rtMeasure(mc, str), fs = parseFloat(/([\\d.]+)px/.exec(font)[1]);
        const l = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
        const t = baseline === 'top' ? y : baseline === 'middle' ? y - fs / 2 : y - fs * 0.8;
        out.push({ str, l, r: l + w, t, b: t + fs }); } };
    _genemapDraw(el, e); return out; };`;
  test('ISSUES freeform: the length label keeps clear of the feature labels at the right end of a short map', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(BOXES);
    const r = await page.evaluate(() => {
      const feats = [['pLate', 'promoter', 60, 110, 1], ['terS', 'cds', 120, 680, 1], ['terL', 'cds', 700, 2300, 1], ['portal', 'cds', 2320, 3900, 1], ['scaf', 'cds', 3920, 4600, 1],
        ['mcp', 'cds', 4620, 5800, 1], ['tail tube', 'cds', 5820, 6400, 1], ['tape measure', 'cds', 6420, 9100, 1], ['holin', 'cds', 9200, 9500, -1],
        ['endolysin', 'cds', 9510, 10050, -1], ['Rz', 'cds', 10060, 10400, -1], ['tLate', 'terminator', 10500, 10560, 1]].map(([name, type, start, end, strand]) => ({ name, type, start, end, strand }));
      const res = [];
      for (const ruler of [true, false]) {
        const map = _defaultGenemap(); map.length = 10800; map.features = feats; map.style.showRuler = ruler; map.style.showLabels = true; map.style.strandRows = true;
        const B = __gmBoxes({ type: 'genemap', x: 0, y: 0, w: 446, h: 160, map });
        const len = B.find(b => b.str === '10.8 kb'), names = B.filter(b => feats.some(f => f.name === b.str));
        res.push(names.filter(n => !(n.r <= len.l || n.l >= len.r || n.b <= len.t || n.t >= len.b)).map(n => n.str));
      }
      return res;
    });
    expect(r).toEqual([[], []]);
    expect(errors).toEqual([]);
  });

  test('phage2-05: a long gene-map title in one grid cell fits the cell and keeps clear of the panel letter', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(BOXES);
    const r = await page.evaluate(() => {
      sc('show-labels', true);
      const map = _defaultGenemap(); map.style.title = '*Escherichia* phage phiKBA3, structural and lysis genes';
      const el = { type: 'genemap', label: 'F', x: 0, y: 0, w: 300, h: 200, map };
      const B = __gmBoxes(el).filter(b => /phage|Escherichia|structural|lysis/.test(b.str));
      const reserve = Math.max(7, gf('label-size')) * 1.1;
      return { inside: B.every(b => b.l >= 0 && b.r <= 300), clearOfLetter: B.every(b => b.l >= reserve || b.t > gf('label-size') + 8), lines: B.length };
    });
    expect(r.inside).toBe(true);
    expect(r.clearOfLetter).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('freeform editing', () => {
  test('freeform2-04: X/Y/W/H show the new selection after a value was typed for another object', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 150 }, { type: 'image', x: 240, y: 20, w: 200, h: 150 },
      { type: 'image', x: 20, y: 300, w: 200, h: 150 }]);
    await clickAt(page, 120, 375);                       // the third picture
    await page.locator('#geo-y').fill('350'); await page.locator('#geo-y').press('Enter');
    expect(await page.evaluate(() => freeformElements[2].y)).toBe(350);
    await page.keyboard.press('Escape');
    await clickAt(page, 120, 95);
    await clickAt(page, 340, 95, 'Shift');
    const v = await page.evaluate(() => ['x', 'y', 'w', 'h'].map(k => document.getElementById('geo-' + k).value));
    expect(v).toEqual(['20', '20', '420', '150']);
    // one object after another
    await clickAt(page, 120, 420);
    await page.locator('#geo-y').fill('360'); await page.locator('#geo-y').press('Enter');
    await clickAt(page, 340, 95);
    expect(await page.locator('#geo-y').inputValue()).toBe('20');
    expect(errors).toEqual([]);
  });

  test('freeform2-12 / freeform-45: a size preset that leaves an object off the canvas says which', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 400, h: 300, name: 'phase.png' }]);
    await page.evaluate(() => { applyDeliverable('graphicalAbstract'); document.getElementById('info-modal-bg')?.remove(); });
    await page.evaluate(() => { const e = freeformElements[0]; e.x = 1028; e.y = 200; e.w = 220; e.h = 220; render(); });
    // ⌘K › square graphical abstract (1200 × 1200): the 220 px object at x 1028 ends at 1248
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdp-input').fill('square graphical abstract');
    await page.keyboard.press('Enter');
    await expect(page.locator('#deliverable-off')).toContainText('1 object');
    await expect(page.locator('#deliverable-off')).toContainText('reaches past the edge');
    await expect(page.locator('#toast')).toContainText('past the edge');
    expect(errors).toEqual([]);
  });

  test('freeform2-05: ⊡ Fit shows the whole freeform canvas inside the pane', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300 }]);
    for (const [w, h] of [[958, 798], [1200, 1200]]) {
      await page.locator('#fm-canvas-w').fill(String(w)); await page.locator('#fm-canvas-w').press('Enter');
      await page.locator('#fm-canvas-h').fill(String(h)); await page.locator('#fm-canvas-h').press('Enter');
      await page.waitForTimeout(150);
      await page.getByRole('button', { name: '⊡ Fit' }).click();
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => { const c = document.getElementById('fig-canvas').getBoundingClientRect(), w = document.getElementById('canvas-wrap').getBoundingClientRect();
        return { top: c.top - w.top, bottom: w.bottom - c.bottom, left: c.left - w.left, right: w.right - c.right, h: c.height }; });
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeGreaterThanOrEqual(0);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeGreaterThanOrEqual(0);
      expect(Math.abs(r.top - r.bottom)).toBeLessThan(30);   // centred, no empty band above
    }
    expect(errors).toEqual([]);
  });

  test('freeform2-05: below 100 % the zoom box follows a canvas that changes size afterwards (grid too)', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 4);
    await page.evaluate(() => { sv('cols', '2'); sv('rows', '2'); onLayoutChange(); render(); });
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.evaluate(() => { sv('cols', '4'); sv('rows', '1'); onLayoutChange(); render(); });
    const r = await page.evaluate(() => { const fc = document.getElementById('fig-canvas'), cc = document.getElementById('canvas-container');
      return { held: parseFloat(cc.style.width), off: cc.offsetWidth, canvasCss: fc.offsetWidth, shown: fc.getBoundingClientRect().width, zoom }; });
    expect(r.zoom).toBeLessThan(1);
    expect(Math.abs(r.held - r.canvasCss)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.shown - r.canvasCss * r.zoom)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('freeform2-06: Crop% typed in the bar keeps the box\'s top-left corner (crop first, then place, works by numbers)', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 744, y: 332, w: 194, h: 259, iw: 600, ih: 800 }, { type: 'image', x: 20, y: 20, w: 500, h: 400, iw: 1200, ih: 960 }]);
    await clickAt(page, 840, 460);
    for (const [k, v] of [['T', '12.5'], ['B', '12.5']]) { await page.locator('#ep-crop' + k).fill(v); await page.locator('#ep-crop' + k).press('Tab'); }
    const d = await page.evaluate(() => { const e = freeformElements[0]; return [e.x, e.y, +e.w.toFixed(2), +e.h.toFixed(2)]; });
    expect(d).toEqual([744, 332, 194, +(259 * 0.75).toFixed(2)]);
    await clickAt(page, 200, 200);
    for (const [k, v] of [['L', '4.17'], ['R', '4.17']]) { await page.locator('#ep-crop' + k).fill(v); await page.locator('#ep-crop' + k).press('Tab'); }
    await page.locator('#geo-w').fill('506'); await page.locator('#geo-w').press('Enter');
    const a = await page.evaluate(() => { const e = freeformElements[1]; return [e.x, e.y, e.x + e.w]; });
    expect(a).toEqual([20, 20, 526]);
    expect(errors).toEqual([]);
  });

  test('freeform2-07: the annotation toolbar sits beside the selection, inside the canvas pane, not on it', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 200 }]);
    await page.locator('#fm-canvas-w').fill('958'); await page.locator('#fm-canvas-w').press('Enter');
    await page.locator('#fm-canvas-h').fill('798'); await page.locator('#fm-canvas-h').press('Enter');
    await page.evaluate(() => { const W = canvasLogicalW, Hh = canvasLogicalH;
      annotations.push({ type: 'rect', xf: 700 / W, yf: 300 / Hh, x2f: 950 / W, y2f: 500 / Hh, color: '#000000', width: 2, fill: true, fillColor: '#eeeeee', fillOpacity: 1 });
      annotations.push({ type: 'textbox', xf: 300 / W, yf: 60 / Hh, x2f: 600 / W, y2f: 120 / Hh, text: 'Title', fill: true, fillColor: '#000000', fillOpacity: 0.6, shape: 'rect', fontSize: 18, color: '#ffffff' });
      render(); });
    await page.getByRole('button', { name: '⊡ Fit' }).click();
    for (const [x, y, box] of [[820, 400, [700, 300, 950, 500]], [450, 90, [300, 60, 600, 120]]]) {
      await clickAt(page, x, y);
      const r = await page.evaluate((box) => { const f = document.getElementById('ann-float').getBoundingClientRect(), w = document.getElementById('canvas-wrap').getBoundingClientRect();
        const c = document.getElementById('ann-canvas').getBoundingClientRect(), k = c.width / canvasLogicalW;
        const s = { l: c.left + box[0] * k, t: c.top + box[1] * k, r: c.left + box[2] * k, b: c.top + box[3] * k };
        return { inPane: f.left >= w.left && f.right <= w.right + 0.5 && f.top >= w.top - 0.5 && f.bottom <= w.bottom + 0.5,
          overlaps: !(f.right <= s.l || f.left >= s.r || f.bottom <= s.t || f.top >= s.b), shown: getComputedStyle(document.getElementById('ann-float')).display };
      }, box);
      expect(r.shown).toBe('flex');
      expect(r.inPane).toBe(true);
      expect(r.overlaps).toBe(false);
    }
    expect(errors).toEqual([]);
  });

  test('freeform2-08 / 2-20: an icon arrives with no letter and keeps its name in the Elements list; charts and gene maps show their letter there', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 200, h: 200 }]);
    await openSection(page, 'Annotate & Draw');
    await page.locator('button[title="Insert Bacteriophage"]').click();
    await page.waitForFunction(() => freeformElements.length === 2);
    await page.evaluate(() => { addChartElement('bar'); closeChartModal(); freeformElements[2].letter = 'E'; updateFreeformElemList(); });
    const rows = await page.locator('#fm-elem-list .tpl-saved span').allInnerTexts();
    const icon = await page.evaluate(() => { const e = freeformElements[1]; return { label: e.label, name: e.name, chip: !!_ffFurniture(e).label }; });
    expect(icon).toEqual({ label: '', name: 'Bacteriophage', chip: false });
    expect(rows.some(r => /Bacteriophage/.test(r))).toBe(true);
    expect(rows.some(r => /^📊 E · /.test(r))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('freeform2-18: a picture\'s Props bar wraps inside the window at 1440 px, so Len, the units, BG and Tol can be reached', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300 }]);
    await clickAt(page, 150, 150);
    const r = await page.evaluate(() => {
      const bar = document.getElementById('elem-props-bar'), pane = document.getElementById('ep-image-props');
      const vis = [...pane.querySelectorAll('input,select,button')].filter(e => e.offsetParent);
      const out = vis.filter(e => { const b = e.getBoundingClientRect(); return b.right > window.innerWidth + 0.5; }).map(e => e.id || e.title || e.textContent);
      return { shown: getComputedStyle(pane).display, out, over: bar.scrollWidth - bar.clientWidth };
    });
    expect(r.shown).toBe('flex');
    expect(r.out).toEqual([]);
    expect(r.over).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('freeform2-17 / phage2-18: the toolbar size read-out follows the freeform canvas', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300 }]);
    await page.locator('#fm-canvas-w').fill('958'); await page.locator('#fm-canvas-w').press('Enter');
    await page.locator('#fm-canvas-h').fill('798'); await page.locator('#fm-canvas-h').press('Enter');
    await expect(page.locator('#canvas-info')).toContainText('958×798px');
    await page.locator('#fm-canvas-h').fill('700'); await page.locator('#fm-canvas-h').press('Enter');
    await expect(page.locator('#canvas-info')).toContainText('958×700px');
    expect(errors).toEqual([]);
  });

  test('freeform2-14: ⌘K "duplicate figure" finds the library copy, and an empty name says it saved nothing', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300 }]);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdp-input').fill('duplicate figure');
    await expect(page.locator('#cmdp-list, #cmdp-results, .cmdp-item').first()).toContainText(/session library/i);
    await page.keyboard.press('Escape');
    page.once('dialog', d => d.accept(''));
    await page.evaluate(() => saveToLibrary());
    await expect(page.locator('#toast')).toContainText('Not saved');
    expect(errors).toEqual([]);
  });

  test('charts2-20: the Export box names the placed key plainly', async ({ page }) => {
    const errors = await loadApp(page);
    await seedPanels(page, 2);
    const w = await page.evaluate(() => { addChartElement('line'); closeChartModal(); annotations.push({ type: 'legend', xf: 0.05, yf: 0.05 }); render();
      const k = _figTextSizes().find(t => t.kind === 'key'); return { keyRows: _figureKey().length, text: k ? _TEXT_KIND[k.kind] + ' ' + k.where : 'no key' }; });
    expect(w.keyRows).toBeGreaterThan(0);
    expect(w.text).toBe('legend key (placed on the figure)');   // wording settled by the compliance fixer (ux2-check)
    expect(errors).toEqual([]);
  });

  test('freeform2-16 / ISSUES align: a superscript minus is U+2212; the align buttons say which edge wins', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300 }]);
    const r = await page.evaluate(() => ({ sup: _rtParse('cells mL^{-1}').runs.filter(x => x.sup).map(x => x.t), plain: _rtText('mL^{-1}'), dash: _rtParse('x^{a-b}').runs.filter(x => x.sup).map(x => x.t) }));
    expect(r.sup).toEqual(['−1']);
    expect(r.plain).toBe('mL⁻¹');
    expect(r.dash).toEqual(['a-b']);                      // only a leading hyphen before a number
    await expect(page.locator('button', { hasText: '⊤T' })).toHaveAttribute('title', /topmost edge/);
    expect(errors).toEqual([]);
  });

  test('ISSUES freeform: unticking Fill on a text box leaves no box, on the canvas, in the SVG and in the PowerPoint', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 600, y: 600, w: 100, h: 100 }]);
    await page.evaluate(H);
    await page.evaluate(() => { const W = canvasLogicalW, Hh = canvasLogicalH;
      annotations.push({ type: 'textbox', xf: 100 / W, yf: 100 / Hh, x2f: 400 / W, y2f: 160 / Hh, text: 'Title', fill: true, fillColor: '#000000', fillOpacity: 0.6, shape: 'rect', fontSize: 18, color: '#ffffff' });
      render(); });
    await clickAt(page, 110, 105);
    await expect(page.locator('#ann-float-fill')).toBeVisible();
    await page.locator('#ann-float-fill').uncheck();
    const r = await page.evaluate(async () => {
      const c = renderExportCanvas(96), k = c.width / canvasLogicalW;
      const px = [...c.getContext('2d').getImageData(Math.round(105 * k), Math.round(105 * k), 1, 1).data].slice(0, 3);
      document.getElementById('export-svg-mode').value = 'layered';
      const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 96, document.getElementById('fig-canvas')))).data);
      const g = (svg.match(/<g data-type="textbox">.*?<\/g>/s) || [''])[0];
      const s = (await __pptx())['ppt/slides/slide1.xml'];
      const sp = (s.match(/<p:sp>(?:(?!<\/p:sp>).)*name="Text box:(?:(?!<\/p:sp>).)*<\/p:sp>/s) || [''])[0];
      return { px, svgNone: /<rect[^>]*fill="none"/.test(g), pptNoFill: /<\/a:prstGeom><a:noFill\/>/.test(sp), fill: annotations[0].fill };
    });
    expect(r.fill).toBe(false);
    expect(r.px).toEqual([255, 255, 255]);              // the canvas shows through (it was 102,102,102)
    expect(r.svgNone).toBe(true);
    expect(r.pptNoFill).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('submission package parts', () => {
  test('newcomer2-12 / 2-22: panel files keep the picture\'s shape and the export DPI, and are named by the letters shown; no scale-bar length where there is no bar', async ({ page }) => {
    test.setTimeout(60000);
    const errors = await loadApp(page);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      const mk = (w, h, g) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = g; x.fillRect(0, 0, w, h); return c.toDataURL('image/png'); };
      for (const [w, h, g, n] of [[300, 400, '#404040', 'tem.png'], [400, 400, '#808080', 'plate.png']])
        await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, img.src, n); res(); }; img.src = mk(w, h, g); });
      sv('cols', '2'); sv('rows', '1'); sv('label-format', 'abc'); sv('export-dpi', '300'); sv('export-width-mm', '0');
      images[0].umPerPx = 0.1; images[0].sbUm = 10; images[0].sbOn = true; images[1].umPerPx = 0; images[1].sbUm = 10; images[1].sbOn = false;
      render();
      const z = await __unzip((await _captureDownload(() => exportSubmissionPackage())).data);
      const names = Object.keys(z).filter(n => /^panels\//.test(n));
      const png = z[names[0]];
      const dv = new DataView(png.buffer, png.byteOffset), W = dv.getUint32(16), Hh = dv.getUint32(20);
      let ppm = 0; for (let p = 8; p < png.length - 12;) { const len = dv.getUint32(p), t = String.fromCharCode(...png.subarray(p + 4, p + 8)); if (t === 'pHYs') ppm = dv.getUint32(p + 8); if (t === 'IDAT') break; p += 12 + len; }
      const csvName = Object.keys(z).find(n => /metadata\.csv$/.test(n));
      const rows = z[csvName].split('\n').map(l => l.split(','));
      return { names, aspect: W / Hh, dpi: Math.round(ppm / 39.3700787), label: rows[1][2], sb: [rows[1][4], rows[2][4]] };
    });
    expect(r.names[0]).toMatch(/^panels\/panel_1_a\.png$/);
    expect(r.aspect).toBeCloseTo(0.75, 2);              // 3:4, not the square cell
    expect(r.dpi).toBe(300);
    expect(r.label).toBe('a');
    expect(r.sb).toEqual(['10', '']);
    expect(errors).toEqual([]);
  });
});

test.describe('PDF and PowerPoint text', () => {
  test('freeform2-11: Greek, Δ, φ, the true minus and ≥ are selectable text in the PDF (Symbol, with a ToUnicode map); ✓ stays in the picture', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 40, y: 120, w: 300, h: 300, label: 'A', fill: '#888888' }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      const W = canvasLogicalW, Hh = canvasLogicalH;
      annotations.push({ type: 'text', xf: 400 / W, yf: 150 / Hh, text: 'Δ*ompC* resists', fontSize: 24, color: '#000000' });
      annotations.push({ type: 'textbox', xf: 400 / W, yf: 300 / Hh, x2f: 900 / W, y2f: 350 / Hh, text: 'Phage φGuide at 10^{−3}', fill: false, fillColor: '#ffffff', fillOpacity: 1, shape: 'rect', fontSize: 20, color: '#000000' });
      annotations.push({ type: 'text', xf: 400 / W, yf: 450 / Hh, text: '✓ done', fontSize: 24, color: '#000000' });
      render();
      const pdf = await __pdf(true);
      // what the picture under the PDF's text holds where the Δ label is
      const c = renderExportCanvas(150, { skipLabels: _pdfCanTypeset, dataText: _pdfCanTypeset });
      const k = c.width / W, ink = (x, y, w, h) => { const d = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; };
      const out = { pdf, shown: __pdfShown(pdf), deltaInk: ink(400, 150, 200, 30), tickInk: ink(400, 450, 120, 30) };
      render();
      return out;
    });
    expect(r.pdf).toMatch(/\/BaseFont \/Symbol \/ToUnicode \d+ 0 R/);
    expect(r.pdf).toMatch(/<44> <0394>/);              // Δ
    expect(r.pdf).toMatch(/<66> <03C6>/);              // φ
    expect(r.pdf).toMatch(/<2D> <2212>/);              // −
    expect(r.shown).toContain('D');                    // Δ in Symbol
    expect(r.shown).toContain('ompC');
    expect(r.shown).toContain('f');                    // φ in Symbol
    expect(r.shown).toContain('Guide at 10');
    expect(r.deltaInk).toBe(0);                        // not also in the picture
    expect(r.tickInk).toBeGreaterThan(20);             // ✓ has no standard-font glyph: it stays painted
    expect(errors).toEqual([]);
  });

  test('freeform2-10 / phage2-14: chart and gene-map words are PDF text in freeform and in the grid, not pixels', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
      freeformElements.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const ch = freeformElements.find(e => e.type === 'chart'), gm = freeformElements.find(e => e.type === 'genemap');
      Object.assign(ch, { x: 20, y: 20, w: 520, h: 360 }); Object.assign(gm, { x: 20, y: 420, w: 700, h: 200 });
      ch.chart.axes.y.title = 'OD_{600} of Δ*ompC*'; ch._chartKey = null;
      render();
      const ff = __pdfShown(await __pdf(true));
      renderExportCanvas(96, { skipLabels: _pdfCanTypeset, dataText: _pdfCanTypeset });
      const items = figTextItems.filter(t => t.kind === 'data').map(t => t.str);
      render();
      const onScreen = figTextItems.filter(t => t.kind === 'data').length;
      // grid: a chart panel and a gene-map panel
      document.getElementById('layout-mode').value = 'grid'; setLayoutMode('grid');
      freeformElements.length = 0; images.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const gch = images.find(im => im.type === 'chart'); gch.chart.axes.y.title = 'OD_{600}'; gch._chartKey = null;
      sv('cols', '1'); sv('rows', '2'); render();
      const grid = __pdfShown(await __pdf(true));
      return { ff, items, grid, onScreen };
    });
    for (const w of ['pTet', 'gfp', 'ampR', 'ColE1 ori', '0.2', 'OD', '600', ' of ', 'D', 'ompC']) expect(r.ff).toContain(w);
    expect(r.items).toContain('gfp');
    for (const w of ['pTet', 'gfp', 'OD', '600']) expect(r.grid).toContain(w);
    expect(r.onScreen).toBe(0);                       // an on-screen render records nothing extra
    expect(errors).toEqual([]);
  });

  test('freeform2-03 / 2-10: a chart or gene-map word under a placed key (or a filled box) stays hidden in the PDF, not printed over the key', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
      freeformElements.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const ch = freeformElements.find(e => e.type === 'chart'), gm = freeformElements.find(e => e.type === 'genemap');
      Object.assign(ch, { x: 20, y: 20, w: 520, h: 360 }); Object.assign(gm, { x: 20, y: 420, w: 700, h: 200 });
      render(); const W = canvasLogicalW, Hh = canvasLogicalH;
      setKeyOnFigure(true); render();                    // Export › Legend key › Place the key on the figure
      const key0 = annotations.find(a => a.type === 'legend'); key0.xf = 560 / W; key0.yf = 560 / Hh;
      annotations.push({ type: 'rect', xf: 30 / W, yf: 430 / Hh, x2f: 105 / W, y2f: 520 / Hh, fill: true, fillColor: '#ffffff', fillOpacity: 1, color: '#000000', width: 1 });
      render();
      renderExportCanvas(150, { skipLabels: _pdfCanTypeset, dataText: _pdfCanTypeset });
      const key = annotations.find(a => a.type === 'legend'), kb = { l: key.xf * W, t: key.yf * Hh, r: key.xf * W + key._w, b: key.yf * Hh + key._h };
      const words = figTextItems.filter(t => t.kind === 'data');
      const under = words.filter(t => t._box && t._box.l < kb.r && t._box.r > kb.l && t._box.t < kb.b && t._box.b > kb.t).map(t => t.str);
      const shown = __pdfShown(await __pdf(true));
      render();
      return { under, keyW: key._w, shown };
    });
    expect(r.keyW).toBeGreaterThan(20);
    expect(r.shown).not.toContain('5 kb');               // under the key
    expect(r.under).toEqual([]);
    expect(r.shown).not.toContain('pTet');               // under the white box
    expect(r.shown).toContain('gfp');                    // a word nothing covers stays text
    expect(errors).toEqual([]);
  });

  test('freeform2-10: in the PowerPoint, chart and gene-map words and the chart letter are editable text boxes', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform');
      freeformElements.length = 0;
      addChartElement('line'); closeChartModal();
      addGenemapElement('linear'); closeGenemapModal();
      const ch = freeformElements.find(e => e.type === 'chart'), gm = freeformElements.find(e => e.type === 'genemap');
      Object.assign(ch, { x: 20, y: 20, w: 520, h: 360, letter: 'E' }); Object.assign(gm, { x: 20, y: 420, w: 700, h: 200, letter: 'F' });
      ch.chart.axes.y.title = 'Time (min)'; ch._chartKey = null;
      render();
      const s = (await __pptx())['ppt/slides/slide1.xml'];
      const names = [...s.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map(m => m[1]);
      const yTitle = (s.match(/<p:sp>(?:(?!<\/p:sp>).)*name="Chart text: Time \(min\)"(?:(?!<\/p:sp>).)*<\/p:sp>/s) || [''])[0];
      document.getElementById('layout-mode').value = 'grid'; setLayoutMode('grid');
      freeformElements.length = 0; images.length = 0;
      addGenemapElement('linear'); closeGenemapModal(); render();
      const g = (await __pptx())['ppt/slides/slide1.xml'];
      return { names, yRot: /rot="16200000"/.test(yTitle), gridNames: [...g.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map(m => m[1]) };
    });
    for (const n of ['Panel letter: E', 'Panel letter: F', 'Chart text: Time (min)', 'Gene map text: gfp', 'Gene map text: ampR']) expect(r.names).toContain(n);
    expect(r.yRot).toBe(true);
    expect(r.gridNames).toContain('Chart text: gfp');
    expect(errors).toEqual([]);
  });
});
