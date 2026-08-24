# tools/ — development utilities

Not shipped. `figure_lab.html` stays a single dependency-free file; everything here runs
on a developer's machine only, like `tests/`.

## build-icons.mjs — third-party icon packs

FigureLab's own ~95 icons are drawn inline in `figure_lab.html` and are MIT-licensed with
the app: no attribution, no publication licence, no per-figure fee. That is the point of
the library, and it is why importing outside artwork needs care rather than a bulk copy.

This script imports a pack without importing a licensing problem.

```bash
node tools/build-icons.mjs --manifest tools/pack.json --out tools/out.js
```

The manifest is the curation work — a list of entries you have chosen and verified:

```json
[{ "url": "https://…/mitochondrion.svg", "name": "mitoDetailed",
   "label": "Mitochondrion (detailed)", "group": "cell", "keys": "mitochondria cristae",
   "w": 130, "h": 90,
   "license": { "spdx": "CC0-1.0", "author": "Jane Doe", "src": "https://bioicons.com/…" } }]
```

The script then does the mechanical part:

- **Filters by licence.** `CC0-1.0`, `MIT`, `public-domain`, `CC-BY-3.0`, `CC-BY-4.0` are
  accepted. `CC-BY-*` is accepted **only** with `author` *and* `src`, because an icon that
  cannot be attributed cannot be used.
- **Rejects share-alike outright.** `CC-BY-SA` can be read as reaching the figure the icon
  is placed into. That is not a risk to hand someone about to submit a manuscript.
- **Normalises for recolouring.** Every explicit `fill`/`stroke` (and `currentColor`)
  becomes the sentinel colour FigureLab substitutes, so pack icons obey the colour picker
  like the built-ins. Without this they silently ignore it.
- **Enforces a size budget** (400 KB for the whole pack) and drops anything over 4 KB after
  cleanup.

It writes an `Object.assign(SCIENCE_ICONS, {…})` block. **It does not touch
`figure_lab.html`** — a human reviews the artwork and the licence claims and pastes it in.
Automating that would mean shipping art nobody looked at, under licences nobody checked.

### Where to source

| Source | Licence | Notes |
|---|---|---|
| [Bioicons](https://bioicons.com/) | per-icon (CC0/MIT/CC-BY) | ~2,800 SVGs; each declares its own licence — read it per icon, not per site |
| [NIH BioArt](https://bioart.niaid.nih.gov/) | free incl. commercial, some need attribution | ~2,000, professionally vetted, SVG/EPS/AI/PNG |
| [SciDraw](https://scidraw.io/) | CC BY 4.0 | many carry a Zenodo DOI and are independently citable |
| [SMART Servier](https://smart.servier.com/) | CC BY 4.0 | ~3,000 medical, but **PPTX/PNG only** — no SVG, so not directly usable |

Whatever lands in the app appears in the **⚖ Credits** panel, which generates the
attribution paragraph and writes `CREDITS.txt` into the submission package. The licence
allowlist is asserted by `tests/v312.spec.js`, so a pack that violates it fails the build
rather than reaching a user.

`bioicons-ccby-pack.json` is the second shipped tranche (41 icons, v3.13.0):
Servier Medical Art (CC-BY-3.0) and DBCLS (CC-BY-4.0) — attribution-required artwork
that was deliberately excluded from the first import until the ⚖ Credits machinery
existed to honour it. Same regeneration command, same review-then-paste workflow.
