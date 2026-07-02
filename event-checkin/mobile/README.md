# Festio Android build (containerized)

Build a Play-Store `.aab` on this Linux server — no Android Studio, no GUI.
Everything runs in a container, so it does **not** touch the running Festio
backend/frontend, database, or ports. It only reads `../frontend` and writes the
build output back under `../frontend/android/`.

## One-time: create a signing keystore

The Play Store needs a **signed** app. Generate a keystore once and keep it safe
(losing it means you can never update the app):

```bash
keytool -genkeypair -v -keystore festio-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias festio
# remember the store password, key alias (festio), and key password
```

Keep `festio-release.jks` OUT of git (already covered by frontend/.gitignore).

## Build the image (once, ~a few GB download)

```bash
cd event-checkin/mobile
docker build -f Dockerfile.android -t festio-android .
```

## Build the app

Debug (quick smoke test, not uploadable):

```bash
docker run --rm -v "$PWD/..":/work -w /work/frontend \
  -e VITE_API_ORIGIN=https://festio.events \
  festio-android bash /work/mobile/build-android.sh
```

Release (signed, uploadable) — mount the keystore and pass its secrets:

```bash
docker run --rm -v "$PWD/..":/work -w /work/frontend \
  -v "$PWD/festio-release.jks":/keystore.jks:ro \
  -e VITE_API_ORIGIN=https://festio.events \
  -e KEYSTORE_FILE=/keystore.jks \
  -e KEYSTORE_PASSWORD=... -e KEY_ALIAS=festio -e KEY_PASSWORD=... \
  festio-android bash /work/mobile/build-android.sh
```

Output: `frontend/android/app/build/outputs/bundle/release/app-release.aab` →
upload that to the Play Console.

## Test on a real phone (debug APK)

An `.aab` can't be installed directly. For device testing, build a signed **APK**
and sideload it. The `release-android.sh` script has a one-shot mode:

```bash
cd event-checkin/mobile
APK=1 DEBUG=1 ./release-android.sh
# → frontend/android/app/build/outputs/apk/debug/app-debug.apk (also copied to mobile/festio-debug.apk)
```

This is signed with the committed `mobile/debug.keystore` (password `android`), so
the signing **SHA-1 is stable** across builds — that's what Google sign-in needs
registered (see below).

### Get the APK onto the phone (temporary HTTP server)

The APK is gitignored, so don't expect it via `git`. Serve the file over the LAN
and download it in the phone's browser (phone must be on the **same Wi-Fi**):

```bash
cd event-checkin/mobile          # serve from the folder that HAS the apk
python3 -m http.server 8088 --bind 0.0.0.0
```

Then on the phone open (replace with this server's LAN IP from `hostname -I`):

```
http://10.0.0.191:8088/festio-debug.apk
```

- Verify the download is **33 MB** (a 0-byte / tiny file means a bad transfer).
- Tap it → allow "install from unknown sources" → install (installs over an
  existing copy since the signature matches).
- **Ctrl+C the server when done** — while it runs, anything on the LAN can reach
  files in that folder (incl. `debug.keystore`, which is only the standard debug
  key but still — don't leave it up).

Alternatives that don't expose a service: `scp` the file to your computer, or
upload it to Drive/Dropbox and open the link on the phone.

### Enable Google sign-in for the installed app

Native Google sign-in fails (`DEVELOPER_ERROR` / code 10) until the app's signing
SHA-1 is registered in Firebase:

1. Get the SHA-1: `keytool -list -v -keystore debug.keystore -storepass android -alias androiddebugkey`
   (or from the APK: `keytool -printcert -jarfile festio-debug.apk`).
2. Firebase console → project `evets-f394d` → Project settings → the Android app
   `events.festio.app` → **Add fingerprint** → paste the SHA-1 (and SHA-256) → Save.
3. Re-download `google-services.json` → replace `event-checkin/google-services.json`
   → rebuild. (Server-side registration is what unblocks sign-in; re-download keeps
   the repo copy current.) Email/password login works without any of this.

## Notes / gotchas

- **Backend CORS**: already updated to allow the Capacitor origins
  (`https://localhost` etc.) — the app can call `https://festio.events/api`.
- **Firebase auth**: DONE — `src/auth/googleSignIn.js` uses the native
  `@capacitor-firebase/authentication` flow on device (the web popup doesn't work
  in a WebView) and the web popup in browsers. Needs the SHA-1 registered (above).
- **QR scanning**: DONE — `ScannerPage.jsx` uses the native
  `@capacitor-mlkit/barcode-scanning` plugin on device and keeps `html5-qrcode`
  on web. The plugin declares the `CAMERA` permission itself.
- **Emulator**: this server has no `/dev/kvm`, so no emulator here — test the
  `.aab`/`.apk` on a real Android phone.
- **iOS**: cannot be built on this server (Apple requires macOS). Use a Mac or a
  macOS cloud CI (Codemagic, etc.).
