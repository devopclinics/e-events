import { useEffect,useState,useCallback,useRef } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { readRecord,editRecord,savePage,clearGuestServiceCaches,queueId,queuedAction,appendAction,discardAction,syncQueue } from '../lib/guestServiceOffline.mjs'
export default function useGuestServiceOffline(eventId){
 const {user}=useAuth(),actor=user?.id
 const key=actor&&eventId?queueId(actor,eventId):null
 const [rows,setRows]=useState([]),[online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine!==false),[syncing,setSyncing]=useState(false),[storageError,setStorageError]=useState('')
 const active=useRef(key);active.current=key;const running=useRef(false)
 const refresh=useCallback(async()=>{if(!key)return;try{const value=await readRecord(key);if(active.current===key)setRows(value || [])}catch(e){if(active.current===key)setStorageError(e.message)}},[key])
 const sync=useCallback(async()=>{if(!key||running.current||navigator.onLine===false)return;running.current=true;setSyncing(true);try{const value=await syncQueue(key,body=>{if(active.current!==key)throw new Error('Account or event changed');return api.syncGuestServiceAction(eventId,body)});if(active.current===key)setRows(value);return value}catch(e){if(active.current===key)setStorageError(e.message)}finally{running.current=false;setSyncing(false)}},[key,eventId])
 useEffect(()=>{setRows([]);setStorageError('');refresh();const connected=()=>{setOnline(true);sync()},disconnected=()=>setOnline(false);window.addEventListener('online',connected);window.addEventListener('offline',disconnected);return()=>{window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected)}},[refresh,sync])
 useEffect(()=>{if(key&&online)sync()},[key,online,sync])
 useEffect(()=>{if(!('serviceWorker' in navigator)||!online)return;let live=true;navigator.serviceWorker.register('/guest-services-sw.js',{scope:'/guest-services'}).then(async registration=>{const worker=registration.active||registration.installing||registration.waiting;if(!worker)return;const cache=()=>{if(live)(registration.active||worker).postMessage({type:'CACHE_GUEST_SERVICE_ASSETS',assets:performance.getEntriesByType('resource').map(row=>row.name).filter(url=>url.includes('/assets/'))})};if(worker.state==='activated')cache();else worker.addEventListener('statechange',()=>{if(worker.state==='activated')cache()});cache()}).catch(()=>{});return()=>{live=false}},[online,eventId])
 useEffect(()=>{if(online)return;const timer=setInterval(async()=>{if(navigator.onLine===false)return;try{const response=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(response.ok)setOnline(true)}catch{}},15000);return()=>clearInterval(timer)},[online])
 useEffect(()=>{if(!online||!rows.some(row=>row.state==='pending'))return;const timer=setInterval(sync,20000);return()=>clearInterval(timer)},[online,rows,sync])
 const queue=async(action,guest,service)=>{if(!key)throw new Error('Sign in before saving offline work');const next=await appendAction(key,queuedAction(action,guest,service));if(active.current===key)setRows(next);return next.find(row=>row.state==='pending'&&row.action===action&&row.guest_id===guest.id&&row.service_id===(service?.id||null))?.client_key}
 const discard=async(clientKey)=>{if(key){await discardAction(key,clientKey);await refresh()}}
 const cache=async(params,data)=>{if(actor&&active.current===key&&data?.event_id===eventId)try{await savePage(`page:${actor}:${eventId}:${params}`,{saved_at:Date.now(),data})}catch(e){setStorageError(e.message)}}
 const cached=async(params)=>{if(!actor)return null;const result=await readRecord(`page:${actor}:${eventId}:${params}`);return result&&Date.now()-result.saved_at<12*60*60*1000?result.data:null}
 return {disconnect:()=>setOnline(false),reconnect:()=>setOnline(navigator.onLine!==false),clear:()=>actor?clearGuestServiceCaches(actor):Promise.resolve(),online,rows,syncing,storageError,queue,sync,discard,cache,cached,actor}
}
