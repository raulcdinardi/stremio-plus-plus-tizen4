# Icon source

The app icons are derived from the official Stremio logo (not an original design).

- Repository: https://github.com/Stremio/stremio-web
- Commit: 9b5ae6ea8badb247e30d9722b4918335c23205b9 (branch `development`, fetched 2026-11-23)
- File: https://raw.githubusercontent.com/Stremio/stremio-web/9b5ae6ea8badb247e30d9722b4918335c23205b9/assets/images/icon_512x512.png
- Licence of that repository: GPL-2.0 (LICENSE.md). "Stremio" and its logo are trademarks of their owners; this project is unofficial.

Derived files
- `app/icon.png`: the 512x512 logo on an opaque #0B0B10 background (Tizen app icon, 512x512 RGB as before).
- `clients/windows/icon.ico`: transparent logo, sizes 16/24/32/48/64/128/256 (passed to electron-packager via `--icon`).
- `clients/android/res/mipmap-*/ic_launcher.png`: legacy launcher icons (mdpi..xxxhdpi); `ic_launcher_foreground.png` + `mipmap-anydpi-v26/ic_launcher.xml` + `values/colors.xml`: adaptive icon (API 26+).
