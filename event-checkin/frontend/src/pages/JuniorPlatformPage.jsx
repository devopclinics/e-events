import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import RedesignShell from './redesign/RedesignShell'
import './JuniorPlatformPage.css'

const label = value => (value || '').replaceAll('_', ' ')
const stamp = (value, tz) => value ? new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString([], { timeZone: tz || 'UTC' }) : '—'
const field = (data, key) => String(data.get(key) || '').trim()
const checked = (data, key) => data.get(key) === 'on'
const relationOptions = <><option value="parent">Parent</option><option value="chaperone">Chaperone</option><option value="adult_sibling">Adult sibling (18+)</option></>

function ContactFields() {
  return <fieldset><legend>Guardian / authorized collector</legend>
    <label>Name<input name="guardian_name" required maxLength={255} /></label>
    <label>Relationship<select name="relationship">{relationOptions}</select></label>
    <label>Guardian email<input name="email" type="email" /></label>
    <label>Guardian mobile<input name="phone" type="tel" placeholder="+12025550146" /></label>
    <label className="jp-check"><input name="sms_consent" type="checkbox" />SMS notification permission recorded</label>
    <label className="jp-check"><input name="adult_verified" type="checkbox" />Staff verified this person is an adult (18+)</label>
    <label className="jp-check"><input name="pickup_authorized" type="checkbox" />Authorized to collect this child</label>
    <label className="jp-check"><input name="notify" type="checkbox" defaultChecked />Receive guardian email and SMS updates</label>
  </fieldset>
}
function contactBody(data) {
  return { name: field(data, 'guardian_name'), relationship: field(data, 'relationship'), email: field(data, 'email') || null,
    phone: field(data, 'phone') || null, sms_consent: checked(data, 'sms_consent'), adult_verified: checked(data, 'adult_verified'),
    pickup_authorized: checked(data, 'pickup_authorized'), notify: checked(data, 'notify') }
}
function Button({ children, busy, ...props }) { return <button disabled={busy} {...props}>{children}</button> }

