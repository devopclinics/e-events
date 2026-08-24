import { useEffect, useMemo, useState } from 'react'
import './LiveBroadcastCanvas.css'

const FALLBACK_WORDS = [
  ['inspiring', 12], ['community', 9], ['connected', 8], ['action', 7],
  ['together', 10], ['future', 6], ['powerful', 5], ['hopeful', 4],
]

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

function resolveScene(requested, state, followActivity) {
  if (!followActivity) return requested || 'welcome'
  const current = state.questions?.find((q) => q.question_id === state.current_question_id)
  if (!current) return state.status === 'live' ? 'join' : 'welcome'
  if (current.live_state === 'open') return current.response_count ? 'responding' : 'question'
  if (current.live_state === 'results_visible') return current.question_type === 'word_cloud' ? 'word_cloud' : 'results'
  if (current.live_state === 'answer_revealed') return 'correct_answer'
  return 'question'
}

function Brand({ state, settings }) {
  return <div className="flb-top">
    <div className="flb-brand"><span className="flb-mark">F</span>Festio Live</div>
    <div className="flb-event">{settings.event_name || state.display_config?.event_name || state.title}<span className="flb-connected">● {state.participant_count || 0} connected</span></div>
  </div>
}

function Footer({ left, right, live = false }) {
  return <div className="flb-footer"><span>{left}</span>{right && <span className={`flb-pill ${live ? 'is-live' : ''}`}>{right}</span>}</div>
}

function Kicker({ children }) { return <div className="flb-kicker">{children}</div> }

function EmptyState({ title = 'Waiting for the presenter', copy = 'The next live moment will appear automatically.' }) {
  return <div className="flb-center"><Kicker>Festio Live</Kicker><h1 className="flb-headline flb-small">{title}</h1><p className="flb-subhead">{copy}</p></div>
}

function ResultsBars({ question }) {
  const options = Object.entries(question?.option_labels || {})
  const total = Math.max(1, Object.values(question?.option_counts || {}).reduce((sum, value) => sum + value, 0))
  return <div className="flb-results">{options.map(([id, label], index) => {
    const count = question.option_counts?.[id] || 0
    const percent = Math.round((count / total) * 100)
    return <div className="flb-result" key={id}>
      <span>{label}</span><div className="flb-bar"><i style={{ width: `${Math.max(3, percent)}%`, '--bar-index': index }}>{count || ''}</i></div><strong>{percent}%</strong>
    </div>
  })}</div>
}

function QuestionOptions({ question }) {
  return <div className="flb-options">{Object.entries(question?.option_labels || {}).slice(0, 6).map(([id, label], index) => (
    <div className="flb-option" key={id}><b>{OPTION_LETTERS[index]}</b><span>{label}</span></div>
  ))}</div>
}

