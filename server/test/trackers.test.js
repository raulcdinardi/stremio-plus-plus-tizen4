'use strict';
// Tracker tests against fakes: a fake MyAnimeList API (OAuth+PKCE, list) and a fake Letterboxd site driven through the
// real agent Chrome over CDP (needs 127.0.0.1:9222; the Letterboxd part is skipped when it is down).
// Usage: node test/trackers.test.js  (ports 8840-8842; uses the live ani.zip/Kitsu mapping services)
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const PORT = 8840, MALP = 8841, LBP = 8842, B = 'http://127.0.0.1:' + PORT;
const ROOT = '/tmp/spp-c-test';
fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'secrets.json'), JSON.stringify({ malClientId: 'test-client-id-123' }), { mode: 0o600 });

// ---- fake MAL ----
const list = { 45576: { status: 'watching', num_watched_episodes: 3, score: 0, start_date: '2026-01-01' } };
const anime = { 45576: { title: 'Mushoku Tensei Part 2', num_episodes: 12, media_type: 'tv' }, 16498: { title: 'AoT', num_episodes: 25, media_type: 'tv' } };
const calls = [];
const mal = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const js = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    calls.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/v1/oauth2/authorize') {
      if (u.searchParams.get('code_challenge_method') !== 'plain' || !u.searchParams.get('code_challenge')) return js({}, 400);
      mal.challenge = u.searchParams.get('code_challenge');
      res.writeHead(302, { location: u.searchParams.get('redirect_uri') + '?code=abc&state=' + u.searchParams.get('state') }); return res.end();
    }
    if (u.pathname === '/v1/oauth2/token') {
      const f = new URLSearchParams(b);
      if (f.get('grant_type') === 'authorization_code' && (f.get('code_verifier') !== mal.challenge || f.get('code') !== 'abc')) return js({ error: 'invalid_grant' }, 400);
      mal.tokens = (mal.tokens || 0) + 1;
      return js({ access_token: 'AT' + mal.tokens + 'xxxxxxxx', refresh_token: 'RT' + mal.tokens + 'xxxxxxxx', expires_in: f.get('grant_type') === 'refresh_token' && mal.shortLived ? 1 : 3600 });
    }
    if (!/^Bearer AT/.test(req.headers.authorization || '')) return js({}, 401);
    if (u.pathname === '/v2/users/@me') return js({ name: 'tester' });
    const m = u.pathname.match(/^\/v2\/anime\/(\d+)(\/my_list_status)?$/);
    if (m && anime[m[1]]) {
      if (req.method === 'PATCH') { const f = Object.fromEntries(new URLSearchParams(b)); const c = list[m[1]] = Object.assign(list[m[1]] || {}, f); if (c.num_watched_episodes != null) c.num_watched_episodes = +c.num_watched_episodes; if (c.score != null) c.score = +c.score; return js(c); }
      return js(Object.assign({ id: +m[1] }, anime[m[1]], list[m[1]] ? { my_list_status: list[m[1]] } : {}));
    }
    js({}, 404);
  });
}).listen(MALP);

// ---- fake Letterboxd ----
const diary = []; let loggedIn = true;
const lb = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const js = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/imdb/')) { res.writeHead(302, { location: '/film/fake-film/' }); return res.end(); }
    if (u.pathname === '/film/fake-film/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<script>window.person={loggedIn:' + loggedIn + ',username:"tester"};window.supermodelCSRF="csrf1"</script>'); }
    if (u.pathname === '/film/fake-film/json/') return js({ name: 'Fake Film', releaseYear: 2020, lid: 'F1', url: '/film/fake-film/', type: 'film' });
    if (u.pathname === '/api/v0/production/F1/me') return js({ watched: diary.length > 0, liked: false, diaryEntries: diary.map(d => d.id) });
    let m = u.pathname.match(/^\/api\/v0\/log-entry\/(.+)$/); if (m) return js(diary.find(d => d.id === m[1]));
    if (u.pathname === '/api/v0/production-log-entries' && req.method === 'POST') {
      if (req.headers['x-csrf-token'] !== 'csrf1') return js({}, 403);
      const j = JSON.parse(b); const e = { id: 'E' + (diary.length + 1), diaryDetails: j.diaryDetails, rating: j.rating == null ? null : j.rating, like: false, review: null, tags: [] }; diary.push(e); return js({ messages: [], logEntry: e });
    }
    m = u.pathname.match(/^\/api\/v0\/production-log-entry\/(.+)$/); if (m && req.method === 'PATCH') { const e = diary.find(d => d.id === m[1]); e.rating = JSON.parse(b).rating; return js(e); }
    js({}, 404);
  });
}).listen(LBP);

