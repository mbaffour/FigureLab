// @ts-check
// Tests for the v3.9 feature work:
//   Feature A — the raw-pixel measurement pipeline
//   Feature B — the gene-map / genetic-circuit element
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform, seedPanels } = require('./helpers');
const fs = require('fs'), path = require('path');

// ═══════════════════════════════════════════════════════════════
// FEATURE A — RAW-PIXEL MEASUREMENT PIPELINE
// ═══════════════════════════════════════════════════════════════
const RAWFX = path.join(__dirname, 'fixtures', 'tiff');
const rawMan = JSON.parse(fs.readFileSync(path.join(RAWFX, 'raw_manifest.json'), 'utf8'));
const tifBytes = (name) => Array.from(fs.readFileSync(path.join(RAWFX, name + '.tif')));

/** Import a fixture TIFF through _commitImage with its decoded native samples. */
async function seedRawPanel(page, name) {
  await page.evaluate(async (bytes) => {
    const res = await decodeTIFF(new Uint8Array(bytes));
    const c = document.createElement('canvas'); c.width = res.width; c.height = res.height;
    c.getContext('2d').putImageData(new ImageData(res.rgba, res.width, res.height), 0, 0);
    const src = c.toDataURL('image/png');
    await new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => { _commitImage(img, src, 'raw.tif', null, { umPerPx: 0.5, source: 'test' }, res.raw); ok(); };
      img.onerror = no; img.src = src;
    });
    render();
  }, tifBytes(name));
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
}

test('decodeTIFF retains native samples above 8 bits, and not at 8 bits', async ({ page }) => {
  await loadApp(page);
  const r = await page.evaluate(async ({ g16, g8, f32 }) => {
    const a = await decodeTIFF(new Uint8Array(g16));
    const b = await decodeTIFF(new Uint8Array(g8));
    const c = await decodeTIFF(new Uint8Array(f32));
    const at = (raw, x, y) => raw.data[y * raw.w + x];
    return {
      raw16: a.raw && {
        w: a.raw.w, h: a.raw.h, bps: a.raw.bps, min: a.raw.min, max: a.raw.max,
        full: a.raw.full, kind: a.raw.data.constructor.name,
        px00: at(a.raw, 0, 0), px10: at(a.raw, 10, 5), px63: at(a.raw, 63, 47),
      },
      note16: a.note,
      raw8: b.raw,
      f32kind: c.raw && c.raw.data.constructor.name,
      disp00: a.rgba[0], disp63: a.rgba[((47 * a.width) + 63) * 4],
    };
  }, { g16: tifBytes('raw16_gradient'), g8: tifBytes('g8_raw'), f32: tifBytes('f32_raw') });

  const exp = rawMan.raw16_gradient;
  expect(r.raw16.w).toBe(exp.w);
  expect(r.raw16.h).toBe(exp.h);
  expect(r.raw16.bps).toBe(16);
  expect(r.raw16.kind).toBe('Uint16Array');
  expect(r.raw16.min).toBe(exp.min);            // 1000
  expect(r.raw16.max).toBe(exp.max);            // 7300
  expect(r.raw16.full).toBe(65535);             // the 16-bit ceiling, not the data max
  expect(r.raw16.px00).toBe(1000);              // fixture is value = 1000 + 100*x
  expect(r.raw16.px10).toBe(2000);
  expect(r.raw16.px63).toBe(7300);
  expect(r.note16).toMatch(/native samples kept/);
  expect(r.raw8).toBeNull();                    // 8-bit data gains nothing from retention
  expect(r.f32kind).toBe('Float32Array');       // float TIFFs keep float precision
  // ...and the display really is the lossy 8-bit version of the same pixels
  expect(r.disp63).toBe(255);
  expect(r.disp00).toBeLessThan(60);
});

