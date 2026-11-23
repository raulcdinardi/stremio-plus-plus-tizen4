'use strict';
// Watch-along ("Assistir junto"): one room per server. The TV (owner) creates it from the player; a friend opens
// /w/<token>/ in any browser. Play/pause/seek by either side is applied to both; source/audio/subtitle/episode
// changes on the TV are followed by the viewer.
//
//   TV side   (LAN / owner-restricted relay):  /api/party[/<adminId>/...]
//   Viewer    (public, gated by the token):    /w/<token>/...   <- the ONLY paths a public route may expose
//
// The viewer gets its own lower-bitrate HLS encode (<=720p, ~2.3 Mbps) of the same input as the TV's session.
// Sync = Server-Sent Events (server -> clients) + POST (clients -> server). All times are server wall-clock ms.
const fs = require('node:fs');
const path = require('node:path');
const U = require('./util');
const PL = require('./api/play');

const DIR = path.join(__dirname, 'watchparty');
const MAX_VIEWERS = 4;               // 4 x ~2.7 Mbps stays under the home upload
const ROOM_MAX_MS = 12 * 3600e3;     // absolute lifetime
const NO_TV_MS = 10 * 60e3;          // room closes if the TV sends nothing for this long
const CMD_QUIET_MS = 2500;           // TV position ticks do not override a command newer than this
const LEAVE_GRACE_MS = 6000;         // a viewer that reconnects within this is not announced as left

let room = null;                     // single active room (or null)
let badTokens = []; // timestamps of recent invalid-token requests (crude brute-force brake)

const NAMES = { pt: 'Convidado', en: 'Guest' };

function now() { return Date.now(); }
function curPos(r) {
  const st = r.st;
  let p = st.playing ? st.pos + (now() - st.at) / 1000 : st.pos;
  if (r.duration > 0) p = Math.min(p, r.duration);
  return Math.max(0, p);
}
function ownerName() { return U.getSettings().partyName || 'TV'; }

// ---------- SSE ----------
function sseWrite(c, obj) { try { c.res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* closing */ } }
function broadcast(r, obj, filter) { for (const c of r.clients) if (!filter || filter(c)) sseWrite(c, obj); }
function members(r) {
  const seen = new Set(), out = [];
  for (const c of r.clients) if (c.kind === 'v' && !seen.has(c.cid)) { seen.add(c.cid); out.push(c.name); }
  return out;
}
function snapshot(r, c) {
  return {
    t: 'snap', now: now(), rev: r.rev, epoch: r.epoch, owner: ownerName(),
    source: { state: r.srcState, msg: r.srcMsg || null, title: r.title, label: r.label, duration: r.duration, playlist: r.srcState === 'ready' ? 'hls/index.m3u8?e=' + r.epoch : null },
    playing: r.st.playing, pos: r.st.pos, at: r.st.at, sub: r.sub, members: members(r),
    you: c ? { cid: c.cid, name: c.name } : null
  };
}
function sse(req, res, r, kind, ident) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  if (req.socket) { req.socket.setNoDelay(true); req.socket.setKeepAlive(true, 20000); req.socket.setTimeout(0); }
  const c = { res, kind, cid: ident.cid, name: ident.name };
  r.clients.add(c);
  res.write('retry: 1500\n\n');
  sseWrite(c, snapshot(r, c));
  const ping = setInterval(() => { try { res.write(': ping ' + now() + '\n\n'); } catch (e) { /* closing */ } }, 15000);
  res.on('close', () => {
    clearInterval(ping); r.clients.delete(c);
    if (kind === 'v') {
      // announce the departure only if the same viewer did not come back (EventSource reconnects by itself)
      setTimeout(() => {
        if (room !== r) return;
        for (const x of r.clients) if (x.cid === c.cid) return;
        broadcast(r, { t: 'leave', name: c.name, members: members(r) });
      }, LEAVE_GRACE_MS).unref();
    }
  });
  return c;
}

