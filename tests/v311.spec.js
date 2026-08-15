// @ts-check
// On-canvas AI editing, variations and style references.
//
// The load-bearing test in this file is the gate: an imported experimental image, or a
// grid panel, must not merely be "not offered" — it must be impossible to reach, and
// reaching for it must produce ZERO network requests. That is the claim FigureLab makes
// about AI and research data, and it is checked here by counting captured requests, not
// by reading a toast.
const { test, expect } = require('@playwright/test');
const { loadApp, seedPanels, seedFreeform, stubGemini } = require('./helpers');

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// The stub must hand back a DIFFERENT image from the seeded one, or "the edit changed
// the pixels" is answered by string equality on identical data and proves nothing.
const RED_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** One AI object, selected, with the API primed. */
async function seedAISelected(page, { prompt = 'phage schematic' } = {}) {
  await page.evaluate(({ png, prompt }) => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    freeformElements.push({ id: _uidElem(), type: 'aiicon', src: png, aiGenerated: true,
      aiModel: 'gemini-3.1-flash-image', aiEngine: 'gemini-3.1-flash-image',
      aiPrompt: prompt, x: 0, y: 0, w: 40, h: 40, zIndex: 1, rotation: 0, locked: false, opacity: 1 });
    selectedElems.clear(); selectedElems.add(0);
    document.getElementById('gemini-api-key').value = 'AIzaTestKey';
    _syncAIModelUI();
  }, { png: TINY_PNG, prompt });
}

// ── The gate ──────────────────────────────────────────────────

test('the gate permits AI and drawn objects, and refuses imported images', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => ({
    aiObject:  _aiEditable({ type: 'aiicon', aiGenerated: true }),
    shape:     _aiEditable({ type: 'rect' }),
    icon:      _aiEditable({ type: 'image', isIcon: true, aiGenerated: true }),
    text:      _aiEditable({ type: 'text' }),
    chart:     _aiEditable({ type: 'chart' }),
    imported:  _aiEditable({ type: 'image' }),           // a user's file — never
    painted:   _aiEditable({ type: 'paint' }),           // painted over something imported
    nothing:   _aiEditable(null),
  }));
  expect(r).toEqual({ aiObject: true, shape: true, icon: true, text: true, chart: true,
                      imported: false, painted: false, nothing: false });
  expect(errors).toEqual([]);
});

test('editing an imported experimental image is refused, and sends nothing', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedFreeform(page, [{ type: 'image', iw: 60, ih: 60, x: 0, y: 0, w: 60, h: 60 }]);
  const r = await page.evaluate(async () => {
    selectedElems.clear(); selectedElems.add(0);
    document.getElementById('gemini-api-key').value = 'AIzaTestKey';
    let said = '';
    const t = window.toast; window.toast = (m, k) => { said = m; t(m, k); };
    window.prompt = () => 'make it prettier';           // user would have typed something
    document.getElementById('ai-prompt').value = 'style match';  // so the refusal is the gate,
    window.confirm = () => true;                                 // not a missing prompt
    await aiEditSelected();
    await aiVariation();
    await aiGenerateWithReference();
    window.toast = t;
    return { said, srcUnchanged: !!freeformElements[0].src, tagged: !!freeformElements[0].aiGenerated };
  });
  expect(r.said).toMatch(/never sends or AI-edits experimental images/i);
  expect(r.said).toMatch(/misconduct/i);
  expect(r.tagged).toBe(false);                          // it is not silently retagged
  // The claim that matters: refusing did not put a single byte on the wire.
  expect(captured.length).toBe(0);
  expect(errors).toEqual([]);
});

test('grid panels have no AI edit path at all', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedPanels(page, 2);
  const r = await page.evaluate(async () => {
    let said = '';
    const t = window.toast; window.toast = (m, k) => { said = m; t(m, k); };
    window.prompt = () => 'enhance the bands';
    await aiEditSelected();                              // grid mode — refused before anything
    window.toast = t;
    return { said, panelsUntouched: images.filter(Boolean).every(im => !im.aiGenerated) };
  });
  expect(r.said).toMatch(/freeform/i);
  expect(r.panelsUntouched).toBe(true);
  expect(captured.length).toBe(0);
  expect(errors).toEqual([]);
});

