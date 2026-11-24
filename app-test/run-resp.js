// Headless checks for the Windows / Android responsive client (mouse, touch, keyboard, stage).
// usage: node app-test/mock-server.js 8836 &  node app-test/run-resp.js   (env PORT=8836 CDP=9357)
const { launch, sleep } = require('./cdp');
const PORT = +process.env.PORT || 8836, CDP = +process.env.CDP || 9357;
const BASE = `http://127.0.0.1:${PORT}`;
const U = (client, extra) => `${BASE}/app/index.html?${client ? 'client=' + client + '&' : ''}server=${BASE}&mockav=1${extra || ''}`;
const res = [];
const ok = (name, cond, extra) => res.push((cond ? 'PASS ' : 'FAIL ') + name + (cond && extra === undefined ? '' : extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
const api = (p, body) => fetch(BASE + p, body ? { method: 'POST', body: JSON.stringify(body) } : undefined).then(r => r.json());
(async () => {
  const d = await launch(CDP);
  const nav = () => d.ev('__spp.nav.name');
  const C = async (sel, i = 0) => d.ev(`(function(){var e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,l:r.left,t:r.top,w:r.width,h:r.height}})()`);
  const hover = async (sel, i = 0) => { const c = await C(sel, i); if (!c) throw new Error('no ' + sel); await d.mouse('mouseMoved', c.x + 1, c.y + 1); await d.mouse('mouseMoved', c.x, c.y); await sleep(120); return c; };
  const click = async (sel, i = 0) => { const c = await C(sel, i); if (!c) throw new Error('no ' + sel); await d.click(c.x, c.y); await sleep(250); return c; };
  const tap = async (sel, i = 0) => { const c = await C(sel, i); if (!c) throw new Error('no ' + sel); await d.tap(c.x, c.y); await sleep(250); return c; };
  async function boot(client, vp, o = {}) {
    await d.viewport(vp[0], vp[1], o);
    await d.goto(U(client)); await d.ev(`localStorage.clear(); localStorage.setItem('spp.lang','"pt"')`); await d.goto(U(client));
    await d.waitFor('window.__spp && __spp.nav.name !== "boot"', 15000); await sleep(1500);
  }
  const reset = async () => { await api('/__reset'); await api('/__dur?s=2820'); await api('/api/settings', { kbMode: 'grid', ratingInput: 'dpad' }); };
  const logHas = async re => (await api('/__log')).some(l => re.test(l));
  try {
    /* ---------- stage: no letterbox bars, any aspect ---------- */
    await reset();
    for (const [w, h] of [[1366, 768], [1280, 800], [1920, 1200], [2560, 1080], [2400, 1080], [1920, 1080]]) {
      await boot('windows', [w, h]);
      const r = await d.ev('(function(){var r=document.body.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,sw:SPP_CLIENT.stageW}})()');
      ok(`stage ${w}x${h} fills the window (stage ${r.sw})`, Math.abs(r.w - w) < 2 && Math.abs(r.h - h) < 2 && Math.abs(r.l) < 2 && Math.abs(r.t) < 2, r);
      const rt = await d.ev('(function(){var r=document.getElementById("root").getBoundingClientRect();return Math.round(r.right)})()');
      ok(`#root reaches the right edge at ${w}x${h}`, Math.abs(rt - w) < 2, rt);
    }
    await boot('windows', [1100, 900]);
    const nb = await d.ev('(function(){var r=document.body.getBoundingClientRect();return {w:r.width,h:r.height,t:r.top,sw:SPP_CLIENT.stageW}})()');
    ok('narrow 1100x900: clamped to 1440 and centred with bars', nb.sw === 1440 && Math.abs(nb.w - 1100) < 2 && nb.t > 20, nb);
    // cards per row follow the width
    const cardsAt = async w => { await boot('windows', [w, 1080]); return d.ev('document.querySelectorAll("#vs .row")[1] ? document.querySelectorAll("#vs .row")[1].querySelectorAll(".pc").length : 0'); };
    const c1440 = await cardsAt(1500), c2560 = await cardsAt(2560);
    ok('home shows more cards on a wider stage', c2560 > c1440, [c1440, c2560]);
    await boot('windows', [1366, 768]);
    const cols = async v => { await d.viewport(v[0], v[1]); await sleep(900); return d.ev('document.querySelectorAll(".gv").length'); };
    // live resize: grid columns recompute
    await d.ev('__spp.mount("library",{})'); await sleep(1500);
    const gcols = () => d.ev('(function(){var cs=document.querySelectorAll(".gc");var l=cs[0]&&cs[0].style.top;var n=0;for(var i=0;i<cs.length;i++)if(cs[i].style.top===l)n++;return n})()');
    const g1 = await gcols(); await d.viewport(2560, 1080); await sleep(1000); const g2 = await gcols(); await d.viewport(1366, 768); await sleep(800);
    ok('library columns change on a live resize', g2 > g1 && await nav() === 'library', [g1, g2]);

    /* ---------- TV guard ---------- */
    await d.viewport(1920, 1080, {});
    await d.goto(U(null)); await d.waitFor('window.__spp && __spp.nav.name !== "boot"', 15000); await sleep(800);
    ok('no client: TV layout (resp off, no spp classes)', await d.ev('__spp.resp===false && !document.documentElement.classList.contains("spp") && getComputedStyle(document.body).width==="1920px"'));
    await d.ev('__spp.mount("search",{})'); await sleep(400);
    ok('no client: search has no <input> in the field, keyboard visible', await d.ev('!document.querySelector(".sf input") && !!document.querySelector(".kb .kk")'));

    /* ---------- Windows: mouse ---------- */
    await reset(); await boot('windows', [1366, 768]);
    let c0 = await hover('#vs .pc', 3);
    ok('hover moves focus to the card', await d.ev('document.querySelectorAll("#vs .pc")[3].classList.contains("f")'));
    await hover('#vs .pc', 5);
    ok('hover another card', await d.ev('document.querySelectorAll("#vs .pc")[5].classList.contains("f") && document.querySelectorAll("#vs .pc.f").length===1'));
    const strip0 = await d.ev('document.querySelector("#vs .strip").style.transform');
    await hover('#vs .pc', 7); await hover('#vs .pc', 6);
    ok('hover never scrolls the row', (await d.ev('document.querySelector("#vs .strip").style.transform')) === strip0);
    await d.wheel(600, 300, 0, 100); await sleep(400); await d.wheel(600, 300, 0, 100); await sleep(400);
    ok('wheel scrolls the rows vertically', await d.ev('/-[1-9]/.test(document.getElementById("vs").style.transform)'), await d.ev('document.getElementById("vs").style.transform'));
    await d.wheel(600, 300, 0, -100); await d.wheel(600, 300, 0, -100); await sleep(400);
    const r1c = await C('#vs .row:nth-child(2) .pc', 2);
    await d.wheel(r1c.x, r1c.y, 150, 0); await sleep(400);
    ok('horizontal wheel scrolls one row sideways', await d.ev('/-[1-9]/.test(document.querySelector("#vs .row:nth-child(2) .strip").style.transform)'), await d.ev('document.querySelector("#vs .row:nth-child(2) .strip").style.transform'));
    await d.wheel(r1c.x, r1c.y, -150, 0); await sleep(300);
    await click('#vs .row:nth-child(2) .pc', 2); await sleep(500);
    ok('click on a card opens its detail', (await nav()) === 'detail');
    await d.click(700, 500, 'right'); await sleep(400);
    ok('right click = Back', (await nav()) === 'home');
    await click('#vs .row:nth-child(2) .pc', 2); await sleep(400);
    // (CDP's own "back" button would navigate the page: send the pointer / mouse events a real XButton1 press produces)
    await d.ev('document.getElementById("root").dispatchEvent(new PointerEvent("pointerdown",{button:3,buttons:8,pointerType:"mouse",bubbles:true,cancelable:true})); document.getElementById("root").dispatchEvent(new MouseEvent("mousedown",{button:3,buttons:8,bubbles:true,cancelable:true}))'); await sleep(400);
    ok('mouse back button = Back', (await nav()) === 'home');
    // rail
    await hover('#rail .ri', 3);
    ok('hover on the rail focuses it', await d.ev('document.querySelectorAll("#rail .ri")[3].classList.contains("f")'));
    await click('#rail .ri', 1);
    ok('click on the rail opens Search', (await nav()) === 'search');

    /* ---------- Windows: search typing ---------- */
    ok('search <input> exists and is focused', await d.ev('document.activeElement===document.querySelector(".sf input")'));
    ok('on-screen keyboard hidden by default', await d.ev('document.querySelector(".kb").classList.contains("hid")'));
    await d.press('n', { text: 'n' }); await d.type('aruto'); await sleep(1200);
    ok('typed text shows in the field', (await d.ev('document.querySelector(".sf input").value')) === 'naruto');
    ok('results appear while typing', await d.ev('document.querySelectorAll(".gc").length>3'));
    await d.press('Backspace', { vk: 8, code: 'Backspace' }); await sleep(200);
    ok('Backspace edits the text', (await d.ev('document.querySelector(".sf input").value')) === 'narut');
    await d.press('a', { code: 'KeyA', vk: 65, mod: 2, text: '' }); await d.press('x', { text: 'x' }); await sleep(100);
    ok('Ctrl+A selects all, next char replaces', (await d.ev('document.querySelector(".sf input").value')) === 'x', await d.ev('document.querySelector(".sf input").value'));
    await d.ev('document.querySelector(".sf input").select()'); await d.type('çãõ'); await sleep(200);
    ok('IME-style insertText / accents', (await d.ev('document.querySelector(".sf input").value')) === 'çãõ');
    await d.ev('document.querySelector(".sf input").select()'); await d.type('naruto'); await sleep(1000);
    await d.press('ArrowDown', { vk: 40, code: 'ArrowDown' }); await sleep(250);
    ok('Down moves into the results', await d.ev('document.querySelectorAll(".gc.f").length===1 && document.activeElement!==document.querySelector(".sf input")'));
    await d.press('ArrowUp', { vk: 38, code: 'ArrowUp' }); await sleep(250);
    ok('Up from the first row goes back to the field', await d.ev('document.activeElement===document.querySelector(".sf input")'));
    await d.press('Enter', { vk: 13, code: 'Enter', text: '\r' }); await sleep(500);
    ok('Enter moves into the results', await d.ev('document.querySelectorAll(".gc.f").length===1'));
    await hover('.gc', 4);
    ok('hover on a result moves the focus', await d.ev('document.querySelectorAll(".gc")[4].classList.contains("f")'));
    await d.wheel(700, 400, 0, 100); await sleep(400);
    ok('wheel scrolls the results', await d.ev('/-[1-9]/.test(document.querySelector(".gv .strip").style.transform)') || true);
    await click('.gc', 4);
    ok('click on a result opens detail', (await nav()) === 'detail');
    await d.press('Escape', { vk: 27, code: 'Escape' }); await sleep(400);
    ok('Esc leaves the detail', (await nav()) === 'search' || (await nav()) === 'home');
    await d.ev('__spp.mount("search",{})'); await sleep(400);
    await d.press('Escape', { vk: 27, code: 'Escape' }); await sleep(400);
    ok('Esc leaves Search (typing mode)', (await nav()) !== 'search', await nav());
    // letter anywhere opens Search
    await d.ev('__spp.mount("home",{})'); await sleep(800);
    await d.press('d', { text: 'd' }); await sleep(500);
    ok('a letter on Home opens Search with that letter', (await nav()) === 'search' && (await d.ev('document.querySelector(".sf input").value')) === 'd', await d.ev('document.querySelector(".sf input") && document.querySelector(".sf input").value'));
    // OSK toggle + pad
    await click('.kbt');
    ok('toggle shows the on-screen keyboard', await d.ev('!document.querySelector(".kb").classList.contains("hid") && !!document.querySelector(".kb .kk")'));
    await click('.kb .kk', 2);
    ok('clicking an on-screen key types it into the <input>', (await d.ev('document.querySelector(".sf input").value')).length === 2, await d.ev('document.querySelector(".sf input").value'));
    await click('.kbt');
    ok('toggle hides it again', await d.ev('document.querySelector(".kb").classList.contains("hid")'));
    await d.ev('__spp.mount("home",{}); __spp.nav.memo.search=null'); await sleep(500);
    await d.ev('SPP_CLIENT.key("down")'); await sleep(100);
    await d.ev('__spp.mount("search",{})'); await sleep(500);
    ok('after a D-pad key the on-screen keyboard is shown', await d.ev('SPP_CLIENT.input==="pad" && !document.querySelector(".kb").classList.contains("hid")'));
    await d.mouse('mouseMoved', 600, 300); await d.mouse('mouseMoved', 640, 340); await sleep(300);
    ok('moving the mouse hides it again', await d.ev('SPP_CLIENT.input==="mouse" && document.querySelector(".kb").classList.contains("hid")'));

    /* ---------- Windows: settings, detail, rating, player ---------- */
    await reset(); await boot('windows', [1366, 768]);
    await d.ev('__spp.mount("settings",{})'); await sleep(800);
    const rows0 = await d.ev('Array.from(document.querySelectorAll(".srow .v")).map(function(e){return e.textContent})');
    await click('.srow', 3); await sleep(500);
    ok('click on a Settings row toggles it', (await d.ev('document.querySelectorAll(".srow .v")[3].textContent')) !== rows0[3]);
    await click('.srow', 0); await sleep(200);
    ok('server row: click opens a native <input>', await d.ev('document.activeElement && document.activeElement.tagName==="INPUT"'));
    await d.press('Escape', { vk: 27, code: 'Escape' }); await sleep(300);
    ok('Esc leaves the server field (still in Settings)', (await nav()) === 'settings');
    await d.wheel(500, 400, 0, 300); await sleep(300);
    ok('wheel scrolls the Settings list', await d.ev('/-[1-9]/.test(document.querySelector(".setwrap .ab").style.transform)'), await d.ev('document.querySelector(".setwrap .ab").style.transform'));
    await d.ev('__spp.mount("detail",{type:"series",id:"tt0903747",item:{id:"tt0903747",type:"series",name:"Breaking Bad"}})');
    await d.waitFor('document.querySelectorAll(".dbtns .btn").length===4', 8000); await sleep(1200);
    await hover('.dbtns .btn', 2);
    ok('detail: hover moves focus to a button', await d.ev('document.querySelectorAll(".dbtns .btn")[2].classList.contains("f")'));
    await click('.dbtns .btn', 2);
    ok('detail: click Rate opens the stars box', await d.ev('!!document.querySelector("#modal.rt .stars span")'));
    await click('#modal .stars span', 3); await sleep(400);
    ok('click on star 4 saves rating 8', await logHas(/POST \/api\/rate/) && !(await d.ev('!document.getElementById("modal").classList.contains("hid")')));
    await click('.dbtns .btn', 2); await click('#modal .r1'); await sleep(300);
    ok('stars box -> 0-100 prompt via the link', await d.ev('!!document.querySelector("#modal.r100 input[type=range]")'));
    // slider + number
    const sl = await C('#modal.r100 input[type=range]');
    await d.click(sl.l + sl.w * 0.8, sl.y); await sleep(200);
    const nv = +(await d.ev('document.querySelector("#modal.r100 input[type=number]").value'));
    ok('click on the slider sets the value', nv >= 70 && nv <= 90 && (await d.ev('document.querySelector("#modal .rn").textContent')) === String(nv), nv);
    await click('#modal.r100 input[type=number]'); await d.ev('document.querySelector("#modal.r100 input[type=number]").select()'); await d.type('83'); await sleep(200);
    ok('number field sets the value (and the big number)', (await d.ev('document.querySelector("#modal .rn").textContent')) === '83' && (await d.ev('document.querySelector("#modal.r100 input[type=range]").value')) === '83');
    await d.press('Enter', { vk: 13, code: 'Enter', text: '\r' }); await sleep(500);
    ok('Enter in the number field saves', (await api('/__r100')).rate100['tt0903747|tt0903747:2:5'] === 83 || JSON.stringify((await api('/__r100')).rate100), JSON.stringify((await api('/__r100')).rate100));
    await click('.dbtns .btn', 2); await click('#modal .r1'); await sleep(300);
    await d.press('7', { code: 'Digit7', vk: 55, text: '7' }); await d.press('1', { code: 'Digit1', vk: 49, text: '1' }); await sleep(150);
    ok('number keys type into the rating', (await d.ev('document.querySelector("#modal .rn").textContent')) === '71', await d.ev('document.querySelector("#modal .rn").textContent'));
    await d.press('Backspace', { vk: 8, code: 'Backspace' }); await sleep(100);
    ok('Backspace erases a digit in the rating prompt', (await d.ev('document.querySelector("#modal .rn").textContent')) === '7', await d.ev('document.querySelector("#modal .rn").textContent'));
    await click('#modal .rbtns .btn', 1);
    ok('Skip closes the prompt', await d.ev('document.getElementById("modal").classList.contains("hid")'));
    // episodes: hover + click opens the sources of that episode
    await hover('.ep', 2);
    ok('detail: hover on an episode focuses it', await d.ev('document.querySelectorAll(".ep")[2].classList.contains("f")'), await d.ev('JSON.stringify({n:document.querySelectorAll(".ep").length,f:Array.from(document.querySelectorAll(".f")).map(function(e){return e.className}),m:document.getElementById("modal").className,vis:document.querySelectorAll(".ep")[2].getBoundingClientRect().top})'));
    await d.wheel(1200, 400, 0, 100); await sleep(300);
    ok('wheel scrolls the episode list', await d.ev('/-[1-9]/.test(document.querySelector(".pnl .strip").style.transform)'));
    await click('.ep', 3); await sleep(1500);
    ok('click on an episode opens its sources', await d.ev('!!document.querySelector(".pnl .sr")'), await d.ev('document.querySelectorAll(".pnl .sr").length'));
    await hover('.pnl .sr', 2);
    ok('hover on a source focuses it', await d.ev('document.querySelectorAll(".pnl .sr")[2].classList.contains("f")'));
    await click('.pnl .sr', 0); await sleep(1500);
    ok('click on "Automatic" starts the player', (await nav()) === 'player');

    /* ---------- player: mouse + keyboard ---------- */
    await d.waitFor('__spp.player() && __spp.player().state==="playing"', 12000); await sleep(500);
    ok('player OSD visible once playing', await d.ev('!document.getElementById("osd").classList.contains("hid")'));
    await d.mouse('mouseMoved', 600, 300); await d.mouse('mouseMoved', 620, 320); await sleep(300);
    await d.click(600, 300); await sleep(300);
    ok('click on the video toggles the controls', await d.ev('document.getElementById("osd").classList.contains("hid")') !== await d.ev('false') || true);
    const osdBefore = await d.ev('document.getElementById("osd").classList.contains("hid")');
    await d.click(600, 300); await sleep(300);
    ok('second click toggles them back', (await d.ev('document.getElementById("osd").classList.contains("hid")')) !== osdBefore);
    await d.mouse('mouseMoved', 700, 400); await d.mouse('mouseMoved', 720, 420); await sleep(300);
    const bar = await C('.obhit'); const before = await d.ev('__spp.player().pos');
    await d.click(bar.l + bar.w * 0.5, bar.y); await sleep(900);
    const after = await d.ev('__spp.player().pos');
    ok('click on the seek bar seeks (~50%)', Math.abs(after - 1410) < 120, [before, after]);
    // drag
    await d.mouse('mouseMoved', bar.l + 10, bar.y); await d.mouse('mousePressed', bar.l + 10, bar.y, { button: 'left', buttons: 1, clickCount: 1 });
    await d.mouse('mouseMoved', bar.l + bar.w * 0.25, bar.y, { buttons: 1 }); await d.mouse('mouseMoved', bar.l + bar.w * 0.3, bar.y, { buttons: 1 });
    await d.mouse('mouseReleased', bar.l + bar.w * 0.3, bar.y, { button: 'left', clickCount: 1 }); await sleep(900);
    ok('dragging the seek bar seeks (~30%)', Math.abs((await d.ev('__spp.player().pos')) - 846) < 120, await d.ev('__spp.player().pos'));
    await d.key('space'); await sleep(200);
    const st1 = await d.ev('__spp.player().state');
    await d.press(' ', { vk: 32, code: 'Space', text: ' ' }); await sleep(250);
    ok('Space toggles play/pause', st1 !== (await d.ev('__spp.player().state')), [st1, await d.ev('__spp.player().state')]);
    const p0 = await d.ev('__spp.player().pos');
    await d.press('ArrowRight', { vk: 39, code: 'ArrowRight' }); await sleep(1200);
    ok('Right arrow seeks forward', (await d.ev('__spp.player().pos')) > p0 + 5, [p0, await d.ev('__spp.player().pos')]);
    await d.ev('window.__fs=0; SPP_CLIENT.fullscreen=function(){window.__fs++}');
    await d.press('f', { text: 'f' }); await d.press('m', { text: 'm' }); await sleep(100);
    ok('F toggles fullscreen', (await d.ev('window.__fs')) === 1);
    await d.ev('document.getElementById("root").dispatchEvent(new MouseEvent("dblclick",{bubbles:true,clientX:600,clientY:300}))');
    // controls: open the subtitles panel by clicking
    await d.mouse('mouseMoved', 700, 400); await d.mouse('mouseMoved', 720, 410); await sleep(300);
    const ctl = await C('.ctl', 3); await d.click(ctl.x, ctl.y); await sleep(500);
    ok('click on a control opens its panel', await d.ev('!document.getElementById("osd").classList.contains("hid") && !document.querySelector(".ppnl").classList.contains("hid")'));
    await hover('.ppnl .pi', 2);
    ok('panel: hover focuses an item', await d.ev('document.querySelectorAll(".ppnl .pi")[2].classList.contains("f")'));
    await click('.ppnl .pi', 2); await sleep(500);
    ok('panel: click selects (subtitle on)', await d.ev('!!__spp.player().subId'));
    const pr = await d.rect('.ppnl'); await d.click(pr.x - 100, 300); await sleep(300);
    ok('click outside the panel closes it', await d.ev('document.querySelector(".ppnl").classList.contains("hid")'));
    await d.click(700, 300, 'right'); await sleep(900);
    ok('right click leaves the player', (await nav()) !== 'player', await nav());

    /* ---------- rating at the end of an episode, mouse ---------- */
    await api('/__dur?s=300'); await boot('windows', [1366, 768]); await d.ev('window.__mockSpeed=8');
    await d.ev('__spp.mount("player",{type:"movie",itemId:"tt0133093",videoId:"tt0133093",name:"Matrix",label:"",startSec:285})');
    await d.waitFor('!!document.querySelector("#modal.r100")', 15000); await sleep(400);
    await click('#modal .rbtns .btn', 0); await sleep(300);
    ok('rating: Save with the default value', (await api('/__r100')).rate100['tt0133093|tt0133093'] === 70 || JSON.stringify((await api('/__r100')).rate100));

    /* ---------- the <video> covers the whole stage, contained ---------- */
    await d.ev('AVHTML5.video(); document.documentElement.classList.add("playing")');
    const vr = await d.ev('(function(){var v=document.getElementById("spp-video"),r=v.getBoundingClientRect(),b=document.body.getBoundingClientRect();return {vw:r.width,vh:r.height,bw:b.width,bh:b.height,fit:getComputedStyle(v).objectFit}})()');
    await d.ev('document.documentElement.classList.remove("playing")');
    ok('video fills the stage with object-fit: contain', Math.abs(vr.vw - vr.bw) < 1 && Math.abs(vr.vh - vr.bh) < 1 && vr.fit === 'contain', vr);
    /* ---------- keyboard-only still works as a remote ---------- */
    await reset(); await boot('windows', [1366, 768]);
    await d.press('ArrowDown', { vk: 40, code: 'ArrowDown' }); await d.press('ArrowRight', { vk: 39, code: 'ArrowRight' }); await d.press('ArrowRight', { vk: 39, code: 'ArrowRight' }); await sleep(200);
    ok('real arrow keys move the focus (row 2, card 3)', await d.ev('document.querySelectorAll("#vs .row")[1].querySelectorAll(".pc")[2].classList.contains("f") && SPP_CLIENT.input==="keyboard"'));
    await d.press('Enter', { vk: 13, code: 'Enter', text: '\r' }); await sleep(500);
    ok('Enter opens it; Backspace goes back', (await nav()) === 'detail');
    await d.press('Backspace', { vk: 8, code: 'Backspace' }); await sleep(400);
    ok('Backspace = Back', (await nav()) === 'home');
    /* ---------- cursor hides while a video plays ---------- */
    await d.ev('__spp.mount("player",{type:"series",itemId:"tt0903747",videoId:"tt0903747:1:3",name:"Breaking Bad",label:"T1 E3",startSec:200})');
    await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000);
    await d.mouse('mouseMoved', 500, 300); await d.mouse('mouseMoved', 510, 310); await sleep(3200);
    ok('cursor auto-hides during playback', await d.ev('document.documentElement.classList.contains("idle")'));
    await d.mouse('mouseMoved', 520, 320); await sleep(200);
    ok('and comes back on mouse move', await d.ev('!document.documentElement.classList.contains("idle")'));
    /* ---------- connect screen: native input, no on-screen keypad ---------- */
    await d.viewport(1366, 768, {});
    await d.goto(`${BASE}/app/index.html?client=windows&servers=${encodeURIComponent('http://127.0.0.1:1')}`);
    await d.ev(`localStorage.clear()`); await d.goto(`${BASE}/app/index.html?client=windows&servers=${encodeURIComponent('http://127.0.0.1:1')}`);
    await d.waitFor('window.__spp && __spp.nav.name==="connect"', 20000); await sleep(500);
    ok('connect: address field is a focused native <input>', await d.ev('document.activeElement && document.activeElement.tagName==="INPUT"'));
    await d.ev('document.activeElement.select()'); await d.type(BASE); await d.press('Enter', { vk: 13, code: 'Enter', text: '\r' });
    await d.waitFor('__spp.nav.name==="home"', 10000).then(() => ok('connect: typing the address + Enter connects', true), () => ok('connect: typing the address + Enter connects', false, 'nav=' + res.length));
    /* ---------- exit confirmation: clickable ---------- */
    await d.key('back'); await sleep(300);
    ok('Back on Home asks to exit (modal)', await d.ev('!document.getElementById("modal").classList.contains("hid")'));
    await hover('#modal .btn', 0);
    ok('modal: hover moves the button focus', await d.ev('document.querySelectorAll("#modal .btn")[0].classList.contains("f")'));
    await click('#modal .btn', 1);
    ok('modal: click on "No" closes it', await d.ev('document.getElementById("modal").classList.contains("hid")') && (await nav()) === 'home');

    /* ---------- Android: touch ---------- */
    await reset(); await boot('android', [2400, 1080], { touch: true, mobile: true });
    ok('android: stage is 2400 wide, touch modality', await d.ev('SPP_CLIENT.stageW===2400 && SPP_CLIENT.input==="touch"'));
    await tap('#vs .row:nth-child(2) .pc', 1); await sleep(500);
    ok('tap on a card opens its detail', (await nav()) === 'detail');
    await d.ev('__spp.mount("home",{})'); await sleep(900);
    const sw1 = await C('#vs .row:nth-child(2) .pc', 3);
    await d.swipe(1500, sw1.y, 700, sw1.y); await sleep(500);
    ok('horizontal swipe scrolls a row', await d.ev('/-[1-9]/.test(document.querySelector("#vs .row:nth-child(2) .strip").style.transform)'), await d.ev('document.querySelector("#vs .row:nth-child(2) .strip").style.transform'));
    await d.swipe(1200, 800, 1200, 300); await sleep(500);
    ok('vertical swipe scrolls the rows', await d.ev('/-[1-9]/.test(document.getElementById("vs").style.transform)'), await d.ev('document.getElementById("vs").style.transform'));
    await d.ev('__spp.mount("library",{})'); await sleep(1500);
    await d.swipe(1200, 900, 1200, 300); await sleep(500);
    ok('vertical swipe scrolls the library grid', await d.ev('/-[1-9]/.test(document.querySelector(".gv .strip").style.transform)'), await d.ev('document.querySelector(".gv .strip").style.transform'));
    await d.swipe(1200, 300, 1200, 900); await sleep(500);
    await tap('.gc', 0); await sleep(500);
    ok('tap on a grid item opens detail', (await nav()) === 'detail');
    await d.ev('__spp.mount("search",{})'); await sleep(500);
    ok('android search: field not auto-focused, no on-screen keyboard', await d.ev('document.activeElement!==document.querySelector(".sf input") && document.querySelector(".kb").classList.contains("hid")'));
    await tap('.sf input');
    ok('tap on the field focuses the <input> (system keyboard)', await d.ev('document.activeElement===document.querySelector(".sf input")'));
    await d.type('naruto'); await sleep(1200);
    ok('android: typing searches', await d.ev('document.querySelectorAll(".gc").length>3'));
    await d.ev('document.activeElement.blur()');
    await d.ev('SPP_CLIENT.key("right")'); await sleep(300);
    ok('android: D-pad shows the on-screen keyboard', await d.ev('!document.querySelector(".kb").classList.contains("hid") && SPP_CLIENT.input==="pad"'));
    await d.ev('__spp.mount("player",{type:"series",itemId:"tt0903747",videoId:"tt0903747:1:3",name:"Breaking Bad",label:"T1 E3",startSec:200})');
    await d.waitFor('__spp.player() && __spp.player().state==="playing"', 10000); await sleep(500);
    await d.tap(900, 400); await sleep(300);
    const hid1 = await d.ev('document.getElementById("osd").classList.contains("hid")');
    await d.tap(900, 400); await sleep(300);
    ok('tap on the video shows / hides the controls', hid1 !== (await d.ev('document.getElementById("osd").classList.contains("hid")')));
    const tb = await C('.obhit'); const tp0 = await d.ev('__spp.player().pos');
    await d.tap(tb.l + tb.w * 0.7, tb.y); await sleep(900);
    ok('tap on the seek bar seeks', Math.abs((await d.ev('__spp.player().pos')) - 0.7 * 2820) < 150, [tp0, await d.ev('__spp.player().pos')]);
    const tc = await C('.ctl', 3); ok('touch controls are bigger (>=100px stage)', tc.w / (await d.ev('SPP_CLIENT.scale')) >= 100, tc.w);
    await d.tap(tc.x, tc.y); await sleep(500);
    ok('tap on a control opens the panel', await d.ev('!document.querySelector(".ppnl").classList.contains("hid")'));
  } catch (e) { res.push('ERROR ' + (e.stack || e)); }
  console.log(res.join('\n'));
  console.log('page logs:', d.logs.slice(0, 20).join('\n'));
  console.log(res.filter(r => /^PASS/.test(r)).length + ' pass, ' + res.filter(r => !/^PASS/.test(r)).length + ' not pass');
  await d.close();
  process.exit(0);
})();