// ---------- viewer encode ----------
async function buildViewer(r, tvSessId, pos) {
  const tv = PL.getSession(tvSessId);
  if (!tv || !tv.sopts) throw new Error('TV session unavailable');
  const m = PL.media();
  const old = r.vSession; r.vSession = null;
  if (old) { try { m.destroySession(old); } catch (e) { /* gone */ } }
  const opts = Object.assign({}, tv.sopts, { startSec: Math.max(0, pos || 0), party: true, lowBandwidth: false });
  const s = await m.createSession(opts);
  r.vSession = s.id; r.duration = s.duration;
  return s;
}
// Serialised: only the newest requested source is built (a burst of changes does not stack encodes).
function changeSource(r, tvSessId, pos, meta) {
  r.tvSession = tvSessId; r.epoch++;
  const epoch = r.epoch;
  if (meta) { r.title = meta.title || r.title; r.label = meta.label != null ? meta.label : r.label; }
  r.srcState = 'loading'; r.srcMsg = null;
  broadcast(r, { t: 'source', state: 'loading', epoch, title: r.title, label: r.label });
  const run = () => buildViewer(r, tvSessId, pos).then(() => {
    if (room !== r) { try { PL.media().destroySession(r.vSession); } catch (e) { /* ignore */ } return; }
    if (epoch !== r.epoch) return;
    r.srcState = 'ready';
    U.log('party viewer encode ready for session', r.vSession);
    broadcast(r, { t: 'source', state: 'ready', epoch, title: r.title, label: r.label, duration: r.duration, playlist: 'hls/index.m3u8?e=' + epoch, now: now(), pos: curPos(r), playing: r.st.playing, at: now() });
  }).catch(e => {
    if (epoch !== r.epoch) return;
    r.srcState = 'error'; r.srcMsg = U.cap(e.message, 100);
    U.log('party viewer encode failed:', e.message);
    broadcast(r, { t: 'source', state: 'error', epoch, msg: r.srcMsg });
  });
  r.building = (r.building || Promise.resolve()).then(() => (epoch === r.epoch ? run() : null));
}

// ---------- room lifecycle ----------
function publicUrl(r, req) {
  let base = U.getSettings().partyPublicBase;
  if (!base) base = 'http://' + (req.headers.host || 'localhost');
  return base.replace(/\/+$/, '') + '/w/' + r.token + '/';
}
function createRoom(body, req) {
  if (room) {
    // idempotent: the TV app may have restarted. A different TV session re-points the room.
    if (body && body.session && body.session !== room.tvSession && PL.getSession(body.session)) changeSource(room, body.session, +body.pos || 0, { title: body.title, label: body.label });
    room.lastTv = now();
    return roomInfo(room, req);
  }
  const tv = PL.getSession(String(body && body.session));
  if (!tv) throw new U.HttpError(404, 'unknown session', 'not_found');
  const pos = Math.max(0, +body.pos || 0);
  const r = room = {
    id: U.rid(18), token: U.rid(12), tvSession: null, vSession: null, duration: tv.duration || 0, title: U.cap(body.title || tv.title || '', 120), label: U.cap(body.label || '', 40),
    st: { playing: !!body.playing, pos, at: now() }, rev: 0, epoch: 0, srcState: 'loading', srcMsg: null, sub: { id: null, off: 0, label: '' },
    clients: new Set(), created: now(), lastTv: now(), lastCmd: 0, lastTs: 0, nviewers: 0, seq: 0
  };
  changeSource(r, tv.id, pos, null);
  U.log('party room created (viewer link token ***)');
  return roomInfo(r, req);
}
function roomInfo(r, req) {
  return { id: r.id, token: r.token, url: publicUrl(r, req), owner: ownerName(), viewers: members(r), max: MAX_VIEWERS, publicBase: !!U.getSettings().partyPublicBase };
}
function closeRoom(r, why) {
  if (room !== r) return;
  room = null;
  broadcast(r, { t: 'closed', why: why || 'closed' });
  for (const c of r.clients) { try { c.res.end(); } catch (e) { /* ignore */ } }
  r.clients.clear();
  if (r.vSession) { try { PL.media().destroySession(r.vSession); } catch (e) { /* gone */ } r.vSession = null; }
  U.log('party room closed:', why || 'closed');
}
setInterval(() => {
  const r = room; if (!r) return;
  if (now() - r.created > ROOM_MAX_MS) closeRoom(r, 'expired');
  else if (now() - r.lastTv > NO_TV_MS) closeRoom(r, 'tv_gone');
}, 20000).unref();

