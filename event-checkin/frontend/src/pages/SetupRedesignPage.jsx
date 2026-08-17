import { useEffect, useState } from 'react'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import { zonedWallTimeToUtcISOString } from '../timeutil'
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
  { id: 'festiome', label: 'FestioMe guest app', desc: 'Guest-side experience hub' },
  { id: 'experience', label: 'Experience program', desc: 'Session-based event content' },
  { id: 'selfcheckin', label: 'Self check-in kiosk', desc: 'Guests check themselves in' },
  { id: 'planner', label: 'Event planner', desc: 'Budget, vendors, milestones, and run of show' },
]

const GUIDED_STEPS = [
  {
    id: 'team', label: 'Invite your team',
    desc: 'Add co-hosts, event managers, and scanners.',
    fields: [
      { label: 'Team member email', placeholder: 'colleague@email.com', type: 'email' },
      { label: 'Role', type: 'select', options: ['Event manager', 'Scanner', 'Viewer'] },
    ],
  },
  {
    id: 'messaging', label: 'Set up messaging',
    desc: 'Choose the channels this event may use. Provider credentials remain controlled by platform settings.',
    fields: [
      { label: 'Delivery channels', type: 'select', options: ['Email only', 'Email + SMS', 'Email + WhatsApp', 'Email + SMS + WhatsApp'] },
    ],
  },
  {
    id: 'ticketing', label: 'Configure ticket sales',
    desc: 'Create ticket products, prices, sale windows, and payment settings.',
    fields: [], modes: ['ticketed', 'hybrid'], href: '/ticketing-redesign', linkLabel: 'Open ticket sales',
  },
  {
    id: 'rsvp', label: 'Create RSVP questions',
    desc: 'Collect custom answers from your guests on the RSVP form.',
    fields: [
      { label: 'Question', placeholder: 'e.g. Dietary preference?' },
      { label: 'Type', type: 'select', options: ['Short text', 'Multiple choice', 'Yes / No'] },
    ],
  },
  {
    id: 'planner', label: 'Build your event plan',
    desc: 'Generate countdown milestones for the budget, guest launch, vendors, run of show, and check-in.',
    fields: [], href: '/planner-redesign', linkLabel: 'Open planner',
  },
  {
    id: 'multiinvitee', label: 'Multi-invitee',
    desc: 'Let each guest bring additional guests (plus-ones).',
    fields: [
      { label: 'Max additional guests per invite', type: 'select', options: ['0 (disabled)', '1', '2', '3', '4', '5'] },
    ],
  },
  {
    id: 'tables', label: 'Set up tables',
    desc: 'Create table groups and assign seats.',
    fields: [
      { label: 'Number of tables', placeholder: '10', type: 'number' },
      { label: 'Seats per table', placeholder: '8', type: 'number' },
    ],
  },
  {
    id: 'menu', label: 'Add menu items',
    desc: 'Enter food / drink options for your guests to choose.',
    fields: [
      { label: 'Item name', placeholder: 'Jollof rice' },
      { label: 'Category', type: 'select', options: ['Main course', 'Starter', 'Dessert', 'Drink', 'Other'] },
    ],
  },
  {
    id: 'registry', label: 'Set up gift registry',
    desc: 'Add monetary contributions or physical gift items.',
    fields: [
      { label: 'Item name', placeholder: 'Kitchen appliance' },
      { label: 'Target amount (optional)', placeholder: '₦50,000', type: 'number' },
    ],
  },
  {
    id: 'logistics', label: 'Configure deliveries',
    desc: 'Add packing list categories for vendor shipments.',
    fields: [
      { label: 'Category', placeholder: 'Décor' },
      { label: 'Expected delivery date', type: 'date' },
    ],
  },
  {
    id: 'festiome', label: 'FestioMe guest app',
    desc: 'Enable the personalised in-app event experience for your guests. Welcome wording can then be edited in Design Studio.',
    fields: [],
  },
  {
    id: 'experience', label: 'Experience program',
    desc: 'Enable Experience, then build its workflow and program from the Experience page.',
    fields: [],
  },
  {
    id: 'review', label: 'Review & go live',
    desc: 'Check your setup summary and activate the event.',
    fields: [],
  },
]

