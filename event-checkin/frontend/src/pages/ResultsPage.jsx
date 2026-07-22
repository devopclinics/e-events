import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { fmtEventDateRange } from '../timeutil'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

// New, standalone Results page reading from dashboard-service (/api/results/*) —
// a separate read-only service from the legacy /api/events/:id/dashboard this
// app already uses (see DashboardPage.jsx). Nothing here touches that page or
// its data; this exists to validate the multi-day command-center design before
// any cutover. See docs/MULTI-DAY-DASHBOARD-IMPLEMENTATION-PLAN.md, Track A.

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'meals', label: 'Meals' },
  { id: 'program', label: 'Program' },
  { id: 'experience', label: 'Experience' },
  { id: 'operations', label: 'Operations' },
]

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <div className={`text-3xl font-extrabold ${accent || 'text-slate-900 dark:text-white'}`}>{value ?? '—'}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

const SEVERITY_STYLE = {
  critical: 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800',
  warning: 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800',
}
const SEVERITY_ICON = { critical: '⛔', warning: '⚠️' }

function AttentionPanel({ alerts, onNavigate }) {
  if (!alerts) return null
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <h3 className="font-semibold text-sm dark:text-white mb-3">Needs attention</h3>
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing needs attention right now.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${SEVERITY_STYLE[a.severity] || 'border-slate-200 dark:border-slate-700'}`}>
              <span className="flex items-center gap-2">
                <span>{SEVERITY_ICON[a.severity] || '•'}</span>
                <span className="text-slate-700 dark:text-slate-200">{a.title}</span>
              </span>
              {a.action_label && (
                <button onClick={() => onNavigate?.(a.action_url)} className="shrink-0 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                  {a.action_label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HourlyChart({ hourly }) {
  if (!hourly || hourly.length === 0) {
    return <p className="text-sm text-slate-400">No scans recorded in this window yet.</p>
  }
  const max = Math.max(1, ...hourly.map((h) => h.first_arrival + h.returning + h.exit))
  return (
    <div className="flex items-end gap-1 h-40">
      {hourly.map((h) => {
        const total = h.first_arrival + h.returning + h.exit
        return (
          <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${h.hour} — ${h.first_arrival} first, ${h.returning} returning, ${h.exit} exit`}>
            <div className="w-full flex flex-col justify-end" style={{ height: `${(total / max) * 100}%`, minHeight: total ? 2 : 0 }}>
              {h.exit > 0 && <div className="w-full bg-slate-300 dark:bg-slate-600" style={{ height: `${(h.exit / (total || 1)) * 100}%` }} />}
              {h.returning > 0 && <div className="w-full bg-sky-300 dark:bg-sky-700" style={{ height: `${(h.returning / (total || 1)) * 100}%` }} />}
              {h.first_arrival > 0 && <div className="w-full bg-teal-500 dark:bg-teal-400" style={{ height: `${(h.first_arrival / (total || 1)) * 100}%` }} />}
            </div>
            <div className="text-[9px] text-slate-400 rotate-0">{h.hour}</div>
          </div>
        )
      })}
    </div>
  )
}

function OccupancyBar({ name, occupancy, capacity }) {
  const pct = capacity ? Math.min(100, Math.round((occupancy / capacity) * 100)) : 0
  const color = pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-teal-500'
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-700 dark:text-slate-200">{name}</span>
        <span className="text-slate-500 dark:text-slate-400 tabular-nums">{occupancy}{capacity ? `/${capacity}` : ''}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        {capacity ? <div className={`h-full ${color}`} style={{ width: `${pct}%` }} /> : <div className="h-full bg-slate-300 dark:bg-slate-600 w-full opacity-40" />}
      </div>
    </div>
  )
}

function EmptyFeatureState({ tab }) {
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-8 text-center">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        The {tab} tab isn't built yet — it's next up after Attendance/Overview/Alerts.
      </p>
    </div>
  )
}

