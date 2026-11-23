'use strict';
// 0–100 ratings + MyAnimeList / Letterboxd sync.
// Everything that talks to a tracker goes through a persistent sqlite queue (trk_jobs) drained by a background worker
// with retries/backoff, so playback and the rating prompt never wait on the network.
//
// Scaling rules
//  - score 0..100 per episode / movie. 0 = "watched, no rating": stored, but never sent as a rating.
//  - MAL (whole entry, 1..10): mean of the owner's non-zero episode scores whose episodes map to that MAL entry,
//    /10, rounded, clamped to 1..10 (a MAL anime film uses its own score the same way).
//  - Letterboxd (0.5..5 half stars): round(score/20 to the nearest 0.5), min 0.5; score 0 -> logged without stars.
const U = require('../util');
const MAL = require('../trackers/mal');
const LB = require('../trackers/letterboxd');
const MAP = require('../trackers/mapping');

const db = U.db;
db.exec(`
CREATE TABLE IF NOT EXISTS rate100(item TEXT, video TEXT, type TEXT, name TEXT, score INTEGER, ts INTEGER, mal_id INTEGER, PRIMARY KEY(item, video));
CREATE TABLE IF NOT EXISTS trk_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT, key TEXT, payload TEXT, status TEXT, attempts INTEGER DEFAULT 0, due INTEGER, created INTEGER, updated INTEGER, result TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS trk_jobs_due ON trk_jobs(status, due);
`);
const q = {
  rGet: db.prepare('SELECT * FROM rate100 WHERE item=? AND video=?'),
  rSet: db.prepare('INSERT INTO rate100(item,video,type,name,score,ts) VALUES(?,?,?,?,?,?) ON CONFLICT(item,video) DO UPDATE SET type=excluded.type,name=COALESCE(NULLIF(excluded.name,\'\'),name),score=excluded.score,ts=excluded.ts'),
  rDel: db.prepare('DELETE FROM rate100 WHERE item=? AND video=?'),
  rMal: db.prepare('UPDATE rate100 SET mal_id=? WHERE item=? AND video=?'),
  rAvg: db.prepare('SELECT AVG(score) a, COUNT(*) n FROM rate100 WHERE mal_id=? AND score>0'),
  jPending: db.prepare("SELECT * FROM trk_jobs WHERE key=? AND status='pending' ORDER BY id DESC LIMIT 1"),
  jIns: db.prepare("INSERT INTO trk_jobs(service,key,payload,status,attempts,due,created,updated) VALUES(?,?,?,'pending',0,?,?,?)"),
  jUpd: db.prepare('UPDATE trk_jobs SET payload=?, due=?, updated=? WHERE id=?'),
  jNext: db.prepare("SELECT * FROM trk_jobs WHERE status='pending' AND due<=? ORDER BY due LIMIT 1"),
  jSet: db.prepare('UPDATE trk_jobs SET status=?, attempts=?, due=?, updated=?, result=?, error=? WHERE id=?'),
  jReset: db.prepare("UPDATE trk_jobs SET status='pending' WHERE status='running'"),
  jCount: db.prepare('SELECT service, status, COUNT(*) n FROM trk_jobs GROUP BY service, status'),
  jRecent: db.prepare('SELECT id,service,payload,status,attempts,due,updated,result,error FROM trk_jobs ORDER BY updated DESC LIMIT ?'),
  jPrune: db.prepare("DELETE FROM trk_jobs WHERE status IN ('done','skipped','failed') AND updated < ?")
};

const now = () => Date.now();
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in the server's local time zone
const BACKOFF = [60e3, 5 * 60e3, 15 * 60e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3];
const LB_DELAY = +process.env.SPP_LB_DELAY_MS || 120e3;   // window for the post-movie rating prompt to merge into the diary entry
const MAL_DELAY = +process.env.SPP_MAL_DELAY_MS || 20e3;

// ---------- config / state ----------
function cfg() {
  const c = U.kvGet('trackers', {});
  const out = { mal: Object.assign({ dryRun: false }, c.mal), letterboxd: Object.assign({ enabled: false, dryRun: false }, c.letterboxd) };
  if (process.env.SPP_TRACKERS_DRYRUN === '1') { out.mal.dryRun = true; out.letterboxd.dryRun = true; }
  return out;
}
function setCfg(b) {
  const c = U.kvGet('trackers', {});
  for (const s of ['mal', 'letterboxd']) {
    if (!b || !b[s] || typeof b[s] !== 'object') continue;
    c[s] = c[s] || {};
    for (const k of s === 'mal' ? ['dryRun'] : ['enabled', 'dryRun']) if (b[s][k] !== undefined) c[s][k] = !!b[s][k];
  }
  U.kvSet('trackers', c);
  return status();
}
const isLinked = s => (s === 'mal' ? MAL.linked() : cfg().letterboxd.enabled);
function noteState(s, patch) { const st = U.kvGet('trk.state', {}); st[s] = Object.assign({}, st[s], patch); U.kvSet('trk.state', st); }

