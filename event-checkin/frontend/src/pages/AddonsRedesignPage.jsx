import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ConfirmDialog } from './redesign/RedesignShell'
import { EmptyState, ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { useEntitlements } from '../hooks/useEventResources'
import { api } from '../api'
import { RealOrdersContent, RealSeatingContent } from './redesign/RealOperationsContent'
import './AddonsRedesignPage.css'

// Sidebar nav ids differ slightly from the ?tab= values (RedesignShell.jsx
// SIDEBAR_NAV: Orders row uses id "menu" even though its link is ?tab=orders),
// so eventActive needs its own small map rather than reusing the tab id.
const EVENT_ACTIVE_MAP = { seating: 'seating', orders: 'menu', logistics: 'logistics', registry: 'registry', speakers: 'speakers', partners: 'partners', reminders: 'reminders' }

const TABS = [
  { id: 'seating', label: 'Seating' },
  { id: 'orders', label: 'Orders' },
  { id: 'logistics', label: 'Deliveries' },
  { id: 'registry', label: 'Gift list' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'partners', label: 'Partners' },
  { id: 'reminders', label: 'Reminders' },
]

const TAB_META = {
  seating: {
    title: 'Seating',
    icon: 'chair',
    desc: 'Assign guests to tables and preview your floor plan before doors open.',
    pitch: 'Auto-assign guests to tables, track capacity per table, and preview the seating chart from one screen.',
  },
  orders: {
    title: 'Orders',
    icon: 'card',
    desc: 'Let guests pick meals, drinks and gift bags — then hand your caterer a live prep list.',
    pitch: 'Collect food, drink and gift-bag selections from guests and track who has been served in real time.',
  },
  logistics: {
    title: 'Deliveries',
    icon: 'upload',
    desc: 'Ship merch and gifts straight to guests, with a packing list ready for your vendor.',
    pitch: 'Track every shipment from label to doorstep, and generate a packing list your vendor can work from.',
  },
  registry: {
    title: 'Gift list',
    icon: 'image',
    desc: 'A mark-only gift registry — guests mark what they are bringing, no payments move through Festio.',
    pitch: 'Give guests a wishlist and a cash fund to choose from, and see who claimed what as it happens.',
  },
  speakers: {
    title: 'Speakers',
    icon: 'users',
    desc: 'Showcase your guest speakers with bios, photos and social links on a public page.',
    pitch: 'Highlight your featured speakers and help attendees connect with them through social media.',
  },
  partners: {
    title: 'Partners',
    icon: 'users',
    desc: 'Showcase your sponsors and partners, grouped into your own categories, on a public page.',
    pitch: "Give sponsors and partners the recognition they're paying for, organized into categories you control.",
  },
  reminders: {
    title: 'Reminders',
    icon: 'clock',
    desc: 'Schedule a series of email/SMS/WhatsApp reminders before your event, each targeted by RSVP status.',
    pitch: 'Automatically nudge non-responders and remind confirmed guests as the date approaches — no manual resends.',
  },
}

function ModuleHeader({ meta, unlocked }) {
  return (
    <div className="ad-module-head">
      <span className="ad-module-icon"><Icon name={meta.icon} size={18} /></span>
      <div className="ad-module-head-text">
        <h2>{meta.title}</h2>
        <p>{meta.desc}</p>
      </div>
      {!unlocked && <span className="rr-locked-badge"><Icon name="lock" size={11} /> Not enabled</span>}
    </div>
  )
}

function LockedPanel({ meta, notify }) {
  return (
    <div className="rr-panel rr-locked ad-locked-panel">
      <ModuleHeader meta={meta} unlocked={false} />
      <p className="ad-locked-pitch">{meta.pitch}</p>
      <button className="rr-btn primary rr-locked-cta" onClick={() => { window.location.href = '/billing-redesign' }}>
        <Icon name="arrow" size={13} /> Upgrade to enable
      </button>
    </div>
  )
}

function ShipmentLinesPanel({ eventId, shipment, notify, onChanged, onClose }) {
  const [lines, setLines] = useState(null)
  const [allGuests, setAllGuests] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')

  async function load() {
    try { setLines(await api.listShipmentLines(eventId, shipment.id)) }
    catch (error) { notify(error.message || 'Shipment recipients could not be loaded', true) }
  }
  useEffect(() => { load() }, [eventId, shipment.id])

  async function populate() {
    if (busy) return
    setBusy('populate')
    try {
      const result = await api.populateShipment(eventId, shipment.id)
      await Promise.all([load(), onChanged()])
      notify(`${Number(result.added || 0)} confirmed guest${Number(result.added || 0) === 1 ? '' : 's'} added`)
    } catch (error) { notify(error.message || 'Confirmed guests could not be added', true) }
    finally { setBusy('') }
  }

  async function openPicker() {
    try {
      setAllGuests(await api.listGuests(eventId))
      setPickerOpen(true); setQuery('')
    } catch (error) { notify(error.message || 'Guest list could not be loaded', true) }
  }

  async function addGuest(guestId) {
    setBusy(`add:${guestId}`)
    try {
      await api.addShipmentGuest(eventId, shipment.id, guestId)
      await Promise.all([load(), onChanged()])
    } catch (error) { notify(error.message || 'Guest could not be added', true) }
    finally { setBusy('') }
  }

  async function removeGuest(line) {
    if (!window.confirm(`Remove ${line.first_name} ${line.last_name} from this shipment?`)) return
    setBusy(`remove:${line.guest_id}`)
    try {
      await api.removeShipmentGuest(eventId, shipment.id, line.guest_id)
      await Promise.all([load(), onChanged()])
    } catch (error) { notify(error.message || 'Guest could not be removed', true) }
    finally { setBusy('') }
  }

  async function saveLine() {
    if (!editing || busy) return
    setBusy(`save:${editing.guest_id}`)
    try {
      await Promise.all([
        api.updateShipmentLine(eventId, shipment.id, editing.guest_id, {
          item: editing.item || null,
          size: editing.size || null,
          quantity: Math.max(1, Number(editing.quantity) || 1),
          ship_status: editing.ship_status,
          tracking_number: editing.tracking_number || null,
        }),
        api.updateGuestShipping(eventId, editing.guest_id, {
          ship_address1: editing.ship_address1 || null,
          ship_address2: editing.ship_address2 || null,
          ship_city: editing.ship_city || null,
          ship_state: editing.ship_state || null,
          ship_postal: editing.ship_postal || null,
          ship_country: editing.ship_country || null,
        }),
      ])
      setEditing(null)
      await load()
      notify('Shipment recipient updated')
    } catch (error) { notify(error.message || 'Shipment recipient could not be updated', true) }
    finally { setBusy('') }
  }

  async function sendVendor() {
    if (!shipment.vendor_email) return notify('Add a vendor email before sending the shipment list', true)
    if (!window.confirm(`Email the shipment list to ${shipment.vendor_email}?`)) return
    setBusy('vendor')
    try {
      await api.sendShipmentToVendor(eventId, shipment.id)
      await onChanged()
      notify(`Shipment list sent to ${shipment.vendor_email}`)
    } catch (error) { notify(error.message || 'Shipment list could not be sent', true) }
    finally { setBusy('') }
  }

  const address = (line) => [line.ship_address1, line.ship_address2, line.ship_city, line.ship_state, line.ship_postal, line.ship_country].filter(Boolean).join(', ')
  const listedIds = new Set((lines || []).map((line) => line.guest_id))
  const availableGuests = allGuests.filter((guest) => {
    if (listedIds.has(guest.id)) return false
    const value = `${guest.first_name} ${guest.last_name} ${guest.email || ''} ${guest.phone || ''}`.toLowerCase()
    return !query.trim() || value.includes(query.trim().toLowerCase())
  })

  return (
    <div className="rr-panel">
      <div className="rd-panel-head bl-panel-head-row">
        <div><h3>{shipment.name} recipients</h3><p>Addresses, packing details, status and vendor hand-off</p></div>
        <button className="rr-link-btn" onClick={onClose}>Close</button>
      </div>
      <div className="rd-panel-body">
        <div className="ad-toolbar">
          <button className="rr-btn secondary" onClick={openPicker}><Icon name="plus" size={12}/> Add guest</button>
          <button className="rr-btn secondary" disabled={!!busy} onClick={populate}>Add all confirmed</button>
          <button className="rr-btn secondary" onClick={() => {
            const url = `${window.location.origin}/vendor/${shipment.share_token}`
            navigator.clipboard.writeText(url).then(() => notify('Vendor link copied')).catch(() => notify('Vendor link could not be copied', true))
          }}>Copy vendor link</button>
          <button className="rr-btn primary" disabled={!!busy || !shipment.vendor_email} onClick={sendVendor}>{busy === 'vendor' ? 'Sending…' : 'Send to vendor'}</button>
        </div>
        {lines === null ? <LoadingSkeleton rows={4} variant="table"/> : lines.length === 0 ? (
          <EmptyState icon="team" title="No recipients" message="Add guests individually or populate from confirmed RSVPs." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rr-table">
              <thead><tr><th>Guest</th><th>Address</th><th>Item</th><th>Size</th><th>Qty</th><th>Status</th><th>Tracking</th><th /></tr></thead>
              <tbody>{lines.map((line) => <tr key={line.guest_id}>
                <td>{line.first_name} {line.last_name}</td>
                <td className={line.has_address ? 'rd-rowlink' : 'rp-field-error'}>{line.has_address ? address(line) : 'No address'}</td>
                <td>{line.item || shipment.name}</td><td>{line.size || '—'}</td><td>{line.quantity}</td>
                <td><span className={`rd-status-chip ${line.ship_status === 'delivered' ? 'ok' : line.ship_status === 'shipped' ? 'bl-chip-neutral' : 'warn'}`}>{line.ship_status}</span></td>
                <td>{line.tracking_number || '—'}</td>
                <td className="gr-actions"><button className="rr-link-btn" onClick={() => setEditing({ ...line })}>Edit</button><button className="rr-link-btn gr-danger-link" disabled={!!busy} onClick={() => removeGuest(line)}>Remove</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {pickerOpen && <Modal title="Add guest to shipment" onClose={() => setPickerOpen(false)} width={520}>
        <input className="rd-field" autoFocus placeholder="Search guests…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="bl-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {availableGuests.slice(0, 100).map((guest) => <div className="bl-list-row" key={guest.id}>
            <div className="bl-list-main"><strong>{guest.first_name} {guest.last_name}</strong><span>{guest.email || guest.phone || 'No contact'}</span></div>
            <button className="rr-btn secondary" disabled={!!busy} onClick={() => addGuest(guest.id)}>{busy === `add:${guest.id}` ? 'Adding…' : 'Add'}</button>
          </div>)}
          {availableGuests.length === 0 && <div className="rd-hint">No matching guests outside this shipment.</div>}
        </div>
      </Modal>}

      {editing && <Modal title={`Edit ${editing.first_name} ${editing.last_name}`} onClose={() => setEditing(null)} width={620}>
        <div className="rd-row2">
          <div><label className="rd-field-label">Address line 1</label><input className="rd-field" value={editing.ship_address1 || ''} onChange={(e) => setEditing((value) => ({ ...value, ship_address1: e.target.value }))}/></div>
          <div><label className="rd-field-label">Address line 2</label><input className="rd-field" value={editing.ship_address2 || ''} onChange={(e) => setEditing((value) => ({ ...value, ship_address2: e.target.value }))}/></div>
        </div>
        <div className="rd-row2">
          <div><label className="rd-field-label">City</label><input className="rd-field" value={editing.ship_city || ''} onChange={(e) => setEditing((value) => ({ ...value, ship_city: e.target.value }))}/></div>
          <div><label className="rd-field-label">State</label><input className="rd-field" value={editing.ship_state || ''} onChange={(e) => setEditing((value) => ({ ...value, ship_state: e.target.value }))}/></div>
        </div>
        <div className="rd-row2">
          <div><label className="rd-field-label">Postal code</label><input className="rd-field" value={editing.ship_postal || ''} onChange={(e) => setEditing((value) => ({ ...value, ship_postal: e.target.value }))}/></div>
          <div><label className="rd-field-label">Country</label><input className="rd-field" value={editing.ship_country || ''} onChange={(e) => setEditing((value) => ({ ...value, ship_country: e.target.value }))}/></div>
        </div>
        <div className="rd-row2">
          <div><label className="rd-field-label">Item</label><input className="rd-field" value={editing.item || ''} onChange={(e) => setEditing((value) => ({ ...value, item: e.target.value }))}/></div>
          <div><label className="rd-field-label">Size</label><input className="rd-field" value={editing.size || ''} onChange={(e) => setEditing((value) => ({ ...value, size: e.target.value }))}/></div>
          <div><label className="rd-field-label">Quantity</label><input className="rd-field" type="number" min="1" value={editing.quantity || 1} onChange={(e) => setEditing((value) => ({ ...value, quantity: e.target.value }))}/></div>
        </div>
        <div className="rd-row2">
          <div><label className="rd-field-label">Status</label><select className="rd-field" value={editing.ship_status} onChange={(e) => setEditing((value) => ({ ...value, ship_status: e.target.value }))}><option value="pending">Pending</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option></select></div>
          <div><label className="rd-field-label">Tracking number</label><input className="rd-field" value={editing.tracking_number || ''} onChange={(e) => setEditing((value) => ({ ...value, tracking_number: e.target.value }))}/></div>
        </div>
        <div className="rd-row2"><button className="rr-btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="rr-btn primary" disabled={!!busy} onClick={saveLine}>{busy.startsWith('save:') ? 'Saving…' : 'Save recipient'}</button></div>
      </Modal>}
    </div>
  )
}

function RealLogisticsContent({ eventId, notify }) {
  const blank = { name: '', phase: 'pre', collect_size: true, auto_add: true, size_options: '', notes: '', vendor_name: '', vendor_email: '', vendor_phone: '' }
  const [shipments, setShipments] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blank)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [selectedClaim, setSelectedClaim] = useState(null)
  const [activeShipment, setActiveShipment] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!eventId) { setShipments([]); return }
    setError('')
    try { setShipments(await api.listShipments(eventId)) }
    catch (e) { setError(e.message || 'Shipments could not be loaded') }
  }
  useEffect(() => { load() }, [eventId])

  function openEditor(item = null) {
    setEditing(item || 'new')
    setForm(item ? {
      name: item.name || '', phase: item.phase || 'pre', collect_size: !!item.collect_size,
      auto_add: !!item.auto_add, size_options: (item.size_options || []).join(', '), notes: item.notes || '', vendor_name: item.vendor_name || '',
      vendor_email: item.vendor_email || '', vendor_phone: item.vendor_phone || '',
    } : blank)
  }

  async function save() {
    if (!form.name.trim() || busy) return
    setBusy(true)
    try {
      const payload = { ...form, name: form.name.trim(), size_options: form.size_options.split(',').map((value) => value.trim()).filter(Boolean), notes: form.notes || null, vendor_name: form.vendor_name || null, vendor_email: form.vendor_email || null, vendor_phone: form.vendor_phone || null }
      if (editing === 'new') await api.createShipment(eventId, payload)
      else await api.updateShipment(eventId, editing.id, payload)
      setEditing(null)
      await load()
      notify(`Shipment ${editing === 'new' ? 'created' : 'updated'}`)
    } catch (e) { notify(e.message || 'Shipment could not be saved', true) }
    finally { setBusy(false) }
  }

  if (!eventId) return <EmptyState icon="card" title="Select an event" message="Choose an event before configuring deliveries." />
  if (shipments === null) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} variant="table" /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  return <>
    <div className="ad-toolbar">
      <button className="rr-btn primary" onClick={() => openEditor()}><Icon name="plus" size={14} /> New shipment</button>
    </div>
    <div className="rr-panel">
      <div className="rd-panel-head"><h3>Delivery lists</h3><p>{shipments.length} configured shipment{shipments.length === 1 ? '' : 's'}</p></div>
      <div className="rd-panel-body">
        {shipments.length === 0 ? <EmptyState icon="card" title="No shipments yet" message="Create a pre-event or post-event delivery list." /> : (
          <table className="rr-table">
            <thead><tr><th>Name</th><th>Phase</th><th>Guests</th><th>Vendor</th><th>Status</th><th /></tr></thead>
            <tbody>{shipments.map((item) => <tr key={item.id}>
              <td>{item.name}</td><td>{item.phase === 'pre' ? 'Pre-event' : 'Post-event'}</td><td>{item.line_count || 0}</td>
              <td>{item.vendor_name || '—'}</td><td>{item.sent_at ? 'Sent' : 'Draft'}</td>
              <td className="gr-actions">
                <button className="rr-link-btn" onClick={() => setActiveShipment(item)}>Manage</button>
                <button className="rr-link-btn" onClick={() => openEditor(item)}>Edit</button>
                <button className="rr-link-btn" onClick={() => api.downloadShipmentXlsx(eventId, item.id, `${item.name}.xlsx`).catch((e) => notify(e.message || 'Export failed', true))}>Export</button>
                <button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget(item)}>Delete</button>
              </td>
            </tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
    {activeShipment && <ShipmentLinesPanel eventId={eventId} shipment={shipments.find((item) => item.id === activeShipment.id) || activeShipment} notify={notify} onChanged={load} onClose={() => setActiveShipment(null)} />}
    {editing && <Modal title={editing === 'new' ? 'New shipment' : `Edit ${editing.name}`} onClose={() => setEditing(null)} width={520}>
      <div><label className="rd-field-label">Name *</label><input className="rd-field" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} /></div>
      <div className="rd-row2">
        <div style={{ flex: 1 }}><label className="rd-field-label">Phase</label><select className="rd-field" value={form.phase} onChange={(e) => setForm((v) => ({ ...v, phase: e.target.value }))}><option value="pre">Pre-event</option><option value="post">Post-event</option></select></div>
        <div style={{ flex: 1 }}><label className="rd-field-label">Vendor</label><input className="rd-field" value={form.vendor_name} onChange={(e) => setForm((v) => ({ ...v, vendor_name: e.target.value }))} /></div>
      </div>
      <div className="rd-row2">
        <div style={{ flex: 1 }}><label className="rd-field-label">Vendor email</label><input className="rd-field" type="email" value={form.vendor_email} onChange={(e) => setForm((v) => ({ ...v, vendor_email: e.target.value }))} /></div>
        <div style={{ flex: 1 }}><label className="rd-field-label">Vendor phone</label><input className="rd-field" value={form.vendor_phone} onChange={(e) => setForm((v) => ({ ...v, vendor_phone: e.target.value }))} /></div>
      </div>
      <label className="gr-required-check"><input type="checkbox" checked={form.collect_size} onChange={(e) => setForm((v) => ({ ...v, collect_size: e.target.checked }))} /> Collect size at RSVP</label>
      <label className="gr-required-check"><input type="checkbox" checked={form.auto_add} onChange={(e) => setForm((v) => ({ ...v, auto_add: e.target.checked }))} /> Auto-add confirmed guests</label>
      {form.collect_size && <div><label className="rd-field-label">Size options (comma-separated)</label><input className="rd-field" value={form.size_options} onChange={(e) => setForm((value) => ({ ...value, size_options: e.target.value }))} placeholder="S, M, L, XL, 2XL"/></div>}
      <div><label className="rd-field-label">Notes</label><textarea className="rr-textarea" value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} /></div>
      <div className="rd-row2"><button className="rr-btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="rr-btn primary" disabled={busy || !form.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save shipment'}</button></div>
    </Modal>}
    {deleteTarget && <ConfirmDialog title="Delete shipment" message={`Delete “${deleteTarget.name}”?`} confirmLabel="Delete" onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
      try { await api.deleteShipment(eventId, deleteTarget.id); setDeleteTarget(null); await load(); notify('Shipment deleted') }
      catch (e) { notify(e.message || 'Shipment could not be deleted', true) }
    }} />}
  </>
}

