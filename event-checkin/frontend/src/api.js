const BASE = '/api'

async function req(method, path, body) {
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
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

  // Guests
  listGuests: (eventId) => req('GET', `/events/${eventId}/guests`),
  uploadGuests: (eventId, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/events/${eventId}/guests/upload`, { method: 'POST', body: fd }).then((r) =>
      r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.detail)))
    )
  },
  generateQR: (eventId) => req('POST', `/events/${eventId}/guests/generate-qr`),
  sendInvites: (eventId) => req('POST', `/events/${eventId}/guests/send-invites`),
  guestQrUrl: (eventId, guestId) => `${BASE}/events/${eventId}/guests/${guestId}/qr.png`,

  // Scanner
  scan: (token) => req('POST', `/scan/${token}`),

  // Dashboard
  getDashboard: (eventId) => req('GET', `/events/${eventId}/dashboard`),
}
