// @ts-check
// Round 3 on inline label formatting and journal profiles: the defects an adversarial
// tester found (F01–F22), each with the test that fails on the code before its fix.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { loadApp, seedPanels, seedFreeform } = require('./helpers');
const APP_URL = 'file://' + path.resolve(__dirname, '..', 'figure_lab.html');

// ── F01: author text never becomes markup ─────────────────────────────────────
// Labels, names, tags and titles arrive in session files and share links, so a label is
// someone else's text. Fails before the fix: the compliance report wrote a panel label
// into the "Display ranges by channel" and "Scale bar drawn" notes unescaped, and the
// Save dialog, deep audit, exposure analysis, annotation/group lists and panel drawer
// wrote names, colours and numbers from the file into markup.
const P1 = '<img src=x onerror="window.__xss=1">';
const P2 = '"><svg onload=window.__xss=1>';
const P3 = "'onmouseover='window.__xss=1";
const PAY = P1 + P2 + P3;

// What a payload leaves behind if it became markup anywhere in the page.
const SWEEP = () => {
  const bad = [...document.querySelectorAll('[onerror],[onload],[onmouseover]')]
    .filter(e => /__xss/.test(e.getAttribute('onerror') || '') || /__xss/.test(e.getAttribute('onload') || '') || /__xss/.test(e.getAttribute('onmouseover') || ''));
  return { xss: window.__xss, injected: bad.map(e => e.tagName + ' in ' + ((e.closest('[id]') || {}).id || '?')), imgX: document.querySelectorAll('img[src="x"]').length };
};

// Put the payload into every piece of author text a figure file can carry.
async function hostileFigure(page) {
  await seedPanels(page, 3);
  await page.evaluate((PAY) => {
    sv('label-format', 'custom');
    images.forEach((im, i) => {
      im.label = PAY + i; im.name = PAY + '.png'; im.tag = PAY; im.group = PAY; im.captionNote = PAY; im.metaNote = PAY;
      im.lut = i === 2 ? 'red' : 'green'; im.blackPt = i * 10; im.sbOn = true; im.umPerPx = i === 1 ? 50 : 0;
      im.channels = [];
    });
    sv('fig-title', PAY); sv('export-name', PAY); sc('show-col-labels', true);
    sv('fig-notes', PAY);
    setAxisLabels && setAxisLabels('col', [PAY, PAY]);
    figGroups = [{ axis: 'row', from: 1, to: 1, label: PAY }];
    annotations.push({ type: 'text', text: PAY, name: PAY, xf: 0.02, yf: 0.1, fontSize: 14, color: '#000', blotPanel: images[0].id, mw: true });
    annotations.push({ type: 'text', text: '250', xf: 0.02, yf: 0.2, fontSize: 14, color: '#000', blotPanel: images[0].id, mw: true });
    annotations.push({ type: 'ruler', xf: 0.1, yf: 0.1, x2f: 0.2, y2f: 0.1, color: '#fff', rulerName: PAY });
    annotations.push({ type: 'line', xf: 0.1, yf: 0.1, x2f: 0.2, y2f: 0.2, splice: true, splicePanel: images[0].id, color: '#000' });
    images[1].panelAnns = [{ type: 'text', text: PAY, xf: 0.5, yf: 0.5, color: '#fff' }];
    measurements.push({ type: 'roi', label: PAY, meanGray: PAY }, { type: 'cellCount', label: PAY, count: PAY });
    laneTableSetName(0, 0, PAY); laneTableAddRow(0, PAY); laneTableSetCell(0, 0, 0, PAY);
    render(); renderImgList(); renderAnnotationList();
  }, PAY);
}

async function openEverything(page) {
  const out = [];
  const step = async (name, fn, arg) => {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(60);
    out.push({ name, ...(await page.evaluate(SWEEP)) });
    await page.evaluate(() => { document.querySelectorAll('.modal-bg.open,#info-modal-bg,#confirm-modal-bg').forEach(m => { if (m.id === 'info-modal-bg' || m.id === 'confirm-modal-bg' || !m.id || /-bg$/.test(m.id)) m.remove(); else m.classList.remove('open'); }); });
  };
  await step('panel list + drawers', () => { renderImgList(); document.querySelectorAll('.img-settings').forEach(s => s.classList.add('open')); });
  await step('annotation list', () => renderAnnotationList());
  await step('group list', () => renderGroupList());
  await step('measurement list', () => _renderMeasList());
  await step('tutorials list', () => renderTutorialList());
  await step('house styles', () => { try { localStorage.setItem('figurelab_housestyles', JSON.stringify([{ name: document.getElementById('fig-title').value, style: {} }])); } catch (e) {} renderHouseStyles(); });
  for (const j of ['none', 'elife', 'embo', 'asm', 'plos', 'science']) {
    await step('compliance ' + j, (j) => { sv('target-journal', j === 'none' ? '' : j); _syncJournalFromControl(); checkCompliance(); }, j);
  }
  await step('deep audit', () => runAdvancedConsistency());
  await step('duplication check', () => runDuplicateScan());
  await step('exposure analysis', () => runExposureAnalysis());
  await step('S1 dialog', () => openS1Dialog());
  await step('lane table editor', () => openLaneTable(0));
  await step('gel dialog', () => openGelAnalysis(0));
  await step('before/after', () => openBeforeAfter(0));
  await step('panel comparison', () => openPanelComparison());
  await step('Save dialog', () => doExportPreflight('tiff'));
  await step('help', () => openHelp());
  await step('credits', () => showCredits());
  await step('palette search', () => { openCmdPalette(); const i = document.getElementById('cmdp-input'); i.value = document.getElementById('fig-title').value; _cmdpRender(i.value); });
  await step('paste destination', (P) => { _pastedNames.add(P); _buildPasteDest(P); }, PAY);
  await step('lab-style summary', (P) => loadLabStyle({ app: P, created_at: P, settings: { font_family: P, [P]: 1 } }, P + '.json'), PAY);
  await step('replace-all summary', async (P) => {
    const c = document.createElement('canvas'); c.width = c.height = 20;
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    await replaceAllImages([new File([b], P + '.png', { type: 'image/png' })]);
  }, PAY);
  await step('reuse check dialog', async (P) => {
    openCrossFigureCheck();
    const sess = JSON.stringify({ images: [{ label: P, name: P, src: images[0].src }] });
    await _xdAddFiles([new File([sess], P + '.json', { type: 'application/json' })]);
  }, PAY);
  return out;
}

