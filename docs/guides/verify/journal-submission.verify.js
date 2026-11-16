// Verifies docs/guides/journal-submission.md through the visible UI: journal presets,
// the compliance report and its fix buttons, the legend key, caption / Methods / alt text,
// the image-reuse checks, the submission package, saving and reopening a session, and a
// revision (replace an image, swap panels, change journal, re-export).
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

// The compliance report as data: title, rows ({icon, label, note}) and fix buttons.
async function report(T) {
  const p = T.page;
  await L.openSection(T, 'Check');
  await btn(T, '✓ Check journal compliance').click();
  const m = p.locator('#info-modal-bg');
  await m.waitFor({ state: 'visible' });
  await p.waitForTimeout(400);
  return readReport(T);
}
async function readReport(T) {
  return T.page.locator('#info-modal-bg').evaluate(m => ({
    title: (m.querySelector('#im-title') || {}).textContent || '',
    rows: [...m.querySelectorAll('.compliance-row')].map(r => ({
      icon: (r.querySelector('.c-icon') || {}).textContent?.trim(),
      label: (r.querySelector('.c-label') || {}).textContent?.trim(),
      note: (r.querySelector('.c-note') || {}).textContent?.trim() })),
    buttons: [...m.querySelectorAll('button')].map(b => b.innerText.trim()),
  }));
}
const row = (R, label) => R.rows.find(r => r.label === label) || { icon: '', note: '(no row)' };
async function closeReport(T) { await T.page.keyboard.press('Escape'); await T.page.waitForTimeout(250); }

// A panel's card in the image list (0-based), opening its ⚙ settings if asked.
async function card(T, i, { open = false } = {}) {
  const c = T.page.locator('#img-list .img-item').nth(i);
  if (open && !(await c.locator('input.f-cap').isVisible())) { await c.locator('button.gear').click(); await T.page.waitForTimeout(300); }
  return c;
}

