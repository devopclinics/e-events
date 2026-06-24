import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

function ZoneResultCard({ result, onReset }) {
  const denied = result.denied || result.status === 'invalid'
  const cfg = result.status === 'invalid'
    ? { bg: 'bg-red-500', icon: '✕', heading: 'INVALID' }
    : denied
      ? { bg: 'bg-red-500', icon: '🚫', heading: 'ACCESS DENIED' }
      : result.direction === 'out'
        ? { bg: 'bg-slate-600', icon: '←', heading: 'EXIT RECORDED' }
        : { bg: 'bg-green-500', icon: '✓', heading: 'ENTRY ALLOWED' }
  return (
    <div className="text-center">
      <div className={`${cfg.bg} text-white rounded-xl py-6 px-4`}>
        <div className="text-5xl mb-2">{cfg.icon}</div>
        <div className="text-xl font-extrabold tracking-wide">{cfg.heading}</div>
        {result.guest_name && <div className="mt-2 text-lg font-semibold">{result.guest_name}</div>}
        {result.ticket_type && <div className="text-sm opacity-90 mt-0.5">{result.ticket_type}</div>}
        {result.zone_name && <div className="text-sm opacity-90 mt-1">{result.zone_name}</div>}
        {result.deny_reason && <div className="text-sm mt-2 bg-black/20 rounded px-2 py-1 inline-block">{result.deny_reason}</div>}
        {result.message && !result.guest_name && <div className="text-sm mt-2">{result.message}</div>}
        {!denied && result.occupancy != null && <div className="text-xs opacity-90 mt-2">Now inside this zone: {result.occupancy}</div>}
      </div>
      <button onClick={onReset} className="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700">Check in next guest</button>
    </div>
  )
}

function ResultCard({ result, onReset }) {
  const cfg = {
    admitted:        { bg: 'bg-green-500',  icon: '✓', heading: 'ADMITTED' },
    already_admitted:{ bg: 'bg-amber-500',  icon: '⚠', heading: 'ALREADY ADMITTED' },
    invalid:         { bg: 'bg-red-500',    icon: '✕', heading: 'NOT FOUND' },
    not_active:      { bg: 'bg-slate-600',  icon: '⏸', heading: 'EVENT NOT ACTIVE' },
    not_assigned:    { bg: 'bg-orange-500', icon: '🚫', heading: 'NOT ASSIGNED' },
    denied:          { bg: 'bg-red-500',    icon: '🚫', heading: 'CANNOT SEAT' },
  }[result.status] || { bg: 'bg-gray-500', icon: '?', heading: 'UNKNOWN' }

  return (
    <div className={`${cfg.bg} text-white rounded-2xl p-8 text-center shadow-2xl`}>
      <div className="text-7xl font-bold mb-2">{cfg.icon}</div>
      <div className="text-2xl font-bold mb-1">{cfg.heading}</div>
      {result.guest && (
        <div className="mt-4 text-xl font-semibold">
          {result.guest.first_name} {result.guest.last_name}
        </div>
      )}
      <p className="mt-2 text-white/90">{result.message}</p>
      {result.guest?.admitted_at && result.status === 'admitted' && (
        <p className="mt-1 text-white/75 text-sm">
          {new Date(result.guest.admitted_at).toLocaleTimeString()}
        </p>
      )}
      {(result.table_name || result.seat_number) && (
        <div className="mt-3 flex justify-center gap-4 text-sm text-white/90">
          {result.table_name && (
            <span className="bg-white/20 px-3 py-1 rounded-full">
              Table: <strong>{result.table_name}</strong>
            </span>
          )}
          {result.seat_number && (
            <span className="bg-white/20 px-3 py-1 rounded-full">
              Seat: <strong>{result.seat_number}</strong>
            </span>
          )}
        </div>
      )}
      <button
        onClick={onReset}
        className="mt-8 bg-white/20 hover:bg-white/30 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
      >
        Check in next guest
      </button>
    </div>
  )
}

