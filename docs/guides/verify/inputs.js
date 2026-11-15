// Synthetic, realistic inputs for the guide verification scripts. Deterministic: the same
// files every run. 16-bit TIFFs are written in Node; 8-bit photos are drawn on a canvas.
'use strict';
const fs = require('fs');
const path = require('path');
const { writeTiff16, rng, gauss, canvasImage } = require('./lib');

/**
 * A western blot scan: 16-bit, dark bands on a light membrane, a ladder in lane 1 and
 * `lanes` sample lanes, tilted by `tiltDeg`. amounts[i] scales the band in sample lane i.
 * Returns the file path. Ladder bands sit at fixed rows (sizes 75, 50, 37, 25 kDa).
 */
function blotTiff(file, { w = 900, h = 420, lanes = 6, amounts = [0.3, 1, 0, 0, 0.4, 1.6], bandY = 0.5, tiltDeg = 1.2, seed = 3, extraBand = null } = {}) {
  const r = rng(seed);
  const laneW = w / (lanes + 2), x0 = laneW * 0.6;
  const ladderY = [0.22, 0.38, 0.55, 0.74];
  const t = Math.tan(tiltDeg * Math.PI / 180), cx = w / 2;
  const noise = new Float32Array(w * h); for (let i = 0; i < noise.length; i++) noise[i] = gauss(r) * 350;
  return writeTiff16(file, w, h, (x, y) => {
    const yy = y - (x - cx) * t;                     // tilt
    let v = 52000 - y * 6;                            // light membrane, slight gradient
    for (let L = 0; L <= lanes; L++) {
      const lx = x0 + L * laneW * 1.0 + laneW * 0.1;
      const dx = (x - lx - laneW * 0.4) / (laneW * 0.36);
      if (Math.abs(dx) > 1.25) continue;
      const across = Math.exp(-Math.pow(Math.abs(dx), 6));
      const bands = L === 0 ? ladderY.map(f => [f, 0.6]) : [[bandY, amounts[L - 1]]].concat(extraBand ? [[extraBand, 0.5]] : []);
      for (const [f, a] of bands) {
        const dy = (yy - f * h) / 7;
        v -= 26000 * a * across * Math.exp(-dy * dy);
      }
    }
    return v + noise[y * w + x];
  });
}

/** A stain-free total-protein lane image: many bands per lane, equal loading. */
function totalProteinTiff(file, { w = 900, h = 420, lanes = 6, tiltDeg = 1.0, seed = 9 } = {}) {
  const r = rng(seed);
  const laneW = w / (lanes + 2), x0 = laneW * 0.6;
  const rows = Array.from({ length: 22 }, () => [0.08 + r() * 0.85, 0.2 + r() * 0.6]);
  const t = Math.tan(tiltDeg * Math.PI / 180), cx = w / 2;
  return writeTiff16(file, w, h, (x, y) => {
    const yy = y - (x - cx) * t;
    let v = 50000;
    for (let L = 1; L <= lanes; L++) {
      const lx = x0 + L * laneW + laneW * 0.1;
      const dx = (x - lx - laneW * 0.4) / (laneW * 0.36);
      if (Math.abs(dx) > 1.25) continue;
      const across = Math.exp(-Math.pow(Math.abs(dx), 6));
      v -= 6000 * across;
      for (const [f, a] of rows) { const dy = (yy - f * h) / 4; v -= 16000 * a * across * Math.exp(-dy * dy); }
    }
    return v + gauss(r) * 300;
  });
}

/**
 * One fluorescence channel, 16-bit, ImageJ-calibrated (µm/px). kind: 'DAPI' (nuclei),
 * 'GFP' (puncta in cytoplasm), 'CellMask' (membranes). gain scales the signal (for
 * conditions with different brightness); bg is the camera offset in counts.
 */
