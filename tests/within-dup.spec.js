// @ts-check
// The within-figure 🧬 Duplication check and the deep audit: the same pixels, not the same
// composition.
//
// The whole-panel scan, the region scan and the deep audit that repeats them used plain
// correlation, which measures layout: two DIFFERENT western blots of one lane layout were
// "97% similar" with decision buttons, lane against lane inside one blot was an "internal
// repeat", and two plaque plates, two dim fields behind one letterbox, two lattices and two
// counting grids all failed the audit. Every hit is now verified as a cross-figure
// candidate is (_xdConfirm, then _xdVerify); a hit that is only alike in layout is listed
// apart, neutral, with its reason and no decision to make.
//
// Measured before the change (same generators, same seeds; tests/dup-gen.js):
//   blots, one lane layout      11–13 failure rows per pair in the check, 7–8 in the audit
//   blots, clipped background    1 / 1 (whole panel, "95–97% similar")
//   plaque plates               13 / 8      dim letterboxed fields   4–8 / 4–8
//   EM lattices                 12–13 / 7–8 hemocytometer grids      12 / 7
// Every one of these tests fails on that code.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');
const { GEN, GEN_REAL } = require('./dup-gen');

// One figure of the given panels: what the check's dialog says (after its scale-tolerant
// pass finishes) and what the deep audit says.
const PROBE = `
window.__within = async function(list){
  images.length = 0;
  for (const [i, c] of list.entries()) await __commit(c, 'p' + i + '.png');
  render();
  runDuplicateScan();
  const m = [...document.querySelectorAll('.modal-bg.open')].pop();
  const sec = m.querySelector('[data-xd-scale]');
  for (let i = 0; i < 1200 && /Comparing panel pairs/.test(sec.textContent); i++) await new Promise(r => setTimeout(r, 50));
  const T = e => e.textContent.replace(/\\s+/g, ' ').trim();
  const out = {
    fails: [...m.querySelectorAll('.cc-fail')].map(T),
    buttons: m.querySelectorAll('[data-xd-act]').length,
    alike: [...m.querySelectorAll('[data-xd-alike]')].map(T),
    ticks: [...m.querySelectorAll('.cc-pass')].map(T),
    text: T(m) };
  m.remove();
  runAdvancedConsistency();
  const a = [...document.querySelectorAll('.modal-bg.open')].pop();
  out.auditFails = [...a.querySelectorAll('.cc-fail')].map(T);
  out.auditInfo = [...a.querySelectorAll('.cc-info')].map(T);
  out.auditHead = T(a.querySelector('.modal > div'));
  a.remove();
  out.decisions = Object.keys(_reuse.decisions).length;
  return out;
};`;
async function setup(page) {
  const errors = await loadApp(page);
  await page.addScriptTag({ content: GEN });
  await page.addScriptTag({ content: GEN_REAL });
  await page.addScriptTag({ content: PROBE });
  return errors;
}

// Different acquisitions that share a layout by design, as two panels of one figure.
const LAYOUT = {
  'blots, one lane layout': 's=>__wblot({seed:s})',
  'blots on a clipped white background': 's=>__wblot({seed:s,blotches:0,noise:2,bg:262})',
  'plaque plates': 's=>__plate(s,360,360)',
  'dim fields behind one letterbox, label and scale bar': 's=>__stamp(__cells(s,400,300,{amp:30,noise:2}),{letterbox:40,label:"WT"})',
  'EM lattices': 's=>__lattice(s,300,300)',
  'hemocytometer grids': 's=>__hemo(s,400,300)',
};
for (const [name, gen] of Object.entries(LAYOUT)) {
  test(`no false accusation: ${name} — nothing counted in the check or the deep audit, listed apart with its reason`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = await setup(page);
    const runs = await page.evaluate(async (gen) => {
      const fn = eval(gen), out = [];
      generateCaption(); writeMethodsParagraph();
      for (let i = 0; i < 3; i++) out.push(await __within([fn(201 + 2 * i), fn(202 + 2 * i)]));
      return { out, cap: gv('caption-out'), meth: gv('methods-out') };
    }, gen);
    for (const r of runs.out) {
      expect(r.fails, r.text).toEqual([]);                 // no ✗ row, in any section
      expect(r.buttons).toBe(0);                           // nothing to decide
      expect(r.alike.length).toBeGreaterThan(0);           // but named, not hidden
      // No green tick in a section that lists something alike (a section with nothing
      // alike may still say so with ✓), and none at all from the scale-tolerant pass.
      const al = r.alike.join(' ');
      for (const t of r.ticks) {
        expect(t).toMatch(/No duplicated panels found|No repeated regions found/);
        if (/No duplicated panels/.test(t)) expect(al).not.toMatch(/% alike at a glance/);
        if (/No repeated regions/.test(t)) expect(al).not.toMatch(/regions? (within the panel )?alike at a glance/);
      }
      for (const a of r.alike) expect(a).toMatch(/similar layout — not counted as reuse|periodic pattern — cannot be told apart/);
      expect(r.alike.join(' ')).toMatch(/fine detail differs|matches itself when shifted by one period|do not line up pixel for pixel/);
      expect(r.auditFails).toEqual([]);                    // the deep audit fails nothing
      expect(r.auditInfo.join(' ')).toMatch(/Alike at a glance only — not counted as reuse/);
      expect(r.decisions).toBe(0);
    }
    expect(runs.cap).not.toMatch(/reuse|reused/i);
    expect(runs.meth).not.toMatch(/reuse|reused/i);
    expect(errors).toEqual([]);
  });
}

