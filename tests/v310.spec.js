// @ts-check
// v3.10.0 — the Gemini overhaul. Two generation paths:
//
//  · The BRIDGE (primary): the user's own signed-in gemini.google.com tab. FigureLab
//    copies the prompt out and receives the image back as a paste. gemini.google.com
//    itself cannot be automated here (login wall) — what these tests pin down is the
//    mechanics on our side: arming, clipboard, paste interception, tagging, disarm.
//
//  · The API path (advanced): direct calls with a user key. Every network test goes
//    through stubGemini (page.route) — the real API is paid per image and CI must
//    never touch it. The request-shape assertions are the load-bearing ones: Google's
//    CORS preflight rejects ANY header beyond a tiny allowlist, the endpoint moved
//    from v1beta to v1, and the API is asymmetric about casing (request snake_case
//    inline_data, response camelCase inlineData).
const { test, expect } = require('@playwright/test');
const { loadApp, stubGemini } = require('./helpers');

/** Prime the advanced path: a fake key in the input, model UI initialised. */
async function primeApi(page, { model } = {}) {
  await page.evaluate((m) => {
    document.getElementById('ai-adv').open = true;
    document.getElementById('gemini-api-key').value = 'AIzaTestKeyNotReal';
    _syncAIModelUI();
    if (m) { document.getElementById('ai-model').value = m; _syncAIModelUI(); }
    document.getElementById('ai-prompt').value = 'phage T4 injecting DNA, schematic';
  }, model || null);
}

// ── Request shape ─────────────────────────────────────────────

test('the API request has the right endpoint, model, headers and casing', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page);
  await primeApi(page);
  await page.evaluate(async () => { await generateAIImage(); });
  const gen = captured.find(c => c.url.includes(':generateContent'));
  expect(gen).toBeTruthy();
  // /v1/, not the old /v1beta/ — and the model the picker selected
  expect(gen.url).toContain('/v1/models/gemini-3.1-flash-image:generateContent');
  // Headers: our two, and none of ours beyond them. Any extra header (the SDK sends
  // Api-Revision) fails Google's CORS preflight with an opaque 403.
  expect(gen.headers['x-goog-api-key']).toBe('AIzaTestKeyNotReal');
  expect(gen.headers['content-type']).toBe('application/json');
  expect(Object.keys(gen.headers).filter(h => /^api-revision|^x-client/i.test(h))).toEqual([]);
  // Body: role user, text part, responseModalities
  expect(gen.body.contents[0].role).toBe('user');
  expect(gen.body.contents[0].parts[0].text).toContain('phage T4');
  expect(gen.body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
  expect(errors).toEqual([]);
});

test('aspect ratio and size ride in responseFormat, uppercase K intact', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page);
  await primeApi(page);
  await page.evaluate(async () => {
    document.getElementById('ai-aspect').value = '16:9';
    document.getElementById('ai-size').value = '2K';
    await generateAIImage();
  });
  const gen = captured.find(c => c.url.includes(':generateContent'));
  expect(gen.body.generationConfig.responseFormat.image).toEqual({ aspectRatio: '16:9', imageSize: '2K' });
  expect(errors).toEqual([]);
});

test('the lite model only offers 1K, and the size select follows the model', async ({ page }) => {
  const errors = await loadApp(page);
  await primeApi(page, { model: 'gemini-3.1-flash-lite-image' });
  const r = await page.evaluate(() => ({
    sizes: [...document.getElementById('ai-size').options].map(o => o.value),
  }));
  expect(r.sizes).toEqual(['1K']);
  expect(errors).toEqual([]);
});

// ── Happy path and provenance ─────────────────────────────────

