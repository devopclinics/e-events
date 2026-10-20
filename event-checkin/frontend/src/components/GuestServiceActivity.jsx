import { useEffect, useState } from 'react'
import { api } from '../api'

const csvCell = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
export default function GuestServiceActivity({ eventId, team, guests }) {
  const [filters, setFilters] = useState({ actor_id: '', guest_id: '', action: '', since: '', until: '' })
  const [page, setPage] = useState(0), [result, setResult] = useState(null), [error, setError] = useState(''), [version, setVersion] = useState(0)
  const params = offset => Object.fromEntries(Object.entries({ ...filters, since: filters.since ? new Date(filters.since).toISOString() : '', until: filters.until ? new Date(filters.until).toISOString() : '', offset, limit: 50 }).filter(([, value]) => value !== ''))
  useEffect(() => {
    let live = true
    setResult(null); setError('')
    api.guestServiceActivity(eventId, params(page * 50)).then(value => { if (live) setResult(value) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [eventId, filters, page, version])
  const update = (key, value) => { setPage(0); setFilters(old => ({ ...old, [key]: value })) }
  const exportPage = () => {
    const rows = [['Time (UTC)', 'Staff', 'Guest', 'Action', 'Details'], ...result.rows.map(r => [r.created_at, r.actor_name, r.guest_name, r.action, JSON.stringify(r.detail || {})])]
    const href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = href; link.download = 'guest-services-activity-page.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
  }
  return <section className="gs-panel" aria-label="Guest Services activity"><h2>Activity history</h2><p>Supervisor history of recorded actions and pass attempts. Filters and exports apply to this event.</p>
    <div className="gs-actions"><label>Staff<select value={filters.actor_id} onChange={e => update('actor_id', e.target.value)}><option value="">All staff</option>{team.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label>
      <label>Guest<select value={filters.guest_id} onChange={e => update('guest_id', e.target.value)}><option value="">All guests</option>{guests.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>Action<input value={filters.action} placeholder="e.g. meal_served" onChange={e => update('action', e.target.value)} /></label>
      <label>From (local time)<input type="datetime-local" value={filters.since} onChange={e => update('since', e.target.value)} /></label><label>Until (local time)<input type="datetime-local" value={filters.until} onChange={e => update('until', e.target.value)} /></label>
      <button onClick={() => setVersion(v => v + 1)}>Refresh history</button><button disabled={!result?.rows.length} onClick={exportPage}>Export this page (CSV)</button></div>
    {error && <p role="alert">{error}</p>}{!result && !error && <p>Loading activity…</p>}
    {result && <><p>{result.total} matching records · page {page + 1}</p>{result.rows.map(row => <article className="gs-aside-card" key={row.id}><strong>{row.action.replaceAll('_', ' ')}</strong><p>{row.actor_name}{row.guest_name ? ` · ${row.guest_name}` : ''} · {new Date(row.created_at.endsWith('Z') ? row.created_at : `${row.created_at}Z`).toLocaleString()}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.detail || {}, null, 2)}</pre></article>)}{!result.rows.length && <p>No matching activity.</p>}<div className="gs-actions"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><button disabled={(page + 1) * 50 >= result.total} onClick={() => setPage(p => p + 1)}>Next</button></div></>}
  </section>
}
