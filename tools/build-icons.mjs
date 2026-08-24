#!/usr/bin/env node
// Icon-pack curation for FigureLab — DEV ONLY, never shipped in the HTML.
//
// FigureLab's own icons are drawn in-file and MIT-licensed with the app. This tool is
// for importing third-party packs (Bioicons, NIH BioArt) without importing a licensing
// problem: it filters by licence, rejects share-alike outright, requires attribution
// metadata where the licence demands it, and emits a paste-ready block.
//
// It deliberately does NOT write into figure_lab.html. A human reviews the emitted
// block — both the artwork and the licence claims — and pastes it in. Automating that
// step would mean shipping art nobody looked at.
//
//   node tools/build-icons.mjs --manifest tools/pack.json --out tools/out.js
//
// The manifest is a list of {url, name, label, group, keys, license:{spdx,author,src}}.
// Building it is the curation work; this script is the mechanical part.

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Mirrors ICON_LICENSES_ALLOWED in figure_lab.html. A test in tests/v312.spec.js
// asserts the app never contains anything outside this set, so the two cannot drift
// without something going red.
const ALLOWED   = ['CC0-1.0', 'MIT', 'CC-BY-3.0', 'CC-BY-4.0', 'public-domain'];
const NEEDS_ATTR = ['CC-BY-3.0', 'CC-BY-4.0'];
// Share-alike is excluded on purpose: it can be read as reaching the figure the icon is
// placed into, which is not a risk to hand an author about to submit a manuscript.
const REJECTED  = ['CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'GPL-3.0', 'CC-BY-NC-4.0'];

const BUDGET_BYTES = 400 * 1024;   // the whole pack, inlined

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Rewrite elements that are in the SVG namespace under a prefix back to plain tags.
 *
 * Only prefixes the ROOT element binds to the SVG namespace are touched; a prefix bound to
 * anything else is left exactly as it was, for the foreign-namespace strip to remove.
 */
function unprefixSvgNs(svg) {
  const root = svg.match(/<([a-zA-Z][\w-]*:)?svg\b[^>]*>/);
  if (!root) return svg;
  const prefixes = [...root[0].matchAll(/xmlns:([\w-]+)="([^"]*)"/g)]
    .filter(m => m[2] === SVG_NS).map(m => m[1]);
  if (!prefixes.length) return svg;
  let out = svg;
  for (const p of prefixes) {
    out = out.replace(new RegExp(`<${p}:([\\w-]+)`, 'g'), '<$1')
             .replace(new RegExp(`</${p}:([\\w-]+)`, 'g'), '</$1');
  }
  // The declarations are now unused, and the document needs a default namespace instead —
  // an SVG served without one is not an SVG as far as the browser is concerned.
  const hasDefault = /\sxmlns="/.test(root[0]);
  for (const p of prefixes) {
    out = out.replace(new RegExp(`\\s+xmlns:${p}="[^"]*"`), hasDefault ? '' : ` xmlns="${SVG_NS}"`);
    break;   // only the first needs promoting; drop the rest
  }
  for (const p of prefixes) out = out.replace(new RegExp(`\\s+xmlns:${p}="[^"]*"`, 'g'), '');
  return out;
}

/**
 * Strip an SVG down to what FigureLab can inline.
 *
 * The namespace handling is the fiddly part and it is not optional. Editor exports
 * (Inkscape especially) carry elements in their own namespaces — `<sodipodi:namedview/>`,
 * `<inkscape:*>`, RDF metadata. Dropping the matching `xmlns:` declarations while leaving
 * one of those elements behind produces an undeclared prefix, which is an XML parse
 * ERROR: the image fails to load entirely rather than rendering imperfectly. Prefixed
 * elements must therefore go first, in BOTH paired and self-closing form.
 * (Getting this wrong silently killed 23 of 86 icons on the first import run — they
 * looked fine as text and rendered as nothing.)
 *
 * But a prefix is not automatically foreign, and that distinction has to be drawn BEFORE
 * anything is deleted. NIH BioArt serialises its whole document in a prefix bound to the
 * SVG namespace itself — `<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg">` — so the
 * paired-prefix rule below matches the ROOT element and takes the entire artwork with it.
 * `unprefixSvgNs` therefore runs first: it reads the root's prefix→URI map, rewrites every
 * prefix bound to the SVG namespace back to plain tags, and promotes one declaration to a
 * default `xmlns=`. Only genuinely foreign prefixes survive to be stripped. Same failure
 * mode as the Inkscape case — a valid-looking string that renders as nothing — one level up.
 *
 * `id` and `class` are deliberately NOT stripped, though both look like removable noise:
 *   · gradients, clip paths and masks are referenced by `url(#id)`;
 *   · most illustration exports put their colours in a `<style>` block keyed on
 *     `.cls-N` and carry no inline fills at all, so dropping `class` severs every rule
 *     and the artwork renders as flat black silhouettes.
 * Both failures are silent — the SVG still parses and still draws something.
 *
 * Pass `mono:true` only for genuine single-colour line art. Forcing the sentinel onto a
 * full-colour illustration flattens it to a silhouette.
 */
export function normalise(svg, { key = '#222222', mono = false } = {}) {
  let s = unprefixSvgNs(svg)
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<([a-zA-Z][\w-]*):([\w-]+)[\s\S]*?<\/\1:\2>/g, '')   // paired prefixed
    .replace(/<[a-zA-Z][\w-]*:[\w-]+\b[^>]*\/>/g, '')              // self-closing prefixed
    .replace(/<(metadata|title|desc)[\s\S]*?<\/\1>/g, '')
    .replace(/<(metadata|title|desc)\b[^>]*\/>/g, '')
    // `xlink:href` is the one prefixed attribute that carries content rather than editor
    // state — embedded rasters and <use> targets hang off it. The strip below would take it
    // silently, so promote it to the plain SVG2 `href` first. (Only where there is no `href`
    // already; when both are present the unprefixed one wins in every current browser.)
    .replace(/(<[^>]*?)\sxlink:href=("[^"]*")/g, (m, head, val) => /\shref=/.test(head) ? head : `${head} href=${val}`)
    // surviving prefixed ATTRIBUTES, then their declarations (order matters)
    .replace(/\s+(?!xmlns:)[a-zA-Z][\w-]*:[\w-]+="[^"]*"/g, '')
    .replace(/\s+xmlns:[\w-]+="[^"]*"/g, '')
    .replace(/\s+data-[\w-]+="[^"]*"/g, '')
    .replace(/(\d+\.\d{3,})/g, m => (+m).toFixed(2))               // trim coordinate noise
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (mono) {
    // FigureLab recolours single-colour icons by substituting a sentinel, so every
    // explicit fill/stroke has to become that sentinel or it will ignore the picker.
    s = s.replace(/(fill|stroke)="(?!none)[^"]*"/g, `$1="${key}"`)
         .replace(/currentColor/g, key);
  }
  return s;
}

async function main() {
  const manifestPath = arg('--manifest');
  const outPath = arg('--out', 'tools/out.js');
  if (!manifestPath) {
    console.error('usage: node tools/build-icons.mjs --manifest <file.json> [--out <file.js>]');
    process.exit(2);
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const kept = [], skipped = [];
  for (const item of manifest) {
    const spdx = item.license?.spdx;
    if (REJECTED.includes(spdx)) { skipped.push([item.name, `rejected licence ${spdx}`]); continue; }
    if (!ALLOWED.includes(spdx)) { skipped.push([item.name, `unknown licence ${spdx || '(none)'}`]); continue; }
    // A CC-BY icon without an author cannot be attributed, so it cannot be used.
    if (NEEDS_ATTR.includes(spdx) && !(item.license.author && item.license.src)) {
      skipped.push([item.name, `${spdx} needs license.author and license.src`]); continue;
    }
    let svg;
    try {
      const r = await fetch(item.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      svg = normalise(await r.text(), { mono: !!item.mono });
    } catch (e) { skipped.push([item.name, `fetch failed: ${e.message}`]); continue; }
    if (svg.length > 4096) { skipped.push([item.name, `too large after cleanup (${svg.length}B)`]); continue; }
    kept.push({ ...item, svg });
  }

  const lines = kept.map(i =>
    `  ${i.name}:{label:${JSON.stringify(i.label)},group:${JSON.stringify(i.group)},` +
    `keys:${JSON.stringify(i.keys || '')},w:${i.w || 100},h:${i.h || 100},` +
    `lic:${JSON.stringify(i.license)},svg:${JSON.stringify(i.svg)}},`);

  const block =
    `// ═══ ICON PACK (generated by tools/build-icons.mjs — do not hand-edit) ═══\n` +
    `// Reviewed on import: every entry declares its own licence, and the licence is in\n` +
    `// the app's allowlist. Attribution-required icons carry author + source, which the\n` +
    `// Credits panel turns into a paste-ready line.\n` +
    `Object.assign(SCIENCE_ICONS, {\n${lines.join('\n')}\n});\n`;

  await fs.writeFile(outPath, block, 'utf8');

  const bytes = Buffer.byteLength(block, 'utf8');
  console.log(`kept ${kept.length}, skipped ${skipped.length}`);
  for (const [n, why] of skipped) console.log(`  skip ${n}: ${why}`);
  console.log(`\n${outPath}: ${(bytes / 1024).toFixed(1)} KB of ${(BUDGET_BYTES / 1024)} KB budget`);
  if (bytes > BUDGET_BYTES) {
    console.error('OVER BUDGET — trim the manifest before pasting this in.');
    process.exit(1);
  }
  console.log('Review the artwork and the licence claims, then paste into figure_lab.html.');
}

// Importable as a module (tools/build-bioart.mjs reuses normalise) — only run the CLI when
// this file is what was actually invoked.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
