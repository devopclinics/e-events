import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Link } from 'react-router-dom'
import JuniorVolunteerGuide from '../components/JuniorVolunteerGuide'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import QrCameraScanner from '../components/QrCameraScanner'
import './JuniorPlatformPage.css'

const label = value => (value || '').replaceAll('_', ' ')
const stamp = (value, tz) => value ? new Date(value.endsWith('Z') ? value : `${value}Z`).toLocaleString([], { timeZone: tz || 'UTC' }) : '—'
const field = (data, key) => String(data.get(key) || '').trim()
const checked = (data, key) => data.get(key) === 'on'
const relationOptions = <><option value="parent">Parent</option><option value="chaperone">Chaperone</option><option value="adult_sibling">Adult sibling (18+)</option></>

const locations = ['not_arrived','reception','support_desk','classroom','clinic','other','outing','released']
const locationTitle = value => ({not_arrived:'Not arrived',reception:'Checked in',support_desk:'Support desk',classroom:'In classroom',clinic:'At clinic',other:'Temporary departure',outing:'On outing',released:'Released'}[value] || label(value))
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join('')
const actionTitles = {dropoff:'Record drop-off',screening:'Complete screening',clear_allergy:'Clear allergy desk',clear_accommodation:'Clear accommodation desk',classroom:'Classroom arrival',clinic:'Temporary departure: clinic',other:'Temporary departure: other',return:'Return from clinic / other',outing_depart:'Outing departure',outing_return:'Outing return to JP',release:'Final pickup / release',contact:'Add guardian / collector',correction:'Correct name / classroom'}
function nextActions(child, support) {
  if (['not_arrived','released'].includes(child.location)) return ['dropoff']
  if (['clinic','other'].includes(child.location)) return ['return']
  if (child.location === 'outing') return ['outing_return']
  if (child.allergy === null || child.accommodation === null) return ['screening']
  const desks = [...(child.allergy && !child.allergy_cleared ? ['clear_allergy'] : []), ...(child.accommodation && !child.accommodation_cleared ? ['clear_accommodation'] : [])]
  if (desks.length) return support ? desks : []
  if (['reception','support_desk'].includes(child.location)) return ['classroom']
  return ['release','clinic','other','outing_depart']
}
function WorkspaceDialog({children,onClose,title}) {
  const ref=useRef(null)
  useEffect(()=>{const el=ref.current;el.showModal();return()=>el.close()},[])
  return <dialog ref={ref} className="jp-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>{children}</dialog>
}

function ContactFields({ contact = {}, guestPool = [] }) {
  const [selected,setSelected] = useState(contact.guardian_guest_id || "")
  return <fieldset><legend>Guardian / authorized collector</legend>
    <label>Choose an existing guardian from Guest List<select aria-label="Existing guardian" value={selected} disabled={!!contact.id} onChange={e=>{const id=e.target.value;setSelected(id);const g=guestPool.find(p=>p.id===id);const form=e.target.form;for(const [field,value] of Object.entries({guardian_name:g?.name||'',email:g?.email||'',phone:g?.phone||''}))form.elements[field].value=value;form.elements.sms_consent.checked=!!g?.sms_consent;form.elements.adult_verified.checked=false;form.elements.pickup_authorized.checked=false}}><option value="">Add a missing guardian to Guest List</option>{guestPool.filter(g=>!g.is_junior).map(g=><option key={g.id} value={g.id}>{g.name}{g.email?' · '+g.email:''}</option>)}{contact.guardian_guest_id&&!guestPool.some(g=>g.id===contact.guardian_guest_id)&&<option value={contact.guardian_guest_id}>{contact.name}</option>}</select></label>
    <input type="hidden" name="guardian_guest_id" value={selected}/><input type="hidden" name="guardian_updated_at" value={contact.guardian_updated_at || ""}/>{selected&&!contact.id&&<p>Using the shared Guest List details. To change these, link the guardian, then choose Edit contact.</p>}

    <label>Name<input name="guardian_name" required readOnly={!!selected && !contact.id} maxLength={255} defaultValue={contact.name || ""} /></label>
    <label>Relationship<select name="relationship" defaultValue={contact.relationship || "parent"}>{relationOptions}</select></label>
    <label>Guardian email<input name="email" type="email" readOnly={!!selected && !contact.id} defaultValue={contact.email || ""} /></label>
    <label>Guardian mobile<input name="phone" type="tel" pattern="\+[1-9][0-9]{7,14}" title="Use the full international number, including + and country code" readOnly={!!selected && !contact.id} placeholder="+12025550146" defaultValue={contact.phone || ""} /></label>
    <label className="jp-check"><input name="sms_consent" type="checkbox" disabled={!!selected && !contact.id} defaultChecked={!!contact.sms_consent} />SMS notification permission recorded</label>
    <label className="jp-check"><input name="adult_verified" type="checkbox" defaultChecked={!!contact.adult_verified} />Staff verified this person is an adult (18+)</label>
    <label className="jp-check"><input name="pickup_authorized" type="checkbox" defaultChecked={!!contact.pickup_authorized} />Authorized to collect this child</label>
    <label className="jp-check"><input name="notify" type="checkbox" defaultChecked={contact.notify !== false} />Receive guardian email and SMS updates</label>
  </fieldset>
}
function contactBody(data) {
  return { guardian_guest_id: field(data,'guardian_guest_id') || null, guardian_updated_at: field(data,'guardian_updated_at') || null, name: field(data, 'guardian_name'), relationship: field(data, 'relationship'), email: field(data, 'email') || null,
    phone: field(data, 'phone') || null, sms_consent: checked(data, 'sms_consent'), adult_verified: checked(data, 'adult_verified'),
    pickup_authorized: checked(data, 'pickup_authorized'), notify: checked(data, 'notify') }
}
function Button({ children, busy, ...props }) { return <button disabled={busy} {...props}>{children}</button> }