test('a lattice pair is worded as a periodic pattern, as across figures', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => __within([__lattice(201, 300, 300), __lattice(202, 300, 300)]));
  expect(r.alike.join(' ')).toMatch(/periodic pattern — cannot be told apart by this check/);
  expect(errors).toEqual([]);
});

// True copies: two panels of one figure, the second a copy of the first. Each must still
// be a finding (✗, with decisions) naming both panels, in the check and in the audit.
const COPIES = {
  exact: 'P=>__crop(P,0,0,P.width,P.height)',
  mirrored: 'P=>__tf(P,4,1)',
  'flipped top-bottom': 'P=>__tf(P,6,1)',
  'rotated 90°': 'P=>__tf(P,1,1)',
  '0.6×': 'P=>__tf(P,0,0.6)',
  '1.7×': 'P=>__tf(P,0,1.7)',
  'overlapping crop': 'P=>__crop(P,150,0,P.width-150,P.height)',
  'gamma and a LUT': 'P=>__px(P,(r)=>{ const t=Math.pow(r/255,0.5); return [255*Math.min(1,t*3),255*Math.max(0,Math.min(1,t*3-1)),255*Math.max(0,t*3-2)]; })',
};
const SOURCES = { 'cell field': '__cells(41,500,380)', texture: '__mkTex(41,500,380)', 'western blot': '__wblot({seed:41})', 'plaque plate': '__plate(41,360,360)' };
// The one copy the deep audit does not see: a blot through a fire LUT is too uniform in
// perceptual luma for the whole-panel scan, so only the dialog's scale-tolerant pass (which
// the audit does not run) finds it. Before, the audit failed this figure only on lane-to-lane
// "internal repeats" of the original blot, which were false.
const AUDIT_LIMIT = { 'western blot': ['gamma and a LUT'] };
for (const [sn, sg] of Object.entries(SOURCES)) {
  test(`true copies of a ${sn} are still found: exact, flipped, rotated, 0.6× and 1.7×, an overlapping crop, a gamma/LUT copy`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = await setup(page);
    const got = await page.evaluate(async ([sg, C]) => {
      const P = eval(sg), out = {};
      for (const [k, g] of Object.entries(C)) out[k] = await __within([P, eval(g)(P)]);
      return out;
    }, [sg, COPIES]);
    for (const [k, r] of Object.entries(got)) {
      const ab = r.fails.filter(t => /\bA\b.*\bB\b/.test(t));       // a finding between the two panels
      expect(ab.length, `${sn}, ${k}: ${r.text}`).toBeGreaterThan(0);
      expect(r.buttons, `${sn}, ${k}`).toBeGreaterThan(0);
      if ((AUDIT_LIMIT[sn] || []).includes(k)) expect(r.auditFails, `${sn}, ${k} (stated limit)`).toEqual([]);
      else expect(r.auditFails.filter(t => /\bA\b.*\bB\b/.test(t)).length, `${sn}, ${k}: audit`).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test('a region cloned inside one panel is still an internal repeat; lane against lane of one blot is not', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const cloned = (P, s, x0, y0, x1, y1) => { const c = document.createElement('canvas'); c.width = P.width; c.height = P.height;
      const x = c.getContext('2d'); x.drawImage(P, 0, 0); x.drawImage(P, x0, y0, s, s, x1, y1, s, s); return c; };
    const a = await __within([cloned(__mkTex(51, 480, 400), 128, 40, 40, 300, 240)]);
    const b = await __within([cloned(__cells(51, 480, 400, { n: 200 }), 160, 40, 40, 280, 200)]);
    const blot = await __within([__wblot({ seed: 61 })]);
    return { clone: [a.fails, b.fails], cloneAudit: [a.auditFails, b.auditFails], blot: blot.fails, blotAudit: blot.auditFails, blotAlike: blot.alike };
  });
  for (const f of r.clone) expect(f.join(' ')).toMatch(/A contains an internal repeat .*the fine detail matches/);
  for (const f of r.cloneAudit) expect(f.join(' ')).toMatch(/A contains an internal repeated region/);
  expect(r.blot).toEqual([]);
  expect(r.blotAudit).toEqual([]);
  expect(r.blotAlike.join(' ')).toMatch(/A: \d+ regions? within the panel alike at a glance/);
  expect(errors).toEqual([]);
});

