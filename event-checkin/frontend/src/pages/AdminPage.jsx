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
                className={fieldCls} placeholder="Wedding Banquet" />
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

  async function send() {
    if (!msg.trim()) return
    if (channels.length === 0) { setErr('Select at least one channel'); return }
    if (!confirm(`Send broadcast to ${target === 'all' ? 'all guests' : target === 'admitted' ? 'admitted guests' : 'guests not yet admitted'}?`)) return
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
            <option value="admitted">Admitted only</option>
            <option value="not_admitted">Not yet admitted</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Channels</label>
          <div className="flex gap-3">
            {['sms', 'whatsapp'].map((ch) => (
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
          Queued: {result.queued} · Skipped (no phone): {result.skipped_no_phone} · Skipped (no consent): {result.skipped_no_consent}
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

function TeamPanel({ eventId }) {  const [members, setMembers] = useState([])
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

function RsvpStatusBadge({ status }) {
  const map = {
    confirmed: { label: '✓ Attending', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    declined:  { label: '✗ Declined',  cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
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
  const [activeTab, setActiveTab] = useState('overview')
  const fileRef = useRef()

  const PAGE_SIZE = 50
  const event = events.find((e) => e.id === selectedId)

  useEffect(() => { api.listEvents().then(setEvents).catch(console.error) }, [])

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

  async function handleCopyInviteLink(guestId) {
    try {
      const { invite_url } = await api.ensureInviteToken(selectedId, guestId)
      await navigator.clipboard.writeText(invite_url)
      flash('RSVP link copied to clipboard.')
    } catch (err) { flash(err.message, true) }
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

          </>}{/* end overview tab */}

          {activeTab === 'team' && <TeamPanel eventId={selectedId} />}

          {activeTab === 'invite' && <>
            <InvitePanel event={event} onChanged={updateEvent} />
            <ManualInvitePanel event={event} />
            <BroadcastPanel event={event} />
          </>}

          {activeTab === 'seating' && event.seating_enabled && <SeatingPanel eventId={selectedId} />}

          {activeTab === 'menu' && event.menu_enabled && <>
            <MenuPanel eventId={selectedId} />
            <MenuDashboard eventId={selectedId} />
          </>}

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

      {/* User management — always visible to admins */}
      <UsersPanel />
    </div>
  )
}
