'use strict';
// Resolve a web page URL to a direct media URL with yt-dlp (prefers ~/.local/bin/yt-dlp, else PATH).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const U = require('../../util');

function bin() {
  const p = path.join(os.homedir(), '.local', 'bin', 'yt-dlp');
  return fs.existsSync(p) ? p : 'yt-dlp';
}
function available() { return new Promise(r => execFile(bin(), ['--version'], { timeout: 8000 }, e => r(!e))); }
function resolve(pageUrl, headers) {
  return new Promise((res, rej) => {
    const args = ['-g', '-f', 'best', '--no-playlist', '--no-warnings', '--socket-timeout', '15'];
    for (const [k, v] of Object.entries(headers || {})) args.push('--add-header', k + ':' + v);
    args.push(pageUrl);
    execFile(bin(), args, { timeout: 45000, maxBuffer: 1 << 20 }, (err, out) => {
      if (err) return rej(new U.HttpError(502, 'yt-dlp failed', 'resolve_failed'));
      const url = String(out).split('\n').map(s => s.trim()).filter(Boolean)[0];
      if (!/^https?:\/\//.test(url || '')) return rej(new U.HttpError(502, 'yt-dlp returned no url', 'resolve_failed'));
      res(url);
    });
  });
}
module.exports = { resolve, available, bin };
