# Issues found while verifying the user guides

Each guide in `docs/guides/` was followed step by step on this build by its script in this folder. Where a step did not work as the fixers' notes said, or was hard to find, the guide describes the way it actually works and the problem is listed here, for the next round of fixes.

Severity: **blocker** (the task cannot be done), **hard** (it can, but most people would not find the way), **annoying** (works with a workaround the guide states), **polish** (cosmetic or wording).

| Severity | Count |
|---|---|
| blocker | 0 |
| hard | 1 |
| annoying | 18 |
| polish | 25 |

Sections: [Across guides](#across-guides) · [Western blot](#western-blot) · [Fluorescence](#fluorescence) · [Phage and microbiology](#phage-and-microbiology) · [Charts](#charts) · [Journal submission](#journal-submission) · [Freeform](#freeform)

## Across guides

Found in the quick start and tips runs (`quickstart.verify.js`, `tips.verify.js`) or in more than one guide.

### The report's Auto contrast button does not fix Text contrast while label Background is ticked
- **What I tried:** quick start (three fluorescence channels and a light blot, Nature preset), Check › ✓ Check journal compliance, then the **Auto contrast** button on the Text contrast row, then re-checked.
- **What happened:** the button ticks Look › Panel Labels (A, B, C…) › Auto contrast, but with **Background** ticked (the default) the letter stays white on its translucent dark chip; over a white panel that measured 3.36–3.54:1, and the row still failed (16/20 before and after). Unticking **Background** passes it (17.5:1 lowest), because Auto contrast then chooses black on light panels. Also seen in the journal and phage runs.
- **Severity:** annoying (the fix button visibly does nothing; the guides now say to untick Background)
- **Suggestion:** have the fix also untick Background (or make the chip opaque enough to reach 4.5:1), and re-run the report after any fix button so the row updates in place.

### Auto contrast keeps white text over mid-grey pictures
- **What I tried:** a phase-contrast photo (background #8a8a8a) in the quick start, and the negative-stain TEM (≈ #7d7d7d) in the phage guide, with Background unticked and Auto contrast on.
- **What happened:** the letters (and the TEM's scale-bar text) stayed white: 3.45:1 on the phase photo and 4.23:1 on the TEM, where black would give about 6:1 and 5:1. Text contrast fails and no button fixes it. The phage guide's workaround is to darken the panel (⚙ › Black pt); the quick start now uses a blot instead of the photo.
- **Severity:** annoying
- **Suggestion:** choose the text colour with the larger WCAG contrast against the sampled pixels (the switch point is a relative luminance of about 0.18, grey ≈ 118), not at mid-grey.

### Trim borders starts dark-background fluorescence panels ticked
- **What I tried:** four panels (DAPI, GFP, a phase photo, a blot), ⌘K `trim` › **Trim borders…**.
- **What happened:** the preview is clear, and the blot starts unticked as the notes say, but the DAPI and GFP fields start **ticked**: their black background reads as a margin, and trimming would remove T 33.6 % · L 8.2 % · B 15.4 % of the DAPI field (keeps 45 %, flagged "large trim"). One click on **Trim ticked panels** would crop real image content.
- **Severity:** annoying
- **Suggestion:** start fluorescence (pseudocoloured or dark-background, 16-bit) panels unticked as blots are, or treat a black surround as a margin only when it is uniform to within noise and meets the image edge in a straight line.

### The placed legend key covers panel letter A with default margins
- **What I tried:** Export › **Place the key on the figure** on a 5 × 2 fluorescence figure and on a 2 × 2 figure, both with default margins; also after reopening the session and swapping panels.
- **What happened:** the key was placed in the top-left corner, over panel A's letter, although white space beside a panel and the margins were free. Widening **Arrange › Margins › Right** (90–110 px) and unticking and ticking the box again put it in the margin. The key also keeps a stale place after layout changes until it is re-ticked. Seen in the fluorescence and journal runs.
- **Severity:** annoying
- **Suggestion:** count panel letters, tags, scale bars and headings as occupied when choosing the corner, prefer a margin that fits, and re-place the key after layout changes and on load.

<a id="western-blot"></a>

## Western blot

From [`western-blot.verify.js`](western-blot.verify.js), for the [western blot guide](../western-blot.md).

### ↻ Update from densitometry in the Chart dialog cannot update after a re-crop or a replaced image
- **What I tried:** replaced blot A with a re-run scan (⇄ Replace image…), levelled it in the Crop Editor, then double-clicked the linked chart panel. The dialog says "⚠ Linked to the densitometry of panel A, which has changed since: panel A: the crop changed since this analysis." and offers **↻ Update from densitometry**. I clicked it.
- **What happened:** nothing changed in the dialog; a toast said "Cannot update: panel A: the crop changed since this analysis". The chart only updated (toast "1 chart updated from the re-analysed densitometry") after I reopened ⫼ Lanes & bands on panel A, which re-analyses the new pixels. The note and the button do not say this.
- **Severity:** annoying
- **Suggestion:** when the analysis itself is stale, make the button re-run the panel's analysis (with its kept ladder, reference and loading control) and then update, or label it "⫼ Re-analyse panel A" and open the dialog.

### Batch crop: typing Y before H silently moves the box to the top
- **What I tried:** in ✂ Batch Crop, typed px X 0, Y 120, W 900, H 150 in that order (Tab after each).
- **What happened:** Y came back as 0. At the time Y was typed the box was still the full image height (420), so 120 did not fit and was clamped without a word; H 150 then shrank the box at the top. Typing W and H first, then X and Y, works.
- **Severity:** annoying
- **Suggestion:** clamp only when the field is left, or apply the four fields together; at least flash the field that was changed.

### Batch crop: the status keeps saying "Draw to set crop size" after a box was typed
- **What I tried:** typed the four px fields instead of drawing.
- **What happened:** the box appears and Apply & Next works, but the panel still reads "Draw a region to continue" / "Draw to set crop size", which suggests the typed box does not count.
- **Severity:** polish
- **Suggestion:** treat a typed box like a drawn one in the status line.

### "📊 Chart these values": the default Y title does not fit a chart panel
- **What I tried:** 📊 Chart these values on a blot normalised to total protein, in a one-column grid (chart panel 300 × 222 px).
- **What happened:** the Y title "Band volume ÷ total protein, relative to lane 3" is longer than the axis; both ends are cut off and the top runs into the panel letter. Typing a shorter Y title in the Chart dialog fixes it.
- **Severity:** polish
- **Suggestion:** shrink or wrap a Y title to the plot height, or default to a short title ("÷ total protein, rel. lane 3") and put the long form in the caption note.

### "📊 Chart these values" names the bars Lane 2 … Lane 7, not by the lane table
- **What I tried:** filled a lane table (ΔphoA, IPTG rows) before charting.
- **What happened:** categories are "Lane 2" … "Lane 7"; each has to be renamed in Names & colours › shown as.
- **Severity:** polish
- **Suggestion:** when the panel has a lane table, offer its column text (e.g. "− / +") or a sample-name row as the category names.

<a id="fluorescence"></a>

## Fluorescence

From [`fluorescence.verify.js`](fluorescence.verify.js), for the [fluorescence guide](../fluorescence.md).

### ≡ Same bar on all calibrated ignores the panel whose settings you just edited
- **What I tried:** opened panel A's ⚙, typed Bar length 20 µm, closed ⚙, then Look › ≡ Same bar on all calibrated.
- **What happened:** "Scale bar 10 µm on 8 calibrated panels". Every panel got 10 µm, including A, which lost the 20 µm just typed. Only after clicking A on the canvas did the button copy A's 20 µm ("… (from A)"). The tooltip says "the selected panel's, or a clean value", but editing a panel's ⚙ does not select it.
- **Severity:** annoying
- **Suggestion:** treat the panel whose ⚙ was used last as the selected panel, or name in the toast which length was chosen and why ("no panel selected — picked 10 µm"); never overwrite a length typed seconds earlier without saying so.

### A new inset inherits a scale bar longer than its field, and draws none
- **What I tried:** set 20 µm on all panels, then ⧉ Add linked inset… with a 128 px region (13.9 µm field).
- **What happened:** the inset's ⚙ showed the bar enabled at 20 µm, and no bar was drawn. ⚙ › Auto then gave 2 µm.
- **Severity:** polish
- **Suggestion:** give an inset its own round length on creation, as Same bar on all calibrated already does for insets too small for the shared length.

### Methods gives merged panels a second, per-condition range on the 0–255 scale
- **What I tried:** matched GFP at 400–12000 counts on both conditions, merged and split each, then ✎ Write Methods paragraph.
- **What happened:** the paragraph correctly says "GFP 400–12000 (panels B, D, E, G, I and J)", then adds "In panel D the merged channels were displayed with their own linear display ranges (GFP 3.46256–103.87671 and RFP 0–251.5165, on the 0–255 display scale)" and "In panel I … (GFP 7.75902–232.77043 …)". The same 400–12000 range reads as two different ranges, the membrane channel is called "RFP", and the LUT sentence says "panel C, Magenta" rather than the channel's name (Membrane).
- **Severity:** annoying (a reviewer reading Methods would conclude the GFP ranges differ)
- **Suggestion:** for 16-bit merges state the merged channels' ranges in native counts only (or omit them when they equal the channel's stated range), and name channels by their channel name, not by LUT.

### Display ranges row lists a renamed channel under both names
- **What I tried:** renamed the magenta channel CellMask → Membrane in Export › Legend key › Channel names, then ✓ Check journal compliance.
- **What happened:** "Same range per channel across panels ✓ (DAPI, GFP, CellMask, Membrane)". The hidden source panels still carry the old name, so one channel is listed twice.
- **Severity:** polish
- **Suggestion:** apply the key-level channel name to hidden panels too, or leave hidden panels out of this row.

### After Split, new panels sit outside the grid until you change Columns/Rows
- **What I tried:** merged three channels of one condition in a 3 × 2 grid, then ⑃ Split channels into panels.
- **What happened:** the toast says the grid "was left as it is"; some of the four new panels and the other condition's panels were outside the grid until Arrange › Columns 4, Rows 2. The hidden source panels also keep letters (K–N) after 🔤 Relabel.
- **Severity:** polish
- **Suggestion:** offer "Make this a row" (set Columns to the split's width) in the split toast.

<a id="phage-and-microbiology"></a>

## Phage and microbiology

From [`phage-and-microbiology.verify.js`](phage-and-microbiology.verify.js), for the [phage and microbiology guide](../phage-and-microbiology.md).

### Auto-detect scale bar misses a clean burned-in bar on a 1024-px TEM
- **What I tried:** ⚙ › 🔍 Auto-detect scale bar on a 1024 × 1024 16-bit TEM with a 70-px black info strip and a white 400 × 9 px bar starting at x = 40 (inputs.temTiff).
- **What happened:** *No scale bar found in the bottom third of the image*. `_findBurnedBar` first scales the image to 1000 px wide; the bar's right end then falls on a partly covered pixel (193 against 239/255 on the bar). That pixel ends the run (|Δ| ≥ 30) and fails the ≥ 60 contrast test against the run's own value, so the bar is rejected. The spec's 2048-px fixture happens to land on clean edges.
- **Severity:** hard (the burned-in bar is the main TEM case; the message does point to 🔬 Calibrate from image, which works and snaps to 400.0 px).
- **Suggestion:** find runs on the full-resolution rows, or threshold each row at the midpoint between the run and the strip so anti-aliased end pixels belong to the bar; add a fixture whose bar ends fall between downsampled pixels.

### 🧬 Linear adds a sample gene map at once, and Cancel keeps it
- **What I tried:** Annotate & Draw › 🧬 Linear, then Cancel.
- **What happened:** a panel holding a sample construct (pTet, RBS, gfp, T1, ColE1 ori, ampR) is added to the grid as soon as the button is clicked, and Cancel leaves it there (7 panels before Cancel, 7 after). A chart just added from the menu is removed by Cancel, so the two dialogs disagree. Apply in the gene-map dialog also keeps the dialog open, where the chart dialog's Apply closes it.
- **Severity:** annoying.
- **Suggestion:** treat a just-added gene map like a just-added chart (Cancel removes it); either close the dialog on Apply or rename the button (e.g. "Apply (keep editing)").

### "Fit grid to panels" says "(2 empty)" when spans fill every cell
- **What I tried:** six panels, the chart and the gene map at Col span 2 (and, in another run, the map at Col span 3); Arrange › ⊞ Fit grid to panels.
- **What happened:** the grid became 4 × 2 with all eight cells covered (4 + 2 + 2), and the toast read *4 × 2 for 6 panels (2 empty)*.
- **Severity:** polish.
- **Suggestion:** count the cells a spanning panel covers in the toast as the fit already does.

### A chart in one grid cell runs its tick labels together at journal size
- **What I tried:** lysis chart as a 1 × 1 grid panel (300 px cell) with the ASM preset (177.8 mm, 7 pt text).
- **What happened:** the x tick labels 0 … 120 overlapped into one string and the legend's “Uninfected” was cut at the panel edge. At Col span 2 the chart is clean. The compliance report did not mention it.
- **Severity:** annoying.
- **Suggestion:** thin the ticks (every other label) when labels would overlap, keep the legend inside the plot area, or flag overlapping chart text in the compliance check.

### Crop fields under Clip shape have no unit or label
- **What I tried:** cropping the TEM info strip and the spot assay in ⚙ › Clip shape.
- **What happened:** the four boxes are marked only T, L, B, R, with no “%” and no tooltip, and the R box wraps onto its own line in the 300-px sidebar. Nothing says they are percentages of the image.
- **Severity:** polish.
- **Suggestion:** a “Crop %” label (or % after each box) and a tooltip; keep the four boxes on one line.

### Ruler labels stick out of a panel after its span shrinks
- **What I tried:** rulers drawn on the TEM at Col span 2 × Row span 2, then the span set back to 1 × 1.
- **What happened:** the rulers scale with the panel and keep their lengths, but their text keeps its size and runs outside the panel (“99.7 nm” over the left margin).
- **Severity:** polish.
- **Suggestion:** scale or clamp ruler labels with the panel, or keep them inside the panel's cell.

### A whole dilution row typed with spaces goes into one cell
- **What I tried:** lane table on the spot assay, typing `10^{0} 10^{-1} … 10^{-7}` into the first cell.
- **What happened:** the row splits on spaces only when every token is + or −; anything else is one cell. Commas or tabs work. The editor's hint mentions `- + - + - +` and spreadsheet cells, not commas.
- **Severity:** polish.
- **Suggestion:** say “or separated by commas” in the hint.

<a id="charts"></a>

## Charts

From [`charts.verify.js`](charts.verify.js), for the [charts guide](../charts.md).

### A wide table (one column per group) is guessed as a scatter plot
- **What I tried:** dropped `swim_wide.csv` (`Untreated,Phage-treated`, five numbers each) into a grid figure.
- **What happened:** the Chart dialog opened as **Scatter** with X = `Untreated` and Y = `Phage-treated`. Getting the intended bar chart needs Chart type › Bar, Data layout › Columns, and ticking `Untreated` again (see next item).
- **Severity:** annoying
- **Suggestion:** when every column is numeric and none is monotonic or named like x (time, dose, conc), guess Bar with Data layout › Columns, as Prism column tables are laid out.

### Switching Data layout to Columns leaves the former X column unticked
- **What I tried:** in the wide table above, Data layout › **Columns — each ticked column is a group**.
- **What happened:** only `Phage-treated` was ticked under "Group columns (each is one group)"; `Untreated`, the old X column, had to be ticked by hand, or the chart shows one group.
- **Severity:** polish
- **Suggestion:** on switching to Columns, tick every numeric column.

### One sample under several names in Sample colours and the legend key
- **What I tried:** three growth-curve CSVs of the same experiment: replicate columns (`MOI_0_r1…`), tidy rows with a `MOI` series column, and mean + SD columns (`MOI 0 mean`). Also a CFU file with `dfliC` shown as `Δ*fliC*` next to a semicolon file whose data say `ΔfliC`.
- **What happened:** Look › Sample colours lists `MOI_0`, `MOI 0` and `MOI 0 mean` as three samples (a colour set on one does not reach the others), the charts' legends read `MOI_0` vs `MOI 0`, and the key text lists `MOI_0 (black, solid line); … MOI 0 (black, solid line)` and `ΔfliC (black, filled bars); ΔfliC (black, filled bars)`.
- **Severity:** annoying
- **Suggestion:** key samples by the name the chart shows (after stripping a ` mean` suffix and turning `_` into a space), merge key rows with the same name and the same mark, and offer "same as…" in Names & colours.

### Sample colours switches between the value column and the categories of a bar chart
- **What I tried:** a single-series bar chart (`strain, replicate, cfu_per_ml`). Set WT's colour in the chart, then pressed × beside WT in Look › Sample colours.
- **What happened:** before any colour is set, the list shows `cfu_per_ml`, not the strains. After one strain gets a colour, the strains appear (WT ×, dfliC palette, dmotA palette). After × on WT, the strain rows vanish and `cfu_per_ml` comes back, so the other strains can no longer be coloured from Look. Whether a rows-layout bar chart draws its bars in one colour or one colour per group also depends on this (all black at first; palette colours once any group has a registered colour).
- **Severity:** annoying
- **Suggestion:** for a single-series bar chart, always list (and colour) its categories.

### Cancelling "Add bar chart" leaves the grid one row taller
- **What I tried:** six chart panels in a 3 × 2 grid; ⌘K › `add bar chart` › Enter, then **Cancel**.
- **What happened:** the panel is removed as the notes say, but the grid stays 3 × 3 with an empty row.
- **Severity:** polish
- **Suggestion:** restore the grid size when the just-added chart is removed.

### The panel letter covers a chart's top tick label
- **What I tried:** chart panels with the default letter (top left, chip).
- **What happened:** the letter chip sits over the y-axis top label (`1.2`, `2.5×10⁹`, `10¹⁰`).
- **Severity:** polish
- **Suggestion:** inset a chart's plot area by the letter's size when the letter is inside the panel, or place chart letters outside the axis.

### The bracket label box is too narrow to read
- **What I tried:** typed `p = 0.0008 (Welch t-test)` (25 characters; 40 allowed) into a significance bracket.
- **What happened:** the field shows only `008 (Welch t-test)`.
- **Severity:** polish
- **Suggestion:** let the label field take the rest of the row.

### Source data write the "shown as" name with its format marks
- **What I tried:** showed `dfliC` as `Δ*fliC*`, exported the submission package.
- **What happened:** `source-data/A.csv`'s plotted table has category `Δ*fliC*` (stars included), where the raw data above it say `dfliC`.
- **Severity:** polish
- **Suggestion:** write the data name, plus a `shown_as` column with the marks converted (ΔfliC), as the caption and alt text do.

### "Lab style: loaded" without a lab style
- **What I tried:** set one sample colour in a chart's Names & colours, then opened Look.
- **What happened:** the line under 📄 Load lab style reads "Lab style: loaded · 1 sample colour clear", though no file was loaded.
- **Severity:** polish
- **Suggestion:** "Sample colours: 1 set by hand · clear".

### The caption names chart panels without saying anything about them
- **What I tried:** ✦ Generate Caption (via the submission package's caption) on six chart panels.
- **What happened:** `(A) Panel A. (B) Panel B. … (F) Panel F.`
- **Severity:** polish
- **Suggestion:** draft from the chart: type, Y title, groups, error type and n (e.g. "(A) CFU/mL of WT, ΔfliC and dmotA, mean ± SD, n = 3, log scale").

<a id="journal-submission"></a>

## Journal submission

From [`journal-submission.verify.js`](journal-submission.verify.js), for the [journal submission guide](../journal-submission.md).

### The Nature preset keeps 183 mm when the figure then prints taller than 170 mm
- **What I tried:** 4 square panels in a 2 × 2 grid, Printed width Free, then Look › Target journal › Nature (also ⌘K › Journal: Nature, and the Nature preset button).
- **What happened:** width set to 183 mm; the figure prints 183 × 177.5 mm and the report's **Printed height** row fails ("at most 170 mm tall"). The toast does not mention the height. The README says a preset picks the widest width that fits the journal's height limit (89 mm would). The row has no fix button. Applying ASM to a 1 × 5 stack does refit (the blot-12 test), so the fit seems to depend on the starting state.
- **Severity:** annoying
- **Suggestion:** run the height fit whenever a preset is applied, and give the Printed height row a fix button ("Narrow to 89 mm" / "Fewer rows").

### Panel letter size field and the drawn letters disagree below 7 px
- **What I tried:** Look › Panel Labels › Size 4 pt (and 4 px) at 183 mm.
- **What happened:** the px field clamps to 6 px and the pt field reads 4.65 pt, but letters are drawn at a 7 px minimum, and the compliance report measures them at 5.4 pt.
- **Severity:** polish
- **Suggestion:** use the same minimum in the field and the renderer, or show the drawn size.

### ✦ Generate Caption replaces an edited caption without asking
- **What I tried:** edited the caption box, then clicked ✦ Generate Caption.
- **What happened:** the edit was gone with no prompt. ✦ Draft from figure for alt text asks "Replace your alt text?", and the stale banner warns "✦ Regenerate (replaces your edits)", but the main button does not.
- **Severity:** annoying
- **Suggestion:** confirm before replacing edited text, as alt text does.

### A caption note does not reach the untouched caption until the figure is re-rendered
- **What I tried:** typed a Caption note (not rendered) in a panel's ⚙ and pressed Enter / Tab.
- **What happened:** the generated caption stayed as it was until ⟳ Render; likewise the "figure has changed" flag on an edited caption only appears after a render.
- **Severity:** polish
- **Suggestion:** refresh the caption (or schedule a render) when a caption note changes.

### Duplication check flags an internal repeat in a noise-free drawn plate
- **What I tried:** 🧬 Duplication check on a figure whose plate photo was drawn on a canvas (flat bench colour, perfect circle, JPEG, no sensor noise).
- **What happened:** ✗ "D contains an internal repeat (mirrored + 90°) — 2 adjoining patches at 93.4% correlation — the fine detail matches" at the dish rim, with decision buttons. The same plate with added noise did not trigger it. Real photos carry noise, but drawn schematics, screenshots and rendered plates may not.
- **Severity:** polish
- **Suggestion:** treat patches whose fine detail is only JPEG blocking on a symmetric edge as "alike at a glance", or exclude low-noise synthetic regions as flat.

<a id="freeform"></a>

## Freeform

From [`freeform.verify.js`](freeform.verify.js), for the [freeform guide](../freeform.md).

### ⊡ Fit leaves the bottom of a freeform canvas under the window edge
- **What I tried:** a 958 × 798 px freeform canvas in a 1440 × 1000 window, then **⊡ Fit** (with and without an object selected).
- **What happened:** zoom 84 %; the canvas starts 88 px below the top of the canvas pane and ends at y 1013, 65 px below the pane's bottom (948). The chart and gene map row cannot be clicked until you press **－** once. The fixer notes say the bars take ~100 px and to "use Fit"; Fit does not account for them.
- **Severity:** annoying
- **Suggestion:** compute Fit from the pane's visible height below the position and Props bars, and drop the extra top offset.

### A TextBox is always filled: unticking Fill does nothing, and the opacity cannot reach 0
- **What I tried:** selected a ⬜ TextBox, unticked **Fill** in its toolbar; then tried the opacity slider.
- **What happened:** the annotation stores `fill: false`, but the box is still drawn at 60 % black (pixel 102,102,102 on white). The opacity slider's minimum is 0.05. The only way to a clean title is to set the Fill colour to the background colour.
- **Severity:** annoying
- **Suggestion:** honour `fill: false` in the TextBox renderer (canvas, SVG, PPTX), as Rect and Ellipse do.

### Layered SVG places panel pictures up to 0.7 px off their typed boxes
- **What I tried:** objects at X 20 / 538 / 538 / 744 with W 506 / 400 / 194 / 194 (12 px gaps, checked in the PNG at 11.97 px), exported **↓ SVG** (Layered).
- **What happened:** the `<image>` boxes are x 19.95 / 537.64 / 537.64 / 743.74 with widths 506.17 / 400.68 / 194.58 / 194.58, and the viewBox is 957.815 × 797.81 rather than 958 × 798. The gaps in the file read 11.52 px for 12 typed. Letters, clip paths and annotation boxes are exact (clip circle cx 635 r 97; box x 530 w 418).
- **Severity:** polish
- **Suggestion:** write each panel picture at its object's logical box (and the viewBox at the canvas size), scaling the raster into it, instead of the box rounded to export pixels.

### Align uses the selection's outermost edge, which is not said and differs from Match
- **What I tried:** placed a chart at Y 538 and a gene map that landed at Y 304, selected chart then map, clicked **⊤T**.
- **What happened:** the chart jumped up to Y 304 (the topmost edge), breaking the layout. **=W / =H** follow the first object selected; **⊢L / ⊤T** follow the outermost edge whatever the order. The tooltips say "Align top edges" only.
- **Severity:** polish
- **Suggestion:** say in the tooltip which edge wins, or align to the first-selected object as Match does (as Illustrator's "key object").

### Inserted icons show their name as a label on the figure; cleared, they all read "image"
- **What I tried:** Annotate & Draw › Insert icon › Bacteriophage and Bacterium in a graphical abstract.
- **What happened:** each icon is drawn with a "Bacteriophage" / "Bacterium" letter chip over it. Clearing **Props › Label** removes the chip, but then the Elements list calls both "image", so they can no longer be told apart there.
- **Severity:** annoying
- **Suggestion:** insert icons with no letter (Relabel already leaves icons alone) and keep the icon name as the element's name in the list.

### The annotation toolbar runs off the right edge of the window
- **What I tried:** selected a Rect drawn on the right half of a 958 px canvas (zoom 59–84 %).
- **What happened:** the floating toolbar starts near the selection and extends past the window's right edge; **⬆ Front** sits at the edge and **✕ Del** wraps to a second row.
- **Severity:** polish
- **Suggestion:** clamp the toolbar inside the canvas pane.

### In PowerPoint, chart and gene-map letters are part of the pictures
- **What I tried:** 📊 Export editable PowerPoint (.pptx) of the results figure (pictures A–D, chart E, gene map F).
- **What happened:** slide 1's text boxes hold A, B, C, D, "10 µm" and the text mark, but not E or F: those letters are baked into the chart and gene-map pictures. The PDF has E and F as text.
- **Severity:** polish
- **Suggestion:** write every object's letter as a text box, as for pictures.

### Gene-map end labels overlap the length label in a short map
- **What I tried:** a 10.8 kb, 12-feature GenBank map at 446 × 160 px.
- **What happened:** "10.8 kb" is drawn over "endolysin" and "Rz" at the right end (visible in img/freeform-figure.png).
- **Severity:** polish
- **Suggestion:** keep the length label clear of feature labels (or put it under the ruler).
