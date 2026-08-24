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
  cleanup. That cap suits line art; illustrations need a larger one, which is why the BioArt
  import below carries its own.

It writes an `Object.assign(SCIENCE_ICONS, {…})` block. **It does not touch
`figure_lab.html`** — a human reviews the artwork and the licence claims and pastes it in.
Automating that would mean shipping art nobody looked at, under licences nobody checked.


## build-bioart.mjs — the NIH BioArt import

```bash
node tools/build-bioart.mjs --max-id 760 --cap 32768 \
     --out tools/bioart-pack.js --index tools/bioart-index.js
```

BioArt needs its own script because, unlike Bioicons, there is nothing to hand-curate from.
It has no manifest and no public search API — the site's search runs through Next.js server
actions — and its file endpoint sends no CORS header, so **nothing about this can happen at
runtime in the browser**. What it does have is crawlable asset pages at `/bioart/{id}` and
provenance embedded in the artwork itself. The script reads both. It reuses `normalise()`
from `build-icons.mjs`, and like that script it **does not write into `figure_lab.html`**.

- **Crawls** `/bioart/1..maxId`, parsing each page for its `filemapping` (format → file id;
  there is no way to construct a file URL without it), its category and its licence badge.
- **Picks one colour variant per id** — several share an id and only one can ship. BioArt's
  own catalogue thumbnail wins, then a colour rendering over a greyscale one.
- **Reads the licence from the asset, not from the site.** Most SVGs carry
  `<metadata><license>…</license><creator>…</creator><credit>…</credit></metadata>`; the ones
  exported straight out of Illustrator carry nothing, so the page's licence badge is the
  fallback. Neither present is a skip. BioArt is *mostly* Public Domain, not uniformly —
  28 of 714 are CC BY 4.0 — and defaulting would hand a user someone else's problem.
- **Caps each asset** (default 32 KB after cleanup) and writes everything above the cap to a
  **name-only catalogue index** instead. This is the whole design of the import, and it is a
  curation problem rather than a compression one: BioArt SVGs run 1 KB to 8.6 MB, minifying
  raw path data recovers only 5–30%, and inlining all ~2,000 would be about **140 MB**. The
  app searches the index alongside the placed icons and links out; a downloaded file dropped
  back in is recognised from its own metadata and credited, so nothing is out of reach.
- **Caches every response** under `tools/.bioart-cache/` (gitignored) and throttles to 4
  concurrent requests ~150 ms apart. A full pass is ~1,100 requests against a `.gov` host;
  the cache means you only do it once. Dead ids answer 500 and are cached as misses too.
- **Derives** the label from the page heading (the SVG `<title>` loses word breaks —
  "Ixodesscapularis", "Diploid Chromosomewith Barr Body"), keywords from title + description
  + category, and placement size from the `viewBox` aspect ratio.

Every entry is emitted `mono:false`: these are full-colour illustrations, and forcing the
recolour sentinel onto one flattens it to a silhouette.

### The namespace trap, again

`build-icons.mjs` already warned that stripping prefixed elements is how you lose icons
silently. BioArt is the same trap one level up: it serialises whole documents as
`<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg">`, a prefix bound to the **SVG namespace
itself**. The foreign-namespace rule matched the *root element* and deleted every asset
whole — a clean run, a plausible-looking output file, and 400 blank images.

`normalise()` now reads the root's prefix→URI map and unprefixes anything bound to the SVG
namespace before removing what is genuinely foreign. It also promotes `xlink:href` to plain
`href` rather than stripping it, which had been discarding embedded rasters. Both failures
look fine as text, so `tests/bioart.spec.js` rasterises a sample of the pack and fails on
blank output. That test is the only thing that can actually see this class of bug.

### Where to source

| Source | Licence | Notes |
|---|---|---|
| [Bioicons](https://bioicons.com/) | per-icon (CC0/MIT/CC-BY) | ~2,800 SVGs; each declares its own licence — read it per icon, not per site |
| [NIH BioArt](https://bioart.niaid.nih.gov/) | Public Domain (686 of 714 crawled); the rest CC BY 4.0 | ~2,000 across ~714 ids, professionally vetted, SVG/EPS/AI/PNG. Imported — see `build-bioart.mjs` above |
| [SciDraw](https://scidraw.io/) | CC BY 4.0 | many carry a Zenodo DOI and are independently citable |
| [SMART Servier](https://smart.servier.com/) | CC BY 4.0 | ~3,000 medical, but **PPTX/PNG only** — no SVG, so not directly usable |

Whatever lands in the app appears in the **⚖ Credits** panel, which generates the
attribution paragraph and writes `CREDITS.txt` into the submission package. The licence
allowlist is asserted by `tests/v312.spec.js` and `tests/bioart.spec.js`, so a pack that
violates it fails the build rather than reaching a user.
