// @ts-check
// Usability round 5, group `layout`: the legend key's room in the margins, the compliance
// fix buttons for text size, sessions and the recovery bar, Relabel, gene maps, and the
// remaining polish. Each test drives the path the tester took and fails on the build they
// tested (1cedb76).
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const HELPERS = `
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fixes: [...e.querySelectorAll('button')].map(b => b.textContent.trim()) }));
  window.__report = () => { checkCompliance(); const r = { title: document.getElementById('im-title').textContent, rows: __rows() }; __close(); return r; };
  window.__row = (l) => __report().rows.find(r => r.label === l) || null;
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
  window.__toast = () => (document.getElementById('toast') || {}).textContent || '';
  window.__hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261;
    for (let i = 0; i < d.length; i += 1) { h ^= d[i]; h = Math.imul(h, 16777619); } return c.width + 'x' + c.height + ':' + (h >>> 0); };
`;
const settle = (page, ms = 150) => page.waitForTimeout(ms);
const margins = (page) => page.evaluate(() => ({ btm: +gv('m-btm'), right: +gv('m-right'), left: +gv('m-left'), top: +gv('m-top'), H: canvasLogicalH, W: canvasLogicalW }));

// A 2 × 2 of pseudocoloured panels: four names in the key.
async function keyedGrid(page, n = 4) {
  await page.evaluate(HELPERS);
  await seedPanels(page, n);
  await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange();
    images.forEach((im, i) => { im.lut = ['green', 'magenta', 'blue', 'red'][i % 4]; }); render();
  });
}

// ── newcomer5-02 / phage5-05: reopening a session regrew the key's margin ─────────────
test('newcomer5-02/phage5-05: a session with a key placed Below reopens in a fresh page exactly as saved, pixel for pixel', async ({ page, browser }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(() => { sv('export-width-mm', '89'); render(); sv('key-where', 'bottom'); setKeyOnFigure(true); });
  await settle(page);
  const a = await margins(page);
  expect(a.btm).toBeGreaterThan(16);                               // the key took a strip below
  const saved = await page.evaluate(() => { const c = renderExportCanvas(150); return { S: JSON.stringify(serializeSession(true)), hash: __hash(c) }; });
  // Reload: a new page, as the tester did (the first render there has no canvas width yet)
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors2 = await loadApp(p2);
  await p2.evaluate(HELPERS);
  await p2.evaluate((S) => { applySession(JSON.parse(S), { origin: 'file' }); }, saved.S);
  await p2.waitForFunction(() => images.length === 4 && images.every(im => im && im.img && im.img.complete));
  await settle(p2, 400);
  const b = await margins(p2);
  expect(b.btm).toBe(a.btm);
  expect(b.H).toBe(a.H);
  expect(await p2.evaluate(() => __toast())).not.toMatch(/margin grew/);
  expect(await p2.evaluate(() => __hash(renderExportCanvas(150)))).toBe(saved.hash);
  await p2.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test('newcomer5-02: a session saved with a margin the old build regrew opens with the room the key needs', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(() => { sv('key-where', 'bottom'); setKeyOnFigure(true); });
  await settle(page);
  const a = await margins(page);
  // as the round-5 build saved it: the bottom margin regrown at the reload, still marked the key's
  const S = await page.evaluate(() => { const s = serializeSession(true); const k = s.annotations.find(x => x.type === 'legend');
    s.layout.mBtm = String(+s.layout.mBtm + 47); k._grown = { 'm-btm': { from: 16, to: +s.layout.mBtm } }; return JSON.stringify(s); });
  await page.evaluate((S) => { applySession(JSON.parse(S), { origin: 'file' }); }, S);
  await page.waitForFunction(() => images.length === 4 && images.every(im => im && im.img && im.img.complete));
  await settle(page, 300);
  expect((await margins(page)).btm).toBe(a.btm);
  expect(errors).toEqual([]);
});

// ── blot5-09: a margin grown at a narrow width stayed grown after widening ────────────
test('blot5-09: a margin the key grew at 85 mm comes back when the figure is widened again', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  // what a fresh placement at 178 mm takes
  await page.evaluate(() => { sv('export-width-mm', '177.8'); render(); setKeyOnFigure(true); });
  await settle(page);
  const fresh = await margins(page);
  await page.evaluate(() => { setKeyOnFigure(false); });
  await settle(page);
  // the tester's way: placed at 85 mm, then widened back to 178 mm
  await page.evaluate(() => { sv('export-width-mm', '85'); render(); setKeyOnFigure(true); });
  await settle(page);
  const narrow = await margins(page);
  expect(narrow.right + narrow.btm).toBeGreaterThan(fresh.right + fresh.btm);   // more room at 85 mm
  await page.evaluate(() => { const s = document.getElementById('export-width-mm'); s._wasMm = _physFacts().wMm; sv('export-width-mm', '177.8'); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(page);
  const wide = await margins(page);
  expect(wide.right).toBe(fresh.right);
  expect(wide.btm).toBe(fresh.btm);
  // and nothing creeps on further renders
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) { render(); await new Promise(r => setTimeout(r, 20)); } });
  expect(await margins(page)).toEqual(wide);
  expect(errors).toEqual([]);
});

