import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'

const STAT_TEXT = { indigo: 'text-indigo-600', green: 'text-green-600', amber: 'text-amber-600' }
const STAT_BAR  = { indigo: 'bg-indigo-500',  green: 'bg-green-500',  amber: 'bg-amber-500'  }

function StatCard({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-5">
      <div className={`text-4xl font-bold ${STAT_TEXT[color]}`}>{value}</div>
      <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">{label}</div>
      {total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full ${STAT_BAR[color]} rounded-full transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{pct}%</div>
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [stats, setStats] = useState(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (evs.length === 1) setEventId(evs[0].id)
    })
  }, [])

  const fetchStats = useCallback(async (id) => {
    if (!id) return
    try {
      const data = await api.getDashboard(id)
      setStats(data)
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    if (!eventId) return
    fetchStats(eventId)

    if (esRef.current) esRef.current.close()

    const es = new EventSource(`/api/events/${eventId}/stream`)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === 'admitted') {
        setStats((prev) => {
          if (!prev) return prev
          const already = prev.admitted_guests.find((g) => g.id === data.guest_id)
          if (already) return prev
          return {
            ...prev,
            admitted: prev.admitted + 1,
            pending: prev.pending - 1,
            admitted_guests: [
              {
                id: data.guest_id,
                first_name: data.name.split(' ')[0],
                last_name: data.name.split(' ').slice(1).join(' '),
                email: data.email,
                admitted_at: data.admitted_at,
                admitted: true,
              },
              ...prev.admitted_guests,
            ],
          }
        })
      }
    }

    return () => es.close()
  }, [eventId, fetchStats])

  const event = events.find((e) => e.id === eventId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-white">Live Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-slate-600'}`} />
          <span className="text-xs text-gray-500 dark:text-slate-400">{connected ? 'Live' : 'Disconnected'}</span>
        </div>
      </div>

      {events.length > 1 && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
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

      {event && (
        <div className="bg-indigo-600 text-white rounded-xl px-6 py-4">
          <div className="text-xl font-bold">{event.name}</div>
          <div className="text-indigo-200 text-sm mt-0.5">{event.couples_name} · {new Date(event.event_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Guests" value={stats.total} total={stats.total} color="indigo" />
            <StatCard label="Admitted" value={stats.admitted} total={stats.total} color="green" />
            <StatCard label="Pending" value={stats.pending} total={stats.total} color="amber" />
          </div>

          {/* Progress bar */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-5">
            <div className="flex justify-between text-sm font-medium text-gray-600 dark:text-slate-300 mb-2">
              <span>Check-In Progress</span>
              <span>{stats.total > 0 ? Math.round((stats.admitted / stats.total) * 100) : 0}%</span>
            </div>
            <div className="h-4 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: stats.total > 0 ? `${(stats.admitted / stats.total) * 100}%` : '0%' }}
              />
            </div>
            <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{stats.admitted} of {stats.total} guests admitted</div>
          </div>

          {/* Live admitted list */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
            <div className="px-6 py-4 border-b dark:border-slate-700 flex items-center justify-between">
              <h2 className="font-semibold dark:text-white">Admitted Guests</h2>
              <button onClick={() => fetchStats(eventId)} className="text-xs text-indigo-600 hover:underline">Refresh</button>
            </div>
            {stats.admitted_guests.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 dark:text-slate-500 text-sm">No guests admitted yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {stats.admitted_guests.map((g, i) => (
                    <tr key={g.id || i} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                      <td className="px-4 py-3 text-gray-400 dark:text-slate-500">{stats.admitted - i}</td>
                      <td className="px-4 py-3 font-medium dark:text-slate-100">{g.first_name} {g.last_name}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{g.email}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                        {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {!eventId && events.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">No events found. Create one in the Admin panel.</div>
      )}
    </div>
  )
}
