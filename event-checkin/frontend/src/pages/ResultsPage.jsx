import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api'
import { fmtEventDateRange } from '../timeutil'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { auth } from '../firebase'

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

// Hover/focus tooltip explaining what a metric actually counts — several of
// these (Expected vs Confirmed, First-time vs Returning, arrival-gap labels)
// mean something more specific than the label alone suggests. Native `title`
// keeps this dependency-free; aria-label gives screen readers the same text.
function MetricHint({ text }) {
  return (
    <span
      tabIndex={0}
      title={text}
      aria-label={text}
      className="inline-grid place-items-center w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-600 text-[9px] font-bold leading-none text-slate-400 dark:text-slate-500 cursor-help shrink-0 hover:border-slate-400 hover:text-slate-500 dark:hover:text-slate-400"
    >
      ?
    </span>
  )
}

function MetricCard({ icon, tint, label, value, sub, accent, hint }) {
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <div className="flex items-center gap-3">
        {icon && (
          <span className={`grid place-items-center w-9 h-9 rounded-full text-base shrink-0 ${tint || 'bg-teal-50 dark:bg-teal-900/30'}`}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-bold text-slate-600 dark:text-slate-300 leading-snug mb-2">
            <span>{label}</span>
            {hint && <MetricHint text={hint} />}
          </div>
          <div className={`text-2xl font-extrabold leading-tight tabular-nums ${accent || 'text-slate-900 dark:text-white'}`}>{value ?? '—'}</div>
        </div>
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-2">{sub}</div>}
    </div>
  )
}

function Donut({ pct, label, sub }) {
  const r = 46, c = 2 * Math.PI * r, off = c - (Math.min(pct, 100) / 100) * c
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg viewBox="0 0 108 108" className="w-32 h-32 -rotate-90">
        <circle cx="54" cy="54" r={r} fill="none" strokeWidth="11" className="stroke-slate-100 dark:stroke-slate-700" />
        <circle cx="54" cy="54" r={r} fill="none" strokeWidth="11" strokeLinecap="round"
          className="stroke-teal-500 transition-all duration-700" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{pct}%</div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 text-center px-2 leading-tight">{label}</div>
      </div>
      {sub && <div className="text-[10px] text-slate-400 text-center mt-1">{sub}</div>}
    </div>
  )
}

