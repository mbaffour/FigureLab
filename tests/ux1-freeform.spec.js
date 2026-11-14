// @ts-check
// Usability round 1, freeform group: editing precision, text editing and editable exports.
// freeform-12, 19, 30 — X / Y / W / H / angle fields (px or mm); align, space and distribute
//                      with exact gaps across objects and annotations
// freeform-13        — Shift / Cmd / Ctrl-click adds to the selection; the bar says how
// freeform-20        — circle, ellipse and rounded clip in freeform, carried by Pop out
// freeform-35        — annotations can sit below or above objects
// freeform-34        — a text annotation's words can be edited in place
// freeform-38        — a text box no longer cuts off the tops of its letters
// freeform-39        — a text box is editable text in the layered SVG and the PowerPoint
// freeform-29        — a freeform PDF carries its letters, text and text boxes as real text
// freeform-33        — annotations are dark on a light freeform canvas
// freeform-41        — graphical-abstract presets: the Elsevier size checked, the square one custom
// and the freeform polish items (14, 15, 17, 18, 21, 22, 23, 42, 43)
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform, gesture } = require('./helpers');

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
      out[name] = new TextDecoder().decode(data);
      p = at + csize;
    }
    return out;
  };
  window.__latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  window.__tb = (o) => { const W = canvasLogicalW, H = canvasLogicalH;
    const a = Object.assign({ type: 'textbox', xf: o.x / W, yf: o.y / H, x2f: (o.x + o.w) / W, y2f: (o.y + o.h) / H,
      text: 'Label', fill: true, fillColor: '#000000', fillOpacity: 1, shape: 'rect', fontSize: 16, fontFamily: '', bold: false, italic: false, color: '#ffffff' }, o.a || {});
    annotations.push(a); return a; };
