import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

// A lightweight console for a Presenter or Moderator share-link (Settings →
// Share Links in the admin page) — no Festio login. The URL's ?role= only
// picks which UI to render; the token's own embedded capabilities are what
// the server actually enforces (see engagement-service/app/auth.py).
export default function LiveControlPage() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token') || ''
  const role = params.get('role') || 'presenter'
  const [activities, setActivities] = useState(null)
  const [activityId, setActivityId] = useState(params.get('activity') || null)
  const [activity, setActivity] = useState(null)
  const [results, setResults] = useState(null)
  const [qna, setQna] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) { setError('This link is missing its access token.'); return }
    api.liveControlActivities(token).then(setActivities).catch((e) => setError(e.message))
  }, [token])

  const load = useCallback(async () => {
    if (!activityId) return
    try {
      const a = await api.liveControlActivity(token, activityId)
      setActivity(a)
      if (role === 'presenter') setResults(await api.liveControlResults(token, activityId))
      if (role === 'moderator') setQna(await api.liveControlQnaList(token, activityId))
    } catch (e) { setError(e.message) }
  }, [token, activityId, role])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!activityId) return undefined
    const poll = setInterval(load, 5000)
    return () => clearInterval(poll)
  }, [activityId, load])

  async function setStatus(status) {
    setBusy(true)
    try { await api.liveControlSetStatus(token, activityId, status); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function advance(questionId) {
    setBusy(true)
    try { await api.liveControlAdvance(token, activityId, questionId); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function moderate(qnaId, status) {
    setBusy(true)
    try { await api.liveControlQnaModerate(token, qnaId, status); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-xs font-extrabold uppercase tracking-[0.2em] text-teal-500">Festio Live · {role === 'moderator' ? 'Moderator' : 'Presenter'} console</div>
        {error && <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</div>}

        {!activityId && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-500">Pick an activity to control:</p>
            {activities === null ? <p className="text-sm text-slate-400">Loading…</p> : activities.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing is live right now.</p>
            ) : activities.map((a) => (
              <button key={a.id} type="button" onClick={() => setActivityId(a.id)}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm font-extrabold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                {a.title} <span className="ml-2 text-xs font-bold uppercase text-teal-500">{a.status}</span>
              </button>
            ))}
          </div>
        )}

        {activityId && activity && (
          <div className="grid gap-4">
            <button type="button" onClick={() => setActivityId(null)} className="text-left text-xs font-extrabold uppercase tracking-wide text-slate-400">← Change activity</button>
            <div className="text-xl font-extrabold text-slate-900 dark:text-white">{activity.title}</div>

            {role === 'presenter' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {activity.status === 'draft' && <button type="button" disabled={busy} onClick={() => setStatus('live')} className="rounded-xl bg-teal-400 px-4 py-2 text-sm font-extrabold text-slate-950">Go Live</button>}
                  {activity.status === 'live' && <button type="button" disabled={busy} onClick={() => setStatus('paused')} className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-extrabold text-slate-800 dark:text-white">Pause</button>}
                  {activity.status === 'paused' && <button type="button" disabled={busy} onClick={() => setStatus('live')} className="rounded-xl bg-teal-400 px-4 py-2 text-sm font-extrabold text-slate-950">Resume</button>}
                  {['live', 'paused'].includes(activity.status) && <button type="button" disabled={busy} onClick={() => setStatus('closed')} className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-extrabold text-slate-800 dark:text-white">Close</button>}
                </div>
                <div className="grid gap-2">
                  {activity.questions.map((q, i) => (
                    <div key={q.id} className={`flex items-center justify-between rounded-xl border-2 p-3 ${activity.config?.current_question_id === q.id ? 'border-teal-400 bg-teal-50 dark:bg-teal-950' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
                      <div className="text-sm font-bold text-slate-800 dark:text-white">{i + 1}. {q.prompt}</div>
                      <button type="button" disabled={busy} onClick={() => advance(q.id)} className="shrink-0 rounded-lg border-2 border-slate-300 px-3 py-1.5 text-xs font-extrabold text-slate-700 dark:text-white">
                        {activity.config?.current_question_id === q.id ? 'Current' : 'Show'}
                      </button>
                    </div>
                  ))}
                  {activity.config?.current_question_id && (
                    <button type="button" disabled={busy} onClick={() => advance(null)} className="text-left text-xs font-extrabold text-slate-400">Clear current question</button>
                  )}
                </div>
                {results && <div className="text-xs font-bold text-slate-400">{results.participant_count} participants · {results.response_count} responses</div>}
              </>
            )}

            {role === 'moderator' && (
              <div className="grid gap-2">
                {qna === null ? <p className="text-sm text-slate-400">Loading…</p> : qna.length === 0 ? (
                  <p className="text-sm text-slate-400">No questions submitted yet.</p>
                ) : qna.map((q) => (
                  <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-sm font-bold text-slate-800 dark:text-white">{q.text}</div>
                    <div className="mt-1 text-xs font-bold text-slate-400">{q.upvote_count} upvotes · {q.status}</div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy} onClick={() => moderate(q.id, 'featured')} className="rounded-lg border-2 border-amber-300 px-3 py-1.5 text-xs font-extrabold text-amber-700 dark:text-amber-300">Feature</button>
                      <button type="button" disabled={busy} onClick={() => moderate(q.id, 'answered')} className="rounded-lg border-2 border-emerald-300 px-3 py-1.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">Answered</button>
                      <button type="button" disabled={busy} onClick={() => moderate(q.id, 'dismissed')} className="rounded-lg border-2 border-slate-300 px-3 py-1.5 text-xs font-extrabold text-slate-600 dark:text-slate-300">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
