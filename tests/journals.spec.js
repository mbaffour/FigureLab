// @ts-check
// Target journal: one table of what each journal's own figure guide says, applied where
// it is mechanical and checked row by row in the compliance report.
//
// Every test here fails on the build before this change: there was no Target journal
// control, no JOURNALS table, no _contrastRatio, no red lookup table, the presets set
// sizes only (ASM and JBC did not exist; EMBO stayed at 300 DPI; no font, type size or
// file name was touched), the report used one fixed set of thresholds, and the package
// named the uncropped sheet S1_uncropped_originals whatever the journal. Each test says
// which of those it catches.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { loadApp, seedPanels } = require('./helpers');
const SCEN = require('./fixtures/journals-scenarios.js');
const BASELINE = require('./fixtures/compliance-baseline-nojournal.json');
const APP_URL = 'file://' + path.resolve(__dirname, '..', 'figure_lab.html');

test.use({ viewport: { width: 1400, height: 900 } });

// Rows of the open report, read without re-running it.
const READ_ROWS = () => {
  window.__read = () => [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\s+/g, ' ').trim(),
    fix: e.querySelector('button') ? e.querySelector('button').textContent.trim() : null }));
  window.__report = () => { checkCompliance(); const rows = __read();
    const title = document.getElementById('im-title').textContent; return { title, rows }; };
  window.__row = (label) => __report().rows.find(r => r.label === label) || null;
};
async function setup(page, n = 4) {
  const errors = await loadApp(page);
  await seedPanels(page, n);
  await page.evaluate(READ_ROWS);
  return errors;
}
const closeModal = page => page.evaluate(() => { const m = document.getElementById('info-modal-bg'); if (m) m.remove(); });
// Every text item's size at final print size, in pt, read the way the report reads it.
const PT_RANGE = page => page.evaluate(() => { render(); const k = _physFacts().ptPerPx;
  const pts = _figTextSizes().map(t => t.fs * k); return { min: Math.min(...pts), max: Math.max(...pts), n: pts.length }; });

// ── No target journal: the report the app always gave ────────────────────────────
// The expected rows were captured from the build before this change
// (fixtures/compliance-baseline-nojournal.json). Without the change this fails on its
// first line: there is no _targetJournal (and no Target journal control) to be "none".
test('with no target journal the report is word for word the one the app gave before', async ({ page }) => {
  const errors = await loadApp(page);
  for (const [name, body] of Object.entries(SCEN)) {
    await page.goto(APP_URL);
    await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
    await seedPanels(page, 4);
    expect(await page.evaluate(() => [gv('target-journal'), _targetJournal()])).toEqual(['none', null]);
    const got = await page.evaluate(b => (new Function(b))(), body);
    expect(got, name).toEqual(BASELINE[name]);
  }
  expect(errors).toEqual([]);
});

