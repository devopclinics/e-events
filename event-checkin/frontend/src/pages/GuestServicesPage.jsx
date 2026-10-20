import { queuedAction } from '../lib/guestServiceOffline.mjs'
import useGuestServiceOffline from '../hooks/useGuestServiceOffline'
import GuestServiceOfflinePanel from '../components/GuestServiceOfflinePanel'
import GuestServiceActivity from '../components/GuestServiceActivity'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell from './redesign/RedesignShell'
import QrCameraScanner from '../components/QrCameraScanner'
import MealAttendancePanel from '../components/MealAttendancePanel'
import MealRequestQueue, { useMealUpdates, MealUpdateNotice, mealProgressBody } from '../components/MealRequestQueue'
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
  return <form onSubmit={e => { e.preventDefault(); onSave(member.id, { scoped, if_unmodified_since: member.updated_at, assignments: rows.map(r => ({ id: r.id || null, ...Object.fromEntries(Object.keys(freshAssignment()).map(k => [k, r[k]])), table_id: r.table_id || null, zone_id: r.zone_id || null, starts_at: r.starts_at ? new Date(r.starts_at).toISOString() : null, ends_at: r.ends_at ? new Date(r.ends_at).toISOString() : null })) }) }}>
    <h3>{member.name}</h3>
    <label className="gs-check"><input type="checkbox" checked={scoped} disabled={busy} onChange={e => setScoped(e.target.checked)} />Restrict guest operations to assigned tables and rooms</label>
    <p>For table managers and room stewards, keep this enabled. Remove broad guest, menu, seat and dashboard permissions in Team first. Disabling this restores the member’s ordinary staff scanner access.</p>
    {rows.map((row, i) => <fieldset key={i} disabled={busy}>
      <legend>Assignment {i + 1}</legend>
      <label>Table or room<select required aria-label={`Location ${i + 1}`} value={row.table_id ? `table:${row.table_id}` : row.zone_id ? `zone:${row.zone_id}` : ''} onChange={e => { const [kind, id] = e.target.value.split(':'); update(i, { table_id: kind === 'table' ? id : '', zone_id: kind === 'zone' ? id : '', can_checkin: false, can_manage_meals: false, can_scan_zone: false }) }}><option value="">Choose a location</option><optgroup label="Tables">{locations.tables.map(t => <option key={t.id} value={`table:${t.id}`}>{t.name}</option>)}</optgroup><optgroup label="Rooms / zones">{locations.zones.map(z => <option key={z.id} value={`zone:${z.id}`}>{z.name}</option>)}</optgroup></select></label>
      <div className="gs-two"><label>Shift starts (your local time)<input type="datetime-local" value={row.starts_at} onChange={e => update(i, { starts_at: e.target.value })} /></label><label>Shift ends (your local time)<input type="datetime-local" value={row.ends_at} onChange={e => update(i, { ends_at: e.target.value })} /></label></div>
      <p>Leave dates empty for an ongoing assignment.</p>
      <label className="gs-check"><input type="checkbox" checked={row.is_lead} onChange={e => update(i, { is_lead: e.target.checked })} />Lead for this location</label>
      {row.table_id && <><label className="gs-check"><input type="checkbox" checked={row.can_checkin} onChange={e => update(i, { can_checkin: e.target.checked })} />Check in guests assigned to this table</label><label className="gs-check"><input type="checkbox" checked={row.can_manage_meals} onChange={e => update(i, { can_manage_meals: e.target.checked })} />Manage meal attendance, choices and delivery</label></>}
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
    <p>Supervisors can use Activity to filter recorded actions by staff, guest, action and time, then export the current page as CSV. Automatic refresh pauses while this browser tab is hidden.</p><p>Load the needed Guest pages while connected. Offline seating, meal delivery and meal headcounts are saved as pending actions on this device; reconnect to confirm them. Admission scans, corrections, menu edits and setup require a connection. Review conflicts after a table move or shift change.</p>
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
      {locked.has(c.id) ? <p>Preparation started or served — choices locked. {guest.choices.filter(x => x.category_id === c.id).map(x => x.name).join(', ')}</p> : c.selection_type === 'multi' ? c.items.map(item => <label className="gs-check" key={item.id}><input type="checkbox" checked={(choices.multi[c.id] || []).includes(item.id)} onChange={e => { const next = e.target.checked ? [...(choices.multi[c.id] || []), item.id] : (choices.multi[c.id] || []).filter(id => id !== item.id); const clear = !c.is_required && next.length === 0; setCleared(old => clear ? [...old.filter(id => id !== c.id), c.id] : old.filter(id => id !== c.id)); setChoices(old => { const result = { ...old, multi: { ...old.multi, [c.id]: next } }; if (clear) delete result.multi[c.id]; return result }) }} />{item.name}</label>) : <select aria-label={c.name} required={c.is_required} value={choices[c.selection_type === 'combo' ? 'combo' : 'single'][c.id] || ''} onChange={e => { const type = c.selection_type === 'combo' ? 'combo' : 'single'; setCleared(old => e.target.value ? old.filter(id => id !== c.id) : [...old.filter(id => id !== c.id), c.id]); setChoices(old => { const next = { ...old, [type]: { ...old[type] } }; if (e.target.value) next[type][c.id] = e.target.value; else delete next[type][c.id]; return next }) }}><option value="">Choose…</option>{(c.selection_type === 'combo' ? c.combinations : c.items).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    </fieldset>)}
    <label className="gs-check"><input type="checkbox" required checked={agreed} onChange={e => setAgreed(e.target.checked)} />The guest agreed to these selections</label>
    <div className="gs-actions"><button disabled={busy || !agreed}>Save guest’s choices</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div>
  </form>
}

function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() }
function Drawer({ title, children, onClose, busy }) {
  const ref = useRef(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.activeElement, previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')?.focus()
    const key = e => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose() }
      if (e.key !== 'Tab') return
      const controls = [...(ref.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || [])].filter(el => !el.hidden)
      if (!controls.length) { e.preventDefault(); return }
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; previous?.focus?.() }
  }, [onClose, busy])
  return <div className="gs-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}><section ref={ref} className="gs-drawer" role="dialog" aria-modal="true" aria-label={title}><div className="gs-drawer-head"><div><p className="gs-eyebrow">GUEST SERVICES</p><h2>{title}</h2></div><button type="button" className="gs-icon-btn" disabled={busy} onClick={onClose} aria-label="Close panel">×</button></div><div className="gs-drawer-body">{children}</div></section></div>
}
function TableEditor({ table, busy, onSave }) {
  const [name, setName] = useState(table.name), [capacity, setCapacity] = useState(table.capacity), [section, setSection] = useState(table.service_section || '')
  return <form onSubmit={e => { e.preventDefault(); onSave({ name: name.trim(), capacity: Number(capacity), category: table.category, service_section: section.trim() || null, sort_order: table.sort_order }) }}><label>Table name<input required maxLength={100} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label><label>Section<input aria-label="Section" maxLength={80} disabled={busy} value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. East wing" /></label><label>Capacity<input required type="number" min={table.capacity} disabled={busy} value={capacity} onChange={e => setCapacity(e.target.value)} /></label><p>Increase capacity here. Use Seating to review allocated and held seats before reducing it.</p><button className="gs-primary" disabled={busy || !name.trim()}>Save table details</button><Link className="gs-inline-link" to="/addons-redesign?tab=seating">Open Seating →</Link></form>
}
function PlaceholderEditor({ member, busy, onSave }) {
  const [name, setName] = useState(member.name)
  return <form onSubmit={e => { e.preventDefault(); onSave({ name: name.trim(), if_unmodified_since: member.updated_at }) }}><p className="gs-callout">This is an unclaimed placeholder account. Editing its display name does not create a staff login.</p><label>Display name<input required maxLength={255} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><button disabled={busy || !name.trim()} className="gs-primary">Save display name</button><p>Add the real teammate in Team, then assign their tables and rooms here.</p><Link to="/team-redesign?tab=team">Open Team →</Link></form>
}

