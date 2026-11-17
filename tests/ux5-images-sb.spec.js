// @ts-check
// Usability round 5, group `images` (scale bars) — where FigureLab's bar and its label go on
// a picture, the colour they take on a light one, and the label of a bar burned into the
// picture. Each test is a round-5 finding (or a round-3/4 recheck still open), and each
// fails on the build the testers used (1cedb76).
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform } = require('./helpers');

test.use({ viewport: { width: 1440, height: 900 } });

const HELPERS = `
  window.__rows = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\\s+/g, ' ').trim(), fixes: [...e.querySelectorAll('button')].map(b => b.textContent.trim()) }));
  window.__close = () => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); };
  window.__row = (l) => { checkCompliance(); const r = __rows().find(r => r.label === l) || null; __close(); return r; };
  // A picture made in the page, committed as a grid panel through the real path.
  window.__addPic = async (name, w, h, paint) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
    const src = c.toDataURL('image/png');
    await new Promise(r => { const img = new Image(); img.onload = () => { _commitImage(img, src, name); r(); }; img.src = src; });
    render(); return images.length - 1;
  };
`;

// ── freeform5-05 (and the freeform4-06 recheck) ───────────────────────────────────────
test('freeform5-05: a scale-bar label wider than its bar stays inside a circle clip, and one that cannot fit is said', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  // The tester's abstract: a 1024-px picture at 0.1 µm/px in a 300-px circle, so the 10 µm
  // bar is 29 px long and its 8 pt label is far wider than that.
  await seedFreeform(page, [{ type: 'image', x: 40, y: 40, w: 300, h: 300, label: 'A', iw: 1024, ih: 1024, fill: '#203040' }]);
  const r = await page.evaluate(async () => {
    const el = freeformElements[0]; el.umPerPx = 0.1; el.sbOn = true; el.sbUm = 10; el.sbUnit = 'µm'; sc('sb-text', true);
    selectedElems.clear(); selectedElems.add(0); ffSetClip('circle');
    // a text size at which "10 µm" is about three times its bar
    for (let pt = 8; pt <= 48 && _figTextPx() < 30; pt += 2) { sv('text-pt', String(pt)); render(); }
    render();
    const f = _ffFurniture(el), T = f.sbText;
    const m = document.createElement('canvas').getContext('2d'); m.font = T.font; const tw = m.measureText(T.str).width;
    const R = el.w / 2, cx = el.x + R, cy = el.y + R, inC = (x, y) => Math.hypot(x - cx, y - cy) <= R + 0.01;
    const box = [[T.x - tw / 2, T.y - T.fs * 0.8], [T.x + tw / 2, T.y - T.fs * 0.8], [T.x - tw / 2, T.y], [T.x + tw / 2, T.y]];
    const bar = [[f.sb.x, f.sb.y], [f.sb.x + f.sb.w, f.sb.y + f.sb.h]];
    const out = { tw, barW: f.sb.w, labelIn: box.every(([x, y]) => inC(x, y)), barIn: bar.every(([x, y]) => inC(x, y)),
      centred: Math.abs((f.sb.x + f.sb.w / 2) - T.x) < 0.01 };
    // A label wider than the clip leaves room for: no bar, and the check says why.
    el.w = el.h = 110; render();
    out.big = { skip: el._sbSkip || '', row: __row('Scale bar drawn') };
    return out;
  });
  expect(r.tw).toBeGreaterThan(r.barW * 1.8);         // the case the tester met
  expect(r.barIn).toBe(true);
  expect(r.labelIn).toBe(true);                         // it ran past the circle: "10 µ" + half an m
  expect(r.centred).toBe(true);                         // the bar stays under its label
  expect(r.big.skip).toMatch(/label “10 µm” is wider than the circle clip/);
  expect(r.big.row.icon).toBe('✗');
  expect(r.big.row.text).toMatch(/wider than the circle clip/);
  expect(errors).toEqual([]);
});

