// @ts-check
// Tests for the v3.5 UX / integrity / export features.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('empty state shows initially, hides once images load', async ({ page }) => {
  const errors = await loadApp(page);
  const shown = await page.evaluate(() => {
    const e = document.getElementById('empty-state');
    return !!e && getComputedStyle(e).display !== 'none';
  });
  expect(shown).toBe(true);
  await seedPanels(page, 3);
  const hidden = await page.evaluate(
    () => getComputedStyle(document.getElementById('empty-state')).display === 'none'
  );
  expect(hidden).toBe(true);
  expect(errors).toEqual([]);
});

test('Simple/Advanced mode toggles advanced-control visibility, keeps core visible', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => applyUiMode('simple'));
  let advVisible = await page.evaluate(() => document.getElementById('scale-match-target').offsetParent !== null);
  expect(advVisible).toBe(false);                    // advanced hidden in Simple
  const dpiVisible = await page.evaluate(() => document.getElementById('export-dpi').offsetParent !== null);
  expect(dpiVisible).toBe(true);                     // core stays visible
  await page.evaluate(() => applyUiMode('advanced'));
  advVisible = await page.evaluate(() => document.getElementById('scale-match-target').offsetParent !== null);
  expect(advVisible).toBe(true);                     // revealed in Advanced
});

test('command palette opens and runs a command', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => openCmdPalette());
  expect(await page.evaluate(() => document.getElementById('cmd-palette').classList.contains('open'))).toBe(true);
  const n = await page.evaluate(() => {
    const i = document.getElementById('cmdp-input');
    i.value = 'theme'; i.dispatchEvent(new Event('input'));
    return document.querySelectorAll('#cmdp-list .cmdp-item').length;
  });
  expect(n).toBeGreaterThan(0);
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => { _cmdpSel = 0; _cmdpRun(); });   // run "Toggle theme"
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(after).not.toBe(before);
});

test('export preflight reports dimensions and a sub-300-DPI warning', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 2);
  await page.evaluate(() => { sv('export-dpi', '150'); doExportPreflight('tiff'); });
  const body = await page.evaluate(() => document.getElementById('preflight-body').innerText);
  expect(body).toMatch(/Pixel dimensions/);
  expect(body).toMatch(/Physical size/);
  expect(body).toMatch(/150 DPI is below/);
  await page.evaluate(() => closePreflight());
  expect(await page.evaluate(() => document.getElementById('preflight-modal').classList.contains('open'))).toBe(false);
});

test('CVD simulation filters the display only, never the export buffer', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 2);
  const sample = () => 'return document.getElementById("fig-canvas").getContext("2d").getImageData(0,0,4,4).data.join(",")';
  const before = await page.evaluate(new Function(sample()));
  await page.evaluate(() => setCvdMode('deuter'));
  const filter = await page.evaluate(() => document.getElementById('canvas-container').style.filter);
  expect(filter).toContain('cvd-deuter');
  const after = await page.evaluate(new Function(sample()));
  expect(after).toBe(before);                        // pixel buffer untouched
  expect(errors).toEqual([]);
});

test('help chips are present and carry tooltip copy', async ({ page }) => {
  await loadApp(page);
  const n = await page.evaluate(() => document.querySelectorAll('.help-chip').length);
  expect(n).toBeGreaterThanOrEqual(4);
  const hasTip = await page.evaluate(() => !!document.querySelector('.help-chip').getAttribute('data-tip'));
  expect(hasTip).toBe(true);
});

test('load example figure builds a labelled, calibrated 4-panel figure', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  expect(await page.evaluate(() => images.map(i => i.label))).toEqual(['A', 'B', 'C', 'D']);
  expect(await page.evaluate(() => images[0].umPerPx > 0 && images[0].sbOn)).toBe(true);
});

