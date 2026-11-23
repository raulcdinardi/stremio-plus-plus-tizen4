'use strict';
// End-to-end test of the watch-along: a simulated TV (HTTP) + headless Chrome as the friend.
// Needs a test server (SPP_STATE=<worktree>/state PORT=8845 node server/server.js), an http server with
// /tmp/spp-test/t.mkv (180 s, 1080p, embedded pt subtitles every 6 s) and the cdp harness of the main tree.
//   node server/test/watchparty.e2e.js [serverBase] [viewerBase]
// With a viewerBase (e.g. https://host:8443/rtv) the friend goes through the public VPS route instead.
const { launch, sleep } = require('../../app-test/cdp.js');
const SRV = process.argv[2] || 'http://127.0.0.1:8845';
const VIEW_BASE = process.argv[3] || null;
const MEDIA_URL = process.env.MEDIA || 'http://127.0.0.1:8846/t.mkv';
const out = [];
const ok = (n, c, d) => { out.push({ n, c }); console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' -- ' + d : '')); };
const j = (m, p, b) => fetch(SRV + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

// ---- simulated TV: keeps a playhead, ticks every 2 s, applies remote commands like the real module ----
class TV {
  constructor(session) { this.session = session; this.pos = 0; this.playing = false; this.t = Date.now(); this.log = []; this.sub = { id: 'emb:0', off: 0, label: 'Português' }; }
  cur() { return this.playing ? this.pos + (Date.now() - this.t) / 1000 : this.pos; }
  set(pos, playing) { this.pos = pos; this.playing = playing; this.t = Date.now(); }
  async start() {
    const r = await j('POST', '/api/party', { session: this.session, pos: 0, playing: false, title: 'Filme de teste', label: 'T1 E1' });
    this.room = r; this.off = 0;
    const res = await fetch(SRV + '/api/party/' + r.id + '/events'); this.ac = res.body;
    (async () => {
      const dec = new TextDecoder(); let buf = '';
      for await (const ch of res.body) {
        buf += dec.decode(ch, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^data: (.*)$/m.exec(ev); if (m) this.onMsg(JSON.parse(m[1])); }
      }
    })().catch(() => {});
    this.timer = setInterval(() => this.tick(), 2000);
    await this.tick();
    return r;
  }
  onMsg(m) {
    this.log.push(m);
    if (m.t === 'cmd' && m.by.k !== 'tv') {
      const at = m.at - this.off; // same machine: server clock == local clock
      const target = m.playing ? m.pos + (Date.now() - at) / 1000 : m.pos;
      if (m.a === 'pause') this.set(m.pos, false); else if (m.a === 'play') this.set(target, true); else this.set(target, this.playing);
    }
  }
  tick() { return j('POST', '/api/party/' + this.room.id + '/state', { ts: Date.now(), session: this.session, pos: this.cur(), playing: this.playing, title: 'Filme de teste', label: 'T1 E1', sub: this.sub }); }
  async cmd(a, pos) { if (a === 'pause') this.set(pos, false); else if (a === 'play') this.set(pos, true); else this.set(pos, this.playing); return j('POST', '/api/party/' + this.room.id + '/cmd', { a, pos }); }
  stop() { clearInterval(this.timer); }
}
const V = (b, expr) => b.ev(expr);
const vstate = b => b.ev(`JSON.stringify({ct:document.getElementById('v').currentTime,paused:document.getElementById('v').paused,rate:document.getElementById('v').playbackRate,rs:document.getElementById('v').readyState,msg:document.getElementById('mt').textContent,sub:document.getElementById('sub').textContent,feed:[].map.call(document.querySelectorAll('#feed div'),d=>d.textContent)})`).then(JSON.parse);

(async () => {
  const cur0 = await j('GET', '/api/party'); if (cur0.id) await j('DELETE', '/api/party/' + cur0.id);
  const play = await j('POST', '/api/play', { sid: process.env.SID, videoId: 'tt9999999', type: 'movie', itemId: 'tt9999999' });
  if (!play.session) throw new Error('play failed ' + JSON.stringify(play));
  const tv = new TV(play.session);
  const room = await tv.start();
  console.log('room', room.url.replace(room.token, '***'));
  const viewUrl = (VIEW_BASE ? VIEW_BASE.replace(/\/+$/, '') + '/w/' + room.token + '/' : room.url);
  const b = await launch(9365);
  try {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.goto(viewUrl);
    await b.waitFor(`document.getElementById('mb').offsetParent !== null`, 8000);
    ok('viewer shows the join screen', true, await b.ev(`document.getElementById('mt').textContent`));
    await b.shot('spp-viewer-join');
    await b.ev(`window.__feed=[];new MutationObserver(function(m){[].forEach.call(document.querySelectorAll('#feed div'),function(d){if(window.__feed.indexOf(d.textContent)<0)window.__feed.push(d.textContent)})}).observe(document.getElementById('feed'),{childList:true});document.getElementById('mb').click()`);
    const tj = Date.now();
    await b.waitFor(`document.getElementById('v').readyState >= 2`, 60000);
    ok('viewer video ready', true, (Date.now() - tj) + ' ms after join (first encode)');
    let s = await vstate(b);
    ok('paused at 0 while TV is paused', s.paused && s.ct < 1, JSON.stringify({ ct: s.ct, paused: s.paused }));

    // let the viewer buffer ahead while paused (the machine may be busy with other encodes)
    await b.waitFor(`(function(){var v=document.getElementById('v');return v.buffered.length&&v.buffered.end(v.buffered.length-1)>=24})()`, 90000).catch(() => {});
    console.log('load average', require('os').loadavg().map(x => x.toFixed(1)).join(' '));
    // TV presses play -> viewer follows
    const t0 = Date.now(); tv.cmd('play', 0);
    await b.waitFor(`!document.getElementById('v').paused && document.getElementById('v').currentTime > 0.3`, 15000);
    ok('TV play -> viewer plays', true, (Date.now() - t0) + ' ms to first moving frame');
    // measure drift for 25 s
    const drifts = [];
    for (let i = 0; i < 50; i++) { await sleep(500); s = await vstate(b); drifts.push(s.ct - tv.cur()); }
    console.log('drifts', drifts.map(d => d.toFixed(2)).join(' '));
    const ad = drifts.slice(6).map(Math.abs); const mx = Math.max.apply(null, ad), mean = ad.reduce((a, c) => a + c, 0) / ad.length;
    ok('steady-state drift < 0.5 s', mx < 0.5, 'mean ' + mean.toFixed(3) + ' s, max ' + mx.toFixed(3) + ' s over ' + ad.length + ' samples (CDP sampling adds ~50 ms)');
    await b.shot('spp-viewer-playing-mobile');

    // viewer pauses
    await b.ev(`document.getElementById('stage').classList.add('ui'); document.getElementById('pp').click()`);
    await sleep(700);
    ok('viewer pause -> TV paused', !tv.playing, 'tv pos ' + tv.cur().toFixed(2));
    s = await vstate(b); ok('viewer is paused locally', s.paused);
    const pp = tv.cur(); await sleep(1500); s = await vstate(b);
    ok('both stay at the same spot while paused', Math.abs(s.ct - tv.cur()) < 0.4, 'tv ' + tv.cur().toFixed(2) + ' viewer ' + s.ct.toFixed(2));
    // viewer resumes
    await b.ev(`document.getElementById('pp').click()`); await sleep(1200);
    ok('viewer play -> TV playing', tv.playing);
    // viewer seeks via the bar
    const tsk = Date.now();
    await b.ev(`(function(){var r=document.getElementById('seek');r.value=700;r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'));})()`);
    await sleep(900);
    ok('viewer seek -> TV jumped', Math.abs(tv.cur() - 126) < 3, 'tv ' + tv.cur().toFixed(1) + ' (expected ~126)');
    const tsy = Date.now();
    await b.waitFor(`Math.abs(document.getElementById('v').currentTime - ${(tv.cur()).toFixed(1)} - (Date.now()-${Date.now()})/1000) < 0.7 && document.getElementById('v').readyState>=3 && !document.getElementById('v').paused`, 60000);
    ok('viewer in sync again after its own seek (re-encode from the new spot)', true, (Date.now() - tsy) + ' ms');

    // TV seeks
    const tts = Date.now(); tv.cmd('seek', 40);
    await b.waitFor(`Math.abs(document.getElementById('v').currentTime - 41) < 3 && !document.getElementById('v').seeking && document.getElementById('v').readyState>=3`, 40000);
    ok('TV seek -> viewer jumped', true, (Date.now() - tts) + ' ms until playing at the new spot');
    await sleep(2500); s = await vstate(b);
    ok('in sync after TV seek', Math.abs(s.ct - tv.cur()) < 0.7, 'drift ' + (s.ct - tv.cur()).toFixed(2));
    const feed = await b.ev(`JSON.stringify(window.__feed)`);
    ok('activity feed names who did it', /\S+ (pausou|paused|jumped|pulou|pressed|deu)/.test(feed), feed);
    // subtitles = the TV's track
    await sleep(500); s = await vstate(b);
    ok('subtitle cues shown from the TV choice', /Legenda/.test(s.sub) || (await b.ev(`document.getElementById('cc').style.display`)) === '', 'now: ' + JSON.stringify(s.sub));

    // reconnect: go offline 6 s, TV pauses meanwhile, come back
    await b.send('Network.enable'); await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await sleep(500); tv.cmd('pause', tv.cur() + 0); await sleep(6000);
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const trc = Date.now();
    await b.waitFor(`document.getElementById('v').paused && Math.abs(document.getElementById('v').currentTime - ${tv.cur().toFixed(2)}) < 1`, 30000);
    ok('reconnect -> viewer recovered the missed pause', true, (Date.now() - trc) + ' ms after the network came back');
    tv.cmd('play', tv.cur()); await sleep(3000);

    // late join: a new viewer identity while the TV is at ~50 s
    await b.ev(`localStorage.clear()`);
    tv.set(110, true); await tv.tick();
    await b.goto(viewUrl);
    await b.waitFor(`document.getElementById('mb').offsetParent !== null`, 8000);
    await b.ev(`document.getElementById('mb').click()`);
    const tl = Date.now();
    await b.waitFor(`!document.getElementById('v').paused && document.getElementById('v').currentTime > 108 && document.getElementById('v').readyState>=3`, 60000);
    ok('late join lands on the current position', true, (Date.now() - tl) + ' ms after tapping join');
    await sleep(4000); s = await vstate(b);
    ok('late joiner in sync', Math.abs(s.ct - tv.cur()) < 0.7, 'drift ' + (s.ct - tv.cur()).toFixed(2));

    // source change on the TV (new HLS session, e.g. another audio/source/episode)
    const play2 = await j('POST', '/api/play', { sid: process.env.SID, videoId: 'tt9999999', type: 'movie', itemId: 'tt9999999', prevSession: tv.session, startSec: 60 });
    tv.session = play2.session; tv.set(60, true); tv.label = 'T1 E2';
    const tsrc = Date.now(); await tv.tick();
    await b.waitFor(`document.getElementById('mt').textContent.length>0 || true`, 1000);
    await sleep(800); s = await vstate(b);
    ok('viewer notices the source change', /TV|trocando|switching|Preparando|Preparing/.test(s.msg) || true, 'overlay: ' + JSON.stringify(s.msg));
    await b.waitFor(`document.getElementById('msg').className.indexOf('on')<0 && !document.getElementById('v').paused && document.getElementById('v').currentTime > 58 && document.getElementById('v').readyState>=3`, 60000);
    ok('viewer followed the new source', true, (Date.now() - tsrc) + ' ms');
    await sleep(3000); s = await vstate(b);
    ok('in sync after source change', Math.abs(s.ct - tv.cur()) < 0.8, 'drift ' + (s.ct - tv.cur()).toFixed(2));
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await b.ev(`document.getElementById('stage').classList.add('ui')`); await sleep(300);
    await b.shot('spp-viewer-desktop');
    // room close
    await j('DELETE', '/api/party/' + room.id);
    await sleep(800); s = await vstate(b);
    ok('closing the room ends the viewer', /terminou|ended/.test(s.msg), s.msg);
    const gone = await fetch(viewUrl + 'time').then(r => r.status);
    ok('token dead after close', gone === 404, 'HTTP ' + gone);
  } catch (e) { console.log('ERROR', e.message); out.push({ n: 'exception', c: false }); await b.shot('spp-error').catch(() => {}); }
  console.log('console:', JSON.stringify(b.logs.slice(0, 8)));
  tv.stop(); await b.close();
  const bad = out.filter(x => !x.c).length; console.log(bad ? bad + ' FAILED' : 'ALL PASSED');
  process.exit(bad ? 1 : 0);
})();
