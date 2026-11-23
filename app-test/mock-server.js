// Zero-dep mock of the Stremio++ HTTP API (SPEC contract) for client testing.
// usage: node mock-server.js [port]   (serves ../app at /app/ and / as well)
const http = require('http'), fs = require('fs'), path = require('path'), https = require('https');
const PORT = +process.argv[2] || 8791;
const APP = path.join(__dirname, '..', 'app');
const log = [];
const poster = id => `/img?u=${encodeURIComponent('https://images.metahub.space/poster/small/' + id + '/img')}&w=150`;
const bg = id => `/img?u=${encodeURIComponent('https://images.metahub.space/background/small/' + id + '/img')}&w=960`;
const I = (id, type, name, year, extra) => Object.assign({ id, type, name, poster: poster(id), year }, extra || {});
const series = [
  ['tt0903747', 'Breaking Bad', 2008], ['tt0944947', 'Game of Thrones', 2011], ['tt0108778', 'Friends', 1994],
  ['tt0386676', 'The Office', 2005], ['tt0141842', 'Família Soprano', 1999], ['tt0306414', 'The Wire', 2002],
  ['tt0475784', 'Westworld', 2016], ['tt2861424', 'Rick and Morty', 2013], ['tt0773262', 'Dexter', 2006],
  ['tt1520211', 'The Walking Dead', 2010], ['tt0411008', 'Lost', 2004], ['tt2356777', 'True Detective', 2014],
  ['tt0460649', 'How I Met Your Mother', 2005], ['tt1475582', 'Sherlock', 2010]];
const movies = [
  ['tt0111161', 'Um Sonho de Liberdade', 1994], ['tt0068646', 'O Poderoso Chefão', 1972], ['tt0468569', 'Batman: O Cavaleiro das Trevas', 2008],
  ['tt0137523', 'Clube da Luta', 1999], ['tt0109830', 'Forrest Gump', 1994], ['tt1375666', 'A Origem', 2010],
  ['tt0133093', 'Matrix', 1999], ['tt0167260', 'O Senhor dos Anéis: O Retorno do Rei', 2003], ['tt0120737', 'A Sociedade do Anel', 2001],
  ['tt0816692', 'Interestelar', 2014], ['tt0114369', 'Seven', 1995], ['tt0110912', 'Pulp Fiction', 1994], ['tt0076759', 'Star Wars', 1977]];
const anime = [
  ['tt0409591', 'Naruto', 2002], ['tt2560140', 'Attack on Titan', 2013], ['tt0877057', 'Death Note', 2006], ['tt0388629', 'One Piece', 1999],
  ['tt1355642', 'Fullmetal Alchemist: Brotherhood', 2009], ['tt9335498', 'Demon Slayer', 2019], ['tt12343534', 'Jujutsu Kaisen', 2020],
  ['tt0213338', 'Cowboy Bebop', 1998], ['tt0988824', 'Naruto Shippuden', 2007], ['tt5626028', 'My Hero Academia', 2016]];
const HOME_T = { pt: ['Continuar assistindo', 'Filmes populares', 'Séries populares', 'Anime em alta'], en: ['Continue watching', 'Popular movies', 'Popular series', 'Trending anime'] };
const home = (L) => ({ rows: [
  { id: 'continue', title: (HOME_T[L] || HOME_T.pt)[0], kind: 'continue', items: [
    I('tt0903747', 'series', 'Breaking Bad', 2008, { progress: 0.42, label: 'T2 E5', videoId: 'tt0903747:2:5', remaining: 27, background: bg('tt0903747') }),
    I('tt0944947', 'series', 'Game of Thrones', 2011, { progress: 0.8, label: 'T1 E3', videoId: 'tt0944947:1:3', remaining: 11, background: bg('tt0944947') }),
    I('tt0816692', 'movie', 'Interestelar', 2014, { progress: 0.15, label: '', videoId: 'tt0816692', remaining: 141, background: bg('tt0816692') }),
    I('tt0409591', 'series', 'Naruto', 2002, { progress: 0.3, label: 'T1 E12', videoId: 'tt0409591:1:12', remaining: 17, background: bg('tt0409591') }),
    I('tt0108778', 'series', 'Friends', 1994, { progress: 0.6, label: 'T4 E9', videoId: 'tt0108778:4:9', remaining: 9, background: bg('tt0108778') }),
    I('tt0386676', 'series', 'The Office', 2005, { progress: 0.05, label: 'T3 E1', videoId: 'tt0386676:3:1', remaining: 21, background: bg('tt0386676') }),
    I('tt0133093', 'movie', 'Matrix', 1999, { progress: 0.5, label: '', videoId: 'tt0133093', remaining: 68, background: bg('tt0133093') })] },
  { id: 'movies', title: (HOME_T[L] || HOME_T.pt)[1], kind: 'poster', items: movies.concat(movies).map((m, i) => I(m[0], 'movie', m[1], m[2])).slice(0, 20) },
  { id: 'series', title: (HOME_T[L] || HOME_T.pt)[2], kind: 'poster', items: series.map(m => I(m[0], 'series', m[1], m[2])) },
  { id: 'anime', title: (HOME_T[L] || HOME_T.pt)[3], kind: 'poster', items: anime.map(m => I(m[0], 'series', m[1], m[2])) }] });
