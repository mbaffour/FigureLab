// @ts-check
// Inline formatting in labels: *italic*, **bold**, ^{superscript}, _{subscript}.
// One parser (_rtParse) decides; every figure text draws, measures and exports through
// it. The first block is the guarantee that matters most: significance stars and any
// other text that was never meant as markup come out exactly as they did before.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

// Record every fillText/strokeText with the font and transform it was drawn with.
const RECORD = () => {
  const P = CanvasRenderingContext2D.prototype;
  if (!P._rtRecOrig) {
    P._rtRecOrig = { fill: P.fillText, stroke: P.strokeText };
    P.fillText = function (t, x, y, ...r) { if (window._rec) window._rec.push({ op: 'fill', t: String(t), x, y, font: this.font, align: this.textAlign, base: this.textBaseline, m: (({ a, b, c, d, e, f }) => ({ a, b, c, d, e, f }))(this.getTransform()), cv: this.canvas && this.canvas.id }); return P._rtRecOrig.fill.call(this, t, x, y, ...r); };
    P.strokeText = function (t, x, y, ...r) { if (window._rec) window._rec.push({ op: 'stroke', t: String(t), x, y, font: this.font, cv: this.canvas && this.canvas.id }); return P._rtRecOrig.stroke.call(this, t, x, y, ...r); };
  }
  window._rec = [];
};

// Capture what the app hands to dl() (a blob/data URL) as text or bytes.
async function grab(page, fn, asText) {
  return page.evaluate(async ({ fn, asText }) => {
    let cap = null; const real = window.dl; window.dl = (u) => { cap = u; };
    try { await (new Function('return (async()=>{' + fn + '})()'))(); } finally { window.dl = real; }
    const r = await fetch(cap);
    return asText ? await r.text() : Array.from(new Uint8Array(await r.arrayBuffer()));
  }, { fn, asText });
}

const LITERAL = ['*', '**', '***', '* p < 0.05', '*p<0.05, **p<0.01', 'n.s.', 'a*b', 'WT*, KO*', 'WT*/KO*',
  'p < 0.05*', '****', '* *', '*p<0.05', 'Δ*', '10^8', 'H_2O', 'x_1', '2^n', 'a ^ b', '__init__', 'a**b',
  '**p<0.01 vs *p<0.05', '*E. coli', 'E. coli*', '* vs **', '***p<0.001', '^{unclosed', 'Col 1'];

test('text that was never markup stays literal: significance stars, carets, underscores', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate((L) => L.map(s => ({ s, has: _rtHas(s), runs: _rtRuns(s), plain: _rtPlain(s) })), LITERAL);
  for (const x of r) {
    expect(x.has, x.s).toBe(false);
    expect(x.runs, x.s).toEqual([{ t: x.s, i: false, b: false, sup: false, sub: false }]);
    expect(x.plain, x.s).toBe(x.s);
  }
  expect(errors).toEqual([]);
});

