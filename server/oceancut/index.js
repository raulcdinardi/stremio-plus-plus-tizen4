'use strict';
// Naruto Ocean Cut (fan re-edit, English) + Brazilian dub from Dattebane.
// For each Ocean Cut video we: (1) fingerprint its frames while streaming it from the torrent,
// (2) fingerprint the candidate dubbed episodes (streamed, never stored), (3) align them,
// (4) assemble a PT-BR audio track (~60 MB) that follows Ocean Cut's cuts. Playback = Ocean Cut
// video + that audio. Only fingerprints (KBs) and the newest audio tracks are kept on disk.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const U = require('../util');
const FP = require('./fp');
const { align } = require('./align');
const D = require('../api/providers/dattebane')._internal;

const OC_BASE = 'https://raw.githubusercontent.com/tahmeednabi/naruto-ocean-cut-stremio/main';
const ENGINE = 'http://127.0.0.1:11470';
const DIR = path.join(U.STATE, 'oc'), FPDIR = path.join(DIR, 'fp'), AUDIO = path.join(DIR, 'audio');
for (const d of [DIR, FPDIR, AUDIO]) fs.mkdirSync(d, { recursive: true });
const KEEP_AUDIO = 6;               // newest dubbed tracks kept (~60 MB each)
const HDR = () => ({ 'User-Agent': D.UA, Referer: D.BASE + '/' });
const log = (...a) => U.log('[oceancut]', ...a);

// ---------- Ocean Cut catalog ----------
let catalog = null;
async function videos() {
  if (catalog && Date.now() - catalog.t < 6 * 3600e3) return catalog.list;
  const m = (await U.fetchJson(OC_BASE + '/meta/series/narutooc.json', { timeout: 15000 })).meta;
  const list = (m.videos || []).map(v => ({ id: v.id, season: v.season, episode: v.episode, title: v.title || v.name || v.id, thumbnail: v.thumbnail || null }))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  catalog = { t: Date.now(), list, meta: m };
  return list;
}
async function rawMeta() { await videos(); return catalog.meta; }
async function ocStream(id) {
  const j = await U.fetchJson(OC_BASE + '/stream/series/' + id + '.json', { timeout: 15000 });
  const s = (j.streams || [])[0]; if (!s || !s.infoHash) throw new Error('no Ocean Cut stream for ' + id);
  return { infoHash: s.infoHash.toLowerCase(), fileIdx: s.fileIdx, url: ENGINE + '/' + s.infoHash.toLowerCase() + '/' + s.fileIdx };
}
// Ocean Cut (addon meta) seasons 0–4 (special, Land of Waves … Sasuke Retrieval) come from Naruto (2002);
// 5+ (Kazekage Rescue onward, and season 20 Kakashi's story) from Shippuden.
function showFor(v) { return v.season <= 4 ? D.SHOWS.naruto : D.SHOWS.shippuden; }

// ---------- state ----------
const STATE_F = path.join(DIR, 'state.json');
let st = { done: {}, lastEnd: {} };
try { st = JSON.parse(fs.readFileSync(STATE_F, 'utf8')); } catch (e) { /* first run */ }
const save = () => { fs.writeFileSync(STATE_F + '.tmp', JSON.stringify(st, null, 1)); fs.renameSync(STATE_F + '.tmp', STATE_F); };
const jobs = new Map(); // id -> {state, progress, msg}
const queue = [];
let running = false;

function audioPath(id) { return path.join(AUDIO, id + '.m4a'); }
function ready(id) {
  if (!st.done[id]) { try { const disk = JSON.parse(fs.readFileSync(STATE_F, 'utf8')); Object.assign(st.done, disk.done); } catch (e) { /* none */ } } // another process may have prepared it
  return !!(st.done[id] && fs.existsSync(audioPath(id)));
}
function status(id) {
  if (ready(id)) return { state: 'ready', coverage: st.done[id].coverage };
  const j = jobs.get(id); return j ? { state: j.state, progress: j.progress || 0, msg: j.msg || '' } : { state: 'none' };
}

// ---------- fingerprints of dubbed episodes (cached on disk, ~45 KB each) ----------
async function dubPrint(show, n) {
  const f = path.join(FPDIR, show.dub + '_' + n + '.bin');
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return new BigUint64Array(b.buffer, b.byteOffset, b.length / 8); }
  const ep = await D.episode(show.dub, n); if (!ep) return null;
  const r = await FP.fingerprint(ep.url, { headers: HDR() });
  fs.writeFileSync(f, Buffer.from(r.hashes.buffer));
  return r.hashes;
}
async function dubUrl(show, n) { const ep = await D.episode(show.dub, n); return ep && ep.url; }

