import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { EmptyState, ErrorRetryState, LoadingSkeleton } from './RedesignPrimitives'
import { Icon, ConfirmDialog, Modal } from './RedesignShell'

const clean = (value, fallback = '') => value == null ? fallback : String(value)
const rows = (value) => Array.isArray(value) ? value.filter(Boolean) : []

function ReserveSeatModal({ slot, guests, busy, query, onQuery, onPick, onAddVvip, onClose }) {
  const [mode, setMode] = useState('search') // 'search' | 'vvip'
  const [vvip, setVvip] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const q = (query || '').trim().toLowerCase()
  const matches = guests.filter((g) => {
    if (!q) return true
    return (`${g.first_name} ${g.last_name} ${g.email}`).toLowerCase().includes(q)
  })

  function submitVvip(e) {
    e.preventDefault()
    if (!vvip.first_name.trim() || !vvip.last_name.trim()) return
    onAddVvip({
      first_name: vvip.first_name.trim(),
      last_name: vvip.last_name.trim(),
      email: vvip.email.trim(),
      phone: vvip.phone.trim() || null,
      is_vip: true,
    })
  }

  return (
    <Modal title={`Reserve ${slot.tableName} · Seat ${slot.seat}`} onClose={onClose} width={440}>
      <div className="rr-tabs" style={{ marginBottom: 10 }}>
        <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>From guest list</button>
        <button className={mode === 'vvip' ? 'active' : ''} onClick={() => setMode('vvip')}>+ Add VVIP</button>
      </div>

      {mode === 'search' && (
        <>
          <input className="rr-input" autoFocus value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search by name or email…" style={{ marginBottom: 10 }} />
          <div className="ad-chart-picker">
            {matches.length === 0 && (
              <p className="rd-rowlink">No guests match. Use <button className="rr-link-btn" onClick={() => setMode('vvip')}>+ Add VVIP</button> instead.</p>
            )}
            {matches.map((g) => (
              <button key={g.id} className="ad-chart-picker-row" disabled={busy} onClick={() => onPick(g.id)}>
                <span className="ad-chart-picker-name">{g.first_name} {g.last_name}<small>{g.email || 'no email'}</small></span>
                {g.table_id != null
                  ? <span className="ad-chart-tag warn">move from seat {g.seat_number ?? '–'}</span>
                  : g.admitted ? <span className="ad-chart-tag ok">arrived</span> : null}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'vvip' && (
        <form onSubmit={submitVvip}>
          <p className="rd-hint" style={{ marginBottom: 8 }}>Add someone who isn't on the imported guest list. Email is optional — no invite will be sent.</p>
          <div className="rd-row2">
            <input className="rr-input" autoFocus required value={vvip.first_name} onChange={(e) => setVvip((v) => ({ ...v, first_name: e.target.value }))} placeholder="First name *" />
            <input className="rr-input" required value={vvip.last_name} onChange={(e) => setVvip((v) => ({ ...v, last_name: e.target.value }))} placeholder="Last name *" />
          </div>
          <input className="rr-input" type="email" value={vvip.email} onChange={(e) => setVvip((v) => ({ ...v, email: e.target.value }))} placeholder="Email (optional)" style={{ marginTop: 8 }} />
          <input className="rr-input" value={vvip.phone} onChange={(e) => setVvip((v) => ({ ...v, phone: e.target.value }))} placeholder="Phone E.164 (optional, e.g. +447911123456)" style={{ marginTop: 8 }} />
          <button type="submit" className="rr-btn primary" disabled={busy || !vvip.first_name.trim() || !vvip.last_name.trim()} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
            {busy ? 'Saving…' : `Reserve ${slot.tableName} · Seat ${slot.seat}`}
          </button>
        </form>
      )}
    </Modal>
  )
}

export function RealSeatingContent({ eventId, event, notify, onFloorLayout }) {
  const [tables, setTables] = useState([])
  const [groups, setGroups] = useState([])
  const [form, setForm] = useState(null)
  const [groupForm, setGroupForm] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  // Per-seat assignment chart — ported from AdminPage.jsx's SeatingPanel.
  const [chart, setChart] = useState(null)
  const [showChart, setShowChart] = useState(false)
  const [chartBusy, setChartBusy] = useState(false)
  const [assignSlot, setAssignSlot] = useState(null) // {tableId, tableName, seat}
  const [allGuests, setAllGuests] = useState([])
  const [guestQuery, setGuestQuery] = useState('')
  const [pendingUnassign, setPendingUnassign] = useState(null) // {guestId, name}

  const load = useCallback(async () => {
    if (!eventId) return
    setLoading(true); setError('')
    try {
      const [tableData, groupData] = await Promise.all([
        api.listTables(eventId), api.listTableGroups(eventId),
      ])
      setTables(rows(tableData))
      setGroups(rows(groupData))
    } catch (e) { setError(e.message || 'Could not load seating') }
    finally { setLoading(false) }
  }, [eventId])

  useEffect(() => { load() }, [load])

  async function saveTable(e) {
    e.preventDefault()
    setWorking(true); setError('')
    try {
      const payload = {
        name: clean(form.name).trim(),
        capacity: Math.max(1, Number(form.capacity) || 1),
        category: clean(form.category).trim() || null,
        sort_order: Number(form.sort_order) || 0,
      }
      if (form.id) await api.updateTable(eventId, form.id, payload, form.updated_at)
      else await api.createTable(eventId, payload)
      await load()
      setForm(null)
      notify(`${event?.seating_term || 'Table'} saved`)
    } catch (e2) {
      if (e2.status === 409) {
        setForm(null)
        await load()
        notify('Changed by another operator — refreshed with the latest version. Please redo your edit.', true)
      } else {
        setError(e2.message || 'Could not save table')
      }
    }
    finally { setWorking(false) }
  }

  async function removeTable() {
    const target = pendingDelete
    setPendingDelete(null); setWorking(true); setError('')
    try {
      await api.deleteTable(eventId, target.id)
      await load()
      notify(`${clean(target.name, 'Table')} deleted`)
    } catch (e) { setError(e.message || 'Could not delete table') }
    finally { setWorking(false) }
  }

  async function loadChart() {
    setChartBusy(true)
    try {
      const [chartData, guestData] = await Promise.all([api.getSeatingChart(eventId), api.listGuests(eventId)])
      setChart(chartData)
      setAllGuests(guestData)
      setShowChart(true)
    } catch (e) { setError(e.message || 'Could not load the seating chart') }
    finally { setChartBusy(false) }
  }

  async function refreshChart() {
    const [chartData, guestData, tableData] = await Promise.all([api.getSeatingChart(eventId), api.listGuests(eventId), api.listTables(eventId)])
    setChart(chartData); setAllGuests(guestData); setTables(rows(tableData))
  }

  async function reserveSeat(guestId) {
    if (!assignSlot) return
    setChartBusy(true)
    try {
      await api.assignSeat(eventId, guestId, { table_id: assignSlot.tableId, seat_number: String(assignSlot.seat) })
      setAssignSlot(null); setGuestQuery('')
      await refreshChart()
      notify('Seat assigned')
    } catch (e) { notify(e.message || 'Could not assign seat', true) }
    finally { setChartBusy(false) }
  }

  async function addVvipAndReserve(vvip) {
    if (!assignSlot) return
    setChartBusy(true)
    try {
      const created = await api.addGuest(eventId, vvip)
      await api.assignSeat(eventId, created.id, { table_id: assignSlot.tableId, seat_number: String(assignSlot.seat) })
      setAssignSlot(null); setGuestQuery('')
      await refreshChart()
      notify(`${created.first_name} ${created.last_name} added & seated`)
    } catch (e) { notify(e.message || 'Could not add and seat this guest', true) }
    finally { setChartBusy(false) }
  }

  async function unassignSeat() {
    const target = pendingUnassign
    setPendingUnassign(null)
    setChartBusy(true)
    try {
      await api.assignSeat(eventId, target.guestId, { table_id: null, seat_number: null })
      await refreshChart()
      notify('Guest unassigned from seat')
    } catch (e) { notify(e.message || 'Could not unassign this seat', true) }
    finally { setChartBusy(false) }
  }

  async function saveGroup(e) {
    e.preventDefault()
    setWorking(true); setError('')
    try {
      const tableIds = rows(groupForm.table_ids)
      const payload = {
        name: clean(groupForm.name).trim(),
        tag: clean(groupForm.tag).trim() || clean(groupForm.name).trim(),
        description: clean(groupForm.description).trim() || null,
        sort_order: Number(groupForm.sort_order) || 0,
        table_ids: tableIds,
        table_orders: Object.fromEntries(tableIds.map((id, index) => [id, index])),
      }
      if (groupForm.id) await api.updateTableGroup(eventId, groupForm.id, payload)
      else await api.createTableGroup(eventId, payload)
      await load()
      setGroupForm(null)
      notify('Table group saved')
    } catch (e2) { setError(e2.message || 'Could not save table group') }
    finally { setWorking(false) }
  }

  async function removeGroup(group) {
    setWorking(true); setError('')
    try {
      await api.deleteTableGroup(eventId, group.id)
      await load()
      notify('Table group deleted')
    } catch (e) { setError(e.message || 'Could not delete table group') }
    finally { setWorking(false) }
  }

  function editGroup(group) {
    setGroupForm({
      ...group,
      name: clean(group.name),
      tag: clean(group.tag),
      description: clean(group.description),
      table_ids: rows(group.table_ids).length
        ? rows(group.table_ids)
        : rows(group.tables).map((table) => table?.id || table).filter(Boolean),
    })
  }

  function toggleGroupTable(id) {
    setGroupForm((current) => {
      const selected = rows(current.table_ids)
      return { ...current, table_ids: selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id] }
    })
  }

  async function autoAssign(clear) {
    setWorking(true); setError('')
    try {
      const result = await api.autoAssign(eventId, clear)
      await load()
      notify(`Assigned ${Number(result?.assigned) || 0}; ${Number(result?.unassigned) || 0} remain`)
    } catch (e) { setError(e.message || 'Could not assign guests') }
    finally { setWorking(false) }
  }

  if (!eventId) return <EmptyState icon="chair" title="Select an event" body="Choose an event before configuring seating." />
  if (loading) return <LoadingSkeleton rows={5} />

  return (
    <>
      {error && <ErrorRetryState message={error} onRetry={load} />}
      <div className="rr-section-title">
        <div><h2>{event?.seating_term || 'Seating'}</h2><p>Capacity and assignments come directly from the event.</p></div>
        <div className="ad-actions">
          <button className="rr-btn secondary" onClick={onFloorLayout}><Icon name="grid" size={14}/> Floor layout</button>
          <button className="rr-btn secondary" disabled={working || !tables.length} onClick={() => autoAssign(false)}>Auto-Assign</button>
          <button className="rr-btn secondary" disabled={working || !tables.length} onClick={() => autoAssign(true)}>Reassign all</button>
          <button className="rr-btn primary" disabled={working} onClick={() => setForm({ name: '', capacity: 10, category: '', sort_order: tables.length })}><Icon name="plus" size={14}/> Table</button>
        </div>
      </div>
      {!tables.length ? <EmptyState icon="chair" title="No tables yet" body="Create the first table to start assigning guests." /> : (
        <div className="rr-panel"><table className="rr-table"><thead><tr><th>Order</th><th>Table</th><th>Category</th><th>Capacity</th><th>Assigned</th><th>Actions</th></tr></thead>
          <tbody>{tables.map((t) => <tr key={t.id}>
            <td>{Number(t.sort_order) || 0}</td><td>{clean(t.name, 'Unnamed table')}</td><td>{clean(t.category, '—')}</td>
            <td>{Number(t.capacity) || 0}</td><td>{Number(t.assigned_count) || 0}/{Number(t.capacity) || 0}</td>
            <td className="ad-actions"><button className="rr-link-btn" onClick={() => setForm({ ...t, category: clean(t.category) })}>Edit</button><button className="rr-link-btn" onClick={() => setPendingDelete(t)}>Delete</button></td>
          </tr>)}</tbody></table></div>
      )}
      {form && <form className="rr-panel rd-panel-body" onSubmit={saveTable}>
        <div className="rd-row2"><input className="rr-input" aria-label="Table name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Table name"/>
          <input className="rr-input" aria-label="Capacity" required type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })}/></div>
        <div className="rd-row2"><input className="rr-input" aria-label="Category" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category"/>
          <input className="rr-input" aria-label="Sort order" type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: e.target.value })}/></div>
        <div className="ad-actions"><button type="button" className="rr-btn secondary" onClick={() => setForm(null)}>Cancel</button><button className="rr-btn primary" disabled={working}>{working ? 'Saving…' : 'Save'}</button></div>
      </form>}

      {!!tables.length && (
        <div className="ad-chart-section">
          <button className="rr-link-btn" onClick={showChart ? () => setShowChart(false) : loadChart} disabled={chartBusy}>
            {showChart ? '▲ Hide Seating Chart' : '▼ Show Seating Chart'}
          </button>
          {showChart && chart && (
            <div className="ad-chart-grid">
              {chart.map((t) => (
                <div className="rr-panel ad-chart-card" key={t.id}>
                  <div className="ad-chart-card-head">
                    <span>{t.name}{t.category && <small> · {t.category}</small>}</span>
                    <span className="rd-rowlink">{t.seats.filter((s) => s.guest_id).length}/{t.capacity}</span>
                  </div>
                  <div className="ad-chart-seats">
                    {t.seats.map((s) => (
                      <button
                        key={s.seat}
                        type="button"
                        disabled={chartBusy}
                        className={`ad-chart-seat ${s.guest_id ? 'filled' : 'empty'}`}
                        onClick={() => s.guest_id
                          ? setPendingUnassign({ guestId: s.guest_id, name: s.name })
                          : setAssignSlot({ tableId: t.id, tableName: t.name, seat: s.seat })}
                        title={s.guest_id ? 'Click to unassign' : 'Click to reserve for a guest'}
                      >
                        <span className="ad-chart-seat-num">{s.seat}</span>
                        {s.guest_id ? (
                          <>
                            <span className="ad-chart-seat-name">{s.name}</span>
                            {s.is_vip && <span className="ad-chart-tag">VIP</span>}
                            {s.admitted && <Icon name="check" size={11} />}
                          </>
                        ) : <span className="ad-chart-seat-empty">+ reserve</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {assignSlot && (
        <ReserveSeatModal
          slot={assignSlot}
          guests={allGuests}
          busy={chartBusy}
          query={guestQuery}
          onQuery={setGuestQuery}
          onPick={reserveSeat}
          onAddVvip={addVvipAndReserve}
          onClose={() => { setAssignSlot(null); setGuestQuery('') }}
        />
      )}
      {pendingUnassign && (
        <ConfirmDialog title="Unassign seat" message={`Remove ${clean(pendingUnassign.name, 'this guest')} from their seat?`} confirmLabel="Unassign" onConfirm={unassignSeat} onCancel={() => setPendingUnassign(null)} />
      )}

      <div className="rr-section-title"><div><h2>Table Groups</h2><p>Group tables and restrict grouped guests to the correct seating area.</p></div>
        <button className="rr-btn primary" disabled={working} onClick={() => setGroupForm({ name: '', tag: '', description: '', sort_order: groups.length, table_ids: [] })}><Icon name="plus" size={14}/> Table Group</button></div>
      {!groups.length ? <EmptyState icon="users" title="No table groups" body="Create a group such as VIP, Family, or Staff." /> :
        <div className="rr-grid2">{groups.map((g) => <div className="rr-panel ad-group-card" key={g.id}>
          <div className="ad-group-head"><div><strong>{clean(g.name, 'Unnamed group')}</strong><span className="ad-group-order">order {Number(g.sort_order) || 0}</span></div>
            <div className="ad-actions"><button className="rr-link-btn" onClick={() => editGroup(g)}>Edit</button><button className="rr-link-btn" disabled={working} onClick={() => removeGroup(g)}>Delete</button></div></div>
          <span className="ad-group-slug">{clean(g.tag)}</span><div className="ad-group-tables">{rows(g.table_ids).map((id) => clean(tables.find((table) => table.id === id)?.name, id)).join(', ') || 'No tables assigned'}</div>
        </div>)}</div>}
      {groupForm && <form className="rr-panel rd-panel-body" onSubmit={saveGroup}>
        <div className="rd-row2"><input className="rr-input" aria-label="Group name" required value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Group name"/>
          <input className="rr-input" aria-label="Group tag" value={groupForm.tag || ''} onChange={(e) => setGroupForm({ ...groupForm, tag: e.target.value })} placeholder="Guest tag"/></div>
        <textarea className="rr-input" aria-label="Group description" value={groupForm.description || ''} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} placeholder="Description"/>
        <div className="ad-group-tables"><strong>Tables</strong>{tables.map((table) => <label key={table.id} style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={rows(groupForm.table_ids).includes(table.id)} onChange={() => toggleGroupTable(table.id)}/> {clean(table.name, 'Unnamed table')}</label>)}</div>
        <div className="ad-actions"><button type="button" className="rr-btn secondary" onClick={() => setGroupForm(null)}>Cancel</button><button className="rr-btn primary" disabled={working}>{working ? 'Saving…' : 'Save group'}</button></div>
      </form>}
      {pendingDelete && <ConfirmDialog title="Delete table" message={`Delete "${clean(pendingDelete.name, 'this table')}"? Assigned guests will be unassigned.`} confirmLabel="Delete" onConfirm={removeTable} onCancel={() => setPendingDelete(null)}/>}
    </>
  )
}

export function RealOrdersContent({ eventId, notify }) {
  const [categories, setCategories] = useState([])
  const [summary, setSummary] = useState([])
  const [form, setForm] = useState(null)
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState(null)
  const [itemForm, setItemForm] = useState(null)
  const [pendingItemDelete, setPendingItemDelete] = useState(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!eventId) return
    setLoading(true); setError('')
    try {
      const [cats, totals] = await Promise.all([api.listMenuCategories(eventId), api.getMenuSummary(eventId)])
      setCategories(rows(cats)); setSummary(rows(totals))
    } catch (e) { setError(e.message || 'Could not load orders') }
    finally { setLoading(false) }
  }, [eventId])
  useEffect(() => { load() }, [load])

  async function saveCategory(e) {
    e.preventDefault(); setWorking(true); setError('')
    const payload = { name: clean(form.name).trim(), selection_type: form.selection_type || 'single', display_only: !!form.display_only }
    try {
      if (form.id) await api.updateMenuCategory(eventId, form.id, payload)
      else await api.createMenuCategory(eventId, payload)
      await load(); setForm(null); notify('Order category saved')
    } catch (e2) { setError(e2.message || 'Could not save category') }
    finally { setWorking(false) }
  }

  async function removeCategory() {
    const category = pendingCategoryDelete
    setPendingCategoryDelete(null); setWorking(true); setError('')
    try {
      await api.deleteMenuCategory(eventId, category.id)
      await load(); notify('Order category deleted')
    } catch (e) { setError(e.message || 'Could not delete order category') }
    finally { setWorking(false) }
  }

  async function saveItem(e) {
    e.preventDefault(); setWorking(true); setError('')
    const payload = { name: clean(itemForm.name).trim(), description: clean(itemForm.description).trim() || null }
    try {
      if (itemForm.id) await api.updateMenuItem(eventId, itemForm.id, payload)
      else await api.addMenuItem(eventId, itemForm.categoryId, payload)
      await load(); setItemForm(null); notify('Order item saved')
    } catch (e2) { setError(e2.message || 'Could not save order item') }
    finally { setWorking(false) }
  }

  async function removeItem() {
    const item = pendingItemDelete
    setPendingItemDelete(null); setWorking(true); setError('')
    try {
      await api.deleteMenuItem(eventId, item.id)
      await load(); notify('Order item deleted')
    } catch (e) { setError(e.message || 'Could not delete order item') }
    finally { setWorking(false) }
  }
  if (!eventId) return <EmptyState icon="card" title="Select an event" body="Choose an event before configuring orders." />
  if (loading) return <LoadingSkeleton rows={5} />
  return <>
    {error && <ErrorRetryState message={error} onRetry={load}/>}
    <div className="rr-section-title"><div><h2>Orders</h2><p>Categories and totals from the live menu contract.</p></div><button className="rr-btn primary" onClick={() => setForm({ name: '', selection_type: 'single', display_only: false })}><Icon name="plus" size={14}/> Category</button></div>
    {!categories.length ? <EmptyState icon="card" title="No order categories" body="Create a category for meals, drinks, gifts, or informational menu items."/> :
      <div className="ad-order-cats">{categories.map((c) => <div className="rr-panel ad-cat-panel" key={c.id}><div className="ad-cat-panel-head"><div><strong>{clean(c.name, 'Unnamed')}</strong> <span className="ad-selection-badge">{clean(c.selection_type, c.display_only ? 'DISPLAY' : 'SINGLE').toUpperCase()}</span></div>
        <div className="ad-actions"><button className="rr-link-btn" onClick={() => setForm(c)}>Edit</button><button className="rr-link-btn" onClick={() => setPendingCategoryDelete(c)}>Delete</button><button className="rr-link-btn" onClick={() => setItemForm({ categoryId: c.id, name: '', description: '' })}>+ Item</button></div></div>
        {rows(c.items).map((it) => <div className="ad-cat-item" key={it.id}><div><strong>{clean(it.name, 'Unnamed item')}</strong><span>{clean(it.description)}</span></div>
          <div className="ad-actions"><button className="rr-link-btn" onClick={() => setItemForm({ ...it, categoryId: c.id, description: clean(it.description) })}>Edit</button><button className="rr-link-btn" onClick={() => setPendingItemDelete(it)}>Delete</button></div></div>)}</div>)}</div>}
    <div className="rr-panel"><div className="rd-panel-head"><h3>Order summary</h3></div><div className="rd-panel-body"><table className="rr-table"><thead><tr><th>Category</th><th>Item</th><th>Count</th></tr></thead><tbody>
      {summary.flatMap((c) => rows(c.items).map((it) => <tr key={`${c.id}-${it.id}`}><td>{clean(c.category)}</td><td>{clean(it.name)}</td><td>{Number(it.count) || 0}</td></tr>))}
    </tbody></table>{!summary.length && <p>No selections yet.</p>}</div></div>
    {form && <form className="rr-panel rd-panel-body" onSubmit={saveCategory}><input className="rr-input" required aria-label="Category name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Category name"/>
      <select className="rr-select" value={form.selection_type || 'single'} onChange={(e) => setForm({ ...form, selection_type: e.target.value })}><option value="single">Single choice</option><option value="multi">Multiple choice</option><option value="combo">Combination</option></select>
      <div className="ad-actions"><button type="button" className="rr-btn secondary" onClick={() => setForm(null)}>Cancel</button><button className="rr-btn primary" disabled={working}>{working ? 'Saving…' : 'Save'}</button></div>
    </form>}
    {itemForm && <form className="rr-panel rd-panel-body" onSubmit={saveItem}><input className="rr-input" required aria-label="Item name" value={itemForm.name || ''} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Item name"/>
      <textarea className="rr-input" aria-label="Item description" value={itemForm.description || ''} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} placeholder="Description"/>
      <div className="ad-actions"><button type="button" className="rr-btn secondary" onClick={() => setItemForm(null)}>Cancel</button><button className="rr-btn primary" disabled={working}>{working ? 'Saving…' : 'Save item'}</button></div>
    </form>}
    {pendingItemDelete && <ConfirmDialog title="Delete order item" message={`Delete "${clean(pendingItemDelete.name, 'this item')}"? Existing selections will be removed.`} confirmLabel="Delete" onConfirm={removeItem} onCancel={() => setPendingItemDelete(null)}/>}
    {pendingCategoryDelete && <ConfirmDialog title="Delete order category" message={`Delete "${clean(pendingCategoryDelete.name, 'this category')}" and its items? Existing selections will be removed.`} confirmLabel="Delete" onConfirm={removeCategory} onCancel={() => setPendingCategoryDelete(null)}/>}
  </>
}
