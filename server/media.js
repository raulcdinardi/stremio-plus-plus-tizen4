'use strict';
// Stremio++ media.js - on-demand VOD HLS transcoder (always H.264 High 8-bit + AAC-LC stereo, MPEG-TS, 4 s segments).
// Node built-ins only. See SPEC.md "media.js contract (agent A)".

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SEG = 4;                       // segment length (s)
const TS_BASE = 1;                   // constant MPEG-TS timestamp offset shared by every segment (s)
const TMP_ROOT = '/tmp/spp';
const VAAPI_DEV = '/dev/dri/renderD128';
const MAX_SESSIONS = 2;
const IDLE_MS = 3 * 60 * 60 * 1000; // was 10 min: a pause >10 min destroyed the session and resume failed (player error, 2026-11-20 22:55)
const WAIT_MS = 45000;
const AHEAD_NEAR = 6;                // a request within encoder.next+6 waits instead of restarting
const AHEAD_PAUSE = 30;              // pause encoder when 30 segments (120 s) ahead of last request
const AHEAD_RESUME = 24;
const MAX_SUB_TRACKS = 8;

function log(msg) { process.stderr.write('[media] ' + msg + '\n'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------------------------------------------------------------- housekeeping
const sessions = new Map();

function killPid(pid, sig) { try { process.kill(pid, sig || 'SIGKILL'); } catch (e) { /* gone */ } }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function startupCleanup() {
  try { fs.mkdirSync(TMP_ROOT, { recursive: true }); } catch (e) { /* ignore */ }
  // remove dirs of dead owners
  try {
    for (const d of fs.readdirSync(TMP_ROOT)) {
      const m = /^(\d+)-/.exec(d);
      if (m && !pidAlive(Number(m[1]))) fs.rmSync(path.join(TMP_ROOT, d), { recursive: true, force: true });
    }
  } catch (e) { /* ignore */ }
  // kill orphaned ffmpeg children of a dead server (not parented by a live node process)
  try {
    for (const p of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(p)) continue;
      let cmd;
      try { cmd = fs.readFileSync('/proc/' + p + '/cmdline', 'utf8'); } catch (e) { continue; }
      if (!cmd.startsWith('ffmpeg\0') && !cmd.includes('/ffmpeg\0')) continue;
      if (!cmd.includes(TMP_ROOT + '/')) continue;
      let ppid = 0;
      try { ppid = Number(fs.readFileSync('/proc/' + p + '/stat', 'utf8').replace(/^.*\) \S+ /, '').split(' ')[0]); } catch (e) { continue; }
      // Node renames its main thread to "MainThread", so check the parent's command line, not comm.
      let pcmd = '';
      try { pcmd = fs.readFileSync('/proc/' + ppid + '/cmdline', 'utf8'); } catch (e) { /* none */ }
      if (!/(^|\/)node(js)?\0/.test(pcmd)) { killPid(Number(p)); log('killed orphan ffmpeg pid ' + p); }
    }
  } catch (e) { /* ignore */ }
}
startupCleanup();

function killAllSync() {
  for (const s of sessions.values()) {
    if (s.run && s.run.proc && !s.run.ended) killPid(s.run.proc.pid, 'SIGKILL');
    try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}
process.on('exit', killAllSync);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    killAllSync();
    if (process.listenerCount(sig) <= 1) process.exit(0);
  });
}

setInterval(() => {
  const t = now();
  for (const s of [...sessions.values()]) {
    if (t - s.lastActivity > IDLE_MS) { log('session ' + s.id + ' idle, destroying'); destroySession(s.id); }
  }
}, 30000).unref();

// ---------------------------------------------------------------- input helpers
function isHttp(u) { return /^https?:\/\//i.test(u); }

function inputArgs(url, headers) {
  const a = [];
  if (isHttp(url)) {
    const h = Object.assign({}, headers || {});
    let ua = null;
    for (const k of Object.keys(h)) if (k.toLowerCase() === 'user-agent') { ua = h[k]; delete h[k]; }
    a.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '30000000');
    if (ua) a.push('-user_agent', String(ua));
    const hs = Object.keys(h).map((k) => k + ': ' + String(h[k]).replace(/[\r\n]/g, ' ') + '\r\n').join('');
    if (hs) a.push('-headers', hs);
  }
  return a;
}

// ---------------------------------------------------------------- probe
const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'subviewer', 'subviewer1', 'microdvd', 'jacosub', 'sami', 'realtext', 'stl', 'vplayer', 'mpl2', 'pjs']);

