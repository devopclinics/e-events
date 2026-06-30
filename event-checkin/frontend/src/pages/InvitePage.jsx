import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

// ── Theme definitions ─────────────────────────────────────────────────────────

const THEMES = {
  default: {
    bg: 'bg-gradient-to-br from-teal-50 to-cyan-100 dark:from-slate-900 dark:to-slate-800',
    card: 'bg-white/90 dark:bg-slate-800/90',
    header: 'bg-teal-600',
    accent: 'text-teal-700 dark:text-teal-300',
    btn: 'bg-teal-600 hover:bg-teal-700',
    border: 'border-teal-200 dark:border-teal-800',
    badge: 'bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200',
  },
  gold: {
    bg: 'bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-stone-900 dark:to-stone-800',
    card: 'bg-white/90 dark:bg-stone-800/90',
    header: 'bg-amber-500',
    accent: 'text-amber-700 dark:text-amber-300',
    btn: 'bg-amber-500 hover:bg-amber-600',
    border: 'border-amber-200 dark:border-amber-800',
    badge: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  },
  rose: {
    bg: 'bg-gradient-to-br from-pink-50 to-rose-100 dark:from-slate-900 dark:to-rose-950',
    card: 'bg-white/90 dark:bg-slate-800/90',
    header: 'bg-rose-500',
    accent: 'text-rose-700 dark:text-rose-300',
    btn: 'bg-rose-500 hover:bg-rose-600',
    border: 'border-rose-200 dark:border-rose-800',
    badge: 'bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
  },
  midnight: {
    bg: 'bg-gradient-to-br from-slate-900 to-purple-950',
    card: 'bg-slate-800/90',
    header: 'bg-purple-700',
    accent: 'text-purple-300',
    btn: 'bg-purple-600 hover:bg-purple-700',
    border: 'border-purple-800',
    badge: 'bg-purple-900/50 text-purple-200',
  },
  forest: {
    bg: 'bg-gradient-to-br from-green-50 to-emerald-100 dark:from-stone-900 dark:to-emerald-950',
    card: 'bg-white/90 dark:bg-stone-800/90',
    header: 'bg-emerald-700',
    accent: 'text-emerald-700 dark:text-emerald-300',
    btn: 'bg-emerald-700 hover:bg-emerald-800',
    border: 'border-emerald-200 dark:border-emerald-800',
    badge: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function isGenericEventName(value) {
  const name = (value || '').trim().toLowerCase()
  return !name || ['event', 'e-event', 'new event', 'untitled event', 'test event'].includes(name)
}

function eventTitle(event) {
  const name = (event?.name || '').trim()
  if (!isGenericEventName(name)) return name
  const text = `${event?.description || ''} ${event?.invite_message || ''}`.toLowerCase()
  if (text.includes('birthday')) return 'Birthday Celebration'
  return 'Special Celebration'
}

function venueText(event) {
  const name = event?.venue_name || event?.venue || event?.location || ''
  const address = event?.venue_address || event?.address || ''
  if (name && address && name !== address) return `${name} · ${address}`
  return name || address
}

function hostText(event) {
  const host = event?.host_name || event?.organizer_name || event?.couples_name || ''
  return isGenericEventName(host) ? '' : host
}

function deadlineText(event) {
  return event?.rsvp_deadline ? fmtDate(event.rsvp_deadline) : ''
}

function scrollToRsvp() {
  document.getElementById('rsvp')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-14 items-center justify-center rounded-2xl bg-teal-400 px-7 py-3.5 text-base font-extrabold text-slate-950 shadow-xl shadow-teal-950/25 transition hover:-translate-y-0.5 hover:bg-teal-300 hover:shadow-2xl hover:shadow-teal-950/30 focus:outline-none focus:ring-4 focus:ring-teal-300/35 disabled:pointer-events-none disabled:opacity-55 ${className}`}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] px-7 py-3.5 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-white/[0.14] focus:outline-none focus:ring-4 focus:ring-teal-300/25 disabled:pointer-events-none disabled:opacity-55 ${className}`}
    >
      {children}
    </button>
  )
}

