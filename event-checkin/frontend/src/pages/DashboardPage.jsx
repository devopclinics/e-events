import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { auth } from '../firebase'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeSince(iso) {
  if (!iso) return null
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, total, color, sub }) {
  const colors = {
    indigo: { text: 'text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-500' },
    green:  { text: 'text-green-600  dark:text-green-400',  bar: 'bg-green-500'  },
    amber:  { text: 'text-amber-600  dark:text-amber-400',  bar: 'bg-amber-500'  },
    red:    { text: 'text-red-600    dark:text-red-400',    bar: 'bg-red-500'    },
    teal:   { text: 'text-teal-600   dark:text-teal-400',   bar: 'bg-teal-500'   },
    purple: { text: 'text-purple-600 dark:text-purple-400', bar: 'bg-purple-500' },
    slate:  { text: 'text-slate-600  dark:text-slate-300',  bar: 'bg-slate-400'  },
  }
  const c = colors[color] || colors.indigo
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-5">
      <div className={`text-4xl font-bold ${c.text}`}>{value}</div>
      <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</div>}
      {total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full ${c.bar} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{pct}%</div>
        </div>
      )}
    </div>
  )
}

function Timeline({ data }) {
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm dark:text-white">Arrival Rate — last 2 hours</h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">15-min buckets</span>
      </div>
      <div className="flex items-end gap-1.5 h-20">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-none">{d.count > 0 ? d.count : ''}</div>
            <div
              className={`w-full rounded-t transition-all duration-500 ${d.count > 0 ? 'bg-teal-500' : 'bg-slate-100 dark:bg-slate-700'}`}
              style={{ height: `${Math.max(4, (d.count / max) * 56)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-slate-400 dark:text-slate-500 truncate">{d.label}</div>
        ))}
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [events, setEvents]       = useState([])
  const [eventId, setEventId]     = useState('')
  const [stats, setStats]         = useState(null)
  const [connected, setConnected] = useState(false)
  const [search, setSearch]       = useState('')
  const [tick, setTick]           = useState(0)   // for "time since" refresh
  const esRef = useRef(null)

  // refresh "X ago" every 30s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (evs.length === 1) setEventId(evs[0].id)
    })
  }, [])

  const fetchStats = useCallback(async (id) => {
    if (!id) return
    try { setStats(await api.getDashboard(id)) }
    catch (err) { console.error(err) }
  }, [])

  useEffect(() => {
    if (!eventId) return
    fetchStats(eventId)
    if (esRef.current) esRef.current.close()

    auth.currentUser?.getIdToken().then((token) => {
      const es = new EventSource(`/api/events/${eventId}/stream?token=${encodeURIComponent(token)}`)
      esRef.current = es
      es.onopen  = () => setConnected(true)
      es.onerror = () => setConnected(false)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'admitted') {
          setStats((prev) => {
            if (!prev) return prev
            if (prev.admitted_guests.find((g) => g.id === data.guest_id)) return prev
            const newGuest = {
              id: data.guest_id,
              first_name: data.name.split(' ')[0],
              last_name: data.name.split(' ').slice(1).join(' '),
              email: data.email,
              admitted_at: data.admitted_at,
              admitted: true,
              is_vip: data.is_vip || false,
              seat_number: data.seat_number || null,
              table_id: data.table_id || null,
            }
            return {
              ...prev,
              admitted: prev.admitted + 1,
              pending: prev.pending - 1,
              last_admitted_at: data.admitted_at,
              admitted_guests: [newGuest, ...prev.admitted_guests],
            }
          })
        }
      }
    })
    return () => { if (esRef.current) esRef.current.close() }
  }, [eventId, fetchStats])

  const event = events.find((e) => e.id === eventId)

  // admissions in recent windows (derived from admitted_guests)
  const recentWindow = (mins) =>
    stats?.admitted_guests.filter(
      (g) => g.admitted_at && (Date.now() - new Date(g.admitted_at)) < mins * 60_000
    ).length ?? 0

  const filteredAdmitted = search.trim()
    ? (stats?.admitted_guests || []).filter((g) => {
        const name = `${g.first_name} ${g.last_name}`.toLowerCase()
        return name.includes(search.toLowerCase()) || (g.email || '').toLowerCase().includes(search.toLowerCase())
      })
    : (stats?.admitted_guests || [])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-white">Live Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchStats(eventId)}
            disabled={!eventId}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40">
            Refresh
          </button>
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-slate-600'}`} />
            <span className="text-xs text-gray-500 dark:text-slate-400">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Event selector */}
      {events.length > 1 && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
          <select
            className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}>
            <option value="">— select event —</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} — {ev.couples_name}</option>)}
          </select>
        </div>
      )}

      {/* Event banner */}
      {event && (
        <div className="bg-gradient-to-r from-indigo-600 to-teal-600 text-white rounded-xl px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xl font-bold">{event.name}</div>
            <div className="text-indigo-100 text-sm mt-0.5">
              {event.couples_name} · {new Date(event.event_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          {stats?.last_admitted_at && (
            <div className="text-right">
              <div className="text-xs text-indigo-200">Last scan</div>
              <div className="text-sm font-semibold">{timeSince(stats.last_admitted_at)}</div>
              <div className="text-xs text-indigo-200">{fmtTime(stats.last_admitted_at)}</div>
            </div>
          )}
        </div>
      )}

      {stats && (
        <>
          {/* Primary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Guests"  value={stats.total}    total={stats.total} color="indigo" />
            <StatCard label="Admitted"      value={stats.admitted} total={stats.total} color="green"
              sub={`${stats.total > 0 ? Math.round(stats.admitted / stats.total * 100) : 0}% check-in rate`} />
            <StatCard label="Pending"       value={stats.pending}  total={stats.total} color="amber" />
            <StatCard label="VIP Admitted"  value={stats.vip_admitted} total={stats.vip_total || undefined} color="purple"
              sub={stats.vip_total > 0 ? `${stats.vip_total} VIP total` : 'No VIPs'} />
          </div>

          {/* Check-in progress bar */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-5">
            <div className="flex justify-between text-sm font-medium text-gray-600 dark:text-slate-300 mb-2">
              <span>Check-In Progress</span>
              <span className="tabular-nums">{stats.admitted} / {stats.total}</span>
            </div>
            <div className="h-4 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-green-500 rounded-full transition-all duration-500"
                style={{ width: stats.total > 0 ? `${(stats.admitted / stats.total) * 100}%` : '0%' }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-gray-400 dark:text-slate-500">{stats.admitted} admitted</span>
              <span className="text-xs text-gray-400 dark:text-slate-500">{stats.pending} still expected</span>
            </div>
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 text-center">
              <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">{recentWindow(15)}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Last 15 min</div>
            </div>
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 text-center">
              <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">{recentWindow(60)}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Last 60 min</div>
            </div>
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 text-center">
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.invited}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Invites sent</div>
            </div>
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 text-center">
              <div className={`text-2xl font-bold ${stats.no_qr > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400 dark:text-slate-500'}`}>{stats.no_qr}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">No QR code</div>
            </div>
          </div>

          {/* Invite health row */}
          {(stats.invite_failed > 0 || stats.no_phone > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {stats.invite_failed > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.invite_failed}</div>
                  <div>
                    <div className="text-sm font-semibold text-red-700 dark:text-red-300">Invite failed</div>
                    <div className="text-xs text-red-500 dark:text-red-400">No reachable channel</div>
                  </div>
                </div>
              )}
              {stats.no_phone > 0 && (
                <div className="bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-xl p-4 flex items-center gap-3">
                  <div className="text-2xl font-bold text-slate-500 dark:text-slate-300">{stats.no_phone}</div>
                  <div>
                    <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">No phone</div>
                    <div className="text-xs text-slate-400">Email only</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Arrival timeline chart */}
          {stats.admitted_timeline && <Timeline data={stats.admitted_timeline} />}

          {/* Seating section */}
          {stats.seating_enabled && stats.tables.length > 0 && (
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-sm dark:text-white">Seating Overview</h2>
                <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span>Capacity: <strong className="text-slate-700 dark:text-slate-200">{stats.total_seats}</strong></span>
                  <span className="text-teal-600 dark:text-teal-400">Assigned: <strong>{stats.seats_assigned}</strong></span>
                  <span className="text-green-600 dark:text-green-400">Seated: <strong>{stats.seats_seated}</strong></span>
                  <span className={stats.total_seats - stats.seats_assigned > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}>
                    Empty: <strong>{stats.total_seats - stats.seats_assigned}</strong>
                  </span>
                </div>
              </div>

              {/* Overall seat fill bar */}
              <div>
                <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500 rounded-full transition-all duration-500"
                    style={{ width: stats.total_seats > 0 ? `${(stats.seats_assigned / stats.total_seats) * 100}%` : '0%' }}
                  />
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  {stats.total_seats > 0 ? Math.round((stats.seats_assigned / stats.total_seats) * 100) : 0}% of seats assigned
                </div>
              </div>

              {/* Per-table grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {stats.tables.map((t) => {
                  const fillPct = t.capacity > 0 ? Math.round((t.assigned / t.capacity) * 100) : 0
                  const isEmpty = t.assigned === 0
                  const isPartial = t.assigned > 0 && t.assigned < t.capacity
                  const isFull = t.assigned >= t.capacity

                  let borderCls, bgCls, labelCls
                  if (isEmpty) {
                    borderCls = 'border-red-300 dark:border-red-700'
                    bgCls     = 'bg-red-50 dark:bg-red-900/20'
                    labelCls  = 'text-red-600 dark:text-red-400'
                  } else if (isPartial) {
                    borderCls = 'border-amber-300 dark:border-amber-700'
                    bgCls     = 'bg-amber-50 dark:bg-amber-900/20'
                    labelCls  = 'text-amber-600 dark:text-amber-400'
                  } else {
                    borderCls = 'border-green-300 dark:border-green-700'
                    bgCls     = 'bg-green-50 dark:bg-green-900/20'
                    labelCls  = 'text-green-600 dark:text-green-400'
                  }

                  return (
                    <div key={t.id} className={`border rounded-lg p-3 ${borderCls} ${bgCls}`}>
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{t.name}</span>
                        {isEmpty && <span className="text-[10px] font-bold text-red-600 dark:text-red-400 shrink-0">EMPTY</span>}
                      </div>
                      <div className={`text-lg font-bold mt-1 ${labelCls}`}>
                        {t.assigned}<span className="text-xs font-normal text-slate-400 dark:text-slate-500">/{t.capacity}</span>
                      </div>
                      <div className="h-1 bg-white/60 dark:bg-slate-700/60 rounded-full overflow-hidden mt-1.5">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${isEmpty ? 'bg-red-400' : isPartial ? 'bg-amber-400' : 'bg-green-500'}`}
                          style={{ width: `${fillPct}%` }}
                        />
                      </div>
                      {t.admitted > 0 && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{t.admitted} checked in</div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="flex gap-4 text-[10px] text-slate-400 dark:text-slate-500 pt-1">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Empty (no guests assigned)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Partial</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Full</span>
              </div>
            </div>
          )}

          {/* Admitted guests list */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
            <div className="px-6 py-4 border-b dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold dark:text-white shrink-0">
                Admitted Guests <span className="text-sm font-normal text-gray-400 dark:text-slate-500">({stats.admitted})</span>
              </h2>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search admitted…"
                className="border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-400 w-48"
              />
            </div>
            {filteredAdmitted.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 dark:text-slate-500 text-sm">
                {stats.admitted === 0 ? 'No guests admitted yet.' : 'No match for that search.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell">Email</th>
                      <th className="px-4 py-3 text-center hidden sm:table-cell">Seat</th>
                      <th className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {filteredAdmitted.map((g, i) => (
                      <tr key={g.id || i} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                        <td className="px-4 py-3 text-gray-400 dark:text-slate-500 tabular-nums">{stats.admitted - i}</td>
                        <td className="px-4 py-3 font-medium dark:text-slate-100">
                          <div className="flex items-center gap-1.5">
                            {g.first_name} {g.last_name}
                            {g.is_vip && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">VIP</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-slate-400 hidden sm:table-cell">{g.email}</td>
                        <td className="px-4 py-3 text-center text-gray-500 dark:text-slate-400 hidden sm:table-cell">
                          {g.seat_number || '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400 tabular-nums">
                          {fmtTime(g.admitted_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!eventId && events.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          No events found. Create one in the Admin panel.
        </div>
      )}
    </div>
  )
}
