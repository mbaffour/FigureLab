# Phage and microbiology figures

## What you'll make

A one-grid figure for an ASM journal: a calibrated TEM of the virion with head and tail measured, two plaque plates at the same magnification with their plaques counted, a spot assay with a dilution row over it, lysis curves from a replicate CSV, and a gene map read from a GenBank file.

![A six-panel phage figure: TEM, two plates, spot assay, lysis curves, gene map](img/phage-figure.png)

## You need

- A TEM micrograph with the microscope's info strip and scale bar burned in (TIFF, 8- or 16-bit).
- Plate photos with a ruler or a dish of known size in the frame (JPEG is fine).
- A spot-assay photo.
- Growth or lysis data as a CSV: a time column and one column per replicate (`MOI_0_rep1`, `MOI_0_rep2` …), or tidy rows.
- A GenBank (`.gb`) or FASTA file of the region you want to draw.

Everything here stays a grid panel: charts and gene maps get letters, spans, the legend key and undo like the pictures. You do not need freeform for this figure.

## 1. Add the pictures

1. Images › **Drop or click to add images** and pick the TEM, the plate photos and the spot assay. They fill the grid as A, B, C, D.
2. Panels with no calibration start with their scale bar off. You switch each one on by calibrating it (below).

## 2. Calibrate the TEM from its burned-in bar

1. Open panel A's ⚙ (in its row in the image list).
2. Try **🔍 Auto-detect scale bar** first. If it finds the bar, pick its length (nm, µm or mm) in the dialog that opens.
3. If it says *No scale bar found in the bottom third of the image*, click **🔬 Calibrate from image**.
4. In the Scale Calibration dialog, click near the left end of the bar, then near the right end. The clicks snap to the bar's real ends: the dialog reads *Distance: 400.0 px (original image) — snapped to the ends of the bar*.
5. Type the bar's length in **Known length** (200), set the unit to **nm**, and click **Apply**. The toast reads *Scale set: 0.5 nm/px (400.0 px = 200 nm)*, and a bar is switched on at a round length that fits the field (100 nm here).
6. To use another length, type it in ⚙ › Scale bar › **Bar length** and pick the unit beside it, or click **Auto**.

![The calibration dialog after the clicks snapped to the bar ends](img/phage-calibrate.png)

If you know the bar's length in pixels, type it in **Pixel distance** instead of clicking.

## 3. Crop off the info strip

1. In panel A's ⚙, under **Clip shape**, the four boxes **T**, **L**, **B**, **R** are the percent cut from each side.
2. Type the strip's height as a percent of the image height in **B** (a 70-px strip on a 1024-px image: **7**), and press **⟳ Render** (or **R**).

The calibration and the bar stay: they are in source pixels, not in the crop.

## 4. Measure head and tail

1. Give the micrograph room so you can click precisely: ⚙ › **Panel span (grid mode)** › **Col span** 2, **Row span** 2. Another panel may drop out of the grid until you put the span back; that is expected.
2. Measure › **⊢ Ruler**. Drag across each capsid (flat side to flat side) and along each tail (from the capsid to the baseplate).
3. In the **Rulers** table under Measure, type a name in each row: `capsid`, `tail`. Below the table you get one line per name, for example *capsid · panel A: n = 3, 70.1 ± 0.4 nm (mean ± SD)*.
4. Click **⬇ Ruler lengths CSV**. It has one row per ruler with its name, length, the source-pixel ends and where the calibration came from.
5. To take the rulers off the figure: Annotate & Draw › **✕ Clear** › **Confirm** (this removes every annotation), or click × on single rows in the Annotations list. Set the span back to 1 × 1.

On the test micrograph (0.5 nm/px) three capsids read 70.1 ± 0.4 nm against a true 70 nm, and three tails 99.5 ± 0.6 nm against 99.3 nm. A ruler end is only as fine as one figure pixel, which is why you enlarge the panel first (the CSV states the source px per figure px).

## 5. Plaque plates at the same magnification