// ── Applying a journal sets what its page says, and nothing it does not ──────────
// Before: Nature kept System Sans and 18 px letters (≈ 8 pt, over Nature's 7), PLOS kept
// the name "figure" and System Sans, EMBO set 300 DPI (its page says 600 for a figure
// with text), and ASM and JBC did not exist (applyPreset returned without doing anything).
test('each verified journal applies exactly its own page, as one undo step', async ({ page }) => {
  const errors = await setup(page);
  const run = (id, pre) => page.evaluate(([id, pre]) => {
    sc('show-col-labels', true); onLayoutChange();
    if (pre) (new Function(pre))();
    render();
    const before = _collectFigControls({ layout: {}, style: {} }), d0 = undoStack.length, s0 = JSON.stringify(serializeSession(false));
    applyPreset(id); render();
    const after = _collectFigControls({ layout: {}, style: {} });
    const out = { steps: undoStack.length - d0, after, before, last: _lastPresetName, target: gv('target-journal'),
      w: gv('export-width-mm'), dpi: gv('export-dpi'), font: gv('label-font'), bold: gc('label-bold'), fmt: gv('label-format'),
      lzw: gc('export-tiff-lzw'), name: gv('export-name') };
    undo();
    out.undone = JSON.stringify(serializeSession(false)) === s0;
    return out;
  }, [id, pre || '']);

  const nature = await run('nature');
  expect(nature.steps).toBe(1);
  expect(nature.undone).toBe(true);
  expect([nature.target, nature.last]).toEqual(['nature', 'nature']);
  expect(nature.w).toBe('183');                                   // 89 single / 183 double
  expect(nature.font).toBe('Arial,Helvetica,sans-serif');         // Arial or Helvetica
  expect(nature.dpi).toBe('300');                                 // no main-figure DPI stated: the preset's own
  expect(nature.lzw).toBe(false);
  expect(nature.name).toBe('figure');
  await page.evaluate(() => applyPreset('nature'));
  let pt = await PT_RANGE(page);
  expect(pt.min).toBeGreaterThanOrEqual(5 - 0.05);                // 5–7 pt at final size
  expect(pt.max).toBeLessThanOrEqual(7 + 0.05);
  await page.evaluate(() => { undo(); });

  const plos = await run('plos');
  expect(plos.steps).toBe(1);
  expect(plos.undone).toBe(true);
  expect(+plos.w).toBeGreaterThanOrEqual(66.8);                   // 789–2250 px at 300 dpi
  expect(+plos.w).toBeLessThanOrEqual(190.5);
  expect(plos.font).toBe('Arial,Helvetica,sans-serif');           // Arial, Times or Symbol
  expect(plos.dpi).toBe('300');                                   // 300–600
  expect(plos.lzw).toBe(true);                                    // TIFF with LZW
  expect(plos.name).toBe('Fig1');                                 // Fig1.tif
  await page.evaluate(() => applyPreset('plos'));
  pt = await PT_RANGE(page);
  expect(pt.min).toBeGreaterThanOrEqual(8 - 0.05);                // 8–12 pt
  expect(pt.max).toBeLessThanOrEqual(12 + 0.05);
  await page.evaluate(() => { undo(); });

  const elife = await run('elife');
  expect(elife.steps).toBe(1);
  expect(+elife.w).toBeGreaterThanOrEqual(100);                   // at least 10 cm, 20 cm full page
  expect(+elife.w).toBeLessThanOrEqual(200);
  expect(elife.font).toBe(elife.before.style.labelFont);          // no font stated: untouched
  expect(elife.after.style.labelSize).toBe('8');                  // no type size stated: the preset's own
  expect(elife.dpi).toBe('300');
  expect(elife.name).toBe('figure');

  const embo = await run('embo');
  expect(embo.steps).toBe(1);
  expect(embo.undone).toBe(true);
  expect(+embo.w).toBeGreaterThanOrEqual(87);                     // 87–180 mm
  expect(+embo.w).toBeLessThanOrEqual(180);
  expect(embo.font).toBe("'Helvetica Neue',Arial,sans-serif");    // panel letters upper-case bold Helvetica
  expect(embo.bold).toBe(true);
  expect(embo.fmt).toBe('ABC');
  expect(embo.dpi).toBe('600');                                   // 600 ppi for text / combination

  // ASM: nothing it does not state. From a figure at 1200 DPI in Georgia, Free width.
  const asm = await run('asm', "sv('export-dpi','1200'); sv('label-font','Georgia,serif'); sc('label-bold',false);");
  expect(asm.steps).toBe(1);
  expect(asm.undone).toBe(true);
  expect(asm.w).toBe('177.8');                                    // at most 7 × 9 in, at publication size
  expect(asm.dpi).toBe('600');                                    // 300–600, not higher than 600
  expect(asm.font).toBe('Arial,Helvetica,sans-serif');            // Arial, Helvetica or Times New Roman
  expect(asm.bold).toBe(false);                                   // not stated: untouched
  for (const k of ['panelW', 'panelH', 'gapH', 'gapV', 'labelSize', 'sbH', 'bgColor'])
    expect(asm.after.layout[k] ?? asm.after.style[k], k).toBe(asm.before.layout[k] ?? asm.before.style[k]);
  expect(asm.lzw).toBe(false);

  // JBC: data-presentation rules only — the figure is targeted and nothing else moves.
  const jbc = await run('jbc');
  expect(jbc.steps).toBe(1);
  expect(jbc.target).toBe('jbc');
  const strip = o => { const c = JSON.parse(JSON.stringify(o)); delete c.targetJournal; return c; };
  expect(strip(jbc.after)).toEqual(strip(jbc.before));
  expect(errors).toEqual([]);
});

