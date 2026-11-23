'use strict';
// Play pipeline: sid -> input url -> probe -> HLS session -> subs/skip/next. Also subtitle serving.
const path = require('node:path');
const U = require('../util');
const S = require('./stremio');
const M = require('./meta');
const ST = require('./streams');
const K = require('./skip');
const YT = require('./providers/ytdlp');
const P = require('./providers');
const SS = require('../subsync');
const crypto = require('node:crypto');
const ENGINE = process.env.SPP_ENGINE || 'http://127.0.0.1:11470';

let mediaMod = null;
function media() {
  if (mediaMod) return mediaMod;
  const p = process.env.SPP_MEDIA ? path.resolve(__dirname, '..', process.env.SPP_MEDIA) : path.join(__dirname, '..', 'media.js');
  try { mediaMod = require(p); } catch (e) { throw new U.HttpError(503, 'media module unavailable: ' + e.message.split('\n')[0], 'media_unavailable'); }
  return mediaMod;
}

const sessions = new Map(); // id -> info

// ---------- torrent engine ----------
const VIDEO_EXT = /\.(mkv|mp4|avi|webm|m4v|mov|ts|m2ts|wmv|flv)$/i;
function pickFile(files, season, episode) {
  const vids = files.map((f, i) => ({ i, name: f.path || f.name || '', len: f.length || 0 })).filter(f => VIDEO_EXT.test(f.name) && !/sample/i.test(f.name));
  if (!vids.length) return null;
  if (season != null && episode != null) {
    const pats = [
      new RegExp('s0*' + season + '[ ._-]*e0*' + episode + '(?!\\d)', 'i'),
      new RegExp('(?<![\\d])0*' + season + 'x0*' + episode + '(?!\\d)', 'i'),
      new RegExp('season[ ._-]*0*' + season + '.*(?:episode|ep|e)[ ._-]*0*' + episode + '(?!\\d)', 'i'),
      new RegExp('(?:^|[\\s._\\-\\[(])0*' + episode + '(?=[\\s._\\-\\])]|v\\d|\\.\\w{2,4}$)', 'i')
    ];
    for (const re of pats) {
      const m = vids.filter(v => re.test(v.name.split('/').pop()) || re.test(v.name));
      if (m.length) return m.sort((a, b) => b.len - a.len)[0].i;
    }
  }
  return vids.sort((a, b) => b.len - a.len)[0].i;
}
const deadTorrents = new Map(); // infoHash -> ts of 'no peers' failure (skip for 1 h)
async function engineCreate(rec) {
  const ih = rec.infoHash;
  const sources = ['dht:' + ih].concat((rec.trackers || []).map(t => 'tracker:' + t));
  const r = await U.fetchRaw(ENGINE + '/' + ih + '/create', { method: 'POST', json: { torrent: { infoHash: ih, peerSearch: { sources, min: 40, max: 150 } } }, timeout: 15000 });
  if (!r.ok) throw new U.HttpError(502, 'torrent engine http ' + r.status, 'engine');
  return r.json();
}
async function resolveInput(rec) {
  if (rec.kind === 'ocdub') {
    const OC = require('../oceancut');
    if (!OC.ready(rec.ocId)) {
      const st = OC.enqueue(rec.ocId, true);
      throw new U.HttpError(409, st.state === 'error' ? U.t('oc.dubError', st.msg)
        : U.t('oc.dubPending', Math.round((st.progress || 0) * 100)), 'oc_preparing');
    }
    OC.prefetchAfter(rec.ocId).catch(() => {});
    const oc = await OC.ocStream(rec.ocId);
    return { url: oc.url, headers: {}, audioUrl: OC.audioPath(rec.ocId) };
  }
  if (rec.kind === 'http') return { url: rec.url, headers: rec.headers || {} };
  if (rec.kind === 'site') {
    if (rec.url) return { url: rec.url, headers: rec.headers || {} };
    const url = await YT.resolve(rec.pageUrl, rec.headers);
    return { url, headers: rec.headers || {} };
  }
  if (rec.kind === 'torrent') {
    let idx = rec.fileIdx;
    let stats = null;
    if (Date.now() - (deadTorrents.get(rec.infoHash) || 0) < 3600e3) throw new U.HttpError(502, 'torrent had no peers recently', 'engine');
    try { stats = await engineCreate(rec); } catch (e) { deadTorrents.set(rec.infoHash, Date.now()); U.log('engine create failed:', e.message); throw new U.HttpError(502, 'no peers for this torrent', 'engine'); }
    if (idx == null) {
      idx = pickFile((stats && stats.files) || [], rec.season, rec.episode);
      if (idx == null) throw new U.HttpError(502, 'no video file found in torrent', 'no_file');
    }
    return { url: ENGINE + '/' + rec.infoHash + '/' + idx, headers: {} };
  }
  throw new U.HttpError(400, 'unknown stream kind');
}

