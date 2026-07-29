import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell, { Icon, ConfirmDialog } from './redesign/RedesignShell'
import './CheckinRedesignPage.css'

const TABS = [
  { id: 'zones', label: 'Zones' },
  { id: 'tickets', label: 'Ticket types' },
  { id: 'assign', label: 'Assign' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'rules', label: 'Rules' },
]

const mockZones = [
  { name: 'Main Hall', description: 'Primary reception space', capacity: 500, current: 478, direction: 'In & Out' },
  { name: 'VIP Lounge', description: 'Reserved seating and refreshments for VIP ticket holders', capacity: 80, current: 52, direction: 'In & Out' },
  { name: 'Kitchen', description: 'Back-of-house — vendor and staff only', capacity: 25, current: 3, direction: 'In-only' },
  { name: 'Overflow Tent', description: 'Additional seating for general-admission guests', capacity: 200, current: 140, direction: 'Out-only' },
]

const mockTicketTypes = [
  { name: 'General', color: 'var(--success)', capacity: 600, assigned: 480, allAllZones: false, zones: ['Main Hall', 'Overflow Tent'] },
  { name: 'VIP', color: 'var(--teal)', capacity: 100, assigned: 74, allAllZones: false, zones: ['Main Hall', 'VIP Lounge'] },
  { name: 'Staff', color: 'var(--warning)', capacity: 40, assigned: 22, allAllZones: true, zones: ['Main Hall', 'VIP Lounge', 'Kitchen', 'Overflow Tent'] },
]

const assignGuests = [
  { name: 'Karim Guest0308', ticket: 'General', tags: ['General ticket'] },
  { name: 'Noor Guest0071', ticket: 'VIP', tags: ['VIP wristband'] },
  { name: 'Idris Guest0092', ticket: 'Staff', tags: ['Staff badge'] },
  { name: 'Bilal Guest0106', ticket: 'General', tags: [] },
]

const tags = [
  { name: 'VIP wristband', color: 'var(--teal)', guestCount: 74, autoFrom: 'ticket_type = VIP' },
  { name: 'Staff badge', color: 'var(--warning)', guestCount: 22, autoFrom: null },
  { name: 'General ticket', color: 'var(--success)', guestCount: 480, autoFrom: 'ticket_type = General' },
  { name: 'Vendor pass', color: 'var(--faint)', guestCount: 6, autoFrom: null },
]

const gates = [
  { name: 'Main Entrance Scanner', zone: 'Main Hall', direction: 'In' },
  { name: 'VIP Lounge Scanner', zone: 'VIP Lounge', direction: 'In & Out' },
  { name: 'Loading Dock Scanner', zone: 'Kitchen', direction: 'In' },
]

const zoneRuleMatrix = {
  'Main Hall': ['VIP wristband', 'Staff badge', 'General ticket', 'Vendor pass'],
  'VIP Lounge': ['VIP wristband', 'Staff badge'],
  Kitchen: ['Staff badge', 'Vendor pass'],
  'Overflow Tent': ['General ticket', 'Staff badge'],
}

const peakTimes = [
  { label: '9a', value: 120 },
  { label: '10a', value: 240 },
  { label: '11a', value: 410 },
  { label: '12p', value: 650 },
  { label: '1p', value: 673 },
  { label: '2p', value: 590 },
  { label: '3p', value: 420 },
  { label: '4p', value: 180 },
]
const peakMax = Math.max(...peakTimes.map((p) => p.value))

const roomFlow = [
  { from: 'Main Hall', to: 'VIP Lounge', count: 34 },
  { from: 'VIP Lounge', to: 'Main Hall', count: 28 },
  { from: 'Main Hall', to: 'Overflow Tent', count: 61 },
  { from: 'Overflow Tent', to: 'Main Hall', count: 44 },
  { from: 'Main Hall', to: 'Kitchen', count: 9 },
]

const journeyOptions = ['Layla Guest0231', 'Karim Guest0308', 'Idris Guest0092']
const journeyByGuest = {
  'Layla Guest0231': [
    { zone: 'Main Hall', direction: 'in', time: '6:02 PM', allowed: true },
    { zone: 'VIP Lounge', direction: 'in', time: '6:45 PM', allowed: true },
    { zone: 'VIP Lounge', direction: 'out', time: '7:10 PM', allowed: true },
    { zone: 'Kitchen', direction: 'in', time: '7:12 PM', allowed: false, denyReason: 'Ticket type "VIP" is not allowed in Kitchen' },
    { zone: 'Main Hall', direction: 'in', time: '7:30 PM', allowed: true },
  ],
  'Karim Guest0308': [
    { zone: 'Main Hall', direction: 'in', time: '5:58 PM', allowed: true },
  ],
  'Idris Guest0092': [
    { zone: 'Main Hall', direction: 'in', time: '6:10 PM', allowed: true },
    { zone: 'VIP Lounge', direction: 'in', time: '6:12 PM', allowed: false, denyReason: 'Ticket type "Staff" is not on the VIP Lounge allow-list' },
  ],
}

