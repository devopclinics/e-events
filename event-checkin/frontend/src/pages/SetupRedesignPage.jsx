import {useSearchParams} from 'react-router-dom'
import {useAuth} from '../context/AuthContext'
import {SETUP_STAGES,readGuideResume,saveGuideResume} from './guideNavigation.mjs'
import './GuideStage.css'
import { useEffect, useRef, useState } from 'react'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import { zonedWallTimeToUtcISOString } from '../timeutil'
import { OutcomeLauncher, PhaseOneGuide } from './GuidedSetupPhaseOne'
import GuidedSetupPhaseTwo from './GuidedSetupPhaseTwo'
import GuidedSetupPhaseThree from './GuidedSetupPhaseThree'
import GuidedSetupPhaseFour from './GuidedSetupPhaseFour'
import GuidedSetupPhaseFive from './GuidedSetupPhaseFive'
import GuidedSetupPhaseSix from './GuidedSetupPhaseSix'
import './SetupRedesignPage.css'

export const EVENT_TYPES = [
  'Wedding', 'Nikkah / Aqd', 'Graduation ceremony', 'Birthday party',
  'Gala / banquet', 'Conference / seminar', 'Community / religious event',
  'Corporate event', 'Concert / show', 'Private party', 'Other',
]
// Full IANA zone list where the browser supports it, else a small curated
// set — matches SetupWizardPage's legacy list exactly (event times render
// in the chosen zone, so a truncated list blocks most of the world).
const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Africa/Lagos', 'Europe/Zurich', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'UTC']
const DETECTED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
// The billing API currently supports Paystack/NGN and Stripe/USD.
const CURRENCIES = ['NGN — Nigerian Naira', 'USD — US Dollar']
const ATTENDANCE_MODES = [
  { id: 'rsvp', label: 'Invitation / RSVP', desc: 'Invite named guests and collect responses.' },
  { id: 'ticketed', label: 'Paid tickets', desc: 'Sell tickets and create guest records from paid orders.' },
  { id: 'hybrid', label: 'Tickets + invitations', desc: 'Combine public sales with a managed invite list.' },
  { id: 'private', label: 'Internal / private list', desc: 'Control admission from a private guest list.' },
]

const CHANNELS = [
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'whatsapp', label: 'WhatsApp' },
]

const FEATURES = [
  { id: 'rsvp', label: 'RSVP form', desc: 'Let guests confirm attendance' },
  { id: 'seating', label: 'Seating', desc: 'Assign tables and seats' },
  { id: 'orders', label: 'Food orders / Menu', desc: 'Capture meal choices' },
  { id: 'access', label: 'Venue access', desc: 'Configure zones, gates, and ticket access' },
  { id: 'logistics', label: 'Deliveries / Packing list', desc: 'Vendor shipment tracking' },
  { id: 'registry', label: 'Gift registry', desc: 'Accept gifts and contributions' },
  { id: 'speakers', label: 'Speaker showcase', desc: 'Public page for guest speakers' },
  { id: 'partners', label: 'Partner showcase', desc: 'Public page for sponsors and partners' },
  { id: 'festiome', label: 'FestioMe guest app', desc: 'Guest-side experience hub' },
  { id: 'experience', label: 'Experience program', desc: 'Session-based event content' },
  { id: 'selfcheckin', label: 'Self check-in kiosk', desc: 'Guests check themselves in' },
  { id: 'planner', label: 'Event planner', desc: 'Budget, vendors, milestones, and run of show' },
]

