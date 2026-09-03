import { useEffect, useRef, useState } from 'react'
import './WorkflowSceneRenderer.css'
import './WorkflowRuntimePolish.css'

const COLORS = ['#1fd4c7', '#ff477e', '#ffb627', '#7557e8', '#38a9ff', '#62d66f', '#ff7452']
const TICKING_TYPES = new Set(['countdown', 'game'])
// Only scenes that actually collect a response need the join dock — matches
// approved mockups: poll/word-cloud/ranking scenes show "Scan to vote/contribute",
// results/comparison/closing scenes do not.
const NEEDS_JOIN = new Set(['poll', 'multi_select', 'rating', 'word_cloud', 'ranking'])

function normalizeLabel(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function optionIcon(label = '', index = 0) {
  const text = label.toLowerCase()
  const matches = [
    [/wealth|economic|professional/, '◆'], [/career|achievement|leader/, '↗'], [/health/, '♥'],
    [/family|marriage|parent|children|relationship/, '♥'], [/faith|allah|islamic|knowledge/, '☾'],
    [/freedom|time/, '◷'], [/purpose|service|impact|need/, '✦'], [/youth|elder/, '◉'],
    [/brother|community/, '●●'], [/society|wider/, '◎'], [/happier/, '☺'], [/same/, '—'],
  ]
  return matches.find(([pattern]) => pattern.test(text))?.[1] || String(index + 1).padStart(2, '0')
}

// startSeconds/endSeconds let a step play just the relevant excerpt of a
// longer source video (e.g. a 5-minute point inside a 12-minute talk)
// without re-hosting a trimmed file.
function embedVideoUrl(url, startSeconds, endSeconds) {
  if (!url) return null
  const youtube = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/))([\w-]{6,})/)
    || url.match(/(?:vid:|vid%3A)([\w-]{6,})/i)
  if (youtube) {
    // URLSearchParams encodes values itself -- pass the raw origin, not a
    // pre-encoded one, or it comes out double-encoded (%3A -> %253A) and
    // YouTube's postMessage bridge silently stops accepting presenter commands.
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const params = new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0' })
    if (origin) params.set('origin', origin)
    if (startSeconds) params.set('start', String(Math.floor(startSeconds)))
    if (endSeconds) params.set('end', String(Math.floor(endSeconds)))
    return { kind: 'youtube', src: `https://www.youtube.com/embed/${youtube[1]}?${params.toString()}`, startSeconds: Math.floor(startSeconds || 0) }
  }
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) {
    const hash = startSeconds ? `#t=${Math.floor(startSeconds)}s` : ''
    return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vimeo[1]}?api=1${hash}`, startSeconds: Math.floor(startSeconds || 0) }
  }
  return { kind: 'video', src: url, startSeconds: Math.floor(startSeconds || 0) }
}

// Ticks a live countdown for 'countdown'/'game' scenes. Previously this only
// ever rendered a static formatted string once — real audience-facing scenes
// (mockup 09 "Connection Challenge") need a clock that actually counts down.
// Component remounts per step (parent passes key={step.id}), so this timer
// naturally restarts fresh whenever the active step changes.
function useCountdown(timer, fallbackSeconds) {
  const initial = timer?.remaining_seconds ?? fallbackSeconds ?? 0
  const [remaining, setRemaining] = useState(initial)
  useEffect(() => {
    setRemaining(initial)
    if (timer?.status !== 'running' || !timer?.ends_at) return undefined
    const deadline = new Date(timer.ends_at).getTime()
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [initial, timer?.status, timer?.ends_at])
  return remaining
}

function DirectVideo({ source, poster, runtime, requireActivation = true, startSeconds = 0 }) {
  const ref = useRef(null)
  const [activated, setActivated] = useState(() => !requireActivation || sessionStorage.getItem('festio:projector-media-enabled') === '1')
  const activate = () => {
    sessionStorage.setItem('festio:projector-media-enabled', '1')
    setActivated(true)
    if (startSeconds) ref.current && (ref.current.currentTime = startSeconds)
    // This must run inside the click handler. Delaying it to an effect loses
    // the browser's user-activation grant and Chrome blocks remote playback.
    ref.current?.play().catch(() => {})
  }
  useEffect(() => {
    const player = ref.current
    if (!player || !activated || !runtime?.media_command_id) return
    if (runtime.media_command === 'play') player.play().catch(() => {})
    if (runtime.media_command === 'pause') player.pause()
    if (runtime.media_command === 'restart') { player.currentTime = startSeconds; player.play().catch(() => {}) }
  }, [activated, runtime?.media_command_id, runtime?.media_command, startSeconds])
  return <div className="wf-player-shell"><video ref={ref} src={source} controls poster={poster || undefined}/>{requireActivation && !activated && <button type="button" className="wf-media-activate" onClick={activate}><b>▶ Enable projector video</b><span>Click once on this display, then use Play, Pause and Restart from the presenter console.</span></button>}</div>
}

function EmbeddedVideo({ video, title, runtime, requireActivation = true }) {
  const ref = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [activated, setActivated] = useState(() => !requireActivation || sessionStorage.getItem('festio:projector-media-enabled') === '1')
  const send = (command) => {
    const player = ref.current?.contentWindow
    if (!player) return
    if (video.kind === 'youtube') {
      const func = command === 'play' ? 'playVideo' : command === 'pause' ? 'pauseVideo' : 'seekTo'
      // Restart means "back to the start of this clip", not absolute 0 --
      // seekTo(0) would jump past the excerpt to the top of the full source video.
      const args = command === 'restart' ? [video.startSeconds || 0, true] : []
      player.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com')
      if (command === 'restart') player.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), 'https://www.youtube.com')
    } else if (video.kind === 'vimeo') {
      const method = command === 'restart' ? 'setCurrentTime' : command
      player.postMessage({ method, value: command === 'restart' ? (video.startSeconds || 0) : undefined }, 'https://player.vimeo.com')
      if (command === 'restart') player.postMessage({ method: 'play' }, 'https://player.vimeo.com')
    }
  }
  const activate = () => {
    sessionStorage.setItem('festio:projector-media-enabled', '1')
    setActivated(true)
    // Send during the trusted click so embedded players receive an autoplay
    // grant with sound. Subsequent presenter commands can then control it.
    send('play')
  }
  useEffect(() => {
    if (!loaded || !activated || !runtime?.media_command_id) return undefined
    const command = runtime.media_command
    // The iframe load event can precede the YouTube/Vimeo JS bridge becoming
    // command-ready. Retry briefly instead of silently dropping the command.
    const timers = [0, 250, 750].map((delay) => setTimeout(() => send(command), delay))
    return () => timers.forEach(clearTimeout)
  }, [loaded, activated, runtime?.media_command_id, runtime?.media_command, video.kind]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="wf-player-shell"><iframe ref={ref} src={video.src} title={title} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen onLoad={() => setLoaded(true)}/>{requireActivation && !activated && <button type="button" className="wf-media-activate" onClick={activate}><b>▶ Enable projector video</b><span>Click once on this display, then use Play, Pause and Restart from the presenter console.</span></button>}</div>
}

function ResultsView({ results = [], style = 'bars' }) {
  const ranked = [...results].sort((a, b) => (b.percent || 0) - (a.percent || 0))
  if (style === 'influence_orbit') return <div className="wf-result-orbit"><div className="wf-orbit-core">ME</div>{results.map((item, index) => <div key={item.label} className={`wf-orbit-item orbit-${index + 1}`} style={{ '--option': COLORS[index % COLORS.length], '--size': `${Math.max(70, 70 + (item.percent || 0) * 1.6)}px` }}><b>{item.percent || 0}%</b><span>{item.label}</span></div>)}</div>
  if (style === 'connection_gauge') {
    const connected = results.slice(0, 2).reduce((sum, item) => sum + (item.percent || 0), 0)
    return <div className="wf-result-connection"><div className="wf-connection-gauge" style={{ '--connected': `${connected * 1.8}deg` }}><div><b>{connected}%</b><span>have someone they can trust</span></div></div><div className="wf-connection-list">{results.map((item, index) => <div key={item.label}><i style={{ background: COLORS[index % COLORS.length] }}/><span>{item.label}</span><b>{item.percent || 0}%</b></div>)}</div></div>
  }
  if (style === 'life_wheel') return <div className="wf-result-wheel">{results.map((item, index) => <div key={item.label} className={`wheel-${index + 1}`} style={{ '--option': COLORS[index % COLORS.length] }}><b>{item.percent || 0}%</b><span>{item.label}</span></div>)}<strong>LIFE</strong></div>
  if (style === 'legacy_podium') return <div className="wf-result-podium">{ranked.map((item, index) => <div key={item.label} className={`podium-${index + 1}`} style={{ '--option': COLORS[index % COLORS.length] }}><strong>#{index + 1}</strong><b>{item.label}</b><span>{item.percent || 0}%</span></div>)}</div>
  if (style === 'commitment_tiles') return <div className="wf-result-tiles">{results.map((item, index) => <div key={item.label} style={{ '--option': COLORS[index % COLORS.length], '--weight': Math.max(.85, 1 + (item.percent || 0) / 100) }}><b>{item.label}</b><strong>{item.percent || 0}%</strong></div>)}</div>
  if (style === 'generational_mirror') return <div className="wf-result-mirror-fallback"><span>THE REGRET QUESTION · ANONYMOUS AGGREGATE</span><div>{ranked.map((item, index) => <div key={item.label} style={{ '--option': COLORS[index % COLORS.length] }}><b>{item.label}</b><i><em style={{ width: `${item.percent || 0}%` }}/></i><strong>{item.percent || 0}%</strong></div>)}</div><small>Life-stage comparison appears only when explicit, permitted grouping data exists.</small></div>
  if (style === 'ranking' || style === 'winner') return <div className={`wf-result-ranking ${style === 'winner' ? 'winner' : ''}`}>{ranked.map((item, index) => <div key={item.label} style={{ '--option': COLORS[index % COLORS.length] }}><strong>{String(index + 1).padStart(2, '0')}</strong><span>{item.label}</span><b>{item.percent || 0}%</b></div>)}</div>
  if (style === 'donut') {
    let total = 0
    const stops = results.map((item, index) => { const start = total; total += item.percent || 0; return `${COLORS[index % COLORS.length]} ${start}% ${total}%` }).join(',')
    return <div className="wf-result-donut"><div className="wf-donut" style={{ background: `conic-gradient(${stops || '#253451 0 100%'})` }}><b>{results.reduce((sum, item) => sum + (item.count || 0), 0)}</b><span>responses</span></div><div className="wf-donut-legend">{results.map((item, index) => <div key={item.label}><i style={{ background: COLORS[index % COLORS.length] }}/><span>{item.label}</span><b>{item.percent || 0}%</b></div>)}</div></div>
  }
  if (style === 'split') return <div className="wf-result-split">{ranked.map((item, index) => <div key={item.label} style={{ '--option': COLORS[index % COLORS.length], flexGrow: Math.max(1, item.percent || 0) }}><b>{item.percent || 0}%</b><span>{item.label}</span></div>)}</div>
  return <div className="wf-bars">{results.map((item, index) => <div key={item.label}>{item.icon && <i>{item.icon}</i>}<span>{item.label}</span><i className="wf-bar-track"><em style={{ width: `${item.percent || 0}%`, background: COLORS[index % COLORS.length] }}/></i><b>{item.percent || 0}%</b></div>)}</div>
}

export default function WorkflowSceneRenderer({ step, mode = 'display', eventId = null, joinCode = null, responseData = null }) {
  const tickingDuration = step && TICKING_TYPES.has(step.step_type) ? (step.duration_seconds || 180) : null
  const remaining = useCountdown(step?.runtime?.timer, tickingDuration)

  if (!step) return <div className="wf-scene wf-wait"><span>FESTIO LIVE</span><h2>The next moment will begin shortly.</h2></div>
  const config = step.config || {}
  responseData = responseData || step.data || null
  const type = step.step_type
  const showingResults = step.display_phase === 'results' && ['poll', 'multi_select', 'rating', 'ranking'].includes(type)
  const options = config.options || responseData?.options || []
  const title = config.title || step.title
  const bg = config.background_image_url
  // 'horizon' is for wide, short banner art (a skyline strip) that would
  // blur badly under background-size:cover — it's shown at natural width,
  // anchored to the bottom edge, instead of stretched to fill the scene.
  const bgFit = config.background_fit === 'horizon' ? 'wf-bg-horizon' : 'wf-bg-cover'
  const video = type === 'video' ? embedVideoUrl(config.video_url, config.start_seconds, config.end_seconds) : null
  const ringTotal = tickingDuration || 1
  const ringFraction = tickingDuration ? remaining / ringTotal : 0
  const joinHost = typeof window !== 'undefined' ? window.location.host : 'festio.events'
  const preset = String(step.theme?.preset || 'festio_dark').toLowerCase().replace(/[^a-z0-9_-]/g, '')

  return <section className={`wf-scene wf-${type} wf-${mode} wf-theme-${preset}`} style={{ '--wf-accent': config.accent || step.theme?.accent || '#20d2c2', '--wf-gold': step.theme?.gold || '#e7bd68' }}>
    {bg && <div className={`wf-bg ${bgFit}`} style={{ backgroundImage: `url("${bg}")` }}/>}
    {/* Generic, asset-free cinematic depth for any scene without configured
        photo art — a CSS-only starfield, not tied to any organizer's imagery. */}
    {!bg && <div className="wf-texture"/>}
    <div className="wf-cinematic-frame" aria-hidden="true"/><div className="wf-cinematic-pattern" aria-hidden="true"/>
    <div className="wf-glow one"/><div className="wf-glow two"/>
    <header><span>{config.eyebrow || type.replaceAll('_', ' ')}</span>{config.logo ? <img src={config.logo} alt=""/> : <b className="wf-brandmark">festio.events™</b>}</header>
    <main>
      {['hero', 'closing', 'custom_message'].includes(type) && <><h1>{title}</h1>{step.subtitle && <p>{step.subtitle}</p>}{config.lines?.length > 0 && <div className="wf-keywords">{config.lines.map((line) => <b key={line}>{line}</b>)}</div>}</>}
      {['poll', 'multi_select', 'rating'].includes(type) && !showingResults && <><h2>{title}</h2><p className="wf-poll-instruction">{step.subtitle || (type === 'multi_select' ? `Choose up to ${config.max_selections || 3}` : 'Choose one response')}</p><div className="wf-options">{options.map((option, index) => <div key={option.id || option.label || option} style={{ '--option': COLORS[index % COLORS.length] }}><i className="wf-option-icon">{option.icon || optionIcon(option.label || option, index)}</i><b>{option.label || option}</b></div>)}</div></>}
      {(['poll_results'].includes(type) || showingResults) && <><span className="wf-results-label">LIVE RESULTS</span><h2>{title}</h2><ResultsView results={responseData?.results || config.results || []} style={config.result_style || 'bars'}/></>}
      {['quote', 'scripture'].includes(type) && <blockquote>{config.speaker_label && <span className="wf-pill">{config.speaker_label}</span>}<i className="wf-ornament" aria-hidden="true"/><strong dir={config.direction || 'auto'}>{config.original_text || config.quote || title}</strong>{config.translation && <p>{config.translation}</p>}<cite>{config.source_reference || config.attribution}</cite></blockquote>}
      {type === 'video' && (video
        ? <div className="wf-video wf-video-real">{['youtube', 'vimeo'].includes(video.kind) ? <EmbeddedVideo video={video} title={title} runtime={step.runtime} requireActivation={mode === 'display'}/> : <DirectVideo source={video.src} poster={config.poster_url} runtime={step.runtime} requireActivation={mode === 'display'} startSeconds={video.startSeconds}/>} {(step.subtitle || title) && <div className="wf-video-caption"><h2>{title}</h2><p>{step.subtitle}</p></div>}</div>
        : <div className="wf-video"><span>▶</span><div><h2>{title}</h2><p>{step.subtitle || config.context || (mode !== 'display' ? 'No video URL set yet — add one in Step settings.' : '')}</p></div></div>)}
      {['countdown', 'game'].includes(type) && <><h2>{title}</h2><div className="wf-timer-ring"><svg viewBox="0 0 120 120"><circle className="wf-timer-track" cx="60" cy="60" r="54"/><circle className="wf-timer-fill" cx="60" cy="60" r="54" style={{ strokeDasharray: 2 * Math.PI * 54, strokeDashoffset: 2 * Math.PI * 54 * (1 - ringFraction) }}/></svg><b>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</b></div><p>{config.instructions || step.subtitle}</p>{config.prompts?.length > 0 && <div className="wf-prompts">{config.prompts.slice(0, 4).map((prompt, index) => <div key={prompt}><b>{index + 1}</b>{prompt}</div>)}</div>}</>}
      {type === 'word_cloud' && <><h2>{title}</h2>{(responseData?.words || config.words || []).length ? <div className="wf-cloud">{(responseData?.words || config.words || []).map((word, index) => <b key={word.word || word} style={{ color: COLORS[index % COLORS.length], fontSize: `${Math.max(24, 56 - index * 5)}px` }}>{word.word || word}</b>)}</div> : <p className="wf-cloud-empty">Approved audience words will appear here live.</p>}</>}
      {type === 'comparison' && <><h2>{title}</h2><div className="wf-compare">{(responseData?.rows || config.rows || []).map((row, index) => <div key={row.label}><i className="wf-compare-badge" style={{ '--option': COLORS[index % COLORS.length] }}>{row.icon || ''}</i><b>{row.label}</b><span>{row.before}%</span><i className="wf-compare-arrow">→</i><span>{row.after}%</span><strong className={row.change >= 0 ? 'up' : 'down'}>{row.change >= 0 ? '+' : ''}{row.change} pts</strong></div>)}</div><small>How responses changed · denominators shown separately</small></>}
      {type === 'diagram' && (() => {
        // When a diagram is linked to a poll (e.g. "which connection should
        // grow stronger?"), the backend attaches that poll's live results.
        // Match each node to its option by label so the room's actual
        // leading answer gets the strongest visual emphasis, not a static guess.
        const results = responseData?.results || []
        const topPercent = results.reduce((max, item) => Math.max(max, item.percent || 0), 0)
        return <div className="wf-diagram-composition"><div className="wf-diagram-copy"><span className="wf-kicker">{config.kicker || 'A FRAMEWORK FOR THE GOOD LIFE'}</span><h2>{title}</h2>{step.subtitle && <p className="wf-diagram-subtitle">{step.subtitle}</p>}</div><div className="wf-diagram-map">{(config.nodes || []).map((node, index) => {
          const match = results.find((item) => normalizeLabel(item.label) === normalizeLabel(node.match || node.label))
          const strong = Boolean(match && topPercent > 0 && match.percent === topPercent)
          return <div key={node.id} className={`wf-node-${node.area || 'middle'}${strong ? ' wf-node-strong' : ''}`}><span className="wf-diagram-node" style={{ '--node': COLORS[index % COLORS.length] }}>{node.icon && <i>{node.icon}</i>}<b>{node.label}</b>{node.caption && <small>{node.caption}</small>}{match && <em className="wf-diagram-percent">{match.percent}%</em>}</span></div>
        })}</div></div>
      })()}
      {type === 'prompt' && <><h2>{title}</h2><p>{config.prompt || step.subtitle}</p></>}
      {type === 'big_number' && <><h2>{title}</h2><div className="wf-bignum">{(responseData?.metrics || config.metrics || []).map((metric, index) => <div key={metric.label} style={{ '--option': COLORS[index % COLORS.length] }}><b>{metric.value}</b><span>{metric.label}</span></div>)}</div>{config.footer_line && <p className="wf-bignum-footer">{config.footer_line}</p>}</>}
    </main>
    {eventId && NEEDS_JOIN.has(type) && !showingResults && <div className="wf-join"><img src={`/api/events/${encodeURIComponent(eventId)}/live/join-qr.png`} alt="QR code to join Festio Live"/><div><small>Scan to vote</small><strong>{joinCode ? `${joinHost}/l/${joinCode}` : `${joinHost}/l`}</strong>{joinCode && <span>Code: {joinCode}</span>}</div></div>}
    <footer><span>{config.footer || step.theme?.event_line || 'FESTIO LIVE'}</span>{responseData?.response_count != null && <b>{responseData.response_count} responses</b>}</footer>
  </section>
}
