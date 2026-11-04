// @ts-check
// What the exported artefacts say, round 2 of the adversarial review: each test reads
// the bytes FigureLab writes — the caption, the CSVs, the submission ZIP, the JPEG
// header, the PDF, the SVG and the generated Python and R — and checks them against
// the figure that was drawn. Each test says why it fails without its fix.
// FL_APP=/path/to/figure_lab.html runs the spec against another build.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const APP = 'file://' + (process.env.FL_APP ? path.resolve(process.env.FL_APP) : path.resolve(__dirname, '..', 'figure_lab.html'));
const FX = path.join(__dirname, 'fixtures', 'tiff');

async function load(page) {
  const errors = [];
  const noise = /Failed to load resource|net::ERR|ERR_CERT|favicon/i;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !noise.test(m.text())) errors.push('console.error: ' + m.text()); });
  await page.goto(APP);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page.evaluate(HELPERS);
  return errors;
}

// In-page helpers, injected as source.
const HELPERS = `
  // Solid panels through the real commit path: [{name, w, h, fill, um}]
  window.__seed = async (specs) => {
    const out = [];
    for (const s of specs) {
      const c = document.createElement('canvas'); c.width = s.w || 100; c.height = s.h || 100;
      const x = c.getContext('2d'); x.fillStyle = s.fill || '#888'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width / 4, c.height / 4);       // orientation marker
      const src = c.toDataURL('image/png');
      await new Promise(res => { const img = new Image(); img.onload = () => {
        _commitImage(img, src, s.name || 'p.png', null, s.um ? { umPerPx: s.um, source: 'ImageJ' } : null); res(); }; img.src = src; });
      out.push({ name: s.name, b64: src.split(',')[1] });
    }
    render();
    return out;
  };
  // RFC 4180 reader; lines starting with # are comments the app writes above a table.
  window.__csv = (text) => {
    const body = text.split('\\n').filter(l => !l.startsWith('#')).join('\\n');
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (q) { if (ch === '"') { if (body[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === '') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (ch !== '\\r') f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.length > 1 || r[0] !== '');
  };
  window.__text = async (fn) => { const c = await _captureDownload(fn); return c ? new TextDecoder().decode(c.data) : null; };
  // Stored ZIP → [{name, flags, data}] in file order
  window.__zip = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const flags = dv.getUint16(p + 6, true), size = dv.getUint32(p + 18, true);
      const nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
      const at = p + 30 + nl + el;
      out.push({ name, flags, data: bytes.subarray(at, at + size) });
      p = at + size;
    }
    return out;
  };
  window.__pkg = async () => {
    const z = await _captureDownload(() => exportSubmissionPackage());
    const entries = __zip(z.data), files = {};
    entries.forEach(e => { files[e.name] = new TextDecoder().decode(e.data); });
    return { entries: entries.map(e => ({ name: e.name, flags: e.flags })), files };
  };
`;