function WizardPhase({ onComplete, notify }) {
  const [form, setForm] = useState({
    name: '', type: 'Conference / seminar', host: '', date: '', timezone: 'Africa/Lagos',
    attendanceMode: 'rsvp',
    multiDay: false, endDate: '', baseUrl: '', venue: '', venueAddress: '',
    guestCount: '', currency: 'NGN — Nigerian Naira',
    channels: new Set(['email']), features: new Set(['rsvp', 'planner']),
  })
  const [recommendation, setRecommendation] = useState(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
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
            <input className="rd-field" type="number" value={form.guestCount} placeholder="500" onChange={(e) => setForm({ ...form, guestCount: e.target.value })} />
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
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="rd-field-label">App base URL</label>
            <input className="rd-field" value={form.baseUrl} placeholder="wc2026" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
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
            let event = null
            try {
              event = await api.createEvent({
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

function GuidedSetupPhase({ eventId, notify, onEventUnavailable }) {
  const [event, setEvent] = useState(null)
  const [states, setStates] = useState(() =>
    Object.fromEntries(GUIDED_STEPS.map((s) => [s.id, 'pending']))
  )
  const [open, setOpen] = useState('team')
  const [fieldVals, setFieldVals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function loadProgress() {
    if (!eventId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api.getSetupProgress(eventId)
      setStates((prev) => ({ ...prev, ...(result.steps || {}) }))
    } catch (e) {
      // A stale eventId left in localStorage from a previous account/org (see
      // useCurrentEvent.js) 404s here rather than loading — send the user back
      // to step 1 instead of stranding them on a "Try again" that can never work.
      if (e.status === 404) {
        onEventUnavailable()
        return
      }
      setError(e.message || 'Setup progress could not be loaded')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProgress()
    if (eventId) api.listEvents().then((events) => setEvent(events.find((row) => row.id === eventId) || null)).catch(() => setEvent(null))
  }, [eventId])

  const mode = event?.attendance_mode || 'rsvp'
  const steps = GUIDED_STEPS.filter((step) => !step.modes || step.modes.includes(mode)).filter((step) => {
    if (step.id === 'rsvp') return ['rsvp', 'hybrid'].includes(mode)
    if (step.id === 'multiinvitee') return ['rsvp', 'hybrid'].includes(mode)
    return true
  })

  function setStepState(id, state) {
    setStates((prev) => ({ ...prev, [id]: state }))
  }

  async function saveStepConfiguration(stepId) {
    const value = (index) => fieldVals[`${stepId}-${index}`] || ''
    if (stepId === 'team') {
      if (!value(0)) throw new Error('Enter a team member email')
      const account = await api.checkTeamEmail(value(0))
      if (!account.exists && !window.confirm(`${value(0)} does not have a Festio account yet. Create and send the team invitation anyway?`)) return false
      const selectedRole = value(1) || 'Viewer'
      const orgMember = await api.inviteOrgMember(eventId, { email: value(0), role: selectedRole === 'Event manager' ? 'admin' : 'staff' })
      await api.assignMember(eventId, orgMember.user.id)
      if (selectedRole === 'Event manager') {
        await api.updateMemberPermissions(eventId, orgMember.user.id, { event_role: 'manager', access_level: 'edit' })
      } else {
        await api.updateMemberPermissions(eventId, orgMember.user.id, { event_role: 'staff', access_level: selectedRole === 'Viewer' ? 'view' : 'edit' })
      }
    } else if (stepId === 'messaging') {
      const selected = value(0) || 'Email only'
      await api.toggleFeatures(eventId, {
        notify_email: true,
        notify_sms: selected.includes('SMS'),
        notify_whatsapp: selected.includes('WhatsApp'),
      })
    } else if (stepId === 'rsvp') {
      if (!value(0)) throw new Error('Enter an RSVP question')
      const type = value(1) === 'Yes / No' ? 'boolean' : value(1) === 'Multiple choice' ? 'select' : 'text'
      await api.createRSVPQuestion(eventId, { question: value(0), question_type: type, is_required: false, sort_order: 0 })
    } else if (stepId === 'multiinvitee') {
      const limit = Number.parseInt(value(0), 10) || 0
      await api.updateInviteSettings(eventId, { rsvp_multi_invitee_enabled: limit > 0, rsvp_multi_invitee_limit: Math.max(1, limit || 1) })
    } else if (stepId === 'tables') {
      const count = Number.parseInt(value(0), 10)
      const capacity = Number.parseInt(value(1), 10)
      if (!count || !capacity) throw new Error('Enter the number of tables and seats per table')
      await api.bulkCreateTables(eventId, [{ group_name: 'Main tables', category: 'main', table_count: count, table_capacity: capacity }])
    } else if (stepId === 'menu') {
      if (!value(0)) throw new Error('Enter a menu item name')
      const category = await api.createMenuCategory(eventId, { name: value(1) || 'Other', selection_type: 'single', is_required: false, sort_order: 0 })
      await api.addMenuItem(eventId, category.id, { name: value(0), description: '' })
    } else if (stepId === 'registry') {
      if (!value(0)) throw new Error('Enter a registry item name')
      await api.createRegistryItem(eventId, { kind: value(1) ? 'fund' : 'item', title: value(0), amount_minor: value(1) ? Math.round(Number(value(1)) * 100) : null })
    } else if (stepId === 'logistics') {
      if (!value(0)) throw new Error('Enter a delivery category')
      await api.createShipment(eventId, { name: value(0), phase: 'pre', notes: value(1) ? `Expected delivery: ${value(1)}` : null })
    } else if (stepId === 'festiome') {
      await api.toggleFeatures(eventId, { festiome_addon_enabled: true })
    } else if (stepId === 'experience') {
      await api.toggleFeatures(eventId, { experience_enabled: true })
    } else if (stepId === 'ticketing') {
      const products = await api.ticketingProducts(eventId)
      if (!products.length) throw new Error('Create at least one ticket product before completing this step')
    } else if (stepId === 'planner') {
      await api.toggleFeatures(eventId, { planner_enabled: true })
      if (event) await api.plannerCreateStarterPlan(eventId, {
        event_name: event.name, event_type: event.event_type,
        attendance_mode: mode, event_date: event.event_date.slice(0, 10), venue_name: event.venue_name,
      })
    } else if (stepId === 'review') {
      await api.changeStatus(eventId, 'active')
    }
  }

  async function handleSave(stepId) {
    if (!eventId || busy) return
    setBusy(stepId)
    try {
      const saved = await saveStepConfiguration(stepId)
      if (saved === false) return
      await api.setSetupProgress(eventId, stepId, 'completed')
      setStepState(stepId, 'completed')
      notify(`${steps.find((s) => s.id === stepId)?.label || 'Step'} saved`)
      const idx = steps.findIndex((s) => s.id === stepId)
      const next = steps[idx + 1]
      if (next) setOpen(next.id)
    } catch (e) {
      notify(e.message || 'Setup step could not be saved', true)
    } finally {
      setBusy('')
    }
  }

  async function handleSkip(stepId) {
    if (!eventId || busy) return
    setBusy(stepId)
    try {
      await api.setSetupProgress(eventId, stepId, 'skipped')
      setStepState(stepId, 'skipped')
      const idx = steps.findIndex((s) => s.id === stepId)
      const next = steps[idx + 1]
      if (next) setOpen(next.id)
    } catch (e) {
      notify(e.message || 'Setup step could not be skipped', true)
    } finally {
      setBusy('')
    }
  }

  const completedCount = steps.filter((step) => states[step.id] === 'completed').length

  if (!eventId) return <div className="rr-panel"><div className="rd-panel-body">Create or select an event before starting guided setup.</div></div>
  if (loading) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={6} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={loadProgress} /></div></div>

  return (
    <div className="su-guided">
      <div className="su-guided-header">
        <div>
          <h2>Guided setup</h2>
          <p className="su-subtitle">{ATTENDANCE_MODES.find((item) => item.id === mode)?.label} workflow · {completedCount} of {steps.length} steps complete</p>
        </div>
        <div className="su-progress-bar-wrap">
          <div className="su-progress-bar" style={{ width: `${(completedCount / steps.length) * 100}%` }} />
        </div>
      </div>
      <div className="su-steps">
        {steps.map((step, i) => {
          const state = states[step.id]
          const isOpen = open === step.id
          return (
            <div key={step.id} className={`su-step${isOpen ? ' open' : ''}${state === 'completed' ? ' done' : ''}${state === 'skipped' ? ' skipped' : ''}`}>
              <button className="su-step-head" onClick={() => setOpen(isOpen ? null : step.id)}>
                <span className="su-step-num">
                  {state === 'completed' ? <Icon name="check" size={14} /> : state === 'skipped' ? '–' : i + 1}
                </span>
                <span className="su-step-label">{step.label}</span>
                <div className="su-step-badges">
                  {state === 'completed' && <span className="su-badge done">Completed</span>}
                  {state === 'skipped' && <span className="su-badge skipped">Skipped</span>}
                </div>
                <Icon name="chevrondown" size={16} className={`su-step-chevron${isOpen ? ' rotated' : ''}`} />
              </button>
              {isOpen && (
                <div className="su-step-body">
                  <p className="su-step-desc">{step.desc}</p>
                  {step.id === 'review' ? (
                    <div className="su-review">
                      <div className="su-review-grid">
                        {steps.filter((s) => s.id !== 'review').map((s) => (
                          <div key={s.id} className="su-review-row">
                            <span className={`su-review-icon ${states[s.id] === 'completed' ? 'done' : states[s.id] === 'skipped' ? 'skipped' : 'pending'}`}>
                              {states[s.id] === 'completed' ? '✅' : states[s.id] === 'skipped' ? '⏭' : '⏳'}
                            </span>
                            <strong>{s.label}</strong>
                            <span className="su-review-status">{states[s.id] === 'completed' ? 'Done' : states[s.id] === 'skipped' ? 'Skipped' : 'Pending'}</span>
                          </div>
                        ))}
                      </div>
                      <button className="rr-btn primary" style={{ marginTop: 16 }} onClick={() => handleSave('review')}>
                        {busy === 'review' ? 'Activating…' : 'Go live'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {step.fields.map((f, fi) => (
                        <div key={fi}>
                          <label className="rd-field-label">{f.label}</label>
                          {f.type === 'select' ? (
                            <select className="rd-field" value={fieldVals[`${step.id}-${fi}`] || ''} onChange={(e) => setFieldVals((p) => ({ ...p, [`${step.id}-${fi}`]: e.target.value }))}>
                              <option value="">Select…</option>
                              {(f.options || []).map((o) => <option key={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input className="rd-field" type={f.type || 'text'} placeholder={f.placeholder || ''} value={fieldVals[`${step.id}-${fi}`] || ''} onChange={(e) => setFieldVals((p) => ({ ...p, [`${step.id}-${fi}`]: e.target.value }))} />
                          )}
                        </div>
                      ))}
                      {step.href && <a className="rr-link-btn su-workspace-link" href={step.href}>{step.linkLabel} →</a>}
                      <div className="su-step-actions">
                        <button className="rr-btn primary" disabled={!!busy} onClick={() => handleSave(step.id)}>{busy === step.id ? 'Saving…' : 'Save & continue'}</button>
                        <button className="rr-btn secondary" disabled={!!busy} onClick={() => handleSkip(step.id)}>Skip</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function SetupRedesignPage() {
  const [phase, setPhase] = useState('wizard')
  const [eventId, setCurrentEvent] = useCurrentEvent()
  const [toast, setToast] = useState(null)

  function notify(message, error = false) {
    setToast({ message, error })
    window.setTimeout(() => setToast(null), 3000)
  }

  return (
    <RedesignShell topActive="setup">
      <div className="su-page">
        {/* Phase indicator */}
        <div className="su-phase-bar">
          <button className={`su-phase-btn${phase === 'wizard' ? ' active' : ''}`} onClick={() => setPhase('wizard')}>
            <span className="su-phase-num">1</span> Create event
          </button>
          <div className="su-phase-divider" />
          <button className={`su-phase-btn${phase === 'guided' ? ' active' : ''}`} onClick={() => setPhase('guided')}>
            <span className="su-phase-num">2</span> Guided setup
          </button>
        </div>

        {phase === 'wizard' && <WizardPhase notify={notify} onComplete={(event) => { setCurrentEvent(event.id); setPhase('guided') }} />}
        {phase === 'guided' && (
          <GuidedSetupPhase
            eventId={eventId}
            notify={notify}
            onEventUnavailable={() => {
              setCurrentEvent('')
              setPhase('wizard')
              notify("That event isn't available on this account — create a new one to continue.", true)
            }}
          />
        )}
      </div>
      {toast && <div className="rd-toast" style={toast.error ? { background: 'var(--danger)' } : undefined}><Icon name={toast.error ? 'info' : 'check'} />{toast.message}</div>}
    </RedesignShell>
  )
}