`;

test.describe('text boxes and text in exports', () => {
  test('freeform-38: a text box in Arial keeps the tops of its letters', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 600, y: 600, w: 100, h: 100 }]);
    await page.evaluate(H);
    const r = await page.evaluate(() => {
      __tb({ x: 100, y: 100, w: 240, h: 30, a: { text: 'TTT fill', fontSize: 20, fontFamily: 'Arial, Helvetica, sans-serif' } });
      const off = document.createElement('canvas'); render(off, 1, {});
      const d = off.getContext('2d').getImageData(100, 100, 240, 30).data;
      let top = 99, bot = -1;
      for (let y = 0; y < 30; y++) for (let x = 0; x < 240; x++) { const i = (y * 240 + x) * 4; if (d[i] > 128) { top = Math.min(top, y); bot = Math.max(bot, y); } }
      const mc = document.createElement('canvas').getContext('2d'); mc.font = '20px Arial, Helvetica, sans-serif';
      const m = mc.measureText('TTT fill');
      return { inkH: bot - top + 1, want: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, top };
    });
    // The whole glyph height is drawn (the old 8 px inset clip cut ~6 px off the top).
    expect(r.top).toBeGreaterThan(0);
    expect(Math.abs(r.inkH - r.want)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('freeform-39: a text box is a shape and editable text, with its marks, in the layered SVG and the PowerPoint', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 600, y: 300, w: 200, h: 200 }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      __tb({ x: 80, y: 60, w: 420, h: 60, a: { text: 'Phage T7 on *E. coli* at 10^{8} PFU', fontSize: 18, fillColor: '#203040', fillOpacity: 0.8 } });
      render();
      document.getElementById('export-svg-mode').value = 'layered';
      const svgCap = await _captureDownload(() => exportSVG('f', 150, document.getElementById('fig-canvas')));
      const svg = new TextDecoder().decode(svgCap.data);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const g = doc.querySelector('g[data-type="textbox"]');
      const texts = g ? [...g.querySelectorAll('text')] : [];
      const italic = texts.flatMap(t => [...t.querySelectorAll('tspan')]).filter(s => s.getAttribute('font-style') === 'italic').map(s => s.textContent);
      const sup = texts.flatMap(t => [...t.querySelectorAll('tspan')]).filter(s => +s.getAttribute('dy') < 0).map(s => s.textContent);
      const pptCap = await _captureDownload(() => exportPPTX());
      const z = await __unzip(pptCap.data);
      const slide = z['ppt/slides/slide1.xml'];
      const sp = (slide.match(/<p:sp>(?:(?!<\/p:sp>).)*name="Text box:(?:(?!<\/p:sp>).)*<\/p:sp>/s) || [''])[0];
      return { parse: !doc.querySelector('parsererror'), hasRect: !!(g && g.querySelector('rect')), words: texts.map(t => t.textContent).join(' '),
        italic, sup, painted: /textbox are painted/.test(svg),
        pptText: [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(''),
        pptItalic: /i="1"[^>]*>(?:(?!<\/a:r>).)*<a:t>E\. coli<\/a:t>/s.test(sp), pptSup: /baseline="30000"[^>]*>(?:(?!<\/a:r>).)*<a:t>8<\/a:t>/s.test(sp),
        pptFilled: /<a:solidFill><a:srgbClr val="203040"><a:alpha val="80000"\/>/.test(sp), asPicture: /Marks as a picture[^"]*textbox/.test(slide) };
    });
    expect(r.parse).toBe(true);
    expect(r.hasRect).toBe(true);
    expect(r.words.replace(/\s+/g, ' ')).toContain('Phage T7 on E. coli at 108 PFU');
    expect(r.italic).toContain('E. coli');
    expect(r.sup).toContain('8');
    expect(r.painted).toBe(false);
    expect(r.pptText.replace(/\s+/g, ' ')).toContain('Phage T7 on E. coli at 108 PFU');
    expect(r.pptItalic).toBe(true);
    expect(r.pptSup).toBe(true);
    expect(r.pptFilled).toBe(true);
    expect(r.asPicture).toBe(false);
    expect(errors).toEqual([]);
  });

  test('freeform-29: the freeform PDF has its letters, text annotations and text boxes as real text, once', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 400, h: 400, iw: 1000, ih: 1000, fill: '#202020' }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      sc('show-labels', true); sc('label-bg', false); sv('label-color', '#ffffff'); sv('label-size', 40); sc('label-bold', true);
      sv('label-font', 'Helvetica, Arial, sans-serif');
      freeformElements[0].label = 'A';
      annotations.push({ type: 'text', xf: 600 / canvasLogicalW, yf: 120 / canvasLogicalH, text: 'Plaques at 37 C', fontSize: 18, color: '#000000' });
      __tb({ x: 600, y: 300, w: 300, h: 50, a: { text: 'Phage *T7*', fontSize: 18 } });
      render();
      const cap = await _captureDownload(() => _exportPDFWithText('f', 150, {}));
      const pdf = __latin1(cap.data);
      // The letter is not in the picture as well: the export render leaves it out.
      const c = renderExportCanvas(150, { skipLabels: _pdfCanTypeset });
      const k = c.width / canvasLogicalW, el = freeformElements[0];
      const d = c.getContext('2d').getImageData(Math.round((el.x + 6) * k), Math.round((el.y + 5) * k), Math.round(40 * k), Math.round(40 * k)).data;
      let white = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200) white++;
      render();
      return { pdf, white };
    });
    expect(r.pdf).toMatch(/\(A\) Tj/);
    expect(r.pdf).toMatch(/\(Plaques at 37 C\) Tj/);
    expect(r.pdf).toMatch(/\(Phage \) Tj/);
    expect(r.pdf).toMatch(/\(T7\) Tj/);
    expect(r.pdf).toMatch(/\/BaseFont \/Helvetica-Bold/);
    expect(r.pdf).toMatch(/\/BaseFont \/Helvetica-Oblique/);     // the italic run in the text box
    expect(r.white).toBe(0);                                      // the letter is text only, not pixels too
    expect(errors).toEqual([]);
  });

  test('freeform-29: the PDF save dialog says the text is real and the fonts are not embedded', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 200, h: 200 }]);
    await page.evaluate(() => doExportPreflight('pdf'));
    await expect(page.locator('#preflight-body')).toContainText('real, selectable text');
    await expect(page.locator('#preflight-body')).toContainText('not embedded');
    expect(errors).toEqual([]);
  });
});

// A point on the figure (logical px) in page coordinates, for real mouse clicks.
async function scr(page, x, y) {
  return page.evaluate(([x, y]) => { if (!window.__fit) { zoomToFit(); window.__fit = 1; } const c = document.getElementById('ann-canvas'), r = c.getBoundingClientRect();
    return [r.left + x * r.width / canvasLogicalW, r.top + y * r.height / canvasLogicalH]; }, [x, y]);
}
const THREE = [{ type: 'image', x: 40, y: 60, w: 200, h: 150, label: 'A', name: 'a.png' },
  { type: 'image', x: 300, y: 80, w: 200, h: 150, label: 'B', name: 'b.png' },
  { type: 'image', x: 610, y: 70, w: 220, h: 150, label: 'C', name: 'c.png' }];

test.describe('selection, position and arrangement', () => {
  test('freeform-13: Shift-, Cmd- and Ctrl-click add to the selection; clicking a selected one with Shift takes it out', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, THREE);
    const [ax, ay] = await scr(page, 140, 135), [bx, by] = await scr(page, 400, 155), [cx, cy] = await scr(page, 720, 145);
    await page.mouse.click(ax, ay);
    await page.keyboard.down('Shift'); await page.mouse.click(bx, by); await page.keyboard.up('Shift');
    const two = await page.evaluate(() => [...selectedElems].sort());
    await page.keyboard.down('Meta'); await page.mouse.click(cx, cy); await page.keyboard.up('Meta');
    const three = await page.evaluate(() => [...selectedElems].sort());
    await page.keyboard.down('Shift'); await page.mouse.click(bx, by); await page.keyboard.up('Shift');
    const out = await page.evaluate(() => [...selectedElems].sort());
    // The arrange buttons for two or more are enabled, and say what they need when not.
    const dis = await page.evaluate(() => ({ space: document.querySelector('#align-bar .ab-sel2').disabled, dist: document.querySelector('#align-bar .ab-sel3').disabled }));
    expect(two).toEqual([0, 1]);
    expect(three).toEqual([0, 1, 2]);
    expect(out).toEqual([0, 2]);
    expect(dis).toEqual({ space: false, dist: true });
    // and the shortcut sheet says how
    await expect(page.locator('#kb-modal')).toContainText('Shift/⌘/Ctrl+click');
    await expect(page.locator('#kb-modal')).toContainText('Drag on empty canvas');
    expect(errors).toEqual([]);
  });

  test('freeform-12 / 19: X, Y, W, H and the angle are typed, in px or in mm at the printed width', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, THREE);
    const [ax, ay] = await scr(page, 140, 135);
    await page.mouse.click(ax, ay);
    await expect(page.locator('#geo-x')).toHaveValue('40');
    await page.locator('#geo-w').fill('654'); await page.locator('#geo-w').press('Enter');
    await page.locator('#geo-x').fill('12.5'); await page.locator('#geo-x').press('Enter');
    await page.locator('#geo-a').fill('15'); await page.locator('#geo-a').press('Enter');
    const px = await page.evaluate(() => { const e = freeformElements[0]; return [e.x, e.y, e.w, e.h, e.rotation]; });
    expect(px).toEqual([12.5, 60, 654, 490.5, 15]);              // a picture keeps its shape (200:150)
    // mm at the printed width: 180 mm across a 1200 px canvas is 0.15 mm per px
    await page.evaluate(() => { sv('export-width-mm', '180'); });
    await page.locator('#geo-unit').selectOption('mm');
    await expect(page.locator('#geo-w')).toHaveValue('98.1');
    await page.locator('#geo-y').fill('3'); await page.locator('#geo-y').press('Enter');
    expect(await page.evaluate(() => freeformElements[0].y)).toBeCloseTo(20, 6);
    // One undo per typed field.
    const u = await page.evaluate(() => { undo(); return freeformElements[0].y; });
    expect(u).toBe(60);
    expect(errors).toEqual([]);
  });

  test('freeform-30: Space gives exactly equal gaps between objects and an annotation, read back from the layered SVG', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 40.3, y: 60, w: 520.42, h: 300, label: 'A' }, { type: 'image', x: 590, y: 70, w: 200.7, h: 150, label: 'B' },
      { type: 'image', x: 830, y: 65, w: 150.2, h: 150, label: 'C' }]);
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      const W = canvasLogicalW, H = canvasLogicalH;
      annotations.push({ type: 'rect', xf: 1000 / W, yf: 80 / H, x2f: 1100 / W, y2f: 180 / H, color: '#000', width: 2 });
      render();
      _ffSelectAll();
      sv('ff-space', '10');
      spaceElems('h');
      alignElems('top');
      render();
      document.getElementById('export-svg-mode').value = 'layered';
      const cap = await _captureDownload(() => exportSVG('f', 150, document.getElementById('fig-canvas')));
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(cap.data), 'image/svg+xml');
      const box = doc.querySelector('[id="annotations"] rect');
      return { els: freeformElements.map(e => [e.x, e.w, e.y]), ann: [+box.getAttribute('x'), +box.getAttribute('y')], selCount: _ffSelCount() };
    });
    expect(r.selCount).toBe(4);                                     // Ctrl+A took the box too
    const e = r.els;
    expect(e[1][0] - (e[0][0] + e[0][1])).toBeCloseTo(10, 6);
    expect(e[2][0] - (e[1][0] + e[1][1])).toBeCloseTo(10, 6);
    expect(r.ann[0] - (e[2][0] + e[2][1])).toBeCloseTo(10, 1);   // the annotation is in the row, 10 px on
    expect(new Set(e.map(v => v[2])).size).toBe(1);                // tops aligned exactly
    expect(r.ann[1]).toBeCloseTo(e[0][2], 1);
    expect(errors).toEqual([]);
  });

  test('freeform-23: Space names what it pushed off the canvas', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 20, y: 20, w: 600, h: 600, label: 'A' }, { type: 'image', x: 650, y: 20, w: 300, h: 280, label: 'B' },
      { type: 'image', x: 650, y: 320, w: 500, h: 280, label: 'D' }]);
    const t = await page.evaluate(() => { const T = []; const o = window.toast; window.toast = (m, k) => { T.push(String(m)); return o(m, k); };
      _ffSelectAll(); spaceElems('h'); window.toast = o; return T; });
    expect(t.some(m => /past the canvas edge/.test(m) && /D/.test(m))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('freeform-14 / 17: the bars keep their height whatever is selected; Escape and a click beside the canvas deselect', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, THREE);
    const top = () => page.evaluate(() => document.getElementById('ann-canvas').getBoundingClientRect().top);
    const [ax, ay] = await scr(page, 140, 135);
    const t0 = await top();
    await page.mouse.click(ax, ay);
    const t1 = await top();
    await page.keyboard.down('Shift'); const [bx, by] = await scr(page, 400, 155); await page.mouse.click(bx, by); await page.keyboard.up('Shift');
    const t2 = await top();
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(() => ({ n: selectedElems.size, props: document.getElementById('elem-props-bar').classList.contains('ep-none'), tb: getComputedStyle(document.getElementById('ctx-toolbar')).display }));
    const t3 = await top();
    // (a bar never grows after the first picture's two rows of fields; allow a font's px there)
    expect(Math.abs(t1 - t0)).toBeLessThanOrEqual(3);
    expect([t2, t3]).toEqual([t1, t1]);
    expect(esc).toEqual({ n: 0, props: true, tb: 'none' });
    await page.mouse.click(ax, ay);
    const wrap = await page.evaluate(() => { const r = document.getElementById('canvas-wrap').getBoundingClientRect(), c = document.getElementById('fig-canvas').getBoundingClientRect(); return [r.left + 4, Math.min(r.bottom - 4, c.bottom + 10)]; });
    await page.mouse.click(wrap[0], wrap[1]);
    expect(await page.evaluate(() => selectedElems.size)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('freeform-21: [ and ] and the toolbar ↻ turn the selected object; the grip goes below an object at the top edge', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 100, y: 5, w: 200, h: 150, label: 'A' }]);
    const [ax, ay] = await scr(page, 200, 80);
    await page.mouse.click(ax, ay);
    await page.keyboard.press(']'); await page.keyboard.press(']'); await page.keyboard.press('Shift+BracketRight');
    const a1 = await page.evaluate(() => freeformElements[0].rotation);
    await page.evaluate(() => rotateFromToolbar(90));
    const a2 = await page.evaluate(() => freeformElements[0].rotation);
    const grip = await page.evaluate(() => { freeformElements[0].rotation = 0; return getFreeformRotateHandle(freeformElements[0]); });
    expect(a1).toBe(7);
    expect(a2).toBe(97);
    expect(grip.y).toBeGreaterThan(155);
    expect(errors).toEqual([]);
  });

  test('freeform-19 / 30: a corner drag keeps a picture exactly in shape', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 300, h: 200, iw: 300, ih: 200, label: 'A' }]);
    await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); drawFreeformOverlay(); });
    await gesture(page, 'drag', [[400, 300], [460.4, 333], [521.4, 360]]);
    const r = await page.evaluate(() => [freeformElements[0].w, freeformElements[0].h]);
    expect(r[0]).toBeGreaterThan(400);
    expect(r[0] / r[1]).toBeCloseTo(1.5, 6);                       // not 421 × 281
    expect(errors).toEqual([]);
  });
});

test.describe('clip shapes, layers and text annotations', () => {
  test('freeform-20: circle, ellipse and rounded clips in freeform, in the picture, the layered SVG and the PowerPoint', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 300, h: 200, label: '', fill: '#203080' }]);
    await page.evaluate(H);
    await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); updateElemPropsBar(); drawFreeformOverlay(); });
    await page.locator('#ep-image-props .ep-clip[data-clip="circle"]').click();
    const r = await page.evaluate(async () => {
      const px = (c, x, y) => { const k = c.width / canvasLogicalW; return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3); };
      const c1 = renderExportCanvas(96);
      const circle = { corner: px(c1, 110, 110), side: px(c1, 140, 200), centre: px(c1, 250, 200) };
      document.getElementById('export-svg-mode').value = 'layered';
      const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 150, document.getElementById('fig-canvas')))).data);
      const ppt = await __unzip((await _captureDownload(() => exportPPTX())).data);
      const pic = (ppt['ppt/slides/slide1.xml'].match(/<p:pic>.*?<\/p:pic>/s) || [''])[0];
      ffSetClip('rounded'); document.getElementById('ep-clipR').value = 30; ffSetClipR(30);
      const c2 = renderExportCanvas(96);
      const rounded = { corner: px(c2, 102, 102), inside: px(c2, 140, 200) };
      const ppt2 = await __unzip((await _captureDownload(() => exportPPTX())).data);
      const pic2 = (ppt2['ppt/slides/slide1.xml'].match(/<p:pic>.*?<\/p:pic>/s) || [''])[0];
      render();
      return { circle, rounded, svgClip: /<clipPath id="[^"]+"><circle cx="250\.00" cy="200\.00" r="100\.00"\/><\/clipPath>/.test(svg) && /clip-path="url\(#/.test(svg),
        pptEllipse: /prst="ellipse"/.test(pic) && /<a:srcRect l="16[67]\d\d" t="\d{1,3}" r="16[67]\d\d"/.test(pic), pptRound: /prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 15000"/.test(pic2) };
    });
    expect(r.circle.corner).toEqual([255, 255, 255]);          // outside the circle: the canvas
    expect(r.circle.side).toEqual([255, 255, 255]);            // left of the circle, inside the box
    expect(r.circle.centre).toEqual([0x20, 0x30, 0x80]);
    expect(r.rounded.corner).toEqual([255, 255, 255]);
    expect(r.rounded.inside).toEqual([0x20, 0x30, 0x80]);
    expect(r.svgClip).toBe(true);
    expect(r.pptEllipse).toBe(true);                            // a picture in an ellipse shape, cropped square
    expect(r.pptRound).toBe(true);
    expect(errors).toEqual([]);
  });

  test('freeform-20: the ⌘K "Crop shape: circle" command clips the selected freeform picture', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 300, h: 200 }]);
    await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); });
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdp-input').fill('crop shape circle');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => freeformElements[0].cropShape)).toBe('circle');
    expect(errors).toEqual([]);
  });

  test('freeform-35: a filled box sent behind the icons is drawn behind them, everywhere, and does not take their clicks', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 200, y: 200, w: 100, h: 100, fill: '#ff0000', label: 'icon' }]);
    await page.evaluate(H);
    const W = 1200;
    const r = await page.evaluate(async () => {
      const W = canvasLogicalW, H = canvasLogicalH;
      annotations.push({ type: 'rect', xf: 150 / W, yf: 150 / H, x2f: 400 / W, y2f: 400 / H, color: '#000000', width: 2, fill: true, fillColor: '#ffff00', fillOpacity: 1 });
      render();
      const px = (c, x, y) => { const k = c.width / canvasLogicalW; return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3); };
      const before = px(renderExportCanvas(96), 250, 250);
      selectedAnnotation = 0; showAnnFloat(0);
      return { before };
    });
    await page.locator('#ann-float-back').click();
    const after = await page.evaluate(async () => {
      const px = (c, x, y) => { const k = c.width / canvasLogicalW; return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3); };
      const png = renderExportCanvas(96);
      document.getElementById('export-svg-mode').value = 'layered';
      const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 150, document.getElementById('fig-canvas')))).data);
      const order = [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map(m => m[1]);
      const flat = (() => { document.getElementById('export-svg-mode').value = 'flat'; return null; })();
      const ppt = await __unzip((await _captureDownload(() => exportPPTX())).data);
      const slide = ppt['ppt/slides/slide1.xml'];
      const box = slide.indexOf('name="Box"'), pic = slide.indexOf('name="Panel icon');
      render();
      return { z: annotations[0].z, inside: px(png, 250, 250), ring: px(png, 170, 170), order, pptBehind: box > 0 && pic > box, hitObj: _ffAnnAt(250, 250), hitRing: _ffAnnAt(170, 170) };
    });
    expect(r.before).toEqual([255, 255, 0]);                    // on top: the icon was hidden
    expect(after.z).not.toBeUndefined();
    expect(after.inside).toEqual([255, 0, 0]);                  // behind: the icon shows
    expect(after.ring).toEqual([255, 255, 0]);
    expect(after.order.indexOf('Annotations behind objects')).toBeGreaterThan(-1);
    expect(after.order.indexOf('Annotations behind objects')).toBeLessThan(after.order.findIndex(l => /^Panel icon/.test(l)));
    expect(after.pptBehind).toBe(true);
    expect(after.hitObj).toBe(-1);                              // a click on the icon is the icon's
    expect(after.hitRing).toBe(0);                              // the box is still clickable around it
    // ⬆ Front brings it back on top.
    await page.evaluate(() => { selectedAnnotation = 0; showAnnFloat(0); });
    await page.locator('#ann-float-front').click();
    expect(await page.evaluate(() => annotations[0].z)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('freeform-35: a box\'s new fill colour shows at once, and it can have rounded corners', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 700, y: 600, w: 100, h: 100 }]);
    await page.evaluate(() => { const W = canvasLogicalW, H = canvasLogicalH;
      annotations.push({ type: 'rect', xf: 100 / W, yf: 100 / H, x2f: 400 / W, y2f: 300 / H, color: '#000000', width: 2 });
      render(); selectedAnnotation = 0; showAnnFloat(0); });
    expect(await page.locator('#ann-float-fill').isChecked()).toBe(false);   // an empty box says so
    await page.locator('#ann-float-fill-color').evaluate(e => { e.value = '#00ff00'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#ann-float-rad').fill('40');
    const r = await page.evaluate(() => { const c = renderExportCanvas(96), k = c.width / canvasLogicalW, g = c.getContext('2d');
      const at = (x, y) => [...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3);
      return { fill: annotations[0].fill, mid: at(250, 200), corner: at(104, 104), radius: annotations[0].radius }; });
    expect(r.fill).toBe(true);
    expect(r.mid[1]).toBeGreaterThan(200);                      // green shows without re-ticking Fill
    expect(r.corner).toEqual([255, 255, 255]);                  // the corner is rounded off
    expect(r.radius).toBe(40);
    expect(errors).toEqual([]);
  });

  test('freeform-34: a text annotation\'s words are edited in place (double-click) or in its toolbar, with Bold and no halo on a light canvas', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 700, y: 600, w: 100, h: 100 }]);
    // Placed with the T tool: dark, no halo, on the white canvas.
    await page.evaluate(() => { setTool('text'); });
    const [tx, ty] = await scr(page, 200, 200);
    await page.mouse.click(tx, ty);
    await page.locator('#ann-text-input').fill('Plaques at 10^{-6}');
    await page.keyboard.press('Enter');
    const made = await page.evaluate(() => { const a = annotations[annotations.length - 1]; return { color: a.color, halo: a.halo }; });
    expect(made).toEqual({ color: '#111111', halo: false });
    await page.evaluate(() => setTool('none'));
    // Double-click it: the words come up to edit.
    const [hx, hy] = await scr(page, 210, 207);
    await page.mouse.dblclick(hx, hy);
    await expect(page.locator('#ann-text-input')).toBeVisible();
    await expect(page.locator('#ann-text-input')).toHaveValue('Plaques at 10^{-6}');
    await page.locator('#ann-text-input').fill('Plaques at 10^{-7}');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [annotations.length, annotations[0].text])).toEqual([1, 'Plaques at 10^{-7}']);
    expect(await page.evaluate(() => { undo(); return annotations[0].text; })).toBe('Plaques at 10^{-6}');
    // The toolbar has the words too, and a Bold toggle for this text only.
    await page.evaluate(() => { selectedAnnotation = 0; showAnnFloat(0); });
    await expect(page.locator('#ann-float-tb-text')).toBeVisible();
    await page.locator('#ann-float-tb-text').fill('Plaques');
    await page.locator('#ann-float-bold').click();
    const s = await page.evaluate(() => ({ t: annotations[0].text, b: annotations[0].bold, font: _annTextFont(annotations[0]) }));
    expect(s.t).toBe('Plaques');
    expect(s.b).toBe(!(await page.evaluate(() => gc('label-bold'))));
    expect(s.font).toMatch(s.b ? / bold / : / normal \d/);
    expect(errors).toEqual([]);
  });

  test('freeform-33: an arrow drawn on a white freeform canvas is dark; over a dark picture it is white; a chosen colour is kept', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, [{ type: 'image', x: 600, y: 100, w: 400, h: 400, fill: '#101010' }]);
    await page.evaluate(() => { setTool('arrow'); zoomToFit(); window.__fit = 1; });
    await gesture(page, 'drag', [[100, 600], [200, 650], [300, 700]]);
    await gesture(page, 'drag', [[700, 200], [750, 250], [800, 300]]);
    await page.evaluate(() => { const c = document.getElementById('ann-color'); c.value = '#ff00ff'; c.dispatchEvent(new Event('input', { bubbles: true })); });
    await gesture(page, 'drag', [[100, 800], [200, 820], [300, 840]]);
    const cols = await page.evaluate(() => annotations.map(a => a.color));
    expect(cols).toEqual(['#111111', '#ffffff', '#ff00ff']);
    expect(errors).toEqual([]);
  });
});

test.describe('presets, import, polish', () => {
  test('freeform-41: the graphical-abstract presets — Elsevier checked, a square one labelled as a custom size', async ({ page }) => {
    const errors = await loadApp(page);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdp-input').fill('graphical abstract square');
    await expect(page.locator('#cmd-palette')).toContainText('custom size');
    await page.keyboard.press('Enter');
    const r = await page.evaluate(() => [gv('fm-canvas-w'), gv('fm-canvas-h'), layoutMode]);
    expect(r).toEqual(['1200', '1200', 'freeform']);
    await expect(page.locator('#info-modal-bg')).toContainText('NOT a checked journal specification');
    expect(errors).toEqual([]);
  });

  test('freeform-18 / 42: pictures added to freeform sit side by side, named by file in the list and the SVG layers', async ({ page }) => {
    const errors = await loadApp(page);
    await page.evaluate(() => { document.getElementById('layout-mode').value = 'freeform'; setLayoutMode('freeform'); });
    await page.evaluate(H);
    const r = await page.evaluate(async () => {
      const mk = (f) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = f; x.fillRect(0, 0, 400, 300); return c.toDataURL(); };
      for (const [n, f] of [['plaque_assay.png', '#a33'], ['MG1655_pGFP.png', '#3a3'], ['tem.png', '#33a'], ['four.png', '#aa3']]) {
        const src = mk(f);
        await new Promise(res => { const im = new Image(); im.onload = () => { _commitImage(im, src, n); res(); }; im.src = src; });
      }
      render();
      const boxes = freeformElements.map(e => [e.x, e.y, e.w, e.h]);
      const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]));
      updateFreeformElemList();
      const list = document.getElementById('fm-elem-list').textContent;
      document.getElementById('export-svg-mode').value = 'layered';
      const svg = new TextDecoder().decode((await _captureDownload(() => exportSVG('f', 150, document.getElementById('fig-canvas')))).data);
      return { overlap, list, layers: [...svg.matchAll(/inkscape:label="(Panel [^"]+)"/g)].map(m => m[1]) };
    });
    expect(r.overlap).toBe(false);
    expect(r.list).toContain('plaque_assay.png');
    expect(r.list).toContain('MG1655_pGFP.png');
    expect(r.layers).toEqual(expect.arrayContaining(['Panel plaque_assay.png', 'Panel tem.png']));
    expect(errors).toEqual([]);
  });

  test('freeform-15 / 22: ⌘K finds align, front, lock and position; the lock badge leaves the letter alone', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, THREE);
    await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); selectedElems.add(1); });
    for (const [q, want] of [['align left', 'left edges'], ['align right', 'right edges'], ['front', 'to front'], ['lock', 'Lock / unlock'], ['position', 'Position and size'], ['space', 'exact gap'], ['match width', 'Match width'], ['distribute', 'Distribute selected objects']]) {
      await page.keyboard.press('ControlOrMeta+k');
      await page.locator('#cmdp-input').fill(q);
      await expect(page.locator('#cmd-palette')).toContainText(want);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdp-input').fill('align left');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [freeformElements[0].x, freeformElements[1].x])).toEqual([40, 40]);
    // The lock badge is drawn at the top right, away from the letter at the top left.
    const badge = await page.evaluate(() => { selectedElems.clear(); selectedElems.add(0); freeformElements[0].locked = true;
      const ctx = annCanvas.getContext('2d'); const calls = []; const o = ctx.fillText; ctx.fillText = function (t, x, y) { calls.push([t, x, y]); return o.apply(this, arguments); };
      drawFreeformOverlay(); ctx.fillText = o; return calls.find(c => c[0] === '🔒'); });
    expect(badge[1]).toBeGreaterThan(40 + 200 / 2);
    expect(errors).toEqual([]);
  });

  test('freeform-43: Ctrl/⌘+Shift+Z redoes even when the browser reports a lower-case z', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, THREE);
    const r = await page.evaluate(() => {
      const key = (k, shift) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: !!shift, bubbles: true }));
      pushUndo(); freeformElements[0].x = 500;
      pushUndo(); freeformElements[0].x = 600;
      key('z');
      const back = freeformElements[0].x;
      key('z', true);                                   // Shift held, letter reported lower-case
      return { back, redone: freeformElements[0].x };
    });
    expect(r.back).toBe(500);
    expect(r.redone).toBe(600);
    expect(errors).toEqual([]);
  });

  test('clips, layers, corner radius and bold survive save and load', async ({ page }) => {
    const errors = await loadApp(page);
    await seedFreeform(page, THREE);
    const r = await page.evaluate(async () => {
      const W = canvasLogicalW, H = canvasLogicalH;
      freeformElements[0].cropShape = 'rounded'; freeformElements[0].clipR = 22;
      annotations.push({ type: 'rect', xf: 0.1, yf: 0.1, x2f: 0.3, y2f: 0.3, color: '#000', width: 2, fill: true, fillColor: '#ff0', fillOpacity: 1, radius: 9 });
      annotations.push({ type: 'text', xf: 0.5, yf: 0.5, text: 'hi', color: '#000', fontSize: 14, bold: false });
      selectedAnnotation = -1; ffAnnSel.clear(); ffAnnSel.add(annotations[0]); changeZOrder('back');
      const s = JSON.parse(JSON.stringify(serializeSession(true)));
      applySession(s, { origin: 'file' });
      await new Promise(r => setTimeout(r, 200)); render();
      return { clip: [freeformElements[0].cropShape, freeformElements[0].clipR], z: annotations[0].z, radius: annotations[0].radius, bold: annotations[1].bold };
    });
    expect(r.clip).toEqual(['rounded', 22]);
    expect(r.z).toBe(1);
    expect(r.radius).toBe(9);
    expect(r.bold).toBe(false);
    expect(errors).toEqual([]);
  });
});

test('freeform-16: Apply in the visual crop editor keeps the picture\'s scale (the box takes the crop\'s shape)', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 50, y: 100, w: 512, h: 144, iw: 2560, ih: 720 }]);
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0); updateElemPropsBar();
    openFreeformCropEditor();
    // the region x 560–2000 of 2560 (a 2:1 centre crop), as the editor's box
    Object.assign(cropEdState, { cx: 560 / 2560, cy: 0, cw: 1440 / 2560, ch: 1, hasBox: true });
    applyCropModal();
    const e = freeformElements[0]; render();
    return { x: e.x, y: e.y, w: e.w, h: e.h };
  });
  expect(r.w / r.h).toBeCloseTo(1440 / 720, 2);             // 2:1, not stretched to the old 3.56:1 box
  expect(r.h).toBeCloseTo(144, 6);
  expect(r.x).toBeCloseTo(50 + 560 / 2560 * 512, 1);         // the kept pixels did not move
  expect(errors).toEqual([]);
});

test('freeform-29: a haloed text annotation is text in the PDF, its halo the same glyphs stroked, and nothing of it left in the picture', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'image', x: 100, y: 100, w: 400, h: 400, iw: 1000, ih: 1000, fill: '#808080' }]);
  await page.evaluate(H);
  const r = await page.evaluate(async () => {
    annotations.push({ type: 'text', xf: 150 / canvasLogicalW, yf: 150 / canvasLogicalH, text: 'WT', fontSize: 40, color: '#ffffff', halo: true });
    render();
    const pdf = __latin1((await _captureDownload(() => _exportPDFWithText('f', 150, {}))).data);
    const c = renderExportCanvas(150, { skipLabels: _pdfCanTypeset });
    const k = c.width / canvasLogicalW, d = c.getContext('2d').getImageData(Math.round(150 * k), Math.round(150 * k), Math.round(60 * k), Math.round(45 * k)).data;
    let off = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 128) > 6) off++;
    render();
    return { stroke: /RG BT 1 Tr [^\n]*\(WT\) Tj 0 Ts 0 Tr ET Q/.test(pdf), fill: /rg [^\n]*\(WT\) Tj/.test(pdf), off, skip: _annTextSkip };
  });
  expect(r.stroke).toBe(true);
  expect(r.fill).toBe(true);
  expect(r.off).toBe(0);                                         // neither halo nor letters in the pixels
  expect(r.skip).toBe(null);
  expect(errors).toEqual([]);
});
