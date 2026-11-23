'use strict';
// Acceptance tests for server/media.js. Run: node server/test/media.test.js [only-test-name ...]
// Scratch/fixtures live in /tmp/spp-a.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const media = require('../media');

const SCR = '/tmp/spp-a';
fs.mkdirSync(SCR, { recursive: true });
const results = [];
let failures = 0;
const only = process.argv.slice(2);

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -- ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ff(args) { execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error'].concat(args), { stdio: 'inherit' }); }
function have(f) { return fs.existsSync(path.join(SCR, f)); }

// ---------------------------------------------------------------- fixtures
function makeFixtures() {
  const P = (f) => path.join(SCR, f);
  if (!have('s0.srt')) {
    fs.writeFileSync(P('s0.srt'), '1\n00:00:01,000 --> 00:00:03,000\nLegenda A um\n\n2\n00:00:10,500 --> 00:00:13,000\nLegenda A dois\nsegunda linha\n\n3\n00:00:30,000 --> 00:00:33,500\nLegenda A tres\n\n4\n00:00:55,000 --> 00:00:58,000\nLegenda A final\n');
    fs.writeFileSync(P('s1.srt'), '1\n00:00:02,000 --> 00:00:04,000\nSubtitle B one\n\n2\n00:00:20,000 --> 00:00:22,000\nSubtitle B two\n\n3\n00:00:45,000 --> 00:00:50,000\nSubtitle B three\n');
  }
  if (!have('test_hevc10.mkv')) {
    console.log('generating test_hevc10.mkv ...');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=24000/1001:d=60', '-f', 'lavfi', '-i', 'sine=f=440:d=60:r=48000',
      '-f', 'lavfi', '-i', 'sine=f=880:d=60:r=48000', '-f', 'lavfi', '-i', 'sine=f=1320:d=60:r=48000',
      '-i', P('s0.srt'), '-i', P('s1.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-map', '4', '-map', '5',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10', '-x265-params', 'log-level=error',
      '-c:a:0', 'aac', '-c:a:1', 'ac3', '-ac:a:1', '6', '-c:a:2', 'aac',
      '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=por', '-metadata:s:a:2', 'language=jpn',
      '-metadata:s:s:0', 'language=por', '-metadata:s:s:1', 'language=eng', '-c:s', 'srt', P('test_hevc10.mkv')]);
  }
  if (!have('test_vp9.webm')) {
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=500:d=12', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', P('test_vp9.webm')]);
  }
  if (!have('test_av1.mkv')) {
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24:d=12', '-f', 'lavfi', '-i', 'sine=f=500:d=12', '-c:v', 'libsvtav1', '-preset', '10', '-b:v', '1M', '-c:a', 'aac', P('test_av1.mkv')]);
  }
  if (!have('test_720p60.mp4')) {
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=60:d=12', '-f', 'lavfi', '-i', 'sine=f=500:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', P('test_720p60.mp4')]);
  }
  if (!have('test_noaudio.mp4')) {
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=854x480:r=25:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', P('test_noaudio.mp4')]);
  }
  if (!have('test_subs.mkv')) {
    fs.writeFileSync(P('a.ass'), '[Script Info]\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,{\\an8\\i1}Hello {\\b1}ASS{\\b0} world\\Nsecond line\nDialogue: 0,0:00:07.00,0:00:09.00,Default,,0,0,0,,Plain ass line\n');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=500:d=12', '-i', P('a.ass'), '-i', P('s1.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '2', '-map', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s:0', 'ass', '-c:s:1', 'srt', P('test_subs.mkv')]);
    ff(['-i', P('test_subs.mkv'), '-map', '0:v', '-map', '0:a', '-map', '0:s:1', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', P('test_movtext.mp4')]);
  }
}

// ---------------------------------------------------------------- tiny HTTP front (mimics server.js routes)
let front; let frontPort;
function startFront() {
  return new Promise((resolve) => {
    front = http.createServer((req, res) => {
      let m;
      if ((m = /^\/hls\/([0-9a-f]+)\/index\.m3u8/.exec(req.url))) return media.handlePlaylist(req, res, m[1]);
      if ((m = /^\/hls\/([0-9a-f]+)\/(\d+)\.ts/.exec(req.url))) return media.handleSegment(req, res, m[1], Number(m[2]));
      res.statusCode = 404; res.end();
    });
    front.listen(0, '127.0.0.1', () => { frontPort = front.address().port; resolve(); });
  });
}
function get(p) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    http.get({ host: '127.0.0.1', port: frontPort, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), ms: Date.now() - t0 }));
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------- analysis helpers
function probeSeg(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.filter((s) => s.codec_type === 'audio');
  return { v, a, fmtDur: Number(j.format.duration), n: j.streams.length };
}