// ── A figure that breaks each rule fails or warns on that row; Fix is one undo step ─
// Before: none of these rows existed (the report had no Font, File name, Panel letters,
// Scale-bar length, Scale bars or Red/green row, and its width row passed anything ≤ 7.5 in).
const CASES = [
  { j: 'nature', label: 'Printed width', bad: "sv('export-width-mm','100')", fixT: /Set 89 mm/ },
  { j: 'nature', label: 'Font', bad: "sv('label-font','Georgia,serif')" },
  { j: 'nature', label: 'Text size', bad: "sv('label-size',40)" },
  { j: 'plos', label: 'Printed width', bad: "sv('export-width-mm','200')" },
  { j: 'plos', label: 'Export DPI', bad: "sv('export-dpi','1200')" },
  { j: 'plos', label: 'Export format', bad: "sc('export-tiff-lzw',false)" },
  { j: 'plos', label: 'File name', bad: "sv('export-name','figure')" },
  { j: 'plos', label: 'Text size', bad: "sv('label-size',6)" },
  { j: 'plos', label: 'Font', bad: "sv('label-font','\\'Helvetica Neue\\',Arial,sans-serif')" },
  { j: 'elife', label: 'Scale bars', bad: "images[0].umPerPx=1; images[0].sbUm=20; images[0].sbOn=false;" },
  { j: 'embo', label: 'Panel letters', bad: "sc('label-bold',false)" },
  { j: 'embo', label: 'Export DPI', bad: "sv('export-dpi','300')" },
  { j: 'embo', label: 'Scale-bar length', bad: "images[0].umPerPx=1; images[0].sbUm=20; images[0].sbOn=true; sc('sb-text',true);" },
  { j: 'asm', label: 'Export DPI', bad: "sv('export-dpi','1200')" },
  { j: 'asm', label: 'Font', bad: "sv('label-font','Georgia,serif')" },
  { j: 'asm', label: 'Printed width', bad: "sv('export-width-mm','183')" },
  { j: 'jbc', label: 'Scale bars', bad: "images[0].umPerPx=1; images[0].sbUm=20; images[0].sbOn=false;" },
  { j: 'nature', label: 'Text contrast', bad: "sc('show-col-labels',true); onLayoutChange(); sc('axis-auto-color',false); sv('axis-color','#777777');", warn: true, note: /4\.48:1/ },
  { j: null, label: 'Red/green', bad: "images[0].lut='red'; images[1].lut='green';", warn: true },
];
for (const c of CASES) {
  test(`${c.j || 'no journal'}: ${c.label} flags a figure that breaks it, and its fix is one undo step`, async ({ page }) => {
    const errors = await setup(page, 2);
    await page.evaluate(([j, bad]) => { if (j) applyPreset(j); (new Function(bad))(); renderImgList(); render(); }, [c.j, c.bad]);
    const before = await page.evaluate(l => __row(l), c.label);
    expect(before, c.label).not.toBeNull();
    expect(before.icon).toBe(c.warn ? '⚠' : '✗');
    if (c.note) expect(before.text).toMatch(c.note);
    if (c.fixT) expect(before.fix).toMatch(c.fixT);
    expect(before.fix).toBeTruthy();
    if (c.j) expect(before.text).toMatch(/figure guide, read Nov 2026/);     // every rule row names its source
    const d0 = await page.evaluate(() => undoStack.length);
    await page.locator('#info-modal-bg .compliance-row').filter({ has: page.locator('.c-label', { hasText: new RegExp(`^${c.label}$`) }) })
      .locator('button').click();
    const after = await page.evaluate(l => __read().find(r => r.label === l) || null, c.label);   // the report ran again
    // With no journal an accessibility row is shown only while it has something to flag.
    if (c.j) expect(after.icon, after.text).toBe('✓'); else expect(after).toBeNull();
    expect(await page.evaluate(() => undoStack.length)).toBe(d0 + 1);
    if (c.label === 'Red/green') expect(await page.evaluate(() => [images[0].lut, images[1].lut])).toEqual(['magenta', 'green']);
    await closeModal(page);
    await page.evaluate(() => undo());
    expect((await page.evaluate(l => __row(l), c.label)).icon).toBe(before.icon);   // and Ctrl+Z puts the breach back
    expect(errors).toEqual([]);
  });
}

