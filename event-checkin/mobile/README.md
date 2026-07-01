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

## Notes / gotchas

- **Backend CORS**: already updated to allow the Capacitor origins
  (`https://localhost` etc.) — the app can call `https://festio.events/api`.
- **Firebase auth**: the web popup sign-in does NOT work inside the native
  WebView. Before shipping, switch to `@capacitor-firebase/authentication`
  (native Google/Apple sign-in). See `docs/MOBILE-APP-PLAN.md`.
- **QR scanning**: `html5-qrcode` works in the WebView but the native
  `@capacitor-mlkit/barcode-scanning` plugin is more reliable; add the camera
  permission (`CAMERA`) to the generated `android/` manifest.
- **Emulator**: this server has no `/dev/kvm`, so no emulator here — test the
  `.aab`/`.apk` on a real Android phone.
- **iOS**: cannot be built on this server (Apple requires macOS). Use a Mac or a
  macOS cloud CI (Codemagic, etc.).
