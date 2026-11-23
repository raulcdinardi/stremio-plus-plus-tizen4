/* Shell for the non-Tizen clients (Windows / Android / desktop browser): client config, letterboxed scaling of
   the fixed 1920x1080 stage, and mouse / touch / wheel / gamepad -> app key events. On the TV (webapis.avplay
   present) this file does nothing. Plain ES2017.
   Config comes from window.SPP_CLIENT (set by the wrapper before this script) and/or the page URL:
   ?client=windows|android &servers=<url>,<url> &saver=0|1 &codecs=h264,hevc */
(function () {
  'use strict';
  if (window.webapis && window.webapis.avplay) return;

  var q = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (p) {
    if (!p) return; var i = p.indexOf('=');
    try { q[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = i < 0 ? '' : decodeURIComponent(p.slice(i + 1)); } catch (e) {}
  });
  var C = window.SPP_CLIENT = window.SPP_CLIENT || {};
  if (q.client && !C.platform) C.platform = q.client;
  if (q.servers && !C.servers) C.servers = q.servers.split(',').filter(Boolean);
  if (q.saver != null && C.saverDefault == null) C.saverDefault = q.saver === '1';
  if (q.codecs && !C.codecs) C.codecs = q.codecs.split(',').filter(Boolean);
  if (C.saverDefault == null) C.saverDefault = false;
  if (!C.exit) C.exit = function () { // wrappers expose SPP_NATIVE (Electron) or AndroidSPP (WebView)
    if (window.SPP_NATIVE) window.SPP_NATIVE.exit(); else if (window.AndroidSPP) window.AndroidSPP.exit(); else window.close();
  };

  /* ---- letterboxed scale of the 1920x1080 stage ---- */
  var meta = document.querySelector('meta[name=viewport]');
  if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  var st = document.createElement('style');
  st.textContent = 'html{background:#000!important;overflow:hidden!important;width:100%!important;height:100%!important}' +
    'body{position:absolute!important;left:0;top:0;transform-origin:0 0;overflow:hidden!important;touch-action:none;-webkit-user-select:none;user-select:none}' +
    'html.playing,html.playing body{background:#000!important}html.playing #root{background:transparent}' +
    '#av-player{display:none!important}input{-webkit-user-select:text;user-select:text}';
  document.head.appendChild(st);
  function fit() {
    var w = window.innerWidth || 1920, h = window.innerHeight || 1080, s = Math.min(w / 1920, h / 1080);
    var b = document.body;
    b.style.transform = 'translate(' + Math.round((w - 1920 * s) / 2) + 'px,' + Math.round((h - 1080 * s) / 2) + 'px) scale(' + s + ')';
    C.scale = s;
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
  window.SPP = { key: key, fit: fit };

  /* ---- tap / click = move focus to the tapped element, then OK ---- */
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
    // walk the focus toward the tapped point with the arrow keys
    var tries = 0, lastKey = '';
    while (!hits(f, x, y, chain) && tries++ < 60) {
      var c = f ? center(f) : { x: 0, y: 0 }, dx = x - c.x, dy = y - c.y;
      var horiz = Math.abs(dx) > Math.abs(dy);
      var order = horiz ? [dx > 0 ? 'right' : 'left', dy > 0 ? 'down' : 'up'] : [dy > 0 ? 'down' : 'up', dx > 0 ? 'right' : 'left'];
      var before = f, moved = false;
      for (var i = 0; i < 2 && !moved; i++) {
        key(order[i]); f = focused();
        if (f !== before) { moved = true; lastKey = order[i]; }
      }
      if (!moved) break;
    }
    if (hits(f, x, y, chain)) key('enter');
  }
  var down = null;
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, true);
  document.addEventListener('pointerup', function (e) {
    if (!down) return;
    var d = down; down = null;
    var dx = e.clientX - d.x, dy = e.clientY - d.y, ad = Math.max(Math.abs(dx), Math.abs(dy));
    var big = 40 * (C.scale || 1);
    if (ad < big) { tap(e.clientX, e.clientY); return; }
    // swipe = arrow key (seek in the player, scroll lists elsewhere)
    if (Math.abs(dx) > Math.abs(dy)) key(dx > 0 ? 'right' : 'left'); else key(dy > 0 ? 'down' : 'up');
  }, true);
  document.addEventListener('pointercancel', function () { down = null; }, true);
  var wheelAt = 0;
  document.addEventListener('wheel', function (e) {
    var n = Date.now(); if (n - wheelAt < 90) return; wheelAt = n;
    key(e.deltaY > 0 ? 'down' : 'up');
  }, { passive: true });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); key('back'); }); // right click = Back

  /* ---- gamepad (Windows / browsers; Android sends its buttons through SPP.key from the activity) ---- */
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
        key(PAD[b] || { l: 'left', r: 'right', u: 'up', d: 'down' }[b]);
      });
      Object.keys(padPrev).forEach(function (id) { if (id.split(':')[0] == i && !cur[id.split(':')[1]]) delete padPrev[id]; });
      Object.keys(cur).forEach(function (b) { padPrev[i + ':' + b] = 1; });
    }
    requestAnimationFrame(pollPad);
  }
  if (navigator.getGamepads) requestAnimationFrame(pollPad);
})();
