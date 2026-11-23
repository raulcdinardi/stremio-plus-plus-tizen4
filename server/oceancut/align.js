'use strict';
// Align an Ocean Cut video with original episodes using per-frame 64-bit dHashes.
// Ocean Cut is made of pieces of the originals (with cuts inside scenes), so we track a
// current (episode, offset) and re-search globally when the track is lost.
// Output: segments [{ocStart, ocEnd, src: key|null, srcStart}] in seconds; src null = no match.

function split(h64) { // BigUint64Array -> two Uint32Array (hi, lo) for fast popcount
  const n = h64.length, hi = new Uint32Array(n), lo = new Uint32Array(n);
  for (let i = 0; i < n; i++) { hi[i] = Number(h64[i] >> 32n); lo[i] = Number(h64[i] & 0xffffffffn); }
  return { hi, lo, n };
}
function pc32(x) { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function dist(a, i, b, j) { return pc32(a.hi[i] ^ b.hi[j]) + pc32(a.lo[i] ^ b.lo[j]); }
function info(a, i) { const n = pc32(a.hi[i]) + pc32(a.lo[i]); return n >= 8 && n <= 56; }

const MATCH = 10;      // max Hamming distance (of 64) to call two frames the same picture
const NEAR = 3;        // when tracking, look ±NEAR frames around the expected position
const LOST_AFTER = 3;  // informative frames without a nearby match before a global search

function align(oc, sources, fps) {
  const O = split(oc);
  const S = sources.map(s => ({ key: s.key, f: split(s.hashes) }));
  const n = O.n, match = new Array(n).fill(null); // match[i] = {s, j}
  let cur = null, miss = 0;
  const global = i => {
    let best = MATCH + 1, bs = -1, bj = -1;
    for (let s = 0; s < S.length; s++) {
      const F = S[s].f;
      for (let j = 0; j < F.n; j++) { const d = dist(O, i, F, j); if (d < best) { best = d; bs = s; bj = j; if (d === 0) break; } }
    }
    return bs < 0 ? null : { s: bs, j: bj, d: best };
  };
  const local = (i, c) => {
    const F = S[c.s].f, j0 = i + c.delta;
    let best = MATCH + 1, bj = -1;
    for (let j = Math.max(0, j0 - NEAR); j <= Math.min(F.n - 1, j0 + NEAR); j++) { const d = dist(O, i, F, j); if (d < best) { best = d; bj = j; } }
    return bj < 0 ? null : { s: c.s, j: bj, d: best };
  };
  for (let i = 0; i < n; i++) {
    if (!info(O, i)) continue; // black/flat frames: decided later from neighbours
    let m = cur ? local(i, cur) : null;
    if (m) { miss = 0; match[i] = m; cur = { s: m.s, delta: m.j - i }; continue; }
    if (cur && ++miss < LOST_AFTER) continue;
    m = global(i);
    if (m) {
      // accept a new track only if the next informative frames agree (avoids single-frame false hits)
      let ok = 0, tried = 0;
      for (let k = i + 1; k < n && tried < 4; k++) {
        if (!info(O, k)) continue; tried++;
        const F = S[m.s].f, j = k + (m.j - i);
        if (j >= 0 && j < F.n && Math.min(dist(O, k, F, j), j > 0 ? dist(O, k, F, j - 1) : 99, j + 1 < F.n ? dist(O, k, F, j + 1) : 99) <= MATCH) ok++;
      }
      if (ok >= Math.min(2, tried)) { match[i] = m; cur = { s: m.s, delta: m.j - i }; miss = 0; }
    }
  }
  // label each frame with (source, delta); fill unlabelled frames between equal labels
  const lab = match.map((m, i) => m ? { s: m.s, delta: m.j - i } : null);
  const same = (a, b) => a && b && a.s === b.s && Math.abs(a.delta - b.delta) <= 2;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!lab[i]) continue;
    if (last >= 0 && i - last > 1 && same(lab[last], lab[i])) for (let k = last + 1; k < i; k++) lab[k] = lab[last];
    last = i;
  }
  // short unlabelled gaps (< 2 s) continue the previous piece; longer ones stay unmatched
  for (let i = 0; i < n; i++) {
    if (lab[i]) continue;
    let k = i; while (k < n && !lab[k]) k++;
    if (k - i < 2 * fps && i > 0 && lab[i - 1]) for (let x = i; x < k; x++) lab[x] = lab[i - 1];
    i = k;
  }
  // collapse into segments; use the median delta of each run (tolerates ±1 frame jitter)
  const segs = [];
  let i = 0;
  while (i < n) {
    let k = i + 1;
    if (lab[i]) while (k < n && same(lab[k], lab[i])) k++;
    else while (k < n && !lab[k]) k++;
    if (lab[i]) {
      const ds = lab.slice(i, k).map(x => x.delta).sort((a, b) => a - b), d = ds[ds.length >> 1];
      segs.push({ ocStart: i / fps, ocEnd: k / fps, src: S[lab[i].s].key, srcStart: Math.max(0, (i + d) / fps) });
    } else segs.push({ ocStart: i / fps, ocEnd: k / fps, src: null, srcStart: 0 });
    i = k;
  }
  // merge very short pieces (< 0.75 s) into the previous one to avoid audio stutter
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s.ocEnd - s.ocStart < 0.75) { prev.ocEnd = s.ocEnd; continue; }
    if (prev && prev.src && prev.src === s.src && Math.abs((s.srcStart - s.ocStart) - (prev.srcStart - prev.ocStart)) < 0.3) { prev.ocEnd = s.ocEnd; continue; }
    out.push(Object.assign({}, s));
  }
  const matched = out.filter(s => s.src).reduce((a, s) => a + s.ocEnd - s.ocStart, 0);
  return { segments: out, coverage: n ? matched / (n / fps) : 0 };
}

module.exports = { align };