// ---------- queue ----------
function enqueue(service, key, patch, delay) {
  const t = now(), cur = q.jPending.get(key);
  if (cur) {
    const p = JSON.parse(cur.payload);
    const merged = Object.assign(p, patch, { watched: !!(p.watched || patch.watched), rated: !!(p.rated || patch.rated) });
    q.jUpd.run(JSON.stringify(merged), Math.min(cur.due, t + delay), t, cur.id);
    return cur.id;
  }
  return Number(q.jIns.run(service, key, JSON.stringify(Object.assign({ watched: false, rated: false }, patch)), t + delay, t, t).lastInsertRowid);
}

// Completion hook, called by library.progress when a viewing first crosses the "finished" threshold. Never throws.
function onFinished(b) {
  try {
    const itemId = String(b.itemId), videoId = String(b.videoId || itemId), type = b.type === 'movie' ? 'movie' : 'series';
    const base = { itemId, videoId, type, name: U.cap(b.name || '', 80), date: today() };
    const kitsu = U.parseVideoId(itemId).kitsu;
    if (type === 'movie') {
      if (isLinked('letterboxd')) enqueue('letterboxd', 'lb:' + itemId + ':' + base.date, Object.assign({}, base, { watched: true }), LB_DELAY);
      if (isLinked('mal')) enqueue('mal', 'mal:' + videoId, Object.assign({}, base, { watched: true, quiet: !kitsu }), MAL_DELAY);
    } else if (isLinked('mal')) enqueue('mal', 'mal:' + videoId, Object.assign({}, base, { watched: true }), MAL_DELAY);
  } catch (e) { U.log('tracker enqueue failed:', e.message); }
}

// ---------- ratings API ----------
function getRate100(itemId, videoId) {
  if (!itemId) throw new U.HttpError(400, 'itemId required');
  const r = q.rGet.get(String(itemId), String(videoId || itemId));
  return { score: r ? r.score : null };
}
function postRate100(b) {
  if (!b || !b.itemId) throw new U.HttpError(400, 'itemId required');
  const itemId = String(b.itemId), videoId = String(b.videoId || itemId), type = b.type === 'movie' ? 'movie' : 'series';
  let score = b.score;
  if (score !== null) { score = Math.round(+score); if (!(score >= 0 && score <= 100)) throw new U.HttpError(400, 'score 0..100 or null'); }
  if (score === null) q.rDel.run(itemId, videoId); else q.rSet.run(itemId, videoId, type, U.cap(b.name || '', 80), score, now());
  const sync = { mal: 'not_linked', letterboxd: 'not_linked' };
  const base = { itemId, videoId, type, name: U.cap(b.name || '', 80), date: today(), rated: true };
  try {
    if (isLinked('mal')) {
      const kitsu = U.parseVideoId(itemId).kitsu;
      enqueue('mal', 'mal:' + videoId, Object.assign({}, base, type === 'movie' && !kitsu ? { quiet: true } : {}), MAL_DELAY);
      sync.mal = 'queued';
    }
    if (isLinked('letterboxd')) {
      if (type === 'movie') { enqueue('letterboxd', 'lb:' + itemId + ':' + base.date, base, 5000); sync.letterboxd = 'queued'; }
      else sync.letterboxd = 'skipped';
    }
  } catch (e) { U.log('tracker enqueue failed:', e.message); }
  return { ok: true, score, sync };
}

// ---------- worker ----------
class Skip extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }
const PERMANENT = new Set(['unmapped', 'not_film', 'has_review', 'no_entry', 'not_anime']);

function malScoreFor(malId, p) {
  if (p.type === 'movie') { const r = q.rGet.get(p.itemId, p.videoId); return r && r.score > 0 ? Math.min(10, Math.max(1, Math.round(r.score / 10))) : null; }
  const r = q.rAvg.get(malId);
  return r && r.n ? Math.min(10, Math.max(1, Math.round(r.a / 10))) : null;
}

async function runMal(p) {
  const c = cfg().mal;
  const m = await MAP.malFor(p.itemId, p.videoId, p.type);
  if (!m) throw new Skip(p.quiet ? 'not_anime' : 'unmapped');
  q.rMal.run(m.mal, p.itemId, p.videoId);
  const a = await MAL.anime(m.mal);
  if (m.movie && a.media_type !== 'movie') throw new Skip('not_anime');
  if (m.fallback && a.num_episodes && a.num_episodes !== m.imdbCount) throw new Skip('unmapped', 'episode counts differ');
  const score = malScoreFor(m.mal, p);
  const patch = p.watched ? MAL.planWatched(a, m.ep, score, p.date) : MAL.planScore(a, score);
  const what = { mal: m.mal, title: U.cap(a.title || '', 60), ep: m.ep, patch };
  if (!Object.keys(patch).length) return Object.assign(what, { op: 'no_change' });
  if (c.dryRun) return Object.assign(what, { op: 'dry_run' });
  await MAL.update(m.mal, patch);
  return Object.assign(what, { op: 'updated' });
}

