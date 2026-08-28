const CACHE_NAME = 'festio-guest-hub-v3'
const QR_PATH = /^\/api\/scan\/[^/]+\/qr\.png$/
// FestioMe's group list and per-channel message list — cached so a guest with
// degraded venue Wi-Fi still sees the last-synced state instead of a blank page.
const FESTIOME_READ_PATH = /^\/api\/festiome\/v1\/(groups|channels\/[^/]+\/messages)(\?.*)?$/

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('festio-guest-hub-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Festio', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'Festio'
  const options = {
    body: payload.body || '',
    data: { url: payload.url || '/' },
    icon: '/favicon.ico',
    tag: payload.url || undefined,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  const cacheable = QR_PATH.test(url.pathname) || FESTIOME_READ_PATH.test(url.pathname + url.search)
  if (request.method !== 'GET' || url.origin !== self.location.origin || !cacheable) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  )
})