test('the marks give the right runs: italic, bold, nesting, super/subscript, escapes, plain text', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const f = s => _rtRuns(s).map(q => q.t + '[' + (q.i ? 'i' : '') + (q.b ? 'b' : '') + (q.sup ? '^' : '') + (q.sub ? '_' : '') + ']');
    const C = ['*E. coli* 10^{8}', '**bold** and *it*', '**E. coli *fliC***', '***both***', '***E. coli* strain**', 'Ca^{2+}', 'H_{2}O',
      '10^{-3} PFU/mL', '*E. coli* Δ*fliC*', '\\*E\\* lit', 'a\\\\b', '\\^{x}', '*p* < 0.05', 'x^{*a*}'];
    return C.map(s => ({ s, runs: f(s), plain: _rtPlain(s), has: _rtHas(s) }));
  });
  const by = Object.fromEntries(r.map(x => [x.s, x]));
  expect(by['*E. coli* 10^{8}'].runs).toEqual(['E. coli[i]', ' 10[]', '8[^]']);
  expect(by['*E. coli* 10^{8}'].plain).toBe('E. coli 10⁸');
  expect(by['**bold** and *it*'].runs).toEqual(['bold[b]', ' and []', 'it[i]']);
  expect(by['**E. coli *fliC***'].runs).toEqual(['E. coli [b]', 'fliC[ib]']);           // italic inside bold
  expect(by['***both***'].runs).toEqual(['both[ib]']);
  expect(by['***E. coli* strain**'].runs).toEqual(['E. coli[ib]', ' strain[b]']);
  expect(by['Ca^{2+}'].runs).toEqual(['Ca[]', '2+[^]']);
  expect(by['Ca^{2+}'].plain).toBe('Ca²⁺');
  expect(by['H_{2}O'].runs).toEqual(['H[]', '2[_]', 'O[]']);
  expect(by['H_{2}O'].plain).toBe('H₂O');
  expect(by['10^{-3} PFU/mL'].plain).toBe('10⁻³ PFU/mL');
  expect(by['*E. coli* Δ*fliC*'].runs).toEqual(['E. coli[i]', ' Δ[]', 'fliC[i]']);
  expect(by['\\*E\\* lit'].runs).toEqual(['*E* lit[]']);                                  // escapes: literal stars
  expect(by['\\*E\\* lit'].has).toBe(true);                                               // …and the backslashes go
  expect(by['a\\\\b'].plain).toBe('a\\b');
  expect(by['\\^{x}'].plain).toBe('^{x}');
  expect(by['*p* < 0.05'].runs).toEqual(['p[i]', ' < 0.05[]']);
  expect(by['x^{*a*}'].runs).toEqual(['x[]', 'a[i^]']);                                   // nested in a group
  expect(by['x^{*a*}'].plain).toBe('xa');
  expect(errors).toEqual([]);
});

// A 2-column grid with a marked-up column heading, drawn on screen.
async function headingFigure(page, col0, extra) {
  await seedPanels(page, 2);
  await page.evaluate(({ col0, extra }) => {
    sv('cols', '2'); sv('rows', '1'); sv('axis-fs', '20'); sc('show-col-labels', true); onLayoutChange();
    const ins = [...document.querySelectorAll('#col-label-inputs input')];
    ins[0].value = col0; ins[1].value = 'WT*, KO*';
    if (extra) new Function(extra)();
    render();
  }, { col0, extra });
}

test('a heading "*E. coli* 10^{8}" draws an italic run and a smaller, raised 8, measured as the sum of its runs', async ({ page }) => {
  const errors = await loadApp(page);
  await headingFigure(page, '*E. coli* 10^{8}');
  const r = await page.evaluate((REC) => {
    new Function('(' + REC + ')()')();
    render();
    const rec = window._rec.filter(q => q.cv === 'fig-canvas'); window._rec = null;
    const it = figTextItems.find(t => t.kind === 'col' && t.idx === 0);
    const it1 = figTextItems.find(t => t.kind === 'col' && t.idx === 1);
    const runs = rec.filter(q => ['E. coli', ' 10', '8'].includes(q.t));
    const mc = document.createElement('canvas').getContext('2d');
    const widths = runs.map(q => { mc.font = q.font; return mc.measureText(q.t).width; });
    const pw = gi('panel-w'), colCentre = it.x;   // emitText was given the column centre
    return { runs, widths, bboxW: it.bbox.w, hasRuns: !!it.runs, lit: rec.filter(q => q.t.includes('*') && q.t !== 'WT*, KO*').length,
      other: { runs: !!it1.runs, drawn: rec.some(q => q.t === 'WT*, KO*') }, colCentre, pw };
  }, RECORD.toString());
  expect(r.hasRuns).toBe(true);
  expect(r.lit).toBe(0);                                   // no star is painted
  expect(r.runs.map(q => q.t)).toEqual(['E. coli', ' 10', '8']);
  const [ital, base, sup] = r.runs;
  expect(ital.font).toMatch(/italic/);
  expect(base.font).not.toMatch(/italic/);
  const px = f => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
  expect(px(sup.font)).toBeCloseTo(px(base.font) * 0.7, 1);
  expect(sup.y).toBeLessThan(base.y - px(base.font) * 0.3);      // raised by ~35% of the size
  expect(ital.y).toBeCloseTo(base.y, 5);                          // one shared baseline
  // contiguous: each run starts where the last one ended
  expect(base.x).toBeCloseTo(ital.x + r.widths[0], 3);
  expect(sup.x).toBeCloseTo(base.x + r.widths[1], 3);
  // the recorded width (hit-test, de-overlap, SVG/PDF placement) is the sum of the runs
  expect(r.bboxW).toBeCloseTo(r.widths.reduce((a, b) => a + b, 0), 3);
  // centred as a whole: the runs span colCentre ± w/2
  expect((ital.x + sup.x + r.widths[2]) / 2).toBeCloseTo(r.colCentre, 3);
  // the other heading has stars only, so it takes the plain path untouched
  expect(r.other).toEqual({ runs: false, drawn: true });
  expect(errors).toEqual([]);
});