export default function ResultsPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useCurrentEvent()
  const [activeTab, setActiveTab] = useState('overview')
  const [day, setDay] = useState('') // '' = entire event
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (!evs.some((e) => e.id === eventId)) setEventId(evs.length === 1 ? evs[0].id : '')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (id, d) => {
    if (!id) return
    setLoading(true)
    try {
      setData(await api.resultsCommandCenter(id, { day: d || undefined }))
      setError('')
    } catch (err) {
      setError(err.message || 'Results are temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!eventId) { setData(null); return }
    load(eventId, day)
    const poll = setInterval(() => load(eventId, day), 20000)
    return () => clearInterval(poll)
  }, [eventId, day, load])

  const event = events.find((e) => e.id === eventId)
  const a = data?.attendance
  const days = data?.attendance_by_day || []

  function navigateTo(url) {
    if (url) window.location.href = url
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Event command center <span className="align-middle ml-1 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Preview</span></h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Multi-day attendance, meals, program, and Experience in one view. Read-only preview — the existing{' '}
            <a href="/dashboard" className="text-teal-600 hover:underline font-semibold">Results page</a> is unaffected.
          </p>
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500">{loading ? 'Refreshing…' : 'Updated just now'}</span>
      </div>

      {events.length > 1 && (
        <select className="w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          value={eventId} onChange={(e) => { setEventId(e.target.value); setDay('') }}>
          <option value="">— select event —</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.couples_name ? `${ev.name} — ${ev.couples_name}` : ev.name}</option>)}
        </select>
      )}

      {event && (
        <div className="bg-gradient-to-br from-teal-600 to-cyan-700 text-white rounded-2xl px-6 py-5">
          <div className="text-xl font-bold">{event.name}</div>
          <div className="text-white/80 text-sm mt-0.5">
            {event.event_end_date ? fmtEventDateRange(event.event_date, event.event_end_date, event.timezone) : new Date(event.event_date).toLocaleDateString()}
            {event.venue_name ? ` · ${event.venue_name}` : ''}
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

      {event && (
        <>
          {/* Scope bar: entire event + one tab per day */}
          {days.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button onClick={() => setDay('')} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold border ${!day ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
                Entire event
              </button>
              {days.map((d, i) => (
                <button key={d.day} onClick={() => setDay(d.day)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold border ${day === d.day ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
                  Day {i + 1} · {fmtDay(d.day)}
                </button>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === t.id ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && a && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard label="Expected" value={a.expected} />
                <MetricCard label="Checked in" value={a.checked_in} />
                <MetricCard label="On-site now" value={a.on_site} sub="entries − exits" accent="text-teal-600 dark:text-teal-400" />
                <MetricCard label="First-time" value={a.first_time} />
                <MetricCard label="Returning" value={a.returning} />
                <MetricCard label="Checked out" value={a.checked_out} />
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                  <h3 className="font-semibold text-sm dark:text-white mb-3">Arrivals &amp; exits</h3>
                  <HourlyChart hourly={a.hourly} />
                  <div className="flex gap-4 mt-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-500" />First arrival</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-300" />Returning</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" />Exit</span>
                  </div>
                </div>
                <AttentionPanel alerts={data.alerts} onNavigate={navigateTo} />
              </div>

              {data.venue_occupancy?.length > 0 && (
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                  <h3 className="font-semibold text-sm dark:text-white mb-3">Live venue occupancy</h3>
                  <div className="space-y-3">
                    {data.venue_occupancy.map((z) => <OccupancyBar key={z.id} {...z} />)}
                  </div>
                </div>
              )}

              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                <h3 className="font-semibold text-sm dark:text-white mb-3">Attendance by day</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
                      <th className="py-2 font-medium">Day</th>
                      <th className="py-2 font-medium">Expected</th>
                      <th className="py-2 font-medium">Checked in</th>
                      <th className="py-2 font-medium">Attendance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d, i) => (
                      <tr key={d.day} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                        <td className="py-2 text-slate-700 dark:text-slate-200">Day {i + 1} · {fmtDay(d.day)}</td>
                        <td className="py-2 tabular-nums">{d.expected}</td>
                        <td className="py-2 tabular-nums">{d.upcoming ? '—' : d.checked_in}</td>
                        <td className="py-2 tabular-nums">{d.upcoming ? 'Upcoming' : `${d.attendance_rate}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'attendance' && a && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard label="Expected" value={a.expected} />
                <MetricCard label="Checked in" value={a.checked_in} />
                <MetricCard label="On-site now" value={a.on_site} />
                <MetricCard label="First-time" value={a.first_time} />
                <MetricCard label="Returning" value={a.returning} />
                <MetricCard label="Checked out" value={a.checked_out} />
              </div>
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                <h3 className="font-semibold text-sm dark:text-white mb-3">Hourly arrivals &amp; exits — {day ? fmtDay(day) : 'entire event'}</h3>
                <HourlyChart hourly={a.hourly} />
              </div>
              {data.venue_occupancy?.length > 0 && (
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                  <h3 className="font-semibold text-sm dark:text-white mb-3">Occupancy by zone</h3>
                  <div className="space-y-3">
                    {data.venue_occupancy.map((z) => <OccupancyBar key={z.id} {...z} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {!['overview', 'attendance'].includes(activeTab) && <EmptyFeatureState tab={TABS.find((t) => t.id === activeTab)?.label} />}
        </>
      )}

      {!event && !error && <p className="text-sm text-slate-400">Select an event to see its command center.</p>}
    </div>
  )
}