// Nature's 5–7 pt is under 4 px wide at this width, and the title is drawn 4 px larger
// than the headings, so no size fits both. The row says so instead of offering a fix
// that silently fails. Before: the report had one 5 pt floor for panel letters only.
test('Nature: a title and headings that cannot both fit 5–7 pt are named as the reason', async ({ page }) => {
  const errors = await setup(page, 4);
  const row = await page.evaluate(() => { sc('show-col-labels', true); sv('fig-title', 'T'); onLayoutChange(); applyPreset('nature'); render(); return __row('Text size'); });
  expect(row.icon).toBe('✗');
  expect(row.text).toMatch(/The title is drawn 4 px larger than the headings, so at this width both cannot sit inside 5–7 pt/);
  expect(errors).toEqual([]);
});

// Rows that report without a mechanical fix still fail on a figure that breaks them.
// Before: the height row passed anything under 9.5 in (241 mm); Nature's limit is 170 mm.
test('a Nature figure taller than 170 mm fails the height row; a PNG export fails Nature\'s format row', async ({ page }) => {
  const errors = await setup(page, 3);
  await page.evaluate(() => { window.dl = () => {}; sv('cols', 1); sv('rows', 3); onLayoutChange(); applyPreset('nature'); render(); });
  const h = await page.evaluate(() => __row('Printed height'));
  expect(h.icon).toBe('✗');
  expect(h.text).toMatch(/at most 170 mm/);
  await closeModal(page);
  await page.evaluate(async () => { await doExport('png'); });
  const f = await page.evaluate(() => __row('Export format'));
  expect(f.icon).toBe('✗');
  expect(f.text).toMatch(/last exported as PNG — not accepted/);
  expect(f.text).toMatch(/JPEG, TIFF and PNG are not accepted for main figures/);
  expect(errors).toEqual([]);
});

// ── Unverified journals inform and never fail ─────────────────────────────────────
// Before: Science, Cell and PNAS were reported against general thresholds with ✗, and no
// row said where a rule came from.
for (const id of ['science', 'cell', 'pnas']) {
  test(`${id}: every rule row says unverified and none fails, even on a figure that breaks them all`, async ({ page }) => {
    const errors = await setup(page, 2);
    const r = await page.evaluate((id) => {
      applyPreset(id);
      images.forEach(im => { im.sbOn = false; });           // keep the general integrity rows quiet
      sv('export-width-mm', '100'); sv('export-dpi', '1200'); sv('label-font', 'Georgia,serif'); sv('label-size', 60);
      sc('show-col-labels', true); onLayoutChange(); render();
      return __report();
    }, id);
    expect(r.title).toMatch(/unverified/);
    const unv = r.rows.filter(x => /unverified — check the journal's page/.test(x.text));
    expect(unv.length).toBeGreaterThanOrEqual(3);
    for (const x of unv) expect(x.icon, x.text).toBe('?');
    expect(r.rows.filter(x => x.icon === '✗').map(x => x.text)).toEqual([]);
    expect(r.rows.find(x => x.label === 'Printed width').icon).toBe('?');
    expect(errors).toEqual([]);
  });
}

// ── Colour accessibility ─────────────────────────────────────────────────────────
// Before: no _contrastRatio and no Text contrast row existed.
test('contrast ratio follows the WCAG formula: 21:1 black on white, 4.48:1 for #777 on white', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => [_contrastRatio('#000000', '#ffffff'), _contrastRatio('#fff', '#000'),
    _contrastRatio('#777777', '#ffffff'), _contrastRatio('#ffffff', '#ffffff'), _contrastRatio('rgba(0,0,0,1)', 'white')]);
  expect(r[0]).toBeCloseTo(21, 6);
  expect(r[1]).toBeCloseTo(21, 6);
  expect(r[2]).toBeCloseTo(4.478, 2);
  expect(r[2]).toBeLessThan(4.5);
  expect(r[3]).toBeCloseTo(1, 6);
  expect(r[4]).toBeCloseTo(21, 6);
  expect(errors).toEqual([]);
});

