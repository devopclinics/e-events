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
  // Only explicitly saved personal pass documents have an offline fallback.
  // Never cache app HTML or personalized APIs implicitly.
  if (request.mode === 'navigate' && request.method === 'GET' && url.origin === self.location.origin && (/^\/(r|rsvp)\/[^/]+$/.test(url.pathname) || url.pathname==='/' && url.searchParams.get('guesthub')==='1')) {
    event.respondWith((async () => {
      const key=url.origin+url.pathname+url.search;
      const cache=await caches.open('festio-offline-pass-pages-v1');
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),6000);
      try {
        if(self.navigator.onLine===false)throw new Error('Offline');
        const response=await fetch(request,{cache:'no-store',signal:controller.signal});
        if ([401,403,404,410].includes(response.status)) await cache.delete(key);
        return response;
      } catch {
        const saved=await cache.match(key);
        if(saved && Number(saved.headers.get('X-Festio-Expires'))>Date.now())return saved;
        await cache.delete(key);
        return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Festio offline</title><main style="max-width:440px;margin:48px auto;padding:24px;font:18px/1.6 system-ui"><h1>Connect to open GuestHub</h1><p>No current offline pass is saved for this link. Reconnect, open My Pass and choose Save pass offline before your visit.</p><button onclick="location.reload()" style="padding:14px;font:inherit">Try again</button></main>',{headers:{'Content-Type':'text/html; charset=utf-8'},status:503});
      } finally {clearTimeout(timeout);}
    })());
    return;
  }
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
