import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

function useQueryParams() {
  const [params] = useState(() => new URLSearchParams(window.location.search))
  return params
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function LiveUnavailableState({ onRetry, backHref = '/' }) {
  return (
    <div role="alert" className="rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm dark:border-amber-900 dark:bg-slate-900">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-amber-100 text-xl dark:bg-amber-950" aria-hidden="true">↻</div>
      <h1 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">Festio Live is temporarily unavailable</h1>
      <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">We're having trouble connecting to this live activity. Please try again shortly.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onRetry} className="min-h-12 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-extrabold text-slate-950">Retry</button>
        <a href={backHref} className="grid min-h-12 place-items-center rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm font-extrabold text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white">Back to Event</a>
      </div>
    </div>
  )
}

function QuestionTimer({ question }) {
  const calculate = () => {
    if (!question.time_limit_seconds || !question.config?.opened_at) return null
    const elapsed = (Date.now() - new Date(question.config.opened_at).getTime()) / 1000
    return Math.max(0, Math.ceil(question.time_limit_seconds - elapsed))
  }
  const [remaining, setRemaining] = useState(calculate)
  useEffect(() => {
    if (remaining == null) return undefined
    const interval = setInterval(() => setRemaining(calculate()), 500)
    return () => clearInterval(interval)
  }, [question.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (remaining == null) return null
  return <div role="timer" aria-live="polite" className={`mt-2 text-xs font-extrabold ${remaining <= 5 ? 'text-rose-600' : 'text-slate-600 dark:text-slate-300'}`}>{remaining}s remaining</div>
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
  const multiple = question.question_type === 'multiple_choice'
  const [selected, setSelected] = useState([])
  const [feedback, setFeedback] = useState(null)
  const startRef = useRef(Date.now())
  async function submit() {
    if (selected.length === 0) return
    const t0 = startRef.current
    const result = await onAnswer(question.id, { selected_option_ids: selected, response_time_ms: Date.now() - t0 })
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
        <button key={opt.id} type="button" aria-pressed={selected.includes(opt.id)} onClick={() => setSelected((current) => multiple ? (current.includes(opt.id) ? current.filter((id) => id !== opt.id) : [...current, opt.id]) : [opt.id])}
          className={`min-h-12 rounded-xl border-2 px-4 py-2.5 text-left text-sm font-bold transition ${selected.includes(opt.id) ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white'}`}>
          {opt.label}
        </button>
      ))}
      <button type="button" disabled={selected.length === 0 || busy} onClick={submit}
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
    const result = await onAnswer(question.id, { answer_value: text.trim() })
    if (result) setDone(true)
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
  const min = question.question_type === 'nps' ? 0 : 1
  const max = ['rating_10', 'nps'].includes(question.question_type) ? 10 : 5
  const [value, setValue] = useState(null)
  const [done, setDone] = useState(alreadyAnswered)
  async function submit(v) {
    setValue(v)
    const result = await onAnswer(question.id, { answer_value: v })
    if (result) setDone(true)
  }
  if (done) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Thanks for rating {value ?? ''}!</div>
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
        <button key={n} type="button" disabled={busy} onClick={() => submit(n)}
          className="grid h-11 w-11 place-items-center rounded-xl border-2 border-slate-200 bg-white text-sm font-extrabold text-slate-800 hover:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
          {n}
        </button>
      ))}
    </div>
  )
}

function NumberQuestion({ question, onAnswer, busy, alreadyAnswered }) {
  const [value, setValue] = useState('')
  const [done, setDone] = useState(alreadyAnswered)
  async function submit() {
    if (value === '' || !Number.isFinite(Number(value))) return
    const result = await onAnswer(question.id, { answer_value: Number(value) })
    if (result) setDone(true)
  }
  if (done) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Your number is in.</div>
  return <div className="grid gap-2"><input type="number" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} className="min-h-12 rounded-xl border-2 border-slate-200 bg-white px-4 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" aria-label="Numeric answer"/><button type="button" disabled={value === '' || busy} onClick={submit} className="min-h-12 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 disabled:opacity-50">{busy ? 'Submitting…' : 'Submit number'}</button></div>
}

