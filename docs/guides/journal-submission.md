# Getting a figure through journal submission

## What you'll make

A figure set to one journal's rules, checked row by row against that journal's figure guide, with a legend key, a caption, a Methods paragraph and alt text, checked for reused images, and exported as one submission package you can rebuild after review.

![The four-panel test figure after the revision (eLife), with the legend key placed at the right edge](img/journal-figure.png)

## You need

- A figure that is already laid out. The figure-type guides get you there: [western blots](western-blot.md), [fluorescence](fluorescence.md), [phage and microbiology](phage-and-microbiology.md), [charts](charts.md).
- The images from your other figures of the paper, or their exported panels, if you want to check for reuse across figures.
- The journal's own figure guide open in another tab. FigureLab read each journal's page in November 2026; guides change.

Every step below was run on this build by `verify/journal-submission.verify.js`, on a four-panel figure (two calibrated 16-bit fluorescence channels, a western blot and a plate photo).

## 1. Choose the journal

Do this after the layout is settled (columns, rows, spans), and after you name the figure.

1. Open **Export** and type the figure's name in **File name**, with its number: `Figure 2`.
2. Open **Look** and choose your journal in **Target journal**. You can also press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>, type the journal's name or abbreviation (`plos`, `mbio`, `j bacteriol`, `jbc`) and press <kbd>Enter</kbd> on **Journal: …**, or click one of the preset buttons under it (**Nature**, **PLOS**, **eLife**, **EMBO**, **ASM**, **JBC** …). A journal FigureLab has no preset for says so: `nat comms` finds "Journal: no preset for Nature Communications", which changes nothing.
3. Read the toast. It lists what the preset changed, for example `PLOS ONE preset applied — Arial, LZW TIFF, named Fig2 — letters 10 pt, headings 9 pt, text 8 pt`.

What a preset sets, where the journal states it:

| | Nature | PLOS ONE | eLife |
|---|---|---|---|
| Printed width | 183 mm, or 89 mm when 183 mm would make the figure taller than 170 mm | 173 mm | 183 mm |
| Font | Arial | Arial | not changed |
| Letters / headings / text | 7 / 7 / 7 pt | 10 / 9 / 8 pt | 8 / 8 / 7 pt (eLife states no size) |
| TIFF | — | LZW, named `Fig2.tif` | — |

A preset picks the widest width the journal allows that keeps the figure within its height limit, and its toast says so: on a 2 × 2 figure of square panels, "Nature preset applied — 89 mm wide — the widest that keeps it within 170 mm tall".

PLOS file names take the number from your File name: `Figure 2` becomes `Fig2`. If you rename the figure after choosing PLOS, the compliance report's **File name** row offers a **Name Fig3** button.

Science, Cell and PNAS are marked *unverified*: FigureLab could only read secondary sources for them, so their rows never fail.

## 2. Run the compliance check

1. Open **Check** and click **✓ Check journal compliance** (or ⌘K › **Check against …**, which reports without changing your journal).
2. Read the title: `PLOS ONE compliance — 18/21 passed`.
3. Read each row. Each journal row names its source.

![The PLOS ONE compliance report](img/journal-compliance.png)

What the icons mean:

- **✓** the figure meets the rule.
- **⚠** a warning: the figure may be fine, but check (for example panels below 300 ppi).
- **✗** the figure breaks the journal's rule.
- **ℹ** nothing was checked: the row says **Does not apply** (no insets, no pseudocoloured panels), **Not run** (the reuse check across figures) or **not checked** (no export yet). These rows are not counted in the passed total.

### The fix buttons

Each button is one undo step, and the report refreshes after it.