test('ROI measures absolute raw intensities, not the 8-bit display', async ({ page }) => {
  await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const pb = panelBounds[0], im = images[0];
    const map = _panelSourceMap(pb, im);
    const full = _rawStatsRect(im.raw, 0, 0, im.raw.w, im.raw.h);
    const left = _rawStatsRect(im.raw, 0, 0, im.raw.w / 2, im.raw.h);
    const right = _rawStatsRect(im.raw, im.raw.w / 2, 0, im.raw.w, im.raw.h);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    measureAndShowROI(ctx, map.dx, map.dy, map.dw, map.dh);   // drive the real UI path
    return {
      full, left, right, kx: map.kx,
      html: document.getElementById('roi-results').innerHTML,
      m: measurements[measurements.length - 1],
    };
  });
  const exp = rawMan.raw16_gradient;
  expect(r.full.mean).toBeCloseTo(exp.mean, 6);              // 4150 exactly
  expect(r.full.n).toBe(exp.w * exp.h);
  expect(r.left.mean).toBeCloseTo(exp.meanLeftHalf, 6);      // 2550
  expect(r.right.mean).toBeCloseTo(exp.meanRightHalf, 6);    // 5750
  expect(r.html).toMatch(/Raw mean/);
  expect(r.html).toMatch(/16-bit/);
  expect(r.html).toMatch(/4150/);
  expect(r.m.source).toBe('raw 16-bit');
  expect(Number(r.m.rawMean)).toBeCloseTo(exp.mean, 1);
  // the display mean is still reported alongside, and is a very different number
  expect(Number(r.m.meanGray)).toBeGreaterThan(100);
  expect(Number(r.m.meanGray)).toBeLessThan(200);
});

test('raw ROI area is in source pixels, so µm² uses the real calibration', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const im = images[0];
    const map = _panelSourceMap(panelBounds[0], im);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    measureAndShowROI(ctx, map.dx, map.dy, map.dw, map.dh);
    const m = measurements[measurements.length - 1];
    return { area: m.area, areaUm: Number(m.areaUm), dw: map.dw, dh: map.dh,
             srcW: im.raw.w, srcH: im.raw.h, umPerPx: im.umPerPx };
  });
  expect(r.area).toBe(r.srcW * r.srcH);             // the whole panel = the whole source image
  expect(r.area).not.toBe(r.dw * r.dh);             // ...displayed at a different size
  expect(r.areaUm).toBeCloseTo(r.srcW * r.srcH * r.umPerPx * r.umPerPx, 1);
  expect(errors).toEqual([]);
});

test('exposure analysis reports true sensor saturation from the raw samples', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_saturated');
  const r = await page.evaluate(() => {
    const im = images[0];
    const st = _rawStatsRect(im.raw, 0, 0, im.raw.w, im.raw.h);
    runExposureAnalysis();
    const modal = [...document.querySelectorAll('.modal-bg')].pop();
    const text = modal ? modal.textContent : '';
    if (modal) modal.remove();
    return { satPct: st.atFull / st.n * 100, mean: st.mean, max: st.max, text };
  });
  expect(r.satPct).toBeCloseTo(rawMan.raw16_saturated.saturatedPct, 6);   // 6.25%
  expect(r.mean).toBeCloseTo(rawMan.raw16_saturated.mean, 6);
  expect(r.max).toBe(65535);
  expect(r.text).toMatch(/saturated at the sensor maximum/);
  expect(r.text).toMatch(/6\.25%/);
  expect(errors).toEqual([]);
});

test('line profile reads raw samples and follows the true gradient', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const map = _panelSourceMap(panelBounds[0], images[0]);
    const ctx = document.getElementById('fig-canvas').getContext('2d');
    const y = map.dy + map.dh / 2;
    measureAndShowLineProfile(ctx, map.dx + 1, y, map.dx + map.dw - 1, y);
    const m = measurements[measurements.length - 1];
    const vals = m.values.split(',').map(Number);
    return { first: vals[0], last: vals[vals.length - 1],
             monotone: vals.every((v, i) => i === 0 || v >= vals[i - 1]),
             source: m.source, html: document.getElementById('roi-results').innerHTML };
  });
  expect(r.source).toBe('raw 16-bit');
  expect(r.monotone).toBe(true);                 // value = 1000 + 100*x rises left to right
  expect(r.first).toBeGreaterThanOrEqual(1000);
  expect(r.first).toBeLessThan(1400);
  expect(r.last).toBeGreaterThan(7000);          // reaches the true 7300, not a capped 255
  expect(r.html).toMatch(/raw samples/);
  expect(errors).toEqual([]);
});

