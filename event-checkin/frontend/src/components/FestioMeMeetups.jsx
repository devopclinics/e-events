import { useState } from 'react';
import { api } from '../api';

const blank = { title: '', description: '', location: '', starts_at: '', ends_at: '', capacity: '' };
const date = (value) => new Date(value && !/(Z|[+-]\d\d:\d\d)$/.test(value) ? `${value}Z` : value);
const localTime = (value) => {
  if (!value) return '';
  const instant = date(value);
  return new Date(instant.getTime() - instant.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function FestioMeMeetups({ groupId, groupName, meetups, loading, error, readonly, onRefresh, onChange }) {
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('upcoming');
  const [cancelId, setCancelId] = useState('');
  const shown = meetups.filter((item) => view === 'past'
    ? date(item.ends_at || item.starts_at).getTime() < Date.now() || item.status === 'cancelled'
    : date(item.ends_at || item.starts_at).getTime() >= Date.now() && item.status !== 'cancelled');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startForm = (item) => {
    setEditing(item?.id || null);
    setForm(item ? { ...blank, ...item, starts_at: localTime(item.starts_at), ends_at: localTime(item.ends_at), capacity: item.capacity || '' } : { ...blank });
    setNotice('');
  };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    if (!form.title.trim()) { setNotice('Enter a meetup title.'); return; }
    if (form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at)) { setNotice('End time must be after start time.'); return; }
    setBusy(true); setNotice('');
    try {
      const payload = {
        title: form.title.trim(), description: form.description.trim(), location: form.location.trim(),
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        capacity: form.capacity ? Number(form.capacity) : null,
      };
      const item = editing ? await api.festiomeUpdateMeetup(editing, payload) : await api.festiomeCreateMeetup(groupId, payload);
      onChange(item); setForm(null); setEditing(null); setNotice(editing ? 'Meetup updated.' : 'Meetup created. You are marked as going.');
    } catch (failure) { setNotice(failure.message || 'Could not save the meetup. Please try again.'); }
    finally { setBusy(false); }
  }
  async function rsvp(item, status) {
    setBusy(true); setNotice('');
    try { onChange(await api.festiomeRsvpMeetup(item.id, status)); setNotice('Your RSVP has been saved.'); }
    catch (failure) { setNotice(failure.message || 'Could not save your RSVP.'); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setNotice('');
    try { onChange(await api.festiomeUpdateMeetup(cancelId, { status: 'cancelled' })); setCancelId(''); setNotice('Meetup cancelled. It is available under Past & cancelled.'); }
    catch (failure) { setNotice(failure.message || 'Could not cancel the meetup.'); }
    finally { setBusy(false); }
  }
  return <section className="fm-guest-page fm-meetups-page">
    <div className="fm-dashboard-title"><div><h2>Meetups</h2><p>Meet in person with {groupName || 'your community'}. Times shown in {zone}.</p></div>
      {!readonly && <button type="button" disabled={!groupId || busy} onClick={() => startForm()}>Create meetup</button>}
    </div>
    {readonly && <p>You can view meetups and RSVP. Creating meetups is unavailable for read-only members.</p>}
    <div className="fm-meetup-tabs" role="group" aria-label="Meetup views">
      <button type="button" aria-pressed={view === 'upcoming'} onClick={() => setView('upcoming')}>Upcoming</button>
      <button type="button" aria-pressed={view === 'past'} onClick={() => setView('past')}>Past & cancelled</button>
      <button type="button" disabled={loading} onClick={onRefresh}>Refresh meetups</button>
    </div>
    {error && <p role="alert">{error} <button type="button" onClick={onRefresh}>Try again</button></p>}
    {notice && <p role="status">{notice}</p>}
    {form && <form className="fm-guest-meetup-form" onSubmit={save}>
      <h3>{editing ? 'Edit meetup' : 'New meetup'}</h3>
      <label>Meetup title<input required maxLength={160} value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Meetup title" /></label>
      <label>Location<input maxLength={255} value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Location" /></label>
      <label>Start time<input required type="datetime-local" value={form.starts_at} onChange={(e) => update('starts_at', e.target.value)} /></label>
      <label>End time (optional)<input type="datetime-local" value={form.ends_at} onChange={(e) => update('ends_at', e.target.value)} /></label>
      <label>Capacity (optional)<input type="number" min={2} max={10000} value={form.capacity} onChange={(e) => update('capacity', e.target.value)} placeholder="No limit" /></label>
      <label>Description<textarea maxLength={3000} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="What should people expect?" /></label>
      <div className="fm-meetup-form-actions"><button disabled={busy}>{busy ? 'Saving…' : editing ? 'Save meetup' : 'Create meetup'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div>
    </form>}
    {cancelId && <div className="fm-meetup-cancel" role="alert"><p>Cancel this meetup? Members will see its cancelled status.</p><button type="button" disabled={busy} onClick={cancel}>Confirm cancellation</button><button type="button" onClick={() => setCancelId('')}>Keep meetup</button></div>}
    <div className="fm-guest-meetup-list" aria-busy={loading}>
      {shown.map((item) => <article key={item.id}>
        <div className="fm-meetup-day"><strong>{date(item.starts_at).getDate()}</strong><span>{date(item.starts_at).toLocaleDateString([], { month: 'short' })}</span></div>
        <div><span>{date(item.starts_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{item.location ? ` · ${item.location}` : ''}</span>
          <h3>{item.title}</h3><p>{item.description || `Hosted by ${item.creator_name}`}</p><small>{item.attendee_count} going · {item.interested_count || 0} interested{item.capacity ? ` · ${Math.max(0, item.capacity - item.attendee_count)} spots left` : ''}</small>
          {item.status === 'cancelled' ? <p>Cancelled</p> : view === 'upcoming' && <div className="fm-meetup-rsvp" role="group" aria-label={`RSVP to ${item.title}`}>
            {[['going', 'Going'], ['interested', 'Interested'], ['declined', "Can't go"]].map(([status, label]) => <button key={status} type="button" disabled={busy} aria-pressed={item.my_status === status} onClick={() => rsvp(item, status)}>{label}{item.my_status === status ? ' ✓' : ''}</button>)}
          </div>}
          {item.can_manage && item.status !== 'cancelled' && <div className="fm-meetup-management"><button type="button" disabled={busy} onClick={() => startForm(item)}>Edit meetup</button><button type="button" disabled={busy} onClick={() => setCancelId(item.id)}>Cancel meetup</button></div>}
        </div>
      </article>)}
      {!shown.length && <div className="fm-dashboard-empty">{loading ? 'Loading meetups…' : error ? 'Meetups could not load. Try again above.' : view === 'past' ? 'No past or cancelled meetups.' : 'No upcoming meetups in this group. Create one or switch groups to see their meetups.'}</div>}
    </div>
  </section>;
}
