import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { Icon } from './redesign/RedesignShell'
import { PHASE_SIX_PROGRESS_PREFIX, phaseSixReadiness } from './guidedSetupPhaseSixModel.mjs'
import './GuidedSetupPhaseTwo.css'

const REVIEW_KEYS = { results: 'results_review', closeout: 'closeout_review', reuse: 'reuse_test', help: 'help_review', integrations: 'integration_test', platform: 'platform_review', media: 'media_review', analytics: 'analytics_review', rollout: 'rollout_review' }
const statusOf = (recipe) => recipe.complete ? 'Complete' : recipe.blocked ? 'Blocked' : 'Ready'

export default function GuidedSetupPhaseSix({ eventId, onBack, notify }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  async function load() {
    if (!eventId) { setLoading(false); return }
    setLoading(true); setError('')
    const calls = await Promise.allSettled([
      api.listEvents(), api.getSetupProgress(eventId), api.resultsCommandCenter(eventId), api.listApiKeys(), api.listWebhooks(),
    ])
    try {
      if (calls[0].status === 'rejected') throw calls[0].reason
      if (calls[1].status === 'rejected') throw calls[1].reason
      const events = calls[0].value
      const event = events.find((item) => item.id === eventId)
      if (!event) throw new Error("That event isn't available on this account.")
      const value = (index, fallback) => calls[index].status === 'fulfilled' ? calls[index].value : fallback
      setData({ event, events, progress: value(1, {}).steps || {}, results: value(2, null), apiKeys: value(3, []), webhooks: value(4, []), dataFailures: calls.slice(2).map((result, index) => result.status === 'rejected' ? index : null).filter((index) => index !== null) })
    } catch (cause) { setError(cause.message || 'Phase 6 readiness could not be loaded') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  const readiness = useMemo(() => data ? phaseSixReadiness(data) : null, [data])

  async function verify(id) {
    setSaving(id)
    try {
      await api.setSetupProgress(eventId, `${PHASE_SIX_PROGRESS_PREFIX}${REVIEW_KEYS[id]}`, 'completed')
      notify(`${id.replaceAll('_', ' ')} review recorded`)
      await load()
    } catch (cause) { notify(cause.message || 'Review evidence could not be saved', true) }
    finally { setSaving('') }
  }

  if (!eventId) return <div className="gsp-empty"><h2>Select an event</h2></div>
  if (loading) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={9} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  const percent = readiness.total ? Math.round(readiness.complete / readiness.total * 100) : 0

  return <div className="gst-guide">
    <header className="gsp-guide-head"><div><span className="gsp-eyebrow">Phase 6 · results, reuse and platform</span><h2>{data.event.name}</h2><p>{readiness.complete} of {readiness.total} closeout procedures complete · {readiness.blocked} blocked</p></div><div className="gst-head-actions"><button className="rr-btn secondary" onClick={onBack}>Conference &amp; Live</button><button className="rr-btn secondary" onClick={load}>Refresh status</button></div></header>
    <div className="gsp-progress" aria-label={`${percent} percent complete`}><span style={{ width: `${percent}%` }} /></div>
    {readiness.dataFailures.length > 0 && <div className="gst-warning"><Icon name="info" size={17} /><span>Some optional result or organization services are unavailable for your role. Their procedures remain visible and cannot be reported as complete automatically.</span></div>}
    {readiness.next && <section className={`gsp-next${readiness.next.blocked ? ' blocked' : ''}`}><div><span className="gsp-eyebrow">Next recommended action</span><h3>{readiness.next.title}</h3><p>{readiness.next.description}</p></div><a className="rr-btn primary" href={readiness.next.route}>{readiness.next.action} →</a></section>}
    <div className="gst-recipe-list">{readiness.recipes.map((recipe) => <article className={`gst-recipe ${recipe.complete ? 'complete' : recipe.blocked ? 'blocked' : 'ready'}`} key={recipe.id}><div className="gst-recipe-number">{recipe.complete ? '✓' : recipe.number}</div><div className="gst-recipe-copy"><div className="gst-recipe-title"><div><span>{recipe.number}</span><h3>{recipe.title}</h3></div><b>{statusOf(recipe)}</b></div><p>{recipe.description}</p><div className="gst-evidence"><strong>Live evidence</strong><span>{recipe.evidence}</span></div><div className="gst-recipe-actions"><a className="rr-btn secondary" href={recipe.route}>{recipe.action} →</a>{!recipe.complete && !recipe.blocked && <button className="rr-btn primary" disabled={saving === recipe.id} onClick={() => verify(recipe.id)}>{saving === recipe.id ? 'Saving…' : 'Mark review or controlled test verified'}</button>}</div></div></article>)}</div>
    <section className="gst-safety"><Icon name="info" size={18} /><div><strong>Production remains gated</strong><p>Completing this guide records review evidence. It does not enable a tenant, promote an image, archive an event, rotate credentials or bypass GitOps approval.</p></div></section>
  </div>
}
