import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell from './redesign/RedesignShell'
import QrCameraScanner from '../components/QrCameraScanner'
import { CONTENT } from '../guideContent.mjs'
import './GuestServicesPage.css'

export function passToken(raw) {
  const value = String(raw || '').trim()
  try { return new URL(value).pathname.split('/').filter(Boolean).pop() || '' } catch { return value }
}
const freshAssignment = () => ({ table_id: '', zone_id: '', starts_at: '', ends_at: '', is_lead: false, can_checkin: false, can_manage_meals: false, can_scan_zone: false })
function localTime(value) {
  if (!value) return ''
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function AssignmentEditor({ member, locations, onSave, busy }) {
  const [rows, setRows] = useState(() => member.assignments.map(r => ({ ...r, starts_at: localTime(r.starts_at), ends_at: localTime(r.ends_at) })))
  const [scoped, setScoped] = useState(member.assignments.length ? member.scoped : true)
  const update = (index, changes) => setRows(old => old.map((r, i) => i === index ? { ...r, ...changes } : r))
  return <form onSubmit={e => { e.preventDefault(); onSave(member.id, { scoped, if_unmodified_since: member.updated_at, assignments: rows.map(r => ({ ...Object.fromEntries(Object.keys(freshAssignment()).map(k => [k, r[k]])), table_id: r.table_id || null, zone_id: r.zone_id || null, starts_at: r.starts_at ? new Date(r.starts_at).toISOString() : null, ends_at: r.ends_at ? new Date(r.ends_at).toISOString() : null })) }) }}>
    <h3>{member.name}</h3>
    <label className="gs-check"><input type="checkbox" checked={scoped} disabled={busy} onChange={e => setScoped(e.target.checked)} />Restrict guest operations to assigned tables and rooms</label>
    <p>For table managers and room stewards, keep this enabled. Remove broad guest, menu, seat and dashboard permissions in Team first. Disabling this restores the member’s ordinary staff scanner access.</p>
    {rows.map((row, i) => <fieldset key={i} disabled={busy}>
      <legend>Assignment {i + 1}</legend>
      <label>Table or room<select required aria-label={`Location ${i + 1}`} value={row.table_id ? `table:${row.table_id}` : row.zone_id ? `zone:${row.zone_id}` : ''} onChange={e => { const [kind, id] = e.target.value.split(':'); update(i, { table_id: kind === 'table' ? id : '', zone_id: kind === 'zone' ? id : '', can_checkin: false, can_manage_meals: false, can_scan_zone: false }) }}><option value="">Choose a location</option><optgroup label="Tables">{locations.tables.map(t => <option key={t.id} value={`table:${t.id}`}>{t.name}</option>)}</optgroup><optgroup label="Rooms / zones">{locations.zones.map(z => <option key={z.id} value={`zone:${z.id}`}>{z.name}</option>)}</optgroup></select></label>
      <div className="gs-two"><label>Shift starts (your local time)<input type="datetime-local" value={row.starts_at} onChange={e => update(i, { starts_at: e.target.value })} /></label><label>Shift ends (your local time)<input type="datetime-local" value={row.ends_at} onChange={e => update(i, { ends_at: e.target.value })} /></label></div>
      <p>Leave dates empty for an ongoing assignment.</p>
      <label className="gs-check"><input type="checkbox" checked={row.is_lead} onChange={e => update(i, { is_lead: e.target.checked })} />Lead for this location</label>
      {row.table_id && <><label className="gs-check"><input type="checkbox" checked={row.can_checkin} onChange={e => update(i, { can_checkin: e.target.checked })} />Check in guests assigned to this table</label><label className="gs-check"><input type="checkbox" checked={row.can_manage_meals} onChange={e => update(i, { can_manage_meals: e.target.checked })} />Assist menu selection and mark meals served</label></>}
      {row.zone_id && <label className="gs-check"><input type="checkbox" checked={row.can_scan_zone} onChange={e => update(i, { can_scan_zone: e.target.checked })} />Scan entry and exit for this room / zone</label>}
      <button type="button" onClick={() => setRows(old => old.filter((_, n) => n !== i))}>Remove assignment</button>
    </fieldset>)}
    <div className="gs-actions"><button type="button" disabled={busy} onClick={() => setRows(old => [...old, freshAssignment()])}>Add table or room</button><button disabled={busy}>Save assignments</button></div>
  </form>
}

function GuestServicesHelp({ canConfigure }) {
  const staff = CONTENT.staff.topics.find(t => t.id === 'staff-guest-services')
  const organizer = CONTENT.organizer.topics.find(t => t.id === 'org-guest-services')
  const topic = (value, title) => <details key={value.id}><summary>{title}</summary><p>{value.intro}</p>{value.before && <p>{value.before}</p>}<ol>{value.steps.map((step, i) => <li key={i}>{step}</li>)}</ol><p><strong>Check:</strong> {value.check}</p><p>{value.troubleshoot}</p></details>
  return <aside className="gs-panel gs-help" aria-label="Guest Services help">
    <h2>How Guest Services works</h2>
    <p>One person can cover several tables or rooms, and several staff can share a location. Your assignments and permissions decide which actions are available.</p>
    <ul><li>Check in → help the guest to their table → mark seated.</li><li>Agree menu choices with the guest. Mark each meal served only after delivery.</li><li>Conference room scans record entry and exit; session attendance is separate.</li><li>Use the existing team Tasks for assistance, progress and shift handovers.</li></ul>
    {canConfigure && topic(organizer, 'Organiser setup: staff, tables, rooms and shifts')}
    {topic(staff, 'Staff steps: arrival, meals and requests')}
    <p>Changes need an internet connection. Refresh if a guest moves tables or your shift changes.</p>
  </aside>
}

function MenuEditor({ guest, categories, busy, save, close }) {
  const locked = new Set(guest.locked_category_ids || [])
  const [cleared, setCleared] = useState([])
  const [choices, setChoices] = useState(() => {
    const body = { single: {}, multi: {}, combo: {} }
    for (const c of categories) {
      if (locked.has(c.id)) continue
      const selected = guest.choices.filter(x => x.category_id === c.id)
      if (c.selection_type === 'multi') { if (selected.length) body.multi[c.id] = selected.map(x => x.item_id) }
      else if (selected[0]) body[c.selection_type === 'combo' ? 'combo' : 'single'][c.id] = selected[0].combination_id || selected[0].item_id
    }
    return body
  })
  const [agreed, setAgreed] = useState(false)
  return <form onSubmit={e => { e.preventDefault(); save({ ...choices, guest_agreed: agreed, clear_categories: cleared }) }}><h3>Help {guest.name} choose</h3>
    {categories.map(c => <fieldset key={c.id} disabled={busy || locked.has(c.id)}><legend>{c.name}{c.is_required ? ' (required)' : ''}</legend>
      {locked.has(c.id) ? <p>Served — choices locked. {guest.choices.filter(x => x.category_id === c.id).map(x => x.name).join(', ')}</p> : c.selection_type === 'multi' ? c.items.map(item => <label className="gs-check" key={item.id}><input type="checkbox" checked={(choices.multi[c.id] || []).includes(item.id)} onChange={e => { const next = e.target.checked ? [...(choices.multi[c.id] || []), item.id] : (choices.multi[c.id] || []).filter(id => id !== item.id); const clear = !c.is_required && next.length === 0; setCleared(old => clear ? [...old.filter(id => id !== c.id), c.id] : old.filter(id => id !== c.id)); setChoices(old => { const result = { ...old, multi: { ...old.multi, [c.id]: next } }; if (clear) delete result.multi[c.id]; return result }) }} />{item.name}</label>) : <select aria-label={c.name} required={c.is_required} value={choices[c.selection_type === 'combo' ? 'combo' : 'single'][c.id] || ''} onChange={e => { const type = c.selection_type === 'combo' ? 'combo' : 'single'; setCleared(old => e.target.value ? old.filter(id => id !== c.id) : [...old.filter(id => id !== c.id), c.id]); setChoices(old => { const next = { ...old, [type]: { ...old[type] } }; if (e.target.value) next[type][c.id] = e.target.value; else delete next[type][c.id]; return next }) }}><option value="">Choose…</option>{(c.selection_type === 'combo' ? c.combinations : c.items).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    </fieldset>)}
    <label className="gs-check"><input type="checkbox" required checked={agreed} onChange={e => setAgreed(e.target.checked)} />The guest agreed to these selections</label>
    <div className="gs-actions"><button disabled={busy || !agreed}>Save guest’s choices</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div>
  </form>
}

export default function GuestServicesPage() {
  const [eventId] = useCurrentEvent()
  const [snapshot, setData] = useState(null)
  const data = snapshot?.event_id === eventId ? snapshot : null
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('workspace')
  const [filter, setFilter] = useState('all')
  const [attention, setAttention] = useState(false)
  const [menuGuest, setMenuGuest] = useState(null)
  const [memberId, setMemberId] = useState('')
  const [scanMode, setScanMode] = useState('')
  const [direction, setDirection] = useState('in')
  const [token, setToken] = useState('')
  const [request, setRequest] = useState({ assignment_id: '', title: '', notes: '', priority: 'normal', assignee_user_id: '' })
  const requestKey = useRef(null)
  const current = useRef(eventId); current.current = eventId
  const inflight = useRef(false)
  const reload = useCallback(async () => {
    const result = await api.guestServices(eventId)
    if (current.current === eventId) setData(result)
  }, [eventId])
  useEffect(() => {
    setData(null); setError(''); setNotice(''); setMenuGuest(null); setMemberId(''); setFilter('all'); setScanMode(''); setRequest({ assignment_id: '', title: '', notes: '', priority: 'normal', assignee_user_id: '' }); requestKey.current = null
    if (!eventId) return
    let live = true
    const refresh = () => reload().catch(e => { if (live) setError(e.message) })
    refresh()
    const timer = setInterval(() => { if (!inflight.current) refresh() }, 20000)
    return () => { live = false; clearInterval(timer) }
  }, [eventId, reload])
  async function act(fn, success) {
    if (inflight.current) return
    inflight.current = true; setBusy(true); setError(''); setNotice('')
    try { await fn(); if (current.current !== eventId) return; await reload(); setNotice(success) }
    catch (e) { if (current.current === eventId) setError(e.message) }
    finally { inflight.current = false; setBusy(false) }
  }
  const needsHelp = g => !g.admitted || !g.seated_at || (g.can_manage_meals && (data.menu_categories.some(c => c.is_required && !g.choices.some(x => x.category_id === c.id)) || g.meal_services.some(s => s.eligible && s.status === 'open' && !s.served)))
  const guests = (data?.guests || []).filter(g => (filter === 'all' || g.table_id === filter) && (!attention || needsHelp(g)))
  const tables = [...new Map((data?.guests || []).map(g => [g.table_id, g.table_name])).entries()]
  const activeAssignments = data?.assignments.filter(a => a.active) || []
  const scanZones = data?.zones.filter(z => z.can_scan) || []
  const canAdmit = data?.guests.some(g => g.can_checkin)
  const selectedMember = data?.team?.find(m => m.id === memberId)
  async function scan(raw) {
    await act(() => api.guestServiceScan(eventId, { token: passToken(raw), zone_id: scanMode || null, direction }).then(result => { if (!['ok', 'admitted', 'already_admitted'].includes(result.status)) throw new Error(result.message || result.status); if (current.current === eventId) setToken(''); return result }), 'Scan recorded. The guest list has been refreshed.')
  }
  return <RedesignShell topActive="guestservices" withEventSidebar eventActive="guestservices"><main className="gs-page">
    <header><p className="gs-eyebrow">EVENT OPERATIONS</p><h1>Guest Services</h1><p>Look after your tables and rooms, help guests choose meals and coordinate assistance.</p><Link to="/team-redesign?tab=tasks">Open team Tasks →</Link></header>
    <GuestServicesHelp canConfigure={!!data?.can_configure} />
    {error && <div role="alert" className="gs-error">{error} <button disabled={busy} onClick={() => act(reload, 'Refreshed')}>Refresh</button></div>}
    {notice && <div role="status" className="gs-notice">{notice}</div>}
    {!eventId ? <p>Choose an event from the header.</p> : !data ? <p>Loading assignments…</p> : <>
      <nav className="gs-actions" aria-label="Guest Services views"><button aria-pressed={tab === 'workspace'} onClick={() => setTab('workspace')}>My tables & rooms</button>{data.can_configure && <button aria-pressed={tab === 'assign'} onClick={() => setTab('assign')}>Assign staff</button>}<button disabled={busy} onClick={() => act(reload, 'Refreshed')}>Refresh</button></nav>
      {tab === 'assign' && data.can_configure ? <section className="gs-panel"><h2>Assign tables and conference rooms</h2><p>A staff member can cover several locations. Multiple staff can cover the same location. Roles and Tasks remain managed in <Link to="/team-redesign?tab=team">Team</Link>.</p>
        <label>Team member<select value={memberId} disabled={busy} onChange={e => setMemberId(e.target.value)}><option value="">Choose a staff member</option>{data.team.filter(m => m.event_role !== 'manager').map(m => <option key={m.id} value={m.id}>{m.name} · {m.assignments.length} assignments</option>)}</select></label>
        {selectedMember && <AssignmentEditor key={`${eventId}:${memberId}:${selectedMember.updated_at}`} member={selectedMember} locations={data.locations} busy={busy} onSave={(id, body) => act(() => api.configureGuestServices(eventId, id, body), 'Assignments saved')} />}
        {!data.locations.tables.length && !data.locations.zones.length && <p>Create tables in Seating or conference rooms in Venue Access first.</p>}
      </section> : <>
        <section className="gs-summary" aria-label="Guest service summary"><div><strong>{data.guests.length}</strong>Expected at tables</div><div><strong>{data.guests.filter(g => g.admitted).length}</strong>Checked in</div><div><strong>{data.guests.filter(g => g.seated_at).length}</strong>Seated</div><div><strong>{data.guests.filter(needsHelp).length}</strong>Need attention</div></section>
        <section className="gs-panel"><h2>{data.is_supervisor ? 'Floor overview' : 'My assignments'}</h2>{!data.assignments.length && !data.is_supervisor && <p>No assignments yet. Ask your organiser to assign your tables or rooms.</p>}
          <div className="gs-chips">{data.assignments.map(a => <span key={a.id}>{a.name}{a.is_lead ? ' · Lead' : ''} · {a.active ? 'Active' : 'Outside shift'}{a.starts_at && ` · ${new Date(`${a.starts_at}Z`).toLocaleString()}`}{a.ends_at && ` – ${new Date(`${a.ends_at}Z`).toLocaleString()}`}</span>)}</div>
          {data.is_supervisor && data.team?.map(m => m.assignments.length > 0 && <p key={m.id}><strong>{m.name}</strong>: {m.assignments.map(a => `${a.name}${a.is_lead ? ' (lead)' : ''}${a.active ? '' : ' (outside shift)'}`).join(', ')}</p>)}
        </section>
        {(canAdmit || scanZones.length > 0) && <section className="gs-panel"><h2>Scan a guest pass</h2><label>Record<select value={scanMode} disabled={busy} onChange={e => setScanMode(e.target.value)}>{canAdmit ? <option value="">Event check-in for assigned table guests</option> : <option value="" disabled>Choose a room / zone</option>}{scanZones.map(z => <option key={z.id} value={z.id}>{z.name} · room / zone access</option>)}</select></label>
          {scanMode && <label>Direction<select value={direction} disabled={busy} onChange={e => setDirection(e.target.value)}><option value="in">Entry</option><option value="out">Exit</option></select></label>}
          <QrCameraScanner disabled={busy || (!canAdmit && !scanMode)} onScan={scan} /><form onSubmit={e => { e.preventDefault(); scan(token) }} className="gs-actions"><label>Pass link or QR token<input required value={token} onChange={e => setToken(e.target.value)} /></label><button disabled={busy || (!canAdmit && !scanMode)}>Record scan</button></form><p>Room access follows existing ticket, capacity and guardian rules. It does not record session attendance.</p>
        </section>}
        {data.zones.map(z => <section className="gs-panel" key={z.id}><h2>{z.name}</h2><p>{z.inside.length} currently inside from accepted entry/exit scans.</p><ul>{z.inside.map(g => <li key={g.guest_id}>{g.name}</li>)}</ul></section>)}
        <section><div className="gs-actions"><h2>Guests at tables</h2><label>Table<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All assigned tables</option>{tables.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="gs-check"><input type="checkbox" checked={attention} onChange={e => setAttention(e.target.checked)} />Needs attention only</label></div>
          {!guests.length && <p>No guests match this view.</p>}
          <div className="gs-guests">{guests.map(g => <article className="gs-panel" key={g.id}><h3>{g.name}</h3><p>{g.table_name}{g.seat_number ? ` · Seat ${g.seat_number}` : ''}</p><div className="gs-chips"><span>{g.admitted ? 'Checked in' : 'Expected'}</span><span>{g.seated_at ? 'Seated' : 'Not seated'}</span></div>
            <div className="gs-actions">{g.admitted && !g.seated_at && <button disabled={busy || (data.is_supervisor && !data.can_configure)} onClick={() => act(() => api.markGuestSeated(eventId, g.id, true), `${g.name} marked seated`)}>Mark seated</button>}{g.seated_at && <button disabled={busy || (data.is_supervisor && !data.can_configure)} onClick={() => act(() => api.markGuestSeated(eventId, g.id, false), 'Seating confirmation corrected')}>Correct seating confirmation</button>}{g.can_manage_meals && data.menu_categories.length > 0 && <button disabled={busy || g.menu_selections_locked || data.menu_categories.every(c => (g.locked_category_ids || []).includes(c.id))} onClick={() => setMenuGuest(g.id)}>Help choose menu</button>}</div>
            {g.can_manage_meals && <><p>{g.choices.length ? g.choices.map(c => c.name).join(', ') : 'No menu choices recorded'}</p>{g.meal_services.map(s => <div className="gs-service" key={s.id}><span>{s.name} · {s.served ? 'Served' : !s.eligible ? 'Not eligible' : 'Awaiting service'}</span>{!s.served && <button disabled={busy || !s.eligible || s.status !== 'open' || !g.admitted} onClick={() => act(() => api.serveGuestMeal(eventId, g.id, s.id), `${s.name} marked served`)}>Mark served</button>}</div>)}</>}
            {menuGuest === g.id && <MenuEditor key={g.id} guest={g} categories={data.menu_categories} busy={busy} close={() => setMenuGuest(null)} save={body => act(async () => { await api.assistGuestMenu(eventId, g.id, body); if (current.current === eventId) setMenuGuest(null) }, 'Guest selections saved')} />}
          </article>)}</div>
        </section>
        {activeAssignments.length > 0 && <section className="gs-panel"><h2>Request help or hand over work</h2><p>Creates one task in the existing team Tasks board. Track acknowledgement, progress and completion there. Keep sensitive guest details out of shared task notes.</p><form onSubmit={e => { e.preventDefault(); if (!requestKey.current) requestKey.current = crypto.randomUUID(); act(async () => { await api.guestServiceRequest(eventId, { ...request, request_key: requestKey.current, assignee_user_id: request.assignee_user_id || null }); if (current.current === eventId) { requestKey.current = null; setRequest(old => ({ ...old, title: '', notes: '' })) } }, 'Request added to team Tasks') }}>
          <label>Location<select required disabled={busy} value={request.assignment_id} onChange={e => { requestKey.current = null; setRequest(old => ({ ...old, assignment_id: e.target.value })) }}><option value="">Choose your assignment</option>{activeAssignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>What needs attention?<input required maxLength={180} disabled={busy} value={request.title} onChange={e => { requestKey.current = null; setRequest(old => ({ ...old, title: e.target.value })) }} /></label><label>Details<textarea maxLength={2000} disabled={busy} value={request.notes} onChange={e => { requestKey.current = null; setRequest(old => ({ ...old, notes: e.target.value })) }} /></label><label>Priority<select value={request.priority} disabled={busy} onChange={e => { requestKey.current = null; setRequest(old => ({ ...old, priority: e.target.value })) }}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label>Assign to<select disabled={busy} value={request.assignee_user_id} onChange={e => { requestKey.current = null; setRequest(old => ({ ...old, assignee_user_id: e.target.value })) }}><option value="">Unassigned · team queue</option>{data.request_assignees.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button disabled={busy}>Create team task</button>
        </form></section>}
      </>}
    </>}
  </main></RedesignShell>
}
