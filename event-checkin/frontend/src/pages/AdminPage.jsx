import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

function EventForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: '', couples_name: '', event_date: '', description: '', checkin_base_url: window.location.origin }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, event_date: new Date(form.event_date).toISOString() }
      await onSave(payload)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const field = 'block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

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
          <input className={field} value={form.checkin_base_url} onChange={set('checkin_base_url')} required placeholder="https://checkin.example.com" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
        <textarea className={field} rows={2} value={form.description || ''} onChange={set('description')} placeholder="Optional note to guests" />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Event'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-5 py-2 rounded-lg border text-sm font-semibold hover:bg-gray-100">Cancel</button>
        )}
      </div>
    </form>
  )
}

function Badge({ on, labels }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${on ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {on ? labels[0] : labels[1]}
    </span>
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
  const fileRef = useRef()

  const event = events.find((e) => e.id === selectedId)

  useEffect(() => {
    api.listEvents().then(setEvents).catch(console.error)
  }, [])

  useEffect(() => {
    if (!selectedId) return setGuests([])
    api.listGuests(selectedId).then(setGuests).catch(console.error)
  }, [selectedId])

  function flash(m, isErr = false) {
    if (isErr) setError(m)
    else setMsg(m)
    setTimeout(() => { setMsg(''); setError('') }, 4000)
  }

  async function handleCreate(data) {
    const ev = await api.createEvent(data)
    const updated = [ev, ...events]
    setEvents(updated)
    setSelectedId(ev.id)
    setShowForm(false)
    flash('Event created!')
  }

  async function handleUpdate(data) {
    const ev = await api.updateEvent(selectedId, data)
    setEvents(events.map((e) => (e.id === selectedId ? ev : e)))
    setEditing(false)
    flash('Event updated!')
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    try {
      const res = await api.uploadGuests(selectedId, file)
      flash(`${res.added} guests added, ${res.skipped} skipped.`)
      const g = await api.listGuests(selectedId)
      setGuests(g)
    } catch (err) {
      flash(err.message, true)
    } finally {
      setLoading(false)
      fileRef.current.value = ''
    }
  }

  async function handleGenQR() {
    setLoading(true)
    try {
      const res = await api.generateQR(selectedId)
      flash(`QR codes generated for ${res.generated} guests.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) {
      flash(err.message, true)
    } finally {
      setLoading(false)
    }
  }

  async function handleSendInvites() {
    setLoading(true)
    try {
      const res = await api.sendInvites(selectedId)
      flash(`Invite emails queued for ${res.queued} guests.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) {
      flash(err.message, true)
    } finally {
      setLoading(false)
    }
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
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <button onClick={() => { setShowForm(true); setEditing(false) }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700">
          + New Event
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="font-semibold text-lg mb-4">New Event</h2>
          <EventForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Event selector */}
      {events.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6">
          <label className="block text-xs font-semibold text-gray-600 mb-2">Select Event</label>
          <div className="flex gap-3 items-center">
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setEditing(false) }}
            >
              <option value="">— choose an event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name} — {ev.couples_name}</option>
              ))}
            </select>
            {event && (
              <button onClick={() => setEditing(!editing)} className="text-sm text-indigo-600 hover:underline">
                {editing ? 'Cancel' : 'Edit'}
              </button>
            )}
          </div>

          {editing && event && (
            <div className="mt-4 pt-4 border-t">
              <EventForm
                initial={{ ...event, event_date: event.event_date?.slice(0, 16) }}
                onSave={handleUpdate}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* Feedback */}
      {msg && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{msg}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {/* Guest management */}
      {event && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Guests', value: stats.total, color: 'indigo' },
              { label: 'QR Generated', value: stats.qr, color: 'blue' },
              { label: 'Invites Sent', value: stats.invited, color: 'amber' },
              { label: 'Admitted', value: stats.admitted, color: 'green' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl shadow p-4 text-center">
                <div className={`text-3xl font-bold text-${color}-600`}>{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-semibold text-base mb-4">Guest Management</h2>
            <div className="flex flex-wrap gap-3 items-center">
              <div>
                <input type="file" accept=".csv" ref={fileRef} onChange={handleUpload} className="hidden" />
                <button
                  onClick={() => fileRef.current.click()}
                  disabled={loading}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Upload CSV
                </button>
                <span className="text-xs text-gray-400 ml-2">first_name, last_name, email, phone</span>
              </div>
              <button
                onClick={handleGenQR}
                disabled={loading || stats.total === 0}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                Generate QR Codes
              </button>
              <button
                onClick={handleSendInvites}
                disabled={loading || stats.qr === 0}
                className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
              >
                Send Invites
              </button>
            </div>
          </div>

          {/* Guest table */}
          {guests.length > 0 && (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="px-6 py-4 border-b">
                <h2 className="font-semibold">Guest List ({guests.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Phone</th>
                      <th className="px-4 py-3 text-center">QR</th>
                      <th className="px-4 py-3 text-center">Invited</th>
                      <th className="px-4 py-3 text-center">Admitted</th>
                      <th className="px-4 py-3 text-center">QR Code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {guests.map((g) => (
                      <tr key={g.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{g.first_name} {g.last_name}</td>
                        <td className="px-4 py-3 text-gray-600">{g.email}</td>
                        <td className="px-4 py-3 text-gray-500">{g.phone || '—'}</td>
                        <td className="px-4 py-3 text-center"><Badge on={!!g.qr_generated_at} labels={['Ready', 'Pending']} /></td>
                        <td className="px-4 py-3 text-center"><Badge on={!!g.invite_sent_at} labels={['Sent', 'Not Sent']} /></td>
                        <td className="px-4 py-3 text-center">
                          {g.admitted ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Yes'}
                            </span>
                          ) : (
                            <Badge on={false} labels={['', 'Pending']} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {g.qr_generated_at && (
                            <a href={api.guestQrUrl(selectedId, g.id)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline text-xs">
                              View QR
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
