#!/usr/bin/env node
// NIH BioArt Source importer for FigureLab — DEV ONLY, never shipped in the HTML.
//
//   node tools/build-bioart.mjs --max-id 760 --cap 32768 \
//        --out tools/bioart-pack.js --index tools/bioart-index.js
//
// BioArt (https://bioart.niaid.nih.gov/) is ~2,000 professionally drawn science visuals
// from NIAID, almost all Public Domain. Unlike Bioicons it has no hand-curated manifest and
// no public search API — the site's search runs through Next.js server actions, and the
// file endpoint sends no CORS header, so nothing here can happen at runtime in the browser.
// What it does have is stable, crawlable asset pages and metadata embedded in the artwork
// itself. This script reads both and does the mechanical part of the import.
//
// Two things it will NOT do, both on purpose:
//
//   · It does not write into figure_lab.html. A human reviews the artwork and the licence
//     claims and pastes the blocks in, exactly as with build-icons.mjs.
//   · It does not assume Public Domain. BioArt is *mostly* PD, not uniformly so, and the
//     licence is read from each file. Anything else is skipped and logged.
//
// ── Why there is a size cap ─────────────────────────────────────────────────────────────
// BioArt SVGs run from 1 KB of line art to 8.6 MB of painterly rendering; the median is
// ~28 KB. Inlining the whole catalogue would be ~140 MB, which is not a single file anybody
// can open, let alone email. Minifying does not rescue it either — this is raw path data,
// and cleanup recovers only 5-30%. So the cap is the design: everything under it ships
// inline, and everything over it goes into a name-only catalogue index that the app uses to
// point the user at the download page. A dropped BioArt file is recognised and credited on
// import, so the excluded assets remain fully usable — they just are not carried in the box.

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalise } from './build-icons.mjs';

const BASE = 'https://bioart.niaid.nih.gov';
const CACHE = 'tools/.bioart-cache';

// Mirrors ICON_LICENSES_ALLOWED in figure_lab.html, same contract as build-icons.mjs.
const ALLOWED = ['CC0-1.0', 'MIT', 'CC-BY-3.0', 'CC-BY-4.0', 'public-domain'];
const NEEDS_ATTR = ['CC-BY-3.0', 'CC-BY-4.0'];
// BioArt writes its licence as prose in the SVG's <metadata>. Only strings that map to
// something in ALLOWED get through; an unrecognised one is a skip, never a default.
const LICENCE_MAP = {
  'public domain': 'public-domain',
  'cc0': 'CC0-1.0',
  'cc0 1.0': 'CC0-1.0',
  'cc by 4.0': 'CC-BY-4.0',
  'cc-by-4.0': 'CC-BY-4.0',
};

// BioArt's own taxonomy → FigureLab's ICON_GROUPS. Kept here rather than in the app so the
// whole mapping is reviewable in one place; the app only ever sees the resolved group.
const GROUP_MAP = {
  'anatomy': 'anatomy',
  'animals': 'organism',
  'arthropods': 'organism',
  'bacteria': 'microbe',
  'brushes': 'marks',
  'cells and organelles': 'cell',
  'cellular processes': 'cell',
  'equipment': 'labware',
  'fungi': 'microbe',
  'molecules': 'molecule',
  'parasites': 'microbe',
  'people': 'people',
  'plants': 'organism',
  'proteins': 'molecule',
  'shapes': 'marks',
  'swatches': 'marks',
  'viruses': 'microbe',
};

const STOPWORDS = new Set(['a', 'an', 'and', 'the', 'of', 'with', 'in', 'on', 'to', 'for',
  'from', 'by', 'is', 'are', 'this', 'that', 'its', 'it', 'as', 'or', 'at', 'colored',
  'color', 'colour', 'coloured', 'illustration', 'image', 'shown', 'showing', 'depicting']);

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};

// ── Fetching ────────────────────────────────────────────────────────────────────────────
// This is a .gov host being walked ~1,100 times and there is no hurry. Everything is cached
// on disk so a re-run costs nothing, and live requests are throttled hard.

let liveFetches = 0;