// ---------- audio / subs ----------
const PT_LANG = /^(por|pt|pob|ptb|pt-?br|pt-?pt)$/i;
function pickAudio(audio, pref) {
  if (!audio.length) return null;
  if (pref === 'pt') {
    const a = audio.find(x => PT_LANG.test(x.lang || '') || /portug|dublad|\bpt-?br\b/i.test(x.title || ''));
    if (a) return a;
  } else if (pref) {
    const a = audio.find(x => (x.lang || '').toLowerCase().startsWith(String(pref).toLowerCase().slice(0, 2)) || new RegExp('^' + pref, 'i').test(x.lang || ''));
    if (a) return a;
  }
  return audio.find(x => x.default) || audio[0];
}
// Language names shown in audio/subtitle labels. Portuguese keeps what the owner's install always showed
// (only Portuguese is translated there); English translates the native names too.
const LANG_NAMES = {
  pt: { por: 'Português', pob: 'Português (BR)', pt: 'Português', eng: 'English', en: 'English', jpn: 'Japanese', spa: 'Español', ita: 'Italiano', fre: 'Français', fra: 'Français', ger: 'Deutsch', deu: 'Deutsch', rus: 'Русский', kor: 'Korean', chi: 'Chinese', zho: 'Chinese' },
  en: { por: 'Portuguese', pob: 'Portuguese (BR)', pt: 'Portuguese', eng: 'English', en: 'English', jpn: 'Japanese', spa: 'Spanish', ita: 'Italian', fre: 'French', fra: 'French', ger: 'German', deu: 'German', rus: 'Russian', kor: 'Korean', chi: 'Chinese', zho: 'Chinese' }
};
const langName = l => (LANG_NAMES[U.lang()] || LANG_NAMES.en)[String(l || '').toLowerCase()] || (l && l !== 'und' ? l : '?');
// Language-independent key of a label's first segment ('Português · AAC' and 'Portuguese · AAC' -> same key), so a
// remembered audio choice still matches after the UI language changes.
const NAME_TO_CODE = {};
for (const names of Object.values(LANG_NAMES)) for (const [code, name] of Object.entries(names)) if (!NAME_TO_CODE[name.toLowerCase()]) NAME_TO_CODE[name.toLowerCase()] = code;
const labelLang = l => { const f = String(l || '').split(' · ')[0].toLowerCase(); return NAME_TO_CODE[f] || f; };
const labelNorm = l => { const p = String(l || '').split(' · '); p[0] = labelLang(l); return p.join(' · ').toLowerCase(); };
function audioLabel(a) { return U.cap([a.lang && a.lang !== 'null' ? langName(a.lang) : '', a.title && a.title !== 'null' && a.title.toLowerCase() !== String(a.lang).toLowerCase() ? a.title : '', a.codec ? String(a.codec).toUpperCase() + (a.channels ? ' ' + a.channels + 'ch' : '') : ''].filter(Boolean).join(' · '), 60); }
function subLabel(s) {
  const lang = s.lang && s.lang !== 'null' ? langName(s.lang) : '';
  const title = s.title && s.title !== 'null' && s.title.toLowerCase() !== String(s.lang).toLowerCase() ? s.title : '';
  return U.cap([lang, title, s.forced ? U.t('sub.forced') : ''].filter(Boolean).join(' ') || U.t('sub.embedded', s.sIdx + 1), 60);
}