function RsvpFunnel({ funnel, showEntireEventBadge }) {
  if (!funnel) return null
  const steps = [
    { label: 'Guests', value: funnel.guests, sub: 'Total guest list' },
    { label: 'Invited', value: funnel.invited, sub: 'Invitations actually sent' },
    { label: 'Responded', value: funnel.responded, sub: 'Guests who replied' },
    { label: 'Confirmed', value: funnel.confirmed, sub: 'Guests who accepted' },
    { label: 'Checked in', value: funnel.checked_in, sub: 'Guests who arrived' },
  ]
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <h3 className="font-semibold text-sm dark:text-white mb-3">RSVP funnel{showEntireEventBadge && <EntireEventBadge />}</h3>
      <div className="flex items-center gap-3 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-3 shrink-0">
            <div className="text-center">
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">{s.value}</div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{s.label}</div>
              <div className="text-[10px] text-slate-400 max-w-[110px]">{s.sub}</div>
            </div>
            {i < steps.length - 1 && <span className="text-slate-300 dark:text-slate-600 text-lg">→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function CommHealthCard({ comm, showEntireEventBadge }) {
  if (!comm) return null
  const rows = [
    { icon: '✉️', label: 'Email reached', data: comm.email },
    { icon: '💬', label: 'SMS delivered', data: comm.sms },
    { icon: '🟢', label: 'WhatsApp delivered', data: comm.whatsapp },
  ]
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm dark:text-white">Communication health{showEntireEventBadge && <EntireEventBadge />}</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">💳 {comm.credits_remaining?.toLocaleString()} credits</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.label} className="text-center">
            <div className="text-xl">{r.icon}</div>
            <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">{r.data.rate === null ? '—' : `${r.data.rate}%`}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecentActivity({ items }) {
  if (!items) return null
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <h3 className="font-semibold text-sm dark:text-white mb-3">Recent activity</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No activity yet.</p>
      ) : (
        <div className="space-y-2.5 max-h-72 overflow-y-auto">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-300 shrink-0">
                {it.guest_name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1 truncate">
                <span className="text-slate-700 dark:text-slate-200">{it.action}</span>
                {it.location && <span className="text-slate-400"> · {it.location}</span>}
              </div>
              <span className="text-xs text-slate-400 shrink-0">{new Date(it.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const SEVERITY_STYLE = {
  critical: 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800',
  warning: 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800',
}
const SEVERITY_ICON = { critical: '⛔', warning: '⚠️' }
// Alert types with a real guest-level resolution list behind them (see
// dashboard-service GET /alerts/{alert_id}/guests). low_credits and
// zone_capacity's aggregate-only cousins aren't guest-scoped so they're
// excluded on purpose.
const GUEST_LIST_ALERT_TYPES = new Set([
  'failed_invitations', 'no_contact_info', 'tables_over_capacity',
  'missing_meal_selection', 'unsigned_consent', 'denied_scans', 'zone_capacity',
])

// Shared by the alert panel ("View guests") and the Experience journey card
// ("View blocked guests") — both resolve to a concrete guest list instead of
// just a count, fetched lazily only once expanded.
function InlineGuestList({ eventId, kind, resourceId }) {
  const [state, setState] = useState({ loading: true, error: '', guests: null })
  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: '', guests: null })
    const promise = kind === 'step'
      ? api.resultsExperienceStepGuests(eventId, resourceId)
      : api.resultsAlertGuests(eventId, resourceId)
    promise.then((res) => {
      if (!cancelled) setState({ loading: false, error: '', guests: res.guests })
    }).catch(() => {
      if (!cancelled) setState({ loading: false, error: 'Could not load guest list.', guests: null })
    })
    return () => { cancelled = true }
  }, [eventId, kind, resourceId])

  if (state.loading) return <p className="text-xs text-slate-400 px-1 py-2">Loading guests…</p>
  if (state.error) return <p className="text-xs text-red-500 px-1 py-2">{state.error}</p>
  if (!state.guests || state.guests.length === 0) return <p className="text-xs text-slate-400 px-1 py-2">No guests found.</p>
  return (
    <div className="max-h-64 overflow-y-auto border-t border-slate-100 dark:border-slate-700/60 mt-2 pt-2 space-y-1">
      {state.guests.map((g) => (
        <div key={g.id} className="flex items-center justify-between gap-3 text-xs py-0.5">
          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{g.name}</span>
          <span className="text-slate-400 truncate">{g.context || g.email || g.phone || '—'}</span>
        </div>
      ))}
    </div>
  )
}

function AttentionPanel({ eventId, alerts, onNavigate, showEntireEventBadge }) {
  const [expandedId, setExpandedId] = useState(null)
  if (!alerts) return null
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
      <h3 className="font-semibold text-sm dark:text-white mb-3">Needs attention{showEntireEventBadge && <EntireEventBadge />}</h3>
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing needs attention right now.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const hasList = GUEST_LIST_ALERT_TYPES.has(a.type)
            const isOpen = expandedId === a.id
            return (
              <div key={a.id} className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_STYLE[a.severity] || 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span>{SEVERITY_ICON[a.severity] || '•'}</span>
                    <span className="text-slate-700 dark:text-slate-200 truncate">{a.title}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasList && (
                      <button onClick={() => setExpandedId(isOpen ? null : a.id)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                        {isOpen ? 'Hide' : 'View guests'}
                      </button>
                    )}
                    {a.action_label && (
                      <button onClick={() => onNavigate?.(a.action_url)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                        {a.action_label}
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && <InlineGuestList eventId={eventId} kind="alert" resourceId={a.id} />}
              </div>
            )
          })}
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

function ProgressBar({ label, completed, total, sub }) {
  const pct = total ? Math.min(100, Math.round((completed / total) * 100)) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-700 dark:text-slate-200">{label}</span>
        <span className="text-slate-500 dark:text-slate-400 tabular-nums">{completed}/{total}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className="h-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function SessionRow({ s }) {
  const badge = {
    in_progress: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    upcoming: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
    ended: 'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
  }[s.state]
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 dark:border-slate-700/60 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {s.state === 'in_progress' && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
          <span className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{s.topic}</span>
        </div>
        <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-2">
          {s.start_time && <span>{s.start_time}{s.end_time ? `–${s.end_time}` : ''}</span>}
          {s.category && <span className="capitalize">{s.category}</span>}
          {s.room && <span>{s.room}</span>}
          {s.speaker && <span>{s.speaker}</span>}
          {s.attendance_tracked && <span className="font-medium text-teal-600 dark:text-teal-400">Attendance tracked</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}>{s.state.replace('_', ' ')}</span>
        {s.attendance_tracked && <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200" title="Recorded attendance">{s.attended}{s.capacity ? `/${s.capacity}` : ''}</span>}
      </div>
    </div>
  )
}

function EntireEventBadge() {
  return (
    <span className="ml-2 align-middle rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide"
      title="This section isn't affected by the day/venue selector above — it reflects the whole event.">
      Entire event
    </span>
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
  // Initial scope comes from the URL (?event=&day=&venue=&tab=) so a refresh
  // or a shared link lands back on the same view instead of always resetting
  // to the entire-event Overview.
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview')
  const [day, setDay] = useState(() => new URLSearchParams(window.location.search).get('day') || '') // '' = entire event
  const [venueId, setVenueId] = useState(() => new URLSearchParams(window.location.search).get('venue') || '') // '' = all venues/zones
  const [customStart, setCustomStart] = useState(() => new URLSearchParams(window.location.search).get('start') || '')
  const [customEnd, setCustomEnd] = useState(() => new URLSearchParams(window.location.search).get('end') || '')
  const [showCustomRange, setShowCustomRange] = useState(() => Boolean(new URLSearchParams(window.location.search).get('start')))
  const [zones, setZones] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [program, setProgram] = useState(null)
  const [experience, setExperience] = useState(null)
  const [meals, setMeals] = useState(null)
  const [invitations, setInvitations] = useState(null)
  const [operations, setOperations] = useState(null)
  const [connected, setConnected] = useState(false)
  const [blockedStepId, setBlockedStepId] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (!evs.some((e) => e.id === eventId)) setEventId(evs.length === 1 ? evs[0].id : '')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (id, d, v, rangeStart, rangeEnd) => {
    if (!id) return
    // Both ends of a custom range are required together — the backend
    // rejects one without the other, so wait for both before sending either.
    const hasRange = !d && rangeStart && rangeEnd
    setLoading(true)
    try {
      setData(await api.resultsCommandCenter(id, {
        day: d || undefined, venueId: v || undefined,
        start: hasRange ? rangeStart : undefined,
        end: hasRange ? rangeEnd : undefined,
      }))
      setError('')
    } catch (err) {
      setError(err.message || 'Results are temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!eventId) { setData(null); setZones([]); return }
    load(eventId, day, venueId, customStart, customEnd)
    const poll = setInterval(() => load(eventId, day, venueId, customStart, customEnd), 20000)
    return () => clearInterval(poll)
  }, [eventId, day, venueId, customStart, customEnd, load])

  // Only reset the venue filter on a REAL event change, not on first mount —
  // otherwise a venue supplied via the URL (?venue=...) would be clobbered
  // immediately after loading the shared link.
  const prevEventIdRef = useRef(eventId)
  useEffect(() => {
    if (!eventId) { setZones([]); return }
    if (prevEventIdRef.current !== eventId) setVenueId('')
    prevEventIdRef.current = eventId
    api.listZones(eventId).then(setZones).catch(() => setZones([]))
  }, [eventId])

  // Apply ?event= from a shared link once, on mount, without fighting the
  // shared useCurrentEvent/localStorage selection on every render.
  useEffect(() => {
    const urlEvent = new URLSearchParams(window.location.search).get('event')
    if (urlEvent) setEventId(urlEvent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL in sync with the current scope so a refresh or a shared
  // link reproduces the same view (day/venue/range/tab), not just the event.
  useEffect(() => {
    if (!eventId) return
    const params = new URLSearchParams()
    params.set('event', eventId)
    if (day) params.set('day', day)
    if (!day && customStart) params.set('start', customStart)
    if (!day && customEnd) params.set('end', customEnd)
    if (venueId) params.set('venue', venueId)
    if (activeTab && activeTab !== 'overview') params.set('tab', activeTab)
    window.history.replaceState({}, '', `/results?${params.toString()}`)
  }, [eventId, day, venueId, customStart, customEnd, activeTab])

  // Tab-specific fetchers, reused by the tab-switch effects below (which
  // null the state first, for a clean loading indicator) AND by the SSE/poll
  // refresh further down (which refetches in place, no flicker).
  const refetchTab = useCallback(async (tab, id, d) => {
    if (!id) return
    try {
      if (tab === 'program') setProgram(await api.resultsProgram(id, d || undefined))
      else if (tab === 'experience') setExperience(await api.resultsExperience(id))
      else if (tab === 'meals') setMeals(await api.resultsMeals(id))
      else if (tab === 'invitations') setInvitations(await api.resultsInvitations(id))
      else if (tab === 'operations') setOperations(await api.resultsOperations(id))
    } catch { /* leave prior data visible rather than blanking on a transient error */ }
  }, [])

  // Real live updates: reuse the existing authenticated admission SSE stream
  // (backend/app/routers/dashboard.py, same one DashboardPage.jsx already
  // uses) rather than building a second push channel — any admission event
  // triggers an immediate refetch instead of waiting for the 20s poll.
  // Previously this only refreshed Overview/Attendance (command-center);
  // Program/Meals/Experience/Invitations/Operations sat stale until the next
  // tab switch or manual reload.
  const dayRef = useRef(day)
  dayRef.current = day
  const venueRef = useRef(venueId)
  venueRef.current = venueId
  const customStartRef = useRef(customStart)
  customStartRef.current = customStart
  const customEndRef = useRef(customEnd)
  customEndRef.current = customEnd
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  useEffect(() => {
    if (!eventId) { setConnected(false); return }
    let es, closed = false
    ;(async () => {
      let token = ''
      try { token = (await auth.currentUser?.getIdToken()) || '' } catch { /* not signed in */ }
      if (closed) return
      es = new EventSource(`/api/events/${eventId}/stream?token=${encodeURIComponent(token)}`)
      esRef.current = es
      es.onopen = () => setConnected(true)
      es.onerror = () => setConnected(false)
      es.onmessage = () => {
        load(eventId, dayRef.current, venueRef.current, customStartRef.current, customEndRef.current)
        if (activeTabRef.current !== 'overview' && activeTabRef.current !== 'attendance') {
          refetchTab(activeTabRef.current, eventId, dayRef.current)
        }
      }
    })()
    return () => { closed = true; if (es) es.close(); setConnected(false) }
  }, [eventId, load, refetchTab])

  // Also poll tab-specific data every 20s while that tab is open, matching
  // the Overview/Attendance cadence (previously these only fetched once on
  // tab activation and never refreshed again until you left and came back).
  useEffect(() => {
    if (!eventId || activeTab === 'overview' || activeTab === 'attendance') return
    const poll = setInterval(() => refetchTab(activeTab, eventId, day), 20000)
    return () => clearInterval(poll)
  }, [eventId, activeTab, day, refetchTab])

  useEffect(() => {
    if (!eventId || activeTab !== 'program') return
    setProgram(null)
    refetchTab('program', eventId, day)
  }, [eventId, activeTab, day, refetchTab])

  useEffect(() => {
    if (!eventId || activeTab !== 'experience') return
    setExperience(null)
    refetchTab('experience', eventId, day)
  }, [eventId, activeTab, refetchTab])

  useEffect(() => {
    if (!eventId || activeTab !== 'meals') return
    setMeals(null)
    refetchTab('meals', eventId, day)
  }, [eventId, activeTab, refetchTab])

  useEffect(() => {
    if (!eventId || activeTab !== 'invitations') return
    setInvitations(null)
    refetchTab('invitations', eventId, day)
  }, [eventId, activeTab, refetchTab])

  useEffect(() => {
    if (!eventId || activeTab !== 'operations') return
    setOperations(null)
    refetchTab('operations', eventId, day)
  }, [eventId, activeTab, refetchTab])

  const event = events.find((e) => e.id === eventId)
  const a = data?.attendance
  const arrivalGapLabel = venueId
    ? 'Confirmed, not in zone'
    : a?.arrival_gap_mode === 'expected' ? 'Not yet in' : 'Confirmed, not here'
  const arrivalGapHint = venueId
    ? 'Guests confirmed as attending who have not been scanned into this zone.'
    : a?.arrival_gap_mode === 'expected'
      ? "Invited guests who haven't declined and haven't been scanned in yet — this event doesn't track RSVP confirmation, so it can't be narrowed to just those who said yes."
      : 'Guests who confirmed they\'re coming (accepted RSVP) but have not been scanned in yet — excludes declined and no-response guests.'
  const days = data?.attendance_by_day || []
  const hasScopeFilter = Boolean(day || venueId)
  const experienceSteps = data?.experience?.steps || []
  const blockedExperienceSteps = experienceSteps.filter((s) => s.failed > 0)
  const totalBlockedGuests = blockedExperienceSteps.reduce((sum, s) => sum + s.failed, 0)

  function navigateTo(url) {
    if (url) window.location.href = url
  }

  function exportPdf() {
    const previousTitle = document.title
    const scope = day ? ` - ${fmtDay(day)}` : ''
    document.title = `${event?.name || 'Event'}${scope} - Dashboard report`
    const restoreTitle = () => { document.title = previousTitle }
    window.addEventListener('afterprint', restoreTitle, { once: true })
    window.print()
    // Some mobile browsers do not emit afterprint.
    window.setTimeout(restoreTitle, 1000)
  }

  return (
    <div className="results-dashboard space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <a href="/dashboard" className="hover:underline">Events</a>
        <span>/</span>
        <span className="text-slate-600 dark:text-slate-300">{event?.name || 'Select an event'}</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Event command center <span className="align-middle ml-1 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">Preview</span></h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Multi-day attendance, meals, program, and Experience in one view. Read-only preview — the existing{' '}
            <a href="/dashboard" className="text-teal-600 hover:underline font-semibold">Results page</a> is unaffected.
          </p>
        </div>
        {event && (
          <div className="results-print-hide flex items-center gap-2">
            <button onClick={() => api.downloadGuestList(eventId, 'csv')}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              ⬇ Export CSV
            </button>
            <button onClick={exportPdf}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              📄 Export PDF
            </button>
            <a href="/scanner" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
              📷 Open scanner
            </a>
          </div>
        )}
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
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-2xl font-extrabold tracking-tight">{event.name}</div>
            {event.status === 'active' && (
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-green-300 animate-pulse" /> Live
              </span>
            )}
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${connected ? 'bg-white/15' : 'bg-black/10 text-white/60'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-300 animate-pulse' : 'bg-white/40'}`} />
              {connected ? 'Updates connected' : (loading ? 'Connecting…' : 'Refreshing every 20s')}
            </span>
          </div>
          <div className="text-white/80 text-sm mt-0.5">
            {event.event_end_date ? fmtEventDateRange(event.event_date, event.event_end_date, event.timezone) : new Date(event.event_date).toLocaleDateString()}
            {event.venue_name ? ` · ${event.venue_name}` : ''}
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

      {event && (
        <>
          {/* Scope bar: entire event + one tab per day, a custom range, plus a venue/zone filter */}
          {(days.length > 1 || zones.length > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              {days.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button onClick={() => { setDay(''); setCustomStart(''); setCustomEnd(''); setShowCustomRange(false) }}
                    className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold border ${!day && !customStart ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
                    Entire event
                  </button>
                  {days.map((d, i) => (
                    <button key={d.day} onClick={() => { setDay(d.day); setCustomStart(''); setCustomEnd(''); setShowCustomRange(false) }}
                      className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold border ${day === d.day ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
                      Day {i + 1} · {fmtDay(d.day)}
                    </button>
                  ))}
                  <button onClick={() => { setDay(''); setShowCustomRange((s) => !s) }}
                    className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold border ${customStart ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
                    {customStart ? `${fmtDay(customStart)} – ${fmtDay(customEnd)}` : 'Custom range'}
                  </button>
                </div>
              )}
              {zones.length > 0 && (
                <select value={venueId} onChange={(e) => setVenueId(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                  <option value="">All venues</option>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              )}
            </div>
          )}
          {showCustomRange && days.length > 1 && (
            <div className="flex items-center gap-2 text-sm bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-lg px-3 py-2 w-fit">
              <label className="text-slate-500 dark:text-slate-400">From
                <input type="date" value={customStart} min={days[0].day} max={days[days.length - 1].day}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="ml-2 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1" />
              </label>
              <label className="text-slate-500 dark:text-slate-400">to
                <input type="date" value={customEnd} min={customStart || days[0].day} max={days[days.length - 1].day}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="ml-2 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1" />
              </label>
              {customStart && customEnd && (
                <button onClick={() => { setCustomStart(''); setCustomEnd(''); setShowCustomRange(false) }} className="text-xs text-slate-400 hover:underline">Clear</button>
              )}
            </div>
          )}
          {venueId && (
            <p className="text-xs text-slate-400">
              Filtered to <strong className="text-slate-600 dark:text-slate-300">{zones.find((z) => z.id === venueId)?.name}</strong> — attendance/occupancy reflect movement through this zone specifically, not overall event admission.
            </p>
          )}

          {/* Tabs */}
          <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)}
                className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === t.id ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && a && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard icon="👥" tint="bg-teal-50 dark:bg-teal-900/30" label={venueId ? 'Expected (event-wide)' : 'Expected'} value={a.expected}
                  hint="Invited guests who haven't declined — not the same as 'confirmed'. A guest who never responds still counts as expected until they explicitly decline." />
                <MetricCard icon="✅" tint="bg-green-50 dark:bg-green-900/30" label="Checked in" value={a.checked_in}
                  hint="Guests with at least one accepted (non-denied) entry scan recorded in this scope." />
                <MetricCard icon="⏰" tint="bg-amber-50 dark:bg-amber-900/30" label={arrivalGapLabel} value={a.confirmed_not_here}
                  sub={a.arrival_gap_mode === 'confirmed' ? 'excludes declined & pending' : undefined} hint={arrivalGapHint} />
                <MetricCard icon="❌" tint="bg-red-50 dark:bg-red-900/30" label="Declined" value={a.declined} accent="text-red-600 dark:text-red-400"
                  hint="Guests who explicitly declined the invitation." />
                <MetricCard icon="🚶" tint="bg-violet-50 dark:bg-violet-900/30" label="Walk-ins" value={a.walk_ins}
                  hint="Admitted guests who weren't on an invite list ahead of time." />
                <MetricCard icon="🚪" tint="bg-slate-100 dark:bg-slate-700" label="Checked out" value={a.checked_out}
                  hint="Guests with an accepted exit scan — they may still return." />
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                  <h3 className="font-semibold text-sm dark:text-white mb-3">Attendance</h3>
                  <div className="flex flex-col sm:flex-row items-center gap-6">
                    <Donut pct={a.expected ? Math.round((a.checked_in / a.expected) * 100) : 0} label="of expected arrivals" />
                    <div className="flex-1 w-full min-w-0">
                      <HourlyChart hourly={a.hourly} />
                      <div className="flex gap-4 mt-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-500" />First arrival</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-300" />Returning</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" />Exit</span>
                      </div>
                    </div>
                  </div>
                </div>
                <AttentionPanel eventId={eventId} alerts={data.alerts} onNavigate={navigateTo} showEntireEventBadge={hasScopeFilter} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <RsvpFunnel funnel={data.rsvp_funnel} showEntireEventBadge={hasScopeFilter} />
                <CommHealthCard comm={data.communication} showEntireEventBadge={hasScopeFilter} />
              </div>

              {(event.menu_enabled || data.program?.in_progress_count > 0 || event.experience_enabled) && (
                <div className="grid gap-6 lg:grid-cols-3">
                  {event.menu_enabled && (
                    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                      <h3 className="font-semibold text-sm dark:text-white mb-3">Meals{hasScopeFilter && <EntireEventBadge />}</h3>
                      {data.meals.categories.length === 0 ? (
                        <p className="text-sm text-slate-400">No selectable meal categories.</p>
                      ) : (
                        <>
                          <div className="text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                            {data.meals.served_total}<span className="text-base text-slate-400 font-semibold">/{data.meals.eligible_total}</span>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">served across {data.meals.categories.length} categor{data.meals.categories.length === 1 ? 'y' : 'ies'}</div>
                        </>
                      )}
                      <button onClick={() => setActiveTab('meals')} className="mt-3 text-xs font-semibold text-teal-600 hover:underline">Open meal service →</button>
                    </div>
                  )}
                  {event.experience_enabled && (
                    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                      <h3 className="font-semibold text-sm dark:text-white mb-3">Program right now{venueId && <EntireEventBadge />}</h3>
                      {data.program.in_progress_count === 0 ? (
                        <p className="text-sm text-slate-400">No sessions in progress.</p>
                      ) : (
                        <div className="space-y-1">
                          {data.program.in_progress.slice(0, 3).map((s) => <SessionRow key={s.step_id} s={s} />)}
                        </div>
                      )}
                      <button onClick={() => setActiveTab('program')} className="mt-3 text-xs font-semibold text-teal-600 hover:underline">
                        {data.program.in_progress_count} session{data.program.in_progress_count === 1 ? '' : 's'} in progress →
                      </button>
                    </div>
                  )}
                  {event.experience_enabled && (
                    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                      <h3 className="font-semibold text-sm dark:text-white mb-3">Experience journey{hasScopeFilter && <EntireEventBadge />}</h3>
                      {experienceSteps.length === 0 ? (
                        <p className="text-sm text-slate-400">No Experience steps configured.</p>
                      ) : (
                        <div className="space-y-3">
                          {experienceSteps.map((s) => (
                            <ProgressBar key={s.step_id} label={s.title} completed={s.completed} total={s.total}
                              sub={s.failed > 0 ? `${s.failed} blocked` : undefined} />
                          ))}
                        </div>
                      )}
                      {totalBlockedGuests > 0 ? (
                        <>
                          <button
                            onClick={() => setBlockedStepId(blockedStepId ? null : blockedExperienceSteps[0].step_id)}
                            className="mt-3 text-xs font-semibold text-teal-600 hover:underline"
                          >
                            {blockedStepId ? 'Hide' : `View ${totalBlockedGuests} blocked guest${totalBlockedGuests === 1 ? '' : 's'}`} →
                          </button>
                          {blockedStepId && <InlineGuestList eventId={eventId} kind="step" resourceId={blockedStepId} />}
                        </>
                      ) : (
                        <button onClick={() => setActiveTab('experience')} className="mt-3 text-xs font-semibold text-teal-600 hover:underline">Open Experience tab →</button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={`grid gap-6 ${data.venue_occupancy?.length > 0 ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
                {data.venue_occupancy?.length > 0 && (
                  <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                    <h3 className="font-semibold text-sm dark:text-white mb-3">Live venue occupancy</h3>
                    <div className="space-y-3">
                      {data.venue_occupancy.map((z) => <OccupancyBar key={z.id} {...z} />)}
                    </div>
                  </div>
                )}
                <div className={data.venue_occupancy?.length > 0 ? '' : 'w-full'}>
                  <RecentActivity items={data.recent_activity} />
                </div>
              </div>

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
                        <td className="py-2 text-slate-700 dark:text-slate-200">
                          Day {i + 1} · {fmtDay(d.day)}
                          {d.status === 'live' && <span className="ml-2 rounded-full bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-[10px] font-bold px-1.5 py-0.5 uppercase align-middle">Live</span>}
                        </td>
                        <td className="py-2 tabular-nums">{d.expected}</td>
                        <td className="py-2 tabular-nums">{d.status === 'upcoming' ? '—' : d.checked_in}</td>
                        <td className="py-2 tabular-nums">{d.status === 'upcoming' ? 'Upcoming' : `${d.attendance_rate}%`}</td>
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
                <MetricCard icon="👥" tint="bg-teal-50 dark:bg-teal-900/30" label={venueId ? 'Expected (event-wide)' : 'Expected'} value={a.expected}
                  hint="Invited guests who haven't declined — not the same as 'confirmed'. A guest who never responds still counts as expected until they explicitly decline." />
                <MetricCard icon="✅" tint="bg-green-50 dark:bg-green-900/30" label="Checked in" value={a.checked_in}
                  hint="Guests with at least one accepted (non-denied) entry scan recorded in this scope." />
                <MetricCard icon="🟢" tint="bg-teal-50 dark:bg-teal-900/30"
                  label={a.occupancy_mode === 'historical' ? 'Occupancy at day close' : a.occupancy_mode === 'future' ? 'On-site (not started)' : 'On-site now'}
                  value={a.occupancy_mode === 'future' ? '—' : a.on_site} accent="text-teal-600 dark:text-teal-400"
                  hint={a.occupancy_mode === 'historical'
                    ? 'Net entries minus exits as of the end of this past day — not a live count.'
                    : a.occupancy_mode === 'future'
                      ? "This day hasn't happened yet, so there's no occupancy to show."
                      : 'Net entries minus exits right now: guests scanned in who have not since been scanned out.'} />
                <MetricCard icon="✨" tint="bg-sky-50 dark:bg-sky-900/30" label="First-time" value={a.first_time}
                  hint="Guests scanned in for the very first time within this scope." />
                <MetricCard icon="🔁" tint="bg-sky-50 dark:bg-sky-900/30" label="Returning" value={a.returning}
                  hint="Guests who had already checked in before and are entering again (e.g. a multi-day event, or leaving and coming back)." />
                <MetricCard icon="🚪" tint="bg-slate-100 dark:bg-slate-700" label="Checked out" value={a.checked_out}
                  hint="Guests with an accepted exit scan — they may still return." />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <MetricCard icon="⏰" tint="bg-amber-50 dark:bg-amber-900/30" label={arrivalGapLabel} value={a.confirmed_not_here} hint={arrivalGapHint} />
                <MetricCard icon="❌" tint="bg-red-50 dark:bg-red-900/30" label="Declined" value={a.declined} accent="text-red-600 dark:text-red-400"
                  hint="Guests who explicitly declined the invitation." />
                <MetricCard icon="🚶" tint="bg-violet-50 dark:bg-violet-900/30" label="Walk-ins" value={a.walk_ins} />
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

          {activeTab === 'program' && (
            program === null ? <p className="text-sm text-slate-400">Loading…</p> :
            !event.experience_enabled ? <EmptyFeatureState tab="Program" /> :
            program.sessions.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No session_attendance Experience steps configured for this event yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard icon="🟢" tint="bg-teal-50 dark:bg-teal-900/30" label="In progress" value={program.in_progress_count} accent="text-teal-600 dark:text-teal-400" />
                  <MetricCard icon="⏳" tint="bg-slate-100 dark:bg-slate-700" label="Upcoming" value={program.upcoming_count} />
                  <MetricCard icon="✓" tint="bg-slate-100 dark:bg-slate-700" label="Completed" value={program.ended_count} />
                  <MetricCard icon="📋" tint="bg-sky-50 dark:bg-sky-900/30" label="Program items" value={program.sessions.length} />
                </div>
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="font-semibold text-sm dark:text-white">Complete program{venueId && <EntireEventBadge />}</h3>
                    <span className="text-xs text-slate-400">{program.attendance_tracked_count} attendance-tracked</span>
                  </div>
                  <div className="space-y-5">
                    {Object.entries(program.sessions.reduce((groups, session) => {
                      const key = session.day || 'Unscheduled'
                      ;(groups[key] ||= []).push(session)
                      return groups
                    }, {})).map(([programDay, sessions]) => (
                      <section key={programDay}>
                        <h4 className="mb-1 border-b border-slate-100 pb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-300">
                          {programDay === 'Unscheduled' ? programDay : fmtDay(programDay)}
                        </h4>
                        <div>{sessions.map((s) => <SessionRow key={s.step_id} s={s} />)}</div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}

          {activeTab === 'experience' && (
            experience === null ? <p className="text-sm text-slate-400">Loading…</p> :
            !event.experience_enabled ? <EmptyFeatureState tab="Experience" /> :
            experience.steps.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No Experience steps configured for this event yet.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                <h3 className="font-semibold text-sm dark:text-white mb-3">Completion funnel{hasScopeFilter && <EntireEventBadge />}</h3>
                <div className="space-y-4">
                  {experience.steps.map((s) => (
                    <ProgressBar key={s.step_id} label={`${s.title}${s.required ? '' : ' (optional)'}`} completed={s.completed} total={s.total}
                      sub={s.failed > 0 ? `${s.failed} failed` : undefined} />
                  ))}
                </div>
              </div>
            )
          )}

          {activeTab === 'meals' && (
            meals === null ? <p className="text-sm text-slate-400">Loading…</p> :
            !event.menu_enabled ? <EmptyFeatureState tab="Meals" /> :
            meals.categories.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No selectable meal categories — this event's menu is display-only (informational), so there's nothing to serve.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard icon="🍽️" tint="bg-teal-50 dark:bg-teal-900/30" label="Served" value={meals.served_total} accent="text-teal-600 dark:text-teal-400" sub="Distinct guests"
                    hint="Distinct guests with at least one meal category marked served, across all categories." />
                  <MetricCard icon="👥" tint="bg-slate-100 dark:bg-slate-700" label="Made a selection" value={meals.eligible_total} sub="Distinct guests"
                    hint="Distinct guests with at least one menu choice recorded — based on who actually picked something, regardless of RSVP status." />
                  <MetricCard icon="⏳" tint="bg-amber-50 dark:bg-amber-900/30" label="Remaining to serve" value={meals.eligible_total - meals.served_total}
                    hint="Made a selection minus Served." />
                  {meals.missing_selection > 0 && (
                    <MetricCard icon="⚠️" tint="bg-red-50 dark:bg-red-900/30" label="No selection yet" value={meals.missing_selection} accent="text-red-600 dark:text-red-400" sub="Not counted above"
                      hint="Invited guests (not declined) with no menu choice on file — a different, and not necessarily overlapping, group from 'Made a selection' above, which only counts guests who did pick something." />
                  )}
                </div>
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                  <h3 className="font-semibold text-sm dark:text-white mb-3">By category{hasScopeFilter && <EntireEventBadge />}</h3>
                  <p className="text-xs text-slate-400 mb-3">Guests who chose that category's item — a guest with 3 categories counts once per category here, but only once in the totals above.</p>
                  <div className="space-y-4">
                    {meals.categories.map((c) => (
                      <ProgressBar key={c.category_id} label={c.day_label ? `${c.name} — ${c.day_label}` : c.name}
                        completed={c.served} total={c.eligible} sub={`${c.remaining} remaining`} />
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-4">Mark guests served from the Menu panel's serving station in Event Setup — this tab is read-only.</p>
                </div>
              </div>
            )
          )}

          {activeTab === 'invitations' && (
            invitations === null ? <p className="text-sm text-slate-400">Loading…</p> : (
              <div className="space-y-6">
                <RsvpFunnel funnel={invitations.rsvp_funnel} showEntireEventBadge={hasScopeFilter} />
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                    <h3 className="font-semibold text-sm dark:text-white mb-3">Invite delivery{hasScopeFilter && <EntireEventBadge />}</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <MetricCard icon="✅" tint="bg-green-50 dark:bg-green-900/30" label="Sent" value={invitations.delivery.sent} />
                      <MetricCard icon="⚠️" tint="bg-amber-50 dark:bg-amber-900/30" label="Failed" value={invitations.delivery.failed} accent="text-amber-600 dark:text-amber-400" />
                      <MetricCard icon="⏳" tint="bg-slate-100 dark:bg-slate-700" label="Not sent yet" value={invitations.delivery.unsent} />
                    </div>
                  </div>
                  <CommHealthCard comm={invitations.communication} showEntireEventBadge={hasScopeFilter} />
                </div>
              </div>
            )
          )}

          {activeTab === 'operations' && (
            operations === null ? <p className="text-sm text-slate-400">Loading…</p> : (
              <div className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                    <h3 className="font-semibold text-sm dark:text-white mb-3 flex items-center gap-1.5">
                      Meals served{hasScopeFilter && <EntireEventBadge />}
                      <MetricHint text="Total = distinct guests who made a menu selection, regardless of RSVP status. Guests who never chose don't count toward this total at all." />
                    </h3>
                    {operations.meals.categories.length === 0 ? (
                      <p className="text-sm text-slate-400">Not applicable for this event.</p>
                    ) : (
                      <ProgressBar label="All categories" completed={operations.meals.served_total} total={operations.meals.eligible_total} />
                    )}
                  </div>
                  <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                    <h3 className="font-semibold text-sm dark:text-white mb-3 flex items-center gap-1.5">
                      Consent signed{hasScopeFilter && <EntireEventBadge />}
                      <MetricHint text="Eligible = invited guests who haven't declined, same definition used for 'Expected' on Overview. Signed includes staff-overridden completions." />
                    </h3>
                    {!operations.consent ? (
                      <p className="text-sm text-slate-400">No consent step configured.</p>
                    ) : (
                      <ProgressBar label="Consent" completed={operations.consent.signed} total={operations.consent.eligible} />
                    )}
                  </div>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                    <h3 className="font-semibold text-sm dark:text-white mb-3">Denied scans — {operations.denied_scans.total} total</h3>
                    {operations.denied_scans.by_reason.length === 0 ? (
                      <p className="text-sm text-slate-400">No denied scans.</p>
                    ) : (
                      <div className="space-y-2">
                        {operations.denied_scans.by_reason.map((r) => (
                          <div key={r.reason} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-slate-300">{r.reason}</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{r.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {operations.venue_occupancy.length > 0 && (
                    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow-sm p-4">
                      <h3 className="font-semibold text-sm dark:text-white mb-3">Zone occupancy</h3>
                      <div className="space-y-3">
                        {operations.venue_occupancy.map((z) => <OccupancyBar key={z.id} {...z} />)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {!['overview', 'attendance', 'program', 'experience', 'meals', 'invitations', 'operations'].includes(activeTab) && <EmptyFeatureState tab={TABS.find((t) => t.id === activeTab)?.label} />}
        </>
      )}

      {!event && !error && <p className="text-sm text-slate-400">Select an event to see its command center.</p>}
    </div>
  )
}
