# Publication-Quality Audit — FigureLab

Audit of `figure_lab.html` against a journal figure-submission rubric (300–1200 dpi,
scale bars, panel labels, colour/fonts, lossless source handling). This branch makes
only **safe, surgical, verifiable-by-construction** changes. Nothing was applied that
would require a running app to confirm it doesn't break the canvas pipeline.

## What FigureLab already does well

The export pipeline is mature. Before changing anything, note the tool already supports:

- **True high-DPI export** via `renderExportCanvas(dpi)` — raster exports are re-rendered
  on a supersampled off-screen canvas (scale = dpi/96), not merely tagged. Guarded at
  ~60 MP so large exports degrade gracefully instead of crashing.
- **Multiple formats**: PNG, JPEG, WebP, uncompressed **TIFF** (with XResolution/YResolution
  DPI tags), **PDF**, and **SVG** with real vector `<text>` for every label/scale-bar
  (so text never pixelates).
- **Scale bars with calibration**: per-panel µm/px, two-point calibration modal, auto
  scale-bar detection, TIFF/LSM metadata reading, and "Match Physical Scale" across panels.
- **Panel labels** (A/B/C via `nextLabel()`), draggable/resettable, with font/size/bold/italic
  controls, plus a "Publication" quick preset.
- **PNG tEXt metadata** and a full reproducibility log (R/Python script export, action log).
- **Export health check** that already warns when DPI < 300.

## Changes made in this branch

### 1. PNG now embeds a standard `pHYs` resolution chunk (the main fix)
`figure_lab.html` — `embedPNGMetadata()` (~line 6352) and its caller
`exportPNGWithMeta()` (~line 6418).

**Problem:** the *actual* PNG export path (`exportPNGWithMeta` → `embedPNGMetadata`)
injected only `tEXt` chunks, including a `"DPI"` **text string**. It did **not** write
the `pHYs` chunk. Image editors (Photoshop, GIMP, ImageJ/FIJI) and journal submission
systems read a PNG's physical resolution from `pHYs`, not from a text field. So a 300-
or 600-dpi FigureLab PNG opened in an editor reported the browser default (72 dpi) at a
giant pixel size — a real publication gap despite the pixels themselves being high-res.
(A correct `pHYs` writer, `exportPNGwithDPI`, existed in the file but was **dead/unused**.)

**Fix:** `embedPNGMetadata` now takes the `dpi` argument and prepends a spec-correct
`pHYs` chunk (pixels-per-metre, unit = metre) ahead of the `tEXt` chunks and before the
first `IDAT`. If the browser already emitted a default `pHYs`, it is detected and
**replaced** (not duplicated) so there is exactly one, carrying the true DPI.

**Verification (offline, by construction — app not run):** a standalone Node reproduction
of the exact insertion algorithm on a synthetic PNG (containing a browser-style 72-dpi
`pHYs`) produced chunk order `IHDR, pHYs, IDAT, IEND`, exactly one `pHYs`, correct
pixels-per-metre (23622 for 600 dpi), valid CRC32, correctly ordered before `IDAT`, and
buffer-length arithmetic that balances in both the replace and no-pre-existing cases.
The whole inline `<script>` was also confirmed to parse with zero syntax errors.

### 2. Added a 1200 dpi "line art" export option
`figure_lab.html` — Export DPI `<select>` (~line 637).

Rubric calls for 600–1200 dpi for line art / combination figures. The dropdown capped at
600. Added `1200 (line art)`. Safe because the pipeline already clamps oversized renders
to ~60 MP with a user-facing toast, so requesting 1200 dpi cannot crash — it just caps.

## Prioritised recommendations NOT implemented (need a running app to verify safely)

1. **Lossless PDF option (high value).** `exportPDF()` (~line 4545) embeds the figure as
   **JPEG** (`/DCTDecode`, quality 0.92). For line art, blots, and sharp panel text a lossy
   PDF is a genuine quality loss and can introduce ringing artefacts around edges — some
   journals reject JPEG-in-PDF for line art. Recommend a Flate-compressed `DeviceRGB`
   (`/FlateDecode`) image stream, or a PDF that embeds the SVG vector layer, as a "lossless
   PDF" choice. Not applied: it materially rewrites the PDF byte-writer and must be opened
   in real PDF viewers (Acrobat, Preview, print RIP) to confirm validity.

