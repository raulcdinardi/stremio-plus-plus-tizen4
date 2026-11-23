#!/bin/bash
# Builds the portable win32-x64 Stremio++ package on Linux (no wine). Output: $OUT/StremioPP-win32-x64/
# Tools (electron download cache, packager) live in $TOOLS, outside the repo.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$HOME/opt/spp-build/windows}"; TOOLS="${TOOLS:-$HOME/opt/spp-build/tools}"
ELECTRON_VERSION="${ELECTRON_VERSION:-45.4.1}"
mkdir -p "$OUT" "$TOOLS"
[ -x "$TOOLS/node_modules/.bin/electron-packager" ] || (cd "$TOOLS" && npm init -y >/dev/null && npm i --no-audit --no-fund @electron/packager)
STAGE="$OUT/stage"; rm -rf "$STAGE" "$OUT/StremioPP-win32-x64"; mkdir -p "$STAGE/app-ui"
cp "$HERE/package.json" "$HERE/main.js" "$HERE/preload.js" "$STAGE/"
cp -r "$REPO/app/." "$STAGE/app-ui/"; rm -f "$STAGE/app-ui/config.xml"
(cd "$TOOLS" && ./node_modules/.bin/electron-packager "$STAGE" StremioPP --platform=win32 --arch=x64 --electron-version="$ELECTRON_VERSION" \
  --out="$OUT" --overwrite --executable-name=StremioPP --no-prune --asar --app-copyright="Stremio++" --icon="$HERE/icon.ico")
P="$OUT/StremioPP-win32-x64"
# slim down: keep only en-US + pt-BR locales, drop licence pages
find "$P/locales" -name '*.pak' ! -name 'en-US.pak' ! -name 'pt-BR.pak' -delete
rm -f "$P/LICENSES.chromium.html"
cp "$HERE/servers.txt.example" "$P/servers.txt.example"
du -sh "$P"
