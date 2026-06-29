import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { auth } from '../firebase'
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

// Table fill status → colour. Green = has space, Amber = filling up (≥70%),
// Red = full. Mirrors the legend under the "By table" card.
function tableFill(seated, capacity) {
  if (!capacity) return { dot: 'bg-slate-300 dark:bg-slate-600', text: 'text-slate-400' }
  if (seated >= capacity) return { dot: 'bg-red-500', text: 'text-red-500' }
  if (seated / capacity >= 0.7) return { dot: 'bg-amber-500', text: 'text-amber-600' }
  return { dot: 'bg-green-500', text: 'text-green-600' }
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function fmtHour(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString([], { hour: 'numeric' })
}

function ProgressRow({ name, total, admitted, pending, capacity }) {
  const admittedPct = pct(admitted, total)
  const capacityText = capacity != null ? ` · cap ${capacity}` : ''
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{total} guests{capacityText}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold text-slate-800 dark:text-slate-100">{admitted}/{total}</div>
          <div className="text-xs text-slate-400">{pending} pending</div>
        </div>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mt-2">
        <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${admittedPct}%` }} />
      </div>
    </div>
  )
}

function Timeline({ points }) {
  const max = Math.max(...points.map((p) => p.count), 1)
  return (
    <div className="flex items-end gap-2 h-36 pt-4">
      {points.map((p) => (
        <div key={p.label} className="flex-1 min-w-[26px] flex flex-col items-center justify-end gap-2">
          <div className="w-full rounded-t-md bg-teal-500/80 min-h-[4px]" style={{ height: `${Math.max((p.count / max) * 100, 8)}%` }} title={`${fmtHour(p.label)}: ${p.count}`} />
          <div className="text-[10px] text-slate-400 whitespace-nowrap">{fmtHour(p.label)}</div>
        </div>
      ))}
    </div>
  )
}

function GuestList({ guests }) {
  return (
    <div className="divide-y divide-gray-100 dark:divide-slate-700 -mx-1">
      {guests.map((g, i) => (
        <div key={g.id || i} className="flex items-center gap-3 py-2.5 px-1">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 grid place-items-center text-sm font-bold shrink-0">
            {(g.first_name || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm dark:text-slate-100 truncate flex items-center gap-1.5">
              <span className="truncate">{g.first_name} {g.last_name}</span>
              {g.is_vip && <span className="shrink-0 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">VIP</span>}
              {g.is_walk_in && <span className="shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Walk-in</span>}
            </div>
            <div className="text-xs text-slate-400 truncate">{g.email || 'No email'} · {g.phone || 'No phone'} · RSVP {g.rsvp_status || 'invited'}</div>
          </div>
        </div>
      ))}
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
    // EventSource can't send an Authorization header, so we pass the Firebase
    // token as a query param (token-authenticated SSE; see dashboard.py).
    let es
    let closed = false
    ;(async () => {
      let token = ''
      try { token = (await auth.currentUser?.getIdToken()) || '' } catch { /* not signed in */ }
      if (closed) return
      es = new EventSource(`/api/events/${eventId}/stream?token=${encodeURIComponent(token)}`)
      esRef.current = es
      es.onopen = () => setConnected(true)
      es.onerror = () => setConnected(false)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'admitted') {
          setStats((prev) => {
            if (!prev || prev.admitted_guests.find((g) => g.id === data.guest_id)) return prev
            return { ...prev, admitted: prev.admitted + 1, pending: Math.max(prev.pending - 1, 0),
              walk_in: (prev.walk_in || 0) + (data.is_walk_in ? 1 : 0),
              admitted_guests: [{ id: data.guest_id, first_name: data.name.split(' ')[0],
                last_name: data.name.split(' ').slice(1).join(' '), email: data.email,
                admitted_at: data.admitted_at, admitted: true, is_walk_in: !!data.is_walk_in }, ...prev.admitted_guests] }
          })
        }
      }
    })()
    return () => { closed = true; if (es) es.close(); clearInterval(poll) }
  }, [eventId, fetchStats])

  const event = events.find((e) => e.id === eventId)
  const checkinPct = stats ? pct(stats.admitted, stats.total) : 0
  const responseTotal = stats ? stats.rsvp_confirmed + stats.rsvp_declined + stats.rsvp_pending + stats.rsvp_invited : 0
  const responded = stats ? stats.rsvp_confirmed + stats.rsvp_declined + stats.rsvp_pending : 0
  const sentInvites = stats?.invite_delivery?.sent || 0
  const failedInvites = stats?.invite_delivery?.failed || 0
  const unsentInvites = stats?.invite_delivery?.unsent || 0
  const inviteTotal = sentInvites + failedInvites + unsentInvites
  const contactStats = stats?.contact_stats || {}
  const responsesReceived = contactStats.responses_received || 0
  const vipPct = stats ? pct(stats.vip_admitted || 0, stats.vip_total || 0) : 0

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
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
            <Donut pct={checkinPct} label="checked in" sub={`${stats.admitted}/${stats.total}`} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
              <Kpi label="Total guests" value={stats.total} />
              <Kpi label="Checked in" value={stats.admitted} accent="text-green-600" />
              <Kpi label="Not yet in" value={stats.pending} accent="text-amber-600" />
              <Kpi label="RSVP confirmed" value={stats.rsvp_confirmed} accent="text-teal-600" />
              <Kpi label="RSVP response rate" value={`${pct(responded, responseTotal)}%`} accent="text-indigo-600" />
              <Kpi label="Invites sent" value={sentInvites} accent="text-sky-600" />
              <Kpi label="Responses received" value={responsesReceived} accent="text-violet-600" />
              <Kpi label="VIP checked in" value={stats.vip_total ? `${stats.vip_admitted}/${stats.vip_total}` : '0'} accent="text-fuchsia-600" />
              <Kpi label="Walk-ins / Manual" value={stats.walk_in || 0} accent="text-blue-600" />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {(stats.rsvp_confirmed + stats.rsvp_declined + stats.rsvp_pending + stats.rsvp_invited) > 0 && (
              <Card title="RSVP progress" right={<span className="text-xs text-slate-400">{responded}/{responseTotal} responded</span>}>
                <Bar segments={[
                  { label: 'Confirmed', value: stats.rsvp_confirmed, color: 'bg-green-500' },
                  { label: 'Declined', value: stats.rsvp_declined, color: 'bg-red-400' },
                  { label: 'Pending', value: stats.rsvp_pending, color: 'bg-amber-400' },
                  { label: 'No reply', value: stats.rsvp_invited, color: 'bg-slate-300 dark:bg-slate-600' },
                ]} />
              </Card>
            )}

            {inviteTotal > 0 && (
              <Card title="Invite delivery" right={<span className="text-xs text-slate-400">{pct(sentInvites, inviteTotal)}% sent</span>}>
                <Bar segments={[
                  { label: 'Sent', value: sentInvites, color: 'bg-sky-500' },
                  { label: 'Failed', value: failedInvites, color: 'bg-red-400' },
                  { label: 'Unsent', value: unsentInvites, color: 'bg-slate-300 dark:bg-slate-600' },
                ]} />
              </Card>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Contact coverage">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-sky-600">{contactStats.email_available || 0}</div>
                  <div className="text-xs text-slate-400">Email available</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-teal-600">{contactStats.phone_available || 0}</div>
                  <div className="text-xs text-slate-400">Phone available</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-indigo-600">{contactStats.both_available || 0}</div>
                  <div className="text-xs text-slate-400">Email and phone</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-red-500">{contactStats.no_contact || 0}</div>
                  <div className="text-xs text-slate-400">No contact info</div>
                </div>
              </div>
            </Card>

            <Card title="Sent and received" right={<span className="text-xs text-slate-400">{pct(responsesReceived, sentInvites)}% response from sent</span>}>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-sky-600">{contactStats.invite_sent || 0}</div>
                  <div className="text-xs text-slate-400">Sent</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-violet-600">{responsesReceived}</div>
                  <div className="text-xs text-slate-400">Received</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-red-500">{contactStats.invite_failed || 0}</div>
                  <div className="text-xs text-slate-400">Failed</div>
                </div>
              </div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct(responsesReceived, sentInvites)}%` }} />
              </div>
              <div className="mt-2 text-xs text-slate-400">Received means the guest has submitted an RSVP response.</div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card title="Attendance health">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-green-600">{checkinPct}%</div>
                  <div className="text-xs text-slate-400">Overall checked in</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-fuchsia-600">{vipPct}%</div>
                  <div className="text-xs text-slate-400">VIP checked in</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-amber-600">{stats.pending}</div>
                  <div className="text-xs text-slate-400">Still expected</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-2xl font-extrabold text-blue-600">{stats.walk_in || 0}</div>
                  <div className="text-xs text-slate-400">Added at door</div>
                </div>
              </div>
            </Card>

            <div className="lg:col-span-2">
              <Card title="Arrival timeline" right={<span className="text-xs text-slate-400">{stats.admitted} arrivals</span>}>
                {stats.arrival_timeline?.length > 0 ? (
                  <Timeline points={stats.arrival_timeline} />
                ) : (
                  <div className="py-8 text-center text-gray-400 dark:text-slate-500 text-sm">No arrival data yet.</div>
                )}
              </Card>
            </div>
          </div>
          </>
          )}

          {(stats.ticket_types?.length > 0 || stats.table_groups?.length > 0) && (
            <div className="grid lg:grid-cols-2 gap-4">
              {stats.ticket_types?.length > 0 && (
                <Card title="By ticket type">
                  <div className="divide-y divide-gray-100 dark:divide-slate-700">
                    {stats.ticket_types.map((row) => <ProgressRow key={row.name} {...row} />)}
                  </div>
                </Card>
              )}

              {stats.table_groups?.length > 0 && (
                <Card title="By section">
                  <div className="divide-y divide-gray-100 dark:divide-slate-700">
                    {stats.table_groups.map((row) => <ProgressRow key={row.name} {...row} />)}
                  </div>
                </Card>
              )}
            </div>
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
            <Card title="By table" right={
              <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Space</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Filling</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Full</span>
              </div>
            }>
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
                      const fill = tableFill(t.seated, t.capacity)
                      return (
                        <tr key={t.name}>
                          <td className="px-2 py-2 font-medium dark:text-slate-100">
                            <span className="inline-flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${fill.dot}`} title={t.capacity ? `${t.seated}/${t.capacity}` : 'no capacity set'} />
                              {t.name}
                              {t.capacity != null && <span className={`text-xs ${fill.text}`}>{t.seated}/{t.capacity}</span>}
                            </span>
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
          <div className="grid lg:grid-cols-2 gap-4">
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
                        <div className="font-medium text-sm dark:text-slate-100 truncate flex items-center gap-1.5">
                          <span className="truncate">{g.first_name} {g.last_name}</span>
                          {g.is_vip && <span className="shrink-0 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">VIP</span>}
                          {g.is_walk_in && (
                            <span className="shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Walk-in</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 truncate">{g.email || 'No email'} · {g.phone || 'No phone'}</div>
                      </div>
                      <div className="text-xs text-slate-400 shrink-0">{g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Not yet checked in" right={<span className="text-xs text-slate-400">{stats.pending} pending</span>}>
              {stats.pending_guests?.length > 0 ? (
                <GuestList guests={stats.pending_guests} />
              ) : (
                <div className="py-8 text-center text-gray-400 dark:text-slate-500 text-sm">Everyone on the list is checked in.</div>
              )}
            </Card>
          </div>
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