// ── F01 ─────────────────────────────────────────────────────────────────────
test('the caption states a scale bar only for a panel the renderer drew one on', async ({ page }) => {
  // Without the fix the caption tested sbOn and the bar length alone: it read
  // "(A) Panel A. Scale bar, 10 µm." for an uncalibrated panel and "(B) … Scale bar,
  // 10 µm (0.01 µm per pixel)" for a bar too long to draw, so both not.toMatch fail.
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'uncal.png' }, { name: 'toolong.png', um: 0.01 }, { name: 'ok.png', um: 0.5 }]);
    sv('cols', 3); sv('rows', 1); onLayoutChange();
    generateCaption();
    return { cap: document.getElementById('caption-out').value, sbOn: images.map(i => i.sbOn), skip: images.map(i => i._sbSkip) };
  });
  expect(r.sbOn).toEqual([true, true, true]);               // all three switched on
  expect(r.skip[1]).toMatch(/longer than 75%/);              // and B's out of range
  expect(r.cap).not.toMatch(/\(A\)[^(]*Scale bar/);
  expect(r.cap).not.toMatch(/\(B\)[^(]*Scale bar/);
  expect(r.cap).toMatch(/\(C\)[^(]*Scale bar, 10 µm \(0\.5 µm per pixel\)/);
  expect(errors).toEqual([]);
});

// ── F02 ─────────────────────────────────────────────────────────────────────
test('every CSV quotes a field holding a comma or a quote, so no column shifts', async ({ page }) => {
  // Without the fix the metadata CSV wrote the name and label bare (27 fields under a
  // 25-field header, umPerPx read as "A"), the blot CSV wrote the label bare and turned
  // the note's commas into semicolons, and the measurement CSV wrapped fields in quotes
  // without doubling the quotes inside them.
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'cells, day 3.png', um: 0.5 }]);
    images[0].label = 'A, "wt"'; images[0].captionNote = 'note, with "quotes"'; render();
    const meta = __csv(await __text(() => exportCSV()));
    const blot = __csv(await __text(() => exportBlotMetadata()));
    measurements.length = 0;
    measurements.push({ type: 'rect', label: 'ROI "1", left', source: '8-bit display', x: 1, y: 2, w: 3, h: 4, meanGray: 5 });
    const meas = __csv(await __text(() => exportMeasurements()));
    return { meta, blot, meas };
  });
  const [mh, m1] = r.meta;
  expect(m1.length).toBe(mh.length);
  expect(m1[mh.indexOf('Name')]).toBe('cells, day 3.png');
  expect(m1[mh.indexOf('Label')]).toBe('A, "wt"');
  expect(m1[mh.indexOf('umPerPx')]).toBe('0.5');
  expect(m1[mh.indexOf('Caption')]).toBe('note, with "quotes"');
  const [bh, b1] = r.blot;
  expect(b1.length).toBe(bh.length);
  expect(b1[bh.indexOf('Label')]).toBe('A, "wt"');
  expect(b1[bh.indexOf('Note')]).toBe('note, with "quotes"');
  const [qh, q1] = r.meas;
  expect(q1.length).toBe(qh.length);
  expect(q1[qh.indexOf('Label')]).toBe('ROI "1", left');
  expect(q1[qh.indexOf('X')]).toBe('1');
  expect(errors).toEqual([]);
});

// ── F08 ─────────────────────────────────────────────────────────────────────
test('the package rewrites an untouched caption and Methods for the figure as exported', async ({ page }) => {
  // Without the fix the ZIP shipped the boxes as they were: the caption still had
  // "(B) Panel B" for a panel hidden since, no brightness sentence, and the Methods
  // said "panels A, B and C".
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png', um: 0.5 }, { name: 'b.png', um: 0.5 }, { name: 'c.png', um: 0.5 }]);
    sv('cols', 3); sv('rows', 1); onLayoutChange(); sv('export-name', 'f08');
    generateCaption(); writeMethodsParagraph();
    const before = document.getElementById('caption-out').value;
    images[1].excluded = true; images[2].brightness = 1.6; render();
    const p = await __pkg();
    return { before, p, box: document.getElementById('caption-out').value };
  });
  expect(r.before).toContain('(B) Panel B');
  const cap = r.p.files['f08-caption.txt'], meth = r.p.files['f08-methods.txt'];
  expect(cap).not.toContain('(B)');
  expect(cap).toContain('Brightness ×1.60');
  expect(meth).not.toContain('A, B and C');
  expect(meth).toContain('panels A and C');
  expect(r.box.trim()).toBe(cap);                            // the box now says what shipped
  expect(Object.keys(r.p.files).some(n => /generated/.test(n))).toBe(false);
  expect(r.p.files['README.txt']).not.toContain('CHECK THESE TEXTS');
  expect(errors).toEqual([]);
});

