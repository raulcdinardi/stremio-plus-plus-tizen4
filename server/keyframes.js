'use strict';
// Stremio++ keyframes.js - keyframe index (presentation times of video sync samples) WITHOUT reading the whole file.
// Matroska/WebM: EBML via Range reads (Segment -> SeekHead -> Info/Tracks/Cues). MP4/MOV: moov box walk (moov may be at
// the end) reading only mdhd/hdlr/elst/stts/stss/first-ctts of the video trak. Anything else -> null (not eligible).
// Works for http(s) URLs (Range requests) and local paths. Node built-ins only.

const fs = require('fs');
const http = require('http');
const https = require('https');

const TOTAL_TIMEOUT_MS = 15000;
const PAGE = 16384;                 // small reads are fetched as a PAGE-sized chunk and reused
const MAX_TABLE = 24 * 1024 * 1024; // refuse absurdly large single tables
const CACHE_MAX = 32;
const CACHE_TTL = 6 * 3600 * 1000;

const cache = new Map();            // key -> {t, value(promise|result)}
const stats = { requests: 0, bytes: 0 };

function log(msg) { process.stderr.write('[keyframes] ' + msg + '\n'); }
const isHttp = (u) => /^https?:\/\//i.test(u);
const cacheKey = (u) => u.replace(/[?#].*$/, '');

// ---------------------------------------------------------------- range reader
const agents = { http: new http.Agent({ keepAlive: true, maxSockets: 2 }), https: new https.Agent({ keepAlive: true, maxSockets: 2 }) };

function httpRange(url, headers, off, len, signal) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const h = Object.assign({}, headers || {}, { Range: 'bytes=' + off + '-' + (off + len - 1), 'Accept-Encoding': 'identity' });
    const req = lib.request(u, { method: 'GET', headers: h, agent: u.protocol === 'https:' ? agents.https : agents.http, signal }, (res) => {
      if (res.statusCode === 416) { res.resume(); return resolve({ buf: Buffer.alloc(0), total: null }); }
      if (res.statusCode !== 206) { res.destroy(); return reject(new Error('server does not support Range (HTTP ' + res.statusCode + ')')); }
      const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
      const chunks = []; let n = 0;
      res.on('data', (c) => { chunks.push(c); n += c.length; });
      res.on('end', () => { stats.requests++; stats.bytes += n; resolve({ buf: Buffer.concat(chunks), total: m ? Number(m[1]) : null }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

class Reader {
  constructor(url, headers, signal) {
    this.url = url; this.headers = headers; this.signal = signal; this.size = null;
    this.fd = isHttp(url) ? null : fs.openSync(url, 'r');
    this.page = null; // {off, buf}
    if (this.fd !== null) this.size = fs.fstatSync(this.fd).size;
  }
  close() { if (this.fd !== null) { try { fs.closeSync(this.fd); } catch (e) { /* ignore */ } } }
  async raw(off, len) {
    if (this.signal && this.signal.aborted) throw new Error('keyframe index timeout');
    if (this.size !== null) { if (off >= this.size) return Buffer.alloc(0); len = Math.min(len, this.size - off); }
    if (this.fd !== null) {
      const b = Buffer.alloc(len); const n = fs.readSync(this.fd, b, 0, len, off);
      stats.requests++; stats.bytes += n; return b.subarray(0, n);
    }
    const r = await httpRange(this.url, this.headers, off, len, this.signal);
    if (r.total !== null) this.size = r.total;
    return r.buf;
  }
  async read(off, len) {
    if (len > PAGE) return this.raw(off, len);
    const p = this.page;
    if (p && off >= p.off && off + len <= p.off + p.buf.length) return p.buf.subarray(off - p.off, off - p.off + len);
    const buf = await this.raw(off, PAGE);
    this.page = { off, buf };
    return buf.subarray(0, Math.min(len, buf.length));
  }
}

// ---------------------------------------------------------------- Matroska
function vint(buf, pos, keepMarker) {
  if (pos >= buf.length) return null;
  const b = buf[pos];
  let len = 1; let mask = 0x80;
  while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
  if (len > 8 || pos + len > buf.length) return null;
  let v = keepMarker ? b : (b & (mask - 1));
  let allOnes = (b & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false; }
  return { v, len, unknown: !keepMarker && allOnes };
}

function ebmlHeader(buf, pos) { // -> {id, size|null(unknown), dataStart}
  const id = vint(buf, pos, true); if (!id) return null;
  const sz = vint(buf, pos + id.len, false); if (!sz) return null;
  return { id: id.v, size: sz.unknown ? null : sz.v, dataStart: pos + id.len + sz.len };
}

function uintBE(buf, s, e) { let v = 0; for (let i = s; i < e; i++) v = v * 256 + buf[i]; return v; }

const ID = { EBML: 0x1A45DFA3, SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB, SEEKPOS: 0x53AC,
  INFO: 0x1549A966, TSCALE: 0x2AD7B1, TRACKS: 0x1654AE6B, TRACKENTRY: 0xAE, TRACKNUM: 0xD7, TRACKTYPE: 0x83,
  CUES: 0x1C53BB6B, CUEPOINT: 0xBB, CUETIME: 0xB3, CUETRACKPOS: 0xB7, CUETRACK: 0xF7, CLUSTER: 0x1F43B675 };

function children(buf, s, e, fn) {
  let p = s;
  while (p < e) {
    const h = ebmlHeader(buf, p); if (!h) break;
    const end = h.size === null ? e : Math.min(e, h.dataStart + h.size);
    if (fn(h, h.dataStart, end) === false) return;
    p = end;
  }
}

async function mkvIndex(rd) {
  const head = await rd.read(0, PAGE);
  const eh = ebmlHeader(head, 0);
  if (!eh || eh.id !== ID.EBML || eh.size === null) return null;
  const sh = ebmlHeader(await rd.read(eh.dataStart + eh.size, 16), 0);
  if (!sh || sh.id !== ID.SEGMENT) return null;
  const segData = eh.dataStart + eh.size + sh.dataStart; // sh.dataStart is relative to its own start
  // walk top-level children (headers only) up to the first Cluster, collecting positions
  const pos = {}; // id -> absolute data offset of the element header start
  const seekQueue = [];
  let p = segData; let hops = 0;
  while (hops++ < 40) {
    const buf = await rd.read(p, 16);
    const h = ebmlHeader(buf, 0); if (!h) break;
    if (h.id === ID.CLUSTER) break;
    if (!(h.id in pos)) pos[h.id] = { off: p, hdr: h.dataStart, size: h.size };
    if (h.id === ID.SEEKHEAD) seekQueue.push({ off: p, hdr: h.dataStart, size: h.size });
    if (h.size === null) break;
    p += h.dataStart + h.size;
  }
  // follow SeekHeads (possibly chained) for elements located after the first Cluster (typically Cues)
  const seen = new Set();
  while (seekQueue.length) {
    const sk = seekQueue.shift();
    if (seen.has(sk.off) || sk.size === null || sk.size > 1 << 20) continue;
    seen.add(sk.off);
    const b = await rd.read(sk.off + sk.hdr, sk.size);
    children(b, 0, b.length, (e, ds, de) => {
      if (e.id !== ID.SEEK) return;
      let sid = null; let sp = null;
      children(b, ds, de, (c, cs, ce) => {
        if (c.id === ID.SEEKID) sid = uintBE(b, cs, ce);
        else if (c.id === ID.SEEKPOS) sp = uintBE(b, cs, ce);
      });
      if (sid === null || sp === null) return;
      const abs = segData + sp;
      if (sid === ID.SEEKHEAD) seekQueue.push({ off: abs, hdr: 0, size: null, lazy: true });
      else if (!(sid in pos)) pos[sid] = { off: abs, hdr: null, size: null };
    });
    // lazy seekheads: resolve their header now
    for (const q of seekQueue) {
      if (q.lazy) {
        const h = ebmlHeader(await rd.read(q.off, 16), 0);
        if (h && h.id === ID.SEEKHEAD) { q.hdr = h.dataStart; q.size = h.size; } else q.size = null;
        q.lazy = false;
      }
    }
  }
  const load = async (id, cap) => {
    const e = pos[id]; if (!e) return null;
    const h = ebmlHeader(await rd.read(e.off, 16), 0);
    if (!h || h.id !== id || h.size === null || h.size > cap) return null;
    return rd.read(e.off + h.dataStart, h.size);
  };
  const info = await load(ID.INFO, 1 << 20);
  let scale = 1000000;
  if (info) children(info, 0, info.length, (e, s, en) => { if (e.id === ID.TSCALE) scale = uintBE(info, s, en); });
  const tracks = await load(ID.TRACKS, 4 << 20);
  if (!tracks) return null;
  let vtrack = null;
  children(tracks, 0, tracks.length, (e, s, en) => {
    if (e.id !== ID.TRACKENTRY || vtrack !== null) return;
    let num = null; let type = null;
    children(tracks, s, en, (c, cs, ce) => {
      if (c.id === ID.TRACKNUM) num = uintBE(tracks, cs, ce);
      else if (c.id === ID.TRACKTYPE) type = uintBE(tracks, cs, ce);
    });
    if (type === 1 && num !== null) vtrack = num;
  });
  if (vtrack === null) return null;
  const cues = await load(ID.CUES, MAX_TABLE);
  if (!cues) return null;
  const times = [];
  children(cues, 0, cues.length, (e, s, en) => {
    if (e.id !== ID.CUEPOINT) return;
    let t = null; let match = false;
    children(cues, s, en, (c, cs, ce) => {
      if (c.id === ID.CUETIME) t = uintBE(cues, cs, ce);
      else if (c.id === ID.CUETRACKPOS) {
        children(cues, cs, ce, (d, ds, de) => { if (d.id === ID.CUETRACK && uintBE(cues, ds, de) === vtrack) match = true; });
      }
    });
    if (t !== null && match) times.push(t * scale / 1e9);
  });
  return { kind: 'matroska', times };
}

// ---------------------------------------------------------------- MP4 / MOV
async function boxHeader(rd, off, limit) { // -> {type, start, hdr, size(total), end}
  const b = await rd.read(off, 16);
  if (b.length < 8) return null;
  let size = b.readUInt32BE(0); let hdr = 8;
  const type = b.toString('latin1', 4, 8);
  if (size === 1) { if (b.length < 16) return null; size = Number(b.readBigUInt64BE(8)); hdr = 16; }
  else if (size === 0) size = limit - off;
  if (size < hdr) return null;
  return { type, start: off, hdr, size, end: off + size };
}

async function* boxes(rd, start, end) {
  let p = start;
  while (p + 8 <= end) {
    const h = await boxHeader(rd, p, end);
    if (!h) return;
    yield h;
    p = h.end;
  }
}

async function findBox(rd, start, end, type) {
  for await (const h of boxes(rd, start, end)) if (h.type === type) return h;
  return null;
}

async function mp4Index(rd) {
  const top = await boxHeader(rd, 0, rd.size);
  if (!top || !['ftyp', 'moov', 'free', 'mdat', 'wide', 'skip'].includes(top.type)) return null;
  const moov = await findBox(rd, 0, rd.size, 'moov');
  if (!moov) return null;
  const mStart = moov.start + moov.hdr;
  let movieTs = 1000;
  let video = null;
  for await (const b of boxes(rd, mStart, moov.end)) {
    if (b.type === 'mvhd') {
      const d = await rd.read(b.start + b.hdr, 24);
      movieTs = d.readUInt32BE(d[0] === 1 ? 20 : 12);
    } else if (b.type === 'mvex') return null; // fragmented
    else if (b.type === 'trak' && !video) {
      const mdia = await findBox(rd, b.start + b.hdr, b.end, 'mdia');
      if (!mdia) continue;
      const hdlr = await findBox(rd, mdia.start + mdia.hdr, mdia.end, 'hdlr');
      if (!hdlr) continue;
      const hd = await rd.read(hdlr.start + hdlr.hdr, 12);
      if (hd.toString('latin1', 8, 12) !== 'vide') continue;
      video = { trak: b, mdia };
    }
  }
  if (!video) return null;
  const { trak, mdia } = video;
  // mdhd timescale
  const mdhd = await findBox(rd, mdia.start + mdia.hdr, mdia.end, 'mdhd');
  if (!mdhd) return null;
  const md = await rd.read(mdhd.start + mdhd.hdr, 24);
  const ts = md.readUInt32BE(md[0] === 1 ? 20 : 12);
  if (!ts) return null;
  // edit list
  let emptyEdit = 0; let mediaTime = 0;
  const edts = await findBox(rd, trak.start + trak.hdr, trak.end, 'edts');
  if (edts) {
    const elst = await findBox(rd, edts.start + edts.hdr, edts.end, 'elst');
    if (elst) {
      const eb = await rd.read(elst.start + elst.hdr, Math.min(elst.size - elst.hdr, 4096));
      const ver = eb[0]; const cnt = eb.readUInt32BE(4);
      const esz = ver === 1 ? 20 : 12;
      let o = 8; let first = true;
      for (let i = 0; i < cnt && o + esz <= eb.length; i++, o += esz) {
        const dur = ver === 1 ? Number(eb.readBigUInt64BE(o)) : eb.readUInt32BE(o);
        const mt = ver === 1 ? Number(eb.readBigInt64BE(o + 8)) : eb.readInt32BE(o + 4);
        if (mt === -1) { if (first) emptyEdit += dur / movieTs; continue; }
        mediaTime = mt; break; // first non-empty edit defines the start
      }
      first = false;
    }
  }
  const minf = await findBox(rd, mdia.start + mdia.hdr, mdia.end, 'minf');
  const stbl = minf && await findBox(rd, minf.start + minf.hdr, minf.end, 'stbl');
  if (!stbl) return null;
  const t = {};
  for await (const b of boxes(rd, stbl.start + stbl.hdr, stbl.end)) if (['stts', 'stss', 'ctts'].includes(b.type)) t[b.type] = b;
  if (!t.stts || !t.stss) return null;
  if (t.stts.size > MAX_TABLE || t.stss.size > MAX_TABLE) return null;
  const sttsB = await rd.read(t.stts.start + t.stts.hdr, t.stts.size - t.stts.hdr);
  const stssB = await rd.read(t.stss.start + t.stss.hdr, t.stss.size - t.stss.hdr);
  let ctts0 = 0;
  if (t.ctts) {
    const cb = await rd.read(t.ctts.start + t.ctts.hdr, 16);
    if (cb.readUInt32BE(4) > 0) ctts0 = cb.readUInt32BE(12) | 0;
  }
  const stssN = stssB.readUInt32BE(4);
  const sttsN = sttsB.readUInt32BE(4);
  if (8 + stssN * 4 > stssB.length || 8 + sttsN * 8 > sttsB.length) return null;
  // walk stts once while consuming the (ascending) sync-sample list
  const times = [];
  let sample = 0; let dts = 0; let si = 0;
  let nextKey = stssN ? stssB.readUInt32BE(8) - 1 : -1; // 0-based sample index
  for (let e = 0; e < sttsN && si < stssN; e++) {
    const cnt = sttsB.readUInt32BE(8 + e * 8); const delta = sttsB.readUInt32BE(12 + e * 8);
    while (si < stssN && nextKey < sample + cnt) {
      const d = dts + (nextKey - sample) * delta;
      times.push((d + ctts0 - mediaTime) / ts + emptyEdit);
      si++; nextKey = si < stssN ? stssB.readUInt32BE(8 + si * 4) - 1 : -1;
    }
    sample += cnt; dts += cnt * delta;
  }
  return { kind: 'mp4', times };
}

// ---------------------------------------------------------------- public
async function buildIndex(url, headers, signal) {
  const rd = new Reader(url, headers, signal);
  try {
    const head = await rd.read(0, 64);
    if (head.length < 12) return null;
    let r = null;
    if (head.readUInt32BE(0) === 0x1A45DFA3) r = await mkvIndex(rd);
    else if (/^(ftyp|moov|free|mdat|wide|skip)$/.test(head.toString('latin1', 4, 8))) r = await mp4Index(rd);
    if (!r || r.times.length < 2) return null;
    r.times.sort((a, b) => a - b);
    const out = [];
    for (const t of r.times) if (!out.length || t - out[out.length - 1] > 1e-4) out.push(t);
    r.times = out; r.size = rd.size;
    return r;
  } finally { rd.close(); }
}

// getKeyframes(url, {headers, timeoutMs}) -> {kind, times:[s...], size} | null   (never throws)
function getKeyframes(url, opts) {
  opts = opts || {};
  const key = cacheKey(url);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.p;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || TOTAL_TIMEOUT_MS);
  const t0 = Date.now();
  const p = buildIndex(url, opts.headers, ac.signal).then((r) => {
    log((r ? r.kind + ' ' + r.times.length + ' keyframes' : 'no index') + ' for ' + key.slice(-60) + ' in ' + (Date.now() - t0) + ' ms');
    return r;
  }, (e) => {
    log('index failed for ' + key.slice(-60) + ': ' + (e && e.message) + ' (' + (Date.now() - t0) + ' ms)');
    return null;
  }).finally(() => clearTimeout(timer));
  cache.set(key, { t: Date.now(), p });
  p.then((r) => { if (!r) cache.delete(key); }); // do not cache failures (file may still be downloading)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

module.exports = { getKeyframes, stats, _cache: cache };
