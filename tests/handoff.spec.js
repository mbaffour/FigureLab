// @ts-check
// The hand-off to a vector editor or to PowerPoint, and the files that go with it.
//
// A: the layered SVG — each panel its own layer (its picture, its letter, scale bar and
//    labels), looking exactly like the flat SVG and the PNG.
// B: the PowerPoint export — panels as pictures without baked-in text, every letter,
//    heading, title and label an editable text box, in grid and freeform.
// C: Batch Export renders each panel at the target DPI instead of enlarging the preview,
//    and hands over one ZIP.
// D: the ZIP writer deflates what compresses and stores what does not.
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform } = require('./helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// In-page helpers: an async ZIP reader that inflates method-8 entries, a rasteriser for
// SVG text, a pixel comparison, and a figure seeder.
const HELPERS = `
  window.__unzip = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true), crc = dv.getUint32(p + 14, true);
      const csize = dv.getUint32(p + 18, true), usize = dv.getUint32(p + 22, true);
      const nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el, raw = bytes.subarray(at, at + csize);
      let data = raw;
      if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out[name] = { method, crc, csize, usize, data };
      p = at + csize;
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
  // Mean absolute difference per channel (0–255), and the share of pixels off by > 64.
  window.__diff = (a, b) => {
    if (a.width !== b.width || a.height !== b.height) return { mad: 999, big: 1 };
    let s = 0, big = 0; const n = a.data.length / 4;
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      s += d / 3; if (d / 3 > 64) big++;
    }
    return { mad: s / n, big: big / n };
  };
  window.__seed = async (specs) => {
    for (const sp of specs) {
      const c = document.createElement('canvas'); c.width = sp.w || 160; c.height = sp.h || 120;
      const x = c.getContext('2d');
      // a structured picture: gradient, stripes and a block, so a shift of one pixel shows
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
`;

// The figure the layered SVG must reproduce: a crop, a tilted crop, a 90° turn, a merge,
// a circular crop, borders, a scale bar, headings with marked-up text, a linked inset and
// a hidden panel leaving its gap.
async function buildFigure(page) {
  await page.evaluate(HELPERS);
  await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }, { name: 'b.png', a: '#106030', b: '#f0f0f0' }, { name: 'c.png', a: '#501070', b: '#40e0e0' },
      { name: 'd.png', a: '#802010', b: '#2080ff' }, { name: 'e.png', a: '#303030', b: '#ffffff' }, { name: 'f.png' }]);
    sv('cols', '4'); sv('rows', '2'); sv('panel-w', '150'); sv('panel-h', '120'); sv('gap-h', '6'); sv('gap-v', '6');
    sv('hidden-gap', 'gap');
    images[0].cropL = 10; images[0].cropR = 15; images[0].cropT = 5;            // crop
    images[1].cropL = 10; images[1].cropR = 10; images[1].cropT = 10; images[1].cropB = 10; images[1].cropAngle = 12;  // tilt
    images[2].rotate = 90;                                                        // turn
    images[3].name = 'cells_DAPI.tif'; images[3].lut = 'blue';                    // merge
    images[3].channels.push({ name: 'cells_GFP.tif', img: images[4].img, src: images[4].src, lut: 'green', blackPt: 0, whitePt: 255 });
    images[4].cropShape = 'circle';                                               // shaped crop
    images[5].excluded = true;                                                    // hidden, leaves a gap
    sv('panel-border-w', '2'); sv('panel-border-c', '#202020');                   // borders
    images[0].umPerPx = 0.5; images[0].sbOn = true; images[0].sbUm = 20; sc('sb-text', true);   // scale bar
    sc('show-col-labels', true); sc('show-row-labels', true);
    sv('fig-title', 'Growth of *E. coli* in 10^{3} cells');
    onLayoutChange(); render();
    const cols = document.querySelectorAll('#col-label-inputs input');
    if (cols[0]) { cols[0].value = '*E. coli* WT'; cols[0].dispatchEvent(new Event('input')); }
    selectedPanel = 0; addLinkedInset(0.2, 0.2, 0.3, 0.3);                        // linked inset
    render();
  });
}

