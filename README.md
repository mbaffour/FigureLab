# FigureLab v3.0

A single HTML file for assembling publication-quality scientific figures. No installation, no server, no internet required — open in any browser and start working.

Works for microscopy images, western blots, histology, gels, clinical photos, or any image-based figure.

*Built with passion for science and discovery.*

---

## Quick Start

1. Open `figure_lab.html` in your browser (Chrome or Firefox recommended)
2. Drag images onto the drop zone, or click to browse
3. Adjust the grid layout, labels, and scale bars
4. Click **⟳ Render** (or press **R**) to preview
5. Export in your chosen format

---

## What's in v3.0

### Core Layout
| Feature | Details |
|---|---|
| Grid layout | Rows × columns with independent horizontal and vertical gap control |
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
| PDF | Embedded raster at correct physical size |
| SVG | Background raster + vector annotations as native SVG elements |

Set a **file name** and **DPI** (72 / 150 / 300 / 600) before exporting. TIFF is scaled from screen resolution to the target DPI so the pixel dimensions are correct for print.

The info bar below the canvas shows both pixel dimensions and physical size in mm at the current export DPI.

### CSV Metadata Export
Click **⬇ CSV Metadata** to export a spreadsheet of all panel settings — name, label, µm/px, scale bar, brightness, gamma, crop, caption, and metadata notes. Useful for methods sections and lab records.

### Reproducibility Scripts
Export an **R script** (uses `magick`) or **Python script** (uses `Pillow + matplotlib`) that recreates the figure from your original image files.

### Caption Generator
Add a short note to each image in its settings panel, then click **✦ Generate Caption** to produce a structured journal-style caption:

> Figure. Effect of treatment. (A) Control cells. Scale bar, 10µm. (B) Treated cells. Scale bar, 10µm.

### Session Save / Load
Save the entire layout as a JSON file and reload it later. Images themselves are not stored — re-drop them after loading.

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
- TIFF export: uncompressed RGB, scaled to target DPI (not just metadata — actual pixel count is correct)
- PNG export: pHYs chunk injected for correct DPI in Photoshop / ImageJ
- PDF export: JPEG-compressed raster at correct physical page size
- SVG export: background PNG + native SVG shapes for vector annotations
- Gamma correction uses a 256-entry LUT computed once per render for speed
- Fonts: JetBrains Mono, Instrument Serif (loaded from Google Fonts if online, falls back to system fonts offline)

---

## Changelog

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

Free and open-source for scientists.
