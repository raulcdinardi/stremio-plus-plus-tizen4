'use strict';
// i18n: server strings by uiLang / ?lang=, language-independent label matching, and the app dictionary (app/app.js).
// Run: node --test test/i18n.test.js   (uses a temp state dir; no network)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-i18n-'));
process.env.SPP_STATE = STATE;
process.env.SPP_SECRETS = path.join(STATE, 'no-secrets.json');
const U = require('../util');
const PL = require('../api/play');

test('default language is English; uiLang and ?lang= change it', () => {
  assert.strictEqual(U.lang(), 'en');
  assert.strictEqual(U.t('home.continue'), 'Continue watching');
  U.setSettings({ uiLang: 'pt' });
  assert.strictEqual(U.lang(), 'pt');
  assert.strictEqual(U.t('home.continue'), 'Continuar assistindo');
  U.withLang('en', () => assert.strictEqual(U.t('home.continue'), 'Continue watching')); // per-request override wins
  U.withLang('zz', () => assert.strictEqual(U.lang(), 'pt')); // unknown language is ignored
  U.setSettings({ uiLang: 'en' });
  assert.strictEqual(U.lang(), 'en');
});

test('episode labels and short dates follow the language', () => {
  U.withLang('en', () => { assert.strictEqual(U.label(2, 5, false), 'S2 E5'); assert.strictEqual(U.label(2, 5, true), 'E5'); assert.match(U.shortDate(Date.UTC(2026, 10, 23, 12)), /^Nov 2[23]$/); });
  U.withLang('pt', () => { assert.strictEqual(U.label(2, 5, false), 'T2 E5'); assert.match(U.shortDate(Date.UTC(2026, 10, 23, 12)), /^2[23]\/11$/); });
});

test('audio and subtitle labels are localized but keep the language word the app matches on', () => {
  const sub = { lang: 'pob', forced: true, sIdx: 1 };
  U.withLang('en', () => {
    assert.strictEqual(PL.audioLabel({ lang: 'por', codec: 'ac3', channels: 6 }), 'Portuguese · AC3 6ch');
    assert.strictEqual(PL.subLabel(sub), 'Portuguese (BR) (forced)');
    assert.strictEqual(PL.subLabel({ sIdx: 2 }), 'Embedded #3');
    assert.strictEqual(U.t('audio.dubbed'), 'Portuguese (dubbed)');
  });
  U.withLang('pt', () => {
    assert.strictEqual(PL.audioLabel({ lang: 'por', codec: 'ac3', channels: 6 }), 'Português · AC3 6ch');
    assert.strictEqual(PL.subLabel(sub), 'Português (BR) (forçada)');
    assert.strictEqual(PL.subLabel({ sIdx: 2 }), 'Embutida #3');
    assert.strictEqual(U.t('audio.dubbed'), 'Português (dublado)');
  });
  // the app's auto-pick regexes (app.js autoSub) must hit the labels of both languages
  const ptRe = /portugu|\bpt\b|pt-br|pob|\bpor\b|brazil|brasil/i, brRe = /brazil|brasil|pt-br|pob|\(br\)|\bbr\b/i, forcedRe = /forced|for[cç]ad|signs|songs|letreiro/i;
  for (const l of ['en', 'pt']) U.withLang(l, () => {
    assert.ok(ptRe.test(PL.subLabel({ lang: 'por', sIdx: 0 })) && ptRe.test(PL.audioLabel({ lang: 'pob', codec: 'aac' })), l);
    assert.ok(brRe.test(PL.subLabel({ lang: 'pob', sIdx: 0 })), l);
    assert.ok(forcedRe.test(PL.subLabel({ lang: 'pob', forced: true, sIdx: 0 })), l);
  });
});

test('a remembered audio label matches across UI languages', () => {
  const en = U.withLang('en', () => PL.audioLabel({ lang: 'por', codec: 'aac', channels: 2 }));
  const pt = U.withLang('pt', () => PL.audioLabel({ lang: 'por', codec: 'aac', channels: 2 }));
  assert.notStrictEqual(en, pt);
  assert.strictEqual(PL.labelNorm(en), PL.labelNorm(pt));
  assert.notStrictEqual(PL.labelNorm(en), PL.labelNorm(U.withLang('en', () => PL.audioLabel({ lang: 'eng', codec: 'aac', channels: 2 }))));
});

test('every server key exists in both languages with the same placeholders', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'util.js'), 'utf8');
  const STR = new Function(src.slice(src.indexOf('const STR = {'), src.indexOf('// t(\'key\'')) .replace('const STR', 'var STR') + '; return STR;')();
  assert.deepStrictEqual(Object.keys(STR.en).sort(), Object.keys(STR.pt).sort());
  const ph = s => (typeof s === 'string' ? (s.match(/\{\d+\}/g) || []).sort().join() : 'fn');
  for (const k of Object.keys(STR.en)) assert.strictEqual(ph(STR.en[k]), ph(STR.pt[k]), k);
});

test('app dictionary: same keys in pt and en, every referenced key defined', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'app.js'), 'utf8');
  const a = src.indexOf('var I18N = {'), b = src.indexOf('function t(key)');
  const I18N = new Function('MON_EN', src.slice(a, b) + '; return I18N;')(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.deepStrictEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.pt).sort());
  const used = new Set([...(src.slice(0, a) + src.slice(b)).matchAll(/'([a-z]+\.[a-zA-Z]+)'/g)].map(m => m[1]));
  assert.deepStrictEqual([...used].filter(k => !(k in I18N.en)), []);
  const ph = s => (typeof s === 'string' ? (s.match(/\{\d+\}/g) || []).sort().join() : 'fn');
  for (const k of Object.keys(I18N.en)) assert.strictEqual(ph(I18N.en[k]), ph(I18N.pt[k]), k);
});

test('http: /api/settings exposes uiLang, ?lang= selects the /admin page language', async () => {
  const port = await new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const env = Object.assign({}, process.env, { PORT: String(port), SPP_STATE: STATE, SPP_LIBRARY_WRITE: '0', SPP_MEDIA: 'none' });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  const j = (p, o) => fetch(B + p, o).then(async r => ({ s: r.status, t: await r.text() }));
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/health'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    let r = await j('/api/settings'); assert.strictEqual(JSON.parse(r.t).uiLang, 'en');
    r = await j('/admin'); assert.match(r.t, /<html lang="en">/); assert.match(r.t, /Preferences/);
    r = await j('/admin?lang=pt'); assert.match(r.t, /<html lang="pt-BR">/); assert.match(r.t, /Preferencias/);
    r = await j('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLang: 'pt' }) });
    assert.strictEqual(JSON.parse(r.t).uiLang, 'pt');
    r = await j('/admin'); assert.match(r.t, /<html lang="pt-BR">/);
    r = await j('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLang: 'xx' }) });
    assert.strictEqual(JSON.parse(r.t).uiLang, 'pt'); // invalid value ignored
    r = await j('/api/nope?lang=pt'); assert.strictEqual(r.s, 404);
  } finally { srv.kill(); }
});

test.after(() => { try { fs.rmSync(STATE, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
