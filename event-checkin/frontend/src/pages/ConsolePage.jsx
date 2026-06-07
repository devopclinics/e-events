import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'operators', label: 'Operators' },
]

// ── Overview: all orgs + events, with comp/credit grant ─────────────────────
function OverviewTab() {
  const [orgs, setOrgs] = useState(null)
  const [plans, setPlans] = useState([])
  const [msg, setMsg] = useState('')

  function load() { api.adminOverview().then(setOrgs).catch((e) => setMsg(e.message)) }
  useEffect(() => { load(); api.adminListPlans().then((p) => setPlans(p.filter((x) => x.kind === 'tier'))).catch(() => {}) }, [])

  async function grant(eventId, body) {
    setMsg('')
    try { await api.adminGrant(eventId, body); load(); setMsg('Applied.') ; setTimeout(() => setMsg(''), 2500) }
    catch (e) { setMsg(e.message) }
  }

  if (!orgs) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-6">
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      {orgs.map((o) => (
        <div key={o.id} className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 border dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="font-semibold dark:text-white">{o.name} <span className="text-xs text-slate-400">· {o.region}/{o.currency} · {o.events.length} event(s)</span></div>
          </div>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-700">
            {o.events.map((e) => <EventRow key={e.id} ev={e} plans={plans} onGrant={grant} />)}
            {o.events.length === 0 && <div className="text-xs text-slate-400 py-2">No events.</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function EventRow({ ev, plans, onGrant }) {
  const [tier, setTier] = useState('')
  const [credits, setCredits] = useState('')
  return (
    <div className="py-2 flex items-center gap-3 flex-wrap text-sm">
      <div className="flex-1 min-w-[160px]">
        <span className="font-medium dark:text-slate-100">{ev.name}</span>
        <span className="ml-2 text-xs text-slate-400">{ev.is_paid ? `${ev.plan_tier}` : 'free'} · {ev.message_credits} cr · {ev.status}</span>
      </div>
      <select value={tier} onChange={(e) => setTier(e.target.value)} className="border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
        <option value="">comp tier…</option>
        {plans.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
      </select>
      <input value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="+credits" type="number"
        className="w-24 border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white" />
      <button
        onClick={() => onGrant(ev.id, { tier: tier || undefined, add_credits: credits ? Number(credits) : undefined })}
        disabled={!tier && !credits}
        className="bg-teal-600 text-white px-3 py-1 rounded text-xs font-semibold disabled:opacity-40 hover:bg-teal-700">
        Grant
      </button>
    </div>
  )
}

// ── Pricing: edit plans ─────────────────────────────────────────────────────
function PricingTab() {
  const [plans, setPlans] = useState(null)
  const [msg, setMsg] = useState('')
  function load() { api.adminListPlans().then(setPlans).catch((e) => setMsg(e.message)) }
  useEffect(() => { load() }, [])

  async function save(p) {
    setMsg('')
    try {
      await api.adminSavePlan(p.key, {
        kind: p.kind, label: p.label, guest_cap: p.guest_cap === '' ? null : Number(p.guest_cap),
        credits: Number(p.credits), usd: Number(p.usd), ngn: Number(p.ngn),
        active: !!p.active, sort_order: Number(p.sort_order),
      })
      setMsg(`Saved ${p.key}.`); setTimeout(() => setMsg(''), 2500)
    } catch (e) { setMsg(e.message) }
  }
  function edit(i, k, v) { setPlans((prev) => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p)) }

  if (!plans) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-2">
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      <p className="text-xs text-slate-500 dark:text-slate-400">Prices are in the smallest unit — USD cents, NGN kobo. Changes reflect on the live pricing page and checkout.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr><th className="p-2">key</th><th>kind</th><th>label</th><th>cap</th><th>credits</th><th>usd¢</th><th>ngn(kobo)</th><th>active</th><th></th></tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.key} className="border-t dark:border-slate-700">
                <td className="p-2 font-mono dark:text-slate-200">{p.key}</td>
                <td>{p.kind}</td>
                <td><input value={p.label} onChange={(e) => edit(i, 'label', e.target.value)} className="w-32 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={p.guest_cap ?? ''} onChange={(e) => edit(i, 'guest_cap', e.target.value)} className="w-14 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={p.credits} onChange={(e) => edit(i, 'credits', e.target.value)} className="w-16 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={p.usd} onChange={(e) => edit(i, 'usd', e.target.value)} className="w-20 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={p.ngn} onChange={(e) => edit(i, 'ngn', e.target.value)} className="w-24 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input type="checkbox" checked={!!p.active} onChange={(e) => edit(i, 'active', e.target.checked)} /></td>
                <td><button onClick={() => save(p)} className="bg-teal-600 text-white px-2 py-1 rounded font-semibold hover:bg-teal-700">Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Operators ───────────────────────────────────────────────────────────────
function OperatorsTab({ me }) {
  const [ops, setOps] = useState(null)
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  function load() { api.adminListOperators().then(setOps).catch((e) => setMsg(e.message)) }
  useEffect(() => { load() }, [])

  async function add() {
    if (!email.trim()) return
    setMsg('')
    try { await api.adminAddOperator(email.trim()); setEmail(''); load(); setMsg('Operator added.') }
    catch (e) { setMsg(e.message) }
  }
  async function remove(id) {
    if (!confirm('Revoke operator access?')) return
    try { await api.adminRemoveOperator(id); load() } catch (e) { setMsg(e.message) }
  }

  if (!ops) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-3 max-w-lg">
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      <ul className="divide-y divide-gray-100 dark:divide-slate-700">
        {ops.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2 text-sm">
            <span className="dark:text-slate-200">{u.name} · <span className="text-slate-400">{u.email}</span></span>
            {u.id !== me?.id && <button onClick={() => remove(u.id)} className="text-xs text-red-500 hover:underline">Revoke</button>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="operator@email.com"
          className="flex-1 border dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-white" />
        <button onClick={add} disabled={!email.trim()} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-teal-700">Add</button>
      </div>
    </div>
  )
}

export default function ConsolePage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('overview')
  if (user === undefined) return null
  if (!user?.is_platform_superadmin) return <Navigate to="/" replace />

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">
      <h1 className="text-2xl font-bold dark:text-white">Operator Console</h1>
      <div className="flex gap-2 border-b dark:border-slate-700">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.id ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'operators' && <OperatorsTab me={user} />}
    </div>
  )
}
