// Shared helpers for the guide verification scripts in docs/guides/verify/.
//
// Each script follows one guide through the visible UI of figure_lab.html: it clicks
// buttons by their visible text or role, picks files through the real file choosers,
// types into fields, and then checks the result (app state, an exported file, and a
// screenshot to look at). Inputs are synthetic and generated on every run.
//
// Run from the repository root, e.g.
//   NODE_PATH=tests/node_modules node docs/guides/verify/western-blot.verify.js
// Output (inputs, downloads, screenshots, a log) goes to docs/guides/verify/out/<guide>/.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_URL = 'file://' + path.join(ROOT, 'figure_lab.html');
const IMG_DIR = path.resolve(__dirname, '..', 'img');

// ---------------------------------------------------------------- run harness

/** Start a browser on the app. Returns a context object used by every helper. */
async function start(guide, { width = 1440, height = 900 } = {}) {
  const out = path.join(__dirname, 'out', guide);
  fs.rmSync(out, { recursive: true, force: true });
  for (const d of ['inputs', 'downloads', 'shots']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, deviceScaleFactor: 1 });
  // Headless Chromium never answers the native "Save as" picker; without it the app
  // uses its ordinary download path (the one Firefox and Safari use).
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const T = { guide, out, browser, context, page, errors: [], results: [], downloads: [], dialogs: [] };
  page.on('pageerror', e => T.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND/.test(m.text())) T.errors.push('console.error: ' + m.text()); });
  page.on('dialog', async d => { T.dialogs.push(d.message()); await d.accept(); });
  page.on('download', async d => {
    const f = path.join(out, 'downloads', d.suggestedFilename());
    await d.saveAs(f); T.downloads.push(f);
  });
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof render === 'function');
  await recordToasts(page);
  await page.waitForTimeout(300);
  return T;
}

/** Run one guide step. A failure is recorded and the run continues with the next step. */
async function step(T, name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    T.results.push({ name, ok: true, note: note == null ? '' : String(note), ms: Date.now() - t0 });
    console.log(`  ok    ${name}${note ? '  — ' + note : ''}`);
  } catch (e) {
    T.results.push({ name, ok: false, note: String(e && e.message || e).split('\n')[0], ms: Date.now() - t0 });
    console.log(`  FAIL  ${name}  — ${String(e && e.message || e).split('\n')[0]}`);
    try { await T.page.screenshot({ path: path.join(T.out, 'shots', 'FAIL-' + slug(name) + '.png') }); } catch (_) {}
    try { await T.page.keyboard.press('Escape'); } catch (_) {}
  }
}

async function finish(T) {
  const failed = T.results.filter(r => !r.ok);
  const lines = T.results.map(r => `${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.note ? '  — ' + r.note : ''}`);
  if (T.errors.length) lines.push('', 'Page errors:', ...T.errors.slice(0, 20));
  fs.writeFileSync(path.join(T.out, 'result.txt'), lines.join('\n') + '\n');
  console.log(`\n${T.guide}: ${T.results.length - failed.length}/${T.results.length} steps passed` +
    (T.errors.length ? `, ${T.errors.length} page error(s) (see out/${T.guide}/result.txt)` : ''));
  await T.browser.close();
  process.exitCode = failed.length ? 1 : 0;
}

function expect(cond, msg) { if (!cond) throw new Error(msg || 'expectation failed'); }
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---------------------------------------------------------------- UI helpers

/** Open a sidebar section (Images, Arrange, Crop & Scale, Annotate & Draw, Look, Measure, Check, Export). */
async function openSection(T, name) {
  const summary = T.page.locator('details > summary').filter({ hasText: new RegExp('^\\s*' + esc(name)) }).first();
  const open = await summary.evaluate(s => s.parentElement.open);
  if (!open) await summary.click();
  await summary.scrollIntoViewIfNeeded();
  return summary.locator('xpath=..');
}