// ── phage5-16 ─────────────────────────────────────────────────────────────────────────
test('phage5-16: a scale-bar label wider than its bar keeps the bar’s inset from the panel’s right edge', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const i = await __addPic('tem.png', 2048, 1600, (x, w, h) => { x.fillStyle = '#303030'; x.fillRect(0, 0, w, h); });
    const im = images[i]; im.umPerPx = 0.000619195; im.sbOn = true; im.sbUm = 0.05; im.sbUnit = 'nm'; im.sbCorner = 'br';
    sv('cols', '3'); sv('rows', '1'); onLayoutChange(); render();
    const t = figTextItems.find(t => t.kind === 'sb' && t.idx === i), rc = im._sbRect;
    const m = document.createElement('canvas').getContext('2d'); m.font = t.font; const tw = m.measureText(_rtText(t.str)).width;
    const b = panelBounds.find(p => p.idx === i);
    return { str: t.str, tw, barW: rc.w, labelRight: t.x + tw / 2, barRight: rc.x + rc.w, panelRight: b.x + b.w };
  });
  expect(r.str).toBe('50 nm');
  expect(r.tw).toBeGreaterThan(r.barW);
  const inset = r.panelRight - r.barRight;
  expect(inset).toBeGreaterThan(4);
  // the label ends where the bar ends (the bar's inset), not 2 px from the edge
  expect(r.labelRight).toBeLessThanOrEqual(r.barRight + 0.5);
  expect(r.panelRight - r.labelRight).toBeGreaterThanOrEqual(inset - 0.5);
  expect(errors).toEqual([]);
});

// ── phage3-05 (recheck, still partly) ─────────────────────────────────────────────────
test('phage3-05: Auto corner keeps a white bar off a white ruler sticker when the ruler’s length was typed', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    // A dark plate photo with a white ruler sticker in the bottom right corner.
    const i = await __addPic('IMG_4410.jpg', 2000, 1500, (x, w, h) => {
      x.fillStyle = '#262626'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#c8b88a'; x.beginPath(); x.arc(820, 760, 674, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffffff'; x.fillRect(1540, 1380, 380, 90);
      x.fillStyle = '#000'; for (let k = 0; k <= 20; k++) x.fillRect(1560 + k * 15.5, 1430, 2, k % 10 ? 18 : 34);
    });
    const im = images[i];
    // 🔬 Calibrate from image with the pixels typed (310 px = 20 mm): no points, no sbAvoid
    im.umPerPx = 20000 / 310; im._calibHow = { at: new Date().toISOString(), um: im.umPerPx, kind: 'measured', how: 'measured on the image (310 px = 20 mm)' };
    _afterCalibration(im); im.sbUm = 20000; im.sbUnit = 'mm';
    sv('cols', '1'); sv('rows', '1'); onLayoutChange(); render();
    const rc = im._sbRect, c = document.getElementById('fig-canvas'), S = c.width / canvasLogicalW;
    // what is under the bar in the drawn figure, just above it (the bar's own pixels are white)
    const d = c.getContext('2d').getImageData(Math.round(rc.x * S), Math.round((rc.y - 6) * S), Math.round(rc.w * S), 2).data;
    let sum = 0, n = 0; for (let k = 0; k < d.length; k += 4) { sum += (d[k] + d[k + 1] + d[k + 2]) / 3; n++; }
    return { corner: im._sbCornerUsed, sbAvoid: !!im.sbAvoid, under: sum / n, ink: rc.ink };
  });
  expect(r.sbAvoid).toBe(false);
  expect(r.corner).not.toBe('br');           // it was drawn on the sticker
  expect(r.ink.toLowerCase()).toBe('#ffffff');
  expect(r.under).toBeLessThan(120);         // on the dark surround, where white reads
  expect(errors).toEqual([]);
});

