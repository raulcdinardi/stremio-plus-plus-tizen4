// Headless UI checks for the search keyboard modes (grid/phone), the 0-100 rating prompt and the new Settings rows.
// usage: node app-test/mock-server.js 8830 &  node app-test/run-a.js   (env PORT=8830 CDP=9350)
const { launch, sleep } = require('./cdp');
const PORT = +process.env.PORT || 8830, CDP = +process.env.CDP || 9350;
const BASE = `http://127.0.0.1:${PORT}`;
const URL0 = `${BASE}/app/index.html?server=${BASE}&mockav=1`;
const res = [];
function ok(name, cond, extra) { res.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
const api = (p, body) => fetch(BASE + p, body ? { method: 'POST', body: JSON.stringify(body) } : undefined).then(r => r.json());
const GK = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];

(async () => {
  const d = await launch(CDP);
  const S = n => d.shot('a-' + n);
  async function boot(lang, ls) {
    await d.goto(URL0);
    await d.ev(`localStorage.clear(); localStorage.setItem('spp.lang', '"${lang}"'); ${ls || ''}`);
    await d.goto(URL0);
    await d.waitFor('window.__spp && __spp.nav.name !== "boot"', 15000);
    await sleep(300);
  }
  const field = () => d.ev('document.querySelector(".sf").textContent');
  const modalOpen = () => d.ev('!document.getElementById("modal").classList.contains("hid")');
  const modalNum = () => d.ev('(document.querySelector("#modal .rn")||{}).textContent');
  try {
    for (const L of ['pt', 'en']) {
      await api('/__reset'); await api('/__dur?s=300');
      /* ---------------- search: grid mode (repo default) ---------------- */
      await boot(L);
      await d.ev('__spp.mount("search", {})'); await sleep(300);
      ok(L + ' grid is default', await d.ev('!!document.querySelector(".kb.gk")'));
      await S(L + '-search-grid-empty');
      await d.key('down'); // field -> key 'a'
      let r = 0, c = 0;
      for (const ch of 'naruto') {
        const tr = GK.findIndex(x => x.includes(ch)), tc = GK[tr].indexOf(ch);
        await d.key(tr > r ? 'down' : 'up', Math.abs(tr - r)); await d.key(tc > c ? 'right' : 'left', Math.abs(tc - c));
        r = tr; c = tc; await d.key('enter');
      }
      ok(L + ' grid typed naruto', (await field()) === 'naruto', await field());
      await d.key(55); // remote number key 7 types a digit in grid mode
      ok(L + ' number key types digit in grid', (await field()) === 'naruto7', await field());
      await d.key('down', 6 - r); await d.key('left', 5); // bottom row: space(0-1) del(2) clr(3) kb(4-5)
      await d.key('right', 2); await d.key('enter'); // del
      ok(L + ' grid delete', (await field()) === 'naruto', await field());
      await d.waitFor('document.querySelectorAll(".gc").length>1', 8000); await sleep(1200);
      await d.key('right', 2); await sleep(200);
      ok(L + ' focus on mode key', await d.ev('document.querySelector(".kk.f") && document.querySelector(".kk.f").classList.contains("kb")'));
      await S(L + '-search-grid-results');
      await d.key('enter'); await sleep(200);
      ok(L + ' switched to phone at runtime', await d.ev('!document.querySelector(".kb.gk") && localStorage.getItem("spp.kbmode")===\'"phone"\''));
      ok(L + ' phone focus on A-Z key', await d.ev('document.querySelector(".kk.f") === document.querySelectorAll(".kk")[13]'));
      await S(L + '-search-phone-results');
      await d.key(50); await sleep(100); await d.key(50); await sleep(1100); // multitap 2,2 -> b
      ok(L + ' phone multitap still works', (await field()) === 'narutob', await field());
      await d.key('left'); await d.key('enter'); await sleep(100); await d.key(50); // 123 mode then 2 -> digit
      ok(L + ' phone numbers mode', (await field()) === 'narutob2', await field());
      await d.key('enter'); await d.key('right'); await d.key('enter'); await sleep(200); // back to letters, then A-Z -> grid
      ok(L + ' switched back to grid', await d.ev('!!document.querySelector(".kb.gk")'));
      await d.ev('__spp.mount("home", {})'); await sleep(200); await d.ev('__spp.mount("search", {})'); await sleep(300);
      ok(L + ' runtime choice remembered', await d.ev('!!document.querySelector(".kb.gk")'));
      // server default 'phone' (owner install)
      await api('/api/settings', { kbMode: 'phone' });
      await boot(L); await d.ev('__spp.mount("search", {})'); await sleep(300);
      ok(L + ' server kbMode phone', await d.ev('!document.querySelector(".kb.gk") && document.querySelectorAll(".kk").length===14'));
      await d.key('down'); await S(L + '-search-phone-default');
      await api('/api/settings', { kbMode: 'grid' });

      /* ---------------- rating: up-next card, dpad ---------------- */
      await boot(L);
      await d.ev(`__spp.mount("player", { type: "series", itemId: "tt0903747", videoId: "tt0903747:1:3", name: "Breaking Bad", label: "${L === 'en' ? 'S1 E3' : 'T1 E3'}", startSec: 200 })`);
      await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000);
      await d.waitFor('!document.getElementById("modal").classList.contains("hid")', 5000);
      ok(L + ' modal with up-next card', await d.ev('!document.querySelector(".nx").classList.contains("hid") && !!document.querySelector("#modal.r100")'));
      ok(L + ' dpad default 70', (await modalNum()) === '70', await modalNum());
      await sleep(1200); await S(L + '-rate-upnext-dpad');
      await d.key('right', 3); await d.key('up'); await d.key('down', 2); await d.key('up');
      ok(L + ' dpad +3 +10 -20 +10 = 73', (await modalNum()) === '73', await modalNum());
      await sleep(1500);
      ok(L + ' countdown waits while rating', await d.ev('/nota|rate/i.test(document.querySelector("#modal .rnote").textContent)'), await d.ev('document.querySelector("#modal .rnote").textContent'));
      await d.key('enter'); await sleep(800);
      ok(L + ' saved & next episode started', await d.ev('__spp.nav.name==="player" && __spp.nav.params.videoId==="tt0903747:1:4"'), await d.ev('__spp.nav.params.videoId'));
      ok(L + ' server got 73', (await api('/__r100')).rate100['tt0903747|tt0903747:1:3'] === 73);
      await S(L + '-rate-saved-toast');
      // untouched prompt: countdown still auto-plays the next episode
      await d.ev(`__spp.mount("player", { type: "series", itemId: "tt0903747", videoId: "tt0903747:1:5", name: "Breaking Bad", label: "E5", startSec: 200 })`);
      await d.waitFor('!!document.querySelector("#modal.r100")', 8000);
      await d.waitFor('__spp.nav.params.videoId==="tt0903747:1:6"', 14000).then(() => ok(L + ' untouched -> auto-play continues', true), () => ok(L + ' untouched -> auto-play continues', false));
      ok(L + ' modal closed after auto-play', !(await modalOpen()));
      // back skips; card stays
      await d.ev(`__spp.mount("player", { type: "series", itemId: "tt0903747", videoId: "tt0903747:2:1", name: "Breaking Bad", label: "E1", startSec: 200 })`);
      await d.waitFor('!!document.querySelector("#modal.r100")', 8000);
      await d.key('back'); await sleep(200);
      ok(L + ' back skips rating, card stays', !(await modalOpen()) && await d.ev('!document.querySelector(".nx").classList.contains("hid")'));

      /* ---------------- rating: movie end, digits ---------------- */
      await api('/api/settings', { ratingInput: 'digits' });
      await boot(L);
      await d.ev('window.__mockSpeed = 8');
      await d.ev('__spp.mount("player", { type: "movie", itemId: "tt0133093", videoId: "tt0133093", name: "Matrix", label: "", startSec: 285 })');
      await d.waitFor('!!document.querySelector("#modal.r100")', 15000);
      ok(L + ' movie end -> prompt', await d.ev('__spp.nav.name==="player"'));
      ok(L + ' digits empty', (await modalNum()) === '–', await modalNum());
      await d.key(56); await d.key(53); // 8 5
      ok(L + ' digits typed 85', (await modalNum()) === '85', await modalNum());
      await sleep(200); await S(L + '-rate-movie-digits');
      await d.key(57); ok(L + ' third digit restarts (850>100)', (await modalNum()) === '9', await modalNum());
      await d.key(55); await d.key('right'); ok(L + ' dpad works in digits mode', (await modalNum()) === '98', await modalNum());
      await d.key('enter'); await sleep(500);
      ok(L + ' movie saved & exited', (await api('/__r100')).rate100['tt0133093|tt0133093'] === 98 && await d.ev('__spp.nav.name!=="player"'));
      await d.ev('window.__mockSpeed = 1');
      /* back past 90% with the server lacking /api/rate100 */
      await api('/__r100?off=1');
      await d.ev('__spp.mount("player", { type: "movie", itemId: "tt0816692", videoId: "tt0816692", name: "Interstellar", label: "", startSec: 280 })');
      await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000); await sleep(300);
      await d.key('back'); await sleep(200);
      ok(L + ' back past 90% -> prompt', await d.ev('!!document.querySelector("#modal.r100")'));
      await d.key(54); await d.key(48); await d.key('enter'); await sleep(500);
      ok(L + ' 404 -> kept locally', await d.ev('JSON.parse(localStorage.getItem("spp.r100q")||"[]").length===1 && localStorage.getItem("spp.r100:tt0816692|tt0816692")==="60"'));
      ok(L + ' 404 toast', await d.ev('!document.querySelector(".gtoast").classList.contains("hid")'), await d.ev('document.querySelector(".gtoast").textContent'));
      await S(L + '-rate-404-toast');
      await api('/__r100?off=0');
      /* ratePrompt off */
      await api('/api/settings', { ratePrompt: false, ratingInput: 'dpad' });
      await boot(L);
      await d.ev('__spp.mount("player", { type: "movie", itemId: "tt0133093", videoId: "tt0133093", name: "Matrix", label: "", startSec: 285 })');
      await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000); await sleep(300);
      await d.key('back'); await sleep(300);
      ok(L + ' ratePrompt off -> no prompt', !(await modalOpen()) && await d.ev('__spp.nav.name!=="player"'));
      await api('/api/settings', { ratePrompt: true });

      /* ---------------- detail: stars modal -> 0-100 ---------------- */
      await boot(L);
      await d.ev('__spp.mount("detail", { type: "series", id: "tt0903747", item: { id: "tt0903747", type: "series", name: "Breaking Bad" } })');
      await d.waitFor('document.querySelectorAll(".dbtns .btn").length===4', 8000); await sleep(1200);
      await d.key('right', 2); await d.key('enter'); await sleep(200); await S(L + '-detail-stars');
      await d.key('down'); await sleep(300);
      ok(L + ' detail -> 0-100 prompt', await d.ev('!!document.querySelector("#modal.r100")'));
      await S(L + '-detail-r100');
      await d.key('back'); ok(L + ' detail prompt closes', !(await modalOpen()));

      /* ---------------- settings rows ---------------- */
      await d.ev('__spp.mount("settings", {})'); await sleep(600);
      await S(L + '-settings-top');
      await d.key('down', 8); await sleep(100);
      const v8 = await d.ev('document.querySelector(".srow.f .v").textContent');
      await d.key('right'); await sleep(300);
      ok(L + ' kbMode row toggles & saves', (await api('/api/settings')).kbMode === 'phone', [v8]);
      await d.key('down'); await d.key('right'); await d.key('down'); await d.key('right'); await sleep(300);
      const st = await api('/api/settings');
      ok(L + ' ratingInput/ratePrompt rows save', st.ratingInput === 'digits' && st.ratePrompt === false, st);
      await d.key('down', 2); await sleep(150); await S(L + '-settings-scrolled');
      await api('/api/settings', { kbMode: 'grid', ratingInput: 'dpad', ratePrompt: true });
    }
  } catch (e) { res.push('ERROR ' + (e.stack || e)); }
  console.log(res.join('\n'));
  console.log('page logs:', d.logs.slice(0, 20).join('\n'));
  await d.close();
  process.exit(0);
})();