test('rotated, flipped, shaped-crop and composite panels fall back to the disclosed display path', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const out = {};
    const im = images[0];
    const probe = (label, mutate, restore) => {
      mutate(); render();
      out[label] = _panelSourceMap(panelBounds[0], images[0]) === null;
      restore(); render();
    };
    out.baseline = _panelSourceMap(panelBounds[0], im) !== null;
    probe('rotated', () => im.rotate = 90, () => im.rotate = 0);
    probe('flippedH', () => im.flipH = true, () => im.flipH = false);
    probe('flippedV', () => im.flipV = true, () => im.flipV = false);
    probe('circleCrop', () => im.cropShape = 'circle', () => im.cropShape = 'rect');
    probe('composite', () => im.channels = [{ name: 'c2', src: im.src, lut: 'green' }], () => im.channels = []);
    // and the fallback really produces the 8-bit disclaimer, with no error
    im.rotate = 90; render();
    const pb = panelBounds[0];
    measureAndShowROI(document.getElementById('fig-canvas').getContext('2d'), pb.x + 10, pb.y + 10, 40, 30);
    out.fallbackHtml = document.getElementById('roi-results').innerHTML;
    out.fallbackSource = measurements[measurements.length - 1].source;
    im.rotate = 0; render();
    return out;
  });
  expect(r.baseline).toBe(true);            // an un-rotated panel maps exactly
  expect(r.rotated).toBe(true);
  expect(r.flippedH).toBe(true);
  expect(r.flippedV).toBe(true);
  expect(r.circleCrop).toBe(true);
  expect(r.composite).toBe(true);
  expect(r.fallbackSource).toBe('8-bit display');
  expect(r.fallbackHtml).toMatch(/8-bit display/);
  expect(r.fallbackHtml).not.toMatch(/Raw mean/);
  expect(errors).toEqual([]);
});

test('a panel with no raw samples still measures, on the display, with the disclaimer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  const r = await page.evaluate(() => {
    const pb = panelBounds[0];
    measureAndShowROI(document.getElementById('fig-canvas').getContext('2d'), pb.x + 10, pb.y + 10, 40, 30);
    return { raw: images[0].raw, source: measurements[0].source,
             html: document.getElementById('roi-results').innerHTML };
  });
  expect(r.raw == null).toBe(true);
  expect(r.source).toBe('8-bit display');
  expect(r.html).toMatch(/Measured on the 8-bit display/);
  expect(errors).toEqual([]);
});

test('cell count thresholds the raw samples at source resolution', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    document.getElementById('count-threshold').value = '128';   // mid-range → raw ≈ 4150
    const map = _panelSourceMap(panelBounds[0], images[0]);
    countCellsROI(document.getElementById('fig-canvas').getContext('2d'), map.dx, map.dy, map.dw, map.dh);
    return { m: measurements[measurements.length - 1],
             html: document.getElementById('roi-results').innerHTML,
             srcPx: images[0].raw.w * images[0].raw.h };
  });
  expect(r.m.source).toBe('raw 16-bit');
  expect(r.m.area).toBe(r.srcPx);                     // segmented at source resolution
  // value = 1000+100x ≥ ~4150 ⇒ the right half of the columns ⇒ one connected object
  expect(r.m.fgPx / r.srcPx).toBeCloseTo(0.5, 1);
  expect(r.m.count).toBe(1);
  expect(r.html).toMatch(/raw/);
  expect(errors).toEqual([]);
});

