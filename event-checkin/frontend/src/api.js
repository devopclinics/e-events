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
  importGuestsFromUrl: (eventId, url)      => req('POST', `/events/${eventId}/guests/import-url`, { url }),
  addGuest:            (eventId, data)     => req('POST', `/events/${eventId}/guests`, data),
  generateQR:          (eventId)           => req('POST', `/events/${eventId}/guests/generate-qr`),
  sendInvites:         (eventId)           => req('POST', `/events/${eventId}/guests/send-invites`),
  sendInvitesBatch:    (eventId, guestIds, force = false) =>
    req('POST', `/events/${eventId}/guests/send-batch`, { guest_ids: guestIds, force }),
  updateGuest:         (eventId, guestId, data) => req('PATCH', `/events/${eventId}/guests/${guestId}`, data),
  deleteGuest:         (eventId, guestId)  => req('DELETE', `/events/${eventId}/guests/${guestId}`),
  resendInvite:        (eventId, guestId)  => req('POST',   `/events/${eventId}/guests/${guestId}/resend-invite`),
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
}
