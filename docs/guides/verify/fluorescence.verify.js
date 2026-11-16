// Verifies docs/guides/fluorescence.md through the visible UI: 16-bit split-channel files,
// Auto-channels, display ranges matched in camera counts, merge → split rows, scale bars,
// linked insets, the red/green check, channel names and the legend key.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

(async () => {
  const T = await L.start('fluorescence');
  const p = T.page;
  const inp = path.join(T.out, 'inputs');

  // Two conditions, three Fiji split channels each. BafA1 has 2.5× the GFP signal.
  const files = [];
  for (const [cond, gain, seed] of [['DMSO', 1, 5], ['BafA1', 2.5, 7]]) {
    files.push(I.fluorTiff(path.join(inp, `C1-HeLa_${cond}_60x_DAPI.tif`), 'DAPI', { seed }));
    files.push(I.fluorTiff(path.join(inp, `C2-HeLa_${cond}_60x_GFP.tif`), 'GFP', { seed, gain }));
    files.push(I.fluorTiff(path.join(inp, `C3-HeLa_${cond}_60x_CellMask.tif`), 'CellMask', { seed }));
  }
  files.sort();   // a file picker hands them over in name order

  // ---- helpers local to this guide
  const row = (letter) => p.locator('#img-list > .img-item')
    .filter({ has: p.locator(`input.panel-pick[aria-label="Tick panel ${letter}"]`) }).first();
  const rowByChip = (chip) => p.locator('#img-list > .img-item')
    .filter({ has: p.locator('button.f-chan-chip', { hasText: chip }) }).filter({ hasNotText: 'hidden' }).first();
  const closeAllSettings = async () => {
    for (const r of await p.locator('#img-list > .img-item').all()) {
      if (await r.locator('.img-settings.open').count()) await r.locator('button', { hasText: '⚙' }).first().click();
    }
  };
  const openSettings = async (r) => { await closeAllSettings(); await r.locator('button', { hasText: '⚙' }).first().click(); await p.waitForTimeout(250); return r.locator('.img-settings.open'); };
  const toast = () => p.evaluate(() => document.getElementById('toast').textContent);
  // Click a panel on the canvas, by its letter, as you would with the mouse.
  const clickPanel = async (letter) => {
    const pt = await p.evaluate((Lt) => {
      const cv = document.getElementById('fig-canvas'), c = cv.getBoundingClientRect(), k = c.width / cv.width;
      const b = panelBounds.find(q => images[q.idx] && formatLabel(images[q.idx].label) === Lt);
      return b && { x: c.x + (b.x + b.w / 2) * k, y: c.y + (b.y + b.h / 2) * k };
    }, letter);
    if (!pt) throw new Error('panel ' + letter + ' is not on the canvas');
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(300);
  };
  // Screenshot clip spanning from one element to another (inclusive), as wide as `wide`.
  const clipBetween = async (top, bottom, wide, padTop = 6, padBottom = 6) => {
    await bottom.scrollIntoViewIfNeeded(); await top.scrollIntoViewIfNeeded();
    const a = await top.boundingBox(), b = await bottom.boundingBox(), w = await wide.boundingBox();
    return { x: w.x, y: Math.max(0, a.y - padTop), width: w.width, height: b.y + b.height - a.y + padTop + padBottom };
  };
  // Visible panels in grid order: letter, condition, kind.
  const layout = () => p.evaluate(() => panelBounds.map(b => {
    const im = images[b.idx];
    return { L: formatLabel(im.label), cond: (im.name.match(/HeLa_(\w+?)_/) || [])[1],
      kind: im.insetOf != null ? 'inset' : (im.channels && im.channels.length ? 'merge' : im.lut) };
  }));

  await step(T, '1. Drop or click to add images → the six 16-bit channel files', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), files);
    await p.waitForFunction(() => images.filter(Boolean).length === 6, null, { timeout: 20000 });
    const tip = btn(T, 'Got it'); if (await tip.count()) await tip.click();
    const st = await p.evaluate(() => images.filter(Boolean).map(im => ({ bits: im.srcBits, um: im.umPerPx })));
    expect(st.every(s => s.bits === 16), '16-bit samples not kept: ' + JSON.stringify(st));
    expect(st.every(s => Math.abs(s.um - 0.108333) < 1e-4), 'calibration not read: ' + JSON.stringify(st));
    const rowsText = await L.panelRows(T);
    expect(!rowsText.some(r => /calibrate/.test(r)), 'a row shows ⚠ calibrate');
    const ts = await L.toasts(T, { all: true });
    expect(/16-bit scaled to 8-bit for display; native samples kept for measurement/.test(ts), 'toasts: ' + ts.slice(0, 200));
    const chips = await p.locator('#img-list button.f-chan-chip').allInnerTexts();
    expect(['DAPI', 'GFP', 'CellMask'].every(c => chips.includes(c)), 'channel chips: ' + chips);
    // each calibrated panel gets a bar of a round length, about a fifth of its field
    const bars = await p.evaluate(() => [...new Set(images.filter(Boolean).map(im => (im.sbOn ? 'on ' : 'off ') + im.sbUm + ' ' + (im.sbUnit || 'µm')))]);
    expect(bars.join() === 'on 10 µm', 'bars at import: ' + bars);
    return '6 panels, 16-bit, 0.10833 µm/px from the ImageJ tags; chips ' + [...new Set(chips)].join(', ') + '; bars ' + bars.join(', ');
  });

  await step(T, '2. Images › 🎨 Auto-channels colours each file by its channel word', async () => {
    await btn(T, 'Auto-channels').click(); await p.waitForTimeout(500);
    const t = await toast();
    const luts = await p.evaluate(() => images.filter(Boolean).map(im => im.name.split('_').pop().replace('.tif', '') + '=' + im.lut));
    expect(luts.every(s => /DAPI=blue|GFP=green|CellMask=magenta/.test(s)), luts.join(' '));
    return t + ' — ' + [...new Set(luts)].join(', ');
  });

  for (const [chip, lo, hi] of [['GFP', 400, 12000], ['DAPI', 0, 10000], ['CellMask', 0, 20000]]) {
    await step(T, `3. ⚙ on a ${chip} panel › Black pt ${lo}, White pt ${hi} (counts) › ≡ Sync by channel`, async () => {
      const r = rowByChip(chip);
      const st = await openSettings(r);
      await st.locator('input.f-bpt-v').fill(String(lo)); await st.locator('input.f-bpt-v').press('Enter');
      await st.locator('input.f-wpt-v').fill(String(hi)); await st.locator('input.f-wpt-v').press('Enter');
      if (chip === 'GFP') {
        await st.locator('input.f-wpt-v').blur();
        await L.shot(T, 'fluorescence-white-point', await clipBetween(st.locator('input.f-bpt-v'), st.locator('button', { hasText: '≡ Sync by channel' }), st, 40), { doc: true });
      }
      await st.locator('button', { hasText: '≡ Sync by channel' }).click(); await p.waitForTimeout(400);
      const t = await toast();
      expect(new RegExp(`${chip} ${lo}–${hi} from \\w → 1 panel`).test(t), 'toast: ' + t);
      // the other panel of this channel now reads the same counts in its own boxes
      const other = p.locator('#img-list > .img-item').filter({ has: p.locator('button.f-chan-chip', { hasText: chip }) }).nth(1);
      const st2 = await openSettings(other);
      const v = [await st2.locator('input.f-bpt-v').inputValue(), await st2.locator('input.f-wpt-v').inputValue()];
      await closeAllSettings();
      expect(+v[0] === lo && +v[1] === hi, 'other panel reads ' + v);
      return t;
    });
  }

  for (const cond of ['DMSO', 'BafA1']) {
    await step(T, `4. Tick the three ${cond} rows › ⊕ Merge channels, then the merge's ⚙ › ⑃ Split channels into panels`, async () => {
      const rows = p.locator('#img-list > .img-item').filter({ hasText: `HeLa_${cond}_` }).filter({ hasNotText: 'hidden' });
      expect(await rows.count() === 3, 'rows for ' + cond + ': ' + await rows.count());
      for (const r of await rows.all()) await r.locator('input.panel-pick').check();
      await btn(T, '⊕ Merge channels').click(); await p.waitForTimeout(800);
      const t1 = await toast();
      const into = (t1.match(/merged into (\w+)/) || [])[1];
      expect(into, 'merge toast: ' + t1);
      const st = await openSettings(row(into));
      await st.locator('button', { hasText: '⑃ Split channels into panels' }).click(); await p.waitForTimeout(1000);
      const t2 = await toast();
      await closeAllSettings();
      expect(/Split into 4 panels/.test(t2) && /Arrange › Columns 4 gives each split field its own row/.test(t2), 'split toast: ' + t2);
      // ux2: the first split, inside a 3 × 2 grid, grows the grid so the new panels are drawn
      if (cond === 'DMSO') expect(/the grid grew to 3 × 3 rows so the new panels are drawn/.test(t2), 'split toast: ' + t2);
      return t1.split(' — ')[0] + '; ' + t2.split(' — ')[1];
    });
  }

  await step(T, '5. Arrange › Columns 4, Rows 2 › 🔤 Relabel A, B, C… gives DAPI | GFP | CellMask | merge rows', async () => {
    await L.openSection(T, 'Arrange');
    await p.getByLabel('Columns', { exact: true }).fill('4'); await p.getByLabel('Columns', { exact: true }).press('Tab');
    await p.getByLabel('Rows', { exact: true }).fill('2'); await p.getByLabel('Rows', { exact: true }).press('Tab');
    await p.waitForTimeout(300);
    await btn(T, 'Relabel A, B, C').click(); await p.waitForTimeout(500);
    const lay = await layout();
    const kinds = lay.map(x => x.kind).join(',');
    expect(kinds === 'blue,green,magenta,merge,blue,green,magenta,merge', 'grid order: ' + kinds);
    expect(lay.slice(0, 4).every(x => x.cond === lay[0].cond) && lay.slice(4).every(x => x.cond === lay[4].cond), 'a row mixes conditions');
    expect(lay.map(x => x.L).join('') === 'ABCDEFGH', 'letters ' + lay.map(x => x.L).join(''));
    return lay.map(x => `${x.L}:${x.cond}/${x.kind}`).join(' ');
  });

  await step(T, '5b. The merges and split panels keep GFP at 400–12000 counts', async () => {
    const out = [];
    for (const Lt of ['B', 'F']) {
      const st = await openSettings(row(Lt));
      out.push(Lt + ' ' + await st.locator('input.f-bpt-v').inputValue() + '–' + await st.locator('input.f-wpt-v').inputValue());
    }
    for (const Lt of ['D', 'H']) {
      const st = await openSettings(row(Lt));
      const ch = await st.evaluate(e => [...e.querySelectorAll('input.ch-bpt-v')].map((b, i) => b.value + '–' + e.querySelectorAll('input.ch-wpt-v')[i].value));
      out.push(Lt + ' merge channels ' + ch.join(', '));
    }
    await closeAllSettings();
    expect(out.slice(0, 2).every(s => /400–12000$/.test(s)), out.join('; '));
    expect(out.slice(2).every(s => s.includes('400–12000')), out.join('; '));
    return out.join('; ');
  });

  await step(T, '6. ⚙ on A › Auto picks a bar; type 20 µm › Look › ≡ Same bar on all calibrated copies it (no canvas click needed)', async () => {
    const st = await openSettings(row('A'));
    await st.getByRole('button', { name: 'Auto', exact: true }).click(); await p.waitForTimeout(300);
    const t1 = await toast();
    await st.locator('input.f-sbum').fill('20'); await st.locator('input.f-sbum').press('Tab');
    await closeAllSettings();
    await L.openSection(T, 'Look');
    await btn(T, '≡ Same bar on all calibrated').click(); await p.waitForTimeout(400);
    const t2 = await toast();
    const lens = await p.evaluate(() => panelBounds.map(b => images[b.idx].sbUm));
    // ux2: the panel whose Bar length was typed last counts as the one to copy from
    expect(lens.every(v => +v === 20), 'bar lengths ' + lens + ' toast ' + t2);
    expect(/20 µm on 8 calibrated panels \(from A, the length typed last\)/.test(t2), t2);
    return t1 + ' → ' + t2;
  });

  for (const parent of ['D', 'H']) {
    const via = parent === 'D' ? 'right-click it › ⧉ Add linked inset…' : 'Check › ⧉ Add linked inset…';
    await step(T, `7. Click ${parent} on the canvas, ${via} › px X 300 Y 80 W 128 H 128 › ⧉ Add inset`, async () => {
      await clickPanel(parent);
      if (parent === 'D') {
        const pt = await p.evaluate(() => { const cv = document.getElementById('fig-canvas'), c = cv.getBoundingClientRect(), k = c.width / cv.width;
          const b = panelBounds.find(q => formatLabel(images[q.idx].label) === 'D'); return { x: c.x + (b.x + b.w / 2) * k, y: c.y + (b.y + b.h / 2) * k }; });
        await p.mouse.click(pt.x, pt.y, { button: 'right' }); await p.waitForTimeout(300);
        const item = p.locator('body *:visible').filter({ hasText: /^⧉\s+Add linked inset…$/ }).last();
        await item.click();
      } else {
        await L.openSection(T, 'Check');
        await btn(T, '⧉ Add linked inset…').click();
      }
      const m = p.locator('#crop-modal'); await m.waitFor({ state: 'visible' });
      const title = await m.locator('text=/Inset of/').first().innerText();
      expect(title.includes('Inset of ' + parent), 'dialog title: ' + title);
      for (const [k, v] of [['x', 300], ['y', 80], ['w', 128], ['h', 128]]) {
        await m.locator('#crop-px-' + k).fill(String(v)); await m.locator('#crop-px-' + k).press('Tab');
      }
      await m.locator('button', { hasText: '⧉ Add inset' }).click(); await p.waitForTimeout(700);
      const t = await toast();
      expect(new RegExp(`Inset \\w of ${parent} placed right after it`).test(t), t);
      // ux2: a new inset gets its own round bar length (its 13.9 µm field cannot hold 20 µm)
      const ib = await p.evaluate(() => { const im = images.filter(Boolean).filter(i => i.insetOf != null).pop(); return { on: im.sbOn, um: im.sbUm }; });
      expect(ib.on && +ib.um === 2, 'inset bar ' + JSON.stringify(ib));
      return title + ' → ' + t.split(' — ')[0] + '; its bar 2 µm';
    });
  }

  await step(T, '8. Arrange › Columns 5, Rows 2 › 🔤 Relabel: each inset sits after its merge, with its own 2 µm bar', async () => {
    await L.openSection(T, 'Arrange');
    await p.getByLabel('Columns', { exact: true }).fill('5'); await p.getByLabel('Columns', { exact: true }).press('Tab');
    await p.getByLabel('Rows', { exact: true }).fill('2'); await p.getByLabel('Rows', { exact: true }).press('Tab');
    await p.waitForTimeout(300);
    await btn(T, 'Relabel A, B, C').click(); await p.waitForTimeout(400);
    const lay = await layout();
    expect(lay.map(x => x.kind).join(',') === 'blue,green,magenta,merge,inset,blue,green,magenta,merge,inset', lay.map(x => x.kind).join(','));
    const parents = await p.evaluate(() => panelBounds.map(b => images[b.idx]).filter(im => im.insetOf != null)
      .map(im => formatLabel(im.label) + '←' + formatLabel(images.find(q => q && q.id === im.insetOf).label)));
    expect(parents.join(' ') === 'E←D J←I', 'insets ' + parents);
    const bars = [];
    for (const Lt of ['E', 'J']) {
      const st = await openSettings(row(Lt));
      bars.push(Lt + ' ' + await st.locator('input.f-sbum').inputValue() + ' µm');
    }
    await closeAllSettings();
    expect(bars.every(b => / 2 µm$/.test(b)), bars.join(', '));
    return parents.join(', ') + '; inset bars ' + bars.join(', ');
  });

  await step(T, '9. Inset ⚙ › ⧉ Edit inset region… › X 250 › ✓ Update inset moves the region', async () => {
    const st = await openSettings(row('E'));
    await st.locator('button', { hasText: '⧉ Edit inset region…' }).click();
    const m = p.locator('#crop-modal'); await m.waitFor({ state: 'visible' });
    await m.locator('#crop-px-x').fill('250'); await m.locator('#crop-px-x').press('Tab');
    await m.locator('button', { hasText: '✓ Update inset' }).click(); await p.waitForTimeout(500);
    await closeAllSettings();
    const x = await p.evaluate(() => images.find(i => i && formatLabel(i.label) === 'E').insetRect.x * 512);
    expect(Math.abs(x - 250) < 1, 'inset x ' + x);
    return await toast();
  });

  await step(T, '10. Clicking a channel chip in the image list opens that panel\'s Channel field', async () => {
    await closeAllSettings();
    await rowByChip('CellMask').locator('button.f-chan-chip').click(); await p.waitForTimeout(300);
    const f = await p.evaluate(() => { const a = document.activeElement; return a.className + ' ph=' + a.placeholder; });
    await p.keyboard.press('Escape');
    await closeAllSettings();
    expect(/f-chan ph=CellMask/.test(f), 'focused ' + f);
    return 'focus in Channel field (placeholder CellMask)';
  });

  await step(T, '11. Export › Legend key › Channel names: rename CellMask to Membrane on every panel', async () => {
    await L.openSection(T, 'Export');
    const names = await p.locator('.key-name-in').evaluateAll(a => a.map(x => x.getAttribute('aria-label') + '=' + x.value));
    const f = p.getByLabel('Name of the magenta channel');
    await f.fill('Membrane'); await f.press('Enter'); await p.waitForTimeout(500);
    const kt = await p.evaluate(() => document.getElementById('key-text').value || document.getElementById('key-text').textContent);
    expect(kt.trim() === 'DAPI (blue); GFP (green); Membrane (magenta).', 'key text: ' + kt);
    await f.blur();
    const dk = btn(T, '⬇ Download key');
    await L.shot(T, 'fluorescence-channel-names', await clipBetween(dk, p.locator('.key-name-in').last(), dk, 34), { doc: true });
    return names.join(', ') + ' → ' + kt;
  });

  await step(T, '12. Colour-blind view › Deuteranopia (screen only), then back to Normal vision', async () => {
    await p.locator('#cvd-mode').selectOption({ label: 'Deuteranopia (red-green)' }); await p.waitForTimeout(400);
    const filt = await p.evaluate(() => getComputedStyle(document.getElementById('canvas-container')).filter + ' ' + (document.getElementById('fig-canvas').style.filter || ''));
    await p.locator('#cvd-mode').selectOption({ label: 'Normal vision' });
    return 'filter while on: ' + filt.trim().slice(0, 60);
  });

  await step(T, '13. A red LUT next to green: Check › ✓ Check journal compliance › Red/green row › Red → magenta', async () => {
    const st = await openSettings(row('C'));
    await st.getByRole('button', { name: 'Red', exact: true }).click(); await p.waitForTimeout(300);
    await closeAllSettings();
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    expect(/Red\/green\nred and green channels/.test(txt), 'no red/green warning');
    const dr = (txt.match(/Display ranges by channel\n([^\n]*)/) || [])[1] || '';
    await rep.locator('button', { hasText: 'Red → magenta' }).click(); await p.waitForTimeout(500);
    await p.keyboard.press('Escape');
    const lut = await p.evaluate(() => images.find(i => i && formatLabel(i.label) === 'C').lut);
    expect(lut === 'magenta', 'lut ' + lut);
    return 'fixed to ' + lut + '; Display ranges row: ' + dr.slice(0, 90);
  });

  // ux2: the placed key goes into free space (a margin, an empty cell or a free corner) and
  // never over a panel or letter; with no room a margin grows and a toast says so. The old
  // way (widen Margins › Right by hand, untick and tick again) is not needed.
  await step(T, '14. Export › Place the key on the figure: the right margin grows and the key sits there; Where › Right edge; back to Free space', async () => {
    await L.openSection(T, 'Export');
    await L.toasts(T);
    await p.getByLabel('Place the key on the figure').check(); await p.waitForTimeout(800);
    const geo = () => p.evaluate(() => {
      const k = annotations.filter(a => a && a.type === 'legend'), W = document.getElementById('fig-canvas').width;
      const right = panelBounds.reduce((m, b) => Math.max(m, b.x + b.w), 0);
      return { n: k.length, x: k[0] && Math.round(k[0].xf * W), where: k[0] && k[0].where, right: Math.round(right), mr: document.getElementById('m-right').value };
    });
    const g1 = await geo();
    const t1 = await L.toasts(T);
    expect(g1.n === 1 && g1.x >= g1.right && g1.where === 'auto', JSON.stringify(g1));
    expect(/The legend key needed free space, so the right margin grew from 16 to 96 px/.test(t1), 'toast: ' + t1);
    const opts = await p.locator('#key-where option').allInnerTexts();
    expect(opts.join('|') === 'Free space|Top right|Top left|Bottom right|Bottom left|Right edge|Below', opts.join('|'));
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const kr = ((await rep.innerText()).match(/Legend key on the figure\n([^\n]*)/) || [])[1] || '';
    await p.keyboard.press('Escape');
    expect(/sits in free space/.test(kr), 'compliance: ' + kr);
    await L.openSection(T, 'Export');
    await p.locator('#key-where').selectOption({ label: 'Right edge' }); await p.waitForTimeout(600);
    const g2 = await geo();
    expect(g2.where === 'right' && g2.x >= g2.right, JSON.stringify(g2));
    await p.locator('#key-where').selectOption({ label: 'Free space' }); await p.waitForTimeout(600);
    return `key at x ${g1.x} (panels end at ${g1.right}); toast "${t1.slice(0, 110)}…"; compliance: ${kr}; Where: ${opts.join(', ')}`;
  });

  await step(T, '15. Export › ⬇ Download key writes the key file; ✎ Write Methods paragraph and ✦ Generate Caption state GFP 400–12000, no 0–255 range', async () => {
    const f = await L.download(T, () => btn(T, '⬇ Download key').click(), /-key\./);
    await btn(T, '✎ Write Methods paragraph').click(); await p.waitForTimeout(500);
    const m = await p.locator('#methods-out').inputValue();
    expect(/GFP 400–12000 \(panels/.test(m), 'Methods: ' + (m.match(/display ranges in native values[^.]*/) || [m.slice(0, 200)])[0]);
    fs.writeFileSync(path.join(T.out, 'methods.txt'), m);
    await btn(T, '✦ Generate Caption').click(); await p.waitForTimeout(600);
    const cap = await p.locator('#caption-out').inputValue();
    fs.writeFileSync(path.join(T.out, 'caption.txt'), cap);
    // ux2: no second range "on the 0–255 display scale" for the merges, in Methods or the caption
    expect(!/0–255/.test(m) && !/0–255/.test(cap), 'a 0–255 range is back');
    expect(/Display ranges in the files’ own 16-bit values: DAPI 0–10000 \(panels A, D, E, F, I and J\); GFP 400–12000/.test(cap), 'caption: ' + cap.slice(-300));
    return path.basename(f) + ' (' + fs.statSync(f).size + ' B); ' + (m.match(/display ranges in native values[^.]*/) || [''])[0];
  });

  await step(T, '16. ↓ PNG › Save PNG', async () => {
    const r = await L.exportVia(T, 'PNG', { name: 'Fig2_LC3' });
    const info = L.pngInfo(fs.readFileSync(r.file));
    expect(info.w > 1000, JSON.stringify(info));
    return path.basename(r.file) + ' ' + info.w + '×' + info.h + ' px, ' + info.dpi + ' dpi';
  });

  await step(T, 'screenshot: the finished figure', async () => {
    await p.keyboard.press('Escape');
    await btn(T, '⟳ Render').click(); await p.waitForTimeout(500);
    // the whole figure: two condition rows, the insets, and the placed key in the right margin
    await L.shot(T, 'fluorescence-figure', p.locator('#fig-canvas'), { doc: true, pad: 0 });
  });

  // ux2 (fluor2-08): a 16-bit file whose few hot pixels reach far above the cells opens
  // with White below them, and its ⚙ says so. Added after the screenshot, then removed.
  await step(T, '17. A 16-bit file with a few hot pixels opens with White below them; ⚙ says so', async () => {
    const hot = path.join(inp, 'C2-HeLa_DMSO_60x_GFP_hotpix.tif');
    const pts = new Set(Array.from({ length: 8 }, (_, i) => (37 + i * 61) * 512 + 23 + i * 57));
    L.writeTiff16(hot, 512, 512, (x, y) => pts.has(y * 512 + x) ? 62000 : 400 + 2600 * Math.exp(-((x - 256) ** 2 + (y - 256) ** 2) / 8000), { umPerPx: 0.108333 });
    const n0 = await p.evaluate(() => images.filter(Boolean).length);
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [hot]);
    await p.waitForFunction(n => images.filter(Boolean).length === n + 1, n0, { timeout: 10000 });
    const r = p.locator('#img-list > .img-item').filter({ hasText: 'hotpix' }).first();
    const st = await openSettings(r);
    const note = (await st.locator('.f-lv-note').first().innerText()).replace(/\s+/g, ' ');
    const w = await st.locator('input.f-wpt-v').inputValue();
    await closeAllSettings();
    await r.locator('button', { hasText: '×' }).first().click(); await p.waitForTimeout(400);
    const n1 = await p.evaluate(() => images.filter(Boolean).length);
    expect(/It opened with White at/.test(note) && +w < 62000 && n1 === n0, JSON.stringify({ note, w, n1, n0 }));
    return 'White ' + w + ' — ' + note;
  });

  await L.finish(T);
})();