// ---------- commands ----------
function applyCmd(r, c, by) {
  const t = now(), st = r.st, cur = curPos(r);
  const a = c.a;
  let pos = isFinite(+c.pos) && c.pos !== null && c.pos !== '' ? +c.pos : cur;
  if (r.duration > 0) pos = Math.min(Math.max(0, pos), r.duration);
  if (a === 'play') { if (st.playing && Math.abs(cur - pos) < 1.0) return false; r.st = { playing: true, pos, at: t }; }
  else if (a === 'pause') { if (!st.playing && Math.abs(st.pos - pos) < 0.5) return false; r.st = { playing: false, pos, at: t }; }
  else if (a === 'seek') r.st = { playing: st.playing, pos, at: t };
  else throw new U.HttpError(400, 'bad command');
  r.rev++; r.lastCmd = t;
  broadcast(r, { t: 'cmd', a, pos: r.st.pos, playing: r.st.playing, at: t, rev: r.rev, by });
  return true;
}
function viewerIdent(r, q) {
  const cid = String(q.cid || '').replace(/[^\w-]/g, '').slice(0, 24) || U.rid(6);
  let name = String(q.name || '').replace(/[\r\n<>]/g, '').trim().slice(0, 20);
  const base = NAMES[U.normLang(q.lang)] || NAMES.en;
  if (!name) {
    const used = new Set(); for (const c of r.clients) if (c.kind === 'v' && c.cid !== cid) used.add(c.name);
    name = base; for (let i = 2; used.has(name); i++) name = base + ' ' + i;
  }
  return { cid, name };
}

// ---------- HTTP ----------
function json(res, o, s) { U.sendJson(res, s || 200, o); }
function noRoom() { return new U.HttpError(404, 'not found', 'not_found'); }
function pageHtml() { return fs.readFileSync(path.join(DIR, 'viewer.html')); }

// Viewer routes. `rest` is what follows /w/<token> (starts with '/' or is '').
async function handleViewer(req, res, url, body, token, rest) {
  const r = room && room.token === token ? room : null;
  if (!r) {
    const t = now(); badTokens = badTokens.filter(x => t - x < 60000); badTokens.push(t);
    throw badTokens.length > 60 ? new U.HttpError(429, 'slow down') : noRoom();
  }
  const m = req.method;
  if (rest === '') { res.writeHead(302, { location: token + '/' }); return res.end(); }
  if (rest === '/' && (m === 'GET' || m === 'HEAD')) {
    const b = pageHtml();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
    return res.end(m === 'HEAD' ? undefined : b);
  }
  if (rest === '/hls.js' && m === 'GET') {
    const b = fs.readFileSync(path.join(DIR, 'hls.min.js'));
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': b.length, 'cache-control': 'public, max-age=86400' });
    return res.end(b);
  }
  if (rest === '/time' && m === 'GET') return json(res, { now: now() });
  if (rest === '/events' && m === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    const ident = viewerIdent(r, q);
    let dup = false; for (const c of r.clients) if (c.kind === 'v' && c.cid === ident.cid) dup = true;
    if (!dup && members(r).length >= MAX_VIEWERS) throw new U.HttpError(403, 'room full', 'full');
    // keep the name stable across reconnects of the same viewer
    for (const c of r.clients) if (c.kind === 'v' && c.cid === ident.cid) ident.name = c.name;
    const first = !dup;
    sse(req, res, r, 'v', ident);
    if (first) { broadcast(r, { t: 'join', name: ident.name, members: members(r) }, c => c.cid !== ident.cid); r.lastJoin = now(); }
    return;
  }
  if (rest === '/cmd' && m === 'POST') {
    const who = viewerIdent(r, { cid: body.cid, name: body.name, lang: body.lang });
    for (const c of r.clients) if (c.kind === 'v' && c.cid === who.cid) who.name = c.name;
    applyCmd(r, body, { k: 'v', cid: who.cid, name: who.name });
    return json(res, { ok: true, rev: r.rev });
  }
  if (rest === '/subs' && m === 'GET') {
    const sub = r.sub;
    if (!sub.id || !r.tvSession) return json(res, { on: false, cues: [] });
    const off = sub.off || 0, from = +url.searchParams.get('from') || 0, to = +url.searchParams.get('to') || from + 60;
    let d;
    try { d = await PL.getSubs(r.tvSession, sub.id, Math.max(0, from - off), to - off); } catch (e) { return json(res, { on: true, id: sub.id, cues: [] }); }
    return json(res, { on: true, id: sub.id, label: sub.label, cues: (d.cues || []).map(c => [+(c[0] + off).toFixed(2), +(c[1] + off).toFixed(2), c[2]]) });
  }
  let x;
  if ((x = rest.match(/^\/hls\/index\.m3u8$/)) && (m === 'GET' || m === 'HEAD')) {
    if (!r.vSession) throw new U.HttpError(503, 'not ready', 'not_ready');
    return PL.media().handlePlaylist(req, res, r.vSession);
  }
  if ((x = rest.match(/^\/hls\/(\d+)\.ts$/)) && m === 'GET') {
    if (!r.vSession) throw new U.HttpError(503, 'not ready', 'not_ready');
    return PL.media().handleSegment(req, res, r.vSession, +x[1]);
  }
  throw noRoom();
}