test('the centred heading\'s ink is centred on its column (pixels)', async ({ page }) => {
  const errors = await loadApp(page);
  await headingFigure(page, '*E. coli* 10^{8}', "sc('show-labels', false);");
  const r = await page.evaluate(() => {
    const it = figTextItems.find(t => t.kind === 'col' && t.idx === 0);
    const cv = document.getElementById('fig-canvas'), ctx = cv.getContext('2d');
    const S = cv.width / canvasLogicalW;
    const pb = panelBounds.find(p => p.idx === 0);
    // from a size above the heading's middle down to just above the panel: the label band only
    const y0 = Math.floor((it.y - it.fs) * S), y1 = Math.floor((pb.y - 1) * S);
    const x0 = Math.floor(pb.x * S), x1 = Math.ceil((pb.x + pb.w) * S);
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let lo = 1e9, hi = -1;
    for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < x1 - x0; x++) {
      const i = (y * (x1 - x0) + x) * 4; if (d[i] < 128) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    return { ink: ((x0 + lo) + (x0 + hi + 1)) / 2 / S, centre: pb.x + pb.w / 2, lo, hi, runs: !!it.runs, inkW: (hi + 1 - lo) / S, rawW: (ctx.font = it.font, ctx.measureText(it.str).width) };
  });
  expect(r.runs).toBe(true);
  expect(r.inkW).toBeGreaterThan(40);
  expect(r.inkW).toBeLessThan(r.rawW - 10);       // the marks are not drawn: narrower than the typed string
  expect(r.hi).toBeGreaterThan(r.lo);
  expect(Math.abs(r.ink - r.centre)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

// Each run is set on the alphabetic baseline the plain label would have had, whatever
// baseline the label asks for (the title hangs from 'top', headings sit on 'middle').
test('marked-up title and heading sit at the same height as the same words unmarked (ink rows)', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const ink = (title, head) => page.evaluate(({ title, head }) => {
    sv('cols', '2'); sv('rows', '1'); sv('axis-fs', '20'); sc('show-col-labels', true); sc('show-labels', false); onLayoutChange();
    sv('fig-title', title); document.querySelectorAll('#col-label-inputs input')[0].value = head; render();
    const cv = document.getElementById('fig-canvas'), ctx = cv.getContext('2d'), S = cv.width / canvasLogicalW;
    const rows = it => {            // first and last ink row inside the item's own column, above the panels
      const pb = panelBounds.find(p => p.idx === 0);
      const x0 = Math.floor((it.bbox.x) * S), x1 = Math.ceil((it.bbox.x + it.bbox.w) * S), y1 = Math.floor((pb.y - 1) * S);
      const d = ctx.getImageData(x0, 0, x1 - x0, y1).data; let lo = -1, hi = -1;
      for (let y = 0; y < y1; y++) for (let x = 0; x < x1 - x0; x++) if (d[(y * (x1 - x0) + x) * 4] < 128) { if (lo < 0) lo = y; hi = y; }
      return { lo: lo / S, hi: hi / S };
    };
    const t = figTextItems.find(x => x.kind === 'title'), c = figTextItems.find(x => x.kind === 'col' && x.idx === 0);
    return { title: rows(t), col: rows(c), runs: !!t.runs && !!c.runs };
  }, { title, head });
  // "E. coli 10" has no descender; the plain twin keeps the same letters, so the ink spans match
  const plain = await ink('E. coli Hd', 'E. coli Hd');
  const rich = await ink('*E. coli* Hd', '*E. coli* Hd');
  expect(plain.runs).toBe(false); expect(rich.runs).toBe(true);
  for (const k of ['title', 'col']) {
    expect(Math.abs(rich[k].lo - plain[k].lo), k).toBeLessThanOrEqual(1);
    expect(Math.abs(rich[k].hi - plain[k].hi), k).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('a rotated row heading draws its runs along the turned baseline', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate((REC) => {
    sv('cols', '1'); sv('rows', '2'); sv('axis-fs', '18'); sc('show-row-labels', true); onLayoutChange();
    document.querySelectorAll('#row-label-inputs input')[0].value = '*E. coli* 10^{8}';
    new Function('(' + REC + ')()')(); render();
    const rec = window._rec.filter(q => q.cv === 'fig-canvas'); window._rec = null;
    return rec.filter(q => ['E. coli', ' 10', '8'].includes(q.t));
  }, RECORD.toString());
  expect(r.map(q => q.t)).toEqual(['E. coli', ' 10', '8']);
  for (const q of r) { expect(Math.abs(q.m.a)).toBeLessThan(1e-6); expect(q.m.b).toBeCloseTo(-1, 6); }   // turned −90°
  expect(r[0].font).toMatch(/italic/);
  expect(r[2].y).toBeLessThan(r[1].y);          // raised in the turned frame
  expect(r[1].x).toBeGreaterThan(r[0].x); expect(r[2].x).toBeGreaterThan(r[1].x);
  expect(errors).toEqual([]);
});

test('SVG export: one <text> with an italic tspan, a smaller superscript with a negative dy, and the dy restored', async ({ page }) => {
  const errors = await loadApp(page);
  await headingFigure(page, '*E. coli* 10^{8} PFU/mL');
  const svg = await grab(page, "await exportSVG('probe');", true);
  const m = /<text [^>]*>([^]*?<tspan[^]*?)<\/text>/.exec(svg);
  expect(m).not.toBeNull();
  const t = m[0];
  expect(t).toContain('<tspan font-style="italic">E. coli</tspan>');
  const sup = /<tspan font-size="([\d.]+)" dy="(-[\d.]+)">8<\/tspan><tspan dy="([\d.]+)"> PFU\/mL<\/tspan>/.exec(t);
  expect(sup).not.toBeNull();
  expect(+sup[1]).toBeCloseTo(14, 1);                 // 70% of the 20 px heading
  expect(+sup[2]).toBeCloseTo(-7, 2);                 // raised 35% of 20 px
  expect(+sup[3]).toBeCloseTo(7, 2);                  // and back down for what follows
  expect(t).toMatch(/text-anchor="middle"/);
  expect(t).not.toContain('*');
  // the stars-only heading is the plain <text> it always was
  expect(svg).toMatch(/<text [^>]*dominant-baseline="central"[^>]*>WT\*, KO\*<\/text>/);
  expect(errors).toEqual([]);
});

test('PDF export: italic run in Helvetica-Oblique, the superscript with a text rise, text in reading order', async ({ page }) => {
  const errors = await loadApp(page);
  await headingFigure(page, '*E. coli* 10^{8} PFU/mL');
  const bytes = await grab(page, "await _exportPDFWithText('probe', 150, { lossless: true });", false);
  const pdf = Buffer.from(bytes).toString('latin1');
  // font resources: key → base font
  const fonts = {};
  for (const m of pdf.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const o = new RegExp(m[2] + ' 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /([\\w-]+)').exec(pdf);
    if (o) fonts[m[1]] = o[1];
  }
  const bt = [...pdf.matchAll(/BT ([^]*?) ET/g)].map(m => m[1]).find(b => b.includes('(E. coli) Tj'));
  expect(bt).toBeTruthy();
  const runs = [...bt.matchAll(/\/(F\d+) ([\d.]+) Tf (-?[\d.]+) Ts \(([^)]*)\) Tj/g)].map(m => ({ font: fonts[m[1]], size: +m[2], rise: +m[3], t: m[4] }));
  expect(runs.map(q => q.t).join('')).toBe('E. coli 108 PFU/mL');            // extractable, in order
  expect(runs[0].font).toBe('Helvetica-Oblique');
  expect(runs[1].font).toBe('Helvetica');
  expect(runs[2].t).toBe('8');
  expect(runs[2].rise).toBeGreaterThan(0);
  expect(runs[2].size).toBeCloseTo(runs[1].size * 0.7, 2);
  expect(runs[3].rise).toBe(0);
  expect(bt).toMatch(/0 Ts$/);
  expect(pdf).not.toContain('(*E. coli*');
  expect(pdf).toContain('(WT*, KO*) Tj');                                    // the plain heading, as before
  expect(errors).toEqual([]);
});

test('a figure with no markup takes the plain path: no runs, no tspans, the same <text> and Tj as before', async ({ page }) => {
  const errors = await loadApp(page);
  await headingFigure(page, '*p<0.05, **p<0.01', "sv('fig-title','Figure 1 * p < 0.05'); images[0].label='a*b'; sv('label-format','custom'); sc('show-labels',true);");
  const svg = await grab(page, "await exportSVG('probe');", true);
  const r = await page.evaluate(() => {
    render();
    const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // the plain template, as the SVG writer has always written it
    return figTextItems.map(it => ({ runs: !!it.runs, legacy: `<text x="${it.x.toFixed(2)}" y="${it.y.toFixed(2)}" style="font:${it.font}" fill="${it.fill}" text-anchor="${it.align === 'center' ? 'middle' : 'start'}" dominant-baseline="${it.baseline === 'top' ? 'text-before-edge' : it.baseline === 'middle' ? 'central' : 'alphabetic'}"${it.rot ? ` transform="rotate(-90 ${it.x.toFixed(2)} ${it.y.toFixed(2)})"` : ''}>${esc(it.str)}</text>` }));
  });
  expect(r.length).toBeGreaterThanOrEqual(4);
  for (const x of r) { expect(x.runs).toBe(false); expect(svg).toContain(x.legacy); }
  expect(svg).not.toContain('<tspan');
  const pdf = Buffer.from(await grab(page, "await _exportPDFWithText('probe', 150, { lossless: true });", false)).toString('latin1');
  expect(pdf).toContain('(*p<0.05, **p<0.01) Tj ET');
  expect(pdf).toContain('(Figure 1 * p < 0.05) Tj ET');
  expect(pdf).not.toContain(' Ts ');
  expect(errors).toEqual([]);
});

test('caption, metadata CSV, legend text and alt text carry the plain form', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    sv('fig-title', '*E. coli* MG1655 at 10^{8} PFU/mL'); sv('label-format', 'custom');
    images[0].label = '*fliC*'; images[0].tag = 'Ca^{2+} 1 mM'; render();
    const cap = _captionText();
    let csv = null; const real = window.dl; window.dl = u => { csv = u; };
    try { exportCSV(); } finally { window.dl = real; }
    csv = await (await fetch(csv)).text();
    const key = _keyText([{ name: '*E. coli* ΔfliC', color: '#000000' }, { name: 'H_{2}O', color: '#e69f00' }]);
    return { cap, csv, key, alt: _buildStructuralAltText() };
  });
  expect(r.cap).toContain('Figure. E. coli MG1655 at 10⁸ PFU/mL.');
  expect(r.cap).toContain('(fliC) Ca²⁺ 1 mM');
  expect(r.csv).toContain(',fliC,');
  expect(r.key).toBe('E. coli ΔfliC (black); H₂O (orange).');
  expect(r.alt).toContain('Figure titled "E. coli MG1655 at 10⁸ PFU/mL".');
  for (const s of [r.cap, r.csv, r.key, r.alt]) { expect(s).not.toContain('*'); expect(s).not.toContain('^{'); }
  expect(errors).toEqual([]);
});

