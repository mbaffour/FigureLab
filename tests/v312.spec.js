// @ts-check
// Icon licensing and the credits block.
//
// An icon library is only "free to use" if the obligations travel with the artwork.
// The first test here is a data-integrity guard on the library itself: it will fail if
// anyone ever adds an icon under a licence the app can't honour — which is the failure
// that would otherwise reach a user as a legal problem rather than a bug.
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform } = require('./helpers');

test('every icon declares a licence the app can honour, and none is share-alike', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const bad = [], names = Object.keys(SCIENCE_ICONS);
    for (const n of names) {
      const spdx = _iconLic(SCIENCE_ICONS[n]).spdx;
      if (!ICON_LICENSES_ALLOWED.includes(spdx)) bad.push(`${n}: ${spdx}`);
      // CC-BY without an author cannot be attributed, so it must not exist here
      if (ICON_LICENSES_ATTRIB.includes(spdx)) {
        const L = _iconLic(SCIENCE_ICONS[n]);
        if (!L.author || !L.src) bad.push(`${n}: ${spdx} without author/src`);
      }
    }
    return { bad, count: names.length,
      shareAlike: ICON_LICENSES_ALLOWED.filter(l => /-SA-/.test(l)) };
  });
  expect(r.bad).toEqual([]);
  expect(r.shareAlike).toEqual([]);      // CC-BY-SA is excluded by design
  expect(r.count).toBeGreaterThanOrEqual(85);
  expect(errors).toEqual([]);
});

test('no icon key is defined twice', async ({ page }) => {
  const errors = await loadApp(page);
  // A duplicate key in an object literal is legal JavaScript: the later one silently
  // wins and the earlier icon vanishes with no error anywhere. Object.keys can't see
  // it, so this reads the source. (It caught a real collision when the library grew.)
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'figure_lab.html'), 'utf8');
  // Icons come from two places now: the hand-written literal and any generated
  // Object.assign pack blocks. A key colliding ACROSS those is the live risk — the pack
  // is appended, so it would silently overwrite a built-in.
  const literal = src.match(/const SCIENCE_ICONS=\{[\s\S]*?\n\};/)[0];
  const packs = [...src.matchAll(/Object\.assign\(SCIENCE_ICONS,\s*\{[\s\S]*?\n\}\);/g)].map(m => m[0]);
  const keys = [literal, ...packs]
    .flatMap(b => [...b.matchAll(/^ {2}([A-Za-z0-9_]+):\{label:/gm)].map(m => m[1]));
  const seen = new Set(), dup = [];
  for (const k of keys) { if (seen.has(k)) dup.push(k); seen.add(k); }
  expect(dup).toEqual([]);
  const live = await page.evaluate(() => Object.keys(SCIENCE_ICONS).length);
  expect(live).toBe(keys.length);        // nothing lost between source and runtime
  expect(errors).toEqual([]);
});

test('the library covers the groups the icon survey found missing', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const byGroup = {};
    for (const n of Object.keys(SCIENCE_ICONS)) {
      const g = SCIENCE_ICONS[n].group; byGroup[g] = (byGroup[g] || 0) + 1;
    }
    return { byGroup, groupsDeclared: Object.keys(ICON_GROUPS),
      // the phage/plaque work this tool is actually used for
      hasPhage: !!SCIENCE_ICONS.phage, hasPlaque: !!SCIENCE_ICONS.plaque };
  });
  // Whole-organism and clinical figures were the documented gap in free icon sets
  expect(r.byGroup.anatomy).toBeGreaterThanOrEqual(8);
  expect(r.byGroup.workflow).toBeGreaterThanOrEqual(6);
  expect(r.groupsDeclared).toContain('anatomy');
  expect(r.groupsDeclared).toContain('workflow');
  expect(r.hasPhage).toBe(true);
  expect(r.hasPlaque).toBe(true);
  expect(errors).toEqual([]);
});