function fluorTiff(file, kind, { w = 512, h = 512, umPerPx = 0.108333, gain = 1, bg = 400, seed = 5 } = {}) {
  const r = rng(seed);
  const cells = Array.from({ length: 7 }, () => ({ x: 40 + r() * (w - 80), y: 40 + r() * (h - 80), rx: 38 + r() * 20, ry: 30 + r() * 18 }));
  const puncta = []; for (const c of cells) for (let k = 0; k < 14; k++) puncta.push({ x: c.x + gauss(r) * c.rx * 0.6, y: c.y + gauss(r) * c.ry * 0.6, a: 0.4 + r() });
  const rn = rng(seed + 100);
  return writeTiff16(file, w, h, (x, y) => {
    let s = 0;
    for (const c of cells) {
      const d = Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry);
      if (kind === 'DAPI') s += 9000 * Math.exp(-Math.pow(d / 0.42, 4));
      if (kind === 'CellMask') s += 7000 * Math.exp(-Math.pow((d - 1) / 0.08, 2));
      if (kind === 'GFP') s += 900 * Math.exp(-Math.pow(d / 0.95, 6));
    }
    if (kind === 'GFP') for (const p of puncta) { const dd = (x - p.x) ** 2 + (y - p.y) ** 2; if (dd < 60) s += 7000 * p.a * Math.exp(-dd / 6); }
    return bg + s * gain + gauss(rn) * 60;
  }, { umPerPx });
}

/**
 * A negative-stain TEM micrograph, 16-bit, with a 70-px black info strip at the bottom
 * holding a white `barPx`-long scale bar labelled "200 nm". Not calibrated in its tags,
 * as most microscope exports are not. True scale: nmPerPx.
 */
function temTiff(file, { w = 1024, h = 1024, nmPerPx = 0.5, barPx = 400, seed = 11 } = {}) {
  const r = rng(seed);
  const strip = 70;
  const virions = Array.from({ length: 4 }, (_, i) => ({ x: 180 + (i % 2) * 450 + r() * 80, y: 200 + Math.floor(i / 2) * 400 + r() * 60, a: r() * Math.PI * 2 }));
  // head 70 nm (140 px) across, tail 110 nm (220 px) long, 18 nm (36 px) wide at 0.5 nm/px
  const headR = 35 / nmPerPx, tailL = 110 / nmPerPx, tailW = 18 / nmPerPx;
  const rn = rng(seed + 1);
  return writeTiff16(file, w, h, (x, y) => {
    if (y >= h - strip) {
      const by = h - strip / 2;
      if (x >= 40 && x < 40 + barPx && Math.abs(y - by) <= 4) return 62000;
      return 2000;
    }
    let v = 30000 + gauss(rn) * 1500;
    for (const p of virions) {
      const dx = x - p.x, dy = y - p.y;
      const u = dx * Math.cos(p.a) + dy * Math.sin(p.a), q = -dx * Math.sin(p.a) + dy * Math.cos(p.a);
      // hexagonal head: stain pools around it (dark rim), head itself lighter
      const hex = Math.max(Math.abs(q), Math.abs(q) * 0.5 + Math.abs(u) * 0.866);
      if (hex < headR) v += 9000; else if (hex < headR + 6) v -= 12000;
      if (u > headR * 0.85 && u < headR * 0.85 + tailL && Math.abs(q) < tailW / 2) v += 7000;
    }
    return v;
  });
}

