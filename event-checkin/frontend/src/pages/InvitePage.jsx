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

// ── Question input components ──────────────────────────────────────────────────

function QuestionField({ question, value, onChange, theme }) {
  const t = THEMES[theme] || THEMES.default
  const baseInput = `w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-offset-0 ${t.border}`

  if (question.question_type === 'boolean') {
    return (
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value === 'yes'}
          onChange={(e) => onChange(e.target.checked ? 'yes' : 'no')}
          className="w-4 h-4 accent-current"
        />
        <span className={`text-sm font-medium ${t.accent}`}>{question.question}</span>
        {question.is_required && <span className="text-red-500 text-xs">*</span>}
      </label>
    )
  }

  if (question.question_type === 'select') {
    let options = []
    try { options = JSON.parse(question.options || '[]') } catch { /* noop */ }
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {question.question}
          {question.is_required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
          required={question.is_required}
        >
          <option value="">— Select —</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }

  // default: text
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
        {question.question}
        {question.is_required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={baseInput}
        placeholder="Your answer…"
        required={question.is_required}
      />
    </div>
  )
}

// ── RSVP form ─────────────────────────────────────────────────────────────────

function RSVPForm({ event, theme, onConfirmed }) {
  const t = THEMES[theme] || THEMES.default
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/invite/${event.id}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          answers,
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

  const inputCls = `w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0 ${t.border}`

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">First name *</label>
          <input required value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Last name *</label>
          <input required value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
        </div>
      </div>

      {event.rsvp_collect_email !== false && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Email *</label>
          <input required type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="jane@example.com" />
        </div>
      )}

      {event.rsvp_collect_phone && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Phone (optional)</label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+1 (832) 000-0000" />
        </div>
      )}

      {event.questions?.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className={`text-xs font-semibold uppercase tracking-wide ${t.accent}`}>A few quick questions</div>
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

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className={`w-full rounded-xl py-3 text-white font-bold text-sm tracking-wide transition-colors disabled:opacity-50 ${t.btn}`}
      >
        {loading ? 'Submitting…' : '✉️ RSVP Now'}
      </button>
    </form>
  )
}

// ── Confirmation view ─────────────────────────────────────────────────────────

function ConfirmView({ confirm, event, theme }) {
  const t = THEMES[theme] || THEMES.default
  return (
    <div className="text-center space-y-4 py-4">
      <div className="text-5xl">🎉</div>
      <div>
        <div className="text-xl font-bold text-slate-900 dark:text-white">
          You're on the list, {confirm.first_name}!
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{confirm.message}</div>
      </div>
      <div className={`rounded-xl border px-4 py-3 text-sm ${t.badge} ${t.border}`}>
        Your ticket QR code has been emailed to you. Bring it on the day.
      </div>
      <div className="text-xs text-slate-400 dark:text-slate-500">
        Ticket ID: <code className="font-mono">{confirm.qr_token.split('-')[0].toUpperCase()}</code>
      </div>
    </div>
  )
}

function DeclinedView({ confirm }) {
  return (
    <div className="text-center space-y-3 py-4">
      <div className="text-5xl">💌</div>
      <div className="text-xl font-bold text-slate-900 dark:text-white">
        Thanks, {confirm.first_name}.
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{confirm.message}</div>
      <div className="text-xs text-slate-400 dark:text-slate-500">
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
  const [loading, setLoading] = useState('')   // '' | 'confirmed' | 'declined'
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const inputCls = `w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0 ${t.border}`
  const lockedCls = `w-full rounded-lg border px-3 py-2.5 text-sm bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed ${t.border}`

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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">First name *</label>
          <input value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Last name *</label>
          <input value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
        </div>
      </div>

      {prefill.email && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Email</label>
          <input value={prefill.email} disabled readOnly className={lockedCls} />
        </div>
      )}

      {event.rsvp_collect_phone && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Phone (optional)</label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+1 (832) 000-0000" />
        </div>
      )}

      {event.questions?.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className={`text-xs font-semibold uppercase tracking-wide ${t.accent}`}>A few quick questions</div>
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

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => submit('confirmed')}
          disabled={!!loading}
          className={`w-full rounded-xl py-3 text-white font-bold text-sm tracking-wide transition-colors disabled:opacity-50 ${t.btn}`}
        >
          {loading === 'confirmed' ? 'Confirming…' : '✅ Confirm attendance'}
        </button>
        <button
          type="button"
          onClick={() => submit('declined')}
          disabled={!!loading}
          className="w-full rounded-xl py-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          {loading === 'declined' ? 'Submitting…' : "Can't make it"}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvitePage() {
  const { eventId, token } = useParams()
  const tokenMode = !!token
  const [event, setEvent] = useState(null)
  const [guest, setGuest] = useState(null)
  const [tokenMeta, setTokenMeta] = useState({ deadline_passed: false, already_responded: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(null)

  useEffect(() => {
    const url = tokenMode ? `/api/invite/token/${token}` : `/api/invite/${eventId}`
    fetch(url)
      .then((r) => {
        if (r.status === 410) throw new Error('This event has ended.')
        if (r.status === 404) throw new Error(tokenMode ? 'This invite link is not valid.' : 'Event not found.')
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
  }, [eventId, token, tokenMode])

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
                : <ConfirmView confirm={confirmed} event={event} theme={theme} />
            ) : tokenMode ? (
              /* ── Personalised (closed-mode) invite ── */
              deadlinePassed ? (
                <div className="text-center py-4 space-y-1">
                  <div className="text-3xl">⏰</div>
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
                <div className="text-3xl">🔒</div>
                <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">This event is by invitation only.</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">Please use the personal invite link sent to you.</div>
              </div>
            ) : deadlinePassed ? (
              <div className="text-center py-4 space-y-1">
                <div className="text-3xl">⏰</div>
                <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">RSVP has closed for this event.</div>
              </div>
            ) : atCapacity ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-2">😔</div>
                <div className="text-sm font-semibold text-red-600 dark:text-red-400">This event is at capacity.</div>
              </div>
            ) : (
              <>
                <div className={`text-sm font-bold ${t.accent}`}>RSVP</div>
                <RSVPForm event={event} theme={theme} onConfirmed={setConfirmed} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-600">
        Powered by EventQR
      </div>
    </div>
  )
}