// ---------- start hint: title match against the original episode list, else neighbours ----------
const words = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'naruto', 'episode'].includes(w));
async function titleHint(v, show) {
  try {
    const m = (await U.fetchJson('https://v3-cinemeta.strem.io/meta/series/' + show.imdb[0] + '.json', { timeout: 10000 })).meta;
    const eps = (m.videos || []).filter(x => x.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode);
    const want = new Set(words(v.title)); if (!want.size) return null;
    let best = 0, bi = -1;
    eps.forEach((e, i) => { const w = words(e.name || e.title); const inter = w.filter(x => want.has(x)).length; const sc = inter / Math.max(want.size, 1); if (sc > best) { best = sc; bi = i; } });
    return best >= 0.6 ? bi + 1 : null;
  } catch (e) { return null; }
}
async function startHint(v, list) {
  const show = showFor(v), idx = list.findIndex(x => x.id === v.id);
  for (let k = idx - 1; k >= 0; k--) { // previous Ocean Cut video of the same show already aligned
    const p = list[k]; if (showFor(p) !== show) break;
    if (st.done[p.id] && st.done[p.id].lastEp) return st.done[p.id].lastEp;
  }
  const t = await titleHint(v, show); if (t) return t;
  const same = list.filter(x => showFor(x) === show), pos = same.findIndex(x => x.id === v.id);
  return Math.max(1, Math.round(pos / same.length * show.max.dub)); // rough proportional guess
}

// ---------- job ----------
async function prepare(id) {
  const list = await videos(); const v = list.find(x => x.id === id); if (!v) throw new Error('unknown Ocean Cut episode ' + id);
  const show = showFor(v), job = jobs.get(id);
  const set = (state, progress, msg) => { job.state = state; job.progress = progress; job.msg = msg || ''; };
  const oc = await ocStream(id);
  // 1. fingerprint Ocean Cut (streams the whole video once through the torrent engine)
  set('fingerprint', 0, 'lendo o vídeo do Ocean Cut');
  let dur = 0; try { dur = (await require('../media').probe(oc.url)).duration; } catch (e) { /* unknown */ }
  const ocfp = await FP.fingerprint(oc.url, { onProgress: s => set('fingerprint', dur ? Math.min(0.7, 0.7 * s / dur) : 0.3, 'lendo o vídeo do Ocean Cut') });
  // 2+3. align against a growing window of dubbed episodes
  let start = await startHint(v, list), lo = Math.max(1, start - 1), hi = Math.min(show.max.dub, start + 5), res = null;
  const prints = new Map();
  for (let round = 0; round < 6; round++) {
    set('align', 0.72 + round * 0.03, 'comparando com os episódios ' + lo + '–' + hi);
    for (let n = lo; n <= hi; n++) if (!prints.has(n)) { const h = await dubPrint(show, n).catch(() => null); if (h) prints.set(n, h); }
    res = align(ocfp.hashes, [...prints].map(([n, h]) => ({ key: n, hashes: h })), FP.FPS);
    const used = res.segments.filter(s => s.src).map(s => s.src);
    const maxUsed = used.length ? Math.max(...used) : 0, minUsed = used.length ? Math.min(...used) : 0;
    log(id, 'eps', lo + '-' + hi, 'coverage', (res.coverage * 100).toFixed(1) + '%', 'used', minUsed + '-' + maxUsed);
    if (res.coverage >= 0.9 && maxUsed < hi && (minUsed > lo || lo === 1)) break;
    if (!used.length) { lo = Math.max(1, lo - 6); hi = Math.min(show.max.dub, hi + 6); continue; } // wrong place: widen
    if (maxUsed >= hi) hi = Math.min(show.max.dub, hi + 4);
    if (minUsed <= lo && lo > 1) lo = Math.max(1, lo - 3);
    if (maxUsed < hi && (minUsed > lo || lo === 1) ) break;
  }
  // 4. dubbed audio track
  set('audio', 0.85, 'montando o áudio dublado');
  const urls = new Map();
  for (const s of res.segments) if (s.src && !urls.has(s.src)) urls.set(s.src, await dubUrl(show, s.src));
  await buildAudio(res.segments, urls, oc.url, audioPath(id) + '.part', p => set('audio', 0.85 + 0.15 * p, 'montando o áudio dublado'));
  fs.renameSync(audioPath(id) + '.part', audioPath(id));
  const used = res.segments.filter(s => s.src).map(s => s.src);
  st.done[id] = { at: Date.now(), coverage: +res.coverage.toFixed(3), firstEp: Math.min(...used), lastEp: Math.max(...used), segments: res.segments.length };
  save(); prune();
  fs.writeFileSync(path.join(DIR, id + '.segments.json'), JSON.stringify(res.segments));
  log(id, 'ready: coverage', (res.coverage * 100).toFixed(1) + '%, dub eps', st.done[id].firstEp + '-' + st.done[id].lastEp, res.segments.length, 'pieces');
}

