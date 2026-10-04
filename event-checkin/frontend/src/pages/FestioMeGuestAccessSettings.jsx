import { useEffect, useId, useState } from 'react'
import { api } from '../api'

export default function FestioMeGuestAccessSettings({ eventId }) {
  const modeId = useId()
  const searchId = useId()
  const [policy, setPolicy] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [search, setSearch] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!eventId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError('')
    setSaved('')
    setPolicy(null)
    api.festiomeAccessPolicy(eventId)
      .then((data) => { if (!cancelled) setPolicy(data) })
      .catch((e) => { if (!cancelled) setError(e.message || 'Guest chat access could not be loaded.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eventId, reload])

  async function save() {
    if (!policy || saving) return
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const result = await api.festiomeSaveAccessPolicy(eventId, {
        mode: policy.mode,
        adult_guest_ids: policy.mode === 'approved_adults' ? policy.adult_guest_ids : [],
      })
      setPolicy((current) => ({ ...current, mode: result.mode, adult_guest_ids: result.adult_guest_ids }))
      setSaved('Guest chat access saved. Guests can reopen FestioMe or select “Check access again”.')
    } catch (e) { setError(e.message || 'Guest chat access could not be saved.') }
    finally { setSaving(false) }
  }

  const selected = new Set(policy?.adult_guest_ids || [])
  const guests = (policy?.guests || []).filter((guest) => guest.name.toLowerCase().includes(search.trim().toLowerCase()))

  return <section className="rd-panel fm-guest-access" style={{ maxWidth: 700, marginBottom: 18 }} aria-label="Guest chat access">
    <div className="rd-panel-head"><h3>Guest chat access</h3></div>
    <div className="rd-panel-body">
      <p className="rd-hint">Choose who can enter this event’s FestioMe community. This is separate from event admission and guardian pickup permission.</p>
      {loading && <p role="status">Loading guest chat access…</p>}
      {error && <p className="rd-banner-err" role="alert">{error}</p>}
      {!loading && !policy && eventId && <button type="button" className="rr-btn secondary" onClick={() => setReload((n) => n + 1)}>Retry loading guest chat access</button>}
      {!eventId && <p>Select an event to manage guest chat access.</p>}
      {policy && <>
        <label className="rd-field-label" htmlFor={modeId}>Who can join chat?</label>
        <select id={modeId} className="rd-field" value={policy.mode} disabled={saving} onChange={(e) => { setPolicy((current) => ({ ...current, mode: e.target.value })); setSaved('') }}>
          <option value="approved_adults">Only approved adults</option>
          <option value="all_eligible">All attending guests</option>
        </select>
        {policy.mode === 'approved_adults' ? <>
          <p className="rd-hint">Approve only people you have confirmed are adults. Unselected guests cannot enter chat.</p>
          <label className="rd-field-label" htmlFor={searchId}>Find a guest to approve</label>
          <input id={searchId} className="rd-field" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest names" />
          <p className="rd-hint">{selected.size} approved adult{selected.size === 1 ? '' : 's'}</p>
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 10, marginBottom: 12 }}>
            {guests.map((guest) => <label key={guest.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              <input type="checkbox" checked={selected.has(guest.id)} disabled={saving} onChange={(e) => {
                const checked = e.target.checked
                setPolicy((current) => {
                  const ids = new Set(current.adult_guest_ids || [])
                  if (checked) ids.add(guest.id)
                  else ids.delete(guest.id)
                  return { ...current, adult_guest_ids: [...ids] }
                })
                setSaved('')
              }} />
              <span>{guest.name}</span>
            </label>)}
            {!guests.length && <p>No guests match this search.</p>}
          </div>
        </> : <p className="rd-hint">Every attending guest, including children, can enter chat. Choose “Only approved adults” to restrict access.</p>}
        <p className="rd-hint">Guests also need confirmed attendance, or an invitation when RSVP is turned off.</p>
        <button type="button" className="rr-btn primary" disabled={saving} onClick={save}>{saving ? 'Saving guest chat access…' : 'Save guest chat access'}</button>
        {saved && <p role="status" style={{ marginTop: 12 }}>{saved}</p>}
      </>}
    </div>
  </section>
}
