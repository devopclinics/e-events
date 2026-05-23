import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { api } from '../api'

function ResultCard({ result, onReset }) {
  const cfg = {
    admitted:        { bg: 'bg-green-500',  icon: '✓', heading: 'ADMITTED' },
    already_admitted:{ bg: 'bg-amber-500',  icon: '⚠', heading: 'ALREADY ADMITTED' },
    invalid:         { bg: 'bg-red-500',    icon: '✕', heading: 'INVALID QR CODE' },
    not_active:      { bg: 'bg-slate-600',  icon: '⏸', heading: 'EVENT NOT ACTIVE' },
    not_assigned:    { bg: 'bg-orange-500', icon: '🚫', heading: 'NOT ASSIGNED' },
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

export default function ScannerPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [scanKey, setScanKey] = useState(0)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (evs.length === 1) setEventId(evs[0].id)
    })
  }, [])

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

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-center dark:text-white">Check-In Scanner</h1>

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
              <option key={ev.id} value={ev.id}>{ev.name} — {ev.couples_name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
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
      </div>

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
    </div>
  )
}
