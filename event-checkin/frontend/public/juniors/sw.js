/* No child records, guardian contacts, credentials or pending handoffs are cached. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||event.request.mode!=='navigate'||url.origin!==self.location.origin||!url.pathname.startsWith('/juniors/'))return;
 event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Festio Juniors</title><main style="max-width:440px;margin:48px auto;padding:24px;font:18px/1.6 system-ui"><h1>Connect to Festio Juniors</h1><p>Reconnect to view the latest records and safely confirm each handoff. No offline movement has been recorded.</p><button onclick="location.reload()" style="padding:14px;font:inherit">Try again</button></main>',{headers:{'Content-Type':'text/html; charset=utf-8'},status:503})));
});
