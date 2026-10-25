import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import RedesignShell from './redesign/RedesignShell';
import './MeetingsPage.css';
const newAttendee = () => ({
  name: '',
  email: '',
  phone: '',
  channels: ['email'],
  sms_consent: false,
  whatsapp_consent: false
});
const empty = () => ({
  title: '',
  agenda: '',
  start: '',
  end: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  location_type: 'online',
  location: '',
  video_url: '',
  attendees: [newAttendee()],
  whatsapp_template_id: null,
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
  const [options, setOptions] = useState({
    whatsapp_templates: []
  });
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const [cancelPreview, setCancelPreview] = useState(null);
  async function refresh() {
    setMeetings(await client.listMeetings());
  }
  useEffect(() => {
    refresh().catch(e => setError(e.message));
    client.meetingOptions?.().then(setOptions).catch(e => setError(e.message));
  }, []);
  function choose(m) {
    setSelected(m);
    setForm(m.draft);
    setPreview(null);
    setPaidConfirmed(false);
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
    setPaidConfirmed(false);
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
      const m = await client.sendMeeting(selected.id, preview.revision, paidConfirmed, preview.credit_units || 0);
      setSelected(m);
      setPreview(null);
      setPaidConfirmed(false);
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
        setPaidConfirmed(false);
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
          {form.attendees.map((a, i) => {
              const update = patch => change('attendees', form.attendees.map((v, j) => j === i ? {
                ...v,
                ...patch
              } : v));
              const channels = a.channels || ['email'];
              return <div className="mt-person" key={i}>
              <div className="mt-attendee"><input aria-label={`Attendee ${i + 1} name`} required placeholder="Name" value={a.name} onChange={e => update({
                    name: e.target.value
                  })} />
              <input aria-label={`Attendee ${i + 1} email`} type="email" required={channels.includes('email')} placeholder="Email address" value={a.email || ''} onChange={e => update({
                    email: e.target.value
                  })} />
              <button type="button" aria-label={`Remove attendee ${i + 1}`} disabled={form.attendees.length === 1} onClick={() => change('attendees', form.attendees.filter((_, j) => i !== j))}>×</button></div>
              <label>Phone with country code<input aria-label={`Attendee ${i + 1} phone`} type="tel" placeholder="+14155550123" value={a.phone || ''} onChange={e => update({
                    phone: e.target.value
                  })} /></label>
              <div className="mt-channel-choices">{[['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp']].map(([channel, label]) => <label key={channel}><input type="checkbox" aria-label={`Attendee ${i + 1} ${label}`} checked={channels.includes(channel)} onChange={e => update({
                      channels: e.target.checked ? [...channels, channel] : channels.filter(c => c !== channel)
                    })} />{label}</label>)}</div>
              {channels.includes('sms') && <label className="mt-consent"><input type="checkbox" required checked={!!a.sms_consent} onChange={e => update({
                    sms_consent: e.target.checked
                  })} />This attendee agreed to receive SMS meeting notifications.</label>}
              {channels.includes('whatsapp') && <label className="mt-consent"><input type="checkbox" required checked={!!a.whatsapp_consent} onChange={e => update({
                    whatsapp_consent: e.target.checked
                  })} />This attendee agreed to receive WhatsApp meeting notifications.</label>}
            </div>;
            })}
          <button className="mt-add" type="button" disabled={form.attendees.length >= 50} onClick={() => change('attendees', [...form.attendees, newAttendee()])}>＋ Add attendee</button>
          {form.attendees.some(a => a.channels?.includes('whatsapp')) && <><label>Approved WhatsApp template<select aria-label="Approved WhatsApp template" value={form.whatsapp_template_id || ''} onChange={e => change('whatsapp_template_id', e.target.value || null)}><option value="">Select an eligible approved template</option>{options.whatsapp_templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{!options.whatsapp_templates.length && <p className="mt-notice">Setup required: no eligible approved WhatsApp template is available. No free-text fallback will be used.</p>}</>}
          <label>Meeting type</label><div className="mt-two mt-type">{[['online', 'Online'], ['physical', 'In person']].map(([value, label]) => <label key={value}><input type="radio" checked={form.location_type === value} onChange={() => change('location_type', value)} />{label}</label>)}</div>
          {form.location_type === 'physical' && <label>Location<input required value={form.location} onChange={e => change('location', e.target.value)} placeholder="Room or street address" /></label>}
          <label>Meeting link{form.location_type === 'physical' ? ' (optional)' : ''}<input type="url" required={form.location_type === 'online'} value={form.video_url} onChange={e => change('video_url', e.target.value)} placeholder="https://example.com/meeting" /></label>
          <label>Agenda (optional)<textarea rows={3} value={form.agenda} onChange={e => change('agenda', e.target.value)} placeholder="Review progress and agree next steps." /></label>
          <div className="mt-actions"><button type="button" onClick={() => save(false)}>Save draft</button><button className="mt-primary" type="submit">{busy ? 'Saving…' : 'Preview invitation'}</button></div>
        </fieldset>
      </form>{cancelled && <p className="mt-notice">This meeting is cancelled. Its response links are closed.</p>}
    </section>
    <section className="mt-card"><div className="mt-step">02 <span>Preview</span></div><h2>Review invitation</h2>{preview ? <><div className="mt-invitation"><div className="mt-brand">festio</div><p>You're invited to a meeting</p><MeetingDetails data={form} /><hr /><label>To · {preview.recipients.length} attendees</label>{preview.recipients.map(a => <p key={a.email || a.phone}>{a.name} <span className="mt-muted">{a.email || a.phone}</span></p>)}{preview.cancellations.length > 0 && <p className="mt-error">Cancellation notices: {preview.cancellations.join(', ')}</p>}<label>Email subject</label><p>{preview.subject}</p><label>Attachment</label><p>▧ meeting.ics</p><small>Sent individually to each attendee.</small></div>
      {preview.calendar_mode === 'resend_attachment' && <p className="mt-notice">Calendar file requires manual import with this transport. Native scheduling MIME requires SMTP.</p>}
      {preview.channel_recipients?.map((r, i) => <div className="mt-channel-preview" key={i}><strong>{r.channel.toUpperCase()} · {r.recipient} · {r.method}</strong><p>{r.message}</p><small>{r.readiness === 'ready' ? 'Ready' : r.readiness} · {r.credit_units / 10} credits</small></div>)}
      {preview.channel_recipients?.some(r => r.channel !== 'email') && <label className="mt-consent"><input type="checkbox" checked={paidConfirmed} onChange={e => setPaidConfirmed(e.target.checked)} />I confirm these phone recipients, their consent, and up to {(preview.credit_units || 0) / 10} message credits. Carrier segment costs may vary.</label>}
      <p className="mt-muted">SMS and WhatsApp link to Festio responses; they do not perform native calendar acceptance.</p><p className="mt-muted">Accept, Maybe and Decline responses are recorded in Festio. Google/Outlook replies are not synchronized.</p>{!preview.sending_enabled && <p className="mt-notice">Invitation sending is disabled in this environment.</p>}<div className="mt-actions"><button onClick={() => setPreview(null)}>Back to edit</button><button className="mt-primary" disabled={busy || !preview.sending_enabled || cancelled || preview.channel_recipients?.some(r => r.channel !== 'email') && !paidConfirmed} onClick={publish}>Send invitations</button></div></> : <div className="mt-preview-empty"><span>✉</span><h3>A personal invitation for every attendee</h3><p>Save your details and preview the recipients, message and calendar attachment before sending.</p><small>Saving and previewing never send invitations.</small></div>}</section></div>}
    {selected && <section className="mt-card mt-responses"><div className="mt-step">03 <span>Responses via Festio</span></div><div className="mt-heading"><h2>Organizer view</h2><button disabled={busy} onClick={() => act(async () => {
          const m = await client.getMeeting(selected.id);
          setSelected(m);
          await refresh();
        })}>Refresh status</button></div>{!selected.attendees.length && <p>Responses and delivery status will appear after invitations are sent.</p>}{selected.attendees.map(a => {
        const rows = selected.deliveries.filter(d => d.attendee_id === a.id);
        const version = Math.max(-1, ...rows.map(d => d.sequence));
        return <div className="mt-response" key={a.id}><div><strong>{a.name}</strong><small>{a.email || a.phone}</small></div><span className={`mt-badge ${a.response}`}>{responseLabel[a.response]}{!a.active ? ' · removed' : ''}</span><div>{rows.filter(d => d.sequence === version).map(d => <div className="mt-delivery" key={d.id}><strong>{(d.channel || 'email').toUpperCase()}</strong> {d.recipient} · {d.delivery_status || d.status} · v{d.sequence} {d.method}{d.error && <small role="alert">{d.error}</small>}{['failed', 'setup_required'].includes(d.status) && <button disabled={busy} onClick={() => act(async () => setSelected(await client.retryMeetingDelivery(selected.id, d.id)))}>Retry failed delivery</button>}</div>)}</div></div>;
      })}<small>“Accepted” delivery means the provider accepted the message; it does not confirm inbox delivery.</small>{!cancelled && <div className="mt-cancel">{cancelConfirm ? <><p>Cancel this meeting and queue cancellation notices for everyone previously invited?</p>{cancelPreview?.channel_recipients?.map((r, i) => <p key={i}>{r.channel.toUpperCase()} · {r.recipient} · {r.credit_units / 10} credits · {r.readiness}</p>)}{cancelPreview?.credit_units > 0 && <label className="mt-consent"><input type="checkbox" checked={paidConfirmed} onChange={e => setPaidConfirmed(e.target.checked)} />Confirm up to {cancelPreview.credit_units / 10} credits for cancellation notifications.</label>}<button onClick={() => setCancelConfirm(false)}>Keep meeting</button><button disabled={busy || cancelPreview?.credit_units > 0 && !paidConfirmed} onClick={() => act(async () => {
            const m = await client.cancelMeeting(selected.id, selected.revision, paidConfirmed, cancelPreview?.credit_units || 0);
            choose(m);
            setNotice('Meeting cancelled. Cancellation notices queued for previously invited attendees.');
            await refresh();
          })}>Confirm cancellation</button></> : <button onClick={() => act(async () => {
          setCancelPreview(await client.previewMeeting(selected.id, true));
          setPaidConfirmed(false);
          setCancelConfirm(true);
        })}>Cancel meeting</button>}</div>}</section>}
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
  const preferencesOnly = new URLSearchParams(window.location.search).has('preferences');
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
    if (!preferencesOnly) client.meetingResponsePreview(token).then(d => {
      if (active) setData(d);
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
      meta.remove();
    };
  }, [token, preferencesOnly]);
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
  return <main className="mt-public"><section className="mt-card"><div className="mt-brand">festio</div><p className="mt-eyebrow">MEETING INVITATION</p>{error && <p role="alert" className="mt-error">{error}</p>}{data ? <><MeetingDetails data={data.meeting} /><h3>Will you attend, {data.name}?</h3><div className="mt-reply">{[['accepted', 'Accept'], ['maybe', 'Maybe'], ['declined', 'Decline']].map(([value, label]) => <button key={value} disabled={busy} className={data.response === value ? 'mt-primary' : ''} onClick={() => reply(value)}>{label}</button>)}</div><p role="status">{data.response === 'pending' ? 'Choose a response to let the organizer know.' : `Your response: ${responseLabel[data.response]}`}</p><small>Responses via Festio. Calendar replies are not synchronized.</small></> : !error && !preferencesOnly && <p>Loading your invitation…</p>}<MeetingNotificationPreferences token={token} client={client} /></section></main>;
}
function MeetingNotificationPreferences({
  token,
  client
}) {
  const [prefs, setPrefs] = useState(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    client.meetingNotificationPreferences?.(token).then(d => {
      if (active) setPrefs(d);
    }).catch(e => {
      if (active) setNotice(e.message);
    });
    return () => {
      active = false;
    };
  }, [token]);
  async function stop(channel) {
    setBusy(true);
    try {
      await client.stopMeetingNotifications(token, channel);
      setPrefs(p => ({
        ...p,
        stopped: [...p.stopped, channel]
      }));
      setNotice(`${channel.toUpperCase()} notifications stopped.`);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="mt-preferences">{prefs?.phone && <><h3>Notification preferences</h3><small>{prefs.phone}</small>{['sms', 'whatsapp'].map(c => <button key={c} disabled={busy || prefs.stopped.includes(c)} onClick={() => stop(c)}>{prefs.stopped.includes(c) ? `${c.toUpperCase()} stopped` : `Stop ${c.toUpperCase()} notifications`}</button>)}</>}{notice && <p role="status">{notice}</p>}</div>;
}
