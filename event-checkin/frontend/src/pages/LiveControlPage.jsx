import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

const BROADCAST_SCENES = [
  ['welcome', 'Welcome'], ['join', 'Join / QR'], ['agenda', 'Agenda'], ['question', 'Question'],
  ['responding', 'Voting'], ['results', 'Current result'], ['all_results', 'All results'], ['correct_answer', 'Answer'], ['leaderboard', 'Leaderboard'],
  ['team_battle', 'Teams'], ['rating', 'Rating'], ['feedback', 'Feedback'], ['word_cloud', 'Word cloud'],
  ['q_and_a', 'Q&A'], ['room_pulse', 'Room pulse'], ['ai_insight', 'AI insight'], ['idea_galaxy', 'Idea galaxy'],
  ['announcement', 'Announcement'], ['break', 'Break'], ['countdown', 'Countdown'], ['celebration', 'Celebrate'],
  ['custom_message', 'Custom'],
]
const BROADCAST_THEMES = [
  ['aurora', '#65f5c6'], ['citrus', '#ffd84d'], ['ocean', '#37d8ff'], ['festio', '#ffad72'], ['mono', '#fff'],
]

const SHOW_PHASE_LABELS = {
  lobby: 'Lobby · audience joining', intro: 'Activity introduction', question_preview: 'Question preview',
  answering: 'Voting open', locked: 'Answers locked', reveal: 'Answer reveal', results: 'Results',
  leaderboard: 'Leaderboard', complete: 'Show complete',
}
const SHOW_AUTOMATION_DEFAULTS = { lobby: 10, intro: 8, question_preview: 5, answering: 30, locked: 3, reveal: 6, results: 10, leaderboard: 8 }