test('layered SVG: one layer per panel, each with one picture, named after its letter', async ({ page }) => {
  const errors = await loadApp(page);
  await buildFigure(page);
  const r = await page.evaluate(async () => {
    const svg = await __svgCap('layered');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const parseErr = doc.getElementsByTagName('parsererror').length;
    const INK = 'http://www.inkscape.org/namespaces/inkscape';
    const groups = [...doc.documentElement.children].filter(e => e.tagName === 'g');
    const panels = groups.filter(g => g.id.startsWith('panel-'));
    const drawn = _figurePanels().filter(im => im.img).map(im => formatLabel(im.label) || '');
    return {
      parseErr, drawn,
      ids: panels.map(g => g.id),
      labels: panels.map(g => g.getAttributeNS(INK, 'label')),
      layers: groups.every(g => g.getAttributeNS(INK, 'groupmode') === 'layer'),
      imagesPer: panels.map(g => g.getElementsByTagName('image').length),
      top: groups.map(g => g.id),
      desc: doc.querySelector('desc')?.textContent || '',
      clip: !!doc.querySelector('clipPath circle'),
      inkNs: svg.includes('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'),
    };
  });
  // Without the layered writer there are no panel-* groups at all: the flat SVG is one <image>.
  expect(r.parseErr).toBe(0);
  expect(r.inkNs).toBe(true);
  expect(r.layers).toBe(true);
  expect(r.ids.length).toBe(r.drawn.length);
  expect(r.imagesPer.every(n => n === 1)).toBe(true);
  r.drawn.filter(Boolean).forEach(l => expect(r.ids).toContain('panel-' + l));
  r.drawn.filter(Boolean).forEach(l => expect(r.labels).toContain('Panel ' + l));
  expect(r.top).toEqual(expect.arrayContaining(['background', 'headings']));
  expect(r.clip).toBe(true);                       // the circular crop is a clipPath, not baked pixels
  expect(r.desc).toMatch(/Every panel is its own layer/);
  expect(errors).toEqual([]);
});

// 150 dpi and a printed width are the cases that caught the picture scale: the render is
// round(W·S) px wide but drawn at exactly S, and pictures placed at device px ÷ S drifted
// by up to a pixel across the figure (3–5 grey levels at 150 dpi, 5.3 at 89 mm). The old
// 150/300-dpi pair passed only because this figure's W·S happened to be nearly whole.
test('layered SVG looks like the flat SVG and the PNG export, pixel for pixel', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await loadApp(page);
  await buildFigure(page);
  for (const [dpi, mm] of [['72', '0'], ['150', '0'], ['300', '0'], ['150', '89'], ['300', '183']]) {
    const r = await page.evaluate(async ([dpi, mm]) => {
      sv('export-dpi', dpi); sv('export-width-mm', mm); render();
      const layered = await __svgCap('layered');
      const flat = await __svgCap('flat');
      const c = renderExportCanvas(getExportDPI());
      const png = await _captureDownload(() => exportPNGWithMeta('f', c._effDpi, c));
      const P = await __pngData(png.data);
      const L = await __raster(layered, P.width, P.height), F = await __raster(flat, P.width, P.height);
      // one panel layer moved by 1 px must be detectable: the comparison is not blind to shifts
      const doc = new DOMParser().parseFromString(layered, 'image/svg+xml');
      doc.querySelector('g[id^="panel-"]').setAttribute('transform', 'translate(1 0)');
      const shifted = await __raster(new XMLSerializer().serializeToString(doc), P.width, P.height);
      return { LF: __diff(L, F), LP: __diff(L, P), FP: __diff(F, P), shift: __diff(shifted, L), w: P.width };
    }, [dpi, mm]);
    console.log(`dpi ${dpi} width ${mm} mm: ${r.w}px  layered~flat ${r.LF.mad.toFixed(3)}  layered~png ${r.LP.mad.toFixed(3)}  flat~png ${r.FP.mad.toFixed(3)}  shifted ${r.shift.mad.toFixed(3)}`);
    expect(r.LF.mad).toBeLessThan(1.5);
    // Layered against PNG is bounded by the flat SVG against PNG: both put the same text
    // through the SVG renderer, whose anti-aliasing differs from the canvas by about a grey
    // level at small sizes on some systems (1.08 flat~png at 150 dpi / 89 mm on Linux CI).
    // The layered file must add nothing of its own on top of that.
    expect(r.LP.mad).toBeLessThan(Math.max(1.0, r.FP.mad + 0.15));
    expect(r.LP.mad).toBeLessThan(1.5);
    expect(r.LF.big).toBeLessThan(0.002);
    expect(r.shift.mad).toBeGreaterThan(r.LF.mad);   // a 1-px shift of one panel is visible to this test
  }
  expect(errors).toEqual([]);
});

