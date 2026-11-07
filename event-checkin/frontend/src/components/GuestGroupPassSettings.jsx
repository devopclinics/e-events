import { useEffect, useState } from 'react'
import { api } from '../api'

export default function GuestGroupPassSettings({ eventId, guestId }) {
  const [data, setData] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    api.guestGroupPass(eventId, guestId).then(value => {
      if (!live) return
      setData(value); setEnabled(value.enabled); setLimit(value.admission_limit || '')
    }).catch(error => { if (live) setMessage(error.message) })
    return () => { live = false }
  }, [eventId, guestId])
  async function save() {
    setBusy(true); setMessage('')
    try {
      const value = await api.saveGuestGroupPass(eventId, guestId, { enabled, admission_limit: limit === '' ? null : Number(limit) })
      setData(value); setMessage('Shared QR settings saved. No invitation was sent.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  return <section style={{ padding: 18, border: '1px solid #d6e1d8', borderRadius: 12, background: '#f3f6ee' }}>
    <strong>Shared group QR</strong>
    <p className="rd-hint">One pass for a team. Staff confirm how many people are entering; each person gets an attendance record. A shared QR does not verify individual identity.</p>
    {data && <>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/> Enable multiple admissions</label>
      <label className="rd-field-label" style={{ display: 'block', marginTop: 12 }}>Total people in this group
        <input className="rd-field" type="number" min="1" max="500" step="1" value={limit} onChange={e => setLimit(e.target.value)} placeholder="Set a limit before enabling"/>
      </label>
      <p className="rd-hint">The same limit applies separately to each permitted session. Conference and Dinner access still follow this guest’s access settings. Leaving does not restore the allowance. Online scanning is required.</p>
      {data.counts.filter(row => row.used > 0).map(row => <div key={row.zone_id || 'event'}>{row.name}: <strong>{row.used} / {data.admission_limit || '—'}</strong> admitted</div>)}
      <button type="button" className="rr-btn secondary" disabled={busy || (enabled && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 500))} onClick={save}>{busy ? 'Saving…' : 'Save shared QR settings'}</button>
      {!!data.history?.length && <details><summary>Recent group admissions</summary>{data.history.map((row, i) => <p key={i} className="rd-hint">{new Date(row.time).toLocaleString()} · {row.scope} · {row.admitted_count} admitted</p>)}</details>}
    </>}
    {message && <p role="status" className="rd-hint">{message}</p>}
  </section>
}