function ChildPanel({ child, config, outings, role, call, refresh, close, busy, tz }) {
  const [mode, setMode] = useState('dropoff')
  const attempt = useRef(null)
  const support = ['support', 'supervisor'].includes(role)
  const intake = ['intake', 'supervisor'].includes(role)
  const [error, setError] = useState('')
  async function execute(data) {
    const signature = JSON.stringify(data)
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() }
    await call(`/children/${child.id}/actions`, 'POST', { ...data, version: child.version, request_id: attempt.current.id })
    attempt.current = null
    await refresh()
  }
  async function submit(e) {
    e.preventDefault(); setError('')
    const data = new FormData(e.currentTarget)
    try {
      if (mode === 'contact') await call(`/children/${child.id}/contacts`, 'POST', contactBody(data))
      else if (mode === 'correction') await call(`/children/${child.id}`, 'PATCH', { version: child.version, name: field(data, 'name'), classroom: field(data, 'classroom'), reason: field(data, 'notes') })
      else await execute({ action: mode, adult_name: field(data, 'adult_name') || null, relationship: field(data, 'relationship') || null,
        phone: field(data, 'phone') || null, contact_id: field(data, 'contact_id') || null, identity_checked: checked(data, 'identity_checked'),
        adult_verified: checked(data, 'adult_verified'), allergy: data.has('allergy') && field(data, 'allergy') !== '' ? field(data, 'allergy') === 'yes' : null,
        accommodation: data.has('accommodation') && field(data, 'accommodation') !== '' ? field(data, 'accommodation') === 'yes' : null,
        notes: field(data, 'notes') || null, wristband_assigned: checked(data, 'wristband_assigned'), outing_id: field(data, 'outing_id') || null })
      await refresh()
    } catch (err) { setError(err.message); if (err.status === 409) await refresh() }
  }
  return <section className="jp-panel jp-detail" aria-label="Child record">
    <div className="jp-row"><div><small>{child.reference || 'JP child record'}</small><h2>{child.name}</h2><p>{child.age_group} · {child.classroom}</p></div><Button busy={busy} type="button" onClick={close}>Close</Button></div>
    <p className={`jp-status jp-${child.location}`}>{label(child.location)}</p>
    <div className="jp-screening"><span>Allergy: {child.allergy === null ? 'Not screened' : child.allergy ? child.allergy_cleared ? 'Desk cleared' : 'Desk required' : 'No'}</span><span>Accommodation: {child.accommodation === null ? 'Not screened' : child.accommodation ? child.accommodation_cleared ? 'Desk cleared' : 'Desk required' : 'No'}</span></div>
    {support && <details><summary>Restricted desk notes</summary><p>Allergy: {child.allergy_notes || 'No details recorded'}</p><p>Accommodation: {child.accommodation_notes || 'No details recorded'}</p></details>}
    {!child.contacts.some(c => c.pickup_authorized && c.adult_verified) && <p className="jp-warning">No authorized adult collector. Final release is blocked; refer to the help desk.</p>}
    <label>Staff action<select value={mode} disabled={busy} onChange={e => { setMode(e.target.value); setError(''); attempt.current = null }}>
      <option value="dropoff">Record drop-off</option><option value="screening">Complete screening</option>
      {support && <><option value="clear_allergy">Clear allergy desk</option><option value="clear_accommodation">Clear accommodation desk</option></>}
      <option value="classroom">Confirm classroom arrival</option><option value="clinic">Temporary departure: clinic</option><option value="other">Temporary departure: other</option>
      <option value="return">Return from clinic / other</option><option value="outing_depart">Outing departure</option><option value="outing_return">Outing return to JP</option><option value="release">Final pickup / release</option>
      {intake && <><option value="contact">Add guardian / collector</option><option value="correction">Correct name / classroom</option></>}
    </select></label>
    <form key={mode} onSubmit={submit}>
      {mode === 'dropoff' && <><label>Adult dropping off<input name="adult_name" required maxLength={255} /></label><label>Relationship<select name="relationship">{relationOptions}</select></label><label>Drop-off phone (optional)<input name="phone" type="tel" placeholder="+12025550146" /></label><label className="jp-check"><input name="identity_checked" type="checkbox" required />Staff verified drop-off in person</label><label className="jp-check"><input name="adult_verified" type="checkbox" />Sibling age 18+ verified (required for sibling)</label></>}
      {['dropoff', 'screening'].includes(mode) && <fieldset><legend>Screening</legend>{['allergy', 'accommodation'].map(name => <label key={name}>{name === 'allergy' ? 'Allergy profile?' : 'Special accommodation?'}<select name={name} required><option value="">Select Yes or No</option><option value="yes">Yes — refer to desk</option><option value="no">No</option></select></label>)}</fieldset>}
      {['clear_allergy', 'clear_accommodation'].includes(mode) && <><label>Restricted details<input name="notes" required maxLength={2000} /></label><label className="jp-check"><input name="wristband_assigned" type="checkbox" required />Details reviewed and wristband assigned</label></>}
      {['clinic', 'other'].includes(mode) && <><label>Accompanying adult<input name="adult_name" required maxLength={255} /></label><label>Reason / internal note{mode === 'other' ? ' (required)' : ' (optional)'}<textarea name="notes" required={mode === 'other'} maxLength={2000} /></label><p>Internal details are excluded from guardian messages.</p></>}
      {['outing_depart', 'outing_return'].includes(mode) && <label>Outing<select name="outing_id" required><option value="">Choose an outing</option>{outings.filter(o => !o.closed && o.members.some(m => m.id === child.id)).map(o => <option key={o.id} value={o.id}>{o.name} · {o.date}</option>)}</select></label>}
      {mode === 'release' && <><label>Authorized collector<select name="contact_id" required><option value="">Select verified adult</option>{child.contacts.filter(c => c.pickup_authorized && c.adult_verified).map(c => <option key={c.id} value={c.id}>{c.name} · {label(c.relationship)}</option>)}</select></label><label className="jp-check"><input name="identity_checked" type="checkbox" required />Identity checked in person against the authorized collector</label><p>Different collector? Refer to the help desk before release.</p></>}
      {mode === 'contact' && <ContactFields />}
      {mode === 'correction' && <><label>Correct child name<input name="name" required defaultValue={child.name} /></label><label>Classroom<select name="classroom" defaultValue={child.classroom}>{config.classrooms.map(x => <option key={x}>{x}</option>)}</select></label><label>Reason for correction<textarea name="notes" required minLength={3} /></label></>}
      {error && <p role="alert" className="jp-error">{error}</p>}
      <Button busy={busy} className="jp-primary">{busy ? 'Recording…' : mode === 'release' ? 'Confirm release & notify guardian' : 'Record & queue guardian updates'}</Button>
      <p className="jp-muted">Email and SMS go to designated guardians. {config.notifications_enabled ? 'Review delivery in Notifications.' : 'Sending is paused; notices remain recorded for review.'}</p>
    </form>
    {intake && <details><summary>Guardian contacts and authorizations</summary>{child.contacts.map(c => <div key={c.id} className="jp-contact"><strong>{c.name} · {label(c.relationship)}</strong><p>{c.email || 'Email missing'} · {c.phone || 'Phone missing'}</p><p>{c.pickup_authorized ? 'Pickup authorized' : 'Pickup not authorized'} · SMS {c.sms_consent ? 'permission recorded' : 'permission missing'}</p><Button busy={busy} type="button" onClick={async () => { if (!window.confirm(`Remove ${c.name} from this child’s contacts?`)) return; try { await call(`/children/${child.id}/contacts/${c.id}`, 'DELETE'); await refresh() } catch (err) { setError(err.message) } }}>Remove authorization / contact</Button></div>)}</details>}
    <details><summary>Movement history ({child.history.length})</summary><ol className="jp-history">{child.history.map(m => <li key={m.id}><strong>{label(m.action)}</strong> · {stamp(m.occurred_at, tz)}<br />{label(m.from_location)} → {label(m.to_location)}{m.adult_name && <span> · {m.adult_name}</span>}</li>)}</ol></details>
  </section>
}