test('moving a panel layer moves its letter and scale bar with it', async ({ page }) => {
  const errors = await loadApp(page);
  await buildFigure(page);
  const r = await page.evaluate(async () => {
    const svg = await __svgCap('layered');
    // Put the SVG in the page so the browser lays it out, then move panel A's layer.
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:713px';
    host.innerHTML = svg.replace(/^<\?xml[^>]*>/, ''); document.body.appendChild(host);
    const root = host.querySelector('svg'); root.setAttribute('width', '713'); root.setAttribute('height', '354');
    const g = root.querySelector('#panel-A');
    const letter = [...g.querySelectorAll('text')].find(t => t.textContent === 'A');
    const bar = [...g.querySelectorAll('text')].find(t => /µm/.test(t.textContent));
    const sbRect = [...g.querySelectorAll('rect')].find(e => e.getAttribute('fill') === '#ffffff' && +e.getAttribute('height') < 10);
    const pos = () => [letter, bar, sbRect, g.querySelector('image')].map(e => e ? e.getBoundingClientRect().x : null);
    const before = pos();
    g.setAttribute('transform', 'translate(40 0)');
    const after = pos();
    // and nothing of panel A is left outside its layer
    const outside = [...root.querySelectorAll('text')].filter(t => t.textContent === 'A' && !g.contains(t)).length;
    host.remove();
    return { before, after, outside };
  });
  // In the flat SVG (before this change) there is no #panel-A, so g is null and this throws.
  r.before.forEach(v => expect(v).not.toBeNull());
  r.after.forEach((v, i) => expect(v - r.before[i]).toBeCloseTo(40, 0));
  expect(r.outside).toBe(0);
  expect(errors).toEqual([]);
});

test('a panel that cannot be its own layer is flattened, and the file and the toast say which and why', async ({ page }) => {
  const errors = await loadApp(page);
  await buildFigure(page);
  const r = await page.evaluate(async () => {
    sv('export-dpi', '150');
    // a magnified inset (figure-level "inset" mark) copying from panel B onto panel B
    const b = panelBounds.find(p => p.idx === 1), W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'inset', xf: (b.x + 20) / W, yf: (b.y + 20) / H, x2f: (b.x + 60) / W, y2f: (b.y + 50) / H, color: '#ffff00', width: 2 });
    render();
    const said = []; const rt = window.toast; window.toast = (m) => said.push(String(m));
    let svg; const rd = window.dl;
    window.dl = async (u) => { svg = await (await fetch(u)).text(); };
    sv('export-svg-mode', 'layered');
    exportSVG('f', getExportDPI(), document.getElementById('fig-canvas'));
    await new Promise(res => setTimeout(res, 50));
    window.dl = rd; window.toast = rt;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const c = renderExportCanvas(getExportDPI());
    const png = await _captureDownload(() => exportPNGWithMeta('f', c._effDpi, c));
    const P = await __pngData(png.data);
    const Lr = await __raster(svg, P.width, P.height);
    return { desc: doc.querySelector('desc').textContent, toast: said.join(' | '),
      ids: [...doc.documentElement.children].map(e => e.id).filter(Boolean),
      flatLabel: doc.getElementById('flattened')?.getAttribute('inkscape:label'),
      diff: __diff(Lr, P) };
  });
  // Without the fallback the inset's copy has no picture to come from: panel B would be a
  // layer of its own and nothing would name it.
  expect(r.desc).toMatch(/Not layered, flattened into one picture instead: B \(a magnified inset copies its pixels\)/);
  expect(r.toast).toMatch(/flattened: B \(a magnified inset/);
  expect(r.ids).not.toContain('panel-B');
  expect(r.ids).toContain('panel-A');
  expect(r.flatLabel).toMatch(/Flattened panels: B/);
  expect(r.diff.mad).toBeLessThan(1.5);           // and it still looks like the PNG, inset and all
  expect(errors).toEqual([]);
});

