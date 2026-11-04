import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {api} from '../api'
import {useAuth} from '../context/AuthContext'
import {zonedWallTimeToUtcISOString} from '../timeutil'
import {STARTING_POINTS,LAUNCH_EVENT_TYPES,LAUNCH_SETUP,launchAccess} from './customerJourneyModel.mjs'
import './CustomerJourney.css'

export default function CustomerLaunch({onComplete}){
 const {user}=useAuth()
 const [step,setStep]=useState(1),[goal,setGoal]=useState('invitation'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[limits,setLimits]=useState(null),[limitsError,setLimitsError]=useState(''),[confirmed,setConfirmed]=useState(false)
 const requestId=useRef(crypto.randomUUID()),createdRef=useRef(null),zoneTouched=useRef(false)
 const [form,setForm]=useState({name:'',host:'',date:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',venue:'',description:'',email:user?.email||'',phone:'',eventType:'',style:'arch',colour:'mint'})
 const point=STARTING_POINTS.find(p=>p.id===goal),quick=goal==='invitation',setup=LAUNCH_SETUP[goal],access=launchAccess(goal,limits)
 const addon=limits?.addon_prices?.find(p=>p.key===setup.addon)
 const passPrices=(limits?.pass_prices||[]).filter(p=>Number(p.amount)>0).sort((a,b)=>a.amount-b.amount)
 const money=amount=>new Intl.NumberFormat('en-NG',{style:'currency',currency:limits?.currency||'USD',maximumFractionDigits:2}).format(amount/100)
 function loadLimits(){setLimitsError('');setLimits(null);api.eventCreationLimits().then(setLimits).catch(e=>setLimitsError(e.message||'Could not load event defaults.'))}
 useEffect(loadLimits,[])
 useEffect(()=>{if(!zoneTouched.current&&(limits?.region==='NG'||limits?.currency==='NGN'))setForm(x=>({...x,timezone:'Africa/Lagos'}));setConfirmed(false)},[limits?.currency,limits?.region])
 function field(key,value){if(key==='timezone')zoneTouched.current=true;if(key==='timezone'||key==='date')setConfirmed(false);setForm(x=>({...x,[key]:value}))}
 async function create(e){
  e.preventDefault();if(busy)return;setError('')
  if(!limits?.currency||!confirmed){setError('Confirm the event timezone and billing currency before continuing.');return}setBusy(true)
  try{
   let event=createdRef.current
   if(!event){
    const when=zonedWallTimeToUtcISOString(form.date,form.timezone)
    if(!when||!Number.isFinite(new Date(when).getTime()))throw new Error('Enter a valid event date and timezone.')
    if(quick){const result=await api.createQuickInvite({name:form.name.trim(),event_date:when,timezone:form.timezone,venue_name:form.venue.trim(),message:form.description.trim(),creator_email:form.email.trim(),creator_phone:form.phone.trim(),host_name:form.host.trim(),style:form.style,colour:form.colour,event_type:form.eventType,cover:'',envelope:false,request_id:requestId.current});event={id:result.id}}
    else event=await api.createEvent({name:form.name.trim(),couples_name:form.host.trim(),event_type:form.eventType,attendance_mode:point.mode,event_date:when,timezone:form.timezone,checkin_base_url:window.location.origin,venue_name:form.venue.trim()||null,description:form.description.trim()||null,notify_sms:false,notify_whatsapp:false,setup_preferences:{starting_point:goal,features:[],channels:['email'],currency:limits.currency,creator_email:form.email.trim(),creator_phone:form.phone.trim()}})
    createdRef.current=event
   }
   onComplete(event,goal)
  }catch(e){setError(e.message||'Could not create your event. Please retry.')}finally{setBusy(false)}
 }
 const action=access==='required'?`Create event & review ${goal==='conference'?'programme':goal==='fundraiser'?'donation':'seating'} access`:setup.button
 return <div className="cj"><span className="cj-label">Create → Share → Run</span><div className="cj-head"><div><h1>{step===1?'Your event. Everything coming together.':'Tell us about your event.'}</h1><p>{step===1?'Start with what you need today. Add more as your plans grow.':setup.next}</p></div><span className="cj-chip">Step {step} of 2</span></div>
 <div className="cj-start"><section>{step===1?<><h2 className="cj-question">What would you like to do?</h2><div>{STARTING_POINTS.map(p=><button key={p.id} className="cj-choice" onClick={()=>{setGoal(p.id);setStep(2)}}><span className="cj-icon">{p.icon}</span><div><strong>{p.title}</strong><small>{p.description}</small></div><span>↗</span></button>)}</div><p className="cj-small">Need several? Start with one—you can combine tools in your event.</p><details className="cj-advanced"><summary>More setup options</summary><Link to="/setup-redesign?view=wizard&detail=1">Full event form & advanced options →</Link></details></>:<form className="cj-form" onSubmit={create}>
 <span className="cj-chip">{point.title}</span>
 <label style={{marginTop:20}}>Event type<select aria-label="Event type" required value={form.eventType} onChange={e=>field('eventType',e.target.value)}><option value="">Choose an event type</option>{LAUNCH_EVENT_TYPES.map(type=><option key={type}>{type}</option>)}</select></label>
 <label>Event name<input required maxLength={160} value={form.name} onChange={e=>field('name',e.target.value)}/></label>
 <label>Date and start time<input type="datetime-local" required value={form.date} onChange={e=>field('date',e.target.value)}/></label>
 <section className="cj-locale" aria-label="Confirm event location settings"><h3>Confirm time & currency</h3>
 <label>Event timezone<select aria-label="Event timezone" value={form.timezone} onChange={e=>field('timezone',e.target.value)}>{[...new Set(['Africa/Lagos',form.timezone,'America/Chicago','Europe/London','UTC',...(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[])])].map(z=><option key={z} value={z}>{z==='Africa/Lagos'?'Africa/Lagos · Nigeria (WAT, UTC+1)':z}</option>)}</select></label>
 <button type="button" className="rr-btn secondary" onClick={()=>field('timezone','Africa/Lagos')}>Use Nigeria time · Lagos</button>
 <p><strong>Billing currency: {limits?.currency||'Loading…'}</strong>{limits?.organization_name&&<> · {limits.organization_name}</>}</p>
 <p className="cj-small">This is your workspace billing currency. Review or change it in payment setup before making a purchase or opening paid sales. Selecting Lagos time does not change billing currency.</p>
 <label className="cj-check"><input type="checkbox" checked={confirmed} required onChange={e=>setConfirmed(e.target.checked)}/>The event timezone and billing currency are correct.</label></section>
 <div className="cj-fields"><label>Organizer email<input aria-label="Organizer email" type="email" required value={form.email} onChange={e=>field('email',e.target.value)}/></label><label>Organizer phone<input aria-label="Organizer phone" type="tel" required maxLength={40} value={form.phone} onChange={e=>field('phone',e.target.value)}/></label></div><p className="cj-small">Required contact details stay private. They are not added to a guest list.</p>
 <details className="cj-advanced"><summary>Add more details · optional</summary><label>A few words for your guests (optional)<textarea maxLength={2000} value={form.description} onChange={e=>field('description',e.target.value)}/></label><label>Venue (optional)<input aria-label="Venue" maxLength={300} value={form.venue} onChange={e=>field('venue',e.target.value)} placeholder="Venue to be announced"/></label><label>Host / organizer name (optional)<input aria-label="Host / organizer name" maxLength={120} value={form.host} onChange={e=>field('host',e.target.value)}/></label></details>
 {quick&&<details className="cj-advanced"><summary>Invitation design · optional</summary><div className="cj-fields"><label>Invitation style<select aria-label="Invitation style" value={form.style} onChange={e=>field('style',e.target.value)}><option value="arch">Arch</option><option value="editorial">Editorial</option><option value="minimal">Minimal</option></select></label><label>Colours<select aria-label="Colours" value={form.colour} onChange={e=>field('colour',e.target.value)}><option value="mint">Mint</option><option value="lavender">Lavender</option><option value="rose">Rose</option></select></label></div></details>}
 <section className="cj-note cj-access" aria-label="Access and pricing"><strong>{access==='included'?'Included with your current access':access==='required'?'Access required before setup':access==='unknown'?'Access will be checked before setup':quick?'Free invitation preview & sharing':'Continue into your selected workspace'}</strong><p>{access==='included'?'We’ll check your access again and enable the selected tool as we open its setup.':access==='required'?`${limits?.has_active_pass?'This tool needs additional access.':'An Event Pass and tool access are required.'} We’ll open access review after creating the event; no purchase is made here.`:access==='unknown'?'We’ll verify your access after creating the event. If an upgrade is needed, you’ll see the requirement before enabling the tool.':goal==='tickets'?'Ticket types and payment setup come next. Payment-provider requirements and processing fees apply before sales.':quick?'Creating the invitation opens replies and a reusable preview link. Nothing is emailed or messaged automatically.':'Import guests and review passes next. No invitations are sent automatically.'}</p>
 {access==='required'&&addon?.amount!=null&&<p>Published tool price: <strong>{money(addon.amount)}</strong>{!limits.has_active_pass?' · Event Pass separate.':''}</p>}
 {access==='required'&&!limits?.has_active_pass&&passPrices.length>0&&<p>Event Passes from <strong>{money(passPrices[0].amount)}</strong>; capacity and final price are reviewed before purchase.</p>}
 {access==='required'&&!addon&&<p>Tool pricing will be confirmed in access review.</p>}
 </section>
 {limitsError&&<p className="cj-error" role="alert">{limitsError} <button type="button" className="rr-btn secondary" onClick={loadLimits}>Retry defaults</button></p>}
 {!quick&&<p className="cj-small">Your event starts as a draft. Registration and ticket sales stay closed until you open them.</p>}
 {error&&<p role="alert" className="cj-error">{error}</p>}
 <div className="cj-actions"><button type="button" className="rr-btn secondary" disabled={busy} onClick={()=>setStep(1)}>Back</button><button className="rr-btn primary" disabled={busy||!limits?.currency}>{busy?'Creating…':action+' →'}</button></div>
 </form>}</section>
 <aside className={`cj-preview ${step===2?'cj-next-steps':'cj-connected-preview'}`}><span className="cj-label">{step===1?'One event. Connected tools.':'What happens next'}</span>{step===1?<><h2>A smoother day.<br/>From the very start.</h2><p>Your invitation, guest list and event day, connected.</p><div className="cj-preview-story" aria-label="Example of a connected event journey"><article><span className="cj-story-number">01 · CREATE</span><div className="cj-story-invite"><span>YOU’RE INVITED</span><strong>A night to remember</strong><small>Your celebration. Your style.</small></div><h3>Make it yours</h3><p>Create an invitation or start with the tool you need.</p></article><article><span className="cj-story-number">02 · SHARE</span><div className="cj-story-reply"><span aria-hidden="true">✓</span><div><strong>Count me in!</strong><small>Reply saved to your guest list</small></div></div><h3>Bring everyone together</h3><p>Share your invitation and keep replies in one place.</p></article><article><span className="cj-story-number">03 · RUN</span><div className="cj-story-arrival"><span aria-hidden="true">✓</span><strong>Welcome, Ada</strong><small>Checked in · Table 08</small></div><h3>Welcome with confidence</h3><p>Prepare passes, scan arrivals and help guests find their seats.</p></article></div><p className="cj-story-caption">Illustrative preview · Choose the tools that suit your event. Access requirements are shown during setup.</p></>:<><h2>{point.title}</h2><ol>{setup.steps.map((text,i)=><li key={text}><span>{i+1}</span><strong>{text}</strong></li>)}</ol><p>{setup.next}</p><p className="cj-small">You can add other tools in the same event.</p></>}</aside>
 </div></div>
}