function ChildPanel({ child, config, outings, role, call, refresh, close, busy: externalBusy, tz, guestPool }) {
  const [saving,setSaving]=useState(false)
  const busy=externalBusy||saving
  const [mode, setMode] = useState(()=>nextActions(child,['support','supervisor'].includes(role))[0] || 'screening')
  const [editContact, setEditContact] = useState(null)
  const attempt = useRef(null)
  const support = ['support', 'supervisor'].includes(role)
  const intake = ['intake', 'supervisor'].includes(role)
  const [error, setError] = useState('')
  useEffect(()=>{setMode(nextActions(child,support)[0] || 'screening');setError('')},[child.location,child.allergy_cleared,child.accommodation_cleared])
  async function execute(data) {
    const signature = JSON.stringify(data)
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() }
    await call(`/children/${child.id}/actions`, 'POST', { ...data, version: child.version, request_id: attempt.current.id })
    attempt.current = null
    await refresh()
  }
  async function submit(e) {
    e.preventDefault(); if(busy)return; setSaving(true); setError('')
    const data = new FormData(e.currentTarget)
    try {
      if (mode === 'contact') await call(`/children/${child.id}/contacts${editContact ? '/' + editContact.id : ''}`, editContact ? 'PUT' : 'POST', { ...contactBody(data), ...(editContact ? {version:child.version} : {}) })
      else if (mode === 'correction') await call(`/children/${child.id}`, 'PATCH', { version: child.version, name: field(data, 'name'), classroom: field(data, 'classroom'), age_group: field(data, 'age_group') || null, reason: field(data, 'notes') })
      else await execute({ action: mode, adult_name: field(data, 'adult_name') || null, relationship: field(data, 'relationship') || null,
        phone: field(data, 'phone') || null, contact_id: field(data, 'contact_id') || null, identity_checked: checked(data, 'identity_checked'),
        adult_verified: checked(data, 'adult_verified'), allergy: data.has('allergy') && field(data, 'allergy') !== '' ? field(data, 'allergy') === 'yes' : null,
        accommodation: data.has('accommodation') && field(data, 'accommodation') !== '' ? field(data, 'accommodation') === 'yes' : null,
        notes: field(data, 'notes') || null, wristband_assigned: checked(data, 'wristband_assigned'), outing_id: field(data, 'outing_id') || null })
      await refresh()
    } catch (err) { setError(err.message); if (err.status === 409) await refresh() } finally {setSaving(false)}
  }
  return <section className="jp-panel jp-detail" aria-label="Child record">
    <div className="jp-row jp-detail-heading"><div><span className="jp-eyebrow">Child record · {child.reference || 'Guest List'}</span><h2>{child.name}</h2>{config.can_open_guest_list&&<Link to={'/guests-redesign?guest='+child.guest_id}>Shared Guest List record</Link>}<p>{child.age_group} · {child.classroom || 'Awaiting classroom assignment'}</p></div><Button busy={busy && !config.read_only} type="button" className="jp-close" onClick={close} aria-label="Close child record"><Icon name="plus"/>Close</Button></div>
    <p className={`jp-status jp-${child.location}`}>{locationTitle(child.location)}</p>
    <details><summary>Junior Platform badge QR</summary><img width="160" height="160" src={child.badge_data_url} alt={`Junior Platform badge for ${child.name}`} /><p>This badge identifies the child; it does not authorize pickup.</p><a href={child.badge_data_url} download={`junior-${child.reference || child.id}.png`}>Download badge QR</a></details>
    <div className="jp-screening"><span>Allergy: {child.allergy === null ? 'Not screened' : child.allergy ? child.allergy_cleared ? 'Desk cleared' : 'Desk required' : 'No'}</span><span>Accommodation: {child.accommodation === null ? 'Not screened' : child.accommodation ? child.accommodation_cleared ? 'Desk cleared' : 'Desk required' : 'No'}</span></div>
    {support && <details><summary>Restricted desk notes</summary><p>Allergy: {child.allergy_notes || 'No details recorded'}</p><p>Accommodation: {child.accommodation_notes || 'No details recorded'}</p></details>}
    {!child.contacts.some(c => c.pickup_authorized && c.adult_verified) && <p className="jp-warning">No authorized adult collector. Final release is blocked; refer to the help desk.</p>}
    <div className="jp-next-action"><span className="jp-eyebrow">Next step</span><h3>{nextActions(child,support).length ? 'Choose what happens next' : 'Support desk clearance required'}</h3>{!nextActions(child,support).length && <p>Ask an authorized support desk volunteer to review this child before classroom arrival.</p>}<div className="jp-action-choices">{nextActions(child,support).map(action=><button type="button" key={action} aria-pressed={mode===action} disabled={busy} onClick={()=>{setMode(action);setEditContact(null);setError('');attempt.current=null}}><Icon name={action==='release'?'shield':action==='classroom'?'check':'arrow'} size={17}/>{actionTitles[action]}</button>)}</div></div>
    <label>Staff action<select aria-label="Staff action" value={mode} disabled={busy} onChange={e => { setMode(e.target.value); setEditContact(null); setError(''); attempt.current = null }}>
      <option value="dropoff">Record drop-off</option><option value="screening">Complete screening</option>
      {support && <><option value="clear_allergy">Clear allergy desk</option><option value="clear_accommodation">Clear accommodation desk</option></>}
      <option value="classroom">Confirm classroom arrival</option><option value="clinic">Temporary departure: clinic</option><option value="other">Temporary departure: other</option>
      <option value="return">Return from clinic / other</option><option value="outing_depart">Outing departure</option><option value="outing_return">Outing return to JP</option><option value="release">Final pickup / release</option>
      {intake && <><option value="contact">Add guardian / collector</option><option value="correction">Correct name / classroom</option></>}
    </select></label>
    <form key={mode + (editContact?.id || "")} onSubmit={submit}>
      {mode === 'dropoff' && <><label>Adult dropping off<input name="adult_name" required maxLength={255} /></label><label>Relationship<select name="relationship">{relationOptions}</select></label><label>Drop-off phone (optional)<input name="phone" type="tel" pattern="\+[1-9][0-9]{7,14}" title="Use the full international number, including + and country code" placeholder="+12025550146" /></label><label className="jp-check"><input name="identity_checked" type="checkbox" required />Staff verified drop-off in person</label><label className="jp-check"><input name="adult_verified" type="checkbox" />Sibling age 18+ verified (required for sibling)</label></>}
      {['dropoff', 'screening'].includes(mode) && <fieldset><legend>Screening</legend>{['allergy', 'accommodation'].map(name => <label key={name}>{name === 'allergy' ? 'Allergy profile?' : 'Special accommodation?'}<select name={name} required><option value="">Select Yes or No</option><option value="yes">Yes — refer to desk</option><option value="no">No</option></select></label>)}</fieldset>}
      {['clear_allergy', 'clear_accommodation'].includes(mode) && <><label>Restricted details<input name="notes" required maxLength={2000} /></label><label className="jp-check"><input name="wristband_assigned" type="checkbox" required />Details reviewed and wristband assigned</label></>}
      {['clinic', 'other'].includes(mode) && <><label>Accompanying adult<input name="adult_name" required maxLength={255} /></label><label>Reason / internal note{mode === 'other' ? ' (required)' : ' (optional)'}<textarea name="notes" required={mode === 'other'} maxLength={2000} /></label><p>Internal details are excluded from guardian messages.</p></>}
      {['outing_depart', 'outing_return'].includes(mode) && <label>Outing<select aria-label="Outing" name="outing_id" required><option value="">Choose an outing</option>{outings.filter(o => !o.closed && o.members.some(m => m.id === child.id)).map(o => <option key={o.id} value={o.id}>{o.name} · {o.date}</option>)}</select></label>}
      {mode === 'release' && <><label>Authorized collector<select aria-label="Authorized collector" name="contact_id" required><option value="">Select verified adult</option>{child.contacts.filter(c => c.pickup_authorized && c.adult_verified).map(c => <option key={c.id} value={c.id}>{c.name} · {label(c.relationship)}</option>)}</select></label><label className="jp-check"><input name="identity_checked" type="checkbox" required />Identity checked in person against the authorized collector</label><p>Different collector? Refer to the help desk before release.</p></>}
      {mode === 'contact' && <><h3>{editContact ? 'Edit guardian / authorization' : 'New guardian contact'}</h3><ContactFields contact={editContact || {}} guestPool={guestPool} /></>}
      {mode === 'correction' && <><label>Correct child name<input name="name" required defaultValue={child.name} /></label><label>Age group<input name="age_group" defaultValue={child.age_group} /></label><label>Classroom<select name="classroom" defaultValue={child.classroom}><option value="">Awaiting classroom assignment</option>{config.classrooms.map(x => <option key={x}>{x}</option>)}</select></label><label>Reason for correction<textarea name="notes" required minLength={3} /></label></>}
      {error && <p role="alert" className="jp-error">{error}</p>}
      <Button busy={busy || config.read_only} className="jp-primary">{busy ? 'Recording…' : mode === 'release' ? 'Confirm verified pickup' : mode === 'contact' ? 'Save guardian details' : mode === 'correction' ? 'Save shared record' : 'Confirm ' + ({dropoff:'drop-off',classroom:'classroom arrival',screening:'screening',clear_allergy:'allergy desk clearance',clear_accommodation:'accommodation desk clearance',clinic:'clinic departure',other:'temporary departure',return:'return to JP',outing_depart:'outing departure',outing_return:'outing return'}[mode] || 'movement')}</Button>
      <p className="jp-muted jp-delivery-hint"><Icon name="bell" size={15}/>{config.notifications_enabled ? 'Guardian updates are enabled. Check Notifications for delivery.' : 'Guardian sending is paused. This change will still be recorded.'}</p>
    </form>
    {intake && <details><summary>Guardian contacts and authorizations</summary>{child.contacts.map(c => <div key={c.id} className="jp-contact"><strong>{c.name} · {label(c.relationship)}</strong><p>{c.email || 'Email missing'} · {c.phone || 'Phone missing'}</p><p>{c.pickup_authorized ? 'Pickup authorized' : 'Pickup not authorized'} · SMS {c.sms_consent ? 'permission recorded' : 'permission missing'}</p><Button busy={busy} type="button" onClick={() => {setMode("contact");setEditContact(c);setError("")}}>Edit contact / authorization</Button><Button busy={busy} type="button" onClick={async () => { if (!window.confirm(`Remove ${c.name} from this child’s contacts?`)) return; try { await call(`/children/${child.id}/contacts/${c.id}`, 'DELETE'); await refresh() } catch (err) { setError(err.message) } }}>Remove authorization / contact</Button></div>)}</details>}
    <details><summary>Movement history ({child.history.length})</summary><ol className="jp-history">{child.history.map(m => <li key={m.id}><strong>{label(m.action)}</strong> · {stamp(m.occurred_at, tz)}<small>Recorded by {m.actor_name || 'Staff'}</small>{m.correction && <p>{m.correction.before.name} → {m.correction.after?.name || child.name} · {m.correction.reason}</p>}<br />{label(m.from_location)} → {label(m.to_location)}{m.adult_name && <span> · {m.adult_name}</span>}</li>)}</ol></details>
  </section>
}

