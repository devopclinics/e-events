import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

function useQueryParams() {
  const [params] = useState(() => new URLSearchParams(window.location.search))
  return params
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Live-updates over SSE when the ticket mints cleanly; a plain interval keeps
// working even if the realtime hop is unavailable, so nothing here depends
// on Redis being up.
function useLiveRefresh(guestToken, activityId, onEvent) {
  const sourceRef = useRef(null)
  useEffect(() => {
    if (!guestToken || !activityId) return undefined
    let cancelled = false
    let poll
    api.liveGuestRealtimeTicket(guestToken, activityId).then(({ ticket }) => {
      if (cancelled) return
      const es = new EventSource(`/api/engagement/v1/activities/${activityId}/stream?ticket=${encodeURIComponent(ticket)}`)
      sourceRef.current = es
      es.addEventListener('response.submitted', onEvent)
      es.addEventListener('question.changed', onEvent)
      es.addEventListener('qna.submitted', onEvent)
      es.addEventListener('qna.upvoted', onEvent)
      es.addEventListener('qna.moderated', onEvent)
      es.addEventListener('activity.status_changed', onEvent)
    }).catch(() => { /* falls back to polling below */ })
    poll = setInterval(onEvent, 5000)
    return () => {
      cancelled = true
      sourceRef.current?.close()
      clearInterval(poll)
    }
  }, [guestToken, activityId]) // eslint-disable-line react-hooks/exhaustive-deps
}

function OptionQuestion({ question, onAnswer, busy, alreadyAnswered }) {
  const [selected, setSelected] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const startRef = useRef(Date.now())
  async function submit() {
    if (selected == null) return
    const t0 = startRef.current
    const result = await onAnswer(question.id, { selected_option_ids: [selected], response_time_ms: Date.now() - t0 })
    if (result) setFeedback(result)
  }
  if (alreadyAnswered || feedback) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        {feedback?.correct === true ? `Correct! +${feedback.score} pts` : feedback?.correct === false ? 'Answer recorded.' : 'Your answer is in.'}
      </div>
    )
  }
  return (
    <div className="grid gap-2">
      {question.options.map((opt) => (
        <button key={opt.id} type="button" onClick={() => setSelected(opt.id)}
          className={`min-h-12 rounded-xl border-2 px-4 py-2.5 text-left text-sm font-bold transition ${selected === opt.id ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white'}`}>
          {opt.label}
        </button>
      ))}
      <button type="button" disabled={selected == null || busy} onClick={submit}
        className="mt-2 min-h-12 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit answer'}
      </button>
    </div>
  )
}

function TextQuestion({ question, onAnswer, busy, alreadyAnswered }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(alreadyAnswered)
  async function submit() {
    if (!text.trim()) return
    await onAnswer(question.id, { answer_value: text.trim() })
    setDone(true)
  }
  if (done) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Thanks — your response is in.</div>
  return (
    <div className="grid gap-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        className="w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        placeholder="Type your answer…" />
      <button type="button" disabled={!text.trim() || busy} onClick={submit}
        className="min-h-12 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  )
}

function RatingQuestion({ question, onAnswer, busy, alreadyAnswered }) {
  const max = question.question_type === 'rating_10' ? 10 : 5
  const [value, setValue] = useState(null)
  const [done, setDone] = useState(alreadyAnswered)
  async function submit(v) {
    setValue(v)
    await onAnswer(question.id, { answer_value: v })
    setDone(true)
  }
  if (done) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Thanks for rating {value ?? ''}!</div>
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" disabled={busy} onClick={() => submit(n)}
          className="grid h-11 w-11 place-items-center rounded-xl border-2 border-slate-200 bg-white text-sm font-extrabold text-slate-800 hover:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
          {n}
        </button>
      ))}
    </div>
  )
}

