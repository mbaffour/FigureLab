# Re-verifying the guides

Each guide has a script here that follows its steps through the app's visible UI (buttons by their text, the real file choosers, typed values, keyboard shortcuts) on generated inputs, then checks the result: the app's state, exported files (TIFF size and DPI, PDF page size, ZIP contents, CSV values, SVG text) and screenshots.

| Script | Guide |
|---|---|
| `quickstart.verify.js` | the quick start in [../README.md](../README.md) |
| `western-blot.verify.js` | [western-blot.md](../western-blot.md) |
| `fluorescence.verify.js` | [fluorescence.md](../fluorescence.md) |
| `phage-and-microbiology.verify.js` | [phage-and-microbiology.md](../phage-and-microbiology.md) |
| `charts.verify.js` | [charts.md](../charts.md) |
| `journal-submission.verify.js` | [journal-submission.md](../journal-submission.md) |
| `freeform.verify.js` | [freeform.md](../freeform.md) |
| `tips.verify.js` | [tips-and-tricks.md](../tips-and-tricks.md) and rows of [troubleshooting.md](../troubleshooting.md) |

## Run

From the repository root, with the test suite's dependencies installed (`cd tests && npm ci && npx playwright install chromium`):

```sh
NODE_PATH=tests/node_modules node docs/guides/verify/western-blot.verify.js   # one guide
sh docs/guides/verify/run-all.sh                                               # all of them
```

Each script prints one line per step (`ok` or `FAIL` with the reason) and exits non-zero if any step failed. Everything it makes goes to `out/<guide>/` (git-ignored): `inputs/` (the generated files), `downloads/` (what the app exported), `shots/` (screenshots, including one per failed step) and `result.txt`. The 1–3 screenshots each guide shows are rewritten into `../img/` on every run. A full run takes a few minutes; it also needs `unzip` on the PATH.

## Files

- `lib.js`: the harness (start a browser on `figure_lab.html`, run steps, open sidebar sections, ⌘K, file choosers, the Save dialog, downloads, toasts, screenshots), a 16-bit TIFF writer with ImageJ calibration, and readers for PNG, TIFF and ZIP files.
- `inputs.js`: deterministic synthetic inputs with known truth: tilted western blots with set band amounts and a ladder, a total-protein stain, 16-bit fluorescence channels (DAPI, GFP, CellMask) at 0.108333 µm/px, a TEM micrograph with a burned-in 200 nm bar at 0.5 nm/px, plaque plates, a spot assay, a phase-contrast photo and a phage GenBank file. Scripts write their own CSVs with known means and SDs, plate-reader exports in each time format, and the extra blots and plates their later sections need (a phospho/total pair, a replacement plate).
- `ISSUES.md`: problems found while verifying, with severity and a suggestion. When a fix lands, re-run the affected script, update the guide's step (and drop its workaround), and mark the entry fixed with the evidence.

Headless Chromium never answers the native "Save as" picker, so `lib.js` hides it and the app uses its ordinary download path (the one Firefox and Safari use).
