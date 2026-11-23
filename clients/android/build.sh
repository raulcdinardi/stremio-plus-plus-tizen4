#!/bin/bash
# Builds a signed Stremio++ APK without Gradle: aapt2 + javac + d8 + zipalign + apksigner.
# Needs JDK 17 and the Android SDK (platform android-35, build-tools 35.0.0) in ~/opt (no sudo).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/opt/jdk17}"; export PATH="$JAVA_HOME/bin:$PATH"; SDK="${ANDROID_SDK:-$HOME/opt/android-sdk}"
BT="$SDK/build-tools/35.0.0"; PLAT="$SDK/platforms/android-35/android.jar"
W="${OUT:-$HOME/opt/spp-build/android}"; KS="$W/stremiopp.jks"; DIST="$REPO/dist"
rm -rf "$W/build"; mkdir -p "$W/build/classes" "$W/build/assets" "$DIST"
cp -r "$REPO/app" "$W/build/assets/app"; rm -f "$W/build/assets/app/config.xml"
[ -f "$KS" ] || "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KS" -storepass stremiopp -keypass stremiopp -alias spp -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=StremioPP"
"$BT/aapt2" compile --dir "$HERE/res" -o "$W/build/res.zip"
"$BT/aapt2" link -o "$W/build/base.apk" -I "$PLAT" --manifest "$HERE/AndroidManifest.xml" -A "$W/build/assets" "$W/build/res.zip" --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 1.0.0
"$JAVA_HOME/bin/javac" -source 8 -target 8 -bootclasspath "$PLAT" -d "$W/build/classes" $(find "$HERE/src" -name '*.java') 2>&1 | grep -v "^Note\|warning" || true
"$BT/d8" --release --lib "$PLAT" --min-api 24 --output "$W/build" $(find "$W/build/classes" -name '*.class')
(cd "$W/build" && cp base.apk unsigned.apk && zip -q -j unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$W/build/unsigned.apk" "$W/build/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:stremiopp --key-pass pass:stremiopp --out "$DIST/StremioPP.apk" "$W/build/aligned.apk"
"$BT/apksigner" verify --verbose "$DIST/StremioPP.apk" | head -3
ls -la "$DIST/StremioPP.apk"
