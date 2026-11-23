const { launch, sleep } = require('./cdp');
const BASE = 'http://localhost:8791';
const out = {};
const nodes = d => d.ev('document.getElementsByTagName("*").length');
const imgs = d => d.ev('document.getElementsByTagName("img").length');
const scr = d => d.ev('window.__spp.nav.name');
(async () => {
  await fetch(BASE + '/__reset'); await fetch(BASE + '/__dur?s=2820'); await fetch(BASE + '/__fail?on=0');
  const d = await launch();
  const step = (m) => console.log('--', m);
  try {
    await d.goto(`${BASE}/app/index.html`);
    await d.ev('localStorage.clear()'); await d.goto(`${BASE}/app/index.html`);
    await d.waitFor('window.__spp && __spp.nav.name==="home" && document.getElementsByTagName("img").length>3');
    await sleep(1500);
    out.homeNodes = await nodes(d); out.homeImgs = await imgs(d);
    await d.shot('01-home');
    step('home nav');
    await d.key('right', 3); await sleep(250); await d.shot('02-home-continue-right');
    await d.key('down'); await sleep(300); await d.key('right', 4); await sleep(500); await d.shot('03-home-movies');
    await d.key('down'); await sleep(300); await d.key('right', 8); await sleep(500); await d.shot('04-home-series-far');
    out.homeNodesFar = await nodes(d); out.homeImgsFar = await imgs(d);
    await d.key('down'); await sleep(300); await d.shot('05-home-anime');
    await d.key('up', 3); await d.key('up'); await sleep(300); await d.shot('06-home-topbar');
    await d.key('back'); await sleep(200); await d.shot('07-home-exit-modal'); await d.key('right'); await d.key('enter'); // Não
    await sleep(200);
    step('detail');
    await d.key('down', 3); await sleep(200); // series row (col remembered)
    await d.key('left', 8); await sleep(200); // first item: Breaking Bad
    await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"'); await sleep(1200);
    out.detailNodes = await nodes(d);
    await d.shot('10-detail');
    await d.key('right', 3); await d.key('enter'); await sleep(200); await d.key('right',4); await sleep(100); await d.shot('11-detail-rate');
    await d.key('left'); await d.key('enter'); await sleep(300); await d.shot('12-detail-rated');
    await d.key('left', 2); await d.key('down'); await sleep(200); await d.key('right'); await sleep(300); await d.key('down'); await d.key('down'); await sleep(250); await d.shot('13-detail-episodes');
    step('streams');
    await d.key('enter'); await d.waitFor('__spp.nav.name==="streams"'); await d.waitFor('document.querySelectorAll(".sr").length>3'); await sleep(300);
    out.streamsNodes = await nodes(d);
    await d.key('down', 2); await sleep(200); await d.shot('20-streams');
    await d.key('up', 2); // Auto
    step('player');
    await fetch(BASE + '/__dur?s=300');
    await d.key('enter'); await d.waitFor('__spp.nav.name==="player"'); await d.shot('30-player-loading');
    await d.waitFor('__spp.player() && __spp.player().state==="playing"'); await sleep(500);
    out.playerNodes = await nodes(d);
    await d.shot('31-player-osd');
    await sleep(4300); const osdHidden = await d.ev('document.getElementById("osd").className.indexOf("hid")>=0'); out.osdAutoHide = osdHidden;
    await d.shot('32-player-osd-hidden');
    // seek: 3 presses -> +10,+20,+30 ... accumulate
    const pos0 = await d.ev('__spp.player().pos');
    await d.key('right', 3, 80); await sleep(200); await d.shot('33-player-seek-accum');
    await sleep(1500); const pos1 = await d.ev('__spp.player().pos'); out.seek = { pos0, pos1 };
    const seeks = await (await fetch(BASE + '/__log')).json();
    // pause / resume
    await d.key('enter'); await sleep(300); await d.shot('34-player-paused'); await d.key('enter'); await sleep(200);
    // audio menu
    await d.key('up'); await sleep(250); await d.shot('35-player-panel-audio');
    await d.key('down'); await d.key('enter'); await sleep(1800); // switch to english audio
    out.audioAfter = await d.ev('__spp.player().audioIdx');
    // subtitles
    await d.key('up'); await sleep(200); await d.key('down', 3); await d.key('enter'); await sleep(500); await d.shot('36-player-panel-subs');
    await d.key('back'); try { await d.waitFor('document.getElementById("sub").textContent.length>0', 9000); } catch(e){}
    out.subShown = await d.ev('document.getElementById("sub").textContent'); await d.shot('37-player-subtitle');
    // skip intro: fast forward mock time to ~62s
    await d.ev('window.__mockSpeed=8'); await d.waitFor('__spp.player().pos>=56', 20000); await d.ev('window.__mockSpeed=1'); await d.waitFor('__spp.player().pos>=62', 8000); await sleep(300);
    out.skipVisible = await d.ev('!document.querySelector(".skip").classList.contains("hid")'); await d.shot('38-player-skip');
    await d.key('enter'); await sleep(900); out.afterSkipPos = await d.ev('__spp.player().pos');
    // next episode card
    await d.ev('window.__mockSpeed=8'); await d.waitFor('__spp.player().pos>=176', 20000); await d.ev('window.__mockSpeed=1'); await d.waitFor('__spp.player().nextShown', 8000); await sleep(1500);
    await d.shot('39-player-next-card');
    // low memory watchdog
    await d.key('back'); // dismiss card
    await d.ev('window.__availMem=60'); await d.waitFor('__spp.player().low', 8000); await sleep(200); await d.shot('40-player-lowmem');
    await d.ev('delete window.__availMem');
    await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"'); out.backToDetail = await scr(d);
    await sleep(400); await d.shot('41-detail-after');
    const log1 = await (await fetch(BASE + '/__log')).json(); out.progressPosts = log1.filter(l => l.includes('progress')).length;
    // error state
    await fetch(BASE + '/__fail?on=1'); await d.key('play'); await d.waitFor('document.querySelector(".err") && !document.querySelector(".err").classList.contains("hid")', 12000); await sleep(200); await d.shot('42-player-error');
    await fetch(BASE + '/__fail?on=0'); await d.key('back'); await d.waitFor('__spp.nav.name==="detail"');
    step('search');
    await d.key('back'); await d.waitFor('__spp.nav.name==="home"'); await d.key('up', 5); await sleep(200); await d.key('enter'); await d.waitFor('__spp.nav.name==="search"');
    await d.shot('50-search-empty');
    await d.key('enter'); await d.type('naruto'); await sleep(900); await d.key('enter'); await sleep(1500); await d.key('down'); await sleep(1500); await d.shot('51-search-results');
    out.searchNodes = await nodes(d); out.searchImgs = await imgs(d);
    await d.key('down', 2); await sleep(600); await d.shot('52-search-row2');
    await d.key('back'); await d.waitFor('__spp.nav.name==="home"'); await d.key('up', 5); await d.key('right'); await d.key('enter'); await d.waitFor('__spp.nav.name==="settings"'); await sleep(500);
    await d.key('down'); await d.key('enter'); await d.key('down'); await d.key('right'); await d.key('down'); await d.key('enter'); await sleep(400); await d.shot('60-settings');
    await d.key('back'); await d.waitFor('__spp.nav.name==="home"');
    step('memory loop');
    await d.key('up', 5); await d.key('down', 2); await d.key('right', 2); await sleep(500);
    const heap = [], nodeCounts = [];
    for (let i = 0; i < 20; i++) {
      await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"'); await sleep(250);
      await d.key('left', 4); await d.key('right'); await d.key('enter'); await d.waitFor('__spp.nav.name==="streams"'); await d.waitFor('document.querySelectorAll(".sr").length>3'); await sleep(150);
      await d.key('back'); await d.key('back'); await d.waitFor('__spp.nav.name==="home"'); await sleep(250);
      await d.gc(); heap.push(await d.ev('performance.memory.usedJSHeapSize')); nodeCounts.push(await nodes(d));
    }
    out.heapMB = heap.map(h => +(h / 1048576).toFixed(2)); out.nodesLoop = nodeCounts;
    const m = await d.send('Memory.getDOMCounters'); out.domCounters = m;
    step('latency');
    await d.ev('window.__measure=true;__spp.keyStats.length=0');
    for (let i = 0; i < 40; i++) { await d.key('right', 1, 20); } for (let i = 0; i < 40; i++) { await d.key('left', 1, 20); }
    for (let i = 0; i < 6; i++) { await d.key('down', 1, 20); await d.key('up', 1, 20); await d.key('right', 3, 20); await d.key('left', 3, 20); }
    const ks = await d.ev('__spp.keyStats.slice()'); ks.sort((a, b) => a - b);
    out.latencyMs = { n: ks.length, avg: +(ks.reduce((a, b) => a + b, 0) / ks.length).toFixed(2), p95: +ks[Math.floor(ks.length * .95)].toFixed(2), max: +ks[ks.length - 1].toFixed(2) };
    step('connect screen (file://)');
    await d.goto('file://' + require('path').resolve(__dirname, '..') + '/app/index.html'); await d.ev('localStorage.clear()'); await d.goto('file://' + require('path').resolve(__dirname, '..') + '/app/index.html');
    await d.waitFor('__spp.nav.name==="connect"', 15000); await d.shot('70-connect');
    out.consoleLogs = d.logs.slice(0, 20);
  } catch (e) { console.error('FAIL', e); out.fail = String(e); try { await d.shot('99-fail'); } catch (_) {} out.consoleLogs = d.logs.slice(0, 20); }
  console.log(JSON.stringify(out, null, 1));
  await d.close(); process.exit(0);
})();