test('raw samples never enter a saved session', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const r = await page.evaluate(() => {
    const ser = serializeSession(true);
    const json = JSON.stringify(ser);
    setLayoutMode('freeform');
    addFreeformElement({ type: 'image', x: 10, y: 10, w: 50, h: 50, src: images[0].src });
    freeformElements[freeformElements.length - 1].raw = images[0].raw;
    const ffSer = serializeSession(true).freeformElements.slice(-1)[0];
    setLayoutMode('grid');
    return { hasRawKey: Object.keys(ser.images[0]).includes('raw'),
             ffHasRaw: Object.keys(ffSer).includes('raw'),
             mentionsRaw: /"raw":/.test(json) };
  });
  expect(r.hasRawKey).toBe(false);
  expect(r.ffHasRaw).toBe(false);
  expect(r.mentionsRaw).toBe(false);
  expect(errors).toEqual([]);
});

test('measurement CSV states, per row, which pixels produced the numbers', async ({ page }) => {
  const errors = await loadApp(page);
  await seedRawPanel(page, 'raw16_gradient');
  const csv = await page.evaluate(() => {
    const map = _panelSourceMap(panelBounds[0], images[0]);
    measureAndShowROI(document.getElementById('fig-canvas').getContext('2d'), map.dx, map.dy, map.dw, map.dh);
    let captured = '';
    const realDl = window.dl, realBlob = window.blobUrl;
    window.dl = () => {};
    window.blobUrl = (t) => { captured = t; return 'blob:x'; };
    exportMeasurements();
    window.dl = realDl; window.blobUrl = realBlob;
    return captured;
  });
  expect(csv).toMatch(/Measured on/);
  expect(csv).toMatch(/"raw 16-bit"/);
  expect(csv).toMatch(/Rows measured on raw:/);
  expect(csv).toMatch(/n-1 denominator/);
  expect(errors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════
// FEATURE B — GENE MAP / GENETIC CIRCUIT ELEMENT
// ═══════════════════════════════════════════════════════════════
const GB = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_plasmid.gb'), 'utf8');

/** Add a gene map (the modal opens on insert; close it) and return its index. */
async function addMap(page, topology, mutate) {
  return page.evaluate(({ topology, mutate }) => {
    addGenemapElement(topology);
    closeGenemapModal();
    const i = freeformElements.length - 1;
    if (mutate) new Function('el', mutate)(freeformElements[i]);
    freeformElements[i]._genemapCache = null;
    render();
    return i;
  }, { topology, mutate: mutate || null });
}

test('gene map inserts, renders linear and circular, and lands in the layer list', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear');
  await addMap(page, 'circular');
  const r = await page.evaluate(() => {
    const [a, b] = freeformElements;
    const ops = (el) => { const buf = []; _genemapDraw(el, _chartEmitSVG(buf)); return buf; };
    return {
      types: freeformElements.map(e => e.type),
      topos: freeformElements.map(e => e.map.topology),
      feats: a.map.features.length,
      bp: a.map.length,
      linOps: ops(a).length, circOps: ops(b).length,
      listHtml: document.getElementById('fm-elem-list').innerHTML,
      inBounds: panelBounds.length,
    };
  });
  expect(r.types).toEqual(['genemap', 'genemap']);
  expect(r.topos).toEqual(['linear', 'circular']);
  expect(r.feats).toBeGreaterThan(3);
  expect(r.bp).toBe(5000);
  expect(r.linOps).toBeGreaterThan(15);       // backbone + glyphs + labels + ruler
  expect(r.circOps).toBeGreaterThan(10);
  expect(r.listHtml).toMatch(/🧬/);
  expect(r.inBounds).toBe(2);
  expect(errors).toEqual([]);
});

test('features are placed by base pair, so the map scales with the backbone length', async ({ page }) => {
  const errors = await loadApp(page);
  // one feature, a single bp wide, at the exact midpoint of the construct
  await addMap(page, 'linear', `
    el.x = 0; el.y = 0; el.w = 500; el.h = 200;
    el.map.length = 5000;
    el.map.style.showLabels = false; el.map.style.showRuler = false;
    el.map.features = [{ name: 'mid', type: 'operator', start: 2500, end: 2510, strand: 1 }];`);
  const r = await page.evaluate(() => {
    const el = freeformElements[0];
    const boxAt = () => {
      const buf = [];
      _genemapDraw(el, _chartEmitSVG(buf));
      // the last <rect> is the operator glyph; the first is the card background
      const rect = buf.filter(s => /^<rect/.test(s)).pop();
      return +/x="([\d.]+)"/.exec(rect)[1];
    };
    const at5k = boxAt();
    el.map.length = 10000;                 // same feature, twice the backbone
    const at10k = boxAt();
    el.map.length = 5000;
    el.w = 1000;                            // same backbone, twice the width
    const wide = boxAt();
    return { at5k, at10k, wide, w: 500 };
  });
  // bp 2500 of 5000 sits at the middle of the drawable span (pad ≈ 19 each side)
  expect(r.at5k).toBeGreaterThan(240);
  expect(r.at5k).toBeLessThan(260);
  // the same feature on a 10 kb backbone sits at a quarter of the span
  expect(r.at10k).toBeGreaterThan(125);
  expect(r.at10k).toBeLessThan(145);
  // doubling the element width doubles the pixel offset — the bp scale is preserved
  expect(r.wide).toBeGreaterThan(r.at5k * 1.9);
  expect(errors).toEqual([]);
});

test('gene maps export as true vector, not a second raster', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `el.x = 100; el.y = 100; el.w = 600; el.h = 200; el.rotation = 20;`);
  const svg = await page.evaluate(() => {
    let captured = '';
    const realDl = window.dl, realBlob = window.blobUrl;
    window.dl = () => {};
    window.blobUrl = (t) => { captured = t; return 'blob:x'; };
    exportSVG();
    window.dl = realDl; window.blobUrl = realBlob;
    return captured;
  });
  expect(svg).toMatch(/<svg/);
  expect((svg.match(/<image /g) || []).length).toBe(1);   // exactly one background raster
  expect(svg).toMatch(/<polyline/);                       // glyph geometry is vector
  expect(svg).toMatch(/<text/);                           // labels are real text
  expect(svg).toMatch(/gfp/);                             // ...with the feature names in it
  expect(svg).toMatch(/rotate\(20 /);                     // rotation applied to the vector group
  expect(errors).toEqual([]);
});

test('the background raster omits gene maps, so the vector layer does not double-draw', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `el.x = 100; el.y = 100; el.w = 600; el.h = 200;`);
  const r = await page.evaluate(() => {
    // a non-white figure background, so "map drawn" and "map skipped" are distinguishable
    const bg = document.getElementById('bg-color');
    bg.value = '#123456'; bg.dispatchEvent(new Event('input', { bubbles: true }));
    const el = freeformElements[0];
    const px = (skip) => {
      const off = document.createElement('canvas');
      render(off, 1, { skipLabels: true, skipCharts: skip });
      const d = off.getContext('2d').getImageData(Math.round(el.x + 10), Math.round(el.y + el.h / 2), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return { drawn: px(false), skipped: px(true) };
  });
  // With charts drawn, the map paints its white card over the figure background.
  // With skipCharts (the SVG export path) that region is left to the background,
  // so the vector <g> can paint it exactly once.
  expect(r.drawn).toEqual([255, 255, 255]);
  expect(r.skipped).toEqual([0x12, 0x34, 0x56]);
  expect(errors).toEqual([]);
});

test('pasting a feature table replaces the features wholesale', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear');
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0);
    openGenemapModal();
    const before = freeformElements[0].map.features.length;
    document.getElementById('gm-table').value =
      'name\ttype\tstart\tend\tstrand\n' +
      'Pcon\tpromoter\t50\t150\t+\n' +
      'mCherry, cds, 200, 900, +\n' +
      'kanR\tcds\t1000\t1800\t-\n' +
      'oops\n';                             // an unreadable row: reported, not silently dropped
    document.getElementById('gm-length').value = '2500';
    applyGenemapModal();
    closeGenemapModal();
    const m = freeformElements[0].map;
    return { before, after: m.features.length, len: m.length,
             names: m.features.map(f => f.name),
             types: m.features.map(f => f.type),
             strands: m.features.map(f => f.strand) };
  });
  expect(r.before).toBe(6);
  expect(r.after).toBe(3);                        // replaced, not merged
  expect(r.len).toBe(2500);
  expect(r.names).toEqual(['Pcon', 'mCherry', 'kanR']);   // sorted by start
  expect(r.types).toEqual(['promoter', 'cds', 'cds']);
  expect(r.strands).toEqual([1, 1, -1]);          // comma rows and '-' strand both parse
  expect(errors).toEqual([]);
});