function toneHz(file) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 26 });
  let zc = 0; let prev = 0;
  const n = buf.length >> 1;
  for (let i = 0; i < n; i++) { const x = buf.readInt16LE(i * 2); if (prev < 0 && x >= 0) zc++; prev = x; }
  return zc / (n / 8000);
}

async function validateAll(label, id, segCount, opts) {
  opts = opts || {};
  const dir = path.join(SCR, 'out_' + label);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const bad = []; const starts = [];
  const t0 = Date.now();
  let firstMs = 0;
  for (let n = 0; n < segCount; n++) {
    const r = await get('/hls/' + id + '/' + n + '.ts');
    if (n === 0) firstMs = r.ms;
    if (r.status !== 200) { bad.push('seg' + n + ' status ' + r.status + ' ' + r.body.toString().slice(0, 100)); continue; }
    const f = path.join(dir, n + '.ts');
    fs.writeFileSync(f, r.body);
    const p = probeSeg(f);
    const vs = p.v ? Number(p.v.start_time) : NaN;
    starts.push(vs);
    if (!p.v || p.v.codec_name !== 'h264') bad.push('seg' + n + ' vcodec ' + (p.v && p.v.codec_name));
    else if (p.v.profile !== 'High') bad.push('seg' + n + ' profile ' + p.v.profile);
    else if (p.v.pix_fmt !== 'yuv420p') bad.push('seg' + n + ' pix_fmt ' + p.v.pix_fmt);
    if (p.a.length !== 1 || p.a[0].codec_name !== 'aac' || p.a[0].channels !== 2 || p.a[0].profile !== 'LC' || Number(p.a[0].sample_rate) !== 48000) bad.push('seg' + n + ' audio ' + JSON.stringify(p.a.map((x) => [x.codec_name, x.channels, x.sample_rate])));
    if (p.n !== 2) bad.push('seg' + n + ' stream count ' + p.n);
    if (Math.abs(vs - (media.TS_BASE + 4 * n)) > 0.1) bad.push('seg' + n + ' first PTS ' + vs.toFixed(3) + ' expected ~' + (media.TS_BASE + 4 * n));
    if (opts.maxW && (p.v.width > opts.maxW || p.v.height > opts.maxH)) bad.push('seg' + n + ' size ' + p.v.width + 'x' + p.v.height);
    if (opts.fps && n === 0) {
      const [a, b] = p.v.r_frame_rate.split('/').map(Number);
      if (Math.abs(a / b - opts.fps) > 0.2) bad.push('fps ' + p.v.r_frame_rate);
    }
    if (n > 0 && starts[n - 1] === starts[n - 1]) {
      const d = vs - starts[n - 1];
      if (Math.abs(d - 4) > 0.1 && n !== segCount) bad.push('seg' + n + ' gap ' + d.toFixed(3));
    }
  }
  const total = (Date.now() - t0) / 1000;
  return { bad, total, firstMs, dir };
}

// ---------------------------------------------------------------- tests
const tests = {};

