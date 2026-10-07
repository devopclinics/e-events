import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import './EventForms.css';
export default function EventForms({ eventId, token, items = [], error, loading, refresh, focusForm, focusMember }) {
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [person, setPerson] = useState('all');
  const [filter, setFilter] = useState('all');
  const receiptRef = useRef(null);
  useEffect(() => { if (receipt) receiptRef.current?.focus(); }, [receipt]);
  useEffect(() => {
    if (!focusForm) return;
    const target=items.find(item=>item.id===focusForm&&(!focusMember||item.guest_id===focusMember));
    if (!target) return;
    setPerson(target.guest_id); setFilter('all');
    const frame=requestAnimationFrame(()=>{const el=document.getElementById(`event-form-${target.id}-${target.guest_id}`);if(el){el.open=true;el.scrollIntoView({block:'start'});el.querySelector('summary')?.focus();}});
    return ()=>cancelAnimationFrame(frame);
  }, [focusForm, focusMember, items]);
  const people = [...new Map(items.map(item => [item.guest_id, item.guest_name])).entries()];
  const selectedPerson = people.some(([id]) => id === person) ? person : 'all';
  const scoped = items.filter(item => selectedPerson === 'all' || item.guest_id === selectedPerson);
  const completed = scoped.filter(item => item.status === 'complete').length;
  const outstanding = scoped.filter(item => item.required && item.status !== 'complete').length;
  const visible = scoped.filter(item => filter === 'all' || (filter === 'completed' ? item.status === 'complete' : item.status !== 'complete'));
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
    {loading && <p className="forms-state" role="status">Loading your forms…</p>}
    {error && <p className="forms-state" role="alert">{error} <button onClick={refresh}>Try again</button></p>}
    {failure && <p role="alert" className="notice">{failure}</p>}
    {receipt && <article className="card form-receipt" aria-label="Form receipt" tabIndex={-1} ref={receiptRef}><span className="forms-kicker">SAVED CONFIRMATION</span><h2>Submission received</h2><h3>{receipt.form.title} · Version {receipt.form.version}</h3><p>For {receipt.guest_name} · Submitted by {receipt.signer_name} ({receipt.relationship})</p><p>{new Date(receipt.signed_at + (/(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.signed_at) ? '' : 'Z')).toLocaleString()}</p><p className="form-wording">{receipt.form.body}</p>{receipt.form.questions.map(q => <p key={q.key}><strong>{q.label}:</strong> {typeof receipt.answers[q.key] === 'boolean' ? (receipt.answers[q.key] ? 'Yes' : 'No') : receipt.answers[q.key] || '—'}</p>)}<p>{receipt.signature_text ? `Signed: ${receipt.signature_text}` : 'Information acknowledged and submitted.'}</p><p>Receipt: {receipt.id}</p><div className="form-buttons"><button className="secondary" onClick={() => window.print()}>Print / save a copy</button><button className="secondary" onClick={() => setReceipt(null)}>Close receipt</button></div></article>}
    {!loading && !error && !items.length && <div className="forms-state"><span className="forms-symbol" aria-hidden="true">≡</span><h2>Your published forms</h2><p>No additional forms have been published for you.</p><p>Any other event requirements appear below.</p></div>}
    {items.length > 0 && <>
      <div className="forms-overview">
        <div><span className="forms-kicker">YOUR PUBLISHED FORMS</span><h2>A little preparation.<br />More time for your event.</h2><p>Review the details, complete your information and keep a copy of every submission.</p></div>
        <div className="forms-progress"><strong>{completed}<span> / {scoped.length}</span></strong><span>forms completed</span><progress aria-label="Published forms completed" value={completed} max={Math.max(1, scoped.length)} /><span>{outstanding ? `${outstanding} required ${outstanding === 1 ? 'form remains' : 'forms remain'}` : 'No outstanding required forms in this list'}</span></div>
      </div>
      <div className="forms-toolbar">
        {people.length > 1 && <label className="forms-person">Forms for<select aria-label="Forms for" value={selectedPerson} onChange={e => setPerson(e.target.value)}><option value="all">Everyone in my party</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        <div className="forms-filters" role="group" aria-label="Filter forms">{[['all', 'All forms', scoped.length], ['pending', 'To complete', scoped.length - completed], ['completed', 'Completed', completed]].map(([id, label, count]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} <span>{count}</span></button>)}</div>
      </div>
      {!visible.length && <p className="forms-state">No forms match this view. Choose another person or select All forms.</p>}
    </>}
    {visible.map(item => { const key = `${item.revision_id}:${item.guest_id}`, draft = drafts[key] || {};
      return <details className="card forms-item" id={`event-form-${item.id}-${item.guest_id}`} key={key}><summary>
        <span className={`forms-symbol ${item.status === 'complete' ? 'is-complete' : ''}`} aria-hidden="true">{item.status === 'complete' ? '✓' : item.kind === 'consent' ? '✎' : '≡'}</span>
        <span className="forms-item-heading"><span className="forms-kicker">{item.kind === 'consent' ? 'Consent form' : 'Information form'} · {item.required ? 'Required' : 'Optional'}</span><strong>{item.title}</strong><span className="forms-recipient">For {item.guest_name}{item.on_behalf ? ' · Parent / guardian' : ''}</span></span>
        <span className="forms-item-action"><span className={`forms-status ${item.status === 'complete' ? 'is-complete' : !item.can_submit ? 'is-unavailable' : ''}`}>{item.status === 'complete' ? 'Completed' : !item.can_submit ? 'Not available yet' : 'To complete'}</span><span className="forms-open">{item.status === 'complete' ? 'View submission' : 'Review form'} <span aria-hidden="true">⌄</span></span></span>
      </summary><div className="forms-item-body">
        <p className="forms-version">Version {item.version} · {item.timing === 'after_admission' ? 'Available after check-in' : 'Complete before arrival'}</p>
        <div className="forms-reading"><h3>Read before you continue</h3><p className="form-wording">{item.body}</p></div>
        {item.status === 'complete' ? <button className="secondary" onClick={() => openReceipt(item.receipt_id)}>View signed / submitted copy</button> : <>
          {item.reason && <p className="notice">{item.reason}</p>}
          {item.can_submit && <form onSubmit={e => submit(e, item, key)}><fieldset disabled={!!busy} className="forms-fields"><legend>{item.kind === 'consent' ? 'Your information & signature' : 'Your information'}</legend><p className="forms-hint">Required fields are marked with *. Your full name and confirmations below are also required.</p>
            {item.questions.map(q => <label key={q.key}>{q.label}{q.required ? ' *' : ''}
              {q.type === 'checkbox' ? <input type="checkbox" required={q.required} checked={!!draft.answers?.[q.key]} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.checked}})} /> : q.type === 'select' ? <select required={q.required} value={draft.answers?.[q.key] || ''} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.value}})}><option value="">Choose…</option>{q.options.map(o => <option key={o}>{o}</option>)}</select> : q.type === 'textarea' ? <textarea required={q.required} maxLength={4000} value={draft.answers?.[q.key] || ''} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.value}})} /> : <input required={q.required} maxLength={4000} value={draft.answers?.[q.key] || ''} onChange={e => update(key,{answers:{...draft.answers,[q.key]:e.target.value}})} />}
            </label>)}
            <div className="forms-signature"><h3>{item.kind === 'consent' ? 'Confirm & sign' : 'Confirm your information'}</h3><p>Submitting for <strong>{item.guest_name}</strong></p><label>Your full name<input required minLength={2} maxLength={255} value={draft.name || ''} onChange={e => update(key,{name:e.target.value})} autoComplete="name" /></label>
            {item.on_behalf && <label className="form-check"><input required type="checkbox" checked={!!draft.guardian} onChange={e => update(key,{guardian:e.target.checked})} />I am the authorized parent or legal guardian signing for {item.guest_name}.</label>}
            <label className="form-check"><input required type="checkbox" checked={!!draft.accepted} onChange={e => update(key,{accepted:e.target.checked})} />{item.kind === 'consent' ? 'I have read this form and agree. Typing my name records my signature.' : 'I confirm that the information provided is accurate to the best of my knowledge.'}</label>
            </div><div className="forms-submit"><button className="primary" disabled={!!busy}>{busy === key ? 'Submitting…' : item.kind === 'consent' ? 'Sign and submit' : 'Submit information'}</button>
            <p className="small">An internet connection is required. Completion appears only after your submission is confirmed.</p></div></fieldset>
          </form>}
        </>}
      </div></details>;
    })}
  </section>;
}