// bad: also give the file hostile numbers and colours (fields a well-formed file holds as
// numbers), which the lists and the panel drawer write into attributes.
async function f01(page, bad) {
  const errors = await loadApp(page);
  await hostileFigure(page);
  // Through a saved session file.
  // Fields the lists and the panel drawer write into attributes — numbers and colours in
  // a well-formed file — given hostile values in the file itself.
  const BADNUM = (s) => { const X = '"><img src=x onerror="window.__xss=1">';
    s.images.forEach(d => { if (!d) return; d.borderC = '#fff" onmouseover="window.__xss=1'; d.cropT = X; d.blackPt = X;
      (d.panelAnns || []).forEach(a => { a.color = X; }); });
    (s.annotations || []).forEach(a => { if (a.type === 'text') a.color = 'red;' + X; });
    (s.style.figGroups || []).forEach(g => { g.axis = 'row" onmouseover="window.__xss=1'; g.from = X; });
    return s; };
  const B0 = bad ? BADNUM.toString() : '(s) => s';
  const saved = await page.evaluate((B) => JSON.stringify((new Function('return ' + B)())(serializeSession(true))), B0);
  await page.evaluate((s) => { applySession(JSON.parse(s)); render(); renderImgList(); }, saved);
  await page.waitForTimeout(300);
  // the loaded file really carries the payloads (no vacuous pass)
  const carried = await page.evaluate(() => ({ label: images[0].label, title: gv('fig-title'), name: gv('export-name'), ann: annotations[0].text }));
  expect(carried.label).toContain('onerror');
  expect(carried.title).toContain('<svg');
  const viaFile = await openEverything(page);
  for (const r of viaFile) {
    expect(r.xss, r.name).toBeUndefined();
    expect(r.injected, r.name).toEqual([]);
    expect(r.imgX, r.name).toBe(0);
  }
  // The compliance report did show the labels — as text.
  const shown = await page.evaluate(() => { sv('target-journal', ''); _syncJournalFromControl(); checkCompliance(); return document.getElementById('im-body').textContent; });
  expect(shown).toContain('<img src=x onerror=');

  // Through a share link.
  const share = await page.evaluate((B) => { const s = (new Function('return ' + B)())(serializeSession(false, 'share')); s._shared = true; return btoa(encodeURIComponent(JSON.stringify(s))); }, B0);
  const page2 = await page.context().newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(e.message));
  await page2.goto(APP_URL + '#share=' + share);
  await page2.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  await page2.waitForTimeout(300);
  expect(await page2.evaluate(() => gv('fig-title'))).toContain('<svg');
  // the share link carries no pixels: drop files back so the panels are drawn
  await seedPanels(page2, 3);
  await page2.evaluate(() => { render(); renderImgList(); renderAnnotationList(); });
  const viaLink = await openEverything(page2);
  for (const r of viaLink) {
    expect(r.xss, 'share: ' + r.name).toBeUndefined();
    expect(r.injected, 'share: ' + r.name).toEqual([]);
    expect(r.imgX, 'share: ' + r.name).toBe(0);
  }
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
  await page2.close();
}
// Fails before: the compliance report ran the label's script ("Display ranges by channel",
// "Scale bar drawn"), and the Save dialog and deep audit wrote the export name and labels
// as markup.
test('F01: hostile text in a session file and a share link never runs script in any dialog, report or list', async ({ page }) => {
  test.setTimeout(180000);
  await f01(page, false);
});
// Fails before: a file's non-numeric crop crashed the render on opening (and its colours
// and group-band numbers reached the annotation and group lists as attribute markup).
test('F01: hostile numbers and colours in a session file and a share link neither break the figure nor run script', async ({ page }) => {
  test.setTimeout(180000);
  await f01(page, true);
});

// ── Shared ────────────────────────────────────────────────────────────────────────
// The compliance report as rows; the report is closed again after reading.
const REPORT = () => {
  window.__rows = () => { checkCompliance(); const rows = [...document.querySelectorAll('#info-modal-bg .compliance-row')].map(e => ({
    label: e.querySelector('.c-label').textContent.trim(), icon: e.querySelector('.c-icon').textContent.trim(),
    text: e.textContent.replace(/\s+/g, ' ').trim(), fix: e.querySelector('button') ? e.querySelector('button').textContent.trim() : null }));
    document.getElementById('info-modal-bg')?.remove(); return rows; };
  window.__row = l => (__rows().find(r => r.label === l) || null);
};
async function setup(page, n = 2) { const errors = await loadApp(page); if (n) await seedPanels(page, n); await page.evaluate(REPORT); return errors; }
// Local entries of a ZIP, stored or deflated, by name.
const ZIPREAD = () => {
  window._zipRead = async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset); const out = {}; let p = 0;
    while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true), csize = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
      const off = p + 30 + nlen + elen; let data = bytes.subarray(off, off + csize);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out[name] = data; p = off + csize;
    }
    return out;
  };
};