const all = series.map(m => I(m[0], 'series', m[1], m[2])).concat(movies.map(m => I(m[0], 'movie', m[1], m[2])), anime.map(m => I(m[0], 'series', m[1], m[2])));
const state = { rating: {}, lib: {}, watched: {}, progress: {}, settings: { audioLang: 'pt', subLang: 'pt', autoSkip: false, kbMode: 'grid', ratingInput: 'dpad', ratePrompt: true }, rate100: {} };
const EPS = { 1: 7, 2: 13, 3: 8 };
function meta(type, id) {
  const base = all.find(x => x.id === id) || { id, type, name: id, year: 2020 };
  const m = { id, type: base.type || type, name: base.name, year: String(base.year), poster: poster(id), background: bg(id).replace('w=960','w=1280'), logo: `/img?u=${encodeURIComponent('https://images.metahub.space/logo/medium/' + id + '/img')}&w=400&f=png`,
    description: 'Um professor de química do ensino médio recebe um diagnóstico devastador e decide usar seu talento para garantir o futuro da família, mergulhando num mundo cada vez mais perigoso. Uma série sobre escolhas, consequências e o preço da ambição.',
    genres: ['Drama', 'Crime', 'Thriller'], runtime: type === 'movie' ? '2h 28min' : '47 min', imdbRating: '9.5',
    userRating: state.rating[id] || null, inLibrary: !!state.lib[id], watched: !!state.watched[id], seasons: [], videos: [], resume: null };
  if (m.type === 'series') {
    const seasons = id === 'tt0409591' ? [1] : [0, 1, 2, 3]; m.seasons = seasons;
    for (const s of seasons) for (let e = 1; e <= (s === 0 ? 2 : id === 'tt0409591' ? 40 : EPS[s]); e++) {
      const vid = `${id}:${s}:${e}`;
      m.videos.push({ id: vid, season: s, episode: e, title: ['Piloto', 'Gato na Sacola', 'E o Saco Está na Banheira', 'Sobre o Rio', 'Fim de Papo', 'Mão Quente', 'Colheita', 'Cara a Cara', 'Sangue', 'Salvação'][e % 10] + (e > 10 ? ' ' + e : ''),
        released: `20${8 + s}-0${1 + (e % 9)}-1${e % 9}`, thumbnail: `/img?u=${encodeURIComponent('https://episodes.metahub.space/' + id + '/' + s + '/' + e + '/w780.jpg')}&w=240`, watched: (s === 1) || (s === 2 && e < 5) || !!state.watched[vid], progress: s === 2 && e === 5 ? 0.42 : 0 });
    }
    if (id === 'tt0903747') m.resume = { videoId: 'tt0903747:2:5', positionSec: 1000, label: 'T2 E5' };
    if (id === 'tt0409591') m.resume = null;
  } else if (id === 'tt0816692') m.resume = { videoId: id, positionSec: 1500, label: '' };
  return m;
}
const streams = () => ({ streams: [
  { sid: 's1', title: 'Breaking.Bad.S02E05.1080p.BluRay.x264.DUAL', detail: '2.1 GB · 214 seeds · Torrentio', quality: '1080p', lang: ['pt-br', 'en'], kind: 'torrent', recommended: true },
  { sid: 's2', title: 'Breaking Bad S02E05 720p WEB-DL', detail: '980 MB · 88 seeds · Torrentio', quality: '720p', lang: ['en'], kind: 'torrent', recommended: false },
  { sid: 's3', title: 'Breaking Bad - Temporada 2 - Episódio 5 (dublado)', detail: 'Site · RedeCanais', quality: '1080p', lang: ['pt-br'], kind: 'site', recommended: false },
  { sid: 's4', title: 'Breaking.Bad.S02E05.2160p.UHD.HDR.HEVC', detail: '9.8 GB · 41 seeds · Torrentio', quality: '2160p', lang: ['en', 'ja'], kind: 'torrent', recommended: false },
  { sid: 's5', title: 'Breaking.Bad.S02E05.480p.HDTV', detail: '350 MB · 12 seeds · Torrentio', quality: '480p', lang: ['en'], kind: 'torrent', recommended: false },
  { sid: 's6', title: 'Breaking Bad S02E05 1080p AMZN WEB-DL DDP5.1', detail: '3.0 GB · 120 seeds · Torrentio', quality: '1080p', lang: ['en', 'es'], kind: 'torrent', recommended: false },
  { sid: 's7', title: 'Breaking.Bad.S02E05.720p.BluRay', detail: '1.2 GB · 60 seeds · Torrentio', quality: '720p', lang: ['pt-br'], kind: 'torrent', recommended: false },
  { sid: 's8', title: 'Breaking.Bad.S02E05.1080p.WEB-DL.HEVC', detail: '1.4 GB · 33 seeds · Juan Carlos 2', quality: '1080p', lang: ['en'], kind: 'torrent', recommended: false }] });