function RankingQuestion({ question, onAnswer, busy, alreadyAnswered }) {
  const [ordered, setOrdered] = useState(question.options)
  const [done, setDone] = useState(alreadyAnswered)
  function move(index, direction) {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    setOrdered((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  }
  async function submit() {
    const result = await onAnswer(question.id, { selected_option_ids: ordered.map((option) => option.id) })
    if (result) setDone(true)
  }
  if (done) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Your ranking is in.</div>
  return <div className="grid gap-2">{ordered.map((option, index) => <div key={option.id} className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"><strong className="w-6 text-sm text-slate-600 dark:text-slate-300">{index + 1}</strong><span className="flex-1 text-sm font-bold text-slate-800 dark:text-white">{option.label}</span><button type="button" aria-label={`Move ${option.label} up`} disabled={index === 0 || busy} onClick={() => move(index, -1)} className="h-9 w-9 rounded-lg border border-slate-200 disabled:opacity-30">↑</button><button type="button" aria-label={`Move ${option.label} down`} disabled={index === ordered.length - 1 || busy} onClick={() => move(index, 1)} className="h-9 w-9 rounded-lg border border-slate-200 disabled:opacity-30">↓</button></div>)}<button type="button" disabled={!ordered.length || busy} onClick={submit} className="mt-2 min-h-12 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 disabled:opacity-50">{busy ? 'Submitting…' : 'Submit ranking'}</button></div>
}

function QuestionCard({ question, index, onAnswer, busy, alreadyAnswered }) {
  const isOptionType = ['single_choice', 'true_false', 'yes_no', 'multiple_choice'].includes(question.question_type)
  const isRating = ['rating_5', 'rating_10', 'nps'].includes(question.question_type)
  const isNumber = question.question_type === 'number'
  const isRanking = question.question_type === 'ranking'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600 dark:text-slate-300">Question {index + 1}</div>
      <div className="mt-1 text-base font-extrabold text-slate-900 dark:text-white">{question.prompt}</div>
      <QuestionTimer question={question}/>
      <div className="mt-3">
        {isOptionType && <OptionQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
        {isRating && <RatingQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
        {isNumber && <NumberQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
        {isRanking && <RankingQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
        {!isOptionType && !isRating && !isNumber && !isRanking && <TextQuestion question={question} onAnswer={onAnswer} busy={busy} alreadyAnswered={alreadyAnswered} />}
      </div>
    </div>
  )
}

function QnaPanel({ guestToken, activityId, activityStatus }) {
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setItems(await api.liveGuestQnaList(guestToken, activityId)) } catch { /* transient */ }
  }, [guestToken, activityId])
  useEffect(() => { load() }, [load])
  useLiveRefresh(guestToken, activityId, load)

  async function submit() {
    if (!text.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const submitted = await api.liveGuestQnaSubmit(guestToken, activityId, text.trim())
      setItems((current) => current ? [...current.filter((item) => item.id !== submitted.id), { ...submitted, is_mine: true }] : [{ ...submitted, is_mine: true }])
      setText('')
      setNotice('Question submitted — it will appear to everyone after the moderator features it.')
      await load()
    } catch (e) { setError(e.message || 'Your question could not be sent. Please try again.') }
    finally { setBusy(false) }
  }
  async function upvote(id) {
    setItems((prev) => prev?.map((q) => q.id === id ? { ...q, upvoted_by_me: true, upvote_count: q.upvoted_by_me ? q.upvote_count : q.upvote_count + 1 } : q))
    try { await api.liveGuestQnaUpvote(guestToken, id); await load() }
    catch (e) { setError(e.message || 'Your vote could not be saved.'); await load() }
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
          {notice && <div role="status" className="mt-3 rounded-xl bg-teal-50 p-3 text-xs font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200">{notice}</div>}
          {error && <div role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</div>}
        </div>
      )}
      <div className="grid gap-2">
        {items === null ? <p className="text-sm text-slate-600 dark:text-slate-300">Loading…</p> : items.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No questions yet — be the first to ask.</p>
        ) : items.map((q) => (
          <div key={q.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={() => upvote(q.id)} disabled={q.upvoted_by_me || q.status === 'pending'} aria-label={q.status === 'pending' ? 'Awaiting moderation' : `Upvote question; ${q.upvote_count} votes`}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 text-xs font-extrabold ${q.upvoted_by_me ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-white'}`}>
              ▲ {q.upvote_count}
            </button>
            <div className="flex-1 text-sm font-semibold text-slate-800 dark:text-white">
              {q.text}
              {q.status === 'pending' && q.is_mine && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-violet-700 dark:bg-violet-900 dark:text-violet-200">Awaiting moderation</span>}
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
      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600 dark:text-slate-300">Leaderboard</div>
      <div className="mt-2 grid gap-1.5">
        {entries.map((e) => (
          <div key={e.participant_id} className="flex items-center justify-between text-sm font-bold text-slate-800 dark:text-white">
            <span>#{e.rank} {e.display_name}</span>
            <span className="text-teal-700 dark:text-teal-300">{e.score} pts</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GuestResultCard({ question, result }) {
  if (!question || !result) return null
  const counts = result.option_counts || {}
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  return (
    <div className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm dark:border-teal-800 dark:bg-slate-900">
      <div className="text-xs font-extrabold uppercase tracking-wide text-teal-700 dark:text-teal-300">Results revealed</div>
      <div className="mt-1 text-base font-extrabold text-slate-900 dark:text-white">{question.prompt}</div>
      {question.options?.length > 0 && (
        <div className="mt-4 grid gap-3">
          {question.options.map((option) => {
            const count = counts[option.id] || 0
            const percent = total ? Math.round((count / total) * 100) : 0
            return <div key={option.id}>
              <div className="mb-1 flex justify-between gap-3 text-xs font-bold text-slate-700 dark:text-slate-200"><span>{option.label}</span><span>{percent}%</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-teal-400" style={{ width: `${Math.max(percent, count ? 3 : 0)}%` }} /></div>
            </div>
          })}
        </div>
      )}
      {result.average_rating != null && <div className="mt-4 rounded-xl bg-teal-50 p-4 text-center dark:bg-teal-950"><strong className="text-3xl text-teal-600 dark:text-teal-300">{result.average_rating.toFixed(1)}</strong><span className="ml-1 text-sm font-bold text-slate-500">average</span></div>}
      {!question.options?.length && result.average_rating == null && <div className="mt-4 rounded-xl bg-teal-50 p-4 text-sm font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200">Your response is part of {result.response_count} voices shaping this result.</div>}
      <div className="mt-4 text-xs font-bold text-slate-600 dark:text-slate-300">{result.response_count} verified responses · Updated live</div>
    </div>
  )
}

function ActivityView({ guestToken, activityId, onBack }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [leaderboard, setLeaderboard] = useState(null)
  const [revealedResult, setRevealedResult] = useState(null)
  const [error, setError] = useState('')
  const idemKeys = useRef({})

  const load = useCallback(async () => {
    try {
      const s = await api.liveGuestParticipate(guestToken, activityId)
      setState(s)
      const revealed = s.activity.questions.find((question) => question.id === s.activity.config?.current_question_id && ['results_visible', 'answer_revealed'].includes(question.live_state))
      if (revealed) {
        api.liveGuestResults(guestToken, activityId).then((payload) => setRevealedResult(payload.questions.find((question) => question.question_id === revealed.id) || null)).catch(() => setRevealedResult(null))
      } else setRevealedResult(null)
      if (s.activity.config?.leaderboard_enabled) {
        api.liveGuestLeaderboard(guestToken, activityId).then((r) => setLeaderboard(r.entries)).catch(() => {})
      }
    } catch (e) { setError(e) }
  }, [guestToken, activityId])
  useEffect(() => { load() }, [load])
  useLiveRefresh(guestToken, activityId, load)

  async function onAnswer(questionId, payload) {
    setBusy(true); setError('')
    try {
      if (!idemKeys.current[questionId]) idemKeys.current[questionId] = uid()
      const result = await api.liveGuestRespond(guestToken, activityId, { question_id: questionId, idempotency_key: idemKeys.current[questionId], ...payload })
      await load()
      return result
    } catch (e) { setError(e); return null } finally { setBusy(false) }
  }

  if (error?.code === 'FESTIO_LIVE_UNAVAILABLE') return <LiveUnavailableState onRetry={() => { setError(''); load() }} />
  if (!state) return <p className="text-sm text-slate-600 dark:text-slate-300">Loading…</p>
  const { activity, already_responded_question_ids } = state
  const answered = new Set(already_responded_question_ids)
  const currentQuestion = activity.questions.find((question) => question.id === activity.config?.current_question_id)

  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="text-left text-xs font-extrabold uppercase tracking-wide text-slate-600 dark:text-slate-300">← All activities</button>
      <div>
        <div className="text-xl font-extrabold text-slate-900 dark:text-white">{activity.title}</div>
        <div className="text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">{activity.status === 'live' ? 'Live now' : activity.status}</div>
      </div>
      {error && error.code !== 'FESTIO_LIVE_UNAVAILABLE' && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error.message || error}</div>}

      {activity.type === 'q_and_a' ? (
        <QnaPanel guestToken={guestToken} activityId={activityId} activityStatus={activity.status} />
      ) : activity.status === 'closed' || activity.status === 'completed' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900">This activity has ended — thanks for joining!</div>
      ) : (
        <div className="grid gap-3">
          {activity.status === 'paused' && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">The presenter has paused this activity.</div>}
          {currentQuestion && ['results_visible', 'answer_revealed'].includes(currentQuestion.live_state) && <GuestResultCard question={currentQuestion} result={revealedResult} />}
          {activity.status === 'live' && currentQuestion && ['results_visible', 'answer_revealed'].includes(currentQuestion.live_state) && <div role="status" className="rounded-xl bg-slate-100 p-3 text-sm font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">Results are on screen. Waiting for the host to reopen this question or start the next one.</div>}
          {!activity.questions.some((q) => q.id === activity.config?.current_question_id && ['open', 'results_visible', 'answer_revealed'].includes(q.live_state)) && activity.status === 'live' && <p className="text-sm text-slate-600 dark:text-slate-300">Waiting for the presenter to open the next question…</p>}
          {activity.questions.filter((q) => activity.status === 'live' && q.id === activity.config?.current_question_id && q.live_state === 'open').map((q) => (
            <QuestionCard key={q.id} question={q} index={activity.questions.findIndex((item) => item.id === q.id)} onAnswer={onAnswer} busy={busy} alreadyAnswered={answered.has(q.id)} />
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
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Optional — helps your name show up on the leaderboard.</p>
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

function JoinCodeForm() {
  const [code, setCode] = useState('')
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)

  function openEvent(event) {
    event.preventDefault()
    if (normalized.length === 6) window.location.assign(`/live/join/${normalized}`)
  }

  return (
    <form onSubmit={openEvent} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-teal-950/10 dark:border-slate-700 dark:bg-slate-900">
      <div className="bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 px-6 py-8 text-center text-white">
        <div className="text-4xl" aria-hidden="true">✦</div>
        <h1 className="mt-2 text-2xl font-black">Join the live moment</h1>
        <p className="mt-2 text-sm font-semibold text-white/90">Enter the six-character code shown on screen.</p>
      </div>
      <div className="p-5">
        <label htmlFor="festio-live-code" className="block text-xs font-extrabold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Join code</label>
        <input id="festio-live-code" autoFocus autoComplete="one-time-code" inputMode="text" maxLength={6}
          value={normalized} onChange={(event) => setCode(event.target.value)} placeholder="A7K9Q2"
          className="mt-2 min-h-16 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 text-center text-2xl font-black uppercase tracking-[0.35em] text-slate-950 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
        <button type="submit" disabled={normalized.length !== 6}
          className="mt-4 min-h-12 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-400 dark:text-slate-950">
          Join Festio Live
        </button>
      </div>
    </form>
  )
}

export default function LiveGuestPage() {
  const params = useQueryParams()
  const { joinCode = '' } = useParams()
  const queryEventId = params.get('event') || ''
  const passToken = params.get('pass') || ''
  const sessionId = params.get('session') || ''
  const broadcastMode = !passToken // no personal pass token → QR/broadcast join
  const [resolvedEventId, setResolvedEventId] = useState('')
  const eventId = queryEventId || resolvedEventId
  const [guestToken, setGuestToken] = useState(null)
  const [error, setError] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)
  const [activities, setActivities] = useState(null)
  const [activityId, setActivityId] = useState(null)
  const codeEntryMode = !queryEventId && !joinCode && window.location.pathname.replace(/\/+$/, '') === '/live/join'

  useEffect(() => {
    if (queryEventId || !joinCode) return
    setError('')
    setResolvedEventId('')
    api.liveResolveJoinCode(joinCode.toUpperCase())
      .then((result) => setResolvedEventId(result.event_id))
      .catch((e) => setError(e))
  }, [queryEventId, joinCode])

  useEffect(() => {
    if (!eventId) {
      if (joinCode || codeEntryMode) return
      setError('This link is missing information — open Festio Live from your Guest Hub.')
      return
    }
    if (broadcastMode) return // handled by AnonJoinForm below instead
    api.liveGuestSession(eventId, passToken)
      .then((s) => setGuestToken(s.token))
      .catch((e) => setError(e))
  }, [eventId, passToken, broadcastMode, retryNonce])

  const loadActivities = useCallback(async () => {
    if (!guestToken) return
    try {
      const available = await api.liveGuestActivities(guestToken)
      const scoped = sessionId ? available.filter((activity) => activity.session_id === sessionId) : available
      setActivities(scoped)
      if (sessionId && scoped.length === 1) setActivityId(scoped[0].id)
    }
    catch (e) { setError(e) }
  }, [guestToken, sessionId])
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
          <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">Festio Live</div>
        </div>
        {error?.code === 'FESTIO_LIVE_UNAVAILABLE' && <LiveUnavailableState onRetry={() => { setError(''); setActivities(null); if (guestToken) loadActivities(); else setRetryNonce((value) => value + 1) }} backHref={passToken ? `/scan/${encodeURIComponent(passToken)}/hub` : '/'} />}
        {error && error.code !== 'FESTIO_LIVE_UNAVAILABLE' && <div role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error.message || error}{joinCode && <a className="mt-2 block underline" href="/live/join">Try another code</a>}</div>}
        {!error && codeEntryMode && <JoinCodeForm />}
        {!error && joinCode && !eventId && <p className="text-center text-sm font-bold text-slate-600 dark:text-slate-300">Finding your event…</p>}
        {!error && broadcastMode && !guestToken && eventId && <AnonJoinForm eventId={eventId} onJoined={setGuestToken} />}
        {!error && !broadcastMode && !guestToken && <p className="text-center text-sm text-slate-600 dark:text-slate-300">Connecting…</p>}
        {guestToken && !activityId && (
          <div className="grid gap-3">
            {activities === null ? <p className="text-center text-sm text-slate-600 dark:text-slate-300">Loading…</p> : activities.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900">Nothing is live right now — check back once your host starts something.</div>
            ) : activities.map((a) => (
              <button key={a.id} type="button" onClick={() => setActivityId(a.id)}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white">{a.title}</div>
                  <div className="text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">{a.status === 'live' ? 'Live now' : 'Paused'}{a.session_title ? ` · ${a.session_title}` : ''}</div>
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