// TV routes under /api/party
async function handleTv(req, res, url, body, p) {
  const m = req.method;
  if (p === '/api/party' && m === 'GET') return json(res, room ? roomInfo(room, req) : { id: null });
  if (p === '/api/party' && m === 'POST') return json(res, createRoom(body, req));
  const x = p.match(/^\/api\/party\/([\w-]+)\/(events|cmd|state|time)$/), d = p.match(/^\/api\/party\/([\w-]+)$/);
  const id = x ? x[1] : d ? d[1] : null;
  if (!id) throw noRoom();
  const r = room && room.id === id ? room : null;
  if (!r) throw noRoom();
  if (d && m === 'DELETE') { closeRoom(r, 'owner'); return json(res, { ok: true }); }
  if (!x) throw noRoom();
  r.lastTv = now();
  if (x[2] === 'time' && m === 'GET') return json(res, { now: now() });
  if (x[2] === 'events' && m === 'GET') { sse(req, res, r, 'tv', { cid: 'tv', name: ownerName() }); return; }
  if (x[2] === 'cmd' && m === 'POST') {
    applyCmd(r, body, { k: 'tv', cid: 'tv', name: ownerName() });
    return json(res, { ok: true, rev: r.rev });
  }
  if (x[2] === 'state' && m === 'POST') {
    // periodic tick from the TV: truth about the position + current source/subtitle choice
    const t = now();
    // ticks can overtake each other (two connections, a busy server): only the newest one counts
    if (isFinite(+body.ts)) { if (+body.ts < r.lastTs) return json(res, { ok: true, now: t, stale: true, viewers: members(r) }); r.lastTs = +body.ts; }
    let sid = body.session ? String(body.session) : null;
    if (sid && sid !== r.tvSession && !PL.getSession(sid)) sid = null; // a session that no longer exists is never followed
    if (body.title != null || body.label != null) { r.title = U.cap(body.title || r.title, 120); r.label = U.cap(body.label != null ? body.label : r.label, 40); }
    if (sid && sid !== r.tvSession) {
      r.st = { playing: !!body.playing, pos: Math.max(0, +body.pos || 0), at: t };
      changeSource(r, sid, r.st.pos, { title: body.title, label: body.label });
    } else if (t - r.lastCmd > CMD_QUIET_MS && isFinite(+body.pos)) {
      r.st = { playing: !!body.playing, pos: Math.max(0, +body.pos), at: t };
      broadcast(r, { t: 'sync', pos: r.st.pos, playing: r.st.playing, at: t });
    }
    const sb = body.sub || {};
    const nid = sb.id || null, noff = +sb.off || 0;
    if (nid !== r.sub.id || noff !== r.sub.off) {
      r.sub = { id: nid, off: noff, label: U.cap(sb.label || '', 60) };
      broadcast(r, { t: 'sub', on: !!nid, label: r.sub.label });
    }
    return json(res, { ok: true, now: t, viewers: members(r) });
  }
  throw noRoom();
}

// Returns true if the request was handled here.
async function handle(req, res, url, p, body) {
  let x;
  if ((x = p.match(/^\/w\/([\w-]{8,64})(\/.*)?$/))) { await handleViewer(req, res, url, body, x[1], x[2] || ''); return true; }
  if (p === '/api/party' || p.startsWith('/api/party/')) { await handleTv(req, res, url, body, p); return true; }
  return false;
}

module.exports = { handle, _state: () => room, closeAll: () => { if (room) closeRoom(room, 'shutdown'); } };
