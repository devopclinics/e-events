import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { searchFeatures } from './featureSearch.mjs'

export default function FeatureSearch({ entries, eventName }) {
 const [query,setQuery]=useState('')
 const [active,setActive]=useState(0)
 const dialog=useRef(null),input=useRef(null),trigger=useRef(null),list=useRef(null)
 const location=useLocation()
 const results=searchFeatures(entries,query)
 function close(){dialog.current?.close()}
 function open(){setQuery('');setActive(0);if(!dialog.current.open)dialog.current.showModal();input.current?.focus()}
 useEffect(()=>{close()},[location.pathname,location.search])
 useEffect(()=>{
  const key=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open()}}
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
 },[])
 useEffect(()=>{setActive(0)},[query,eventName])
 function keyboard(e){
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();const next=results.length ? (active+(e.key==='ArrowDown'?1:-1)+results.length)%results.length : 0
   setActive(next);list.current?.querySelectorAll('a')[next]?.scrollIntoView({block:'nearest'})
  }
  if(e.key==='Enter'){e.preventDefault();list.current?.querySelectorAll('a')[active]?.click()}
 }
 return <>
  <button type="button" className="rr-feature-search-trigger" ref={trigger} onClick={open} aria-label="Search features" aria-haspopup="dialog"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><span>Search features</span><kbd>⌘ / Ctrl K</kbd></button>
  <dialog className="rr-feature-dialog" ref={dialog} aria-labelledby="rr-feature-title" onKeyDownCapture={e=>{if(e.key==='Escape'){e.preventDefault();close()}}} onClose={()=>trigger.current?.focus()} onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
   <header><div><h2 id="rr-feature-title">Find a feature</h2><p>{eventName ? `For ${eventName}` : 'Choose an event to find its services'}</p></div><button type="button" onClick={close} aria-label="Close feature search">×</button></header>
   <label className="rr-feature-input"><span>Search features and services</span><input ref={input} type="search" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={keyboard} placeholder="Try certificates, fundraising, check-in…" autoComplete="off" aria-controls="rr-feature-results"/></label>
   <div className="rr-feature-count" role="status">{query ? `${results.length} matching features` : 'Browse features or start typing'}</div>
   <nav id="rr-feature-results" ref={list} aria-label="Matching features">{results.map((x,i)=><Link key={x.id+x.to} to={x.to} className={i===active?'is-highlighted':''} onClick={close} onFocus={()=>setActive(i)}><span><strong>{x.label}</strong><small>{x.description}</small></span><span aria-hidden="true">↗</span></Link>)}{!results.length&&<p className="rr-feature-empty">No features found. Try “certificate”, “donation” or “guests”.</p>}</nav>
   <footer>↑ ↓ to browse · Enter to open · Esc to close</footer>
  </dialog>
 </>
}
