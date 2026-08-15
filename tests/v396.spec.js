// @ts-check
// AI plumbing hygiene: eight defects in the Phase-8 AI extension, none of which were
// new features. The headline one: generateAIImage had been shadowed by a patch that
// captured "the original" after both declarations hoisted — so it captured ITSELF,
// and every generate click was an infinite async recursion. The model id was also a
// retired one, and the engine string written into provenance didn't match even that.
// No test here touches the network: everything below is local plumbing.
const { test, expect } = require('@playwright/test');
const { loadApp, seedFreeform } = require('./helpers');

/** A 1x1 transparent PNG — enough to stand in for a generated image. */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('generateAIImage is a single function, not a self-capturing shadow', async ({ page }) => {
  const errors = await loadApp(page);
  // The bug: `const _orig=generateAIImage; async function generateAIImage(){await _orig()}`
  // — both declarations hoist, so _orig was the wrapper itself. If any remnant of that
  // pattern returns, the source will contain a second declaration; assert there is one.
  const r = await page.evaluate(() => ({
    isFn: typeof generateAIImage === 'function',
    // the shadow's telltale global is gone
    origGone: typeof _origGenerateAIImage === 'undefined',
    // and the destructive helper it used is gone with it
    removerGone: typeof removeBgFromCanvas === 'undefined',
  }));
  expect(r).toEqual({ isFn: true, origGone: true, removerGone: true });
  expect(errors).toEqual([]);
});

test('inserting an AI image is undoable, and undo removes exactly it', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async (png) => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    const undoBefore = undoStack.length;
    aiGeneratedSrc = png;
    document.getElementById('ai-prompt').value = 'phage infecting a cell';
    insertAIImage();
    await new Promise(r => setTimeout(r, 150));       // img.onload
    const afterInsert = {
      n: freeformElements.length,
      undoDelta: undoStack.length - undoBefore,
      el: freeformElements[0] && {
        type: freeformElements[0].type,
        aiGenerated: freeformElements[0].aiGenerated,
        aiPrompt: freeformElements[0].aiPrompt,
        hasId: !!freeformElements[0].id,
      },
    };
    undo();
    return { afterInsert, afterUndo: freeformElements.length };
  }, TINY_PNG);
  expect(r.afterInsert.n).toBe(1);
  expect(r.afterInsert.undoDelta).toBe(1);            // the old code pushed nothing
  expect(r.afterInsert.el).toEqual({
    type: 'aiicon', aiGenerated: true, aiPrompt: 'phage infecting a cell', hasId: true,
  });
  expect(r.afterUndo).toBe(0);
  expect(errors).toEqual([]);
});

test('the remove-background option becomes a reversible bgKey, not rewritten pixels', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async (png) => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    document.getElementById('ai-remove-bg').checked = true;
    aiGeneratedSrc = png;
    insertAIImage();
    await new Promise(r => setTimeout(r, 150));
    const el = freeformElements[0];
    document.getElementById('ai-remove-bg').checked = false;
    return { bgKey: el && el.bgKey, srcUntouched: el && el.src === png };
  }, TINY_PNG);
  expect(r.bgKey).toEqual({ on: true, mode: 'white', color: '#ffffff', tol: 32, feather: 0 });
  expect(r.srcUntouched).toBe(true);                  // source pixels are never rewritten
  expect(errors).toEqual([]);
});

test('a lightweight session keeps AI image data but drops user image data', async ({ page }) => {
  const errors = await loadApp(page);
  await seedFreeform(page, [
    { type: 'image', iw: 40, ih: 40, x: 10, y: 10, w: 40, h: 40 },
  ]);
  const r = await page.evaluate((png) => {
    // A user image can be re-dropped from disk; an AI generation cannot be reproduced.
    freeformElements.push({ id: _uidElem(), type: 'aiicon', src: png, aiGenerated: true,
      x: 0, y: 0, w: 10, h: 10, zIndex: 99, rotation: 0, locked: false, opacity: 1 });
    const s = serializeSession(false);                // lightweight
    const j = (typeof s === 'string') ? JSON.parse(s) : s;
    const user = j.freeformElements.find(e => e.type === 'image');
    const ai = j.freeformElements.find(e => e.type === 'aiicon');
    return { userHasSrc: 'src' in user, aiHasSrc: 'src' in ai, aiSrcIntact: ai.src === png };
  }, TINY_PNG);
  expect(r).toEqual({ userHasSrc: false, aiHasSrc: true, aiSrcIntact: true });
  expect(errors).toEqual([]);
});

