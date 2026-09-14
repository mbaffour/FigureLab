// @ts-check
// Acquisition time: read it from the file, never infer it.
//
// A time-lapse arrives as a multi-page TIFF and becomes a row of panels; the times the
// microscope recorded are sitting in the metadata, and typing them back in by hand is
// both tedious and a chance to get a legend wrong. Three sources, each in its own
// fixture so a failure names the reader that broke — see make_time_fixtures.py.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');
const fs = require('fs'), path = require('path');

const FX = path.join(__dirname, 'fixtures', 'tiff');
const man = JSON.parse(fs.readFileSync(path.join(FX, 'time_manifest.json'), 'utf8'));
const bytes = (n) => Array.from(fs.readFileSync(path.join(FX, n + '.tif')));

/** Import a TIFF through the real drop path and wait for its panels to land. */
async function importTiff(page, name, expectPanels) {
  await page.evaluate(async ({ b, expectPanels }) => {
    const before = images.length;
    addFiles([new File([new Uint8Array(b)], 'series.tif', { type: 'image/tiff' })]);
    await new Promise(res => {
      const iv = setInterval(() => {
        if (images.length >= before + expectPanels || (cropEdState && cropEdState._preCrop)) { clearInterval(iv); res(); }
      }, 30);
      setTimeout(() => { clearInterval(iv); res(); }, 8000);
    });
    if (cropEdState && cropEdState._preCrop) skipPreCrop();     // single page → pre-crop modal
    await new Promise(r => setTimeout(r, 200));
  }, { b: bytes(name), expectPanels });
}

test('the decoder reads DeltaT per plane, honours its unit, derives one from an ImageJ frame interval, and reads a bare DateTime', async ({ page }) => {
  await loadApp(page);
  const failures = [];
  for (const [name, exp] of Object.entries(man)) {
    for (let p = 0; p < exp.pages; p++) {
      const r = await page.evaluate(async ({ b, p }) => {
        const d = await decodeTIFF(new Uint8Array(b), p);
        return { deltaT: d.deltaT, acqTime: d.acqTime, src: d.timeSource, pages: d.pages };
      }, { b: bytes(name), p });
      const where = `${name} p${p}`;
      if (r.pages !== exp.pages) failures.push(`${where}: ${r.pages} pages != ${exp.pages}`);
      if (exp.deltaT) {
        if (Math.abs((r.deltaT ?? NaN) - exp.deltaT[p]) > 1e-6) failures.push(`${where}: deltaT ${r.deltaT} != ${exp.deltaT[p]}`);
      } else if (r.deltaT != null) failures.push(`${where}: deltaT ${r.deltaT}, expected none`);
      if (exp.acqTimeISO) {
        const got = r.acqTime == null ? null : new Date(r.acqTime).toISOString();
        if (got !== exp.acqTimeISO) failures.push(`${where}: acqTime ${got} != ${exp.acqTimeISO}`);
      }
      if ((r.src || '') !== exp.source) failures.push(`${where}: source "${r.src}" != "${exp.source}"`);
    }
  }
  expect(failures).toEqual([]);
});

test('importing an OME time series tags its panels with the elapsed time, in the unit that keeps the numbers small', async ({ page }) => {
  const errors = await loadApp(page);
  await importTiff(page, 'time_ome.ome', 3);
  const r = await page.evaluate(() => {
    sv('cols', '3'); sv('rows', '1'); onLayoutChange();
    const stored = images.map(im => [im._metaDeltaT, im._metaTimeSource]);
    tagPanelsFromAcquisition();
    render();
    return { stored, tags: images.map(im => im.tag), shown: figTextItems.filter(t => t.kind === 'tag').map(t => t.str),
             on: document.getElementById('show-tags').checked, logged: reproLog.filter(e => e.action === 'tagFromAcquisition').pop() };
  });
  expect(r.stored).toEqual([[0, 'OME Plane DeltaT'], [300, 'OME Plane DeltaT'], [600, 'OME Plane DeltaT']]);
  expect(r.tags).toEqual(['0 min', '5 min', '10 min']);        // 600 s span → minutes
  expect(r.shown).toEqual(['0 min', '5 min', '10 min']);        // and they are on the figure
  expect(r.on).toBe(true);
  expect(r.logged.unit).toBe('min');
  expect(r.logged.source).toBe('OME Plane DeltaT');
  expect(errors).toEqual([]);
});