function AddChild({ config, call, done, busy }) {
  const [error, setError] = useState('')
  return <section className="jp-panel"><h2>Add a missing child</h2><p>Search the roster first. Adding a child does not admit them or authorize release.</p><form onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setError('')
    try { await call('/children', 'POST', { name: field(data, 'name'), reference: field(data, 'reference') || null, age_group: field(data, 'age_group'), classroom: field(data, 'classroom'), guardian: field(data, 'guardian_name') ? contactBody(data) : null, confirm_same_name: checked(data, 'confirm_same_name') }); await done() } catch (err) { setError(err.message) }
  }}><label>Child’s real full name<input name="name" required maxLength={255} /></label><label>Roster reference / badge ID (optional)<input name="reference" maxLength={100} /></label><label>Age group<input name="age_group" required placeholder="Ages 5–6" maxLength={80} /></label><label>Assigned classroom<select name="classroom" required><option value="">Choose classroom</option>{config.classrooms.map(x => <option key={x}>{x}</option>)}</select></label>
    <ContactFields /><label className="jp-check"><input name="confirm_same_name" type="checkbox" />I checked: this is a different child with the same name</label>
    {error && <p className="jp-error" role="alert">{error}</p>}<div className="jp-row"><Button busy={busy} className="jp-primary">Save child</Button><Button busy={busy} type="button" onClick={done}>Cancel</Button></div></form></section>
}

function BulkImport({ config, call, done, busy }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const rows = text.replace(/\r/g, '').split('\n').filter(line=>line.trim()).map(line => line.split('\t').map(x => x.trim()))
  return <section className="jp-panel"><h2>Paste the Junior Platform roster</h2><p>Paste spreadsheet rows without a header. Columns: <b>Child full name, Roster reference, Age group, Classroom, Guardian name, Guardian email, Guardian mobile.</b> Tab-separated; up to 200 rows. Use +country-code phone numbers.</p><p>SMS permission and pickup authorization remain unconfirmed after import. Intake staff must verify them.</p><label>Roster rows<textarea className="jp-paste" value={text} onChange={e => setText(e.target.value)} placeholder={'Amina Yusuf\tJP-024\tAges 5–6\tGroup C\tMaryam Yusuf\tmaryam@example.com\t+12025550146'} /></label>
    <p>{text.trim() ? rows.length : 0} rows · Classrooms: {config.classrooms.join(', ') || 'Configure classrooms first'}</p>
    {error && <p className="jp-error" role="alert">{error}</p>}<div className="jp-row"><Button busy={busy || !text.trim()} className="jp-primary" onClick={async () => {
      setError(''); if (rows.some(r => r.length !== 7)) { setError('Every row needs exactly seven tab-separated columns.'); return }
      try { await call('/import', 'POST', { children: rows.map(r => ({ name: r[0], reference: r[1] || null, age_group: r[2], classroom: r[3], guardian: r[4] ? { name: r[4], relationship: 'parent', email: r[5] || null, phone: r[6] || null, notify: true } : null })) }); await done() } catch (err) { setError(err.message) }
    }}>Import roster</Button><Button busy={busy} onClick={done}>Cancel</Button></div></section>
}