/** A Petri-dish photo with dark plaques on a light lawn (8-bit JPEG). n plaques. */
async function platePhoto(T, file, { size = 1200, n = 45, seed = 21 } = {}) {
  return canvasImage(T, file, size, size, (ctx, w, h, rnd, { n }) => {
    ctx.fillStyle = '#1d1d1f'; ctx.fillRect(0, 0, w, h);                     // bench
    const cx = w / 2, cy = h / 2, R = w * 0.42;
    ctx.fillStyle = '#d9cfa8'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();   // lawn
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 8; ctx.stroke();                          // rim
    for (let i = 0; i < n; i++) {
      let x, y; do { x = cx + (rnd() * 2 - 1) * R * 0.88; y = cy + (rnd() * 2 - 1) * R * 0.88; } while (Math.hypot(x - cx, y - cy) > R * 0.85);
      const r = 9 + rnd() * 6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#6b6550'); g.addColorStop(0.8, '#7a7360'); g.addColorStop(1, 'rgba(217,207,168,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // ruler sticker: 10 mm = 220 px
    ctx.fillStyle = '#fff'; ctx.fillRect(60, h - 70, 300, 40); ctx.fillStyle = '#000';
    for (let k = 0; k <= 10; k++) ctx.fillRect(80 + k * 22, h - 70, 2, k % 5 ? 12 : 22);
  }, { type: 'image/jpeg', seed, params: { n } });
}

/** A spot assay plate: rows = hosts, columns = ten-fold dilutions (8-bit JPEG). */
async function spotAssay(T, file, { rows = 4, cols = 8, seed = 31 } = {}) {
  return canvasImage(T, file, 1400, 800, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#d6cba0'; ctx.fillRect(0, 0, w, h);
    const sx = w / 9, sy = h / 5;
    for (let rI = 0; rI < 4; rI++) for (let c = 0; c < 8; c++) {
      const x = sx * (c + 1), y = sy * (rI + 1);
      const titre = [6, 5, 3, 0][rI];                    // last host resistant
      if (c < titre) { ctx.fillStyle = 'rgba(80,72,50,0.85)'; ctx.beginPath(); ctx.arc(x, y, 40, 0, 7); ctx.fill(); }
      else if (c < titre + 2 && titre) { for (let k = 0; k < (titre + 2 - c) * 4; k++) { ctx.fillStyle = 'rgba(80,72,50,0.9)'; ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60, 4, 0, 7); ctx.fill(); } }
    }
  }, { type: 'image/jpeg', seed });
}

/** A phase-contrast-like micrograph of rod-shaped bacteria (8-bit PNG). */
async function bacteriaPhoto(T, file, { seed = 41 } = {}) {
  return canvasImage(T, file, 800, 600, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(0, 0, 22, 7, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    }
  }, { seed });
}

/** A linear phage genome region in GenBank format, `n` CDS and a promoter and terminator. */
function phageGenBank(file) {
  const genes = [['terS', 120, 680, 1], ['terL', 700, 2300, 1], ['portal', 2320, 3900, 1], ['scaf', 3920, 4600, 1],
    ['mcp', 4620, 5800, 1], ['tail tube', 5820, 6400, 1], ['tape measure', 6420, 9100, 1], ['holin', 9200, 9500, -1],
    ['endolysin', 9510, 10050, -1], ['Rz', 10060, 10400, -1]];
  const len = 10800;
  const lines = [`LOCUS       phiGuide_late          ${len} bp    DNA     linear   PHG 14-NOV-2026`,
    'DEFINITION  Escherichia phage phiGuide, late region (synthetic).', 'ACCESSION   .', 'VERSION     .',
    'FEATURES             Location/Qualifiers', `     source          1..${len}`, '                     /organism="Escherichia phage phiGuide"',
    '     promoter        60..110', '                     /label="pLate"'];
  for (const [g, a, b, s] of genes) {
    lines.push(`     CDS             ${s > 0 ? `${a}..${b}` : `complement(${a}..${b})`}`, `                     /gene="${g}"`, `                     /product="${g}"`);
  }
  lines.push('     terminator      10500..10560', '                     /label="tLate"', 'ORIGIN');
  const seq = 'atgc'.repeat(len / 4);
  for (let i = 0; i < len; i += 60) {
    const chunk = seq.slice(i, i + 60).match(/.{1,10}/g).join(' ');
    lines.push(String(i + 1).padStart(9) + ' ' + chunk);
  }
  lines.push('//');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

module.exports = { blotTiff, totalProteinTiff, fluorTiff, temTiff, platePhoto, spotAssay, bacteriaPhoto, phageGenBank };
