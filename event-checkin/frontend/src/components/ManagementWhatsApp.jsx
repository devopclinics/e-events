import {useEffect,useRef,useState} from 'react'
import {useAuth} from '../context/AuthContext'
import {api} from '../api'
import './ManagementWhatsApp.css'

function WhatsAppIcon(){return <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.8 7.3L3 20l1.2-4.7A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M8 7.5c.2 4 2.5 6.4 6.7 7.5l1.3-2-2.6-1.2-1 1c-1.5-.6-2.4-1.5-3-3l.9-1L9.2 6.5Z"/></svg>}
const date=v=>v?new Date(v+'Z'.repeat(!/Z$|[+-]\d\d:\d\d$/.test(v))).toLocaleString():''
const until=v=>v?new Date(v+'Z'.repeat(!/Z$|[+-]\d\d:\d\d$/.test(v))).getTime():0

export default function ManagementWhatsApp(){
 const {user}=useAuth()
 if(!user?.is_platform_superadmin)return null
 return <Inbox key={user.id||user.email} actor={user.id||user.email}/>
}
function Inbox({actor}){
 const key='festio.support.position.'+actor
 const [position,setPosition]=useState(()=>{try{const p=JSON.parse(localStorage.getItem(key));return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null}catch{return null}})
 const [open,setOpen]=useState(false),[expanded,setExpanded]=useState(false),[items,setItems]=useState([]),[unread,setUnread]=useState(0),[selected,setSelected]=useState(null),[thread,setThread]=useState(null),[q,setQ]=useState(''),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[loading,setLoading]=useState(false),[available,setAvailable]=useState(false),[drafts,setDrafts]=useState({}),[sending,setSending]=useState(false),[syncing,setSyncing]=useState(false),[cursor,setCursor]=useState(null),[hasMore,setHasMore]=useState(false),[older,setOlder]=useState([])
 const panel=useRef(),launcher=useRef(),drag=useRef(),current=useRef(null),generation=useRef(0),listGeneration=useRef(0),alive=useRef(true),pending=useRef({}),messages=useRef()
 current.current=selected
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;listGeneration.current++}},[])
 async function loadList(append=false){
  const gen=++listGeneration.current
  try{const result=await api.supportWhatsAppList(q,filter,append?items.length:0);if(!alive.current||gen!==listGeneration.current)return;setItems(previous=>append?[...previous,...result.items]:result.items);setUnread(result.unread_count);setHasMore(result.has_more);setAvailable(true)}catch(e){if(alive.current&&gen===listGeneration.current){if(open)setError(e.message);if(e.status===403)setAvailable(false)}}
 }
 async function loadThread(id){
  const gen=++generation.current
  try{const data=await api.supportWhatsAppThread(id);if(!alive.current||gen!==generation.current||current.current!==id)return;const scroll=messages.current,follow=!scroll||scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80;setThread(data);setLoading(false);if(follow)requestAnimationFrame(()=>{if(messages.current)messages.current.scrollTop=messages.current.scrollHeight});if(data.read_through){await api.supportWhatsAppRead(id,{through:data.read_through});if(alive.current)loadList()}}catch(e){if(alive.current&&gen===generation.current){setError(e.message);setLoading(false)}}
 }
 useEffect(()=>{const t=setTimeout(()=>loadList(),250);return()=>clearTimeout(t)},[q,filter,open])
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='hidden')return;loadList();if(open&&current.current)loadThread(current.current)},15000);return()=>clearInterval(t)},[q,filter,open])
 useEffect(()=>{if(!open)return;const el=panel.current;el?.querySelector('button')?.focus();function keys(e){if(e.key==='Escape'){setOpen(false);launcher.current?.focus()}if(e.key==='Tab'){const focusable=[...el.querySelectorAll('button,input,textarea,select,a')].filter(n=>!n.disabled&&n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}el.addEventListener('keydown',keys);return()=>el.removeEventListener('keydown',keys)},[open])
 function choose(id){setSelected(id);current.current=id;setThread(null);setOlder([]);setLoading(true);setError('');loadThread(id)}
 function clamp(p){return {x:Math.max(8,Math.min(p.x,window.innerWidth-74)),y:Math.max(8,Math.min(p.y,window.innerHeight-94))}}
 function savePosition(p){const next=clamp(p);setPosition(next);try{localStorage.setItem(key,JSON.stringify(next))}catch{}}
 useEffect(()=>{function resize(){setPosition(p=>p?clamp(p):p)}window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[])
 async function sync(){setSyncing(true);setError('');try{const result=await api.supportWhatsAppSync(cursor);setCursor(result.next_page_token||null);await loadList();if(selected)await loadThread(selected)}catch(e){setError(e.message)}finally{setSyncing(false)}}
 async function send(e){e.preventDefault();if(sending||!selected)return;const id=selected,text=(drafts[id]||'').trim();if(!text)return;setSending(true);setError('');const request=pending.current[id]?.body===text?pending.current[id]:{body:text,request_id:crypto.randomUUID()};pending.current[id]=request;try{const result=await api.supportWhatsAppReply(id,request);delete pending.current[id];setDrafts(d=>({...d,[id]:''}));if(result.error)setError(result.error);if(current.current===id)await loadThread(id);await loadList()}catch(e){setError(e.message+' If the request timed out, check the conversation before sending again.');if(current.current===id)await loadThread(id)}finally{setSending(false)}}
 async function markUnread(){try{await api.supportWhatsAppRead(selected,{unread:true});setOpen(false);await loadList()}catch(e){setError(e.message)}}
 async function state(){try{await api.supportWhatsAppState(selected,thread.status==='resolved'?'open':'resolved');await loadThread(selected)}catch(e){setError(e.message)}}
 async function olderMessages(){try{const data=await api.supportWhatsAppThread(selected,thread.older_before);setOlder(v=>[...data.messages,...v]);setThread(t=>({...t,older_before:data.older_before}))}catch(e){setError(e.message)}}
 if(!available)return null
 const active=thread&&thread.id===selected,windowOpen=active&&until(thread.reply_until)>Date.now()
 return <div className="mwa-root">
 <div className="mwa-launch" style={position?{left:clamp(position).x,top:clamp(position).y}:undefined}>
 <button ref={launcher} className="mwa-launch-button" aria-label={`WhatsApp support${unread?', '+unread+' unread conversations':''}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><WhatsAppIcon/>{unread>0&&<span className="mwa-badge">{unread>99?'99+':unread}</span>}</button>
 <button className="mwa-move" aria-label="Move WhatsApp support button. Use arrow keys or drag." onKeyDown={e=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(delta){e.preventDefault();const r=e.currentTarget.parentElement.getBoundingClientRect();savePosition({x:r.left+delta[0],y:r.top+delta[1]})}}} onPointerDown={e=>{const r=e.currentTarget.parentElement.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,left:r.left,top:r.top};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current)savePosition({x:drag.current.left+e.clientX-drag.current.x,y:drag.current.top+e.clientY-drag.current.y})}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>⠿</button></div>
 {open&&<><div className="mwa-backdrop" onClick={()=>{setOpen(false);launcher.current?.focus()}}/><section ref={panel} className={'mwa-panel'+(expanded?' mwa-expanded':'')} role="dialog" aria-modal="true" aria-label="Festio management WhatsApp support">
 <header className="mwa-header"><div><span className="mwa-eyebrow">FESTIO MANAGEMENT ONLY</span><h2><WhatsAppIcon/>WhatsApp support</h2><p>One inbox. Every conversation.</p></div><div><button onClick={()=>setExpanded(v=>!v)} aria-label={expanded?'Reduce inbox':'Expand inbox'}>{expanded?'↙':'↗'}</button><button aria-label="Close WhatsApp support" onClick={()=>{setOpen(false);launcher.current?.focus()}}>×</button></div></header>
 {error&&<div role="alert" className="mwa-error">{error}<button onClick={()=>{setError('');loadList();if(selected)loadThread(selected)}}>Refresh</button></div>}
 <div className="mwa-workspace"><aside className={'mwa-sidebar'+(selected?' mwa-mobile-hidden':'')}><div className="mwa-controls"><label>Find a conversation<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Name or phone number"/></label><select aria-label="Filter support conversations" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All conversations</option><option value="unread">Unread</option><option value="open">Open</option><option value="resolved">Resolved</option></select><button className="mwa-sync" disabled={syncing} onClick={sync}>{syncing?'Importing…':cursor?'Import older messages':'Import Bird history'}</button></div>
 <div className="mwa-conversations">{items.length===0&&<div className="mwa-empty"><strong>No conversations here yet.</strong><p>Incoming messages appear automatically. Import Bird history to look for earlier replies.</p></div>}{items.map(c=><button key={c.id} className={'mwa-contact'+(c.id===selected?' active':'')} onClick={()=>choose(c.id)}><span className="mwa-avatar">{(c.name||c.phone).slice(0,1)}</span><span><strong>{c.name||c.phone}{c.unread&&<i aria-label="Unread"/>}</strong><small>{c.name?c.phone:'WhatsApp'} · {c.status}</small><p>{c.preview}</p><time>{date(c.last_message_at)}</time></span></button>)}{hasMore&&<button onClick={()=>loadList(true)}>Load more conversations</button>}</div></aside>
 <main className={'mwa-thread'+(!selected?' mwa-mobile-hidden':'')}>
 {!selected?<div className="mwa-welcome"><WhatsAppIcon/><h3>A little help goes a long way.</h3><p>Select a conversation to read and reply.<br/>Only Festio management can access this inbox.</p></div>:<>
 <div className="mwa-thread-head"><button aria-label="Back to conversations" onClick={()=>{setSelected(null);current.current=null;generation.current++}}>←</button><div><strong>{active?(thread.name||thread.phone):'Loading conversation…'}</strong>{active&&<small>{thread.phone} · WhatsApp</small>}</div>{active&&<><button onClick={markUnread}>Mark unread</button><button onClick={state}>{thread.status==='resolved'?'Reopen':'Resolve'}</button></>}</div>
 {loading&&<p role="status">Loading messages…</p>}
 {active&&<><div className="mwa-context">{thread.context.length?thread.context.map((c,i)=><span key={i}>{c.guest} · {c.event}</span>):<span>General support · no guest match</span>}{thread.context.length>1&&<small>Multiple guest matches. Context only; this conversation stays private.</small>}</div>
 <div ref={messages} className="mwa-messages" aria-label="Conversation messages">{thread.older_before&&<button onClick={olderMessages}>Load earlier messages</button>}{[...older,...thread.messages].map(m=><article className={'mwa-message '+m.direction} key={m.id}><p>{m.body}</p><small>{m.direction==='outgoing'?'Festio · ':''}{date(m.occurred_at)} · {m.status}</small>{m.error&&<p className="mwa-message-error">{m.error}</p>}</article>)}</div>
 <form className="mwa-compose" onSubmit={send}><p>{windowOpen?'Reply window open until '+date(thread.reply_until):'The 24-hour reply window is closed. The customer must message again, or an approved template is required.'}</p><label className="mwa-sr" htmlFor="mwa-reply">Your WhatsApp reply</label><textarea id="mwa-reply" maxLength={4096} disabled={!windowOpen||sending} placeholder={windowOpen?'Write a helpful reply…':'Free-form replies are unavailable'} value={drafts[selected]||''} onChange={e=>setDrafts(v=>({...v,[selected]:e.target.value}))}/><div><small>Replies are sent from Festio’s WhatsApp number.</small><button disabled={!windowOpen||sending||!(drafts[selected]||'').trim()}>{sending?'Sending…':'Send reply →'}</button></div></form></>}
 </>}
 </main></div></section></>}
 </div>
}
