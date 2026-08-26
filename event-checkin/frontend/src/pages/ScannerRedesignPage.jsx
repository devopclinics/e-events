import { useEffect, useState } from 'react'
import { api } from '../api'
import { seatingTerm } from '../seatingTerm'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import QrCameraScanner from '../components/QrCameraScanner'
import {
  drainExperienceQueue,
  drainOfflineAdmissions,
  enqueueExperienceStep,
  experienceQueueCount,
  loadOfflineManifest,
  offlineAdmissionCount,
  recordOfflineScan,
  saveOfflineManifest,
} from '../offlineExperienceQueue'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import './ScannerRedesignPage.css'

const MODES = [
  { id: 'camera', label: 'Camera / Scan' },
  { id: 'checkout', label: 'Check-out' },
  { id: 'manual', label: 'Manual search' },
  { id: 'eventqr', label: 'Event QR' },
]

function extractToken(raw) {
  try {
    const url = new URL(raw)
    return url.pathname.split('/').filter(Boolean).pop() || ''
  } catch {
    return String(raw || '').trim()
  }
}

function extractScanPayload(raw) {
  const value = String(raw || '').trim()
  const checkout = value.match(/^festio-checkout:(.+)$/i)
  if (checkout) return { token: extractToken(checkout[1]), action: 'checkout' }
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean)
    const checkoutIndex = parts.findIndex((part) => part.toLowerCase() === 'checkout')
    if (checkoutIndex >= 0 && parts[checkoutIndex + 1]) return { token: parts[checkoutIndex + 1], action: 'checkout' }
  } catch {
    // Plain pass tokens fall through.
  }
  return { token: extractToken(value), action: null }
}

function resultTone(result) {
  if (!result) return ''
  if (result.denied || result.status === 'denied' || result.status === 'invalid') return 'red'
  if (/already/.test(result.status || '')) return 'amber'
  if (result.status === 'offline_queued') return 'blue'
  return 'green'
}

function ResultCard({ result, onStepComplete, stepBusy }) {
  if (!result) return null
  const tone = resultTone(result)
  const guest = result.guest || {}
  const name = result.guest_name || [guest.first_name, guest.last_name].filter(Boolean).join(' ')
  return (
    <div className={`sc-result-card sc-tone-${tone}`} role="status" data-testid="scan-result">
      <div className="sc-result-icon"><Icon name={tone === 'green' ? 'check' : tone === 'amber' ? 'info' : 'shield'} size={28}/></div>
      <div className="sc-result-info">
        <strong>{result.denied ? 'Denied' : (result.status || 'Result').replaceAll('_', ' ')}</strong>
        <p>{result.message || (tone === 'green' ? 'The scan was recorded.' : 'The scan could not be completed.')}</p>
        {name && <div className="sc-result-guest">{name}</div>}
        {(result.table_name || result.seat_number) && (
          <div className="sc-result-guest">
            {result.table_name ? `Table ${result.table_name}` : 'No table'}
            {result.seat_number ? ` · Seat ${result.seat_number}` : ''}
          </div>
        )}
        {result.zone_name && <div className="sc-result-guest">{result.direction?.toUpperCase()} · {result.zone_name}</div>}
        {!!result.experience_next_steps?.length && (
          <div className="sc-experience-steps">
            <strong>Next Experience steps</strong>
            {result.experience_next_steps.map(({ step }) => {
              const completable = !['check_in', 'seating_assignment', 'meal_selection', 'consent'].includes(step.type)
              return (
                <div className="sc-experience-step" key={step.id}>
                  <span>{step.title}{step.required ? ' · Required' : ''}</span>
                  {completable && <button className="rr-btn secondary" disabled={stepBusy} onClick={() => onStepComplete(step)}>{stepBusy ? 'Saving…' : step.type === 'session_attendance' ? 'Check in' : 'Complete'}</button>}
                </div>
              )
            })}
          </div>
        )}
        {result.step_error && <div className="sc-empty">{result.step_error}</div>}
      </div>
    </div>
  )
}

