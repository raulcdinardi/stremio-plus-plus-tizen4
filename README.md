# Stremio++ (Tizen 4)

A Stremio replacement for old Samsung TVs (Tizen 4), plus Windows and Android clients, built around a home server
that does all the heavy lifting.

The TV app (`app/`, plain ES2017, no dependencies) only draws the interface and plays HLS. A Linux box runs the
server (`server/`, Node 24, no npm dependencies) and always hands the client a format it can play.

## Features

- **Catalog and library** from Stremio add-ons (Cinemeta, Kitsu, Torrentio…), synced with a Stremio account.
- **Season-aware source ranking**: health, language and quality, and releases that name another season are pushed to
  the end, so season 3 files are not offered as season 1.
- **Always-playable playback**: the server transcodes to HLS (H.264 8-bit + AAC, VAAPI when available). Torrents go
  through the Stremio streaming server (`server.js`, not included).
- **Automatic subtitle sync** (`server/subsync.js`): external subtitles are aligned while the video plays, against
  another embedded track when there is one, otherwise against the speech energy of the audio that was already
  transcoded. It finds the offset and the frame-rate ratio (25 vs 23.976 fps). Manual fine-tuning in 0.1 s and
  1 s steps on top.
- **Experimental dubbed audio from another release** (opt-in): finds a release with Portuguese audio, aligns its
  soundtrack to the one playing and muxes it in.
- **Ratings 0–100 after every episode or movie**, synced to **MyAnimeList** (official API, OAuth2) and **Letterboxd**
  (through a logged-in browser session), with watched status synced on completion.
- **Watch together**: a link + QR code lets a friend watch in any browser, in sync; play/pause/seek from either side.
- **Windows (Electron) and Android (WebView) clients** with a **data saver** mode: the server encodes HEVC (or H.264)
  at ≤720p, about 1 Mbps (≈450 MB/hour with HEVC).
- On-screen keyboard for D-pad remotes (letter grid) or phone-style multi-tap, switchable; episode switcher inside the
  player; skip intro/outro; next-episode countdown; per-series audio/subtitle memory; English and Portuguese UI.

## Layout

- `app/`: the TV web app (`app.js` is the source). Package it as a signed `.wgt` for your TV (`config.xml`).
- `server/`: HTTP API, HLS transcoder (`media.js`), subtitle sync, trackers (`trackers/`), watch-together
  (`watchparty.js`). Tests in `server/test/`.
- `clients/windows`, `clients/android`: build scripts for the desktop and phone apps (they bundle `app/`).
- `app-test/`: headless-Chrome UI tests against `mock-server.js` (open the app with `&mockav=1`).
- `SPEC.md`: the original design spec. `tvcdp.js`, `tvkey.sh`, `tvmon.sh`: helpers over the TV's DevTools port.

## Running the server

```bash
cd server
PORT=8790 node server.js     # needs ffmpeg; a Stremio streaming server on 127.0.0.1:11470 for torrents
```

Optional `secrets.json` in the project root (git-ignored, never logged): `stremioAuthKey` for library sync,
`malClientId` (+ `malClientSecret`, `malRedirectUri`) for MyAnimeList. Settings such as the UI language (`uiLang`),
keyboard (`kbMode`), rating input (`ratingInput`) and the public base URL for watch-together links
(`partyPublicBase`) are set through `POST /api/settings`. The servers the clients try first are at the top of
`app/app.js`, `clients/windows/main.js` and the Android `MainActivity.java`.

Stremio is a trademark of its owners; this is an unofficial personal project, provided as is. The icon comes from
Stremio's own repository (see `app/ICON_SOURCE.md`).
