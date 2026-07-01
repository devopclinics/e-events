# Festio Mobile App — Capacitor (Android + iOS) Plan

Festio is a React 18 + Vite SPA (`event-checkin/frontend`) served at
`https://festio.events`. This plan wraps that existing web build in
**Capacitor** to ship native Android (Play Store) and iOS (App Store) apps from
one codebase. No rewrite — the same React app runs inside a native WebView with
native plugins for camera, push, and deep links.

> Build environment: iOS **requires macOS + Xcode**; Android needs Android
> Studio + SDK. All `npx cap`, Gradle, and Xcode steps below run on a developer
> machine (a Mac covers both). The CI Linux box cannot build these.

---

## Phase 0 — Prereqs (accounts & assets, can start today)

- [ ] **Google Play Developer account** — $25 one-time. Org account avoids the
      new-account closed-testing gate (see Phase 5). Identity/D-U-N-S verification
      can take days — start now.
- [ ] **Apple Developer Program** — $99/year. Also needs identity verification.
- [ ] **Privacy policy URL** (mandatory both stores). Festio processes guest PII
      (names, phones, emails) + camera. Must be publicly hosted (e.g.
      `https://festio.events/privacy`).
- [ ] **App identity:** package/bundle id `events.festio.app` (reverse-DNS),
      app name "Festio", 512×512 icon, 1024×500 Play feature graphic, splash.

## Phase 1 — Make the web app a PWA (repo work, ~½ day)

Not strictly required for Capacitor, but gives offline caching and a manifest we
reuse for icons/splash.

- [ ] Add `vite-plugin-pwa`; generate `manifest.webmanifest` (192/512 icons,
      `display: standalone`, `theme_color #14b8a6`, `start_url /`).
- [ ] Register a service worker (Workbox via the plugin) — cache the app shell so
      check-in still loads on flaky venue wifi.
- [ ] `npm run build` to verify (frontend has no runtime in CI — build is the check).

## Phase 2 — Add Capacitor (repo work, ~1 day)

```bash
cd event-checkin/frontend
npm i @capacitor/core @capacitor/cli
npx cap init "Festio" "events.festio.app" --web-dir=dist
npm i @capacitor/android @capacitor/ios
npm run build && npx cap add android && npx cap add ios
```

- [ ] `capacitor.config.ts`: `webDir: 'dist'`, `server.androidScheme: 'https'`.
- [ ] Commit `android/` and `ios/` native projects.
- [ ] Every web change: `npm run build && npx cap sync`.

### ⚠️ Phase 2 gotchas specific to Festio

1. **API base URL + CORS.** The app calls the API same-origin today. Inside
   Capacitor the web origin is `https://localhost` (Android) / `capacitor://localhost`
   (iOS), so API calls must target absolute `https://festio.events` **and** the
   backend must allow those origins. Today [main.py] sets
   `allow_origins=[settings.frontend_url]` — add the Capacitor origins to CORS
   (via an env-driven list) or the app will fail every request with a CORS error.
2. **Firebase auth in a WebView.** The Firebase **web** SDK popup sign-in does
   **not** work in a native WebView. Switch to `@capacitor-firebase/authentication`
   (native Google/Apple sign-in) or a redirect-based flow. Apple **requires**
   "Sign in with Apple" if you offer Google sign-in. Budget time for this.
3. **Camera / QR.** `html5-qrcode` (getUserMedia) works in the WebView but needs
   native permission strings. For a scanner app, prefer the native
   `@capacitor-mlkit/barcode-scanning` plugin — far more reliable than JS decode.
   - Android: `<uses-permission android:name="android.permission.CAMERA"/>`
   - iOS `Info.plist`: `NSCameraUsageDescription` = "Scan guest QR codes to check
     attendees in."

## Phase 3 — Deep links so ticket QR codes open the app (~½ day)

Ticket URLs are `https://festio.events/scan/<qr_token>`. Make them open in-app:

- [ ] **Android App Links:** host `https://festio.events/.well-known/assetlinks.json`
      with the app's SHA-256 signing cert fingerprint.
- [ ] **iOS Universal Links:** host `https://festio.events/.well-known/apple-app-site-association`
      + add the Associated Domains entitlement.
- [ ] Handle the incoming URL with `@capacitor/app` `appUrlOpen` → route to `/scan/:token`.

## Phase 4 — Push notifications (optional, ~1 day)

- [ ] `@capacitor/push-notifications` + FCM (Android) / APNs (iOS).
- [ ] Backend already sends WhatsApp/SMS/email — push is additive; wire device
      tokens to a new endpoint if you want in-app pushes.

## Phase 5 — Store submission

**Google Play**
- [ ] Build signed AAB (`./gradlew bundleRelease` or Android Studio); enroll in
      Play App Signing.
- [ ] Target the current required API level (Studio/Capacitor default is fine).
- [ ] **Data Safety form:** declare personal info (name/email/phone), camera.
- [ ] Content rating questionnaire; store listing (icon, feature graphic, 2–8
      screenshots, descriptions).
- [ ] **⚠️ New personal accounts:** closed test with ≥12 testers for 14
      continuous days before production. Org accounts exempt. ~2-week gate.

**Apple App Store**
- [ ] Archive in Xcode → upload to App Store Connect (needs Mac).
- [ ] App Privacy questionnaire (mirrors Data Safety).
- [ ] "Sign in with Apple" required if Google sign-in is offered (see 2.2).
- [ ] TestFlight beta → submit for review (Apple review is stricter; expect 1–3
      days and possible back-and-forth).

## Payments note

Backend uses Stripe ([payments.py]). Play/Apple require **their** billing for
*digital* goods, but **real-world goods/services (event tickets, physical
merch/logistics) are exempt** and may keep Stripe. Festio's tickets are
real-world event access → almost certainly exempt. Keep store listings framed
around event management, not "buy in-app credits," to avoid review rejection.

## Rough effort / timeline

| Work | Effort |
| --- | --- |
| Repo: PWA + Capacitor + camera + deep links + CORS/auth fixes | ~3–5 dev days |
| Store assets, listings, privacy policy, forms | ~1–2 days |
| Play 14-day closed test (personal accounts) | ~2 weeks calendar |
| Apple review cycles | ~2–5 days calendar |

**Net:** a couple of dev-weeks of work, but calendar time is gated mostly by
account verification, the Play closed-test window, and Apple review.