// ── newcomer4-04 / newcomer5-06: the key lines up with the panels; Balance names changes ─
test('newcomer4-04: a key in the strip under a full grid starts at the panels\' left edge, not the canvas edge', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(() => { sv('m-left', '60'); onLayoutChange(); render(); setKeyOnFigure(true); });
  await settle(page);
  const r = await page.evaluate(() => { const k = annotations.find(a => a.type === 'legend');
    const px = Math.min(...panelBounds.filter(b => images[b.idx]).map(b => b.x)), pb = Math.max(...panelBounds.map(b => b.y + b.h)), pr = Math.max(...panelBounds.map(b => b.x + b.w));
    const pt = Math.min(...panelBounds.map(b => b.y)), kh = k._h;
    return { kx: k.xf * canvasLogicalW, ky: k.yf * canvasLogicalH, kw: k._w, kh, px, pb, pr, pt }; });
  // in a strip beside or under the panel block, aligned with its edge
  if (r.ky >= r.pb - 1) expect(Math.abs(r.kx - r.px) < 1 || Math.abs(r.kx + r.kw - r.pr) < 1).toBe(true);
  else { expect(r.kx).toBeGreaterThanOrEqual(r.pr - 1); expect(Math.abs(r.ky - r.pt) < 1 || Math.abs(r.ky + r.kh - r.pb) < 1).toBe(true); }
  expect(errors).toEqual([]);
});

test('newcomer5-06: Balance margins names only the margins it changed', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(() => { sv('m-left', '16'); sv('m-right', '16'); sv('m-top', '90'); sv('m-btm', '16'); onLayoutChange(); render(); _ckBalanceMargins(); });
  const t = await page.evaluate(() => __toast());
  expect(t).toMatch(/Margins balanced: top 90 → \d+ px/);
  expect(t).not.toMatch(/left 16 → 16/);
  expect(errors).toEqual([]);
});

