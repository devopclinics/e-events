import { useState, useEffect, useCallback } from 'react'
import confetti from 'canvas-confetti'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { isNativePushSupported, registerNativePush, unregisterNativePush } from '../push/fcmPush'
import { parseUtc, fmtEventDateRange } from '../timeutil'
import { seatingTerm, seatTerm } from '../seatingTerm'
import './GuestHubThemes.css'
import PublicTicketCheckout from '../components/PublicTicketCheckout'

// ── Invite page helpers ───────────────────────────────────────────────────────

/** Days remaining until event_date (event timezone-agnostic — counts calendar days). */
function daysUntil(isoDate) {
  if (!isoDate) return null
  const now = new Date()
  const target = new Date(isoDate)
  const diff = Math.ceil((target - now) / 86400000)
  return diff
}

/** A share-safe event URL that never includes a guest's capability token. */
function publicInviteUrl(event) {
  if (!event?.id || typeof window === 'undefined') return ''
  return `${window.location.origin}/invite/${encodeURIComponent(event.id)}`
}

/** Google Calendar deeplink for an event. */
function googleCalUrl(event) {
  const fmt = (d) => parseUtc(d).toISOString().replace(/[-:]/g, '').replace('.000', '')
  const start = fmt(event.event_date)
  const end   = event.event_end_date ? fmt(event.event_end_date) : fmt(new Date(parseUtc(event.event_date).getTime() + 2 * 3600000))
  const loc   = [event.venue_name, event.venue_address].filter(Boolean).join(', ')
  return `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(event.name)}` +
    `&dates=${start}/${end}` +
    (loc ? `&location=${encodeURIComponent(loc)}` : '') +
    (event.description ? `&details=${encodeURIComponent(event.description.slice(0, 500))}` : '')
}