export default function GuestServicesPage() {
  const [eventId] = useCurrentEvent()
  const offline=useGuestServiceOffline(eventId)
  const offlineRef=useRef(offline);offlineRef.current=offline
  const [snapshot, setData] = useState(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [stale, setStale] = useState(false), [createdTask, setCreatedTask] = useState(null)
  const [attendanceReceipt,setAttendanceReceipt] = useState(null)
  const [guardianStep, setGuardianStep] = useState(null), [guardianToken, setGuardianToken] = useState(''), [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [tab, setTab] = useState('tables'), [view, setView] = useState('board'), [query, setQuery] = useState(''), [attention, setAttention] = useState(false)
  const [drawer, setDrawer] = useState(null), [filter, setFilter] = useState('all'), [menuGuest, setMenuGuest] = useState(null)
  const [scanMode, setScanMode] = useState(''), [direction, setDirection] = useState('in'), [token, setToken] = useState('')
  const [request, setRequest] = useState({ assignment_id: '', title: '', notes: '', priority: 'normal', assignee_user_id: '' })
  const [serverQuery,setServerQuery]=useState('')
  useEffect(()=>{const timer=setTimeout(()=>setServerQuery(query),250);return()=>clearTimeout(timer)},[query])
  const [roomPage,setRoomPage]=useState(1)
  const [page,setPage]=useState(1)
  const [mealStage,setMealStage] = useState('outstanding'), [mealTable,setMealTable] = useState('all'), [mealPage,setMealPage] = useState(1)
  const readParams = {paged:true,room_id:drawer?.type==='room'?drawer.id:'all',room_page:roomPage,view:tab,page:tab==='meals'?mealPage:tab==='guests'?page:1,query:tab==='guests'||tab==='meals'?serverQuery:'',table_id:tab==='meals'?mealTable:filter,attention:tab==='guests'&&attention,stage:mealStage}
  const readKey = (offline.actor || '')+':'+JSON.stringify(readParams)
  const data = snapshot?.event_id===eventId && snapshot._readKey===readKey && (!snapshot.actor_id||snapshot.actor_id===offline.actor) ? snapshot : null
  const readSerial=useRef(0)
  const readState = useRef({key:'',revision:null,lastFull:0,params:{}})
  if(readState.current.key!==readKey)readState.current={key:readKey,revision:null,lastFull:0,params:readParams}
  const [section, setSection] = useState('all'), [coverage, setCoverage] = useState('all')
  const [mealUpdates, dismissMealUpdates] = useMealUpdates(data?.meal_requests, eventId+':'+mealStage+':'+mealTable+':'+mealPage)
  const layoutInitialized = useRef(false)
  const requestKey = useRef(null), current = useRef(eventId), inflight = useRef(false)
  current.current = eventId
  const closeDrawer = useCallback(() => { setDrawer(null); setMenuGuest(null) }, [])
  const loadError = useCallback(e => {
    if ([401,403,404].includes(e.status)) { offlineRef.current.clear?.();setData(null); closeDrawer(); setGuardianStep(null); setError('Your access has changed. Refresh or sign in again to load your current assignments.') }
    else if(!e.status && offlineRef.current.online && (e.name==='TypeError'||e.name==='TimeoutError'||e.name==='AbortError')){offlineRef.current.disconnect();setStale(false);setError('Connection unavailable. Offline recordings remain pending until synced.')}
    else { setStale(true); setError(`View may be out of date. ${e.message}`) }
  }, [closeDrawer])
  const reload = useCallback(async (quiet = false) => {
    const request=readState.current, key=request.key, serial=++readSerial.current
    if(!offlineRef.current.online){
      const saved=await offlineRef.current.cached(key)
      if(serial!==readSerial.current||current.current!==eventId||readState.current.key!==key)return
      if(saved){setData({...saved,_readKey:key});setStale(false);setError('');return}
      throw new Error('This page was not loaded before the connection was lost')
    }
    let result
    try{result=await api.guestServices(eventId,{...request.params,...(quiet && request.revision && Date.now()-request.lastFull<120000 ? {since:request.revision}:{})})}
    catch(error){if(serial!==readSerial.current||readState.current.key!==key||current.current!==eventId)return;throw error}
    if(serial!==readSerial.current||readState.current.key!==key||current.current!==eventId)return
    if(result?.unchanged){setStale(false);setError('');return}
    if(result?.revision){request.revision=result.revision;request.lastFull=Date.now()}
    if (current.current !== eventId) return
    if (!result) { const error=new Error('Sign-in required'); error.status=401; throw error }
    if (!layoutInitialized.current) { if (result.is_supervisor && (result.tables || result.locations?.tables || []).length > 24) setView('list'); layoutInitialized.current = true }
    setData({...result,_readKey:key}); setStale(false); setError('');offlineRef.current.cache(key,result)
  }, [eventId])
  useEffect(() => {
    setAttendanceReceipt(null);
    layoutInitialized.current = false; setSection('all'); setCoverage('all'); setPage(1);
    setData(null); setStale(false); setCreatedTask(null); setGuardianStep(null); setGuardianToken(''); setIdentityConfirmed(false); setError(''); setNotice(''); setDrawer(null); setMenuGuest(null); setTab('tables'); setFilter('all'); setQuery(''); setAttention(false); setScanMode(''); setToken(''); setDirection('in')
    setRequest({ assignment_id: '', title: '', notes: '', priority: 'normal', assignee_user_id: '' }); requestKey.current = null
    if (!eventId) return
    let live = true
    const refresh = () => reload(true).catch(e => { if (live) loadError(e) })
    const visibleRefresh = () => { if (!document.hidden && !inflight.current) refresh() }
    const timer = setInterval(visibleRefresh, 20000)
    document.addEventListener('visibilitychange', visibleRefresh)
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', visibleRefresh) }
  }, [eventId, reload, loadError])
  useEffect(() => { if(eventId){setStale(true);reload().catch(loadError)} }, [eventId,readKey,reload,loadError])
  const previousConnection=useRef({online:offline.online,syncing:offline.syncing})
  useEffect(()=>{const old=previousConnection.current;previousConnection.current={online:offline.online,syncing:offline.syncing};if(eventId&&!offline.syncing&&(old.online!==offline.online||old.syncing))reload().catch(loadError)},[offline.online,offline.syncing])
  async function record(action,guest,service,fn,message){
    if(inflight.current||offlineRef.current.syncing)return
    if(stale){setError('Refresh the outdated view before recording another observation.');return}
    if(offlineRef.current.online&&(!data?.offline_supported||offlineRef.current.storageError))return act(fn,message)
    const actor=offlineRef.current.actor
    try{
      const key=await offlineRef.current.queue(action,guest,service)
      setNotice('Saved on this device · pending server confirmation');setError('')
      if(offlineRef.current.online){
        const remaining=await offlineRef.current.sync()
        if(current.current!==eventId||offlineRef.current.actor!==actor)return
        if(remaining&&!remaining.some(row=>row.client_key===key))setNotice(message)
        await reload()
      }
    }catch(e){setError(e.message)}
  }
  useEffect(() => setPage(1), [section, coverage, query, attention, view, tab, filter])
  async function refreshWorkspace() {
    if (inflight.current) return
    inflight.current=true;setBusy(true);setError('')
    try { await reload();if(current.current===eventId)setNotice('Workspace refreshed') }
    catch(e){if(current.current===eventId)loadError(e)}
    finally{inflight.current=false;setBusy(false)}
  }
  async function act(fn, success, close = false) {
    if(!offlineRef.current.online){setError('This action needs a connection. Use the offline recording buttons for seating, delivery or headcount.');return}
    if (inflight.current || offlineRef.current.syncing) return
    if(stale){setError('Refresh the outdated view before recording more actions.');return}
    inflight.current = true; setBusy(true); setError(''); setNotice(''); setCreatedTask(null)
    try {
      const result=await fn()
      if (current.current !== eventId) return
      setNotice(result?.guardian_required ? 'Guardian verification required — scan the authorized adult’s pass or verify their identity below.' : success)
      if(close)closeDrawer()
      try { await reload() }
      catch(e){if(current.current===eventId){loadError(e);if(![401,403,404].includes(e.status))setError(`Saved successfully, but the view could not refresh. ${e.message} Use Refresh; do not repeat the saved action.`)}}
    } catch (e) {
      if(current.current===eventId){
        if(e.status===401)loadError(e)
        else if([403,404].includes(e.status)){
          try{await reload();if(current.current===eventId)setError(e.message)}
          catch(refreshError){if(current.current===eventId)loadError(refreshError)}
        }else setError(e.message)
      }
    }
    finally { inflight.current = false; setBusy(false) }
  }
  // Guests who have not arrived yet are expected, not neglected: attention starts once they are admitted.
  const needsHelp = g => g.admitted && (!g.seated_at || (g.can_manage_meals && (data.menu_categories.some(c => c.is_required && !g.choices.some(x => x.category_id === c.id)) || g.meal_services.some(s => s.can_serve ?? (s.eligible && s.status === 'open' && !s.served)))))
  const allGuests = data?.guests || [], team = data?.team || [], zones = data?.zones || []
  const tables = data?.tables || data?.locations?.tables || [...new Map([...allGuests.map(g => [g.table_id, { id: g.table_id, name: g.table_name }]), ...(data?.assignments || []).filter(a => a.table_id && a.active).map(a => [a.table_id, { id: a.table_id, name: a.name }])]).values()]
  const tableGuests = id => allGuests.filter(g => g.table_id === id)
  const coveredBy = (id, type = 'table_id') => team.filter(m => m.assignments.some(a => a[type] === id && a.active))
  const activeAssignments = data?.assignments.filter(a => a.active) || [], requestLocations = data?.can_configure && data?.locations ? [...data.locations.tables.map(t => ({ id: `table:${t.id}`, name: t.name })), ...data.locations.zones.map(z => ({ id: `zone:${z.id}`, name: `${z.name} (room)` }))] : activeAssignments, canAdmit = data?.can_scan_admission ?? allGuests.some(g => g.can_checkin), scanZones = zones.filter(z => z.can_scan)
  const matches = value => String(value).toLowerCase().includes(query.trim().toLowerCase())
  const guests = data?.pagination?.view==='guests' ? allGuests : allGuests.filter(g => (filter === 'all' || g.table_id === filter) && matches(`${g.name} ${g.table_name}`) && (!attention || needsHelp(g)))
  const filteredTables = tables.filter(t => matches(`${t.name} ${t.service_section || ''} ${coveredBy(t.id).map(m => m.name).join(' ')}`) && (section === 'all' || (t.service_section || '') === section) && (coverage === 'all' || (coverage === 'uncovered' ? coveredBy(t.id).length === 0 : coveredBy(t.id).length > 0)) && (!attention || (t.metrics ? t.metrics.attention>0 : tableGuests(t.id).some(needsHelp))))
  const filteredRooms = zones.filter(z => matches(z.name))
  const filteredTeam = team.filter(m => matches(m.name))
  const pageSize = 24
  const pageRows = rows => data?.pagination?.view==='guests' && tab==='guests' ? rows : rows.slice((Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)))-1)*pageSize, Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)))*pageSize)
  const pagination = (rows, label, singular = label) => { const total=data?.pagination?.view==='guests' && tab==='guests'?data.pagination.total:rows.length; const pages=Math.max(1,Math.ceil(total/pageSize)), currentPage=Math.min(page,pages); return <nav className="gs-pagination" aria-label={`${label} pages`}><span>{total} {total === 1 ? singular : label} · Page {currentPage} of {pages}</span><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous {label}</button><button disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Next {label}</button></nav> }
  const selectedGuest = drawer?.type === 'guest' && allGuests.find(g => g.id === drawer.id)
  const avatar = name => <span className="gs-avatar" aria-hidden="true">{initials(name)}</span>
  const openAssignments = member => setDrawer({ type: 'assign', member })
  function openTable(id) { setFilter(id); setQuery(''); setAttention(false); setTab('guests') }
  // Supervisor locations are encoded table:<id> / zone:<id>; staff pick an assignment id.
  const requestTarget = v => /^(table|zone):/.test(v) ? { assignment_id: undefined, [`${v.split(':')[0]}_id`]: v.split(':')[1] } : { assignment_id: v }
  function requestField(field, value) { requestKey.current = null; setRequest(old => ({ ...old, [field]: value })) }
  async function scan(raw, guardianGuestId = null) {
    const value=passToken(raw), pending=guardianStep
    const body=pending ? {token:pending.childToken,zone_id:pending.zoneId,direction:pending.direction,guardian_token:guardianGuestId ? null : value,guardian_guest_id:guardianGuestId} : {token:value,zone_id:scanMode || null,direction}
    await act(async()=>{
      const result=await api.guestServiceScan(eventId,body)
      if(current.current!==eventId)return
      if(result.status==='guardian_required'){
        setGuardianStep({childToken:body.token,zoneId:body.zone_id,direction:body.direction,name:result.guest_name || 'This junior',candidates:result.guardian_candidates || []});setGuardianToken('');setIdentityConfirmed(false)
        return {guardian_required:true}
      }
      if(!['ok','admitted','already_admitted'].includes(result.status))throw new Error(result.message || result.status)
      setGuardianStep(null);setGuardianToken('');setIdentityConfirmed(false);setToken('')
      return result
    },'Scan recorded. The workspace has been refreshed.')
  }
  const switchTab = next => { setTab(next); setQuery(''); setFilter('all'); setAttention(false) }
  const taskLink = <Link to="/team-redesign?tab=tasks">Open team Tasks →</Link>
  const scanner = <><p className="gs-callout">Event admission, room entry and session attendance are separate. Existing ticket, capacity and guardian rules still apply.</p><label>Record<select aria-label="Record" value={scanMode} disabled={busy || offline.syncing || stale || !!guardianStep} onChange={e => setScanMode(e.target.value)}>{canAdmit ? <option value="">Event check-in for assigned table guests</option> : <option value="" disabled>Choose a room / zone</option>}{scanZones.map(z => <option key={z.id} value={z.id}>{z.name} · room / zone access</option>)}</select></label>{scanMode && <label>Direction<select aria-label="Direction" disabled={busy || offline.syncing || stale || !!guardianStep} value={direction} onChange={e => setDirection(e.target.value)}><option value="in">Entry</option><option value="out">Exit</option></select></label>}<QrCameraScanner disabled={busy || offline.syncing || stale || !offline.online || (!canAdmit && !scanMode)} onScan={scan} />{guardianStep ? <section className="gs-guardian-panel" aria-label="Guardian verification"><h3>{guardianStep.name}: authorized guardian needed</h3><p>Keep the junior present. Scan the authorized adult’s QR pass, or use staff identity verification only when enabled.</p><form onSubmit={e=>{e.preventDefault();scan(guardianToken)}}><label>Guardian pass link or QR token<input required disabled={busy || offline.syncing || stale} value={guardianToken} onChange={e=>setGuardianToken(e.target.value)} /></label><button className="gs-primary" disabled={busy || offline.syncing || stale}>Verify guardian pass</button></form>{data.manual_guardian_verification_enabled && guardianStep.candidates.length>0 && <><label className="gs-check"><input type="checkbox" disabled={busy || offline.syncing || stale} checked={identityConfirmed} onChange={e=>setIdentityConfirmed(e.target.checked)} />I verified this adult’s identity in person</label>{guardianStep.candidates.map(c=><button key={c.guardian_guest_id} disabled={busy || offline.syncing || stale || !identityConfirmed} onClick={()=>scan(null,c.guardian_guest_id)}>Confirm {c.name}{c.relationship ? ` · ${c.relationship}` : ''}</button>)}</>}{!data.manual_guardian_verification_enabled && <p>Staff identity selection is disabled. Use the guardian’s QR pass.</p>}<button disabled={busy} onClick={()=>{setGuardianStep(null);setGuardianToken('');setIdentityConfirmed(false)}}>Cancel guardian verification</button></section> : <form className="gs-scan-form" onSubmit={e => { e.preventDefault(); scan(token) }}><label>Pass link or QR token<input required disabled={busy || offline.syncing || stale} value={token} onChange={e => setToken(e.target.value)} /></label><button className="gs-primary" disabled={busy || offline.syncing || stale || (!canAdmit && !scanMode)}>Record scan</button></form>}</>
  const requestForm = <form onSubmit={e => { e.preventDefault(); if (!requestKey.current) requestKey.current = crypto.randomUUID(); act(async () => { const saved = await api.guestServiceRequest(eventId, { ...request, ...requestTarget(request.assignment_id), request_key: requestKey.current, assignee_user_id: request.assignee_user_id || null }); if (current.current === eventId) { setCreatedTask(saved.task_id); requestKey.current = null; setRequest(old => ({ ...old, title: '', notes: '' })) } }, 'Request added to team Tasks', true) }}><p>Creates one task in the existing team Tasks board. Keep sensitive guest information out of shared notes.</p><label>Location<select aria-label="Location" required disabled={busy || offline.syncing || stale} value={request.assignment_id} onChange={e => requestField('assignment_id', e.target.value)}><option value="">{data?.can_configure ? 'Choose a table or room' : 'Choose your assignment'}</option>{requestLocations.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>What needs attention?<input required maxLength={180} disabled={busy || offline.syncing || stale} value={request.title} onChange={e => requestField('title', e.target.value)} /></label><label>Details<textarea maxLength={2000} disabled={busy || offline.syncing || stale} value={request.notes} onChange={e => requestField('notes', e.target.value)} /></label><div className="gs-two"><label>Priority<select aria-label="Priority" disabled={busy || offline.syncing || stale} value={request.priority} onChange={e => requestField('priority', e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label>Assign to<select aria-label="Assign to" disabled={busy || offline.syncing || stale} value={request.assignee_user_id} onChange={e => requestField('assignee_user_id', e.target.value)}><option value="">Unassigned · team queue</option>{data?.request_assignees.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div><button className="gs-primary" disabled={busy || offline.syncing || stale}>Create team task</button></form>
  const guestCare = g => <><div className="gs-person-intro">{avatar(g.name)}<div><h3>{g.name}</h3><p>{g.table_name}{g.seat_number ? ` · Seat ${g.seat_number}` : ''}</p></div></div><section className="gs-care-section"><h3>Arrival & seating</h3><div className="gs-chips"><span className={g.admitted ? 'gs-good' : ''}>{g.admitted ? 'Checked in' : 'Expected'}</span><span className={g.seated_at ? 'gs-good' : 'gs-warm'}>{g.seated_at ? 'Seated' : 'Not seated'}</span></div><div className="gs-actions">{!g.admitted && g.can_checkin && <button onClick={() => { setScanMode(''); setDrawer({ type: 'scan' }) }}>Scan guest pass</button>}{g.admitted && !g.seated_at && <button disabled={busy || offline.syncing || stale || (data.is_supervisor && !data.can_configure)} onClick={() => record('seated',g,null,() => api.markGuestSeated(eventId,g.id,true),`${g.name} marked seated`)}>Mark seated</button>}{g.seated_at && <button disabled={busy || offline.syncing || stale || (data.is_supervisor && !data.can_configure)} onClick={() => act(() => api.markGuestSeated(eventId, g.id, false), 'Seating confirmation corrected')}>Correct seating confirmation</button>}</div></section>{g.can_manage_meals && <section className="gs-care-section"><h3>Menu & collection</h3>{data.menu_categories.length > 0 && <button disabled={busy || offline.syncing || stale || !offline.online || g.menu_selections_locked || data.menu_categories.every(c => (g.locked_category_ids || []).includes(c.id))} onClick={() => setMenuGuest(g.id)}>Help choose menu</button>}<p>{g.choices.length ? g.choices.map(c => c.name).join(', ') : 'No menu choices recorded'}</p>{menuGuest === g.id && <MenuEditor key={g.id} guest={g} categories={data.menu_categories} busy={busy || offline.syncing || stale} close={() => setMenuGuest(null)} save={body => act(async () => { await api.assistGuestMenu(eventId, g.id, body); if (current.current === eventId) setMenuGuest(null) }, 'Guest selections saved')} />}{g.meal_services.map(s => <div className="gs-service" key={s.id}><div><strong>{s.name}</strong><small>{s.served ? 'Served · choices locked' : s.availability_reason || (!s.eligible ? 'Not eligible' : s.status !== 'open' ? `Collection ${s.status}` : 'Awaiting collection')}</small></div>{s.attended_at && <small>Meal attendance recorded</small>}{s.tracking_mode!=='orders'&&!s.attended_at&&g.admitted&&<button disabled={busy||stale} onClick={()=>record('attendance',g,s,()=>api.syncGuestServiceAction(eventId,queuedAction('attendance',g,s)),'Meal attendance recorded')}>Count meal attendance</button>}{!s.served && s.tracking_mode!=='headcount' && <button disabled={busy || offline.syncing || stale || s.can_serve === false || !s.eligible || s.status !== 'open' || !g.admitted} onClick={() => record('served',g,s,() => api.serveGuestMeal(eventId,g.id,s.id),`${s.name} marked served`)}>Mark served</button>}</div>)}</section>}</>
  return <RedesignShell topActive="guestservices" withEventSidebar eventActive="guestservices"><main className="gs-page">
    <header className="gs-heading"><div><p className="gs-eyebrow">EVENT OPERATIONS{data?.event_name ? ` / ${data.event_name}` : ''}</p><h1>Guest Services<span>.</span></h1><p>One clear view of your tables, people and rooms.</p></div><div className="gs-heading-actions"><button onClick={() => setDrawer({ type: 'help' })}>? Quick guide</button>{data?.can_configure && <button className="gs-primary" onClick={() => openAssignments(null)}>＋ Assign staff</button>}{(canAdmit || scanZones.length > 0) && <button className={!data?.can_configure ? 'gs-primary' : ''} onClick={() => setDrawer({ type: 'scan' })}>Scan a pass</button>}</div></header>
    {error && !drawer && <div role="alert" className="gs-error">{error} <button disabled={busy} onClick={refreshWorkspace}>Refresh</button></div>}{notice && <div role="status" className="gs-notice">{notice}{createdTask && <Link to="/team-redesign?tab=tasks">View saved task →</Link>}</div>}
    <GuestServiceOfflinePanel offline={offline}/>
    {!eventId ? <div className="gs-empty"><h2>Choose an event to get started</h2><p>Select your event from the header.</p></div> : !data ? <div className="gs-empty" role="status"><h2>{error ? 'The workspace could not load' : 'Loading your workspace…'}</h2><p>{error ? 'Use Refresh to try again.' : 'Finding your assigned tables, rooms and guests.'}</p></div> : <>
      {data.can_configure && data.setup_warnings && Object.values(data.setup_warnings).some(Boolean) && <details className="gs-setup-warnings" aria-label="Setup needs attention"><summary>Before your team goes live <span>Review setup checks</span></summary><ul>{data.setup_warnings.unclaimed_placeholders>0 && <li>{data.setup_warnings.unclaimed_placeholders} placeholder accounts need real staff sign-ins. <Link to="/team-redesign?tab=team">Open Team →</Link></li>}{data.setup_warnings.unallocated_guests>0 && <li>{data.setup_warnings.unallocated_guests} guests have no table allocation and are outside the table workspace. <Link to="/addons-redesign?tab=seating">Review Seating →</Link></li>}{data.setup_warnings.services_without_windows>0 && <li>{data.setup_warnings.services_without_windows} open meal collections need confirmed serving windows. <Link to="/kitchen-redesign">Review meals →</Link></li>}{data.setup_warnings.open_demo_services>0 && <li>{data.setup_warnings.open_demo_services} demo meal collections remain open. Review and close them before attendee use.</li>}</ul></details>}
      <section className="gs-summary" aria-label="Guest service summary">{[[tables.length, data.is_supervisor ? 'Tables in view' : 'My tables'], [data.metrics?.admitted ?? allGuests.filter(g => g.admitted).length, 'Checked in'], [data.metrics?.delivered ?? allGuests.reduce((n, g) => n + g.meal_services.filter(s => s.served).length, 0), 'Meals collected'], [data.metrics?.attention ?? allGuests.filter(needsHelp).length, 'Need attention']].map(([n, label], i) => <div key={label}><span className={`gs-metric-icon gs-tone-${i}`} aria-hidden="true">{['▦', '◎', '◷', '⚑'][i]}</span><div><strong>{n}</strong><span>{label}</span></div></div>)}</section>
      <div className="gs-workspace-nav"><nav aria-label="Guest Services views">{[['tables', data.is_supervisor ? 'Tables' : 'My tables', tables.length], ['staff', data.is_supervisor ? 'Staff' : 'My assignments', data.is_supervisor ? team.length : data.assignments.length], ['rooms', 'Rooms', zones.length], ['guests', 'Guests', data.metrics?.assigned ?? allGuests.length], ['attendance', 'Meal attendance', null], ['meals', 'Meal requests', data.meal_request_total ?? (data.meal_requests || []).filter(r=>r.status!=='served').length], ['requests', 'Requests', null], ...(data.is_supervisor ? [['activity', 'Activity', null]] : [])].map(([id, label, count]) => <button key={id} aria-pressed={tab === id} onClick={() => switchTab(id)}>{label}{count !== null && <span>{count}</span>}</button>)}</nav><button className="gs-refresh" disabled={busy} onClick={refreshWorkspace}>↻ Refresh</button></div>
      <div className="gs-toolbar"><div><h2>{({ activity: 'Who did what, and when', tables: data.is_supervisor ? 'Your floor, at a glance' : 'Your tables. Your guests.', staff: data.is_supervisor ? 'The people behind every welcome' : 'Your location assignments', rooms: 'Keep every room connected', guests: 'Look after every guest', attendance: 'Count attendance for each meal', meals: 'Every meal, from choice to delivery', requests: 'Ask for a helping hand' })[tab]}</h2><p>{({ activity: 'Who did what, and when', tables: 'Clear ownership and quick actions for every table.', staff: 'Coverage, permissions and shifts, close to the work.', rooms: 'Room movement stays separate from event admission.', guests: 'Open a guest to see arrival, seating and each meal.', attendance: 'Scan a pass for the selected meal. No food order is needed.', meals: 'New → Preparing → Ready → Delivered. Only requests within your meal permissions appear.', requests: 'Assistance and handovers use the existing team Tasks.' })[tab]}</p></div><div className="gs-tools">{!['requests','attendance','activity'].includes(tab) && <input type="search" aria-label="Search workspace" placeholder="Find a table or person…" value={query} onChange={e => setQuery(e.target.value)} />}{['tables', 'guests'].includes(tab) && <label className="gs-check gs-filter"><input type="checkbox" checked={attention} onChange={e => setAttention(e.target.checked)} />Needs attention</label>}{tab === 'tables' && <div className="gs-view-switch" aria-label="Table layout"><button aria-pressed={view === 'list'} onClick={() => setView('list')}>Compact list</button><button aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button><button aria-pressed={view === 'canvas'} onClick={() => setView('canvas')}>Floor canvas</button></div>}</div></div>
      <MealUpdateNotice updates={mealUpdates} dismiss={dismissMealUpdates} open={()=>switchTab('meals')} />
      {tab === 'tables' && <div className="gs-table-filters"><label>Section<select aria-label="Table section" value={section} onChange={e=>setSection(e.target.value)}><option value="all">All sections in your view</option>{[...new Set(tables.map(t=>t.service_section || ''))].sort().map(name=><option key={name} value={name}>{name || 'Unsectioned'}</option>)}</select></label>{data.is_supervisor && <label>Staff coverage<select aria-label="Staff coverage" value={coverage} onChange={e=>setCoverage(e.target.value)}><option value="all">All coverage</option><option value="covered">Covered tables</option><option value="uncovered">Without active staff</option></select></label>}<p>Up to 24 tables per page. Edit a table to set its section.</p></div>}
      {tab === 'tables' && pagination(filteredTables,'tables','table')}
      {tab === 'tables' && <div className={`gs-floor-layout ${view === 'canvas' ? 'gs-canvas-layout' : ''}`}><section className={view === 'canvas' ? 'gs-floor-canvas' : view === 'list' ? 'gs-table-list' : 'gs-table-grid'} aria-label={view === 'canvas' ? 'Table coverage diagram' : 'Tables'}>{view === 'canvas' && <p className="gs-canvas-caption">TABLE COVERAGE <span>Open a table to see its guests</span></p>}{pageRows(filteredTables).map((t, i) => { const roster = tableGuests(t.id), stats=t.metrics || {assigned:roster.length,admitted:roster.filter(g=>g.admitted).length,seated:roster.filter(g=>g.seated_at).length,attention:roster.filter(needsHelp).length,delivered:roster.reduce((n,g)=>n+g.meal_services.filter(s=>s.served).length,0)}, managers = coveredBy(t.id), lead = managers.find(m => m.assignments.some(a => a.table_id === t.id && a.active && a.is_lead)) || managers[0], seated = stats.seated, detail = data.locations?.tables.find(l => l.id === t.id); return view === 'list' ? <article className="gs-table-list-row" key={t.id}><div><h3>{t.name}</h3><small>{t.service_section || 'Unsectioned'}</small></div><span>{seated} / {stats.assigned} seated</span><span>{lead?.name || (data.is_supervisor ? 'No active staff' : 'Your assignment')}</span><div><button onClick={()=>openTable(t.id)}>View guests →</button>{data.can_configure && detail && <button aria-label={`Edit ${t.name}`} onClick={()=>setDrawer({type:'table',table:detail})}>Edit table</button>}</div></article> : view === 'canvas' ? <button className="gs-floor-table" key={t.id} onClick={() => openTable(t.id)} aria-label={`Open ${t.name}`}><span>{t.name}</span><strong>{seated} / {stats.assigned}</strong><small>seated / assigned</small>{lead && <span className="gs-floor-avatar">{initials(lead.name)}</span>}</button> : <article className={`gs-table-card gs-card-tone-${i % 3}`} key={t.id}><div className="gs-card-top"><span className="gs-card-label">TABLE</span><span className={`gs-badge ${stats.attention>0 ? 'gs-warm' : 'gs-good'}`}>{!stats.assigned ? 'No guests yet' : stats.attention>0 ? 'Needs attention' : 'Looked after'}</span>{data.can_configure && detail && <button className="gs-icon-btn" aria-label={`Edit ${t.name}`} onClick={() => setDrawer({ type: 'table', table: detail })}>✎</button>}</div><h3>{t.name}</h3><p>{stats.assigned} assigned{t.capacity != null ? ` · ${t.capacity} seats` : ''}</p><div className="gs-table-stats"><div><strong>{stats.admitted}</strong><span>Checked in</span></div><div><strong>{seated}</strong><span>Seated</span></div><div><strong>{stats.delivered}</strong><span>Meals collected</span></div></div><div className="gs-manager-line">{avatar(lead?.name || '?')}<div><strong>{lead?.name || (data.is_supervisor ? 'No active staff coverage' : 'Your assignment')}</strong><small>{managers.length > 1 ? `+ ${managers.length - 1} shared teammate${managers.length > 2 ? 's' : ''}` : 'Table responsibility'}</small></div>{data.can_configure && <button className="gs-text-btn" aria-label={`Edit assignments for ${t.name}`} onClick={() => openAssignments(lead || null)}>Edit ↗</button>}</div><div className="gs-card-footer"><span>{seated} of {stats.assigned} seated</span><button className="gs-text-btn" onClick={() => openTable(t.id)}>View guests →</button></div><div className="gs-progress" aria-hidden="true"><span style={{ width: `${stats.assigned ? seated / stats.assigned * 100 : 0}%` }} /></div></article> })}{!filteredTables.length && <div className="gs-empty"><h3>{tables.length ? 'No matching tables' : 'No tables in this view'}</h3><p>{data.can_configure ? 'Prepare tables in Seating, then assign your team.' : 'Ask your organiser to assign a table, or check the Rooms tab.'}</p>{data.can_configure && <Link to="/addons-redesign?tab=seating">Open Seating →</Link>}</div>}</section><aside className="gs-floor-aside"><section className="gs-aside-card gs-aside-warm"><span className="gs-aside-symbol" aria-hidden="true">⚑</span><h3>A little attention goes a long way.</h3><p>{(() => { const n = data.metrics?.attention ?? allGuests.filter(needsHelp).length, away = data.metrics ? data.metrics.assigned-data.metrics.admitted : allGuests.filter(g => !g.admitted).length; return `${n} checked-in ${n === 1 ? 'guest has' : 'guests have'} a seating or meal step outstanding${away ? ` · ${away} yet to arrive` : ''}.` })()}</p><button onClick={() => { setTab('guests'); setFilter('all'); setQuery(''); setAttention(true) }}>View guests to look after →</button></section>{data.is_supervisor && <section className="gs-aside-card"><h3>People on the floor</h3>{team.filter(m => m.assignments.some(a => a.active)).slice(0, 5).map(m => <div className="gs-manager-line" key={m.id}>{avatar(m.name)}<div><strong>{m.name}</strong><small>{m.assignments.filter(a => a.active).length} active locations</small></div>{data.can_configure && <button className="gs-text-btn" onClick={() => openAssignments(m)}>Edit</button>}</div>)}<button className="gs-text-btn" onClick={() => switchTab('staff')}>View team coverage →</button></section>}<section className="gs-aside-card gs-aside-lilac"><h3>Keep handovers moving.</h3><p>Requests become normal team tasks with an owner and progress.</p>{requestLocations.length ? <button onClick={() => setDrawer({ type: 'request' })}>＋ Request assistance</button> : taskLink}</section>{view === 'canvas' && <p className="gs-caption">This diagram shows responsibility. Actual table placement stays in Seating.</p>}</aside></div>}
      {tab === 'staff' && (data.is_supervisor ? <section className="gs-staff-grid" aria-label="Event team">{pageRows(filteredTeam).map(m => <article className="gs-person-card" key={m.id}><div className="gs-card-top">{avatar(m.name)}<span className="gs-badge">{m.event_role === 'manager' ? 'Event manager' : m.scoped ? 'Restricted staff' : 'Event staff'}</span></div><h3>{m.name}</h3><p>{m.assignments.filter(a => a.active).length} active locations</p><div className="gs-chips">{m.assignments.slice(0, 4).map(a => <span key={a.id} className={!a.active ? 'gs-warm' : ''}>{a.name}{a.is_lead ? ' · Lead' : ''}</span>)}{m.assignments.length > 4 && <span>+ {m.assignments.length - 4} more</span>}</div><div className="gs-actions">{data.can_configure && m.event_role !== 'manager' && <button className="gs-primary" onClick={() => openAssignments(m)}>Edit assignments</button>}{data.can_configure && m.can_rename_placeholder && <button onClick={() => setDrawer({ type: 'placeholder', member: m })}>Edit name</button>}<Link to="/team-redesign?tab=team">Manage in Team ↗</Link></div></article>)}{!filteredTeam.length && <div className="gs-empty"><h3>{team.length ? 'No matching staff' : 'Build your event team'}</h3>{team.length>0 && <button onClick={()=>setQuery('')}>Clear search</button>}<Link to="/team-redesign?tab=team">Add teammates in Team →</Link></div>}</section> : <section className="gs-staff-grid">{data.assignments.map(a => <article className="gs-person-card" key={a.id}><span className={`gs-badge ${a.active ? 'gs-good' : 'gs-warm'}`}>{a.active ? 'Active assignment' : 'Outside shift'}</span><h3>{a.name}</h3>{a.is_lead && <p>Location lead</p>}<div className="gs-chips">{a.can_checkin && <span>Event check-in</span>}{a.can_manage_meals && <span>Meal assistance</span>}{a.can_scan_zone && <span>Room entry / exit</span>}</div><p>{a.starts_at ? `From ${new Date(`${a.starts_at}Z`).toLocaleString()}` : 'Ongoing assignment'}{a.ends_at ? ` · Until ${new Date(`${a.ends_at}Z`).toLocaleString()}` : ''}</p></article>)}{!data.assignments.length && <div className="gs-empty"><h3>No assignments yet</h3><p>Ask your organiser to assign your tables or rooms.</p></div>}</section>)}
      {tab === 'staff' && data.is_supervisor && pagination(filteredTeam,'staff')}
      {tab === 'rooms' && <section className="gs-room-grid">{filteredRooms.map(z => <article className="gs-room-card" key={z.id}><div className="gs-card-top"><span className="gs-card-label">CONFERENCE ROOM</span><span className="gs-badge">{z.can_scan ? 'Scanning available' : 'View only'}</span></div><h3>{z.name}</h3><div className="gs-room-count">{z.inside_count ?? z.inside.length}<small>currently inside</small></div>{data.is_supervisor && <p>{coveredBy(z.id, 'zone_id').map(m => m.name).join(' · ') || 'No active staff coverage'}</p>}<button onClick={() => {setRoomPage(1);setDrawer({ type: 'room', id: z.id })}}>Open room →</button></article>)}{!filteredRooms.length && <div className="gs-empty"><h3>{zones.length ? 'No matching rooms' : 'No rooms in this view'}</h3>{zones.length>0 && <button onClick={()=>setQuery('')}>Clear search</button>}<p>{data.can_configure ? 'Add rooms in Venue Access, then assign your stewards.' : 'Your organiser can assign rooms for entry and exit assistance.'}</p></div>}</section>}
      {tab === 'guests' && <><div className="gs-guest-filter"><label>Table<select aria-label="Table" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All assigned tables</option>{tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><span>{data.pagination?.view==='guests'?data.pagination.total:guests.length} guests in view</span></div><section className="gs-guest-list" aria-label="Guests at tables">{pageRows(guests).map(g => <article className="gs-guest-row" key={g.id}><div className="gs-guest-identity">{avatar(g.name)}<div><h3>{g.name}</h3><p>{g.table_name}{g.seat_number ? ` · Seat ${g.seat_number}` : ''}</p></div></div><div className="gs-chips"><span className={g.admitted ? 'gs-good' : ''}>{g.admitted ? 'Checked in' : 'Expected'}</span><span className={g.seated_at ? 'gs-good' : 'gs-warm'}>{g.seated_at ? 'Seated' : 'Not seated'}</span></div><div className="gs-guest-meal">{g.can_manage_meals ? `${g.meal_services.filter(s => s.served).length} of ${g.meal_services.length} meals collected` : 'Meal details restricted'}</div><button onClick={() => { setMenuGuest(null); setDrawer({ type: 'guest', id: g.id }) }}>Open guest →</button></article>)}{!guests.length && <div className="gs-empty"><h3>No guests match this view</h3><p>Try a different table, search or attention filter.</p></div>}</section></>}
      {tab === 'guests' && pagination(guests,'guests','guest')}
      {tab === 'activity' && data.is_supervisor && <GuestServiceActivity key={eventId} eventId={eventId} team={team} guests={allGuests} />}
      {tab === 'attendance' && <MealAttendancePanel services={data.meal_services || []} busy={busy || offline.syncing || stale || !offline.online} receipt={attendanceReceipt} configure={(id,body)=>act(()=>api.configureMealTracking(eventId,id,body,true),'Meal tracking saved')} scan={(id,token)=>act(async()=>{setAttendanceReceipt(null);const result=await api.scanMealAttendance(eventId,id,token,true);if(current.current===eventId)setAttendanceReceipt({...result,message:`${result.guest_name}: ${result.message}`});return result},'Meal attendance saved')} correct={(id,guestId,body)=>act(async()=>{const result=await api.correctMealAttendance(eventId,id,guestId,body,true);if(current.current===eventId)setAttendanceReceipt(result);return result},'Meal attendance corrected')} />}
      {tab === 'meals' && <MealRequestQueue pagination={data.pagination?.view==='meals'?data.pagination:null} serverFilters={{stage:mealStage,table:mealTable,tables}} onServerFilter={(kind,value)=>{setMealPage(1);kind==='stage'?setMealStage(value):setMealTable(value)}} onServerPage={setMealPage} rows={data.meal_requests || []} query={query} busy={busy || offline.syncing || stale || !offline.online} progress={row=>act(()=>api.progressGuestMeal(eventId,row.guest_id,row.service_id,mealProgressBody(row)),`${row.service_name}: progress saved`)} />}
      {tab === 'requests' && <section className="gs-request-home"><div className="gs-aside-card"><h3>Request help or hand over work</h3><p>Water, accessibility assistance, housekeeping or a shift handover: create one task for the team.</p>{requestLocations.length > 0 ? <button className="gs-primary" onClick={() => setDrawer({ type: 'request' })}>＋ Request assistance</button> : <p>To create a location request here, your organiser must assign you to an active table or room. You can still open the team Tasks board.</p>}{taskLink}</div><div className="gs-aside-card gs-aside-lilac"><h3>One place to follow progress</h3><p>Start, discuss and complete work in the existing Tasks board. Guest Services does not create another task queue.</p>{taskLink}</div></section>}
      <footer className="gs-page-footer"><span>Refreshes changed pages every 20 seconds · offline recordings stay pending until synced</span><button className="gs-text-btn" onClick={() => setDrawer({ type: 'help' })}>How Guest Services works ↗</button></footer>
    </>}
    {data && drawer && <Drawer title={({ help: 'How Guest Services works', assign: 'Edit staff assignments', placeholder: 'Edit placeholder name', table: 'Edit table details', guest: 'Guest care', room: 'Room workspace', request: 'Request assistance', scan: 'Scan a guest pass' })[drawer.type]} onClose={closeDrawer} busy={busy}>
      {error && <div role="alert" className="gs-error">{error}{stale && <button disabled={busy} onClick={refreshWorkspace}>Refresh workspace</button>}</div>}
      {drawer.type === 'help' && <GuestServicesHelp canConfigure={!!data.can_configure} />}
      {drawer.type === 'assign' && data.can_configure && <><label>Team member<select aria-label="Team member" disabled={busy} value={drawer.member?.id || ''} onChange={e => openAssignments(team.find(m => m.id === e.target.value) || null)}><option value="">Choose a staff member</option>{team.filter(m => m.event_role !== 'manager').map(m => <option key={m.id} value={m.id}>{m.name} · {m.assignments.length} assignments</option>)}</select></label>{drawer.member && <AssignmentEditor key={`${eventId}:${drawer.member.id}:${drawer.member.updated_at}`} member={drawer.member} locations={data.locations} busy={busy || offline.syncing || stale} onSave={(id, body) => act(() => api.configureGuestServices(eventId, id, body), 'Assignments saved', true)} />}<p><Link to="/team-redesign?tab=team">Add real staff or manage account permissions in Team →</Link></p></>}
      {drawer.type === 'placeholder' && data.can_configure && <PlaceholderEditor member={drawer.member} busy={busy || offline.syncing || stale} onSave={body => act(() => api.renameGuestServicePlaceholder(eventId, drawer.member.id, body), 'Placeholder name updated', true)} />}
      {drawer.type === 'table' && data.can_configure && <TableEditor table={drawer.table} busy={busy || offline.syncing || stale} onSave={body => act(() => api.updateTable(eventId, drawer.table.id, body, drawer.table.updated_at), 'Table details updated', true)} />}
      {drawer.type === 'guest' && (selectedGuest ? guestCare(selectedGuest) : <p>This guest is no longer in your active table assignments. Close this panel and refresh your view.</p>)}
      {drawer.type === 'room' && (() => { const zone = zones.find(z => z.id === drawer.id); return zone ? <><h3>{zone.name}</h3><p>{zone.inside_count ?? zone.inside.length} currently inside from accepted entry and exit scans.</p><ul className="gs-occupants">{zone.inside.map(g => <li key={g.guest_id}>{avatar(g.name)}{g.name}</li>)}</ul>{!(zone.inside_count ?? zone.inside.length) && <p>No guests currently recorded inside.</p>}{zone.inside_count!=null&&<div className='gs-actions'><button disabled={roomPage<=1} onClick={()=>setRoomPage(p=>p-1)}>Previous occupants</button><span>Page {roomPage} of {Math.max(1,Math.ceil(zone.inside_count/50))}</span><button disabled={roomPage*50>=zone.inside_count} onClick={()=>setRoomPage(p=>p+1)}>Next occupants</button></div>}{zone.can_scan && <div className="gs-actions"><button onClick={() => { setScanMode(zone.id); setDirection('in'); setDrawer({ type: 'scan' }) }}>Scan entry</button><button onClick={() => { setScanMode(zone.id); setDirection('out'); setDrawer({ type: 'scan' }) }}>Scan exit</button></div>}</> : <p>This room is no longer in your active assignments.</p> })()}
      {drawer.type === 'scan' && scanner}
      {drawer.type === 'request' && requestLocations.length > 0 && requestForm}
    </Drawer>}
  </main></RedesignShell>
}
