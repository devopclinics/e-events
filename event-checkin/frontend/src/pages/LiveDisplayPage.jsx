import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import LiveBroadcastCanvas from '../components/LiveBroadcastCanvas'

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
  const { activityId, displayCode } = useParams()
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(true)
  const [streamVersion, setStreamVersion] = useState(0)
  const hasState = useRef(false)

  async function load() {
    try {
      const endpoint = displayCode
        ? `/api/engagement/v1/live/${encodeURIComponent(displayCode)}?token=${encodeURIComponent(token)}`
        : `/api/engagement/v1/activities/${encodeURIComponent(activityId)}/display?token=${encodeURIComponent(token)}`
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('This display link is no longer valid.')
      const data = await response.json()
      const nextState = displayCode ? { ...(data.activity || {}), event_id: data.event_id, display: data.display, program_sessions: data.program_sessions || [] } : data
      if (displayCode && !nextState.display?.settings?.agenda?.length) {
        nextState.display = {
          ...nextState.display,
          settings: {
            ...(nextState.display?.settings || {}),
            agenda: programAgenda(data.program_sessions, nextState.display?.assigned_session_id),
          },
        }
      }
      try {
        const joinResponse = await fetch(`/api/events/${encodeURIComponent(nextState.event_id || '')}/live/public-join-info`, { signal: AbortSignal.timeout(5000) })
        if (joinResponse.ok) nextState.live_join_code = (await joinResponse.json()).code
      } catch { /* QR remains usable even if the optional code label is unavailable */ }
      setState(nextState)
      hasState.current = true
      setError('')
      setConnected(true)
    } catch (loadError) {
      setConnected(false)
      if (!hasState.current) setError(loadError.message)
    }
  }

  useEffect(() => {
    if ((!activityId && !displayCode) || !token) {
      setError('This display link is missing information.')
      return undefined
    }
    load()
    const streamPath = displayCode
      ? `/api/engagement/v1/live/${encodeURIComponent(displayCode)}/stream?token=${encodeURIComponent(token)}`
      : `/api/engagement/v1/activities/${encodeURIComponent(activityId)}/display-stream?token=${encodeURIComponent(token)}`
    const events = new EventSource(streamPath)
    const refresh = () => load()
    const refreshDisplay = () => { load(); setStreamVersion((version) => version + 1) }
    events.onopen = () => setConnected(true)
    events.onerror = () => setConnected(false)
    events.onmessage = refresh
    events.addEventListener('display.changed', refreshDisplay)
    ;['response.submitted', 'question.changed', 'question.state_changed', 'qna.submitted', 'qna.upvoted', 'qna.moderated', 'activity.status_changed'].forEach((name) => events.addEventListener(name, refresh))
    const poll = setInterval(load, 5000)
    return () => { events.close(); clearInterval(poll) }
  }, [activityId, displayCode, token, streamVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="grid min-h-screen place-items-center bg-[#07070d] px-8 text-center text-2xl font-extrabold text-white"><div><div className="mb-3 text-sm uppercase tracking-[.25em] text-fuchsia-400">Festio Live</div>{error}</div></div>
  if (!state) return <div className="grid min-h-screen place-items-center bg-[#07070d] text-sm font-bold uppercase tracking-[.22em] text-slate-500">Connecting to Festio Broadcast…</div>

  return <LiveBroadcastCanvas state={state} connected={connected} onPresent={() => document.querySelector('.flb-screen')?.requestFullscreen?.()} />
}