// Stream every piece as raw PCM into one AAC encoder: exact sample counts keep sync, no temp files.
const RATE = 48000, BPS = 4; // s16le stereo
function buildAudio(segments, urls, ocUrl, out, onProgress) {
  return new Promise((resolve, reject) => {
    const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '2', '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', '-y', out], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encErr = ''; enc.stderr.on('data', d => { encErr += d; });
    enc.on('error', reject);
    const total = segments.reduce((a, s) => a + s.ocEnd - s.ocStart, 0);
    (async () => {
      let done = 0;
      for (const s of segments) {
        const len = s.ocEnd - s.ocStart, need = Math.round(len * RATE) * BPS;
        const src = s.src ? { url: urls.get(s.src), at: s.srcStart, headers: HDR() } : { url: ocUrl, at: s.ocStart, headers: null };
        let pcm = src.url ? await slice(src, len).catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
        if (pcm.length < need) pcm = Buffer.concat([pcm, Buffer.alloc(need - pcm.length)]); // pad with silence
        else if (pcm.length > need) pcm = pcm.subarray(0, need);
        if (!enc.stdin.write(pcm)) await new Promise(r => enc.stdin.once('drain', r));
        done += len; onProgress(done / total);
      }
      enc.stdin.end();
    })().catch(e => { enc.kill('SIGKILL'); reject(e); });
    enc.on('close', code => code === 0 ? resolve() : reject(new Error('audio encode failed: ' + encErr.slice(-300))));
  });
}
function slice(src, len) {
  return new Promise((resolve, reject) => {
    const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (src.headers) a.push('-headers', Object.entries(src.headers).map(([k, v]) => k + ': ' + v + '\r\n').join(''));
    a.push('-ss', String(Math.max(0, src.at)), '-i', src.url, '-t', String(len), '-vn', '-ac', '2', '-ar', String(RATE),
      '-af', 'afade=t=in:d=0.015,afade=t=out:st=' + Math.max(0, len - 0.015).toFixed(3) + ':d=0.015', '-f', 's16le', 'pipe:1');
    const p = spawn('ffmpeg', a, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = []; p.stdout.on('data', d => chunks.push(d)); p.on('error', reject);
    p.on('close', () => resolve(Buffer.concat(chunks)));
  });
}
function prune() {
  const files = fs.readdirSync(AUDIO).filter(f => f.endsWith('.m4a')).map(f => ({ f, t: fs.statSync(path.join(AUDIO, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const x of files.slice(KEEP_AUDIO)) { fs.unlinkSync(path.join(AUDIO, x.f)); const id = x.f.replace(/\.m4a$/, ''); if (st.done[id]) st.done[id].evicted = true; }
  save();
}

function enqueue(id, front) {
  if (ready(id) || jobs.has(id)) return status(id);
  jobs.set(id, { state: 'queued', progress: 0 });
  if (front) queue.unshift(id); else queue.push(id);
  pump(); return status(id);
}
async function pump() {
  if (running || !queue.length) return;
  running = true;
  const id = queue.shift();
  try { await prepare(id); jobs.delete(id); }
  catch (e) { log(id, 'failed:', e.message); const j = jobs.get(id); if (j) { j.state = 'error'; j.msg = e.message; } setTimeout(() => jobs.delete(id), 10 * 60e3).unref(); }
  running = false; pump();
}
// when an episode is played, prepare the next two in the background
async function prefetchAfter(id) {
  const list = await videos(); const i = list.findIndex(x => x.id === id);
  for (const v of list.slice(i + 1, i + 3)) enqueue(v.id);
}

module.exports = { videos, rawMeta, ocStream, status, enqueue, prefetchAfter, audioPath, ready, OC_BASE };
