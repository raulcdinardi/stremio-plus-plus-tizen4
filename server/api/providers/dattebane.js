'use strict';
// Dattebane / Naruttebane (https://www.dattebane.com/) provider: Naruto, Naruto Shippuden, Boruto (dubbed + subtitled).
// Pages: /<Section>/<NNN> (absolute episode number, 3 digits) contain a direct tokenised mp4 (jwplayer `file:` + <source>).
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://www.dattebane.com';
const TIMEOUT = 8000, TTL = 10 * 60 * 1000;

const SHOWS = {
  naruto: { label: 'Naruto', imdb: ['tt0409591'], kitsu: ['11'], dub: 'NarutoDublado', sub: 'NarutoClassico', max: { dub: 220, sub: 220 } },
  shippuden: { label: 'Naruto Shippuden', imdb: ['tt0988824'], kitsu: ['1555'], dub: 'NarutoShippuudenDublado', sub: 'NarutoShippuuden', max: { dub: 500, sub: 500 } },
  boruto: { label: 'Boruto', imdb: ['tt6342474'], kitsu: ['13051'], dub: 'BorutoDublado', sub: 'Boruto', max: { dub: 293, sub: 293 } }
};

function identify(meta) {
  if (!meta) return null;
  const id = String(meta.id || '');
  const imdb = meta.imdb || (id.startsWith('tt') ? id.split(':')[0] : null);
  const kitsu = meta.kitsu || (id.startsWith('kitsu:') ? id.split(':')[1] : null);
  for (const s of Object.values(SHOWS)) {
    if (imdb && s.imdb.includes(imdb)) return { show: s, kitsu: false };
    if (kitsu && s.kitsu.includes(String(kitsu))) return { show: s, kitsu: true };
  }
  return null;
}

const mem = new Map();
function memo(key, fn) {
  const c = mem.get(key);
  if (c && Date.now() - c.t < TTL) return c.p;
  const p = fn().catch(e => { mem.delete(key); throw e; });
  mem.set(key, { t: Date.now(), p });
  if (mem.size > 300) mem.delete(mem.keys().next().value);
  return p;
}
async function get(url, headers) {
  const r = await fetch(url, { headers: Object.assign({ 'User-Agent': UA, Cookie: 'ServerOption=NOTFIX' }, headers || {}), signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
  if (!r.ok) throw new Error('http ' + r.status);
  return r;
}

// absolute (non-special) episode number from (season, episode) using the Cinemeta video list
async function absolute(meta, season, episode) {
  let vids = Array.isArray(meta.videos) && meta.videos.length ? meta.videos : null;
  if (!vids) {
    const imdb = meta.imdb || String(meta.id).split(':')[0];
    const j = await memo('cm:' + imdb, async () => (await get('https://v3-cinemeta.strem.io/meta/series/' + imdb + '.json')).json());
    vids = (j.meta && j.meta.videos) || [];
  }
  const list = vids.map(v => ({ s: +v.season, e: +(v.episode != null ? v.episode : v.number) })).filter(v => v.s > 0 && v.e > 0)
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const i = list.findIndex(v => v.s === season && v.e === episode);
  return i < 0 ? null : i + 1;
}

const enc = u => u.replace(/ /g, '%20');
function parsePage(html) {
  const urls = [];
  for (const re of [/file:\s*'([^']+\.mp4)'/g, /<source[^>]+src='([^']+\.mp4)'/g]) {
    let m; while ((m = re.exec(html))) urls.push(enc((m[1].startsWith('//') ? 'https:' : '') + m[1]));
  }
  const title = (html.match(/<title>([^<]*)/) || [])[1] || '';
  return { urls: [...new Set(urls)], title: title.replace(/^Naruttebane - /, '').trim() };
}
// Mirrors s01/s03 serve the same token path; s02 is frequently down. Pick the first that answers a 1-byte range request.
async function pickUrl(urls) {
  const hosts = ['s01', 's03'];
  const cands = [];
  for (const u of urls) for (const h of hosts) cands.push(u.replace(/\/\/s\d+\./, '//' + h + '.'));
  for (const u of [...new Set(cands)]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: BASE + '/', Range: 'bytes=0-1' }, signal: AbortSignal.timeout(4000) });
      await r.body?.cancel();
      if (r.status === 200 || r.status === 206) return u;
    } catch (e) { /* try next mirror */ }
  }
  return null;
}

async function episode(section, n, kind) {
  const num = String(n).padStart(3, '0');
  return memo('ep:' + section + num, async () => {
    const html = await (await get(BASE + '/' + section + '/' + num)).text();
    const p = parsePage(html);
    if (!p.urls.length || /Erro 404/.test(p.title)) return null;
    const url = await pickUrl(p.urls);
    return url ? { url, title: p.title } : null;
  });
}

module.exports = {
  id: 'dattebane',
  name: 'Dattebane',
  async find(meta, season, episodeNo) {
    try {
      const idf = identify(meta);
      if (!idf || episodeNo == null) return [];
      let n;
      if (idf.kitsu) n = +episodeNo;
      else if (season == null) return [];
      else n = await absolute(meta, +season, +episodeNo);
      if (!n || n < 1) return [];
      const headers = { 'User-Agent': UA, Referer: BASE + '/' };
      const s = idf.show;
      const [dub, sub] = await Promise.all([
        n <= s.max.dub ? episode(s.dub, n).catch(() => null) : null,
        n <= s.max.sub ? episode(s.sub, n).catch(() => null) : null
      ]);
      const out = [];
      if (dub) out.push({ title: s.label + ' ' + String(n).padStart(3, '0') + ' Dublado (Dattebane) - ' + dub.title.replace(/^.*?Epis[oó]dio\s*\d+\s*-\s*/, ''), url: dub.url, headers, lang: ['pt-BR'] });
      if (sub) out.push({ title: s.label + ' ' + String(n).padStart(3, '0') + ' Legendado (Dattebane) - ' + sub.title.replace(/^.*?Epis[oó]dio\s*\d+\s*-\s*/, ''), url: sub.url, headers, lang: ['ja', 'pt subs'] });
      return out;
    } catch (e) { return []; }
  },
  _internal: { identify, absolute, parsePage, episode, SHOWS, UA, BASE }
};
