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
