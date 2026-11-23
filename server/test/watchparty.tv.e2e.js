'use strict';
// TV-side test: the real app (mock AVPlay, headless Chrome, 1920x1080) + a simulated friend over HTTP.
//   SID=<sid of an http source> node server/test/watchparty.tv.e2e.js [serverBase]
const { launch, sleep } = require('../../app-test/cdp.js');
const SRV = process.argv[2] || 'http://127.0.0.1:8845';
const out = [];
const ok = (n, c, d) => { out.push({ n, c }); console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' -- ' + d : '')); };
const j = (m, p, b) => fetch(SRV + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

(async () => {
  const cur0 = await j('GET', '/api/party'); if (cur0.id) await j('DELETE', '/api/party/' + cur0.id);
  const b = await launch(9365);
  const P = (e) => b.ev(`(function(){var P=window.__spp.player();return ${e}})()`);
  try {
    await b.goto(SRV + '/app/index.html?server=' + SRV);
    await b.waitFor(`window.__spp && window.__spp.nav.name !== 'boot'`, 20000);
    await b.ev(`window.__spp.mount('player', {type:'movie', itemId:'tt9999999', videoId:'tt9999999', name:'Filme de teste', label:'', sid:'${process.env.SID}', startSec:0})`);
    await b.waitFor(`window.__spp.player() && window.__spp.player().state==='playing'`, 30000);
    ok('player playing in the TV app', true, 'pos ' + (await P('P.pos')));
    // open the control: up -> pause button, right -> watch-together, enter
    await sleep(1200); await b.key('up'); await sleep(300); await b.key('right'); await sleep(300);
    await b.shot('spp-tv-control');
    await b.key('enter'); await b.waitFor(`document.querySelector('.spp-ov canvas') !== null && document.querySelector('.spp-ov .u')!==null`, 10000);
    await sleep(500);
    const room = await j('GET', '/api/party');
    ok('room created from the player control', !!room.id, room.url && room.url.replace(/\/w\/[\w-]+/, '/w/***'));
    const shown = await b.ev(`document.querySelector('.spp-ov .u').textContent`);
    ok('link shown on screen equals the room link', shown === room.url);
    const qr = await b.ev(`(function(){var c=document.querySelector('.spp-ov canvas');var d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;var dark=0;for(var i=0;i<d.length;i+=4)if(d[i]<100)dark++;return {w:c.width,dark:dark}})()`);
    ok('QR drawn on screen', qr.w > 200 && qr.dark > 500, JSON.stringify(qr));
    await b.shot('spp-tv-overlay');
    // a QR decoder, if any, can confirm the content
    // close overlay with Back; playback must continue
    await b.key('back'); await sleep(300);
    ok('overlay closes with Back', (await b.ev(`document.querySelector('.spp-ov')`)) === null);
    await b.key('down'); await sleep(200); // leave the OSD button row

    // friend joins (SSE) and sends commands
    const events = []; const cid = 'friend1';
    const res = await fetch(SRV + '/w/' + room.token + '/events?cid=' + cid + '&lang=pt&name=Ana');
    (async () => { const dec = new TextDecoder(); let buf = ''; for await (const ch of res.body) { buf += dec.decode(ch, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^data: (.*)$/m.exec(ev); if (m) events.push(JSON.parse(m[1])); } } })().catch(() => {});
    await sleep(800);
    const toastOf = () => b.ev(`document.querySelector('.toast') ? document.querySelector('.toast span').textContent + '|' + document.querySelector('.toast').className : ''`);
    ok('guest joined toast on the TV', /Ana/.test(await toastOf()), await toastOf());
    const snap = events.find(e => e.t === 'snap');
    ok('viewer snapshot has the TV position/source', snap && snap.source.title === 'Filme de teste' && snap.playing === true, snap && JSON.stringify({ pos: snap.pos, playing: snap.playing }));

    const vcmd = (a, pos) => j('POST', '/w/' + room.token + '/cmd', { a, pos, cid, name: 'Ana' });
    let t0 = Date.now(); await vcmd('pause', await P('P.pos'));
    await b.waitFor(`window.__spp.player().state==='paused'`, 5000);
    ok('friend pause -> TV paused', true, (Date.now() - t0) + ' ms');
    ok('TV toast names the friend', /Ana/.test(await toastOf()), await toastOf());
    t0 = Date.now(); await vcmd('play', await P('P.pos'));
    await b.waitFor(`window.__spp.player().state==='playing'`, 5000);
    ok('friend play -> TV playing', true, (Date.now() - t0) + ' ms');
    t0 = Date.now(); await vcmd('seek', 80);
    await b.waitFor(`Math.abs(window.__spp.player().pos - 80) < 3 && window.__spp.player().state==='playing'`, 8000);
    ok('friend seek -> TV jumped to ~80 s', true, (Date.now() - t0) + ' ms, pos ' + (await P('P.pos')).toFixed(1));
    await sleep(2500);
    const rs = await j('GET', '/api/party'); void rs;
    ok('no echo loop: TV did not re-send the friend commands', events.filter(e => e.t === 'cmd' && e.by.k === 'tv').length === 0, JSON.stringify(events.filter(e => e.t === 'cmd').map(e => e.a + ':' + e.by.k)));

    // TV local actions reach the friend
    events.length = 0;
    await b.ev(`window.__spp.player().ctl=-1`);
    await b.key('pause'); await sleep(1200);   // pause key
    ok('TV pause -> friend receives pause by TV', events.some(e => e.t === 'cmd' && e.a === 'pause' && e.by.k === 'tv'), JSON.stringify(events.filter(e => e.t === 'cmd').map(e => e.a + ':' + e.by.name)));
    await b.key('play'); await sleep(1200);
    ok('TV play -> friend receives play', events.some(e => e.t === 'cmd' && e.a === 'play' && e.by.k === 'tv'));
    events.length = 0; await b.key('right', 2); await sleep(2200);
    const sk = events.find(e => e.t === 'cmd' && e.a === 'seek');
    ok('TV seek -> friend receives seek', !!sk, sk && 'to ' + sk.pos.toFixed(1));
    // TV subtitle choice is shared (the mock source has an embedded track)
    const sub0 = await P('P.subs.map(function(s){return s.id})');
    ok('TV subtitle tracks exist', sub0.length > 0, JSON.stringify(sub0));
    if (!(await P('P.subId'))) { await b.ev(`(function(){var p=window.__spp.player();p.subId='emb:0';})()`); }
    await sleep(2600);
    const rs2 = await fetch(SRV + '/w/' + room.token + '/events?cid=probe').then(async r => { const rd = r.body.getReader(); const { value } = await rd.read(); rd.cancel(); return new TextDecoder().decode(value); });
    ok('TV subtitle choice is part of the room state', /"sub":\{"id":"emb:0"/.test(rs2), (/"sub":(\{[^}]*\})/.exec(rs2) || [])[1]);
    let subs = { cues: [] };
    for (let i = 0; i < 12 && subs.cues.length < 3; i++) { subs = await fetch(SRV + '/w/' + room.token + '/subs?from=0&to=60').then(r => r.json()); if (subs.cues.length < 3) await sleep(2000); }
    ok('room-scoped /subs serves the TV track cues', subs.on && subs.cues.length > 3, subs.cues && subs.cues.length + ' cues, first ' + JSON.stringify(subs.cues[0]));

    // "episode/source change": the TV mounts a new player screen (new session); room must follow and persist
    events.length = 0;
    await b.ev(`window.__spp.mount('player', {type:'movie', itemId:'tt9999999', videoId:'tt9999999', name:'Outro episódio', label:'T1 E2', sid:'${process.env.SID}', startSec:30})`);
    await b.waitFor(`window.__spp.player() && window.__spp.player().state==='playing'`, 30000);
    await sleep(3500);
    ok('room survives the new player screen and announces the new source', events.some(e => e.t === 'source' && e.state === 'loading') && events.some(e => e.t === 'source' && e.state === 'ready'), JSON.stringify(events.filter(e => e.t === 'source').map(e => e.state + ':' + e.title + ':' + e.label)));
    const after = await j('GET', '/api/party'); ok('same room id/link after the change', after.id === room.id && after.token === room.token);

    // reopen the control: shows the same link, End session closes it
    await b.key('up'); await sleep(300); await b.key('right'); await sleep(300); await b.key('enter'); await sleep(400);
    ok('control reopens the same room', (await b.ev(`document.querySelector('.spp-ov .u') && document.querySelector('.spp-ov .u').textContent`)) === room.url);
    await b.key('left'); await b.key('enter'); await sleep(800);
    const end = await j('GET', '/api/party'); ok('End session closes the room on the server', !end.id);
    ok('friend stream got closed', events.some(e => e.t === 'closed'));
    const gone = await fetch(SRV + '/w/' + room.token + '/time').then(r => r.status); ok('viewer token dead', gone === 404, 'HTTP ' + gone);
  } catch (e) { console.log('ERROR', e.stack.split('\n').slice(0, 3).join(' | ')); out.push({ n: 'exception', c: false }); await b.shot('spp-tv-error').catch(() => {}); }
  console.log('console:', JSON.stringify(b.logs.slice(0, 8)));
  await b.close();
  const bad = out.filter(x => !x.c).length; console.log(bad ? bad + ' FAILED' : 'ALL PASSED');
  process.exit(bad ? 1 : 0);
})();