test('layered SVG in freeform: each image object is a layer, stacking kept, and it matches the PNG', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 40, y: 40, w: 200, h: 150, iw: 200, ih: 150, fill: '#2a6f3a', label: 'A' },
    { type: 'rect', x: 180, y: 120, w: 160, h: 100, color: '#cc2222', strokeWidth: 3 },
    { type: 'image', x: 300, y: 60, w: 180, h: 180, iw: 120, ih: 120, fill: '#3355aa', label: 'B', rotation: 15 },
    { type: 'text', x: 60, y: 260, w: 300, h: 40, text: 'Growth of *E. coli*', fontSize: 18, color: '#111111' },
  ]);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    sv('export-dpi', '150'); render();
    const svg = await __svgCap('layered');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const top = [...doc.documentElement.children].filter(e => e.tagName === 'g').map(g => g.id);
    const c = renderExportCanvas(getExportDPI());
    const png = await _captureDownload(() => exportPNGWithMeta('f', c._effDpi, c));
    const P = await __pngData(png.data);
    const L = await __raster(svg, P.width, P.height);
    return { top, diff: __diff(L, P), rotB: doc.getElementById('panel-B')?.getAttribute('transform') };
  });
  // Before this change freeform SVG had no layers: one picture with vector charts on top.
  expect(r.top.filter(id => id.startsWith('panel-'))).toEqual(['panel-A', 'panel-B']);
  // the red box sits between A and B, so it is a layer of its own between them
  const iA = r.top.indexOf('panel-A'), iB = r.top.indexOf('panel-B');
  expect(r.top.slice(iA + 1, iB).some(id => id.startsWith('objects-'))).toBe(true);
  expect(r.rotB).toMatch(/rotate\(15 /);
  expect(r.diff.mad).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

test('freeform with a magnified inset: the objects are flattened together, the inset painted, and the file says so', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 40, y: 40, w: 200, h: 150, iw: 200, ih: 150, fill: '#2a6f3a', label: 'A' },
    { type: 'image', x: 300, y: 60, w: 180, h: 180, iw: 120, ih: 120, fill: '#3355aa', label: 'B' },
  ]);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    sv('export-dpi', '150'); render();
    const W = canvasLogicalW, H = canvasLogicalH;
    annotations.push({ type: 'inset', xf: 50 / W, yf: 50 / H, x2f: 110 / W, y2f: 100 / H, color: '#ffff00', width: 2 });
    render();
    const svg = await __svgCap('layered');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const c = renderExportCanvas(getExportDPI());
    const png = await _captureDownload(() => exportPNGWithMeta('f', c._effDpi, c));
    const P = await __pngData(png.data);
    return { desc: doc.querySelector('desc').textContent, diff: __diff(await __raster(svg, P.width, P.height), P),
      panels: [...doc.documentElement.children].filter(g => g.id.startsWith('panel-')).length };
  });
  // Separate layers would lose the magnified copy, which is painted from the pixels under it.
  expect(r.panels).toBe(0);
  expect(r.desc).toMatch(/flattened into one picture instead: A \(a magnified inset copies its pixels\); B/);
  expect(r.diff.mad).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

