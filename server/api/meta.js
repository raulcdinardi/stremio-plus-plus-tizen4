'use strict';
// Metadata: Cinemeta + Kitsu addon. Catalogs, search, normalized meta (sqlite 1 day), item shaping.
const U = require('../util');
const S = require('./stremio');
const CINEMETA = 'https://v3-cinemeta.strem.io';
const DAY = 24 * 3600 * 1000;

async function kitsuBase() {
  const a = S.kitsuAddon(await S.allAddons());
  return a ? a.base : 'https://anime-kitsu.strem.fun';
}
const isKitsu = id => String(id).startsWith('kitsu:');

// ---- item shaping ----
function yearOf(m) { const y = m.year || m.releaseInfo || ''; const x = String(y).match(/\d{4}/); return x ? x[0] : undefined; }
function toItem(m, w) {
  const type = m.type === 'movie' || m.animeType === 'Movie' && !m.videos ? 'movie' : (m.type === 'movie' ? 'movie' : 'series');
  const it = { id: m.id || m.imdb_id, type, name: U.cap(m.name, 80), poster: U.imgUrl(m.poster, w || 150) };
  const y = yearOf(m); if (y) it.year = y;
  return it;
}

// ---- catalogs ----
async function catalog(base, type, id, extra, ttl) {
  const path = '/catalog/' + type + '/' + id + (extra ? '/' + extra : '') + '.json';
  return U.cached('cat:' + base + path, async () => {
    const j = await U.fetchJson(base + path, { timeout: 10000 });
    return (j.metas || []).slice(0, 60).map(m => ({ id: m.id, type: m.type, animeType: m.animeType, name: m.name, poster: m.poster, year: m.year, releaseInfo: m.releaseInfo, imdb_id: m.imdb_id }));
  }, ttl);
}
async function topMovies() { return catalog(CINEMETA, 'movie', 'top'); }
async function topSeries() { return catalog(CINEMETA, 'series', 'top'); }
async function animeTrending() { return catalog(await kitsuBase(), 'anime', 'kitsu-anime-trending'); }

// Naruto Ocean Cut (fan re-edit) presented as its own series, played with Brazilian dub (oceancut/)
async function ocMeta() {
  const OC = require('../oceancut');
  const raw = await OC.rawMeta(), list = await OC.videos();
  return { id: 'narutooc', type: 'series', name: U.t('oc.name'), year: 2002,
    description: U.cap(U.t('oc.desc') + (raw.description || ''), 600),
    poster: raw.poster || null, background: raw.background || null, logo: raw.logo || null, genres: ['Animation', 'Action'], runtime: null, imdbRating: null,
    imdb: null, tmdb: null, kitsu: null, animeType: null,
    videos: list.map(v => ({ id: v.id, season: v.season, episode: v.episode, title: U.cap(v.title, 80), released: null, thumbnail: v.thumbnail })) };
}
const OC_ITEM = { id: 'narutooc', type: 'series', poster: 'https://i.imgur.com/JprF6ks.png' };
async function search(q) {
  if (/ocean|naruto/i.test(String(q || ''))) { const r = await search0(q); r.unshift(Object.assign({}, OC_ITEM, { name: U.t('oc.name'), poster: U.imgUrl(OC_ITEM.poster, 150) })); return r.slice(0, 40); }
  return search0(q);
}
async function search0(q) {
  q = String(q || '').trim().slice(0, 100);
  if (!q) return [];
  const e = encodeURIComponent(q).replace(/%20/g, '%20');
  const kb = await kitsuBase();
  const [mv, sr, an] = await Promise.all([
    catalog(CINEMETA, 'movie', 'top', 'search=' + e, 5 * 60000).catch(() => []),
    catalog(CINEMETA, 'series', 'top', 'search=' + e, 5 * 60000).catch(() => []),
    catalog(kb, 'anime', 'kitsu-anime-list', 'search=' + e, 5 * 60000).catch(() => [])
  ]);
  const imdbSeen = new Set([].concat(mv, sr).map(m => m.id));
  const anime = an.filter(m => !(m.imdb_id && imdbSeen.has(m.imdb_id)));
  // round-robin so every source is visible
  const lists = [sr.map(toItem), mv.map(toItem), anime.map(toItem)];
  const out = [], seen = new Set();
  for (let i = 0; out.length < 40 && lists.some(l => i < l.length); i++)
    for (const l of lists) if (i < l.length && out.length < 40 && !seen.has(l[i].id)) { seen.add(l[i].id); out.push(l[i]); }
  return out;
}