function parseRate(r) {
  if (!r) return 0;
  const m = /^(\d+)\/(\d+)$/.exec(r);
  if (!m) return Number(r) || 0;
  return Number(m[2]) ? Number(m[1]) / Number(m[2]) : 0;
}

function probe(url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters']
      .concat(inputArgs(url, opts.headers), ['-i', url]);
    const p = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; killPid(p.pid); reject(new Error('ffprobe timeout (40s)')); } }, 40000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    p.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    p.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (code !== 0) return reject(new Error('ffprobe failed: ' + err.trim().split('\n').pop()));
      let j;
      try { j = JSON.parse(out); } catch (e) { return reject(new Error('ffprobe bad json')); }
      try { resolve(summarize(j)); } catch (e) { reject(e); }
    });
  });
}

function summarize(j) {
  const streams = j.streams || [];
  const fmt = j.format || {};
  const res = { duration: 0, video: null, audio: [], subs: [], chapters: [] };
  let aIdx = 0; let sIdx = 0;
  for (const st of streams) {
    const tags = st.tags || {};
    const disp = st.disposition || {};
    if (st.codec_type === 'video') {
      if (disp.attached_pic || res.video) continue;
      const fpsRaw = (st.avg_frame_rate && parseRate(st.avg_frame_rate) > 0) ? st.avg_frame_rate : (st.r_frame_rate || '');
      let sar = 1;
      const m = /^(\d+):(\d+)$/.exec(st.sample_aspect_ratio || '');
      if (m && Number(m[2]) > 0 && Number(m[1]) > 0) sar = Number(m[1]) / Number(m[2]);
      res.video = {
        index: st.index, codec: st.codec_name, profile: st.profile || '', pixFmt: st.pix_fmt || '',
        width: st.width || 0, height: st.height || 0,
        fps: Math.round(parseRate(fpsRaw) * 1000) / 1000, fpsRaw, sar,
        transfer: st.color_transfer || '',
      };
    } else if (st.codec_type === 'audio') {
      res.audio.push({
        index: st.index, aIdx: aIdx++, codec: st.codec_name, channels: st.channels || 0,
        lang: tags.language || '', title: tags.title || '', default: !!disp.default,
      });
    } else if (st.codec_type === 'subtitle') {
      res.subs.push({
        index: st.index, sIdx: sIdx++, codec: st.codec_name, lang: tags.language || '', title: tags.title || '',
        text: TEXT_SUBS.has(st.codec_name), forced: !!disp.forced,
      });
    }
  }
  // Prefer the real A/V stream durations: container duration can be inflated by subtitle tracks/padding.
  const sdur = (st) => {
    let d = Number(st.duration) || 0;
    const t = st.tags && (st.tags.DURATION || st.tags['DURATION-eng']);
    if (!d && t) { const m = /^(\d+):(\d+):([\d.]+)/.exec(t); if (m) d = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); }
    return d;
  };
  let dur = 0;
  for (const st of streams) {
    if ((st.codec_type === 'video' && res.video && st.index === res.video.index) || st.codec_type === 'audio') dur = Math.max(dur, sdur(st));
  }
  const fd = Number(fmt.duration) || 0;
  if (!dur || (fd && dur > fd)) dur = fd || dur;
  res.duration = dur;
  for (const c of (j.chapters || [])) {
    res.chapters.push({ start: Number(c.start_time) || 0, end: Number(c.end_time) || 0, title: (c.tags && c.tags.title) || '' });
  }
  return res;
}

// ---------------------------------------------------------------- encoder configuration
// Data saver variants (POST /api/play saver:true): <=720p, ~1 Mbps video + 80 kbps AAC, fragmented MP4 segments.
const SAVER = {
  hevc: { vaapi: 'hevc_vaapi', vaapiProfile: 'main', tag: 'hvc1', b: '1M', max: '1.5M', buf: '3M' },
  h264: { vaapi: 'h264_vaapi', vaapiProfile: 'high', tag: null, b: '1.4M', max: '2M', buf: '4M' },
};
const SAVER_AUDIO = '80k';
function bitDepth(pixFmt) { const m = /(10|12|16)(?:le|be)?$/.exec(pixFmt || ''); return m ? Number(m[1]) : 8; }

function pickFps(v) {
  const num = v.fps || 0;
  const raw = v.fpsRaw || '';
  if (!(num > 0) || num > 240) return '25';
  if (num <= 30.5) return /^\d+(\/\d+)?$/.test(raw) ? raw : String(num);
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (num >= 46 && num <= 62) return m ? m[1] + '/' + (Number(m[2]) * 2) : String(num / 2);
  return '30';
}

