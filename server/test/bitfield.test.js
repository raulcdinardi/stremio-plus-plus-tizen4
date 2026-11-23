'use strict';
// Round-trip test of the watched bitfield with a real account string and live Cinemeta video list.
const assert = require('node:assert');
const { Watched, orderedVideoIds } = require('../api/bitfield');
(async () => {
  const S = 'tt2560140:4:30:129:eJxzCGBkYPj//z8jw/H///mBNAA/5ghj';
  const r = await fetch('https://v3-cinemeta.strem.io/meta/series/tt2560140.json', { signal: AbortSignal.timeout(15000) });
  const m = (await r.json()).meta;
  let ids = orderedVideoIds(m.videos.map(v => ({ id: v.id, season: v.season, episode: v.episode })));
  const ai = ids.indexOf('tt2560140:4:30');
  assert(ai > 0, 'anchor present');
  // The list may have grown since the string was written: align so anchor index == anchorLength-1 (offset 0)
  const drop = ai - 128;
  const aligned = drop > 0 ? ids.slice(drop) : ids; // drop leading entries (specials) when list grew
  assert.strictEqual(aligned.indexOf('tt2560140:4:30'), 128, 'aligned anchor index');
  const w = Watched.from(S, aligned);
  assert.strictEqual(w.serialize(), S, 'identical re-encode');
  // semantic checks
  assert(w.get('tt2560140:4:30') && w.get('tt2560140:1:1'));
  // against the current (shifted) list: same watched episodes, valid re-serialisation
  const w2 = Watched.from(S, ids);
  assert(w2.get('tt2560140:4:30') && w2.get('tt2560140:1:1'));
  const re = Watched.from(w2.serialize(), ids);
  assert.strictEqual(re.serialize(), w2.serialize());
  const L = ids[ids.length - 1]; w2.set(L, true); assert(Watched.from(w2.serialize(), ids).get(L));
  console.log('bitfield OK (videos=' + ids.length + ', dropped=' + Math.max(drop, 0) + ')');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
