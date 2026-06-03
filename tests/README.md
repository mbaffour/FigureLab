# FigureLab tests

End-to-end tests that run the real app in headless Chromium via Playwright.
These are **dev-only** — the app itself (`figure_lab.html`) stays a single,
dependency-free HTML file.

## Run

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

The app is loaded directly over `file://` (no server needed). Any uncaught
page error or `console.error` (other than environmental network noise like a
blocked Google-Fonts CDN) fails the suite.

## What's covered (`figurelab.spec.js`)

- **Pure helpers** — gutter offset math (uniform + per-gutter overrides) and
  `cloneImageForUndo` (img-ref preservation, deep copy, cache drop).
- **Grid geometry** — canvas size matches the documented layout formula.
- **Drag-to-space** — dragging a gutter grows the gap; advanced per-gutter mode
  overrides a single gutter; reset clears.
- **Labels** — one-click toggle adds/removes headers and resizes the canvas.
- **On-image text** — double-click adds a panel-bound text annotation (with
  halo) that follows the panel on reorder.
- **Undo/redo** — delete→undo restores the image *with its pixels*; redo
  re-applies; resize no-ops don't create spurious steps; label edits are
  undoable.
- **Export** — PNG is genuinely higher-resolution at higher DPI (true
  supersample); every format (PNG/JPEG/WebP/TIFF/PDF/SVG) produces output.
- **Measurement integrity (critical)** — the `#fig-canvas` analysis buffer is
  byte-identical at `deviceScaleFactor` 1 vs 2, while the `#fig-canvas-hd`
  display layer engages only at 2× — proving the HiDPI preview never corrupts
  ROI/intensity/area measurements.
- **Session save/load** — round-trips layout, gutters, and adjustments.
- **Error handling** — a corrupt image surfaces an error toast without hanging.

## Notes

- `helpers.js` seeds panels through the real `_commitImage` path and drives
  interactions in **logical canvas coordinates** (matching `canvasCoords`).
- Tests run with `workers: 1` for determinism (single shared app file).