const osCache = new U.LRU(100, 30 * 60000);
async function externalSubs(type, videoId) {
  const k = type + '|' + videoId + '|' + U.lang();
  const c = osCache.get(k); if (c) return c;
  let out = [];
  try {
    const p = U.parseVideoId(videoId);
    if (!p.kitsu) {
      const addons = (await S.allAddons()).filter(a => S.isEnabled(a.id) && S.resourceFor(a, 'subtitles', type, videoId));
      const lists = await Promise.all(addons.map(a => S.addonGet(a, '/subtitles/' + type + '/' + encodeURIComponent(videoId).replace(/%3A/g, ':') + '.json', 6000).then(j => (j.subtitles || []).map(s => ({ url: s.url, lang: String(s.lang || '').toLowerCase(), addon: a.name }))).catch(() => [])));
      const all = lists.flat().filter(s => s.url && /^https?:/.test(s.url));
      const pick = (re, n) => all.filter(s => re.test(s.lang)).slice(0, n);
      const ptb = pick(/^(pob|pt-?br)$/, 3), pt = pick(/^(por|pt|pt-?pt)$/, 2), en = pick(/^(eng|en)$/, 4);
      const pref = U.getSettings().subLang;
      let n = {};
      const lab = (s, code) => { n[code] = (n[code] || 0) + 1; return { url: s.url, label: U.cap(langName(code) + ' #' + n[code] + ' (' + s.addon + ')', 60), lang: code }; };
      const mk = [...ptb.map(s => lab(s, 'pob')), ...pt.map(s => lab(s, 'por')), ...en.map(s => lab(s, 'eng'))];
      if (pref !== 'pt') mk.sort((a, b) => (b.lang === 'eng' ? 1 : 0) - (a.lang === 'eng' ? 1 : 0));
      out = mk.slice(0, 10);
    }
  } catch (e) { U.log('external subs failed:', e.message); }
  osCache.set(k, out);
  return out;
}

