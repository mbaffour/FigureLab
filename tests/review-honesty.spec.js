// @ts-check
// Everything shipped to a journal (caption, metadata CSV, compliance report, package
// manifest, export pre-flight) must describe the panels the export actually draws.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

test('a spanning panel consumes its cells, so the panel it pushes out is not described', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    // one row of the compliance report by its label, not a regex over the whole text
    const complianceNote = (label) => {
      const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')]
        .find(el => el.querySelector('.c-label').textContent.trim() === label);
      return row ? row.querySelector('.c-note').textContent.trim() : 'ROW MISSING';
    };
    sv('cols', 2); sv('rows', 2); onLayoutChange();
    images.forEach(im => { im.captionNote = `note for ${im.name}`; im.sbOn = true; im.umPerPx = 0.5; });
    // A across the top: the renderer places A, B, C and has no cell left for D.
    images[0].colSpan = 2;
    // D is uncalibrated with its bar on; it is not drawn, so it must not fail the report.
    images[3].umPerPx = 0;
    render();

    let csv = '';
    const realBlobUrl = window.blobUrl, realDl = window.dl;
    window.blobUrl = t => { csv = t; return 'blob:stub'; };
    window.dl = () => {};
    exportCSV();
    window.blobUrl = realBlobUrl; window.dl = realDl;

    generateCaption();
    const caption = document.getElementById('caption-out').value;

    checkCompliance();
    const calib = complianceNote('Scale-bar calibration');
    const labels = complianceNote('Panel labels');
    document.querySelector('#info-modal-bg')?.remove();

    return {
      shown: _figurePanels().map(im => im.name),
      drawn: panelBounds.filter(p => p.idx >= 0 && images[p.idx]).map(p => images[p.idx].name),
      caption, calib, labels,
      csvNames: csv.split('\n').slice(1).filter(Boolean).map(l => l.split(',')[1]),
      manifestPanels: (_packageManifest('fig', 300, [], 'hash', []).match(/Panels\s*:\s*(\d+)/) || [])[1],
    };
  });
  // Without the fix _figurePanels sliced _gridOrder() to cols*rows = 4 entries and
  // returned all four panels, while the renderer (panelBounds) placed only three.
  expect(r.drawn).toEqual(['panel0.png', 'panel1.png', 'panel2.png']);
  expect(r.shown).toEqual(r.drawn);
  // Without the fix the caption carried D's note, the CSV had a fourth row and the
  // manifest said 4.
  expect(r.caption).toContain('note for panel0.png');
  expect(r.caption).toContain('note for panel2.png');
  expect(r.caption).not.toContain('note for panel3.png');
  expect(r.csvNames).toEqual(r.drawn);
  expect(r.manifestPanels).toBe('3');
  // Without the fix the label line read 4/4 and the calibration line failed on the
  // undrawn D ("1 scale bar(s) not calibrated").
  expect(r.labels).toMatch(/^3\/3 panels labelled/);
  expect(r.calib).toMatch(/^All calibrated/);
  expect(errors).toEqual([]);
});

test('a hidden panel does not fail the calibration, adjustment or inset lines, or the pre-flight', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const r = await page.evaluate(() => {
    const complianceNote = (label) => {
      const row = [...document.querySelectorAll('#info-modal-bg .compliance-row')]
        .find(el => el.querySelector('.c-label').textContent.trim() === label);
      return row ? row.querySelector('.c-note').textContent.trim() : 'ROW MISSING';
    };
    sv('cols', 2); sv('rows', 2); onLayoutChange();
    images.forEach(im => { im.sbOn = true; im.umPerPx = 0.5; });
    // Panel 2 is hidden, and is everything the report checks for: an uncalibrated bar,
    // an extreme brightness and an inset that lost its parent.
    Object.assign(images[1], { umPerPx: 0, brightness: 3, insetOrphaned: true });
    togglePanelExcluded(1);
    render();

    const read = () => {
      checkCompliance();
      const out = {
        calib: complianceNote('Scale-bar calibration'),
        adjust: complianceNote('Adjustment sanity'),
        insets: complianceNote('Linked insets'),
        preflight: '',
      };
      document.querySelector('#info-modal-bg')?.remove();
      doExportPreflight('png');
      out.preflight = document.getElementById('preflight-body').textContent;
      closePreflight();
      return out;
    };
    const hidden = read();
    // The inverse guard: the same panel SHOWN must still fail every one of them, so
    // the fix narrows what is counted rather than switching the checks off.
    togglePanelExcluded(1); render();
    const shown = read();
    return { hidden, shown };
  });
  // Without the fix each line walked all of images[] and flagged the hidden panel:
  // "1 scale bar(s) not calibrated", "1 panel(s) with extreme ...", "1 inset(s) lost
  // their parent", and the pre-flight's "1 panel(s) show a scale bar but aren't calibrated".
  expect(r.hidden.calib).toMatch(/^All calibrated/);
  expect(r.hidden.adjust).toMatch(/^Within normal range/);
  expect(r.hidden.insets).toBe('None');
  expect(r.hidden.preflight).not.toContain("aren't calibrated");
  expect(r.shown.calib).toMatch(/^1 scale bar\(s\) not calibrated/);
  expect(r.shown.adjust).toMatch(/^1 panel\(s\) with extreme/);
  expect(r.shown.insets).toMatch(/^1 inset\(s\) lost their parent/);
  expect(r.shown.preflight).toContain("1 panel(s) show a scale bar but aren't calibrated");
  expect(errors).toEqual([]);
});

test('Calibrate in the compliance report opens the first SHOWN uncalibrated panel', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 4);
  const opened = await page.evaluate(() => {
    sv('cols', 2); sv('rows', 2); onLayoutChange();
    images.forEach(im => { im.sbOn = true; im.umPerPx = 0.5; });
    images[0].umPerPx = 0; togglePanelExcluded(0);   // hidden, uncalibrated, lower index
    images[2].umPerPx = 0;                           // shown, uncalibrated
    render();
    const calls = [];
    const real = window.openCalib;
    window.openCalib = idx => calls.push(idx);
    _auditFix('calibrate');
    window.openCalib = real;
    return calls;
  });
  // Without the fix findIndex walked all of images[] and opened panel 0, which is
  // hidden and which the report (now) does not count.
  expect(opened).toEqual([2]);
  expect(errors).toEqual([]);
});