test('an edited caption is kept, and flagged when the figure has changed since', async ({ page }) => {
  // Without the fix there was no -caption-generated.txt, no README section and no
  // dialog: the edited caption shipped describing a panel the figure no longer has.
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png', um: 0.5 }, { name: 'b.png', um: 0.5 }]);
    sv('cols', 2); sv('rows', 1); onLayoutChange(); sv('export-name', 'f08e');
    const box = document.getElementById('caption-out');
    // Typed from scratch, never generated: kept, noted in the README, no dialog.
    box.value = 'My own caption.';
    const typed = await __pkg();
    const typedModal = !!document.querySelector('#info-modal-bg');
    generateCaption(); box.value += ' Cells were imaged live.';
    const unchanged = await __pkg();                       // edited, figure as generated: no flag
    document.querySelectorAll('#info-modal-bg').forEach(n => n.remove());
    images[1].brightness = 1.5; render();
    const changed = await __pkg();
    const modal = (document.querySelector('#info-modal-bg') || {}).textContent || '';
    return { typed, typedModal, unchanged, changed, modal };
  });
  expect(r.typed.files['f08e-caption.txt']).toBe('My own caption.');
  expect(r.typed.files['f08e-caption-generated.txt']).toMatch(/^\(A\) Panel A/);
  expect(r.typed.files['README.txt']).toContain('f08e-caption.txt is caption text FigureLab did not write here');
  expect(r.typedModal).toBe(false);
  expect(r.unchanged.files['f08e-caption.txt']).toContain('Cells were imaged live.');
  expect(Object.keys(r.unchanged.files).some(n => /generated/.test(n))).toBe(false);
  expect(r.unchanged.files['README.txt']).not.toContain('CHECK THESE TEXTS');
  // the author's words still ship, unchanged …
  expect(r.changed.files['f08e-caption.txt']).toContain('Cells were imaged live.');
  expect(r.changed.files['f08e-caption.txt']).not.toContain('Brightness');
  // … beside FigureLab's caption for the figure as exported, and both places say so
  expect(r.changed.files['f08e-caption-generated.txt']).toContain('Brightness ×1.50');
  expect(r.changed.files['README.txt']).toContain('CHECK THESE TEXTS');
  expect(r.changed.files['README.txt']).toContain('f08e-caption.txt is your edited caption');
  expect(r.changed.files['README.txt']).toMatch(/- f08e-caption-generated\.txt/);   // listed in Contents
  expect(r.modal).toContain('f08e-caption-generated.txt');
  expect(errors).toEqual([]);
});

// ── F12 ─────────────────────────────────────────────────────────────────────
test('a JPEG export carries its DPI in the JFIF header; the WebP dialog says it cannot', async ({ page }) => {
  // Without the fix the JFIF APP0 said units 0, density 1:1 — no resolution at all —
  // and the Save dialog said nothing about WebP.
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }, { name: 'b.png' }]);
    sv('export-dpi', '300'); sv('export-width-mm', '85'); render();
    const eff = renderExportCanvas(300)._effDpi || 300;
    const c = await _captureDownload(() => doExport('jpeg'));
    const b = c.data;
    doExportPreflight('webp');
    const webp = document.getElementById('preflight-body').textContent; closePreflight();
    return { eff, head: Array.from(b.subarray(0, 18)), webp };
  });
  const b = r.head;
  expect([b[0], b[1], b[2], b[3]]).toEqual([0xFF, 0xD8, 0xFF, 0xE0]);
  expect(String.fromCharCode(...b.slice(6, 10))).toBe('JFIF');
  expect(b[13]).toBe(1);                                   // dots per inch
  expect((b[14] << 8) | b[15]).toBe(Math.round(r.eff));
  expect((b[16] << 8) | b[17]).toBe(Math.round(r.eff));
  expect(r.webp).toMatch(/WebP has no standard print-resolution field/);
  expect(errors).toEqual([]);
});

// ── F13 ─────────────────────────────────────────────────────────────────────
test('ZIP entry names are flat, safe and unique whatever the labels and export name hold', async ({ page }) => {
  // Without the fix two "WT" panels were two entries named panels/panel_WT.png (one is
  // lost on extraction), "WT/KO" and "../x" made folders, and "my/fig µ-caption.txt"
  // was a folder with a CP437-read name.
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }, { name: 'd.png' }]);
    ['WT', 'WT', 'WT/KO', '../x'].forEach((l, i) => { images[i].label = l; });
    sv('cols', 2); sv('rows', 2); onLayoutChange(); sv('export-name', 'my/fig µ');
    document.getElementById('caption-out').value = 'A caption.';
    return await __pkg();
  });
  const names = r.entries.map(e => e.name);
  expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
  for (const n of names) {
    expect(n.split('/').length <= 2, n).toBe(true);
    if (n.includes('/')) expect(['panels', 'source-data']).toContain(n.split('/')[0]);
    expect(n.split('/').some(s => s === '..' || s === '.' || s === ''), n).toBe(false);
  }
  const panels = names.filter(n => n.startsWith('panels/'));
  expect(panels).toEqual(['panels/panel_1_WT.png', 'panels/panel_2_WT.png', 'panels/panel_3_WT_KO.png', 'panels/panel_4_x.png']);
  const cap = r.entries.find(e => /-caption\.txt$/.test(e.name));
  expect(cap.name).toBe('my_fig µ-caption.txt');
  expect(cap.flags & 0x0800).toBe(0x0800);                 // UTF-8 name, flagged
  // the README lists the entries as they are named in the ZIP
  for (const n of names.filter(n => n !== 'README.txt')) expect(r.files['README.txt']).toContain('  - ' + n);
  expect(errors).toEqual([]);
});