function EventPoster({ event }) {
  const title = eventTitle(event)
  if (event.invite_cover_image) {
    return (
      <div className="relative mx-auto w-full max-w-[420px]">
        <div className="absolute -inset-5 rounded-[2rem] bg-teal-300/20 blur-3xl" />
        <div className="relative overflow-hidden rounded-[1.6rem] border border-white/[0.14] bg-slate-950 shadow-2xl shadow-black/45">
          <img
            src={event.invite_cover_image}
            alt={`${title} event flyer`}
            className="aspect-[4/5] w-full object-cover"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div className="absolute -inset-5 rounded-[2rem] bg-teal-300/20 blur-3xl" />
      <div className="relative flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-[1.6rem] border border-white/[0.14] bg-[linear-gradient(145deg,#0f172a,#113f46_52%,#14b8a6)] p-8 shadow-2xl shadow-black/45">
        <div className="h-16 w-16 rounded-2xl border border-white/20 bg-white/10" />
        <div>
          <div className="mb-3 text-xs font-extrabold uppercase tracking-[0.28em] text-teal-100">You're invited</div>
          <div className="text-4xl font-extrabold leading-tight text-white sm:text-5xl">{title}</div>
          {event.event_date && <div className="mt-5 text-sm font-semibold text-teal-50">{fmtDate(event.event_date)}</div>}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.07] p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-300/15 text-lg" aria-hidden="true">{icon}</span>
      <div>
        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">{label}</div>
        <div className="mt-1 text-sm font-semibold leading-relaxed text-white sm:text-[15px]">{value}</div>
      </div>
    </div>
  )
}

// ── Question input components ──────────────────────────────────────────────────

function QuestionField({ question, value, onChange }) {
  const baseInput = 'w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20'

  if (question.question_type === 'boolean') {
    return (
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value === 'yes'}
          onChange={(e) => onChange(e.target.checked ? 'yes' : 'no')}
          className="h-5 w-5 accent-teal-500"
        />
        <span className="text-sm font-semibold text-slate-800">{question.question}</span>
        {question.is_required && <span className="text-red-500 text-xs" aria-label="required">*</span>}
      </label>
    )
  }

  if (question.question_type === 'select') {
    let options = []
    try { options = JSON.parse(question.options || '[]') } catch { /* noop */ }
    return (
      <div>
        <label className="mb-2 block text-sm font-bold text-slate-700">
          {question.question}
          {question.is_required && <span className="ml-1 text-red-500" aria-label="required">*</span>}
        </label>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
          required={question.is_required}
        >
          <option value="">Select an option</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }

  // default: text
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">
        {question.question}
        {question.is_required && <span className="ml-1 text-red-500" aria-label="required">*</span>}
      </label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={baseInput}
        placeholder="Your answer"
        required={question.is_required}
      />
    </div>
  )
}

// ── RSVP form ─────────────────────────────────────────────────────────────────