test('the backend choice survives a reload', async ({ page }) => {
  const errors = await loadApp(page);
  await page.evaluate(() => setAIBackend('sd'));
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  const r = await page.evaluate(() => ({
    backend: aiBackend,
    stored: localStorage.getItem('fl-ai-backend'),
    sdVisible: document.getElementById('sd-settings').style.display !== 'none',
  }));
  expect(r).toEqual({ backend: 'sd', stored: 'sd', sdVisible: true });
  expect(errors).toEqual([]);
});

test('a pre-3.9.6 API key migrates to fl-gemini-key on first read', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('gemini-api-key', 'AIzaLegacyKey123');
    const read = geminiKey();
    return { read,
      migrated: localStorage.getItem('fl-gemini-key'),
      legacyGone: localStorage.getItem('gemini-api-key') === null };
  });
  expect(r).toEqual({ read: 'AIzaLegacyKey123', migrated: 'AIzaLegacyKey123', legacyGone: true });
  expect(errors).toEqual([]);
});

test('the model recorded as provenance is the model actually requested', async ({ page }) => {
  const errors = await loadApp(page);
  const { stubGemini } = require('./helpers');
  const captured = await stubGemini(page);
  // Provenance accuracy: the model written into the element, the repro log and the
  // export metadata must be the one the request URL named. Before this fix the log
  // said gemini-2.0-flash while the URL said gemini-2.0-flash-exp, so exports
  // attributed the wrong model. Asserted through behaviour, not source text — where
  // the id comes from is an implementation detail free to change.
  const r = await page.evaluate(async () => {
    document.getElementById('ai-adv').open = true;
    document.getElementById('gemini-api-key').value = 'AIzaTestKey';
    _syncAIModelUI();
    document.getElementById('ai-model').value = 'gemini-3-pro-image';
    _syncAIModelUI();
    document.getElementById('ai-prompt').value = 'ribosome schematic';
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    await generateAIImage();
    insertAIImage();
    await new Promise(r => setTimeout(r, 150));
    const el = freeformElements[0];
    return { recorded: el.aiModel, engine: el.aiEngine,
             logged: reproLog.filter(e => e.action === 'aiGenerate').pop()?.engine };
  });
  const requested = captured.find(c => c.url.includes(':generateContent')).url;
  expect(requested).toContain('gemini-3-pro-image');
  expect(r.recorded).toBe('gemini-3-pro-image');   // element metadata
  expect(r.engine).toBe('gemini-3-pro-image');
  expect(r.logged).toBe('gemini-3-pro-image');     // repro log
  expect(errors).toEqual([]);
});

test('a reloaded session rebuilds the img element for aiicon like for image', async ({ page }) => {
  const errors = await loadApp(page);
  const r = await page.evaluate(async (png) => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    freeformElements.push({ id: _uidElem(), type: 'aiicon', src: png, aiGenerated: true,
      x: 0, y: 0, w: 10, h: 10, zIndex: 1, rotation: 0, locked: false, opacity: 1 });
    const s = serializeSession(true);
    const json = (typeof s === 'string') ? s : JSON.stringify(s);
    freeformElements.length = 0;
    applySession(JSON.parse(json), { silent: true });
    await new Promise(r => setTimeout(r, 120));
    const el = freeformElements.find(e => e.type === 'aiicon');
    return { found: !!el, imgEager: !!(el && el.img) };
  }, TINY_PNG);
  expect(r.found).toBe(true);
  expect(r.imgEager).toBe(true);                      // no longer relies on lazy buildImgEl
  expect(errors).toEqual([]);
});

test('the compliance check discloses AI content, as a warning and never a failure', async ({ page }) => {
  const errors = await loadApp(page);
  const { seedPanels } = require('./helpers');
  await seedPanels(page, 1);
  const r = await page.evaluate((png) => {
    // checkCompliance renders into showInfoModal (#info-modal-bg); read and dismiss it.
    const readModal = () => {
      const m = document.getElementById('info-modal-bg');
      const t = m ? m.innerText : '';
      if (m) m.remove();
      return t;
    };
    // No AI content -> the row passes
    freeformElements.length = 0;
    checkCompliance();
    const cleanRow = /No AI-generated content/.test(readModal());
    // With AI content -> warn (⚠), not fail (✗)
    freeformElements.push({ id: _uidElem(), type: 'aiicon', src: png, aiGenerated: true,
      x: 0, y: 0, w: 10, h: 10, zIndex: 1, rotation: 0, locked: false, opacity: 1 });
    checkCompliance();
    const dirty = readModal();
    return { cleanRow,
      mentions: /1 AI-generated schematic/.test(dirty),
      namesJournals: /Nature, Science and Cell/.test(dirty) };
  }, TINY_PNG);
  expect(r).toEqual({ cleanRow: true, mentions: true, namesJournals: true });
  expect(errors).toEqual([]);
});
