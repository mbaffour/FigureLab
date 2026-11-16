# Troubleshooting

Symptom → cause → fix. The first table is for habits from earlier versions: several workarounds that used to be needed are not any more, and some now do harm. The second covers problems you can still meet, and the third lists known limits. Each "new way" was checked on this build by the verify script named beside it (in [`verify/`](verify/README.md)).

## If you learned FigureLab on an older version

| You used to… | Because… | Now |
|---|---|---|
| Build charts in a second tab, save as SVG and import the picture | A chart switched the whole figure to freeform | Drop the CSV into the grid: it becomes the next lettered chart panel, with the same Chart dialog (double-click it). → [Charts](charts.md) · `charts` |
| Pop out to freeform *before* importing a chart or gene map | Charts and gene maps existed only in freeform | They are grid panels; stay in the grid unless the layout itself is not a grid. → [Phage](phage-and-microbiology.md) · `phage-and-microbiology` |
| Type densitometry numbers into a chart by hand | No link from the analysis to a chart | **⫼ Lanes & bands › 📊 Chart these values** adds a linked chart panel that updates when the blot is re-analysed. Each blot is charted at one band (**Band to chart**); lanes without it are n.d.; blots without the same normalisation are left out and named. → [Western blot](western-blot.md) · `western-blot` |
| Use Beeswarm to get a log axis; compute means in Excel for line charts | Bar ignored log Y; Line drew no error bars and did not average | **log Y** works on Bar and Grouped bar; rows that share a group (or an x on a line chart) are averaged, and Bar and Line draw SD or SEM. Replicate columns average with "Average replicate columns into one series each". → `charts` |
| Shorten p-values to 6 characters | The bracket label was capped | Up to 40 characters, e.g. `p = 0.0008 (Welch)`. → `charts` |
| Edit `paper_style.json` by hand to change one strain's colour | No colour editor | Chart dialog › **Names & colours**, or **Look › Sample colours**. → `charts` |
| Fix decimal commas and units rows in Excel first | Semicolon files did not import | Semicolon files with decimal commas import as numbers; a units row under the header goes into the axis titles. A tidy German file (`Stamm;Replikat;…`) is guessed as one bar per strain. → `charts` |
| Rearrange a wide (Prism column) table before importing | It was guessed as a Scatter of one group against another | One column per group is guessed as a Bar chart with **Data layout › Columns**, every group ticked. → `charts` |
| Untick the scale bar on every blot and chart panel | Scale bars were on everywhere, so compliance failed "not calibrated" | Bars start only on calibrated panels. For the rest: compliance › **No scale bar on these**, or ⌘K `scale bar off`. → `journal-submission` |
| Work out an 8-bit White pt from the 16-bit range, press arrow keys on the slider | Levels were in 8-bit display values | Type **Black pt** / **White pt** in the file's own counts, then **≡ Sync by channel**. → [Fluorescence](fluorescence.md) · `fluorescence` |
| Avoid **≡ Sync by channel** for 16-bit files | It copied 8-bit numbers | It copies the range in counts. → `fluorescence` |
| Recolour a channel that came in as GFP because the cell line said "GFP" | Auto-channels read any "GFP" in the name | It reads the channel at the end of a split-channel name (`…_CellMask.tif`). Click the channel chip to rename. → `fluorescence` |
| Turn 📌 Panel mode off before making an inset | The inset was of the wrong (or a hidden) panel | Click the panel, then **⧉ Add linked inset…**: it is of that panel and lands right after it. Change it with **⧉ Edit inset region…**. → `fluorescence` |
| Click the bar ends at 6 image pixels per screen pixel; skip Auto-detect | Auto-detect failed and offered µm only | **🔍 Auto-detect scale bar** finds a standard burned-in bar and offers nm, µm or mm. In **🔬 Calibrate from image** the clicks snap to the bar ends, **1:1** and **2:1** zoom in for ruler ticks, or type **Pixel distance**. → [Phage](phage-and-microbiology.md) · `phage-and-microbiology` |
| Invert a plate and count inside a square | Count found only light objects in a rectangle | **Measure › 🔢 Count** with **dark objects (plaques)** and **round (a dish)**: in the test it found 45 of 45 and 30 of 30. → `phage-and-microbiology` |
| Type the same µm/px into each plate photo | No way to copy a calibration | Tick the rows › ⚙ › **⇉ Same µm/px on ticked panels**. → `phage-and-microbiology` |
| Export ruler lengths *before* any layout change, then clear them | Rulers kept figure coordinates | Rulers, MW labels, lane numbers, arrows and text pinned to a panel follow it. → [Tips](tips-and-tricks.md) · `tips` |
| Place MW labels last, after the lane table; clear all annotations to redo them | Labels did not move when the lane table resized the row | Marks follow their panel. **↕ Place MW labels…** again replaces the set; **✕ Remove MW labels** removes it. → `western-blot` |
| Save densitometry CSVs from each dialog for the package | They were not in the package | The package carries each analysed blot's densitometry as `source-data/…-densitometry.csv`. → `western-blot` |
| Open **Export › 📂 Load** because the welcome card did nothing | The welcome card's **Load a session** opened the wrong importer | **📂 Load a session** on the welcome card opens a saved session. → [Journal submission](journal-submission.md) · `journal-submission` |
| Press Ctrl+Z many times after a tutorial | The tutorial replaced your figure | Click **End**, then **Restore my figure** in "Bring your own figure back?". → `tips` |
| Search single nouns in ⌘K | Phrases like "add arrow" found nothing | Plain phrases work: `add arrow`, `remove white border`, `change font`, `span`, `copy style`. → `tips` |
| Avoid ⌘K "Trim borders on all panels" | It cropped photos and blots without asking | **Trim borders…** previews each panel; blots and dark fluorescence fields start unticked. → `tips` |
| Convert letter sizes to px by hand (8 pt × width ÷ …) | Presets and fields were in px | Sizes are in points at the printed width: **Look › Typography › Text size**, and pt boxes beside the px. → `tips`, `journal-submission` |
| Accept chart text at ~4.5 pt in system-ui | Chart text ignored the figure font | Charts, gene maps, scale-bar text and the key use **Look › Typography** font and pt size. → `charts` |
| Nudge freeform objects with arrow keys to line them up | No position fields; Shift-click did not multi-select | Type X, Y, W, H, ∠ in the bar above the canvas; Shift/⌘-click or drag a box to select several; **Space** N for exact gaps. → [Freeform](freeform.md) · `freeform` |
| Re-enter scale bars after **⇱ Pop out to free layout**; pop out before adding charts | Pop out dropped bars and deleted freeform objects | Pop out keeps what is on the canvas, each panel's scale bar, clip and crop, and names anything it cannot draw before it starts. One undo reverts it. → `freeform` |
| Untick Background to pass **Text contrast** | The report's **Auto contrast** button did nothing while Background was ticked | Click the row's **Auto contrast** button: it darkens the chips and picks black or white text. → `quickstart`, `journal-submission` |
| Widen a margin and re-tick the key so it leaves panel A | The placed key went to a corner, over a letter | The key goes into free space and grows a margin if it must; **Export › Legend key › Where** picks a place. → `journal-submission`, `fluorescence` |
| Narrow the printed width by hand after a preset | A preset kept 183 mm although the figure then printed too tall | A preset picks the widest width that fits the journal's height ("89 mm wide — the widest that keeps it within 170 mm tall"). → `quickstart`, `journal-submission` |
| Type W and H before X and Y in Batch crop; retype X on every scan | A Y that did not fit was reset to 0; each scan opened with a new box | Type the box in any order; the next scan opens with the same box. → `western-blot` |
| Reopen **⫼ Lanes & bands** to update a linked chart after a re-crop | **↻ Update from densitometry** could not re-analyse | **↻ Update from densitometry** re-analyses the new scan and updates the chart. → `western-blot` |
| Copy edits out before **✦ Generate Caption** | It replaced an edited caption without asking | It asks "Replace your caption?" (**Replace** / **Keep mine**); the same for **✎ Write Methods paragraph**. → `journal-submission` |
| Edit "0–255 display scale" ranges out of the caption and Methods | Merged panels were described on the 8-bit scale | Caption and Methods give 16-bit ranges in the files' own values, grouped by channel. → `fluorescence` |
| Click − after **⊡ Fit** in freeform; give a TextBox a white fill | Fit cut off the canvas bottom; unticking Fill did nothing | **⊡ Fit** shows the whole canvas; unticking **Fill** removes a TextBox's box. → `freeform` |
| Write "phi" instead of φ for selectable PDF text | Greek letters stayed in the picture | Greek letters such as Δ and φ are real text in the PDF's standard Symbol font. → `freeform` |

