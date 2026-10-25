import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import RedesignShell from './redesign/RedesignShell';
import './MeetingsPage.css';
const empty = () => ({
  title: '',
  agenda: '',
  start: '',
  end: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  location_type: 'online',
  location: '',
  video_url: '',
  attendees: [{
    name: '',
    email: ''
  }],
  start_fold: null,
  end_fold: null
});
const responseLabel = {
  pending: 'Awaiting reply',
  accepted: 'Accepted',
  maybe: 'Maybe',
  declined: 'Declined',
  cancelled: 'Cancelled'
};
export function MeetingDetails({
  data
}) {
  // Render the stored wall clock without converting it to the viewer's zone.
  const local = value => new Date(value + 'Z');
  const date = value => local(value).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const time = value => local(value).toLocaleTimeString(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit'
  });
  return <><h2>{data.title}</h2>{data.agenda && <p className="mt-agenda">{data.agenda}</p>}<div className="mt-details"><p>▦ {date(data.start)}{data.start.slice(0, 10) !== data.end.slice(0, 10) ? ` – ${date(data.end)}` : ''}</p><p>◷ {time(data.start)} – {time(data.end)}</p><p>◎ {data.timezone}</p>{data.start_fold !== null && data.start_fold !== undefined && <small>Start: {data.start_fold ? 'second' : 'first'} clock occurrence</small>}<p>{data.location_type === 'online' ? 'Online meeting' : data.location}</p>{data.video_url && <a href={data.video_url} target="_blank" rel="noreferrer">Open meeting link ↗</a>}</div></>;
}
export function MeetingsWorkspace({
  client = api
}) {
  const [meetings, setMeetings] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(empty);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  async function refresh() {
    setMeetings(await client.listMeetings());
  }
  useEffect(() => {
    refresh().catch(e => setError(e.message));
  }, []);
  function choose(m) {
    setSelected(m);
    setForm(m.draft);
    setPreview(null);
    setEditing(true);
    setNotice('');
    setError('');
    setCancelConfirm(false);
  }
  function change(key, value) {
    setForm(f => ({
      ...f,
      [key]: value
    }));
    setPreview(null);
    setNotice('');
  }
  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(showPreview = false) {
    await act(async () => {
      const m = selected ? await client.updateMeeting(selected.id, {
        ...form,
        revision: selected.revision
      }) : await client.createMeeting(form);
      setSelected(m);
      setForm(m.draft);
      await refresh();
      if (showPreview) setPreview(await client.previewMeeting(m.id));
      setNotice(showPreview ? 'Review this saved version before sending.' : 'Draft saved. No invitations sent.');
    });
  }
  async function publish() {
    await act(async () => {
      const m = await client.sendMeeting(selected.id, preview.revision);
      setSelected(m);
      setPreview(null);
      setNotice('Invitations queued individually. Delivery status updates below.');
      await refresh();
    });
  }
  const cancelled = selected?.status === 'cancelled';
  return <div className="mt-workspace">
    <header className="mt-heading"><div><span className="mt-eyebrow">ORGANIZER WORKSPACE</span><h1>Meetings</h1><p>Small meetings. Simple invitations.</p></div><button className="mt-primary" onClick={() => {
        setSelected(null);
        setForm(empty());
        setPreview(null);
        setEditing(true);
        setError('');
        setNotice('');
        setCancelConfirm(false);
      }}>＋ Schedule a meeting</button></header>
    {error && <div role="alert" className="mt-error">{error} <button onClick={() => act(refresh)}>Reload meetings</button></div>}
    {notice && <p role="status" className="mt-notice">{notice}</p>}
    <div className="mt-list" aria-label="Your meetings">{meetings === null ? <p>Loading meetings…</p> : meetings.length ? meetings.map(m => <button key={m.id} className={selected?.id === m.id ? 'selected' : ''} onClick={() => choose(m)}><strong>{m.draft.title}</strong><span>{m.draft.start.replace('T', ' ')} · {m.status}{m.revision !== m.published_revision && m.status === 'scheduled' ? ' · unsent changes' : ''}</span></button>) : <p>No meetings yet. Bring a few people together without creating an event.</p>}</div>
    {editing && <div className="mt-grid"><section className="mt-card"><div className="mt-step">01 <span>Schedule</span></div><h2>{selected ? 'Meeting details' : 'Schedule a meeting'}</h2>
      <form onSubmit={e => {
          e.preventDefault();
          save(true);
        }}>
        <fieldset disabled={busy || cancelled}>
          <label>Meeting title<input required maxLength={200} value={form.title} onChange={e => change('title', e.target.value)} placeholder="Project catch-up" /></label>
          <div className="mt-two"><label>Start<input type="datetime-local" required value={form.start} onChange={e => change('start', e.target.value)} /></label><label>End<input type="datetime-local" required value={form.end} onChange={e => change('end', e.target.value)} /></label></div>
          <label>Timezone<input list="mt-timezones" required value={form.timezone} onChange={e => change('timezone', e.target.value)} placeholder="America/Chicago" /><datalist id="mt-timezones">{(Intl.supportedValuesOf?.('timeZone') || ['UTC', 'America/Chicago', 'Europe/London']).map(t => <option key={t} value={t} />)}</datalist></label>
          <details className="mt-dst"><summary>Time occurs twice when clocks go back?</summary><p>Choose which occurrence for ambiguous local times.</p><div className="mt-two">{['start', 'end'].map(k => <label key={k}>{k === 'start' ? 'Start occurrence' : 'End occurrence'}<select value={form[`${k}_fold`] ?? ''} onChange={e => change(`${k}_fold`, e.target.value === '' ? null : Number(e.target.value))}><option value="">Automatic (unambiguous only)</option><option value="0">First occurrence</option><option value="1">Second occurrence</option></select></label>)}</div></details>
          <label>Attendees <span className="mt-muted">Names and email addresses · up to 50</span></label>
          {form.attendees.map((a, i) => <div className="mt-attendee" key={i}><input aria-label={`Attendee ${i + 1} name`} required placeholder="Name" value={a.name} onChange={e => change('attendees', form.attendees.map((v, j) => j === i ? {
                ...v,
                name: e.target.value
              } : v))} /><input aria-label={`Attendee ${i + 1} email`} required type="email" placeholder="Email address" value={a.email} onChange={e => change('attendees', form.attendees.map((v, j) => j === i ? {
                ...v,
                email: e.target.value
              } : v))} /><button type="button" aria-label={`Remove attendee ${i + 1}`} disabled={form.attendees.length === 1} onClick={() => change('attendees', form.attendees.filter((_, j) => i !== j))}>×</button></div>)}
          <button className="mt-add" type="button" disabled={form.attendees.length >= 50} onClick={() => change('attendees', [...form.attendees, {
              name: '',
              email: ''
            }])}>＋ Add attendee</button>
          <label>Meeting type</label><div className="mt-two mt-type">{[['online', 'Online'], ['physical', 'In person']].map(([value, label]) => <label key={value}><input type="radio" checked={form.location_type === value} onChange={() => change('location_type', value)} />{label}</label>)}</div>
          {form.location_type === 'physical' && <label>Location<input required value={form.location} onChange={e => change('location', e.target.value)} placeholder="Room or street address" /></label>}
          <label>Meeting link{form.location_type === 'physical' ? ' (optional)' : ''}<input type="url" required={form.location_type === 'online'} value={form.video_url} onChange={e => change('video_url', e.target.value)} placeholder="https://example.com/meeting" /></label>
          <label>Agenda (optional)<textarea rows={3} value={form.agenda} onChange={e => change('agenda', e.target.value)} placeholder="Review progress and agree next steps." /></label>
          <div className="mt-actions"><button type="button" onClick={() => save(false)}>Save draft</button><button className="mt-primary" type="submit">{busy ? 'Saving…' : 'Preview invitation'}</button></div>
        </fieldset>
      </form>{cancelled && <p className="mt-notice">This meeting is cancelled. Its response links are closed.</p>}
    </section>
    <section className="mt-card"><div className="mt-step">02 <span>Preview</span></div><h2>Review invitation</h2>{preview ? <><div className="mt-invitation"><div className="mt-brand">festio</div><p>You're invited to a meeting</p><MeetingDetails data={form} /><hr /><label>To · {preview.recipients.length} attendees</label>{preview.recipients.map(a => <p key={a.email}>{a.name} <span className="mt-muted">{a.email}</span></p>)}{preview.cancellations.length > 0 && <p className="mt-error">Cancellation notices: {preview.cancellations.join(', ')}</p>}<label>Email subject</label><p>{preview.subject}</p><label>Attachment</label><p>▧ meeting.ics</p><small>Sent individually to each attendee.</small></div><p className="mt-muted">Accept, Maybe and Decline responses are recorded in Festio. Google/Outlook replies are not synchronized.</p>{!preview.sending_enabled && <p className="mt-notice">Invitation sending is disabled in this environment.</p>}<div className="mt-actions"><button onClick={() => setPreview(null)}>Back to edit</button><button className="mt-primary" disabled={busy || !preview.sending_enabled || cancelled} onClick={publish}>Send invitations</button></div></> : <div className="mt-preview-empty"><span>✉</span><h3>A personal invitation for every attendee</h3><p>Save your details and preview the recipients, message and calendar attachment before sending.</p><small>Saving and previewing never send invitations.</small></div>}</section></div>}
    {selected && <section className="mt-card mt-responses"><div className="mt-step">03 <span>Responses via Festio</span></div><div className="mt-heading"><h2>Organizer view</h2><button disabled={busy} onClick={() => act(async () => {
          const m = await client.getMeeting(selected.id);
          setSelected(m);
          await refresh();
        })}>Refresh status</button></div>{!selected.attendees.length && <p>Responses and delivery status will appear after invitations are sent.</p>}{selected.attendees.map(a => {
        const rows = selected.deliveries.filter(d => d.attendee_id === a.id);
        const latest = rows[rows.length - 1];
        return <div className="mt-response" key={a.id}><div><strong>{a.name}</strong><small>{a.email}</small></div><span className={`mt-badge ${a.response}`}>{responseLabel[a.response]}{!a.active ? ' · removed' : ''}</span><div><span>{latest?.delivery_status || latest?.status || 'Not queued'}{latest ? ` · v${latest.sequence} ${latest.method}` : ''}</span>{latest?.error && <small role="alert">{latest.error}</small>}{latest?.status === 'failed' && <button disabled={busy} onClick={() => act(async () => setSelected(await client.retryMeetingDelivery(selected.id, latest.id)))}>Retry failed delivery</button>}</div></div>;
      })}<small>“Accepted” delivery means the email provider accepted the message; it does not confirm inbox delivery.</small>{!cancelled && <div className="mt-cancel">{cancelConfirm ? <><p>Cancel this meeting and queue cancellation notices for everyone previously invited?</p><button onClick={() => setCancelConfirm(false)}>Keep meeting</button><button disabled={busy} onClick={() => act(async () => {
            const m = await client.cancelMeeting(selected.id, selected.revision);
            choose(m);
            setNotice('Meeting cancelled. Cancellation notices queued for previously invited attendees.');
            await refresh();
          })}>Confirm cancellation</button></> : <button onClick={() => setCancelConfirm(true)}>Cancel meeting</button>}</div>}</section>}
  </div>;
}
export default function MeetingsPage() {
  return <RedesignShell topActive="meetings" eventScoped={false}><MeetingsWorkspace /></RedesignShell>;
}
export function MeetingResponsePage({
  client = api
}) {
  const {
    token
  } = useParams();
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    client.meetingResponsePreview(token).then(d => {
      if (active) setData(d);
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
      meta.remove();
    };
  }, [token]);
  async function reply(response) {
    setBusy(true);
    setError('');
    try {
      const r = await client.respondToMeeting(token, response);
      setData(d => ({
        ...d,
        response: r.response
      }));
    } catch (e) {
      setError(e.message);
      if (e.status === 410) setData(null);
    } finally {
      setBusy(false);
    }
  }
  return <main className="mt-public"><section className="mt-card"><div className="mt-brand">festio</div><p className="mt-eyebrow">MEETING INVITATION</p>{error && <p role="alert" className="mt-error">{error}</p>}{data ? <><MeetingDetails data={data.meeting} /><h3>Will you attend, {data.name}?</h3><div className="mt-reply">{[['accepted', 'Accept'], ['maybe', 'Maybe'], ['declined', 'Decline']].map(([value, label]) => <button key={value} disabled={busy} className={data.response === value ? 'mt-primary' : ''} onClick={() => reply(value)}>{label}</button>)}</div><p role="status">{data.response === 'pending' ? 'Choose a response to let the organizer know.' : `Your response: ${responseLabel[data.response]}`}</p><small>Responses via Festio. Calendar replies are not synchronized.</small></> : !error && <p>Loading your invitation…</p>}</section></main>;
}