// Shipping address + per-shipment size selectors for the logistics add-on.
// Rendered only when the invite payload includes a `shipping` block.
function ShippingSection({ shipping, addr, setAddr, sizes, setSizes, inputCls, accent }) {
  if (!shipping) return null
  const sa = (k) => (e) => setAddr((p) => ({ ...p, [k]: e.target.value }))
  const withSize = (shipping.shipments || []).filter((s) => s.collect_size)
  return (
    <div className="space-y-3 pt-1">
      <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${accent}`}>Shipping details</div>
      <p className="-mt-1 text-sm text-slate-500">Where should we ship your item(s)?</p>
      <input className={inputCls} placeholder="Street address" value={addr.ship_address1 || ''} onChange={sa('ship_address1')} />
      <input className={inputCls} placeholder="Apartment, suite (optional)" value={addr.ship_address2 || ''} onChange={sa('ship_address2')} />
      <div className="grid grid-cols-2 gap-3">
        <input className={inputCls} placeholder="City" value={addr.ship_city || ''} onChange={sa('ship_city')} />
        <input className={inputCls} placeholder="State / Region" value={addr.ship_state || ''} onChange={sa('ship_state')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className={inputCls} placeholder="Postal code" value={addr.ship_postal || ''} onChange={sa('ship_postal')} />
        <input className={inputCls} placeholder="Country" value={addr.ship_country || ''} onChange={sa('ship_country')} />
      </div>
      {withSize.map((s) => (
        <div key={s.shipment_id}>
          <label className="mb-2 block text-sm font-bold text-slate-700">{s.name} size</label>
          {s.size_options?.length ? (
            <select className={inputCls} value={sizes[s.shipment_id] || ''} onChange={(e) => setSizes((p) => ({ ...p, [s.shipment_id]: e.target.value }))}>
              <option value="">Select a size</option>
              {s.size_options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className={inputCls} value={sizes[s.shipment_id] || ''} onChange={(e) => setSizes((p) => ({ ...p, [s.shipment_id]: e.target.value }))} placeholder="Your size" />
          )}
        </div>
      ))}
    </div>
  )
}

function RSVPForm({ event, theme, onConfirmed }) {
  const t = THEMES[theme] || THEMES.default
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const [choice, setChoice] = useState('')
  const [answers, setAnswers] = useState({})
  const [shipAddr, setShipAddr] = useState({})
  const [sizes, setSizes] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const path = event.rsvp_token
        ? `/api/invite/link/${event.rsvp_token}/rsvp`
        : `/api/invite/${event.id}/rsvp`
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          answers,
          shipping_address: event.shipping ? shipAddr : undefined,
          sizes: event.shipping ? sizes : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || 'Something went wrong — please try again.')
      onConfirmed(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-slate-950">Will you be attending?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">Let the host know so they can prepare your spot and QR admission ticket.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setChoice('yes')}
          className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-teal-300/20 ${choice === 'yes' ? 'border-teal-400 bg-teal-50 shadow-lg shadow-teal-950/5' : 'border-slate-200 bg-white hover:border-teal-200 hover:bg-slate-50'}`}
        >
          <div className="text-lg font-extrabold text-slate-950">Yes, I'll be there</div>
          <div className="mt-1 text-sm text-slate-500">Confirm my RSVP</div>
        </button>
        <button
          type="button"
          onClick={() => setChoice('no')}
          className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-teal-300/20 ${choice === 'no' ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
        >
          <div className="text-lg font-extrabold text-slate-950">Sorry, I can't make it</div>
          <div className="mt-1 text-sm text-slate-500">No ticket needed</div>
        </button>
      </div>

      {choice === 'no' && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          Thanks for letting the host know. This shared RSVP page does not collect declined responses, so there is nothing else to submit here.
        </div>
      )}

      {choice === 'yes' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">First name <span className="text-red-500">*</span></label>
              <input required value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Last name <span className="text-red-500">*</span></label>
              <input required value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
            </div>
          </div>

          {event.rsvp_collect_email !== false && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Email <span className="text-red-500">*</span></label>
              <input required type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="jane@example.com" />
            </div>
          )}

          {event.rsvp_collect_phone && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Phone <span className="text-slate-400">(optional)</span></label>
              <input type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+1 (832) 000-0000" />
            </div>
          )}

          {event.questions?.length > 0 && (
            <div className="space-y-4 pt-1">
              <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>A few quick questions</div>
              {event.questions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={answers[q.id] || ''}
                  onChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))}
                  theme={theme}
                />
              ))}
            </div>
          )}

          <ShippingSection shipping={event.shipping} addr={shipAddr} setAddr={setShipAddr}
            sizes={sizes} setSizes={setSizes} inputCls={inputCls} accent={t.accent} />

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <PrimaryButton type="submit" disabled={loading} className="w-full">
            {loading ? 'Confirming...' : 'Confirm My RSVP'}
          </PrimaryButton>
        </form>
      )}
    </div>
  )
}

// ── Confirmation view ─────────────────────────────────────────────────────────

