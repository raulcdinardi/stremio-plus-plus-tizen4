'use strict';
// /img?u=<url>&w=<px>: fetch, resize with ffmpeg to JPEG, disk cache.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const U = require('../util');
const DIR = path.join(U.STATE, 'img');
const MAX_IN = 12e6;
const inflight = new Map();
let running = 0; const waiters = [];
async function slot() { if (running < 3) { running++; return; } await new Promise(r => waiters.push(r)); running++; }
function release() { running--; const w = waiters.shift(); if (w) w(); }

function badHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^0\./.test(h) || h.endsWith('.local');
}
function resize(buf, w, png) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', `scale='min(${w},iw)':-2`, '-frames:v', '1'].concat(png ? ['-pix_fmt', 'rgba', '-compression_level', '9', '-f', 'image2', '-c:v', 'png', 'pipe:1'] : ['-q:v', '5', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']), { stdio: ['pipe', 'pipe', 'ignore'] });
    const out = []; let n = 0;
    const t = setTimeout(() => { p.kill('SIGKILL'); }, 15000);
    p.stdout.on('data', c => { n += c.length; if (n < 5e6) out.push(c); });
    p.stdin.on('error', () => {});
    p.on('close', code => { clearTimeout(t); const b = Buffer.concat(out); code === 0 && b.length > 100 ? res(b) : rej(new Error('ffmpeg ' + code)); });
    p.stdin.end(buf);
  });
}
async function produce(u, w, file, png) {
  const r = await U.fetchRaw(u, { timeout: 9000, headers: { 'user-agent': 'Mozilla/5.0 Stremio++' } });
  if (!r.ok) throw new U.HttpError(502, 'image upstream http ' + r.status);
  if (!/^image\//i.test(r.headers.get('content-type') || '')) throw new U.HttpError(415, 'not an image');
  const len = +r.headers.get('content-length') || 0; if (len > MAX_IN) throw new U.HttpError(413, 'image too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IN) throw new U.HttpError(413, 'image too large');
  await slot();
  let jpg; try { jpg = await resize(buf, w, png); } finally { release(); }
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, jpg); fs.renameSync(tmp, file);
  return jpg;
}
async function handle(req, res, url) {
  const u = url.searchParams.get('u') || '';
  let w = parseInt(url.searchParams.get('w'), 10) || 300; w = Math.max(16, Math.min(1280, w));
  let pu; try { pu = new URL(u); } catch (e) { throw new U.HttpError(400, 'bad url'); }
  if (!/^https?:$/.test(pu.protocol) || badHost(pu.hostname)) throw new U.HttpError(400, 'url not allowed');
  const png = url.searchParams.get('f') === 'png';
  const key = U.sha1(u + '|' + w + (png ? '|png' : '')), file = path.join(DIR, key + (png ? '.png' : '.jpg'));
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) {
    if (!inflight.has(key)) inflight.set(key, produce(u, w, file, png).finally(() => inflight.delete(key)));
    buf = await inflight.get(key);
  }
  res.writeHead(200, { 'content-type': png ? 'image/png' : 'image/jpeg', 'content-length': buf.length, 'cache-control': 'public, max-age=604800' });
  res.end(buf);
}
module.exports = { handle };
