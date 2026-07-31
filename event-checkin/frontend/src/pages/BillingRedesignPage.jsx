import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ConfirmDialog } from './redesign/RedesignShell'
import { LoadingSkeleton, ErrorRetryState, EmptyState } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useBilling } from '../hooks/useEventResources'
import { api } from '../api'
import './BillingRedesignPage.css'

const WEBHOOK_EVENT_TYPES = [
  'guest.created', 'guest.checked_in', 'rsvp.confirmed',
  'table.created', 'table.deleted', 'table_group.created', 'table_group.deleted',
  'experience.workflow_published', 'experience.consent_signed', 'experience.feedback_submitted',
]

function TabsStrip({ tab, goTab }) {
  return (
    <div className="rr-tabs">
      <button className={tab === 'billing' ? 'active' : ''} onClick={() => goTab('billing')}>Billing</button>
      <button className={tab === 'org' ? 'active' : ''} onClick={() => goTab('org')}>Org Settings</button>
    </div>
  )
}

function billingMoney(amount, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount || 0) / 100) }
  catch { return `${currency} ${(Number(amount || 0) / 100).toFixed(2)}` }
}

const CATALOG_DESTINATIONS = {
  design_studio: { label: 'Open Design Studio', route: '/design-studio-redesign', icon: 'image' },
  experience: { label: 'Open Experience', route: '/experience-redesign', icon: 'layers' },
  messaging: { label: 'Open messaging', route: '/communications-redesign?tab=settings', icon: 'message' },
  operations: { label: 'Open event operations', route: '/addons-redesign', icon: 'grid' },
  enterprise: { label: 'Contact support', route: '/help-redesign', icon: 'team' },
}

function catalogLabel(entry) {
  return typeof entry === 'string' ? entry : entry?.label || 'Capability'
}