// ── F02 / F03 / F09: the parser and the plain-text form ──────────────────────────
// Fails before: P_{lac} → "Pₗₐc" and k_{cat} → "kcₐₜ" (half-converted), E_{max} → "Eₘₐₓ".
test('F02: a sub/superscript group is converted whole or written plainly, never half-converted', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => {
    const T = ['P_{lac}', 'k_{cat}', '10^{8}', 'Ca^{2+}', 'H_{2}O', 'x^{n+1}', 'x^{n}', 'kan^{R}', '10^{min}', 'x^{2y}', 'α_{v}β_{3}', 'E_{max}', 'H_{2}O_{2}'];
    const o = Object.fromEntries(T.map(s => [s, _rtPlain(s)]));
    sv('fig-title', 'k_{cat} of 10^{min}'); sv('label-format', 'custom'); images[0].label = 'P_{lac}-gfp'; render();
    o.caption = _captionText();
    return o;
  });
  expect(r['P_{lac}']).toBe('Plac');
  expect(r['k_{cat}']).toBe('kcat');
  expect(r['10^{8}']).toBe('10⁸');
  expect(r['Ca^{2+}']).toBe('Ca²⁺');
  expect(r['H_{2}O']).toBe('H₂O');
  expect(r['x^{n+1}']).toBe('xⁿ⁺¹');
  expect(r['x^{n}']).toBe('xⁿ');
  expect(r['kan^{R}']).toBe('kan^R');
  expect(r['10^{min}']).toBe('10^(min)');
  expect(r['x^{2y}']).toBe('x^(2y)');
  expect(r['α_{v}β_{3}']).toBe('αvβ₃');
  expect(r['E_{max}']).toBe('Emax');
  expect(r['H_{2}O_{2}']).toBe('H₂O₂');
  expect(r.caption).toContain('kcat of 10^(min)');
  expect(r.caption).toContain('Plac-gfp');
  for (const v of Object.values(r)) expect(v).not.toMatch(/[ₐₑₒₓₕₖₗₘₙₚₛₜⁱ]/);
  expect(errors).toEqual([]);
});

// Fails before: "^{}" was a group with nothing in it — drawn as nothing, captioned "Figure. .".
test('F03: an empty group is not markup: "^{}" and "_{}" are drawn and captioned as typed', async ({ page }) => {
  const errors = await setup(page, 2);
  const r = await page.evaluate(() => {
    sv('fig-title', '^{}'); sc('show-col-labels', true); onLayoutChange(); setAxisLabels('col', ['_{}', 'x_{}']); render();
    return { has: ['^{}', '_{}', 'x_{}'].map(_rtHas), plain: ['^{}', '_{}', 'x_{}'].map(_rtPlain),
      title: figTextItems.filter(t => t.kind === 'title').map(t => ({ str: t.str, w: t.bbox ? t.bbox.w : t.w })), cap: _captionText() };
  });
  expect(r.has).toEqual([false, false, false]);
  expect(r.plain).toEqual(['^{}', '_{}', 'x_{}']);
  expect(r.title[0].str).toBe('^{}');
  expect(r.title[0].w).toBeGreaterThan(5);
  expect(r.cap).toMatch(/\^\{\}/);
  expect(r.cap).not.toMatch(/Figure\. \./);
  expect(errors).toEqual([]);
});

// The opener rule, as a table. Fails before: every "should stay literal" entry from the
// tester's report paired into italics.
const STAY_LITERAL = ['WT*KO*', 'x*y* = 5', 'rec*A*', 'a*b*', '*(p<0.05)*', '*+*', '*-*', 'a*b', 'WT*', '*', '**', '***',
  '* p < 0.05', '*p<0.05, **p<0.01', 'WT*, KO*', 'p*', 'a*b*c', '2*3', '*** vs WT', 'WT* KO*', '(*)', '*,**', 'recA*', '^{}', '_{}'];
const MARKED = [
  ['Δ*fliC*', ['Δ[]', 'fliC[i]']],
  ['*E. coli*', ['E. coli[i]']],
  ['**WT**', ['WT[b]']],
  ['10^{8} PFU/mL', ['10[]', '8[^]', ' PFU/mL[]']],
  ['Ca^{2+}', ['Ca[]', '2+[^]']],
  ['H_{2}O', ['H[]', '2[_]', 'O[]']],
  ['**E. coli *fliC***', ['E. coli [b]', 'fliC[ib]']],
  ['*E. coli* ΔfliC', ['E. coli[i]', ' ΔfliC[]']],
  ['**Ca^{2+}** (mM)', ['Ca[b]', '2+[b^]', ' (mM)[]']],
];
test('F09: a star against the end of a word, or before punctuation, never opens a span; the README\'s examples still do', async ({ page }) => {
  const errors = await setup(page, 0);
  const r = await page.evaluate(([L, M]) => {
    const f = s => _rtRuns(s).map(x => x.t + '[' + (x.i ? 'i' : '') + (x.b ? 'b' : '') + (x.sup ? '^' : '') + (x.sub ? '_' : '') + ']');
    return { lit: L.map(s => ({ s, has: _rtHas(s), plain: _rtPlain(s) })), marked: M.map(([s]) => ({ s, runs: f(s) })) };
  }, [STAY_LITERAL, MARKED]);
  for (const x of r.lit) { expect(x.has, x.s).toBe(false); expect(x.plain, x.s).toBe(x.s); }
  r.marked.forEach((x, i) => expect(x.runs, x.s).toEqual(MARKED[i][1]));
  expect(errors).toEqual([]);
});

