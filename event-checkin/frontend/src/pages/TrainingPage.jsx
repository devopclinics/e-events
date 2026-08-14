import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import './TrainingPage.css'

const flatten = course => course?.modules.flatMap(module => module.lessons.map(lesson => ({ ...lesson, moduleTitle: module.title }))) || []

export default function TrainingPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [manage, setManage] = useState(null)
  const [tab, setTab] = useState('learn')
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [audit, setAudit] = useState([])
  const [releases, setReleases] = useState([])
  const lessons = useMemo(() => flatten(data?.course), [data])

  async function load() {
    try {
      const next = await api.trainingMe()
      setData(next)
      if (!selected) setSelected(flatten(next.course).find(x => !next.progress[x.key]) || flatten(next.course)[0])
      if (next.can_manage) { setManage(await api.trainingPeople(next.organization.id)); setAudit(await api.trainingAudit(next.organization.id)) }
      if (user?.is_platform_superadmin) setReleases(await api.trainingReleases())
    } catch (error) { setMessage(error.message) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIndex = lessons.findIndex(x => x.key === selected?.key)
  const previousDone = selectedIndex <= 0 || data?.progress[lessons[selectedIndex - 1]?.key]?.status === 'completed'
  const completed = data?.completed_count || 0
  const percent = data ? Math.round(completed * 100 / data.course.lesson_count) : 0

  async function submitQuiz() {
    setBusy(true); setMessage('')
    try {
      const result = await api.trainingQuiz(selected.key, answers, data.organization.id)
      setMessage(result.passed ? `Passed with ${result.score}%. Progress saved.` : `Score: ${result.score}%. Review the lesson and try again.`)
      setAnswers([]); await load()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function submitEvidence() {
    if (!evidence.trim()) return
    setBusy(true)
    try { await api.trainingPractical(selected.key, { note: evidence }, data.organization.id); setEvidence(''); setMessage('Practice evidence sent to your manager.'); await load() }
    catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function assign(ids) {
    if (!ids.length) return
    setBusy(true)
    try { await api.trainingAssign({ user_ids: ids, org_id: data.organization.id }); setMessage(`Assigned to ${ids.length} team member(s).`); await load() }
    catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function review(id, status) {
    setBusy(true)
    try { await api.trainingReview(id, { status }, data.organization.id); await load() }
    catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function remind(ids) {
    if (!ids.length) return
    setBusy(true); try { const result = await api.trainingReminders({ user_ids: ids, org_id: data.organization.id }); setMessage(`${result.sent} reminder email(s) sent.`); await load() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  async function changeDue(person, value) {
    setBusy(true); try { await api.trainingDueDate(person.assignment.id, value ? `${value}T23:59:00` : null, data.organization.id); setMessage('Due date saved.'); await load() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  function exportCsv() {
    const rows = [['Name','Email','Role','Completed','Total','Status'], ...(manage?.people || []).map(p => [p.name,p.email,p.role,p.completed_count,manage.lesson_count,p.assignment?.status || 'not assigned'])]
    const csv = rows.map(row => row.map(x => `"${String(x).replaceAll('"','""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'festio-training-progress.csv'; a.click(); URL.revokeObjectURL(a.href)
  }

  if (!data) return <main className="training-loading">Loading Festio Academy…{message && <p>{message}</p>}</main>
  return <main className="training-page">
    <header className="training-hero">
      <div><span className="training-kicker">FESTIO ACADEMY · VERSION {data.course.version}</span><h1>{data.course.title}</h1><p>{data.course.description}</p></div>
      <div className="training-score"><strong>{percent}%</strong><span>{completed} of {data.course.lesson_count} lessons</span></div>
    </header>
    <div className="training-progress"><span style={{ width: `${percent}%` }} /></div>
    <nav className="training-tabs">
      <button className={tab === 'learn' ? 'active' : ''} onClick={() => setTab('learn')}>My learning</button>
      {data.can_manage && <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>Team progress</button>}
    </nav>
    {message && <div className="training-message" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}

    {tab === 'learn' ? <div className="training-layout">
      <aside className="training-catalog">
        {data.course.modules.map(module => <section key={module.key}><h2>{module.title}</h2>{module.lessons.map((lesson, i) => {
          const done = data.progress[lesson.key]?.status === 'completed'
          const globalIndex = lessons.findIndex(x => x.key === lesson.key)
          const locked = globalIndex > 0 && data.progress[lessons[globalIndex - 1].key]?.status !== 'completed'
          return <button key={lesson.key} className={`${selected?.key === lesson.key ? 'selected' : ''} ${done ? 'done' : ''}`} onClick={() => { setSelected(lesson); setAnswers([]); setMessage('') }}>
            <span>{done ? '✓' : locked ? '🔒' : lesson.order}</span><div><strong>{lesson.title}</strong><small>{lesson.duration_minutes} min</small></div>
          </button>
        })}</section>)}
      </aside>
      <article className="training-lesson">
        <div className="lesson-meta">{selected.moduleTitle || data.course.modules.find(m => m.lessons.some(x => x.key === selected.key))?.title} · Lesson {selected.order}</div>
        <h2>{selected.title}</h2>
        <p className="lesson-objective">{selected.objective}</p>
        <img src={selected.image_url} alt={`${selected.title} training guide`} />
        <section><h3>Why it matters</h3><p>{selected.why_it_matters}</p></section>
        <section><h3>Before you begin</h3><ul>{selected.prerequisites.map(x => <li key={x}>{x}</li>)}</ul></section>
        <section><h3>Guided workflow</h3><ol>{selected.steps.map(x => <li key={x}>{x}</li>)}</ol></section>
        <section className="lesson-warning"><h3>Common mistakes</h3><ul>{selected.common_mistakes.map(x => <li key={x}>{x}</li>)}</ul></section>
        <section><h3>Knowledge check</h3>{!previousDone ? <p className="locked-note">Complete the previous lesson to unlock this assessment.</p> : selected.quiz.map((q, qi) => <fieldset key={q.question}><legend>{qi + 1}. {q.question}</legend>{q.options.map((option, oi) => <label key={option}><input type="radio" name={`q-${qi}`} checked={answers[qi] === oi} onChange={() => setAnswers(old => { const next = [...old]; next[qi] = oi; return next })}/>{option}</label>)}</fieldset>)}
          <button className="primary" disabled={busy || !previousDone || answers.filter(x => x !== undefined).length !== selected.quiz.length} onClick={submitQuiz}>{data.progress[selected.key]?.status === 'completed' ? 'Retake quiz' : 'Submit assessment'}</button>
        </section>
        <section className="practice"><h3>Practical exercise</h3><p>{selected.practical}</p><textarea value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Describe what you practiced, the result, and any evidence link…"/><button disabled={busy || evidence.trim().length < 3} onClick={submitEvidence}>Submit evidence</button></section>
        {data.progress[selected.key]?.status === 'completed' && selectedIndex < lessons.length - 1 && <button className="next" onClick={() => { setSelected(lessons[selectedIndex + 1]); setAnswers([]); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Next lesson →</button>}
      </article>
    </div> : <section className="training-manager">
      <div className="manager-head"><div><h2>{manage?.organization.name} training</h2><p>Assign training, track completion, review practice, and export evidence.</p></div><div><button onClick={exportCsv}>Export CSV</button><button disabled={busy} onClick={() => remind((manage?.people || []).filter(p => p.assignment && p.assignment.status !== 'completed').map(p => p.id))}>Remind incomplete</button><button className="primary" disabled={busy} onClick={() => assign((manage?.people || []).filter(p => !p.assignment).map(p => p.id))}>Assign all unassigned</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Team member</th><th>Role</th><th>Progress</th><th>Status</th><th>Due date</th><th>Action</th></tr></thead><tbody>{manage?.people.map(person => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.email}</small></td><td>{person.role}</td><td>{person.completed_count}/{manage.lesson_count}<div className="mini-progress"><i style={{width:`${person.completed_count * 100/manage.lesson_count}%`}}/></div></td><td>{person.assignment?.status || 'Not assigned'}</td><td>{person.assignment ? <input type="date" aria-label={`Due date for ${person.name}`} defaultValue={person.assignment.due_at?.slice(0,10) || ''} onBlur={e => changeDue(person, e.target.value)}/> : '—'}</td><td className="action-cell">{person.assignment ? <><button disabled={busy} onClick={() => remind([person.id])}>Remind</button><button disabled={busy} onClick={async () => { if (confirm(`Reset all progress for ${person.name}?`)) { await api.trainingReset(person.id, data.organization.id); await load() } }}>Reset</button></> : <button disabled={busy} onClick={() => assign([person.id])}>Assign</button>}</td></tr>)}</tbody></table></div>
      <h2>Practical reviews</h2>{manage?.pending_practicals.length ? manage.pending_practicals.map(item => <div className="review-card" key={item.id}><div><strong>{manage.people.find(p => p.id === item.user_id)?.name}</strong><span>{lessons.find(x => x.key === item.lesson_key)?.title}</span><p>{item.evidence.note}</p></div><div><button disabled={busy} onClick={() => review(item.id, 'rejected')}>Needs work</button><button className="primary" disabled={busy} onClick={() => review(item.id, 'approved')}>Approve</button></div></div>) : <p className="empty">No practical submissions awaiting review.</p>}
      <h2>Training audit</h2><div className="audit-list">{audit.length ? audit.slice(0,50).map(item => <div key={item.id}><strong>{item.actor}</strong><span>{item.action.replaceAll('_',' ')}</span><time>{new Date(item.created_at).toLocaleString()}</time></div>) : <p className="empty">No training activity yet.</p>}</div>
      {user?.is_platform_superadmin && <section className="release-admin"><h2>Course releases</h2><p>Create an immutable draft snapshot before changing curriculum. Publishing preserves prior versions.</p><button onClick={async () => { const title = prompt('Release title'); if (title) { await api.trainingCreateRelease(title); await load() } }}>Create draft snapshot</button>{releases.map(release => <div key={release.id}><strong>Version {release.version}: {release.title}</strong><span>{release.status}</span>{release.status === 'draft' && <button onClick={async () => { await api.trainingPublishRelease(release.id); await load() }}>Publish</button>}</div>)}</section>}
    </section>}
    {data.certificate_pending_practical && <div className="training-message">All lessons are complete. Your certificate will be issued after a manager approves one practical submission.</div>}
    {data.certificate && <section className="certificate"><span>Certificate of completion</span><h2>{data.certificate.name}</h2><p>Completed {data.course.title}</p><strong>{data.certificate.id}</strong><button onClick={() => window.print()}>Print certificate</button></section>}
    <footer className="training-footer">Need help? <a href="mailto:support@festio.events">support@festio.events</a> · <a href="https://festio.events">festio.events</a></footer>
  </main>
}