function AddChild({ config, call, done, busy, guestPool }) {
  const [error, setError] = useState('')
  const [hasGuardian,setHasGuardian] = useState(true)
  const [selectedGuest,setSelectedGuest] = useState('')
  return <section className="jp-panel"><h2>Add a missing child</h2><p>Search Guest List first. New children are saved once in Guest List as juniors; adding them does not record attendance or authorize release.</p><form onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setError('')
    try { await call('/children', 'POST', { guest_id: selectedGuest || null, confirm_junior: checked(data,'confirm_junior'), name: field(data, 'name'), reference: field(data, 'reference') || null, age_group: field(data, 'age_group'), classroom: field(data, 'classroom'), guardian: field(data, 'guardian_name') ? contactBody(data) : null, confirm_same_name: checked(data, 'confirm_same_name') }); await done() } catch (err) { setError(err.message) }
  }}><label>Use an existing guest<select aria-label="Existing child guest" value={selectedGuest} onChange={e=>{setSelectedGuest(e.target.value);e.target.form.elements.name.value=guestPool.find(g=>g.id===e.target.value)?.name||''}}><option value="">Create a missing child in Guest List</option>{guestPool.filter(g=>!g.enrolled).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>{selectedGuest&&<label className="jp-check"><input type="checkbox" name="confirm_junior" required/>I checked this Guest List record and confirm they are a child</label>}<label>Child’s real full name<input name="name" required readOnly={!!selectedGuest} maxLength={255} /></label><label>Roster reference / badge ID (optional)<input name="reference" maxLength={100} /></label><label>Age group (if known)<input name="age_group" placeholder="Pending confirmation" maxLength={80} /></label><label>Assigned classroom<select name="classroom"><option value="">Assign later at help desk</option>{config.classrooms.map(x => <option key={x}>{x}</option>)}</select></label>
    <label className="jp-check"><input type="checkbox" checked={hasGuardian} onChange={e=>setHasGuardian(e.target.checked)}/>Guardian details available now</label>{hasGuardian ? <ContactFields guestPool={guestPool} /> : <p className="jp-warning">Guardian details pending. Final release stays blocked until an adult is authorized.</p>}<label className="jp-check"><input name="confirm_same_name" type="checkbox" />I checked: this is a different child with the same name</label>
    {error && <p className="jp-error" role="alert">{error}</p>}<div className="jp-row"><Button busy={busy} className="jp-primary">Save child</Button><Button busy={busy} type="button" onClick={done}>Cancel</Button></div></form></section>
}