function RealRegistryContent({ eventId, notify }) {
  const blank = { kind: 'item', title: '', description: '', image_url: '', external_url: '', amount: '', currency: 'USD', quantity_wanted: 1, payment_instructions: '' }
  const [items, setItems] = useState(null)
  const [claims, setClaims] = useState([])
  const [settings, setSettings] = useState({ registry_message: '', registry_token: null })
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blank)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!eventId) { setItems([]); return }
    setError('')
    try {
      const [nextItems, nextClaims, nextSettings] = await Promise.all([api.listRegistryItems(eventId), api.listRegistryClaims(eventId), api.getRegistrySettings(eventId)])
      setItems(nextItems); setClaims(nextClaims); setSettings(nextSettings)
    } catch (e) { setError(e.message || 'Registry could not be loaded') }
  }
  useEffect(() => { load() }, [eventId])

  function openEditor(item = null, kind = 'item') {
    setEditing(item || 'new')
    setForm(item ? {
      kind: item.kind, title: item.title || '', description: item.description || '', external_url: item.external_url || '',
      image_url: item.image_url || '',
      amount: item.amount_minor == null ? '' : item.amount_minor / 100, currency: item.currency || 'USD',
      quantity_wanted: item.quantity_wanted || 1, payment_instructions: item.payment_instructions || '',
    } : { ...blank, kind })
  }

  async function fetchLinkDetails() {
    if (!form.external_url || busy) return
    setBusy(true)
    try {
      const details = await api.unfurlRegistryLink(eventId, form.external_url)
      setForm((value) => ({
        ...value,
        title: value.title || details.title || '',
        image_url: value.image_url || details.image_url || '',
        amount: value.amount || (details.amount_minor == null ? '' : details.amount_minor / 100),
        currency: details.currency || value.currency,
      }))
      notify(details.title || details.image_url || details.amount_minor != null ? 'Link details fetched' : 'No details found; enter them manually')
    } catch (e) { notify(e.message || 'Link details could not be fetched', true) }
    finally { setBusy(false) }
  }

  async function sendGiftList() {
    if (busy || !settings.registry_token) return
    if (!window.confirm('Send the gift list link to confirmed guests by email, SMS, and WhatsApp?')) return
    setBusy(true)
    try {
      await api.updateRegistrySettings(eventId, { registry_message: settings.registry_message || null })
      const result = await api.sendRegistryMessage(eventId, ['email', 'sms', 'whatsapp'])
      notify(`Gift list queued for ${result.queued || 0} guest${result.queued === 1 ? '' : 's'}`)
    } catch (e) { notify(e.message || 'Gift list could not be sent', true) }
    finally { setBusy(false) }
  }

  async function save() {
    if (!form.title.trim() || busy) return
    setBusy(true)
    try {
      const payload = {
        kind: form.kind, title: form.title.trim(), description: form.description || null,
        image_url: form.image_url || null,
        external_url: form.external_url || null, amount_minor: form.amount === '' ? null : Math.round(Number(form.amount) * 100),
        currency: form.currency, quantity_wanted: Number(form.quantity_wanted) || 1,
        payment_instructions: form.payment_instructions || null,
      }
      if (editing === 'new') await api.createRegistryItem(eventId, payload)
      else await api.updateRegistryItem(eventId, editing.id, payload)
      setEditing(null); await load(); notify(`Registry item ${editing === 'new' ? 'created' : 'updated'}`)
    } catch (e) { notify(e.message || 'Registry item could not be saved', true) }
    finally { setBusy(false) }
  }

  if (!eventId) return <EmptyState icon="gift" title="Select an event" message="Choose an event before configuring its gift list." />
  if (items === null) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  return <>
    <div className="ad-toolbar">
      <button className="rr-btn secondary" onClick={() => openEditor(null, 'item')}><Icon name="plus" size={14} /> Add item</button>
      <button className="rr-btn secondary" onClick={() => openEditor(null, 'fund')}><Icon name="card" size={14} /> Add cash fund</button>
      <button className="rr-btn secondary" onClick={() => openEditor(null, 'link')}><Icon name="external" size={14} /> Add link</button>
      {settings.registry_token && <a className="rr-btn secondary" href={`/registry/${settings.registry_token}`} target="_blank" rel="noreferrer">Preview registry →</a>}
      {settings.registry_token && <button className="rr-btn primary" disabled={busy} onClick={sendGiftList}>{busy ? 'Working…' : 'Send to guests'}</button>}
    </div>
    <div className="rr-panel" style={{ marginBottom: 14 }}><div className="rd-panel-body">
      <label className="rd-field-label">Intro message</label>
      <textarea className="rr-textarea" value={settings.registry_message || ''} onChange={(e) => setSettings((v) => ({ ...v, registry_message: e.target.value }))} />
      <button className="rr-btn primary" onClick={async () => {
        try { await api.updateRegistrySettings(eventId, { registry_message: settings.registry_message || null }); notify('Registry message saved') }
        catch (e) { notify(e.message || 'Registry message could not be saved', true) }
      }}>Save message</button>
    </div></div>
    <div className="rd-wide-grid">
      <div className="rr-panel"><div className="rd-panel-head"><h3>Gift list</h3><p>{items.length} item{items.length === 1 ? '' : 's'}</p></div><div className="rd-panel-body">
        {items.length === 0 ? <EmptyState icon="gift" title="No gifts yet" message="Add an item, cash fund, or external link." /> : items.map((item) => (
          <div className="ad-registry-item" key={item.id}>
            <div className="ad-registry-item-top"><span>{item.image_url && <img src={item.image_url} alt="" className="ad-registry-thumb" />}<span className={`ad-kind-badge ${item.kind}`}>{item.kind}</span> {item.title}</span><span>{item.claim_count || 0} claims</span></div>
            <div className="ad-registry-progress">{item.kind === 'fund' ? `${item.currency} ${(item.raised_minor / 100).toLocaleString()} raised` : `${item.reserved_qty || 0} of ${item.quantity_wanted} claimed`}</div>
            <div className="gr-actions"><button className="rr-link-btn" onClick={() => openEditor(item)}>Edit</button><button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget(item)}>Delete</button></div>
          </div>
        ))}
      </div></div>
      <div className="rr-panel"><div className="rd-panel-head"><h3>Gift activity ledger</h3><p>{claims.length} recorded action{claims.length === 1 ? '' : 's'}</p></div><div className="rd-panel-body">
        {claims.length === 0 ? <EmptyState icon="check" title="No activity yet" message="Reservations, purchases, contributions, pledges, and external-registry gifts appear here." /> : <div className="ad-claim-ledger"><table className="rr-table"><thead><tr><th>Guest</th><th>Action</th><th>Gift / amount</th><th>Thank-you</th><th/></tr></thead><tbody>{claims.map((claim) => <tr key={claim.id}>
          <td><strong>{claim.claimer_name}</strong><small>{claim.claimer_email || claim.claimer_phone || 'No contact'}</small></td>
          <td><span className="rd-status-chip ok">{String(claim.action || 'reserved').replaceAll('_', ' ')}</span></td>
          <td>{claim.item_title || '—'}{claim.amount_minor ? <small>{claim.currency} {(claim.amount_minor / 100).toLocaleString()}</small> : claim.quantity > 1 ? <small>Quantity {claim.quantity}</small> : null}</td>
          <td><span className={`rd-status-chip ${claim.thank_you_status === 'queued' ? 'ok' : 'bl-chip-neutral'}`}>{String(claim.thank_you_status || 'not requested').replaceAll('_', ' ')}</span></td>
          <td><button className="rr-link-btn" onClick={() => setSelectedClaim(claim)}>Details</button></td>
        </tr>)}</tbody></table></div>}
      </div></div>
    </div>
    {editing && <Modal title={editing === 'new' ? 'Add registry item' : `Edit ${editing.title}`} onClose={() => setEditing(null)} width={500}>
      <label className="rd-field-label">Type</label><select className="rd-field" value={form.kind} onChange={(e) => setForm((v) => ({ ...v, kind: e.target.value }))}><option value="item">Physical item</option><option value="fund">Cash fund</option><option value="link">External link</option></select>
      <label className="rd-field-label">Title *</label><input className="rd-field" value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} />
      <label className="rd-field-label">Description</label><textarea className="rr-textarea" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} />
      {form.kind !== 'fund' && <><label className="rd-field-label">{form.kind === 'link' ? 'External registry URL' : 'Purchase URL'}</label><div className="rd-row2"><input className="rd-field" type="url" value={form.external_url} onChange={(e) => setForm((v) => ({ ...v, external_url: e.target.value }))} /><button type="button" className="rr-btn secondary" disabled={busy || !form.external_url} onClick={fetchLinkDetails}>Fetch details</button></div></>}
      {form.kind === 'fund' && <><div className="rd-row2"><div style={{ flex: 1 }}><label className="rd-field-label">Target amount</label><input className="rd-field" type="number" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} /></div><div style={{ flex: 1 }}><label className="rd-field-label">Currency</label><input className="rd-field" value={form.currency} onChange={(e) => setForm((v) => ({ ...v, currency: e.target.value.toUpperCase() }))} /></div></div><label className="rd-field-label">Payment instructions or payment link</label><textarea className="rr-textarea" rows={3} value={form.payment_instructions} onChange={(e) => setForm((v) => ({ ...v, payment_instructions: e.target.value }))} placeholder="Bank details, payment link, or instructions shown to guests"/></>}
      {form.kind === 'item' && <><div className="rd-row2"><div style={{ flex: 1 }}><label className="rd-field-label">Quantity wanted</label><input className="rd-field" type="number" min="1" value={form.quantity_wanted} onChange={(e) => setForm((v) => ({ ...v, quantity_wanted: e.target.value }))} /></div><div style={{ flex: 1 }}><label className="rd-field-label">Estimated price</label><input className="rd-field" type="number" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} /></div></div></>}
      <label className="rd-field-label">Image URL</label><input className="rd-field" type="url" value={form.image_url} onChange={(e) => setForm((v) => ({ ...v, image_url: e.target.value }))} />
      <div className="rd-row2"><button className="rr-btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="rr-btn primary" disabled={busy || !form.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save item'}</button></div>
    </Modal>}
    {selectedClaim && <Modal title="Gift activity details" onClose={() => setSelectedClaim(null)} width={520}>
      <div className="ad-claim-details">
        <div><span>Guest</span><strong>{selectedClaim.claimer_name}</strong></div>
        <div><span>Relationship</span><strong>{selectedClaim.relationship || 'Not provided'}</strong></div>
        <div><span>Email</span><strong>{selectedClaim.claimer_email || 'Not provided'}</strong></div>
        <div><span>Phone</span><strong>{selectedClaim.claimer_phone || 'Not provided'}</strong></div>
        <div><span>Action</span><strong>{String(selectedClaim.action || 'reserved').replaceAll('_', ' ')}</strong></div>
        <div><span>Gift</span><strong>{selectedClaim.item_title}</strong></div>
        <div><span>Quantity / amount</span><strong>{selectedClaim.amount_minor ? `${selectedClaim.currency} ${(selectedClaim.amount_minor / 100).toLocaleString()}` : selectedClaim.quantity || 1}</strong></div>
        <div><span>Reference</span><strong>{selectedClaim.reference || 'Not provided'}</strong></div>
        <div><span>Thank-you</span><strong>{selectedClaim.thank_you_channel ? `${selectedClaim.thank_you_channel.toUpperCase()} · ${String(selectedClaim.thank_you_status).replaceAll('_', ' ')}` : 'Not requested'}</strong></div>
        <div className="wide"><span>Guest note</span><strong>{selectedClaim.message || 'No note'}</strong></div>
        <div className="wide"><span>Recorded</span><strong>{selectedClaim.created_at ? new Date(selectedClaim.created_at).toLocaleString() : '—'}</strong></div>
      </div>
    </Modal>}
    {deleteTarget && <ConfirmDialog title="Delete registry item" message={`Delete “${deleteTarget.title}”?`} confirmLabel="Delete" onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
      try { await api.deleteRegistryItem(eventId, deleteTarget.id); setDeleteTarget(null); await load(); notify('Registry item deleted') }
      catch (e) { notify(e.message || 'Registry item could not be deleted', true) }
    }} />}
  </>
}