test('features past the backbone are clipped to it, never drawn off the end', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `
    el.map.length = 1000;
    el.map.features = [{ name: 'over', type: 'cds', start: 900, end: 4000, strand: 1 },
                       { name: 'rev', type: 'cds', start: 600, end: 300, strand: 1 }];`);
  const r = await page.evaluate(() => _gmFeatures(freeformElements[0].map));
  expect(r[1].end).toBe(1000);                    // clipped to the backbone
  expect(r[0]).toMatchObject({ start: 300, end: 600 });   // reversed coords normalised
  expect(errors).toEqual([]);
});

test('_parseGenBank reads the LOCUS, topology and FEATURES table, and nothing else', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate((txt) => _parseGenBank(txt), GB);
  expect(r.length).toBe(3210);
  expect(r.topology).toBe('circular');
  expect(r.name).toBe('pFL-TEST');
  const by = Object.fromEntries(r.features.map(f => [f.name, f]));
  expect(r.features.map(f => f.name)).not.toContain('source');   // record metadata, not a glyph
  expect(by.pTet).toMatchObject({ type: 'promoter', start: 101, end: 235, strand: 1 });
  expect(by.B0034).toMatchObject({ type: 'rbs' });
  expect(by.gfp).toMatchObject({ type: 'cds', start: 280, end: 996, strand: 1 });
  expect(by.T1).toMatchObject({ type: 'terminator' });
  expect(by.ColE1).toMatchObject({ type: 'ori' });
  expect(by.bla).toMatchObject({ type: 'cds', start: 2100, end: 2960, strand: -1 });  // complement()
  expect(by.M13R).toMatchObject({ type: 'primer', strand: -1 });
  expect(by.MCS).toMatchObject({ type: 'misc' });
  expect(errors).toEqual([]);
});

