// @ts-check
// Window sizes. FigureLab is laid out for a desktop window, but people open it on a
// small laptop, on a tablet, or on a phone to look at a figure a colleague shared.
// At 375 px the fixed 310 px side panel used to leave the figure a 55 px strip (the
// preview was 17 px wide), push Help and the theme button off the right edge, and
// scroll the whole page sideways. These pin the page inside the window at every
// width, the side panel as a drawer below 900 px, and the desktop layout unchanged.
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

const WIDTHS = [[1440, 900], [1024, 768], [768, 1024], [375, 812]];

// Three 400×300 panels, committed through the real path — the same figure the
// desktop boxes below were measured on.
async function seed(page) {
  await page.evaluate(async () => {
    for (const f of ['c33', '3c3', '33c']) {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const x = c.getContext('2d'); x.fillStyle = '#' + f; x.fillRect(0, 0, 400, 300);
      const src = c.toDataURL();
      await new Promise(r => { const i = new Image(); i.onload = () => { _commitImage(i, src, `p${f}.png`); r(); }; i.src = src; });
    }
    render();
  });
  await page.waitForFunction(() => Array.isArray(panelBounds) && panelBounds.length > 0);
  await page.waitForTimeout(250);   // the ResizeObserver fit lands a frame later
}
const quiet = page => page.addInitScript(() => {
  try { localStorage.setItem('fl-onboarded', '1'); localStorage.setItem('fl-tour-done', '1'); localStorage.setItem('fl-hints-seen', '1'); } catch (e) {}
});
const rect = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s); if (!e) return null;
  const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
}, sel);
const inView = (b, W, H) => b && b.w > 0 && b.l >= -0.5 && b.r <= W + 0.5 && b.t >= -0.5 && b.b <= H + 0.5;

for (const [W, H] of WIDTHS) {
  test(`${W}×${H}: no sideways scroll, and Help, theme and ⌘K are on-screen and work`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await quiet(page);
    const errors = await loadApp(page);
    await seed(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(W);
    for (const id of ['#cmd-btn', '#help-btn', '#theme-btn']) {
      expect(inView(await rect(page, id), W, H), `${id} on-screen`).toBe(true);
    }
    // Every toolbar control stays inside the window: the bar wraps, it never runs off.
    const off = await page.evaluate(w => [...document.querySelectorAll('.canvas-toolbar button, .canvas-toolbar select')]
      .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < -0.5 || b.right > w + 0.5); })
      .map(e => e.textContent.trim()), W);
    expect(off).toEqual([]);
    await page.click('#help-btn');
    await expect(page.locator('#help-modal')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-modal')).not.toHaveClass(/open/);
    const t0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.click('#theme-btn');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).not.toBe(t0);
    await page.click('#cmd-btn');
    await expect(page.locator('#cmd-palette')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
}

