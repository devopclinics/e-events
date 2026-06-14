import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

// ── Small visual pieces ───────────────────────────────────────────────────────
function Donut({ pct, label, sub }) {
  const r = 52, c = 2 * Math.PI * r, off = c - (pct / 100) * c
  return (
    <div className="relative w-36 h-36 shrink-0">
      <svg viewBox="0 0 120 120" className="w-36 h-36 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-slate-100 dark:stroke-slate-700" />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" strokeLinecap="round"
          className="stroke-teal-500 transition-all duration-700" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{pct}%</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
    </div>
  )
}

function Kpi({ label, value, accent = 'text-slate-900 dark:text-white' }) {
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-2xl shadow-sm p-4">
      <div className={`text-3xl font-extrabold ${accent}`}>{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

function Bar({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700">
        {segments.map((s) => s.value > 0 && (
          <div key={s.label} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} /> {s.label} <strong className="text-slate-700 dark:text-slate-200">{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

function Card({ title, children, right }) {
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function DashboardPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useCurrentEvent()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (!evs.some((e) => e.id === eventId)) setEventId(evs.length === 1 ? evs[0].id : '')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStats = useCallback(async (id) => {
    if (!id) return
    try { setStats(await api.getDashboard(id)); setError('') }
    catch (err) { setError(err.message || 'Could not load dashboard'); setStats(null) }
  }, [])

  useEffect(() => {
    if (!eventId) { setStats(null); setError(''); return }
    fetchStats(eventId)
    const poll = setInterval(() => fetchStats(eventId), 20000)   // refresh zones/rsvp/catering

    if (esRef.current) esRef.current.close()
    const es = new EventSource(`/api/events/${eventId}/stream`)
    esRef.current = es
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === 'admitted') {
        setStats((prev) => {
          if (!prev || prev.admitted_guests.find((g) => g.id === data.guest_id)) return prev
          return { ...prev, admitted: prev.admitted + 1, pending: Math.max(prev.pending - 1, 0),
            admitted_guests: [{ id: data.guest_id, first_name: data.name.split(' ')[0],
              last_name: data.name.split(' ').slice(1).join(' '), email: data.email,
              admitted_at: data.admitted_at, admitted: true }, ...prev.admitted_guests] }
        })
      }
    }
    return () => { es.close(); clearInterval(poll) }
  }, [eventId, fetchStats])

  const event = events.find((e) => e.id === eventId)
  const pct = stats && stats.total > 0 ? Math.round((stats.admitted / stats.total) * 100) : 0

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Event Results</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Track RSVPs, check-ins, and live attendance.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-slate-600'}`} />
          <span className="text-xs text-gray-500 dark:text-slate-400">{connected ? 'Live updates on' : 'Refreshing every 20s'}</span>
        </div>
      </div>

      {events.length > 1 && (
        <select className="w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">— select event —</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.couples_name ? `${ev.name} — ${ev.couples_name}` : ev.name}</option>)}
        </select>
      )}

      {event && (
        <div className="bg-gradient-to-br from-teal-600 to-cyan-700 text-white rounded-2xl px-6 py-5">
          <div className="text-xl font-bold">{event.name}</div>
          <div className="text-white/80 text-sm mt-0.5">{event.couples_name ? `${event.couples_name} · ` : ''}{new Date(event.event_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
      )}

      {error && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {stats && (
        <>
          {stats.total === 0 ? (
            <Card title="No guests yet">
              <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Import guests in Event Setup to start tracking RSVPs, invitations, and check-ins.
              </div>
            </Card>
          ) : (
          <>
          {/* Hero: donut + KPIs */}
          <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-center bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-2xl shadow-sm p-5">
            <Donut pct={pct} label="checked in" sub={`${stats.admitted}/${stats.total}`} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
              <Kpi label="Total guests" value={stats.total} />
              <Kpi label="Checked in" value={stats.admitted} accent="text-green-600" />
              <Kpi label="Not yet in" value={stats.pending} accent="text-amber-600" />
              <Kpi label="RSVP confirmed" value={stats.rsvp_confirmed} accent="text-teal-600" />
            </div>
          </div>

          {/* RSVP breakdown */}
          {(stats.rsvp_confirmed + stats.rsvp_declined + stats.rsvp_pending + stats.rsvp_invited) > 0 && (
            <Card title="RSVP progress">
              <Bar segments={[
                { label: 'Confirmed', value: stats.rsvp_confirmed, color: 'bg-green-500' },
                { label: 'Declined', value: stats.rsvp_declined, color: 'bg-red-400' },
                { label: 'Pending', value: stats.rsvp_pending, color: 'bg-amber-400' },
                { label: 'No reply', value: stats.rsvp_invited, color: 'bg-slate-300 dark:bg-slate-600' },
              ]} />
            </Card>
          )}
          </>
          )}

          {/* Venue access occupancy */}
          {stats.zones && stats.zones.length > 0 && (
            <Card title="Live zone occupancy">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {stats.zones.map((z) => (
                  <div key={z.name} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-center">
                    <div className="text-2xl font-extrabold text-teal-600">{z.inside}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{z.name}{z.capacity != null ? ` · cap ${z.capacity}` : ''}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Orders */}
          {stats.catering_total != null && (
            <Card title="Orders served" right={<span className="text-xs text-slate-400">{stats.catering_served}/{stats.catering_total}</span>}>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: stats.catering_total > 0 ? `${(stats.catering_served / stats.catering_total) * 100}%` : '0%' }} />
              </div>
            </Card>
          )}

          {/* Per-table report — for table-assigned staff */}
          {stats.tables && stats.tables.length > 0 && (
            <Card title="By table">
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="text-left font-semibold px-2 py-2">Table</th>
                      <th className="text-right font-semibold px-2 py-2">Seated</th>
                      <th className="text-right font-semibold px-2 py-2">Checked in</th>
                      <th className="text-right font-semibold px-2 py-2">Served</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {stats.tables.map((t) => {
                      const full = t.capacity ? t.seated >= t.capacity : false
                      return (
                        <tr key={t.name}>
                          <td className="px-2 py-2 font-medium dark:text-slate-100">
                            {t.name}
                            {t.capacity != null && <span className={`text-xs ml-2 ${full ? 'text-red-500' : 'text-slate-400'}`}>{t.seated}/{t.capacity}</span>}
                          </td>
                          <td className="px-2 py-2 text-right dark:text-slate-300">{t.seated}</td>
                          <td className="px-2 py-2 text-right">
                            <span className={t.checked_in === t.seated && t.seated > 0 ? 'text-green-600 font-semibold' : 'text-slate-500 dark:text-slate-400'}>{t.checked_in}</span>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-500 dark:text-slate-400">{t.served}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Live activity feed */}
          <Card title="Recent check-ins" right={<button onClick={() => fetchStats(eventId)} className="text-xs text-teal-600 hover:underline">Refresh</button>}>
            {stats.admitted_guests.length === 0 ? (
              <div className="py-8 text-center text-gray-400 dark:text-slate-500 text-sm">
                No check-ins yet. When staff scan tickets, arrivals will appear here.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700 -mx-1">
                {stats.admitted_guests.slice(0, 50).map((g, i) => (
                  <div key={g.id || i} className="flex items-center gap-3 py-2.5 px-1">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 grid place-items-center text-sm font-bold shrink-0">
                      {(g.first_name || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm dark:text-slate-100 truncate">{g.first_name} {g.last_name}</div>
                      <div className="text-xs text-slate-400 truncate">{g.email}</div>
                    </div>
                    <div className="text-xs text-slate-400 shrink-0">{g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {!eventId && events.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          <div className="font-semibold text-slate-600 dark:text-slate-300">No events yet</div>
          <div className="text-sm mt-1">Create an event in Event Setup to see RSVP and check-in results here.</div>
        </div>
      )}
    </div>
  )
}
