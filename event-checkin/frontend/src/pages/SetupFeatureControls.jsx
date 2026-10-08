import {useState} from 'react'
import {api} from '../api'
const features={rsvp:['RSVP','rsvp_enabled'],selfcheckin:['Self check-in','self_checkin_enabled'],seating:['Seating','seating_enabled'],orders:['Meals','menu_enabled'],logistics:['Deliveries','logistics_enabled'],registry:['Giving','registry_enabled'],speakers:['Speakers','speaker_enabled'],partners:['Partners','partner_enabled'],reminders:['Reminders','reminders_enabled'],access:['Venue access','venue_access_enabled'],festiome:['FestioMe','festiome_addon_enabled'],experience:['Guest experience','experience_enabled'],planner:['Planner','planner_enabled'],live:['Festio Live','engagement_enabled']}
export function SetupFeatureControls({event,onRefresh}) {
 const [busy,setBusy]=useState(''),[message,setMessage]=useState('')
 const preferences=event?.setup_preferences
 if(!preferences)return null
 async function activate(id){setBusy(id);setMessage('');try{
  if(id==='rsvp')await api.updateInviteSettings(event.id,{rsvp_enabled:true})
  else if(id==='selfcheckin')await api.setSelfCheckin(event.id,true)
  else if(features[id])await api.toggleFeatures(event.id,{[features[id][1]]:true})
  else throw new Error('Review this feature in service settings.')
  await onRefresh();setMessage('Feature enabled. Review its configuration before use.')
 }catch(e){setMessage(e.message)}finally{setBusy('')}}
 async function apply(){setBusy('preferences');setMessage('');const channels=preferences.channels||[]
  const results=await Promise.allSettled([api.toggleFeatures(event.id,{notify_email:channels.includes('email'),notify_sms:channels.includes('sms'),notify_whatsapp:channels.includes('whatsapp')}),api.setBillingCurrency(event.id,preferences.currency)])
  const errors=results.flatMap((r,i)=>r.status==='rejected'?[`${i===0?'Channels':'Currency'}: ${r.reason?.message||'Could not save'}`]:[])
  await onRefresh();setMessage(errors.join(' · ') || 'Requested channels and currency saved.');setBusy('')
 }
 return <section className="rr-panel" style={{padding:20,marginBottom:20}}><h3>Your requested features</h3><p>Included access and event activation are separate. Enabling a feature does not publish it.</p>{(preferences.features||[]).map(id=><div key={id} style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',margin:'10px 0'}}><strong>{features[id]?.[0]||id}</strong><span>{event[features[id]?.[1]]?'Enabled':'Needs activation'}</span>{!event[features[id]?.[1]]&&<button className="rr-btn secondary" disabled={!!busy} onClick={()=>activate(id)}>Enable {features[id]?.[0]||id}</button>}</div>)}<p>Requested channels: {(preferences.channels||[]).join(', ')||'None'} · Currency: {preferences.currency||'Not selected'}</p><button className="rr-btn secondary" disabled={!!busy||!preferences.currency} onClick={apply}>Apply requested channels &amp; currency</button><p role="status">{message}</p><a href="/communications-redesign?tab=settings">Review service settings →</a></section>
}
export function MealTimingControl({event,onRefresh}) {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('')
 if(!event?.menu_enabled)return null
 async function save(value){setBusy(true);setMessage('');try{await api.toggleFeatures(event.id,{menu_selection_timing:value});await onRefresh();setMessage('Meal selection timing saved.')}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 return <section className="rr-panel" style={{padding:20,marginBottom:20}}><label>When can guests choose meals?<select className="rr-select" value={event.menu_selection_timing||'after_admission'} disabled={busy} onChange={e=>save(e.target.value)}><option value="after_admission">After event check-in</option><option value="before_arrival">Before arrival, after registration confirmation</option></select></label><p>Serving still requires check-in. Served selections remain locked.</p><p role="status">{message}</p></section>
}