// ── B: PowerPoint ─────────────────────────────────────────────────────────────
async function pptxOf(page) {
  return page.evaluate(async () => {
    let url = null; const rd = window.dl;
    window.dl = (u, n) => { if (String(n).endsWith('.pptx')) url = u; };
    try { await exportPPTX(); } finally { window.dl = rd; }
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const z = await __unzip(bytes);
    const parser = new DOMParser(), xml = {}, errs = [];
    for (const n in z) if (/\.(xml|rels)$/.test(n)) {
      const t = new TextDecoder().decode(z[n].data); xml[n] = t;
      if (parser.parseFromString(t, 'application/xml').getElementsByTagName('parsererror').length) errs.push(n);
    }
    // every relationship target exists in the package
    const missing = [];
    for (const n in xml) if (n.endsWith('.rels')) {
      const base = n.replace(/_rels\/[^/]*\.rels$/, '');
      const d = parser.parseFromString(xml[n], 'application/xml');
      for (const rel of d.getElementsByTagName('Relationship')) {
        if (rel.getAttribute('TargetMode') === 'External') continue;
        const parts = (base + rel.getAttribute('Target')).split('/'), out = [];
        parts.forEach(p => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
        if (!z[out.join('/')]) missing.push(n + ' → ' + rel.getAttribute('Target'));
      }
    }
    const slide = parser.parseFromString(xml['ppt/slides/slide1.xml'], 'application/xml');
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    const boxes = [...slide.getElementsByTagNameNS(P, 'sp')].filter(s => s.getElementsByTagNameNS(P, 'cNvSpPr')[0]?.getAttribute('txBox') === '1')
      .map(s => ({ text: [...s.getElementsByTagNameNS(A, 't')].map(t => t.textContent).join(''),
        runs: [...s.getElementsByTagNameNS(A, 'r')].map(r => { const p = r.getElementsByTagNameNS(A, 'rPr')[0];
          return { t: r.getElementsByTagNameNS(A, 't')[0].textContent, i: p.getAttribute('i'), b: p.getAttribute('b'), base: p.getAttribute('baseline'), sz: +p.getAttribute('sz') }; }),
        rot: s.getElementsByTagNameNS(A, 'xfrm')[0].getAttribute('rot') }));
    const pics = [...slide.getElementsByTagNameNS(P, 'pic')].map(p => p.getElementsByTagNameNS(P, 'cNvPr')[0].getAttribute('name'));
    const shapes = [...slide.getElementsByTagNameNS(P, 'sp')].map(s => s.getElementsByTagNameNS(P, 'cNvPr')[0].getAttribute('name'));
    const ct = xml['[Content_Types].xml'];
    const notes = xml['ppt/notesSlides/notesSlide1.xml'] || '';
    const pres = xml['ppt/presentation.xml'];
    return { names: Object.keys(z), errs, missing, boxes, pics, shapes, notes, ct, pres,
      bytes: Array.from(bytes) };
  });
}

test('PowerPoint: a valid package with one picture per panel and every letter, heading and the title as editable text', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await loadApp(page);
  await buildFigure(page);
  const r = await pptxOf(page);
  const drawn = await page.evaluate(() => _figurePanels().filter(im => im.img).map(im => formatLabel(im.label)));
  expect(r.errs).toEqual([]);
  expect(r.missing).toEqual([]);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/notesMasters/notesMaster1.xml'])
    expect(r.names).toContain(n);
  // One picture per panel, named after it (before: one picture per CELL with the letters baked in).
  expect(r.pics.filter(n => /^Panel /.test(n)).length).toBe(drawn.length);
  // The letters, headings and title are text boxes now; before, only the title was.
  const texts = r.boxes.map(b => b.text);
  drawn.forEach(l => expect(texts).toContain(l));
  expect(texts).toContain('E. coli WT');
  expect(texts).toContain('Row 1');
  expect(texts).toContain('Growth of E. coli in 103 cells');
  expect(texts).toContain('20 µm');
  // *E. coli* is an italic run; ^{3} a superscript run
  const title = r.boxes.find(b => b.text === 'Growth of E. coli in 103 cells');
  expect(title.runs.find(x => x.t === 'E. coli').i).toBe('1');
  expect(title.runs.find(x => x.t === '3').base).toBe('30000');
  expect(r.boxes.find(b => b.text === 'Row 1').rot).toBe(String(270 * 60000));    // row headings turned
  expect(r.shapes).toContain('Scale bar');
  expect(r.shapes.filter(n => n === 'Border').length).toBe(drawn.length);
  expect(r.notes).toMatch(/Printed size: [\d.]+ × [\d.]+ mm/);
  expect(r.pres).toMatch(/notesMasterIdLst/);
  // python's zipfile reads it and finds every entry intact
  const f = path.join(os.tmpdir(), `fl-handoff-${process.pid}.pptx`);
  fs.writeFileSync(f, Buffer.from(r.bytes));
  try {
    const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))', f]).toString().trim().split('\n');
    expect(out[0]).toBe('None');
    expect(+out[1]).toBe(r.names.length);
  } finally { fs.unlinkSync(f); }
  expect(errors).toEqual([]);
});

