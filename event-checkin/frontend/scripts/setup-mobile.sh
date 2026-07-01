#!/usr/bin/env bash
# Festio mobile (Capacitor) one-time setup — run on a DEV MACHINE, not the server.
# Prereqs (see docs/MOBILE-APP-PLAN.md): Node 18+, Android Studio + SDK, and for
# iOS a Mac with Xcode + CocoaPods. This creates the native android/ and ios/
# projects alongside the existing web app.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> event-checkin/frontend

echo "==> Installing Capacitor core + platforms"
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

echo "==> Installing native plugins (camera/QR, deep links, push, splash)"
npm i @capacitor-mlkit/barcode-scanning @capacitor/app @capacitor/push-notifications @capacitor/splash-screen
# Firebase native auth (web SDK popup does NOT work in a WebView):
npm i @capacitor-firebase/authentication firebase

echo "==> Building web bundle and adding native platforms"
npm run build
npx cap add android
# iOS requires macOS; the next line is a no-op elsewhere.
if [[ "$(uname -s)" == "Darwin" ]]; then npx cap add ios; else echo "   (skipping iOS — not macOS)"; fi

echo "==> Syncing web build into native projects"
npx cap sync

cat <<'NEXT'

Done. Next:
  • Android:  npx cap open android   (build a signed AAB in Android Studio)
  • iOS:      npx cap open ios        (archive/upload in Xcode, macOS only)
  • After any web change: npm run build && npx cap sync
  • Point the app's API calls at https://festio.events (absolute), not same-origin.
  • Camera perms: Android CAMERA permission + iOS NSCameraUsageDescription.
See docs/MOBILE-APP-PLAN.md for store submission, deep links, and gotchas.
NEXT