1. Plate B's ⚙ › **🔬 Calibrate from image**. Click the 0 and the 10 mm marks of the ruler in the photo (or type the distance in **Pixel distance**), type **10** in Known length, pick **mm**, **Apply**. A 10 mm bar is switched on.
2. Tick the checkboxes of rows B and C (left of each row), then in B's ⚙ click **⇉ Same µm/px on ticked panels**. The toast reads *45.45 µm/px from B → C (10 mm bar)*. Use this only for photos taken with the same camera set-up.
3. Untick the rows.

## 6. Count plaques in the dish

1. Measure › **🔢 Count**.
2. Set the menu to **dark objects (plaques)** and tick **round (a dish)**.
3. Drag a box around the dish on the canvas, from one side of the rim to the other. The count is made inside the ellipse that box draws.
4. Read the result under the tools: *Objects detected*, the equivalent diameter (mean ± SD, in the panel's units) and the foreground area. Each counted object is marked on the panel so you can check it.
5. **⬇ Export Measurements CSV** saves the result. Click **🔢 Count** again to turn the tool off.

![Count result beside the plate it counted](img/phage-count.png)

On test plates with 45 and 30 plaques, Count found 45 and 30. It is a single intensity threshold: touching plaques count as one, so move **Threshold** and count again if the marks show merged plaques.

## 7. Spot assay with a dilution row

1. Crop the spot assay so the spot columns fill the panel evenly: panel D's ⚙ › **Clip shape** T, L, B, R (here 10, 5.6, 10, 5.6). The dilution labels are spaced evenly across the panel, so this is what puts each one over its column.
2. Click panel D on the canvas, press **⌘K** (Ctrl+K), type `lane table`, press **Enter**. The dialog title reads *Lane table — panel D*.
3. Set **Lanes** to the number of dilutions (8). Type the row name (`Dilution`) in the first box of the row.
4. Click the first cell and type the whole row separated by **commas**: `10^{0}, 10^{-1}, 10^{-2}, 10^{-3}, 10^{-4}, 10^{-5}, 10^{-6}, 10^{-7}`, then press **Enter**. It fills across. `^{…}` is a superscript.
5. Check the preview at the top of the dialog: each label should sit over its column. Close the dialog with ×.

Separate the cells with commas or tabs (cells copied from a spreadsheet work too). Spaces split a row only when every cell is a + or −.

## 8. Lysis or growth curves from a CSV

1. Images › **Drop or click to add images** and pick the CSV. The **📊 Chart** dialog opens and a chart panel is added to the grid (*Imported 9 rows from lysis_OD600.csv — chart panel E in the grid*).
2. With replicate columns (`MOI_0_rep1`, `MOI_0_rep2`, `MOI_0_rep3` …), check that **Average replicate columns into one series each** is ticked (it says how many it found per series) and that **Error bars** reads **SD (n−1)** or **SEM (SD/√n)**. A time column gives **Line** as the chart type.
3. Type **X title** (`Time (min)`) and **Y title** (`OD_{600}`; `_{…}` is a subscript). Tick **points**.
4. Under **Names & colours**, type a display name for each series in its *shown as* box (`Uninfected`, `MOI 1`). The data keep their column names; the chart, legend and key show yours.
5. Click **Apply**.

To edit the chart later: its ⚙ › **📊 Edit chart data and style…**. For everything else charts can do (tidy data, log axes, axis limits, brackets, sample colours), see [charts.md](charts.md).

## 9. Gene map from GenBank

1. Annotate & Draw › **🧬 Linear**. A gene map panel is added straight away with a sample construct, and the **Gene map** dialog opens.
2. Click **📄 GenBank / FASTA…** and pick your file. The feature table, length and title fill in; the line under the import button reads, for example, *10.8 kb · 12 features*.
3. Edit **Title** if you like (`*Escherichia* phage phiGuide, late region`; `*…*` is italic) and click **Apply**. The dialog stays open so you can keep editing; close it with ×.
4. To change it later: its ⚙ › **🧬 Edit gene map…**.

The map shows only what the file declares (the LOCUS length and the FEATURES table); nothing is inferred.

## 10. One grid for pictures, chart and map

1. Give the chart and the gene map more width: each one's ⚙ › **Panel span (grid mode)** › **Col span** 2.
2. Arrange › **⊞ Fit grid to panels**. With four pictures, a chart and a map at span 2, it gives 4 × 2: the pictures in the top row, the chart and the map below.

## 11. Journal, check, export

1. **⌘K** › type `asm` › **Enter** on *Journal: ASM (mBio, J Bacteriol, J Virol…)*: 177.8 mm wide, Arial, type sizes in points.
2. Check › **✓ Check journal compliance**. See [journal-submission.md](journal-submission.md) for what each row means.
3. If **Text contrast** fails on white letters over a chart or gene map, untick Look › Panel Labels › **Background**; Auto contrast switches on and those letters turn black.
4. If it still names a mid-grey micrograph (TEM backgrounds often are), Auto contrast kept white text there. Darken the panel's display slightly: its ⚙ › **Black pt** (for the test TEM, 10000 in the file's own counts). Export › **✎ Write Methods paragraph** then states it (*display ranges in native values: 10000–62000 (panel A)*), along with where each calibration came from (*copied from panel B* for plate C). Check again; the test figure then passed 19/19.
5. Export › **File name**, then **↓ TIFF** › **Save TIFF** (ASM asks for TIFF). The test figure saved as 2100 × 1074 px at 300 dpi, 177.8 mm wide.
6. **↓ SVG** › **Save SVG** gives a layered file in which the chart, the gene map, the dilution row and the scale-bar labels are real text.
7. Export › Legend key › **⬇ Download key** saves the key for the curves and the gene-map glyphs; the legend text starter under the caption helper reads *Uninfected (black, solid line with filled circles); MOI 1 (orange, …); Promoter (green, bent arrow); CDS / gene (blue, arrow); …*.