let sessN = 0; const sessions = {};
const SUBS = (from, to) => { const c = []; for (let t = 0; t < 7200; t += 6) { if (t + 4 >= from && t <= to) c.push([t, t + 4, `Linha de legenda em ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}\nsegunda linha de teste`]); } return c; };
function play(b, L) {
  const en = L === 'en', epl = (s, e) => (en ? 'S' : 'T') + s + ' E' + e;
  const id = String(++sessN);
  const dur = global.MOCK_DUR || 2820;
  const ser = String(b.videoId).split(':');
  const next = ser.length === 3 ? { videoId: `${ser[0]}:${ser[1]}:${+ser[2] + 1}`, label: epl(ser[1], +ser[2] + 1) } : null;
  sessions[id] = b;
  return { session: id, playlist: `/hls/${id}/index.m3u8`, duration: dur,
    audio: [{ aIdx: 0, label: (en ? 'Portuguese (Brazil)' : 'Português (Brasil)') + ' · AAC 2.0' }, { aIdx: 1, label: 'English · AC3 5.1' }, { aIdx: 2, label: 'Japanese · AAC 2.0' }], audioIdx: b.audioIdx != null ? b.audioIdx : (global.MOCK_AUDIO || 0),
    subs: [{ id: 'emb:0', label: en ? 'Portuguese (embedded)' : 'Português (embutida)', source: 'emb' }, { id: 'emb:1', label: en ? 'English (embedded)' : 'English (embutida)', source: 'emb' }, { id: 'ext:0', label: (en ? 'Portuguese (BR)' : 'Português (BR)') + ' #1 (OpenSubtitles v3)', source: 'ext' }],
    skip: [{ type: 'recap', start: 0, end: 20 }, { type: 'intro', start: 60, end: 150 }, { type: 'outro', start: dur - 120, end: dur - 30 }], next };
}
function body(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch (e) { r({}); } }); }); }
const imgCache = {};
function img(u, res) {
  const send = (buf, ct) => { res.writeHead(200, { 'content-type': ct, 'cache-control': 'max-age=3600', 'access-control-allow-origin': '*' }); res.end(buf); };
  if (imgCache[u]) return send(imgCache[u].b, imgCache[u].ct);
  https.get(u, r => { const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => { if (r.statusCode === 200) { imgCache[u] = { b: Buffer.concat(ch), ct: r.headers['content-type'] || 'image/jpeg' }; send(imgCache[u].b, imgCache[u].ct); } else ph(); }); }).on('error', ph).setTimeout(8000, function () { this.destroy(); });
  function ph() { send(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="225"><rect width="150" height="225" fill="#2a2d38"/></svg>`, 'image/svg+xml'); }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const J0 = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  let J = J0;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' }); return res.end(); }
  if (!p.startsWith('/img') && !p.startsWith('/app') && p !== '/') log.push(req.method + ' ' + p + (u.search || ''));
  const delay = ms => new Promise(r => setTimeout(r, ms));
  if (p === '/__log') return J(log);
  if (p === '/__reset') { log.length = 0; Object.assign(state, { rating: {}, lib: {}, watched: {}, progress: {}, settings: { audioLang: 'pt', subLang: 'pt', autoSkip: false, kbMode: 'grid', ratingInput: 'dpad', ratePrompt: true }, rate100: {} }); global.NO_R100 = 0; return J({ ok: 1 }); }
  if (p === '/__fail') { global.FAIL = +u.searchParams.get('on'); return J({ ok: 1 }); }
  if (p === '/__audio') { global.MOCK_AUDIO = +u.searchParams.get('i') || 0; return J({ ok: 1 }); }
  if (p === '/__dur') { global.MOCK_DUR = +u.searchParams.get('s'); return J({ ok: 1 }); }
  if (p === '/api/health') return J({ ok: true, version: 'mock' });
  const LG = u.searchParams.get('lang') || 'pt';
  // the real server writes episode labels as T1 E5 (pt) / S1 E5 (en)
  J = (o, code) => { const L = LG; const body = L === 'en' ? JSON.parse(JSON.stringify(o, (k, v) => (k === 'label' && typeof v === 'string' ? v.replace(/^T(\d+) E/, 'S$1 E') : v))) : o; return J0(body, code); };
  if (p === '/__ui') { state.uiLang = u.searchParams.get('lang') || undefined; return J({ ok: 1, uiLang: state.uiLang }); } // server setting uiLang (test hook)
  if (p === '/api/home') return J(home(LG));
  if (p === '/api/history') return J({ results: all.slice(0, 12).map((x, i) => Object.assign({}, x, { label: [x.type === 'series' ? (LG === 'en' ? 'S1 E' : 'T1 E') + (i + 1) : null, LG === 'en' ? 'Nov ' + (20 - i) : String(20 - i).padStart(2, '0') + '/11', i % 3 === 0 ? (LG === 'en' ? 'watched' : 'visto') : (30 + i * 5) + '%'].filter(Boolean).join(' · ') })) });
  if (p === '/api/library' && req.method === 'GET') return J({ results: all.slice(0, 30) });
  if (p === '/api/search') { const q = (u.searchParams.get('q') || '').toLowerCase(); await delay(150);
    let r = all.filter(x => x.name.toLowerCase().includes(q));
    if (q.includes('naruto')) r = [anime[0], anime[8]].map(m => I(m[0], 'series', m[1], m[2])).concat(all.filter(x => !['tt0409591', 'tt0988824'].includes(x.id)).slice(0, 14));
    return J({ results: r.slice(0, 40) }); }
  let m;
  if ((m = p.match(/^\/api\/meta\/(\w+)\/(.+)$/))) { await delay(120); return J(meta(m[1], decodeURIComponent(m[2]))); }
  if ((m = p.match(/^\/api\/streams\/(\w+)\/(.+)$/))) { await delay(300); return J(streams()); }
  if (p === '/api/play' && req.method === 'POST') { const b = await body(req); await delay(250); if (global.FAIL) return J({ error: LG === 'en' ? 'Could not start playback (mock)' : 'Falha ao iniciar a sessão (mock)' }, 500); return J(play(b, LG)); }
  if ((m = p.match(/^\/api\/subs\/(\d+)\/(.+)$/))) { return J({ cues: SUBS(+u.searchParams.get('from') || 0, +u.searchParams.get('to') || 60), complete: false }); }
  if (p === '/api/progress' && req.method === 'POST') { const b = await body(req); log.push('  progress ' + JSON.stringify(b)); return J({ ok: true }); }
  if (p === '/api/watched' && req.method === 'POST') { const b = await body(req); state.watched[b.videoId || b.itemId] = b.watched; return J({ ok: true }); }
  if (p === '/__r100') { global.NO_R100 = +u.searchParams.get('off'); return J({ ok: 1, rate100: state.rate100 }); } // off=1: behave like a server without /api/rate100
  if (p === '/api/rate100') {
    if (global.NO_R100) { res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end('{"error":"not found"}'); }
    if (req.method === 'POST') { const b = await body(req); log.push('  rate100 ' + JSON.stringify(b)); const sc = Math.round(+b.score);
      if (!b.itemId || !b.videoId || !(sc >= 0 && sc <= 100)) return J({ error: 'bad score' }, 400);
      state.rate100[b.itemId + '|' + b.videoId] = sc; return J({ ok: true, sync: { mal: 'not_linked', letterboxd: 'not_linked' } }); }
    const k = u.searchParams.get('itemId') + '|' + u.searchParams.get('videoId'); return J({ score: state.rate100[k] != null ? state.rate100[k] : null }); }
  if (p === '/api/rate' && req.method === 'POST') { const b = await body(req); state.rating[b.itemId] = b.rating; return J({ ok: true }); }
  if (p === '/api/library' && req.method === 'POST') { const b = await body(req); state.lib[b.itemId] = b.add; return J({ ok: true }); }
  if (p === '/api/settings') { if (req.method === 'POST') Object.assign(state.settings, await body(req)); return J(Object.assign({ sources: [{ id: 'torrentio', name: 'Torrentio', enabled: true, kind: 'addon' }] }, state.settings, state.uiLang ? { uiLang: state.uiLang } : {})); }
  if ((m = p.match(/^\/api\/session\/(\d+)$/)) && req.method === 'DELETE') { delete sessions[m[1]]; return J({ ok: true }); }
  if (p === '/img') return img(u.searchParams.get('u'), res);
  if (p === '/' || p.startsWith('/app')) {
    let f = p === '/' ? 'index.html' : p.replace(/^\/app\/?/, '') || 'index.html';
    const fp = path.join(APP, f);
    if (!fp.startsWith(APP) || !fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': mime[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('{}');
}).listen(PORT, () => console.log('mock on', PORT));
