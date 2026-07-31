import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

const CURRENCY_SYMBOL = { USD: '$', NGN: '₦' }
function fmtMoney(minor, currency) {
  if (minor == null) return ''
  const sym = CURRENCY_SYMBOL[currency] || ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

// Public, no-auth gift registry. Guests reserve items or pledge to cash funds;
// the actual buying/sending happens off-platform (mark-only).
export default function RegistryPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [claimFor, setClaimFor] = useState(null)   // item being claimed
  const [done, setDone] = useState('')

  function load() {
    return api.getRegistryPage(token).then(setData).catch((e) => setError(e.message || 'Registry not found'))
  }
  useEffect(() => { load().finally(() => setLoading(false)) }, [token])

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>
  if (error) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center"><div className="text-4xl mb-3">🎁</div><p className="text-slate-600">{error}</p></div>
    </div>
  )

  const items = (data.items || []).filter((i) => i.kind === 'item')
  const funds = (data.items || []).filter((i) => i.kind === 'fund')
  const links = (data.items || []).filter((i) => i.kind === 'link')

  async function afterClaim() {
    setClaimFor(null)
    setDone('Thank you! Your gift has been recorded. 💛')
    await load()
    setTimeout(() => setDone(''), 6000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 to-white text-slate-900 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🎁</div>
          <h1 className="text-3xl font-bold">{data.event_name}</h1>
          {data.couples_name && <p className="text-slate-500 mt-1">{data.couples_name}</p>}
          {data.registry_message && <p className="text-slate-600 mt-4 max-w-xl mx-auto">{data.registry_message}</p>}
        </div>

        {done && <div className="mb-6 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 text-sm text-center">{done}</div>}

        {links.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {links.map((l) => (
              <div key={l.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <strong className="block text-sm">🔗 {l.title}</strong>
                {l.description && <p className="mt-1 text-xs text-slate-500">{l.description}</p>}
                <div className="flex gap-2 mt-3">
                  <a href={l.buy_url || l.external_url} target="_blank" rel="noreferrer"
                    className="flex-1 text-center border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-slate-50">
                    Open registry
                  </a>
                  <button onClick={() => setClaimFor(l)} className="flex-1 bg-rose-500 text-white rounded-lg px-3 py-2 text-xs font-semibold">
                    Record my gift
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {funds.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">Cash gifts</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {funds.map((f) => {
                const pct = f.amount_minor ? Math.min(100, Math.round((f.raised_minor / f.amount_minor) * 100)) : null
                return (
                  <div key={f.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                    <div className="font-semibold">{f.title}</div>
                    {f.description && <p className="text-xs text-slate-500 mt-0.5">{f.description}</p>}
                    <div className="text-sm text-slate-600 mt-2">
                      Raised <strong>{fmtMoney(f.raised_minor, f.currency)}</strong>{f.amount_minor != null && <> of {fmtMoney(f.amount_minor, f.currency)}</>}
                    </div>
                    {pct != null && (
                      <div className="h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
                        <div className="h-full bg-rose-400" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <button onClick={() => setClaimFor(f)} className="mt-3 w-full bg-rose-500 text-white rounded-lg py-2 text-sm font-semibold hover:bg-rose-600">Contribute</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">Gift items</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((it) => {
                const full = (it.remaining ?? 1) <= 0
                return (
                  <div key={it.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    {it.image_url
                      ? <img src={it.image_url} alt="" className="w-full h-40 object-cover" />
                      : <div className="w-full h-40 bg-slate-100 grid place-items-center text-4xl">🎁</div>}
                    <div className="p-4 flex flex-col flex-1">
                      <div className="font-semibold text-sm">{it.title}</div>
                      {it.description && <p className="text-xs text-slate-500 mt-0.5 flex-1">{it.description}</p>}
                      <div className="flex items-center justify-between mt-2">
                        {it.amount_minor != null && <span className="font-semibold">{fmtMoney(it.amount_minor, it.currency)}</span>}
                        {full ? <span className="text-xs font-semibold text-slate-400">Reserved ✓</span>
                          : it.remaining < it.quantity_wanted && <span className="text-xs text-slate-400">{it.remaining} left</span>}
                      </div>
                      <div className="flex gap-2 mt-3">
                        {(it.buy_url || it.external_url) && (
                          <a href={it.buy_url || it.external_url} target="_blank" rel="noreferrer" className="flex-1 text-center border border-slate-300 rounded-lg py-2 text-xs font-semibold hover:bg-slate-50">Buy</a>
                        )}
                        <button disabled={full} onClick={() => setClaimFor(it)}
                          className="flex-1 bg-rose-500 text-white rounded-lg py-2 text-xs font-semibold hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed">
                          {full ? 'Taken' : "I'm getting this"}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {items.length === 0 && funds.length === 0 && links.length === 0 && (
          <p className="text-center text-slate-400">The registry is being set up — check back soon.</p>
        )}

        <p className="text-xs text-slate-400 text-center mt-10">Powered by Festio</p>
      </div>

      {claimFor && <ClaimModal token={token} item={claimFor} onClose={() => setClaimFor(null)} onDone={afterClaim} />}
    </div>
  )
}

function ClaimModal({ token, item, onClose, onDone }) {
  const isFund = item.kind === 'fund'
  const isLink = item.kind === 'link'
  const [form, setForm] = useState({
    claimer_name: '', claimer_email: '', claimer_phone: '', relationship: '',
    action: isFund ? 'contributed' : isLink ? 'used_external_registry' : 'purchased',
    quantity: 1, amountMajor: '', reference: '', message: '', thank_you_channel: 'email',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300'

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const body = {
        claimer_name: form.claimer_name.trim(),
        claimer_email: form.claimer_email.trim() || undefined,
        claimer_phone: form.claimer_phone.trim() || undefined,
        relationship: form.relationship.trim() || undefined,
        action: form.action,
        reference: form.reference.trim() || undefined,
        message: form.message.trim() || undefined,
        thank_you_channel: form.thank_you_channel,
      }
      if (isFund) {
        const minor = Math.round(parseFloat(form.amountMajor) * 100)
        if (!Number.isFinite(minor) || minor <= 0) throw new Error('Please enter an amount.')
        body.amount_minor = minor
      } else {
        body.quantity = Math.max(parseInt(form.quantity) || 1, 1)
      }
      await api.claimRegistryItem(token, item.id, body)
      onDone()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
        <div className="flex justify-between items-start">
          <h3 className="font-bold">{isFund ? `Contribute to ${item.title}` : isLink ? `Record gift from ${item.title}` : `Record gift: ${item.title}`}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>

        {isFund && item.payment_instructions && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">
            <div className="font-semibold text-xs uppercase text-rose-500 mb-1">How to send</div>
            {item.payment_instructions}
          </div>
        )}

        <input className={inputCls} required placeholder="Your name *" value={form.claimer_name} onChange={(e) => setForm((f) => ({ ...f, claimer_name: e.target.value }))} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} type="email" placeholder="Email" value={form.claimer_email} onChange={(e) => setForm((f) => ({ ...f, claimer_email: e.target.value }))} />
          <input className={inputCls} type="tel" placeholder="Phone" value={form.claimer_phone} onChange={(e) => setForm((f) => ({ ...f, claimer_phone: e.target.value }))} />
        </div>
        <input className={inputCls} placeholder="Relationship to host (optional)" value={form.relationship} onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))} />

        {isFund ? (
          <><select className={inputCls} value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
            <option value="contributed">I sent this contribution</option>
            <option value="pledged">I pledge to send it</option>
          </select><div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">{CURRENCY_SYMBOL[item.currency] || ''}</span>
            <input className={inputCls} type="number" step="0.01" required placeholder="Amount you're sending" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} />
          </div></>
        ) : isLink ? (
          <input className={inputCls} placeholder="Gift or order reference (optional)" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
        ) : (
          <><select className={inputCls} value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
            <option value="purchased">I purchased this gift</option>
            <option value="reserved">I plan to bring this gift</option>
          </select>{item.quantity_wanted > 1 && (
            <input className={inputCls} type="number" min="1" max={item.remaining ?? 1} placeholder="Quantity" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          )}<input className={inputCls} placeholder="Order / delivery reference (optional)" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></>
        )}

        <textarea className={inputCls} rows={2} placeholder="Add a note (optional)" value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Send my thank-you by</label>
          <select className={inputCls} value={form.thank_you_channel} onChange={(e) => setForm((f) => ({ ...f, thank_you_channel: e.target.value }))}>
            <option value="email">Email</option><option value="sms">SMS</option><option value="none">No message</option>
          </select>
          {form.thank_you_channel === 'email' && !form.claimer_email.trim() && <small className="text-amber-600">Enter an email address to receive it.</small>}
          {form.thank_you_channel === 'sms' && !form.claimer_phone.trim() && <small className="text-amber-600">Enter a phone number to receive it.</small>}
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={busy} className="w-full bg-rose-500 text-white rounded-lg py-2.5 text-sm font-bold hover:bg-rose-600 disabled:opacity-50">
          {busy ? 'Saving…' : 'Record my action'}
        </button>
        <p className="text-[11px] text-slate-400 text-center">Festio doesn't process payments — you give directly.</p>
      </form>
    </div>
  )
}