| Row | Button | What it does |
|---|---|---|
| Text size, journal states sizes | **Fit 8–12 pt** (the journal's range) | Brings the figure's text sizes into range. Verified: 3 pt text → 8 pt under PLOS. |
| Text size, journal states none (None, Science, Cell, PNAS) | **Raise to 6 pt** | Text under 5 pt (the smallest any journal FigureLab has read accepts) fails, and text under 6 pt warns; the button raises it to 6 pt. |
| Scale-bar calibration | **Calibrate…** / **No scale bar on these** | Calibrate a micrograph, or switch off a bar on a photo, blot or chart that has no scale. |
| Text contrast | **Auto contrast** | Darkens the chips behind the letters and picks black or white text, so every letter reads against its panel. See the note below. |
| Printed height | **Set 89 mm** (the width that fits) | Narrows the figure until it fits the journal's height. |
| Legend key on the figure | **Move to free space** | Puts a key that covers a panel, letter or heading back into free space. |
| Panel resolution | **Select panel** | Selects the first panel that prints below 300 ppi, so you can make it smaller. |
| Alt text | **Alt text** | Opens the ALT TEXT box under the caption. |
| File name (PLOS) | **Name Fig2** | Renames the export. |
| Export format (Nature) | **Save as PDF (lossless)** | Opens the Save dialog in a format the journal accepts. |

**Text contrast.** The row measures each letter against the picture under its strokes. In the test, letter C on its chip over the white blot read 3.55:1 (⚠). The row's **Auto contrast** button fixed it with **Look › Panel Labels (A, B, C…) › Background** still ticked: the toast reads "Auto contrast on — the chips behind the letters are darker and the letters white…", and the row passed. Text without a chip over a mid-grey picture (a TEM's scale-bar text, for example) can still fall short; darken that panel slightly with its ⚙ › **Black pt** ([phage guide](phage-and-microbiology.md)).

**Printed height.** Nature allows 170 mm. The preset already picks a width that fits. If you choose a wider **Export › Printed width** afterwards (183 mm on a 2 × 2 figure of square panels), the row fails and its **Set 89 mm** button brings it back. Fewer rows also work.

## 3. Add the legend key

The key lists every channel colour, chart series and gene-map feature once, with the exact colour, marker and line drawn in the figure.

1. Open **Export › Legend key**.
2. Rename a channel under **Channel names** if the file name gave the wrong one (`GFP` → `GFP-LC3`). The key, its text and the placed key follow. Clear a name to go back to the tag or file name.
3. Tick **Place the key on the figure**. It goes into free space (a margin, an empty cell or a free corner), never over a panel, letter or heading. When there is no room, a margin grows for it and a toast says so: in the test, "The legend key needed free space, so the bottom margin grew from 16 to 53 px — it sits there without covering anything." The key moves itself when the layout, text size, printed width or journal changes.
4. To choose the place yourself, use the **Where** menu beside the switch: **Free space**, **Top right**, **Top left**, **Bottom right**, **Bottom left**, **Right edge** or **Below**. Or drag the key with **Annotate & Draw › ↖ Select**: a key you moved stays where you put it. If it then covers something, the compliance report's **Legend key on the figure** row warns ("the key you moved covers panel letter A, 1 panel") and its **Move to free space** button puts it back.
5. Click **⬇ Download key**. It is written in the format of your last export, shown on the button: **⬇ Download key (PNG)** before any export, **⬇ Download key (TIFF)** after a TIFF.
6. Under **Figure caption helper**, the **Legend text starter** box holds the key as a sentence: `DAPI (blue); GFP-LC3 (green).` Click **Copy** and paste it into your figure legend.

The placed key shows the same names, swatches and font as the downloaded file.

## 4. Write the caption, Methods and alt text

1. In each panel's **⚙**, type a **Caption note (not rendered)**: what the panel shows, for example `PhoA western blot; WT and ΔphoA, ± IPTG`.
2. Open **Export** and click **✦ Generate Caption**. Panels are named by letter: `(C) PhoA western blot; …`. Scale bars, µm per pixel and field of view are written in for calibrated panels.
3. Click **✎ Write Methods paragraph**. It states the 16-bit display ranges in camera counts, the look-up tables, where each calibration came from, which panels print below 300 ppi, and any reuse you marked as intentional.
4. Under **Alt text**, click **✦ Draft from figure**. The draft says what is where, not what it shows; add your findings. It goes into the PNG, SVG and PDF and into the package.