// ── freeform5-01 / freeform5-08: Raise to 6 pt grew a label past the canvas edge ──────
async function ffLabelFigure(page, x) {
  await page.evaluate(HELPERS);
  await seedFreeform(page, [
    { type: 'image', x: 20, y: 20, w: 440, h: 440, label: 'A', fill: '#334455' },
    { type: 'image', x: 480, y: 20, w: 458, h: 440, label: 'B', fill: '#334455' }]);
  await page.evaluate((x) => {
    sv('fm-canvas-w', '958'); sv('fm-canvas-h', '500'); render();
    annotations.push({ type: 'text', xf: x / 958, yf: 400 / 500, text: 'Δ*nosZ* in soil, 10^{8} CFU g^{-1}', fontSize: 16, color: '#ffffff' });
    sv('export-width-mm', '89'); render();
  }, x);
}
test('freeform5-01: Raise to 6 pt keeps a label inside the canvas, and the PDF holds the whole unit', async ({ page }) => {
  const errors = await loadApp(page);
  await ffLabelFigure(page, 700);
  // Check › Text size › Raise to 6 pt, through the report's own button
  await page.evaluate(() => checkCompliance());
  const row = page.locator('#info-modal-bg .compliance-row', { hasText: 'Text size' }).first();
  await row.getByRole('button', { name: 'Raise to 6 pt' }).click();
  const r = await page.evaluate(async () => {
    const a = annotations[0], mc = _rtMc(); mc.font = _annTextFont(a);
    const w = _rtMeasure(mc, a.text), W = canvasLogicalW;
    const d = await _captureDownload(() => _exportPDFWithText('f', 300, { lossless: true }), 'pdf');
    let pdf = ''; for (const c of d.data) pdf += String.fromCharCode(c);
    const pageW = +/MediaBox\s*\[0 0 ([\d.]+)/.exec(pdf)[1];
    const m = /1 0 0 1 ([\d.]+) [\d.]+ Tm \/F\d [\d.]+ Tf [^]*?\(nosZ\)/.exec(pdf);
    return { right: a.xf * W + w, W, toast: __toast(), pageW, x0: m ? +m[1] : null, wPt: w * pageW / W };
  });
  expect(r.right).toBeLessThanOrEqual(r.W);
  expect(r.toast).toMatch(/moved \d+ px left to stay inside the figure/);
  // freeform5-08: the whole label is quoted, at the size the report gives
  expect(r.toast).toContain('“ΔnosZ in soil, 10⁸ CFU g⁻¹”');
  expect(r.toast).toMatch(/to 7\.2 pt/);
  expect(r.x0).not.toBeNull();
  expect(r.x0 + r.wPt).toBeLessThanOrEqual(r.pageW + 0.01);          // the "⁻¹" is on the page
  const rep = await page.evaluate(() => ({ size: __row('Text size'), edge: __row('Text past the edge') }));
  expect(rep.size.text).toMatch(/7\.2 pt/);
  expect(rep.edge).toBeNull();
  expect(errors).toEqual([]);
});

test('freeform5-01: text that runs past the edge fails Text size, gets a "Text past the edge" row and the Save dialog line, and Move inside fixes it', async ({ page }) => {
  const errors = await loadApp(page);
  await ffLabelFigure(page, 700);
  await page.evaluate(() => { annotations[0].fontSize = 28; render(); });
  const rep = await page.evaluate(() => ({ size: __row('Text size'), edge: __row('Text past the edge') }));
  expect(rep.size.icon).not.toBe('✓');
  expect(rep.size.text).toMatch(/runs past the figure’s edge/);
  expect(rep.edge.icon).toBe('⚠');
  expect(rep.edge.text).toMatch(/runs \d+ px past the figure’s right edge/);
  await page.evaluate(() => doExportPreflight('png'));
  const body = page.locator('#preflight-body');
  await expect(body).toContainText('Text past the edge');
  await body.getByRole('button', { name: 'Move inside' }).click();
  await expect(body).not.toContainText('Text past the edge');
  expect(await page.evaluate(() => _ckTextOffEdge().length)).toBe(0);
  expect(errors).toEqual([]);
});

// ── freeform5-04: Relabel lettered an inserted icon ──────────────────────────────────
test('freeform5-04: Relabel letters pictures, charts and gene maps, not an inserted icon', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [
    { type: 'image', x: 20, y: 20, w: 200, h: 200, label: '' },
    { type: 'image', x: 240, y: 20, w: 200, h: 200, label: '' }]);
  await page.evaluate(async () => { insertIcon('bacterium'); await new Promise(r => setTimeout(r, 400)); });
  await page.waitForFunction(() => freeformElements.some(e => e.isIcon));
  await page.evaluate(() => { const ic = freeformElements.find(e => e.isIcon); ic.x = 500; ic.y = 20; render(); });
  await page.locator('button', { hasText: 'Relabel A, B, C…' }).filter({ visible: true }).first().click();
  const r = await page.evaluate(() => ({ icon: freeformElements.find(e => e.isIcon).label, pics: freeformElements.filter(e => !e.isIcon).map(e => e.label) }));
  expect(r.pics).toEqual(['A', 'B']);
  expect(r.icon).toBe('');
  expect(errors).toEqual([]);
});

// ── freeform5-09: a new icon landed past the bottom of a canvas just set by ⌘K ─────────
test('freeform5-09: after ✕ New and ⌘K graphical abstract, an inserted icon lands inside the 1328 × 531 canvas', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 6);
  await page.evaluate(() => { sv('cols', '2'); sv('rows', '3'); onLayoutChange(); render(); });
  await page.evaluate(() => { confirmNewFigure(); document.getElementById('cm-ok').click(); applyDeliverable('graphicalAbstract'); });
  await page.evaluate(async () => { insertIcon('phage'); await new Promise(r => setTimeout(r, 400)); });
  await page.waitForFunction(() => freeformElements.some(e => e.isIcon));
  const r = await page.evaluate(() => { const e = freeformElements.find(x => x.isIcon); return { x: e.x, y: e.y, w: e.w, h: e.h, W: +gv('fm-canvas-w'), H: +gv('fm-canvas-h') }; });
  expect(r.W).toBe(1328); expect(r.H).toBe(531);
  expect(r.y + r.h).toBeLessThanOrEqual(r.H);
  expect(r.x + r.w).toBeLessThanOrEqual(r.W);
  expect(errors).toEqual([]);
});

// ── freeform5-07 / newcomer5-07: the recovery bar outlived the session it offered ──────
async function withAutosave(page) {
  await keyedGrid(page);
  const S = await page.evaluate(() => { autosaveNow(); return JSON.stringify(serializeSession(true)); });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate(HELPERS);
  return S;
}
test('freeform5-07: the recovery bar goes when a session is opened, on ✕ New and on an edit — and stays until then', async ({ page }) => {
  const errors = await loadApp(page);
  const S = await withAutosave(page);
  const bar = page.locator('div', { hasText: /Recover unsaved session/ }).filter({ has: page.locator('.btn-primary') }).last();
  const gone = () => page.waitForFunction(() => !document.body.innerText.includes('Recover unsaved session'), null, { timeout: 5000 });
  await expect(bar).toContainText('Recover unsaved session');
  await page.waitForTimeout(1500);
  await expect(bar).toBeVisible();                                   // nothing at start-up takes it away
  await page.evaluate((S) => applySession(JSON.parse(S), { origin: 'file' }), S);
  await gone();
  // after New
  await page.evaluate(() => autosaveNow()); await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  await expect(bar).toBeVisible();
  await page.evaluate(() => { confirmNewFigure(); document.getElementById('cm-ok').click(); });
  await gone();
  // after an edit (a layout change)
  await page.evaluate((S) => { applySession(JSON.parse(S), { origin: 'file' }); autosaveNow(); }, S);
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  await expect(bar).toBeVisible();
  await page.evaluate(() => { pushUndo(); sv('gap-h', '12'); onLayoutChange(); });
  await gone();
  expect(errors).toEqual([]);
});

