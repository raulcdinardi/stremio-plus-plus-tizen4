'use strict';
// Library / progress / watched / rating state. Local sqlite is an overlay; the Stremio account library is synced (throttled).
const U = require('../util');
const S = require('./stremio');
const M = require('./meta');
const { Watched, orderedVideoIds } = require('./bitfield');
const db = U.db;
const now = () => Date.now();
const iso = t => new Date(t || now()).toISOString();
const tms = s => (s ? Date.parse(s) || 0 : 0);

const q = {
  progGet: db.prepare('SELECT * FROM progress WHERE item=? AND video=?'),
  progItem: db.prepare('SELECT * FROM progress WHERE item=? ORDER BY ts DESC'),
  progAll: db.prepare('SELECT * FROM progress ORDER BY ts DESC LIMIT 200'),
  progSet: db.prepare('INSERT INTO progress(item,video,type,name,pos,dur,ts,watched) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(item,video) DO UPDATE SET type=excluded.type,name=excluded.name,pos=excluded.pos,dur=excluded.dur,ts=excluded.ts,watched=excluded.watched'),
  libGet: db.prepare('SELECT * FROM libloc WHERE item=?'),
  libSet: db.prepare('INSERT INTO libloc(item,type,name,poster,inlib,ts) VALUES(?,?,?,?,?,?) ON CONFLICT(item) DO UPDATE SET type=excluded.type,name=excluded.name,poster=excluded.poster,inlib=excluded.inlib,ts=excluded.ts'),
  rateGet: db.prepare('SELECT rating FROM ratings WHERE item=?'),
  rateSet: db.prepare('INSERT INTO ratings(item,type,rating,ts) VALUES(?,?,?,?) ON CONFLICT(item) DO UPDATE SET type=excluded.type,rating=excluded.rating,ts=excluded.ts'),
  rateDel: db.prepare('DELETE FROM ratings WHERE item=?'),
  histLast: db.prepare('SELECT * FROM history WHERE item=? AND video=? ORDER BY ts DESC LIMIT 1'),
  histIns: db.prepare('INSERT INTO history(item,video,type,name,poster,start_ts,ts,start_pos,pos,dur,completed) VALUES(?,?,?,?,?,?,?,?,?,?,?)'),
  histUpd: db.prepare('UPDATE history SET ts=?, pos=?, dur=?, completed=MAX(completed, ?), name=COALESCE(NULLIF(?, \'\'), name), poster=COALESCE(NULLIF(?, \'\'), poster) WHERE id=?'),
  histList: db.prepare('SELECT * FROM history ORDER BY ts DESC LIMIT ?'),
  histAll: db.prepare('SELECT * FROM history ORDER BY ts')
};

function overlayValid(rowTs, libItem) { return !libItem || rowTs + 2000 >= tms(libItem._mtime); }

// -------- read side --------
function inLibrary(itemId, libItem) {
  const r = q.libGet.get(itemId);
  if (r && overlayValid(r.ts, libItem)) return !!r.inlib;
  return !!(libItem && !libItem.removed && !libItem.temp);
}
function userRating(itemId) { const r = q.rateGet.get(itemId); return r ? r.rating : null; }

// returns {isWatched(videoId), progress(videoId)->0..1, resume}
function videoStates(itemId, meta, libItem) {
  const rows = new Map(q.progItem.all(itemId).map(r => [r.video, r]));
  const ids = orderedVideoIds(meta.videos);
  const w = libItem && libItem.state && libItem.state.watched ? Watched.from(libItem.state.watched, ids) : Watched.empty(ids);
  const st = (libItem && libItem.state) || {};
  const isWatched = vid => {
    const r = rows.get(vid);
    if (r && overlayValid(r.ts, libItem) && r.watched !== 0) return r.watched === 1;
    if (!meta.videos.length) return (st.timesWatched || 0) > 0 || (r && r.watched === 1) || false;
    return w.get(vid);
  };
  const progress = vid => {
    const r = rows.get(vid);
    if (r && r.watched === 0 && r.dur > 0 && r.pos > 5 && overlayValid(r.ts, libItem)) return Math.min(1, r.pos / r.dur);
    if (st.video_id === vid && st.timeOffset > 1000 && st.duration > 0) return Math.min(1, st.timeOffset / st.duration);
    return 0;
  };
  return { isWatched, progress, rows, st };
}

