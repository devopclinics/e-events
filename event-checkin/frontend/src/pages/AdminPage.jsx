import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  draft:  { label: 'Draft',  dot: 'bg-gray-400',    text: 'text-gray-600 dark:text-slate-300',  bg: 'bg-gray-100 dark:bg-slate-700'   },
  active: { label: 'Active', dot: 'bg-green-500 animate-pulse', text: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/40' },
  ended:  { label: 'Ended',  dot: 'bg-slate-400',   text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700'  },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.draft
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function StatusControls({ event, onChanged }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const actions = {
    draft:  [{ label: '▶ Start Event',  next: 'active', cls: 'bg-green-600 hover:bg-green-700 text-white' }],
    active: [{ label: '⏹ End Event',    next: 'ended',  cls: 'bg-red-600 hover:bg-red-700 text-white' }],
    ended:  [{ label: '↩ Reopen',       next: 'active', cls: 'bg-amber-500 hover:bg-amber-600 text-white' }],
  }[event.status] || []

  async function change(next) {
    setLoading(true); setErr('')
    try {
      const updated = await api.changeStatus(event.id, next)
      onChanged(updated)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <StatusBadge status={event.status} />
      {actions.map(({ label, next, cls }) => (
        <button key={next} onClick={() => change(next)} disabled={loading}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors ${cls}`}>
          {loading ? '…' : label}
        </button>
      ))}
      {err && <span className="text-red-600 text-xs">{err}</span>}
      {event.status === 'draft' && (
        <span className="text-xs text-gray-400">Start the event to enable scanning.</span>
      )}
      {event.status === 'ended' && (
        <span className="text-xs text-gray-400">Event ended — scanning is disabled.</span>
      )}
    </div>
  )
}

// ── Feature Toggles ───────────────────────────────────────────────────────────

function FeatureToggles({ event, onChanged }) {
  const [loading, setLoading] = useState(false)

  async function toggle(key) {
    setLoading(true)
    try {
      const updated = await api.toggleFeatures(event.id, { [key]: !event[key] })
      onChanged(updated)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex flex-wrap gap-3 pt-3 border-t dark:border-slate-700 mt-3">
      <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 self-center">Features:</span>
      {[
        { key: 'seating_enabled', label: 'Seating' },
        { key: 'menu_enabled',    label: 'Menu' },
      ].map(({ key, label }) => (
        <button
          key={key}
          onClick={() => toggle(key)}
          disabled={loading}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
            event[key]
              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
              : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          }`}
        >
          {label} {event[key] ? 'ON' : 'OFF'}
        </button>
      ))}
    </div>
  )
}

// ── Seating Panel ─────────────────────────────────────────────────────────────

function SeatingPanel({ eventId }) {
  const [tables, setTables]       = useState([])
  const [chart, setChart]         = useState(null)
  const [showChart, setShowChart] = useState(false)
  const [form, setForm]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  useEffect(() => {
    api.listTables(eventId).then(setTables).catch(console.error)
  }, [eventId])

  async function loadChart() {
    const data = await api.getSeatingChart(eventId)
    setChart(data)
    setShowChart(true)
  }

  async function saveTable(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { name: form.name, capacity: Number(form.capacity) }
      if (form.id) {
        const updated = await api.updateTable(eventId, form.id, payload)
        setTables((prev) => prev.map((t) => (t.id === form.id ? updated : t)))
      } else {
        const created = await api.createTable(eventId, payload)
        setTables((prev) => [...prev, created])
      }
      setForm(null)
      if (showChart) loadChart()
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function deleteTable(id) {
    if (!confirm('Delete this table? Assigned guests will be unassigned.')) return
    setLoading(true)
    try {
      await api.deleteTable(eventId, id)
      setTables((prev) => prev.filter((t) => t.id !== id))
      if (showChart) loadChart()
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function autoAssign(clear) {
    if (clear && !confirm('Clear all seat assignments and reassign everyone?')) return
    setLoading(true)
    try {
      const res = await api.autoAssign(eventId, clear)
      setMsg(`Assigned: ${res.assigned}, remaining unassigned: ${res.unassigned}`)
      setTimeout(() => setMsg(''), 4000)
      api.listTables(eventId).then(setTables)
      if (showChart) loadChart()
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-base dark:text-white">Seating</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => autoAssign(false)} disabled={loading || tables.length === 0}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">
            Auto-Assign
          </button>
          <button onClick={() => autoAssign(true)} disabled={loading || tables.length === 0}
            className="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-50">
            Reassign All
          </button>
          <button onClick={() => setForm({ name: '', capacity: 10 })} disabled={loading}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">
            + Table
          </button>
        </div>
      </div>

      {tables.length === 0 && !form ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No tables yet. Add tables to enable seating.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Table</th>
                <th className="px-4 py-2 text-center">Capacity</th>
                <th className="px-4 py-2 text-center">Assigned</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {tables.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">{t.name}</td>
                  <td className="px-4 py-2.5 text-center dark:text-slate-300">{t.capacity}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold ${t.assigned_count >= t.capacity ? 'text-red-500' : 'text-green-600'}`}>
                      {t.assigned_count}/{t.capacity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-3">
                      <button onClick={() => setForm({ id: t.id, name: t.name, capacity: t.capacity })}
                        className="text-xs text-indigo-600 hover:underline">Edit</button>
                      <button onClick={() => deleteTable(t.id)} disabled={loading}
                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <form onSubmit={saveTable} className="flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Table Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
              className={fieldCls} placeholder="Table 1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Capacity</label>
            <input type="number" min="1" max="200" value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} required
              className={`${fieldCls} w-24`} />
          </div>
          <button type="submit" disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {form.id ? 'Save' : 'Add'}
          </button>
          <button type="button" onClick={() => setForm(null)}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
            Cancel
          </button>
        </form>
      )}

      {tables.length > 0 && (
        <div className="pt-2 border-t dark:border-slate-700">
          <button
            onClick={showChart ? () => setShowChart(false) : loadChart}
            disabled={loading}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {showChart ? '▲ Hide Seating Chart' : '▼ Show Seating Chart'}
          </button>
          {showChart && chart && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {chart.map((t) => (
                <div key={t.id} className="border dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-700 px-3 py-2 flex justify-between items-center">
                    <span className="text-sm font-semibold dark:text-white">{t.name}</span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {t.seats.filter((s) => s.guest_id).length}/{t.capacity}
                    </span>
                  </div>
                  <div className="divide-y dark:divide-slate-700 max-h-48 overflow-y-auto">
                    {t.seats.map((s) => (
                      <div key={s.seat} className="px-3 py-1.5 flex items-center gap-2 text-sm">
                        <span className="w-6 text-xs font-mono text-gray-400 dark:text-slate-500 shrink-0">{s.seat}</span>
                        {s.guest_id ? (
                          <>
                            <span className="flex-1 dark:text-slate-200 truncate">{s.name}</span>
                            {s.admitted && <span className="text-xs text-green-600 shrink-0">✓</span>}
                            {s.meal_served && <span className="text-xs text-amber-600 shrink-0">🍽</span>}
                          </>
                        ) : (
                          <span className="flex-1 text-xs italic text-gray-300 dark:text-slate-600">Empty</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-sm text-indigo-600">{msg}</p>}
    </div>
  )
}

// ── Menu Panel ────────────────────────────────────────────────────────────────

function MenuPanel({ eventId }) {
  const [categories, setCategories] = useState([])
  const [catForm, setCatForm]       = useState(null)
  const [itemForms, setItemForms]   = useState({})
  const [summary, setSummary]       = useState(null)
  const [showSummary, setShowSummary] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [msg, setMsg]               = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  useEffect(() => {
    api.listMenuCategories(eventId).then(setCategories).catch(console.error)
  }, [eventId])

  async function loadSummary() {
    const data = await api.getMenuSummary(eventId)
    setSummary(data)
    setShowSummary(true)
  }

  async function saveCat(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { name: catForm.name, sort_order: Number(catForm.sort_order) || 0 }
      if (catForm.id) {
        const updated = await api.updateMenuCategory(eventId, catForm.id, payload)
        setCategories((prev) => prev.map((c) => (c.id === catForm.id ? updated : c)))
      } else {
        const created = await api.createMenuCategory(eventId, payload)
        setCategories((prev) => [...prev, created])
      }
      setCatForm(null)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function deleteCat(catId) {
    if (!confirm('Delete this category and all its items?')) return
    setLoading(true)
    try {
      await api.deleteMenuCategory(eventId, catId)
      setCategories((prev) => prev.filter((c) => c.id !== catId))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function saveItem(e, catId) {
    e.preventDefault()
    const form = itemForms[catId]
    setLoading(true)
    try {
      const payload = { name: form.name, description: form.description || '' }
      if (form.id) {
        const updated = await api.updateMenuItem(eventId, form.id, payload)
        setCategories((prev) => prev.map((c) =>
          c.id === catId ? { ...c, items: c.items.map((i) => (i.id === form.id ? updated : i)) } : c
        ))
      } else {
        const created = await api.addMenuItem(eventId, catId, payload)
        setCategories((prev) => prev.map((c) =>
          c.id === catId ? { ...c, items: [...c.items, created] } : c
        ))
      }
      setItemForms((prev) => ({ ...prev, [catId]: null }))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function deleteItem(catId, itemId) {
    setLoading(true)
    try {
      await api.deleteMenuItem(eventId, itemId)
      setCategories((prev) => prev.map((c) =>
        c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c
      ))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-base dark:text-white">Menu</h2>
        <div className="flex gap-2">
          <button
            onClick={showSummary ? () => setShowSummary(false) : loadSummary}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {showSummary ? 'Hide Summary' : 'View Summary'}
          </button>
          <button
            onClick={() => setCatForm({ name: '', sort_order: categories.length })}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700"
          >
            + Category
          </button>
        </div>
      </div>

      {categories.length === 0 && !catForm && (
        <p className="text-sm text-gray-400 dark:text-slate-500">No menu categories yet. Add a category to get started.</p>
      )}

      <div className="space-y-3">
        {categories.map((cat) => (
          <div key={cat.id} className="border dark:border-slate-700 rounded-lg overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm font-semibold dark:text-white">{cat.name}</span>
              <div className="flex gap-3">
                <button onClick={() => setCatForm({ id: cat.id, name: cat.name, sort_order: cat.sort_order })}
                  className="text-xs text-indigo-600 hover:underline">Edit</button>
                <button onClick={() => deleteCat(cat.id)} disabled={loading}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                <button
                  onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { name: '', description: '' } }))}
                  className="text-xs text-green-600 hover:underline font-semibold"
                >
                  + Item
                </button>
              </div>
            </div>
            <div className="divide-y dark:divide-slate-700">
              {cat.items.map((item) => (
                <div key={item.id} className="px-4 py-2 flex items-center justify-between">
                  <div>
                    <span className="text-sm dark:text-slate-200">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">{item.description}</span>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { id: item.id, name: item.name, description: item.description || '' } }))}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button onClick={() => deleteItem(cat.id, item.id)} disabled={loading}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                  </div>
                </div>
              ))}
              {cat.items.length === 0 && !itemForms[cat.id] && (
                <div className="px-4 py-2 text-xs text-gray-400 dark:text-slate-500 italic">No items yet.</div>
              )}
              {itemForms[cat.id] && (
                <form
                  onSubmit={(e) => saveItem(e, cat.id)}
                  className="px-4 py-3 flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700/50"
                >
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Item Name</label>
                    <input
                      value={itemForms[cat.id].name}
                      onChange={(e) => setItemForms((prev) => ({ ...prev, [cat.id]: { ...prev[cat.id], name: e.target.value } }))}
                      required className={fieldCls} placeholder="Chicken Breast"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description</label>
                    <input
                      value={itemForms[cat.id].description}
                      onChange={(e) => setItemForms((prev) => ({ ...prev, [cat.id]: { ...prev[cat.id], description: e.target.value } }))}
                      className={fieldCls} placeholder="Optional"
                    />
                  </div>
                  <button type="submit" disabled={loading}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                    {itemForms[cat.id].id ? 'Save' : 'Add'}
                  </button>
                  <button type="button" onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: null }))}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
                    ×
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>

      {catForm && (
        <form onSubmit={saveCat} className="flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Category Name</label>
            <input value={catForm.name} onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))} required
              className={fieldCls} placeholder="Main Course" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Sort Order</label>
            <input type="number" value={catForm.sort_order} onChange={(e) => setCatForm((f) => ({ ...f, sort_order: e.target.value }))}
              className={`${fieldCls} w-20`} />
          </div>
          <button type="submit" disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {catForm.id ? 'Save' : 'Add'}
          </button>
          <button type="button" onClick={() => setCatForm(null)}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
            Cancel
          </button>
        </form>
      )}

      {showSummary && summary && (
        <div className="pt-3 border-t dark:border-slate-700 space-y-4">
          <h3 className="text-sm font-semibold dark:text-white">Selection Summary</h3>
          {summary.map((cat) => (
            <div key={cat.id}>
              <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-1.5">{cat.category}</div>
              <div className="space-y-1">
                {cat.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="text-sm dark:text-slate-200 flex-1">{item.name}</span>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 w-8 text-right">{item.count}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500">
                  <span className="text-sm flex-1 italic">No selection</span>
                  <span className="text-xs font-bold w-8 text-right">{cat.no_choice}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  )
}

// ── Team panel ────────────────────────────────────────────────────────────────

function TeamPanel({ eventId }) {
  const [members, setMembers] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.listMembers(eventId).then(setMembers).catch(console.error)
    api.listUsers().then(setAllUsers).catch(console.error)
  }, [eventId])

  const assignedIds = new Set(members.map((m) => m.user.id))
  const unassigned = allUsers.filter((u) => !assignedIds.has(u.id))

  async function assign() {
    if (!selectedUserId) return
    setLoading(true)
    try {
      const m = await api.assignMember(eventId, selectedUserId)
      setMembers((prev) => [...prev, m])
      setSelectedUserId('')
      setMsg('Member assigned.')
      setTimeout(() => setMsg(''), 3000)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function remove(userId) {
    setLoading(true)
    try {
      await api.removeMember(eventId, userId)
      setMembers((prev) => prev.filter((m) => m.user.id !== userId))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function toggleSeatPerm(userId, current) {
    setLoading(true)
    try {
      await api.updateMemberPermissions(eventId, userId, { can_reassign_seats: !current })
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, can_reassign_seats: !current } : m))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  const roleTag = (role) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${role === 'admin' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'}`}>
      {role}
    </span>
  )

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <h2 className="font-semibold text-base dark:text-white">Event Team</h2>

      {members.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No members assigned yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2.5 gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-semibold text-sm">
                  {m.user.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium dark:text-slate-100">{m.user.name}</div>
                  <div className="text-xs text-gray-400 dark:text-slate-500">{m.user.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {roleTag(m.user.role)}
                {m.user.role === 'official' && (
                  <button
                    onClick={() => toggleSeatPerm(m.user.id, m.can_reassign_seats)}
                    disabled={loading}
                    title="Can reassign seats"
                    className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                      m.can_reassign_seats
                        ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800'
                        : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                    }`}
                  >
                    Seats: {m.can_reassign_seats ? 'Yes' : 'No'}
                  </button>
                )}
                <button onClick={() => remove(m.user.id)} disabled={loading}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
          className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
          <option value="">— assign a user —</option>
          {unassigned.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
          ))}
        </select>
        <button onClick={assign} disabled={loading || !selectedUserId}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          Assign
        </button>
      </div>
      {msg && <p className="text-sm text-indigo-600">{msg}</p>}
    </div>
  )
}

// ── UsersPanel ────────────────────────────────────────────────────────────────

function UsersPanel() {
  const [users, setUsers] = useState([])
  const [changing, setChanging] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.listUsers().then(setUsers).catch(console.error)
  }, [])

  async function changeRole(userId, newRole) {
    setChanging(userId)
    try {
      await api.updateUserRole(userId, newRole)
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)))
      setMsg('Role updated.')
      setTimeout(() => setMsg(''), 3000)
    } catch (e) { setMsg(e.message) }
    finally { setChanging(null) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <h2 className="font-semibold text-base dark:text-white">User Management</h2>
      {users.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No users yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">{u.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      disabled={changing === u.id}
                      className="border border-gray-300 dark:border-slate-700 rounded px-2 py-1 text-xs disabled:opacity-50 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                    >
                      <option value="admin">Admin</option>
                      <option value="official">Official</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p className="text-sm text-indigo-600">{msg}</p>}
    </div>
  )
}

// ── EventForm ─────────────────────────────────────────────────────────────────

function utcToLocal(utcStr) {
  if (!utcStr) return ''
  const d = new Date(utcStr)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function EventForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: '', couples_name: '', event_date: '', description: '', checkin_base_url: window.location.origin }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await onSave({ ...form, event_date: new Date(form.event_date).toISOString() })
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const field = 'block w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Event Name *</label>
          <input className={field} value={form.name} onChange={set('name')} required placeholder="Smith-Jones Wedding" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Couple's Name *</label>
          <input className={field} value={form.couples_name} onChange={set('couples_name')} required placeholder="John & Jane" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Event Date *</label>
          <input className={field} type="datetime-local" value={form.event_date?.slice(0, 16) || ''} onChange={set('event_date')} required />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">App Base URL *</label>
          <input className={field} value={form.checkin_base_url} onChange={set('checkin_base_url')} required placeholder="https://events.vsgs.io" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
        <textarea className={field} rows={2} value={form.description || ''} onChange={set('description')} />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving}
          className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Event'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-5 py-2 rounded-lg border border-gray-300 dark:border-slate-700 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function relativeTime(iso) {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function SourceSyncPanel({ event, onSave, onSyncNow, loading }) {
  const [url, setUrl] = useState(event.source_url || '')
  const [interval, setInterval] = useState(event.source_sync_interval_seconds || 60)
  const [tick, setTick] = useState(0)

  useEffect(() => { setUrl(event.source_url || '') }, [event.id, event.source_url])
  useEffect(() => { setInterval(event.source_sync_interval_seconds || 60) }, [event.id, event.source_sync_interval_seconds])

  // Re-render once a second so "X seconds ago" stays live.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const dirty = url.trim() !== (event.source_url || '') ||
    Number(interval) !== (event.source_sync_interval_seconds || 60)
  const polling = event.status === 'active' && !!event.source_url

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">Live Spreadsheet Sync</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            Paste a Google Sheets or OneDrive share URL. While the event is <strong>Active</strong>,
            the server re-imports it every {event.source_sync_interval_seconds || 60} seconds and
            adds any new guests. Existing guests are never removed.
          </p>
        </div>
        {polling && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Listening
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://1drv.ms/x/… or https://docs.google.com/spreadsheets/d/…"
          className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">Every</label>
          <input
            type="number"
            min={15}
            max={3600}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value) || 60)}
            className="w-20 border border-gray-300 dark:border-slate-700 rounded-lg px-2 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">sec</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onSave(url.trim(), Number(interval) || 60)}
          disabled={!dirty}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          Save
        </button>
        <button
          onClick={onSyncNow}
          disabled={loading || !event.source_url}
          className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50">
          {loading ? 'Syncing…' : 'Sync now'}
        </button>
        {event.source_url && (
          <button
            onClick={() => { setUrl(''); onSave('', Number(interval) || 60) }}
            className="text-xs text-red-500 hover:text-red-700 hover:underline px-2 py-2">
            Clear URL
          </button>
        )}
        <span className="text-xs text-gray-500 dark:text-slate-400 ml-auto" key={tick}>
          Last sync: <strong>{relativeTime(event.source_last_sync_at)}</strong>
        </span>
      </div>

      {event.source_last_error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 text-xs">
          {event.source_last_error}
        </div>
      )}
      {!polling && event.source_url && (
        <p className="text-xs text-gray-400 dark:text-slate-500">
          Auto-sync starts when you set the event to <strong>Active</strong>.
        </p>
      )}
    </div>
  )
}

function Badge({ on, labels }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${on ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>
      {on ? labels[0] : labels[1]}
    </span>
  )
}

// ── Server Health Panel ───────────────────────────────────────────────────────

function MeterBar({ percent, color }) {
  const bar = { indigo: 'bg-indigo-500', amber: 'bg-amber-500', green: 'bg-green-500', red: 'bg-red-500' }
  const used = color || (percent >= 90 ? 'red' : percent >= 70 ? 'amber' : 'indigo')
  return (
    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2 mt-1">
      <div className={`${bar[used]} h-2 rounded-full transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  )
}

function ServerHealthPanel() {
  const [health, setHealth] = useState(null)
  const [err, setErr]       = useState('')
  const [loading, setLoading] = useState(false)

  async function refresh() {
    setLoading(true); setErr('')
    try {
      setHealth(await api.getSystemHealth())
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base dark:text-white">Server Resources</h2>
        <button onClick={refresh} disabled={loading}
          className="text-xs text-indigo-600 hover:underline disabled:opacity-40">
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {err && <p className="text-red-500 text-sm">{err}</p>}

      {health && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* CPU */}
          <div>
            <div className="flex justify-between text-sm font-medium dark:text-slate-200">
              <span>CPU</span>
              <span>{health.cpu.percent}%</span>
            </div>
            <MeterBar percent={health.cpu.percent} />
          </div>

          {/* Memory */}
          <div>
            <div className="flex justify-between text-sm font-medium dark:text-slate-200">
              <span>Memory</span>
              <span>{health.memory.percent}%</span>
            </div>
            <MeterBar percent={health.memory.percent} />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
              {health.memory.used_mb.toLocaleString()} MB used &nbsp;/&nbsp; {health.memory.available_mb.toLocaleString()} MB free
            </p>
          </div>

          {/* Disk */}
          <div>
            <div className="flex justify-between text-sm font-medium dark:text-slate-200">
              <span>Disk</span>
              <span>{health.disk.percent}%</span>
            </div>
            <MeterBar percent={health.disk.percent} />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
              {health.disk.used_gb.toLocaleString()} GB used &nbsp;/&nbsp; {health.disk.free_gb.toLocaleString()} GB free
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AdminPage ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [events, setEvents] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [sheetUrl, setSheetUrl] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [selectedGuests, setSelectedGuests] = useState(new Set())
  const fileRef = useRef()

  const PAGE_SIZE = 50
  const event = events.find((e) => e.id === selectedId)

  useEffect(() => { api.listEvents().then(setEvents).catch(console.error) }, [])

  useEffect(() => {
    setPage(0)
    setSelectedGuests(new Set())
    if (!selectedId) return setGuests([])
    api.listGuests(selectedId).then(setGuests).catch(console.error)
  }, [selectedId])

  // Poll the event list every 15s while a sync-enabled event is selected,
  // so the "Last sync" timestamp and guest count stay live without a refresh.
  useEffect(() => {
    if (!selectedId) return
    const id = setInterval(async () => {
      try {
        const evs = await api.listEvents()
        setEvents(evs)
        const guests = await api.listGuests(selectedId)
        setGuests(guests)
      } catch { /* swallow — network blips shouldn't surface here */ }
    }, 15000)
    return () => clearInterval(id)
  }, [selectedId])

  function flash(m, isErr = false) {
    isErr ? setError(m) : setMsg(m)
    setTimeout(() => { setMsg(''); setError('') }, 4000)
  }

  function updateEvent(updated) {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
  }

  async function handleCreate(data) {
    const ev = await api.createEvent(data)
    setEvents([ev, ...events])
    setSelectedId(ev.id)
    setShowForm(false)
    flash('Event created!')
  }

  async function handleUpdate(data) {
    const ev = await api.updateEvent(selectedId, data)
    updateEvent(ev)
    setEditing(false)
    flash('Event updated!')
  }

  async function handleDeleteEvent() {
    if (!event) return
    if (!confirm(`Delete "${event.name}"? This removes all guests and cannot be undone.`)) return
    try {
      await api.deleteEvent(selectedId)
      setEvents((prev) => prev.filter((e) => e.id !== selectedId))
      setSelectedId('')
      setGuests([])
      flash('Event deleted.')
    } catch (err) { flash(err.message, true) }
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    try {
      const res = await api.uploadGuests(selectedId, file)
      flash(`${res.added} guests added, ${res.skipped} skipped.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false); fileRef.current.value = '' }
  }

  async function handleGenQR() {
    setLoading(true)
    try {
      const res = await api.generateQR(selectedId)
      flash(`QR codes generated for ${res.generated} guests.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleSendInvites() {
    setLoading(true)
    try {
      const res = await api.sendInvites(selectedId)
      flash(`Invite emails queued for ${res.queued} guests.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleSendBatch({ ids = null, force = false, label }) {
    setLoading(true)
    try {
      const res = await api.sendInvitesBatch(selectedId, ids, force)
      flash(`${label}: ${res.queued} invite${res.queued === 1 ? '' : 's'} queued.`)
      setGuests(await api.listGuests(selectedId))
      setSelectedGuests(new Set())
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  function toggleSelectGuest(id) {
    setSelectedGuests((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectPage(pageGuests, allSelected) {
    setSelectedGuests((prev) => {
      const next = new Set(prev)
      for (const g of pageGuests) {
        allSelected ? next.delete(g.id) : next.add(g.id)
      }
      return next
    })
  }

  async function handleImportUrl() {
    if (!sheetUrl.trim()) return
    setLoading(true)
    try {
      const res = await api.importGuestsFromUrl(selectedId, sheetUrl.trim())
      flash(`${res.added} guests added, ${res.skipped} skipped.`)
      setGuests(await api.listGuests(selectedId))
      setSheetUrl('')
      setShowUrlInput(false)
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleSaveSource(url, interval) {
    try {
      const updated = await api.updateSource(selectedId, {
        source_url: url,
        source_sync_interval_seconds: interval,
      })
      updateEvent(updated)
      flash(url ? 'Spreadsheet URL saved.' : 'Spreadsheet URL cleared.')
    } catch (err) { flash(err.message, true) }
  }

  async function handleSyncNow() {
    setLoading(true)
    try {
      const res = await api.syncNow(selectedId)
      flash(`Synced: ${res.added} added, ${res.skipped} skipped.`)
      setGuests(await api.listGuests(selectedId))
      // Refresh the event so last_sync_at updates locally.
      const refreshed = await api.listEvents()
      setEvents(refreshed)
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleDeleteGuest(guestId) {
    if (!confirm('Remove this guest?')) return
    try {
      await api.deleteGuest(selectedId, guestId)
      setGuests((prev) => prev.filter((g) => g.id !== guestId))
      flash('Guest removed.')
    } catch (err) { flash(err.message, true) }
  }

  async function handleResendInvite(guestId) {
    setLoading(true)
    try {
      await api.resendInvite(selectedId, guestId)
      flash('Invite resent.')
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  const stats = {
    total: guests.length,
    qr: guests.filter((g) => g.qr_generated_at).length,
    invited: guests.filter((g) => g.invite_sent_at).length,
    admitted: guests.filter((g) => g.admitted).length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-white">Admin Panel</h1>
        <button onClick={() => { setShowForm(true); setEditing(false) }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700">
          + New Event
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <h2 className="font-semibold text-lg mb-4 dark:text-white">New Event</h2>
          <EventForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">Select Event</label>
          <div className="flex gap-3 items-center">
            <select className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm flex-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setEditing(false) }}>
              <option value="">— choose an event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} — {ev.couples_name}
                </option>
              ))}
            </select>
            {event && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditing(!editing)} className="text-sm text-indigo-600 hover:underline whitespace-nowrap">
                  {editing ? 'Cancel' : 'Edit'}
                </button>
                <button onClick={handleDeleteEvent}
                  className="text-sm text-red-500 hover:text-red-700 hover:underline whitespace-nowrap">
                  Delete
                </button>
              </div>
            )}
          </div>

          {editing && event && (
            <div className="mt-4 pt-4 border-t dark:border-slate-700">
              <EventForm
                initial={{ ...event, event_date: utcToLocal(event.event_date) }}
                onSave={handleUpdate}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </div>
      )}

      {msg && <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-lg px-4 py-3 text-sm">{msg}</div>}
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {event && (
        <>
          {/* Status controls */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-semibold text-base dark:text-white">Event Status</h2>
              <StatusControls event={event} onChanged={updateEvent} />
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
              <strong>Draft</strong> → set up guests and invites &nbsp;·&nbsp;
              <strong>Active</strong> → scanning enabled &nbsp;·&nbsp;
              <strong>Ended</strong> → read-only record
            </p>
            <FeatureToggles event={event} onChanged={updateEvent} />
          </div>

          {/* Live spreadsheet sync */}
          <SourceSyncPanel
            event={event}
            onSave={handleSaveSource}
            onSyncNow={handleSyncNow}
            loading={loading}
          />

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Guests', value: stats.total, cls: 'text-indigo-600' },
              { label: 'QR Generated', value: stats.qr,    cls: 'text-blue-600'   },
              { label: 'Invites Sent', value: stats.invited,cls: 'text-amber-600'  },
              { label: 'Admitted',     value: stats.admitted,cls: 'text-green-600' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 text-center">
                <div className={`text-3xl font-bold ${cls}`}>{value}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Guest management */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
            <h2 className="font-semibold text-base dark:text-white">Guest Management</h2>

            {/* Import row */}
            <div className="flex flex-wrap gap-3 items-center">
              <div>
                <input type="file" accept=".csv,.xlsx,.xls" ref={fileRef} onChange={handleUpload} className="hidden" />
                <button onClick={() => fileRef.current.click()} disabled={loading}
                  className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">
                  Upload CSV
                </button>
                <span className="text-xs text-gray-400 dark:text-slate-500 ml-2">first_name, last_name, email, phone</span>
              </div>
              <button onClick={() => setShowUrlInput((v) => !v)} disabled={loading}
                className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">
                📋 Import from Google Sheets / Excel
              </button>
            </div>

            {/* Spreadsheet URL input */}
            {showUrlInput && (
              <div className="flex gap-2 items-center bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                <input
                  type="url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="Paste Google Sheets or Excel Online share link…"
                  className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                />
                <button onClick={handleImportUrl} disabled={loading || !sheetUrl.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                  {loading ? 'Importing…' : 'Import'}
                </button>
                <button onClick={() => { setShowUrlInput(false); setSheetUrl('') }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-2 text-lg leading-none">×</button>
              </div>
            )}
            {showUrlInput && (
              <p className="text-xs text-gray-400 dark:text-slate-500">
                Google Sheets: share with "Anyone with link can view". OneDrive/Excel: use Share → Copy link with "Anyone with the link can view", not the browser address bar URL.
                Sheet must have columns: <strong>first_name, last_name, email, phone</strong>
              </p>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3 pt-1 border-t dark:border-slate-700">
              <button onClick={handleGenQR} disabled={loading || stats.total === 0}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                Generate QR Codes
              </button>
              <button onClick={() => handleSendBatch({ force: false, label: 'Send unsent' })}
                disabled={loading || stats.total === 0 || stats.total - stats.invited === 0}
                className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50">
                Send to Unsent ({stats.total - stats.invited})
              </button>
              <button onClick={() => {
                  if (!confirm(`Re-send invite to ALL ${stats.total} guests, including those already invited?`)) return
                  handleSendBatch({ force: true, label: 'Resend all' })
                }}
                disabled={loading || stats.total === 0}
                className="bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-50 dark:hover:bg-slate-600 disabled:opacity-50">
                Resend to All
              </button>
            </div>
          </div>

          {/* Team assignment */}
          <TeamPanel eventId={selectedId} />

          {/* Seating management */}
          {event.seating_enabled && <SeatingPanel eventId={selectedId} />}

          {/* Menu management */}
          {event.menu_enabled && <MenuPanel eventId={selectedId} />}

          {/* Guest list */}
          {guests.length > 0 && (() => {
            const totalPages = Math.ceil(guests.length / PAGE_SIZE)
            const pageGuests = guests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            const pageSelectedCount = pageGuests.filter((g) => selectedGuests.has(g.id)).length
            const pageAllSelected = pageGuests.length > 0 && pageSelectedCount === pageGuests.length
            return (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
                {selectedGuests.size > 0 && (
                  <div className="px-4 sm:px-6 py-3 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-200 dark:border-indigo-800 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
                      {selectedGuests.size} selected
                    </span>
                    <button
                      onClick={() => handleSendBatch({ ids: [...selectedGuests], force: true, label: 'Send to selected' })}
                      disabled={loading}
                      className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                      Send invite to selected
                    </button>
                    <button
                      onClick={() => setSelectedGuests(new Set())}
                      className="text-xs text-gray-600 dark:text-slate-300 hover:underline ml-auto">
                      Clear selection
                    </button>
                  </div>
                )}
                <div className="px-4 sm:px-6 py-4 border-b dark:border-slate-700 flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-sm sm:text-base dark:text-white">Guest List ({guests.length})</h2>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                        className="px-2 py-1 border dark:border-slate-700 rounded text-gray-600 dark:text-slate-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 text-sm">←</button>
                      <span className="text-gray-500 dark:text-slate-400 text-xs">{page + 1} / {totalPages}</span>
                      <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                        className="px-2 py-1 border dark:border-slate-700 rounded text-gray-600 dark:text-slate-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 text-sm">→</button>
                    </div>
                  )}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={pageAllSelected}
                            ref={(el) => { if (el) el.indeterminate = pageSelectedCount > 0 && !pageAllSelected }}
                            onChange={() => toggleSelectPage(pageGuests, pageAllSelected)}
                            className="cursor-pointer"
                            aria-label="Select page"
                          />
                        </th>
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Email</th>
                        <th className="px-4 py-3 text-center">QR</th>
                        <th className="px-4 py-3 text-center">Invited</th>
                        <th className="px-4 py-3 text-center">Admitted</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {pageGuests.map((g) => (
                        <tr key={g.id} className={`hover:bg-gray-50 dark:hover:bg-slate-700 ${selectedGuests.has(g.id) ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : ''}`}>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedGuests.has(g.id)}
                              onChange={() => toggleSelectGuest(g.id)}
                              className="cursor-pointer"
                              aria-label={`Select ${g.first_name} ${g.last_name}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-medium dark:text-slate-100">{g.first_name} {g.last_name}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">{g.email}</td>
                          <td className="px-4 py-3 text-center"><Badge on={!!g.qr_generated_at} labels={['Ready', 'Pending']} /></td>
                          <td className="px-4 py-3 text-center"><Badge on={!!g.invite_sent_at} labels={['Sent', 'Unsent']} /></td>
                          <td className="px-4 py-3 text-center">
                            {g.admitted
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                  {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Yes'}
                                </span>
                              : <Badge on={false} labels={['', 'Pending']} />}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-3">
                              {g.qr_generated_at && (
                                <a href={api.guestQrUrl(selectedId, g.id)} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-indigo-600 hover:underline">QR</a>
                              )}
                              {g.qr_generated_at && !g.admitted && (
                                <button onClick={() => handleResendInvite(g.id)} disabled={loading}
                                  className="text-xs text-amber-600 hover:underline disabled:opacity-40">Resend</button>
                              )}
                              <button onClick={() => handleDeleteGuest(g.id)} disabled={loading}
                                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-gray-100 dark:divide-slate-700">
                  {pageGuests.map((g) => (
                    <div key={g.id} className={`px-4 py-4 space-y-2 ${selectedGuests.has(g.id) ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedGuests.has(g.id)}
                            onChange={() => toggleSelectGuest(g.id)}
                            className="mt-1 cursor-pointer"
                            aria-label={`Select ${g.first_name} ${g.last_name}`}
                          />
                          <div>
                            <div className="font-semibold text-sm dark:text-slate-100">{g.first_name} {g.last_name}</div>
                            <div className="text-xs text-gray-500 dark:text-slate-400 break-all">{g.email}</div>
                          </div>
                        </div>
                        {g.admitted && (
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            ✓ {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge on={!!g.qr_generated_at} labels={['QR Ready', 'No QR']} />
                        <Badge on={!!g.invite_sent_at} labels={['Invited', 'Unsent']} />
                      </div>
                      <div className="flex gap-4 pt-1">
                        {g.qr_generated_at && (
                          <a href={api.guestQrUrl(selectedId, g.id)} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-indigo-600 hover:underline">View QR</a>
                        )}
                        {g.qr_generated_at && !g.admitted && (
                          <button onClick={() => handleResendInvite(g.id)} disabled={loading}
                            className="text-xs text-amber-600 hover:underline disabled:opacity-40">Resend invite</button>
                        )}
                        <button onClick={() => handleDeleteGuest(g.id)} disabled={loading}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 ml-auto">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* User management — always visible to admins */}
      <UsersPanel />

      {/* Server resource monitoring */}
      <ServerHealthPanel />
    </div>
  )
}