test('newcomer5-07: on a 390 px phone the recovery bar sits above the figure, not over the start screen\'s buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await loadApp(page);
  await withAutosave(page);
  await page.evaluate(() => { confirmNewFigure(); document.getElementById('cm-ok').click(); autosaveNow(); });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  const bar = page.locator('div', { hasText: /Recover unsaved session/ }).filter({ has: page.locator('.btn-primary') }).last();
  await expect(bar).toBeVisible();
  const r = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].filter(d => /Recover unsaved session/.test(d.textContent) && d.querySelector('.btn-primary')).pop();
    const b = el.getBoundingClientRect();
    const btns = [...document.querySelectorAll('button')].filter(x => /Load a session|Tutorials/.test(x.textContent) && x.offsetParent);
    const hit = btns.map(x => { const q = x.getBoundingClientRect(); const cx = q.left + q.width / 2, cy = q.top + q.height / 2;
      const top = document.elementFromPoint(cx, cy); return { t: x.textContent.trim(), covered: !!(top && el.contains(top)) }; });
    return { docW: document.documentElement.scrollWidth, right: b.right, hit };
  });
  expect(r.docW).toBeLessThanOrEqual(390);
  expect(r.right).toBeLessThanOrEqual(390);
  r.hit.forEach(h => expect(h.covered, h.t).toBe(false));
  expect(errors).toEqual([]);
});

// ── freeform5-10 / fluor5-10: the previous figure's export counted for the new one ────
test('freeform5-10: after ✕ New the Export format row says the new figure is not exported yet', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(async () => { sv('target-journal', 'asm'); if (typeof onTargetJournalChange === 'function') onTargetJournalChange();
    await _captureDownload(() => doExport('pdf-lossless'), 'pdf'); });
  expect(await page.evaluate(() => _lastExportFmt)).toBe('pdf-lossless');
  await page.evaluate(() => { confirmNewFigure(); document.getElementById('cm-ok').click(); });
  await seedPanels(page, 2);
  const row = await page.evaluate(() => { sv('target-journal', 'asm'); return __row('Export format'); });
  expect(row.text).toMatch(/not exported yet/);
  expect(row.text).not.toMatch(/changed after it was last exported/);
  expect(errors).toEqual([]);
});

// ── Gene maps: phage5-02 (one scale), phage5-06 (labels), phage5-07 (row height), phage5-09 (region) ──
const fsx = require('fs'), pathx = require('path');
const GB = (n) => fsx.readFileSync(pathx.join(__dirname, 'fixtures', 'ux5', n), 'utf8');
// Pictures, then each GenBank file dropped as a gene-map panel (the drop path).
async function mapGrid(page, files, { pics = 2, cols = 2, rows = 2, width = 183 } = {}) {
  await page.evaluate(HELPERS);
  if (pics) await seedPanels(page, pics);
  for (const [name, txt] of files) {
    await page.evaluate(async ([name, txt]) => { await addFiles([new File([txt], name, { type: 'text/plain' })]); }, [name, txt]);
    await page.waitForFunction((n) => images.filter(p => p && p.type === 'genemap').length >= n, files.indexOf(files.find(f => f[0] === name)) + 1);
    await page.evaluate(() => { if (typeof closeGenemapModal === 'function') closeGenemapModal(); });
  }
  await page.evaluate(([c, r, w]) => { sv('cols', String(c)); sv('rows', String(r)); onLayoutChange(); sv('export-width-mm', String(w)); render(); }, [cols, rows, width]);
}
// What a map draws, with positions: its words and its lines.
const drawn = (page, idx) => page.evaluate((idx) => {
  const gm = images.filter(p => p && p.type === 'genemap')[idx], words = [], lines = [];
  _genemapDraw(gm, new Proxy({}, { get: (t, k) => k === 'text' ? ((str, x, y, font, ink, align, bl) => words.push({ str, x, y, font, align, bl }))
    : k === 'line' ? ((x1, y1, x2, y2) => lines.push([x1, y1, x2, y2])) : () => {} }));
  const mc = _rtMc();
  const box = words.map(t => { mc.font = t.font; const w = mc.measureText(t.str).width, fs = +/([\d.]+)px/.exec(t.font)[1];
    const x = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x, y = t.bl === 'alphabetic' ? t.y - fs * 0.8 : t.y;
    return { str: t.str, x, y, w, h: fs }; });
  return { box, lines, w: gm.w, h: gm.h, names: (gm.map.features || []).map(f => f.name) };
}, idx);
const overlaps = (B, names) => { const L = B.filter(b => names.includes(b.str)), out = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], c = L[j];
    if (a.x < c.x + c.w - 0.5 && c.x < a.x + a.w - 0.5 && a.y < c.y + c.h * 0.9 && c.y < a.y + a.h * 0.9) out.push(`${a.str}/${c.str}`); }
  return out; };

