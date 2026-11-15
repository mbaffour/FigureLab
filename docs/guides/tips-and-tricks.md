# Tips and tricks

Shortcuts and habits that save the most time, and the pitfalls that cost the most. Checked on this build by [`verify/tips.verify.js`](verify/tips.verify.js), with the freeform items checked by [`verify/freeform.verify.js`](verify/freeform.verify.js).

## Find any tool with ⌘K

Press <kbd>⌘K</kbd> (<kbd>Ctrl+K</kbd>), type a few words, press <kbd>Enter</kbd> on the top hit. Plain phrases work, verbs included. Each phrase below put the named tool first:

| Type | Top hit |
|---|---|
| `add arrow` | Draw an arrow |
| `remove white border`, `trim` | Trim borders… (with a preview) |
| `change font` | Font (typeface) of letters and labels |
| `font size` | Text size in points (charts, gene maps, bar text, key) |
| `letter size` | Size of the panel letters |
| `span` | Make a panel span two columns or rows (big panel): opens the selected panel's span field |
| `make bigger` | Panel width |
| `copy style` | Copy one panel's look to every panel (Apply to all) |
| `swap panels` | Swap or reorder panels |
| `batch crop`, `densitometry`, `lane table` | the blot tools ([Western blot](western-blot.md)) |
| `calibrate`, `auto-detect scale bar`, `ruler`, `count plaques` | the measuring tools ([Phage and microbiology](phage-and-microbiology.md)) |
| `scale bar off` | Scale bars off on uncalibrated panels |
| `split channels`, `linked inset` | [Fluorescence](fluorescence.md) tools |
| `sample colours` | Sample colours (one colour per strain in every chart)… |
| `nature`, `plos`, `asm`… | Journal: … (applies the preset) |
| `check against plos` | Check against PLOS ONE (report only, changes nothing) |
| `legend key`, `alt text`, `submission`, `replace image`, `load session` | the [submission](journal-submission.md) tools |
| `position` | Position and size: type X, Y, W, H or angle (freeform) |
| `graphical abstract` | Canvas: graphical abstract (Elsevier) |
| `tutorial` | Tutorials — list them all |

**Journal: …** changes your figure; **Check against …** only reports. To check against a second journal without switching, type `check against` and the name.

## Keyboard