## Tips

- **⌘K** finds the measuring tools by plain words: `ruler`, `count`, `plaque`, `lane table`, `calibrate`.
- Calibrate before you measure: rulers and Count read the panel's µm/px when you draw them.
- Name rulers as you go; the per-name mean ± SD updates at once and goes into the CSV.
- Rulers drawn on a panel stay on what they measure when you change the panel's span.
- `^{…}` superscript, `_{…}` subscript and `*…*` italic work in chart titles, the lane table, gene-map titles and headings.
- A chart in a single grid cell at journal type size can run its tick labels together; give it a column span of 2.
- Save your work with **Ctrl+S** (a session file with the images inside). More in [tips-and-tricks.md](tips-and-tricks.md).

## If something looks wrong

- **No scale bar on a panel.** Panels without calibration start with the bar off. Calibrate them (step 2 or 5); for a chart or a gene map there is nothing to do.
- **Auto-detect says "No scale bar found".** Use 🔬 Calibrate from image; the clicks snap to the bar ends.
- **The TEM bar is too short or too long.** Type your own **Bar length** and unit in ⚙ › Scale bar, or click **Auto**.
- **Count merged two plaques or picked up the rim.** Move **Threshold** and drag again; draw the box just inside the rim.
- **Dilution labels are not over their spots.** Crop the panel so the spot columns fill it evenly (step 7.1) and check the preview in the lane table dialog.
- **The whole dilution row went into one cell.** Separate the cells with commas, not spaces.
- **A gene map you did not want is in the grid.** 🧬 Linear adds a panel as soon as you click it, and Cancel keeps it; remove it with × in its image-list row.
- More in [troubleshooting.md](troubleshooting.md).

*Every step above was followed on this build by [verify/phage-and-microbiology.verify.js](verify/phage-and-microbiology.verify.js) on synthetic inputs (a 0.5 nm/px TEM with a 200 nm bar, plates with 45 and 30 plaques, a 4 × 8 spot assay, a triplicate lysis CSV, a 10.8 kb GenBank file).*