test('PowerPoint works in freeform: image objects are pictures, text objects and labels are text boxes', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', x: 40, y: 40, w: 200, h: 150, iw: 200, ih: 150, fill: '#2a6f3a', label: 'A' },
    { type: 'image', x: 300, y: 60, w: 180, h: 180, iw: 120, ih: 120, fill: '#3355aa', label: 'B', rotation: 15 },
    { type: 'text', x: 60, y: 260, w: 300, h: 40, text: 'Growth of *E. coli*', fontSize: 18, color: '#111111' },
  ]);
  await page.evaluate(HELPERS);
  const r = await pptxOf(page);
  // Before this change the export refused freeform ("PowerPoint export works in grid mode") and wrote nothing.
  expect(r.errs).toEqual([]);
  expect(r.missing).toEqual([]);
  expect(r.pics.filter(n => /^Panel /.test(n)), JSON.stringify(r.pics)).toEqual(['Panel A', 'Panel B']);
  const t = r.boxes.find(b => b.text === 'Growth of E. coli');
  expect(t).toBeTruthy();
  expect(t.runs.find(x => x.t === 'E. coli').i).toBe('1');
  expect(r.boxes.map(b => b.text)).toEqual(expect.arrayContaining(['A', 'B']));
  expect(r.boxes.find(b => b.text === 'B').rot).toBe(String(15 * 60000));
  expect(errors).toEqual([]);
});

// ── C: Batch Export ───────────────────────────────────────────────────────────
test('Batch Export renders each panel at the target DPI, writes its true resolution, and hands over one ZIP', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    // 300 px of one-pixel stripes, drawn into a 100-px cell: the preview can only show grey.
    const c = document.createElement('canvas'); c.width = 300; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 300, 300);
    x.fillStyle = '#fff'; for (let i = 0; i < 300; i += 2) x.fillRect(i, 0, 1, 300);
    const src = c.toDataURL('image/png');
    await new Promise(res => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'stripes.png'); res(); }; img.src = src; });
    sv('cols', '1'); sv('rows', '1'); sv('panel-w', '100'); sv('panel-h', '100');
    ['m-top', 'm-left', 'm-btm', 'm-right', 'gap-h', 'gap-v'].forEach(id => sv(id, '0'));
    sc('show-labels', false); sv('fig-title', '');
    // the panel prints 1 inch wide (a printed width the list does not offer, added for the test)
    document.getElementById('export-width-mm').add(new Option('25.4 mm', '25.4'));
    sv('export-dpi', '300'); sv('export-width-mm', '25.4');
    onLayoutChange(); render();
    const calls = []; const rd = window.dl; let url = null;
    window.dl = (u, n) => { calls.push(n); url = u; };
    try { await batchExportPanels(); } finally { window.dl = rd; }
    const z = await __unzip(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    const pngName = Object.keys(z).find(n => n.endsWith('.png'));
    const png = z[pngName].data;
    // pHYs: pixels per metre on both axes, unit 1
    let phys = null;
    for (let p = 8; p < png.length;) { const dv = new DataView(png.buffer, png.byteOffset + p);
      const len = dv.getUint32(0), type = String.fromCharCode(...png.subarray(p + 4, p + 8));
      if (type === 'pHYs') phys = [dv.getUint32(8), dv.getUint32(12), png[p + 16]];
      p += 12 + len; }
    const P = await __pngData(png);
    // the same panel enlarged from the 100-px preview, as Batch Export used to do it
    const prev = document.getElementById('fig-canvas');
    const u = document.createElement('canvas'); u.width = 300; u.height = 300;
    const ux = u.getContext('2d'); ux.imageSmoothingEnabled = true; ux.drawImage(prev, 0, 0, 100, 100, 0, 0, 300, 300);
    const U = ux.getImageData(0, 0, 300, 300);
    // contrast between neighbouring columns along one row
    const contrast = (d, w) => { let s = 0; for (let i = 1; i < w; i++) s += Math.abs(d.data[(150 * w + i) * 4] - d.data[(150 * w + i - 1) * 4]); return s / (w - 1); };
    return { calls, names: Object.keys(z), w: P.width, h: P.height, phys, cExport: contrast(P, P.width), cUpscaled: contrast(U, 300),
      txt: new TextDecoder().decode(z['PANELS.txt'].data) };
  });
  // Before: one download per panel (no ZIP), 300/96 × the 100-px preview = 313 px, enlarged
  // preview pixels, and a resolution that described the enlargement, not a 300-dpi render.
  expect(r.calls).toEqual(['figure-panels.zip']);
  expect(r.w).toBe(300);
  expect(r.h).toBe(300);
  expect(r.phys).toEqual([11811, 11811, 1]);
  expect(r.cExport).toBeGreaterThan(150);     // the stripes are there, one pixel each
  expect(r.cUpscaled).toBeLessThan(40);        // an enlarged preview is grey mush
  expect(r.txt).toMatch(/300 × 300 px, prints 25\.4 × 25\.4 mm at 300 dpi; the picture's own pixels give 300 ppi/);
  expect(errors).toEqual([]);
});