function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
function parseTime(t) {
  const m = String(t).trim().replace(',', '.').match(/^(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4]) : 0);
}
function parseSubs(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const mm = lines[ti].match(/^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!mm) continue;
    const s = parseTime(mm[1]), e = parseTime(mm[2]);
    if (s == null || e == null) continue;
    let t = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    if (t) cues.push([+s.toFixed(3), +e.toFixed(3), t]);
  }
  return cues.sort((a, b) => a[0] - b[0]);
}
async function loadExtCues(sess, n) {
  const ext = sess.ext[n]; if (!ext) throw new U.HttpError(404, 'unknown subtitle', 'not_found');
  if (ext.cues) return ext.cues;
  const r = await U.fetchRaw(ext.url, { timeout: 10000 });
  if (!r.ok) throw new U.HttpError(502, 'subtitle fetch http ' + r.status, 'upstream');
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 3e6) throw new U.HttpError(502, 'subtitle too large');
  ext.cues = parseSubs(decodeText(buf));
  return ext.cues;
}
// ---------- automatic subtitle sync (runs in the background while the video plays) ----------
const AUDIO_BIAS = 0.1; // subtitle cues start ~0.1 s before the voice energy rises (measured on a BD release, 23/11)
function syncKey(sess, subId) {
  const [k, i] = subId.split(':');
  const sk = k === 'ext' ? ((sess.ext[+i] || {}).url || subId) : subId;
  return 'subsync:' + crypto.createHash('sha1').update(sess.srcKey + '|' + sk).digest('hex').slice(0, 24);
}
function loadSync(sess, subId) {
  if (sess.sync[subId]) return sess.sync[subId];
  try { const row = U.db.prepare('SELECT v FROM kv WHERE k = ?').get(syncKey(sess, subId)); if (row) sess.sync[subId] = JSON.parse(row.v); } catch (e) { /* none */ }
  return sess.sync[subId] || null;
}
function publicSync(st) {
  return { state: st.state, offset: st.offset || 0, ratio: st.ratio || 1, method: st.method || null, z: st.z || null, msg: st.msg || null };
}
async function runSync(sess, subId, pos) {
  const [kind, id] = subId.split(':');
  const cues = kind === 'ext' ? await loadExtCues(sess, +id) : await media().getSubtitleCues(sess.id, +id, 0, 1e9);
  if (!cues || cues.length < 10) return { state: 'failed', msg: U.t('sync.fewcues') };
  // Two references race; the first confident answer wins:
  //  1) another embedded text track (exact timing) — only exists for what was already transcoded, so poll it;
  //  2) speech energy of the audio being played, a few minutes from the playhead (the transcoder is fetching it anyway).
  let audioRes = null;
  const audioP = playedAudio(sess, pos, 120, 'speech').then(ref => {
    const r = SS.alignCues(cues, ref);
    if (!r) return (audioRes = { state: 'failed', msg: U.t('sync.fewspeech') });
    if (!r.confident) return (audioRes = { state: 'unsure', offset: 0, ratio: 1, z: r.z, msg: U.t('sync.unsure', r.offset), method: 'audio' });
    return (audioRes = { state: 'done', offset: +(r.offset - (r.ratio === 1 ? AUDIO_BIAS : 0)).toFixed(2), ratio: r.ratio, z: r.z, method: 'audio' });
  }, e => (audioRes = { state: 'failed', msg: U.cap(e.message, 80) }));
  if (kind === 'ext' && sess.embIdx.length) {
    const deadline = Date.now() + 150000;
    while (!audioRes && Date.now() < deadline && sessions.has(sess.id)) {
      for (const e of sess.embIdx) {
        const rc = (await media().getSubtitleCues(sess.id, e, Math.max(0, pos - 900), pos + 900)) || [];
        if (rc.length < 25) continue;
        const t0 = rc[0][0] - 5, dur = Math.min(1500, rc[rc.length - 1][1] - t0 + 5);
        const r = SS.alignCues(cues, SS.cueSignal(rc, t0, dur));
        if (r && r.confident) return { state: 'done', offset: r.offset, ratio: r.ratio, z: r.z, method: 'embedded subtitle' };
      }
      await new Promise(res => setTimeout(res, 8000));
    }
  }
  return audioP;
}
// Audio around the playhead that the transcoder already produced (waits while playback advances).
async function playedAudio(sess, pos, minSec, kind) {
  const t0 = Date.now();
  for (;;) {
    if (!sessions.has(sess.id)) throw new Error(U.t('sync.ended'));
    const at = pos + (Date.now() - t0) / 1000;
    const win = media().segmentRun(sess.id, at - 300, at + 300);
    if (win && win.dur >= minSec) {
      const w = win.dur > 300 ? { t0: win.t0, dur: 300, files: win.files.slice(0, 300 / media().SEG) } : win;
      return kind === 'speech' ? SS.speechFromSegments(w) : SS.envelopeFromSegments(w);
    }
    if (Date.now() - t0 > 240000) throw new Error(U.t('sync.noaudio'));
    await new Promise(res => setTimeout(res, 5000));
  }
}
function startSync(b) {
  const sess = sessions.get(String(b && b.session)); if (!sess) throw new U.HttpError(404, 'unknown session', 'not_found');
  const subId = String(b.subId || '');
  if (!/^(ext|emb):\d+$/.test(subId)) throw new U.HttpError(400, 'bad subtitle id');
  const cur = loadSync(sess, subId);
  if (cur && (cur.state === 'running' || (!b.force && cur.state === 'done'))) return publicSync(cur);
  const st = sess.sync[subId] = { state: 'running', startedAt: Date.now() };
  const t0 = Date.now();
  runSync(sess, subId, Math.max(0, +b.pos || 0)).then(r => {
    Object.assign(st, r, { at: Date.now() });
    if (r.state === 'done') { try { U.db.prepare('INSERT OR REPLACE INTO kv(k, v) VALUES(?, ?)').run(syncKey(sess, subId), JSON.stringify(r)); } catch (e) { /* ignore */ } }
    U.log('subsync', sess.id, subId, r.state, r.offset != null ? r.offset + 's' : '', r.ratio && r.ratio !== 1 ? 'ratio ' + r.ratio.toFixed(4) : '', r.method || '', r.msg || '', (Date.now() - t0) + 'ms');
  }).catch(e => { Object.assign(st, { state: 'failed', msg: U.cap(e.message, 80) }); U.log('subsync failed', subId, e.message); });
  return publicSync(st);
}
function syncStatus(q) {
  const sess = sessions.get(String(q.session)); if (!sess) throw new U.HttpError(404, 'unknown session', 'not_found');
  const st = loadSync(sess, String(q.subId));
  return st ? publicSync(st) : { state: 'none' };
}
function syncReset(b) {
  const sess = sessions.get(String(b && b.session)); if (!sess) throw new U.HttpError(404, 'unknown session', 'not_found');
  const subId = String(b.subId);
  sess.sync[subId] = { state: 'off', offset: 0, ratio: 1 };
  try { U.db.prepare('DELETE FROM kv WHERE k = ?').run(syncKey(sess, subId)); } catch (e) { /* ignore */ }
  return publicSync(sess.sync[subId]);
}

