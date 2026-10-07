import { useEffect, useState } from 'react';
import MenuSelection from '../MenuSelection';

export default function GuestMeals({ member, members, enabled, previewMock, onMember, onSaved, partyError, offline, onHelp }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const token = member?.qr_token;
  useEffect(() => {
    setTicket(null); setError('');
    if (!enabled || previewMock || !token) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    // Read-only ticket endpoint: never call the admission/scan POST here.
    fetch(`/api/scan/${encodeURIComponent(token)}/ticket`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Meals could not load. Please try again.');
        const data = await response.json();
        if (data.status === 'invalid' || !data.guest || data.guest.id !== member.id) throw new Error('Meal access is unavailable for this pass. Contact the organizer.');
        if (!controller.signal.aborted) setTicket(data);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, member?.id, enabled, previewMock, retry]);

  if (!enabled) return <p className="card">Meals are not enabled for this event.</p>;
  if (previewMock) return <p className="card">Meal selection opens here in your published GuestHub. No meal is selected in this preview.</p>;
  const categories = ticket?.menu_categories || [];
  const choices = ticket?.guest_choices || {};
  const hasChoices = Object.values(choices.single || {}).some(Boolean) || Object.values(choices.multi || {}).some(items => items.length) || Object.values(choices.combo || {}).some(Boolean);
  const informationOnly = categories.length > 0 && categories.every(c => c.display_only);
  const collected = !!ticket?.guest?.meal_served;
  return <section className="app-meals" aria-label="Meal selection">
    {partyError && <p role="status" className="notice">{partyError}</p>}
    <div className="vm-attendee"><span className="vm-avatar" aria-hidden="true">{(member?.name || 'Guest').split(' ').map(n => n[0]).slice(0, 2).join('')}</span><div><label htmlFor="meal-member">Choosing meals for</label>
    <select id="meal-member" className="member-select" value={member?.id || ''} disabled={saving} onChange={e => onMember(e.target.value)}>
      {members.filter(m => m.qr_token).map(m => <option key={m.id} value={m.id}>{m.name}{m.is_self ? ' · You' : ''}</option>)}
    </select></div></div>
    <div className="meal-person"><h2>{informationOnly ? 'Published event menu' : `Meals for ${member?.name || 'this attendee'}`}</h2>{ticket && <span className="status">{informationOnly ? 'Menu only' : collected ? 'Collected' : hasChoices ? 'Selected' : 'Not selected'}</span>}</div>
    {!token ? <p className="notice">Open your personal GuestHub link to access meal selection.</p> : loading ? <p role="status" className="card">Loading meals…</p> : error ? <div className="notice" role="alert"><p>{error}</p><button className="secondary" onClick={() => setRetry(n => n + 1)}>Retry meals</button></div> : !ticket?.event?.menu_enabled ? <p className="card">Meals are not enabled for this event.</p> : collected && !informationOnly ? <div className="card"><h3>Meal collected</h3><p>Staff have recorded this attendee’s meal as served. Selection is locked.</p></div> : ticket.menu_locked ? <div className="card"><h3>Meal selection unlocks at check-in</h3><p>{member.name} needs to be checked in before selecting a meal. Show their pass to event staff.</p></div> : !categories.length ? <p className="card">{ticket.event.status !== 'active' ? 'Meal selection is available while the event is active.' : 'The organizer has not published a menu yet.'}</p> : <div className="meal-selection-visual">
      <fieldset disabled={offline}>
        <MenuSelection key={retry} token={token} categories={categories} initialChoices={choices} mealServed={collected} embedded onSavingChange={setSaving} onSaved={savedChoices => {
          setTicket(current => ({...current, guest_choices: savedChoices}));
          onSaved?.();
        }} />
      </fieldset>
    </div>}
    <div className="vm-support">{ticket && <button type="button" className="text-button" disabled={saving || offline} onClick={() => setRetry(n => n + 1)}>Refresh meal status</button>}
    <button type="button" className="text-button" onClick={onHelp}>Contact the organizer →</button></div>
    <p className="small muted">Collection is recorded by event staff. For allergies or dietary questions not covered by the menu, contact the organizer.</p>
  </section>;
}
