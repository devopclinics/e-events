import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

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

function ChannelToggles({ event, onChanged }) {
  const [loading, setLoading]   = useState(false)
  const [testing, setTesting]   = useState(null)        // channel currently being tested
  const [testMsg, setTestMsg]   = useState('')          // success / error banner
  async function toggle(key) {
    setLoading(true)
    try {
      const updated = await api.toggleFeatures(event.id, { [key]: !event[key] })
      onChanged(updated)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }
  async function sendTest(channel) {
    const phone = prompt(`Send a test ${channel.toUpperCase()} to which number?\n(US 10-digit or full E.164 e.g. +18327941707)`)
    if (!phone || !phone.trim()) return
    setTesting(channel); setTestMsg('')
    try {
      const res = await api.sendTestMessage(event.id, channel, phone.trim())
      setTestMsg(`✓ Test ${channel} sent to ${res.to}`)
      setTimeout(() => setTestMsg(''), 6000)
    } catch (e) { setTestMsg(`✗ ${e.message}`) }
    finally { setTesting(null) }
  }
  const channels = [
    { key: 'notify_email',    label: 'Email',    icon: '✉', test: null },
    { key: 'notify_sms',      label: 'SMS',      icon: '📱', test: 'sms' },
    { key: 'notify_whatsapp', label: 'WhatsApp', icon: '💬', test: 'whatsapp' },
  ]
  return (
    <div className="pt-3 border-t dark:border-slate-700 mt-3 space-y-2">
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Notify on:</span>
        {channels.map(({ key, label, icon, test }) => (
          <div key={key} className="flex items-center gap-1">
            <button onClick={() => toggle(key)} disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                event[key]
                  ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                  : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
              }`}>
              {icon} {label} {event[key] ? 'ON' : 'OFF'}
            </button>
            {test && (
              <button
                onClick={() => sendTest(test)}
                disabled={testing === test}
                title={`Send a test ${test.toUpperCase()} to verify provider creds`}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                {testing === test ? '…sending' : 'test'}
              </button>
            )}
          </div>
        ))}
      </div>
      {testMsg && (
        <div className={`text-xs px-2 py-1 rounded inline-block ${testMsg.startsWith('✓')
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
          {testMsg}
        </div>
      )}
      <p className="text-[10px] text-gray-400 dark:text-slate-500 italic">
        SMS / WhatsApp need a phone number on each guest + provider creds in .env
      </p>
    </div>
  )
}

function FeatureToggles({ event, onChanged }) {
  const [loading, setLoading] = useState(false)

  const [err, setErr] = useState('')
  const locked = !event.is_paid   // seating/menu are paid-plan features

  async function toggle(key) {
    if (locked) { setErr('Seating and menu require an Event Pass — upgrade this event first.'); return }
    setLoading(true); setErr('')
    try {
      const updated = await api.toggleFeatures(event.id, { [key]: !event[key] })
      onChanged(updated)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex flex-wrap gap-3 pt-3 border-t dark:border-slate-700 mt-3">
      <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 self-center">Features:</span>
      {[
        { key: 'seating_enabled', label: 'Seating' },
        { key: 'menu_enabled',    label: 'Menu' },
        { key: 'logistics_enabled', label: 'Logistics' },
        { key: 'registry_enabled', label: 'Registry' },
        { key: 'venue_access_enabled', label: 'Access' },
      ].map(({ key, label }) => (
        <button
          key={key}
          onClick={() => toggle(key)}
          disabled={loading || locked}
          title={locked ? 'Requires an Event Pass' : ''}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
            event[key]
              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
              : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          }`}
        >
          {label} {event[key] ? 'ON' : 'OFF'}{locked ? ' 🔒' : ''}
        </button>
      ))}
      {err && <span className="text-xs text-amber-600 dark:text-amber-400 self-center">{err}</span>}
    </div>
  )
}

// ── Seating Panel ─────────────────────────────────────────────────────────────

function VipBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ${className}`}
      title="VVIP">
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118L10 13.347l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L3.567 7.819c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      VIP
    </span>
  )
}

// Preset seating categories. The form's input is free-text backed by these
// suggestions, so organizers can also type a custom label (e.g. "Sponsors").
const TABLE_CATEGORIES = ['General', 'Male', 'Female', 'Kids', 'Youth', 'Couples', 'VIP', 'Family', 'Staff']

function CategoryBadge({ value, className = '' }) {
  if (!value) return null
  const c = String(value).toLowerCase()
  const tone =
    c === 'male'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    : c === 'female' ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300'
    : c === 'kids'   ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    : c === 'youth'  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : c === 'vip'    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
    : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200'
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${tone} ${className}`}>
      {value}
    </span>
  )
}

function SeatingPanel({ eventId }) {
  const [tables, setTables]       = useState([])
  const [chart, setChart]         = useState(null)
  const [showChart, setShowChart] = useState(false)
  const [form, setForm]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState('')
  // Reserve modal — when admin clicks an empty seat we open a guest picker.
  const [assignSlot, setAssignSlot] = useState(null)  // {tableId, tableName, seat}
  const [allGuests, setAllGuests]   = useState([])
  const [guestQuery, setGuestQuery] = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  useEffect(() => {
    api.listTables(eventId).then(setTables).catch(console.error)
  }, [eventId])

  async function loadChart() {
    const [chartData, guestData] = await Promise.all([
      api.getSeatingChart(eventId),
      api.listGuests(eventId),
    ])
    setChart(chartData)
    setAllGuests(guestData)
    setShowChart(true)
  }

  async function reserveSeat(guestId) {
    if (!assignSlot) return
    setLoading(true)
    try {
      await api.assignSeat(eventId, guestId, {
        table_id: assignSlot.tableId,
        seat_number: String(assignSlot.seat),
      })
      setAssignSlot(null)
      setGuestQuery('')
      const [chartData, guestData, tableData] = await Promise.all([
        api.getSeatingChart(eventId),
        api.listGuests(eventId),
        api.listTables(eventId),
      ])
      setChart(chartData); setAllGuests(guestData); setTables(tableData)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function addVvipAndReserve(vvip) {
    if (!assignSlot) return
    setLoading(true)
    try {
      const created = await api.addGuest(eventId, vvip)
      await api.assignSeat(eventId, created.id, {
        table_id: assignSlot.tableId,
        seat_number: String(assignSlot.seat),
      })
      setAssignSlot(null); setGuestQuery('')
      const [chartData, guestData, tableData] = await Promise.all([
        api.getSeatingChart(eventId),
        api.listGuests(eventId),
        api.listTables(eventId),
      ])
      setChart(chartData); setAllGuests(guestData); setTables(tableData)
      setMsg(`${created.first_name} ${created.last_name} added & seated.`)
      setTimeout(() => setMsg(''), 4000)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function unassignSeat(guestId) {
    if (!confirm('Remove this guest from their seat?')) return
    setLoading(true)
    try {
      await api.assignSeat(eventId, guestId, { table_id: null, seat_number: null })
      const [chartData, guestData, tableData] = await Promise.all([
        api.getSeatingChart(eventId),
        api.listGuests(eventId),
        api.listTables(eventId),
      ])
      setChart(chartData); setAllGuests(guestData); setTables(tableData)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function saveTable(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { name: form.name, capacity: Number(form.capacity), category: form.category?.trim() || null }
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
          <button onClick={() => setForm({ name: '', capacity: 10, category: '' })} disabled={loading}
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
                <th className="px-4 py-2 text-center">Category</th>
                <th className="px-4 py-2 text-center">Capacity</th>
                <th className="px-4 py-2 text-center">Assigned</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {tables.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">{t.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    {t.category ? <CategoryBadge value={t.category} /> : <span className="text-xs text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center dark:text-slate-300">{t.capacity}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold ${t.assigned_count >= t.capacity ? 'text-red-500' : 'text-green-600'}`}>
                      {t.assigned_count}/{t.capacity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-3">
                      <button onClick={() => setForm({ id: t.id, name: t.name, capacity: t.capacity, category: t.category || '' })}
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Category</label>
            <input list="table-category-list" value={form.category || ''}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className={`${fieldCls} w-44`} placeholder="General · or type your own" />
            <datalist id="table-category-list">
              {TABLE_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
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
                    <span className="text-sm font-semibold dark:text-white flex items-center gap-2">
                      {t.name}
                      <CategoryBadge value={t.category} />
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {t.seats.filter((s) => s.guest_id).length}/{t.capacity}
                    </span>
                  </div>
                  <div className="divide-y dark:divide-slate-700 max-h-64 overflow-y-auto">
                    {t.seats.map((s) => (
                      <button
                        key={s.seat}
                        type="button"
                        onClick={() => s.guest_id
                          ? unassignSeat(s.guest_id)
                          : setAssignSlot({ tableId: t.id, tableName: t.name, seat: s.seat })}
                        className={`w-full px-3 py-1.5 flex items-center gap-2 text-sm text-left transition-colors ${
                          s.guest_id
                            ? 'hover:bg-rose-50 dark:hover:bg-rose-900/20'
                            : 'hover:bg-teal-50 dark:hover:bg-teal-900/20'
                        }`}
                        title={s.guest_id ? 'Click to unassign' : 'Click to reserve for a guest'}
                      >
                        <span className="w-6 text-xs font-mono text-gray-400 dark:text-slate-500 shrink-0">{s.seat}</span>
                        {s.guest_id ? (
                          <>
                            <span className="flex-1 dark:text-slate-200 truncate">{s.name}</span>
                            {s.is_vip && <VipBadge />}
                            {s.admitted && <span className="text-xs text-green-600 shrink-0" title="Arrived">✓</span>}
                            {s.meal_served && <span className="text-xs text-amber-600 shrink-0" title="Meal served">🍽</span>}
                          </>
                        ) : (
                          <span className="flex-1 text-xs italic text-teal-600 dark:text-teal-400">+ reserve</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-sm text-indigo-600">{msg}</p>}

      {assignSlot && (
        <ReserveSeatModal
          slot={assignSlot}
          guests={allGuests}
          loading={loading}
          query={guestQuery}
          onQuery={setGuestQuery}
          onPick={reserveSeat}
          onAddVvip={addVvipAndReserve}
          onClose={() => { setAssignSlot(null); setGuestQuery('') }}
        />
      )}
    </div>
  )
}

function ReserveSeatModal({ slot, guests, loading, query, onQuery, onPick, onAddVvip, onClose }) {
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
      last_name:  vvip.last_name.trim(),
      email:      vvip.email.trim(),
      phone:      vvip.phone.trim() || null,
      is_vip:     true,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 dark:border dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">Reserve seat</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <strong>{slot.tableName}</strong> · Seat <strong>{slot.seat}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="flex gap-1 px-4 pt-3 border-b dark:border-slate-700">
          <button onClick={() => setMode('search')}
            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px ${
              mode === 'search' ? 'border-teal-500 text-teal-700 dark:text-teal-300' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}>From guest list</button>
          <button onClick={() => setMode('vvip')}
            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px ${
              mode === 'vvip' ? 'border-purple-500 text-purple-700 dark:text-purple-300' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}>+ Add VVIP</button>
        </div>

        {mode === 'search' && <>
          <div className="p-4">
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border-t dark:border-slate-700">
            {matches.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-400 dark:text-slate-500 italic">
                No guests match. Use <button onClick={() => setMode('vvip')} className="text-purple-600 hover:underline font-semibold">+ Add VVIP</button> instead.
              </div>
            )}
            {matches.map((g) => {
              const alreadyAssigned = g.table_id != null
              return (
                <button key={g.id}
                  onClick={() => onPick(g.id)}
                  disabled={loading}
                  className="w-full px-4 py-2.5 text-left hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-50 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {g.first_name} {g.last_name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{g.email || <em>no email</em>}</div>
                  </div>
                  {alreadyAssigned ? (
                    <span className="text-[10px] uppercase font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full">
                      move from seat {g.seat_number ?? '–'}
                    </span>
                  ) : g.admitted ? (
                    <span className="text-[10px] uppercase font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                      arrived
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </>}

        {mode === 'vvip' && (
          <form onSubmit={submitVvip} className="p-4 space-y-3 overflow-y-auto">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add someone who isn't on the imported guest list. Email is optional — no invite will be sent.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input autoFocus required value={vvip.first_name} onChange={(e) => setVvip((v) => ({ ...v, first_name: e.target.value }))}
                placeholder="First name *"
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <input required value={vvip.last_name} onChange={(e) => setVvip((v) => ({ ...v, last_name: e.target.value }))}
                placeholder="Last name *"
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            </div>
            <input type="email" value={vvip.email} onChange={(e) => setVvip((v) => ({ ...v, email: e.target.value }))}
              placeholder="Email (optional)"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            <input value={vvip.phone} onChange={(e) => setVvip((v) => ({ ...v, phone: e.target.value }))}
              placeholder="Phone E.164 (optional, e.g. +447911123456)"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            <button type="submit" disabled={loading || !vvip.first_name.trim() || !vvip.last_name.trim()}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50">
              {loading ? 'Saving…' : `Reserve ${slot.tableName} · Seat ${slot.seat}`}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Menu Panel ────────────────────────────────────────────────────────────────

const SELECTION_TYPES = [
  { value: 'single', label: 'Single (pick 1)' },
  { value: 'multi',  label: 'Multi (pick several)' },
  { value: 'combo',  label: 'Combo (preset sets)' },
]

function CombinationsSection({ eventId, cat, loading, setLoading, onCatsChange, setMsg }) {
  const [form, setForm] = useState(null)

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const combos = cat.combinations || []

  function openNew() {
    setForm({
      name: '',
      description: '',
      sort_order: combos.length,
      items: Object.fromEntries(cat.items.map((i) => [i.id, { checked: false, quantity: 1 }])),
    })
  }

  function openEdit(c) {
    const items = Object.fromEntries(cat.items.map((i) => [i.id, { checked: false, quantity: 1 }]))
    for (const ci of c.items || []) {
      items[ci.menu_item_id] = { checked: true, quantity: ci.quantity || 1 }
    }
    setForm({ id: c.id, name: c.name, description: c.description || '', sort_order: c.sort_order ?? 0, items })
  }

  async function save(e) {
    e.preventDefault()
    const items = Object.entries(form.items)
      .filter(([, v]) => v.checked)
      .map(([menu_item_id, v]) => ({ menu_item_id, quantity: Number(v.quantity) || 1 }))
    if (items.length === 0) {
      setMsg('Pick at least one item for the combination.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        name: form.name,
        description: form.description || '',
        sort_order: Number(form.sort_order) || 0,
        items,
      }
      if (form.id) {
        const updated = await api.updateCombination(eventId, form.id, payload)
        onCatsChange((prev) => prev.map((c) =>
          c.id === cat.id
            ? { ...c, combinations: (c.combinations || []).map((x) => x.id === form.id ? updated : x) }
            : c
        ))
      } else {
        const created = await api.createCombination(eventId, cat.id, payload)
        onCatsChange((prev) => prev.map((c) =>
          c.id === cat.id
            ? { ...c, combinations: [...(c.combinations || []), created] }
            : c
        ))
      }
      setForm(null)
    } catch (err) { setMsg(err.message) }
    finally { setLoading(false) }
  }

  async function remove(comboId) {
    if (!confirm('Delete this combination?')) return
    setLoading(true)
    try {
      await api.deleteCombination(eventId, comboId)
      onCatsChange((prev) => prev.map((c) =>
        c.id === cat.id
          ? { ...c, combinations: (c.combinations || []).filter((x) => x.id !== comboId) }
          : c
      ))
    } catch (err) { setMsg(err.message) }
    finally { setLoading(false) }
  }

  const itemName = (id) => cat.items.find((i) => i.id === id)?.name || '—'

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Combinations</div>
        <button
          type="button"
          onClick={openNew}
          disabled={loading || cat.items.length === 0}
          className="text-xs text-green-600 hover:underline font-semibold disabled:opacity-40"
        >
          + Add combination
        </button>
      </div>

      {cat.items.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">
          Add items to this category first (use the items list above… or temporarily switch type to Single).
        </p>
      )}

      {combos.length === 0 && cat.items.length > 0 && !form && (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">No combinations yet.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {combos.map((c) => (
          <div key={c.id} className="border dark:border-slate-700 rounded-lg p-3 bg-white dark:bg-slate-800">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold dark:text-slate-100 truncate">{c.name}</div>
                {c.description && (
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{c.description}</div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => openEdit(c)}
                  className="text-xs text-indigo-600 hover:underline">Edit</button>
                <button type="button" onClick={() => remove(c.id)} disabled={loading}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5">
              {(c.items || []).map((ci, idx) => (
                <li key={idx} className="text-xs text-gray-600 dark:text-slate-300 flex justify-between gap-2">
                  <span className="truncate">{itemName(ci.menu_item_id)}</span>
                  <span className="text-gray-400 dark:text-slate-500 shrink-0">× {ci.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {form && (
        <form onSubmit={save} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Name</label>
              <input value={form.name} required onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={fieldCls} placeholder="VIP Package" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Sort Order</label>
              <input type="number" value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                className={`${fieldCls} w-24`} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description</label>
            <input value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={fieldCls} placeholder="Optional" />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Items in this combo</div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {cat.items.map((it) => {
                const row = form.items[it.id] || { checked: false, quantity: 1 }
                return (
                  <div key={it.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        items: { ...f.items, [it.id]: { ...row, checked: e.target.checked } },
                      }))}
                      className="cursor-pointer"
                    />
                    <span className="text-sm dark:text-slate-200 flex-1 truncate">{it.name}</span>
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      disabled={!row.checked}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        items: { ...f.items, [it.id]: { ...row, quantity: e.target.value } },
                      }))}
                      className={`${fieldCls} w-20 disabled:opacity-40`}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {form.id ? 'Save' : 'Add'}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Logistics Panel ───────────────────────────────────────────────────────────

const SHIP_STATUS = ['pending', 'shipped', 'delivered']

function LogisticsPanel({ eventId }) {
  const [shipments, setShipments] = useState([])
  const [form, setForm]           = useState(null)   // create/edit shipment form
  const [activeId, setActiveId]   = useState(null)   // shipment whose lines are shown
  const [lines, setLines]         = useState([])
  const [rowEdit, setRowEdit]     = useState({})     // guest_id -> editable buffer
  const [pickerOpen, setPickerOpen] = useState(false)
  const [allGuests, setAllGuests] = useState([])
  const [guestQuery, setGuestQuery] = useState('')
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function load() {
    api.listShipments(eventId).then(setShipments).catch((e) => setMsg(e.message))
  }
  useEffect(() => { load() }, [eventId])

  async function loadLines(sid) {
    setLoading(true)
    try {
      const data = await api.listShipmentLines(eventId, sid)
      setLines(data); setActiveId(sid); setRowEdit({})
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function saveShipment(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        name: form.name,
        phase: form.phase,
        collect_size: form.collect_size,
        auto_add: form.auto_add,
        size_options: (form.size_options || '').split(',').map((s) => s.trim()).filter(Boolean),
        notes: form.notes || null,
        vendor_name: form.vendor_name || null,
        vendor_email: form.vendor_email || null,
        vendor_phone: form.vendor_phone || null,
      }
      if (form.id) await api.updateShipment(eventId, form.id, payload)
      else await api.createShipment(eventId, payload)
      setForm(null); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function removeShipment(sid) {
    if (!confirm('Delete this shipment and all its guest lines?')) return
    setLoading(true)
    try {
      await api.deleteShipment(eventId, sid)
      if (activeId === sid) { setActiveId(null); setLines([]) }
      load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function populate(sid) {
    setLoading(true)
    try {
      const res = await api.populateShipment(eventId, sid)
      flash(`Added ${res.added} confirmed guest(s).`)
      await loadLines(sid); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function openPicker() {
    try {
      const gs = await api.listGuests(eventId)
      setAllGuests(gs); setGuestQuery(''); setPickerOpen(true)
    } catch (e) { setMsg(e.message) }
  }

  async function addGuest(gid) {
    try {
      await api.addShipmentGuest(eventId, activeId, gid)
      await loadLines(activeId); load()
    } catch (e) { setMsg(e.message) }
  }

  async function removeGuest(gid) {
    if (!confirm('Remove this guest from the shipment?')) return
    setLoading(true)
    try {
      await api.removeShipmentGuest(eventId, activeId, gid)
      await loadLines(activeId); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function sendToVendor(s) {
    if (!s.vendor_email) { setMsg('Add a vendor email to this shipment first (Edit).'); return }
    if (!confirm(`Email the shipping list to ${s.vendor_email}?`)) return
    setLoading(true)
    try {
      await api.sendShipmentToVendor(eventId, s.id)
      flash(`Sent to ${s.vendor_email}.`); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  function copyVendorLink(s) {
    const url = `${window.location.origin}/vendor/${s.share_token}`
    navigator.clipboard?.writeText(url)
    flash('Vendor link copied to clipboard.')
  }

  async function saveRow(gid) {
    const buf = rowEdit[gid]
    if (!buf) return
    setLoading(true)
    try {
      await api.updateShipmentLine(eventId, activeId, gid, {
        item: buf.item || null,
        size: buf.size ?? null,
        quantity: Number(buf.quantity) || 1,
        ship_status: buf.ship_status,
        tracking_number: buf.tracking_number || null,
      })
      await api.updateGuestShipping(eventId, gid, {
        ship_address1: buf.ship_address1 || null,
        ship_address2: buf.ship_address2 || null,
        ship_city: buf.ship_city || null,
        ship_state: buf.ship_state || null,
        ship_postal: buf.ship_postal || null,
        ship_country: buf.ship_country || null,
      })
      setRowEdit((p) => { const n = { ...p }; delete n[gid]; return n })
      await loadLines(activeId)
      flash('Saved.')
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  const editRow = (ln) => setRowEdit((p) => ({ ...p, [ln.guest_id]: { ...ln } }))
  const setBuf = (gid, k, v) => setRowEdit((p) => ({ ...p, [gid]: { ...p[gid], [k]: v } }))
  const addrText = (ln) => [ln.ship_address1, ln.ship_address2, ln.ship_city, ln.ship_state, ln.ship_postal, ln.ship_country].filter(Boolean).join(', ')

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">📦 Logistics</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Collect shipping addresses & sizes, then hand a packing list to your vendor. Guests enter their address on the RSVP page.
          </p>
        </div>
        <button onClick={() => setForm({ name: '', phase: 'pre', collect_size: true, auto_add: true, size_options: 'S, M, L, XL, 2XL', notes: '', vendor_name: '', vendor_email: '', vendor_phone: '' })}
          disabled={loading}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
          + New shipment
        </button>
      </div>

      {shipments.length === 0 && !form && (
        <p className="text-sm text-gray-400 dark:text-slate-500">No shipments yet. Create one for pre-event merchandise (e.g. aso-ebi) or a post-event gift.</p>
      )}

      {/* Shipment cards */}
      <div className="space-y-3">
        {shipments.map((s) => (
          <div key={s.id} className="border dark:border-slate-700 rounded-lg p-3">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm dark:text-white">{s.name}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.phase === 'post' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'}`}>
                    {s.phase === 'post' ? 'Post-event' : 'Pre-event'}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">{s.line_count} guest(s)</span>
                </div>
                <div className="text-xs text-gray-400 dark:text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {s.vendor_email ? <span>Vendor: {s.vendor_email}</span> : <span className="text-amber-500">No vendor email set</span>}
                  {s.sent_at && <span className="text-green-600">✓ Sent {new Date(s.sent_at).toLocaleDateString()}</span>}
                  {s.viewed_at && <span className="text-blue-500">👁 Viewed {new Date(s.viewed_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button onClick={() => (activeId === s.id ? (setActiveId(null), setLines([])) : loadLines(s.id))}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline">{activeId === s.id ? 'Hide list' : 'Manage list'}</button>
                <button onClick={() => api.downloadShipmentXlsx(eventId, s.id, `${s.name}.xlsx`).catch((e) => setMsg(e.message))}
                  className="text-teal-600 hover:underline">Download Excel</button>
                <button onClick={() => copyVendorLink(s)} className="text-slate-500 hover:underline">Copy vendor link</button>
                <button onClick={() => sendToVendor(s)} className="text-blue-600 hover:underline">Send to vendor</button>
                <button onClick={() => setForm({ id: s.id, name: s.name, phase: s.phase, collect_size: s.collect_size, auto_add: s.auto_add, size_options: (s.size_options || []).join(', '), notes: s.notes || '', vendor_name: s.vendor_name || '', vendor_email: s.vendor_email || '', vendor_phone: s.vendor_phone || '' })}
                  className="text-gray-500 hover:underline">Edit</button>
                <button onClick={() => removeShipment(s.id)} className="text-red-400 hover:text-red-600">Delete</button>
              </div>
            </div>

            {/* Per-guest lines */}
            {activeId === s.id && (
              <div className="mt-3 border-t dark:border-slate-700 pt-3">
                <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Recipients</span>
                  <div className="flex gap-2">
                    <button onClick={openPicker} disabled={loading}
                      className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/60">+ Add guest</button>
                    <button onClick={() => populate(s.id)} disabled={loading}
                      className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 dark:text-slate-200">+ Add all confirmed</button>
                  </div>
                </div>
                {lines.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500">No recipients yet. Use "+ Add guest" to hand-pick, "+ Add all confirmed" for everyone{s.auto_add ? ', or they appear automatically when guests RSVP with an address.' : '.'}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-500 dark:text-slate-400 text-left">
                        <tr><th className="py-1 pr-2">Guest</th><th className="py-1 pr-2">Address</th><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Size</th><th className="py-1 pr-2">Qty</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Tracking</th><th></th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700 align-top">
                        {lines.map((ln) => {
                          const buf = rowEdit[ln.guest_id]
                          return (
                            <tr key={ln.guest_id}>
                              <td className="py-1.5 pr-2 dark:text-slate-200 whitespace-nowrap">{ln.first_name} {ln.last_name}</td>
                              {buf ? (
                                <>
                                  <td className="py-1.5 pr-2 space-y-1">
                                    <input className={`${fieldCls} w-full py-1`} placeholder="Address" value={buf.ship_address1 || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_address1', e.target.value)} />
                                    <div className="flex gap-1">
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="City" value={buf.ship_city || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_city', e.target.value)} />
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="State" value={buf.ship_state || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_state', e.target.value)} />
                                    </div>
                                    <div className="flex gap-1">
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="Postal" value={buf.ship_postal || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_postal', e.target.value)} />
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="Country" value={buf.ship_country || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_country', e.target.value)} />
                                    </div>
                                  </td>
                                  <td className="py-1.5 pr-2"><input className={`${fieldCls} w-28 py-1`} placeholder={s.name} value={buf.item || ''} onChange={(e) => setBuf(ln.guest_id, 'item', e.target.value)} /></td>
                                  <td className="py-1.5 pr-2"><input className={`${fieldCls} w-16 py-1`} value={buf.size || ''} onChange={(e) => setBuf(ln.guest_id, 'size', e.target.value)} /></td>
                                  <td className="py-1.5 pr-2"><input type="number" min="1" className={`${fieldCls} w-14 py-1`} value={buf.quantity || 1} onChange={(e) => setBuf(ln.guest_id, 'quantity', e.target.value)} /></td>
                                  <td className="py-1.5 pr-2">
                                    <select className={`${fieldCls} py-1`} value={buf.ship_status} onChange={(e) => setBuf(ln.guest_id, 'ship_status', e.target.value)}>
                                      {SHIP_STATUS.map((st) => <option key={st} value={st}>{st}</option>)}
                                    </select>
                                  </td>
                                  <td className="py-1.5 pr-2"><input className={`${fieldCls} w-28 py-1`} value={buf.tracking_number || ''} onChange={(e) => setBuf(ln.guest_id, 'tracking_number', e.target.value)} /></td>
                                  <td className="py-1.5 whitespace-nowrap">
                                    <button onClick={() => saveRow(ln.guest_id)} className="text-green-600 hover:underline mr-2">Save</button>
                                    <button onClick={() => setRowEdit((p) => { const n = { ...p }; delete n[ln.guest_id]; return n })} className="text-gray-400 hover:underline">Cancel</button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className={`py-1.5 pr-2 max-w-xs ${ln.has_address ? 'dark:text-slate-300' : 'text-amber-500 italic'}`}>{ln.has_address ? addrText(ln) : 'No address yet'}</td>
                                  <td className={`py-1.5 pr-2 ${ln.item ? 'dark:text-slate-300' : 'text-gray-400 dark:text-slate-500'}`}>{ln.item || s.name}</td>
                                  <td className="py-1.5 pr-2 dark:text-slate-300">{ln.size || '—'}</td>
                                  <td className="py-1.5 pr-2 dark:text-slate-300">{ln.quantity}</td>
                                  <td className="py-1.5 pr-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ln.ship_status === 'delivered' ? 'bg-green-100 text-green-700' : ln.ship_status === 'shipped' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200'}`}>{ln.ship_status}</span>
                                  </td>
                                  <td className="py-1.5 pr-2 dark:text-slate-300">{ln.tracking_number || '—'}</td>
                                  <td className="py-1.5 whitespace-nowrap">
                                    <button onClick={() => editRow(ln)} className="text-indigo-600 dark:text-indigo-400 hover:underline mr-2">Edit</button>
                                    <button onClick={() => removeGuest(ln.guest_id)} className="text-red-400 hover:text-red-600">Remove</button>
                                  </td>
                                </>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create / edit shipment form */}
      {form && (
        <form onSubmit={saveShipment} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Shipment name *</label>
              <input className={`${fieldCls} w-full`} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Aso-Ebi Cloth / Thank-you Gift" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">When</label>
              <select className={`${fieldCls} w-full`} value={form.phase} onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value }))}>
                <option value="pre">Pre-event (collect on RSVP)</option>
                <option value="post">Post-event (gift after)</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={form.collect_size} onChange={(e) => setForm((f) => ({ ...f, collect_size: e.target.checked }))} />
              Ask guests for a size
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={form.auto_add} onChange={(e) => setForm((f) => ({ ...f, auto_add: e.target.checked }))} />
              Auto-add guests who RSVP
              <span className="font-normal text-gray-400 dark:text-slate-500">(off = hand-pick the list)</span>
            </label>
          </div>
          {form.collect_size && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Size options (comma-separated)</label>
              <input className={`${fieldCls} w-full`} value={form.size_options} onChange={(e) => setForm((f) => ({ ...f, size_options: e.target.value }))} placeholder="S, M, L, XL, 2XL" />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Vendor name</label>
              <input className={`${fieldCls} w-full`} value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Vendor email</label>
              <input type="email" className={`${fieldCls} w-full`} value={form.vendor_email} onChange={(e) => setForm((f) => ({ ...f, vendor_email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Vendor phone</label>
              <input className={`${fieldCls} w-full`} value={form.vendor_phone} onChange={(e) => setForm((f) => ({ ...f, vendor_phone: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Notes for vendor</label>
            <textarea className={`${fieldCls} w-full`} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Delivery instructions, deadlines, etc." />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{form.id ? 'Save' : 'Create'}</button>
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
          </div>
        </form>
      )}

      {msg && <p className="text-sm text-indigo-600 dark:text-indigo-400">{msg}</p>}

      {/* Add-guest picker */}
      {pickerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b dark:border-slate-700">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-sm dark:text-white">Add a guest to this shipment</h3>
                <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>
              <input autoFocus className={`${fieldCls} w-full`} placeholder="Search guests…" value={guestQuery} onChange={(e) => setGuestQuery(e.target.value)} />
            </div>
            <div className="overflow-y-auto p-2">
              {(() => {
                const onList = new Set(lines.map((l) => l.guest_id))
                const q = guestQuery.trim().toLowerCase()
                const available = allGuests.filter((g) => !onList.has(g.id) &&
                  (!q || `${g.first_name} ${g.last_name} ${g.email || ''}`.toLowerCase().includes(q)))
                if (available.length === 0) return <p className="text-xs text-gray-400 p-3">No matching guests (everyone may already be on the list).</p>
                return available.slice(0, 100).map((g) => (
                  <button key={g.id} onClick={() => addGuest(g.id)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-700 flex justify-between items-center">
                    <span className="text-sm dark:text-slate-200">{g.first_name} {g.last_name}</span>
                    <span className="text-xs text-gray-400">{g.email || g.phone || ''}</span>
                  </button>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Registry Panel ────────────────────────────────────────────────────────────

// Reuses the existing module-level `fmtMoney(minorAmount, currency)` (hoisted).
const toMinor = (major) => {
  const n = parseFloat(major)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

const REGISTRY_KINDS = [
  { value: 'item', label: 'Gift item' },
  { value: 'fund', label: 'Cash fund' },
  { value: 'link', label: 'External registry link' },
]

function RegistryPanel({ eventId, event }) {
  const [items, setItems]     = useState([])
  const [claims, setClaims]   = useState([])
  const [showClaims, setShowClaims] = useState(false)
  const [form, setForm]       = useState(null)
  const [message, setMessage] = useState(event?.registry_message || '')
  const [token, setToken]     = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function load() {
    api.listRegistryItems(eventId).then(setItems).catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
    api.getRegistrySettings(eventId)
      .then((s) => { setToken(s.registry_token || ''); if (s.registry_message != null) setMessage(s.registry_message) })
      .catch((e) => setMsg(e.message))
  }, [eventId])

  async function saveMessage() {
    try {
      await api.updateRegistrySettings(eventId, { registry_message: message })
      flash('Intro message saved.')
    } catch (e) { setMsg(e.message) }
  }

  async function fetchDetails() {
    if (!form.external_url) { setMsg('Paste a product link first.'); return }
    setLoading(true)
    try {
      const d = await api.unfurlRegistryLink(eventId, form.external_url)
      setForm((f) => ({
        ...f,
        title: f.title || d.title || '',
        image_url: f.image_url || d.image_url || '',
        amountMajor: f.amountMajor || (d.amount_minor != null ? String(d.amount_minor / 100) : ''),
        currency: d.currency || f.currency,
      }))
      const nothing = !d.title && !d.image_url && d.amount_minor == null
      flash(nothing ? 'No details found — please fill them in manually.' : 'Details fetched — review and edit as needed.')
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function saveItem(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        kind: form.kind,
        title: form.title,
        description: form.description || null,
        image_url: form.image_url || null,
        external_url: form.external_url || null,
        amount_minor: form.amountMajor ? toMinor(form.amountMajor) : null,
        currency: form.currency || 'USD',
        quantity_wanted: Number(form.quantity_wanted) || 1,
        payment_instructions: form.payment_instructions || null,
      }
      if (form.id) await api.updateRegistryItem(eventId, form.id, payload)
      else await api.createRegistryItem(eventId, payload)
      setForm(null); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function removeItem(id) {
    if (!confirm('Delete this registry entry?')) return
    setLoading(true)
    try { await api.deleteRegistryItem(eventId, id); load() }
    catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function loadClaims() {
    try { setClaims(await api.listRegistryClaims(eventId)); setShowClaims(true) }
    catch (e) { setMsg(e.message) }
  }

  const openNew = () => setForm({ kind: 'item', title: '', description: '', image_url: '', external_url: '', amountMajor: '', currency: 'USD', quantity_wanted: 1, payment_instructions: '' })
  const openEdit = (it) => setForm({
    id: it.id, kind: it.kind, title: it.title, description: it.description || '',
    image_url: it.image_url || '', external_url: it.external_url || '',
    amountMajor: it.amount_minor != null ? String(it.amount_minor / 100) : '',
    currency: it.currency || 'USD', quantity_wanted: it.quantity_wanted || 1,
    payment_instructions: it.payment_instructions || '',
  })

  const registryUrl = token ? `${window.location.origin}/registry/${token}` : ''

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">🎁 Gift Registry</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Mark-only — guests buy from your links or send cash to your own details. No money passes through EventQR.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { if (!registryUrl) return flash('Preparing link…'); navigator.clipboard?.writeText(registryUrl); flash('Registry link copied.') }}
            className="text-xs border border-gray-300 dark:border-slate-600 px-3 py-1.5 rounded-lg dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">Copy registry link</button>
          <button onClick={() => (showClaims ? setShowClaims(false) : loadClaims())}
            className="text-xs border border-gray-300 dark:border-slate-600 px-3 py-1.5 rounded-lg dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">{showClaims ? 'Hide claims' : 'Claims & pledges'}</button>
          <button onClick={openNew} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">+ Add entry</button>
        </div>
      </div>

      {/* Intro message */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Intro message (shown atop your registry)</label>
          <input className={`${fieldCls} w-full`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your presence is the greatest gift — but if you'd like to give…" />
        </div>
        <button onClick={saveMessage} className="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">Save</button>
      </div>

      {/* Claims view */}
      {showClaims && (
        <div className="border dark:border-slate-700 rounded-lg p-3">
          <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2">Who's giving what</div>
          {claims.length === 0 ? <p className="text-xs text-gray-400">No reservations or pledges yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 dark:text-slate-400 text-left"><tr><th className="py-1 pr-2">Guest</th><th className="py-1 pr-2">Gift</th><th className="py-1 pr-2">Qty / Amount</th><th className="py-1 pr-2">Message</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {claims.map((c) => (
                    <tr key={c.id}>
                      <td className="py-1.5 pr-2 dark:text-slate-200">{c.claimer_name}{c.claimer_email ? <span className="text-gray-400"> · {c.claimer_email}</span> : ''}</td>
                      <td className="py-1.5 pr-2 dark:text-slate-300">{c.item_title}</td>
                      <td className="py-1.5 pr-2 dark:text-slate-300">{c.amount_minor != null ? (c.amount_minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : `×${c.quantity}`}</td>
                      <td className="py-1.5 pr-2 text-gray-500 dark:text-slate-400 max-w-xs truncate">{c.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Entries */}
      {items.length === 0 && !form ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No registry entries yet. Add a gift item, a cash fund, or a link to an external registry (Amazon, Jumia…).</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((it) => (
            <div key={it.id} className="border dark:border-slate-700 rounded-lg p-3 flex gap-3">
              {it.image_url && <img src={it.image_url} alt="" className="w-14 h-14 rounded object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200">{REGISTRY_KINDS.find((k) => k.value === it.kind)?.label || it.kind}</span>
                  {!it.is_active && <span className="text-[10px] text-amber-500">hidden</span>}
                </div>
                <div className="font-semibold text-sm dark:text-white truncate mt-1">{it.title}</div>
                {it.kind === 'item' && (
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    {it.amount_minor != null && <span>{fmtMoney(it.amount_minor, it.currency)} · </span>}
                    Reserved {it.reserved_qty}/{it.quantity_wanted}
                  </div>
                )}
                {it.kind === 'fund' && (
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    Raised {fmtMoney(it.raised_minor, it.currency)}{it.amount_minor != null && ` of ${fmtMoney(it.amount_minor, it.currency)}`} · {it.claim_count} pledge(s)
                  </div>
                )}
                {it.kind === 'link' && it.external_url && <div className="text-xs text-indigo-500 truncate">{it.external_url}</div>}
                <div className="flex gap-3 mt-1.5 text-xs">
                  <button onClick={() => openEdit(it)} className="text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => removeItem(it.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit entry form */}
      {form && (
        <form onSubmit={saveItem} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Type</label>
              <select className={`${fieldCls} w-full`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                {REGISTRY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Title *</label>
              <input className={`${fieldCls} w-full`} required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={form.kind === 'fund' ? 'Honeymoon Fund' : form.kind === 'link' ? 'Our Amazon registry' : 'KitchenAid Mixer'} />
            </div>
          </div>

          {form.kind === 'item' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Price</label>
                  <div className="flex gap-1">
                    <select className={`${fieldCls} w-20`} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                      <option value="USD">USD</option><option value="NGN">NGN</option>
                    </select>
                    <input className={`${fieldCls} w-full`} type="number" step="0.01" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Quantity wanted</label>
                  <input className={`${fieldCls} w-full`} type="number" min="1" value={form.quantity_wanted} onChange={(e) => setForm((f) => ({ ...f, quantity_wanted: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Image URL</label>
                  <input className={`${fieldCls} w-full`} value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Store / buy link</label>
                <div className="flex gap-2">
                  <input className={`${fieldCls} w-full`} value={form.external_url} onChange={(e) => setForm((f) => ({ ...f, external_url: e.target.value }))} placeholder="https://www.amazon.com/… or any store" />
                  <button type="button" onClick={fetchDetails} disabled={loading}
                    className="shrink-0 text-xs bg-slate-100 dark:bg-slate-700 px-3 rounded-lg dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50">Fetch details</button>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Paste a link from any store and Fetch details to auto-fill — best-effort, edit anything that looks off.</p>
              </div>
            </>
          )}

          {form.kind === 'fund' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Target amount (optional)</label>
                <div className="flex gap-1 max-w-xs">
                  <select className={`${fieldCls} w-20`} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                    <option value="USD">USD</option><option value="NGN">NGN</option>
                  </select>
                  <input className={`${fieldCls} w-full`} type="number" step="0.01" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">How to send money *</label>
                <textarea className={`${fieldCls} w-full`} rows={2} value={form.payment_instructions} onChange={(e) => setForm((f) => ({ ...f, payment_instructions: e.target.value }))} placeholder="Bank: GTBank 0123456789 (Jane Doe) · or Paystack/PayPal link" />
              </div>
            </>
          )}

          {form.kind === 'link' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Registry URL *</label>
              <input className={`${fieldCls} w-full`} value={form.external_url} onChange={(e) => setForm((f) => ({ ...f, external_url: e.target.value }))} placeholder="https://www.amazon.com/wedding/registry/…" />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description (optional)</label>
            <input className={`${fieldCls} w-full`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{form.id ? 'Save' : 'Add'}</button>
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
          </div>
        </form>
      )}

      {msg && <p className="text-sm text-indigo-600 dark:text-indigo-400">{msg}</p>}
    </div>
  )
}

// ── Venue Access Panel ────────────────────────────────────────────────────────

const DIRECTION_MODES = [
  { value: 'both', label: 'Entry & Exit' },
  { value: 'entry', label: 'Entry only' },
  { value: 'exit', label: 'Exit only' },
]
const TICKET_COLORS = ['slate', 'indigo', 'emerald', 'amber', 'rose', 'purple', 'blue', 'teal']
function ticketTint(c) {
  const m = {
    slate: 'bg-slate-200 text-slate-700', indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700', purple: 'bg-purple-100 text-purple-700',
    blue: 'bg-blue-100 text-blue-700', teal: 'bg-teal-100 text-teal-700',
  }
  return m[c] || m.slate
}

// ── Access Rules: tags → zones, gates (tag-based access add-on) ──────────────
function AccessRulesPanel({ eventId }) {
  const [view, setView] = useState('tags')   // tags | assign | zones | gates
  const [tags, setTags] = useState([])
  const [zones, setZones] = useState([])
  const [questions, setQuestions] = useState([])
  const [msg, setMsg] = useState('')

  const field = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  function flash(m, isErr) { setMsg((isErr ? '⚠ ' : '') + m); setTimeout(() => setMsg(''), 3000) }
  function loadTags() { api.listTags(eventId).then(setTags).catch((e) => flash(e.message, true)) }

  useEffect(() => {
    loadTags()
    api.listZones(eventId).then(setZones).catch(() => {})
    api.listRSVPQuestions(eventId).then(setQuestions).catch(() => {})
  }, [eventId]) // eslint-disable-line

  const TABS = [['tags', 'Tags'], ['assign', 'Assign'], ['zones', 'Zone rules'], ['gates', 'Gates']]
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">🏷️ Access Rules</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">Tag guests (from RSVP / import / manually), allow tags into zones, and bind scanners to gates for auto-zone scanning.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === k ? 'bg-teal-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>{label}</button>
          ))}
        </div>
      </div>
      {msg && <div className="text-xs text-teal-600 dark:text-teal-400">{msg}</div>}

      {view === 'tags' && <TagsView eventId={eventId} tags={tags} questions={questions} field={field} reload={loadTags} flash={flash} />}
      {view === 'assign' && <TagAssignView eventId={eventId} tags={tags} flash={flash} />}
      {view === 'zones' && <ZoneRulesView eventId={eventId} tags={tags} zones={zones} flash={flash} />}
      {view === 'gates' && <GatesView eventId={eventId} zones={zones} field={field} flash={flash} />}
    </div>
  )
}

function TagsView({ eventId, tags, questions, field, reload, flash }) {
  const [form, setForm] = useState({ name: '', color: '#0ea5e9', rsvp_question_id: '', rsvp_value: '' })
  async function add() {
    if (!form.name.trim()) return
    try {
      await api.createTag(eventId, {
        name: form.name.trim(), color: form.color,
        rsvp_question_id: form.rsvp_question_id || null,
        rsvp_value: form.rsvp_value.trim() || null,
      })
      setForm({ name: '', color: '#0ea5e9', rsvp_question_id: '', rsvp_value: '' }); reload()
    } catch (e) { flash(e.message, true) }
  }
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
        <input className={field} placeholder="Tag name (e.g. VIP, Press, 21+)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <input type="color" className="h-9 w-14 rounded border border-gray-300 dark:border-slate-700" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} />
        <button onClick={add} className="bg-teal-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-teal-700">+ Add tag</button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">Optional auto-tag from an RSVP answer:</div>
      <div className="grid sm:grid-cols-3 gap-2 items-end">
        <select className={field} value={form.rsvp_question_id} onChange={(e) => setForm((f) => ({ ...f, rsvp_question_id: e.target.value }))}>
          <option value="">— no RSVP mapping —</option>
          {questions.map((q) => <option key={q.id} value={q.id}>{q.question}</option>)}
        </select>
        <input className={field} placeholder="…answer equals (e.g. Yes)" value={form.rsvp_value} onChange={(e) => setForm((f) => ({ ...f, rsvp_value: e.target.value }))} />
        <button onClick={() => api.syncRsvpTags(eventId).then((r) => flash(`Synced — ${r.linked} tag link(s) added.`)).catch((e) => flash(e.message, true))}
          className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg px-4 py-2 text-sm font-semibold">Sync from RSVP</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-700">
        {tags.map((t) => (
          <div key={t.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="w-3 h-3 rounded-full" style={{ background: t.color || '#94a3b8' }} />
            <span className="font-medium dark:text-slate-100">{t.name}</span>
            <span className="text-xs text-slate-400">{t.guest_count} guest(s){t.rsvp_question_id ? ' · from RSVP' : ''}</span>
            <button onClick={() => api.deleteTag(eventId, t.id).then(reload).catch((e) => flash(e.message, true))}
              className="ml-auto text-xs text-red-500 hover:text-red-700">Delete</button>
          </div>
        ))}
        {tags.length === 0 && <div className="text-xs text-slate-400 py-2">No tags yet.</div>}
      </div>
    </div>
  )
}

function TagAssignView({ eventId, tags, flash }) {
  const [guests, setGuests] = useState([])
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState(null)     // selected guest id
  const [guestTags, setGuestTags] = useState([])

  useEffect(() => { api.listGuests(eventId).then(setGuests).catch(() => {}) }, [eventId])
  function pick(g) {
    setSel(g.id)
    api.getGuestTags(eventId, g.id).then(setGuestTags).catch(() => setGuestTags([]))
  }
  function toggle(tagId) {
    const next = guestTags.includes(tagId) ? guestTags.filter((x) => x !== tagId) : [...guestTags, tagId]
    setGuestTags(next)
    api.setGuestTags(eventId, sel, next).catch((e) => flash(e.message, true))
  }
  const filtered = guests.filter((g) => `${g.first_name} ${g.last_name} ${g.email || ''}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guests…"
          className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white mb-2" />
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700 border border-gray-100 dark:border-slate-700 rounded-lg">
          {filtered.slice(0, 100).map((g) => (
            <button key={g.id} onClick={() => pick(g)}
              className={`w-full text-left px-3 py-2 text-sm ${sel === g.id ? 'bg-teal-50 dark:bg-teal-900/30' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}>
              {g.first_name} {g.last_name}<span className="text-xs text-slate-400 ml-2">{g.email}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        {sel ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.id} onClick={() => toggle(t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${guestTags.includes(t.id) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'}`}>
                {t.name}
              </button>
            ))}
            {tags.length === 0 && <div className="text-xs text-slate-400">Create tags first.</div>}
          </div>
        ) : <div className="text-xs text-slate-400">Pick a guest to set their tags.</div>}
      </div>
    </div>
  )
}

function ZoneRulesView({ eventId, tags, zones, flash }) {
  const [rules, setRules] = useState({})   // zoneId -> [tagId]
  useEffect(() => {
    zones.forEach((z) => api.getZoneTags(eventId, z.id).then((ids) => setRules((r) => ({ ...r, [z.id]: ids }))).catch(() => {}))
  }, [zones, eventId]) // eslint-disable-line
  function toggle(zoneId, tagId) {
    const cur = rules[zoneId] || []
    const next = cur.includes(tagId) ? cur.filter((x) => x !== tagId) : [...cur, tagId]
    setRules((r) => ({ ...r, [zoneId]: next }))
    api.setZoneTags(eventId, zoneId, next).catch((e) => flash(e.message, true))
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-slate-400">A zone with no tags selected admits everyone. Otherwise a guest needs at least one matching tag.</p>
      {zones.map((z) => (
        <div key={z.id} className="border border-gray-100 dark:border-slate-700 rounded-lg p-3">
          <div className="font-medium text-sm dark:text-slate-100 mb-2">{z.name}</div>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.id} onClick={() => toggle(z.id, t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${(rules[z.id] || []).includes(t.id) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'}`}>
                {t.name}
              </button>
            ))}
            {tags.length === 0 && <div className="text-xs text-slate-400">Create tags first.</div>}
          </div>
        </div>
      ))}
      {zones.length === 0 && <div className="text-xs text-slate-400">Create zones in the Access tab first.</div>}
    </div>
  )
}

function GatesView({ eventId, zones, field, flash }) {
  const [gates, setGates] = useState([])
  const [form, setForm] = useState({ name: '', zone_id: '', direction: 'in' })
  function load() { api.listGates(eventId).then(setGates).catch(() => {}) }
  useEffect(load, [eventId]) // eslint-disable-line
  async function add() {
    if (!form.name.trim() || !form.zone_id) { flash('Name and zone are required.', true); return }
    try { await api.createGate(eventId, form); setForm({ name: '', zone_id: '', direction: 'in' }); load() }
    catch (e) { flash(e.message, true) }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-slate-400">A gate pins a scanner to a zone (location) + direction. Staff pick the gate once; every scan auto-registers there and checks the guest's tags.</p>
      <div className="grid sm:grid-cols-4 gap-2 items-end">
        <input className={field} placeholder="Gate name (e.g. VIP Door)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <select className={field} value={form.zone_id} onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}>
          <option value="">— zone / location —</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select className={field} value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}>
          <option value="in">Entry →</option>
          <option value="out">← Exit</option>
        </select>
        <button onClick={add} className="bg-teal-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-teal-700">+ Add gate</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-700">
        {gates.map((g) => (
          <div key={g.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="font-medium dark:text-slate-100">{g.name}</span>
            <span className="text-xs text-slate-400">{g.zone_name} · {g.direction === 'out' ? 'Exit ←' : 'Entry →'}</span>
            <button onClick={() => api.deleteGate(eventId, g.id).then(load).catch((e) => flash(e.message, true))}
              className="ml-auto text-xs text-red-500 hover:text-red-700">Delete</button>
          </div>
        ))}
        {gates.length === 0 && <div className="text-xs text-slate-400 py-2">No gates yet.</div>}
      </div>
    </div>
  )
}

function AccessPanel({ eventId }) {
  const [view, setView] = useState('zones')   // zones | tickets | assign | analytics
  const [zones, setZones] = useState([])
  const [tickets, setTickets] = useState([])
  const [zoneForm, setZoneForm] = useState(null)
  const [ticketForm, setTicketForm] = useState(null)
  const [guests, setGuests] = useState([])
  const [occ, setOcc] = useState(null)
  const [peak, setPeak] = useState([])
  const [flow, setFlow] = useState([])
  const [journeyGuest, setJourneyGuest] = useState(null)
  const [journey, setJourney] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function loadZones() { api.listZones(eventId).then(setZones).catch((e) => setMsg(e.message)) }
  function loadTickets() { api.listTicketTypes(eventId).then(setTickets).catch((e) => setMsg(e.message)) }
  useEffect(() => { loadZones(); loadTickets() }, [eventId])

  // Analytics: load on entry + poll occupancy live.
  useEffect(() => {
    if (view !== 'analytics') return
    const refresh = () => {
      api.accessOccupancy(eventId).then(setOcc).catch(() => {})
      api.accessPeak(eventId).then(setPeak).catch(() => {})
      api.accessFlow(eventId).then(setFlow).catch(() => {})
    }
    refresh()
    const t = setInterval(() => api.accessOccupancy(eventId).then(setOcc).catch(() => {}), 5000)
    return () => clearInterval(t)
  }, [view, eventId])

  useEffect(() => {
    if (view === 'assign') api.listGuests(eventId).then(setGuests).catch((e) => setMsg(e.message))
  }, [view, eventId])

  // ── Zones ──
  async function saveZone(e) {
    e.preventDefault(); setLoading(true)
    try {
      const payload = { name: zoneForm.name, capacity: zoneForm.capacity === '' ? null : Number(zoneForm.capacity),
        direction_mode: zoneForm.direction_mode, description: zoneForm.description || null }
      if (zoneForm.id) await api.updateZone(eventId, zoneForm.id, payload)
      else await api.createZone(eventId, payload)
      setZoneForm(null); loadZones()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }
  async function delZone(id) {
    if (!confirm('Delete this zone? Its scan history stays but it disappears from analytics.')) return
    try { await api.deleteZone(eventId, id); loadZones() } catch (e) { setMsg(e.message) }
  }

  // ── Ticket types ──
  async function saveTicket(e) {
    e.preventDefault(); setLoading(true)
    try {
      const payload = { name: ticketForm.name, color: ticketForm.color, capacity: ticketForm.capacity === '' ? null : Number(ticketForm.capacity),
        allowed_zone_ids: ticketForm.allowAll ? [] : ticketForm.allowed_zone_ids }
      if (ticketForm.id) await api.updateTicketType(eventId, ticketForm.id, payload)
      else await api.createTicketType(eventId, payload)
      setTicketForm(null); loadTickets()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }
  async function delTicket(id) {
    if (!confirm('Delete this ticket type? Guests keep their records but lose this type.')) return
    try { await api.deleteTicketType(eventId, id); loadTickets() } catch (e) { setMsg(e.message) }
  }
  function toggleAllowed(zid) {
    setTicketForm((f) => {
      const set = new Set(f.allowed_zone_ids || [])
      set.has(zid) ? set.delete(zid) : set.add(zid)
      return { ...f, allowed_zone_ids: [...set] }
    })
  }

  async function assign(gid, ticketTypeId) {
    try { await api.assignTicketType(eventId, gid, ticketTypeId || null); loadTickets()
      setGuests((prev) => prev.map((g) => g.id === gid ? { ...g, ticket_type_id: ticketTypeId || null } : g))
    } catch (e) { setMsg(e.message) }
  }

  async function showJourney(g) {
    setJourneyGuest(g)
    try { setJourney(await api.guestJourney(eventId, g.id)) } catch (e) { setMsg(e.message) }
  }

  const TABS = [['zones', 'Zones'], ['tickets', 'Ticket types'], ['assign', 'Assign'], ['analytics', 'Analytics']]
  const peakMax = Math.max(1, ...peak.map((b) => b.ins))

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">🎟️ Venue Access</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Zones, ticket types, live occupancy, room flow, peak times & guest journeys. Officials scan in/out per zone.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === id ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* ZONES */}
      {view === 'zones' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setZoneForm({ name: '', capacity: '', direction_mode: 'both', description: '' })}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">+ Zone</button>
          </div>
          {zones.length === 0 && !zoneForm && <p className="text-sm text-gray-400 dark:text-slate-500">No zones yet. Add rooms/areas guests are scanned into (Main Gate, Hall A, VIP Lounge…).</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {zones.map((z) => (
              <div key={z.id} className="border dark:border-slate-700 rounded-lg p-3 flex justify-between items-start">
                <div>
                  <div className="font-semibold text-sm dark:text-white">{z.name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    {DIRECTION_MODES.find((m) => m.value === z.direction_mode)?.label} · inside now: <strong>{z.occupancy}</strong>{z.capacity != null && ` / ${z.capacity}`}
                  </div>
                </div>
                <div className="flex gap-2 text-xs shrink-0">
                  <button onClick={() => setZoneForm({ id: z.id, name: z.name, capacity: z.capacity ?? '', direction_mode: z.direction_mode, description: z.description || '' })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => delZone(z.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
          {zoneForm && (
            <form onSubmit={saveZone} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-3 flex flex-wrap gap-2 items-end">
              <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Zone name *</label>
                <input className={fieldCls} required value={zoneForm.name} onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))} placeholder="Hall A" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Capacity</label>
                <input type="number" min="1" className={`${fieldCls} w-24`} value={zoneForm.capacity} onChange={(e) => setZoneForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="—" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Scan mode</label>
                <select className={fieldCls} value={zoneForm.direction_mode} onChange={(e) => setZoneForm((f) => ({ ...f, direction_mode: e.target.value }))}>
                  {DIRECTION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></div>
              <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{zoneForm.id ? 'Save' : 'Add'}</button>
              <button type="button" onClick={() => setZoneForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300">Cancel</button>
            </form>
          )}
        </div>
      )}

      {/* TICKET TYPES */}
      {view === 'tickets' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setTicketForm({ name: '', color: 'indigo', capacity: '', allowAll: true, allowed_zone_ids: [] })}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">+ Ticket type</button>
          </div>
          {tickets.length === 0 && !ticketForm && <p className="text-sm text-gray-400 dark:text-slate-500">No ticket types yet. Define GA, VIP, Press… and which zones each may enter.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tickets.map((t) => (
              <div key={t.id} className="border dark:border-slate-700 rounded-lg p-3 flex justify-between items-start">
                <div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${ticketTint(t.color)}`}>{t.name}</span>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                    {t.assigned_count} assigned · {(!t.allowed_zone_ids || t.allowed_zone_ids.length === 0) ? 'all zones' : `${t.allowed_zone_ids.length} zone(s)`}
                  </div>
                </div>
                <div className="flex gap-2 text-xs shrink-0">
                  <button onClick={() => setTicketForm({ id: t.id, name: t.name, color: t.color || 'indigo', capacity: t.capacity ?? '', allowAll: !t.allowed_zone_ids || t.allowed_zone_ids.length === 0, allowed_zone_ids: t.allowed_zone_ids || [] })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => delTicket(t.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
          {ticketForm && (
            <form onSubmit={saveTicket} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-3 space-y-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Name *</label>
                  <input className={fieldCls} required value={ticketForm.name} onChange={(e) => setTicketForm((f) => ({ ...f, name: e.target.value }))} placeholder="VIP" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Color</label>
                  <select className={fieldCls} value={ticketForm.color} onChange={(e) => setTicketForm((f) => ({ ...f, color: e.target.value }))}>
                    {TICKET_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Capacity</label>
                  <input type="number" min="1" className={`${fieldCls} w-24`} value={ticketForm.capacity} onChange={(e) => setTicketForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="—" /></div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">
                  <input type="checkbox" checked={ticketForm.allowAll} onChange={(e) => setTicketForm((f) => ({ ...f, allowAll: e.target.checked }))} />
                  Can enter all zones
                </label>
                {!ticketForm.allowAll && (
                  <div className="flex flex-wrap gap-2">
                    {zones.map((z) => (
                      <label key={z.id} className={`text-xs px-2 py-1 rounded border cursor-pointer ${(ticketForm.allowed_zone_ids || []).includes(z.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 dark:border-slate-600 dark:text-slate-300'}`}>
                        <input type="checkbox" className="hidden" checked={(ticketForm.allowed_zone_ids || []).includes(z.id)} onChange={() => toggleAllowed(z.id)} />
                        {z.name}
                      </label>
                    ))}
                    {zones.length === 0 && <span className="text-xs text-amber-500">Add zones first.</span>}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{ticketForm.id ? 'Save' : 'Add'}</button>
                <button type="button" onClick={() => setTicketForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ASSIGN */}
      {view === 'assign' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-slate-400">Assign a ticket type to each guest. (Guests with no type can enter any zone.)</p>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700">
            {guests.map((g) => (
              <div key={g.id} className="flex items-center justify-between py-2 gap-2">
                <span className="text-sm dark:text-slate-200 truncate">{g.first_name} {g.last_name}</span>
                <select className={`${fieldCls} py-1 shrink-0`} value={g.ticket_type_id || ''} onChange={(e) => assign(g.id, e.target.value)}>
                  <option value="">— none —</option>
                  {tickets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ))}
            {guests.length === 0 && <p className="text-sm text-gray-400 py-3">No guests yet.</p>}
          </div>
        </div>
      )}

      {/* ANALYTICS */}
      {view === 'analytics' && (
        <div className="space-y-5">
          {/* Live occupancy */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold dark:text-white">Live occupancy</h3>
              <span className="text-xs text-gray-400">total inside: <strong>{occ?.total_inside ?? 0}</strong> · auto-refresh</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(occ?.zones || []).map((z) => (
                <div key={z.id} className="border dark:border-slate-700 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{z.occupancy}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{z.name}{z.capacity != null && <span className="text-gray-400"> / {z.capacity}</span>}</div>
                </div>
              ))}
              {(!occ || occ.zones.length === 0) && <p className="text-sm text-gray-400 col-span-full">No zones / no scans yet.</p>}
            </div>
          </div>

          {/* Peak times */}
          <div>
            <h3 className="text-sm font-semibold dark:text-white mb-2">Peak times (entries per 15 min)</h3>
            {peak.length === 0 ? <p className="text-sm text-gray-400">No scans recorded yet.</p> : (
              <div className="flex items-end gap-1 h-32 border-b dark:border-slate-700">
                {peak.map((b) => (
                  <div key={b.t} className="flex-1 flex flex-col justify-end items-center group" title={`${new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${b.ins} in`}>
                    <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${(b.ins / peakMax) * 100}%` }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Room flow */}
          <div>
            <h3 className="text-sm font-semibold dark:text-white mb-2">Room flow (most common movements)</h3>
            {flow.length === 0 ? <p className="text-sm text-gray-400">No movements yet.</p> : (
              <ul className="text-sm space-y-1">
                {flow.slice(0, 10).map((f, i) => (
                  <li key={i} className="flex items-center gap-2 dark:text-slate-300">
                    <span className="text-gray-400">{f.from_zone || 'Arrival'}</span>
                    <span className="text-indigo-400">→</span>
                    <span className="font-medium">{f.to_zone}</span>
                    <span className="text-xs text-gray-400 ml-auto">{f.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Guest journey */}
          <div>
            <h3 className="text-sm font-semibold dark:text-white mb-2">Guest journey</h3>
            <select className={`${fieldCls} w-full max-w-sm`} value={journeyGuest?.id || ''}
              onChange={(e) => { const g = guests.find((x) => x.id === e.target.value); if (g) showJourney(g) }}
              onClick={() => { if (guests.length === 0) api.listGuests(eventId).then(setGuests) }}>
              <option value="">Pick a guest…</option>
              {guests.map((g) => <option key={g.id} value={g.id}>{g.first_name} {g.last_name}</option>)}
            </select>
            {journeyGuest && (
              <ol className="mt-3 border-l-2 border-indigo-200 dark:border-slate-600 pl-4 space-y-2">
                {journey.length === 0 && <li className="text-sm text-gray-400">No scans for this guest.</li>}
                {journey.map((s, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium dark:text-slate-200">{s.zone_name || '—'}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${s.direction === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{s.direction}</span>
                    {s.denied && <span className="ml-2 text-xs text-red-500">denied: {s.deny_reason}</span>}
                    <span className="text-xs text-gray-400 ml-2">{new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-indigo-600 dark:text-indigo-400">{msg}</p>}
    </div>
  )
}

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
      const selType = catForm.selection_type || 'single'
      const payload = {
        name: catForm.name,
        sort_order: Number(catForm.sort_order) || 0,
        selection_type: selType,
        min_selections: selType === 'multi' ? Math.max(0, Number(catForm.min_selections) || 0) : 1,
        max_selections: selType === 'multi'
          ? (catForm.max_selections === '' || catForm.max_selections == null ? null : Number(catForm.max_selections))
          : 1,
        is_required: !!catForm.is_required,
      }
      if (catForm.id) {
        const updated = await api.updateMenuCategory(eventId, catForm.id, payload)
        setCategories((prev) => prev.map((c) => (c.id === catForm.id ? { ...c, ...updated } : c)))
      } else {
        const created = await api.createMenuCategory(eventId, payload)
        setCategories((prev) => [...prev, { items: [], combinations: [], ...created }])
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

  function startNewCat() {
    setCatForm({
      name: '',
      sort_order: categories.length,
      selection_type: 'single',
      min_selections: 1,
      max_selections: '',
      is_required: false,
    })
  }

  function startEditCat(cat) {
    setCatForm({
      id: cat.id,
      name: cat.name,
      sort_order: cat.sort_order,
      selection_type: cat.selection_type || 'single',
      min_selections: cat.min_selections ?? 1,
      max_selections: cat.max_selections ?? '',
      is_required: !!cat.is_required,
    })
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
            onClick={startNewCat}
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
        {categories.map((cat) => {
          const selType = cat.selection_type || 'single'
          const isCombo = selType === 'combo'
          const isMulti = selType === 'multi'
          return (
            <div key={cat.id} className="border dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold dark:text-white">{cat.name}</span>
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {selType}
                  </span>
                  {isMulti && (
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      Min {cat.min_selections ?? 0}, Max {cat.max_selections ?? '∞'}
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => startEditCat(cat)}
                    className="text-xs text-indigo-600 hover:underline">Edit</button>
                  <button onClick={() => deleteCat(cat.id)} disabled={loading}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                  {!isCombo && (
                    <button
                      onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { name: '', description: '' } }))}
                      className="text-xs text-green-600 hover:underline font-semibold"
                    >
                      + Item
                    </button>
                  )}
                </div>
              </div>

              {/* Combo: also keep an items strip (for editing the underlying pool) at the bottom of combos UI */}
              {isCombo ? (
                <>
                  <CombinationsSection
                    eventId={eventId}
                    cat={cat}
                    loading={loading}
                    setLoading={setLoading}
                    onCatsChange={setCategories}
                    setMsg={setMsg}
                  />
                  <details className="border-t dark:border-slate-700 bg-gray-50/40 dark:bg-slate-800/40">
                    <summary className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 cursor-pointer select-none">
                      Manage underlying items ({cat.items.length})
                    </summary>
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
                      <div className="px-4 py-2 flex justify-end">
                        <button
                          onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { name: '', description: '' } }))}
                          className="text-xs text-green-600 hover:underline font-semibold"
                        >
                          + Item
                        </button>
                      </div>
                      {itemForms[cat.id] && (
                        <ItemForm
                          form={itemForms[cat.id]}
                          fieldCls={fieldCls}
                          loading={loading}
                          onChange={(patch) => setItemForms((prev) => ({ ...prev, [cat.id]: { ...prev[cat.id], ...patch } }))}
                          onSubmit={(e) => saveItem(e, cat.id)}
                          onCancel={() => setItemForms((prev) => ({ ...prev, [cat.id]: null }))}
                        />
                      )}
                    </div>
                  </details>
                </>
              ) : (
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
                    <ItemForm
                      form={itemForms[cat.id]}
                      fieldCls={fieldCls}
                      loading={loading}
                      onChange={(patch) => setItemForms((prev) => ({ ...prev, [cat.id]: { ...prev[cat.id], ...patch } }))}
                      onSubmit={(e) => saveItem(e, cat.id)}
                      onCancel={() => setItemForms((prev) => ({ ...prev, [cat.id]: null }))}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
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
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Selection Type</label>
            <select
              value={catForm.selection_type}
              onChange={(e) => setCatForm((f) => ({ ...f, selection_type: e.target.value }))}
              className={fieldCls}
            >
              {SELECTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {catForm.selection_type === 'multi' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Min</label>
                <input type="number" min={0} value={catForm.min_selections}
                  onChange={(e) => setCatForm((f) => ({ ...f, min_selections: e.target.value }))}
                  className={`${fieldCls} w-20`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Max</label>
                <input type="number" min={0} value={catForm.max_selections}
                  onChange={(e) => setCatForm((f) => ({ ...f, max_selections: e.target.value }))}
                  placeholder="∞"
                  className={`${fieldCls} w-20`} />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200 select-none cursor-pointer">
            <input type="checkbox"
              checked={!!catForm.is_required}
              onChange={(e) => setCatForm((f) => ({ ...f, is_required: e.target.checked }))}
              className="w-4 h-4 accent-amber-500" />
            Required
          </label>
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

function ItemForm({ form, fieldCls, loading, onChange, onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit} className="px-4 py-3 flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700/50">
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Item Name</label>
        <input
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required className={fieldCls} placeholder="Chicken Breast"
        />
      </div>
      <div className="flex-1 min-w-0">
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description</label>
        <input
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className={fieldCls} placeholder="Optional"
        />
      </div>
      <button type="submit" disabled={loading}
        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
        {form.id ? 'Save' : 'Add'}
      </button>
      <button type="button" onClick={onCancel}
        className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
        ×
      </button>
    </form>
  )
}

// ── Menu Dashboard ───────────────────────────────────────────────────────────

function MenuDashboard({ eventId }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [open, setOpen]         = useState(true)
  const [search, setSearch]     = useState('')
  const [statusF, setStatusF]   = useState('all') // all | served | pending
  const [tableF, setTableF]     = useState('all')
  const [working, setWorking]   = useState(null)
  const [viewMode, setViewMode] = useState('table') // 'table' | 'guest'

  async function load() {
    setLoading(true); setErr('')
    try {
      const res = await api.getMenuDashboard(eventId)
      setData(res)
    } catch (e) { setErr(e.message); setData(null) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open) load() }, [eventId, open])

  async function markServed(guestId) {
    setWorking(guestId)
    try {
      await api.markMealServed(eventId, guestId)
      setData((d) => d && {
        ...d,
        guests: d.guests.map((g) => g.guest_id === guestId ? { ...g, meal_served: true } : g),
      })
      // Refresh totals to reflect the change.
      load()
    } catch (e) { setErr(e.message) }
    finally { setWorking(null) }
  }

  const sortedItems = (data?.item_totals || []).slice().sort((a, b) => b.count - a.count)
  const sortedCombos = (data?.combination_totals || []).slice().sort((a, b) => b.count - a.count)

  const tables = Array.from(new Set((data?.guests || []).map((g) => g.table_name).filter(Boolean))).sort()

  const filtered = (data?.guests || []).filter((g) => {
    if (statusF === 'served' && !g.meal_served) return false
    if (statusF === 'pending' && g.meal_served) return false
    if (tableF !== 'all' && g.table_name !== tableF) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!(g.name || '').toLowerCase().includes(q) && !(g.email || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  function renderChoices(g) {
    const pills = []
    for (const [catId, sel] of Object.entries(g.single || {})) {
      pills.push({ key: `s-${catId}`, label: sel.category_name, value: sel.item_name })
    }
    for (const [catId, sel] of Object.entries(g.multi || {})) {
      pills.push({ key: `m-${catId}`, label: sel.category_name, value: (sel.items || []).join(', ') })
    }
    for (const [catId, sel] of Object.entries(g.combo || {})) {
      const items = (sel.items || []).join(', ')
      pills.push({
        key: `c-${catId}`,
        label: sel.category_name,
        value: items ? `${sel.combination_name} (${items})` : sel.combination_name,
      })
    }
    if (pills.length === 0) {
      return <span className="text-xs italic text-gray-400 dark:text-slate-500">No selection</span>
    }
    return (
      <div className="flex flex-col gap-1">
        {pills.map((p) => (
          <span key={p.key}
            className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            <strong className="font-semibold">{p.label}:</strong> {p.value || '—'}
          </span>
        ))}
      </div>
    )
  }

  // Group filtered guests by table name (unassigned guests go to a synthetic '— unassigned —' bucket)
  // and compute per-table item totals so the kitchen can see "Table 5: Rice ×3, Dodo ×5" at a glance.
  function buildTableGroups(guestList) {
    const buckets = new Map()
    for (const g of guestList) {
      const key = g.table_name || '— unassigned —'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(g)
    }
    const result = []
    for (const [tableName, list] of buckets) {
      const sortedSeats = list.slice().sort((a, b) => {
        const an = Number(a.seat_number); const bn = Number(b.seat_number)
        if (!isNaN(an) && !isNaN(bn)) return an - bn
        return String(a.seat_number || '').localeCompare(String(b.seat_number || ''))
      })
      const itemCounts = new Map()
      const bump = (label) => itemCounts.set(label, (itemCounts.get(label) || 0) + 1)
      for (const g of list) {
        for (const sel of Object.values(g.single || {})) bump(sel.item_name)
        for (const sel of Object.values(g.multi || {})) for (const n of (sel.items || [])) bump(n)
        // Combos: count the combo as one unit. Don't unroll its items —
        // servers already know what's in each combo and we don't want noisy headers.
        for (const sel of Object.values(g.combo || {})) bump(sel.combination_name)
      }
      const totals = [...itemCounts.entries()].sort((a, b) => b[1] - a[1])
      const served = list.filter((g) => g.meal_served).length
      result.push({ tableName, guests: sortedSeats, totals, served, total: list.length })
    }
    // Sort: real tables alphabetically, unassigned last
    result.sort((a, b) => {
      if (a.tableName.startsWith('—')) return 1
      if (b.tableName.startsWith('—')) return -1
      return a.tableName.localeCompare(b.tableName, undefined, { numeric: true })
    })
    return result
  }

  const tableGroups = buildTableGroups(filtered)

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4 border-l-4 border-l-amber-500">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base dark:text-white">Menu Dashboard</h2>
          <button onClick={() => setOpen((v) => !v)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
            {open ? '▲ Hide' : '▼ Show'}
          </button>
        </div>
        {open && (
          <button onClick={load} disabled={loading}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {!open ? null : err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : loading && !data ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2 text-sm font-semibold dark:text-white">Item totals</div>
              {sortedItems.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500 italic">No selections yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-4 py-2 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {sortedItems.map((it) => (
                      <tr key={it.item_id}>
                        <td className="px-4 py-1.5 text-xs text-gray-500 dark:text-slate-400">{it.category_name}</td>
                        <td className="px-4 py-1.5 dark:text-slate-200">{it.name}</td>
                        <td className="px-4 py-1.5 text-right font-bold text-indigo-600 dark:text-indigo-400">{it.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2 text-sm font-semibold dark:text-white">Combination totals</div>
              {sortedCombos.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500 italic">No combo selections.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Combination</th>
                      <th className="px-4 py-2 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {sortedCombos.map((c) => (
                      <tr key={c.combination_id}>
                        <td className="px-4 py-1.5 dark:text-slate-200">{c.name}</td>
                        <td className="px-4 py-1.5 text-right font-bold text-indigo-600 dark:text-indigo-400">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="pt-2 border-t dark:border-slate-700 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Search</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email…"
                  className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Status</label>
                <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
                  className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                  <option value="all">All</option>
                  <option value="pending">Only pending</option>
                  <option value="served">Only served</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Table</label>
                <select value={tableF} onChange={(e) => setTableF(e.target.value)}
                  className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                  <option value="all">All tables</option>
                  {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-1 ml-auto rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                <button onClick={() => setViewMode('table')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                    viewMode === 'table' ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow' : 'text-slate-600 dark:text-slate-300'
                  }`}>By table</button>
                <button onClick={() => setViewMode('guest')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                    viewMode === 'guest' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow' : 'text-slate-600 dark:text-slate-300'
                  }`}>By guest</button>
              </div>
              <span className="text-xs text-gray-500 dark:text-slate-400">
                {filtered.length} of {data.guests.length}
              </span>
            </div>

            {viewMode === 'table' && (
              <div className="space-y-4">
                {tableGroups.length === 0 && (
                  <div className="text-center text-sm text-gray-400 dark:text-slate-500 italic py-6">
                    No guests match these filters.
                  </div>
                )}
                {tableGroups.map((tg) => (
                  <div key={tg.tableName} className="border-2 border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden">
                    <div className="bg-amber-400 dark:bg-amber-700 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-bold text-white">{tg.tableName}</div>
                        <span className="text-xs font-semibold bg-white/20 text-white px-2 py-0.5 rounded">
                          {tg.guests.length} guest{tg.guests.length === 1 ? '' : 's'} · {tg.served}/{tg.total} served
                        </span>
                      </div>
                      {tg.totals.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {tg.totals.map(([name, n]) => (
                            <span key={name} className="bg-white/95 dark:bg-slate-900 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap">
                              {name} × {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="divide-y dark:divide-slate-700 bg-white dark:bg-slate-900">
                      {tg.guests.map((g) => (
                        <div key={g.guest_id} className="p-3 flex flex-wrap items-start gap-3">
                          <div className="shrink-0 w-12 text-center">
                            <div className="text-[10px] uppercase text-slate-400 leading-none">Seat</div>
                            <div className="text-2xl font-extrabold text-slate-700 dark:text-slate-200 leading-tight">
                              {g.seat_number ?? '–'}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold dark:text-slate-100 truncate">{g.name}</span>
                              {g.is_vip && <VipBadge />}
                            </div>
                            <div className="mt-1">{renderChoices(g)}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {!g.admitted && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                                Not arrived
                              </span>
                            )}
                            <button
                              onClick={() => markServed(g.guest_id)}
                              disabled={g.meal_served || working === g.guest_id || !g.admitted}
                              title={!g.admitted ? 'Guest not admitted yet' : ''}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                                g.meal_served
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                  : 'bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40'
                              }`}
                            >
                              {g.meal_served ? 'Served ✓' : working === g.guest_id ? '…' : 'Mark served'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'guest' && (
            <div className="overflow-x-auto border dark:border-slate-700 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Table / Seat</th>
                    <th className="px-4 py-2 text-center">Admitted</th>
                    <th className="px-4 py-2 text-left">Choices</th>
                    <th className="px-4 py-2 text-center">Meal served</th>
                    <th className="px-4 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {filtered.map((g) => (
                    <tr key={g.guest_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/60 align-top">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium dark:text-slate-100">{g.name}</span>
                          {g.is_vip && <VipBadge />}
                        </div>
                        {g.email && <div className="text-xs text-gray-400 dark:text-slate-500">{g.email}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-slate-300">
                        {g.table_name
                          ? <>{g.table_name}{g.seat_number != null ? ` · seat ${g.seat_number}` : ''}</>
                          : <span className="italic text-gray-400 dark:text-slate-500">unassigned</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {g.admitted
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">Yes</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">No</span>}
                      </td>
                      <td className="px-4 py-2.5">{renderChoices(g)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {g.meal_served
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Served ✓</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">Pending</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => markServed(g.guest_id)}
                          disabled={g.meal_served || working === g.guest_id || !g.admitted}
                          title={!g.admitted ? 'Guest not admitted yet' : ''}
                          className="bg-amber-500 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {g.meal_served ? 'Served' : working === g.guest_id ? '…' : 'Mark served'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500 italic">
                        No guests match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Invite & RSVP panel ───────────────────────────────────────────────────────

const INVITE_THEMES = [
  { id: 'default',  label: 'Teal (Default)' },
  { id: 'gold',     label: 'Gold' },
  { id: 'rose',     label: 'Rose' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest',   label: 'Forest' },
]

function InvitePanel({ event, onChanged }) {
  const [form, setForm] = useState({
    rsvp_enabled:      event.rsvp_enabled      ?? false,
    invite_theme:      event.invite_theme       ?? 'default',
    invite_message:    event.invite_message     ?? '',
    rsvp_collect_phone:event.rsvp_collect_phone ?? true,
    rsvp_collect_email:event.rsvp_collect_email ?? true,
    rsvp_capacity:     event.rsvp_capacity      ?? '',
    invite_mode:       event.invite_mode        ?? 'open',
    rsvp_deadline:     event.rsvp_deadline ? event.rsvp_deadline.slice(0, 16) : '',
    rsvp_require_approval: event.rsvp_require_approval ?? false,
  })
  const [questions, setQuestions] = useState([])
  const [newQ, setNewQ] = useState({ question: '', question_type: 'text', options: '', is_required: false })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [coverImage, setCoverImage] = useState(event.invite_cover_image ?? null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    api.listRSVPQuestions(event.id).then(setQuestions).catch(console.error)
  }, [event.id])

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    setLoading(true); setMsg(''); setErr('')
    try {
      const payload = {
        ...form,
        rsvp_capacity: form.rsvp_capacity === '' ? null : Number(form.rsvp_capacity),
        rsvp_deadline: form.rsvp_deadline ? form.rsvp_deadline : null,
      }
      const updated = await api.updateInviteSettings(event.id, payload)
      onChanged(updated)
      setMsg('Invite settings saved!')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function addQuestion() {
    if (!newQ.question.trim()) return
    try {
      const payload = {
        question: newQ.question.trim(),
        question_type: newQ.question_type,
        is_required: newQ.is_required,
        sort_order: questions.length,
        options: newQ.question_type === 'select' && newQ.options.trim()
          ? JSON.stringify(newQ.options.split(',').map((s) => s.trim()).filter(Boolean))
          : null,
      }
      const q = await api.createRSVPQuestion(event.id, payload)
      setQuestions((p) => [...p, q])
      setNewQ({ question: '', question_type: 'text', options: '', is_required: false })
    } catch (e) { setErr(e.message) }
  }

  async function deleteQuestion(qId) {
    await api.deleteRSVPQuestion(event.id, qId)
    setQuestions((p) => p.filter((q) => q.id !== qId))
  }

  async function uploadCover(file) {
    if (!file) return
    setUploading(true); setMsg(''); setErr('')
    try {
      const data = await api.uploadCoverImage(event.id, file)
      setCoverImage(data.url)
      onChanged(data.event)
      setMsg('Cover image uploaded!')
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }

  async function removeCover() {
    setUploading(true); setMsg(''); setErr('')
    try {
      const updated = await api.deleteCoverImage(event.id)
      setCoverImage(null)
      onChanged(updated)
      setMsg('Cover image removed.')
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }

  const inviteUrl = api.inviteUrl(event.id)

  const inputCls = 'w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base dark:text-white">Invite Page &amp; RSVP</h2>
        <a
          href={inviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-teal-600 dark:text-teal-400 hover:underline font-medium"
        >
          Preview invite page ↗
        </a>
      </div>

      {/* Share link */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Share link</label>
        <div className="flex gap-2">
          <input readOnly value={inviteUrl} className={`${inputCls} text-slate-500`} />
          <button
            onClick={() => navigator.clipboard.writeText(inviteUrl).then(() => setMsg('Link copied!'))}
            className="shrink-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-600"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Cover image */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Cover / banner image</label>
        {coverImage ? (
          <div className="space-y-2">
            <img src={coverImage} alt="Cover" className="w-full max-h-48 object-cover rounded-xl border border-slate-200 dark:border-slate-700" />
            <div className="flex gap-2">
              <label className="cursor-pointer shrink-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-600">
                {uploading ? 'Uploading…' : 'Replace image'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => uploadCover(e.target.files?.[0])} />
              </label>
              <button onClick={removeCover} disabled={uploading} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">Remove</button>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center justify-center gap-2 w-full h-28 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer hover:border-teal-500 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-2xl">🖼️</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{uploading ? 'Uploading…' : 'Click to upload (JPEG, PNG, WebP — max 10 MB)'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => uploadCover(e.target.files?.[0])} />
          </label>
        )}
      </div>

      {/* Settings form */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <input id="rsvp_enabled" type="checkbox" checked={form.rsvp_enabled} onChange={set('rsvp_enabled')} className="w-4 h-4 accent-teal-600" />
          <label htmlFor="rsvp_enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">Enable RSVP form</label>
        </div>
        <div className="flex items-center gap-2">
          <input id="collect_phone" type="checkbox" checked={form.rsvp_collect_phone} onChange={set('rsvp_collect_phone')} className="w-4 h-4 accent-teal-600" />
          <label htmlFor="collect_phone" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">Collect phone number</label>
        </div>
        <div className="flex items-center gap-2">
          <input id="collect_email" type="checkbox" checked={form.rsvp_collect_email} onChange={set('rsvp_collect_email')} className="w-4 h-4 accent-teal-600" />
          <label htmlFor="collect_email" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">Collect email address</label>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Theme</label>
          <select value={form.invite_theme} onChange={set('invite_theme')} className={inputCls}>
            {INVITE_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Max RSVPs (leave blank = unlimited)</label>
          <input type="number" min="0" value={form.rsvp_capacity} onChange={set('rsvp_capacity')} className={inputCls} placeholder="e.g. 100" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Invitation mode</label>
          <select value={form.invite_mode} onChange={set('invite_mode')} className={inputCls}>
            <option value="open">Open — anyone with the event link can RSVP</option>
            <option value="closed">Closed — invited guests only (personal links)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">RSVP deadline (optional)</label>
          <input type="datetime-local" value={form.rsvp_deadline} onChange={set('rsvp_deadline')} className={inputCls} />
        </div>
      </div>

      {form.invite_mode === 'closed' && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          🔒 Closed mode: the public event link is disabled. Each guest gets a unique RSVP link — use the <span className="font-semibold">Invite</span> tab to send them, or copy a guest's link from the list. They confirm or decline, and their ticket QR is issued only after they confirm.
        </div>
      )}

      {form.invite_mode === 'open' && (
        <div className="flex items-start gap-2">
          <input id="require_approval" type="checkbox" checked={form.rsvp_require_approval} onChange={set('rsvp_require_approval')} className="w-4 h-4 mt-0.5 accent-teal-600" />
          <label htmlFor="require_approval" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <span className="font-medium">Require approval for RSVPs</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">Self-registrations land as “Pending” — no ticket is sent until you approve them in the Guests tab.</span>
          </label>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Invite message (shown on invite page)</label>
        <textarea rows={3} value={form.invite_message} onChange={set('invite_message')} className={inputCls} placeholder="Add a personal message to your guests…" />
      </div>

      {msg && <div className="text-xs text-green-600 dark:text-green-400">{msg}</div>}
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

      <button onClick={save} disabled={loading}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
        {loading ? 'Saving…' : 'Save Settings'}
      </button>

      {/* RSVP questions */}
      <div className="border-t dark:border-slate-700 pt-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">RSVP Questions</h3>
        {questions.length === 0 && <p className="text-xs text-slate-400">No questions yet.</p>}
        {questions.map((q) => (
          <div key={q.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-slate-800 dark:text-slate-200">{q.question}</span>
              <span className="ml-2 text-xs text-slate-400">({q.question_type}{q.is_required ? ', required' : ''})</span>
            </div>
            <button onClick={() => deleteQuestion(q.id)} className="text-red-400 hover:text-red-600 text-xs shrink-0">Remove</button>
          </div>
        ))}
        {/* Add question form */}
        <div className="grid sm:grid-cols-3 gap-2">
          <input
            value={newQ.question}
            onChange={(e) => setNewQ((p) => ({ ...p, question: e.target.value }))}
            placeholder="Question text…"
            className={`${inputCls} sm:col-span-2`}
          />
          <select value={newQ.question_type} onChange={(e) => setNewQ((p) => ({ ...p, question_type: e.target.value }))} className={inputCls}>
            <option value="text">Text</option>
            <option value="select">Select</option>
            <option value="boolean">Yes/No</option>
          </select>
        </div>
        {newQ.question_type === 'select' && (
          <input
            value={newQ.options}
            onChange={(e) => setNewQ((p) => ({ ...p, options: e.target.value }))}
            placeholder="Options (comma separated): Option A, Option B"
            className={inputCls}
          />
        )}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" checked={newQ.is_required} onChange={(e) => setNewQ((p) => ({ ...p, is_required: e.target.checked }))} className="w-3 h-3 accent-teal-600" />
            Required
          </label>
          <button onClick={addQuestion}
            className="bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-600">
            + Add Question
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Manual invite panel ───────────────────────────────────────────────────────

function ManualInvitePanel({ event }) {
  const [recipients, setRecipients] = useState([])
  const [nameInput, setNameInput] = useState('')
  const [contactInput, setContactInput] = useState('')
  const [channels, setChannels] = useState(['email'])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  function addRecipient() {
    const name = nameInput.trim()
    const contact = contactInput.trim()
    if (!name || !contact) return
    const isEmail = contact.includes('@')
    setRecipients((p) => [...p, { name, ...(isEmail ? { email: contact } : { phone: contact }) }])
    setNameInput('')
    setContactInput('')
  }

  function removeRecipient(idx) {
    setRecipients((p) => p.filter((_, i) => i !== idx))
  }

  function toggleChannel(ch) {
    setChannels((p) => p.includes(ch) ? p.filter((c) => c !== ch) : [...p, ch])
  }

  async function send() {
    if (recipients.length === 0) { setErr('Add at least one recipient'); return }
    if (channels.length === 0) { setErr('Select at least one channel'); return }
    if (!confirm(`Send invites to ${recipients.length} recipient(s)?`)) return
    setLoading(true); setResult(null); setErr('')
    try {
      const res = await api.sendInvites(event.id, { recipients, channels })
      setResult(res)
      setRecipients([])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-base dark:text-white">✉️ Send Invites</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Manually invite people by typing their email or phone. They'll receive a link to your RSVP page.
        </p>
      </div>

      {/* Add recipient row */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
          placeholder="Name"
          className={`${inputCls} w-36`}
        />
        <input
          value={contactInput}
          onChange={(e) => setContactInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
          placeholder="Email or phone (+1...)"
          className={`${inputCls} flex-1 min-w-[180px]`}
        />
        <button
          onClick={addRecipient}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
        >
          + Add
        </button>
      </div>

      {/* Recipient chips */}
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recipients.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-700 rounded-full px-3 py-1 text-xs font-medium">
              <span>{r.name}</span>
              <span className="text-teal-500 dark:text-teal-400">{r.email || r.phone}</span>
              <button onClick={() => removeRecipient(i)} className="ml-1 text-teal-400 hover:text-red-500">✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Channels */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Send via</label>
        <div className="flex gap-4">
          {['email', 'sms', 'whatsapp'].map((ch) => (
            <label key={ch} className="flex items-center gap-1.5 text-sm cursor-pointer select-none text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)} className="w-4 h-4 accent-teal-600" />
              {ch === 'email' ? 'Email' : ch.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      {result && (
        <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          Sent to {result.sent} recipient(s){result.skipped > 0 ? ` · ${result.skipped} skipped (no contact)` : ''}
          {result.errors?.length > 0 && <div className="mt-1 text-red-600 dark:text-red-400">{result.errors.join(', ')}</div>}
        </div>
      )}

      <button onClick={send} disabled={loading || recipients.length === 0}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
        {loading ? 'Sending…' : `📨 Send Invite${recipients.length > 1 ? 's' : ''}${recipients.length > 0 ? ` (${recipients.length})` : ''}`}
      </button>
    </div>
  )
}

// ── Billing / Event Pass panel ──────────────────────────────────────────────

function fmtMoney(amount, currency) {
  const major = amount / 100
  return currency === 'NGN'
    ? `₦${major.toLocaleString()}`
    : `$${major.toLocaleString(undefined, { minimumFractionDigits: 0 })}`
}

function BillingPanel({ event }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  function loadInfo() {
    api.getBillingTiers(event.id).then(setInfo).catch((e) => setErr(e.message))
  }
  useEffect(() => { loadInfo() }, [event.id])

  async function changeCurrency(cur) {
    setErr('')
    try { await api.setBillingCurrency(event.id, cur); loadInfo() }
    catch (e) { setErr(e.message) }
  }

  async function upgrade(tier) {
    setBusy(tier); setErr('')
    try {
      const { url } = await api.checkout(event.id, tier)
      window.location.href = url   // hand off to Stripe/Paystack
    } catch (e) { setErr(e.message); setBusy('') }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-base dark:text-white">💳 Event Pass</h2>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          Currency
          <select
            value={info?.currency || 'USD'}
            onChange={(e) => changeCurrency(e.target.value)}
            className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
            <option value="USD">USD ($) · Stripe</option>
            <option value="NGN">NGN (₦) · Paystack</option>
          </select>
        </label>
      </div>

      {event.is_paid ? (
        <>
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-300">
            ✓ This event is on the <span className="font-semibold">{event.plan_tier}</span> plan
            {event.guest_cap ? ` · up to ${event.guest_cap} guests` : ' · unlimited guests'}
            {` · ${event.message_credits} message credits left`}.
          </div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 pt-1">Top up message credits</div>
          {info && !info.configured && (
            <div className="text-xs text-amber-700 dark:text-amber-300">Online payment isn’t set up yet.</div>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            {info?.packs?.map((p) => (
              <div key={p.key} className="border dark:border-slate-700 rounded-xl p-4 flex flex-col gap-2">
                <div className="font-semibold text-sm dark:text-white">{p.label}</div>
                <div className="text-xl font-bold text-teal-700 dark:text-teal-300">{fmtMoney(p.amount, p.currency)}</div>
                <button
                  onClick={() => upgrade(p.key)}
                  disabled={!info.configured || !!busy}
                  className="mt-1 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                  {busy === p.key ? 'Redirecting…' : 'Buy credits'}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Free events are email-only, capped at 25 guests. An Event Pass unlocks
            SMS/WhatsApp, more guests, and removes branding — one payment, no subscription.
          </p>
          {info && !info.configured && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Online payment isn’t set up yet — contact the organizer to enable {info.provider}.
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {info?.tiers.map((t) => (
              <div key={t.key} className="border dark:border-slate-700 rounded-xl p-4 flex flex-col gap-2">
                <div className="font-semibold text-sm dark:text-white">{t.label}</div>
                <div className="text-2xl font-bold text-teal-700 dark:text-teal-300">{fmtMoney(t.amount, t.currency)}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{t.credits} SMS/WhatsApp credits</div>
                <button
                  onClick={() => upgrade(t.key)}
                  disabled={!info.configured || !!busy}
                  className="mt-1 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                  {busy === t.key ? 'Redirecting…' : 'Buy pass'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
    </div>
  )
}

// ── Broadcast panel ───────────────────────────────────────────────────────────

function BroadcastPanel({ event }) {
  const [msg, setMsg] = useState('')
  const [target, setTarget] = useState('all')
  const [channels, setChannels] = useState(['sms'])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  function toggleChannel(ch) {
    setChannels((p) => p.includes(ch) ? p.filter((c) => c !== ch) : [...p, ch])
  }

  const TARGET_LABELS = {
    all: 'all guests',
    admitted: 'checked-in guests',
    not_admitted: 'guests not yet checked in',
    confirmed: 'guests attending (RSVP yes)',
    declined: 'guests who declined',
    no_reply: 'guests with no RSVP reply',
  }

  async function send() {
    if (!msg.trim()) return
    if (channels.length === 0) { setErr('Select at least one channel'); return }
    if (!confirm(`Send broadcast to ${TARGET_LABELS[target] || 'selected guests'}?`)) return
    setLoading(true); setResult(null); setErr('')
    try {
      const res = await api.broadcast(event.id, { message: msg.trim(), target, channels })
      setResult(res)
      setMsg('')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <h2 className="font-semibold text-base dark:text-white">📣 Broadcast Message</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Send an update to guests — running late, venue change, add-ons, etc.
      </p>

      <textarea
        rows={3}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder="e.g. Doors open at 7pm. Parking on Main St."
        className={`w-full ${inputCls}`}
      />

      <div className="flex flex-wrap gap-4 items-center">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Send to</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
            <option value="all">All guests</option>
            <option value="confirmed">RSVP: Attending</option>
            <option value="declined">RSVP: Declined</option>
            <option value="no_reply">RSVP: No reply</option>
            <option value="admitted">Checked in</option>
            <option value="not_admitted">Not yet checked in</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Channels</label>
          <div className="flex gap-3">
            {['email', 'sms', 'whatsapp'].map((ch) => (
              <label key={ch} className="flex items-center gap-1.5 text-sm cursor-pointer select-none text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)} className="w-4 h-4 accent-teal-600" />
                {ch.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      {result && (
        <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          Queued: {result.queued} · Skipped (no contact): {result.skipped_no_contact} · Skipped (no consent): {result.skipped_no_consent}
          {result.skipped_no_credits ? ` · Skipped (out of credits): ${result.skipped_no_credits}` : ''}
        </div>
      )}

      <button onClick={send} disabled={loading || !msg.trim()}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
        {loading ? 'Sending…' : '📤 Send Broadcast'}
      </button>
    </div>
  )
}

// ── Team panel ────────────────────────────────────────────────────────────────

function TeamPanel({ eventId }) {
  const [members, setMembers] = useState([])
  const [orgMembers, setOrgMembers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'staff' })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  function loadOrgMembers() {
    api.listOrgMembers(eventId).then(setOrgMembers).catch((e) => setMsg(e.message))
  }

  useEffect(() => {
    api.listMembers(eventId).then(setMembers).catch(console.error)
    loadOrgMembers()
  }, [eventId])

  const assignedIds = new Set(members.map((m) => m.user.id))
  const unassigned = orgMembers.map((om) => om.user).filter((u) => !assignedIds.has(u.id))

  async function inviteMember() {
    if (!invite.email.trim()) return
    setLoading(true); setMsg('')
    try {
      await api.inviteOrgMember(eventId, { email: invite.email.trim(), role: invite.role })
      setInvite({ email: '', role: 'staff' })
      loadOrgMembers()
      setMsg('Teammate added. They can now sign in and be assigned to events.')
      setTimeout(() => setMsg(''), 4000)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

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

  async function toggleMenuPerm(userId, current) {
    setLoading(true)
    try {
      await api.updateMemberPermissions(eventId, userId, { can_manage_menu: !current })
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, can_manage_menu: !current } : m))
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
                  <>
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
                    <button
                      onClick={() => toggleMenuPerm(m.user.id, m.can_manage_menu)}
                      disabled={loading}
                      title="Can manage menu"
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                        m.can_manage_menu
                          ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800'
                          : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                      }`}
                    >
                      Menu: {m.can_manage_menu ? 'Yes' : 'No'}
                    </button>
                  </>
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

      {/* Assign an existing org member to this event */}
      <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
          className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
          <option value="">— assign a teammate to this event —</option>
          {unassigned.map((u) => (
            <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
          ))}
        </select>
        <button onClick={assign} disabled={loading || !selectedUserId}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          Assign
        </button>
      </div>

      {/* Organization members & their roles */}
      <div className="pt-3 border-t dark:border-slate-700 space-y-2">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400">Organization members &amp; roles</div>
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {orgMembers.map((m) => (
            <li key={m.user.id} className="flex items-center justify-between py-2 gap-2 text-sm">
              <span className="truncate min-w-0">
                <span className="font-medium dark:text-slate-100">{m.user.name}</span>
                <span className="text-gray-400 dark:text-slate-500"> · {m.user.email}</span>
              </span>
              <select value={m.role}
                onChange={async (e) => {
                  try { await api.setOrgMemberRole(eventId, m.user.id, e.target.value); loadOrgMembers(); setMsg('Role updated.'); setTimeout(() => setMsg(''), 2500) }
                  catch (err) { setMsg(err.message) }
                }}
                className="shrink-0 border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
              </select>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400 dark:text-slate-500">Owners &amp; Admins can manage events. Staff can only scan events they're assigned to.</p>
      </div>

      {/* Invite a new teammate to the organization by email */}
      <div className="pt-3 border-t dark:border-slate-700 space-y-2">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400">Add a teammate to your organization</div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="email"
            value={invite.email}
            onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
            placeholder="teammate@email.com"
            className="flex-1 min-w-[180px] border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          />
          <select value={invite.role} onChange={(e) => setInvite((p) => ({ ...p, role: e.target.value }))}
            className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
            <option value="staff">Staff (scan / day-of)</option>
            <option value="admin">Admin (manage events)</option>
          </select>
          <button onClick={inviteMember} disabled={loading || !invite.email.trim()}
            className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
            Add teammate
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          They sign in with this email (Google/email) and the account links automatically.
          Staff also need assigning to a specific event above to scan it.
        </p>
      </div>
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
          <input className={field} value={form.name} onChange={set('name')} required placeholder="Annual Gala / Acme Conference / Birthday Party" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Host / Organizer</label>
          <input className={field} value={form.couples_name} onChange={set('couples_name')} placeholder="e.g. Acme Corp, The Smiths, John &amp; Jane" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Event Date *</label>
          <input className={field} type="datetime-local" value={form.event_date?.slice(0, 16) || ''} onChange={set('event_date')} required />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">App Base URL *</label>
          <input className={field} value={form.checkin_base_url} onChange={set('checkin_base_url')} required placeholder="https://events.vsgs.io" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Venue</label>
          <input className={field} value={form.venue_name || ''} onChange={set('venue_name')} placeholder="e.g. Grand Ballroom" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Venue address</label>
          <input className={field} value={form.venue_address || ''} onChange={set('venue_address')} placeholder="Street, city" />
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
      {!event.source_last_error && event.source_last_warning && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-lg px-3 py-2 text-xs">
          ⚠ {event.source_last_warning}
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

function OnboardingChecklist({ event, stats, onTab }) {
  const key = `onb_${event.id}`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === '1')
  if (dismissed) return null
  const items = [
    { label: 'Create your event', done: true },
    { label: 'Add your guest list', done: stats.total > 0, tab: 'overview' },
    { label: 'Set up the RSVP & invite page', done: !!event.rsvp_enabled, tab: 'invite' },
    { label: 'Send invitations', done: stats.invited > 0, tab: 'invite' },
    { label: 'Upgrade to an Event Pass', done: !!event.is_paid, tab: 'invite' },
  ]
  const doneCount = items.filter((i) => i.done).length
  const pct = Math.round((doneCount / items.length) * 100)
  const allDone = doneCount === items.length
  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white">{allDone ? "🎉 You're all set!" : 'Get this event ready'}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{doneCount} of {items.length} complete</p>
        </div>
        <button onClick={() => { localStorage.setItem(key, '1'); setDismissed(true) }}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Dismiss</button>
      </div>
      <div className="mt-3 h-2 rounded-full bg-teal-100 dark:bg-teal-900/40 overflow-hidden">
        <div className="h-full bg-teal-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${it.done ? 'bg-teal-600 text-white' : 'border-2 border-slate-300 dark:border-slate-600 text-transparent'}`}>✓</span>
            <span className={`flex-1 ${it.done ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}>{it.label}</span>
            {!it.done && it.tab && (
              <button onClick={() => onTab(it.tab)} className="text-xs font-semibold text-teal-600 hover:underline">Do it →</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RsvpStatusBadge({ status }) {
  const map = {
    confirmed: { label: '✓ Attending', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    declined:  { label: '✗ Declined',  cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
    pending:   { label: '⏳ Pending',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    invited:   { label: 'No reply',    cls: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400' },
  }
  const c = map[status] || map.invited
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.cls}`}>{c.label}</span>
}

// ── AdminPage ─────────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
      <div className="flex overflow-x-auto border-b dark:border-slate-700">
        {tabs.map((t) => {
          const isActive = active === t.id
          return (
            <button key={t.id} onClick={() => onChange(t.id)}
              className={`shrink-0 px-4 sm:px-5 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                isActive
                  ? 'border-teal-500 text-teal-700 dark:text-teal-300 bg-teal-50/50 dark:bg-teal-900/20'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}>
              {t.label}
              {typeof t.count === 'number' && (
                <span className={`ml-1.5 text-xs ${isActive ? 'text-teal-600' : 'text-slate-400'}`}>· {t.count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Trial / plans onboarding banner ───────────────────────────────────────────
function trialMoney(amount, currency) {
  const major = (amount || 0) / 100
  return currency === 'NGN' ? `₦${major.toLocaleString()}` : `$${major.toLocaleString()}`
}

function TrialBanner({ events, user }) {
  const [tiers, setTiers] = useState([])
  const [requests, setRequests] = useState(null)   // null = loading
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ contact_name: '', phone: '', event_name: '', guest_count: '', use_case: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.getPricing().then((d) => setTiers(d.tiers || [])).catch(() => {})
    api.myTrialRequests().then(setRequests).catch(() => setRequests([]))
  }, [])

  useEffect(() => {
    if (user?.name) setForm((f) => ({ ...f, contact_name: f.contact_name || user.name }))
  }, [user])

  // Already paying for something → nothing to upsell here.
  const hasPaid = events.some((e) => e.is_paid)
  if (hasPaid || requests === null) return null

  const pending = requests.find((r) => r.status === 'pending')
  const approved = requests.find((r) => r.status === 'approved')

  async function submit() {
    setBusy(true); setMsg('')
    try {
      await api.submitTrialRequest({
        contact_name: form.contact_name,
        phone: form.phone || null,
        event_name: form.event_name || null,
        guest_count: form.guest_count ? Number(form.guest_count) : null,
        use_case: form.use_case || null,
      })
      setRequests(await api.myTrialRequests())
      setShowForm(false)
    } catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white">Choose how to start</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
            Every event is free to start — email invites and up to 25 guests. Unlock SMS/WhatsApp,
            check-in, seating, venue access and more with an Event Pass. Want to try the paid
            features first? Request free trial credits and we’ll set you up.
          </p>
        </div>
        {approved ? (
          <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-semibold">
            ✓ Trial approved — check your events
          </span>
        ) : pending ? (
          <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-semibold">
            ⏳ Trial request received — we’ll be in touch
          </span>
        ) : (
          <button onClick={() => setShowForm((v) => !v)}
            className="shrink-0 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            Request free trial credits
          </button>
        )}
      </div>

      {/* Plan tiers */}
      {tiers.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {tiers.map((t) => (
            <div key={t.key} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div className="font-semibold text-sm text-slate-900 dark:text-white">{t.label}</div>
              <div className="text-xl font-extrabold text-teal-700 dark:text-teal-300">{trialMoney(t.amount, t.currency)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t.guest_cap ? `Up to ${t.guest_cap} guests` : 'Unlimited guests'} · {t.credits} credits
              </div>
            </div>
          ))}
        </div>
      )}
      <a href="/pricing" target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-teal-700 dark:text-teal-300 hover:underline">
        See full pricing →
      </a>

      {/* Request form */}
      {showForm && !pending && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Your name</span>
              <input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="Jane Doe" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Phone</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="+1 832 555 0100" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Event</span>
              <input value={form.event_name} onChange={(e) => setForm((f) => ({ ...f, event_name: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="e.g. Spring Gala" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Expected guests</span>
              <input type="number" min="0" value={form.guest_count} onChange={(e) => setForm((f) => ({ ...f, guest_count: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="120" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">What do you want to try?</span>
              <input value={form.use_case} onChange={(e) => setForm((f) => ({ ...f, use_case: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="SMS invites, check-in, venue zones…" />
            </label>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy || !form.contact_name.trim()}
              className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
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
  const [activeTab, setActiveTab] = useState('overview')
  const fileRef = useRef()

  const PAGE_SIZE = 50
  const event = events.find((e) => e.id === selectedId)

  useEffect(() => { api.listEvents().then(setEvents).catch(console.error) }, [])

  // Returning from a successful Event Pass checkout (Stripe/Paystack).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded')) {
      setMsg('Payment received — your Event Pass is being applied. Refresh in a moment if the plan hasn’t updated.')
      setTimeout(() => setMsg(''), 8000)
      window.history.replaceState({}, '', '/admin')
      api.listEvents().then(setEvents).catch(console.error)
    }
  }, [])

  useEffect(() => {
    setPage(0)
    setSelectedGuests(new Set())
    setActiveTab('overview')
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

  function flashImportResult(res) {
    let msg = `${res.added} guests added, ${res.skipped} skipped.`
    if (res.sample_rows_skipped) msg += ` ${res.sample_rows_skipped} template sample row${res.sample_rows_skipped === 1 ? '' : 's'} ignored.`
    if (res.ticket_types_assigned) msg += ` ${res.ticket_types_assigned} ticket type${res.ticket_types_assigned === 1 ? '' : 's'} assigned.`
    if (res.addresses_added) msg += ` ${res.addresses_added} shipping address${res.addresses_added === 1 ? '' : 'es'} added.`
    let warn = false
    if (res.unknown_ticket_types?.length) {
      msg += ` Unknown ticket types ignored: ${res.unknown_ticket_types.join(', ')} — create them in the Access tab, then re-import to assign.`
      warn = true
    }
    if (res.cap_note) {
      msg += ` ${res.cap_note}`
      warn = true
    }
    flash(msg, warn)
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    try {
      const res = await api.uploadGuests(selectedId, file)
      flashImportResult(res)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false); fileRef.current.value = '' }
  }

  async function handleDownloadTemplate(fmt) {
    try { await api.downloadGuestTemplate(selectedId, fmt) }
    catch (err) { flash(err.message, true) }
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
      flashImportResult(res)
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

  async function handleCopyInviteLink(guestId) {
    try {
      const { invite_url } = await api.ensureInviteToken(selectedId, guestId)
      await navigator.clipboard.writeText(invite_url)
      flash('RSVP link copied to clipboard.')
    } catch (err) { flash(err.message, true) }
  }

  async function handleApproveRsvp(guestId) {
    setLoading(true)
    try {
      await api.approveRsvp(selectedId, guestId)
      flash('RSVP approved — ticket sent.')
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleRejectRsvp(guestId) {
    if (!confirm('Reject this RSVP? The guest will be marked declined (no ticket).')) return
    setLoading(true)
    try {
      await api.rejectRsvp(selectedId, guestId)
      flash('RSVP rejected.')
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleApproveAll() {
    const pendingIds = guests.filter((g) => g.rsvp_status === 'pending').map((g) => g.id)
    if (pendingIds.length === 0) return
    if (!confirm(`Approve all ${pendingIds.length} pending RSVP(s) and send their tickets?`)) return
    setLoading(true)
    try {
      for (const id of pendingIds) await api.approveRsvp(selectedId, id)
      flash(`Approved ${pendingIds.length} RSVP(s).`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  const stats = {
    total: guests.length,
    qr: guests.filter((g) => g.qr_generated_at).length,
    invited: guests.filter((g) => g.invite_sent_at).length,
    admitted: guests.filter((g) => g.admitted).length,
    pending: guests.filter((g) => g.rsvp_status === 'pending').length,
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

      <TrialBanner events={events} user={user} />

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
                  {ev.couples_name ? `${ev.name} — ${ev.couples_name}` : ev.name}
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
          <OnboardingChecklist event={event} stats={stats} onTab={setActiveTab} />
          <TabBar
            active={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'guests',   label: 'Guests', count: guests.length },
              { id: 'team',     label: 'Team' },
              { id: 'invite',   label: '✉️ Invite' },
              ...(event.seating_enabled ? [{ id: 'seating', label: 'Seating' }] : []),
              ...(event.menu_enabled    ? [{ id: 'menu',    label: 'Menu' }]    : []),
              ...(event.logistics_enabled ? [{ id: 'logistics', label: '📦 Logistics' }] : []),
              ...(event.registry_enabled ? [{ id: 'registry', label: '🎁 Registry' }] : []),
              ...(event.venue_access_enabled ? [{ id: 'access', label: '🎟️ Access' }] : []),
              ...(event.venue_access_enabled ? [{ id: 'rules', label: '🏷️ Access Rules' }] : []),
            ]}
          />

          {activeTab === 'overview' && <>

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
            <ChannelToggles event={event} onChanged={updateEvent} />
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
                <span className="text-xs text-gray-400 dark:text-slate-500 ml-2">
                  {['first_name, last_name, email, phone',
                    ...(event.venue_access_enabled ? ['ticket_type'] : []),
                    ...(event.logistics_enabled ? ['ship_address…'] : [])].join(', ')}
                </span>
              </div>
              <button onClick={() => setShowUrlInput((v) => !v)} disabled={loading}
                className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">
                📋 Import from Google Sheets / Excel
              </button>
              <div className="flex items-center gap-1">
                <button onClick={() => handleDownloadTemplate('xlsx')} disabled={loading}
                  className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  title="Excel template with the columns this event imports — includes a ticket-type dropdown when Venue Access is on">
                  ⬇ Download template
                </button>
                <button onClick={() => handleDownloadTemplate('csv')} disabled={loading}
                  className="text-xs text-gray-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 px-1 disabled:opacity-50"
                  title="Same template as plain CSV">
                  CSV
                </button>
              </div>
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

          </>}{/* end overview tab */}

          {activeTab === 'team' && <TeamPanel eventId={selectedId} />}

          {activeTab === 'invite' && <>
            {event.invite_mode === 'closed' && (() => {
              const notInvited = guests.filter((g) => !g.invite_sent_at)
              const noReply = guests.filter((g) => g.rsvp_status === 'invited')
              const btn = 'px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50'
              return (
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
                  <div>
                    <h2 className="font-semibold text-base dark:text-white">✉️ Bulk RSVP invites</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Send each guest their personal RSVP link across the event's enabled channels (email / SMS / WhatsApp). They confirm or decline — tickets are issued only after they confirm.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => handleSendBatch({ ids: notInvited.map((g) => g.id), force: true, label: 'RSVP invites' })}
                      disabled={loading || notInvited.length === 0}
                      className={`bg-teal-600 text-white hover:bg-teal-700 ${btn}`}>
                      Send to not-yet-invited ({notInvited.length})
                    </button>
                    <button
                      onClick={() => {
                        if (noReply.length === 0) return
                        if (!confirm(`Re-send the RSVP link to ${noReply.length} guest(s) who haven't replied yet?`)) return
                        handleSendBatch({ ids: noReply.map((g) => g.id), force: true, label: 'RSVP reminders' })
                      }}
                      disabled={loading || noReply.length === 0}
                      className={`bg-amber-500 text-white hover:bg-amber-600 ${btn}`}>
                      Remind no-reply ({noReply.length})
                    </button>
                    <button
                      onClick={() => {
                        if (guests.length === 0) return
                        if (!confirm(`Resend the RSVP link to ALL ${guests.length} guests, including those who already replied?`)) return
                        handleSendBatch({ ids: null, force: true, label: 'RSVP invites' })
                      }}
                      disabled={loading || guests.length === 0}
                      className={`bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-600 ${btn}`}>
                      Resend to all ({guests.length})
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Guests without a usable contact for any enabled channel are skipped. Manage individual links in the <button onClick={() => setActiveTab('guests')} className="text-teal-600 hover:underline font-semibold">Guests</button> tab.
                  </p>
                </div>
              )
            })()}
            <BillingPanel event={event} />
            <InvitePanel event={event} onChanged={updateEvent} />
            <ManualInvitePanel event={event} />
            <BroadcastPanel event={event} />
          </>}

          {activeTab === 'seating' && event.seating_enabled && <SeatingPanel eventId={selectedId} />}

          {activeTab === 'menu' && event.menu_enabled && <>
            <MenuPanel eventId={selectedId} />
            <MenuDashboard eventId={selectedId} />
          </>}

          {activeTab === 'logistics' && event.logistics_enabled && (
            <LogisticsPanel eventId={selectedId} event={event} />
          )}

          {activeTab === 'registry' && event.registry_enabled && (
            <RegistryPanel eventId={selectedId} event={event} />
          )}

          {activeTab === 'access' && event.venue_access_enabled && (
            <AccessPanel eventId={selectedId} />
          )}

          {activeTab === 'rules' && event.venue_access_enabled && (
            <AccessRulesPanel eventId={selectedId} />
          )}

          {/* Guest list */}
          {activeTab === 'guests' && guests.length === 0 && (
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No guests yet. Go to <button onClick={() => setActiveTab('overview')} className="text-teal-600 hover:underline font-semibold">Overview</button> to upload a CSV, import from Google Sheets / OneDrive, or paste in a URL to sync.
              </p>
            </div>
          )}
          {activeTab === 'guests' && guests.length > 0 && (() => {
            const totalPages = Math.ceil(guests.length / PAGE_SIZE)
            const pageGuests = guests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            const pageSelectedCount = pageGuests.filter((g) => selectedGuests.has(g.id)).length
            const pageAllSelected = pageGuests.length > 0 && pageSelectedCount === pageGuests.length
            return (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
                {stats.pending > 0 && (
                  <div className="px-4 sm:px-6 py-3 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                      ⏳ {stats.pending} RSVP{stats.pending === 1 ? '' : 's'} awaiting approval
                    </span>
                    <button onClick={handleApproveAll} disabled={loading}
                      className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50 ml-auto">
                      Approve all
                    </button>
                  </div>
                )}
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
                        <th className="px-4 py-3 text-center">RSVP</th>
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
                          <td className="px-4 py-3 font-medium dark:text-slate-100">
                            <span className="inline-flex items-center gap-2">{g.first_name} {g.last_name}{g.is_vip && <VipBadge />}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">{g.email}</td>
                          <td className="px-4 py-3 text-center"><Badge on={!!g.qr_generated_at} labels={['Ready', 'Pending']} /></td>
                          <td className="px-4 py-3 text-center"><Badge on={!!g.invite_sent_at} labels={['Sent', 'Unsent']} /></td>
                          <td className="px-4 py-3 text-center"><RsvpStatusBadge status={g.rsvp_status} /></td>
                          <td className="px-4 py-3 text-center">
                            {g.admitted
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                  {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Yes'}
                                </span>
                              : <Badge on={false} labels={['', 'Pending']} />}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-3">
                              {g.rsvp_status === 'pending' && (
                                <>
                                  <button onClick={() => handleApproveRsvp(g.id)} disabled={loading}
                                    className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-40">Approve</button>
                                  <button onClick={() => handleRejectRsvp(g.id)} disabled={loading}
                                    className="text-xs text-red-500 hover:underline disabled:opacity-40">Reject</button>
                                </>
                              )}
                              {event?.invite_mode === 'closed' && (
                                <button onClick={() => handleCopyInviteLink(g.id)}
                                  className="text-xs text-teal-600 hover:underline">Copy link</button>
                              )}
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
                            <div className="font-semibold text-sm dark:text-slate-100 flex items-center gap-2">{g.first_name} {g.last_name}{g.is_vip && <VipBadge />}</div>
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
                        <RsvpStatusBadge status={g.rsvp_status} />
                      </div>
                      <div className="flex gap-4 pt-1">
                        {g.rsvp_status === 'pending' && (
                          <>
                            <button onClick={() => handleApproveRsvp(g.id)} disabled={loading}
                              className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-40">Approve</button>
                            <button onClick={() => handleRejectRsvp(g.id)} disabled={loading}
                              className="text-xs text-red-500 hover:underline disabled:opacity-40">Reject</button>
                          </>
                        )}
                        {event?.invite_mode === 'closed' && (
                          <button onClick={() => handleCopyInviteLink(g.id)}
                            className="text-xs text-teal-600 hover:underline">Copy RSVP link</button>
                        )}
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
    </div>
  )
}