(async () => {
  const T = await L.start('journal-submission');
  const p = T.page;
  await T.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const inp = path.join(T.out, 'inputs');
  // A plate photo with camera noise (a noise-free drawing is not a fair test of the reuse check).
  const plate = await L.canvasImage(T, path.join(inp, 'IMG_4412_plate_MG1655.jpg'), 1000, 1000, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#1d1d1f'; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = w * 0.42;
    ctx.fillStyle = '#d9cfa8'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 8; ctx.stroke();
    for (let i = 0; i < 40; i++) {
      let x, y; do { x = cx + (rnd() * 2 - 1) * R; y = cy + (rnd() * 2 - 1) * R; } while (Math.hypot(x - cx, y - cy) > R * 0.85);
      ctx.fillStyle = '#6f6852'; ctx.beginPath(); ctx.arc(x, y, 7 + rnd() * 6, 0, 7); ctx.fill();
    }
    const im = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < im.data.length; i += 4) { const n = (rnd() - 0.5) * 36; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
    ctx.putImageData(im, 0, 0);
  }, { type: 'image/jpeg', seed: 4 });
  const files = [
    I.fluorTiff(path.join(inp, 'C1-HeLa_DMSO_DAPI.tif'), 'DAPI'),
    I.fluorTiff(path.join(inp, 'C2-HeLa_DMSO_GFP.tif'), 'GFP'),
    I.blotTiff(path.join(inp, 'PhoA_blot.tif')),
    plate,
  ];
  // For the reuse check: panel A's picture mirrored, saved as if exported from Figure 1,
  // and a different blot with the same lane layout (another figure's blot).
  const mirrored = await L.canvasImage(T, path.join(inp, 'Fig1_panelC_DAPI.png'), 512, 512, () => {}, {});
  const otherBlot = I.blotTiff(path.join(inp, 'Fig4_PhoB_blot.tif'), { seed: 77, amounts: [0.5, 1, 0.5, 1, 0.5, 1] });
  const rerun = I.blotTiff(path.join(inp, 'PhoA_blot_rerun.tif'), { seed: 12, tiltDeg: -0.5 });

  // ------------------------------------------------------------------ set-up
  await step(T, 'Set-up: add four images, 🎨 Auto-channels, Arrange 2 × 2, File name "Figure 2"', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), files);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 15000 });
    await p.getByText('Got it', { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
    await btn(T, 'Auto-channels').click();
    await L.openSection(T, 'Arrange');
    await p.locator('#cols').fill('2'); await p.locator('#cols').press('Tab');
    await p.locator('#rows').fill('2'); await p.locator('#rows').press('Tab');
    await L.openSection(T, 'Export');
    await p.locator('#export-name').fill('Figure 2'); await p.locator('#export-name').press('Tab');
    await p.waitForTimeout(400);
    // the mirrored copy of panel A, made from the app's own rendering of the source would be
    // circular; build it from the TIFF samples instead
    const src = await p.evaluate(() => { const im = images[0]; const c = document.createElement('canvas'); c.width = im.img.naturalWidth || im.img.width; c.height = im.img.naturalHeight || im.img.height;
      const x = c.getContext('2d'); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(im.img, 0, 0); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(mirrored, Buffer.from(src, 'base64'));
    const kt = await p.locator('#key-text').inputValue();
    expect(/DAPI \(blue\); GFP \(green\)/.test(kt), 'key text: ' + kt);
    return kt;
  });

  // ------------------------------------------------------------------ 1. journal presets
  await step(T, '1.1 Look › Target journal › PLOS ONE: width, LZW, file name Fig2, text sizes', async () => {
    await L.toasts(T);
    await L.openSection(T, 'Look');
    await p.locator('#target-journal').selectOption({ label: 'PLOS ONE' });
    await p.waitForTimeout(600);
    const st = await p.evaluate(() => ({ w: document.getElementById('export-width-mm').value, lzw: document.getElementById('export-tiff-lzw').checked,
      name: document.getElementById('export-name').value, font: document.getElementById('label-font').value, text: document.getElementById('text-pt').value,
      lab: document.getElementById('label-pt').value, dpi: document.getElementById('export-dpi').value }));
    const t = await L.toasts(T);
    expect(st.lzw && st.name === 'Fig2' && +st.w > 0 && +st.w <= 190.5, JSON.stringify(st));
    return `${st.w} mm, ${st.dpi} dpi, LZW ${st.lzw}, name ${st.name}, letters ${st.lab} pt, text ${st.text} pt — toast: ${t}`;
  });

  await step(T, '1.2 ⌘K "journal" lists one "Journal: …" row per journal and "Check against …" rows', async () => {
    const hits = await L.cmdk(T, 'journal', { enter: false });
    expect(hits.filter(h => /^Journal: /.test(h)).length >= 6, hits.join(' / '));
    return hits.slice(0, 3).join(' / ');
  });

  // ux2: typing a journal's bare name used to put "Add box plot" first for "plos", and Enter
  // added a chart panel. A journal's name or abbreviation now finds its preset.
  await step(T, '1.2b ⌘K "plos" → Enter applies the PLOS ONE preset (no chart panel added); "nat comms" says there is no preset', async () => {
    await L.toasts(T);
    const hits = await L.cmdk(T, 'plos');
    await p.waitForTimeout(400);
    const t = await L.toasts(T);
    const n = await p.evaluate(() => images.filter(Boolean).length);
    expect(/^Journal: PLOS ONE/.test(hits[0]) && n === 4 && /PLOS ONE preset applied/.test(t), hits[0] + ' | ' + n + ' panels | ' + t);
    const h2 = await L.cmdk(T, 'nat comms');
    await p.waitForTimeout(300);
    const t2 = await L.toasts(T);
    await p.keyboard.press('Escape');
    expect(/^Journal: no preset for Nature Communications/.test(h2[0]) && /no Nature Communications preset/.test(t2) && await p.locator('#target-journal').inputValue() === 'plos', h2[0] + ' | ' + t2);
    return `plos → ${hits[0]} (${t}); nat comms → "${t2.slice(0, 70)}…"`;
  });

  // ux2 (was ISSUES.md): the Nature preset kept 183 mm on this 2 × 2 figure although it then
  // printed 177.5 mm tall (Nature allows 170 mm). The preset now picks the widest width that
  // fits and says so; a wider width chosen afterwards fails the row, whose button narrows it.
  await step(T, '1.3 ⌘K "Journal: Nature": the preset picks 89 mm for a 2 × 2; at 183 mm Printed height fails and "Set 89 mm" fixes it', async () => {
    const hits = await L.cmdk(T, 'Journal: Nature');
    expect(/^Journal: Nature/.test(hits[0]), hits[0]);
    await p.waitForTimeout(500);
    const t = await L.toasts(T);
    expect(/89 mm wide — the widest that keeps it within 170 mm tall/.test(t), 'toast: ' + t);
    let R = await report(T);
    const h0 = row(R, 'Printed height');
    expect(h0.icon === '✓', 'Printed height after the preset: ' + h0.note);
    await closeReport(T);
    await L.openSection(T, 'Export');
    await p.locator('#export-width-mm').selectOption({ label: '183 mm — double column (Nature; eLife preset)' });
    await p.waitForTimeout(400);
    R = await report(T);
    const h1 = row(R, 'Printed height');
    expect(h1.icon === '✗' && R.buttons.includes('Set 89 mm'), 'Printed height at 183 mm: ' + h1.note + ' | ' + R.buttons.join('|'));
    await p.locator('#info-modal-bg .compliance-row', { hasText: 'Printed height' }).getByRole('button', { name: 'Set 89 mm' }).click();
    await p.waitForTimeout(500);
    R = await readReport(T);
    const h2 = row(R, 'Printed height');
    expect(h2.icon === '✓', 'after Set 89 mm: ' + h2.note);
    return `preset: ${h0.icon} ${h0.note.split('Source')[0]} → at 183 mm: ${h1.icon} → Set 89 mm: ${h2.icon} (toast: ${t})`;
  });

  await step(T, '1.3b Nature report: "Alt text" opens the ALT TEXT box; ✦ Draft from figure fills it and the row passes', async () => {
    let R = await readReport(T);
    expect(R.buttons.includes('Alt text') && row(R, 'Alt text').icon !== '✓', R.buttons.join('|'));
    await p.locator('#info-modal-bg button', { hasText: 'Alt text' }).click();
    await p.waitForTimeout(600);
    const focus = await p.evaluate(() => document.activeElement && document.activeElement.id);
    await btn(T, '✦ Draft from figure').click();
    await p.waitForFunction(() => document.getElementById('alt-text').value.length > 20, null, { timeout: 5000 });
    const alt = await p.locator('#alt-text').inputValue();
    R = await report(T);
    const ok = row(R, 'Alt text').icon === '✓';
    await closeReport(T);
    expect(ok, row(R, 'Alt text').note);
    return `focus #${focus}; ${alt.length} characters: "${alt.slice(0, 70)}…"`;
  });

  await step(T, '1.4 Back to PLOS ONE with Look › the PLOS preset button', async () => {
    await L.openSection(T, 'Look');
    await btn(T, /^PLOS$/).click();
    await p.waitForTimeout(500);
    const j = await p.locator('#target-journal').inputValue();
    expect(j === 'plos', j);
    return await L.toasts(T);
  });

  // ------------------------------------------------------------------ 2. compliance
  await step(T, '2.1 ✓ Check journal compliance: ✓/⚠/✗/ℹ rows; ℹ rows are not counted as passed', async () => {
    const R = await report(T);
    await L.shot(T, 'journal-compliance', p.locator('#info-modal-bg').locator('xpath=./*[1]'), { doc: true });
    const m = R.title.match(/(\d+)\/(\d+) passed/);
    const ticks = R.rows.filter(r => r.icon === '✓').length, infos = R.rows.filter(r => r.icon === 'ℹ').length;
    expect(m && +m[1] === ticks, `title ${R.title} but ${ticks} ✓ rows`);
    expect(+m[2] === R.rows.length - infos, `${m[2]} counted vs ${R.rows.length} rows, ${infos} ℹ`);
    expect(R.rows.some(r => r.icon === 'ℹ' && /Does not apply|Not run|not checked/.test(r.note)), 'no "Does not apply"/"Not run" row');
    await closeReport(T);
    return `${R.title}; ${infos} ℹ rows (e.g. ${R.rows.filter(r => r.icon === 'ℹ').map(r => r.label).join(', ')})`;
  });

  await step(T, '2.2 Text size: Typography › Text size 3 pt fails; "Fit 8–12 pt" raises it', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#text-pt').fill('3'); await p.locator('#text-pt').press('Tab');
    await p.waitForTimeout(300);
    let R = await report(T);
    const fit = R.buttons.find(b => /^Fit /.test(b));
    expect(fit && row(R, 'Text size').icon !== '✓', 'no Fit button: ' + R.buttons.join('|'));
    await p.locator('#info-modal-bg button', { hasText: fit }).first().click();
    await p.waitForTimeout(600);
    R = await readReport(T);
    expect(row(R, 'Text size').icon === '✓', 'after Fit: ' + row(R, 'Text size').note);
    await closeReport(T);
    return `${fit} → Text size ${await p.locator('#text-pt').inputValue()} pt`;
  });

  await step(T, '2.3 With Target journal None, the same row offers "Raise to 6 pt"', async () => {
    await L.openSection(T, 'Look');
    await p.locator('#target-journal').selectOption({ label: 'None / general' });
    await p.locator('#text-pt').fill('3'); await p.locator('#text-pt').press('Tab');
    let R = await report(T);
    expect(R.buttons.includes('Raise to 6 pt'), R.buttons.join('|'));
    await p.locator('#info-modal-bg button', { hasText: 'Raise to 6 pt' }).click();
    await p.waitForTimeout(500);
    const pt = await p.locator('#text-pt').inputValue();
    await closeReport(T);
    await L.openSection(T, 'Look');
    await p.locator('#target-journal').selectOption({ label: 'PLOS ONE' });
    await p.waitForTimeout(500);
    expect(+pt === 6, 'text pt ' + pt);
    return 'Text size → 6 pt; Target journal back to PLOS ONE (' + await p.locator('#text-pt').inputValue() + ' pt)';
  });

  await step(T, '2.4 A scale bar switched on over an uncalibrated photo: "No scale bar on these" clears it', async () => {
    const c = await card(T, 3, { open: true });
    await c.locator('input.f-sb-on').check();
    await p.waitForTimeout(300);
    let R = await report(T);
    const before = row(R, 'Scale-bar calibration');
    expect(before.icon !== '✓' && R.buttons.includes('No scale bar on these') && R.buttons.includes('Calibrate…'), before.note + ' | ' + R.buttons.join('|'));
    await p.locator('#info-modal-bg button', { hasText: 'No scale bar on these' }).click();
    await p.waitForTimeout(500);
    R = await readReport(T);
    expect(row(R, 'Scale-bar calibration').icon === '✓', row(R, 'Scale-bar calibration').note);
    await closeReport(T);
    return before.note.slice(0, 90) + '… → ' + row(R, 'Scale-bar calibration').note;
  });

  // ux2: the row's Auto contrast button used to change nothing while Background was ticked.
  await step(T, '2.5 Text contrast: the row\'s Auto contrast button fixes it with Background still ticked', async () => {
    let R = await report(T);
    const before = row(R, 'Text contrast');
    expect(before.icon !== '✓' && R.buttons.includes('Auto contrast'), 'Text contrast: ' + before.icon + ' ' + before.note.slice(0, 80) + ' | ' + R.buttons.join('|'));
    await p.locator('#info-modal-bg .compliance-row', { hasText: 'Text contrast' }).getByRole('button', { name: 'Auto contrast' }).click();
    await p.waitForTimeout(600);
    const t = await p.locator('#toast').textContent();
    R = await readReport(T);
    const after = row(R, 'Text contrast');
    await closeReport(T);
    expect(after.icon === '✓' && await p.locator('#label-bg').isChecked(), after.icon + ' ' + after.note.slice(0, 120));
    return `before ${before.icon} ${before.note.split(' — ')[0]} → after ${after.icon}; toast: ${t.slice(0, 120)}`;
  });

  await step(T, '2.6 "Select panel" on Panel resolution selects the low-ppi panel', async () => {
    const R = await report(T);
    const pr = row(R, 'Panel resolution');
    if (!R.buttons.includes('Select panel')) { await closeReport(T); return 'no low-ppi panel: ' + pr.note.slice(0, 80); }
    await p.locator('#info-modal-bg button', { hasText: 'Select panel' }).first().click();
    await p.waitForTimeout(500);
    const sel = await p.evaluate(() => (typeof selectedPanel !== 'undefined' ? selectedPanel : null));
    if (await p.locator('#info-modal-bg').isVisible()) await closeReport(T);
    return pr.note.split('—')[0] + '; selected panel index ' + sel;
  });

  // ------------------------------------------------------------------ 3. legend key
  await step(T, '3.1 Export › Legend key: Place the key on the figure, rename a channel, Copy the text starter', async () => {
    await L.openSection(T, 'Export');
    await L.toasts(T);
    await p.locator('#key-on-figure').check();
    await p.waitForTimeout(600);
    const placed = await L.toasts(T);
    const where = await p.locator('#key-where').evaluate(s => [...s.options].map(o => o.text));
    expect(where.join('|') === 'Free space|Top right|Top left|Bottom right|Bottom left|Right edge|Below', where.join('|'));
    let R = await report(T);
    const kr = row(R, 'Legend key on the figure');
    await closeReport(T);
    expect(kr.icon === '✓' && /in free space/.test(kr.note), 'key row: ' + kr.icon + ' ' + kr.note);
    await L.openSection(T, 'Export');
    await p.getByLabel('Name of the green channel').fill('GFP-LC3');
    await p.getByLabel('Name of the green channel').press('Tab');
    await p.waitForTimeout(500);
    const kt = await p.locator('#key-text').inputValue();
    expect(kt === 'DAPI (blue); GFP-LC3 (green).', kt);
    await p.locator('#key-text').locator('xpath=preceding::button[1]').click();
    await p.waitForTimeout(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    expect(clip === kt, 'clipboard: ' + clip);
    return `${kt} (copied) | placed: ${placed || '(no toast)'} | row: ${kr.note.slice(0, 70)}`;
  });

  // ux2: a key dragged by hand stays where it is put; the check flags it if it covers
  // something, and the row's button puts it back in free space.
  await step(T, '3.1b Annotate & Draw › ↖ Select, drag the key onto panel A: it stays; the "Legend key on the figure" row warns; Move to free space fixes it', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, /^↖ Select$/).click();
    const c = p.locator('#ann-canvas'), cr = await c.boundingBox();
    const k = await p.evaluate(() => { const a = annotations.find(x => x && x.type === 'legend'); return { xf: a.xf, yf: a.yf }; });
    const b = await p.evaluate(() => panelBounds.find(x => (x.idx ?? x.i) === 0));
    const fc = await p.locator('#fig-canvas').boundingBox();
    const x0 = cr.x + k.xf * cr.width + 6, y0 = cr.y + k.yf * cr.height + 6;
    const x1 = fc.x + b.x + 10, y1 = fc.y + b.y + 10;
    await p.mouse.move(x0, y0); await p.mouse.down();
    for (let i = 1; i <= 15; i++) { await p.mouse.move(x0 + (x1 - x0) * i / 15, y0 + (y1 - y0) * i / 15); await p.waitForTimeout(20); }
    await p.mouse.up(); await p.waitForTimeout(400);
    const moved = await p.evaluate(() => annotations.find(x => x && x.type === 'legend').auto);
    expect(moved === false, 'the key was not moved by hand (auto ' + moved + ')');
    let R = await report(T);
    const r1 = row(R, 'Legend key on the figure');
    expect(r1.icon === '⚠' && /key you moved covers/.test(r1.note) && R.buttons.includes('Move to free space'), r1.icon + ' ' + r1.note);
    await p.locator('#info-modal-bg .compliance-row', { hasText: 'Legend key on the figure' }).getByRole('button', { name: 'Move to free space' }).click();
    await p.waitForTimeout(600);
    R = await readReport(T);
    const r2 = row(R, 'Legend key on the figure');
    await closeReport(T);
    await p.keyboard.press('Escape');
    expect(r2.icon === '✓', r2.note);
    return `dragged: ${r1.icon} ${r1.note.split(' — ')[0]} → Move to free space: ${r2.icon}`;
  });

  await step(T, '3.2 ⬇ Download key: written in the last export format (PNG before any export)', async () => {
    const label = await p.locator('#key-dl-btn').innerText();
    const f = await L.download(T, () => p.locator('#key-dl-btn').click(), /-key\.png$/);
    const info = L.pngInfo(fs.readFileSync(f));
    expect(/\(PNG\)/.test(label) && info.w > 20, label + ' ' + JSON.stringify(info));
    return `${label} → ${path.basename(f)} ${info.w}×${info.h} px`;
  });

  // ------------------------------------------------------------------ 4. caption, Methods
  await step(T, '4.1 ⚙ › Caption note (not rendered) on C and D, then ✦ Generate Caption names them', async () => {
    const c = await card(T, 2, { open: true });
    await c.locator('input.f-cap').fill('PhoA western blot; WT and ΔphoA, ± IPTG');
    await c.locator('input.f-cap').press('Enter');
    const d = await card(T, 3, { open: true });
    await d.locator('input.f-cap').fill('Plaques of phiGuide on E. coli MG1655');
    await d.locator('input.f-cap').press('Enter');
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click();
    await p.waitForTimeout(500);
    const cap = await p.locator('#caption-out').inputValue();
    expect(/\(C\) PhoA western blot/.test(cap) && /\(D\) Plaques/.test(cap) && /\(A\) DAPI/.test(cap), cap);
    return cap.slice(0, 120) + '…';
  });

  await step(T, '4.2 ✎ Write Methods paragraph states display ranges and calibration', async () => {
    await btn(T, '✎ Write Methods paragraph').click();
    await p.waitForTimeout(500);
    const m = await p.locator('#methods-out').inputValue();
    expect(/display ranges in native values/.test(m) && /ImageJ metadata/.test(m), m.slice(0, 200));
    return m.length + ' characters';
  });

  await step(T, '4.3 An edited caption is kept; a later change shows "⚠ The figure has changed…"', async () => {
    const cap = await p.locator('#caption-out').inputValue();
    await p.locator('#caption-out').fill(cap + ' Representative of three experiments.');
    const d = await card(T, 3, { open: true });
    await d.locator('input.f-cap').fill('Plaques of phiGuide on E. coli MG1655 (1e-6 dilution)');
    await d.locator('input.f-cap').press('Enter');
    await btn(T, '⟳ Render').click();
    await p.waitForTimeout(900);
    const stale = p.locator('#caption-stale');
    expect(await stale.isVisible(), 'no out-of-date flag');
    const kept = await p.locator('#caption-out').inputValue();
    expect(/three experiments/.test(kept), 'edit lost');
    return (await stale.innerText()).trim();
  });

  await step(T, '4.3b Keep mine on the flag keeps your caption and hides the flag', async () => {
    await p.locator('#caption-stale').getByText('Keep mine').click();
    await p.waitForTimeout(300);
    const kept = await p.locator('#caption-out').inputValue();
    expect(/three experiments/.test(kept) && !(await p.locator('#caption-stale').isVisible()), 'flag still shown or edit lost');
    return 'flag hidden, edit kept';
  });

  // ux2: ✦ Generate Caption used to replace an edited caption without asking.
  await step(T, '4.4 ✦ Generate Caption on an edited caption asks "Replace your caption?": Keep mine keeps it, Replace brings it up to date', async () => {
    await btn(T, '✦ Generate Caption').click();
    const cm = p.locator('#confirm-modal-bg');
    await cm.waitFor({ state: 'visible' });
    const ask = (await cm.innerText()).replace(/\s+/g, ' ').trim();
    expect(/Replace your caption\?/.test(ask) && await cm.getByRole('button', { name: 'Keep mine' }).isVisible(), ask);
    await cm.getByRole('button', { name: 'Keep mine' }).click(); await p.waitForTimeout(300);
    expect(/three experiments/.test(await p.locator('#caption-out').inputValue()), 'Keep mine lost the edit');
    await btn(T, '✦ Generate Caption').click();
    await cm.waitFor({ state: 'visible' });
    await cm.getByRole('button', { name: /^Replace$/ }).click(); await p.waitForTimeout(500);
    const cap = await p.locator('#caption-out').inputValue();
    expect(/1e-6 dilution/.test(cap) && !/three experiments/.test(cap) && !(await p.locator('#caption-stale').isVisible()), cap.slice(-120));
    return ask.slice(0, 150);
  });

  // ------------------------------------------------------------------ 5. reuse checks
  await step(T, '5.1 ⎘ Duplicate a panel, 🧬 Duplication check finds the copy; × removes it', async () => {
    const b = await card(T, 1);
    await b.locator('button[title=Duplicate]').click();
    await p.waitForTimeout(600);
    await L.openSection(T, 'Check');
    await btn(T, '🧬 Duplication check').click();
    const m = p.locator('.modal-bg.open').last();
    await m.getByText('Whole panels', { exact: true }).first().waitFor({ timeout: 20000 });
    const t = await m.innerText();
    const hit = (t.match(/Whole panels\n✗\n([^\n]*)/) || [])[1];
    expect(hit && /fine detail matches/.test(hit), 'whole-panel row: ' + t.slice(0, 600));
    await m.locator('button', { hasText: /^(Close|×)$/ }).last().click().catch(() => p.keyboard.press('Escape'));
    await p.waitForTimeout(300);
    // remove the copy (the third card, right after B)
    await (await card(T, 2)).locator('button.del').click();
    const conf = p.locator('#confirm-modal-bg');
    if (await conf.isVisible().catch(() => false)) await conf.locator('button', { hasText: 'Confirm' }).click();
    await p.waitForTimeout(500);
    const n = await p.evaluate(() => images.filter(Boolean).length);
    expect(n === 4, n + ' panels');
    return hit;
  });

  await step(T, '5.2 🧬 Check against other figures…: a mirrored copy is ✗; a same-layout blot is "similar layout"', async () => {
    await btn(T, '🧬 Check against other figures…').click();
    const m = p.locator('#xdup-modal-bg');
    await m.waitFor({ state: 'visible' });
    await L.pickFiles(T, m.getByText('choose files…'), [mirrored, otherBlot]);
    await m.locator('button', { hasText: /^Compare$/ }).click();
    await m.getByText(/Compared \d+ of \d+ panels/).waitFor({ timeout: 30000 });
    const t = await m.innerText();
    const hit = (t.match(/Panel A ↔ Fig1_panelC_DAPI\.png[^\n]*/) || [])[0];
    const alike = (t.match(/Panel C ↔ Fig4_PhoB_blot\.tif[^\n]*/) || [])[0];
    expect(hit && /mirrored left–right/.test(hit), 'no mirrored hit: ' + t.slice(1300, 2000));
    expect(alike && /similar layout — not counted/.test(alike), 'no similar-layout row');
    await L.shot(T, 'journal-reuse', m.locator('xpath=./*[1]'), { doc: true });
    return hit + ' | ' + alike;
  });

  await step(T, '5.3 "Intentional reuse — say so in the legend" writes a sentence into Methods and caption', async () => {
    const m = p.locator('#xdup-modal-bg');
    await m.locator('button', { hasText: 'Intentional reuse' }).first().click();
    await p.waitForTimeout(500);
    expect(await m.getByText('✓ Intentional reuse').count() > 0, 'decision not shown');
    await m.locator('button', { hasText: /^Close$/ }).last().click();
    await L.openSection(T, 'Export');
    await btn(T, '✦ Generate Caption').click();
    await btn(T, '✎ Write Methods paragraph').click();
    await p.waitForTimeout(500);
    const cap = await p.locator('#caption-out').inputValue();
    const meth = await p.locator('#methods-out').inputValue();
    const s = (cap.match(/The image in panel A is reused[^.]*\./) || [])[0];
    expect(s && /reused from/.test(meth), 'caption: ' + cap.slice(-160));
    const R = await report(T);
    const r = row(R, 'Image reuse across figures');
    await closeReport(T);
    return s + ' | report: ' + r.icon + ' ' + r.note.slice(0, 90);
  });

  // ------------------------------------------------------------------ 6. export + package
  await step(T, '6.1 ↓ TIFF → Save TIF writes Fig2.tif, LZW, 300 dpi at the PLOS width', async () => {
    const r = await L.exportVia(T, 'TIFF');
    const info = L.tiffInfo(fs.readFileSync(r.file));
    const w = +(await p.locator('#export-width-mm').inputValue());
    const mm = info.w / info.xres * 25.4;
    expect(/Save TIF\b/.test(r.dialogText), 'the Save button does not read "Save TIF"');
    expect(path.basename(r.file) === 'Fig2.tif' && info.compression === 5 && Math.abs(info.xres - 300) < 1 && Math.abs(mm - w) < 1,
      path.basename(r.file) + ' ' + JSON.stringify(info));
    return `${path.basename(r.file)} ${info.w}×${info.h} px, LZW, ${info.xres} dpi, ${mm.toFixed(1)} mm`;
  });

  await step(T, '6.2 The key button now says (TIFF): the key follows the last export format', async () => {
    const label = await p.locator('#key-dl-btn').innerText();
    expect(/\(TIFF\)/.test(label), label);
    return label;
  });

  let pkg;
  await step(T, '6.3 📦 Export submission package (ZIP): figure files, key in 5 formats, texts, scripts, reuse check', async () => {
    await L.openSection(T, 'Export');
    pkg = await L.download(T, () => btn(T, '📦 Export submission package (ZIP)').click(), /submission-package\.zip$/, 90000);
    const list = L.zipList(pkg);
    const want = ['Fig2.png', 'Fig2.tif', 'Fig2.pdf', 'Fig2.svg', 'Fig2-key.png', 'Fig2-key.tif', 'Fig2-key.pdf', 'Fig2-key.svg', 'Fig2-key.txt',
      'Fig2-session.json', 'Fig2-metadata.csv', 'Fig2-caption.txt', 'Fig2-methods.txt', 'Fig2-alt.txt', 'Fig2_assemble.R', 'Fig2_assemble.py',
      'PANEL_HISTORY.txt', 'IMAGE_REUSE_CHECK.txt', 'README.txt'];
    const missing = want.filter(w => !list.includes(w));
    expect(!missing.length, 'missing: ' + missing.join(', ') + ' | has: ' + list.join(', '));
    expect(list.some(f => /^panels\//.test(f)), 'no panels/');
    const reuse = L.zipRead(pkg, 'IMAGE_REUSE_CHECK.txt').toString('utf8');
    expect(/Fig1_panelC_DAPI/.test(reuse), 'IMAGE_REUSE_CHECK does not name the reuse');
    const key = L.zipRead(pkg, 'Fig2-key.txt').toString('utf8').trim();
    expect(key === 'DAPI (blue); GFP-LC3 (green).', key);
    return list.length + ' files: ' + list.filter(f => !/^panels\//.test(f)).join(', ');
  });

  // ------------------------------------------------------------------ 7. save and reopen
  let session;
  await step(T, '7.1 Ctrl/⌘+S saves the session (images bundled)', async () => {
    await p.locator('#fig-canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
    session = await L.download(T, () => p.keyboard.press('ControlOrMeta+s'), /session\.json$/);
    const kb = fs.statSync(session).size / 1024;
    return `${path.basename(session)} ${kb.toFixed(0)} KB — ${await L.toasts(T)}`;
  });

  await step(T, '7.2 A fresh page: welcome card › 📂 Load a session reopens panels, letters, journal, key names, notes', async () => {
    const p2 = await T.context.newPage();
    p2.on('download', async d => { const f = path.join(T.out, 'downloads', d.suggestedFilename()); await d.saveAs(f); T.downloads.push(f); });
    p2.on('pageerror', e => T.errors.push('pageerror (reopened): ' + e.message));
    p2.on('dialog', d => d.accept());
    await p2.goto(L.APP_URL);
    await p2.waitForFunction(() => typeof render === 'function');
    const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByRole('button', { name: '📂 Load a session' }).click()]);
    await fc.setFiles(session);
    await p2.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 20000 });
    await p2.waitForTimeout(800);
    const st = await p2.evaluate(() => ({ labels: images.filter(Boolean).map(i => i.label).join(''), j: document.getElementById('target-journal').value,
      name: document.getElementById('export-name').value, key: document.getElementById('key-text').value,
      notes: images.filter(Boolean).map(i => i.captionNote || '').filter(Boolean).length }));
    expect(st.labels === 'ABCD' && st.j === 'plos' && st.name === 'Fig2' && /GFP-LC3/.test(st.key) && st.notes === 2, JSON.stringify(st));
    await T.page.close();
    T.page = p2;
    await p2.evaluate(() => { window.__toasts = []; const el = document.getElementById('toast');
      new MutationObserver(() => { const t = el.textContent.trim(); if (t) window.__toasts.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); });
    T._toastSeen = 0;
    return JSON.stringify(st);
  });

  await step(T, '7.3 In the reopened session, edit the Methods paragraph and the alt text (add a sentence to each)', async () => {
    const q = T.page;
    await L.openSection(T, 'Export');
    const m = await q.locator('#methods-out').inputValue();
    expect(m.length > 50, 'no Methods paragraph in the reopened session');
    await q.locator('#methods-out').fill(m + ' Images were acquired on the same day.');
    await q.locator('#methods-out').press('Tab');
    const a = await q.locator('#alt-text').inputValue();
    expect(a.length > 20, 'no alt text in the reopened session');
    await q.locator('#alt-text').fill(a + ' LC3 puncta are brighter in panel A.');
    await q.locator('#alt-text').press('Tab');
    return 'Methods and alt text edited';
  });

  // ------------------------------------------------------------------ 8. revision
  await step(T, '8.1 Right-click panel C › ⇄ Replace image… keeps label, caption note and settings', async () => {
    const q = T.page;
    await q.getByRole('button', { name: /Dismiss/ }).click({ timeout: 1500 }).catch(() => {});
    const cr = await q.locator('#fig-canvas').boundingBox();
    const b = await q.evaluate(() => panelBounds.find(x => (x.idx ?? x.i) === 2));
    await q.mouse.click(cr.x + b.x + b.w / 2, cr.y + b.y + b.h / 2, { button: 'right' });
    await q.locator('#panel-ctx-menu').waitFor({ state: 'visible' });
    const menu = await q.locator('#panel-ctx-menu').innerText();
    await L.pickFiles(T, q.locator('#panel-ctx-menu').getByText('Replace image…'), [rerun]);
    await q.waitForTimeout(800);
    const st = await q.evaluate(() => [images[2].label, images[2].name, images[2].captionNote]);
    expect(st[0] === 'C' && st[1] === 'PhoA_blot_rerun.tif' && /PhoA/.test(st[2]), JSON.stringify(st));
    return (await L.toasts(T)) + ' | menu: ' + menu.replace(/\n/g, ' · ');
  });

  await step(T, '8.2 Drag panel A onto panel B on the canvas: they swap, the letters follow position, the untouched caption follows, the edited Methods and alt text are flagged', async () => {
    const q = T.page;
    const cr = await q.locator('#fig-canvas').boundingBox();
    const [a, b] = await q.evaluate(() => [panelBounds.find(x => (x.idx ?? x.i) === 0), panelBounds.find(x => (x.idx ?? x.i) === 1)]);
    const x0 = cr.x + a.x + a.w / 2, y0 = cr.y + a.y + a.h / 2, x1 = cr.x + b.x + b.w / 2;
    await q.mouse.move(x0, y0); await q.mouse.down();
    for (let i = 1; i <= 12; i++) { await q.mouse.move(x0 + (x1 - x0) * i / 12, y0); await q.waitForTimeout(25); }
    await q.mouse.up(); await q.waitForTimeout(600);
    const st = await q.evaluate(() => images.filter(Boolean).slice(0, 2).map(i => i.label + ':' + i.name.split('_').pop()));
    expect(st[0] === 'A:GFP.tif' && st[1] === 'B:DAPI.tif', st.join(' '));
    await q.waitForTimeout(500);
    // the untouched caption follows the figure; the edited Methods is flagged, not rewritten
    const cap = await q.locator('#caption-out').inputValue();
    const capFlag = await q.locator('#caption-stale').isVisible();
    const mflag = q.locator('#methods-stale');
    expect(/\(A\) GFP/.test(cap) && !capFlag, 'caption did not follow the swap: ' + cap.slice(0, 120));
    expect(await mflag.isVisible() && /same day/.test(await q.locator('#methods-out').inputValue()), 'Methods flag not shown');
    const mtxt = (await mflag.innerText()).trim();
    expect(/✎ Rewrite \(replaces your edits\) · Keep mine/.test(mtxt), mtxt);
    // the edited alt text is flagged too
    const aflag = q.locator('#alt-stale');
    expect(await aflag.isVisible() && /puncta/.test(await q.locator('#alt-text').inputValue()), 'alt-text flag not shown after the swap');
    const atxt = (await aflag.innerText()).trim();
    expect(/✦ Redraft \(replaces your edits\) · Keep mine/.test(atxt), atxt);
    // ✎ Write Methods paragraph asks before writing over the edit; Keep mine keeps it
    await L.openSection(T, 'Export');
    await btn(T, '✎ Write Methods paragraph').click();
    const cm = q.locator('#confirm-modal-bg');
    await cm.waitFor({ state: 'visible' });
    const ask = (await cm.locator('#cm-title').innerText()).trim();
    expect(ask === 'Replace your Methods paragraph?', ask);
    await cm.getByRole('button', { name: 'Keep mine' }).click(); await q.waitForTimeout(300);
    expect(/same day/.test(await q.locator('#methods-out').inputValue()), 'Keep mine lost the Methods edit');
    return (await L.toasts(T)) + ' — ' + st.join(', ') + ' | caption now: ' + cap.slice(0, 60) + '… | Methods: ' + mtxt + ' | alt text: ' + atxt.slice(0, 60) + '… | ✎ Write Methods paragraph asks "' + ask + '"';
  });

  await step(T, '8.3 Change journal with ⌘K "Journal: eLife", re-check, re-export the package', async () => {
    const q = T.page;
    await L.cmdk(T, 'Journal: eLife');
    await q.waitForTimeout(500);
    const t = await L.toasts(T);
    const R = await report(T);
    await closeReport(T);
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => btn(T, '📦 Export submission package (ZIP)').click(), /submission-package\.zip$/, 90000);
    const list = L.zipList(f);
    const hist = L.zipRead(f, 'PANEL_HISTORY.txt').toString('utf8');
    expect(/PhoA_blot_rerun/.test(hist), 'PANEL_HISTORY does not record the replacement');
    // the edited Methods (7.3) is kept, with FigureLab's current text beside it, and a note says so
    const title = q.getByText(/^⚠ Check the Methods/);
    await title.waitFor({ state: 'visible', timeout: 5000 });
    expect(list.includes('Fig2-methods-generated.txt') && list.includes('Fig2-alt-generated.txt'), 'no -methods-generated.txt / -alt-generated.txt: ' + list.join(', '));
    const note = title.locator('xpath=ancestor::div[.//button][1]');
    const nt = (await note.innerText()).replace(/\s+/g, ' ').trim();
    await q.keyboard.press('Escape'); await q.waitForTimeout(300);
    if (await title.isVisible().catch(() => false)) await note.locator('button', { hasText: '×' }).first().click();
    expect(!(await title.isVisible().catch(() => false)), 'note did not close');
    return `${t} | ${R.title} | ${path.basename(f)}: ${list.length} files, PANEL_HISTORY names the re-run blot; ${list.filter(x => /generated/.test(x)).join(', ')} | note: ${nt.slice(0, 200)}`;
  });

  // ux2 (was ISSUES.md): the placed key went into the top-left corner over panel letter A,
  // and moving it meant widening a margin and ticking the box again. Now one menu.
  await step(T, '8.4 Export › Legend key › Where › Right edge: the key moves to the right of the panels; the check passes it', async () => {
    const q = T.page;
    await L.openSection(T, 'Export');
    await L.toasts(T);
    await q.locator('#key-where').selectOption({ label: 'Right edge' });
    await q.waitForTimeout(700);
    const t = await L.toasts(T);
    const st = await q.evaluate(() => { const c = document.getElementById('ann-canvas'), a = annotations.find(x => x && x.type === 'legend');
      const right = Math.max(...panelBounds.map(b => b.x + b.w)) / canvasLogicalW; return { xf: a.xf, right, where: a.where }; });
    expect(st.where === 'right' && st.xf >= st.right - 0.001, JSON.stringify(st));
    const R = await report(T);
    const kr = row(R, 'Legend key on the figure');
    await closeReport(T);
    expect(kr.icon === '✓', kr.note);
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => btn(T, '📦 Export submission package (ZIP)').click(), /submission-package\.zip$/, 90000);
    const list = L.zipList(f);
    const mg = await q.evaluate(() => ['m-top', 'm-right', 'm-btm', 'm-left'].map(id => document.getElementById(id).value).join('/'));
    return `${R.title} | margins T/R/B/L ${mg} | key at ${(st.xf * 100).toFixed(1)} % across (panels end at ${(st.right * 100).toFixed(1)} %)${t ? ' — ' + t : ''} | package: ${list.filter(x => /generated/.test(x)).join(', ') || 'no -generated files'}`;
  });

  await step(T, 'screenshot: the finished figure with the placed key', async () => {
    const q = T.page;
    await q.keyboard.press('Escape');
    await q.locator('#canvas-wrap').click({ position: { x: 20, y: 20 } }); await q.keyboard.press('Escape');   // deselect
    await btn(T, '⟳ Render').click(); await q.waitForTimeout(600);
    await L.shot(T, 'journal-figure', q.locator('#canvas-container'), { doc: true });
  });

  await L.finish(T);
})();
