'use strict';
// Read/merge/write the secrets file (same file util.js loads at startup: $SPP_SECRETS or <root>/secrets.json).
// Writes are atomic and the file is kept at mode 600. Values are never logged.
const fs = require('node:fs');
const path = require('node:path');
const U = require('../util');

const FILE = process.env.SPP_SECRETS || path.join(U.ROOT, 'secrets.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}
function get(k) { const s = read(); return s[k] != null ? s[k] : U.secrets[k]; }
// patch: {key: value|null}; null deletes the key.
function update(patch) {
  const cur = read();
  for (const k of Object.keys(patch)) {
    if (patch[k] == null) { delete cur[k]; delete U.secrets[k]; }
    else { cur[k] = patch[k]; U.secrets[k] = patch[k]; if (typeof patch[k] === 'string') U.addSecretValue(patch[k]); }
  }
  const tmp = FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, FILE);
}
module.exports = { FILE, read, get, update };