const SOCIAL_PLATFORMS = ['LinkedIn', 'Twitter/X', 'Instagram', 'Website']

function RealSpeakersContent({ eventId, notify }) {
  const blank = { name: '', title: '', bio: '', photo_url: '', social_links: [] }
  const [speakers, setSpeakers] = useState(null)
  const [settings, setSettings] = useState({ speaker_token: null, speaker_show_before_rsvp: false })
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blank)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [visibilityBusy, setVisibilityBusy] = useState(false)
  const photoFileRef = useRef(null)

  async function toggleShowBeforeRsvp() {
    if (visibilityBusy) return
    const next = !settings.speaker_show_before_rsvp
    setVisibilityBusy(true)
    try {
      await api.toggleFeatures(eventId, { speaker_show_before_rsvp: next })
      setSettings((v) => ({ ...v, speaker_show_before_rsvp: next }))
      notify(next ? 'Speakers now visible before RSVP' : 'Speakers now hidden until RSVP is confirmed')
    } catch (e) { notify(e.message || 'Setting could not be saved', true) }
    finally { setVisibilityBusy(false) }
  }

  async function uploadPhoto(file) {
    if (!file || !eventId) return
    setPhotoBusy(true)
    try {
      const result = await api.uploadSpeakerPhoto(eventId, file)
      setForm((v) => ({ ...v, photo_url: result.url }))
    } catch (e) { notify(e.message || 'Photo could not be uploaded', true) }
    finally { setPhotoBusy(false) }
  }

  async function load() {
    if (!eventId) { setSpeakers([]); return }
    setError('')
    try {
      const [nextSpeakers, nextSettings] = await Promise.all([api.listSpeakers(eventId), api.getSpeakerSettings(eventId)])
      setSpeakers(nextSpeakers); setSettings(nextSettings)
    } catch (e) { setError(e.message || 'Speakers could not be loaded') }
  }
  useEffect(() => { load() }, [eventId])

  function openEditor(item = null) {
    setEditing(item || 'new')
    setForm(item ? {
      name: item.name || '', title: item.title || '', bio: item.bio || '',
      photo_url: item.photo_url || '', social_links: item.social_links || [],
    } : blank)
  }

  function addLink() {
    setForm((v) => ({ ...v, social_links: [...v.social_links, { platform: 'LinkedIn', url: '' }] }))
  }
  function updateLink(i, field, value) {
    setForm((v) => ({ ...v, social_links: v.social_links.map((l, idx) => idx === i ? { ...l, [field]: value } : l) }))
  }
  function removeLink(i) {
    setForm((v) => ({ ...v, social_links: v.social_links.filter((_, idx) => idx !== i) }))
  }

  async function save() {
    if (!form.name.trim() || busy) return
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(), title: form.title || null, bio: form.bio || null,
        photo_url: form.photo_url || null,
        social_links: form.social_links.filter((l) => l.url.trim()),
      }
      if (editing === 'new') await api.createSpeaker(eventId, payload)
      else await api.updateSpeaker(eventId, editing.id, payload)
      setEditing(null); await load(); notify(`Speaker ${editing === 'new' ? 'added' : 'updated'}`)
    } catch (e) { notify(e.message || 'Speaker could not be saved', true) }
    finally { setBusy(false) }
  }

  if (!eventId) return <EmptyState icon="users" title="Select an event" message="Choose an event before adding speakers." />
  if (speakers === null) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  return <>
    <div className="ad-toolbar">
      <button className="rr-btn primary" onClick={() => openEditor()}><Icon name="plus" size={14} /> Add speaker</button>
      {settings.speaker_token && <a className="rr-btn secondary" href={`/speakers/${settings.speaker_token}`} target="_blank" rel="noreferrer">Preview page →</a>}
    </div>
    <div className="rr-panel"><div className="rd-panel-head"><h3>Speaker visibility</h3></div><div className="rd-panel-body">
      <div className="rd-toggle-row">
        <span>Show speakers on the invite page before a guest confirms RSVP</span>
        <label className="rd-switch">
          <input type="checkbox" checked={settings.speaker_show_before_rsvp} disabled={visibilityBusy} onChange={toggleShowBeforeRsvp} />
          <span className="track" /><span className="knob" />
        </label>
      </div>
      <p className="rd-hint">
        {settings.speaker_show_before_rsvp
          ? 'Speakers are visible to anyone who opens the invite link, even before they RSVP — same as the ticketing site.'
          : 'Default: speakers stay hidden until a guest confirms their RSVP, then appear in their FestioHub.'}
      </p>
    </div></div>
    <div className="rr-panel"><div className="rd-panel-head"><h3>Guest Speaker Showcase</h3><p>{speakers.length} speaker{speakers.length === 1 ? '' : 's'}</p></div><div className="rd-panel-body">
      {speakers.length === 0 ? <EmptyState icon="users" title="No guest speakers found" message="Add your first guest speaker to get started." /> : speakers.map((s) => (
        <div className="ad-registry-item" key={s.id}>
          <div className="ad-registry-item-top"><span>{s.photo_url && <img src={s.photo_url} alt="" className="ad-registry-thumb" />} {s.name}{s.title && <small> · {s.title}</small>}</span></div>
          <div className="gr-actions"><button className="rr-link-btn" onClick={() => openEditor(s)}>Edit</button><button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget(s)}>Delete</button></div>
        </div>
      ))}
    </div></div>
    {editing && <Modal title={editing === 'new' ? 'Add guest speaker' : `Edit ${editing.name}`} onClose={() => setEditing(null)} width={500}>
      <label className="rd-field-label">Name *</label><input className="rd-field" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
      <label className="rd-field-label">Title / role</label><input className="rd-field" value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} placeholder="CEO, Acme" />
      <label className="rd-field-label">Bio</label><textarea className="rr-textarea" value={form.bio} onChange={(e) => setForm((v) => ({ ...v, bio: e.target.value }))} />
      <label className="rd-field-label">Photo</label>
      {form.photo_url && <img src={form.photo_url} alt="" className="ad-registry-thumb" style={{ width: 56, height: 56, marginBottom: 6 }} />}
      <input ref={photoFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
      <div className="rd-row2">
        <button type="button" className="rr-btn secondary" disabled={photoBusy} onClick={() => photoFileRef.current?.click()}>{photoBusy ? 'Uploading…' : form.photo_url ? 'Replace photo' : 'Upload photo'}</button>
        <input className="rd-field" type="url" placeholder="or paste an image URL" value={form.photo_url} onChange={(e) => setForm((v) => ({ ...v, photo_url: e.target.value }))} />
      </div>
      <label className="rd-field-label">Social links</label>
      {form.social_links.map((l, i) => (
        <div className="rd-row2" key={i}>
          <select className="rd-field" style={{ flex: 'none', width: 120 }} value={l.platform} onChange={(e) => updateLink(i, 'platform', e.target.value)}>
            {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input className="rd-field" type="url" placeholder="https://…" value={l.url} onChange={(e) => updateLink(i, 'url', e.target.value)} />
          <button type="button" className="rr-link-btn gr-danger-link" onClick={() => removeLink(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="rr-btn secondary" onClick={addLink}><Icon name="plus" size={12} /> Add link</button>
      <div className="rd-row2" style={{ marginTop: 14 }}><button className="rr-btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="rr-btn primary" disabled={busy || !form.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save speaker'}</button></div>
    </Modal>}
    {deleteTarget && <ConfirmDialog title="Delete speaker" message={`Delete “${deleteTarget.name}”?`} confirmLabel="Delete" onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
      try { await api.deleteSpeaker(eventId, deleteTarget.id); setDeleteTarget(null); await load(); notify('Speaker deleted') }
      catch (e) { notify(e.message || 'Speaker could not be deleted', true) }
    }} />}
  </>
}

function RealPartnersContent({ eventId, notify }) {
  const blank = { name: '', category_id: '', logo_url: '', description: '', website_url: '' }
  const [partners, setPartners] = useState(null)
  const [categories, setCategories] = useState([])
  const [settings, setSettings] = useState({ partner_token: null })
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blank)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const logoFileRef = useRef(null)

  async function uploadLogo(file) {
    if (!file || !eventId) return
    setLogoBusy(true)
    try {
      const result = await api.uploadPartnerLogo(eventId, file)
      setForm((v) => ({ ...v, logo_url: result.url }))
    } catch (e) { notify(e.message || 'Logo could not be uploaded', true) }
    finally { setLogoBusy(false) }
  }

  async function load() {
    if (!eventId) { setPartners([]); return }
    setError('')
    try {
      const [nextPartners, nextCategories, nextSettings] = await Promise.all([
        api.listPartners(eventId), api.listPartnerCategories(eventId), api.getPartnerSettings(eventId),
      ])
      setPartners(nextPartners); setCategories(nextCategories); setSettings(nextSettings)
    } catch (e) { setError(e.message || 'Partners could not be loaded') }
  }
  useEffect(() => { load() }, [eventId])

  function openEditor(item = null) {
    setEditing(item || 'new')
    setForm(item ? {
      name: item.name || '', category_id: item.category_id || '', logo_url: item.logo_url || '',
      description: item.description || '', website_url: item.website_url || '',
    } : blank)
  }

  async function save() {
    if (!form.name.trim() || busy) return
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(), category_id: form.category_id || null, logo_url: form.logo_url || null,
        description: form.description || null, website_url: form.website_url || null,
      }
      if (editing === 'new') await api.createPartner(eventId, payload)
      else await api.updatePartner(eventId, editing.id, payload)
      setEditing(null); await load(); notify(`Partner ${editing === 'new' ? 'added' : 'updated'}`)
    } catch (e) { notify(e.message || 'Partner could not be saved', true) }
    finally { setBusy(false) }
  }

  async function addCategory() {
    if (!newCategory.trim() || busy) return
    setBusy(true)
    try {
      await api.createPartnerCategory(eventId, { name: newCategory.trim(), sort_order: categories.length })
      setNewCategory(''); await load()
    } catch (e) { notify(e.message || 'Category could not be added', true) }
    finally { setBusy(false) }
  }

  async function removeCategory(category) {
    if (!window.confirm(`Delete category "${category.name}"? Partners in it become uncategorized.`)) return
    setBusy(true)
    try { await api.deletePartnerCategory(eventId, category.id); await load() }
    catch (e) { notify(e.message || 'Category could not be deleted', true) }
    finally { setBusy(false) }
  }

  if (!eventId) return <EmptyState icon="users" title="Select an event" message="Choose an event before adding partners." />
  if (partners === null) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  return <>
    <div className="ad-toolbar">
      <button className="rr-btn secondary" onClick={() => setCategoriesOpen(true)}>Create categories</button>
      <button className="rr-btn primary" onClick={() => openEditor()}><Icon name="plus" size={14} /> Add partner</button>
      {settings.partner_token && <a className="rr-btn secondary" href={`/partners/${settings.partner_token}`} target="_blank" rel="noreferrer">Preview page →</a>}
    </div>
    <div className="rr-panel"><div className="rd-panel-head"><h3>Partner Showcase</h3><p>{partners.length} partner{partners.length === 1 ? '' : 's'}</p></div><div className="rd-panel-body">
      {partners.length === 0 ? <EmptyState icon="users" title="No partners found" message="Add your first partner to get started." /> : partners.map((p) => (
        <div className="ad-registry-item" key={p.id}>
          <div className="ad-registry-item-top"><span>{p.logo_url && <img src={p.logo_url} alt="" className="ad-registry-thumb" />} {p.name}{p.category_name && <small> · {p.category_name}</small>}</span></div>
          <div className="gr-actions"><button className="rr-link-btn" onClick={() => openEditor(p)}>Edit</button><button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget(p)}>Delete</button></div>
        </div>
      ))}
    </div></div>
    {editing && <Modal title={editing === 'new' ? 'Add partner' : `Edit ${editing.name}`} onClose={() => setEditing(null)} width={500}>
      <label className="rd-field-label">Name *</label><input className="rd-field" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
      <label className="rd-field-label">Category</label>
      <select className="rd-field" value={form.category_id} onChange={(e) => setForm((v) => ({ ...v, category_id: e.target.value }))}>
        <option value="">Uncategorized</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="rd-field-label">Description</label><textarea className="rr-textarea" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} />
      <label className="rd-field-label">Logo</label>
      {form.logo_url && <img src={form.logo_url} alt="" className="ad-registry-thumb" style={{ width: 56, height: 56, marginBottom: 6 }} />}
      <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
      <div className="rd-row2">
        <button type="button" className="rr-btn secondary" disabled={logoBusy} onClick={() => logoFileRef.current?.click()}>{logoBusy ? 'Uploading…' : form.logo_url ? 'Replace logo' : 'Upload logo'}</button>
        <input className="rd-field" type="url" placeholder="or paste an image URL" value={form.logo_url} onChange={(e) => setForm((v) => ({ ...v, logo_url: e.target.value }))} />
      </div>
      <label className="rd-field-label">Website URL</label><input className="rd-field" type="url" value={form.website_url} onChange={(e) => setForm((v) => ({ ...v, website_url: e.target.value }))} />
      <div className="rd-row2" style={{ marginTop: 14 }}><button className="rr-btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="rr-btn primary" disabled={busy || !form.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save partner'}</button></div>
    </Modal>}
    {categoriesOpen && <Modal title="Partner categories" onClose={() => setCategoriesOpen(false)} width={420}>
      {categories.length === 0 && <p className="rd-hint">No categories yet — partners without one show as uncategorized.</p>}
      {categories.map((c) => (
        <div className="rd-row2" key={c.id} style={{ alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{c.name}</span>
          <button className="rr-link-btn gr-danger-link" disabled={busy} onClick={() => removeCategory(c)}>Delete</button>
        </div>
      ))}
      <div className="rd-row2" style={{ marginTop: 10 }}>
        <input className="rd-field" placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
        <button className="rr-btn secondary" disabled={busy || !newCategory.trim()} onClick={addCategory}>Add</button>
      </div>
      <div className="rd-row2" style={{ marginTop: 14 }}><button className="rr-btn primary" onClick={() => setCategoriesOpen(false)}>Done</button></div>
    </Modal>}
    {deleteTarget && <ConfirmDialog title="Delete partner" message={`Delete “${deleteTarget.name}”?`} confirmLabel="Delete" onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
      try { await api.deletePartner(eventId, deleteTarget.id); setDeleteTarget(null); await load(); notify('Partner deleted') }
      catch (e) { notify(e.message || 'Partner could not be deleted', true) }
    }} />}
  </>
}