/** Press Ctrl/⌘+K, type a phrase, and (optionally) press Enter on the top hit. Returns the hit list. */
async function cmdk(T, phrase, { enter = true, pick } = {}) {
  const p = T.page;
  await p.keyboard.press('ControlOrMeta+k');
  const box = p.locator('#cmdp-input');
  await box.waitFor({ state: 'visible', timeout: 3000 });
  await box.fill(phrase);
  await p.waitForTimeout(250);
  const hits = await p.evaluate(() => [...document.querySelectorAll('#cmdp-list .cmdp-item')]
    .map(li => li.innerText.replace(/\s+/g, ' ').trim()).slice(0, 8));
  if (pick) {
    await p.locator('#cmdp-list .cmdp-item').filter({ hasText: pick }).first().click();
  } else if (enter) {
    await p.keyboard.press('Enter');
  } else {
    await p.keyboard.press('Escape');
  }
  await p.waitForTimeout(300);
  return hits;
}

/** Click a control that opens a file chooser, and give it files. */
async function pickFiles(T, trigger, files) {
  const [fc] = await Promise.all([T.page.waitForEvent('filechooser', { timeout: 5000 }), trigger.click()]);
  await fc.setFiles(files);
  await T.page.waitForTimeout(500);
}

/** Wait until a download appears whose name matches re (after an action). Returns its path. */
async function download(T, action, re = /./, timeout = 30000) {
  const n0 = T.downloads.length;
  await action();
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = T.downloads.slice(n0).find(x => re.test(path.basename(x)));
    if (f && fs.existsSync(f) && fs.statSync(f).size > 0) { await T.page.waitForTimeout(150); return f; }
    await T.page.waitForTimeout(200);
  }
  throw new Error('no download matching ' + re);
}

/** Keep every toast message the app shows in window.__toasts (they vanish after ~3 s). */
async function recordToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const el = document.getElementById('toast');
    if (!el) return;
    new MutationObserver(() => { const t = el.textContent.trim(); if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t); })
      .observe(el, { childList: true, characterData: true, subtree: true });
  });
}
/** Toast messages shown since the last call (or all, with { all: true }). */
async function toasts(T, { all = false } = {}) {
  const list = await T.page.evaluate(() => window.__toasts || []);
  const from = all ? 0 : (T._toastSeen || 0); T._toastSeen = list.length;
  return list.slice(from).join(' | ');
}

/** A visible button whose text contains `text` (string or RegExp), optionally inside a container. */
function btn(T, text, within) {
  return (within || T.page).locator('button:visible', { hasText: text }).first();
}

/** The open modal dialog (the top one), or a modal by id. */
function modal(T, id) {
  return id ? T.page.locator('#' + id) : T.page.locator('.modal-bg.open').last();
}