// Decode/encode strategies, tried in order; a run that dies without producing a segment advances the index.
const MODES = [
  { name: 'vaapi-hwdec', dec: 'hw', enc: 'vaapi', rc: 'vbr' },
  { name: 'vaapi-swdec', dec: 'sw', enc: 'vaapi', rc: 'vbr' },
  { name: 'vaapi-cqp', dec: 'sw', enc: 'vaapi', rc: 'cqp' },
  { name: 'x264', dec: 'sw', enc: 'x264', rc: 'vbr' },
];

function initialMode(video) {
  if (!video) return 1;
  const c = video.codec;
  const hwOk = ['h264', 'hevc', 'vp9', 'mpeg2video', 'vc1', 'vp8'].includes(c);
  const depth = bitDepth(video.pixFmt);
  if (!hwOk) return 1;
  if (c === 'h264' && (depth > 8 || /444|422/.test(video.pixFmt))) return 1;
  if (c === 'hevc' && /444|422/.test(video.pixFmt)) return 1;
  if (c === 'vp8') return 1;
  return 0;
}

function selectSubs(probeSubs) {
  const score = (s) => {
    const l = (s.lang || '').toLowerCase();
    if (/^(pt|por|pob|ptb|pt-br)/.test(l)) return 0;
    if (/^(en|eng)/.test(l)) return 1;
    if (!l || l === 'und') return 2;
    return 3;
  };
  return (probeSubs || []).filter((s) => s.text).map((s, i) => ({ s, i, sc: score(s) }))
    .sort((a, b) => a.sc - b.sc || a.i - b.i).slice(0, MAX_SUB_TRACKS).map((x) => x.s.sIdx);
}

