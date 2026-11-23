'use strict';
// Stream aggregation: Stremio addons + site providers -> normalized, ranked list with opaque sids.
const U = require('../util');
const S = require('./stremio');
const M = require('./meta');
const P = require('./providers');
const SID_TTL = 6 * 3600 * 1000;

const insSid = U.db.prepare('INSERT INTO sids(sid,ts,v) VALUES(?,?,?)');
const getSidQ = U.db.prepare('SELECT ts,v FROM sids WHERE sid=?');
function putSid(v) { const sid = U.rid(9); insSid.run(sid, Date.now(), JSON.stringify(v)); return sid; }
function getSid(sid) {
  const r = getSidQ.get(String(sid)); if (!r || Date.now() - r.ts > SID_TTL) return null;
  try { return JSON.parse(r.v); } catch (e) { return null; }
}
function cleanSids() { U.db.prepare('DELETE FROM sids WHERE ts < ?').run(Date.now() - SID_TTL); }
cleanSids(); setInterval(cleanSids, 3600000).unref();

function toBytes(n, unit) {
  const m = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[unit.toUpperCase()] || 1;
  return parseFloat(String(n).replace(',', '.')) * m;
}
function fmtSize(b) { if (!b) return ''; return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB'; }

function parseLang(txt) {
  const l = new Set();
  if (/🇧🇷|pt[-_. ]?br|portugu[eê]s[- ]?(do )?brasil|dublado|dublagem|\bpob\b/i.test(txt)) l.add('pt-BR');
  if (/🇵🇹|\bpt[-_. ]?pt\b/i.test(txt)) l.add('pt');
  if (/dual[ ._-]?([aá]udio)?|\bdual\b/i.test(txt)) l.add('dual');
  if (/\bmulti\b/i.test(txt)) l.add('multi');
  if (/🇬🇧|🇺🇸|\beng(lish)?\b/i.test(txt)) l.add('en');
  if (/🇯🇵|\bjap(anese)?\b|\bjpn\b/i.test(txt)) l.add('ja');
  if (/🇪🇸|🇲🇽|\bspa(nish)?\b|\blatino\b/i.test(txt)) l.add('es');
  return [...l];
}
function parseQuality(txt) {
  if (/\b(2160p|4k|uhd)\b/i.test(txt)) return '2160p';
  if (/\b1080p?\b/i.test(txt)) return '1080p';
  if (/\b720p?\b/i.test(txt)) return '720p';
  if (/\b(480p|576p|dvdrip|sd)\b/i.test(txt)) return '480p';
  return null;
}
const QTIER = { '1080p': 5, '720p': 4, '2160p': 3, '480p': 2 };

function normalize(s, addon) {
  if (!s || s.externalUrl || s.ytId) return null;
  const bh = s.behaviorHints || {};
  const name = String(s.name || ''), title = String(s.title || s.description || '');
  const text = name + '\n' + title + '\n' + (bh.filename || '');
  const o = { addon: addon.name };
  let ih = s.infoHash, fi = s.fileIdx;
  if (!ih && s.url && /^magnet:/i.test(s.url)) { const m = s.url.match(/btih:([0-9a-f]{40})/i); if (m) ih = m[1]; }
  if (ih) { o.kind = 'torrent'; o.infoHash = ih.toLowerCase(); if (fi != null) o.fileIdx = +fi; o.trackers = (s.sources || []).filter(x => /^(tracker:|udp:|http)/.test(x)).map(x => x.replace(/^tracker:/, '')).slice(0, 25); o.dht = (s.sources || []).some(x => /^dht:/.test(x)); }
  else if (s.url && /^https?:/i.test(s.url)) {
    o.kind = 'http'; o.url = s.url;
    const h = bh.proxyHeaders && bh.proxyHeaders.request; if (h) o.headers = h;
  } else return null;
  if (bh.filename) o.filename = bh.filename;
  const sd = title.match(/👤\s*(\d+)/); o.seeders = sd ? +sd[1] : null;
  const sz = title.match(/💾\s*([\d.,]+)\s*(KB|MB|GB|TB)/i);
  o.size = sz ? toBytes(sz[1], sz[2]) : (bh.videoSize || null);
  const src = title.match(/⚙️\s*([^\n]+)/); o.source = src ? src[1].trim() : null;
  o.quality = parseQuality(name + ' ' + title);
  o.lang = parseLang(title.split('\n').slice(1).join('\n') + ' ' + title.split('\n')[0] + ' ' + name);
  o.hdr = /\b(hdr10?\+?|dolby[ .]?vision|dv|hdr)\b/i.test(text);
  o.remux = /\bremux\b/i.test(text);
  const lines = title.split('\n').map(x => x.trim()).filter(Boolean);
  const fname = lines.find(l => !/^[👤💾⚙️🇦-🇿\s\/]/u.test(l) || lines.length === 1) || name;
  o.title = U.cap(fname.replace(/\.(mkv|mp4|avi)$/i, '').replace(/[._]/g, ' '), 90) || addon.name;
  return o;
}

function tier(o) {
  let t = QTIER[o.quality] || 1;
  if (o.quality === '2160p' && (o.size > 20e9 || (o.remux && o.hdr) || o.remux)) t = 0;
  if (o.size) {
    if (o.quality === '1080p' && o.size > 12e9) t -= 1.5;
    if (o.quality === '720p' && o.size > 6e9) t -= 1.5;
    if (o.size > 35e9) t = Math.min(t, 0);
  }
  return t;
}
// Season named in a release title (S03, Season 3, 3rd Season, "Title III"), or null when absent/ambiguous (ranges, packs).
// Torrentio sometimes files a later season's release under S1 (e.g. "Mushoku Tensei III - 05" as tt…:1:5, 22/11).
const ROMAN = { II: 2, III: 3, IV: 4, V: 5, VI: 6 };
function seasonOf(txt) {
  txt = String(txt || '');
  if (/\bS\d{1,2}\s*[-~]\s*S?\d{1,2}\b|\bseasons?\s*\d+\s*[-~&,]\s*\d+|\bcomplete\b/i.test(txt)) return null;
  let m = txt.match(/\bS(\d{1,2})(?:E\d+|\b)/i) || txt.match(/\bSeason\s*(\d{1,2})\b/i) || txt.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i);
  if (m) return +m[1];
  m = txt.match(/[A-Za-z]\s(II|III|IV|V|VI)(?=\s*[:\-\]\)]|\s+-|$)/);
  return m ? ROMAN[m[1]] : null;
}
function ptScore(o) { return o.lang.includes('pt-BR') || o.lang.includes('pt') ? 2 : (o.lang.includes('dual') || o.lang.includes('multi') ? 1 : 0); }
function rank(list, prefLang, wantSeason) {
  const pt = prefLang === 'pt';
  const keyed = list.map(o => ({ o, wrong: wantSeason > 0 && (x => x != null && x !== wantSeason)(seasonOf(o.title + ' ' + (o.filename || ''))) ? 1 : 0, healthy: o.kind === 'torrent' ? (o.seeders == null ? 1 : (o.seeders >= 3 ? 2 : (o.seeders > 0 ? 1 : 0))) : 2, pt: pt ? ptScore(o) : 0, tier: tier(o), seeds: o.seeders || 0 }));
  keyed.sort((a, b) => a.wrong - b.wrong || (b.healthy > 0) - (a.healthy > 0) || (b.healthy === 2) - (a.healthy === 2) || (b.pt === 2) - (a.pt === 2) || b.tier - a.tier || b.pt - a.pt || b.seeds - a.seeds || (a.o.size || 0) - (b.o.size || 0));
  return keyed.map(k => k.o);
}

