import { useEffect, useState } from 'react';
import { offlineDocument, offlineExpiry, PASS_CACHE, RECORD_CACHE } from './offlinePass.mjs';

export default function OfflinePass({event, member, members, previewMock}) {
  const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const supported=typeof window!=='undefined' && 'caches' in window && 'serviceWorker' in navigator;
  const key=window.location.origin+window.location.pathname+window.location.search;
  const read=async()=>{
    const cache=await caches.open(RECORD_CACHE),response=await cache.match(key);
    const document=await (await caches.open(PASS_CACHE)).match(key);
    return response && document && Number(document.headers.get('X-Festio-Expires'))>Date.now() ? response.json() : [];
  };
  useEffect(()=>{let active=true;setState(null);if(supported&&!previewMock)read().then(rows=>{if(active)setState(rows.find(r=>r.id===member.id&&r.expiresAt>Date.now())||null)}).catch(()=>{});return()=>{active=false}},[member.id,previewMock]);
  async function save(){
    setBusy(true);setError('');
    try {
      if(!navigator.onLine)throw new Error('Connect to save a fresh copy of your pass.');
      const registration=await navigator.serviceWorker.register('/guesthub-sw.js?v=4');
      await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Offline setup is taking longer than expected. Please retry.')),15000))]);
      const deadline=Date.now()+15000;
      while(!registration.active?.scriptURL.endsWith('/guesthub-sw.js?v=4')){if(Date.now()>deadline)throw new Error('Offline setup is still starting. Please retry.');await new Promise(r=>setTimeout(r,100));}
      const response=await fetch(`/api/scan/${encodeURIComponent(member.qr_token)}/qr.png`,{cache:'no-store'});
      if(!response.ok || !response.headers.get('content-type')?.startsWith('image/'))throw new Error('Your pass could not be downloaded. Please retry while connected.');
      const blob=await response.blob();
      const qr=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)});
      const now=Date.now(),expiresAt=offlineExpiry(event,now);
      if(expiresAt<=now)throw new Error('This event has ended. An offline pass is no longer available.');
      const row={id:member.id,name:member.name,eventName:event.name,qr,isJunior:!!member.is_junior,savedAt:now,expiresAt};
      const allowed=new Set(members.filter(m=>m.qr_token).map(m=>m.id));
      const rows=[...(await read()).filter(r=>r.id!==member.id&&allowed.has(r.id)&&r.expiresAt>now),row];
      const documents=await caches.open(PASS_CACHE),records=await caches.open(RECORD_CACHE);
      const document=new Response(offlineDocument(rows,key),{headers:{'Content-Type':'text/html; charset=utf-8','X-Festio-GuestHub':key,'X-Festio-Expires':String(Math.max(...rows.map(r=>r.expiresAt)))}});
      await documents.put(key,document.clone());
      await documents.put(window.location.origin+'/?guesthub=1',document);
      try{localStorage.setItem('festio:installed-guest-hub',window.location.pathname+window.location.search+'#/pass')}catch{}
      await records.put(key,new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}}));
      if(!(await documents.match(key)))throw new Error('Your browser could not retain the offline copy.');
      setState(row);
    }catch(e){setError(e.message||'Offline saving failed. Your pass has not changed.')}finally{setBusy(false)}
  }
  async function remove(){try{await Promise.all([PASS_CACHE,RECORD_CACHE].map(async name=>{const cache=await caches.open(name);await cache.delete(key);const alias=window.location.origin+'/?guesthub=1';const saved=await cache.match(alias);if(saved?.headers.get('X-Festio-GuestHub')===key)await cache.delete(alias)}));setState(null);setError('')}catch{setError('Could not remove saved passes. Please try again.')}}
  return <div className="pass-offline"><strong>{state?'Available offline on this device':'Save your pass for poor Wi-Fi'}</strong><p>{state?`Saved ${new Date(state.savedAt).toLocaleString()}. Refresh before ${new Date(state.expiresAt).toLocaleString()}.`:'Save a personal copy on a device you trust, then reopen this same GuestHub link without a connection. Saved copies last up to 7 days.'}</p><p>Offline access shows saved passes only. Staff still verify admission and guardian permission. Raise screen brightness for scanning.</p>{previewMock?<p>Offline saving is available in your personal GuestHub.</p>:!supported?<p>This browser cannot save an offline copy. Use the full pass options to download or print your pass.</p>:<><button className="secondary full" disabled={busy} onClick={save}>{busy?'Preparing offline pass…':state?'Refresh offline pass':'Save pass offline'}</button>{state&&<button className="text-button" onClick={remove}>Remove saved passes from this device</button>}</>}{error&&<p role="alert">{error}</p>}</div>;
}
