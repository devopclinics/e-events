import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { Icon } from './redesign/RedesignShell'
import { selectedOutcomeIds } from './guidedSetupPhaseOneModel.mjs'
import { PHASE_TWO_PROGRESS_PREFIX, phaseTwoReadiness } from './guidedSetupPhaseTwoModel.mjs'
import './GuidedSetupPhaseTwo.css'

const TEST_KEYS = { rsvp: 'rsvp_test', tickets: 'ticket_test', pass: 'pass_test', channels: 'channel_test', automation: 'automation_test' }
const statusOf = (recipe) => recipe.complete ? 'Complete' : recipe.blocked ? 'Blocked' : 'Ready'

export default function GuidedSetupPhaseTwo({ eventId, onBack, notify }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  async function load() {
    if (!eventId) { setLoading(false); return }
    setLoading(true); setError('')
    const calls = await Promise.allSettled([
      api.listEvents(), api.getSetupProgress(eventId), api.listGuests(eventId), api.listRSVPQuestions(eventId),
      api.ticketingConfig(eventId), api.ticketingProducts(eventId), api.ticketingPayoutAccounts(eventId), api.listScheduledCommunications(eventId),
    ])
    try {
      if (calls[0].status === 'rejected') throw calls[0].reason
      if (calls[1].status === 'rejected') throw calls[1].reason
      const event = calls[0].value.find((candidate) => candidate.id === eventId)
      if (!event) throw new Error("That event isn't available on this account.")
      const value = (index, fallback) => calls[index].status === 'fulfilled' ? calls[index].value : fallback
      setData({ event, progress: value(1, {}).steps || {}, guests: value(2, []), questions: value(3, []), ticketConfig: value(4, null), ticketProducts: value(5, []), payoutAccounts: value(6, []), schedules: value(7, []), dataFailures: calls.slice(2).map((result, index) => result.status === 'rejected' ? index : null).filter((item) => item !== null) })
    } catch (err) { setError(err.message || 'Phase 2 readiness could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const readiness = useMemo(() => data ? phaseTwoReadiness({ ...data, selectedOutcomes: selectedOutcomeIds(data.progress) }) : null, [data])

  async function verifyTest(recipeId) {
    const key = TEST_KEYS[recipeId]
    if (!key) return
    setSaving(recipeId)
    try {
      await api.setSetupProgress(eventId, `${PHASE_TWO_PROGRESS_PREFIX}${key}`, 'completed')
      notify(`${recipeId === 'pass' ? 'Pass delivery' : recipeId === 'channels' ? 'Channel' : recipeId === 'automation' ? 'Automation' : recipeId === 'tickets' ? 'Checkout' : 'RSVP'} test recorded`)
      await load()
    } catch (err) { notify(err.message || 'Test evidence could not be saved', true) }
    finally { setSaving('') }
  }

  if (!eventId) return <div className="gsp-empty"><h2>Select an event</h2><p>Phase 2 needs an active event context.</p></div>
  if (loading) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={8} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  if (!readiness.recipes.length) return <div className="gsp-empty"><h2>Phase 2 is not needed yet</h2><p>Choose RSVP, ticket sales, or guest communication in the outcome launcher to add the matching procedures.</p><button className="rr-btn primary" onClick={onBack}>Review foundation</button></div>

  const percent = readiness.total ? Math.round(readiness.complete / readiness.total * 100) : 0
  return <div className="gst-guide">
    <header className="gsp-guide-head"><div><span className="gsp-eyebrow">Phase 2 · audience and registration</span><h2>{data.event.name}</h2><p>{readiness.complete} of {readiness.total} selected procedures complete · {readiness.blocked} blocked</p></div><div className="gst-head-actions"><button className="rr-btn secondary" onClick={onBack}>Foundation</button><button className="rr-btn secondary" onClick={load}>Refresh status</button></div></header>
    <div className="gsp-progress" aria-label={`${percent} percent complete`}><span style={{ width: `${percent}%` }} /></div>
    {readiness.dataFailures.length > 0 && <div className="gst-warning"><Icon name="info" size={17} /><span>Some optional service checks are unavailable. Their procedures remain visible and are not reported as complete.</span></div>}
    {readiness.next && <section className={`gsp-next${readiness.next.blocked ? ' blocked' : ''}`}><div><span className="gsp-eyebrow">Next recommended action</span><h3>{readiness.next.title}</h3><p>{readiness.next.description}</p></div><a className="rr-btn primary" href={readiness.next.route}>{readiness.next.action} →</a></section>}
    <div className="gst-recipe-list">{readiness.recipes.map((recipe) => {
      const testKey = TEST_KEYS[recipe.id]
      return <article className={`gst-recipe ${recipe.complete ? 'complete' : recipe.blocked ? 'blocked' : 'ready'}`} key={recipe.id}>
        <div className="gst-recipe-number">{recipe.complete ? '✓' : recipe.number}</div>
        <div className="gst-recipe-copy"><div className="gst-recipe-title"><div><span>{recipe.number}</span><h3>{recipe.title}</h3></div><b>{statusOf(recipe)}</b></div><p>{recipe.description}</p><div className="gst-evidence"><strong>Live evidence</strong><span>{recipe.evidence}</span></div><div className="gst-recipe-actions"><a className="rr-btn secondary" href={recipe.route}>{recipe.action} →</a>{testKey && !recipe.complete && !recipe.blocked && <button className="rr-btn primary" disabled={saving === recipe.id} onClick={() => verifyTest(recipe.id)}>{saving === recipe.id ? 'Saving…' : 'Mark controlled test verified'}</button>}</div></div>
      </article>
    })}</div>
    <section className="gst-safety"><Icon name="info" size={18} /><div><strong>Launch safety</strong><p>Test actions must use a controlled recipient or test order. Provider acceptance alone is not final delivery; confirm the resulting guest, admission, pass and delivery state before recording a test.</p></div></section>
  </div>
}
