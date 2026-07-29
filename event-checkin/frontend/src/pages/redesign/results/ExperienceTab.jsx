import { useEffect, useState } from 'react'
import { Icon } from '../RedesignShell'
import { LoadingSkeleton } from '../RedesignPrimitives'
import { api } from '../../../api'

// Standalone build-out of the real Experience tab (ResultsPage.jsx:978-996),
// fed by GET /api/results/events/{id}/analytics/experience (api.resultsExperience)
// -> dashboard-service/app/main.py experience_funnel() (~line 583), which returns
// { steps: [{ step_id, title, type, required, total, completed, failed }, ...] }
// for every enabled ExperienceStep on the event's default workflow, in sort order.
// Unlike the Overview card's steps.slice(0, 6) preview, this tab shows every step.
//
// Steps with failed > 0 get a "View N blocked guests" toggle that lazily fetches
// GET /api/results/events/{id}/analytics/experience/steps/{step_id}/guests
// (api.resultsExperienceStepGuests) -> get_experience_step_guests() (~line 1189),
// which resolves to guests whose progress on that step is 'failed' (attempted and
// rejected — e.g. a denied consent or ID check — as opposed to 'not_started', which
// just means they haven't reached the step yet). Response: { guests: [{ id, name,
// email, phone, rsvp_status, context }], step_title }. Mirrors InlineGuestList's
// lazy-fetch-on-expand behavior (ResultsPage.jsx:223-252) with a local component
// instead, since this tab owns its own per-step expand/collapse state.

function BlockedGuestList({ eventId, stepId }) {
  const [state, setState] = useState({ loading: true, error: '', guests: null })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: '', guests: null })
    api.resultsExperienceStepGuests(eventId, stepId).then((res) => {
      if (!cancelled) setState({ loading: false, error: '', guests: res.guests })
    }).catch(() => {
      if (!cancelled) setState({ loading: false, error: 'Could not load guest list.', guests: null })
    })
    return () => { cancelled = true }
  }, [eventId, stepId])

  if (state.loading) return <p className="rd-rowlink" style={{ padding: '6px 0' }}>Loading guests…</p>
  if (state.error) return <p className="rd-rowlink" style={{ padding: '6px 0' }}>{state.error}</p>
  if (!state.guests || state.guests.length === 0) return <p className="rd-rowlink" style={{ padding: '6px 0' }}>No guests found.</p>
  return (
    <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
      {state.guests.map((g) => (
        <div key={g.id} className="er-checkin-row">
          <span>{g.name}</span>
          <span className="rd-rowlink">{g.context || g.email || g.phone || '—'}</span>
        </div>
      ))}
    </div>
  )
}

function StepRow({ eventId, step }) {
  const [expanded, setExpanded] = useState(false)
  const pct = step.total ? Math.min(100, Math.round((step.completed / step.total) * 100)) : 0

  return (
    <div className="ex-step-row" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="er-chan-row">
        <span style={{ minWidth: 160 }}>
          {step.title}
          {!step.required && <span className="rd-rowlink"> (optional)</span>}
        </span>
        <div className="rd-mini-bar" style={{ flex: 1, margin: '0 10px' }}><i style={{ width: `${pct}%` }} /></div>
        <b>{step.completed}/{step.total}</b>
      </div>
      {step.failed > 0 && (
        <button className="rp-link-btn" style={{ marginTop: 4 }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide' : `View ${step.failed} blocked guest${step.failed === 1 ? '' : 's'}`}
          <Icon name="chevrondown" size={12} className={expanded ? 'rp-chev-open' : ''} />
        </button>
      )}
      {expanded && <BlockedGuestList eventId={eventId} stepId={step.step_id} />}
    </div>
  )
}

export default function ExperienceTab({ eventId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) { setData(null); setError(''); return }
    let cancelled = false
    setData(null)
    setError('')
    api.resultsExperience(eventId).then((res) => {
      if (!cancelled) setData(res)
    }).catch((err) => {
      if (!cancelled) setError(err.message || 'Experience data is temporarily unavailable.')
    })
    return () => { cancelled = true }
  }, [eventId])

  if (!eventId) return null

  if (error) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div>
      </div>
    )
  }

  if (!data) return <LoadingSkeleton rows={5} variant="card" />

  const steps = data.steps || []

  return (
    <div className="rd-panel">
      <div className="rd-panel-head"><h3>Completion funnel</h3></div>
      <div className="rd-panel-body">
        {steps.length === 0 ? (
          <p className="rd-rowlink">No Experience steps configured for this event yet.</p>
        ) : (
          steps.map((s) => <StepRow key={s.step_id} eventId={eventId} step={s} />)
        )}
      </div>
    </div>
  )
}
