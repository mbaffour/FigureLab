// @ts-check
const path = require('path');
const APP_URL = 'file://' + path.resolve(__dirname, '..', 'figure_lab.html');

/**
 * Load the app and attach a console/page-error collector.
 * Returns an `errors` array that should be empty at test end.
 */
async function loadApp(page) {
  const errors = [];
  // Ignore environmental network failures (e.g. Google Fonts CDN blocked in CI —
  // the app has offline font fallbacks). Only collect real app JS errors.
  const envNoise = /Failed to load resource|net::ERR|ERR_CERT|favicon/i;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !envNoise.test(m.text())) errors.push('console.error: ' + m.text());
  });
  await page.goto(APP_URL);
  // Wait until the app's globals are defined (classic script, top-level lexical bindings).
  await page.waitForFunction(() => typeof render === 'function' && typeof _commitImage === 'function');
  return errors;
}

/**
 * Seed N grid panels by generating distinct solid-colour images in-page and
 * committing them through the real _commitImage path (bypasses the pre-crop
 * modal for speed/determinism). Each panel gets a unique mean grey so analysis
 * assertions can tell them apart. Then renders synchronously.
 */
async function seedPanels(page, n = 4) {
  await page.evaluate(async (count) => {
    const mk = (i) => {
      const c = document.createElement('canvas'); c.width = 100; c.height = 100;
      const x = c.getContext('2d');
      const g = 30 + i * 40;                       // distinct grey per panel
      x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(0, 0, 100, 100);
      x.fillStyle = '#fff'; x.fillRect(10, 10, 20, 20); // small marker
      return c.toDataURL('image/png');
    };
    for (let i = 0; i < count; i++) {
      const src = mk(i);
      await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => { _commitImage(img, src, `panel${i}.png`); res(); };
        img.onerror = rej;
        img.src = src;
      });
    }
    render();
  }, n);
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
}

/** Set a grid/layout input by id and trigger its handlers, then render. */
async function setInput(page, id, value, evt = 'input') {
  await page.evaluate(({ id, value, evt }) => {
    const el = document.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new Event(evt, { bubbles: true }));
    render();
  }, { id, value, evt });
}

/** Read a snapshot of internal state for assertions. */
async function state(page) {
  return page.evaluate(() => ({
    nImages: images.length,
    labels: images.map(i => i && i.label),
    panelBounds: panelBounds.map(b => ({ idx: b.idx, x: b.x, y: b.y, w: b.w, h: b.h })),
    canvasLogicalW, canvasLogicalH,
    figW: document.getElementById('fig-canvas').width,
    figH: document.getElementById('fig-canvas').height,
    gapH: gi('gap-h'), gapV: gi('gap-v'),
    colGaps: colGaps ? colGaps.slice() : null,
    rowGaps: rowGaps ? rowGaps.slice() : null,
    advancedSpacing,
    undoLen: undoStack.length, redoLen: redoStack.length,
    layoutMode,
  }));
}

/** Dispatch a mouse gesture on #ann-canvas in LOGICAL canvas coordinates. */
async function gesture(page, type, pts) {
  await page.evaluate(({ type, pts }) => {
    const c = document.getElementById('ann-canvas');
    const r = c.getBoundingClientRect();
    const lw = canvasLogicalW || c.width, lh = canvasLogicalH || c.height;
    const toC = ([x, y]) => ({ clientX: r.left + x * r.width / lw, clientY: r.top + y * r.height / lh });
    const fire = (t, p) => c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.clientX, clientY: p.clientY, button: 0 }));
    if (type === 'drag') {
      fire('mousedown', toC(pts[0]));
      for (let i = 1; i < pts.length; i++) fire('mousemove', toC(pts[i]));
      fire('mouseup', toC(pts[pts.length - 1]));
    } else if (type === 'dblclick') {
      fire('dblclick', toC(pts[0]));
    } else {
      fire('mousedown', toC(pts[0])); fire('mouseup', toC(pts[0]));
    }
  }, { type, pts });
}

/** Centre (logical) of a panel by index, from panelBounds. */
async function panelCenter(page, idx = 0) {
  return page.evaluate((i) => {
    const b = panelBounds.find(p => p.idx === i) || panelBounds[i];
    return [b.x + b.w / 2, b.y + b.h / 2];
  }, idx);
}

module.exports = { APP_URL, loadApp, seedPanels, setInput, state, gesture, panelCenter };
