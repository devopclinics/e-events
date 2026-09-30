import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { Icon } from './redesign/RedesignShell'
import './GuidedSetupPhaseOne.css'

import { OUTCOME_PREFIX, PHASE_ONE_OUTCOMES, phaseOneReadiness, selectedOutcomeIds } from './guidedSetupPhaseOneModel.mjs'

function statusLabel(status) {
  if (status === 'complete') return 'Complete'
  if (status === 'blocked') return 'Needs attention'
  return 'Ready'
}

export function OutcomeLauncher({ eventId, onContinue, notify }) {
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (!eventId) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const progress = await api.getSetupProgress(eventId)
      setSelected(selectedOutcomeIds(progress.steps))
    } catch (err) { setError(err.message || 'Your saved outcomes could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  async function save() {
    if (!selected.length) { notify('Choose at least one outcome for this event.', true); return }
    setSaving(true)
    try {
      await Promise.all(PHASE_ONE_OUTCOMES.map((item) => api.setSetupProgress(eventId, `${OUTCOME_PREFIX}${item.id}`, selected.includes(item.id) ? 'completed' : 'skipped')))
      notify(`${selected.length} event outcome${selected.length === 1 ? '' : 's'} saved`)
      onContinue()
    } catch (err) { notify(err.message || 'Outcomes could not be saved', true) }
    finally { setSaving(false) }
  }

  if (!eventId) return <div className="rr-panel"><div className="rd-panel-body">Create or select an event before choosing outcomes.</div></div>
  if (loading) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={6} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>

  return <section className="gsp-outcomes" aria-labelledby="gsp-outcome-title">
    <div className="gsp-title-row"><div><span className="gsp-eyebrow">Phase 1 · choose outcomes</span><h2 id="gsp-outcome-title">What do you want to accomplish?</h2><p>Select everything this event needs. Festio will build one connected procedure and reuse the event details you already entered.</p></div><span className="gsp-selection-count">{selected.length} selected</span></div>
    <div className="gsp-outcome-grid">{PHASE_ONE_OUTCOMES.map((item) => {
      const active = selected.includes(item.id)
      return <button type="button" key={item.id} className={`gsp-outcome${active ? ' selected' : ''}`} onClick={() => toggle(item.id)} aria-pressed={active}>
        <span className="gsp-outcome-icon"><Icon name={item.icon} size={19} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><span className="gsp-check">{active ? '✓' : '+'}</span>
      </button>
    })}</div>
    <div className="gsp-outcome-note"><Icon name="info" size={17} /><span>Choosing an outcome does not publish or enable a paid feature. The next screen checks access, prerequisites and blockers before anything changes.</span></div>
    <div className="gsp-actions"><a className="rr-btn secondary" href="/admin-redesign">Back to Event Setup</a><button className="rr-btn primary" disabled={saving || !selected.length} onClick={save}>{saving ? 'Saving…' : 'Build my setup guide →'}</button></div>
  </section>
}