test('phage5-06: a whole-genome map in one cell gives every label a row of its own; one with no room is named by the check', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_complete_genome.gb', GB('Tq4_complete_genome_features.gb')]]);
  const d = await drawn(page, 0);
  expect(d.box.length).toBeGreaterThan(20);
  expect(overlaps(d.box, d.names)).toEqual([]);                     // was hc1/hc2/mtp and rec/ad1/rpo
  expect(await page.evaluate(() => __row('Text over text'))).toBeNull();
  // a panel too short for the rows its labels need: drawn as well as it can be, and said
  await page.evaluate(() => { sv('panel-h', '90'); onLayoutChange(); render(); });
  const row = await page.evaluate(() => __row('Text over text'));
  expect(row && row.icon).toBe('⚠');
  expect(row.text).toMatch(/gene map C: .* overprint other labels/);
  expect(errors).toEqual([]);
});

test('phage5-02: "same scale as the other gene maps" draws two genomes at one bp per mm, and the caption says so', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_complete_genome.gb', GB('Tq4_complete_genome_features.gb')], ['Rw9_complete_genome.gb', GB('Rw9_complete_genome_features.gb')]], { pics: 0, cols: 1, rows: 2 });
  // Gene map dialog › same scale, Apply
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'genemap')));
  await page.locator('#gm-samescale').check();
  await page.locator('#genemap-modal').getByRole('button', { name: 'Apply' }).click();
  await page.evaluate(() => render());
  const r = await page.evaluate(() => images.filter(p => p && p.type === 'genemap').map(g => g.map.length));
  const a = await drawn(page, 0), b = await drawn(page, 1);
  const bb = d => { const l = d.lines[0]; return l[2] - l[0]; };                 // the backbone
  // the same bp per pixel: backbone lengths in the ratio of the genome lengths
  expect(bb(a) / bb(b)).toBeCloseTo(r[0] / r[1], 2);
  expect(Math.max(bb(a), bb(b))).toBeGreaterThan(Math.min(a.w, b.w) * 0.6);      // the longer still fills its panel
  const cap = await page.evaluate(() => _captionText());
  expect(cap).toMatch(/Drawn to the same scale as \([AB]\)/);
  expect(errors).toEqual([]);
});

test('phage5-09: a region From/To cuts a genome map inside FigureLab; the ruler counts in genome positions and the caption says which', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_complete_genome.gb', GB('Tq4_complete_genome_features.gb')]], { pics: 0, cols: 1, rows: 1 });
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'genemap')));
  await page.locator('#gm-from').fill('8088'); await page.locator('#gm-to').fill('21310');
  await page.locator('#genemap-modal').getByRole('button', { name: 'Apply' }).click();
  await page.evaluate(() => render());
  const d = await drawn(page, 0);
  const nums = d.box.map(b => b.str).filter(s => /^[\d.]+( kb)?$/.test(s)).map(s => parseFloat(s));
  expect(Math.min(...nums)).toBeGreaterThanOrEqual(8);                            // ticks at 8 kb and up, not 0
  expect(Math.max(...nums)).toBeLessThanOrEqual(21.31);
  expect(d.box.map(b => b.str)).toContain('8,088–21,310 of 44,860 bp');
  const cap = await page.evaluate(() => _captionText());
  expect(cap).toMatch(/positions 8,088–21,310 of 44,860 bp/);
  expect(cap).not.toMatch(/\(44,860 bp\)/);
  expect(errors).toEqual([]);
});

test('phage5-07: with Rows hug their panels, a gene-map row takes the height its map needs, not the panel height', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_tail_region.gb', GB('Tq4_complete_genome_features.gb')]], { pics: 2, cols: 2, rows: 2 });
  await page.evaluate(() => { const g = images.find(p => p && p.type === 'genemap'); g.colSpan = 2; sc('auto-row-h', true); render(); });
  const r = await page.evaluate(() => { const b = panelBounds.find(b => images[b.idx] && images[b.idx].type === 'genemap'); return { h: b.h, ph: +gv('panel-h') }; });
  expect(r.h).toBeLessThan(r.ph * 0.8);
  const d = await drawn(page, 0);
  expect(overlaps(d.box, d.names)).toEqual([]);
  const yb = Math.max(...d.box.filter(b => d.names.includes(b.str)).map(b => b.y + b.h));
  expect(yb).toBeLessThanOrEqual(d.h);
  expect(errors).toEqual([]);
});

