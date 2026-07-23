import { Capacitor } from '@capacitor/core'
import { api } from '../api'

// Native mobile push (FCM) — the existing VAPID Web Push path (api.js's
// guestPushConfig/saveGuestPushSubscription) stays exactly as-is for the
// browser; this only runs inside the Capacitor native app. iOS isn't
// bootstrapped as a platform yet, so isNativePushSupported() is Android-only
// in practice today even though the check itself is platform-agnostic — see
// docs/FCM-IMPLEMENTATION-BACKLOG-JIRA.csv's "iOS platform bootstrap" item.

const STORAGE_KEY_PREFIX = 'festio.fcmToken.'

function storageKey(eventId) {
  return `${STORAGE_KEY_PREFIX}${eventId}`
}

export function isNativePushSupported() {
  return Capacitor.isNativePlatform()
}

// Call after the user is authenticated in this event context — a Guest Hub
// session (pass guestToken) or a staff/organizer login (omit it; the
// Firebase bearer already attached by api.js's req() resolves the actor).
export async function registerNativePush(eventId, guestToken) {
  if (!isNativePushSupported()) return
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')

  const perm = await FirebaseMessaging.requestPermissions()
  if (perm.receive !== 'granted') return

  const { token } = await FirebaseMessaging.getToken()
  if (!token) return

  const previousToken = window.localStorage.getItem(storageKey(eventId)) || undefined
  const platform = Capacitor.getPlatform() // 'android' | 'ios'
  await api.registerFcmToken(eventId, { token, platform, previousToken }, guestToken)
  window.localStorage.setItem(storageKey(eventId), token)

  // The token can rotate at any time (reinstall, Firebase-initiated refresh),
  // independent of anything the user does — re-register immediately so the
  // backend never ends up holding a stale token between app opens.
  FirebaseMessaging.addListener('tokenReceived', async (event) => {
    const refreshed = event?.token
    const current = window.localStorage.getItem(storageKey(eventId))
    if (!refreshed || refreshed === current) return
    try {
      await api.registerFcmToken(eventId, { token: refreshed, platform, previousToken: current || undefined }, guestToken)
      window.localStorage.setItem(storageKey(eventId), refreshed)
    } catch {
      // Best-effort — the next call to registerNativePush (next app open)
      // will retry with whatever FirebaseMessaging.getToken() returns then.
    }
  })
}

export async function unregisterNativePush(eventId, guestToken) {
  if (!isNativePushSupported()) return
  const token = window.localStorage.getItem(storageKey(eventId))
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')
  try {
    if (token) await api.unregisterFcmToken(eventId, token, guestToken)
  } finally {
    window.localStorage.removeItem(storageKey(eventId))
    await FirebaseMessaging.removeAllListeners()
  }
}

// Foreground/background/tap-to-open handling — call once at app startup,
// not per event, since one listener set covers whichever event's
// notification actually arrives while the app is running.
export async function setupNativePushHandlers({ onForeground, onOpen } = {}) {
  if (!isNativePushSupported()) return
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')

  await FirebaseMessaging.addListener('notificationReceived', (event) => {
    // FCM does not show a system banner while the app is foregrounded —
    // the app has to render its own in-app notice.
    onForeground?.(event?.notification)
  })

  await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
    // Background or killed-app tap — deep-link using the same `url` field
    // already present in every push payload (matches Web Push's payload shape).
    const url = event?.notification?.data?.url
    if (url) onOpen?.(url)
  })
}