test('generate → insert carries full provenance and is undoable', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page);
  await primeApi(page);
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    await generateAIImage();
    const previewOk = !!document.querySelector('#ai-preview img');
    const undoBefore = undoStack.length;
    insertAIImage();
    await new Promise(r => setTimeout(r, 150));
    const el = freeformElements[0];
    return { previewOk, undoDelta: undoStack.length - undoBefore,
      el: el && { type: el.type, aiGenerated: el.aiGenerated, aiModel: el.aiModel,
                  aiEngine: el.aiEngine, hasTs: !!el.aiTs, prompt: el.aiPrompt } };
  });
  expect(r.previewOk).toBe(true);
  expect(r.undoDelta).toBe(1);
  expect(r.el.type).toBe('aiicon');
  expect(r.el.aiGenerated).toBe(true);
  expect(r.el.aiModel).toBe('gemini-3.1-flash-image');   // the REAL model id, from one source
  expect(r.el.aiEngine).toBe('gemini-3.1-flash-image');
  expect(r.el.hasTs).toBe(true);
  expect(r.el.prompt).toContain('phage T4');
  expect(errors).toEqual([]);
});

// ── Error taxonomy ────────────────────────────────────────────

for (const [status, mustSay] of [
  [400, /key rejected/i],
  [403, /billing/i],
  [429, /cap reached/i],
]) {
  test(`a ${status} maps to actionable advice`, async ({ page }) => {
    const errors = await loadApp(page);
    await stubGemini(page, { status });
    await primeApi(page);
    await page.evaluate(async () => { await generateAIImage(); });
    const preview = await page.evaluate(() => document.getElementById('ai-preview').textContent);
    expect(preview).toMatch(mustSay);
    expect(errors).toEqual([]);
  });
}

test('offline is named before the call, not thrown as Failed to fetch after it', async ({ page }) => {
  const errors = await loadApp(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  await primeApi(page);
  const r = await page.evaluate(async () => {
    let toastText = '';
    const t = window.toast; window.toast = (m, k) => { toastText = m; t(m, k); };
    await generateAIImage();
    window.toast = t;
    return toastText;
  });
  expect(r).toMatch(/offline/i);
  expect(r).toMatch(/still works/i);
  expect(errors).toEqual([]);
});

test('a second click cancels the in-flight request quietly', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page, { delayMs: 3000 });
  await primeApi(page);
  const r = await page.evaluate(async () => {
    const p = generateAIImage();                 // starts, button flips to Cancel
    await new Promise(r => setTimeout(r, 200));
    const midFlight = document.getElementById('ai-gen-btn').textContent;
    await generateAIImage();                     // second click = abort
    await p;
    return { midFlight,
      preview: document.getElementById('ai-preview').textContent,
      restored: document.getElementById('ai-gen-btn').textContent };
  });
  expect(r.midFlight).toMatch(/Cancel/);
  expect(r.preview).toMatch(/Cancelled/);
  expect(r.restored).toMatch(/Generate via API/);
  expect(errors).toEqual([]);
});

// ── Connect flow ──────────────────────────────────────────────

test('Connect validates with a free models call and shows the key suffix', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page);
  const r = await page.evaluate(async () => {
    document.getElementById('gemini-api-key').value = 'AIzaTestKey9876';
    await connectGemini();
    return { status: document.getElementById('ai-key-status').textContent,
             stored: localStorage.getItem('fl-gemini-key') };
  });
  const validate = captured.find(c => c.method === 'GET');
  expect(validate.url).toContain('/v1/models');
  expect(r.status).toContain('Connected · key ending …9876');
  // "connected" must not read as "ready to spend" — billing is stated right there
  expect(r.status).toMatch(/billing/i);
  expect(r.stored).toBe('AIzaTestKey9876');
  expect(errors).toEqual([]);
});

test('session-only mode never writes the key to localStorage', async ({ page }) => {
  const errors = await loadApp(page);
  await stubGemini(page);
  const r = await page.evaluate(async () => {
    localStorage.removeItem('fl-gemini-key');
    document.getElementById('ai-key-session-only').checked = true;
    document.getElementById('gemini-api-key').value = 'AIzaEphemeral111';
    await connectGemini();
    return { stored: localStorage.getItem('fl-gemini-key'),
             usable: _geminiKeyNow() === 'AIzaEphemeral111' };
  });
  expect(r.stored).toBeNull();
  expect(r.usable).toBe(true);
  expect(errors).toEqual([]);
});

// ── The bridge ────────────────────────────────────────────────