function Outings({ outings, children, role, call, refresh, open, busy }) {
  const [error, setError] = useState('')
  return <><div className="jp-grid">{outings.map(o => <section className="jp-panel" key={o.id}><h2>{o.name}</h2><p>{o.date} · {o.closed ? 'Closed' : 'Reconciliation open'}</p><div className="jp-counts">{['expected', 'departed', 'returned'].map(k => <span key={k}>{label(k)}<strong>{o[k]}</strong></span>)}<span>Outstanding<strong>{o.outstanding.length}</strong></span></div>
    {o.outstanding.length > 0 && <div className="jp-warning"><strong>Awaiting return</strong>{o.outstanding.map(c => <Button busy={busy} key={c.id} onClick={() => open(c.id)}>{c.name}</Button>)}</div>}
    <details><summary>Expected roster</summary>{o.members.map(c => <p key={c.id}><button onClick={() => open(c.id)}>{c.name}</button> · {c.returned_at ? 'Returned' : c.departed_at ? 'Awaiting return' : 'Not departed'}</p>)}</details>
    {role === 'supervisor' && !o.closed && <Button busy={busy || o.outstanding.length > 0} onClick={async () => { try { await call(`/outings/${o.id}/close`, 'POST'); await refresh() } catch (err) { setError(err.message) } }}>Close reconciled outing</Button>}</section>)}</div>
    {role === 'supervisor' && <section className="jp-panel"><h2>Create outing roster</h2><form onSubmit={async e => { e.preventDefault(); setError(''); const data = new FormData(e.currentTarget); try { await call('/outings', 'POST', { name: field(data, 'name'), outing_date: field(data, 'date'), child_ids: data.getAll('child_ids'), permission_verified: checked(data, 'permission_verified') }); e.target.reset(); await refresh() } catch (err) { setError(err.message) } }}><label>Outing name<input name="name" required /></label><label>Scheduled date<input name="date" type="date" required /></label><fieldset><legend>Select expected children</legend><div className="jp-roster-pick">{children.map(c => <label className="jp-check" key={c.id}><input type="checkbox" name="child_ids" value={c.id} />{c.name} · {c.classroom}</label>)}</div></fieldset><label className="jp-check"><input type="checkbox" name="permission_verified" required />I verified outing permission for every selected child</label><Button busy={busy} className="jp-primary">Create outing</Button></form></section>}
    {error && <p role="alert" className="jp-error">{error}</p>}</>
}

function Inventory({ items, call, refresh, busy, tz }) {
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const attempt = useRef(crypto.randomUUID())
  const item = items.find(x => x.id === selected)
  return <><section className="jp-panel"><h2>JP supplies and equipment</h2><div className="jp-table-wrap"><table><thead><tr><th>Item</th><th>Available</th><th>Issued</th><th>Damaged</th><th>Lost</th><th>Actions</th></tr></thead><tbody>{items.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.total-r.issued-r.damaged-r.lost}</td><td>{r.issued}</td><td>{r.damaged}</td><td>{r.lost}</td><td><Button busy={busy} onClick={async () => { setSelected(r.id); attempt.current = crypto.randomUUID(); setHistory(await call(`/inventory/${r.id}/history`)) }}>Manage</Button></td></tr>)}</tbody></table></div></section>
    {item && <section className="jp-panel"><h2>{item.name}</h2><form onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); try { await call(`/inventory/${item.id}/actions`, 'POST', { request_id: attempt.current, version: item.version, action: field(data, 'action'), quantity: Number(data.get('quantity')), responsible: field(data, 'responsible'), notes: field(data, 'notes') || null }); attempt.current = crypto.randomUUID(); setHistory(await call(`/inventory/${item.id}/history`)); await refresh(); setError('') } catch (err) { setError(err.message); await refresh() } }}><label>Action<select name="action"><option value="issue">Issue</option><option value="return">Return in good condition</option><option value="damaged">Return damaged</option><option value="lost">Report issued item lost</option></select></label><label>Quantity<input type="number" min="1" name="quantity" required /></label><label>Responsible volunteer<input name="responsible" required /></label><label>Note<textarea name="notes" /></label><Button busy={busy} className="jp-primary">Record inventory action</Button></form><details><summary>Issue / return history</summary>{history.map((h,i) => <p key={i}>{label(h.action)} · {h.quantity} · {h.responsible} · {stamp(h.created_at,tz)}</p>)}</details></section>}
    <section className="jp-panel"><h2>Add inventory item</h2><form onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); try { await call('/inventory', 'POST', { name: field(data, 'name'), total: Number(data.get('total')) }); e.target.reset(); await refresh(); setError('') } catch (err) { setError(err.message) } }}><label>Item name<input name="name" required /></label><label>Total quantity<input type="number" min="1" name="total" required /></label><Button busy={busy}>Add item</Button></form></section>{error && <p className="jp-error" role="alert">{error}</p>}</>
}