function TokenScanner({ event, zones, gates, sections, mode, offlineManifest, onManifestChange, onQueueChange, onRefreshManifest, onResult }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [gateId, setGateId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [direction, setDirection] = useState('in')
  const [sectionId, setSectionId] = useState(sections.length === 1 ? sections[0].id : '')
  const accessMode = !!event?.venue_access_enabled

  useEffect(() => {
    if (sections.length === 1) setSectionId(sections[0].id)
    else if (!sections.some((section) => section.id === sectionId)) setSectionId('')
  }, [sections])

  async function recordScan(rawValue) {
    const { token: value, action } = extractScanPayload(rawValue)
    if (!value || busy) return
    setBusy(true); setError(''); onResult(null)
    try {
      let response
      const scanAction = action || (mode === 'checkout' ? 'checkout' : 'checkin')
      if (scanAction === 'checkout') {
        if (!navigator.onLine) throw new Error('Check-out needs a network connection so the exit scan can be recorded.')
        response = await api.scanCheckout(value)
      }
      else if (accessMode && gateId) response = await api.scanGate(event.id, gateId, value)
      else if (accessMode && zoneId) response = await api.scanZone(value, { zone_id: zoneId, direction })
      else if (accessMode) throw new Error('Select a gate or zone before scanning.')
      else {
        const section = sections.find((item) => item.id === sectionId)
        response = await api.scan(value, section ? { station: section.name, station_id: section.id } : undefined)
      }
      await onRefreshManifest()
      const manifestGuest = ((offlineManifest || loadOfflineManifest(event.id))?.guests || []).find((item) => item.qr_token === value)
      onResult({
        ...response,
        guest: response.guest || manifestGuest,
        denied: response.denied ?? response.allowed === false,
        guest_name: response.guest_name,
        deny_reason: response.deny_reason || (response.allowed === false ? response.message : undefined),
      })
      setToken('')
    } catch (err) {
      const networkFailure = !navigator.onLine || /failed to fetch|network|load failed/i.test(err.message || '')
      if (networkFailure && mode !== 'checkout' && action !== 'checkout') {
        const offline = recordOfflineScan({
          eventId: event.id,
          token: value,
          manifest: offlineManifest || loadOfflineManifest(event.id),
          mode: accessMode ? (gateId ? 'gate' : 'zone') : 'admission',
          gateId: gateId || null,
          zoneId: zoneId || null,
          direction,
        })
        if (offline.manifest) onManifestChange(offline.manifest)
        onQueueChange()
        onResult(offline.result)
        setToken('')
        return
      }
      const failed = { status: 'invalid', message: err.message || 'Scan failed' }
      setError(failed.message)
      onResult(failed)
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    await recordScan(token)
  }

  return (
    <form className="sc-camera-wrap" onSubmit={submit}>
      <div className="sc-camera-frame">
        <div className="sc-camera-corners"><span/><span/><span/><span/></div>
        <div className="sc-camera-placeholder">
          <p>{mode === 'checkout' ? 'Check-out scan' : 'Scan guest pass'}</p>
          <QrCameraScanner onScan={recordScan} disabled={busy || (accessMode && !gateId && !zoneId && mode !== 'checkout')} />
          <small>You can also paste a pass URL or token below.</small>
        </div>
      </div>
      {accessMode && mode !== 'checkout' && (
        <div className="sc-search-row sc-access-row">
          {gates.length > 0 && (
            <select className="sc-selector" aria-label="Gate" value={gateId} onChange={(e) => { setGateId(e.target.value); if (e.target.value) setZoneId('') }}>
              <option value="">Select gate</option>
              {gates.filter((gate) => gate.is_active !== false).map((gate) => <option key={gate.id} value={gate.id}>{gate.name}</option>)}
            </select>
          )}
          <select className="sc-selector" aria-label="Zone" value={zoneId} onChange={(e) => { setZoneId(e.target.value); if (e.target.value) setGateId('') }}>
            <option value="">Select zone</option>
            {zones.filter((zone) => zone.is_active !== false).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
          {zoneId && <select className="sc-selector" aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value)}><option value="in">In</option><option value="out">Out</option></select>}
        </div>
      )}
      {event.section_mode_enabled && sections.length > 1 && mode !== 'checkout' && (
        <select className="sc-selector" aria-label="Active section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Select section</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </select>
      )}
      <div className="sc-search-row sc-token-row">
        <input className="sc-search-input" aria-label="Pass token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Guest pass URL or QR token"/>
        <button className="rr-btn primary" disabled={!token.trim() || busy}>{busy ? 'Recording…' : mode === 'checkout' ? 'Check out' : 'Record scan'}</button>
      </div>
      {error && <p className="sc-empty">{error}</p>}
    </form>
  )
}

function ManualMode({ event, sections, onResult }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [walkin, setWalkin] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const [sectionId, setSectionId] = useState(sections.length === 1 ? sections[0].id : '')
  const [tableGroups, setTableGroups] = useState([])
  const [walkinGroupId, setWalkinGroupId] = useState('')
  const groupChoiceEnabled = !!event?.walk_in_group_choice_enabled && !event?.section_mode_enabled

  useEffect(() => {
    if (!event?.id || !groupChoiceEnabled) { setTableGroups([]); return }
    api.listTableGroups(event.id).then(setTableGroups).catch(() => setTableGroups([]))
  }, [event?.id, groupChoiceEnabled])

  useEffect(() => {
    setWalkinGroupId(event?.walk_in_table_group_id || '')
  }, [event?.walk_in_table_group_id])

  useEffect(() => {
    if (!event?.id || (!event.manual_checkin_enabled && !event.checkout_enabled) || query.trim().length < 2) { setResults([]); return }
    let active = true
    const timer = window.setTimeout(() => {
      api.searchGuests(event.id, query.trim())
        .then((items) => { if (active) { setResults(items); setError('') } })
        .catch((err) => { if (active) setError(err.message) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [event?.id, event?.manual_checkin_enabled, event?.checkout_enabled, query])

  async function checkin(guest) {
    setBusyId(`${guest.id}:checkin`); setError('')
    try {
      const response = await api.manualCheckin(event.id, guest.id, event.section_mode_enabled ? sectionId || null : null)
      onResult(response)
      setResults((items) => items.map((item) => item.id === guest.id ? { ...item, admitted: true } : item))
    } catch (err) { setError(err.message); onResult({ status: 'invalid', message: err.message }) }
    finally { setBusyId('') }
  }

  async function checkout(guest) {
    setBusyId(`${guest.id}:checkout`); setError('')
    try {
      const response = await api.manualCheckout(event.id, guest.id)
      onResult(response)
      if (response.status === 'checked_out' || response.status === 'already_checked_out') {
        setResults((items) => items.map((item) => item.id === guest.id ? { ...item, checked_out: true } : item))
      }
    } catch (err) { setError(err.message); onResult({ status: 'invalid', message: err.message }) }
    finally { setBusyId('') }
  }

  async function register(e) {
    e.preventDefault()
    setBusyId('walkin'); setError('')
    try {
      const response = await api.registerWalkIn(event.id, {
        ...form,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        table_group_id: event.section_mode_enabled ? (sectionId || null) : groupChoiceEnabled ? (walkinGroupId || null) : null,
      })
      onResult(response); setWalkin(false); setForm({ first_name: '', last_name: '', email: '', phone: '' })
    } catch (err) { setError(err.message); onResult({ status: 'invalid', message: err.message }) }
    finally { setBusyId('') }
  }

  if (!event?.manual_checkin_enabled && !event?.walk_in_enabled && !event?.checkout_enabled) {
    return <div className="sc-empty">Manual check-in, check-out, and walk-ins are disabled for this event.</div>
  }
  return (
    <div className="sc-manual">
      {event.section_mode_enabled && sections.length > 0 && (
        <select className="sc-selector" aria-label="Active section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Select section</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </select>
      )}
      {!walkin ? <>
        <div className="sc-search-row">
          <input className="sc-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone…"/>
          {event.walk_in_enabled && <button className="rr-btn primary" onClick={() => setWalkin(true)}><Icon name="plus" size={14}/> Walk-in</button>}
        </div>
        <div className="sc-guest-list">
          {results.map((guest) => <div key={guest.id} className="sc-guest-row">
            <div className="sc-guest-avatar">{guest.full_name?.[0] || '?'}</div>
            <div className="sc-guest-info"><strong>{guest.full_name}</strong><small>{guest.phone_masked || 'No phone'}{guest.table_name ? ` · ${guest.table_name}` : ''}</small></div>
            <div className="sc-guest-actions">
              {event.manual_checkin_enabled && (
                <button className="rr-btn primary" disabled={!!busyId} onClick={() => checkin(guest)}>
                  {busyId === `${guest.id}:checkin` ? 'Recording…' : guest.admitted ? 'Review' : 'Check in'}
                </button>
              )}
              {event.checkout_enabled && guest.admitted && (
                <button className="rr-btn secondary" disabled={!!busyId || guest.checked_out} onClick={() => checkout(guest)}>
                  {busyId === `${guest.id}:checkout` ? 'Recording…' : guest.checked_out ? 'Checked out' : 'Check out'}
                </button>
              )}
              {!event.manual_checkin_enabled && !guest.admitted && <span className="sc-guest-state">Not checked in</span>}
            </div>
          </div>)}
        </div>
      </> : <form className="sc-walkin-form" onSubmit={register}>
        <div className="sc-walkin-head"><button type="button" className="rr-btn secondary" onClick={() => setWalkin(false)}>← Back</button><strong>Register walk-in guest</strong></div>
        <label className="rd-field-label">First name *</label><input className="rd-field" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}/>
        <label className="rd-field-label">Last name</label><input className="rd-field" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}/>
        <label className="rd-field-label">Email</label><input className="rd-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/>
        <label className="rd-field-label">Phone</label><input className="rd-field" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}/>
        {groupChoiceEnabled && tableGroups.length > 0 && (
          <>
            <label className="rd-field-label">{seatingTerm(event)} group</label>
            <select className="rd-field" value={walkinGroupId} onChange={(e) => setWalkinGroupId(e.target.value)}>
              <option value="">— none (seat anywhere) —</option>
              {tableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </>
        )}
        <p className="sc-empty">Contact details are optional and saved to the guest record.</p>
        <button className="rr-btn primary" disabled={!form.first_name.trim() || busyId === 'walkin'}>{busyId === 'walkin' ? 'Registering…' : 'Register & check in'}</button>
      </form>}
      {error && <p className="sc-empty">{error}</p>}
    </div>
  )
}

function EventQRMode({ event }) {
  if (!event?.event_code) return <div className="sc-empty">Enable self check-in to generate an event QR code.</div>
  return <div className="sc-eventqr"><div className="sc-qr-placeholder">
    <img className="sc-qr-box" src={api.selfCheckinQrUrl(event.event_code)} alt="Event self check-in QR code"/>
    <p>{api.selfCheckinUrl(event.event_code, event)}</p>
  </div></div>
}

function ScannerCommandMockup({ event, online }) {
  const expected = Number(event?.guest_count || 0)
  const checkedIn = Number(event?.admitted_count || 0)
  const remaining = Math.max(expected - checkedIn, 0)
  const progress = expected ? Math.round((checkedIn / expected) * 100) : 0
  return (
    <div className="sc-command">
      <div className="sc-mockup-note">
        <span>Design preview</span>
        <p>This command-center concept is isolated from live scanning. Camera and action controls are intentionally disabled.</p>
        <a href="/scanner-redesign">Return to working scanner</a>
      </div>

      <section className="sc-command-hero">
        <div>
          <span className="sc-command-kicker">Live check-in command center</span>
          <h1>{event?.name || 'Selected event'}</h1>
          <p>One focused workspace for arrivals, access decisions, seating guidance, and operator handoff.</p>
        </div>
        <div className="sc-command-health">
          <span className={online ? 'online' : 'offline'}><i />{online ? 'Online' : 'Offline'}</span>
          <span><Icon name="users" size={13}/> Main entrance</span>
          <span><Icon name="clock" size={13}/> Synced just now</span>
        </div>
      </section>

      <div className="sc-command-metrics">
        <article><span>Expected</span><strong>{expected || '—'}</strong><small>Confirmed guest list</small></article>
        <article className="success"><span>Checked in</span><strong>{checkedIn || '—'}</strong><small>{progress}% of expected</small></article>
        <article><span>Remaining</span><strong>{expected ? remaining : '—'}</strong><small>Not yet arrived</small></article>
        <article className="accent"><span>Arrival pace</span><strong>18<small>/hr</small></strong><small>Last 30 minutes</small></article>
      </div>

      <div className="sc-command-tabs">
        <button className="active"><Icon name="ticket" size={14}/> Scan</button>
        <button><Icon name="search" size={14}/> Manual check-in</button>
        <button><Icon name="external" size={14}/> Check-out</button>
        <button><Icon name="ticket" size={14}/> Event QR</button>
      </div>

      <div className="sc-command-workspace">
        <section className="sc-command-panel sc-command-capture">
          <div className="sc-command-panel-head">
            <div><span>Camera station</span><strong>Ready to scan</strong></div>
            <button disabled><Icon name="settings" size={13}/> Station settings</button>
          </div>
          <div className="sc-command-camera">
            <div className="sc-command-reticle"><i/><i/><i/><i/></div>
            <Icon name="ticket" size={44}/>
            <strong>Place the guest QR inside the frame</strong>
            <span>Fast continuous scanning · duplicates are protected</span>
            <button disabled>Start camera</button>
          </div>
          <div className="sc-command-token">
            <Icon name="search" size={14}/>
            <input disabled placeholder="Paste pass URL or QR token" />
            <button disabled>Record scan</button>
          </div>
          <div className="sc-command-station">
            <label>Active lane<select disabled><option>Main entrance</option></select></label>
            <label>Operator<select disabled><option>DevOps Clinics</option></select></label>
            <button disabled><Icon name="settings" size={13}/> Flash</button>
          </div>
        </section>

        <aside className="sc-command-panel sc-command-arrival">
          <div className="sc-command-panel-head"><div><span>Latest arrival</span><strong>Guest guidance</strong></div><span className="sc-command-ready">Ready</span></div>
          <div className="sc-command-guest">
            <span className="sc-command-avatar">AY</span>
            <div><strong>Aminah Yusuf</strong><small>Confirmed guest · pass verified</small></div>
            <span className="sc-command-pass"><Icon name="check" size={14}/> Admitted</span>
          </div>
          <div className="sc-command-guidance">
            <div><Icon name="chair" size={16}/><span>Table assignment<strong>Esteemed Parents · Table 12</strong></span></div>
            <div><Icon name="users" size={16}/><span>Guest party<strong>2 guests · both arrived</strong></span></div>
            <div><Icon name="card" size={16}/><span>Meal note<strong>Standard menu</strong></span></div>
          </div>
          <div className="sc-command-next">
            <span>Next required action</span>
            <strong>Direct guest to Table 12</strong>
            <button disabled>Confirm handoff</button>
          </div>
        </aside>
      </div>

      <div className="sc-command-lower">
        <section className="sc-command-panel">
          <div className="sc-command-panel-head"><div><span>Live arrivals</span><strong>Recent activity</strong></div><button disabled>View attendance</button></div>
          {[
            ['Aminah Yusuf', 'Just now', 'Esteemed Parents · 12', 'Checked in'],
            ['Ibrahim AbdulWaheed', '2 min ago', 'Graduands Guests · 8', 'Checked in'],
            ['Maryam Fashola', '5 min ago', 'Esteemed Parents · 11', 'Checked in'],
          ].map((row) => <div className="sc-command-activity" key={row[0]}><span>{row[0][0]}</span><div><strong>{row[0]}</strong><small>{row[2]}</small></div><time>{row[1]}</time><b>{row[3]}</b></div>)}
        </section>
        <section className="sc-command-panel">
          <div className="sc-command-panel-head"><div><span>Station health</span><strong>Operations</strong></div></div>
          <div className="sc-command-ops">
            <div><span>Camera permission</span><strong className="ok">Ready</strong></div>
            <div><span>Offline manifest</span><strong>236 passes</strong></div>
            <div><span>Pending sync</span><strong className="ok">0 actions</strong></div>
            <div><span>Duplicate protection</span><strong className="ok">On</strong></div>
          </div>
        </section>
      </div>
    </div>
  )
}

function CommandResultPanel({ result, onStepComplete, stepBusy }) {
  const tone = resultTone(result)
  const guest = result?.guest || {}
  const name = result?.guest_name || [guest.first_name, guest.last_name].filter(Boolean).join(' ')
  const initials = name ? name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : '?'
  const status = result ? (result.denied ? 'Denied' : (result.status || 'Result').replaceAll('_', ' ')) : ''
  const nextSteps = result?.experience_next_steps || []
  const requiredSteps = nextSteps.filter(({ step }) => step.required)
  const optionalSteps = nextSteps.filter(({ step }) => !step.required)

  return (
    <aside className="sc-command-panel sc-command-arrival" data-testid={result ? 'scan-result' : undefined} role={result ? 'status' : undefined}>
      <div className="sc-command-panel-head">
        <div><span>Latest scan</span><strong>Guest guidance</strong></div>
        <span className={`sc-command-ready sc-command-ready-${tone || 'idle'}`}>{result ? status : 'Waiting'}</span>
      </div>
      {!result ? (
        <div className="sc-command-result-empty">
          <Icon name="ticket" size={30}/>
          <strong>Ready for the next guest</strong>
          <p>Scan a pass or use manual check-in. The admission decision and guest directions will appear here.</p>
        </div>
      ) : (
        <>
          <div className={`sc-command-guest sc-command-guest-${tone}`}>
            <span className="sc-command-avatar">{initials}</span>
            <div>
              <span className={`sc-command-status-headline sc-command-status-${tone}`}><Icon name={tone === 'green' ? 'check' : tone === 'red' ? 'shield' : 'info'} size={13}/>{status}</span>
              <strong>{name || 'Unknown guest'}</strong>
              <small>{result.message || 'The scan was processed.'}</small>
            </div>
          </div>
          <div className="sc-command-guidance">
            {(result.table_name || result.seat_number) && <div><Icon name="chair" size={16}/><span>Seating assignment<strong>{result.table_name ? `Table ${result.table_name}` : 'Table not assigned'}{result.seat_number ? ` · Seat ${result.seat_number}` : ''}</strong></span></div>}
            {result.zone_name && <div><Icon name="external" size={16}/><span>Access decision<strong>{result.direction?.toUpperCase()} · {result.zone_name}</strong></span></div>}
            {result.deny_reason && <div><Icon name="shield" size={16}/><span>Reason<strong>{result.deny_reason}</strong></span></div>}
          </div>
          {requiredSteps.length > 0 && (
            <div className="sc-command-next">
              <span>Next required action</span>
              {requiredSteps.map(({ step }) => {
                const completable = !['check_in', 'seating_assignment', 'meal_selection', 'consent'].includes(step.type)
                return (
                  <div className="sc-command-next-step" key={step.id}>
                    <strong>{step.title} · Required</strong>
                    {completable && <button disabled={stepBusy} onClick={() => onStepComplete(step)}>{stepBusy ? 'Saving…' : step.type === 'session_attendance' ? 'Check in' : 'Complete'}</button>}
                  </div>
                )
              })}
            </div>
          )}
          {optionalSteps.length > 0 && (
            <div className="sc-command-next sc-command-next-optional">
              <span>Program sessions (optional)</span>
              {optionalSteps.map(({ step }) => {
                const completable = !['check_in', 'seating_assignment', 'meal_selection', 'consent'].includes(step.type)
                return (
                  <div className="sc-command-next-step" key={step.id}>
                    <strong>{step.title}</strong>
                    {completable && <button disabled={stepBusy} onClick={() => onStepComplete(step)}>{stepBusy ? 'Saving…' : step.type === 'session_attendance' ? 'Check in' : 'Complete'}</button>}
                  </div>
                )
              })}
            </div>
          )}
          {result.step_error && <p className="sc-command-result-error">{result.step_error}</p>}
        </>
      )}
    </aside>
  )
}

function LiveScannerCommandCenter({
  event, attendance, online, mode, setMode, result, zones, gates, sections, offlineManifest,
  queuedAdmissions, queuedActions, recentResults, stepBusy, onManifestChange,
  onQueueChange, onRefreshManifest, onResult, onStepComplete,
}) {
  const expected = Number(attendance?.expected || 0)
  const checkedIn = Number(attendance?.checked_in || 0)
  const remaining = Math.max(expected - checkedIn, 0)
  const progress = expected ? Math.round((checkedIn / expected) * 100) : 0
  const pendingSync = queuedAdmissions + queuedActions
  const manifestCount = Number(offlineManifest?.guests?.length || 0)
  const modeMeta = {
    camera: ['Camera station', 'Ready to scan'],
    checkout: ['Exit station', 'Ready to check out'],
    manual: ['Guest lookup', 'Manual check-in'],
    eventqr: ['Self check-in', 'Event QR'],
  }[mode]

  return (
    <div className="sc-command sc-command-live">
      <section className="sc-command-hero">
        <div>
          <span className="sc-command-kicker">Live check-in command center</span>
          <h1>{event?.name || 'Selected event'}</h1>
          <p>One focused workspace for arrivals, access decisions, seating guidance, and operator handoff.</p>
        </div>
        <div className="sc-command-health">
          <span className={online ? 'online' : 'offline'}><i />{online ? 'Online' : 'Offline'}</span>
          <span><Icon name="users" size={13}/> Scanner station</span>
          <span><Icon name="clock" size={13}/>{pendingSync ? `${pendingSync} pending sync` : 'Fully synced'}</span>
        </div>
      </section>

      {event?.status !== 'active' && <div className="sc-command-alert">Scanning is available only while this event is active.</div>}

      <div className="sc-command-metrics">
        <article><span>Expected</span><strong>{expected || '—'}</strong><small>Confirmed guest list</small></article>
        <article className="success"><span>Checked in</span><strong>{checkedIn || '—'}</strong><small>{progress}% of expected</small></article>
        <article><span>Remaining</span><strong>{expected ? remaining : '—'}</strong><small>Not yet arrived</small></article>
        <article className="accent"><span>Pending sync</span><strong>{pendingSync}</strong><small>{online ? 'Queued station actions' : 'Will sync when online'}</small></article>
      </div>

      <div className="sc-command-tabs" aria-label="Scanner modes">
        {MODES.map((item) => (
          <button key={item.id} type="button" aria-pressed={mode === item.id} aria-label={item.label} className={mode === item.id ? 'active' : ''} onClick={() => { setMode(item.id); onResult(null) }}>
            <Icon name={item.id === 'manual' ? 'search' : item.id === 'checkout' ? 'external' : 'ticket'} size={14}/>
            {item.id === 'camera' ? 'Scan' : item.label}
          </button>
        ))}
      </div>

      <div className="sc-command-workspace">
        <section className={`sc-command-panel sc-command-capture sc-command-mode-${mode}`}>
          <div className="sc-command-panel-head">
            <div><span>{modeMeta[0]}</span><strong>{modeMeta[1]}</strong></div>
            <a href="/checkin-redesign"><Icon name="settings" size={13}/> Station settings</a>
          </div>
          <div className="sc-command-mode-body">
            {(mode === 'camera' || mode === 'checkout') && <TokenScanner event={event} zones={zones} gates={gates} sections={sections} mode={mode} offlineManifest={offlineManifest} onManifestChange={onManifestChange} onQueueChange={onQueueChange} onRefreshManifest={onRefreshManifest} onResult={onResult}/>}
            {mode === 'manual' && <ManualMode event={event} sections={sections} onResult={onResult}/>}
            {mode === 'eventqr' && <EventQRMode event={event}/>}
          </div>
        </section>

        <CommandResultPanel result={result} onStepComplete={onStepComplete} stepBusy={stepBusy}/>
      </div>

      <div className="sc-command-lower">
        <section className="sc-command-panel">
          <div className="sc-command-panel-head"><div><span>This station session</span><strong>Recent activity</strong></div><a href="/event-results-redesign?tab=attendance">View attendance</a></div>
          {recentResults.length ? recentResults.map((item) => {
            const itemGuest = item.guest || {}
            const itemName = item.guest_name || [itemGuest.first_name, itemGuest.last_name].filter(Boolean).join(' ') || 'Guest'
            const nameParts = itemName.split(/\s+/).filter(Boolean)
            const activityName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts.at(-1)[0]}.` : itemName
            return <div className="sc-command-activity" key={item.sessionKey} aria-label={`${itemName}, ${String(item.status || 'processed').replaceAll('_', ' ')}`}><span>{itemName[0]}</span><div><strong>{activityName}</strong><small>{item.table_name || item.zone_name || item.message || 'Admission processed'}</small></div><time>{item.recordedAt}</time><b>{String(item.status || 'processed').replaceAll('_', ' ')}</b></div>
          }) : <div className="sc-command-activity-empty">Completed scans from this station will appear here.</div>}
        </section>
        <section className="sc-command-panel">
          <div className="sc-command-panel-head"><div><span>Station health</span><strong>Operations</strong></div></div>
          <div className="sc-command-ops">
            <div><span>Network</span><strong className={online ? 'ok' : ''}>{online ? 'Online' : 'Offline queue active'}</strong></div>
            <div><span>Offline manifest</span><strong>{manifestCount ? `${manifestCount} passes` : 'Not cached'}</strong></div>
            <div><span>Pending sync</span><strong className={pendingSync ? '' : 'ok'}>{pendingSync} actions</strong></div>
            <div><span>Duplicate protection</span><strong className="ok">On</strong></div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default function ScannerRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event, error: eventError, refresh: refreshEvent } = useEventDetails(eventId)
  const [mode, setMode] = useState('camera')
  const [result, setResult] = useState(null)
  const [zones, setZones] = useState([])
  const [gates, setGates] = useState([])
  const [sections, setSections] = useState([])
  const [loadError, setLoadError] = useState('')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [offlineManifest, setOfflineManifest] = useState(() => eventId ? loadOfflineManifest(eventId) : null)
  const [queuedAdmissions, setQueuedAdmissions] = useState(() => offlineAdmissionCount())
  const [queuedActions, setQueuedActions] = useState(() => experienceQueueCount())
  const [stepBusy, setStepBusy] = useState(false)
  const [recentResults, setRecentResults] = useState([])
  const [attendance, setAttendance] = useState(null)

  useEffect(() => {
    if (!event?.id) return
    if (event.venue_access_enabled) Promise.all([api.listZones(event.id), api.listGates(event.id)]).then(([nextZones, nextGates]) => { setZones(nextZones); setGates(nextGates) }).catch((err) => setLoadError(err.message))
    if (event.section_mode_enabled) api.myEventSections(event.id).then((data) => setSections(data.sections || [])).catch(() => setSections([]))
  }, [event?.id, event?.venue_access_enabled, event?.section_mode_enabled])

  // Expected/checked-in/on-site counts for the header tiles — same composite
  // endpoint the Results command-center uses. Refreshed on a timer (not just
  // after a local scan) since other stations' scans move these numbers too.
  useEffect(() => {
    if (!event?.id) return
    let cancelled = false
    function load() {
      api.resultsCommandCenter(event.id).then((data) => { if (!cancelled) setAttendance(data.attendance || null) }).catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [event?.id, result])

  async function refreshOfflineManifest() {
    if (!eventId || !navigator.onLine) return
    try {
      const manifest = await api.offlineManifest(eventId)
      saveOfflineManifest(eventId, manifest)
      setOfflineManifest(manifest)
    } catch {
      setOfflineManifest(loadOfflineManifest(eventId))
    }
  }

  useEffect(() => {
    if (!eventId) { setOfflineManifest(null); return }
    setOfflineManifest(loadOfflineManifest(eventId))
    if (event?.status === 'active') refreshOfflineManifest()
  }, [eventId, event?.status])

  useEffect(() => {
    async function drainQueues() {
      setOnline(navigator.onLine)
      if (!navigator.onLine) return
      const [steps, admissions] = await Promise.all([drainExperienceQueue(api), drainOfflineAdmissions(api)])
      setQueuedActions(steps.remaining)
      setQueuedAdmissions(admissions.remaining)
      if (admissions.sent) await refreshOfflineManifest()
    }
    function markOffline() { setOnline(false) }
    function updateCounts() {
      setQueuedActions(experienceQueueCount())
      setQueuedAdmissions(offlineAdmissionCount())
    }
    window.addEventListener('online', drainQueues)
    window.addEventListener('offline', markOffline)
    window.addEventListener('experience-queue-change', updateCounts)
    window.addEventListener('offline-admission-change', updateCounts)
    drainQueues()
    return () => {
      window.removeEventListener('online', drainQueues)
      window.removeEventListener('offline', markOffline)
      window.removeEventListener('experience-queue-change', updateCounts)
      window.removeEventListener('offline-admission-change', updateCounts)
    }
  }, [eventId])

  async function handleResult(nextResult) {
    if (!nextResult) { setResult(null); return }
    if (nextResult.guest?.id && !nextResult.denied && nextResult.status !== 'invalid') void refreshEvent()
    const resultEventId = nextResult.guest?.event_id || eventId
    if (resultEventId && nextResult.guest?.id && !nextResult.experience_next_steps) {
      const nextSteps = await api.getExperienceNextSteps(resultEventId, nextResult.guest.id).catch(() => [])
      const completeResult = { ...nextResult, experience_next_steps: nextSteps }
      setResult(completeResult)
      rememberResult(completeResult)
      return
    }
    setResult(nextResult)
    rememberResult(nextResult)
  }

  function rememberResult(nextResult) {
    const guest = nextResult?.guest || {}
    const name = nextResult?.guest_name || [guest.first_name, guest.last_name].filter(Boolean).join(' ')
    if (!name) return
    const recordedAt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())
    setRecentResults((items) => [{ ...nextResult, recordedAt, sessionKey: `${Date.now()}-${Math.random()}` }, ...items].slice(0, 5))
  }

  async function completeExperienceStep(step) {
    const resultEventId = result?.guest?.event_id || eventId
    if (!resultEventId || !result?.guest?.id || !step?.id || stepBusy) return
    const payload = {
      status: 'completed',
      metadata: { source: 'scanner', ...(step.type === 'session_attendance' ? { action: 'session_check_in' } : {}) },
    }
    setStepBusy(true)
    try {
      await api.updateGuestExperienceStep(resultEventId, result.guest.id, step.id, payload)
      const nextSteps = await api.getExperienceNextSteps(resultEventId, result.guest.id)
      setResult((current) => current ? { ...current, experience_next_steps: nextSteps, step_error: '' } : current)
    } catch (error) {
      if (!navigator.onLine || /failed to fetch|network|load failed/i.test(error.message || '')) {
        enqueueExperienceStep({
          eventId: resultEventId,
          guestId: result.guest.id,
          stepId: step.id,
          payload,
        })
        setQueuedActions(experienceQueueCount())
        setResult((current) => current ? {
          ...current,
          message: `${current.message || 'Scan recorded.'} Experience step queued for sync.`,
          experience_next_steps: (current.experience_next_steps || []).filter((item) => item.step.id !== step.id),
        } : current)
      } else {
        setResult((current) => current ? { ...current, step_error: error.message || 'Experience step could not be completed' } : current)
      }
    } finally {
      setStepBusy(false)
    }
  }

  const commandMockup = new URLSearchParams(window.location.search).get('mockup') === 'command'
  if (commandMockup) {
    return <RedesignShell topActive="checkin" eventScoped><ScannerCommandMockup event={event} online={online}/></RedesignShell>
  }
  return (
    <RedesignShell topActive="checkin" eventScoped>
      <div className="sc-page">
        {!eventId ? <div className="sc-empty">Select an event before scanning.</div> : (loadError || eventError) ? <div className="sc-empty">{loadError || eventError}</div> : !event ? <div className="sc-empty">Loading scanner configuration…</div> : (
          <LiveScannerCommandCenter
            event={event}
            attendance={attendance}
            online={online}
            mode={mode}
            setMode={setMode}
            result={result}
            zones={zones}
            gates={gates}
            sections={sections}
            offlineManifest={offlineManifest}
            queuedAdmissions={queuedAdmissions}
            queuedActions={queuedActions}
            recentResults={recentResults}
            stepBusy={stepBusy}
            onManifestChange={setOfflineManifest}
            onQueueChange={() => setQueuedAdmissions(offlineAdmissionCount())}
            onRefreshManifest={refreshOfflineManifest}
            onResult={handleResult}
            onStepComplete={completeExperienceStep}
          />
        )}
      </div>
    </RedesignShell>
  )
}