function buildArgs(s, run) {
  const v = s.probe.video;
  const mode = MODES[s.modeIdx];
  const a = ['-nostdin', '-hide_banner', '-loglevel', 'warning', '-nostats'];
  if (mode.dec === 'hw') a.push('-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEV);
  if (mode.enc === 'vaapi' && mode.dec === 'sw') a.push('-init_hw_device', 'vaapi=va:' + VAAPI_DEV, '-filter_hw_device', 'va');
  if (mode.dec === 'sw' && v && v.codec === 'av1') a.push('-c:v', 'libdav1d');
  a.push.apply(a, inputArgs(s.url, s.headers));
  if (run.startSeg > 0) a.push('-ss', String(run.startSeg * SEG));
  a.push('-i', s.url);
  if (s.audioUrl) {
    // external audio track (Ocean Cut dub, or a dub from another release): video_t = ratio * audio_t + offset
    const vt = run.startSeg * SEG, at = (vt - (s.audioOffset || 0)) / (s.audioRatio || 1);
    if (at > 0) a.push('-ss', at.toFixed(3));
    else if (at < 0) a.push('-itsoffset', (-at * (s.audioRatio || 1)).toFixed(3));
    a.push('-i', s.audioUrl);
  } else if (s.silent) a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');

  // video
  const vf = [];
  const SV = s.saver ? SAVER[s.saverCodec] || SAVER.h264 : null;
  if (v && SV) {
    // data saver: <= 720p, keep the aspect (4:3 etc. get bars so the player never stretches)
    if (v.sar && Math.abs(v.sar - 1) > 0.01) vf.push('scale=trunc(iw*sar/2)*2:ih', 'setsar=1');
    const dar = v.width && v.height ? (v.width * (v.sar || 1)) / v.height : 16 / 9;
    if (Math.abs(dar - 16 / 9) > 0.05) vf.push('scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2', 'pad=1280:720:(ow-iw)/2:(oh-ih)/2:black', 'setsar=1');
    else vf.push("scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
  } else if (v) {
    if (v.sar && Math.abs(v.sar - 1) > 0.01) vf.push('scale=trunc(iw*sar/2)*2:ih', 'setsar=1');
    const dar = v.width && v.height ? (v.width * (v.sar || 1)) / v.height : 16 / 9;
    if (s.party) {
      // watch-along viewer encode: <=720p, the browser letterboxes by itself
      vf.push("scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
    } else if (Math.abs(dar - 16 / 9) > 0.05) {
      // Not 16:9 (e.g. 4:3): fit inside 1920x1080 and add black bars, so the TV never stretches/zooms it.
      vf.push("scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2", 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black', 'setsar=1');
    } else {
      vf.push("scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
    }
  }
  vf.push('fps=' + pickFps(v || {}));
  const kf = ['-force_key_frames', 'expr:gte(t,n_forced*' + SEG + ')'];
  a.push('-map', '0:v:0');
  if (SV) {
    if (mode.enc === 'vaapi') {
      vf.push('format=nv12', 'hwupload');
      a.push('-vf', vf.join(','), '-c:v', SV.vaapi, '-profile:v', SV.vaapiProfile);
      a.push('-b:v', SV.b, '-maxrate', SV.max, '-bufsize', SV.buf);
    } else {
      vf.push('format=yuv420p');
      a.push('-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level', '4.0',
        '-b:v', SV.b, '-maxrate', SV.max, '-bufsize', SV.buf, '-sc_threshold', '0');
    }
    a.push('-g', '240');
    if (SV.tag && mode.enc === 'vaapi') a.push('-tag:v', SV.tag);
  } else if (mode.enc === 'vaapi') {
    vf.push('format=nv12', 'hwupload');
    a.push('-vf', vf.join(','), '-c:v', 'h264_vaapi', '-profile:v', 'high');
    // Through the VPS relay the home upload (~20 Mbps) is the limit, so cap lower there.
    if (s.party) a.push('-b:v', '2300k', '-maxrate', '3M', '-bufsize', '6M');
    else if (s.lowBw) a.push('-b:v', '7M', '-maxrate', '9M', '-bufsize', '14M');
    else if (mode.rc === 'cqp') a.push('-qp', '18'); else a.push('-b:v', '14M', '-maxrate', '20M', '-bufsize', '28M');
    a.push('-g', '240');
  } else {
    vf.push('format=yuv420p');
    a.push('-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level', '4.1',
      '-crf', s.party ? '23' : '18', '-maxrate', s.party ? '3M' : s.lowBw ? '9M' : '20M', '-bufsize', s.party ? '6M' : s.lowBw ? '14M' : '28M', '-g', '240', '-sc_threshold', '0');
  }
  a.push.apply(a, kf);

  // audio
  if (s.audioUrl) a.push('-map', '1:a:' + (s.audioIdxExt || 0), '-af', (s.audioRatio && s.audioRatio !== 1 ? 'atempo=' + (1 / s.audioRatio).toFixed(6) + ',' : '') + 'aresample=48000:async=1:first_pts=0');
  else if (s.silent) a.push('-map', '1:a', '-shortest');
  else a.push('-map', '0:a:' + s.audioIdx, '-af', 'aresample=48000:async=1:first_pts=0');
  a.push('-c:a', 'aac', '-profile:a', 'aac_low', '-ac', '2', '-ar', '48000', '-b:a', SV ? SAVER_AUDIO : s.party ? '128k' : '160k');

  // mux: segments named by absolute index, constant timestamp offset
  if (SV) {
    // fragmented MP4 (HEVC needs it for MSE/hls.js); one init.mp4 per run, segments seg_<n>.m4s
    a.push('-output_ts_offset', String(run.startSeg * SEG + TS_BASE),
      '-f', 'hls', '-hls_time', String(SEG), '-hls_segment_type', 'fmp4', '-hls_flags', 'temp_file+independent_segments',
      '-hls_list_size', '0', '-start_number', String(run.startSeg), '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', path.join(run.dir, 'seg_%d.m4s'), path.join(run.dir, 'pl.m3u8'));
  } else a.push('-muxdelay', '0', '-muxpreload', '0', '-output_ts_offset', String(run.startSeg * SEG + TS_BASE),
    '-f', 'segment', '-segment_format', 'mpegts', '-segment_time', String(SEG),
    '-segment_start_number', String(run.startSeg), '-break_non_keyframes', '0',
    '-segment_list', 'pipe:1', '-segment_list_type', 'flat',
    path.join(run.dir, 'seg_%d.ts'));

  // text subtitle side outputs (progressive)
  for (const k of s.subTracks) {
    a.push('-map', '0:s:' + k, '-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', path.join(run.dir, 'sub_' + k + '.vtt'));
  }
  return a;
}

// ---------------------------------------------------------------- session / run management
function startRun(s, startSeg) {
  if (s.destroyed) return null;
  const mode = MODES[s.modeIdx];
  const run = {
    id: ++s.runSeq, startSeg, next: startSeg, produced: 0, paused: false, ended: false, killed: false,
    dir: path.join(s.dir, 'r' + s.runSeq), proc: null, t0: now(), buf: '', errTail: [], mode: mode.name,
  };
  fs.mkdirSync(run.dir, { recursive: true });
  const args = buildArgs(s, run);
  const env = Object.assign({}, process.env, { LIBVA_DRIVER_NAME: 'iHD' });
  let proc;
  try {
    proc = spawn('ffmpeg', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { log('spawn failed: ' + e.message); s.fatal = 'spawn failed: ' + e.message; return null; }
  run.proc = proc;
  s.run = run;
  s.runs.push(run);
  log('session ' + s.id + ' run ' + run.id + ' start seg ' + startSeg + ' (' + (startSeg * SEG) + 's) mode ' + mode.name);
  if (s.fmp4) watchFmp4(s, run);
  else proc.stdout.on('data', (d) => {
    run.buf += d;
    let i;
    while ((i = run.buf.indexOf('\n')) >= 0) {
      const line = run.buf.slice(0, i).trim(); run.buf = run.buf.slice(i + 1);
      const m = /seg_(\d+)\.ts$/.exec(line);
      if (m) onSegment(s, run, Number(m[1]));
    }
  });
  let eb = '';
  proc.stderr.on('data', (d) => {
    eb += d;
    let i;
    while ((i = eb.indexOf('\n')) >= 0) {
      const line = eb.slice(0, i).trim(); eb = eb.slice(i + 1);
      if (line) { run.errTail.push(line); if (run.errTail.length > 15) run.errTail.shift(); }
    }
  });
  proc.on('error', (e) => { log('ffmpeg error: ' + e.message); });
  proc.on('close', (code, sig) => onRunExit(s, run, code, sig));
  return run;
}

// fMP4 (saver) runs: the hls muxer writes seg_<n>.m4s.tmp and renames it when complete; poll for finished ones.
function watchFmp4(s, run) {
  const seen = new Set();
  const scan = () => {
    let names; try { names = fs.readdirSync(run.dir); } catch (e) { return; }
    const ks = names.map((f) => /^seg_(\d+)\.m4s$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).filter((k) => !seen.has(k)).sort((x, y) => x - y);
    for (const k of ks) { seen.add(k); if (!fs.existsSync(path.join(s.dir, 'init.mp4'))) { try { fs.copyFileSync(path.join(run.dir, 'init.mp4'), path.join(s.dir, 'init.mp4')); } catch (e) { /* retry next scan */ seen.delete(k); return; } } onSegment(s, run, k); }
  };
  run.watch = setInterval(scan, 150);
  run.scan = scan;
}

function onSegment(s, run, k) {
  if (run.killed || s.destroyed) return;
  const ext = s.fmp4 ? '.m4s' : '.ts';
  const src = path.join(run.dir, 'seg_' + k + ext);
  const dst = path.join(s.dir, k + ext);
  try {
    if (s.done.has(k)) fs.unlinkSync(src);
    else { fs.renameSync(src, dst); s.done.add(k); }
  } catch (e) { log('segment ' + k + ' move failed: ' + e.message); return; }
  run.produced++;
  run.next = k + 1;
  if (k + 1 < s.segCount && s.done.has(k + 1) && !run.killed) {
    log('session ' + s.id + ' run ' + run.id + ' reached cached seg ' + (k + 1) + ', stopping');
    killRun(run);
    return;
  }
  throttle(s);
}

function onRunExit(s, run, code, sig) {
  run.ended = true;
  if (run.watch) { try { run.scan(); } catch (e) { /* ignore */ } clearInterval(run.watch); run.watch = null; }
  // drain any final list lines
  if (run.buf.trim()) { const m = /seg_(\d+)\.ts$/.exec(run.buf.trim()); if (m) onSegment(s, run, Number(m[1])); run.buf = ''; }
  const secs = (now() - run.t0) / 1000;
  const rt = run.produced ? ((run.produced * SEG) / secs).toFixed(2) : '0';
  log('session ' + s.id + ' run ' + run.id + ' exit code=' + code + ' sig=' + sig + ' segs=' + run.produced + ' in ' + secs.toFixed(1) + 's (' + rt + 'x realtime)');
  if (s.run === run) s.run = null;
  if (s.destroyed || run.killed) return;
  if (code === 0) {
    // clean EOF: source ended earlier than the declared duration
    if (run.next < s.segCount) s.eof = Math.min(s.eof, Math.max(run.next, run.startSeg));
    return;
  }
  const tail = run.errTail.slice(-4).join(' | ');
  log('session ' + s.id + ' ffmpeg failed (mode ' + run.mode + '): ' + tail);
  if (run.produced === 0) {
    if (s.modeIdx < MODES.length - 1) {
      s.modeIdx++;
      log('session ' + s.id + ' falling back to mode ' + MODES[s.modeIdx].name);
      startRun(s, run.startSeg);
    } else {
      s.fatal = 'ffmpeg failed: ' + tail;
    }
  }
}

function killRun(run) {
  if (!run || run.ended || run.killed) return;
  run.killed = true;
  if (run.proc) killPid(run.proc.pid, 'SIGKILL');
  if (run.watch) { clearInterval(run.watch); run.watch = null; }
}

function throttle(s) {
  const r = s.run;
  if (!r || r.ended || r.killed || !r.proc) return;
  const ahead = r.next - s.lastReq;
  if (!r.paused && ahead > AHEAD_PAUSE) { r.paused = true; killPid(r.proc.pid, 'SIGSTOP'); }
  else if (r.paused && ahead <= AHEAD_RESUME) { r.paused = false; killPid(r.proc.pid, 'SIGCONT'); }
}

function resumeRun(r) { if (r && r.paused) { r.paused = false; killPid(r.proc.pid, 'SIGCONT'); } }

// make sure segment n is (or will be) produced by an appropriate encoder
function ensureEncoder(s, n) {
  const r = s.run;
  if (r && !r.ended && !r.killed) {
    if (n >= r.startSeg && n <= r.next + AHEAD_NEAR) { throttle(s); return; }
    log('session ' + s.id + ' seek: seg ' + n + ' outside encoder window [' + r.startSeg + '..' + (r.next + AHEAD_NEAR) + '], restarting');
    killRun(r);
    s.run = null;
  }
  startRun(s, n);
}

// periodic: keep ~120 s buffered ahead of last request, resume paused encoders
function tick(s) {
  if (s.destroyed) return;
  const r = s.run;
  if (r && !r.ended && !r.killed) { throttle(s); return; }
  if (s.fatal) return;
  let n = s.lastReq;
  const lim = Math.min(s.segCount, s.lastReq + AHEAD_RESUME);
  while (n < lim && s.done.has(n)) n++;
  if (n < lim && n < s.eof) startRun(s, n);
}

async function ensureSegment(s, n, aborted) {
  if (n < 0 || n >= s.segCount || n >= s.eof) throw Object.assign(new Error('segment out of range'), { status: 404 });
  s.lastActivity = now();
  s.lastReq = n;
  const t0 = now();
  while (true) {
    if (s.destroyed) throw Object.assign(new Error('session destroyed'), { status: 410 });
    if (s.done.has(n)) return path.join(s.dir, n + (s.fmp4 ? '.m4s' : '.ts'));
    if (s.fatal) throw Object.assign(new Error(s.fatal), { status: 500 });
    if (aborted && aborted()) throw Object.assign(new Error('aborted'), { status: 499 });
    if (now() - t0 > WAIT_MS) throw Object.assign(new Error('timeout waiting for segment ' + n), { status: 504 });
    if (n >= s.eof) throw Object.assign(new Error('segment beyond end of source'), { status: 404 });
    ensureEncoder(s, n);
    await sleep(40);
    s.lastActivity = now();
  }
}

// ---------------------------------------------------------------- public API: sessions
async function createSession(opts) {
  opts = opts || {};
  if (!opts.url) throw new Error('url required');
  const pr = opts.probe || await probe(opts.url, { headers: opts.headers });
  const duration = pr.duration;
  if (!(duration > 0)) throw new Error('unknown duration');
  if (!pr.video) throw new Error('no video stream');

  while (sessions.size >= MAX_SESSIONS) {
    let oldest = null;
    for (const x of sessions.values()) if (!oldest || x.lastActivity < oldest.lastActivity) oldest = x;
    log('max sessions reached, evicting ' + oldest.id);
    destroySession(oldest.id);
  }

  let audioIdx = Number.isInteger(opts.audioIdx) ? opts.audioIdx : null;
  const na = pr.audio ? pr.audio.length : 0;
  if (audioIdx === null || audioIdx < 0 || audioIdx >= na) {
    const d = (pr.audio || []).find((x) => x.default);
    audioIdx = d ? d.aIdx : 0;
  }
  const id = crypto.randomBytes(5).toString('hex');
  const dir = path.join(TMP_ROOT, process.pid + '-' + id);
  fs.mkdirSync(dir, { recursive: true });
  // a container-duration tail shorter than 0.3 s is padding (no real frames): do not advertise a segment for it
  const segCount = Math.max(1, Math.ceil((duration - 0.3) / SEG));
  const startSeg = Math.min(segCount - 1, Math.max(0, Math.floor((Number(opts.startSec) || 0) / SEG)));
  const s = {
    saver: !!opts.saver, saverCodec: opts.saver && Array.isArray(opts.codecs) && opts.codecs.map(String).map((c) => c.toLowerCase()).some((c) => c === 'hevc' || c === 'h265') ? 'hevc' : 'h264',
    fmp4: !!opts.saver,
    party: !!opts.party, lowBw: !!opts.lowBandwidth, audioUrl: opts.audioUrl || null, audioIdxExt: opts.audioIdxExt || 0, audioOffset: opts.audioOffset || 0, audioRatio: opts.audioRatio || 1,
    id, url: opts.url, headers: opts.headers || {}, probe: pr, duration, segCount, startSeg, audioIdx,
    silent: na === 0, dir, done: new Set(), run: null, runs: [], runSeq: 0, modeIdx: initialMode(pr.video),
    subTracks: selectSubs(pr.subs), subCache: new Map(), eof: Infinity, fatal: null, destroyed: false,
    lastReq: startSeg, lastActivity: now(), created: now(),
  };
  sessions.set(id, s);
  s.timer = setInterval(() => tick(s), 700);
  s.timer.unref();
  log('session ' + id + ' created: ' + duration.toFixed(1) + 's, ' + segCount + ' segs, audio a:' + audioIdx + (s.silent ? ' (silent)' : '') +
    ', subs [' + s.subTracks.join(',') + '], start seg ' + startSeg + ', ' + pr.video.codec + ' ' + pr.video.width + 'x' + pr.video.height + ' ' + pr.video.pixFmt);
  startRun(s, startSeg);
  return { id, duration, segCount, audioIdx };
}

function getSession(id) { return sessions.get(id) || null; }

function destroySession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  s.destroyed = true;
  clearInterval(s.timer);
  for (const r of s.runs) killRun(r);
  sessions.delete(id);
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  // directory removal races a dying ffmpeg that may recreate nothing, but sweep once more shortly
  setTimeout(() => { try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }, 500).unref();
  log('session ' + id + ' destroyed');
  return true;
}

function destroyAll() { for (const id of [...sessions.keys()]) destroySession(id); }

// ---------------------------------------------------------------- HTTP handlers
function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); }

function fail(res, status, msg) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* ignore */ } return; }
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(String(msg));
}

function playlistText(s) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:' + (s.fmp4 ? 7 : 3), '#EXT-X-TARGETDURATION:' + SEG, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  if (s.fmp4) lines.push('#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-MAP:URI="init.mp4"');
  for (let n = 0; n < s.segCount; n++) {
    const d = n === s.segCount - 1 ? s.duration - SEG * (s.segCount - 1) : SEG;
    lines.push('#EXTINF:' + Math.max(0.001, Math.min(SEG, d)).toFixed(3) + ',', n + (s.fmp4 ? '.m4s' : '.ts'));
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

async function handlePlaylist(req, res, id) {
  const s = sessions.get(id);
  if (!s) return fail(res, 404, 'no such session');
  let closed = false;
  req.on('close', () => { closed = true; });
  try {
    await ensureSegment(s, s.startSeg, () => closed);
  } catch (e) { return fail(res, e.status || 500, e.message); }
  const body = playlistText(s);
  cors(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(req.method === 'HEAD' ? undefined : body);
}

// fMP4 (saver) sessions: the shared init segment, available once the first segment exists
async function handleInit(req, res, id) {
  const s = sessions.get(id);
  if (!s || !s.fmp4) return fail(res, 404, 'no such session');
  const f = path.join(s.dir, 'init.mp4');
  let st;
  try { st = fs.statSync(f); } catch (e) { return fail(res, 404, 'init not ready'); }
  cors(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', st.size);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).pipe(res);
}

async function handleSegment(req, res, id, n) {
  const s = sessions.get(id);
  n = Number(n);
  if (!s) return fail(res, 404, 'no such session');
  if (!Number.isInteger(n)) return fail(res, 400, 'bad segment');
  let closed = false;
  res.on('close', () => { closed = true; });
  let file;
  try { file = await ensureSegment(s, n, () => closed); } catch (e) { return fail(res, e.status || 500, e.message); }
  let st;
  try { st = fs.statSync(file); } catch (e) { return fail(res, 404, 'segment vanished'); }
  let start = 0; let end = st.size - 1; let status = 200;
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rg && (rg[1] || rg[2])) {
    if (rg[1]) { start = Number(rg[1]); if (rg[2]) end = Math.min(end, Number(rg[2])); }
    else { start = Math.max(0, st.size - Number(rg[2])); }
    if (start > end) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + st.size); return res.end(); }
    status = 206;
  }
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', s.fmp4 ? 'video/mp4' : 'video/MP2T');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', end - start + 1);
  if (status === 206) res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + st.size);
  if (req.method === 'HEAD') return res.end();
  const rs = fs.createReadStream(file, { start, end });
  rs.on('error', () => { try { res.destroy(); } catch (e) { /* ignore */ } });
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}