An untouched caption, Methods paragraph or alt text follows the figure by itself, also in a reopened session: in the test, swapping panels A and B after reopening rewrote the untouched caption to start with "(A) GFP-LC3". A new caption note reaches the caption at the next **⟳ Render** (<kbd>R</kbd>).

Once you edit one of them, FigureLab keeps your words. If the figure changes afterwards, a line under the box says so and offers both ways:

- caption: `⚠ The figure has changed since this caption was written. ✦ Regenerate (replaces your edits) · Keep mine`;
- Methods: `… since this paragraph was written. ✎ Rewrite (replaces your edits) · Keep mine`;
- alt text: `⚠ The figure or its caption has changed since this alt text was written — exports embed it as it is. ✦ Redraft (replaces your edits) · Keep mine`.

**Keep mine** keeps your text and hides the line until the figure changes again. Clicking **✦ Generate Caption** or **✎ Write Methods paragraph** on edited text asks first ("Replace your caption?"): **Replace** or **Keep mine**.

## 5. Check for reused images

Journals screen whole papers for the same micrograph or blot used twice (ASM with Imagetwin; the Science journals and MDPI with Proofig; Nature).

### Within the figure

1. Open **Check** and click **🧬 Duplication check**.
2. Read **Whole panels**, then **Regions**. A copied panel reads `B and E are 100.0% similar — the fine detail matches — confirm these are different acquisitions`.
3. Decide each finding: **Intentional reuse — say so in the legend**, **Different images**, or, for frames of one field, **Same field, different acquisitions**.

### Across the paper's figures

1. Click **🧬 Check against other figures…**.
2. Under **Session files and image files**, click **choose files…** and pick the other figures' session files or exported panels (PNG, JPEG, TIFF). Figures you saved with **＋ Save current to library** are listed already.
3. Click **Compare**.
4. Decide each ✗ finding. Marking **Intentional reuse — say so in the legend** writes a sentence into the caption and Methods: `The image in panel A is reused from “Fig1_panelC_DAPI.png”, mirrored left–right.`

![The cross-figure check: a mirrored copy found, a same-layout blot listed apart](img/journal-reuse.png)

**"Similar layout" is not reuse.** Two different blots with one lane layout, two plates in the same dish, or two fields behind the same letterbox look alike at a glance. The check compares the fine detail (noise, grain, band edges), and lists pairs that only share the composition under **Alike at a glance — not counted as reuse**, with nothing to decide and nothing written into the legend. In the test, a different blot with the same six lanes was listed there; the mirrored copy of panel A was found at 99.8 %.

The compliance report's **Image reuse across figures** row shows whether the check was run and whether every finding is decided. The package carries `IMAGE_REUSE_CHECK.txt`. The check compares only the images you give it; it does not search published papers and does not detect AI-generated images.

## 6. Export and build the submission package

1. Export the figure in the journal's format: the toolbar's **↓ TIFF** › **Save TIF** under PLOS wrote `Fig2.tif`, LZW, 300 dpi, 173.0 mm wide. For Nature use **↓ PDF lossless**.
2. Re-run **✓ Check journal compliance**: the **Export format** row counts every format you saved since the figure last changed, and passes if one of them is one the journal accepts.
3. Open **Export** and click **📦 Export submission package (ZIP)**.

What the package holds (25 files in the test):

- the figure as `.png`, `.tif`, `.pdf` (lossless) and `.svg` (layered) (TIFFs are `.tif` under PLOS, `.tiff` otherwise);
- the key as `-key.png`, `-key.tif`, `-key.pdf`, `-key.svg` and `-key.txt` (the legend text starter);
- `-caption.txt`, `-methods.txt`, `-alt.txt`;
- `-session.json` (reopens the whole figure), `-metadata.csv`, `-repro-log.txt`, `_assemble.R`, `_assemble.py`;
- `PANEL_HISTORY.txt` and `.json` (every operation on every panel, including replaced images);
- `IMAGE_REUSE_CHECK.txt`;
- `panels/` (each panel on its own);
- `README.txt` (the list, and notes on the text files).