function resumeFor(itemId, meta, libItem, V) {
  const st = V.st;
  const cands = [];
  const latest = q.progItem.all(itemId)[0];
  if (latest && overlayValid(latest.ts, libItem)) cands.push({ ts: latest.ts, video: latest.video, pos: latest.pos, done: latest.watched === 1 });
  if (st.video_id) cands.push({ ts: tms(st.lastWatched), video: st.video_id, pos: (st.timeOffset || 0) / 1000, done: false, lib: true });
  cands.sort((a, b) => b.ts - a.ts);
  let c = cands[0];
  if (!c) return null;
  if (!meta.videos.length) { // movie
    if (c.done || V.progress(itemId) >= 0.9 || c.pos <= 5) return null;
    return { videoId: itemId, positionSec: Math.round(c.pos), label: null };
  }
  let vid = c.video, pos = c.pos;
  if (c.done) { const n = M.nextVideo(meta, vid); if (!n) return null; vid = n.id; pos = 0; }
  const pr = V.progress(vid);
  if (pr >= 0.9) { const n = M.nextVideo(meta, vid); if (!n) return null; vid = n.id; pos = 0; }
  if (pos <= 1) pos = 0;
  // A pointer to an already-watched episode or an untouched special: continue at the first
  // unwatched regular episode after the last watched one (what "next up" means to the user).
  if (pos === 0 && (V.isWatched(vid) || (U.parseVideoId(vid) || {}).season === 0)) {
    const regular = M.sortedVideos(meta).filter(v => v.season > 0);
    let last = -1;
    regular.forEach((v, i) => { if (V.isWatched(v.id)) last = i; });
    const n = regular.slice(last + 1).find(v => !V.isWatched(v.id));
    if (n) vid = n.id;
  }
  const p = U.parseVideoId(vid);
  return { videoId: vid, positionSec: Math.round(pos), label: U.label(p.season, p.episode, p.kitsu) };
}

