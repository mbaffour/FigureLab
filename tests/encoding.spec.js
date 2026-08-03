// @ts-check
// Source-file encoding guard.
//
// Why this exists: cutting v3.9.4 I edited the app, the README and CITATION.cff
// through a PowerShell round-trip. Windows PowerShell 5.1 reads a BOM-less UTF-8
// file as ANSI, so `Get-Content -Raw` handed back every non-ASCII character as its
// individual bytes, and `Set-Content -Encoding utf8` then re-encoded those bytes as
// UTF-8 -- double-encoding every em-dash, arrow, micron sign and emoji in the file
// and prepending a BOM. It touched ~1300 lines of figure_lab.html, including
// user-facing strings, and it committed and pushed cleanly because nothing checks.
//
// The tests still passed: mojibake is valid UTF-8, the page parses, and no assertion
// looked at the bytes. So a behavioural suite cannot catch this class of damage --
// only a byte-level check can, which is what this file is.
//
// This file necessarily contains the non-ASCII characters it reasons about, so it is
// vulnerable to the same corruption it detects -- a mangled CP1252 table would make
// the detector match nothing and pass everything. The first test guards against that
// by round-tripping a known string through the corruption and asserting the detector
// catches it, so a broken table fails loudly instead of going quiet.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Text files whose bytes we control and where a user or a citation parser would
// see the damage. Binary assets and vendored files are deliberately excluded.
const TEXT_FILES = ['figure_lab.html', 'README.md', 'CITATION.cff', 'index.html'];

const read = f => fs.readFileSync(path.join(ROOT, f));

// 0x80-0x9F is the range where CP1252 differs from Latin-1, and it is where most of
// the damage lands. Node has no CP1252 decoder, so the mapping is spelled out.
// 0x81, 0x8D, 0x8F, 0x90 are unassigned and must stay absent -- packing them out
// shifts every later entry, which is a mistake I made in the first draft of this
// file and which quietly reduced the detector to catching one character.
const CP1252_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„',
  0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ',
  0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
  0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
};

/**
 * What `ch` looks like after its UTF-8 bytes are decoded as CP1252 and re-encoded.
 * Derived rather than hand-typed: transcribing these sequences by eye is how you
 * end up with a guard that silently matches nothing.
 */
function mojibakeOf(ch) {
  return [...Buffer.from(ch, 'utf8')]
    .map(b => (b >= 0x80 && b <= 0x9F)
      ? (CP1252_HIGH[b] || '�')   // unassigned byte -> decoder emits U+FFFD
      : String.fromCharCode(b))
    .join('');
}

// Characters this repo genuinely contains, so a hit names the culprit rather than
// just reporting that something somewhere is wrong.
const WATCHED = [
  ['—', 'em dash'],            ['–', 'en dash'],
  ['’', 'apostrophe'],         ['“', 'left quote'],
  ['→', 'right arrow'],        ['µ', 'micron sign'],
  ['×', 'multiplication sign'], ['─', 'box-drawing rule'],
  ['✂', 'scissors'],           ['✨', 'sparkles'],
  ['⊞', 'squared plus'],       ['°', 'degree sign'],
];

test('the mojibake detector actually detects mojibake', () => {
  // A guard nobody has seen fail is a guard nobody knows works.
  //
  // The fixture is not simulated -- it is twelve lines lifted verbatim from the
  // README as it existed in commit c1cbb81, i.e. the real damage from the real
  // incident. That matters: the first version of this test synthesised the
  // corruption with Buffer.toString('latin1') and failed, because Latin-1 and
  // CP1252 disagree over 0x80-0x9F and PowerShell used CP1252. Simulating the bug
  // tests my model of the bug; the fixture tests the bug.
  const broken = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'mojibake-sample.txt')).toString('utf8');

  for (const ch of ['—', '×', '✨']) {
    expect(broken, `detector missed a genuinely corrupted ${JSON.stringify(ch)} ` +
      `-- CP1252_HIGH is probably wrong`).toContain(mojibakeOf(ch));
  }
  // ...and does not fire on the same characters intact.
  const clean = 'a — b µm ×3 → ─ ✨';
  for (const ch of ['—', '×', '✨', 'µ', '→', '─']) {
    expect(clean, `detector false-positives on a clean ${JSON.stringify(ch)}`)
      .not.toContain(mojibakeOf(ch));
  }
});

for (const f of TEXT_FILES) {
  test(`${f} is UTF-8 with no double-encoded characters`, () => {
    const txt = read(f).toString('utf8');
    const hits = [];
    for (const [ch, name] of WATCHED) {
      const n = txt.split(mojibakeOf(ch)).length - 1;
      if (n) hits.push(`${name} x${n}`);
    }
    expect(hits, `${f} contains mojibake -- it was almost certainly round-tripped ` +
      `through a tool that decoded UTF-8 as ANSI. Restore the file from git and ` +
      `re-apply the edit with a UTF-8-aware editor.`).toEqual([]);
  });

  test(`${f} has no UTF-8 BOM`, () => {
    const buf = read(f);
    const hasBOM = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    expect(hasBOM, `${f} starts with a UTF-8 BOM. figure_lab.html must open with ` +
      `"<!DOCTYPE html>" at byte 0, and a BOM in a .cff breaks strict YAML parsers.`)
      .toBe(false);
  });

  test(`${f} decodes as strict UTF-8`, () => {
    // Node substitutes U+FFFD for any byte sequence that is not valid UTF-8, so a
    // replacement character means the file is not the encoding it claims to be --
    // a different failure from mojibake, and worth naming separately.
    const bad = (read(f).toString('utf8').match(/�/g) || []).length;
    expect(bad, `${f} has ${bad} byte sequence(s) that are not valid UTF-8.`).toBe(0);
  });
}

test('the app declares the UTF-8 charset it is written in', () => {
  // Without this meta, a file:// load falls back to the browser locale's default
  // encoding and every micron sign in the UI renders as mojibake on the user's
  // screen even though the bytes on disk are correct.
  const html = read('figure_lab.html').toString('utf8');
  expect(html.slice(0, 2000)).toMatch(/<meta\s+charset\s*=\s*["']?utf-8/i);
});

test('the version is stated identically in the app, the README and CITATION.cff', () => {
  // These three are bumped together at release time, so a mismatch means a
  // half-applied release -- the state the repo was in between two commits today.
  const app = read('figure_lab.html').toString('utf8')
    .match(/const APP_VERSION = '([^']+)'/);
  const readme = read('README.md').toString('utf8').match(/^# FigureLab v(\S+)/m);
  const cff = read('CITATION.cff').toString('utf8').match(/^version: "([^"]+)"/m);

  expect(app, 'APP_VERSION not found in figure_lab.html').toBeTruthy();
  expect(readme, 'version heading not found in README.md').toBeTruthy();
  expect(cff, 'version field not found in CITATION.cff').toBeTruthy();

  expect({ readme: readme[1], cff: cff[1] })
    .toEqual({ readme: app[1], cff: app[1] });
});

test('CITATION.cff records a DOI for the version it claims to be', () => {
  // A release that mints a Zenodo DOI but forgets to record it leaves the archive
  // uncitable by version -- the exact thing CITATION.cff exists to prevent.
  const cff = read('CITATION.cff').toString('utf8');
  const version = cff.match(/^version: "([^"]+)"/m)[1];
  const described = [...cff.matchAll(/description: "Version ([\d.]+)"/g)].map(m => m[1]);
  expect(described, `CITATION.cff has no identifier entry for the current version ` +
    `(${version}). Add the version DOI Zenodo minted for this release.`)
    .toContain(version);
});