async function runLetterboxd(p) {
  const c = cfg().letterboxd;
  if (p.type !== 'movie') throw new Skip('not_film');
  const imdb = await MAP.imdbFor(p.itemId, 'movie');
  if (!imdb) throw new Skip('unmapped');
  const r = q.rGet.get(p.itemId, p.videoId);
  const stars = LB.starsFrom100(r ? r.score : null);
  const res = p.watched ? await LB.logFilm({ imdb, date: p.date, stars, dryRun: c.dryRun }) : await LB.rateEntry({ imdb, date: p.date, stars, dryRun: c.dryRun });
  const what = { imdb, stars, film: res.film && res.film.name, op: res.status, would: res.would, diaryCount: res.diaryCount };
  if (res.loggedIn) U.kvSet('trk.lb.user', true);
  switch (res.status) {
    case 'created': case 'updated': case 'exists': case 'dry_run': return what;
    case 'needs_login': U.kvSet('trk.lb.user', false); { const e = new Error('needs_login'); e.code = 'needs_login'; throw e; }
    case 'not_film': case 'unmapped': case 'has_review': case 'no_entry': throw new Skip(res.status);
    case 'unknown_shape': { const e = new Error('letterboxd relationship format changed: ' + (res.relKeys || []).join(',')); e.code = 'unknown_shape'; e.fatal = true; throw e; }
    default: { const e = new Error('letterboxd http ' + (res.http || '?')); e.code = 'http'; throw e; }
  }
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    for (let i = 0; i < 5; i++) {
      const j = q.jNext.get(now()); if (!j) break;
      const t = now(), p = JSON.parse(j.payload);
      q.jSet.run('running', j.attempts, j.due, t, j.result, j.error, j.id);
      try {
        if (!isLinked(j.service)) throw new Skip('not_linked');
        const res = j.service === 'mal' ? await runMal(p) : await runLetterboxd(p);
        q.jSet.run('done', j.attempts + 1, j.due, now(), JSON.stringify(res), null, j.id);
        noteState(j.service, { lastSync: now(), lastResult: res.op, lastError: null });
        U.log('tracker', j.service, res.op, p.videoId);
      } catch (e) {
        const code = e.code || 'network';
        if (e instanceof Skip || PERMANENT.has(code) || code === 'not_linked') {
          q.jSet.run('skipped', j.attempts + 1, j.due, now(), JSON.stringify({ op: code, detail: e.detail }), code, j.id);
          if (code !== 'not_anime' && code !== 'not_linked') noteState(j.service, { lastError: { code, ts: now(), item: p.name || p.videoId } });
          continue;
        }
        const n = j.attempts + 1, fatal = e.fatal || code === 'no_client_id' || n >= BACKOFF.length;
        q.jSet.run(fatal ? 'failed' : 'pending', n, now() + BACKOFF[Math.min(n - 1, BACKOFF.length - 1)], now(), null, code + ': ' + U.cap(e.message, 160), j.id);
        noteState(j.service, { lastError: { code: fatal && code !== 'no_client_id' && code !== 'auth' ? 'failed' : code, ts: now(), item: p.name || p.videoId } });
        U.log('tracker', j.service, 'error', code, U.cap(e.message, 120));
        if (code === 'browser' || code === 'needs_login' || code === 'auth') break; // same cause for the next job: wait
      }
    }
    q.jPrune.run(now() - 30 * 86400e3);
  } catch (e) { U.log('tracker worker:', e.message); }
  finally { busy = false; }
}
let timer = null;
function start() {
  if (timer || process.env.SPP_TRACKERS === 'off') return;
  q.jReset.run();
  timer = setInterval(tick, 5000); timer.unref();
}