function ConfirmView({ confirm, event }) {
  const ticketUrl = confirm.qr_token ? `/scan/${confirm.qr_token}` : ''
  return (
    <div className="space-y-5">
      <div>
        <div className="text-2xl font-extrabold text-slate-950">You're all set, {confirm.first_name}.</div>
        <div className="mt-2 text-sm leading-relaxed text-slate-500">{confirm.message || 'Your RSVP has been confirmed. Your personal QR code will be used for admission.'}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-teal-700">Your QR ticket is ready</div>
            <div className="mt-2 text-lg font-extrabold text-slate-950">{eventTitle(event)}</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">{confirm.first_name} {confirm.last_name}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-teal-700">
            Attending
          </div>
        </div>
        {confirm.qr_token && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-center">
            <img
              src={`/api/scan/${confirm.qr_token}/qr.png`}
              alt="Your QR ticket code"
              className="mx-auto h-44 w-44"
            />
            <div className="mt-3 text-xs font-mono font-bold text-slate-500">Ticket ID {confirm.qr_token.split('-')[0].toUpperCase()}</div>
          </div>
        )}
        <div className="mt-4 text-sm font-semibold text-slate-600">Show this at the entrance for check-in.</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {ticketUrl && <a href={ticketUrl} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">View My QR Ticket</a>}
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Save Ticket</button>
        <button
          type="button"
          onClick={() => navigator.share?.({ title: eventTitle(event), url: window.location.href })}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
        >
          Share Invitation
        </button>
      </div>
    </div>
  )
}

function PendingView({ confirm }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
      <div className="text-2xl font-extrabold text-slate-950">Thanks, {confirm.first_name}.</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-600">{confirm.message}</div>
      <div className="mt-4 text-sm font-semibold text-amber-800">
        You'll receive your ticket by email once the host confirms your spot.
      </div>
    </div>
  )
}

function DeclinedView({ confirm }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-2xl font-extrabold text-slate-950">
        Thanks, {confirm.first_name}.
      </div>
      <div className="mt-2 text-sm leading-relaxed text-slate-600">{confirm.message}</div>
      <div className="mt-4 text-sm font-semibold text-slate-500">
        Changed your mind? You can still confirm below until the RSVP deadline.
      </div>
    </div>
  )
}

// ── Personalised (token) RSVP form — confirm or decline ─────────────────────────