test('the AI toolbar appears for a schematic and stays hidden for an imported image', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', iw: 40, ih: 40, x: 0, y: 0, w: 40, h: 40 },
    { type: 'rect', x: 80, y: 0, w: 40, h: 40 },
  ]);
  const r = await page.evaluate(() => {
    const vis = () => document.getElementById('ep-ai-props').style.display !== 'none';
    selectedElems.clear(); selectedElems.add(0); updateElemPropsBar();
    const onImported = vis();
    selectedElems.clear(); selectedElems.add(1); updateElemPropsBar();
    return { onImported, onShape: vis() };
  });
  expect(r).toEqual({ onImported: false, onShape: true });
  expect(errors).toEqual([]);
});

// ── Editing ───────────────────────────────────────────────────

test('an edit swaps the pixels, is undoable, and records the turn', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page);
  const r = await page.evaluate(async () => {
    window.prompt = () => 'make the arrows red';
    const before = freeformElements[0].src;
    const undoBefore = undoStack.length;
    await aiEditSelected();
    const el = freeformElements[0];
    return { changed: el.src !== before, prevKept: el.aiPrevSrc === before,
             undoDelta: undoStack.length - undoBefore,
             hist: el.aiHistory && el.aiHistory.map(h => ({ p: h.prompt, k: h.kind, m: h.model })),
             logged: reproLog.filter(e => e.action === 'aiEdit').length };
  });
  expect(r.changed).toBe(true);
  expect(r.prevKept).toBe(true);
  expect(r.undoDelta).toBe(1);
  expect(r.hist).toEqual([{ p: 'make the arrows red', k: 'edit', m: 'gemini-3.1-flash-image' }]);
  expect(r.logged).toBe(1);
  expect(errors).toEqual([]);
});

test('a multi-turn edit replays the previous turns', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page);
  await page.evaluate(async () => {
    window.prompt = () => 'first change';
    await aiEditSelected();
    window.prompt = () => 'now make it blue';
    await aiEditSelected();
  });
  const second = captured.filter(c => c.url.includes(':generateContent'))[1];
  const parts = second.body.contents[0].parts;
  // prior turn (text + its image) then this instruction and the current image
  expect(parts.length).toBe(4);
  expect(parts[0].text).toBe('first change');
  expect(parts[1].inline_data.mime_type).toBe('image/png');   // snake_case on the way out
  expect(parts[2].text).toBe('now make it blue');
  expect(parts[3].inline_data).toBeTruthy();
  expect(errors).toEqual([]);
});

test('revert restores the previous pixels and drops the history entry', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page);
  const r = await page.evaluate(async () => {
    window.prompt = () => 'change something';
    const original = freeformElements[0].src;
    await aiEditSelected();
    const edited = freeformElements[0].src;
    revertAIEdit();
    const el = freeformElements[0];
    return { restored: el.src === original, wasDifferent: edited !== original,
             histEmpty: (el.aiHistory || []).length === 0, prevCleared: !el.aiPrevSrc };
  });
  expect(r).toEqual({ restored: true, wasDifferent: true, histEmpty: true, prevCleared: true });
  expect(errors).toEqual([]);
});

test('editing a hand-drawn shape tags it AI-generated and says so', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedFreeform(page, [{ type: 'rect', x: 0, y: 0, w: 60, h: 60 }]);
  const r = await page.evaluate(async () => {
    selectedElems.clear(); selectedElems.add(0);
    document.getElementById('gemini-api-key').value = 'AIzaTestKey';
    _syncAIModelUI();
    window.prompt = () => 'turn this into a cell membrane';
    let said = '';
    const t = window.toast; window.toast = (m, k) => { said = m; t(m, k); };
    await aiEditSelected();
    window.toast = t;
    const el = freeformElements[0];
    return { tagged: el.aiGenerated, type: el.type, said,
             counted: _aiGeneratedCount() };
  });
  expect(r.tagged).toBe(true);
  expect(r.type).toBe('aiicon');
  // The disclosure obligation starts the moment AI touches it — the user is told then.
  expect(r.said).toMatch(/now tagged AI-generated and will be disclosed/i);
  expect(r.counted).toBe(1);
  expect(errors).toEqual([]);
});

// ── Variations and references ─────────────────────────────────