// ---------- status ----------
function errText(e, s) {
  if (!e) return null;
  const k = 'trk.err.' + e.code;
  const txt = U.t(k, U.t('trk.' + s));
  return txt === k ? U.t('trk.err.http') : txt;
}
function status() {
  const c = cfg(), st = U.kvGet('trk.state', {});
  const counts = {}; for (const r of q.jCount.all()) (counts[r.service] = counts[r.service] || {})[r.status] = r.n;
  const one = (s, linked, user, dryRun) => {
    const x = st[s] || {}, pending = (counts[s] && counts[s].pending) || 0;
    const parts = [linked ? (user ? U.t('trk.linked', user) : U.t('trk.linkedNoUser')) : U.t('trk.notLinked')];
    if (linked && dryRun) parts.push(U.t('trk.dryRun'));
    if (linked) parts.push(x.lastSync ? U.t('trk.ok', U.shortDate(x.lastSync)) : U.t('trk.never'));
    if (pending) parts.push(U.t('trk.pending', pending));
    const err = x.lastError ? errText(x.lastError, s) : null;
    if (err) parts.push(err);
    return { name: U.t('trk.' + s), linked, user: user || null, dryRun: !!dryRun, lastSync: x.lastSync || null, lastResult: x.lastResult || null,
      lastError: x.lastError ? { code: x.lastError.code, ts: x.lastError.ts, item: x.lastError.item, text: err } : null, queue: counts[s] || {}, text: parts.join(' · ') };
  };
  const lbUser = U.kvGet('trk.lb.user', null);
  return {
    mal: Object.assign(one('mal', MAL.linked(), U.kvGet('trk.mal.user', null), c.mal.dryRun), { clientId: !!MAL.clientId(), loginPath: '/api/trackers/mal/login' }),
    letterboxd: Object.assign(one('letterboxd', c.letterboxd.enabled, null, c.letterboxd.dryRun), { enabled: c.letterboxd.enabled, signedIn: lbUser }),
    recent: q.jRecent.all(10).map(j => { const p = JSON.parse(j.payload); let r = null; try { r = JSON.parse(j.result); } catch (e) { /* none */ }
      return { service: j.service, videoId: p.videoId, name: p.name, watched: p.watched, rated: p.rated, status: j.status, attempts: j.attempts, op: r && r.op, error: j.error, updated: j.updated }; })
  };
}
async function probeLetterboxd() {
  try { const r = await LB.probe(); U.kvSet('trk.lb.user', !!r.loggedIn); return { signedIn: !!r.loggedIn, user: r.user || null }; }
  catch (e) { return { signedIn: null, error: e.code || 'browser' }; }
}

// ---------- MAL OAuth routes ----------
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function html(res, status, msg) {
  const b = Buffer.from('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + esc(U.t('trk.mal')) + '</title><p style="font:18px sans-serif;margin:2em">' + esc(msg) + '</p>');
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' }); res.end(b);
}
function malLogin(req, res) {
  let url;
  try { url = MAL.authUrl('http://' + (req.headers.host || '127.0.0.1') + '/api/trackers/mal/callback'); }
  catch (e) { return html(res, 400, U.t('trk.cb.fail', errText({ code: e.code }, 'mal'))); }
  res.writeHead(302, { location: url, 'cache-control': 'no-store' }); res.end();
}
async function malCallback(req, res, sp) {
  if (sp.get('error')) return html(res, 400, U.t('trk.cb.fail', U.cap(sp.get('error'), 60)));
  try {
    const user = await MAL.finishAuth(sp.get('code') || '', sp.get('state') || '');
    noteState('mal', { lastError: null });
    return html(res, 200, U.t('trk.cb.ok', user || '?'));
  } catch (e) {
    U.log('mal link failed:', e.code || '', e.message);
    return html(res, 400, e.code === 'state' ? U.t('trk.cb.state') : U.t('trk.cb.fail', errText({ code: e.code || 'http' }, 'mal')));
  }
}
function malUnlink() {
  require('../trackers/secretstore').update({ malAccessToken: null, malRefreshToken: null, malTokenExpires: null });
  U.kvSet('trk.mal.user', null);
  return status();
}

// one router entry point; returns true when handled
async function route(req, res, url, body) {
  const p = url.pathname, m = req.method;
  if (p === '/api/rate100' && m === 'POST') { U.sendJson(res, 200, postRate100(body)); return true; }
  if (p === '/api/rate100' && m === 'GET') { U.sendJson(res, 200, getRate100(url.searchParams.get('itemId'), url.searchParams.get('videoId'))); return true; }
  if (p === '/api/trackers' && m === 'GET') {
    if (url.searchParams.get('probe') === '1' && cfg().letterboxd.enabled) await probeLetterboxd();
    U.sendJson(res, 200, status()); return true;
  }
  if (p === '/api/trackers' && m === 'POST') { U.sendJson(res, 200, setCfg(body)); return true; }
  if (p === '/api/trackers/mal/login' && m === 'GET') { malLogin(req, res); return true; }
  if (p === '/api/trackers/mal/callback' && m === 'GET') { await malCallback(req, res, url.searchParams); return true; }
  if (p === '/api/trackers/mal/unlink' && m === 'POST') { U.sendJson(res, 200, malUnlink()); return true; }
  if (p === '/api/trackers/sync' && m === 'POST') { await tick(); U.sendJson(res, 200, status()); return true; } // drain due jobs now
  return false;
}

module.exports = { route, start, tick, onFinished, postRate100, getRate100, status, setCfg, enqueue, malScoreFor };
