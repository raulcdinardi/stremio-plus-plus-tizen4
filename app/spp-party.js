/* Watch-along ("Assistir junto") - TV side. ES5 (old Chromium). Loaded before app.js; the player calls
   SPP.attach(api) on mount, SPP.detach() on unmount, SPP.key(k) first thing on every key, SPP.open() from the control.
   The room outlives a single player screen (next episode / another title keeps the same room).
   It talks to the server's /api/party/* (LAN or owner relay); the friend uses the viewer page /w/<token>/. */
(function () {
  'use strict';
  var I18N = {
    pt: {
      title: 'Assistir junto', creating: 'Criando a sala…', scan: 'Aponte a câmera para o QR code ou envie o link:',
      none: 'Nenhum convidado ainda', guests: 'Assistindo com você: %s', stop: 'Encerrar sessão', close: 'Fechar',
      lan: 'Este link só funciona dentro da sua rede. Para convidar alguém de fora, configure o endereço público (partyPublicBase) no servidor.',
      fail: 'Não consegui criar a sala', started: 'Sessão criada', ended: 'Sessão encerrada', hint: 'OK escolhe · Voltar fecha',
      played: '%s deu play', paused: '%s pausou', seeked: '%s pulou para %s', joined: '%s entrou', left: '%s saiu', badge: 'Assistindo junto'
    },
    en: {
      title: 'Watch together', creating: 'Creating the room…', scan: 'Point the camera at the QR code or send the link:',
      none: 'No guests yet', guests: 'Watching with you: %s', stop: 'End session', close: 'Close',
      lan: 'This link only works inside your network. To invite someone outside, set the public address (partyPublicBase) on the server.',
      fail: "Couldn't create the room", started: 'Session created', ended: 'Session ended', hint: 'OK selects · Back closes',
      played: '%s pressed play', paused: '%s paused', seeked: '%s jumped to %s', joined: '%s joined', left: '%s left', badge: 'Watching together'
    }
  };
  var SPP = window.SPP = {
    /* 24x24 icon path for the player control (two heads) */
    icon: '<circle cx="8.5" cy="8" r="3.2" fill="currentColor"/><circle cx="16.5" cy="9" r="2.6" fill="currentColor"/><path fill="currentColor" d="M2.5 19c0-3.4 2.6-5.6 6-5.6s6 2.2 6 5.6zM14.6 14.2c.6-.2 1.3-.3 1.9-.3 3 0 5 1.9 5 5.1h-5.1c0-2-.7-3.7-1.8-4.8z"/>'
  };

  var api = null, room = null, es = null, off = 0, pollT = 0, tickT = 0, detachT = 0, esErrT = 0, ov = null, ovIdx = 0, last = null, expect = null, viewers = [], busy = false;

  function L() { var l = api && api.lang ? api.lang() : 'en'; return I18N[l] || I18N.en; }
  function tt(k) { var s = L()[k] || k, a = Array.prototype.slice.call(arguments, 1); return s.replace(/%s/g, function () { return a.length ? a.shift() : ''; }); }
  function base() { return api ? api.base() : (window.__sppBase || ''); }
  function now() { return Date.now(); }
  function serverNow() { return Date.now() + off; }

  function req(method, path, body, cb) {
    var x = new XMLHttpRequest();
    x.open(method, base() + path, true);
    x.timeout = 8000;
    if (body !== undefined) x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} cb && cb(x.status >= 200 && x.status < 300 ? null : { status: x.status }, j); };
    x.onerror = x.ontimeout = function () { cb && cb({ status: 0 }, null); };
    x.send(body !== undefined ? JSON.stringify(body) : null);
  }

  /* ---- clock offset to the server (a few pings, keep the lowest round trip) ---- */
  function syncClock() {
    if (!room) return;
    var best = 1e9, n = 0;
    (function one() {
      var t0 = now();
      req('GET', '/api/party/' + room.id + '/time', undefined, function (e, j) {
        if (!e && j) { var rtt = now() - t0; if (rtt < best) { best = rtt; off = j.now + rtt / 2 - now(); } }
        if (++n < 5) setTimeout(one, 100);
      });
    })();
  }

  /* ---- event stream ---- */
  function openStream() {
    if (!room || es) return;
    try { es = new EventSource(base() + '/api/party/' + room.id + '/events'); } catch (e) { es = null; return; }
    es.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    es.onerror = function () {
      // EventSource retries by itself; if the room is gone (404) give up cleanly
      clearTimeout(esErrT);
      esErrT = setTimeout(function () {
        req('GET', '/api/party', undefined, function (err, j) { if (!err && j && !j.id && room) { drop(); } });
      }, 4000);
    };
  }
  function closeStream() { if (es) { try { es.close(); } catch (e) {} es = null; } }
  function drop() { // the server no longer has the room
    var had = !!room;
    room = null; closeStream(); stopLoops(); viewers = [];
    if (had && api) api.toast(tt('ended'));
    if (ov) paintOv();
  }

  function onMsg(m) {
    if (!api) return;
    if (m.t === 'snap') { viewers = m.members || []; if (ov) paintOv(); return; }
    if (m.t === 'join') { viewers = m.members || []; api.toast(tt('joined', m.name)); if (ov) paintOv(); return; }
    if (m.t === 'leave') { viewers = m.members || []; api.toast(tt('left', m.name)); if (ov) paintOv(); return; }
    if (m.t === 'closed') { drop(); return; }
    if (m.t !== 'cmd' || !m.by || m.by.k === 'tv') return;
    var s = api.getState();
    var target = m.playing ? m.pos + Math.max(0, serverNow() - m.at) / 1000 : m.pos;
    var nm = m.by.name || '?';
    if (m.a === 'pause') {
      expect = { state: 'paused', pos: m.pos, until: now() + 2500 };
      api.pause();
      if (Math.abs(s.pos - m.pos) > 0.7) { expect.pos = m.pos; api.seek(m.pos); }
      api.toast(tt('paused', nm));
    } else if (m.a === 'play') {
      expect = { state: 'playing', pos: target, until: now() + 2500 };
      if (Math.abs(s.pos - target) > 1.0) api.seek(target);
      api.play();
      api.toast(tt('played', nm));
    } else if (m.a === 'seek') {
      expect = { state: s.state, pos: target, until: now() + 3000 };
      api.seek(target);
      api.toast(tt('seeked', nm, fmt(m.pos)));
    }
  }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  /* ---- local changes -> room (polled: keeps the player code untouched) ---- */
  function cmd(a, pos) { if (room) req('POST', '/api/party/' + room.id + '/cmd', { a: a, pos: pos }); }
  function poll() {
    if (!api || !room) return;
    var s = api.getState(), t = now();
    if (expect && t > expect.until) expect = null;
    if (!s.session || s.state === 'loading' || s.state === 'error' || s.state === 'stopped') { last = { session: s.session, state: s.state, pos: s.pos }; return; }
    if (last && last.session === s.session && last.state !== 'loading' && last.state !== 'error') {
      var jump = s.pos - last.pos;
      if (jump > 1.6 || jump < -0.6) {
        if (expect && Math.abs(s.pos - expect.pos) < 1.5) { /* applying a remote seek */ }
        else cmd('seek', s.pos);
      }
      if (s.state !== last.state) {
        if (expect && expect.state === s.state) { /* applying a remote play/pause */ }
        else if (s.state === 'paused') cmd('pause', s.pos);
        else if (s.state === 'playing') cmd('play', s.pos);
      }
    } else if (last && last.session !== s.session) { /* new source: the next tick tells the server */ }
    last = { session: s.session, state: s.state, pos: s.pos };
  }
  function tick(force) {
    if (!api || !room) return;
    var s = api.getState();
    if (!s.session && !force) return;
    var body = { ts: now(), session: s.session, pos: s.pos, playing: s.state === 'playing', title: s.title, label: s.label, sub: { id: s.subId || null, off: s.subOff || 0, label: s.subLabel || '' } };
    if (!s.session) delete body.session;
    req('POST', '/api/party/' + room.id + '/state', body, function (e, j) {
      if (e && e.status === 404) drop();
      else if (j && j.viewers) { viewers = j.viewers; }
    });
  }
  function startLoops() {
    if (!pollT) pollT = setInterval(poll, 250);
    if (!tickT) tickT = setInterval(tick, 2000);
  }
  function stopLoops() { clearInterval(pollT); clearInterval(tickT); pollT = tickT = 0; }

  /* ---- player lifecycle ---- */
  SPP.attach = function (a) {
    api = a; clearTimeout(detachT); last = null; expect = null;
    if (room) { openStream(); startLoops(); return; }
    req('GET', '/api/party', undefined, function (e, j) { // a room may already exist (app restarted)
      if (!api || room || e || !j || !j.id) return;
      room = j; viewers = j.viewers || []; syncClock(); openStream(); startLoops();
    });
  };
  SPP.detach = function () {
    if (room) {
      var s = api && api.getState ? api.getState() : null;
      if (s && s.session) req('POST', '/api/party/' + room.id + '/state', { ts: now(), session: s.session, pos: s.pos, playing: false, title: s.title, label: s.label, sub: { id: s.subId || null, off: s.subOff || 0, label: s.subLabel || '' } });
      clearTimeout(detachT);
      detachT = setTimeout(function () { if (room) SPP.stop(); }, 90000); // nobody came back to a player: end the room
    }
    closeOv(); api = null; stopLoops();
  };
  SPP.active = function () { return !!room; };
  SPP.stop = function () {
    var r = room; room = null; closeStream(); stopLoops(); viewers = []; clearTimeout(detachT);
    if (r) req('DELETE', '/api/party/' + r.id, undefined, function () {});
    if (api) api.toast(tt('ended'));
  };

  /* ---- overlay (link + QR) ---- */
  var CSS = '.spp-ov{position:absolute;left:0;top:0;width:1920px;height:1080px;background:#090713;z-index:50;color:#fff}' +
    '.spp-ov .c{position:absolute;left:360px;top:90px;width:1200px;height:900px}' +
    '.spp-ov h1{margin:0;font-size:52px;line-height:64px}' +
    '.spp-ov .s{font-size:28px;line-height:38px;color:#b8a6ff;margin-top:6px}' +
    '.spp-ov canvas{position:absolute;left:0;top:140px;width:440px;height:440px;background:#fff;border-radius:16px}' +
    '.spp-ov .u{position:absolute;left:490px;top:140px;width:710px;font-size:36px;line-height:48px;word-break:break-all;font-weight:700}' +
    '.spp-ov .g{position:absolute;left:490px;top:360px;width:710px;font-size:28px;line-height:40px;color:#b8a6ff}' +
    '.spp-ov .w{position:absolute;left:490px;top:470px;width:710px;font-size:24px;line-height:32px;color:#ffcf6b}' +
    '.spp-ov .bs{position:absolute;left:0;top:660px;width:1200px}' +
    '.spp-ov .b{display:inline-block;height:80px;line-height:72px;padding:0 44px;margin-right:24px;border:4px solid transparent;border-radius:40px;background:#26223f;font-size:30px;font-weight:700}' +
    '.spp-ov .b.f{background:#7b5cff;border-color:#fff}' +
    '.spp-ov .h{position:absolute;left:0;top:780px;font-size:22px;color:#9b97b8}';
  var styled = false;
  function mkStyle() { if (styled) return; styled = true; var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
  function div(cls, txt) { var d = document.createElement('div'); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; }
  function drawQr(canvas, text) {
    try {
      var q = window.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
      var n = q.getModuleCount(), quiet = 4, px = 10, size = (n + quiet * 2) * px;
      canvas.width = size; canvas.height = size;
      var g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
    } catch (e) { /* url too long for a QR: the text link is still shown */ }
  }
  function paintOv() {
    if (!ov || !api) return;
    mkStyle();
    ov.textContent = '';
    var c = div('c'); ov.appendChild(c);
    c.appendChild(div('', '')).appendChild(document.createElement('h1')).textContent = tt('title');
    if (!room) {
      c.appendChild(div('s', busy ? tt('creating') : tt('fail')));
      var bs0 = div('bs'); var b0 = div('b f', tt('close')); bs0.appendChild(b0); c.appendChild(bs0);
      return;
    }
    c.appendChild(div('s', tt('scan')));
    var cv = document.createElement('canvas'); c.appendChild(cv); drawQr(cv, room.url);
    c.appendChild(div('u', room.url));
    c.appendChild(div('g', viewers.length ? tt('guests', viewers.join(', ')) : tt('none')));
    if (!room.publicBase) c.appendChild(div('w', tt('lan')));
    var bs = div('bs'); c.appendChild(bs);
    ov.btns = [div('b', tt('stop')), div('b', tt('close'))];
    ov.btns.forEach(function (b) { bs.appendChild(b); });
    ov.btns[ovIdx].classList.add('f');
    c.appendChild(div('h', tt('hint')));
  }
  function closeOv() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); ov = null; }
  SPP.open = function () {
    if (!api || ov) return;
    ov = div('spp-ov'); ovIdx = 1; (api.root || document.body).appendChild(ov);
    if (room) { paintOv(); return; }
    busy = true; paintOv();
    var s = api.getState();
    if (!s.session) { busy = false; paintOv(); return; }
    req('POST', '/api/party', { session: s.session, pos: s.pos, playing: s.state === 'playing', title: s.title, label: s.label }, function (e, j) {
      busy = false;
      if (e || !j || !j.id) { paintOv(); return; }
      room = j; viewers = j.viewers || []; last = null; syncClock(); openStream(); startLoops(); tick(); paintOv();
      if (api) api.toast(tt('started'));
    });
  };
  /* returns true when the key was consumed by the overlay */
  SPP.key = function (k) {
    if (!ov) return false;
    if (k === 'back' || k === 'stop') { closeOv(); return true; }
    if (!room) { if (k === 'enter') closeOv(); return true; }
    if (k === 'left' || k === 'right') { ovIdx = k === 'left' ? 0 : 1; paintOv(); }
    else if (k === 'enter') { if (ovIdx === 0) { closeOv(); SPP.stop(); } else closeOv(); }
    return true;
  };
  SPP.label = function () { return tt('title'); };
  SPP._room = function () { return room; };
})();