async function cached(key, url, { binary = false } = {}) {
  const file = path.join(CACHE, key);
  try { return await fs.readFile(file, binary ? null : 'utf8'); } catch { /* miss */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const r = await fetch(url);
  liveFetches++;
  if (!r.ok) {
    // Dead ids answer 500, and there are a lot of them. Cache the miss too, so a re-run
    // does not walk the gaps again.
    await fs.writeFile(file + '.miss', String(r.status), 'utf8');
    throw new Error(`HTTP ${r.status}`);
  }
  const body = binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  await fs.writeFile(file, body);
  return body;
}

async function cachedOrMiss(key, url, opts) {
  try { await fs.access(path.join(CACHE, key + '.miss')); return null; } catch { /* not a known miss */ }
  try { return await cached(key, url, opts); } catch { return null; }
}

// Run `jobs` with a bounded worker pool and a small delay between live requests.
async function pool(items, workers, delayMs, fn) {
  const queue = [...items.entries()];
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [i, item] = next;
      const before = liveFetches;
      out[i] = await fn(item, i);
      if (liveFetches > before && delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
  }));
  return out;
}

// ── Parsing ─────────────────────────────────────────────────────────────────────────────

// Asset pages are server-rendered React payloads, so the data is present as escaped JSON in
// the HTML rather than behind an API call. Two things are needed from it: the format→fileId
// map (there is no way to construct a file URL without it) and the site's own category.
function parseFileMapping(html) {
  const m = html.match(/"filemapping\\?":\\?\{(.*?)\}\\?\}/s);
  if (!m) return [];
  const groups = [...m[0].matchAll(/\\?"(\d+)\\?":\\?\{(.*?)\}/g)];
  return groups.map(g => {
    const files = {};
    for (const f of g[2].matchAll(/\\?"([A-Z]+)\\?":(\d+)/g)) files[f[1]] = +f[2];
    return { colorGroup: g[1], files };
  }).filter(g => g.files.SVG);
}

// BioArt's SVG <title> is machine-generated and loses word breaks ("Ixodesscapularis",
// "Diploid Chromosomewith Barr Body"). The page heading is the human-written name, so it
// wins where it exists — a label nobody can spell is a label nobody can search for.
function parseTitle(html) {
  const m = html.match(/<h4[^>]*>([^<]{2,80})<\/h4>/);
  return m ? m[1].trim() : '';
}

// Roughly a quarter of BioArt's SVGs — the ones exported straight out of Illustrator — carry
// no <metadata> block at all, so the licence has to come from the asset page instead. It is
// stated in two places there: the licence badge image, and the prose link beside it. Reading
// the page rather than assuming Public Domain is what keeps the 28 CC-BY assets in the
// catalogue honest.
function parseLicence(html) {
  const at = html.indexOf('Licensing');
  if (at < 0) return '';
  const seg = html.slice(at, at + 700);
  const badge = seg.match(/\/images\/licenses\/([\w-]+)\.png/);
  if (badge) {
    if (/^cc-by$/i.test(badge[1])) return 'CC-BY-4.0';
    if (/^cc0$/i.test(badge[1])) return 'CC0-1.0';
  }
  if (/>\s*Public Domain\s*</.test(seg)) return 'public-domain';
  if (/creativecommons\.org\/licenses\/by\/4\.0/.test(seg)) return 'CC-BY-4.0';
  if (/creativecommons\.org\/publicdomain/.test(seg)) return 'CC0-1.0';
  return '';
}

// BioArt prescribes its own citation, and the name it opens with is the attributable party —
// usually NIAID's art unit, sometimes an outside contributor. A CC-BY asset cannot ship
// without one, so this is what fills lic.author when the artwork itself does not say.
function parseCiteAuthor(html) {
  const m = html.match(/Cite This Entry<\/h6><h6[^>]*>([\s\S]{2,80}?)<!-- -->\./);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
}

function parseCategory(html) {
  // The category is in the rendered markup rather than the RSC payload: a "Category:"
  // heading immediately followed by a sibling heading holding the value. Multi-category
  // assets come through as one comma-separated string ("Proteins, Molecules").
  const m = html.match(/>Category:<\/h6>\s*<h6[^>]*>([^<]{2,80})<\/h6>/);
  return m ? m[1].trim() : '';
}

// The artwork carries its own provenance — title, description, licence, illustrator, credit
// line — which is why the labels and keywords below are read rather than invented.
function parseSvgMeta(svg) {
  const tag = n => {
    const m = svg.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i'));
    return m ? m[1].replace(/<[^>]*>/g, '').trim() : '';
  };
  return {
    title: tag('title'),
    description: tag('description') || tag('caption'),
    license: tag('license'),
    creator: tag('creator'),
    credit: tag('credit'),
    imageColor: tag('imageColor'),
    isThumb: /true/i.test(tag('isDiscoverThumbnail')),
  };
}

