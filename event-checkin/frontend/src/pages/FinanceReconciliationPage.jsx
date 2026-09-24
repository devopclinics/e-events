import { useEffect, useMemo, useState } from 'react'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './FinanceReconciliationPage.css'

const ICONS = { festio_pay: '✦', cash_app: '$', zelle: 'Z', paypal: 'P', bank_transfer: '▥', offline: '▤', pledge: '♡' }
const LABELS = { festio_pay: 'Festio Pay', cash_app: 'Cash App', zelle: 'Zelle', paypal: 'PayPal', bank_transfer: 'Bank transfer', offline: 'Cash / cheque', pledge: 'Pledge' }
const money = (minor, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format((minor || 0) / 100)
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'

function whenLabel(iso) {
  if (!iso) return '—'
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today, ${time}`
  if (isYesterday) return `Yesterday, ${time}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'pending', label: 'Awaiting verification', match: (r) => ['pending_verification', 'initiated'].includes(r.status) },
  { key: 'pledged', label: 'Pledges', match: (r) => r.status === 'pledged' },
  { key: 'confirmed', label: 'Confirmed', match: (r) => r.status === 'confirmed' },
  { key: 'attention', label: 'Needs attention', match: (r) => r.reported_amount_minor != null },
]

const SOURCE_OPTIONS = ['Collection basket', 'Front desk / registration', 'Volunteer collected', 'Mail / envelope', 'Other']
const blankOffline = { channel: 'offline', amount: '', donor_name: '', status: 'confirmed', source: 'Collection basket', sourceOther: '' }

