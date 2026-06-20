import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusCard({ status, message, tableName, seatNumber, onReset }) {
  const cfg = {
    admitted:          { bg: 'bg-green-500', icon: '✓', heading: 'ADMITTED' },
    already_admitted:  { bg: 'bg-amber-500', icon: '⚠', heading: 'ALREADY ADMITTED' },
    not_found:         { bg: 'bg-red-500', icon: '✕', heading: 'INVALID QR CODE' },
    no_seat_available: { bg: 'bg-red-700', icon: '🚫', heading: 'ENTRY DENIED - CONTACT ORGANIZER' },
    not_active:        { bg: 'bg-slate-600', icon: '⏸', heading: 'EVENT NOT ACTIVE' },
  }[status] || { bg: 'bg-gray-500', icon: '?', heading: 'UNKNOWN' }

  return (
    <div className={`${cfg.bg} text-white rounded-2xl p-8 text-center shadow-2xl`}>
      <div className="text-7xl font-bold mb-2">{cfg.icon}</div>
      <div className="text-2xl font-bold mb-1">{cfg.heading}</div>
      <p className="mt-2 text-white/90">{message}</p>
      {(tableName || seatNumber) && (
        <div className="mt-3 flex justify-center gap-4 text-sm text-white/90">
          {tableName && (
            <span className="bg-white/20 px-3 py-1 rounded-full">
              Table: <strong>{tableName}</strong>
            </span>
          )}
          {seatNumber && (
            <span className="bg-white/20 px-3 py-1 rounded-full">
              Seat: <strong>{seatNumber}</strong>
            </span>
          )}
        </div>
      )}
      <button
        onClick={onReset}
        className="mt-8 bg-white/20 hover:bg-white/30 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
      >
        Back
      </button>
    </div>
  )
}

function GuestRow({ guest, onSelect }) {
  return (
    <button
      onClick={() => onSelect(guest)}
      className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-gray-800 dark:text-white">
            {guest.first_name} {guest.last_name}
          </p>
          {guest.admitted && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Already checked in</p>
          )}
        </div>
        <span className="text-teal-500 text-lg">→</span>
      </div>
    </button>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SelfCheckinPage() {
  const { code } = useParams()
  const [eventInfo, setEventInfo] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [selected, setSelected] = useState(null)   // guest to confirm
  const [result, setResult] = useState(null)        // SelfCheckinResult
  const [confirming, setConfirming] = useState(false)

  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  // Load event info on mount
  useEffect(() => {
    api.selfCheckinEvent(code)
      .then((data) => {
        if (data.detail) throw new Error(data.detail)
        setEventInfo(data)
      })
      .catch((e) => setLoadError(e.message || 'Event not found'))
  }, [code])

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const data = await api.selfCheckinSearch(code, query.trim())
        if (Array.isArray(data)) {
          setResults(data)
          if (data.length === 0) setSearchError('No one found with that name or number.')
        } else {
          setSearchError(data.detail || 'Search failed.')
          setResults([])
        }
      } catch {
        setSearchError('Search failed. Please try again.')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [query, code])

  async function confirm() {
    if (!selected) return
    setConfirming(true)
    try {
      const data = await api.selfCheckinConfirm(code, selected.id)
      setResult(data)
      setSelected(null)
    } catch {
      setResult({ status: 'not_found', message: 'Something went wrong. Please try again or speak to the organizer.' })
    } finally {
      setConfirming(false)
    }
  }

  function reset() {
    setResult(null)
    setSelected(null)
    setQuery('')
    setResults([])
    setSearchError(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🔍</div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-white mb-2">Event Not Found</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!eventInfo) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-white dark:from-slate-900 dark:to-slate-800 flex flex-col items-center py-10 px-4">
      {/* Header */}
      <div className="text-center mb-8 max-w-sm w-full">
        <div className="inline-flex items-center gap-2 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 px-4 py-1.5 rounded-full text-xs font-semibold mb-4">
          <span>🎟️</span> Guest Check-in
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{eventInfo.name}</h1>
        {eventInfo.couples_name && (
          <p className="text-gray-500 dark:text-slate-400 mt-1 text-sm">{eventInfo.couples_name}</p>
        )}
        {eventInfo.status !== 'active' && (
          <div className="mt-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400">
            This event is not currently active. Check-in is unavailable.
          </div>
        )}
      </div>

      <div className="w-full max-w-sm space-y-4">
        {/* Result view */}
        {result && (
          <StatusCard
            status={result.status}
            message={result.message}
            tableName={result.table_name}
            seatNumber={result.seat_number}
            onReset={reset}
          />
        )}

        {/* Confirmation view */}
        {!result && selected && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 p-6 text-center">
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">Is this you?</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white mb-6">
              {selected.first_name} {selected.last_name}
            </p>
            <button
              onClick={confirm}
              disabled={confirming}
              className="w-full py-3.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-semibold text-base transition-colors mb-3"
            >
              {confirming ? 'Checking in…' : 'Yes, Check Me In ✓'}
            </button>
            <button
              onClick={() => setSelected(null)}
              disabled={confirming}
              className="w-full py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              That's not me
            </button>
          </div>
        )}

        {/* Search view */}
        {!result && !selected && eventInfo.status === 'active' && (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 p-4">
              <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2">
                Enter your first name, last name, or phone number
              </label>
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Smith or +234…"
                className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>

            {searching && (
              <div className="text-center text-sm text-gray-400 dark:text-slate-500">Searching…</div>
            )}

            {searchError && !searching && (
              <p className="text-sm text-red-500 text-center">{searchError}</p>
            )}

            {results.length > 0 && !searching && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center">Tap your name to check in</p>
                {results.map((g) => (
                  <GuestRow key={g.id} guest={g} onSelect={setSelected} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-10 text-[10px] text-gray-300 dark:text-slate-600">Powered by EventQR</p>
    </div>
  )
}
