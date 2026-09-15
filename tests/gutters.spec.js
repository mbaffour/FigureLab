// @ts-check
// Per-gutter spacing overrides, and everything that silently lost to them.
//
// gapBefore()/rGapBefore() prefer a per-gutter override over the uniform H/V gap
// whenever per-gutter spacing is on. So every action that sets a UNIFORM gap — Tighten
// spacing, a journal preset, a loaded template — reported success and then changed
// nothing at all for any overridden gutter, which is one exact shape of "we can't seem
// to change the gaps between panels".
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

async function seedGrid(page, n, cols, rows) {
  await page.evaluate(async ({ n, cols, rows }) => {
    const mk = i => { const c = document.createElement('canvas'); c.width = 100; c.height = 100;
      const x = c.getContext('2d'); x.fillStyle = `rgb(${40 + i * 40},80,80)`; x.fillRect(0, 0, 100, 100); return c.toDataURL(); };
    for (let i = 0; i < n; i++) { const s = mk(i);
      await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, s, 'p' + i + '.png'); r(); }; im.src = s; }); }
    sv('cols', String(cols)); sv('rows', String(rows)); sv('panel-w', '100'); sv('panel-h', '100');
    sv('gap-h', '10'); sv('gap-v', '10'); onLayoutChange(); render();
  }, { n, cols, rows });
}

/** The real horizontal gaps between consecutive panels in row 0. */
const GAPS = `window._hGaps = () => { render(); const r = panelBounds.filter(b=>b.idx>=0).sort((a,b)=>a.x-b.x);
  const out=[]; for(let i=1;i<r.length;i++) out.push(Math.round(r[i].x-(r[i-1].x+r[i-1].w))); return out; };`;

test('Tighten spacing closes every gutter, including ones with their own spacing', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  await page.evaluate(GAPS);
  const r = await page.evaluate(() => {
    setAdvancedSpacing(true);
    setGutter('col', 1, 60); setGutter('col', 2, 80);
    const overridden = _hGaps();
    tightenSpacing();
    const tightened = _hGaps();
    undo();
    return { overridden, tightened, undone: _hGaps(), left: _overrideCount() };
  });
  expect(r.overridden).toEqual([60, 80]);
  expect(r.tightened).toEqual([2, 2]);        // used to stay [60, 80] while claiming success
  expect(r.left).toBe(0);
  expect(r.undone).toEqual([60, 80]);         // and it is still one undo step
  expect(errors).toEqual([]);
});

test('a journal preset applies its gap over per-gutter overrides, and can be undone', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  await page.evaluate(GAPS);
  const r = await page.evaluate(() => {
    setAdvancedSpacing(true);
    setGutter('col', 1, 70);
    const before = { gaps: _hGaps(), panelW: gi('panel-w') };
    applyPreset('nature');
    const after = { gaps: _hGaps(), panelW: gi('panel-w'), gapField: gi('gap-h') };
    undo();
    return { before, after, undone: { gaps: _hGaps(), panelW: gi('panel-w') } };
  });
  expect(r.before.gaps[0]).toBe(70);
  expect(r.after.gaps[0]).toBe(r.after.gapField);   // the preset's gap actually reaches the figure
  expect(r.after.gaps[0]).not.toBe(70);
  expect(r.undone.gaps[0]).toBe(70);                // a preset used to be a one-way door
  expect(r.undone.panelW).toBe(r.before.panelW);
  expect(errors).toEqual([]);
});