function TokenRSVPForm({ event, prefill, token, theme, onDone }) {
  const t = THEMES[theme] || THEMES.default
  const [form, setForm] = useState({
    first_name: prefill.first_name || '',
    last_name: prefill.last_name || '',
    phone: prefill.phone || '',
  })
  const [answers, setAnswers] = useState({})
  const [shipAddr, setShipAddr] = useState({})
  const [sizes, setSizes] = useState({})
  const [loading, setLoading] = useState('')   // '' | 'confirmed' | 'declined'
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const inputCls = 'w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20'
  const lockedCls = 'w-full min-h-12 cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500'

  async function submit(status) {
    setError('')
    if (status === 'confirmed') {
      if (!form.first_name.trim() || !form.last_name.trim()) {
        setError('Please enter your first and last name.')
        return
      }
      const missing = (event.questions || []).find(
        (q) => q.is_required && !(answers[q.id] || '').trim(),
      )
      if (missing) { setError(`Please answer: ${missing.question}`); return }
    }
    setLoading(status)
    try {
      const res = await fetch(`/api/invite/token/${token}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim() || undefined,
          answers,
          shipping_address: event.shipping ? shipAddr : undefined,
          sizes: event.shipping ? sizes : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || 'Something went wrong — please try again.')
      onDone(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading('')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-slate-950">Will you be attending?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">Confirm your spot or let the host know you can't make it.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">First name <span className="text-red-500">*</span></label>
          <input value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">Last name <span className="text-red-500">*</span></label>
          <input value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
        </div>
      </div>

      {prefill.email && (
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">Email</label>
          <input value={prefill.email} disabled readOnly className={lockedCls} />
        </div>
      )}

      {event.rsvp_collect_phone && (
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">Phone <span className="text-slate-400">(optional)</span></label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+1 (832) 000-0000" />
        </div>
      )}

      {event.questions?.length > 0 && (
        <div className="space-y-4 pt-1">
          <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>A few quick questions</div>
          {event.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id] || ''}
              onChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))}
              theme={theme}
            />
          ))}
        </div>
      )}

      <ShippingSection shipping={event.shipping} addr={shipAddr} setAddr={setShipAddr}
        sizes={sizes} setSizes={setSizes} inputCls={inputCls} accent={t.accent} />

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <PrimaryButton
          type="button"
          onClick={() => submit('confirmed')}
          disabled={!!loading}
          className="w-full"
        >
          {loading === 'confirmed' ? 'Confirming...' : 'Confirm My RSVP'}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => submit('declined')}
          disabled={!!loading}
          className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-teal-300/20 disabled:pointer-events-none disabled:opacity-55"
        >
          {loading === 'declined' ? 'Submitting...' : "I Can't Attend"}
        </button>
      </div>
    </div>
  )
}

function GuestHub({ event, accessToken }) {
  const [hub, setHub] = useState(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  const [message, setMessage] = useState('')
  const [chatMessage, setChatMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendingChat, setSendingChat] = useState(false)

  useEffect(() => {
    if (!event?.id || !accessToken) return
    let cancelled = false
    async function load() {
      try {
        const data = await api.guestHub(event.id, accessToken)
        if (!cancelled) { setHub(data); setError(''); setHidden(false) }
      } catch (err) {
        if (cancelled) return
        const msg = err.message || ''
        if (msg.includes('disabled') || msg.includes('accepted')) {
          setHidden(true)
          return
        }
        setError('Event updates are temporarily unavailable.')
      }
    }
    load()
    const id = setInterval(load, 25000)
    return () => { cancelled = true; clearInterval(id) }
  }, [event?.id, accessToken])

  async function sendMessage(e) {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    try {
      const sent = await api.sendGuestDirectMessage(event.id, accessToken, message.trim())
      setHub((h) => h ? { ...h, direct_messages: [...(h.direct_messages || []), sent] } : h)
      setMessage('')
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function sendChat(e) {
    e.preventDefault()
    if (!chatMessage.trim()) return
    setSendingChat(true)
    try {
      const sent = await api.sendGuestChatMessage(event.id, accessToken, chatMessage.trim())
      setHub((h) => h ? { ...h, chat_messages: [...(h.chat_messages || []), sent] } : h)
      setChatMessage('')
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSendingChat(false)
    }
  }

  if (!accessToken || hidden) return null

  return (
    <section className="py-2">
      <div className="mx-auto w-full max-w-[900px] rounded-[1.65rem] border border-white/12 bg-white/[0.08] p-5 text-white shadow-2xl shadow-black/20 backdrop-blur sm:p-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold">Guest Hub</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Your event updates, QR ticket, and messages in one place.</p>
          </div>
          {hub?.guest?.rsvp_status && (
            <span className="w-fit rounded-full bg-teal-300/15 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-teal-100">
              {hub.guest.rsvp_status === 'confirmed' ? 'Attending' : hub.guest.rsvp_status}
            </span>
          )}
        </div>

        {error && <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">{error}</div>}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">Your RSVP</div>
            <div className="mt-3 text-lg font-extrabold">{hub?.guest?.name || 'Guest'}</div>
            {hub?.guest?.table_name && (
              <p className="mt-2 text-sm text-slate-300">
                Table: <span className="font-bold text-white">{hub.guest.table_name}</span>
                {hub.guest.seat_number ? ` · Seat ${hub.guest.seat_number}` : ''}
              </p>
            )}
            {hub?.guest?.qr_token && (
              <a href={`/scan/${hub.guest.qr_token}`} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-teal-400 px-4 py-2 text-sm font-extrabold text-slate-950 hover:bg-teal-300">
                View QR Ticket
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-extrabold">Event Updates</h3>
              {!!hub?.announcements?.length && <span className="rounded-full bg-teal-300/15 px-2.5 py-1 text-xs font-bold text-teal-100">{hub.announcements.length}</span>}
            </div>
            <div className="mt-4 space-y-3">
              {hub?.announcements?.length ? hub.announcements.map((a) => (
                <div key={a.id} className="rounded-xl border border-white/10 bg-slate-950/20 p-3">
                  <div className="font-bold">{a.title}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{a.body}</p>
                </div>
              )) : (
                <p className="text-sm leading-6 text-slate-400">No updates yet. Important event messages will appear here.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.07] p-4">
          <h3 className="text-lg font-extrabold">Message Host</h3>
          <p className="mt-1 text-sm text-slate-300">Have a question for the organizer?</p>
          <div className="mt-4 max-h-56 space-y-2 overflow-auto">
            {hub?.direct_messages?.length ? hub.direct_messages.map((m) => (
              <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.sender_type === 'guest' ? 'ml-auto max-w-[85%] bg-teal-300/15 text-teal-50' : 'mr-auto max-w-[85%] bg-white/10 text-slate-100'}`}>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{m.sender_name}</div>
                <div className="leading-6">{m.body}</div>
              </div>
            )) : (
              <p className="text-sm text-slate-400">No messages yet.</p>
            )}
          </div>
          {hub?.capabilities?.direct_host_messages ? (
            <form onSubmit={sendMessage} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                placeholder="Ask the host a question..."
                className="min-h-11 flex-1 rounded-xl border border-white/15 bg-slate-950/25 px-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20"
              />
              <button disabled={sending || !message.trim()} className="min-h-11 rounded-xl bg-teal-400 px-5 py-2 text-sm font-extrabold text-slate-950 hover:bg-teal-300 disabled:opacity-50">
                {sending ? 'Sending...' : 'Send'}
              </button>
            </form>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/20 px-3 py-2 text-sm text-slate-400">
              {hub?.guest?.rsvp_status === 'confirmed'
                ? 'Message Host is not enabled for this event.'
                : 'Message Host unlocks after your RSVP is confirmed.'}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/20 p-4">
          <h3 className="text-lg font-extrabold">Guest Chat</h3>
          <p className="mt-1 text-sm text-slate-400">A shared space for attending guests.</p>
          {hub?.capabilities?.guest_chat ? (
            <>
              <div className="mt-4 max-h-64 space-y-2 overflow-auto">
                {hub?.chat_messages?.length ? hub.chat_messages.map((m) => (
                  <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.guest_id === hub?.guest?.id ? 'ml-auto max-w-[85%] bg-teal-300/15 text-teal-50' : 'mr-auto max-w-[85%] bg-white/10 text-slate-100'}`}>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{m.sender_name}</div>
                    <div className="leading-6">{m.body}</div>
                  </div>
                )) : (
                  <p className="text-sm text-slate-400">No guest chat messages yet.</p>
                )}
              </div>
              {hub?.capabilities?.guest_chat_posting ? (
                <form onSubmit={sendChat} className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    maxLength={1000}
                    placeholder="Send a message to guests..."
                    className="min-h-11 flex-1 rounded-xl border border-white/15 bg-slate-950/25 px-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20"
                  />
                  <button disabled={sendingChat || !chatMessage.trim()} className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-extrabold text-slate-950 hover:bg-slate-100 disabled:opacity-50">
                    {sendingChat ? 'Sending...' : 'Send'}
                  </button>
                </form>
              ) : (
                <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/20 px-3 py-2 text-sm text-slate-400">
                  Guest Chat posting is paused by the host.
                </div>
              )}
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/20 px-3 py-2 text-sm text-slate-400">
              Guest Chat is not enabled for this event.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvitePage() {
  const { eventId, token, rsvpToken } = useParams()
  const tokenMode = !!token
  const rsvpLinkMode = !!rsvpToken
  const [event, setEvent] = useState(null)
  const [guest, setGuest] = useState(null)
  const [tokenMeta, setTokenMeta] = useState({ deadline_passed: false, already_responded: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(null)

  // Anonymous shared/open links can't know who you are on load, so we remember a
  // prior RSVP in this browser and show an "already RSVP'd" message instead of
  // the form again. (Personal token links are identified server-side, above.)
  const storageKey = tokenMode ? null : `eqr_rsvp:${rsvpToken || eventId}`
  const [prior, setPrior] = useState(() => {
    if (!storageKey || typeof localStorage === 'undefined') return null
    try { const v = localStorage.getItem(storageKey); return v ? JSON.parse(v) : null } catch { return null }
  })
  function handleConfirmed(c) {
    setConfirmed(c)
    if (storageKey && c && typeof localStorage !== 'undefined') {
      try {
        const rec = { rsvp_status: c.rsvp_status, first_name: c.first_name, qr_token: c.qr_token || '' }
        localStorage.setItem(storageKey, JSON.stringify(rec))
        setPrior(rec)
      } catch { /* ignore storage errors */ }
    }
  }

  useEffect(() => {
    const url = tokenMode
      ? `/api/invite/token/${token}`
      : rsvpLinkMode
        ? `/api/invite/link/${rsvpToken}`
        : `/api/invite/${eventId}`
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 410) throw new Error('This event has ended.')
        if (r.status === 404) throw new Error(tokenMode || rsvpLinkMode ? 'This RSVP link is not valid.' : 'Event not found.')
        if (!r.ok) throw new Error('Something went wrong.')
        return r.json()
      })
      .then((data) => {
        if (tokenMode) {
          setEvent(data.event)
          setGuest(data.guest)
          setTokenMeta({ deadline_passed: data.deadline_passed, already_responded: data.already_responded })
        } else {
          setEvent(data)
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [eventId, token, tokenMode, rsvpToken, rsvpLinkMode])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900">
      <div className="text-slate-500 text-sm animate-pulse">Loading…</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900 px-4">
      <div className="text-center space-y-2">
        <div className="text-4xl">😕</div>
        <div className="text-slate-700 dark:text-slate-300 font-semibold">{error}</div>
      </div>
    </div>
  )

  const theme = event.invite_theme || 'default'
  const atCapacity = event.rsvp_capacity != null && event.rsvp_count >= event.rsvp_capacity
  const deadlinePassed = !!event.deadline_passed
  const title = eventTitle(event)
  const dateLabel = fmtDate(event.event_date)
  const timeLabel = fmtTime(event.event_date)
  const venue = venueText(event)
  const host = hostText(event)
  const deadline = deadlineText(event)
  const about = event.description || event.invite_message || 'We are excited to celebrate this special occasion with family and friends. Please RSVP so we can prepare properly for your attendance.'
  const admissionNote = event.admission_note || 'Your RSVP generates a personal QR code. Please bring it with you for check-in at the entrance.'
  const heroWhen = [dateLabel, timeLabel].filter(Boolean).join(' · ')
  const capacityLabel = event.rsvp_capacity != null ? `${event.rsvp_count} / ${event.rsvp_capacity} spots claimed` : ''
  const guestHubToken = confirmed?.rsvp_status === 'confirmed'
    ? confirmed.qr_token
    : tokenMode && tokenMeta.already_responded && guest?.rsvp_status === 'confirmed'
      ? token
      : prior?.rsvp_status === 'confirmed' && prior?.qr_token
        ? prior.qr_token
      : ''
  const hasGuestHub = !!guestHubToken

  let rsvpPanel
  if (confirmed) {
    rsvpPanel = confirmed.rsvp_status === 'declined'
      ? <DeclinedView confirm={confirmed} />
      : confirmed.rsvp_status === 'pending'
        ? <PendingView confirm={confirmed} />
        : <ConfirmView confirm={confirmed} event={event} />
  } else if (tokenMode) {
    rsvpPanel = deadlinePassed ? (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center">
        <div className="text-lg font-extrabold text-slate-800">RSVP has closed for this event.</div>
        {tokenMeta.already_responded && (
          <div className="mt-2 text-sm text-slate-500">
            Your response: <span className="font-bold">{guest?.rsvp_status === 'confirmed' ? 'Attending' : 'Not attending'}</span>
          </div>
        )}
      </div>
    ) : (
      <div className="space-y-5">
        {tokenMeta.already_responded && (
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm leading-relaxed text-teal-900">
            You're currently marked as <span className="font-bold">{guest?.rsvp_status === 'confirmed' ? 'Attending' : 'Not attending'}</span>. You can update your RSVP before the deadline.
          </div>
        )}
        <TokenRSVPForm event={event} prefill={guest} token={token} theme={theme} onDone={setConfirmed} />
      </div>
    )
  } else if (!event.rsvp_enabled) {
    rsvpPanel = (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-600">
        RSVP is not open yet. Check back soon.
      </div>
    )
  } else if (event.invite_mode === 'closed') {
    rsvpPanel = (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center">
        <div className="text-lg font-extrabold text-slate-800">This event is by invitation only.</div>
        <div className="mt-2 text-sm text-slate-500">Please use the personal invite link sent to you.</div>
      </div>
    )
  } else if (deadlinePassed) {
    rsvpPanel = (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-600">
        RSVP has closed for this event.
      </div>
    )
  } else if (atCapacity) {
    rsvpPanel = (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-center text-sm font-bold text-red-700">
        This event is at capacity.
      </div>
    )
  } else if (prior) {
    rsvpPanel = (
      <div className="rounded-3xl border border-teal-200 bg-teal-50 p-5 text-center">
        <div className="text-2xl font-extrabold text-slate-950">You've already RSVP'd{prior.first_name ? `, ${prior.first_name}` : ''}.</div>
        <div className="mt-2 text-sm leading-relaxed text-slate-600">
          {prior.rsvp_status === 'declined'
            ? 'You let the host know you cannot make it.'
            : prior.rsvp_status === 'pending'
              ? 'Your RSVP is awaiting host approval.'
              : prior.qr_token
                ? 'You are on the guest list. Your Guest Hub is available below.'
                : 'You are on the guest list. Your ticket was sent to you.'}
        </div>
        <div className="mt-4 text-sm font-semibold text-slate-500">Need to change it? Contact the host.</div>
      </div>
    )
  } else {
    rsvpPanel = <RSVPForm event={event} theme={theme} onConfirmed={handleConfirmed} />
  }

  return (
    <div className="invite-page min-h-screen bg-[radial-gradient(circle_at_18%_0%,rgba(20,184,166,0.24),transparent_36rem),linear-gradient(140deg,#07111f_0%,#0f172a_48%,#132f38_100%)] text-white">
      <header className="px-5 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between">
          <span className="text-sm font-extrabold uppercase tracking-[0.24em] text-teal-100">You're invited</span>
          <span className="rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/85">Festio</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 pb-16 sm:px-6">
        <section className="grid items-center gap-10 py-7 md:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] md:gap-12 lg:gap-16 lg:py-14">
          <EventPoster event={event} />

          <div className="space-y-8">
            <div>
              <div className="mb-4 text-sm font-extrabold uppercase tracking-[0.24em] text-teal-200">You're invited to</div>
              <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.02] text-white sm:text-6xl lg:text-7xl">{title}</h1>
              {host && <p className="mt-5 text-xl font-semibold text-teal-50">{host}</p>}
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                {event.invite_message || 'Join us for a beautiful evening of celebration, food, memories, and good company.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DetailRow icon="📅" label="When" value={heroWhen} />
              <DetailRow icon="📍" label="Location" value={venue || 'Venue details coming soon'} />
              <DetailRow icon="🎟️" label="Admission" value="QR ticket at entry" />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryButton type="button" onClick={() => document.getElementById(hasGuestHub ? 'guest-hub' : 'rsvp')?.scrollIntoView({ behavior: 'smooth' })}>
                {hasGuestHub ? 'Open Guest Hub' : 'Confirm My RSVP'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth' })}>View Event Details</SecondaryButton>
            </div>
          </div>
        </section>

        {hasGuestHub && (
          <section id="guest-hub" className="scroll-mt-6 py-6">
            <GuestHub event={event} accessToken={guestHubToken} />
          </section>
        )}

        <section id="details" className="grid gap-6 py-8 md:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-xl shadow-black/10 backdrop-blur sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="text-3xl font-extrabold">Event details</h2>
              {capacityLabel && <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-200">{capacityLabel}</span>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailRow icon="📅" label="Date" value={dateLabel} />
              <DetailRow icon="🕐" label="Time" value={timeLabel} />
              <DetailRow icon="📍" label="Venue" value={venue || 'Venue details coming soon'} />
              <DetailRow icon="👤" label="Host" value={host} />
              <DetailRow icon="⏳" label="RSVP deadline" value={deadline} />
              <DetailRow icon="✓" label="Admission note" value={admissionNote} />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-xl shadow-black/10 backdrop-blur sm:p-7">
            <h2 className="text-3xl font-extrabold">About this event</h2>
            <p className="mt-5 text-base leading-8 text-slate-300">{about}</p>
            {event.registry_enabled && event.registry_token && (
              <a href={`/registry/${event.registry_token}`} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15">
                View gift list
              </a>
            )}
          </div>
        </section>

        <section id="rsvp" className="scroll-mt-6 py-9">
          <div className="mx-auto w-full max-w-[680px] rounded-[1.65rem] border border-white/15 bg-white p-5 text-slate-950 shadow-2xl shadow-black/30 sm:p-8">
            {rsvpPanel}
          </div>
        </section>

        {!hasGuestHub && <GuestHub event={event} accessToken={guestHubToken} />}
      </main>

      {!event.is_paid && (
        <footer className="pb-6 text-center text-xs font-semibold text-slate-500">
          Powered by Festio
        </footer>
      )}
    </div>
  )
}