async function fromAddons(type, id) {
  const addons = (await S.allAddons()).filter(a => S.isEnabled(a.id));
  const kitsu = M.isKitsu(id);
  const jobs = [];
  for (const a of addons) {
    let rt = null;
    for (const t of kitsu ? ['anime', type] : [type]) if (S.resourceFor(a, 'stream', t, id)) { rt = t; break; }
    if (!rt) continue;
    jobs.push((async () => {
      try {
        const j = await S.addonGet(a, '/stream/' + rt + '/' + encodeURIComponent(id).replace(/%3A/g, ':') + '.json', 8000);
        return (j.streams || []).slice(0, 120).map(s => normalize(s, a)).filter(Boolean);
      } catch (e) { U.log('streams from', a.name, 'failed:', e.message); return []; }
    })());
  }
  return (await Promise.all(jobs)).flat();
}
async function fromProviders(type, id, meta) {
  const p = U.parseVideoId(id);
  const jobs = P.list().filter(pr => S.overrides()['provider:' + pr.id] ?? (pr.defaultEnabled !== false)).map(async pr => {
    try {
      const r = await Promise.race([pr.find(meta, p.season, p.episode), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000).unref())]);
      return (r || []).slice(0, 15).map(x => ({ kind: 'site', addon: pr.name, title: U.cap(x.title || pr.name, 90), url: x.url, pageUrl: x.pageUrl, headers: x.headers, lang: x.lang || [], quality: x.quality || null, seeders: null, size: null, source: pr.name, providerId: pr.id }));
    } catch (e) { U.log('provider', pr.id, 'failed:', e.message); return []; }
  });
  return (await Promise.all(jobs)).flat();
}

