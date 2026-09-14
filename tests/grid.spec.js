// @ts-check
// Empty grid cells and panel projections.
//
// A null in images[] is an empty cell. Ragged multi-crops and panel drags had been
// leaving them for a long time; "Insert blank cell" now makes one on purpose. Several
// paths assumed every slot was a panel — the caption and the session save threw, and
// the export drew the on-screen placeholder, dashed frame and number included.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('a blank cell is background in the export, a placeholder on screen, and a removable row in the list', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '2'); sv('bg-color', '#ffffff'); onLayoutChange();
    selectedPanel = 0;
    insertBlankCell();                                   // after panel A → slot 2
    const slot = images.indexOf(null);
    render();
    const pb = panelBounds.find(b => b.idx === slot);
    // On screen: the placeholder tint is there (not pure white).
    const on = document.getElementById('fig-canvas').getContext('2d').getImageData(Math.round(pb.x + 4), Math.round(pb.y + 4), 1, 1).data;
    // In the export: pure background.
    const c = renderExportCanvas(150); const k = c.width / canvasLogicalW;
    const ex = c.getContext('2d');
    const corner = ex.getImageData(Math.round((pb.x + 4) * k), Math.round((pb.y + 4) * k), 1, 1).data;
    const centre = ex.getImageData(Math.round((pb.x + pb.w / 2) * k), Math.round((pb.y + pb.h / 2) * k), 1, 1).data;
    const rows = [...document.querySelectorAll('#img-list .blank-slot span')].map(e => e.textContent.trim());
    document.querySelector('#img-list [data-delblank]').click();
    return { slot, on: [...on].slice(0, 3), corner: [...corner].slice(0, 3), centre: [...centre].slice(0, 3), rows,
             after: images.length, nulls: images.filter(im => im === null).length,
             logged: reproLog.some(e => e.action === 'insertBlankCell') };
  });
  expect(r.slot).toBe(1);
  expect(r.on).not.toEqual([255, 255, 255]);            // the editing aid, on screen only
  expect(r.corner).toEqual([255, 255, 255]);            // was a 4 % grey tint with a dashed frame
  expect(r.centre).toEqual([255, 255, 255]);            // where the ghost "2" was drawn
  expect(r.rows).toEqual(['▭ blank cell (slot 2)']);
  expect(r.after).toBe(3); expect(r.nulls).toBe(0);
  expect(r.logged).toBe(true);
  expect(errors).toEqual([]);
});

test('caption, session, R and Python exports survive an empty cell, and the session keeps its place', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);
  const r = await page.evaluate(async () => {
    sv('cols', '2'); sv('rows', '2'); onLayoutChange();
    images.splice(1, 0, null);
    const out = {};
    generateCaption(); out.caption = document.getElementById('caption-out').value;
    const s = JSON.parse(JSON.stringify(serializeSession(true)));
    out.saved = s.images.map(d => d === null ? null : d.label);
    let cap = null; const realDl = window.dl; window.dl = () => { cap = (cap || 0) + 1; };
    try { exportR(); exportPython(); } finally { window.dl = realDl; }
    out.scripts = cap;
    images.length = 0;
    applySession(s);
    await new Promise(r => setTimeout(r, 150));
    out.restored = images.map(im => im === null ? null : im.label);
    return out;
  });
  expect(r.caption).toContain('(A)'); expect(r.caption).toContain('(B)'); expect(r.caption).toContain('(C)');
  expect(r.saved).toEqual(['A', null, 'B', 'C']);
  expect(r.scripts).toBe(2);
  expect(r.restored).toEqual(['A', null, 'B', 'C']);
  expect(errors).toEqual([]);
});

test('max and mean projections of the ticked panels add a new panel with the right pixels and provenance', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 3);                             // greys 30, 70, 110 with a white marker
  const r = await page.evaluate(async () => {
    renderImgList();
    const picks = document.querySelectorAll('#img-list .panel-pick');
    picks[0].checked = true; picks[2].checked = true;    // A (30) and C (110)
    images[0].umPerPx = 0.5; images[0].lut = 'green';
    const px = (im, x, y) => { const c = document.createElement('canvas'); c.width = im.img.naturalWidth; c.height = im.img.naturalHeight;
      const x2 = c.getContext('2d'); x2.drawImage(im.img, 0, 0); return [...x2.getImageData(x, y, 1, 1).data].slice(0, 3); };
    projectTickedPanels('max');
    await new Promise(r => { const t = setInterval(() => { if (images.length === 4) { clearInterval(t); r(); } }, 20); });
    const mip = images[3];
    const maxPx = px(mip, 50, 50), maxMarker = px(mip, 15, 15);
    renderImgList();
    const picks2 = document.querySelectorAll('#img-list .panel-pick');
    picks2[0].checked = true; picks2[2].checked = true;
    projectTickedPanels('mean');
    await new Promise(r => { const t = setInterval(() => { if (images.length === 5) { clearInterval(t); r(); } }, 20); });
    const mean = images.find(im => im && /^mean_/.test(im.name));   // inserted after C, before the MIP
    return { maxPx, maxMarker, meanPx: px(mean, 50, 50), mipNote: mip.captionNote, mipLabel: mip.label,
             inherited: [mip.umPerPx, mip.lut], where: images.indexOf(mip), logged: reproLog.filter(e => e.action === 'projectPanels').length,
             count: images.length };
  });
  expect(r.maxPx).toEqual([110, 110, 110]);              // the brighter of 30 and 110
  expect(r.maxMarker).toEqual([255, 255, 255]);          // the shared white marker survives
  expect(r.meanPx).toEqual([70, 70, 70]);                // (30 + 110) / 2
  expect(r.mipNote).toMatch(/^Maximum intensity projection of 2 panels \(A, C\), on 8-bit display values$/);
  expect(r.inherited).toEqual([0.5, 'green']);           // calibration and LUT from the first ticked panel
  expect(r.where).toBe(4);                               // placed after C (index 3), then pushed to 4 by the mean
  expect(r.count).toBe(5);                               // the sources are kept
  expect(r.logged).toBe(2);
  expect(errors).toEqual([]);
});

test('a projection refuses panels of different sizes and fewer than two', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40);
    const src = c.toDataURL();
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'small.png'); res(); }; img.src = src; });
    renderImgList();
    const picks = document.querySelectorAll('#img-list .panel-pick');
    picks[0].checked = true; picks[2].checked = true;    // 100×100 and 60×40
    projectTickedPanels('max');
    await new Promise(r => setTimeout(r, 100));
    const mixed = images.length;
    picks[2].checked = false;
    projectTickedPanels('max');
    await new Promise(r => setTimeout(r, 100));
    return { mixed, one: images.length };
  });
  expect(r.mixed).toBe(3);
  expect(r.one).toBe(3);
  expect(errors).toEqual([]);
});