test('a dropped GenBank file becomes a gene map', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async (txt) => {
    const f = new File([txt], 'pFL-TEST.gb', { type: 'text/plain' });
    addFiles([f]);
    await new Promise(res => setTimeout(res, 300));
    const el = freeformElements[freeformElements.length - 1];
    document.getElementById('genemap-modal').classList.remove('open');
    return el && { type: el.type, bp: el.map.length, topo: el.map.topology,
                   n: el.map.features.length, title: el.map.style.title, images: images.length };
  }, GB);
  expect(r.type).toBe('genemap');
  expect(r.bp).toBe(3210);
  expect(r.topo).toBe('circular');
  expect(r.n).toBe(8);
  expect(r.title).toBe('pFL-TEST');
  expect(r.images).toBe(0);                       // never mistaken for an image import
  expect(errors).toEqual([]);
});

test('_parseFASTA gives a backbone sized by the sequence, with no invented features', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() =>
    _parseFASTA('>myseq some description\nACGTACGTAC\nGGTTAACC\n\nTTTT\n'));
  expect(r.length).toBe(22);
  expect(r.features).toEqual([]);                 // a FASTA declares no features, so none appear
  expect(r.name).toBe('myseq');
  expect(errors).toEqual([]);
});

test('rescaling multiplies every coordinate so the design keeps its proportions', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `
    el.map.length = 1000;
    el.map.features = [{ name: 'a', type: 'cds', start: 100, end: 300, strand: 1 },
                       { name: 'b', type: 'cds', start: 600, end: 800, strand: -1 }];`);
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0);
    window.prompt = () => '4000';                 // ×4
    _gmRescale();
    const m = freeformElements[0].map;
    return { len: m.length, spans: m.features.map(f => [f.start, f.end]) };
  });
  expect(r.len).toBe(4000);
  expect(r.spans).toEqual([[400, 1200], [2400, 3200]]);
  expect(errors).toEqual([]);
});