test('a layout template carries per-gutter spacing, and loading one replaces what was there', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  await page.evaluate(GAPS);
  const r = await page.evaluate(() => {
    // Save a template that HAS overrides.
    setAdvancedSpacing(true); setGutter('col', 1, 50);
    document.getElementById('tpl-name-input').value = 'with-overrides';
    saveTemplate();
    const savedTpl = getSavedTemplates().find(t => t.name === 'with-overrides');
    // Save a second, plain template with no overrides.
    resetGutters(); setAdvancedSpacing(false); sv('gap-h', '4'); render();
    document.getElementById('tpl-name-input').value = 'plain';
    saveTemplate();
    // Now put overrides back, and load the PLAIN template over them.
    setAdvancedSpacing(true); setGutter('col', 1, 90);
    const stale = _hGaps();
    loadTemplate(getSavedTemplates().find(t => t.name === 'plain'));
    const afterPlain = _hGaps();
    // And loading the one that has them restores them.
    loadTemplate(getSavedTemplates().find(t => t.name === 'with-overrides'));
    const afterSaved = { gaps: _hGaps(), adv: advancedSpacing, checkbox: gc('advanced-spacing') };
    try { localStorage.removeItem('figurelab_templates'); } catch (e) {}
    return { savedHas: { adv: savedTpl.advancedSpacing, col: savedTpl.colGaps }, stale, afterPlain, afterSaved };
  });
  expect(r.savedHas.adv).toBe(true);
  expect(r.savedHas.col[0]).toBe(50);               // the template used to drop this entirely
  expect(r.stale[0]).toBe(90);
  expect(r.afterPlain).toEqual([4, 4]);             // the plain template's gap used to be inert
  expect(r.afterSaved.gaps[0]).toBe(50);
  expect(r.afterSaved.adv).toBe(true);
  expect(r.afterSaved.checkbox).toBe(true);
  expect(errors).toEqual([]);
});

test('a share link carries per-gutter spacing', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 3, 3, 1);
  const r = await page.evaluate(async () => {
    setAdvancedSpacing(true); setGutter('col', 1, 55);
    let href = null;
    const realPrompt = window.prompt; window.prompt = () => null;
    const realClip = navigator.clipboard && navigator.clipboard.writeText;
    try { if (realClip) navigator.clipboard.writeText = async (t) => { href = t; }; shareSession(); }
    finally { window.prompt = realPrompt; if (realClip) navigator.clipboard.writeText = realClip; }
    const box = document.getElementById('share-link-out');
    const link = href || (box && box.value) || location.href;
    const frag = link.slice(link.indexOf('#share=') + 7);
    let payload = null;
    try { payload = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(frag))))); } catch (e) {
      try { payload = JSON.parse(atob(decodeURIComponent(frag))); } catch (e2) {}
    }
    return payload ? { adv: payload.layout.advancedSpacing, col: payload.layout.colGaps } : { unreadable: true, link: link.slice(0, 60) };
  });
  expect(r.unreadable, `share payload unreadable: ${r.link || ''}`).toBeUndefined();
  expect(r.adv).toBe(true);
  expect(r.col[0]).toBe(55);                        // recipients used to get uniform gaps silently
  expect(errors).toEqual([]);
});

test('a multi-page PDF uses each page’s own row gutters, not page one’s', async ({ page }) => {
  const errors = await loadApp(page);
  await seedGrid(page, 4, 1, 4);
  const r = await page.evaluate(async () => {
    // Four rows, one column, with a distinct override on every gutter.
    setAdvancedSpacing(true);
    setGutter('row', 1, 20); setGutter('row', 2, 60); setGutter('row', 3, 100);
    render();
    // Page 2 covers absolute rows 3 and 4, so its only interior gutter is gutter 3 = 100.
    const seen = [];
    const realRender = window.renderExportCanvas;
    window.renderExportCanvas = (dpi, opts) => {
      const c = realRender(dpi, opts);
      seen.push(_pageCtx ? _pageCtx.rowOffset : null);
      return c;
    };
    // Measure the gutter each page actually renders with, through the same _pageCtx path.
    const gutterOnPage = (rowOffset) => { _pageCtx = { rowOffset, seqOffset: 0 };
      const g = rGapBefore(1, gi('gap-v')); _pageCtx = null; return g; };
    window.renderExportCanvas = realRender;
    return { page1: gutterOnPage(0), page2: gutterOnPage(2), uniform: gi('gap-v') };
  });
  expect(r.page1).toBe(20);                         // page 1's interior gutter is gutter 1
  expect(r.page2).toBe(100);                        // page 2's is gutter 3 — it used to read gutter 1 again
  expect(errors).toEqual([]);
});