function Settings({ config, call, reload, busy }) {
  const [error, setError] = useState('')
  return <section className="jp-panel"><h2>Junior Programme settings</h2><p>Settings apply only to this event. Child records and guardian contacts remain separate from convention guests.</p><form onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setError('')
    try { const staff = {}; (config.available_staff || []).forEach(person => { const role = field(data, `staff_${person.id}`); if (role) staff[person.id] = role }); await call('/config','PUT',{ enabled: checked(data,'enabled'), classrooms: field(data,'classrooms').split('\n').filter(Boolean), staff, notifications_enabled: checked(data,'notifications_enabled') }); await reload() } catch(err) { setError(err.message) }
  }}><label className="jp-check"><input name="enabled" type="checkbox" defaultChecked={config.enabled} />Enable Junior Programme for this event</label><label>Classrooms (one per line)<textarea name="classrooms" defaultValue={config.classrooms.join('\n')} rows="6" /></label><fieldset><legend>Junior Platform team</legend>{(config.available_staff || []).map(person => <label key={person.id}>{person.name}{person.view_only ? " · View-only event access" : ""}<select name={`staff_${person.id}`} defaultValue={config.staff[person.id] || ""}><option value="">No Junior Platform access</option>{["scanner","intake","support","inventory","supervisor"].map(role => <option key={role} value={role}>{label(role)}</option>)}</select></label>)}{!config.available_staff?.length && <p>Assign volunteers through Team first, then return here to choose their JP roles.</p>}</fieldset><p>Assign staff to the event first. Roles: scanner, intake, support, inventory, supervisor. Intake can correct names and manage guardian authorization. Support can see restricted notes. Scanner cannot edit identities.</p><label className="jp-check"><input name="notifications_enabled" type="checkbox" defaultChecked={config.notifications_enabled} />Send guardian email and SMS for new transitions</label><p>Event email and SMS channels, valid guardian contacts, SMS permission, provider setup and message credits are required. Enabling sending does not replay paused historical notices.</p>{error && <p role="alert" className="jp-error">{error}</p>}<Button busy={busy} className="jp-primary">Save event settings</Button></form></section>
}

function Guide() {
  return <section className="jp-panel jp-guide"><h2>Volunteer orientation · Junior Platform</h2><p>Parents do not operate Festio. Only record a movement after witnessing it. Stay online; release and headcounts need server confirmation.</p><ol>
    <li><strong>Find the child.</strong> Search the received roster by full name or reference. Missing or incorrect name? Refer to the intake desk. Never create a second record to work around a mismatch.</li>
    <li><strong>Record drop-off.</strong> Capture the adult’s name and relationship. Verify an adult sibling is 18+. Ask both screening questions; route Yes answers to the relevant desk.</li>
    <li><strong>Complete referrals.</strong> Support staff record restricted details and wristband assignment. Both referrals must be cleared when both apply.</li>
    <li><strong>Confirm classroom arrival.</strong> Record only after the child reaches their assigned room.</li>
    <li><strong>Temporary departure.</strong> Select Clinic or Other; record the accompanying adult. Other requires a reason. Record return, then classroom arrival.</li>
    <li><strong>Outing.</strong> Use the supervisor’s permission-verified roster. Record each departure and return. Review outstanding names; never close reconciliation while children remain outstanding.</li>
    <li><strong>Final pickup.</strong> Check the collecting adult’s identity against an authorized contact. Missing authorization blocks release. Ask intake/supervisor to resolve it; typing a name is not authorization.</li>
    <li><strong>Guardian updates.</strong> Each transition records email and SMS notices. A recorded movement is different from message delivery. Intake/supervisors review setup errors and unconfirmed outcomes.</li>
    <li><strong>Inventory.</strong> Record item quantities, responsible volunteer and returns. Report damaged or lost issued stock separately.</li>
  </ol><h3>Practice at orientation</h3><p>Use a separate training event and fictional contacts: missing child, allergy referral, two referrals, incorrect name, unauthorized pickup, clinic return, missing outing return, and a failed notification.</p><button onClick={()=>window.print()}>Print volunteer guide</button></section>
}

