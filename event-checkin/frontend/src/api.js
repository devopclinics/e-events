import { auth } from './firebase'

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
    const detail = Array.isArray(err.detail) ? err.detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : err.detail
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
  listEvents: () => req('GET', '/events'),
  createEvent: (data) => req('POST', '/events', data),
  updateEvent: (id, data) => req('PUT', `/events/${id}`, data),
  deleteEvent: (id) => req('DELETE', `/events/${id}`),
  changeStatus: (id, status) => req('PATCH', `/events/${id}/status`, { status }),
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
    return { outputUrl }
  },
  generateQR: (eventId) => req('POST', `/events/${eventId}/guests/generate-qr`),
  sendInvites: (eventId) => req('POST', `/events/${eventId}/guests/send-invites`),
  sendInvitesBatch: (eventId, guestIds, force = false) =>
    req('POST', `/events/${eventId}/guests/send-batch`, {
      guest_ids: guestIds,
      force,
    }),
  updateGuest: (eventId, guestId, data) => req('PATCH', `/events/${eventId}/guests/${guestId}`, data),
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
  toggleFeatures: (eventId, body) => req('PATCH', `/events/${eventId}/features`, body),
  setChannelPolicy: (eventId, policy) => req('PUT', `/events/${eventId}/channel-policy`, policy),
  sendTestMessage: (eventId, channel, phone) => req('POST', `/events/${eventId}/messaging/test`, { channel, phone }),

  // Experience workflows (admin)
  listExperienceWorkflows: (eventId) => req('GET', `/events/${eventId}/experience/workflows`),
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
  updateTable: (eventId, tableId, data) => req('PUT', `/events/${eventId}/tables/${tableId}`, data),
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
  updateMemberPermissions: (eventId, userId, body) => req('PATCH', `/events/${eventId}/members/${userId}/permissions`, body),
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
  // Section-based scanning: sections (table groups) the signed-in staffer may check into.
  myEventSections: (eventId) => req('GET', `/events/${eventId}/my-sections`),
  // Walk-in
  setWalkIn: (eventId, active) => req('PATCH', `/events/${eventId}/walk-in`, { active }),
  setWalkInGroup: (eventId, tableGroupId) =>
    req('PATCH', `/events/${eventId}/walk-in-group`, {
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

  // Billing (Event Pass)
  getBillingTiers: (eventId) => req('GET', `/billing/tiers/${eventId}`),
  getCreditLedger: (eventId) => req('GET', `/billing/credits/${eventId}`),
  checkout: (eventId, tier) => req('POST', '/billing/checkout', { event_id: eventId, tier }),
  setBillingCurrency: (eventId, currency) => req('POST', '/billing/currency', { event_id: eventId, currency }),
  // Public marketing pricing (no auth)
  getPricing: (currency = 'USD') => fetch(`/api/billing/pricing?currency=${currency}`).then((r) => r.json()),

  // Trial-credit requests (customer)
  submitTrialRequest: (body) => req('POST', '/trial-requests', body),
  myTrialRequests: () => req('GET', '/trial-requests/mine'),

  // Superadmin console
  adminOverview: () => req('GET', '/admin/overview'),
  adminAccountsSummary: () => req('GET', '/admin/accounts/summary'),
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
  adminDeleteOrg: (orgId) => req('DELETE', `/admin/orgs/${orgId}`),
  adminSetMemberRole: (orgId, userId, role) => req('PATCH', `/admin/orgs/${orgId}/members/${userId}`, { role }),
  adminRemoveMember: (orgId, userId) => req('DELETE', `/admin/orgs/${orgId}/members/${userId}`),
  adminSetUserActive: (userId, active) => req('PATCH', `/admin/users/${userId}/active`, { active }),
  adminDeleteUser: (userId) => req('DELETE', `/admin/users/${userId}`),
  adminGrant: (eventId, body) => req('POST', `/admin/events/${eventId}/grant`, body),
  adminEventControls: (eventId) => req('GET', `/admin/events/${eventId}/controls`),
  adminSetEventControls: (eventId, body) => req('POST', `/admin/events/${eventId}/controls`, body),
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
  adminListAffiliateStores: () => req('GET', '/admin/affiliate-stores'),
  adminCreateAffiliateStore: (body) => req('POST', '/admin/affiliate-stores', body),
  adminUpdateAffiliateStore: (id, body) => req('PUT', `/admin/affiliate-stores/${id}`, body),
  adminDeleteAffiliateStore: (id) => req('DELETE', `/admin/affiliate-stores/${id}`),
  // Manual invites (admin)
  sendInvites: (eventId, data) => req('POST', `/events/${eventId}/send-invites`, data),
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
  festiomeCreatePoll: (id, data) => festiomeReq('POST', `/festiome/v1/channels/${id}/polls`, data),
  festiomeUpload,
  festiomeDownloadAttachment,
  festiomeVotePoll: (id, optionId) =>
    festiomeReq('POST', `/festiome/v1/polls/${id}/votes`, {
      option_ids: [optionId],
    }),
  festiomeRealtimeTicket: (id) => festiomeReq('POST', '/festiome/v1/realtime-ticket', { channel_id: id }),
  festiomeLike: (messageId) =>
    festiomeReq('POST', `/festiome/v1/messages/${messageId}/reactions`, {
      emoji: '❤️',
    }),
  festiomeUnlike: (messageId) => festiomeReq('DELETE', `/festiome/v1/messages/${messageId}/reactions/${encodeURIComponent('❤️')}`),
  festiomeRead: (id, messageId) =>
    festiomeReq('PUT', `/festiome/v1/channels/${id}/read`, {
      message_id: messageId,
    }),
  festiomeInvite: (id, data) => festiomeReq('POST', `/festiome/v1/groups/${id}/invitations`, data),
  festiomeInvites: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}/invitations`),
  festiomeReports: (id) => festiomeReq('GET', `/festiome/v1/groups/${id}/reports`),
  festiomeUpdateReport: (groupId, id, data) => festiomeReq('PATCH', `/festiome/v1/groups/${groupId}/reports/${id}`, data),
  festiomeNotificationPreferences: (groupId) => festiomeReq('GET', `/festiome/v1/notification-preferences?group_id=${encodeURIComponent(groupId)}`),
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
}