// ── F04: lane-table names measured as drawn ──────────────────────────────────────
// Fails before: the marked names were placed by their raw width and ended 48 px and 13 px
// short of the others.
test('F04: lane-table row names with marks end at the same gap left of the blot as plain ones', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); onLayoutChange();
    images[0].laneTable = { rows: [{ name: 'IPTG (mM)', cells: ['+', '-', '+', '-'] }, { name: '**Ca^{2+}** (mM)', cells: ['+', '+', '-', '-'] }, { name: '*araC*', cells: ['', '+', '', '+'] }], lanes: 4, pos: 'above', fs: 14 };
    render();
    const it = figTextItems.filter(t => t.kind === 'lanetable' && /[A-Za-z]/.test(t.str));
    const c = document.createElement('canvas').getContext('2d'); c.font = it[0].font;
    return { rights: it.map(t => +(t.bbox.x + t.bbox.w).toFixed(1)), runs: it.map(t => !!t.runs),
      need: _ltNameNeed(images[0]), widest: Math.max(...it.map(t => _rtMeasure(c, t.str))), fs: 14 };
  });
  expect(r.runs).toEqual([false, true, true]);
  expect(Math.max(...r.rights) - Math.min(...r.rights)).toBeLessThan(0.6);
  expect(r.need).toBe(Math.ceil(r.widest + r.fs * 0.5 + 2));      // the strip is the widest DRAWN name
  expect(errors).toEqual([]);
});

// ── F05 / F06 / F07: Ctrl+I and Ctrl+B, with the real keyboard ────────────────────
async function selectIn(page, sel, a, b) {
  await page.locator(sel).first().focus();
  await page.evaluate(([sel, a, b]) => document.querySelector(sel).setSelectionRange(a, b), [sel, a, b]);
}
test('F05/F06: Ctrl+I hugs the text, toggles off when pressed again, and Ctrl+B never writes "****"', async ({ page }) => {
  const errors = await setup(page, 1);
  await page.evaluate(() => document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; }));
  const title = page.locator('#fig-title');
  // F05: a selection ending in a space ("E. coli ") — the marks stay off the space
  await title.fill('E. coli strain');
  await selectIn(page, '#fig-title', 0, 8);
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).toBe('*E. coli* strain');
  await page.evaluate(() => render());
  expect(await page.evaluate(() => !!figTextItems.find(t => t.kind === 'title').runs)).toBe(true);
  // F06: again → italic off (not bold)
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).toBe('E. coli strain');
  // Ctrl+B twice → bold on, bold off; never a row of four stars
  await selectIn(page, '#fig-title', 0, 7);
  await page.keyboard.press('Control+b');
  expect(await title.inputValue()).toBe('**E. coli** strain');
  await page.keyboard.press('Control+b');
  expect(await title.inputValue()).toBe('E. coli strain');
  // italic inside bold: Ctrl+I adds italic, Ctrl+I takes only the italic away
  await selectIn(page, '#fig-title', 0, 7);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).toBe('***E. coli*** strain');
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).toBe('**E. coli** strain');
  // the selection itself may hold the marks: select "*x*" and Ctrl+I unwraps it
  await title.fill('a *b* c');
  await selectIn(page, '#fig-title', 2, 5);
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).toBe('a b c');
  // nothing selected: the marks go in for the text typed between them, with no warning
  await title.fill('ab');
  await selectIn(page, '#fig-title', 1, 1);
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).toBe('a**b');
  expect(await page.evaluate(() => document.getElementById('toast').textContent)).toBe('');
  // literal stars are not "marks": "WT*KO*" with KO selected is not unwrapped into "WTKO"
  await title.fill('WT*KO*');
  await selectIn(page, '#fig-title', 3, 5);
  await page.keyboard.press('Control+i');
  expect(await title.inputValue()).not.toBe('WTKO');
  expect(errors).toEqual([]);
});

test('F07: Ctrl+I works in chart axis titles and the lane table, one undo step in the table', async ({ page }) => {
  const errors = await setup(page, 1);
  // chart axis titles
  await page.evaluate(() => { const s = document.getElementById('layout-mode'); s.value = 'freeform'; setLayoutMode('freeform'); addChartElement('bar');
    selectedElems.clear(); selectedElems.add(freeformElements.length - 1); openChartModal(); });
  for (const id of ['#chart-xtitle', '#chart-ytitle']) {
    await page.locator(id).fill('E. coli');
    await selectIn(page, id, 0, 7);
    await page.keyboard.press('Control+i');
    expect(await page.locator(id).inputValue(), id).toBe('*E. coli*');
  }
  await page.evaluate(() => closeChartModal());
  // lane table: back to the grid
  await page.evaluate(() => { const s = document.getElementById('layout-mode'); s.value = 'grid'; setLayoutMode('grid'); render(); laneTableSetName(0, 0, 'araC'); openLaneTable(0); });
  const d0 = await page.evaluate(() => undoStack.length);
  await selectIn(page, '#lt-grid .lt-name', 0, 4);
  await page.keyboard.press('Control+i');
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => images[0].laneTable.rows[0].name)).toBe('*araC*');
  expect(await page.evaluate(() => undoStack.length)).toBe(d0 + 1);
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => images[0].laneTable.rows[0].name)).toBe('araC');
  expect(errors).toEqual([]);
});

// ── F08: the submission package names a panel as the caption does ────────────────
// Fails before: PANEL_HISTORY.txt read "*E. coli* H_{2}O_{2}" and the file
// "panels/panel_1_E._coli_H__2_O__2.png".
test('F08: PANEL_HISTORY.txt and panels/ file names use the label without its marks', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await setup(page, 1);
  await page.evaluate(ZIPREAD);
  const r = await page.evaluate(async () => {
    sv('label-format', 'custom'); images[0].label = '*E. coli* H_{2}O_{2}'; render();
    const c = await _captureDownload(() => exportSubmissionPackage()); const z = await _zipRead(c.data);
    const ph = new TextDecoder().decode(z['PANEL_HISTORY.txt']);
    return { files: Object.keys(z).filter(k => k.startsWith('panels/')), head: ph.split('\n').find(l => l.startsWith('──')) };
  });
  expect(r.files).toEqual(['panels/panel_1_E._coli_H2O2.png']);
  expect(r.head, JSON.stringify(r)).toMatch(/^── E\. coli H₂O₂ ──/);
  expect(errors).toEqual([]);
});

