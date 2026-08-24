// @ts-check
// NIH BioArt Source — the imported pack, the catalogue for what did not fit, and the
// provenance FigureLab reads out of a downloaded file.
//
// Three things here are guards on failures that are silent rather than loud:
//   · a namespace-prefixed SVG that parses fine and draws nothing (see the ns0: test);
//   · a size regression that quietly doubles the shipped file;
//   · a courtesy credit line presented as an obligation, which is the one mistake the
//     Credits panel exists to prevent.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./helpers');

const APP = path.join(__dirname, '..', 'figure_lab.html');
const FIX_SVG = path.join(__dirname, 'fixtures', 'bioart-microbiota.svg');
const FIX_PNG = path.join(__dirname, 'fixtures', 'bioart-microbiota.png');

/** Drop a file through the app's real ingest path (addFiles), as a user would. */
async function dropFile(page, filePath, mime) {
  const bytes = fs.readFileSync(filePath);
  await page.evaluate(async ({ b64, name, mime }) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const f = new File([arr], name, { type: mime });
    addFiles([f]);
    // The ingest path is async through FileReader and image decode; wait for it to land.
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 50));
      const n = (typeof freeformElements !== 'undefined' ? freeformElements.length : 0)
              + (typeof images !== 'undefined' ? images.filter(Boolean).length : 0);
      if (n) return;
    }
  }, { b64: bytes.toString('base64'), name: path.basename(filePath), mime });
}

test('every BioArt entry is Public Domain, full-colour, and points back at its source', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const bad = [];
    const keys = Object.keys(SCIENCE_ICONS).filter(k => k.startsWith('ba_'));
    for (const k of keys) {
      const ic = SCIENCE_ICONS[k], L = _iconLic(ic);
      if (!ICON_LICENSES_ALLOWED.includes(L.spdx)) bad.push(`${k}: ${L.spdx} not allowed`);
      if (/-SA-|GPL|-NC-/.test(L.spdx)) bad.push(`${k}: ${L.spdx} is share-alike or restricted`);
      if (!L.src || !/bioart\.niaid\.nih\.gov/.test(L.src)) bad.push(`${k}: no BioArt source URL`);
      if (!L.author) bad.push(`${k}: no author`);
      // NIAID's courtesy line is what the Credits panel offers; without it the asset
      // would be creditable in principle and uncreditable in practice.
      if (!L.credit) bad.push(`${k}: no credit line`);
      // Full-colour illustration: forcing the recolour sentinel would flatten it.
      if (ic.mono !== false) bad.push(`${k}: not marked mono:false`);
      if (ICON_LICENSES_ATTRIB.includes(L.spdx) && !(L.author && L.src)) {
        bad.push(`${k}: ${L.spdx} without author/src`);
      }
    }
    return { bad, count: keys.length };
  });
  expect(r.bad).toEqual([]);
  expect(r.count).toBeGreaterThanOrEqual(300);
  expect(errors).toEqual([]);
});

