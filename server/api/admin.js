'use strict';
// Sources/settings endpoints and the /admin HTML page.
const U = require('../util');
const S = require('./stremio');
const P = require('./providers');
const PL = require('./play');
const YT = require('./providers/ytdlp');

async function sources() {
  const out = [];
  for (const a of await S.allAddons()) {
    const hasStream = a.manifest.resources.some(r => (typeof r === 'string' ? r : r.name) === 'stream');
    if (!hasStream) continue;
    let host = ''; try { host = new URL(a.base).host; } catch (e) { /* ignore */ }
    out.push({ id: a.id, name: a.name, enabled: S.isEnabled(a.id), kind: 'addon', origin: a.origin, host });
  }
  for (const p of P.list()) {
    const o = S.overrides()['provider:' + p.id];
    out.push({ id: 'provider:' + p.id, name: p.name, enabled: o !== undefined ? o : p.defaultEnabled !== false, kind: 'site', origin: 'local', host: '' });
  }
  return out;
}
async function getSettings() {
  const s = U.getSettings();
  return { audioLang: s.audioLang, subLang: s.subLang, autoSkip: s.autoSkip, uiLang: U.normLang(s.uiLang) || U.DEFAULT_LANG, kbMode: s.kbMode, ratingInput: s.ratingInput, ratePrompt: s.ratePrompt, sources: (await sources()).map(x => ({ id: x.id, name: x.name, enabled: x.enabled, kind: x.kind })) };
}
async function postSettings(b) {
  b = b || {};
  const patch = {};
  if (b.audioLang !== undefined) patch.audioLang = String(b.audioLang).slice(0, 8);
  if (b.subLang !== undefined) patch.subLang = String(b.subLang).slice(0, 8);
  if (b.autoSkip !== undefined) patch.autoSkip = !!b.autoSkip;
  if (b.uiLang !== undefined && U.normLang(b.uiLang)) patch.uiLang = U.normLang(b.uiLang);
  if (b.libraryWrite !== undefined) patch.libraryWrite = !!b.libraryWrite;
  if (b.kbMode === 'grid' || b.kbMode === 'phone') patch.kbMode = b.kbMode;
  if (b.ratingInput === 'dpad' || b.ratingInput === 'digits') patch.ratingInput = b.ratingInput;
  if (b.ratePrompt !== undefined) patch.ratePrompt = !!b.ratePrompt;
  if (b.partyPublicBase !== undefined) patch.partyPublicBase = /^https?:\/\/[^\s]*$/.test(String(b.partyPublicBase)) ? String(b.partyPublicBase).replace(/\/+$/, '').slice(0, 200) : '';
  if (b.partyName !== undefined) patch.partyName = String(b.partyName).slice(0, 24);
  U.setSettings(patch);
  if (Array.isArray(b.sources)) for (const s of b.sources) if (s && s.id) S.setSourceEnabled(s.id, !!s.enabled);
  return getSettings();
}
async function adminState() {
  const s = U.getSettings();
  return {
    settings: { audioLang: s.audioLang, subLang: s.subLang, autoSkip: s.autoSkip, libraryWrite: s.libraryWrite, uiLang: U.normLang(s.uiLang) || U.DEFAULT_LANG },
    sources: await sources(),
    extra: S.extraAddons().map(a => ({ id: a.id, name: a.name })),
    sessions: PL.listSessions(),
    ytdlp: { available: await YT.available(), bin: YT.bin() },
    libraryDryRunWrites: S.dryRun.count
  };
}