// ── F10 / F13: the figure's own number ────────────────────────────────────────────
// Fails before: every one of these became "Fig1", and eLife's sheet took the first number
// in the name ("Figure 2026—source data 1").
test('F10/F13: PLOS keeps the figure\'s number and leaves "S2 Fig" alone; eLife takes the number after "figure"', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => {
    const out = {};
    for (const n of ['Figure 3', 'fig3', 'Fig 3', 'figure_7', 'S2 Fig', 'figure']) { sv('target-journal', 'none'); _syncJournalFromControl(); sv('export-name', n); applyPreset('plos'); out[n] = gv('export-name'); undo(); }
    sv('export-name', 'figure 4'); applyPreset('plos'); sv('export-name', 'draft figure 4');
    out.fix = __row('File name').fix;
    sv('export-name', 'figure'); out.noNum = __row('File name');
    sv('target-journal', 'elife'); _syncJournalFromControl();
    out.s1 = {};
    for (const n of ['2026-11-13 figure 4', 'v2 Figure 5', 'Fig5_rev2', 'figure']) { sv('export-name', n); out.s1[n] = _journalS1Name(); }
    return out;
  });
  expect(r['Figure 3']).toBe('Fig3');
  expect(r['fig3']).toBe('Fig3');
  expect(r['Fig 3']).toBe('Fig3');
  expect(r['figure_7']).toBe('Fig7');
  expect(r['S2 Fig']).toBe('S2 Fig');
  expect(r['figure']).toBe('figure');                      // no number: not guessed
  expect(r.fix).toBe('Name Fig4');
  expect(r.noNum.icon).toBe('✗');
  expect(r.noNum.fix).toBeNull();
  expect(r.noNum.text).toMatch(/no figure number/);
  expect(r.s1).toEqual({ '2026-11-13 figure 4': 'Figure 4—source data 1', 'v2 Figure 5': 'Figure 5—source data 1',
    'Fig5_rev2': 'Figure 5—source data 1', 'figure': 'Figure—source data 1' });
  expect(errors).toEqual([]);
});

// ── F11: the Target journal control, one undo step per change ─────────────────────
// Fails before: choosing None (the menu still focused) recorded no step, so Ctrl+Z undid
// PLOS itself; a scripted change recorded the step after the control had moved.
test('F11: every change of Target journal, None included, is exactly one undo step', async ({ page }) => {
  const errors = await setup(page, 2);
  await page.evaluate(() => { document.querySelectorAll('aside.sidebar details').forEach(d => { d.open = true; }); sv('export-name', 'Figure 1'); });
  const tj = page.locator('#target-journal');
  await tj.focus(); await tj.selectOption('plos');
  const a = await page.evaluate(() => ({ u: undoStack.length, name: gv('export-name'), w: gv('export-width-mm') }));
  expect([a.name, a.w]).toEqual(['Fig1', '173']);
  await tj.focus(); await tj.selectOption('none');            // still focused: no new arm
  expect(await page.evaluate(() => undoStack.length)).toBe(a.u + 1);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => [gv('target-journal'), gv('export-name'), gv('export-width-mm'), _lastPresetName])).toEqual(['plos', 'Fig1', '173', 'plos']);
  // a scripted change (an assistive tool): the step holds the journal shown before it
  const b = await page.evaluate(() => { const u = undoStack.length; sv('target-journal', 'embo'); _onTargetJournal('embo');
    const after = [undoStack.length - u, gv('target-journal')]; undo(); return { after, back: [gv('target-journal'), gv('export-name'), gv('export-width-mm')] }; });
  expect(b.after).toEqual([1, 'embo']);
  expect(b.back).toEqual(['plos', 'Fig1', '173']);
  expect(errors).toEqual([]);
});

// ── F12: one DPI rule ─────────────────────────────────────────────────────────────
// Fails before: the Save dialog used 600 (line art) for a figure with no text, the report 300.
test('F12: the Save dialog and the report compute EMBO\'s DPI need the same way', async ({ page }) => {
  const errors = await setup(page, 2);
  const read = () => page.evaluate(() => {
    const row = __row('Export DPI'); doExportPreflight('tiff'); _refreshPreflight();
    const dlg = document.getElementById('preflight-modal').textContent.replace(/\s+/g, ' '); closePreflight();
    return { icon: row.icon, below: /EMBO J:[^.]*below it/.test(dlg) };
  });
  await page.evaluate(() => { applyPreset('embo'); sc('show-labels', false); sv('fig-title', ''); sc('show-col-labels', false); onLayoutChange(); sv('export-dpi', '300'); render(); });
  expect(await page.evaluate(() => _figTextSizes().length)).toBe(0);
  expect(await read()).toEqual({ icon: '✓', below: false });             // halftone, no text: 300 is enough in both
  await page.evaluate(() => { sv('fig-title', 'Title'); render(); });
  expect(await read()).toEqual({ icon: '✗', below: true });              // text: 600 in both
  expect(errors).toEqual([]);
});

