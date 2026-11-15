# Freeform figures and graphical abstracts

## What you'll make

A results figure that is not a regular grid (one big panel, a 4:3 photo and two small square panels, with a chart and a gene map underneath, all with exact 12 px gaps), and a 5:2 graphical abstract built from icons, a photo, arrows and a title. Both export with their text as editable text.

![A freeform results figure: a large fluorescence panel A, a 4:3 phase-contrast photo B, a round-clipped plate C and a TEM D on a tinted box, a line chart E and a gene map F](img/freeform-figure.png)

## You need

- Your pictures, of any shape (TIFF, PNG, JPEG, SVG).
- Optional: a CSV for a chart and a GenBank file for a gene map.
- The printed width your journal wants (for example 183 mm), so sizes in points come out right.

This guide was checked step by step by `verify/freeform.verify.js`, on a 16-bit fluorescence TIFF, a 4:3 photo, a plate photo, a TEM micrograph, a growth-curve CSV and a GenBank file.

**Grid or freeform?** If your panels fit rows and columns (even with a panel spanning two cells), stay in the grid: you keep the lane table, headings, automatic letters and the caption's structure. Use freeform when panels of different shapes and sizes have to sit where you put them, or for a graphical abstract.

## 1. Start a freeform figure

There are two ways in.

**From scratch**