function QrScanner({ onScan }) {
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [cameras, setCameras] = useState([])
  const [cameraId, setCameraId] = useState(null)
  const scannerRef = useRef(null)
  const ELEMENT_ID = 'qr-reader'

  // Stop the camera on unmount.
  useEffect(() => () => { stopCamera() }, [])

  async function stopCamera() {
    const s = scannerRef.current
    if (s) {
      try { await s.stop() } catch { /* already stopped */ }
      try { await s.clear() } catch { /* ignored */ }
    }
    scannerRef.current = null
  }

  // iOS requires getUserMedia() to be called SYNCHRONOUSLY inside a click
  // handler. We call it first thing in the tap, then hand off to html5-qrcode.
  async function startCamera() {
    setError('')
    setStarting(true)

    // 1. Request the permission synchronously inside this user gesture.
    //    Prefer back camera; fall back to any camera if 'environment' is unsupported.
    let probe
    try {
      probe = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
    } catch (e) {
      setStarting(false)
      setError(iosCameraHelp(e))
      return
    }
    // Release the probe stream — html5-qrcode opens its own.
    probe.getTracks().forEach((t) => t.stop())

    // 2. Enumerate cameras (now allowed since permission is granted).
    let devices = []
    try {
      devices = await Html5Qrcode.getCameras()
    } catch (e) {
      setStarting(false)
      setError(`Could not list cameras: ${e?.message || e}`)
      return
    }
    if (!devices || devices.length === 0) {
      setStarting(false)
      setError('No camera detected on this device.')
      return
    }
    setCameras(devices)
    const preferred =
      devices.find((d) => /back|rear|environment/i.test(d.label)) ||
      devices[devices.length - 1]
    const id = preferred.id
    setCameraId(id)

    // 3. Start the scanner.
    const scanner = new Html5Qrcode(ELEMENT_ID)
    scannerRef.current = scanner
    try {
      await scanner.start(
        id,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (text) => {
          // First valid decode → stop camera & propagate.
          await stopCamera()
          setRunning(false)
          onScan(text)
        },
        () => { /* per-frame decode failure — ignore */ }
      )
      setRunning(true)
      setStarting(false)
    } catch (e) {
      setStarting(false)
      setError(`Camera failed to start: ${e?.message || e}`)
    }
  }

  async function switchCamera(newId) {
    if (newId === cameraId) return
    await stopCamera()
    setCameraId(newId)
    const scanner = new Html5Qrcode(ELEMENT_ID)
    scannerRef.current = scanner
    try {
      await scanner.start(
        newId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (text) => {
          await stopCamera()
          setRunning(false)
          onScan(text)
        },
        () => {}
      )
      setRunning(true)
    } catch (e) {
      setError(`Camera failed: ${e?.message || e}`)
    }
  }

  return (
    <div className="space-y-3">
      <div id={ELEMENT_ID} className="w-full max-w-sm mx-auto" />

      {!running && (
        <button
          onClick={startCamera}
          disabled={starting}
          className="w-full bg-teal-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-60"
        >
          {starting ? 'Requesting camera...' : 'Start camera'}
        </button>
      )}

      {running && cameras.length > 1 && (
        <select
          value={cameraId || ''}
          onChange={(e) => switchCamera(e.target.value)}
          className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
        >
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>{c.label || c.id}</option>
          ))}
        </select>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 text-xs whitespace-pre-line">
          {error}
        </div>
      )}
    </div>
  )
}

function iosCameraHelp(err) {
  const name = err?.name || ''
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const lines = [`Camera blocked (${name || err?.message || 'unknown'}).`]
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    if (isIOS) {
      lines.push('iPhone fix:')
      lines.push('1. Settings → Safari → Camera → set to "Ask" or "Allow"')
      lines.push('2. Settings → Safari → Advanced → Website Data → search "vsgs.io" → delete')
      lines.push('3. Reload this page and tap Start Camera again')
    } else {
      lines.push('Tap the camera icon in the address bar and choose "Allow" for this site, then reload.')
    }
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    lines.push('No camera matching the request was found. Try a different camera in the dropdown.')
  } else if (name === 'NotReadableError') {
    lines.push('Another app is already using the camera. Close other camera apps and retry.')
  }
  return lines.join('\n')
}

function extractToken(raw) {
  try {
    const url = new URL(raw)
    const parts = url.pathname.split('/')
    return parts[parts.length - 1]
  } catch {
    return raw.trim()
  }
}