const REMINDER_PRESETS = [
  { label: '7 days before', offset_days: 7, send_time_local: '09:00' },
  { label: '1 day before', offset_days: 1, send_time_local: '18:00' },
  { label: 'Morning of', offset_days: 0, send_time_local: '08:00' },
]
const REMINDER_AUDIENCE_PRESETS = [
  { id: 'non-responders', label: 'Non-responders', hint: "haven't RSVP'd", statuses: ['invited', 'pending'] },
  { id: 'confirmed', label: 'Confirmed only', hint: 'guests attending', statuses: ['confirmed'] },
  { id: 'everyone', label: 'Everyone', hint: 'no filter', statuses: null },
]
const REMINDER_CHANNELS = [
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'sms', label: 'SMS', icon: 'message' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
]
// guest_hub_link/ticket_link aren't in templates.py's shared PLACEHOLDERS
// list (they're populated by services/reminder_send.py's own extras, not
// build_context()'s defaults) -- listed here for the editor's chip palette.
const REMINDER_PLACEHOLDERS = [
  'guest_first_name', 'guest_full_name', 'event_name', 'event_date', 'venue_name',
  'rsvp_link', 'guest_hub_link', 'ticket_link',
]

// Calendar-only math -- no UTC-instant conversion needed for display, just
// "what local calendar date is N days before the event's local date". Pull
// the event's own local Y/M/D via Intl (timeZone-aware, matches the
// backend's to_event_local() since event.event_date is naive-UTC), then do
// day arithmetic via UTC-epoch anchors so day boundaries can't drift across
// a DST change. The actual UTC fire_at_utc instant that schedules the send
// is computed server-side by services/reminders.py::compute_fire_at -- all
// of this is a preview/editing convenience, not a second source of truth.
function eventLocalYmd(event) {
  if (!event?.event_date) return null
  try {
    // event_date is serialized naive (no trailing Z/offset) -- the backend
    // convention is that every stored timestamp is UTC (see timeutil.py's
    // module docstring), so force UTC parsing here rather than letting the
    // browser interpret the bare string as its own local time.
    const iso = /[zZ]|[+-]\d\d:\d\d$/.test(event.event_date) ? event.event_date : `${event.event_date}Z`
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: event.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso))
    return {
      y: Number(parts.find((p) => p.type === 'year')?.value),
      m: Number(parts.find((p) => p.type === 'month')?.value),
      d: Number(parts.find((p) => p.type === 'day')?.value),
    }
  } catch {
    return null
  }
}

