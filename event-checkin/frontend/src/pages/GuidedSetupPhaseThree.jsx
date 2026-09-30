import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { Icon } from './redesign/RedesignShell'
import { selectedOutcomeIds } from './guidedSetupPhaseOneModel.mjs'
import { PHASE_THREE_PROGRESS_PREFIX, phaseThreeReadiness } from './guidedSetupPhaseThreeModel.mjs'
import './GuidedSetupPhaseTwo.css'

const TEST_KEYS = { design: 'design_review', invitation: 'invitation_test', materials: 'materials_review', guesthub: 'guesthub_test', community: 'community_test' }
const statusOf = (recipe) => recipe.complete ? 'Complete' : recipe.blocked ? 'Blocked' : 'Ready'

export default function GuidedSetupPhaseThree({ eventId, onBack, notify }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  async function load() {
    if (!eventId) { setLoading(false); return }
    setLoading(true); setError('')
    const calls = await Promise.allSettled([
      api.listEvents(), api.getSetupProgress(eventId), api.getEventDesign(eventId), api.designOutputs(eventId), api.website(eventId), api.websiteReleases(eventId),
      api.messagingSettings(eventId), api.eventFestioMeStatus(eventId), api.festiomeManageGroups(eventId), api.listSpeakers(eventId), api.getSpeakerSettings(eventId),
      api.listPartners(eventId), api.getPartnerSettings(eventId),
    ])
    try {
      if (calls[0].status === 'rejected') throw calls[0].reason
      if (calls[1].status === 'rejected') throw calls[1].reason
      const event = calls[0].value.find((candidate) => candidate.id === eventId)
      if (!event) throw new Error("That event isn't available on this account.")
      const value = (index, fallback) => calls[index].status === 'fulfilled' ? calls[index].value : fallback
      setData({ event, progress: value(1, {}).steps || {}, design: value(2, null), outputs: value(3, []), website: value(4, null), releases: value(5, []), guestHubSettings: value(6, null), festiomeStatus: value(7, null), festiomeGroups: value(8, []), speakers: value(9, []), speakerSettings: value(10, null), partners: value(11, []), partnerSettings: value(12, null), dataFailures: calls.slice(2).map((result, index) => result.status === 'rejected' ? index : null).filter((item) => item !== null) })
    } catch (err) { setError(err.message || 'Phase 3 readiness could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const readiness = useMemo(() => data ? phaseThreeReadiness({ ...data, selectedOutcomes: selectedOutcomeIds(data.progress) }) : null, [data])

  async function verifyTest(recipeId) {
    const key = TEST_KEYS[recipeId]
    if (!key) return
    setSaving(recipeId)
    try {
      await api.setSetupProgress(eventId, `${PHASE_THREE_PROGRESS_PREFIX}${key}`, 'completed')
      notify(`${recipeId === 'design' ? 'Responsive design review' : recipeId === 'invitation' ? 'Invitation guest flow' : recipeId === 'materials' ? 'Event materials review' : recipeId === 'guesthub' ? 'GuestHub preview' : 'FestioMe preview'} recorded`)
      await load()
    } catch (err) { notify(err.message || 'Review evidence could not be saved', true) }
    finally { setSaving('') }
  }

  if (!eventId) return <div className="gsp-empty"><h2>Select an event</h2><p>Phase 3 needs an active event context.</p></div>
  if (loading) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={8} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  if (!readiness.recipes.length) return <div className="gsp-empty"><h2>No guest experience selected</h2><p>Choose an event website, GuestHub, FestioMe, RSVP, or ticket sales outcome to add Phase 3 procedures.</p><button className="rr-btn primary" onClick={onBack}>Review registration</button></div>

  const percent = readiness.total ? Math.round(readiness.complete / readiness.total * 100) : 0
  return <div className="gst-guide">
    <header className="gsp-guide-head"><div><span className="gsp-eyebrow">Phase 3 · design and guest experience</span><h2>{data.event.name}</h2><p>{readiness.complete} of {readiness.total} selected procedures complete · {readiness.blocked} blocked</p></div><div className="gst-head-actions"><button className="rr-btn secondary" onClick={onBack}>Audience &amp; registration</button><button className="rr-btn secondary" onClick={load}>Refresh status</button></div></header>
    <div className="gsp-progress" aria-label={`${percent} percent complete`}><span style={{ width: `${percent}%` }} /></div>
    {readiness.dataFailures.length > 0 && <div className="gst-warning"><Icon name="info" size={17} /><span>Some optional Phase 3 services are unavailable. Their procedures remain visible and are not reported as complete.</span></div>}
    {readiness.next && <section className={`gsp-next${readiness.next.blocked ? ' blocked' : ''}`}><div><span className="gsp-eyebrow">Next recommended action</span><h3>{readiness.next.title}</h3><p>{readiness.next.description}</p></div><a className="rr-btn primary" href={readiness.next.route}>{readiness.next.action} →</a></section>}
    <div className="gst-recipe-list">{readiness.recipes.map((recipe) => {
      const testKey = TEST_KEYS[recipe.id]
      return <article className={`gst-recipe ${recipe.complete ? 'complete' : recipe.blocked ? 'blocked' : 'ready'}`} key={recipe.id}><div className="gst-recipe-number">{recipe.complete ? '✓' : recipe.number}</div><div className="gst-recipe-copy"><div className="gst-recipe-title"><div><span>{recipe.number}</span><h3>{recipe.title}</h3></div><b>{statusOf(recipe)}</b></div><p>{recipe.description}</p><div className="gst-evidence"><strong>Live evidence</strong><span>{recipe.evidence}</span></div><div className="gst-recipe-actions"><a className="rr-btn secondary" href={recipe.route}>{recipe.action} →</a>{testKey && !recipe.complete && !recipe.blocked && <button className="rr-btn primary" disabled={saving === recipe.id} onClick={() => verifyTest(recipe.id)}>{saving === recipe.id ? 'Saving…' : 'Mark preview or review verified'}</button>}</div></div></article>
    })}</div>
    <section className="gst-safety"><Icon name="info" size={18} /><div><strong>One source for every surface</strong><p>Dates and venue stay in Event Setup. Programme, speaker and partner records stay in their current workspaces. Phase 3 only connects and publishes those records, so edits continue to flow to every selected surface.</p></div></section>
  </div>
}
