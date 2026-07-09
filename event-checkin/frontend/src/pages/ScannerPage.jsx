import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Capacitor } from '@capacitor/core'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import {
  drainExperienceQueue,
  drainOfflineAdmissions,
  enqueueOfflineAccessScan,
  enqueueExperienceStep,
  enqueueOfflineAdmission,
  experienceQueueCount,
  loadOfflineManifest,
  offlineAdmissionCount,
  saveOfflineManifest,
} from '../offlineExperienceQueue'

function sessionSummary(session = {}) {
  const parts = []
  if (session.topic) parts.push(session.topic)
  if (session.date) parts.push(session.date)
  if (session.start_time || session.end_time) parts.push([session.start_time, session.end_time].filter(Boolean).join('-'))
  if (session.room) parts.push(session.room)
  if (session.speaker) parts.push(`Speaker: ${session.speaker}`)
  return parts.join(' · ')
}

function normalizeSessionConfig(config = {}) {
  const raw = config.session || config.session_details || config.schedule || config.session_config || config
  const first = Array.isArray(config.sessions) ? config.sessions[0] : null
  const source = (raw && typeof raw === 'object' ? raw : null) || (first && typeof first === 'object' ? first : null) || {}
  return {
    topic: source.topic || source.title || source.name || '',
    date: source.date || source.session_date || '',
    start_time: source.start_time || source.startTime || source.start || '',
    end_time: source.end_time || source.endTime || source.end || '',
    room: source.room || source.location || source.venue || '',
    speaker: source.speaker || source.host || source.presenter || '',
    capacity: source.capacity ?? '',
    checkin_window_minutes: source.checkin_window_minutes ?? source.checkInWindowMinutes ?? source.checkin_window ?? '',
  }
}

function hasSessionDetails(session = {}) {
  return ['topic', 'date', 'start_time', 'end_time', 'room', 'speaker'].some((key) => String(session?.[key] || '').trim())
}

function sessionWindowState(session = {}) {
  const rawWindow = session.checkin_window_minutes
  if (rawWindow === undefined || rawWindow === null || rawWindow === '') return { open: true, reason: '' }
  const windowMinutes = Number(rawWindow)
  if (!Number.isFinite(windowMinutes) || windowMinutes < 0) return { open: false, reason: 'Session check-in window is not valid.' }
  if (!session.date || !session.start_time) return { open: true, reason: '' }
  const start = new Date(`${session.date}T${session.start_time}`)
  if (Number.isNaN(start.getTime())) return { open: true, reason: '' }
  const opens = new Date(start.getTime() - windowMinutes * 60 * 1000)
  const now = new Date()
  if (now < opens) {
    return {
      open: false,
      reason: `Check-in opens ${windowMinutes} minutes before start (${opens.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`,
    }
  }
  if (session.end_time) {
    const end = new Date(`${session.date}T${session.end_time}`)
    if (!Number.isNaN(end.getTime()) && now > end) return { open: false, reason: 'Session check-in is closed.' }
  }
  return { open: true, reason: '' }
}

function experienceStepActionLabel(step, sessionNeedsSetup = false, sessionWindowClosed = false) {
  if (sessionNeedsSetup) return 'Setup needed'
  if (sessionWindowClosed) return 'Not open'
  if (step?.type === 'session_attendance') return 'Check in'
  if (step?.type === 'room_assignment') return 'Assign Room'
  return 'Complete'
}

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