// ── phage5-08 / phage5-10 / phage5-11: plaque counts in the CSV and the caption ─────────
async function countedPlates(page) {
  await page.evaluate(HELPERS);
  await seedPanels(page, 2);
  await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    images[0].captionNote = 'vB_EcoS_Tq4 plaques on Δtsx (10⁻⁴ dilution).';
    const u = Math.sqrt(3086);   // µm per px
    measurements.push({ type: 'cellCount', label: 'Count 1', pid: images[0].id, panel: 'A', count: 40, fgPx: 29026, area: 1970656,
      areaUm: (29026 * 3086).toFixed(1), polarity: 'dark', roi: 'ellipse', threshold: 90, dia: { mean: 1.32, sd: 0.182, med: 1.3, unit: 'mm', values: [1.3, 1.4] } });
    measurements.push({ type: 'cellCount', label: 'Count 2', pid: images[1].id, panel: 'B', count: 30, fgPx: 9000, area: 1500000,
      areaUm: (9000 * 3086).toFixed(1), polarity: 'dark', roi: 'ellipse', threshold: 90, dia: { mean: 813, sd: 91.5, med: 800, unit: 'µm', values: [800, 826] } });
    render();
  });
}
test('phage5-08: in the Measurements CSV each area column is one quantity in one unit — the dish region and the plaques apart', async ({ page }) => {
  const errors = await loadApp(page);
  await countedPlates(page);
  const rows = await page.evaluate(() => _measurementsCSV().csv.split('\n').filter(l => !l.startsWith('#')).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, ''))));
  const H = rows[0], r = rows[1], col = n => r[H.indexOf(n)];
  expect(+col('Area px²')).toBe(1970656);
  expect(+col('Area µm²') / +col('Area px²')).toBeCloseTo(3086, 0);              // was 45 µm² per px
  expect(+col('Objects area px²')).toBe(29026);
  expect(+col('Objects area µm²') / +col('Objects area px²')).toBeCloseTo(3086, 0);
  expect(errors).toEqual([]);
});
test('phage5-10 / phage5-11: one unit for every plate\'s diameters in the caption, and no double full stop after a note', async ({ page }) => {
  const errors = await loadApp(page);
  await countedPlates(page);
  const cap = await page.evaluate(() => _captionText());
  expect(cap).toMatch(/equivalent diameter 1\.32 ± 0\.182 mm/);
  expect(cap).toMatch(/equivalent diameter 0\.813 ± 0\.0915 mm/);                // was 813 ± 91.5 µm
  expect(cap).not.toMatch(/µm \(mean/);
  expect(cap).toContain('(10⁻⁴ dilution).');
  expect(cap).not.toContain('dilution)..');
  expect(errors).toEqual([]);
});

// ── phage5-14: a second span change that pushes more panels out says so ────────────────
test('phage5-14: Col span 2 then Row span 2 — the toast counts the three panels that lost their cell', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', '2'); sv('rows', '2'); onLayoutChange(); render(); images[0].colSpan = 2; render(); });
  expect(await page.evaluate(() => __toast())).toMatch(/1 panel \(D\) has no cell/);
  await page.evaluate(() => { images[0].rowSpan = 2; render(); });
  const t = await page.evaluate(() => __toast());
  expect(t).toMatch(/3 panels \(B, C, D\) have no cell in the 2 × 2 grid/);
  expect(errors).toEqual([]);
});

// ── phage5-15: Text to 7.5 pt left the letters at 7 pt ─────────────────────────────────
test('phage5-15: "Text to … pt" brings the panel letters up with the text', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 300, h: 300, label: 'A' }]);
  await page.evaluate(() => {
    sv('fm-canvas-w', '700'); sv('fm-canvas-h', '360'); render();
    addChartElement('bar'); closeChartModal();
    const el = freeformElements[freeformElements.length - 1];
    el.chart.data = { columns: ['strain', 'CFU'], rows: [['WT', 3], ['Δtsx', 5]], source: 'demo', sourceName: '' };
    el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1]; el.chart.axes.y.title = 'CFU mL^{-1}';
    el.x = 340; el.y = 20; el.w = 340; el.h = 300; el.letter = 'B'; el._chartKey = ''; el._chartStat = null;
    sv('export-width-mm', '89'); sv('label-pt', '6'); sv('text-pt', '6'); render(); });
  const raise = await page.evaluate(() => { const k = _physFacts().ptPerPx, sc = _ckScriptLow(k, TEXT_PT_FLOOR);
    return sc && sc.raiseTo; });
  expect(raise).toBeGreaterThan(6);
  await page.evaluate(() => _journalFix('jscript'));
  const r = await page.evaluate(() => ({ text: +gv('text-pt'), letters: +gv('label-pt'), toast: __toast() }));
  expect(r.letters).toBeGreaterThanOrEqual(r.text - 0.05);
  expect(r.toast).toMatch(/panel letters 6 → [\d.]+ pt with it/);
  expect(errors).toEqual([]);
});