test('BioArt SVGs survive the namespace rewrite and draw something', async ({ page }) => {
  const errors = await loadApp(page);
  // BioArt serialises its documents as <ns0:svg xmlns:ns0="…/2000/svg">. The importer has to
  // unprefix that rather than strip it: a stripped root leaves a string that still looks
  // like an SVG, still loads without error, and renders as nothing at all. Rasterising is
  // the only assertion that can tell the difference.
  const r = await page.evaluate(async () => {
    const keys = Object.keys(SCIENCE_ICONS).filter(k => k.startsWith('ba_'));
    const step = Math.max(1, Math.floor(keys.length / 20));
    const sample = keys.filter((_, i) => i % step === 0).slice(0, 20);
    const blank = [], noRoot = [];
    for (const k of sample) {
      const svg = SCIENCE_ICONS[k].svg;
      if (!/^<svg[\s>]/.test(svg) || /<\/?[a-zA-Z][\w-]*:/.test(svg)) { noRoot.push(k); continue; }
      const ok = await new Promise(res => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 64; c.height = 64;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0, 64, 64);
          const d = x.getImageData(0, 0, 64, 64).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return res(true);
          res(false);
        };
        img.onerror = () => res(false);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      if (!ok) blank.push(k);
    }
    return { blank, noRoot, sampled: sample.length };
  });
  expect(r.noRoot).toEqual([]);
  expect(r.blank).toEqual([]);
  expect(r.sampled).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('no BioArt key collides with an existing icon', async ({ page }) => {
  const errors = await loadApp(page);
  // A duplicate key in an object literal is legal JavaScript — the later one silently wins
  // and the earlier icon disappears with no error. There are now three sources of keys, so
  // this reads the source rather than the live object, which cannot see the loss.
  const src = fs.readFileSync(APP, 'utf8');
  const literal = src.match(/const SCIENCE_ICONS=\{[\s\S]*?\n\};/)[0];
  const packs = [...src.matchAll(/Object\.assign\(SCIENCE_ICONS,\s*\{[\s\S]*?\n\}\);/g)].map(m => m[0]);
  const keys = [literal, ...packs]
    .flatMap(b => [...b.matchAll(/^ {2}([A-Za-z0-9_]+):\{label:/gm)].map(m => m[1]));
  const seen = new Set(), dup = [];
  for (const k of keys) { if (seen.has(k)) dup.push(k); seen.add(k); }
  expect(dup).toEqual([]);
  const live = await page.evaluate(() => Object.keys(SCIENCE_ICONS).length);
  expect(live).toBe(keys.length);
  expect(errors).toEqual([]);
});

test('a placed BioArt illustration keeps its colour and declines recolouring', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const k = Object.keys(SCIENCE_ICONS).find(n => n.startsWith('ba_'));
    insertIcon(k);
    await new Promise(r => setTimeout(r, 600));
    const el = freeformElements[freeformElements.length - 1];
    const before = el.svgSource;
    recolorIcon('#ff0000');
    await new Promise(r => setTimeout(r, 200));
    return { key: k, mono: el.iconMono, isVector: el.isVector, isIcon: el.isIcon,
             spdx: el.iconLic && el.iconLic.spdx, credit: el.iconLic && el.iconLic.credit,
             unchanged: el.svgSource === before, hasSrc0: !!el.iconSrc0 };
  });
  expect(r.mono).toBe(false);
  expect(r.isVector).toBe(true);
  expect(r.spdx).toBe('public-domain');
  expect(r.credit).toMatch(/NIAID/i);
  expect(r.unchanged).toBe(true);      // recolour must refuse, not flatten the artwork
  expect(r.hasSrc0).toBe(false);       // no pristine recolour source is kept for illustrations
  expect(errors).toEqual([]);
});

test('the palette finds BioArt subjects and lists what only the catalogue has', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    const out = {};
    for (const q of ['macrophage', 'antibody', 'plate']) {
      out[q] = Object.keys(SCIENCE_ICONS).filter(k => _iconMatch(SCIENCE_ICONS[k], q) > 0).length;
    }
    // The catalogue is names only — assets BioArt has that are too large to carry.
    const idx = typeof BIOART_INDEX !== 'undefined' ? BIOART_INDEX : [];
    return { out, idxLen: idx.length,
             idxShape: idx.slice(0, 3).map(e => Object.keys(e).sort().join(',')),
             idxNoArt: idx.every(e => !('svg' in e)) };
  });
  for (const q of Object.keys(r.out)) expect(r.out[q]).toBeGreaterThan(0);
  expect(r.idxLen).toBeGreaterThan(100);
  expect(r.idxNoArt).toBe(true);
  for (const s of r.idxShape) expect(s).toBe('cat,id,keys,label');
  expect(errors).toEqual([]);
});