// /admin page strings. Portuguese keeps the wording (without accents) the page always had.
const ADMIN_STR = {
  en: {
    htmlLang: 'en', sources: 'Sources', urlPh: 'Stremio add-on manifest URL (https://.../manifest.json)', add: 'Add',
    note: 'Extra sources are stored only on this server; your Stremio account is never changed.', prefs: 'Preferences',
    audio: 'Audio', pt: 'Portuguese', en: 'English', ja: 'Japanese', fileDefault: 'File default', sub: 'Subtitles', off: 'Off',
    skip: 'Auto skip', sync: 'Stremio sync', uiLang: 'Language', sessions: 'Active sessions', system: 'System',
    err: 'error: ', saved: 'saved', added: 'added', on: 'On', offBtn: 'Off', enabled: 'Enabled', disabled: 'Disabled', remove: 'Remove', kill: 'Stop',
    none: 'none', missing: 'missing', ok: 'ok', simWrites: 'simulated library writes: '
  },
  pt: {
    htmlLang: 'pt-BR', sources: 'Fontes', urlPh: 'URL do manifest de addon Stremio (https://.../manifest.json)', add: 'Adicionar',
    note: 'Fontes extras ficam guardadas so neste servidor; a conta Stremio nunca e alterada.', prefs: 'Preferencias',
    audio: 'Audio', pt: 'Portugues', en: 'English', ja: 'Japones', fileDefault: 'Padrao do arquivo', sub: 'Legenda', off: 'Desligada',
    skip: 'Pular auto', sync: 'Sync Stremio', uiLang: 'Idioma', sessions: 'Sessoes ativas', system: 'Sistema',
    err: 'erro: ', saved: 'salvo', added: 'adicionado', on: 'Ligado', offBtn: 'Desligado', enabled: 'Ativa', disabled: 'Desativada', remove: 'Remover', kill: 'Encerrar',
    none: 'nenhuma', missing: 'ausente', ok: 'ok', simWrites: 'escritas simuladas na biblioteca: '
  }
};
function page(lang) {
  const L = ADMIN_STR[lang || U.lang()] || ADMIN_STR[U.DEFAULT_LANG];
  const e = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="${L.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stremio++ admin</title><style>
body{margin:0;font:16px system-ui,sans-serif;background:#0e0f13;color:#f2f2f5;padding:12px;max-width:760px;margin:auto}
h1{font-size:22px;color:#e5a00d}h2{font-size:17px;margin:22px 0 8px;color:#a0a3ad}
.card{background:#1a1c23;border-radius:8px;padding:10px 12px;margin:6px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.card .n{flex:1;min-width:160px}.card small{color:#a0a3ad;display:block}
button,select,input{font:inherit;background:#2a2d38;color:#f2f2f5;border:1px solid #3a3e4c;border-radius:6px;padding:7px 10px}
button{cursor:pointer}button.on{background:#e5a00d;color:#000;border-color:#e5a00d}input[type=text]{width:100%;box-sizing:border-box}
.row{display:flex;gap:8px;margin:6px 0;align-items:center;flex-wrap:wrap}.row label{min-width:110px;color:#a0a3ad}
#msg{position:fixed;bottom:10px;left:10px;right:10px;background:#e5a00d;color:#000;padding:8px;border-radius:6px;display:none}
</style></head><body><h1>Stremio++</h1>
<h2>${e(L.sources)}</h2><div id="src"></div>
<div class="row"><input type="text" id="url" placeholder="${e(L.urlPh)}"><button onclick="addAddon()">${e(L.add)}</button></div>
<small style="color:#a0a3ad">${e(L.note)}</small>
<h2>${e(L.prefs)}</h2>
<div class="row"><label>${e(L.audio)}</label><select id="audioLang"><option value="pt">${e(L.pt)}</option><option value="en">${e(L.en)}</option><option value="ja">${e(L.ja)}</option><option value="">${e(L.fileDefault)}</option></select></div>
<div class="row"><label>${e(L.sub)}</label><select id="subLang"><option value="pt">${e(L.pt)}</option><option value="en">${e(L.en)}</option><option value="off">${e(L.off)}</option></select></div>
<div class="row"><label>${e(L.skip)}</label><button id="autoSkip" onclick="tog('autoSkip')"></button></div>
<div class="row"><label>${e(L.sync)}</label><button id="libraryWrite" onclick="tog('libraryWrite')"></button></div>
<div class="row"><label>${e(L.uiLang)}</label><select id="uiLang"><option value="en">English</option><option value="pt">Português</option></select></div>
<h2>${e(L.sessions)}</h2><div id="ses"></div>
<h2>${e(L.system)}</h2><div id="sys" style="color:#a0a3ad"></div><div id="msg"></div>
<script>
var L=${JSON.stringify(L).replace(/</g, '\\u003c')};
var st=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function msg(t){var m=document.getElementById('msg');m.textContent=t;m.style.display='block';setTimeout(function(){m.style.display='none'},2500)}
function api(m,p,b){return fetch(p,{method:m,headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(function(r){return r.json()})}
function load(){api('GET','/api/admin/state').then(function(s){st=s;render()}).catch(function(e){msg(L.err+e)})}
function render(){
 var h='';st.sources.forEach(function(s,i){h+='<div class="card"><div class="n">'+esc(s.name)+'<small>'+esc(s.kind)+' &middot; '+esc(s.origin)+(s.host?' &middot; '+esc(s.host):'')+'</small></div>'
  +'<button class="'+(s.enabled?'on':'')+'" onclick="toggleSrc('+i+')">'+(s.enabled?L.enabled:L.disabled)+'</button>'
  +(s.origin==='extra'?'<button onclick="delAddon('+i+')">'+L.remove+'</button>':'')+'</div>'});
 document.getElementById('src').innerHTML=h;
 ['audioLang','subLang','uiLang'].forEach(function(k){var e=document.getElementById(k);e.value=st.settings[k];e.onchange=function(){var b={};b[k]=e.value;api('POST','/api/settings',b).then(function(){msg(L.saved);if(k==='uiLang')location.reload()})}});
 ['autoSkip','libraryWrite'].forEach(function(k){var e=document.getElementById(k);e.className=st.settings[k]?'on':'';e.textContent=st.settings[k]?L.on:L.offBtn});
 h='';st.sessions.forEach(function(s,i){h+='<div class="card"><div class="n">'+esc(s.title||s.videoId)+'<small>'+esc(s.videoId)+' &middot; '+s.ageSec+'s &middot; '+s.duration+'s</small></div><button onclick="killSes('+i+')">'+L.kill+'</button></div>'});
 document.getElementById('ses').innerHTML=h||'<small style="color:#a0a3ad">'+L.none+'</small>';
 document.getElementById('sys').textContent='yt-dlp: '+(st.ytdlp.available?L.ok:L.missing)+' | '+L.simWrites+st.libraryDryRunWrites;
}
function toggleSrc(i){var s=st.sources[i];api('POST','/api/settings',{sources:[{id:s.id,enabled:!s.enabled}]}).then(load)}
function tog(k){var b={};b[k]=!st.settings[k];api('POST','/api/settings',b).then(load)}
function addAddon(){var u=document.getElementById('url').value;api('POST','/api/admin/addon',{url:u}).then(function(r){msg(r.error?(L.err+r.error):L.added);document.getElementById('url').value='';load()})}
function delAddon(i){api('DELETE','/api/admin/addon?id='+encodeURIComponent(st.sources[i].id)).then(load)}
function killSes(i){api('DELETE','/api/session/'+encodeURIComponent(st.sessions[i].id)).then(load)}
load();setInterval(load,15000);
</script></body></html>`;
}
module.exports = { page, getSettings, postSettings, adminState, sources };