async function buildMetaResponse(type, id) {
  const meta = await M.fetchMeta(type, id);
  const lib = await S.library();
  const li = lib.get(meta.id) || lib.get(id) || null;
  const V = videoStates(meta.id, meta, li);
  const seasons = [...new Set(meta.videos.map(v => v.season))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  const thumbs = meta.videos.length <= 200;
  const out = {
    id: meta.id, type: meta.type, name: meta.name, year: meta.year, description: meta.description,
    poster: U.imgUrl(meta.poster, 300), background: U.imgUrl(meta.background, 1280), logo: logoUrl(meta), genres: meta.genres, runtime: meta.runtime,
    imdbRating: meta.imdbRating, userRating: userRating(meta.id), inLibrary: inLibrary(meta.id, li), seasons,
    videos: M.sortedVideos(meta).map(v => {
      const o = { id: v.id, season: v.season, episode: v.episode, title: v.title, released: v.released, watched: V.isWatched(v.id), progress: +V.progress(v.id).toFixed(3) };
      if (thumbs && v.thumbnail) o.thumbnail = U.imgUrl(v.thumbnail, 240);
      return o;
    }),
    resume: resumeFor(meta.id, meta, li, V)
  };
  if (meta.type === 'movie') { out.watched = V.isWatched(meta.id); out.progress = +V.progress(meta.id).toFixed(3); }
  return out;
}

function logoUrl(meta) {
  const u = meta.logo || (/^tt\d+$/.test(meta.id) ? 'https://images.metahub.space/logo/medium/' + meta.id + '/img' : null);
  return u ? U.imgUrl(u, 400) + '&f=png' : null;
}
// -------- library list (non-removed items, newest watched first) --------
async function libraryList() {
  const lib = await S.library();
  const out = [];
  for (const it of lib.values()) {
    if (it.removed || it.temp) continue;
    out.push({ id: it._id, type: it.type === 'movie' ? 'movie' : 'series', name: U.cap(it.name, 80), poster: U.imgUrl(it.poster, 170), ts: tms((it.state || {}).lastWatched) || tms(it._mtime) || 0 });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, 120).map(o => { delete o.ts; return o; });
}
// -------- continue watching --------
function metahubBg(id) { return /^tt\d+$/.test(id) ? 'https://images.metahub.space/background/medium/' + id + '/img' : null; }
async function continueRow() {
  const lib = await S.library();
  const cand = new Map();
  for (const it of lib.values()) {
    if (it.removed || it.temp) continue;
    const s = it.state || {};
    if (!s.lastWatched) continue;
    const recent = now() - tms(s.lastWatched) < 120 * 86400000;
    if (!(s.timeOffset > 0) && !(it.type === 'series' && recent && s.video_id)) continue;
    cand.set(it._id, { id: it._id, type: it.type === 'movie' ? 'movie' : 'series', name: it.name, poster: it.poster, ts: tms(s.lastWatched), li: it });
  }
  for (const r of q.progAll.all()) { // items played through Stremio++ (incl. temp/removed ones in the account)
    const c = cand.get(r.item);
    if (c && c.ts >= r.ts) continue;
    if (!c) {
      const li = lib.get(r.item);
      if (li && !li.removed && !li.temp && false) continue;
      cand.set(r.item, { id: r.item, type: r.type === 'movie' ? 'movie' : 'series', name: r.name, poster: li && li.poster, ts: r.ts, li: li || null });
    } else c.ts = r.ts;
  }
  const list = [...cand.values()].sort((a, b) => b.ts - a.ts).slice(0, 24);
  const out = await Promise.all(list.map(async (c, idx) => {
    try {
      if (c.type === 'movie') {
        const V = videoStates(c.id, { videos: [] }, c.li);
        const rows = q.progItem.all(c.id);
        const r = rows[0];
        let pos = 0, dur = 0, done = false;
        if (r && overlayValid(r.ts, c.li)) { pos = r.pos; dur = r.dur; done = r.watched === 1; }
        else if (c.li) { pos = (c.li.state.timeOffset || 0) / 1000; dur = (c.li.state.duration || 0) / 1000; }
        if (done || pos <= 5 || dur <= 0 || pos / dur >= 0.9) return null;
        return { id: c.id, type: 'movie', name: U.cap(c.name, 80), poster: U.imgUrl(c.poster, 150), background: U.imgUrl(metahubBg(c.id), 480), progress: +(pos / dur).toFixed(3), label: null, videoId: c.id, positionSec: Math.round(pos), durationSec: Math.round(dur) };
      }
      if (idx >= 14) return null;
      const meta = await M.fetchMeta('series', c.id);
      const V = videoStates(c.id, meta, c.li);
      const res = resumeFor(c.id, meta, c.li, V);
      if (!res) return null;
      const pr = V.progress(res.videoId);
      const o = { id: c.id, type: 'series', name: U.cap(c.name || meta.name, 80), poster: U.imgUrl(c.poster || meta.poster, 150), background: U.imgUrl(metahubBg(c.id) || meta.background, 480), progress: pr, label: res.label, videoId: res.videoId, positionSec: res.positionSec };
      const row = V.rows.get(res.videoId);
      if (row && row.dur) o.durationSec = Math.round(row.dur); else if (V.st.video_id === res.videoId && V.st.duration) o.durationSec = Math.round(V.st.duration / 1000);
      return o;
    } catch (e) { U.log('continue item failed', c.id, e.message); return null; }
  }));
  return out.filter(Boolean).slice(0, 20);
}

// -------- write side --------
function newLibItem(itemId, type, name, poster, year) {
  const t = iso();
  return { _id: itemId, removed: true, temp: true, _ctime: t, _mtime: t, name: name || itemId, type: type === 'movie' ? 'movie' : 'series',
    poster: poster || '', background: '', logo: '', year: year || '', state: { lastWatched: t, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: '', watched: '', noNotif: false, season: 0, episode: 0 } };
}
async function freshItem(itemId, hint) {
  const it = await S.libraryItem(itemId);
  if (it) return it;
  let h = hint || {};
  if (!h.poster || !h.name) { try { const m = await M.fetchMeta(h.type || 'series', itemId); h = Object.assign({}, h, { name: h.name || m.name, poster: h.poster || m.poster, year: m.year, type: m.type }); } catch (e) { /* ignore */ } }
  return newLibItem(itemId, h.type, h.name, h.poster, h.year);
}
async function metaOrNull(type, id) { try { return await M.fetchMeta(type, id); } catch (e) { return null; } }

const lastFlush = new Map(), pending = new Map(), timers = new Map();
async function flushProgress(itemId) {
  const b = pending.get(itemId); if (!b) return;
  pending.delete(itemId);
  const t = timers.get(itemId); if (t) { clearTimeout(t); timers.delete(itemId); }
  const prevFlush = lastFlush.get(itemId) || 0;
  lastFlush.set(itemId, now());
  try {
    const type = b.type === 'movie' ? 'movie' : 'series';
    const item = await freshItem(itemId, { type, name: b.name });
    const meta = type === 'series' ? await metaOrNull('series', itemId) : null;
    const st = item.state = item.state || {};
    const pos = Math.max(0, +b.positionSec || 0), dur = Math.max(0, +b.durationSec || 0);
    const p = U.parseVideoId(b.videoId || itemId);
    const el = prevFlush && now() - prevFlush < 120000 && b.state !== 'paused' ? now() - prevFlush : 0;
    st.timeWatched = (st.timeWatched || 0) + el; st.overallTimeWatched = (st.overallTimeWatched || 0) + el;
    st.lastWatched = iso(); st.video_id = b.videoId || itemId; st.timeOffset = Math.round(pos * 1000); st.duration = Math.round(dur * 1000);
    st.season = p.season || 0; st.episode = p.episode || 0;
    const finished = dur > 0 && pos / dur >= 0.9;
    if (finished) {
      if (type === 'series' && meta) {
        const ids = orderedVideoIds(meta.videos);
        const w = Watched.from(st.watched, ids); w.set(b.videoId, true); st.watched = w.serialize();
        const n = M.nextVideo(meta, b.videoId);
        if (n) { st.overallTimeWatched += st.timeWatched; st.video_id = n.id; st.timeWatched = 0; st.flaggedWatched = 0; st.timeOffset = 1; }
        else st.timeOffset = 0;
      } else { st.timesWatched = Math.max(1, st.timesWatched || 0); st.flaggedWatched = 1; st.timeOffset = 0; }
    }
    item._mtime = iso();
    await S.putLibraryItem(item);
  } catch (e) { U.log('progress sync failed:', e.message); }
}
// -------- own watch history (append-only per viewing; independent of Stremio) --------
// A viewing = continuous activity on one video; a gap > 3 h starts a new row.
function recordHistory(itemId, videoId, b, pos, dur, finished) {
  try {
    const t = now(), last = q.histLast.get(itemId, videoId);
    const loc = q.libGet.get(itemId);
    const poster = (loc && loc.poster) || '';
    if (last && t - last.ts < 3 * 3600e3) q.histUpd.run(t, pos, dur, finished ? 1 : 0, U.cap(b.name || '', 80), poster, last.id);
    else q.histIns.run(itemId, videoId, b.type === 'movie' ? 'movie' : 'series', U.cap(b.name || '', 80), poster, t, t, pos, pos, dur, finished ? 1 : 0);
    if (b.state === 'stopped' || b.state === 'ended' || finished) exportHistory();
  } catch (e) { U.log('history write failed:', e.message); }
}
// seed history once from the older per-episode progress table
try {
  if (db.prepare('SELECT COUNT(*) n FROM history').get().n === 0) {
    for (const r of db.prepare('SELECT * FROM progress ORDER BY ts').all())
      q.histIns.run(r.item, r.video, r.type, r.name, '', r.ts, r.ts, r.pos, r.pos, r.dur, r.watched === 1 ? 1 : 0);
  }
} catch (e) { /* ignore */ }
let exportTimer = null;
function exportHistory() {
  if (exportTimer) return;
  exportTimer = setTimeout(() => {
    exportTimer = null;
    try {
      const fs = require('fs'), path = require('path');
      const rows = q.histAll.all().map(r => ({ item: r.item, video: r.video, type: r.type, name: r.name,
        started: new Date(r.start_ts).toISOString(), last: new Date(r.ts).toISOString(), from_sec: Math.round(r.start_pos), to_sec: Math.round(r.pos), duration_sec: Math.round(r.dur), completed: !!r.completed }));
      const f = path.join(U.STATE, 'historico.json');
      fs.writeFileSync(f + '.tmp', JSON.stringify(rows, null, 1)); fs.renameSync(f + '.tmp', f);
    } catch (e) { U.log('history export failed:', e.message); }
  }, 2000);
  exportTimer.unref();
}
async function historyList(limit) {
  const rows = q.histList.all(Math.min(300, +limit || 120));
  const out = [];
  for (const r of rows) {
    let poster = r.poster;
    if (!poster) { const loc = q.libGet.get(r.item); poster = loc && loc.poster; }
    if (!poster) { try { const m = await M.fetchMeta(r.type, r.item); poster = m.poster; } catch (e) { /* no poster */ } }
    const v = U.parseVideoId(r.video);
    const ep = r.type === 'series' ? U.label(v.season, v.episode, v.kitsu) : null;
    const pct = r.dur > 0 ? Math.round(100 * r.pos / r.dur) : null;
    out.push({ id: r.item, type: r.type, name: r.name || r.item, poster: U.imgUrl(poster, 170), videoId: r.video, positionSec: Math.round(r.pos), durationSec: Math.round(r.dur),
      label: [ep, U.shortDate(r.ts), r.completed ? U.t('hist.watched') : (pct != null ? pct + '%' : null)].filter(Boolean).join(' · ') });
  }
  return out;
}

async function progress(b) {
  if (!b || !b.itemId) throw new U.HttpError(400, 'itemId required');
  const itemId = String(b.itemId), videoId = String(b.videoId || itemId);
  const pos = Math.max(0, +b.positionSec || 0), dur = Math.max(0, +b.durationSec || 0);
  const finished = dur > 0 && pos / dur >= 0.9;
  const prev = q.progGet.get(itemId, videoId);
  const watched = finished ? 1 : (prev && prev.watched === 1 && pos / (dur || 1) > 0.5 ? 1 : 0);
  q.progSet.run(itemId, videoId, b.type === 'movie' ? 'movie' : 'series', U.cap(b.name || '', 80), pos, dur, now(), watched);
  // tracker sync (MAL / Letterboxd): once per viewing, when it first crosses the finished threshold; queued, never blocks
  const lastView = finished ? q.histLast.get(itemId, videoId) : null;
  const viewDone = !!(lastView && now() - lastView.ts < 3 * 3600e3 && lastView.completed);
  recordHistory(itemId, videoId, b, pos, dur, finished);
  if (finished && !viewDone) require('./trackers').onFinished({ itemId, videoId, type: b.type, name: b.name });
  pending.set(itemId, { itemId, videoId, type: b.type, name: b.name, positionSec: pos, durationSec: dur, state: b.state });
  const stopping = b.state === 'stopped' || b.state === 'ended' || b.state === 'paused';
  const since = now() - (lastFlush.get(itemId) || 0);
  if (stopping || since >= 60000) { await flushProgress(itemId); return { ok: true, synced: true, watched: !!watched }; }
  if (!timers.has(itemId)) { const t = setTimeout(() => flushProgress(itemId), Math.max(1000, 60000 - since)); t.unref(); timers.set(itemId, t); }
  return { ok: true, synced: false, watched: !!watched };
}

async function setWatched(b) {
  if (!b || !b.itemId) throw new U.HttpError(400, 'itemId required');
  const itemId = String(b.itemId), w = !!b.watched;
  const item = await freshItem(itemId, { type: b.type });
  const type = item.type === 'movie' ? 'movie' : 'series';
  const meta = type === 'series' ? await M.fetchMeta('series', itemId) : null;
  const st = item.state = item.state || {};
  let targets;
  if (type === 'movie') targets = [itemId];
  else if (b.videoId) targets = [String(b.videoId)];
  else targets = meta.videos.filter(v => v.season !== 0).map(v => v.id);
  const t = now();
  for (const v of targets) { const r = q.progGet.get(itemId, v); q.progSet.run(itemId, v, type, item.name, w ? (r ? r.pos : 0) : 0, r ? r.dur : 0, t, w ? 1 : -1); }
  if (type === 'series') {
    const w2 = Watched.from(st.watched, orderedVideoIds(meta.videos));
    for (const v of targets) w2.set(v, w);
    st.watched = w2.serialize();
    if (!w && targets.includes(st.video_id)) st.timeOffset = 0;
    if (w && targets.includes(st.video_id)) { const n = M.nextVideo(meta, st.video_id); if (n) { st.video_id = n.id; st.timeOffset = 1; st.timeWatched = 0; } else st.timeOffset = 0; }
  } else { st.timesWatched = w ? Math.max(1, st.timesWatched || 0) : 0; st.timeOffset = 0; st.flaggedWatched = w ? 1 : 0; }
  if (w) st.lastWatched = iso();
  item._mtime = iso();
  const r = await S.putLibraryItem(item);
  return { ok: true, count: targets.length, synced: r.written };
}

async function setLibrary(b) {
  if (!b || !b.itemId) throw new U.HttpError(400, 'itemId required');
  const itemId = String(b.itemId), add = !!b.add;
  const item = await freshItem(itemId, { type: b.type });
  item.removed = !add;
  if (add) item.temp = false;
  item._mtime = iso();
  q.libSet.run(itemId, item.type, item.name, item.poster, add ? 1 : 0, now());
  const r = await S.putLibraryItem(item);
  return { ok: true, inLibrary: add, synced: r.written };
}

async function rate(b) {
  if (!b || !b.itemId) throw new U.HttpError(400, 'itemId required');
  const itemId = String(b.itemId);
  let rating = b.rating == null ? null : Math.round(+b.rating);
  if (rating != null && !(rating >= 1 && rating <= 10)) throw new U.HttpError(400, 'rating 1..10 or null');
  if (rating == null) q.rateDel.run(itemId); else q.rateSet.run(itemId, b.type || '', rating, now());
  let trakt = 'skipped';
  const sec = U.secrets;
  if (sec.traktClientId && sec.traktToken) {
    try {
      const meta = await M.fetchMeta(b.type === 'movie' ? 'movie' : 'series', itemId);
      if (meta.imdb) {
        const o = { ids: { imdb: meta.imdb } }; if (rating != null) o.rating = rating;
        const body = meta.type === 'movie' ? { movies: [o] } : { shows: [o] };
        const r = await U.fetchRaw('https://api.trakt.tv/sync/ratings' + (rating == null ? '/remove' : ''), { method: 'POST', json: body, timeout: 8000,
          headers: { 'trakt-api-version': '2', 'trakt-api-key': sec.traktClientId, authorization: 'Bearer ' + sec.traktToken } });
        trakt = r.ok ? 'ok' : 'http ' + r.status;
      }
    } catch (e) { trakt = 'error'; U.log('trakt rate failed:', e.message); }
  }
  return { ok: true, rating, trakt };
}

module.exports = { historyList, exportHistory, libraryList, buildMetaResponse, continueRow, progress, setWatched, setLibrary, rate, flushProgress, videoStates, inLibrary, userRating, freshItem };