/** Visible text of buttons, labels and options inside a container: for writing exact labels. */
async function labels(T, container) {
  return (container || T.page.locator('body')).evaluate(el => [...el.querySelectorAll('button, label, summary, h3, h4, option, .sec-label')]
    .filter(e => e.offsetParent || e.tagName === 'OPTION').map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
}

/** Use the toolbar's Save button for a format (PNG, PDF, PDF lossless, TIFF, SVG) and the dialog's Save. */
async function exportVia(T, fmt, { name, dpi } = {}) {
  await btn(T, new RegExp('^↓ ' + esc(fmt) + '$')).click();
  const m = T.page.locator('#preflight-modal');
  await m.waitFor({ state: 'visible' });
  if (name) await m.locator('#pf-name').fill(name);
  if (dpi) await m.locator('#pf-dpi').selectOption({ label: dpi });
  const text = await m.innerText();
  const f = await download(T, () => m.locator('button', { hasText: /^Save / }).first().click(), /./, 60000);
  return { file: f, dialogText: text };
}

/** Image list rows (panel names, badges) as text. */
async function panelRows(T) {
  return T.page.evaluate(() => [...document.querySelectorAll('#img-list > *')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
}

// ---------------------------------------------------------------- screenshots

/**
 * Screenshot a region (a locator, or a {x,y,width,height} clip) and save it under
 * out/<guide>/shots/<name>.png; with { doc: true } also into docs/guides/img/,
 * scaled down until it is under maxKB.
 */
async function shot(T, name, region, { doc = false, maxKB = 150, pad = 6 } = {}) {
  const p = T.page;
  let clip;
  if (region && typeof region.boundingBox === 'function') {
    await region.scrollIntoViewIfNeeded().catch(() => {});
    const bb = await region.boundingBox();
    if (!bb) throw new Error('screenshot region not visible: ' + name);
    clip = { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad), width: bb.width + 2 * pad, height: bb.height + 2 * pad };
  } else if (region) clip = region;
  const vp = p.viewportSize();
  if (clip) { clip.width = Math.min(clip.width, vp.width - clip.x); clip.height = Math.min(clip.height, vp.height - clip.y); }
  const buf = await p.screenshot(clip ? { clip } : {});
  const f = path.join(T.out, 'shots', name + '.png');
  fs.writeFileSync(f, buf);
  if (doc) {
    const small = await shrinkPng(T, buf, maxKB);
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMG_DIR, name + '.png'), small);
  }
  return f;
}

/** Re-encode a PNG at decreasing widths (and with fewer colours if needed) until it is under maxKB. */
async function shrinkPng(T, buf, maxKB) {
  if (buf.length <= maxKB * 1024) return buf;
  const pg = await T.context.newPage();
  try {
    for (const scale of [0.85, 0.7, 0.6, 0.5, 0.42, 0.35]) {
      const b64 = await pg.evaluate(async ({ src, scale }) => {
        const im = new Image(); im.src = src; await im.decode();
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
        return c.toDataURL('image/png').split(',')[1];
      }, { src: 'data:image/png;base64,' + buf.toString('base64'), scale });
      const out = Buffer.from(b64, 'base64');
      if (out.length <= maxKB * 1024) return out;
    }
    throw new Error('could not get screenshot under ' + maxKB + ' KB');
  } finally { await pg.close(); }
}

// ---------------------------------------------------------------- input generators

/**
 * Write a 16-bit greyscale TIFF. fn(x, y) returns 0..65535. With umPerPx the file carries
 * ImageJ calibration (ImageDescription unit=… and X/YResolution in pixels per unit), as
 * Fiji saves it. unit is 'micron' (default) or 'nm'.
 */
