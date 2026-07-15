import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

function visible(question, answers) {
  const condition = question.show_if
  if (!condition?.question_id) return true
  const value = answers[condition.question_id]
  return Array.isArray(value)
    ? value.map(String).includes(String(condition.value))
    : String(value ?? '').toLowerCase() === String(condition.value).toLowerCase()
}

export default function FeedbackForms({ eventId, token, onSubmitted }) {
  const [forms, setForms] = useState([])
  const [answers, setAnswers] = useState({})
  const [editing, setEditing] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!eventId || !token) return
    try {
      const data = await api.guestFeedback(eventId, token)
      setForms(data.forms || [])
      setAnswers(Object.fromEntries((data.forms || []).map((form) => [form.step_id, form.answers || {}])))
    } catch { setForms([]) }
  }, [eventId, token])

  useEffect(() => { load() }, [load])
  if (!forms.length) return null

  async function submit(e, form) {
    e.preventDefault(); setBusy(form.step_id); setError('')
    try {
      await api.submitGuestFeedback(eventId, token, { step_id: form.step_id, answers: answers[form.step_id] || {} })
      setEditing(''); await load(); onSubmitted?.()
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  return <div id="feedback" className="space-y-4">
    {forms.map((form) => {
      const hasQuestions = Array.isArray(form.questions) && form.questions.length > 0
      const external = form.external_form || null
      const hasExternal = !!external?.url
      const canEmbed = !!(external?.embed_allowed && external?.embed_url)
      return <section key={form.step_id} className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 text-slate-100">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{form.title}</h2>{form.description && <p className="mt-1 text-sm text-slate-400">{form.description}</p>}</div>{form.submitted && <span className="rounded-full bg-emerald-900/50 px-2 py-1 text-xs font-bold text-emerald-200">Completed</span>}</div>
        {!form.open && !form.submitted && <p className="mt-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">{form.status === 'scheduled' ? 'This feedback form is not open yet.' : 'This feedback form is closed.'}</p>}
        {form.open && hasExternal && <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300">Submit your final feedback using the linked form.</p>
            <a href={external.url} target="_blank" rel="noreferrer" className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950">Open in new tab</a>
          </div>
          {canEmbed && <iframe
            title={`${form.title} external feedback form`}
            src={external.embed_url}
            className="mt-3 h-[620px] w-full rounded-lg border border-slate-700 bg-white"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />}
        </div>}
        {form.submitted && editing !== form.step_id ? <div className="mt-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">Thank you—your feedback has been recorded.{form.can_edit && <button type="button" className="ml-2 font-bold text-teal-300 underline" onClick={() => setEditing(form.step_id)}>Edit response</button>}</div> : form.open && hasQuestions && <form className="mt-4 space-y-4" onSubmit={(e) => submit(e, form)}>
          {form.questions.map((q) => {
          const current = answers[form.step_id] || {}; if (!visible(q, current)) return null
          const value = current[q.id] ?? ''
          const set = (next) => setAnswers((all) => ({ ...all, [form.step_id]: { ...(all[form.step_id] || {}), [q.id]: next } }))
          return <fieldset key={q.id} className="rounded-lg border border-slate-700 p-3"><legend className="px-1 text-sm font-bold">{q.prompt}{q.required ? ' *' : ''}</legend>{q.help_text && <p className="mb-2 text-xs text-slate-400">{q.help_text}</p>}
            {q.type === 'text' && <textarea rows="3" className="w-full rounded-lg border border-slate-600 bg-slate-900 p-2" value={value} onChange={(e) => set(e.target.value)} />}
            {['rating', 'nps'].includes(q.type) && <div className="flex flex-wrap gap-2">{Array.from({ length: q.type === 'rating' ? 5 : 11 }, (_, i) => q.type === 'rating' ? i + 1 : i).map((score) => <button type="button" key={score} onClick={() => set(score)} className={`h-10 min-w-10 rounded-lg border px-2 font-bold ${Number(value) === score ? 'border-teal-300 bg-teal-400 text-slate-950' : 'border-slate-600 bg-slate-900'}`}>{score}</button>)}</div>}
            {q.type === 'single_choice' && <select className="w-full rounded-lg border border-slate-600 bg-slate-900 p-2" value={value} onChange={(e) => set(e.target.value)}><option value="">Select an answer</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select>}
            {q.type === 'multi_choice' && <div className="grid gap-2">{(q.options || []).map((o) => <label key={o} className="flex gap-2"><input type="checkbox" checked={(Array.isArray(value) ? value : []).includes(o)} onChange={(e) => set(e.target.checked ? [...(Array.isArray(value) ? value : []), o] : (Array.isArray(value) ? value : []).filter((v) => v !== o))} />{o}</label>)}</div>}
            {q.type === 'yes_no' && <div className="flex gap-2">{['yes', 'no'].map((o) => <button type="button" key={o} onClick={() => set(o)} className={`rounded-lg border px-4 py-2 font-bold capitalize ${value === o ? 'bg-teal-400 text-slate-950' : 'border-slate-600 bg-slate-900'}`}>{o}</button>)}</div>}
          </fieldset>
        })}
          {error && <p className="text-sm text-amber-300">{error}</p>}
          <button disabled={busy === form.step_id} className="rounded-lg bg-teal-400 px-5 py-2.5 font-bold text-slate-950 disabled:opacity-50">{busy === form.step_id ? 'Saving…' : form.submitted ? 'Save changes' : 'Submit feedback'}</button>
        </form>}
        {form.open && !hasQuestions && !hasExternal && <p className="mt-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">This feedback step has no configured questions yet.</p>}
      </section>
    })}
  </div>
}