test('Ctrl+I and Ctrl+B wrap the selection in a heading field (real keyboard)', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const f = page.locator('#fig-title');
  await f.click(); await f.fill('E. coli strain');
  await page.evaluate(() => document.getElementById('fig-title').setSelectionRange(0, 7));
  await page.keyboard.press('Control+i');
  expect(await f.inputValue()).toBe('*E. coli* strain');
  await page.evaluate(() => { const t = document.getElementById('fig-title'); t.setSelectionRange(t.value.length, t.value.length); });
  await page.keyboard.type(' ');
  await page.keyboard.press('Control+b'); await page.keyboard.type('WT');
  expect(await f.inputValue()).toBe('*E. coli* strain **WT**');
  // the field keeps the marks; the figure draws them (the title item has runs)
  const r = await page.evaluate(() => { render(); const t = figTextItems.find(x => x.kind === 'title'); return { str: t.str, runs: t.runs && t.runs.map(q => q.t) }; });
  expect(r).toEqual({ str: '*E. coli* strain **WT**', runs: ['E. coli', ' strain ', 'WT'] });
  // outside the figure's text fields Ctrl+I is not ours: the export name is left alone
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'rt-probe'; i.value = 'fig1'; document.body.prepend(i); });
  const n = page.locator('#rt-probe'); await n.focus(); await page.evaluate(() => document.getElementById('rt-probe').select()); await n.press('Control+i');
  expect(await n.inputValue()).toBe('fig1');
  expect(errors).toEqual([]);
});