test('Batch Export writes TIFF (LZW when asked) and JPEG with its density, in grid and freeform', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(async () => { await __seed([{ name: 'a.png' }, { name: 'b.png' }]); sv('cols', '2'); sv('rows', '1'); onLayoutChange(); render(); });
  const grab = (fmt, lzw) => page.evaluate(async ([fmt, lzw]) => {
    sv('export-batch-fmt', fmt); sc('export-tiff-lzw', lzw); sv('export-dpi', '150');
    let url = null; const rd = window.dl; window.dl = (u) => { url = u; };
    try { await batchExportPanels(); } finally { window.dl = rd; }
    const z = await __unzip(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    return Object.entries(z).filter(([n]) => /panel_/.test(n)).map(([n, e]) => {
      const d = e.data, dv = new DataView(d.buffer, d.byteOffset);
      if (n.endsWith('.jpg')) return { n, units: d[13], dens: (d[14] << 8) | d[15] };
      if (!n.endsWith('.tiff')) return { n };
      const ifd = dv.getUint32(4, true), cnt = dv.getUint16(ifd, true), tags = {};
      for (let i = 0; i < cnt; i++) { const o = ifd + 2 + i * 12; tags[dv.getUint16(o, true)] = dv.getUint32(o + 8, true); }
      return { n, comp: tags[259] & 0xffff, xres: dv.getUint32(tags[282], true) / dv.getUint32(tags[282] + 4, true) };
    });
  }, [fmt, lzw]);
  const t = await grab('tiff', true);
  expect(t.length).toBe(2);
  t.forEach(f => { expect(f.n).toMatch(/\.tiff$/); expect(f.comp).toBe(5); expect(f.xres).toBe(150); });
  const j = await grab('jpeg', false);
  j.forEach(f => { expect(f.n).toMatch(/\.jpg$/); expect(f.units).toBe(1); expect(f.dens).toBe(150); });
  // freeform: the image objects, not the charts or shapes
  await seedFreeform(page, [
    { type: 'image', x: 20, y: 20, w: 100, h: 80, label: 'A' },
    { type: 'rect', x: 150, y: 20, w: 50, h: 50 },
    { type: 'image', x: 220, y: 20, w: 100, h: 80, label: 'B' },
  ]);
  const f = await grab('png', false);
  // Before: freeform filtered panelBounds by images[] (the grid's list) and exported nothing.
  expect(f.map(x => x.n)).toEqual(['figure_panel_1_A.png', 'figure_panel_2_B.png']);
  expect(errors).toEqual([]);
});

