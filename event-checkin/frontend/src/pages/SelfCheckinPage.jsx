import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

function StatusCard({ tone, title, children }) {
  const tones = {
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-100',
    amber: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-100',
    red: 'bg-red-50 border-red-200 text-red-900 dark:bg-red-900/30 dark:border-red-800 dark:text-red-100',
    slate: 'bg-slate-50 border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100',
  }
  return (
    <div className={`rounded-2xl border p-5 text-center shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="text-lg font-bold">{title}</div>
      {children && <div className="mt-2 text-sm opacity-90">{children}</div>}
    </div>
  )
}

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function SelfCheckinPage() {
  const { code } = useParams()
  const [eventName, setEventName] = useState('')
  const [pageStatus, setPageStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [checkin, setCheckin] = useState(null)

  useEffect(() => {
    let active = true
    api.selfCheckinInfo(code)
      .then((res) => {
        if (!active) return
        setPageStatus(res.status)
        setEventName(res.name || '')
        setMessage(res.message || '')
      })
      .catch(() => {
        if (!active) return
        setPageStatus('invalid')
        setMessage('This check-in link is not valid.')
      })
    return () => { active = false }
  }, [code])

  useEffect(() => {
    const term = query.trim()
    setSelected(null)
    setCheckin(null)
    if (pageStatus !== 'ok' || term.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.selfCheckinSearch(code, term)
        if (!active) return
        if (res.status !== 'ok') {
          setPageStatus(res.status)
          setMessage(res.message || '')
          setResults([])
        } else {
          setResults(res.guests || [])
        }
      } catch (e) {
        if (active) setMessage(e.message)
      } finally {
        if (active) setSearching(false)
      }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [code, pageStatus, query])

  async function confirmCheckin() {
    if (!selected) return
    setSearching(true)
    try {
      const res = await api.selfCheckinAdmit(code, selected.id)
      setCheckin(res)
    } catch (e) {
      setCheckin({ status: 'invalid', message: e.message })
    } finally {
      setSearching(false)
    }
  }

  let body
  if (pageStatus === 'loading') {
    body = <StatusCard tone="slate" title="Loading check-in..." />
  } else if (pageStatus !== 'ok') {
    body = (
      <StatusCard tone={pageStatus === 'not_active' ? 'amber' : 'red'} title={eventName || 'Check-in unavailable'}>
        {message || 'Please speak to the organizer.'}
      </StatusCard>
    )
  } else if (checkin) {
    const admittedName = checkin.admitted_guest || selected?.name || 'Guest'
    if (checkin.status === 'admitted') {
      body = (
        <StatusCard tone="green" title="You are checked in">
          <div className="font-semibold">{admittedName}</div>
          {(checkin.table_name || checkin.seat_number) && (
            <div className="mt-3 flex justify-center gap-2 text-xs">
              {checkin.table_name && <span className="rounded-full bg-white/60 dark:bg-white/10 px-3 py-1">Table {checkin.table_name}</span>}
              {checkin.seat_number && <span className="rounded-full bg-white/60 dark:bg-white/10 px-3 py-1">Seat {checkin.seat_number}</span>}
            </div>
          )}
        </StatusCard>
      )
    } else if (checkin.status === 'already_admitted') {
      body = (
        <StatusCard tone="amber" title="Already checked in">
          <div>{admittedName}</div>
          {formatTime(checkin.admitted_at) && <div className="mt-1">Checked in at {formatTime(checkin.admitted_at)}</div>}
        </StatusCard>
      )
    } else if (checkin.status === 'no_seat_available') {
      body = (
        <StatusCard tone="red" title="No seat available">
          {checkin.message || 'Please speak to the organizer to be seated.'}
        </StatusCard>
      )
    } else {
      body = (
        <StatusCard tone="red" title="Not on the list">
          {checkin.message || 'Please speak to the organizer.'}
        </StatusCard>
      )
    }
  } else if (selected) {
    body = (
      <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-sm text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">Is this you?</p>
        <p className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{selected.name}</p>
        <div className="mt-5 flex gap-3">
          <button onClick={() => setSelected(null)}
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
            No
          </button>
          <button onClick={confirmCheckin} disabled={searching}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            {searching ? 'Checking in...' : 'Yes, check me in'}
          </button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="space-y-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search your name or phone"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-4 text-base text-slate-950 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {searching && <p className="text-center text-sm text-slate-500 dark:text-slate-400">Searching...</p>}
        {message && <p className="text-center text-sm text-red-600 dark:text-red-300">{message}</p>}
        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <StatusCard tone="red" title="Not on the list">
            Speak to organizer
          </StatusCard>
        )}
        <div className="space-y-2">
          {results.map((guest) => (
            <button key={guest.id} onClick={() => setSelected(guest)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-4 text-left font-semibold text-slate-950 dark:text-white shadow-sm hover:border-teal-400">
              {guest.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-950 px-4 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-sm font-bold text-white">F</div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">{eventName || 'Event check-in'}</h1>
          {pageStatus === 'ok' && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Find your name to check in.</p>}
        </div>
        {body}
      </div>
    </main>
  )
}
