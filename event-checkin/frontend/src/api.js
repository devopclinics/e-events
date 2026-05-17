const BASE = '/api'

function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function req(method, path, body) {
  const opts = {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (res.status === 401) {
    localStorage.removeItem('token')
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
  listEvents: () => req('GET', '/events'),
  createEvent: (data) => req('POST', '/events', data),
  updateEvent: (id, data) => req('PUT', `/events/${id}`, data),
  deleteEvent: (id) => req('DELETE', `/events/${id}`),
  changeStatus: (id, status) => req('PATCH', `/events/${id}/status`, { status }),

  // Team (event members)
  listMembers: (eventId) => req('GET', `/events/${eventId}/members`),
  assignMember: (eventId, userId) => req('POST', `/events/${eventId}/members`, { user_id: userId }),
  removeMember: (eventId, userId) => req('DELETE', `/events/${eventId}/members/${userId}`),

  // Guests
  listGuests: (eventId) => req('GET', `/events/${eventId}/guests`),
  uploadGuests: (eventId, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/events/${eventId}/guests/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail)))))
  },
  generateQR: (eventId) => req('POST', `/events/${eventId}/guests/generate-qr`),
  sendInvites: (eventId) => req('POST', `/events/${eventId}/guests/send-invites`),
  deleteGuest: (eventId, guestId) => req('DELETE', `/events/${eventId}/guests/${guestId}`),
  resendInvite: (eventId, guestId) => req('POST', `/events/${eventId}/guests/${guestId}/resend-invite`),
  guestQrUrl: (eventId, guestId) => `${BASE}/events/${eventId}/guests/${guestId}/qr.png`,

  // Scanner (official — requires auth)
  scan: (token) => req('POST', `/scan/${token}`),
  // Ticket view (public — guest's own phone)
  viewTicket: (token) => fetch(`/api/scan/${token}/ticket`).then((r) => r.json()),

  // Dashboard
  getDashboard: (eventId) => req('GET', `/events/${eventId}/dashboard`),

  // Auth
  listUsers: () => req('GET', '/auth/users'),
  updateUserRole: (userId, role) => req('PUT', `/auth/users/${userId}/role?role=${role}`),
}
