import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'

export default function TableManager({ eventId, table: initial, suggestedName, onChanged, onClose }) {
  const dialog = useRef(null), active = useRef(true), acting = useRef(false)
  const [table, setTable] = useState(initial), [name, setName] = useState(initial?.name || suggestedName), [capacity, setCapacity] = useState(String(initial?.capacity || 10))
  const [ready, setReady] = useState(!initial), [loading, setLoading] = useState(!!initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [seats, setSeats] = useState(null), [guests, setGuests] = useState([]), [guestId, setGuestId] = useState(''), [seat, setSeat] = useState('')
  useEffect(() => { active.current = true; dialog.current.showModal(); return () => { active.current = false; dialog.current?.close() } }, [])
  useEffect(() => {
    if (!initial) return
    let live = true
    api.listTables(eventId).then(rows => {
      if (!live) return
      const found = rows.find(t => t.id === initial.id)
      if (!found) throw Error('This table no longer exists. Close this panel and reload the plan.')
      setReady(true); setTable(found); setName(found.name); setCapacity(String(found.capacity)); setLoading(false)
    }).catch(e => { if (live) { setError(e.message); setLoading(false) } })
    return () => { live = false }
  }, [eventId, initial?.id])
  const draftDirty = name !== (table?.name || suggestedName) || Number(capacity) !== (table?.capacity || 10)
  useEffect(() => { const warn = e => { if (draftDirty || busy) { e.preventDefault(); e.returnValue = '' } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [draftDirty, busy])
  function close() { if (!acting.current && (!draftDirty || window.confirm('Discard unsaved table details?'))) onClose() }
  async function run(action) {
    if (acting.current || loading || !ready) return
    acting.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { if (active.current) setError(e.message || 'The change could not be saved.') }
    finally { acting.current = false; if (active.current) setBusy(false) }
  }
  async function saveDetails(e) {
    e.preventDefault()
    await run(async () => {
      const body = { name: name.trim(), capacity: Number(capacity), category: table?.category ?? null, service_section: table?.service_section ?? null, sort_order: table?.sort_order ?? 0 }
      if (!initial) { const current = await api.listTables(eventId); body.sort_order = Math.max(0, ...current.map(t => t.sort_order || 0)) + 1 }
      const next = initial ? await api.updateTable(eventId, table.id, body, table.updated_at, true) : await api.createTable(eventId, body)
      if (active.current) { onChanged(next, initial ? 'updated' : 'added'); onClose() }
    })
  }
  const assigned = seats ? seats.filter(s => s.guest_id) : null
  const assignedCount = assigned ? assigned.length : (table?.assigned_count ?? table?.seated ?? 0)
  const availableSeats = (seats || []).filter(s => !s.guest_id && s.seat && (!s.reserved || s.reserved_for_guest_id === guestId))
  async function refreshGuests() {
    const [chart, rows] = await Promise.all([api.getSeatingChart(eventId), api.listGuests(eventId)])
    if (!active.current) return
    const current = chart.find(t => t.id === table.id)
    if (!current) throw Error('This table no longer exists.')
    setSeats(current.seats); setGuests(rows); setGuestId(''); setSeat('')
    onChanged({ id: table.id, seated: current.seats.filter(s => s.guest_id && s.seat != null).length }, 'occupancy')
  }
  async function assignGuest(e) {
    e.preventDefault()
    await run(async () => { await api.assignSeat(eventId, guestId, { table_id: table.id, seat_number: seat }, true); await refreshGuests() })
  }
  return <dialog ref={dialog} className="venue-table-dialog" aria-labelledby="venue-table-title" onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); close() }}>
    <header><div><span className="venue-kicker">EVENT SEATING</span><h2 id="venue-table-title">{initial ? 'Manage table' : 'Add a table'}</h2></div><button type="button" aria-label="Close table manager" disabled={busy} onClick={close}>×</button></header>
    <p className="venue-help">Table details and guest assignments save immediately. Positions, shapes and colours use Save layout. Layout undo does not reverse table or guest changes.</p>
    {error && <p className="venue-table-error" role="alert">{error}</p>}
    {loading && <p role="status">Loading current table details…</p>}
    <form onSubmit={saveDetails}><fieldset disabled={busy || loading || !ready}>
      <label className="venue-field"><span>Table name</span><input required maxLength={100} value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
      <label className="venue-field"><span>Seats at this table</span><input required type="number" min="1" max="1000" step="1" value={capacity} onChange={e => setCapacity(e.target.value)} /></label>
      {initial && <p className="venue-help">{assignedCount} guests assigned. Capacity changes must preserve assigned and reserved seat numbers.</p>}
      <button className="venue-primary" disabled={!name.trim()}>{busy ? 'Saving…' : initial ? 'Save table details' : 'Add table'}</button>
    </fieldset></form>
    {initial && <section className="venue-control-section"><h3>Guests at this table</h3>
      {seats === null ? <button type="button" disabled={busy || loading || !ready} onClick={() => run(refreshGuests)}>View and assign guests</button> : <>
        <button type="button" disabled={busy} onClick={() => run(refreshGuests)}>Refresh guest list</button>
        <ul className="venue-table-guests">{assigned.map(s => <li key={s.guest_id}><span><b>{s.name}</b><small>{s.seat ? `Seat ${s.seat}` : 'No seat number'}</small></span><button type="button" disabled={busy} aria-label={`Unassign ${s.name}`} onClick={() => { if (window.confirm(`Remove ${s.name} from this table? Their event registration will remain.`)) run(async () => { await api.assignSeat(eventId, s.guest_id, { table_id: null, seat_number: null }, true); await refreshGuests() }) }}>Unassign</button></li>)}</ul>
        {!assigned.length && <p className="venue-help">No guests are assigned to this table.</p>}
        <form onSubmit={assignGuest}><fieldset disabled={busy}><label className="venue-field"><span>Guest to assign</span><select aria-label="Guest to assign" required value={guestId} onChange={e => { setGuestId(e.target.value); setSeat('') }}><option value="">Choose an unseated guest</option>{guests.filter(g => !g.table_id || (g.table_id === table.id && !g.seat_number)).map(g => <option key={g.id} value={g.id}>{g.first_name} {g.last_name}</option>)}</select></label>
          <label className="venue-field"><span>Available seat</span><select aria-label="Available seat" required value={seat} onChange={e => setSeat(e.target.value)}><option value="">Choose a seat</option>{availableSeats.map(s => <option key={s.seat} value={s.seat}>Seat {s.seat}{s.reserved ? ' (reserved for this guest)' : ''}</option>)}</select></label><button disabled={!guestId || !seat}>Assign guest</button></fieldset></form>
      </>}
    </section>}
    {initial && <section className="venue-control-section"><h3>Remove table</h3><p className="venue-help">Assigned guests must be moved first. Tables linked to seating groups or household defaults must be unlinked first.</p><button type="button" className="venue-danger" disabled={busy || loading || !ready || assignedCount > 0} onClick={() => { if (window.confirm(`Permanently remove ${table.name}? This cannot be undone with layout undo.`)) run(async () => { await api.deleteTable(eventId, table.id, true); if (active.current) { onChanged(table, 'removed'); onClose() } }) }}>Remove empty table</button></section>}
    <footer><a href="/addons-redesign?tab=seating">Open Event seating ↗</a><button type="button" disabled={busy} onClick={close}>Done</button></footer>
  </dialog>
}