test('gene maps survive undo and a session round-trip, without their raster proxy', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear');
  const r = await page.evaluate(() => {
    render();                                     // stamps the idle raster proxy
    const el = freeformElements[0];
    const hadCache = !!(el._genemapCache && el._genemapCache.width > 1);
    // snapshot the serialized form the way saving does (stringify immediately) —
    // the returned object shares nested references with the live element
    const ser = JSON.parse(JSON.stringify(serializeSession(true))).freeformElements[0];
    const snap = cloneElemForUndo(el);
    // undo/redo round-trip through the real stack
    pushUndo();
    el.map.length = 12345;
    undo();
    const afterUndo = freeformElements[0].map.length;
    // a snapshot must not share feature objects with the live element
    snap.map.features[0].name = 'MUTATED';
    return { hadCache, afterUndo,
             serKeys: Object.keys(ser).filter(k => /^_genemap/.test(k) || k === 'img'),
             serFeats: ser.map.features.length, serBp: ser.map.length,
             liveName: freeformElements[0].map.features[0].name,
             snapCache: snap._genemapCache };
  });
  expect(r.hadCache).toBe(true);
  expect(r.afterUndo).toBe(5000);
  expect(r.serKeys).toEqual([]);                  // no cache/canvas in the saved session
  expect(r.serFeats).toBe(6);
  expect(r.serBp).toBe(5000);
  expect(r.liveName).not.toBe('MUTATED');         // deep-copied, not shared
  expect(r.snapCache).toBeUndefined();
  expect(errors).toEqual([]);
});

test('an unknown feature type still draws, and a half-built element never throws', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `
    el.map.features = [{ name: 'weird', type: 'not-a-real-glyph', start: 100, end: 900, strand: 1 }];`);
  const r = await page.evaluate(() => {
    const buf = [];
    _genemapDraw(freeformElements[0], _chartEmitSVG(buf));
    // an element with no map at all must be skipped silently, not crash the render
    addFreeformElement({ type: 'genemap', x: 10, y: 10, w: 100, h: 60 });
    render();
    return { ops: buf.length, drew: buf.some(s => /^<rect/.test(s)), n: freeformElements.length };
  });
  expect(r.ops).toBeGreaterThan(2);
  expect(r.drew).toBe(true);                      // falls back to a plain labelled box
  expect(r.n).toBe(2);
  expect(errors).toEqual([]);
});

test('double-clicking a gene map opens its editor', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `el.x = 100; el.y = 100; el.w = 400; el.h = 200;`);
  const open = await page.evaluate(() => {
    const c = document.getElementById('ann-canvas');
    const r = c.getBoundingClientRect();
    const lw = canvasLogicalW || c.width, lh = canvasLogicalH || c.height;
    c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true,
      clientX: r.left + 300 * r.width / lw, clientY: r.top + 200 * r.height / lh }));
    const on = document.getElementById('genemap-modal').classList.contains('open');
    closeGenemapModal();
    return on;
  });
  expect(open).toBe(true);
  expect(errors).toEqual([]);
});

test('the props bar shows the map controls and the live bp-per-pixel scale', async ({ page }) => {
  const errors = await loadApp(page);
  await addMap(page, 'linear', `el.w = 536;`);   // 5000 bp over 500 drawable px = 10 bp/px
  const r = await page.evaluate(() => {
    selectedElems.clear(); selectedElems.add(0);
    updateElemPropsBar();
    return {
      shown: document.getElementById('ep-genemap-props').style.display,
      chartHidden: document.getElementById('ep-chart-props').style.display,
      len: document.getElementById('ep-gm-length').value,
      topo: document.getElementById('ep-gm-topology').value,
      scale: document.getElementById('ep-gm-scale').textContent,
    };
  });
  expect(r.shown).toBe('flex');
  expect(r.chartHidden).toBe('none');
  expect(r.len).toBe('5000');
  expect(r.topo).toBe('linear');
  expect(r.scale).toBe('10.0 bp/px');
  expect(errors).toEqual([]);
});