// Before: there was no red lookup table, so a red + green figure could not even be made,
// and nothing counted the channels in a merge.
test('red beside green warns with no journal; with ASM it cites ASM; text over pixels is "not checked"', async ({ page }) => {
  const errors = await setup(page, 2);
  const r = await page.evaluate(() => {
    images[0].lut = 'red'; images[1].lut = 'green'; render();
    const none = __row('Red/green');
    applyPreset('asm'); render();
    const asm = __row('Red/green'), con = __row('Text contrast');
    return { none, asm, con, chan: _lutChannelName('red'), lut: LUTS.red(200) };
  });
  expect(r.none.icon).toBe('⚠');
  expect(r.none.text).toMatch(/QUAREP-LiMi/);
  expect(r.asm.text).toMatch(/ASM: avoid red\/green.*use magenta for red/);
  expect(r.con.text).toMatch(/panel letters and tags sit over image pixels — not checked/);
  expect(r.lut).toEqual([200, 0, 0]);
  expect(errors).toEqual([]);
});

// ── Blots: MW markers bracket the analysed bands ─────────────────────────────────
// The gel is synthesised with a seven-marker ladder (250…25 kDa) and a 22 kDa band below
// its bottom marker, as gel.spec.js builds one. Before: the report had no MW-marker row.
const GEN = () => {
  window.__gelMake = (spec) => {
    const W = spec.w, H = spec.h;
    const model = (x, y) => { let s = 0;
      for (const L of spec.lanes) if (x >= L.x0 && x < L.x1) for (const b of (L.bands || [])) s += b.amp * Math.exp(-((y - b.y) ** 2) / (2 * b.s * b.s));
      return s; };
    let seed = 11; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const v = Math.max(0, Math.min(255, Math.round(spec.bg - model(i + 0.5, j + 0.5) + (rnd() - 0.5) * 2 * spec.noise)));
      const k = j * W + i; id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = v; id.data[k * 4 + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const src = c.toDataURL('image/png');
    return new Promise((res, rej) => { const img = new Image();
      img.onload = () => { _commitImage(img, src, 'blot.png'); render(); res(); }; img.onerror = rej; img.src = src; });
  };
};
test('MW markers: JBC and EMBO want them above and below the analysed bands, eLife wants them there', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(READ_ROWS);
  await page.evaluate(GEN);
  const H = 300, kd = [250, 130, 100, 70, 55, 35, 25];
  const yOf = m => H * (0.1 + 0.8 * (Math.log10(250) - Math.log10(m)) / (Math.log10(250) - Math.log10(25)));
  const lanes = [
    { x0: 30, x1: 80, bands: kd.map(m => ({ y: yOf(m), s: 2.5, amp: 70 })) },
    { x0: 120, x1: 170, bands: [{ y: yOf(60), s: 3, amp: 80 }, { y: yOf(40), s: 3, amp: 80 }] },
    { x0: 210, x1: 260, bands: [{ y: yOf(150), s: 3, amp: 80 }, { y: yOf(22), s: 3, amp: 80 }] },
  ];
  await page.evaluate(s => window.__gelMake(s), { w: 300, h: H, bg: 225, noise: 3, lanes });
  const r = await page.evaluate(() => {
    runGelAnalysis(0); gelSetLadder(0, 0, '250,130,100,70,55,35,25');
    const out = {};
    for (const j of ['jbc', 'embo', 'elife', 'nature']) { applyPreset(j); out[j] = __row('MW markers'); }
    applyPreset('jbc'); gelSetLadder(0, null);
    out.none = __row('MW markers');
    return out;
  });
  expect(r.jbc.icon).toBe('⚠');
  expect(r.jbc.text).toMatch(/1 analysed band lies above the top marker or below the bottom one/);
  expect(r.jbc.text).toMatch(/JBC: MW markers above AND below the bands/);
  expect(r.embo.icon).toBe('⚠');
  expect(r.elife.icon).toBe('✓');                        // eLife states presence, not bracketing
  expect(r.elife.text).toMatch(/7 labelled markers/);
  expect(r.nature).toBeNull();                           // Nature's page states no marker rule
  expect(r.none.icon).toBe('⚠');
  expect(r.none.text).toMatch(/no molecular-weight labels/);
  // A ladder that spans every band passes.
  const ok = await page.evaluate(() => { gelSetLadder(0, 0, '250,130,100,70,55,35,25');
    images[0].gelAnalysis.lanes[2].bands = images[0].gelAnalysis.lanes[2].bands.filter(b => b.yc < 200);
    return __row('MW markers'); });
  expect(ok.icon, ok.text).toBe('✓');
  expect(errors).toEqual([]);
});

