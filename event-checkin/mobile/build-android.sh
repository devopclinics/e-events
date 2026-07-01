#!/usr/bin/env bash
# Runs INSIDE the festio-android container (see mobile/README.md).
# cwd is the mounted frontend dir. Produces an .aab under android/app/build/.
set -euo pipefail

API_ORIGIN="${VITE_API_ORIGIN:-https://festio.events}"
echo "==> API origin baked into the app: $API_ORIGIN"

echo "==> Installing web deps"
npm ci 2>/dev/null || npm install

echo "==> Ensuring Capacitor is present"
npm install --no-save @capacitor/core @capacitor/cli @capacitor/android

echo "==> Building web bundle"
VITE_API_ORIGIN="$API_ORIGIN" npm run build

echo "==> Adding/refreshing the Android platform"
[ -d android ] || npx --yes cap add android
npx --yes cap sync android

echo "==> Gradle build"
cd android
if [ -n "${KEYSTORE_FILE:-}" ]; then
  ./gradlew --no-daemon bundleRelease \
    -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
    -Pandroid.injected.signing.store.password="${KEYSTORE_PASSWORD:?set KEYSTORE_PASSWORD}" \
    -Pandroid.injected.signing.key.alias="${KEY_ALIAS:?set KEY_ALIAS}" \
    -Pandroid.injected.signing.key.password="${KEY_PASSWORD:?set KEY_PASSWORD}"
  echo "==> DONE. Signed release AAB:"
  echo "    frontend/android/app/build/outputs/bundle/release/app-release.aab"
else
  ./gradlew --no-daemon bundleDebug
  echo "==> DONE (DEBUG, unsigned — not uploadable to Play). Provide KEYSTORE_* for a release build."
  echo "    frontend/android/app/build/outputs/bundle/debug/app-debug.aab"
fi
