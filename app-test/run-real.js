const { launch, sleep } = require('./cdp');
const B = 'http://localhost:8799';
(async () => {
  const d = await launch(9335); const out = {};
  try {
    await d.goto(`${B}/app/index.html`); await d.ev('localStorage.clear()'); await d.goto(`${B}/app/index.html`);
    await d.waitFor('window.__spp && __spp.nav.name==="home" && document.getElementsByTagName("img").length>3', 20000); await sleep(3000);
    out.base = await d.ev('__spp.store.get("server")'); out.homeNodes = await d.ev('document.getElementsByTagName("*").length');
    await d.shot('real-01-home');
    await d.key('down'); await sleep(1500); await d.key('right', 2); await sleep(1500); await d.shot('real-02-home-row2');
    await d.key('up'); await d.key('up'); await d.key('enter'); await d.waitFor('__spp.nav.name==="search"'); await d.key('enter'); await d.type('naruto'); await sleep(800); await d.key('enter');
    await d.waitFor('document.querySelectorAll(".gc").length>2', 15000); await d.key('down'); await sleep(2500); await d.shot('real-03-search');
    await d.key('back'); await d.waitFor('__spp.nav.name==="home"');
    await d.goto(`${B}/app/index.html`); await d.waitFor('__spp.nav.name==="home"'); 
    // open Breaking Bad detail via search
    await d.key('up', 3); await d.key('enter'); await d.waitFor('__spp.nav.name==="search"'); await d.key('enter'); await d.type('breaking bad'); await sleep(800); await d.key('enter');
    await d.waitFor('document.querySelectorAll(".gc").length>0', 15000); await d.key('down'); await sleep(500); await d.key('enter');
    await d.waitFor('__spp.nav.name==="detail"'); await d.waitFor('document.querySelectorAll(".ep").length>0||document.querySelector(".mid")', 15000); await sleep(2500);
    await d.shot('real-04-detail');
    out.detailNodes = await d.ev('document.getElementsByTagName("*").length');
    await d.key('down', 2); await sleep(300); await d.key('down', 2); await sleep(300); await d.shot('real-05-episodes');
    await d.key('enter'); await d.waitFor('__spp.nav.name==="streams"'); await d.waitFor('document.querySelectorAll(".sr").length>3', 40000); await sleep(1500);
    await d.shot('real-06-streams'); await d.key('down'); await d.key('down'); await sleep(300); await d.shot('real-07-streams-focus');
    out.streamsNodes = await d.ev('document.getElementsByTagName("*").length');
    out.logs = d.logs.slice(0, 10);
  } catch (e) { out.fail = String(e); try { await d.shot('real-99-fail'); } catch (_) {} out.logs = d.logs; }
  console.log(JSON.stringify(out, null, 1)); await d.close(); process.exit(0);
})();