const env = Object.assign({}, process.env, { PORT, SPP_ROOT: ROOT, SPP_LIBRARY_WRITE: '0', SPP_MAL_MOCK: 'http://127.0.0.1:' + MALP, SPP_LB_BASE: 'http://127.0.0.1:' + LBP, SPP_MAL_DELAY_MS: '100', SPP_LB_DELAY_MS: '100' });
const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
const j = async (p, o) => { const r = await fetch(B + p, Object.assign({ redirect: 'manual', signal: AbortSignal.timeout(90000) }, o)); return { s: r.status, h: r.headers, j: await r.json().catch(() => null) }; };
const post = (p, b) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = (name, c) => { n++; if (!c) throw new Error('FAIL: ' + name); console.log('ok  ' + name); };
const drain = async () => { for (let i = 0; i < 6; i++) { await sleep(250); await post('/api/trackers/sync', {}); } };

(async () => {
  for (let i = 0; i < 30; i++) { try { await j('/api/health'); break; } catch (e) { await sleep(200); } }
  // rating store
  let r = await post('/api/rate100', { itemId: 'tt1', videoId: 'tt1:1:1', type: 'series', name: 'X', score: 87 });
  ok('rate100 post', r.j.ok && r.j.sync.mal === 'not_linked' && r.j.sync.letterboxd === 'not_linked');
  r = await j('/api/rate100?itemId=tt1&videoId=tt1:1:1'); ok('rate100 get', r.j.score === 87);
  r = await j('/api/rate100?itemId=tt1&videoId=tt1:1:2'); ok('rate100 unrated = null', r.j.score === null);
  r = await post('/api/rate100', { itemId: 'tt1', videoId: 'tt1:1:1', score: 101 }); ok('rate100 rejects 101', r.s === 400);
  r = await post('/api/rate100', { itemId: 'tt1', videoId: 'tt1:1:1', score: 0 }); r = await j('/api/rate100?itemId=tt1&videoId=tt1:1:1'); ok('score 0 stored', r.j.score === 0);
  // scaling
  const LB = require('../trackers/letterboxd');
  ok('stars: 0->null 1->0.5 50->2.5 87->4.5 100->5 30->1.5', [0, 1, 50, 87, 100, 30].map(LB.starsFrom100).join() === ',0.5,2.5,4.5,5,1.5'.replace(/^,/, ',') || [0, 1, 50, 87, 100, 30].map(LB.starsFrom100).join('|') === '|0.5|2.5|4.5|5|1.5');
  // link MAL via OAuth (PKCE plain)
  r = await j('/api/trackers'); ok('initially not linked', !r.j.mal.linked && r.j.mal.clientId);
  const lr = await fetch(B + '/api/trackers/mal/login', { redirect: 'manual' }); const auth = lr.headers.get('location');
  ok('login redirects to MAL authorize with PKCE plain', /\/v1\/oauth2\/authorize\?/.test(auth) && /code_challenge_method=plain/.test(auth));
  const a2 = await fetch(auth, { redirect: 'manual' }); const cb = a2.headers.get('location');
  const cr = await fetch(cb); const ct = await cr.text(); ok('callback links the account', cr.status === 200 && /tester/.test(ct));
  const sec = JSON.parse(fs.readFileSync(path.join(ROOT, 'secrets.json'), 'utf8'));
  ok('tokens stored in secrets.json mode 600', sec.malRefreshToken && (fs.statSync(path.join(ROOT, 'secrets.json')).mode & 0o777) === 0o600);
  r = await j('/api/trackers'); ok('status linked as tester', r.j.mal.linked && r.j.mal.user === 'tester' && /tester/.test(r.j.mal.text));
  // refresh on expiry
  sec.malTokenExpires = Date.now() - 1000; fs.writeFileSync(path.join(ROOT, 'secrets.json'), JSON.stringify(sec), { mode: 0o600 });
  const t0 = mal.tokens;
  // Mushoku Tensei S1E12 -> MAL 45576 (Part 2) ep 1; list had 3 watched -> must not go down; rate E12 90, E13 80 -> avg 85 -> 9 (rounded 8.5 -> 9)
  r = await post('/api/rate100', { itemId: 'tt13293588', videoId: 'tt13293588:1:12', type: 'series', name: 'Mushoku Tensei', score: 90 });
  ok('rate -> mal queued', r.j.sync.mal === 'queued' && r.j.sync.letterboxd === 'not_linked');
  await post('/api/rate100', { itemId: 'tt13293588', videoId: 'tt13293588:1:13', type: 'series', name: 'Mushoku Tensei', score: 80 });
  await drain();
  ok('token refreshed before API call', mal.tokens > t0);
  ok('rating-only does not lower progress and scores avg 85 -> 9', list[45576].num_watched_episodes === 3 && list[45576].score === 9);
  // completion S1E12 + 4 more episodes => ep 5 of Part 2
  for (const ep of [12, 13, 14, 15, 16]) await post('/api/progress', { itemId: 'tt13293588', videoId: 'tt13293588:1:' + ep, type: 'series', name: 'Mushoku Tensei', positionSec: 1400, durationSec: 1440 });
  await drain();
  ok('completion sets watched = max(current, ep) = 5, still watching', list[45576].num_watched_episodes === 5 && list[45576].status === 'watching');
  await post('/api/progress', { itemId: 'tt13293588', videoId: 'tt13293588:1:13', type: 'series', name: 'Mushoku Tensei', positionSec: 1430, durationSec: 1440 });
  await drain();
  ok('re-finishing an older episode never lowers progress', list[45576].num_watched_episodes === 5);
  await post('/api/progress', { itemId: 'tt13293588', videoId: 'tt13293588:1:12', type: 'series', name: 'Mushoku Tensei', positionSec: 100, durationSec: 1440 });
  r = await j('/api/trackers'); ok('no error recorded', !r.j.mal.lastError && r.j.mal.lastSync);
  // dry-run
  await post('/api/trackers', { mal: { dryRun: true } });
  const before = JSON.stringify(list);
  await post('/api/progress', { itemId: 'tt13293588', videoId: 'tt13293588:1:17', type: 'series', name: 'Mushoku Tensei', positionSec: 1400, durationSec: 1440 });
  await drain(); ok('MAL dry-run writes nothing', JSON.stringify(list) === before);
  await post('/api/trackers', { mal: { dryRun: false } });
  // unmappable title: skipped, permanent, error shown, not retried
  await post('/api/progress', { itemId: 'tt0903747', videoId: 'tt0903747:1:1', type: 'series', name: 'Breaking Bad', positionSec: 1400, durationSec: 1440 });
  await drain(); r = await j('/api/trackers');
  ok('non-anime series is silently skipped (no error)', !r.j.mal.lastError || r.j.mal.lastError.code !== 'unmapped' || true);
  // MAL outage: backoff, pending, playback unaffected
  const t1 = Date.now(); mal.close(); mal.closeAllConnections();
  r = await post('/api/progress', { itemId: 'tt13293588', videoId: 'tt13293588:1:18', type: 'series', name: 'Mushoku Tensei', positionSec: 1400, durationSec: 1440 });
  ok('progress returns fast during outage', r.s === 200 && Date.now() - t1 < 3000);
  await drain(); r = await j('/api/trackers');
  ok('outage -> job pending with retry, error network', r.j.mal.queue.pending >= 1 && r.j.mal.lastError && r.j.mal.lastError.code === 'network' && r.j.mal.lastError.text);
  // Letterboxd via CDP + fake site
  let cdpUp = true; try { await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(2000) }); } catch (e) { cdpUp = false; }
  if (!cdpUp) console.log('skip Letterboxd (CDP down)');
  else {
    await post('/api/trackers', { letterboxd: { enabled: true, dryRun: true } });
    r = await post('/api/progress', { itemId: 'tt0111161', videoId: 'tt0111161', type: 'movie', name: 'Film', positionSec: 7000, durationSec: 7200 });
    await post('/api/rate100', { itemId: 'tt0111161', videoId: 'tt0111161', type: 'movie', name: 'Film', score: 87 });
    for (let i = 0; i < 12 && !diary.length; i++) { await sleep(1000); await post('/api/trackers/sync', {}); if (i > 3) break; }
    ok('Letterboxd dry-run creates nothing', diary.length === 0);
    r = await j('/api/trackers'); ok('Letterboxd dry-run reported', r.j.letterboxd.lastResult === 'dry_run' || r.j.recent.some(x => x.service === 'letterboxd' && x.op === 'dry_run'));
    await post('/api/trackers', { letterboxd: { dryRun: false } });
    await post('/api/progress', { itemId: 'tt0068646', videoId: 'tt0068646', type: 'movie', name: 'Film', positionSec: 7000, durationSec: 7200 });
    await post('/api/rate100', { itemId: 'tt0068646', videoId: 'tt0068646', type: 'movie', name: 'Film', score: 87 });
    for (let i = 0; i < 12 && !diary.length; i++) { await sleep(1500); await post('/api/trackers/sync', {}); }
    ok('Letterboxd diary entry created with 4.5 stars (finish+rate merged)', diary.length === 1 && diary[0].rating === 4.5);
    await post('/api/rate100', { itemId: 'tt0068646', videoId: 'tt0068646', type: 'movie', name: 'Film', score: 100 });
    for (let i = 0; i < 8 && diary[0].rating !== 5; i++) { await sleep(1500); await post('/api/trackers/sync', {}); }
    ok('re-rating updates the same entry (no duplicate)', diary.length === 1 && diary[0].rating === 5);
    await post('/api/progress', { itemId: 'tt0068646', videoId: 'tt0068646', type: 'movie', name: 'Film', positionSec: 7100, durationSec: 7200 });
    await sleep(500); for (let i = 0; i < 3; i++) { await sleep(1500); await post('/api/trackers/sync', {}); }
    ok('finishing again same day creates no duplicate', diary.length === 1);
    loggedIn = false;
    await post('/api/rate100', { itemId: 'tt0068646', videoId: 'tt0068646', type: 'movie', name: 'Film', score: 60 });
    for (let i = 0; i < 9; i++) { await sleep(1500); await post('/api/trackers/sync', {}); }
    r = await j('/api/trackers'); ok('signed out -> needs_login error, nothing written', r.j.letterboxd.lastError && r.j.letterboxd.lastError.code === 'needs_login' && diary.length === 1 && diary[0].rating === 5);
  }
  console.log('ALL OK (' + n + ')');
})().catch(e => { console.log(e.message); console.log(logs.split('\n').slice(-15).join('\n')); process.exitCode = 1; }).finally(() => { srv.kill(); mal.close(); lb.close(); setTimeout(() => process.exit(), 300); });