test('"Format marks in labels" off draws every label literally, and survives save and load', async ({ page }) => {
  const errors = await loadApp(page);
  await headingFigure(page, '*E. coli* 10^{8}');
  const r = await page.evaluate(() => {
    sc('format-marks', false); render();
    const it = figTextItems.find(t => t.kind === 'col' && t.idx === 0);
    const S = JSON.stringify(serializeSession(false));
    sc('format-marks', true);
    applySession(JSON.parse(S), { origin: 'file' }); render();
    const it2 = figTextItems.find(t => t.kind === 'col' && t.idx === 0);
    return { runs: !!it.runs, str: it.str, cap: _rtText('*E. coli*'), saved: JSON.parse(S).style.formatMarks, after: gc('format-marks'), runs2: !!it2.runs };
  });
  expect(r).toEqual({ runs: false, str: '*E. coli* 10^{8}', cap: '*E. coli*', saved: false, after: false, runs2: false });
  const svg = await grab(page, "await exportSVG('probe');", true);
  expect(svg).toContain('>*E. coli* 10^{8}</text>');
  expect(svg).not.toContain('<tspan');
  expect(errors).toEqual([]);
});

test('a text box wraps by drawn width and keeps its spans across lines; text annotations and freeform text draw runs', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate((REC) => {
    annotations.push({ type: 'textbox', xf: 0.02, yf: 0.05, x2f: 0.14, y2f: 0.9, text: '*Escherichia coli* grown at 10^{8} cells', fontSize: 16, color: '#ffffff', fillColor: '#000000', fillOpacity: 0.6, shape: 'rect' });
    annotations.push({ type: 'text', xf: 0.6, yf: 0.1, text: 'H_{2}O_{2} *', fontSize: 16, color: '#ffffff', halo: true });
    new Function('(' + REC + ')()')(); render();
    const rec = window._rec; window._rec = null;
    return rec.map(q => ({ t: q.t, op: q.op, font: q.font, y: q.y }));
  }, RECORD.toString());
  const it = r.filter(q => /Escherichia|coli/.test(q.t));
  expect(it.length).toBeGreaterThan(0);
  for (const q of it) expect(q.font).toMatch(/italic/);
  expect(new Set(it.map(q => q.y)).size).toBeGreaterThan(1);            // the species spans two lines, italic on both
  expect(r.some(q => q.t.includes('*E') || q.t.includes('coli*'))).toBe(false);
  const two = r.filter(q => q.t === '2' && q.op === 'fill' && /11\.2px/.test(q.font));   // not an empty cell's number
  expect(two.length).toBe(2);                                             // H₂O₂: two subscripts
  expect(r.some(q => q.op === 'stroke' && q.t === '2')).toBe(true);       // the halo follows the runs
  expect(r.some(q => q.t === 'O' || q.t === 'O ')).toBe(true);
  expect(r.some(q => q.t === ' *' || q.t.endsWith(' *'))).toBe(true);    // the lone star is a star
  // freeform text object
  const f = await page.evaluate((REC) => {
    const sel = document.getElementById('layout-mode'); sel.value = 'freeform'; setLayoutMode('freeform');
    addFreeformElement({ type: 'text', x: 20, y: 20, w: 120, h: 80, text: '*Bacillus subtilis* 168\nOD_{600}', fontSize: 16 });
    new Function('(' + REC + ')()')(); render();
    const rec = window._rec; window._rec = null; return rec.map(q => ({ t: q.t, font: q.font, y: q.y }));
  }, RECORD.toString());
  expect(f.filter(q => /Bacillus|subtilis/.test(q.t)).every(q => /italic/.test(q.font))).toBe(true);
  const sub = f.find(q => q.t === '600'), od = f.find(q => q.t === 'OD');
  expect(sub && od).toBeTruthy();
  expect(sub.y).toBeGreaterThan(od.y);
  expect(errors).toEqual([]);
});

