'use strict';
// Skip segments. Priority per segment type: file chapters > AniSkip (anime) > TheIntroDB. Network lookups are sqlite-cached and never block play > 2 s.
const U = require('../util');
const M = require('./meta');
const S = require('./stremio');
const DAY = 86400000;

function chapterSegs(chapters, duration) {
  const out = [];
  for (const c of chapters || []) {
    const t = String(c.title || '');
    let type = null;
    if (/recap|previously/i.test(t)) type = 'recap';
    else if (/\b(op|opening|intro)\b/i.test(t) && !/\bintro(duction)?\s+to\b/i.test(t)) type = 'intro';
    else if (/\b(ed|ending|credits?|outro)\b/i.test(t)) type = 'outro';
    if (type && c.end > c.start) out.push({ type, start: +c.start.toFixed(1), end: +c.end.toFixed(1), src: 'chapter' });
  }
  return out;
}

async function cachedLookup(key, ttl, negTtl, fn) {
  const c = U.dbCacheGet(key, ttl);
  if (c !== undefined) return c && c.v !== undefined ? c.v : c;
  const r = await fn();
  U.dbCacheSet(key, { v: r });
  return r;
}

// ---- MAL id mapping ----
async function malFromKitsu(kitsuId) {
  return cachedLookup('skip:malk:' + kitsuId, 30 * DAY, DAY, async () => {
    const j = await U.fetchJson('https://api.ani.zip/mappings?kitsu_id=' + encodeURIComponent(kitsuId), { timeout: 5000 });
    return j && j.mappings && j.mappings.mal_id ? +j.mappings.mal_id : null;
  });
}
// tt + season + episode -> {mal, ep} via Kitsu search (entries carry imdb_id) and Kitsu video imdbSeason/imdbEpisode
async function malFromImdb(meta, season, episode) {
  if (!(meta.genres || []).some(g => /animation|anime/i.test(g))) return null;
  return cachedLookup('skip:malt:' + meta.imdb + ':' + season + ':' + episode, 30 * DAY, DAY, async () => {
    const kb = await M.kitsuBase();
    const j = await U.fetchJson(kb + '/catalog/anime/kitsu-anime-list/search=' + encodeURIComponent(meta.name) + '.json', { timeout: 6000 });
    const hits = (j.metas || []).filter(m => m.imdb_id === meta.imdb).slice(0, 5);
    for (const h of hits) {
      let km; try { km = await U.fetchJson(kb + '/meta/series/' + h.id + '.json', { timeout: 6000 }); } catch (e) { continue; }
      const v = ((km.meta && km.meta.videos) || []).find(x => x.imdbSeason === season && x.imdbEpisode === episode);
      if (v) { const mal = await malFromKitsu(h.id.split(':')[1]); if (mal) return { mal, ep: +v.episode }; }
    }
    return null;
  });
}
async function aniskip(mal, ep) {
  return cachedLookup('skip:ani:' + mal + ':' + ep, 14 * DAY, DAY, async () => {
    const r = await U.fetchRaw('https://api.aniskip.com/v2/skip-times/' + mal + '/' + ep + '?types=op&types=ed&types=recap&types=mixed-op&types=mixed-ed&episodeLength=0', { timeout: 6000 });
    if (r.status === 404) return [];
    if (!r.ok) throw new U.HttpError(502, 'aniskip http ' + r.status);
    const j = await r.json();
    return (j.results || []).map(x => ({ type: { op: 'intro', 'mixed-op': 'intro', ed: 'outro', 'mixed-ed': 'outro', recap: 'recap' }[x.skipType], start: x.interval.startTime, end: x.interval.endTime })).filter(x => x.type && x.end > x.start);
  });
}
async function animeSegs(videoId, meta) {
  const p = U.parseVideoId(videoId);
  let mal = null, ep = p.episode;
  if (p.kitsu) mal = await malFromKitsu(p.base.split(':')[1]);
  else if (p.season != null && meta && meta.imdb) { const m = await malFromImdb(meta, p.season, p.episode); if (m) { mal = m.mal; ep = m.ep; } }
  if (!mal || ep == null) return [];
  const seen = new Set(); // AniSkip may return several submissions per type: keep the first of each
  return (await aniskip(mal, ep)).filter(x => !seen.has(x.type) && seen.add(x.type)).map(x => Object.assign({ src: 'aniskip' }, x));
}