const entryRules = [
  { tag: 'VIP wristband', zones: ['VIP Lounge', 'Main Hall'], desc: 'Grants entry to VIP Lounge and Main Hall only', detail: 'Guests wearing a VIP wristband (ticket type: VIP) may scan into VIP Lounge or Main Hall. Denied at Kitchen and Overflow Tent.' },
  { tag: 'Staff badge', zones: ['All zones'], desc: 'Full access, including Kitchen', detail: 'Staff-badge holders can scan in and out of every zone, including back-of-house areas like Kitchen.' },
  { tag: 'General ticket', zones: ['Main Hall', 'Overflow Tent'], desc: 'Standard entry — no VIP or back-of-house access', detail: 'General admission guests may enter Main Hall and the Overflow Tent. Denied at VIP Lounge and Kitchen.' },
  { tag: 'Vendor pass', zones: ['Kitchen', 'Main Hall'], desc: 'Load-in and setup access only', detail: 'Vendor passes allow entry to Kitchen (load-in) and Main Hall (setup), typically before doors open.' },
]

function barColor(pct) {
  if (pct >= 90) return 'var(--danger)'
  if (pct >= 70) return 'var(--warning)'
  return 'var(--success)'
}

function dirClass(direction) {
  if (direction === 'In-only') return 'in'
  if (direction === 'Out-only') return 'out'
  return 'both'
}

