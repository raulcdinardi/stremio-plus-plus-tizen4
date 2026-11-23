# Stremio++ — minimal Stremio replacement for Samsung UN55NU7100 (Tizen 4.0)

Goal: TV never crashes. The TV app is a thin, instant remote-control UI; the server (home PC "casa",
Linux, i5-7400 + Intel HD 630 VAAPI) does everything else and always hands the TV ONE proven-safe format.

## Hard facts (measured on this TV, do not re-litigate)
- TV RAM 963 MiB total, ~200–340 MiB available in normal use. App/TV dies when available RAM collapses.
- SAFE: raw AVPlay + HLS, MPEG-TS segments, H.264 High 8-bit ≤1080p + AAC-LC stereo, ONE audio track,
  no subtitle tracks in the stream. Start ~1.5 s, seek ~2 s, RAM steady.
- UNSAFE (crash/freeze): MKV with many audio/sub tracks, HEVC Main10 (froze TV after 5 min), AV1
  (unsupported), fMP4 HLS, multi-rendition HLS. => the TV only ever receives the SAFE format.
- Tizen 4.0 web runtime = Chromium ~56: ES2017 OK (async/await, arrow, classes, template strings).
  NO optional chaining, NO nullish coalescing, NO object spread in literals, NO CSS grid gap quirks
  (use flexbox), NO `fetch` streaming, NO ES modules. Single concatenated script is fine.

## Topology
- Server: Node 24, zero npm deps, at `<repo>/server`, listens `0.0.0.0:8790`.
- Torrent engine: Stremio server.js already running as user service a user service for the torrent engine on
  `http://127.0.0.1:11470` (`GET /{infoHash}/{fileIdx}` = HTTP range stream of that file;
  `/{infoHash}/create` etc. as standard Stremio server).
- ffmpeg/ffprobe system binaries. Encoding env: `LIBVA_DRIVER_NAME=iHD`, device `/dev/dri/renderD128`.
- State dir `<repo>/state` (sqlite via `node:sqlite`, image cache, transcode tmp under `/tmp/spp`).
- Secrets: `<repo>/secrets.json` (mode 600) `{stremioAuthKey, traktClientId?, traktClientSecret?,
  traktToken?}`. Never log or return secrets.

## Server modules (files under <repo>/server)
- `server.js` HTTP router + static serving of `../app` at `/app/` (for desktop-browser testing).
- `media.js` transcoder/HLS session manager (owned by agent A).
- `api/*.js` metadata, streams, library, subtitles, skip, images, sources, admin (agent B).
Shared helpers in `util.js` (agent B creates; A may only use node built-ins).

### media.js contract (agent A)
```js
const media = require('./media');
// probe: ffprobe JSON summary, timeout 25 s
await media.probe(url, {headers}) -> {duration, video:{codec,profile,pixFmt,width,height,fps},
   audio:[{index(absolute stream idx), aIdx(0-based among audio), codec, channels, lang, title, default}],
   subs:[{index, sIdx, codec, lang, title, text:bool, forced:bool}], chapters:[{start,end,title}]}
// session: on-demand VOD HLS
const s = await media.createSession({url, headers, probe, audioIdx, startSec}) -> {id, duration}
media.getSession(id); media.destroySession(id); media.destroyAll();
// HTTP handlers (server.js routes /hls/:id/index.m3u8 and /hls/:id/:n.ts to these)
media.handlePlaylist(req,res,id); media.handleSegment(req,res,id,n);
// embedded text subtitles extracted progressively by the same ffmpeg run (or a parallel cheap one):
media.getSubtitleCues(id, sIdx, fromSec, toSec) -> [[start,end,text],...]  // text plain, \n allowed
```
Rules:
- Segment length exactly 4 s (last one shorter). Playlist is complete VOD from the start
  (`#EXT-X-PLAYLIST-TYPE:VOD`, all segments, `#EXT-X-ENDLIST`), `#EXT-X-TARGETDURATION:4`, version 3,
  media sequence 0. Segment n covers [4n, 4n+4).
- ALWAYS re-encode video: h264_vaapi High, 8-bit nv12, ≤1920x1080 (keep aspect, even dims), fps ≤ 30
  if source >30 (else keep), bitrate 6 Mbps VBR maxrate 8M (fallback to CQP qp 23 if driver
  refuses VBR), GOP forced keyframe exactly at every 4 s boundary. Fallback to libx264 veryfast if
  VAAPI init fails (decode errors must not kill the session silently: log & fallback).
  Hardware decode when possible (`-hwaccel vaapi`), else software decode (AV1 via libdav1d).
- Audio: chosen track → AAC-LC 2ch 48 kHz 160k. Video-only sources get a silent AAC track.
- Timestamps: segment n's first PTS must be within ±0.1 s of 4n (plus the constant MPEG-TS offset that
  every segment shares; AVPlay needs continuity). Use `-f segment` / `-segment_start_number` /
  `-output_ts_offset` / `-muxdelay 0` or equivalent — verify with ffprobe.
