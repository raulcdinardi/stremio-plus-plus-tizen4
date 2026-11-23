'use strict';
// Minimal Chrome DevTools Protocol client (Node 24 global WebSocket, zero deps).
// Opens a background tab in the already running, logged-in agent Chrome, runs one script in it and closes it.
// It never creates a browser profile of its own.
const U = require('../util');

const CDP = () => (process.env.SPP_CDP_URL || U.secrets.cdpUrl || 'http://127.0.0.1:9222').replace(/\/+$/, '');

class BrowserError extends Error { constructor(m) { super(m); this.code = 'browser'; } }

function connect(wsUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return reject(new BrowserError('ws: ' + e.message)); }
    const t = setTimeout(() => { try { ws.close(); } catch (e) { /* ignore */ } reject(new BrowserError('ws connect timeout')); }, timeoutMs || 5000);
    let id = 0; const waiting = new Map(), listeners = [];
    const send = (method, params, sessionId) => new Promise((res, rej) => {
      const msg = { id: ++id, method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      waiting.set(msg.id, { res, rej, method });
      ws.send(JSON.stringify(msg));
    });
    ws.onopen = () => { clearTimeout(t); resolve({ send, on: f => listeners.push(f), close: () => { try { ws.close(); } catch (e) { /* ignore */ } } }); };
    ws.onerror = () => { clearTimeout(t); reject(new BrowserError('ws error')); };
    ws.onclose = () => { for (const w of waiting.values()) w.rej(new BrowserError('ws closed during ' + w.method)); waiting.clear(); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && waiting.has(m.id)) {
        const w = waiting.get(m.id); waiting.delete(m.id);
        if (m.error) w.rej(new BrowserError(w.method + ': ' + m.error.message)); else w.res(m.result);
      } else for (const f of listeners) f(m);
    };
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// withPage(url, ready, script, opts): navigate a fresh background tab to url, wait until `ready` (expression) is truthy,
// then evaluate `script` (an async function source taking one JSON arg) and return its value.
async function runInPage(url, ready, script, arg, opts) {
  opts = opts || {};
  let ver;
  try { ver = await U.fetchJson(CDP() + '/json/version', { timeout: 3000 }); } catch (e) { throw new BrowserError('cdp unreachable'); }
  if (!ver || !ver.webSocketDebuggerUrl) throw new BrowserError('cdp: no browser ws');
  const c = await connect(ver.webSocketDebuggerUrl);
  let targetId = null;
  try {
    ({ targetId } = await c.send('Target.createTarget', { url: 'about:blank', background: true }));
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    const ev = (expression, awaitPromise) => c.send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true, userGesture: true }, sessionId);
    c.send('Page.navigate', { url }, sessionId).catch(() => { /* slow pages: we poll for readiness below */ });
    const deadline = Date.now() + (opts.timeout || 45000);
    let ok = false;
    while (Date.now() < deadline) {
      await sleep(700);
      try { const r = await ev('(function(){try{return !!(' + ready + ')}catch(e){return false}})()'); if (r && r.result && r.result.value) { ok = true; break; } } catch (e) { /* navigating */ }
    }
    if (!ok) {
      let where = ''; try { where = (await ev('location.host + location.pathname')).result.value; } catch (e) { /* ignore */ }
      throw new BrowserError('page not ready (' + where + ')');
    }
    const r = await ev('(' + script + ')(' + JSON.stringify(arg == null ? null : arg) + ')', true);
    if (r.exceptionDetails) throw new BrowserError('script: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'error').split('\n')[0]);
    return r.result.value;
  } finally {
    if (targetId) await c.send('Target.closeTarget', { targetId }).catch(() => {});
    c.close();
  }
}

module.exports = { runInPage, BrowserError, CDP };
