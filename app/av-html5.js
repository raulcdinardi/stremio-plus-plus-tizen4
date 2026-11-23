/* HTML5 player backend for the non-Tizen clients (Windows / Android / desktop browser).
   Exposes window.AVHTML5: the subset of Tizen's webapis.avplay that app.js uses, on a <video> element
   fed by hls.js (vendor/hls.min.js, loaded on demand). On the TV (webapis.avplay present) this file
   does nothing and hls.js is never loaded. Plain ES2017. */
(function () {
  'use strict';
  if (window.webapis && window.webapis.avplay) return;

  var HLS_SRC = 'vendor/hls.min.js';
  var hlsP = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsP) return hlsP;
    hlsP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = HLS_SRC;
      s.onload = function () { if (window.Hls) res(window.Hls); else rej(new Error('hls.js missing')); };
      s.onerror = function () { hlsP = null; rej(new Error('hls.js failed to load')); };
      document.head.appendChild(s);
    });
    return hlsP;
  }

  // What this client can decode (sent to POST /api/play as `codecs`). A wrapper may force a list
  // with window.SPP_CLIENT.codecs (e.g. the Android app when HEVC is unreliable on the device).
  function mseType(t) { try { return !!(window.MediaSource && MediaSource.isTypeSupported(t)); } catch (e) { return false; } }
  function detectCodecs() {
    var c = [];
    if (mseType('video/mp4; codecs="hvc1.1.6.L120.90"') || mseType('video/mp4; codecs="hev1.1.6.L120.90"')) c.push('hevc');
    c.push('h264');
    return c;
  }

  var video = null, hls = null, url = null, lis = null, state = 'NONE';
  var started = false, buffering = false, recovered = 0, netRetries = 0, lastTimeMs = -1;
  var waiters = []; // {ev, ok, fail, timer}

  function emit(name, arg) { var l = lis; if (l && typeof l[name] === 'function') { try { l[name](arg); } catch (e) { console.error(e); } } }
  function bufStart() { if (!buffering) { buffering = true; emit('onbufferingstart'); } }
  function bufEnd() { if (buffering) { buffering = false; emit('onbufferingcomplete'); } }

  function ensureVideo() {
    if (video) return video;
    var st = document.createElement('style');
    st.textContent = '#spp-video{position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:contain;background:#000;visibility:hidden;pointer-events:none}' +
      'html.playing #spp-video{visibility:visible}';
    document.head.appendChild(st);
    video = document.createElement('video');
    video.id = 'spp-video';
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.controls = false;
    document.body.insertBefore(video, document.body.firstChild);
    video.addEventListener('waiting', function () { if (started) bufStart(); });
    video.addEventListener('playing', function () { bufEnd(); });
    video.addEventListener('canplay', function () { if (video.paused) bufEnd(); });
    video.addEventListener('timeupdate', function () {
      if (!started) return;
      var ms = Math.floor(video.currentTime * 1000);
      if (ms !== lastTimeMs) { lastTimeMs = ms; emit('oncurrentplaytime', ms); }
    });
    video.addEventListener('ended', function () { if (started) { state = 'PAUSED'; emit('onstreamcompleted'); } });
    video.addEventListener('error', function () {
      if (!url || hls) return; // hls.js reports its own errors
      var e = video.error; fail('PLAYER_ERROR_' + (e ? e.code : '?'));
    });
    ['seeked', 'canplay', 'loadedmetadata'].forEach(function (ev) {
      video.addEventListener(ev, function () { settle(ev, true); });
    });
    return video;
  }

  function wait(ev, timeoutMs) {
    return new Promise(function (ok, no) {
      var w = { ev: ev, ok: ok, fail: no, timer: 0 };
      w.timer = setTimeout(function () { drop(w); no(new Error('timeout (' + ev + ')')); }, timeoutMs || 60000);
      waiters.push(w);
    });
  }
  function drop(w) { var i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); clearTimeout(w.timer); }
  function settle(ev, ok, err) {
    waiters.slice().forEach(function (w) {
      if (ev !== '*' && w.ev !== ev) return;
      drop(w); if (ok) w.ok(); else w.fail(err || new Error('aborted'));
    });
  }
  function fail(msg) {
    settle('*', false, new Error(msg));
    if (started || state === 'READY') emit('onerror', msg);
  }

  function teardown() {
    settle('*', false, new Error('closed'));
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (video) { try { video.pause(); } catch (e) {} video.removeAttribute('src'); try { video.load(); } catch (e) {} }
    started = false; buffering = false; recovered = 0; netRetries = 0; lastTimeMs = -1;
  }

  function attach(Hls) {
    var v = ensureVideo();
    if (Hls && Hls.isSupported()) {
      var slow = { maxTimeToFirstByteMs: 60000, maxLoadTimeMs: 120000, timeoutRetry: { maxNumRetry: 3, retryDelayMs: 500, maxRetryDelayMs: 2000 }, errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 } };
      hls = new Hls({
        autoStartLoad: false, startPosition: 0, enableWorker: true, lowLatencyMode: false,
        maxBufferLength: 60, maxMaxBufferLength: 120, backBufferLength: 30, maxBufferSize: 120 * 1000 * 1000,
        // the server transcodes on demand: the playlist and a segment after a far seek can take a while
        manifestLoadPolicy: { default: slow }, playlistLoadPolicy: { default: slow }, fragLoadPolicy: { default: slow }
      });
      hls.on(Hls.Events.ERROR, function (ev, d) {
        if (!d || !d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 2) { recovered++; try { hls.recoverMediaError(); return; } catch (e) {} }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 3 && started) { netRetries++; try { hls.startLoad(video.currentTime); return; } catch (e) {} }
        fail(String(d.details || d.type || 'hls error'));
      });
      hls.on(Hls.Events.FRAG_BUFFERED, function () { netRetries = 0; });
      hls.attachMedia(v);
      var parsed = new Promise(function (ok, no) {
        hls.once(Hls.Events.MANIFEST_PARSED, function () { ok(); });
        hls.once(Hls.Events.ERROR, function (ev, d) { if (d && d.fatal) no(new Error(String(d.details))); });
      });
      hls.loadSource(url);
      return parsed;
    }
    if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return wait('loadedmetadata', 60000); }
    return Promise.reject(new Error('HLS not supported here'));
  }

  // Start fetching media at `sec` (first call only; later positions are plain seeks).
  function startAt(sec) {
    if (started) return;
    started = true;
    bufStart();
    if (hls) hls.startLoad(sec);
    if (sec > 0) { try { video.currentTime = sec; } catch (e) {} }
  }

  var AV = {
    isHtml5: true,
    open: function (u) { ensureVideo(); teardown(); url = u; state = 'IDLE'; },
    close: function () { teardown(); url = null; lis = null; state = 'NONE'; },
    setDisplayRect: function () {}, // the <video> always covers the 1920x1080 stage, letterboxed (object-fit: contain)
    setDisplayMethod: function () {},
    setListener: function (l) { lis = l; },
    prepareAsync: function (ok, no) {
      var u = url;
      loadHls().catch(function () { return null; }).then(function (Hls) {
        if (u !== url) throw new Error('closed');
        return attach(Hls);
      }).then(function () { if (u !== url) throw new Error('closed'); state = 'READY'; if (ok) ok(); },
        function (e) { if (no) no(e); });
    },
    seekTo: function (ms, ok, no) {
      var sec = Math.max(0, ms / 1000);
      if (!started) {
        // first positioning (resume): start loading right there instead of at 0
        var p = wait('canplay', 60000); startAt(sec);
        p.then(function () { if (ok) ok(); }, function (e) { if (no) no(e); });
        return;
      }
      bufStart();
      var w = wait('seeked', 60000);
      try { video.currentTime = sec; } catch (e) { settle('seeked', false, e); }
      w.then(function () { if (!video.paused) bufEnd(); if (ok) ok(); }, function (e) { if (no) no(e); });
    },
    play: function () {
      if (!url) return;
      startAt(0);
      state = 'PLAYING';
      var p = video.play();
      if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') { video.muted = true; video.play().catch(function () {}); } });
    },
    pause: function () { if (video) video.pause(); if (state === 'PLAYING') state = 'PAUSED'; },
    stop: function () { if (video) video.pause(); if (hls) { try { hls.stopLoad(); } catch (e) {} } state = 'IDLE'; },
    getDuration: function () { var d = video ? video.duration : 0; return d > 0 && isFinite(d) ? Math.floor(d * 1000) : 0; },
    getCurrentTime: function () { return video ? Math.floor(video.currentTime * 1000) : 0; },
    getState: function () { return state; },
    // extras for the client apps (not part of avplay)
    codecs: function () { var f = window.SPP_CLIENT && window.SPP_CLIENT.codecs; return f && f.length ? f.slice() : detectCodecs(); },
    video: function () { return ensureVideo(); }
  };
  window.AVHTML5 = AV;
})();