// ── F14 / F15: Fit converges or refuses ───────────────────────────────────────────
// Fails before: Nature left headings at 3.8 pt; each Fit click changed nothing but added an
// undo step and cleared Redo; with PLOS a Fit pushed headings further out (7.1 → 5.7 pt).
test('F14: applying Nature puts the headings in range; Fit with an unfittable title refuses and touches no history', async ({ page }) => {
  const errors = await setup(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', '2'); sv('rows', '2'); sc('show-col-labels', true); sc('show-row-labels', true); sv('fig-title', 'Title'); onLayoutChange(); render();
    applyPreset('nature'); render();
    const k = _physFacts().ptPerPx, heads = figTextItems.filter(t => t.kind === 'col' || t.kind === 'row').map(t => t.fs * k);
    const row = __row('Text size');
    undo(); redo();                                        // seed Redo: undo then redo leaves one... re-seed below
    undo(); const u = undoStack.length, rd = redoStack.length, ax = gi('axis-fs'), lb = gi('label-size');
    redo(); undo();
    const u2 = undoStack.length, rd2 = redoStack.length;
    applyPreset('nature'); undo(); applyPreset('nature');  // back on Nature, with Redo empty; seed it:
    sv('m-top', String(gi('m-top') + 2)); pushUndo(); undo();
    const before = { u: undoStack.length, rd: redoStack.length, ax: gi('axis-fs'), lb: gi('label-size') };
    _auditFix('jtext'); document.getElementById('info-modal-bg')?.remove();
    _auditFix('jtext'); document.getElementById('info-modal-bg')?.remove();
    const after = { u: undoStack.length, rd: redoStack.length, ax: gi('axis-fs'), lb: gi('label-size') };
    return { heads, row, before, after, k };
  });
  for (const pt of r.heads) { expect(pt).toBeGreaterThanOrEqual(5 - 0.05); expect(pt).toBeLessThanOrEqual(7 + 0.05); }
  expect(r.row.fix).toBeNull();                              // no Fit offered when it cannot finish
  expect(r.row.text).toMatch(/drop the title or change the printed width/);
  expect(r.after).toEqual(r.before);                         // no step, Redo intact, nothing moved
  expect(r.before.rd).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('F14: PLOS at 190.5 mm with a title — Fit never moves headings further out of range', async ({ page }) => {
  const errors = await setup(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', '4'); sv('rows', '1'); sc('show-col-labels', true); sv('fig-title', 'Title'); onLayoutChange(); render();
    applyPreset('plos'); sv('export-width-mm', '190.5'); render();
    const pts = () => { render(); const k = _physFacts().ptPerPx; return figTextItems.filter(t => t.kind === 'col').map(t => t.fs * k); };
    const dist = a => Math.max(0, ...a.map(p => p < 8 ? 8 - p : p > 12 ? p - 12 : 0));
    const b = pts(), u = undoStack.length; _auditFix('jtext'); document.getElementById('info-modal-bg')?.remove();
    const a = pts();
    return { before: dist(b), after: dist(a), steps: undoStack.length - u };
  });
  expect(r.after).toBeLessThanOrEqual(r.before + 1e-9);
  if (r.after === r.before) expect(r.steps).toBe(0);
  expect(errors).toEqual([]);
});

// Fails before: Fit set the letter size to 5, below the 7 px the letters are drawn at, so
// nothing changed, and the row went on offering Fit.
test('F15: letters at their 7 px floor above Nature\'s 7 pt: the row says why and offers 89 mm, which passes', async ({ page }) => {
  const errors = await setup(page, 4);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '4'); sv('fig-title', ''); onLayoutChange(); render();
    applyPreset('nature'); sv('export-width-mm', '183'); render();
    const before = __row('Text size');
    const u = undoStack.length; _auditFix('jnarrow'); document.getElementById('info-modal-bg')?.remove();
    return { before, w: gv('export-width-mm'), steps: undoStack.length - u, after: __row('Text size') };
  });
  expect(r.before.icon).toBe('✗');
  expect(r.before.text).toMatch(/no smaller than 7 px/);
  expect(r.before.fix).toBe('Set 89 mm');
  expect(r.w).toBe('89');
  expect(r.steps).toBe(1);
  expect(r.after.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// ── F16: freeform figures ─────────────────────────────────────────────────────────
// Fails before: a figure of freeform pictures only got "Render a figure first", and with
// grid panels loaded the report judged those panels (red/green, labels 2/2, calibration ✗).
test('F16: a freeform figure is checked as drawn, and grid-panel rows say they do not apply', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(REPORT);
  await seedFreeform(page, [{ type: 'image', x: 10, y: 10, w: 200, h: 200, fill: '#cc3333' }, { type: 'image', x: 220, y: 10, w: 200, h: 200, fill: '#33cc33' },
    { type: 'text', x: 10, y: 230, w: 300, h: 40, text: 'Freeform note', fontSize: 40 }]);
  const a = await page.evaluate(() => { freeformElements[0].lut = 'red'; freeformElements[1].lut = 'green'; render();
    sv('target-journal', 'nature'); _syncJournalFromControl(); const rows = __rows();
    return { opened: rows.length > 0, rg: rows.find(x => x.label === 'Red/green'), text: rows.find(x => x.label === 'Text size'),
      labels: rows.find(x => x.label === 'Panel labels') }; });
  expect(a.opened).toBe(true);
  expect(a.rg.icon).toBe('⚠');                                // the two picture objects, red beside green
  expect(a.text.text).toMatch(/freeform text/);               // freeform text objects are in the type-size row
  expect(a.text.icon).toBe('✗');                              // 40 px is far over 7 pt at 183 mm
  // grid panels loaded, then switched to an empty freeform canvas
  const b = await page.evaluate(async () => {
    freeformElements.length = 0; const s = document.getElementById('layout-mode'); s.value = 'grid'; setLayoutMode('grid');
    return true; });
  await seedPanels(page, 2);
  const c = await page.evaluate(() => {
    images[0].lut = 'red'; images[1].lut = 'green'; images[0].sbOn = true; images[0].umPerPx = 0;
    const s = document.getElementById('layout-mode'); s.value = 'freeform'; setLayoutMode('freeform'); freeformElements.length = 0; render();
    sv('target-journal', 'asm'); _syncJournalFromControl(); return __rows(); });
  const by = l => c.find(x => x.label === l);
  expect(by('Red/green').icon).toBe('✓');
  expect(by('Panel labels').icon).toBe('ℹ');
  expect(by('Panel labels').text).toMatch(/Does not apply in freeform layout/);
  expect(by('Scale-bar calibration').icon).toBe('ℹ');
  // nothing about the grid's panels fails or warns (width and font are the freeform figure's own)
  const GRID = ['Red/green', 'Panel labels', 'Panel labels unique', 'Scale-bar calibration', 'Scale bar drawn', 'Display ranges by channel', 'Min panel size', 'Adjustment sanity'];
  expect(c.filter(x => GRID.includes(x.label) && (x.icon === '✗' || x.icon === '⚠')).map(x => x.text)).toEqual([]);
  expect(errors).toEqual([]);
});

