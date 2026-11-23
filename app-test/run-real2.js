const { launch, sleep } = require('./cdp');
const B = 'http://localhost:8799';
(async () => {
  const d = await launch(9339); const out = {};
  const nodes = () => d.ev('document.getElementsByTagName("*").length');
  const S = n => d.shot('v2-real-' + n);
  const tap = async (digit, n, gap = 150) => { for (let i = 0; i < n; i++) { await d.key(String(digit).charCodeAt(0), 1, 0); await sleep(gap); } };
  try {
    await d.goto(`${B}/app/index.html`); await d.ev('localStorage.clear()'); await d.goto(`${B}/app/index.html`);
    await d.waitFor('window.__spp && __spp.nav.name==="home" && document.getElementsByTagName("img").length>3', 20000); await sleep(3500);
    out.homeNodes = await nodes(); await S('01-home');
    await d.key('down'); await sleep(2500); await d.key('right', 2); await sleep(2500); await S('02-home-row2');
    out.homeNodes2 = await nodes(); out.homeImgs2 = await d.ev('document.getElementsByTagName("img").length');
    await d.key('left', 8); await d.key('left'); await d.key('down'); await d.key('enter'); await d.waitFor('__spp.nav.name==="search"');
    // naruto via multitap
    await tap(6, 2); await tap(2, 1); await tap(7, 3); await tap(8, 2); await sleep(1000); await tap(8, 1); await tap(6, 3);
    await sleep(1800); out.field = await d.ev('document.querySelector(".sf").textContent');
    await d.waitFor('document.querySelectorAll(".gc").length>2', 15000); await sleep(3000); await S('03-search-naruto');
    // breaking bad
    await d.key(405); for (const [k, n] of [[2, 2], [7, 3], [3, 2], [5, 1], [4, 3], [6, 2], [4, 1]]) { await tap(k, n); } // b r e a k i n g -> check below
    await d.key(405);
    await tap(2, 2); await tap(7, 3); await tap(3, 2); await tap(2, 1); await tap(5, 2); await sleep(1100);
    out.field2 = await d.ev('document.querySelector(".sf").textContent');
    await d.key(405); for (const c of 'breaking bad') { /* via keyboard below */ }
    await d.key('down'); // keyboard (0,0): b is col1
    await d.key('right'); await d.key('enter'); // b
    await d.key('down', 2); await d.key('right', 3); await d.key('left'); await d.key('enter'); // row2 col... (r)  approx
    out.field3 = await d.ev('document.querySelector(".sf").textContent');
    await S('04-keyboard');
    out.logs = d.logs;
  } catch (e) { out.fail = String(e); try { await S('99-fail'); } catch (_) {} }
  console.log(JSON.stringify(out, null, 1)); await d.close(); process.exit(0);
})();
