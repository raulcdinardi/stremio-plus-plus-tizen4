# Stremio++ server (agent B part)

Zero-dependency Node 24 server on `0.0.0.0:8790` (`PORT` env overrides). See `../SPEC.md` for the API contract.

Files: `server.js` (router, static `/app/`, CORS), `util.js` (secrets, redacted logging, fetch+timeout, LRU, sqlite),
`api/stremio.js` (account addons + library), `api/meta.js` (Cinemeta/Kitsu), `api/streams.js` (aggregate/rank/sids),
`api/play.js` (sid -> probe -> HLS session, subs), `api/skip.js` (chapters > AniSkip > TheIntroDB), `api/library.js`
(progress/watched/rate/library + continue row), `api/bitfield.js` (stremio-core WatchedBitField port), `api/img.js`,
`api/admin.js` (+ `/admin` page), `api/providers/` (site plugins + yt-dlp resolver). `media.js` belongs to agent A.

Extra endpoints beyond the contract: `GET /api/skip/<videoId>?type=&duration=&wait=` (skip lookup), `GET /api/admin/state`,
`POST /api/admin/addon {url}`, `DELETE /api/admin/addon?id=`. `POST /api/play` also accepts `sid:"auto"` (or an omitted sid) to
pick the recommended stream, and replies `410 {code:"sid_expired"}` when a sid is older than 6 h. The play reply has an extra `sid`.

State: `<repo>/state/spp.db` (sqlite: settings, meta cache, sids, local progress/watched overlay, ratings, skip cache),
`state/img` (image cache). Env overrides: `SPP_STATE`, `SPP_MEDIA` (path to a media module, e.g. a stub),
`SPP_ENGINE` (torrent engine URL), `SPP_LIBRARY_WRITE=0` (force dry-run: never PUT to the Stremio account).

Language: the `uiLang` setting (`en` by default, `pt` available; toggle on /admin or `POST /api/settings {"uiLang":"pt"}`) picks the language of every
user-facing string the server produces (home row titles, audio/subtitle labels, sync/dub messages, user-facing errors, the /admin page).
A request may carry `?lang=en|pt` to override it for that request (the TV app sends its own language this way). The strings live in
`util.js` (`STR`, `t()`) and `api/play.js` (`LANG_NAMES`); to add a language add it to `LANGS`, `STR` and `LANG_NAMES` (and to the app's `I18N` in `app/app.js`).

Library writes: `libraryWrite` setting (default true, toggle on /admin). When false (or env `=0`) the library item is built and logged
("library dry-run") but not PUT; the local sqlite overlay still reflects it. Reads from the account are always done.
Local overlay entries are ignored once the account item's `_mtime` is newer (so changes made in the real Stremio win).

Site providers: drop `api/providers/<x>.js` exporting `{id,name,defaultEnabled?,find(meta,season,episode)}`. `pageUrl` results are
resolved with yt-dlp (`~/.local/bin/yt-dlp` preferred, else PATH). `example.js` is disabled by default.

Tests: `node test/bitfield.test.js` (round-trip of a real account string), `node test/api.test.js` (live, dry-run, port 8792,
temp state dir; `E2E=1` also does a real play), `node --test test/i18n.test.js` (server strings, `?lang=`, app dictionary key parity).

Known limitations: AniSkip for multi-season IMDb anime is resolved through Kitsu's `imdbSeason/imdbEpisode` mapping (may miss);
Trakt rating push only if `traktClientId` and `traktToken` exist in secrets (untested, no credentials);
Kitsu ids skip OpenSubtitles (needs IMDb ids); Torrentio streams without `fileIdx` are matched by S/E filename regex.
