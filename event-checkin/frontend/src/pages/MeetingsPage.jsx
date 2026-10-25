import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { normalizeMeetingUrl } from '../lib/meetingUrl.mjs';
import {meetingStatus,parseMeetingAttendees,mergeMeetingAttendees} from '../lib/meetingWorkspace.mjs';
import MeetingTimezonePicker from '../components/MeetingTimezonePicker';
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
  end_fold: null,
  reminder_minutes: [],
  nudge_hours_before: 0,
  shared_with_org_admins: false,
  invitation_style: 'aurora'
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
  return <><h2>{data.title}</h2>{data.agenda && <p className="mt-agenda">{data.agenda}</p>}<div className="mt-details"><p>▦ {date(data.start)}{data.start.slice(0, 10) !== data.end.slice(0, 10) ? ` – ${date(data.end)}` : ''}</p><p>◷ {time(data.start)} – {time(data.end)}</p><p>◎ {data.timezone}</p>{data.start_fold !== null && data.start_fold !== undefined && <small>Start: {data.start_fold ? 'second' : 'first'} clock occurrence</small>}<p>{data.location_type === 'online' ? 'Online meeting' : data.location}</p>{data.video_url && <a className="mt-join-button" href={data.video_url} target="_blank" rel="noopener noreferrer">JOIN ONLINE</a>}</div></>;
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
  const [sendMode, setSendMode] = useState('now');
  const [sendAt, setSendAt] = useState('');
  const [sendFold, setSendFold] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshError, setRefreshError] = useState('');
  const refreshGeneration = useRef(0);
  const selectedRef = useRef(null);
  selectedRef.current = selected;
  const [orgId,setOrgId] = useState('');
  const [search,setSearch] = useState('');
  const [searchQuery,setSearchQuery] = useState('');
  useEffect(()=>{const timer=setTimeout(()=>setSearchQuery(search),300);return ()=>clearTimeout(timer)},[search]);
  const [view,setView] = useState('all');
  const [offset,setOffset] = useState(0);
  const [summary,setSummary] = useState(null);
  const [externalMeeting,setExternalMeeting] = useState(null);
  const [bulk,setBulk] = useState('');
  const [directoryQuery,setDirectoryQuery] = useState('');
  const [directorySource,setDirectorySource] = useState('contacts');
  const [directoryRows,setDirectoryRows] = useState([]);
  const [directorySearched,setDirectorySearched]=useState(false);
  const followupKeys=useRef({});
  async function refresh() {
    const generation = ++refreshGeneration.current;
    const result = client.listMeetingSummaries ? await client.listMeetingSummaries({org_id:orgId,q:searchQuery,view,offset,limit:20}) : null;
    const rows = result ? result.items : await client.listMeetings();
    if (generation !== refreshGeneration.current) return;
    setMeetings(rows);
    if(result)setSummary(result);
    const current=selectedRef.current;
    if(current){
      const latest=await client.getMeeting(current.id);
      if(generation!==refreshGeneration.current)return;
      setExternalMeeting(latest.revision!==current.revision?{id:latest.id,revision:latest.revision}:null);
      // A newer editor revision is never adopted with the old form.
      setSelected(existing=>existing?.id===latest.id&&existing.revision===latest.revision?latest:existing);
    }
    setUpdatedAt(new Date());
    setRefreshError('');
  }
  useEffect(() => {
    client.meetingOptions?.().then(setOptions).catch(e => setError(e.message));
  }, [client]);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    async function poll() {
      if (disposed || pending || busy || document.visibilityState === 'hidden') return;
      pending = true;
      try { await refresh(); }
      catch { if (!disposed) setRefreshError('Could not refresh meeting status. Try Refresh totals.'); }
      finally { pending = false; }
    }
    poll();
    const timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      disposed = true;
      ++refreshGeneration.current;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [client, busy, orgId, searchQuery, view, offset]);
  function choose(m) {
    followupKeys.current={};
    setExternalMeeting(null);setBulk('');setDirectoryQuery('');setDirectoryRows([]);setDirectorySearched(false);
    setSelected(m);
    setSendMode(m.send_schedule?.status === 'pending' ? 'later' : 'now');
    setSendAt(m.send_schedule?.status === 'pending' ? m.send_schedule.local_time : '');
    setSendFold(m.send_schedule?.send_fold ?? '');
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
    ++refreshGeneration.current;
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
      const data = { ...form, video_url: normalizeMeetingUrl(form.video_url) };
      const m = selected ? await client.updateMeeting(selected.id, {
        ...data,
        revision: selected.revision
      }) : await client.createMeeting(data,orgId);
      setSelected(m);
      setForm(m.draft);
      await refresh();
      if (showPreview) setPreview(await client.previewMeeting(m.id));
      setNotice(showPreview ? 'Review this saved version before sending.' : 'Draft saved. No invitations sent.');
    });
  }
  async function publish() {
    await act(async () => {
      const m = await client.sendMeeting(selected.id, preview.revision, paidConfirmed, preview.credit_units || 0, sendMode === 'later' ? { send_at: sendAt, send_fold: sendFold === '' ? null : Number(sendFold) } : {});
      setSelected(m);
      setPreview(null);
      setPaidConfirmed(false);
      setNotice(m.send_schedule?.status === 'pending' ? `Invitations scheduled for ${m.send_schedule.local_time.replace('T', ' ')} (${m.send_schedule.timezone}). Nothing has been sent yet.` : 'Invitations queued for sending now. Delivery status updates below.');
      await refresh();
    });
  }
  function download(data,type){const link=document.createElement('a');const url=URL.createObjectURL(new Blob([data.content],{type}));link.href=url;link.download=data.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function addPeople(people){const merged=mergeMeetingAttendees(form.attendees,people);change('attendees',merged.people);setNotice(`${merged.added} attendees added. Duplicates were skipped. Review before sending.`);}
  function importPeople(text){try{addPeople(parseMeetingAttendees(text));setBulk('')}catch(e){setError(e.message)}}
  async function selectMeeting(m){await act(async()=>choose(await client.getMeeting(m.id)))}
  async function followup(aid){await act(async()=>{
    const action=aid||'pending';const key=followupKeys.current[action]||(followupKeys.current[action]=crypto.randomUUID());
    if(aid){setSelected(await client.resendMeetingAttendee(selected.id,aid,selected.revision,key));setNotice('Email invitation queued again for this attendee. No paid channels were used.');}
    else{const result=await client.nudgeMeetingPending(selected.id,selected.revision,key);setNotice(`${result.queued} pending-reply email nudges queued. No paid channels were used.`);}
    await refresh();
  })}
  const cancelled = selected?.status === 'cancelled';
  const archived = !!selected?.archived;
  const counts = summary?.totals || {meetings:meetings?.length||0,pending_sends:meetings?.filter(m=>m.send_schedule?.status==='pending').length||0,accepted:meetings?.reduce((n,m)=>n+(m.attendees||[]).filter(a=>a.active&&a.response==='accepted').length,0)||0};
  return <div className="mt-workspace">
    <header className="mt-heading mt-hero"><div><span className="mt-eyebrow">FESTIO MEETINGS · YOUR ORGANIZER SPACE</span><h1>Make time for<br /><em>what matters.</em></h1><p>Bring the right people together. Make the invitation feel personal.</p><div className="mt-hero-tags"><span>✦ Beautiful invitations</span><span>◷ Send now or later</span><span>✓ Track every reply</span></div></div><button className="mt-primary" onClick={() => {
        setSelected(null);setBulk('');setDirectoryQuery('');setDirectoryRows([]);setExternalMeeting(null);
        setSendMode('now');
        setSendAt('');
        setSendFold('');
        setForm(empty());
        setPreview(null);
        setPaidConfirmed(false);
        setEditing(true);
        setError('');
        setNotice('');
        setCancelConfirm(false);
      }}>＋ Create a meeting</button></header>
    <div className="mt-overview"><div><span className="mt-overview-icon">▦</span><div><strong>{meetings===null?'—':counts.meetings}</strong><span>Unarchived meetings</span></div></div><div><span className="mt-overview-icon">◷</span><div><strong>{meetings===null?'—':counts.pending_sends}</strong><span>Pending invitation sends</span></div></div><div><span className="mt-overview-icon">✓</span><div><strong>{meetings===null?'—':counts.accepted}</strong><span>Attendees accepted</span></div></div></div>
    <div className="mt-section-heading"><small>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · Refreshes every 10 seconds while this tab is visible` : 'Loading live totals…'}</small><button disabled={busy} onClick={() => act(refresh)}>Refresh totals</button></div>
    <p className="mt-muted">Totals cover unarchived meetings in this organization. Pending sends are invitations scheduled for later. Attendees accepted counts replies through Festio, independently of provider delivery status.</p>
    {refreshError && <p role="status" className="mt-error">{refreshError}</p>}
    {selected && (externalMeeting?.id===selected.id&&externalMeeting.revision!==selected.revision||meetings?.some(m => m.id === selected.id && m.revision !== selected.revision)) && <p role="status" className="mt-notice">This meeting changed elsewhere. Your unsaved edits are preserved. <button disabled={busy} onClick={()=>{if(window.confirm('Reload the latest version and replace your current unsaved edits?'))selectMeeting(selected)}}>Reload current meeting</button></p>}
    {error && <div role="alert" className="mt-error">{error} <button onClick={() => act(refresh)}>Reload meetings</button></div>}
    {notice && <p role="status" className="mt-notice">{notice}</p>}
    <div className="mt-section-heading"><h2>Your meetings</h2><span>Send schedules and attendee replies, clearly separated</span></div>
    <div className="mt-list-tools">
      {!!options.organizations?.length&&<label>Organization<select aria-label="Meeting organization" value={orgId||summary?.org_id||options.default_org_id||''} disabled={busy} onChange={e=>{if(editing&&!window.confirm('Switch organization and close the current editor? Save your changes first.'))return;setOrgId(e.target.value);setOffset(0);setSelected(null);setEditing(false);setPreview(null);setDirectoryRows([]);}}>{options.organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
      <label>Search meetings<input type="search" placeholder="Search by meeting title" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/></label>
      <label>Show<select aria-label="Meeting view" value={view} onChange={e=>{setView(e.target.value);setOffset(0)}}>{[['all','All unarchived'],['upcoming','Upcoming'],['past','Past'],['draft','Drafts'],['cancelled','Cancelled'],['archived','Archived']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
    </div>
    <div className="mt-list" aria-label="Your meetings">{meetings===null?<p>Loading meetings…</p>:meetings.length?meetings.map(m=><button disabled={busy} key={m.id} className={selected?.id===m.id?'selected':''} onClick={()=>selectMeeting(m)}><strong>{m.draft.title}</strong><span>{m.draft.start.replace('T',' ')} · {m.draft.timezone}</span><span>{meetingStatus(m)}{m.revision!==m.published_revision&&m.status==='scheduled'?' · unsent changes':''}</span>{m.response_counts&&<small>{m.response_counts.accepted||0} accepted · {m.response_counts.maybe||0} maybe · {m.response_counts.declined||0} declined · {m.response_counts.pending||0} awaiting reply</small>}</button>):<p>No meetings match this view. Create a meeting or change the filters.</p>}</div>
    {summary&&<div className="mt-pagination"><span>{summary.total} matching meetings · Page {Math.floor(offset/20)+1}</span><button disabled={busy||!offset} onClick={()=>setOffset(o=>Math.max(0,o-20))}>Previous</button><button disabled={busy||offset+20>=summary.total} onClick={()=>setOffset(o=>o+20)}>Next</button></div>}
    {selected&&<section className="mt-selected-summary"><div><span className="mt-eyebrow">SELECTED MEETING</span><h2>{selected.draft.title}</h2><p>{selected.draft.start.replace('T',' ')} · {selected.draft.timezone}</p></div><span className={`mt-state-pill ${archived?'archived':cancelled?'cancelled':'active'}`}>{meetingStatus(selected)}</span><p className="mt-summary-help">{archived?'Archived · automatic follow-ups stopped':cancelled?'Cancelled · response links closed':selected.status==='scheduled'?'Invitation sent · manage replies and delivery below':'Draft · no invitations sent'}</p></section>}
    {selected&&<div className="mt-meeting-tools">
      <button disabled={busy} onClick={()=>{setSelected(null);setForm({...empty(),...structuredClone(form),title:'Copy of '+form.title,start:'',end:''});setPreview(null);setEditing(true);setNotice('New draft copy. Choose a future date and review attendees before saving.');}}>Duplicate</button>
      <button disabled={busy||cancelled} onClick={()=>act(async()=>download(await client.meetingCalendar(selected.id),'text/calendar;charset=utf-8'))}>Add to calendar (.ics)</button>
      <button disabled={busy||!selected.attendees.length} onClick={()=>act(async()=>download(await client.exportMeetingResponses(selected.id),'text/csv;charset=utf-8'))}>Export replies CSV</button>
      <button disabled={busy} onClick={()=>act(async()=>{const m=await client.archiveMeeting(selected.id,selected.revision,!archived);setOffset(0);choose(m);setNotice(m.archived?'Archived. Automatic reminders and pending follow-ups have stopped. Existing invitations remain available.':'Meeting restored. Previous automatic reminders remain stopped; review and send an updated invitation to set a new reminder schedule.');await refresh();})}>{archived?'Restore meeting':'Archive meeting'}</button>
      {(selected.has_published_invitation===false||selected.sequence<0)&&selected.send_schedule?.status!=='pending'&&<button disabled={busy} onClick={()=>{if(window.confirm('Permanently delete this unpublished draft?'))act(async()=>{await client.deleteMeetingDraft(selected.id,selected.revision);setSelected(null);setEditing(false);setPreview(null);await refresh();setNotice('Draft deleted. No invitations were sent.');})}}>Delete draft</button>}
      {archived&&<small>Automatic follow-ups are stopped. Restore before editing or sending; existing attendee responses remain available.</small>}
    </div>}
    {selected?.send_schedule && ['pending','blocked','cancelled'].includes(selected.send_schedule.status) && <div className="mt-scheduled-strip"><div><strong>{selected.send_schedule.status === 'pending' ? '◷ Invitations scheduled' : selected.send_schedule.status === 'blocked' ? 'Invitation sending needs attention' : 'Scheduled sending cancelled'}</strong><p>{selected.send_schedule.local_time?.replace('T',' ')} · {selected.send_schedule.timezone}{selected.send_schedule.error ? ` · ${selected.send_schedule.error}` : ''}</p></div>{selected.send_schedule.status === 'pending' && <button disabled={busy} onClick={() => act(async () => { const m = await client.cancelMeetingSchedule(selected.id,selected.revision); setSelected(m); setPreview(null); setNotice('Scheduled sending cancelled. Your meeting is still available.'); await refresh(); })}>Cancel scheduled send</button>}</div>}
    {editing && <div className="mt-grid"><section className="mt-card"><div className="mt-step">01 <span>The meeting</span></div><h2>{selected ? 'Meeting details' : 'Schedule a meeting'}</h2>
      <form onSubmit={e => {
          e.preventDefault();
          save(true);
        }}>
        <fieldset disabled={busy || cancelled || archived}>
          <label>Meeting title<input required maxLength={200} value={form.title} onChange={e => change('title', e.target.value)} placeholder="Project catch-up" /></label>
          <div className="mt-two"><label>Start<input type="datetime-local" required value={form.start} onChange={e => change('start', e.target.value)} /></label><label>End<input type="datetime-local" required value={form.end} onChange={e => change('end', e.target.value)} /></label></div>
          <MeetingTimezonePicker value={form.timezone} onChange={value=>change('timezone',value)}/>
          <details className="mt-dst"><summary>Time occurs twice when clocks go back?</summary><p>Choose which occurrence for ambiguous local times.</p><div className="mt-two">{['start', 'end'].map(k => <label key={k}>{k === 'start' ? 'Start occurrence' : 'End occurrence'}<select value={form[`${k}_fold`] ?? ''} onChange={e => change(`${k}_fold`, e.target.value === '' ? null : Number(e.target.value))}><option value="">Automatic (unambiguous only)</option><option value="0">First occurrence</option><option value="1">Second occurrence</option></select></label>)}</div></details>
          <label>Attendees <span className="mt-muted">Names and email addresses · up to 50</span></label>
          <details className="mt-bulk"><summary>Add several attendees or choose existing contacts</summary><p>Paste one email per line, Name &lt;email&gt;, or spreadsheet rows with Name and Email columns. Imports select email only; phone channels still require individual consent.</p><textarea aria-label="Paste attendee list" rows={4} value={bulk} onChange={e=>setBulk(e.target.value)} placeholder={'Name,Email\nAlex Morgan,alex@example.com'}/><div className="mt-actions"><button type="button" onClick={()=>importPeople(bulk)}>Add pasted attendees</button><label className="mt-upload">Import CSV<input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files[0];if(file){if(file.size>100000)setError('Use a CSV smaller than 100 KB.');else importPeople(await file.text());}e.target.value='';}}/></label></div>
          {client.meetingDirectory&&<div className="mt-directory"><label>Search existing<select value={directorySource} onChange={e=>{setDirectorySource(e.target.value);setDirectoryRows([]);setDirectorySearched(false)}}><option value="contacts">Organization contacts</option><option value="guests">Event guests in this organization</option></select></label><input aria-label="Search contact name or email" placeholder="Name or email · at least 2 characters" value={directoryQuery} onChange={e=>{setDirectoryQuery(e.target.value);setDirectorySearched(false)}}/><button type="button" disabled={busy||directoryQuery.trim().length<2} onClick={()=>act(async()=>{setDirectoryRows(await client.meetingDirectory({org_id:orgId||summary?.org_id||options.default_org_id,q:directoryQuery,source:directorySource}));setDirectorySearched(true);})}>Find people</button>{directorySearched&&directoryQuery.trim().length>=2&&!directoryRows.length&&<p role="status" className="mt-directory-empty">No matching {directorySource==='contacts'?'organization contacts':'event guests'}. Try the other source, paste a list, or add attendees below.</p>}<div>{directoryRows.map(person=><button type="button" key={person.email} onClick={()=>{try{addPeople([{...person,channels:['email']}])}catch(e){setError(e.message)}}}>＋ {person.name} · {person.email}</button>)}</div></div>}</details>
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
          <label>Meeting link{form.location_type === 'physical' ? ' (optional)' : ''}<input type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" required={form.location_type === 'online'} value={form.video_url} onChange={e => change('video_url', e.target.value)} onBlur={e => change('video_url', normalizeMeetingUrl(e.target.value))} placeholder="meet.google.com/abc-defg-hij" /></label>
          <details className="mt-followup-settings"><summary>Reminders & collaboration</summary><p>Optional email follow-ups use the published invitation. SMS and WhatsApp are not resent automatically. Declined replies and reminder opt-outs are excluded.</p><div className="mt-reminder-options">{[[1440,'1 day before'],[60,'1 hour before'],[30,'30 minutes before'],[10,'10 minutes before']].map(([minutes,label])=><label key={minutes}><input type="checkbox" checked={(form.reminder_minutes||[]).includes(minutes)} onChange={e=>change('reminder_minutes',e.target.checked?[...(form.reminder_minutes||[]),minutes]:(form.reminder_minutes||[]).filter(v=>v!==minutes))}/>{label}</label>)}</div><label>Automatic nudge for pending replies<select value={form.nudge_hours_before||0} onChange={e=>change('nudge_hours_before',Number(e.target.value))}><option value={0}>Off</option><option value={24}>1 day before</option><option value={48}>2 days before</option></select></label><small>Send times already past when invitations publish are skipped.</small><label className="mt-consent"><input type="checkbox" checked={!!form.shared_with_org_admins} disabled={!!selected?.organizer_id&&selected.organizer_id!==options.user_id} onChange={e=>change('shared_with_org_admins',e.target.checked)}/>Allow this organization’s owners and admins to co-manage this meeting.</label><small>Private by default. Co-managers can edit, send, cancel and export replies; only the organizer changes sharing.</small></details>
          <label>Agenda (optional)<textarea rows={3} value={form.agenda} onChange={e => change('agenda', e.target.value)} placeholder="Review progress and agree next steps." /></label>
          <div className="mt-actions"><button type="button" onClick={() => save(false)}>Save draft</button><button className="mt-primary" type="submit">{busy ? 'Saving…' : 'Preview invitation'}</button></div>
        </fieldset>
      </form>{cancelled && <p className="mt-notice">This meeting is cancelled. Its response links are closed.</p>}
    </section>
    <section className="mt-card mt-preview-panel"><div className="mt-step">02 <span>The invitation</span></div><h2>Make a great first impression.</h2><div className="mt-style-picker" role="group" aria-label="Invitation style">{[['aurora','Aurora','Fresh & welcoming'],['cobalt','Cobalt','Bold & contemporary'],['terracotta','Terracotta','Warm & considered']].map(([value,label,description]) => <button key={value} className={`mt-style mt-style-${value} ${(form.invitation_style || 'aurora') === value ? 'selected' : ''}`} aria-pressed={(form.invitation_style || 'aurora') === value} onClick={() => change('invitation_style',value)} disabled={busy || cancelled || archived}><span className="mt-style-swatch">✦</span><strong>{label}</strong><small>{description}</small></button>)}</div>
      <div className="mt-send-panel"><div className="mt-section-heading"><h3>When should invitations go out?</h3><span>Separate from the meeting time</span></div><div className="mt-send-choices">{[['now','Send now','Queue invitations after your review'],['later','Schedule send','Pick the right moment to reach people']].map(([value,label,help]) => <label key={value} className={sendMode===value ? 'selected' : ''}><input type="radio" name="invitation-timing" checked={sendMode===value} onChange={() => setSendMode(value)} /><span><strong>{label}</strong><small>{help}</small></span></label>)}</div>{sendMode==='later' && <><label>Send invitations on<input type="datetime-local" value={sendAt} onChange={e=>setSendAt(e.target.value)} /></label><small>Timezone: <strong>{form.timezone}</strong>. Choose a time before the meeting begins.</small><details className="mt-dst"><summary>Send time occurs twice when clocks go back?</summary><label>Send time occurrence<select value={sendFold} onChange={e=>setSendFold(e.target.value)}><option value="">Automatic (unambiguous only)</option><option value="0">First occurrence</option><option value="1">Second occurrence</option></select></label></details></>}
      {!preview && <p className="mt-muted">Preview the invitation first to review your message and recipients.</p>}{(preview ? !preview.sending_enabled : options.sending_enabled === false) && <p className="mt-notice">Sending needs setup. Drafts and previews are available; an administrator must configure delivery before invitations can go out.</p>}<button className="mt-primary mt-send-action" disabled={busy || !preview || !preview.sending_enabled || cancelled || archived || sendMode==='later' && !sendAt || preview?.channel_recipients?.some(r => r.channel !== 'email') && !paidConfirmed} onClick={publish}>{busy ? 'Working…' : sendMode === 'later' ? 'Schedule invitations' : 'Send now'}</button><small>Each attendee receives a private invitation. Saving never sends.</small></div>
      {preview&&<p className="mt-notice">Reviewed follow-ups: {(form.reminder_minutes||[]).length?form.reminder_minutes.map(n=>n===1440?'1 day':n+' min').join(', ')+' before the meeting':'No reminders'}{form.nudge_hours_before?' · Pending-reply nudge '+form.nudge_hours_before+' hours before':''}. Email only.</p>}
      {preview ? <><div className="mt-invitation"><iframe title="Email invitation preview" sandbox="" srcDoc={preview.html} /><div className="mt-recipient-summary"><label>To · {preview.recipients.length} {preview.recipients.length === 1 ? 'attendee' : 'attendees'}</label>{preview.recipients.map(a => <p key={a.email || a.phone}>{a.name} <span className="mt-muted">{a.email || a.phone}</span></p>)}{preview.cancellations.length > 0 && <p className="mt-error">Cancellation notices: {preview.cancellations.join(', ')}</p>}<label>Email subject</label><p>{preview.subject}</p><label>Attachment</label><p>▧ meeting.ics</p><small>Sent individually to each attendee.</small></div></div>
      {preview.calendar_mode === 'resend_attachment' && <p className="mt-notice">A calendar file is included. Guests can import it into their calendar and reply using their private Festio link. Calendar-app reply syncing is not enabled.</p>}
      {preview.channel_recipients?.map((r, i) => <div className="mt-channel-preview" key={i}><strong>{r.channel.toUpperCase()} · {r.recipient} · {r.method}</strong><p>{r.message}</p><small>{r.readiness === 'ready' ? 'Ready' : r.readiness} · {r.credit_units / 10} credits</small></div>)}
      {preview.channel_recipients?.some(r => r.channel !== 'email') && <label className="mt-consent"><input type="checkbox" checked={paidConfirmed} onChange={e => setPaidConfirmed(e.target.checked)} />I confirm these phone recipients, their consent, and up to {(preview.credit_units || 0) / 10} message credits. Carrier segment costs may vary.</label>}
      <p className="mt-muted">SMS and WhatsApp link to Festio responses; they do not perform native calendar acceptance.</p><p className="mt-muted">Accept, Maybe and Decline responses are recorded in Festio. Google/Outlook replies are not synchronized.</p><div className="mt-actions"><button onClick={() => setPreview(null)}>Back to edit</button></div></> : <div className="mt-preview-empty"><span>✉</span><h3>A personal invitation for every attendee</h3><p>Save your details and preview the recipients, message and calendar attachment before sending.</p><small>Saving and previewing never send invitations.</small></div>}</section></div>}
    {selected && <section className="mt-card mt-responses"><div className="mt-step">03 <span>Responses via Festio</span></div><div className="mt-heading"><h2>Organizer view</h2><button disabled={busy} onClick={() => act(async () => {
          await refresh();
        })}>Refresh status</button></div><p className="mt-muted">{selected.attendees.filter(a=>a.active&&a.response==='accepted').length} accepted · {selected.attendees.filter(a=>a.active&&a.response==='maybe').length} maybe · {selected.attendees.filter(a=>a.active&&a.response==='declined').length} declined · {selected.attendees.filter(a=>a.active&&a.response==='pending').length} awaiting reply</p>{selected.status==='scheduled'&&!archived&&<button disabled={busy||!selected.attendees.some(a=>a.active&&a.response==='pending'&&a.email)} onClick={()=>{if(window.confirm('Send an email nudge to eligible attendees who have not replied?'))followup();}}>Nudge pending replies by email</button>}{selected.status==='scheduled'&&!archived&&selected.attendees.filter(a=>a.active).length>0&&!selected.attendees.some(a=>a.active&&a.response==='pending')&&<p className="mt-reply-complete">✓ Everyone has replied. No pending-reply nudge is needed.</p>}{!!selected.followup_schedule?.length&&<details className="mt-followup-status"><summary>Scheduled email follow-ups</summary>{selected.followup_schedule.map(item=><p key={item.purpose}>{item.purpose.replace(':',' · ')} · {new Date(item.due_at+'Z').toLocaleString()} (your device time) · {archived&&item.status==='pending'?'stopped · meeting archived':item.status}{item.reason?' · '+item.reason:''}{item.recipients!==undefined?' · '+item.recipients+' recipients':''}</p>)}</details>}{!selected.attendees.length && <p>Responses and delivery status will appear after invitations are sent.</p>}{selected.attendees.map(a => {
        const rows = selected.deliveries.filter(d => d.attendee_id === a.id);
        const version = Math.max(-1, ...rows.map(d => d.sequence));
        return <div className="mt-response" key={a.id}><div><strong>{a.name}</strong><small>{a.email || a.phone}</small></div><span className={`mt-badge ${a.response}`}>{responseLabel[a.response]}{!a.active ? ' · removed' : ''}</span><div>{rows.filter(d => d.sequence === version).map(d => <div className="mt-delivery" data-state={d.delivery_status||d.status} key={d.id}><strong>{(d.channel || 'email').toUpperCase()}</strong> {d.recipient} · {d.delivery_status || (d.status==='accepted'?(d.receipt_tracking==='unavailable'?'Sent · delivery receipt unavailable':'Sent · awaiting delivery receipt'):d.status)} · {d.method==='CANCEL'?'Cancellation':'Invitation'}{d.purpose&&d.purpose!=='invitation'?' · '+d.purpose.split(':')[0]:''}{d.error && <small role="alert">{d.error}</small>}{['failed', 'setup_required'].includes(d.status) && <button disabled={busy} onClick={() => act(async () => setSelected(await client.retryMeetingDelivery(selected.id, d.id)))}>Retry failed delivery</button>}</div>)}</div>{a.active&&selected.status==='scheduled'&&<div className="mt-attendee-actions"><button disabled={busy} onClick={()=>act(async()=>{const result=await client.meetingAttendeeLink(selected.id,a.id);await navigator.clipboard.writeText(result.url);setNotice('Personal response link copied. Share only with '+a.name+'.');})}>Copy response link</button>{a.email&&<button disabled={busy||archived||a.response==='declined'||a.reminders_stopped} onClick={()=>{if(window.confirm('Resend this attendee’s email invitation?'))followup(a.id);}}>Resend email</button>}{a.reminders_stopped&&<small>Follow-up emails stopped by attendee</small>}</div>}</div>;
      })}<small>“Accepted” delivery means the provider accepted the message; it does not confirm inbox delivery.</small>{!cancelled && !archived && <div className="mt-cancel">{cancelConfirm ? <><p>Cancel this meeting and queue cancellation notices for everyone previously invited?</p>{cancelPreview?.channel_recipients?.map((r, i) => <p key={i}>{r.channel.toUpperCase()} · {r.recipient} · {r.credit_units / 10} credits · {r.readiness}</p>)}{cancelPreview?.credit_units > 0 && <label className="mt-consent"><input type="checkbox" checked={paidConfirmed} onChange={e => setPaidConfirmed(e.target.checked)} />Confirm up to {cancelPreview.credit_units / 10} credits for cancellation notifications.</label>}<button onClick={() => setCancelConfirm(false)}>Keep meeting</button><button disabled={busy || cancelPreview?.credit_units > 0 && !paidConfirmed} onClick={() => act(async () => {
            const m = await client.cancelMeeting(selected.id, selected.revision, paidConfirmed, cancelPreview?.credit_units || 0);
            choose(m);
            setNotice('Meeting cancelled. Any pending send was stopped; cancellation notices are queued only for previously published invitations.');
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
  return <main className="mt-public" data-style={data?.meeting.invitation_style || 'aurora'}><section className="mt-card"><div className="mt-brand">festio</div><p className="mt-eyebrow">MEETING INVITATION</p>{error && <p role="alert" className="mt-error">{error}</p>}{data ? <><MeetingDetails data={data.meeting} /><h3>Will you attend, {data.name}?</h3><div className="mt-reply">{[['accepted', 'Accept'], ['maybe', 'Maybe'], ['declined', 'Decline']].map(([value, label]) => <button key={value} disabled={busy} className={data.response === value ? 'mt-primary' : ''} onClick={() => reply(value)}>{label}</button>)}</div><p role="status">{data.response === 'pending' ? 'Choose a response to let the organizer know.' : `Your response: ${responseLabel[data.response]}`}</p><small>Responses via Festio. Calendar replies are not synchronized. Keep this personal link private; replies close 24 hours after the meeting ends.</small></> : !error && !preferencesOnly && <p>Loading your invitation…</p>}<MeetingNotificationPreferences token={token} client={client} /></section></main>;
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
        stopped: [...p.stopped, channel],
        reminders_stopped: channel==='reminders'?true:p.reminders_stopped
      }));
      setNotice(`${channel.toUpperCase()} notifications stopped.`);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="mt-preferences">{prefs?.email&&<button disabled={busy||prefs.reminders_stopped} onClick={()=>stop('reminders')}>{prefs.reminders_stopped?'Follow-up emails stopped':'Stop reminder and follow-up emails'}</button>}{prefs?.phone && <><h3>Notification preferences</h3><small>{prefs.phone}</small>{['sms', 'whatsapp'].map(c => <button key={c} disabled={busy || prefs.stopped.includes(c)} onClick={() => stop(c)}>{prefs.stopped.includes(c) ? `${c.toUpperCase()} stopped` : `Stop ${c.toUpperCase()} notifications`}</button>)}</>}{notice && <p role="status">{notice}</p>}</div>;
}