function SceneContent({ scene, state, settings, currentQuestion, countdown }) {
  const questionNumber = Math.max(1, (state.questions || []).findIndex((q) => q.question_id === state.current_question_id) + 1)
  const questionTotal = state.questions?.length || 1
  const questionResponseRate = state.participant_count ? Math.round(((currentQuestion?.response_count || 0) / state.participant_count) * 100) : 0
  const joinCode = state.live_join_code || settings.join_code || state.display_config?.join_code || 'FESTIO LIVE'
  const title = settings.title || state.title || 'Welcome to Festio Live'
  const subtitle = settings.subtitle || state.description || 'A live experience shaped by every voice in the room.'
  const featured = state.featured_qna
  const pulse = state.room_pulse || {}
  const teams = state.teams || []
  const cloud = state.word_cloud?.length ? state.word_cloud : FALLBACK_WORDS.map(([word, count]) => ({ word, count }))
  const insight = state.ai_insight
  const themes = insight?.themes?.length ? insight.themes : cloud.slice(0, 3).map((w) => w.word)
  const correctLabels = (currentQuestion?.correct_option_ids || []).map((id) => currentQuestion.option_labels?.[id]).filter(Boolean)

  if (scene === 'welcome') return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-welcome"><div><Kicker>{settings.kicker || 'The room is ready'}</Kicker><h1 className="flb-headline">{title} <span className="flb-gradient">together.</span></h1><p className="flb-subhead">{subtitle}</p></div><div className="flb-date flb-glass"><span>{settings.date_label || 'Live today'}</span><strong>{state.participant_count || '—'}</strong><span>voices connected</span></div></div></div><Footer left={(settings.sponsors || []).join(' · ') || settings.venue || 'Powered by Festio'} right={settings.status_label || 'Doors open'} live/></>

  if (scene === 'join') return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-join"><div><Kicker>Your voice belongs here</Kicker><h1 className="flb-headline flb-small">Scan. Join. <span className="flb-gradient">Shape the room.</span></h1><p className="flb-subhead">Vote, ask questions, react and collaborate live. No app or account required.</p><div className="flb-code">{joinCode}</div></div><div className="flb-qr flb-glass"><img src={`/api/events/${encodeURIComponent(state.event_id || '')}/live/join-qr.png`} alt="QR code to join Festio Live"/><span>Scan to join</span></div></div></div><Footer left="Open your camera and point it at the QR code" right={`${state.participant_count || 0} already here`} live/></>

  if (scene === 'agenda') {
    const agenda = settings.agenda?.length ? settings.agenda : [{ time: 'Now', title: state.title, speaker: 'Main stage', live: true }, { time: 'Up next', title: 'Audience discussion', speaker: 'Interactive session' }, { time: 'Later', title: 'Ideas into action', speaker: 'Community lab' }]
    return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>What’s happening now</Kicker><h1 className="flb-headline flb-small">Your live event journey</h1><div className="flb-card-grid">{agenda.slice(0, 3).map((item, i) => <div className={`flb-card flb-glass ${item.live || i === 0 ? 'active' : ''}`} key={`${item.time}-${i}`}>{(item.live || i === 0) && <em>LIVE NOW</em>}<span>{item.time}</span><h3>{item.title}</h3><p>{item.speaker || item.room}</p></div>)}</div></div><Footer left="Schedule updates appear automatically" right="On schedule"/></>
  }

  if (scene === 'question') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <><div className="flb-progress"><span>Question {questionNumber} of {questionTotal}</span><i><b style={{ width: `${(questionNumber / questionTotal) * 100}%` }}/></i><span>{currentQuestion.question_type.replaceAll('_', ' ')}</span></div><h1 className="flb-headline flb-small">{currentQuestion.prompt}</h1><QuestionOptions question={currentQuestion}/></> : <EmptyState/>}</div><Footer left="Answer privately on your phone" right={currentQuestion ? 'Get ready' : 'Standing by'}/></>

  if (scene === 'responding') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <div className="flb-vote"><div><Kicker>The room is responding</Kicker><h1 className="flb-headline flb-small">Every voice moves the conversation.</h1><div className="flb-stats"><div><strong>{currentQuestion.response_count || 0}</strong><span>responses received</span></div><div><strong>{questionResponseRate}%</strong><span>participation rate</span></div></div></div><div className="flb-timer"><span>{currentQuestion.time_limit_seconds || 30}</span><small>seconds</small></div></div> : <EmptyState/>}</div>{settings.show_reactions !== false && <div className="flb-reactions"><i>♥</i><i>✦</i><i>●</i><i>◆</i></div>}<Footer left={`${state.participant_count || 0} participants connected`} right="Voting open" live/></>

  if (scene === 'results') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <><Kicker>The room has spoken</Kicker><h1 className="flb-headline flb-result-title">{currentQuestion.prompt}</h1><ResultsBars question={currentQuestion}/></> : <EmptyState title="Results are ready when the room is"/>}</div><Footer left={`${currentQuestion?.response_count || 0} verified responses`} right="Results live" live/></>

  if (scene === 'correct_answer') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <><Kicker>Smart reveal</Kicker><h1 className="flb-headline flb-small">{correctLabels.join(', ') || 'Answer revealed'}</h1><div className="flb-answer flb-glass"><div className="flb-check">✓</div><div><h2>{questionResponseRate}% of connected participants responded</h2><p>{currentQuestion.explanation || 'The explanation and source are now available on each participant’s phone.'}</p></div></div></> : <EmptyState/>}</div><Footer left="Accuracy, speed and confidence captured" right="Answer revealed"/></>

  if (scene === 'leaderboard') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>The race is close</Kicker><h1 className="flb-headline flb-small">Who moved up?</h1>{state.leaderboard?.length ? <div className="flb-leaders">{state.leaderboard.slice(0, 5).map((entry, i) => <div className="flb-leader" key={entry.participant_id}><strong>{String(entry.rank).padStart(2, '0')}</strong><i>{entry.display_name.slice(0, 2).toUpperCase()}</i><span>{entry.display_name}{i === 0 && <small> New leader</small>}</span><b>{entry.score.toLocaleString()} pts</b></div>)}</div> : <EmptyState title="Scores are building" copy="The leaderboard appears after scored answers arrive."/>}</div><Footer left="Privacy-safe display names" right={`${state.leaderboard?.length || 0} ranked`}/></>

  if (scene === 'team_battle') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Collective challenge</Kicker><h1 className="flb-headline flb-small">One answer can change everything.</h1><div className="flb-teams">{teams.slice(0, 2).map((team, i) => <div className="flb-team flb-glass" key={i}><span>{i ? '⚡' : '◈'}</span><h2>{settings.team_names?.[i] || team.name}</h2><strong>{team.score.toLocaleString()}</strong><div><i style={{ width: `${clamp(team.score / Math.max(1, ...teams.map((t) => t.score)) * 100, 5, 100)}%` }}/></div><small>{team.players} players</small></div>)}</div></div><Footer left="Accuracy, speed and participation combine" right="Team mode" live/></>

  if (scene === 'rating') {
    const average = currentQuestion?.average_rating
    return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>A five-second check-in</Kicker><h1 className="flb-headline flb-small">{currentQuestion?.prompt || settings.message || 'How useful was this session?'}</h1><div className="flb-rating">{[1,2,3,4,5].map((n) => <span className={average && n === Math.round(average) ? 'selected' : ''} key={n}>{n}</span>)}</div><div className="flb-scale"><span>Not useful</span><span>Extremely useful</span></div></div><Footer left={average ? `Live average ${average.toFixed(1)} from ${currentQuestion.response_count} ratings` : 'Responses can be anonymous'} right="Rating open" live/></>
  }

  if (scene === 'feedback') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Turn insight into action</Kicker><h1 className="flb-headline flb-small">{currentQuestion?.prompt || settings.message || 'What will you do differently after today?'}</h1><div className="flb-feedback"><div className="flb-glass"><span>Live response stream</span><p>Thoughtful responses appear after moderation.</p></div><div className="flb-glass"><span>Completion</span><strong>{questionResponseRate}%</strong><p>{currentQuestion?.response_count || 0} responses</p></div></div></div><Footer left="Sensitive responses remain private" right="Listening" live/></>

  if (scene === 'word_cloud') {
    const max = Math.max(1, ...cloud.map((item) => item.count))
    return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-cloud">{cloud.slice(0, 24).map((item, i) => <span style={{ fontSize: `${1.2 + (item.count / max) * 3.5}cqw` }} key={`${item.word}-${i}`}>{item.word}</span>)}</div></div><Footer left={`${currentQuestion?.response_count || state.response_count || 0} responses · automatically grouped`} right="Updating live" live/></>
  }

  if (scene === 'q_and_a') return <><Brand state={state} settings={settings}/><div className="flb-content">{featured ? <><Kicker>The room’s top question</Kicker><div className="flb-qna flb-glass"><blockquote>{featured.text}</blockquote><div><span>Audience question</span><strong>▲ {featured.upvote_count} upvotes</strong></div></div><p className="flb-subhead">Related questions can be merged by the moderator so strong ideas rise together.</p></> : <EmptyState title="Questions are coming in" copy="A moderator can feature the next question at any time."/>}</div><Footer left="Moderator-approved audience Q&A" right={featured ? 'Speaker view ready' : 'Listening'} live/></>

  if (scene === 'room_pulse') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Know the room, not just the answers</Kicker><h1 className="flb-headline flb-small">Audience energy is <span className="flb-gradient">{pulse.energy > 70 ? 'rising.' : 'building.'}</span></h1><div className="flb-pulse"><div className="flb-energy flb-glass"><div><strong>{pulse.energy || 0}</strong><small>/100</small></div><p>Live energy score</p></div><div className="flb-signals"><div className="flb-glass"><span>Participation</span><strong>{pulse.participation_percent || 0}%</strong><small>{pulse.responses || 0} current responses</small></div><div className="flb-glass"><span>Sentiment</span><strong>{pulse.sentiment || 'Gathering'}</strong><small>From analyzed feedback</small></div><div className="flb-glass"><span>Consensus</span><strong>{pulse.consensus_percent || 0}%</strong><small>Top response share</small></div><div className="flb-glass"><span>Connected</span><strong>{state.participant_count || 0}</strong><small>Active participants</small></div></div></div></div><Footer left="Privacy-safe aggregate — no individual profiling" right="Room pulse" live/></>

  if (scene === 'ai_insight') return <><Brand state={state} settings={settings}/><div className="flb-content">{insight ? <><Kicker>Hundreds of voices, one clear picture</Kicker><h1 className="flb-headline flb-small">What the room is really saying</h1><div className="flb-insights"><div className="flb-glass"><span>✦ Themes emerging</span>{themes.slice(0, 3).map((theme, i) => <div className="flb-topic" key={theme}><div><span>{theme}</span><b>{Math.max(20, 48 - i * 11)}%</b></div><i><b style={{ width: `${Math.max(20, 48 - i * 11)}%` }}/></i></div>)}</div><div className="flb-glass"><span>Shared insight</span><h3>{insight.summary}</h3><p>AI-generated synthesis. Source responses remain available to authorized staff.</p></div></div></> : <EmptyState title="Festio Intelligence is listening" copy="Run AI analysis from Analytics to project a privacy-safe synthesis."/>}</div><Footer left="AI-generated · source responses remain inspectable" right={insight ? `Sentiment ${insight.sentiment || 'mixed'}` : 'Awaiting analysis'}/></>

  if (scene === 'idea_galaxy') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Collective intelligence, made visible</Kicker><div className="flb-galaxy">{cloud.slice(0, 10).map((item, i) => <span className={i < 2 ? 'large' : ''} style={{ '--x': `${8 + ((i * 23) % 78)}%`, '--y': `${8 + ((i * 37) % 72)}%`, '--delay': `${-i * .4}s` }} key={item.word}>{item.word}</span>)}</div></div><Footer left="Nearby ideas share meaning and momentum" right={`${cloud.length} ideas clustered`} live/></>

  if (scene === 'announcement') return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-announcement"><div>↗</div><div><Kicker>{settings.kicker || 'Event update'}</Kicker><h1 className="flb-headline flb-small">{settings.message || 'The next session begins shortly.'}</h1><p className="flb-subhead">{settings.subtitle || 'Check your event schedule for the latest room and accessibility information.'}</p></div></div></div><Footer left="Posted by Event Operations" right={settings.status_label || 'Important update'}/></>

  if (scene === 'break') {
    const agenda = settings.agenda || []
    const nextSession = agenda.find((item) => !item.live) || agenda[1] || agenda[0]
    return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-break"><div><Kicker>We’ll be right back</Kicker><h1 className="flb-headline">{settings.title || 'Stretch. Connect.'} <span className="flb-gradient">Recharge.</span></h1><p className="flb-subhead">{settings.message || 'Refreshments and quiet space are available in the lobby.'}</p></div><div className="flb-upnext flb-glass"><strong>{settings.status_label || nextSession?.time || 'Soon'}</strong><span>{settings.status_label ? 'until we resume' : 'scheduled start'}</span><h3>Up next</h3><p>{nextSession?.title || state.title}</p><small>{nextSession?.speaker || nextSession?.room || 'Live captioning available'}</small></div></div></div><Footer left="The display resumes automatically" right="Intermission"/></>
  }

  if (scene === 'countdown') return <><Brand state={state} settings={settings}/><div className="flb-content flb-center"><div className="flb-countdown flb-gradient">{String(Math.floor(countdown / 60)).padStart(2, '0')}:{String(countdown % 60).padStart(2, '0')}</div><div className="flb-count-label">Until we begin together</div><p className="flb-subhead">{state.participant_count || 0} people are connected. Join now to take part.</p></div><Footer left="Live captions and interpretation available" right="Starting soon" live/></>

  if (scene === 'celebration') return <><div className="flb-confetti">{Array.from({ length: 28 }, (_, i) => <i style={{ '--x': `${3 + i * 3.6}%`, '--delay': `${-i * .27}s` }} key={i}/>)}</div><Brand state={state} settings={settings}/><div className="flb-content flb-center"><div className="flb-trophy">◆</div><Kicker>{settings.kicker || 'Collective milestone unlocked'}</Kicker><h1 className="flb-headline flb-gradient">{settings.title || `${state.response_count || 0} ideas shared!`}</h1><p className="flb-subhead">{settings.message || 'This room just turned participation into shared momentum.'}</p></div><Footer left="Every contribution helped reach this moment" right="Celebrate" live/></>

  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-custom flb-glass"><Kicker>{settings.kicker || 'A message from your hosts'}</Kicker><h1 className="flb-headline">{settings.title || 'Thank you for building the future'} <span className="flb-gradient">with us.</span></h1><p className="flb-subhead">{settings.message || subtitle}</p></div></div><Footer left={settings.event_name || state.title} right={settings.status_label || 'Feedback open'} live/></>
}