// ── freeform5-06: records with format marks; DisplayRange for a chart ─────────────────
const PKG = `
  window.__zip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl)), at = p + 30 + nl + el, raw = bytes.subarray(at, at + size);
      out.push({ name, data: (dv.getUint16(p + 8, true) === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : raw) });
      p = at + size;
    }
    return out;
  };
  window.__pkg = async () => { const z = await _captureDownload(() => exportSubmissionPackage()); const files = {};
    (await __zip(z.data)).forEach(e => { files[e.name] = new TextDecoder().decode(e.data); }); return files; };
`;
test('freeform5-06: metadata.csv writes caption notes as the caption prints them, and no 0–255 range for a gene map', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_complete_genome.gb', GB('Tq4_complete_genome_features.gb')]], { pics: 1, cols: 2, rows: 1 });
  await page.evaluate(() => { images[0].captionNote = 'Microcosm 14 d after N_{2}O amendment, *nosZ* reporter'; render(); });
  const csv = await page.evaluate(() => { let out = ''; const b = window.Blob; window.Blob = function (parts, o) { out += parts.join(''); return new b(parts, o); }; try { exportCSV(); } finally { window.Blob = b; } return out; });
  const lines = csv.split('\n');
  expect(lines[1]).toContain('N₂O amendment, nosZ reporter');
  expect(lines[1]).not.toContain('_{2}');
  const gm = lines.find(l => /Tq4_complete_genome\.gb/.test(l));
  expect(gm).toBeTruthy();
  expect(gm).not.toMatch(/0–255/);
  expect(errors).toEqual([]);
});

// ── newcomer5-11: the alt text quoting a stale caption is named in the README ──────────
test('newcomer5-11: when the edited caption is out of date, the alt text that quotes it is listed under CHECK THESE TEXTS too', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS); await page.evaluate(PKG);
  await seedPanels(page, 3);
  const f = await page.evaluate(async () => {
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); sv('export-name', 'Fig2');
    images[2].captionNote = 'Colony PCR'; images[1].captionNote = 'Swim plate'; render();
    generateCaption(); const box = document.getElementById('caption-out'); box.value += ' Edited by hand.';
    await generateAltText();
    // panels C and B swap places: the edited caption now describes the figure as it was
    const t = images[1]; images[1] = images[2]; images[2] = t; render();
    const files = await __pkg(); document.querySelectorAll('#info-modal-bg').forEach(n => n.remove()); return files;
  });
  expect(f['README.txt']).toContain('CHECK THESE TEXTS');
  expect(f['README.txt']).toContain('Fig2-caption.txt is your edited caption');
  expect(f['README.txt']).toMatch(/Fig2-alt\.txt is your alt text/);
  // the alt text quotes the generated caption, shortened as alt text is (fluor5-11)
  const short = await page.evaluate((c) => _altCaptionSummary(c), f['Fig2-caption-generated.txt'].trim());
  expect(f['Fig2-alt-generated.txt']).toContain('Caption, shortened: ' + short);
  expect(f['Fig2-alt-generated.txt']).not.toContain('Edited by hand.');
  expect(errors).toEqual([]);
});

// ── ISSUES (round 4): the key's place menu has a label on screen ───────────────────────
test('ISSUES: Export › Legend key shows a "Where" label beside its place menu', async ({ page }) => {
  const errors = await loadApp(page);
  const t = await page.evaluate(() => { const s = document.getElementById('key-where'); return s.labels && s.labels.length ? s.labels[0].textContent.trim() : ''; });
  expect(t).toBe('Where');
  expect(errors).toEqual([]);
});

test('newcomer5-02 (follow-up): a panel removed under a placed key gives the key\'s room back without hiding the removal toast and its Relabel button', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(() => { setKeyOnFigure(true); });
  await settle(page);
  const a = await margins(page);
  await page.evaluate(() => removePanelAt(0));
  await settle(page, 300);
  const b = await margins(page);
  expect(b.btm + b.right).toBeLessThan(a.btm + a.right);              // the freed cell holds the key now
  expect(await page.evaluate(() => __toast())).toMatch(/The letters now skip A/);
  expect(errors).toEqual([]);
});

