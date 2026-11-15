# Troubleshooting

Symptom → cause → fix. The first table is for habits from earlier versions: several workarounds that used to be needed are not any more, and some now do harm. The second covers problems you can still meet, and the third lists known limits. Each "new way" was checked on this build by the verify script named beside it (in [`verify/`](verify/README.md)).

## If you learned FigureLab on an older version

| You used to… | Because… | Now |
|---|---|---|
| Build charts in a second tab, save as SVG and import the picture | A chart switched the whole figure to freeform | Drop the CSV into the grid: it becomes the next lettered chart panel, with the same Chart dialog (double-click it). → [Charts](charts.md) · `charts` |
| Pop out to freeform *before* importing a chart or gene map | Charts and gene maps existed only in freeform | They are grid panels; stay in the grid unless the layout itself is not a grid. → [Phage](phage-and-microbiology.md) · `phage-and-microbiology` |
| Type densitometry numbers into a chart by hand | No link from the analysis to a chart | **⫼ Lanes & bands › 📊 Chart these values** adds a linked chart panel that updates when the blot is re-analysed. → [Western blot](western-blot.md) · `western-blot` |
| Use Beeswarm to get a log axis; compute means in Excel for line charts | Bar ignored log Y; Line drew no error bars and did not average | **log Y** works on Bar and Grouped bar; rows that share a group (or an x on a line chart) are averaged, and Bar and Line draw SD or SEM. Replicate columns average with "Average replicate columns into one series each". → `charts` |
| Shorten p-values to 6 characters | The bracket label was capped | Up to 40 characters, e.g. `p = 0.0008 (Welch)`. → `charts` |
| Edit `paper_style.json` by hand to change one strain's colour | No colour editor | Chart dialog › **Names & colours**, or **Look › Sample colours**. → `charts` |
| Fix decimal commas and units rows in Excel first | Semicolon files did not import | Semicolon files with decimal commas import as numbers; a units row under the header goes into the axis titles. → `charts` |
| Untick the scale bar on every blot and chart panel | Scale bars were on everywhere, so compliance failed "not calibrated" | Bars start only on calibrated panels. For the rest: compliance › **No scale bar on these**, or ⌘K `scale bar off`. → `journal-submission` |
| Work out an 8-bit White pt from the 16-bit range, press arrow keys on the slider | Levels were in 8-bit display values | Type **Black pt** / **White pt** in the file's own counts, then **≡ Sync by channel**. → [Fluorescence](fluorescence.md) · `fluorescence` |
| Avoid **≡ Sync by channel** for 16-bit files | It copied 8-bit numbers | It copies the range in counts. → `fluorescence` |
| Recolour a channel that came in as GFP because the cell line said "GFP" | Auto-channels read any "GFP" in the name | It reads the channel at the end of a split-channel name (`…_CellMask.tif`). Click the channel chip to rename. → `fluorescence` |
| Turn 📌 Panel mode off before making an inset | The inset was of the wrong (or a hidden) panel | Click the panel, then **⧉ Add linked inset…**: it is of that panel and lands right after it. Change it with **⧉ Edit inset region…**. → `fluorescence` |
| Click the bar ends at 6 image pixels per screen pixel; skip Auto-detect | Auto-detect failed and offered µm only | Clicks in **🔬 Calibrate from image** snap to the bar ends, or type **Pixel distance**; units include nm and mm. **🔍 Auto-detect scale bar** may still miss a bar (below). → [Phage](phage-and-microbiology.md) · `phage-and-microbiology` |
| Invert a plate and count inside a square | Count found only light objects in a rectangle | **Measure › 🔢 Count** with **dark objects (plaques)** and **round (a dish)**: in the test it found 45 of 45 and 30 of 30. → `phage-and-microbiology` |
| Type the same µm/px into each plate photo | No way to copy a calibration | Tick the rows › ⚙ › **⇉ Same µm/px on ticked panels**. → `phage-and-microbiology` |
| Export ruler lengths *before* any layout change, then clear them | Rulers kept figure coordinates | Rulers, MW labels, lane numbers, arrows and text pinned to a panel follow it. → [Tips](tips-and-tricks.md) · `tips` |
| Place MW labels last, after the lane table; clear all annotations to redo them | Labels did not move when the lane table resized the row | Marks follow their panel. **↕ Place MW labels…** again replaces the set; **✕ Remove MW labels** removes it. → `western-blot` |
| Save densitometry CSVs from each dialog for the package | They were not in the package | The package carries each analysed blot's densitometry as `source-data/…-densitometry.csv`. → `western-blot` |
| Open **Export › 📂 Load** because the welcome card did nothing | The welcome card's **Load a session** opened the wrong importer | **📂 Load a session** on the welcome card opens a saved session. → [Journal submission](journal-submission.md) · `journal-submission` |
| Press Ctrl+Z many times after a tutorial | The tutorial replaced your figure | Click **End**, then **Confirm** in "Bring your own figure back?". → `tips` |
| Search single nouns in ⌘K | Phrases like "add arrow" found nothing | Plain phrases work: `add arrow`, `remove white border`, `change font`, `span`, `copy style`. → `tips` |
| Avoid ⌘K "Trim borders on all panels" | It cropped photos and blots without asking | **Trim borders…** previews each panel; blots start unticked. Check fluorescence panels (below). → `tips` |
| Convert letter sizes to px by hand (8 pt × width ÷ …) | Presets and fields were in px | Sizes are in points at the printed width: **Look › Typography › Text size**, and pt boxes beside the px. → `tips`, `journal-submission` |
| Accept chart text at ~4.5 pt in system-ui | Chart text ignored the figure font | Charts, gene maps, scale-bar text and the key use **Look › Typography** font and pt size. → `charts` |
| Nudge freeform objects with arrow keys to line them up | No position fields; Shift-click did not multi-select | Type X, Y, W, H, ∠ in the bar above the canvas; Shift/⌘-click or drag a box to select several; **Space** N for exact gaps. → [Freeform](freeform.md) · `freeform` |
| Re-enter scale bars after **⇱ Pop out to free layout**; pop out before adding charts | Pop out dropped bars and deleted freeform objects | Pop out keeps what is on the canvas, each panel's scale bar, clip and crop, and names anything it cannot draw before it starts. One undo reverts it. → `freeform` |