function BulkImport({ config, call, done, busy }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const rows = text.replace(/\r/g, '').split('\n').filter(line=>line.trim()).map(line => line.split('\t').map(x => x.trim()))
  return <section className="jp-panel"><h2>Paste the Junior Platform roster</h2><p>Paste spreadsheet rows without a header. Columns: <b>Child full name, Roster reference, Age group, Classroom, Guardian name, Guardian email, Guardian mobile.</b> Only the child’s name is required; leave unknown columns empty. Tab-separated; up to 200 rows. Use +country-code phone numbers.</p><p>SMS permission and pickup authorization remain unconfirmed after import. Intake staff must verify them.</p><label>Roster rows<textarea className="jp-paste" value={text} onChange={e => setText(e.target.value)} placeholder={'Amina Yusuf\tJP-024\tAges 5–6\tGroup C\tMaryam Yusuf\tmaryam@example.com\t+12025550146'} /></label>
    <p>{text.trim() ? rows.length : 0} rows · Classrooms: {config.classrooms.join(', ') || 'Configure classrooms first'}</p>
    {error && <p className="jp-error" role="alert">{error}</p>}<div className="jp-row"><Button busy={busy || !text.trim()} className="jp-primary" onClick={async () => {
      setError(''); if (rows.some(r => r.length > 7 || !r[0])) { setError('Provide a child name and up to seven tab-separated columns.'); return }
      try { await call('/import', 'POST', { children: rows.map(r => ({ name: r[0], reference: r[1] || null, age_group: r[2] || '', classroom: r[3] || '', guardian: r[4] ? { name: r[4], relationship: 'parent', email: r[5] || null, phone: r[6] || null, notify: true } : null })) }); await done() } catch (err) { setError(err.message) }
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

function Inventory({ items, call, refresh, busy: externalBusy, tz }) {
  const [saving,setSaving]=useState(false)
  const busy=externalBusy||saving
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const attempt = useRef(crypto.randomUUID())
  const item = items.find(x => x.id === selected)
  return <><section className="jp-panel"><h2>JP supplies and equipment</h2><div className="jp-table-wrap"><table><thead><tr><th>Item</th><th>Available</th><th>Issued</th><th>Damaged</th><th>Lost</th><th>Actions</th></tr></thead><tbody>{items.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.total-r.issued-r.damaged-r.lost}</td><td>{r.issued}</td><td>{r.damaged}</td><td>{r.lost}</td><td><Button busy={busy} onClick={async () => { setSelected(r.id); attempt.current = crypto.randomUUID(); setHistory(await call(`/inventory/${r.id}/history`)) }}>Manage</Button></td></tr>)}</tbody></table></div></section>
    {item && <section className="jp-panel"><h2>{item.name}</h2><form onSubmit={async e => { e.preventDefault(); if(busy)return; setSaving(true); const data = new FormData(e.currentTarget); try { await call(`/inventory/${item.id}/actions`, 'POST', { request_id: attempt.current, version: item.version, action: field(data, 'action'), quantity: Number(data.get('quantity')), responsible: field(data, 'responsible'), notes: field(data, 'notes') || null }); attempt.current = crypto.randomUUID(); setHistory(await call(`/inventory/${item.id}/history`)); await refresh(); setError('') } catch (err) { setError(err.message); await refresh() } finally {setSaving(false)} }}><label>Action<select aria-label="Action" name="action"><option value="issue">Issue</option><option value="return">Return in good condition</option><option value="damaged">Return damaged</option><option value="lost">Report issued item lost</option></select></label><label>Quantity<input type="number" min="1" name="quantity" required /></label><label>Responsible volunteer<input name="responsible" required /></label><label>Note<textarea name="notes" /></label><Button busy={busy} className="jp-primary">Record inventory action</Button></form><details><summary>Issue / return history</summary>{history.map((h,i) => <p key={i}>{label(h.action)} · {h.quantity} · {h.responsible} · {stamp(h.created_at,tz)}</p>)}</details></section>}
    <section className="jp-panel"><h2>Add inventory item</h2><form onSubmit={async e => { e.preventDefault(); if(busy)return; setSaving(true); const data = new FormData(e.currentTarget); try { await call('/inventory', 'POST', { name: field(data, 'name'), total: Number(data.get('total')) }); e.target.reset(); await refresh(); setError('') } catch (err) { setError(err.message) } finally {setSaving(false)} }}><label>Item name<input name="name" required /></label><label>Total quantity<input type="number" min="1" name="total" required /></label><Button busy={busy}>Add item</Button></form></section>{error && <p className="jp-error" role="alert">{error}</p>}</>
}

function Settings({ config, call, reload, busy }) {
  const [error, setError] = useState('')
  return <section className="jp-panel"><h2>Junior Programme settings</h2><p>Settings apply only to this event. Guest List holds the shared child and guardian records. JP keeps its own custody, screening and outing history.</p><form onSubmit={async e => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setError('')
    try { const staff = {}; (config.available_staff || []).forEach(person => { const role = field(data, `staff_${person.id}`); if (role) staff[person.id] = role }); await call('/config','PUT',{ enabled: checked(data,'enabled'), classrooms: field(data,'classrooms').split('\n').filter(Boolean), staff, notifications_enabled: checked(data,'notifications_enabled') }); await reload() } catch(err) { setError(err.message) }
  }}><label className="jp-check"><input name="enabled" type="checkbox" defaultChecked={config.enabled} />Enable Junior Programme for this event</label><label>Classrooms (one per line)<textarea name="classrooms" defaultValue={config.classrooms.join('\n')} rows="6" /></label><fieldset><legend>Junior Platform team</legend>{(config.available_staff || []).map(person => <label key={person.id}>{person.name}{person.view_only ? " · View-only event access" : ""}<select name={`staff_${person.id}`} defaultValue={config.staff[person.id] || ""}><option value="">No Junior Platform access</option>{["scanner","intake","support","inventory","supervisor"].map(role => <option key={role} value={role}>{label(role)}</option>)}</select></label>)}{!config.available_staff?.length && <p>Assign volunteers through Team first, then return here to choose their JP roles.</p>}</fieldset><p>Assign staff to the event first. Roles: scanner, intake, support, inventory, supervisor. Intake can correct names and manage guardian authorization. Support can see restricted notes. Scanner cannot edit identities.</p><label className="jp-check"><input name="notifications_enabled" type="checkbox" defaultChecked={config.notifications_enabled} />Send guardian email and SMS for new transitions</label><p>Verified guardian contacts, SMS permission, provider setup and message credits are required. This controls Junior Platform updates independently of convention notifications. Enabling sending does not replay paused historical notices.</p>{error && <p role="alert" className="jp-error">{error}</p>}<Button busy={busy} className="jp-primary">Save event settings</Button></form></section>
}


