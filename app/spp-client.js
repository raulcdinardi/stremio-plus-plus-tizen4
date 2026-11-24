/* Shell for the non-Tizen clients (Windows / Android / desktop browser). On the TV (webapis.avplay present) this
   file does nothing. Plain ES2017.
   Config comes from window.SPP_CLIENT (set by the wrapper before this script) and/or the page URL:
   ?client=windows|android &servers=<url>,<url> &saver=0|1 &codecs=h264,hevc
   - client set (windows / android): "responsive" mode. The logical stage is 1080 high and as wide as the window
     (width = 1080 * aspect, clamped to 1440..2560; beyond that it is centred with bars), the input modality
     (keyboard / mouse / touch / pad) is tracked live and mouse / touch / wheel go to the app through __spp.pointer.
   - client absent (a plain browser): the TV layout, a fixed 1920x1080 stage letterboxed into the window.
   Native wrappers send keys with SPP_CLIENT.key('back'|'enter'|...) (window.SPP belongs to spp-party.js). */
(function () {
  'use strict';
  if (window.webapis && window.webapis.avplay) return;

  var q = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (p) {
    if (!p) return; var i = p.indexOf('=');
    try { q[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = i < 0 ? '' : decodeURIComponent(p.slice(i + 1)); } catch (e) {}
  });
  var C = window.SPP_CLIENT = window.SPP_CLIENT || {};
  if (!C.client) C.client = C.platform || q.client || (window.SPP_NATIVE && window.SPP_NATIVE.platform) || '';
  if (C.client && !C.platform) C.platform = C.client;
  if (q.servers && !C.servers) C.servers = q.servers.split(',').filter(Boolean);
  if (q.saver != null && C.saverDefault == null) C.saverDefault = q.saver === '1';
  if (q.codecs && !C.codecs) C.codecs = q.codecs.split(',').filter(Boolean);
  if (C.saverDefault == null) C.saverDefault = false;
  if (!C.exit) C.exit = function () { // wrappers expose SPP_NATIVE (Electron) or AndroidSPP (WebView)
    if (window.SPP_NATIVE) window.SPP_NATIVE.exit(); else if (window.AndroidSPP) window.AndroidSPP.exit(); else window.close();
  };
  var RESP = !!C.client;
  var root = document.documentElement;
  if (RESP) { root.classList.add('spp'); root.classList.add('spp-' + C.client); }

  /* ---- stage: scale of the logical stage into the window ---- */
  var meta = document.querySelector('meta[name=viewport]');
  if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  var st = document.createElement('style');
  st.textContent = 'html{background:#000!important;overflow:hidden!important;width:100%!important;height:100%!important}' +
    'body{position:absolute!important;left:0;top:0;transform-origin:0 0;overflow:hidden!important;touch-action:none;-webkit-user-select:none;user-select:none}' +
    'html.playing,html.playing body{background:#000!important}html.playing #root{background:transparent}' +
    '#av-player{display:none!important}input{-webkit-user-select:text;user-select:text}';
  document.head.appendChild(st);
  if (RESP) {
    var lk = document.createElement('link');
    lk.rel = 'stylesheet'; lk.href = 'spp-client.css';
    document.head.appendChild(lk);
  }
  var MINW = 1440, MAXW = 2560, lastH = 0;
  function fit() {
    var w = window.innerWidth || 1920, h = window.innerHeight || 1080, b = document.body;
    if (RESP && lastH && h < lastH * 0.8 && document.activeElement && document.activeElement.tagName === 'INPUT') return; // soft keyboard squeezing the viewport
    lastH = h;
    var sw = 1920;
    if (RESP) sw = Math.max(MINW, Math.min(MAXW, Math.round(1080 * w / h)));
    var s = Math.min(w / sw, h / 1080);
    if (RESP) { b.style.width = sw + 'px'; b.style.height = '1080px'; root.classList[sw < 1850 ? 'add' : 'remove']('narrow'); root.classList[sw >= 2100 ? 'add' : 'remove']('wide'); }
    b.style.transform = 'translate(' + Math.round((w - sw * s) / 2) + 'px,' + Math.round((h - 1080 * s) / 2) + 'px) scale(' + s + ')';
    C.scale = s;
    if (RESP && C.stageW !== sw) {
      C.stageW = sw;
      if (window.__spp && window.__spp.restage) { try { window.__spp.restage(sw); } catch (e) { console.error(e); } }
    }
  }
  window.addEventListener('resize', fit);
  if (document.body) fit(); else document.addEventListener('DOMContentLoaded', fit);

  /* ---- key injection (app.js reads keyCode on document keydown/keyup, capture phase) ---- */
  var CODES = { left: 37, up: 38, right: 39, down: 40, enter: 13, back: 10009, toggle: 32, play: 415, pause: 19, stop: 413, ff: 417, rw: 412, chup: 427, chdn: 428 };
  function fire(type, code) {
    var e = new KeyboardEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: code });
    (document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : document.body).dispatchEvent(e);
  }
  function key(name) { var c = CODES[name]; if (!c) return; fire('keydown', c); fire('keyup', c); }
  function toggleFullscreen() {
    if (window.SPP_NATIVE && window.SPP_NATIVE.fullscreen) { window.SPP_NATIVE.fullscreen(); return; }
    try { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen(); } catch (e) {}
  }
  C.key = function (name) { setInput('pad'); key(name); }; // keys sent by native wrappers (Android D-pad / gamepad buttons)
  C.send = key; // a key that does not change the input modality
  C.back = function () { var n = Date.now(); if (n - backAt < 200) return; backAt = n; key('back'); }; // Windows mouse / keyboard "back" button (Electron app-command)
  C.fit = fit;
  C.fullscreen = toggleFullscreen;

  /* ---- input modality: keyboard | mouse | touch | pad (responsive mode only) ---- */
  var MODES = ['keyboard', 'mouse', 'touch', 'pad'];
  function paintInput() { MODES.forEach(function (m) { root.classList[C.input === m ? 'add' : 'remove']('in-' + m); }); }
  function setInput(m) {
    if (!RESP || C.input === m) return;
    C.input = m; paintInput();
    if (window.__spp && window.__spp.modality) { try { window.__spp.modality(m); } catch (e) { console.error(e); } }
  }

  if (!RESP) { installLegacyPointer(); return; }

  C.input = C.input || (C.client === 'android' ? 'touch' : 'keyboard');
  paintInput();
  var NAVK = { 37: 1, 38: 1, 39: 1, 40: 1, 13: 1, 27: 1, 10009: 1, 4: 1 };
  document.addEventListener('keydown', function (e) {
    if (!e.isTrusted) return;
    // on Android a D-pad (TV box remote, gamepad) arrives as arrow / Enter keys: that is the "pad" modality
    if (C.client === 'android' && NAVK[e.keyCode]) setInput('pad'); else setInput('keyboard');
  }, true);

  function bridge(type, el, d) {
    var a = window.__spp;
    if (!a || !a.pointer || !el) return false;
    try { return a.pointer(type, el, d || {}); } catch (e) { console.error(e); return false; }
  }

  /* ---- mouse + touch (pointer events; the compatibility mouse events that follow a touch are ignored) ---- */
  var down = null, lx = -1, ly = -1, idleT = 0;
  var SLOP = 8, backAt = 0;
  function mouseBack() { var n = Date.now(); if (n - backAt < 200) return; backAt = n; key('back'); } // pointer and mouse events may both report the same press
  function idleOff() { if (root.classList.contains('idle')) root.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(function () { if (root.classList.contains('playing')) root.classList.add('idle'); }, 2500); }
  function pt(e) { return { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' }; }
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') {
      setInput('mouse'); idleOff();
      if (e.button === 3) { e.preventDefault(); mouseBack(); return; } // mouse "back" button
      if (e.button !== 0) return;
    } else setInput('touch');
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, el: e.target, moved: false, axis: '', acc: 0, drag: false, mouse: e.pointerType === 'mouse' };
    down.drag = bridge('down', e.target, pt(e)) === true;
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') {
      if (e.clientX === lx && e.clientY === ly) return;
      lx = e.clientX; ly = e.clientY;
      if (down && down.mouse && !e.buttons) down = null; // the release happened outside the window / on a native control
      setInput('mouse'); idleOff();
      if (down && down.drag) { bridge('drag', e.target, pt(e)); return; }
      if (!down) bridge('move', e.target, pt(e));
      return;
    }
    if (!down || down.id !== e.pointerId) return;
    var dx = e.clientX - down.x, dy = e.clientY - down.y, s = C.scale || 1;
    if (down.drag) { bridge('drag', e.target, pt(e)); return; }
    if (!down.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 14 * s) { down.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; down.moved = true; down.last = down.axis === 'x' ? e.clientX : e.clientY; }
    if (!down.axis) return;
    // swipe: one scroll step per 90 stage px of finger travel (content follows the finger: finger left = scroll forward)
    var cur = down.axis === 'x' ? e.clientX : e.clientY, step = 90 * s;
    down.acc += down.last - cur; down.last = cur;
    var n = down.acc > 0 ? Math.floor(down.acc / step) : Math.ceil(down.acc / step);
    if (n) { down.acc -= n * step; var o = pt(e); if (down.axis === 'x') o.dx = n; else o.dy = n; o.swipe = true; bridge('wheel', down.el, o); }
  }, true);
  document.addEventListener('pointerup', function (e) {
    var d = down;
    if (!d || d.id !== e.pointerId) return;
    down = null;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (d.drag) { bridge('drop', e.target, pt(e)); return; }
    var far = Math.max(Math.abs(e.clientX - d.x), Math.abs(e.clientY - d.y)) > SLOP * (d.mouse ? 1 : 1.6) * (C.scale || 1);
    if (d.moved || far) return;
    bridge('click', d.mouse ? e.target : (document.elementFromPoint(e.clientX, e.clientY) || e.target), pt(e));
  }, true);
  document.addEventListener('pointercancel', function () { down = null; }, true);
  document.addEventListener('dblclick', function (e) { if (C.input === 'mouse') bridge('dblclick', e.target, pt(e)); }, true);
  // right click = Back (never on a touch long-press)
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); if (C.input === 'mouse') key('back'); });
  document.addEventListener('mousedown', function (e) { if (e.button === 3) { e.preventDefault(); setInput('mouse'); mouseBack(); } }, true);
  document.addEventListener('mouseup', function (e) { if (e.button === 3) e.preventDefault(); }, true);
  document.addEventListener('auxclick', function (e) { if (e.button === 3 || e.button === 4) e.preventDefault(); }, true);
  var wAccX = 0, wAccY = 0, wAt = 0;
  document.addEventListener('wheel', function (e) {
    if (e.ctrlKey) return;
    var k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1, now = Date.now();
    if (now - wAt > 400) { wAccX = 0; wAccY = 0; }
    wAt = now;
    var dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    wAccX += dx; wAccY += dy;
    var sx = wAccX > 0 ? Math.floor(wAccX / 50) : Math.ceil(wAccX / 50), sy = wAccY > 0 ? Math.floor(wAccY / 50) : Math.ceil(wAccY / 50);
    e.preventDefault();
    if (!sx && !sy) return;
    wAccX -= sx * 50; wAccY -= sy * 50;
    var o = pt(e); o.dx = Math.max(-4, Math.min(4, sx)); o.dy = Math.max(-4, Math.min(4, sy)); o.touch = false;
    setInput('mouse');
    bridge('wheel', e.target, o);
  }, { passive: false });

  /* ---- gamepad (Windows / browsers; Android sends its buttons through SPP_CLIENT.key from the activity) ---- */
  var padPrev = {};
  var PAD = { 0: 'enter', 1: 'back', 4: 'rw', 5: 'ff', 9: 'toggle', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  function pollPad() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i]; if (!p) continue;
      var cur = {};
      Object.keys(PAD).forEach(function (b) { if (p.buttons[b] && p.buttons[b].pressed) cur[b] = 1; });
      if (p.axes && p.axes.length > 1) { if (p.axes[0] < -0.6) cur.l = 1; if (p.axes[0] > 0.6) cur.r = 1; if (p.axes[1] < -0.6) cur.u = 1; if (p.axes[1] > 0.6) cur.d = 1; }
      Object.keys(cur).forEach(function (b) {
        var id = i + ':' + b; if (padPrev[id]) return;
        setInput('pad');
        key(PAD[b] || { l: 'left', r: 'right', u: 'up', d: 'down' }[b]);
      });
      Object.keys(padPrev).forEach(function (id) { if (id.split(':')[0] == i && !cur[id.split(':')[1]]) delete padPrev[id]; });
      Object.keys(cur).forEach(function (b) { padPrev[i + ':' + b] = 1; });
    }
    requestAnimationFrame(pollPad);
  }
  if (navigator.getGamepads) requestAnimationFrame(pollPad);
  // the cursor hides a few seconds after the last movement while a video plays
  var wasPlaying = false;
  new MutationObserver(function () {
    var p = root.classList.contains('playing');
    if (p === wasPlaying) return;
    wasPlaying = p;
    if (p) idleOff(); else if (root.classList.contains('idle')) root.classList.remove('idle');
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  /* ---- old behaviour for a plain browser without a client type (TV layout): tap = walk the focus to the tapped element ---- */
  function installLegacyPointer() {
    function focused() {
      var m = document.getElementById('modal');
      var scope = m && !m.classList.contains('hid') ? m : document.body.classList.contains('railf') ? document.getElementById('rail') : document.getElementById('root');
      var list = scope ? scope.querySelectorAll('.f') : [];
      for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) return list[i]; }
      return null;
    }
    function hits(f, x, y, chain) {
      if (!f) return false;
      var r = f.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      return chain.indexOf(f) >= 0;
    }
    function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function tap(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el) return;
      var chain = []; for (var n = el; n; n = n.parentElement) chain.push(n);
      if (el.tagName === 'INPUT') return;
      var playing = document.documentElement.classList.contains('playing');
      var f = focused();
      if (playing && !f && !document.querySelector('#modal:not(.hid)')) { key('enter'); return; }
      var tries = 0;
      while (!hits(f, x, y, chain) && tries++ < 60) {
        var c = f ? center(f) : { x: 0, y: 0 }, dx = x - c.x, dy = y - c.y;
        var horiz = Math.abs(dx) > Math.abs(dy);
        var order = horiz ? [dx > 0 ? 'right' : 'left', dy > 0 ? 'down' : 'up'] : [dy > 0 ? 'down' : 'up', dx > 0 ? 'right' : 'left'];
        var before = f, moved = false;
        for (var i = 0; i < 2 && !moved; i++) {
          key(order[i]); f = focused();
          if (f !== before) moved = true;
        }
        if (!moved) break;
      }
      if (hits(f, x, y, chain)) key('enter');
    }
    var d0 = null;
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      d0 = { x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('pointerup', function (e) {
      if (!d0) return;
      var d = d0; d0 = null;
      var dx = e.clientX - d.x, dy = e.clientY - d.y, ad = Math.max(Math.abs(dx), Math.abs(dy));
      if (ad < 40 * (C.scale || 1)) { tap(e.clientX, e.clientY); return; }
      if (Math.abs(dx) > Math.abs(dy)) key(dx > 0 ? 'right' : 'left'); else key(dy > 0 ? 'down' : 'up');
    }, true);
    document.addEventListener('pointercancel', function () { d0 = null; }, true);
    var wheelAt = 0;
    document.addEventListener('wheel', function (e) {
      var n = Date.now(); if (n - wheelAt < 90) return; wheelAt = n;
      key(e.deltaY > 0 ? 'down' : 'up');
    }, { passive: true });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); key('back'); });
    var prev = {};
    var PADL = { 0: 'enter', 1: 'back', 4: 'rw', 5: 'ff', 9: 'toggle', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
    function poll() {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < pads.length; i++) {
        var p = pads[i]; if (!p) continue;
        var cur = {};
        Object.keys(PADL).forEach(function (b) { if (p.buttons[b] && p.buttons[b].pressed) cur[b] = 1; });
        if (p.axes && p.axes.length > 1) { if (p.axes[0] < -0.6) cur.l = 1; if (p.axes[0] > 0.6) cur.r = 1; if (p.axes[1] < -0.6) cur.u = 1; if (p.axes[1] > 0.6) cur.d = 1; }
        Object.keys(cur).forEach(function (b) {
          var id = i + ':' + b; if (prev[id]) return;
          key(PADL[b] || { l: 'left', r: 'right', u: 'up', d: 'down' }[b]);
        });
        Object.keys(prev).forEach(function (id) { if (id.split(':')[0] == i && !cur[id.split(':')[1]]) delete prev[id]; });
        Object.keys(cur).forEach(function (b) { prev[i + ':' + b] = 1; });
      }
      requestAnimationFrame(poll);
    }
    if (navigator.getGamepads) requestAnimationFrame(poll);
  }
})();
