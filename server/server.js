'use strict';
// Stremio++ server: HTTP router. Zero deps. See SPEC.md.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const U = require('./util');
const S = require('./api/stremio');
const M = require('./api/meta');
const L = require('./api/library');
const ST = require('./api/streams');
const PL = require('./api/play');
const K = require('./api/skip');
const IMG = require('./api/img');
const A = require('./api/admin');
const TR = require('./api/trackers');
const WP = require('./watchparty');

const PORT = +process.env.PORT || 8790;
const APP_DIR = path.resolve(__dirname, '..', 'app');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };

process.on('uncaughtException', e => U.log('UNCAUGHT', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
process.on('unhandledRejection', e => U.log('UNHANDLED', e && e.message ? e.message : e));

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,range,authorization');
  res.setHeader('Access-Control-Expose-Headers', 'content-length,content-range');
}
function serveStatic(req, res, rel) {
  let p;
  try { p = decodeURIComponent(rel); } catch (e) { throw new U.HttpError(400, 'bad path'); }
  if (!p || p.endsWith('/')) p += 'index.html';
  const file = path.resolve(APP_DIR, '.' + path.sep + p);
  if (file !== APP_DIR && !file.startsWith(APP_DIR + path.sep)) throw new U.HttpError(403, 'forbidden');
  let st; try { st = fs.statSync(file); } catch (e) { throw new U.HttpError(404, 'not found', 'not_found'); }
  if (!st.isFile()) throw new U.HttpError(404, 'not found', 'not_found');
  const mtime = st.mtime.toUTCString();
  const h = { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'last-modified': mtime, 'cache-control': 'no-cache', etag: 'W/"' + st.size + '-' + st.mtimeMs + '"' };
  if (req.headers['if-none-match'] === h.etag) { res.writeHead(304, h); return res.end(); }
  h['content-length'] = st.size;
  res.writeHead(200, h);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

async function route(req, res, url) {
  const p = url.pathname, m = req.method;
  let x;
  // Requests that came through the public watch-along route of the VPS carry X-Spp-Public (set by the proxy, which also strips
  // any client-supplied copy): they may reach the viewer page, its HLS and its sync endpoints, and nothing else.
  if (req.headers['x-spp-public'] && !/^\/w\/[\w-]{8,64}(\/|$)/.test(p)) throw new U.HttpError(404, 'not found', 'not_found');
  if (/^\/w\//.test(p) || p === '/api/party' || p.startsWith('/api/party/')) {
    const pb = m === 'POST' ? await U.readBody(req, 20000) : null;
    if (await WP.handle(req, res, url, p, pb)) return;
  }
  if (p === '/' || p === '/app') { res.writeHead(302, { location: '/app/' }); return res.end(); }
  if (p.startsWith('/app/')) return serveStatic(req, res, p.slice(5));
  if (p === '/admin' || p === '/admin/') {
    const b = Buffer.from(A.page()); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' }); return res.end(b);
  }
  if (p === '/img') return IMG.handle(req, res, url);
  if ((x = p.match(/^\/hls\/([\w-]+)\/index\.m3u8$/))) return PL.media().handlePlaylist(req, res, x[1]);
  if ((x = p.match(/^\/hls\/([\w-]+)\/(\d+)\.(?:ts|m4s)$/))) return PL.media().handleSegment(req, res, x[1], +x[2]);
  if ((x = p.match(/^\/hls\/([\w-]+)\/init\.mp4$/))) return PL.media().handleInit(req, res, x[1]);

  if (!p.startsWith('/api/')) throw new U.HttpError(404, 'not found', 'not_found');
  const body = m === 'POST' ? await U.readBody(req) : null;
  if (p === '/api/rate100' || p.startsWith('/api/trackers')) { if (await TR.route(req, res, url, body)) return; }

  if (p === '/api/health' && m === 'GET') return U.sendJson(res, 200, { ok: true, version: U.VERSION });
  if (p === '/api/home' && m === 'GET') {
    const safe = f => f().catch(e => { U.log('home row failed:', e.message); return []; });
    const [cont, mv, sr, an] = await Promise.all([safe(L.continueRow), safe(M.topMovies), safe(M.topSeries), safe(M.animeTrending)]);
    const rows = [];
    if (cont.length) rows.push({ id: 'continue', title: U.t('home.continue'), kind: 'continue', items: cont });
    for (const [id, list] of [['movies', mv], ['series', sr], ['anime', an]])
      if (list.length) rows.push({ id, title: U.t('home.' + id), kind: 'poster', items: list.slice(0, 20).map(i => M.toItem(i)) });
    return U.sendJson(res, 200, { rows });
  }
  if (p === '/api/search' && m === 'GET') return U.sendJson(res, 200, { results: await M.search(url.searchParams.get('q')) });
  if ((x = p.match(/^\/api\/meta\/(movie|series|anime)\/(.+)$/)) && m === 'GET') return U.sendJson(res, 200, await L.buildMetaResponse(x[1], decodeURIComponent(x[2])));
  if ((x = p.match(/^\/api\/streams\/(movie|series|anime)\/(.+)$/)) && m === 'GET') {
    const type = x[1] === 'movie' ? 'movie' : 'series', id = decodeURIComponent(x[2]);
    K.prefetch(id, type);
    return U.sendJson(res, 200, await ST.getStreams(type, id));
  }
  if ((x = p.match(/^\/api\/skip\/(.+)$/)) && m === 'GET') {
    const id = decodeURIComponent(x[1]);
    return U.sendJson(res, 200, { skip: await K.lookup({ videoId: id, type: url.searchParams.get('type') === 'movie' ? 'movie' : 'series', duration: +url.searchParams.get('duration') || 0, wait: +url.searchParams.get('wait') || 2000 }) });
  }
  if (p === '/api/play' && m === 'POST') return U.sendJson(res, 200, await PL.play(Object.assign({}, body, { viaRelay: req.headers['x-spp-via'] === 'vps' })));
  if ((x = p.match(/^\/api\/subs\/([\w-]+)\/([\w:%]+)$/)) && m === 'GET') return U.sendJson(res, 200, await PL.getSubs(x[1], decodeURIComponent(x[2]), url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('raw') === '1'));
  if (p === '/api/subsync' && m === 'POST') return U.sendJson(res, 200, PL.startSync(body));
  if (p === '/api/subsync' && m === 'GET') return U.sendJson(res, 200, PL.syncStatus({ session: url.searchParams.get('session'), subId: url.searchParams.get('subId') }));
  if (p === '/api/subsync/reset' && m === 'POST') return U.sendJson(res, 200, PL.syncReset(body));
  if (p === '/api/xdub' && m === 'POST') return U.sendJson(res, 200, PL.startXdub(body));
  if (p === '/api/xdub' && m === 'GET') return U.sendJson(res, 200, PL.xdubStatus({ session: url.searchParams.get('session') }));
  if (p === '/api/progress' && m === 'POST') return U.sendJson(res, 200, await L.progress(body));
  if (p === '/api/watched' && m === 'POST') return U.sendJson(res, 200, await L.setWatched(body));
  if (p === '/api/rate' && m === 'POST') return U.sendJson(res, 200, await L.rate(body));
  if (p === '/api/history' && m === 'GET') return U.sendJson(res, 200, { results: await L.historyList(url.searchParams.get('limit')) });
  if (p === '/api/library' && m === 'GET') return U.sendJson(res, 200, { results: await L.libraryList() });
  if (p === '/api/library' && m === 'POST') return U.sendJson(res, 200, await L.setLibrary(body));
  if ((x = p.match(/^\/api\/session\/([\w-]+)$/)) && m === 'DELETE') { await PL.destroySession(x[1]); return U.sendJson(res, 200, { ok: true }); }
  if (p === '/api/settings' && m === 'GET') return U.sendJson(res, 200, await A.getSettings());
  if (p === '/api/settings' && m === 'POST') return U.sendJson(res, 200, await A.postSettings(body));
  if (p === '/api/admin/state' && m === 'GET') return U.sendJson(res, 200, await A.adminState());
  if (p === '/api/admin/addon' && m === 'POST') return U.sendJson(res, 200, await S.addExtraAddon(body && body.url));
  if (p === '/api/admin/addon' && m === 'DELETE') { S.removeExtraAddon(url.searchParams.get('id')); return U.sendJson(res, 200, { ok: true }); }
  throw new U.HttpError(404, 'not found', 'not_found');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-max-age': '86400' }); return res.end(); }
  const t0 = Date.now();
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { return U.sendJson(res, 400, { error: 'bad url' }); }
  res.on('finish', () => { if (!/\.(ts|m4s)$|^\/img/.test(url.pathname)) U.log(req.method, url.pathname.replace(/^\/w\/[\w-]+/, '/w/***'), res.statusCode, Date.now() - t0 + 'ms'); }); // the viewer token is a credential: never logged
  // ?lang=xx (sent by the app) picks the language of the user-facing strings for this request; else settings.uiLang, else 'en'.
  Promise.resolve().then(() => U.withLang(url.searchParams.get('lang'), () => route(req, res, url))).catch(e => {
    const status = e instanceof U.HttpError ? e.status : 500;
    if (status >= 500) U.log('ERR', req.method, url.pathname, e.message);
    if (res.headersSent) return res.destroy();
    U.sendJson(res, status, { error: e.message || 'error', code: e.code || 'error' });
  });
});
server.requestTimeout = 0; server.headersTimeout = 30000; server.keepAliveTimeout = 5000;

function shutdown() {
  U.log('shutting down');
  try { WP.closeAll(); } catch (e) { /* none */ }
  try { if (process.env.SPP_MEDIA !== 'none') PL.media().destroyAll(); } catch (e) { /* media not loaded */ }
  server.close(); setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

if (require.main === module) {
  TR.start();
  server.listen(PORT, '0.0.0.0', () => U.log('Stremio++ server', U.VERSION, 'listening on', PORT, '| libraryWrite=' + U.getSettings().libraryWrite));
}
module.exports = { server };