function Workspace({ eventId }) {
  const { event, refresh: refreshEvent } = useEventDetails(eventId)
  const [guestPool,setGuestPool]=useState([])
  const openedGuest=useRef('')
  const [config, setConfig] = useState(null), [children, setChildren] = useState([]), [outings, setOutings] = useState([]), [items, setItems] = useState([]), [notices, setNotices] = useState([])
  const [classroomFilter,setClassroomFilter]=useState('all')
  const searchRef=useRef(null)
  const [tab, setTab] = useState('children'), [query, setQuery] = useState(''), [location, setLocation] = useState('all'), [camera, setCamera] = useState(false)
  const [child, setChild] = useState(null), [panel, setPanel] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [success, setSuccess] = useState('')
  const mounted = useRef(true)
  useEffect(()=>{const key=e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();searchRef.current?.focus()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const call = useCallback(async (path, method='GET',body) => {
    const write=method!=='GET' && path!=='/resolve'; if(write) {setBusy(true);setSuccess('')}
    try { const result=await api.junior(eventId,path,method,body); if(write && mounted.current)setSuccess(path.endsWith('/actions') ? 'Movement recorded. The headcount is up to date.' : path==='/config' ? 'Event settings saved.' : 'Saved to the shared event record.'); return result }
    finally {if(write && mounted.current)setBusy(false)}
  },[eventId])
  const load=useCallback(async()=>{
    try {
      const cfg=await call('/config'); if(!mounted.current)return; setConfig(cfg)
      if(!cfg.enabled || !cfg.role)return
      const [kids,trips,stock,messages,guests]=await Promise.all([
        cfg.role==='inventory'?[]:call('/children'), cfg.role==='inventory'?[]:call('/outings'),
        ['inventory','supervisor'].includes(cfg.role)?call('/inventory'):[], ['intake','supervisor'].includes(cfg.role)?call('/notifications'):[], ['intake','supervisor'].includes(cfg.role)?call('/guests'):[]])
      if(!mounted.current)return;setChildren(kids);setOutings(trips);setItems(stock);setNotices(messages);setGuestPool(guests);setError('')
    }catch(err){if(mounted.current)setError(err.message)}
  },[call])
  useEffect(()=>{load()},[load])
  useEffect(()=>{const target=new URLSearchParams(window.location.search).get('guest');if(target&&openedGuest.current!==target){const found=children.find(c=>c.guest_id===target);if(found){openedGuest.current=target;open(found.id)}}},[children])
  useEffect(()=>{const id=setInterval(()=>{if(!document.hidden&&!busy&&!child&&!panel)load()},15000);return()=>clearInterval(id)},[load,busy,child,panel])
  async function open(id){setError('');try {setChild(await call(`/children/${id}`));setPanel('');}catch(err){setError(err.message)}}
  async function refreshChild(){if(child)await open(child.id);await load()}
  if(!eventId)return <p className="jp-panel">Choose an event to open Junior Platform.</p>
  if(!config)return <section className="jp-panel jp-loading" role="status"><Icon name="shield" size={32}/><h2>{error ? 'Unable to load Junior Platform' : 'Getting your workspace ready…'}</h2>{error&&<><p>{error}</p><Button onClick={load}>Try again</Button></>}</section>
  const role=config.role, intake=['intake','supervisor'].includes(role) && !config.read_only
  const tabs=[...(role!=='inventory'?[['children','Children & movements'],['referrals','Support desks'],['outings','Outings']]:[]),...(['inventory','supervisor'].includes(role)?[['inventory','Inventory']]:[]),...(intake?[['notifications','Notifications']]:[]),['guide','Volunteer guide'],...(config.can_configure?[['settings','Settings']]:[])]
  const activeTab=role==='inventory'&&tab==='children'?'inventory':tab
  const counts=children.reduce((acc,c)=>({...acc,[c.location]:(acc[c.location]||0)+1}),{})
  const filtered=children.filter(c=>(`${c.name} ${c.reference||''} ${c.classroom}`).toLowerCase().includes(query.toLowerCase())&&(location==='all'||c.location===location||(location==='onsite'&&['reception','support_desk','classroom'].includes(c.location))||(location==='away'&&['clinic','other','outing'].includes(c.location)))&&(classroomFilter==='all'||c.classroom===classroomFilter||(classroomFilter==='__unassigned__'&&!c.classroom))&&(activeTab!=='referrals'||c.location==='support_desk'))
  const onsite=['reception','support_desk','classroom'].reduce((n,k)=>n+(counts[k]||0),0)
  const away=['clinic','other','outing'].reduce((n,k)=>n+(counts[k]||0),0)
  const missingClasses=children.filter(c=>!c.classroom).length
  const chooseTab=id=>{setTab(id);setPanel('');setChild(null);setCamera(false);setLocation('all');setQuery('');setClassroomFilter('all')}
  const tabIcons={children:'users',referrals:'shield',outings:'external',inventory:'grid',notifications:'bell',guide:'file',settings:'settings'}
  return <main className="jp-workspace">
    <header className="jp-heading"><div><span className="jp-eyebrow"><span className="jp-live-dot"/>Event operations / Junior Platform</span><h1>Every child. Every step.</h1><p>{event?.name || 'Junior Platform'} <span className="jp-heading-divider">/</span> <span className="jp-role">{label(role || 'Staff')} workspace</span></p></div><div className="jp-header-actions">{config.can_open_guest_list&&<Link className="jp-link-button" to="/guests-redesign"><Icon name="users" size={16}/>Guest List<Icon name="external" size={14}/></Link>}<Button busy={busy} onClick={load} aria-label="Refresh Junior Platform"><Icon name="clock" size={16}/>Refresh</Button></div></header>
    <div className="jp-context-bar"><span><Icon name="shield" size={15}/>Junior Platform <span className="jp-context-separator">·</span> Staff only</span><button className="jp-sending-state" onClick={()=>{if(intake)chooseTab('notifications')}} disabled={!intake}><span className={config.notifications_enabled?'jp-live-dot':'jp-paused-dot'}/>{config.notifications_enabled?'Guardian updates enabled':'Guardian updates paused'}<Icon name="arrow" size={13}/></button></div>
    {config.read_only && <p className="jp-warning">View-only event access. Your administrator must enable editing before you can record changes.</p>}
    {error&&<p role="alert" className="jp-error">{error}</p>}{success&&<p role="status" className="jp-success"><Icon name="check" size={17}/>{success}</p>}
    {!config.enabled?<><section className="jp-panel"><h2>Junior Programme is off for this event</h2><p>Existing RSVP, convention admission and scanner flows continue as usual.</p></section>{config.can_configure&&<Settings config={config} call={call} busy={busy} reload={async()=>{await load();await refreshEvent()}}/>}</>:!role?<p className="jp-panel">Ask the event administrator to grant you a Junior Programme role.</p>:<>
      {role!=='inventory'&&<div className="jp-overview" aria-label="Live child headcounts">{[
        {title:'At Junior Platform',value:onsite,note:'Reception, desks & classrooms',icon:'users',tone:'green',target:'onsite'},
        {title:'Expected arrivals',value:counts.not_arrived||0,note:'Ready for their first check-in',icon:'clock',tone:'blue',target:'not_arrived'},
        {title:'Temporarily away',value:away,note:'Clinic, outing & other departures',icon:'external',tone:'amber',target:'away'},
        {title:'Released',value:counts.released||0,note:'Collected by a verified adult',icon:'shield',tone:'neutral',target:'released'}
      ].map(k=><button className={'jp-overview-card jp-tone-'+k.tone} key={k.target} aria-pressed={location===k.target} onClick={()=>{chooseTab('children');setLocation(k.target)}}><div className="jp-overview-top"><span>{k.title}</span><span className="jp-metric-icon"><Icon name={k.icon} size={18}/></span></div><strong>{k.value}<span>children</span></strong><small>{k.note}</small></button>)}</div>}
      <nav className="jp-tabs" aria-label="Junior Platform sections">{tabs.map(([id,title])=><button key={id} aria-current={activeTab===id?'page':undefined} onClick={()=>chooseTab(id)}><Icon name={tabIcons[id]} size={17}/>{title}{id==='referrals'&&!!counts.support_desk&&<span className="jp-tab-count">{counts.support_desk}</span>}</button>)}</nav>
      <div className={['children','referrals'].includes(activeTab)?'jp-work-grid':''}><div className="jp-main-content">
      {['children','referrals'].includes(activeTab)&&<section className="jp-panel jp-roster-panel"><div className="jp-roster-heading"><div><span className="jp-eyebrow">{activeTab==='referrals'?'Screening & wristbands':'One shared Guest List'}</span><h2>{activeTab==='referrals'?'Awaiting desk clearance':'Child roster'}<span className="jp-total">{children.length}</span></h2></div><Button className="jp-primary jp-scan-button" busy={busy} onClick={()=>setCamera(!camera)}><Icon name="ticket" size={18}/>{camera?'Close camera':'Scan child badge'}</Button></div>
      {camera&&<div className="jp-camera"><QrCameraScanner disabled={busy} onScan={async raw=>{setCamera(false);try{const found=await call('/resolve','POST',{token:raw});await open(found.child_id)}catch(err){setError(err.message)}}}/></div>}
      <div className="jp-search-row"><label className="jp-search-label"><span className="jp-sr-only">Find child</span><Icon name="search" size={19}/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, classroom or badge…"/>{query?<button type="button" className="jp-clear" aria-label="Clear search" onClick={()=>{setQuery('');searchRef.current?.focus()}}>×</button>:<kbd>/</kbd>}</label><label className="jp-class-filter"><span className="jp-sr-only">Classroom filter</span><select value={classroomFilter} onChange={e=>setClassroomFilter(e.target.value)}><option value="all">All classrooms</option><option value="__unassigned__">Not assigned</option>{[...new Set(children.map(c=>c.classroom).filter(Boolean))].sort().map(c=><option key={c}>{c}</option>)}</select></label></div>
      <div className="jp-location-filters" aria-label="Filter children by location">{[['all','All children',children.length],['not_arrived','Not arrived',counts.not_arrived||0],['onsite','At JP',onsite],['away','Away',away],['released','Released',counts.released||0]].map(([id,title,count])=><button key={id} aria-pressed={location===id} onClick={()=>setLocation(id)}>{title}<span>{count}</span></button>)}<label className="jp-location-select"><span className="jp-sr-only">Current location</span><select value={location} onChange={e=>setLocation(e.target.value)}><option value="all">All locations</option><option value="onsite">At Junior Platform</option><option value="away">Temporarily away</option>{locations.map(k=><option key={k} value={k}>{locationTitle(k)}</option>)}</select></label></div>
      <div className="jp-table-wrap"><table className="jp-child-table"><thead><tr><th>Child / badge</th><th>Classroom</th><th>Current location</th><th><span className="jp-sr-only">Open child record</span></th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td><div className="jp-person"><span className="jp-avatar" aria-hidden="true">{initials(c.name)}</span><div><strong>{c.name}</strong><small>{c.reference||'Guest List badge'} · {c.age_group}</small></div></div></td><td><span className="jp-classroom-name">{c.classroom || 'Not assigned'}</span></td><td><span className={`jp-status jp-${c.location}`}><span/>{locationTitle(c.location)}</span></td><td><Button className="jp-open-child" busy={busy} aria-label={'Open '+c.name} onClick={()=>open(c.id)}>Open<Icon name="arrow" size={16}/></Button></td></tr>)}</tbody></table></div>
      {!filtered.length&&<div className="jp-empty"><span className="jp-empty-icon"><Icon name="search" size={25}/></span><h3>{children.length?'No children match these filters':'Ready for your first child'}</h3><p>{children.length?'Try another name or clear the filters to see everyone.':'Existing Guest List juniors appear here automatically. Add a missing child or paste the received names.'}</p>{children.length>0&&<Button onClick={()=>{setQuery('');setLocation('all');setClassroomFilter('all')}}>Clear filters</Button>}</div>}
      <div className="jp-roster-footer"><span>{filtered.length} of {children.length} children <span className="jp-footer-dot">·</span> Updates every 15s</span>{intake&&<div><Button busy={busy} onClick={()=>{setPanel('add');setChild(null)}}><Icon name="plus" size={16}/>Add missing child</Button><Button busy={busy} onClick={()=>{setPanel('import');setChild(null)}}><Icon name="upload" size={16}/>Paste roster</Button></div>}</div></section>}
      {activeTab==='outings'&&<Outings outings={outings} children={children} role={role} call={call} refresh={load} open={open} busy={busy}/>}
      {activeTab==='inventory'&&<Inventory items={items} call={call} refresh={load} busy={busy || config.read_only} tz={event?.timezone}/>}
      {activeTab==='notifications'&&<section className="jp-panel"><h2>Guardian email and SMS</h2><p>Queued = awaiting processing. Accepted = provider accepted, delivery unconfirmed. Delivered requires a receipt. Paused historical notices are not automatically replayed. Review uncertain outcomes before sending another notice.</p><div className="jp-table-wrap"><table><thead><tr><th>Time</th><th>Channel / guardian</th><th>Update</th><th>Status</th></tr></thead><tbody>{notices.map(n=><tr key={n.id}><td>{stamp(n.created_at,event?.timezone)}</td><td>{n.channel}<small>{n.recipient||'Contact missing'}</small></td><td>{n.body}</td><td><strong>{label(n.status)}</strong><small>{n.error}</small>{['paused','setup_required'].includes(n.status)&&<Button busy={busy || !config.notifications_enabled || config.read_only} onClick={async()=>{if(!window.confirm('Queue this guardian update now? Confirm the contact and timing are still correct.'))return;try{await call(`/notifications/${n.id}/retry`,'POST');await load()}catch(err){setError(err.message)}}}>Review & queue</Button>}</td></tr>)}</tbody></table></div></section>}
      {activeTab==='guide'&&<JuniorVolunteerGuide eventName={event?.name} onNavigate={id=>{setTab(id);setChild(null);setPanel('')}}/>}{activeTab==='settings'&&<Settings key={JSON.stringify(config)} config={config} call={call} busy={busy} reload={async()=>{await load();await refreshEvent()}}/>}
      </div>{['children','referrals'].includes(activeTab)&&<aside className="jp-side-rail"><section className="jp-attention-card"><div className="jp-rail-title"><Icon name="bell" size={18}/><h2>Needs attention</h2></div><p>A little help to keep the day moving.</p><button onClick={()=>chooseTab('referrals')}><span className="jp-attention-icon jp-tone-amber"><Icon name="shield" size={18}/></span><span><strong>Support desk</strong><small>Screening & wristband review</small></span><b>{counts.support_desk||0}</b><Icon name="arrow" size={15}/></button>{intake&&<button onClick={()=>{chooseTab('children');setClassroomFilter('__unassigned__')}}><span className="jp-attention-icon jp-tone-blue"><Icon name="grid" size={18}/></span><span><strong>Classroom assignment</strong><small>{missingClasses?'Open a record to assign a class':'Everyone has a classroom'}</small></span><b>{missingClasses}</b><Icon name="arrow" size={15}/></button>}<button onClick={()=>chooseTab('outings')}><span className="jp-attention-icon jp-tone-green"><Icon name="external" size={18}/></span><span><strong>Outing headcount</strong><small>Children awaiting return</small></span><b>{outings.filter(o=>!o.closed).reduce((n,o)=>n+o.outstanding.length,0)}</b><Icon name="arrow" size={15}/></button></section><section className="jp-guide-card"><span className="jp-guide-mark"><Icon name="file" size={25}/></span><span className="jp-eyebrow">A confident first shift</span><h2>New to the desk?</h2><p>A visual walkthrough of check-in, movements and verified pickup.</p><button onClick={()=>chooseTab('guide')}>Open volunteer guide<Icon name="arrow" size={17}/></button></section><p className="jp-rail-footnote"><Icon name="shield" size={16}/>Verify the adult in person before every final release.</p></aside>}</div>
      {child&&<WorkspaceDialog onClose={()=>{if(!busy)setChild(null)}} title={'Child record: '+child.name}><ChildPanel key={child.id} child={child} config={config} outings={outings} role={role} guestPool={guestPool} call={call} refresh={refreshChild} close={()=>setChild(null)} busy={busy || config.read_only} tz={event?.timezone}/></WorkspaceDialog>}
      {panel==='add'&&<WorkspaceDialog onClose={()=>{if(!busy)setPanel('')}} title="Add a missing child"><AddChild config={config} guestPool={guestPool} call={call} done={async()=>{setPanel('');await load()}} busy={busy}/></WorkspaceDialog>}
      {panel==='import'&&<WorkspaceDialog onClose={()=>{if(!busy)setPanel('')}} title="Paste Junior Platform roster"><BulkImport config={config} call={call} done={async()=>{setPanel('');await load()}} busy={busy}/></WorkspaceDialog>}
      </>}
  </main>
}
export default function JuniorPlatformPage(){const[eventId]=useCurrentEvent();return <RedesignShell topActive="junior" eventScoped><Workspace key={eventId} eventId={eventId}/></RedesignShell>}