// ── F17: MW labels typed by hand ──────────────────────────────────────────────────
// Fails before: "no molecular-weight labels" for numbers typed with the Text tool beside
// the blot, and for ladder labels carrying "kDa".
test('F17: numbers typed beside a blot, and "kDa" ladder labels, count as MW labels', async ({ page }) => {
  const errors = await setup(page, 0);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, 200, 200);
    const src = c.toDataURL(); await new Promise(r => { const im = new Image(); im.onload = () => { _commitImage(im, src, 'blot.png'); r(); }; im.src = src; });
    render();
  });
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); onLayoutChange();
    selectedPanel = 0; addSpliceMarker(); render();
    const inp = document.getElementById('ann-text-input');
    const place = (t, yf) => { inp._px = 0.08; inp._py = yf; inp.value = t; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
    place('250', 0.2); place('130', 0.35); place('70', 0.55);
    const placed = annotations.filter(a => a.type === 'text').map(a => a.blotPanel == null);
    applyPreset('elife');
    const typed = __row('MW markers');
    annotations.forEach(a => { if (a.type === 'text') a.text += ' kDa'; });
    const kda = __row('MW markers');
    annotations.forEach(a => { if (a.type === 'text') { a.blotPanel = images[0].id; a.mw = true; } });
    const ladder = __row('MW markers');
    return { typed, kda, ladder, placed };
  });
  expect(r.placed, JSON.stringify(r)).toEqual([true, true, true]);              // the Text tool tags nothing to the blot
  expect(r.typed.icon).toBe('✓');
  expect(r.typed.text).toMatch(/3 labelled markers/);
  expect(r.typed.text).toMatch(/typed beside the blot counts as MW labels/);   // the heuristic, stated
  expect(r.kda.icon).toBe('✓');
  expect(r.ladder.icon).toBe('✓');
  expect(errors).toEqual([]);
});

// ── F18 / F19 / F20: what the rule sheet says, and no more ────────────────────────
test('F18: an unverified journal never stops an export over AI content; it says so, marked unverified', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => {
    freeformElements.push({ id: 'ai1', type: 'aiicon', x: 0, y: 0, w: 10, h: 10, aiGenerated: true, aiModel: 'm' });
    const out = {};
    for (const j of ['science', 'cell', 'pnas']) {
      applyPreset(j); _aiPolicyAcked = false;
      const said = [], t0 = window.toast; window.toast = (m, ty) => { said.push(m); return t0(m, ty); };
      let ran = false; const ok = _aiPolicyGate(() => { ran = true; });
      window.toast = t0;
      out[j] = { proceeds: ok, modal: !!document.getElementById('info-modal-bg'), said: said.join(' | '), ai: __row('AI disclosure') };
      document.getElementById('info-modal-bg')?.remove();
    }
    out.policies = Object.keys(JOURNAL_AI_POLICIES).sort();
    return out;
  });
  for (const j of ['science', 'cell', 'pnas']) { expect(r[j].proceeds, j).toBe(true); expect(r[j].modal, j).toBe(false); expect(r[j].ai.icon, j).not.toBe('✗'); }
  expect([r.science.ai.icon, r.cell.ai.icon]).toEqual(['?', '?']);     // their policy rows are marked unverified
  expect(r.science.said).toMatch(/without editor permission.*unverified/);
  expect(r.cell.said).toMatch(/no AI in primary-data figures.*unverified/);
  expect(r.science.ai.text).not.toMatch(/full prompt|tool and its version/);
  expect(r.cell.ai.text).not.toMatch(/brightness, contrast or colour balance|Cover art/);
  expect(r.policies).toEqual(['asm', 'nature']);
  expect(errors).toEqual([]);
});

// Fails before: "✗ Printed width 210 mm" with "Set 200 mm" — eLife states only a minimum.
test('F19: eLife wider than a full page is a warning, not a failed rule', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => { applyPreset('elife'); const w = {};
    for (const mm of ['210', '183', '90']) { const sel = document.getElementById('export-width-mm');
      if (![...sel.options].some(o => o.value === mm)) { const o = document.createElement('option'); o.value = mm; o.textContent = mm; sel.appendChild(o); }
      sv('export-width-mm', mm); render(); w[mm] = __row('Printed width'); } return w; });
  expect(r['210'].icon).toBe('⚠');
  expect(r['210'].text).toMatch(/states a minimum width only/);
  expect(r['183'].icon).toBe('✓');
  expect(r['90'].icon).toBe('✗');                             // under the stated 10 cm minimum
  expect(errors).toEqual([]);
});

// Fails before: Science set 183.5 mm at 600 DPI and PNAS 180 mm — values no source gives,
// which their own rows then questioned.
test('F20: Science and PNAS presets use only widths and DPI their sources give, and their rows agree', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => { const out = {};
    for (const j of ['science', 'pnas', 'cell']) { applyPreset(j); render();
      out[j] = { w: gv('export-width-mm'), dpi: gv('export-dpi'), width: __row('Printed width').text,
        menu: [...document.getElementById('export-width-mm').options].filter(o => !o.hidden).map(o => o.value) }; }
    out.scienceDpi = (applyPreset('science'), __row('Export DPI').text); return out; });
  expect([r.science.w, r.science.dpi]).toEqual(['175', '300']);
  expect(r.pnas.w).toBe('178');
  for (const j of ['science', 'pnas', 'cell']) { expect(r[j].width, j).toMatch(/✓/); expect(r[j].menu, j).not.toContain('183.5'); expect(r[j].menu, j).not.toContain('180'); }
  expect(r.scienceDpi).toMatch(/300 DPI ✓/);
  expect(errors).toEqual([]);
});

