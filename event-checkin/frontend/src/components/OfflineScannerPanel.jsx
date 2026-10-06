import { useEffect, useState } from 'react'
import { api } from '../api'
import { drainOfflineAdmissions, offlineAdmissionItems, offlineManifestStatus } from '../offlineExperienceQueue'

export default function OfflineScannerPanel({ eventId, manifest, online, onPrepare, onSynced }) {
  const [now, setNow] = useState(Date.now())
  const [items, setItems] = useState(() => offlineAdmissionItems(eventId))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const update = () => { setItems(offlineAdmissionItems(eventId)); setNow(Date.now()) }
    update()
    window.addEventListener('offline-admission-change', update)
    window.addEventListener('storage', update)
    const timer = window.setInterval(update, 15000)
    return () => { window.removeEventListener('offline-admission-change', update); window.removeEventListener('storage', update); window.clearInterval(timer) }
  }, [eventId])
  const status = offlineManifestStatus(manifest, eventId, now)
  const review = items.filter((item) => item.syncStatus === 'needs_review')
  async function prepare() {
    setBusy(true); setNotice('')
    try {
      const result = await onPrepare()
      setNotice(result?.error || (result?.manifest ? `Saved ${result.manifest.guests.length} passes on this scanner.` : 'Reconnect to prepare this scanner.'))
    } catch (error) { setNotice(error.message) }
    finally { setBusy(false) }
  }
  async function sync() {
    setBusy(true); setNotice('')
    try {
      const result = await drainOfflineAdmissions(api, eventId, { retryRejected: true })
      await onSynced()
      setNotice(`${result.sent} confirmed by the server; ${result.remaining} still need synchronization or review.`)
    } catch (error) { setNotice(error.message || 'Sync interrupted. Keep this browser open; saved records remain on this device.') }
    finally { setBusy(false) }
  }
  return <section className="sc-command-panel sc-offline-panel" aria-label="Offline preparation">
    <div className="sc-command-panel-head"><div><span>Before losing connectivity</span><strong>Offline check-in readiness</strong></div><button type="button" className="rr-btn secondary" onClick={prepare} disabled={!online || busy}>{busy ? 'Working…' : 'Prepare this scanner'}</button></div>
    <div className="sc-offline-body">
      <p role="status"><strong>{status.message}</strong></p>
      {manifest?.generated_at && <p>Last downloaded: {new Date(manifest.generated_at).toLocaleString()} · {manifest.guests?.length || 0} saved passes{status.ready ? ` · Valid until ${new Date(status.expiresAt).toLocaleTimeString()}` : ''}</p>}
      <p>Keep this scanner open. Offline mode supports QR and manual convention admission. Guardian handoffs, check-out and daily attendance need a connection. Other scanners cannot see these local check-ins until they sync.</p>
      <div className="sc-offline-actions"><button type="button" className="rr-btn primary" onClick={sync} disabled={!online || busy || !items.length}>Sync / retry saved check-ins ({items.length})</button></div>
      {items.length > 0 && <p>Do not clear browser data or change devices before these records are synchronized.</p>}
      {notice && <p role="status">{notice}</p>}
      {review.length > 0 && <p role="alert"><strong>{review.length} check-in(s) need staff review.</strong> The server has not accepted them. Resolve the reason below, then retry.</p>}
      {items.length > 0 && <details><summary>Review saved check-ins</summary><ul>{items.map((item) => <li key={item.key}><strong>{item.guestName || 'Guest'}</strong> · {new Date(item.createdAt).toLocaleString()} · {item.syncStatus === 'needs_review' ? 'Needs review' : 'Pending sync'}{item.lastError && <p>{item.lastError}</p>}</li>)}</ul></details>}
    </div>
  </section>
}
