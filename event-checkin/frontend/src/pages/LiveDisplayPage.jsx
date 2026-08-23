import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

// Public, unauthenticated except by the activity's own display_token — meant
// to be opened once on a TV/projector and left running for the event.
export default function LiveDisplayPage() {
  const { activityId } = useParams()
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const esRef = useRef(null)

  async function load() {
    try {
      const res = await fetch(`/api/engagement/v1/activities/${activityId}/display?token=${encodeURIComponent(token)}`)
      if (!res.ok) throw new Error('This display link is no longer valid.')
      setState(await res.json())
    } catch (e) { setError(e.message) }
  }

  useEffect(() => {
    if (!activityId || !token) { setError('Missing display link parameters.'); return undefined }
    load()
    const es = new EventSource(`/api/engagement/v1/activities/${activityId}/display-stream?token=${encodeURIComponent(token)}`)
    esRef.current = es
    es.onmessage = load
    es.addEventListener('response.submitted', load)
    es.addEventListener('question.changed', load)
    es.addEventListener('qna.submitted', load)
    es.addEventListener('qna.upvoted', load)
    es.addEventListener('activity.status_changed', load)
    const poll = setInterval(load, 8000)
    return () => { es.close(); clearInterval(poll) }
  }, [activityId, token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="grid min-h-screen place-items-center bg-slate-950 px-8 text-center text-2xl font-extrabold text-white">{error}</div>
  if (!state) return <div className="grid min-h-screen place-items-center bg-slate-950 text-lg font-bold text-slate-500">Connecting…</div>

  const currentQuestion = state.questions.find((q) => q.question_id === state.current_question_id)
  const maxCount = currentQuestion ? Math.max(1, ...Object.values(currentQuestion.option_counts)) : 1

  return (
    <div className="min-h-screen bg-slate-950 px-10 py-10 text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <div className="text-sm font-extrabold uppercase tracking-[0.3em] text-teal-400">Festio Live</div>
        <div className="text-sm font-bold text-slate-400">{state.participant_count} joined</div>
      </div>

      <div className="mx-auto mt-10 max-w-5xl">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight">{state.title}</h1>

        {currentQuestion ? (
          <div className="mt-10">
            <div className="text-2xl font-extrabold text-slate-100">{currentQuestion.prompt}</div>
            {Object.keys(currentQuestion.option_counts).length > 0 && (
              <div className="mt-8 grid gap-4">
                {Object.entries(currentQuestion.option_counts).map(([optId, count]) => (
                  <div key={optId} className="grid gap-1">
                    <div className="h-12 overflow-hidden rounded-xl bg-slate-800">
                      <div className="flex h-full items-center rounded-xl bg-teal-400 px-4 text-lg font-extrabold text-slate-950 transition-all duration-500" style={{ width: `${Math.max(6, (count / maxCount) * 100)}%` }}>
                        {count}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {currentQuestion.text_samples.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-3">
                {currentQuestion.text_samples.slice(0, 12).map((t, i) => (
                  <div key={i} className="rounded-xl bg-slate-800 px-4 py-2 text-base font-semibold text-slate-100">{t}</div>
                ))}
              </div>
            )}
            <div className="mt-6 text-sm font-bold text-slate-500">{currentQuestion.response_count} responses</div>
          </div>
        ) : (
          <div className="mt-10 text-lg font-bold text-slate-500">Waiting for the presenter to open a question…</div>
        )}

        {state.leaderboard.length > 0 && (
          <div className="mt-14">
            <div className="text-sm font-extrabold uppercase tracking-[0.2em] text-teal-400">Leaderboard</div>
            <div className="mt-4 grid gap-2">
              {state.leaderboard.slice(0, 8).map((e) => (
                <div key={e.participant_id} className="flex items-center justify-between rounded-xl bg-slate-900 px-5 py-3 text-lg font-extrabold">
                  <span>#{e.rank} {e.display_name}</span>
                  <span className="text-teal-400">{e.score} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
