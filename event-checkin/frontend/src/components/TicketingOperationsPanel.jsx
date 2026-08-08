import { useEffect, useState } from 'react'
import { api } from '../api'
import TicketDeliveryStudio from './TicketDeliveryStudio'

export default function TicketingOperationsPanel({eventId, sales, checkoutFields=[], onSaveCheckoutFields, deliverySettings={}, onSaveDeliverySettings, canBootstrap=false, onRefresh, onError}) {
  const [privacy,setPrivacy]=useState([]), [subscription,setSubscription]=useState(null)
  const [providers,setProviders]=useState(null), [events,setEvents]=useState([])
  const [busy,setBusy]=useState(''), [notice,setNotice]=useState('')
  const [schedule,setSchedule]=useState({recipient:'',frequency:'daily',enabled:false,include_alerts:true})
  const [promo,setPromo]=useState({code:'',kind:'percent',amount:'',max_uses:''})
  const [fields,setFields]=useState(checkoutFields)
  const [delivery,setDelivery]=useState({email_enabled:true,sms_enabled:false,whatsapp_enabled:false,email_subject:'Your tickets for {{event_name}}',email_body:'',email_qr_caption:'Show this QR code at the entrance.',sms_body:'Hi {{first_name}}, your ticket for {{event_name}}: {{ticket_link}}',whatsapp_body:'Hi {{first_name}}, your ticket for {{event_name}}: {{ticket_link}}',pass_design:{eyebrow:"You're invited to",attendee_label:'Guest',qr_instruction:'Show this code to the check-in official at the entrance.',button_label:'Open FestioHub',footer_message:'',accent_color:'#14b8a6'},...deliverySettings})

  async function load() {
    if(!eventId) return
    try {
      const [p,s,e]=await Promise.all([
        api.ticketingPrivacyRequests(eventId), api.ticketingOperationsSubscription(eventId),
        api.ticketingPaymentEvents(eventId)
      ])
      setPrivacy(p); setEvents(e)
      if(s){setSubscription(s);setSchedule({recipient:s.recipient,frequency:s.frequency,enabled:s.enabled,include_alerts:s.include_alerts})}
    } catch(e) { onError?.(e.message) }
  }
  useEffect(()=>{load()},[eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setFields(checkoutFields||[])},[checkoutFields])
  useEffect(()=>{setDelivery(current=>({...current,...(deliverySettings||{})}))},[deliverySettings])
  async function act(key,fn){setBusy(key);setNotice('');try{setNotice(await fn()||'Saved.');await load();await onRefresh?.()}catch(e){onError?.(e.message)}finally{setBusy('')}}
  const failedRefunds=(sales?.refunds||[]).filter(x=>x.status==='failed'&&Number(x.retry_attempts||0)<3)
  const failedEvents=events.filter(x=>!x.processed&&x.last_error)

  return <section className="rr-panel tk-section" aria-labelledby="ticket-actions-title">
    <div className="tk-section-head"><div><span className="tk-step">Action center</span><h2 id="ticket-actions-title">Customer, payment & automation tasks</h2><p>Everything submitted through ticketing can be handled here without raw API calls.</p></div><span className="tk-health" aria-live="polite">{busy?'Working…':notice||'Ready'}</span></div>

    <div className="tk-op-grid">
      <button disabled={!!busy} onClick={()=>act('providers',async()=>{const r=await api.ticketingProviderReadiness(eventId);setProviders(r.providers);return 'Provider checks completed.'})}><b>Check provider readiness</b><span>Validate keys, accounts and webhook registration</span></button>
      {canBootstrap&&<button disabled={!!busy} onClick={()=>act('stripe',async()=>{const r=await api.bootstrapTicketingProvider(eventId,'stripe');if(r.signing_secret){await navigator.clipboard.writeText(r.signing_secret);return 'Stripe webhook created. Signing secret copied—store it in staging now.'}return 'Stripe webhook is already configured.'})}><b>Configure Stripe webhook</b><span>Super-admin only · idempotent staging setup</span></button>}
    </div>
    {providers&&<div className="tk-op-table"><div className="head"><span>Provider</span><span>Credentials</span><span>Account</span><span>Webhook / action</span></div>{Object.values(providers).map(p=><div className="row" key={p.provider}><span><b>{p.provider}</b></span><span>{p.credentials_configured?'Ready':'Missing'}</span><span>{p.account_verified?'Verified':'Not verified'}</span><span>{p.webhook_configured?'Ready':p.action_required.join(' · ')}</span></div>)}</div>}

    <form className="tk-report-email" onSubmit={e=>{e.preventDefault();act('schedule',async()=>{const r=await api.saveTicketingOperationsSubscription(eventId,schedule);setSubscription(r);return `${r.frequency} report schedule saved.`})}}>
      <label><b>Scheduled sales reports</b><span>Daily or weekly reports, with operational alerts.</span></label>
      <input required type="email" placeholder="finance@example.com" value={schedule.recipient} onChange={e=>setSchedule({...schedule,recipient:e.target.value})}/>
      <select value={schedule.frequency} onChange={e=>setSchedule({...schedule,frequency:e.target.value})}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
      <label><input type="checkbox" checked={schedule.enabled} onChange={e=>setSchedule({...schedule,enabled:e.target.checked})}/> Enabled</label>
      <button disabled={!!busy}>Save schedule</button>
    </form>
    {subscription&&<p className="tk-journal-result good"><strong>{subscription.enabled?'Reports enabled':'Reports paused'}</strong><span>Next run: {subscription.next_run_at?new Date(subscription.next_run_at).toLocaleString():'after enabling'}</span></p>}

    <form className="tk-report-email" onSubmit={e=>{e.preventDefault();act('promo',async()=>{await api.createTicketingPromo(eventId,{code:promo.code,kind:promo.kind,amount:promo.kind==='percent'?Math.round(Number(promo.amount)):Math.round(Number(promo.amount)*100),max_uses:promo.max_uses?Number(promo.max_uses):null,active:true});setPromo({code:'',kind:'percent',amount:'',max_uses:''});return 'Promo code created and available at checkout.'})}}>
      <label><b>Create promo code</b><span>Percent or fixed event-currency discount.</span></label>
      <input required placeholder="CODE" value={promo.code} onChange={e=>setPromo({...promo,code:e.target.value.toUpperCase()})}/>
      <select value={promo.kind} onChange={e=>setPromo({...promo,kind:e.target.value})}><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select>
      <input required type="number" min="0.01" max={promo.kind==='percent'?'100':undefined} step={promo.kind==='percent'?'1':'0.01'} placeholder={promo.kind==='percent'?'10 (%)':'25.00'} value={promo.amount} onChange={e=>setPromo({...promo,amount:e.target.value})}/>
      <input type="number" min="1" placeholder="Use limit" value={promo.max_uses} onChange={e=>setPromo({...promo,max_uses:e.target.value})}/>
      <button disabled={!!busy}>Create code</button>
    </form>

    <div className="tk-report-email"><label><b>Checkout form builder</b><span>Collect additional information with every order.</span></label><button type="button" onClick={()=>setFields([...fields,{id:`field_${Date.now()}`,label:'',type:'text',required:false,options:[]}])}>Add field</button><button type="button" disabled={!!busy} onClick={()=>act('fields',async()=>{await onSaveCheckoutFields(fields);return 'Checkout form published.'})}>Publish form</button></div>
    {fields.map((field,index)=><div className="tk-report-email" key={field.id}><input aria-label="Field label" placeholder="Question or field label" value={field.label} onChange={e=>{const next=[...fields];next[index]={...field,label:e.target.value};setFields(next)}}/><select value={field.type} onChange={e=>{const next=[...fields];next[index]={...field,type:e.target.value};setFields(next)}}><option value="text">Short text</option><option value="textarea">Long text</option><option value="select">Dropdown</option><option value="checkbox">Checkbox</option></select>{field.type==='select'&&<input placeholder="Options, comma separated" value={(field.options||[]).join(', ')} onChange={e=>{const next=[...fields];next[index]={...field,options:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)};setFields(next)}}/>}<label><input type="checkbox" checked={field.required} onChange={e=>{const next=[...fields];next[index]={...field,required:e.target.checked};setFields(next)}}/> Required</label><button type="button" onClick={()=>setFields(fields.filter((_,i)=>i!==index))}>Remove</button></div>)}

    <TicketDeliveryStudio value={delivery} onChange={setDelivery} busy={busy==='delivery'} onSave={async value=>act('delivery',async()=>{await onSaveDeliverySettings(value);return 'Ticket delivery channels and messages saved.'})}/>

    <h3>Privacy requests</h3>
    <div className="tk-op-table"><div className="head"><span>Request</span><span>Order</span><span>Submitted</span><span>Action</span></div>{privacy.length?privacy.map(r=><div className="row" key={r.id}><span><b>{r.kind}</b><small>{r.status}</small></span><span>{r.order_id.slice(0,8).toUpperCase()}</span><span>{new Date(r.requested_at).toLocaleString()}</span><span>{r.status==='pending'?<><button disabled={!!busy} onClick={()=>act(`privacy-${r.id}`,()=>api.decideTicketingPrivacyRequest(eventId,r.id,{action:'approve',note:'Approved in organizer action center'}).then(()=> 'Privacy request completed.'))}>Approve</button> <button disabled={!!busy} onClick={()=>act(`privacy-${r.id}`,()=>api.decideTicketingPrivacyRequest(eventId,r.id,{action:'reject',note:'Rejected after review'}).then(()=> 'Privacy request rejected.'))}>Reject</button></>:'Completed'}</span></div>):<p>No privacy requests.</p>}</div>

    {(failedEvents.length>0||failedRefunds.length>0)&&<><h3>Payment recovery</h3><div className="tk-op-table"><div className="head"><span>Type</span><span>Reference</span><span>Issue</span><span>Safe action</span></div>{failedEvents.map(row=><div className="row" key={row.id}><span>Webhook</span><span>{row.provider_event_id}</span><span>{row.last_error}</span><span><button disabled={!!busy} onClick={()=>act(`event-${row.id}`,()=>api.replayTicketingPaymentEvent(eventId,row.id).then(()=> 'Webhook replay completed.'))}>Replay</button></span></div>)}{failedRefunds.map(row=><div className="row" key={row.id}><span>Refund</span><span>{row.id.slice(0,8)}</span><span>{row.failure_reason||'Provider reported failure'}</span><span><button disabled={!!busy} onClick={()=>act(`refund-${row.id}`,()=>api.retryTicketRefund(eventId,row.id).then(()=> 'Refund retry submitted.'))}>Retry ({row.retry_attempts||0}/3)</button></span></div>)}</div></>}
  </section>
}
