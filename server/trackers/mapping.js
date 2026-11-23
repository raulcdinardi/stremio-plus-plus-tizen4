'use strict';
// App ids -> tracker ids.
//  MAL (one entry per cour/season/film):
//   kitsu:N[:E]      -> ani.zip kitsu_id mapping -> mal_id, episode E unchanged (Kitsu entries are split like MAL's).
//   tt..:S:E         -> Kitsu entries whose imdb_id is tt.. and whose videos carry imdbSeason/imdbEpisode (skip.js malFromImdb):
//                       this resolves IMDb-season -> MAL-entry splits (Mushoku Tensei S1E12 -> MAL 45576 "Part 2" ep 1).
//                       Fallback only when the whole show is one IMDb season: ani.zip imdb_id mapping, same episode number.
//   tt.. (movie)     -> ani.zip imdb_id mapping, only for animation; the worker also requires MAL media_type 'movie'.
//  Letterboxd: IMDb id (letterboxd.com/imdb/<tt>/ redirects to the film); kitsu movies use the Kitsu/ani.zip imdb id.
const U = require('../util');
const M = require('../api/meta');
const K = require('../api/skip');
const DAY = 86400e3;

async function aniZip(q) {
  const key = 'trk:anizip:' + q;
  const c = U.dbCacheGet(key, 14 * DAY); if (c !== undefined) return c.v;
  let v = null;
  const r = await U.fetchRaw('https://api.ani.zip/mappings?' + q, { timeout: 8000 });
  if (r.ok) { const j = await r.json().catch(() => null); v = j && j.mappings ? { mal: +j.mappings.mal_id || null, imdb: j.mappings.imdb_id || null, type: j.mappings.type || null } : null; }
  else if (r.status !== 404) throw new Error('ani.zip http ' + r.status);
  U.dbCacheSet(key, { v });
  return v;
}
const isAnimation = meta => (meta.genres || []).some(g => /animation|anime/i.test(g));

// -> {mal, ep} | null
async function malFor(itemId, videoId, type) {
  const p = U.parseVideoId(videoId || itemId);
  if (p.kitsu) {
    const mal = await K.malFromKitsu(p.base.split(':')[1]);
    if (!mal) return null;
    return { mal, ep: type === 'movie' ? 1 : (p.episode || 1) };
  }
  if (!/^tt\d+$/.test(p.base)) return null;
  if (type === 'movie') {
    const meta = await M.fetchMeta('movie', p.base);
    if (!isAnimation(meta)) return null;
    const z = await aniZip('imdb_id=' + p.base);
    return z && z.mal ? { mal: z.mal, ep: 1, movie: true } : null;
  }
  if (p.season == null || p.episode == null || p.season === 0) return null;
  const meta = await M.fetchMeta('series', p.base);
  if (!isAnimation(meta)) return null;
  const m = await K.malFromImdb(meta, p.season, p.episode);
  if (m) return { mal: m.mal, ep: m.ep };
  const seasons = new Set((meta.videos || []).map(v => v.season).filter(s => s > 0));
  if (seasons.size === 1 && seasons.has(p.season)) {
    const z = await aniZip('imdb_id=' + p.base);
    if (z && z.mal) return { mal: z.mal, ep: p.episode, fallback: true, imdbCount: (meta.videos || []).filter(v => v.season === p.season).length };
  }
  return null;
}

async function imdbFor(itemId, type) {
  const p = U.parseVideoId(itemId);
  if (/^tt\d+$/.test(p.base)) return p.base;
  if (p.kitsu) {
    try { const meta = await M.fetchMeta(type === 'movie' ? 'movie' : 'series', p.base); if (meta.imdb) return meta.imdb; } catch (e) { /* fall through */ }
    const z = await aniZip('kitsu_id=' + p.base.split(':')[1]);
    return z && z.imdb ? z.imdb : null;
  }
  return null;
}

module.exports = { malFor, imdbFor, aniZip };
