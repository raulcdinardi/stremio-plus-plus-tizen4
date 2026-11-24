// TV-mode regression screenshots (no SPP_CLIENT): usage: node app-test/tvshots.js <outdir> [port] [cdp]
const { launch, sleep } = require('./cdp');
const fs = require('fs');
const OUT = process.argv[2], PORT = +process.argv[3] || 8836, CDP = +process.argv[4] || 9356;
const BASE = `http://127.0.0.1:${PORT}`, URL0 = `${BASE}/app/index.html?server=${BASE}&mockav=1`;
fs.mkdirSync(OUT, { recursive: true });
const api = (p, body) => fetch(BASE + p, body ? { method: 'POST', body: JSON.stringify(body) } : undefined).then(r => r.json());
(async () => {
  const d = await launch(CDP);
  const S = async n => { const r = await d.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } }); fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, 'base64')); };
  async function boot(ls) {
    await d.goto(URL0); await d.ev(`localStorage.clear(); localStorage.setItem('spp.lang','"pt"'); ${ls || ''}`); await d.goto(URL0);
    await d.waitFor('window.__spp && __spp.nav.name !== "boot"', 15000); await sleep(1800);
  }
  try {
    await api('/__reset'); await api('/__dur?s=2820'); await api('/api/settings', { kbMode: 'grid', ratingInput: 'dpad' });
    await boot(); await S('01-home');
    await d.key('right', 4); await d.key('down'); await sleep(1500); await S('02-home-moved');
    await d.ev('__spp.mount("search",{})'); await sleep(500);
    await d.key('down'); await d.key('right', 2); await d.key('enter'); await d.key('down'); await d.key('enter'); await sleep(1200); await S('03-search-grid');
    await boot(`localStorage.setItem('spp.kbmode','"phone"')`); await d.ev('__spp.mount("search",{})'); await sleep(500);
    await d.key('down'); await d.key(50); await sleep(1300); await d.key(54); await sleep(1300); await S('04-search-phone');
    await boot(); await d.ev('__spp.mount("library",{})'); await sleep(1500); await S('05-library');
    await boot(); await d.ev('__spp.mount("detail",{type:"series",id:"tt0903747",item:{id:"tt0903747",type:"series",name:"Breaking Bad"}})');
    await d.waitFor('document.querySelectorAll(".dbtns .btn").length===4', 8000); await sleep(2000); await S('06-detail');
    await d.key('right', 4); await sleep(300); await d.key('enter'); await sleep(200); await d.key('enter'); await sleep(100); await d.key('enter'); await sleep(900); await S('07-detail-streams');
    await boot(); await d.ev('__spp.mount("detail",{type:"series",id:"tt0903747",item:{id:"tt0903747",type:"series",name:"Breaking Bad"}})');
    await d.waitFor('document.querySelectorAll(".dbtns .btn").length===4', 8000); await sleep(1500);
    await d.key('right', 2); await d.key('enter'); await sleep(300); await S('08-detail-stars'); await d.key('down'); await sleep(500); await S('09-rating-modal');
    await boot(); await d.ev('__spp.mount("settings",{})'); await sleep(900); await S('10-settings'); await d.key('down', 11); await sleep(300); await S('11-settings-scrolled');
    await boot(); await d.ev('window.__mockSpeed=1');
    await d.ev(`__spp.mount("player",{type:"series",itemId:"tt0903747",videoId:"tt0903747:1:3",name:"Breaking Bad",label:"T1 E3",startSec:200})`);
    await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000); await sleep(300);
    await d.key('space'); await sleep(300); await S('12-player-paused');
    await d.key('up'); await d.key('right', 3); await d.key('enter'); await sleep(500); await S('13-player-subs-panel');
    await d.key('enter'); await sleep(600); await S('14-player-subs-panel2');
    await d.key('back'); await sleep(200);
    await d.key('right', 2); await d.key('enter'); await sleep(2500); await S('15-player-sources-panel');
    await api('/__dur?s=300'); await boot(); await d.ev('window.__mockSpeed=8');
    await d.ev('__spp.mount("player",{type:"movie",itemId:"tt0133093",videoId:"tt0133093",name:"Matrix",label:"",startSec:285})');
    await d.waitFor('!!document.querySelector("#modal.r100")', 15000); await sleep(800); await S('16-player-rating');
  } catch (e) { console.log('ERR', e.stack || e); }
  console.log(d.logs.slice(0, 10).join('\n'));
  await d.close(); process.exit(0);
})();