// ---------- dubbed audio from another source (opt-in, experimental) ----------
const PT_AUDIO = a => PT_LANG.test(a.lang || '') || /portug|dublad|\bpt-?br\b/i.test(a.title || '');
async function runXdub(sess, pos) {
  const type = sess.type, cands = [];
  const r = await ST.getStreams(type, sess.videoId);
  for (const x of r.streams) {
    const rec = ST.getSid(x.sid); if (!rec || !(x.lang || []).some(l => /^(pt|pt-BR|dual)$/.test(l))) continue;
    if (rec.kind !== 'torrent' && rec.kind !== 'http') continue;
    if (rec.infoHash && sess.srcKey.indexOf(rec.infoHash) >= 0) continue;
    cands.push(rec); if (cands.length >= 4) break;
  }
  if (!cands.length) return { state: 'notfound', msg: U.t('xdub.nosource') };
  const A = await playedAudio(sess, pos, 120, 'env');
  for (const rec of cands) {
    try {
      const input = await resolveInput(rec);
      const pr = await media().probe(input.url, { headers: input.headers });
      const a = (pr.audio || []).find(PT_AUDIO); if (!a) continue;
      const B = await SS.envelopeSignal(input.url, input.headers, a.aIdx, Math.max(0, A.t0 - 45), A.sig.length * SS.BIN + 90);
      const al = SS.alignSignals(A, B, { maxOffset: 90 });
      U.log('xdub candidate', U.cap(rec.title || '', 50), al ? al.offset + 's z ' + al.z + ' m ' + al.margin + (al.confident ? ' ok' : ' unsure') : 'none');
      if (al && al.confident) return { state: 'ready', url: input.url, headers: input.headers, aIdx: a.aIdx, offset: al.offset, ratio: al.ratio, title: rec.title, z: al.z };
    } catch (e) { U.log('xdub candidate failed:', e.message); }
  }
  return { state: 'notfound', msg: U.t('xdub.nomatch') };
}
function startXdub(b) {
  const sess = sessions.get(String(b && b.session)); if (!sess) throw new U.HttpError(404, 'unknown session', 'not_found');
  const key = sess.videoId;
  const cur = xdubCache.get(key);
  if (cur && (cur.state === 'running' || cur.state === 'ready')) return xdubPublic(cur);
  const st = { state: 'running' }; xdubCache.set(key, st);
  runXdub(sess, Math.max(0, +b.pos || 0)).then(r => Object.assign(st, r)).catch(e => Object.assign(st, { state: 'failed', msg: U.cap(e.message, 80) }));
  return xdubPublic(st);
}
const xdubCache = new U.LRU(50, 6 * 3600e3);
function xdubPublic(st) { return { state: st.state, msg: st.msg || null, title: st.title || null, offset: st.offset, ratio: st.ratio }; }
function xdubStatus(q) {
  const sess = sessions.get(String(q.session)); if (!sess) throw new U.HttpError(404, 'unknown session', 'not_found');
  const st = xdubCache.get(sess.videoId); return st ? xdubPublic(st) : { state: 'none' };
}

