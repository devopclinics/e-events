const SALES_ROUTES = new Set(['/', '/pricing', '/pricing-legacy', '/landing-legacy', '/login', '/register'])
const SUPPORT_ROUTES = new Set([
  '/admin', '/setup', '/setup/guided', '/design-studio', '/dashboard', '/results',
  '/my-tasks', '/org-settings', '/api-explorer', '/festiome', '/scanner', '/kitchen',
  '/console', '/media-library', '/help',
  '/live', '/finance', '/admin-redesign', '/events-redesign', '/guests-redesign',
  '/communications-redesign', '/billing-redesign', '/addons-redesign', '/team-redesign',
  '/experience-redesign', '/checkin-redesign', '/superadmin-redesign', '/media-redesign',
  '/marketing', '/design-studio-redesign', '/event-results-redesign', '/festiome-redesign',
  '/planner-redesign', '/conference-center', '/live-redesign', '/ticketing-redesign',
  '/help-redesign', '/scanner-redesign', '/kitchen-redesign', '/setup-redesign',
  '/api-explorer-redesign', '/training', '/design-studio-redesign/website', '/layout-options',
])

function inboxConfig(baseUrl, websiteToken, appOrigin) {
  try {
    const url = new URL((baseUrl || '').trim())
    const token = (websiteToken || '').trim()
    // Cross-origin frames cannot read Festio's auth, storage, or DOM. Do not
    // permit same-origin/proxy URLs, credentials, arbitrary paths, or query data.
    if (url.protocol !== 'https:' || url.origin === appOrigin || url.username || url.password ||
        url.search || url.hash || !/^\/*$/.test(url.pathname) || !/^[A-Za-z0-9_-]{8,200}$/.test(token)) return null
    return { baseUrl: url.origin, websiteToken: token }
  } catch {
    return null
  }
}

export function chatWidgetConfig(env = {}, appOrigin = '') {
  const support = inboxConfig(env.VITE_CHATWOOT_BASE_URL, env.VITE_CHATWOOT_WEBSITE_TOKEN, appOrigin)
  const sales = inboxConfig(env.VITE_SALES_CHAT_BASE_URL, env.VITE_SALES_CHAT_WEBSITE_TOKEN, appOrigin)
  return {
    support,
    // A syntactically valid token is not proof of inbox policy. An operator must
    // validate the separate PUBLIC inbox and explicitly enable both gates.
    sales: env.VITE_SALES_CHAT_ENABLED === 'true' && env.VITE_SALES_CHAT_INBOX_VALIDATED === 'true' &&
      sales && sales.baseUrl !== support?.baseUrl &&
      sales.websiteToken !== (env.VITE_CHATWOOT_WEBSITE_TOKEN || '').trim() ? sales : null,
  }
}

export function selectChatSession({ user, loading, pathname, config }) {
  if (loading) return null
  const path = pathname.replace(/\/+$/, '') || '/'
  if (!user) return SALES_ROUTES.has(path) && config.sales ? { mode: 'sales', ...config.sales } : null
  // Preserve existing organizer-support routes. Public guest links and pages
  // with access tokens never receive an organizer widget, even while signed in.
  if (!user.id || !(SUPPORT_ROUTES.has(path) || /^\/(floor-plan|floorplan-redesign)\/[^/]+$/.test(path))) return null
  return config.support ? { mode: 'support', ...config.support } : null
}

export function widgetUrl(config) {
  const url = new URL('/widget', config.baseUrl)
  url.searchParams.set('website_token', config.websiteToken)
  // Deliberately no cw_conversation, identity, current URL, or tenant context.
  return url.toString()
}

export function validSupportIdentity(value) {
  return !!(value && (typeof value.identifier === 'string' || typeof value.identifier === 'number') &&
    String(value.identifier).length && typeof value.identifier_hash === 'string' && value.identifier_hash.length)
}

// Chatwoot's iframe protocol is used instead of its page-global SDK/cookie.
// Each mount has a fresh conversation and owns only its own iframe. Public
// sessions have no identity callback or authenticated data in this bridge.
// Keep the protocol covered by staging against the deployed Chatwoot version.
export function connectChatFrame({ frame, session, identity, hostWindow = window, onReady = () => {}, onClose = () => {} }) {
  if (session.mode === 'support' && !validSupportIdentity(identity)) return () => {}
  let active = true
  let initialized = false
  const send = (message) => {
    if (active) frame.contentWindow?.postMessage(`chatwoot-widget:${JSON.stringify(message)}`, session.baseUrl)
  }
  function receive(event) {
    if (!active || event.origin !== session.baseUrl || event.source !== frame.contentWindow ||
        typeof event.data !== 'string' || event.data.length > 65536 || !event.data.startsWith('chatwoot-widget:')) return
    let message
    try { message = JSON.parse(event.data.slice('chatwoot-widget:'.length)) } catch { return }
    if (message?.event === 'loaded' && !initialized) {
      initialized = true
      send({ event: 'config-set', locale: 'en', showPopoutButton: false, showUnreadMessagesDialog: false, enableFileUpload: false, enableEndConversation: true })
      if (session.mode === 'support') {
        const { identifier, identifier_hash, name, email, org_name, plan } = identity
        send({ event: 'set-user', identifier, user: { identifier_hash, name, email } })
        send({ event: 'set-custom-attributes', customAttributes: { org_name, plan } })
      }
      send({ event: 'toggle-open', isOpen: true })
      onReady()
    } else if (initialized && ['closeWindow', 'closeChat'].includes(message?.event)) {
      onClose()
    }
    // Ignore auth-cookie messages, campaigns, popouts, URL updates, and arbitrary
    // SDK commands. In particular, never save or forward a conversation token.
  }
  hostWindow.addEventListener('message', receive)
  return () => {
    active = false
    hostWindow.removeEventListener('message', receive)
  }
}