/** Download an ICS calendar file for the event. */
function downloadICS(event) {
  const fmt = (d) => parseUtc(d).toISOString().replace(/[-:]/g, '').replace('.000', '').replace('Z', 'Z')
  const start = fmt(event.event_date)
  const end   = event.event_end_date ? fmt(event.event_end_date) : fmt(new Date(parseUtc(event.event_date).getTime() + 2 * 3600000))
  const loc   = [event.venue_name, event.venue_address].filter(Boolean).join(', ')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Festio//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${event.name.replace(/,/g, '\\,')}`,
    loc ? `LOCATION:${loc.replace(/,/g, '\\,')}` : '',
    event.description ? `DESCRIPTION:${event.description.slice(0, 500).replace(/\n/g, '\\n').replace(/,/g, '\\,')}` : '',
    `URL:${publicInviteUrl(event)}`,
    `UID:festio-${event.id}@festio.events`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
  const blob = new Blob([ics], { type: 'text/calendar' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${event.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** WhatsApp share URL. */
function whatsappShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

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

// Fallback "Guest type" options for the additional-invitee repeater, used
// whenever an event has no rsvp_invitee_type_options override configured
// (Guests → Multi-invitee settings → Guest type options).
const DEFAULT_INVITEE_TYPES = ['Parent/Guardian', 'Invited Guest', 'Teacher', 'School/Staff', 'VIP/Dignitary', 'Other']

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
  'iedpu-green-gold': {
    bg: 'bg-gradient-to-br from-emerald-50 to-amber-50 dark:from-emerald-950 dark:to-stone-950',
    card: 'bg-white/95 dark:bg-emerald-950/90',
    header: 'bg-amber-400 text-slate-950',
    accent: 'text-amber-700 dark:text-amber-300',
    btn: 'bg-amber-400 text-slate-950 hover:bg-amber-300',
    border: 'border-amber-200 dark:border-amber-700',
    badge: 'bg-amber-50 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  },
}

const EVENT_PALETTES = {
  // The IEDPU cover is deep green with gold ornamentation. Carry those two
  // colors through the page so controls stand apart from the green artwork.
  '8882c06c-9cd4-425d-902c-ac5833121454': {
    primary: '#064e3b',
    secondary: '#0b3327',
    accent: '#e3b341',
    background: '#061f18',
    surface: '#0b3327',
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

function designColors(theme, event) {
  return { ...(theme?.colors || {}), ...(EVENT_PALETTES[event?.id] || {}) }
}

function inviteTheme(event) {
  return EVENT_PALETTES[event?.id] ? 'iedpu-green-gold' : (event?.invite_theme || 'default')
}

// font_pairing has been a real, saveable field since the original template
// catalog (design-service/app/catalog.py), and Design Studio's "Apply
// palette" (FestioHub styles) already writes it — but until now nothing on
// this page ever read it back: it only ever reached design-service's flyer
// PNG renderer. Ten new visual themes with the same generic system font
// would have looked identical to each other beyond color, so this is a real
// gap worth closing, not just for these — any event with a font_pairing set
// benefits.
const FONT_STACKS = {
  'modern-sans': "'Inter', -apple-system, 'Segoe UI', sans-serif",
  'classic-serif': "Georgia, 'Times New Roman', serif",
  'elegant-serif': "'Cormorant Garamond', Georgia, serif",
  'display-rounded': "'Nunito', -apple-system, 'Segoe UI', sans-serif",
  'bold-sans': "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
}
function designFontFamily(theme) {
  return FONT_STACKS[theme?.font_pairing] || FONT_STACKS['modern-sans']
}

function designCover(theme, event) {
  // cover_image_url is an explicit photo upload (uploadFlyerPhoto in Design
  // Studio) — it should always win. flyer_image_url is only a fallback: it
  // can be a real rendered flyer, but can also just be a template's stock
  // preview thumbnail left over from picking a flyer template without ever
  // rendering/applying one (chooseFlyerTemplate in the legacy Design Studio
  // sets it to the template's preview image as a provisional placeholder).
  // Letting that placeholder outrank an actual uploaded photo meant an
  // organizer's own photo could never appear on the live guest page.
  return theme?.cover_image_url || theme?.flyer_image_url || event?.invite_cover_image || ''
}

function themedPageBackground(colors) {
  if (!colors?.background) return undefined
  const accent = colors.accent || '#14b8a6'
  const surface = colors.surface || '#0f172a'
  return {
    background: `radial-gradient(circle at 18% 0%, ${accent}38, transparent 36rem), linear-gradient(140deg, ${colors.background} 0%, ${surface} 52%, ${colors.background} 100%)`,
  }
}

// Hero-only fallback for events with no uploaded cover photo. Several of the
// 10 GuestHub color presets carry their real identity in `primary` (Coastal
// Club's navy, Verdant's forest green, Haze's pink) rather than in
// `background`/`surface` (often just a light neutral) — themedPageBackground()
// alone renders those as a washed-out neutral hero instead of the template's
// actual mood. Fades primary/accent to near-black instead, matching the
// "no photo yet" placeholder look used in the GuestHub template previews.
function heroFallbackBackground(colors) {
  const base = colors?.primary || colors?.accent
  if (!base) return { background: 'linear-gradient(145deg, #0f172a 0%, #113f46 52%, #14b8a6 100%)' }
  const glow = colors?.accent || base
  return {
    background: `radial-gradient(120% 100% at 80% 0%, ${glow}40, transparent 60%), linear-gradient(160deg, ${base} 0%, #0a0a0a 100%)`,
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

function mapUrl(address) {
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : ''
}

// A question with depends_on_question_id set is only shown (and only
// enforced as required) once the referenced question's current answer
// equals depends_on_value — keep in sync with the same check server-side
// in backend/app/routers/invite.py's _require_questions_answered.
function questionConditionMet(question, answers) {
  if (!question.depends_on_question_id) return true
  return (answers[question.depends_on_question_id] || '') === (question.depends_on_value || '')
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
  hero: { showWelcomeLabel: true, showTitle: true, showHost: true, overlayOpacity: 55, focusX: 50, focusY: 20, imageSize: 480, imageFit: 'cover' },
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
        I agree to receive SMS/text and WhatsApp messages from Festio for this event, including my invitation or
        ticket link, QR pass, RSVP updates, check-in confirmation, seating updates, session reminders, and other
        event-service notifications. Message frequency varies by event. Message and data rates may apply. Reply
        HELP for help. Reply STOP to opt out at any time. Consent is not required to buy goods or services. View
        our <a href="/privacy" target="_blank" rel="noreferrer" className="font-bold text-teal-700 underline">Privacy Policy</a>.
      </span>
    </label>
  )
}

function RSVPForm({ event, theme, onConfirmed, tone, dWording = {} }) {
  const t = THEMES[theme] || THEMES.default
  // Pre-fill from ?first_name=&last_name=&email= when present — used by a
  // private Calendar link for a contact who hasn't registered for this event
  // yet (see CalendarPage.jsx). Absent on ordinary traffic, so this is a
  // no-op for the existing open-RSVP flow.
  const [form, setForm] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      first_name: params.get('first_name') || '',
      last_name: params.get('last_name') || '',
      email: params.get('email') || '',
      phone: '',
    }
  })
  const [smsConsent, setSmsConsent] = useState(false)
  const [choice, setChoice] = useState('')
  const [answers, setAnswers] = useState({})
  const emptyInvitee = () => ({ first_name: '', last_name: '', relationship: '', phone: '', email: '', guest_type: 'Invited Guest', age_group: '', notes: '' })
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
  const inviteeTypes = event.rsvp_invitee_type_options?.length
    ? event.rsvp_invitee_type_options
    : DEFAULT_INVITEE_TYPES

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
          whatsapp_consent: Boolean(form.phone.trim() && smsConsent),
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
                  age_group: row.age_group || undefined,
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
    <div className="gh-panel space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-slate-950">{multiInvitee ? (dWording.multiInviteeHeading || 'Register yourself and your guests') : 'Will you be attending?'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {multiInvitee
            ? (dWording.multiInviteeSubheading || `Complete your registration to receive an individual Festio Pass for every registered attendee${event.rsvp_require_approval ? ', pending review' : ''}.`)
            : 'Let the host know so they can prepare your spot and Festio Pass.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setChoice('yes')}
          className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-teal-300/20 ${choice === 'yes' ? 'border-teal-400 bg-teal-50 shadow-lg shadow-teal-950/5' : 'border-slate-200 bg-white hover:border-teal-200 hover:bg-slate-50'}`}
          style={choice === 'yes' && tone?.accent ? { borderColor: tone.accent, background: `${tone.accent}14` } : undefined}
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
              <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.firstNameLabel || (multiInvitee ? 'Submitter first name' : 'First name')} <span className="text-red-500">*</span></label>
              <input required value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.lastNameLabel || (multiInvitee ? 'Submitter last name' : 'Last name')} <span className="text-red-500">*</span></label>
              <input required value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
            </div>
          </div>

          {collectEmail && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.emailLabel || (multiInvitee ? 'Submitter email' : 'Email')} {emailRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}</label>
              <input required={emailRequired} type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="jane@example.com" />
            </div>
          )}

          {collectPhone && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.phoneLabel || (multiInvitee ? 'Submitter phone' : 'Phone')} {phoneRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}</label>
              <input required={phoneRequired} type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="(555) 123-4567" />
              <p className="mt-1 text-xs text-slate-500">Enter a U.S. number, or select the appropriate country code for an international number.</p>
            </div>
          )}

          {event.rsvp_collect_phone && form.phone.trim() && (
            <SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} disabled={loading} />
          )}

          {multiInvitee && (
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                {dWording.registrantNote || `The primary registrant will receive an individual Festio Pass ${event.rsvp_require_approval ? 'after approval' : 'right away'}. Please add every spouse, child or invited guest attending with you below.`}
              </div>
              {categoryQuestion && (
                <div className="rounded-2xl border border-teal-100 bg-white p-4">
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    {dWording.registrantCategoryLabel || 'Registrant category'} <span className="text-red-500">*</span>
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
                  <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>{dWording.additionalGuestsHeading || 'Family Members and Additional Guests'}</div>
                  <p className="mt-1 text-xs text-slate-500">
                    {needsInviteeCategory
                      ? 'Select a registrant category to see how many additional guests are allowed.'
                      : (dWording.additionalGuestsNote || 'You may add your family members and invited guests below.')}
                  </p>
                </div>
                <button type="button" onClick={addInvitee} disabled={needsInviteeCategory || invitees.length >= additionalInviteeLimit}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                  Add additional guest
                </button>
                  </div>
                  {invitees.map((row, index) => {
                const rowContactExempt = (event.rsvp_invitee_contact_exempt_types || []).includes(row.guest_type)
                const rowPhoneRequired = inviteePhoneRequired && !rowContactExempt
                const rowEmailRequired = inviteeEmailRequired && !rowContactExempt
                return (
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
                    {event.rsvp_invitee_age_options?.length > 0 && (
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Age group</label>
                      <select value={row.age_group} onChange={(e) => setInvitee(index, 'age_group', e.target.value)} className={inputCls}>
                        <option value="">Select age group</option>
                        {event.rsvp_invitee_age_options.map((age) => <option key={age} value={age}>{age}</option>)}
                      </select>
                    </div>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Relationship / role</label>
                      <input value={row.relationship} onChange={(e) => setInvitee(index, 'relationship', e.target.value)} className={inputCls} placeholder="Aunt, teacher, chairman, etc." />
                    </div>
                    {collectPhone && (
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Phone {rowPhoneRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}</label>
                      <input required={rowPhoneRequired} type="tel" value={row.phone} onChange={(e) => setInvitee(index, 'phone', e.target.value)} className={inputCls} placeholder="(555) 123-4567" />
                    </div>
                    )}
                    {collectEmail && (
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-bold text-slate-600">
                        Email {rowEmailRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
                      </label>
                      <input required={rowEmailRequired} type="email" value={row.email} onChange={(e) => setInvitee(index, 'email', e.target.value)} className={inputCls} placeholder="invitee@example.com" />
                    </div>
                    )}
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-bold text-slate-600">Notes</label>
                      <input value={row.notes} onChange={(e) => setInvitee(index, 'notes', e.target.value)} className={inputCls} placeholder="Any seating, protocol, or meal note for this person" />
                    </div>
                  </div>
                </div>
                )})}
                </>
              )}
            </div>
          )}

          {event.questions?.length > 0 && (
            <div className="space-y-4 pt-1">
              <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>A few quick questions</div>
              {event.questions.filter((q) => q.id !== categoryQuestion?.id && questionConditionMet(q, answers)).map((q) => (
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

          <PrimaryButton type="submit" disabled={loading} className="gh-cta w-full" style={tone?.accent ? { background: tone.accent } : undefined}>
            {loading ? 'Submitting...' : multiInvitee ? (dWording.submitButtonLabel || 'Complete Registration') : 'Confirm My RSVP'}
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
  const shareUrl = publicInviteUrl(event)
  const [copied, setCopied] = useState(false)
  const [rsvpLinkCopied, setRsvpLinkCopied] = useState(false)

  useEffect(() => {
    if (event?.rsvp_confetti_enabled !== false) {
      confetti({
        particleCount: 140,
        spread: 80,
        origin: { y: 0.55 },
        colors: ['#0d9488', '#34d399', '#fbbf24', '#f9a8d4', '#60a5fa', '#a78bfa'],
      })
    }
  }, [])

  const copyHub = async () => {
    if (!hubUrl) return
    try { await navigator.clipboard.writeText(hubUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  const copyRsvpLink = async () => {
    if (!shareUrl) return
    try { await navigator.clipboard.writeText(shareUrl); setRsvpLinkCopied(true); setTimeout(() => setRsvpLinkCopied(false), 2000) } catch { /* ignore */ }
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
          <div className="mt-2 text-xs font-bold text-amber-700">Keep this link private—it opens your personal pass and assignments.</div>
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
          onClick={() => navigator.share?.({ title: eventTitle(event), url: shareUrl })}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
        >
          Share Invitation
        </button>
      </div>

      {/* Add to calendar — hidden while the start time is still TBD, since a
          calendar entry needs a real time to be useful. */}
      {event?.invite_add_to_calendar_enabled !== false && !event?.event_time_tbd && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Add to calendar</div>
          <div className="flex flex-wrap gap-2">
            <a href={googleCalUrl(event)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100">
              📅 Google Calendar
            </a>
            <button type="button" onClick={() => downloadICS(event)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100">
              📥 Apple / Outlook (.ics)
            </button>
          </div>
        </div>
      )}

      {/* Invite a friend */}
      {event?.invite_share_enabled !== false && (
        <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3">
          <div className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-teal-700">Know someone who should come?</div>
          <div className="flex flex-wrap gap-2">
            <a
              href={whatsappShareUrl(`You're invited to ${event.name}!\nView event details: ${shareUrl}`)}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
            >
              Share on WhatsApp
            </a>
            <button type="button" onClick={copyRsvpLink} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-bold text-teal-700 transition hover:bg-teal-50">
              {rsvpLinkCopied ? 'Link copied ✓' : 'Copy RSVP link'}
            </button>
          </div>
        </div>
      )}
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

function WaitlistedView({ confirm }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
      <div className="text-2xl font-extrabold text-slate-950">Thanks, {confirm.first_name}.</div>
      <div className="mt-2 text-sm leading-relaxed text-slate-600">{confirm.message}</div>
      <div className="mt-4 text-sm font-semibold text-amber-800">
        You're on the waitlist — we'll email you the moment a spot opens up.
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

function TokenRSVPForm({ event, prefill, token, theme, onDone, tone, dWording = {} }) {
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
        (q) => q.is_required && questionConditionMet(q, answers) && !(answers[q.id] || '').trim(),
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
          whatsapp_consent: Boolean(form.phone.trim() && smsConsent),
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
    <div className="gh-panel space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-slate-950">Will you be attending?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">Confirm your spot or let the host know you can't make it.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.firstNameLabel || 'First name'} <span className="text-red-500">*</span></label>
          <input value={form.first_name} onChange={set('first_name')} className={inputCls} placeholder="Jane" />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.lastNameLabel || 'Last name'} <span className="text-red-500">*</span></label>
          <input value={form.last_name} onChange={set('last_name')} className={inputCls} placeholder="Smith" />
        </div>
      </div>

      {prefill.email && (
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.emailLabel || 'Email'}</label>
          <input value={prefill.email} disabled readOnly className={lockedCls} />
        </div>
      )}

      {event.rsvp_collect_phone && (
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">{dWording.phoneLabel || 'Phone'} <span className="text-slate-400">(optional)</span></label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+1 (832) 000-0000" />
        </div>
      )}

      {event.rsvp_collect_phone && form.phone.trim() && (
        <SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} disabled={!!loading} />
      )}

      {event.questions?.length > 0 && (
        <div className="space-y-4 pt-1">
          <div className={`text-xs font-extrabold uppercase tracking-[0.18em] ${t.accent}`}>A few quick questions</div>
          {event.questions.filter((q) => questionConditionMet(q, answers)).map((q) => (
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
          className="gh-cta w-full"
          style={tone?.accent ? { background: tone.accent } : undefined}
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

// FestioHub layout styles, chosen in Design Studio and saved as
// theme_config.hubStyle → design-service's public-theme hub_style field.
// Two axes distinguish them, reusing the SAME real modules/data rather than
// inventing per-style content: (1) tabbed vs. all-sections-stacked — reusing
// the pre-existing guestHubV2=false "stacked" rendering path below for the
// non-tabbed styles — and (2) a CSS treatment on the stacked container for
// timeline/minimal-list. wallet-pass and story-feed both keep tabs but differ
// in tab order (pass-first vs. activity/community-first) and tab-bar chrome.
const HUB_STYLES = new Set([
  'wallet-pass', 'card-dashboard', 'story-feed', 'timeline', 'minimal-list',
  // 10 new visual themes
  'noir-couture', 'bloom-editorial', 'electric-rave', 'linen-gold',
  'celestial-midnight', 'soleil', 'mono-print', 'verdant', 'coastal-club', 'haze',
  // 10 minimal/classic themes (5 full-bleed-hero + 5 side-card-hero — see
  // HUB_SIDECARD_STYLES below)
  'classic-navy', 'ivory-formal', 'slate-professional', 'sage-community', 'champagne-minimal',
  'heritage-navy', 'ivory-ledger', 'graphite-tech', 'meadow-community', 'parchment-classic',
  'sacred-pilgrimage',
])
const HUB_TABBED_STYLES = new Set([
  'wallet-pass', 'story-feed',
  // new tabbed themes
  'noir-couture', 'electric-rave', 'celestial-midnight', 'haze',
  // The side-card hero (HUB_SIDECARD_STYLES) and tabbed FestioHub navigation
  // are independent choices -- nothing about a side-card hero requires
  // stacked, non-tabbed sections. Every side-card style gets tabs too.
  'heritage-navy', 'ivory-ledger', 'graphite-tech', 'meadow-community', 'parchment-classic',
  'sacred-pilgrimage',
])
// Page-level hero layout: the cover photo sits beside the title (like the
// original default look) instead of full-bleed above it. Design Studio's
// HUB_STYLES array carries the same heroLayout:'sidecard' flag for its own
// swatch preview — this is the live page's independent source of truth,
// since design-service's public-theme payload only exposes the hub_style id.
const HUB_SIDECARD_STYLES = new Set([
  'heritage-navy', 'ivory-ledger', 'graphite-tech', 'meadow-community', 'parchment-classic',
  'sacred-pilgrimage',
])
const HUB_TAB_ORDER = {
  'story-feed': ['activity', 'messages', 'program', 'speakers', 'pass'],
}
const HUB_TAB_META = {
  pass: ['pass', 'Pass', '🎫'],
  activity: ['activity', 'Activity', '✅'],
  program: ['program', 'Program', '📅'],
  // Speaker Showcase cross-link — filtered out below unless the event has
  // speaker_enabled on, same "always in the order list, conditionally
  // rendered" pattern already used for program/messages.
  speakers: ['speakers', 'Speakers', '🎤'],
  messages: ['messages', 'Messages', '💬'],
}
const PREVIEW_QR_DATA_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" shape-rendering="crispEdges">' +
  '<rect width="7" height="7" fill="#fff"/>' +
  [[0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[1,2],[2,2],[4,0],[4,1],[4,2],[6,0],[6,2],[0,4],[1,4],[2,4],[0,6],[2,6],[4,4],[5,5],[6,6],[4,6],[6,4],[3,3],[5,1],[1,5]]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#0f172a"/>`).join('') +
  '</svg>'
)
// Sample data for the "Preview" surface in Design Studio, where there's no
// real guest/RSVP to load a Hub for — same shapes api.guestHub()/
// api.guestExperience() return, so every module renders exactly as it would
// for a real confirmed guest.
const PREVIEW_HUB = {
  guest: { name: 'Ada Guest', table_name: 'Table 7', seat_number: '12', admitted: false, checked_out: false, qr_token: 'preview', rsvp_status: 'confirmed' },
  announcements: [{ id: 'p1', title: 'Doors open at 6pm', body: 'Please arrive a little early to find parking.' }],
  direct_messages: [],
  chat_messages: [],
  capabilities: { direct_host_messages: true, guest_chat: true, guest_chat_posting: true, festiome: true },
}
const PREVIEW_JOURNEY = {
  experience_enabled: true,
  total_count: 4,
  completed_count: 1,
  next_steps: [{ id: 's2', title: 'Find your table', guest_message: 'Your seat is ready — check the Pass tab.', self_service: true }],
  steps: [
    { id: 's1', title: 'RSVP confirmed', status: 'completed', required: true },
    { id: 's2', title: 'Find your table', status: 'blocked', required: true, actionable: true, guest_message: 'Your seat is ready — check the Pass tab.' },
    { id: 's3', title: 'Check in at the door', status: 'blocked', required: true },
    { id: 's4', title: 'Leave feedback', status: 'blocked', required: false },
  ],
  program: {
    enabled: true,
    current_segments: [{ step_id: 'p1', title: 'Cocktail hour', category: 'Reception', ends_at: new Date(Date.now() + 30 * 60000).toISOString() }],
    next_segments: [{ step_id: 'p2', title: 'Dinner service', starts_at: new Date(Date.now() + 45 * 60000).toISOString() }],
    days: [],
  },
}

function GuestHub({ event, accessToken, designTheme, previewMock = false, confirmed = true }) {
  const [hub, setHub] = useState(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  const [message, setMessage] = useState('')
  const [chatMessage, setChatMessage] = useState('')
  const [programDay, setProgramDay] = useState('')
  const [hubTab, setHubTab] = useState('pass')
  const [speakers, setSpeakers] = useState(null)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingChat, setSendingChat] = useState(false)
  // Experience journey (only populated when the event has Experience enabled).
  const [journey, setJourney] = useState(null)
  const [hubMenuDay, setHubMenuDay] = useState('')
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
  const hubLayout = designTheme?.hub_layout || {}
  const hubModuleVisible = (key) => {
    const module = (hubLayout.modules || []).find((item) => item.key === key)
    return module ? module.visible !== false : true
  }
  const effectiveHubModules = hubLayout.modules?.length ? hubLayout.modules : [
    { key: 'guest_pass', visible: true },
    { key: 'next_action', visible: true },
    { key: 'activity_progress', visible: true },
    { key: 'live_program', visible: true },
    { key: 'festiome', visible: true },
    { key: 'messages', visible: true },
  ]
  // Staging rollout flag: when off, fall back to the pre-tab layout — every
  // section renders at once (as it did before the tab bar existed) instead
  // of being gated to a single active tab.
  const guestHubV2 = event?.guest_hub_v2 !== false
  const hubStyle = HUB_STYLES.has(designTheme?.hub_style) ? designTheme.hub_style : 'wallet-pass'
  // card-dashboard/timeline/minimal-list reuse the same "every section at
  // once" path the guestHubV2=false rollout flag already exercises — that
  // path is real and tested, not new here. wallet-pass/story-feed keep tabs.
  const tabbed = guestHubV2 && HUB_TABBED_STYLES.has(hubStyle)
  const tabActive = (key) => !tabbed || hubTab === key
  const tabsActive = (keys) => !tabbed || keys.includes(hubTab)
  const hubTabOrder = HUB_TAB_ORDER[hubStyle] || ['pass', 'activity', 'program', 'speakers', 'messages']
  // Per-event, organizer-selectable — never on by default, so no existing
  // event's Hub changes shape unless someone explicitly picks it in Guests →
  // Invites & RSVP. See CompanionGuestHub below for the redesigned layout.
  const companionLayout = event?.guest_hub_layout === 'companion'

  // Design Studio's preview iframe loads with #guest-hub in the URL, but this
  // section doesn't exist in the DOM until the async event/theme fetch above
  // resolves — the browser's own anchor-scroll only fires once, on load, so
  // it always misses and the iframe is stuck showing the hero/flyer instead.
  // Scroll it into view ourselves once this component actually mounts. This
  // is the default/intended behavior for a studio-preview link generally
  // (direct link, FestioHub tab, GuestHub tab) — but the Event Page tab's
  // iframe also sets previewMock (isStudioPreview forces hasGuestHub true so
  // the card renders at all there) and every edit on that tab (e.g. the
  // hero photo sliders) reloaded the iframe, yanking the preview straight
  // past the hero down to this card. Can't tell that case apart by URL hash
  // alone (Event Page and GuestHub tabs' src are otherwise identical), so
  // the Event Page tab's iframe explicitly opts out via ?focus=hero.
  useEffect(() => {
    if (!previewMock || new URLSearchParams(window.location.search).get('focus') === 'hero') return undefined
    const id = requestAnimationFrame(() => document.getElementById('guest-hub')?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(id)
  }, [previewMock])

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
    if (!accessToken || previewMock) return
    try {
      localStorage.setItem('festio:installed-guest-hub', `${window.location.pathname}${window.location.search}#guest-hub`)
    } catch { /* installation remains optional in private browsing */ }
  }, [accessToken, previewMock])

  useEffect(() => {
    if (!installPrompt || sessionStorage.getItem('festio:install-prompt-dismissed')) return
    const timer = setTimeout(() => setShowInstallDialog(true), 900)
    return () => clearTimeout(timer)
  }, [installPrompt])

  const loadPush = useCallback(async () => {
    if (!event?.id || !accessToken || previewMock) return
    // Native (Capacitor) app: FCM, not the browser VAPID flow below — there's
    // no service worker/PushManager to check, and no upfront config fetch
    // needed since registerNativePush() fails harmlessly if FCM is disabled
    // server-side (matches _fcm_configured()'s gate).
    if (isNativePushSupported()) {
      setPushConfig({ enabled: true, native: true })
      setPushState(window.localStorage.getItem(`festio.fcmToken.${event.id}`) ? 'enabled' : 'ready')
      return
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
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
  }, [event?.id, accessToken, previewMock])

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
    if (!pushConfig?.enabled || pushBusy) return
    setPushBusy(true)
    setPushError('')
    try {
      if (pushConfig.native) {
        await registerNativePush(event.id, accessToken)
        setPushState(window.localStorage.getItem(`festio.fcmToken.${event.id}`) ? 'enabled' : 'blocked')
        return
      }
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
      if (pushConfig?.native) {
        await unregisterNativePush(event.id, accessToken)
        setPushState('ready')
        return
      }
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
    if (!event?.id || !accessToken || previewMock) return
    try {
      const data = await api.guestExperience(event.id, accessToken)
      setJourney(data)
    } catch { /* journey is best-effort; keep the rest of the Hub working */ }
  }, [event?.id, accessToken, previewMock])

  useEffect(() => { loadJourney() }, [loadJourney])
  // Preview surface only: seed sample data instead of loading from the API,
  // so every module renders and the style choice is actually visible without
  // a real guest and RSVP.
  useEffect(() => {
    if (!previewMock) return
    setHub(PREVIEW_HUB)
    setJourney(PREVIEW_JOURNEY)
    setFeedbackForms([])
  }, [previewMock])
  useEffect(() => {
    const configured = hubLayout.defaultTab
    if (configured === 'activity_when_actionable') {
      setHubTab(journey?.next_steps?.length ? 'activity' : 'pass')
    } else if (['pass', 'activity', 'program', 'messages'].includes(configured)) {
      setHubTab(configured)
    } else if (journey?.next_steps?.length) {
      setHubTab((current) => current === 'pass' ? 'activity' : current)
    }
  }, [journey?.next_steps?.length, hubLayout.defaultTab])
  useEffect(() => {
    if (!event?.id || !accessToken || previewMock) return undefined
    const timer = setInterval(loadJourney, 30000)
    return () => clearInterval(timer)
  }, [event?.id, accessToken, previewMock, loadJourney])

  const loadFeedback = useCallback(async () => {
    if (!event?.id || !accessToken || previewMock) return
    try {
      const data = await api.guestFeedback(event.id, accessToken)
      setFeedbackForms(data.forms || [])
      setFeedbackAnswers(Object.fromEntries((data.forms || []).map((form) => [form.step_id, form.answers || {}])))
    } catch { setFeedbackForms([]) }
  }, [event?.id, accessToken, previewMock])

  useEffect(() => { loadFeedback() }, [loadFeedback])
  useEffect(() => {
    if (!feedbackForms.length || new URLSearchParams(window.location.search).get('focus') !== 'feedback') return
    setHubTab('activity')
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
    if (!event?.id || !accessToken || previewMock) return
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
  }, [event?.id, accessToken, previewMock])

  // Speaker Showcase cross-link — same public token endpoint the ticketing
  // carousel and standalone page use, not a separate implementation. Default
  // is to reveal speakers only after RSVP confirmation; speaker_show_before_rsvp
  // is a per-event opt-in for organizers who want it visible earlier (matching
  // how the ticketing site always shows it, since that's a pre-purchase context).
  const speakersVisible = event?.speaker_enabled && (confirmed || event?.speaker_show_before_rsvp)
  // A guest who hasn't RSVP'd yet (and has no prior token) has no accessToken
  // at all — the early-return below would otherwise hide the whole Hub, speakers
  // included, regardless of this opt-in. Land them straight on the Speakers tab
  // since the rest of the Hub (pass/activity/messages) has nothing to show them yet.
  useEffect(() => {
    if (!accessToken && speakersVisible) setHubTab('speakers')
  }, [accessToken, speakersVisible])
  useEffect(() => {
    if (!speakersVisible || !event?.speaker_token) { setSpeakers(null); return }
    api.getSpeakerPage(event.speaker_token).then((d) => setSpeakers(d.speakers)).catch(() => setSpeakers(null))
  }, [speakersVisible, event?.speaker_token])

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

  if ((!accessToken && !speakersVisible) || hidden) return null
  const colors = designColors(designTheme, event)
  const tone = readableTone(colors)
  const hasRsvp = event?.rsvp_enabled !== false
  const passStatus = hub?.guest?.checked_out
    ? { label: 'Checked out', icon: '↩' }
    : hub?.guest?.admitted
      ? { label: 'Ready for entry', icon: '✓' }
      : { label: 'Not checked in yet', icon: '◷' }
  const passCells = [
    hub?.guest?.table_name && { l: seatingTerm(event), v: hub.guest.table_name, ic: '🪑' },
    hub?.guest?.seat_number && { l: seatTerm(event), v: hub.guest.seat_number, ic: '🎟️' },
    { l: 'Status', v: hub?.guest?.admitted ? 'Admitted' : 'Not yet', ic: hub?.guest?.admitted ? '🟢' : '⚪' },
    event?.venue_name && { l: 'Venue', v: event.venue_name, ic: '📍' },
  ].filter(Boolean)
  const passNextStep = hub?.guest?.admitted ? journey?.next_steps?.[0] : null
  const programDays = journey?.program?.days || []
  const selectedProgramDay = programDays.find((day) => day.date === programDay)
    || programDays.find((day) => day.segments?.some((segment) => segment.active))
    || programDays.find((day) => day.segments?.some((segment) => new Date(segment.ends_at) > new Date()))
    || programDays[0]

  if (companionLayout) {
    const isConfirmed = !hasRsvp || hub?.guest?.rsvp_status === 'confirmed'
    const consent = journey?.consent
    const needsConsent = !!(consent?.required && !consent.signed)
    const wantsMeal = journey?.menu_selectable && !journey?.menu_has_choices
    // Single highest-priority action, in the order a guest actually needs to
    // resolve them — never a queue of competing "do this" cards.
    let nextStep = { icon: '→', label: 'Next step', text: 'Present your Festio Pass at check-in.', urgent: false }
    if (hasRsvp && hub?.guest?.rsvp_status && hub.guest.rsvp_status !== 'confirmed') {
      nextStep = hub.guest.rsvp_status === 'pending'
        ? { icon: '⏳', label: 'Next step', text: "We'll notify you once your registration is reviewed.", urgent: false }
        : hub.guest.rsvp_status === 'waitlisted'
          ? { icon: '⏳', label: 'Next step', text: "We'll notify you if a spot opens up.", urgent: false }
          : { icon: '💬', label: 'Next step', text: 'Contact the host if this doesn’t look right.', urgent: false }
    } else if (needsConsent) {
      nextStep = { icon: '📝', label: 'Action required', text: `Sign ${consent.form?.title || 'your consent form'} before check-in.`, urgent: true }
    } else if (wantsMeal) {
      nextStep = { icon: '🍽️', label: 'Next step', text: 'Choose your food order on your Festio Pass.', urgent: false }
    } else if (passNextStep) {
      nextStep = { icon: '🎁', label: 'Next step', text: `After entry · ${passNextStep.title}`, urgent: false }
    } else if (hub?.guest?.admitted) {
      nextStep = { icon: '✓', label: "You're all set", text: 'Enjoy the event.', urgent: false }
    }

    // Journey checklist: every self-contained step rolls up as its own line,
    // except session_attendance (usually dozens of entries — check-in is
    // staff-scanned, not a guest action, so they collapse into one count)
    // and consent/meal, which already have a richer real-time source above.
    const rawSteps = (journey?.steps || []).filter((s) => s.status !== 'skipped')
    const sessionSteps = rawSteps.filter((s) => s.type === 'session_attendance')
    const otherSteps = rawSteps.filter((s) => !['session_attendance', 'consent', 'meal_selection'].includes(s.type))
    const journeyRows = []
    if (hasRsvp) journeyRows.push({ done: true, label: 'Registration completed' })
    if (hub?.guest?.qr_token) journeyRows.push({ done: true, label: 'Festio Pass ready' })
    if (consent?.required) journeyRows.push({ done: consent.signed, now: needsConsent, label: consent.signed ? 'Consent signed' : `Sign ${consent.form?.title || 'consent form'}` })
    if (journey?.menu_selectable) journeyRows.push({ done: journey.menu_has_choices, now: wantsMeal, label: journey.menu_has_choices ? 'Food order selected' : 'Choose your food order' })
    otherSteps.forEach((s) => journeyRows.push({ done: ['completed', 'overridden'].includes(s.status), now: s.actionable, label: s.title }))
    if (sessionSteps.length) {
      const sDone = sessionSteps.filter((s) => ['completed', 'overridden'].includes(s.status)).length
      journeyRows.push({ done: sDone === sessionSteps.length, label: `Attend your scheduled sessions — ${sDone}/${sessionSteps.length}` })
    }
    if (feedbackForms.length) journeyRows.push({ done: feedbackForms.every((f) => f.submitted), now: feedbackForms.some((f) => !f.submitted), label: 'Share event feedback' })
    let firstNow = false
    journeyRows.forEach((r) => { if (r.now) { if (firstNow) r.now = false; firstNow = true } })
    const journeyDone = journeyRows.filter((r) => r.done).length

    const dateLabel = event?.event_date
      ? `${fmtDate(event.event_date, event.timezone)}${event.event_end_date ? ` – ${fmtDate(event.event_end_date, event.timezone)}` : ''}`
        + (event?.event_time_tbd ? '' : ` · ${fmtTime(event.event_date, event.timezone)}`)
      : ''
    const consolidatedVenue = [event?.venue_name, event?.venue_address].filter(Boolean).join(' · ')
    const hasExperienceModules = !!(passCells.some((c) => c.l === seatingTerm(event) || c.l === seatTerm(event)) || consent?.required || journey?.menu_enabled)

    return (
      <section className="py-2">
        <div className={`mx-auto w-full max-w-[560px] rounded-[1.65rem] border p-5 shadow-2xl backdrop-blur sm:p-6 fh-hub-style-${hubStyle}`}
          style={{ background: `linear-gradient(145deg, ${tone.background}, ${tone.surface})`, borderColor: tone.border, color: tone.text, boxShadow: `0 22px 48px ${tone.shadow}` }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold">FestioHub</h2>
              {hasRsvp && hub?.guest?.rsvp_status && (
                <span className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide" style={{ background: `${tone.accent}22`, color: tone.text }}>
                  {hub.guest.rsvp_status === 'confirmed' ? 'Attending' : hub.guest.rsvp_status}
                </span>
              )}
            </div>
          </div>

          {error && <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">{error}</div>}

          {/* Pass — primary tier: elevated, larger radius/shadow than every other card */}
          {isConfirmed ? (
            <div className="mt-5 rounded-[1.4rem] border-2 p-5 text-center" style={{ background: tone.panelStrong, borderColor: `${tone.accent}66`, boxShadow: `0 0 40px -10px ${tone.accent}55` }}>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: `${tone.accent}22`, color: tone.accent }}>
                <span aria-hidden="true">{passStatus.icon}</span>{passStatus.label}
              </span>
              <div className="mt-3 text-sm font-semibold" style={{ color: tone.muted }}>Welcome,</div>
              <div className="text-xl font-extrabold">{hub?.guest?.name || 'Guest'}</div>
              {hub?.guest?.qr_token && (
                <div className="relative mx-auto mt-4 max-w-[240px] rounded-2xl bg-white p-3">
                  <img src={previewMock ? PREVIEW_QR_DATA_URI : `/api/scan/${hub.guest.qr_token}/qr.png`} alt="Your QR pass code" className="mx-auto h-48 w-48" />
                </div>
              )}
              {hub?.guest?.qr_token && <div className="mt-3 text-xs font-bold" style={{ color: tone.label }}>Your Festio Pass · show this at check-in</div>}
              {hub?.guest?.qr_token && (
                <div className="mt-4 grid gap-2">
                  <a href={`/scan/${hub.guest.qr_token}`} style={colors.accent ? { background: colors.accent } : undefined} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-5 py-3 text-base font-extrabold text-slate-950 shadow-sm hover:bg-teal-300">
                    🎫 View Full Pass
                  </a>
                  {hubModuleVisible('festiome') && hub?.capabilities?.festiome && (
                    <a href={`/festiome/guest?event=${encodeURIComponent(event.id)}&pass=${encodeURIComponent(hub.guest.qr_token)}`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 px-5 py-2.5 text-sm font-extrabold" style={{ background: tone.chip, borderColor: colors.accent || tone.text, color: tone.text }}>
                      💬 Open FestioMe
                    </a>
                  )}
                </div>
              )}
              {event?.registry_enabled && event?.registry_token && (
                <a href={`/registry/${event.registry_token}`} className="mt-2 flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold" style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}>
                  🎁 View gift list
                </a>
              )}
            </div>
          ) : (
            <div className="mt-5 rounded-[1.4rem] border-2 p-6 text-center" style={{ background: tone.panelStrong, borderColor: tone.border }}>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: `${tone.accent}22`, color: tone.accent }}>{passStatus.icon} {hub?.guest?.rsvp_status || 'Pending'}</span>
              <p className="mt-3 text-sm" style={{ color: tone.muted }}>Your Festio Pass appears here once you're confirmed.</p>
            </div>
          )}

          {/* Next step — primary tier */}
          <div className="mt-3 flex items-start gap-3 rounded-2xl border p-4" style={{ background: nextStep.urgent ? `${tone.accent}18` : tone.panel, borderColor: nextStep.urgent ? tone.accent : tone.border }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base" style={{ background: tone.accent, color: tone.background }} aria-hidden="true">{nextStep.icon}</span>
            <div><div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: tone.accent }}>{nextStep.label}</div><div className="mt-0.5 font-bold">{nextStep.text}</div></div>
          </div>

          {/* Your Event Journey — only when Experience is actually enabled */}
          {journey?.experience_enabled && journeyRows.length > 0 && (
            <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <button type="button" onClick={() => setShowAllActivity((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
                <span className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Your Event Journey</span>
                <span className="text-xs font-extrabold" style={{ color: tone.accent }}>{journeyDone}/{journeyRows.length} {showAllActivity ? '▾' : '▸'}</span>
              </button>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: `${tone.accent}22` }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(100 * journeyDone / journeyRows.length)}%`, background: tone.accent }} />
              </div>
              {showAllActivity && (
                <ol className="mt-3 space-y-2">
                  {journeyRows.map((r, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-extrabold" style={{ background: r.done ? tone.accent : r.now ? `${tone.accent}55` : `${tone.accent}18`, color: r.done ? tone.background : tone.text }}>{r.done ? '✓' : i + 1}</span>
                      <span style={{ color: r.done && !r.now ? tone.muted : tone.text, fontWeight: r.now ? 700 : 500 }}>{r.label}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Event Details — one consolidated block; hotel folds in here too */}
          <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Event Details</div>
            <div className="mt-3 space-y-2.5 text-sm">
              {dateLabel && <div className="flex items-center gap-2.5"><span aria-hidden="true">📅</span><span className="font-bold">{dateLabel}</span></div>}
              {consolidatedVenue && <div className="flex items-start gap-2.5"><span aria-hidden="true" className="mt-0.5">📍</span><a href={event.venue_address ? mapUrl(event.venue_address) : undefined} target="_blank" rel="noopener noreferrer" className="font-bold underline decoration-2 underline-offset-2" style={{ color: tone.accent }}>{consolidatedVenue}</a></div>}
              {(event?.hotel_name || event?.hotel_address) && <div className="flex items-start gap-2.5"><span aria-hidden="true" className="mt-0.5">🏨</span><a href={event.hotel_address ? mapUrl(event.hotel_address) : undefined} target="_blank" rel="noopener noreferrer" className="font-bold underline decoration-2 underline-offset-2" style={{ color: tone.accent }}>{[event.hotel_name, event.hotel_address].filter(Boolean).join(' · ')}</a></div>}
            </div>
          </div>

          {/* Your Experience — only the modules this event actually uses */}
          {hasExperienceModules && (
            <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <div className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Your Experience</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {passCells.filter((c) => c.l !== 'Status' && c.l !== 'Venue').map((cell) => (
                  <div key={cell.l} className="rounded-xl border p-2.5" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: tone.label }}><span aria-hidden="true">{cell.ic}</span>{cell.l}</div>
                    <div className="mt-0.5 text-sm font-extrabold">{cell.v}</div>
                  </div>
                ))}
                {consent?.required && (
                  <div className="rounded-xl border p-2.5" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: tone.label }}>Consent</div>
                    <div className="mt-0.5 text-sm font-extrabold" style={{ color: consent.signed ? tone.text : tone.accent }}>{consent.signed ? 'Signed ✓' : 'Action needed'}</div>
                  </div>
                )}
                {journey?.menu_enabled && (
                  <div className="rounded-xl border p-2.5" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: tone.label }}>Food order</div>
                    <div className="mt-0.5 text-sm font-extrabold">{journey.menu_has_choices ? 'Selected' : journey.menu_selectable ? 'Not yet' : 'Provided'}</div>
                  </div>
                )}
              </div>
              {consent?.form && !consent.signed && (
                <form onSubmit={submitConsent} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input value={signName} onChange={(e) => setSignName(e.target.value)} maxLength={255} placeholder={`Type your full name to sign ${consent.form.title}`}
                    className="min-h-11 flex-1 rounded-xl border px-4 py-2 text-sm placeholder-slate-400" style={{ background: tone.panel, borderColor: tone.border, color: tone.text }} />
                  <button disabled={signing || !signName.trim()} style={colors.accent ? { background: colors.accent } : undefined} className="min-h-11 rounded-xl bg-teal-400 px-5 py-2 text-sm font-extrabold text-slate-950 disabled:opacity-50">{signing ? 'Signing...' : 'Sign & agree'}</button>
                </form>
              )}
              {signError && <p className="mt-2 text-sm text-amber-400">{signError}</p>}
              {journey?.menu_selectable && hub?.guest?.qr_token && (
                <a href={`/scan/${encodeURIComponent(hub.guest.qr_token)}#orders`} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-extrabold text-slate-950" style={{ background: tone.accent }}>
                  {journey.menu_locked ? 'View order details' : journey.menu_has_choices ? 'View or change order' : 'Choose your order'}
                </a>
              )}
            </div>
          )}

          {/* Your Schedule */}
          {hubModuleVisible('live_program') && journey?.program?.enabled && (
            <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <div className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Your Schedule</div>
              {!!programDays.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {programDays.map((day) => <button key={day.date} type="button" onClick={() => setProgramDay(day.date)} className="rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ background: selectedProgramDay?.date === day.date ? tone.accent : tone.chip, color: selectedProgramDay?.date === day.date ? tone.background : tone.text }}>{day.label}</button>)}
                </div>
              )}
              {selectedProgramDay && (
                <div className="mt-3 divide-y" style={{ borderColor: tone.border }}>
                  {selectedProgramDay.segments.map((segment) => (
                    <div key={segment.step_id} className="flex gap-3 py-2.5 first:pt-0">
                      <div className="w-20 shrink-0 text-xs font-extrabold" style={{ color: segment.active ? tone.accent : tone.label }}>{fmtTime(segment.starts_at, event?.timezone)}</div>
                      <div className="min-w-0"><div className="font-bold">{segment.title}</div>{segment.description && <div className="text-xs" style={{ color: tone.muted }}>{segment.description}</div>}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Speakers — horizontal strip, not one card per person */}
          {speakersVisible && speakers?.length > 0 && (
            <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <div className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Featured Speakers</div>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {speakers.slice(0, 6).map((s) => (
                  <div key={s.id} className="w-16 shrink-0 text-center">
                    {s.photo_url ? <img src={s.photo_url} alt="" className="mx-auto h-12 w-12 rounded-full object-cover" /> : <div className="mx-auto grid h-12 w-12 place-items-center rounded-full text-base" style={{ background: tone.chip }}>🎤</div>}
                    <div className="mt-1.5 truncate text-[10.5px] font-bold">{s.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event Updates — only when there's something real to show */}
          {!!hub?.announcements?.length && (
            <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <div className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Event Updates</div>
              <div className="mt-3 space-y-2.5">
                {hub.announcements.slice(0, 3).map((a) => (
                  <div key={a.id} className="rounded-xl border p-3" style={{ background: tone.chip, borderColor: tone.border }}>
                    <div className="text-sm font-bold">{a.title}</div>
                    <p className="mt-1 text-xs leading-6" style={{ color: tone.muted }}><LinkifiedText text={a.body} color={tone.accent} /></p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Need Help — Message Host + Guest Chat folded under one card */}
          <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: tone.label }}>Need Help?</div>
            {hub?.capabilities?.direct_host_messages ? (
              <>
                <div className="mt-3 max-h-40 space-y-2 overflow-auto">
                  {hub?.direct_messages?.length ? hub.direct_messages.map((m) => (
                    <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.sender_type === 'guest' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`} style={{ background: m.sender_type === 'guest' ? `${tone.accent}22` : tone.chip, color: tone.text }}>{m.body}</div>
                  )) : <p className="text-sm" style={{ color: tone.label }}>Have a question for the organizer? Ask below.</p>}
                </div>
                <form onSubmit={sendMessage} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="Ask the host a question..." className="min-h-11 flex-1 rounded-xl border px-4 py-2 text-sm" style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }} />
                  <button disabled={sending || !message.trim()} style={colors.accent ? { background: colors.accent } : undefined} className="min-h-11 rounded-xl bg-teal-400 px-5 py-2 text-sm font-extrabold text-slate-950 disabled:opacity-50">{sending ? 'Sending...' : 'Send'}</button>
                </form>
              </>
            ) : (
              <p className="mt-2 text-sm" style={{ color: tone.label }}>Message Host isn't enabled for this event.</p>
            )}
            {hub?.capabilities?.guest_chat && (
              <>
                <div className="mt-4 border-t pt-3" style={{ borderColor: tone.border }}>
                  <div className="text-xs font-extrabold uppercase tracking-wide" style={{ color: tone.label }}>Guest Chat</div>
                  <div className="mt-2 max-h-40 space-y-2 overflow-auto">
                    {hub?.chat_messages?.length ? hub.chat_messages.map((m) => (
                      <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.guest_id === hub?.guest?.id ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[85%]'}`} style={{ background: m.guest_id === hub?.guest?.id ? `${tone.accent}22` : tone.chip, color: tone.text }}>{m.body}</div>
                    )) : <p className="text-sm" style={{ color: tone.label }}>A shared space for attending guests — no messages yet.</p>}
                  </div>
                  {hub?.capabilities?.guest_chat_posting && (
                    <form onSubmit={sendChat} className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input value={chatMessage} onChange={(e) => setChatMessage(e.target.value)} maxLength={1000} placeholder="Send a message to guests..." className="min-h-11 flex-1 rounded-xl border px-4 py-2 text-sm" style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }} />
                      <button disabled={sendingChat || !chatMessage.trim()} className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-extrabold text-slate-950 disabled:opacity-50">{sendingChat ? 'Sending...' : 'Send'}</button>
                    </form>
                  )}
                </div>
              </>
            )}
            {showInstallDialog && (
              <div className="mt-4 rounded-xl border p-3" style={{ background: tone.panelStrong, borderColor: tone.accent }}>
                <div className="text-sm font-extrabold">Install FestioHub</div>
                <p className="mt-1 text-xs" style={{ color: tone.muted }}>Keep your Pass on your home screen for quick access.</p>
                <div className="mt-2 flex gap-2"><button type="button" onClick={installPass} className="min-h-9 rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-950" style={{ background: tone.accent }}>Install</button><button type="button" onClick={dismissInstall} className="min-h-9 rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: tone.border, color: tone.text }}>Not now</button></div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs" style={{ borderColor: tone.border, color: tone.label }}>
              {installPrompt && <button type="button" onClick={installPass} className="font-bold underline" style={{ color: tone.accent }}>Add to Home Screen</button>}
              {pushConfig && pushState !== 'enabled' && pushState !== 'blocked' && <button type="button" onClick={enablePush} disabled={pushBusy} className="font-bold underline" style={{ color: tone.accent }}>{pushBusy ? 'Enabling…' : 'Enable notifications'}</button>}
              {pushError && <span className="text-amber-400">{pushError}</span>}
            </div>
          </div>

          {feedbackForms.map((form, formIndex) => (
            <div id={formIndex === 0 ? 'feedback' : undefined} key={form.step_id} className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold">{form.title}</h3>
                  {form.description && <p className="mt-1 text-xs" style={{ color: tone.muted }}>{form.description}</p>}
                </div>
                {form.submitted && <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>Completed</span>}
              </div>
              {form.questions.length === 0 && form.external_url ? (
                form.embed_enabled ? (
                  <div className="mt-4 overflow-hidden rounded-xl border" style={{ borderColor: tone.border }}>
                    <iframe src={form.external_url} title={form.title} className="h-[70vh] w-full" style={{ border: 0 }} />
                  </div>
                ) : (
                  <a href={form.external_url} target="_blank" rel="noreferrer"
                    className="mt-4 inline-flex min-h-11 items-center rounded-xl px-5 py-2 text-sm font-extrabold"
                    style={{ background: tone.accent, color: tone.background }}>
                    Open feedback form ↗
                  </a>
                )
              ) : form.submitted && editingFeedback !== form.step_id ? (
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
        </div>
      </section>
    )
  }

  return (
    <section className="py-2">
      <div
        className={`mx-auto w-full max-w-[900px] rounded-[1.65rem] border p-5 shadow-2xl backdrop-blur sm:p-7 fh-hub-style-${hubStyle}`}
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

        {tabbed && (
          <div className={`mt-5 flex gap-1 rounded-2xl border p-1 fh-hub-tabs fh-hub-tabs-${hubStyle}`} style={{ background: tone.panel, borderColor: tone.border }} role="tablist" aria-label="FestioHub sections">
            {hubTabOrder.map((key) => HUB_TAB_META[key])
              .filter(([key]) => key !== 'program' || (journey?.program?.enabled && hubModuleVisible('live_program')))
              .filter(([key]) => key !== 'speakers' || speakersVisible)
              .filter(([key]) => key !== 'messages' || (hubModuleVisible('messages') && (hub?.capabilities?.direct_host_messages || hub?.capabilities?.guest_chat)))
              .map(([key, label, icon]) => (
                <button key={key} type="button" role="tab" aria-selected={hubTab === key} onClick={() => setHubTab(key)}
                  className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-extrabold"
                  style={{ background: hubTab === key ? tone.panelStrong : 'transparent' }}>
                  <span className="text-base leading-none" style={{ opacity: hubTab === key ? 1 : 0.55 }} aria-hidden="true">{icon}</span>
                  <span style={{ color: hubTab === key ? tone.accent : tone.muted }}>{label}</span>
                </button>
              ))}
          </div>
        )}

        {tabbed && hubTab === 'activity' && (
          <div className="mt-5 grid gap-3">
            {effectiveHubModules.filter((module) => module.visible !== false).map((module) => {
              const activityDetailShown = hubModuleVisible('activity_progress') && journey?.experience_enabled && journey.steps?.length > 0
              if (module.key === 'guest_pass' && hub?.guest?.qr_token) return (
                <a key={module.key} href={`/scan/${hub.guest.qr_token}`} className="flex min-h-16 items-center justify-between rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border, color: tone.text }}>
                  <span><span className="block text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>Festio Pass</span><strong className="mt-1 block">Show admission QR</strong></span><span aria-hidden="true">›</span>
                </a>
              )
              // The full "Your activity" checklist below already shows the next step and
              // progress bar, so skip these two compact duplicates whenever it will render.
              if (module.key === 'next_action' && journey?.next_steps?.[0] && !activityDetailShown) {
                const next = journey.next_steps[0]
                return <div key={module.key} className="rounded-2xl border p-5" style={{ background: tone.panelStrong, borderColor: tone.accent }}><div className="text-xs font-extrabold uppercase tracking-[0.18em]" style={{ color: tone.accent }}>Your next step</div><div className="mt-2 text-xl font-extrabold">{next.title}</div>{(next.guest_message || next.description) && <p className="mt-2 text-sm leading-6" style={{ color: tone.muted }}>{next.guest_message || next.description}</p>}</div>
              }
              if (module.key === 'activity_progress' && journey?.experience_enabled && !activityDetailShown) {
                const total = journey.total_count || journey.steps?.length || 0
                const done = journey.completed_count || 0
                const percent = total ? Math.round((done / total) * 100) : 0
                return <div key={module.key} className="rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}><div className="flex items-center justify-between"><strong>Activity progress</strong><span className="text-sm font-bold">{done}/{total}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: tone.chip }}><div className="h-full rounded-full" style={{ width: `${percent}%`, background: tone.accent }} /></div></div>
              }
              if (module.key === 'live_program' && journey?.program?.enabled) return (
                <button key={module.key} type="button" onClick={() => setHubTab('program')} className="rounded-2xl border p-4 text-left" style={{ background: tone.panel, borderColor: tone.border, color: tone.text }}><div className="flex items-center justify-between"><strong>Live Program</strong><span className="text-xs font-extrabold" style={{ color: tone.accent }}>VIEW ALL ›</span></div>{journey.program.current_segments?.[0] ? <div className="mt-3"><div className="text-xs font-extrabold uppercase" style={{ color: tone.label }}>Happening now</div><div className="mt-1 font-bold">{journey.program.current_segments[0].title}</div></div> : <p className="mt-2 text-sm" style={{ color: tone.muted }}>The next item will appear here when it begins.</p>}</button>
              )
              if (module.key === 'festiome' && hub?.capabilities?.festiome && hub?.guest?.qr_token) return (
                <a key={module.key} href={`/festiome/guest?event=${encodeURIComponent(event.id)}&pass=${encodeURIComponent(hub.guest.qr_token)}`} className="flex min-h-16 items-center justify-between rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border, color: tone.text }}><span><strong className="block">FestioMe community</strong><span className="mt-1 block text-sm" style={{ color: tone.muted }}>Announcements, groups and conversations</span></span><span aria-hidden="true">›</span></a>
              )
              if (module.key === 'messages' && (hub?.capabilities?.direct_host_messages || hub?.capabilities?.guest_chat)) return (
                <button key={module.key} type="button" onClick={() => setHubTab('messages')} className="flex min-h-16 items-center justify-between rounded-2xl border p-4 text-left" style={{ background: tone.panel, borderColor: tone.border, color: tone.text }}><span><strong className="block">Messages</strong><span className="mt-1 block text-sm" style={{ color: tone.muted }}>{hub?.direct_messages?.length ? `${hub.direct_messages.length} message${hub.direct_messages.length === 1 ? '' : 's'}` : 'Contact your event team'}</span></span><span aria-hidden="true">›</span></button>
              )
              return null
            })}
          </div>
        )}

        {tabActive('pass') && showInstallDialog && (
          <div role="dialog" aria-modal="true" aria-labelledby="install-guest-hub" className="mt-5 rounded-2xl border p-5 shadow-xl" style={{ background: tone.panelStrong, borderColor: tone.accent }}>
            <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: tone.accent, color: tone.background }}>F</span><div><h3 id="install-guest-hub" className="text-lg font-extrabold">Install FestioHub</h3><p className="mt-1 text-sm leading-6" style={{ color: tone.muted }}>Keep your Festio Pass on your home screen for quick access to your QR code and event updates.</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={installPass} className="min-h-11 rounded-xl px-4 py-2 text-sm font-extrabold text-slate-950" style={{ background: tone.accent }}>Install Festio</button><button type="button" onClick={dismissInstall} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold" style={{ borderColor: tone.border, color: tone.text }}>Not now</button></div>
          </div>
        )}

        {tabActive('pass') && <div className="mt-5 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
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
        </div>}

        {tabActive('pass') && pushConfig && <div className="mt-3 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
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

        {hubModuleVisible('live_program') && journey?.program?.enabled && tabActive('program') && <div className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-extrabold">Live Program</h3><p className="mt-1 text-sm" style={{ color: tone.muted }}>The program updates automatically as the event moves forward.</p></div><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>LIVE</span></div>
          {journey.program.current_segments?.length ? <div className="mt-4 space-y-2">{journey.program.current_segments.map((segment) => <div key={segment.step_id} className="rounded-xl border p-3" style={{ background: tone.chip, borderColor: tone.border }}><div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>Happening now{segment.category ? ` · ${segment.category}` : ''}</div><div className="mt-1 font-extrabold">{segment.title}</div>{segment.description && <p className="mt-1 text-sm" style={{ color: tone.muted }}>{segment.description}</p>}<p className="mt-2 text-xs font-semibold" style={{ color: tone.label }}>Until {fmtTime(segment.ends_at, event?.timezone)}</p></div>)}</div> : <p className="mt-4 text-sm" style={{ color: tone.muted }}>The next program item will appear here when it begins.</p>}
          {!!journey.program.next_segments?.length && <div className="mt-4 border-t pt-3" style={{ borderColor: tone.border }}><div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>Up next</div>{journey.program.next_segments.slice(0, 2).map((segment) => <div key={segment.step_id} className="mt-2 text-sm"><span className="font-bold">{fmtLocalDateTime(segment.starts_at, event?.timezone)}</span><span style={{ color: tone.muted }}> · {segment.title}</span></div>)}</div>}
          {tabActive('program') && !!selectedProgramDay && <div className="mt-4 border-t pt-3" style={{ borderColor: tone.border }}>
            <div className="flex flex-wrap gap-2" aria-label="Programme day">
              {programDays.map((day) => <button key={day.date} type="button" onClick={() => setProgramDay(day.date)} className="rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ background: selectedProgramDay.date === day.date ? tone.accent : tone.chip, color: selectedProgramDay.date === day.date ? tone.background : tone.text }}>{day.label}</button>)}
            </div>
            <div className="mt-3 text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>{selectedProgramDay.label} programme</div>
            <div className="mt-2 divide-y" style={{ borderColor: tone.border }}>
              {selectedProgramDay.segments.map((segment) => <div key={segment.step_id} className="py-3 first:pt-0 last:pb-0"><div className="flex gap-3"><div className="w-24 shrink-0 text-xs font-extrabold" style={{ color: segment.active ? tone.accent : tone.label }}>{fmtTime(segment.starts_at, event?.timezone)}–{fmtTime(segment.ends_at, event?.timezone)}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-bold">{segment.title}{segment.active && <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase" style={{ background: `${tone.accent}22`, color: tone.accent }}>Now</span>}</div>{segment.description && <p className="mt-1 text-sm" style={{ color: tone.muted }}>{segment.description}</p>}</div></div></div>)}
            </div>
          </div>}
        </div>}

        {tabActive('speakers') && speakersVisible && (
          <div className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
            <h3 className="text-lg font-extrabold">Speakers</h3>
            {speakers === null ? (
              <p className="mt-2 text-sm" style={{ color: tone.muted }}>Loading speakers…</p>
            ) : speakers.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: tone.muted }}>Speakers will appear here once announced.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {speakers.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl border p-3" style={{ background: tone.chip, borderColor: tone.border }}>
                    {s.photo_url
                      ? <img src={s.photo_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                      : <div className="h-11 w-11 shrink-0 rounded-full grid place-items-center text-lg" style={{ background: tone.panel }}>🎤</div>}
                    <div className="min-w-0">
                      <div className="font-extrabold truncate">{s.name}</div>
                      {s.title && <div className="text-xs truncate" style={{ color: tone.muted }}>{s.title}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tabActive('activity') && hubModuleVisible('activity_progress') && journey?.experience_enabled && journey.steps?.length > 0 && (() => {
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
              {(() => {
                // Long checklists collapse: keep pending steps in view, tuck
                // completed ones (and any overflow) behind a toggle.
                const pending = visible.filter((s) => !['completed', 'overridden'].includes(s.status))
                const collapsible = visible.length > 8
                const shown = !collapsible || showAllActivity ? visible : pending.slice(0, 8)
                const hiddenCount = visible.length - shown.length
                return (
                  <>
              <ol className="mt-4 space-y-2">
                {shown.map((s) => {
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
              {collapsible && (
                <button
                  type="button"
                  onClick={() => setShowAllActivity((v) => !v)}
                  className="mt-3 w-full rounded-xl border px-3 py-2 text-sm font-bold"
                  style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}
                >
                  {showAllActivity ? 'Show fewer steps' : `Show all ${visible.length} steps${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`}
                </button>
              )}
                  </>
                )
              })()}

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

        {tabActive('pass') && journey?.menu_selectable && hub?.guest?.qr_token && (
          <div className="mt-6 rounded-2xl border p-5" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: tone.chip }} aria-hidden="true">🍽️</span>
              <div>
                <h3 className="text-lg font-extrabold">Your order</h3>
                <p className="mt-1 text-sm leading-6" style={{ color: tone.muted }}>
                  {journey.menu_locked
                    ? 'Order selection opens after you check in.'
                    : journey.menu_has_choices
                      ? 'Your order is selected. You can review or update it on your Festio Pass.'
                      : 'Choose your food order on your Festio Pass.'}
                </p>
              </div>
            </div>
            <a
              href={`/scan/${encodeURIComponent(hub.guest.qr_token)}#orders`}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-extrabold text-slate-950"
              style={{ background: tone.accent }}
            >
              {journey.menu_locked ? 'View order details' : journey.menu_has_choices ? 'View or change order' : 'Choose your order'}
            </a>
          </div>
        )}

        {tabActive('activity') && !!journey?.menu_categories?.length && (() => {
          const cats = journey.menu_categories
          const days = [...new Set(cats.filter((c) => c.day_label).map((c) => c.day_label))]
          const day = days.includes(hubMenuDay) ? hubMenuDay : (days[0] || '')
          const visibleCats = days.length ? cats.filter((c) => !c.day_label || c.day_label === day) : cats
          return (
            <div className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
              <h3 className="text-lg font-extrabold">Food menu</h3>
              <p className="mt-1 text-sm" style={{ color: tone.muted }}>What is being served at this event.</p>
              {days.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Menu day">
                  {days.map((d) => (
                    <button key={d} type="button" onClick={() => setHubMenuDay(d)}
                      className="rounded-full px-3 py-1.5 text-xs font-extrabold"
                      style={{ background: day === d ? tone.accent : tone.chip, color: day === d ? tone.background : tone.text }}>
                      {d}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {visibleCats.map((cat) => {
                  const dashParts = cat.name.split(/\s*\u2014\s*/)
                  const slot = dashParts.length > 1 ? dashParts[0] : ''
                  const dish = dashParts.length > 1 ? dashParts.slice(1).join(' \u2014 ') : cat.name
                  const key = (slot || dish).toLowerCase()
                  const glyph = key.includes('lounge') || key.includes('snack') ? '\ud83c\udf7f'
                    : key.includes('dinner') ? '\ud83c\udf7d\ufe0f'
                    : key.includes('lunch') ? '\ud83c\udf5b'
                    : key.includes('breakfast') ? '\u2615'
                    : '\ud83c\udf74'
                  return (
                    <div key={cat.id} className="rounded-xl border p-4" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                      {slot && (
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: tone.accent }}>{slot}</div>
                      )}
                      <div className="mt-1 flex items-start gap-2 text-base font-extrabold leading-snug">
                        <span aria-hidden="true" className="text-lg leading-none">{glyph}</span>
                        <span>{dish}</span>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {cat.items.map((i) => (
                          <li key={i.id} className="flex items-start gap-2.5 text-sm leading-6">
                            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.accent }} />
                            <span>
                              <span className="font-semibold" style={{ color: tone.text }}>{i.name}</span>
                              {i.description ? <span style={{ color: tone.muted }}>{' — '}{i.description}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {tabActive('activity') && feedbackForms.map((form, formIndex) => (
          <div id={formIndex === 0 ? 'feedback' : undefined} key={form.step_id} className="mt-6 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold">{form.title}</h3>
                {form.description && <p className="mt-1 text-sm" style={{ color: tone.muted }}>{form.description}</p>}
              </div>
              {form.submitted && <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone.accent}22`, color: tone.text }}>Completed</span>}
            </div>
            {form.questions.length === 0 && form.external_url ? (
              form.embed_enabled ? (
                <div className="mt-4 overflow-hidden rounded-xl border" style={{ borderColor: tone.border }}>
                  <iframe src={form.external_url} title={form.title} className="h-[70vh] w-full" style={{ border: 0 }} />
                </div>
              ) : (
                <a href={form.external_url} target="_blank" rel="noreferrer"
                  className="mt-4 inline-flex min-h-11 items-center rounded-xl px-5 py-2 text-sm font-extrabold"
                  style={{ background: tone.accent, color: tone.background }}>
                  Open feedback form ↗
                </a>
              )
            ) : form.submitted && editingFeedback !== form.step_id ? (
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

        {tabsActive(['pass', 'messages']) && <div className="mt-6">
          <div className={`${tabActive('pass') ? '' : 'hidden'} rounded-2xl border p-4 md:mx-auto md:max-w-md`} style={{ background: tone.panel, borderColor: tone.border }}>
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: `${tone.accent}22`, color: tone.accent }}>
                <span aria-hidden="true">{passStatus.icon}</span>{passStatus.label}
              </span>
            </div>

            {hub?.guest?.qr_token && (
              <div
                className="relative mx-auto mt-4 max-w-[260px] rounded-[1.4rem] border-2 p-4"
                style={{ background: `linear-gradient(160deg, ${tone.accent}1f, ${tone.panelStrong})`, borderColor: `${tone.accent}55`, boxShadow: `0 0 32px -8px ${tone.accent}70` }}
              >
                <div className="rounded-2xl bg-white p-3">
                  <img
                    src={previewMock ? PREVIEW_QR_DATA_URI : `/api/scan/${hub.guest.qr_token}/qr.png`}
                    alt="Your QR pass code"
                    className="mx-auto h-40 w-40"
                  />
                </div>
              </div>
            )}

            <div className="mt-3 text-center">
              <div className="text-base font-extrabold">{hub?.guest?.name || 'Guest'}</div>
              {hasRsvp && hub?.guest?.rsvp_status && (
                <div className="mt-0.5 text-xs font-bold" style={{ color: tone.muted }}>
                  {hub.guest.rsvp_status === 'confirmed' ? 'Attending' : hub.guest.rsvp_status}
                </div>
              )}
            </div>

            {hub?.guest?.qr_token && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-bold" style={{ color: tone.label }}>
                <span aria-hidden="true">📶</span>Show this QR at the entrance
              </div>
            )}

            {!!passCells.length && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {passCells.map((cell) => (
                  <div key={cell.l} className="rounded-xl border p-2.5" style={{ background: tone.panelStrong, borderColor: tone.border }}>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: tone.label }}>
                      <span aria-hidden="true">{cell.ic}</span>{cell.l}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-sm font-extrabold leading-snug">{cell.v}</div>
                  </div>
                ))}
              </div>
            )}

            {passNextStep && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-dashed p-3" style={{ borderColor: tone.border }}>
                <span className="text-xs font-semibold" style={{ color: tone.muted }}>
                  <span aria-hidden="true">🎁</span> After entry · {passNextStep.title}
                </span>
                <button type="button" onClick={() => setHubTab('activity')} className="shrink-0 text-xs font-extrabold" style={{ color: tone.accent }}>
                  Open Activity →
                </button>
              </div>
            )}

            {hub?.guest?.qr_token && (
              <div className="mt-4 grid gap-2">
                <a href={`/scan/${hub.guest.qr_token}`} style={colors.accent ? { background: colors.accent } : undefined} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-5 py-3 text-base font-extrabold text-slate-950 shadow-sm hover:bg-teal-300">
                  🎫 View Festio Pass
                </a>
                {hubModuleVisible('festiome') && hub?.capabilities?.festiome && (
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

          <div className={`${tabActive('messages') ? '' : 'hidden'} rounded-2xl border p-4`} style={{ background: tone.panel, borderColor: tone.border }}>
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
        </div>}

        {tabActive('pass') && (event?.hotel_name || event?.hotel_address) && <div className="mt-4 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
          <div className="text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: tone.label }}>🏨 Hotel information</div>
          {event.hotel_name && <div className="mt-2 text-lg font-extrabold">{event.hotel_name}</div>}
          {event.hotel_address && <a href={mapUrl(event.hotel_address)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold leading-6 underline decoration-2 underline-offset-2 hover:opacity-80" style={{ color: tone.accent }}>{event.hotel_address}</a>}
        </div>}

        {tabActive('messages') && <div className="mt-4 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
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
        </div>}

        {tabActive('messages') && <div className="mt-4 rounded-2xl border p-4" style={{ background: tone.panel, borderColor: tone.border }}>
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
        </div>}
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
  const [paidTicketsAvailable, setPaidTicketsAvailable] = useState(null)
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
    api.publicDesignTheme(event.id, {
      experience_enabled: event.experience_enabled,
      live_program_enabled: event.live_program_enabled,
      festiome_enabled: event.festiome_addon_enabled && event.festiome_enabled,
    })
      .then((themePayload) => {
        // is_default only means "no Event Page template family selected" —
        // it doesn't mean nothing was customized. Discarding the whole
        // payload here threw away real colors/font/hub_style/wording any
        // event had saved (e.g. via the FestioHub tab's "Apply palette")
        // whenever the organizer hadn't separately picked a template too,
        // silently reverting the live page to hardcoded defaults.
        if (!cancelled) setDesignTheme(themePayload)
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

  const theme = inviteTheme(event)
  const dColors = designColors(designTheme, event)
  const tone = readableTone(dColors)
  const dWording = designTheme?.wording || {}
  const page = publicPageConfig(designTheme?.page_config)
  const dCover = designCover(designTheme, event)
  const pageHubStyle = HUB_STYLES.has(designTheme?.hub_style) ? designTheme.hub_style : 'wallet-pass'
  const isSidecardHero = HUB_SIDECARD_STYLES.has(pageHubStyle)
  // Rendered flyers already carry their own invitation heading and event name.
  // Keep the flyer as the hero instead of repeating that artwork in text —
  // but only when there's no separately uploaded cover photo taking its
  // place above (designCover()'s priority), since an uploaded photo has no
  // baked-in title and needs the normal title/host overlay restored.
  const flyerLedHero = !designTheme?.cover_image_url && !!designTheme?.flyer_image_url
  const atCapacity = event.rsvp_capacity != null && event.rsvp_count >= event.rsvp_capacity
  const deadlinePassed = !!event.deadline_passed
  const title = dWording.eventTitle || eventTitle(event)
  const dateLabel = dWording.date || (event.event_end_date
    ? fmtEventDateRange(event.event_date, event.event_end_date, event.timezone)
    : fmtDate(event.event_date, event.timezone))
  const timeLabel = event.event_time_tbd ? 'Time to be announced' : (dWording.time || fmtTime(event.event_date, event.timezone))
  const heroVenue = dWording.venue || event.venue_name || ''
  const heroAddress = dWording.address || event.venue_address || ''
  const venue = [heroVenue, heroAddress].filter(Boolean).join(' · ') || venueText(event)
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
  const shareUrl = publicInviteUrl(event)
  const capacityLabel = event.rsvp_capacity != null ? `${event.rsvp_count} / ${event.rsvp_capacity} spots claimed` : ''
  const capacityPct = event.rsvp_capacity ? Math.min(100, Math.round((event.rsvp_count / event.rsvp_capacity) * 100)) : 0
  const daysLeft = daysUntil(event.event_date)
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
  // Design Studio's FestioHub preview has no real guest/RSVP to derive a
  // token from — show the Hub anyway, with GuestHub's own preview-mock data,
  // so a hub_style choice is actually visible before publishing.
  const hasGuestHub = !!guestHubToken || isStudioPreview
  const primaryTarget = hasGuestHub ? 'guest-hub' : paidTicketsAvailable ? 'tickets' : 'rsvp'
  const primaryLabel = hasGuestHub ? 'Open FestioHub' : paidTicketsAvailable ? 'Get Tickets' : 'Confirm My RSVP'

  let rsvpPanel
  if (confirmed) {
    rsvpPanel = confirmed.rsvp_status === 'declined'
      ? <DeclinedView confirm={confirmed} />
      : confirmed.rsvp_status === 'pending'
        ? <PendingView confirm={confirmed} />
        : confirmed.rsvp_status === 'waitlisted'
          ? <WaitlistedView confirm={confirmed} />
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
        <TokenRSVPForm event={event} prefill={guest} token={token} theme={theme} onDone={setConfirmed} tone={tone} dWording={dWording} />
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
  } else if (prior) {
    rsvpPanel = (
      <div className="rounded-3xl border border-teal-200 bg-teal-50 p-5 text-center">
        <div className="text-2xl font-extrabold text-slate-950">You've already RSVP'd{prior.first_name ? `, ${prior.first_name}` : ''}.</div>
        <div className="mt-2 text-sm leading-relaxed text-slate-600">
          {prior.rsvp_status === 'declined'
            ? 'You let the host know you cannot make it.'
            : prior.rsvp_status === 'pending'
              ? 'Your RSVP is awaiting host approval.'
              : prior.rsvp_status === 'waitlisted'
                ? "You're on the waitlist — we'll email you if a spot opens up."
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
    rsvpPanel = (
      <div className="space-y-4">
        {atCapacity && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-800">
            This event is at capacity — RSVPs below join the waitlist and we'll notify you if a spot opens up.
          </div>
        )}
        <RSVPForm event={event} theme={theme} onConfirmed={handleConfirmed} tone={tone} dWording={dWording} />
      </div>
    )
  }

  return (
    <div
      className={`invite-page min-h-screen bg-[radial-gradient(circle_at_18%_0%,rgba(20,184,166,0.24),transparent_36rem),linear-gradient(140deg,#07111f_0%,#0f172a_48%,#132f38_100%)] gh-page-style-${pageHubStyle}`}
      style={{ ...themedPageBackground(dColors), color: tone.text, fontFamily: designFontFamily(designTheme) }}
    >
      <header className="px-5 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between">
          <div className="flex items-center gap-3">
            {event.logo_url && (
              <img
                src={event.logo_url} alt=""
                className="h-11 w-11 flex-none rounded-full object-cover sm:h-12 sm:w-12"
                style={{ border: `1px solid ${tone.border}`, background: tone.chip }}
              />
            )}
            {page.hero.showWelcomeLabel && (
              <span className="text-sm font-extrabold uppercase tracking-[0.24em]" style={{ color: tone.accent }}>{dWording.inviteLabel || 'Welcome to'}</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full border px-4 py-2 text-sm font-bold" style={{ background: tone.chip, borderColor: tone.border, color: tone.text }}>Powered by Festio</span>
            {flyerLedHero && !isSidecardHero && page.organizer.show && host && (hostWebsite
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

      {isSidecardHero ? (
        // Some templates (the original default's own look, and its restyled
        // siblings) put the photo beside the text instead of full-bleed above
        // it — no crop/legibility concerns since the photo isn't underneath
        // the text, so this branch is much simpler than the banner one below.
        <section className="mx-auto max-w-[1180px] px-5 py-10 sm:px-6 sm:py-16">
          <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center">
            <div
              className="w-full flex-none overflow-hidden rounded-2xl shadow-2xl"
              style={{
                maxWidth: `${page.hero.imageSize ?? 480}px`,
                aspectRatio: '4 / 5',
                backgroundSize: page.hero.imageFit === 'contain' ? 'contain' : 'cover',
                backgroundRepeat: 'no-repeat',
                backgroundColor: dColors.background,
                backgroundPosition: `${page.hero.focusX ?? 50}% ${page.hero.focusY ?? 20}%`,
                ...(dCover ? { backgroundImage: `url(${dCover})` } : heroFallbackBackground(dColors)),
              }}
            />
            <div className="flex-1 text-center sm:text-left">
              {/* Unlike the full-bleed hero below, a flyer image here sits in a small
                  side-card box and gets cropped to a 4:5 box — its baked-in title/host
                  text is often cut off, so (unlike full-bleed) always show the real
                  text title/host here rather than assuming the flyer already reads
                  fine on its own. */}
              {!page.hero.showTitle ? <h1 className="sr-only">{title}</h1> : <>
                {page.hero.showWelcomeLabel && <div className="text-sm font-extrabold uppercase tracking-[0.24em]" style={{ color: tone.accent }}>{dWording.heroInviteLabel || "You're invited"}</div>}
                <h1 className="mt-3 text-3xl font-extrabold leading-[1.08] sm:text-5xl" style={{ color: tone.text }}>{title}</h1>
              </>}
              {page.hero.showHost && host && (hostWebsite
                ? <a href={hostWebsite} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-lg font-semibold underline decoration-2 underline-offset-4 hover:opacity-80" style={{ color: tone.text }}>{host}</a>
                : <p className="mt-4 text-lg font-semibold" style={{ color: tone.text }}>{host}</p>)}
              {(heroWhen || heroVenue || heroAddress) && <div className="mt-4 space-y-1 text-base font-semibold" style={{ color: tone.muted }}>
                {heroWhen && <div>{heroWhen}</div>}
                {heroVenue && <div>{heroVenue}</div>}
                {heroAddress && <div>{heroAddress}</div>}
              </div>}
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:justify-start">
                <PrimaryButton
                  type="button"
                  className="gh-cta"
                  style={dColors.accent ? { background: dColors.accent } : undefined}
                  onClick={() => document.getElementById(primaryTarget)?.scrollIntoView({ behavior: 'smooth' })}
                >
                  {primaryLabel}
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
          </div>
        </section>
      ) : (
        <section
          className="gh-hero relative flex min-h-[70vh] items-center overflow-hidden px-5 py-14 sm:px-6 sm:py-20 lg:min-h-[80vh] lg:py-24"
          style={dCover ? undefined : heroFallbackBackground(dColors)}
        >
          {dCover && (
            // Most cover photos are tall/portrait flyers, not landscape. Two
            // earlier attempts didn't work: `cover` at the previous shorter
            // hero height cropped subjects out entirely; `contain` avoided
            // cropping but left the photo squeezed into a narrow letterboxed
            // strip with dead blurred space on both sides — it never felt like
            // a real banner. A real banner has to crop *something* off a
            // portrait photo to fill a wide frame; the fix is to crop less by
            // giving the hero real height (min-h-70/80vh above), bias the
            // default crop toward the top third (where a flyer's subject/
            // header usually sits), and let the organizer fine-tune the crop
            // via page.hero.focusX/focusY (Event Page tab, Design Studio).
            <div className="absolute inset-0" style={{ backgroundImage: `url(${dCover})`, backgroundSize: page.hero.imageFit === 'contain' ? 'contain' : 'cover', backgroundRepeat: 'no-repeat', backgroundColor: dColors.background, backgroundPosition: `${page.hero.focusX ?? 50}% ${page.hero.focusY ?? 20}%` }} />
          )}
          <div className="gh-hero-scrim absolute inset-0" />
          <div className="relative mx-auto max-w-[820px] text-center">
            {/* A solid backing panel, not just the directional scrim above —
                cover photos are sometimes designed flyers with their own
                baked-in text/graphics (not a plain photograph), and text
                floating directly on top of that clashes and becomes unreadable.
                The panel guarantees legibility regardless of what's in the photo. */}
            <div className="gh-hero-textpanel inline-block rounded-3xl px-6 py-8 sm:px-12 sm:py-10" style={(() => {
              const overlayPct = Math.max(0, Math.min(90, page.hero.overlayOpacity ?? 55))
              // backdrop-filter blurs whatever's behind the panel regardless of
              // the panel's own background alpha — at 0% darkness the rgba
              // background vanishes but a fixed blur would still visibly frost
              // the photo, so 0% never actually looked transparent. Scale the
              // blur down with the opacity so 0% is genuinely a no-op overlay.
              return { background: `rgba(10,10,15,${overlayPct / 100})`, backdropFilter: `blur(${(overlayPct / 90) * 6}px)` }
            })()}>
              {flyerLedHero || !page.hero.showTitle ? <h1 className="sr-only">{title}</h1> : <>
                {page.hero.showWelcomeLabel && <div className="text-sm font-extrabold uppercase tracking-[0.24em] text-white/85">{dWording.heroInviteLabel || "You're invited"}</div>}
                <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] text-white sm:text-6xl">{title}</h1>
              </>}
              {!flyerLedHero && page.hero.showHost && host && (hostWebsite
                ? <a href={hostWebsite} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-lg font-semibold text-white underline decoration-2 underline-offset-4 hover:opacity-80">{host}</a>
                : <p className="mt-4 text-lg font-semibold text-white">{host}</p>)}
              {(heroWhen || heroVenue || heroAddress) && <div className="mt-4 space-y-1 text-base font-semibold text-white/85">
                {heroWhen && <div>{heroWhen}</div>}
                {heroVenue && <div>{heroVenue}</div>}
                {heroAddress && <div>{heroAddress}</div>}
              </div>}
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <PrimaryButton
                  type="button"
                  className="gh-cta"
                  style={dColors.accent ? { background: dColors.accent } : undefined}
                  onClick={() => document.getElementById(primaryTarget)?.scrollIntoView({ behavior: 'smooth' })}
                >
                  {primaryLabel}
                </PrimaryButton>
                <SecondaryButton
                  type="button"
                  style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}
                  onClick={() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  View Event Details
                </SecondaryButton>
              </div>
            </div>
          </div>
        </section>
      )}

      <main className="mx-auto max-w-[1180px] px-5 pb-16 sm:px-6">
        <section className="py-8">
          <p className="mx-auto max-w-2xl whitespace-pre-line text-center text-lg leading-8" style={{ color: tone.muted }}>
            {dWording.rsvpNote || event.invite_message || 'Join us for a beautiful evening of celebration, food, memories, and good company.'}
          </p>
        </section>

        {hasGuestHub && (
          <section id="guest-hub" className="scroll-mt-6 py-6">
            <GuestHub event={event} accessToken={guestHubToken || (isStudioPreview ? 'preview' : '')} designTheme={designTheme} previewMock={isStudioPreview} confirmed />
          </section>
        )}

        <section id="details" className="grid gap-6 py-8 md:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
          <div className="gh-panel rounded-3xl border p-6 shadow-xl backdrop-blur sm:p-7" style={{ background: tone.panelStrong, borderColor: tone.border, boxShadow: `0 22px 48px ${tone.shadow}`, color: tone.text }}>
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="text-3xl font-extrabold">Event details</h2>
              {event.invite_countdown_enabled !== false && daysLeft !== null && daysLeft > 0 && (
                <span className="rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: tone.chip, color: tone.accent }}>
                  {daysLeft === 1 ? 'Tomorrow!' : `${daysLeft} days to go`}
                </span>
              )}
            </div>
            {event.invite_capacity_bar_enabled !== false && capacityLabel && (
              <div className="mb-5">
                <div className="mb-1 flex justify-between text-xs font-bold" style={{ color: tone.muted }}>
                  <span>{capacityLabel}</span>
                  <span>{capacityPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: tone.chip }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${capacityPct}%`, background: capacityPct >= 90 ? '#ef4444' : tone.accent || '#0d9488' }} />
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailRow icon="📅" label="Date" value={dateLabel} tone={tone} />
              <DetailRow icon="🕐" label="Time" value={timeLabel} tone={tone} />
              {page.details.showVenue && <DetailRow icon="📍" label="Venue" value={venue || 'Venue details coming soon'} tone={tone} href={event.venue_address ? mapUrl(event.venue_address) : ''} />}
              {page.details.showHotel && (event.hotel_name || event.hotel_address) && <DetailRow icon="🏨" label="Hotel information" value={[event.hotel_name, event.hotel_address].filter(Boolean).join(' · ')} tone={tone} href={event.hotel_address ? mapUrl(event.hotel_address) : ''} />}
              {page.details.showHost && <DetailRow icon="👤" label="Host" value={host} tone={tone} href={hostWebsite} />}
              {event.rsvp_enabled && <DetailRow icon="⏳" label="RSVP deadline" value={deadline} tone={tone} />}
              <DetailRow icon="🎟️" label="Admission" value="QR pass at entry" tone={tone} />
              {page.details.showAdmission && <DetailRow icon="✓" label="Admission note" value={admissionNote} tone={tone} />}
            </div>
            {externalUrl(dWording.hotelBookingUrl) && (
              <a
                href={externalUrl(dWording.hotelBookingUrl)}
                target="_blank" rel="noopener noreferrer"
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-extrabold transition hover:opacity-90"
                style={{ background: tone.accent, color: '#0a0a0a' }}
              >
                🏨 {dWording.hotelBookingLabel || 'Reserve Your Hotel Room'}
              </a>
            )}
          </div>

          {page.about.show && <div className="gh-panel rounded-3xl border p-6 shadow-xl backdrop-blur sm:p-7" style={{ background: tone.panelStrong, borderColor: tone.border, boxShadow: `0 22px 48px ${tone.shadow}`, color: tone.text }}>
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

        {/* Share & calendar row — shown on the public page when enabled */}
        {(event.invite_share_enabled !== false || event.invite_add_to_calendar_enabled !== false) && (
          <section className="py-4">
            <div className="flex flex-wrap items-center gap-3">
              {event.invite_share_enabled !== false && (
                <>
                  <a
                    href={whatsappShareUrl(`You're invited to ${event.name}!\nView event details: ${shareUrl}`)}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
                    style={{ background: '#25D366' }}
                  >
                    Share on WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(shareUrl); }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition hover:opacity-80"
                    style={{ borderColor: tone.border, background: tone.chip, color: tone.text }}
                  >
                    Copy invite link
                  </button>
                </>
              )}
              {event.invite_add_to_calendar_enabled !== false && !event.event_time_tbd && (
                <>
                  <a
                    href={googleCalUrl(event)}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition hover:opacity-80"
                    style={{ borderColor: tone.border, background: tone.chip, color: tone.text }}
                  >
                    📅 Add to Google Calendar
                  </a>
                  <button
                    type="button"
                    onClick={() => downloadICS(event)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition hover:opacity-80"
                    style={{ borderColor: tone.border, background: tone.chip, color: tone.text }}
                  >
                    📥 Save .ics
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* Ticket/registration listings are for people who haven't confirmed
            yet -- a guest who already has hub access (RSVP'd, on the
            imported list, or returning with a saved confirmation) doesn't
            need a prompt to go register externally on their own page. The
            public /tickets marketplace and the direct ticket link are
            untouched -- this only affects this personal confirmation view. */}
        {!hasGuestHub && (
          <PublicTicketCheckout eventId={event.id} tone={tone} onAvailabilityChange={setPaidTicketsAvailable} />
        )}

        {rsvpPanel && (paidTicketsAvailable === false || tokenMode) && (
          <section id="rsvp" className="scroll-mt-6 py-9">
            <div className="mx-auto w-full max-w-[680px] rounded-[1.65rem] border border-white/15 bg-white p-5 text-slate-950 shadow-2xl shadow-black/30 sm:p-8">
              {rsvpPanel}
            </div>
          </section>
        )}

        {!hasGuestHub && <GuestHub event={event} accessToken={guestHubToken} designTheme={designTheme} confirmed={false} />}
      </main>

      {!event.is_paid && (
        <footer className="pb-6 text-center text-xs font-semibold" style={{ color: tone.label }}>
          Powered by <a href="https://festio.events" className="underline underline-offset-2 hover:opacity-80">Festio</a>
        </footer>
      )}
    </div>
  )
}