test('the bridge copies the prompt, arms, and tags the pasted image as AI', async ({ page }) => {
  const errors = await loadApp(page);
  // Stub clipboard + window.open: the test asserts what FigureLab does, not Gemini.
  await page.addInitScript(() => {
    window.__copied = null; window.__opened = null;
    navigator.clipboard.writeText = async t => { window.__copied = t; };
    window.open = u => { window.__opened = u; return null; };
  });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  const r = await page.evaluate(async () => {
    document.getElementById('layout-mode').value = 'freeform';
    setLayoutMode('freeform');
    freeformElements.length = 0;
    document.getElementById('ai-prompt').value = 'CRISPR mechanism overview';
    await startGeminiBridge();
    const armed = {
      copied: window.__copied, opened: window.__opened,
      waitShown: document.getElementById('ai-bridge-wait').style.display !== 'none',
    };
    // Simulate the image coming back from the Gemini tab as a pasted PNG blob
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    _bridgePaste(new Blob([bytes], { type: 'image/png' }));
    await new Promise(r => setTimeout(r, 200));
    const el = freeformElements[0];
    return { armed,
      el: el && { type: el.type, aiGenerated: el.aiGenerated, aiEngine: el.aiEngine,
                  prompt: el.aiPrompt },
      disarmed: _bridgeArmed === null,
      waitHidden: document.getElementById('ai-bridge-wait').style.display === 'none' };
  });
  expect(r.armed.copied).toContain('CRISPR mechanism overview');
  expect(r.armed.opened).toBe('https://gemini.google.com/app');
  expect(r.armed.waitShown).toBe(true);
  expect(r.el.type).toBe('aiicon');
  expect(r.el.aiGenerated).toBe(true);
  expect(r.el.aiEngine).toBe('gemini-app');
  expect(r.el.prompt).toBe('CRISPR mechanism overview');
  expect(r.disarmed).toBe(true);
  expect(r.waitHidden).toBe(true);
  expect(errors).toEqual([]);
});

test('cancelling the bridge means the next paste is a normal import again', async ({ page }) => {
  const errors = await loadApp(page);
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async () => {};
    window.open = () => null;
  });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  const r = await page.evaluate(async () => {
    document.getElementById('ai-prompt').value = 'anything';
    await startGeminiBridge();
    cancelGeminiBridge();
    return { disarmed: _bridgeArmed === null,
             btnBack: document.getElementById('ai-bridge-btn').style.display !== 'none' };
  });
  expect(r).toEqual({ disarmed: true, btnBack: true });
  expect(errors).toEqual([]);
});

test('the bridge never touches the network', async ({ page }) => {
  const errors = await loadApp(page);
  const captured = await stubGemini(page);        // would capture ANY Gemini API call
  let external = 0;
  await page.route('**://gemini.google.com/**', route => { external++; route.abort(); });
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async () => {};
    window.open = () => null;                     // the tab-open is stubbed out too
  });
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function');
  await page.evaluate(async () => {
    document.getElementById('ai-prompt').value = 'sends nothing';
    await startGeminiBridge();
    const b64 = 'iVBORw0KGgoAAAABJRU5ErkJggg==';   // invalid png is fine — decode failure still no network
    try { _bridgePaste(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' })); } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  });
  expect(captured.length).toBe(0);                // the strongest privacy claim, tested
  expect(external).toBe(0);
  expect(errors).toEqual([]);
});

// ── Copy honesty ──────────────────────────────────────────────

test('the fabrication-inviting photorealistic-microscopy style is gone', async ({ page }) => {
  const errors = await loadApp(page);
  const styles = await page.evaluate(() =>
    [...document.getElementById('ai-style').options].map(o => o.value + o.textContent).join('|'));
  expect(styles).not.toMatch(/photorealistic microscopy/i);
  expect(errors).toEqual([]);
});

test('the key helper text no longer claims generation is free', async ({ page }) => {
  const errors = await loadApp(page);
  const txt = await page.evaluate(() => document.getElementById('ai-key-status').textContent);
  expect(txt).toMatch(/free to create/i);
  expect(txt).toMatch(/billing/i);
  expect(txt).not.toMatch(/free key/i);
  expect(errors).toEqual([]);
});