// UTC-anchored Date standing in for a calendar day (not a real instant) --
// offsetDays before the event's own local calendar date.
function fireDateAnchor(event, offsetDays) {
  const ymd = eventLocalYmd(event)
  const days = Number(offsetDays)
  if (!ymd || !Number.isFinite(days)) return null
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d) - days * 86400000)
}

// "YYYY-MM-DD" for <input type="date">'s value.
function fireDateInputValue(event, offsetDays) {
  const anchor = fireDateAnchor(event, offsetDays)
  return anchor ? anchor.toISOString().slice(0, 10) : ''
}

// Inverse: given a date picked in <input type="date">, how many days before
// the event's own local date is that?
function offsetDaysFromPickedDate(event, pickedYmd) {
  const ymd = eventLocalYmd(event)
  if (!ymd || !pickedYmd) return null
  const eventAnchor = Date.UTC(ymd.y, ymd.m - 1, ymd.d)
  const [py, pm, pd] = pickedYmd.split('-').map(Number)
  const pickedAnchor = Date.UTC(py, pm - 1, pd)
  return Math.round((eventAnchor - pickedAnchor) / 86400000)
}

function computeFiresLabel(event, offsetDays, sendTimeLocal) {
  const anchor = fireDateAnchor(event, offsetDays)
  if (!anchor) return ''
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(anchor)
  const [hh, mm] = (sendTimeLocal || '09:00').split(':')
  const hour12 = ((Number(hh) + 11) % 12) + 1
  const ampm = Number(hh) >= 12 ? 'PM' : 'AM'
  return `Fires ${dateLabel} at ${hour12}:${mm} ${ampm} (${event?.timezone || 'UTC'})`
}

