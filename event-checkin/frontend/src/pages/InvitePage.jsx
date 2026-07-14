import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { parseUtc } from '../timeutil'

// Format a phone as an international number, defaulting to Nigeria (+234).
// Already-international numbers (starting with +) are kept as-is.
function normalizePhone(raw) {
  const s = (raw || '').trim()
  if (!s) return ''
  if (s.startsWith('+')) return s.replace(/[^\d+]/g, '')
  const digits = s.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('234')) return '+' + digits          // 234... → +234...
  if (digits.startsWith('0')) return '+234' + digits.slice(1) // 080... → +23480...
  return '+234' + digits                                      // bare local → +234...
}

function vapidKeyToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

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

// Render event times in the EVENT's timezone (passed from event.timezone), not
// the viewer's browser zone — otherwise a guest in another region sees a shifted
// time. Falls back to the viewer's zone only when the event has no tz set yet.
function fmtDate(iso, tz) {
  const d = parseUtc(iso)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...(tz && { timeZone: tz }) })
}

function fmtTime(iso, tz) {
  const d = parseUtc(iso)
  if (!d) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', ...(tz && { timeZone: tz, timeZoneName: 'short' }) })
}

function fmtLocalDateTime(value, tz) {
  const d = parseUtc(value)
  if (!d) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz && { timeZone: tz }) })
}

const PASTED_URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi

function LinkifiedText({ text, color }) {
  return String(text || '').split(PASTED_URL_RE).map((part, index) => {
    if (!/^(https?:\/\/|www\.)/i.test(part)) return <span key={index}>{part}</span>
    const trailing = part.match(/[),.!?;:]+$/)?.[0] || ''
    const label = trailing ? part.slice(0, -trailing.length) : part
    const href = /^www\./i.test(label) ? `https://${label}` : label
    return <span key={index}>
      <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-semibold underline decoration-2 underline-offset-2 hover:opacity-80" style={{ color }}>
        {label}
      </a>{trailing}
    </span>
  })
}

function sessionSummary(session = {}) {
  const parts = []
  if (session.topic) parts.push(session.topic)
  if (session.date) parts.push(session.date)
  if (session.start_time || session.end_time) parts.push([session.start_time, session.end_time].filter(Boolean).join('-'))
  if (session.room) parts.push(session.room)
  if (session.speaker) parts.push(`Speaker: ${session.speaker}`)
  return parts.filter(Boolean).join(' · ')
}

function sessionWindowText(session = {}) {
  if (session.checkin_window_minutes === undefined || session.checkin_window_minutes === null || session.checkin_window_minutes === '') return ''
  return `Check-in opens ${session.checkin_window_minutes} min before this session.`
}

function roomAssignmentText(metadata = {}) {
  const assignment = metadata.room_assignment || {}
  const table = assignment.table_name || assignment.table_group_name || ''
  const seat = assignment.seat_number ? `Seat ${assignment.seat_number}` : ''
  return [table, seat].filter(Boolean).join(' · ')
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
  return event?.rsvp_deadline ? fmtDate(event.rsvp_deadline, event?.timezone) : ''
}

