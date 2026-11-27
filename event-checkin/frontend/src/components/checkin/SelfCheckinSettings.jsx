import { useEffect, useState } from 'react'
import { api } from '../../api'

export default function SelfCheckinSettings({ event, onSaved }) {
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    setDraft({ geofence_enabled: false, party_enabled: false, lookup_enabled: false, latitude: '', longitude: '', radius_m: 150, ...event?.self_checkin_config })
    setMessage('')
  }, [event?.id, event?.self_checkin_config])
  const edit = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setMessage('') }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const updated = await api.setSelfCheckinConfig(event.id, { ...draft,
        latitude: draft.latitude === '' ? null : Number(draft.latitude),
        longitude: draft.longitude === '' ? null : Number(draft.longitude), radius_m: Number(draft.radius_m),
      })
      onSaved?.(updated); setMessage('Self check-in settings saved.')
    } catch (err) { setMessage(err.message || 'Settings could not be saved.') }
    finally { setBusy(false) }
  }
  function useLocation() {
    if (!navigator.geolocation) { setMessage('Location is unavailable. Enter the venue coordinates.'); return }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(p => {
      setDraft(d => ({ ...d, latitude: p.coords.latitude, longitude: p.coords.longitude }))
      setMessage('Location added. Confirm you are at the venue before saving.'); setBusy(false)
    }, () => { setMessage('Location could not be read. Enter the venue coordinates.'); setBusy(false) }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  }
  if (!event) return null
  return <fieldset disabled={busy} style={{ marginTop: 20, border: '1px solid var(--border, #d1d5db)', padding: 16, borderRadius: 12 }}>
    <legend>Venue and RSVP party check-in</legend>
    <label style={{ display: 'block', marginBottom: 12 }}><input type="checkbox" checked={!!draft.party_enabled} onChange={e => edit('party_enabled', e.target.checked)}/> Allow guests to check in the companions they registered</label>
    <p className="rd-hint">Guests select who has arrived and confirm everyone selected is present.</p>
    <label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={!!draft.lookup_enabled} onChange={e => edit('lookup_enabled', e.target.checked)}/> Let guests find their registration by name, phone number or email</label>
    <p className="rd-hint">Requires venue-only check-in. Guests can search at the venue without finding their personal invitation link. Search shows names only.</p>
    <label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={!!draft.geofence_enabled} onChange={e => edit('geofence_enabled', e.target.checked)}/> Require guests to be at the venue</label>
    <div style={{ display: 'grid', gap: 10 }}>
      <label>Venue latitude<input className="rd-field" type="number" step="any" min="-90" max="90" value={draft.latitude ?? ''} onChange={e => edit('latitude', e.target.value)}/></label>
      <label>Venue longitude<input className="rd-field" type="number" step="any" min="-180" max="180" value={draft.longitude ?? ''} onChange={e => edit('longitude', e.target.value)}/></label>
      <label>Allowed radius (metres)<input className="rd-field" type="number" min="25" max="1000" value={draft.radius_m ?? 150} onChange={e => edit('radius_m', e.target.value)}/></label>
      <button type="button" className="rr-btn secondary" onClick={useLocation}>Use my current location as the venue</button>
      <p className="rd-hint">Location permission is required. Guests outside the boundary or without an accurate location must visit the check-in desk. A phone location cannot verify the presence of companions.</p>
      <button type="button" className="rr-btn" onClick={save}>{busy ? 'Saving…' : 'Save venue and party settings'}</button>
      {message && <p role="status">{message}</p>}
    </div>
  </fieldset>
}
