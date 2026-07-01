#!/usr/bin/env bash
# Runs INSIDE the festio-android container (see mobile/README.md).
# cwd is the mounted frontend dir. Produces an .aab under android/app/build/.
set -euo pipefail

API_ORIGIN="${VITE_API_ORIGIN:-https://festio.events}"
echo "==> API origin baked into the app: $API_ORIGIN"

echo "==> Installing web deps (Capacitor + plugins are declared in package.json)"
npm ci 2>/dev/null || npm install

echo "==> Building web bundle"
VITE_API_ORIGIN="$API_ORIGIN" npm run build

echo "==> Adding/refreshing the Android platform"
[ -d android ] || npx --yes cap add android
npx --yes cap sync android

# Firebase native auth needs google-services.json in android/app/. Drop it at
# event-checkin/google-services.json (or mobile/) and the build wires it in.
for gs in /work/google-services.json /work/mobile/google-services.json /work/frontend/google-services.json; do
  if [ -f "$gs" ]; then
    echo "==> Placing google-services.json from $gs into android/app/"
    cp "$gs" android/app/google-services.json
    break
  fi
done
if [ ! -f android/app/google-services.json ]; then
  echo "==> NOTE: no google-services.json found — Google sign-in will not work in the app."
  echo "    Put it at event-checkin/google-services.json and rebuild (email/password login still works)."
fi

# Ensure the Google Services Gradle plugin is wired (Groovy, not the Kotlin .kts
# from Firebase docs). Capacitor >=5 already does this; the grep guards make this
# a no-op there, so it's safe and idempotent across Capacitor versions.
if [ -f android/app/google-services.json ]; then
  ROOT_GRADLE=android/build.gradle
  APP_GRADLE=android/app/build.gradle
  if [ -f "$ROOT_GRADLE" ] && ! grep -q 'com.google.gms:google-services' "$ROOT_GRADLE"; then
    echo "==> Adding google-services classpath to $ROOT_GRADLE"
    sed -i "s#\(classpath ['\"]com.android.tools.build:gradle[^'\"]*['\"]\)#\1\n        classpath 'com.google.gms:google-services:4.4.2'#" "$ROOT_GRADLE" \
      || echo "    (could not auto-edit root build.gradle — add: classpath 'com.google.gms:google-services:4.4.2')"
  fi
  if [ -f "$APP_GRADLE" ] && ! grep -q 'com.google.gms.google-services' "$APP_GRADLE"; then
    echo "==> Applying google-services plugin in $APP_GRADLE"
    printf "\napply plugin: 'com.google.gms.google-services'\n" >> "$APP_GRADLE"
  fi
fi

# Resolve the Kotlin stdlib duplicate-class clash: an old transitive
# kotlin-stdlib-jdk7/jdk8 (1.6.x) vs the newer merged kotlin-stdlib (1.8.x).
# Aligning the jdk7/jdk8 variants makes them empty stubs → no dup classes.
APP_GRADLE=android/app/build.gradle
if [ -f "$APP_GRADLE" ] && ! grep -q 'FESTIO_KOTLIN_STDLIB_FIX' "$APP_GRADLE"; then
  echo "==> Adding Kotlin stdlib dedup to $APP_GRADLE"
  cat >> "$APP_GRADLE" <<'GRADLE'

// FESTIO_KOTLIN_STDLIB_FIX — align kotlin-stdlib-jdk7/8 to avoid duplicate classes
configurations.all {
    resolutionStrategy.eachDependency { details ->
        if (details.requested.group == 'org.jetbrains.kotlin' &&
            (details.requested.name == 'kotlin-stdlib-jdk7' ||
             details.requested.name == 'kotlin-stdlib-jdk8')) {
            details.useVersion '1.8.22'
        }
    }
}
GRADLE
fi

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
elif [ "${APK:-0}" = "1" ]; then
  # Directly-installable APK for sideloading onto a real phone (adb install or
  # copy-and-tap). Not for Play upload — that needs the signed AAB above.
  ./gradlew --no-daemon assembleDebug
  echo "==> DONE (DEBUG APK — sideload onto a phone, NOT for Play)."
  echo "    frontend/android/app/build/outputs/apk/debug/app-debug.apk"
else
  ./gradlew --no-daemon bundleDebug
  echo "==> DONE (DEBUG, unsigned — not uploadable to Play). Provide KEYSTORE_* for a release build."
  echo "    frontend/android/app/build/outputs/bundle/debug/app-debug.aab"
fi