| Keys | Does |
|---|---|
| <kbd>R</kbd> | Render (redraw) the figure |
| <kbd>Ctrl/⌘+Z</kbd> | Undo |
| <kbd>Ctrl/⌘+Shift+Z</kbd> or <kbd>Ctrl+Y</kbd> | Redo |
| <kbd>Ctrl/⌘+S</kbd> | Save the session file, images included |
| <kbd>Esc</kbd> | Close a dialog, leave a tool, deselect |
| <kbd>Ctrl</kbd> + scroll | Zoom about the pointer |
| <kbd>Space</kbd> + drag | Pan a zoomed figure (click the empty canvas first, so the Space is not typed into a field) |
| <kbd>Tab</kbd> once after the page loads, then <kbd>Enter</kbd> | "Skip to the figure toolbar" |
| <kbd>Ctrl/⌘+I</kbd>, <kbd>Ctrl/⌘+B</kbd> in a text field | Wrap the selection in italic or bold marks |
| Arrow keys / <kbd>Shift</kbd>+arrows | Freeform: move the selection 1 px / 10 px |
| <kbd>]</kbd> <kbd>[</kbd> (with <kbd>Shift</kbd>: 5°) | Freeform: turn the selection 1° |
| <kbd>Ctrl/⌘+A</kbd> | Freeform: select everything |

## Type exact values instead of dragging

Every place where precision matters takes a typed number:

- **Display range of a 16-bit image**: ⚙ › **Black pt** / **White pt** in the file's own counts, then **≡ Sync by channel** ([Fluorescence](fluorescence.md)).
- **Batch crop**: the **px** X / Y / W / H boxes (type W and H before X and Y), so every strip has the same size and lane positions ([Western blot](western-blot.md)).
- **Calibration**: **Pixel distance** and the length in nm, µm or mm in **🔬 Calibrate from image** ([Phage and microbiology](phage-and-microbiology.md)).
- **Inset region**: the px fields in **⧉ Add linked inset…**.
- **Chart axes**: **Y min** / **max** in the Chart dialog ([Charts](charts.md)).
- **Freeform**: X, Y, W, H and ∠ in the bar above the canvas, in px or mm, then <kbd>Enter</kbd>. ⌘K `position` jumps to X ([Freeform](freeform.md)).

## Points, not pixels

Journals give type sizes in points at the printed size, and FigureLab keeps text in points:

- **Look › Typography › Text size** (pt) sets charts, gene maps, scale-bar text and the legend key. **Font family** sets them all to one face.
- **Look › Panel Labels (A, B, C…) › Size** has a **pt** box with **px** beside it. Typing px is fine; the pt follows. In the test, 8 pt was 10.7 px at the full canvas width and 21.7 px after **Export › Printed width › 89 mm**: the pt stayed 8.
- Choose the **Printed width** (or a journal preset) before you fine-tune sizes; the pt sizes then print as typed.

## Marks that stay on their panel

- **Double-click a panel, type, press <kbd>Enter</kbd>**: the text is pinned to that panel. In the test it stayed on panel A when A was spanned over two columns.
- Marks drawn over a panel belong to it. Checked here: text and an arrow stayed on their panel through a span change, and MW labels and the lane table stayed on a blot through **⇄ Replace image…** ([Western blot](western-blot.md)). The fixers' notes add rulers and lane numbers, and reorder, width, row-height and crop changes. Draw a mark over the panel it belongs to.
- **📌 Panel mode (annotations follow panels)** in Annotate & Draw attaches new marks to the panel you draw on. Select a mark with **↖ Select**, and its floating toolbar's **⧉ Repeat on…** menu copies it onto **panels in this row**, **panels in this match group** or **every panel** ("arrow repeated on 1 panel" in the test, for a two-panel row).

## Panels

- **Right-click a panel** on the canvas for **⇄ Replace image…**, **⧉ Add linked inset…**, **📊 Edit chart…** (charts), **⚙ Open settings** and more.
- **Drag one panel onto another** on the canvas to swap them; the letters follow position.
- **⌘K `span`** with a panel selected opens its **Col span** / **Row span** fields; then **Arrange › ⊞ Fit grid to panels**.
- Charts and gene maps are grid panels with letters of their own: a CSV dropped into a grid becomes the next lettered chart panel, and **Annotate & Draw › 🧬 Linear › 📄 GenBank / FASTA…** adds a gene map panel ([Phage and microbiology](phage-and-microbiology.md)).
- Format marks in labels: `*italic*`, `**bold**`, `10^{8}` superscripts and `H_{2}O` subscripts. Checked here in the figure title (<kbd>Ctrl/⌘+I</kbd>), lane table cells (`Δ*phoA*`, `10^{-1}`), chart axis titles (`OD_{600}`) and freeform text boxes.

## Freeform

- Select several with <kbd>Shift</kbd>- or <kbd>⌘</kbd>-click, or a drag box started on empty canvas, or <kbd>Ctrl/⌘+A</kbd>. <kbd>Esc</kbd> or a click beside the canvas deselects.
- **Space** N then **⇿** or **⇕** puts an exact gap between the selected objects; **=W** and **=H** match the first one selected. Place the two outer objects first, then **←→** spreads the rest evenly between them.
- **Props › Clip ◯ ⬭ ▢** clips a picture to a circle, ellipse or rounded rectangle (radius beside ▢). A clip set in the grid survives **⇱ Pop out to free layout**.
- **⬇ Behind** puts a box behind the panels; choosing a fill colour ticks Fill; **Corner R** rounds a rectangle.
- Double-click a text mark to edit it. Overlapping objects can be picked by name in the **Elements** list.

## Tutorials without losing your figure

Help (**❔**) › Tutorials, or ⌘K `tutorial`. A tutorial replaces your figure with its own demo. When you click **End**, FigureLab asks **Bring your own figure back?**: click **Confirm** and your figure returns in one step. Saving first (<kbd>Ctrl/⌘+S</kbd>) costs nothing.

## Common pitfalls

| Pitfall | How to avoid it |
|---|---|
| Letters fail **Text contrast** on light panels. | Untick **Look › Panel Labels (A, B, C…) › Background**; Auto contrast then picks black or white per panel. The report's own **Auto contrast** button does not fix it while Background is ticked. |
| **Trim borders** would cut a dark fluorescence field. | The dialog previews each panel. Blots and gels start unticked, but a fluorescence image with a black background starts ticked (in the test it would have kept 45 % of a DAPI field). Untick it before **Trim ticked panels**. |
| The compliance **Export format** row fails although you exported. | It checks the format you saved last. Export in the journal's format (e.g. **↓ PDF lossless** for Nature), then re-check. |
| The figure prints taller than the journal allows. | A preset sets the width; a figure with many rows can then exceed the height limit. Choose a narrower **Export › Printed width** or use fewer rows. |
| <kbd>Space</kbd> + drag does not pan. | A text field still has the focus. Click the empty canvas first. |
| A whole row typed into a lane table cell lands in one cell. | Separate the cells: `- + - + - +` with spaces fills a +/− row; doses and other text need commas (`10^{0}, 10^{-1}, …`). |
| Bigger figures go missing after a browser crash. | Autosave cannot hold large images. Save the session file yourself (<kbd>Ctrl/⌘+S</kbd>) and keep it. |
| A chart's tick labels run together in a single grid cell. | At journal type size a one-cell chart is small: span it over two columns (⌘K `span`). |
| A colour set for a strain in one chart does not reach another. | The sample must have exactly the same name in both charts (`MOI 0` is not `MOI_0`). Use the chart's **shown as** box to rename. |

![Trim borders: the blot starts unticked, but the two fluorescence fields start ticked and would lose their dark background](img/tips-trim.png)

More in [Troubleshooting](troubleshooting.md). Back to the [guide index](README.md).