// ---- TheIntroDB ----
async function introdb(meta, season, episode, duration) {
  const qs = meta.tmdb ? 'tmdb_id=' + meta.tmdb : (meta.imdb ? 'imdb_id=' + meta.imdb : null);
  if (!qs) return [];
  const key = 'skip:tidb:' + qs + ':' + season + ':' + episode;
  const raw = await cachedLookup(key, 7 * DAY, DAY, async () => {
    const r = await U.fetchRaw('https://api.theintrodb.org/v3/media?' + qs + (season != null ? '&season=' + season + '&episode=' + episode : ''), { timeout: 6000 });
    if (r.status === 404 || r.status === 400) return {};
    if (!r.ok) throw new U.HttpError(502, 'theintrodb http ' + r.status);
    const j = await r.json();
    return { intro: j.intro, recap: j.recap, credits: j.credits, preview: j.preview };
  });
  const out = [];
  const add = (arr, type) => {
    for (const x of arr || []) {
      const start = x.start_ms == null ? 0 : x.start_ms / 1000;
      const end = x.end_ms == null ? duration : x.end_ms / 1000;
      if (end > start) out.push({ type, start, end, src: 'theintrodb' });
    }
  };
  add(raw.intro, 'intro'); add(raw.recap, 'recap'); add(raw.credits, 'outro');
  if (!(raw.credits || []).length) add(raw.preview, 'outro');
  return out.filter(x => x.end > x.start && isFinite(x.end));
}

async function external(videoId, type, duration) {
  const p = U.parseVideoId(videoId);
  let meta = null; try { meta = await M.fetchMeta(type, p.base); } catch (e) { /* ignore */ }
  const [a, t] = await Promise.all([
    animeSegs(videoId, meta).catch(e => { U.log('aniskip failed:', e.message); return []; }),
    meta ? introdb(meta, type === 'movie' ? null : (p.kitsu ? null : p.season), type === 'movie' ? null : p.episode, duration).catch(e => { U.log('theintrodb failed:', e.message); return []; }) : []
  ]);
  return { aniskip: a, introdb: p.kitsu && !meta.imdb ? [] : t };
}
function merge(chapters, ext, duration) {
  const by = {};
  for (const list of [chapters, ext.aniskip, ext.introdb]) {
    const types = {};
    for (const s of list) (types[s.type] = types[s.type] || []).push(s);
    for (const t of Object.keys(types)) if (!by[t]) by[t] = types[t];
  }
  const out = [];
  for (const t of Object.keys(by)) for (const s of by[t]) {
    const end = duration > 0 ? Math.min(s.end, duration) : s.end;
    if (end > s.start) out.push({ type: t, start: +s.start.toFixed(1), end: +end.toFixed(1) });
  }
  return out.sort((a, b) => a.start - b.start);
}
// Never blocks > 2 s: returns whatever is ready (cache usually), lookups keep warming in background.
async function lookup({ videoId, type, duration, chapters, wait }) {
  const ch = chapterSegs(chapters, duration);
  const p = external(videoId, type, duration);
  p.catch(() => {});
  const ext = await Promise.race([p, new Promise(r => setTimeout(() => r({ aniskip: [], introdb: [] }), wait == null ? 2000 : wait))]);
  return merge(ch, ext, duration);
}
function prefetch(videoId, type) { external(videoId, type, 0).catch(() => {}); }
module.exports = { lookup, prefetch, chapterSegs, merge, malFromKitsu, malFromImdb };
