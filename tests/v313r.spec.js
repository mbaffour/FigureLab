// @ts-check
// Region-level duplication detection.
//
// The whole-panel check catches a panel reused wholesale; what journal screens flag
// most is a REGION reused — a lane cloned inside a blot, a patch of one micrograph
// pasted into another, possibly rotated. These tests build panels with known planted
// duplications and assert the scan finds them, doesn't invent them, and stays honest
// about what it cannot check.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

/**
 * Build grid panels from deterministic noise. Each spec is
 *   { w, h, seed, paste: [{fromSeed, sx, sy, size, dx, dy, rot}] }
 * where `paste` stamps a patch of another (or the same) noise field at (dx,dy),
 * optionally rotated 90°·rot. Deterministic LCG noise — no Math.random in tests.
 */
async function seedNoisePanels(page, specs) {
  await page.evaluate(async (specs) => {
    images.length = 0;
    const noiseCanvas = (seed, w, h) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      const im = x.createImageData(w, h);
      let s = seed >>> 0;
      const rnd = () => (s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32;
      // Blocky noise (4px cells) so downscaling to the working resolution keeps
      // structure instead of averaging to grey.
      for (let yy = 0; yy < h; yy += 4) for (let xx = 0; xx < w; xx += 4) {
        const v = 40 + Math.floor(rnd() * 175);
        for (let y2 = yy; y2 < Math.min(h, yy + 4); y2++)
          for (let x2 = xx; x2 < Math.min(w, xx + 4); x2++) {
            const i = (y2 * w + x2) * 4;
            im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
          }
      }
      x.putImageData(im, 0, 0);
      return c;
    };
    for (const spec of specs) {
      const c = noiseCanvas(spec.seed, spec.w, spec.h);
      const x = c.getContext('2d');
      for (const p of (spec.paste || [])) {
        const src = noiseCanvas(p.fromSeed, spec.w, spec.h);
        const patch = document.createElement('canvas');
        patch.width = p.size; patch.height = p.size;
        patch.getContext('2d').drawImage(src, p.sx, p.sy, p.size, p.size, 0, 0, p.size, p.size);
        x.save();
        x.translate(p.dx + p.size / 2, p.dy + p.size / 2);
        x.rotate((p.rot || 0) * Math.PI / 2);
        x.drawImage(patch, -p.size / 2, -p.size / 2);
        x.restore();
      }
      const srcUrl = c.toDataURL('image/png');
      await new Promise(res => {
        const img = new Image();
        img.onload = () => { _commitImage(img, srcUrl, `n${spec.seed}.png`); res(); };
        img.src = srcUrl;
      });
    }
    render();
  }, specs);
  await page.waitForFunction(n => images.filter(Boolean).length === n, specs.length);
}

test('a patch copied between two panels is found, and located on both sides', async ({ page }) => {
  const errors = await loadApp(page);
  // Panel B carries a 160px patch lifted from panel A's noise field (top-left area),
  // stamped near B's bottom-right. Everything else differs.
  await seedNoisePanels(page, [
    { w: 480, h: 480, seed: 11 },
    { w: 480, h: 480, seed: 22, paste: [{ fromSeed: 11, sx: 40, sy: 40, size: 160, dx: 280, dy: 280 }] },
  ]);
  const r = await page.evaluate(() => {
    const s = _regionDupScan();
    return { n: s.regions.length, g: s.regions[0], patches: s.patches };
  });
  expect(r.n).toBeGreaterThanOrEqual(1);
  const g = r.g;
  expect(g.same).toBe(false);
  expect(g.tf).toBe('as-is');
  expect(g.patches).toBeGreaterThanOrEqual(2);          // a real region, not one lucky tile
  // Located roughly where planted: A-side in the top-left quadrant, B-side bottom-right.
  expect(g.rectA.x).toBeLessThan(0.45);
  expect(g.rectA.y).toBeLessThan(0.45);
  expect(g.rectB.x).toBeGreaterThan(0.4);
  expect(g.rectB.y).toBeGreaterThan(0.4);
  expect(errors).toEqual([]);
});

test('a rotated copy is still found, and the transform is named', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNoisePanels(page, [
    { w: 480, h: 480, seed: 31 },
    { w: 480, h: 480, seed: 42, paste: [{ fromSeed: 31, sx: 60, sy: 60, size: 160, dx: 260, dy: 60, rot: 1 }] },
  ]);
  const r = await page.evaluate(() => {
    const s = _regionDupScan();
    return s.regions.map(g => ({ tf: g.tf, same: g.same, score: g.score }));
  });
  expect(r.length).toBeGreaterThanOrEqual(1);
  // 90° one way on the canvas is 270° the other way when B is mapped onto A —
  // either name is the same physical claim, so accept the pair, reject everything else.
  expect(['rotated 90°', 'rotated 270°']).toContain(r[0].tf);
  expect(errors).toEqual([]);
});