function ResultCard({ result, onReset, onStepComplete, stepActionLoading }) {
  const cfg = {
    admitted:        { bg: 'bg-green-500',  icon: '✓', heading: 'ADMITTED' },
    offline_queued:  { bg: 'bg-teal-600',   icon: '✓', heading: 'ADMITTED OFFLINE' },
    // Already-admitted is the most common door mistake (a double-scan), so make
    // it loud: bold orange + a thick ring + a big icon so staff can't miss it.
    already_admitted:{ bg: 'bg-orange-500', ring: 'ring-4 ring-orange-300', icon: '‼', heading: 'ALREADY CHECKED IN', big: true },
    checked_out:     { bg: 'bg-slate-600', icon: 'OUT', heading: 'CHECKED OUT' },
    already_checked_out:{ bg: 'bg-orange-500', ring: 'ring-4 ring-orange-300', icon: 'OUT', heading: 'ALREADY CHECKED OUT', big: true },
    not_checked_in:  { bg: 'bg-orange-500', icon: '!', heading: 'NOT CHECKED IN' },
    invalid:         { bg: 'bg-red-500',    icon: '✕', heading: 'NOT FOUND' },
    not_active:      { bg: 'bg-slate-600',  icon: '⏸', heading: 'EVENT NOT ACTIVE' },
    not_assigned:    { bg: 'bg-orange-500', icon: '🚫', heading: 'NOT ASSIGNED' },
    denied:          { bg: 'bg-red-500',    icon: '🚫', heading: 'CANNOT SEAT' },
    no_seat_available:{ bg: 'bg-red-600',   icon: '🚫', heading: 'NO SEAT AVAILABLE' },
  }[result.status] || { bg: 'bg-gray-500', icon: '?', heading: 'UNKNOWN' }

  return (
    <div className={`${cfg.bg} ${cfg.ring || ''} text-white rounded-2xl p-8 text-center shadow-2xl`}>
      <div className={`${cfg.big ? 'text-8xl' : 'text-7xl'} font-bold mb-2 leading-none`}>{cfg.icon}</div>
      <div className={`${cfg.big ? 'text-3xl' : 'text-2xl'} font-bold mb-1`}>{cfg.heading}</div>
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
      {result.guest?.admitted_at && result.status === 'already_admitted' && (
        <div className="mt-4 inline-block bg-black/25 rounded-xl px-5 py-3">
          <div className="text-xs uppercase tracking-wide text-white/80">Checked in at</div>
          <div className="text-2xl font-bold">{new Date(result.guest.admitted_at).toLocaleTimeString()}</div>
        </div>
      )}
      {result.step_error && (
        <div className="mx-auto mt-4 max-w-sm rounded-xl border border-white/25 bg-black/20 px-4 py-3 text-sm font-semibold text-white">
          {result.step_error}
        </div>
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
      {result.experience_next_steps?.length > 0 && (
        <div className="mt-5 rounded-xl bg-black/20 p-4 text-left">
          <div className="text-xs font-bold uppercase tracking-wide text-white/70">Next steps</div>
          <div className="mt-2 space-y-2">
            {result.experience_next_steps.map(({ step, progress }) => {
              const messages = step.config?.messages || {}
              const prompt = messages.staff || step.config?.staff_prompt || step.description
              const session = normalizeSessionConfig(step.config || {})
              const sessionInfo = step.type === 'session_attendance' ? sessionSummary(session) : ''
              const sessionNeedsSetup = step.type === 'session_attendance' && !hasSessionDetails(session)
              const windowState = step.type === 'session_attendance' ? sessionWindowState(session) : { open: true, reason: '' }
              const sessionWindowClosed = step.type === 'session_attendance' && !windowState.open
              return (
              <div key={step.id} className="rounded-lg bg-white/15 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{step.title}</span>
                      {step.required && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-950">Required</span>}
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold capitalize text-white/90">
                        {(progress?.status || 'available').replaceAll('_', ' ')}
                      </span>
                    </div>
                    {prompt && <div className="mt-1 text-xs text-white/80">{prompt}</div>}
                    {sessionInfo && <div className="mt-1 text-xs font-bold text-teal-100">{sessionInfo}</div>}
                    {sessionNeedsSetup && <div className="mt-1 text-xs font-bold text-amber-100">Session setup needed in Admin before check-in.</div>}
                    {!sessionNeedsSetup && sessionWindowClosed && <div className="mt-1 text-xs font-bold text-amber-100">{windowState.reason}</div>}
                  </div>
                  {!['check_in', 'seating_assignment', 'meal_selection', 'consent'].includes(step.type) && (
                    <button type="button" onClick={() => onStepComplete?.(step)}
                      disabled={stepActionLoading || sessionNeedsSetup || sessionWindowClosed}
                      className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/30 disabled:opacity-50">
                      {experienceStepActionLabel(step, sessionNeedsSetup, sessionWindowClosed)}
                    </button>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}
      <button
        onClick={onReset}
        className="mt-8 bg-white/20 hover:bg-white/30 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
      >
        {result.status === 'checked_out' || result.status === 'already_checked_out' ? 'Check out next guest' : 'Check in next guest'}
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

    // Native (Capacitor) → use the MLKit barcode scanner: far more reliable than
    // decoding video frames in JS, and the OS-level camera UI. Web falls through
    // to html5-qrcode below.
    if (Capacitor.isNativePlatform()) {
      try {
        const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning')
        const perm = await BarcodeScanner.requestPermissions()
        if (perm.camera !== 'granted' && perm.camera !== 'limited') {
          setStarting(false)
          setError('Camera permission denied. Enable it in Settings to scan.')
          return
        }
        const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] })
        setStarting(false)
        if (barcodes && barcodes.length) onScan(barcodes[0].rawValue)
        return
      } catch (e) {
        setStarting(false)
        setError(`Scanner failed: ${e?.message || e}`)
        return
      }
    }

    // 1. Request the permission synchronously inside this user gesture.
    //    Prefer back camera; fall back to any camera if 'environment' is unsupported.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStarting(false)
      setError(cameraSecureContextHelp())
      return
    }
    let probe
    try {
      probe = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
    } catch (e) {
      try {
        probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      } catch (fallbackError) {
        setStarting(false)
        setError(iosCameraHelp(fallbackError))
        return
      }
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

function cameraSecureContextHelp() {
  const host = window.location.host
  const protocol = window.location.protocol
  return [
    'Camera is unavailable in this browser context.',
    `Current address: ${protocol}//${host}`,
    'Mobile browsers require HTTPS for camera access, except on localhost.',
    'Use the HTTPS production domain, an HTTPS tunnel, or open the scanner from the native app.',
  ].join('\n')
}

function iosCameraHelp(err) {
  const name = err?.name || ''
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const lines = [`Camera blocked (${name || err?.message || 'unknown'}).`]
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    if (isIOS) {
      lines.push('iPhone fix:')
      lines.push('1. Settings → Safari → Camera → set to "Ask" or "Allow"')
      lines.push('2. Settings → Safari → Advanced → Website Data → search "festio.events" → delete')
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

function extractScanPayload(raw) {
  const value = String(raw || '').trim()
  const checkout = value.match(/^festio-checkout:(.+)$/i)
  if (checkout) return { token: extractToken(checkout[1]), action: 'checkout' }
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    const checkoutIndex = parts.findIndex((part) => part.toLowerCase() === 'checkout')
    if (checkoutIndex >= 0 && parts[checkoutIndex + 1]) {
      return { token: parts[checkoutIndex + 1], action: 'checkout' }
    }
  } catch {
    // Plain ticket tokens fall through to the existing parser.
  }
  return { token: extractToken(value), action: null }
}

function ManualCheckin({ eventId, onResult, manualEnabled, walkInEnabled, sectionMode, sectionId, sectionPickable }) {
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
        table_group_id: sectionMode ? (sectionId || null) : null,
      }))
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  function openWalkInForm() {
    const term = q.trim()
    if (term && !wf.first_name.trim() && !wf.last_name.trim()) {
      const [first, ...rest] = term.split(/\s+/)
      setWf((f) => ({ ...f, first_name: first || '', last_name: rest.join(' ') }))
    }
    setWalkIn(true)
    setErr('')
  }

  // Debounced search across name + phone.
  useEffect(() => {
    const term = q.trim()
    if (!manualEnabled || term.length < 2) { setResults([]); setSearching(false); return }
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
  }, [q, eventId, manualEnabled])

  async function doCheckin(guest) {
    setBusy(true); setErr('')
    try {
      onResult(await api.manualCheckin(eventId, guest.id, sectionMode ? sectionId : null))
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const inputCls = 'w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500'

  // Confirmation screen.
  if (confirm) {
    return (
      <div className="text-center space-y-4 py-2">
        <p className="text-sm text-gray-500 dark:text-slate-400">{confirm.admitted ? 'Already checked in' : 'Check in'}</p>
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
            {busy ? 'Loading…' : confirm.admitted ? 'Open journey' : 'Confirm'}
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
      {sectionMode && sectionPickable && !sectionId && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Pick your section above first — guests without a table group are seated in the active section.
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder={manualEnabled ? 'Search name or phone…' : 'Walk-in guest name…'} className={inputCls} />
      {walkInEnabled && (
        <button onClick={openWalkInForm}
          className="w-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded-lg py-2 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40">
          + Register as Walk-in Guest
        </button>
      )}
      {searching && <p className="text-xs text-gray-400 dark:text-slate-500">Searching…</p>}
      {err && <p className="text-sm text-red-500">{err}</p>}
      {manualEnabled && q.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">No guest found for "{q.trim()}".</p>
      )}
      {!manualEnabled && q.trim().length >= 2 && (
        <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">Manual lookup is off. Register this person as a walk-in guest.</p>
      )}
      <div className="space-y-2">
        {results.map((g) => (
          <button key={g.id} onClick={() => setConfirm(g)}
            className={`w-full text-left rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 ${
              g.admitted
                ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
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
                  Review{g.admitted_at ? ` · ${new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
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
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Checkout QR codes are guest-specific and appear on an admitted guest's pass. For Entry areas, exits are recorded by selecting an Exit gate or an Exit direction.
      </p>
      {copied && <p className="mt-2 text-xs font-semibold text-teal-600 dark:text-teal-400">Link copied</p>}
    </button>
  )
}

export default function ScannerPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useCurrentEvent()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [stepActionLoading, setStepActionLoading] = useState(false)
  const [queuedActions, setQueuedActions] = useState(() => experienceQueueCount())
  const [queuedAdmissions, setQueuedAdmissions] = useState(() => offlineAdmissionCount())
  const [offlineManifest, setOfflineManifest] = useState(null)
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
  // Section-based scanning: this device's active section (a table group), picked
  // once per session and persisted per-event in sessionStorage. Walk-ins and
  // group-less manual check-ins route here.
  const [tableGroups, setTableGroups] = useState([])
  const [sectionId, setSectionId] = useState('')

  const selectedEvent = events.find((e) => e.id === eventId)
  const accessMode = !!selectedEvent?.venue_access_enabled
  const manualEnabled = !!selectedEvent?.manual_checkin_enabled
  const walkInEnabled = !!selectedEvent?.walk_in_enabled
  const manualWalkInEnabled = manualEnabled || walkInEnabled
  const selfCheckinEnabled = !!selectedEvent?.self_checkin_enabled
  const sectionMode = !!selectedEvent?.section_mode_enabled
  const normalCheckoutEnabled = !!selectedEvent?.checkout_enabled && !accessMode
  const selectedZone = zones.find((z) => z.id === zoneId)
  const selectedGate = gates.find((g) => g.id === gateId)
  const scanningReady = !!selectedEvent && selectedEvent.status === 'active'

  async function refreshEvents() {
    try {
      const evs = await api.listEvents()
      setEvents(evs)
      if (!evs.some((e) => e.id === eventId)) setEventId(evs.length === 1 ? evs[0].id : '')
    } catch {
      // Keep the last known event list during transient network loss.
    }
  }

  useEffect(() => {
    refreshEvents()
    const id = setInterval(refreshEvents, 30000)
    window.addEventListener('focus', refreshEvents)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refreshEvents)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function drain() {
      if (!navigator.onLine) return
      const [res, admissions] = await Promise.all([
        drainExperienceQueue(api),
        drainOfflineAdmissions(api),
      ])
      setQueuedActions(res.remaining)
      setQueuedAdmissions(admissions.remaining)
      if (res.sent && result?.guest?.event_id && result?.guest?.id) {
        const nextSteps = await api.getExperienceNextSteps(result.guest.event_id, result.guest.id).catch(() => null)
        if (nextSteps) setResult((prev) => prev ? { ...prev, experience_next_steps: nextSteps } : prev)
      }
      if (admissions.sent && eventId) refreshOfflineManifest(eventId)
    }
    function updateCount() {
      setQueuedActions(experienceQueueCount())
      setQueuedAdmissions(offlineAdmissionCount())
    }
    window.addEventListener('online', drain)
    window.addEventListener('experience-queue-change', updateCount)
    window.addEventListener('offline-admission-change', updateCount)
    drain()
    return () => {
      window.removeEventListener('online', drain)
      window.removeEventListener('experience-queue-change', updateCount)
      window.removeEventListener('offline-admission-change', updateCount)
    }
  }, [result?.guest?.event_id, result?.guest?.id, eventId])

  async function refreshOfflineManifest(id = eventId) {
    if (!id || !navigator.onLine) return
    try {
      const manifest = await api.offlineManifest(id)
      saveOfflineManifest(id, manifest)
      setOfflineManifest(manifest)
    } catch {
      setOfflineManifest(loadOfflineManifest(id))
    }
  }

  useEffect(() => {
    if (!eventId) {
      setOfflineManifest(null)
      return
    }
    setOfflineManifest(loadOfflineManifest(eventId))
    if (scanningReady) refreshOfflineManifest(eventId)
  }, [eventId, scanningReady])

  // Load zones + gates only for venue-access events.
  useEffect(() => {
    setZoneId(''); setZones([]); setGateId(''); setGates([]); setMode('qr')
    if (eventId && selectedEvent?.venue_access_enabled) {
      const cached = loadOfflineManifest(eventId)
      api.listZones(eventId).then(setZones).catch(() => setZones(cached?.zones || []))
      api.listGates(eventId).then((g) => {
        setGates(g)
        setScanBy(g.length ? 'gate' : 'zone')
      }).catch(() => {
        const fallbackGates = cached?.gates || []
        setGates(fallbackGates)
        setScanBy(fallbackGates.length ? 'gate' : 'zone')
      })
    }
  }, [eventId]) // eslint-disable-line

  // Section-based scanning: load the sections this staffer is allowed to check
  // into (admin-assigned). Exactly one → auto-route, no picker. Two+ → restore any
  // earlier pick (sessionStorage) and show a picker limited to the allowed set.
  useEffect(() => {
    setTableGroups([]); setSectionId('')
    if (eventId && selectedEvent?.section_mode_enabled) {
      api.myEventSections(eventId).then(({ sections }) => {
        setTableGroups(sections)
        if (sections.length === 1) {
          setSectionId(sections[0].id)
        } else if (sections.length > 1) {
          const saved = sessionStorage.getItem(`scanner_section:${eventId}`)
          if (saved && sections.some((g) => g.id === saved)) setSectionId(saved)
        }
      }).catch(() => {})
    }
  }, [eventId]) // eslint-disable-line

  function chooseSection(id) {
    setSectionId(id)
    if (id) sessionStorage.setItem(`scanner_section:${eventId}`, id)
    else sessionStorage.removeItem(`scanner_section:${eventId}`)
  }

  async function handleScan(raw) {
    const { token, action } = extractScanPayload(raw)
    const scanAction = action || (mode === 'checkout' ? 'checkout' : 'checkin')
    setLoading(true)
    try {
      if (accessMode && scanBy === 'gate') {
        if (!gateId) { setResult({ zoneMode: true, status: 'invalid', message: 'Pick a gate first.' }); return }
        if (!navigator.onLine) {
          offlineAccessScan(token, { mode: 'gate', gateId })
          return
        }
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
        if (!navigator.onLine) {
          offlineAccessScan(token, { mode: 'zone', zoneId, direction: body.direction })
          return
        }
        const res = await api.scanZone(token, body)
        setResult({ zoneMode: true, ...res })
      } else {
        if (scanAction === 'checkout') {
          if (!navigator.onLine) {
            setResult({ status: 'invalid', message: 'Check-out needs a network connection so the exit scan can be recorded.' })
            return
          }
          const res = await api.scanCheckout(token)
          setResult(res)
          refreshOfflineManifest(eventId)
          return
        }
        if (!navigator.onLine) {
          offlineAdmit(token)
          return
        }
        const res = await api.scan(token)
        setResult(res)
        refreshOfflineManifest(eventId)
      }
    } catch (err) {
      if (/failed to fetch|network|load failed/i.test(err.message || '')) {
        if (accessMode && scanBy === 'gate') offlineAccessScan(token, { mode: 'gate', gateId })
        else if (accessMode) offlineAccessScan(token, { mode: 'zone', zoneId, direction: selectedZone?.direction_mode === 'both' ? direction : undefined })
        else if (scanAction === 'checkout') setResult({ status: 'invalid', message: 'Check-out needs a network connection so the exit scan can be recorded.' })
        else offlineAdmit(token)
      } else {
        setResult({ zoneMode: accessMode, status: 'invalid', message: err.message })
      }
    } finally {
      setLoading(false)
    }
  }

  function offlineAdmit(token) {
    const manifest = offlineManifest || loadOfflineManifest(eventId)
    if (!manifest?.guests?.length) {
      setResult({
        status: 'invalid',
        message: 'No offline guest list is cached for this event. Go online once on this scanner to prepare offline check-in.',
      })
      return
    }
    const guest = manifest.guests.find((g) => g.qr_token === token)
    if (!guest) {
      setResult({ status: 'invalid', message: 'Offline guest list does not contain this QR code.' })
      return
    }
    if (guest.admitted) {
      setResult({
        status: 'already_admitted',
        message: `${guest.first_name} ${guest.last_name} was already admitted in the cached guest list.`,
        guest,
        table_name: guest.table_name,
        seat_number: guest.seat_number,
      })
      return
    }
    const admittedAt = new Date().toISOString()
    const nextManifest = {
      ...manifest,
      guests: manifest.guests.map((g) => g.qr_token === token ? { ...g, admitted: true, admitted_at: admittedAt } : g),
    }
    saveOfflineManifest(eventId, nextManifest)
    setOfflineManifest(nextManifest)
    enqueueOfflineAdmission({
      eventId,
      token,
      guestId: guest.id,
      guestName: `${guest.first_name} ${guest.last_name}`,
    })
    setQueuedAdmissions(offlineAdmissionCount())
    setResult({
      status: 'offline_queued',
      message: `${guest.first_name} ${guest.last_name} is checked in on this device. This admission will sync when online.`,
      guest: { ...guest, admitted: true, admitted_at: admittedAt },
      table_name: guest.table_name,
      seat_number: guest.seat_number,
    })
  }

  function offlineZoneOccupancy(manifest, zoneId) {
    const zone = (manifest?.zones || []).find((z) => z.id === zoneId)
    return Math.max(Number(zone?.occupancy || 0), 0)
  }

  function updateManifestForAccessScan(manifest, zoneId, direction, guestId) {
    const next = {
      ...manifest,
      zones: (manifest.zones || []).map((zone) => {
        if (zone.id !== zoneId) return zone
        const delta = direction === 'out' ? -1 : 1
        return { ...zone, occupancy: Math.max(Number(zone.occupancy || 0) + delta, 0) }
      }),
      guests: (manifest.guests || []).map((guest) => {
        if (guest.id !== guestId || direction !== 'in') return guest
        return { ...guest, admitted: true, admitted_at: guest.admitted_at || new Date().toISOString() }
      }),
    }
    saveOfflineManifest(eventId, next)
    setOfflineManifest(next)
  }

  function guestTagNames(manifest, guestId, matchedTagIds) {
    const tags = new Map((manifest.guest_tags || []).map((tag) => [tag.id, tag.name]))
    return matchedTagIds.map((tagId) => tags.get(tagId)).filter(Boolean)
  }

  function offlineAccessDecision(manifest, guest, zone, mode) {
    if (mode === 'gate') {
      const ruleTagIds = new Set((manifest.zone_tag_rules || []).filter((rule) => rule.zone_id === zone.id).map((rule) => rule.tag_id))
      if (ruleTagIds.size) {
        const guestTagIds = new Set((manifest.guest_tag_links || []).filter((link) => link.guest_id === guest.id).map((link) => link.tag_id))
        const matched = [...ruleTagIds].filter((tagId) => guestTagIds.has(tagId))
        if (!matched.length) return { allowed: false, reason: "Guest's tags don't permit this zone", matchedTags: [] }
        return { allowed: true, matchedTags: guestTagNames(manifest, guest.id, matched) }
      }
      return { allowed: true, matchedTags: [] }
    }
    if (guest.ticket_type_id) {
      const ticket = (manifest.ticket_types || []).find((tt) => tt.id === guest.ticket_type_id)
      const allowedZones = ticket?.allowed_zone_ids
      if (Array.isArray(allowedZones) && allowedZones.length && !allowedZones.includes(zone.id)) {
        return { allowed: false, reason: `${ticket?.name || 'This'} ticket is not valid for this zone`, matchedTags: [] }
      }
    }
    return { allowed: true, matchedTags: [] }
  }

  function offlineAccessScan(token, options) {
    const manifest = offlineManifest || loadOfflineManifest(eventId)
    if (!manifest?.guests?.length) {
      setResult({
        zoneMode: true,
        status: 'invalid',
        message: 'No offline guest list is cached for this event. Go online once on this scanner to prepare offline access scanning.',
      })
      return
    }
    const guest = manifest.guests.find((g) => g.qr_token === token)
    if (!guest) {
      setResult({ zoneMode: true, status: 'invalid', message: 'Offline guest list does not contain this QR code.' })
      return
    }
    const gate = options.mode === 'gate' ? (manifest.gates || []).find((g) => g.id === options.gateId && g.is_active !== false) : null
    const zoneIdForScan = gate?.zone_id || options.zoneId
    const zone = (manifest.zones || []).find((z) => z.id === zoneIdForScan && z.is_active !== false)
    if (!zone) {
      setResult({ zoneMode: true, status: 'invalid', message: 'Offline manifest does not contain this active zone or gate.' })
      return
    }
    let scanDirection = gate?.direction || options.direction || (zone.direction_mode === 'exit' ? 'out' : 'in')
    if (zone.direction_mode === 'entry') scanDirection = 'in'
    if (zone.direction_mode === 'exit') scanDirection = 'out'

    const decision = offlineAccessDecision(manifest, guest, zone, options.mode)
    let denied = !decision.allowed
    let denyReason = decision.reason
    const currentOccupancy = offlineZoneOccupancy(manifest, zone.id)
    if (!denied && scanDirection === 'in' && zone.capacity && currentOccupancy >= zone.capacity) {
      denied = true
      denyReason = 'Zone is at capacity in this device cache'
    }

    const guestName = `${guest.first_name} ${guest.last_name || ''}`.trim()
    if (denied) {
      setResult({
        zoneMode: true,
        status: 'denied',
        denied: true,
        guest_name: guestName,
        ticket_type: decision.matchedTags?.join(', ') || undefined,
        zone_name: zone.name,
        direction: scanDirection,
        occupancy: currentOccupancy,
        deny_reason: denyReason,
        message: `Denied offline — ${denyReason}`,
      })
      return
    }

    updateManifestForAccessScan(manifest, zone.id, scanDirection, guest.id)
    enqueueOfflineAccessScan({
      eventId,
      token,
      guestId: guest.id,
      guestName,
      mode: options.mode,
      gateId: gate?.id,
      zoneId: zone.id,
      direction: scanDirection,
    })
    setQueuedAdmissions(offlineAdmissionCount())
    const nextOccupancy = scanDirection === 'out' ? Math.max(currentOccupancy - 1, 0) : currentOccupancy + 1
    setResult({
      zoneMode: true,
      status: 'offline_queued',
      denied: false,
      guest_name: guestName,
      ticket_type: decision.matchedTags?.join(', ') || undefined,
      zone_name: zone.name,
      direction: scanDirection,
      occupancy: nextOccupancy,
      message: `${guestName} — ${scanDirection.toUpperCase()} ${zone.name}. Queued offline and will sync when online.`,
    })
  }

  function reset() {
    setResult(null)
    setScanKey((k) => k + 1)
  }

  async function completeNextStep(step) {
    if (!result?.guest?.event_id || !result?.guest?.id || !step?.id) return
    const payload = {
      status: 'completed',
      metadata: {
        source: 'scanner',
        ...(step.type === 'session_attendance' ? { action: 'session_check_in' } : {}),
      },
    }
    setStepActionLoading(true)
    try {
      await api.updateGuestExperienceStep(result.guest.event_id, result.guest.id, step.id, payload)
      const nextSteps = await api.getExperienceNextSteps(result.guest.event_id, result.guest.id).catch(() => [])
      setResult((prev) => prev ? { ...prev, experience_next_steps: nextSteps } : prev)
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|network|load failed/i.test(err.message || '')) {
        enqueueExperienceStep({
          eventId: result.guest.event_id,
          guestId: result.guest.id,
          stepId: step.id,
          payload,
        })
        setQueuedActions(experienceQueueCount())
        setResult((prev) => prev ? {
          ...prev,
          message: `${prev.message} Step queued and will sync when online.`,
          experience_next_steps: (prev.experience_next_steps || []).filter((item) => item.step.id !== step.id),
        } : prev)
      } else {
        setResult((prev) => prev ? { ...prev, step_error: err.message } : prev)
      }
    } finally {
      setStepActionLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold dark:text-white">Guest check-in</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {scanningReady ? "Start the camera and point it at a guest's QR code." : 'Choose an active event before scanning guests.'}
        </p>
        {queuedActions > 0 && (
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-300">
            {queuedActions} Experience action{queuedActions === 1 ? '' : 's'} pending sync
          </p>
        )}
        {queuedAdmissions > 0 && (
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-300">
            {queuedAdmissions} offline scan{queuedAdmissions === 1 ? '' : 's'} pending sync
          </p>
        )}
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
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Where are you scanning?</label>
              <select className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                value={gateId} onChange={(e) => setGateId(e.target.value)}>
                <option value="">— select gate —</option>
                {gates.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.zone_name} · {g.direction === 'out' ? 'Exit ←' : 'Entry →'}</option>)}
              </select>
              {selectedGate && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Festio checks each guest's ticket rules automatically.
                </p>
              )}
              {!selectedGate && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  To record exits, choose a gate marked Exit. Create exit gates in Event Setup, under Entry areas and Gates.
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Entry / exit area</label>
                <select className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">— select zone —</option>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · inside {z.occupancy}{z.capacity != null ? `/${z.capacity}` : ''}</option>)}
                </select>
                {!selectedZone && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Exit scans require a zone set to Entry & Exit or Exit only.
                  </p>
                )}
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

      {sectionMode && scanningReady && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
          {tableGroups.length === 1 ? (
            <p className="text-sm dark:text-slate-200">
              Section: <strong>{tableGroups[0].name}</strong>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">
                Assigned to you — walk-ins and ungrouped guests you check in are seated here.
              </span>
            </p>
          ) : tableGroups.length > 1 ? (
            <>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                Which section / entrance are you at?
              </label>
              <select
                className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                value={sectionId}
                onChange={(e) => chooseSection(e.target.value)}
              >
                <option value="">— select section —</option>
                {tableGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {sectionId
                  ? 'Walk-ins and ungrouped guests checked in here are seated in this section.'
                  : 'Pick your section once — it applies to every check-in on this device.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              No section is assigned to you yet — ask an admin to assign one on the Event Team page.
            </p>
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
        {!loading && result && !result.zoneMode && (
          <ResultCard result={result} onReset={reset} onStepComplete={completeNextStep} stepActionLoading={stepActionLoading} />
        )}

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
            {(normalCheckoutEnabled || manualWalkInEnabled || selfCheckinEnabled) && (
              <div className="flex gap-2 mb-4">
                {[
                  ['qr', 'QR Scan'],
                  ...(normalCheckoutEnabled ? [['checkout', 'Check-out']] : []),
                  ...(manualWalkInEnabled ? [['manual', 'Manual / Walk-in']] : []),
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
            ) : manualWalkInEnabled && mode === 'manual' ? (
              <ManualCheckin eventId={eventId} manualEnabled={manualEnabled} walkInEnabled={walkInEnabled || manualEnabled}
                sectionMode={sectionMode} sectionId={sectionId} sectionPickable={tableGroups.length > 1}
                onResult={(res) => setResult(res)} />
            ) : (
              <>
                <p className="text-center text-sm text-gray-500 dark:text-slate-400 mb-4">
                  {mode === 'checkout'
                    ? 'Scan the guest ticket or checkout QR to record their exit.'
                    : 'Keep the QR code inside the square until you see a result.'}
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