export default function LiveBroadcastCanvas({ state, connected = true, onPresent }) {
  const display = state.display || {}
  const settings = display.settings || {}
  const scene = resolveScene(display.scene || state.display_config?.display_scene || 'welcome', state, settings.follow_activity)
  const currentQuestion = useMemo(() => state.questions?.find((q) => q.question_id === state.current_question_id), [state.questions, state.current_question_id])
  const [countdown, setCountdown] = useState(settings.countdown_seconds ?? 298)

  useEffect(() => { setCountdown(settings.countdown_seconds ?? 298) }, [settings.countdown_seconds, display.id])
  useEffect(() => {
    if (scene !== 'countdown' || countdown <= 0) return undefined
    const timer = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [scene, countdown])

  return <div className="flb-root">
    <div className={`flb-screen flb-${settings.theme || 'aurora'} ${settings.motion === false ? 'flb-motion-off' : ''} ${settings.safe_area ? 'flb-safe' : ''}`}>
      <div className="flb-orb flb-orb-a"/><div className="flb-orb flb-orb-b"/><div className="flb-noise"/>
      <SceneContent scene={scene} state={state} settings={settings} currentQuestion={currentQuestion} countdown={countdown}/>
      {!connected && <div className="flb-offline">Reconnecting · showing the last verified state</div>}
    </div>
    <button type="button" className="flb-present" onClick={onPresent} aria-label="Enter fullscreen presentation">Present ↗</button>
  </div>
}