- On-demand: a request for segment n that is not produced and not within the next ~6 segments of the
  running encoder kills the encoder and restarts at 4n (input `-ss` fast seek). Requests block (up to
  45 s) until the file exists and is complete. Keep at most ~120 s of segments ahead of the most
  recently requested one (pause encoder via SIGSTOP/SIGCONT or just let it finish; disk is fine).
  Delete session dir on destroy. Idle session (no request 10 min) auto-destroyed. Max 2 sessions.
- `index.m3u8` responds only once segment `startSec/4` is ready (so the player never waits on a
  missing first segment).
- Input may be: local file path, http(s) URL (range-capable or not), with optional headers.
  Use `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5` for http.
Acceptance (agent A must run and report):
 1. Synthetic 60 s HEVC Main10 1080p + 5.1 AC3 MKV with 3 audio tracks and 2 SRT subs → session with
    audioIdx=1 → all segments valid: h264 High yuv420p, aac 2ch, first PTS ≈ 4n.
 2. Seek: request segment 12 first on a fresh session → served < 10 s; then 3 → restart works.
 3. Throughput ≥ 2× realtime at 1080p measured. 4. Subtitle cues returned for 0–60 s for sIdx 0 and 1.
 5. A real torrent file through `http://127.0.0.1:11470/...` (agent B/integrator supplies) works.

### HTTP API contract (agent B implements; agent C consumes). All JSON, UTF-8, CORS `*`.
Item = `{id, type:'movie'|'series', name, poster, year?, progress?(0..1), label?('T2 E5'), videoId?}`
`poster` = server-relative `/img?u=<enc url>&w=<px>` (server resizes to JPEG, disk cached).
- `GET /api/health` → `{ok:true, version}`
- `GET /api/home` → `{rows:[{id,title,kind:'continue'|'poster', items:[Item]}]}` rows: Continuar
  assistindo (Stremio library, lastWatched desc, landscape cards may use background), Filmes
  populares, Séries populares (Cinemeta top), Anime em alta (Kitsu trending). ≤20 items per row.
- `GET /api/search?q=` → `{results:[Item]}` (Cinemeta movie+series + Kitsu anime, de-duplicated, ≤40)
- `GET /api/meta/:type/:id` → `{id,type,name,year,description,poster,background,genres,runtime,
   imdbRating, userRating(1..10|null), inLibrary, seasons:[1,2..], videos:[{id,season,episode,title,
   released, thumbnail?, watched, progress}], resume:{videoId,positionSec,label}|null}`
- `GET /api/streams/:type/:videoId` → `{streams:[{sid,title,detail,quality,lang:[..],kind:'torrent'|
   'http'|'site', recommended}]}` aggregated from enabled sources (Stremio addons from the account +
   site providers), ranked: playable first, then preference (PT-BR dub/audio if user pref says so,
   1080p > 720p > 2160p (2160p is downscaled = waste), seeders, size sanity). `sid` opaque, server keeps
   the resolution data (infoHash/fileIdx/url/headers) for 6 h.
- `POST /api/play {sid, itemId, videoId, startSec, audioIdx?, prevSession?}` → `{session, playlist:
   '/hls/<id>/index.m3u8', duration, audio:[{aIdx,label}], audioIdx, subs:[{id,label,source}],
   skip:[{type:'intro'|'outro'|'recap',start,end}], next:{videoId,label}|null}`
   Destroys prevSession. Default audio: user pref language (pt) else default/first. Subtitle ids:
   `emb:<sIdx>` or `ext:<n>` (OpenSubtitles v3 addon results). Image-based subs not listed.
- `GET /api/subs/:session/:subId?from=&to=` → `{cues:[[s,e,text],..], complete:bool}`
- `POST /api/progress {itemId, videoId, type, name, positionSec, durationSec, state}` →
   updates Stremio library item (throttle: write at most every 60 s, plus on 'stopped'); ≥90% ⇒
   watched for that videoId (watched bitfield, stremio-core compatible).
- `POST /api/watched {itemId, videoId?, watched}` · `POST /api/rate {itemId, type, rating(1..10|null)}`
   (local db; push to Trakt if configured) · `POST /api/library {itemId, type, add:bool}`
- `DELETE /api/session/:id`
- `GET /api/settings` / `POST /api/settings` → `{audioLang:'pt', subLang:'pt', autoSkip:false, uiLang:'en',
   sources:[{id,name,enabled,kind}]}` (`uiLang` = language of server-made strings and the app's default language;
   any request may add `?lang=en|pt` to override it)
- `GET /admin` small HTML page (phone/PC browser) to add/remove/toggle sources (Stremio addon
   manifest URL or site provider), set prefs, see sessions. No auth needed beyond LAN/tailscale bind.

Sources: (1) Stremio addons from the account collection (Torrentio, Juan Carlos 2, Kitsu, OpenSubtitles,
 …): infoHash streams → torrent engine URL; url streams → direct (with `behaviorHints.proxyHeaders`).
 (2) Site providers `api/providers/*.js` exporting `{id,name, async find(meta, season, episode) ->
 [{title, url|pageUrl, headers?, lang}]}`; `pageUrl` is resolved via `yt-dlp -g -f best` (if
 installed). The TV never loads a website, so ads never reach it.