test('every icon renders to a real bitmap', async ({ page }) => {
  const errors = await loadApp(page);
  // Malformed SVG rasterises to a blank or fails to load — either way the icon is
  // useless, and a typo in a path is invisible until someone places it.
  const bad = await page.evaluate(async () => {
    const fails = [];
    for (const n of Object.keys(SCIENCE_ICONS)) {
      const svg = SCIENCE_ICONS[n].svg;
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const ok = await new Promise(res => {
        const im = new Image();
        im.onload = () => res(im.naturalWidth > 0 && im.naturalHeight > 0);
        im.onerror = () => res(false);
        im.src = url;
      });
      if (!ok) fails.push(n);
    }
    return fails;
  });
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test('imported pack icons are CC0/MIT only, and carry no attribution burden', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const pack = Object.entries(SCIENCE_ICONS).filter(([k]) => k.startsWith('bi_'));
    const spdx = new Set(pack.map(([, ic]) => _iconLic(ic).spdx));
    return { n: pack.length, spdx: [...spdx].sort(),
      // The whole point of picking these two licences: nothing is owed.
      owed: pack.filter(([, ic]) => ICON_LICENSES_ATTRIB.includes(_iconLic(ic).spdx)).length,
      allSourced: pack.every(([, ic]) => _iconLic(ic).src),
      // Software logos are a trademark question a CC0 file does not answer.
      logos: pack.filter(([k]) => /keras|julia|python|colab|tensorflow|docker|github/i.test(k)).map(([k]) => k) };
  });
  expect(r.n).toBeGreaterThanOrEqual(70);
  expect(r.spdx).toEqual(['CC0-1.0', 'MIT']);
  expect(r.owed).toBe(0);
  expect(r.allSourced).toBe(true);
  expect(r.logos).toEqual([]);
  expect(errors).toEqual([]);
});

test('colour illustrations are placed as drawn and refuse recolouring', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    // A full-colour illustration has no single colour to swap; forcing one would
    // flatten the artwork to a silhouette, so the control hides and the call declines.
    const colourIcon = Object.keys(SCIENCE_ICONS).find(k => SCIENCE_ICONS[k].mono === false);
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    insertIcon(colourIcon);
    await new Promise(r => setTimeout(r, 500));
    const el = freeformElements[0];
    selectedElems.clear(); selectedElems.add(0);
    updateElemPropsBar();
    const colourUIShown = document.getElementById('ep-icon-props').style.display !== 'none';
    const before = el.src;
    recolorIcon('#ff0000');
    await new Promise(r => setTimeout(r, 200));
    return { name: colourIcon, mono: el.iconMono, hasSrc0: !!el.iconSrc0,
             colourUIShown, unchanged: freeformElements[0].src === before };
  });
  expect(r.mono).toBe(false);
  expect(r.hasSrc0).toBe(false);      // no pristine recolour source is kept
  expect(r.colourUIShown).toBe(false);// the control isn't offered
  expect(r.unchanged).toBe(true);     // and calling it anyway is a no-op
  expect(errors).toEqual([]);
});

test('FigureLab’s own line-art icons still recolour', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    insertIcon('heart');
    await new Promise(r => setTimeout(r, 500));
    selectedElems.clear(); selectedElems.add(0);
    updateElemPropsBar();
    const shown = document.getElementById('ep-icon-props').style.display !== 'none';
    recolorIcon('#ff0000');
    await new Promise(r => setTimeout(r, 300));
    const el = freeformElements[0];
    return { shown, colour: el.iconColor, inSvg: el.svgSource.includes('#ff0000') };
  });
  expect(r.shown).toBe(true);
  expect(r.colour).toBe('#ff0000');
  expect(r.inSvg).toBe(true);
  expect(errors).toEqual([]);
});

test('a placed icon carries its licence record into the session', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    insertIcon('phage');
    await new Promise(r => setTimeout(r, 400));
    const el = freeformElements[0];
    const s = serializeSession(true);
    const j = (typeof s === 'string') ? JSON.parse(s) : s;
    return { onElement: el && { name: el.iconName, lic: el.iconLic, label: el.iconLabel },
             inSession: j.freeformElements[0] && j.freeformElements[0].iconLic };
  });
  expect(r.onElement.name).toBe('phage');
  expect(r.onElement.lic).toEqual({ spdx: 'original' });
  expect(r.inSession).toEqual({ spdx: 'original' });   // survives save/load
  expect(errors).toEqual([]);
});

test('FigureLab’s own icons need no attribution, and the panel says so', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    insertIcon('heart');
    await new Promise(r => setTimeout(r, 400));
    showCredits();
    const m = document.getElementById('info-modal-bg');
    const t = m ? m.textContent : '';
    if (m) m.remove();
    return { text: t, creditsText: _creditsText() };
  });
  expect(r.creditsText).toBe('');                       // nothing owed
  expect(r.text).toMatch(/Nothing in this figure requires attribution/);
  expect(r.text).toMatch(/no publication licence, no watermark, no per-figure fee/i);
  expect(errors).toEqual([]);
});