// ---- meta ----
// Normalized internal meta: {id,type,name,year,description,poster,background,genres,runtime,imdbRating,imdb,tmdb,kitsu,animeType,videos:[{id,season,episode,title,released,thumbnail}]}
async function fetchMeta(type, id) {
  type = type === 'movie' ? 'movie' : 'series';
  const key = 'meta:' + id;
  const c = U.dbCacheGet(key, DAY);
  if (c) return c;
  if (id === 'narutooc' || /^naruto_\d+_\d+$/.test(id)) return ocMeta();
  let raw, kitsu = isKitsu(id);
  const base = id.split(':').slice(0, kitsu ? 2 : 1).join(':'); // meta id has no episode part
  try {
    if (kitsu) {
      const kb = await kitsuBase();
      try { raw = (await U.fetchJson(kb + '/meta/' + type + '/' + base + '.json', { timeout: 10000 })).meta; }
      catch (e) { raw = (await U.fetchJson(kb + '/meta/anime/' + base + '.json', { timeout: 10000 })).meta; }
    } else raw = (await U.fetchJson(CINEMETA + '/meta/' + type + '/' + base + '.json', { timeout: 10000 })).meta;
  } catch (e) {
    const stale = U.dbCacheGet(key, 30 * DAY); if (stale) return stale;
    throw e;
  }
  if (!raw) throw new U.HttpError(404, U.t('err.meta_notfound'), 'not_found');
  const m = {
    id: raw.id || base, type: raw.type === 'movie' ? 'movie' : 'series', name: U.cap(raw.name, 120), year: yearOf(raw),
    description: U.cap(raw.description, 600), poster: raw.poster || null, background: raw.background || null, logo: raw.logo || null,
    genres: (raw.genres || raw.genre || []).slice(0, 6), runtime: raw.runtime || null, imdbRating: raw.imdbRating || null,
    imdb: raw.imdb_id || (base.startsWith('tt') ? base : null), tmdb: raw.moviedb_id || null, kitsu: kitsu ? base.split(':')[1] : null,
    animeType: raw.animeType || null,
    videos: (raw.videos || []).map(v => ({
      id: v.id, season: v.season != null ? +v.season : null, episode: v.episode != null ? +v.episode : (v.number != null ? +v.number : null),
      title: U.cap(v.title || v.name || '', 80), released: v.released || v.firstAired || null, thumbnail: v.thumbnail || null
    })).filter(v => v.id && v.season != null && v.episode != null)
  };
  if (kitsu && raw.animeType === 'Movie') m.type = 'movie';
  if (m.type === 'movie') m.videos = [];
  U.dbCacheSet(key, m);
  return m;
}
function sortedVideos(m) {
  return m.videos.slice().sort((a, b) => ((a.season === 0) - (b.season === 0)) || a.season - b.season || a.episode - b.episode); // specials (S0) last
}
// next episode after videoId per stremio semantic (specials season 0 are skipped unless current is a special)
function nextVideo(m, videoId) {
  const vs = sortedVideos(m);
  const i = vs.findIndex(v => v.id === videoId);
  if (i < 0) return null;
  for (let j = i + 1; j < vs.length; j++) {
    if (vs[j].season === 0 && vs[i].season !== 0) continue;
    return vs[j];
  }
  return null;
}
module.exports = { toItem, topMovies, topSeries, animeTrending, search, fetchMeta, sortedVideos, nextVideo, isKitsu, kitsuBase, yearOf };