function ManualCheckin({ eventId, onResult, walkInEnabled }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [confirm, setConfirm] = useState(null)   // guest pending confirmation
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [walkIn, setWalkIn] = useState(false)
  const [wf, setWf] = useState({ first_name: '', last_name: '', phone: '' })

  async function doRegisterWalkIn(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      onResult(await api.registerWalkIn(eventId, {
        first_name: wf.first_name.trim(), last_name: wf.last_name.trim(), phone: wf.phone.trim() || null,
      }))
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  // Debounced search across name + phone.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); setSearching(false); return }
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.searchGuests(eventId, term)
        if (active) setResults(r)
      } catch (e) { if (active) setErr(e.message) }
      finally { if (active) setSearching(false) }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [q, eventId])

  async function doCheckin(guest) {
    setBusy(true); setErr('')
    try {
      onResult(await api.manualCheckin(eventId, guest.id))
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const inputCls = 'w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500'

  // Confirmation screen.
  if (confirm) {
    return (
      <div className="text-center space-y-4 py-2">
        <p className="text-sm text-gray-500 dark:text-slate-400">Check in</p>
        <p className="text-2xl font-bold dark:text-white flex items-center justify-center gap-2">
          {confirm.full_name}
          {confirm.is_vip && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full align-middle">VIP</span>}
        </p>
        {(confirm.table_name || confirm.seat_number) && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {confirm.table_name && <>Table <strong>{confirm.table_name}</strong></>}
            {confirm.seat_number && <> · Seat <strong>{confirm.seat_number}</strong></>}
          </p>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <div className="flex gap-3 justify-center pt-2">
          <button onClick={() => { setConfirm(null); setErr('') }}
            className="px-6 py-3 rounded-xl border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-100 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button onClick={() => doCheckin(confirm)} disabled={busy}
            className="px-8 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold disabled:opacity-50">
            {busy ? 'Checking in…' : 'Confirm'}
          </button>
        </div>
      </div>
    )
  }

  // Walk-in registration form.
  if (walkIn) {
    return (
      <form onSubmit={doRegisterWalkIn} className="space-y-3">
        <p className="text-sm font-semibold dark:text-white">Register walk-in guest</p>
        <div className="grid grid-cols-2 gap-2">
          <input autoFocus required value={wf.first_name} onChange={(e) => setWf((f) => ({ ...f, first_name: e.target.value }))}
            placeholder="First name *" className={inputCls} />
          <input value={wf.last_name} onChange={(e) => setWf((f) => ({ ...f, last_name: e.target.value }))}
            placeholder="Last name" className={inputCls} />
        </div>
        <input value={wf.phone} onChange={(e) => setWf((f) => ({ ...f, phone: e.target.value }))}
          placeholder="Phone (optional)" className={inputCls} />
        {err && <p className="text-sm text-red-500">{err}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !wf.first_name.trim()}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl disabled:opacity-50">
            {busy ? 'Registering…' : 'Register & check in'}
          </button>
          <button type="button" onClick={() => { setWalkIn(false); setErr('') }}
            className="px-5 py-3 rounded-xl border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200">
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder="Search name or phone…" className={inputCls} />
      {walkInEnabled && (
        <button onClick={() => { setWalkIn(true); setErr('') }}
          className="w-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded-lg py-2 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40">
          + Register as Walk-in Guest
        </button>
      )}
      {searching && <p className="text-xs text-gray-400 dark:text-slate-500">Searching…</p>}
      {err && <p className="text-sm text-red-500">{err}</p>}
      {q.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">No matching guests.</p>
      )}
      <div className="space-y-2">
        {results.map((g) => (
          <button key={g.id} disabled={g.admitted} onClick={() => setConfirm(g)}
            className={`w-full text-left rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 ${
              g.admitted
                ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 cursor-default'
                : 'border-gray-200 dark:border-slate-700 hover:bg-teal-50 dark:hover:bg-teal-900/20'
            }`}>
            <div className="min-w-0">
              <div className="font-semibold dark:text-slate-100 flex items-center gap-2 truncate">
                {g.full_name}
                {g.is_vip && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">VIP</span>}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                {g.phone_masked || 'no phone'}
                {g.table_name ? ` · Table ${g.table_name}${g.seat_number ? ` seat ${g.seat_number}` : ''}` : ''}
              </div>
            </div>
            {g.admitted
              ? <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold shrink-0">
                  Admitted{g.admitted_at ? ` ${new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              : <span className="text-teal-600 dark:text-teal-400 text-sm font-semibold shrink-0">Check in →</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function EventQrPanel({ event }) {
  const [copied, setCopied] = useState(false)
  const code = event?.event_code
  const url = code ? api.selfCheckinUrl(code) : ''

  async function copyLink() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (!code) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-5 text-center">
        <div className="font-semibold text-amber-900 dark:text-amber-100">Event code is being generated.</div>
        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">Refresh this event after enabling self check-in.</p>
      </div>
    )
  }

  return (
    <button type="button" onClick={copyLink}
      className="w-full text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 hover:border-teal-400">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{event.name}</p>
      <img src={api.selfCheckinQrUrl(code)} alt="Event self check-in QR code"
        className="mx-auto my-4 h-64 w-64 rounded-lg bg-white p-3" />
      <p className="text-base font-bold text-slate-950 dark:text-white">Hold this up for guests to scan</p>
      <p className="mt-2 break-all text-xs text-slate-500 dark:text-slate-400">{url}</p>
      {copied && <p className="mt-2 text-xs font-semibold text-teal-600 dark:text-teal-400">Link copied</p>}
    </button>
  )
}

export default function ScannerPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useCurrentEvent()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  // Venue-access mode (additive — legacy scanning is unchanged when off).
  const [zones, setZones] = useState([])
  const [zoneId, setZoneId] = useState('')
  const [direction, setDirection] = useState('in')
  // Gate mode (tag-based auto-zone). 'gate' when gates exist, else 'zone'.
  const [gates, setGates] = useState([])
  const [gateId, setGateId] = useState('')
  const [scanBy, setScanBy] = useState('gate')
  const [mode, setMode] = useState('qr')   // 'qr' | 'manual' (when manual check-in is enabled)

  const selectedEvent = events.find((e) => e.id === eventId)
  const accessMode = !!selectedEvent?.venue_access_enabled
  const manualEnabled = !!selectedEvent?.manual_checkin_enabled
  const selfCheckinEnabled = !!selectedEvent?.self_checkin_enabled
  const selectedZone = zones.find((z) => z.id === zoneId)
  const selectedGate = gates.find((g) => g.id === gateId)
  const scanningReady = !!selectedEvent && selectedEvent.status === 'active'

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (!evs.some((e) => e.id === eventId)) setEventId(evs.length === 1 ? evs[0].id : '')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load zones + gates only for venue-access events.
  useEffect(() => {
    setZoneId(''); setZones([]); setGateId(''); setGates([]); setMode('qr')
    if (eventId && selectedEvent?.venue_access_enabled) {
      api.listZones(eventId).then(setZones).catch(() => {})
      api.listGates(eventId).then((g) => {
        setGates(g)
        setScanBy(g.length ? 'gate' : 'zone')
      }).catch(() => setScanBy('zone'))
    }
  }, [eventId]) // eslint-disable-line

  async function handleScan(raw) {
    const token = extractToken(raw)
    setLoading(true)
    try {
      if (accessMode && scanBy === 'gate') {
        if (!gateId) { setResult({ zoneMode: true, status: 'invalid', message: 'Pick a gate first.' }); return }
        const res = await api.scanGate(eventId, gateId, token)
        setResult({
          zoneMode: true,
          status: res.status === 'invalid' ? 'invalid' : 'ok',
          denied: !res.allowed,
          guest_name: res.guest_name,
          ticket_type: res.matched_tags?.length ? res.matched_tags.join(', ') : undefined,
          zone_name: res.zone_name,
          direction: res.direction,
          occupancy: res.occupancy,
          deny_reason: res.allowed ? undefined : res.message,
          message: res.message,
        })
      } else if (accessMode) {
        if (!zoneId) { setResult({ zoneMode: true, status: 'invalid', message: 'Pick a zone first.' }); return }
        const body = { zone_id: zoneId }
        if (selectedZone?.direction_mode === 'both') body.direction = direction
        const res = await api.scanZone(token, body)
        setResult({ zoneMode: true, ...res })
      } else {
        const res = await api.scan(token)
        setResult(res)
      }
    } catch (err) {
      setResult({ zoneMode: accessMode, status: 'invalid', message: err.message })
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setResult(null)
    setScanKey((k) => k + 1)
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold dark:text-white">Guest check-in</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {scanningReady ? "Start the camera and point it at a guest's QR code." : 'Choose an active event before scanning guests.'}
        </p>
      </div>

      {events.length > 1 && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Event</label>
          <select
            className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">— select event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.couples_name ? `${ev.name} — ${ev.couples_name}` : ev.name}</option>
            ))}
          </select>
        </div>
      )}

      {accessMode && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 space-y-3">
          {gates.length > 0 && (
            <div className="flex gap-2">
              {[['gate', 'Gate'], ['zone', 'Area (manual)']].map(([m, label]) => (
                <button key={m} onClick={() => setScanBy(m)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${scanBy === m ? 'bg-teal-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>{label}</button>
              ))}
            </div>
          )}

          {scanBy === 'gate' && gates.length > 0 ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Where are you checking guests in?</label>
              <select className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                value={gateId} onChange={(e) => setGateId(e.target.value)}>
                <option value="">— select gate —</option>
                {gates.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.zone_name} · {g.direction === 'out' ? 'Exit ←' : 'Entry →'}</option>)}
              </select>
              {selectedGate && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  EventQR checks each guest's ticket rules automatically.
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Entry area</label>
                <select className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">— select zone —</option>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · inside {z.occupancy}{z.capacity != null ? `/${z.capacity}` : ''}</option>)}
                </select>
              </div>
              {selectedZone?.direction_mode === 'both' && (
                <div className="flex gap-2">
                  {[['in', 'Entry →'], ['out', '← Exit']].map(([d, label]) => (
                    <button key={d} onClick={() => setDirection(d)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold ${direction === d ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>{label}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-gray-600 dark:text-slate-400">Scanning…</p>
          </div>
        )}

        {!loading && result && result.zoneMode && <ZoneResultCard result={result} onReset={reset} />}
        {!loading && result && !result.zoneMode && <ResultCard result={result} onReset={reset} />}

        {!loading && !result && !scanningReady && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-5 text-center">
            <div className="font-semibold text-amber-900 dark:text-amber-100">
              {selectedEvent ? `This event is ${selectedEvent.status}.` : 'No event selected.'}
            </div>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Start the event in Event Setup to enable QR scanning.
            </p>
          </div>
        )}

        {!loading && !result && scanningReady && (
          <div>
            {(manualEnabled || selfCheckinEnabled) && (
              <div className="flex gap-2 mb-4">
                {[
                  ['qr', 'QR Scan'],
                  ...(manualEnabled ? [['manual', 'Manual']] : []),
                  ...(selfCheckinEnabled ? [['eventqr', 'Event QR']] : []),
                ].map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold ${
                      mode === m ? 'bg-teal-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {selfCheckinEnabled && mode === 'eventqr' ? (
              <EventQrPanel event={selectedEvent} />
            ) : manualEnabled && mode === 'manual' ? (
              <ManualCheckin eventId={eventId} walkInEnabled={!!selectedEvent?.walk_in_enabled} onResult={(res) => setResult(res)} />
            ) : (
              <>
                <p className="text-center text-sm text-gray-500 dark:text-slate-400 mb-4">
                  Keep the QR code inside the square until you see a result.
                </p>
                <QrScanner key={scanKey} onScan={handleScan} />
              </>
            )}
          </div>
        )}
      </div>

      {scanningReady && (
      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
        <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">Look up by QR link or code</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const token = e.target.token.value.trim()
            if (token) handleScan(token)
            e.target.reset()
          }}
          className="flex gap-2"
        >
          <input
            name="token"
            placeholder="Paste QR link or code..."
            className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500"
          />
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            Check in
          </button>
        </form>
      </div>
      )}
    </div>
  )
}