for (const [W, H] of [[768, 1024], [375, 812]]) {
  test(`${W}×${H}: with the drawer closed the figure takes the width, and Fit keeps it there`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await quiet(page);
    const errors = await loadApp(page);
    await seed(page);
    // A figure arriving closes the drawer by itself.
    expect(await page.evaluate(() => document.body.classList.contains('sb-open'))).toBe(false);
    let fig = await rect(page, '#fig-canvas');
    expect(fig.w).toBeGreaterThanOrEqual(0.6 * W);
    expect(inView(fig, W, H)).toBe(true);
    // ⊡ Fit used to scale from the backing store, shrinking a CSS-narrowed figure a
    // second time (116 px wide at 375). It now fits what is on screen.
    await page.evaluate(() => zoomToFit());
    fig = await rect(page, '#fig-canvas');
    expect(fig.w).toBeGreaterThanOrEqual(0.6 * W);
    expect(inView(fig, W, H)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${W}×${H}: the ☰ button opens and closes the side panel`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await quiet(page);
    const errors = await loadApp(page);
    // Nothing to look at yet, so the drawer starts open — that is where you add images.
    expect(await page.evaluate(() => document.body.classList.contains('sb-open'))).toBe(true);
    expect(inView(await rect(page, '.sidebar'), W, H)).toBe(true);
    await seed(page);
    const side = page.locator('.sidebar');
    await expect(side).not.toBeInViewport();
    await page.click('#sb-toggle');
    await expect(page.locator('#sb-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(side).toBeInViewport();
    expect(inView(await rect(page, '.sidebar'), W, H)).toBe(true);
    await page.locator('#cols').click();                       // its controls take input
    await page.click('#sb-toggle');
    await expect(page.locator('#sb-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(side).not.toBeInViewport();
    // A tap beside the open drawer closes it too.
    await page.click('#sb-toggle');
    await page.mouse.click(W - 10, H / 2);
    expect(await page.evaluate(() => document.body.classList.contains('sb-open'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(W);
    expect(errors).toEqual([]);
  });
}

test('1024×768: the side panel stays beside the canvas and there is no ☰ button', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await quiet(page);
  await loadApp(page);
  await seed(page);
  const side = await rect(page, '.sidebar');
  expect([side.l, side.w]).toEqual([0, 310]);
  expect(await page.locator('#sb-toggle').isVisible()).toBe(false);
  // The canvas still has the rest of the window.
  expect((await rect(page, '.canvas-area')).l).toBe(310);
});

for (const [W, H] of [[768, 1024], [375, 812]]) {
  test(`${W}×${H}: help, the compliance report and the crop editor fit the window`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await quiet(page);
    const errors = await loadApp(page);
    await seed(page);
    await page.click('#help-btn');                            // reached from the header, as a reader would
    const help = await rect(page, '#help-modal .modal');
    expect(inView(help, W, H)).toBe(true);
    // Long help scrolls inside its body, not the page.
    expect(await page.evaluate(() => { const b = document.querySelector('#help-modal .help-body'); return b.scrollHeight > b.clientHeight && getComputedStyle(b).overflowY; })).toBe('auto');
    await page.keyboard.press('Escape');
    await page.evaluate(() => checkCompliance());
    expect(inView(await rect(page, '#info-modal-bg > div'), W, H)).toBe(true);
    await page.evaluate(() => document.getElementById('info-modal-bg').remove());
    await page.evaluate(() => openCropModal(0));
    expect(inView(await rect(page, '#crop-modal .modal'), W, H)).toBe(true);
    expect(inView(await rect(page, '#crop-ed-canvas'), W, H)).toBe(true);
    await page.evaluate(() => closeCropModal());
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(W);
    expect(errors).toEqual([]);
  });

  test(`${W}×${H}: tutorial cards stay on-screen and ring a control you can see`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await quiet(page);
    const errors = await loadApp(page);
    await seed(page);
    page.on('dialog', d => d.accept());        // "replace the current figure?" — yes
    // Walk the quick tour and the straighten-and-crop tutorial. Every card must sit
    // inside the window; every target it rings must be on-screen and not under the
    // drawer — the drawer opens for steps inside the side panel and closes for the rest.
    const log = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const card = async () => { for (let i = 0; i < 120; i++) { const c = document.getElementById('tour-card'); if (c && c.style.visibility === 'visible') return c; await wait(25); } return null; };
      const out = [];
      const check = (c, step, tag) => {
        const b = c.getBoundingClientRect();
        const e = { tag, title: step.title, card: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight };
        const el = _tourTarget(step); const t = el && el.getBoundingClientRect();
        if (t && t.width > 0 && t.height > 0) {
          const x = Math.min(Math.max(t.left + t.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(t.top + Math.min(t.height / 2, 12), 1), innerHeight - 1);
          e.onScreen = t.left > -8 && t.right < innerWidth + 8 && t.top < innerHeight && t.bottom > 0;
          const hit = document.elementsFromPoint(x, y).find(n => !n.closest('#tour-ov'));
          // The figure is three stacked canvases; a hit on the overlay is a hit on the figure.
          const host = el.closest('#canvas-container') || el;
          e.reachable = !!hit && (host.contains(hit) || hit.contains(el));
          e.hit = hit ? (hit.id || hit.className || hit.tagName) : null;
        }
        return e;
      };
      startTour(true);
      for (let i = 0; i < TOUR_STEPS.length; i++) {
        const c = await card(); if (!c) { out.push({ tag: 'tour', i, err: 'no card' }); break; }
        out.push(check(c, TOUR_STEPS[i], 'tour ' + i));
        c.querySelector('#tour-next').click(); await wait(80);
      }
      await wait(150);
      await startTutorial('straighten');
      const T = TUTORIALS.find(t => t.id === 'straighten');
      for (let i = 0; i < T.steps.length; i++) {
        const c = await card(); if (!c) { out.push({ tag: 'straighten', i, err: 'no card' }); break; }
        out.push(check(c, T.steps[i], 'straighten ' + i));
        const act = c.querySelector('#tour-act');
        if (act) { act.click(); for (let k = 0; k < 80 && _tourI === i && document.getElementById('tour-ov'); k++) await wait(50); }
        else { c.querySelector('#tour-next').click(); await wait(80); }
      }
      return out;
    });
    expect(log.length).toBeGreaterThan(8);
    for (const e of log) {
      expect(e.err, e.tag).toBeUndefined();
      expect(e.card, `${e.tag} "${e.title}": card off-screen`).toBe(true);
      // A step whose target has no box (none here today) gets the centred card instead.
      if ('onScreen' in e) {
        expect(e.onScreen, `${e.tag} "${e.title}": target off-screen`).toBe(true);
        expect(e.reachable, `${e.tag} "${e.title}": target covered by ${e.hit}`).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(W);
    expect(errors).toEqual([]);
  });
}

// Desktop must not move. These boxes were measured at 1440×900 on this exact figure
// before the narrow-window rules went in; nothing above 1279 px may shift a pixel.
test('1440×900: the desktop layout is exactly as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await quiet(page);
  const errors = await loadApp(page);
  await seed(page);
  const MEASURED = {
    'header': [0, 0, 1440, 49],
    '.logo': [18, 9, 91.5, 30],
    '.hdr-right': [836, 13.5, 586, 21],
    '#kb-hint': [836, 16.5, 475.6, 15],
    '#cmd-btn': [1319.7, 14.5, 30.3, 19],
    '#help-btn': [1358, 13.5, 28, 21],
    '#theme-btn': [1394, 13.5, 28, 21],
    '.sidebar': [0, 49, 310, 823.5],
    '.canvas-area': [310, 49, 1130, 823.5],
    '.canvas-toolbar': [310, 49, 1130, 67],
    '#render-btn': [322, 57, 79.4, 26],
    '#canvas-wrap': [310, 116, 1130, 732.5],
    '#fig-canvas': [381, 151.3, 988, 662],
    '.status-bar': [310, 848.5, 1130, 24],
    'footer': [0, 872.5, 1440, 27.5],
  };
  const got = await page.evaluate(sels => Object.fromEntries(sels.map(s => {
    const b = document.querySelector(s).getBoundingClientRect();
    return [s, [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10)];
  })), Object.keys(MEASURED));
  for (const [s, want] of Object.entries(MEASURED)) {
    got[s].forEach((v, i) => expect(Math.abs(v - want[i]), `${s} [${i}] ${v} vs ${want[i]}`).toBeLessThanOrEqual(0.6));
  }
  expect(await page.evaluate(() => zoom)).toBe(1);
  expect(await page.locator('#sb-toggle').isVisible()).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  expect(errors).toEqual([]);
});
