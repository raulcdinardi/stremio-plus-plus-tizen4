// Tiny CDP client + headless Chrome launcher (test only).
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJson(url) { return new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej)); }
const KC = { left: 37, up: 38, right: 39, down: 40, enter: 13, back: 10009, esc: 27, space: 32, play: 415, pause: 19, stop: 413, ff: 417, rw: 412, chup: 427, chdn: 428 };
async function launch(port = 9333) {
  const proc = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1920,1080', '--force-device-scale-factor=1', '--user-data-dir=/tmp/spp-chrome-' + port, '--js-flags=--expose-gc', '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await getJson(`http://127.0.0.1:${port}/json`); break; } catch (e) { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend[m.id]) { const p = pend[m.id]; delete pend[m.id]; m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ' ' + m.params.args.map(a => a.value || a.description).join(' '));
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('HeapProfiler.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const api = {
    logs, send,
    async goto(url) { await send('Page.navigate', { url }); await sleep(400); },
    async ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; },
    async key(name, n = 1, gap = 30, repeat = false) {
      const code = KC[name] || name;
      for (let i = 0; i < n; i++) {
        await api.ev(`(function(){var e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,repeat:${repeat}});Object.defineProperty(e,'keyCode',{value:${code}});document.body.dispatchEvent(e);})()`);
        await api.ev(`(function(){var e=new KeyboardEvent('keyup',{bubbles:true,cancelable:true});Object.defineProperty(e,'keyCode',{value:${code}});document.body.dispatchEvent(e);})()`);
        if (gap) await sleep(gap);
      }
    },
    async type(text) { await send('Input.insertText', { text }); },
    async shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } }); const f = `${__dirname}/shots/${name}.png`; fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; },
    async waitFor(expr, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await api.ev(expr)) return true; } catch (e) {} await sleep(100); } throw new Error('timeout waiting: ' + expr); },
    async gc() { await send('HeapProfiler.collectGarbage'); await sleep(100); },
    async close() { try { ws.close(); } catch (e) {} proc.kill('SIGKILL'); },
    sleep
  };
  return api;
}
module.exports = { launch, sleep };