test('auto-arrange produces a balanced grid from the panel count', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  await page.evaluate(() => { sv('cols', 5); sv('rows', 5); onLayoutChange(); autoArrange(); });
  const dims = await page.evaluate(() => ({ cols: gi('cols'), rows: gi('rows') }));
  expect(dims).toEqual({ cols: 2, rows: 2 });
});

test('on-device AI caption preserves the rule-based caption when the model is not really available', async ({ page }) => {
  // Chromium exposes LanguageModel but only echoes the prompt; the echo guard must
  // reject that and keep the good structured caption rather than clobbering it.
  await loadApp(page);
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  const draft = await page.evaluate(() => { generateCaption(); return document.getElementById('caption-out').value; });
  await page.evaluate(async () => { await aiPolishCaption(); });
  const after = await page.evaluate(() => document.getElementById('caption-out').value);
  expect(after).toBe(draft);                 // never leaves a degenerate/echoed caption
  expect(after.startsWith('Figure.')).toBe(true);
});

test('submission package builds a valid multi-entry ZIP', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  const res = await page.evaluate(async () => {
    sv('export-dpi', '96');                       // keep the TIFF small for CI
    const realDl = window.dl; let zipUrl = null;
    window.dl = (url, name) => { if (String(name).endsWith('.zip')) zipUrl = url; else realDl(url, name); };
    await exportSubmissionPackage();
    window.dl = realDl;
    if (!zipUrl) return { error: 'no zip' };
    const buf = new Uint8Array(await (await fetch(zipUrl)).arrayBuffer());
    const dv = new DataView(buf.buffer);
    let e = buf.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;              // EOCD
    const total = dv.getUint16(e + 10, true);
    const localSigOK = dv.getUint32(0, true) === 0x04034b50;                 // first local header
    // collect central-directory names
    let cd = dv.getUint32(e + 16, true); const names = []; const dec = new TextDecoder();
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(cd, true) !== 0x02014b50) break;
      const nlen = dv.getUint16(cd + 28, true), elen = dv.getUint16(cd + 30, true), clen = dv.getUint16(cd + 32, true);
      names.push(dec.decode(buf.slice(cd + 46, cd + 46 + nlen)));
      cd += 46 + nlen + elen + clen;
    }
    return { total, localSigOK, names };
  });
  expect(res.error).toBeUndefined();
  expect(res.localSigOK).toBe(true);
  expect(res.total).toBeGreaterThanOrEqual(10);
  expect(res.names).toContain('README.txt');
  expect(res.names.some(n => n.endsWith('.tiff'))).toBe(true);
  expect(res.names.some(n => n.startsWith('panels/'))).toBe(true);
});

test('split-channel row explodes a multi-channel panel into channels + merge', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 3);
  const res = await page.evaluate(() => {
    images[0].lut = 'green';
    images[0].channels = [{ name: 'c2.png', img: images[1].img, src: images[1].src, lut: 'magenta', blackPt: 0, whitePt: 255 }];
    const before = images.length;
    splitChannelRow(0);
    return {
      grew: images.length - before,                 // +2 (1 panel -> 3)
      caps: images.slice(0, 3).map(i => i.captionNote),
      singleChannelsHaveNoChannels: images[0].channels.length === 0 && images[1].channels.length === 0,
      mergeKeepsChannels: images[2].channels.length === 1,
    };
  });
  expect(res.grew).toBe(2);
  expect(res.caps).toEqual(['GFP', 'RFP', 'Merge']);
  expect(res.singleChannelsHaveNoChannels).toBe(true);
  expect(res.mergeKeepsChannels).toBe(true);
});

test('matched panels: sync copies adjustments only within a group', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  const res = await page.evaluate(() => {
    images[0].group = 'g'; images[2].group = 'g';
    Object.assign(images[0], { brightness: 1.5, contrast: 1.3, gamma: 0.7, lut: 'fire', sbUm: 42 });
    syncGroupToPanel(0);
    return {
      synced: images[2].brightness === 1.5 && images[2].lut === 'fire' && images[2].sbUm === 42,
      untouched: images[1].lut !== 'fire' && images[1].brightness !== 1.5,
    };
  });
  expect(res.synced).toBe(true);
  expect(res.untouched).toBe(true);
});