// ── newcomer4-03 (recheck, not fixed) ─────────────────────────────────────────────────
test('newcomer4-03: the first calibration of a light micrograph switches Auto contrast on, so the bar text is not white on white', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(async () => {
    await __addPic('WT_gram_100x_01.jpg', 1600, 1200, (x, w, h) => {
      x.fillStyle = '#e6e1d6'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#c84a78'; for (let k = 0; k < 30; k++) x.fillRect((k * 397) % 1500, (k * 211) % 1100, 60, 14);
    });
  });
  // ⚙ › µm / px typed, as a user calibrates by hand
  await page.locator('#img-list [data-gear]').first().click();
  const f = page.locator('#img-list .f-umppx').first();
  await f.fill('0.065'); await f.press('Enter'); await f.blur();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => { render();
    const t = figTextItems.find(t => t.kind === 'sb');
    return { auto: gc('sb-auto-color'), toast: document.getElementById('toast').textContent, fill: t && t.fill,
      contrast: __row('Text contrast') };
  });
  expect(r.auto).toBe(true);
  expect(r.toast).toMatch(/Auto contrast is on/);
  expect(r.fill).not.toBe('#ffffff');
  if (r.contrast) expect(r.contrast.text).not.toMatch(/scale-bar text “10 µm” \(#ffffff\)/);
  // a dark fluorescence picture calibrated next keeps its white bar
  const dark = await page.evaluate(async () => {
    const i = await __addPic('GFP.png', 800, 600, (x, w, h) => { x.fillStyle = '#050505'; x.fillRect(0, 0, w, h); });
    const im = images[i]; im.umPerPx = 0.1; _afterCalibration(im); sv('cols', '2'); onLayoutChange(); render();
    return im._sbRect && im._sbRect.ink;
  });
  expect(String(dark).toLowerCase()).toBe('#ffffff');
  // a colour the user picks is left alone
  const kept = await page.evaluate(async () => {
    const cb = document.getElementById('sb-auto-color'); cb.checked = false; cb.dispatchEvent(new Event('change'));
    const i = await __addPic('DIC.png', 800, 600, (x, w, h) => { x.fillStyle = '#d8d8d8'; x.fillRect(0, 0, w, h); });
    const im = images[i]; im.umPerPx = 0.1; return { note: _afterCalibration(im), auto: gc('sb-auto-color') };
  });
  expect(kept.auto).toBe(false);
  expect(kept.note).not.toMatch(/Auto contrast/);
  expect(errors).toEqual([]);
});

// ── newcomer5-10 ──────────────────────────────────────────────────────────────────────
test('newcomer5-10: a kept burned-in bar whose label prints at about 3 pt is named on Text size, with a button to draw FigureLab’s bar instead', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    // The tester's Gram stain: 1600 px wide, a black 10 µm bar of 154 px, its label drawn
    // by the microscope 38 px high above it.
    const i = await __addPic('WT_gram_100x_01.jpg', 1600, 1200, (x, w, h) => {
      x.fillStyle = '#e6e1d6'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#c84a78'; for (let k = 0; k < 12; k++) x.fillRect(100 + (k * 97) % 900, 80 + (k * 131) % 700, 60, 14);
      x.fillStyle = '#000'; x.fillRect(1366, 1110, 154, 12);
      x.font = 'bold 38px Helvetica, Arial, sans-serif'; x.textAlign = 'center'; x.fillText('10 µm', 1443, 1092);
    });
    const bar = _findBurnedBar(images[i].img);
    applyScaleDetect(i, bar.px, 10, { bar, keep: true });
    sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    const sel = document.getElementById('export-width-mm'); sel.value = '89'; sel.dispatchEvent(new Event('change')); render();
    const row = __row('Text size');
    return { bar, labelPx: _burnedLabelPx(images[i].img, bar), row };
  });
  expect(r.bar.px).toBeGreaterThan(150);
  expect(r.labelPx).toBeGreaterThan(25);
  expect(r.labelPx).toBeLessThan(40);
  expect(r.row.icon).toBe('⚠');
  expect(r.row.text).toMatch(/scale-bar label burned into the picture of A \(about [0-9.]+ pt\) prints below 6 pt/);
  const pt = +r.row.text.match(/about ([0-9.]+) pt/)[1];
  expect(pt).toBeGreaterThan(1.5); expect(pt).toBeLessThan(5);
  expect(r.row.fixes).toContain('Draw FigureLab’s bar instead');
  // the button: FigureLab's 10 µm bar at the figure's text size, clear of the bar in the image
  const after = await page.evaluate(() => {
    checkCompliance();
    [...document.querySelectorAll('#info-modal-bg .compliance-row button')].find(b => b.textContent.trim() === 'Draw FigureLab’s bar instead').click();
    __close(); render();
    const im = images[0], t = figTextItems.find(t => t.kind === 'sb' && t.idx === 0);
    return { sbOn: im.sbOn, burned: !!im.sbBurnedIn, label: t && t.str, corner: im._sbCornerUsed, toast: document.getElementById('toast').textContent,
      row: __row('Text size') };
  });
  expect(after.sbOn).toBe(true);
  expect(after.burned).toBe(false);
  expect(after.label).toBe('10 µm');
  expect(after.corner).not.toBe('br');        // clear of the bar in the image
  expect(after.toast).toMatch(/FigureLab’s scale bar drawn on A/);
  expect(after.row.text).not.toMatch(/burned into/);
  expect(errors).toEqual([]);
});
