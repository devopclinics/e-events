import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ConfirmDialog } from './redesign/RedesignShell'
import { LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import './AdminRedesignPage.css'

const RESET_OPTIONS = [
  { key: 'guests', label: 'Guests', hint: 'Removes all guest records' },
  { key: 'checkins', label: 'Check-ins', hint: 'Marks all guests as not arrived' },
  { key: 'seat_assignments', label: 'Seat assignments', hint: 'Unassigns all seats' },
  { key: 'group_assignments', label: 'Table-group tags', hint: 'Removes per-guest group overrides' },
  { key: 'table_groups', label: 'Table groups', hint: 'Deletes all table group definitions' },
  { key: 'tables', label: 'Tables', hint: 'Removes all table and seat definitions' },
]

const TIMEZONES_SHORT = ['Africa/Lagos', 'Africa/Nairobi', 'Europe/London', 'America/New_York']
const EVENT_TYPES_SHORT = ['Conference', 'Gala / Award', 'Wedding', 'Birthday', 'Other']

// Mirrors OnboardingChecklist's real required/optional step logic
// (AdminPage.jsx:8720-8730) — same fields, same completion rules.
function deriveJourneySteps(event, stats) {
  if (!event || !stats) return { required: [], optional: [] }
  return {
    required: [
      { label: 'Create your event', done: true },
      { label: 'Import your guests', hint: 'Upload a spreadsheet, connect Google Sheets, or download the template to fill in.', done: stats.total > 0 },
      { label: 'Turn on the RSVP form', hint: 'Let guests confirm or decline straight from their invite.', done: !!event.rsvp_enabled },
      { label: 'Send invitations', hint: 'Email, SMS, or WhatsApp each guest their personal pass.', done: stats.invited > 0 },
      { label: 'Enable check-in with an Event Pass', hint: 'Activate door scanning by choosing an Event Pass.', done: !!event.is_paid },
    ],
    optional: [
      { label: 'Turn on your event extras', done: !!(event.seating_enabled || event.menu_enabled || event.logistics_enabled || event.registry_enabled || event.venue_access_enabled) },
    ],
  }
}

const STEP_ROUTE = {
  'Import your guests': '/guests-redesign',
  'Turn on the RSVP form': '/guests-redesign?tab=invite',
  'Send invitations': '/guests-redesign?tab=invite',
  'Enable check-in with an Event Pass': '/billing-redesign?tab=billing',
  'Turn on your event extras': '/addons-redesign',
}

const STATUS_OPTIONS = ['Draft', 'Active', 'Ended']
const STATUS_HELP = {
  Draft: 'Only you can see this event. Guests can\'t RSVP or receive invites yet.',
  Active: 'Live — invites, RSVP, and check-in are all working normally.',
  Ended: 'Check-in is closed. Guests can still view their pass and RSVP history.',
}

function JourneyIllustration() {
  return (
    <svg viewBox="0 0 200 160" className="rr-illust" aria-hidden="true">
      <path d="M20 130c30-40 130-40 160 0" className="rr-illust-leaf-a"/>
      <path d="M0 110c40-30 60 10 20 20" className="rr-illust-leaf-b"/>
      <path d="M200 100c-40-25-55 12-18 22" className="rr-illust-leaf-b"/>
      <g transform="translate(48,38)">
        <rect x="0" y="14" width="104" height="72" rx="10" className="rr-illust-env-back"/>
        <path d="M0 24 52 58 104 24" className="rr-illust-env-flap"/>
        <circle cx="80" cy="16" r="17" className="rr-illust-badge"/>
        <path d="m72 16 5 5 10-11" className="rr-illust-badge-check"/>
      </g>
      <circle cx="26" cy="34" r="2.5" className="rr-illust-spark"/>
      <circle cx="168" cy="46" r="2" className="rr-illust-spark"/>
      <circle cx="150" cy="20" r="1.6" className="rr-illust-spark"/>
    </svg>
  )
}

function HealthRing({ pct = 0 }) {
  return (
    <div className="rr-ring" aria-label={`Event setup ${pct}% complete`}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" className="rr-ring-track"/>
        <circle cx="60" cy="60" r="50" className="rr-ring-value" style={{ strokeDasharray: `${pct * 3.14} 314` }}/>
      </svg>
      <div><strong>{pct}%</strong></div>
    </div>
  )
}

export default function AdminRedesignPage() {
  const navigate = useNavigate()
  const [toast, setToast] = useState('')
  const [status, setStatus] = useState('Active')
  const [statusOpen, setStatusOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState('')
  const [statusWorking, setStatusWorking] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [checklistOpen, setChecklistOpen] = useState(true)
  const [qrBusy, setQrBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const importFileRef = useRef(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceInterval, setSourceInterval] = useState(60)
  const [sourceSaveBusy, setSourceSaveBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncResult, setSyncResult] = useState('')
  const [checklistDismissed, setChecklistDismissed] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [eventMutationBusy, setEventMutationBusy] = useState(false)
  const [eventForm, setEventForm] = useState({
    name: '',
    type: 'Conference', host: '',
    date: '', timezone: 'Africa/Lagos',
    multiDay: false, endDate: '', baseUrl: '',
    venue: '', venueAddress: '',
    admissionNote: '', description: '',
  })
  const manageRef = useRef(null)

  const [currentEventId, setCurrentEventId] = useCurrentEvent()
  const { user } = useAuth()
  const { event, setEvent, refresh: refreshEvent } = useEventDetails(currentEventId)
  const [guests, setGuests] = useState(null)
  const [tasks, setTasks] = useState(null)

  useEffect(() => {
    if (!currentEventId) { setGuests(null); setTasks(null); return }
    let cancelled = false
    api.listGuests(currentEventId).then((g) => { if (!cancelled) setGuests(g) }).catch(() => { if (!cancelled) setGuests([]) })
    api.listTasks(currentEventId).then((t) => { if (!cancelled) setTasks(t) }).catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [currentEventId])

  // Same formula as AdminPage.jsx:10048's `stats` object.
  const stats = guests ? {
    total: guests.length,
    qr: guests.filter((g) => g.qr_generated_at).length,
    invited: guests.filter((g) => g.invite_sent_at).length,
    admitted: guests.filter((g) => g.admitted).length,
    declined: guests.filter((g) => g.rsvp_status === 'declined').length,
  } : null

  const { required: journeySteps, optional: optionalSteps } = deriveJourneySteps(event, stats)
  const healthPct = journeySteps.length ? Math.round((journeySteps.filter((s) => s.done).length / journeySteps.length) * 100) : 0
  const tasksRemaining = tasks ? tasks.filter((t) => t.status !== 'done').length : null
  const tasksOverdue = tasks ? tasks.filter((t) => t.status !== 'done' && t.overdue).length : null

  useEffect(() => {
    if (event?.status) setStatus(event.status.charAt(0).toUpperCase() + event.status.slice(1))
  }, [event?.status])

  useEffect(() => {
    setSourceUrl(event?.source_url || '')
    setSourceInterval(event?.source_sync_interval_seconds || 60)
  }, [event?.id, event?.source_url, event?.source_sync_interval_seconds])

  function notify(message, isError = false) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
    if (isError) console.error(message)
  }

  function openEditEvent() {
    if (!event) return
    setEventForm({
      name: event.name || '',
      type: event.event_type || 'Other',
      host: event.couples_name || '',
      date: String(event.event_date || '').slice(0, 16),
      timezone: event.timezone || 'Africa/Lagos',
      multiDay: !!event.event_end_date,
      endDate: String(event.event_end_date || '').slice(0, 16),
      baseUrl: event.checkin_base_url || '',
      venue: event.venue_name || '',
      venueAddress: event.venue_address || '',
      admissionNote: event.admission_note || '',
      description: event.description || '',
    })
    setManageOpen(false)
    setEditOpen(true)
  }

  async function saveEventDetails() {
    if (!event?.id || eventMutationBusy) return
    setEventMutationBusy(true)
    try {
      const updated = await api.updateEvent(event.id, {
        name: eventForm.name.trim(),
        event_type: eventForm.type,
        couples_name: eventForm.host.trim(),
        event_date: eventForm.date,
        event_end_date: eventForm.multiDay && eventForm.endDate ? eventForm.endDate : null,
        timezone: eventForm.timezone,
        checkin_base_url: eventForm.baseUrl.trim(),
        venue_name: eventForm.venue.trim() || null,
        venue_address: eventForm.venueAddress.trim() || null,
        admission_note: eventForm.admissionNote.trim() || null,
        description: eventForm.description.trim() || null,
      })
      setEvent(updated)
      setEditOpen(false)
      notify('Event details saved')
    } catch (error) {
      notify(error.message || 'Event details could not be saved', true)
    } finally {
      setEventMutationBusy(false)
    }
  }

  async function confirmStatusChange() {
    if (!event?.id || !pendingStatus) return
    const next = pendingStatus.toLowerCase()
    setStatusWorking(true)
    setStatusError('')
    try {
      // event.updated_at was captured when this event was last (re)loaded, so
      // a stale lifecycle change — e.g. this screen left open while another
      // operator already moved the event to a different status — is rejected
      // by the server instead of silently applied over their change.
      const updated = await api.changeStatus(event.id, next, event.updated_at)
      setEvent(updated)
      setStatus(updated.status.charAt(0).toUpperCase() + updated.status.slice(1))
      setPendingStatus('')
      notify(`Event status set to ${updated.status}`)
    } catch (error) {
      if (error.status === 409) {
        await refreshEvent()
        setPendingStatus('')
        notify('Changed by another operator — refreshed to the current status.', true)
      } else {
        setStatusError(error.message || 'Could not update event status')
      }
    } finally {
      setStatusWorking(false)
    }
  }

  async function handleImportFile(file) {
    if (!file || !event?.id) return
    setImportBusy(true)
    try {
      const result = await api.uploadGuests(event.id, file)
      setGuests(await api.listGuests(event.id))
      notify(`${result.added ?? result.imported ?? 0} guest${(result.added ?? result.imported) === 1 ? '' : 's'} imported`)
    } catch (e) { notify(e.message || 'Import failed', true) }
    finally { setImportBusy(false); if (importFileRef.current) importFileRef.current.value = '' }
  }

  async function saveSource(nextUrl, nextInterval) {
    if (!event?.id) return
    setSourceSaveBusy(true)
    try {
      const updated = await api.updateSource(event.id, { source_url: nextUrl, source_sync_interval_seconds: Number(nextInterval) || 60 })
      setEvent(updated)
      notify(nextUrl ? 'Spreadsheet link saved' : 'Spreadsheet link cleared')
    } catch (e) { notify(e.message || 'Spreadsheet link could not be saved', true) }
    finally { setSourceSaveBusy(false) }
  }

  async function toggleSourceSync(enabled) {
    if (!event?.id) return
    try {
      const updated = await api.updateSource(event.id, { source_sync_enabled: enabled })
      setEvent(updated)
      notify(enabled ? 'Sync turned on' : 'Sync paused — the spreadsheet will not be polled')
    } catch (e) { notify(e.message || 'Sync could not be updated', true) }
  }

  async function syncSourceNow() {
    if (!event?.id) return
    setSyncBusy(true)
    try {
      const result = await api.syncNow(event.id)
      setGuests(await api.listGuests(event.id))
      await refreshEvent()
      setSyncResult(`+${result.added} new`)
      notify(`Synced: ${result.added} added, ${result.skipped} skipped`)
    } catch (e) { notify(e.message || 'Sync failed', true) }
    finally { setSyncBusy(false) }
  }

  const currentStep = journeySteps.find((s) => !s.done)
  const messagingSummary = guests ? {
    sent: guests.filter((guest) => !!guest.invite_sent_at).length,
    failed: guests.filter((guest) => guest.invite_status === 'failed').length,
    unsent: guests.filter((guest) => !guest.invite_sent_at).length,
    noContact: guests.filter((guest) => !guest.email && !guest.phone).length,
  } : null

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive="overview">
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row">
            <h1>{event?.name || (currentEventId ? 'Loading…' : 'No event selected')}</h1>
            <div className="rr-status-wrap">
              <button className={`rr-pill ${status === 'Active' ? 'live' : status === 'Ended' ? 'locked' : ''}`} onClick={() => setStatusOpen((v) => !v)}>
                <i/> {status} <Icon name="chevrondown" size={11}/>
              </button>
              {statusOpen && (
                <div className="rr-status-menu">
                  {STATUS_OPTIONS.map((s) => (
                    <button key={s} className={s === status ? 'active' : ''} disabled={statusWorking || s === status}
                      onClick={() => { setPendingStatus(s); setStatusOpen(false) }}>
                      <strong>{s}</strong><span>{STATUS_HELP[s]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="rr-meta"><Icon name="calendar" size={13}/> {event?.event_date ? new Date(event.event_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} {event?.venue_name && <><span className="rr-dot">·</span> <Icon name="grid" size={13}/> {event.venue_name}</>}</div>
        </div>
        <div className="rr-head-actions">
          <button className="rr-btn secondary" onClick={() => navigate('/setup-redesign')}><Icon name="plus" size={14}/> New event</button>
          <button className="rr-btn secondary" disabled={!event?.id}
            onClick={() => navigate(`/invite/${event.id}`)}><Icon name="eye" size={15}/> Preview event</button>
          <div style={{ position: 'relative' }} ref={manageRef}>
            <button className="rr-btn primary" onClick={() => setManageOpen((v) => !v)}>Manage event <Icon name="chevrondown" size={14}/></button>
            {manageOpen && (
              <div className="rr-manage-menu" onMouseLeave={() => setManageOpen(false)}>
                <button onClick={openEditEvent}><Icon name="settings" size={13}/> Edit event details</button>
                <button onClick={() => { setManageOpen(false); setStatusOpen(true) }}><Icon name="check" size={13}/> Change status</button>
                {user?.is_platform_superadmin && <button onClick={() => { setManageOpen(false); setResetOpen(true) }} className="danger"><Icon name="arrow" size={13}/> Reset event data</button>}
                <button onClick={() => { setManageOpen(false); setDeleteOpen(true) }} className="danger"><Icon name="more" size={13}/> Delete event</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {statusError && <div role="alert" className="rr-credit-warning">{statusError}</div>}
      {pendingStatus && (
        <ConfirmDialog
          title={`Set event to ${pendingStatus}?`}
          message={STATUS_HELP[pendingStatus]}
          confirmLabel={statusWorking ? 'Updating…' : `Set ${pendingStatus}`}
          onConfirm={confirmStatusChange}
          onCancel={() => setPendingStatus('')}
        />
      )}

      {event && event.message_credits < 100 && (
        <div className="rr-credit-warning">
          <Icon name="info" size={14}/> Message credits are low — <b>{event.message_credits} left</b>. Sends may pause once you run out. <button onClick={() => navigate('/billing-redesign?tab=billing')}>Top up in Billing <Icon name="arrow" size={12}/></button>
        </div>
      )}

      <div className="rr-top-grid">
        <div className="rr-panel rr-journey">
          <div className="rr-journey-head">
            <div>
              <h2>Your event journey</h2>
              <p>{journeySteps.filter((s) => s.done).length} of {journeySteps.length} required steps complete</p>
            </div>
            {checklistOpen
              ? <button className="rr-link-btn" onClick={() => { setChecklistOpen(false); notify('Checklist hidden — reopen from Manage event') }}>Hide</button>
              : <button className="rr-link-btn" onClick={() => setChecklistOpen(true)}>Show</button>}
          </div>

          {checklistOpen && <>
          <div className="rr-journey-dots">
            {journeySteps.map((s, i) => (
              <div className="rr-jdot-wrap" key={s.label}>
                <div className={`rr-jdot ${s.done ? 'done' : ''} ${s === currentStep ? 'current' : ''}`}>{s.done ? <Icon name="check" size={12}/> : i + 1}</div>
                {i < journeySteps.length - 1 && <div className={`rr-jline ${s.done ? 'done' : ''}`}/>}
              </div>
            ))}
          </div>

          {currentStep && (
            <div className="rr-nextstep">
              <div className="rr-nextstep-text">
                <span className="rr-eyebrow">✨ Next best step</span>
                <h3>{currentStep.label}</h3>
                {currentStep.hint && <p>{currentStep.hint}</p>}
                <button className="rr-btn primary" onClick={() => STEP_ROUTE[currentStep.label] ? navigate(STEP_ROUTE[currentStep.label]) : notify(`${currentStep.label} — opened`)}>Continue <Icon name="arrow" size={14}/></button>
              </div>
              <JourneyIllustration/>
            </div>
          )}

          <div className="rr-steps-row">
            {journeySteps.map((s) => (
              <div className={`rr-step ${s === currentStep ? 'current' : ''}`} key={s.label}>
                <span className={`rr-step-status ${s.done ? 'done' : ''}`}>{s.done ? <Icon name="check" size={11}/> : ''}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="rr-optional-head">Optional</div>
          <div className="rr-steps-row rr-steps-row-optional">
            {optionalSteps.map((s) => (
              <div className="rr-step" key={s.label}>
                <span className={`rr-step-status ${s.done ? 'done' : ''}`}>{s.done ? <Icon name="check" size={11}/> : ''}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          </>}
        </div>

        <div className="rr-panel rr-health">
          <div className="rr-health-head"><h2>Setup progress</h2><Icon name="info" size={13}/></div>
          <HealthRing pct={healthPct}/>
          <p>{healthPct === 100 ? <strong>Your event is fully set up.</strong> : <><strong>{journeySteps.length - journeySteps.filter((s) => s.done).length} step(s) remaining.</strong> Finish these to get your event fully ready.</>}</p>
          <button className="rr-link-btn" onClick={() => setChecklistOpen(true)}>View health checklist <Icon name="arrow" size={13}/></button>
        </div>
      </div>

      <div className="rr-panel rr-guestbar">
        {stats ? (<>
          <div className="rr-guestbar-head"><h2>{stats.total} Guests</h2><span>{stats.admitted} Admitted ({stats.total ? Math.round((stats.admitted / stats.total) * 100) : 0}%)</span></div>
          <div className="rr-guestbar-track"><i style={{ width: `${stats.total ? Math.round((stats.admitted / stats.total) * 100) : 0}%` }}/></div>
          <div className="rr-guestbar-stats">
            <div><strong>{stats.qr}</strong><span>QR Generated</span></div>
            <div className="teal"><strong>{stats.admitted}</strong><span>Admitted</span></div>
            <div><strong>{stats.invited}</strong><span>Invited <Icon name="info" size={11}/></span></div>
            <div className="red"><strong>{stats.declined}</strong><span>Declined</span></div>
          </div>
        </>) : <LoadingSkeleton rows={2} variant="card" />}
      </div>

      <div className="rr-quick-grid">
        <div className="rr-panel rr-quick">
          <div className="rr-quick-head"><span className="rr-quick-icon teal"><Icon name="users" size={16}/></span><h3>Guests</h3></div>
          <div className="rr-quick-big">{stats ? stats.total : '—'}<small>Total guests</small></div>
          <div className="rr-quick-sub teal">{stats ? `${stats.admitted} admitted (${stats.total ? Math.round((stats.admitted / stats.total) * 100) : 0}%)` : ''}</div>
          <div className="rr-quick-actions-row">
            <button onClick={() => navigate('/guests-redesign')}>Manage guests <Icon name="arrow" size={13}/></button>
            <button disabled={qrBusy || !event?.id} onClick={async () => {
              setQrBusy(true)
              try {
                const result = await api.generateQR(event.id)
                setGuests(await api.listGuests(event.id))
                notify(`${result.generated} QR code${result.generated === 1 ? '' : 's'} generated`)
              } catch (e) { notify(e.message || 'QR codes could not be generated', true) }
              finally { setQrBusy(false) }
            }}>{qrBusy ? 'Generating…' : 'Generate QR codes'}</button>
          </div>
        </div>
        <div className="rr-panel rr-quick highlight">
          <div className="rr-quick-head"><span className="rr-quick-icon amber"><Icon name="send" size={16}/></span><h3>Invitations</h3></div>
          <div className="rr-quick-big">{stats ? stats.invited : '—'}<small>Invitation{stats?.invited === 1 ? '' : 's'} sent</small></div>
          <div className="rr-quick-sub amber">{stats ? `${stats.total - stats.invited} Not sent yet` : ''}</div>
          <button onClick={() => navigate('/guests-redesign?tab=invite')}>Send more invites <Icon name="arrow" size={13}/></button>
        </div>
        <div className="rr-panel rr-quick">
          <div className="rr-quick-head"><span className="rr-quick-icon teal"><Icon name="ticket" size={16}/></span><h3>Check-in ready</h3></div>
          <div className="rr-checklist">
            <div className={event?.is_paid ? 'ok' : 'warn'}><Icon name={event?.is_paid ? 'check' : 'info'} size={12}/> {event?.is_paid ? 'Scanning enabled' : 'Scanning not enabled — choose an Event Pass'}</div>
            <div className={event?.is_paid ? 'ok' : 'warn'}><Icon name={event?.is_paid ? 'check' : 'info'} size={12}/> {event?.is_paid ? 'Event Pass ready' : 'No Event Pass yet'}</div>
            <div className={event?.rsvp_enabled ? 'ok' : 'warn'}><Icon name={event?.rsvp_enabled ? 'check' : 'info'} size={12}/> {event?.rsvp_enabled ? 'RSVP form enabled' : 'RSVP form not enabled'}</div>
          </div>
          <button onClick={() => navigate(!event?.is_paid ? '/billing-redesign?tab=billing' : !event?.rsvp_enabled ? '/guests-redesign?tab=invite' : '/scanner-redesign')}>Review setup <Icon name="arrow" size={13}/></button>
        </div>
        <div className="rr-panel rr-quick">
          <div className="rr-quick-head"><span className="rr-quick-icon teal"><Icon name="team" size={16}/></span><h3>Team tasks</h3></div>
          <div className="rr-quick-big">{tasksRemaining ?? '—'}<small>Tasks remaining</small></div>
          <div className="rr-quick-sub amber">{tasksOverdue ? `${tasksOverdue} Overdue` : ''}</div>
          <button onClick={() => navigate('/team-redesign?tab=tasks')}>View tasks <Icon name="arrow" size={13}/></button>
        </div>
      </div>

      <div className="rr-section-title">
        <div><h2>Messaging</h2><p>Invitation state from the current guest records</p></div>
        <div className="rr-head-actions">
          <button onClick={() => navigate('/guests-redesign?tab=invites')}>Manage invitations <Icon name="arrow" size={13}/></button>
          <button onClick={() => navigate('/communications-redesign?tab=broadcast')}>Open communications <Icon name="arrow" size={15}/></button>
        </div>
      </div>

      <div className="rd-channels">
        {[
          ['Sent', messagingSummary?.sent],
          ['Not sent', messagingSummary?.unsent],
          ['Failed', messagingSummary?.failed],
          ['No contact', messagingSummary?.noContact],
        ].map(([label, value]) => (
          <div className="rd-chan" key={label}>
            <div className="top"><span className="name">{label.toUpperCase()}</span></div>
            <div className="rate">{value ?? '—'}</div>
            <div className="foot"><span>guest records</span></div>
          </div>
        ))}
      </div>

      <div className="rr-section-title">
        <div><h2>Guest data</h2><p>Three ways to get guests in — pick what fits your workflow</p></div>
      </div>

      <div className="rd-panel" style={{ maxWidth: 620 }}>
        <div className="rd-panel-body" style={{ paddingTop: 16 }}>

          <details className="rd-path">
            <summary>
              <span className="rd-path-icon"><Icon name="upload" size={14}/></span>
              <span style={{ flex: 1 }}>
                <span className="rd-path-title">Upload a file</span>
                <div className="rd-path-sub">One-time — CSV, Excel, or the template</div>
              </span>
            </summary>
            <div className="rd-path-body">
              <div className="rd-path-body-inner">
                <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => handleImportFile(e.target.files?.[0])}/>
                <div className="rd-row2" style={{ marginBottom: 9 }}>
                  <button className="rr-btn secondary" disabled={importBusy || !event?.id} style={{ flex: 1, justifyContent: 'center', height: 34 }} onClick={() => importFileRef.current?.click()}>{importBusy ? 'Importing…' : 'Choose file'}</button>
                  <button className="rr-btn secondary" style={{ justifyContent: 'center', height: 34 }} onClick={() => api.downloadGuestTemplate(event.id, 'xlsx').catch((e) => notify(e.message || 'Template download failed', true))}>Get template</button>
                </div>
                <div className="rd-format-row"><span className="rd-fmt">.CSV</span><span className="rd-fmt">.XLSX</span><span className="rd-fmt">.XLS</span></div>
                <div className="rd-hint" style={{ marginTop: 8 }}>Needs first_name, last_name — email and phone optional.</div>
              </div>
            </div>
          </details>

          <details className="rd-path" open={!!event?.source_url}>
            <summary>
              <span className="rd-path-icon"><Icon name="cloud" size={14}/></span>
              <span style={{ flex: 1 }}>
                <span className="rd-path-title">Live spreadsheet sync</span>
                <div className="rd-path-sub">Checks the link and adds new guests automatically</div>
              </span>
              <span className="rd-path-badge">{event?.source_url ? (event?.source_sync_enabled !== false ? `On · every ${event.source_sync_interval_seconds || 60}s` : 'Paused') : 'Not connected'}</span>
            </summary>
            <div className="rd-path-body">
              <div className="rd-path-body-inner">
                <label className="rd-field-label">Share link</label>
                <input className="rd-field" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…"/>
                <div className="rd-format-row" style={{ margin: '-2px 0 11px' }}>
                  <span className="rd-fmt">Google Sheets</span><span className="rd-fmt">OneDrive</span><span className="rd-fmt">SharePoint</span><span className="rd-fmt">Dropbox</span>
                </div>
                <div className="rd-toggle-row">
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Sync on</span>
                  <label className="rd-switch"><input type="checkbox" checked={event?.source_sync_enabled !== false} onChange={(e) => toggleSourceSync(e.target.checked)}/><span className="track"/><span className="knob"/></label>
                </div>
                <div className="rd-row2">
                  <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center', height: 34 }}
                    disabled={sourceUrl.trim() === (event?.source_url || '') && Number(sourceInterval) === (event?.source_sync_interval_seconds || 60)}
                    onClick={() => saveSource(sourceUrl.trim(), sourceInterval)}>{sourceSaveBusy ? 'Saving…' : 'Save link'}</button>
                  <button className="rr-btn secondary" style={{ justifyContent: 'center', height: 34 }} disabled={syncBusy || !event?.source_url || event?.source_sync_enabled === false} onClick={syncSourceNow}>{syncBusy ? 'Syncing…' : 'Sync now'}</button>
                  {event?.source_url && <button className="rr-btn secondary" style={{ justifyContent: 'center', height: 34 }} onClick={() => { setSourceUrl(''); saveSource('', sourceInterval) }}>Clear link</button>}
                </div>
                {event?.source_url && (
                  <div className="rd-synclog">
                    <span>Last synced <b style={{ color: 'var(--ink)' }}>{event.source_last_sync_at ? new Date(event.source_last_sync_at).toLocaleString() : 'never'}</b></span>
                    {syncResult && <span style={{ color: 'var(--success)' }}>{syncResult}</span>}
                  </div>
                )}
                {event?.source_last_error && <div className="rd-hint" style={{ color: 'var(--danger)' }}>{event.source_last_error}</div>}
              </div>
            </div>
          </details>

          <details className="rd-path">
            <summary>
              <span className="rd-path-icon"><Icon name="api" size={14}/></span>
              <span style={{ flex: 1 }}>
                <span className="rd-path-title">Connect via API</span>
                <div className="rd-path-sub">Push from your own database or CRM</div>
              </span>
            </summary>
            <div className="rd-path-body">
              <div className="rd-path-body-inner">
                <div className="rd-hint">
                  Create a key in <b style={{ color: 'var(--ink)' }}>Org Settings → API Keys</b>, then <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>POST</code> guests straight from wherever they already live.
                </div>
                <div className="rd-row2" style={{ marginTop: 11 }}>
                  <a className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center', height: 34, textDecoration: 'none' }} href="/api-docs" target="_blank" rel="noreferrer">View API docs</a>
                  <a className="rr-btn secondary" style={{ justifyContent: 'center', height: 34, textDecoration: 'none' }} href="/org-settings" target="_blank" rel="noreferrer">Manage keys</a>
                </div>
              </div>
            </div>
          </details>

        </div>
      </div>

      {toast && <div className="rd-toast"><Icon name="check"/>{toast}</div>}

      {/* Edit event modal */}
      {editOpen && (
        <Modal title="Edit event details" onClose={() => setEditOpen(false)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">Event name *</label><input className="rd-field" value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} /></div>
              <div><label className="rd-field-label">Type</label><select className="rd-field" value={eventForm.type} onChange={(e) => setEventForm({ ...eventForm, type: e.target.value })}>{EVENT_TYPES_SHORT.map((t) => <option key={t}>{t}</option>)}</select></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">Host</label><input className="rd-field" value={eventForm.host} onChange={(e) => setEventForm({ ...eventForm, host: e.target.value })} /></div>
              <div><label className="rd-field-label">App base URL</label><input className="rd-field" value={eventForm.baseUrl} onChange={(e) => setEventForm({ ...eventForm, baseUrl: e.target.value })} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">Date &amp; time *</label><input className="rd-field" type="datetime-local" value={eventForm.date} onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })} /></div>
              <div><label className="rd-field-label">Timezone</label><select className="rd-field" value={eventForm.timezone} onChange={(e) => setEventForm({ ...eventForm, timezone: e.target.value })}>{[...new Set([...TIMEZONES_SHORT, eventForm.timezone])].map((t) => <option key={t}>{t}</option>)}</select></div>
            </div>
            <label className="gr-required-check"><input type="checkbox" checked={eventForm.multiDay} onChange={(e) => setEventForm({ ...eventForm, multiDay: e.target.checked })} /> Multi-day event</label>
            {eventForm.multiDay && <div><label className="rd-field-label">End date &amp; time</label><input className="rd-field" type="datetime-local" value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })} /></div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">Venue</label><input className="rd-field" value={eventForm.venue} onChange={(e) => setEventForm({ ...eventForm, venue: e.target.value })} /></div>
              <div><label className="rd-field-label">Venue address</label><input className="rd-field" value={eventForm.venueAddress} onChange={(e) => setEventForm({ ...eventForm, venueAddress: e.target.value })} /></div>
            </div>
            <div><label className="rd-field-label">Admission note</label><input className="rd-field" value={eventForm.admissionNote} onChange={(e) => setEventForm({ ...eventForm, admissionNote: e.target.value })} /></div>
            <div><label className="rd-field-label">Description</label><textarea className="rd-field" rows="3" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></div>
            <div className="rd-row2" style={{ marginTop: 4 }}>
              <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="rr-btn primary" disabled={eventMutationBusy || !eventForm.name.trim() || !eventForm.date || !eventForm.timezone} style={{ flex: 1, justifyContent: 'center' }} onClick={saveEventDetails}>{eventMutationBusy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset event dialog */}
      {resetOpen && (
        <ConfirmDialog
          title="Reset event data"
          message="Choose what to reset. This cannot be undone."
          danger
          confirmLabel="Reset selected"
          requireTypedWord="RESET"
          checklist={RESET_OPTIONS.map((o) => ({ key: o.key, label: o.label, hint: o.hint }))}
          onConfirm={async (selected) => {
            setEventMutationBusy(true)
            try {
              const flags = Object.fromEntries(selected.map((key) => [key, true]))
              const result = await api.adminResetEvent(event.id, flags)
              setResetOpen(false)
              await Promise.all([refreshEvent(), api.listGuests(event.id).then(setGuests), api.listTasks(event.id).then(setTasks)])
              notify(`Event data reset${result?.cleared ? `: ${Object.keys(result.cleared).join(', ') || 'nothing to clear'}` : ''}`)
            } catch (error) { notify(error.message || 'Event data could not be reset', true) }
            finally { setEventMutationBusy(false) }
          }}
          onCancel={() => setResetOpen(false)}
        />
      )}

      {/* Delete event dialog */}
      {deleteOpen && (
        <ConfirmDialog
          title="Delete event"
          message="This will permanently delete the event and all its data. This cannot be undone."
          danger
          confirmLabel="Delete event"
          requireTypedWord="DELETE"
          onConfirm={async () => {
            setEventMutationBusy(true)
            try {
              await api.deleteEvent(event.id)
              setDeleteOpen(false)
              setCurrentEventId('')
              navigate('/admin-redesign')
            } catch (error) { notify(error.message || 'Event could not be deleted', true) }
            finally { setEventMutationBusy(false) }
          }}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </RedesignShell>
  )
}
