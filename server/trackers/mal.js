'use strict';
// MyAnimeList API v2 client + OAuth2 (authorization code with PKCE, method "plain" as MAL requires).
// Secrets (secrets file, mode 600): malClientId, [malClientSecret], [malRedirectUri], malAccessToken, malRefreshToken, malTokenExpires.
const crypto = require('node:crypto');
const U = require('../util');
const SS = require('./secretstore');

const MOCK = process.env.SPP_MAL_MOCK; // tests only: base URL of a fake MAL
const AUTH = MOCK ? MOCK + '/v1/oauth2/authorize' : 'https://myanimelist.net/v1/oauth2/authorize';
const TOKEN = MOCK ? MOCK + '/v1/oauth2/token' : 'https://myanimelist.net/v1/oauth2/token';
const API = MOCK ? MOCK + '/v2' : 'https://api.myanimelist.net/v2';

class TrackerError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

const pendingAuth = new Map(); // state -> {verifier, redirectUri, ts}

function clientId() { return SS.get('malClientId'); }
function linked() { return !!(clientId() && SS.get('malRefreshToken')); }

// Step 1: URL to send the browser to. redirectUri must equal the one registered at myanimelist.net/apiconfig.
function authUrl(redirectUri) {
  const id = clientId();
  if (!id) throw new TrackerError('no_client_id');
  redirectUri = SS.get('malRedirectUri') || redirectUri;
  const verifier = crypto.randomBytes(64).toString('base64url').slice(0, 128); // 43..128 chars, unreserved
  const state = crypto.randomBytes(12).toString('base64url');
  for (const [k, v] of pendingAuth) if (Date.now() - v.ts > 15 * 60e3) pendingAuth.delete(k);
  pendingAuth.set(state, { verifier, redirectUri, ts: Date.now() });
  return AUTH + '?' + new URLSearchParams({ response_type: 'code', client_id: id, code_challenge: verifier, code_challenge_method: 'plain', state, redirect_uri: redirectUri }).toString();
}

async function tokenRequest(form) {
  form.client_id = clientId();
  const sec = SS.get('malClientSecret'); if (sec) form.client_secret = sec;
  let r;
  try { r = await U.fetchRaw(TOKEN, { method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 15000 }); }
  catch (e) { throw new TrackerError('network', 'token: ' + e.message); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) {
    const code = r.status === 400 || r.status === 401 ? 'auth' : 'http';
    throw new TrackerError(code, 'token http ' + r.status + (j && j.error ? ' ' + j.error : ''));
  }
  SS.update({ malAccessToken: j.access_token, malRefreshToken: j.refresh_token || SS.get('malRefreshToken'), malTokenExpires: Date.now() + (+j.expires_in || 3600) * 1000 });
}

// Step 2: callback ?code&state
async function finishAuth(code, state) {
  const p = pendingAuth.get(state);
  if (!p) throw new TrackerError('state');
  pendingAuth.delete(state);
  await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: p.redirectUri });
  const me = await api('GET', '/users/@me');
  U.kvSet('trk.mal.user', me && me.name ? me.name : null);
  return me && me.name;
}

async function refresh() {
  const rt = SS.get('malRefreshToken');
  if (!rt) throw new TrackerError('not_linked');
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt });
}

async function api(method, path, form, retried) {
  if (!clientId()) throw new TrackerError('no_client_id');
  if (!SS.get('malRefreshToken')) throw new TrackerError('not_linked');
  if (!SS.get('malAccessToken') || +SS.get('malTokenExpires') - 5 * 60e3 < Date.now()) await refresh();
  let r;
  const opts = { method, timeout: 15000, headers: { authorization: 'Bearer ' + SS.get('malAccessToken') } };
  if (form) { opts.body = new URLSearchParams(form).toString(); opts.headers['content-type'] = 'application/x-www-form-urlencoded'; }
  try { r = await U.fetchRaw(API + path, opts); } catch (e) { throw new TrackerError('network', e.message); }
  if (r.status === 401 && !retried) { await refresh(); return api(method, path, form, true); }
  if (r.status === 401) throw new TrackerError('auth', 'api 401');
  if (r.status === 404) throw new TrackerError('unmapped', 'mal 404');
  if (!r.ok) throw new TrackerError('http', 'mal http ' + r.status);
  return r.json().catch(() => ({}));
}

const anime = id => api('GET', '/anime/' + id + '?fields=id,title,num_episodes,media_type,my_list_status');

// Decide the list update for "episode ep of anime malId finished today", plus an optional 1..10 score.
// Never lowers progress, never turns "completed" back to "watching", sets start/finish dates only when empty.
function planWatched(a, ep, score, today) {
  const cur = a.my_list_status || {};
  const total = +a.num_episodes || 0;
  const have = +cur.num_watched_episodes || 0;
  const patch = {};
  const watched = Math.max(have, ep);
  if (total && ep > total) throw new TrackerError('unmapped', 'episode ' + ep + ' > ' + total); // id mapping is off: do not guess
  if (watched !== have) patch.num_watched_episodes = watched;
  let status = cur.status;
  if (status !== 'completed') status = total && watched >= total ? 'completed' : 'watching';
  if (status !== cur.status) patch.status = status;
  if (!cur.start_date && (patch.num_watched_episodes || !cur.status || cur.status === 'plan_to_watch')) patch.start_date = today;
  if (status === 'completed' && cur.status !== 'completed' && !cur.finish_date) patch.finish_date = today;
  if (score != null && score !== (+cur.score || 0)) patch.score = score;
  return patch;
}
function planScore(a, score) {
  const cur = a.my_list_status || {};
  if (score == null || score === (+cur.score || 0)) return {};
  if (!cur.status) return {}; // not on the list: a rating alone does not add it (the watched sync does)
  return { score };
}
const update = (malId, patch) => api('PATCH', '/anime/' + malId + '/my_list_status', patch);

module.exports = { authUrl, finishAuth, refresh, api, anime, planWatched, planScore, update, linked, clientId, TrackerError };