// ── D: the ZIP writer ─────────────────────────────────────────────────────────
test('ZIP: text entries are deflated, compressed ones stored, and python reads every entry back intact', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  const r = await page.evaluate(async () => {
    const enc = new TextEncoder();
    const csv = 'a,b,c\n' + Array.from({ length: 400 }, (_, i) => `${i},${i * 2},row ${i % 7}`).join('\n');
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 10, 10);
    const png = new Uint8Array(await (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer());
    const tiff = _tiffBytes(new Uint8Array(64 * 64 * 3).fill(200), 64, 64, 300);
    const noise = crypto.getRandomValues(new Uint8Array(4000));
    const files = [{ name: 'data.csv', data: csv }, { name: 'p.png', data: png }, { name: 'f.tiff', data: tiff },
      { name: 'µ-notes.txt', data: 'café '.repeat(100) }, { name: 'noise.bin', data: noise }, { name: 'tiny.json', data: '{}' }];
    const zip = await _zipMake(files);
    const z = await __unzip(zip);
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const orig = Object.fromEntries(files.map(f => [f.name, typeof f.data === 'string' ? enc.encode(f.data) : f.data]));
    return { bytes: Array.from(zip),
      entries: Object.fromEntries(Object.entries(z).map(([n, e]) => [n, { method: e.method, csize: e.csize, usize: e.usize, same: same(e.data, orig[n]), crc: e.crc === crc32(orig[n], 0, orig[n].length) }])) };
  });
  // Before: every entry method 0, csize === usize.
  expect(r.entries['data.csv'].method).toBe(8);
  expect(r.entries['data.csv'].csize).toBeLessThan(r.entries['data.csv'].usize / 3);
  expect(r.entries['f.tiff'].method).toBe(8);               // an uncompressed TIFF deflates
  expect(r.entries['µ-notes.txt'].method).toBe(8);
  expect(r.entries['p.png'].method).toBe(0);                // already compressed: stored
  expect(r.entries['noise.bin'].method).toBe(0);            // deflate did not help: stored
  expect(r.entries['tiny.json'].method).toBe(0);
  for (const n in r.entries) { expect(r.entries[n].same, n).toBe(true); expect(r.entries[n].crc, n).toBe(true); }
  const f = path.join(os.tmpdir(), `fl-handoff-${process.pid}.zip`);
  fs.writeFileSync(f, Buffer.from(r.bytes));
  try {
    const out = execFileSync('python3', ['-I', '-c',
      'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(json.dumps({i.filename:[i.compress_type,i.file_size,len(z.read(i))] for i in z.infolist()}))', f]).toString().trim().split('\n');
    expect(out[0]).toBe('None');
    const info = JSON.parse(out[1]);
    expect(info['data.csv'][0]).toBe(8);
    expect(info['p.png'][0]).toBe(0);
    for (const n in info) expect(info[n][1]).toBe(info[n][2]);
  } finally { fs.unlinkSync(f); }
  expect(errors).toEqual([]);
});

test('the submission package is deflated and still unzips to the same files', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await loadApp(page);
  await page.evaluate(HELPERS);
  await page.evaluate(async () => { await __seed([{ name: 'a.png' }, { name: 'b.png' }]); sv('cols', '2'); sv('rows', '1'); sv('export-dpi', '150'); onLayoutChange(); render(); });
  const r = await page.evaluate(async () => {
    const cap = await _captureDownload(() => exportSubmissionPackage());
    const z = await __unzip(cap.data);
    const m = Object.fromEntries(Object.entries(z).map(([n, e]) => [n, e.method]));
    return { m, readme: new TextDecoder().decode(z['README.txt'].data).slice(0, 40), bytes: Array.from(cap.data) };
  });
  // Before: README.txt, the CSV and the SVG were stored (method 0).
  expect(r.m['README.txt']).toBe(8);
  expect(Object.entries(r.m).filter(([n]) => n.endsWith('.png')).every(([, v]) => v === 0)).toBe(true);
  expect(r.readme.length).toBeGreaterThan(10);
  const f = path.join(os.tmpdir(), `fl-handoff-pkg-${process.pid}.zip`);
  fs.writeFileSync(f, Buffer.from(r.bytes));
  try { expect(execFileSync('python3', ['-I', '-c', 'import sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).testzip())', f]).toString().trim()).toBe('None'); }
  finally { fs.unlinkSync(f); }
  expect(errors).toEqual([]);
});
