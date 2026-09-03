import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import WorkflowSceneRenderer from './WorkflowSceneRenderer'
import './ExperienceWorkflowsPanel.css'

const STEP_TYPES = [
  ['hero', 'Hero'], ['poll', 'Poll'], ['poll_results', 'Poll results'], ['video', 'Video'],
  ['quote', 'Quote'], ['scripture', 'Scripture'], ['diagram', 'Diagram'], ['countdown', 'Countdown'],
  ['game', 'Game'], ['word_cloud', 'Word cloud'], ['comparison', 'Before / after'], ['closing', 'Closing'],
]
const INTERACTIVE = new Set(['poll', 'poll_results', 'multi_select', 'rating', 'word_cloud', 'ranking'])
const commandKey = () => `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`
const normalizeVideoUrl = (value = '') => {
  const youtube = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/))([\w-]{6,})/) || value.match(/(?:vid:|vid%3A)([\w-]{6,})/i)
  if (youtube) return `https://www.youtube.com/watch?v=${youtube[1]}`
  const vimeo = value.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return `https://vimeo.com/${vimeo[1]}`
  return value.trim()
}

export default function ExperienceWorkflowsPanel({ eventId, activities = [], displays = [], presenterEntry = false }) {
  const [items, setItems] = useState(null)
  const [workflow, setWorkflow] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)
  const [newName, setNewName] = useState('')
  const [stepType, setStepType] = useState('hero')
  const [run, setRun] = useState(null)
  const [displayId, setDisplayId] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportingPptx, setExportingPptx] = useState(false)
  const [error, setError] = useState('')
  const presenterEntryHandled = useRef(false)

  const loadList = async () => {
    try {
      const loaded = await api.liveWorkflows(eventId)
      setItems(loaded); setError('')
      if (presenterEntry && !presenterEntryHandled.current && loaded.length) {
        presenterEntryHandled.current = true
        const candidates = [...loaded].sort((left, right) => Number(right.status === 'ready') - Number(left.status === 'ready'))
        for (const candidate of candidates) {
          const active = await api.liveActiveWorkflowRun(eventId, candidate.id)
          if (active.run) { await open(candidate.id); return }
        }
        await open(candidates[0].id)
      }
    }
    catch (e) { setItems([]); setError(e.message) }
  }
  const open = async (id) => {
    try {
      const [detail, active] = await Promise.all([api.liveWorkflow(eventId, id), api.liveActiveWorkflowRun(eventId, id)])
      setWorkflow(detail); setSelectedStep(detail.steps[0] || null); setRun(active.run || null); setError('')
    }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { if (eventId) loadList() }, [eventId])
  useEffect(() => {
    if (!run?.id || !['ready', 'live', 'paused'].includes(run.status)) return undefined
    const id = setInterval(async () => {
      try { setRun(await api.liveWorkflowRun(eventId, run.id)) } catch { /* keep last authoritative snapshot */ }
    }, 2000)
    return () => clearInterval(id)
  }, [eventId, run?.id, run?.status])

  const saveStep = async (step, patch) => {
    setBusy(true)
    try {
      const saved = await api.liveUpdateWorkflowStep(eventId, workflow.id, step.id, patch)
      setWorkflow((value) => ({ ...value, draft_version: value.draft_version + 1, steps: value.steps.map((item) => item.id === saved.id ? saved : item) }))
      setSelectedStep(saved)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const addStep = async () => {
    const activity = INTERACTIVE.has(stepType) ? activities.find((item) => item.status !== 'archived') : null
    if (INTERACTIVE.has(stepType) && !activity) { setError('Create an activity before adding this interactive step.'); return }
    setBusy(true)
    try {
      const created = await api.liveAddWorkflowStep(eventId, workflow.id, {
        step_type: stepType, title: STEP_TYPES.find(([key]) => key === stepType)?.[1] || 'New step',
        config: {}, linked_activity_id: activity?.id || null,
      })
      setWorkflow((value) => ({ ...value, draft_version: value.draft_version + 1, steps: [...value.steps, created] }))
      setSelectedStep(created)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const move = async (step, direction) => {
    const current = workflow.steps.findIndex((item) => item.id === step.id)
    const target = current + direction
    if (target < 0 || target >= workflow.steps.length) return
    const next = [...workflow.steps]; [next[current], next[target]] = [next[target], next[current]]
    setBusy(true)
    try {
      const result = await api.liveReorderWorkflowSteps(eventId, workflow.id, next.map((item) => item.id), workflow.draft_version)
      setWorkflow((value) => ({ ...value, draft_version: result.draft_version, steps: next.map((item, index) => ({ ...item, sequence: index })) }))
    } catch (e) { setError(e.message); await open(workflow.id) } finally { setBusy(false) }
  }
  const publish = async () => {
    setBusy(true)
    try { await api.livePublishWorkflow(eventId, workflow.id); await open(workflow.id); await loadList() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  // Steps a headless browser through every published slide server-side, so
  // this routinely takes over a minute -- exportingPptx gets its own state
  // (rather than reusing `busy`) so the button can show its own "Generating…"
  // label instead of just going disabled like a quick save.
  const exportPptx = async () => {
    setExportingPptx(true)
    try { await api.liveExportWorkflowPptx(eventId, workflow.id, workflow.name); setError('') }
    catch (e) { setError(e.message) } finally { setExportingPptx(false) }
  }
  const saveGuestTheme = async (guestPreset) => {
    setBusy(true)
    try {
      const saved = await api.liveUpdateWorkflow(eventId, workflow.id, {
        theme: { ...(workflow.theme || {}), guest_preset: guestPreset },
        expected_version: workflow.draft_version,
      })
      setWorkflow(saved); setError('Guest design saved in the draft. Publish the revision before presenting it.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const startRun = async (selectedDisplayId = '') => {
    setBusy(true)
    try { setRun(await api.liveCreateWorkflowRun(eventId, workflow.id, selectedDisplayId)); setError('') }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const command = async (action, stepId, extra = {}) => {
    setBusy(true)
    try { setRun(await api.liveCommandWorkflowRun(eventId, run.id, { action, step_id: stepId || null, expected_version: run.state_version, idempotency_key: commandKey(), ...extra })) }
    catch (e) { setError(e.message); try { setRun(await api.liveWorkflowRun(eventId, run.id)) } catch {} } finally { setBusy(false) }
  }
  const activeStep = useMemo(() => run?.current_step || selectedStep || workflow?.steps?.[0], [run, selectedStep, workflow])

  const [clock, setClock] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(id) }, [])
  const elapsed = run ? (run.elapsed_seconds || 0) + (run.status === 'live' && run.server_now ? Math.max(0, Math.floor((clock - new Date(run.server_now).getTime()) / 1000)) : 0) : 0
  const timer = run?.runtime?.timer

  if (items === null) return <div className="wf-loading">Loading experiences…</div>
  if (!workflow) return <section className="wf-builder wf-library">
    <header><div><span>GUIDED LIVE EXPERIENCES</span><h2>Experience Workflows</h2><p>Build a reusable run-of-show that keeps the presenter, audience, and screens synchronized.</p></div><div className="wf-create"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Experience name"/><button disabled={!newName.trim() || busy} onClick={async () => { setBusy(true); try { const created = await api.liveCreateWorkflow(eventId, { name: newName.trim(), theme: { preset: 'festio_dark' } }); setNewName(''); await loadList(); await open(created.id) } catch (e) { setError(e.message) } finally { setBusy(false) } }}>Create experience</button></div></header>
    {error && <div className="wf-error">{error}</div>}
    <div className="wf-cards">{items.map((item) => <button key={item.id} onClick={() => open(item.id)}><span className={`wf-status ${item.status}`}>{item.status}</span><h3>{item.name}</h3><p>{item.description || 'A guided interactive experience'}</p><footer><b>{item.step_count} steps</b><span>Open builder →</span></footer></button>)}{!items.length && <div className="wf-empty"><b>No experiences yet</b><span>Create the first reusable guided experience above.</span></div>}</div>
  </section>

  return <section className="wf-builder">
    <div className="wf-builder-top"><button onClick={() => { setWorkflow(null); setRun(null) }}>← Experiences</button><div><span>{run ? `PRESENTER · ${run.status}` : 'EXPERIENCE BUILDER'}</span><h2>{workflow.name}</h2></div><div>{!run && <><label className="wf-theme-choice">Guest design<select aria-label="Guest experience design" value={workflow.theme?.guest_preset || 'cinematic'} disabled={busy} onChange={(event) => saveGuestTheme(event.target.value)}><option value="cinematic">A · Cinematic</option><option value="community">B · Community</option><option value="pulse">C · Modern Pulse</option></select></label><button type="button" title="Copy the short presenter entry" onClick={async () => { const url = `${window.location.origin}/live?present=1`; await navigator.clipboard?.writeText(url); setError('Presenter link copied: ' + url) }}>Copy presenter link</button><button disabled={busy || !workflow.steps.length} onClick={publish}>Publish revision</button><button disabled={busy || exportingPptx || workflow.status !== 'ready'} title="Screenshots every published slide and bundles it into a PowerPoint, with your presenter notes on each slide" onClick={exportPptx}>{exportingPptx ? 'Generating PPTX…' : '⬇ Generate PPTX'}</button><button className="rehearse" disabled={busy || workflow.status !== 'ready'} onClick={() => startRun('')}>▶ Rehearse safely</button><select aria-label="Projector display" value={displayId} onChange={(event) => setDisplayId(event.target.value)}><option value="">Choose projector display…</option>{displays.map((display) => <option key={display.id} value={display.id}>{display.name}</option>)}</select><button className="primary" disabled={busy || workflow.status !== 'ready' || !displayId} onClick={() => startRun(displayId)}>Present on display</button></>}{run && <button onClick={() => setRun(null)}>Exit presenter</button>}</div></div>
    {error && <div className="wf-error">{error}</div>}
    <div className="wf-workspace">
      <aside className="wf-timeline">
        <header><b>Run of show</b><span>{workflow.steps.length} steps</span></header>
        {workflow.steps.map((step, index) => <button key={step.id} className={(run?.current_step_id === step.id || (!run && selectedStep?.id === step.id)) ? 'active' : ''} onClick={() => run ? command('jump', step.id) : setSelectedStep(step)}><span>{String(index + 1).padStart(2, '0')}</span><i>{step.step_type.replaceAll('_', ' ')}</i><b>{step.title}</b>{!run && <em><i role="button" tabIndex="0" aria-label="Move up" onClick={(event) => { event.stopPropagation(); move(step, -1) }}>↑</i><i role="button" tabIndex="0" aria-label="Move down" onClick={(event) => { event.stopPropagation(); move(step, 1) }}>↓</i></em>}</button>)}
        {!run && <div className="wf-add-step"><select value={stepType} onChange={(event) => setStepType(event.target.value)}>{STEP_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button disabled={busy} onClick={addStep}>+ Add</button></div>}
      </aside>
      <div className="wf-stage"><WorkflowSceneRenderer key={activeStep?.id} step={activeStep} mode="presenter" eventId={eventId}/>{run && <><div className="wf-presenter-bar"><div><span>Elapsed</span><b>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</b></div><button type="button" onClick={() => document.querySelector('.wf-stage .wf-scene')?.requestFullscreen?.()}>⛶ Full screen</button><button disabled={busy || run.status === 'ready'} onClick={() => command('previous')}>← Previous</button>{run.status === 'ready' && <button className="primary" disabled={busy} onClick={() => command('start')}>Start experience</button>}{run.status === 'live' && <button onClick={() => command('pause')}>Pause</button>}{run.status === 'paused' && <button onClick={() => command('resume')}>Resume</button>}<button className="primary" disabled={busy || run.status === 'ready'} onClick={() => command('next')}>Next →</button><button disabled={busy || !['live', 'paused'].includes(run.status)} onClick={() => command('complete')}>Finish</button></div>{['poll', 'multi_select', 'rating', 'ranking'].includes(activeStep?.step_type) && <div className="wf-presenter-bar wf-media-controls"><b>Audience poll · {activeStep?.data?.response_count || 0} responses</b>{activeStep?.display_phase === 'results' ? <button className="primary" onClick={() => command('reopen_voting')}>Reopen voting</button> : <button className="primary" onClick={() => command('reveal_results')}>Close voting & reveal results</button>}</div>}{['countdown', 'game'].includes(activeStep?.step_type) && <div className="wf-presenter-bar wf-media-controls"><b>Timer · {timer?.status || 'ready'}</b>{['ready', 'complete'].includes(timer?.status) && <button className="primary" onClick={() => command('timer_start')}>Start timer</button>}{timer?.status === 'running' && <button onClick={() => command('timer_pause')}>Pause timer</button>}{timer?.status === 'paused' && <button onClick={() => command('timer_resume')}>Resume timer</button>}<button onClick={() => command('timer_reset')}>Reset</button><button onClick={() => command('timer_add', null, { seconds: 30 })}>+30 sec</button></div>}{activeStep?.step_type === 'video' && <div className="wf-presenter-bar wf-media-controls"><b>Projector video</b><button className="primary" onClick={() => command('video_play')}>Play</button><button onClick={() => command('video_pause')}>Pause</button><button onClick={() => command('video_restart')}>Restart</button></div>}</>}{run?.current_step?.presenter_notes && <div className="wf-notes"><b>Presenter note</b>{run.current_step.presenter_notes}</div>}</div>
      {!run && selectedStep && <aside className="wf-inspector"><h3>Step settings</h3><label>Title<input value={selectedStep.title} onChange={(event) => setSelectedStep({ ...selectedStep, title: event.target.value })} onBlur={() => saveStep(selectedStep, { title: selectedStep.title })}/></label><label>Subtitle<textarea value={selectedStep.subtitle || ''} onChange={(event) => setSelectedStep({ ...selectedStep, subtitle: event.target.value })} onBlur={() => saveStep(selectedStep, { subtitle: selectedStep.subtitle || null })}/></label>{INTERACTIVE.has(selectedStep.step_type) && <label>Linked activity<select value={selectedStep.linked_activity_id || ''} onChange={(event) => saveStep(selectedStep, { linked_activity_id: event.target.value || null })}>{activities.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}{['poll', 'multi_select', 'rating', 'ranking', 'poll_results'].includes(selectedStep.step_type) && <label>Result display style<select value={selectedStep.config?.result_style || 'bars'} onChange={(event) => saveStep(selectedStep, { config: { ...selectedStep.config, result_style: event.target.value } })}><option value="bars">Horizontal bars</option><option value="donut">Donut chart</option><option value="ranking">Ranked list</option><option value="winner">Winner spotlight</option><option value="split">Proportional split</option></select></label>}{selectedStep.step_type === 'video' && <><label>Video URL<input value={selectedStep.config?.video_url || ''} placeholder="Paste a YouTube, Vimeo, or direct MP4 link" onChange={(event) => setSelectedStep({ ...selectedStep, config: { ...selectedStep.config, video_url: event.target.value } })} onBlur={() => { const video_url = normalizeVideoUrl(selectedStep.config?.video_url || ''); setSelectedStep((value) => ({ ...value, config: { ...value.config, video_url } })); saveStep(selectedStep, { config: { ...selectedStep.config, video_url: video_url || null } }) }}/><small>Google search-result links are automatically converted to the underlying YouTube video when possible.</small></label><label>Poster image URL<input value={selectedStep.config?.poster_url || ''} placeholder="https://..." onChange={(event) => setSelectedStep({ ...selectedStep, config: { ...selectedStep.config, poster_url: event.target.value } })} onBlur={() => saveStep(selectedStep, { config: { ...selectedStep.config, poster_url: selectedStep.config?.poster_url || null } })}/></label></>}<label>Duration (seconds)<input type="number" min="1" value={selectedStep.duration_seconds || ''} onChange={(event) => setSelectedStep({ ...selectedStep, duration_seconds: Number(event.target.value) || null })} onBlur={() => saveStep(selectedStep, { duration_seconds: selectedStep.duration_seconds })}/></label><label className="wf-check"><input type="checkbox" checked={selectedStep.auto_advance} onChange={(event) => saveStep(selectedStep, { auto_advance: event.target.checked })}/> Auto advance</label><label>Private presenter notes<textarea value={selectedStep.presenter_notes || ''} onChange={(event) => setSelectedStep({ ...selectedStep, presenter_notes: event.target.value })} onBlur={() => saveStep(selectedStep, { presenter_notes: selectedStep.presenter_notes || null })}/></label><button className="danger" disabled={busy} onClick={async () => { if (!window.confirm('Delete this step?')) return; await api.liveDeleteWorkflowStep(eventId, workflow.id, selectedStep.id); await open(workflow.id) }}>Delete step</button></aside>}
    </div>
  </section>
}
