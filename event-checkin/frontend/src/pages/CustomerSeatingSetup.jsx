import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {api} from '../api'
import {seatingPlan,hasPlannedTables} from './customerSeatingModel.mjs'

export default function CustomerSeatingSetup({eventId,initialGuests,onSaving,onSaved}) {
 const [mode,setMode]=useState('guests'),[guests,setGuests]=useState(initialGuests>0?String(initialGuests):''),[tables,setTables]=useState('20'),[seats,setSeats]=useState('10'),[group,setGroup]=useState('Guest tables'),[tableName,setTableName]=useState('')
 const [inventory,setInventory]=useState([]),[loading,setLoading]=useState(true),[inventoryError,setInventoryError]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null),[reviewRequired,setReviewRequired]=useState(false)
 const alive=useRef(true),inFlight=useRef(false)
 useEffect(()=>{alive.current=true;loadInventory().catch(()=>{});return()=>{alive.current=false}},[eventId])
 async function loadInventory(){setLoading(true);setInventoryError('');try{const next=await api.listTables(eventId);if(alive.current)setInventory(next);return next}catch(e){if(alive.current)setInventoryError(e.message||'Existing tables could not be loaded.');throw e}finally{if(alive.current)setLoading(false)}}
 // Report load errors in the panel, without leaving an unhandled rejected promise.
 function refreshInventory(){loadInventory().catch(()=>{})}
 const plan=seatingPlan({mode,guests:mode==='single'?'':guests,tables,seatsPerTable:seats,existingTables:inventory})
 const collision=mode!=='single'&&group.trim()&&hasPlannedTables(inventory,group,plan.tableCount)
 async function save(e){
  e.preventDefault();if(inFlight.current||plan.error||!plan.tableCount||!group.trim()&&mode!=='single')return
  inFlight.current=true;setSaving(true);onSaving(true);setError('');let submitted=false
  try{
   const fresh=await api.listTables(eventId)
   if(alive.current)setInventory(fresh)
   const current=seatingPlan({mode,guests:mode==='single'?'':guests,tables,seatsPerTable:seats,existingTables:fresh})
   if(current.error)throw new Error(current.error)
   // Never silently submit a smaller batch if another operator added capacity.
   if(current.tableCount!==plan.tableCount||current.existingSeats!==plan.existingSeats)throw new Error('The seating plan changed while you were editing. Review the updated capacity, then save again.')
   if(mode==='single'){
    await api.createTable(eventId,{name:tableName.trim(),capacity:Number(seats)})
    if(alive.current){setReceipt({created:1,seats:Number(seats)});onSaved(`Table “${tableName.trim()}” saved with ${seats} seats. Guest assignments are unchanged.`)}
   }else{
    if(hasPlannedTables(fresh,group,current.tableCount))throw new Error('Tables with these names already exist. Review the existing tables or choose a different group name before adding more.')
    submitted=true
    const response=await api.bulkCreateTables(eventId,[{group_name:group.trim(),table_count:current.tableCount,table_capacity:Number(seats)}])
    const result=response?.groups?.[0]
    if(!result||result.error||result.created!==current.tableCount)throw new Error(`${result?.created??'Some'} of ${current.tableCount} tables were reported saved. ${result?.error||'The batch did not report complete success.'} Review the existing tables before trying again.`)
    if(alive.current){setReceipt({created:result.created,seats:result.created*Number(seats)});onSaved(`${result.created} tables saved with ${result.created*Number(seats)} new seats. Guest assignments are unchanged.`)}
   }
   await loadInventory()
  }catch(e){
   if(alive.current){setError(e.message||'The request could not be confirmed. Review existing tables before trying again.');if(submitted)setReviewRequired(true)}
   // The orchestrator may have saved part of a batch before an error or timeout.
   // Reload names/capacity and block a duplicate submission of the same plan.
   try{await loadInventory()}catch{}
  }finally{inFlight.current=false;if(alive.current){setSaving(false);onSaving(false)}}
 }
 if(receipt)return <section><div className="cj-note" role="status"><strong>{receipt.created} {receipt.created===1?'table':'tables'} saved · {receipt.seats} new seats</strong><p>Existing tables and guest assignments were kept. Your floor planner reads these same seating tables.</p></div><div className="cj-actions"><Link className="rr-btn primary" to={`/floorplan-redesign/${eventId}`}>Arrange the floor plan →</Link><Link className="rr-btn secondary" to="/addons-redesign?tab=seating">Assign guests & manage tables →</Link></div></section>
 return <section><p>Start with your total guests or the number of tables you want to add. Review the capacity before saving.</p><div className="cj-seating-modes" role="group" aria-label="How to plan seating">{[['guests','By guest count'],['tables','By table count'],['single','Single table']].map(([key,label])=><button type="button" key={key} aria-pressed={mode===key} disabled={saving} onClick={()=>{setMode(key);setError('')}}>{label}</button>)}</div>
 {loading&&<p role="status">Loading existing tables…</p>}{inventoryError&&<div className="cj-error" role="alert">{inventoryError} <button className="rr-btn secondary" onClick={refreshInventory} disabled={saving}>Retry loading tables</button></div>}
 <form className="cj-form" onSubmit={save}><fieldset disabled={saving} style={{border:0,padding:0,minWidth:0}}>{mode!=='single'?<><div className="cj-fields"><label>{mode==='guests'?'Total number of guests':'Total guests (optional)'}<input name="guests" type="number" required={mode==='guests'} min="1" step="1" value={guests} onChange={e=>setGuests(e.target.value)} placeholder="e.g. 200"/></label>{mode==='tables'&&<label>New tables to add<input name="tables" type="number" required min="1" max="200" step="1" value={tables} onChange={e=>setTables(e.target.value)}/></label>}<label>Seats per table<input name="seats" type="number" required min="1" max="100" step="1" value={seats} onChange={e=>setSeats(e.target.value)}/></label></div><label>Table group name<input name="group" maxLength="100" required value={group} onChange={e=>setGroup(e.target.value)}/><small>Tables will be named {group.trim()||'Guest tables'} 1, {group.trim()||'Guest tables'} 2 and so on.</small></label></>:<><label>Table name<input name="tableName" required maxLength="80" value={tableName} onChange={e=>setTableName(e.target.value)} placeholder="Table 01"/></label><label>Seats<input name="capacity" required type="number" min="1" max="100" step="1" value={seats} onChange={e=>setSeats(e.target.value)}/></label></>}
 {!loading&&!inventoryError&&<><div className="cj-capacity-summary" aria-label="Seating capacity preview"><div><strong>{inventory.length}</strong><small>Existing tables</small></div><div><strong>{plan.tableCount}</strong><small>New tables</small></div><div><strong>{plan.totalSeats}</strong><small>Total seats</small></div></div><p className="cj-small">Existing seats: {plan.existingSeats} · New seats: {plan.newSeats}{plan.targetGuests!==null&&` · ${plan.shortfall?`${plan.shortfall} more seats needed`:`${plan.spare} spare seats`}`}</p>{plan.error?<p role="status">{plan.error}</p>:plan.shortfall>0?<div className="cj-note warning" role="status">This plan is {plan.shortfall} seats short. Add more tables or increase seats per table before saving.</div>:plan.tableCount===0?<div className="cj-note" role="status">Your existing tables already have enough seats for {plan.targetGuests} guests. No new tables are needed.</div>:mode==='guests'?<p role="status">For {plan.targetGuests} guests, add {plan.tableCount} {plan.tableCount===1?'table':'tables'} with {seats} seats each, using the {plan.existingSeats} seats already available.</p>:null}</>}
 {collision&&<p className="cj-note warning" role="alert">This plan overlaps existing table names. Review your tables or use a different group name. We won’t create the same batch again.</p>}{error&&<p className="cj-error" role="alert">{error}</p>}<p className="cj-small">{reviewRequired&&'This batch needs review in the full seating workspace before starting another request. '}This adds tables without deleting existing ones or assigning guests. Guest count here is for planning; it does not change your RSVP limit.</p><div className="cj-actions"><button className="rr-btn primary" disabled={saving||loading||!!inventoryError||!!plan.error||!!collision||reviewRequired||plan.shortfall>0||!plan.tableCount||(mode==='single'?!tableName.trim():!group.trim())}>{saving?'Saving tables…':mode==='single'?'Save table':`Create ${plan.tableCount} tables →`}</button><Link className="rr-btn secondary" to="/addons-redesign?tab=seating">Full seating workspace →</Link></div></fieldset></form></section>
}
