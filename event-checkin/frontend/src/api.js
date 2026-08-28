import { auth } from './firebase'

const ATTRIBUTION_KEY = 'festioMarketingAttribution'
try {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('utm_source')
  if (source || params.get('utm_campaign') || params.get('ref')) {
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({
      source: source || (params.get('ref') ? 'referral' : 'website'),
      medium: params.get('utm_medium'), campaign: params.get('utm_campaign'),
      referrer: document.referrer || null, landing_page: window.location.href,
    }))
  }
} catch { /* Storage can be unavailable in private browsing. */ }

const BASE = '/api'
// Public base for guest-facing links. Prefer a build-time override, otherwise
// use the domain the app is actually served from (so staging emits staging
// links, prod emits prod links), falling back to the production host for SSR.
// The backend re-normalizes this on save, so it is the authoritative source.
export const PUBLIC_BASE_URL =
  (import.meta.env.VITE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '') ||
  (typeof window !== 'undefined' && window.location?.origin) ||
  'https://festio.events'

export function publicBaseUrl(eventOrUrl) {
  const raw = typeof eventOrUrl === 'string' ? eventOrUrl : eventOrUrl?.checkin_base_url
  const base = (raw || '').trim().replace(/\/+$/, '')
  if (!base || base === 'https://events.vsgs.io' || base === 'http://events.vsgs.io') return PUBLIC_BASE_URL
  return base
}

async function getToken() {
  const u = auth.currentUser
  return u ? u.getIdToken() : null
}

async function req(method, path, body) {
  const token = await getToken()
  const opts = {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(() => { try { const value = localStorage.getItem(ATTRIBUTION_KEY); return value ? { 'X-Festio-Attribution': encodeURIComponent(value) } : {} } catch { return {} } })(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (res.status === 401) {
    window.location.href = '/login'
    return
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail) ? err.detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : (err.detail?.message || err.detail || err.message)
    const message = typeof detail === 'string' ? detail : detail?.message || detail?.error || res.statusText
    const e = new Error(message || res.statusText)
    e.status = res.status
    e.detail = detail
    e.requiredPlan = res.headers.get('x-required-plan') || detail?.required_plan || ''
    throw e
  }
  return res.status === 204 ? null : res.json()
}

let festiomeSession = (() => {
  try {
    const stored = JSON.parse(sessionStorage.getItem('festiomeGuestSession') || 'null')
    return stored?.token && stored?.expiresAt > Date.now() + 30000 ? { ...stored, kind: 'guest' } : null
  } catch {
    return null
  }
})()

async function getFestioMeSession(force = false) {
  const now = Date.now()
  const firebaseUser = auth.currentUser
  const onGuestRoute = typeof window !== 'undefined' && window.location?.pathname === '/festiome/guest'
  if (!force && festiomeSession?.token && festiomeSession.expiresAt > now + 30000 &&
      (festiomeSession.kind !== 'guest' || !firebaseUser || onGuestRoute)) {
    return festiomeSession.token
  }
  const firebaseToken = await getToken()
  if (!firebaseToken) throw new Error('Your Festio session is still loading. Please try again.')
  const res = await fetch(`${BASE}/auth/festiome-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${firebaseToken}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const error = new Error(data.detail || 'FestioMe authentication is temporarily unavailable.')
    error.status = res.status
    throw error
  }
  const data = await res.json()
  festiomeSession = {
    token: data.token,
    expiresAt: now + Number(data.expires_in || 900) * 1000,
    kind: 'user',
  }
  return data.token
}

async function startFestioMeGuestSession(eventId, passToken) {
  const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}/festiome/guest-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pass_token: passToken }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const error = new Error(data.detail || 'This Festio pass cannot open FestioMe.')
    error.status = res.status
    throw error
  }
  const data = await res.json()
  const parsedExpiry = Date.parse(data.expires_at)
  festiomeSession = {
    token: data.token,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 30 * 60 * 1000,
    kind: 'guest',
    eventId,
    passToken,
  }
  try {
    sessionStorage.setItem('festiomeGuestSession', JSON.stringify(festiomeSession))
  } catch {
    // Private browsing may disable session storage; the in-memory token works.
  }
  return data
}

async function festiomeReq(method, path, body, retry = true) {
  const token = await getFestioMeSession()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  })
  if (res.status === 401 && retry) {
    festiomeSession = null
    try {
      sessionStorage.removeItem('festiomeGuestSession')
    } catch {
      // Ignore storage restrictions.
    }
    await getFestioMeSession(true)
    return festiomeReq(method, path, body, false)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const error = new Error(data.detail || res.statusText || 'FestioMe request failed')
    error.status = res.status
    throw error
  }
  return res.status === 204 ? null : res.json()
}

async function festiomeUpload(channelId, file) {
  const token = await getFestioMeSession()
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/festiome/v1/channels/${encodeURIComponent(channelId)}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const error = new Error(data.detail || 'FestioMe upload failed')
    error.status = res.status
    throw error
  }
  return res.json()
}

async function festiomeDownloadAttachment(path, filename) {
  const token = await getFestioMeSession()
  const normalized = path.startsWith('/festiome/') ? path : `/festiome${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(`${BASE}${normalized}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error('FestioMe attachment could not be downloaded')
  const url = URL.createObjectURL(await res.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'FestioMe-attachment'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

let plannerSession = null // { token, expiresAt, eventId }

async function getPlannerSession(eventId, force = false) {
  const now = Date.now()
  if (!force && plannerSession?.token && plannerSession.eventId === eventId && plannerSession.expiresAt > now + 30000) {
    return plannerSession.token
  }
  const firebaseToken = await getToken()
  if (!firebaseToken) throw new Error('Your Festio session is still loading. Please try again.')
  const res = await fetch(`${BASE}/auth/planner-token?event_id=${encodeURIComponent(eventId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${firebaseToken}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const error = new Error(data.detail || 'Planner is temporarily unavailable.')
    error.status = res.status
    throw error
  }
  const data = await res.json()
  plannerSession = { token: data.token, expiresAt: now + Number(data.expires_in || 900) * 1000, eventId }
  return data.token
}

async function plannerReq(eventId, method, path, body, options = {}) {
  const token = await getPlannerSession(eventId)
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !options.isForm ? { 'Content-Type': 'application/json' } : {}) },
  }
  if (body) opts.body = options.isForm ? body : JSON.stringify(body)
  const res = await fetch(`${BASE}/planner/${encodeURIComponent(eventId)}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail) ? err.detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : err.detail
    throw new Error((typeof detail === 'string' && detail) || res.statusText)
  }
  return res.status === 204 ? null : res.json()
}

async function plannerDownload(eventId, path, filename) {
  const token = await getPlannerSession(eventId)
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || 'Planner document could not be downloaded')
  }
  const url = URL.createObjectURL(await res.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'planner-document'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

let liveSession = null // { token, expiresAt, eventId }

async function getLiveSession(eventId, force = false) {
  const now = Date.now()
  if (!force && liveSession?.token && liveSession.eventId === eventId && liveSession.expiresAt > now + 30000) {
    return liveSession.token
  }
  const firebaseToken = await getToken()
  if (!firebaseToken) throw new Error('Your Festio session is still loading. Please try again.')
  const res = await fetch(`${BASE}/auth/live-token?event_id=${encodeURIComponent(eventId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${firebaseToken}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const error = new Error(data.detail || 'Festio Live is temporarily unavailable.')
    error.status = res.status
    throw error
  }
  const data = await res.json()
  liveSession = { token: data.token, expiresAt: now + Number(data.expires_in || 900) * 1000, eventId }
  return data.token
}

async function liveReq(eventId, method, path, body, options = {}) {
  const token = await getLiveSession(eventId)
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(10000),
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}/engagement${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail) ? err.detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : err.detail
    throw new Error((typeof detail === 'string' && detail) || res.statusText)
  }
  return res.status === 204 ? null : res.json()
}

async function downloadLiveExport(eventId, activityId, title = 'festio-live') {
  const token = await getLiveSession(eventId)
  const res = await fetch(`${BASE}/engagement/v1/activities/${activityId}/export.csv`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Export could not be generated')
  const url = URL.createObjectURL(await res.blob())
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-responses.csv`
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
}

async function downloadLiveEventReport(eventId) {
  const token = await getLiveSession(eventId)
  const res = await fetch(`${BASE}/engagement/v1/analytics/export.csv`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error('Analytics report could not be generated')
  const url = URL.createObjectURL(await res.blob())
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'festio-live-event-analytics.csv'
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
}

// Guest-facing: exchange the guest's own pass token (from their Guest Hub
// link) for a Festio Live participation session — no Firebase login involved,
// same shape as festiome's guest-token exchange.
async function getLiveGuestSession(eventId, passToken) {
  const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}/live/guest-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pass_token: passToken }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || "This activity isn't available right now.")
  }
  return res.json() // { token, expires_in }
}

async function liveGuestReq(guestToken, method, path, body) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${guestToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(10000),
  }
  if (body) opts.body = JSON.stringify(body)
  let res
  try {
    res = await fetch(`${BASE}/engagement${path}`, opts)
  } catch (cause) {
    const error = new Error("We're having trouble connecting to this live activity. Please try again shortly.")
    error.code = 'FESTIO_LIVE_UNAVAILABLE'
    error.cause = cause
    throw error
  }
  if (!res.ok) {
    if (res.status >= 500) {
      const error = new Error("We're having trouble connecting to this live activity. Please try again shortly.")
      error.code = 'FESTIO_LIVE_UNAVAILABLE'
      error.status = res.status
      throw error
    }
    const err = await res.json().catch(() => ({}))
    const detail = typeof err.detail === 'string' ? err.detail : err.detail?.message
    const error = new Error(detail || "This live activity isn't available right now.")
    error.status = res.status
    throw error
  }
  return res.status === 204 ? null : res.json()
}

let marketingSession = null
async function marketingReq(method, path, body) {
  const now = Date.now()
  if (!marketingSession?.token || marketingSession.expiresAt < now + 30000) {
    const firebaseToken = await getToken()
    if (!firebaseToken) throw new Error('Your Festio session is still loading. Please try again.')
    const authRes = await fetch(`${BASE}/auth/marketing-token`, {
      method: 'POST', headers: { Authorization: `Bearer ${firebaseToken}` }, signal: AbortSignal.timeout(10000),
    })
    if (!authRes.ok) {
      const data = await authRes.json().catch(() => ({})); const error = new Error(data.detail || 'Marketing is not available.')
      error.status = authRes.status; throw error
    }
    const data = await authRes.json()
    marketingSession = { token: data.token, expiresAt: now + Number(data.expires_in || 900) * 1000 }
  }
  const res = await fetch(`${BASE}/marketing${path}`, {
    method, headers: { Authorization: `Bearer ${marketingSession.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})); const error = new Error(data.detail || res.statusText)
    error.status = res.status; throw error
  }
  return res.status === 204 ? null : res.json()
}

async function marketingDownload(path, filename) {
  await marketingReq('GET', '/me')
  const res = await fetch(`${BASE}/marketing${path}`, { headers: { Authorization: `Bearer ${marketingSession.token}` } })
  if (!res.ok) throw new Error('Marketing export could not be downloaded')
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

async function marketingUpload(path, file) {
  await marketingReq('GET', '/me')
  const form = new FormData(); form.append('file', file)
  const res = await fetch(`${BASE}/marketing${path}`, { method: 'POST', headers: { Authorization: `Bearer ${marketingSession.token}` }, body: form })
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.detail || 'Marketing import failed') }
  return res.json()
}