test('a patch pasted into another panel after a re-save (JPEG 50 and 20, blur σ 2, noise σ 10) is still found', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await setup(page);
  const got = await page.evaluate(async () => {
    const out = {};
    for (const [src, mk] of [['texture', s => __mkTex(s, 480, 400)], ['cells', s => __cells(s, 480, 400, { n: 200 })]]) {
      const S = mk(81), patch = __crop(S, 60, 60, 160, 160);
      const vars = { jpeg50: await __jpeg(patch, 0.5), jpeg20: await __jpeg(patch, 0.2), blur2: __blur(patch, 2),
        noise10: __px(patch, (a, b, c, R) => { const n = 10 * __gauss(R); return [a + n, b + n, c + n]; }) };
      for (const [k, p] of Object.entries(vars)) {
        const B = mk(82); B.getContext('2d').drawImage(p, 280, 200);
        const r = await __within([S, B]);
        out[src + ' ' + k] = { fails: r.fails.filter(t => /A region of A reappears in B/.test(t)).length, audit: r.auditFails.filter(t => /A region of A reappears in B/.test(t)).length };
      }
    }
    return out;
  });
  for (const [k, v] of Object.entries(got)) { expect(v.fails, k).toBeGreaterThan(0); expect(v.audit, k).toBeGreaterThan(0); }
  expect(errors).toEqual([]);
});

// The stated limit: inside ONE panel a repeat counts only when its fine detail agrees or is
// visibly lost on one side, because a panel's own symmetric structure (a dish rim against
// its mirror image, lane against lane) matches coarsely too. A patch re-saved as JPEG 20
// and pasted back into its own panel is listed as alike, not counted (JPEG 50 is found).
test('limit: a patch re-saved as JPEG 20 and pasted back into its own panel is listed as alike, not counted', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => { const out = {};
    for (const q of [0.5, 0.2]) { const S = __mkTex(81, 480, 400); S.getContext('2d').drawImage(await __jpeg(__crop(S, 40, 40, 160, 160), q), 280, 200);
      const w = await __within([S]); out[q] = { found: w.fails.filter(t => /internal repeat/.test(t)).length, alike: w.alike.length }; }
    return out; });
  expect(r['0.5'].found).toBeGreaterThan(0);
  expect(r['0.2']).toEqual({ found: 0, alike: 1 });
  expect(errors).toEqual([]);
});

test('"nearly identical" never asserts one field; hidden pairs are counted by verdict, apart', async ({ page }) => {
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    images.length = 0;
    await __commit(__timelapse(0), 'frame0.png');
    await __commit(__mkTex(71, 400, 300), 'tex.png'); render();
    openCrossFigureCheck();
    await _xdAddFiles([await __pngFile(__timelapse(2), 'next_frame.png'), await __pngFile(__crop(__mkTex(71, 400, 300), 0, 0, 400, 300), 'tex_copy.png')]);
    await _xdStart();
    const res = document.getElementById('xdup-results');
    const rows = [...res.querySelectorAll('.cc-fail')];
    const near = rows.find(x => /nearly identical/.test(x.textContent)), ident = rows.find(x => !/nearly identical/.test(x.textContent));
    const nearText = near.textContent.replace(/\s+/g, ' ');
    const identKey = ident.querySelector('[data-xd-key]').dataset.xdKey;
    near.querySelector('[data-xd-act="acquisition"]').click();
    // the results are drawn again after a decision: find the other row afresh
    document.querySelector(`#xdup-results [data-xd-key="${CSS.escape(identKey)}"] [data-xd-act="different"]`).click();
    const after = document.getElementById('xdup-results').textContent.replace(/\s+/g, ' ');
    closeCrossFigureCheck();
    return { nearText, after, cls: _XD_CLASS.near };
  });
  expect(r.cls).not.toMatch(/same field/);
  expect(r.nearText).toMatch(/nearly identical — alike in coarse detail; finest detail differs/);
  expect(r.nearText).not.toMatch(/same field/);
  expect(r.after).toMatch(/1 pair you marked “different images” is not listed; 1 pair you marked “same field, different acquisitions” is not listed/);
  expect(errors).toEqual([]);
});

test('runtime: a 12-panel figure (blots, cell fields, plates, one mirrored copy)', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await setup(page);
  const r = await page.evaluate(async () => {
    const L = []; for (let i = 0; i < 12; i++) L.push(i % 3 === 0 ? __wblot({ seed: 600 + i, w: 600, h: 260 }) : i % 3 === 1 ? __cells(600 + i, 600, 450) : __plate(600 + i, 450, 450));
    L[11] = __tf(L[4], 4, 1);
    const t0 = performance.now();
    const out = await __within(L);
    return { ms: Math.round(performance.now() - t0), fails: out.fails, auditFails: out.auditFails,
      log: reproLog.filter(e => e.action === 'duplicateScan').pop() };
  });
  console.log(`[within-dup] 12 panels: check + audit ${r.ms} ms; verification ${r.log.verifyMs} ms; ${r.log.candidates} candidates, ${r.log.alike} alike`);
  // the one copy (E and its mirror L), and nothing else
  expect(r.fails.length).toBeGreaterThan(0);
  for (const t of r.fails) expect(t).toMatch(/\bE\b.*\bL\b/);
  for (const t of r.auditFails) expect(t).toMatch(/\bE\b.*\bL\b/);
  expect(r.ms).toBeLessThan(60000);
  expect(errors).toEqual([]);
});