function WizardPhase({ onComplete, notify }) {
  const [form, setForm] = useState({
    name: '', type: 'Conference / seminar', host: '', date: '', timezone: DETECTED_TZ || 'UTC',
    attendanceMode: 'rsvp',
    multiDay: false, endDate: '', baseUrl: '', venue: '', venueAddress: '',
    guestCount: '', currency: '',
    channels: new Set(['email']), features: new Set(['rsvp', 'planner']),
  })
  const [recommendation, setRecommendation] = useState(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [creationLimits, setCreationLimits] = useState(null)
  useEffect(()=>{api.eventCreationLimits().then(limits=>{setCreationLimits(limits);setForm(current=>({...current,currency:current.currency || CURRENCIES.find(c=>c.startsWith(limits.currency)) || ''}))}).catch(()=>{})},[])
  const enabledFeatureCount = form.features.size
  function toggleSet(key, val) {
    setForm((prev) => {
      const next = new Set(prev[key])
      if (next.has(val)) next.delete(val)
      else next.add(val)
      return { ...prev, [key]: next }
    })
  }

  useEffect(() => {
    let alive = true
    setRecommendationLoading(true)
    api.getSetupRecommendations(form.type)
      .then((result) => { if (alive) setRecommendation(result) })
      .catch(() => { if (alive) setRecommendation(null) })
      .finally(() => { if (alive) setRecommendationLoading(false) })
    return () => { alive = false }
  }, [form.type])

  function applyRecommendations() {
    if (!recommendation) return
    const featureMap = {
      seating_enabled: 'seating',
      menu_enabled: 'orders',
      venue_access_enabled: 'access',
      logistics_enabled: 'logistics',
      registry_enabled: 'registry',
      experience_enabled: 'experience',
    }
    const suggested = (recommendation.suggested_features || []).map((key) => featureMap[key]).filter(Boolean)
    if (recommendation.registry_common === true) suggested.push('registry')
    if (recommendation.festiome_common === 'true') suggested.push('festiome')
    if (recommendation.program_common) suggested.push('experience')
    setForm((current) => ({
      ...current,
      multiDay: recommendation.multi_day_common === 'default_on' ? true : current.multiDay,
      features: new Set([...current.features, ...suggested]),
    }))
    notify(`Applied ${form.type} setup suggestions`)
  }

  return (
    <div className="su-wizard">
      <div className="su-wizard-form">
        <h2>Create your event</h2>
        <p className="su-section-label">Event details</p>
        <div className="su-field-row">
          <div>
            <label className="rd-field-label">Event name *</label>
            <input className="rd-field" value={form.name} placeholder="Women's Convention 2026" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="rd-field-label">Type</label>
            <select className="rd-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="rr-link-btn" disabled={recommendationLoading || !recommendation} onClick={applyRecommendations}>{recommendationLoading ? 'Loading suggestions…' : `Apply ${form.type} suggestions`}</button>
          </div>
        </div>
        <div className="su-field-row">
          <div>
            <label className="rd-field-label">{recommendation?.host_field_label || 'Host / Organiser'}</label>
            <input className="rd-field" value={form.host} placeholder="DevOps Clinics" onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </div>
          <div>
            <label className="rd-field-label">Estimated guest count</label>
            <input className="rd-field" type="number" min="1" max={creationLimits?.guest_cap || undefined} value={form.guestCount} placeholder={String(creationLimits?.guest_cap || 25)} onChange={(e) => setForm({ ...form, guestCount: e.target.value })} /><p className="rd-hint">{creationLimits ? `Current pass: up to ${creationLimits.guest_cap} guests. Upgrade the organization pass for a larger event.` : "Checking your plan capacity…"}</p>
          </div>
        </div>
        <div className="su-field-row">
          <div>
            <label className="rd-field-label">Date and time *</label>
            <input className="rd-field" type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="rd-field-label">Timezone *</label>
            <select className="rd-field" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {DETECTED_TZ && <option value={DETECTED_TZ}>{DETECTED_TZ} (detected)</option>}
              {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <span className="rd-hint">All invite and guest times display in this zone.</span>
          </div>
        </div>
        <label className="gr-required-check su-multiday-check">
          <input type="checkbox" checked={form.multiDay} onChange={(e) => setForm({ ...form, multiDay: e.target.checked })} />
          Multi-day event
        </label>
        {form.multiDay && (
          <div className="su-field-row">
            <div>
              <label className="rd-field-label">End date and time</label>
              <input className="rd-field" type="datetime-local" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
        )}
        <p className="su-section-label">Location</p>
        <div className="su-field-row">
          <div>
            <label className="rd-field-label">Venue</label>
            <input className="rd-field" value={form.venue} placeholder="Eko Convention Centre" onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          </div>
          <div>
            <label className="rd-field-label">Venue address</label>
            <input className="rd-field" value={form.venueAddress} placeholder="Plot 1415, Adetokunbo Ademola, VI" onChange={(e) => setForm({ ...form, venueAddress: e.target.value })} />
          </div>
        </div>
        <p className="su-section-label">How will guests attend?</p>
        <div className="su-feature-grid su-attendance-grid">
          {ATTENDANCE_MODES.map((mode) => (
            <label key={mode.id} className={`su-feature-item${form.attendanceMode === mode.id ? ' checked' : ''}`}>
              <input type="radio" name="attendance-mode" checked={form.attendanceMode === mode.id} onChange={() => setForm((current) => ({
                ...current,
                attendanceMode: mode.id,
                features: new Set([
                  ...Array.from(current.features).filter((feature) => !['rsvp', 'access'].includes(feature)),
                  ...(['ticketed', 'hybrid'].includes(mode.id) ? ['access'] : []),
                  ...(['rsvp', 'hybrid'].includes(mode.id) ? ['rsvp'] : []),
                ]),
              }))} />
              <div><strong>{mode.label}</strong><small>{mode.desc}</small></div>
            </label>
          ))}
        </div>
        <p className="su-section-label">Finance</p>
        <div className="su-field-row">
          <div>
            <label className="rd-field-label">Currency</label>
            <select className="rd-field" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option value="" disabled>Choose the event currency</option>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <details><summary>Advanced: custom app address</summary><label className="rd-field-label">App base URL</label>
            <input className="rd-field" value={form.baseUrl} type="url" placeholder={window.location.origin} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></details>
          </div>
        </div>
        <p className="su-section-label">Communication channels</p>
        <div className="su-toggle-grid">
          {CHANNELS.map((ch) => (
            <label key={ch.id} className="su-toggle-item">
              <input type="checkbox" checked={form.channels.has(ch.id)} onChange={() => toggleSet('channels', ch.id)} />
              {ch.label}
            </label>
          ))}
        </div>
        <p className="su-section-label">Features to enable</p>
        <div className="su-feature-grid">
          {FEATURES.map((f) => (
            <label key={f.id} className={`su-feature-item${form.features.has(f.id) ? ' checked' : ''}`}>
              <input type="checkbox" checked={form.features.has(f.id)} onChange={() => toggleSet('features', f.id)} />
              <div>
                <strong>{f.label}</strong>
                <small>{f.desc}</small>
              </div>
            </label>
          ))}
        </div>
        <button
          className="rr-btn primary su-create-btn"
          disabled={!form.name || !form.date}
          onClick={async () => {
            const startUtc = zonedWallTimeToUtcISOString(form.date, form.timezone)
            const endUtc = form.multiDay && form.endDate ? zonedWallTimeToUtcISOString(form.endDate, form.timezone) : null
            if (form.multiDay && form.endDate && new Date(endUtc) < new Date(startUtc)) {
              notify('End date must be on or after the start date.', true)
              return
            }
            if (!form.currency) { notify("Choose the event currency before creating your event.", true); return }
            if (creationLimits && Number(form.guestCount) > creationLimits.guest_cap) { notify(`Your current pass allows ${creationLimits.guest_cap} guests. Choose a larger pass or reduce this capacity.`, true); return }
            let event = null
            try {
              event = await api.createEvent({
                setup_preferences: { features: [...form.features], channels: [...form.channels], currency: form.currency.slice(0, 3) },
                name: form.name.trim(),
                couples_name: form.host.trim(),
                event_type: form.type,
                attendance_mode: form.attendanceMode,
                event_date: startUtc,
                event_end_date: endUtc,
                timezone: form.timezone,
                checkin_base_url: form.baseUrl.trim() || window.location.origin,
                venue_name: form.venue.trim() || null,
                venue_address: form.venueAddress.trim() || null,
                notify_sms: form.channels.has('sms'),
                notify_whatsapp: form.channels.has('whatsapp'),
                rsvp_capacity: form.guestCount ? Number(form.guestCount) : null,
              })
              const optionalResults = await Promise.allSettled([
                api.toggleFeatures(event.id, {
                  seating_enabled: form.features.has('seating'),
                  menu_enabled: form.features.has('orders'),
                  logistics_enabled: form.features.has('logistics'),
                  registry_enabled: form.features.has('registry'),
                  speaker_enabled: form.features.has('speakers'),
                  partner_enabled: form.features.has('partners'),
                  venue_access_enabled: form.features.has('access'),
                  festiome_addon_enabled: form.features.has('festiome'),
                  experience_enabled: form.features.has('experience'),
                  planner_enabled: form.features.has('planner'),
                  notify_email: form.channels.has('email'),
                }),
                api.updateInviteSettings(event.id, { rsvp_enabled: form.features.has('rsvp') }),
                api.setBillingCurrency(event.id, form.currency.slice(0, 3)),
                api.setSelfCheckin(event.id, form.features.has('selfcheckin')),
              ])
              const failedSettings = optionalResults.filter((result) => result.status === 'rejected').length
              if (form.features.has('planner') && optionalResults[0].status === 'fulfilled') {
                await api.plannerCreateStarterPlan(event.id, {
                  event_name: event.name,
                  event_type: event.event_type,
                  attendance_mode: event.attendance_mode,
                  event_date: form.date,
                  venue_name: form.venue.trim() || null,
                }).catch(() => null)
              }
              notify(
                failedSettings
                  ? `Event “${event.name}” was created, but ${failedSettings} optional setting${failedSettings === 1 ? '' : 's'} could not be enabled. Review Guided setup.`
                  : `Event “${event.name}” created`,
                failedSettings > 0,
              )
              onComplete(event)
            } catch (error) {
              notify(
                event
                  ? `Event “${event.name}” was created. Continue in Guided setup to finish configuration.`
                  : error.message || 'Event could not be created',
                true,
              )
              if (event) onComplete(event)
            }
          }}
        >
          Create event &amp; continue setup →
        </button>
      </div>
      {/* Selection summary: pricing and entitlements are server-derived after creation. */}
      <div className="su-plan-sidebar">
        <div className="su-plan-card">
          <div className="su-plan-label">Selected setup</div>
          <div className="su-plan-name">{enabledFeatureCount} feature{enabledFeatureCount === 1 ? '' : 's'}</div>
          <div className="su-plan-note">Festio will enforce your organization’s live plan and entitlements when these settings are saved.</div>
          <div className="su-plan-features">
            <p>Based on your selections:</p>
            <ul>
              {Array.from(form.features).map((id) => {
                const f = FEATURES.find((x) => x.id === id)
                return f ? <li key={id}>{f.label}</li> : null
              })}
              {form.features.size === 0 && <li style={{ color: 'var(--rr-sub)', fontStyle: 'italic' }}>No add-ons selected</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SetupRedesignPage() {
  const [eventId, setCurrentEvent] = useCurrentEvent()
  const {user}=useAuth()
  const [params,setParams]=useSearchParams()
  const previousEvent=useRef(eventId)
  const requested=params.get('view') || readGuideResume(eventId,user?.id)?.view || (eventId?'guide':'wizard')
  const phase=SETUP_STAGES.some(([id])=>id===requested)?requested:'guide'
  const [toast,setToast]=useState(null)
  const stageIndex=SETUP_STAGES.findIndex(([id])=>id===phase)
  function setPhase(next){setParams({view:next})}
  useEffect(()=>{
    if(previousEvent.current!==eventId){
      previousEvent.current=eventId
      const saved=readGuideResume(eventId,user?.id)
      setParams({view:saved?.view || (eventId?'guide':'wizard'),...(saved?.task?{task:saved.task}:{})},{replace:true})
      return
    }
    if(!params.get('view')){
      const saved=readGuideResume(eventId,user?.id)
      setParams({view:phase,...(saved?.view===phase&&saved?.task?{task:saved.task}:{})},{replace:true})
      return
    }
    saveGuideResume(eventId,user?.id,phase,params.get('task')||'')
    document.querySelector('.su-phase-btn.active')?.scrollIntoView({block:'nearest',inline:'center'})
  },[eventId,user?.id,phase,params.toString()])

  function notify(message, error = false) {
    setToast({ message, error })
    window.setTimeout(() => setToast(null), 3000)
  }

  return (
    <RedesignShell topActive="guide" eventScoped>
      <div className="su-page">
        <label className="guide-stage-mobile">Step {stageIndex+1} of 8 · {SETUP_STAGES[stageIndex][1]}<select aria-label="Setup stage" value={phase} onChange={e=>setPhase(e.target.value)}>{SETUP_STAGES.map(([id,label],i)=><option key={id} value={id}>{i+1}. {label}</option>)}</select></label>
        <div className="guide-stage-controls"><button className="rr-btn secondary" disabled={stageIndex===0} onClick={()=>setPhase(SETUP_STAGES[stageIndex-1][0])}>Previous</button><button className="rr-btn secondary" disabled={stageIndex===7} onClick={()=>setPhase(SETUP_STAGES[stageIndex+1][0])}>Next stage</button></div>
        <div className="su-phase-bar" aria-label="Event setup stages">
          <button className={`su-phase-btn${phase === 'wizard' ? ' active' : ''}`} onClick={() => setPhase('wizard')}>
            <span className="su-phase-num">1</span> Create event
          </button>
          <>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'outcomes' ? ' active' : ''}`} onClick={() => setPhase('outcomes')}>
            <span className="su-phase-num">2</span> Choose outcomes
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'guide' ? ' active' : ''}`} onClick={() => setPhase('guide')}>
            <span className="su-phase-num">3</span> Foundation
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'audience' ? ' active' : ''}`} onClick={() => setPhase('audience')}>
            <span className="su-phase-num">4</span> Audience &amp; registration
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'experience' ? ' active' : ''}`} onClick={() => setPhase('experience')}>
            <span className="su-phase-num">5</span> Design &amp; guest experience
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'operations' ? ' active' : ''}`} onClick={() => setPhase('operations')}>
            <span className="su-phase-num">6</span> Operations &amp; giving
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'live' ? ' active' : ''}`} onClick={() => setPhase('live')}>
            <span className="su-phase-num">7</span> Conference &amp; Live
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'closeout' ? ' active' : ''}`} onClick={() => setPhase('closeout')}>
            <span className="su-phase-num">8</span> Results &amp; closeout
          </button>
          </>
        </div>

        {phase === 'wizard' && <WizardPhase notify={notify} onComplete={(event) => { previousEvent.current=event.id; setCurrentEvent(event.id); setPhase('outcomes') }} />}
        {phase === 'outcomes' && <OutcomeLauncher eventId={eventId} notify={notify} onContinue={() => setPhase('guide')} />}
        {phase === 'guide' && <PhaseOneGuide eventId={eventId} onChooseOutcomes={() => setPhase('outcomes')} onCreateEvent={() => setPhase('wizard')} />}
        {phase === 'audience' && <GuidedSetupPhaseTwo eventId={eventId} notify={notify} onBack={() => setPhase('guide')} />}
        {phase === 'experience' && <GuidedSetupPhaseThree eventId={eventId} notify={notify} onBack={() => setPhase('audience')} />}
        {phase === 'operations' && <GuidedSetupPhaseFour eventId={eventId} notify={notify} onBack={() => setPhase('experience')} />}
        {phase === 'live' && <GuidedSetupPhaseFive eventId={eventId} notify={notify} onBack={() => setPhase('operations')} />}
        {phase === 'closeout' && <GuidedSetupPhaseSix eventId={eventId} notify={notify} onBack={() => setPhase('live')} />}
      </div>
      {toast && <div className="rd-toast" style={toast.error ? { background: 'var(--danger)' } : undefined}><Icon name={toast.error ? 'info' : 'check'} />{toast.message}</div>}
    </RedesignShell>
  )
}
