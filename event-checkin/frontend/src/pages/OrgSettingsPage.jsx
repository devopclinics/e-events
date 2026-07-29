import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

const SUPPORTED_EVENT_TYPES = ['guest.created', 'guest.checked_in', 'rsvp.confirmed']

const FEATURE_LABELS = { api_write: 'Read-write API access' }

function money(amountSmallestUnit, currency) {
  if (amountSmallestUnit == null) return ''
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountSmallestUnit / 100)
  } catch { return `${(amountSmallestUnit / 100).toFixed(2)} ${currency}` }
}

function CopyableKey({ label, value }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* clipboard unavailable — value is still selectable text */ }
  }
  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
      <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">{label} — shown once, save it now</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 text-xs bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
          {value}
        </code>
        <button onClick={copy} className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline shrink-0">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function ApiKeysPanel() {
  const [keys, setKeys] = useState([])
  const [name, setName] = useState('')
  const [scope, setScope] = useState('read_only')
  const [hasSubscription, setHasSubscription] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [justCreated, setJustCreated] = useState(null)

  async function reload() {
    try {
      const [ks, sub] = await Promise.all([api.listApiKeys(), api.getOrgSubscription()])
      setKeys(ks)
      setHasSubscription(sub.status === 'active')
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  async function create(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true); setErr('')
    try {
      const created = await api.createApiKey(name.trim(), scope)
      setJustCreated(created)
      setName('')
      setScope('read_only')
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function revoke(id) {
    if (!confirm('Revoke this API key? Anything using it will stop working immediately.')) return
    try { await api.revokeApiKey(id); await reload() } catch (e) { setErr(e.message) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-base text-gray-900 dark:text-white">API Keys</h2>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
          Programmatic access to your events and guests. Send the key in an <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">X-API-Key</code> header.
        </p>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {justCreated && <CopyableKey label={`Key "${justCreated.name}"`} value={justCreated.key} />}

      <form onSubmit={create} className="space-y-2">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zapier integration"
            className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          <button type="submit" disabled={loading || !name.trim()}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shrink-0">
            Create key
          </button>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-slate-300">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="scope" checked={scope === 'read_only'} onChange={() => setScope('read_only')} />
            Read-only
          </label>
          <label className={`flex items-center gap-1.5 ${hasSubscription ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
            <input type="radio" name="scope" checked={scope === 'read_write'} disabled={!hasSubscription}
              onChange={() => setScope('read_write')} />
            Read-write
          </label>
          {!hasSubscription && (
            <span className="text-gray-400 dark:text-slate-500">Requires the API Access plan — see Subscription below.</span>
          )}
        </div>
      </form>

      {keys.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No API keys yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {keys.map((k) => (
            <div key={k.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                  {k.name}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    k.scope === 'read_write'
                      ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                  }`}>{k.scope === 'read_write' ? 'read-write' : 'read-only'}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-slate-400">
                  <code>{k.key_prefix}…</code> · created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  {k.revoked_at && ' · revoked'}
                </div>
              </div>
              {!k.revoked_at && (
                <button onClick={() => revoke(k.id)} className="text-xs text-red-500 hover:text-red-700 shrink-0">Revoke</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-100 dark:border-slate-700 pt-3 text-xs text-gray-500 dark:text-slate-400 space-y-1">
        <div className="font-semibold text-gray-600 dark:text-slate-300">Quick start</div>
        <pre className="bg-gray-50 dark:bg-slate-900 rounded p-2 overflow-x-auto">{`curl -H "X-API-Key: YOUR_KEY" https://staging.festio.events/api/public/v1/events`}</pre>
        <div>
          <Link to="/api-docs" className="text-indigo-600 dark:text-indigo-400 underline">Full API documentation</Link>
          {' '}— endpoints, security model, rate limits, and webhook signing.
        </div>
        {hasSubscription ? (
          <div>
            <Link to="/api-explorer" className="text-indigo-600 dark:text-indigo-400 underline">Open interactive API explorer</Link>
            {' '}— try requests directly in your browser.
          </div>
        ) : (
          <div className="text-gray-400 dark:text-slate-500">
            Interactive API explorer requires the API Access plan — see Subscription below.
          </div>
        )}
      </div>
    </div>
  )
}

function SubscriptionPanel() {
  const [sub, setSub] = useState(null)
  const [plans, setPlans] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [s, p] = await Promise.all([api.getOrgSubscription(), api.listSubscriptionPlans()])
      setSub(s)
      setPlans(p)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  async function subscribe(planKey) {
    setBusy(true); setErr('')
    try {
      const { url } = await api.createOrgSubscriptionCheckout(planKey)
      window.location.href = url
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  async function cancel() {
    if (!confirm('Cancel your subscription? Read-write API keys stop working at the end of the current billing period.')) return
    setBusy(true); setErr('')
    try { await api.cancelOrgSubscription(); await reload() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (!sub) return null
  const active = sub.status === 'active'

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-base text-gray-900 dark:text-white">Subscription</h2>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
          Org-wide paid features, billed monthly — currently unlocks read-write API access.
        </p>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      {active ? (
        <div className="rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/20 p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-semibold text-teal-800 dark:text-teal-300">
              {plans.find((p) => p.key === sub.plan)?.label || sub.plan} — active
            </div>
            {sub.current_period_end && (
              <div className="text-xs text-teal-700 dark:text-teal-400 mt-0.5">
                Renews {new Date(sub.current_period_end).toLocaleDateString()}
              </div>
            )}
          </div>
          <button onClick={cancel} disabled={busy} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 shrink-0">
            Cancel subscription
          </button>
        </div>
      ) : (
        <>
          {sub.status === 'canceled' && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Your subscription was canceled. Subscribe again below to restore read-write API access.
            </p>
          )}
          {plans.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">No plans available yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((p) => (
                <div key={p.key} className="rounded-lg border border-gray-200 dark:border-slate-600 p-4 space-y-2">
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">{p.label}</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white">
                    {money(p.amount, p.currency)}<span className="text-xs font-normal text-gray-400"> /month</span>
                  </div>
                  <ul className="text-xs text-gray-500 dark:text-slate-400 space-y-0.5">
                    {p.features.map((f) => <li key={f}>• {FEATURE_LABELS[f] || f}</li>)}
                  </ul>
                  <button onClick={() => subscribe(p.key)} disabled={busy}
                    className="w-full bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                    Subscribe
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DeliveriesList({ webhookId }) {
  const [deliveries, setDeliveries] = useState(null)
  useEffect(() => { api.listWebhookDeliveries(webhookId).then(setDeliveries).catch(() => setDeliveries([])) }, [webhookId])
  if (deliveries === null) return <p className="text-xs text-gray-400 mt-1">Loading…</p>
  if (deliveries.length === 0) return <p className="text-xs text-gray-400 mt-1">No deliveries yet.</p>
  return (
    <div className="mt-2 space-y-1">
      {deliveries.map((d) => (
        <div key={d.id} className="text-xs flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded font-semibold ${
            d.status === 'delivered' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
              : d.status === 'failed' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
          }`}>{d.status}</span>
          <span className="text-gray-600 dark:text-slate-300">{d.event_type}</span>
          <span className="text-gray-400 dark:text-slate-500">{new Date(d.created_at).toLocaleString()}</span>
          {d.attempt_count > 0 && <span className="text-gray-400 dark:text-slate-500">· {d.attempt_count} attempt{d.attempt_count === 1 ? '' : 's'}</span>}
        </div>
      ))}
    </div>
  )
}

function WebhooksPanel() {
  const [webhooks, setWebhooks] = useState([])
  const [form, setForm] = useState(null)   // { url, eventTypes: Set }
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [justCreated, setJustCreated] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  async function reload() {
    try { setWebhooks(await api.listWebhooks()) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  async function create(e) {
    e.preventDefault()
    if (!form.url.trim() || form.eventTypes.size === 0) return
    setLoading(true); setErr('')
    try {
      const created = await api.createWebhook(form.url.trim(), [...form.eventTypes])
      setJustCreated(created)
      setForm(null)
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function remove(id) {
    if (!confirm('Delete this webhook?')) return
    try { await api.deleteWebhook(id); await reload() } catch (e) { setErr(e.message) }
  }

  function toggleType(type) {
    setForm((f) => {
      const next = new Set(f.eventTypes)
      next.has(type) ? next.delete(type) : next.add(type)
      return { ...f, eventTypes: next }
    })
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base text-gray-900 dark:text-white">Webhooks</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Get notified the moment something happens — signed with HMAC-SHA256 so you can verify it's really us.
          </p>
        </div>
        {!form && (
          <button onClick={() => setForm({ url: '', eventTypes: new Set() })}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">
            + Add webhook
          </button>
        )}
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {justCreated && <CopyableKey label="Signing secret" value={justCreated.secret} />}

      {form && (
        <form onSubmit={create} className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Endpoint URL</label>
            <input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required
              placeholder="https://your-app.example.com/webhooks/festio"
              className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Events to send</label>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_EVENT_TYPES.map((type) => (
                <button key={type} type="button" onClick={() => toggleType(type)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    form.eventTypes.has(type)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                  }`}>
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading || !form.url.trim() || form.eventTypes.size === 0}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              Create
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {webhooks.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No webhooks yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {webhooks.map((w) => (
            <div key={w.id} className="py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white break-all">{w.url}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 flex flex-wrap gap-1">
                    {w.event_types.map((t) => (
                      <span key={t} className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
                  className="text-xs text-indigo-600 hover:underline shrink-0">
                  {expandedId === w.id ? 'Hide deliveries' : 'View deliveries'}
                </button>
                <button onClick={() => remove(w.id)} className="text-xs text-red-500 hover:text-red-700 shrink-0">Delete</button>
              </div>
              {expandedId === w.id && <DeliveriesList webhookId={w.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ContactListsPanel() {
  const [lists, setLists] = useState([])
  const [newName, setNewName] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [contacts, setContacts] = useState([])
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', email: '' })
  const [pasteText, setPasteText] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    try { setLists(await api.listContactLists()) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  async function createList(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true); setErr('')
    try { await api.createContactList(newName.trim()); setNewName(''); await reload() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function removeList(id) {
    if (!confirm('Delete this contact list? Contacts already linked to a calendar keep their existing links.')) return
    try {
      await api.deleteContactList(id)
      if (expandedId === id) setExpandedId(null)
      await reload()
    } catch (e) { setErr(e.message) }
  }

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    try { setContacts(await api.listContacts(id)) } catch (e) { setErr(e.message) }
  }

  async function addContact(e) {
    e.preventDefault()
    if (!addForm.first_name.trim() || !addForm.email.trim()) return
    setBusy(true); setErr('')
    try {
      await api.addContact(expandedId, addForm)
      setAddForm({ first_name: '', last_name: '', email: '' })
      setContacts(await api.listContacts(expandedId))
      await reload()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function submitPaste(e) {
    e.preventDefault()
    if (!pasteText.trim()) return
    setBusy(true); setErr('')
    try {
      await api.pasteContacts(expandedId, pasteText)
      setPasteText(''); setShowPaste(false)
      setContacts(await api.listContacts(expandedId))
      await reload()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function removeContact(contactId) {
    try {
      await api.deleteContact(expandedId, contactId)
      setContacts(await api.listContacts(expandedId))
      await reload()
    } catch (e) { setErr(e.message) }
  }

  async function uploadCsv(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try {
      const added = await api.importContactsCsv(expandedId, file)
      setContacts(await api.listContacts(expandedId))
      await reload()
      alert(`Imported ${added.length} contact${added.length === 1 ? '' : 's'}.`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-base text-gray-900 dark:text-white">Contact Lists</h2>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
          Reusable audiences for private calendars — each contact gets their own personalized calendar link.
        </p>
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}

      <form onSubmit={createList} className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Board Members"
          className={`flex-1 ${inputCls}`} />
        <button type="submit" disabled={busy || !newName.trim()}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shrink-0">
          + New list
        </button>
      </form>

      {lists.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No contact lists yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {lists.map((l) => (
            <div key={l.id} className="py-2.5">
              <div className="flex items-center gap-3">
                <button onClick={() => toggleExpand(l.id)} className="flex-1 min-w-0 text-left">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{l.name}</span>
                  <span className="text-xs text-gray-400 dark:text-slate-500 ml-2">{l.contact_count} contact{l.contact_count === 1 ? '' : 's'}</span>
                </button>
                <button onClick={() => removeList(l.id)} className="text-xs text-red-500 hover:text-red-700 shrink-0">Delete</button>
              </div>
              {expandedId === l.id && (
                <div className="mt-3 pl-2 border-l-2 border-gray-100 dark:border-slate-700 space-y-3">
                  {contacts.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-slate-500">No contacts yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {contacts.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 text-sm group">
                          <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-slate-200">
                            {c.first_name} {c.last_name || ''} <span className="text-gray-400 dark:text-slate-500">— {c.email}</span>
                          </span>
                          <button onClick={() => removeContact(c.id)}
                            className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={addContact} className="flex flex-wrap gap-2">
                    <input value={addForm.first_name} onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                      placeholder="First name" className={`w-28 ${inputCls}`} />
                    <input value={addForm.last_name} onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                      placeholder="Last name" className={`w-28 ${inputCls}`} />
                    <input value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="Email" type="email" className={`flex-1 min-w-[10rem] ${inputCls}`} />
                    <button type="submit" disabled={busy}
                      className="text-sm text-indigo-600 hover:underline disabled:opacity-40 shrink-0">Add</button>
                  </form>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setShowPaste((v) => !v)} className="text-xs text-indigo-600 hover:underline">
                      {showPaste ? 'Hide paste box' : 'Paste multiple…'}
                    </button>
                    <label className="text-xs text-indigo-600 hover:underline cursor-pointer">
                      Upload CSV…
                      <input type="file" accept=".csv,.xlsx" onChange={uploadCsv} disabled={busy} className="hidden" />
                    </label>
                  </div>
                  {showPaste && (
                    <form onSubmit={submitPaste} className="space-y-1.5">
                      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4}
                        placeholder={'One per line: Name, email@example.com'}
                        className={`w-full ${inputCls}`} />
                      <button type="submit" disabled={busy || !pasteText.trim()}
                        className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                        Add pasted contacts
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CalendarDetail({ calendar, contactLists, allEvents, onChange, onClose }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [addingEvent, setAddingEvent] = useState('')
  const [dragId, setDragId] = useState(null)

  const eventById = Object.fromEntries(allEvents.map((e) => [e.id, e]))
  const curatedEvents = calendar.event_ids.map((id) => eventById[id]).filter(Boolean)
  const availableEvents = allEvents.filter((e) => !calendar.event_ids.includes(e.id))

  async function refresh() {
    try { onChange(await api.getCalendar(calendar.id)) } catch (e) { setErr(e.message) }
  }

  async function save(patch) {
    setBusy(true); setErr('')
    try { await api.updateCalendar(calendar.id, patch); await refresh() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function addEvent(e) {
    e.preventDefault()
    if (!addingEvent) return
    setBusy(true); setErr('')
    try { await api.addCalendarEvent(calendar.id, addingEvent); setAddingEvent(''); await refresh() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function removeEvent(eventId) {
    try { await api.removeCalendarEvent(calendar.id, eventId); await refresh() }
    catch (e) { setErr(e.message) }
  }

  async function move(eventId, dir) {
    const ids = calendar.event_ids.slice()
    const i = ids.indexOf(eventId)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    try { await api.reorderCalendarEvents(calendar.id, ids); await refresh() }
    catch (e) { setErr(e.message) }
  }

  function dropOn(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    const ids = calendar.event_ids.slice()
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) { setDragId(null); return }
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    setDragId(null)
    api.reorderCalendarEvents(calendar.id, ids).then(refresh).catch((e) => setErr(e.message))
  }

  async function toggleList(listId) {
    const ids = calendar.contact_list_ids.includes(listId)
      ? calendar.contact_list_ids.filter((id) => id !== listId)
      : [...calendar.contact_list_ids, listId]
    setBusy(true); setErr('')
    try { await api.setCalendarContactLists(calendar.id, ids); await refresh() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function uploadLogo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try { await api.uploadCalendarLogo(calendar.id, file); await refresh() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function removeLogo() {
    setBusy(true); setErr('')
    try { await api.deleteCalendarLogo(calendar.id); await refresh() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function sendLinks() {
    setBusy(true); setErr('')
    try {
      const { queued } = await api.sendCalendarLinks(calendar.id)
      alert(`Sent ${queued} contact${queued === 1 ? '' : 's'} their calendar link.`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const shareUrl = calendar.share_token ? `${window.location.origin}/calendar/${calendar.share_token}` : null
  const embedCode = shareUrl
    ? `<iframe src="${shareUrl}" width="100%" height="700" style="border:0"></iframe>`
    : ''

  return (
    <div className="mt-3 pl-2 border-l-2 border-gray-100 dark:border-slate-700 space-y-4">
      {err && <p className="text-sm text-red-500">{err}</p>}

      <p className="text-xs text-gray-400 dark:text-slate-500">
        {calendar.view_count} view{calendar.view_count === 1 ? '' : 's'}
      </p>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Description</label>
        <textarea defaultValue={calendar.description || ''} onBlur={(e) => save({ description: e.target.value })}
          rows={2} className={`w-full ${inputCls}`} placeholder="Optional context for visitors" />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
        <input type="checkbox" checked={calendar.hide_past_events}
          onChange={(e) => save({ hide_past_events: e.target.checked })} />
        Hide past events
      </label>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Logo</label>
        {calendar.logo_url ? (
          <div className="flex items-center gap-3">
            <img src={calendar.logo_url} alt="Calendar logo" style={{ width: calendar.logo_width || 120 }} className="rounded" />
            <button onClick={removeLogo} disabled={busy} className="text-xs text-red-500 hover:text-red-700">Remove</button>
          </div>
        ) : (
          <label className="inline-block text-sm text-indigo-600 hover:underline cursor-pointer">
            + Upload logo
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={uploadLogo} disabled={busy} className="hidden" />
          </label>
        )}
        {calendar.logo_url && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-slate-400">Width (px)</label>
            <input type="number" defaultValue={calendar.logo_width || 120} onBlur={(e) => save({ logo_width: Number(e.target.value) })}
              className={`w-20 ${inputCls}`} />
          </div>
        )}
      </div>

      {calendar.visibility === 'public' && shareUrl && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Public link</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">{shareUrl}</code>
              <button onClick={() => navigator.clipboard.writeText(shareUrl)} className="text-xs text-indigo-600 hover:underline shrink-0">Copy</button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Embed on your site</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
                {embedCode}
              </code>
              <button onClick={() => navigator.clipboard.writeText(embedCode)} className="text-xs text-indigo-600 hover:underline shrink-0">Copy</button>
            </div>
          </div>
        </div>
      )}

      {calendar.visibility === 'private' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Contact lists (audience)</label>
          {contactLists.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-slate-500">Create a contact list above first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {contactLists.map((l) => (
                <label key={l.id} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${
                  calendar.contact_list_ids.includes(l.id)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                }`}>
                  <input type="checkbox" className="hidden" checked={calendar.contact_list_ids.includes(l.id)}
                    onChange={() => toggleList(l.id)} />
                  {l.name}
                </label>
              ))}
            </div>
          )}
          <button onClick={sendLinks} disabled={busy || calendar.contact_list_ids.length === 0}
            className="mt-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
            Send calendar link to all contacts
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Events on this calendar</label>
        {curatedEvents.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500">No events curated yet.</p>
        ) : (
          <div className="space-y-1">
            {curatedEvents.map((ev, i) => (
              <div key={ev.id} draggable onDragStart={() => setDragId(ev.id)}
                onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(ev.id)}
                className={`flex items-center gap-2 text-sm rounded px-1 -mx-1 cursor-grab active:cursor-grabbing ${
                  dragId === ev.id ? 'opacity-40' : ''
                }`}>
                <span className="text-gray-300 dark:text-slate-600 select-none" aria-hidden>⠿</span>
                <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-slate-200">{ev.name}</span>
                <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0">
                  {calendar.event_click_counts?.[ev.id] || 0} click{(calendar.event_click_counts?.[ev.id] || 0) === 1 ? '' : 's'}
                </span>
                <button onClick={() => move(ev.id, -1)} disabled={i === 0} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
                <button onClick={() => move(ev.id, 1)} disabled={i === curatedEvents.length - 1} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
                <button onClick={() => removeEvent(ev.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            ))}
          </div>
        )}
        {availableEvents.length > 0 && (
          <form onSubmit={addEvent} className="flex gap-2 mt-2">
            <select value={addingEvent} onChange={(e) => setAddingEvent(e.target.value)} className={`flex-1 ${inputCls}`}>
              <option value="">Add an event…</option>
              {availableEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button type="submit" disabled={busy || !addingEvent}
              className="text-sm text-indigo-600 hover:underline disabled:opacity-40 shrink-0">Add</button>
          </form>
        )}
      </div>

      <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">Close</button>
    </div>
  )
}

function CalendarsPanel() {
  const [calendars, setCalendars] = useState([])
  const [contactLists, setContactLists] = useState([])
  const [allEvents, setAllEvents] = useState([])
  const [form, setForm] = useState(null)   // { title, visibility, description }
  const [expandedId, setExpandedId] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [cals, lists, events] = await Promise.all([api.listCalendars(), api.listContactLists(), api.listEvents()])
      setCalendars(cals); setContactLists(lists); setAllEvents(events)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  async function createCalendar(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setBusy(true); setErr('')
    try {
      const created = await api.createCalendar({ title: form.title.trim(), visibility: form.visibility, description: form.description || null })
      setForm(null)
      await reload()
      setExpandedId(created.id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function removeCalendar(id) {
    if (!confirm('Delete this calendar? This does not delete the events on it.')) return
    try {
      await api.deleteCalendar(id)
      if (expandedId === id) setExpandedId(null)
      await reload()
    } catch (e) { setErr(e.message) }
  }

  function updateInList(updated) {
    setCalendars((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const expandedCalendar = calendars.find((c) => c.id === expandedId)

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base text-gray-900 dark:text-white">Calendars</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Curated event listing pages — public (one shared link) or private (a personalized link per contact).
          </p>
        </div>
        {!form && (
          <button onClick={() => setForm({ title: '', visibility: 'public', description: '' })}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">
            + New calendar
          </button>
        )}
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}

      {form && (
        <form onSubmit={createCalendar} className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600 space-y-2">
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required
            placeholder="Title, e.g. Upcoming Events" className={`w-full ${inputCls}`} />
          <div className="flex items-center gap-4 text-sm text-gray-700 dark:text-slate-200">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={form.visibility === 'public'} onChange={() => setForm((f) => ({ ...f, visibility: 'public' }))} />
              Public
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={form.visibility === 'private'} onChange={() => setForm((f) => ({ ...f, visibility: 'private' }))} />
              Private
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !form.title.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              Create
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {calendars.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No calendars yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-slate-700">
          {calendars.map((c) => (
            <div key={c.id} className="py-2.5">
              <div className="flex items-center gap-3">
                <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="flex-1 min-w-0 text-left">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>
                  <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    c.visibility === 'private'
                      ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                  }`}>{c.visibility}</span>
                  <span className="text-xs text-gray-400 dark:text-slate-500 ml-2">{c.event_ids.length} event{c.event_ids.length === 1 ? '' : 's'}</span>
                </button>
                <button onClick={() => removeCalendar(c.id)} className="text-xs text-red-500 hover:text-red-700 shrink-0">Delete</button>
              </div>
              {expandedId === c.id && expandedCalendar && (
                <CalendarDetail
                  calendar={expandedCalendar} contactLists={contactLists} allEvents={allEvents}
                  onChange={updateInList} onClose={() => setExpandedId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function OrgSettingsPage() {
  const [msg, setMsg] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscribed')) {
      setMsg('Subscription active — read-write API keys are now available below.')
      setTimeout(() => setMsg(''), 8000)
      window.history.replaceState({}, '', '/org-settings')
      setRefreshKey((k) => k + 1)
    }
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Organization Settings</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Public API access and outbound webhooks for your organization.</p>
      </div>
      {msg && (
        <p className="text-sm bg-teal-50 dark:bg-teal-900/20 text-teal-800 dark:text-teal-300 rounded-lg px-3 py-2">{msg}</p>
      )}
      <SubscriptionPanel key={`sub-${refreshKey}`} />
      <ApiKeysPanel key={`keys-${refreshKey}`} />
      <WebhooksPanel />
      <CalendarsPanel />
      <ContactListsPanel />
    </div>
  )
}
