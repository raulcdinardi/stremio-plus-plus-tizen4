'use strict';
// Shared helpers: paths, secrets, logging (redacted), fetch with timeout, LRU, sqlite, small utils.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = process.env.SPP_ROOT || path.resolve(__dirname, '..');
const STATE = process.env.SPP_STATE || path.join(ROOT, 'state');
fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync(path.join(STATE, 'img'), { recursive: true });

let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(process.env.SPP_SECRETS || path.join(ROOT, 'secrets.json'), 'utf8')); } catch (e) { /* no secrets */ }

const secretValues = Object.values(secrets).filter(v => typeof v === 'string' && v.length > 6);
// secrets written at runtime (e.g. tracker OAuth tokens) are redacted from logs too
function addSecretValue(v) { if (typeof v === 'string' && v.length > 6 && secretValues.indexOf(v) < 0) secretValues.push(v); }
function redact(s) {
  s = String(s);
  for (const v of secretValues) s = s.split(v).join('***');
  // never print full URLs (they may carry tokens): keep scheme+host only
  s = s.replace(/https?:\/\/([^\s"'<>\/]+)[^\s"'<>]*/g, (m, h) => 'url(' + h + ')');
  return s;
}
function log(...a) {
  const line = a.map(x => typeof x === 'string' ? x : (x instanceof Error ? x.message : JSON.stringify(x))).join(' ');
  console.log(new Date().toISOString().slice(11, 19), redact(line).slice(0, 400));
}

class HttpError extends Error {
  constructor(status, msg, code) { super(msg); this.status = status; this.code = code || 'error'; }
}

async function fetchRaw(url, opts) {
  opts = opts || {};
  const timeout = opts.timeout || 10000;
  const init = { method: opts.method || 'GET', headers: opts.headers || {}, signal: AbortSignal.timeout(timeout), redirect: 'follow' };
  if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers = Object.assign({ 'content-type': 'application/json' }, init.headers); }
  else if (opts.body !== undefined) init.body = opts.body;
  const r = await fetch(url, init);
  return r;
}
async function fetchJson(url, opts) {
  let r;
  try { r = await fetchRaw(url, opts); } catch (e) { throw new HttpError(502, 'fetch failed: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message), 'upstream'); }
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'upstream http ' + r.status, 'upstream');
  try { return await r.json(); } catch (e) { throw new HttpError(502, 'bad json from upstream', 'upstream'); }
}

class LRU {
  constructor(max, ttl) { this.max = max; this.ttl = ttl; this.m = new Map(); }
  get(k, allowStale) {
    const e = this.m.get(k); if (!e) return undefined;
    if (e.t < Date.now() && !allowStale) return undefined;
    this.m.delete(k); this.m.set(k, e); return e.v;
  }
  set(k, v, ttl) {
    this.m.delete(k); this.m.set(k, { v, t: Date.now() + (ttl || this.ttl) });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
  }
  del(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
// Cached async call with in-flight de-duplication; serves stale on failure.
const inflight = new Map();
const httpCache = new LRU(300, 10 * 60 * 1000);
async function cached(key, fn, ttl) {
  const v = httpCache.get(key); if (v !== undefined) return v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try { const r = await fn(); httpCache.set(key, r, ttl); return r; }
    catch (e) { const s = httpCache.get(key, true); if (s !== undefined) return s; throw e; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

// One-time migration from the pre-rename database file (kept in place as a backup).
const DB_FILE = path.join(STATE, 'spp.db'), OLD_DB_FILE = path.join(STATE, 'legacy' + '.db');
if (!fs.existsSync(DB_FILE) && fs.existsSync(OLD_DB_FILE)) {
  try {
    const old = new DatabaseSync(OLD_DB_FILE); try { old.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { old.close(); }
    fs.copyFileSync(OLD_DB_FILE, DB_FILE);
  } catch (e) { console.error('db migration failed:', e.message); }
}
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS cache(k TEXT PRIMARY KEY, ts INTEGER, v TEXT);
CREATE TABLE IF NOT EXISTS sids(sid TEXT PRIMARY KEY, ts INTEGER, v TEXT);
CREATE TABLE IF NOT EXISTS progress(item TEXT, video TEXT, type TEXT, name TEXT, pos REAL, dur REAL, ts INTEGER, watched INTEGER DEFAULT 0, PRIMARY KEY(item, video));
CREATE TABLE IF NOT EXISTS ratings(item TEXT PRIMARY KEY, type TEXT, rating INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS libloc(item TEXT PRIMARY KEY, type TEXT, name TEXT, poster TEXT, inlib INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, video TEXT, type TEXT, name TEXT, poster TEXT, start_ts INTEGER, ts INTEGER, start_pos REAL, pos REAL, dur REAL, completed INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS history_ts ON history(ts);
`);
function kvGet(k, d) { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); if (!r) return d; try { return JSON.parse(r.v); } catch (e) { return d; } }
function kvSet(k, v) { db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v)); }
function dbCacheGet(k, maxAgeMs) {
  const r = db.prepare('SELECT ts,v FROM cache WHERE k=?').get(k);
  if (!r) return undefined; if (Date.now() - r.ts > maxAgeMs) return undefined;
  try { return JSON.parse(r.v); } catch (e) { return undefined; }
}
function dbCacheSet(k, v) { db.prepare('INSERT INTO cache(k,ts,v) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET ts=excluded.ts, v=excluded.v').run(k, Date.now(), JSON.stringify(v)); }

// uiLang: language of the user-facing strings the server produces (labels, messages, home rows). 'en' unless set.
// kbMode: TV on-screen keyboard ('grid' = letter grid for D-pad remotes, 'phone' = multi-tap keypad).
// ratingInput: how the 0-100 rating is typed on the TV ('dpad' | 'digits'); ratePrompt: ask for it after finishing something.
// dataSaver: server-side default for the low-bitrate encode (clients decide their own default).
const SETTING_DEFAULTS = { audioLang: 'pt', subLang: 'pt', autoSkip: false, libraryWrite: true, uiLang: 'en', kbMode: 'grid', ratingInput: 'dpad', ratePrompt: true, dataSaver: false,
  partyPublicBase: '', partyName: '' }; // watch-along: public base URL of the viewer link (e.g. https://host/prefix), owner's display name
function getSettings() {
  const s = Object.assign({}, SETTING_DEFAULTS, kvGet('settings', {}));
  if (process.env.SPP_LIBRARY_WRITE === '0') s.libraryWrite = false;
  return s;
}
function setSettings(patch) {
  const cur = kvGet('settings', {});
  for (const k of Object.keys(SETTING_DEFAULTS)) if (patch && patch[k] !== undefined) cur[k] = patch[k];
  if (typeof cur.autoSkip !== 'boolean') cur.autoSkip = !!cur.autoSkip;
  if (cur.dataSaver !== undefined && typeof cur.dataSaver !== 'boolean') cur.dataSaver = !!cur.dataSaver;
  kvSet('settings', cur);
  return getSettings();
}

// ---------- i18n: user-facing strings produced by the server ----------
// Language of the current request: ?lang=xx sent by the app (see withLang) > settings.uiLang > 'en'.
const { AsyncLocalStorage } = require('node:async_hooks');
const LANGS = ['en', 'pt'], DEFAULT_LANG = 'en';
const langCtx = new AsyncLocalStorage();
function normLang(l) { l = String(l == null ? '' : l).toLowerCase().slice(0, 2); return LANGS.indexOf(l) >= 0 ? l : null; }
function withLang(l, fn) { const n = normLang(l); return n ? langCtx.run(n, fn) : fn(); }
function lang() { return langCtx.getStore() || normLang(getSettings().uiLang) || DEFAULT_LANG; }
const STR = {
  en: {
    'home.continue': 'Continue watching', 'home.movies': 'Popular movies', 'home.series': 'Popular series', 'home.anime': 'Trending anime',
    'hist.watched': 'watched', 'months': 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec', 'date.short': (mon, day) => mon + ' ' + day,
    'sub.forced': '(forced)', 'sub.embedded': 'Embedded #{0}',
    'audio.dubbed': 'Portuguese (dubbed)', 'audio.xdub': 'Portuguese · other source (experimental)',
    'sync.fewcues': 'subtitle has too few lines', 'sync.fewspeech': 'too little speech in this stretch', 'sync.unsure': 'uncertain result ({0} s)',
    'sync.ended': 'session ended', 'sync.noaudio': 'not enough audio converted yet',
    'xdub.nosource': 'no source with Portuguese audio', 'xdub.nomatch': "couldn't find a dubbed version that fits this video",
    'err.sid_expired': 'source expired, pick again', 'err.no_streams': 'no streams available', 'err.probe_failed': 'could not open this source (no peers or bad file)',
    'err.session_failed': 'could not start playback', 'err.meta_notfound': 'title not found',
    'oc.name': 'Naruto Ocean Cut (Dubbed)', 'oc.dub': 'Ocean Cut · Dubbed PT-BR', 'oc.orig': 'Ocean Cut · original (English)', 'oc.origTitle': 'Ocean Cut · original in English',
    'oc.queued': ' · queued for preparation', 'oc.failed': ' · failed: {0}', 'oc.preparing': ' · preparing {0}%', 'oc.ready': 'Dattebane + Ocean Cut · ready',
    'oc.desc': 'Filler-free, leaner cut of Naruto and Shippuden (the Ocean Cut fan edit), with the Brazilian Portuguese dub assembled from Dattebane. ',
    'oc.dubError': 'could not build the dub: {0}',
    'oc.dubPending': 'the dub for this episode is still being prepared ({0}%). Pick "original (English)" or try again in a few minutes.',
    'trk.mal': 'MyAnimeList', 'trk.letterboxd': 'Letterboxd',
    'trk.notLinked': 'not linked', 'trk.linked': 'linked as {0}', 'trk.linkedNoUser': 'linked', 'trk.dryRun': 'test mode (nothing is sent)',
    'trk.ok': 'synced {0}', 'trk.never': 'never synced', 'trk.pending': '{0} pending',
    'trk.err.not_linked': 'account not linked', 'trk.err.needs_login': 'signed out: log in to the site in the agent browser',
    'trk.err.no_client_id': 'MyAnimeList API client id missing', 'trk.err.auth': 'authorisation expired: link the account again',
    'trk.err.unmapped': 'could not match this title on {0}', 'trk.err.not_film': 'only films are logged on Letterboxd',
    'trk.err.browser': 'agent browser unavailable', 'trk.err.network': 'network error, will retry', 'trk.err.http': 'server answered an error, will retry',
    'trk.err.has_review': 'today\'s diary entry has a review, rating left unchanged', 'trk.err.no_entry': 'no diary entry from today to rate',
    'trk.err.failed': 'gave up after several attempts',
    'trk.cb.ok': 'MyAnimeList linked as {0}. You can close this tab.', 'trk.cb.fail': 'Could not link MyAnimeList: {0}', 'trk.cb.state': 'link request expired, start again'
  },
  pt: {
    'home.continue': 'Continuar assistindo', 'home.movies': 'Filmes populares', 'home.series': 'Séries populares', 'home.anime': 'Anime em alta',
    'hist.watched': 'visto', 'months': 'jan,fev,mar,abr,mai,jun,jul,ago,set,out,nov,dez', 'date.short': (mon, day, dd, mm) => dd + '/' + mm,
    'sub.forced': '(forçada)', 'sub.embedded': 'Embutida #{0}',
    'audio.dubbed': 'Português (dublado)', 'audio.xdub': 'Português · outra fonte (experimental)',
    'sync.fewcues': 'legenda com poucas falas', 'sync.fewspeech': 'poucas falas neste trecho', 'sync.unsure': 'resultado incerto ({0} s)',
    'sync.ended': 'sessão encerrada', 'sync.noaudio': 'pouco áudio convertido ainda',
    'xdub.nosource': 'nenhuma fonte com áudio em português', 'xdub.nomatch': 'não achei uma versão dublada que encaixe neste vídeo',
    'err.sid_expired': 'a fonte expirou, escolha de novo', 'err.no_streams': 'nenhuma fonte disponível', 'err.probe_failed': 'não consegui abrir esta fonte (sem peers ou arquivo inválido)',
    'err.session_failed': 'não consegui iniciar a reprodução', 'err.meta_notfound': 'título não encontrado',
    'oc.name': 'Naruto Ocean Cut (Dublado)', 'oc.dub': 'Ocean Cut · Dublado PT-BR', 'oc.orig': 'Ocean Cut · original (inglês)', 'oc.origTitle': 'Ocean Cut · original em inglês',
    'oc.queued': ' · na fila para preparar', 'oc.failed': ' · falhou: {0}', 'oc.preparing': ' · preparando {0}%', 'oc.ready': 'Dattebane + Ocean Cut · pronto',
    'oc.desc': 'Versão sem filler e mais enxuta de Naruto e Shippuden (fan edit Ocean Cut), com o áudio dublado em português montado a partir do Dattebane. ',
    'oc.dubError': 'não consegui montar a dublagem: {0}',
    'oc.dubPending': 'a dublagem deste episódio ainda está sendo preparada ({0}%). Escolha "original (inglês)" ou tente em alguns minutos.',
    'trk.mal': 'MyAnimeList', 'trk.letterboxd': 'Letterboxd',
    'trk.notLinked': 'conta não vinculada', 'trk.linked': 'vinculada como {0}', 'trk.linkedNoUser': 'vinculada', 'trk.dryRun': 'modo de teste (nada é enviado)',
    'trk.ok': 'sincronizado {0}', 'trk.never': 'nunca sincronizado', 'trk.pending': '{0} na fila',
    'trk.err.not_linked': 'conta não vinculada', 'trk.err.needs_login': 'sessão encerrada: entre no site no navegador do agente',
    'trk.err.no_client_id': 'falta o client id da API do MyAnimeList', 'trk.err.auth': 'autorização expirou: vincule a conta de novo',
    'trk.err.unmapped': 'não achei este título no {0}', 'trk.err.not_film': 'o Letterboxd só registra filmes',
    'trk.err.browser': 'navegador do agente indisponível', 'trk.err.network': 'erro de rede, vou tentar de novo', 'trk.err.http': 'o servidor respondeu com erro, vou tentar de novo',
    'trk.err.has_review': 'o registro de hoje no diário tem resenha, a nota não foi mexida', 'trk.err.no_entry': 'nenhum registro de hoje no diário para dar nota',
    'trk.err.failed': 'desisti depois de várias tentativas',
    'trk.cb.ok': 'MyAnimeList vinculado como {0}. Pode fechar esta aba.', 'trk.cb.fail': 'Não consegui vincular o MyAnimeList: {0}', 'trk.cb.state': 'o pedido de vínculo expirou, comece de novo'
  }
};
// t('key', a, b): {0} {1} placeholders (or a function value taking the args). Unknown keys fall back to English, then to the key itself.
function t(key) {
  const a = arguments, d = STR[lang()] || STR[DEFAULT_LANG];
  const s = d[key] != null ? d[key] : (STR[DEFAULT_LANG][key] != null ? STR[DEFAULT_LANG][key] : key);
  if (typeof s === 'function') return s.apply(null, Array.prototype.slice.call(a, 1));
  return s.replace(/\{(\d+)\}/g, (m, i) => (a[+i + 1] != null ? a[+i + 1] : ''));
}
// Short date for history labels: 'Nov 23' in English, '23/11' in Portuguese.
function shortDate(ts) {
  const d = new Date(ts), p = n => (n < 10 ? '0' : '') + n;
  return t('date.short', t('months').split(',')[d.getMonth()], d.getDate(), p(d.getDate()), p(d.getMonth() + 1));
}

function rid(n) { return crypto.randomBytes(n || 9).toString('base64url'); }
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function cap(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function readBody(req, max) {
  max = max || 1e6;
  return new Promise((res, rej) => {
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > max) { rej(new HttpError(413, 'body too large')); req.destroy(); } else ch.push(c); });
    req.on('end', () => {
      const t = Buffer.concat(ch).toString('utf8'); if (!t) return res({});
      try { res(JSON.parse(t)); } catch (e) { rej(new HttpError(400, 'invalid json')); }
    });
    req.on('error', rej);
  });
}
function sendJson(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' });
  res.end(b);
}
// Parse stremio ids: tt1:S:E, kitsu:N:E, kitsu:N, tt1
function parseVideoId(id) {
  const p = String(id).split(':');
  if (p[0] === 'kitsu') return { base: 'kitsu:' + p[1], season: p.length > 2 ? 1 : null, episode: p.length > 2 ? +p[2] : null, kitsu: true };
  return { base: p[0], season: p.length > 2 ? +p[1] : null, episode: p.length > 2 ? +p[2] : null, kitsu: false };
}
function label(season, episode, kitsu) {
  if (episode == null) return null;
  return kitsu ? 'E' + episode : (lang() === 'pt' ? 'T' : 'S') + season + ' E' + episode;
}
function imgUrl(u, w) { return u ? '/img?u=' + encodeURIComponent(u) + '&w=' + (w || 150) : null; }

module.exports = { ROOT, STATE, secrets, addSecretValue, redact, log, HttpError, fetchRaw, fetchJson, LRU, cached, httpCache, db, kvGet, kvSet, dbCacheGet, dbCacheSet,
  getSettings, setSettings, LANGS, DEFAULT_LANG, normLang, withLang, lang, t, shortDate, rid, sha1, cap, readBody, sendJson, parseVideoId, label, imgUrl, VERSION: '0.1.0' };
