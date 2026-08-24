# FigureLab v3.13.0

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/mbaffour/FigureLab/actions/workflows/ci.yml/badge.svg)](https://github.com/mbaffour/FigureLab/actions/workflows/ci.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21269456.svg)](https://doi.org/10.5281/zenodo.21269456)

A single HTML file for assembling publication-quality scientific figures. No installation, no server, no internet required — open in any browser and start working.

Works for microscopy images, western blots, histology, gels, clinical photos, or any image-based figure.

*Built with passion for science and discovery.*

---

## Screenshots

A figure assembled and exported entirely in the browser (via **✨ Load example figure**):

<table>
<tr>
<td width="55%"><img src="docs/screenshots/example-figure.png" alt="Fluorescence figure"></td>
<td width="45%"><img src="docs/screenshots/blot-example.png" alt="Western blot figure"></td>
</tr>
<tr>
<td><em>Fluorescence 2×2 (DAPI / GFP / mCherry / merge) with A–D labels and a calibrated scale bar. The colourblind-safe magenta/green merge shows colocalization in white.</em></td>
<td><em>Western-blot layout with lane numbers, an MW ladder, and a loading-control panel — assembled and exported in the browser.</em></td>
</tr>
</table>

<!-- To add live UI screenshots, drop empty-state.png / export-preflight.png into docs/screenshots/: open the app and use your OS screenshot tool. -->

## Quick Start

1. Open `figure_lab.html` in your browser (Chrome or Firefox recommended)
2. Drag images onto the drop zone, or click to browse
3. Adjust the grid layout, labels, and scale bars
4. Click **⟳ Render** (or press **R**) to preview
5. Export in your chosen format

---

## Finding things

The sidebar is organised by **what you're doing**, in the order you do it:

**Images → Arrange → Templates → Crop & Scale → Annotate & Draw → Look → Measure → Check → Export**

Every tool is visible — there is no mode that hides features. Sections collapse to keep the list short, and deeper tools sit grouped under a "More" rule within their section rather than disappearing. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> to search every tool by name.

Tools that cannot work in your current layout mode are hidden or disabled **with the reason shown**, rather than accepting a click and doing nothing.

> Earlier versions had a Simple/Advanced switch. It hid about thirty-five controls, including whole tools like Batch Crop, which made them impossible to discover — you cannot look for something you have no way of knowing exists. It was removed in v3.9.3.

## AI features & privacy

FigureLab's privacy rule is simple: **your experimental images never leave your machine, under any feature.** Three AI features exist, each with a different (and clearly stated) network story:

1. **On-device caption polish** — runs entirely in your browser via Chrome's built-in Prompt API (Gemini Nano). No server, no key, nothing uploaded, works offline.
2. **Generate with your Gemini account** (the default generator) — FigureLab itself sends *nothing*. It copies your prompt to the clipboard and opens gemini.google.com, where you generate on your own signed-in account (free on consumer accounts), then paste the image back. The result is tagged AI-generated and disclosed in every export. There is no in-app "sign in with Google": Google's image API has no OAuth path a serverless static file can use, and proxying a consumer Gemini session violates Google's ToS — so the bridge is the honest maximum.
3. **Direct API mode (advanced)** — you paste your own AI Studio API key, and clicking Generate sends **your prompt (and, in later versions, any reference schematic you explicitly attach)** to Google's Gemini API. The key is stored only on your machine (or held for the session only, if you prefer). Creating a key is free; **image generation requires billing linked to the Google account** (Google removed the image-model free tier in 2026, ~$0.03–0.24/image). All Gemini output carries Google's invisible SynthID watermark.

**AI never touches your data panels.** Generation only ever inserts a *new* schematic object; there is no inpainting or AI retouching of imported experimental images, and exports state this in their metadata.

### On-device caption polish

The **caption helper** can optionally polish your figure legend with AI that runs **entirely in your browser, on your own machine** — no server, no API key, nothing uploaded. It uses **Chrome's built-in Prompt API (Gemini Nano)**, the browser-native on-device model, so it fits FigureLab's offline/privacy promise exactly.

- Click **🤖 Polish with on-device AI** under the caption helper.
- It's **feature-detected**: if your browser doesn't expose the built-in model (`window.LanguageModel`), FigureLab silently keeps the built-in rule-based caption — the feature never blocks anything or requires a network.
- An echo/guard check rejects degenerate responses, so a good caption is never clobbered.
- Requires a recent Chrome (138+) with built-in AI enabled; the ~4 GB model downloads once, then works fully offline.

*Why not Google AI Edge / MediaPipe LLM Inference directly?* That path can run open models (Gemma) in-browser via a WASM runtime, but it means bundling a multi-megabyte runtime + model weights, which breaks the "single HTML file, no dependencies" identity. The Chrome built-in Prompt API gives the same **on-device, private** benefit with **zero bundled dependencies** — the right trade-off here. (If you ever want a fully browser-agnostic option, a MediaPipe/Transformers.js build could be offered as a separate opt-in bundle.)

## What's in v3.0

### Core Layout
| Feature | Details |
|---|---|
| Grid layout | Rows × columns with independent horizontal and vertical gap control |
| Drag-to-space | Hover between panels on the canvas and **drag the divider** (or tap **+ / −**) to space them out live |
| Per-gutter spacing | Turn on **Per-gutter spacing** to give individual rows/columns their own gap; **Reset gutters** returns to uniform |
| Per-panel crop | Trim each edge by % — or use the interactive crop editor |
| Panel labels | Format as A/B/C, a/b/c, 1/2/3, or i/ii/iii — with position, size, colour, font, bold/italic |
| Panel border | Optional border around each panel (width + colour) |
| Scale bars | Per-panel enable/disable, µm/nm/mm auto-formatted label |
| Axis labels | Optional row and column headers with custom text |
| Figure title | Optional title rendered above the figure |
| Journal presets | One-click settings for Nature, Science, Cell, and Poster |
| Light / dark mode | Toggled from the header |

### Per-Panel Adjustments
| Control | Details |
|---|---|
| Brightness / Contrast | Sliders with live preview |
| Gamma correction | Nonlinear tone adjustment — useful for dim fluorescence images |
| Grayscale / Invert | One-click toggles |
| Black / White point | Clip and stretch the intensity range |
| Fluorescence LUTs | Fire, Green, Cyan, Magenta, Yellow, Blue |
| Multi-channel composite | Add extra channels with independent LUTs (screen blend) |
| Rotate | 90° CCW, CW, 180° |
| Flip | Horizontal and vertical |
| Lock panel | Prevents accidental drag-reorder |

### Scale Calibration Tool
Click **🔬 Calibrate from image** inside any panel's settings. Click two known points on the image, enter the real-world distance, and the µm/px ratio is calculated automatically. Objective presets (4× – 100×) are also available.

**Auto scale bar:** click the **Auto SB** button on any panel to automatically pick a clean scale bar length (≈ 20% of panel width).

### Annotation Tools
Draw directly on the rendered figure:
- **Arrow** — single-headed; points to features
- **Arrow2** — double-headed; spans a distance
- **Ruler** — line with tick marks at each end; labels µm length if calibrated
- **Rectangle** — highlight regions; optional filled with adjustable opacity
- **Ellipse** — outline structures; optional filled with adjustable opacity
- **Line** — measure or indicate
- **Text** — free-form labels; font, size, and colour controlled in the float toolbar
- **Inset** — magnify a region; automatically placed in a panel corner
- **Counter** — click to place numbered dots; running count shown while tool is active

**Editing annotations:**
- Switch to **↖ Select** (or press **Esc**) to enter select mode
- **Click** any annotation to select it — a golden highlight appears
- **Drag** to reposition; drag corner handles to resize
- A **floating toolbar** sets colour, line width, font size, fill, and opacity
- **Delete** from the toolbar or the annotation list in the sidebar

**Drawing tips:**
- Hold **Shift** while drawing to snap lines/arrows to 45° increments, or to force squares/circles
- **Panel annotations** (📌 mode) pin annotations to a specific panel — they follow it when panels are reordered

**Undo / Redo** — full history for all annotation actions

### Integrity checks
- **🧬 Duplicate-panel check** — compares the pixels of every pair of panels, including rotated and mirrored reuse, and flags near-identical ones before a journal's screen does
- **Deep figure audit** — LUT/brightness/gamma/intensity consistency, scale-bar calibration, label coverage, and the duplicate check
- **Journal compliance** — printed width and height in mm, true text point size, DPI, background, and export size

### Measurement
- **ROI** — area, mean/min/max intensity, SD (n−1), and integrated density over a dragged rectangle
- **Line profile** — an intensity trace along a dragged line
- **Cell count** — connected-component count above an intensity threshold

Measurements read the **native samples** of 16-bit/float TIFFs where an exact mapping exists, and the 8-bit display otherwise — always stating which.
- **Exposure analysis** — per-panel over/under-exposure, dynamic range, and saturation

**Raw vs display.** Import a **16-bit or 32-bit float TIFF** and FigureLab keeps the decoder's native samples in memory next to the 8-bit display image; measurements then read *those*, giving absolute intensity at the acquisition bit depth, areas counted in source pixels, and true sensor saturation — all before any brightness/contrast/gamma/LUT. For 8-bit sources, PNG/JPEG imports, JPEG-compressed TIFFs, or a reloaded session, measurements read the rendered 8-bit canvas and say so.

Reading raw values means inverting the panel's placement (crop → contain-fit or stretch) back to a source pixel. Where that can't be exact — a **rotated or flipped** panel, a **circle/ellipse crop**, or a **multi-channel composite** — FigureLab deliberately falls back to the disclosed display measurement rather than risk a wrong correspondence. Every result and every CSV row states which pixels produced it.

> Not a substitute for FIJI/CellProfiler. These are simple, documented operations for sanity checks and for reporting values in a figure — real segmentation and quantitative pipelines belong in a dedicated analysis tool, and the result panel says so.

### Gene Maps & Genetic Circuits 🧬
A freeform element that draws DNA constructs scaled by base pairs.

- **Linear constructs** and **circular plasmid maps**
- **SBOL Visual glyphs** — promoter (bent arrow), RBS (half-dome), CDS (arrow-block), terminator (T-bar), operator, origin of replication, primer, restriction site, ribozyme, insulator, scar, ncRNA, protein tag; an unrecognised type falls back to a labelled box rather than failing
- **Strand direction** shown by the glyph itself — arrow-blocks on linear maps, tapered arcs on plasmid maps — with forward features above the backbone and reverse below
- **bp ruler** and a size stamp; labels stagger across rows instead of overprinting on dense constructs
- **Three ways in** — paste a feature table (`name, type, start, end, strand`; tab, comma, or two-space separated), add features one at a time from a glyph dropdown, or drop a **GenBank/FASTA** file onto the canvas
- **Scale the whole design** — set the backbone length in bp and the drawing rescales, or use `⤢ Rescale…` to multiply every coordinate so a construct keeps its proportions at a new size
- **True vector export** — real `<polyline>`/`<rect>` glyphs and live `<text>` in SVG, redrawn at target DPI for raster

GenBank import reads the LOCUS length, the circular/linear flag, and the FEATURES table (`/label`, `/gene`, `/product` for names; `complement()` for the reverse strand). The sequence is ignored, the record-wide `source` feature is skipped, and a `join()` is drawn as its overall span — spliced exon structure is not represented. Nothing is inferred: the map shows what the file declares.

### Canvas Navigation
| Action | How |
|---|---|
| Zoom in/out | Ctrl + scroll wheel, or ＋/－ buttons |
| Pan | Space + drag |
| Zoom to fit | **⊡ Fit** button |
| Zoom to 100% | **1:1** button |
| Copy figure | **⎘ Copy** button — copies to clipboard as PNG |
| Reset zoom | Click the **100%** zoom button |

### Export Formats
| Format | Notes |
|---|---|
| PNG | Lossless, DPI metadata embedded via pHYs chunk |
| JPEG | Smallest file size |
| WebP | Good balance of quality and size |
| TIFF | Uncompressed RGB, scaled to target DPI — journals prefer this |
| PDF | Image at correct physical size, with figure labels as **real embedded text** (selectable, searchable, sharp at any zoom; base-14 fonts, nothing bundled) |
| SVG | Background raster + vector annotations as native SVG elements |

Set a **file name**, a **printed width** (journal column widths in mm), and a **DPI** (72 / 150 / 300 / 600) before exporting. With a target width set, the export lands at exactly that physical size at the chosen DPI; without one it uses DPI/96. TIFF and PNG are supersampled to the true pixel count, not merely DPI-tagged.

The info bar below the canvas shows pixel dimensions and physical size in mm, and the export panel reports the **true point size** your panel labels will print at.

### CSV Metadata Export
Click **⬇ CSV Metadata** to export a spreadsheet of all panel settings — name, label, µm/px, scale bar, brightness, gamma, crop, caption, and metadata notes. Useful for methods sections and lab records.

### Reproducibility Scripts
Export an **R script** (uses `magick`) or **Python script** (uses `Pillow + matplotlib`) that recreates the figure from your original image files.

### Caption Generator
Add a short note to each image in its settings panel, then click **✦ Generate Caption** to produce a structured journal-style caption:

> Figure. Effect of treatment. (A) Control cells. Scale bar, 10µm. (B) Treated cells. Scale bar, 10µm.

### Session Save / Load
Save the entire figure — layout, per-panel settings, annotations, notes, **and the image pixels** — as a JSON file and reload it later to restore everything exactly, no re-dropping required. (Sessions saved by very old versions, before pixel data was embedded, will prompt you to re-drop those images.)

### Notes Scratchpad
Expand the **Export** panel to find a **Figure notes** text area — write antibody dilutions, reviewer comments, or anything else that should travel with the session file.

---

## Keyboard Shortcuts
| Key | Action |
|---|---|
| R | Render figure |
| Esc | Exit tool / deselect |
| Ctrl + Z | Undo |
| Ctrl + Y | Redo |
| Ctrl + Shift + Z | Redo (alternate) |
| Ctrl + S | Save session JSON |
| Space + drag | Pan canvas |
| Shift + draw | Snap to 45° / square |

---

## Scale Bar Formula

```
display pixels = (µm length ÷ µm/px) × (display width ÷ original width)
```

**Objective presets (approximate):**
| Objective | µm/px |
|---|---|
| 4× | 1.62 |
| 10× | 0.65 |
| 20× | 0.32 |
| 40× | 0.16 |
| 60× | 0.108 |
| 100× | 0.065 |

---

## Common tasks

- **Space two panels apart** — hover the seam between them; a blue divider with a `gap` pill appears. Drag it (or tap **+**) to push them apart. Drag a horizontal seam for row spacing, a vertical seam for column spacing.
- **Give one row extra breathing room** — tick **Per-gutter spacing** in the Layout panel, then drag only the gutter under that row. Everything else stays tight. **Reset gutters** restores a uniform grid.
- **Drop labels in one click** — click **⊞ Labels** in the canvas toolbar (or the small **×** chip in the figure's top-left) to add or remove row & column headers instantly.
- **Write directly on an image** — double-click a panel, type your text, press **Enter**. The label is pinned to that panel (it follows the panel if you reorder) and gets a dark **halo** so it stays readable over bright micrographs. Toggle the halo from the floating toolbar.
- **Export print-ready** — set DPI to 300–600 and export PNG/JPEG/WebP: the figure is re-rendered at the true pixel count (supersampled), so text, scale bars, and lines stay crisp — not just DPI-tagged.

## Tips

- **Drag the ⠿ handle** in the image list to reorder panels (locked panels cannot be moved)
- **Apply to all** copies brightness, contrast, gamma, LUT, and B/W points from one panel to all others
- **Duplicate** a panel (⎘ button) to reuse its settings for similar images
- Use the **mini grid map** in the Layout section to see panel assignments at a glance
- Annotations are baked into the exported figure — finalise the layout before annotating
- For journal submission, use TIFF at 300–600 DPI with a white background
- The **uncalibrated warning badge** (⚠) appears on scale bars when µm/px is not set

---

## Technical Notes

- Everything runs in the browser — no data ever leaves your computer
- Raster export (PNG/JPEG/WebP): the figure is re-rendered off-screen at the true target-DPI pixel count (supersampled, high-quality smoothing), so output is genuinely high-resolution — capped at ~60 megapixels to stay within browser memory
- TIFF export: uncompressed RGB, scaled to target DPI (not just metadata — actual pixel count is correct)
- PNG export: DPI and reproducibility metadata embedded; correct DPI in Photoshop / ImageJ
- PDF export: JPEG-compressed raster at correct physical page size
- SVG export: background PNG + native SVG shapes for vector annotations
- Gamma correction uses a 256-entry LUT computed once per render for speed
- Fonts: JetBrains Mono, Instrument Serif (loaded from Google Fonts if online, falls back to system fonts offline)

---

## Changelog

### v3.13.0 — 24 August 2026
**Focus: the duplication check journals actually run, and the attribution-required icon tranche the Credits machinery was built for.**

- **🧬 Region-level duplication check.** The whole-panel check caught a panel reused wholesale; what journal screens (Proofig, ImageTwin) actually flag is a *region* reused — a lane cloned inside a blot, a patch of one micrograph living in another, possibly rotated or mirrored. The scan now anchors patches to **content keypoints** (Laplacian-energy maxima), so the same pixels produce the same patches wherever they were pasted — a first fixed-grid implementation missed a duplicate shifted by 8 px, which is disqualifying for an integrity tool and why the grid went. Matches merge into regions, shown **boxed side-by-side** in the report; flat areas are excluded and the report says so rather than passing them. Thresholds are measured, not guessed: a planted rotated duplicate lands at 0.83–0.93 correlation after ±2 px alignment refinement, unrelated texture never exceeded 0.19 across 233 gated pairs. The shifted re-crop that was the *documented limitation* of the panel check is now a regression test for the region check. Within-panel cloning is covered too.
- **41 more icons: Servier Medical Art and DBCLS (CC-BY).** The attribution-required tranche deliberately left out of v3.12.0 until the ⚖ Credits machinery existed to honour it. Placing one creates a real obligation, and the licence records discharge it: Credits groups by author into a paste-ready line pointing at each author's own site (smart.servier.com, togotv.dbcls.jp), and `CREDITS.txt` ships in the submission package. A test places a real Servier icon and asserts the real credit line comes out. Library now **210 icons**. NIH BioArt was investigated and skipped: it is a JS app with no public API, and scraping its internal endpoints is neither stable nor clearly sanctioned.
- Curation remains reproducible: `tools/bioicons-ccby-pack.json` regenerates the tranche through `tools/build-icons.mjs`, same review-then-paste workflow, share-alike still rejected outright.
- **359 Playwright tests** (up from 351). The region check's development was driven by adversarial fixtures (deterministic noise with planted, shifted, rotated duplications) — two implementation strategies failed against them before keypoint anchoring passed.

### v3.12.0 — 11 August 2026
**Focus: the icon library, doubled with imported artwork — and the licence discipline to make that safe.**

- **82 icons imported from [Bioicons](https://bioicons.com/)**, taking the library to **169**. GHS hazard pictograms, nucleotide bases, fluorescent beads, capsules, plasmids, lab apparatus, molecular-modelling notation, plots and assay readouts.
- **CC0 and MIT only.** Those are the licences that oblige the user nothing — no attribution line, no publication licence, no watermark, no per-figure fee, which is the entire point next to BioRender's model. **Share-alike was excluded** (it can be read as reaching the figure the icon is placed in), and **software logos were excluded outright**: a CC0 SVG grants copyright permission, not trademark permission, and that distinction doesn't survive being placed in a published figure.
- **A second icon class: full-colour illustrations.** FigureLab's own icons are single-colour line art whose colour you can change. Imported illustrations are artwork whose colours *are* the content — forcing them through the same recolour would flatten a drawn cell to a silhouette. They carry `mono:false`, are placed as drawn, and the colour control hides for them rather than pretending to work.
- **Two silent-damage bugs found by rendering every icon before shipping it**, both in the import cleanup and both invisible in the source text:
  - Stripping `xmlns:` declarations while leaving `<sodipodi:namedview/>` behind produced an undeclared namespace prefix — an XML parse error, so **23 of 86 icons failed to load at all**.
  - Stripping `class="…"` severed the `<style>` blocks these SVGs keep their colours in, so the artwork rendered as **flat black silhouettes** while still parsing fine. Pills, viruses and plasmids all came through as blobs.
  Neither would have been caught by reading the files. The import now renders each icon, measures its ink, and rejects a "colour" icon that comes out in one tone.
- `tools/build-icons.mjs` carries both fixes and documents why `id` and `class` must survive cleanup.
- **351 Playwright tests.** The duplicate-key guard now spans the hand-written literal *and* the generated pack blocks, since an appended pack silently overwriting a built-in is the new failure mode.

### v3.11.0 — 11 August 2026
**Focus: AI that edits schematics and never data, plus the features a competitor survey said were worth having.**

- **AI editing, with one hard rule.** AI-generated and hand-drawn objects gain *Edit in Gemini* (your own tab, nothing transmitted) and *Edit via API*, plus variations and style references with explicit consent. **Imported experimental images and grid panels are refused** — loudly, with the reason: Nature, Science and Cell Press all treat AI alteration of research images as misconduct, and Cell names brightness and contrast explicitly. One predicate (`_aiEditable`) decides every entry point so the rule cannot drift between the toolbar, the palette and the layer list, and a test asserts refused paths issue **zero network requests**. Editing a hand-drawn shape retags it AI-generated then and there, because that is when the disclosure obligation starts.
- **Export-time journal AI-policy gate.** Exporting a figure containing AI content under the Nature, Science or Cell preset stops and shows that journal's actual position — summarised, **dated**, and linked, because policies change and FigureLab does not decide this for you. "Disclose & continue" writes the sentence Science asks for (tool, model, version, prompt) into the figure notes, once per session rather than once per export.
- **⚖ Homogenize styles.** A figure assembled from several sources drifts: text at four sizes, strokes at three weights, two nearly-identical fonts. Each is invisible alone; together they are what makes a figure look assembled rather than authored. This finds every drifted font, size, stroke width and line colour and collapses each to one value in **a single undoable step**.
- **⧉ Linked insets.** A magnified daughter panel bound to its parent **by id**: adjust the parent and the inset follows on the next render, reorder the grid and the link survives, delete the parent and the audit says the inset is orphaned. Magnification lands in the metadata CSV rather than being stated from memory. A hand-made inset is a copy that silently diverges the moment the parent is touched — which is how a figure ends up showing two processings of one field.
- **36 new icons and licence-aware artwork.** Anatomy and clinical (heart, lungs, brain, liver, kidney, gut, bone, tumour, patient, mouse, blood), study design (timeline, treatment arms, replicates, included/excluded, dataset, quantification), more lab equipment, and the microbiology set this tool is actually used for — **phage, plaque assay, colonies, biofilm, plasmid, CRISPR–Cas**. Every icon now carries a licence record; **⚖ Credits** generates a paste-ready attribution paragraph and writes `CREDITS.txt` into the submission package. FigureLab's own icons need no attribution at all: no publication licence, no watermark, no per-figure fee. `tools/build-icons.mjs` imports third-party packs under a licence allowlist that rejects share-alike outright.
- **Per-panel processing history** in the submission package (`PANEL_HISTORY.txt` + `.json`): every operation applied to every panel, in order, with tilted crops flagged as resampled and non-destructive adjustments labelled as such. C2PA-shaped in intent and **explicitly unsigned** — it is the author's account, not proof.
- **Deliverable presets** (graphical abstract 1328×531 @300 dpi, TOC image 90×50 mm, A0 poster, 16:9 slide), each with its own dated caveat. **Token labels**: `{condition} {time}` resolved from the fields the filename parser already found, with unknown tokens leaving a gap rather than printing braces into a published figure. **Duplicate row / column.**
- **345 Playwright tests** (up from 294). Two long-standing tests were rewritten rather than patched: they froze the exact icon-group list and heading count, which taxes the library for growing.

### v3.10.0 — 11 August 2026
**Focus: generating figure artwork with Gemini, using your own account rather than an API key — and making the existing AI path honest.**

- **🎨 Generate with your Gemini account.** Write a prompt, click the button, and FigureLab copies the prompt and opens gemini.google.com. You generate there — free on a consumer Google account — copy the image, come back and paste. It lands as a schematic object, tagged AI-generated, with the prompt recorded. **FigureLab transmits nothing:** the clipboard does the travelling, and the app never sees your Google login. A test asserts zero network requests for the whole bridge flow.
- **Why there is no in-app "sign in with Google".** It was the obvious design and it isn't available: Google's image API publishes no OAuth scopes for generation, web OAuth requires a client secret that a single offline HTML file cannot hold (and `file://` origins can't be registered at all), and routing a consumer Gemini session through a third-party app violates Google's terms — they began suspending accounts for it in March 2026. Handing the prompt to the user's own tab is the honest maximum, and it's the only route that spends the free consumer usage.
- **The direct API path works again.** It had been calling `gemini-2.0-flash-exp` — retired — so it could not have succeeded for some time. Now on the current `/v1/…:generateContent` endpoint with the **Nano Banana** family selectable (Flash, Flash Lite, Pro), aspect ratio, 1K/2K/4K output, cancel mid-flight, and an error for each real failure: offline (named before the call, not surfaced as `Failed to fetch`), bad key, rate/spend cap, and the one every new user hits — **creating a key is free, but Google removed the free tier for image models in 2026, so generation needs billing linked**. The old "Get free key" text said the opposite.
- **Stronger disclosure.** Exports now record the exact model id and the prompt behind each AI object, and state that Gemini output carries Google's invisible SynthID watermark. The journal-compliance check gained an AI row. The "photo-realistic microscopy" prompt style is gone: a fabricated micrograph is fabricated data however it is labelled.
- **Eight defects fixed in the existing AI extension**, one serious: a patch had shadowed `generateAIImage` with a wrapper that awaited "the original", but both declarations hoist, so it captured *itself* — every click was infinite async recursion and the spinner never stopped. Also: inserting an AI image skipped `pushUndo` (Ctrl+Z undid the wrong thing); the provenance engine string didn't match the model actually called; the backend choice never persisted despite being read at startup; lightweight session saves discarded AI image data that cannot be re-imported; and the API key moved to the `fl-` settings convention with a one-time migration.
- **Privacy stated precisely** rather than absolutely. Your experimental images never leave your machine under any feature, and AI never touches a data panel — generation only ever inserts a *new* object. Bridge mode transmits nothing; API mode sends your prompt, and says so at the button. The landing page and README no longer claim "no data leaves your machine" without qualification.
- **294 Playwright tests** (up from 270), including a `stubGemini` route helper so no test ever calls the paid API.

### v3.9.5 — 11 August 2026
**Focus: crops that aren't square to the camera, and multi-crop sessions you can correct without starting over.**

- **A crop can be tilted.** Drag the round grip above the crop box, or type an angle — <kbd>Shift</kbd> snaps to 15°, <kbd>[</kbd> and <kbd>]</kbd> nudge by 1°. The *region* turns and the panel comes out **upright**, so a plate photographed at an angle no longer forces a choice between a skewed panel and background wedges in the corners. This is different from rotating a panel, which turns the whole cropped picture inside its cell. Works in the single-panel editor, batch crop and multi-crop.
- **Tilt is per region in multi-crop.** Every region still shares one size, so the panels stay uniform, but each keeps its own angle — six plates photographed at six slightly different angles all straighten independently. Each image starts upright rather than inheriting the last one's tilt, which would be a guess.
- **Banked multi-crop regions can be edited.** The session used to be forward-only: a region placed slightly wrong three back couldn't be reached, because Undo only removes the last one. Region chips are now controls — click one to reopen it in the editor, move, tilt or rename it, then **Update**; `×` drops it outright. Leaving the name blank on update keeps the name it already had, so repositioning never silently strips a label.
- **What a tilt costs is stated, not buried.** Every other crop in FigureLab selects existing pixels; a tilted one has to resample them, so that panel's *displayed* pixels are interpolated. The editor says so while you turn it, the metadata CSV gained `CropAngle` and `Resampling` columns, the provenance hash covers it, and the deep audit names the tilted panels.
- **Measurements are not degraded by a tilt.** An axis-aligned selection on screen is a rotated quadrilateral in the source, so it is measured as one: a pixel counts if its centre falls inside, and its **original** stored value is used. Measuring the straightened canvas instead would average neighbouring samples into values that were never recorded and report them at the acquisition bit depth as though they had been. The one exception is crop-on-import, which is destructive — a tilt there drops the native samples and says so.
- **The landing page describes the app that exists.** It had been stuck at v3.5 since 8 July, still advertising the Simple/Advanced toggle that was removed in v3.9.3 and a crop-on-import step that is now off by default.
- **270 Playwright tests** (up from 252). Three of the new ones were checked by mutation — rotating in normalised space, dropping the rotation from the source mapping, and straightening at every angle each make a specific test fail.

> **Note on the v3.9.4 archive.** The Zenodo record for v3.9.4 contains a `README.md` with ~200 double-encoded characters, from a PowerShell round-trip during that release. `figure_lab.html` in that archive is unaffected, and every machine-readable citation field is correct. The tag was deliberately left alone so it and its DOI describe the same bytes. **This release supersedes it with a clean archive**, and `tests/encoding.spec.js` now fails the build on mojibake, a BOM, invalid UTF-8, a version that disagrees across the three release files, or a `CITATION.cff` with no DOI for the version it claims to be.

### v3.9.4 — 3 August 2026
**Focus: making a real figure. Every item came from assembling a spot-dilution plate figure and hitting where the tool got in the way.**

- **Panels fit their images.** A grid cell was a fixed square while a plate photo is 4:3, so every panel was drawn contain-fit with white bars above and below — about a quarter of each cell wasted, multiplied across eighteen panels. **⊞ Fit panels to images** reshapes the cell to the content aspect, holding the panel *width* fixed so the figure's overall width — the number a journal specifies — doesn't move. **⇲ Tighten spacing** closes gutters and margins in one action, keeping room only for labels you actually have on. Multi-crop fits automatically on finish, since every region from one pass shares a crop size.
- **Row and column headers can sit against the figure.** A row header was centred in the left *margin*, so its distance from the panel was whatever the margin happened to be, and the only way to close the gap was to move the whole figure. A **Gap to figure** control now means exactly that on both axes: headers are placed relative to the panel edge, and the margin only has to be large enough to hold the text.
- **Show a subset of your panels.** Cutting 6 plates × 3 regions gives 18 panels for a figure that might show 6 — and deleting the rest throws away the expensive part. Panels can now be hidden: they leave the figure and the grid closes up around them, but they stay in the panel list, in the session file, and in every adjustment you made. Tick panels and **👁 Show only ticked**, or use the eye on any row; **🗑 Delete hidden** is separate and explicit. Auto-lettering runs over visible panels only, so a subset reads A, B, C, D with no gaps.
- **Group bands** — the outer level of labelling that a spot-dilution or dose-series figure needs: "No ATC" and "+5 µM ATC" spanning three rows each, with a bracket. Bands are built by explicit row/column range, in repeating blocks of N, or from the panels' own group tags; they run down rows or across columns, and the bracket is selectable per figure — solid bar, square bracket, or none. Bands with no name draw nothing and reserve no space, so building a set and naming them as you go doesn't shift the layout.
- **Fixed:** the internal `sv()`/`gv()` control helpers wrote to and read from `.value` on checkboxes, where `.value` is the literal string `"on"` in both states — so a write was a silent no-op and a read was always truthy. No shipped call site used them that way, so nothing was broken for users; it was a trap for the next change, and it had already caught a test. Both now route to `.checked`.
- **236 Playwright tests** (up from 220).

### v3.9.3 — 1 August 2026
**Focus: findability. Prompted by failing to find the crop tool while using the app for real work.**

A UI audit found cropping had **12 entry points across 5 surfaces**. The two flagship ones — `✂ Batch Crop Images` and `⊞ Multi-Crop → Panels` — sat under a sub-heading called *Scale Tools* inside an accordion called *Style*, wrapped in the Advanced-mode class. Since the app booted in Simple mode, a default user could not see them at all, and the command palette returned **1 result out of 12** for "crop".

- **The sidebar is task-based**: Images → Arrange → Templates → **Crop & Scale** → Annotate & Draw → Look → **Measure** → **Check** → Export. Measure (ROI/profile/count — `setTool()` tools, and the only ones that worked in freeform) and Check (compliance, deep audit, duplicate check, exposure, compare) were both buried inside Export behind the Advanced gate. Histogram normalisation moved to Images, next to the panels it acts on.
- **One home for cropping**, with a new `✂ Crop a panel…` entry point, and `Match Physical Scale`/`Match Pixel Size` renamed to say that they crop — previously only their tooltips admitted it. All ten crop actions are in the command palette.
- **Name regions as you cut them** — a per-region name plus a per-image source name, with a running list of what's banked. Region names become panel labels (`Plate 3 T7`), so an 18-panel figure from 6 plates needs no decoding afterwards. Naming is optional and a named panel is never overwritten by the auto-lettering.
- **Multi-crop works in freeform**, where it used to refuse with "needs Grid layout"; each region becomes a placed object. Grid behaviour is unchanged.
- **Crop-on-import is opt-in and off by default.** It fired on every single-image import and physically cut the bitmap *and* the retained 16-bit samples that raw measurement depends on. Images now import straight into the figure and are cropped non-destructively afterwards.
- **Annotations work in freeform.** They were never unimplemented — `renderFreeform` already drew them and they were already in exports — but all three canvas handlers delegated the event to the object code before the annotation logic could see it, so arrows, boxes and text were unreachable. They now draw, select and drag in both modes. Panel-pin mode stays grid-only, since there is no grid cell to pin to.
- **Simple/Advanced is retired.** One CSS rule hid ~35 controls while the app booted in Simple. Progressive disclosure now happens per section; deeper tools stay visible under a "More" rule. This also removed a trap where choosing Freeform in Simple mode silently reverted to Grid on the next load.
- **Mode-aware sidebar** — nothing renders that would silently ignore your click. Panel letters hide in freeform, Templates says it builds a grid, and PowerPoint export is disabled *with the reason* rather than failing after the click.
- **One name per concept** — "Presets" named four different things across three sections, "Save" five, "Themes" two. Also, the header version badge was hard-coded and had drifted; it is now stamped from `APP_VERSION`.
- **220 Playwright tests** (up from 213). The new `tests/ui-ia.spec.js` includes an orphaned-id scan that extracts every `getElementById` from the source and checks it against the live DOM — the failure a large re-parenting causes that behavioural tests miss.

### v3.9.2 — 1 August 2026
**Focus: PDF exports carry real text, not a picture of text.**

- **Live vector text in PDF** — the figure title, panel letters, row/column headers, and scale-bar labels are now written as genuine PDF text operators layered over the image, so they are selectable, searchable, and sharp at any zoom. A production editor asking for "text as vector / fonts embedded" is satisfied without a round trip through Illustrator. Previously the entire page was a single raster and labels softened visibly in the proof.
- **No bundled font** — the text uses the PDF base-14 faces (Helvetica / Times / Courier) that every reader has built in, so no font file is embedded in the PDF and none is added to FigureLab. Bold, italic, serif, and monospace label fonts map to the matching face.
- **Never a mangled label** — base-14 text encodes WinAnsi (CP1252) only. Any string containing a character outside it — Greek (`α-tubulin`), `≥`, `✓`, CJK — is left in the raster rather than silently substituted, since a wrong glyph in a scientific label is worse than a slightly softer one. `µm` encodes correctly and stays live text. The raster render is told, per string, exactly what the text layer will draw, so nothing is ever drawn twice or lost.
- Annotations drawn on the figure (arrows, boxes, free text) remain rasterised; SVG export still carries those as vector.
- **192 Playwright tests** (up from 178), plus `tests/validate_pdf.py` — an independent check with `pypdf` confirming the exported files really parse, that the text extracts, and that each string lands where the figure put it.

### v3.9.1 — 24 July 2026
**Focus: hardening. A whole-app audit hunted for places a number could be wrong while looking authoritative.**

- **🧬 Duplicate-panel self-check** — compares the **pixels** of every pair of panels, not their settings, and flags near-identical ones including rotated and mirrored reuse (32×32 mean-subtracted luminance, normalised cross-correlation across all 8 dihedral transforms). Journals run duplication screens on submitted figures; this catches an accidental reuse first. Panels too uniform to judge are reported as not-compared rather than silently passed. Whole panels only — it does not detect a duplicated region inside a different panel, and the report says so.
- **Printed width in millimetres** — journals specify figure width in mm, not pixels. Choose a target column width (Nature 89/183, Science 55/120/183.5, Cell 85/174, PLOS 83/173, PNAS/EMBO 180) and the export lands at exactly that physical size at the chosen DPI. A live readout gives the printed size and the **true point size** of your panel labels, and compliance fails text below ~5 pt. Journal presets set their own column width.
- **Fixed: the on-canvas mm readout and the compliance width check** both divided logical pixels by DPI, but exports render at DPI/96 — under-reporting the real printed size by about 3× at 300 DPI.

Integrity fixes, each with a regression test confirmed to fail against the previous build:

- **Freeform scale bars ignored the crop** — magnification was computed against the full image width instead of the cropped width, so a panel cropped 50% drew its "20 µm" bar at the length of 10 µm. A reader measuring against it would have overestimated every structure by 2×. Grid mode was already correct; both now share one helper, and `Auto` bar length is fixed the same way.
- **Channel merges ignored the crop** — extra channels were drawn from their full frame into the cropped panel rect, displacing and squashing them by up to half a field, which can show colocalisation that is not in the data. Each channel is now cropped to the same normalised field of view, so channels acquired at different pixel sizes still register.
- **Raw measurements could read pixels outside the figure** — an ROI over a contain-fit panel's letterbox, or spilling past a cropped edge, reported a confident raw value computed from pixels the user had cropped away. Measurements are now clipped to the visible crop window, disclose when they were clipped, and fall back to the disclosed display reading when nothing visible remains. A line profile leaving the image declines rather than reading clamped edge pixels.
- **Exposure analysis** scanned the whole sensor frame, so a saturated region cropped out of the figure still failed the panel. It now measures the cropped panel, and reads the drawn image rather than the whole grid cell.
- **µm² is withheld, not guessed**, when a panel cannot be mapped back to source pixels (rotated, flipped, shape-cropped, or a channel merge) — it was previously wrong by the display scale.
- **GenBank features crossing the origin** collapsed to their full-span envelope, drawing a full-ring arrow that hid every other feature — and most real plasmids have an AmpR or ori crossing position 1. Wrapping features on circular records now become their two real arcs; ordinary multi-exon joins still collapse to their span, now disclosed.
- **Duplicating a gene map or chart bricked the canvas** — the deep copy turned a cached canvas into `{}` and every later render threw.

- **178 Playwright tests** (up from 157).

### v3.9 — 24 July 2026
**Focus: measure the real data, and draw the constructs behind it. Same single, offline, private file.**

- **Raw-pixel measurement pipeline** — importing a 16-bit or 32-bit float TIFF now retains the decoder's **native samples** alongside the 8-bit display image (single-channel, capped at 24 MP to bound memory). ROI, line profile, cell count, and exposure analysis measure *those*, reporting absolute intensity, SD (n−1), and integrated density at the acquisition bit depth — before any brightness/contrast/gamma/LUT. Previous releases could only measure the rendered display.
- **True sensor saturation** — exposure analysis reports the fraction of pixels at the sensor maximum, measured pre-adjustment, alongside the existing display-clipping figure. Display clipping and acquisition saturation are no longer conflated.
- **Correct areas** — with an exact source mapping, an ROI's area is counted in **source pixels**, so µm² finally uses the coordinate space the µm/px calibration is defined in rather than on-screen pixels.
- **Honest fallback, never a guess** — reading raw values requires inverting the panel's placement (crop → contain-fit or stretch) back to a source pixel. Where that can't be exact — a rotated or flipped panel, a circle/ellipse crop, a multi-channel composite, or any image with no raw data — FigureLab measures the 8-bit display and says so. Every on-screen result and every CSV row states which pixels produced it.
- **🧬 Gene maps & genetic circuits** — a new freeform element draws DNA constructs scaled by base pairs, **linear or circular**, with **SBOL Visual** glyphs (promoter, RBS, CDS, terminator, operator, origin of replication, primer, restriction site, ribozyme, insulator, scar, ncRNA, tag). Features carry strand direction — arrow-blocks on linear maps, tapered arcs on plasmid maps — labels stagger across rows instead of overprinting on dense constructs, and a bp ruler shows the scale.
- **Build a map any way you like** — paste a feature table straight from a spreadsheet (tab, comma, or two-space separated), add features one at a time from a glyph dropdown, or drop a **GenBank / FASTA** file onto the canvas. `⤢ Rescale…` multiplies every coordinate so a design keeps its proportions at a new total length. Import reads only what the file declares (LOCUS length, topology, FEATURES table, `complement()` strands) — nothing is inferred and no feature is invented.
- **Gene maps export as true vector** — geometry runs through the same emit backend as charts, so SVG export carries real `<polyline>`/`<rect>` glyphs and live `<text>` labels, and raster exports redraw at the target DPI.
- **157 Playwright tests** (up from 133), including raw-value assertions against purpose-built 16-bit TIFF fixtures with hand-computed means.

### v3.8 — 21 July 2026
**Focus: transparency, honesty, and polish — driven by a deep review of what scientists actually need. Same single, offline, private file.**

- **Show every data point** — bar and box charts can overlay all raw replicate values as jittered dots (deterministic, so the SVG export matches the preview), exposing the n and spread a bare bar hides — now an explicit Nature/eLife/JCB expectation. Two new distribution kinds join them: **violin** (Gaussian KDE) and **beeswarm** (dots with a mean ± SD summary).
- **Significance brackets anchored to bar heights** — brackets sit just above the bars they compare and stack when nested, instead of floating at a fixed ceiling. Still the author's own typed symbol; no p-value is ever computed.
- **Reference / threshold lines** — an author-supplied dashed line at a limit of detection, baseline, or cutoff (y or x), drawn as vector.
- **Submission-ready packages** — each chart's exact rows are written to a **Source Data CSV** (with the error-metric formula and any significance symbols noted), and a bar chart whose y-axis doesn't start at zero is flagged on the figure as visually exaggerating differences.
- **Honest measurements** — ROI area/intensity, line profile, cell count, and exposure analysis now disclose that they read the **8-bit display** (after any brightness/contrast/gamma/LUT), not raw data — strengthened when the measured panel has adjustments applied. Exposure "saturated" is relabelled "clipped on the display".
- **Full adjustments on freeform panels** — gamma, black/white levels, fluorescence LUTs, grayscale, and invert are now reachable on freeform image elements (🎚 More…), matching grid mode and closing the largest grid↔freeform gap.
- **Performance & polish** — image adjustment sliders preview live as you drag (rAF-coalesced) instead of after a pause; the freeform render loop drops an O(n²) index lookup; and chart legends auto-size to fit long labels instead of clipping them.

### v3.7 — 20 July 2026
**Focus: the data figures, flowcharts and asset-rich schematics that used to need a second tool — all in the same single, offline, private file. Every chart draws as true vector.**

- **Data charts from a CSV** 📊 — drop a `.csv`/`.tsv` or paste from Excel and get a bar, grouped/stacked bar, line, scatter (with an OLS linear fit), or box-and-whisker plot that composes alongside image panels, rotates and hit-tests like any object, and renders crisply at export DPI. Charts draw through a swappable emit backend (canvas *and* SVG from one geometry pass), so SVG export carries true `<rect>`/`<line>`/`<text>` — never a rasterised blit. Colourblind-safe palettes (Okabe–Ito default).
- **Honest statistics, enforced.** Error bars are **SD** (sample, n−1 denominator) or **SEM** (SD/√n), named in the UI and in the generated code. **FigureLab never computes a p-value** — significance brackets are the symbol *you* enter from your own test, with the disclaimer in the editor. The whole dataset is edited in one textarea and replaced wholesale — no dragging bars or nudging points.
- **Heatmaps & survival curves** — omics-style value matrices with a *mandatory* colourbar and perceptually-ordered scales (viridis/magma/blues; a diverging scale requires an explicit midpoint). Kaplan–Meier survival curves (product-limit estimator) with censoring ticks — a documented plotting transform, with **no log-rank / Cox inference** computed.
- **Chart code export** — every chart emits self-contained **matplotlib & ggplot** code with the data inlined and the exact error-metric formula (`SEM = SD/sqrt(n), SD with ddof=1`) written into a comment, plus a note that significance marks are author-supplied.
- **Flowcharts with real connectors** — a connector line **stays attached** to two objects (by identity, not position) and reroutes as they move, resize, or rotate; it hit-tests along the polyline and exports as vector. One-click **PRISMA 2020**, **CONSORT** and **fishbone (Ishikawa)** templates, built from grouped box+label pairs and connectors, with editable placeholder counts. (Structure follows the named guidelines; no published diagram artwork is reproduced.)
- **Group & ungroup** (`Ctrl+G` / `Ctrl+Shift+G`) so a box drags its label as one and duplicates rewire correctly. Elements now carry stable string ids for reliable references.
- **~50 recolourable icons** across cells, molecules, organisms & lab equipment, with a search box; **one-click themes** (grayscale-for-print, high-contrast, fluorescence-dark, poster) applied over the figure's chrome in a single undo step.
- **Honest background removal** — make a flat background transparent with a tolerance slider + eyedropper; it's a non-destructive adjustment (original pixels kept), disclosed in the provenance log, and undoes cleanly.
- **Accessibility & disclosure** — generate factual figure **alt-text** (rule-based, with an optional on-device polish) embedded in PNG metadata; AI-generated schematics are tagged in the layer list and export metadata, and generative AI is never applied to imported experimental images.
- **Fixed:** freeform figures were exporting at on-screen resolution (~1200×900) regardless of the DPI selector — they now supersample to the true target DPI like grid mode. Also fixed a per-frame recompute of freeform image adjustments during drags.

### v3.6 — 10 July 2026
**Focus: a friendly, direct-manipulation figure editor + opening the image formats scientists actually have — same single file, still offline & private.**

- **Friendly figure editor (Freeform mode)** — click-to-select, drag-to-move, handle resize (aspect-locked for images), and a **rotate handle** that snaps to 0/45/90°. Objects **snap into alignment** with live magenta guides, and a floating context toolbar puts duplicate, lock, layer order & delete next to the selection.
- **Per-object text** — double-click text to edit it in place; set font family, size, bold/italic, colour and alignment per object.
- **Cover patch** 🩹 — the integrity-safe way to hide or replace baked-in text: an opaque, movable object (with *match background*) you type new text over. Reversible and recorded in the session — never a hidden pixel edit.
- **Paint layer** 🖌 — a brush & eraser that draw on a *separate overlay*, so your original image pixels are never modified. The layer appears in the layer list and every stroke is logged in the figure's provenance — non-destructive by design, so it can't be used to quietly alter data.
- **Science icon library** — drop in vector arrows, brackets, scale bars, cell/nucleus, significance asterisks & error-bar caps; they stay crisp and re-export as vector.
- **Starter templates** — 2×2 / 3×3 grids, before/after, or a freeform pathway diagram to start from.
- **Pop out to free layout** — convert a grid into freely-movable panels in one click.
- **Format painter** — copy one object's look (colour, fill, stroke, font) onto others.
- **TIFF import** — a dependency-free, client-side decoder opens `.tif/.tiff` that browsers can't (Chrome/Edge/Firefox): uncompressed, LZW, PackBits, Deflate & JPEG-compressed; 8/16-bit & 32-bit float; grayscale, RGB, RGBA, CMYK & palette; strips or tiles; little/big-endian; horizontal-differencing predictor; and **multi-page** TIFFs (each page becomes a panel). Verified pixel-exact against a `tifffile`-generated fixture matrix.
- **Scale auto-calibration** — importing a TIFF with pixel-size metadata (OME-TIFF, ImageJ, Zeiss LSM, or a cm-resolution tag) sets µm/px automatically, so the scale bar is calibrated with no clicking. Print-DPI (inch resolution) is ignored so it's never mistaken for a real scale; you can always override.
- **Recolourable science icons** and one-click **Relabel A, B, C…** (renumber panels in reading order).
- **SVG stays vector** — imported SVGs keep their vector source (crisp at any size) and **re-export as vector** in SVG output, editable in Illustrator/Inkscape.
- **Save dialog** — every export opens a dialog to set name, format & DPI first; on Chrome/Edge you choose the folder in the OS's native Save window.
- **Duplicate** (`Ctrl+D`), **lock**, and multi-object layer ordering for Freeform objects.

_Published & citable — latest version DOI [`10.5281/zenodo.22084181`](https://doi.org/10.5281/zenodo.22084181) (v3.13.0). The concept DOI always resolves to the latest._

### v3.5 — 8 July 2026
**Focus: UI/UX clarity, onboarding, scientific integrity, and export reliability — without changing the single-file, offline, privacy-first identity.**

- **Submission package** — a `📦 Export submission package (ZIP)` button bundles everything a journal or lab needs into one archive: PNG, uncompressed TIFF, lossless PDF, SVG, session JSON (images embedded), metadata CSV, caption, figure notes, R + Python scripts, reproducibility log, each panel as a separate PNG, and a provenance manifest. Built on a dependency-free client-side ZIP writer.
- **Editable PowerPoint (.pptx) export** — `📊 Export editable PowerPoint` writes an OOXML deck where each panel is a separate, movable picture at its real position and the title is an editable text box — finish the figure in PowerPoint. Fully offline, no dependencies.
- **Smart image import** — image cards show pixel dimensions, aspect ratio, a channel chip detected from the filename (DAPI/GFP/mCherry/Cy5/phase/merge), and a duplicate-name warning; **Sort by name** natural-sorts and relabels, **Auto-channels** assigns colourblind-safe LUTs from the detected channels.
- **Split-channel row** — one click explodes a multi-channel composite into separate single-channel panels (each with its LUT and a channel caption) plus a merge.
- **Matched / linked panels** — assign panels a *Match group* and **⇉ Sync group** copies brightness/contrast/gamma/LUT/levels/scale-bar length across the whole comparison group, so it's processed identically (integrity-safe).
- **Gel/blot splice marker** — drop a visible lane-divider line where blot lanes were spliced (a journal requirement), under Annotate → Blot/gel tools.
- **House styles** — save your lab's *look* (background, label font/size/colour/format, scale-bar style, panel border, typography) and apply it to any figure in one click, so every figure in a paper matches. (Distinct from Templates, which save layout.) Under Style → House styles.
- **On-device AI caption polish** (optional) — a `🤖 Polish with on-device AI` button refines your figure legend using **Chrome's built-in Gemini Nano (Prompt API)**, running *entirely on your machine* so nothing is uploaded. Feature-detected; falls back to the rule-based caption when unavailable. See *[On-device AI](#on-device-ai)*.
- **"What's New" tab** in Help with the dated changelog, plus a "new" dot on the header ❔ after an update.

- **Task-based sidebar** — sections named for what you are doing (Images, Arrange, Crop & Scale, Annotate & Draw, Look, Measure, Check, Export), in workflow order. Every tool stays visible; sections collapse and deeper tools group under a "More" rule. See *[Finding things](#finding-things)*. (Replaced the Simple/Advanced toggle in v3.9.3.)
- **Empty-state start screen** — a blank canvas now shows a launchpad: drop images, start from a template, load a session, or try the example figure, plus an `Import → Layout → Calibrate → Annotate → Audit → Export` workflow strip.
- **Load example figure** — one click generates four procedural micrographs (DAPI / GFP / mCherry / merge) in a labelled, scale-barred 2×2 so you can explore instantly with no files. Clear with one undo.
- **Command palette** — <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> opens a fuzzy launcher for every action (render, all exports, audit, save/load, presets, match scale, batch crop, toggle mode, help…).
- **Export preflight** — the Export-panel format buttons show format, file name, DPI, final pixel dimensions, physical size (mm + in), estimated file size, vector-vs-raster status, and integrity warnings before you commit. (Toolbar **Quick** buttons still export instantly.)
- **Colour-vision-deficiency (CVD) simulation** — a `👁 CVD` toolbar selector previews the figure as deuteranope / protanope / tritanope viewers see it, to self-check that fluorescence merges stay distinguishable. Display-only — exports are never altered.
- **Colourblind-safe default LUTs** — new multi-channel merges default to magenta/green rather than red/green.
- **Contextual `?` info chips** — plain-language, methods-aware explanations on Export DPI, formats, panel labels, scale bars, per-panel adjustments, and LUTs. Keyboard-accessible.
- **Auto-arrange panels** — proposes a balanced grid, even gutters, and labels for the current panel count. Undoable.
- **Lossless PDF export** — alongside the standard JPEG-based PDF, a Flate-compressed lossless PDF for line art and blots; both now export at the true target DPI (previously screen resolution).
- **In-app Help & FAQ** — a tabbed Help modal (Getting Started · Use Cases · FAQ) reachable from the header `❔` and footer.
- Docs/accuracy: version unified via a single `APP_VERSION`; corrected the outdated "images aren't saved" note (sessions embed images — see [Session save](#session-save--load)); added a `CITATION.cff` / Zenodo metadata for citing the tool; CI runs the Playwright suite (now 33 tests).

**Also in v3.5 (workflow, integrity & onboarding):**
- **Full-session autosave & crash recovery** — a debounced snapshot to local storage (with a "last autosaved" status and on/off toggle) offers to recover your work after an accidental close.
- **Actionable journal audit** — the compliance check adds scale-bar calibration, adjustment-sanity, and export-size checks, each with a one-click fix (Set 300 DPI, Make white, Calibrate, Show labels).
- **Before/after adjustment slider** — a per-panel wipe between original and adjusted pixels.
- **Layer panel** — rename / hide / lock annotations.
- **Matched panels** now also sync crop and physical field of view; **western-blot mode** adds lane labels, an MW ladder, and a blot-metadata CSV (with the splice marker).
- **Smart import** gains a filename pattern parser (`condition_time_channel_rep`); **crop editor** gains arrow-key nudge and copy-crop-to-group/all.
- **More journal presets** (eLife, PLOS, EMBO, PNAS); **lightweight vs bundled** session saves; **house-style** presets.
- **First-run guided tour**, **PWA install** (over http/https), **SHA-256 provenance stamp** in export metadata, and **sRGB** colour tagging in PNGs.

**Make it yours:**
- **Session library** — keep multiple named figures in your browser (IndexedDB, with thumbnails) and switch between them: save the current figure, then open / update / rename / delete any of them from Export → My sessions. All local.
- **Personalized welcome** — the start screen greets you by name and time of day. Set your name, theme, and the animated background from **⚙ Customize** (also in the command palette).
- **Animated science background** — the drifting bio-graphics behind an empty canvas now include molecules and cells alongside phage, bacteria, DNA, and vesicles. Toggleable, and it respects `prefers-reduced-motion`.

### v3.4
- **Crisp on-screen preview on HiDPI displays** — a separate high-resolution display layer renders the figure at devicePixelRatio once editing settles, so panel labels, scale bars, and annotations stay sharp when zoomed in. The figure buffer that measurements and exports read is left at logical resolution and untouched, so quantification stays exact
- **Universal undo/redo** — Ctrl+Z / Ctrl+Y now cover layout (grid size, gaps, margins, gutters), per-panel adjustments (brightness/contrast/gamma/LUT/levels/crop/rotate/flip), panel add/delete/duplicate/reorder, label toggles, and annotations — not just annotations. One undo step per edit gesture
- Reliability & UX hardening: corrupt-file and clipboard/export error toasts, export progress indicator, "render outdated" cue, first-run tips, confirm on Apply-to-all
- Performance: per-panel adjustment cache + rAF-coalesced renders for smooth slider dragging
- Accessibility: visible focus rings, aria-labelled icon buttons, on-screen-clamped floating toolbar, higher-contrast theme text

### v3.3
- **Drag-to-space gutters** — hover between panels and drag the divider (or tap + / −) to set spacing directly on the canvas
- **Per-gutter spacing** mode for independent row/column gaps, with one-click reset to uniform
- **One-click label toggle** — ⊞ Labels toolbar button and an on-canvas × chip
- **Double-click to add text** onto any panel, with an inline editor and a readability halo (also exported to SVG)
- **True high-resolution raster export** — PNG/JPEG/WebP re-rendered at the real target-DPI pixel count, with high-quality image smoothing throughout

### v3.0
- Rotate and flip per panel
- Gamma correction slider
- Auto scale bar (picks a clean µm value)
- Apply settings to all panels
- Double-headed arrow (Arrow2) annotation
- Ruler annotation with tick marks
- Cell counter tool
- Filled rect/ellipse with opacity
- Shift-key snap (45° angles, square shapes)
- Label format selector (A/a/1/i)
- Panel border styling
- CSV metadata export
- Zoom to fit / 1:1 / Copy to clipboard buttons
- Empty panel slot shows dashed border and slot number
- Info bar shows physical size in mm
- Print-ready CSS (`Ctrl+P` hides all UI chrome)
- Notes scratchpad saved in session JSON
- Lock panel to prevent drag-reorder
- Fix: annotation drag is smooth (live preview on overlay canvas)
- Fix: TIFF exports at correct DPI (pixel count scaled, not just tag)
- Fix: SVG export uses native vector elements for annotations

### v2.0
- Full annotation system (arrow, rect, ellipse, line, text, inset)
- Panel annotations pinned to individual panels
- Interactive crop editor
- Multi-channel fluorescence composite
- Fluorescence LUTs
- Black/white point clipping
- Calibration tool
- Journal compliance checker
- Undo/redo history
- Reproducibility R/Python scripts

---

## Citation

If you use FigureLab in your research, please cite it. Metadata lives in
[`CITATION.cff`](CITATION.cff), so GitHub shows a **"Cite this repository"**
button automatically.

> Awuah, M. B. (2026). *FigureLab: a browser-based tool for assembling
> publication-quality scientific figures* (Version 3.6.1) [Computer software].
> Zenodo. https://doi.org/10.5281/zenodo.21269456

**BibTeX:**

```bibtex
@software{awuah_figurelab_2026,
  author    = {Awuah, Michael Baffour},
  title     = {{FigureLab: a browser-based tool for assembling publication-quality scientific figures}},
  year      = {2026},
  version   = {3.6.1},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.21269456},
  url       = {https://github.com/mbaffour/FigureLab}
}
```

The DOI above is the **concept DOI** — it always resolves to the latest version.
To cite this exact release, use the v3.13.0 DOI [`10.5281/zenodo.22084181`](https://doi.org/10.5281/zenodo.22084181). Every archived version's DOI is listed in [`CITATION.cff`](CITATION.cff).

---

Free and open-source for scientists.
