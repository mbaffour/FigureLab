// @ts-check
// "Rows hug their panels": empty cells, rounding, and every readout that still
// described the uniform grid instead of the rows the renderer draws.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

// A white blot with four dark lanes, committed through the real import path.
// Injected into the page as a string so each test can reuse it.
const BLOT = `window.__blot = (w, h, name) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#000';
  for (let i = 0; i < 4; i++) x.fillRect(w * (0.1 + i * 0.22), h * 0.3, w * 0.12, h * 0.3);
  const src = c.toDataURL('image/png');
  const img = new Image(); img.onload = () => { _commitImage(img, src, name); res(); }; img.src = src;
});`;

// The two-blot stack most tests share: a 600x180 blot over a 600x90 control in one
// 300-wide column. Contain-fitted at 300 wide they need exactly 90 and 45 px.
async function blotPair(page) {
  await page.evaluate(async (code) => {
    eval(code);
    await window.__blot(600, 180, 'target.png');
    await window.__blot(600, 90, 'loading.png');
    sv('cols', 1); sv('rows', 2); sv('panel-w', 300); sv('panel-h', 300); sv('gap-v', 4);
    onLayoutChange(); sc('auto-row-h', true); render();
  }, BLOT);
}

test('a ragged last row, or a row with an inserted blank, still hugs its panels', async ({ page }) => {
  // Without the fix autoRowHeights pinned every image-less cell to ph, so row 2 of
  // five blots in a 3 x 2 grid (two blots + one trailing empty cell) stayed 300 px
  // tall, and so did a row holding an inserted blank: both h assertions read 300.
  const errors = await loadApp(page);
  const r = await page.evaluate(async (code) => {
    eval(code);
    for (let i = 0; i < 5; i++) await window.__blot(600, 180, `blot${i}.png`);
    sv('cols', 3); sv('rows', 2); sv('panel-w', 300); sv('panel-h', 300); onLayoutChange(); render();
    const offH = canvasLogicalH, offGridH = gridGeom().gridH;
    sc('auto-row-h', true); render();
    const ragged = panelBounds.map(p => ({ idx: p.idx, h: p.h }));
    const raggedH = canvasLogicalH, raggedGridH = gridGeom().gridH;
    // an explicitly inserted blank in the FIRST row: five blots + one blank fill 3 x 2
    images.splice(1, 0, null); render();
    const blank = panelBounds.map(p => ({ idx: p.idx, h: p.h }));
    return { offH, ragged, raggedH, offGridH, raggedGridH, blank };
  }, BLOT);
  // 600x180 at 300 wide needs exactly 90 px; every cell of both rows hugs to it,
  // including the trailing empty cell (idx -1), which takes its row's height
  expect(r.ragged.map(c => c.h)).toEqual([90, 90, 90, 90, 90, 90]);
  expect(r.ragged[5].idx).toBe(-1);
  // two rows of 210 px dead space each are gone
  expect(r.offGridH - r.raggedGridH).toBe(2 * (300 - 90));
  expect(r.offH - r.raggedH).toBe(2 * (300 - 90));
  // the inserted blank is a real cell in row 1, and row 1 still hugs
  expect(r.blank[1].idx).toBe(1);
  expect(r.blank.map(c => c.h)).toEqual([90, 90, 90, 90, 90, 90]);
  expect(errors).toEqual([]);
});

test('a width-limited panel with a fractional fit keeps its full width when rows hug', async ({ page }) => {
  // By hand: 650x200 at 300 wide scales by 300/650 = 0.461538, so it needs
  // 200 x 0.461538 = 92.31 px. Math.round made the row 92; the draw loop's fit is
  // min(300/650, 92/200 = 0.46) = 0.46, height-limited, so the panel was drawn
  // round(650 x 0.46) = 299 px wide and centred 1 px in: iw 299, ix one pixel right
  // of its neighbour. Rounded up to 93 the fit stays 300/650 and iw is 300. The
  // 600x90 control needs exactly 45.000 px, and the 1e-6 keeps it at 45, not 46.
  const errors = await loadApp(page);
  const r = await page.evaluate(async (code) => {
    eval(code);
    await window.__blot(650, 200, 'odd.png');
    await window.__blot(600, 90, 'loading.png');
    sv('cols', 1); sv('rows', 2); sv('panel-w', 300); sv('panel-h', 300); onLayoutChange();
    sc('auto-row-h', true); render();
    return panelBounds.map(p => ({ x: p.x, w: p.w, h: p.h, ix: p.ix, iw: p.iw }));
  }, BLOT);
  expect(r[0].h).toBe(93);
  expect(r[1].h).toBe(45);
  expect(r[0].iw).toBe(300);
  expect(r[0].iw).toBe(r[0].w);
  // the two panels' lanes still register horizontally
  expect(r[0].ix).toBe(r[1].ix);
  expect(r[0].iw).toBe(r[1].iw);
  expect(errors).toEqual([]);
});

