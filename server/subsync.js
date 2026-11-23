'use strict';
// Automatic subtitle / audio alignment (no deps besides ffmpeg).
//
// Model: video_t = ratio * x_t + offset, where x_t is a time in the thing being aligned
// (a subtitle cue time, or a time in another audio file).
//
// Signals are sampled in BIN-second bins over a window of the video that is being played anyway
// (so the torrent pieces are already there and the analysis runs while the clip plays):
//  - speechSignal(): log energy of the speech band (250–3500 Hz) minus its 8 s moving average,
//    i.e. "louder than the local background" ≈ someone talking. Continuous, so no VAD threshold.
//  - cueSignal(): 1 where a subtitle cue is on, 0 elsewhere.
// align() scans offsets (and the usual frame-rate ratios) and returns the best one with a confidence
// score (how far the peak stands out from all other offsets, in standard deviations).
const { spawn } = require('node:child_process');

const BIN = 0.05;                 // 50 ms resolution
const RATIOS = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24];

function ffmpegPcm(url, headers, aIdx, from, dur, filter, timeoutMs) {
  return new Promise((resolve, reject) => {
    const a = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
    const h = Object.entries(headers || {}).map(([k, v]) => k + ': ' + v + '\r\n').join('');
    if (h) a.push('-headers', h);
    a.push('-ss', String(Math.max(0, from)), '-t', String(dur), '-i', url, '-map', '0:a:' + (aIdx || 0), '-vn');
    if (filter) a.push('-af', filter);
    a.push('-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1');
    const p = spawn('ffmpeg', a, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '', size = 0;
    p.stdout.on('data', d => { chunks.push(d); size += d.length; });
    p.stderr.on('data', d => { err = (err + d).slice(-400); });
    const to = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg audio timeout')); }, timeoutMs || 240000);
    p.on('close', code => {
      clearTimeout(to);
      if (size < 8000 * 2 * 20) return reject(new Error('too little audio (' + (code || 0) + '): ' + err.trim().slice(-160)));
      resolve(Buffer.concat(chunks, size));
    });
    p.on('error', e => { clearTimeout(to); reject(e); });
  });
}

function energyBins(pcm) {
  const per = Math.round(8000 * BIN), n = Math.floor(pcm.length / 2 / per);
  const e = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let i = 0; i < per; i++) { const v = pcm.readInt16LE((b * per + i) * 2); s += v * v; }
    e[b] = Math.log10(s / per + 1);
  }
  return e;
}
function minusMovingAvg(e, winSec) {
  const w = Math.max(1, Math.round(winSec / BIN)), n = e.length, out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + e[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1);
    out[i] = Math.max(-1.5, Math.min(1.5, e[i] - (pre[hi] - pre[lo]) / (hi - lo)));
  }
  return out;
}

// Speech-likeness of the video's own audio over [from, from+dur): { t0, sig }
async function speechSignal(url, headers, aIdx, from, dur) {
  const pcm = await ffmpegPcm(url, headers, aIdx, from, dur, 'highpass=f=250,lowpass=f=3500');
  return { t0: Math.max(0, from), sig: minusMovingAvg(energyBins(pcm), 8) };
}
// Broadband envelope (music + effects + voice) for audio-to-audio alignment.
async function envelopeSignal(url, headers, aIdx, from, dur) {
  const pcm = await ffmpegPcm(url, headers, aIdx, from, dur, null);
  return { t0: Math.max(0, from), sig: minusMovingAvg(energyBins(pcm), 3) };
}
// Same signals from already-transcoded HLS segments (see media.segmentRun): instant, no network.
async function speechFromSegments(win) {
  const pcm = await ffmpegPcm('concat:' + win.files.join('|'), null, 0, 0, win.dur + 1, 'highpass=f=250,lowpass=f=3500', 60000);
  return { t0: win.t0, sig: minusMovingAvg(energyBins(pcm), 8) };
}
async function envelopeFromSegments(win) {
  const pcm = await ffmpegPcm('concat:' + win.files.join('|'), null, 0, 0, win.dur + 1, null, 60000);
  return { t0: win.t0, sig: minusMovingAvg(energyBins(pcm), 3) };
}
function cueSignal(cues, t0, dur) {
  const n = Math.round(dur / BIN), sig = new Float32Array(n);
  for (const c of cues) {
    const a = Math.max(0, Math.floor((c[0] - t0) / BIN)), b = Math.min(n, Math.ceil((c[1] - t0) / BIN));
    for (let i = a; i < b; i++) sig[i] = 1;
  }
  return { t0, sig };
}