let ticketingSession = null
async function ticketingReq(eventId, method, path, body) {
  const now = Date.now()
  if (!ticketingSession?.token || ticketingSession.eventId !== eventId || ticketingSession.expiresAt < now + 30000) {
    const firebaseToken = await getToken()
    if (!firebaseToken) throw new Error('Your Festio session is still loading. Please try again.')
    const authRes = await fetch(`${BASE}/auth/ticketing-token?event_id=${encodeURIComponent(eventId)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${firebaseToken}` }, signal: AbortSignal.timeout(10000),
    })
    if (!authRes.ok) {
      const data = await authRes.json().catch(() => ({}))
      const error = new Error(data.detail || 'Ticketing is not available.'); error.status = authRes.status; throw error
    }
    const data = await authRes.json()
    ticketingSession = { token: data.token, eventId, expiresAt: now + Number(data.expires_in || 900) * 1000 }
  }
  const res = await fetch(`${BASE}/ticketing${path}`, {
    method, headers: { Authorization: `Bearer ${ticketingSession.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})); const error = new Error(data.detail || res.statusText)
    error.status = res.status; throw error
  }
  return res.status === 204 ? null : res.json()
}

// Fetch a file endpoint (with auth) and trigger a browser download.
async function downloadFile(path, filename, { withAuth = true } = {}) {
  const headers = {}
  if (withAuth) {
    const token = await getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${BASE}${path}`, { headers })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const api = {
  submitDemoRequest: (body) => req('POST', '/demo-requests', body),

  // Events
  listEvents: (status) => req('GET', status ? `/events?status=${encodeURIComponent(status)}` : '/events'),
  createEvent: (data) => req('POST', '/events', data),
  updateEvent: (id, data) => req('PUT', `/events/${id}`, data),
  deleteEvent: (id) => req('DELETE', `/events/${id}`),
  duplicateEvent: (id, data) => req('POST', `/events/${id}/duplicate`, data),
  changeStatus: (id, status, ifUnmodifiedSince) =>
    req('PATCH', `/events/${id}/status`, ifUnmodifiedSince ? { status, if_unmodified_since: ifUnmodifiedSince } : { status }),
  updateSource: (id, data) => req('PUT', `/events/${id}/source`, data),
  syncNow: (id) => req('POST', `/events/${id}/sync-now`),

  // Team
  listMembers: (eventId) => req('GET', `/events/${eventId}/members`),
  assignMember: (eventId, userId) => req('POST', `/events/${eventId}/members`, { user_id: userId }),
  removeMember: (eventId, userId) => req('DELETE', `/events/${eventId}/members/${userId}`),

  // Guests
  myMenuEvents: () => req('GET', '/events/me/menu-events'),
  listGuests: (eventId) => req('GET', `/events/${eventId}/guests`),
  downloadGuestTemplate: (eventId, fmt = 'xlsx') => downloadFile(`/events/${eventId}/guests/template?fmt=${fmt}`, `guest-template.${fmt}`),
  downloadGuestList: (eventId, fmt = 'csv', sections = null, guestIds = null) =>
    downloadFile(
      `/events/${eventId}/guests/export?fmt=${fmt}`
        + (sections ? `&sections=${encodeURIComponent(sections)}` : '')
        + (guestIds && guestIds.length ? `&guest_ids=${encodeURIComponent(guestIds.join(','))}` : ''),
      `${sections && sections.split(',').length === 1 ? sections : 'event-export'}.${fmt}`,
    ),
  importGuestsFromUrl: (eventId, url) => req('POST', `/events/${eventId}/guests/import-url`, { url }),
  addGuest: (eventId, data) => req('POST', `/events/${eventId}/guests`, data),
  listGuestDuplicates: (eventId) => req('GET', `/events/${eventId}/guests/duplicates`),
  mergeGuestDuplicates: (eventId, keepId, duplicateIds) => req('POST', `/events/${eventId}/guests/${keepId}/merge-duplicates`, { duplicate_ids: duplicateIds }),

  // Design Studio (templates read direct from design-service; the rest via the
  // core-backend proxy which enforces auth + event ownership).
  designTemplates: (query = '') => req('GET', `/v1/design/templates${query}`),
  getEventDesign: (eventId) => req('GET', `/events/${eventId}/design`),
  saveEventDesign: (eventId, data) => req('PUT', `/events/${eventId}/design`, data),
  publishEventDesign: (eventId) => req('POST', `/events/${eventId}/design/publish`),
  designOutputs: (eventId) => req('GET', `/events/${eventId}/design/outputs`),
  // capabilities gates hub_layout module visibility server-side too (not just
  // in the render logic here) -- pass the event's real feature flags so a
  // stale/over-permissive saved layout can never come back showing a module
  // for a feature this event doesn't actually have.
  publicDesignTheme: (eventId, capabilities = {}) => {
    const params = new URLSearchParams({
      experience_enabled: String(!!capabilities.experience_enabled),
      live_program_enabled: String(!!capabilities.live_program_enabled),
      festiome_enabled: String(!!capabilities.festiome_enabled),
    })
    return fetch(`/api/v1/design/events/${encodeURIComponent(eventId)}/public-theme?${params}`, {
      cache: 'no-store',
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Design theme unavailable'))))
  },
  uploadDesignAsset: (eventId, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return getToken().then((token) =>
      fetch(`${BASE}/events/${eventId}/design/assets`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Upload failed'))))),
    )
  },
  renderFlyer: async (eventId, body, { download = true } = {}) => {
    const token = await getToken()
    const res = await fetch(`${BASE}/events/${eventId}/design/render/flyer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Render failed — Design Studio may be busy or unavailable.')
    const outputUrl = res.headers.get('X-Design-Output-Url')
    const blob = await res.blob()
    if (download) {
      const fmt = body.format || (['a5', 'a4'].includes(body.size) ? 'pdf' : 'png')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `flyer-${body.size}.${fmt}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }
    // Preview renders (body.preview=true) skip server-side persistence, so
    // outputUrl is never set for them — the caller displays this blob
    // directly instead (see Design Studio's live flyer preview).
    return { outputUrl, blob }
  },
  generateQR: (eventId) => req('POST', `/events/${eventId}/guests/generate-qr`),
  sendInvites: (eventId) => req('POST', `/events/${eventId}/guests/send-invites`),
  sendInvitesBatch: (eventId, guestIds, force = false) =>
    req('POST', `/events/${eventId}/guests/send-batch`, {
      guest_ids: guestIds,
      force,
    }),
  updateGuest: (eventId, guestId, data, ifUnmodifiedSince) =>
    req('PATCH', `/events/${eventId}/guests/${guestId}${ifUnmodifiedSince ? `?if_unmodified_since=${encodeURIComponent(ifUnmodifiedSince)}` : ''}`, data),
  guestRsvpAnswers: (eventId, guestId) => req('GET', `/events/${eventId}/guests/${guestId}/rsvp-answers`),
  deleteGuest: (eventId, guestId) => req('DELETE', `/events/${eventId}/guests/${guestId}`),
  resendInvite: (eventId, guestId) => req('POST', `/events/${eventId}/guests/${guestId}/resend-invite`),
  resendGuestEmail: (eventId, guestId, kind) => req('POST', `/events/${eventId}/guests/${guestId}/resend-email`, { kind }),
  ensureInviteToken: (eventId, guestId) => req('POST', `/events/${eventId}/guests/${guestId}/invite-token`),
  approveRsvp: (eventId, guestId) => req('POST', `/events/${eventId}/guests/${guestId}/approve`),
  rejectRsvp: (eventId, guestId) => req('POST', `/events/${eventId}/guests/${guestId}/reject`),
  guestQrUrl: (eventId, guestId) => `${BASE}/events/${eventId}/guests/${guestId}/qr.png`,
  uploadGuests: (eventId, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return getToken().then((token) =>
      fetch(`${BASE}/events/${eventId}/guests/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),
    )
  },

  // Features
  toggleFeatures: async (eventId, body) => {
    const updated = await req('PATCH', `/events/${eventId}/features`, body)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('festio:event-updated', { detail: updated }))
    }
    return updated
  },
  setChannelPolicy: (eventId, policy) => req('PUT', `/events/${eventId}/channel-policy`, policy),
  sendTestMessage: (eventId, channel, phone) => req('POST', `/events/${eventId}/messaging/test`, { channel, phone }),
  logRedesignTelemetry: (data) => req('POST', '/telemetry/redesign', data),

  // Experience workflows (admin)
  listExperienceWorkflows: (eventId) => req('GET', `/events/${eventId}/experience/workflows`),
  getExperienceLiveSync: (eventId) => req('GET', `/events/${eventId}/experience/live-sync`),
  queueExperienceLiveSync: (eventId) => req('POST', `/events/${eventId}/experience/live-sync`, {}),
  getExperienceDashboard: (eventId) => req('GET', `/events/${eventId}/experience/dashboard`),
  getExperienceAnalytics: (eventId) => req('GET', `/events/${eventId}/experience/analytics`),
  getFeedbackResults: (eventId, filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined && value !== null)).toString()
    return req('GET', `/events/${eventId}/experience/feedback/results${qs ? `?${qs}` : ''}`)
  },
  getFeedbackReminderPreview: (eventId, stepId, channels) => req('GET', `/events/${eventId}/experience/feedback/${stepId}/reminders/preview?channels=${encodeURIComponent(channels.join(','))}`),
  sendFeedbackReminders: (eventId, stepId, data) => req('POST', `/events/${eventId}/experience/feedback/${stepId}/reminders`, data),
  prepareFeedbackDraft: (eventId) => req('POST', `/events/${eventId}/experience/feedback/prepare-draft`),
  createDefaultExperienceWorkflow: (eventId) => req('POST', `/events/${eventId}/experience/default-workflow`),
  createExperienceWorkflow: (eventId, data) => req('POST', `/events/${eventId}/experience/workflows`, data),
  getExperienceWorkflow: (eventId, workflowId) => req('GET', `/events/${eventId}/experience/workflows/${workflowId}`),
  deleteExperienceWorkflow: (eventId, workflowId) => req('DELETE', `/events/${eventId}/experience/workflows/${workflowId}`),
  createExperienceStep: (eventId, workflowId, data) => req('POST', `/events/${eventId}/experience/workflows/${workflowId}/steps`, data),
  importProgramSegments: (eventId, workflowId, items) => req('POST', `/events/${eventId}/experience/workflows/${workflowId}/program/import`, { items }),
  updateExperienceStep: (eventId, workflowId, stepId, data) => req('PUT', `/events/${eventId}/experience/workflows/${workflowId}/steps/${stepId}`, data),
  deleteExperienceStep: (eventId, workflowId, stepId) => req('DELETE', `/events/${eventId}/experience/workflows/${workflowId}/steps/${stepId}`),
  reorderExperienceSteps: (eventId, workflowId, stepIds) =>
    req('POST', `/events/${eventId}/experience/workflows/${workflowId}/steps/reorder`, { step_ids: stepIds }),
  publishExperienceWorkflow: (eventId, workflowId) => req('POST', `/events/${eventId}/experience/workflows/${workflowId}/publish`),
  unpublishExperienceWorkflow: (eventId, workflowId) => req('POST', `/events/${eventId}/experience/workflows/${workflowId}/unpublish`),
  archiveExperienceWorkflow: (eventId, workflowId) => req('POST', `/events/${eventId}/experience/workflows/${workflowId}/archive`),
  unarchiveExperienceWorkflow: (eventId, workflowId) => req('POST', `/events/${eventId}/experience/workflows/${workflowId}/unarchive`),
  cloneExperienceWorkflow: (eventId, workflowId, name) =>
    req('POST', `/events/${eventId}/experience/workflows/${workflowId}/clone`, {
      name,
    }),
  getGuestExperience: (eventId, guestId) => req('GET', `/events/${eventId}/experience/guests/${guestId}`),
  updateGuestExperienceStep: (eventId, guestId, stepId, data) => req('PUT', `/events/${eventId}/experience/guests/${guestId}/steps/${stepId}`, data),
  listExperienceAudit: (eventId, limit = 100) => req('GET', `/events/${eventId}/experience/audit?limit=${limit}`),
  getExperienceNextSteps: (eventId, guestId) => req('GET', `/events/${eventId}/experience/guests/${guestId}/next-steps`),
  downloadExperienceExport: (eventId) => downloadFile(`/events/${eventId}/experience/export.csv`, `experience-progress.csv`),
  downloadFeedbackExport: (eventId) => downloadFile(`/events/${eventId}/experience/feedback/export.csv`, 'feedback-results.csv'),
  getConsentForm: (eventId) => req('GET', `/events/${eventId}/experience/consent-form`),
  saveConsentForm: (eventId, data) => req('PUT', `/events/${eventId}/experience/consent-form`, data),
  disableConsentForm: (eventId) => req('DELETE', `/events/${eventId}/experience/consent-form`),
  listConsentSignatures: (eventId) => req('GET', `/events/${eventId}/experience/consent-signatures`),

  // Seating
  listTables: (eventId) => req('GET', `/events/${eventId}/tables`),
  createTable: (eventId, data) => req('POST', `/events/${eventId}/tables`, data),
  updateTable: (eventId, tableId, data, ifUnmodifiedSince) =>
    req('PUT', `/events/${eventId}/tables/${tableId}${ifUnmodifiedSince ? `?if_unmodified_since=${encodeURIComponent(ifUnmodifiedSince)}` : ''}`, data),
  deleteTable: (eventId, tableId) => req('DELETE', `/events/${eventId}/tables/${tableId}`),

  // Floor-plan designer (admin, logged-in)
  getFloorPlan: (eventId) => req('GET', `/events/${eventId}/floor-plan`),
  saveFloorPlan: (eventId, data) => req('PUT', `/events/${eventId}/floor-plan`, data),
  shareFloorPlan: (eventId) => req('POST', `/events/${eventId}/floor-plan/share`),
  floorPlanPdf: (eventId, name = 'floor-plan') => downloadFile(`/events/${eventId}/floor-plan.pdf`, `${name}.pdf`),
  uploadFloorBg: async (eventId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}/floor-plan/bg`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Upload failed')
    return r.json()
  },
  // Floor-plan client share links (no login) — view or edit token
  getSharedFloor: (token) =>
    fetch(`${BASE}/floor/${encodeURIComponent(token)}`).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'This floor-plan link is not valid.'))),
    ),
  saveSharedFloor: (token, data) =>
    fetch(`${BASE}/floor/${encodeURIComponent(token)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Could not save.'))))),
  getSeatingChart: (eventId) => req('GET', `/events/${eventId}/seating`),
  autoAssign: (eventId, clear = false) => req('POST', `/events/${eventId}/seating/auto-assign?clear=${clear}`),
  assignSeat: (eventId, guestId, body) => req('PATCH', `/events/${eventId}/guests/${guestId}/seat`, body),
  markMealServed: (eventId, guestId) => req('PATCH', `/events/${eventId}/guests/${guestId}/meal-served`),
  markCategoryServed: (eventId, categoryId, guestId) =>
    req('PATCH', `/events/${eventId}/menu-categories/${categoryId}/guests/${guestId}/served`),
  unmarkCategoryServed: (eventId, categoryId, guestId) =>
    req('DELETE', `/events/${eventId}/menu-categories/${categoryId}/guests/${guestId}/served`),
  updateMemberPermissions: (eventId, userId, body, ifUnmodifiedSince) =>
    req('PATCH', `/events/${eventId}/members/${userId}/permissions`, ifUnmodifiedSince ? { ...body, if_unmodified_since: ifUnmodifiedSince } : body),
  setMemberSections: (eventId, userId, ids) =>
    req('PUT', `/events/${eventId}/members/${userId}/sections`, {
      table_group_ids: ids,
    }),

  // Table Groups (seating)
  listTableGroups: (eventId) => req('GET', `/events/${eventId}/table-groups`),
  createTableGroup: (eventId, data) => req('POST', `/events/${eventId}/table-groups`, data),
  updateTableGroup: (eventId, id, data) => req('PUT', `/events/${eventId}/table-groups/${id}`, data),
  setTableGroupTables: (eventId, id, tableIds) =>
    req('PUT', `/events/${eventId}/table-groups/${id}/tables`, {
      table_ids: tableIds,
    }),
  deleteTableGroup: (eventId, id) => req('DELETE', `/events/${eventId}/table-groups/${id}`),
  bulkAssignTableGroup: (eventId, guestIds, tableGroupId) =>
    req('POST', `/events/${eventId}/guests/bulk-assign-group`, {
      guest_ids: guestIds,
      table_group_id: tableGroupId,
    }),

  // Households (family grouping — independent of seating table groups)
  listHouseholds: (eventId) => req('GET', `/events/${eventId}/households`),
  createHousehold: (eventId, data) => req('POST', `/events/${eventId}/households`, data),
  updateHousehold: (eventId, id, data) => req('PUT', `/events/${eventId}/households/${id}`, data),
  deleteHousehold: (eventId, id) => req('DELETE', `/events/${eventId}/households/${id}`),
  bulkAssignHousehold: (eventId, guestIds, householdId) =>
    req('POST', `/events/${eventId}/guests/bulk-assign-household`, {
      guest_ids: guestIds,
      household_id: householdId,
    }),

  // Tasks (per-event to-do management)
  listTasks: (eventId) => req('GET', `/events/${eventId}/tasks`),
  listTaskAssignees: (eventId) => req('GET', `/events/${eventId}/tasks/assignees`),
  createTask: (eventId, data) => req('POST', `/events/${eventId}/tasks`, data),
  updateTask: (eventId, id, data, ifUnmodifiedSince) =>
    req('PUT', `/events/${eventId}/tasks/${id}${ifUnmodifiedSince ? `?if_unmodified_since=${encodeURIComponent(ifUnmodifiedSince)}` : ''}`, data),
  startTask: (eventId, id) => req('POST', `/events/${eventId}/tasks/${id}/start`),
  completeTask: (eventId, id) => req('POST', `/events/${eventId}/tasks/${id}/complete`),
  reopenTask: (eventId, id) => req('POST', `/events/${eventId}/tasks/${id}/reopen`),
  deleteTask: (eventId, id) => req('DELETE', `/events/${eventId}/tasks/${id}`),
  listMyTasks: (assignment = 'mine') => req('GET', `/tasks/mine?assignment=${encodeURIComponent(assignment)}`),
  listTaskActivity: (eventId, id) => req('GET', `/events/${eventId}/tasks/${id}/activity`),
  addTaskComment: (eventId, id, body) => req('POST', `/events/${eventId}/tasks/${id}/comments`, { body }),
  listSubtasks: (eventId, taskId) => req('GET', `/events/${eventId}/tasks/${taskId}/subtasks`),
  createSubtask: (eventId, taskId, title) => req('POST', `/events/${eventId}/tasks/${taskId}/subtasks`, { title }),
  updateSubtask: (eventId, taskId, id, data) => req('PATCH', `/events/${eventId}/tasks/${taskId}/subtasks/${id}`, data),
  deleteSubtask: (eventId, taskId, id) => req('DELETE', `/events/${eventId}/tasks/${taskId}/subtasks/${id}`),
  listTaskAttachments: (eventId, taskId) => req('GET', `/events/${eventId}/tasks/${taskId}/attachments`),
  uploadTaskAttachment: async (eventId, taskId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/events/${eventId}/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },
  deleteTaskAttachment: (eventId, taskId, id) => req('DELETE', `/events/${eventId}/tasks/${taskId}/attachments/${id}`),

  // Public API keys (org-scoped)
  listApiKeys: () => req('GET', '/organizations/me/api-keys'),
  createApiKey: (name, scope = 'read_only') => req('POST', '/organizations/me/api-keys', { name, scope }),
  revokeApiKey: (id) => req('DELETE', `/organizations/me/api-keys/${id}`),
  listApiKeyRequests: (id) => req('GET', `/organizations/me/api-keys/${id}/requests`),
  getPublicApiSchema: () => req('GET', '/organizations/me/public-api-schema'),

  // Outbound webhooks (org-scoped)
  listWebhooks: () => req('GET', '/organizations/me/webhooks'),
  createWebhook: (url, eventTypes) => req('POST', '/organizations/me/webhooks', { url, event_types: eventTypes }),
  deleteWebhook: (id) => req('DELETE', `/organizations/me/webhooks/${id}`),
  listWebhookDeliveries: (id) => req('GET', `/organizations/me/webhooks/${id}/deliveries`),

  // Org-level recurring subscription (gates read-write API access, org-scoped)
  getOrgSubscription: () => req('GET', '/organizations/me/subscription'),
  listSubscriptionPlans: () => req('GET', '/organizations/me/subscription/plans'),
  createOrgSubscriptionCheckout: (planKey) => req('POST', '/organizations/me/subscription/checkout', { plan_key: planKey }),
  cancelOrgSubscription: () => req('POST', '/organizations/me/subscription/cancel'),

  // Org plan catalog (superadmin console)
  adminListOrgPlans: () => req('GET', '/admin/org-plans'),
  adminSaveOrgPlan: (key, body) => req('PUT', `/admin/org-plans/${key}`, body),
  adminDeleteOrgPlan: (key) => req('DELETE', `/admin/org-plans/${key}`),

  // Contact lists (org-scoped audience for private calendars)
  listContactLists: () => req('GET', '/organizations/me/contact-lists'),
  createContactList: (name) => req('POST', '/organizations/me/contact-lists', { name }),
  deleteContactList: (id) => req('DELETE', `/organizations/me/contact-lists/${id}`),
  listContacts: (listId) => req('GET', `/organizations/me/contact-lists/${listId}/contacts`),
  addContact: (listId, data) => req('POST', `/organizations/me/contact-lists/${listId}/contacts`, data),
  pasteContacts: (listId, text) => req('POST', `/organizations/me/contact-lists/${listId}/contacts/paste`, { text }),
  importContactsCsv: async (listId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/organizations/me/contact-lists/${listId}/contacts/csv`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },
  deleteContact: (listId, contactId) => req('DELETE', `/organizations/me/contact-lists/${listId}/contacts/${contactId}`),

  // Event Calendars
  listCalendars: () => req('GET', '/organizations/me/calendars'),
  createCalendar: (data) => req('POST', '/organizations/me/calendars', data),
  getCalendar: (id) => req('GET', `/organizations/me/calendars/${id}`),
  updateCalendar: (id, data) => req('PUT', `/organizations/me/calendars/${id}`, data),
  deleteCalendar: (id) => req('DELETE', `/organizations/me/calendars/${id}`),
  addCalendarEvent: (id, eventId) => req('POST', `/organizations/me/calendars/${id}/events/${eventId}`),
  removeCalendarEvent: (id, eventId) => req('DELETE', `/organizations/me/calendars/${id}/events/${eventId}`),
  reorderCalendarEvents: (id, eventIds) => req('POST', `/organizations/me/calendars/${id}/events/reorder`, { event_ids: eventIds }),
  setCalendarContactLists: (id, contactListIds) => req('PUT', `/organizations/me/calendars/${id}/contact-lists`, { contact_list_ids: contactListIds }),
  sendCalendarLinks: (id) => req('POST', `/organizations/me/calendars/${id}/send`),
  uploadCalendarLogo: async (id, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/organizations/me/calendars/${id}/upload-logo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },
  deleteCalendarLogo: (id) => req('DELETE', `/organizations/me/calendars/${id}/upload-logo`),
  // Public — no auth header needed, same as inviteUrl-style helpers.
  resolveCalendar: (token) => fetch(`${BASE}/calendars/${token}`).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  }),

  // Menu (admin)
  listMenuCategories: (eventId) => req('GET', `/events/${eventId}/menu-categories`),
  createMenuCategory: (eventId, data) => req('POST', `/events/${eventId}/menu-categories`, data),
  updateMenuCategory: (eventId, catId, data) => req('PUT', `/events/${eventId}/menu-categories/${catId}`, data),
  deleteMenuCategory: (eventId, catId) => req('DELETE', `/events/${eventId}/menu-categories/${catId}`),
  addMenuItem: (eventId, catId, data) => req('POST', `/events/${eventId}/menu-categories/${catId}/items`, data),
  updateMenuItem: (eventId, itemId, data) => req('PUT', `/events/${eventId}/menu-items/${itemId}`, data),
  deleteMenuItem: (eventId, itemId) => req('DELETE', `/events/${eventId}/menu-items/${itemId}`),
  getMenuSummary: (eventId) => req('GET', `/events/${eventId}/menu/summary`),
  getMenuDashboard: (eventId) => req('GET', `/events/${eventId}/menu/dashboard`),

  // Menu combinations (combo categories)
  createCombination: (eventId, catId, data) => req('POST', `/events/${eventId}/menu-categories/${catId}/combinations`, data),
  updateCombination: (eventId, comboId, data) => req('PUT', `/events/${eventId}/menu-combinations/${comboId}`, data),
  deleteCombination: (eventId, comboId) => req('DELETE', `/events/${eventId}/menu-combinations/${comboId}`),

  // Scanner
  scan: (token, body) => req('POST', `/scan/${token}`, body),
  scanCheckout: (token) => req('POST', `/scan/${token}/checkout`),
  offlineManifest: (eventId) => req('GET', `/scan/offline-manifest/${eventId}`),
  // Manual check-in (no QR)
  searchGuests: (eventId, q) => req('GET', `/events/${eventId}/guests/search?q=${encodeURIComponent(q)}`),
  manualCheckin: (eventId, guestId, tableGroupId) =>
    req('POST', `/events/${eventId}/guests/${guestId}/checkin${tableGroupId ? `?table_group_id=${encodeURIComponent(tableGroupId)}` : ''}`),
  manualCheckout: (eventId, guestId) =>
    req('POST', `/events/${eventId}/guests/${guestId}/checkout`),
  // Section-based scanning: sections (table groups) the signed-in staffer may check into.
  myEventSections: (eventId) => req('GET', `/events/${eventId}/my-sections`),
  // Walk-in
  setWalkIn: (eventId, active) => req('PATCH', `/events/${eventId}/walk-in`, { active }),
  setWalkInGroup: (eventId, tableGroupId) =>
    req('PATCH', `/events/${eventId}/walk-in-group`, {
      table_group_id: tableGroupId,
    }),
  setWalkInGroupChoice: (eventId, enabled) =>
    req('PATCH', `/events/${eventId}/walk-in-group-choice`, { enabled }),
  setDefaultGuestGroup: (eventId, tableGroupId) =>
    req('PATCH', `/events/${eventId}/default-guest-group`, {
      table_group_id: tableGroupId,
    }),
  registerWalkIn: (eventId, data) => req('POST', `/events/${eventId}/guests/walk-in`, data),
  adminSetManualCheckin: (eventId, active) => req('PATCH', `/admin/events/${eventId}/manual-checkin`, { active }),
  adminSetMms: (eventId, active) => req('PATCH', `/admin/events/${eventId}/mms`, { active }),
  setSelfCheckin: (eventId, active) => req('PATCH', `/events/${eventId}/self-checkin`, { active }),

  // Public self check-in
  selfCheckinInfo: (code) => fetch(`${BASE}/e/${encodeURIComponent(code)}`).then((r) => r.json()),
  selfCheckinSearch: (code, query) =>
    fetch(`${BASE}/e/${encodeURIComponent(code)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),
  selfCheckinAdmit: (code, guestId) =>
    fetch(`${BASE}/e/${encodeURIComponent(code)}/checkin/${encodeURIComponent(guestId)}`, { method: 'POST' }).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))),
    ),
  selfCheckinUrl: (code, event) => `${publicBaseUrl(event)}/e/${code}`,
  selfCheckinQrUrl: (code) => `${BASE}/e/${encodeURIComponent(code)}/qr.png`,

  // Ticket (public)
  viewTicket: (token) => fetch(`/api/scan/${token}/ticket`).then((r) => r.json()),
  viewConsent: (token) => fetch(`/api/scan/${token}/consent`).then((r) => r.json()),
  signConsent: (token, payload) =>
    fetch(`/api/scan/${token}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),
  sendConsentCopy: (token) =>
    fetch(`/api/scan/${token}/consent/send-copy`, { method: 'POST' }).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))),
    ),
  consentDownloadUrl: (token) => `/api/scan/${encodeURIComponent(token)}/consent/download`,
  consentPdfDownloadUrl: (token) => `/api/scan/${encodeURIComponent(token)}/consent/download.pdf`,

  // Menu submit (public — guest, no auth)
  submitMenuChoice: (token, payload) =>
    fetch(`/api/scan/${token}/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),

  // Partner pairing (public — guest, no auth)
  pairPartner: (token, partner_first_name, partner_last_name, partner_email) =>
    fetch(`/api/scan/${token}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_first_name,
        partner_last_name,
        partner_email,
      }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),
  unpairPartner: (token) =>
    fetch(`/api/scan/${token}/pair`, { method: 'DELETE' }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),

  // Notification consent (public — guest, no auth)
  updatePreferences: (token, body) =>
    fetch(`/api/scan/${token}/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),

  // Dashboard
  getDashboard: (eventId) => req('GET', `/events/${eventId}/dashboard`),

  // Results / multi-day command center (dashboard-service, read-only, Track A —
  // see docs/MULTI-DAY-DASHBOARD-IMPLEMENTATION-PLAN.md). Separate service from
  // the legacy dashboard endpoint above; both can be called independently.
  resultsCommandCenter: (eventId, { day, start, end, venueId } = {}) => {
    const params = new URLSearchParams()
    if (day) params.set('day', day)
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    if (venueId) params.set('venue_id', venueId)
    const qs = params.toString()
    return req('GET', `/results/events/${eventId}/command-center${qs ? `?${qs}` : ''}`)
  },
  resultsAttendance: (eventId, { day, start, end, venueId } = {}) => {
    const params = new URLSearchParams()
    if (day) params.set('day', day)
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    if (venueId) params.set('venue_id', venueId)
    const qs = params.toString()
    return req('GET', `/results/events/${eventId}/analytics/attendance${qs ? `?${qs}` : ''}`)
  },
  resultsProgram: (eventId, day) => req('GET', `/results/events/${eventId}/analytics/program${day ? `?day=${day}` : ''}`),
  resultsExperience: (eventId) => req('GET', `/results/events/${eventId}/analytics/experience`),
  resultsMeals: (eventId) => req('GET', `/results/events/${eventId}/analytics/meals`),
  resultsInvitations: (eventId) => req('GET', `/results/events/${eventId}/analytics/invitations`),
  resultsBroadcasts: (eventId) => req('GET', `/results/events/${eventId}/analytics/broadcasts`),
  resultsOperations: (eventId) => req('GET', `/results/events/${eventId}/analytics/operations`),
  resultsAlertGuests: (eventId, alertId) => req('GET', `/results/events/${eventId}/alerts/${encodeURIComponent(alertId)}/guests`),
  resultsExperienceStepGuests: (eventId, stepId) => req('GET', `/results/events/${eventId}/analytics/experience/steps/${encodeURIComponent(stepId)}/guests`),

  // Users
  listUsers: () => req('GET', '/auth/users'),
  updateUserRole: (userId, role) => req('PUT', `/auth/users/${userId}/role?role=${role}`),

  // Organization team (members of an event's org)
  listOrgMembers: (eventId) => req('GET', `/events/${eventId}/org-members`),
  inviteOrgMember: (eventId, body) => req('POST', `/events/${eventId}/org-members`, body),
  setOrgMemberRole: (eventId, userId, role) => req('PUT', `/events/${eventId}/org-members/${userId}`, { role }),

  // ── Invite page settings (admin) ──────────────────────────────────────────
  updateInviteSettings: (eventId, data) => req('PUT', `/events/${eventId}/invite-settings`, data),
  generateRSVPLink: (eventId, regenerate = false) => req('POST', `/events/${eventId}/rsvp-link`, { regenerate }),
  // RSVP questions CRUD (admin)
  listRSVPQuestions: (eventId) => req('GET', `/events/${eventId}/rsvp-questions`),
  createRSVPQuestion: (eventId, data) => req('POST', `/events/${eventId}/rsvp-questions`, data),
  updateRSVPQuestion: (eventId, qId, data) => req('PUT', `/events/${eventId}/rsvp-questions/${qId}`, data),
  deleteRSVPQuestion: (eventId, qId) => req('DELETE', `/events/${eventId}/rsvp-questions/${qId}`),
  // Broadcast (admin)
  broadcast: (eventId, data) => req('POST', `/events/${eventId}/broadcast`, data),
  testSendPostEventThankyou: (eventId, guestId) => req('POST', `/events/${eventId}/post-event-thankyou/test-send`, { guest_id: guestId }),
  sendNowPostEventThankyou: (eventId, force = false) => req('POST', `/events/${eventId}/post-event-thankyou/send-now`, { force }),

  // Guest Hub / event communication (messaging-service)
  guestHub: (eventId, token) =>
    fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/guest-hub?token=${encodeURIComponent(token)}`).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Event updates are temporarily unavailable.'))),
    ),
  sendGuestDirectMessage: (eventId, token, body) =>
    fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/messages/direct?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Message could not be sent.'))))),
  sendGuestChatMessage: (eventId, token, body) =>
    fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/messages/chat?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Chat message could not be sent.'))))),
  guestPushConfig: (eventId, token) =>
    fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/push/config?token=${encodeURIComponent(token)}`).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Push notifications are unavailable.'))),
    ),
  saveGuestPushSubscription: (eventId, token, subscription) =>
    fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/push-subscription?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Push notifications could not be enabled.'))))),
  removeGuestPushSubscription: (eventId, token, endpoint) =>
    fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/push-subscription?token=${encodeURIComponent(token)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Push notifications could not be removed.'))))),

  // FCM (native mobile push) token lifecycle — actor-agnostic on the backend
  // (guest or staff). Pass guestToken for the Guest Hub context; omit it for
  // a logged-in staff session, which attaches the Firebase bearer via req().
  registerFcmToken: (eventId, { token, platform, previousToken, deviceMetadata } = {}, guestToken) => {
    const body = { token, platform, previous_token: previousToken || undefined, device_metadata: deviceMetadata || undefined }
    if (guestToken) {
      return fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/push/fcm-token?token=${encodeURIComponent(guestToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Push token could not be registered.')))))
    }
    return req('POST', `/messaging/events/${encodeURIComponent(eventId)}/push/fcm-token`, body)
  },
  unregisterFcmToken: (eventId, token, guestToken) => {
    if (guestToken) {
      return fetch(`${BASE}/messaging/events/${encodeURIComponent(eventId)}/push/fcm-token?token=${encodeURIComponent(guestToken)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Push token could not be removed.')))))
    }
    return req('DELETE', `/messaging/events/${encodeURIComponent(eventId)}/push/fcm-token`, { token })
  },

  // Guest-facing Experience journey (token auth, backend). Returns
  // { experience_enabled, steps, next_steps, consent, ... }.
  guestExperience: (eventId, token) =>
    fetch(`${BASE}/events/${encodeURIComponent(eventId)}/experience/me?token=${encodeURIComponent(token)}`).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Your journey is temporarily unavailable.'))),
    ),
  signGuestConsent: (eventId, token, { signer_name, signature_text }) =>
    fetch(`${BASE}/events/${encodeURIComponent(eventId)}/experience/me/consent/sign?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signer_name, signature_text }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Consent could not be recorded.'))))),
  guestFeedback: (eventId, token) =>
    fetch(`${BASE}/events/${encodeURIComponent(eventId)}/experience/me/feedback?token=${encodeURIComponent(token)}`).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Feedback is temporarily unavailable.'))),
    ),
  // Self-reports a blocking step as done (e.g. "I signed the waiver") — does
  // NOT admit the guest; staff still confirms it at check-in. See
  // guest_marks_step_done in routers/experience.py.
  markGuestStepDone: (eventId, token, stepId) =>
    fetch(`${BASE}/events/${encodeURIComponent(eventId)}/experience/me/steps/${encodeURIComponent(stepId)}/mark-done?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Could not be recorded.'))))),
  submitGuestFeedback: (eventId, token, data) =>
    fetch(`${BASE}/events/${encodeURIComponent(eventId)}/experience/me/feedback?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail || 'Feedback could not be submitted.')))),
  messagingSettings: (eventId) => req('GET', `/messaging/admin/events/${eventId}/messaging/settings`),
  updateMessagingSettings: (eventId, data) => req('PATCH', `/messaging/admin/events/${eventId}/messaging/settings`, data),
  listAnnouncements: (eventId) => req('GET', `/messaging/admin/events/${eventId}/announcements`),
  createAnnouncement: (eventId, data) => req('POST', `/messaging/admin/events/${eventId}/announcements`, data),
  updateAnnouncement: (eventId, announcementId, data) => req('PATCH', `/messaging/admin/events/${eventId}/announcements/${announcementId}`, data),
  messageInbox: (eventId) => req('GET', `/messaging/admin/events/${eventId}/messages/inbox`),
  messageThread: (eventId, threadId) => req('GET', `/messaging/admin/events/${eventId}/messages/inbox/${threadId}`),
  replyMessageThread: (eventId, threadId, body) => req('POST', `/messaging/admin/events/${eventId}/messages/inbox/${threadId}/reply`, { body }),
  guestChatMessages: (eventId) => req('GET', `/messaging/admin/events/${eventId}/messages/chat`),
  moderateGuestChatMessage: (eventId, messageId, status) => req('PATCH', `/messaging/admin/events/${eventId}/messages/chat/${messageId}`, { status }),

  // Organizer support widget (Chatwoot identity)
  supportIdentify: () => req('GET', '/support/identify'),

  // Message templates (admin)
  listTemplates: (eventId) => req('GET', `/events/${eventId}/templates`),
  getTemplate: (eventId, key) => req('GET', `/events/${eventId}/templates/${key}`),
  saveTemplate: (eventId, key, data) => req('PUT', `/events/${eventId}/templates/${key}`, data),
  resetTemplate: (eventId, key) => req('DELETE', `/events/${eventId}/templates/${key}`),
  previewTemplate: (eventId, key, data) => req('POST', `/events/${eventId}/templates/${key}/preview`, data),
  testSendTemplate: (eventId, key, data) => req('POST', `/events/${eventId}/templates/${key}/test-send`, data),
  templateAudit: (eventId) => req('GET', `/events/${eventId}/templates/audit`),

  // Logistics / Fulfillment (admin)
  listShipments: (eventId) => req('GET', `/events/${eventId}/shipments`),
  createShipment: (eventId, data) => req('POST', `/events/${eventId}/shipments`, data),
  updateShipment: (eventId, sid, data) => req('PUT', `/events/${eventId}/shipments/${sid}`, data),
  deleteShipment: (eventId, sid) => req('DELETE', `/events/${eventId}/shipments/${sid}`),
  populateShipment: (eventId, sid) => req('POST', `/events/${eventId}/shipments/${sid}/populate`),
  listShipmentLines: (eventId, sid) => req('GET', `/events/${eventId}/shipments/${sid}/lines`),
  addShipmentGuest: (eventId, sid, gid, data = {}) => req('POST', `/events/${eventId}/shipments/${sid}/lines/${gid}`, data),
  removeShipmentGuest: (eventId, sid, gid) => req('DELETE', `/events/${eventId}/shipments/${sid}/lines/${gid}`),
  updateShipmentLine: (eventId, sid, gid, data) => req('PUT', `/events/${eventId}/shipments/${sid}/lines/${gid}`, data),
  updateGuestShipping: (eventId, gid, data) => req('PUT', `/events/${eventId}/guests/${gid}/shipping`, data),
  sendShipmentToVendor: (eventId, sid) => req('POST', `/events/${eventId}/shipments/${sid}/send-to-vendor`),
  downloadShipmentXlsx: (eventId, sid, filename = 'shipping-list.xlsx') => downloadFile(`/events/${eventId}/shipments/${sid}/export.xlsx`, filename),
  // Public vendor page (no auth)
  getVendorPage: (token) => req('GET', `/vendor/${token}`),
  downloadVendorXlsx: (token, filename = 'shipping-list.xlsx') => downloadFile(`/vendor/${token}/export.xlsx`, filename, { withAuth: false }),

  // Gift Registry (admin)
  listRegistryItems: (eventId) => req('GET', `/events/${eventId}/registry/items`),
  createRegistryItem: (eventId, data) => req('POST', `/events/${eventId}/registry/items`, data),
  updateRegistryItem: (eventId, id, data) => req('PUT', `/events/${eventId}/registry/items/${id}`, data),
  deleteRegistryItem: (eventId, id) => req('DELETE', `/events/${eventId}/registry/items/${id}`),
  unfurlRegistryLink: (eventId, url) => req('POST', `/events/${eventId}/registry/unfurl`, { url }),
  getRegistrySettings: (eventId) => req('GET', `/events/${eventId}/registry/settings`),
  updateRegistrySettings: (eventId, data) => req('PUT', `/events/${eventId}/registry/settings`, data),
  sendRegistryMessage: (eventId, channels = ['email', 'sms', 'whatsapp']) => req('POST', `/events/${eventId}/registry/send-message`, { channels }),
  listRegistryClaims: (eventId) => req('GET', `/events/${eventId}/registry/claims`),
  // Venue Access Intelligence (admin)
  listZones: (eventId) => req('GET', `/events/${eventId}/zones`),
  createZone: (eventId, data) => req('POST', `/events/${eventId}/zones`, data),
  updateZone: (eventId, id, data) => req('PUT', `/events/${eventId}/zones/${id}`, data),
  deleteZone: (eventId, id) => req('DELETE', `/events/${eventId}/zones/${id}`),
  listTicketTypes: (eventId) => req('GET', `/events/${eventId}/ticket-types`),
  createTicketType: (eventId, data) => req('POST', `/events/${eventId}/ticket-types`, data),
  updateTicketType: (eventId, id, data) => req('PUT', `/events/${eventId}/ticket-types/${id}`, data),
  deleteTicketType: (eventId, id) => req('DELETE', `/events/${eventId}/ticket-types/${id}`),
  assignTicketType: (eventId, gid, ticketTypeId) =>
    req('PUT', `/events/${eventId}/guests/${gid}/ticket-type`, {
      ticket_type_id: ticketTypeId,
    }),
  accessOccupancy: (eventId) => req('GET', `/events/${eventId}/access/occupancy`),
  accessPeak: (eventId, bucket = 15) => req('GET', `/events/${eventId}/access/peak?bucket_minutes=${bucket}`),
  accessFlow: (eventId) => req('GET', `/events/${eventId}/access/flow`),
  guestJourney: (eventId, gid) => req('GET', `/events/${eventId}/guests/${gid}/journey`),
  scanZone: (qrToken, body) => req('POST', `/scan/${qrToken}/zone`, body),

  // Tag-based zone access (classify module)
  listTags: (eventId) => req('GET', `/events/${eventId}/tags`),
  createTag: (eventId, data) => req('POST', `/events/${eventId}/tags`, data),
  updateTag: (eventId, id, data) => req('PUT', `/events/${eventId}/tags/${id}`, data),
  deleteTag: (eventId, id) => req('DELETE', `/events/${eventId}/tags/${id}`),
  getGuestTags: (eventId, gid) => req('GET', `/events/${eventId}/guests/${gid}/tags`),
  setGuestTags: (eventId, gid, tagIds) => req('PUT', `/events/${eventId}/guests/${gid}/tags`, { tag_ids: tagIds }),
  syncRsvpTags: (eventId) => req('POST', `/events/${eventId}/tags/sync`),
  getZoneTags: (eventId, zid) => req('GET', `/events/${eventId}/zones/${zid}/tags`),
  setZoneTags: (eventId, zid, tagIds) => req('PUT', `/events/${eventId}/zones/${zid}/tags`, { tag_ids: tagIds }),
  listGates: (eventId) => req('GET', `/events/${eventId}/gates`),
  createGate: (eventId, data) => req('POST', `/events/${eventId}/gates`, data),
  updateGate: (eventId, id, data) => req('PUT', `/events/${eventId}/gates/${id}`, data),
  deleteGate: (eventId, id) => req('DELETE', `/events/${eventId}/gates/${id}`),
  scanGate: (eventId, gateId, qrToken) =>
    req('POST', `/events/${eventId}/gates/${gateId}/scan`, {
      qr_token: qrToken,
    }),

  // Public registry (no auth) — resolved by unguessable token
  getRegistryPage: (token) => req('GET', `/registry/${token}`),
  claimRegistryItem: (token, itemId, data) => req('POST', `/registry/${token}/items/${itemId}/claim`, data),

  // Speaker Showcase (admin)
  listSpeakers: (eventId) => req('GET', `/events/${eventId}/speakers`),
  createSpeaker: (eventId, data) => req('POST', `/events/${eventId}/speakers`, data),
  updateSpeaker: (eventId, id, data) => req('PUT', `/events/${eventId}/speakers/${id}`, data),
  deleteSpeaker: (eventId, id) => req('DELETE', `/events/${eventId}/speakers/${id}`),
  getSpeakerSettings: (eventId) => req('GET', `/events/${eventId}/speakers/settings`),

  // Public speaker page (no auth) — resolved by unguessable token
  getSpeakerPage: (token) => req('GET', `/speakers/${token}`),
  uploadSpeakerPhoto: async (eventId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/events/${eventId}/speakers/upload-photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },

  // Partner Showcase (admin)
  listPartners: (eventId) => req('GET', `/events/${eventId}/partners`),
  createPartner: (eventId, data) => req('POST', `/events/${eventId}/partners`, data),
  updatePartner: (eventId, id, data) => req('PUT', `/events/${eventId}/partners/${id}`, data),
  deletePartner: (eventId, id) => req('DELETE', `/events/${eventId}/partners/${id}`),
  getPartnerSettings: (eventId) => req('GET', `/events/${eventId}/partners/settings`),
  listPartnerCategories: (eventId) => req('GET', `/events/${eventId}/partner-categories`),
  createPartnerCategory: (eventId, data) => req('POST', `/events/${eventId}/partner-categories`, data),
  updatePartnerCategory: (eventId, id, data) => req('PUT', `/events/${eventId}/partner-categories/${id}`, data),
  deletePartnerCategory: (eventId, id) => req('DELETE', `/events/${eventId}/partner-categories/${id}`),

  // Public partner page (no auth) — resolved by unguessable token
  getPartnerPage: (token) => req('GET', `/partners/${token}`),
  uploadPartnerLogo: async (eventId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/events/${eventId}/partners/upload-logo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },

  // Automated Reminders (admin) — no public page, outbound-only automation
  listReminders: (eventId) => req('GET', `/events/${eventId}/reminders`),
  createReminder: (eventId, data) => req('POST', `/events/${eventId}/reminders`, data),
  updateReminder: (eventId, id, data) => req('PUT', `/events/${eventId}/reminders/${id}`, data),
  deleteReminder: (eventId, id) => req('DELETE', `/events/${eventId}/reminders/${id}`),
  previewReminder: (eventId, id, data) => req('POST', `/events/${eventId}/reminders/${id}/preview`, data),
  testSendReminder: (eventId, id, data) => req('POST', `/events/${eventId}/reminders/${id}/test-send`, data),

  // Unified Guest Communication scheduler
  listScheduledCommunications: (eventId) => req('GET', `/events/${eventId}/communications/scheduled`),
  createScheduledCommunication: (eventId, data) => req('POST', `/events/${eventId}/communications/scheduled`, data),
  updateScheduledCommunication: (eventId, id, data) => req('PUT', `/events/${eventId}/communications/scheduled/${id}`, data),
  pauseScheduledCommunication: (eventId, id) => req('POST', `/events/${eventId}/communications/scheduled/${id}/pause`),
  resumeScheduledCommunication: (eventId, id) => req('POST', `/events/${eventId}/communications/scheduled/${id}/resume`),
  sendScheduledCommunicationNow: (eventId, id) => req('POST', `/events/${eventId}/communications/scheduled/${id}/send-now`),
  cancelScheduledCommunication: (eventId, id) => req('POST', `/events/${eventId}/communications/scheduled/${id}/cancel`),
  retryScheduledCommunication: (eventId, id) => req('POST', `/events/${eventId}/communications/scheduled/${id}/retry`),
  scheduledCommunicationDeliveries: (eventId, id) => req('GET', `/events/${eventId}/communications/scheduled/${id}/deliveries`),

  // Billing (Event Pass)
  getBillingTiers: (eventId) => req('GET', `/billing/tiers/${eventId}`),
  getCreditLedger: (eventId) => req('GET', `/billing/credits/${eventId}`),
  getEventPass: (eventId) => req('GET', `/billing/event-pass/${eventId}`),
  checkout: (eventId, tier) => req('POST', '/billing/checkout', { event_id: eventId, tier }),
  setBillingCurrency: (eventId, currency) => req('POST', '/billing/currency', { event_id: eventId, currency }),
  // Public marketing pricing. Auth is optional: signed in with a paid event
  // reveals add-on prices (req() attaches a token automatically when signed
  // in, and the endpoint never requires one -- see get_current_user_optional).
  getPricing: (currency = 'USD') => req('GET', `/billing/pricing?currency=${currency}`),

  // Trial-credit requests (customer)
  submitTrialRequest: (body) => req('POST', '/trial-requests', body),
  myTrialRequests: () => req('GET', '/trial-requests/mine'),

  // Superadmin console
  adminOverview: () => req('GET', '/admin/overview'),
  adminAccountsSummary: () => req('GET', '/admin/accounts/summary'),
  adminUsageReport: () => req('GET', '/admin/usage-report'),
  adminListTrials: () => req('GET', '/admin/trial-requests'),
  adminResolveTrial: (id, body) => req('POST', `/admin/trial-requests/${id}/resolve`, body),
  // QA checklist submissions (from public/media/festio-qa-checklist.html)
  qaChecklistSubmissions: () => req('GET', '/qa-checklist/submissions'),
  qaChecklistSubmission: (id) => req('GET', `/qa-checklist/submissions/${id}`),
  // Platform-wide operational toggles (operator Console)
  platformSettings: () => req('GET', '/platform-settings'),
  updatePlatformSettings: (data) => req('PATCH', '/platform-settings', data),
  // Partner referral program
  myReferral: () => req('GET', '/organizations/me/referral'),
  claimReferral: (code) => req('POST', '/organizations/me/referral/claim', { code }),
  adminAllReferrals: () => req('GET', '/organizations/referrals/all'),
  // Account management
  adminListAccounts: () => req('GET', '/admin/accounts'),
  adminSetOrgActive: (orgId, active) => req('PATCH', `/admin/orgs/${orgId}/active`, { active }),
  adminSetOrgRedesignCohort: (orgId, redesign_cohort) => req('PATCH', `/admin/orgs/${orgId}/redesign-cohort`, { redesign_cohort }),
  adminGetOrgEventPass: (orgId) => req('GET', `/admin/orgs/${orgId}/event-pass`),
  adminUpdateOrgEventPass: (orgId, body) => req('PATCH', `/admin/orgs/${orgId}/event-pass`, body),
  adminDeleteOrg: (orgId) => req('DELETE', `/admin/orgs/${orgId}`),
  adminSetMemberRole: (orgId, userId, role) => req('PATCH', `/admin/orgs/${orgId}/members/${userId}`, { role }),
  adminRemoveMember: (orgId, userId) => req('DELETE', `/admin/orgs/${orgId}/members/${userId}`),
  adminSetUserActive: (userId, active) => req('PATCH', `/admin/users/${userId}/active`, { active }),
  adminDeleteUser: (userId) => req('DELETE', `/admin/users/${userId}`),
  adminGrant: (eventId, body) => req('POST', `/admin/events/${eventId}/grant`, body),
  adminEventControls: (eventId) => req('GET', `/admin/events/${eventId}/controls`),
  adminSetEventControls: (eventId, body) => req('POST', `/admin/events/${eventId}/controls`, body),
  adminAddonPolicy: () => req('GET', '/admin/addons/policy'),
  adminSetAddonPolicy: (overrides) => req('PUT', '/admin/addons/policy', { overrides }),
  adminOrgAddonOverrides: (orgId) => req('GET', `/admin/orgs/${orgId}/addon-overrides`),
  adminSetOrgAddonOverrides: (orgId, overrides) => req('PUT', `/admin/orgs/${orgId}/addon-overrides`, { overrides }),
  adminEventAddonOverrides: (eventId) => req('GET', `/admin/events/${eventId}/addon-overrides`),
  adminSetEventAddonOverrides: (eventId, overrides) => req('PUT', `/admin/events/${eventId}/addon-overrides`, { overrides }),
  adminPreviewReadinessReport: async (eventId) => {
    const token = await getToken()
    const res = await fetch(`${BASE}/admin/events/${eventId}/readiness-report`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not generate report')
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  },
  adminSendReadinessReport: (eventId, email) => req('POST', `/admin/events/${eventId}/readiness-report/send`, email ? { email } : {}),
  adminResetEvent: (eventId, body) => req('POST', `/admin/events/${eventId}/reset`, body),
  adminListOperators: () => req('GET', '/admin/operators'),
  adminAddOperator: (email) => req('POST', '/admin/operators', { email }),
  adminRemoveOperator: (userId) => req('DELETE', `/admin/operators/${userId}`),
  adminListPlans: () => req('GET', '/admin/plans'),
  adminSavePlan: (key, body) => req('PUT', `/admin/plans/${key}`, body),
  adminDeletePlan: (key) => req('DELETE', `/admin/plans/${key}`),
  adminListGlobalCreditRates: () => req('GET', '/admin/credit-rates/global'),
  adminSaveGlobalCreditRate: (channel, credits_per_unit) => req('PUT', `/admin/credit-rates/global/${channel}`, { credits_per_unit }),
  adminListOrgCreditRates: (orgId) => req('GET', `/admin/credit-rates/org/${orgId}`),
  adminSaveOrgCreditRate: (orgId, channel, credits_per_unit) => req('PUT', `/admin/credit-rates/org/${orgId}/${channel}`, { credits_per_unit }),
  adminDeleteOrgCreditRate: (orgId, channel) => req('DELETE', `/admin/credit-rates/org/${orgId}/${channel}`),
  adminListAffiliateStores: () => req('GET', '/admin/affiliate-stores'),
  adminCreateAffiliateStore: (body) => req('POST', '/admin/affiliate-stores', body),
  adminUpdateAffiliateStore: (id, body) => req('PUT', `/admin/affiliate-stores/${id}`, body),
  adminDeleteAffiliateStore: (id) => req('DELETE', `/admin/affiliate-stores/${id}`),
  // Manual invites (admin)
  sendManualInvites: (eventId, data) => req('POST', `/events/${eventId}/send-invites`, data),
  // Cover image (admin)
  uploadCoverImage: async (eventId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/events/${eventId}/upload-cover`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },
  deleteCoverImage: (eventId) => req('DELETE', `/events/${eventId}/upload-cover`),
  uploadLogo: async (eventId, file) => {
    const token = await getToken()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/events/${eventId}/upload-logo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },
  deleteLogo: (eventId) => req('DELETE', `/events/${eventId}/upload-logo`),
  // Invite page public URL helper (no auth needed)
  inviteUrl: (eventOrId) => {
    if (eventOrId && typeof eventOrId === 'object') {
      const base = publicBaseUrl(eventOrId)
      return eventOrId.rsvp_token ? `${base}/rsvp/${eventOrId.rsvp_token}` : `${base}/invite/${eventOrId.id}`
    }
    return `${PUBLIC_BASE_URL}/invite/${eventOrId}`
  },

  // FestioMe — isolated internal service, presented as one Festio feature.
  startFestioMeGuestSession,
  festiomeGuestContext: () => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('festiomeGuestSession') || 'null')
      return stored?.kind === 'guest' && stored?.eventId && stored?.passToken
        ? { eventId: stored.eventId, passToken: stored.passToken }
        : null
    } catch {
      return null
    }
  },
  festiomeSpaces: () => festiomeReq('GET', '/festiome/v1/groups'),
  festiomeSpace: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}`),
  festiomeCreateSpace: (data) => festiomeReq('POST', '/festiome/v1/groups', data),
  festiomeUpdateSpace: (id, data) => festiomeReq('PATCH', `/festiome/v1/groups/${id}`, data),
  festiomeArchiveSpace: (id) => festiomeReq('PATCH', `/festiome/v1/groups/${id}`, { archived: true }),
  festiomeLeaveSpace: (id) => festiomeReq('POST', `/festiome/v1/groups/${id}/leave`),
  festiomeChannels: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}/channels`),
  festiomeCreateChannel: (id, data) =>
    festiomeReq('POST', `/festiome/v1/groups/${id}/channels`, {
      kind: 'discussion',
      ...data,
    }),
  festiomeMembers: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}/members`),
  festiomeChannelMembers: (channelId) => festiomeReq('GET', `/festiome/v1/channels/${channelId}/members`),
  festiomeAddChannelMembers: (channelId, memberIds) =>
    festiomeReq('POST', `/festiome/v1/channels/${channelId}/members`, { member_ids: memberIds }),
  festiomeRemoveChannelMember: (channelId, memberId) =>
    festiomeReq('DELETE', `/festiome/v1/channels/${channelId}/members/${memberId}`),
  festiomeOpenDirectMessage: (groupId, memberId) =>
    festiomeReq('POST', `/festiome/v1/groups/${groupId}/dms`, { member_id: memberId }),
  festiomeUpdateMember: (id, memberId, data) => festiomeReq('PATCH', `/festiome/v1/groups/${id}/members/${memberId}`, data),
  festiomeRemoveMember: (id, memberId) => festiomeReq('DELETE', `/festiome/v1/groups/${id}/members/${memberId}`),
  festiomeTransferOwner: (id, memberId) =>
    festiomeReq('POST', `/festiome/v1/groups/${id}/transfer-ownership`, {
      member_id: memberId,
    }),
  festiomeMessages: (id, cursor) => festiomeReq('GET', `/festiome/v1/channels/${id}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  festiomeSend: (id, body) => festiomeReq('POST', `/festiome/v1/channels/${id}/messages`, body),
  festiomeEditMessage: (id, body) => festiomeReq('PATCH', `/festiome/v1/messages/${id}`, body),
  festiomeDeleteMessage: (id) => festiomeReq('DELETE', `/festiome/v1/messages/${id}`),
  festiomeReportMessage: (id, data) => festiomeReq('POST', `/festiome/v1/messages/${id}/reports`, data),
  festiomeSearch: (id, query) => festiomeReq('GET', `/festiome/v1/groups/${id}/search?q=${encodeURIComponent(query)}`),
  festiomeSearchAllGroups: (query) => festiomeReq('GET', `/festiome/v1/members/me/search?q=${encodeURIComponent(query)}`),
  festiomeLeaderboard: (groupId) => festiomeReq('GET', `/festiome/v1/groups/${groupId}/leaderboard`),
  festiomeMatches: (groupId) => festiomeReq('GET', `/festiome/v1/groups/${groupId}/matches`),
  festiomeTyping: (channelId) => festiomeReq('POST', `/festiome/v1/channels/${channelId}/typing`),
  festiomeCreatePoll: (id, data) => festiomeReq('POST', `/festiome/v1/channels/${id}/polls`, data),
  festiomeUpload,
  festiomeDownloadAttachment,
  festiomeVotePoll: (id, optionId) =>
    festiomeReq('POST', `/festiome/v1/polls/${id}/votes`, {
      option_ids: [optionId],
    }),
  festiomeRealtimeTicket: (id) => festiomeReq('POST', '/festiome/v1/realtime-ticket', { channel_id: id }),
  festiomeReact: (messageId, emoji) =>
    festiomeReq('POST', `/festiome/v1/messages/${messageId}/reactions`, { emoji }),
  festiomeUnreact: (messageId, emoji) =>
    festiomeReq('DELETE', `/festiome/v1/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
  festiomeRead: (id, messageId) =>
    festiomeReq('PUT', `/festiome/v1/channels/${id}/read`, {
      message_id: messageId,
    }),
  festiomeInvite: (id, data) => festiomeReq('POST', `/festiome/v1/groups/${id}/invitations`, data),
  festiomeInvites: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}/invitations`),
  festiomeReports: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}/reports`),
  festiomeUpdateReport: (groupId, id, data) => festiomeReq('PATCH', `/festiome/v1/groups/${groupId}/reports/${id}`, data),
  festiomeNotificationPreferences: (groupId) => festiomeReq('GET', `/festiome/v1/notification-preferences?group_id=${encodeURIComponent(groupId)}`),
  festiomeUpdateProfile: (groupId, data) => festiomeReq('PATCH', `/festiome/v1/profile?group_id=${encodeURIComponent(groupId)}`, data),
  festiomeSaveNotificationPreferences: (groupId, data) =>
    festiomeReq('PUT', `/festiome/v1/notification-preferences?group_id=${encodeURIComponent(groupId)}`, data),
  acceptFestioMeInvite: (token) => festiomeReq('POST', `/festiome/v1/invitations/${encodeURIComponent(token)}/accept`),
  // Member/guest self-service (direct FestioMe proxy, scoped by the caller's session).
  festiomeEventGroups: (eventRef) => festiomeReq('GET', `/festiome/v1/events/${encodeURIComponent(eventRef)}/groups`),
  festiomeJoinGroup: (groupId, data) => festiomeReq('POST', `/festiome/v1/groups/${groupId}/join`, data || {}),
  festiomeAcceptRules: (groupId) => festiomeReq('POST', `/festiome/v1/groups/${groupId}/accept-rules`),
  festiomeCreateSubgroup: (eventRef, data) => festiomeReq('POST', `/festiome/v1/events/${encodeURIComponent(eventRef)}/subgroups`, data),
  festiomeGroupJoinRequests: (groupId, status = 'pending') =>
    festiomeReq('GET', `/festiome/v1/groups/${groupId}/join-requests?status=${encodeURIComponent(status)}`),
  festiomeApproveJoinRequest: (groupId, requestId, data) =>
    festiomeReq('POST', `/festiome/v1/groups/${groupId}/join-requests/${requestId}/approve`, data || {}),
  festiomeDenyJoinRequest: (groupId, requestId) =>
    festiomeReq('POST', `/festiome/v1/groups/${groupId}/join-requests/${requestId}/deny`),
  eventFestioMeStatus: (eventId) => req('GET', `/events/${eventId}/festiome/status`),
  enableEventFestioMe: (eventId) => req('POST', `/events/${eventId}/festiome/enable`),
  // Organizer group management (gated GuestHub endpoints, service-authed to FestioMe).
  festiomeManageGroups: (eventId) => req('GET', `/events/${eventId}/festiome/groups`),
  festiomeManageCreateGroup: (eventId, data) => req('POST', `/events/${eventId}/festiome/groups`, data),
  festiomeManageUpdateGroup: (eventId, groupId, data) => req('PATCH', `/events/${eventId}/festiome/groups/${groupId}`, data),
  festiomeManageJoinRequests: (eventId, groupId, status = 'pending') =>
    req('GET', `/events/${eventId}/festiome/groups/${groupId}/join-requests?status=${encodeURIComponent(status)}`),
  festiomeManageApproveJoin: (eventId, groupId, requestId, data) =>
    req('POST', `/events/${eventId}/festiome/groups/${groupId}/join-requests/${requestId}/approve`, data || {}),
  festiomeManageDenyJoin: (eventId, groupId, requestId) =>
    req('POST', `/events/${eventId}/festiome/groups/${groupId}/join-requests/${requestId}/deny`),

  // Planner (planner-service — event budget, vendors, timeline, runsheet, documents).
  plannerDashboard: (eventId) => plannerReq(eventId, 'GET', '/dashboard'),
  plannerGetBudget: (eventId) => plannerReq(eventId, 'GET', '/budget'),
  plannerSaveBudget: (eventId, body) => plannerReq(eventId, 'POST', '/budget', body),
  plannerAddCategory: (eventId, body) => plannerReq(eventId, 'POST', '/budget/categories', body),
  plannerUpdateCategory: (eventId, catId, body) => plannerReq(eventId, 'PATCH', `/budget/categories/${catId}`, body),
  plannerDeleteCategory: (eventId, catId) => plannerReq(eventId, 'DELETE', `/budget/categories/${catId}`),
  plannerAddBudgetItem: (eventId, categoryId, body) => plannerReq(eventId, 'POST', `/budget/items?category_id=${categoryId}`, body),
  plannerUpdateBudgetItem: (eventId, itemId, body) => plannerReq(eventId, 'PATCH', `/budget/items/${itemId}`, body),
  plannerDeleteBudgetItem: (eventId, itemId) => plannerReq(eventId, 'DELETE', `/budget/items/${itemId}`),
  plannerListVendors: (eventId) => plannerReq(eventId, 'GET', '/vendors'),
  plannerCreateVendor: (eventId, body) => plannerReq(eventId, 'POST', '/vendors', body),
  plannerGetVendor: (eventId, vendorId) => plannerReq(eventId, 'GET', `/vendors/${vendorId}`),
  plannerUpdateVendor: (eventId, vendorId, body) => plannerReq(eventId, 'PATCH', `/vendors/${vendorId}`, body),
  plannerDeleteVendor: (eventId, vendorId) => plannerReq(eventId, 'DELETE', `/vendors/${vendorId}`),
  plannerAddVendorPayment: (eventId, vendorId, body) => plannerReq(eventId, 'POST', `/vendors/${vendorId}/payments`, body),
  plannerUpdateVendorPayment: (eventId, vendorId, payId, body) => plannerReq(eventId, 'PATCH', `/vendors/${vendorId}/payments/${payId}`, body),
  plannerProcurement: (eventId) => plannerReq(eventId, 'GET', '/procurement'),
  plannerSelectQuoteItem: (eventId, body) => plannerReq(eventId, 'PUT', '/procurement/selections', body),
  plannerClearQuoteItemSelection: (eventId, selectionId) => plannerReq(eventId, 'DELETE', `/procurement/selections/${selectionId}`),
  plannerSetProcurementRequirement: (eventId, body) => plannerReq(eventId, 'PUT', '/procurement/requirements', body),
  plannerCreateQuote: (eventId, vendorId, body) => plannerReq(eventId, 'POST', `/vendors/${vendorId}/quotes`, body),
  plannerUpdateQuote: (eventId, quoteId, body) => plannerReq(eventId, 'PATCH', `/quotes/${quoteId}`, body),
  plannerDecideQuote: (eventId, quoteId, decision) => plannerReq(eventId, 'POST', `/quotes/${quoteId}/decision`, { decision }),
  plannerCreateChangeOrder: (eventId, vendorId, body) => plannerReq(eventId, 'POST', `/vendors/${vendorId}/change-orders`, body),
  plannerDecideChangeOrder: (eventId, changeId, decision) => plannerReq(eventId, 'POST', `/change-orders/${changeId}/decision`, { decision }),
  plannerCreateVendorPortalLink: (eventId, vendorId) => plannerReq(eventId, 'POST', `/vendors/${vendorId}/portal-link`),
  plannerVendorPortal: (token) => req('GET', `/planner/vendor-portal/${encodeURIComponent(token)}`),
  plannerVendorSubmitQuote: (token, body) => req('POST', `/planner/vendor-portal/${encodeURIComponent(token)}/quotes`, body),
  plannerVendorRequestChange: (token, body) => req('POST', `/planner/vendor-portal/${encodeURIComponent(token)}/change-orders`, body),
  plannerVendorAcknowledgeChange: (token, changeId) => req('POST', `/planner/vendor-portal/${encodeURIComponent(token)}/change-orders/${changeId}/acknowledge`),
  plannerDownloadDocument: (eventId, path, filename) => plannerDownload(eventId, path, filename),
  // Contracts (e-signature) — admin side
  plannerListContracts: (eventId) => plannerReq(eventId, 'GET', '/contracts'),
  plannerCreateContract: (eventId, vendorId, body) => plannerReq(eventId, 'POST', `/vendors/${vendorId}/contracts`, body),
  plannerUpdateContract: (eventId, contractId, body) => plannerReq(eventId, 'PATCH', `/contracts/${contractId}`, body),
  plannerSendContract: (eventId, contractId) => plannerReq(eventId, 'POST', `/contracts/${contractId}/send`),
  plannerDeleteContract: (eventId, contractId) => plannerReq(eventId, 'DELETE', `/contracts/${contractId}`),
  plannerDownloadContractPdf: (eventId, path, filename) => plannerDownload(eventId, path, filename),
  // Contracts — vendor portal side (no Festio login, token-authed)
  plannerVendorSignContract: (token, contractId, signerName) =>
    req('POST', `/planner/vendor-portal/${encodeURIComponent(token)}/contracts/${contractId}/sign`, { signer_name: signerName }),
  plannerListMilestones: (eventId) => plannerReq(eventId, 'GET', '/milestones'),
  plannerCreateStarterPlan: (eventId, body) => plannerReq(eventId, 'POST', '/starter-plan', body),
  plannerCreateMilestone: (eventId, body) => plannerReq(eventId, 'POST', '/milestones', body),
  plannerUpdateMilestone: (eventId, msId, body) => plannerReq(eventId, 'PATCH', `/milestones/${msId}`, body),
  plannerDeleteMilestone: (eventId, msId) => plannerReq(eventId, 'DELETE', `/milestones/${msId}`),
  plannerCreateTask: (eventId, body) => plannerReq(eventId, 'POST', '/tasks', body),
  plannerUpdateTask: (eventId, taskId, body) => plannerReq(eventId, 'PATCH', `/tasks/${taskId}`, body),
  plannerDeleteTask: (eventId, taskId) => plannerReq(eventId, 'DELETE', `/tasks/${taskId}`),
  plannerListRunsheet: (eventId) => plannerReq(eventId, 'GET', '/runsheet'),
  plannerCreateRunsheetItem: (eventId, body) => plannerReq(eventId, 'POST', '/runsheet', body),
  plannerUpdateRunsheetItem: (eventId, itemId, body) => plannerReq(eventId, 'PATCH', `/runsheet/${itemId}`, body),
  plannerReorderRunsheet: (eventId, items) => plannerReq(eventId, 'PATCH', '/runsheet/reorder', { items }),
  plannerDeleteRunsheetItem: (eventId, itemId) => plannerReq(eventId, 'DELETE', `/runsheet/${itemId}`),
  plannerListDocuments: (eventId) => plannerReq(eventId, 'GET', '/documents'),
  plannerUploadDocument: (eventId, formData) => plannerReq(eventId, 'POST', '/documents/upload', formData, { isForm: true }),
  plannerUpdateDocument: (eventId, docId, body) => plannerReq(eventId, 'PATCH', `/documents/${docId}`, body),
  plannerDeleteDocument: (eventId, docId) => plannerReq(eventId, 'DELETE', `/documents/${docId}`),

  // Festio Live (standalone engagement-service) — staff/admin.
  liveActivities: (eventId) => liveReq(eventId, 'GET', '/v1/activities'),
  liveProgramSessions: (eventId) => liveReq(eventId, 'GET', '/v1/program-sessions'),
  liveCreateActivity: (eventId, body) => liveReq(eventId, 'POST', '/v1/activities', body),
  liveGetActivity: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}`),
  liveUpdateActivity: (eventId, activityId, body) => liveReq(eventId, 'PATCH', `/v1/activities/${activityId}`, body),
  liveDeleteActivity: (eventId, activityId) => liveReq(eventId, 'DELETE', `/v1/activities/${activityId}`),
  liveAddQuestion: (eventId, activityId, body) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/questions`, body),
  liveUpdateQuestion: (eventId, questionId, body) => liveReq(eventId, 'PATCH', `/v1/questions/${questionId}`, body),
  liveDeleteQuestion: (eventId, questionId) => liveReq(eventId, 'DELETE', `/v1/questions/${questionId}`),
  liveQuestionBank: (eventId, category) => liveReq(eventId, 'GET', `/v1/question-bank${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  liveCreateBankItem: (eventId, body) => liveReq(eventId, 'POST', '/v1/question-bank', body),
  liveImportBankItems: (eventId, items) => liveReq(eventId, 'POST', '/v1/question-bank/import', { items }),
  liveUpdateBankItem: (eventId, itemId, body) => liveReq(eventId, 'PATCH', `/v1/question-bank/${itemId}`, body),
  liveDuplicateBankItem: (eventId, itemId) => liveReq(eventId, 'POST', `/v1/question-bank/${itemId}/duplicate`),
  liveDeleteBankItem: (eventId, itemId) => liveReq(eventId, 'DELETE', `/v1/question-bank/${itemId}`),
  liveImportBankItem: (eventId, activityId, itemId) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/questions/import/${itemId}`),
  liveResults: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/results`),
  liveResponseDetails: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/responses`),
  liveLeaderboard: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/leaderboard`),
  liveSetStatus: (eventId, activityId, status) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/status`, { status }),
  liveAdvance: (eventId, activityId, questionId) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/advance`, { question_id: questionId }),
  liveStartGuidedShow: (eventId, activityId) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/show/start`),
  liveAdvanceGuidedShow: (eventId, activityId) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/show/advance`),
  liveConfigureGuidedShowAutomation: (eventId, activityId, body) => liveReq(eventId, 'PUT', `/v1/activities/${activityId}/show/automation`, body),
  liveExtendActivity: (eventId, activityId, minutes) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/extend`, { minutes }),
  liveQuestionState: (eventId, questionId, state) => liveReq(eventId, 'POST', `/v1/questions/${questionId}/live-state`, { state }),
  liveRules: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/rules`),
  liveCreateRule: (eventId, activityId, body) => liveReq(eventId, 'POST', `/v1/activities/${activityId}/rules`, body),
  liveDeleteRule: (eventId, ruleId) => liveReq(eventId, 'DELETE', `/v1/rules/${ruleId}`),
  liveDisplays: (eventId) => liveReq(eventId, 'GET', '/v1/displays'),
  liveCreateDisplay: (eventId, body) => liveReq(eventId, 'POST', '/v1/displays', body),
  liveUpdateDisplay: (eventId, displayId, body) => liveReq(eventId, 'PATCH', `/v1/displays/${displayId}`, body),
  livePresentDisplayResults: (eventId, displayId, body) => liveReq(eventId, 'PUT', `/v1/control/displays/${displayId}/results`, body),
  liveSetDisplayRehearsal: (eventId, displayId, body) => liveReq(eventId, 'PUT', `/v1/control/displays/${displayId}/rehearsal`, body),
  liveRotateDisplayToken: (eventId, displayId) => liveReq(eventId, 'POST', `/v1/displays/${displayId}/rotate-token`),
  liveDeleteDisplay: (eventId, displayId) => liveReq(eventId, 'DELETE', `/v1/displays/${displayId}`),
  liveSettings: (eventId) => liveReq(eventId, 'GET', '/v1/settings'),
  liveUpdateSettings: (eventId, body) => liveReq(eventId, 'PUT', '/v1/settings', body),
  liveDownloadExport: (eventId, activityId, title) => downloadLiveExport(eventId, activityId, title),
  liveDownloadEventReport: (eventId) => downloadLiveEventReport(eventId),
  liveWordCloud: (eventId, questionId) => liveReq(eventId, 'GET', `/v1/questions/${questionId}/word-cloud`),
  liveAiAnalysis: (eventId, questionId) => liveReq(eventId, 'POST', `/v1/questions/${questionId}/ai-analysis`),
  liveAiAnalysisStatus: (eventId, jobId) => liveReq(eventId, 'GET', `/v1/analysis/${jobId}`),
  liveQnaList: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/qna`),
  liveQnaModerate: (eventId, qnaId, status) => liveReq(eventId, 'PATCH', `/v1/qna/${qnaId}`, { status }),
  liveModerationItems: (eventId, activityId, status) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/moderation${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  liveModerationDecision: (eventId, itemId, status) => liveReq(eventId, 'PATCH', `/v1/moderation/${itemId}`, { status }),
  liveShareLink: (eventId, role, hours) => req('POST', `/events/${eventId}/live/share-link`, { role, hours }),
  liveJoinInfo: (eventId) => req('GET', `/events/${encodeURIComponent(eventId)}/live/join-info`),
  liveRealtimeTicket: (eventId, activityId) => liveReq(eventId, 'GET', `/v1/activities/${activityId}/realtime-ticket`),

  // Festio Live — guest participation (no Firebase login; the guest's own
  // pass token is exchanged for a scoped session first).
  liveGuestSession: (eventId, passToken) => getLiveGuestSession(eventId, passToken),
  // Broadcast/QR join — no guest pass needed. anonId is a device-persisted
  // id (see LiveGuestPage's localStorage use) so reopening the page resumes
  // the same participant instead of re-joining as a new one each time.
  liveAnonSession: (eventId, displayName, anonId) => fetch(`${BASE}/events/${encodeURIComponent(eventId)}/live/anon-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName || '', anon_id: anonId || '' }),
    signal: AbortSignal.timeout(10000),
  }).then(async (res) => {
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "This event isn't available right now.") }
    return res.json() // { token, expires_in, anon_id }
  }),
  liveJoinQrUrl: (eventId) => `${BASE}/events/${eventId}/live/join-qr.png`,
  livePublicJoinInfo: (eventId) => fetch(`${BASE}/events/${encodeURIComponent(eventId)}/live/public-join-info`, {
    signal: AbortSignal.timeout(10000),
  }).then(async (res) => {
    if (!res.ok) throw new Error('The Festio Live join code is unavailable.')
    return res.json()
  }),
  liveResolveJoinCode: (joinCode) => fetch(`${BASE}/events/live/join/${encodeURIComponent(joinCode)}`, {
    signal: AbortSignal.timeout(10000),
  }).then(async (res) => {
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || 'That Festio Live code was not found.') }
    return res.json() // { event_id }
  }),
  liveGuestActivities: (guestToken) => liveGuestReq(guestToken, 'GET', '/v1/activities/live'),
  liveGuestProgramParticipation: (guestToken) => liveGuestReq(guestToken, 'GET', '/v1/my-program-participation'),
  liveGuestParticipate: (guestToken, activityId) => liveGuestReq(guestToken, 'GET', `/v1/activities/${activityId}/participate`),
  liveGuestRespond: (guestToken, activityId, body) => liveGuestReq(guestToken, 'POST', `/v1/activities/${activityId}/respond`, body),
  liveGuestComplete: (guestToken, activityId) => liveGuestReq(guestToken, 'POST', `/v1/activities/${activityId}/complete`),
  liveGuestResults: (guestToken, activityId) => liveGuestReq(guestToken, 'GET', `/v1/activities/${activityId}/results`),
  liveGuestLeaderboard: (guestToken, activityId) => liveGuestReq(guestToken, 'GET', `/v1/activities/${activityId}/leaderboard`),
  liveGuestQnaList: (guestToken, activityId) => liveGuestReq(guestToken, 'GET', `/v1/activities/${activityId}/qna`),
  liveGuestQnaSubmit: (guestToken, activityId, text) => liveGuestReq(guestToken, 'POST', `/v1/activities/${activityId}/qna`, { text }),
  liveGuestQnaUpvote: (guestToken, qnaId) => liveGuestReq(guestToken, 'POST', `/v1/qna/${qnaId}/upvote`),
  liveGuestRealtimeTicket: (guestToken, activityId) => liveGuestReq(guestToken, 'GET', `/v1/activities/${activityId}/realtime-ticket`),

  // Festio Live — presenter/moderator share-link console (no Festio login;
  // a capability-scoped token from Settings → Share Links, see auth.js's
  // require_capability). Reuses the same raw-bearer-token request shape as
  // guest calls above -- the token's own embedded role/capabilities are what
  // the server actually enforces, not which of these methods gets called.
  liveControlActivities: (token) => liveGuestReq(token, 'GET', '/v1/activities/live'),
  liveControlActivity: (token, activityId) => liveGuestReq(token, 'GET', `/v1/activities/${activityId}`),
  liveControlSetStatus: (token, activityId, status) => liveGuestReq(token, 'POST', `/v1/activities/${activityId}/status`, { status }),
  liveControlAdvance: (token, activityId, questionId) => liveGuestReq(token, 'POST', `/v1/activities/${activityId}/advance`, { question_id: questionId }),
  liveControlStartGuidedShow: (token, activityId) => liveGuestReq(token, 'POST', `/v1/activities/${activityId}/show/start`),
  liveControlAdvanceGuidedShow: (token, activityId) => liveGuestReq(token, 'POST', `/v1/activities/${activityId}/show/advance`),
  liveControlConfigureGuidedShowAutomation: (token, activityId, body) => liveGuestReq(token, 'PUT', `/v1/activities/${activityId}/show/automation`, body),
  liveControlQuestionState: (token, questionId, state) => liveGuestReq(token, 'POST', `/v1/questions/${questionId}/live-state`, { state }),
  liveControlResults: (token, activityId) => liveGuestReq(token, 'GET', `/v1/activities/${activityId}/results`),
  liveControlDisplays: (token) => liveGuestReq(token, 'GET', '/v1/control/displays'),
  liveControlUpdateDisplay: (token, displayId, body) => liveGuestReq(token, 'PATCH', `/v1/control/displays/${displayId}`, body),
  liveControlPresentResults: (token, displayId, body) => liveGuestReq(token, 'PUT', `/v1/control/displays/${displayId}/results`, body),
  liveControlSetRehearsal: (token, displayId, body) => liveGuestReq(token, 'PUT', `/v1/control/displays/${displayId}/rehearsal`, body),
  liveControlQnaList: (token, activityId) => liveGuestReq(token, 'GET', `/v1/activities/${activityId}/qna`),
  liveControlQnaModerate: (token, qnaId, status) => liveGuestReq(token, 'PATCH', `/v1/qna/${qnaId}`, { status }),

  // Paid admission (standalone staging-only ticketing-service).
  ticketingConfig: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/config`),
  saveTicketingConfig: (eventId, body) => ticketingReq(eventId, 'PUT', `/events/${eventId}/config`, body),
  ticketingPayoutAccounts: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/payout-accounts`),
  ticketingPaystackBanks: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/paystack/banks`),
  createPaystackPayoutAccount: (eventId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/payout-accounts/paystack`, body),
  createStripePayoutAccount: (eventId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/payout-accounts/stripe`, body),
  selectTicketingPayoutAccount: (eventId, accountId) => ticketingReq(eventId, 'POST', `/events/${eventId}/payout-accounts/${accountId}/select`),
  resumeStripePayoutOnboarding: (eventId, accountId) => ticketingReq(eventId, 'POST', `/events/${eventId}/payout-accounts/${accountId}/onboarding-link`),
  setTicketingFeePolicy: (eventId, body) => ticketingReq(eventId, 'PUT', `/events/${eventId}/fee-policy`, body),
  deleteTicketingFeePolicy: (eventId, scope) => ticketingReq(eventId, 'DELETE', `/events/${eventId}/fee-policy/${scope}`),
  ticketingProducts: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/products`),
  createTicketingProduct: (eventId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/products`, body),
  updateTicketingProduct: (eventId, id, body) => ticketingReq(eventId, 'PUT', `/events/${eventId}/products/${id}`, body),
  deleteTicketingProduct: (eventId, id) => ticketingReq(eventId, 'DELETE', `/events/${eventId}/products/${id}`),
  ticketingPromos: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/promos`),
  createTicketingPromo: (eventId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/promos`, body),
  ticketingSales: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/sales`),
  retryTicketFulfillment: (eventId, orderId) => ticketingReq(eventId, 'POST', `/events/${eventId}/orders/${orderId}/fulfill`),
  resendTicketOrder: (eventId, orderId) => ticketingReq(eventId, 'POST', `/events/${eventId}/orders/${orderId}/resend`),
  refundTicketOrder: (eventId, orderId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/orders/${orderId}/refunds`, body),
  createComplimentaryTicketOrder: (eventId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/complimentary-orders`, body),
  ticketingAudit: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/audit`),
  ticketingReconciliation: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/reconciliation`),
  offerWaitlistTicket: (eventId, entryId, body={minutes:30}) => ticketingReq(eventId, 'POST', `/events/${eventId}/waitlist/${entryId}/offer`, body),
  runTicketingOperations: (eventId) => ticketingReq(eventId, 'POST', `/events/${eventId}/operations/run`, {}),
  emailTicketSalesReport: (eventId, recipient) => ticketingReq(eventId, 'POST', `/events/${eventId}/sales-report/email`, {recipient}),
  ticketingPaymentEvents: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/payment-events`),
  replayTicketingPaymentEvent: (eventId, paymentEventId) => ticketingReq(eventId, 'POST', `/events/${eventId}/payment-events/${paymentEventId}/replay`, {}),
  ticketingJournal: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/journal`),
  ticketingPrivacyRequests: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/privacy-requests`),
  decideTicketingPrivacyRequest: (eventId, requestId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/privacy-requests/${requestId}/decision`, body),
  ticketingOperationsSubscription: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/operations/subscription`),
  saveTicketingOperationsSubscription: (eventId, body) => ticketingReq(eventId, 'PUT', `/events/${eventId}/operations/subscription`, body),
  retryTicketRefund: (eventId, refundId) => ticketingReq(eventId, 'POST', `/events/${eventId}/refunds/${refundId}/retry`, {}),
  ticketingProviderReadiness: (eventId) => ticketingReq(eventId, 'GET', `/events/${eventId}/provider-readiness`),
  bootstrapTicketingProvider: (eventId, provider) => ticketingReq(eventId, 'POST', `/events/${eventId}/provider-bootstrap`, {provider, register_webhook:true}),
  decideTicketCancellation: (eventId, requestId, body) => ticketingReq(eventId, 'POST', `/events/${eventId}/cancellations/${requestId}/decision`, body),

  // Guided event setup (setup-service — orchestrates bulk/structured operations
  // against backend's own gated endpoints; see setup-service/app/main.py).
  bulkCreateTables: (eventId, groups) => req('POST', `/setup/${eventId}/tables/bulk`, { groups }),
  addTablesToGroup: (eventId, body) => req('PATCH', `/setup/${eventId}/tables/bulk`, body),
  setMultiInviteeRules: (eventId, rules) => req('PUT', `/setup/${eventId}/multi-invitee`, { rules }),
  bulkImportProgram: (eventId, workflowId, items) => req('POST', `/setup/${eventId}/program/bulk`, { workflow_id: workflowId, items }),
  checkTeamEmail: (email) => req('POST', `/setup/team/check-email`, { email }),
  getSetupRecommendations: (eventType) => req('GET', `/setup/recommendations?event_type=${encodeURIComponent(eventType || '')}`),
  getSetupProgress: (eventId) => req('GET', `/setup/progress?event_id=${eventId}`),
  setSetupProgress: (eventId, stepKey, status) => req('POST', `/setup/progress`, { event_id: eventId, step_key: stepKey, status }),
  marketingMe: () => marketingReq('GET', '/me'),
  marketingDashboard: () => marketingReq('GET', '/dashboard'),
  marketingAccess: () => marketingReq('GET', '/access'),
  marketingGrantAccess: (body) => marketingReq('POST', '/access', body),
  marketingRevokeAccess: (id) => marketingReq('DELETE', `/access/${id}`),
  marketingLeads: (params = '') => marketingReq('GET', `/leads${params ? `?${params}` : ''}`),
  marketingCreateLead: (body) => marketingReq('POST', '/leads', body),
  marketingUpdateLead: (id, body) => marketingReq('PATCH', `/leads/${id}`, body),
  marketingDeleteLead: (id) => marketingReq('DELETE', `/leads/${id}`),
  marketingMergeLeads: (body) => marketingReq('POST', '/leads/merge', body),
  marketingTags: () => marketingReq('GET', '/tags'),
  marketingRenameTag: (name, body) => marketingReq('PATCH', `/tags/${encodeURIComponent(name)}`, body),
  marketingDeleteTag: (name) => marketingReq('DELETE', `/tags/${encodeURIComponent(name)}`),
  marketingScheduleDemo: (id, body) => marketingReq('POST', `/leads/${id}/demo`, body),
  marketingGdprDelete: (id) => marketingReq('POST', `/leads/${id}/gdpr-delete`, {}),
  marketingLeadActivity: (id) => marketingReq('GET', `/leads/${id}/activity`),
  marketingAddActivity: (id, body) => marketingReq('POST', `/leads/${id}/activity`, body),
  marketingSendSms: (id, body) => marketingReq('POST', `/leads/${id}/sms`, body),
  marketingModule: (module) => marketingReq('GET', `/modules/${module}`),
  marketingCreateRecord: (module, body) => marketingReq('POST', `/modules/${module}`, body),
  marketingUpdateRecord: (module, id, body) => marketingReq('PATCH', `/modules/${module}/${id}`, body),
  marketingDeleteRecord: (module, id) => marketingReq('DELETE', `/modules/${module}/${id}`),
  marketingRunAutomation: (dryRun=false, leadId=null) => marketingReq('POST', `/automation/run?dry_run=${dryRun}${leadId ? `&lead_id=${encodeURIComponent(leadId)}` : ''}`, {}),
  marketingExecuteCampaign: (id, dryRun=false) => marketingReq('POST', `/campaigns/${id}/execute?dry_run=${dryRun}`, {}),
  marketingPreviewCampaign: (id) => marketingReq('POST', `/campaigns/${id}/preview`, {}),
  marketingPreviewSequence: (id, step=0) => marketingReq('POST', `/sequences/${id}/preview?step=${step}`, {}),
  marketingBulkLeads: (body) => marketingReq('POST', '/leads/bulk', body),
  marketingSavedViews: () => marketingReq('GET', '/saved-views'),
  marketingCreateSavedView: (body) => marketingReq('POST', '/saved-views', body),
  marketingDeleteSavedView: (id) => marketingReq('DELETE', `/saved-views/${id}`),
  marketingAudit: () => marketingReq('GET', '/audit'),
  marketingAnalytics: (days=30) => marketingReq('GET', `/analytics?days=${days}`),
  marketingProviders: () => marketingReq('GET', '/providers'),
  marketingPublishSocial: (body) => marketingReq('POST', '/social/publish', body),
  marketingRefreshProvider: (platform) => marketingReq('POST', `/providers/${platform}/refresh`, {}),
  marketingSocialConnections: () => marketingReq('GET', '/social-connections'),
  marketingSaveSocialConnection: (platform, body) => marketingReq('PUT', `/social-connections/${platform}`, body),
  marketingTestSocialConnection: (platform) => marketingReq('POST', `/social-connections/${platform}/test`, {}),
  marketingPreferences: () => marketingReq('GET', '/preferences/me'),
  marketingSavePreferences: (body) => marketingReq('PUT', '/preferences/me', body),
  marketingSettings: () => marketingReq('GET', '/settings'),
  marketingUpdateSettings: (body) => marketingReq('PUT', '/settings', body),
  marketingExportLeads: () => marketingDownload('/export/leads.csv', 'festio-marketing-leads.csv'),
  marketingImportLeads: (file) => marketingUpload('/import/leads.csv', file),
  marketingPublicForm: (token) => req('GET', `/marketing/forms/${token}`),
  marketingSubmitPublicForm: (token, body) => req('POST', `/marketing/forms/${token}/submit`, body),
  trainingMe: (orgId='') => req('GET', `/training/me${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`),
  trainingQuiz: (lessonKey, answers, orgId='') => req('POST', `/training/quiz/${lessonKey}${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`, { answers }),
  trainingPractical: (lessonKey, body, orgId='') => req('POST', `/training/practicals/${lessonKey}${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`, body),
  trainingManageOrgs: () => req('GET', '/training/manage/orgs'),
  trainingPeople: (orgId='') => req('GET', `/training/manage/people${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`),
  trainingAssign: (body) => req('POST', '/training/manage/assignments', body),
  trainingReview: (id, body, orgId='') => req('POST', `/training/manage/practicals/${id}/review${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`, body),
  trainingReset: (userId, orgId='') => req('POST', `/training/manage/people/${userId}/reset${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`, {}),
  trainingDueDate: (id, dueAt, orgId='') => req('PATCH', `/training/manage/assignments/${id}/due-date${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`, { due_at: dueAt || null }),
  trainingReminders: (body) => req('POST', '/training/manage/reminders', body),
  trainingAudit: (orgId='') => req('GET', `/training/manage/audit${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`),
  trainingReleases: () => req('GET', '/training/admin/releases'),
  trainingCreateRelease: (title) => req('POST', '/training/admin/releases', { title }),
  trainingPublishRelease: (id) => req('POST', `/training/admin/releases/${id}/publish`, {}),
  trainingAccessGrants: () => req('GET', '/training/admin/access'),
  trainingGrantAccess: (body) => req('POST', '/training/admin/access', body),
  trainingRevokeAccess: (id) => req('DELETE', `/training/admin/access/${id}`),
}
