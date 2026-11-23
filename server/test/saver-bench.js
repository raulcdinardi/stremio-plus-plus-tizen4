'use strict';
// Data-saver benchmark / HLS test server (no network, no torrents):
//   node test/saver-bench.js <file> bench <startSec> <seconds>   -> real-time factor + bitrate per variant
//   node test/saver-bench.js <file> serve <port>                 -> /hls/<id>/... for each variant, /sessions.json
const http = require('http'), fs = require('fs'), path = require('path');
const media = require('../media.js');
const [file, cmd, a1, a2] = process.argv.slice(2);
const variants = { tv: {}, hevc: { saver: true, codecs: ['hevc', 'h264'] }, h264: { saver: true, codecs: ['h264'] } };
const { execFileSync } = require('child_process');

async function mk(name, startSec) {
  const probe = await media.probe(file, {});
  const r = await media.createSession(Object.assign({ url: file, probe, startSec: startSec || 0 }, variants[name]));
  return r;
}
async function bench() {
  const start = Number(a1) || 0, secs = Number(a2) || 120, nseg = Math.round(secs / media.SEG);
  for (const name of Object.keys(variants)) {
    const t0 = Date.now();
    const r = await mk(name, start);
    const s = media.getSession(r.id);
    const ext = s.fmp4 ? '.m4s' : '.ts';
    let bytes = 0;
    const first = Math.floor(start / media.SEG);
    for (let k = first; k < first + nseg; k++) {
      const f = await media._internal.ensureSegment(s, k, null);
      bytes += fs.statSync(f).size;
    }
    const wall = (Date.now() - t0) / 1000, mediaSec = nseg * media.SEG;
    // audio-only size estimate is inside; report total and the mode used
    console.log(JSON.stringify({ variant: name, mode: media.listSessions().find((x) => x.id === r.id).mode, mediaSec, wallSec: +wall.toFixed(1), rtFactor: +(mediaSec / wall).toFixed(2),
      kbps: Math.round(bytes * 8 / mediaSec / 1000), MBperHour: +(bytes / mediaSec * 3600 / 1048576).toFixed(0) }));
    media.destroySession(r.id);
  }
  process.exit(0);
}
async function serve() {
  const ids = {};
  for (const name of ['hevc', 'h264']) ids[name] = (await mk(name, 0)).id;
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let x;
    if (u.pathname === '/sessions.json') { res.setHeader('Access-Control-Allow-Origin', '*'); return res.end(JSON.stringify(ids)); }
    if ((x = u.pathname.match(/^\/hls\/([\w-]+)\/index\.m3u8$/))) return media.handlePlaylist(req, res, x[1]);
    if ((x = u.pathname.match(/^\/hls\/([\w-]+)\/(\d+)\.(?:ts|m4s)$/))) return media.handleSegment(req, res, x[1], +x[2]);
    if ((x = u.pathname.match(/^\/hls\/([\w-]+)\/init\.mp4$/))) return media.handleInit(req, res, x[1]);
    if (u.pathname === '/t.html') { res.setHeader('Content-Type', 'text/html'); return res.end('<!DOCTYPE html><body><script src="/av-html5.js"></script>'); }
    const f = path.join(__dirname, '../../app', u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/app\//, ''));
    fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('nf'); } res.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'text/plain'); res.end(d); });
  }).listen(Number(a1) || 8835, '127.0.0.1', () => console.log('serving', JSON.stringify(ids)));
}
(cmd === 'serve' ? serve : bench)().catch((e) => { console.error(e); process.exit(1); });
