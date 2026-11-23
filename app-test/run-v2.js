const { launch, sleep } = require('./cdp');
const BASE = process.env.BASE || 'http://localhost:8791';
const PFX = process.env.PFX || 'v2-';
const out = {};
const nodes = d => d.ev('document.getElementsByTagName("*").length');
const imgs = d => d.ev('document.getElementsByTagName("img").length');
const scr = d => d.ev('__spp.nav.name');
const S = (d, n) => d.shot(PFX + n);
(async () => {
  const mock = BASE.includes('8791');
  if (mock) { await fetch(BASE + '/__reset'); await fetch(BASE + '/__dur?s=300'); await fetch(BASE + '/__fail?on=0'); }
  const d = await launch(9336);
  const step = m => console.log('--', m);
  try {
    await d.goto(`${BASE}/app/index.html`); await d.ev('localStorage.clear()'); await d.goto(`${BASE}/app/index.html`);
    await d.waitFor('window.__spp && __spp.nav.name==="home" && document.getElementsByTagName("img").length>3', 20000); await sleep(1500);
    out.homeNodes = await nodes(d); out.homeImgs = await imgs(d);
    await S(d, '01-home');
    step('home');
    await d.key('right', 3); await d.key('down'); await sleep(1500); await d.key('right', 2); await sleep(1500); await S(d, '02-home-row2');
    out.homeNodes2 = await nodes(d); out.homeImgs2 = await imgs(d);
    await d.key('down'); await sleep(1500); await S(d, '03-home-row3');
    await d.key('up', 2); await d.key('left', 5); await sleep(300); await d.key('left'); await sleep(200); await S(d, '04-rail-focus');
    step('search');
    await d.key('down'); await d.key('enter'); await d.waitFor('__spp.nav.name==="search"'); await sleep(300); await S(d, '05-search-empty');
    // multitap naruto
    const tap = async (digit, n, gap = 150) => { for (let i = 0; i < n; i++) { await d.key(digit.toString().charCodeAt(0), 1, 0); await sleep(gap); } };
    await tap(6, 2); await tap(2, 1); await tap(7, 3); await sleep(150); await S(d, '06-multitap-pending');
    out.pendMid = await d.ev('document.querySelector(".sf").textContent');
    await tap(8, 2); await sleep(1000); await tap(8, 1); await tap(6, 3);
    out.fieldAfterTap = await d.ev('document.querySelector(".sf").textContent');
    await sleep(1500); out.fieldFinal = await d.ev('document.querySelector(".sf").textContent');
    await d.waitFor('document.querySelectorAll(".gc").length>2', 10000); await sleep(1500); await S(d, '07-search-results');
    out.searchNodes = await nodes(d); out.searchImgs = await imgs(d);
    // colored keys: yellow clears, green space, red delete
    await d.key(405); out.afterYellow = await d.ev('document.querySelector(".sf").textContent');
    await tap(4, 2); await sleep(1000); await d.key(404); await tap(2, 1); await sleep(1000); await d.key(403); out.afterRed = await d.ev('document.querySelector(".sf").textContent');
    await d.key(405); await sleep(600);
    // on-screen keyboard
    await d.key('down'); await d.key('right', 2); await d.key('enter'); await d.key('down', 2); await d.key('enter'); await d.key('down', 1); await sleep(150); await S(d, '08-keyboard-focus');
    out.fieldKb = await d.ev('document.querySelector(".sf").textContent');
    await d.key('up', 6); await d.key(405); await sleep(300);
    for (const ch of [54, 50, 56]) { await d.key(ch); await sleep(1000); } // 6->m,2->a,8->t
    await sleep(1200); out.fieldMat = await d.ev('document.querySelector(".sf").textContent');
    step('detail');
    await d.key('down'); await d.key('right', 6); await sleep(300);
    await d.waitFor('document.querySelectorAll(".gc").length>0', 10000);
    await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"', 15000); await sleep(2500); await S(d, '10-detail-movie');
    out.detailNodes = await nodes(d); out.detailImgs = await imgs(d);
    out.detailName = await d.ev('document.querySelector(".dtitle").textContent+" | logo:"+!!document.querySelector(".dlogo img")');
    await d.waitFor('document.querySelectorAll(".sr").length>2', 15000); await d.key('right', 4); await sleep(300); await S(d, '11-detail-movie-streams');
    await d.key('back'); await d.waitFor('__spp.nav.name==="search"'); await sleep(300);
    await d.key('left', 8); await sleep(200); await d.key('up', 3); await d.key('enter'); await d.waitFor('__spp.nav.name==="home"'); await sleep(800);
    await d.key('down', 2); await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"'); await sleep(2500); await S(d, '12-detail-series');
    out.seriesNodes = await nodes(d);
    await S(d, '12b-detail-series-focusbtn'); await d.key('right', 5); await sleep(300); await S(d, '13-detail-panel-ep');
    await d.key('up', 9); await d.key('right'); await d.key('left'); await sleep(200); await S(d, '13b-detail-season-focus'); await d.key('down', 3); await sleep(500); await S(d, '14-detail-episodes');
    await d.key('enter'); await d.waitFor('document.querySelectorAll(".sr").length>2', 15000); await sleep(800); await S(d, '15-detail-streams');
    out.streamsNodes = await nodes(d);
    await d.key('down', 2); await sleep(200); await S(d, '16-detail-streams-focus');
    await d.key('up', 2);
    step('player');
    await d.key('enter'); await d.waitFor('__spp.nav.name==="player"'); await sleep(300); await S(d, '20-player-loading');
    await d.waitFor('__spp.player() && __spp.player().state==="playing"', 15000); await sleep(500); await S(d, '21-player-osd');
    out.playerNodes = await nodes(d);
    await d.key('up'); await sleep(200); await S(d, '22-player-ctl');
    await d.key('right', 2); await d.key('enter'); await sleep(300); await S(d, '23-player-audio-panel');
    await d.key('back'); await d.key('left'); await d.key('enter'); await sleep(500); await S(d, '24-player-subs-panel');
    await d.key('down'); await d.key('enter'); await sleep(300); await d.key('back');
    await d.key('right', 2); await d.key('enter'); await d.waitFor('document.querySelectorAll(".sr").length>2', 10000); await sleep(500); await S(d, '25-player-src-panel');
    await d.key('back'); await sleep(200); await d.key('down');
    await d.waitFor('document.getElementById("sub").textContent.length>0', 12000); await sleep(200); await S(d, '26-player-subtitle');
    await d.ev('window.__mockSpeed=8'); await d.waitFor('__spp.player().pos>=56', 30000); await d.ev('window.__mockSpeed=1'); await d.waitFor('__spp.player().pos>=62', 8000); await sleep(300); await S(d, '27-player-skip');
    await d.ev('window.__mockSpeed=8'); await d.waitFor('__spp.player().pos>=176', 30000); await d.ev('window.__mockSpeed=1'); await d.waitFor('__spp.player().nextShown', 8000); await sleep(1200); await S(d, '28-player-next');
    await d.key('back'); await d.key('back'); await d.waitFor('__spp.nav.name==="detail"'); await sleep(500);
    step('rail screens');
    await d.key('left', 3); await sleep(200); await d.key('left'); await d.key('down'); await d.key('down'); await d.key('enter'); await d.waitFor('__spp.nav.name==="library"'); await sleep(2500); await S(d, '30-library');
    out.libNodes = await nodes(d); out.libImgs = await imgs(d);
    await d.key('left'); await d.key('down'); await d.key('enter'); await d.waitFor('__spp.nav.name==="settings"'); await sleep(500); await S(d, '31-settings');
    await d.key('left'); await d.key('up', 3); await d.key('enter'); await d.waitFor('__spp.nav.name==="home"'); await sleep(1000);
    await d.key('back'); await sleep(200); await S(d, '32-exit-modal'); await d.key('right'); await d.key('enter');
    step('memory loop');
    await d.key('left', 3); await d.key('up', 3); await d.key('enter'); await d.waitFor('__spp.nav.name==="home"'); await sleep(800); await d.key('down', 3); await d.key('right', 2); await sleep(500);
    const heap = [], nc = [];
    for (let i = 0; i < 20; i++) {
      await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"'); await sleep(250);
      await d.key('right', 3); await sleep(150); await d.key('left', 3);
      await d.key('back'); await d.waitFor('__spp.nav.name==="home"'); await sleep(250);
      await d.gc(); heap.push(await d.ev('performance.memory.usedJSHeapSize')); nc.push(await nodes(d));
    }
    out.heapMB = heap.map(h => +(h / 1048576).toFixed(2)); out.nodesLoop = nc;
    out.domCounters = await d.send('Memory.getDOMCounters');
    step('latency');
    await d.ev('window.__measure=true;__spp.keyStats.length=0');
    for (let i = 0; i < 40; i++) await d.key('right', 1, 20); for (let i = 0; i < 40; i++) await d.key('left', 1, 20);
    for (let i = 0; i < 6; i++) { await d.key('down', 1, 20); await d.key('up', 1, 20); await d.key('right', 3, 20); await d.key('left', 3, 20); }
    const ks = await d.ev('__spp.keyStats.slice()'); ks.sort((a, b) => a - b);
    out.latencyMs = { n: ks.length, avg: +(ks.reduce((a, b) => a + b, 0) / ks.length).toFixed(2), p95: +ks[Math.floor(ks.length * .95)].toFixed(2), max: +ks[ks.length - 1].toFixed(2) };
    if (mock) {
      await d.goto('file://' + require('path').resolve(__dirname, '..') + '/app/index.html'); await d.ev('localStorage.clear()'); await d.goto('file://' + require('path').resolve(__dirname, '..') + '/app/index.html');
      await d.waitFor('__spp.nav.name==="connect"', 15000); await S(d, '33-connect');
    }
    out.consoleLogs = d.logs.slice(0, 20);
  } catch (e) { console.error('FAIL', e); out.fail = String(e); try { await S(d, '99-fail'); } catch (_) {} out.consoleLogs = d.logs.slice(0, 20); }
  console.log(JSON.stringify(out, null, 1)); await d.close(); process.exit(0);
})();