// ── The journal is part of the figure ────────────────────────────────────────────
// Before: the preset lived in a variable no save, link or template carried.
test('the target journal survives a saved session, a share link and a template', async ({ page }) => {
  const errors = await setup(page, 2);
  const s = await page.evaluate(() => {
    applyPreset('asm');
    const S = JSON.stringify(serializeSession(true));
    sv('target-journal', 'none'); _syncJournalFromControl();
    applySession(JSON.parse(S), { origin: 'file' });
    const back = [gv('target-journal'), _lastPresetName];
    document.getElementById('tpl-name-input').value = 'ASM tpl'; saveTemplate();
    sv('target-journal', 'none'); _syncJournalFromControl();
    loadTemplate(getSavedTemplates().find(t => t.name === 'ASM tpl'));
    return { back, tpl: [gv('target-journal'), _lastPresetName] };
  });
  expect(s.back).toEqual(['asm', 'asm']);
  expect(s.tpl).toEqual(['asm', 'asm']);
  const hash = await page.evaluate(async () => {
    let href = null;
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    navigator.clipboard.writeText = async (t) => { href = t; };
    shareSession(); await new Promise(r => setTimeout(r, 60));
    return href.slice(href.indexOf('#share='));
  });
  await page.goto('about:blank');
  await page.goto(APP_URL + hash);
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  expect(await page.evaluate(() => [gv('target-journal'), _lastPresetName])).toEqual(['asm', 'asm']);
  expect(errors).toEqual([]);
});

// Before: there was no Target journal control.
test('choosing a journal in the Target journal menu applies it as one step; Ctrl+Z takes it back', async ({ page }) => {
  const errors = await setup(page, 2);
  await page.evaluate(() => document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; }));
  const d0 = await page.evaluate(() => undoStack.length);
  await page.locator('#target-journal').focus();
  await page.locator('#target-journal').selectOption('plos');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  expect(await page.evaluate(() => [undoStack.length, _lastPresetName, gv('export-name'), gc('export-tiff-lzw')])).toEqual([d0 + 1, 'plos', 'Fig1', true]);
  // the printed-width menu now offers PLOS's widths and Free
  const shown = await page.evaluate(() => [...document.getElementById('export-width-mm').options].filter(o => !o.hidden).map(o => o.value));
  expect(shown).toEqual(['0', '66.8', '173', '190.5']);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => [undoStack.length, gv('target-journal'), _lastPresetName, gv('export-name')])).toEqual([d0, 'none', '', 'figure']);
  // the preset button the tutorial presses still reports PLOS
  await page.evaluate(() => applyPreset('plos'));
  expect(await page.evaluate(() => [gv('target-journal'), _lastPresetName])).toEqual(['plos', 'plos']);
  expect(errors).toEqual([]);
});