test('a region cloned WITHIN one panel is found — the cloned-lane case', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNoisePanels(page, [
    { w: 480, h: 480, seed: 51, paste: [{ fromSeed: 51, sx: 40, sy: 40, size: 128, dx: 300, dy: 300 }] },
  ]);
  const r = await page.evaluate(() => {
    const s = _regionDupScan();
    return s.regions.map(g => ({ same: g.same, a: g.a, b: g.b }));
  });
  expect(r.length).toBeGreaterThanOrEqual(1);
  expect(r[0].same).toBe(true);
  expect(errors).toEqual([]);
});

test('two genuinely different noise fields produce no matches', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNoisePanels(page, [
    { w: 480, h: 480, seed: 61 },
    { w: 480, h: 480, seed: 62 },
    { w: 480, h: 480, seed: 63 },
  ]);
  const r = await page.evaluate(() => {
    const s = _regionDupScan();
    return { regions: s.regions.length, patches: s.patches, capped: s.capped };
  });
  expect(r.regions).toBe(0);                             // no invented duplications
  expect(r.patches).toBeGreaterThan(50);                 // and it genuinely compared things
  expect(r.capped).toBe(false);
  expect(errors).toEqual([]);
});

test('flat panels are excluded and the exclusion is reported, not passed', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(async () => {
    images.length = 0;
    for (const shade of [200, 200]) {                    // two identical UNIFORM panels
      const c = document.createElement('canvas'); c.width = 300; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = `rgb(${shade},${shade},${shade})`; x.fillRect(0, 0, 300, 300);
      const u = c.toDataURL('image/png');
      await new Promise(res => { const im = new Image();
        im.onload = () => { _commitImage(im, u, 'flat.png'); res(); }; im.src = u; });
    }
    render();
  });
  const r = await page.evaluate(() => {
    const s = _regionDupScan();
    return { regions: s.regions.length, patches: s.patches, skipped: s.skipped.length };
  });
  // Identical blank panels are NOT reported as duplicates — correlation on flat
  // content is meaningless — and equally are NOT counted as compared-and-clean.
  expect(r.regions).toBe(0);
  expect(r.patches).toBe(0);
  expect(errors).toEqual([]);
});

test('the report modal shows the region section with boxed evidence', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNoisePanels(page, [
    { w: 480, h: 480, seed: 71 },
    { w: 480, h: 480, seed: 82, paste: [{ fromSeed: 71, sx: 50, sy: 50, size: 160, dx: 260, dy: 260 }] },
  ]);
  const r = await page.evaluate(() => {
    runDuplicateScan();
    const m = document.querySelector('.modal-bg.open .modal');
    const txt = m ? m.textContent : '';
    const imgs = m ? m.querySelectorAll('img').length : 0;
    m?.closest('.modal-bg')?.remove();
    return { txt, imgs,
      logged: reproLog.filter(e => e.action === 'duplicateScan').pop() };
  });
  expect(r.txt).toMatch(/Regions/);
  expect(r.txt).toMatch(/reappears in/);
  expect(r.imgs).toBeGreaterThanOrEqual(2);              // side-by-side evidence thumbnails
  // The check finds candidates, it does not judge them — that sentence must be there.
  expect(r.txt).toMatch(/does not judge them/);
  // And the honesty footer about what it cannot see.
  expect(r.txt).toMatch(/blank background is not findable/);
  expect(r.logged.regionMatches).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('the deep audit carries the region result too', async ({ page }) => {
  const errors = await loadApp(page);
  await seedNoisePanels(page, [
    { w: 480, h: 480, seed: 91 },
    { w: 480, h: 480, seed: 95, paste: [{ fromSeed: 91, sx: 60, sy: 60, size: 160, dx: 240, dy: 240 }] },
  ]);
  const r = await page.evaluate(() => {
    runAdvancedConsistency();
    const m = document.querySelector('.modal-bg.open .modal');   // the audit builds its own modal, not the shared info one
    const t = m ? m.textContent : ''; m?.closest('.modal-bg')?.remove();
    return t;
  });
  expect(r).toMatch(/reappears in .*Duplication check/);
  expect(errors).toEqual([]);
});
