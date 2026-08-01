// @ts-check
// v3.9.1 feature tests: the duplicate-panel self-check.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

/**
 * Seed grid panels from generated images.
 * `specs` is a list of draw functions; each becomes one panel.
 */
async function seedDrawn(page, specs) {
  await page.evaluate(async (bodies) => {
    const mk = (body) => new Promise(ok => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 120;
      new Function('x', 'W', body)(c.getContext('2d'), 120);
      const src = c.toDataURL('image/png');
      const i = new Image();
      i.onload = () => ok({ img: i, src });
      i.src = src;
    });
    for (const b of bodies) {
      const { img, src } = await mk(b);
      _commitImage(img, src, 'p.png', null, null, null);
    }
    render();
  }, specs);
  await page.waitForFunction(n => images.filter(Boolean).length >= n, specs.length);
}

// A deterministic, high-detail pattern — the kind of texture a real micrograph has.
const BLOBS = `
  x.fillStyle='#111'; x.fillRect(0,0,W,W);
  let s=7;
  const rnd=()=>{ s=(s*1103515245+12345)%2147483648; return s/2147483648; };
  for(let i=0;i<40;i++){
    x.fillStyle='rgb('+(80+rnd()*175|0)+','+(80+rnd()*175|0)+','+(60+rnd()*120|0)+')';
    x.beginPath(); x.arc(rnd()*W, rnd()*W, 4+rnd()*10, 0, 6.284); x.fill();
  }`;
// A different seed gives a genuinely different field of view.
const BLOBS2 = BLOBS.replace('let s=7;', 'let s=987654;');

test('an accidentally reused panel is caught', async ({ page }) => {
  const errors = await loadApp(page);
  await seedDrawn(page, [BLOBS, BLOBS2, BLOBS]);   // panels A and C are the same image
  const r = await page.evaluate(() => {
    const s = _panelSimilarityScan();
    return { compared: s.compared, skipped: s.skipped.length,
             hits: s.hits.map(h => h.a + '|' + h.b + '|' + h.tf + '|' + h.score.toFixed(3)) };
  });
  expect(r.compared).toBe(3);
  expect(r.skipped).toBe(0);
  expect(r.hits.length).toBe(1);                   // exactly one pair, not everything
  expect(r.hits[0]).toContain('A|C');              // the duplicated pair
  expect(r.hits[0]).toContain('as-is');
  expect(errors).toEqual([]);
});

test('reuse is still caught when the copy is rotated or mirrored', async ({ page }) => {
  const errors = await loadApp(page);
  await seedDrawn(page, [BLOBS, BLOBS2]);
  const r = await page.evaluate(() => {
    // the classic disguise: same acquisition, dropped in rotated
    images[1].img = images[0].img; images[1].src = images[0].src;
    images[1].rotate = 180;
    render();
    const s = _panelSimilarityScan();
    return { n: s.hits.length, score: s.hits[0] && s.hits[0].score };
  });
  // rotate is a display transform, so the underlying pixels still match at 'as-is';
  // the dihedral sweep is what covers a copy that was rotated before import.
  expect(r.n).toBe(1);
  expect(r.score).toBeGreaterThan(0.99);
  expect(errors).toEqual([]);
});

test('the dihedral sweep matches a genuinely rotated image', async ({ page }) => {
  const errors = await loadApp(page);
  await seedDrawn(page, [BLOBS]);
  const r = await page.evaluate(() => {
    const t = _panelThumb({ img: images[0].img, src: images[0] });
    // rotating the thumbnail by each transform must still correlate perfectly
    return [0, 1, 2, 3, 4, 5, 6, 7].map(k => {
      const v = _dihedral(t.v, 32, k);
      let best = -1;
      for (let j = 0; j < 8; j++) {
        const back = j === 0 ? v : _dihedral(v, 32, j);
        best = Math.max(best, _ncc(t.v, t.norm, back, t.norm));
      }
      return +best.toFixed(3);
    });
  });
  // every transform is undone by some other transform in the group
  r.forEach(score => expect(score).toBeGreaterThan(0.99));
  expect(errors).toEqual([]);
});

test('different panels are not flagged, and blank panels are excluded not guessed', async ({ page }) => {
  const errors = await loadApp(page);
  const FLAT_A = `x.fillStyle='#808080'; x.fillRect(0,0,W,W);`;
  const FLAT_B = `x.fillStyle='#7f7f7f'; x.fillRect(0,0,W,W);`;
  await seedDrawn(page, [BLOBS, BLOBS2, FLAT_A, FLAT_B]);
  const r = await page.evaluate(() => {
    const s = _panelSimilarityScan();
    return { hits: s.hits.length, compared: s.compared, skipped: s.skipped };
  });
  // Two near-identical flat greys would correlate on noise alone. They are reported as
  // not-compared rather than silently passed or falsely flagged.
  expect(r.hits).toBe(0);
  expect(r.compared).toBe(2);
  expect(r.skipped.length).toBe(2);
  expect(errors).toEqual([]);
});

test('the duplicate check reports through the UI and the deep audit', async ({ page }) => {
  const errors = await loadApp(page);
  await seedDrawn(page, [BLOBS, BLOBS]);
  const r = await page.evaluate(() => {
    // both report into a modal appended to <body>; the page also ships static modals,
    // so read the one that was just added
    const shown = (fn) => {
      const before = document.querySelectorAll('.modal-bg').length;
      fn();
      const all = document.querySelectorAll('.modal-bg');
      const txt = all.length > before ? all[all.length - 1].innerText : '';
      if (all.length > before) all[all.length - 1].remove();
      return txt;
    };
    return { dup: shown(runDuplicateScan), audit: shown(runAdvancedConsistency) };
  });
  expect(r.dup).toContain('similar');
  expect(r.dup).toMatch(/not a substitute/i);        // the limit is disclosed
  expect(r.audit).toContain('identical');            // and it reaches the Deep Figure Audit
  expect(errors).toEqual([]);
});

test('the duplicate check works on freeform objects too', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async () => {
    setLayoutMode('freeform');
    const mk = (seed) => new Promise(ok => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 120;
      const x = c.getContext('2d'); let s = seed;
      const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
      x.fillStyle = '#111'; x.fillRect(0, 0, 120, 120);
      for (let i = 0; i < 40; i++) {
        x.fillStyle = 'rgb(' + (80 + rnd() * 175 | 0) + ',' + (80 + rnd() * 175 | 0) + ',90)';
        x.beginPath(); x.arc(rnd() * 120, rnd() * 120, 4 + rnd() * 10, 0, 6.284); x.fill();
      }
      const src = c.toDataURL('image/png');
      const i = new Image(); i.onload = () => ok(src); i.src = src;
    });
    const a = await mk(7), b = await mk(987654);
    [a, b, a].forEach((src, i) => addFreeformElement({ type: 'image', src,
      x: 20 + i * 130, y: 20, w: 120, h: 120, label: 'Obj' + (i + 1),
      cropT: 0, cropL: 0, cropB: 0, cropR: 0, brightness: 1, contrast: 1 }));
    freeformElements.forEach(el => buildImgEl(el));
    await new Promise(ok => setTimeout(ok, 200));
    render();
    const s = _panelSimilarityScan();
    return { compared: s.compared, hits: s.hits.map(h => h.a + '|' + h.b) };
  });
  expect(r.compared).toBe(3);
  expect(r.hits).toEqual(['Obj1|Obj3']);
  expect(errors).toEqual([]);
});
