// Verifies docs/guides/freeform.md through the visible UI: a non-grid results figure placed
// by numbers (X/Y/W/H/∠ bar, Align, Space, Match, multi-select, clips, rotation, letters,
// a chart and a gene map, arrows, text with format marks, a filled box behind panels),
// the Pop out route from a grid, a graphical abstract, and the SVG / PNG / PowerPoint / PDF
// files they export.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const I = require('./inputs');
const { step, expect, btn } = L;

(async () => {
  const T = await L.start('freeform', { width: 1440, height: 1000 });
  const p = T.page;
  const inp = path.join(T.out, 'inputs');
  const gfp = I.fluorTiff(path.join(inp, 'C2-HeLa_GFP.tif'), 'GFP');
  const bact = await I.bacteriaPhoto(T, path.join(inp, 'phase_rods.png'));            // 800×600 (4:3)
  const plate = await I.platePhoto(T, path.join(inp, 'plate_MG1655.jpg'));            // 1200×1200
  const tem = I.temTiff(path.join(inp, 'phi_TEM_0042.tif'));                          // 1024×1024
  // An NCBI-style record: each gene listed twice, as a gene and as its CDS.
  const gb = path.join(inp, 'phiGuide_late.gb');
  fs.writeFileSync(gb, fs.readFileSync(I.phageGenBank(path.join(inp, 'phiGuide_late_cds.gb')), 'utf8')
    .replace(/     CDS             (\S+)\n                     \/gene="([^"]+)"/g, (m, loc, g) => `     gene            ${loc}\n                     /gene="${g}"\n` + m));
  const csv = path.join(inp, 'lysis_OD600.csv');
  fs.writeFileSync(csv, 'time_min,MOI_0_r1,MOI_0_r2,MOI_0_r3,MOI_1_r1,MOI_1_r2,MOI_1_r3\n0,0.10,0.11,0.10,0.10,0.10,0.11\n30,0.20,0.21,0.19,0.19,0.20,0.21\n60,0.40,0.42,0.41,0.30,0.31,0.29\n90,0.70,0.72,0.69,0.22,0.24,0.23\n120,0.95,0.97,0.96,0.12,0.13,0.12\n');

  // ---- helpers (all act through the visible UI; state is only read to check outcomes)
  const els = () => p.evaluate(() => freeformElements.map(e => ({ type: e.type, name: e.name || '', label: e.label, x: +e.x, y: +e.y, w: +e.w, h: +e.h, clip: e.cropShape, rot: e.rotation || 0 })));
  const byName = async (re) => (await els()).find(e => re.test(e.name) || re.test(e.label || ''));
  const canvasW = () => p.evaluate(() => +document.getElementById('fm-canvas-w').value);
  const at = async (x, y) => { const R = await p.locator('#fig-canvas').boundingBox(); const s = R.width / await canvasW(); return [R.x + x * s, R.y + y * s]; };
  const beside = async () => { const R = await p.locator('#fig-canvas').boundingBox(); await p.mouse.click(R.x - 12, R.y + 40); await p.waitForTimeout(120); };
  const clickAt = async (x, y, mod) => { const xy = await at(x, y); if (mod) await p.keyboard.down(mod); await p.mouse.click(...xy); if (mod) await p.keyboard.up(mod); await p.waitForTimeout(150); };
  const centreOf = e => [e.x + e.w / 2, e.y + e.h / 2];
  const listRow = (text) => p.locator('.tpl-saved', { hasText: text }).locator('span').first();
  const pickRow = async (text) => { await listRow(text).click(); await p.waitForTimeout(150); };
  const typeGeo = async (o) => { for (const [k, v] of Object.entries(o)) { await p.locator('#geo-' + k).fill(String(v)); await p.locator('#geo-' + k).press('Enter'); } await p.waitForTimeout(150); };
  const geoVals = () => p.evaluate(() => ['x', 'y', 'w', 'h', 'a'].map(k => document.getElementById('geo-' + k).value));
  const barBtn = (t) => p.locator('button:visible', { hasText: t instanceof RegExp ? t : new RegExp('^' + L.esc(t) + '$') }).first();
  const setColour = (sel, v) => p.locator(sel).evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const drag = async (a, b) => { await p.mouse.move(...await at(...a)); await p.mouse.down(); await p.mouse.move(...await at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), { steps: 5 }); await p.mouse.move(...await at(...b), { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(250); };
  const anns = () => p.evaluate(() => annotations.map(a => ({ type: a.type, text: a.text, z: a.z || 0, fill: a.fill, fillColor: a.fillColor, radius: a.radius, color: a.color, bold: a.bold, fontSize: a.fontSize })));
  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const saveVia = async (fmt, name) => {
    await btn(T, new RegExp('^↓ ' + L.esc(fmt) + '$')).click();
    const m = p.locator('#preflight-modal'); await m.waitFor({ state: 'visible' });
    await m.locator('#pf-name').fill(name);
    const text = await m.innerText();
    const f = await L.download(T, () => m.locator('button', { hasText: /^Save / }).first().click(), /./, 60000);
    return { f, text };
  };
  // Decode a PNG in a scratch page and return the runs of white pixels along a row (in logical px).
  const whiteRuns = async (file, rowLogical, logicalW, rgb) => {
    const pg = await T.context.newPage();
    try {
      return await pg.evaluate(async ({ src, rowLogical, logicalW, rgb }) => {
        const im = new Image(); im.src = src; await im.decode();
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const k = im.width / logicalW, y = Math.round(rowLogical * k);
        const d = x.getImageData(0, y, im.width, 1).data, runs = []; let s = -1;
        if (typeof rgb === 'number') { const i = Math.round(rgb * k) * 4; rgb = [d[i], d[i + 1], d[i + 2]]; }   // sample the colour at this x
        for (let i = 0; i <= im.width; i++) {
          const white = i < im.width && Math.abs(d[i * 4] - rgb[0]) < 8 && Math.abs(d[i * 4 + 1] - rgb[1]) < 8 && Math.abs(d[i * 4 + 2] - rgb[2]) < 8;
          if (white && s < 0) s = i; if (!white && s >= 0) { runs.push([s / k, (i - s) / k]); s = -1; }
        }
        return runs.filter(r => r[1] > 2);
      }, { src: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'), rowLogical, logicalW, rgb });
    } finally { await pg.close(); }
  };

  await btn(T, 'Got it').click({ timeout: 1500 }).catch(() => {});

  // =============================================================== Part 1: results figure
  await step(T, '1.1 Arrange › Canvas mode › ✦ Freeform; Canvas size W 958, H 798', async () => {
    await L.openSection(T, 'Arrange');
    await p.locator('#layout-mode').selectOption({ label: '✦ Freeform' });
    await p.locator('#fm-canvas-w').fill('958'); await p.locator('#fm-canvas-w').press('Enter');
    await p.locator('#fm-canvas-h').fill('798'); await p.locator('#fm-canvas-h').press('Enter');
    await p.waitForTimeout(300);
    const c = await p.evaluate(() => [+document.getElementById('fm-canvas-w').value, +document.getElementById('fm-canvas-h').value, document.getElementById('layout-mode').value]);
    expect(c[0] === 958 && c[1] === 798 && c[2] === 'freeform', 'canvas ' + c);
    return 'canvas 958×798 px';
  });

  await step(T, '1.2 Export › Printed width 183 mm; Look › Typography says what 1 pt is (before: 1 px = 1/96 in)', async () => {
    await L.openSection(T, 'Look');
    const before = await p.locator('#type-readout').innerText();
    await L.openSection(T, 'Export');
    await p.locator('#export-width-mm').selectOption({ label: '183 mm — double column (Nature; eLife preset)' });
    await p.waitForTimeout(300);
    await L.openSection(T, 'Look');
    const after = await p.locator('#type-readout').innerText();
    expect(/no printed width chosen: 1 px prints at 1\/96 in/.test(before) && /183 mm printed width/.test(after), JSON.stringify({ before, after }));
    return `before: "${before.slice(0, 150)}…" → after: "${after}"`;
  });

  await step(T, '1.3 Drop or click to add images → four pictures become objects, side by side up to 300 px wide; ⊡ Fit shows the whole canvas', async () => {
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [gfp, bact, plate, tem]);
    await p.waitForFunction(() => freeformElements.filter(e => e.type === 'image').length === 4, null, { timeout: 15000 });
    await btn(T, 'Got it').click({ timeout: 800 }).catch(() => {});
    const e = await els();
    expect(e.every(x => x.w <= 300 && x.h <= 300) && e.some(x => x.y > e[0].y), 'arrival ' + JSON.stringify(e));
    await btn(T, '⊡ Fit').click(); await p.waitForTimeout(300);
    const R = await p.locator('#fig-canvas').boundingBox(); const wrap = await p.locator('#canvas-wrap').boundingBox();
    expect(R.y >= wrap.y && R.y + R.height <= wrap.y + wrap.height, `canvas ${R.y}–${R.y + R.height}, pane ${wrap.y}–${wrap.y + wrap.height}`);
    return e.map(x => `${x.name} ${x.w}×${x.h} at ${x.x},${x.y}`).join('; ') + ` — after ⊡ Fit the canvas ends ${(wrap.y + wrap.height - R.y - R.height).toFixed(0)} px above the pane's bottom`;
  });

  await step(T, '1.4 Drag a picture by its middle to move it', async () => {
    const d0 = await byName(/TEM/);
    const a = [d0.x + d0.w / 2, d0.y + d0.h / 2];
    await beside(); await drag(a, [a[0] + 40, a[1] + 30]);
    const d1 = await byName(/TEM/);
    expect(Math.abs(d1.x - d0.x - 40) < 3 && Math.abs(d1.y - d0.y - 30) < 3, JSON.stringify([d0, d1]));
    return `moved by ${(d1.x - d0.x).toFixed(0)}, ${(d1.y - d0.y).toFixed(0)} px`;
  });

  await step(T, '2.1 Select each in the Elements list and type its W (⛓ keeps the shape) and a rough X, Y', async () => {
    expect(await p.locator('#geo-keep').isChecked().catch(() => true), '⛓ is not ticked');
    await pickRow('phase_rods.png'); await typeGeo({ w: 400, x: 545, y: 25 });
    await pickRow('plate_MG1655.jpg'); await typeGeo({ w: 194, x: 548, y: 345 });
    await pickRow('phi_TEM_0042.tif'); await typeGeo({ w: 194, x: 760, y: 352 });
    const b = await byName(/phase_rods/), c = await byName(/plate/), d = await byName(/TEM/);
    expect(b.h === 300 && c.h === 194 && d.h === 194, JSON.stringify([b, c, d]));
    // the fields follow the object you pick: no stale numbers from the previous one
    await pickRow('phase_rods.png'); const gb_ = await geoVals();
    await pickRow('plate_MG1655.jpg'); const gc = await geoVals();
    expect(+gb_[0] === b.x && +gb_[1] === b.y && +gb_[2] === 400 && +gc[0] === c.x && +gc[1] === c.y && +gc[2] === 194, JSON.stringify({ gb_, gc }));
    return `B 400×${b.h} (4:3 kept), C ${c.w}×${c.h}, D ${d.w}×${d.h}; fields follow the picked object (B X ${gb_[0]} → C X ${gc[0]})`;
  });

  await step(T, '2.2 Big panel A exactly: X 20, Y 20, W 506 (H follows: 506)', async () => {
    await pickRow('C2-HeLa_GFP.tif');
    expect(await p.locator('#geo-keep').isChecked(), '⛓ is not ticked');
    await typeGeo({ x: 20, y: 20, w: 506 });
    const a = await byName(/GFP/);
    expect(a.x === 20 && a.y === 20 && a.w === 506 && a.h === 506, JSON.stringify(a));
  });

  await step(T, '2.3 Click A, Shift-click B → ⊤T, then Space 12 ⇿: B sits 12 px right of A', async () => {
    await beside();
    const a = await byName(/GFP/), b = await byName(/phase_rods/);
    await clickAt(...centreOf(a)); await clickAt(...centreOf(b), 'Shift');
    expect((await p.evaluate(() => selectedElems.size)) === 2, 'two not selected');
    await barBtn('⊤T').click();
    await p.locator('#ff-space').fill('12');
    await barBtn('⇿').click(); await p.waitForTimeout(200);
    const b2 = await byName(/phase_rods/);
    expect(b2.x === 538 && b2.y === 20, JSON.stringify(b2));
    return `B at X ${b2.x}, Y ${b2.y}`;
  });

  await step(T, '2.4 Click B, Shift-click C → ⊢L, then ⇕: C sits 12 px under B', async () => {
    await beside();
    await clickAt(...centreOf(await byName(/phase_rods/))); await clickAt(...centreOf(await byName(/plate/)), 'Shift');
    await barBtn('⊢L').click(); await barBtn('⇕').click(); await p.waitForTimeout(200);
    const c = await byName(/plate/);
    expect(c.x === 538 && c.y === 332, JSON.stringify(c));
    return `C at X ${c.x}, Y ${c.y}`;
  });

  await step(T, '2.5 Click C, ⌘/Ctrl-click D → =W, ⊤T, ⇿: the row ends flush with B and with A\'s bottom', async () => {
    await beside();
    await clickAt(...centreOf(await byName(/plate/))); await clickAt(...centreOf(await byName(/TEM/)), process.platform === 'darwin' ? 'Meta' : 'Control');
    expect((await p.evaluate(() => selectedElems.size)) === 2, 'two not selected');
    const g = await geoVals();
    await barBtn('=W').click(); await barBtn('⊤T').click(); await barBtn('⇿').click(); await p.waitForTimeout(200);
    const a = await byName(/GFP/), b = await byName(/phase_rods/), c = await byName(/plate/), d = await byName(/TEM/);
    expect(d.x === 744 && d.y === 332 && d.w === 194, JSON.stringify(d));
    expect(d.x + d.w === b.x + b.w && c.y + c.h === a.y + a.h, 'edges do not line up');
    return `bar showed the pair's box X ${g[0]} Y ${g[1]} W ${g[2]}; D at X ${d.x}; right edges ${d.x + d.w} = ${b.x + b.w}, bottoms ${c.y + c.h} = ${a.y + a.h}`;
  });

  await step(T, '2.6 Drag a box from empty canvas, and Ctrl/⌘+A, select several; Escape or a click beside the canvas deselects', async () => {
    await beside();
    await drag([950, 560], [560, 300]);
    const boxed = await p.evaluate(() => selectedElems.size);
    await p.keyboard.press('Escape');
    const afterEsc = await p.evaluate(() => selectedElems.size);
    await p.keyboard.press('ControlOrMeta+a');
    const all = await p.evaluate(() => selectedElems.size);
    await beside();
    const afterBeside = await p.evaluate(() => selectedElems.size);
    expect(boxed >= 3 && afterEsc === 0 && all === 4 && afterBeside === 0, JSON.stringify({ boxed, afterEsc, all, afterBeside }));
    return `drag box ${boxed}, Ctrl+A ${all}`;
  });

  await step(T, '2.7 Props › Clip ◯ on C (circle clip)', async () => {
    await pickRow('plate_MG1655.jpg');
    await p.locator('button:visible[title="Circle clip"]').click(); await p.waitForTimeout(200);
    const c = await byName(/plate/);
    expect(c.clip === 'circle', 'clip ' + c.clip);
    return (await L.toasts(T)).split(' | ').pop();
  });

  await step(T, '2.8 Rotation: ] ] Shift+] turns D to 7°; [ [ Shift+[ turns it back', async () => {
    await beside(); await clickAt(...centreOf(await byName(/TEM/)));
    await p.keyboard.press(']'); await p.keyboard.press(']'); await p.keyboard.press('Shift+]');
    const a1 = (await geoVals())[4];
    await p.keyboard.press('Shift+['); await p.keyboard.press('['); await p.keyboard.press('[');
    const a2 = (await geoVals())[4];
    expect(a1 === '7' && a2 === '0', `∠ ${a1} then ${a2}`);
    return `∠ ${a1}°, then ${a2}°`;
  });

  await step(T, '2.9 Arrow keys nudge by 1 px, Shift+arrow by 10 px', async () => {
    const d0 = await byName(/TEM/);
    await p.keyboard.press('Shift+ArrowDown'); await p.keyboard.press('ArrowUp');
    const d1 = await byName(/TEM/);
    for (let i = 0; i < 9; i++) await p.keyboard.press('ArrowUp');
    const d2 = await byName(/TEM/);
    expect(d1.y === d0.y + 9 && d2.y === d0.y, JSON.stringify([d0.y, d1.y, d2.y]));
  });

  await step(T, '2.10 ⌘K "position" jumps to the X field', async () => {
    await pickRow('phi_TEM_0042.tif');
    const hits = await L.cmdk(T, 'position');
    const f = await p.evaluate(() => document.activeElement.id);
    await p.keyboard.press('Escape'); await beside();
    expect(f === 'geo-x', 'focus ' + f + ' / ' + hits[0]);
    return hits[0];
  });

  await step(T, '3.1 A CSV dropped on the freeform canvas → 📊 Chart → Apply; untick ⛓ and type X 20, Y 538, W 460, H 240', async () => {
    await beside();
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [csv]);
    const m = p.locator('#chart-modal'); await m.waitFor({ state: 'visible' });
    await m.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(400);
    await pickRow('lysis_OD600.csv');
    const keep = await p.locator('#geo-keep').isChecked();
    expect(!keep, '⛓ is ticked for a chart');
    await typeGeo({ x: 20, y: 538, w: 460, h: 240 });
    const c = (await els()).find(e => e.type === 'chart');
    expect(c && c.x === 20 && c.y === 538 && c.w === 460 && c.h === 240, JSON.stringify(c));
    return '⛓ already unticked for the chart';
  });

  await step(T, '3.2a Annotate & Draw › 🧬 Linear, then Cancel: the map it added is removed again', async () => {
    await L.openSection(T, 'Annotate & Draw');
    const n0 = (await els()).length;
    await btn(T, '🧬 Linear').click();
    const m = p.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
    const n1 = (await els()).length;
    await m.locator('button', { hasText: /^Cancel$/ }).click(); await m.waitFor({ state: 'hidden' }); await p.waitForTimeout(200);
    const n2 = (await els()).length;
    expect(n1 === n0 + 1 && n2 === n0, `${n0} → ${n1} → ${n2} objects`);
    return `${n0} → ${n1} → ${n2} objects`;
  });

  await step(T, '3.2 Annotate & Draw › 🧬 Linear › 📄 GenBank / FASTA… (gene + CDS pairs drawn once) → Apply (the dialog closes); W 446, H 160, rough X/Y, then ⊤T and ⇿ with the chart', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '🧬 Linear').click();
    const m = p.locator('#genemap-modal'); await m.waitFor({ state: 'visible' });
    await L.toasts(T);
    await L.pickFiles(T, m.getByText('GenBank / FASTA…'), [gb]);
    await p.waitForTimeout(300);
    const info = (await m.innerText()).match(/[\d.]+ kb · \d+ features[^\n]*/);
    const tst = await L.toasts(T);
    expect(info && /^10\.8 kb · 12 features/.test(info[0]) && /10 genes listed twice \(gene \+ CDS or RNA\) drawn once each/.test(tst), JSON.stringify({ info, tst }));
    await m.locator('button', { hasText: /^Apply$/ }).click(); await p.waitForTimeout(300);
    await m.waitFor({ state: 'hidden' });   // Apply closes the dialog, as the chart's does
    const maps = (await els()).filter(e => e.type === 'genemap');
    expect(maps.length === 1, maps.length + ' gene maps');
    await pickRow('linear gene map');
    expect(!(await p.locator('#geo-keep').isChecked()), '⛓ is ticked for a gene map');
    await typeGeo({ w: 446, h: 160, x: 520, y: 560 });   // roughly below B; ⊤T then lines it up with the chart
    await beside();
    const ch = (await els()).find(e => e.type === 'chart');
    await clickAt(ch.x + 40, ch.y + 40);
    const gm = (await els()).find(e => e.type === 'genemap');
    await clickAt(gm.x + gm.w / 2, gm.y + gm.h / 2, 'Shift');
    await barBtn('⊤T').click(); await barBtn('⇿').click(); await p.waitForTimeout(200);
    const g2 = (await els()).find(e => e.type === 'genemap');
    expect(g2.x === 492 && g2.y === 538 && g2.x + g2.w === 938, JSON.stringify(g2));
    return `"${info[0]}"; toast "${tst}"`;
  });

  await step(T, '3.3 Arrange › 🔤 Relabel A, B, C… letters the pictures A–D and the chart and gene map E, F', async () => {
    await beside();
    await L.openSection(T, 'Arrange');
    await btn(T, '🔤 Relabel A, B, C').click(); await p.waitForTimeout(300);
    const e = await els();
    const imgs = e.filter(x => x.type === 'image').sort((a, b) => a.y - b.y || a.x - b.x).map(x => x.label).join('');
    await pickRow('lysis_OD600.csv'); const lc = await p.locator('#ep-label').inputValue();
    await pickRow('linear gene map'); const lg = await p.locator('#ep-label').inputValue();
    expect(imgs === 'ABCD' && lc === 'E' && lg === 'F', `${imgs} ${lc} ${lg}`);
    return `pictures ${imgs}, chart ${lc}, gene map ${lg}`;
  });

  await step(T, '3.4 Look › Panel Labels (A, B, C…) › Size 8 pt (px follows, at the 183 mm printed width)', async () => {
    await beside();
    expect(await p.locator('#export-width-mm').inputValue() === '183', 'printed width ' + await p.locator('#export-width-mm').inputValue());
    await L.openSection(T, 'Look');
    await p.locator('#label-pt').fill('8'); await p.locator('#label-pt').press('Enter'); await p.waitForTimeout(300);
    const px = await p.locator('#label-size').inputValue();
    expect(Math.abs(+px - 8 / 72 * 25.4 / 183 * 958) < 0.2, 'px ' + px);
    return `8 pt = ${px} px at 183 mm`;
  });

  await step(T, '4.1 ↗ Arrow on A; T Text on B with Δ*ompC* H_{2}O, Enter', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await btn(T, '↗ Arrow').click();
    await drag([150, 150], [255, 240]);
    await btn(T, 'T Text').click();
    await clickAt(560, 300);
    await p.locator('#ann-text-input').waitFor({ state: 'visible' });
    await p.keyboard.type('Δ*ompC* H_{2}O'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    const a = await anns();
    expect(a.some(x => x.type === 'arrow') && a.some(x => x.type === 'text' && x.text === 'Δ*ompC* H_{2}O'), JSON.stringify(a));
    return a.map(x => x.type + (x.text ? ` "${x.text}" ${x.color}` : ' ' + x.color)).join('; ');
  });

  await step(T, '4.2 ↖ Select, double-click the text to edit it; the B toggle sets it plain', async () => {
    await btn(T, '↖ Select').click();
    const xy = await at(600, 294);
    await p.mouse.dblclick(...xy); await p.waitForTimeout(300);
    const inp = p.locator('#ann-text-input');
    await inp.waitFor({ state: 'visible' });
    const before = await inp.inputValue();
    await inp.fill('Δ*ompC* cells'); await inp.press('Enter'); await p.waitForTimeout(250);
    await beside(); await clickAt(590, 294);
    await p.locator('#ann-float-bold').click(); await p.waitForTimeout(200);
    const t = (await anns()).find(x => x.type === 'text');
    expect(before === 'Δ*ompC* H_{2}O' && t.text === 'Δ*ompC* cells' && t.bold === false, JSON.stringify({ before, t }));
    return `editor opened on "${before}", now "${t.text}", bold ${t.bold}`;
  });

  await step(T, '4.3 □ Rect around C and D; X 530, Y 326, W 418, H 206; fill colour; Corner R 12; ⬇ Behind', async () => {
    await beside();
    await btn(T, '□ Rect').click();
    await drag([531, 327], [946, 532]);
    await btn(T, '↖ Select').click();
    await beside(); await clickAt(531, 430);
    await typeGeo({ x: 530, y: 326, w: 418, h: 206 });
    await setColour('#ann-float-fill-color', '#dbe9ff'); await p.waitForTimeout(150);
    const ticked = await p.locator('#ann-float-fill').isChecked();
    await p.locator('#ann-float-rad').fill('12'); await p.locator('#ann-float-rad').press('Enter');
    const tb = await p.locator('#ann-float').boundingBox().catch(() => null);
    const vw = p.viewportSize().width;
    await p.locator('#ann-float-back').click(); await p.waitForTimeout(250);
    const toast = (await L.toasts(T)).split(' | ').pop();
    const r = (await anns()).find(x => x.type === 'rect');
    const front = await p.locator('#ann-float-front').isVisible().catch(() => false);
    expect(r && r.fill && r.fillColor === '#dbe9ff' && r.radius === 12 && r.z === 1 && ticked, JSON.stringify(r));
    return `Fill ticked by the colour: ${ticked}; ⬆ Front shown: ${front}; toast "${toast}"; toolbar right edge ${tb ? (tb.x + tb.width).toFixed(0) : '?'} of ${vw} px`;
  });

  await step(T, 'screenshot: the results figure and the position bar', async () => {
    // A taller window for the picture only, so the canvas shows at a readable size.
    await beside(); await p.setViewportSize({ width: 1440, height: 1400 });
    await btn(T, '⊡ Fit').click(); await p.waitForTimeout(400);
    await L.shot(T, 'freeform-figure', p.locator('#fig-canvas'), { doc: true, pad: 2 });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await btn(T, '⊡ Fit').click(); await p.waitForTimeout(300);
    await pickRow('phi_TEM_0042.tif');
    const bar = await p.locator('#geo-x').boundingBox(); const props = await p.locator('#elem-props-bar').boundingBox();
    await L.shot(T, 'freeform-bar', { x: 312, y: bar.y - 10, width: 1110, height: props.y + props.height - bar.y + 14 }, { doc: true });
    await beside();
  });

  let svgFile;
  await step(T, '5.1 ↓ PNG at 300 DPI: the gaps between A and B, and C and D, are the 12 px typed', async () => {
    const { f } = await saveVia('PNG', 'Fig2_freeform');
    // A–B: white canvas between them; C–D: the tinted box behind them (its colour sampled in the gap).
    const rowAB = await whiteRuns(f, 100, 958, [255, 255, 255]), rowCD = await whiteRuns(f, 429, 958, 738);
    const gapAB = rowAB.find(r => r[0] > 500 && r[0] < 560), gapCD = rowCD.find(r => r[0] > 700 && r[0] < 760);
    expect(gapAB && near(gapAB[1], 12) && gapCD && near(gapCD[1], 12, 1.2), JSON.stringify({ rowAB, rowCD }));
    return `A–B ${gapAB[1].toFixed(2)} px, C–D ${gapCD[1].toFixed(2)} px (logical)`;
  });

  await step(T, '5.2 ↓ SVG (layered): a layer per object, text as <text>, the circle clip, the box behind the panels', async () => {
    const { f } = await saveVia('SVG', 'Fig2_freeform');
    svgFile = f;
    const s = fs.readFileSync(f, 'utf8');
    const imgs = [...s.matchAll(/<image x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
    const layers = [...s.matchAll(/inkscape:label="([^"]+)"/g)].map(m => m[1]);
    const behindIdx = layers.findIndex(l => /behind/i.test(l)), firstPanel = layers.findIndex(l => /^Panel /.test(l));
    const byX = (x, y) => imgs.find(i => Math.abs(i[0] - x) < 2 && Math.abs(i[1] - y) < 2);
    const A = byX(20, 20), Bi = byX(538, 20), C = byX(538, 332), D = byX(744, 332);
    expect(A && Bi && C && D, 'panel pictures not found near their boxes: ' + JSON.stringify(imgs));
    const gapAB = Bi[0] - (A[0] + A[2]), gapCD = D[0] - (C[0] + C[2]);
    expect(/<clipPath id="clip-C"><circle/.test(s) && /<tspan font-style="italic">ompC<\/tspan>/.test(s), 'clip or text missing');
    expect(behindIdx >= 0 && behindIdx < firstPanel && /rx="12"/.test(s), 'box behind not in a layer under the panels');
    expect(Math.abs(gapAB - 12) < 2 && Math.abs(gapCD - 12) < 2, `gaps ${gapAB} ${gapCD}`);
    return `${layers.length} layers (${layers.slice(0, 4).join(', ')}…); gaps in the file A–B ${gapAB.toFixed(2)}, C–D ${gapCD.toFixed(2)} px (see ISSUES.md)`;
  });

  await step(T, '5.3 Export › 📊 Export editable PowerPoint (.pptx): letters and text are editable text with italics and subscripts', async () => {
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => btn(T, '📊 Export editable PowerPoint (.pptx)').click(), /\.pptx$/, 60000);
    const x = L.zipRead(f, 'ppt/slides/slide1.xml').toString('utf8');
    const runs = [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
    expect(['A', 'B', 'C', 'D', 'E', 'F', 'ompC'].every(t => runs.includes(t)) && / i="1"/.test(x), 'runs ' + runs.join('|'));
    // the chart's and the gene map's words are editable text too
    expect(['MOI_0', 'MOI_1', 'portal', 'endolysin'].every(t => runs.includes(t)), 'chart/map runs ' + runs.join('|'));
    // the slide is the printed size, so type sizes read as printed
    const sz = L.zipRead(f, 'ppt/presentation.xml').toString('utf8').match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    const mmW = +sz[1] / 36000, mmH = +sz[2] / 36000;
    expect(Math.abs(mmW - 183) < 0.2, 'slide ' + mmW + ' mm wide');
    return `slide ${mmW.toFixed(1)} × ${mmH.toFixed(1)} mm; text runs: ${runs.join(' | ').slice(0, 260)}… — ${(await L.toasts(T)).split(' | ').pop()}`;
  });

  await step(T, '5.4 ↓ PDF lossless: the Save dialog says fonts are named, not embedded; letters are real text', async () => {
    const { f, text } = await saveVia('PDF lossless', 'Fig2_freeform');
    const note = text.split('\n').find(l => /not embedded/.test(l)) || '';
    const d = fs.readFileSync(f);
    const zlib = require('zlib'); let tj = [];
    for (const m of d.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let b = Buffer.from(m[1], 'latin1'); try { b = zlib.inflateSync(b); } catch (_) {}
      tj = tj.concat([...b.toString('latin1').matchAll(/\(([^)]*)\)\s*Tj/g)].map(x => x[1]));
    }
    const fonts = [...new Set([...d.toString('latin1').matchAll(/\/BaseFont\s*\/([\w-]+)/g)].map(m => m[1]))];
    expect(note && ['A', 'B', 'C', 'D', 'E', 'F'].every(l => tj.includes(l)) && !/FontFile/.test(d.toString('latin1')), JSON.stringify({ note, tj, fonts }));
    expect(['MOI_0', 'portal', 'endolysin'].every(l => tj.includes(l)), 'chart and gene-map words not real text: ' + tj.join('|'));
    return `real text: ${tj.join(', ').slice(0, 300)}…; fonts ${fonts.join(', ')}, none embedded`;
  });

  await step(T, '5.5 Layer ⬇⬇ sends a picture to the back of the objects', async () => {
    await beside(); await clickAt(...centreOf(await byName(/phase_rods/)));
    await barBtn('⬇⬇').click(); await p.waitForTimeout(200);
    const z = await p.evaluate(() => freeformElements.map(e => [e.name || e.type, +e.zIndex || 0]).sort((a, b) => a[1] - b[1]).map(x => x[0]));
    expect(/phase_rods/.test(z[0]), z.join(','));
    return 'drawing order now: ' + z.join(' < ');
  });

  await step(T, '5.6 Props › Crop% L 10 on D: the box narrows by 10 %, keeps its X and Y, and the picture keeps its proportions', async () => {
    await pickRow('phi_TEM_0042.tif');
    const d0 = await byName(/TEM/);
    await p.locator('#ep-cropL').fill('10'); await p.locator('#ep-cropL').press('Enter'); await p.waitForTimeout(250);
    const d1 = await byName(/TEM/);
    expect(near(d1.w, d0.w * 0.9, 0.6) && d1.h === d0.h && d1.x === d0.x && d1.y === d0.y, JSON.stringify([d0, d1]));
    return `W ${d0.w} → ${d1.w.toFixed(1)}, H ${d1.h}; X ${d1.x}, Y ${d1.y} kept`;
  });

  await step(T, '5.7 Marks drawn over an object move with it (Shift+→ on A moves its arrow 10 px)', async () => {
    const arrowX = () => p.evaluate(() => { const a = annotations.find(x => x.type === 'arrow'); return a.xf * +document.getElementById('fm-canvas-w').value; });
    await pickRow('C2-HeLa_GFP.tif');
    const x0 = await arrowX();
    await p.locator('#ep-label').press('Escape').catch(() => {});
    await beside(); await clickAt(100, 400);
    await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(150);
    const x1 = await arrowX();
    await p.keyboard.press('Shift+ArrowLeft');
    expect(near(x1 - x0, 10, 0.2), `arrow moved ${x1 - x0}`);
    return `arrow tail ${x0.toFixed(1)} → ${x1.toFixed(1)}`;
  });

  // =============================================================== Part 2: Pop out from a grid
  await step(T, '6.1 ✕ New → Confirm; a 2 × 2 grid; panel C ⚙ › Circle clip; panel A ⚙ › Intensity bar', async () => {
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(500);
    await L.openSection(T, 'Arrange');
    if ((await p.locator('#layout-mode').inputValue()) !== 'grid') await p.locator('#layout-mode').selectOption({ label: '⊞ Grid' });
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [gfp, bact, plate, tem]);
    await p.waitForFunction(() => images.filter(Boolean).length === 4, null, { timeout: 15000 });
    await btn(T, 'Got it').click({ timeout: 800 }).catch(() => {});
    await p.getByLabel('Columns', { exact: true }).fill('2'); await p.getByLabel('Columns', { exact: true }).press('Tab');
    await p.getByLabel('Rows', { exact: true }).fill('2'); await p.getByLabel('Rows', { exact: true }).press('Tab');
    const rowC = p.locator('#img-list .img-item').nth(2);
    await rowC.scrollIntoViewIfNeeded(); await rowC.locator('button', { hasText: '⚙' }).first().click(); await p.waitForTimeout(250);
    await p.locator('button:visible[title="Circle clip"]').click(); await p.waitForTimeout(200);
    await rowC.locator('button', { hasText: '⚙' }).first().click();
    const rowA = p.locator('#img-list .img-item').nth(0);
    await rowA.scrollIntoViewIfNeeded(); await rowA.locator('button', { hasText: '⚙' }).first().click(); await p.waitForTimeout(250);
    await rowA.locator('.f-cbar').check(); await p.waitForTimeout(200);
    await rowA.locator('button', { hasText: '⚙' }).first().click();
    const st = await p.evaluate(() => images.filter(Boolean).map(im => [im.cropShape, !!im.cbar]));
    expect(st[2][0] === 'circle' && st[0][1], JSON.stringify(st));
  });

  await step(T, '6.2 Arrange › ⇱ Pop out to free layout names what freeform cannot draw; Pop out keeps places, letters, clip and scale bar', async () => {
    await L.openSection(T, 'Arrange');
    await btn(T, '⇱ Pop out to free layout').click(); await p.waitForTimeout(400);
    const dlg = await p.locator('#confirm-modal-bg').innerText();
    expect(/Freeform cannot draw the intensity bar on panel A/.test(dlg), 'dialog: ' + dlg.slice(0, 200));
    await p.locator('#confirm-modal-bg button', { hasText: /^Pop out$/ }).click(); await p.waitForTimeout(500);
    const e = await els();
    const mode = await p.locator('#layout-mode').inputValue();
    const a = e.find(x => x.label === 'A');
    const sbA = await p.evaluate(() => { const a = freeformElements.find(x => x.label === 'A'); return a && +a.umPerPx; });
    expect(mode === 'freeform' && e.map(x => x.label).sort().join('') === 'ABCD' && e.find(x => x.label === 'C').clip === 'circle' && sbA > 0, JSON.stringify({ mode, e, sbA }));
    return dlg.split('\n').find(l => /cannot draw/.test(l)).slice(0, 90) + '… | ' + (await L.toasts(T)).split(' | ').pop();
  });

  await step(T, '6.3 One Ctrl/⌘+Z brings the grid back', async () => {
    await beside();
    await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(400);
    const mode = await p.locator('#layout-mode').inputValue();
    expect(mode === 'grid', 'mode ' + mode);
  });

  // =============================================================== Part 3: graphical abstract
  await step(T, '7.1 ✕ New → Confirm; ⌘K "graphical abstract" → Canvas: graphical abstract (Elsevier) is 1328 × 531 px', async () => {
    await btn(T, '✕ New').click(); await btn(T, /^Confirm/).click(); await p.waitForTimeout(500);
    const hits = await L.cmdk(T, 'graphical abstract');
    expect(/^Canvas: graphical abstract \(Elsevier\)/.test(hits[0]), hits.join(' / '));
    const info = await p.locator('#info-modal-bg').innerText();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const c = await p.evaluate(() => [document.getElementById('layout-mode').value, document.getElementById('fm-canvas-w').value, document.getElementById('fm-canvas-h').value, document.getElementById('export-width-mm').value]);
    expect(c.join() === 'freeform,1328,531,112.4' && /1328×531 px/.test(info), JSON.stringify(c));
    return `${c[1]}×${c[2]} px, ${c[3]} mm at 300 DPI; hits: ${hits.join(' / ')}`;
  });

  await step(T, '7.2 Annotate & Draw › Insert icon: Bacteriophage, Bacterium; add the plate photo (icons arrive with no letter, named in the Elements list)', async () => {
    await L.openSection(T, 'Annotate & Draw');
    await p.locator('button[title="Insert Bacteriophage"]').click(); await p.waitForTimeout(250);
    await p.locator('button[title="Insert Bacterium"]').click(); await p.waitForTimeout(250);
    await L.pickFiles(T, p.getByText('Drop or click to add images'), [plate]);
    await p.waitForFunction(() => freeformElements.length === 3, null, { timeout: 10000 });
    const labels0 = (await els()).filter(e => /Bacteri/.test(e.name || '')).map(e => e.label || '');
    const rows = await p.locator('.tpl-saved').allInnerTexts();
    expect(labels0.length === 2 && labels0.every(l => !l) && rows.some(r => /Bacteriophage/.test(r)) && rows.some(r => /Bacterium/.test(r)), JSON.stringify({ labels0, rows }));
    return 'icons arrived with no letter; Elements list: ' + rows.map(r => r.replace(/\s*×\s*$/, '')).join(', ');
  });

  await step(T, '7.3 Phage icon H 220, X 80; bacterium W 220, X 1028; plate W 300 + Clip ◯; Ctrl+A → ↕ → ←→ → Y 116', async () => {
    // The Elements list is newest first: the phage was inserted first, so it is the last row.
    const rows = p.locator('.tpl-saved');
    const n = await rows.count(); const names = []; for (let i = 0; i < n; i++) names.push(await rows.nth(i).innerText());
    await rows.nth(n - 1).locator('span').first().click(); await typeGeo({ h: 220, x: 80 });
    await rows.nth(n - 2).locator('span').first().click(); await typeGeo({ w: 220, x: 1028 });
    await pickRow('plate_MG1655.jpg'); await typeGeo({ w: 300 }); await p.locator('button:visible[title="Circle clip"]').click();
    await beside(); await p.keyboard.press('ControlOrMeta+a');
    await barBtn('↕').click(); await barBtn('←→').click();
    const distributed = (await L.toasts(T)).split(' | ').pop();
    await typeGeo({ y: 116 });
    const e = (await els()).sort((a, b) => a.x - b.x);
    const cy = e.map(x => x.y + x.h / 2), gaps = [e[1].x - (e[0].x + e[0].w), e[2].x - (e[1].x + e[1].w)];
    expect(cy.every(v => near(v, 266, 0.6)) && near(gaps[0], gaps[1], 0.1), JSON.stringify({ cy, gaps, names }));
    return `centres at y ${cy.map(v => v.toFixed(1)).join(', ')}; gaps ${gaps.map(g => g.toFixed(2)).join(' and ')} px; toast "${distributed}"`;
  });

  await step(T, '7.3b Units menu › mm: the plate\'s W reads in mm at the printed width (300 px → 25.39 mm at 112.4 mm)', async () => {
    await pickRow('plate_MG1655.jpg');
    await p.locator('#geo-unit').selectOption('mm'); await p.waitForTimeout(150);
    const w = (await geoVals())[2];
    await p.locator('#geo-unit').selectOption('px'); await beside();
    expect(near(+w, 300 * 112.4 / 1328, 0.02), 'W ' + w);
    return 'W ' + w + ' mm';
  });

  await step(T, '7.4 ⬜ TextBox title: X 80, Y 16, W 1168, H 64; text with *E. coli* and 10^{8}; Fnt 32; Color dark; untick Fill: no box', async () => {
    await beside();
    await btn(T, '⬜ TextBox').click();
    await drag([300, 20], [900, 80]);
    await btn(T, '↖ Select').click();
    await beside(); await clickAt(600, 50);
    await typeGeo({ x: 80, y: 16, w: 1168, h: 64 });
    await p.locator('#ann-float-tb-text').fill('Phage phiGuide lyses *E. coli* K-12 within 90 min at 10^{8} PFU/mL');
    await p.locator('#ann-float-tb-text').press('Enter');
    // ux3 (freeform3-01): the Text size row measures text boxes and their superscripts; at
    // Fnt 28 the 10⁸ printed 4.7 pt, under 5 pt — Fnt 32 prints it at 5.3 pt
    await p.locator('#ann-float-font').fill('32'); await p.locator('#ann-float-font').press('Enter');
    await setColour('#ann-float-color', '#111111');
    const fill0 = { ticked: await p.locator('#ann-float-fill').isChecked(), colour: await p.locator('#ann-float-fill-color').inputValue() };
    await p.locator('#ann-float-fill').uncheck(); await p.waitForTimeout(200);
    const tb = (await anns()).find(x => x.type === 'textbox');
    expect(tb && tb.fontSize === 32 && tb.fill === false && /\*E\. coli\*/.test(tb.text), JSON.stringify(tb));
    // what is drawn: a corner of the box, away from the text, is the white canvas
    await beside(); await btn(T, '⟳ Render').click(); await p.waitForTimeout(400);
    const px = await p.evaluate(() => { const c = document.getElementById('fig-canvas'), W = +document.getElementById('fm-canvas-w').value, k = c.width / W;
      return [[84, 20], [1244, 76]].map(([x, y]) => [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3)); });
    expect(px.every(v => v.every(c => c > 245)), 'box corners drawn ' + JSON.stringify(px));
    return `new TextBox: Fill ${fill0.ticked ? 'ticked' : 'unticked'} (${fill0.colour}); unticked: box corners ${JSON.stringify(px)}`;
  });

  await step(T, '7.5 Annotate & Draw › Fnt 26, then two ↗ Arrows and two T Text labels (dark on the white canvas by default)', async () => {
    await beside();
    await p.locator('#ann-font').fill('26'); await p.locator('#ann-font').press('Tab');
    await btn(T, '↗ Arrow').click();
    await drag([260, 266], [455, 266]); await drag([805, 266], [1005, 266]);
    await btn(T, 'T Text').click();
    for (const [x, t] of [[305, 'infects'], [845, 'Δ*ompC* resists']]) {
      await clickAt(x, 225); await p.locator('#ann-text-input').waitFor({ state: 'visible', timeout: 5000 });
      await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    }
    await btn(T, '↖ Select').click(); await beside();
    const a = await anns();
    const texts = a.filter(x => x.type === 'text');
    expect(a.filter(x => x.type === 'arrow').length === 2 && texts.length === 2 && texts.every(t => t.color === '#111111' && t.fontSize === 26), JSON.stringify(a));
    return texts.map(t => `"${t.text}" ${t.color} ${t.fontSize}px`).join('; ');
  });

  await step(T, '7.6 Check › ✓ Check journal compliance: the Text size row passes with labels at Fnt 26 (6 pt at 112.4 mm)', async () => {
    await L.openSection(T, 'Check');
    await btn(T, '✓ Check journal compliance').click();
    const rep = p.locator('#info-modal-bg'); await rep.waitFor({ state: 'visible' });
    const txt = await rep.innerText();
    const row = (txt.match(/Text size\n([^\n]*)/) || [])[1] || '';
    await p.keyboard.press('Escape');
    expect(/✓/.test(row), 'Text size: ' + row);
    return row.slice(0, 200);
  });

  await step(T, 'screenshot: the graphical abstract', async () => {
    await btn(T, '⊡ Fit').click(); await p.waitForTimeout(300);
    await L.shot(T, 'freeform-abstract', p.locator('#fig-canvas'), { doc: true, pad: 2 });
  });

  await step(T, '8.1 ↓ SVG: the text box is editable <text> with an italic and a superscript span', async () => {
    const { f } = await saveVia('SVG', 'graphical_abstract');
    const s = fs.readFileSync(f, 'utf8');
    const ok = /<g data-type="textbox">[\s\S]*?<text[^>]*>Phage phiGuide lyses <tspan font-style="italic">E\. coli<\/tspan>[^<]*<tspan font-size="[\d.]+" dy="-[\d.]+">8<\/tspan>/.test(s);
    expect(ok, 'text box not found as <text>');
  });

  await step(T, '8.2 📊 Export editable PowerPoint (.pptx): the text box, labels and arrows are editable', async () => {
    await L.openSection(T, 'Export');
    const f = await L.download(T, () => btn(T, '📊 Export editable PowerPoint (.pptx)').click(), /\.pptx$/, 60000);
    const x = L.zipRead(f, 'ppt/slides/slide1.xml').toString('utf8');
    const runs = [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
    expect(runs.includes('E. coli') && runs.includes('infects') && runs.includes('ompC'), runs.join('|'));
    const sz = L.zipRead(f, 'ppt/presentation.xml').toString('utf8').match(/<p:sldSz cx="(\d+)"/);
    expect(Math.abs(+sz[1] / 36000 - 112.4) < 0.2, 'slide ' + (+sz[1] / 36000) + ' mm wide');
    return `slide ${(+sz[1] / 36000).toFixed(1)} mm wide; ` + runs.join(' | ') + ' — ' + (await L.toasts(T)).split(' | ').pop();
  });

  await step(T, '8.3 ↓ PDF lossless: the title, "infects" and "Δ…" are real text (Δ in the standard Symbol font)', async () => {
    const { f } = await saveVia('PDF lossless', 'graphical_abstract');
    const zlib = require('zlib'); const d = fs.readFileSync(f).toString('latin1'); let tj = [];
    for (const m of d.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let b = Buffer.from(m[1], 'latin1'); try { b = zlib.inflateSync(b); } catch (_) {}
      tj = tj.concat([...b.toString('latin1').matchAll(/\(([^)]*)\)\s*Tj/g)].map(x => x[1]));
    }
    expect(tj.includes('infects') && tj.some(t => /Phage phiGuide lyses/.test(t)) && tj.some(t => /ompC/.test(t)) && /\/BaseFont \/Symbol \/ToUnicode/.test(d), tj.join(' | '));
    return 'PDF text: ' + tj.join(' | ');
  });

  await step(T, '8.3b One object selected: ↔ centres it on the canvas', async () => {
    await pickRow('plate_MG1655.jpg');
    await barBtn('↔').click(); await p.waitForTimeout(150);
    const e = await byName(/plate/);
    expect(near(e.x + e.w / 2, 664, 0.6), JSON.stringify(e));
    return `plate centre x ${(e.x + e.w / 2).toFixed(1)} of 1328`;
  });

  await step(T, '8.4 ⌘K "square graphical abstract" sets a square canvas and says it is a custom size', async () => {
    await L.toasts(T);
    const hits = await L.cmdk(T, 'square graphical abstract');
    const tst = await L.toasts(T);
    const info = await p.locator('#info-modal-bg').innerText().catch(() => '');
    await p.keyboard.press('Escape');
    const c = await p.evaluate(() => [document.getElementById('fm-canvas-w').value, document.getElementById('fm-canvas-h').value]);
    expect(c[0] === c[1], 'canvas ' + c);
    return `${c[0]}×${c[1]} px — ${(info.split('\n').find(l => /custom|check/i.test(l)) || hits[0] || '').slice(0, 120)}; toast "${tst}"`;
  });

  await L.finish(T);
})();
