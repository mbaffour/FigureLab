# Tips and tricks

Shortcuts and habits that save the most time, and the pitfalls that cost the most. Checked on this build by [`verify/tips.verify.js`](verify/tips.verify.js); tips that belong to one kind of figure are checked by that guide's script (named beside them).

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
| `batch crop`, `densitometry`, `lane table` | the blot tools ([Western blot](western-blot.md)); `densitometry` and `lane table` act on the panel you clicked last, and with none picked ask **Which panel?** |
| `calibrate`, `auto-detect scale bar`, `ruler`, `count plaques` | the measuring tools ([Phage and microbiology](phage-and-microbiology.md)) |
| `add scale bar` | Scale bar: add one to a micrograph (calibrate it)… (opens the ⚙ of the selected panel, or of the first one without calibration, at **Objective**, **🔬 Calibrate from image** and **🔍 Auto-detect scale bar**) |
| `scale bar off` | Scale bars off on uncalibrated panels |
| `scale bar corner` | Scale bar: which corner (move it, keep it clear of a bar in the image) |
| `copy calibration` | Same µm/px on ticked panels (copy a calibration): tick the rows of photos taken with one set-up first |
| `fit panels to images` | Fit panels to images (remove white bars) |
| `relabel` | Relabel panels A, B, C… |
| `rename channel` | Rename a channel in the legend key |
| `split channels`, `linked inset` | [Fluorescence](fluorescence.md) tools |
| `sample colours` | Sample colours (one colour per strain in every chart)… |
| `nature`, `plos`, `elife`, `asm`… | Journal: … (applies the preset) |
| `mbio`, `j bacteriol`, `jbc` | the journal's preset by its abbreviation (`mbio` and `j bacteriol` find Journal: ASM) |
| `nat comms` | Journal: no preset for Nature Communications (says so and changes nothing) |
| `check against plos` | Check against PLOS ONE (report only, changes nothing) |
| `legend key` | Legend key: place it on the figure (Enter places it) |
| `alt text`, `submission`, `replace image`, `load session` | the [submission](journal-submission.md) tools |
| `session library` | Save to session library (a named copy of this figure) |
| `position` | Position and size: type X, Y, W, H or angle (freeform) |
| `graphical abstract` | Canvas: graphical abstract (Elsevier) |
| `tutorial` | Tutorials — list them all |
| `save my work`, `add images`, `delete panel`, `make text bigger` | Save session, Add images, Remove the selected panel, Text size in points |

**Journal: …** changes your figure; **Check against …** only reports. To check against a second journal without switching, type `check against` and the name: the report's title ends "· report only", and its **Switch the target to …** link changes the journal if you want ([Journal submission](journal-submission.md)).

## Keyboard

