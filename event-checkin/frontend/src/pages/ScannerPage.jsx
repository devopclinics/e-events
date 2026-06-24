import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { api } from '../api'

function ResultCard({ result, onReset }) {
  const cfg = {
    admitted:          { bg: 'bg-green-500',  icon: '✓', heading: 'ADMITTED' },
    already_admitted:  { bg: 'bg-amber-500',  icon: '⚠', heading: 'ALREADY ADMITTED' },
    invalid:           { bg: 'bg-red-500',    icon: '✕', heading: 'INVALID QR CODE' },
    not_active:        { bg: 'bg-slate-600',  icon: '⏸', heading: 'EVENT NOT ACTIVE' },
    not_assigned:      { bg: 'bg-orange-500', icon: '🚫', heading: 'NOT ASSIGNED' },
    no_seat_available: { bg: 'bg-red-700',    icon: '🚫', heading: 'ENTRY DENIED — CONTACT ORGANIZER' },
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
        Scan Next Guest
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
          {starting ? 'Requesting camera…' : '📷 Start Camera'}
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
      lines.push('2. Settings → Safari → Advanced → Website Data → search "nihlah.io" → delete')
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

// ── Manual check-in: guest search + confirm ───────────────────────────────────

function GuestCard({ guest, onSelect }) {
  return (
    <button
      onClick={() => onSelect(guest)}
      className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
        guest.admitted
          ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-600 opacity-80'
          : 'border-slate-200 dark:border-slate-600 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white text-sm">
            {guest.first_name} {guest.last_name}
            {guest.is_vip && <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100 px-1.5 py-0.5 rounded font-bold">VIP</span>}
          </p>
          {guest.phone && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{guest.phone}</p>}
          {(guest.table_name || guest.seat_number) && (
            <p className="text-xs text-indigo-600 dark:text-indigo-300 mt-0.5">
              {guest.table_name}{guest.seat_number ? ` · Seat ${guest.seat_number}` : ''}
            </p>
          )}
        </div>
        <div className="shrink-0 ml-3">
          {guest.admitted ? (
            <span className="text-xs bg-amber-200 text-amber-800 dark:bg-amber-700 dark:text-amber-100 px-2 py-1 rounded-full font-semibold">
              Admitted
            </span>
          ) : (
            <span className="text-xs bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 px-2 py-1 rounded-full">
              Tap to admit
            </span>
          )}
        </div>
      </div>
      {guest.admitted && guest.admitted_at && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
          Checked in at {new Date(guest.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </button>
  )
}

function ConfirmCheckin({ guest, eventId, onResult, onCancel }) {
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    try {
      const res = await api.manualCheckin(eventId, guest.id)
      onResult(res)
    } catch (err) {
      onResult({ status: 'invalid', message: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Confirm check-in for</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white">{guest.first_name} {guest.last_name}</p>
        {guest.phone && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{guest.phone}</p>}
        {guest.table_name && (
          <p className="text-sm text-indigo-600 dark:text-indigo-300 mt-1">
            {guest.table_name}{guest.seat_number ? ` · Seat ${guest.seat_number}` : ''}
          </p>
        )}
      </div>
      <button
        onClick={confirm}
        disabled={loading}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl text-lg disabled:opacity-50 transition-colors"
      >
        {loading ? 'Checking in…' : 'Confirm Check-In'}
      </button>
      <button
        onClick={onCancel}
        className="w-full text-slate-500 dark:text-slate-400 text-sm py-2 hover:underline"
      >
        Cancel — go back to search
      </button>
    </div>
  )
}

function WalkInForm({ eventId, prefillName, walkInGroupName, onResult, onCancel }) {
  const parts = prefillName.trim().split(/\s+/)
  const [firstName, setFirstName] = useState(parts[0] || '')
  const [lastName, setLastName] = useState(parts.slice(1).join(' ') || '')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { setErr('First and last name required.'); return }
    setSaving(true)
    setErr('')
    try {
      const guest = await api.addGuest(eventId, { first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() || undefined })
      const res = await api.manualCheckin(eventId, guest.id)
      onResult(res)
    } catch (e) {
      setErr(e.message || 'Failed to add walk-in guest.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400'

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="text-center pb-1">
        <p className="font-bold text-slate-800 dark:text-white">Register Walk-in Guest</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {walkInGroupName
            ? `Will be seated from: ${walkInGroupName}`
            : 'Will be auto-assigned a seat'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <input className={inputCls} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      </div>
      <input className={inputCls} placeholder="Phone (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button type="submit" disabled={saving}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl text-lg disabled:opacity-50 transition-colors">
        {saving ? 'Adding & checking in…' : 'Add & Check In'}
      </button>
      <button type="button" onClick={onCancel}
        className="w-full text-slate-500 dark:text-slate-400 text-sm py-2 hover:underline">
        Cancel — go back to search
      </button>
    </form>
  )
}

function ManualCheckinTab({ eventId, walkInEnabled, walkInGroupName }) {
  const [query, setQuery] = useState('')
  const [guests, setGuests] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [result, setResult] = useState(null)
  const debounceRef = useRef(null)

  function handleQueryChange(val) {
    setQuery(val)
    setSelected(null)
    setShowWalkIn(false)
    setResult(null)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setGuests([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.searchGuests(eventId, val.trim())
        setGuests(res)
      } catch { setGuests([]) }
      finally { setSearching(false) }
    }, 300)
  }

  function reset() {
    setQuery('')
    setGuests([])
    setSelected(null)
    setShowWalkIn(false)
    setResult(null)
  }

  if (result) return <div className="space-y-4"><ResultCard result={result} onReset={reset} /></div>

  if (showWalkIn) return <WalkInForm eventId={eventId} prefillName={query} walkInGroupName={walkInGroupName} onResult={setResult} onCancel={() => setShowWalkIn(false)} />

  if (selected) return <ConfirmCheckin guest={selected} eventId={eventId} onResult={setResult} onCancel={() => setSelected(null)} />

  const noResults = !searching && query.trim().length >= 2 && guests.length === 0

  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search by name or phone number…"
        className="w-full border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400"
      />
      {searching && <p className="text-center text-sm text-slate-400 py-2">Searching…</p>}
      {noResults && (
        <div className="text-center py-4 space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">No guest found for "{query}"</p>
          {walkInEnabled && (
            <button
              onClick={() => setShowWalkIn(true)}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl text-sm transition-colors">
              + Register as Walk-in Guest
            </button>
          )}
          {!walkInEnabled && (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Walk-in registration is disabled for this event.</p>
          )}
        </div>
      )}
      {guests.length > 0 && (
        <div className="space-y-2">
          {guests.map((g) => (
            <GuestCard key={g.id} guest={g} onSelect={(g) => !g.admitted && setSelected(g)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ScannerPage ──────────────────────────────────────────────────────────

export default function ScannerPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [activeEvent, setActiveEvent] = useState(null)
  const [tableGroups, setTableGroups] = useState([])
  const [tab, setTab] = useState('qr')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [scanKey, setScanKey] = useState(0)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (evs.length === 1) {
        setEventId(evs[0].id)
        setActiveEvent(evs[0])
        api.listTableGroups(evs[0].id).then(setTableGroups).catch(() => {})
      }
    })
  }, [])

  function handleEventChange(id) {
    setEventId(id)
    setActiveEvent(events.find((e) => e.id === id) || null)
    setResult(null)
    setTab('qr')
    if (id) api.listTableGroups(id).then(setTableGroups).catch(() => {})
  }

  async function handleScan(raw) {
    const token = extractToken(raw)
    setLoading(true)
    try {
      const res = await api.scan(token)
      setResult(res)
    } catch (err) {
      setResult({ status: 'invalid', message: err.message })
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setResult(null)
    setScanKey((k) => k + 1)
  }

  const manualEnabled    = activeEvent?.manual_checkin_enabled
  const walkInEnabled    = activeEvent?.walk_in_enabled
  const selfEnabled      = activeEvent?.self_checkin_enabled && activeEvent?.event_code
  const walkInGroup      = tableGroups.find((g) => g.id === activeEvent?.walk_in_table_group_id)
  const walkInGroupName  = walkInGroup?.name || null

  const tabs = [
    { key: 'qr',      label: 'QR Scan' },
    ...((manualEnabled || walkInEnabled) && eventId ? [{ key: 'manual', label: 'Manual / Walk-in' }] : []),
    ...(selfEnabled   ? [{ key: 'eventqr', label: 'Event QR' }] : []),
  ]
  const showTabs = tabs.length > 1

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-center dark:text-white">Check-In Scanner</h1>

      {events.length > 1 && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Event</label>
          <select
            className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            value={eventId}
            onChange={(e) => handleEventChange(e.target.value)}
          >
            <option value="">— select event —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name} — {ev.couples_name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
        {showTabs && (
          <div className="flex border-b border-slate-200 dark:border-slate-700">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setResult(null); setScanKey((k) => k + 1) }}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                  tab === key
                    ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="p-6">
          {tab === 'qr' && (
            <>
              {loading && (
                <div className="text-center py-8">
                  <div className="inline-block w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="mt-3 text-gray-600 dark:text-slate-400">Checking in…</p>
                </div>
              )}
              {!loading && result && <ResultCard result={result} onReset={reset} />}
              {!loading && !result && (
                <div>
                  <p className="text-center text-sm text-gray-500 dark:text-slate-400 mb-4">
                    Tap <strong>Start Camera</strong>, then point at the guest's QR code.
                  </p>
                  <QrScanner key={scanKey} onScan={handleScan} />
                </div>
              )}
            </>
          )}

          {tab === 'manual' && eventId && (
            <ManualCheckinTab key={eventId} eventId={eventId} walkInEnabled={walkInEnabled} walkInGroupName={walkInGroupName} />
          )}

          {tab === 'eventqr' && activeEvent?.event_code && (
            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-sm text-gray-500 dark:text-slate-400 text-center">
                Show this to guests — they scan it with their phone to check in themselves.
              </p>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(window.location.origin + '/e/' + activeEvent.event_code)}`}
                alt="Event self check-in QR"
                className="w-56 h-56 rounded-xl border-4 border-teal-400"
              />
              <div className="text-center">
                <p className="font-mono font-bold text-lg text-teal-600 dark:text-teal-400 tracking-widest">
                  {activeEvent.event_code}
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(`${window.location.origin}/e/${activeEvent.event_code}`)}
                  className="mt-1 text-xs text-teal-500 underline"
                >
                  Copy link
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {tab === 'qr' && !result && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
          <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">Manual Token Entry</p>
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
              placeholder="Paste QR token or URL…"
              className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500"
            />
            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Submit
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