// ── F15 ─────────────────────────────────────────────────────────────────────
test('a TIFF panel cites the TIFF it came from, and a page of a stack says which page', async ({ page }) => {
  // Without the fix every TIFF was renamed to .png on import: the CSV and PANEL_HISTORY
  // cited g16_raw.png and multipage_p2.png, files the author does not have.
  const errors = await load(page);
  const bytes = n => Array.from(fs.readFileSync(path.join(FX, n)));
  const r = await page.evaluate(async ({ single, multi }) => {
    const drop = async (b, name, n) => {
      const before = images.length;
      addFiles([new File([new Uint8Array(b)], name, { type: 'image/tiff' })]);
      await new Promise(res => { const t0 = Date.now(); const iv = setInterval(() => {
        if (images.length >= before + n || (cropEdState && cropEdState._preCrop) || Date.now() - t0 > 8000) { clearInterval(iv); res(); } }, 30); });
      if (cropEdState && cropEdState._preCrop) skipPreCrop();
      await new Promise(res => setTimeout(res, 200));
    };
    await drop(single, 'g16_raw.tif', 1);
    await drop(multi, 'multipage.tif', 3);
    sv('cols', 4); sv('rows', 1); onLayoutChange(); render();
    const csv = __csv(await __text(() => exportCSV()));
    const hist = _panelHistoryText().split('\n').filter(l => /import:/.test(l));
    const session = JSON.parse(await __text(() => saveJSON()));
    return { names: images.map(i => i.name), csvNames: csv.slice(1).map(row => row[1]), hist, pages: session.images.map(i => i.srcPage || null) };
  }, { single: bytes('g16_raw.tif'), multi: bytes('multipage.tif') });
  expect(r.names).toEqual(['g16_raw.tif', 'multipage.tif', 'multipage.tif', 'multipage.tif']);
  expect(r.csvNames).toEqual(['g16_raw.tif', 'multipage.tif (page 1 of 3)', 'multipage.tif (page 2 of 3)', 'multipage.tif (page 3 of 3)']);
  expect(r.hist[0]).toContain('file=g16_raw.tif');
  expect(r.hist[2]).toContain('file=multipage.tif (page 2 of 3)');
  expect(r.hist.join('\n')).not.toMatch(/\.png/);
  expect(r.pages).toEqual([null, 1, 2, 3]);                // the session keeps the page
  expect(errors).toEqual([]);
});

// ── F19 ─────────────────────────────────────────────────────────────────────
const hasPy = spawnSync('python3', ['-c', 'import numpy, PIL'], { encoding: 'utf8' }).status === 0;
const hasR = spawnSync('Rscript', ['--version'], { encoding: 'utf8' }).status === 0;

