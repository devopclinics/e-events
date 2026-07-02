#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release-android.sh — one command: keystore → docker image → signed .aab
#
# Runs on THIS Linux server (Docker only, no Android Studio). Wraps the three
# steps from mobile/README.md. Safe to re-run: it skips the keystore and image
# build if they already exist.
#
# Usage:
#   ./release-android.sh                 # release build (prompts for passwords)
#   DEBUG=1 ./release-android.sh         # quick unsigned debug build (no keystore)
#
# Env you can preset (else you'll be prompted / defaults used):
#   KEYSTORE_PASSWORD, KEY_PASSWORD   signing secrets (avoids prompts / CI)
#   KEY_ALIAS       (default: festio)
#   VITE_API_ORIGIN (default: https://festio.events)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"                       # -> event-checkin/mobile
IMAGE="festio-android"
KEYSTORE="$PWD/festio-release.jks"
KEY_ALIAS="${KEY_ALIAS:-festio}"
API_ORIGIN="${VITE_API_ORIGIN:-https://festio.events}"
AAB_REL="frontend/android/app/build/outputs/bundle/release/app-release.aab"
AAB_DBG="frontend/android/app/build/outputs/bundle/debug/app-debug.aab"
APK_DBG="frontend/android/app/build/outputs/apk/debug/app-debug.apk"

say() { printf '\033[0;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[0;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not installed"

# ── Debug fast-path (no signing) ─────────────────────────────────────────────
if [[ "${DEBUG:-0}" == "1" ]]; then
  say "DEBUG build (unsigned — not uploadable to Play)"
  build_image_if_needed() { docker image inspect "$IMAGE" >/dev/null 2>&1 || \
    docker build -f Dockerfile.android -t "$IMAGE" .; }
  build_image_if_needed
  # If a persistent debug keystore exists, mount it as the container's default
  # debug key so every debug build is signed with the SAME cert → stable SHA-1
  # (needed for Google sign-in). Password is the standard "android".
  DEBUG_KS_MOUNT=()
  [[ -f "$PWD/debug.keystore" ]] && DEBUG_KS_MOUNT=(-v "$PWD/debug.keystore":/root/.android/debug.keystore:ro)
  docker run --rm -v "$PWD/..":/work -w /work/frontend \
    "${DEBUG_KS_MOUNT[@]}" \
    -e VITE_API_ORIGIN="$API_ORIGIN" -e APK="${APK:-0}" \
    "$IMAGE" bash /work/mobile/build-android.sh
  if [[ "${APK:-0}" == "1" ]]; then
    OUT_APK="$PWD/../$APK_DBG"
    [[ -f "$OUT_APK" ]] || die "Build finished but APK not found at $OUT_APK"
    cp "$OUT_APK" "$PWD/festio-debug.apk"
    say "DONE → $APK_DBG"
    say "Copied → mobile/festio-debug.apk (serve this file to the phone)"
  else
    say "DONE → $AAB_DBG (relative to event-checkin/)"
  fi
  exit 0
fi

# ── 1. Keystore ──────────────────────────────────────────────────────────────
if [[ ! -f "$KEYSTORE" ]]; then
  command -v keytool >/dev/null || die "keytool not found (install a JDK) — needed once to create the keystore"
  say "No keystore yet — creating $KEYSTORE (alias: $KEY_ALIAS)"
  [[ -n "${KEYSTORE_PASSWORD:-}" ]] || { read -rsp "New keystore password: " KEYSTORE_PASSWORD; echo; }
  [[ -n "${KEY_PASSWORD:-}" ]]      || { read -rsp "New key password (blank = same): " KEY_PASSWORD; echo; KEY_PASSWORD="${KEY_PASSWORD:-$KEYSTORE_PASSWORD}"; }
  keytool -genkeypair -v -keystore "$KEYSTORE" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KEYSTORE_PASSWORD" -keypass "$KEY_PASSWORD" \
    -dname "CN=Festio, O=Festio, C=CH"
  say "Keystore created. BACK IT UP — losing it means you can never update the app."
else
  say "Using existing keystore: $KEYSTORE"
  [[ -n "${KEYSTORE_PASSWORD:-}" ]] || { read -rsp "Keystore password: " KEYSTORE_PASSWORD; echo; }
  [[ -n "${KEY_PASSWORD:-}" ]]      || { read -rsp "Key password (blank = same): " KEY_PASSWORD; echo; KEY_PASSWORD="${KEY_PASSWORD:-$KEYSTORE_PASSWORD}"; }
fi

# ── 2. Build image (once) ────────────────────────────────────────────────────
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  say "Docker image '$IMAGE' already built — reusing"
else
  say "Building Docker image '$IMAGE' (first run pulls a few GB)"
  docker build -f Dockerfile.android -t "$IMAGE" .
fi

# ── 3. Signed release build ──────────────────────────────────────────────────
say "Building signed release AAB (API origin: $API_ORIGIN)"
docker run --rm -v "$PWD/..":/work -w /work/frontend \
  -v "$KEYSTORE":/keystore.jks:ro \
  -e VITE_API_ORIGIN="$API_ORIGIN" \
  -e KEYSTORE_FILE=/keystore.jks \
  -e KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
  -e KEY_ALIAS="$KEY_ALIAS" \
  -e KEY_PASSWORD="$KEY_PASSWORD" \
  "$IMAGE" bash /work/mobile/build-android.sh

OUT="$PWD/../$AAB_REL"
[[ -f "$OUT" ]] || die "Build finished but AAB not found at $OUT"
say "SUCCESS → $OUT"
say "Upload that .aab to the Play Console. Test it first on a real phone (adb install after bundletool, or push an APK)."