function writeTiff16(file, w, h, fn, { umPerPx = 0, unit = 'micron' } = {}) {
  const pix = Buffer.alloc(w * h * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.max(0, Math.min(65535, Math.round(fn(x, y))));
    pix.writeUInt16LE(v, (y * w + x) * 2);
  }
  const desc = umPerPx ? `ImageJ=1.54f\nimages=1\nunit=${unit}\n\0` : '';
  const perUnit = umPerPx ? (unit === 'nm' ? 1 / (umPerPx * 1000) : 1 / umPerPx) : 0;
  const tags = [];
  const add = (tag, type, count, value) => tags.push({ tag, type, count, value });
  add(256, 3, 1, w); add(257, 3, 1, h); add(258, 3, 1, 16); add(259, 3, 1, 1); add(262, 3, 1, 1);
  if (desc) add(270, 2, Buffer.byteLength(desc, 'latin1'), Buffer.from(desc, 'latin1'));
  add(273, 4, 1, 0); add(277, 3, 1, 1); add(278, 3, 1, h); add(279, 4, 1, pix.length);
  if (perUnit) { const num = Math.round(perUnit * 1e6); add(282, 5, 1, [num, 1e6]); add(283, 5, 1, [num, 1e6]); add(296, 3, 1, 1); }
  tags.sort((a, b) => a.tag - b.tag);
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = 8 + ifdSize; const blobs = [];
  for (const t of tags) {
    if (t.type === 2) { t.off = extra; blobs.push(t.value); extra += t.value.length + (t.value.length & 1); }
    if (t.type === 5) { const b = Buffer.alloc(8); b.writeUInt32LE(t.value[0], 0); b.writeUInt32LE(t.value[1], 4); t.off = extra; blobs.push(b); extra += 8; }
  }
  const pixOff = extra;
  const head = Buffer.alloc(8); head.write('II', 0, 'latin1'); head.writeUInt16LE(42, 2); head.writeUInt32LE(8, 4);
  const ifd = Buffer.alloc(ifdSize); ifd.writeUInt16LE(tags.length, 0);
  tags.forEach((t, i) => {
    const o = 2 + i * 12; ifd.writeUInt16LE(t.tag, o); ifd.writeUInt16LE(t.type, o + 2); ifd.writeUInt32LE(t.count, o + 4);
    if (t.tag === 273) ifd.writeUInt32LE(pixOff, o + 8);
    else if (t.type === 2 || t.type === 5) ifd.writeUInt32LE(t.off, o + 8);
    else if (t.type === 3) ifd.writeUInt16LE(t.value, o + 8);
    else ifd.writeUInt32LE(t.value, o + 8);
  });
  ifd.writeUInt32LE(0, ifdSize - 4);
  const parts = [head, ifd];
  for (const b of blobs) { parts.push(b); if (b.length & 1) parts.push(Buffer.alloc(1)); }
  parts.push(pix);
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

/** Deterministic pseudo-random numbers (LCG), so every run makes the same inputs. */
function rng(seed) { let s = seed >>> 0; return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/**
 * Draw an 8-bit RGB picture with a canvas function in a scratch page and save it as PNG
 * or JPEG. draw is a function `(ctx, w, h, rnd, params) => {...}` run in the browser; it
 * cannot see variables outside itself, so pass what it needs in `params`.
 */
async function canvasImage(T, file, w, h, draw, { type = 'image/png', quality = 0.92, seed = 1, params = {} } = {}) {
  const pg = await T.context.newPage();
  try {
    const b64 = await pg.evaluate(({ w, h, src, type, quality, seed, params }) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      let s = seed >>> 0; const rnd = () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
      (0, eval)('(' + src + ')')(ctx, w, h, rnd, params);
      return c.toDataURL(type, quality).split(',')[1];
    }, { w, h, src: draw.toString(), type, quality, seed, params });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  } finally { await pg.close(); }
  return file;
}

/** List and read entries of a ZIP (uses the system `unzip`). */
function zipList(file) {
  return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
}
function zipRead(file, entry) { return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 1 << 28 }); }

/** Read a PNG's size and pHYs (pixels per metre) from its header. */
function pngInfo(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  let dpi = 0; const i = buf.indexOf('pHYs');
  if (i > 0) dpi = Math.round(buf.readUInt32BE(i + 4) * 0.0254);
  return { w, h, dpi };
}
/** Read a baseline TIFF's size, compression and X resolution. */
function tiffInfo(buf) {
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const ifd = u32(4), n = u16(ifd), info = {};
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, tag = u16(o), type = u16(o + 2);
    const val = type === 3 ? u16(o + 8) : u32(o + 8);
    if (tag === 256) info.w = val; if (tag === 257) info.h = val; if (tag === 259) info.compression = val;
    if (tag === 277) info.spp = val;
    if (tag === 282) info.xres = u32(val) / u32(val + 4);
  }
  return info;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = {
  ROOT, APP_URL, IMG_DIR, start, step, finish, expect, openSection, cmdk, pickFiles, download, toasts, panelRows,
  btn, modal, labels, exportVia,
  shot, writeTiff16, rng, gauss, canvasImage, zipList, zipRead, pngInfo, tiffInfo, esc,
};