## Problems you can still meet

| Symptom | Cause | Fix |
|---|---|---|
| **Text contrast** still warns after **Auto contrast**, on text without a chip over a mid-grey picture (a TEM's scale-bar text) | Neither black nor white reaches 4.5:1 over mid-grey | Darken the panel's display slightly (⚙ › **Black pt**). → `phage-and-microbiology` |
| A margin stays wide after you move the placed key | A margin grown to make room for the key keeps its width when the key moves to another place | Set it back under **Arrange › Margins**; on a wide figure, choose **Where › Below** before ticking **Place the key on the figure**. → `phage-and-microbiology` |
| Dilution labels read "…" after a journal preset | The preset scales lane tables to the journal's type size, and the labels no longer fit a one-cell panel | Give the spot-assay panel **Col span** 2. → `phage-and-microbiology` |
| One strain is listed twice in the key | Two charts show it under different names, or the files spell it differently (`dfliC`, `ΔfliC`) | Give it one name with **shown as** (it renames it in every chart), and spell it the same way in every file. → `charts` |
| A second chart appeared when you charted a blot again | 📊 **Chart these values** in a blot that is not yet in the linked chart adds a new chart | <kbd>Ctrl/⌘+Z</kbd>, then click **📊 Chart these values** in a blot that is already in the chart. → `western-blot` |
| A chart's tick labels run together in one grid cell | At journal type size a one-cell chart is small | Span it over two columns (⌘K `span`). → `phage-and-microbiology` |
| A dilution row typed into one lane table cell stays in that cell | Cells other than +/− need commas | Type `10^{0}, 10^{-1}, …` with commas. → `phage-and-microbiology` |
| A caption note does not show in the caption | The untouched caption updates on the next render | Press **⟳ Render** (<kbd>R</kbd>). → `journal-submission` |
| The Y title of a densitometry chart is cut off | The default title is longer than a small chart panel | Type a short **Y title** in the Chart dialog. → `western-blot` |
| <kbd>Space</kbd>+drag does not pan | A text field has the focus | Click the empty canvas first. → `tips` |
| Arrow keys do nothing after clicking a panel | A click does not give the figure the keyboard | Tab to the figure (right after the toolbar), then use the arrows. → `tips` |

## Known limits

- **16-bit images**: import decodes each file from 0 to its own maximum, and says so. Session files that keep native samples are larger (about 2.7 bytes per sample more) and reopen with them at once. Autosave does not keep native samples: after a crash, the recovery bar names the 16-bit panels; save the session file yourself, or bring each file back with **⇄ Replace image…**. A split channel keeps the native samples.
- **Charts**: there is no "show n" label on the chart (n is in the source data), and no axis break. Significance brackets are stored by category position, so reordering categories changes the pair. A chart imported as an SVG picture cannot be keyed.
- **Grid**: there is no "hide row" action. Per-panel files and provenance and the docking of the welcome card were not changed in this round.
- **Freeform**: PDF text uses the standard fonts by name and does not embed them; Greek letters and signs such as Δ, φ, −, ≥ use the standard Symbol font, and only characters none of them has (✓, CJK, emoji) or text on a turned object stays in the picture. The PowerPoint slide is the figure's printed size, and chart and gene-map words, letters included, are editable text boxes. The layered SVG places a picture up to 0.7 px off its box (the PNG, TIFF and PDF are exact). Some edge handles are clipped at the canvas edge.
- **Reuse checks** compare only what you give them: they do not search published papers or detect AI-generated images. See [Journal submission](journal-submission.md).
- **Legend key**: when there is no free space, a margin grows to make room; it does not shrink back when the key moves elsewhere.

Open problems found while writing these guides, with severities and suggestions, are in [`verify/ISSUES.md`](verify/ISSUES.md). Back to the [guide index](README.md).
