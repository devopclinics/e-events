import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

function MenuLockedCard() {
  return (
    <div className="border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-5 text-center">
      <div className="text-3xl mb-2">🔒</div>
      <p className="font-bold text-amber-800 dark:text-amber-200">Order selection unlocks at check-in</p>
      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
        Show your QR code to the check-in official. Once you're admitted, you'll be able to choose your items here.
      </p>
    </div>
  )
}

function multiBoundsLabel(min, max) {
  if (min > 0 && max != null) return `Pick ${min} to ${max}`
  if ((min === 0 || min == null) && max != null) return `Pick up to ${max}`
  if (min > 0 && max == null) return `Pick at least ${min}`
  return `Pick as many as you'd like`
}

function CategoryHeader({ name, required, helper }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">{name}</p>
      <div className="flex items-center gap-2">
        {helper && <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{helper}</span>}
        {required && (
          <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-200 text-amber-800 dark:bg-amber-700 dark:text-amber-50 px-1.5 py-0.5 rounded">
            Required
          </span>
        )}
      </div>
    </div>
  )
}

function SingleCategory({ category, value, onChange }) {
  return (
    <div>
      <CategoryHeader
        name={category.name}
        required={category.is_required}
        helper={category.is_required ? 'Pick one' : 'Pick one (optional)'}
      />
      <div className="space-y-2">
        {category.items.map((item) => {
          const selected = value === item.id
          return (
            <label
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300'
                  : 'border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
              }`}
            >
              <input
                type="radio"
                name={`cat-${category.id}`}
                value={item.id}
                checked={selected}
                onChange={() => onChange(item.id)}
                className="mt-1 w-5 h-5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</div>
                )}
              </div>
              {selected && (
                <svg className="w-5 h-5 text-amber-600 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function MultiCategory({ category, value, onChange }) {
  const min = category.min_selections || 0
  const max = category.max_selections
  const selectedIds = value || []
  const count = selectedIds.length
  const maxForCheck = max == null ? Infinity : max
  const inBounds = count >= min && count <= maxForCheck
  const required = !!category.is_required || min > 0
  const countLabel = max != null ? `${count} of ${max} selected` : `${count} selected`

  function toggle(itemId) {
    const has = selectedIds.includes(itemId)
    if (has) {
      onChange(selectedIds.filter((id) => id !== itemId))
    } else {
      if (max != null && count >= max) return
      onChange([...selectedIds, itemId])
    }
  }

  return (
    <div>
      <CategoryHeader name={category.name} required={required} helper={multiBoundsLabel(min, max)} />
      <p className={`text-xs mb-2 font-semibold ${inBounds ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
        {countLabel}
      </p>
      <div className="space-y-2">
        {category.items.map((item) => {
          const selected = selectedIds.includes(item.id)
          const atMax = max != null && count >= max && !selected
          return (
            <label
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-lg border-2 transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300 cursor-pointer'
                  : atMax
                    ? 'border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                    : 'border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={atMax}
                onChange={() => toggle(item.id)}
                className="mt-1 w-5 h-5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</div>
                )}
              </div>
              {selected && (
                <svg className="w-5 h-5 text-amber-600 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ComboCategory({ category, value, onChange }) {
  const combos = category.combinations || []
  if (combos.length === 0) {
    return (
      <div>
        <CategoryHeader name={category.name} helper="Combinations coming soon" />
        <div className="text-xs italic text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-3 text-center">
          The host hasn't added any combinations to this section yet.
        </div>
      </div>
    )
  }
  function pick(comboId) {
    // Required combos can't be cleared by re-tap; optional ones can.
    if (category.is_required) onChange(comboId)
    else onChange(value === comboId ? null : comboId)
  }
  return (
    <div>
      <CategoryHeader
        name={category.name}
        required={category.is_required}
        helper={category.is_required ? 'Pick one' : 'Pick one (optional)'}
      />
      <div className="space-y-3">
        {combos.map((combo) => {
          const selected = value === combo.id
          return (
            <label
              key={combo.id}
              className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 ring-2 ring-amber-300 scale-[1.01] shadow-md'
                  : 'border-slate-300 dark:border-slate-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name={`combo-${category.id}`}
                  value={combo.id}
                  checked={selected}
                  onChange={() => pick(combo.id)}
                  onClick={() => selected && pick(combo.id)}
                  className="mt-1 w-5 h-5 accent-amber-500 shrink-0"
                />
                <div className="flex-1">
                  <div className="text-base font-bold text-slate-900 dark:text-slate-100">{combo.name}</div>
                  {combo.items && combo.items.length > 0 && (
                    <div className="text-sm text-amber-800 dark:text-amber-200 font-medium mt-1">
                      {combo.items.map((it) => it.name).join(', ')}
                    </div>
                  )}
                  {combo.description && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">{combo.description}</div>
                  )}
                </div>
                {selected && (
                  <svg className="w-5 h-5 text-amber-600 mt-1 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function MenuSelection({ token, categories, initialChoices, mealServed }) {
  const [single, setSingle] = useState(initialChoices?.single || {})
  const [multi, setMulti] = useState(initialChoices?.multi || {})
  const [combo, setCombo] = useState(initialChoices?.combo || {})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const hasExistingChoice =
    Object.keys(initialChoices?.single || {}).length > 0 ||
    Object.keys(initialChoices?.multi || {}).length > 0 ||
    Object.keys(initialChoices?.combo || {}).length > 0

  // Required gating respects each category's is_required flag.
  // For multi: max is always enforced; min is enforced when required OR when
  // the guest has already started picking from this category.
  function categoryError(cat) {
    if (cat.selection_type === 'single') {
      if (cat.is_required && !single[cat.id]) return 'Please pick one option.'
      return null
    }
    if (cat.selection_type === 'combo') {
      if (cat.is_required && !combo[cat.id]) return 'Please pick a combination.'
      return null
    }
    if (cat.selection_type === 'multi') {
      const arr = multi[cat.id] || []
      const min = cat.min_selections || 0
      const max = cat.max_selections == null ? Infinity : cat.max_selections
      if (arr.length > max) return `Pick at most ${cat.max_selections}.`
      const needMin = cat.is_required || arr.length > 0
      if (needMin && arr.length < min) return `Pick at least ${min}.`
      return null
    }
    return null
  }

  const canSubmit = categories.every((cat) => categoryError(cat) === null)

  async function submit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      await api.submitMenuChoice(token, { single, multi, combo })
      setMsg(hasExistingChoice ? 'Selection updated!' : 'Order selection saved!')
      setTimeout(() => setMsg(''), 4000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (mealServed) {
    return (
      <div className="border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 text-center">
        <p className="text-sm text-amber-700 dark:text-amber-200 font-semibold">Your order has been served — selection is locked</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">You're all set.</p>
      </div>
    )
  }

  return (
    <div className="border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 rounded-xl overflow-hidden shadow-md">
      <div className="bg-amber-400 dark:bg-amber-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍽️</span>
          <div>
            <h3 className="text-base font-bold">Pick your items</h3>
            <p className="text-xs text-amber-50">
              {hasExistingChoice ? 'Tap any option to change your choice.' : 'Tap to choose what you want.'}
            </p>
          </div>
        </div>
      </div>
      <form onSubmit={submit} className="p-4 space-y-5 bg-white dark:bg-slate-900">
        {categories.map((cat) => {
          const err = categoryError(cat)
          return (
            <div key={cat.id}>
              {cat.selection_type === 'single' && (
                <SingleCategory
                  category={cat}
                  value={single[cat.id]}
                  onChange={(itemId) => setSingle((prev) => ({ ...prev, [cat.id]: itemId }))}
                />
              )}
              {cat.selection_type === 'multi' && (
                <MultiCategory
                  category={cat}
                  value={multi[cat.id]}
                  onChange={(ids) => setMulti((prev) => ({ ...prev, [cat.id]: ids }))}
                />
              )}
              {cat.selection_type === 'combo' && (
                <ComboCategory
                  category={cat}
                  value={combo[cat.id]}
                  onChange={(comboId) => setCombo((prev) => ({ ...prev, [cat.id]: comboId }))}
                />
              )}
              {err && <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-2">{err}</p>}
            </div>
          )
        })}
        {error && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>}
        {msg && <p className="text-sm text-green-600 dark:text-green-400 font-bold text-center">✓ {msg}</p>}
        <button
          type="submit"
          disabled={saving || !canSubmit}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-lg text-base font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : hasExistingChoice ? 'Update Selection' : 'Save Selection'}
        </button>
      </form>
    </div>
  )
}

function StatusBadge({ status }) {
  const cfg = {
    valid: {
      bg: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      dot: 'bg-emerald-500',
      label: 'Valid Ticket',
    },
    admitted: {
      bg: 'bg-teal-50 border-teal-200 text-teal-700',
      dot: 'bg-teal-500',
      label: 'Admitted',
    },
    invalid: {
      bg: 'bg-red-50 border-red-300 text-red-600',
      dot: 'bg-red-500',
      label: 'Invalid Ticket',
    },
  }[status] || { bg: 'bg-gray-100 border-gray-300 text-gray-500', dot: 'bg-gray-400', label: 'Unknown' }

  return (
    <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-semibold ${cfg.bg}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot} ${status === 'valid' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  )
}

function AdmittedBanner({ guest, event }) {
  return (
    <div className="bg-teal-600 text-white rounded-lg px-6 py-5 text-center">
      <div className="flex items-center justify-center gap-2 mb-1">
        <svg className="w-5 h-5 text-teal-100" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span className="text-teal-100 text-sm font-medium">Check-in complete</span>
      </div>
      <p className="font-semibold text-lg">
        Welcome, {guest.first_name}!
      </p>
      {guest.admitted_at && (
        <p className="text-teal-100 text-sm mt-0.5">
          Admitted at {new Date(guest.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  )
}

function NotificationPreferences({ token, guest, eventNotifySms, eventNotifyWa, onChange }) {
  // Don't show the card if the guest has no phone OR both channels are off at the event level.
  const phone = guest?.phone
  if (!phone) return null
  if (!eventNotifySms && !eventNotifyWa) return null

  const [smsOn, setSmsOn] = useState(guest?.sms_consent ?? true)
  const [waOn,  setWaOn]  = useState(guest?.whatsapp_consent ?? true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function toggle(field, next, setter) {
    setSaving(true); setMsg('')
    setter(next)
    try {
      await api.updatePreferences(token, { [field]: next })
      setMsg(next ? 'Notifications on.' : 'Opted out.')
      setTimeout(() => setMsg(''), 3000)
      onChange?.()
    } catch (e) {
      setter(!next)
      setMsg(e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">🔔 Notification preferences</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          We'll send event reminders, check-in confirmations and seat assignments to <strong>{phone}</strong>.
          Standard message and data rates may apply. Reply <strong>STOP</strong> to opt out at any time.
        </p>
      </div>
      <div className="space-y-2">
        {eventNotifySms && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={smsOn} disabled={saving}
              onChange={(e) => toggle('sms_consent', e.target.checked, setSmsOn)}
              className="w-5 h-5 accent-teal-500" />
            <span className="text-sm text-slate-700 dark:text-slate-200">
              Receive <strong>SMS</strong> updates
            </span>
          </label>
        )}
        {eventNotifyWa && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={waOn} disabled={saving}
              onChange={(e) => toggle('whatsapp_consent', e.target.checked, setWaOn)}
              className="w-5 h-5 accent-teal-500" />
            <span className="text-sm text-slate-700 dark:text-slate-200">
              Receive <strong>WhatsApp</strong> updates
            </span>
          </label>
        )}
      </div>
      {msg && <p className="text-xs text-teal-600 dark:text-teal-400">{msg}</p>}
    </div>
  )
}

function PartnerPairing({ token, partner, onChange, eventSeatingEnabled }) {
  const [open, setOpen] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!eventSeatingEnabled) return null

  async function pair(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await api.pairPartner(token, first.trim(), last.trim(), email.trim())
      setOpen(false); setFirst(''); setLast(''); setEmail('')
      onChange?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function unpair() {
    if (!confirm('Remove your pairing? You may not end up at the same table as your partner.')) return
    setBusy(true); setError('')
    try {
      await api.unpairPartner(token)
      onChange?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  if (partner) {
    return (
      <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-lg p-4 text-center space-y-2">
        <div className="text-pink-600 dark:text-pink-300 text-xs uppercase font-semibold tracking-wide">
          Seated together
        </div>
        <div className="text-slate-800 dark:text-white font-semibold">
          You & {partner.first_name} {partner.last_name}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          When you both check in, you'll be placed at the same table — side by side.
          {partner.admitted && ' (Your partner has already arrived.)'}
        </p>
        <button onClick={unpair} disabled={busy}
          className="text-xs text-red-500 hover:underline disabled:opacity-50">
          Unpair
        </button>
      </div>
    )
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
      {!open ? (
        <div className="text-center space-y-2">
          <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">
            Are you attending with your spouse or partner?
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pair up and we'll seat you together at check-in.
          </p>
          <button onClick={() => setOpen(true)}
            className="bg-pink-500 hover:bg-pink-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            Pair with my partner
          </button>
        </div>
      ) : (
        <form onSubmit={pair} className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enter your partner's details exactly as on the invite list.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input value={first} onChange={(e) => setFirst(e.target.value)} required placeholder="First name"
              className="border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            <input value={last} onChange={(e) => setLast(e.target.value)} required placeholder="Last name"
              className="border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="Email"
            className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
          {error && <div className="text-xs text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy}
              className="flex-1 bg-pink-500 hover:bg-pink-600 text-white text-sm font-semibold px-3 py-2 rounded-md disabled:opacity-50">
              {busy ? 'Pairing…' : 'Pair'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError('') }}
              className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function ScanAutoPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = () => api.viewTicket(token).then(setData).catch(() => setData({ status: 'invalid' }))

  useEffect(() => {
    reload().finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (loading) {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-slate-500 text-sm">Loading your ticket…</p>
        </div>
      </div>
    )
  }

  if (data?.status === 'invalid') {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xl p-10 text-center max-w-sm w-full">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Invalid Ticket</h2>
          <p className="text-slate-500 text-sm">This QR code is not valid for any event. Please contact the event organiser.</p>
        </div>
      </div>
    )
  }

  const { guest, event, status, table_name, seat_number, menu_categories, guest_choices, partner, menu_locked } = data || {}
  const qrImageUrl = `/api/scan/${token}/qr.png`
  const eventDate = event?.event_date ? new Date(event.event_date) : null

  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4 py-10">
      {/* Ticket card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header strip */}
        <div className="bg-slate-950 px-6 pt-8 pb-10 text-center relative">
          <div className="absolute top-4 right-4 left-4 flex justify-center">
            <StatusBadge status={status} />
          </div>
          <div className="mt-8">
            <p className="text-teal-200 text-xs uppercase font-semibold mb-1">You're invited to</p>
            <h1 className="text-white text-2xl font-bold leading-tight">{event?.name || 'Event'}</h1>
            <p className="text-slate-300 text-sm mt-1 italic">{event?.couples_name}</p>
            {eventDate && (
              <p className="text-slate-400 text-xs mt-2 font-medium">
                {eventDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {/* Tear-line notches */}
        <div className="relative -mt-4 flex justify-between px-0">
          <div className="w-8 h-8 bg-slate-100 dark:bg-slate-950 rounded-full -ml-4" />
          <div className="flex-1 border-t-2 border-dashed border-slate-200 self-center mx-2 mt-4" />
          <div className="w-8 h-8 bg-slate-100 dark:bg-slate-950 rounded-full -mr-4" />
        </div>

        {/* Body */}
        <div className="px-6 pb-8 pt-2 space-y-5">
          {/* Guest name */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-medium mb-0.5">Guest</p>
            <p className="text-slate-800 dark:text-white text-xl font-bold">
              {guest?.first_name} {guest?.last_name}
            </p>
          </div>

          {/* QR code */}
          <div className="flex justify-center">
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 inline-block">
              {guest?.id ? (
                <img
                  src={qrImageUrl}
                  alt="Your QR code"
                  className="w-44 h-44 object-contain"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-slate-300 text-sm">
                  QR not available
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-slate-400 text-xs">
            {status === 'admitted'
              ? 'You have already been checked in.'
              : 'Show this code to the check-in official at the entrance.'}
          </p>

          {/* Admitted banner */}
          {status === 'admitted' && <AdmittedBanner guest={guest} event={event} />}

          {/* Table / Seat badge */}
          {(table_name || seat_number) && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg text-sm font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {table_name}
                {seat_number && <span className="text-indigo-400">· Seat {seat_number}</span>}
              </span>
            </div>
          )}

          {/* Partner pairing — only when seating is enabled and guest not yet seated */}
          {event?.seating_enabled && status !== 'admitted' && (
            <PartnerPairing
              token={token}
              partner={partner}
              eventSeatingEnabled={event?.seating_enabled}
              onChange={reload}
            />
          )}

          {/* Notification preferences — TCR opt-in compliance + guest control */}
          <NotificationPreferences
            token={token}
            guest={guest}
            eventNotifySms={event?.notify_sms}
            eventNotifyWa={event?.notify_whatsapp}
            onChange={reload}
          />

          {/* Menu selection */}
          {menu_locked ? (
            <MenuLockedCard />
          ) : menu_categories && menu_categories.length > 0 ? (
            <MenuSelection
              token={token}
              categories={menu_categories}
              initialChoices={guest_choices || {}}
              mealServed={guest?.meal_served}
            />
          ) : null}
        </div>
      </div>

      <p className="fixed bottom-4 text-slate-400 text-xs text-center w-full">Powered by Festio</p>
    </div>
  )
}
