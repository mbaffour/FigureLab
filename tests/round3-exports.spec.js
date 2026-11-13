// @ts-check
// Round 3 of breaking the export and reuse features, and the fixes.
//
// 1. XML: one sanitiser for every writer of XML (flat and layered SVG, the key SVG, every
//    PowerPoint part); a hostile figure must give files that parse.
// 2. The layered SVG and the PowerPoint: z-order, hidden marks, a blot's marks in its
//    layer, unique ids, a turned panel's edge pixels, and the picture scale at 72–300 dpi
//    and at a printed width.
// 3. Batch Export: PANELS.txt lists exactly the ZIP, equal cells give equal files, a
//    freeform object alone, a blot's lane table with its row names.
// 4. Replace all: a missing page, an unreadable file, two files of one name; a replaced
//    blot's lane analysis.
// 5. Lab style: unusable keys listed, palette kept, precedence with a target journal,
//    sample colours reserved, New figure clears it.
// 6. PNG alt text readable by Pillow; the Python script's colour maps equal the app's.
// Every test says what fails without its fix.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HELPERS = `
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
      out[name] = data; p = at + csize;
    }
    return out;
  };
  window.__raster = async (svgText, w, h) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg did not load')); img.src = url; });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h);
  };
  window.__pngData = async (bytes) => {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
    return x.getImageData(0, 0, c.width, c.height);
  };
  window.__mad = (a, b, rect) => {
    if (a.width !== b.width || a.height !== b.height) return 999;
    const [x0, y0, x1, y1] = rect || [0, 0, a.width, a.height]; let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * a.width + x) * 4;
      s += (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3; n++; }
    return n ? s / n : 0;
  };
  window.__px = (I, x, y) => { const i = (y * I.width + x) * 4; return [I.data[i], I.data[i + 1], I.data[i + 2]]; };
  window.__seed = async (specs) => {
    for (const sp of specs) {
      const c = document.createElement('canvas'); c.width = sp.w || 160; c.height = sp.h || 120;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, sp.a || '#204080'); g.addColorStop(1, sp.b || '#e0c040');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < c.width; i += 8) x.fillRect(i, 0, 2, c.height);
      x.fillStyle = '#c02020'; x.fillRect(c.width * 0.6, c.height * 0.2, c.width * 0.25, c.height * 0.3);
      const src = c.toDataURL('image/png');
      await new Promise((res, rej) => { const img = new Image();
        img.onload = () => { _commitImage(img, src, sp.name || 'p.png'); res(); }; img.onerror = rej; img.src = src; });
    }
  };
  window.__svgCap = async (mode) => {
    sv('export-svg-mode', mode);
    const cap = await _captureDownload(() => exportSVG(gv('export-name') || 'figure', getExportDPI(), document.getElementById('fig-canvas')));
    return new TextDecoder().decode(cap.data);
  };
  window.__pngCap = async () => {
    const c = renderExportCanvas(getExportDPI());
    const png = await _captureDownload(() => exportPNGWithMeta('f', c._effDpi, c));
    return __pngData(png.data);
  };
  window.__pptx = async () => { const cap = await _captureDownload(() => exportPPTX()); return __unzip(cap.data); };
  window.__parseErr = (text, type) => { const d = new DOMParser().parseFromString(text, type || 'image/svg+xml');
    const e = d.getElementsByTagName('parsererror'); return e.length ? e[0].textContent.slice(0, 160) : ''; };
  window.__pngFile = async (name, w, h, g) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')'; x.fillRect(0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/png')); return new File([blob], name, { type: 'image/png' }); };
`;
const LT = fs.readFileSync(path.join(__dirname, 'lane-table.spec.js'), 'utf8').match(/const GEN = \(\) => \{[\s\S]*?\n\};/)[0];
async function setup(page) {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(LT.replace('const GEN = ', '(').replace(/;\s*$/, ')()'));
  return errors;
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fl-r3-')); }

// A text that carries every way user text has broken XML: markup characters, both quotes,
// a double hyphen and a trailing hyphen (comments), a vertical tab and a NUL (illegal in
// XML 1.0 however escaped), an unpaired surrogate, an emoji and right-to-left text.
const HOSTILE = 'A&B <i>"q"</i> \'x\' -- end\u000B\u0000\uD800 \u{1F600} שלום -';

// ── 1. XML ─────────────────────────────────────────────────────────
// Fails before: the layered and flat SVG put the file name "WT--KO.svg" in an XML comment
// ("--" ends it), wrote the U+000B and U+0000 raw, and wrote the font name with "&" and
// "<" unescaped into style="font:…"; the PowerPoint's slide and notes XML carried the
// control characters. Every one of those files failed to parse.
test('a hostile figure gives XML that parses: flat SVG, layered SVG, key SVG and every PowerPoint part', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const r = await page.evaluate(async (H) => {
    await __seed([{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }]);
    sv('cols', '3'); sv('rows', '1'); sv('export-dpi', '96'); sv('export-name', 'hostile');
    onLayoutChange(); render();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#0a0"/></svg>';
    await replacePanelImage(images[2].id, new File([svg], 'WT--KO-.svg', { type: 'image/svg+xml' }));   // kept vector: a comment names it
    sv('fig-title', H); _setAltText(H);
    images[0].label = H; images[1].tag = H; sc('show-tags', true);
    images[0].lut = 'green';
    images[0].channels.push({ name: H + '.tif', img: images[1].img, src: images[1].src, lut: 'magenta', blackPt: 0, whitePt: 255 });
    sc('show-col-labels', true); onLayoutChange(); render();
    const col = document.querySelector('#col-label-inputs input'); if (col) { col.value = H; col.dispatchEvent(new Event('input')); }
    annotations.push({ type: 'text', xf: 0.1, yf: 0.5, text: H, fontSize: 14, color: '#000000' });
    // a font name that reached the controls without the importers' check (an old session)
    const font = "'Gill & <Co> \"x\"',sans-serif"; _ensureFontOption(font); sv('label-font', font);
    render();
    const layered = await __svgCap('layered'), flat = await __svgCap('flat');
    const key = _keySVG(96);
    const parts = await __pptx();
    const xmlParts = Object.entries(parts).filter(([n]) => /\.(xml|rels)$/.test(n))
      .map(([n, d]) => [n, __parseErr(new TextDecoder().decode(d), 'application/xml')]);
    const slide = new TextDecoder().decode(parts['ppt/slides/slide1.xml']);
    return { layeredErr: __parseErr(layered), flatErr: __parseErr(flat), keyErr: __parseErr(key),
      pptxBad: xmlParts.filter(([, e]) => e), nParts: xmlParts.length,
      keyFont: key.includes('Gill &amp; &lt;Co&gt;'), comment: /<!-- Panel [^>]*WT- -KO-\.svg, written as vector -->/.test(layered),
      ctrl: /[\u0000\u000B]/.test(layered + flat + key + slide), emoji: layered.includes('\u{1F600}') && slide.includes('\u{1F600}'),
      rtl: layered.includes('שלום'), fontEsc: layered.includes('Gill &amp; &lt;Co&gt; &quot;x&quot;') };
  }, HOSTILE);
  expect(r.layeredErr).toBe('');
  expect(r.flatErr).toBe('');
  expect(r.keyErr).toBe('');
  expect(r.nParts).toBeGreaterThan(10);
  expect(r.pptxBad).toEqual([]);
  expect(r.keyFont).toBe(true);           // the font name reaches the key's text, escaped
  expect(r.fontEsc).toBe(true);           // and the figure's
  expect(r.comment).toBe(true);           // the file name is still named, hyphens apart
  expect(r.ctrl).toBe(false);
  expect(r.emoji).toBe(true);             // legal characters are kept, not stripped
  expect(r.rtl).toBe(true);
  expect(errors).toEqual([]);
});

// Fails before: _labStylePlan took 'Gill Sans & Co' (it stripped only quotes) and
// importHouseStyles copied any string, so 'Helvetica" x="1' reached style="font:…".
test('a font name with characters no font has is refused at the door, and both importers say so', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }]); render();
    const f0 = gv('label-font');
    const P = loadLabStyle({ settings: { font_family: 'custom', font_family_custom: 'Gill Sans & Co', font_size: 11 } }, 'p.json');
    document.getElementById('lab-style-summary')?.closest('.modal-bg')?.remove();
    const afterLab = gv('label-font');
    const n = importHouseStyles({ styles: [{ name: 'evil', style: { labelFont: 'Helvetica" x="1', labelSize: '20' } }] });
    const toastTxt = document.getElementById('toast').textContent;
    const st = getHouseStyles().find(s => s.name === 'evil');
    return { f0, afterLab, skipped: P.skipped.map(s => s[0]), n, toastTxt, hasFont: 'labelFont' in st.style, keptOther: st.style.labelSize };
  });
  expect(r.afterLab).toBe(r.f0);
  expect(r.skipped).toContain('font_family_custom');
  expect(r.n).toBe(1);
  expect(r.hasFont).toBe(false);
  expect(r.keptOther).toBe('20');
  expect(r.toastTxt).toMatch(/font left out/);
  expect(errors).toEqual([]);
});

// ── 2. Layered SVG and PowerPoint ─────────────────────────────────
// Fails before: _svgAnnMarkup wrote every annotation, hidden or not, into both SVG modes.
test('annotations hidden in the Layers list are in no export', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }, { name: 'b.png' }]); sv('cols', '2'); sv('rows', '1'); onLayoutChange();
    annotations.push({ type: 'rect', xf: .1, yf: .1, x2f: .5, y2f: .5, color: '#ff00ff', width: 4, hidden: true },
      { type: 'text', xf: .2, yf: .6, text: 'SECRET DRAFT NOTE', fontSize: 14, color: '#ff00ff', hidden: true },
      { type: 'text', xf: .6, yf: .6, text: 'SHOWN', fontSize: 14, color: '#000000' });
    render();
    const layered = await __svgCap('layered'), flat = await __svgCap('flat');
    const slide = new TextDecoder().decode((await __pptx())['ppt/slides/slide1.xml']);
    const has = s => ({ secret: s.includes('SECRET'), magenta: /#ff00ff/i.test(s), shown: s.includes('SHOWN') });
    return { layered: has(layered), flat: has(flat), pptx: has(slide) };
  });
  for (const k of ['layered', 'flat', 'pptx']) {
    expect(r[k].secret).toBe(false);
    expect(r[k].shown).toBe(true);        // the visible mark is still written
  }
  expect(r.layered.magenta).toBe(false);
  expect(errors).toEqual([]);
});

// Fails before: each panel layer wrote its border before its letter chip and baked its
// marks into the picture under the vector letter, so the layered SVG drew the grey chip
// over the red border (140,0,0 where the PNG has 255,0,0) and the letter over a green
// mark; the PowerPoint wrote every border before every chip and had no marks picture.
test('a panel stacks as in the PNG: border over the letter chip, marks over the letter — layered SVG and PowerPoint', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png', a: '#ffffff', b: '#ffffff' }, { name: 'b.png', a: '#808080', b: '#808080' }]);
    sv('cols', '2'); sv('rows', '1'); sv('panel-w', '150'); sv('panel-h', '120'); sv('export-dpi', '96');
    sv('panel-border-w', '6'); sv('panel-border-c', '#ff0000'); onLayoutChange(); render();
    images[1].panelAnns = [{ type: 'line', xf: 0.05, yf: 0.12, x2f: 0.6, y2f: 0.12, color: '#00ff00', width: 8 }];
    render();
    const chipB = figTextItems.find(t => t.kind === 'panel' && t.idx === 1).bg, cellA = panelBounds.find(b => b.idx === 0);
    const P = await __pngCap(), L = await __raster(await __svgCap('layered'), P.width, P.height);
    const S = P.width / canvasLogicalW;
    const at = (I, lx, ly) => __px(I, Math.round(lx * S), Math.round(ly * S));
    // where panel A's border crosses its chip, and where B's mark crosses its chip
    const chipA = figTextItems.find(t => t.kind === 'panel' && t.idx === 0).bg;
    const pts = [[cellA.x + 3, chipA.y + chipA.h / 2], [chipB.x + chipB.w / 2, panelBounds.find(b => b.idx === 1).y + 0.12 * 120]];
    const slide = new TextDecoder().decode((await __pptx())['ppt/slides/slide1.xml']);
    const names = [...slide.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map(m => m[1]);
    return { png: pts.map(p => at(P, ...p)), lay: pts.map(p => at(L, ...p)), names };
  });
  expect(r.png[0]).toEqual([255, 0, 0]);
  expect(r.png[1]).toEqual([0, 255, 0]);
  r.png.forEach((p, i) => p.forEach((v, c) => expect(Math.abs(v - r.lay[i][c])).toBeLessThan(24)));
  // PowerPoint stacks in the order written: per panel, chip then border, letter then marks
  const firstChip = r.names.indexOf('Label chip'), firstBorder = r.names.indexOf('Border');
  expect(firstChip).toBeGreaterThan(-1);
  expect(firstBorder).toBeGreaterThan(firstChip);
  expect(r.names.indexOf('Panel B: marks')).toBeGreaterThan(r.names.indexOf('Panel letter: B'));
  expect(errors).toEqual([]);
});

// Fails before: pictures were placed at device px ÷ S in a viewBox of the logical size,
// but the render is round(W·S) px wide: 3.2 grey levels mean at 150 dpi, 5.3 at 89 mm,
// and at 89 mm a picture sat 0.63 px left of its cell and 1.5 px wider, over the gutter.
test('layered SVG within a grey level of the PNG at 72/150/300 dpi, free width and 89/183 mm; no picture shows in a gutter', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await setup(page);
  await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }, { name: 'b.png', a: '#106030', b: '#f0f0f0' }, { name: 'c.png', a: '#501070', b: '#40e0e0' },
      { name: 'd.png', a: '#802010', b: '#2080ff' }, { name: 'e.png', a: '#303030', b: '#ffffff' }, { name: 'f.png' }]);
    sv('cols', '3'); sv('rows', '2'); sv('panel-w', '150'); sv('panel-h', '120'); sv('gap-h', '6'); sv('gap-v', '6');
    onLayoutChange(); render();
  });
  const out = [];
  for (const dpi of ['72', '150', '300']) for (const mm of ['0', '89', '183']) {
    const r = await page.evaluate(async ([dpi, mm]) => {
      sv('export-dpi', dpi); sv('export-width-mm', mm); render();
      const svg = await __svgCap('layered');
      const P = await __pngCap(), L = await __raster(svg, P.width, P.height);
      const S = _exportScaleFor(getExportDPI());
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      // each panel's picture: clipped to exactly its cell, overhanging it by less than a pixel
      const geo = panelBounds.map(b => {
        const g = doc.getElementById('panel-' + formatLabel(images[b.idx].label)), im = g.querySelector('image');
        const cp = doc.getElementById(im.getAttribute('clip-path').slice(5, -1)).firstElementChild;
        const ix = +im.getAttribute('x'), iy = +im.getAttribute('y'), iw = +im.getAttribute('width'), ih = +im.getAttribute('height');
        return { clip: ['x', 'y', 'width', 'height'].map(k => +cp.getAttribute(k)), cell: [b.x, b.y, b.w, b.h],
          over: Math.max(b.x - ix, b.y - iy, ix + iw - b.x - b.w, iy + ih - b.y - b.h) * S };
      });
      // gutter columns between panels, whole device pixels only: must look as in the PNG
      const cols = [...new Set(panelBounds.map(b => b.x + b.w))].sort((a, b) => a - b).slice(0, -1);
      const gut = cols.map(x0 => { const nx = Math.min(...panelBounds.filter(b => b.x > x0).map(b => b.x));
        const top = Math.min(...panelBounds.map(b => b.y)), bot = Math.max(...panelBounds.map(b => b.y + b.h));
        return __mad(L, P, [Math.ceil(x0 * S), Math.ceil(top * S), Math.floor(nx * S), Math.floor(bot * S)]); });
      return { dpi, mm, w: P.width, mad: __mad(L, P), geo, gut: Math.max(0, ...gut) };
    }, [dpi, mm]);
    out.push(r);
  }
  console.log(out.map(r => `${r.dpi} dpi ${r.mm} mm (${r.w} px): layered~png ${r.mad.toFixed(3)}, gutters ${r.gut.toFixed(3)}`).join('\n'));
  for (const r of out) {
    expect(r.mad).toBeLessThan(1.0);
    expect(r.gut).toBeLessThan(1.0);
    for (const g of r.geo) {
      g.clip.forEach((v, i) => expect(v).toBeCloseTo(g.cell[i], 2));
      expect(g.over).toBeLessThan(1.0001);
    }
  }
  expect(errors).toEqual([]);
});

// Fails before: the lane numbers and the splice line stayed in the figure-wide
// Annotations layer, so moving the blot's layer left them over the wrong place, and the
// PowerPoint named them "Text: 1" and "Line".
test("a blot's lane numbers and splice marker are in its layer; PowerPoint names them for the panel", async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __blot(4, 'blot.png'); await __seed([{ name: 'b.png' }]); sv('cols', '2'); sv('rows', '1'); onLayoutChange(); render();
    runGelAnalysis(0); gelPlaceLaneNumbers(0); selectedPanel = 0; addSpliceMarker(); render();
    const doc = new DOMParser().parseFromString(await __svgCap('layered'), 'image/svg+xml');
    const gA = doc.getElementById('panel-A'), ann = doc.getElementById('annotations');
    const slide = new TextDecoder().decode((await __pptx())['ppt/slides/slide1.xml']);
    return { inA: [...gA.querySelectorAll('text')].map(t => t.textContent), lineInA: gA.querySelectorAll('line').length,
      annTexts: ann ? [...ann.querySelectorAll('text')].map(t => t.textContent) : [], desc: doc.querySelector('desc').textContent,
      pptxLane: (slide.match(/name="Panel A: lane number/g) || []).length, pptxSplice: slide.includes('name="Panel A: splice marker"') };
  });
  expect(r.inA).toEqual(expect.arrayContaining(['A', '1', '2', '3', '4']));
  expect(r.lineInA).toBeGreaterThan(0);
  expect(r.annTexts).toEqual([]);
  expect(r.desc).toMatch(/in the layer of the blot they belong to/);
  expect(r.pptxLane).toBe(4);
  expect(r.pptxSplice).toBe(true);
  expect(errors).toEqual([]);
});

// Fails before: a panel lettered "A-clip" gave two elements id="panel-A-clip" (its layer
// and A's clipPath), and a panel turned 33° left 7 px of its edge in an unnamed
// "Flattened" layer while <desc> said every panel was its own layer.
test('ids are unique and valid for any letter; a turned panel keeps its edge pixels in its own layer', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }, { name: 'b.png', a: '#106030', b: '#f0f0f0' }, { name: 'c.png' }, { name: 'd.png' }]);
    sv('cols', '2'); sv('rows', '2'); sv('panel-w', '150'); sv('panel-h', '120'); sv('gap-h', '6'); sv('gap-v', '6');
    images[1].rotate = 33; images[2].label = 'A-clip'; images[3].label = 'annotations'; onLayoutChange(); render();
    const svg = await __svgCap('layered');
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map(m => m[1]);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    return { dup: ids.filter((v, i) => ids.indexOf(v) !== i), bad: ids.filter(v => !/^[A-Za-z_][\w.-]*$/.test(v)),
      top: [...doc.documentElement.children].map(e => e.id), imagesB: doc.getElementById('panel-B').querySelectorAll('image').length,
      note: !!doc.getElementById('panel-B').querySelector('image[data-note]'), desc: doc.querySelector('desc').textContent };
  });
  expect(r.dup).toEqual([]);
  expect(r.bad).toEqual([]);
  expect(r.top).not.toContain('flattened');
  expect(r.top).not.toContain('outside-cells');
  expect(r.imagesB).toBe(2);
  expect(r.note).toBe(true);
  expect(r.desc).toMatch(/Panel B paints a few pixels past its cell/);
  expect(errors).toEqual([]);
});

// ── 3. Batch Export ────────────────────────────────────────────────
// Fails before: PANELS.txt listed "Fig 1: growth/curve_panel_1_A.png" while the ZIP held
// "Fig 1_ growth_curve_panel_1_A.png"; a 140-character name lost the panel suffix;
// equal cells came out 1902×1903, 1903×1903, 1902×1902, 1903×1902.
test('Batch Export: PANELS.txt lists exactly the files in the ZIP, names keep the panel, equal cells give equal files', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const dir = tmpDir();
  try {
    for (const name of ['Fig 1: growth/curve', 'L'.repeat(140)]) {
      const r = await page.evaluate(async (name) => {
        if (!images.length) { await __seed([{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }, { name: 'd.png' }]); sv('cols', '2'); sv('rows', '2'); onLayoutChange(); }
        images[0].lut = 'green';                   // a key, so the key files go in too
        sv('export-batch-fmt', 'png'); sv('export-dpi', '600'); sv('export-width-mm', '183'); sv('export-name', name); render();
        const cap = await _captureDownload(() => batchExportPanels());
        const z = await __unzip(cap.data);
        const txt = new TextDecoder().decode(z['PANELS.txt']);
        const listed = [...txt.matchAll(/^([^\n]+?\.(?:png|svg|tiff|jpg|txt)): /gm)].map(m => m[1]);
        const sizes = []; for (const n of Object.keys(z).filter(n => /_panel_/.test(n))) { const b = await createImageBitmap(new Blob([z[n]])); sizes.push([b.width, b.height]); }
        let s = ''; for (let i = 0; i < cap.data.length; i += 0x8000) s += String.fromCharCode.apply(null, cap.data.subarray(i, i + 0x8000));
        return { entries: Object.keys(z), listed, sizes, b64: btoa(s) };
      }, name);
      expect(r.listed.slice().sort()).toEqual(r.entries.slice().sort());
      expect(r.entries.filter(n => /_panel_\d_[A-D]\.png$/.test(n)).length).toBe(4);
      expect(r.entries.some(n => /-key\.png$/.test(n)) && r.entries.some(n => /-key\.svg$/.test(n))).toBe(true);
      expect(new Set(r.sizes.map(s => s.join('x'))).size).toBe(1);
      // python reads the same names out of the ZIP
      const zp = path.join(dir, 'b.zip'); fs.writeFileSync(zp, Buffer.from(r.b64, 'base64'));
      const names = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,sys,json;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', zp]).toString());
      expect(names.sort()).toEqual(r.entries.slice().sort());
      fs.unlinkSync(zp);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  expect(errors).toEqual([]);
});

// Fails before: freeform panel files were cuts of the whole render, so A's file was 32%
// blue (B's pixels), and B's file held part of A.
test('Batch Export in freeform: each file holds its object alone, and PANELS.txt says so', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => { const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform'; setLayoutMode('freeform'); freeformElements.length = 0;
    const mk = (f) => { const c = document.createElement('canvas'); c.width = 200; c.height = 150; const x = c.getContext('2d'); x.fillStyle = f; x.fillRect(0, 0, 200, 150); return c.toDataURL('image/png'); };
    addFreeformElement({ type: 'image', x: 40, y: 40, w: 200, h: 150, src: mk('#00ff00'), label: 'A' });
    addFreeformElement({ type: 'image', x: 140, y: 100, w: 200, h: 150, src: mk('#0000ff'), label: 'B', rotation: 20 }); render(); });
  await page.waitForFunction(() => freeformElements.filter(e => e.type === 'image').every(e => e._imgEl && e._imgEl.complete && e._imgEl.naturalWidth > 0));
  const r = await page.evaluate(async () => {
    sv('export-dpi', '150'); render();
    const cap = await _captureDownload(() => batchExportPanels()); const z = await __unzip(cap.data); const out = {};
    for (const [n, d] of Object.entries(z)) if (/panel_.*\.png$/.test(n)) { const I = await __pngData(d); let g = 0, b = 0;
      for (let i = 0; i < I.data.length; i += 4) { const R = I.data[i], G = I.data[i + 1], B = I.data[i + 2]; if (G > 200 && R < 60 && B < 60) g++; else if (B > 200 && R < 60 && G < 60) b++; }
      out[n.match(/_([AB])\.png$/)[1]] = { g: g / (I.width * I.height), b: b / (I.width * I.height) }; }
    return { out, txt: new TextDecoder().decode(z['PANELS.txt']) };
  });
  expect(r.out.A.b).toBe(0);
  expect(r.out.A.g).toBeGreaterThan(0.95);
  expect(r.out.B.g).toBe(0);
  expect(r.txt).toMatch(/only this object/);
  expect(errors).toEqual([]);
});

// Fails before (T3-05): each file was its cell cut exactly, and the lane table's row
// names ("phage T4", "IPTG") sit 64 px left of the cell — no panel file had them.
test("Batch Export: a blot's file carries its whole lane table, row names included, and PANELS.txt says so", async ({ page }) => {
  test.setTimeout(90000);
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __blot(6, 'target.png'); await __blot(6, 'other.png'); sv('cols', '2'); sv('rows', '1'); onLayoutChange(); render();
    runGelAnalysis(0); runGelAnalysis(1);
    for (const i of [0, 1]) __fill(i, [{ name: 'phage T4', cells: ['–', '–', '–', '+', '+', '+'] }, { name: 'IPTG', cells: ['–', '+', '–', '+', '–', '+'] }]);
    sv('export-dpi', '150'); render();
    const names = __lt(0).filter(t => t.str === 'phage T4' || t.str === 'IPTG');
    const b = panelBounds.find(p => p.idx === 0);
    const cap = await _captureDownload(() => batchExportPanels()); const z = await __unzip(cap.data);
    const n = Object.keys(z).find(k => /_panel_1_A\.png$/.test(k)); const I = await __pngData(z[n]);
    const S = _exportScaleFor(150), left = Math.min(...names.map(t => t.bbox.x)), x0 = Math.round(left * S) - 0;
    // the file starts at (or left of) the names; the names' box in the file has dark ink
    const fx = Math.round((names[0].bbox.x - left) * S) + 2, fy = Math.round((names[0].bbox.y - Math.min(left, b.y)) * S);
    let dark = 0; const nb = names[0].bbox, oy = Math.min(...names.map(t => t.bbox.y), b.y);
    for (let y = Math.round((nb.y - oy) * S); y < Math.round((nb.y + nb.h - oy) * S); y++)
      for (let x = Math.round((nb.x - left + 2) * S); x < Math.round((nb.x + nb.w - left + 2) * S); x++) { const p = __px(I, x, y); if (p[0] < 120) dark++; }
    return { cellW: Math.round(b.w * S), fileW: I.width, outside: b.x - left, dark, txt: new TextDecoder().decode(z['PANELS.txt']) };
  });
  expect(r.outside).toBeGreaterThan(20);            // the names really are outside the cell
  expect(r.fileW).toBeGreaterThan(r.cellW + 20);    // and the file takes them in
  expect(r.dark).toBeGreaterThan(30);               // "phage T4" is drawn in the file
  expect(r.txt).toMatch(/includes its lane table \(row names/);
  expect(errors).toEqual([]);
});

// ── 4. Replace ─────────────────────────────────────────────────────
// A minimal uncompressed 8-bit greyscale TIFF with one page per grey value.
function tiffStack(greys, w = 40, h = 30) {
  const nTags = 9, ifdLen = 2 + nTags * 12 + 4, pix = w * h, per = ifdLen + pix;
  const buf = Buffer.alloc(8 + per * greys.length);
  buf.write('II', 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  greys.forEach((g, k) => {
    const at = 8 + k * per, data = at + ifdLen;
    buf.writeUInt16LE(nTags, at);
    const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, data], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, pix]];
    tags.forEach(([tag, type, n, v], i) => { const o = at + 2 + i * 12; buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(n, o + 4);
      if (type === 3) buf.writeUInt16LE(v, o + 8); else buf.writeUInt32LE(v, o + 8); });
    buf.writeUInt32LE(k + 1 < greys.length ? at + per : 0, at + 2 + nTags * 12);
    buf.fill(g, data, data + pix);
  });
  return Array.from(buf);
}

// Fails before: a page the new stack lacks became page 1 silently (both panels showed one
// image); an unreadable file took panel A's slot while z.png went unused; two files named
// field.png both gave panel B and C the first one and the second overwrote panel A.
test('Replace all: a missing page leaves the panel and is listed; an unreadable file takes no slot; same-named files pair one to one', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await setup(page);
  const s5 = tiffStack([10, 30, 50, 70, 90]), s2 = tiffStack([200, 220]);
  const r = await page.evaluate(async ({ s5, s2 }) => {
    const f5 = new File([new Uint8Array(s5)], 'stack.tif', { type: 'image/tiff' });
    for (const pg of [3, 5]) { const d = await _decodeImageFile(f5, pg); _commitImage(d.img, d.src, 'stack.tif'); const im = images[images.length - 1]; im.srcPage = d.page; im.srcPages = d.pages; }
    await __seed([{ name: 'n.png' }, { name: 'field.png' }, { name: 'field.png' }]);
    sv('cols', '5'); sv('rows', '1'); onLayoutChange(); render();
    const before = images.map(im => _sourceName(im)), n0 = undoStack.length;
    const files = [new File([new Uint8Array(s2)], 'stack.tif', { type: 'image/tiff' }), new File([new Uint8Array([1, 2, 3, 4])], 'broken.png', { type: 'image/png' }),
      await __pngFile('field.png', 50, 40, 101), await __pngFile('field.png', 50, 40, 202), await __pngFile('z.png', 50, 40, 77)];
    const bg = await replaceAllImages(files);
    const sec = id => (bg.querySelector('#' + id) || { textContent: '' }).textContent.replace(/\s+/g, ' ');
    const dialog = { missing: sec('ra-missing'), bad: sec('ra-bad'), unused: sec('ra-unused'), list: sec('ra-list') };
    const mid = images.map(im => _sourceName(im));
    bg.querySelector('#ra-apply').click();
    const grey = im => { const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d'); x.drawImage(im.img, 0, 0, 4, 4); return x.getImageData(1, 1, 1, 1).data[0]; };
    return { before, mid, after: images.map(im => _sourceName(im)), grey: images.map(grey), dialog, steps: undoStack.length - n0,
      toast: document.getElementById('toast').textContent };
  }, { s5, s2 });
  expect(r.mid).toEqual(r.before);                               // nothing changes before Replace
  expect(r.after.slice(0, 2)).toEqual(['stack.tif (page 3 of 5)', 'stack.tif (page 5 of 5)']);   // pages 3 and 5 are not in a 2-page stack
  expect(r.dialog.missing).toMatch(/Page not in the new file.*has 2 pages/);
  expect(r.dialog.bad).toMatch(/broken\.png/);
  expect(r.after[2]).toBe('z.png');                               // the unreadable file took no slot: z.png fills panel C
  expect(r.grey.slice(3)).toEqual([101, 202]);                    // field.png → field.png, one to one, in order
  expect(r.dialog.unused).toBe('');
  expect(r.steps).toBe(1);
  expect(r.toast).toMatch(/2 left unchanged \(2 because the page is not in the new file\); 1 file could not be read/);
  expect(errors).toEqual([]);
});

// Fails before: the toast said "crop, labels and settings kept" and nothing about the
// lane analysis made on the old pixels.
test("replacing an analysed blot's image says its lane analysis is out of date", async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __blot(6, 'blot.png'); runGelAnalysis(0);
    __fill(0, [{ name: 'phage', cells: ['+', '+', '+', '–', '–', '–'] }]);
    await replacePanelImage(images[0].id, await __pngFile('blot_week2.png', 600, 160, 200));
    return { toast: document.getElementById('toast').textContent, cls: document.getElementById('toast').className };
  });
  expect(r.toast).toMatch(/its lane analysis is now out of date — re-detect the lanes; the lane table is kept but may no longer line up/);
  expect(r.cls).toMatch(/warn/);
  expect(errors).toEqual([]);
});

// ── 5. Lab style ───────────────────────────────────────────────────
// Fails before: font_size 'big', title_size -3 and font_family 42 appeared in no list,
// and sample_palette ['#ff0000'] replaced the loaded {WT: #112233} with nothing.
test('lab style: every unusable key is listed, and an unusable palette leaves the loaded one', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }]); render();
    loadLabStyle({ settings: { sample_palette: { WT: '#112233' } } }, 'a.json');
    document.getElementById('lab-style-summary')?.closest('.modal-bg')?.remove();
    const P = loadLabStyle({ settings: { font_size: 'big', title_size: -3, font_family: 42, axis_color: 'red', axis_line_width: [0.5, 9], sample_palette: ['#ff0000'] } }, 'b.json');
    const skippedHtml = document.getElementById('lab-style-skipped')?.textContent || '';
    document.getElementById('lab-style-summary')?.closest('.modal-bg')?.remove();
    return { skipped: P.skipped.map(s => s[0]), skippedHtml, colours: gv('sample-colours') };
  });
  expect(r.skipped).toEqual(expect.arrayContaining(['font_family', 'font_size', 'title_size', 'axis_color', 'sample_palette']));
  expect(r.skippedHtml).toMatch(/font_size/);
  expect(r.colours).toBe('{"WT":"#112233"}');
  expect(errors).toEqual([]);
});

// Fails before: a lab style over a target journal said nothing about the journal; a
// journal over a lab style left the status line claiming the lab font.
test('lab style and target journal: the one applied last wins, and both say so', async ({ page }) => {
  const errors = await setup(page);
  const STYLE = { app: 'CFU Plot Studio', settings: { font_family: 'Times New Roman', font_size: 13, sample_palette: { WT: '#112233' } } };
  const r = await page.evaluate(async (STYLE) => {
    await __seed([{ name: 'a.png' }, { name: 'b.png' }]); sc('show-col-labels', true); onLayoutChange(); render();
    applyPreset('nature');
    loadLabStyle(STYLE, 'paper_style.json');
    const journalRow = document.getElementById('lab-style-journal')?.textContent || '';
    document.getElementById('lab-style-summary')?.closest('.modal-bg')?.remove();
    const statusAfterLab = document.getElementById('lab-style-status').textContent;
    applyPreset('nature');
    return { journalRow, statusAfterLab, toast: document.getElementById('toast').textContent,
      status: document.getElementById('lab-style-status').textContent, font: gv('label-font') };
  }, STYLE);
  expect(r.journalRow).toMatch(/Target journal: Nature\..*the one applied last wins, so this lab style is in force now/);
  expect(r.journalRow).toMatch(/Nature asks for .*Times New Roman/);
  expect(r.statusAfterLab).not.toMatch(/overridden/);
  expect(r.font).not.toMatch(/Times/);
  expect(r.toast).toMatch(/over the lab style \(applied last wins\): font Times New Roman → /);
  expect(r.status).toMatch(/overridden by Nature, applied after it: font Times New Roman → /);
  expect(errors).toEqual([]);
});

// Fails before: ΔfliC kept the palette's second colour, #e69f00, which the lab sample
// ΔmotA also has: two strains drawn and keyed alike.
test('lab sample colours are reserved: a series off the palette never takes a colour a lab sample on the chart holds', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    loadLabStyle({ settings: { sample_palette: { 'ΔmotA': '#E69F00' } } }, 'p.json');
    document.getElementById('lab-style-summary')?.closest('.modal-bg')?.remove();
    const out = {};
    for (const kind of ['groupedBar', 'line', 'box']) {
      addChartElement('bar'); closeChartModal();
      const el = freeformElements[freeformElements.length - 1];
      el.chart.data = { columns: ['x', 'WT', 'ΔfliC', 'ΔmotA'], rows: [['1', 1, 2, 3], ['2', 2, 3, 4]], source: 'demo', sourceName: '' };
      el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1, 2, 3]; el.chart.kind = kind;
      if (kind === 'box') { el.chart.data = { columns: ['strain', 'v'], rows: [['WT', 1], ['ΔfliC', 2], ['ΔmotA', 3]], source: 'demo', sourceName: '' }; el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1]; }
      el._chartKey = ''; el._chartStat = null; render();
      const st = _chartStatsCached(el);
      out[kind] = (st.seriesNames || st.series || st.boxes).map(s => [s.name, String(s.color).toLowerCase()]);
    }
    return out;
  });
  for (const kind of Object.keys(r)) {
    const cols = r[kind].map(s => s[1]);
    expect(new Set(cols).size).toBe(cols.length);
    expect(r[kind].find(s => s[0] === 'ΔmotA')[1]).toBe('#e69f00');
  }
  expect(errors).toEqual([]);
});

// Fails before: a hidden input's default was its current value, so New figure kept the
// sample colours and "Lab style: paper_style.json" while the lab font went back.
test('New figure clears the whole lab style: font, sizes, colours and status line', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }]); render();
    loadLabStyle({ app: 'CFU Plot Studio', settings: { font_family: 'Times New Roman', font_size: 11, axis_line_width: 0.6, sample_palette: { WT: '#112233' } } }, 'paper_style.json');
    document.getElementById('lab-style-summary')?.closest('.modal-bg')?.remove();
    const during = { font: gv('label-font'), colours: gv('sample-colours'), status: document.getElementById('lab-style-status').textContent };
    confirmNewFigure(); document.getElementById('cm-ok').click(); await new Promise(r => setTimeout(r, 50));
    return { during, font: gv('label-font'), colours: gv('sample-colours'), axisW: gv('chart-axis-w'), src: gv('lab-style-src'),
      set: gv('lab-style-set'), status: document.getElementById('lab-style-status').textContent };
  });
  expect(r.during.colours).toContain('#112233');
  expect(r.during.status).toMatch(/Lab style/);
  expect(r.font).not.toMatch(/Times/);
  expect([r.colours, r.axisW, r.src, r.set, r.status]).toEqual(['', '', '', '', '']);
  expect(errors).toEqual([]);
});

// ── 6. PNG text and the Python script ─────────────────────────────
// Fails before: the alt text went into a tEXt chunk as UTF-8 bytes, which Pillow reads
// as Latin-1: "Î\x94fliC … Âµm".
test('PNG alt text reads back intact in Pillow (iTXt for text Latin-1 lacks, Latin-1 tEXt otherwise)', async ({ page }) => {
  const errors = await setup(page);
  const dir = tmpDir();
  try {
    for (const alt of ['5 µm Δ — naïve', 'café 5 µm']) {
      const b64 = await page.evaluate(async (alt) => {
        if (!images.length) { await __seed([{ name: 'a.png' }]); render(); }
        _setAltText(alt); render();
        const c = renderExportCanvas(96); const png = await _captureDownload(() => exportPNGWithMeta('f', c._effDpi, c));
        let s = ''; for (let i = 0; i < png.data.length; i += 0x8000) s += String.fromCharCode.apply(null, png.data.subarray(i, i + 0x8000)); return btoa(s);
      }, alt);
      const p = path.join(dir, 'alt.png'); fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      const out = JSON.parse(execFileSync('python3', ['-c',
        'import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]);d=open(sys.argv[1],"rb").read()\nprint(json.dumps({"alt":im.text.get("Alt-Text"),"itxt":b"iTXt" in d}))', p]).toString());
      fs.unlinkSync(p);
      expect(out.alt).toBe(alt);
      expect(out.itxt).toBe(!/^[\u0000-ÿ]*$/.test(alt));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  expect(errors).toEqual([]);
});

// Fails before: the script rounded with np.round (halves to even) where the app uses
// Math.round: 64 of 256 orange values and 2 blue ones were a level off.
test("the Python script's colour maps equal the app's at all 256 values", async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }]); images[0].lut = 'orange'; render();
    const cap = await _captureDownload(() => exportPython());
    const py = new TextDecoder().decode(cap.data);
    const block = py.slice(py.indexOf('LUTS = {'), py.indexOf('\n}\n', py.indexOf('LUTS = {')) + 2);
    const app = {}; for (const k of ['orange', 'blue', 'fire', 'green', 'cyan', 'magenta', 'red', 'yellow']) app[k] = Array.from({ length: 256 }, (_, i) => LUTS[k](i).map(Math.round));
    return { block, app };
  });
  const dir = tmpDir();
  try {
    const p = path.join(dir, 'luts.py');
    fs.writeFileSync(p, 'import numpy as np, json\n' + r.block + '\ni = np.arange(256)\nout = {}\nfor k, f in LUTS.items():\n    ch = [np.broadcast_to(np.asarray(c), i.shape).astype(int) for c in f(i)]\n    out[k] = [[int(ch[0][j]), int(ch[1][j]), int(ch[2][j])] for j in range(256)]\nprint(json.dumps(out))\n');
    const py = JSON.parse(execFileSync('python3', [p]).toString());
    for (const k of Object.keys(r.app)) expect(py[k]).toEqual(r.app[k]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  expect(errors).toEqual([]);
});
