// @ts-check
// Rotating a panel.
//
// A panel is contain-fitted into its cell and then spun by im.rotate. The fit was
// computed from the UNTURNED extent, so a quarter turn was fitted as though the picture
// still lay the other way: a 2:1 image turned 90° into a matching 1:2 cell came out at
// half the size it should be, and the panel letter, scale bar and tag were placed
// against a box the picture no longer occupied.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

/** Commit one panel of the given size, painted so its orientation is visible. */
async function seedSized(page, w, h) {
  await page.evaluate(async ({ w, h }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, w / 2, h);        // left half red
    x.fillStyle = '#0000ff'; x.fillRect(w / 2, 0, w / 2, h);    // right half blue
    const src = c.toDataURL('image/png');
    await new Promise(r => { const img = new Image(); img.onload = () => { _commitImage(img, src, 'wide.png'); r(); }; img.src = src; });
    render();
  }, { w, h });
  await page.waitForFunction(() => images[0] && images[0].img && images[0].img.naturalWidth > 0);
}

/** The bounding box of everything that is not the white background. */
const INK_BOX = `
  window._inkBox = () => {
    const fc = document.getElementById('fig-canvas'), d = fc.getContext('2d').getImageData(0, 0, fc.width, fc.height).data;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < fc.height; y++) for (let x = 0; x < fc.width; x++) {
      const i = (y * fc.width + x) * 4;
      if (!(d[i] > 250 && d[i+1] > 250 && d[i+2] > 250)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };
`;

test('a quarter-turned panel is fitted to the turned extent, so it fills a cell of the matching shape', async ({ page }) => {
  const errors = await loadApp(page);
  await seedSized(page, 400, 200);                              // 2:1 landscape
  await page.evaluate(INK_BOX);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); sv('bg-color', '#ffffff');
    document.getElementById('show-labels').checked = false; images[0].sbOn = false;
    const at = (w, h, rot) => { sv('panel-w', String(w)); sv('panel-h', String(h)); images[0].rotate = rot; onLayoutChange(); render();
      const b = _inkBox(); const pb = panelBounds[0]; return { drawn: [b.w, b.h], recorded: [pb.iw, pb.ih] }; };
    return {
      // a 1:2 portrait cell: turned, the picture is 1:2 as well and should fill it
      portrait0: at(150, 300, 0), portrait90: at(150, 300, 90), portrait270: at(150, 300, 270),
      // 180° is not a quarter turn — it must behave exactly like 0°
      portrait180: at(150, 300, 180),
      // a square cell can do no better either way
      square0: at(300, 300, 0), square90: at(300, 300, 90),
    };
  });
  expect(r.portrait0.drawn).toEqual([150, 75]);                 // unturned: letterboxed, as it must be
  expect(r.portrait90.drawn).toEqual([150, 300]);               // was [75, 150] — half size in a cell it exactly fits
  expect(r.portrait270.drawn).toEqual([150, 300]);              // the other quarter turn behaves the same
  expect(r.portrait180.drawn).toEqual([150, 75]);               // 180° is not a quarter turn
  expect(r.square0.drawn).toEqual([300, 150]);
  expect(r.square90.drawn).toEqual([150, 300]);
  // panelBounds records where the picture really is, which overlays read
  expect(r.portrait90.recorded).toEqual([150, 300]);            // was [150, 75], the pre-turn box
  expect(r.square90.recorded).toEqual([150, 300]);              // was [300, 150]
  expect(r.portrait0.recorded).toEqual([150, 75]);              // unturned: unchanged
  expect(errors).toEqual([]);
});

test('the letter, the scale bar and the tag sit on the turned picture, not beside it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedSized(page, 400, 200);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); sv('panel-w', '150'); sv('panel-h', '300');
    document.getElementById('show-labels').checked = true; sv('label-pos', 'tl'); sv('label-format', 'ABC');
    document.getElementById('show-tags').checked = true; sv('tag-pos', 'tr');
    images[0].tag = 'WT'; images[0].umPerPx = 0.5; images[0].sbUm = 20; images[0].sbOn = true;
    const probe = (rot) => {
      images[0].rotate = rot; onLayoutChange(); render();
      const pb = panelBounds[0];
      const pic = { x: pb.ix, y: pb.iy, w: pb.iw, h: pb.ih };
      const inside = (b) => b.x >= pic.x - 1 && b.y >= pic.y - 1 && b.x + b.w <= pic.x + pic.w + 1 && b.y + b.h <= pic.y + pic.h + 1;
      const box = k => { const t = figTextItems.find(t => t.kind === k); return t && t.bbox; };
      const bar = _sbBars[0];
      return { pic, letter: inside(box('panel')), tag: inside(box('tag')),
               bar: bar && bar.left >= pic.x - 1 && bar.right <= pic.x + pic.w + 1 && bar.bottom <= pic.y + pic.h + 1,
               barLen: bar && +(bar.right - bar.left).toFixed(2) };
    };
    return { off: probe(0), turned: probe(90) };
  });
  // Unturned, everything was already on the picture.
  expect(r.off.letter).toBe(true); expect(r.off.tag).toBe(true); expect(r.off.bar).toBe(true);
  // Turned, all three used to be placed against the pre-turn box and floated off it.
  expect(r.turned.letter).toBe(true);
  expect(r.turned.tag).toBe(true);
  expect(r.turned.bar).toBe(true);
  // The bar measures the same physical length either way: 20 µm at 0.5 µm/px is 40
  // source px, and the turned panel is drawn at a larger scale, so the bar grows with it.
  expect(r.off.barLen).toBeCloseTo(40 * (150 / 400), 1);
  expect(r.turned.barLen).toBeCloseTo(40 * (300 / 400), 1);
  expect(errors).toEqual([]);
});

test('a turned panel reports the field of view it actually shows, and Crop to fill cells agrees with the renderer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedSized(page, 400, 200);
  await page.evaluate(INK_BOX);
  const r = await page.evaluate(() => {
    sv('cols', '1'); sv('rows', '1'); sv('panel-w', '300'); sv('panel-h', '300'); sv('bg-color', '#ffffff');
    document.getElementById('show-labels').checked = false; images[0].sbOn = false;
    images[0].umPerPx = 0.5;
    images[0].rotate = 90; onLayoutChange(); render();
    const fov = _fovText(images[0]);                            // 400x200 px turned → 100 µm tall, 200 µm wide shown as 100 x 200
    fillCellsAll();                                             // crop it to the square cell
    render();
    const b = _inkBox();
    return { fov, filled: [b.w, b.h], crop: [images[0].cropL, images[0].cropT, images[0].cropR, images[0].cropB] };
  });
  expect(r.fov).toBe('100 × 200 µm');                           // the turned extent, not the raw one
  expect(r.filled).toEqual([300, 300]);                         // fills the square cell after the crop
  expect(r.crop[0]).toBeCloseTo(25, 1); expect(r.crop[2]).toBeCloseTo(25, 1);   // trimmed along the source X, as a turn demands
  expect(r.crop[1]).toBe(0); expect(r.crop[3]).toBe(0);
  expect(errors).toEqual([]);
});