| Keys | Does |
|---|---|
| <kbd>R</kbd> | Render (redraw) the figure |
| <kbd>Ctrl/⌘+Z</kbd> | Undo |
| <kbd>Ctrl/⌘+Shift+Z</kbd> or <kbd>Ctrl+Y</kbd> | Redo |
| <kbd>Ctrl/⌘+S</kbd> | Save the session file, images included (also with the cursor in a text box) |
| <kbd>Esc</kbd> | Close a dialog, leave a tool, deselect |
| <kbd>Ctrl</kbd> + scroll | Zoom about the pointer |
| <kbd>Space</kbd> + drag | Pan a zoomed figure (click the empty canvas first, so the Space is not typed into a field) |
| <kbd>Tab</kbd> once after the page loads, then <kbd>Enter</kbd> | "Skip to the figure toolbar" |
| <kbd>Tab</kbd> twice after the page loads, then <kbd>Enter</kbd> | "Skip to the welcome card — add images, load a session, tutorials" |
| Arrow keys on the figure | Pick a panel. Click a panel first, or Tab to the figure (it comes right after the toolbar: 20 presses after ⟳ Render in the test) |
| <kbd>Shift</kbd>+arrow on the figure | Swap the picked panel with its neighbour; the letters follow position |
| <kbd>Enter</kbd> on the figure | Open the picked panel's settings (⚙) |
| <kbd>Ctrl/⌘+I</kbd>, <kbd>Ctrl/⌘+B</kbd> in a text field | Wrap the selection in italic or bold marks |
| Arrow keys / <kbd>Shift</kbd>+arrows | Freeform: move the selection 1 px / 10 px |
| <kbd>]</kbd> <kbd>[</kbd> (with <kbd>Shift</kbd>: 5°) | Freeform: turn the selection 1° |
| <kbd>Ctrl/⌘+A</kbd> | Freeform: select everything |

## Type exact values instead of dragging

Every place where precision matters takes a typed number:

- **Display range of a 16-bit image**: ⚙ › **Black pt** / **White pt** in the file's own counts, then **≡ Sync by channel** ([Fluorescence](fluorescence.md)).
- **Batch crop**: the **px** X / Y / W / H boxes, in any order; the next scan opens with the same box, so every strip has the same size and lane positions ([Western blot](western-blot.md)).
- **Calibration**: **Pixel distance** and the length in nm, µm or mm in **🔬 Calibrate from image** ([Phage and microbiology](phage-and-microbiology.md)).
- **Inset region**: the px fields in **⧉ Add linked inset…**.
- **Chart axes**: **Y min** / **max** in the Chart dialog ([Charts](charts.md)).
- **Freeform**: X, Y, W, H and ∠ in the bar above the canvas, in px or mm, then <kbd>Enter</kbd>. ⌘K `position` jumps to X ([Freeform](freeform.md)).

## Points, not pixels

Journals give type sizes in points at the printed size, and FigureLab keeps text in points:

- **Look › Typography › Text size** (pt) sets charts, gene maps, scale-bar text and the legend key. **Font family** sets them all to one face.
- **Look › Panel Labels (A, B, C…) › Size** has a **pt** box with **px** beside it. Typing px is fine; the pt follows. In the test, 8 pt was 10.7 px at the full canvas width and 21.6 px after **Export › Printed width › 89 mm**: the pt stayed 8.
- Choose the **Printed width** (or a journal preset) before you fine-tune sizes; the pt sizes then print as typed.

## Marks that stay on their panel

- **Double-click a panel, type, press <kbd>Enter</kbd>**: the text is pinned to that panel. In the test it stayed on panel A when A was spanned over two columns.
- Marks drawn over a panel belong to it. Checked here: text and an arrow stayed on their panel through a span change, and MW labels and the lane table stayed on a blot through **⇄ Replace image…**, the MW labels at the old scan's heights until the strip was analysed again ([Western blot](western-blot.md)). On a charted blot, **↻ Update from densitometry** in the chart does that; on a strip that is not charted (a loading control or total-protein stain), open its own **⫼ Lanes & bands**: in the test the toast then said "4 MW labels of panel A moved onto the new ladder’s bands". The fixers' notes add rulers and lane numbers, and reorder, width, row-height and crop changes. Draw a mark over the panel it belongs to.
- **📌 Panel mode (annotations follow panels)** in Annotate & Draw attaches new marks to the panel you draw on. Select a mark with **↖ Select**, and its floating toolbar's **⧉ Repeat on…** menu copies it onto **panels in this row**, **panels in this match group** or **every panel** ("arrow repeated on 1 panel" in the test, for a two-panel row).

## Panels

- **Right-click a panel** on the canvas for **⇄ Replace image…**, **⧉ Add linked inset…**, **📏 Scale bar / calibrate…**, **📊 Edit chart…** (charts), **⚙ Open settings** and more. If another panel's ⚙ is open in the sidebar, it moves to the panel you right-clicked. **📏 Scale bar / calibrate…** is the way to a scale bar on a micrograph without calibration: its ⚙ opens at **Objective**, **🔬 Calibrate from image** and **🔍 Auto-detect scale bar** (⌘K `add scale bar` does the same for the selected panel).
- **Drag one panel onto another** on the canvas to swap them; the letters follow position. From the keyboard: Tab to the figure, pick a panel with the arrow keys, <kbd>Shift</kbd>+arrow swaps it, <kbd>Enter</kbd> opens its settings. A screen reader hears each step ("Moved: … is now panel A; … Ctrl+Z undoes it").
- **⌘K `trim` › Trim borders…** lists each panel with a margin and what it would lose. Blots, gels and micrographs on a black background start unticked, and a panel that would lose more than half its area is flagged; tick only the panels with a real border.
- **⌘K `span`** with a panel selected opens its **Col span** / **Row span** fields; then add the row it needs. A span takes cells from the panels after it, and a panel left without one is not drawn: the status bar under the figure says so ("3 panel(s) · 1 not drawn (no cell)"). Type one more **Arrange › Rows** and it is drawn again. A **Row span** in the grid's last row says "D is in the grid's last row — Row span 2 needs 1 more row (Arrange › Rows)", and its **Add 1 row** button adds it.
- **⌘K `fit panels to images`** removes white bars around photos of another shape. With mixed shapes the toast says the odd ones still have bars and offers **⛶ Crop to fill cells**, which crops each to its cell. A journal preset chosen afterwards keeps the panel shape.
- **↻ / ↺ in the toolbar** turn the selected photo. With no panel selected they turn every photo, and the toast says so ("No panel was selected, so all 4 photos (A, B, C and D) turned clockwise…") with an **↶ Undo** button.
- **Removing a panel** that leaves a gap in the letters: the toast offers **🔤 Relabel A, B, C…** ([Journal submission](journal-submission.md)).
- **✕ New** keeps a font you chose by hand: "New figure started — font Times New Roman kept".
- Charts and gene maps are grid panels with letters of their own: a CSV dropped into a grid becomes the next lettered chart panel, and **Annotate & Draw › 🧬 Linear › 📄 GenBank / FASTA…** adds a gene map panel ([Phage and microbiology](phage-and-microbiology.md)).
- Format marks in labels: `*italic*`, `**bold**`, `10^{8}` superscripts and `H_{2}O` subscripts. Checked here in the figure title (<kbd>Ctrl/⌘+I</kbd>), lane table cells (`Δ*phoA*`, `10^{-1}`), chart axis titles (`OD_{600}`) and freeform text boxes.

![Trim borders: the three panels with a margin, each with what it would lose; the blot and the two fluorescence fields start unticked](img/tips-trim.png)

## Freeform

- Select several with <kbd>Shift</kbd>- or <kbd>⌘</kbd>-click, or a drag box started on empty canvas, or <kbd>Ctrl/⌘+A</kbd>. <kbd>Esc</kbd> or a click beside the canvas deselects.
- **Space** N then **⇿** or **⇕** puts an exact gap between the selected objects; **=W** and **=H** match the first one selected. Place the two outer objects first, then **←→** spreads the rest evenly between them.
- **Props › Clip ◯ ⬭ ▢** clips a picture to a circle, ellipse or rounded rectangle (radius beside ▢). A clip set in the grid survives **⇱ Pop out to free layout**.
- **⬇ Behind** puts a box behind the panels; choosing a fill colour ticks Fill; **Corner R** rounds a rectangle.
- Double-click a text mark to edit it. Overlapping objects can be picked by name in the **Elements** list.
- **Connectors**: select two objects and click **⇢** ("Connect the two selected objects") on the small toolbar that floats by the selection, or press ⌘K and type `Connect two objects`. The toast reads "Connected — the line follows both objects as they move", and it does when you move either one ([Freeform](freeform.md)).
- **Replace a picture in place**: right-click it › **⇄ Replace image…**. It keeps its place, width, crop, letter and caption note; a file of another shape keeps the width and takes the height it needs, and the toast says so ([Freeform](freeform.md)).
- **Versions**: **Export › Session library › ＋ Save current to library** under a name (`Fig2 v1`, `Fig2 v2`); **Open** brings one back, and one <kbd>Ctrl/⌘+Z</kbd> returns to the figure you had ([Freeform](freeform.md)).

## Legend key

- **Export › Place the key on the figure** puts the key in free space: a margin, an empty cell or a free corner, never over a panel, letter or heading. With no room, a margin grows and a toast says by how much.
- <kbd>⌘K</kbd> `legend key` › <kbd>Enter</kbd> places it too.
- The **Where** menu beside it picks the place: **Free space**, a corner, **Right edge** or **Below**. Choosing a place there also ticks **Place the key on the figure**.
- A margin grown for the key is given back when the key needs less room: when it moves and when you widen the figure. In the test, a key placed at 55 mm grew the bottom margin from 37 to 61 px; widening back to 177.8 mm gave it back ("The legend key needs less room now, so the bottom margin went back from 61 to 37 px."), exactly the margin a key placed at 177.8 mm takes. A saved session reopens exactly as it was saved, margins and size included.
- After placing the key, untick each chart's **legend** in its Chart dialog, so the colours are explained once ([Charts](charts.md)).
- In freeform, a placed key moves out of the way of objects moved into its place, and the canvas grows for it ([Freeform](freeform.md) §11).
- Drag the key with **↖ Select** to put it somewhere yourself; it stays there through later changes. If it covers something, the compliance row **Legend key on the figure** warns and **Move to free space** fixes it ([Journal submission](journal-submission.md)).

## Caption, Methods and alt text

- Untouched text follows the figure. Text you edited is kept; if the figure changes, a line under the box offers **✦ Regenerate** (Methods: **✎ Rewrite**, alt text: **✦ Redraft**), which replaces your edits, or **Keep mine**.
- **✦ Generate Caption** and **✎ Write Methods paragraph** ask before writing over your edits ("Replace your caption?", "Replace your Methods paragraph?"): **Replace** or **Keep mine** ([Journal submission](journal-submission.md)).
- **A sentence that should survive ✦ Regenerate** (assay, n, statistics) goes in a caption note: a panel's ⚙ › **Caption note (not rendered)**, a chart's **Caption note** in its Chart dialog, or a freeform picture's **Caption note** in the Props bar. In the test, "Mean ± SD of three biological replicates; Welch t-test." typed as a chart's Caption note was still there after ✦ Regenerate; the same kind of sentence typed at the end of the caption was gone. For the same reason, fix a typo where the words come from (the caption note, the panel's name, a chart's **shown as**), not in the caption box.

## Charts and blots

- **A sample keeps its colour and its brackets by name.** Moving a group with ↑ ↓ or adding chart panels never recolours it, and a significance bracket stays on the two groups you picked (in the test, WT – dfliC stayed WT – dfliC after dfliC + pfilC was moved to the front). **shown as** renames it in every chart at once (the toast names the other panels), and **Look › Sample colours** lists it as `ΔfliC (dfliC)` ([Charts](charts.md)).
- **Source data read back in.** Each `source-data/<letter>.csv` in the submission package can be dropped on the figure again; it charts the same values ([Charts](charts.md)).
- **Band to chart.** In **⫼ Lanes & bands**, the **Band to chart** menu beside **📊 Chart these values** sets which band is charted (by default the largest band in the reference lane). Every lane is measured there; a lane without that band is "n.d." ([Western blot](western-blot.md)).
- **Replicate lanes.** Give them one name, either the same **shown as** in the Chart dialog or a lane-table row of names (`WT, WT, WT, R42P, R42P, R42P`) before you chart. They chart as one bar with mean ± SD, n and the points, and the chart stays linked. Typing numbers into the chart unlinks it, and the chart, caption and compliance check then say "typed by hand" ([Western blot](western-blot.md)).
- **Two text columns** (antibiotic × strain) are guessed as a **Grouped bar** with the second column as **Series** ([Charts](charts.md)).
- **Several CSVs at once** each become a chart; the dialog opens on the last one only, so double-click the others to check their guess ([Charts](charts.md)).
- **Plate-reader exports** go in as the reader wrote them, at any run length: time as h:mm:ss (or h:mm under a `Time` header) is read as time, in minutes or hours by the run's length, the temperature column is left out, and the Chart dialog's **Plate wells** row groups wells by plate row or column and subtracts a blank row if there is one ([Phage and microbiology](phage-and-microbiology.md#a-plate-readers-export)). A Tecan or Gen5 export can keep its block of instrument settings, its wells in rows and its `Time [s]`: the line under the data box says what it did ("13 instrument lines above the table skipped (it starts at “Cycle Nr.”)", "Time [s] read as seconds, in minutes (Time (min))" for a two-hour run, "the wells ran down the rows: turned to one column per well"), and `Cycle Nr.` is not plotted.
- **Zeros on a log axis** (a plate with no colonies) stay in the mean and n and are drawn at the axis floor as open marks. The caption says so: "On the log axis, 1 mean ≤ 0 is drawn at the axis floor (10) as open marks; means and n include them." If your field reports such counts at the detection limit instead, type the limit into the data and say so in the legend.
- **Replicate columns, one row per condition** (`condition, Rep1, Rep2, Rep3`) chart as one bar per condition with mean ± SD and the points: **Average replicate columns into one series each** is ticked on import ([Charts](charts.md)). A CSV saved from Excel works as it is (a byte-order mark, Windows line ends, an empty last row).

## Scale bars

- **A bar burned into the picture.** **🔍 Auto-detect scale bar** reads it and offers **Keep the bar in the image as the scale bar — calibrate only, draw no second bar**; the caption and the journal check count it. The other choice draws FigureLab's bar in a corner clear of it ([Phage and microbiology](phage-and-microbiology.md)).
- **⚙ › Scale bar › Corner** (⌘K `scale bar corner`) moves a bar, for example off a ruler sticker on a plate photo.

## Exports keep your text

- **↓ PDF lossless** writes letters, labels, text boxes and the words of charts and gene maps as real, selectable text, in the PDF's standard fonts (Symbol for Greek letters such as Δ). The fonts are named, not embedded.
- **Export › 📊 Export editable PowerPoint (.pptx)** makes the slide the figure's printed width (183 mm for a 183 mm figure), so 8 pt text reads 8 pt in PowerPoint, and chart and gene-map words are editable text boxes ([Freeform](freeform.md)).
- **Re-export after every change.** An export made before the figure last changed no longer counts: the compliance **Export format** row reads ℹ "not checked — the figure changed after it was last exported", and its **Save as …** button opens the Save dialog in the journal's format ([Journal submission](journal-submission.md)).

## Tutorials without losing your figure

Help (**❔**) › Tutorials, or ⌘K `tutorial`. A tutorial puts your figure aside and shows its own demo. When you click **End**, FigureLab asks **Bring your own figure back?**: click **Restore my figure** and your figure returns in one step, 16-bit samples included, so levels still read in camera counts ([Fluorescence](fluorescence.md)). Saving first (<kbd>Ctrl/⌘+S</kbd>) costs nothing.

## Common pitfalls

| Pitfall | How to avoid it |
|---|---|
| Letters, tags or bar text fail **Text contrast**. | Click the row's **Auto contrast** button in the compliance report. It reads each text on the pixels under it and adds a backing chip where neither black nor white would read. |
| The compliance **Export format** row is ℹ "not checked — the figure changed after it was last exported". | The file you saved shows an earlier version. Click the row's **Save as …** button, or save in the journal's format again. |
| The figure prints taller than the journal allows. | You widened it after choosing the journal: click **Set … mm** on the **Printed height** row, or use fewer rows. |
| <kbd>Space</kbd> + drag does not pan. | A text field still has the focus. Click the empty canvas first. |
| A whole row typed into a lane table cell lands in one cell. | Separate the cells: `- + - + - +` with spaces fills a +/− row; doses and other text need commas (`10^{0}, 10^{-1}, …`). |
| Bigger figures go missing after a browser crash. | Autosave cannot hold large images. Save the session file yourself (<kbd>Ctrl/⌘+S</kbd>) and keep it. |
| A chart's tick labels run together, or its plot is squeezed flat, after a narrower printed width. | At journal type size a one-cell chart is small. Run **✓ Check journal compliance**: the **Chart room** row names the chart, and its **Give E a … cell** button spans it and adds the row the span needs ("E now spans …"; one <kbd>Ctrl/⌘+Z</kbd> undoes it). |
| One strain is listed twice in the key. | Give it one name with the chart's **shown as** box (it renames it in every chart; a chart drawn from `… mean` columns has its own box). Samples shown under one name share one colour and one key row. |
| Two scale bars on one picture. | The picture has a bar burned in. Choose **Keep the bar in the image as the scale bar** in Auto-detect, or crop the old bar off. |
| Text grows against the pictures after a narrower printed width. | Text keeps its point size, and the toast says by how much it grew. Re-run the compliance check; lane tables: **Lane tables to 7 pt** on the **Text size** row. |
| After replacing an image, the caption still describes the old one. | Replace keeps the caption note, and the toast names it. Edit it in ⚙ › **Caption note** (in freeform, the Props bar's **Caption note**). |
| After replacing a counted photo, the compliance **Measurements** row warns. | The count was made on the old photo; it is marked out of date and left out of the CSV, caption and Methods. Count the new photo, or remove the old count (× in Measure) ([Phage and microbiology](phage-and-microbiology.md)). |

More in [Troubleshooting](troubleshooting.md). Back to the [guide index](README.md).