function scrollToRsvp() {
  document.getElementById('rsvp')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function designColors(theme) {
  return theme?.colors || {}
}

function designCover(theme, event) {
  return theme?.flyer_image_url || theme?.cover_image_url || event?.invite_cover_image || ''
}

function themedPageBackground(colors) {
  if (!colors?.background) return undefined
  const accent = colors.accent || '#14b8a6'
  const surface = colors.surface || '#0f172a'
  return {
    background: `radial-gradient(circle at 18% 0%, ${accent}38, transparent 36rem), linear-gradient(140deg, ${colors.background} 0%, ${surface} 52%, ${colors.background} 100%)`,
  }
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function isLightColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  return ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000 > 170
}

function readableTone(colors = {}) {
  const background = colors.background || '#07111f'
  const surface = colors.surface || '#0f172a'
  const light = isLightColor(background) && isLightColor(surface)
  return {
    background,
    surface,
    accent: colors.accent || '#14b8a6',
    primary: colors.primary || (light ? '#0f172a' : '#ffffff'),
    text: light ? '#0f172a' : '#ffffff',
    muted: light ? '#475569' : '#cbd5e1',
    label: light ? '#64748b' : '#94a3b8',
    panel: light ? 'rgba(255,255,255,.86)' : 'rgba(255,255,255,.08)',
    panelStrong: light ? 'rgba(255,255,255,.94)' : 'rgba(15,23,42,.42)',
    chip: light ? 'rgba(15,23,42,.07)' : 'rgba(255,255,255,.10)',
    border: light ? 'rgba(15,23,42,.12)' : 'rgba(255,255,255,.12)',
    shadow: light ? 'rgba(15,23,42,.16)' : 'rgba(0,0,0,.28)',
  }
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

function EventPoster({ event, coverImage, colors = {}, titleOverride, inviteLabel }) {
  const title = titleOverride || eventTitle(event)
  if (coverImage) {
    return (
      <div className="relative mx-auto w-full max-w-[420px]">
        <div className="absolute -inset-5 rounded-[2rem] blur-3xl" style={{ background: `${colors.accent || '#14b8a6'}33` }} />
        <div className="relative overflow-hidden rounded-[1.6rem] border border-white/[0.14] bg-slate-950 shadow-2xl shadow-black/45">
          <img
            src={coverImage}
            alt={`${title} event flyer`}
            className="aspect-[4/5] w-full object-contain"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <div className="absolute -inset-5 rounded-[2rem] blur-3xl" style={{ background: `${colors.accent || '#14b8a6'}33` }} />
      <div
        className="relative flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-[1.6rem] border border-white/[0.14] p-8 shadow-2xl shadow-black/45"
        style={{ background: `linear-gradient(145deg, ${colors.background || '#0f172a'}, ${colors.surface || '#113f46'} 52%, ${colors.accent || '#14b8a6'})` }}
      >
        <div className="h-16 w-16 rounded-2xl border border-white/20 bg-white/10" />
        <div>
          <div className="mb-3 text-xs font-extrabold uppercase tracking-[0.28em]" style={{ color: colors.accent || '#ccfbf1' }}>{inviteLabel || "You're invited"}</div>
          <div className="text-4xl font-extrabold leading-tight sm:text-5xl" style={{ color: readableTone(colors).text }}>{title}</div>
          {event.event_date && <div className="mt-5 text-sm font-semibold" style={{ color: readableTone(colors).muted }}>{fmtDate(event.event_date, event.timezone)}</div>}
        </div>
      </div>
    </div>
  )
}

function mapUrl(address) {
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : ''
}

function externalUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

const DEFAULT_PAGE_CONFIG = {
  hero: { showWelcomeLabel: true, showTitle: true, showHost: true },
  organizer: { show: true, label: 'Organized by' },
  details: { showVenue: true, showHotel: true, showHost: true, showAdmission: true },
  about: { show: true, ctaLabel: '' },
}

function publicPageConfig(config = {}) {
  return {
    hero: { ...DEFAULT_PAGE_CONFIG.hero, ...(config.hero || {}) },
    organizer: { ...DEFAULT_PAGE_CONFIG.organizer, ...(config.organizer || {}) },
    details: { ...DEFAULT_PAGE_CONFIG.details, ...(config.details || {}) },
    about: { ...DEFAULT_PAGE_CONFIG.about, ...(config.about || {}) },
  }
}

function DetailRow({ icon, label, value, tone, href }) {
  if (!value) return null
  const t = tone || readableTone()
  return (
    <div className="flex gap-3 rounded-2xl border p-4" style={{ background: t.panel, borderColor: t.border, color: t.text }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: `${t.accent}22` }} aria-hidden="true">{icon}</span>
      <div>
        <div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: t.label }}>{label}</div>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm font-semibold leading-relaxed underline decoration-2 underline-offset-2 hover:opacity-80 sm:text-[15px]" style={{ color: t.accent }}>{value}</a>
          : <div className="mt-1 text-sm font-semibold leading-relaxed sm:text-[15px]" style={{ color: t.text }}>{value}</div>}
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

function SmsConsentCheckbox({ checked, onChange, disabled = false }) {
  return (
    <label className="flex gap-3 rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs leading-relaxed text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-teal-600"
      />
      <span>
        I agree to receive SMS/text messages from Festio for this event, including my invitation or ticket link,
        QR pass, RSVP updates, check-in confirmation, seating updates, session reminders, and other event-service
        notifications. Message frequency varies by event. Message and data rates may apply. Reply HELP for help.
        Reply STOP to opt out at any time. Consent is not required to buy goods or services. View our{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="font-bold text-teal-700 underline">Privacy Policy</a>.
      </span>
    </label>
  )
}

function RSVPForm({ event, theme, onConfirmed }) {
  const t = THEMES[theme] || THEMES.default
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const [smsConsent, setSmsConsent] = useState(false)
  const [choice, setChoice] = useState('')
  const [answers, setAnswers] = useState({})
  const emptyInvitee = () => ({ first_name: '', last_name: '', relationship: '', phone: '', email: '', guest_type: 'Invited Guest', notes: '' })
  const [invitees, setInvitees] = useState([])
  const [shipAddr, setShipAddr] = useState({})
  const [sizes, setSizes] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const multiInvitee = !!event.rsvp_multi_invitee_enabled
  const rawDefaultInviteeLimit = event.rsvp_multi_invitee_limit ?? 10
  const defaultInviteeLimit = Math.max(0, Math.min(Number(rawDefaultInviteeLimit) || 0, 100))
  const inviteeLimitRules = event.rsvp_multi_invitee_limit_rules || {}
  const inviteeLimitRuleEntries = Object.entries(inviteeLimitRules)
    .map(([label, limit]) => [label, Math.max(0, Math.min(Number(limit) || 0, 100))])
    .filter(([label]) => String(label || '').trim())
  const categoryQuestion = multiInvitee && inviteeLimitRuleEntries.length
    ? (event.questions || []).find((q) => /category|allowance|submitter role/i.test(q.question || '') && q.question_type === 'select')
    : null
  const selectedCategory = categoryQuestion ? (answers[categoryQuestion.id] || '') : ''
  const matchedCategoryRule = inviteeLimitRuleEntries.find(([label]) => label.toLowerCase() === selectedCategory.toLowerCase())
  const inviteeLimit = matchedCategoryRule ? matchedCategoryRule[1] : defaultInviteeLimit
  const selectedCategoryKey = selectedCategory.trim().toLowerCase()
  const isSingleInvitedGuestCategory = /\bindividual\b|\bsingle\b/.test(selectedCategoryKey) && /invited guest|guest/.test(selectedCategoryKey)
  const additionalInviteeLimit = isSingleInvitedGuestCategory ? 0 : inviteeLimit
  const needsInviteeCategory = Boolean(categoryQuestion && !selectedCategory)
  const acceptsAdditionalInvitees = !needsInviteeCategory && additionalInviteeLimit > 0
  const submitterOnlyCategory = !needsInviteeCategory && additionalInviteeLimit <= 0
  const collectEmail = event.rsvp_collect_email !== false
  const collectPhone = event.rsvp_collect_phone !== false
  // Per-field required flags (default: submitter email required, all else optional).
  const emailRequired = collectEmail && (event.rsvp_email_required !== false)
  const phoneRequired = collectPhone && !!event.rsvp_phone_required
  const inviteeEmailRequired = collectEmail && !!event.rsvp_invitee_email_required
  const inviteePhoneRequired = collectPhone && !!event.rsvp_invitee_phone_required
  const inviteeTypes = ['Parent/Guardian', 'Invited Guest', 'Teacher', 'School/Staff', 'VIP/Dignitary', 'Other']

  useEffect(() => {
    if (additionalInviteeLimit <= 0) {
      setInvitees([])
      return
    }
    setInvitees((rows) => {
      if (rows.length > additionalInviteeLimit) return rows.slice(0, additionalInviteeLimit)
      if (rows.length === 0) return [emptyInvitee()]
      return rows
    })
  }, [additionalInviteeLimit])

  function setInvitee(index, key, value) {
    setInvitees((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function addInvitee() {
    setInvitees((rows) => rows.length >= additionalInviteeLimit ? rows : [
      ...rows,
      emptyInvitee(),
    ])
  }

  function removeInvitee(index) {
    setInvitees((rows) => rows.length <= 1 ? [emptyInvitee()] : rows.filter((_, i) => i !== index))
  }

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
          phone: normalizePhone(form.phone) || undefined,
          sms_consent: Boolean(form.phone.trim() && smsConsent),
          answers,
          invitees: multiInvitee && acceptsAdditionalInvitees
            ? invitees
                .map((row) => ({
                  first_name: row.first_name.trim(),
                  last_name: row.last_name.trim(),
                  relationship: row.relationship.trim(),
                  phone: normalizePhone(row.phone) || undefined,
                  email: row.email.trim() || undefined,
                  guest_type: row.guest_type,
                  notes: row.notes.trim() || undefined,
                }))
                .filter((row) => row.first_name || row.last_name || row.phone || row.email)
            : [],
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
        <h2 className="text-2xl font-extrabold text-slate-950">{multiInvitee ? 'Submit invited guests' : 'Will you be attending?'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {multiInvitee
            ? 'Submit your RSVP details for review. Approved guests receive their own QR pass.'
            : 'Let the host know so they can prepare your spot and Festio Pass.'}
        </p>
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
              <label className="mb-2 block text-sm font-bold text-slate-700">{multiInvitee ? 'Submitter first name' : 'First name'} <span className="text-red-500">*</span></label>
              <input required value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">{multiInvitee ? 'Submitter last name' : 'Last name'} <span className="text-red-500">*</span></label>
              <input required value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
            </div>
          </div>

          {collectEmail && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">{multiInvitee ? 'Submitter email' : 'Email'} {emailRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}</label>
              <input required={emailRequired} type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="jane@example.com" />
            </div>
          )}

          {collectPhone && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">{multiInvitee ? 'Submitter phone' : 'Phone'} {phoneRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}</label>
              <input required={phoneRequired} type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="0803 000 0000" />
              <p className="mt-1 text-xs text-slate-500">Nigerian number? Just enter it starting with 0 (e.g. 08030000000) — we'll add <span className="font-semibold">+234</span> for you. For another country, type your full number with its + code.</p>
            </div>
          )}

          {event.rsvp_collect_phone && form.phone.trim() && (
            <SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} disabled={loading} />
          )}

          {multiInvitee && (
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                The submitter is the main invited guest and will receive their own QR pass after approval.
                Add only their additional invited guests below.
              </div>
              {categoryQuestion && (
                <div className="rounded-2xl border border-teal-100 bg-white p-4">
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Invitation category <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={selectedCategory}
                    onChange={(e) => setAnswers((p) => ({ ...p, [categoryQuestion.id]: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select category</option>
                    {inviteeLimitRuleEntries.map(([label, limit]) => {
                      const labelKey = label.trim().toLowerCase()
                      const singleGuest = /\bindividual\b|\bsingle\b/.test(labelKey) && /invited guest|guest/.test(labelKey)
                      const effectiveLimit = singleGuest ? 0 : limit
                      return (
                      <option key={label} value={label}>
                        {effectiveLimit <= 0
                          ? `${label} - submitter only`
                          : `${label} - up to ${effectiveLimit} additional guest${effectiveLimit === 1 ? '' : 's'}`}
                      </option>
                    )})}
                  </select>
                  <p className="mt-2 text-xs text-slate-500">
                    The number of additional guests is gated by this category and will also be checked before submission.
                  </p>
                </div>
              )}
              {submitterOnlyCategory && (
                <div className="rounded-2xl border border-teal-100 bg-white px-4 py-3 text-sm leading-relaxed text-slate-600">
                  This category is for the submitter only. No additional guest details are needed.
                </div>
              )}
              {acceptsAdditionalInvitees && (
                <>
                  <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>Additional invited guests</div>
                  <p className="mt-1 text-xs text-slate-500">
                    {needsInviteeCategory
                      ? 'Select an invitation category to see how many additional guests are allowed.'
                      : `Submitter plus up to ${additionalInviteeLimit} additional guest${additionalInviteeLimit === 1 ? '' : 's'}${selectedCategory ? ` for ${selectedCategory}` : ''}. Each approved person gets a separate QR pass.`}
                  </p>
                </div>
                <button type="button" onClick={addInvitee} disabled={needsInviteeCategory || invitees.length >= additionalInviteeLimit}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                  Add additional guest
                </button>
                  </div>
                  {invitees.map((row, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-extrabold text-slate-800">Invitee {index + 1}</div>
                    {invitees.length > 1 && (
                      <button type="button" onClick={() => removeInvitee(index)} className="text-xs font-bold text-red-500">Remove</button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">First name <span className="text-red-500">*</span></label>
                      <input required value={row.first_name} onChange={(e) => setInvitee(index, 'first_name', e.target.value)} className={inputCls} placeholder="Invitee first name" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Last name <span className="text-red-500">*</span></label>
                      <input required value={row.last_name} onChange={(e) => setInvitee(index, 'last_name', e.target.value)} className={inputCls} placeholder="Invitee last name" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Guest type</label>
                      <select value={row.guest_type} onChange={(e) => setInvitee(index, 'guest_type', e.target.value)} className={inputCls}>
                        {inviteeTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Relationship / role</label>
                      <input value={row.relationship} onChange={(e) => setInvitee(index, 'relationship', e.target.value)} className={inputCls} placeholder="Aunt, teacher, chairman, etc." />
                    </div>
                    {collectPhone && (
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Phone {inviteePhoneRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}</label>
                      <input required={inviteePhoneRequired} type="tel" value={row.phone} onChange={(e) => setInvitee(index, 'phone', e.target.value)} className={inputCls} placeholder="+234..." />
                    </div>
                    )}
                    {collectEmail && (
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-bold text-slate-600">
                        Email {inviteeEmailRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
                      </label>
                      <input required={inviteeEmailRequired} type="email" value={row.email} onChange={(e) => setInvitee(index, 'email', e.target.value)} className={inputCls} placeholder="invitee@example.com" />
                    </div>
                    )}
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-bold text-slate-600">Notes</label>
                      <input value={row.notes} onChange={(e) => setInvitee(index, 'notes', e.target.value)} className={inputCls} placeholder="Any seating, protocol, or meal note for this person" />
                    </div>
                  </div>
                </div>
                  ))}
                </>
              )}
            </div>
          )}

          {event.questions?.length > 0 && (
            <div className="space-y-4 pt-1">
              <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>A few quick questions</div>
              {event.questions.filter((q) => q.id !== categoryQuestion?.id).map((q) => (
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
            {loading ? 'Submitting...' : multiInvitee ? 'Submit RSVP for review' : 'Confirm My RSVP'}
          </PrimaryButton>
        </form>
      )}
    </div>
  )
}

// ── Confirmation view ─────────────────────────────────────────────────────────

function ConfirmView({ confirm, event }) {
  const ticketUrl = confirm.qr_token ? `/scan/${confirm.qr_token}` : ''
  // Personal, cross-device Guest Hub link. Unlike the shared RSVP link, this is
  // tied to the guest server-side, so it opens their Hub on any browser/device.
  const hubPath = confirm.invite_token ? `/r/${confirm.invite_token}#guest-hub` : ''
  const hubUrl = hubPath && typeof window !== 'undefined' ? `${window.location.origin}${hubPath}` : ''
  const [copied, setCopied] = useState(false)
  const copyHub = async () => {
    if (!hubUrl) return
    try { await navigator.clipboard.writeText(hubUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }
  return (
    <div className="space-y-5">
      <div>
        <div className="text-2xl font-extrabold text-slate-950">You're all set, {confirm.first_name}.</div>
        <div className="mt-2 text-sm leading-relaxed text-slate-500">{confirm.message || 'Your RSVP has been confirmed. Your personal QR code will be used for admission.'}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-teal-700">Your QR pass is ready</div>
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
              alt="Your QR pass code"
              className="mx-auto h-44 w-44"
            />
            <div className="mt-3 text-xs font-mono font-bold text-slate-500">Ticket ID {confirm.qr_token.split('-')[0].toUpperCase()}</div>
          </div>
        )}
        <div className="mt-4 text-sm font-semibold text-slate-600">Show this at the entrance for check-in.</div>
      </div>
      {hubUrl && (
        <div className="rounded-3xl border border-cyan-200 bg-cyan-50 p-5">
          <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-cyan-700">Your FestioHub</div>
          <div className="mt-2 text-sm font-semibold text-slate-600">
            Message the host, read announcements, and see your table — from any device. Save this personal link to come back anytime:
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <a href={hubPath} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-500">Open my FestioHub</a>
            <button type="button" onClick={copyHub} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-300 bg-white px-4 py-2 text-sm font-bold text-cyan-700 transition hover:bg-cyan-100">
              {copied ? 'Link copied ✓' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {ticketUrl && <a href={ticketUrl} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">View My Festio Pass</a>}
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
  const [smsConsent, setSmsConsent] = useState(Boolean(prefill.sms_consent && prefill.phone))
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
          phone: normalizePhone(form.phone) || undefined,
          sms_consent: Boolean(form.phone.trim() && smsConsent),
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

      {event.rsvp_collect_phone && form.phone.trim() && (
        <SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} disabled={!!loading} />
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

function GuestHub({ event, accessToken, designTheme }) {
  const [hub, setHub] = useState(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  const [message, setMessage] = useState('')
  const [chatMessage, setChatMessage] = useState('')
  const [programDay, setProgramDay] = useState('')
  const [sending, setSending] = useState(false)
  const [sendingChat, setSendingChat] = useState(false)
  // Experience journey (only populated when the event has Experience enabled).
  const [journey, setJourney] = useState(null)
  const [signName, setSignName] = useState('')
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [feedbackForms, setFeedbackForms] = useState([])
  const [feedbackAnswers, setFeedbackAnswers] = useState({})
  const [feedbackBusy, setFeedbackBusy] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const [editingFeedback, setEditingFeedback] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installState, setInstallState] = useState('')
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const [pushConfig, setPushConfig] = useState(null)
  const [pushState, setPushState] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    const capture = (e) => { e.preventDefault(); setInstallPrompt(e); window.__festioInstallPrompt = e }
    const ready = () => setInstallPrompt(window.__festioInstallPrompt || null)
    const installed = () => { setInstallPrompt(null); setInstallState('installed') }
    setInstallPrompt(window.__festioInstallPrompt || null)
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('festio-install-ready', ready)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('festio-install-ready', ready)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  useEffect(() => {
    if (!accessToken) return
    try {
      localStorage.setItem('festio:installed-guest-hub', `${window.location.pathname}${window.location.search}#guest-hub`)
    } catch { /* installation remains optional in private browsing */ }
  }, [accessToken])

  useEffect(() => {
    if (!installPrompt || sessionStorage.getItem('festio:install-prompt-dismissed')) return
    const timer = setTimeout(() => setShowInstallDialog(true), 900)
    return () => clearTimeout(timer)
  }, [installPrompt])

  const loadPush = useCallback(async () => {
    if (!event?.id || !accessToken || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    try {
      const config = await api.guestPushConfig(event.id, accessToken)
      if (!config.enabled || !config.public_key) {
        setPushConfig(null)
        return
      }
      setPushConfig(config)
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setPushState(subscription ? 'enabled' : Notification.permission === 'denied' ? 'blocked' : 'ready')
    } catch {
      // Push is optional. Keep the pass, QR, and event updates working normally.
      setPushConfig(null)
    }
  }, [event?.id, accessToken])

  useEffect(() => { loadPush() }, [loadPush])

  function dismissInstall() {
    sessionStorage.setItem('festio:install-prompt-dismissed', '1')
    setShowInstallDialog(false)
  }

  async function installPass() {
    if (!installPrompt) return
    installPrompt.prompt()
    const result = await installPrompt.userChoice.catch(() => null)
    setInstallState(result?.outcome === 'accepted' ? 'installed' : '')
    setInstallPrompt(null)
    setShowInstallDialog(false)
  }

  async function enablePush() {
    if (!pushConfig?.public_key || pushBusy) return
    setPushBusy(true)
    setPushError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState(permission === 'denied' ? 'blocked' : 'ready')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToUint8Array(pushConfig.public_key) })
      await api.saveGuestPushSubscription(event.id, accessToken, subscription.toJSON())
      setPushState('enabled')
    } catch (err) {
      setPushError(err.message || 'Notifications could not be enabled on this device.')
    } finally {
      setPushBusy(false)
    }
  }

  async function disablePush() {
    if (pushBusy) return
    setPushBusy(true)
    setPushError('')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api.removeGuestPushSubscription(event.id, accessToken, subscription.endpoint)
        await subscription.unsubscribe()
      }
      setPushState('ready')
    } catch (err) {
      setPushError(err.message || 'Notifications could not be turned off on this device.')
    } finally {
      setPushBusy(false)
    }
  }

  const loadJourney = useCallback(async () => {
    if (!event?.id || !accessToken) return
    try {
      const data = await api.guestExperience(event.id, accessToken)
      setJourney(data)
    } catch { /* journey is best-effort; keep the rest of the Hub working */ }
  }, [event?.id, accessToken])

  useEffect(() => { loadJourney() }, [loadJourney])
  useEffect(() => {
    if (!event?.id || !accessToken) return undefined
    const timer = setInterval(loadJourney, 30000)
    return () => clearInterval(timer)
  }, [event?.id, accessToken, loadJourney])

  const loadFeedback = useCallback(async () => {
    if (!event?.id || !accessToken) return
    try {
      const data = await api.guestFeedback(event.id, accessToken)
      setFeedbackForms(data.forms || [])
      setFeedbackAnswers(Object.fromEntries((data.forms || []).map((form) => [form.step_id, form.answers || {}])))
    } catch { setFeedbackForms([]) }
  }, [event?.id, accessToken])

  useEffect(() => { loadFeedback() }, [loadFeedback])
  useEffect(() => {
    if (!feedbackForms.length || new URLSearchParams(window.location.search).get('focus') !== 'feedback') return
    const timer = setTimeout(() => document.getElementById('feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    return () => clearTimeout(timer)
  }, [feedbackForms])

  async function submitFeedback(e, form) {
    e.preventDefault()
    setFeedbackBusy(form.step_id)
    setFeedbackError('')
    try {
      await api.submitGuestFeedback(event.id, accessToken, {
        step_id: form.step_id,
        answers: feedbackAnswers[form.step_id] || {},
      })
      setEditingFeedback('')
      await Promise.all([loadFeedback(), loadJourney()])
    } catch (err) {
      setFeedbackError(err.message)
    } finally {
      setFeedbackBusy('')
    }
  }

  async function submitConsent(e) {
    e.preventDefault()
    const name = signName.trim()
    if (!name) return
    setSigning(true)
    setSignError('')
    try {
      await api.signGuestConsent(event.id, accessToken, { signer_name: name, signature_text: name })
      setSignName('')
      await loadJourney()
    } catch (err) {
      setSignError(err.message)
    } finally {
      setSigning(false)
    }
  }

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
  const colors = designColors(designTheme)
  const tone = readableTone(colors)
  const hasRsvp = event?.rsvp_enabled !== false
  const programDays = journey?.program?.days || []
  const selectedProgramDay = programDays.find((day) => day.date === programDay)
    || programDays.find((day) => day.segments?.some((segment) => segment.active))
    || programDays.find((day) => day.segments?.some((segment) => new Date(segment.ends_at) > new Date()))
    || programDays[0]

  return (
    <section className="py-2">
      <div
        className="mx-auto w-full max-w-[900px] rounded-[1.65rem] border p-5 shadow-2xl backdrop-blur sm:p-7"
        style={{ background: `linear-gradient(145deg, ${tone.background}, ${tone.surface})`, borderColor: tone.border, color: tone.text, boxShadow: `0 22px 48px ${tone.shadow}` }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold">FestioHub</h2>
            <p className="mt-2 text-sm leading-6" style={{ color: tone.muted }}>Your event updates, QR pass, and messages in one place.</p>
          </div>
          {hasRsvp && hub?.guest?.rsvp_status && (
            <span className="w-fit rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide" style={{ background: `${tone.accent}22`, color: tone.text }}>
              {hub.guest.rsvp_status === 'confirmed' ? 'Attending' : hub.guest.rsvp_status}
            </span>
          )}
        </div>

        {showInstallDialog && (
          <div role="dialog" aria-modal="true" aria-labelledby="install-guest-hub" className="mt-5 rounded-2xl border p-5 shadow-xl" style={{ background: tone.panelStrong, borderColor: tone.accent }}>
            <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: tone.accent, color: tone.background }}>F</span><div><h3 id="install-guest-hub" className="text-lg font-extrabold">Install FestioHub</h3><p className="mt-1 text-sm leading-6" style={{ color: tone.muted }}>Keep your Festio Pass on your home screen for quick access to your QR code and event updates.</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={installPass} className="min-h-11 rounded-xl px-4 py-2 text-sm font-extrabold text-slate-950" style={{ background: tone.accent }}>Install Festio</button><button type="button" onClick={dismissInstall} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold" style={{ borderColor: tone.border, color: tone.text }}>Not now</button></div>
          </div>
        )}

        <div className="mt-5 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-extrabold">Add your Festio Pass to this phone</div>
              <p className="mt-1 text-sm" style={{ color: tone.muted }}>Open FestioHub like an app and keep your QR pass available when venue internet is weak.</p>
            </div>
            {installPrompt ? (
              <button type="button" onClick={installPass} className="min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-extrabold text-slate-950" style={{ background: tone.accent }}>Add to Home Screen</button>
            ) : installState === 'installed' ? (
              <span className="shrink-0 rounded-xl px-4 py-2 text-sm font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>Installed ✓</span>
            ) : (
              <p className="shrink-0 text-xs font-semibold sm:max-w-52" style={{ color: tone.label }}>On iPhone/iPad: Share → Add to Home Screen. On Android, use your browser menu.</p>
            )}
          </div>
        </div>

        {pushConfig && <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-extrabold">Event notifications</div>
              <p className="mt-1 text-sm" style={{ color: tone.muted }}>Receive event updates and host replies directly on this device.</p>
            </div>
            {pushState === 'enabled' ? <button type="button" onClick={disablePush} disabled={pushBusy} className="min-h-11 shrink-0 rounded-xl border px-4 py-2 text-sm font-extrabold disabled:opacity-60" style={{ borderColor: tone.border, color: tone.text }}>{pushBusy ? 'Updating…' : 'Notifications on ✓'}</button>
              : pushState === 'blocked' ? <span className="shrink-0 text-xs font-semibold sm:max-w-52" style={{ color: tone.label }}>Notifications are blocked in your browser settings.</span>
              : <button type="button" onClick={enablePush} disabled={pushBusy} className="min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-extrabold text-slate-950 disabled:opacity-60" style={{ background: tone.accent }}>{pushBusy ? 'Enabling…' : 'Enable notifications'}</button>}
          </div>
          {pushError && <p className="mt-2 text-xs font-semibold text-amber-200">{pushError}</p>}
        </div>}

        {error && <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">{error}</div>}

        {journey?.program?.enabled && <div className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-extrabold">Live Program</h3><p className="mt-1 text-sm" style={{ color: tone.muted }}>The program updates automatically as the event moves forward.</p></div><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>LIVE</span></div>
          {journey.program.current_segments?.length ? <div className="mt-4 space-y-2">{journey.program.current_segments.map((segment) => <div key={segment.step_id} className="rounded-xl border p-3" style={{ background: tone.chip, borderColor: tone.border }}><div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>Happening now{segment.category ? ` · ${segment.category}` : ''}</div><div className="mt-1 font-extrabold">{segment.title}</div>{segment.description && <p className="mt-1 text-sm" style={{ color: tone.muted }}>{segment.description}</p>}<p className="mt-2 text-xs font-semibold" style={{ color: tone.label }}>Until {fmtTime(segment.ends_at, event?.timezone)}</p></div>)}</div> : <p className="mt-4 text-sm" style={{ color: tone.muted }}>The next program item will appear here when it begins.</p>}
          {!!journey.program.next_segments?.length && <div className="mt-4 border-t pt-3" style={{ borderColor: tone.border }}><div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>Up next</div>{journey.program.next_segments.slice(0, 2).map((segment) => <div key={segment.step_id} className="mt-2 text-sm"><span className="font-bold">{fmtLocalDateTime(segment.starts_at, event?.timezone)}</span><span style={{ color: tone.muted }}> · {segment.title}</span></div>)}</div>}
          {!!selectedProgramDay && <div className="mt-4 border-t pt-3" style={{ borderColor: tone.border }}>
            <div className="flex flex-wrap gap-2" aria-label="Programme day">
              {programDays.map((day) => <button key={day.date} type="button" onClick={() => setProgramDay(day.date)} className="rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ background: selectedProgramDay.date === day.date ? tone.accent : tone.chip, color: selectedProgramDay.date === day.date ? tone.background : tone.text }}>{day.label}</button>)}
            </div>
            <div className="mt-3 text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>{selectedProgramDay.label} programme</div>
            <div className="mt-2 divide-y" style={{ borderColor: tone.border }}>
              {selectedProgramDay.segments.map((segment) => <div key={segment.step_id} className="py-3 first:pt-0 last:pb-0"><div className="flex gap-3"><div className="w-24 shrink-0 text-xs font-extrabold" style={{ color: segment.active ? tone.accent : tone.label }}>{fmtTime(segment.starts_at, event?.timezone)}–{fmtTime(segment.ends_at, event?.timezone)}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-bold">{segment.title}{segment.active && <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase" style={{ background: `${tone.accent}22`, color: tone.accent }}>Now</span>}</div>{segment.description && <p className="mt-1 text-sm" style={{ color: tone.muted }}>{segment.description}</p>}</div></div></div>)}
            </div>
          </div>}
        </div>}

        {journey?.experience_enabled && journey.steps?.length > 0 && (() => {
          const visible = journey.steps.filter((s) => s.status !== 'skipped')
          const remaining = journey.next_steps?.length || 0
          const done = journey.completed_count || 0
          const total = journey.total_count || visible.length
          const progress = total ? Math.round((done / total) * 100) : 0
          const consent = journey.consent
          const needsConsent = consent?.required && !consent.signed
          const statusMeta = (s) => {
            if (s.status === 'completed' || s.status === 'overridden') return { icon: '✓', chip: 'Done', done: true, tone: tone.accent }
            if (s.status === 'blocked') return { icon: '•', chip: 'Locked', done: false, tone: tone.label }
            return { icon: '○', chip: s.actionable ? 'Action needed' : 'Upcoming', done: false, tone: s.actionable ? tone.accent : tone.label }
          }
          const detailText = (s, m) => {
            if (m.done) return s.completion_message || s.guest_message || s.description || ''
            return s.guest_message || s.description || ''
          }
          return (
            <div className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-extrabold">Your activity</h3>
                  <p className="mt-1 text-sm" style={{ color: tone.muted }}>Track your Experience progress from check-in through each event step.</p>
                </div>
                <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>{done}/{total} done</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: `${tone.accent}22` }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(progress, 100)}%`, background: tone.accent }} />
              </div>
              {remaining > 0 && (
                <div className="mt-4 rounded-xl border p-3" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                  <div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>Current next steps</div>
                  <div className="mt-2 space-y-2">
                    {journey.next_steps.slice(0, 4).map((s) => {
                      const sessionInfo = s.session ? sessionSummary(s.session) : ''
                      return (
                        <div key={s.id} className="rounded-lg px-3 py-2 text-sm" style={{ background: tone.chip }}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold">{s.title}</span>
                            {s.self_service ? <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: tone.accent }}>Guest action</span> : <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: tone.label }}>Staff assisted</span>}
                          </div>
                          {(s.guest_message || s.description) && <p className="mt-1 leading-5" style={{ color: tone.muted }}>{s.guest_message || s.description}</p>}
                          {sessionInfo && <p className="mt-1 text-xs font-bold" style={{ color: tone.text }}>{sessionInfo}</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <ol className="mt-4 space-y-2">
                {visible.map((s) => {
                  const m = statusMeta(s)
                  const sessionInfo = s.session ? sessionSummary(s.session) : ''
                  const roomInfo = roomAssignmentText(s.metadata || {})
                  const checkedInAt = s.metadata?.session_checked_in_at ? fmtLocalDateTime(s.metadata.session_checked_in_at, event?.timezone) : ''
                  const copy = detailText(s, m)
                  return (
                    <li key={s.id} className="flex items-start gap-3 rounded-xl border p-3" style={{ background: tone.chip, borderColor: s.actionable ? tone.accent : tone.border }}>
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: m.done ? tone.accent : `${tone.accent}22`, color: m.done ? tone.background : tone.text }}>{m.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold">{s.title}{s.required ? '' : <span className="ml-1 text-xs font-normal" style={{ color: tone.label }}>(optional)</span>}</span>
                          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide" style={{ color: m.tone }}>{m.chip}</span>
                        </div>
                        {copy && <p className="mt-1 text-sm leading-6" style={{ color: tone.muted }}>{copy}</p>}
                        {sessionInfo && <p className="mt-2 rounded-lg px-3 py-2 text-xs font-bold" style={{ background: tone.panel, color: tone.text }}>{sessionInfo}</p>}
                        {s.session && sessionWindowText(s.session) && <p className="mt-1 text-xs" style={{ color: tone.label }}>{sessionWindowText(s.session)}</p>}
                        {roomInfo && <p className="mt-2 text-sm font-bold" style={{ color: tone.text }}>Assignment: {roomInfo}</p>}
                        {checkedInAt && <p className="mt-1 text-xs" style={{ color: tone.label }}>Session check-in recorded {checkedInAt}</p>}
                        {s.completed_at && !checkedInAt && <p className="mt-1 text-xs" style={{ color: tone.label }}>Completed {fmtLocalDateTime(s.completed_at, event?.timezone)}</p>}
                      </div>
                    </li>
                  )
                })}
              </ol>

              {consent?.form && (
                <div className="mt-4 rounded-xl border p-4" style={{ background: tone.panelStrong, borderColor: needsConsent ? tone.accent : tone.border }}>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-extrabold">{consent.form.title}</h4>
                    {consent.signed && <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide" style={{ color: tone.accent }}>Signed</span>}
                  </div>
                  <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-sm leading-6" style={{ color: tone.muted }}>{consent.form.body}</div>
                  {consent.signed ? (
                    <p className="mt-3 text-sm" style={{ color: tone.label }}>Thank you — your consent has been recorded{consent.signed_at ? ` on ${new Date(consent.signed_at).toLocaleDateString()}` : ''}.</p>
                  ) : (
                    <form onSubmit={submitConsent} className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        value={signName}
                        onChange={(e) => setSignName(e.target.value)}
                        maxLength={255}
                        placeholder="Type your full name to sign"
                        className="min-h-11 flex-1 rounded-xl border px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20"
                        style={{ background: tone.panel, borderColor: tone.border, color: tone.text }}
                      />
                      <button disabled={signing || !signName.trim()} style={colors.accent ? { background: colors.accent } : undefined} className="min-h-11 rounded-xl bg-teal-400 px-5 py-2 text-sm font-extrabold text-slate-950 hover:bg-teal-300 disabled:opacity-50">
                        {signing ? 'Signing...' : 'Sign & agree'}
                      </button>
                    </form>
                  )}
                  {signError && <p className="mt-2 text-sm text-amber-400">{signError}</p>}
                </div>
              )}
            </div>
          )
        })()}

        {feedbackForms.map((form, formIndex) => (
          <div id={formIndex === 0 ? 'feedback' : undefined} key={form.step_id} className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold">{form.title}</h3>
                {form.description && <p className="mt-1 text-sm" style={{ color: tone.muted }}>{form.description}</p>}
              </div>
              {form.submitted && <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>Completed</span>}
            </div>
            {form.submitted && editingFeedback !== form.step_id ? (
              <div className="mt-4 rounded-xl border p-3 text-sm" style={{ background: tone.chip, borderColor: tone.border, color: tone.muted }}><p>Thank you—your feedback has been recorded.</p>{form.can_edit && <button type="button" onClick={() => setEditingFeedback(form.step_id)} className="mt-2 font-bold underline">Edit response</button>}</div>
            ) : (
              <form onSubmit={(e) => submitFeedback(e, form)} className="mt-4 space-y-4">
                {form.questions.map((question) => {
                  const answers = feedbackAnswers[form.step_id] || {}
                  const value = answers[question.id] ?? ''
                  const setAnswer = (next) => setFeedbackAnswers((all) => ({ ...all, [form.step_id]: { ...(all[form.step_id] || {}), [question.id]: next } }))
                  const condition = question.show_if
                  const sourceValue = condition ? answers[condition.question_id] : undefined
                  if (condition && !(Array.isArray(sourceValue) ? sourceValue.map(String).includes(String(condition.value)) : String(sourceValue ?? '').toLowerCase() === String(condition.value).toLowerCase())) return null
                  return (
                    <label key={question.id} className="block rounded-xl border p-3" style={{ background: tone.chip, borderColor: tone.border }}>
                      <span className="block text-sm font-bold">{question.prompt}{question.required ? ' *' : ''}</span>
                      {question.help_text && <span className="mt-1 block text-xs" style={{ color: tone.muted }}>{question.help_text}</span>}
                      {question.type === 'text' && <textarea rows={3} value={value} onChange={(e) => setAnswer(e.target.value)} className="mt-2 w-full rounded-lg border px-3 py-2 text-sm" style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }} />}
                      {(question.type === 'rating' || question.type === 'nps') && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Array.from({ length: question.type === 'rating' ? 5 : 11 }, (_, i) => question.type === 'rating' ? i + 1 : i).map((score) => (
                            <button key={score} type="button" onClick={() => setAnswer(score)}
                              className="h-10 min-w-10 rounded-lg border px-2 text-sm font-bold"
                              style={{ background: Number(value) === score ? tone.accent : tone.panelStrong, borderColor: tone.border, color: Number(value) === score ? tone.background : tone.text }}>{score}</button>
                          ))}
                        </div>
                      )}
                      {question.type === 'single_choice' && (
                        <select value={value} onChange={(e) => setAnswer(e.target.value)} className="mt-2 min-h-11 w-full rounded-lg border px-3 py-2 text-sm" style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }}>
                          <option value="">Select an answer</option>
                          {(question.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      )}
                      {question.type === 'multi_choice' && <div className="mt-2 grid gap-2">{(question.options || []).map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(Array.isArray(value) ? value : []).includes(option)} onChange={(e) => setAnswer(e.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value : []).filter((v) => v !== option))} /> {option}</label>)}</div>}
                      {question.type === 'yes_no' && (
                        <div className="mt-2 flex gap-2">{['yes', 'no'].map((choice) => <button key={choice} type="button" onClick={() => setAnswer(choice)} className="rounded-lg border px-4 py-2 text-sm font-bold capitalize" style={{ background: value === choice ? tone.accent : tone.panelStrong, borderColor: tone.border, color: value === choice ? tone.background : tone.text }}>{choice}</button>)}</div>
                      )}
                    </label>
                  )
                })}
                {feedbackError && <p className="text-sm text-amber-300">{feedbackError}</p>}
                <button disabled={feedbackBusy === form.step_id} className="min-h-11 rounded-xl px-5 py-2 text-sm font-extrabold" style={{ background: tone.accent, color: tone.background }}>
                  {feedbackBusy === form.step_id ? 'Submitting…' : form.submitted ? 'Save changes' : 'Submit feedback'}
                </button>
              </form>
            )}
          </div>
        ))}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>{hasRsvp ? 'Your RSVP' : 'Your pass'}</div>
            <div className="mt-3 text-lg font-extrabold">{hub?.guest?.name || 'Guest'}</div>
            {hub?.guest?.table_name && (
              <p className="mt-2 text-sm" style={{ color: tone.muted }}>
                Table: <span className="font-bold" style={{ color: tone.text }}>{hub.guest.table_name}</span>
                {hub.guest.seat_number ? ` · Seat ${hub.guest.seat_number}` : ''}
              </p>
            )}
            {hub?.guest?.qr_token && (
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border p-3 text-center" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                  <img
                    src={`/api/scan/${hub.guest.qr_token}/qr.png`}
                    alt="Your QR pass code"
                    className="mx-auto h-44 w-44 rounded-xl bg-white p-2"
                  />
                  <div className="mt-2 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: tone.label }}>
                    Show this code at entry
                  </div>
                </div>
                <a href={`/scan/${hub.guest.qr_token}`} style={colors.accent ? { background: colors.accent } : undefined} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-5 py-3 text-base font-extrabold text-slate-950 shadow-sm hover:bg-teal-300">
                  🎫 View Festio Pass
                </a>
                {hub?.capabilities?.festiome && (
                  <a
                    href={`/festiome/guest?event=${encodeURIComponent(event.id)}&pass=${encodeURIComponent(hub.guest.qr_token)}`}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 px-5 py-3 text-base font-extrabold transition hover:opacity-90"
                    style={{ background: tone.chip, borderColor: colors.accent || tone.text, color: tone.text }}
                  >
                    💬 Open FestioMe
                  </a>
                )}
              </div>
            )}
            {event?.registry_enabled && event?.registry_token && (
              <a href={`/registry/${event.registry_token}`} className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition hover:opacity-90" style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}>
                🎁 View gift list
              </a>
            )}
          </div>

          <div className="rounded-2xl border p-4 md:col-span-2" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-extrabold">Event Updates</h3>
              {!!hub?.announcements?.length && <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>{hub.announcements.length}</span>}
            </div>
            <div className="mt-4 space-y-3">
              {hub?.announcements?.length ? hub.announcements.map((a) => (
                <div key={a.id} className="rounded-xl border p-3" style={{ background: tone.chip, borderColor: tone.border }}>
                  <div className="font-bold">{a.title}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6" style={{ color: tone.muted }}><LinkifiedText text={a.body} color={tone.accent} /></p>
                </div>
              )) : (
                <p className="text-sm leading-6" style={{ color: tone.label }}>No updates yet. Important event messages will appear here.</p>
              )}
            </div>
          </div>
        </div>

        {(event?.hotel_name || event?.hotel_address) && <div className="mt-4 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>🏨 Hotel information</div>
          {event.hotel_name && <div className="mt-2 text-lg font-extrabold">{event.hotel_name}</div>}
          {event.hotel_address && <a href={mapUrl(event.hotel_address)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold leading-6 underline decoration-2 underline-offset-2 hover:opacity-80" style={{ color: tone.accent }}>{event.hotel_address}</a>}
        </div>}

        <div className="mt-4 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <h3 className="text-lg font-extrabold">Message Host</h3>
          <p className="mt-1 text-sm" style={{ color: tone.muted }}>Have a question for the organizer?</p>
          <div className="mt-4 max-h-56 space-y-2 overflow-auto">
            {hub?.direct_messages?.length ? hub.direct_messages.map((m) => (
              <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.sender_type === 'guest' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`} style={{ background: m.sender_type === 'guest' ? `${tone.accent}22` : tone.chip, color: tone.text }}>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: tone.label }}>{m.sender_name}</div>
                <div className="whitespace-pre-wrap leading-6"><LinkifiedText text={m.body} color={tone.accent} /></div>
              </div>
            )) : (
              <p className="text-sm" style={{ color: tone.label }}>No messages yet.</p>
            )}
          </div>
          {hub?.capabilities?.direct_host_messages ? (
            <form onSubmit={sendMessage} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                placeholder="Ask the host a question..."
                className="min-h-11 flex-1 rounded-xl border px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20"
                style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }}
              />
              <button disabled={sending || !message.trim()} style={colors.accent ? { background: colors.accent } : undefined} className="min-h-11 rounded-xl bg-teal-400 px-5 py-2 text-sm font-extrabold text-slate-950 hover:bg-teal-300 disabled:opacity-50">
                {sending ? 'Sending...' : 'Send'}
              </button>
            </form>
          ) : (
            <div className="mt-4 rounded-xl border px-3 py-2 text-sm" style={{ background: tone.chip, borderColor: tone.border, color: tone.label }}>
              {hasRsvp && hub?.guest?.rsvp_status !== 'confirmed'
                ? 'Message Host unlocks after your RSVP is confirmed.'
                : 'Message Host is not enabled for this event.'}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <h3 className="text-lg font-extrabold">Guest Chat</h3>
          <p className="mt-1 text-sm" style={{ color: tone.label }}>A shared space for attending guests.</p>
          {hub?.capabilities?.guest_chat ? (
            <>
              <div className="mt-4 max-h-64 space-y-2 overflow-auto">
                {hub?.chat_messages?.length ? hub.chat_messages.map((m) => (
                  <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.guest_id === hub?.guest?.id ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`} style={{ background: m.guest_id === hub?.guest?.id ? `${tone.accent}22` : tone.chip, color: tone.text }}>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: tone.label }}>{m.sender_name}</div>
                    <div className="leading-6">{m.body}</div>
                  </div>
                )) : (
                  <p className="text-sm" style={{ color: tone.label }}>No guest chat messages yet.</p>
                )}
              </div>
              {hub?.capabilities?.guest_chat_posting ? (
                <form onSubmit={sendChat} className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    maxLength={1000}
                    placeholder="Send a message to guests..."
                    className="min-h-11 flex-1 rounded-xl border px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20"
                    style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }}
                  />
                  <button disabled={sendingChat || !chatMessage.trim()} style={colors.accent ? { background: colors.accent } : undefined} className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-extrabold text-slate-950 hover:bg-slate-100 disabled:opacity-50">
                    {sendingChat ? 'Sending...' : 'Send'}
                  </button>
                </form>
              ) : (
                <div className="mt-4 rounded-xl border px-3 py-2 text-sm" style={{ background: tone.chip, borderColor: tone.border, color: tone.label }}>
                  Guest Chat posting is paused by the host.
                </div>
              )}
            </>
          ) : (
            <div className="mt-4 rounded-xl border px-3 py-2 text-sm" style={{ background: tone.chip, borderColor: tone.border, color: tone.label }}>
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
  const [designTheme, setDesignTheme] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(null)
  const isStudioPreview = new URLSearchParams(window.location.search).get('studio-preview') === '1'

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

  useEffect(() => {
    if (!event?.id) {
      setDesignTheme(null)
      return
    }
    let cancelled = false
    if (isStudioPreview) {
      try {
        const raw = sessionStorage.getItem(`festio:design-preview:${event.id}`)
        const preview = raw ? JSON.parse(raw) : null
        if (preview?.event_id === event.id && preview?.theme) {
          setDesignTheme(preview.theme)
          return () => { cancelled = true }
        }
      } catch { /* fall through to the published theme */ }
    }
    api.publicDesignTheme(event.id)
      .then((themePayload) => {
        if (!cancelled) setDesignTheme(themePayload?.is_default ? null : themePayload)
      })
      .catch(() => {
        if (!cancelled) setDesignTheme(null)
      })
    return () => { cancelled = true }
  }, [event?.id, isStudioPreview])

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
  const dColors = designColors(designTheme)
  const tone = readableTone(dColors)
  const dWording = designTheme?.wording || {}
  const page = publicPageConfig(designTheme?.page_config)
  const dCover = designCover(designTheme, event)
  // Rendered flyers already carry their own invitation heading and event name.
  // Keep the flyer as the hero instead of repeating that artwork in text.
  const flyerLedHero = !!designTheme?.flyer_image_url
  const atCapacity = event.rsvp_capacity != null && event.rsvp_count >= event.rsvp_capacity
  const deadlinePassed = !!event.deadline_passed
  const title = dWording.eventTitle || eventTitle(event)
  const dateLabel = dWording.date || fmtDate(event.event_date, event.timezone)
  const timeLabel = dWording.time || fmtTime(event.event_date, event.timezone)
  const venue = [dWording.venue, dWording.address].filter(Boolean).join(' · ') || venueText(event)
  const host = dWording.hostName || hostText(event)
  const hostWebsite = externalUrl(dWording.hostWebsite)
  const aboutWebsite = externalUrl(page.about.ctaUrl || dWording.aboutWebsite)
  const deadline = deadlineText(event)
  const about = dWording.customMessage || event.description || event.invite_message || (
    event.rsvp_enabled
      ? 'We are excited to celebrate this special occasion with family and friends. Please RSVP so we can prepare properly for your attendance.'
      : 'Your guest pass gives you access to event updates, check-in, and Experience activity tracking.'
  )
  const admissionNote = dWording.admissionNote || event.admission_note || (
    event.rsvp_enabled
      ? 'Your RSVP generates a personal QR code. Please bring it with you for check-in at the entrance.'
      : 'Bring your personal QR code for check-in and event activity tracking.'
  )
  const heroWhen = [dateLabel, timeLabel].filter(Boolean).join(' · ')
  const capacityLabel = event.rsvp_capacity != null ? `${event.rsvp_count} / ${event.rsvp_capacity} spots claimed` : ''
  const guestHubToken = confirmed?.rsvp_status === 'confirmed'
    ? confirmed.qr_token
    : tokenMode && event?.rsvp_enabled === false && guest?.rsvp_status === 'invited'
      ? token
    : tokenMode && event?.experience_enabled
      ? token
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
  } else if (tokenMode && !event.rsvp_enabled) {
    rsvpPanel = null
  } else if (tokenMode) {
    rsvpPanel = deadlinePassed ? (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center">
        <div className="text-lg font-extrabold text-slate-800">{deadline ? `RSVP closed on ${deadline}.` : 'RSVP has closed for this event.'}</div>
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
        {deadline ? `RSVP closed on ${deadline}. Contact the host if you still need to respond.` : 'RSVP has closed for this event.'}
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
                ? 'You are on the guest list. Your FestioHub is available below.'
                : 'You are on the guest list. Your ticket was sent to you.'}
        </div>
        <div className="mt-4 text-sm font-semibold text-slate-500">Need to change it? Contact the host.</div>
        <button
          onClick={() => { try { if (storageKey && typeof localStorage !== 'undefined') localStorage.removeItem(storageKey) } catch { /* ignore */ } setPrior(null); setConfirmed(null) }}
          className="mt-3 text-xs font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-900"
        >
          Not {prior.first_name || 'you'}? Start a new RSVP
        </button>
      </div>
    )
  } else {
    rsvpPanel = <RSVPForm event={event} theme={theme} onConfirmed={handleConfirmed} />
  }

  return (
    <div
      className="invite-page min-h-screen bg-[radial-gradient(circle_at_18%_0%,rgba(20,184,166,0.24),transparent_36rem),linear-gradient(140deg,#07111f_0%,#0f172a_48%,#132f38_100%)]"
      style={{ ...themedPageBackground(dColors), color: tone.text }}
    >
      <header className="px-5 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between">
          {page.hero.showWelcomeLabel
            ? <span className="text-sm font-extrabold uppercase tracking-[0.24em]" style={{ color: tone.accent }}>{dWording.inviteLabel || 'Welcome to'}</span>
            : <span />}
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full border px-4 py-2 text-sm font-bold" style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}>Festio</span>
            {flyerLedHero && page.organizer.show && host && (hostWebsite
              ? <a href={hostWebsite} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold underline underline-offset-2 hover:opacity-80" style={{ color: tone.muted }}>{page.organizer.label || 'Organized by'} {host}</a>
              : <span className="text-[11px] font-semibold" style={{ color: tone.muted }}>{page.organizer.label || 'Organized by'} {host}</span>)}
          </div>
        </div>
      </header>

      {isStudioPreview && (
        <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
          <div className="rounded-xl border border-amber-400/50 bg-amber-300/10 px-4 py-3 text-sm font-bold" style={{ color: tone.text }}>
            Design Studio draft preview — only visible in this browser and not yet published.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1180px] px-5 pb-16 sm:px-6">
        <section className="grid items-center gap-10 py-7 md:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] md:gap-12 lg:gap-16 lg:py-14">
          <EventPoster event={event} coverImage={dCover} colors={dColors} titleOverride={title} inviteLabel={dWording.inviteLabel} />

          <div className="space-y-8">
            <div>
              {flyerLedHero || !page.hero.showTitle ? <h1 className="sr-only">{title}</h1> : <>{page.hero.showWelcomeLabel && <div className="mb-4 text-sm font-extrabold uppercase tracking-[0.24em]" style={{ color: tone.accent }}>{dWording.inviteLabel || "You're invited to"}</div>}<h1 className="max-w-3xl text-5xl font-extrabold leading-[1.02] sm:text-6xl lg:text-7xl" style={{ color: tone.primary }}>{title}</h1></>}
              {!flyerLedHero && page.hero.showHost && host && (hostWebsite
                ? <a href={hostWebsite} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block text-xl font-semibold underline decoration-2 underline-offset-4 hover:opacity-80" style={{ color: tone.text }}>{host}</a>
                : <p className="mt-5 text-xl font-semibold" style={{ color: tone.text }}>{host}</p>)}
              <p className="mt-6 max-w-2xl whitespace-pre-line text-lg leading-8" style={{ color: tone.muted }}>
                {dWording.rsvpNote || event.invite_message || 'Join us for a beautiful evening of celebration, food, memories, and good company.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DetailRow icon="📅" label="When" value={heroWhen} tone={tone} />
              <DetailRow icon="📍" label="Location" value={venue || 'Venue details coming soon'} tone={tone} href={event.venue_address ? mapUrl(event.venue_address) : ''} />
              <DetailRow icon="🎟️" label="Admission" value="QR pass at entry" tone={tone} />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryButton
                type="button"
                style={dColors.accent ? { background: dColors.accent } : undefined}
                onClick={() => document.getElementById(hasGuestHub ? 'guest-hub' : 'rsvp')?.scrollIntoView({ behavior: 'smooth' })}
              >
                {hasGuestHub ? 'Open FestioHub' : 'Confirm My RSVP'}
              </PrimaryButton>
              <SecondaryButton
                type="button"
                style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}
                onClick={() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth' })}
              >
                View Event Details
              </SecondaryButton>
            </div>
          </div>
        </section>

        {hasGuestHub && (
          <section id="guest-hub" className="scroll-mt-6 py-6">
            <GuestHub event={event} accessToken={guestHubToken} designTheme={designTheme} />
          </section>
        )}

        <section id="details" className="grid gap-6 py-8 md:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
          <div className="rounded-3xl border p-6 shadow-xl backdrop-blur sm:p-7" style={{ background: tone.panelStrong, borderColor: tone.border, boxShadow: `0 22px 48px ${tone.shadow}`, color: tone.text }}>
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="text-3xl font-extrabold">Event details</h2>
              {capacityLabel && <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: tone.chip, color: tone.text }}>{capacityLabel}</span>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailRow icon="📅" label="Date" value={dateLabel} tone={tone} />
              <DetailRow icon="🕐" label="Time" value={timeLabel} tone={tone} />
              {page.details.showVenue && <DetailRow icon="📍" label="Venue" value={venue || 'Venue details coming soon'} tone={tone} href={event.venue_address ? mapUrl(event.venue_address) : ''} />}
              {page.details.showHotel && (event.hotel_name || event.hotel_address) && <DetailRow icon="🏨" label="Hotel information" value={[event.hotel_name, event.hotel_address].filter(Boolean).join(' · ')} tone={tone} href={event.hotel_address ? mapUrl(event.hotel_address) : ''} />}
              {page.details.showHost && <DetailRow icon="👤" label="Host" value={host} tone={tone} href={hostWebsite} />}
              {event.rsvp_enabled && <DetailRow icon="⏳" label="RSVP deadline" value={deadline} tone={tone} />}
              {page.details.showAdmission && <DetailRow icon="✓" label="Admission note" value={admissionNote} tone={tone} />}
            </div>
          </div>

          {page.about.show && <div className="rounded-3xl border p-6 shadow-xl backdrop-blur sm:p-7" style={{ background: tone.panelStrong, borderColor: tone.border, boxShadow: `0 22px 48px ${tone.shadow}`, color: tone.text }}>
            <h2 className="text-3xl font-extrabold">About this event</h2>
            <div className="mt-5 space-y-4 text-base leading-8" style={{ color: tone.muted }}>
              {String(about).split(/\r?\n+/).filter(Boolean).map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}
            </div>
            {aboutWebsite && (
              <a href={aboutWebsite} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex text-sm font-bold underline decoration-2 underline-offset-4 transition hover:opacity-80" style={{ color: tone.accent }}>
                {page.about.ctaLabel || 'Learn more about this event'} ↗
              </a>
            )}
            {event.registry_enabled && event.registry_token && (
              <a href={`/registry/${event.registry_token}`} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl border px-4 py-2 text-sm font-bold transition" style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}>
                View gift list
              </a>
            )}
          </div>}
        </section>

        {rsvpPanel && (
          <section id="rsvp" className="scroll-mt-6 py-9">
            <div className="mx-auto w-full max-w-[680px] rounded-[1.65rem] border border-white/15 bg-white p-5 text-slate-950 shadow-2xl shadow-black/30 sm:p-8">
              {rsvpPanel}
            </div>
          </section>
        )}

        {!hasGuestHub && <GuestHub event={event} accessToken={guestHubToken} designTheme={designTheme} />}
      </main>

      {!event.is_paid && (
        <footer className="pb-6 text-center text-xs font-semibold" style={{ color: tone.label }}>
          Powered by <a href="https://festio.events" className="underline underline-offset-2 hover:opacity-80">Festio</a>
        </footer>
      )}
    </div>
  )
}