test('the Python script runs and rebuilds the drawn figure; the R script parses', async ({ page }) => {
  // Without the fix the label "C\n"x"" was pasted raw into a string literal, so the
  // Python did not even parse (ast.parse fails); with a plain label it died on its
  // first data line (NameError: name 'true') and the R on "sb_on=true". Both listed
  // the hidden panel B, needed one file per grid cell and stretched every panel.
  test.setTimeout(90000);
  const errors = await load(page);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-scripts-'));
  fs.mkdirSync(path.join(dir, 'src'));
  const r = await page.evaluate(async () => {
    const src = await __seed([{ name: 'a.png', w: 200, h: 100, fill: '#c33', um: 0.5 },
      { name: 'b.png', fill: '#3c3', um: 0.5 }, { name: 'c, "odd".png', w: 120, h: 80, fill: '#33c', um: 0.5 }]);
    sv('cols', 2); sv('rows', 2); onLayoutChange(); sv('export-name', 'r19');
    images[0].colSpan = 2; images[0].cropL = 10; images[0].cropAngle = 12; images[0].flipH = true; images[0].brightness = 1.3;
    images[1].excluded = true;
    images[2].rotate = 90; images[2].gamma = 0.5; images[2].lut = 'green'; images[2].blackPt = 20; images[2].label = 'C\n"x"';
    render();
    const py = await __text(() => exportPython()), R = await __text(() => exportR());
    const png = await _captureDownload(() => doExport('png'));
    let s = ''; for (let i = 0; i < png.data.length; i += 0x8000) s += String.fromCharCode.apply(null, png.data.subarray(i, i + 0x8000));
    return { src, py, R, png: btoa(s) };
  });
  for (const f of r.src) if (f.name !== 'b.png') fs.writeFileSync(path.join(dir, 'src', f.name), Buffer.from(f.b64, 'base64'));
  fs.writeFileSync(path.join(dir, 'fig.py'), r.py); fs.writeFileSync(path.join(dir, 'fig.R'), r.R);
  fs.writeFileSync(path.join(dir, 'app.png'), Buffer.from(r.png, 'base64'));

  // Valid Python whatever is installed; the R carries R logicals, never JS ones.
  const ast = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', path.join(dir, 'fig.py')], { encoding: 'utf8' });
  expect(ast.status, ast.stderr).toBe(0);
  expect(r.R).not.toMatch(/=\s*(true|false)\b/);
  expect(r.py).not.toMatch(/:\s*(true|false)\s*[,}]\s*$/m);
  // The panel list is the drawn figure: A and C, in their cells, not the hidden B.
  const data = spawnSync('python3', ['-c',
    'import json,sys,re; s=open(sys.argv[1]).read(); exec(s[s.index("PANELS ="):s.index("\\n", s.index("NOT_REPRODUCED ="))]); '
    + 'print(json.dumps([[p["label"],p["file"],p["row"],p["col"],p["col_span"]] for p in PANELS]))', path.join(dir, 'fig.py')], { encoding: 'utf8' });
  expect(data.status, data.stderr).toBe(0);
  expect(JSON.parse(data.stdout)).toEqual([['A', 'a.png', 1, 1, 2], ['C\n"x"', 'c, "odd".png', 2, 1, 1]]);

  if (hasPy) {
    // Run it on the source files — b.png is not among them — and compare with the PNG.
    const run = spawnSync('python3', [path.join(dir, 'fig.py'), path.join(dir, 'src')], { cwd: dir, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const cmp = spawnSync('python3', ['-c', [
      'import sys, numpy as np', 'from PIL import Image',
      'a=Image.open(sys.argv[1]).convert("RGB"); b=Image.open(sys.argv[2]).convert("RGB")',
      'print(a.size==b.size, b.info.get("dpi"))',
      'A=np.asarray(a,dtype=int); B=np.asarray(b,dtype=int); d=np.abs(A-B).max(axis=2)',
      'print(round(float(d.mean()),3), round(float((d>24).mean()),4))'].join('\n'),
    path.join(dir, 'app.png'), path.join(dir, 'r19.tiff')], { encoding: 'utf8' });
    expect(cmp.status, cmp.stderr).toBe(0);
    const [same, stats] = cmp.stdout.trim().split('\n');
    expect(same).toMatch(/^True \(300/);
    const [mean, frac] = stats.split(' ').map(Number);
    expect(mean).toBeLessThan(2);           // typefaces differ; the pictures do not
    expect(frac).toBeLessThan(0.01);
  }
  if (hasR) {
    const p = spawnSync('Rscript', ['-e', `invisible(parse(file=${JSON.stringify(path.join(dir, 'fig.R'))}))`], { encoding: 'utf8' });
    expect(p.status, p.stderr).toBe(0);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

// ── F20 ─────────────────────────────────────────────────────────────────────
test('the PDF draws the label chip at the opacity the preview and SVG use', async ({ page }) => {
  // Without the fix the chip was "0 0 0 rg … re f" with no graphics state: solid black.
  const errors = await load(page);
  const r = await page.evaluate(async () => {
    await __seed([{ name: 'red.png', w: 300, h: 300, fill: '#ff0000' }]);
    sv('cols', 1); sv('rows', 1); onLayoutChange(); sc('label-bg', true); render();
    const c = await _captureDownload(() => doExport('pdf'));
    return new TextDecoder('latin1').decode(c.data);
  });
  const gs = /\/ExtGState << \/(GS\d+) << \/Type \/ExtGState \/ca 0\.450 \/CA 0\.450 >>/.exec(r);
  expect(gs).not.toBeNull();
  expect(r).toMatch(new RegExp(`q /${gs[1]} gs 0\\.000 0\\.000 0\\.000 rg [\\d. ]+ re f Q`));
  expect(errors).toEqual([]);
});

// ── F24 ─────────────────────────────────────────────────────────────────────
test('an imported SVG grid panel stays vector in the SVG export, or the file says why not', async ({ page }) => {
  // Without the fix grid panels went only into the background raster: no
  // data:image/svg+xml, no comment, nothing in the Save dialog.
  const errors = await load(page);
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect x="0" y="0" width="150" height="100" fill="red"/><rect x="150" y="0" width="150" height="100" fill="blue"/></svg>';
  const r = await page.evaluate(async (svgText) => {
    addFiles([new File([svgText], 'two.svg', { type: 'image/svg+xml' })]);
    await new Promise(res => { const t0 = Date.now(); const iv = setInterval(() => {
      if (images.length || (cropEdState && cropEdState._preCrop) || Date.now() - t0 > 8000) { clearInterval(iv); res(); } }, 30); });
    if (cropEdState && cropEdState._preCrop) skipPreCrop();
    await new Promise(res => setTimeout(res, 300));
    sv('cols', 1); sv('rows', 1); onLayoutChange(); sv('export-name', 'vec'); render();
    const b = panelBounds.find(p => p.idx === 0);
    const vec = await __text(() => doExport('svg'));
    // Paint the exported SVG and read the panel back: the vector must be visible, and
    // the raster above it transparent there (else the picture is still the raster).
    const paint = (url, w, h) => new Promise(res => { const img = new Image(); img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res(c.getContext('2d')); }; img.src = url; });
    const W = canvasLogicalW, H = canvasLogicalH;
    const svgCtx = await paint(URL.createObjectURL(new Blob([vec], { type: 'image/svg+xml' })), W, H);
    const rasterUrl = (/<image x="0" y="0"[^>]*xlink:href="(data:image\/png[^"]+)"/.exec(vec) || [])[1];
    const rasterCtx = await paint(rasterUrl, W, H);
    const at = (ctx, fx) => Array.from(ctx.getImageData(Math.round(b.ix + b.iw * fx), Math.round(b.iy + b.ih * 0.6), 1, 1).data);
    const shown = { left: at(svgCtx, 0.3), right: at(svgCtx, 0.8), rasterAlpha: at(rasterCtx, 0.3)[3] };
    images[0].cropL = 10; render();
    const cropped = await __text(() => doExport('svg'));
    doExportPreflight('svg');
    const dialog = document.getElementById('preflight-body').textContent; closePreflight();
    return { isVector: images[0].isVector, vec, shown, cropped, dialog };
  }, SVG);
  expect(r.isVector).toBe(true);
  expect(r.vec).toContain('data:image/svg+xml');
  expect(r.vec).toContain('written as vector');
  expect(r.shown.rasterAlpha).toBe(0);                     // the raster leaves the panel to the vector
  expect(r.shown.left[0]).toBeGreaterThan(200); expect(r.shown.left[2]).toBeLessThan(60);    // red half
  expect(r.shown.right[2]).toBeGreaterThan(200); expect(r.shown.right[0]).toBeLessThan(60);  // blue half
  // a crop changes which pixels are shown: written as pixels, and both places say why
  expect(r.cropped).not.toContain('data:image/svg+xml');
  expect(r.cropped).toMatch(/imported as SVG but is written as pixels[^>]*it is cropped/);
  expect(r.dialog).toMatch(/imported as SVG but is written as pixels: it is cropped/);
  expect(errors).toEqual([]);
});