test('a variation is added beside the original, leaving it untouched', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page, { prompt: 'ribosome cartoon' });
  const r = await page.evaluate(async () => {
    const origSrc = freeformElements[0].src;
    await aiVariation();
    await new Promise(r => setTimeout(r, 200));
    return { n: freeformElements.length,
             originalIntact: freeformElements[0].src === origSrc,
             variation: freeformElements[1] && {
               prompt: freeformElements[1].aiPrompt, label: freeformElements[1].label,
               toTheRight: freeformElements[1].x > freeformElements[0].x },
             logged: reproLog.filter(e => e.action === 'aiGenerate' && e.kind === 'variation').length };
  });
  expect(r.n).toBe(2);
  expect(r.originalIntact).toBe(true);
  expect(r.variation.prompt).toBe('ribosome cartoon');
  expect(r.variation.label).toBe('AI variation');
  expect(r.variation.toTheRight).toBe(true);
  expect(r.logged).toBe(1);
  expect(errors).toEqual([]);
});

test('a style reference is sent as inline_data, after explicit consent', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page);
  const r = await page.evaluate(async () => {
    let asked = '';
    window.confirm = (m) => { asked = m; return true; };
    document.getElementById('ai-prompt').value = 'same style, but a capsid';
    await aiGenerateWithReference();
    return { asked, previewed: !!document.querySelector('#ai-preview img') };
  });
  // The consent line must actually say the image goes to Google
  expect(r.asked).toMatch(/sent to Google/i);
  const gen = captured.find(c => c.url.includes(':generateContent'));
  expect(gen.body.contents[0].parts[0].text).toContain('same style, but a capsid');
  expect(gen.body.contents[0].parts[1].inline_data.mime_type).toBe('image/png');
  expect(r.previewed).toBe(true);
  expect(errors).toEqual([]);
});

test('declining consent sends nothing', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page);
  await page.evaluate(async () => {
    window.confirm = () => false;
    document.getElementById('ai-prompt').value = 'anything';
    await aiGenerateWithReference();
  });
  expect(captured.length).toBe(0);
  expect(errors).toEqual([]);
});

test('a mixed selection containing an experimental image refuses entirely', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedFreeform(page, [
    { type: 'rect', x: 0, y: 0, w: 40, h: 40 },
    { type: 'image', iw: 40, ih: 40, x: 60, y: 0, w: 40, h: 40 },
  ]);
  const r = await page.evaluate(async () => {
    selectedElems.clear(); selectedElems.add(0); selectedElems.add(1);
    document.getElementById('ai-prompt').value = 'style match';
    let said = '';
    const t = window.toast; window.toast = (m, k) => { said = m; t(m, k); };
    window.confirm = () => true;                      // even if the user would agree
    await aiGenerateWithReference();
    window.toast = t;
    return said;
  });
  expect(r).toMatch(/never sends or AI-edits experimental images/i);
  expect(captured.length).toBe(0);
  expect(errors).toEqual([]);
});

// ── Persistence ───────────────────────────────────────────────

test('edit history survives a session round-trip; the revert buffer does not bloat it', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page, { b64png: RED_PNG_B64 });
  await seedAISelected(page);
  const r = await page.evaluate(async () => {
    window.prompt = () => 'recorded change';
    await aiEditSelected();
    const full = serializeSession(true);
    const light = serializeSession(false);
    const j = o => (typeof o === 'string') ? JSON.parse(o) : o;
    const fEl = j(full).freeformElements[0], lEl = j(light).freeformElements[0];
    return { fullHist: (fEl.aiHistory || []).length, fullHasPrev: 'aiPrevSrc' in fEl,
             lightHist: (lEl.aiHistory || []).length, lightHasPrev: 'aiPrevSrc' in lEl,
             lightKeepsSrc: !!lEl.src };
  });
  expect(r.fullHist).toBe(1);
  expect(r.fullHasPrev).toBe(true);
  expect(r.lightHist).toBe(1);          // provenance survives even a settings-only save
  expect(r.lightHasPrev).toBe(false);   // the convenience buffer does not
  expect(r.lightKeepsSrc).toBe(true);   // AI pixels always bundle — they can't be re-imported
  expect(errors).toEqual([]);
});