function audiencePresetId(statuses) {
  const match = REMINDER_AUDIENCE_PRESETS.find((p) =>
    p.statuses === null ? !statuses || statuses.length === 0
      : statuses && p.statuses.length === statuses.length && p.statuses.every((s) => statuses.includes(s))
  )
  return match ? match.id : 'non-responders'
}

// Renders a preview the way the guest will actually see it, not a plain
// text box -- an email-shell card for email, a chat bubble for SMS/WhatsApp.
function ReminderPreviewFrame({ channel, preview }) {
  if (channel === 'email') {
    return (
      <div style={{ marginTop: 10, borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', padding: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--faint)', borderBottom: '1px dashed var(--line)', paddingBottom: 8, marginBottom: 10 }}>
          <div>To: guest@example.com</div>
          <div>From: {'{{organizer_name}}'}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{preview.subject || '(no subject)'}</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6 }}>{preview.body}</div>
      </div>
    )
  }
  const isWhatsapp = channel === 'whatsapp'
  return (
    <div style={{ marginTop: 10, borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--line)', padding: 14 }}>
      <div style={{
        display: 'inline-block', maxWidth: '92%', borderRadius: '14px 14px 14px 3px', padding: '10px 12px',
        fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        background: isWhatsapp ? 'var(--success-soft)' : 'var(--teal)',
        color: isWhatsapp ? 'var(--ink)' : 'var(--teal-ink)',
        border: isWhatsapp ? '1px solid var(--success)' : 'none',
      }}>{preview.body}</div>
    </div>
  )
}

