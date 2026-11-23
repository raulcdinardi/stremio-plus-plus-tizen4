'use strict';
// Stremio account access: addon collection (read), library (read, guarded write), local extra addons & source overrides.
const U = require('./../util');
const API = 'https://api.strem.io/api/';
const authKey = () => U.secrets.stremioAuthKey;

async function apiPost(name, body) {
  if (!authKey()) throw new U.HttpError(503, 'no stremio auth key', 'no_auth');
  const j = await U.fetchJson(API + name, { method: 'POST', json: Object.assign({ authKey: authKey() }, body), timeout: 12000 });
  if (j.error) throw new U.HttpError(502, 'stremio api: ' + (j.error.message || 'error'), 'upstream');
  return j.result;
}

let addonCache = null, addonTs = 0;
async function accountAddons() {
  if (addonCache && Date.now() - addonTs < 10 * 60 * 1000) return addonCache;
  try {
    const r = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', update: true });
    addonCache = (r.addons || []).map(a => ({
      id: a.manifest.id, name: a.manifest.name, base: a.transportUrl.replace(/\/manifest\.json(\?.*)?$/, ''), manifest: slimManifest(a.manifest), origin: 'account'
    }));
    addonTs = Date.now();
  } catch (e) { U.log('addon collection failed:', e.message); if (!addonCache) addonCache = []; }
  return addonCache;
}
function slimManifest(m) {
  return { id: m.id, name: m.name, version: m.version, resources: m.resources || [], types: m.types || [], idPrefixes: m.idPrefixes || null,
    catalogs: (m.catalogs || []).map(c => ({ id: c.id, type: c.type, extra: (c.extra || []).map(e => ({ name: e.name, isRequired: e.isRequired })) })) };
}
// Local extra addons (stored locally, never touching the account)
function extraAddons() { return U.kvGet('extraAddons', []).map(a => Object.assign({ origin: 'extra' }, a)); }
async function addExtraAddon(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new U.HttpError(400, 'url must be http(s)');
  const mu = /\/manifest\.json(\?.*)?$/.test(url) ? url : url.replace(/\/+$/, '') + '/manifest.json';
  const m = await U.fetchJson(mu, { timeout: 10000 });
  if (!m || !m.id || !m.resources) throw new U.HttpError(400, 'not a stremio manifest');
  const list = U.kvGet('extraAddons', []).filter(a => a.id !== m.id);
  list.push({ id: m.id, name: m.name, base: mu.replace(/\/manifest\.json(\?.*)?$/, ''), manifest: slimManifest(m) });
  U.kvSet('extraAddons', list);
  return { id: m.id, name: m.name };
}
function removeExtraAddon(id) { U.kvSet('extraAddons', U.kvGet('extraAddons', []).filter(a => a.id !== id)); }

function overrides() { return U.kvGet('sourceOverrides', {}); }
function setSourceEnabled(id, enabled) { const o = overrides(); o[id] = !!enabled; U.kvSet('sourceOverrides', o); }
const DEFAULT_OFF = new Set(['org.stremio.local']);
function isEnabled(id) { const o = overrides(); return id in o ? o[id] : !DEFAULT_OFF.has(id); }

async function allAddons() {
  const acc = await accountAddons();
  const seen = new Set(acc.map(a => a.id));
  return acc.concat(extraAddons().filter(a => !seen.has(a.id)));
}
// Resource spec of an addon for (resource, type, id) or null
function resourceFor(addon, resource, type, id) {
  const m = addon.manifest;
  for (const r of m.resources) {
    const name = typeof r === 'string' ? r : r.name;
    if (name !== resource) continue;
    const types = (typeof r === 'object' && r.types) || m.types || [];
    const prefixes = (typeof r === 'object' && r.idPrefixes) || m.idPrefixes || null;
    if (types.length && !types.includes(type)) continue;
    if (prefixes && !prefixes.some(p => String(id).startsWith(p))) continue;
    return true;
  }
  return null;
}
function kitsuAddon(addons) { return addons.find(a => /kitsu/i.test(a.id)); }
async function addonGet(addon, path, timeout) {
  return U.fetchJson(addon.base + path, { timeout: timeout || 8000 });
}

// ---- library ----
let libCache = null, libTs = 0;
async function library(force) {
  if (!force && libCache && Date.now() - libTs < 60000) return libCache;
  try {
    const r = await apiPost('datastoreGet', { collection: 'libraryItem', ids: [], all: true });
    const m = new Map(); for (const i of r) m.set(i._id, i);
    libCache = m; libTs = Date.now();
  } catch (e) { U.log('library get failed:', e.message); if (!libCache) libCache = new Map(); }
  return libCache;
}
async function libraryItem(id) {
  try { const r = await apiPost('datastoreGet', { collection: 'libraryItem', ids: [id], all: false }); return r && r[0] || null; }
  catch (e) { return (libCache && libCache.get(id)) || null; }
}
const dryRun = { last: null, count: 0 };
// Write one library item. Returns {written:boolean,dry:boolean}
async function putLibraryItem(item) {
  if (!U.getSettings().libraryWrite) {
    dryRun.last = item; dryRun.count++;
    U.log('library dry-run (write disabled):', item._id);
    if (libCache) libCache.set(item._id, item);
    return { written: false, dry: true };
  }
  await apiPost('datastorePut', { collection: 'libraryItem', changes: [item] });
  if (libCache) libCache.set(item._id, item);
  return { written: true, dry: false };
}

module.exports = { accountAddons, allAddons, extraAddons, addExtraAddon, removeExtraAddon, overrides, setSourceEnabled, isEnabled, resourceFor, kitsuAddon, addonGet,
  library, libraryItem, putLibraryItem, dryRun };