function Workspace({ eventId }) {
  const { event, refresh: refreshEvent } = useEventDetails(eventId)
  const [config, setConfig] = useState(null), [children, setChildren] = useState([]), [outings, setOutings] = useState([]), [items, setItems] = useState([]), [notices, setNotices] = useState([])
  const [tab, setTab] = useState('children'), [query, setQuery] = useState(''), [location, setLocation] = useState('all')
  const [child, setChild] = useState(null), [panel, setPanel] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [success, setSuccess] = useState('')
  const mounted = useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const call = useCallback(async (path, method='GET',body) => {
    const write=method!=='GET'; if(write) {setBusy(true);setSuccess('')}
    try { const result=await api.junior(eventId,path,method,body); if(write && mounted.current)setSuccess('Saved. Guardian updates recorded; check Notifications for delivery status.'); return result }
    finally {if(write && mounted.current)setBusy(false)}
  },[eventId])
  const load=useCallback(async()=>{
    try {
      const cfg=await call('/config'); if(!mounted.current)return; setConfig(cfg)
      if(!cfg.enabled || !cfg.role)return
      const [kids,trips,stock,messages]=await Promise.all([
        cfg.role==='inventory'?[]:call('/children'), cfg.role==='inventory'?[]:call('/outings'),
        ['inventory','supervisor'].includes(cfg.role)?call('/inventory'):[], ['intake','supervisor'].includes(cfg.role)?call('/notifications'):[]])
      if(!mounted.current)return;setChildren(kids);setOutings(trips);setItems(stock);setNotices(messages);setError('')
    }catch(err){if(mounted.current)setError(err.message)}
  },[call])
  useEffect(()=>{load()},[load])
  useEffect(()=>{const id=setInterval(()=>{if(!document.hidden&&!busy&&!child&&!panel)load()},15000);return()=>clearInterval(id)},[load,busy,child,panel])
  async function open(id){setError('');try {setChild(await call(`/children/${id}`));setPanel('')}catch(err){setError(err.message)}}
  async function refreshChild(){if(child)await open(child.id);await load()}
  if(!eventId)return <p className="jp-panel">Choose an event to open Junior Platform.</p>
  if(!config)return <p className="jp-panel" role="status">{error||'Loading Junior Platform…'}</p>
  const role=config.role, intake=['intake','supervisor'].includes(role)
  const tabs=[...(role!=='inventory'?[['children','Children & movements'],['referrals','Support desks'],['outings','Outings']]:[]),...(['inventory','supervisor'].includes(role)?[['inventory','Inventory']]:[]),...(intake?[['notifications','Notifications']]:[]),['guide','Volunteer guide'],...(config.can_configure?[['settings','Settings']]:[])]
  const activeTab=role==='inventory'&&tab==='children'?'inventory':tab
  const counts=children.reduce((acc,c)=>({...acc,[c.location]:(acc[c.location]||0)+1}),{})
  const filtered=children.filter(c=>(`${c.name} ${c.reference||''} ${c.classroom}`).toLowerCase().includes(query.toLowerCase())&&(location==='all'||c.location===location)&&(activeTab!=='referrals'||c.location==='support_desk'))
  return <main className="jp-workspace"><header className="jp-heading"><div><p>NCNMO-ready · Reusable event module</p><h1>Junior Platform</h1><p>{event?.name} · Staff operations · {event?.timezone||'UTC'}</p></div><Button busy={busy} onClick={load}>Refresh</Button></header>
    <div className="jp-notice">Parents do not use this workspace. Guardian notifications: <strong>{config.notifications_enabled?'Email + SMS enabled':'Sending paused'}</strong>. No offline release.</div>
    {error&&<p role="alert" className="jp-error">{error}</p>}{success&&<p role="status" className="jp-success">{success}</p>}
    {!config.enabled?<><section className="jp-panel"><h2>Junior Programme is off for this event</h2><p>Existing RSVP, convention admission and scanner flows continue as usual.</p></section>{config.can_configure&&<Settings config={config} call={call} busy={busy} reload={async()=>{await load();await refreshEvent()}}/>}</>:!role?<p className="jp-panel">Ask the event administrator to grant you a Junior Programme role.</p>:<>
      {role!=='inventory'&&<div className="jp-kpis">{['not_arrived','reception','support_desk','classroom','clinic','other','outing','released'].map(k=><button key={k} onClick={()=>{setLocation(k);setTab('children')}}><span>{label(k)}</span><strong>{counts[k]||0}</strong></button>)}</div>}
      <nav className="jp-tabs" aria-label="Junior Platform sections">{tabs.map(([id,title])=><button key={id} aria-current={activeTab===id?'page':undefined} onClick={()=>{setTab(id);setPanel('');setChild(null)}}>{title}</button>)}</nav>
      <div className={child||panel?'jp-columns':''}><div>
      {['children','referrals'].includes(activeTab)&&<section className="jp-panel"><div className="jp-row"><h2>{activeTab==='referrals'?'Awaiting desk clearance':'Child roster'}</h2>{intake&&<div className="jp-row"><Button busy={busy} onClick={()=>{setPanel('add');setChild(null)}}>Add missing child</Button><Button busy={busy} onClick={()=>{setPanel('import');setChild(null)}}>Paste roster</Button></div>}</div><div className="jp-filters"><label>Find child<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, classroom or roster reference"/></label><label>Current location<select value={location} onChange={e=>setLocation(e.target.value)}><option value="all">All locations</option>{['not_arrived','reception','support_desk','classroom','clinic','other','outing','released'].map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label></div><p>{filtered.length} children shown · {children.length} total</p><div className="jp-table-wrap"><table><thead><tr><th>Child</th><th>Classroom</th><th>Current location</th><th>Record</th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td><strong>{c.name}</strong><small>{c.reference||'No roster reference'} · {c.age_group}</small></td><td>{c.classroom}</td><td><span className={`jp-status jp-${c.location}`}>{label(c.location)}</span></td><td><Button busy={busy} onClick={()=>open(c.id)}>Open</Button></td></tr>)}</tbody></table></div>{!children.length&&<p>No children loaded. Intake staff can paste the JP roster or add a missing child.</p>}</section>}
      {activeTab==='outings'&&<Outings outings={outings} children={children} role={role} call={call} refresh={load} open={open} busy={busy}/>}
      {activeTab==='inventory'&&<Inventory items={items} call={call} refresh={load} busy={busy} tz={event?.timezone}/>}
      {activeTab==='notifications'&&<section className="jp-panel"><h2>Guardian email and SMS</h2><p>Queued = awaiting processing. Accepted = provider accepted, delivery unconfirmed. Delivered requires a receipt. Paused historical notices are not automatically replayed. Review uncertain outcomes before sending another notice.</p><div className="jp-table-wrap"><table><thead><tr><th>Time</th><th>Channel / guardian</th><th>Update</th><th>Status</th></tr></thead><tbody>{notices.map(n=><tr key={n.id}><td>{stamp(n.created_at,event?.timezone)}</td><td>{n.channel}<small>{n.recipient||'Contact missing'}</small></td><td>{n.body}</td><td><strong>{label(n.status)}</strong><small>{n.error}</small></td></tr>)}</tbody></table></div></section>}
      {activeTab==='guide'&&<Guide/>}{activeTab==='settings'&&<Settings key={JSON.stringify(config)} config={config} call={call} busy={busy} reload={async()=>{await load();await refreshEvent()}}/>}
      </div>{child&&<ChildPanel key={child.id} child={child} config={config} outings={outings} role={role} call={call} refresh={refreshChild} close={()=>setChild(null)} busy={busy} tz={event?.timezone}/>}
      {panel==='add'&&<AddChild config={config} call={call} done={async()=>{setPanel('');await load()}} busy={busy}/>}
      {panel==='import'&&<BulkImport config={config} call={call} done={async()=>{setPanel('');await load()}} busy={busy}/>}
      </div></>}
  </main>
}
export default function JuniorPlatformPage(){const[eventId]=useCurrentEvent();return <RedesignShell topActive="junior" eventScoped><Workspace key={eventId} eventId={eventId}/></RedesignShell>}
