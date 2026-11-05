import { useEffect, useState } from 'react'
import { api } from '../api'
import './SessionAccessPanel.css'

export default function SessionAccessPanel({eventId}) {
  const [data,setData]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const [query,setQuery]=useState(''), [selected,setSelected]=useState([]), [zoneId,setZoneId]=useState(''), [page,setPage]=useState(1)
  async function load(){try{setError('');setData(await api.sessionAccess(eventId))}catch(e){setError(e.message)}}
  useEffect(()=>{setData(null);setSelected([]);setPage(1);load()},[eventId])
  async function save(zone,ids,decision){setBusy(true);try{await api.setSessionAccess(eventId,zone,ids,decision);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function restrict(zone,value){if(!value&&!window.confirm('Remove approval requirement? Guests without a decision will follow the existing ticket and tag rules. Explicit blocks remain in effect.'))return;setBusy(true);try{await api.setSessionRestriction(eventId,zone,value);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
  if(!data)return <section className="sa-panel"><p>{error||'Loading session access…'}</p>{error&&<button onClick={load}>Retry</button>}</section>
  const visible=data.guests.filter(g=>`${g.name} ${g.email||''} ${g.phone||''}`.toLowerCase().includes(query.toLowerCase()))
  const state=(gid,zid)=>data.decisions.find(d=>d.guest_id===gid&&d.zone_id===zid)?.decision||'review'
  const label=(g,z)=>{const v=state(g.id,z.id);return v==='allow'?'Allowed':v==='block'?'Blocked':z.restricted?'Needs approval':'Use existing rules'}
  return <section className="sa-panel">
    <header><div><small>ONE PASS · SEPARATE ENTRY RECORDS</small><h2>Who can enter each session?</h2><p>Allow or block a guest independently for Conference, Dinner or any zone. Blocking entry does not remove their guest record. Exits remain available.</p></div></header>
    {error&&<p role="alert">{error} <button onClick={load}>Retry</button></p>}
    <div className="sa-zones">{data.zones.map(z=><article key={z.id}><h3>{z.name}</h3><label><input type="checkbox" checked={z.restricted} disabled={busy} onChange={e=>restrict(z.id,e.target.checked)}/> Require explicit approval</label><p>{z.restricted?'Unassigned guests cannot enter. Online scanning required.':'Existing ticket and tag rules apply; explicit blocks always win.'}</p></article>)}</div>
    {!data.zones.length&&<p>Add your sessions in Zones first.</p>}
    <div className="sa-actions"><input aria-label="Search session guests" placeholder="Search name, email or phone" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/><button disabled={busy} onClick={()=>setSelected(visible.map(g=>g.id))}>Select filtered guests ({visible.length})</button><button onClick={()=>setSelected([])}>Clear selection</button></div>
    <div className="sa-bulk"><strong>{selected.length} selected</strong><select aria-label="Session for bulk access" value={zoneId} onChange={e=>setZoneId(e.target.value)}><option value="">Choose session</option>{data.zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select>{['allow','block','review'].map(d=><button key={d} disabled={busy||!zoneId||!selected.length} onClick={()=>save(zoneId,selected,d)}>{d==='allow'?'Allow selected':d==='block'?'Block selected':'Reset to review'}</button>)}</div>
    <div className="sa-guests">{visible.slice((page-1)*30,page*30).map(g=><article key={g.id}><label className="sa-name"><input type="checkbox" checked={selected.includes(g.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,g.id]:s.filter(id=>id!==g.id))}/><strong>{g.name}</strong></label><p>{g.email||g.phone||'No contact details'}</p><div>{data.zones.map(z=><label className={`sa-decision ${state(g.id,z.id)}`} key={z.id}><span>{z.name}<small>{label(g,z)}</small></span><select aria-label={`${g.name}: ${z.name} access`} disabled={busy} value={state(g.id,z.id)} onChange={e=>save(z.id,[g.id],e.target.value)}><option value="review">{z.restricted?'Needs approval':'Use existing rules'}</option><option value="allow">Allow</option><option value="block">Block</option></select></label>)}</div></article>)}</div>
    {!visible.length&&<p>No matching guests.</p>}<footer><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} · {visible.length} guests</span><button disabled={page*30>=visible.length} onClick={()=>setPage(p=>p+1)}>Next</button></footer>
  </section>
}