A figure with cropped blots also carries the uncropped originals (S1) and the densitometry CSVs; the [western blot guide](western-blot.md) covers them.

Caption and Methods in the package: an untouched box is regenerated for the figure as exported; your edited text is kept. If the figure changed after you edited it, the package keeps your text, adds `-caption-generated.txt` / `-methods-generated.txt` with FigureLab's version, and says so: a note "⚠ Check the Methods" opens when the package is written, and `README.txt` repeats it. In the test, Methods edited in a reopened session and then a panel swap gave `Fig2-methods-generated.txt` (26 files).

## 7. Save and reopen your work

1. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>, or **Export › Save / load your work › 💾 Save (bundled)**. You get `<name>-session.json` with the images inside, including the 16-bit samples (the toast says how many MB).
2. To reopen: on a fresh page, click **📂 Load a session** on the welcome card, or **Export › 📂 Load**, and pick the file.

Verified: panels, letters, target journal, File name, channel names in the key and caption notes all came back. Autosave cannot hold large images; keep the session file.

## 8. Revise after review

1. **Replace an image.** Right-click the panel on the canvas › **⇄ Replace image…** (also in the panel's **⚙** and in ⌘K). Label, crop, caption note and settings are kept: `Panel C: PhoA_blot.tif → PhoA_blot_rerun.tif — crop, labels and settings kept`. Calibration comes from the new file, and is cleared with a message when the pixel size may differ.
2. **Swap two panels.** Drag one panel onto the other on the canvas. The toast says `Panels swapped`, and the letters follow position. After **⎘ Duplicate** or other reordering, **Arrange › 🔤 Relabel A, B, C…** letters them in order again.
3. **Change journal.** ⌘K › **Journal: eLife** (or Look › Target journal). Run the compliance check again.
4. **Re-export** the figure and the package. `PANEL_HISTORY.txt` records the replaced file.

## Tips

- Lay out the figure first, name it, then choose the journal. The preset sets sizes in points at the printed width, and PLOS takes the figure number from the name.
- ⌘K › **Check against …** reports against any journal without changing your target.
- Export the figure in the journal's format before the final check, so the **Export format** row has something to check.
- Write caption notes in each panel's ⚙ rather than editing the caption: they survive regeneration and travel with the panel when you swap or replace it.
- Save the session (⌘S) before a revision round, and keep the package's `-session.json`: it reopens the figure as submitted.
- More shortcuts: [tips and tricks](tips-and-tricks.md).

## If something looks wrong

| Symptom | Fix |
|---|---|
| **Text contrast** still warns after **Auto contrast** on text without a chip over a mid-grey picture | Darken that panel slightly: its ⚙ › **Black pt**. |
| **Printed height** fails | You widened the figure after the preset: click **Set … mm** on the row, or use fewer rows. |
| **Legend key on the figure** warns | A key you dragged covers something: click **Move to free space**, or pick a place under **Export › Legend key › Where**. |
| A margin stays wide after you move the key | A margin grown for the key keeps its width when the key moves elsewhere. Set it back under **Arrange › Margins**. |
| The key lists only some panels | It keys colour: channels, chart series and gene-map features. A blot or an RGB photo has no key row. |
| The caption shows ⚠ out of date | Click **✦ Regenerate** (replaces your edits) or **Keep mine**. |
| A caption note does not appear in the caption | Press **⟳ Render**. |
| A blot pair is listed as "similar layout" | Nothing to do: it is not counted as reuse. |
| The TIFF is named `Figure 2.tif` under PLOS | Click **Name Fig2** on the report's **File name** row, or choose PLOS after naming. |

More in [troubleshooting](troubleshooting.md). Back to the [guide index](README.md).