async function getSubs(sessionId, subId, from, to, raw) {
  const sess = sessions.get(sessionId); if (!sess) throw new U.HttpError(404, 'unknown session', 'not_found');
  from = isFinite(+from) ? +from : 0; to = isFinite(+to) && +to > 0 ? +to : from + 60;
  const [kind, id] = String(subId).split(':');
  // automatic alignment (video_t = ratio * sub_t + offset), unless the client asks for the raw timing
  const st = raw ? null : loadSync(sess, String(subId));
  const al = st && st.state === 'done' && (st.offset || st.ratio !== 1) ? st : null;
  const map = c => al ? [+(al.ratio * c[0] + al.offset).toFixed(3), +(al.ratio * c[1] + al.offset).toFixed(3), c[2]] : c;
  const xf = al ? (from - al.offset) / al.ratio : from, xt = al ? (to - al.offset) / al.ratio : to;
  let cues;
  if (kind === 'ext') {
    const all = await loadExtCues(sess, +id);
    cues = all.filter(c => c[1] >= xf && c[0] <= xt).slice(0, 400).map(map);
    return { cues, complete: true, sync: st ? publicSync(st) : null };
  }
  if (kind === 'emb') {
    cues = await media().getSubtitleCues(sessionId, +id, xf, xt);
    return { cues: (cues || []).slice(0, 400).map(map), complete: to >= (sess.duration || 0), sync: st ? publicSync(st) : null };
  }
  throw new U.HttpError(400, 'bad subtitle id');
}