// ── F21: a file from before format marks draws as it did ─────────────────────────
// Fails before: the switch came on for a file without the key, and "*p<0.05 vs WT*" lost
// its stars, "WT*KO*" became "WTKO", "C:\data\_raw" lost a backslash.
test('F21: a session saved before format marks opens with them off; new figures and new files keep them on', async ({ page }) => {
  const errors = await setup(page, 0);
  const old = require('fs').readFileSync(path.join(__dirname, 'fixtures', 'round3', 'session-before-format-marks.json'), 'utf8');
  expect(JSON.parse(old).style.formatMarks).toBeUndefined();
  const fresh = await page.evaluate(() => gc('format-marks'));
  await page.evaluate((s) => applySession(JSON.parse(s)), old);
  await page.waitForFunction(() => images.length === 3 && images.every(im => im && im.img && im.img.complete && im.img.naturalWidth > 0));
  const r = await page.evaluate((s) => {
    render();
    const after = { on: gc('format-marks'), title: figTextItems.find(t => t.kind === 'title'),
      labels: figTextItems.filter(t => t.kind === 'panel').map(t => ({ str: t.str, runs: !!t.runs })), cap: _captionText() };
    const saved = serializeSession(true); const keyNow = saved.style.formatMarks;
    _resetFigureState(); const afterNew = gc('format-marks');
    const withKey = JSON.parse(s); withKey.style.formatMarks = true; applySession(withKey); const onWithKey = gc('format-marks');
    // a style/layout file (no images list) is not a figure from before: the switch is left alone
    const styleOnly = JSON.parse(s); delete styleOnly.images; applySession(styleOnly); const onStyleOnly = gc('format-marks');
    return { onStyleOnly, fresh: null, after: { on: after.on, titleRuns: !!(after.title && after.title.runs), labels: after.labels, cap: after.cap }, keyNow, afterNew, onWithKey };
  }, old);
  expect(fresh).toBe(true);
  expect(r.after.on).toBe(false);
  expect(r.after.titleRuns).toBe(false);
  expect(r.after.labels.map(l => l.str)).toEqual(['*p<0.05 vs WT*', 'WT*KO*', 'C:\\data\\_raw **n.s.**']);
  expect(r.after.labels.every(l => !l.runs)).toBe(true);
  expect(r.after.cap).toContain('*p<0.05 vs WT*');
  expect(r.keyNow).toBe(false);                               // saved again, it keeps saying so
  expect(r.afterNew).toBe(true);
  expect(r.onWithKey).toBe(true);
  expect(r.onStyleOnly).toBe(true);
  expect(errors).toEqual([]);
});

// ── F22: charts lay out by the drawn text ─────────────────────────────────────────
// Fails before: "H_{2}O_{2}" categories were turned −40° though the drawn "H₂O₂" fits flat.
test('F22: chart category rotation and legend width count drawn characters, not marks', async ({ page }) => {
  const errors = await setup(page, 0);
  const r = await page.evaluate(() => {
    addChartElement('bar');
    const el = freeformElements[freeformElements.length - 1];
    const run = (cats) => { el.chart.data = { columns: ['Group', 'Value'], rows: cats.map((c, i) => [c, 3 + i]), source: 'demo', sourceName: '' };
      el.chart.mapping.xCol = 0; el.chart.mapping.yCols = [1]; el._chartKey = null; el._chartStat = null;
      const out = []; _chartDraw(el, _chartEmitSVG(out)); return out.filter(s => /<text/.test(s) && /rotate/.test(s)).length; };
    return { plain: run(['H2O2', 'ctrl', 'WT', 'H2O', 'KO', 'DKO']), marked: run(['H_{2}O_{2}', 'ctrl', 'WT', 'H_{2}O', 'KO', 'DKO']),
      longPlain: run(['Hydrogen peroxide', 'ctrl', 'WT', 'H2O', 'KO', 'DKO']) };
  });
  expect(r.longPlain).toBeGreaterThan(0);                     // the check can see rotation at all
  expect(r.plain).toBe(0);
  expect(r.marked).toBe(r.plain);
  expect(errors).toEqual([]);
});

// ── Deferred items: bar text font, freeform text sizes ────────────────────────────
// Fails before: scale-bar text was always "system-ui,sans-serif", so the Font row's
// "Arial ✓" was untrue of the bar text.
test('scale-bar and intensity-bar text follow the label font; with the default font they are drawn as before', async ({ page }) => {
  const errors = await setup(page, 1);
  const r = await page.evaluate(() => {
    images[0].sbOn = true; images[0].umPerPx = 0.5; images[0].sbUm = 10; images[0].cbar = true; images[0].lut = 'fire'; sc('sb-text', true); render();
    const def = figTextItems.filter(t => t.kind === 'sb' || t.kind === 'cbar').map(t => t.font);
    applyPreset('nature'); images[0].sbOn = true; images[0].umPerPx = 0.5; images[0].sbUm = 10; images[0].cbar = true; render();
    const nat = figTextItems.filter(t => t.kind === 'sb' || t.kind === 'cbar').map(t => t.font);
    return { def, nat, font: __row('Font') };
  });
  expect(r.def.length).toBeGreaterThanOrEqual(2);
  for (const f of r.def) expect(f).toMatch(/px system-ui,sans-serif$/);
  for (const f of r.nat) expect(f).toMatch(/px Arial,Helvetica,sans-serif$/);
  expect(r.font.icon).toBe('✓');
  expect(r.font.text).not.toMatch(/system sans-serif/);
  expect(errors).toEqual([]);
});