test('charts and the legend key draw their names with runs; a chart\'s significance star stays a star', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const buf = []; const e = _chartEmitSVG(buf);
    e.text('*E. coli* 10^{8}', 50, 20, '12px system-ui', '#000', 'center', 'alphabetic');
    e.text('*', 50, 40, '12px system-ui', '#000', 'center', 'alphabetic');
    const kbuf = []; _keyEmitSVG(kbuf).text('**WT** *E. coli*', 0, 10, 'normal normal 12px Arial', '#000');
    const L = _keyLayout([{ name: '*E. coli* ΔfliC', color: '#000' }], 12, 'normal normal 12px Arial');
    const mc = document.createElement('canvas').getContext('2d'); mc.font = 'normal normal 12px Arial';
    return { chart: buf, key: kbuf[0], keyW: L.w, rawW: mc.measureText('*E. coli* ΔfliC').width, runW: _rtMeasure(mc, '*E. coli* ΔfliC') };
  });
  expect(r.chart[0]).toContain('<tspan font-style="italic">E. coli</tspan>');
  expect(r.chart[1]).toContain('>*</text>');
  expect(r.chart[1]).not.toContain('tspan');
  expect(r.key).toContain('<tspan font-weight="bold">WT</tspan>');
  expect(r.runW).toBeLessThan(r.rawW);                    // measured without the marks
  expect(errors).toEqual([]);
});

test('the palette finds the how-to by the words people type', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => ['italics', 'superscript', 'species', 'gene name', 'subscript', 'exponent'].map(q =>
    CMD_REGISTRY.map(c => ({ c, s: _cmdpScore(c, q) })).filter(o => o.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map(o => o.c.label)));
  for (const top of r) expect(top).toContain('Italic, bold, superscript and subscript in labels (how to)');
  expect(errors).toEqual([]);
});