function RealRemindersContent({ eventId, event, notify }) {
  const blank = {
    label: '7 days before', offset_days: 7, send_time_local: '09:00',
    channels: ['email', 'sms'], audience: 'non-responders',
    subject: 'Reminder: {{event_name}}', email_body: '', sms_body: '', whatsapp_body: '',
  }
  const [reminders, setReminders] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blank)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testChannel, setTestChannel] = useState('email')
  const [testBusy, setTestBusy] = useState(false)

  async function load() {
    if (!eventId) { setReminders([]); return }
    setError('')
    try { setReminders(await api.listReminders(eventId)) }
    catch (e) { setError(e.message || 'Reminders could not be loaded') }
  }
  useEffect(() => { load() }, [eventId])

  function openEditor(item = null) {
    setPreview(null)
    setEditing(item || 'new')
    setForm(item ? {
      label: item.label, offset_days: item.offset_days, send_time_local: item.send_time_local,
      channels: item.channels || [], audience: audiencePresetId(item.audience_rsvp_statuses),
      subject: item.subject || '', email_body: item.email_body || '',
      sms_body: item.sms_body || '', whatsapp_body: item.whatsapp_body || '',
    } : blank)
  }

  function applyPreset(preset) {
    setForm((v) => ({ ...v, label: preset.label, offset_days: preset.offset_days, send_time_local: preset.send_time_local }))
  }

  function toggleChannel(id) {
    setForm((v) => ({ ...v, channels: v.channels.includes(id) ? v.channels.filter((c) => c !== id) : [...v.channels, id] }))
  }

  async function save() {
    if (!form.label.trim() || form.channels.length === 0 || busy) return
    setBusy(true)
    try {
      const audiencePreset = REMINDER_AUDIENCE_PRESETS.find((p) => p.id === form.audience)
      const payload = {
        label: form.label.trim(), offset_days: Number(form.offset_days) || 0,
        send_time_local: form.send_time_local, channels: form.channels,
        audience_rsvp_statuses: audiencePreset?.statuses ?? null,
        subject: form.subject || null, email_body: form.email_body || null,
        sms_body: form.sms_body || null, whatsapp_body: form.whatsapp_body || null,
      }
      if (editing === 'new') await api.createReminder(eventId, payload)
      else await api.updateReminder(eventId, editing.id, payload)
      setEditing(null); await load(); notify(`Reminder ${editing === 'new' ? 'scheduled' : 'updated'}`)
    } catch (e) { notify(e.message || 'Reminder could not be saved', true) }
    finally { setBusy(false) }
  }

  async function runPreview() {
    if (editing === 'new') return
    setPreviewBusy(true)
    try {
      const body = testChannel === 'email' ? form.email_body : testChannel === 'sms' ? form.sms_body : form.whatsapp_body
      const result = await api.previewReminder(eventId, editing.id, {
        channel: testChannel, subject: testChannel === 'email' ? form.subject : null, body,
      })
      setPreview(result)
    } catch (e) { notify(e.message || 'Preview failed', true) }
    finally { setPreviewBusy(false) }
  }

  async function sendTest() {
    if (editing === 'new' || !testTo.trim() || testBusy) return
    setTestBusy(true)
    try {
      const body = testChannel === 'email' ? form.email_body : testChannel === 'sms' ? form.sms_body : form.whatsapp_body
      await api.testSendReminder(eventId, editing.id, {
        channel: testChannel, to: testTo.trim(), subject: testChannel === 'email' ? form.subject : null, body,
      })
      notify(`Test ${testChannel} sent`)
    } catch (e) { notify(e.message || 'Test send failed', true) }
    finally { setTestBusy(false) }
  }

  if (!eventId) return <EmptyState icon="clock" title="Select an event" message="Choose an event before scheduling reminders." />
  if (reminders === null) return <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} /></div></div>
  if (error) return <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
  return <>
    <div className="ad-toolbar">
      <button className="rr-btn primary" onClick={() => openEditor()}><Icon name="plus" size={14} /> New reminder</button>
    </div>
    <div className="rr-panel"><div className="rd-panel-head"><h3>Reminder series</h3><p>{reminders.length} reminder{reminders.length === 1 ? '' : 's'}</p></div><div className="rd-panel-body">
      {reminders.length === 0 ? <EmptyState icon="clock" title="No reminders scheduled" message="Add a reminder to start nudging guests before your event." /> : reminders.map((r) => (
        <div className="ad-registry-item" key={r.id}>
          <div className="ad-registry-item-top">
            <span>
              <Icon name="clock" size={14} /> {r.label}
              {' · '}{new Date(r.fire_at_utc).toLocaleString()}
              {' · '}{(r.channels || []).map((c) => REMINDER_CHANNELS.find((rc) => rc.id === c)?.label || c).join(', ')}
              {' · '}{REMINDER_AUDIENCE_PRESETS.find((p) => p.id === audiencePresetId(r.audience_rsvp_statuses))?.label}
              {r.status === 'sent' && <small> · Sent to {r.guests_sent}/{r.guests_targeted}</small>}
              {r.status === 'failed' && <small style={{ color: 'var(--danger)' }}> · Failed: {r.last_error}</small>}
            </span>
          </div>
          <div className="gr-actions">
            {r.fired_at ? (
              <button className="rr-link-btn" onClick={() => openEditor({ ...r, id: 'new' })}>Duplicate</button>
            ) : (
              <>
                <button className="rr-link-btn" onClick={() => openEditor(r)}>Edit</button>
                <button className="rr-link-btn gr-danger-link" onClick={() => setDeleteTarget(r)}>Delete</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div></div>
    {editing && <Modal title={editing === 'new' ? 'New reminder' : `Edit ${editing.label}`} onClose={() => setEditing(null)} width={620}>
      <label className="rd-field-label">Quick start</label>
      <div className="rd-row2" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {REMINDER_PRESETS.map((p) => (
          <button key={p.label} type="button" className="rr-btn secondary" onClick={() => applyPreset(p)}>{p.label}</button>
        ))}
      </div>
      <label className="rd-field-label">Label *</label>
      <input className="rd-field" value={form.label} onChange={(e) => setForm((v) => ({ ...v, label: e.target.value }))} />
      <label className="rd-field-label">Send</label>
      <div className="rd-row2">
        <div style={{ flex: 1 }}>
          <label className="rd-field-label" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>Date</label>
          <input className="rd-field" type="date" value={fireDateInputValue(event, form.offset_days)}
            onChange={(e) => {
              const days = offsetDaysFromPickedDate(event, e.target.value)
              if (days !== null) setForm((v) => ({ ...v, offset_days: Math.min(90, Math.max(0, days)) }))
            }} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="rd-field-label" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>Days before event</label>
          <input className="rd-field" type="number" min={0} max={90} value={form.offset_days}
            onChange={(e) => setForm((v) => ({ ...v, offset_days: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="rd-field-label" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>Time (local)</label>
          <input className="rd-field" type="time" value={form.send_time_local}
            onChange={(e) => setForm((v) => ({ ...v, send_time_local: e.target.value }))} />
        </div>
      </div>
      <p className="rd-hint">Pick a date or a day-offset — they stay in sync. 0 = day-of. Can't be after the event. {computeFiresLabel(event, form.offset_days, form.send_time_local)}</p>

      <label className="rd-field-label" style={{ marginTop: 12 }}>Channels</label>
      <div className="rd-row2" style={{ flexWrap: 'wrap' }}>
        {REMINDER_CHANNELS.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
            <input type="checkbox" checked={form.channels.includes(c.id)} onChange={() => toggleChannel(c.id)} />
            <Icon name={c.icon} size={13} /> {c.label}
          </label>
        ))}
      </div>

      <label className="rd-field-label" style={{ marginTop: 12 }}>Audience</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {REMINDER_AUDIENCE_PRESETS.map((p) => (
          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
            <input type="radio" name="reminder-audience" checked={form.audience === p.id} onChange={() => setForm((v) => ({ ...v, audience: p.id }))} />
            {p.label} <small style={{ fontWeight: 400, color: 'var(--muted)' }}>— {p.hint}</small>
          </label>
        ))}
      </div>

      {form.channels.includes('email') && <>
        <label className="rd-field-label" style={{ marginTop: 12 }}>Email subject</label>
        <input className="rd-field" value={form.subject} onChange={(e) => setForm((v) => ({ ...v, subject: e.target.value }))} />
        <label className="rd-field-label">Email body</label>
        <textarea className="rr-textarea" value={form.email_body} onChange={(e) => setForm((v) => ({ ...v, email_body: e.target.value }))} />
      </>}
      {form.channels.includes('sms') && <>
        <label className="rd-field-label" style={{ marginTop: 12 }}>SMS body</label>
        <textarea className="rr-textarea" value={form.sms_body} onChange={(e) => setForm((v) => ({ ...v, sms_body: e.target.value }))} />
      </>}
      {form.channels.includes('whatsapp') && <>
        <label className="rd-field-label" style={{ marginTop: 12 }}>WhatsApp body</label>
        <textarea className="rr-textarea" value={form.whatsapp_body} onChange={(e) => setForm((v) => ({ ...v, whatsapp_body: e.target.value }))} />
      </>}
      <div className="rd-field-label" style={{ marginTop: 4 }}>Placeholders</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        {REMINDER_PLACEHOLDERS.map((p) => (
          <span key={p} style={{ background: 'var(--surface-3)', color: 'var(--muted)', borderRadius: 100, padding: '3px 9px', fontSize: 10, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{`{{${p}}}`}</span>
        ))}
      </div>
      <p className="rd-hint">{'guest_hub_link'} points a confirmed guest straight to their FestioHub; {'ticket_link'} only resolves once they're confirmed (blank before then).</p>

      {editing !== 'new' && form.channels.length > 0 && (
        <div className="rr-panel" style={{ marginTop: 14 }}><div className="rd-panel-body">
          <div className="rd-row2" style={{ alignItems: 'center' }}>
            <select className="rd-field" style={{ flex: 'none', width: 130 }} value={testChannel} onChange={(e) => { setTestChannel(e.target.value); setPreview(null) }}>
              {form.channels.map((c) => <option key={c} value={c}>{REMINDER_CHANNELS.find((rc) => rc.id === c)?.label}</option>)}
            </select>
            <button type="button" className="rr-btn secondary" disabled={previewBusy} onClick={runPreview}>{previewBusy ? 'Rendering…' : 'Preview'}</button>
            <input className="rd-field" placeholder="Send test to…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button type="button" className="rr-btn secondary" disabled={testBusy || !testTo.trim()} onClick={sendTest}>{testBusy ? 'Sending…' : 'Send test'}</button>
          </div>
          {preview && <ReminderPreviewFrame channel={testChannel} preview={preview} />}
        </div></div>
      )}

      <div className="rd-row2" style={{ marginTop: 14 }}>
        <button className="rr-btn secondary" onClick={() => setEditing(null)}>Cancel</button>
        <button className="rr-btn primary" disabled={busy || !form.label.trim() || form.channels.length === 0} onClick={save}>
          {busy ? 'Saving…' : editing === 'new' ? 'Schedule reminder' : 'Save changes'}
        </button>
      </div>
    </Modal>}
    {deleteTarget && <ConfirmDialog title="Delete reminder" message={`Delete “${deleteTarget.label}”?`} confirmLabel="Delete" onCancel={() => setDeleteTarget(null)} onConfirm={async () => {
      try { await api.deleteReminder(eventId, deleteTarget.id); setDeleteTarget(null); await load(); notify('Reminder deleted') }
      catch (e) { notify(e.message || 'Reminder could not be deleted', true) }
    }} />}
  </>
}

export default function AddonsRedesignPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [eventId] = useCurrentEvent()
  const { event, loading: eventLoading } = useEventDetails(eventId)
  const { flags: realFlags } = useEntitlements(event, eventLoading)
  const [toast, setToast] = useState(null)

  const tabParam = searchParams.get('tab')
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam : 'seating'
  const meta = TAB_META[tab]
  const unlocked = !!realFlags[tab]
  const enabledCount = TABS.filter((t) => realFlags[t.id]).length

  function notify(message, error = false) {
    setToast({ message, error })
    window.setTimeout(() => setToast(null), 2600)
  }

  function goTab(id) {
    setSearchParams({ tab: id })
  }

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive={EVENT_ACTIVE_MAP[tab]}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Add-ons</h1></div>
          <div className="rr-meta"><Icon name="card" size={13} /> {enabledCount} of {TABS.length} modules enabled</div>
        </div>
      </div>

      <div className="rr-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => goTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {eventLoading ? (
        <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} /></div></div>
      ) : !unlocked ? (
        <LockedPanel meta={meta} notify={notify} />
      ) : (
        <>
          <ModuleHeader meta={meta} unlocked />
          {tab === 'seating' && <RealSeatingContent eventId={eventId} event={event} notify={notify} onFloorLayout={() => navigate('/floorplan-redesign')} />}
          {tab === 'orders' && (
            <RealOrdersContent eventId={eventId} notify={notify} />
          )}
          {tab === 'logistics' && <RealLogisticsContent eventId={eventId} notify={notify} />}
          {tab === 'registry' && <RealRegistryContent eventId={eventId} notify={notify} />}
          {tab === 'speakers' && <RealSpeakersContent eventId={eventId} notify={notify} />}
          {tab === 'partners' && <RealPartnersContent eventId={eventId} notify={notify} />}
          {tab === 'reminders' && <RealRemindersContent eventId={eventId} event={event} notify={notify} />}
        </>
      )}

      {toast && <div className="rd-toast" style={toast.error ? { background: 'var(--danger)' } : undefined}><Icon name={toast.error ? 'info' : 'check'} />{toast.message}</div>}

    </RedesignShell>
  )
}
