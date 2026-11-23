'use strict';
// Live API test: starts the server on a test port with a temp state dir and library WRITES DISABLED (dry-run), then hits every endpoint.
// Usage: node test/api.test.js   (set SPP_MEDIA=./test/media-stub.js to avoid real transcoding; E2E=1 for a real play)
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const path = require('node:path');
const PORT = 8792, B = 'http://127.0.0.1:' + PORT;
const env = Object.assign({}, process.env, { PORT, SPP_STATE: '/tmp/spp-b/state-test', SPP_LIBRARY_WRITE: '0' });
const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
const j = async (p, o) => { const r = await fetch(B + p, Object.assign({ signal: AbortSignal.timeout(90000) }, o)); return { s: r.status, h: r.headers, j: await r.json().catch(() => null) }; };
const post = (p, b, m) => j(p, { method: m || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
let n = 0; const ok = (name, c) => { n++; if (!c) throw new Error('FAIL: ' + name); console.log('ok  ' + name); };

(async () => {
  for (let i = 0; i < 30; i++) { try { await j('/api/health'); break; } catch (e) { await new Promise(r => setTimeout(r, 200)); } }
  let r = await j('/api/health'); ok('health', r.j.ok && r.h.get('access-control-allow-origin') === '*');
  r = await j('/api/home'); ok('home rows non-empty', r.j.rows.length >= 3 && r.j.rows.every(x => x.items.length > 0 && x.items.length <= 20));
  r = await j('/api/search?q=naruto'); ok('search naruto', r.j.results.length > 0 && r.j.results.length <= 40);
  r = await j('/api/search?q=breaking%20bad'); ok('search breaking bad', r.j.results.some(x => x.id === 'tt0903747'));
  r = await j('/api/meta/series/tt0903747'); ok('meta series', r.j.name === 'Breaking Bad' && r.j.videos.length > 50 && r.j.seasons.includes(1) && r.j.description.length <= 600);
  r = await j('/api/meta/movie/tt0111161'); ok('meta movie', r.j.name.includes('Shawshank'));
  r = await j('/api/meta/series/kitsu:11'); ok('meta kitsu', r.j.videos.length > 100);
  r = await j('/api/streams/series/tt0903747:1:1'); ok('streams ranked w/ sids', r.j.streams.length > 5 && r.j.streams.length <= 60 && r.j.streams[0].recommended && r.j.streams.every(s => s.sid));
  ok('streams lang tags parsed', r.j.streams.some(s => s.lang.length > 0) && r.j.streams.every(s => ['torrent', 'http', 'site'].includes(s.kind)));
  const u = encodeURIComponent('https://images.metahub.space/poster/small/tt0903747/img');
  const ir = await fetch(B + '/img?u=' + u + '&w=200'); const buf = Buffer.from(await ir.arrayBuffer());
  ok('img jpeg', ir.headers.get('content-type') === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && /max-age=604800/.test(ir.headers.get('cache-control')));
  r = await j('/img?u=file%3A%2F%2F%2Fetc%2Fpasswd'); ok('img rejects file:', r.s === 400);
  r = await j('/api/skip/tt0409591:1:1?duration=1400&wait=15000'); ok('skip aniskip (imdb anime)', r.j.skip.some(x => x.type === 'intro'));
  r = await j('/api/skip/tt0903747:1:1?duration=2800&wait=15000'); ok('skip theintrodb (live action)', r.j.skip.some(x => x.type === 'intro'));
  r = await post('/api/watched', { itemId: 'tt0903747', videoId: 'tt0903747:1:3', watched: true }); ok('watched (dry-run)', r.j.ok && r.j.synced === false);
  r = await j('/api/meta/series/tt0903747'); ok('watched overlay visible', r.j.videos.find(v => v.id === 'tt0903747:1:3').watched === true);
  r = await post('/api/library', { itemId: 'tt0111161', type: 'movie', add: true }); ok('library add (dry-run)', r.j.ok && r.j.synced === false);
  r = await j('/api/meta/movie/tt0111161'); ok('inLibrary overlay', r.j.inLibrary === true);
  r = await post('/api/rate', { itemId: 'tt0111161', type: 'movie', rating: 9 }); ok('rate', r.j.ok && r.j.rating === 9);
  r = await j('/api/meta/movie/tt0111161'); ok('userRating', r.j.userRating === 9);
  r = await post('/api/progress', { itemId: 'tt0111161', videoId: 'tt0111161', type: 'movie', name: 'x', positionSec: 600, durationSec: 8000, state: 'stopped' }); ok('progress', r.j.ok);
  r = await post('/api/settings', { audioLang: 'en', autoSkip: true }); ok('settings post', r.j.audioLang === 'en' && r.j.autoSkip === true);
  r = await post('/api/settings', { audioLang: 'pt', autoSkip: false, sources: [{ id: 'provider:example', enabled: false }] }); ok('settings reset', r.j.audioLang === 'pt' && r.j.sources.length >= 3);
  r = await post('/api/admin/addon', { url: 'https://v3-cinemeta.strem.io/manifest.json' }); ok('admin add addon', r.j.id === 'com.linvo.cinemeta');
  r = await post('/api/admin/addon?id=com.linvo.cinemeta', {}, 'DELETE'); ok('admin remove addon', r.j.ok);
  const a = await fetch(B + '/admin'); ok('/admin html', (await a.text()).includes('Stremio++'));
  r = await j('/app/index.html'); ok('/app/ static (200 or 404 if no app yet)', r.s === 200 || r.s === 404);
  r = await j('/api/nope'); ok('404 json', r.s === 404 && r.j.error);
  ok('no PUT happened', !/datastorePut/.test(logs));
  if (process.env.E2E) {
    r = await post('/api/play', { sid: 'auto', itemId: 'tt0111161', videoId: 'tt0111161', type: 'movie' });
    ok('play e2e', r.j.session && r.j.playlist);
    const m3 = await fetch(B + r.j.playlist); ok('playlist', (await m3.text()).includes('#EXT-X-ENDLIST'));
    await j('/api/session/' + r.j.session, { method: 'DELETE' });
  }
  console.log('ALL ' + n + ' CHECKS PASSED');
})().catch(e => { console.error(e.message); console.error(logs.split('\n').slice(-8).join('\n')); process.exitCode = 1; }).finally(() => { srv.kill(); });
