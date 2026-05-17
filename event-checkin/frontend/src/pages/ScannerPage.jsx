import { useState, useEffect, useRef } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
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
  const ref = useRef(null)

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false)
    scanner.render(
      (text) => {
        scanner.clear().catch(() => {})
        onScan(text)
      },
      () => {}
    )
    ref.current = scanner
    return () => {
      ref.current?.clear().catch(() => {})
    }
  }, [onScan])

  return <div id="qr-reader" className="w-full max-w-sm mx-auto" />
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
      <h1 className="text-2xl font-bold text-center">Check-In Scanner</h1>

      {events.length > 1 && (
        <div className="bg-white rounded-xl shadow p-4">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Event</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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

      <div className="bg-white rounded-xl shadow p-6">
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-gray-600">Checking in…</p>
          </div>
        )}

        {!loading && result && <ResultCard result={result} onReset={reset} />}

        {!loading && !result && (
          <div>
            <p className="text-center text-sm text-gray-500 mb-4">
              Point your camera at a guest's QR code
            </p>
            <QrScanner key={scanKey} onScan={handleScan} />
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">Manual Token Entry</p>
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
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            Submit
          </button>
        </form>
      </div>
    </div>
  )
}