test('a catalogue-only match renders as a link-out chip, after the placeable icons', async ({ page }) => {
  const errors = await loadApp(page);
  const term = await page.evaluate(() => {
    // A term that exists in the catalogue: take one straight from it.
    const e = BIOART_INDEX[0];
    return e.label.split(/\s+/).filter(w => w.length > 4)[0] || e.label;
  });
  await page.evaluate(() => document.querySelectorAll('.sidebar > details').forEach(d => { d.open = true; }));
  await page.fill('#icon-search', term);
  await page.waitForTimeout(400);          // the input is debounced
  const r = await page.evaluate(() => {
    const pal = document.getElementById('icon-palette');
    const kids = [...pal.children];
    const chips = kids.filter(n => n.classList.contains('icon-cat-chip'));
    const icons = kids.filter(n => n.classList.contains('icon-btn-sci'));
    const lastIcon = icons.length ? kids.indexOf(icons[icons.length - 1]) : -1;
    const firstChip = chips.length ? kids.indexOf(chips[0]) : Infinity;
    return { chips: chips.length, ordered: firstChip > lastIcon,
             note: !!pal.querySelector('.icon-cat-note') };
  });
  expect(r.chips).toBeGreaterThan(0);
  expect(r.ordered).toBe(true);            // what you can place now comes first
  expect(r.note).toBe(true);
  expect(errors).toEqual([]);
});

test('the palette renders a large result set without hanging', async ({ page }) => {
  const errors = await loadApp(page);
  // Browsing matches the whole library. Painting a full-colour illustration into every
  // button up front is what this guards against — the buttons are filled lazily as they
  // scroll into view, so the render stays cheap however large the library gets.
  const r = await page.evaluate(() => {
    const t0 = performance.now();
    renderIconPalette('');
    const ms = performance.now() - t0;
    const pal = document.getElementById('icon-palette');
    const btns = [...pal.querySelectorAll('.icon-btn-sci')];
    return { ms, btns: btns.length, painted: btns.filter(b => b.firstChild).length };
  });
  expect(r.btns).toBeGreaterThan(400);
  expect(r.ms).toBeLessThan(2000);
  // Only what is on screen should have artwork in it.
  expect(r.painted).toBeLessThan(r.btns);
  expect(errors).toEqual([]);
});

test('a dropped BioArt SVG arrives credited, as true vector', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => setLayoutMode('freeform'));
  await dropFile(page, FIX_SVG, 'image/svg+xml');
  const r = await page.evaluate(() => {
    const el = freeformElements[freeformElements.length - 1];
    return { label: el && el.iconLabel, spdx: el && el.iconLic && el.iconLic.spdx,
             author: el && el.iconLic && el.iconLic.author,
             credit: el && el.iconLic && el.iconLic.credit,
             mono: el && el.iconMono, vector: el && el.isVector };
  });
  expect(r.label).toBe('Microbiota');
  expect(r.spdx).toBe('public-domain');
  expect(r.author).toBe('Ryan Kissinger');
  expect(r.credit).toMatch(/NIAID/i);
  expect(r.mono).toBe(false);
  expect(r.vector).toBe(true);
  expect(errors).toEqual([]);
});

test('a dropped BioArt PNG is recognised from its tEXt chunks', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => setLayoutMode('freeform'));
  await dropFile(page, FIX_PNG, 'image/png');
  const r = await page.evaluate(() => {
    const el = freeformElements[freeformElements.length - 1];
    return { label: el && el.iconLabel, spdx: el && el.iconLic && el.iconLic.spdx,
             author: el && el.iconLic && el.iconLic.author, vector: el && el.isVector };
  });
  expect(r.label).toBe('Microbiota');
  expect(r.spdx).toBe('public-domain');
  expect(r.author).toBe('Ryan Kissinger');
  expect(r.vector).toBeFalsy();            // a PNG is a PNG; only the provenance is read
  expect(errors).toEqual([]);
});

