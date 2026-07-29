import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import { auth } from '../firebase'
import AttendanceTab from './redesign/results/AttendanceTab'
import InvitationsTab from './redesign/results/InvitationsTab'
import MealsTab from './redesign/results/MealsTab'
import ProgramTab from './redesign/results/ProgramTab'
import ExperienceTab from './redesign/results/ExperienceTab'
import OperationsTab from './redesign/results/OperationsTab'
import './EventResultsRedesignPage.css'

// Mirrors the real /results command-center page (ResultsPage.jsx) — the
// current, primary multi-day dashboard, backed by dashboard-service's
// /api/results/* endpoints. Overview (this tab) is fully wired; the other
// six tabs are stubbed with their real endpoint + data shape noted, ready
// to be wired one at a time (see TAB_STATUS below).

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'meals', label: 'Meals' },
  { id: 'program', label: 'Program' },
  { id: 'experience', label: 'Experience' },
  { id: 'operations', label: 'Operations' },
]

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`rr-panel er-stat ${tone || ''}`} title={hint}>
      <span>{label}</span><strong>{value}</strong>
    </div>
  )
}

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function EventResultsRedesignPage() {
  const [currentEventId, setCurrentEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState(currentEventId || '')
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTabState] = useState(TABS.some((t) => t.id === requestedTab) ? requestedTab : 'overview')
  const setActiveTab = (id) => { setActiveTabState(id); setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', id); return next }) }
  const [day, setDay] = useState('')
  const [venueId, setVenueId] = useState('')
  const [zones, setZones] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [toast, setToast] = useState('')
  const esRef = useRef(null)

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (!eventId && evs.length) setEventId(currentEventId && evs.some((e) => e.id === currentEventId) ? currentEventId : evs[0].id)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!eventId) { setZones([]); return }
    api.listZones(eventId).then(setZones).catch(() => setZones([]))
  }, [eventId])

  const load = useCallback(async (id, d, v) => {
    if (!id) return
    try {
      setData(await api.resultsCommandCenter(id, { day: d || undefined, venueId: v || undefined }))
      setError('')
    } catch (err) {
      setError(err.message || 'Results are temporarily unavailable.')
    }
  }, [])

  useEffect(() => {
    if (!eventId) { setData(null); return }
    load(eventId, day, venueId)
    const poll = setInterval(() => load(eventId, day, venueId), 20000)
    return () => clearInterval(poll)
  }, [eventId, day, venueId, load])

  // Real live updates: same authenticated admission SSE stream DashboardPage/
  // ResultsPage use — any admission triggers an immediate refetch.
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
      es.onmessage = () => load(eventId, day, venueId)
    })()
    return () => { closed = true; if (es) es.close(); setConnected(false) }
  }, [eventId, day, venueId, load])

  const event = events.find((e) => e.id === eventId)
  const a = data?.attendance
  const days = data?.attendance_by_day || []
  const hasScopeFilter = Boolean(day || venueId)
  const arrivalGapLabel = venueId ? 'Confirmed, not in zone' : a?.arrival_gap_mode === 'expected' ? 'Not yet in' : 'Confirmed, not here'
  const experienceSteps = data?.experience?.steps || []

  return (
    <RedesignShell topActive="results" withEventSidebar={false}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Event command center</h1>{event && <span className="rr-pill live"><i /> {connected ? 'Live' : 'Polling'}</span>}</div>
          <div className="rr-meta">Multi-day attendance, meals, program, and Experience in one view</div>
        </div>
        <div className="rr-head-actions">
          <select className="rr-select" style={{ marginBottom: 0, width: 240 }} value={eventId} onChange={(e) => { setEventId(e.target.value); setCurrentEventId(e.target.value); setDay('') }}>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </div>
      </div>

      {!eventId ? <LoadingSkeleton rows={4} variant="card" /> : error ? (
        <div className="rd-panel"><div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div></div>
      ) : !data ? <LoadingSkeleton rows={4} variant="card" /> : (
      <>
      {(days.length > 1 || zones.length > 0) && (
        <div className="er-scope-bar">
          {days.length > 1 && (
            <div className="er-scope-days">
              <button className={!day ? 'active' : ''} onClick={() => setDay('')}>Entire event</button>
              {days.map((d, i) => (
                <button key={d.day} className={day === d.day ? 'active' : ''} onClick={() => setDay(d.day)}>Day {i + 1} · {fmtDay(d.day)}</button>
              ))}
            </div>
          )}
          {zones.length > 0 && (
            <select className="rr-select" style={{ marginBottom: 0 }} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">All venues</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="er-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && a && (
        <>
          <div className="rr-grid4">
            <StatCard label="Expected" value={a.expected} hint="Invited guests who haven't declined." />
            <StatCard label="Checked in" value={a.checked_in} hint="Guests with at least one accepted entry scan." />
            <StatCard label={arrivalGapLabel} value={a.confirmed_not_here} hint="Confirmed guests not yet scanned in." />
            <StatCard label="Declined" value={a.declined} />
            <StatCard label="Walk-ins" value={a.walk_ins} />
            <StatCard label="Checked out" value={a.checked_out} />
          </div>

          <div className="rr-grid2" style={{ marginTop: 14 }}>
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Attendance by hour</h3></div>
              <div className="rd-panel-body">
                <div className="er-arrival-chart">
                  {(a.hourly || []).map((h) => (
                    <div className="er-arrival-col" key={h.hour}>
                      <div className="er-arrival-track"><div className="er-arrival-bar" style={{ height: `${Math.min(((h.first_arrival + h.returning) / Math.max(...(a.hourly || [{ first_arrival: 0, returning: 0 }]).map((x) => x.first_arrival + x.returning), 1)) * 100, 100)}%` }} /></div>
                      <span>{h.hour}</span>
                    </div>
                  ))}
                  {(!a.hourly || a.hourly.length === 0) && <p className="rd-rowlink">No arrivals recorded yet.</p>}
                </div>
              </div>
            </div>
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Needs attention</h3>{hasScopeFilter && <p>Entire event</p>}</div>
              <div className="rd-panel-body">
                {(data.alerts || []).length === 0 ? <p className="rd-rowlink">Nothing needs attention.</p> : (
                  data.alerts.map((al) => (
                    <div key={al.id} className={`er-provider-row er-alert-${al.severity}`}>
                      <span>{al.title}</span><b>{al.count}</b>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rr-grid2" style={{ marginTop: 14 }}>
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>RSVP funnel</h3>{hasScopeFilter && <p>Entire event</p>}</div>
              <div className="rd-panel-body">
                <div className="er-provider-row"><span>Guests</span><b>{data.rsvp_funnel.guests}</b></div>
                <div className="er-provider-row"><span>Invited</span><b>{data.rsvp_funnel.invited}</b></div>
                <div className="er-provider-row"><span>Responded</span><b>{data.rsvp_funnel.responded}</b></div>
                <div className="er-provider-row"><span>Confirmed</span><b>{data.rsvp_funnel.confirmed}</b></div>
                <div className="er-provider-row"><span>Checked in</span><b>{data.rsvp_funnel.checked_in}</b></div>
              </div>
            </div>
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Communication health</h3>{hasScopeFilter && <p>Entire event</p>}</div>
              <div className="rd-panel-body">
                {['email', 'sms', 'whatsapp'].map((ch) => {
                  const c = data.communication[ch]
                  const label = ch === 'email' ? 'Email' : ch === 'sms' ? 'SMS' : 'WhatsApp'
                  const deliv = ch === 'email' ? c.reached : c.delivered
                  return (
                    <div key={ch} className="er-chan-row">
                      <span>{label}</span>
                      <div className="rd-mini-bar" style={{ flex: 1, margin: '0 10px' }}><i style={{ width: `${c.rate ?? 0}%` }} /></div>
                      <b>{c.rate ?? 0}%</b> <span className="rd-rowlink">({deliv}/{c.sent})</span>
                    </div>
                  )
                })}
                <div className="er-provider-row" style={{ marginTop: 8 }}><span>Credits remaining</span><b>{data.communication.credits_remaining}</b></div>
              </div>
            </div>
          </div>

          {(event?.menu_enabled || data.program?.in_progress_count > 0 || event?.experience_enabled) && (
            <div className="rd-wide-grid" style={{ marginTop: 14 }}>
              {event?.menu_enabled && (
                <div className="rd-panel">
                  <div className="rd-panel-head"><h3>Meals</h3></div>
                  <div className="rd-panel-body">
                    {data.meals.categories.length === 0 ? <p className="rd-rowlink">No selectable meal categories.</p> : (
                      <div className="rr-quick-big">{data.meals.served_total}<small>/{data.meals.eligible_total} served</small></div>
                    )}
                    <button className="rr-link-btn" onClick={() => setActiveTab('meals')}>Open meal service <Icon name="arrow" size={13} /></button>
                  </div>
                </div>
              )}
              {event?.experience_enabled && (
                <div className="rd-panel">
                  <div className="rd-panel-head"><h3>Program right now</h3></div>
                  <div className="rd-panel-body">
                    {data.program.in_progress_count === 0 ? <p className="rd-rowlink">No sessions in progress.</p> : (
                      data.program.in_progress.slice(0, 3).map((s) => <div key={s.step_id} className="er-checkin-row"><span>{s.title}</span></div>)
                    )}
                    <button className="rr-link-btn" onClick={() => setActiveTab('program')}>{data.program.in_progress_count} in progress <Icon name="arrow" size={13} /></button>
                  </div>
                </div>
              )}
              {event?.experience_enabled && (
                <div className="rd-panel">
                  <div className="rd-panel-head"><h3>Experience journey</h3></div>
                  <div className="rd-panel-body">
                    {experienceSteps.length === 0 ? <p className="rd-rowlink">No Experience steps configured.</p> : (
                      experienceSteps.map((s) => (
                        <div key={s.step_id} className="er-chan-row">
                          <span style={{ minWidth: 90 }}>{s.title}</span>
                          <div className="rd-mini-bar" style={{ flex: 1, margin: '0 10px' }}><i style={{ width: `${s.total ? (s.completed / s.total) * 100 : 0}%` }} /></div>
                          <b>{s.completed}/{s.total}</b>
                        </div>
                      ))
                    )}
                    <button className="rr-link-btn" onClick={() => setActiveTab('experience')}>Open Experience tab <Icon name="arrow" size={13} /></button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'attendance' && <AttendanceTab eventId={eventId} day={day} venueId={venueId} />}
      {activeTab === 'invitations' && <InvitationsTab eventId={eventId} />}
      {activeTab === 'meals' && <MealsTab eventId={eventId} />}
      {activeTab === 'program' && <ProgramTab eventId={eventId} day={day} />}
      {activeTab === 'experience' && <ExperienceTab eventId={eventId} />}
      {activeTab === 'operations' && <OperationsTab eventId={eventId} />}
      </>
      )}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
    </RedesignShell>
  )
}
