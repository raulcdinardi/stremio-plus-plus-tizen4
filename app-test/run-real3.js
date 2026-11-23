const { launch, sleep } = require('./cdp');
const B = process.env.B || 'http://localhost:8799'; const PF = process.env.PFX || 'v2-real-';
(async () => {
  const d = await launch(9339); const out = {};
  const nodes = () => d.ev('document.getElementsByTagName("*").length');
  const S = n => d.shot(PF + n);
  const tap = async (digit, n, gap = 140) => { for (let i = 0; i < n; i++) { await d.key(String(digit).charCodeAt(0), 1, 0); await sleep(gap); } };
  try {
    await d.goto(`${B}/app/index.html`); await d.ev('localStorage.clear()'); await d.goto(`${B}/app/index.html`);
    await d.waitFor('window.__spp && __spp.nav.name==="home"', 20000); await sleep(1500);
    await d.key('left'); await d.key('down'); await d.key('enter'); await d.waitFor('__spp.nav.name==="search"');
    for (const [k, n] of [[2, 2], [7, 3], [3, 2], [2, 1], [5, 2], [4, 3], [6, 2], [4, 1]]) await tap(k, n);
    await d.key(404); await tap(2, 2); await sleep(1000); await tap(2, 1); await tap(3, 1); await sleep(1500);
    out.field = await d.ev('document.querySelector(".sf").textContent');
    await d.waitFor('document.querySelectorAll(".gc").length>0', 15000); await sleep(2500);
    await d.key('down'); await d.key('right', 6); await sleep(300); await S('05-search-bb');
    await d.key('enter'); await d.waitFor('__spp.nav.name==="detail"', 15000); await sleep(3500);
    out.name = await d.ev('document.querySelector(".dtitle").textContent'); await S('06-detail');
    out.detailNodes = await nodes(); out.detailImgs = await d.ev('document.getElementsByTagName("img").length');
    out.thumbs = await d.ev('JSON.stringify([].slice.call(document.querySelectorAll(".ep .th img")).map(function(i){return [i.complete,i.naturalWidth,i.style.display]}))');
    await d.key('right', 5); await sleep(500); await S('07-detail-eps');
    await d.key('enter'); await d.waitFor('document.querySelectorAll(".sr").length>2', 40000); await sleep(800); await S('08-detail-streams');
    await d.key('down', 3); await sleep(300); await S('09-streams-focus');
    out.streamNodes = await nodes();
    await d.key('back'); await sleep(300); await d.key('up', 8); await d.key('right'); await sleep(600); await S('10-season2');
    await d.key('left', 6); await d.key('left'); await d.key('up', 3); await d.key('enter'); await d.waitFor('__spp.nav.name==="home"'); await sleep(500);
    await d.key('left'); await d.key('down', 2); await d.key('enter'); await d.waitFor('__spp.nav.name==="library"'); await sleep(3500); await S('11-library');
    out.libNodes = await nodes();
    await d.key('left'); await d.key('down'); await d.key('enter'); await d.waitFor('__spp.nav.name==="settings"'); await sleep(800); await S('12-settings');
    out.logs = d.logs;
  } catch (e) { out.fail = String(e); try { await S('99-fail'); } catch (_) {} out.logs = d.logs; }
  console.log(JSON.stringify(out, null, 1)); await d.close(); process.exit(0);
})();