// ---------------------------------------------------------------- subtitles
function ts2s(t) {
  const m = /^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/.exec(t);
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number('0.' + m[4]);
}

function cleanCueText(t) {
  return t.replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

function parseVtt(text, offset) {
  const out = [];
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].includes('-->')) i++;
    if (i >= lines.length) continue;
    const m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[i]);
    if (!m) continue;
    const st = ts2s(m[1]); const en = ts2s(m[2]);
    if (!isFinite(st) || !isFinite(en)) continue;
    const tx = cleanCueText(lines.slice(i + 1).join('\n'));
    if (!tx) continue;
    out.push([Math.round((st + offset) * 1000) / 1000, Math.round((en + offset) * 1000) / 1000, tx]);
  }
  return out;
}

// Longest contiguous stretch of already-transcoded segments inside [fromSec, toSec): the audio that is being
// played, already on disk (used by subtitle sync / dub alignment instead of re-reading the source).
function segmentRun(id, fromSec, toSec) {
  const s = sessions.get(id);
  if (!s) return null;
  s.lastActivity = now();
  const a = Math.max(0, Math.floor(fromSec / SEG)), b = Math.ceil(toSec / SEG);
  let best = null, cur = null;
  for (let k = a; k < b; k++) {
    if (s.done.has(k)) {
      cur = cur ? { a: cur.a, b: k + 1 } : { a: k, b: k + 1 };
      if (!best || cur.b - cur.a > best.b - best.a) best = cur;
    } else cur = null;
  }
  if (!best) return null;
  const files = [];
  if (s.fmp4) files.push(path.join(s.dir, 'init.mp4'));
  for (let k = best.a; k < best.b; k++) files.push(path.join(s.dir, k + (s.fmp4 ? '.m4s' : '.ts')));
  return { t0: best.a * SEG, dur: (best.b - best.a) * SEG, files };
}