// ---------- play ----------
async function play(b) {
  const m = media();
  if (!b || !b.videoId) throw new U.HttpError(400, 'videoId required');
  const videoId = String(b.videoId);
  const pv = U.parseVideoId(videoId);
  let rec = b.sid && b.sid !== 'auto' ? ST.getSid(b.sid) : null;
  let sidUsed = b.sid;
  if (!rec) {
    if (b.sid && b.sid !== 'auto') throw new U.HttpError(410, U.t('err.sid_expired'), 'sid_expired');
    const type = b.type === 'movie' || (b.itemId && !pv.season && !pv.kitsu && videoId === b.itemId && b.type !== 'series') ? 'movie' : 'series';
    const r = await ST.getStreams(type, videoId);
    if (!r.streams.length) throw new U.HttpError(404, U.t('err.no_streams'), 'no_streams');
    sidUsed = r.streams[0].sid; rec = ST.getSid(sidUsed);
  }
  const xd = b.xdub ? xdubCache.get(videoId) : null;
  if (b.prevSession) await destroySession(b.prevSession);
  const type = rec.type || (pv.season != null ? 'series' : 'movie');
  const subsP = externalSubs(type, videoId);
  const metaP = M.fetchMeta(type, pv.base).catch(() => null);
  // Open the chosen source; if it has no peers / cannot be read, fall back to the next ranked
  // sources for the same video (different torrent), within a ~45 s budget.
  let input, probe, lastErr = null;
  const tried = new Set(), t0 = Date.now();
  let alts = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      if (Date.now() - t0 > 60000) break;
      if (!alts) { try { alts = (await ST.getStreams(type, videoId)).streams; } catch (e) { alts = []; } }
      const next = alts.find(x => { const r2 = ST.getSid(x.sid); return r2 && !tried.has(r2.infoHash || r2.url || r2.pageUrl); });
      if (!next) break;
      sidUsed = next.sid; rec = ST.getSid(sidUsed);
      U.log('fallback to next source:', U.cap(next.title || '', 60));
    }
    tried.add(rec.infoHash || rec.url || rec.pageUrl);
    try {
      input = await resolveInput(rec);
      probe = await m.probe(input.url, { headers: input.headers });
      lastErr = null; break;
    } catch (e) { if (e.code === 'oc_preparing') throw e; lastErr = e; U.log('source failed:', e.message); }
  }
  if (lastErr || !probe) throw new U.HttpError(502, U.t('err.probe_failed'), 'probe_failed');
  const settings = U.getSettings();
  const audioList = probe.audio || [];
  let chosen = null;
  if (b.audioIdx != null && audioList.find(a => a.aIdx === +b.audioIdx)) chosen = audioList.find(a => a.aIdx === +b.audioIdx);
  else if (b.audioPref) {
    // per-series memory from the app: same label, else same language
    // (compared language-independently: the remembered label may come from the other UI language)
    chosen = audioList.find(a => audioLabel(a) === b.audioPref) || audioList.find(a => labelNorm(audioLabel(a)) === labelNorm(b.audioPref))
      || audioList.find(a => labelLang(audioLabel(a)) === labelLang(b.audioPref)) || pickAudio(audioList, settings.audioLang);
  }
  else chosen = pickAudio(audioList, settings.audioLang);
  const startSec = Math.max(0, +b.startSec || 0);
  let s;
  const useX = xd && xd.state === 'ready' && !input.audioUrl;
  const sopts = { url: input.url, headers: input.headers, probe, audioIdx: chosen ? chosen.aIdx : 0, startSec, lowBandwidth: !!b.viaRelay, audioUrl: input.audioUrl,
    saver: b.saver === true, codecs: Array.isArray(b.codecs) ? b.codecs.slice(0, 8) : [] }; // saver: low-bitrate fMP4 variant for phones/laptops
  if (useX) Object.assign(sopts, { audioUrl: xd.url, audioIdxExt: xd.aIdx, audioOffset: xd.offset, audioRatio: xd.ratio });
  try { s = await m.createSession(sopts); }
  catch (e) { U.log('createSession failed:', e.message); throw new U.HttpError(502, U.t('err.session_failed'), 'session_failed'); }
  const ext = await subsP;
  const emb = (probe.subs || []).filter(x => x.text);
  const subs = emb.map(x => ({ id: 'emb:' + x.sIdx, label: subLabel(x), source: 'embedded' })).concat(ext.map((x, i) => ({ id: 'ext:' + i, label: x.label, source: 'opensubtitles' })));
  const meta = await metaP;
  sessions.set(s.id, { id: s.id, duration: s.duration, ext: ext.map(x => ({ url: x.url })), itemId: b.itemId || pv.base, videoId, created: Date.now(), title: rec.title,
    type, url: input.url, headers: input.headers || {}, audioIdx: chosen ? chosen.aIdx : 0, srcKey: input.url.replace(/^https?:\/\/127\.0\.0\.1:\d+\//, ''),
    embIdx: emb.map(x => x.sIdx), sync: {}, xdub: !!useX, sopts });
  if (useX) U.log('xdub on: audio from', U.cap(xd.title || '', 50), 'offset', xd.offset, 'ratio', xd.ratio);
  let next = null;
  if (meta && meta.type === 'series') { const n = M.nextVideo(meta, videoId); if (n) { const p = U.parseVideoId(n.id); next = { videoId: n.id, label: U.label(p.season, p.episode, p.kitsu) }; } }
  const skip = await K.lookup({ videoId, type, duration: s.duration, chapters: probe.chapters });
  U.log('play ok session', s.id, 'dur', Math.round(s.duration), 'audio', chosen ? chosen.aIdx : '-', 'subs', subs.length, 'skip', skip.length);
  return {
    session: s.id, playlist: '/hls/' + s.id + '/index.m3u8', duration: s.duration, sid: sidUsed,
    audio: input.audioUrl ? [{ aIdx: 0, label: U.t('audio.dubbed') }]
      : (useX ? [{ aIdx: -1, label: U.t('audio.xdub') }] : []).concat(audioList.map(a => ({ aIdx: a.aIdx, label: audioLabel(a) }))),
    audioIdx: input.audioUrl ? 0 : useX ? -1 : (chosen ? chosen.aIdx : 0), subs, skip, next,
    xdub: useX ? { title: xd.title } : null, hasPtAudio: !!input.audioUrl || audioList.some(PT_AUDIO)
  };
}
async function destroySession(id) {
  sessions.delete(id);
  try { if (mediaMod || process.env.SPP_MEDIA !== undefined || true) await media().destroySession(id); } catch (e) { /* already gone */ }
}
function listSessions() {
  let live = []; try { live = media().listSessions ? media().listSessions() : []; } catch (e) { /* ignore */ }
  const liveIds = new Set((live || []).map(x => x.id));
  for (const id of [...sessions.keys()]) if (live && live.length !== undefined && mediaMod && !liveIds.has(id)) sessions.delete(id);
  return [...sessions.values()].map(s => ({ id: s.id, title: s.title, videoId: s.videoId, ageSec: Math.round((Date.now() - s.created) / 1000), duration: Math.round(s.duration || 0) }));
}
function getSession(id) { return sessions.get(String(id)) || null; }
module.exports = { getSession, audioLabel, subLabel, langName, labelNorm, startSync, syncStatus, syncReset, startXdub, xdubStatus, play, getSubs, destroySession, listSessions, media, parseSubs, pickFile, pickAudio };
