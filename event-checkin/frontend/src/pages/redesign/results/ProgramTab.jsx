import { useState, useEffect, useCallback } from 'react'
import { LoadingSkeleton } from '../RedesignPrimitives'
import { api } from '../../../api'

// Standalone Program tab for the Event Results redesign (EventResultsRedesignPage.jsx).
// Mirrors the real tab: ResultsPage.jsx :939-977 (JSX) + SessionRow (:353-380),
// backed by dashboard-service's program_sessions()/get_program() (main.py ~:480-578).
//
// The endpoint takes a `day` filter (unlike most other results endpoints) and
// returns { sessions, in_progress_count, upcoming_count, ended_count,
// attendance_tracked_count }. A session item is either a timed Experience
// segment (is_segment) or a session_attendance step — both included, per the
// comment in program_sessions(). Fields per item: step_id, topic, description,
// category, day, start_time/end_time (formatted local strings), room, speaker,
// capacity, start_at/end_at (iso), state ('upcoming'|'in_progress'|'ended'),
// attendance_tracked, registered, attended, no_show_rate.
//
// program_sessions() returns [] both when the event has Experience disabled
// AND when it's enabled but has no qualifying steps configured — the API
// response alone can't tell those apart, so (like ResultsPage.jsx, which has
// its own separately-loaded `event`) we do a light events lookup here just to
// read event.experience_enabled and pick the right empty-state copy.

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const STATE_LABEL = { in_progress: 'in progress', upcoming: 'upcoming', ended: 'ended' }
const STATE_COLOR = {
  in_progress: 'var(--success, #16a34a)',
  upcoming: 'var(--muted, #64748b)',
  ended: 'var(--faint, #94a3b8)',
}

function SessionStateBadge({ state }) {
  return (
    <span
      style={{
        display: 'inline-block', borderRadius: 999, padding: '2px 8px', fontSize: 10,
        fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em',
        color: STATE_COLOR[state] || 'var(--muted, #64748b)',
        background: 'color-mix(in srgb, ' + (STATE_COLOR[state] || 'var(--muted, #64748b)') + ' 14%, transparent)',
      }}
    >
      {STATE_LABEL[state] || state}
    </span>
  )
}

function SessionRow({ s, speakerToken }) {
  return (
    <div className="er-checkin-row" style={{ alignItems: 'flex-start' }}>
      <span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {s.state === 'in_progress' && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATE_COLOR.in_progress, flexShrink: 0 }} />
          )}
          <b>{s.topic}</b>
        </span>
        <div className="rd-rowlink" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 3 }}>
          {s.start_time && <span>{s.start_time}{s.end_time ? `–${s.end_time}` : ''}</span>}
          {s.category && <span style={{ textTransform: 'capitalize' }}>{s.category}</span>}
          {s.room && <span>{s.room}</span>}
          {s.speaker && (
            s.speaker_id && speakerToken
              ? <a href={`/speakers/${speakerToken}`} target="_blank" rel="noreferrer" style={{ color: 'var(--teal)', fontWeight: 600 }}>{s.speaker} ↗</a>
              : <span>{s.speaker}</span>
          )}
          {s.attendance_tracked && <span style={{ fontWeight: 600, color: 'var(--teal)' }}>Attendance tracked</span>}
        </div>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <SessionStateBadge state={s.state} />
        {s.attendance_tracked && (
          <b title="Recorded attendance">{s.attended}{s.capacity ? `/${s.capacity}` : ''}</b>
        )}
      </span>
    </div>
  )
}

export default function ProgramTab({ eventId, day }) {
  const [program, setProgram] = useState(null)
  const [experienceEnabled, setExperienceEnabled] = useState(null) // null = unknown yet
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (id, d) => {
    if (!id) return
    setLoading(true)
    try {
      const [prog, evs] = await Promise.all([
        api.resultsProgram(id, d || undefined),
        api.listEvents().catch(() => []),
      ])
      setProgram(prog)
      const ev = evs.find((e) => e.id === id)
      setExperienceEnabled(ev ? !!ev.experience_enabled : null)
      setError('')
    } catch (err) {
      setError(err.message || 'Program data is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!eventId) { setProgram(null); return }
    load(eventId, day)
  }, [eventId, day, load])

  if (!eventId) return null

  if (error) {
    return (
      <div className="rd-panel"><div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div></div>
    )
  }

  if (loading && !program) {
    return <LoadingSkeleton rows={4} variant="card" />
  }

  if (!program) return null

  if (experienceEnabled === false) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body">
          <p className="rd-rowlink">Experience isn't enabled for this event, so there's no program to show.</p>
        </div>
      </div>
    )
  }

  if (program.sessions.length === 0) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body">
          <p className="rd-rowlink">No session_attendance Experience steps configured for this event yet.</p>
        </div>
      </div>
    )
  }

  const grouped = Object.entries(
    program.sessions.reduce((groups, session) => {
      const key = session.day || 'Unscheduled'
      ;(groups[key] ||= []).push(session)
      return groups
    }, {})
  )

  return (
    <div>
      <div className="rr-grid4">
        <div className="rr-panel er-stat"><span>In progress</span><strong>{program.in_progress_count}</strong></div>
        <div className="rr-panel er-stat"><span>Upcoming</span><strong>{program.upcoming_count}</strong></div>
        <div className="rr-panel er-stat"><span>Completed</span><strong>{program.ended_count}</strong></div>
        <div className="rr-panel er-stat"><span>Program items</span><strong>{program.sessions.length}</strong></div>
      </div>

      <div className="rd-panel" style={{ marginTop: 14 }}>
        <div className="rd-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h3>Complete program</h3>
          <span className="rd-rowlink">{program.attendance_tracked_count} attendance-tracked</span>
        </div>
        <div className="rd-panel-body">
          {grouped.map(([programDay, sessions]) => (
            <section key={programDay} style={{ marginBottom: 18 }}>
              <h4 style={{
                margin: '0 0 4px', paddingBottom: 8, borderBottom: '1px solid var(--line)',
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--muted)',
              }}>
                {programDay === 'Unscheduled' ? programDay : fmtDay(programDay)}
              </h4>
              <div>
                {sessions.map((s) => <SessionRow key={s.step_id} s={s} speakerToken={program.speaker_token} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
