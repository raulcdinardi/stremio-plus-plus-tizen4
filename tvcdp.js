// node tvcdp.js <port> <expr|shot> [out.jpg]  — CDP to the TV web app (Node 24 global WebSocket)
const [port, m, out] = process.argv.slice(2);
(async () => {
  const t = (await (await fetch(`http://192.168.1.20:${port}/json`)).json()).find(x => x.webSocketDebuggerUrl);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const to = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 20000);
  ws.onopen = () => ws.send(JSON.stringify(m === 'shot' ? { id: 1, method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: 70 } }
    : { id: 1, method: 'Runtime.evaluate', params: { expression: 'Promise.resolve(' + m + ')', returnByValue: true, awaitPromise: true } }));
  ws.onmessage = ev => { const r = JSON.parse(ev.data); if (r.id !== 1) return; clearTimeout(to);
    if (r.result && r.result.data) { require('fs').writeFileSync(out, Buffer.from(r.result.data, 'base64')); console.log('saved', out); }
    else console.log(JSON.stringify(r.result ? r.result.result : r.error).slice(0, 3000));
    ws.close(); process.exit(0); };
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