// ── The submission package and the Save dialog ───────────────────────────────────
const ZIPREAD = () => {
  window._zipRead = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset); const out = {}; let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const csize = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
      const off = p + 30 + nlen + elen; out[name] = bytes.subarray(off, off + csize); p = off + csize;
    }
    return out;
  };
};
// Before: the TIFF was "figure.tiff" and the sheet "S1_uncropped_originals.pdf" whatever the journal.
test('the package names files the journal\'s way: PLOS Fig1 + S1_raw_images, eLife "Figure 1—source data 1"', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await setup(page, 2);
  await page.evaluate(ZIPREAD);
  const names = await page.evaluate(async () => {
    selectedPanel = 0; addSpliceMarker();
    const out = {};
    for (const j of ['plos', 'elife']) {
      applyPreset(j); render();
      const cap = await _captureDownload(() => exportSubmissionPackage());
      out[j] = Object.keys(_zipRead(cap.data));
    }
    return out;
  });
  expect(names.plos).toContain('Fig1.tif');            // PLOS's own naming: .tif, not .tiff
  expect(names.plos).toContain('S1_raw_images.pdf');
  expect(names.plos.some(n => /uncropped_originals/.test(n))).toBe(false);
  expect(names.elife).toContain('Figure 1—source data 1.pdf');
  expect(errors).toEqual([]);
});

// Before: the Save dialog knew only "PLOS asks for LZW", and only from the preset name.
test('the Save dialog names the journal\'s format, size and naming rule and offers the accepted format', async ({ page }) => {
  const errors = await setup(page, 2);
  const r = await page.evaluate(() => {
    applyPreset('plos'); sv('export-name', 'figure');
    doExportPreflight('png');
    const a = document.getElementById('preflight-body').textContent;
    document.querySelector('#preflight-body button').click();      // Use TIFF
    const fmt = document.getElementById('pf-format').value, b = document.getElementById('preflight-body').textContent;
    closePreflight();
    return { a, fmt, b };
  });
  expect(r.a).toMatch(/Target journal\s*PLOS ONE: TIFF \(LZW\) · ≤ 10 MB · Fig1\.tif/);
  expect(r.a).toMatch(/PLOS ONE accepts TIFF, not PNG/);
  expect(r.a).toMatch(/PLOS ONE names figure files Fig1\.tif/);
  expect(r.fmt).toBe('tiff');
  expect(r.b).not.toMatch(/accepts TIFF, not/);
  expect(errors).toEqual([]);
});

// Before: ⌘K had "Preset: PLOS" and nothing for ASM, mBio, JVI or "check against".
test('⌘K finds journals by the words people type, and checks against one without changing the figure', async ({ page }) => {
  const errors = await setup(page, 2);
  const r = await page.evaluate(() => {
    const find = q => CMD_REGISTRY.filter(c => _cmdpScore(c, q) > 0).map(c => c.label);
    const out = { mbio: find('mbio'), jvi: find('jvi'), elife: find('elife'), col: find('column width') };
    const before = JSON.stringify(_collectFigControls({ layout: {}, style: {} }));
    CMD_REGISTRY.find(c => c.label === 'Check against EMBO J').run();
    out.title = document.getElementById('im-title').textContent;
    const after = JSON.parse(JSON.stringify(_collectFigControls({ layout: {}, style: {} })));
    out.target = after.targetJournal; delete after.targetJournal;
    const b = JSON.parse(before); delete b.targetJournal;
    out.same = JSON.stringify(after) === JSON.stringify(b);
    return out;
  });
  expect(r.mbio).toContain('Journal: ASM (mBio, J Bacteriol, J Virol…)');
  expect(r.jvi).toContain('Journal: ASM (mBio, J Bacteriol, J Virol…)');
  expect(r.elife).toContain('Check against eLife');
  expect(r.col.length).toBeGreaterThanOrEqual(6);
  expect(r.title).toMatch(/^EMBO J compliance/);
  expect(r.target).toBe('embo');
  expect(r.same).toBe(true);
  expect(errors).toEqual([]);
});