tests.main = async () => {
  const src = path.join(SCR, 'test_hevc10.mkv');
  const pr = await media.probe(src);
  check('probe: video', pr.video.codec === 'hevc' && pr.video.pixFmt === 'yuv420p10le' && pr.video.width === 1920, JSON.stringify(pr.video));
  check('probe: 3 audio w/ langs', pr.audio.length === 3 && pr.audio.map((a) => a.lang).join() === 'eng,por,jpn' && pr.audio[1].channels === 6, JSON.stringify(pr.audio.map((a) => [a.index, a.aIdx, a.codec, a.channels, a.lang])));
  check('probe: 2 text subs', pr.subs.length === 2 && pr.subs.every((s) => s.text), JSON.stringify(pr.subs.map((s) => [s.index, s.sIdx, s.lang, s.codec])));
  check('probe: duration', Math.abs(pr.duration - 60) < 0.5, String(pr.duration));

  // 1. full session, audioIdx=1
  const t0 = Date.now();
  const s = await media.createSession({ url: src, probe: pr, audioIdx: 1, startSec: 0 });
  const pl = await get('/hls/' + s.id + '/index.m3u8');
  const plMs = Date.now() - t0;
  const txt = pl.body.toString();
  const lines = txt.split('\n');
  const okPl = lines[0] === '#EXTM3U' && txt.includes('#EXT-X-VERSION:3') && txt.includes('#EXT-X-TARGETDURATION:4') && txt.includes('#EXT-X-MEDIA-SEQUENCE:0')
    && txt.includes('#EXT-X-PLAYLIST-TYPE:VOD') && txt.trim().endsWith('#EXT-X-ENDLIST') && (txt.match(/#EXTINF:4\.000,\n\d+\.ts/g) || []).length === 15 && /#EXTINF:0\.\d+/.test(txt) === false
    && pl.headers['content-type'] === 'application/vnd.apple.mpegurl';
  check('playlist format (15 segs, VOD, ENDLIST)', okPl, 'ready in ' + plMs + ' ms; ' + lines.length + ' lines');
  const tAll0 = Date.now();
  const v = await validateAll('main', s.id, s.segCount);
  check('1. all 15 segments valid (h264 High yuv420p, aac LC 2ch 48k, PTS ~ base+4n, contiguous)', v.bad.length === 0, v.bad.slice(0, 5).join('; '));
  // audio is track 1 (880 Hz)
  const hz = toneHz(path.join(v.dir, '5.ts'));
  check('audio track = audioIdx 1 (880 Hz tone)', Math.abs(hz - 880) < 25, hz.toFixed(1) + ' Hz');
  const hz0 = toneHz(path.join(v.dir, '0.ts'));
  check('audio in segment 0 correct too', Math.abs(hz0 - 880) < 25, hz0.toFixed(1) + ' Hz');
  // 3. throughput
  const sess = media.getSession(s.id);
  const runs = sess.runs;
  const r0 = runs[0];
  console.log('INFO runs: ' + runs.map((r) => 'run' + r.id + ' start=' + r.startSeg + ' segs=' + r.produced + ' mode=' + r.mode).join(', '));
  const wall = (Date.now() - t0) / 1000;
  check('3. throughput >= 2x realtime (60 s content, session create -> last segment fetched)', 60 / wall >= 2, (60 / wall).toFixed(2) + 'x realtime (' + wall.toFixed(1) + ' s wall)');

  // 4. subtitles (the fixture muxer places the last SRT blocks at the very end of the file, so wait for the run to finish)
  for (let i = 0; i < 100 && sess.run; i++) await sleep(100);
  const c0 = media.getSubtitleCues(s.id, 0, 0, 60);
  const c1 = media.getSubtitleCues(s.id, 1, 0, 60);
  check('4. cues sIdx 0 (4 cues, multiline ok)', c0.length === 4 && c0[1][2] === 'Legenda A dois\nsegunda linha' && Math.abs(c0[1][0] - 10.5) < 0.05, JSON.stringify(c0));
  check('4. cues sIdx 1 (3 cues)', c1.length === 3 && c1[2][2] === 'Subtitle B three' && Math.abs(c1[2][0] - 45) < 0.05, JSON.stringify(c1));
  const cw = media.getSubtitleCues(s.id, 0, 12, 31);
  check('cue window filter', cw.length === 2, JSON.stringify(cw));
  media.destroySession(s.id);
};

tests.seek = async () => {
  const src = path.join(SCR, 'test_hevc10.mkv');
  const pr = await media.probe(src);
  const s = await media.createSession({ url: src, probe: pr, audioIdx: 0, startSec: 0 });
  // immediately ask for segment 12 on a fresh session
  const t0 = Date.now();
  const r = await get('/hls/' + s.id + '/12.ts');
  const ms = Date.now() - t0;
  fs.writeFileSync(path.join(SCR, 'seek12.ts'), r.body);
  const p = probeSeg(path.join(SCR, 'seek12.ts'));
  check('2. fresh session: segment 12 served < 10 s', r.status === 200 && ms < 10000, ms + ' ms, video start ' + p.v.start_time + ' (expect ~' + (1 + 48) + ')');
  check('2. seg 12 first PTS ~ base+48', Math.abs(Number(p.v.start_time) - 49) < 0.1 && p.v.profile === 'High' && p.v.pix_fmt === 'yuv420p');
  const t1 = Date.now();
  const r3 = await get('/hls/' + s.id + '/3.ts');
  const ms3 = Date.now() - t1;
  fs.writeFileSync(path.join(SCR, 'seek3.ts'), r3.body);
  const p3 = probeSeg(path.join(SCR, 'seek3.ts'));
  check('2. then segment 3 (backward restart) works', r3.status === 200 && Math.abs(Number(p3.v.start_time) - 13) < 0.1, ms3 + ' ms, start ' + p3.v.start_time);
  // after restart, neighbours of 3 should flow; and 12 stays served from cache
  const r4 = await get('/hls/' + s.id + '/4.ts');
  const r12 = await get('/hls/' + s.id + '/12.ts');
  check('cached seg 12 still identical after restarts', r12.status === 200 && r12.body.equals(r.body) && r4.status === 200);
  // sequential play of a few after seek: continuity across run boundary (seg 3..13)
  const v = await validateAll('seek', s.id, s.segCount);
  check('segments 0..14 valid after seeks (mixed runs; PTS continuity incl. run boundaries)', v.bad.length === 0, v.bad.slice(0, 5).join('; '));
  console.log('INFO runs: ' + media.getSession(s.id).runs.map((r) => 'run' + r.id + ' start=' + r.startSeg + ' segs=' + r.produced).join(', '));
  // subs merged across runs (wait for the final run: fixture puts last SRT blocks at the end of the file)
  for (let i = 0; i < 100 && media.getSession(s.id).run; i++) await sleep(100);
  const c0 = media.getSubtitleCues(s.id, 0, 0, 60);
  check('subtitle cues merged across restarts (sIdx 0 all 4 cues, no dupes)', c0.length === 4, JSON.stringify(c0.map((c) => c[0])));
  media.destroySession(s.id);
};

tests.startsec = async () => {
  const src = path.join(SCR, 'test_hevc10.mkv');
  const s = await media.createSession({ url: src, audioIdx: 2, startSec: 30 });
  const t0 = Date.now();
  const pl = await get('/hls/' + s.id + '/index.m3u8');
  const ms = Date.now() - t0;
  const r = await get('/hls/' + s.id + '/7.ts');
  check('startSec=30: playlist only after seg 7 ready; seg 7 served instantly', pl.status === 200 && r.ms < 300, 'playlist ' + ms + ' ms, seg7 ' + r.ms + ' ms');
  const p = (fs.writeFileSync(path.join(SCR, 'st7.ts'), r.body), probeSeg(path.join(SCR, 'st7.ts')));
  check('startSec=30 seg 7 PTS ~29', Math.abs(Number(p.v.start_time) - 29) < 0.1, p.v.start_time);
  check('audioIdx=2 tone 1320 Hz', Math.abs(toneHz(path.join(SCR, 'st7.ts')) - 1320) < 30);
  media.destroySession(s.id);
};

async function simple(label, file, opts, extra) {
  const url = file.startsWith('http') ? file : path.join(SCR, file);
  const t0 = Date.now();
  const s = await media.createSession(Object.assign({ url }, opts || {}));
  const v = await validateAll(label, s.id, s.segCount, extra);
  check(label + ': ' + s.segCount + ' segs valid', v.bad.length === 0 && v.total > 0, v.bad.slice(0, 4).join('; ') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  return s;
}

tests.formats = async () => {
  let s = await simple('vp9', 'test_vp9.webm', {}, { maxW: 1920, maxH: 1080, fps: 25 });
  media.destroySession(s.id);
  s = await simple('av1', 'test_av1.mkv', {}, { fps: 24 });
  check('av1 uses software decode mode', media.getSession(s.id).modeIdx === 1 || media.getSession(s.id).modeIdx >= 1, MODE(s.id));
  media.destroySession(s.id);
  s = await simple('720p60', 'test_720p60.mp4', {}, { fps: 30 });
  media.destroySession(s.id);
  s = await simple('noaudio', 'test_noaudio.mp4', {});
  const sil = path.join(SCR, 'out_noaudio', '1.ts');
  const p = probeSeg(sil);
  check('noaudio: silent AAC stereo track present', p.a.length === 1 && p.a[0].channels === 2, JSON.stringify(p.a.map((a) => a.codec_name)));
  media.destroySession(s.id);
};
function MODE(id) { const s = media.getSession(id); return s ? ('modeIdx=' + s.modeIdx) : ''; }

tests.subs = async () => {
  for (const f of ['test_subs.mkv', 'test_movtext.mp4']) {
    const pr = await media.probe(path.join(SCR, f));
    const s = await media.createSession({ url: path.join(SCR, f), probe: pr });
    const v = await validateAll('subs_' + f, s.id, s.segCount);
    const all = pr.subs.map((x) => JSON.stringify(media.getSubtitleCues(s.id, x.sIdx, 0, 100)));
    console.log('INFO ' + f + ' subs: ' + pr.subs.map((x) => x.codec).join(',') + ' => ' + all.join(' || '));
    const hasAss = f === 'test_subs.mkv';
    const first = media.getSubtitleCues(s.id, 0, 0, 100);
    if (hasAss) check('ASS cues stripped: no {\\} or \\N, newline kept', first.length === 2 && first[0][2] === 'Hello ASS world\nsecond line' && !/[{}\\]/.test(first[0][2]), JSON.stringify(first));
    else check('mov_text cues', first.length === 3 && first[0][2] === 'Subtitle B one', JSON.stringify(first));
    check(f + ': video segments ok', v.bad.length === 0, v.bad.slice(0, 3).join('; '));
    media.destroySession(s.id);
  }
};

tests.http = async () => {
  const srv = spawn('python3', ['-m', 'http.server', '18777', '--bind', '127.0.0.1', '--directory', SCR], { stdio: 'ignore' });
  await sleep(800);
  try {
    const url = 'http://127.0.0.1:18777/test_hevc10.mkv';
    const pr = await media.probe(url, { headers: { 'X-Test': '1' } });
    check('http probe', pr.video && pr.audio.length === 3 && pr.duration > 59, pr.duration);
    const t0 = Date.now();
    const s = await media.createSession({ url, probe: pr, audioIdx: 1, startSec: 0, headers: { 'X-Test': '1' } });
    const v = await validateAll('http', s.id, s.segCount);
    check('http source (no range support) segments valid', v.bad.length === 0, v.bad.slice(0, 3).join('; ') + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    const t1 = Date.now();
    const s2 = await media.createSession({ url, probe: pr, audioIdx: 0, startSec: 40 });
    const r = await get('/hls/' + s2.id + '/10.ts');
    check('http: createSession startSec=40, seg 10 served', r.status === 200, (Date.now() - t1) + ' ms');
    media.destroyAll();
  } finally { srv.kill('SIGKILL'); }
};

function pgrepFfmpeg() {
  try {
    return execFileSync('pgrep', ['-ax', 'ffmpeg']).toString().split('\n').filter((l) => l.includes('/tmp/spp/')).join('\n').trim();
  } catch (e) { return ''; }
}

tests.hygiene = async () => {
  const src = path.join(SCR, 'test_hevc10.mkv');
  const pr = await media.probe(src);
  const a = await media.createSession({ url: src, probe: pr });
  await sleep(300);
  const b = await media.createSession({ url: src, probe: pr, startSec: 20 });
  await sleep(300);
  const c = await media.createSession({ url: src, probe: pr, startSec: 40 });
  const ids = media.listSessions().map((x) => x.id);
  check('max 2 sessions (oldest evicted)', ids.length === 2 && !ids.includes(a.id) && ids.includes(b.id) && ids.includes(c.id), ids.join());
  await sleep(1000);
  const before = pgrepFfmpeg().split('\n').filter(Boolean).length;
  check('ffmpeg processes running while sessions live', before >= 1 && before <= 2, 'count=' + before);
  const dirs = fs.readdirSync('/tmp/spp').filter((d) => d.startsWith(process.pid + '-'));
  check('tmp dirs exist (2)', dirs.length === 2, dirs.join());
  // paused encoder (throttle): after destroy no strays at all
  media.destroyAll();
  await sleep(700);
  const after = pgrepFfmpeg();
  check('no stray ffmpeg after destroyAll', after === '', after);
  const dirs2 = fs.readdirSync('/tmp/spp').filter((d) => d.startsWith(process.pid + '-'));
  check('tmp dirs cleaned', dirs2.length === 0, dirs2.join());
  const r = await get('/hls/' + a.id + '/0.ts');
  check('destroyed session -> 404', r.status === 404);

  // exit hygiene: child process creates session then exits abruptly via process.exit
  const code = `const m=require(${JSON.stringify(path.resolve(__dirname, '../media.js'))});(async()=>{await m.createSession({url:${JSON.stringify(src)},startSec:0});setTimeout(()=>process.exit(0),1500)})()`;
  execFileSync('node', ['-e', code], { stdio: 'ignore' });
  await sleep(500);
  check('no stray ffmpeg after owner process.exit', pgrepFfmpeg() === '', pgrepFfmpeg());
  // SIGKILLed owner leaves orphan; startup cleanup in next load reaps it
  const code2 = `const m=require(${JSON.stringify(path.resolve(__dirname, '../media.js'))});m.createSession({url:${JSON.stringify(src)},startSec:0}).then(()=>setTimeout(()=>{},60000))`;
  const ch = spawn('node', ['-e', code2], { stdio: 'ignore' });
  await sleep(2500);
  ch.kill('SIGKILL');
  await sleep(500);
  const orphan = pgrepFfmpeg();
  execFileSync('node', ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../media.js'))})`]);
  await sleep(300);
  check('SIGKILLed owner: orphan ffmpeg existed then reaped on next load', orphan !== '' && pgrepFfmpeg() === '', 'orphan=' + (orphan ? 'yes' : 'no'));
};

(async () => {
  makeFixtures();
  await startFront();
  const names = only.length ? only : ['main', 'seek', 'startsec', 'formats', 'subs', 'http', 'hygiene'];
  for (const n of names) {
    console.log('\n=== ' + n + ' ===');
    try { await tests[n](); } catch (e) { check(n + ' threw', false, e.stack); }
    media.destroyAll();
  }
  await sleep(500);
  const stray = pgrepFfmpeg();
  check('final: no stray ffmpeg', stray === '', stray);
  console.log('\n' + (results.length - failures) + '/' + results.length + ' checks passed');
  front.close();
  process.exit(failures ? 1 : 0);
})();