test('an ordinary SVG is left alone', async ({ page }) => {
  const errors = await loadApp(page);
  // The recognition guard is the whole safety of this feature: a plain SVG that happens to
  // carry a <title> must never be stamped with someone else's licence.
  const r = await page.evaluate(() => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
                + '<metadata><title>My Diagram</title><license>Public Domain</license></metadata>'
                + '<rect width="10" height="10"/></svg>';
    const notPd = '<svg xmlns="http://www.w3.org/2000/svg"><metadata><title>X</title>'
                + '<license>All rights reserved</license><credit>Courtesy of NIAID</credit>'
                + '</metadata><rect width="1" height="1"/></svg>';
    return { noCredit: _bioartMetaFromSVGText(plain),
             notPublicDomain: _bioartMetaFromSVGText(notPd),
             empty: _bioartMetaFromSVGText('<svg/>'),
             notAPng: _bioartMetaFromPNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer) };
  });
  expect(r.noCredit).toBeNull();
  expect(r.notPublicDomain).toBeNull();
  expect(r.empty).toBeNull();
  expect(r.notAPng).toBeNull();
  expect(errors).toEqual([]);
});

test('Public Domain is offered as a courtesy, never reported as required', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => setLayoutMode('freeform'));
  await dropFile(page, FIX_SVG, 'image/svg+xml');
  const r = await page.evaluate(() => {
    const c = _collectCredits();
    return { required: _creditsText(), courtesy: _courtesyText(),
             groups: c.groups.length, free: c.freeCount };
  });
  expect(r.required).toBe('');             // nothing is owed for Public Domain artwork
  expect(r.groups).toBe(0);
  expect(r.courtesy).toMatch(/Microbiota/);
  expect(r.courtesy).toMatch(/Courtesy of NIAID/);
  expect(r.free).toBeGreaterThan(0);

  await page.evaluate(() => showCredits());
  const body = await page.locator('#im-body').innerText();
  expect(body).toMatch(/Not required, but customary/i);
  expect(body).not.toMatch(/Paste this into your figure legend/i);
  expect(errors).toEqual([]);
});

test('a BioArt panel dropped in grid mode is still credited', async ({ page }) => {
  const errors = await loadApp(page);
  // _collectCredits used to walk only freeformElements. A figure that mixes a grid of panels
  // with placed icons would then under-report, which is worse than not reporting at all.
  await dropFile(page, FIX_SVG, 'image/svg+xml');
  const r = await page.evaluate(() => ({
    mode: layoutMode,
    panels: images.filter(Boolean).length,
    panelLic: (images.filter(Boolean)[0] || {}).iconLic,
    courtesy: _courtesyText(),
  }));
  expect(r.mode).toBe('grid');
  expect(r.panels).toBe(1);
  expect(r.panelLic && r.panelLic.spdx).toBe('public-domain');
  expect(r.courtesy).toMatch(/Courtesy of NIAID/);
  expect(errors).toEqual([]);
});

test('a placed BioArt illustration exports as true vector, not a raster blit', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    const sel = document.getElementById('layout-mode'); if (sel) sel.value = 'freeform';
    setLayoutMode('freeform'); freeformElements.length = 0; selectedElems.clear();
    const k = Object.keys(SCIENCE_ICONS).find(n => n.startsWith('ba_'));
    insertIcon(k);
    await new Promise(r => setTimeout(r, 800));
    selectedElems.clear(); render();
    const cap = await _captureDownload(() => exportSVG('t', 150, document.getElementById('fig-canvas')));
    const svg = new TextDecoder().decode(cap.data);
    // The element is re-emitted as its own SVG document in a data URI, which is also why the
    // pack's generic .cls-N class names and clippath ids cannot collide between assets.
    const vec = [...svg.matchAll(/xlink:href="data:image\/svg\+xml[^"]*"/g)];
    return { key: k, vectorImages: vec.length, bytes: svg.length };
  });
  expect(r.vectorImages).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the shipped file stays within its size ceiling', async ({ page }) => {
  // The BioArt import took figure_lab.html from 1.2 MB to ~5.2 MB, which was a deliberate,
  // measured decision. This is the guard that a future import cannot repeat it by accident:
  // if a pack pushes past the ceiling, that is a conversation, not a commit.
  const bytes = fs.statSync(APP).size;
  expect(bytes).toBeLessThan(7 * 1024 * 1024);
  const errors = await loadApp(page);
  expect(errors).toEqual([]);
});
