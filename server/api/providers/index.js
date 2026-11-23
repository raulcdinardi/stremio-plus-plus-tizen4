'use strict';
// Site provider plugins: api/providers/*.js exporting {id, name, defaultEnabled?, async find(meta, season, episode) -> [{title, url|pageUrl, headers?, lang}]}
const fs = require('node:fs');
const path = require('node:path');
const U = require('../../util');
let cache = null;
function list() {
  if (cache) return cache;
  cache = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!f.endsWith('.js') || f === 'index.js' || f === 'ytdlp.js' || f.startsWith('_')) continue;
    try {
      const p = require(path.join(__dirname, f));
      if (p && p.id && typeof p.find === 'function') cache.push(p);
    } catch (e) { U.log('provider load failed', f, e.message); }
  }
  return cache;
}
module.exports = { list };