export default function CheckinRedesignPage() {
  const [eventId] = useCurrentEvent()
  const [event, setEvent] = useState(null)
  const [toast, setToast] = useState('')
  const [view, setView] = useState('zones')
  const [addZoneOpen, setAddZoneOpen] = useState(false)
  const [addTicketOpen, setAddTicketOpen] = useState(false)
  const [ticketAllZones, setTicketAllZones] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [zones, setZones] = useState([])
  const [ticketTypes, setTicketTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [zoneForm, setZoneForm] = useState({ name: '', capacity: '', description: '', direction_mode: 'both' })
  const [ticketForm, setTicketForm] = useState({ name: '', capacity: '', allowed_zone_ids: [] })

  // Assign / Analytics / Rules — real data, lazily loaded per view
  const [guests, setGuests] = useState([])
  const [tags, setTags] = useState([])
  const [gates, setGates] = useState([])
  const [rsvpQuestions, setRsvpQuestions] = useState([])
  const [zoneTagsByZone, setZoneTagsByZone] = useState({})
  const [guestTagsOpen, setGuestTagsOpen] = useState(null) // guest id whose tag editor is open
  const [guestTagIds, setGuestTagIds] = useState([])
  const [addTagOpen, setAddTagOpen] = useState(false)
  const [tagForm, setTagForm] = useState({ name: '', rsvp_question_id: '', rsvp_value: '' })
  const [addGateOpen, setAddGateOpen] = useState(false)
  const [gateForm, setGateForm] = useState({ name: '', zone_id: '', direction: 'in' })
  const [occupancy, setOccupancy] = useState(null)
  const [peak, setPeak] = useState([])
  const [flow, setFlow] = useState([])
  const [deniedScans, setDeniedScans] = useState(null)
  const [journeyGuestId, setJourneyGuestId] = useState('')
  const [journey, setJourney] = useState([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  async function loadAccess() {
    if (!eventId) { setZones([]); setTicketTypes([]); return }
    setLoading(true); setLoadError('')
    try {
      const [events, nextZones, nextTickets] = await Promise.all([api.listEvents(), api.listZones(eventId), api.listTicketTypes(eventId)])
      setEvent(events.find((item) => item.id === eventId) || null)
      setZones(nextZones); setTicketTypes(nextTickets)
    } catch (error) { setLoadError(error.message || 'Unable to load access settings') }
    finally { setLoading(false) }
  }

  async function loadTagsAndGates() {
    if (!eventId) { setTags([]); setGates([]); setRsvpQuestions([]); return }
    try {
      const [nextTags, nextGates, questions] = await Promise.all([api.listTags(eventId), api.listGates(eventId), api.listRSVPQuestions(eventId)])
      setTags(nextTags); setGates(nextGates); setRsvpQuestions(questions)
    } catch (error) { notify(error.message || 'Tags/gates could not be loaded') }
  }

  async function loadGuestsList() {
    if (!eventId) { setGuests([]); return }
    try { setGuests(await api.listGuests(eventId)) }
    catch (error) { notify(error.message || 'Guests could not be loaded') }
  }

  async function loadRulesTab() {
    if (!eventId || !zones.length) { setZoneTagsByZone({}); return }
    setRulesLoading(true)
    try {
      const pairs = await Promise.all(zones.map((z) => api.getZoneTags(eventId, z.id).then((ids) => [z.id, ids])))
      setZoneTagsByZone(Object.fromEntries(pairs))
    } catch (error) { notify(error.message || 'Zone rules could not be loaded') }
    finally { setRulesLoading(false) }
  }

  async function loadAnalyticsTab() {
    if (!eventId) return
    setAnalyticsLoading(true)
    try {
      const [occ, peakData, flowData, ops] = await Promise.all([
        api.accessOccupancy(eventId), api.accessPeak(eventId, 30), api.accessFlow(eventId),
        api.resultsOperations(eventId).catch(() => null),
      ])
      setOccupancy(occ); setPeak(peakData); setFlow(flowData)
      setDeniedScans(ops?.denied_scans || null)
    } catch (error) { notify(error.message || 'Analytics could not be loaded') }
    finally { setAnalyticsLoading(false) }
  }

  useEffect(() => { loadAccess(); loadTagsAndGates(); loadGuestsList() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'rules') loadRulesTab() }, [view, zones]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'analytics') loadAnalyticsTab() }, [view, eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!eventId || !journeyGuestId) { setJourney([]); return }
    api.guestJourney(eventId, journeyGuestId).then(setJourney).catch((e) => notify(e.message || 'Journey could not be loaded'))
  }, [eventId, journeyGuestId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!guests.length) { setJourneyGuestId(''); return }
    if (!guests.some((g) => g.id === journeyGuestId)) setJourneyGuestId(guests[0].id)
  }, [guests]) // eslint-disable-line react-hooks/exhaustive-deps

  async function createZone() {
    try {
      await api.createZone(eventId, {
        name: zoneForm.name.trim(),
        description: zoneForm.description.trim() || null,
        capacity: zoneForm.capacity === '' ? null : Number(zoneForm.capacity),
        direction_mode: zoneForm.direction_mode,
      })
      await loadAccess()
      setZoneForm({ name: '', capacity: '', description: '', direction_mode: 'both' })
      setAddZoneOpen(false); notify('Zone created')
    } catch (error) { notify(error.message || 'Zone could not be created') }
  }

  async function createTicket() {
    try {
      await api.createTicketType(eventId, {
        name: ticketForm.name.trim(),
        capacity: ticketForm.capacity === '' ? null : Number(ticketForm.capacity),
        allowed_zone_ids: ticketAllZones ? null : ticketForm.allowed_zone_ids,
      })
      await loadAccess()
      setTicketForm({ name: '', capacity: '', allowed_zone_ids: [] })
      setAddTicketOpen(false); notify('Ticket type created')
    } catch (error) { notify(error.message || 'Ticket type could not be created') }
  }

  function notify(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function createTag() {
    try {
      await api.createTag(eventId, {
        name: tagForm.name.trim(),
        rsvp_question_id: tagForm.rsvp_question_id || null,
        rsvp_value: tagForm.rsvp_question_id ? tagForm.rsvp_value.trim() || null : null,
      })
      await loadTagsAndGates()
      setTagForm({ name: '', rsvp_question_id: '', rsvp_value: '' })
      setAddTagOpen(false); notify('Tag created')
    } catch (error) { notify(error.message || 'Tag could not be created') }
  }

  async function syncTagsFromRsvp() {
    try {
      const result = await api.syncRsvpTags(eventId)
      await loadTagsAndGates()
      notify(`${result.linked} guest${result.linked === 1 ? '' : 's'} tagged from RSVP answers`)
    } catch (error) { notify(error.message || 'Tags could not be synced') }
  }

  async function createGate() {
    try {
      await api.createGate(eventId, { name: gateForm.name.trim(), zone_id: gateForm.zone_id, direction: gateForm.direction })
      await loadTagsAndGates()
      setGateForm({ name: '', zone_id: '', direction: 'in' })
      setAddGateOpen(false); notify('Gate created')
    } catch (error) { notify(error.message || 'Gate could not be created') }
  }

  async function toggleZoneTag(zoneId, tagId, allowed) {
    const current = zoneTagsByZone[zoneId] || []
    const next = allowed ? [...current, tagId] : current.filter((id) => id !== tagId)
    setZoneTagsByZone((prev) => ({ ...prev, [zoneId]: next }))
    try {
      await api.setZoneTags(eventId, zoneId, next)
      notify(`${allowed ? 'Allowed' : 'Blocked'} in ${zones.find((z) => z.id === zoneId)?.name || 'zone'}`)
    } catch (error) {
      setZoneTagsByZone((prev) => ({ ...prev, [zoneId]: current }))
      notify(error.message || 'Zone rule could not be saved')
    }
  }

  async function openGuestTags(guestId) {
    setGuestTagsOpen(guestId)
    try { setGuestTagIds(await api.getGuestTags(eventId, guestId)) }
    catch (error) { notify(error.message || 'Guest tags could not be loaded'); setGuestTagIds([]) }
  }

  async function toggleGuestTag(tagId) {
    const next = guestTagIds.includes(tagId) ? guestTagIds.filter((id) => id !== tagId) : [...guestTagIds, tagId]
    setGuestTagIds(next)
    try { await api.setGuestTags(eventId, guestTagsOpen, next) }
    catch (error) { notify(error.message || 'Guest tags could not be saved') }
  }

  async function assignGuestTicket(guestId, ticketTypeId) {
    try {
      await api.assignTicketType(eventId, guestId, ticketTypeId || null)
      await loadGuestsList()
      notify('Ticket type assigned')
    } catch (error) { notify(error.message || 'Ticket type could not be assigned') }
  }

  const totalInside = zones.reduce((sum, z) => sum + Number(z.occupancy || 0), 0)
  const totalCapacity = zones.reduce((sum, z) => sum + Number(z.capacity || 0), 0)

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive="access">
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row">
            <h1>Check-in &amp; Access</h1>
            {event?.venue_access_enabled ? <span className="rr-pill live"><i/> Active</span> : <span className="rr-pill locked">Locked</span>}
          </div>
          <div className="rr-meta">
            <Icon name="grid" size={13}/> {zones.length} zones <span className="rr-dot">·</span>
            <Icon name="ticket" size={13}/> {totalCapacity.toLocaleString()} total capacity
          </div>
        </div>
        <div className="rr-head-actions">
          <button className="rr-btn secondary" onClick={() => { window.location.href = '/scanner-redesign' }}><Icon name="eye" size={15}/> Open live scanner</button>
          <button className="rr-btn primary" onClick={() => setAddZoneOpen((v) => !v)}><Icon name="plus" size={14}/> Add zone</button>
        </div>
      </div>

      {event && !event.venue_access_enabled ? (
        <div className="rr-panel ci-empty">
          <div className="ci-empty-icon"><Icon name="ticket" size={26}/></div>
          <h2>Venue Access isn't enabled for this event</h2>
          <p>Turn on the Venue Access add-on to configure zones, ticket-type entry rules, and live occupancy analytics for multi-zone check-in.</p>
          <button className="rr-btn primary" onClick={() => { window.location.href = '/billing-redesign' }}>View Event Passes <Icon name="arrow" size={14}/></button>
        </div>
      ) : (
        <>
          {!eventId && <div className="rr-panel ci-empty"><p>Select an event to configure check-in and access.</p></div>}
          {loading && <div className="rr-panel ci-empty"><p>Loading access settings…</p></div>}
          {loadError && <div className="rr-panel ci-empty"><p>{loadError}</p><button className="rr-btn secondary" onClick={loadAccess}>Retry</button></div>}
          <div className="rr-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)}>{t.label}</button>
            ))}
          </div>

          {view === 'zones' && (
            <>
              {addZoneOpen && (
                <div className="rr-panel ci-form-panel">
                  <div className="rd-panel-head"><h3>Add zone</h3></div>
                  <div className="rd-panel-body">
                    <div className="rd-row2">
                      <div style={{ flex: 1 }}><label className="rd-field-label">Name</label><input className="rd-field" placeholder="e.g. Terrace" value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}/></div>
                      <div style={{ flex: 1 }}><label className="rd-field-label">Capacity</label><input className="rd-field" type="number" min="0" placeholder="100" value={zoneForm.capacity} onChange={(e) => setZoneForm({ ...zoneForm, capacity: e.target.value })}/></div>
                    </div>
                    <label className="rd-field-label">Description</label>
                    <input className="rd-field" placeholder="Shown to staff when they select this zone" value={zoneForm.description} onChange={(e) => setZoneForm({ ...zoneForm, description: e.target.value })}/>
                    <label className="rd-field-label">Scan direction</label>
                    <select className="rr-select" style={{ maxWidth: 220 }} value={zoneForm.direction_mode} onChange={(e) => setZoneForm({ ...zoneForm, direction_mode: e.target.value })}>
                      <option value="both">In &amp; Out</option><option value="entry">In-only</option><option value="exit">Out-only</option>
                    </select>
                    <div className="rd-row2" style={{ marginTop: 10 }}>
                      <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddZoneOpen(false)}>Cancel</button>
                      <button className="rr-btn primary" disabled={!eventId || !zoneForm.name.trim()} style={{ flex: 1, justifyContent: 'center' }} onClick={createZone}>Create zone</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="rr-grid3">
                {zones.map((z) => {
                  const current = Number(z.occupancy || 0)
                  const direction = z.direction_mode === 'entry' ? 'In-only' : z.direction_mode === 'exit' ? 'Out-only' : 'In & Out'
                  const pct = z.capacity ? Math.round((current / z.capacity) * 100) : 0
                  return (
                    <div className="rr-panel ci-zone-card" key={z.name}>
                      <div className="ci-zone-top">
                        <h3>{z.name}</h3>
                        <span className={`ci-dir-pill ci-dir-${dirClass(direction)}`}>{direction}</span>
                      </div>
                      <p className="ci-zone-desc">{z.description}</p>
                      <div className="ci-zone-occ">
                        <div className="ci-zone-occ-label">
                          <span>{current} / {z.capacity ?? 'Unlimited'}</span>
                          <span className="ci-zone-pct">{pct}%</span>
                        </div>
                        <div className="rd-mini-bar ci-zone-bar"><i style={{ width: `${pct}%`, background: barColor(pct) }}/></div>
                      </div>
                      <div className="ci-zone-foot">
                        <span>Capacity {z.capacity}</span>
                        <div className="gr-actions">
                          <button className="rr-link-btn" disabled title="Zone editing remains on the legacy access page during rollout">Edit</button>
                          <button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget({ id: z.id, name: z.name, type: 'zone' })}>Delete</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {view === 'tickets' && (
            <div className="rd-panel">
              <div className="rd-panel-head">
                <h3>Ticket types</h3>
                <p>What each ticket type is worth, and where it can scan in</p>
              </div>
              <div className="rd-panel-body">
                {addTicketOpen && (
                  <div className="ci-form-panel ci-form-inset">
                    <div className="rd-row2">
                      <div style={{ flex: 1 }}><label className="rd-field-label">Name</label><input className="rd-field" placeholder="e.g. Sponsor" value={ticketForm.name} onChange={(e) => setTicketForm({ ...ticketForm, name: e.target.value })}/></div>
                      <div style={{ flex: 1 }}><label className="rd-field-label">Capacity</label><input className="rd-field" type="number" min="0" placeholder="50" value={ticketForm.capacity} onChange={(e) => setTicketForm({ ...ticketForm, capacity: e.target.value })}/></div>
                    </div>
                    <label className="gr-required-check" style={{ marginBottom: 10 }}>
                      <input type="checkbox" checked={ticketAllZones} onChange={(e) => setTicketAllZones(e.target.checked)} /> Can enter all zones
                    </label>
                    {!ticketAllZones && (
                      <div className="ci-zone-checklist">
                        {zones.map((z) => (
                          <label key={z.id}><input type="checkbox" checked={ticketForm.allowed_zone_ids.includes(z.id)} onChange={(e) => setTicketForm({ ...ticketForm, allowed_zone_ids: e.target.checked ? [...ticketForm.allowed_zone_ids, z.id] : ticketForm.allowed_zone_ids.filter((id) => id !== z.id) })}/> {z.name}</label>
                        ))}
                      </div>
                    )}
                    <div className="rd-row2" style={{ marginTop: 10 }}>
                      <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddTicketOpen(false)}>Cancel</button>
                      <button className="rr-btn primary" disabled={!eventId || !ticketForm.name.trim()} style={{ flex: 1, justifyContent: 'center' }} onClick={createTicket}>Create ticket type</button>
                    </div>
                  </div>
                )}
                <table className="rr-table ci-tickets-table">
                  <thead>
                    <tr><th>Ticket type</th><th>Capacity</th><th>Assigned</th><th>Zones</th><th/></tr>
                  </thead>
                  <tbody>
                    {ticketTypes.map((t) => {
                      const pct = t.capacity ? Math.round((t.assigned_count / t.capacity) * 100) : 0
                      const allowedNames = (t.allowed_zone_ids || []).map((id) => zones.find((zone) => zone.id === id)?.name).filter(Boolean)
                      return (
                        <tr key={t.name}>
                          <td><div className="ci-ticket-name"><span className="ci-swatch" style={{ background: t.color }}/> {t.name}</div></td>
                          <td>{t.capacity}</td>
                          <td>{t.assigned_count} <span className="ci-assigned-pct">({pct}%)</span></td>
                          <td><div className="ci-zone-chips">{!t.allowed_zone_ids?.length ? <span className="rd-chip">All zones</span> : allowedNames.map((z) => <span className="rd-chip" key={z}>{z}</span>)}</div></td>
                          <td className="rd-rowlink gr-actions">
                            <button className="rr-link-btn" disabled title="Ticket editing remains on the legacy access page during rollout">Edit</button>
                            <button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget({ id: t.id, name: t.name, type: 'ticket type' })}>Delete</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="rd-attn-footer">
                  <span>{ticketTypes.length} ticket types · {ticketTypes.reduce((s, t) => s + Number(t.assigned_count || 0), 0)} assigned</span>
                  <button className="rr-btn secondary" style={{ height: 30, fontSize: 10.5, padding: '0 10px' }} onClick={() => setAddTicketOpen((v) => !v)}><Icon name="plus" size={12}/> Add ticket type</button>
                </div>
              </div>
            </div>
          )}

          {view === 'assign' && (
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Assign ticket types &amp; tags</h3><p>Per-guest access assignment</p></div>
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Guest</th><th>Ticket type</th><th>Tags</th></tr></thead>
                  <tbody>
                    {guests.map((g) => {
                      const name = [g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone || 'Unnamed guest'
                      return (
                        <tr key={g.id}>
                          <td>{name}</td>
                          <td>
                            <select className="rr-select gr-inline-select" value={g.ticket_type_id || ''} onChange={(e) => assignGuestTicket(g.id, e.target.value)}>
                              <option value="">No ticket type</option>
                              {ticketTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </td>
                          <td>
                            {guestTagsOpen === g.id ? (
                              <div className="ci-zone-chips">
                                {tags.map((t) => (
                                  <button key={t.id} className={`ci-tag-toggle ${guestTagIds.includes(t.id) ? 'on' : ''}`} onClick={() => toggleGuestTag(t.id)}>{t.name}</button>
                                ))}
                                <button className="rr-link-btn" onClick={() => setGuestTagsOpen(null)}>Done</button>
                              </div>
                            ) : (
                              <button className="rr-link-btn" onClick={() => openGuestTags(g.id)}>Manage tags</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {!guests.length && <tr><td colSpan={3} className="rd-rowlink">No guests on this event yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'analytics' && (analyticsLoading ? <div className="rr-panel ci-empty"><p>Loading analytics…</p></div> : (() => {
            const totalScans = peak.reduce((sum, p) => sum + p.ins + p.outs, 0)
            const peakMaxVal = Math.max(1, ...peak.map((p) => p.ins))
            const journeyGuestName = (() => {
              const g = guests.find((item) => item.id === journeyGuestId)
              return g ? [g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone : ''
            })()
            return (
            <>
              <div className="rr-grid3">
                <div className="rr-panel ci-bignum">
                  <span className="ci-bignum-label"><Icon name="users" size={13}/> Total inside</span>
                  <div className="ci-bignum-value">{occupancy?.total_inside ?? totalInside}</div>
                  <div className="ci-bignum-sub">across {zones.length} zones · {totalCapacity ? Math.round(((occupancy?.total_inside ?? totalInside) / totalCapacity) * 100) : 0}% of capacity</div>
                </div>
                <div className="rr-panel ci-bignum">
                  <span className="ci-bignum-label"><Icon name="check" size={13}/> Allowed scans</span>
                  <div className="ci-bignum-value">{totalScans.toLocaleString()}</div>
                  <div className="ci-bignum-sub">recorded scans, all zones</div>
                </div>
                <div className="rr-panel ci-bignum">
                  <span className="ci-bignum-label"><Icon name="info" size={13}/> Denied scans</span>
                  <div className="ci-bignum-value ci-bignum-danger">{deniedScans?.total ?? 0}</div>
                  <div className="ci-bignum-sub">{deniedScans?.by_reason?.[0]?.reason || 'No denials recorded'}</div>
                </div>
              </div>

              <div className="rr-panel ci-peak-panel">
                <div className="rd-panel-head"><h3>Peak times</h3><p>Arrivals per 30-minute period</p></div>
                <div className="rd-panel-body">
                  {peak.length ? (
                    <div className="ci-peakchart">
                      {peak.map((p) => (
                        <div className="ci-peakbar-col" key={p.t}>
                          <div className="ci-peakbar-track">
                            <div className="ci-peakbar" style={{ height: `${Math.round((p.ins / peakMaxVal) * 100)}%` }} title={`${p.ins} arrivals, ${p.outs} departures`}/>
                          </div>
                          <span className="ci-peaklabel">{new Date(p.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="rd-rowlink">No scans recorded yet.</p>}
                </div>
              </div>

              <div className="rd-wide-grid">
                <div className="rr-panel">
                  <div className="rd-panel-head"><h3>Room flow</h3><p>Most common zone-to-zone movements</p></div>
                  <div className="rd-panel-body ci-flowlist">
                    {flow.map((f, i) => (
                      <div className="ci-flowrow" key={i}>
                        <span className="ci-flow-path">{f.from_zone || 'Entrance'} <Icon name="arrow" size={12}/> {f.to_zone}</span>
                        <span className="ci-flow-count">{f.count} guests</span>
                      </div>
                    ))}
                    {!flow.length && <p className="rd-rowlink">No zone movement recorded yet.</p>}
                  </div>
                </div>

                <div className="rr-panel">
                  <div className="rd-panel-head ci-journey-head">
                    <div><h3>Guest journey</h3><p>Scan history for the selected guest</p></div>
                    <select className="rr-select gr-inline-select" value={journeyGuestId} onChange={(e) => setJourneyGuestId(e.target.value)}>
                      {guests.map((g) => <option key={g.id} value={g.id}>{[g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone || 'Unnamed guest'}</option>)}
                    </select>
                  </div>
                  <div className="rd-panel-body">
                    <div className="ci-journey">
                      {journey.map((j, i) => (
                        <div className="ci-journey-item" key={i}>
                          <span className={`ci-journey-dot ${j.denied ? 'fail' : 'ok'}`}/>
                          <div className="ci-journey-body">
                            <div className="ci-journey-top">
                              <strong>{j.zone_name || 'Unknown zone'}</strong>
                              <span className={`rd-status-chip ${j.denied ? 'fail' : 'ok'}`}>
                                <Icon name={j.denied ? 'info' : 'check'} size={10}/> {j.denied ? 'Denied' : 'Allowed'}
                              </span>
                            </div>
                            <div className="ci-journey-meta">
                              <span>{j.direction === 'in' ? 'Entered' : 'Exited'}</span>
                              <span className="rr-dot">·</span>
                              <span>{new Date(j.scanned_at).toLocaleString()}</span>
                            </div>
                            {j.deny_reason && <div className="ci-deny-reason">{j.deny_reason}</div>}
                          </div>
                        </div>
                      ))}
                      {!journey.length && <p className="rd-rowlink">{journeyGuestName ? `No scans recorded for ${journeyGuestName} yet.` : 'Select a guest.'}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </>
            )
          })())}

          {view === 'rules' && (rulesLoading ? <div className="rr-panel ci-empty"><p>Loading rules…</p></div> : (
            <>
              <div className="rr-section-title">
                <div><h2>Entry rules</h2><p>Which zones each tag can enter — derived from the Zone rules matrix below</p></div>
              </div>
              <div className="ci-rules-list">
                {tags.map((t) => {
                  const allowedZones = zones.filter((z) => (zoneTagsByZone[z.id] || []).includes(t.id))
                  return (
                    <details className="rd-path" key={t.id}>
                      <summary>
                        <span className="rd-path-icon"><Icon name="ticket" size={14}/></span>
                        <span style={{ flex: 1 }}>
                          <span className="rd-path-title">{t.name} → {allowedZones.length ? allowedZones.map((z) => z.name).join(' + ') : 'All zones (no restriction set)'}</span>
                          <div className="rd-path-sub">{t.guest_count} guest{t.guest_count === 1 ? '' : 's'} carry this tag</div>
                        </span>
                        <span className="rd-path-badge">Active</span>
                      </summary>
                      <div className="rd-path-body">
                        <div className="rd-path-body-inner">
                          <p className="ci-rule-detail">Guests tagged "{t.name}" may scan into: {allowedZones.length ? allowedZones.map((z) => z.name).join(', ') : 'every zone (this tag has no zone restrictions)'}.</p>
                        </div>
                      </div>
                    </details>
                  )
                })}
                {!tags.length && <p className="rd-rowlink">No tags configured yet.</p>}
              </div>

              <div className="rr-section-title">
                <div><h2>Tags</h2><p>Create tags manually or auto-map them from an RSVP answer</p></div>
                <button onClick={() => setAddTagOpen((v) => !v)}><Icon name="plus" size={13}/> Add tag</button>
              </div>
              {addTagOpen && (
                <div className="rr-panel ci-form-panel">
                  <div className="rd-panel-body">
                    <label className="rd-field-label">Name</label>
                    <input className="rd-field" placeholder="e.g. Press" value={tagForm.name} onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })}/>
                    <label className="rd-field-label">Auto-tag from RSVP answer (optional)</label>
                    <select className="rr-select" value={tagForm.rsvp_question_id} onChange={(e) => setTagForm({ ...tagForm, rsvp_question_id: e.target.value })}>
                      <option value="">— manual only —</option>
                      {rsvpQuestions.map((q) => <option key={q.id} value={q.id}>{q.question}</option>)}
                    </select>
                    {tagForm.rsvp_question_id && (
                      <>
                        <label className="rd-field-label">Matches answer</label>
                        <input className="rd-field" placeholder="e.g. Yes" value={tagForm.rsvp_value} onChange={(e) => setTagForm({ ...tagForm, rsvp_value: e.target.value })}/>
                      </>
                    )}
                    <div className="rd-row2" style={{ marginTop: 10 }}>
                      <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddTagOpen(false)}>Cancel</button>
                      <button className="rr-btn primary" disabled={!tagForm.name.trim()} style={{ flex: 1, justifyContent: 'center' }} onClick={createTag}>Create tag</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="rd-panel">
                <div className="rd-panel-body">
                  <table className="rr-table">
                    <thead><tr><th>Tag</th><th>Guests</th><th>Auto-tag from RSVP</th><th/></tr></thead>
                    <tbody>
                      {tags.map((t) => (
                        <tr key={t.id}>
                          <td><div className="ci-ticket-name"><span className="ci-swatch" style={{ background: t.color || 'var(--faint)' }}/> {t.name}</div></td>
                          <td>{t.guest_count}</td>
                          <td className="rd-rowlink">{t.rsvp_question_id ? `${rsvpQuestions.find((q) => q.id === t.rsvp_question_id)?.question || 'RSVP question'} = "${t.rsvp_value}"` : '— manual only —'}</td>
                          <td className="gr-actions">
                            {t.rsvp_question_id && <button className="rr-link-btn" onClick={syncTagsFromRsvp}>Sync from RSVP</button>}
                            <button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget({ id: t.id, name: t.name, type: 'tag' })}>Delete</button>
                          </td>
                        </tr>
                      ))}
                      {!tags.length && <tr><td colSpan={4} className="rd-rowlink">No tags yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rr-section-title">
                <div><h2>Zone rules</h2><p>Which tags may enter each zone — a zone with no tags selected admits everyone</p></div>
              </div>
              <div className="rd-panel">
                <div className="rd-panel-body" style={{ overflowX: 'auto' }}>
                  <table className="rr-table ci-matrix">
                    <thead>
                      <tr><th>Zone</th>{tags.map((t) => <th key={t.id}>{t.name}</th>)}</tr>
                    </thead>
                    <tbody>
                      {zones.map((z) => (
                        <tr key={z.id}>
                          <td>{z.name}</td>
                          {tags.map((t) => (
                            <td key={t.id} style={{ textAlign: 'center' }}>
                              <input type="checkbox" checked={(zoneTagsByZone[z.id] || []).includes(t.id)}
                                onChange={(e) => toggleZoneTag(z.id, t.id, e.target.checked)} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rr-section-title">
                <div><h2>Gates</h2><p>Pin a scanner device to a zone for automatic zone-scanning</p></div>
                <button onClick={() => setAddGateOpen((v) => !v)}><Icon name="plus" size={13}/> Add gate</button>
              </div>
              {addGateOpen && (
                <div className="rr-panel ci-form-panel">
                  <div className="rd-panel-body">
                    <div className="rd-row2">
                      <div style={{ flex: 1 }}><label className="rd-field-label">Name</label><input className="rd-field" placeholder="e.g. Main Entrance Scanner" value={gateForm.name} onChange={(e) => setGateForm({ ...gateForm, name: e.target.value })}/></div>
                      <div style={{ flex: 1 }}><label className="rd-field-label">Zone</label>
                        <select className="rr-select" value={gateForm.zone_id} onChange={(e) => setGateForm({ ...gateForm, zone_id: e.target.value })}>
                          <option value="">Select zone</option>
                          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <label className="rd-field-label">Direction</label>
                    <select className="rr-select" style={{ maxWidth: 160 }} value={gateForm.direction} onChange={(e) => setGateForm({ ...gateForm, direction: e.target.value })}>
                      <option value="in">In</option><option value="out">Out</option>
                    </select>
                    <div className="rd-row2" style={{ marginTop: 10 }}>
                      <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddGateOpen(false)}>Cancel</button>
                      <button className="rr-btn primary" disabled={!gateForm.name.trim() || !gateForm.zone_id} style={{ flex: 1, justifyContent: 'center' }} onClick={createGate}>Create gate</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="rd-panel">
                <div className="rd-panel-body">
                  <table className="rr-table">
                    <thead><tr><th>Gate</th><th>Zone</th><th>Direction</th><th/></tr></thead>
                    <tbody>
                      {gates.map((g) => (
                        <tr key={g.id}>
                          <td>{g.name}</td>
                          <td className="rd-rowlink">{g.zone_name}</td>
                          <td className="rd-rowlink">{g.direction === 'in' ? 'In' : 'Out'}</td>
                          <td className="gr-actions">
                            <button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget({ id: g.id, name: g.name, type: 'gate' })}>Delete</button>
                          </td>
                        </tr>
                      ))}
                      {!gates.length && <tr><td colSpan={4} className="rd-rowlink">No gates yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ))}
        </>
      )}

      {toast && <div className="rd-toast"><Icon name="check"/>{toast}</div>}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.type}`}
          message={`Remove "${deleteTarget.name}" permanently? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const target = deleteTarget
            try {
              if (target.type === 'zone') await api.deleteZone(eventId, target.id)
              else if (target.type === 'ticket type') await api.deleteTicketType(eventId, target.id)
              else if (target.type === 'tag') await api.deleteTag(eventId, target.id)
              else if (target.type === 'gate') await api.deleteGate(eventId, target.id)
              else throw new Error(`${target.type} deletion is still available on the legacy access page`)
              setDeleteTarget(null)
              await loadAccess()
              await loadTagsAndGates()
              notify(`${target.name} deleted`)
            } catch (error) {
              setDeleteTarget(null)
              notify(error.message || `${target.name} could not be deleted`)
            }
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </RedesignShell>
  )
}
