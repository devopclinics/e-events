/* Staff shell/assets only. Never cache API responses, credentials, or guest passes. */
const CACHE='festio-guest-services-shell-v1'
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/guest-services')).then(()=>self.skipWaiting())))
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()))
self.addEventListener('message',event=>{
 if(event.data?.type!=='CACHE_GUEST_SERVICE_ASSETS'||!Array.isArray(event.data.assets))return
 const assets=event.data.assets.slice(0,80).filter(value=>{try{const url=new URL(value,self.location.origin);return url.origin===self.location.origin&&url.pathname.startsWith('/assets/')}catch{return false}})
 event.waitUntil(caches.open(CACHE).then(async cache=>{for(const asset of assets){try{await cache.add(asset)}catch{/* Online page can retry registration later. */}}const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-160)))if(new URL(key.url).pathname.startsWith('/assets/'))await cache.delete(key)}))
})
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url)
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return
 if(url.pathname==='/guest-services'||url.pathname==='/guest-services/'){
  event.respondWith(fetch(event.request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put('/guest-services',response.clone())}return response}).catch(()=>caches.match('/guest-services')))
 }else if(url.pathname.startsWith('/assets/')){
  event.respondWith(caches.match(event.request).then(saved=>saved||fetch(event.request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone())}return response})))
 }
})
