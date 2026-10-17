const ATTRIBUTION_KEY = 'festioMarketingAttribution'
// Match the Marketing schema. Never copy arbitrary stored fields: in particular,
// a previous visit's consent must not become a new signup or login decision.
const FIELD_LIMITS = { source: 100, medium: 100, campaign: 160, referrer: 500, landing_page: 500 }

export function acquisitionFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const fields = {}
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    if (typeof value[key] !== 'string' || !value[key]) continue
    fields[key] = Array.from(value[key]).slice(0, limit).join('')
    // The backend rejects headers over 10 KB. Leave room for the explicit
    // signup checkbox even when non-ASCII campaign/URL text expands on encode.
    while (fields[key] && encodeURIComponent(JSON.stringify(fields)).length > 9800) {
      fields[key] = Array.from(fields[key]).slice(0, -1).join('')
    }
    if (!fields[key]) delete fields[key]
  }
  return fields
}

function captureLandingAttribution() {
  try {
    const params = new URLSearchParams(window.location.search)
    const source = params.get('utm_source')
    const medium = params.get('utm_medium')
    const campaign = params.get('utm_campaign')
    const referral = params.get('ref')
    if (!source && !medium && !campaign && !referral) return {}
    const fields = acquisitionFields({
      source: source || (referral ? 'referral' : 'website'), medium, campaign,
      referrer: document.referrer || null, landing_page: window.location.href,
    })
    try { localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(fields)) } catch { /* Keep this visit in memory if storage is blocked. */ }
    return fields
  } catch { return {} }
}

// Imported by AuthContext itself, rather than depending on api.js loading before
// Firebase's auth listener creates the immutable registered lifecycle event.
const landingAttribution = captureLandingAttribution()

export function acquisitionAttribution() {
  if (Object.keys(landingAttribution).length) return { ...landingAttribution }
  let stored = {}
  try { stored = acquisitionFields(JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || 'null')) } catch { /* Unavailable or invalid storage. */ }
  return stored
}

export function acquisitionAttributionHeaders() {
  const fields = acquisitionAttribution()
  return Object.keys(fields).length ? { 'X-Festio-Attribution': encodeURIComponent(JSON.stringify(fields)) } : {}
}