1. Open **Arrange** and set **Canvas mode** to **✦ Freeform**.
2. Under **Canvas size (px)** type **W** and **H** (here 958 × 798). Set the shape before you place anything.
3. Click **Drop or click to add images** and pick your pictures. They arrive in a row at a default size, and each one appears in the **Elements** list under the canvas size.
4. Click **⊡ Fit**. If the bottom of the canvas is still under the edge of the window, click **－** once (see [If something looks wrong](#if-something-looks-wrong)).

**From a grid you already built**

1. In a grid figure, open **Arrange** and click **⇱ Pop out to free layout**.
2. If the figure has something freeform cannot draw (a flip, merged channels, an intensity bar, a spotlight, inset outlines, group brackets), a dialog names it first, for example "Freeform cannot draw the intensity bar on panel A". Click **Pop out**, or Cancel.
3. Every panel becomes an object at its grid size and place, with its crop, clip shape, letter, µm/px and scale bar. Lane tables and headings become text. The toast says what came across.
4. One <kbd>Ctrl/⌘+Z</kbd> brings the grid back exactly.

## 2. Place panels by numbers

The bar above the canvas holds the selection's **X**, **Y**, **W**, **H** and **∠** (angle), a **⛓** tick (keep the shape), and a **px / mm** menu. Type a value and press <kbd>Enter</kbd>.

![The position bar (X, Y, W, H, angle, ⛓, px/mm), Align, Space, Distribute, Match and Layer, and the Props bar below it](img/freeform-bar.png)

1. Click an object on the canvas, or its name in the **Elements** list (useful when objects overlap).
2. With **⛓** ticked, typing **W** sets **H** in proportion. A 4:3 photo given W 400 gets H 300; untick **⛓** to set both freely (charts and gene maps usually need this).
3. Give each picture its width and a rough place: type a rough **X** and **Y**, or drag it by its middle. Step 3 lines them up exactly.
4. Type the main panel's position exactly: here **X** 20, **Y** 20, **W** 506.
5. Choose **mm** in the units menu to type sizes at the printed size (Export › Printed width sets the scale). On a 1328 px canvas printed at 112.4 mm, a 300 px picture reads 25.39 mm.

<kbd>⌘K</kbd> `position` jumps to the **X** field.

## 3. Line them up with exact gaps

Select two or more objects: **Shift-click** or **⌘/Ctrl-click** them, or drag a box starting on empty canvas (it selects every object it touches), or press <kbd>Ctrl/⌘+A</kbd>. With several selected, the bar shows the box around all of them, and typing **X** or **Y** moves them together.

1. Type the gap into **Space** (here 12).
2. Click **A**, Shift-click **B**, then **⊤T** (align top edges) and **⇿** (put exactly 12 px between them, left to right). B moves to X 538.
3. Click **B**, Shift-click **C**, then **⊢L** (align left edges) and **⇕** (12 px top to bottom). C moves to Y 332.
4. Click **C**, ⌘/Ctrl-click **D**, then **=W** (same width as the first one you selected), **⊤T** and **⇿**. D lands at X 744: its right edge meets B's (938) and C's bottom meets A's (526).
5. **←→** and **↑↓** (Distribute) spread three or more objects evenly between the outer two, which stay where they are. Place the outer two first: if the middle one does not fit between them, the gaps come out negative (the toast says, for example, "3 items, -77.15 px apart").
6. **↔** and **↕** centre one object on the canvas; with several selected they line up their centres with each other.

Align uses the outermost edge of the selection (the topmost top for **⊤T**, the leftmost left for **⊢L**), whichever you clicked first. Move a newcomer roughly into place before aligning it, or it pulls the others to it.

Fine moves: arrow keys move the selection 1 px, <kbd>Shift</kbd>+arrow 10 px. <kbd>]</kbd> and <kbd>[</kbd> turn it by 1°, with <kbd>Shift</kbd> by 5°; the **∠** field shows the angle and takes a typed one.

To deselect, press <kbd>Esc</kbd> or click beside the canvas (a click on empty canvas starts a selection box instead).

On the test figure the exported PNG has 11.97 px (logical) between A and B and between C and D, for 12 typed.

## 4. Crop, clip and stack the pictures

The **Props** bar under the position bar shows the selected picture's settings.

1. **Clip**: **□** (none), **◯** circle, **⬭** ellipse, **▢** rounded rectangle (the number beside it is the corner radius). The toast says "Circle clip — it carries into every export". A clip set in the grid survives **⇱ Pop out**.
2. **Crop%**: type **T**, **L**, **B**, **R** in percent. The box shrinks with the crop and the picture keeps its proportions (Crop% L 10 on a 194 px square gives 174.6 × 194).
3. **Layer**: **⬆⬆** bring to front, **⬆** forward one step, **⬇** back one step, **⬇⬇** send to back.
4. **Label**: the panel letter of that object. **Arrange › 🔤 Relabel A, B, C…** letters everything in reading order, charts and gene maps included (here pictures A–D, chart E, gene map F). Set the letter size in **Look › Panel Labels (A, B, C…) › Size** in pt (8 pt at 183 mm is 14.77 px).

## 5. Add a chart and a gene map

1. **Chart**: click **Drop or click to add images** and pick a CSV. The **📊 Chart** dialog opens; check the columns and click **Apply** (see [charts.md](charts.md)). The chart lands in the middle of the canvas.
2. Select it (Elements list: its file name), untick **⛓**, and type its box: here **X** 20, **Y** 538, **W** 460, **H** 240.
3. **Gene map**: **Annotate & Draw › Gene maps & circuits › 🧬 Linear** (or **⭕ Plasmid**). In the dialog click **📄 GenBank / FASTA…** and pick the file; the line under the table says what was read ("10.8 kb · 12 features"). Click **Apply**, then close the dialog with **×**. Note that 🧬 Linear adds a sample map at once; if you cancel, delete it from the Elements list.
4. Select the gene map ("linear gene map" in the Elements list), untick **⛓**, type **W** 446 and **H** 160 and a rough **X**/**Y** below the pictures. Then click the chart, Shift-click the map, **⊤T** and **⇿**: the map sits 12 px right of the chart and ends at 938, flush with D.
5. Run **🔤 Relabel A, B, C…** again so the chart and map get the next letters.

## 6. Arrows, text and shapes

All of these are in **Annotate & Draw › Tool**. Set **Color**, **Width** and **Fnt** (font size, px) there before drawing; each mark keeps its own afterwards. On the white canvas new marks are dark (#111111); over a picture they start white.

1. **↗ Arrow**: drag from tail to head.
2. **T Text**: click where the text starts, type, press <kbd>Enter</kbd>. Format marks work: `Δ*ompC*` gives italic *ompC*, `H_{2}O` a subscript, `10^{8}` a superscript.
3. To edit text, choose **↖ Select** and double-click it; the editor opens on the text as typed, marks included. Its floating toolbar has **Color**, **W**, **Fnt**, **Halo**, the text field, **B** (bold for this text only; text starts bold) and **✕ Del**.
4. **⬜ TextBox**: drag a box. Select it and type into its toolbar's text field. Set **Fnt**, the text **Color**, and the box **Fill** colour and opacity there.
5. **□ Rect** and **○ Ellipse**: drag. Choosing a **Fill** colour ticks **Fill**. Rectangles have **Corner R** (radius in px).
6. Selected marks show in the position bar too: here the box behind C and D is **X** 530, **Y** 326, **W** 418, **H** 206.
7. **⬇ Behind** sends a mark behind every object ("The annotation is now behind every object — it is drawn there in the figure and every export"); **⬆ Front** brings it back. The tinted, rounded box behind C and D in the figure above is a Rect with a fill, Corner R 12, sent Behind.

Marks drawn over an object are pinned to it and move with it (Shift+→ on panel A moved its arrow 10 px).

## 7. A graphical abstract

![A 5:2 graphical abstract: a phage icon, an arrow labelled "infects", a round-clipped plate photo, an arrow labelled "ΔompC resists", a bacterium icon and a one-line title](img/freeform-abstract.png)

1. Click **✕ New** › **Confirm**.
2. Press <kbd>⌘K</kbd>, type `graphical abstract`, and press <kbd>Enter</kbd> on **Canvas: graphical abstract (Elsevier)**. The canvas becomes 1328 × 531 px, exported at 300 DPI (112.4 mm wide), and a note gives Elsevier's rule and where it was read. Close it with <kbd>Esc</kbd>.
   - **Canvas: square graphical abstract (custom size — check your journal)** gives 1200 × 1200 px; it is not a checked specification.
3. **Annotate & Draw › Insert icon**: click an icon (here Bacteriophage and Bacterium; **Show all 210 icons** lists the rest). Icons arrive with their name as a label chip; select each and clear **Props › Label** if you don't want it.
4. Add a photo with **Drop or click to add images**, set its **W** and **Clip ◯**.
5. Size and place the outer two first: phage **H** 220, **X** 80; bacterium **W** 220, **X** 1028.
6. Click beside the canvas, press <kbd>Ctrl/⌘+A</kbd>, then **↕** (centres in a line), **←→** (equal gaps; here "3 items, 247.85 px apart"), and type **Y** 116 to centre the row on the canvas.
7. Title: **⬜ TextBox**, drag a box, select it, then type **X** 80, **Y** 16, **W** 1168, **H** 64 and the text, for example `Phage phiGuide lyses *E. coli* K-12 within 90 min at 10^{8} PFU/mL`. Set **Fnt** 28 and a dark **Color**. For no visible box, set the **Fill** colour to the background colour (white).
8. Set **Fnt** 18 in Annotate & Draw, draw two **↗ Arrow**s between the objects and two **T Text** labels above them.

## 8. Export and check

1. **↓ SVG** (layered by default): one layer per object, a layer "Annotations behind objects" under the panels, the clip as a clipPath, and every letter, label and text box as `<text>` with italic and superscript spans. Open it in Illustrator, Affinity or Inkscape to finish.
2. **Export › 📊 Export editable PowerPoint (.pptx)**: pictures, plus editable text boxes for letters, T Text and TextBoxes with their italic, subscript and superscript runs ("PowerPoint exported — 3 pictures, 3 editable text boxes"). The letters of charts and gene maps are part of their pictures.
3. **↓ PDF lossless**: the Save dialog says letters, labels and text boxes are written as real, selectable text in the PDF's standard fonts, named but not embedded. Text with characters those fonts lack (Greek letters such as Δ or φ, ≥, ✓) stays in the picture: on the abstract, the title written with "phi" and the label "infects" were text, the "Δ*ompC* resists" label was not.
4. **↓ PNG** / **↓ TIFF**: the gaps you typed are the gaps in the file.

Before submitting, run the compliance check and add the legend key and caption: [journal-submission.md](journal-submission.md).

## Tips

- Pick objects from the **Elements** list when they overlap; click them on the canvas for Shift/⌘-click selections.
- Press <kbd>Esc</kbd> or click beside the canvas before <kbd>Ctrl/⌘+A</kbd>: with the cursor still in a field, Ctrl/⌘+A selects that field's text, and <kbd>Ctrl/⌘+Z</kbd> undoes typing in it.
- Place the outermost objects first, then Distribute; set rough positions before Align.
- Type sizes in **mm** when the journal gives panel sizes in mm.
- For text that must stay editable in a PDF, avoid Greek letters and symbols; write "phi", or finish the text in the SVG.
- A chart in freeform is drawn from its data with the same Chart dialog as in a grid ([charts.md](charts.md)). For a figure that mixes micrographs, charts and gene maps in rows, a grid is simpler ([phage-and-microbiology.md](phage-and-microbiology.md)).
- More shortcuts: [tips-and-tricks.md](tips-and-tricks.md).

## If something looks wrong

- **The bottom of the canvas is cut off after ⊡ Fit.** Click **－** once, or scroll the canvas; <kbd>Ctrl</kbd>+scroll zooms about the pointer.
- **Align pulled everything to the wrong place.** Align uses the outermost edge of the selection. Undo, move the stray object roughly into place, and align again.
- **Distribute made the objects overlap.** The outer two stay put; move them apart first.
- **A TextBox keeps a grey box behind its text with Fill unticked.** Unticking Fill does not remove it yet; set the Fill colour to the background colour.
- **An inserted icon shows its name on the figure.** Clear its **Label** in the Props bar.
- **Greek letters are missing from the PDF's selectable text.** They are in the picture layer; the PDF's standard fonts cannot hold them.
- **The SVG's gaps read 11.5 px, not 12.** The layered SVG places each panel's picture up to 0.7 px off its box; the PNG, TIFF and PDF have the exact gap. **Export › SVG › Flat (one image)** writes the whole figure as one picture, drawn as the PNG is, with the text on top.
- More: [troubleshooting.md](troubleshooting.md).
