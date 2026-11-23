'use strict';
// Letterboxd adapter. There is no public write API, so we act as the owner's own browser session:
// a background tab in the logged-in agent Chrome (CDP) opens letterboxd.com/imdb/<tt>/ (redirects to the film page)
// and calls the same JSON endpoints the website's diary form uses (/api/v0/production-log-entries, session cookie +
// X-CSRF-TOKEN = window.supermodelCSRF). Cloudflare challenges and login are handled by the real browser.
// Idempotent: before creating, it reads the owner's relationship to the film and its diary entries; if one already has
// today's date it is reused (rating updated only when it has no review). If the relationship shape is not understood,
// it refuses to write.
const cdp = require('./cdp');

// Runs inside letterboxd.com. arg = {mode: 'log'|'rate'|'probe', date: 'YYYY-MM-DD', rating: 0.5..5|null, dryRun}
const PAGE_SCRIPT = async function (a) {
  const out = { status: 'error' };
  const P = window.person || {};
  out.loggedIn = !!P.loggedIn;
  if (!P.loggedIn) { out.status = 'needs_login'; return out; }
  if (a.mode === 'probe') { out.status = 'ok'; out.user = P.username; return out; }
  const m = location.pathname.match(/^\/film\/[^/]+\//);
  if (!m) { out.status = 'unmapped'; out.where = location.pathname; return out; }
  const film = await (await fetch(m[0] + 'json/', { credentials: 'same-origin' })).json();
  out.film = { name: film.name, year: film.releaseYear, lid: film.lid, url: film.url };
  if (film.type && film.type !== 'film') { out.status = 'not_film'; return out; }
  const api = async (path, method, body) => {
    const h = { accept: 'application/json' };
    if (method && method !== 'GET') { h['content-type'] = 'application/json; charset=UTF-8'; h['X-CSRF-TOKEN'] = window.supermodelCSRF; }
    const r = await fetch('/api/v0' + path, { method: method || 'GET', headers: h, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) { /* empty */ }
    return { s: r.status, j };
  };
  const rel = await api('/production/' + film.lid + '/me');
  if (rel.s === 401 || rel.s === 403) { out.status = 'needs_login'; return out; }
  if (rel.s !== 200 || !rel.j) { out.status = 'http'; out.http = rel.s; return out; }
  out.relKeys = Object.keys(rel.j).slice(0, 30);
  const raw = rel.j.diaryEntries;
  if (!Array.isArray(raw)) { out.status = 'unknown_shape'; return out; }
  const ids = raw.map(x => (typeof x === 'string' ? x : x && (x.id || x.lid))).filter(Boolean);
  out.diaryCount = ids.length; out.watchedBefore = !!rel.j.watched;
  let found = null;
  for (const id of ids.slice(-12)) {
    const e = await api('/log-entry/' + encodeURIComponent(id));
    if (e.s === 200 && e.j && e.j.diaryDetails && e.j.diaryDetails.diaryDate === a.date) { found = e.j; break; }
  }
  const tagsOf = e => (Array.isArray(e.tags2) ? e.tags2.map(t => t.displayTag || t.tag) : (Array.isArray(e.tags) ? e.tags : []));
  const update = async () => {
    const curRating = found.rating == null ? null : +found.rating;
    out.entry = { id: found.id, rating: curRating };
    if (a.rating == null || curRating === a.rating) { out.status = 'exists'; return out; }
    if (found.review && (found.review.text || found.review.lbml)) { out.status = 'has_review'; return out; }
    const body = { diaryDetails: { diaryDate: found.diaryDetails.diaryDate, rewatch: !!found.diaryDetails.rewatch }, review: null, tags: tagsOf(found),
      rating: a.rating, like: !!found.like, privacyPolicy: found.configuredPrivacyPolicy == null ? null : found.configuredPrivacyPolicy };
    if (a.dryRun) { out.status = 'dry_run'; out.would = { op: 'update', id: found.id, body }; return out; }
    const r = await api('/production-log-entry/' + encodeURIComponent(found.id), 'PATCH', body);
    out.http = r.s; out.status = r.s === 200 ? 'updated' : 'http';
    return out;
  };
  if (found) return update();
  if (a.mode === 'rate') { out.status = 'no_entry'; return out; }
  const body = { productionId: film.lid, diaryDetails: { diaryDate: a.date, rewatch: !!rel.j.watched }, tags: [], like: !!rel.j.liked };
  if (a.rating != null) body.rating = a.rating;
  if (a.dryRun) { out.status = 'dry_run'; out.would = { op: 'create', body }; return out; }
  const r = await api('/production-log-entries', 'POST', body);
  out.http = r.s;
  const errs = r.j && Array.isArray(r.j.messages) ? r.j.messages.filter(x => x.type === 'Error').map(x => x.title || x.code || 'error') : [];
  if (r.s === 200 && !errs.length && r.j && r.j.logEntry) { out.status = 'created'; out.entry = { id: r.j.logEntry.id, rating: r.j.logEntry.rating == null ? null : r.j.logEntry.rating }; }
  else { out.status = 'http'; out.errors = errs.slice(0, 3); }
  return out;
};

// Letterboxd stars from a 0–100 score: score 0 = "watched, no star rating" (null); else nearest half star, min 0.5.
function starsFrom100(score) {
  if (score == null || !(score > 0)) return null;
  return Math.min(5, Math.max(0.5, Math.round(score / 10) / 2));
}

const READY = "document.readyState !== 'loading' && typeof window.person === 'object' && (!location.pathname.startsWith('/film/') || !!window.supermodelCSRF)";
const LB_BASE = process.env.SPP_LB_BASE || 'https://letterboxd.com'; // tests point this at a fake site
const filmUrl = imdb => LB_BASE + '/imdb/' + encodeURIComponent(imdb) + '/';

async function run(imdb, args) {
  if (!/^tt\d+$/.test(String(imdb || ''))) return { status: 'unmapped' };
  return cdp.runInPage(filmUrl(imdb), READY, PAGE_SCRIPT.toString(), args, { timeout: 45000 });
}
// log a diary entry dated `date` (YYYY-MM-DD) with optional stars; reuses an existing entry with that date.
function logFilm({ imdb, date, stars, dryRun }) { return run(imdb, { mode: 'log', date, rating: stars == null ? null : stars, dryRun: !!dryRun }); }
// set the stars on the entry dated `date` (only if it exists and has no review).
function rateEntry({ imdb, date, stars, dryRun }) { return run(imdb, { mode: 'rate', date, rating: stars == null ? null : stars, dryRun: !!dryRun }); }
async function probe() { return cdp.runInPage(LB_BASE + '/', READY, PAGE_SCRIPT.toString(), { mode: 'probe' }, { timeout: 45000 }); }

module.exports = { logFilm, rateEntry, probe, starsFrom100, PAGE_SCRIPT };
