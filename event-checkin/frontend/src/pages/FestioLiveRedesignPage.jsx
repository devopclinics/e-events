import { useEffect, useState } from 'react'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'

const TABS = ['Activities', 'Question Bank', 'Settings']

const ACTIVITY_TYPES = [
  ['quiz', 'Quiz'], ['poll', 'Poll'], ['rating', 'Rating'], ['feedback', 'Feedback'],
]
const QUESTION_TYPES = [
  ['single_choice', 'Single choice'], ['multiple_choice', 'Multiple choice'],
  ['yes_no', 'Yes / No'], ['rating_5', 'Rating (5)'], ['short_text', 'Open text'],
]
const STATUS_TONE = { draft: 'neutral', scheduled: 'info', live: 'ok', paused: 'warn', closed: 'neutral', completed: 'ok', archived: 'neutral' }

function StatusChip({ status }) {
  const tone = STATUS_TONE[status] || 'neutral'
  const bg = { ok: '#e7f6ee', info: '#eaf0ff', warn: '#fbf1de', neutral: '#eee' }[tone]
  const fg = { ok: '#1f8a5f', info: '#2f6fed', warn: '#b5790a', neutral: '#666' }[tone]
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.03em' }}>{status}</span>
}

export default function FestioLiveRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event, loading: eventLoading } = useEventDetails(eventId)
  const [tab, setTab] = useState('Activities')

  const [activities, setActivities] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newActivity, setNewActivity] = useState({ type: 'quiz', title: '' })
  const [selected, setSelected] = useState(null) // full activity, with questions
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)

  const [bank, setBank] = useState(null)
  const [newBankItem, setNewBankItem] = useState({ question_type: 'single_choice', prompt: '', options: ['', ''] })

  const [newQuestion, setNewQuestion] = useState({ question_type: 'single_choice', prompt: '', options: ['', ''] })

  const enabled = !!event?.engagement_enabled

  async function loadActivities() {
    if (!eventId || !enabled) return
    try { setActivities(await api.liveActivities(eventId)) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { loadActivities() }, [eventId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBank() {
    if (!eventId || !enabled) return
    try { setBank(await api.liveQuestionBank(eventId)) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { if (tab === 'Question Bank') loadBank() }, [tab, eventId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openActivity(id) {
    setError(''); setResults(null)
    try {
      const full = await api.liveGetActivity(eventId, id)
      setSelected(full)
    } catch (e) { setError(e.message) }
  }

  async function createActivity() {
    if (!newActivity.title.trim()) return
    setBusy(true); setError('')
    try {
      const created = await api.liveCreateActivity(eventId, newActivity)
      setNewActivity({ type: 'quiz', title: '' })
      setCreating(false)
      await loadActivities()
      await openActivity(created.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function setStatus(status) {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveUpdateActivity(eventId, selected.id, { status })
      setSelected(updated)
      await loadActivities()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function addQuestion() {
    if (!selected || !newQuestion.prompt.trim()) return
    setBusy(true); setError('')
    try {
      const needsOptions = ['single_choice', 'multiple_choice'].includes(newQuestion.question_type)
      const body = {
        question_type: newQuestion.question_type,
        prompt: newQuestion.prompt,
        sequence: selected.questions.length,
        options: needsOptions ? newQuestion.options.filter((o) => o.trim()).map((label) => ({ label })) : [],
      }
      await api.liveAddQuestion(eventId, selected.id, body)
      setNewQuestion({ question_type: 'single_choice', prompt: '', options: ['', ''] })
      await openActivity(selected.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function deleteQuestion(qid) {
    setBusy(true); setError('')
    try { await api.liveDeleteQuestion(eventId, qid); await openActivity(selected.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function viewResults() {
    if (!selected) return
    try { setResults(await api.liveResults(eventId, selected.id)) }
    catch (e) { setError(e.message) }
  }

  async function createBankItem() {
    if (!newBankItem.prompt.trim()) return
    setBusy(true); setError('')
    try {
      const needsOptions = ['single_choice', 'multiple_choice'].includes(newBankItem.question_type)
      await api.liveCreateBankItem(eventId, {
        question_type: newBankItem.question_type, prompt: newBankItem.prompt,
        options: needsOptions ? newBankItem.options.filter((o) => o.trim()).map((label) => ({ label })) : [],
      })
      setNewBankItem({ question_type: 'single_choice', prompt: '', options: ['', ''] })
      await loadBank()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function importFromBank(itemId) {
    if (!selected) return
    setBusy(true); setError('')
    try { await api.liveImportBankItem(eventId, selected.id, itemId); await openActivity(selected.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (eventId && !eventLoading && !enabled) {
    return (
      <RedesignShell topActive="live" withEventSidebar eventActive="live">
        <div className="rr-pagehead"><div><div className="rr-title-row"><h1>Festio Live</h1></div></div></div>
        <div className="rr-panel rr-locked">
          <div className="rd-panel-body">
            <span className="rr-locked-badge"><Icon name="lock" size={11} /> Not enabled</span>
            <h3 style={{ marginTop: 8 }}>Festio Live isn't turned on for this event</h3>
            <p className="rd-hint">Live quizzes, polls, ratings and feedback guests join from their phone live here once the Festio Live add-on is enabled.</p>
            <a className="rr-btn primary rr-locked-cta" href="/communications-redesign?tab=settings">Enable Festio Live</a>
          </div>
        </div>
      </RedesignShell>
    )
  }

  return (
    <RedesignShell topActive="live" withEventSidebar eventActive="live">
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Festio Live</h1></div>
          <div className="rr-meta">Live quizzes, polls, ratings & feedback</div>
        </div>
      </div>

      {error && <div style={{ background: '#fbe9e7', color: '#a3271e', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14 }}><Icon name="info" size={14} /> {error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--rr-line, #e6e2d3)' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => { setTab(t); setSelected(null) }}
            style={{ fontWeight: 700, fontSize: 13, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', color: tab === t ? 'var(--rr-brand, #0b3b2e)' : '#8b978d', borderBottom: tab === t ? '2px solid var(--rr-brand, #0b3b2e)' : '2px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Activities' && !selected && (
        <div className="rr-panel">
          <div className="rd-panel-head">
            <h3>Activities</h3>
            <button className="rr-btn primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New Activity'}</button>
          </div>
          <div className="rd-panel-body">
            {creating && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label className="rd-field-label">Type</label>
                  <select className="rr-select" value={newActivity.type} onChange={(e) => setNewActivity((v) => ({ ...v, type: e.target.value }))}>
                    {ACTIVITY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="rd-field-label">Title</label>
                  <input className="rr-input" value={newActivity.title} onChange={(e) => setNewActivity((v) => ({ ...v, title: e.target.value }))} placeholder="e.g. Leadership Poll" />
                </div>
                <button className="rr-btn primary" disabled={busy || !newActivity.title.trim()} onClick={createActivity}>{busy ? 'Creating…' : 'Create'}</button>
              </div>
            )}
            {activities === null ? <p className="rd-hint">Loading…</p> : activities.length === 0 ? (
              <p className="rd-hint">No activities yet — create your first quiz, poll, or feedback form above.</p>
            ) : activities.map((a) => (
              <div key={a.id} onClick={() => openActivity(a.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rr-line, #eee)', cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: '#5b6a5c', textTransform: 'capitalize' }}>{a.type}</div>
                </div>
                <div style={{ fontSize: 12, color: '#5b6a5c' }}>{a.response_count} responses</div>
                <StatusChip status={a.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'Activities' && selected && (
        <div>
          <button className="rr-link-btn" style={{ marginBottom: 10 }} onClick={() => { setSelected(null); setResults(null) }}>← All activities</button>
          <div className="rr-panel">
            <div className="rd-panel-head">
              <div><h3>{selected.title}</h3><p style={{ margin: 0, fontSize: 12, color: '#5b6a5c', textTransform: 'capitalize' }}>{selected.type}</p></div>
              <StatusChip status={selected.status} />
            </div>
            <div className="rd-panel-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {selected.status === 'draft' && <button className="rr-btn primary" disabled={busy} onClick={() => setStatus('live')}>Go Live</button>}
                {selected.status === 'live' && <button className="rr-btn" disabled={busy} onClick={() => setStatus('paused')}>Pause</button>}
                {selected.status === 'paused' && <button className="rr-btn primary" disabled={busy} onClick={() => setStatus('live')}>Resume</button>}
                {['live', 'paused'].includes(selected.status) && <button className="rr-btn" disabled={busy} onClick={() => setStatus('closed')}>Close</button>}
                <button className="rr-btn secondary" onClick={viewResults}>View Results</button>
              </div>

              <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: '#5b6a5c', margin: '0 0 10px' }}>Questions</h4>
              {selected.questions.length === 0 && <p className="rd-hint">No questions yet — add one below.</p>}
              {selected.questions.map((q, i) => (
                <div key={q.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{i + 1}. {q.prompt}</div>
                      <div style={{ fontSize: 11.5, color: '#8b978d', textTransform: 'capitalize' }}>{q.question_type.replace('_', ' ')}</div>
                    </div>
                    <button className="rr-link-btn gr-danger-link" onClick={() => deleteQuestion(q.id)}>Remove</button>
                  </div>
                  {q.options.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12.5, color: '#5b6a5c' }}>
                      {q.options.map((o) => <li key={o.id}>{o.label}</li>)}
                    </ul>
                  )}
                </div>
              ))}

              <div style={{ marginTop: 16, padding: 14, background: '#f7f6f0', borderRadius: 10 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <select className="rr-select" value={newQuestion.question_type} onChange={(e) => setNewQuestion((v) => ({ ...v, question_type: e.target.value }))}>
                    {QUESTION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input className="rr-input" style={{ flex: 1, minWidth: 200 }} placeholder="Question prompt" value={newQuestion.prompt} onChange={(e) => setNewQuestion((v) => ({ ...v, prompt: e.target.value }))} />
                </div>
                {['single_choice', 'multiple_choice'].includes(newQuestion.question_type) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {newQuestion.options.map((opt, idx) => (
                      <input key={idx} className="rr-input" placeholder={`Option ${idx + 1}`} value={opt}
                        onChange={(e) => setNewQuestion((v) => ({ ...v, options: v.options.map((o, i2) => i2 === idx ? e.target.value : o) }))} />
                    ))}
                    <button className="rr-link-btn" onClick={() => setNewQuestion((v) => ({ ...v, options: [...v.options, ''] }))}>+ Add option</button>
                  </div>
                )}
                <button className="rr-btn primary" disabled={busy || !newQuestion.prompt.trim()} onClick={addQuestion}>{busy ? 'Adding…' : 'Add Question'}</button>
              </div>

              {results && (
                <div style={{ marginTop: 20 }}>
                  <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: '#5b6a5c', margin: '0 0 10px' }}>
                    Results — {results.participant_count} participants, {results.response_count} responses
                  </h4>
                  {results.questions.map((qr) => (
                    <div key={qr.question_id} style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{qr.prompt}</div>
                      <div style={{ fontSize: 12, color: '#5b6a5c' }}>{qr.response_count} responses{qr.average_rating != null ? ` · avg ${qr.average_rating.toFixed(1)}` : ''}</div>
                      {Object.keys(qr.option_counts).length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#5b6a5c' }}>
                          {Object.entries(qr.option_counts).map(([optId, count]) => <div key={optId}>{count} response(s)</div>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'Question Bank' && (
        <div className="rr-panel">
          <div className="rd-panel-head"><h3>Question Bank</h3><p>Reusable across activities and events</p></div>
          <div className="rd-panel-body">
            <div style={{ padding: 14, background: '#f7f6f0', borderRadius: 10, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <select className="rr-select" value={newBankItem.question_type} onChange={(e) => setNewBankItem((v) => ({ ...v, question_type: e.target.value }))}>
                  {QUESTION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input className="rr-input" style={{ flex: 1, minWidth: 200 }} placeholder="Question prompt" value={newBankItem.prompt} onChange={(e) => setNewBankItem((v) => ({ ...v, prompt: e.target.value }))} />
              </div>
              {['single_choice', 'multiple_choice'].includes(newBankItem.question_type) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {newBankItem.options.map((opt, idx) => (
                    <input key={idx} className="rr-input" placeholder={`Option ${idx + 1}`} value={opt}
                      onChange={(e) => setNewBankItem((v) => ({ ...v, options: v.options.map((o, i2) => i2 === idx ? e.target.value : o) }))} />
                  ))}
                  <button className="rr-link-btn" onClick={() => setNewBankItem((v) => ({ ...v, options: [...v.options, ''] }))}>+ Add option</button>
                </div>
              )}
              <button className="rr-btn primary" disabled={busy || !newBankItem.prompt.trim()} onClick={createBankItem}>{busy ? 'Saving…' : '+ New Question'}</button>
            </div>
            {bank === null ? <p className="rd-hint">Loading…</p> : bank.length === 0 ? (
              <p className="rd-hint">No saved questions yet.</p>
            ) : bank.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.prompt}</div>
                  <div style={{ fontSize: 11.5, color: '#8b978d' }}>{item.question_type.replace('_', ' ')} · used {item.usage_count}x</div>
                </div>
                {selected && <button className="rr-btn" disabled={busy} onClick={() => importFromBank(item.id)}>Import</button>}
              </div>
            ))}
            {!selected && <p className="rd-hint" style={{ marginTop: 8 }}>Open an activity from the Activities tab to import a question into it.</p>}
          </div>
        </div>
      )}

      {tab === 'Settings' && (
        <div className="rr-panel">
          <div className="rd-panel-head"><h3>Settings</h3></div>
          <div className="rd-panel-body">
            <p className="rd-hint">
              Live Control (presenter screen), TV/projector displays, real-time results, and leaderboards are shipping in a follow-up pass —
              this first cut covers building activities, questions, a reusable question bank, and guest participation with durable,
              idempotent responses. Roles beyond event admin (Presenter/Moderator/Analyst) are also a follow-up.
            </p>
          </div>
        </div>
      )}
    </RedesignShell>
  )
}
