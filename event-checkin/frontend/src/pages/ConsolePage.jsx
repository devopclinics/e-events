import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'usage', label: 'Usage' },
  { id: 'trials', label: 'Trial requests' },
  { id: 'qa', label: 'QA checklist' },
  { id: 'support', label: 'Support chat' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'org-plans', label: 'Org Plans' },
  { id: 'affiliates', label: 'Affiliate stores' },
  { id: 'operators', label: 'Operators' },
]

// ── Accounts summary: aggregated per-org stats for quick assessment ─────────
function AccountsSummaryTable() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => { api.adminAccountsSummary().then(setRows).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="text-sm text-red-500">{err}</div>
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>

  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? rows.filter((r) => r.name.toLowerCase().includes(needle)
        || (r.owner_email || '').toLowerCase().includes(needle)
        || (r.owner_name || '').toLowerCase().includes(needle))
    : rows

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow border dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b dark:border-slate-700 flex-wrap">
        <div>
          <h2 className="font-semibold dark:text-white">Accounts at a glance</h2>
          <p className="text-xs text-slate-400">{filtered.length} of {rows.length} organization(s)</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search org or owner…"
          className="border dark:border-slate-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-700 dark:text-white w-56" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Organization</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Events</th>
              <th className="px-3 py-2">Types</th>
              <th className="px-3 py-2">Credits (used / left)</th>
              <th className="px-3 py-2">Last event</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((r) => (
              <tr key={r.id} className={!r.is_active ? 'opacity-50' : ''}>
                <td className="px-3 py-2">
                  <div className="font-medium dark:text-slate-100">{r.name}</div>
                  <div className="text-xs text-slate-400">{r.member_count} member(s){!r.is_active ? ' · suspended' : ''}</div>
                </td>
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="dark:text-slate-100">{r.owner_name || '—'}</div>
                  <div className="text-xs text-slate-400">{r.owner_email || ''}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.paid_event_count > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300'}`}>
                    {r.paid_event_count > 0 ? `Paid (${r.paid_event_count})` : 'Free'}
                  </span>
                </td>
                <td className="px-3 py-2 dark:text-slate-200">{r.event_count}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {r.event_types.length ? r.event_types.join(', ') : '—'}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <span className="text-slate-500 dark:text-slate-400">{r.message_credits_spent} used</span>
                  {' / '}
                  <span className="dark:text-slate-200">{r.message_credits_remaining} left</span>
                </td>
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {r.last_event_at ? new Date(r.last_event_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No matching organizations.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Usage: messaging usage per org, per channel (email/SMS/WhatsApp/MMS) ────
const USAGE_CHANNELS = ['email', 'sms', 'whatsapp', 'mms']

function UsageTab() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => { api.adminUsageReport().then(setData).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="text-sm text-red-500">{err}</div>
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>

  const needle = q.trim().toLowerCase()
  const orgs = needle ? data.orgs.filter((o) => o.org_name.toLowerCase().includes(needle)) : data.orgs

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow border dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b dark:border-slate-700 flex-wrap">
        <div>
          <h2 className="font-semibold dark:text-white">Messaging usage by organization</h2>
          <p className="text-xs text-slate-400">All send types (broadcasts, invites, reminders, confirmations, ...) — {orgs.length} of {data.orgs.length} organization(s)</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search org…"
          className="border dark:border-slate-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-700 dark:text-white w-56" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Organization</th>
              {USAGE_CHANNELS.map((c) => <th key={c} className="px-3 py-2">{c.toUpperCase()}</th>)}
              <th className="px-3 py-2">Total sends</th>
              <th className="px-3 py-2">Credits spent</th>
              <th className="px-3 py-2">Provider cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {orgs.map((o) => (
              <tr key={o.org_id}>
                <td className="px-3 py-2 font-medium dark:text-slate-100">{o.org_name}</td>
                {USAGE_CHANNELS.map((c) => (
                  <td key={c} className="px-3 py-2 text-slate-600 dark:text-slate-300">{o.channels[c]?.sends ?? 0}</td>
                ))}
                <td className="px-3 py-2 dark:text-slate-200">{o.total_sends}</td>
                <td className="px-3 py-2 dark:text-slate-200">{o.total_credits}</td>
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">${(o.total_cost_cents / 100).toFixed(2)}</td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr><td colSpan={USAGE_CHANNELS.length + 4} className="px-3 py-6 text-center text-slate-400">No matching organizations.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

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
      <AccountsSummaryTable />
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 pt-2">Grant &amp; comp</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
        <strong>Comp a plan</strong> to make an event paid — that unlocks SMS/WhatsApp, seating, menu &amp; QR check-in.
        <strong> Add credits</strong> only tops up the message balance (it does <em>not</em> unlock features).
      </p>
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      {orgs.map((o) => (
        <div key={o.id} className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 border dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="font-semibold dark:text-white">{o.name} <span className="text-xs text-slate-400">· {o.region}/{o.currency} · {o.events.length} event(s)</span></div>
            <AddonOverrideEditor scope="org" id={o.id} label="Organization add-ons" />
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

const MESSAGING_CHANNELS = [['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['mms', 'MMS']]
const COMM_FEATURES = [['guest_hub', 'FestioHub'], ['guest_chat', 'Guest Chat'], ['host_messages', 'Message Host'], ['announcements', 'Announcements'], ['festiome', 'FestioMe']]

const ADDON_LABELS = {
  addon_registry: 'Registry', addon_menu: 'Menu & Orders', addon_planner: 'Event Planner',
  addon_logistics: 'Logistics', addon_festiome: 'FestioMe Community', addon_seating: 'Seating & Floor Plans',
  addon_experience: 'Experience Workflows', addon_venue_access: 'Venue Access Intelligence',
}

function AddonOverrideEditor({ scope, id, label }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = async () => setData(scope === 'org' ? await api.adminOrgAddonOverrides(id) : await api.adminEventAddonOverrides(id))
  async function toggle() {
    if (!open && !data) { try { await load() } catch (e) { alert(e.message); return } }
    setOpen((value) => !value)
  }
  function setValue(key, value) {
    setData((current) => {
      const overrides = { ...(current?.overrides || {}) }
      if (value === null) delete overrides[key]
      else overrides[key] = value
      return { ...current, overrides }
    })
  }
  async function saveAll(value) {
    const overrides = Object.fromEntries((data?.addons || Object.keys(ADDON_LABELS)).map((key) => [key, value]))
    setData((current) => ({ ...current, overrides }))
    await save(overrides)
  }
  async function save(overrides = data?.overrides || {}) {
    setSaving(true)
    try {
      const next = scope === 'org' ? await api.adminSetOrgAddonOverrides(id, overrides) : await api.adminSetEventAddonOverrides(id, overrides)
      setData(next)
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }
  return <div className="relative">
    <button className="text-xs font-semibold text-teal-700 dark:text-teal-300" onClick={toggle}>{label}</button>
    {open && data && <div className="absolute right-0 z-20 mt-2 w-[430px] rounded-xl border bg-white p-3 shadow-xl dark:border-slate-600 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between"><strong className="text-sm dark:text-white">{label}</strong><div className="flex gap-1"><button className="rounded bg-teal-600 px-2 py-1 text-xs text-white" disabled={saving} onClick={() => saveAll(true)}>Allow all</button><button className="rounded bg-rose-600 px-2 py-1 text-xs text-white" disabled={saving} onClick={() => saveAll(false)}>Disallow all</button></div></div>
      <div className="space-y-2">{(data.addons || Object.keys(ADDON_LABELS)).map((key) => <div key={key} className="flex items-center justify-between gap-2 text-xs dark:text-slate-200"><span>{ADDON_LABELS[key] || key}</span><div className="flex rounded border dark:border-slate-600">{[[null, 'Inherit'], [true, 'Allow'], [false, 'Disallow']].map(([value, text]) => { const selected = value === null ? !(key in (data.overrides || {})) : data.overrides?.[key] === value; return <button key={text} className={`px-2 py-1 ${selected ? 'bg-teal-600 text-white' : ''}`} onClick={() => setValue(key, value)}>{text}</button> })}</div></div>)}</div>
      <div className="mt-3 flex justify-end gap-2"><button className="rounded border px-3 py-1 text-xs dark:border-slate-600" onClick={() => setOpen(false)}>Close</button><button className="rounded bg-teal-600 px-3 py-1 text-xs text-white" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</button></div>
    </div>}
  </div>
}

function EventRow({ ev, plans, onGrant }) {
  const [tier, setTier] = useState('')
  const [credits, setCredits] = useState('')
  const [reportBusy, setReportBusy] = useState('')
  const [controls, setControls] = useState(null)   // { blocked_messaging_channels, blocked_comm_features }
  const [savingCtl, setSavingCtl] = useState(false)

  async function openControls() {
    if (controls) { setControls(null); return }
    try { setControls(await api.adminEventControls(ev.id)) }
    catch (e) { window.alert(e.message) }
  }
  function toggleBlock(kind, key) {
    setControls((c) => {
      const set = new Set(c[kind] || [])
      set.has(key) ? set.delete(key) : set.add(key)
      return { ...c, [kind]: [...set] }
    })
  }
  async function saveControls() {
    setSavingCtl(true)
    try { setControls(await api.adminSetEventControls(ev.id, controls)) }
    catch (e) { window.alert(e.message) }
    finally { setSavingCtl(false) }
  }

  async function previewReport() {
    setReportBusy('preview')
    try { await api.adminPreviewReadinessReport(ev.id) }
    catch (e) { window.alert(e.message) }
    finally { setReportBusy('') }
  }

  async function sendReport() {
    const custom = window.prompt('Send to the organization owner by default.\n\nOptionally enter a different recipient email, or leave blank for the owner:')
    if (custom === null) return
    setReportBusy('send')
    try {
      const result = await api.adminSendReadinessReport(ev.id, custom.trim())
      window.alert(`Readiness report queued for ${result.email}.`)
    } catch (e) { window.alert(e.message) }
    finally { setReportBusy('') }
  }
  return (
    <div className="py-3">
    <div className="flex items-end gap-4 flex-wrap text-sm">
      <div className="flex-1 min-w-[180px]">
        <span className="font-medium dark:text-slate-100">{ev.name}</span>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full font-medium ${ev.is_paid ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300'}`}>
            {ev.is_paid ? `Paid · ${ev.plan_tier}` : 'Free'}
          </span>
          <span className="text-slate-400">{ev.message_credits} credits · {ev.status}</span>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Comp a plan <span className="font-normal">(unlocks paid features)</span></label>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
          <option value="">— no change —</option>
          {plans.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Add credits <span className="font-normal">(messaging only)</span></label>
        <input value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="0" type="number"
          className="w-20 border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white" />
      </div>
      <button
        onClick={() => { onGrant(ev.id, { tier: tier || undefined, add_credits: credits ? Number(credits) : undefined }); setTier(''); setCredits('') }}
        disabled={!tier && !credits}
        className="bg-teal-600 text-white px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 hover:bg-teal-700">
        Apply
      </button>
      <div className="flex gap-2">
        <AddonOverrideEditor scope="event" id={ev.id} label="Event add-ons" />
        <button onClick={previewReport} disabled={!!reportBusy}
          className="border border-indigo-300 text-indigo-700 dark:border-indigo-700 dark:text-indigo-300 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 hover:bg-indigo-50 dark:hover:bg-indigo-950/30">
          {reportBusy === 'preview' ? 'Generating…' : 'Readiness report'}
        </button>
        <button onClick={sendReport} disabled={!!reportBusy}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 hover:bg-indigo-700">
          {reportBusy === 'send' ? 'Sending…' : 'Send to owner'}
        </button>
        <button onClick={openControls}
          className="border border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300 px-3 py-1.5 rounded text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30">
          {controls ? 'Close controls' : 'Channel controls'}
        </button>
      </div>
    </div>
    {controls && (
      <div className="mt-3 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20 p-3">
        <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-2">
          Operator hard-block — organizers <strong>cannot</strong> override these. Click a chip to block it (red = blocked).
        </p>
        <div className="mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Messaging channels</div>
          <div className="flex flex-wrap gap-1.5">
            {MESSAGING_CHANNELS.map(([key, label]) => {
              const blocked = (controls.blocked_messaging_channels || []).includes(key)
              return (
                <button key={key} onClick={() => toggleBlock('blocked_messaging_channels', key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${blocked
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-300 dark:border-slate-600'}`}>
                  {blocked ? '⛔ ' : ''}{label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Communication features</div>
          <div className="flex flex-wrap gap-1.5">
            {COMM_FEATURES.map(([key, label]) => {
              const blocked = (controls.blocked_comm_features || []).includes(key)
              return (
                <button key={key} onClick={() => toggleBlock('blocked_comm_features', key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${blocked
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-300 dark:border-slate-600'}`}>
                  {blocked ? '⛔ ' : ''}{label}
                </button>
              )
            })}
          </div>
        </div>
        <button onClick={saveControls} disabled={savingCtl}
          className="bg-rose-600 text-white px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 hover:bg-rose-700">
          {savingCtl ? 'Saving…' : 'Save blocks'}
        </button>
      </div>
    )}
    </div>
  )
}

// ── Accounts: suspend/delete orgs, manage members, suspend/delete users ─────
function AccountsTab({ me }) {
  const [orgs, setOrgs] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  function load() { api.adminListAccounts().then(setOrgs).catch((e) => setErr(e.message)) }
  useEffect(load, [])

  async function run(fn, ok) {
    setMsg(''); setErr('')
    try { await fn(); load(); if (ok) { setMsg(ok); setTimeout(() => setMsg(''), 2500) } }
    catch (e) { setErr(e.message) }
  }

  if (!orgs) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
        <strong>Suspend</strong> is reversible (blocks access / sign-in). <strong>Delete</strong> is permanent.
        Deleting an org removes all its events &amp; data; deleting a user also disables their sign-in.
      </p>
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      {err && <div className="text-sm text-red-500">{err}</div>}
      {orgs.map((o) => (
        <div key={o.id} className={`bg-white dark:bg-slate-800 rounded-xl shadow p-4 border ${o.is_active ? 'dark:border-slate-700' : 'border-amber-300 dark:border-amber-700'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold dark:text-white flex items-center gap-2">
              {o.name}
              {!o.is_active && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Suspended</span>}
              <span className="text-xs text-slate-400 font-normal">· {o.event_count} event(s) · {o.members.length} member(s)</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
                Redesign
                <select value={o.redesign_cohort} onChange={(e) => run(() => api.adminSetOrgRedesignCohort(o.id, e.target.value), 'Redesign cohort updated.')}
                  className="border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
                  {['legacy_only', 'redesign_opt_in', 'redesign_internal', 'redesign_default', 'legacy_retired'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <button onClick={() => {
                if (o.is_active && !window.confirm(`Suspend ${o.name}? Members will lose access until it is reactivated.`)) return
                run(() => api.adminSetOrgActive(o.id, !o.is_active), o.is_active ? 'Org suspended.' : 'Org reactivated.')
              }}
                className="text-xs font-semibold px-3 py-1.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30">
                {o.is_active ? 'Suspend' : 'Reactivate'}
              </button>
              <button onClick={() => { if (window.prompt(`Type the org name to permanently DELETE it and all its data:\n\n${o.name}`) === o.name) run(() => api.adminDeleteOrg(o.id), 'Org deleted.') }}
                className="text-xs font-semibold px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-slate-700">
            {o.members.map((m) => (
              <div key={m.user_id} className="py-2 flex items-center gap-3 flex-wrap text-sm">
                <div className="flex-1 min-w-[180px]">
                  <span className="dark:text-slate-100">{m.name}</span>
                  <span className="text-xs text-slate-400 ml-2">{m.email}</span>
                  {!m.is_active && <span className="text-[11px] ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">suspended</span>}
                  {m.is_platform_superadmin && <span className="text-[11px] ml-2 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">operator</span>}
                </div>
                <select value={m.role} onChange={(e) => run(() => api.adminSetMemberRole(o.id, m.user_id, e.target.value))}
                  className="border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
                  {['owner', 'admin', 'staff'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => {
                  if (!window.confirm(`Remove ${m.email} from ${o.name}?`)) return
                  run(() => api.adminRemoveMember(o.id, m.user_id), 'Removed from org.')
                }}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white">Remove</button>
                {m.user_id !== me.id && (
                  <>
                    <button onClick={() => {
                      if (m.is_active && !window.confirm(`Suspend ${m.email}? They will be unable to sign in.`)) return
                      run(() => api.adminSetUserActive(m.user_id, !m.is_active), 'Updated.')
                    }}
                      className="text-xs text-amber-600 dark:text-amber-400 hover:underline">
                      {m.is_active ? 'Suspend user' : 'Reactivate'}
                    </button>
                    <button onClick={() => { if (window.confirm(`Permanently delete ${m.email}? This disables their sign-in.`)) run(() => api.adminDeleteUser(m.user_id), 'User deleted.') }}
                      className="text-xs text-red-500 hover:text-red-700">Delete user</button>
                  </>
                )}
              </div>
            ))}
            {o.members.length === 0 && <div className="text-xs text-slate-400 py-2">No members.</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Trial requests: approve (comp an event) / decline ───────────────────────
function TrialsTab() {
  const [reqs, setReqs] = useState(null)
  const [orgs, setOrgs] = useState([])
  const [plans, setPlans] = useState([])
  const [msg, setMsg] = useState('')

  function load() { api.adminListTrials().then(setReqs).catch((e) => setMsg(e.message)) }
  useEffect(() => {
    load()
    api.adminOverview().then(setOrgs).catch(() => {})
    api.adminListPlans().then((p) => setPlans(p.filter((x) => x.kind === 'tier'))).catch(() => {})
  }, [])

  async function resolve(id, body) {
    setMsg('')
    try { await api.adminResolveTrial(id, body); load(); setMsg('Done.'); setTimeout(() => setMsg(''), 2500) }
    catch (e) { setMsg(e.message) }
  }

  if (!reqs) return <div className="text-sm text-slate-500">Loading…</div>
  const pending = reqs.filter((r) => r.status === 'pending')
  const resolved = reqs.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
        Approve a request by comping one of the org’s events onto a tier and/or adding credits — same as the Overview grant. Declining just records the decision.
      </p>
      {msg && <div className="text-sm text-teal-600">{msg}</div>}

      {pending.length === 0 && <div className="text-sm text-slate-400">No pending requests.</div>}
      {pending.map((r) => {
        const org = orgs.find((o) => o.id === r.org_id)
        return <TrialRow key={r.id} req={r} events={org?.events || []} plans={plans} onResolve={resolve} />
      })}

      {resolved.length > 0 && (
        <div className="pt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Resolved</div>
          <div className="space-y-1">
            {resolved.map((r) => (
              <div key={r.id} className="text-xs text-slate-500 dark:text-slate-400 flex gap-2 items-center">
                <span className={`px-2 py-0.5 rounded-full font-medium ${r.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-700'}`}>{r.status}</span>
                <span className="font-medium text-slate-600 dark:text-slate-300">{r.org_name}</span>
                <span>· {r.event_name || '—'} · {r.contact_name}</span>
                {r.resolution_note && <span className="italic">“{r.resolution_note}”</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TrialRow({ req, events, plans, onResolve }) {
  const [eventId, setEventId] = useState('')
  const [tier, setTier] = useState('')
  const [credits, setCredits] = useState('')
  const [note, setNote] = useState('')
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 border dark:border-slate-700 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold dark:text-white">{req.org_name}</span>
        <span className="text-slate-400 text-xs">· {req.requester_email}</span>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-300 grid sm:grid-cols-2 gap-x-6 gap-y-1">
        <span><strong>Contact:</strong> {req.contact_name}</span>
        <span><strong>Phone:</strong> {req.phone || '—'}</span>
        <span><strong>Event:</strong> {req.event_name || '—'}</span>
        <span><strong>Expected guests:</strong> {req.guest_count ?? '—'}</span>
        <span className="sm:col-span-2"><strong>Wants:</strong> {req.use_case || '—'}</span>
      </div>

      <div className="flex items-end gap-3 flex-wrap border-t dark:border-slate-700 pt-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Apply to event <span className="font-normal">(optional)</span></label>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
            <option value="">{events.length ? '— their next event —' : '— no events yet —'}</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.is_paid ? ` (paid)` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Tier</label>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
            <option value="">— none —</option>
            {plans.map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Credits</label>
          <input value={credits} onChange={(e) => setCredits(e.target.value)} type="number" placeholder="0"
            className="w-20 border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white" />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
          className="flex-1 min-w-[140px] border dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white" />
        <div className="flex gap-2">
          <button onClick={() => onResolve(req.id, { action: 'approve', event_id: eventId || undefined, tier: tier || undefined, add_credits: credits ? Number(credits) : undefined, note: note || undefined })}
            className="bg-teal-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-teal-700">Approve</button>
          <button onClick={() => onResolve(req.id, { action: 'decline', note: note || undefined })}
            className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-slate-600 dark:text-slate-200 px-3 py-1.5 rounded text-xs font-semibold hover:bg-gray-50">Decline</button>
        </div>
      </div>
    </div>
  )
}

// ── QA checklist: submissions from the standalone staging checklist page ────
const QA_STATUS_STYLE = {
  pass: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  issue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  blocked: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  na: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300',
}
const QA_STATUS_LABEL = { pass: 'Pass', issue: 'Issue', blocked: 'Blocked', na: 'N/A' }

function QaChecklistCounts({ row }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {row.pass_count > 0 && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.pass}`}>{row.pass_count} pass</span>}
      {row.issue_count > 0 && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.issue}`}>{row.issue_count} issue</span>}
      {row.blocked_count > 0 && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.blocked}`}>{row.blocked_count} blocked</span>}
      {row.na_count > 0 && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${QA_STATUS_STYLE.na}`}>{row.na_count} n/a</span>}
    </div>
  )
}

function QaChecklistDetail({ id, onClose }) {
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.qaChecklistSubmission(id).then(setDetail).catch((e) => setErr(e.message)) }, [id])

  if (err) return <div className="text-sm text-red-500 p-4">{err}</div>
  if (!detail) return <div className="text-sm text-slate-500 p-4">Loading…</div>

  const bySection = []
  const seen = new Map()
  for (const item of detail.results) {
    let group = seen.get(item.section_id)
    if (!group) {
      group = { section_id: item.section_id, section_title: item.section_title || item.section_id, items: [] }
      seen.set(item.section_id, group)
      bySection.push(group)
    }
    group.items.push(item)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-3xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 rounded-t-xl">
          <div>
            <h3 className="font-semibold dark:text-white">{detail.tester_name}</h3>
            <p className="text-xs text-slate-400">{new Date(detail.created_at).toLocaleString()} · {detail.summary}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">&times;</button>
        </div>
        <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {bySection.map((group) => (
            <div key={group.section_id}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{group.section_title}</h4>
              <div className="space-y-2">
                {group.items.map((it) => (
                  <div key={it.case_id} className="border dark:border-slate-700 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-medium dark:text-slate-100">{it.case_title || it.case_id}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${QA_STATUS_STYLE[it.status] || QA_STATUS_STYLE.na}`}>
                        {QA_STATUS_LABEL[it.status] || it.status}
                      </span>
                    </div>
                    {it.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 whitespace-pre-wrap">{it.note}</p>}
                    {it.evidence && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-mono break-all">{it.evidence}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function QaChecklistTab() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => { api.qaChecklistSubmissions().then(setRows).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="text-sm text-red-500">{err}</div>
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
        Every "Save" click from <code>/media/festio-qa-checklist.html</code> lands here — testers don't need an account.
        Click a row for the full per-case breakdown (notes, evidence).
      </p>
      {rows.length === 0 && <div className="text-sm text-slate-400">No submissions yet.</div>}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow border dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
        {rows.map((r) => (
          <button key={r.id} onClick={() => setOpenId(r.id)}
            className="w-full text-left p-4 flex items-center justify-between gap-3 flex-wrap hover:bg-slate-50 dark:hover:bg-slate-700/50">
            <div>
              <div className="font-medium dark:text-slate-100">{r.tester_name}</div>
              <div className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()} · {r.tested_count} tested</div>
            </div>
            <QaChecklistCounts row={r} />
          </button>
        ))}
      </div>
      {openId && <QaChecklistDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

// ── Pricing: edit plans ─────────────────────────────────────────────────────
// Channel weight editor shared by the global-default and per-org-override
// panels below. `rows` = [{channel, credits_per_unit, is_override, effective_rate?}].
// `onSave(channel, value)` / `onClear(channel)` (onClear omitted for the
// global panel — there's nothing to "clear" back to, it IS the default).
function CreditRateTable({ rows, onSave, onClear, msg }) {
  const [drafts, setDrafts] = useState({})
  function draftFor(row) { return drafts[row.channel] ?? row.credits_per_unit ?? '' }
  return (
    <div className="space-y-2">
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr>
              <th className="p-2">channel</th>
              <th>credits per unit</th>
              {onClear && <th>effective rate</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.channel} className="border-t dark:border-slate-700">
                <td className="p-2 font-mono dark:text-slate-200">{row.channel}</td>
                <td>
                  <input
                    value={draftFor(row)}
                    placeholder={onClear ? '(inherits global)' : ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.channel]: e.target.value }))}
                    className="w-24 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white"
                  />
                </td>
                {onClear && (
                  <td className="text-slate-500 dark:text-slate-400 tabular-nums">
                    {row.effective_rate}{row.is_override ? '' : ' (global)'}
                  </td>
                )}
                <td className="space-x-1 whitespace-nowrap">
                  <button
                    onClick={() => onSave(row.channel, Number(draftFor(row)))}
                    disabled={!draftFor(row) || Number(draftFor(row)) <= 0}
                    className="bg-teal-600 text-white px-2 py-1 rounded font-semibold hover:bg-teal-700 disabled:opacity-40"
                  >
                    Save
                  </button>
                  {onClear && row.is_override && (
                    <button onClick={() => onClear(row.channel)} className="text-red-500 hover:text-red-700 px-1">Clear</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Global default credit weight per messaging channel — what every org pays
// unless it has its own override (see OrgCreditRatesPanel below). Replaces
// the old MESSAGE_CREDIT_WEIGHTS env var, which needed a redeploy to change.
function GlobalCreditRatesPanel() {
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')
  function load() { api.adminListGlobalCreditRates().then(setRows).catch((e) => setMsg(e.message)) }
  useEffect(() => { load() }, [])

  async function save(channel, value) {
    setMsg('')
    try {
      await api.adminSaveGlobalCreditRate(channel, value)
      setMsg(`Saved ${channel}.`); setTimeout(() => setMsg(''), 2500)
      load()
    } catch (e) { setMsg(e.message) }
  }

  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Credits charged per send, by channel — applies to every org unless overridden below. Can be a
        fraction (e.g. 0.1 = 10 emails per credit) or 1+ (e.g. 3 = 3 credits per MMS). See team-docs §2c
        for how these were derived.
      </p>
      <CreditRateTable rows={rows} onSave={save} msg={msg} />
    </div>
  )
}

// Per-org negotiated credit rate override — for deals struck outside the
// standard pricing. Only channels with an explicit override row differ from
// the global default; everything else falls through automatically.
function OrgCreditRatesPanel() {
  const [orgs, setOrgs] = useState(null)
  const [orgId, setOrgId] = useState('')
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { api.adminListAccounts().then(setOrgs).catch(() => {}) }, [])
  useEffect(() => {
    if (!orgId) { setRows(null); return }
    api.adminListOrgCreditRates(orgId).then(setRows).catch((e) => setMsg(e.message))
  }, [orgId])

  async function save(channel, value) {
    setMsg('')
    try {
      await api.adminSaveOrgCreditRate(orgId, channel, value)
      setMsg(`Saved ${channel} override.`); setTimeout(() => setMsg(''), 2500)
      api.adminListOrgCreditRates(orgId).then(setRows)
    } catch (e) { setMsg(e.message) }
  }

  async function clear(channel) {
    setMsg('')
    try {
      await api.adminDeleteOrgCreditRate(orgId, channel)
      setMsg(`Cleared ${channel} override — back to global default.`); setTimeout(() => setMsg(''), 2500)
      api.adminListOrgCreditRates(orgId).then(setRows)
    } catch (e) { setMsg(e.message) }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Negotiated per-org pricing. Pick an org, then set only the channels its deal actually changes —
        everything else keeps inheriting the global default above.
      </p>
      <select
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        className="w-full sm:w-72 border dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-700 dark:text-white"
      >
        <option value="">Select an organisation…</option>
        {(orgs || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {orgId && (rows ? <CreditRateTable rows={rows} onSave={save} onClear={clear} msg={msg} /> : <div className="text-sm text-slate-500">Loading…</div>)}
    </div>
  )
}

function PricingTab() {
  const [plans, setPlans] = useState(null)
  const [platformSettings, setPlatformSettings] = useState(null)
  const [msg, setMsg] = useState('')
  function load() { api.adminListPlans().then(setPlans).catch((e) => setMsg(e.message)) }
  useEffect(() => {
    load()
    api.platformSettings().then(setPlatformSettings).catch((e) => setMsg(e.message))
  }, [])

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
  async function setAllAddons(active) {
    setMsg('')
    try {
      const addons = plans.filter((plan) => plan.kind === 'addon')
      await api.adminSetAddonPolicy(Object.fromEntries(addons.map((plan) => [plan.key, active])))
      setPlans((current) => current.map((plan) => plan.kind === 'addon' ? { ...plan, active } : plan))
      setMsg(`All add-ons ${active ? 'allowed' : 'disallowed'} globally.`)
    } catch (e) { setMsg(e.message) }
  }
  async function openAddonPromotion() {
    setMsg('')
    try {
      const until = new Date()
      until.setMonth(until.getMonth() + 6)
      const updated = await api.updatePlatformSettings({ addon_promo_until: until.toISOString() })
      setPlatformSettings(updated)
      setMsg(`All add-ons are open for paid events until ${new Date(updated.addon_promo_until).toLocaleString()}.`)
    } catch (e) { setMsg(e.message) }
  }
  async function endAddonPromotion() {
    setMsg('')
    try {
      const updated = await api.updatePlatformSettings({ clear_addon_promo: true })
      setPlatformSettings(updated)
      setMsg('The global add-on promotion has ended.')
    } catch (e) { setMsg(e.message) }
  }
  function edit(i, k, v) { setPlans((prev) => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p)) }

  if (!plans) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        {msg && <div className="text-sm text-teal-600">{msg}</div>}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Global add-on promotion</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Opens every add-on at no charge for all current and future paid events. Free events cannot use add-ons. Explicit event or organization disallows still take precedence.
          </p>
          <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {platformSettings?.addon_promo_until && new Date(platformSettings.addon_promo_until) > new Date()
              ? `Active until ${new Date(platformSettings.addon_promo_until).toLocaleString()}`
              : 'Not active'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700" onClick={openAddonPromotion}>Open paid-event add-ons for 6 months</button>
            <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onClick={endAddonPromotion}>End promotion now</button>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Prices are in the smallest unit — USD cents, NGN kobo. Changes reflect on the live pricing page and checkout.</p>
        <div className="flex gap-2"><button className="rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => setAllAddons(true)}>Allow all add-ons globally</button><button className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => setAllAddons(false)}>Disallow all add-ons globally</button></div>
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

      <div className="space-y-2 border-t dark:border-slate-700 pt-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Messaging credit weights — global default</h3>
        <GlobalCreditRatesPanel />
      </div>

      <div className="space-y-2 border-t dark:border-slate-700 pt-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Messaging credit weights — per-org override</h3>
        <OrgCreditRatesPanel />
      </div>
    </div>
  )
}

// ── Org Plans: org-level recurring subscription catalog (gates org-wide paid
// features, e.g. read-write API access) — separate from the per-event Pricing
// tab above. Mirrors its shape; adds a "+ Add plan" button since there's no
// other way to create the first row through the UI.
function OrgPlansTab() {
  const [plans, setPlans] = useState(null)
  const [msg, setMsg] = useState('')
  function load() { api.adminListOrgPlans().then(setPlans).catch((e) => setMsg(e.message)) }
  useEffect(() => { load() }, [])

  async function save(p) {
    setMsg('')
    try {
      await api.adminSaveOrgPlan(p.key, {
        label: p.label, usd_monthly: Number(p.usd_monthly), ngn_monthly: Number(p.ngn_monthly),
        features: typeof p.features === 'string'
          ? p.features.split(',').map((f) => f.trim()).filter(Boolean)
          : p.features,
        active: !!p.active, sort_order: Number(p.sort_order),
      })
      setMsg(`Saved ${p.key}.`); setTimeout(() => setMsg(''), 2500)
      load()
    } catch (e) { setMsg(e.message) }
  }

  async function remove(key) {
    if (!confirm(`Delete plan "${key}"? Orgs currently on it keep their status, but it won't be offered again.`)) return
    setMsg('')
    try { await api.adminDeleteOrgPlan(key); load() } catch (e) { setMsg(e.message) }
  }

  function edit(i, k, v) { setPlans((prev) => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p)) }

  function addPlan() {
    const key = prompt('New plan key (e.g. api_access):')
    if (!key || !key.trim()) return
    setPlans((prev) => [...(prev || []), {
      key: key.trim(), label: 'New plan', usd_monthly: 0, ngn_monthly: 0,
      features: [], active: true, sort_order: (prev?.length || 0) + 1,
    }])
  }

  if (!plans) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-2">
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Monthly recurring plans. Prices are in the smallest unit — USD cents, NGN kobo.
          Features is a comma-separated list (e.g. <code>api_write</code>) checked by feature gates.
        </p>
        <button onClick={addPlan} className="bg-teal-600 text-white px-2 py-1 rounded text-xs font-semibold hover:bg-teal-700 shrink-0">
          + Add plan
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr><th className="p-2">key</th><th>label</th><th>usd¢/mo</th><th>ngn(kobo)/mo</th><th>features</th><th>active</th><th></th></tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.key} className="border-t dark:border-slate-700">
                <td className="p-2 font-mono dark:text-slate-200">{p.key}</td>
                <td><input value={p.label} onChange={(e) => edit(i, 'label', e.target.value)} className="w-32 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={p.usd_monthly} onChange={(e) => edit(i, 'usd_monthly', e.target.value)} className="w-20 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={p.ngn_monthly} onChange={(e) => edit(i, 'ngn_monthly', e.target.value)} className="w-24 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input value={Array.isArray(p.features) ? p.features.join(', ') : p.features} onChange={(e) => edit(i, 'features', e.target.value)} className="w-36 border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white" /></td>
                <td><input type="checkbox" checked={!!p.active} onChange={(e) => edit(i, 'active', e.target.checked)} /></td>
                <td className="space-x-1 whitespace-nowrap">
                  <button onClick={() => save(p)} className="bg-teal-600 text-white px-2 py-1 rounded font-semibold hover:bg-teal-700">Save</button>
                  <button onClick={() => remove(p.key)} className="text-red-500 hover:text-red-700 px-1">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Affiliate stores: rewrite registry Buy links with your affiliate tag ──────
function AffiliateStoresTab() {
  const [stores, setStores] = useState(null)
  const [draft, setDraft] = useState({ domain: '', label: '', param_key: '', param_value: '', active: true, sort_order: 0 })
  const [msg, setMsg] = useState('')
  function load() { api.adminListAffiliateStores().then(setStores).catch((e) => setMsg(e.message)) }
  useEffect(() => { load() }, [])

  const inp = 'border dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-700 dark:text-white'

  async function save(s) {
    setMsg('')
    try {
      await api.adminUpdateAffiliateStore(s.id, {
        domain: s.domain, label: s.label, param_key: s.param_key,
        param_value: s.param_value, active: !!s.active, sort_order: Number(s.sort_order) || 0,
      })
      setMsg(`Saved ${s.domain}.`); setTimeout(() => setMsg(''), 2500)
    } catch (e) { setMsg(e.message) }
  }
  async function add() {
    if (!draft.domain.trim() || !draft.param_key.trim()) { setMsg('Domain and param key are required.'); return }
    setMsg('')
    try {
      await api.adminCreateAffiliateStore({ ...draft, sort_order: Number(draft.sort_order) || 0 })
      setDraft({ domain: '', label: '', param_key: '', param_value: '', active: true, sort_order: 0 }); load()
    } catch (e) { setMsg(e.message) }
  }
  async function remove(id) {
    if (!confirm('Delete this affiliate store?')) return
    try { await api.adminDeleteAffiliateStore(id); load() } catch (e) { setMsg(e.message) }
  }
  function edit(i, k, v) { setStores((prev) => prev.map((s, idx) => idx === i ? { ...s, [k]: v } : s)) }

  if (!stores) return <div className="text-sm text-slate-500">Loading…</div>
  return (
    <div className="space-y-2">
      {msg && <div className="text-sm text-teal-600">{msg}</div>}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        When a registry item's Buy link matches a <strong>domain</strong> below, the <strong>param</strong> is appended so purchases carry your affiliate tag.
        E.g. Amazon: domain <code>amazon.com</code>, key <code>tag</code>, value <code>yourtag-20</code>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500 dark:text-slate-400">
            <tr><th className="p-2">domain</th><th>label</th><th>param key</th><th>param value</th><th>active</th><th>sort</th><th></th></tr>
          </thead>
          <tbody>
            {stores.map((s, i) => (
              <tr key={s.id} className="border-t dark:border-slate-700">
                <td className="p-2"><input value={s.domain} onChange={(e) => edit(i, 'domain', e.target.value)} className={`w-32 ${inp}`} /></td>
                <td><input value={s.label} onChange={(e) => edit(i, 'label', e.target.value)} className={`w-28 ${inp}`} /></td>
                <td><input value={s.param_key} onChange={(e) => edit(i, 'param_key', e.target.value)} className={`w-20 ${inp}`} /></td>
                <td><input value={s.param_value} onChange={(e) => edit(i, 'param_value', e.target.value)} className={`w-28 ${inp}`} /></td>
                <td><input type="checkbox" checked={!!s.active} onChange={(e) => edit(i, 'active', e.target.checked)} /></td>
                <td><input value={s.sort_order} onChange={(e) => edit(i, 'sort_order', e.target.value)} className={`w-12 ${inp}`} /></td>
                <td className="whitespace-nowrap">
                  <button onClick={() => save(s)} className="bg-teal-600 text-white px-2 py-1 rounded font-semibold hover:bg-teal-700 mr-1">Save</button>
                  <button onClick={() => remove(s.id)} className="text-red-500 hover:underline">Del</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t dark:border-slate-700">
              <td className="p-2"><input value={draft.domain} onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))} placeholder="amazon.com" className={`w-32 ${inp}`} /></td>
              <td><input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Amazon US" className={`w-28 ${inp}`} /></td>
              <td><input value={draft.param_key} onChange={(e) => setDraft((d) => ({ ...d, param_key: e.target.value }))} placeholder="tag" className={`w-20 ${inp}`} /></td>
              <td><input value={draft.param_value} onChange={(e) => setDraft((d) => ({ ...d, param_value: e.target.value }))} placeholder="yourtag-20" className={`w-28 ${inp}`} /></td>
              <td><input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} /></td>
              <td><input value={draft.sort_order} onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value }))} className={`w-12 ${inp}`} /></td>
              <td><button onClick={add} className="bg-indigo-600 text-white px-2 py-1 rounded font-semibold hover:bg-indigo-700">Add</button></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Operators ───────────────────────────────────────────────────────────────
// ── Support chat: kill switch for the Chatwoot widget across the whole app ──
function SupportChatTab() {
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function load() { api.platformSettings().then(setSettings).catch((e) => setMsg(e.message)) }
  useEffect(() => { load() }, [])

  async function toggle() {
    if (!settings) return
    const next = !settings.support_chat_enabled
    setBusy(true); setMsg('')
    try {
      const updated = await api.updatePlatformSettings({ support_chat_enabled: next })
      setSettings(updated)
      setMsg(next ? 'Support chat is now visible to organizers.' : 'Support chat is now hidden.')
    } catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }

  if (!settings) return <div className="text-sm text-slate-500">Loading…</div>
  const on = settings.support_chat_enabled

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow border dark:border-slate-700 p-5 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold dark:text-white">Support chat widget</h2>
            <p className="text-xs text-slate-400 mt-0.5">Chatwoot bubble shown to logged-in organizers app-wide.</p>
          </div>
          <button onClick={toggle} disabled={busy}
            className={`shrink-0 relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {on
            ? 'Widget is live. Requires the one-time Chatwoot bootstrap (support-service/README.md) to actually be usable — otherwise organizers see nothing, since the SDK never loads without a website token.'
            : 'Widget is hidden. Per support-service/docs/STAGING_AUDIT.md, this was audited for staging only ("not a recommendation to deploy to production") — leave this off in prod until that gate is revisited.'}
        </p>
        {msg && <div className="text-xs text-teal-600 dark:text-teal-400">{msg}</div>}
      </div>
    </div>
  )
}

// ── Referrals: platform-wide view of the partner referral program ──────────
function ReferralsTab() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { api.adminAllReferrals().then(setRows).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="text-sm text-red-500">{err}</div>
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>

  const byReferrer = {}
  for (const r of rows) {
    const key = r.referrer_code || '—'
    byReferrer[key] = byReferrer[key] || { name: r.referrer_name, referred: 0, converted: 0 }
    byReferrer[key].referred += 1
    if (r.converted) byReferrer[key].converted += 1
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow border dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b dark:border-slate-700">
          <h2 className="font-semibold dark:text-white">By referrer</h2>
          <p className="text-xs text-slate-400">{Object.keys(byReferrer).length} active referral code(s)</p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 dark:text-slate-400 border-b dark:border-slate-700">
            <tr><th className="p-3">Code</th><th className="p-3">Org</th><th className="p-3">Referred</th><th className="p-3">Converted</th></tr>
          </thead>
          <tbody>
            {Object.entries(byReferrer).map(([code, v]) => (
              <tr key={code} className="border-t dark:border-slate-700">
                <td className="p-3 font-mono text-xs">{code}</td>
                <td className="p-3 dark:text-slate-200">{v.name}</td>
                <td className="p-3 dark:text-slate-200">{v.referred}</td>
                <td className="p-3 dark:text-slate-200">{v.converted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow border dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b dark:border-slate-700">
          <h2 className="font-semibold dark:text-white">All referred organizations</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 dark:text-slate-400 border-b dark:border-slate-700">
            <tr><th className="p-3">Org</th><th className="p-3">Signed up</th><th className="p-3">Referred by</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t dark:border-slate-700">
                <td className="p-3 dark:text-slate-200">{r.org_name}</td>
                <td className="p-3 text-slate-500 dark:text-slate-400">{new Date(r.org_created_at).toLocaleDateString()}</td>
                <td className="p-3 dark:text-slate-200">{r.referrer_name} <span className="text-slate-400 font-mono text-xs">({r.referrer_code})</span></td>
                <td className={`p-3 text-xs font-semibold ${r.converted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {r.converted ? 'Converted' : 'Signed up'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

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
      {tab === 'accounts' && <AccountsTab me={user} />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'trials' && <TrialsTab />}
      {tab === 'qa' && <QaChecklistTab />}
      {tab === 'support' && <SupportChatTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'org-plans' && <OrgPlansTab />}
      {tab === 'affiliates' && <AffiliateStoresTab />}
      {tab === 'operators' && <OperatorsTab me={user} />}
    </div>
  )
}