export function PhaseOneGuide({ eventId, onChooseOutcomes, onCreateEvent }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    if (!eventId) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const [eventsResult, progressResult, membersResult, passResult] = await Promise.allSettled([
        api.listEvents(), api.getSetupProgress(eventId), api.listMembers(eventId), api.getEventPass(eventId),
      ])
      if (eventsResult.status === 'rejected') throw eventsResult.reason
      if (progressResult.status === 'rejected') throw progressResult.reason
      const event = eventsResult.value.find((row) => row.id === eventId)
      if (!event) { const missing = new Error("That event isn't available on this account."); missing.status = 404; throw missing }
      setData({ event, progress: progressResult.value.steps || {}, members: membersResult.status === 'fulfilled' ? membersResult.value : [], eventPass: passResult.status === 'fulfilled' ? passResult.value : null, optionalFailures: [membersResult, passResult].filter((result) => result.status === 'rejected').length })
    } catch (err) { setError(err.message || 'Setup readiness could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => selectedOutcomeIds(data?.progress), [data])
  if (!eventId) return <div className="gsp-empty"><h2>Start your setup guide</h2><p>Create an event first. Festio saves the draft before asking which outcomes you want.</p><button className="rr-btn primary" onClick={onCreateEvent}>Create an event</button></div>
  if (loading) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={7} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>

  const { event, members, eventPass, optionalFailures } = data
  const readiness = phaseOneReadiness({ event, progress: data.progress, members, eventPass, optionalFailures })
  const { foundationComplete, venueComplete, teamComplete, outcomesComplete, gatedSelections, entitlementBlocked, completed, total, blockers } = readiness
  const next = readiness.next === 'event' ? { label: 'Complete event details', route: '/admin-redesign' }
    : readiness.next === 'outcomes' ? { label: 'Choose event outcomes', action: onChooseOutcomes }
      : readiness.next === 'team' ? { label: 'Assign your event team', route: '/team-redesign?tab=team' }
        : readiness.next === 'capabilities' ? { label: 'Review capability access', route: '/billing-redesign?tab=billing' }
          : { label: 'Open the first selected workspace', route: PHASE_ONE_OUTCOMES.find((item) => item.id === selected[0])?.route || '/admin-redesign' }

  const checks = [
    { id: 'organization', title: 'Organization readiness', text: eventPass ? 'Plan and Event Pass information loaded from Billing.' : 'Open Billing to review plan, credits and provider access.', status: readiness.organizationReadable ? 'complete' : 'ready', route: '/billing-redesign?tab=org' },
    { id: 'event', title: 'Event foundation', text: foundationComplete ? `${event.name} · ${new Date(event.event_date).toLocaleDateString()} · ${event.timezone}` : 'Name, date and timezone are required before other setup can be trusted.', status: foundationComplete ? 'complete' : 'blocked', route: '/admin-redesign' },
    { id: 'venue', title: 'Venue and location', text: venueComplete ? [event.venue_name, event.venue_address].filter(Boolean).join(' · ') : 'Add the venue now or return when it is confirmed.', status: venueComplete ? 'complete' : 'ready', route: '/admin-redesign' },
    { id: 'team', title: 'Team ownership', text: teamComplete ? `${members.length} assigned team member${members.length === 1 ? '' : 's'}.` : 'Assign owners for registration, communication, operations, finance or live delivery.', status: teamComplete ? 'complete' : 'ready', route: '/team-redesign?tab=team' },
    { id: 'outcomes', title: 'Selected outcomes', text: outcomesComplete ? `${selected.length} outcome${selected.length === 1 ? '' : 's'} selected for this event.` : 'Choose what this event needs so Festio can build the correct procedure.', status: outcomesComplete ? 'complete' : 'blocked', action: onChooseOutcomes },
    { id: 'capabilities', title: 'Capability readiness', text: entitlementBlocked ? `${gatedSelections.length} selected outcome${gatedSelections.length === 1 ? '' : 's'} may require an Event Pass or add-on. Review access before setup.` : 'Selected outcomes can proceed to their current workspaces.', status: entitlementBlocked ? 'blocked' : 'complete', route: '/billing-redesign?tab=billing' },
  ]

  return <div className="gsp-guide">
    <header className="gsp-guide-head"><div><span className="gsp-eyebrow">Phase 1 · setup guide</span><h2>{event.name}</h2><p>{completed} of {total} foundation checks complete · {blockers} blocker{blockers === 1 ? '' : 's'}</p></div><button className="rr-btn secondary" onClick={onChooseOutcomes}>Edit outcomes</button></header>
    <div className="gsp-progress" aria-label={`${Math.round(completed / total * 100)} percent complete`}><span style={{ width: `${completed / total * 100}%` }} /></div>
    <section className={`gsp-next${blockers ? ' blocked' : ''}`}><div><span className="gsp-eyebrow">Next recommended action</span><h3>{next.label}</h3><p>Festio uses the current event record to recommend this step. Existing workspaces remain available at every stage.</p></div>{next.action ? <button className="rr-btn primary" onClick={next.action}>Continue →</button> : <a className="rr-btn primary" href={next.route}>Continue →</a>}</section>
    <div className="gsp-checks">{checks.map((check, index) => <article key={check.id} className={`gsp-readiness ${check.status}`}><span className="gsp-step-number">{check.status === 'complete' ? '✓' : index + 1}</span><div><div className="gsp-readiness-title"><h3>{check.title}</h3><span>{statusLabel(check.status)}</span></div><p>{check.text}</p>{check.action ? <button className="rr-link-btn" onClick={check.action}>Review step →</button> : <a className="rr-link-btn" href={check.route}>Open workspace →</a>}</div></article>)}</div>
    {selected.length > 0 && <section className="gsp-selected"><div><span className="gsp-eyebrow">Your event roadmap</span><h3>Selected outcomes</h3><p>Phase 1 connects these existing workspaces. Their full procedural recipes arrive in their assigned phases.</p></div><div className="gsp-selected-grid">{selected.map((id) => { const item = PHASE_ONE_OUTCOMES.find((candidate) => candidate.id === id); return item ? <a href={item.route} key={id}><Icon name={item.icon} size={17} /><span><strong>{item.label}</strong><small>Full guided recipe · Phase {item.phase}</small></span><b>→</b></a> : null })}</div></section>}
  </div>
}