## Problems you can still meet

| Symptom | Cause | Fix |
|---|---|---|
| **Text contrast** fails; the report's **Auto contrast** button changes nothing | Look › Panel Labels (A, B, C…) › **Background** (a translucent dark chip) is ticked, and a white letter on it over a white panel measures about 3.4:1 | Untick **Background**. Auto contrast switches on and each letter turns black or white. → `quickstart` |
| **Text contrast** still fails on a mid-grey picture (TEM, phase contrast) | Auto contrast picks white over mid-grey (white on #8a8a8a is 3.45:1; black would pass) | Darken the panel's display slightly (⚙ › **Black pt**), or move the letter to a darker corner. → `phage-and-microbiology` |
| **Printed height** fails after choosing a journal | The preset sets the widest width; with several rows the figure is then too tall | Pick a narrower **Export › Printed width** or use fewer rows. → `quickstart`, `journal-submission` |
| **Export format** fails although you exported | The row checks the format you saved last | Save in the journal's format, then re-check. → `quickstart` |
| **Trim borders** offers to cut most of a fluorescence image | A black background reads as a margin; fluorescence panels start ticked | Untick them before **Trim ticked panels**. → `tips` |
| **🔍 Auto-detect scale bar** says "No scale bar found" on a clean bar | Detection misses some bars (seen on a 1024-px TEM with a 400-px bar) | Use **🔬 Calibrate from image**: the clicks snap to the bar ends. → `phage-and-microbiology` |
| The chart's **↻ Update from densitometry** says "Cannot update: … the crop changed" | It cannot re-analyse a re-cropped or replaced blot itself | Click the blot and reopen **⫼ Lanes & bands**; the chart follows. → `western-blot` |
| In Batch crop the box jumps to the top when you type Y | A Y that does not fit the current height is reset | Type **W** and **H** first, then **X** and **Y**. → `western-blot` |
| **≡ Same bar on all calibrated** ignores the length you just typed | It copies from the panel selected on the canvas | Click the panel on the canvas first. → `fluorescence` |
| The placed legend key covers a panel letter | It goes to the emptiest corner; with no free corner it overlaps least | Widen **Arrange › Margins › Right**, then untick and tick **Place the key on the figure**. → `fluorescence`, `journal-submission` |
| A colour set for a strain does not reach another chart, or the key lists a strain twice | The two charts use different names (`MOI_0`, `MOI 0`, `MOI 0 mean`) | Give the sample one name in every chart (**shown as**, or the data's header). → `charts` |
| A wide table opens as a Scatter plot | All-numeric columns are guessed as x/y | Chart type › **Bar**, Data layout › **Columns — each ticked column is a group**, and tick every group column. → `charts` |
| A chart's tick labels run together in one grid cell | At journal type size a one-cell chart is small | Span it over two columns (⌘K `span`). → `phage-and-microbiology` |
| A dilution row typed into one lane table cell stays in that cell | Cells other than +/− need commas | Type `10^{0}, 10^{-1}, …` with commas. → `phage-and-microbiology` |
| ✦ Generate Caption replaced your edited caption | It regenerates without asking | Put panel details in each panel's ⚙ caption note, which survives regeneration; or edit after generating. → `journal-submission` |
| A caption note does not show in the caption | The untouched caption updates on the next render | Press **⟳ Render** (<kbd>R</kbd>). → `journal-submission` |
| 🧬 **Linear** added a sample gene map you did not want | The dialog adds a sample map at once and Cancel keeps it | Load your GenBank file in the dialog, or delete the panel. → `phage-and-microbiology` |
| In freeform, **⊡ Fit** leaves the canvas bottom under the window edge | The always-on bars take about 100 px | Click **－** once. → `freeform` |
| In freeform, unticking **Fill** on a TextBox does nothing | The box is always filled | Give it a white fill. → `freeform` |
| <kbd>Space</kbd>+drag does not pan | A text field has the focus | Click the empty canvas first. → `tips` |

## Known limits

- **16-bit images**: import decodes each file from 0 to its own maximum, and says so. Session files that keep native samples are larger (about 2.7 bytes per sample more). Autosave does not keep native samples, so save the session file yourself. A split channel keeps the native samples; Methods may still state a merged panel's range on the 0–255 display scale.
- **Charts**: there is no "show n" label on the chart (n is in the source data), and no axis break. Significance brackets are stored by category position, so reordering categories changes the pair. A chart imported as an SVG picture cannot be keyed.
- **Grid**: there is no "hide row" action. Per-panel files and provenance and the docking of the welcome card were not changed in this round.
- **Freeform**: PDF text uses standard fonts by name and does not embed them; characters those fonts cannot show (Greek, ≥) stay in the picture. The PowerPoint slide keeps its standard size, and chart and gene-map letters are part of their pictures there. Some edge handles are clipped at the canvas edge.
- **Reuse checks** compare only what you give them: they do not search published papers or detect AI-generated images. See [Journal submission](journal-submission.md).
- **Legend key**: when no corner is free, the placed key overlaps the least and can still cover something.

Open problems found while writing these guides, with severities and suggestions, are in [`verify/ISSUES.md`](verify/ISSUES.md). Back to the [guide index](README.md).