test('phage5-02 (follow-up): a third map added later opens with "same scale" ticked, and its Apply keeps the first two sharing', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_complete_genome.gb', GB('Tq4_complete_genome_features.gb')], ['Rw9_complete_genome.gb', GB('Rw9_complete_genome_features.gb')]], { pics: 0, cols: 1, rows: 3 });
  await page.evaluate(() => openDataPanelEditor(images.findIndex(p => p && p.type === 'genemap')));
  await page.locator('#gm-samescale').check();
  await page.locator('#genemap-modal').getByRole('button', { name: 'Apply' }).click();
  await page.evaluate(async (t) => { await addFiles([new File([t], 'Tq4_again.gb', { type: 'text/plain' })]); }, GB('Tq4_complete_genome_features.gb'));
  await page.waitForFunction(() => images.filter(p => p && p.type === 'genemap').length === 3);
  await page.evaluate(() => { if (typeof closeGenemapModal === 'function') closeGenemapModal(); render();
    const G = images.map((p, i) => [p, i]).filter(([p]) => p && p.type === 'genemap'); openDataPanelEditor(G[2][1]); });
  await expect(page.locator('#gm-samescale')).toBeChecked();
  await page.locator('#genemap-modal').getByRole('button', { name: 'Apply' }).click();
  await page.evaluate(() => render());
  const r = await page.evaluate(() => images.filter(p => p && p.type === 'genemap').map(g => g.map.length));
  const a = await drawn(page, 0), b = await drawn(page, 1);
  const bb = d => { const l = d.lines[0]; return l[2] - l[0]; };
  expect(bb(a) / bb(b)).toBeCloseTo(r[0] / r[1], 2);
  expect(errors).toEqual([]);
});

test('phage5-09 (follow-up): the legend key of a map cut to a region keys only what the region shows', async ({ page }) => {
  const errors = await loadApp(page);
  await mapGrid(page, [['Tq4_complete_genome.gb', GB('Tq4_complete_genome_features.gb')]], { pics: 0, cols: 1, rows: 1 });
  const r = await page.evaluate(() => {
    const g = images.find(p => p && p.type === 'genemap');
    g.map.features.push({ name: 'pEarly', type: 'promoter', start: 100, end: 160, strand: 1 }); render();
    const before = _figureKey().map(k => k.name);
    g.map.region = { from: 8088, to: 21310 }; g._genemapCache = null; render();
    return { before, after: _figureKey().map(k => k.name) };
  });
  expect(r.before.some(n => /promoter/i.test(n))).toBe(true);
  expect(r.after.some(n => /promoter/i.test(n))).toBe(false);
  expect(errors).toEqual([]);
});

test('freeform4-08 (follow-up): a canvas the key grew is never given back under an object moved into that band', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 450, h: 678, label: 'A', iw: 300, ih: 200 },
    { type: 'image', x: 500, y: 20, w: 680, h: 678, label: 'B', iw: 300, ih: 200, fill: '#cc6633' }]);
  await page.evaluate(() => { sv('fm-canvas-w', '1200'); sv('fm-canvas-h', '700'); render();
    images.length = 0; freeformElements.forEach(e => { e.lut = 'green'; }); freeformElements[1].lut = 'magenta'; render();
    setKeyOnFigure(true); });
  await settle(page);
  const g = await page.evaluate(() => ({ w: +gv('fm-canvas-w'), grown: annotations.find(a => a.type === 'legend')._grown }));
  expect(g.w).toBeGreaterThan(1200);                                  // the key took a strip on the right
  // picture B moves right into that strip, then A shrinks so a free corner opens on the old canvas
  await page.evaluate((w) => { freeformElements[1].x = w - 690; render(); freeformElements[0].h = 300; render(); }, g.w);
  await settle(page, 300);
  const r = await page.evaluate(() => ({ W: +gv('fm-canvas-w'), right: freeformElements[1].x + freeformElements[1].w }));
  expect(r.W).toBeGreaterThanOrEqual(r.right);
  expect(errors).toEqual([]);
});

test('newcomer4-04 (under the panels): a key in the strip grown under a full column starts at panel A\'s left edge', async ({ page }) => {
  const errors = await loadApp(page);
  await keyedGrid(page);
  await page.evaluate(() => { sv('cols', '1'); sv('rows', '4'); sv('m-left', '60'); onLayoutChange(); render(); setKeyOnFigure(true); });
  await settle(page);
  const r = await page.evaluate(() => { const k = annotations.find(a => a.type === 'legend');
    const P = panelBounds.filter(b => images[b.idx]);
    return { kx: k.xf * canvasLogicalW, ky: k.yf * canvasLogicalH, px: Math.min(...P.map(b => b.x)), pb: Math.max(...P.map(b => b.y + b.h)) }; });
  expect(r.ky).toBeGreaterThanOrEqual(r.pb - 1);                         // under the panels
  expect(Math.abs(r.kx - r.px)).toBeLessThan(1);                         // was the canvas edge, 54 px to its left
  expect(errors).toEqual([]);
});