function guidedActionLabel(activity) {
  if (activity?.config?.show_mode !== 'guided') return 'Start guided show'
  const phase = activity.config?.show_phase || 'lobby'
  const currentId = activity.config?.current_question_id
  const questions = (activity.questions || []).filter((question) => question.status === 'active')
  const currentIndex = questions.findIndex((question) => question.id === currentId)
  const hasNext = currentIndex < questions.length - 1
  const current = questions[currentIndex]
  if (phase === 'lobby') return 'Show activity intro →'
  if (phase === 'intro') return ['survey', 'feedback', 'q_and_a'].includes(activity.type) ? 'Open participation →' : 'Preview first question →'
  if (phase === 'question_preview') return 'Open voting →'
  if (phase === 'answering') return 'Lock responses →'
  if (phase === 'locked') return current?.options?.some((option) => option.is_correct) ? 'Reveal answer →' : 'Reveal results →'
  if (phase === 'reveal') return 'Show full results →'
  if (phase === 'results' && activity.type === 'quiz' && activity.config?.leaderboard_enabled) return 'Show leaderboard →'
  if (phase === 'results' || phase === 'leaderboard') return hasNext ? 'Preview next question →' : 'Finish show →'
  return 'Restart guided show'
}

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
  const [displays, setDisplays] = useState(null)
  const [displayId, setDisplayId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resultQuestionIds, setResultQuestionIds] = useState([])
  const [resultPageSeconds, setResultPageSeconds] = useState(8)
  const [clock, setClock] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 500); return () => clearInterval(timer) }, [])

  useEffect(() => {
    if (!token) { setError('This link is missing its access token.'); return }
    api.liveControlActivities(token).then(setActivities).catch((e) => setError(e.message))
    if (role === 'presenter') api.liveControlDisplays(token).then((items) => { setDisplays(items); setDisplayId((current) => current || items[0]?.id || null) }).catch((e) => setError(e.message))
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
  async function startGuidedShow() {
    setBusy(true); setError('')
    try {
      const updated = await api.liveControlStartGuidedShow(token, activityId)
      setActivity(updated)
      if (displayId) {
        const display = await api.liveControlUpdateDisplay(token, displayId, {
          assigned_activity_id: activityId,
          settings: { control_mode: 'guided', follow_activity: true },
        })
        setDisplays((current) => (current || []).map((item) => item.id === display.id ? display : item))
      }
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function advanceGuidedShow() {
    setBusy(true); setError('')
    try { setActivity(await api.liveControlAdvanceGuidedShow(token, activityId)); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function toggleGuidedAutomation() {
    setBusy(true); setError('')
    try {
      const updated = await api.liveControlConfigureGuidedShowAutomation(token, activityId, {
        enabled: !activity.config?.show_automation_enabled,
        timings: { ...SHOW_AUTOMATION_DEFAULTS, ...(activity.config?.show_automation_timings || {}) },
      })
      setActivity(updated)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function setQuestionState(questionId, state) {
    setBusy(true); setError('')
    try { await api.liveControlQuestionState(token, questionId, state); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function moderate(qnaId, status) {
    setBusy(true)
    try { await api.liveControlQnaModerate(token, qnaId, status); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function updateDisplay(patch) {
    if (!displayId) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveControlUpdateDisplay(token, displayId, patch)
      setDisplays((current) => (current || []).map((display) => display.id === updated.id ? updated : display))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function presentResults(mode, extra = {}) {
    if (!displayId || !activityId || !resultQuestionIds.length) return
    setBusy(true); setError('')
    try {
      const currentDisplay = displays?.find((display) => display.id === displayId)
      const settings = currentDisplay?.settings || {}
      const configuredCurrent = resultQuestionIds.includes(settings.results_question_id) ? settings.results_question_id : null
      const activityCurrent = resultQuestionIds.includes(activity.config?.current_question_id) ? activity.config.current_question_id : null
      const updated = await api.liveControlPresentResults(token, displayId, {
        activity_id: activityId, mode,
        question_id: mode === 'current' ? (extra.question_id || configuredCurrent || activityCurrent || resultQuestionIds[0]) : null,
        question_ids: resultQuestionIds,
        freeze: extra.freeze ?? !!settings.results_frozen,
        page: extra.page ?? Number(settings.results_page || 0),
        auto_rotate: extra.auto_rotate ?? settings.results_auto_rotate !== false,
        page_seconds: Number(resultPageSeconds) || 8,
      })
      setDisplays((current) => (current || []).map((display) => display.id === updated.id ? updated : display))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function setRehearsal(enabled) {
    if (!displayId) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveControlSetRehearsal(token, displayId, { activity_id: activityId, enabled, participants: 10 })
      setDisplays((current) => (current || []).map((display) => display.id === updated.id ? updated : display))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const selectedDisplay = displays?.find((display) => display.id === displayId)
  useEffect(() => {
    if (!activity?.questions?.length) { setResultQuestionIds([]); return }
    const activeIds = activity.questions.filter((question) => question.status === 'active').map((question) => question.id)
    const configured = (selectedDisplay?.settings?.results_question_ids || []).filter((questionId) => activeIds.includes(questionId))
    setResultQuestionIds(configured.length ? configured : activeIds)
    setResultPageSeconds(selectedDisplay?.settings?.results_page_seconds || 8)
  }, [activity?.id, activity?.questions?.length, selectedDisplay?.id, selectedDisplay?.settings?.results_question_ids, selectedDisplay?.settings?.results_page_seconds])
  const currentQuestionIndex = activity?.questions?.findIndex((question) => question.id === activity.config?.current_question_id) ?? -1
  const currentQuestion = currentQuestionIndex >= 0 ? activity.questions[currentQuestionIndex] : null
  const currentResult = results?.questions?.find((question) => question.question_id === currentQuestion?.id)
  const secondsRemaining = currentQuestion?.time_limit_seconds && currentQuestion.config?.opened_at
    ? Math.max(0, Math.ceil(currentQuestion.time_limit_seconds - (clock - new Date(currentQuestion.config.opened_at).getTime()) / 1000))
    : null
  const automationRemaining = activity?.config?.show_automation_enabled && activity.config?.show_phase_deadline_at
    ? Math.max(0, Math.ceil((new Date(activity.config.show_phase_deadline_at).getTime() - clock) / 1000))
    : null
  const resultPageCount = Math.max(1, Math.ceil(resultQuestionIds.length / 6))
  const resultPage = Math.min(resultPageCount - 1, Number(selectedDisplay?.settings?.results_page || 0))

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
                <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 text-white shadow-xl">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[.2em] text-teal-300">Guided Show Mode</div><h2 className="mt-1 text-xl font-black">{SHOW_PHASE_LABELS[activity.config?.show_phase] || 'Ready to begin'}</h2><p className="mt-1 text-xs font-semibold text-slate-300">One action keeps the projector, guest phones, voting, timer and results in sync.</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${activity.config?.show_mode === 'guided' ? 'bg-teal-300 text-slate-950' : 'bg-white/10 text-slate-300'}`}>{activity.config?.show_mode === 'guided' ? 'Active' : 'Off'}</span></div>
                    {currentQuestion && <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Question {currentQuestionIndex + 1} of {activity.questions.length}</div><div className="mt-1 text-sm font-extrabold">{currentQuestion.prompt}</div></div>}
                    <button type="button" disabled={busy} onClick={activity.config?.show_mode === 'guided' && activity.config?.show_phase !== 'complete' ? advanceGuidedShow : startGuidedShow} className="mt-4 min-h-14 w-full rounded-xl bg-gradient-to-r from-teal-300 via-cyan-300 to-violet-400 px-4 text-sm font-black text-slate-950 shadow-lg disabled:opacity-40">{busy ? 'Updating every screen…' : guidedActionLabel(activity)}</button>
                    <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-400"><span>{selectedDisplay ? `Main screen: ${selectedDisplay.name}` : 'Select a main screen below'}</span><span>{automationRemaining != null ? `Auto advance in ${automationRemaining}s` : secondsRemaining != null && activity.config?.show_phase === 'answering' ? `${secondsRemaining}s remaining` : 'Server synchronized'}</span></div>
                    <button type="button" disabled={busy} onClick={toggleGuidedAutomation} className="mt-3 w-full rounded-xl border border-white/20 px-3 py-2 text-xs font-extrabold text-white">{activity.config?.show_automation_enabled ? 'Pause automation' : 'Resume automation'}</button>
                  </div>
                </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><div className="text-xs font-extrabold uppercase tracking-[.16em] text-fuchsia-500">Festio Broadcast</div><div className="mt-1 text-sm font-bold text-slate-500">Control every projector without leaving this screen</div></div>
                    {selectedDisplay && <button type="button" onClick={() => window.open(`/live/${selectedDisplay.display_code}?token=${encodeURIComponent(selectedDisplay.access_token)}`, '_blank', 'noopener,noreferrer')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-extrabold text-slate-700 dark:text-white">Open display ↗</button>}
                  </div>
                  {displays?.length ? <div className="mt-4 grid gap-4">
                    <div className="flex gap-2"><select value={displayId || ''} onChange={(e) => setDisplayId(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-white">{displays.map((display) => <option key={display.id} value={display.id}>{display.name}</option>)}</select><button type="button" disabled={busy || selectedDisplay?.assigned_activity_id === activityId} onClick={() => updateDisplay({ assigned_activity_id: activityId })} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-extrabold text-slate-700 disabled:opacity-40 dark:text-white">Use this activity</button></div>
                    <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => updateDisplay({ assigned_activity_id: activityId, settings: { control_mode: 'guided', follow_activity: true } })} className={`rounded-xl border-2 px-3 py-2 text-xs font-extrabold ${selectedDisplay?.settings?.control_mode === 'guided' ? 'border-teal-400 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'}`}>Guided by activity</button><button type="button" disabled={busy} onClick={() => updateDisplay({ settings: { control_mode: 'manual', follow_activity: false } })} className={`rounded-xl border-2 px-3 py-2 text-xs font-extrabold ${selectedDisplay?.settings?.control_mode === 'manual' ? 'border-fuchsia-400 bg-fuchsia-50 text-fuchsia-800' : 'border-slate-200 text-slate-600'}`}>Manual broadcast</button></div>
                    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-teal-50 via-white to-violet-50 p-3 dark:border-violet-800 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950">
                      <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[.16em] text-teal-700 dark:text-teal-300">Results-only control</div><div className="mt-1 text-sm font-black text-slate-900 dark:text-white">Show the outcome immediately</div></div><span className="rounded-full bg-slate-900 px-2 py-1 text-[9px] font-black uppercase text-teal-300">{selectedDisplay?.settings?.rehearsal_mode ? 'Rehearsal' : selectedDisplay?.settings?.results_frozen ? 'Frozen' : 'Ready'}</span></div>
                      <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={busy || !resultQuestionIds.length} onClick={() => presentResults('current')} className="rounded-xl border-2 border-teal-300 px-3 py-2 text-xs font-extrabold text-teal-800 dark:text-teal-200">Current result</button><button type="button" disabled={busy || !resultQuestionIds.length} onClick={() => presentResults('all')} className="rounded-xl bg-gradient-to-r from-teal-300 to-violet-400 px-3 py-2 text-xs font-black text-slate-950">All results</button></div>
                      <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={busy || !['results', 'all_results'].includes(selectedDisplay?.scene)} onClick={() => presentResults(selectedDisplay?.settings?.results_mode || 'all', { freeze: !selectedDisplay?.settings?.results_frozen })} className="rounded-xl border border-slate-300 px-3 py-2 text-[11px] font-extrabold dark:text-white">{selectedDisplay?.settings?.results_frozen ? 'Return to live' : 'Freeze now'}</button><button type="button" disabled={busy} onClick={() => updateDisplay({ assigned_activity_id: activityId, scene: 'join', settings: { control_mode: 'manual', follow_activity: false, rehearsal_mode: false, results_frozen: false, results_snapshot: null } })} className="rounded-xl border border-slate-300 px-3 py-2 text-[11px] font-extrabold dark:text-white">Join screen</button></div>
                      <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2"><button type="button" disabled={busy || resultPage <= 0} onClick={() => presentResults('all', { auto_rotate: false, page: resultPage - 1 })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[10px] font-black">←</button><div className="text-center text-[10px] font-extrabold text-slate-500">Page {resultPage + 1}/{resultPageCount}</div><button type="button" disabled={busy || resultPage >= resultPageCount - 1} onClick={() => presentResults('all', { auto_rotate: false, page: resultPage + 1 })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-[10px] font-black">→</button></div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-extrabold text-slate-600 dark:text-slate-300"><label className="flex items-center gap-1"><input type="checkbox" checked={selectedDisplay?.settings?.results_auto_rotate !== false} onChange={(event) => presentResults('all', { auto_rotate: event.target.checked, page: resultPage })}/> Auto-rotate</label><label className="flex items-center gap-1">Every <input className="w-12 rounded border px-1 py-0.5 dark:bg-slate-950" type="number" min="3" max="60" value={resultPageSeconds} onChange={(event) => setResultPageSeconds(event.target.value)}/> sec</label></div>
                      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => updateDisplay({ assigned_activity_id: activityId, settings: { control_mode: 'guided', follow_activity: true, rehearsal_mode: false, results_frozen: false, results_snapshot: null } })} className="rounded-lg border border-violet-300 px-2.5 py-1.5 text-[10px] font-black text-violet-700 dark:text-violet-200">Resume guided display</button><button type="button" disabled={busy} onClick={() => setRehearsal(!selectedDisplay?.settings?.rehearsal_mode)} className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-[10px] font-black text-amber-700 dark:text-amber-200">{selectedDisplay?.settings?.rehearsal_mode ? 'End rehearsal' : 'Rehearse 10 guests'}</button></div>
                      <details className="mt-3"><summary className="cursor-pointer text-[10px] font-black text-slate-500">Choose result cards ({resultQuestionIds.length})</summary><div className="mt-2 grid gap-1">{activity.questions.filter((question) => question.status === 'active').map((question) => <label key={question.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-[10px] font-bold dark:border-slate-700 dark:bg-slate-950"><input type="checkbox" checked={resultQuestionIds.includes(question.id)} onChange={(event) => setResultQuestionIds((current) => event.target.checked ? [...current, question.id] : current.filter((questionId) => questionId !== question.id))}/><span className="flex-1">{question.prompt}</span><button type="button" onClick={(event) => { event.preventDefault(); presentResults('current', { question_id: question.id }) }} className="font-black text-teal-700">Show</button></label>)}</div></details>
                      <p className="mt-2 text-[9px] font-bold text-slate-400">Rehearsal is display-only and never changes participant analytics.</p>
                    </div>
                    <div><div className="mb-2 text-xs font-extrabold text-slate-500">Manual scenes</div><div className="grid grid-cols-3 gap-1.5">{BROADCAST_SCENES.map(([key, label]) => <button type="button" disabled={busy} key={key} onClick={() => updateDisplay({ scene: key, settings: { control_mode: 'manual', follow_activity: false } })} className={`min-h-10 rounded-lg border px-2 py-1 text-[11px] font-extrabold ${selectedDisplay?.scene === key && selectedDisplay?.settings?.control_mode !== 'guided' ? 'border-fuchsia-500 bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{label}</button>)}</div></div>
                    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2">{BROADCAST_THEMES.map(([theme, color]) => <button type="button" key={theme} title={theme} aria-label={`${theme} theme`} onClick={() => updateDisplay({ settings: { theme } })} style={{ background: color }} className={`h-8 w-8 rounded-full border-4 ${selectedDisplay?.settings?.theme === theme || (!selectedDisplay?.settings?.theme && theme === 'aurora') ? 'border-slate-950 dark:border-white' : 'border-white dark:border-slate-900'} shadow ring-1 ring-slate-300`}/>)}</div><div className="flex gap-3 text-xs font-bold text-slate-600 dark:text-slate-300"><label className="flex items-center gap-1"><input type="checkbox" checked={selectedDisplay?.settings?.motion !== false} onChange={(e) => updateDisplay({ settings: { motion: e.target.checked } })}/> Motion</label><label className="flex items-center gap-1"><input type="checkbox" checked={!!selectedDisplay?.settings?.safe_area} onChange={(e) => updateDisplay({ settings: { safe_area: e.target.checked } })}/> Safe area</label><label className="flex items-center gap-1"><input type="checkbox" checked={!!selectedDisplay?.settings?.follow_activity} onChange={(e) => updateDisplay({ settings: { follow_activity: e.target.checked } })}/> Auto-follow</label></div></div>
                  </div> : <p className="mt-4 text-sm text-slate-400">An event admin must create a display before it can be controlled here.</p>}
                </section>
                <div className="flex flex-wrap gap-2">
                  {activity.status === 'draft' && <button type="button" disabled={busy} onClick={() => setStatus('live')} className="rounded-xl bg-teal-400 px-4 py-2 text-sm font-extrabold text-slate-950">Go Live</button>}
                  {activity.status === 'live' && <button type="button" disabled={busy} onClick={() => setStatus('paused')} className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-extrabold text-slate-800 dark:text-white">Pause</button>}
                  {activity.status === 'paused' && <button type="button" disabled={busy} onClick={() => setStatus('live')} className="rounded-xl bg-teal-400 px-4 py-2 text-sm font-extrabold text-slate-950">Resume</button>}
                  {['live', 'paused'].includes(activity.status) && <button type="button" disabled={busy} onClick={() => setStatus('closed')} className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-extrabold text-slate-800 dark:text-white">Close</button>}
                  {activity.status === 'closed' && <button type="button" disabled={busy} onClick={() => window.confirm('End this activity and mark it completed?') && setStatus('completed')} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white dark:bg-white dark:text-slate-950">End activity</button>}
                </div>
                {activity.questions.length > 1 && <div className="flex gap-2"><button type="button" disabled={busy || currentQuestionIndex <= 0} onClick={() => advance(activity.questions[currentQuestionIndex - 1].id)} className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-extrabold disabled:opacity-40">← Previous</button><button type="button" disabled={busy || currentQuestionIndex < 0 || currentQuestionIndex >= activity.questions.length - 1} onClick={() => advance(activity.questions[currentQuestionIndex + 1].id)} className="rounded-xl border-2 border-slate-300 px-4 py-2 text-sm font-extrabold disabled:opacity-40">Next →</button></div>}
                {currentQuestion && <div className="grid grid-cols-4 gap-2 rounded-2xl bg-slate-900 p-4 text-white"><div><div className="text-2xl font-extrabold">{currentQuestionIndex + 1}/{activity.questions.length}</div><div className="text-[10px] font-bold uppercase text-slate-400">question</div></div><div><div className="text-2xl font-extrabold">{results?.participant_count || 0}</div><div className="text-[10px] font-bold uppercase text-slate-400">participants</div></div><div><div className="text-2xl font-extrabold">{currentResult?.response_count || 0}</div><div className="text-[10px] font-bold uppercase text-slate-400">responses · {results?.participant_count ? Math.round(((currentResult?.response_count || 0) / results.participant_count) * 100) : 0}%</div></div><div><div className={`text-2xl font-extrabold ${secondsRemaining != null && secondsRemaining <= 5 ? 'text-rose-400' : ''}`}>{secondsRemaining == null ? '—' : `${secondsRemaining}s`}</div><div className="text-[10px] font-bold uppercase text-slate-400">remaining</div></div></div>}
                <div className="grid gap-2">
                  {activity.questions.map((q, i) => (
                    <div key={q.id} className={`flex items-center justify-between rounded-xl border-2 p-3 ${activity.config?.current_question_id === q.id ? 'border-teal-400 bg-teal-50 dark:bg-teal-950' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
                      <div className="text-sm font-bold text-slate-800 dark:text-white">{i + 1}. {q.prompt}</div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {q.live_state === 'pending' && <button type="button" disabled={busy || activity.status !== 'live'} onClick={() => setQuestionState(q.id, 'open')} className="rounded-lg bg-teal-400 px-3 py-1.5 text-xs font-extrabold text-slate-950">Open</button>}
                        {q.live_state === 'open' && <button type="button" disabled={busy} onClick={() => setQuestionState(q.id, 'closed')} className="rounded-lg border-2 border-amber-300 px-3 py-1.5 text-xs font-extrabold text-amber-700">Close voting</button>}
                        {q.live_state === 'closed' && <button type="button" disabled={busy} onClick={() => setQuestionState(q.id, 'results_visible')} className="rounded-lg border-2 border-teal-300 px-3 py-1.5 text-xs font-extrabold text-teal-700">Reveal results</button>}
                        {q.live_state === 'results_visible' && q.options.some((o) => o.is_correct) && <button type="button" disabled={busy} onClick={() => setQuestionState(q.id, 'answer_revealed')} className="rounded-lg border-2 border-emerald-300 px-3 py-1.5 text-xs font-extrabold text-emerald-700">Show answer</button>}
                        {['results_visible', 'answer_revealed'].includes(q.live_state) && <button type="button" disabled={busy} onClick={() => setQuestionState(q.id, 'closed')} className="rounded-lg border-2 border-slate-300 px-3 py-1.5 text-xs font-extrabold">Hide results</button>}
                        {['closed', 'results_visible', 'answer_revealed'].includes(q.live_state) && <button type="button" disabled={busy} onClick={() => setQuestionState(q.id, 'open')} className="rounded-lg border-2 border-slate-300 px-3 py-1.5 text-xs font-extrabold">Reopen</button>}
                      </div>
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