test('a short ImageJ interval is tagged in seconds, and an undo puts the tags back', async ({ page }) => {
  const errors = await loadApp(page);
  await importTiff(page, 'time_imagej', 3);
  const r = await page.evaluate(() => {
    sv('cols', '3'); sv('rows', '1'); onLayoutChange();
    images[1].tag = 'keep me';
    tagPanelsFromAcquisition();
    const tags = images.map(im => im.tag);
    undo();
    return { tags, undone: images.map(im => im.tag || '') };
  });
  expect(r.tags).toEqual(['0 s', '2.5 s', '5 s']);              // 5 s span → seconds
  expect(r.undone).toEqual(['', 'keep me', '']);
  expect(errors).toEqual([]);
});

test('two separate captures are related by their absolute DateTime, and a file with no time is left alone', async ({ page }) => {
  const errors = await loadApp(page);
  await importTiff(page, 'time_datetime', 1);
  await importTiff(page, 'time_datetime_later', 1);
  await importTiff(page, 'time_none', 1);
  const r = await page.evaluate(() => {
    sv('cols', '3'); sv('rows', '1'); onLayoutChange();
    const meta = images.map(im => [im._metaDeltaT, im._metaAcqTime == null ? null : new Date(im._metaAcqTime).toISOString()]);
    tagPanelsFromAcquisition();
    const logged = reproLog.filter(e => e.action === 'tagFromAcquisition').pop();
    return { meta, tags: images.map(im => im.tag || ''), skipped: logged.skipped, unit: logged.unit };
  });
  expect(r.meta[0]).toEqual([null, '2026-09-14T10:23:45.000Z']);
  expect(r.meta[2]).toEqual([null, null]);
  expect(r.tags).toEqual(['0 min', '15 min', '']);              // 15 minutes apart; the untimed panel keeps its empty tag
  expect(r.skipped).toBe(1);
  expect(r.unit).toBe('min');
  expect(errors).toEqual([]);
});

test('panels that record time differently are refused rather than given a made-up zero', async ({ page }) => {
  const errors = await loadApp(page);
  await importTiff(page, 'time_ome.ome', 3);                    // relative DeltaT
  await importTiff(page, 'time_datetime', 1);                   // absolute DateTime
  const r = await page.evaluate(() => {
    sv('cols', '4'); sv('rows', '1'); onLayoutChange();
    tagPanelsFromAcquisition();
    return { tags: images.map(im => im.tag || ''), ran: reproLog.filter(e => e.action === 'tagFromAcquisition').length };
  });
  expect(r.tags).toEqual(['', '', '', '']);
  expect(r.ran).toBe(0);
  expect(errors).toEqual([]);
});

test('the metadata CSV records the acquisition time as it was read', async ({ page }) => {
  const errors = await loadApp(page);
  await importTiff(page, 'time_ome.ome', 3);
  const r = await page.evaluate(async () => {
    sv('cols', '3'); sv('rows', '1'); onLayoutChange();
    let url = null; const realDl = window.dl; window.dl = (u) => { url = u; };
    try { exportCSV(); } finally { window.dl = realDl; }
    const csv = await (await fetch(url)).text();
    const [head, ...rows] = csv.trim().split('\n');
    const col = head.split(',').indexOf('AcquisitionTime');
    return { col, vals: rows.map(l => l.split(',')[col]) };
  });
  expect(r.col).toBeGreaterThan(0);
  expect(r.vals).toEqual(['"+0 s"', '"+300 s"', '"+600 s"']);
  expect(errors).toEqual([]);
});
