import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

// Staff-facing catering/orders view. Visible to anyone the organizer granted
// menu access (can_manage_menu) — the API enforces it; this page just surfaces
// the orders so kitchen/catering staff don't need full Admin access.

function choicePills(g) {
  const out = []
  for (const sel of Object.values(g.single || {})) out.push(`${sel.category_name}: ${sel.item_name}`)
  for (const sel of Object.values(g.multi || {})) out.push(`${sel.category_name}: ${(sel.items || []).join(', ')}`)
  for (const sel of Object.values(g.combo || {})) {
    const items = (sel.items || []).join(', ')
    out.push(`${sel.category_name}: ${sel.combination_name}${items ? ` (${items})` : ''}`)
  }
  return out
}

export default function KitchenPage() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(null)
  const [statusF, setStatusF] = useState('pending')   // pending | served | all
  const [tableF, setTableF] = useState('all')

  useEffect(() => {
    api.listEvents().then((evs) => {
      const active = evs.filter((e) => e.menu_enabled)
      setEvents(active.length ? active : evs)
      if ((active.length ? active : evs).length === 1) setEventId((active.length ? active : evs)[0].id)
    }).catch(() => {})
  }, [])

  const load = useCallback(async (id) => {
    if (!id) return
    setLoading(true); setErr('')
    try { setData(await api.getMenuDashboard(id)) }
    catch (e) { setErr(e.message || 'Could not load orders'); setData(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!eventId) { setData(null); return }
    load(eventId)
    const t = setInterval(() => load(eventId), 20000)
    return () => clearInterval(t)
  }, [eventId, load])

  async function markServed(guestId) {
    setWorking(guestId)
    try { await api.markMealServed(eventId, guestId); load(eventId) }
    catch (e) { setErr(e.message) }
    finally { setWorking(null) }
  }

  const guests = data?.guests || []
  // Global "to prepare" tally from every guest's choices (robust to payload shape)
  const cook = (() => {
    const m = new Map()
    const bump = (k) => m.set(k, (m.get(k) || 0) + 1)
    for (const g of guests) {
      if (g.meal_served && statusF === 'pending') continue
      for (const s of Object.values(g.single || {})) bump(s.item_name)
      for (const s of Object.values(g.multi || {})) for (const n of (s.items || [])) bump(n)
      for (const s of Object.values(g.combo || {})) bump(s.combination_name)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })()
  const tables = Array.from(new Set(guests.map((g) => g.table_name).filter(Boolean))).sort()
  const served = guests.filter((g) => g.meal_served).length
  const filtered = guests.filter((g) =>
    (statusF === 'all' || (statusF === 'served') === !!g.meal_served) &&
    (tableF === 'all' || g.table_name === tableF))

  const ev = events.find((e) => e.id === eventId)
  const btn = (active) => `text-xs px-3 py-1.5 rounded-lg font-semibold ${active ? 'bg-amber-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold dark:text-white">🍽️ Kitchen — Orders</h1>

      {events.length > 1 && (
        <select className="w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">— select event —</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.couples_name ? `${e.name} — ${e.couples_name}` : e.name}</option>)}
        </select>
      )}

      {err && <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 text-sm">{err}</div>}

      {data && (
        <>
          {ev && <div className="text-sm text-slate-500 dark:text-slate-400">{ev.name} · {served}/{guests.length} meals served</div>}

          {/* To prepare */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-2xl shadow-sm p-5">
            <h2 className="font-semibold dark:text-white mb-3">To prepare {statusF === 'pending' ? '(not yet served)' : ''}</h2>
            {cook.length === 0 ? <p className="text-sm text-slate-400">Nothing outstanding.</p> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {cook.map(([item, n]) => (
                  <div key={item} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
                    <span className="text-sm dark:text-slate-100 truncate">{item}</span>
                    <span className="text-lg font-extrabold text-amber-600 ml-2">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {[['pending', 'Pending'], ['served', 'Served'], ['all', 'All']].map(([k, l]) => (
              <button key={k} onClick={() => setStatusF(k)} className={btn(statusF === k)}>{l}</button>
            ))}
            {tables.length > 0 && (
              <select value={tableF} onChange={(e) => setTableF(e.target.value)}
                className="text-xs border border-gray-300 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 dark:text-white">
                <option value="all">All tables</option>
                {tables.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <button onClick={() => load(eventId)} disabled={loading} className="text-xs text-teal-600 hover:underline ml-auto disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>

          {/* Orders list */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-2xl shadow-sm divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">No orders match.</div> :
              filtered.map((g) => {
                const pills = choicePills(g)
                return (
                  <div key={g.guest_id} className="flex items-start gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium dark:text-slate-100">
                        {g.name} {g.table_name && <span className="text-xs text-slate-400">· {g.table_name}</span>}
                      </div>
                      {pills.length ? (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{pills.join('  ·  ')}</div>
                      ) : <div className="text-xs italic text-slate-400 mt-0.5">No selection</div>}
                    </div>
                    {g.meal_served
                      ? <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 shrink-0">Served ✓</span>
                      : <button onClick={() => markServed(g.guest_id)} disabled={working === g.guest_id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 shrink-0">
                          {working === g.guest_id ? '…' : 'Mark served'}
                        </button>}
                  </div>
                )
              })}
          </div>
        </>
      )}

      {!eventId && events.length !== 1 && !err && (
        <div className="text-center py-12 text-slate-400 text-sm">Select an event to see its orders.</div>
      )}
    </div>
  )
}