function BillingTab({ notify, eventId, onBuyPass, onBuyCredits }) {
  const navigate = useNavigate()
  const { data: billing, loading: billingLoading, error: billingError, refresh: loadBilling } = useBilling(eventId)
  const [currencyBusy, setCurrencyBusy] = useState(false)
  const [currencyError, setCurrencyError] = useState('')
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerFilter, setLedgerFilter] = useState('all')
  const [catalogSelection, setCatalogSelection] = useState(null)

  async function changeCurrency(currency) {
    setCurrencyBusy(true); setCurrencyError('')
    try {
      await api.setBillingCurrency(eventId, currency)
      await loadBilling()
      notify(`Billing currency changed to ${currency}`)
    } catch (error) { setCurrencyError(error.message || 'Currency could not be changed') }
    finally { setCurrencyBusy(false) }
  }

  if (!eventId) return <EmptyState icon="card" title="No event selected" message="Choose an event before managing billing." />
  if (billingError) return <ErrorRetryState message={billingError} onRetry={loadBilling} />
  if (billingLoading) return <LoadingSkeleton rows={6} />

  const tierRows = billing.tiers || []
  const packRows = billing.packs || []
  const ledgerRows = billing.ledger?.rows || []
  const channelSummary = new Map((billing.ledger?.summary || []).map((row) => [row.channel, row]))
  const activeTier = tierRows.find((tier) => tier.key === billing.plan_tier)
  const filteredLedgerRows = ledgerFilter === 'all'
    ? ledgerRows
    : ledgerRows.filter((row) => String(row.channel || '').toLowerCase() === ledgerFilter)

  function openLedger(channel = 'all') {
    setLedgerFilter(channel)
    setLedgerOpen(true)
  }

  function matchingCreditPack(entry) {
    const label = catalogLabel(entry)
    const credits = Number(label.match(/[\d,]+/)?.[0]?.replaceAll(',', '') || entry?.credits || 0)
    const amount = billing.currency === 'NGN' ? entry?.ngn : entry?.usd
    return packRows.find((pack) => credits && Number(pack.credits) === credits)
      || packRows.find((pack) => amount != null && Number(pack.amount) === Number(amount))
      || null
  }

  function openCatalogItem(group, entry) {
    const destination = CATALOG_DESTINATIONS[group]
    setCatalogSelection({
      group,
      entry,
      label: catalogLabel(entry),
      destination,
      pack: group === 'message_credits' ? matchingCreditPack(entry) : null,
    })
  }

  function runCatalogAction() {
    if (!catalogSelection) return
    if (catalogSelection.pack) {
      onBuyCredits(catalogSelection.pack)
      setCatalogSelection(null)
      return
    }
    if (catalogSelection.destination?.route) navigate(catalogSelection.destination.route)
  }

  return (
    <>
      <div className="rr-panel bl-plan-card">
        <div className="bl-plan-head">
          <div className="bl-plan-badge"><Icon name="card" size={16} /></div>
          <div className="bl-plan-headtext"><div className="bl-plan-tier">{billing.is_paid ? (activeTier?.name || activeTier?.label || billing.plan_tier) : 'No active Event Pass'}</div>
            <div className="bl-plan-sub">{billing.provider?.toUpperCase()} hosted checkout</div></div>
          <div className="rd-seg">
            <button disabled={currencyBusy} className={billing.currency === 'USD' ? 'on' : ''} onClick={() => changeCurrency('USD')}>USD (Stripe)</button>
            <button disabled={currencyBusy} className={billing.currency === 'NGN' ? 'on' : ''} onClick={() => changeCurrency('NGN')}>NGN (Paystack)</button>
          </div>
        </div>
        <div className="bl-plan-stats">
          <div className="bl-plan-stat"><strong>{billing.is_paid ? 'Active' : 'Inactive'}</strong><span>Event Pass</span></div>
          <div className="bl-plan-stat"><strong>{Number(billing.message_credits || 0).toLocaleString()}</strong><span>Message credits left</span></div>
          <div className="bl-plan-stat"><strong>{billing.configured ? 'Ready' : 'Unavailable'}</strong><span>{billing.provider} checkout</span></div>
        </div>
      </div>
      {currencyError && <p className="rp-field-error">{currencyError}</p>}

      <div className="rr-section-title">
        <div><h2>Event Passes</h2><p>One-time access for this event; benefits apply after successful payment</p></div>
      </div>
      <div className="rr-grid3">
        {tierRows.length === 0 ? <EmptyState icon="card" title="No Event Passes available" message="The billing catalogue has no active event tiers for this currency." /> : tierRows.map((t) => (
          <div className="rr-panel bl-tier-card" key={t.key}>
            <strong>{t.name || t.label}</strong>
            <div className="bl-tier-price">{billingMoney(t.amount, t.currency || billing.currency)}</div>
            <div className="bl-tier-meta">{t.guest_cap == null ? 'Unlimited' : Number(t.guest_cap).toLocaleString()} guest cap · {Number(t.credits || 0).toLocaleString()} credits</div>
            {t.description && <p className="rd-hint">{t.description}</p>}
            {!!t.capabilities?.length && <ul className="bl-tier-list">{t.capabilities.map((capability) => <li key={capability}><Icon name="check" size={11}/> {capability}</li>)}</ul>}
            <button data-plan-key={t.key} className={`rr-btn ${t.key === billing.plan_tier ? 'secondary' : 'primary'}`} style={{ width: '100%', justifyContent: 'center' }}
              disabled={!billing.configured} onClick={() => onBuyPass(t)}>
              {t.key === billing.plan_tier ? 'Buy this pass again' : 'Buy Event Pass'}
            </button>
          </div>
        ))}
      </div>

      <div className="rr-section-title">
        <div><h2>Top up message credits</h2><p>One-time credit packs, added instantly to your balance</p></div>
      </div>
      <div className="rr-grid3">
        {packRows.length === 0 ? <EmptyState icon="message" title="No credit packs available" message="The billing catalogue has no active credit packs for this currency." /> : packRows.map((p) => (
          <div className="rr-panel bl-pack-card" key={p.key}>
            <strong>{p.name || p.label}</strong>
            <span>{Number(p.credits || 0).toLocaleString()} credits</span>
            <span>{billingMoney(p.amount, p.currency || billing.currency)}</span>
            <button data-plan-key={p.key} className="rr-btn secondary" disabled={!billing.configured || !billing.is_paid} style={{ width: '100%', justifyContent: 'center' }} onClick={() => onBuyCredits(p)}>Buy credits</button>
          </div>
        ))}
      </div>

      <div className="rr-section-title">
        <div><h2>Credits by channel</h2><p>Sends and credits spent this billing period</p></div>
      </div>
      <div className="rr-panel">
        <div className="rd-panel-body">
          <div className="rd-channels">
            {['email', 'sms', 'whatsapp', 'mms'].map((key) => {
              const c = channelSummary.get(key) || { channel: key, sends: 0, credits: 0 }
              return <button className={`rd-chan bl-channel-button ${ledgerFilter === key && ledgerOpen ? 'active' : ''}`} key={key} onClick={() => openLedger(key)}>
                <div className="top">
                  <span className="name">{key.toUpperCase()}</span>
                  <Icon name="arrow" size={12} />
                </div>
                <div className="rate">{c.credits}<small>credits</small></div>
                <div className="foot"><span>{c.sends} sends · View ledger</span></div>
              </button>
            })}
          </div>
        </div>
      </div>

      <div className={`rr-panel bl-ledger-panel ${ledgerOpen ? 'open' : ''}`}>
        <button className="bl-ledger-toggle" aria-expanded={ledgerOpen} onClick={() => setLedgerOpen((value) => !value)}>
          <span className="bl-ledger-icon"><Icon name="file" size={16} /></span>
          <span><strong>Credit ledger</strong><small>Recent spend and top-ups · {Number(billing.ledger?.balance ?? billing.message_credits ?? 0).toLocaleString()} credits available · {ledgerRows.length} entries</small></span>
          <span className="bl-ledger-toggle-label">{ledgerOpen ? 'Collapse' : 'View activity'} <Icon name="arrow" size={12} /></span>
        </button>
        {ledgerOpen && <div className="rd-panel-body bl-ledger-body">
          <div className="bl-ledger-filters">
            {['all', 'email', 'sms', 'whatsapp', 'mms'].map((key) => <button key={key} className={ledgerFilter === key ? 'active' : ''} onClick={() => setLedgerFilter(key)}>{key === 'all' ? 'All activity' : key.toUpperCase()}</button>)}
          </div>
          <div className="bl-table-scroll"><table className="rr-table">
            <thead>
              <tr><th>Date</th><th>Reason</th><th>Channel</th><th>Delta</th><th>Balance after</th></tr>
            </thead>
            <tbody>
              {filteredLedgerRows.length === 0 ? <tr><td colSpan="5">No {ledgerFilter === 'all' ? '' : `${ledgerFilter.toUpperCase()} `}credit activity has been recorded for this event.</td></tr> : filteredLedgerRows.map((l) => (
                <tr key={l.id}>
                  <td>{l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</td>
                  <td>{l.reason || l.action}</td>
                  <td>{l.channel || '—'}</td>
                  <td className={l.delta > 0 ? 'bl-delta-pos' : l.delta < 0 ? 'bl-delta-neg' : ''}>
                    {l.delta > 0 ? `+${l.delta}` : l.delta || 0}
                  </td>
                  <td>{l.balance_after == null ? '—' : Number(l.balance_after).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>}
      </div>

      <div className="rr-section-title">
        <div><h2>Capability catalog</h2><p>Current billing catalog for {billing.currency}; availability depends on the selected Event Pass.</p></div>
      </div>
      {Object.entries(billing.catalog?.addons || {}).map(([group, items]) => (
        <div key={group} className="bl-catalog-group">
          <div className="bl-catalog-group-title">{group.replaceAll('_', ' ')}</div>
          <div className="bl-ent-grid">
            {(Array.isArray(items) ? items : []).map((entry, index) => (
              <button type="button" className="rr-panel bl-ent-card" key={typeof entry === 'string' ? entry : `${entry.label}-${index}`} onClick={() => openCatalogItem(group, entry)}>
                <div className="bl-ent-icon"><Icon name={CATALOG_DESTINATIONS[group]?.icon || 'check'} size={16}/></div>
                <div className="bl-ent-label">{typeof entry === 'string' ? entry : entry.label}</div>
                {typeof entry === 'object' && entry.usd != null && entry.ngn != null && (
                  <span className="rd-status-chip bl-chip-neutral">
                    {billingMoney(billing.currency === 'NGN' ? entry.ngn : entry.usd, billing.currency)}
                  </span>
                )}
                <span className="bl-ent-action">View details <Icon name="arrow" size={11} /></span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {catalogSelection && <Modal title={catalogSelection.label} onClose={() => setCatalogSelection(null)} width={460}>
        <div className="bl-capability-detail">
          <div className="bl-capability-hero"><Icon name={catalogSelection.destination?.icon || 'check'} size={22} /></div>
          <p>
            {catalogSelection.group === 'message_credits'
              ? catalogSelection.pack ? 'Add this credit pack to the selected event through secure hosted checkout.' : 'This catalog price is informational; no matching active credit pack is available in the selected currency.'
              : catalogSelection.group === 'enterprise'
                ? 'This capability is configured with the Festio support team for your organization.'
                : 'Open the live event workspace to configure or use this capability. Access depends on the active Event Pass and enabled add-ons.'}
          </p>
          <div className="bl-capability-facts">
            <div><span>Event Pass</span><strong>{billing.is_paid ? (activeTier?.name || activeTier?.label || billing.plan_tier) : 'Not active'}</strong></div>
            <div><span>Selected event</span><strong>{eventId ? 'Ready' : 'Choose an event'}</strong></div>
          </div>
          <div className="rd-row2">
            <button className="rr-btn secondary" onClick={() => setCatalogSelection(null)}>Close</button>
            <button className="rr-btn primary" disabled={catalogSelection.group === 'message_credits' && !catalogSelection.pack} onClick={runCatalogAction}>
              {catalogSelection.pack ? 'Buy credits' : catalogSelection.destination?.label || 'Open'}
            </button>
          </div>
        </div>
      </Modal>}
    </>
  )
}

function OrgCollections({ notify }) {
  const [lists, setLists] = useState(null)
  const [calendars, setCalendars] = useState(null)
  const [contacts, setContacts] = useState({})
  const [expandedList, setExpandedList] = useState(null)
  const [listName, setListName] = useState('')
  const [contactForm, setContactForm] = useState({ first_name: '', last_name: '', email: '' })
  const [pasteText, setPasteText] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [calendarForm, setCalendarForm] = useState(null)
  const [calendarManage, setCalendarManage] = useState(null)
  const [orgEvents, setOrgEvents] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)

  async function load() {
    try {
      const [nextLists, nextCalendars] = await Promise.all([api.listContactLists(), api.listCalendars()])
      setLists(nextLists); setCalendars(nextCalendars)
    } catch (e) { notify(e.message || 'Organization collections could not be loaded', true); setLists([]); setCalendars([]) }
  }
  useEffect(() => { load() }, [])

  async function openList(id) {
    setExpandedList(expandedList === id ? null : id)
    if (expandedList !== id && !contacts[id]) {
      try { const next = await api.listContacts(id); setContacts((v) => ({ ...v, [id]: next })) }
      catch (e) { notify(e.message || 'Contacts could not be loaded', true) }
    }
  }

  async function refreshContacts(listId) {
    const next = await api.listContacts(listId)
    setContacts((value) => ({ ...value, [listId]: next }))
    await load()
  }

  async function manageCalendar(calendarId) {
    try {
      const [calendar, events] = await Promise.all([api.getCalendar(calendarId), api.listEvents()])
      setCalendarManage(calendar); setOrgEvents(events)
    } catch (error) { notify(error.message || 'Calendar details could not be loaded', true) }
  }

  async function refreshManagedCalendar() {
    if (!calendarManage) return
    const next = await api.getCalendar(calendarManage.id)
    setCalendarManage(next)
    await load()
  }

  return <>
    <div className="rr-panel">
      <div className="rd-panel-head bl-panel-head-row">
        <div><h3><Icon name="file" size={14} /> Contact Lists</h3><p>Saved audiences you can reuse across events</p></div>
        <div className="rd-row2"><input className="rd-field" value={listName} placeholder="New list name" onChange={(e) => setListName(e.target.value)} style={{ margin: 0 }} /><button className="rr-btn secondary" disabled={!listName.trim()} onClick={async () => {
          try { await api.createContactList(listName.trim()); setListName(''); await load(); notify('Contact list created') }
          catch (e) { notify(e.message || 'Contact list could not be created', true) }
        }}><Icon name="plus" size={14} /> Add</button></div>
      </div>
      <div className="rd-panel-body">
        {lists === null ? <LoadingSkeleton rows={3} /> : lists.length === 0 ? <EmptyState icon="file" title="No contact lists" message="Create a reusable calendar audience." /> : <div className="bl-list">{lists.map((list) => <div className="bl-list-row-block" key={list.id}>
          <div className="bl-list-row"><div className="bl-list-main"><strong>{list.name}</strong></div><div className="bl-list-meta">{list.contact_count} contacts</div><div className="bl-list-actions"><button className="rr-link-btn" onClick={() => openList(list.id)}>{expandedList === list.id ? 'Hide' : 'View'}</button><button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget({ type: 'list', item: list })}>Delete</button></div></div>
          {expandedList === list.id && <div className="bl-list-expand">
            <table className="rr-table"><thead><tr><th>Name</th><th>Email</th><th /></tr></thead><tbody>{(contacts[list.id] || []).map((contact) => <tr key={contact.id}><td>{contact.first_name} {contact.last_name || ''}</td><td>{contact.email}</td><td><button className="rr-link-btn gr-danger-link" onClick={async () => {
              try { await api.deleteContact(list.id, contact.id); const next = await api.listContacts(list.id); setContacts((v) => ({ ...v, [list.id]: next })); await load(); notify('Contact removed') }
              catch (e) { notify(e.message || 'Contact could not be removed', true) }
            }}>Remove</button></td></tr>)}</tbody></table>
            <div className="rd-row2" style={{ marginTop: 8 }}><input className="rd-field" placeholder="First name" value={contactForm.first_name} onChange={(e) => setContactForm((v) => ({ ...v, first_name: e.target.value }))} /><input className="rd-field" placeholder="Last name" value={contactForm.last_name} onChange={(e) => setContactForm((v) => ({ ...v, last_name: e.target.value }))} /><input className="rd-field" type="email" placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm((v) => ({ ...v, email: e.target.value }))} /><button className="rr-btn secondary" disabled={!contactForm.first_name || !contactForm.email} onClick={async () => {
              try { await api.addContact(list.id, contactForm); setContactForm({ first_name: '', last_name: '', email: '' }); await refreshContacts(list.id); notify('Contact added') }
              catch (e) { notify(e.message || 'Contact could not be added', true) }
            }}>Add</button></div>
            <div className="rd-row2" style={{ marginTop: 8 }}>
              <button className="rr-link-btn" onClick={() => setPasteOpen((value) => !value)}>{pasteOpen ? 'Hide paste box' : 'Paste multiple contacts'}</button>
              <label className="rr-link-btn" style={{ cursor: 'pointer' }}>Upload CSV
                <input hidden type="file" accept=".csv,.xlsx" onChange={async (event) => {
                  const file = event.target.files?.[0]; event.target.value = ''
                  if (!file) return
                  try {
                    const added = await api.importContactsCsv(list.id, file)
                    await refreshContacts(list.id)
                    notify(`Imported ${added.length} contact${added.length === 1 ? '' : 's'}`)
                  } catch (error) { notify(error.message || 'Contact import failed', true) }
                }}/>
              </label>
            </div>
            {pasteOpen && <div style={{ marginTop: 8 }}><textarea className="rr-textarea" rows={4} value={pasteText} placeholder={'One per line: Name, email@example.com'} onChange={(event) => setPasteText(event.target.value)}/><button className="rr-btn secondary" disabled={!pasteText.trim()} onClick={async () => {
              try {
                await api.pasteContacts(list.id, pasteText)
                setPasteText(''); setPasteOpen(false)
                await refreshContacts(list.id)
                notify('Pasted contacts added')
              } catch (error) { notify(error.message || 'Pasted contacts could not be added', true) }
            }}>Add pasted contacts</button></div>}
          </div>}
        </div>)}</div>}
      </div>
    </div>
    <div className="rr-panel">
      <div className="rd-panel-head bl-panel-head-row"><div><h3><Icon name="calendar" size={14} /> Calendars</h3><p>Published, curated event-listing pages</p></div><button className="rr-btn secondary" onClick={() => setCalendarForm({ title: '', description: '', visibility: 'public', hide_past_events: true })}><Icon name="plus" size={14} /> New calendar</button></div>
      <div className="rd-panel-body">{calendars === null ? <LoadingSkeleton rows={3} /> : calendars.length === 0 ? <EmptyState icon="calendar" title="No calendars" message="Create a curated event calendar." /> : <div className="bl-list">{calendars.map((calendar) => <div className="bl-list-row" key={calendar.id}><div className="bl-list-main"><strong>{calendar.title}</strong><span>{calendar.visibility} · {calendar.event_ids.length} events · {calendar.view_count} views</span></div><div className="bl-list-actions">{calendar.share_token && <a className="rr-link-btn" href={`/calendar/${calendar.share_token}`} target="_blank" rel="noreferrer">Open</a>}<button className="rr-link-btn" onClick={() => manageCalendar(calendar.id)}>Manage</button><button className="rr-link-btn" onClick={() => setCalendarForm(calendar)}>Edit</button><button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget({ type: 'calendar', item: calendar })}>Delete</button></div></div>)}</div>}</div>
    </div>
    {calendarManage && <Modal title={`Manage ${calendarManage.title}`} onClose={() => setCalendarManage(null)} width={680}>
      <div className="rd-row2">
        <div style={{ flex: 1 }}>
          <label className="rd-field-label">Add event</label>
          <select className="rd-field" defaultValue="" onChange={async (event) => {
            const eventId = event.target.value; event.target.value = ''
            if (!eventId) return
            try { await api.addCalendarEvent(calendarManage.id, eventId); await refreshManagedCalendar() }
            catch (error) { notify(error.message || 'Event could not be added', true) }
          }}><option value="">Choose an event…</option>{orgEvents.filter((event) => !calendarManage.event_ids.includes(event.id)).map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="rd-field-label">Calendar logo</label>
          <label className="rr-btn secondary">Upload logo<input hidden type="file" accept="image/*" onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = ''
            if (!file) return
            try { await api.uploadCalendarLogo(calendarManage.id, file); await refreshManagedCalendar(); notify('Calendar logo uploaded') }
            catch (error) { notify(error.message || 'Calendar logo could not be uploaded', true) }
          }}/></label>
          {calendarManage.logo_url && <button className="rr-link-btn gr-danger-link" onClick={async () => {
            try { await api.deleteCalendarLogo(calendarManage.id); await refreshManagedCalendar(); notify('Calendar logo removed') }
            catch (error) { notify(error.message || 'Calendar logo could not be removed', true) }
          }}>Remove logo</button>}
        </div>
      </div>
      <label className="rd-field-label">Curated events (display order)</label>
      <div className="bl-list">{calendarManage.event_ids.map((eventId, index) => {
        const event = orgEvents.find((item) => item.id === eventId)
        return <div className="bl-list-row" key={eventId}><div className="bl-list-main"><strong>{event?.name || eventId}</strong></div><div className="bl-list-actions">
          <button className="rr-link-btn" disabled={index === 0} onClick={async () => {
            const ids = [...calendarManage.event_ids]; [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
            try { await api.reorderCalendarEvents(calendarManage.id, ids); await refreshManagedCalendar() }
            catch (error) { notify(error.message || 'Calendar order could not be updated', true) }
          }}>Up</button>
          <button className="rr-link-btn" disabled={index === calendarManage.event_ids.length - 1} onClick={async () => {
            const ids = [...calendarManage.event_ids]; [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]
            try { await api.reorderCalendarEvents(calendarManage.id, ids); await refreshManagedCalendar() }
            catch (error) { notify(error.message || 'Calendar order could not be updated', true) }
          }}>Down</button>
          <button className="rr-link-btn gr-danger-link" onClick={async () => {
            try { await api.removeCalendarEvent(calendarManage.id, eventId); await refreshManagedCalendar() }
            catch (error) { notify(error.message || 'Event could not be removed', true) }
          }}>Remove</button>
        </div></div>
      })}</div>
      <label className="rd-field-label" style={{ marginTop: 12 }}>Private-link audiences</label>
      <div className="bl-webhook-checks">{(lists || []).map((list) => <label key={list.id}><input type="checkbox" checked={calendarManage.contact_list_ids.includes(list.id)} onChange={async () => {
        const ids = calendarManage.contact_list_ids.includes(list.id) ? calendarManage.contact_list_ids.filter((id) => id !== list.id) : [...calendarManage.contact_list_ids, list.id]
        try { await api.setCalendarContactLists(calendarManage.id, ids); await refreshManagedCalendar() }
        catch (error) { notify(error.message || 'Calendar audience could not be updated', true) }
      }}/> {list.name} ({list.contact_count})</label>)}</div>
      <div className="rd-row2" style={{ marginTop: 14 }}>
        {calendarManage.share_token && <button className="rr-btn secondary" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/calendar/${calendarManage.share_token}`).then(() => notify('Calendar link copied'))}>Copy public link</button>}
        {calendarManage.share_token && <button className="rr-btn secondary" onClick={() => {
          const url = `${window.location.origin}/calendar/${calendarManage.share_token}`
          navigator.clipboard.writeText(`<iframe src="${url}" title="${calendarManage.title}" width="100%" height="720" loading="lazy"></iframe>`).then(() => notify('Calendar embed code copied'))
        }}>Copy embed code</button>}
        <button className="rr-btn primary" disabled={!calendarManage.contact_list_ids.length} onClick={async () => {
          if (!window.confirm('Send each selected contact their private calendar link?')) return
          try { const result = await api.sendCalendarLinks(calendarManage.id); notify(`${result.queued} private calendar link${result.queued === 1 ? '' : 's'} queued`) }
          catch (error) { notify(error.message || 'Calendar links could not be sent', true) }
        }}>Send private links</button>
      </div>
    </Modal>}
    {calendarForm && <Modal title={calendarForm.id ? `Edit ${calendarForm.title}` : 'New calendar'} onClose={() => setCalendarForm(null)} width={480}>
      <label className="rd-field-label">Title *</label><input className="rd-field" value={calendarForm.title} onChange={(e) => setCalendarForm((v) => ({ ...v, title: e.target.value }))} />
      <label className="rd-field-label">Description</label><textarea className="rr-textarea" value={calendarForm.description || ''} onChange={(e) => setCalendarForm((v) => ({ ...v, description: e.target.value }))} />
      <label className="rd-field-label">Visibility</label><select className="rd-field" value={calendarForm.visibility} onChange={(e) => setCalendarForm((v) => ({ ...v, visibility: e.target.value }))}><option value="public">Public</option><option value="private">Private</option></select>
      <label className="gr-required-check"><input type="checkbox" checked={calendarForm.hide_past_events} onChange={(e) => setCalendarForm((v) => ({ ...v, hide_past_events: e.target.checked }))} /> Hide past events</label>
      <div className="rd-row2"><button className="rr-btn secondary" onClick={() => setCalendarForm(null)}>Cancel</button><button className="rr-btn primary" disabled={!calendarForm.title.trim()} onClick={async () => {
        try {
          const payload = { title: calendarForm.title.trim(), description: calendarForm.description || null, visibility: calendarForm.visibility, hide_past_events: calendarForm.hide_past_events }
          if (calendarForm.id) await api.updateCalendar(calendarForm.id, payload); else await api.createCalendar(payload)
          setCalendarForm(null); await load(); notify('Calendar saved')
        } catch (e) { notify(e.message || 'Calendar could not be saved', true) }
      }}>Save calendar</button></div>
    </Modal>}
    {deleteTarget && <ConfirmDialog title={`Delete ${deleteTarget.type}`} message={`Delete “${deleteTarget.item.name || deleteTarget.item.title}”?`} confirmLabel="Delete" onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
      try {
        if (deleteTarget.type === 'list') await api.deleteContactList(deleteTarget.item.id); else await api.deleteCalendar(deleteTarget.item.id)
        setDeleteTarget(null); await load(); notify(`${deleteTarget.type === 'list' ? 'Contact list' : 'Calendar'} deleted`)
      } catch (e) { notify(e.message || 'Item could not be deleted', true) }
    }} />}
  </>
}

function OrgTab({ notify, eventId }) {
  const [subscription, setSubscription] = useState(null)
  const [subscriptionPlans, setSubscriptionPlans] = useState(null)
  const [subscriptionError, setSubscriptionError] = useState('')
  const [subscriptionBusy, setSubscriptionBusy] = useState('')

  async function loadSubscription() {
    setSubscriptionError('')
    try {
      const [current, plans] = await Promise.all([api.getOrgSubscription(), api.listSubscriptionPlans()])
      setSubscription(current); setSubscriptionPlans(plans)
    } catch (error) { setSubscriptionError(error.message || 'Subscription could not be loaded') }
  }
  useEffect(() => { loadSubscription() }, [])

  async function subscribe(plan) {
    setSubscriptionBusy(plan.key); setSubscriptionError('')
    try {
      const result = await api.createOrgSubscriptionCheckout(plan.key)
      if (!result?.url) throw new Error('The billing provider did not return a checkout URL.')
      const hosted = new URL(result.url, window.location.origin)
      if (!['http:', 'https:'].includes(hosted.protocol)) throw new Error('The billing provider returned an invalid checkout URL.')
      window.location.assign(hosted.href)
    } catch (error) { setSubscriptionError(error.message || 'Secure subscription checkout could not be started'); setSubscriptionBusy('') }
  }

  async function cancelSubscription() {
    setSubscriptionBusy('cancel'); setSubscriptionError('')
    try { await api.cancelOrgSubscription(); await loadSubscription(); notify('Subscription canceled') }
    catch (error) { setSubscriptionError(error.message || 'Subscription could not be canceled') }
    finally { setSubscriptionBusy('') }
  }
  // ── Team members (real: listOrgMembers / inviteOrgMember / setOrgMemberRole) ──
  // These endpoints are event-scoped in the URL (they resolve the event's org
  // server-side) but the data + effect is org-wide, matching AdminPage.jsx's
  // TeamPanel "Organization members & roles" section. No remove/delete
  // endpoint exists for org members, so there is no remove action here.
  const [orgMembers, setOrgMembers] = useState(null) // null = loading
  const [membersErr, setMembersErr] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'staff' })
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteErr, setInviteErr] = useState('')
  const [roleSubmittingFor, setRoleSubmittingFor] = useState(null)
  const [roleErr, setRoleErr] = useState('')

  async function loadMembers() {
    setMembersErr('')
    try { setOrgMembers(await api.listOrgMembers(eventId)) }
    catch (e) { setMembersErr(e.message) }
  }

  useEffect(() => {
    if (!eventId) { setOrgMembers([]); return }
    setOrgMembers(null)
    loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  async function inviteTeammate(e) {
    e.preventDefault()
    if (!invite.email.trim()) return
    setInviteSubmitting(true); setInviteErr('')
    try {
      await api.inviteOrgMember(eventId, { email: invite.email.trim(), role: invite.role })
      setInvite({ email: '', role: 'staff' })
      await loadMembers()
      notify('Teammate added to your organization.')
    } catch (e) { setInviteErr(e.message) }
    finally { setInviteSubmitting(false) }
  }

  async function changeRole(userId, role) {
    setRoleSubmittingFor(userId); setRoleErr('')
    try {
      await api.setOrgMemberRole(eventId, userId, role)
      await loadMembers()
      notify('Role updated.')
    } catch (e) { setRoleErr(e.message) }
    finally { setRoleSubmittingFor(null) }
  }

  // ── API keys (real: listApiKeys / createApiKey / revokeApiKey) ──────────
  const [apiKeys, setApiKeys] = useState(null) // null = loading
  const [keysErr, setKeysErr] = useState('')
  const [newKeyOpen, setNewKeyOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScope, setNewKeyScope] = useState('read_only')
  const [creatingKey, setCreatingKey] = useState(false)
  const [createKeyErr, setCreateKeyErr] = useState('')
  const [revealedKey, setRevealedKey] = useState(null)
  const [revokeKeyTarget, setRevokeKeyTarget] = useState(null)
  const [revokingKeyId, setRevokingKeyId] = useState(null)

  async function loadKeys() {
    setKeysErr('')
    try { setApiKeys(await api.listApiKeys()) }
    catch (e) { setKeysErr(e.message) }
  }
  useEffect(() => { loadKeys() }, [])

  async function createKey() {
    if (!newKeyName.trim()) { setCreateKeyErr('Key name is required.'); return }
    setCreatingKey(true); setCreateKeyErr('')
    try {
      const created = await api.createApiKey(newKeyName.trim(), newKeyScope)
      setRevealedKey(created)
      setNewKeyName(''); setNewKeyScope('read_only'); setNewKeyOpen(false)
      await loadKeys()
      notify('API key created')
    } catch (e) { setCreateKeyErr(e.message) }
    finally { setCreatingKey(false) }
  }

  async function confirmRevokeKey() {
    if (!revokeKeyTarget) return
    setRevokingKeyId(revokeKeyTarget.id)
    try {
      await api.revokeApiKey(revokeKeyTarget.id)
      notify(`Revoked "${revokeKeyTarget.name}"`)
      setRevokeKeyTarget(null)
      await loadKeys()
    } catch (e) { setKeysErr(e.message); setRevokeKeyTarget(null) }
    finally { setRevokingKeyId(null) }
  }

  // ── Webhooks (real: listWebhooks / createWebhook / deleteWebhook / listWebhookDeliveries) ──
  const [webhooks, setWebhooks] = useState(null) // null = loading
  const [webhooksErr, setWebhooksErr] = useState('')
  const [webhookFormOpen, setWebhookFormOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState(() => new Set([WEBHOOK_EVENT_TYPES[0]]))
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [createWebhookErr, setCreateWebhookErr] = useState('')
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState(null)
  const [deleteWebhookTarget, setDeleteWebhookTarget] = useState(null)
  const [deletingWebhookId, setDeletingWebhookId] = useState(null)
  const [deliveriesFor, setDeliveriesFor] = useState(null)
  const [deliveries, setDeliveries] = useState(null)
  const [deliveriesErr, setDeliveriesErr] = useState('')

  async function loadWebhooks() {
    setWebhooksErr('')
    try { setWebhooks(await api.listWebhooks()) }
    catch (e) { setWebhooksErr(e.message) }
  }
  useEffect(() => { loadWebhooks() }, [])

  function toggleWebhookEvent(ev) {
    setWebhookEvents((prev) => {
      const next = new Set(prev)
      if (next.has(ev)) next.delete(ev)
      else next.add(ev)
      return next
    })
  }

  async function createWebhookReal() {
    if (!webhookUrl.trim() || webhookEvents.size === 0) {
      setCreateWebhookErr('Enter an endpoint URL and select at least one event type.')
      return
    }
    setCreatingWebhook(true); setCreateWebhookErr('')
    try {
      const created = await api.createWebhook(webhookUrl.trim(), [...webhookEvents])
      setRevealedWebhookSecret(created)
      setWebhookUrl(''); setWebhookEvents(new Set([WEBHOOK_EVENT_TYPES[0]])); setWebhookFormOpen(false)
      await loadWebhooks()
      notify('Webhook created')
    } catch (e) { setCreateWebhookErr(e.message) }
    finally { setCreatingWebhook(false) }
  }

  async function confirmDeleteWebhook() {
    if (!deleteWebhookTarget) return
    setDeletingWebhookId(deleteWebhookTarget.id)
    try {
      await api.deleteWebhook(deleteWebhookTarget.id)
      if (deliveriesFor === deleteWebhookTarget.id) setDeliveriesFor(null)
      notify(`Deleted webhook ${deleteWebhookTarget.url}`)
      setDeleteWebhookTarget(null)
      await loadWebhooks()
    } catch (e) { setWebhooksErr(e.message); setDeleteWebhookTarget(null) }
    finally { setDeletingWebhookId(null) }
  }

  async function loadDeliveries(webhookId) {
    setDeliveries(null); setDeliveriesErr('')
    try { setDeliveries(await api.listWebhookDeliveries(webhookId)) }
    catch (e) { setDeliveriesErr(e.message) }
  }

  function toggleDeliveries(w) {
    if (deliveriesFor === w.id) { setDeliveriesFor(null); return }
    setDeliveriesFor(w.id)
    loadDeliveries(w.id)
  }

  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : null }
  function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString() : '—' }

  return (
    <div className="bl-org-stack">
      {revealedKey && (
        <div className="rr-panel bl-reveal-banner">
          <div><strong>Your new API key</strong> — copy it now, it won't be shown again.</div>
          <div className="bl-mono">{revealedKey.key} <button className="bl-icon-btn" onClick={() => { navigator.clipboard?.writeText(revealedKey.key).catch(() => {}); notify('Key copied to clipboard') }}><Icon name="file" size={12} /></button></div>
          <button className="rr-link-btn" onClick={() => setRevealedKey(null)}>Dismiss</button>
        </div>
      )}

      {revealedWebhookSecret && (
        <div className="rr-panel bl-reveal-banner">
          <div><strong>Webhook signing secret</strong> — copy it now, it won't be shown again.</div>
          <div className="bl-mono">{revealedWebhookSecret.secret} <button className="bl-icon-btn" onClick={() => { navigator.clipboard?.writeText(revealedWebhookSecret.secret).catch(() => {}); notify('Secret copied to clipboard') }}><Icon name="file" size={12} /></button></div>
          <button className="rr-link-btn" onClick={() => setRevealedWebhookSecret(null)}>Dismiss</button>
        </div>
      )}

      <div className="rr-panel">
        <div className="rd-panel-head bl-panel-head-row">
          <div><h3><Icon name="team" size={14} /> Team members</h3><p>People with access across your organization's events</p></div>
        </div>
        <div className="rd-panel-body">
          {!eventId ? (
            <EmptyState icon="users" title="No event selected" message="Select an event from the sidebar to manage your organization's team." />
          ) : membersErr && orgMembers === null ? (
            <ErrorRetryState message={membersErr} onRetry={loadMembers} />
          ) : orgMembers === null ? (
            <LoadingSkeleton variant="list" rows={3} />
          ) : (
            <>
              {roleErr && <p className="rp-field-error">{roleErr}</p>}
              {orgMembers.length === 0 ? (
                <EmptyState icon="users" title="No teammates yet" message="Invite someone below to get started." />
              ) : (
                <div className="bl-list">
                  {orgMembers.map((m) => (
                    <div className="bl-list-row" key={m.user.id}>
                      <div className="bl-list-main">
                        <strong>{m.user.name}</strong>
                        <span className="bl-mono">{m.user.email}</span>
                      </div>
                      <div className="bl-list-actions">
                        <select
                          value={m.role}
                          disabled={roleSubmittingFor === m.user.id}
                          onChange={(e) => changeRole(m.user.id, e.target.value)}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="staff">Staff</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form className="ci-form-inset" onSubmit={inviteTeammate} style={{ marginTop: 14 }}>
                <label className="rd-field-label">Add a teammate to your organization</label>
                {inviteErr && <p className="rp-field-error">{inviteErr}</p>}
                <div className="rd-row2">
                  <input
                    type="email"
                    className="rd-field"
                    placeholder="teammate@email.com"
                    value={invite.email}
                    onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
                  />
                  <select
                    className="rd-field"
                    value={invite.role}
                    onChange={(e) => setInvite((p) => ({ ...p, role: e.target.value }))}
                    style={{ flex: '0 0 auto' }}
                  >
                    <option value="staff">Staff (scan / day-of)</option>
                    <option value="admin">Admin (manage events)</option>
                  </select>
                </div>
                <button className="rr-btn primary" type="submit" style={{ marginTop: 10 }} disabled={inviteSubmitting || !invite.email.trim()}>
                  {inviteSubmitting ? 'Adding…' : 'Add teammate'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <div className="rr-panel">
        <div className="rd-panel-head bl-panel-head-row">
          <div><h3><Icon name="api" size={14} /> API Keys</h3><p>Used for Public API v2 access — tables, table-groups, Experience, and guest CRUD</p></div>
          <button className="rr-btn secondary" onClick={() => setNewKeyOpen((v) => !v)}><Icon name="plus" size={14} /> Create new key</button>
        </div>
        <div className="rd-panel-body">
          {newKeyOpen && (
            <div className="ci-form-inset">
              {createKeyErr && <p className="rp-field-error">{createKeyErr}</p>}
              <label className="rd-field-label">Key name</label>
              <input className="rd-field" placeholder="e.g. Zapier integration" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
              <label className="rd-field-label">Scope</label>
              <label className="gr-required-check"><input type="radio" checked={newKeyScope === 'read_only'} onChange={() => setNewKeyScope('read_only')} /> Read-only</label>
              <label className="gr-required-check"><input type="radio" checked={newKeyScope === 'read_write'} onChange={() => setNewKeyScope('read_write')} disabled={subscription?.status !== 'active'} /> Read-write {subscription?.status !== 'active' && '(requires API subscription)'}</label>
              <button className="rr-btn primary" style={{ marginTop: 10 }} disabled={creatingKey || !newKeyName.trim()} onClick={createKey}>
                {creatingKey ? 'Creating…' : 'Create key'}
              </button>
            </div>
          )}
          {keysErr && apiKeys === null ? (
            <ErrorRetryState message={keysErr} onRetry={loadKeys} />
          ) : apiKeys === null ? (
            <LoadingSkeleton variant="list" rows={2} />
          ) : (
            <>
              {keysErr && <p className="rp-field-error">{keysErr}</p>}
              {apiKeys.length === 0 ? (
                <EmptyState icon="api" title="No API keys yet" message="Create one above to start integrating." />
              ) : (
                <div className="bl-list">
                  {apiKeys.map((k) => (
                    <div className="bl-list-row" key={k.id}>
                      <div className="bl-list-main">
                        <strong>{k.name}</strong> <span className={`rd-status-chip ${k.scope === 'read_write' ? 'ok' : 'bl-chip-neutral'}`}>{k.scope === 'read_write' ? 'Read-write' : 'Read-only'}</span>
                        {k.revoked_at && <span className="rd-status-chip fail">Revoked</span>}
                        <span className="bl-mono">{k.key_prefix}…</span>
                      </div>
                      <div className="bl-list-meta">
                        <span>Created {fmtDate(k.created_at)}</span>
                        <span>{k.last_used_at ? `Last used ${fmtDate(k.last_used_at)}` : 'Never used'}</span>
                      </div>
                      <div className="bl-list-actions">
                        {!k.revoked_at && (
                          <button className="rr-link-btn" disabled={revokingKeyId === k.id} onClick={() => setRevokeKeyTarget(k)}>Revoke</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="bl-quickstart">
            <span>curl -H "X-API-Key: YOUR_KEY" https://festio.events/api/public/v1/guests</span>
            <a href="/api-docs" target="_blank" rel="noreferrer">API docs ↗</a>
            <a href="/api-explorer-redesign" onClick={(e) => { e.preventDefault(); window.location.href = '/api-explorer-redesign' }}>Open API Explorer →</a>
          </div>
        </div>
      </div>

      <div className="rr-panel">
        <div className="rd-panel-head bl-panel-head-row">
          <div><h3><Icon name="card" size={14} /> Subscription</h3><p>Unlocks read-write API keys for this organization</p></div>
        </div>
        <div className="rd-panel-body">
          {subscriptionError && <p className="rp-field-error">{subscriptionError}</p>}
          {subscription === null || subscriptionPlans === null ? <LoadingSkeleton rows={2}/> : subscription.status === 'active' ? (
            <>
              <div className="bl-sub-row">
                <div className="bl-sub-stat"><span>Plan</span><strong>{subscription.plan || 'Active'}</strong></div>
                <div className="bl-sub-stat"><span>Provider</span><strong>{subscription.provider || '—'}</strong></div>
                <div className="bl-sub-stat"><span>Current period ends</span><strong>{subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : '—'}</strong></div>
              </div>
              <button className="rr-link-btn gr-danger-link" disabled={subscriptionBusy === 'cancel'} style={{ marginTop: 10 }} onClick={cancelSubscription}>{subscriptionBusy === 'cancel' ? 'Canceling…' : 'Cancel subscription'}</button>
            </>
          ) : (
            <div className="rr-grid2">
              {subscriptionPlans.map((p) => (
                <div className="rr-panel bl-pack-card" key={p.key}>
                  <strong>{p.label}</strong>
                  <span>{billingMoney(p.amount, p.currency)}/month</span>
                  <ul className="bl-tier-list">{(p.features || []).map((f) => <li key={f}><Icon name="check" size={11} /> {f}</li>)}</ul>
                  <button data-org-plan-key={p.key} disabled={!!subscriptionBusy} className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => subscribe(p)}>{subscriptionBusy === p.key ? 'Opening secure checkout…' : 'Continue to hosted checkout'}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rr-panel">
        <div className="rd-panel-head bl-panel-head-row">
          <div><h3><Icon name="bell" size={14} /> Webhooks</h3><p>Outbound event notifications to your own endpoints</p></div>
          <button className="rr-btn secondary" onClick={() => setWebhookFormOpen((v) => !v)}><Icon name="plus" size={14} /> Add webhook</button>
        </div>
        <div className="rd-panel-body">
          {webhookFormOpen && (
            <div className="ci-form-inset">
              {createWebhookErr && <p className="rp-field-error">{createWebhookErr}</p>}
              <label className="rd-field-label">Endpoint URL</label>
              <input className="rd-field" placeholder="https://your-app.com/webhooks/festio" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
              <label className="rd-field-label">Event types</label>
              <div className="bl-webhook-checks">
                {WEBHOOK_EVENT_TYPES.map((ev) => (
                  <label key={ev}><input type="checkbox" checked={webhookEvents.has(ev)} onChange={() => toggleWebhookEvent(ev)} /> {ev}</label>
                ))}
              </div>
              <button className="rr-btn primary" style={{ marginTop: 10 }} disabled={creatingWebhook || !webhookUrl.trim() || webhookEvents.size === 0} onClick={createWebhookReal}>
                {creatingWebhook ? 'Creating…' : 'Create webhook'}
              </button>
            </div>
          )}
          {webhooksErr && webhooks === null ? (
            <ErrorRetryState message={webhooksErr} onRetry={loadWebhooks} />
          ) : webhooks === null ? (
            <LoadingSkeleton variant="list" rows={2} />
          ) : (
            <>
              {webhooksErr && <p className="rp-field-error">{webhooksErr}</p>}
              {webhooks.length === 0 ? (
                <EmptyState icon="bell" title="No webhooks yet" message="Add one above to get outbound event notifications." />
              ) : (
                <div className="bl-list">
                  {webhooks.map((w) => (
                    <div className="bl-list-row bl-list-row-wrap" key={w.id}>
                      <div className="bl-list-main">
                        <strong className="bl-mono">{w.url}</strong>
                        <span className="bl-webhook-events">{w.event_types.join(', ')}</span>
                      </div>
                      <div className="bl-list-meta">
                        <span className={`rd-status-chip ${w.is_active ? 'ok' : 'fail'}`}>{w.is_active ? 'Active' : 'Inactive'}</span>
                      </div>
                      <div className="bl-list-actions">
                        <button className="rr-link-btn" onClick={() => toggleDeliveries(w)}>{deliveriesFor === w.id ? 'Hide deliveries' : 'View deliveries'}</button>
                        <button className="rr-link-btn gr-danger-link" disabled={deletingWebhookId === w.id} onClick={() => setDeleteWebhookTarget(w)}>Delete</button>
                      </div>
                      {deliveriesFor === w.id && (
                        <div className="bl-list-expand">
                          {deliveriesErr ? (
                            <ErrorRetryState message={deliveriesErr} onRetry={() => loadDeliveries(w.id)} />
                          ) : deliveries === null ? (
                            <LoadingSkeleton variant="list" rows={2} />
                          ) : deliveries.length === 0 ? (
                            <EmptyState icon="bell" title="No deliveries yet" message="Nothing has been sent to this endpoint yet." />
                          ) : (
                            <table className="rr-table">
                              <thead><tr><th>Event</th><th>Status</th><th>Attempt</th><th>When</th></tr></thead>
                              <tbody>
                                {deliveries.map((d) => (
                                  <tr key={d.id}>
                                    <td>{d.event_type}</td>
                                    <td><span className={`rd-status-chip ${d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'fail' : 'bl-chip-neutral'}`}>{d.status}</span></td>
                                    <td>{d.attempt_count}</td>
                                    <td className="rd-rowlink">{fmtDateTime(d.delivered_at || d.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <OrgCollections notify={notify} />

      {revokeKeyTarget && (
        <ConfirmDialog
          title="Revoke API key?"
          message={`Anything using "${revokeKeyTarget.name}" will stop working immediately. This cannot be undone.`}
          confirmLabel={revokingKeyId ? 'Revoking…' : 'Revoke'}
          onConfirm={confirmRevokeKey}
          onCancel={() => setRevokeKeyTarget(null)}
        />
      )}

      {deleteWebhookTarget && (
        <ConfirmDialog
          title="Delete webhook?"
          message={`"${deleteWebhookTarget.url}" will stop receiving events immediately. This cannot be undone.`}
          confirmLabel={deletingWebhookId ? 'Deleting…' : 'Delete'}
          onConfirm={confirmDeleteWebhook}
          onCancel={() => setDeleteWebhookTarget(null)}
        />
      )}
    </div>
  )
}

export default function BillingRedesignPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [eventId] = useCurrentEvent()
  const [toast, setToast] = useState('')
  const [checkout, setCheckout] = useState(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [orgIdentity, setOrgIdentity] = useState(null)

  const tabParam = searchParams.get('tab')
  const tab = tabParam === 'org' ? 'org' : 'billing'

  useEffect(() => {
    if (tab !== 'org') return
    let alive = true
    api.supportIdentify()
      .then((identity) => { if (alive) setOrgIdentity(identity) })
      .catch(() => { if (alive) setOrgIdentity(null) })
    return () => { alive = false }
  }, [tab])

  function notify(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function openCheckout(type, selectedPlan) {
    if (!eventId) { notify('Choose an event before starting checkout.'); return }
    setCheckoutError('')
    try {
      const info = await api.getBillingTiers(eventId)
      const candidates = type === 'credits' ? info.packs || [] : info.tiers || []
      const plan = candidates.find((entry) => entry.key === selectedPlan?.key)
      if (!plan) throw new Error('This item is no longer available in the current billing catalogue.')
      setCheckout({
        type,
        item: plan.name || plan.label,
        price: billingMoney(plan.amount, plan.currency || info.currency),
        plan,
        provider: info.provider,
        configured: info.configured,
      })
    } catch (error) {
      notify(error.message || 'Billing catalogue could not be loaded.')
    }
  }

  async function beginHostedCheckout() {
    if (!checkout?.plan?.key) return
    setCheckoutBusy(true); setCheckoutError('')
    try {
      const result = await api.checkout(eventId, checkout.plan.key)
      if (!result?.url) throw new Error('The billing provider did not return a checkout URL.')
      const hostedUrl = new URL(result.url, window.location.origin)
      if (!['http:', 'https:'].includes(hostedUrl.protocol)) throw new Error('The billing provider returned an invalid checkout URL.')
      window.location.assign(hostedUrl.href)
    } catch (error) {
      setCheckoutError(error.message || 'Secure checkout could not be started.')
      setCheckoutBusy(false)
    }
  }

  function goTab(id) {
    setSearchParams({ tab: id })
  }

  const checkoutModal = checkout && (
    <Modal title={checkout.type === 'pass' ? `Buy ${checkout.item}` : `Buy credits — ${checkout.item}`} onClose={() => setCheckout(null)} width={420}>
      <p style={{ fontSize: '0.85rem', marginBottom: 10 }}>{checkout.item} · <strong>{checkout.price}</strong></p>
      <p className="rd-hint">
        Continue to {checkout.provider?.toUpperCase()} secure checkout. Card details are entered only on the provider's hosted page and never pass through Festio.
      </p>
      {!checkout.configured && <p className="rp-field-error">{checkout.provider?.toUpperCase()} checkout is not configured.</p>}
      {checkoutError && <p className="rp-field-error">{checkoutError}</p>}
      <div className="rd-row2" style={{ marginTop: 14 }}>
        <button className="rr-btn secondary" disabled={checkoutBusy} onClick={() => setCheckout(null)}>Cancel</button>
        <button data-testid="hosted-checkout-submit" data-plan-key={checkout.plan.key} className="rr-btn primary" disabled={checkoutBusy || !checkout.configured} onClick={beginHostedCheckout}>
          {checkoutBusy ? 'Opening secure checkout…' : `Continue to ${checkout.provider || 'provider'}`}
        </button>
      </div>
    </Modal>
  )

  if (tab === 'org') {
    return (
      <RedesignShell topActive="org" withEventSidebar={false} eventActive={null}>
        <div className="rr-pagehead">
          <div>
            <div className="rr-title-row"><h1><Icon name="settings" size={20} /> Org Settings</h1></div>
            <div className="rr-meta"><Icon name="calendar" size={13} /> {orgIdentity?.org_name || 'Your organization'}{orgIdentity?.plan && <><span className="rr-dot">·</span> {orgIdentity.plan}</>}</div>
          </div>
        </div>

        <TabsStrip tab={tab} goTab={goTab} />
        <OrgTab notify={notify} eventId={eventId} />

        {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
        {checkoutModal}
      </RedesignShell>
    )
  }

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive="billing">
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Billing</h1></div>
          <div className="rr-meta"><Icon name="card" size={13} /> Event Passes, hosted checkout, and message credits</div>
        </div>
      </div>

      <TabsStrip tab={tab} goTab={goTab} />
      <BillingTab notify={notify} eventId={eventId} onBuyPass={(plan) => openCheckout('pass', plan)} onBuyCredits={(plan) => openCheckout('credits', plan)} />

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
      {checkoutModal}
    </RedesignShell>
  )
}