test('the status bar and compliance report give the row heights, not an array or the field', async ({ page }) => {
  // Without the fix the status bar interpolated the row array ("panel 300×90,45px")
  // and compliance read gi('panel-h') ("300×300 px per panel"), so the comma check
  // and both '90 / 45' checks fail.
  const errors = await loadApp(page);
  await blotPair(page);
  const r = await page.evaluate(() => {
    const status = document.getElementById('status-r').textContent;
    checkCompliance();
    const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')]
      .find(el => el.querySelector('.c-label').textContent === 'Min panel size');
    const note = row.querySelector('.c-note').textContent;
    const icon = row.querySelector('.c-icon').textContent;
    document.getElementById('info-modal-bg').remove();
    return { status, note, icon };
  });
  expect(r.status).not.toContain(',');
  expect(r.status).toContain('rows 90 / 45 px tall');
  expect(r.note).toContain('rows 90 / 45 px tall');
  expect(r.note).not.toContain('300×300');
  // a 45 px row is under the 80 px floor, which the field hid — but it is short
  // because its panel is, so hugging reports it as a warning, not a failure
  expect(r.icon).toBe('⚠');
  expect(errors).toEqual([]);
});

test('the deep figure audit says the rows hug their panels, not that they are uniform', async ({ page }) => {
  // Without the fix the audit read gi('panel-h') and passed "Grid panels uniform:
  // 300×300px" for rows of 90 and 45 px, so both assertions fail.
  const errors = await loadApp(page);
  await blotPair(page);
  const txt = await page.evaluate(() => {
    runAdvancedConsistency();
    const modals = document.querySelectorAll('.modal-bg.open');
    const m = modals[modals.length - 1];
    const t = m.textContent;
    m.remove();
    return t;
  });
  expect(txt).toContain('Grid rows hug their panels: 300 px wide, row heights 90 / 45 px');
  expect(txt).not.toContain('uniform: 300×300');
  expect(errors).toEqual([]);
});

test('the R and Python scripts rebuild the hugged rows, not uniform panel-height rows', async ({ page }) => {
  // Without the fix both scripts carried only PANEL_H = 300: there is no ROW_H in
  // either, and the Python figure height was ROWS*PANEL_H, so every toContain fails.
  const errors = await loadApp(page);
  await blotPair(page);
  const r = await page.evaluate(() => {
    const out = {};
    const realBlobUrl = window.blobUrl, realDl = window.dl;
    window.dl = () => {};
    try {
      window.blobUrl = t => { out.py = t; return 'blob:stub'; };
      exportPython();
      window.blobUrl = t => { out.R = t; return 'blob:stub'; };
      exportR();
    } finally { window.blobUrl = realBlobUrl; window.dl = realDl; }
    return out;
  });
  expect(r.py).toContain('ROW_H        = [90, 45]');
  expect(r.py).toContain('height_ratios=ROW_H');
  expect(r.py).toContain('(sum(ROW_H)+(ROWS-1)*GAP_V)/DPI');
  expect(r.py).toContain('process(Image.open(fpath),p,ROW_H[r])');
  expect(r.py).not.toContain('resize((PANEL_W,PANEL_H)');
  expect(r.R).toContain('ROW_H <- c(90,45)');
  expect(r.R).toContain('paste0(PANEL_W,"x",ROW_H[r]');
  expect(r.R).not.toContain('paste0(PANEL_W,"x",PANEL_H');
  // parens still balance in the R script
  expect((r.R.match(/\(/g) || []).length).toBe((r.R.match(/\)/g) || []).length);
  expect(errors).toEqual([]);
});

test('the palette command for hugging rows does nothing in freeform mode', async ({ page }) => {
  // Freeform has no rows, so rowHeights ignores the box there. Without the guard the
  // command still ticked it and pushed an undo step: both equalities fail.
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform');
    const cmd = CMD_REGISTRY.find(c => c.label.startsWith('Rows hug their panels'));
    const before = { on: gc('auto-row-h'), undo: undoStack.length };
    cmd.run();
    return { before, after: { on: gc('auto-row-h'), undo: undoStack.length },
             toast: document.getElementById('toast').textContent };
  });
  expect(r.before.on).toBe(false);
  expect(r.after.on).toBe(false);
  expect(r.after.undo).toBe(r.before.undo);
  expect(r.toast).toContain('applies to grid mode');
  expect(errors).toEqual([]);
});