function QuestionCard({ question, index, onAnswer, busy, alreadyAnswered }) {
  const isOptionType = ['single_choice', 'true_false', 'yes_no', 'multiple_choice'].includes(question.question_type)
  const isRating = question.question_type === 'rating_5' || question.question_type === 'rating_10'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Question {index + 1}</div>
      <div className="mt-1 text-base font-extrabold text-slate-900 dark:text-white">{question.prompt}</div>
      <div className="mt-3">
        {isOptionType && <OptionQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
        {isRating && <RatingQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
        {!isOptionType && !isRating && <TextQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
      </div>
    </div>
  )
}

function QnaPanel({ guestToken, activityId, activityStatus }) {
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setItems(await api.liveGuestQnaList(guestToken, activityId)) } catch { /* transient */ }
  }, [guestToken, activityId])
  useEffect(() => { load() }, [load])
  useLiveRefresh(guestToken, activityId, load)

  async function submit() {
    if (!text.trim()) return
    setBusy(true)
    try { await api.liveGuestQnaSubmit(guestToken, activityId, text.trim()); setText(''); await load() }
    finally { setBusy(false) }
  }
  async function upvote(id) {
    setItems((prev) => prev?.map((q) => q.id === id ? { ...q, upvoted_by_me: true, upvote_count: q.upvoted_by_me ? q.upvote_count : q.upvote_count + 1 } : q))
    try { await load() } catch { /* the optimistic update already stands */ }
    await api.liveGuestQnaUpvote(guestToken, id)
    await load()
  }

  return (
    <div className="grid gap-3">
      {activityStatus === 'live' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
            className="w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            placeholder="Ask a question…" />
          <button type="button" disabled={!text.trim() || busy} onClick={submit}
            className="mt-2 min-h-11 w-full rounded-xl bg-teal-400 px-4 py-2 text-sm font-extrabold text-slate-950 disabled:opacity-50">
            {busy ? 'Sending…' : 'Ask'}
          </button>
        </div>
      )}
      <div className="grid gap-2">
        {items === null ? <p className="text-sm text-slate-400">Loading…</p> : items.length === 0 ? (
          <p className="text-sm text-slate-400">No questions yet — be the first to ask.</p>
        ) : items.map((q) => (
          <div key={q.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={() => upvote(q.id)} disabled={q.upvoted_by_me}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 text-xs font-extrabold ${q.upvoted_by_me ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-white'}`}>
              ▲ {q.upvote_count}
            </button>
            <div className="flex-1 text-sm font-semibold text-slate-800 dark:text-white">
              {q.text}
              {q.status === 'answered' && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">Answered</span>}
              {q.status === 'featured' && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700 dark:bg-amber-900 dark:text-amber-200">Featured</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Leaderboard({ entries }) {
  if (!entries?.length) return null
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Leaderboard</div>
      <div className="mt-2 grid gap-1.5">
        {entries.map((e) => (
          <div key={e.participant_id} className="flex items-center justify-between text-sm font-bold text-slate-800 dark:text-white">
            <span>#{e.rank} {e.display_name}</span>
            <span className="text-teal-500">{e.score} pts</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivityView({ guestToken, activityId, onBack }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [leaderboard, setLeaderboard] = useState(null)
  const idemKeys = useRef({})

  const load = useCallback(async () => {
    try {
      const s = await api.liveGuestParticipate(guestToken, activityId)
      setState(s)
      if (s.activity.config?.leaderboard_enabled) {
        api.liveGuestLeaderboard(guestToken, activityId).then((r) => setLeaderboard(r.entries)).catch(() => {})
      }
    } catch { /* transient — next poll retries */ }
  }, [guestToken, activityId])
  useEffect(() => { load() }, [load])
  useLiveRefresh(guestToken, activityId, load)

  async function onAnswer(questionId, payload) {
    setBusy(true)
    try {
      if (!idemKeys.current[questionId]) idemKeys.current[questionId] = uid()
      const result = await api.liveGuestRespond(guestToken, activityId, { question_id: questionId, idempotency_key: idemKeys.current[questionId], ...payload })
      await load()
      return result
    } finally { setBusy(false) }
  }

  if (!state) return <p className="text-sm text-slate-400">Loading…</p>
  const { activity, already_responded_question_ids } = state
  const answered = new Set(already_responded_question_ids)

  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="text-left text-xs font-extrabold uppercase tracking-wide text-slate-400">← All activities</button>
      <div>
        <div className="text-xl font-extrabold text-slate-900 dark:text-white">{activity.title}</div>
        <div className="text-xs font-bold uppercase tracking-wide text-teal-500">{activity.status === 'live' ? 'Live now' : activity.status}</div>
      </div>

      {activity.type === 'q_and_a' ? (
        <QnaPanel guestToken={guestToken} activityId={activityId} activityStatus={activity.status} />
      ) : activity.status === 'closed' || activity.status === 'completed' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900">This activity has ended — thanks for joining!</div>
      ) : (
        <div className="grid gap-3">
          {activity.questions.length === 0 && <p className="text-sm text-slate-400">Nothing to answer yet.</p>}
          {activity.questions.map((q, i) => (
            <QuestionCard key={q.id} question={q} index={i} onAnswer={onAnswer} busy={busy} alreadyAnswered={answered.has(q.id)} />
          ))}
        </div>
      )}

      <Leaderboard entries={leaderboard} />
    </div>
  )
}

function AnonJoinForm({ eventId, onJoined }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function join() {
    setBusy(true); setError('')
    let anonId = ''
    try { anonId = localStorage.getItem(`festio_live_anon:${eventId}`) || '' } catch { /* private browsing */ }
    try {
      const session = await api.liveAnonSession(eventId, name.trim(), anonId)
      try { localStorage.setItem(`festio_live_anon:${eventId}`, session.anon_id) } catch { /* private browsing */ }
      onJoined(session.token)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-sm font-extrabold text-slate-900 dark:text-white">What should we call you?</div>
      <p className="mt-1 text-xs text-slate-400">Optional — helps your name show up on the leaderboard.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)"
        className="mt-3 w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        onKeyDown={(e) => { if (e.key === 'Enter') join() }} />
      {error && <div className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{error}</div>}
      <button type="button" disabled={busy} onClick={join}
        className="mt-3 min-h-12 w-full rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 disabled:opacity-50">
        {busy ? 'Joining…' : 'Join'}
      </button>
    </div>
  )
}

export default function LiveGuestPage() {
  const params = useQueryParams()
  const eventId = params.get('event') || ''
  const passToken = params.get('pass') || ''
  const broadcastMode = !passToken // no personal pass token → QR/broadcast join
  const [guestToken, setGuestToken] = useState(null)
  const [error, setError] = useState('')
  const [activities, setActivities] = useState(null)
  const [activityId, setActivityId] = useState(null)

  useEffect(() => {
    if (!eventId) { setError('This link is missing information — open Festio Live from your Guest Hub.'); return }
    if (broadcastMode) return // handled by AnonJoinForm below instead
    api.liveGuestSession(eventId, passToken)
      .then((s) => setGuestToken(s.token))
      .catch((e) => setError(e.message))
  }, [eventId, passToken, broadcastMode])

  const loadActivities = useCallback(async () => {
    if (!guestToken) return
    try { setActivities(await api.liveGuestActivities(guestToken)) }
    catch (e) { setError(e.message) }
  }, [guestToken])
  useEffect(() => { loadActivities() }, [loadActivities])
  useEffect(() => {
    if (!guestToken || activityId) return undefined
    const poll = setInterval(loadActivities, 6000)
    return () => clearInterval(poll)
  }, [guestToken, activityId, loadActivities])

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-teal-500">Festio Live</div>
        </div>
        {error && <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</div>}
        {!error && broadcastMode && !guestToken && eventId && <AnonJoinForm eventId={eventId} onJoined={setGuestToken} />}
        {!error && !broadcastMode && !guestToken && <p className="text-center text-sm text-slate-400">Connecting…</p>}
        {guestToken && !activityId && (
          <div className="grid gap-3">
            {activities === null ? <p className="text-center text-sm text-slate-400">Loading…</p> : activities.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900">Nothing is live right now — check back once your host starts something.</div>
            ) : activities.map((a) => (
              <button key={a.id} type="button" onClick={() => setActivityId(a.id)}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white">{a.title}</div>
                  <div className="text-xs font-bold uppercase tracking-wide text-teal-500">{a.status === 'live' ? 'Live now' : 'Paused'}</div>
                </div>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )}
        {guestToken && activityId && (
          <ActivityView guestToken={guestToken} activityId={activityId} onBack={() => setActivityId(null)} />
        )}
      </div>
    </div>
  )
}
