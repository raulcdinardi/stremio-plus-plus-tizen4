'use strict';
// Compatible port of stremio-watched-bitfield (stremio-core): "anchorVideo:anchorLength:base64(zlib(bits))".
const zlib = require('node:zlib');

function parse(str) {
  const parts = String(str || '').split(':');
  if (parts.length < 3) return null;
  const b64 = parts.pop();
  const anchorLength = parseInt(parts.pop(), 10);
  if (!(anchorLength >= 0)) return null;
  let values;
  try { values = new Uint8Array(zlib.inflateSync(Buffer.from(b64, 'base64'))); } catch (e) { return null; }
  return { anchor: parts.join(':'), anchorLength, values };
}
function newBits(length, values) {
  const bytes = Math.ceil(length / 8);
  const v = new Uint8Array(Math.max(bytes, values ? values.length : 0));
  if (values) v.set(values);
  return { length, values: v };
}
function bitGet(b, i) { const x = i >> 3; return x >= b.values.length ? false : ((b.values[x] >> (i & 7)) & 1) !== 0; }
function bitSet(b, i, val) {
  const x = i >> 3;
  if (x >= b.values.length) { const n = new Uint8Array(x + 1); n.set(b.values); b.values = n; b.length = n.length * 8; }
  if (val) b.values[x] |= (1 << (i & 7)); else b.values[x] &= ~(1 << (i & 7));
}
function lastTrue(b) { for (let i = b.length - 1; i >= 0; i--) if (bitGet(b, i)) return i; return -1; }

class Watched {
  constructor(bits, ids) { this.bits = bits; this.ids = ids; }
  static empty(ids) { return new Watched(newBits(ids.length), ids); }
  // construct_and_resize
  static from(serialized, ids) {
    const f = parse(serialized);
    if (!f) return Watched.empty(ids);
    const idx = ids.indexOf(f.anchor);
    if (idx < 0) return Watched.empty(ids);
    const offset = f.anchorLength - idx - 1;
    const bits = newBits(ids.length, f.values);
    if (offset !== 0) {
      const w = Watched.empty(ids);
      for (let i = 0; i < ids.length; i++) {
        const p = i + offset;
        if (p >= 0 && p < bits.length) bitSet(w.bits, i, bitGet(bits, p));
      }
      return w;
    }
    return new Watched(bits, ids);
  }
  get(id) { const i = this.ids.indexOf(id); return i >= 0 ? bitGet(this.bits, i) : false; }
  set(id, v) { const i = this.ids.indexOf(id); if (i >= 0) bitSet(this.bits, i, v); }
  serialize() {
    const last = lastTrue(this.bits);
    const li = last < 0 ? 0 : last;
    const anchor = this.ids[li] !== undefined ? this.ids[li] : 'undefined';
    const packed = zlib.deflateSync(Buffer.from(this.bits.values), { level: 6 }).toString('base64');
    return anchor + ':' + (li + 1) + ':' + packed;
  }
}
// Video ids in stremio-core order: by season then episode ascending (no-series-info first)
function orderedVideoIds(videos) {
  const key = v => [v.season == null ? -Infinity : v.season, v.episode == null ? -Infinity : v.episode];
  return videos.map((v, i) => [v, i]).sort((a, b) => {
    const ka = key(a[0]), kb = key(b[0]);
    return ka[0] === kb[0] ? (ka[1] === kb[1] ? a[1] - b[1] : ka[1] - kb[1]) : (ka[0] < kb[0] ? -1 : 1);
  }).map(x => x[0].id);
}
module.exports = { Watched, parse, orderedVideoIds };
