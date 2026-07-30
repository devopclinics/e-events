import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
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
        <div className="sc-search-row">
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
      <div className="sc-search-row">
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
        table_group_id: event.section_mode_enabled ? sectionId || null : null,
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

export default function ScannerRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event, error: eventError } = useEventDetails(eventId)
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

  useEffect(() => {
    if (!event?.id) return
    if (event.venue_access_enabled) Promise.all([api.listZones(event.id), api.listGates(event.id)]).then(([nextZones, nextGates]) => { setZones(nextZones); setGates(nextGates) }).catch((err) => setLoadError(err.message))
    if (event.section_mode_enabled) api.myEventSections(event.id).then((data) => setSections(data.sections || [])).catch(() => setSections([]))
  }, [event?.id, event?.venue_access_enabled, event?.section_mode_enabled])

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
    const resultEventId = nextResult.guest?.event_id || eventId
    if (resultEventId && nextResult.guest?.id && !nextResult.experience_next_steps) {
      const nextSteps = await api.getExperienceNextSteps(resultEventId, nextResult.guest.id).catch(() => [])
      setResult({ ...nextResult, experience_next_steps: nextSteps })
      return
    }
    setResult(nextResult)
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

  const stats = useMemo(() => ({ expected: event?.guest_count ?? '—', checkedIn: event?.admitted_count ?? '—' }), [event])
  return (
    <RedesignShell topActive="checkin" eventScoped>
      <div className="sc-page">
        <div className="sc-header"><div className="sc-header-left"><h2>Scanner</h2><div className={`sc-online-badge ${online ? 'online' : 'offline'}`}><span className="sc-online-dot"/> {online ? 'Online · server confirmed' : 'Offline mode · scans queue locally'}</div></div></div>
        {(queuedAdmissions > 0 || queuedActions > 0) && <div className="sc-empty" role="status">{queuedAdmissions > 0 ? `${queuedAdmissions} scan${queuedAdmissions === 1 ? '' : 's'} pending sync` : ''}{queuedAdmissions > 0 && queuedActions > 0 ? ' · ' : ''}{queuedActions > 0 ? `${queuedActions} Experience action${queuedActions === 1 ? '' : 's'} pending sync` : ''}</div>}
        {!eventId ? <div className="sc-empty">Select an event before scanning.</div> : (loadError || eventError) ? <div className="sc-empty">{loadError || eventError}</div> : !event ? <div className="sc-empty">Loading scanner configuration…</div> : <>
          {event?.status !== 'active' && event && <div className="sc-empty">Scanning is available only while this event is active.</div>}
          <div className="sc-tabs">{MODES.map((item) => <button key={item.id} className={`sc-tab${mode === item.id ? ' active' : ''}`} onClick={() => { setMode(item.id); setResult(null) }}>{item.label}</button>)}</div>
          <div className="sc-content">
            {(mode === 'camera' || mode === 'checkout') && <TokenScanner event={event} zones={zones} gates={gates} sections={sections} mode={mode} offlineManifest={offlineManifest} onManifestChange={setOfflineManifest} onQueueChange={() => setQueuedAdmissions(offlineAdmissionCount())} onRefreshManifest={refreshOfflineManifest} onResult={handleResult}/>}
            {mode === 'manual' && <ManualMode event={event} sections={sections} onResult={handleResult}/>}
            {mode === 'eventqr' && <EventQRMode event={event}/>}
            <ResultCard result={result} onStepComplete={completeExperienceStep} stepBusy={stepBusy}/>
          </div>
          <div className="sc-stats"><div className="sc-stat"><strong>{stats.expected}</strong><small>Expected</small></div><div className="sc-stat sc-tone-green"><strong>{stats.checkedIn}</strong><small>Checked in</small></div><div className="sc-stat"><strong>{event?.name || 'Loading…'}</strong><small>Event</small></div></div>
        </>}
      </div>
    </RedesignShell>
  )
}