test('import helpers: channel detection, auto-LUT, and natural sort', async ({ page }) => {
  await loadApp(page);
  const det = await page.evaluate(() => ({
    dapi: _detectChannel('cells_DAPI.tif') && _detectChannel('cells_DAPI.tif').lut,
    gfp: _detectChannel('img_GFP_488.png') && _detectChannel('img_GFP_488.png').lut,
    rfp: _detectChannel('s1_mCherry.png') && _detectChannel('s1_mCherry.png').lut,
    none: _detectChannel('random.png'),
  }));
  expect(det.dapi).toBe('blue');
  expect(det.gfp).toBe('green');
  expect(det.rfp).toBe('magenta');
  expect(det.none).toBeNull();
  // natural sort relabels positionally
  await page.evaluate(async () => { await loadExampleFigure(); });
  await page.waitForFunction(() => images.length === 4);
  const sorted = await page.evaluate(() => { sortImagesByName(); return { order: images.map(i => i.name), labels: images.map(i => i.label) }; });
  expect(sorted.labels).toEqual(['A', 'B', 'C', 'D']);
  expect(sorted.order[0]).toBe('actin_GFP.png');       // natural order
});

test('PowerPoint (.pptx) export is a valid OOXML package with well-formed XML', async ({ page }) => {
  await loadApp(page);
  await seedPanels(page, 4);
  const res = await page.evaluate(async () => {
    const realDl = window.dl; let url = null;
    window.dl = (u, n) => { if (String(n).endsWith('.pptx')) url = u; else realDl(u, n); };
    await exportPPTX();
    window.dl = realDl;
    if (!url) return { error: 'no pptx' };
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const dv = new DataView(buf.buffer); const dec = new TextDecoder();
    let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    const total = dv.getUint16(e + 10, true); let cd = dv.getUint32(e + 16, true);
    const names = []; const xml = {};
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(cd, true) !== 0x02014b50) break;
      const nlen = dv.getUint16(cd + 28, true), elen = dv.getUint16(cd + 30, true), clen = dv.getUint16(cd + 32, true);
      const lho = dv.getUint32(cd + 42, true);
      const name = dec.decode(buf.slice(cd + 46, cd + 46 + nlen)); names.push(name);
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true), csize = dv.getUint32(lho + 18, true);
      const ds = lho + 30 + lnlen + lelen;
      if (name.endsWith('.xml') || name.endsWith('.rels')) xml[name] = dec.decode(buf.slice(ds, ds + csize));
      cd += 46 + nlen + elen + clen;
    }
    const parser = new DOMParser(); const xmlErrors = [];
    for (const n in xml) if (parser.parseFromString(xml[n], 'application/xml').getElementsByTagName('parsererror').length) xmlErrors.push(n);
    return { total, names, xmlErrors, media: names.filter(n => n.startsWith('ppt/media/')).length };
  });
  expect(res.error).toBeUndefined();
  expect(res.names).toContain('[Content_Types].xml');
  expect(res.names).toContain('ppt/slides/slide1.xml');
  expect(res.media).toBe(4);              // one movable picture per panel
  expect(res.xmlErrors).toEqual([]);      // every XML part well-formed
});

test("What's New tab renders dated content and clears the update indicator", async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => { try { localStorage.setItem('fl-seen-version', '0.0'); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => typeof openWhatsNew === 'function');
  expect(await page.evaluate(() => document.getElementById('help-btn').classList.contains('has-new'))).toBe(true);
  await page.evaluate(() => openWhatsNew());
  const paneActive = await page.evaluate(() => document.getElementById('help-pane-whatsnew').classList.contains('active'));
  expect(paneActive).toBe(true);
  const cleared = await page.evaluate(() => !document.getElementById('help-btn').classList.contains('has-new'));
  expect(cleared).toBe(true);
});