test('a CC-BY icon produces a paste-ready credit line, grouped by author', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    // Stand in for an imported pack entry — the shape build-icons.mjs emits
    const lic = { spdx: 'CC-BY-4.0', author: 'A. Illustrator', src: 'https://bioicons.com/x' };
    freeformElements.push(
      { id: _uidElem(), type: 'image', isIcon: true, iconName: 'mito2', iconLabel: 'Mitochondrion',
        iconLic: lic, x: 0, y: 0, w: 40, h: 40, zIndex: 1, rotation: 0, locked: false, opacity: 1 },
      { id: _uidElem(), type: 'image', isIcon: true, iconName: 'golgi2', iconLabel: 'Golgi',
        iconLic: lic, x: 50, y: 0, w: 40, h: 40, zIndex: 2, rotation: 0, locked: false, opacity: 1 },
      { id: _uidElem(), type: 'image', isIcon: true, iconName: 'own', iconLabel: 'Heart',
        iconLic: { spdx: 'original' }, x: 100, y: 0, w: 40, h: 40, zIndex: 3, rotation: 0, locked: false, opacity: 1 });
    const txt = _creditsText();
    appendCreditsToNotes();
    return { txt, notes: document.getElementById('fig-notes').value,
             groups: _collectCredits().groups.length, free: _collectCredits().freeCount };
  });
  // One line for the author, both icons named — not one line per icon
  expect(r.groups).toBe(1);
  expect(r.txt).toBe('Golgi, Mitochondrion: © A. Illustrator, CC-BY-4.0 (https://bioicons.com/x)');
  expect(r.free).toBe(1);                                // the original one needs nothing
  expect(r.notes).toMatch(/^Credits:\n/m);
  expect(errors).toEqual([]);
});

test('placing a real Servier icon generates the real Servier credit line', async ({ page }) => {
  const errors = await loadApp(page);
  // End-to-end over the shipped CC-BY pack: place one, and the obligation it carries
  // must come out of the Credits panel as a line pointing at Servier's own site —
  // that is the condition under which importing attribution-required art was OK at all.
  const r = await page.evaluate(async () => {
    const servier = Object.keys(SCIENCE_ICONS).find(k =>
      k.startsWith('by_') && SCIENCE_ICONS[k].lic?.author === 'Servier Medical Art');
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    insertIcon(servier);
    await new Promise(r => setTimeout(r, 500));
    return { icon: servier, credits: _creditsText(),
             groups: _collectCredits().groups.length };
  });
  expect(r.icon).toBeTruthy();
  expect(r.groups).toBe(1);
  expect(r.credits).toMatch(/© Servier Medical Art, CC-BY-3\.0 \(https:\/\/smart\.servier\.com\/\)/);
  expect(errors).toEqual([]);
});

test('AI-generated content appears in the credits too', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    freeformElements.push({ id: _uidElem(), type: 'aiicon', aiGenerated: true,
      aiModel: 'gemini-3.1-flash-image', x: 0, y: 0, w: 10, h: 10, zIndex: 1,
      rotation: 0, locked: false, opacity: 1 });
    return _creditsText();
  });
  expect(r).toMatch(/generated with Google Gemini \(gemini-3\.1-flash-image\)/);
  expect(errors).toEqual([]);
});

test('CREDITS.txt lands in the submission package only when something is owed', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [{ type: 'rect', x: 0, y: 0, w: 40, h: 40 }]);
  const r = await page.evaluate(async () => {
    // Intercept the zip writer to read the file list without unzipping
    const names = [];
    const realZip = window._zipMake || window.zipMake;
    const grab = (files) => { files.forEach(f => names.push(f.name)); return new Uint8Array([1]); };
    if (window._zipMake) window._zipMake = grab; else window.zipMake = grab;
    window.dl = () => {};
    await exportSubmissionPackage();
    await new Promise(r => setTimeout(r, 600));
    const withoutCredits = names.slice();
    names.length = 0;
    freeformElements.push({ id: _uidElem(), type: 'image', isIcon: true, iconLabel: 'Cell',
      iconLic: { spdx: 'CC-BY-4.0', author: 'A. Person', src: 'https://x' },
      x: 0, y: 0, w: 10, h: 10, zIndex: 9, rotation: 0, locked: false, opacity: 1 });
    await exportSubmissionPackage();
    await new Promise(r => setTimeout(r, 600));
    if (window._zipMake) window._zipMake = realZip; else window.zipMake = realZip;
    return { withoutCredits, withCredits: names };
  });
  expect(r.withoutCredits).not.toContain('CREDITS.txt');
  expect(r.withCredits).toContain('CREDITS.txt');
  expect(errors).toEqual([]);
});
