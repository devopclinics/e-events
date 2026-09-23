import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import LiveBroadcastCanvas from '../components/LiveBroadcastCanvas'
import WorkflowSceneRenderer from '../components/live/WorkflowSceneRenderer'
import { cachedJoinCode, createLiveRefresh, reconnectDelay } from '../lib/liveRefresh.mjs'

const PREVIEW_SCENES = new Set([
  'welcome', 'join', 'agenda', 'question', 'responding', 'results', 'all_results', 'survey_insights',
  'correct_answer', 'leaderboard', 'team_battle', 'rating', 'feedback', 'word_cloud',
  'q_and_a', 'room_pulse', 'ai_insight', 'idea_galaxy', 'live_spectrum',
  'interactive_quadrant', 'image_heatmap', 'ranking_race', 'prediction_reveal',
  'commitment_wall', 'photo_mosaic', 'location_map', 'journey_recap',
  'spotlight_wheel', 'donation_tracker', 'announcement', 'break', 'countdown', 'celebration', 'custom_message',
])

function programAgenda(sessions = [], assignedSessionId = '') {
  if (!sessions.length) return []
  const now = Date.now()
  const normalized = sessions.map((session) => ({
    ...session,
    start: session.starts_at ? new Date(session.starts_at).getTime() : Number.POSITIVE_INFINITY,
    end: session.ends_at ? new Date(session.ends_at).getTime() : Number.POSITIVE_INFINITY,
  }))
  let startIndex = assignedSessionId ? normalized.findIndex((session) => session.source_step_id === assignedSessionId) : -1
  if (startIndex < 0) startIndex = normalized.findIndex((session) => session.start <= now && now < session.end)
  if (startIndex < 0) startIndex = normalized.findIndex((session) => session.start >= now)
  if (startIndex < 0) startIndex = Math.max(0, normalized.length - 3)
  return normalized.slice(startIndex, startIndex + 3).map((session, index) => ({
    time: Number.isFinite(session.start) ? new Date(session.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : (index ? 'Up next' : 'Now'),
    title: session.title,
    speaker: session.speaker,
    room: session.room,
    live: session.start <= now && now < session.end,
  }))
}

// Public, read-only TV/projector surface. Its unguessable display token grants
// no staff or participant capability and can be rotated independently.
export default function LiveDisplayPage() {
  const { activityId, displayCode, displayShortCode } = useParams()
  const query = new URLSearchParams(window.location.search)
  const token = query.get('token') || ''
  const requestedPreviewScene = query.get('previewScene') || ''
  const previewScene = PREVIEW_SCENES.has(requestedPreviewScene) ? requestedPreviewScene : ''
  const observer = ['true', '1'].includes(query.get('observer')) || !!previewScene || query.has('adminRefresh')
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const [rejoining, setRejoining] = useState(false)
  const [sessionVersion, setSessionVersion] = useState(0)
  const clientId = useRef(null)
  const preserveLease = useRef(false)
  if (!clientId.current) {
    try {
      clientId.current = sessionStorage.getItem('festioDisplayClientId')
      if (!clientId.current) {
        clientId.current = (crypto.randomUUID?.() || `projector${Date.now()}${Math.random().toString(36).slice(2)}`).replaceAll('-', '')
        sessionStorage.setItem('festioDisplayClientId', clientId.current)
      }
    } catch { clientId.current = `projector${Date.now()}${Math.random().toString(36).slice(2)}` }
  }
  const namedDisplay = !!(displayCode || displayShortCode)
  const basePath = displayShortCode
    ? `/api/engagement/v1/live-short/${encodeURIComponent(displayShortCode)}`
    : displayCode
      ? `/api/engagement/v1/live/${encodeURIComponent(displayCode)}`
      : `/api/engagement/v1/activities/${encodeURIComponent(activityId || '')}`
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (namedDisplay) {
    if (observer) params.set('observer', 'true')
    else params.set('client_id', clientId.current)
  }
  const queryString = params.toString()

  async function rejoin() {
    setRejoining(true)
    try {
      const response = await fetch(`${basePath}/lease?${queryString}`, { method: 'POST', signal: AbortSignal.timeout(8000) })
      if (response.status === 409) throw new Error('This display has reached its screen limit. Disconnect a screen in the control room, then try again.')
      if (!response.ok) throw new Error('Could not reconnect this screen. Please try again.')
      preserveLease.current = true
      setDisconnected(false); setError(''); setSessionVersion((value) => value + 1)
    } catch (failure) { setError(failure.message) }
    finally { setRejoining(false) }
  }

  useEffect(() => {
    setState(null); setError(''); setDisconnected(false); setConnected(false)
    if ((!activityId && !namedDisplay) || (!displayShortCode && !token)) {
      setError('This display link is missing information.')
    preserveLease.current = false
      return undefined
    }
    let cancelled = false
    let stopped = false
    let events = null
    let subscription = null
    let retryTimer = null
    let attempts = 0
    let controller = null
    let hasState = false
    const endpoint = `${basePath}${namedDisplay ? '' : '/display'}?${queryString}`
    const streamPath = `${basePath}${namedDisplay ? '/stream' : '/display-stream'}?${queryString}`
    const closeStream = () => { events?.close(); events = null; subscription = null }
    const clearRetry = () => { if (retryTimer !== null) clearTimeout(retryTimer); retryTimer = null }
    const retry = () => {
      if (cancelled || stopped || retryTimer !== null) return
      retryTimer = setTimeout(() => { retryTimer = null; refresh.request(true) }, reconnectDelay(attempts++))
    }
    const stopDevice = () => {
      stopped = true; closeStream(); clearRetry(); refresh.dispose()
      setState(null); setConnected(false); setDisconnected(true)
      setError('This screen was disconnected from the control room.')
    }
    const openStream = (key) => {
      if (cancelled || stopped || (events && subscription === key)) return
      closeStream()
      const source = new EventSource(streamPath)
      events = source; subscription = key
      source.onopen = () => { if (!cancelled && events === source) { setConnected(true); attempts = 0; clearRetry() } }
      source.onerror = () => {
        if (cancelled || events !== source) return
        setConnected(false); closeStream(); retry()
      }
      source.addEventListener('ready', () => refresh.request(true))
      source.addEventListener('display.disconnected', () => { closeStream(); refresh.request(true) })
      source.onmessage = () => refresh.request()
      ;['response.submitted', 'qna.submitted', 'qna.upvoted'].forEach((name) => source.addEventListener(name, () => refresh.request()))
      ;[
        'display.changed', 'workflow.changed', 'workflow.displays_changed',
        'workflow.start', 'workflow.next', 'workflow.previous', 'workflow.jump',
        'workflow.pause', 'workflow.resume', 'workflow.complete',
        'workflow.video_play', 'workflow.video_pause', 'workflow.video_restart',
        'workflow.timer_start', 'workflow.timer_pause', 'workflow.timer_resume',
        'workflow.timer_reset', 'workflow.timer_add', 'workflow.reveal_results', 'workflow.reopen_voting',
        'question.changed', 'question.state_changed', 'show.phase_changed', 'qna.moderated', 'activity.status_changed',
      ].forEach((name) => source.addEventListener(name, () => refresh.request(true)))
    }
    const refresh = createLiveRefresh(async ({ isCurrent }) => {
      if (stopped) return
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 8000)
      try {
        const response = await fetch(endpoint, { signal: controller.signal })
        if (cancelled || !isCurrent()) return
        if (response.status === 410 && !observer) { stopDevice(); return }
        if (response.status === 409) {
          closeStream(); setState(null); hasState = false; setConnected(false)
          setError('This display has reached its screen limit. Disconnect a screen in the control room to make room.')
          retry(); return
        }
        if ([401, 403, 404].includes(response.status)) {
          stopped = true; closeStream(); clearRetry()
          setState(null); setConnected(false); setError('This display link is no longer valid.'); return
        }
        if (!response.ok) throw new Error('Reconnecting to Festio Broadcast…')
        const data = await response.json()
        if (cancelled || !isCurrent()) return
        const nextState = namedDisplay ? { ...(data.activity || {}), event_id: data.event_id, display: data.display, program_sessions: data.program_sessions || [] } : data
        if (namedDisplay && data.workflow_run) nextState.workflow_run = data.workflow_run
        if (namedDisplay && !nextState.display?.settings?.agenda?.length) {
          nextState.display = { ...nextState.display, settings: { ...(nextState.display?.settings || {}), agenda: programAgenda(data.program_sessions, nextState.display?.assigned_session_id) } }
        }
        if (previewScene) {
          // Previewing a manual scene must also bypass any assigned workflow.
          delete nextState.workflow_run
          if (namedDisplay) nextState.display = { ...nextState.display, scene: previewScene, settings: { ...(nextState.display?.settings || {}), follow_activity: false } }
          else nextState.display_config = { ...(nextState.display_config || {}), display_scene: previewScene, follow_activity: false }
        }
        setState((current) => ({ ...nextState, live_join_code: current?.event_id === nextState.event_id ? current.live_join_code : undefined }))
        hasState = true; setError(''); attempts = 0; clearRetry()
        cachedJoinCode(nextState.event_id).then((code) => {
          if (!cancelled && !stopped && code) setState((current) => current?.event_id === nextState.event_id ? { ...current, live_join_code: code } : current)
        })
        const key = `${data.display?.assigned_activity_id || nextState.activity_id || ''}:${data.display?.assigned_workflow_run_id || data.workflow_run?.id || ''}`
        openStream(key)
      } catch (failure) {
        if (cancelled) return
        setConnected(false)
        if (!hasState) setError('Connection interrupted. Retrying…')
        closeStream(); retry()
      } finally { clearTimeout(timeout); controller = null }
    }, { delayMs: observer ? 1000 : 350 })
    const releaseLease = () => {
      if (namedDisplay && !observer && !stopped) fetch(`${basePath}/lease?${queryString}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    }
    window.addEventListener('pagehide', releaseLease)
    const onVisible = () => { if (document.visibilityState === 'visible' && !stopped) refresh.request(true) }
    document.addEventListener('visibilitychange', onVisible)
    // Low-frequency reconciliation repairs a missed Pub/Sub notification.
    const reconcile = setInterval(() => {
      if (!stopped && (!observer || document.visibilityState === 'visible')) refresh.request()
    }, 30000)
    refresh.request(true)
    return () => {
      cancelled = true; controller?.abort(); refresh.dispose(); closeStream(); clearRetry(); clearInterval(reconcile)
      window.removeEventListener('pagehide', releaseLease); document.removeEventListener('visibilitychange', onVisible)
      if (!preserveLease.current) releaseLease()
    }
  }, [activityId, namedDisplay, displayShortCode, token, basePath, queryString, observer, previewScene, sessionVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="grid min-h-screen place-items-center bg-[#07070d] px-8 text-center text-2xl font-extrabold text-white"><div><div className="mb-3 text-sm uppercase tracking-[.25em] text-fuchsia-400">Festio Live</div>{error}{disconnected && <button type="button" disabled={rejoining} onClick={rejoin} className="mx-auto mt-6 block rounded-xl bg-white px-6 py-3 text-lg text-slate-950">{rejoining ? 'Reconnecting…' : 'Reconnect this screen'}</button>}</div></div>
  if (!state) return <div className="grid min-h-screen place-items-center bg-[#07070d] text-sm font-bold uppercase tracking-[.22em] text-slate-500">Connecting to Festio Broadcast…</div>

  if (['ready', 'live', 'paused'].includes(state.workflow_run?.status) && state.workflow_run?.current_step) return <div className="min-h-screen w-screen overflow-hidden bg-[#070d24] p-0"><WorkflowSceneRenderer key={state.workflow_run.current_step.id} step={state.workflow_run.current_step} mode={observer ? "preview" : "display"} eventId={state.event_id} joinCode={state.live_join_code}/></div>

  return <LiveBroadcastCanvas state={state} connected={connected} onPresent={() => document.querySelector('.flb-screen')?.requestFullscreen?.()} />
}
