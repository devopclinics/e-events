import { useState } from 'react';
import { api } from '../../api';
import './EventForms.css';
export default function EventForms({ eventId, token, items = [], error, loading, refresh }) {
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const [receipt, setReceipt] = useState(null);
  const update = (key, values) => setDrafts(old => ({ ...old, [key]: { ...old[key], ...values } }));
  async function submit(e, item, key) {
    e.preventDefault(); if (busy) return;
    setBusy(key); setFailure('');
    try {
      const d = drafts[key] || {};
      const result = await api.submitEventForm(eventId, item.id, token, { guest_id: item.guest_id, revision_id: item.revision_id, signer_name: d.name || '', accepted: !!d.accepted, guardian_attestation: !!d.guardian, answers: d.answers || {} });
      await refresh();
      try { setReceipt(await api.eventFormReceipt(eventId, result.receipt_id, token)); }
      catch { setFailure('Your submission was saved. Reconnect and use View signed / submitted copy to open your receipt.'); }
    } catch (err) { setFailure(err.message || 'Not submitted. Reconnect and try again. Your entries remain here.'); }
    finally { setBusy(''); }
  }
  async function openReceipt(id) {
    setFailure('');try { setReceipt(await api.eventFormReceipt(eventId,id,token)); } catch (err) { setFailure(err.message); }
  }
  return <section className="event-forms" aria-label="Event forms">
    {loading && <p role="status">Loading your forms…</p>}
    {error && <p role="alert">{error} <button onClick={refresh}>Try again</button></p>}
    {failure && <p role="alert" className="notice">{failure}</p>}
    {receipt && <article className="card form-receipt" aria-label="Form receipt"><h2>Submission received</h2><h3>{receipt.form.title} · Version {receipt.form.version}</h3><p>For {receipt.guest_name} · Submitted by {receipt.signer_name} ({receipt.relationship})</p><p>{new Date(receipt.signed_at + (/(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.signed_at) ? '' : 'Z')).toLocaleString()}</p><p className="form-wording">{receipt.form.body}</p>{receipt.form.questions.map(q => <p key={q.key}><strong>{q.label}:</strong> {typeof receipt.answers[q.key] === 'boolean' ? (receipt.answers[q.key] ? 'Yes' : 'No') : receipt.answers[q.key] || '—'}</p>)}<p>{receipt.signature_text ? `Signed: ${receipt.signature_text}` : 'Information acknowledged and submitted.'}</p><p>Receipt: {receipt.id}</p><div className="form-buttons"><button className="secondary" onClick={() => window.print()}>Print / save a copy</button><button className="secondary" onClick={() => setReceipt(null)}>Close receipt</button></div></article>}
    {!loading && !error && !items.length && <p>No additional forms have been published for you.</p>}
    {items.map(item => { const key = `${item.revision_id}:${item.guest_id}`, draft = drafts[key] || {};
      return <details className="card" key={key}><summary><strong>{item.title}</strong><span>{item.guest_name} · {item.status === 'complete' ? 'Completed ✓' : item.required ? 'Action required' : 'Optional'}</span></summary>
        <p>Version {item.version} · {item.timing === 'after_admission' ? 'Available after check-in' : 'Complete before arrival'}</p>
        <p className="form-wording">{item.body}</p>
        {item.status === 'complete' ? <button className="secondary" onClick={() => openReceipt(item.receipt_id)}>View signed / submitted copy</button> : <>
          {item.reason && <p className="notice">{item.reason}</p>}
          {item.can_submit && <form onSubmit={e => submit(e, item, key)}>
            {item.questions.map(q => <label key={q.key}>{q.label}{q.required ? ' *' : ''}
              {q.type === 'checkbox' ? <input type="checkbox" required={q.required} checked={!!draft.answers?.[q.key]} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.checked}})} /> : q.type === 'select' ? <select required={q.required} value={draft.answers?.[q.key] || ''} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.value}})}><option value="">Choose…</option>{q.options.map(o => <option key={o}>{o}</option>)}</select> : q.type === 'textarea' ? <textarea required={q.required} maxLength={4000} value={draft.answers?.[q.key] || ''} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.value}})} /> : <input required={q.required} maxLength={4000} value={draft.answers?.[q.key] || ''} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.value}})} />}
            </label>)}
            <label>Your full name<input required minLength={2} maxLength={255} value={draft.name || ''} onChange={e => update(key,{name:e.target.value})} autoComplete="name" /></label>
            {item.on_behalf && <label className="form-check"><input required type="checkbox" checked={!!draft.guardian} onChange={e => update(key,{guardian:e.target.checked})} />I am the authorized parent or legal guardian signing for {item.guest_name}.</label>}
            <label className="form-check"><input required type="checkbox" checked={!!draft.accepted} onChange={e => update(key,{accepted:e.target.checked})} />{item.kind === 'consent' ? 'I have read this form and agree. Typing my name records my signature.' : 'I confirm that the information provided is accurate to the best of my knowledge.'}</label>
            <button className="primary" disabled={!!busy}>{busy === key ? 'Submitting…' : item.kind === 'consent' ? 'Sign and submit' : 'Submit information'}</button>
            <p className="small">An internet connection is required. Completion appears only after your submission is confirmed.</p>
          </form>}
        </>}
      </details>;
    })}
  </section>;
}