// Align subtitle cues (in subtitle time) to a reference signal (in video time).
function alignCues(cues, ref, opts) {
  opts = opts || {};
  const maxOff = opts.maxOffset || 120, sig = ref.sig, n = sig.length, t0 = ref.t0, tEnd = t0 + n * BIN;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + sig[i];
  const tot = pre[n];
  const merged = [];
  for (const c of cues.slice().sort((a, b) => a[0] - b[0])) {
    const L = merged[merged.length - 1];
    if (L && c[0] <= L[1]) L[1] = Math.max(L[1], c[1]); else merged.push([c[0], c[1]]);
  }
  const score = (r, d) => {
    let on = 0, cnt = 0;
    for (const c of merged) {
      const a = r * c[0] + d, b = r * c[1] + d;
      if (b <= t0 || a >= tEnd) continue;
      const ia = Math.max(0, Math.round((a - t0) / BIN)), ib = Math.min(n, Math.round((b - t0) / BIN));
      if (ib > ia) { on += pre[ib] - pre[ia]; cnt += ib - ia; }
    }
    if (cnt < 40 || cnt > n - 40) return null;               // need >= 2 s of cues inside the window
    return on / cnt - (tot - on) / (n - cnt);
  };
  const mid = t0 + n * BIN / 2, step = BIN, results = [];
  for (const r of opts.ratios || RATIOS) {
    const center = mid - r * mid;                              // offset that keeps the window centre fixed
    for (let d = center - maxOff; d <= center + maxOff; d += step) {
      const s = score(r, d); if (s != null) results.push({ r, d, s });
    }
  }
  return pickPeak(results, mid);
}

// Align another audio file's envelope (x time) to the video's envelope (video time).
function alignSignals(ref, other, opts) {
  opts = opts || {};
  const maxOff = opts.maxOffset || 120, results = [];
  const A = ref.sig, B = other.sig, nA = A.length, nB = B.length;
  for (const r of opts.ratios || RATIOS) {
    // video_t = r * x_t + d  ->  for each video bin i, x bin = ((t0A + i*BIN - d)/r - t0B)/BIN
    const mid = ref.t0 + nA * BIN / 2, center = mid - r * (other.t0 + nB * BIN / 2);
    for (let d = center - maxOff; d <= center + maxOff; d += BIN) {
      let s = 0, cnt = 0, sa = 0, sb = 0, saa = 0, sbb = 0;
      for (let i = 0; i < nA; i += 2) {
        const j = Math.round(((ref.t0 + i * BIN - d) / r - other.t0) / BIN);
        if (j < 0 || j >= nB) continue;
        const x = A[i], y = B[j]; s += x * y; sa += x; sb += y; saa += x * x; sbb += y * y; cnt++;
      }
      if (cnt < 600) continue;                                 // >= 60 s of overlap
      const cov = s / cnt - (sa / cnt) * (sb / cnt);
      const den = Math.sqrt(Math.max(1e-9, (saa / cnt - (sa / cnt) ** 2) * (sbb / cnt - (sb / cnt) ** 2)));
      results.push({ r, d, s: cov / den });
    }
  }
  return pickPeak(results, ref.t0 + nA * BIN / 2);
}

function pickPeak(results, mid) {
  if (results.length < 50) return null;
  // eff = how much a moment at the window centre moves; two candidates with ~equal eff are the same answer
  const eff = x => x.d + (x.r - 1) * mid;
  let best = results[0];
  for (const x of results) if (x.s > best.s) best = x;
  // Prefer normal speed (ratio 1) when it explains the data almost as well (frame-rate ratios near 1.001 are look-alikes).
  if (best.r !== 1) {
    let b1 = null;
    for (const x of results) if (x.r === 1 && Math.abs(eff(x) - eff(best)) < 1.5 && (!b1 || x.s > b1.s)) b1 = x;
    if (b1 && b1.s >= best.s * 0.97) best = b1;
  }
  const vals = results.map(x => x.s), mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1e-9;
  let second = -Infinity;
  for (const x of results) if (Math.abs(eff(x) - eff(best)) > 1.5 && x.s > second) second = x.s;
  const z = (best.s - mean) / sd, margin = (best.s - mean) / Math.max(1e-9, second - mean);
  const zero = results.find(x => x.r === 1 && Math.abs(x.d) < BIN / 2);
  return { offset: +best.d.toFixed(2), ratio: best.r, score: best.s, z: +z.toFixed(2), margin: +margin.toFixed(2),
    zeroScore: zero ? zero.s : null, confident: z >= 4 && margin >= 1.12 };
}

module.exports = { BIN, RATIOS, speechSignal, envelopeSignal, speechFromSegments, envelopeFromSegments, cueSignal, alignCues, alignSignals, ffmpegPcm };
