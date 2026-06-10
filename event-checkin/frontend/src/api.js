import { auth } from './firebase'

const BASE = '/api'

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
    throw new Error(err.detail || res.statusText)
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
  // Events
  listEvents:   ()           => req('GET',    '/events'),
  createEvent:  (data)       => req('POST',   '/events', data),
  updateEvent:  (id, data)   => req('PUT',    `/events/${id}`, data),
  deleteEvent:  (id)         => req('DELETE', `/events/${id}`),
  changeStatus: (id, status) => req('PATCH',  `/events/${id}/status`, { status }),
  updateSource: (id, data)   => req('PUT',    `/events/${id}/source`, data),
  syncNow:      (id)         => req('POST',   `/events/${id}/sync-now`),

  // Team
  listMembers:   (eventId)         => req('GET',    `/events/${eventId}/members`),
  assignMember:  (eventId, userId) => req('POST',   `/events/${eventId}/members`, { user_id: userId }),
  removeMember:  (eventId, userId) => req('DELETE', `/events/${eventId}/members/${userId}`),

  // Guests
  listGuests:          (eventId)           => req('GET',  `/events/${eventId}/guests`),
  downloadGuestTemplate: (eventId, fmt = 'xlsx') =>
    downloadFile(`/events/${eventId}/guests/template?fmt=${fmt}`, `guest-template.${fmt}`),
  importGuestsFromUrl: (eventId, url)      => req('POST', `/events/${eventId}/guests/import-url`, { url }),
  addGuest:            (eventId, data)     => req('POST', `/events/${eventId}/guests`, data),
  generateQR:          (eventId)           => req('POST', `/events/${eventId}/guests/generate-qr`),
  sendInvites:         (eventId)           => req('POST', `/events/${eventId}/guests/send-invites`),
  sendInvitesBatch:    (eventId, guestIds, force = false) =>
    req('POST', `/events/${eventId}/guests/send-batch`, { guest_ids: guestIds, force }),
  deleteGuest:         (eventId, guestId)  => req('DELETE', `/events/${eventId}/guests/${guestId}`),
  resendInvite:        (eventId, guestId)  => req('POST',   `/events/${eventId}/guests/${guestId}/resend-invite`),
  ensureInviteToken:   (eventId, guestId)  => req('POST',   `/events/${eventId}/guests/${guestId}/invite-token`),
  approveRsvp:         (eventId, guestId)  => req('POST',   `/events/${eventId}/guests/${guestId}/approve`),
  rejectRsvp:          (eventId, guestId)  => req('POST',   `/events/${eventId}/guests/${guestId}/reject`),
  guestQrUrl:          (eventId, guestId)  => `${BASE}/events/${eventId}/guests/${guestId}/qr.png`,
  uploadGuests: (eventId, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return getToken().then((token) =>
      fetch(`${BASE}/events/${eventId}/guests/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail)))))
    )
  },

  // Features
  toggleFeatures: (eventId, body) => req('PATCH', `/events/${eventId}/features`, body),
  sendTestMessage: (eventId, channel, phone) =>
    req('POST', `/events/${eventId}/messaging/test`, { channel, phone }),

  // Seating
  listTables:              (eventId)                   => req('GET',    `/events/${eventId}/tables`),
  createTable:             (eventId, data)             => req('POST',   `/events/${eventId}/tables`, data),
  updateTable:             (eventId, tableId, data)    => req('PUT',    `/events/${eventId}/tables/${tableId}`, data),
  deleteTable:             (eventId, tableId)          => req('DELETE', `/events/${eventId}/tables/${tableId}`),
  getSeatingChart:         (eventId)                   => req('GET',    `/events/${eventId}/seating`),
  autoAssign:              (eventId, clear = false)    => req('POST',   `/events/${eventId}/seating/auto-assign?clear=${clear}`),
  assignSeat:              (eventId, guestId, body)    => req('PATCH',  `/events/${eventId}/guests/${guestId}/seat`, body),
  markMealServed:          (eventId, guestId)          => req('PATCH',  `/events/${eventId}/guests/${guestId}/meal-served`),
  updateMemberPermissions: (eventId, userId, body)     => req('PATCH',  `/events/${eventId}/members/${userId}/permissions`, body),

  // Menu (admin)
  listMenuCategories: (eventId)              => req('GET',    `/events/${eventId}/menu-categories`),
  createMenuCategory: (eventId, data)        => req('POST',   `/events/${eventId}/menu-categories`, data),
  updateMenuCategory: (eventId, catId, data) => req('PUT',    `/events/${eventId}/menu-categories/${catId}`, data),
  deleteMenuCategory: (eventId, catId)       => req('DELETE', `/events/${eventId}/menu-categories/${catId}`),
  addMenuItem:        (eventId, catId, data) => req('POST',   `/events/${eventId}/menu-categories/${catId}/items`, data),
  updateMenuItem:     (eventId, itemId, data)=> req('PUT',    `/events/${eventId}/menu-items/${itemId}`, data),
  deleteMenuItem:     (eventId, itemId)      => req('DELETE', `/events/${eventId}/menu-items/${itemId}`),
  getMenuSummary:     (eventId)              => req('GET',    `/events/${eventId}/menu/summary`),
  getMenuDashboard:   (eventId)              => req('GET',    `/events/${eventId}/menu/dashboard`),

  // Menu combinations (combo categories)
  createCombination:  (eventId, catId, data)  => req('POST',   `/events/${eventId}/menu-categories/${catId}/combinations`, data),
  updateCombination:  (eventId, comboId, data)=> req('PUT',    `/events/${eventId}/menu-combinations/${comboId}`, data),
  deleteCombination:  (eventId, comboId)      => req('DELETE', `/events/${eventId}/menu-combinations/${comboId}`),

  // Scanner
  scan: (token) => req('POST', `/scan/${token}`),

  // Ticket (public)
  viewTicket: (token) => fetch(`/api/scan/${token}/ticket`).then((r) => r.json()),

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
      body: JSON.stringify({ partner_first_name, partner_last_name, partner_email }),
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail))))),
  unpairPartner: (token) =>
    fetch(`/api/scan/${token}/pair`, { method: 'DELETE' }).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail)))),

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
  listUsers:      ()             => req('GET', '/auth/users'),
  updateUserRole: (userId, role) => req('PUT', `/auth/users/${userId}/role?role=${role}`),

  // Organization team (members of an event's org)
  listOrgMembers:  (eventId)        => req('GET',  `/events/${eventId}/org-members`),
  inviteOrgMember: (eventId, body)  => req('POST', `/events/${eventId}/org-members`, body),
  setOrgMemberRole:(eventId, userId, role) => req('PUT', `/events/${eventId}/org-members/${userId}`, { role }),

  // ── Invite page settings (admin) ──────────────────────────────────────────
  updateInviteSettings: (eventId, data) => req('PUT',  `/events/${eventId}/invite-settings`, data),
  // RSVP questions CRUD (admin)
  listRSVPQuestions:    (eventId)              => req('GET',    `/events/${eventId}/rsvp-questions`),
  createRSVPQuestion:   (eventId, data)        => req('POST',   `/events/${eventId}/rsvp-questions`, data),
  updateRSVPQuestion:   (eventId, qId, data)   => req('PUT',    `/events/${eventId}/rsvp-questions/${qId}`, data),
  deleteRSVPQuestion:   (eventId, qId)         => req('DELETE', `/events/${eventId}/rsvp-questions/${qId}`),
  // Broadcast (admin)
  broadcast: (eventId, data) => req('POST', `/events/${eventId}/broadcast`, data),

  // Logistics / Fulfillment (admin)
  listShipments:       (eventId)            => req('GET',    `/events/${eventId}/shipments`),
  createShipment:      (eventId, data)      => req('POST',   `/events/${eventId}/shipments`, data),
  updateShipment:      (eventId, sid, data) => req('PUT',    `/events/${eventId}/shipments/${sid}`, data),
  deleteShipment:      (eventId, sid)       => req('DELETE', `/events/${eventId}/shipments/${sid}`),
  populateShipment:    (eventId, sid)       => req('POST',   `/events/${eventId}/shipments/${sid}/populate`),
  listShipmentLines:   (eventId, sid)       => req('GET',    `/events/${eventId}/shipments/${sid}/lines`),
  addShipmentGuest:    (eventId, sid, gid, data = {}) => req('POST', `/events/${eventId}/shipments/${sid}/lines/${gid}`, data),
  removeShipmentGuest: (eventId, sid, gid)  => req('DELETE', `/events/${eventId}/shipments/${sid}/lines/${gid}`),
  updateShipmentLine:  (eventId, sid, gid, data) => req('PUT', `/events/${eventId}/shipments/${sid}/lines/${gid}`, data),
  updateGuestShipping: (eventId, gid, data) => req('PUT',    `/events/${eventId}/guests/${gid}/shipping`, data),
  sendShipmentToVendor:(eventId, sid)       => req('POST',   `/events/${eventId}/shipments/${sid}/send-to-vendor`),
  downloadShipmentXlsx:(eventId, sid, filename = 'shipping-list.xlsx') =>
    downloadFile(`/events/${eventId}/shipments/${sid}/export.xlsx`, filename),
  // Public vendor page (no auth)
  getVendorPage:       (token)              => req('GET',    `/vendor/${token}`),
  downloadVendorXlsx:  (token, filename = 'shipping-list.xlsx') =>
    downloadFile(`/vendor/${token}/export.xlsx`, filename, { withAuth: false }),

  // Gift Registry (admin)
  listRegistryItems:    (eventId)            => req('GET',    `/events/${eventId}/registry/items`),
  createRegistryItem:   (eventId, data)      => req('POST',   `/events/${eventId}/registry/items`, data),
  updateRegistryItem:   (eventId, id, data)  => req('PUT',    `/events/${eventId}/registry/items/${id}`, data),
  deleteRegistryItem:   (eventId, id)        => req('DELETE', `/events/${eventId}/registry/items/${id}`),
  unfurlRegistryLink:   (eventId, url)       => req('POST',   `/events/${eventId}/registry/unfurl`, { url }),
  getRegistrySettings:  (eventId)            => req('GET',    `/events/${eventId}/registry/settings`),
  updateRegistrySettings:(eventId, data)     => req('PUT',    `/events/${eventId}/registry/settings`, data),
  listRegistryClaims:   (eventId)            => req('GET',    `/events/${eventId}/registry/claims`),
  // Venue Access Intelligence (admin)
  listZones:           (eventId)            => req('GET',    `/events/${eventId}/zones`),
  createZone:          (eventId, data)      => req('POST',   `/events/${eventId}/zones`, data),
  updateZone:          (eventId, id, data)  => req('PUT',    `/events/${eventId}/zones/${id}`, data),
  deleteZone:          (eventId, id)        => req('DELETE', `/events/${eventId}/zones/${id}`),
  listTicketTypes:     (eventId)            => req('GET',    `/events/${eventId}/ticket-types`),
  createTicketType:    (eventId, data)      => req('POST',   `/events/${eventId}/ticket-types`, data),
  updateTicketType:    (eventId, id, data)  => req('PUT',    `/events/${eventId}/ticket-types/${id}`, data),
  deleteTicketType:    (eventId, id)        => req('DELETE', `/events/${eventId}/ticket-types/${id}`),
  assignTicketType:    (eventId, gid, ticketTypeId) => req('PUT', `/events/${eventId}/guests/${gid}/ticket-type`, { ticket_type_id: ticketTypeId }),
  accessOccupancy:     (eventId)            => req('GET',    `/events/${eventId}/access/occupancy`),
  accessPeak:          (eventId, bucket=15) => req('GET',    `/events/${eventId}/access/peak?bucket_minutes=${bucket}`),
  accessFlow:          (eventId)            => req('GET',    `/events/${eventId}/access/flow`),
  guestJourney:        (eventId, gid)       => req('GET',    `/events/${eventId}/guests/${gid}/journey`),
  scanZone:            (qrToken, body)      => req('POST',   `/scan/${qrToken}/zone`, body),

  // Public registry (no auth) — resolved by unguessable token
  getRegistryPage:      (token)              => req('GET',    `/registry/${token}`),
  claimRegistryItem:    (token, itemId, data) => req('POST',  `/registry/${token}/items/${itemId}/claim`, data),

  // Billing (Event Pass)
  getBillingTiers: (eventId)      => req('GET',  `/billing/tiers/${eventId}`),
  checkout:        (eventId, tier) => req('POST', '/billing/checkout', { event_id: eventId, tier }),
  setBillingCurrency: (eventId, currency) => req('POST', '/billing/currency', { event_id: eventId, currency }),
  // Public marketing pricing (no auth)
  getPricing:      (currency = 'USD') => fetch(`/api/billing/pricing?currency=${currency}`).then((r) => r.json()),

  // Trial-credit requests (customer)
  submitTrialRequest:  (body)          => req('POST', '/trial-requests', body),
  myTrialRequests:     ()              => req('GET',  '/trial-requests/mine'),

  // Superadmin console
  adminOverview:       ()              => req('GET',    '/admin/overview'),
  adminListTrials:     ()              => req('GET',    '/admin/trial-requests'),
  adminResolveTrial:   (id, body)      => req('POST',   `/admin/trial-requests/${id}/resolve`, body),
  adminGrant:          (eventId, body) => req('POST',   `/admin/events/${eventId}/grant`, body),
  adminListOperators:  ()              => req('GET',    '/admin/operators'),
  adminAddOperator:    (email)         => req('POST',   '/admin/operators', { email }),
  adminRemoveOperator: (userId)        => req('DELETE', `/admin/operators/${userId}`),
  adminListPlans:      ()              => req('GET',    '/admin/plans'),
  adminSavePlan:       (key, body)     => req('PUT',    `/admin/plans/${key}`, body),
  adminDeletePlan:     (key)           => req('DELETE', `/admin/plans/${key}`),
  adminListAffiliateStores: ()         => req('GET',    '/admin/affiliate-stores'),
  adminCreateAffiliateStore:(body)     => req('POST',   '/admin/affiliate-stores', body),
  adminUpdateAffiliateStore:(id, body) => req('PUT',    `/admin/affiliate-stores/${id}`, body),
  adminDeleteAffiliateStore:(id)       => req('DELETE', `/admin/affiliate-stores/${id}`),
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
  inviteUrl: (eventId) => `${window.location.origin}/e/${eventId}`,
}