// A stable, collision-free JS identifier from a human title.
function keyFor(title, id, used) {
  let base = 'ba_' + (title || 'asset').replace(/[^A-Za-z0-9]+/g, ' ').trim()
    .split(/\s+/).map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())
    .join('').slice(0, 40);
  if (/^ba_\d/.test(base) || base === 'ba_') base = 'ba_a' + base.slice(3);
  let k = base;
  if (used.has(k)) k = `${base}${id}`;      // same title, different asset — id disambiguates
  used.add(k);
  return k;
}

function keywordsFor(title, description, category) {
  const words = `${title} ${description} ${category}`.toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 14).join(' ');
}

// Placement size: BioArt viewBoxes vary wildly, so normalise the longest side and keep the
// aspect ratio. 140px matches the scale the existing illustration icons place at.
function sizeFor(svg) {
  const vb = svg.match(/viewBox="([\d.\-\s]+)"/);
  let w = 100, h = 100;
  if (vb) {
    const p = vb[1].trim().split(/\s+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; }
  }
  const s = 140 / Math.max(w, h);
  return { w: Math.max(20, Math.round(w * s)), h: Math.max(20, Math.round(h * s)) };
}

// ── Main ────────────────────────────────────────────────────────────────────────────────

async function main() {
  const maxId = +arg('--max-id', 760);
  const cap = +arg('--cap', 32768);
  const outPath = arg('--out', 'tools/bioart-pack.js');
  const indexPath = arg('--index', 'tools/bioart-index.js');
  const budget = +arg('--budget', 8 * 1024 * 1024);

  const ids = Array.from({ length: maxId }, (_, i) => i + 1);
  console.log(`crawling ${BASE}/bioart/1..${maxId} (cache: ${CACHE})`);

  const assets = await pool(ids, 4, 150, async id => {
    const html = await cachedOrMiss(`page/${id}.html`, `${BASE}/bioart/${id}`);
    if (!html) return null;
    const variants = parseFileMapping(html);
    if (!variants.length) return null;
    const category = parseCategory(html);
    const pageTitle = parseTitle(html);
    const pageLicence = parseLicence(html);
    const pageAuthor = parseCiteAuthor(html);

    // Several colour variants share one id and only one can ship. Prefer the one BioArt
    // itself shows as the catalogue thumbnail; failing that a colour rendering over a
    // greyscale one, since FigureLab's own set already covers single-colour line art and an
    // illustration is what this import is for.
    let chosen = null, chosenRank = -1;
    for (const v of variants) {
      const svg = await cachedOrMiss(`svg/${id}-${v.files.SVG}.svg`, `${BASE}/api/bioarts/${id}/files/${v.files.SVG}`);
      if (!svg) continue;
      const meta = parseSvgMeta(svg);
      const rank = meta.isThumb ? 2 : (/black|white|gray|grey/i.test(meta.imageColor) ? 0 : 1);
      if (rank > chosenRank) { chosen = { id, svg, meta, category, pageTitle, pageLicence, pageAuthor }; chosenRank = rank; }
      if (rank === 2) break;
    }
    return chosen;
  });

  const found = assets.filter(Boolean);
  console.log(`found ${found.length} assets across ${maxId} ids (${liveFetches} live fetches)`);

  const kept = [], oversize = [], skipped = [];
  const usedKeys = new Set();

  for (const a of found) {
    // The artwork's own claim wins; the page is the fallback for files exported without a
    // <metadata> block. Neither one present is a skip, never a default.
    const spdx = LICENCE_MAP[(a.meta.license || '').toLowerCase().trim()] || a.pageLicence;
    if (!spdx || !ALLOWED.includes(spdx)) {
      skipped.push([a.id, `licence not in allowlist: ${a.meta.license || a.pageLicence || '(none)'}`]);
      continue;
    }
    // Same rule the app and build-icons.mjs enforce: an attribution licence without someone
    // to attribute cannot be used, so it is dropped rather than shipped uncreditable. The
    // generic fallback below is fine for Public Domain, where the credit is a courtesy — it
    // is NOT an acceptable stand-in for a CC-BY author, so that case is checked first.
    const named = a.meta.creator || a.pageAuthor;
    if (NEEDS_ATTR.includes(spdx) && !named) {
      skipped.push([a.id, `${spdx} with no attributable author`]);
      continue;
    }
    const author = named || 'NIAID Visual & Medical Arts';
    const label = a.pageTitle || a.meta.title || `BioArt ${a.id}`;
    const keys = keywordsFor(`${label} ${a.meta.title}`, a.meta.description, a.category);
    const group = GROUP_MAP[(a.category || '').toLowerCase().split(',')[0].trim()] || 'cell';
    const entry = { id: a.id, label, keys, group, cat: a.category };

    // mono:false always — these are full-colour illustrations. Forcing the recolour sentinel
    // onto one flattens the artwork to a silhouette, which is worse than not offering it.
    const svg = normalise(a.svg, { mono: false });
    if (svg.length > cap) { oversize.push(entry); continue; }

    const { w, h } = sizeFor(svg);
    kept.push({
      ...entry, w, h, svg,
      key: keyFor(label, a.id, usedKeys),
      lic: {
        spdx,
        author,
        src: `${BASE}/bioart/${a.id}`,
        // Public Domain requires no attribution; NIAID asks for this line as a courtesy and
        // the Credits panel offers it as exactly that, never as an obligation.
        credit: a.meta.credit || 'Courtesy of NIAID',
      },
    });
  }

  kept.sort((x, y) => x.key.localeCompare(y.key));
  oversize.sort((x, y) => x.label.localeCompare(y.label));

  const lines = kept.map(i =>
    `  ${i.key}:{label:${JSON.stringify(i.label)},group:${JSON.stringify(i.group)},` +
    `keys:${JSON.stringify(i.keys)},w:${i.w},h:${i.h},mono:false,` +
    `lic:${JSON.stringify(i.lic)},svg:${JSON.stringify(i.svg)}},`);

  const pack =
    `// ═══ NIH BIOART PACK (generated by tools/build-bioart.mjs — do not hand-edit) ═══\n` +
    `// ${kept.length} Public Domain illustrations from https://bioart.niaid.nih.gov/,\n` +
    `// imported at a ${(cap / 1024) | 0} KB per-asset cap. Every entry declares the licence read from its\n` +
    `// own <metadata>, and carries NIAID's courtesy credit line for the Credits panel.\n` +
    `// Full-colour artwork, so every entry is mono:false and declines recolouring.\n` +
    `Object.assign(SCIENCE_ICONS, {\n${lines.join('\n')}\n});\n`;

  const idxLines = oversize.map(i =>
    `  {id:${i.id},label:${JSON.stringify(i.label)},keys:${JSON.stringify(i.keys)},cat:${JSON.stringify(i.cat)}},`);
  const index =
    `// ═══ NIH BIOART CATALOGUE (generated by tools/build-bioart.mjs — do not hand-edit) ═══\n` +
    `// The ${oversize.length} Public Domain assets too large to inline (over the ${(cap / 1024) | 0} KB cap): name and\n` +
    `// keywords only, no artwork. The palette searches these alongside the placed icons and\n` +
    `// links out to the download page; a downloaded file dropped back in is recognised and\n` +
    `// credited automatically, so nothing here is out of reach — it just is not in the box.\n` +
    `const BIOART_INDEX=[\n${idxLines.join('\n')}\n];\n`;

  await fs.writeFile(outPath, pack, 'utf8');
  await fs.writeFile(indexPath, index, 'utf8');

  const packBytes = Buffer.byteLength(pack, 'utf8');
  const idxBytes = Buffer.byteLength(index, 'utf8');
  console.log(`\nkept ${kept.length} inline, ${oversize.length} catalogue-only, ${skipped.length} skipped`);
  for (const [id, why] of skipped.slice(0, 40)) console.log(`  skip ${id}: ${why}`);
  if (skipped.length > 40) console.log(`  … and ${skipped.length - 40} more`);

  const byGroup = {};
  for (const k of kept) byGroup[k.group] = (byGroup[k.group] || 0) + 1;
  console.log('\nby group:', Object.entries(byGroup).sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g}=${n}`).join(' '));

  console.log(`\n${outPath}:   ${(packBytes / 1024 / 1024).toFixed(2)} MB of ${(budget / 1024 / 1024).toFixed(1)} MB budget`);
  console.log(`${indexPath}: ${(idxBytes / 1024).toFixed(1)} KB (${oversize.length} entries)`);
  if (packBytes > budget) {
    console.error('OVER BUDGET — lower --cap before pasting this in.');
    process.exit(1);
  }
  console.log('\nReview the artwork and the licence claims, then paste both blocks into figure_lab.html.');
}

main().catch(e => { console.error(e); process.exit(1); });
