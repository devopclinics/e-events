import { useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const CHATWOOT_BASE_URL = import.meta.env.VITE_CHATWOOT_BASE_URL || ''
const CHATWOOT_WEBSITE_TOKEN = import.meta.env.VITE_CHATWOOT_WEBSITE_TOKEN || ''

// Loads Chatwoot's widget SDK (self-hosted, see support-service/README.md for
// the one-time Chatwoot setup that produces the website token) and identifies
// the logged-in organizer so agents see who's asking, not an anonymous
// visitor. Renders nothing — Chatwoot injects its own floating bubble.
export default function SupportWidget() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user || !CHATWOOT_BASE_URL || !CHATWOOT_WEBSITE_TOKEN) return
    let cancelled = false

    // Console-controlled kill switch, independent of support-service's own
    // health — lets an operator hide the widget instantly without a redeploy.
    api.platformSettings()
      .then(({ support_chat_enabled }) => {
        if (cancelled || !support_chat_enabled) return
        load()
      })
      .catch(() => {})   // settings lookup failing never blocks the app

    return () => {
      cancelled = true
      window.removeEventListener('chatwoot:ready', identify)
    }

    function load() {
      if (window.$chatwoot) {
        identify()
        return
      }

      const script = document.createElement('script')
      script.src = `${CHATWOOT_BASE_URL}/packs/js/sdk.js`
      script.defer = true
      script.async = true
      script.onload = () => {
        window.chatwootSDK?.run({ websiteToken: CHATWOOT_WEBSITE_TOKEN, baseUrl: CHATWOOT_BASE_URL })
      }
      document.body.appendChild(script)
      window.addEventListener('chatwoot:ready', identify)
    }

    function identify() {
      api.supportIdentify()
        .then(({ identifier, identifier_hash, name, email, org_name, plan }) => {
          window.$chatwoot?.setUser(identifier, { name, email, identifier_hash })
          window.$chatwoot?.setCustomAttributes({ org_name, plan })
        })
        .catch(() => {})   // support being unavailable never blocks the app
    }
  }, [user])

  return null
}
