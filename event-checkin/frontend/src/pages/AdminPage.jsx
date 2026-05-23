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
            <li key={m.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-semibold text-sm">
                  {m.user.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium dark:text-slate-100">{m.user.name}</div>
                  <div className="text-xs text-gray-400 dark:text-slate-500">{m.user.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {roleTag(m.user.role)}
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
    </div>
  )
}
