'use strict';
// Visual fingerprints for aligning Ocean Cut video with the original (dubbed) episodes.
// ffmpeg streams the input (no video is written to disk) at FPS frames/s, crops the
// center (drops logos/borders), scales to 9x8 gray, and we keep a 64-bit dHash per frame.
const { spawn } = require('child_process');

const FPS = 4;
const W = 9, H = 8;

function fingerprint(url, opts) {
  opts = opts || {};
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (opts.headers) args.push('-headers', Object.entries(opts.headers).map(([k, v]) => k + ': ' + v + '\r\n').join(''));
  if (/^https?:/.test(url)) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  if (opts.start) args.push('-ss', String(opts.start));
  args.push('-i', url);
  if (opts.duration) args.push('-t', String(opts.duration));
  // center 80% (drop channel logos / translated captions near edges), then tiny gray frame
  args.push('-an', '-sn', '-vf', `fps=${FPS},crop=iw*0.8:ih*0.8,scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1');
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const frame = W * H, hashes = [];
    let buf = Buffer.alloc(0), err = '';
    p.stdout.on('data', d => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      let off = 0;
      while (buf.length - off >= frame) { hashes.push(dhash(buf, off)); off += frame; }
      buf = buf.subarray(off);
      if (opts.onProgress && hashes.length % (FPS * 60) === 0) opts.onProgress(hashes.length / FPS);
    });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0 && !hashes.length) return reject(new Error('ffmpeg ' + code + ': ' + err.slice(-300)));
      resolve({ fps: FPS, hashes: BigUint64Array.from(hashes) });
    });
    if (opts.signal) opts.signal.addEventListener('abort', () => p.kill('SIGKILL'));
  });
}

// dHash: compare each pixel with its right neighbour (8x8 = 64 bits)
function dhash(b, off) {
  let h = 0n, bit = 0n;
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
    if (b[off + y * W + x] > b[off + y * W + x + 1]) h |= (1n << bit);
    bit++;
  }
  return h;
}

// frames with almost no structure (black, fades, flat colors) match everything; flag them
function informative(h) {
  const n = popcount(h);
  return n >= 8 && n <= 56;
}
function popcount(x) { let c = 0; while (x) { x &= x - 1n; c++; } return c; }
function hamming(a, b) { return popcount(a ^ b); }

module.exports = { fingerprint, hamming, informative, popcount, FPS };
