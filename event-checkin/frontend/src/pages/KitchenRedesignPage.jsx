import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { EmptyState, ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import './KitchenRedesignPage.css'

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : []
const text = (value, fallback = '') => value == null ? fallback : String(value)

function selections(guest) {
  const out = []
  Object.values(guest?.single || {}).forEach((s) => out.push({ name: text(s?.item_name), choices: [text(s?.category_name)].filter(Boolean) }))
  Object.values(guest?.multi || {}).forEach((s) => out.push({ name: text(s?.category_name), choices: list(s?.items).map(String) }))
  Object.values(guest?.combo || {}).forEach((s) => out.push({ name: text(s?.combination_name), choices: list(s?.items).map(String) }))
  return out.filter((item) => item.name)
}

function OrderCard({ order, working, onServe }) {
  const served = !!order.meal_served
  return <div className={`kn-order-card kn-tone-${served ? 'gray' : 'amber'}`}>
    <div className="kn-order-head"><div className="kn-order-meta"><strong>{text(order.table_name, 'No table')} {order.seat_number ? `· Seat ${order.seat_number}` : ''}</strong><span className="kn-guest-name">{text(order.name, 'Unnamed guest')}</span></div>
      <span className={`kn-status-pill kn-tone-${served ? 'gray' : 'amber'}`}>{served ? 'Served' : 'Pending'}</span></div>
    <div className="kn-items">{selections(order).map((item, index) => <div className="kn-item" key={`${item.name}-${index}`}><span className="kn-item-name">{item.name}</span><div className="kn-item-choices">{item.choices.map((choice) => <span className="kn-choice-pill" key={choice}>{choice}</span>)}</div></div>)}</div>
    {!selections(order).length && <div className="kn-no-orders">No selection</div>}
    {!served ? <button className="rr-btn primary kn-advance-btn" disabled={working} onClick={() => onServe(order.guest_id)}>{working ? 'Saving…' : 'Mark served'}</button> :
      <div className="kn-served-badge"><Icon name="check" size={13}/> Served</div>}
  </div>
}

export default function KitchenRedesignPage() {
  const [eventId, setEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('orders')
  const [status, setStatus] = useState('pending')
  const [table, setTable] = useState('all')

  useEffect(() => {
    let alive = true
    api.myMenuEvents().then((value) => {
      if (!alive) return
      const available = list(value)
      setEvents(available)
      if (!available.some((event) => event.id === eventId)) setEventId(available.length === 1 ? available[0].id : '')
      if (!available.length) { setError("You don't have order access for any event."); setLoading(false) }
    }).catch((e) => { if (alive) { setError(e.message || 'Could not load order access'); setLoading(false) } })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!eventId) { setData(null); setLoading(false); return }
    setLoading(true); setError('')
    try { setData(await api.getMenuDashboard(eventId)) }
    catch (e) { setData(null); setError(e.message || 'Could not load orders') }
    finally { setLoading(false) }
  }, [eventId])
  useEffect(() => {
    load()
    if (!eventId) return undefined
    const timer = window.setInterval(load, 20000)
    return () => window.clearInterval(timer)
  }, [load, eventId])

  async function markServed(guestId) {
    setWorking(guestId); setError('')
    try { await api.markMealServed(eventId, guestId); await load() }
    catch (e) { setError(e.message || 'Could not mark order served') }
    finally { setWorking('') }
  }

  const guests = list(data?.guests)
  const tables = useMemo(() => [...new Set(guests.map((g) => g.table_name).filter(Boolean))].sort(), [guests])
  const filtered = guests.filter((g) => (status === 'all' || (status === 'served') === !!g.meal_served) && (table === 'all' || g.table_name === table))
  const tally = useMemo(() => {
    const counts = new Map()
    guests.filter((g) => !g.meal_served).flatMap(selections).forEach((item) => counts.set(item.name, (counts.get(item.name) || 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [guests])
  const grouped = tables.map((name) => {
    const group = guests.filter((g) => g.table_name === name)
    return { name, pending: group.filter((g) => !g.meal_served).length, served: group.filter((g) => g.meal_served).length, total: group.length }
  })
  const event = events.find((item) => item.id === eventId)
  const served = guests.filter((g) => g.meal_served).length

  return <RedesignShell topActive="orders"><div className="kn-page">
    <div className="kn-header"><div><h2>Kitchen Display</h2><p className="kn-subtitle">{text(event?.name, 'Orders')} · refreshes every 20 seconds</p></div>
      {events.length > 1 && <select className="rr-select" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Select event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>}</div>
    {error && <ErrorRetryState message={error} onRetry={load}/>}
    {loading ? <LoadingSkeleton rows={6}/> : !eventId ? <EmptyState icon="card" title="Select an event" body="Choose an event with order access."/> : <>
      <div className="kn-summary"><div className="kn-summary-pill kn-tone-amber"><strong>{guests.length - served}</strong><small>Pending</small></div><div className="kn-summary-pill kn-tone-gray"><strong>{served}</strong><small>Served</small></div></div>
      <div className="kn-subtabs"><button className={`kn-subtab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>Order queue</button><button className={`kn-subtab${tab === 'tally' ? ' active' : ''}`} onClick={() => setTab('tally')}>Prep tally</button><button className={`kn-subtab${tab === 'tables' ? ' active' : ''}`} onClick={() => setTab('tables')}>By table</button></div>
      {tab === 'orders' && <><div className="kn-filters"><div className="kn-filter-group"><button className={`kn-filter-btn${table === 'all' ? ' active' : ''}`} onClick={() => setTable('all')}>All tables</button>{tables.map((name) => <button className={`kn-filter-btn${table === name ? ' active' : ''}`} onClick={() => setTable(name)} key={name}>{name}</button>)}</div><div className="kn-filter-group">{[['pending','Pending'],['served','Served'],['all','All']].map(([key,label]) => <button className={`kn-filter-btn${status === key ? ' active' : ''}`} onClick={() => setStatus(key)} key={key}>{label}</button>)}</div></div>
        {!filtered.length ? <EmptyState icon="check" title="Nothing outstanding" body="No orders match the current filters."/> : <div className="kn-order-grid">{filtered.map((order) => <OrderCard key={order.guest_id} order={order} working={working === order.guest_id} onServe={markServed}/>)}</div>}</>}
      {tab === 'tally' && <div className="kn-tally-wrap"><p className="kn-tally-desc">Outstanding selections only.</p><div className="kn-tally-list">{tally.map(([name,count]) => <div className="kn-tally-row" key={name}><span className="kn-tally-name">{name}</span><strong className="kn-tally-count">×{count}</strong></div>)}</div>{!tally.length && <EmptyState icon="check" title="Nothing to prepare" body="All selected orders are served."/>}</div>}
      {tab === 'tables' && <div className="kn-tables-wrap"><table className="kn-table-breakdown"><thead><tr><th>Table</th><th>Pending</th><th>Served</th><th>Total</th></tr></thead><tbody>{grouped.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.pending}</td><td>{row.served}</td><td>{row.total}</td></tr>)}</tbody></table></div>}
    </>}
  </div></RedesignShell>
}
