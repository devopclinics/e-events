import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

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

function eventTitle(event) {
  return event?.name || 'This special event'
}

function venueText(event) {
  return event?.venue || event?.location || event?.address || ''
}

function hostText(event) {
  return event?.host_name || event?.organizer_name || event?.couples_name || ''
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
      className={`inline-flex min-h-12 items-center justify-center rounded-2xl bg-teal-500 px-6 py-3 text-sm font-extrabold text-slate-950 shadow-lg shadow-teal-950/20 transition hover:-translate-y-0.5 hover:bg-teal-300 focus:outline-none focus:ring-4 focus:ring-teal-300/35 disabled:pointer-events-none disabled:opacity-55 ${className}`}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/8 px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-white/14 focus:outline-none focus:ring-4 focus:ring-teal-300/25 disabled:pointer-events-none disabled:opacity-55 ${className}`}
    >
      {children}
    </button>
  )
}

function EventPoster({ event }) {
  const title = eventTitle(event)
  if (event.invite_cover_image) {
    return (
      <div className="relative">
        <div className="absolute -inset-4 rounded-[2rem] bg-teal-300/15 blur-2xl" />
        <div className="relative overflow-hidden rounded-[1.5rem] border border-white/12 bg-slate-950 shadow-2xl shadow-black/35">
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
    <div className="relative">
      <div className="absolute -inset-4 rounded-[2rem] bg-teal-300/15 blur-2xl" />
      <div className="relative flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-[1.5rem] border border-white/12 bg-[linear-gradient(145deg,#0f172a,#113f46_52%,#14b8a6)] p-7 shadow-2xl shadow-black/35">
        <div className="h-16 w-16 rounded-2xl border border-white/20 bg-white/10" />
        <div>
          <div className="mb-3 text-xs font-extrabold uppercase tracking-[0.28em] text-teal-100">You're invited</div>
          <div className="text-4xl font-extrabold leading-tight text-white">{title}</div>
          {event.event_date && <div className="mt-5 text-sm font-semibold text-teal-50">{fmtDate(event.event_date)}</div>}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-300/15 text-lg" aria-hidden="true">{icon}</span>
      <div>
        <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">{label}</div>
        <div className="mt-1 text-sm font-semibold leading-relaxed text-white">{value}</div>
      </div>
    </div>
  )
}

function StatusBox({ children }) {
  return (
    <div className="rounded-2xl border border-teal-300/25 bg-teal-300/10 px-4 py-3 text-sm leading-relaxed text-teal-50">
      {children}
    </div>
  )
}

// ── Question input components ──────────────────────────────────────────────────

function QuestionField({ question, value, onChange, theme }) {
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

function ConfirmView({ confirm, event, theme }) {
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
        const rec = { rsvp_status: c.rsvp_status, first_name: c.first_name }
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
    fetch(url)
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
  const t = THEMES[theme] || THEMES.default
  const atCapacity = event.rsvp_capacity != null && event.rsvp_count >= event.rsvp_capacity
  const deadlinePassed = !!event.deadline_passed

  return (
    <div className={`min-h-screen ${t.bg} flex flex-col`}>
      {/* Header band */}
      <div className={`${t.header} py-3 px-4`}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <span className="text-white/80 text-xs font-semibold tracking-widest uppercase">You're Invited</span>
          <span className="text-white/60 text-xs">EventQR</span>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className={`w-full max-w-lg rounded-2xl shadow-xl border ${t.border} ${t.card} overflow-hidden`}>

          {/* Event hero — cover image as its own banner (no text overlaid),
              with the title/date in a solid band directly below it. */}
          {event.invite_cover_image && (
            <div className="h-48 bg-slate-900 flex items-center justify-center">
              <img
                src={event.invite_cover_image}
                alt={event.name}
                className="w-full h-full object-contain"
              />
            </div>
          )}
          <div className={`${t.header} px-6 py-6 text-white`}>
            <div className="text-2xl font-extrabold leading-tight">{event.name}</div>
            {event.couples_name && (
              <div className="mt-1 text-white/80 text-sm font-medium">{event.couples_name}</div>
            )}
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-white/90">
                <span>📅</span>
                <span>{fmtDate(event.event_date)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-white/90">
                <span>🕐</span>
                <span>{fmtTime(event.event_date)}</span>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-6 space-y-5">
            {/* Custom invite message */}
            {event.invite_message && (
              <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${t.border} ${t.badge}`}>
                {event.invite_message}
              </div>
            )}

            {/* Description */}
            {event.description && (
              <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                {event.description}
              </div>
            )}

            {/* Capacity badge */}
            {event.rsvp_capacity != null && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>👥</span>
                <span>{event.rsvp_count} / {event.rsvp_capacity} spots claimed</span>
                {atCapacity && <span className="font-semibold text-red-500">FULL</span>}
              </div>
            )}

            <hr className={`border-t ${t.border}`} />

            {/* RSVP section */}
            {confirmed ? (
              confirmed.rsvp_status === 'declined'
                ? <DeclinedView confirm={confirmed} />
                : confirmed.rsvp_status === 'pending'
                  ? <PendingView confirm={confirmed} />
                  : <ConfirmView confirm={confirmed} event={event} theme={theme} />
            ) : tokenMode ? (
              /* ── Personalised (closed-mode) invite ── */
              deadlinePassed ? (
                <div className="text-center py-4 space-y-1">
                  <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">RSVP has closed for this event.</div>
                  {tokenMeta.already_responded && (
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      Your response: <span className="font-semibold">{guest?.rsvp_status === 'confirmed' ? 'Attending' : 'Not attending'}</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className={`text-sm font-bold ${t.accent}`}>RSVP</div>
                  {tokenMeta.already_responded && (
                    <div className={`rounded-lg border px-3 py-2 text-xs ${t.badge} ${t.border}`}>
                      You previously responded <span className="font-semibold">{guest?.rsvp_status === 'confirmed' ? '“Attending”' : '“Not attending”'}</span>. You can update it below until the deadline.
                    </div>
                  )}
                  <TokenRSVPForm event={event} prefill={guest} token={token} theme={theme} onDone={setConfirmed} />
                </>
              )
            ) : !event.rsvp_enabled ? (
              <div className="text-center py-4 text-sm text-slate-500 dark:text-slate-400">
                RSVP is not open yet. Check back soon.
              </div>
            ) : event.invite_mode === 'closed' ? (
              <div className="text-center py-4 space-y-1">
                <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">This event is by invitation only.</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">Please use the personal invite link sent to you.</div>
              </div>
            ) : deadlinePassed ? (
              <div className="text-center py-4 space-y-1">
                <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">RSVP has closed for this event.</div>
              </div>
            ) : atCapacity ? (
              <div className="text-center py-4">
                <div className="text-sm font-semibold text-red-600 dark:text-red-400">This event is at capacity.</div>
              </div>
            ) : prior ? (
              <div className="text-center py-4 space-y-2">
                <div className="text-xl font-bold text-slate-900 dark:text-white">You've already RSVP'd{prior.first_name ? `, ${prior.first_name}` : ''}.</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {prior.rsvp_status === 'declined'
                    ? 'You let the host know you can’t make it.'
                    : prior.rsvp_status === 'pending'
                      ? 'Your RSVP is awaiting the host’s approval.'
                      : 'You’re on the guest list — your ticket was sent to you.'}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500">Need to change it? Contact the host.</div>
              </div>
            ) : (
              <>
                <div className={`text-sm font-bold ${t.accent}`}>RSVP</div>
                <RSVPForm event={event} theme={theme} onConfirmed={handleConfirmed} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gift registry link */}
      {event.registry_enabled && event.registry_token && (
        <div className="pb-6 text-center">
          <a href={`/registry/${event.registry_token}`}
            className="inline-flex items-center gap-2 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 shadow-sm">
            View gift list
          </a>
        </div>
      )}

      {/* Footer — branding shown only on free events */}
      {!event.is_paid && (
        <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-600">
          Powered by EventQR
        </div>
      )}
    </div>
  )
}
