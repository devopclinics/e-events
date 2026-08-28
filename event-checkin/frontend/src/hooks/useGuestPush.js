import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { isNativePushSupported, registerNativePush, unregisterNativePush } from '../push/fcmPush'

function vapidKeyToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

// Web Push (VAPID) subscribe/unsubscribe, shared by every guest-facing
// surface that wants "notify me on this device" — the browser subscription
// itself is origin-wide (one service worker, scope "/"), so any surface
// using this hook rides the same subscription once granted.
export function useGuestPush(eventId, accessToken, { skip = false } = {}) {
  const [pushConfig, setPushConfig] = useState(null)
  const [pushState, setPushState] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  const loadPush = useCallback(async () => {
    if (!eventId || !accessToken || skip) return
    if (isNativePushSupported()) {
      setPushConfig({ enabled: true, native: true })
      setPushState(window.localStorage.getItem(`festio.fcmToken.${eventId}`) ? 'enabled' : 'ready')
      return
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    try {
      const config = await api.guestPushConfig(eventId, accessToken)
      if (!config.enabled || !config.public_key) {
        setPushConfig(null)
        return
      }
      setPushConfig(config)
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setPushState(subscription ? 'enabled' : Notification.permission === 'denied' ? 'blocked' : 'ready')
    } catch {
      setPushConfig(null)
    }
  }, [eventId, accessToken, skip])

  useEffect(() => { loadPush() }, [loadPush])

  async function enablePush() {
    if (!pushConfig?.enabled || pushBusy) return
    setPushBusy(true)
    setPushError('')
    try {
      if (pushConfig.native) {
        await registerNativePush(eventId, accessToken)
        setPushState(window.localStorage.getItem(`festio.fcmToken.${eventId}`) ? 'enabled' : 'blocked')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState(permission === 'denied' ? 'blocked' : 'ready')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToUint8Array(pushConfig.public_key) })
      await api.saveGuestPushSubscription(eventId, accessToken, subscription.toJSON())
      setPushState('enabled')
    } catch (err) {
      setPushError(err.message || 'Notifications could not be enabled on this device.')
    } finally {
      setPushBusy(false)
    }
  }

  async function disablePush() {
    if (pushBusy) return
    setPushBusy(true)
    setPushError('')
    try {
      if (pushConfig?.native) {
        await unregisterNativePush(eventId, accessToken)
        setPushState('ready')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api.removeGuestPushSubscription(eventId, accessToken, subscription.endpoint)
        await subscription.unsubscribe()
      }
      setPushState('ready')
    } catch (err) {
      setPushError(err.message || 'Notifications could not be turned off on this device.')
    } finally {
      setPushBusy(false)
    }
  }

  return { pushConfig, pushState, pushBusy, pushError, enablePush, disablePush }
}
