import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PublicTicketCheckout from '../components/PublicTicketCheckout'
import './PublicTicketsPage.css'

const tone={panelStrong:'#ffffff',border:'#d8e1df',text:'#102c2a',muted:'#657674',accent:'#d89b45'}
const money=(n,c)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(Number(n||0)/100)
const date=(value,options={})=>value?new Intl.DateTimeFormat(undefined,{month:'long',day:'numeric',year:'numeric',...options}).format(new Date(value)):''

function EventCard({event}) {
  return <article className="pt-card"><a href={event.sales_url} className="pt-card-image" style={event.cover_image?{backgroundImage:`linear-gradient(180deg,transparent 30%,rgba(8,20,19,.65)),url("${event.cover_image}")`}:{}}><span>{event.timing==='current'?'Happening now':'Upcoming'}</span></a><div><small>{date(event.event_date,{weekday:'short'})}</small><h2>{event.name}</h2><p>{event.venue_name||event.venue_address||'Location from organizer'}</p><footer><strong>From {money(event.from_price,event.currency)}</strong><a href={event.sales_url}>View event →</a></footer></div></article>
}

export default function PublicTicketsPage({embed=false}) {
  const {eventId}=useParams()
  const [events,setEvents]=useState(null)
  const [query,setQuery]=useState('')
  useEffect(()=>{fetch('/api/ticketing/public/events',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(d=>setEvents(d.events||[])).catch(()=>setEvents([]))},[])
  const event=eventId ? events?.find(item=>item.id===eventId) : null
  useEffect(()=>{
    if(!event)return
    document.title=`${event.name} Tickets | Festio`
    const script=document.createElement('script'); script.type='application/ld+json'
    script.text=JSON.stringify({'@context':'https://schema.org','@type':'Event',name:event.name,description:event.description||undefined,startDate:event.event_date,endDate:event.event_end_date||undefined,image:event.cover_image?[event.cover_image]:undefined,location:{'@type':'Place',name:event.venue_name||undefined,address:event.venue_address||undefined},offers:{'@type':'Offer',url:event.sales_url,price:Number(event.from_price||0)/100,priceCurrency:event.currency,availability:'https://schema.org/InStock'}})
    document.head.appendChild(script); return()=>{script.remove();document.title='Festio'}
  },[event])
  if(eventId) return <main className={`pt-store ${embed?'embed':''}`}>
    {!embed&&<nav><a href="/" className="pt-brand"><i>F</i> Festio</a><a href="/tickets">Find events</a></nav>}
    {!embed&&(events===null?<div className="pt-loading">Loading event…</div>:event?<header className="pt-event-hero" style={event.cover_image?{backgroundImage:`linear-gradient(90deg,rgba(6,20,19,.92),rgba(6,20,19,.35)),url("${event.cover_image}")`}:{}}><div><span className="pt-live">{event.timing==='current'?'Happening now':'Upcoming event'}</span><h1>{event.name}</h1><p className="pt-description">{event.description||'Join us for an unforgettable experience.'}</p><div className="pt-facts"><span><b>{date(event.event_date,{weekday:'long'})}</b>{event.event_end_date&&event.event_end_date!==event.event_date?` – ${date(event.event_end_date)}`:''}</span><span><b>{event.venue_name||'Venue'}</b>{event.venue_address||'Details provided by the organizer'}</span><span><b>Official tickets</b>Secure checkout and unique QR admission</span></div><a href="#tickets" className="pt-primary">Choose tickets</a></div></header>:<div className="pt-not-found"><h1>Event tickets unavailable</h1><p>This event is not currently published for ticket sales.</p><a href="/tickets">Browse events</a></div>)}
    <div className="pt-checkout"><PublicTicketCheckout eventId={eventId} tone={tone}/></div>
    {!embed&&event&&<footer className="pt-footer"><span>Powered by <b>Festio</b></span><span>Secure checkout · Unique QR tickets · Mobile entry</span></footer>}
  </main>
  const visible=(events||[]).filter(e=>`${e.name} ${e.venue_name||''} ${e.venue_address||''}`.toLowerCase().includes(query.toLowerCase())),current=visible.filter(e=>e.timing==='current'),upcoming=visible.filter(e=>e.timing!=='current')
  return <main className="pt-market"><nav><a href="/" className="pt-brand"><i>F</i> Festio</a><a href="/login">Organizer sign in</a></nav><header><span>DISCOVER WITH FESTIO</span><h1>Find something<br/>worth showing up for.</h1><p>Official event pages, secure tickets and fast QR entry—all in one place.</p><input aria-label="Search events" placeholder="Search by event or location…" value={query} onChange={e=>setQuery(e.target.value)} style={{width:'min(600px,100%)',boxSizing:'border-box',marginTop:22,padding:'16px 18px',borderRadius:12,border:'1px solid #6f8f8a',fontSize:16}}/></header>{events===null?<div className="pt-loading">Finding events…</div>:events.length===0?<div className="pt-empty"><h2>No ticketed events are live yet.</h2><p>Events appear here as soon as an organizer enables ticket sales.</p></div>:visible.length===0?<div className="pt-empty"><h2>No events match your search.</h2><button onClick={()=>setQuery('')}>Clear search</button></div>:<>{current.length>0&&<section><div className="pt-heading"><div><small>LIVE NOW</small><h2>Current events</h2></div></div><div className="pt-grid">{current.map(e=><EventCard event={e} key={e.id}/>)}</div></section>}<section><div className="pt-heading"><div><small>PLAN AHEAD</small><h2>Upcoming events</h2></div><span>{upcoming.length} event{upcoming.length===1?'':'s'}</span></div><div className="pt-grid">{upcoming.map(e=><EventCard event={e} key={e.id}/>)}</div></section></>}</main>
}