function getSubtitleCues(id, sIdx, fromSec, toSec) {
  const s = sessions.get(id);
  if (!s || !s.subTracks.includes(Number(sIdx))) return [];
  s.lastActivity = now();
  const from = Number.isFinite(Number(fromSec)) ? Number(fromSec) : 0;
  const to = Number.isFinite(Number(toSec)) ? Number(toSec) : Infinity;
  const merged = new Map();
  for (const r of s.runs) {
    const f = path.join(r.dir, 'sub_' + sIdx + '.vtt');
    let st;
    try { st = fs.statSync(f); } catch (e) { continue; }
    const key = r.id + ':' + sIdx;
    let c = s.subCache.get(key);
    if (!c || c.size !== st.size) {
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
      // ignore a trailing partially written cue (no terminating blank line) while the run is alive
      if (!r.ended) { const i = txt.lastIndexOf('\n\n'); if (i >= 0) txt = txt.slice(0, i + 2); }
      c = { size: st.size, cues: parseVtt(txt, r.startSeg * SEG) };
      s.subCache.set(key, c);
    }
    for (const q of c.cues) merged.set(q[0] + '|' + q[1] + '|' + q[2], q);
  }
  return [...merged.values()].filter((q) => q[1] > from && q[0] < to).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ---------------------------------------------------------------- misc / introspection
function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id, url: s.url.replace(/\?.*$/, ''), duration: s.duration, segments: s.segCount, done: s.done.size,
    mode: MODES[s.modeIdx].name + (s.saver ? '+saver-' + s.saverCodec : ''), audioIdx: s.audioIdx, idleSec: Math.round((now() - s.lastActivity) / 1000),
  }));
}

module.exports = {
  probe, createSession, getSession, destroySession, destroyAll, handlePlaylist, handleSegment, handleInit, getSubtitleCues, segmentRun,
  listSessions, SEG, TS_BASE, _internal: { playlistText, ensureSegment, parseVtt, cleanCueText, buildArgs, pickFps },
};
