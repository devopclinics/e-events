import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import QrCameraScanner from '../components/QrCameraScanner'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import './ScannerRedesignPage.css'

const MODES = [
  { id: 'camera', label: 'Camera / Scan' },
  { id: 'checkout', label: 'Check-out' },
  { id: 'manual', label: 'Manual search' },
  { id: 'eventqr', label: 'Event QR' },
]

function resultTone(result) {
  if (!result) return ''
  if (result.denied || result.status === 'denied' || result.status === 'invalid') return 'red'
  if (/already/.test(result.status || '')) return 'amber'
  if (result.status === 'offline_queued') return 'blue'
  return 'green'
}

function ResultCard({ result }) {
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
      </div>
    </div>
  )
}

function TokenScanner({ event, zones, gates, mode, onResult }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [gateId, setGateId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [direction, setDirection] = useState('in')
  const accessMode = !!event?.venue_access_enabled

  async function recordScan(rawValue) {
    const value = rawValue.trim().split('/').filter(Boolean).pop()
    if (!value || busy) return
    setBusy(true); setError(''); onResult(null)
    try {
      let response
      if (mode === 'checkout') response = await api.scanCheckout(value)
      else if (accessMode && gateId) response = await api.scanGate(event.id, gateId, value)
      else if (accessMode && zoneId) response = await api.scanZone(value, { zone_id: zoneId, direction })
      else if (accessMode) throw new Error('Select a gate or zone before scanning.')
      else response = await api.scan(value)
      onResult({
        ...response,
        denied: response.denied ?? response.allowed === false,
        guest_name: response.guest_name,
        deny_reason: response.deny_reason || (response.allowed === false ? response.message : undefined),
      })
      setToken('')
    } catch (err) {
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

  useEffect(() => {
    if (!event?.id) return
    if (event.venue_access_enabled) Promise.all([api.listZones(event.id), api.listGates(event.id)]).then(([nextZones, nextGates]) => { setZones(nextZones); setGates(nextGates) }).catch((err) => setLoadError(err.message))
    if (event.section_mode_enabled) api.myEventSections(event.id).then((data) => setSections(data.sections || [])).catch(() => setSections([]))
  }, [event?.id, event?.venue_access_enabled, event?.section_mode_enabled])

  const stats = useMemo(() => ({ expected: event?.guest_count ?? '—', checkedIn: event?.admitted_count ?? '—' }), [event])
  return (
    <RedesignShell topActive="checkin">
      <div className="sc-page">
        <div className="sc-header"><div className="sc-header-left"><h2>Scanner</h2><div className="sc-online-badge online"><span className="sc-online-dot"/> Online · server confirmed</div></div></div>
        {!eventId ? <div className="sc-empty">Select an event before scanning.</div> : (loadError || eventError) ? <div className="sc-empty">{loadError || eventError}</div> : !event ? <div className="sc-empty">Loading scanner configuration…</div> : <>
          {event?.status !== 'active' && event && <div className="sc-empty">Scanning is available only while this event is active.</div>}
          <div className="sc-tabs">{MODES.map((item) => <button key={item.id} className={`sc-tab${mode === item.id ? ' active' : ''}`} onClick={() => { setMode(item.id); setResult(null) }}>{item.label}</button>)}</div>
          <div className="sc-content">
            {(mode === 'camera' || mode === 'checkout') && <TokenScanner event={event} zones={zones} gates={gates} mode={mode} onResult={setResult}/>}
            {mode === 'manual' && <ManualMode event={event} sections={sections} onResult={setResult}/>}
            {mode === 'eventqr' && <EventQRMode event={event}/>}
            <ResultCard result={result}/>
          </div>
          <div className="sc-stats"><div className="sc-stat"><strong>{stats.expected}</strong><small>Expected</small></div><div className="sc-stat sc-tone-green"><strong>{stats.checkedIn}</strong><small>Checked in</small></div><div className="sc-stat"><strong>{event?.name || 'Loading…'}</strong><small>Event</small></div></div>
        </>}
      </div>
    </RedesignShell>
  )
}
