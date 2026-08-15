// @ts-check
// The journal AI-policy export gate.
//
// FigureLab already tagged AI objects; this is what makes the tag do something. Nature,
// Science and Cell Press each refuse generative-AI figures outright — so an export that
// contains one, under one of those presets, stops and says so, and the "continue" path
// writes the disclosure sentence (tool, model, prompt) the journal would ask for.
//
// Nothing here touches the network.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels } = require('./helpers');

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Put one AI-generated object on the canvas with a known model and prompt. */
async function seedAI(page, { model = 'gemini-3.1-flash-image', prompt = 'phage schematic' } = {}) {
  await page.evaluate(({ png, model, prompt }) => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    freeformElements.push({ id: _uidElem(), type: 'aiicon', src: png, aiGenerated: true,
      aiModel: model, aiEngine: model, aiPrompt: prompt, aiTs: new Date().toISOString(),
      x: 0, y: 0, w: 40, h: 40, zIndex: 1, rotation: 0, locked: false, opacity: 1 });
    document.getElementById('fig-notes').value = '';
  }, { png: TINY_PNG, model, prompt });
}

/** Did the gate modal open? Returns its text, or '' if it didn't. */
async function gateText(page) {
  return page.evaluate(() => {
    const m = document.getElementById('info-modal-bg');
    return m && /journal/i.test(m.textContent) ? m.textContent : '';
  });
}

test('a strict journal preset stops an export that contains AI content', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page);
  await page.evaluate(() => { applyPreset('nature'); doExport('png'); });
  const txt = await gateText(page);
  expect(txt).toMatch(/Nature portfolio/);
  expect(txt).toMatch(/does not accept figures created with generative AI/i);
  // Dated and hedged — the app must not present a policy summary as settled fact
  expect(txt).toMatch(/August 2026/);
  expect(txt).toMatch(/policies change/i);
  // and it never pretends to make the call for the author
  expect(txt).toMatch(/not able to decide this for you/i);
  expect(errors).toEqual([]);
});

test('each strict journal is named with its own policy', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  for (const [preset, expected] of [
    ['science', /full prompt, the tool and its version/i],
    ['cell', /brightness, contrast or colour balance/i],
  ]) {
    await seedAI(page);
    await page.evaluate((p) => { applyPreset(p); doExport('png'); }, preset);
    expect(await gateText(page)).toMatch(expected);
    await page.evaluate(() => document.getElementById('info-modal-bg')?.remove());
  }
  expect(errors).toEqual([]);
});

test('a figure with no AI content exports without a word about it', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await page.evaluate(() => {
    freeformElements.length = 0;
    applyPreset('nature');
    // stub the download so the export completes silently
    window.dl = () => {};
  });
  await page.evaluate(() => doExport('png'));
  expect(await gateText(page)).toBe('');
  expect(errors).toEqual([]);
});

test('a preset with no encoded policy does not gate', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page);
  await page.evaluate(() => { window.dl = () => {}; applyPreset('poster'); doExport('png'); });
  expect(await gateText(page)).toBe('');
  expect(errors).toEqual([]);
});

test('“Disclose & continue” writes tool, model and prompt into the figure notes', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page, { model: 'gemini-3-pro-image', prompt: 'T4 phage adsorption' });
  const r = await page.evaluate(async () => {
    window.dl = () => {};
    let resumed = false;
    const realExport = window.doExport;
    window.doExport = async (f) => { resumed = true; return realExport(f); };
    doExport('png');                       // gated
    _aiGateProceed();                      // user acknowledges
    await new Promise(r => setTimeout(r, 300));
    window.doExport = realExport;
    return { notes: document.getElementById('fig-notes').value,
             resumed,
             logged: reproLog.filter(e => e.action === 'aiPolicyAck').length };
  });
  // Science's requirement, generated rather than left to the author's memory
  expect(r.notes).toMatch(/AI disclosure:/);
  expect(r.notes).toMatch(/gemini-3-pro-image/);
  expect(r.notes).toMatch(/T4 phage adsorption/);
  expect(r.notes).toMatch(/FigureLab v/);
  expect(r.notes).toMatch(/No AI was applied to experimental image data/);
  expect(r.notes).toMatch(/SynthID/);
  expect(r.resumed).toBe(true);            // the export actually continues
  expect(r.logged).toBe(1);                // and the acknowledgement is in the repro log
  expect(errors).toEqual([]);
});

test('the disclosure is written once, not once per export', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page);
  const notes = await page.evaluate(async () => {
    window.dl = () => {};
    doExport('png'); _aiGateProceed();
    await new Promise(r => setTimeout(r, 200));
    await doExport('png');                 // second export: already acknowledged
    await new Promise(r => setTimeout(r, 200));
    return document.getElementById('fig-notes').value;
  });
  expect(notes.match(/AI disclosure:/g).length).toBe(1);
  expect(errors).toEqual([]);
});

test('“Cancel export” stops it, and “Show me” selects the AI objects', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page);
  const r = await page.evaluate(async () => {
    let exported = 0;
    window.dl = () => { exported++; };
    applyPreset('nature');                      // without a journal there is nothing to gate against
    doExport('png'); _aiGateCancel();
    await new Promise(r => setTimeout(r, 250));
    const afterCancel = { exported, notesClean: !document.getElementById('fig-notes').value };
    doExport('png'); _aiGateShow();
    await new Promise(r => setTimeout(r, 100));
    return { afterCancel, selected: [...selectedElems].length,
             stillNotExported: exported };
  });
  expect(r.afterCancel.exported).toBe(0);      // cancel means cancel
  expect(r.afterCancel.notesClean).toBe(true); // and writes no disclosure
  expect(r.selected).toBe(1);                  // "show me" selects them for deletion
  expect(r.stillNotExported).toBe(0);
  expect(errors).toEqual([]);
});

test('the submission package is gated too, not just single-file export', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page);
  await page.evaluate(() => { applyPreset('cell'); exportSubmissionPackage(); });
  expect(await gateText(page)).toMatch(/Cell Press/);
  expect(errors).toEqual([]);
});

test('the compliance row names the active journal once a preset is applied', async ({ page }) => {
  const errors = await loadApp(page);
  await seedPanels(page, 1);
  await seedAI(page);
  const r = await page.evaluate(() => {
    const read = () => { const m = document.getElementById('info-modal-bg');
      const t = m ? m.textContent : ''; if (m) m.remove(); return t; };
    applyPreset('science');
    checkCompliance();
    return read();
  });
  expect(r).toMatch(/Science \/ AAAS does not accept generative-AI figures/);
  expect(r).toMatch(/verify/);
  expect(errors).toEqual([]);
});
