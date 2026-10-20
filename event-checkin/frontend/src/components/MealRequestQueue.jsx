import { useEffect, useRef, useState } from 'react'
import './MealRequestQueue.css'

export const mealProgressBody = row => ({ status: row.next_status, expected_status: row.status, selection_key: row.selection_key })
export function useMealUpdates(rows, eventId) {
  const previous = useRef(null), [updates, setUpdates] = useState([])
  useEffect(() => { previous.current = null; setUpdates([]) }, [eventId])
  useEffect(() => {
    if (!rows) { previous.current = null; setUpdates([]); return }
    const next = new Map(rows.filter(r => r.status !== 'served').map(r => [r.id, `${r.selection_key}:${r.status}`]))
    const currentRows = new Map(rows.map(r => [r.id, r]))
    const remainingUpdates = old => old.filter(r => ['pending','ready'].includes(currentRows.get(r.id)?.status)).map(r => currentRows.get(r.id))
    if (previous.current) {
      const changed = rows.filter(r => r.status !== 'served' && (!previous.current.has(r.id) || previous.current.get(r.id).split(':')[0] !== r.selection_key || (r.status === 'ready' && previous.current.get(r.id) !== next.get(r.id))))
      if (changed.length) setUpdates(old => [...remainingUpdates(old).filter(r => !changed.some(c => c.id === r.id)), ...changed].slice(-50))
      else setUpdates(remainingUpdates)
    }
    previous.current = next
  }, [rows])
  return [updates, () => setUpdates([])]
}
export function MealUpdateNotice({ updates, dismiss, open }) {
  if (!updates.length) return null
  return <div className="mq-notice" role="status" aria-live="polite"><div><strong>{updates.length} meal update{updates.length === 1 ? '' : 's'}</strong><p>{updates.slice(-3).map(r => `${r.table_name}: ${r.guest_name} · ${r.status_label}`).join(' · ')}</p></div><button onClick={open}>View meal requests</button><button onClick={dismiss} aria-label="Dismiss meal updates">Dismiss</button></div>
}
export default function MealRequestQueue({ rows = [], busy, progress, query = '' }) {
  const [status, setStatus] = useState('outstanding'), [table, setTable] = useState('all'), [page, setPage] = useState(1)
  const filtered = rows.filter(r => (status === 'all' || (status === 'outstanding' ? ['pending','preparing','ready'].includes(r.status) : r.status === status)) && (table === 'all' || r.table_id === table) && `${r.guest_name} ${r.table_name} ${r.choices.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, pages)
  useEffect(() => setPage(1), [status, table, query])
  const tables = [...new Map(rows.map(r => [r.table_id, r.table_name])).entries()]
  return <section className="mq-queue" aria-label="Meal requests"><div className="mq-toolbar"><label>Meal stage<select aria-label="Meal stage" value={status} onChange={e => setStatus(e.target.value)}>{[['outstanding','Outstanding'],['pending','New'],['preparing','Preparing'],['ready','Ready'],['served','Delivered'],['all','All stages']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Request table<select aria-label="Request table" value={table} onChange={e => setTable(e.target.value)}><option value="all">All tables in your view</option>{tables.map(([id,name]) => <option key={id || 'none'} value={id || ''}>{name}</option>)}</select></label><p>{filtered.length} request{filtered.length === 1 ? '' : 's'} · updates every 20 seconds</p></div><ol className="mq-rows">{filtered.slice((current-1)*25,current*25).map(row => <li className={`mq-row mq-${row.status}`} key={row.id}><div><strong>{row.table_name} · {row.guest_name}</strong><p>{row.service_name}: {row.choices.join(', ')}</p></div><span className="mq-stage">{row.status_label}</span><div>{row.next_status && <button disabled={busy || !row.can_progress} onClick={() => progress(row)}>{({preparing:'Start preparing',ready:'Mark ready',served:'Mark delivered'})[row.next_status]}</button>}{!row.can_progress && row.next_status && <small>{row.availability_reason}</small>}</div></li>)}</ol>{!filtered.length && <p className="mq-empty">No meal requests match this view. Guest selections appear here when saved.</p>}<div className="mq-pagination"><button disabled={current === 1} onClick={() => setPage(current-1)}>Previous requests</button><span>Page {current} of {pages}</span><button disabled={current === pages} onClick={() => setPage(current+1)}>Next requests</button></div></section>
}
