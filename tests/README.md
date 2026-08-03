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

## Source encoding (`encoding.spec.js`)

The only spec that never opens a browser — it reads the repo's text files as bytes.

Cutting v3.9.4 I edited `figure_lab.html`, `README.md` and `CITATION.cff` through a
PowerShell round-trip. Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI, so
`Get-Content -Raw` returned every non-ASCII character as its raw bytes and
`Set-Content -Encoding utf8` re-encoded them — double-encoding 519 em-dashes, 4088
box-drawing rules and 80 micron signs, and adding a BOM. It committed and pushed
cleanly, and **the entire suite still passed**: mojibake is valid UTF-8, the page
parses, and nothing was looking at bytes.

So this file does. For each character the repo actually contains it derives the
CP1252 mojibake sequence and fails on any hit, on a UTF-8 BOM, on invalid UTF-8, on a
missing `<meta charset>`, on a version that disagrees across the three release files,
and on a `CITATION.cff` with no DOI for the version it claims to be.

Its self-test is pinned to `fixtures/mojibake-sample.txt` — twelve lines lifted
verbatim from the corrupted commit, not a simulation. The first draft synthesised the
corruption with `Buffer.toString('latin1')` and gave a wrong answer, because Latin-1
and CP1252 disagree over `0x80`–`0x9F` and PowerShell used CP1252. Simulating the bug
tests your model of the bug.

**Don't edit repo text files through PowerShell.** Use an editor that is UTF-8 aware.
PowerShell is fine for `git`, `gh` and `npx`.

## Notes

- `helpers.js` seeds panels through the real `_commitImage` path and drives
  interactions in **logical canvas coordinates** (matching `canvasCoords`).
- Tests run with `workers: 1` for determinism (single shared app file).