const respCache = new U.LRU(100, 120000);
// Anime opened by IMDb id: Torrentio indexes most anime releases under the Kitsu id, so also ask for
// the matching kitsu:ID:EP (mapped through the Kitsu addon's imdbSeason/imdbEpisode) and merge.
const kitsuMap = new U.LRU(500, 24 * 3600e3);
async function kitsuVideoFor(meta, season, episode) {
  if (!meta || !meta.imdb && !/^tt/.test(meta.id || '')) return null;
  if (!(meta.genres || []).some(g => /animation|anime/i.test(g))) return null;
  const imdb = meta.imdb || meta.id, key = imdb + ':' + season + ':' + episode;
  const hit = kitsuMap.get(key); if (hit !== undefined) return hit;
  let out = null;
  try {
    const kb = await M.kitsuBase();
    const words = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const want = words(meta.name.split(':')[0]);
    const qs = [meta.name, meta.name.split(':')[0]].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const q of qs) {
      const j = await U.fetchJson(kb + '/catalog/anime/kitsu-anime-list/search=' + encodeURIComponent(q) + '.json', { timeout: 6000 });
      const metas = j.metas || [];
      // exact IMDb match: use the Kitsu addon's imdbSeason/imdbEpisode mapping
      for (const h of metas.filter(m => m.imdb_id === imdb).slice(0, 5)) {
        let km; try { km = await U.fetchJson(kb + '/meta/series/' + h.id + '.json', { timeout: 6000 }); } catch (e) { continue; }
        const v = ((km.meta && km.meta.videos) || []).find(x => x.imdbSeason === season && x.imdbEpisode === episode);
        if (v) { out = h.id + ':' + v.episode; break; }
      }
      if (out) break;
      // season 1 of a show indexed differently on Kitsu (e.g. a new part of an older franchise): same title words, episode as-is
      if (season === 1) {
        const h = metas.find(m => { const w = words(m.name); return want.length && want.every(x => w.indexOf(x) >= 0); });
        if (h) { out = h.id + ':' + episode; break; }
      }
    }
  } catch (e) { U.log('kitsu map failed:', e.message); return null; } // não guarda falha de rede por 24 h
  kitsuMap.set(key, out);
  return out;
}
// Naruto Ocean Cut episode: dubbed version (our aligned PT-BR track) + the original English release.
async function ocStreams(id) {
  const OC = require('../oceancut');
  const st = OC.enqueue(id, true); // start preparing as soon as the episode is looked at
  const oc = await OC.ocStream(id);
  const pct = st.state === 'ready' ? '' : st.state === 'queued' ? U.t('oc.queued') : st.state === 'error' ? U.t('oc.failed', U.cap(st.msg, 60)) : U.t('oc.preparing', Math.round((st.progress || 0) * 100));
  const dub = putSid({ kind: 'ocdub', ocId: id, title: U.t('oc.dub'), itemId: 'narutooc', videoId: id, type: 'series' });
  const eng = putSid({ kind: 'torrent', infoHash: oc.infoHash, fileIdx: oc.fileIdx, title: U.t('oc.origTitle'), itemId: 'narutooc', videoId: id, type: 'series' });
  return { streams: [
    { sid: dub, title: U.t('oc.dub') + pct, detail: st.state === 'ready' ? U.t('oc.ready') : 'Dattebane + Ocean Cut', quality: '720p', lang: ['pt-BR'], kind: 'site', recommended: true },
    { sid: eng, title: U.t('oc.orig'), detail: 'Torrent · Ocean Cut', quality: '720p', lang: ['en'], kind: 'torrent', recommended: false }
  ] };
}
async function getStreams(type, id) {
  if (/^naruto_\d+_\d+$/.test(id)) return ocStreams(id);
  type = type === 'movie' ? 'movie' : 'series';
  const ck = type + '|' + id;
  const c = respCache.get(ck); if (c) return c;
  const base = U.parseVideoId(id);
  let meta = null; try { meta = await M.fetchMeta(type, base.base); } catch (e) { /* providers get minimal meta */ }
  const kid = type === 'series' && !base.kitsu && base.season > 0 ? await kitsuVideoFor(meta, base.season, base.episode).catch(() => null) : null;
  const [a, p, k] = await Promise.all([fromAddons(type, id), fromProviders(type, id, meta || { id: base.base, name: base.base, type }),
    kid ? fromAddons('series', kid).catch(() => []) : []]);
  if (kid) U.log('anime: merged', k.length, 'streams from', kid);
  a.push.apply(a, k);
  const seen = new Set(), all = [];
  for (const o of a.concat(p)) {
    const k = o.kind === 'torrent' ? o.infoHash + '/' + (o.fileIdx == null ? '' : o.fileIdx) : (o.url || o.pageUrl);
    if (seen.has(k)) continue; seen.add(k); all.push(o);
  }
  const ranked = rank(all, U.getSettings().audioLang, type === 'series' && !base.kitsu ? base.season : 0).slice(0, 60);
  const streams = ranked.map((o, i) => {
    const detail = [fmtSize(o.size), o.seeders != null ? o.seeders + ' seeds' : '', o.source || o.addon].filter(Boolean).join(' · ');
    const sid = putSid({ kind: o.kind, infoHash: o.infoHash, fileIdx: o.fileIdx, trackers: o.trackers, url: o.url, pageUrl: o.pageUrl, headers: o.headers, filename: o.filename, providerId: o.providerId,
      title: o.title, quality: o.quality, lang: o.lang, season: base.season, episode: base.episode, itemId: base.base, videoId: id, type });
    return { sid, title: o.title, detail, quality: o.quality || '?', lang: o.lang, kind: o.kind, recommended: i === 0 };
  });
  const out = { streams };
  if (streams.length) respCache.set(ck, out); // resultado vazio (ex.: timeout do Torrentio) não fica em cache
  return out;
}
module.exports = { seasonOf, getStreams, getSid, putSid, normalize, rank, parseLang, parseQuality, kitsuVideoFor };