2. **CMYK / colour-profile handling.** Print journals often want CMYK or a tagged colour
   profile; all exports here are sRGB/DeviceRGB with no ICC profile. Embedding an sRGB ICC
   profile (PNG `iCCP`, PDF `/ColorSpace`) would improve colour fidelity. Non-trivial and
   unverifiable offline.

3. **Colourblind-safe LUT defaults.** LUTs exist (`im.lut`), but confirm the default
   palette for multi-channel merges favours colourblind-safe pairs (e.g. magenta/green
   instead of red/green). Worth a UI nudge or default change; requires seeing the LUT list
   and merge UI in action.

4. **Font embedding in SVG/PDF.** SVG `<text>` references font families by name
   (`system-ui, sans-serif`) rather than embedding the font, so exact glyphs depend on the
   opener's installed fonts. For fully portable vector output, embed the font or convert
   text to outlines. Needs runtime rendering to validate.

5. **Remove dead code.** `exportPNGwithDPI()` (~line 4404) is now redundant with the fixed
   `embedPNGMetadata` and is not called anywhere. Safe to delete in a follow-up; left in
   place here to keep this branch minimal.

## Caveats
- The app was **not executed** (single-file canvas app, no runtime here). Changes 1 and 2
  are byte-level / markup-level and were validated offline as described. Anything requiring
  visual/canvas confirmation was deliberately left as a recommendation, not applied.
- No raw `innerHTML` of user text was introduced; the pHYs change is pure typed-array byte
  manipulation and the DPI option is a static `<option>`.

---

## Status as of v3.13.1 (September 2026)

These notes record a specific branch and are left as written. What follows is where
each item stands now, after the September 2026 independent audit (`AUDIT-2026-09.md`).

**Change 1 (`pHYs`) — correct, but it was fed a wrong number for a year.** The writer
itself was right, and the offline byte-level verification above was sound. What the
notes could not see without running the app is where the `dpi` argument came from:
`renderExportCanvas` computed it as `Math.round(scale*96)`, which is the true
resolution only when no printed width is chosen. With a journal column width set, the
`pHYs` chunk carried a resolution unrelated to the figure — a 183 mm / 300 DPI export
was tagged 210 dpi and claimed 261 mm. Fixed; the DPI is now derived from the physical
width the canvas actually has. The lesson is the notes' own caveat made concrete: a
byte-level writer can be perfect and still write a wrong value.

**Change 2 (1200 dpi line art) — unchanged and working.**

**Recommendation 1 (lossless PDF) — implemented.** A `/FlateDecode` branch exists, is
exposed as a "PDF (lossless)" button, and is what the submission package ships. It was
*not* honoured by the multi-page PDF writer, which also rendered the un-supersampled
preview canvas. That path now uses the export canvas and the correct page size, and —
since the follow-up to v3.13.1 — the two writers are one: the multi-page export is
Flate-compressed by default and carries the same selectable text layer on every page.

**Recommendation 2 (ICC / colour profile) — partially, deliberately.** PNG carries
`sRGB` + `gAMA`, the lightweight alternative this document itself proposed. PDF is
still untagged `/DeviceRGB` and there is no CMYK path. Left as it is.

**Recommendation 3 (colourblind-safe LUT defaults) — implemented.** Okabe–Ito palettes,
magenta/green channel defaults, filename-based auto-channel assignment, and a CVD
preview that a test confirms never touches the export buffer.

**Recommendation 4 (font embedding) — not implemented, and now a documented decision.**
PDF uses the base-14 faces with WinAnsi encoding and deliberately leaves glyphs it
cannot represent (Greek, ≥, ✓, CJK) in the raster rather than substituting them, which
is the right call for scientific labels. One consequence is recorded in the README:
label advances are measured with the browser's own font, so a centred label can sit
~1 pt off centre.

**Recommendation 5 (remove dead `exportPNGwithDPI`) — implemented**, with a tombstone
comment pointing at `exportPNGWithMeta`.