export default function FinanceReconciliationPage() {
  const [currentEventId, setCurrentEventId] = useCurrentEvent()
  const { event } = useEventDetails(currentEventId)
  const [events, setEvents] = useState([])
  const [campaign, setCampaign] = useState(null)
  const [rows, setRows] = useState([])
  const [audit, setAudit] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [sort, setSort] = useState('newest')
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [modal, setModal] = useState(null)
  const [note, setNote] = useState('')
  const [flagAmount, setFlagAmount] = useState('')
  const [offline, setOffline] = useState(blankOffline)
  const [offlineBusy, setOfflineBusy] = useState(false)

  useEffect(() => { api.listEvents().then(setEvents).catch(() => {}) }, [])

  async function load() {
    if (!currentEventId) return
    try {
      const [c, r, a] = await Promise.all([
        api.donationCampaign(currentEventId), api.donationContributions(currentEventId), api.donationAudit(currentEventId),
      ])
      setCampaign(c); setRows(r); setAudit(a); setError('')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [currentEventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const channels = useMemo(() => Array.from(new Set(rows.map((r) => r.channel))), [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows.filter((r) => TABS.find((t) => t.key === tab).match(r))
    if (channelFilter) list = list.filter((r) => r.channel === channelFilter)
    if (q) list = list.filter((r) => [r.donor_name, r.reference, String(r.amount_minor / 100)].some((v) => (v || '').toString().toLowerCase().includes(q)))
    const sorted = [...list]
    if (sort === 'oldest') sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    else if (sort === 'highest') sorted.sort((a, b) => b.amount_minor - a.amount_minor)
    else sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return sorted
  }, [rows, tab, channelFilter, search, sort])

  const channelSummary = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const bucket = map.get(r.channel) || { channel: r.channel, total: 0, pending: 0, confirmed: 0, issues: 0 }
      if (r.status === 'confirmed') { bucket.total += r.amount_minor; bucket.confirmed += 1 }
      else if (['pending_verification', 'initiated'].includes(r.status)) bucket.pending += 1
      if (r.reported_amount_minor != null) bucket.issues += 1
      map.set(r.channel, bucket)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [rows])

  function toggleSelect(id) {
    setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const selectedTotal = selectedRows.reduce((sum, r) => sum + r.amount_minor, 0)

  function openConfirm(row) { setNote(''); setModal({ mode: 'confirm', row }) }
  function openResolve(row) { setNote(''); setModal({ mode: 'resolve', row }) }
  function openFlag(row) { setNote(''); setFlagAmount(''); setModal({ mode: 'flag', row }) }
  function openBulk() { if (selected.size) { setNote(''); setModal({ mode: 'bulk' }) } }
  function closeModal() { setModal(null) }

  async function runAction(fn) {
    setBusy(true)
    try { await fn(); closeModal(); setSelected(new Set()); await load() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function confirmModal() {
    if (modal.mode === 'confirm') return runAction(() => api.verifyDonation(currentEventId, modal.row.id, { note }))
    if (modal.mode === 'resolve') return runAction(() => api.verifyDonation(currentEventId, modal.row.id, { note, reported_amount_minor: modal.row.reported_amount_minor }))
    if (modal.mode === 'bulk') return runAction(() => api.bulkVerifyDonations(currentEventId, { contribution_ids: Array.from(selected), note }))
    if (modal.mode === 'flag') {
      const cents = Math.round(Number(flagAmount) * 100)
      if (!cents || cents <= 0) { setError('Enter the amount actually received.'); return }
      return runAction(() => api.reportDonationDiscrepancy(currentEventId, modal.row.id, { reported_amount_minor: cents, note }))
    }
  }

  async function quickReject(row) {
    if (!window.confirm(`Reject ${row.donor_name || 'this contribution'}'s ${money(row.amount_minor, row.currency)}?`)) return
    setBusy(true)
    try { await api.rejectDonation(currentEventId, row.id, {}); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function quickCancel(row) {
    if (!window.confirm(`Cancel ${row.donor_name || 'this'} pledge of ${money(row.amount_minor, row.currency)}?`)) return
    setBusy(true)
    try { await api.cancelDonation(currentEventId, row.id, {}); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function quickDelete(row) {
    if (!window.confirm(`Delete this ${money(row.amount_minor, row.currency)} contribution from ${row.donor_name || 'Not provided'}? This cannot be undone.`)) return
    setBusy(true)
    try { await api.deleteDonation(currentEventId, row.id); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function addOffline(e) {
    e.preventDefault(); setOfflineBusy(true); setError('')
    try {
      const source = offline.source === 'Other' ? offline.sourceOther.trim() : offline.source
      await api.addOfflineDonation(currentEventId, {
        channel: offline.channel, amount_minor: Math.round(Number(offline.amount) * 100),
        donor_name: offline.donor_name.trim() || null, status: offline.status,
        source: source || null, message: null, donor_email: null, donor_phone: null,
        expected_payment_channel: null, expected_payment_date: null, provider_reference: null,
      })
      setOffline(blankOffline)
      await load()
    } catch (e) { setError(e.message) } finally { setOfflineBusy(false) }
  }

  const eventSwitcher = <select className="fr-event-switcher" value={currentEventId || ''} onChange={(e) => setCurrentEventId(e.target.value)}>
    <option value="" disabled>Choose an event…</option>
    {events.map((e) => <option value={e.id} key={e.id}>{e.name}</option>)}
  </select>

  if (!currentEventId) return <div className="fr-page">
    <header className="fr-top"><div className="fr-top-inner">
      <div className="fr-brand"><div className="fr-mark">F</div><div><b>Festio Finance</b><small>No event selected</small></div></div>
      {eventSwitcher}
    </div></header>
    <div className="fr-loading">Choose an event above to open its finance ledger.</div>
  </div>
  if (!campaign) return <div className="fr-page"><div className="fr-loading">{error || 'Loading finance ledger…'}</div></div>

  const tabCounts = Object.fromEntries(TABS.map((t) => [t.key, rows.filter(t.match).length]))
  const modalRow = modal?.row

  return <div className="fr-page">
    <header className="fr-top"><div className="fr-top-inner">
      <div className="fr-brand"><div className="fr-mark">F</div><div><b>Festio Finance</b><small>{event?.name || campaign.event_name}</small></div></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{eventSwitcher}<div className="fr-secure"><i></i><span>Restricted finance access</span></div></div>
    </div></header>
    <main className="fr-shell">
      <section className="fr-heading">
        <div><span className="fr-eyebrow">Donation reconciliation</span><h1>Payments &amp; pledges</h1><p>Confirm received funds, resolve exceptions, and keep the public Giving Hub accurate.</p></div>
        <div className="fr-role"><span className="fr-avatar">FA</span><div><b>Finance review</b><small>Confirmations are audited · uses your event admin access</small></div></div>
      </section>

      {error && <div className="fr-error">{error}</div>}

      <section className="fr-stats">
        <article className="fr-stat received"><small>Confirmed received</small><strong>{money(campaign.confirmed_minor, campaign.currency)}</strong><em>{campaign.donation_count} verified payments</em></article>
        <article className="fr-stat"><small>Awaiting verification</small><strong>{money(campaign.pending_minor, campaign.currency)}</strong><em>{tabCounts.pending} submitted</em></article>
        <article className="fr-stat"><small>Active pledges</small><strong>{money(campaign.pledged_minor, campaign.currency)}</strong><em>{campaign.pledge_count} commitments</em></article>
        <article className="fr-stat attention"><small>Needs attention</small><strong>{campaign.needs_attention_count}</strong><em>Amount or reference issue</em></article>
        <article className="fr-stat"><small>Total potential</small><strong>{money(campaign.total_potential_minor, campaign.currency)}</strong><em>Received + pending + pledged</em></article>
      </section>

      <section className="fr-work">
        <div className="fr-panel">
          <div className="fr-toolbar">
            <div className="fr-toolbar-top">
              <div><span className="fr-eyebrow">Contribution ledger</span><h2>Finance review queue</h2></div>
              <div className="fr-toolbar-actions">
                <button className="fr-btn" onClick={() => api.exportDonationsCsv(currentEventId).catch((e) => setError(e.message))}>Export ledger</button>
                <button className="fr-btn gold" disabled={!selected.size} onClick={openBulk}>Confirm selected</button>
              </div>
            </div>
            <div className="fr-filters">
              <input className="fr-field" placeholder="Search donor, reference or amount" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="fr-field" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
                <option value="">All payment methods</option>
                {channels.map((c) => <option value={c} key={c}>{LABELS[c] || c}</option>)}
              </select>
              <select className="fr-field" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="highest">Highest amount</option>
              </select>
            </div>
            <div className="fr-tabs">{TABS.map((t) => <button key={t.key} className={'fr-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>{t.label} {tabCounts[t.key]}</button>)}</div>
          </div>
          {selected.size > 0 && <div className="fr-bulk"><span><strong>{selected.size} contribution{selected.size === 1 ? '' : 's'} selected</strong> · {money(selectedTotal, campaign.currency)} total</span><span>Confirmation updates the Giving Hub and projector immediately.</span></div>}
          <div className="fr-table">
            <div className="fr-row head"><span></span><span>Donor / reference</span><span>Amount</span><span>Method</span><span>Status</span><span>Submitted</span><span>Action</span></div>
            {filtered.map((row) => {
              const hasIssue = row.reported_amount_minor != null
              const selectable = ['pending_verification', 'initiated', 'pledged'].includes(row.status)
              return <div className="fr-row" key={row.id}>
                <input className="fr-check" type="checkbox" disabled={!selectable} checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                <div className="fr-donor"><span>{initials(row.donor_name)}</span><div><b>{row.donor_name || 'Unidentified'}</b><small>{row.donor_email || row.donor_phone || row.source || (row.anonymous_publicly ? 'Anonymous publicly' : '—')}</small><span className="fr-ref">{row.reference}</span></div></div>
                <div className="fr-money"><b>{money(row.amount_minor, row.currency)}</b><small>{row.currency}</small></div>
                <div className="fr-channel"><i>{ICONS[row.channel] || '•'}</i>{LABELS[row.channel] || row.channel}</div>
                {hasIssue
                  ? <span className="fr-status issue">Amount differs</span>
                  : row.status === 'confirmed' ? <span className="fr-status confirmed">Confirmed</span>
                  : row.status === 'pledged' ? <span className="fr-status pledged">Pledged</span>
                  : ['pending_verification', 'initiated'].includes(row.status) ? <span className="fr-status pending">Awaiting verification</span>
                  : <span className="fr-status closed">{row.status}</span>}
                <div className="fr-money">
                  {row.status === 'pledged'
                    ? <><b>Due {row.expected_payment_date ? new Date(row.expected_payment_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</b><small>{LABELS[row.expected_payment_channel] || row.expected_payment_channel} expected</small></>
                    : <><b>{whenLabel(row.created_at)}</b><small>{hasIssue ? `Reported ${money(row.reported_amount_minor, row.currency)}` : row.status === 'confirmed' ? 'Verified' : 'Payment marked sent'}</small></>}
                </div>
                <div className="fr-action">
                  {hasIssue && ['pending_verification', 'initiated', 'pledged'].includes(row.status) && <button className="confirm" onClick={() => openResolve(row)}>Resolve</button>}
                  {!hasIssue && ['pending_verification', 'initiated'].includes(row.status) && <><button className="confirm" onClick={() => openConfirm(row)}>Confirm</button><button onClick={() => openFlag(row)}>Flag</button><button className="reject" onClick={() => quickReject(row)}>Reject</button></>}
                  {!hasIssue && row.status === 'pledged' && <><button className="confirm" onClick={() => openConfirm(row)}>Mark paid</button><button onClick={() => openFlag(row)}>Flag</button><button className="reject" onClick={() => quickCancel(row)}>Cancel</button></>}
                  {row.status !== 'confirmed' && <button className="reject" onClick={() => quickDelete(row)}>Delete</button>}
                </div>
              </div>
            })}
            {!filtered.length && <p className="fr-empty">No contributions match this view.</p>}
          </div>
          <form className="fr-offline" onSubmit={addOffline}>
            <h3>Record an unidentified or offline gift</h3>
            <p>No name entered — a collection basket, envelope, or cash handed to a volunteer. Note where it came from so it's still traceable.</p>
            <div className="fr-offline-grid">
              <label>Donor name (optional)<input placeholder="Leave blank if unknown" value={offline.donor_name} onChange={(e) => setOffline({ ...offline, donor_name: e.target.value })} /></label>
              <label>Amount<input required type="number" min="1" step="0.01" placeholder="0.00" value={offline.amount} onChange={(e) => setOffline({ ...offline, amount: e.target.value })} /></label>
              <label>Method<select value={offline.channel} onChange={(e) => setOffline({ ...offline, channel: e.target.value })}><option value="offline">Cash / cheque</option><option value="bank_transfer">Bank transfer</option><option value="cash_app">Cash App</option><option value="zelle">Zelle</option><option value="paypal">PayPal</option></select></label>
              <label>Source<select value={offline.source} onChange={(e) => setOffline({ ...offline, source: e.target.value })}>{SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              {offline.source === 'Other'
                ? <label>Describe source<input required placeholder="e.g. Youth group table" value={offline.sourceOther} onChange={(e) => setOffline({ ...offline, sourceOther: e.target.value })} /></label>
                : <label>Status<select value={offline.status} onChange={(e) => setOffline({ ...offline, status: e.target.value })}><option value="confirmed">Confirmed</option><option value="pending_verification">Pending verification</option></select></label>}
              <button className="fr-btn primary" disabled={offlineBusy}>{offlineBusy ? 'Saving…' : 'Add record'}</button>
            </div>
          </form>
        </div>

        <aside className="fr-side">
          <section className="fr-panel"><span className="fr-eyebrow">Channel summary</span><h2>Where funds arrived</h2>
            <div className="fr-channel-list">{channelSummary.map((c) => <div className="fr-channel-total" key={c.channel}><i>{ICONS[c.channel] || '•'}</i><div><b>{LABELS[c.channel] || c.channel}</b><small>{c.pending} pending{c.issues ? ` · ${c.issues} issue${c.issues === 1 ? '' : 's'}` : ''} · {c.confirmed} confirmed</small></div><strong>{money(c.total, campaign.currency)}</strong></div>)}
            {!channelSummary.length && <p>No contributions yet.</p>}</div>
          </section>
          <section className="fr-panel"><span className="fr-eyebrow">Recent activity</span><h2>Audit trail</h2>
            <div className="fr-audit">{audit.map((a) => <article key={a.id}><h3>{money(a.amount_minor, a.currency)} {LABELS[a.channel] || a.channel} {a.to_status === 'confirmed' ? 'confirmed' : a.to_status}</h3><p>{a.actor_name ? `Confirmed by ${a.actor_name}` : 'Automatically verified'}{a.note ? ` · ${a.note}` : ''}</p><small>{whenLabel(a.created_at)}</small></article>)}
            {!audit.length && <p>No activity yet.</p>}</div>
          </section>
          <section className="fr-panel fr-notice"><i>◆</i><div><h3>Public totals stay protected</h3><p>Only confirmed payments increase Received. Pending payments and pledges remain visible as separate totals.</p></div></section>
        </aside>
      </section>
    </main>

    {modal && <div className="fr-modal" onClick={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="fr-modal-card">
        <span className="fr-eyebrow">{modal.mode === 'bulk' ? 'Confirm selected payments' : modal.mode === 'flag' ? 'Report a discrepancy' : modal.mode === 'resolve' ? 'Resolve discrepancy' : 'Confirm payment received'}</span>
        <h2>{modal.mode === 'bulk' ? `Verify ${selected.size} contributions` : modal.mode === 'flag' ? 'What did you actually receive?' : modal.mode === 'resolve' ? 'Reconcile this contribution' : 'Verify this contribution'}</h2>
        {modal.mode === 'bulk'
          ? <div className="fr-summary"><div><small>Selected</small><b>{selected.size} contributions</b></div><div><small>Total</small><b>{money(selectedTotal, campaign.currency)}</b></div></div>
          : <div className="fr-summary"><div><small>Donor</small><b>{modalRow.donor_name || 'Not provided'}</b></div><div><small>Reference</small><b>{modalRow.reference}</b></div><div><small>Submitted amount</small><b>{money(modalRow.amount_minor, modalRow.currency)}</b></div><div><small>Payment method</small><b>{LABELS[modalRow.channel] || modalRow.channel}</b></div></div>}
        {modal.mode === 'flag' && <label><b>Amount actually received ({campaign.currency})</b><input type="number" min="0.01" step="0.01" value={flagAmount} onChange={(e) => setFlagAmount(e.target.value)} placeholder="0.00" /></label>}
        {modal.mode === 'resolve' && <p style={{ margin: '0 0 14px', color: '#b77612', fontWeight: 700 }}>Bank/app shows {money(modalRow.reported_amount_minor, modalRow.currency)} — confirming will update the ledger to this amount.</p>}
        <label><b>Finance note (optional)</b><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the audit history" /></label>
        <div className="fr-modal-actions">
          <button className="fr-btn" onClick={closeModal}>Cancel</button>
          <button className="fr-btn primary" disabled={busy} onClick={confirmModal}>
            {busy ? 'Saving…' : modal.mode === 'bulk' ? `Confirm ${selected.size} payments` : modal.mode === 'flag' ? 'Save discrepancy' : modal.mode === 'resolve' ? `Confirm ${money(modalRow.reported_amount_minor, modalRow.currency)} received` : `Confirm ${money(modalRow.amount_minor, modalRow.currency)} received`}
          </button>
        </div>
      </div>
    </div>}
  </div>
}
