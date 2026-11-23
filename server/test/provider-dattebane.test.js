'use strict';
// Live test: dattebane provider -> ffprobe + ffmpeg -t 8 on resolved URLs.
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const P = require('../api/providers/dattebane');
const hdr = h => Object.entries(h || {}).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n';
function check(r) {
  const args = h => ['-headers', hdr(h)];
  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...args(r.headers), '-print_format', 'json', '-show_format', '-show_streams', r.url], { timeout: 30000 }).toString());
  const v = pr.streams.find(s => s.codec_type === 'video'), a = pr.streams.find(s => s.codec_type === 'audio');
  assert(v && a, 'video+audio');
  console.log('  ', r.lang.join(','), '|', r.title, '\n     ', v.codec_name, v.width + 'x' + v.height, '+', a.codec_name, 'dur', (+pr.format.duration).toFixed(1) + 's');
  execFileSync('ffmpeg', ['-v', 'error', ...args(r.headers), '-t', '8', '-i', r.url, '-f', 'null', '-'], { timeout: 40000 });
  console.log('      ffmpeg -t 8 OK');
}
(async () => {
  assert.deepStrictEqual(await P.find({ id: 'tt0111161', name: 'x', type: 'series' }, 1, 1), [], 'unrelated -> []');
  const cases = [
    ['Naruto S1E1', { id: 'tt0409591', name: 'Naruto', type: 'series' }, 1, 1, 1],
    ['Naruto S2E1 (abs 36)', { id: 'tt0409591', name: 'Naruto', type: 'series' }, 2, 1, 2],
    ['Shippuden S2E3 (abs 35)', { id: 'tt0988824', name: 'Naruto: Shippuden', type: 'series' }, 2, 3, 2],
    ['Kitsu Boruto ep 5', { id: 'kitsu:13051', name: 'Boruto', type: 'series', kitsu: '13051' }, 1, 5, 2]
  ];
  for (const [label, meta, s, e, min] of cases) {
    const t = Date.now(); const r = await P.find(meta, s, e);
    console.log(label, '->', r.length, 'results', (Date.now() - t) + 'ms');
    assert(r.length >= 1, label + ' no results');
    assert(r.some(x => x.lang.includes('pt-BR') && /Dublado/.test(x.title)), 'dub present');
    for (const x of r) check(x);
  }
  console.log('dattebane OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