Skip segments: (1) chapters named /op|opening|intro/i, /ed|ending|credits|outro/i, /recap|previously/i;
 (2) AniSkip v2 (`https://api.aniskip.com/v2/skip-times/{malId}/{ep}?types=op&types=ed&types=recap&episodeLength=`)
 with MAL id via Kitsu mappings or `https://api.ani.zip/mappings?imdb_id=` / `?kitsu_id=`; cache.

## Client app (agent C) — `<repo>/app/` plain files: index.html, app.css, app.js, config.xml, icon.png
Principles: instant (no network wait on key press: cache + prefetch), tiny DOM, no frameworks, no
animations except `transform` on focus (≤120 ms), no box-shadow/blur/filters, max ~60 images alive,
posters 150×225 (w=150 from server), one screen's DOM at a time (rebuild on navigation, keep state in JS).
Look: background #0e0f13, surface #1a1c23, text #f2f2f5 / #a0a3ad, accent #e5a00d (amber).
Font: system sans; sizes for 1920×1080 viewport: title 56, h2 34, body 28, small 24.
Focus: 4 px accent outline + `transform: scale(1.06)`; the focused element is always visible
(row auto-scrolls with translateX on a strip, no native scroll).
Keys: arrows/Enter/Back(10009)/MediaPlayPause(10252)/Play(415)/Pause(19)/Stop(413)/FF(417)/RW(412)/
 ChannelUp/Down(427/428) for page jumps; register via `tizen.tvinputdevice.registerKeyBatch` when
 `window.tizen` exists. Desktop: Backspace/Escape = Back, Space = play/pause.
Screens:
1. Home: top bar [Buscar] [Ajustes]; rows from /api/home. Continue row = wide cards (320×180, bg image,
   progress bar, label "T2 E5 · 12 min restantes"). Enter on continue card → straight to playback
   resume with remembered source (POST play with last sid if still valid, else auto-pick recommended).
   Enter on poster → Detail. Remember focused row/column when coming back.
2. Search: input on top (Enter opens TV IME; type; results update 400 ms after typing stops), recent
   searches as chips below when empty, results as a poster grid (6 per row).
3. Detail: background (w=960, dimmed), poster, title, year · runtime · IMDb, user stars (1–5 → 2..10),
   description (4 lines), buttons [▶ Continuar T2E5 / Assistir] [Fontes] [Na lista ✓] [Avaliar]
   [Marcar visto]; series: season tabs + vertical episode list (number, title, watched ✓, progress bar).
   Enter on episode → Streams screen for that episode; long-press/Play key on episode → autoplay best.
4. Streams: header "Escolher fonte"; first item "Automático (recomendado)"; then list rows: quality
   badge, language badges, title, detail line (size · seeds · source). Remember last chosen source
   name per series to pre-focus it on the next episode.
5. Player: AVPlay full screen (object type application/avplayer). States: loading spinner (CSS
   border), playing, paused. OSD appears on any key, hides after 4 s: title + episode, progress bar
   with time/duration, hints. Left/Right seek ±10 s (repeat accelerates to 30/60 s, applied after
   600 ms of no key = one seekTo), Up opens side panel: Áudio (list → POST /api/play with audioIdx,
   startSec=current, reopen), Legendas (Off + list + "Sincronia ±0.5 s"), Fontes (back to Streams),
   Velocidade not needed. Subtitles rendered by the app: div at bottom, 46 px, white, black outline
   via 4 text-shadows; poll /api/subs every 10 s for [t-5, t+60]. Skip button bottom-right
   "Pular abertura" / "Pular encerramento" while inside a skip segment (Enter skips; autoSkip
   setting skips automatically). Next episode card appears at outro start or last 25 s with 10 s
   countdown. Progress POST every 30 s + on pause/stop. Back = stop (confirm not needed) → Detail.
   Watchdog: every 5 s read `tizen.systeminfo.getAvailableMemory()`; if < 110 MiB → stop player,
   show "Memória baixa na TV — parei o vídeo para não travar".
   AVPlay sequence (serialize ALL AVPlay calls, never overlap): close() → open(url) →
   setDisplayRect(0,0,1920,1080) → setListener → prepareAsync → seekTo(startMs) when startSec>0
   (HLS starts at playlist start; server must have that segment ready) → play(). On error: show
   message with [Tentar de novo] [Outra fonte]. Never call AVPlay from timers while a call is pending.
6. Settings: server URL (first launch: try saved URL, then defaults list from config; show input if
   none answers /api/health in 1.5 s), audio language, subtitle language, auto-skip toggle,
   app version. Sources are managed at /admin from the phone (show its URL + text).
Desktop test mode: if `window.webapis` is missing, use a mock AVPlay backed by hls.js-free `<video>`
(Chrome desktop can't play HLS natively; mock just simulates time progressing and events) so all
navigation can be tested headless with Puppeteer/Chrome.
