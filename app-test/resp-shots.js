// Screenshots of the responsive client layout at several viewports.
// usage: node app-test/resp-shots.js <outdir> [port] [cdp] [WxH[:dpr:touch] ...]
const { launch, sleep } = require('./cdp');
const OUT = process.argv[2], PORT = +process.argv[3] || 8836, CDP = +process.argv[4] || 9357;
const VPS = process.argv.slice(5).length ? process.argv.slice(5) : ['1366x768', '1280x800', '1920x1200', '2560x1080', '2400x1080:1:touch', '1100x900'];
const BASE = `http://127.0.0.1:${PORT}`;
const api = (p, body) => fetch(BASE + p, body ? { method: 'POST', body: JSON.stringify(body) } : undefined).then(r => r.json());
(async () => {
  const d = await launch(CDP);
  try {
    for (const spec of VPS) {
      const [wh, dpr, touch] = spec.split(':'); const [w, h] = wh.split('x').map(Number);
      const dir = `${OUT}/${wh}`;
      const URL0 = `${BASE}/app/index.html?client=${touch ? 'android' : 'windows'}&server=${BASE}&mockav=1`;
      await d.viewport(w, h, { touch: !!touch, mobile: !!touch, dpr: +dpr || 1 });
      async function boot(ls) {
        await d.goto(URL0); await d.ev(`localStorage.clear(); localStorage.setItem('spp.lang','"pt"'); ${ls || ''}`); await d.goto(URL0);
        await d.waitFor('window.__spp && __spp.nav.name !== "boot"', 15000); await sleep(1600);
      }
      await api('/__reset'); await api('/__dur?s=2820'); await api('/api/settings', { kbMode: 'grid', ratingInput: 'dpad' });
      const info = async () => d.ev('JSON.stringify({sw:SPP_CLIENT.stageW,sc:SPP_CLIENT.scale,iw:innerWidth,ih:innerHeight})');
      await boot(); console.log(wh, await info());
      await d.shotFile(`${dir}/01-home.png`);
      await d.key('right', 3); await d.key('down'); await sleep(1500); await d.shotFile(`${dir}/01b-home-row2.png`);
      await d.ev(`localStorage.setItem('spp.recent', JSON.stringify(['naruto','breaking bad','matrix']))`);
      await d.ev('__spp.mount("search",{})'); await sleep(500); await d.shotFile(`${dir}/02a-search-empty.png`);
      if (!touch) { await d.press('n', { text: 'n' }); await d.type('aruto'); } else { await d.ev('document.querySelector(".sf input").focus()'); await d.type('naruto'); }
      await sleep(1500); await d.shotFile(`${dir}/02-search-typing.png`);
      if (!touch) { await d.ev('SPP_CLIENT.input="pad"; __spp.modality("pad")'); await sleep(500); await d.shotFile(`${dir}/02b-search-osk.png`); }
      await boot(); await d.ev('__spp.mount("library",{})'); await sleep(1500); await d.shotFile(`${dir}/03-library.png`);
      await boot(); await d.ev('__spp.mount("detail",{type:"series",id:"tt0903747",item:{id:"tt0903747",type:"series",name:"Breaking Bad"}})');
      await d.waitFor('document.querySelectorAll(".dbtns .btn").length===4', 8000); await sleep(2000); await d.shotFile(`${dir}/04-detail.png`);
      const ep = await d.ev('(function(){var r=document.querySelectorAll(".ep")[2].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
      if (touch) await d.tap(ep.x, ep.y); else { await d.mouse('mouseMoved', ep.x, ep.y); await d.mouse('mouseMoved', ep.x + 2, ep.y + 2); await d.shotFile(`${dir}/04a-detail-hover.png`); await d.click(ep.x + 2, ep.y + 2); }
      await sleep(1800); await d.shotFile(`${dir}/04b-detail-sources.png`);
      await boot(); await d.ev('__spp.mount("settings",{})'); await sleep(900); await d.shotFile(`${dir}/05-settings.png`);
      await d.key('down', 5); await sleep(300); await d.shotFile(`${dir}/05b-settings-subs.png`);
      await boot();
      await d.ev(`__spp.mount("player",{type:"series",itemId:"tt0903747",videoId:"tt0903747:1:3",name:"Breaking Bad",label:"T1 E3",startSec:200})`);
      await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000); await sleep(300);
      await d.key('space'); await sleep(300); await d.shotFile(`${dir}/06-player.png`);
      await d.key('up'); await d.key('right', 3); await d.key('enter'); await sleep(500); await d.shotFile(`${dir}/06b-player-subs-panel.png`);
      await d.key('enter'); await sleep(300); await d.key('back'); await sleep(200); await d.key('right', 2); await d.key('enter'); await sleep(2500); await d.shotFile(`${dir}/06c-player-sources-panel.png`);
      await api('/__dur?s=300'); await boot(); await d.ev('window.__mockSpeed=8');
      await d.ev('__spp.mount("player",{type:"movie",itemId:"tt0133093",videoId:"tt0133093",name:"Matrix",label:"",startSec:285})');
      await d.waitFor('!!document.querySelector("#modal.r100")', 15000); await sleep(800); await d.shotFile(`${dir}/07-rating-modal.png`);
      await boot(); await d.ev('__spp.mount("detail",{type:"series",id:"tt0903747",item:{id:"tt0903747",type:"series",name:"Breaking Bad"}})');
      await d.waitFor('document.querySelectorAll(".dbtns .btn").length===4', 8000); await sleep(1200);
      await d.key('right', 2); await d.key('enter'); await sleep(300); await d.shotFile(`${dir}/07b-stars-modal.png`);
    }
  } catch (e) { console.log('ERR', e.stack || e); }
  console.log(d.logs.slice(0, 10).join('\n'));
  await d.close(); process.exit(0);
})();
