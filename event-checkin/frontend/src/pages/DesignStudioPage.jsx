import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

// Admin shell for the decoupled Festio Design Studio. Core event logic stays in
// the existing backend; this page only saves design settings through the
// auth-protected design proxy.

const TABS = ['Templates', 'Flyer', 'Event Page', 'Festio Pass', 'Email Preview', 'Publish']

const CATEGORY_OPTIONS = [
  ['birthday', 'Birthday'],
  ['wedding', 'Wedding'],
  ['nikkah-aqdu', 'Nikkah / Aqdu'],
  ['gala', 'Gala'],
  ['banquet', 'Banquet'],
  ['corporate', 'Corporate Event'],
  ['conference', 'Conference'],
  ['seminar', 'Seminar'],
  ['fundraiser', 'Fundraiser'],
  ['award-night', 'Award Night'],
  ['community', 'Community Event'],
  ['religious', 'Religious Event'],
  ['graduation', 'Graduation'],
  ['baby-shower', 'Baby Shower'],
  ['naming-ceremony', 'Naming Ceremony'],
  ['memorial', 'Memorial'],
  ['dinner-party', 'Dinner Party'],
  ['vip-private', 'VIP / Private Party'],
  ['concert-social', 'Concert / Social'],
  ['general-modern', 'General Modern Event'],
]

const STYLE_OPTIONS = [
  ['luxury', 'Luxury / Premium'],
  ['minimal', 'Modern Minimal'],
  ['festive', 'Colorful / Festive'],
  ['classic', 'Classic / Formal'],
  ['photo-first', 'Photo-first / Flyer-first'],
]

const FLYER_SIZES = [
  ['square', 'Square 1080 x 1080'],
  ['story', 'Story 1080 x 1920'],
  ['portrait', 'Portrait 1080 x 1350'],
  ['a5', 'Printable A5 PDF'],
  ['a4', 'Printable A4 PDF'],
]

const QR_POSITIONS = [
  ['bottom-right', 'Bottom right'],
  ['bottom-left', 'Bottom left'],
  ['center-bottom', 'Center bottom'],
]

const FONT_OPTIONS = [
  ['modern-sans', 'Modern sans'],
  ['classic-serif', 'Classic serif'],
  ['elegant-serif', 'Elegant serif'],
  ['display-rounded', 'Rounded display'],
  ['bold-sans', 'Bold sans'],
]

const WORDING_FIELDS = [
  ['inviteLabel', 'Invite label', "You're invited to"],
  ['eventTitle', 'Event title', 'Electron Jubilee'],
  ['eventSubtitle', 'Event subtitle', 'Celebrate with us'],
  ['hostName', 'Host name', 'Electron'],
  ['date', 'Date', 'Tuesday, August 18, 2026'],
  ['time', 'Time', '6:00 PM'],
  ['venue', 'Venue', 'The Electron Place'],
  ['address', 'Address', '655 Faiwt Wa, Jaty, TX'],
  ['rsvpBy', 'RSVP deadline', 'Kindly reply by July 7, 2026'],
  ['rsvpNote', 'RSVP note', 'Kindly RSVP by July 7.'],
  ['phone', 'Contact phone', '(281) 123-4567'],
  ['email', 'Contact email', 'hello@festio.events'],
  ['dressCode', 'Dress code', 'Elegant evening attire'],
  ['admissionNote', 'Admission note', 'Show your personal Festio Pass at the entrance.'],
  ['parkingNote', 'Parking note', 'Complimentary valet available.'],
  ['customMessage', 'Custom message', 'Join us for a night of food, music, memories, and celebration.'],
  ['footerMessage', 'Footer message', "I can't wait to celebrate with you."],
  ['footerNote', 'Footer note', 'Powered by Festio'],
]

const COLOR_FIELDS = [
  ['primary', 'Primary'],
  ['accent', 'Accent'],
  ['background', 'Background'],
  ['surface', 'Surface'],
  ['text', 'Text'],
]

const EMAIL_TYPES = [
  'Invitation email',
  'RSVP confirmation',
  'Festio Pass email',
  'Reminder email',
  'Broadcast email',
  'Check-in confirmation',
]

const SURFACE_LABELS = {
  event_page: 'RSVP page',
  flyer: 'Flyer',
  guest_hub: 'Guest Hub',
  festio_pass: 'Festio Pass',
  email: 'Email',
}

const input = 'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-teal-300/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
const label = 'mb-1 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400'

function fmtEventDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtEventTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function normalizeText(value, fallback) {
  const v = `${value || ''}`.trim()
  return v || fallback
}

function SectionTitle({ eyebrow, title, copy }) {
  return (
    <div>
      {eyebrow && <p className="text-xs font-black uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">{eyebrow}</p>}
      <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{title}</h2>
      {copy && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{copy}</p>}
    </div>
  )
}

function SurfaceBadge({ children }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
      {children}
    </span>
  )
}

function ThemeSwatches({ colors }) {
  return (
    <div className="flex gap-1.5">
      {['primary', 'accent', 'background', 'surface', 'text'].map((key) => (
        <span
          key={key}
          className="h-7 w-7 rounded-lg border border-slate-200 shadow-sm dark:border-white/10"
          style={{ background: colors[key] || '#e2e8f0' }}
          title={key}
        />
      ))}
    </div>
  )
}

function TemplatePreviewBlock({ template, onSelect, onPreview, selected }) {
  const c = template.defaultColors || {}
  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-slate-900 ${selected ? 'border-teal-500 ring-4 ring-teal-400/20' : 'border-slate-200 dark:border-white/10'}`}>
      <button
        type="button"
        onClick={onPreview}
        className="block h-36 w-full text-left"
        style={{ background: `linear-gradient(145deg, ${c.background || '#0f172a'}, ${c.surface || '#111827'})` }}
        aria-label={`Preview ${template.name}`}
      >
        <div className="flex h-full flex-col justify-between p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-white/12 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">{template.category}</span>
            <span className={`rounded-full px-2 py-1 text-[10px] font-black ${template.isFree ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
              {template.isFree ? 'Free' : 'Premium'}
            </span>
          </div>
          <div>
            <div className="text-xl font-black leading-tight" style={{ color: c.primary || '#fff' }}>{template.name}</div>
            <div className="mt-1 text-xs font-bold" style={{ color: c.accent || '#14b8a6' }}>{template.style}</div>
          </div>
        </div>
      </button>
      <div className="space-y-3 p-4">
        <ThemeSwatches colors={c} />
        <div className="flex flex-wrap gap-1.5">
          {(template.surfaces || []).slice(0, 5).map((surface) => (
            <SurfaceBadge key={surface}>{SURFACE_LABELS[surface] || surface}</SurfaceBadge>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onPreview} className="min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
            Preview
          </button>
          <button type="button" onClick={onSelect} className="min-h-10 rounded-xl bg-teal-500 px-3 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-teal-300">
            {selected ? 'Selected' : 'Select'}
          </button>
        </div>
      </div>
    </article>
  )
}

function flyerLayoutClass(template) {
  return (template?.flyerDefinition?.layout || template?.layout?.flyer || 'photo-right-curved-divider').replace(/[^a-z0-9]+/gi, '-')
}

function FlyerPreview({ template, colors, wording, coverImageUrl, imagePosition, qrEnabled, qrPosition }) {
  const justify = qrPosition === 'bottom-left' ? 'justify-start' : qrPosition === 'center-bottom' ? 'justify-center' : 'justify-end'
  const layout = flyerLayoutClass(template)
  const isLuxury = layout === 'photo-right-curved-divider'
  const photoStyle = coverImageUrl
    ? {
        backgroundImage: `url(${coverImageUrl})`,
        backgroundPosition: `${imagePosition.x}% ${imagePosition.y}%`,
        backgroundSize: `${imagePosition.zoom}% auto`,
      }
    : {}
  const titleStyle = isLuxury ? { fontFamily: '"Brush Script MT", "Segoe Script", cursive', color: colors.primary || '#D4AF37' } : { color: colors.primary || '#fff' }
  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div
        className={`relative aspect-[4/5] overflow-hidden rounded-[1.5rem] border border-white/10 shadow-2xl shadow-slate-950/25 flyer-preview-${layout}`}
        style={{ background: `linear-gradient(155deg, ${colors.background || '#0f172a'}, ${colors.surface || '#111827'})`, color: colors.text || '#fff' }}
      >
        <div className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(circle at 15% 12%, ${colors.accent || '#14b8a6'}55, transparent 22%), radial-gradient(circle at 90% 92%, ${colors.primary || '#fff'}55, transparent 26%)` }} />
        {['left-[10%] top-[6%]', 'left-[55%] top-[8%]', 'right-[8%] bottom-[10%]'].map((pos, i) => (
          <span key={pos} className={`absolute h-2.5 w-2.5 rotate-45 rounded-[2px] ${pos}`} style={{ background: i === 1 ? colors.accent : colors.primary, boxShadow: `0 0 18px ${colors.primary || '#fff'}` }} />
        ))}
        <span className="absolute right-[9%] top-[4%] h-14 w-12 rounded-full opacity-90" style={{ background: `linear-gradient(145deg, ${colors.primary || '#D4AF37'}, #3b2b08)` }} />
        <span className="absolute right-[1%] top-[8%] h-12 w-11 rounded-full bg-black/80" />
        <span className="absolute right-[8%] bottom-[6%] h-16 w-14 rounded-full opacity-90" style={{ background: `linear-gradient(145deg, ${colors.accent || '#F5C542'}, #4a2504)` }} />

        <div
          className={`absolute overflow-hidden bg-white/10 ${
            layout === 'photo-right-curved-divider'
              ? 'right-[-7%] top-0 h-full w-[50%] rounded-l-[48%] border-l-2'
              : layout === 'full-bleed-photo'
                ? 'inset-0'
                : layout === 'framed-center-card'
                  ? 'left-1/2 top-[8%] h-[22%] w-[32%] -translate-x-1/2 rounded-full border-4'
                  : 'right-[8%] top-[8%] h-[30%] w-[36%] rounded-[2rem] border-4'
          }`}
          style={{ borderColor: colors.primary || '#D4AF37' }}
        >
          {coverImageUrl ? (
            <div className={`h-full w-full bg-no-repeat ${layout === 'full-bleed-photo' ? 'opacity-55' : ''}`} style={photoStyle} />
          ) : (
            <div className="grid h-full place-items-center px-5 text-center text-xs font-black uppercase tracking-widest text-white/70">Upload photo</div>
          )}
        </div>

        <div
          className={`absolute z-10 ${
            layout === 'photo-right-curved-divider'
              ? 'left-[7%] top-[5%] w-[54%]'
              : layout === 'full-bleed-photo'
                ? 'inset-x-[8%] bottom-[7%] rounded-3xl bg-black/55 p-5'
                : layout === 'framed-center-card'
                  ? 'inset-[8%] flex flex-col items-center border p-5 text-center'
                  : 'inset-x-[7%] top-[9%]'
          }`}
          style={layout === 'framed-center-card' ? { borderColor: colors.primary, background: 'rgba(255,255,255,.72)' } : undefined}
        >
          <div className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: layout === 'framed-center-card' ? colors.text : colors.text || '#fff' }}>
            {wording.inviteLabel || "You're invited to"}
          </div>
          <div className="mt-1 text-sm font-black opacity-95">{wording.hostName}</div>
          <div className={`${layout === 'framed-center-card' ? 'mt-16 text-4xl' : 'mt-2 text-5xl'} font-black leading-none`} style={titleStyle}>{wording.eventTitle}</div>
          <p className={`mt-4 max-w-[62%] text-[11px] font-semibold leading-relaxed ${layout === 'framed-center-card' ? 'mx-auto max-w-[82%] text-slate-700' : 'text-white/90'}`}>
            {wording.eventSubtitle || wording.customMessage}
          </p>
          <div className={`mt-4 grid gap-2 text-[10px] font-black ${layout === 'framed-center-card' ? 'w-[78%]' : 'w-[66%]'}`}>
            {[
              ['▣', 'Date', wording.date],
              ['◷', 'Time', wording.time],
              ['⌖', 'Venue', wording.venue],
            ].map(([icon, labelText, value]) => (
              <div key={labelText} className="grid grid-cols-[26px_1fr] items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-lg text-[12px]" style={{ background: colors.primary, color: colors.background }}>{icon}</span>
                <span>
                  <span className="block text-[8px] uppercase tracking-widest" style={{ color: colors.primary }}>{labelText}</span>
                  <span className="block leading-tight">{value}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 w-[46%] rounded-xl border p-3" style={{ borderColor: colors.primary, background: 'rgba(255,255,255,.08)' }}>
            <div className="text-3xl font-black tracking-[0.16em]" style={{ color: colors.primary }}>RSVP</div>
            <div className="mt-1 text-[9px] font-black uppercase tracking-widest">{wording.rsvpBy || wording.rsvpNote}</div>
          </div>
        </div>
        <div className="absolute bottom-[4%] left-[8%] z-20 max-w-[44%] text-center text-xl leading-none" style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive', color: colors.primary }}>
          {wording.footerMessage || wording.footerNote}
        </div>
        {qrEnabled && (
          <div className={`absolute bottom-[5%] z-20 flex w-full px-[7%] ${justify}`}>
            <div className="grid h-20 w-20 grid-cols-5 gap-0.5 rounded-xl bg-white p-2">
              {Array.from({ length: 25 }).map((_, i) => (
                <span key={i} className={`rounded-[1px] ${[0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 16, 19, 20, 21, 23, 24].includes(i) ? 'bg-slate-950' : 'bg-slate-200'}`} />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">Live preview. Downloads render full-resolution PNG/PDF.</p>
    </div>
  )
}

function EventPagePreview({ colors, wording, coverImageUrl, mode = 'desktop' }) {
  return (
    <div className={`overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-950 shadow-xl dark:border-white/10 ${mode === 'mobile' ? 'mx-auto max-w-[320px]' : ''}`}>
      <div className="p-3" style={{ background: `radial-gradient(circle at 20% 0%, ${colors.accent || '#14b8a6'}55, transparent 48%), linear-gradient(140deg, ${colors.background || '#07111f'}, ${colors.surface || '#111827'})` }}>
        <div className="mb-4 flex items-center justify-between text-white">
          <span className="text-[10px] font-black uppercase tracking-[0.22em]">You're invited</span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold">Festio</span>
        </div>
        <div className={`grid gap-5 ${mode === 'mobile' ? '' : 'md:grid-cols-[0.9fr_1.1fr]'}`}>
          <div className="overflow-hidden rounded-2xl bg-white/10">
            {coverImageUrl ? (
              <div className="aspect-[4/5] bg-cover bg-center" style={{ backgroundImage: `url(${coverImageUrl})` }} />
            ) : (
              <div className="grid aspect-[4/5] place-items-center p-6 text-center">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: colors.accent || '#14b8a6' }}>Cover image</div>
                  <div className="mt-2 text-xl font-black" style={{ color: colors.primary || '#fff' }}>{wording.eventTitle}</div>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center p-2 text-white">
            <div className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: colors.accent || '#14b8a6' }}>You're invited to</div>
            <div className="mt-2 text-3xl font-black leading-tight" style={{ color: colors.primary || '#fff' }}>{wording.eventTitle}</div>
            <p className="mt-3 text-sm leading-6 text-slate-200">{wording.customMessage}</p>
            <div className="mt-4 grid gap-2 text-xs font-bold text-white sm:grid-cols-2">
              <span className="rounded-xl bg-white/10 p-3">{wording.date}</span>
              <span className="rounded-xl bg-white/10 p-3">{wording.time}</span>
              <span className="rounded-xl bg-white/10 p-3 sm:col-span-2">{wording.venue}</span>
            </div>
            <button type="button" className="mt-4 min-h-11 rounded-xl px-4 py-2 text-sm font-black text-slate-950" style={{ background: colors.accent || '#14b8a6' }}>
              Confirm My RSVP
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PassPreview({ colors, wording, coverImageUrl }) {
  return (
    <div className="mx-auto max-w-[360px] overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900">
      <div className="h-28 bg-cover bg-center" style={{ backgroundImage: coverImageUrl ? `url(${coverImageUrl})` : `linear-gradient(135deg, ${colors.background || '#0f172a'}, ${colors.accent || '#14b8a6'})` }} />
      <div className="p-5">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Festio Pass</div>
        <h3 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{wording.eventTitle}</h3>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-300">{wording.date} - {wording.time}</p>
        <div className="mt-5 grid place-items-center rounded-2xl bg-white p-4 shadow-inner">
          <div className="grid h-40 w-40 grid-cols-7 gap-1">
            {Array.from({ length: 49 }).map((_, i) => (
              <span key={i} className={`rounded-sm ${[0, 1, 2, 3, 6, 7, 9, 11, 13, 14, 16, 18, 20, 21, 24, 27, 28, 30, 32, 34, 36, 39, 41, 42, 43, 45, 48].includes(i) ? 'bg-slate-950' : 'bg-slate-200'}`} />
            ))}
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{wording.admissionNote}</p>
        <button type="button" className="mt-4 min-h-11 w-full rounded-xl px-4 py-2 text-sm font-black text-slate-950" style={{ background: colors.accent || '#14b8a6' }}>
          Open Guest Hub
        </button>
      </div>
    </div>
  )
}

function EmailPreview({ colors, wording, coverImageUrl, activeType, setActiveType }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-2">
        {EMAIL_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveType(type)}
            className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-bold ${activeType === type ? 'border-teal-400 bg-teal-50 text-teal-900 dark:bg-teal-400/10 dark:text-teal-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'}`}
          >
            {type}
          </button>
        ))}
      </div>
      <div className="mx-auto w-full max-w-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10">
        <div className="px-6 py-5 text-white" style={{ background: colors.background || '#08111f' }}>
          <div className="flex items-center justify-between">
            <strong>Festio</strong>
            <span className="text-xs font-bold text-white/70">Digital Invitation</span>
          </div>
          <h3 className="mt-6 text-3xl font-black" style={{ color: colors.primary || '#fff' }}>{activeType}</h3>
          <p className="mt-2 text-sm text-white/75">Your personal event experience is ready.</p>
        </div>
        {coverImageUrl && <img src={coverImageUrl} alt="" className="h-40 w-full object-cover" />}
        <div className="p-6 text-slate-800">
          <p className="text-sm">Hi Am,</p>
          <h4 className="mt-3 text-2xl font-black text-slate-950">You're invited to {wording.eventTitle}.</h4>
          <p className="mt-3 text-sm leading-6 text-slate-600">{wording.customMessage}</p>
          <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm">
            <div><strong>Date:</strong> {wording.date}</div>
            <div><strong>Time:</strong> {wording.time}</div>
            <div><strong>Venue:</strong> {wording.venue}</div>
          </div>
          <button type="button" className="mt-5 min-h-12 rounded-xl px-5 py-3 text-sm font-black text-slate-950" style={{ background: colors.accent || '#14b8a6' }}>
            View My Festio Pass
          </button>
          <p className="mt-5 text-xs leading-5 text-slate-500">This QR code is unique to you. Please do not share it.</p>
        </div>
      </div>
    </div>
  )
}

function PublishChecklist({ selectedTemplate, design, colors, wording, coverImageUrl }) {
  const items = [
    ['Template family selected', !!selectedTemplate],
    ['Flyer/cover image added', !!coverImageUrl],
    ['Event title set', !!wording.eventTitle],
    ['Date and time set', !!(wording.date && wording.time)],
    ['Venue or address set', !!(wording.venue || wording.address)],
    ['Theme colors selected', !!(colors.primary && colors.accent)],
    ['Published design version', !!design?.is_published],
  ]
  return (
    <div className="space-y-2">
      {items.map(([text, done]) => (
        <div key={text} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{text}</span>
          <span className={`rounded-full px-2 py-1 text-xs font-black ${done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}>
            {done ? 'Ready' : 'Missing'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DesignStudioPage() {
  const [eventId, setEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [tab, setTab] = useState('Templates')
  const [templates, setTemplates] = useState([])
  const [design, setDesign] = useState(null)
  const [filters, setFilters] = useState({ category: '', style: '', free: '', surface: '' })
  const [previewTemplate, setPreviewTemplate] = useState(null)
  const [outputs, setOutputs] = useState([])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [flyer, setFlyer] = useState({ size: 'portrait', qr: true, rsvpLink: true, qrPosition: 'bottom-right' })
  const [emailType, setEmailType] = useState(EMAIL_TYPES[0])

  const note = (text, err = false) => {
    setFlash({ text, err })
    window.setTimeout(() => setFlash(null), 4500)
  }

  useEffect(() => {
    api.listEvents().then(setEvents).catch(() => {})
    api.designTemplates('')
      .then((r) => setTemplates(r.templates || []))
      .catch(() => {
        setTemplates([])
        note('Design Studio is temporarily unavailable. Your event settings and guest data are safe.', true)
      })
  }, [])

  useEffect(() => {
    if (!eventId) {
      setDesign(null)
      setOutputs([])
      return
    }
    api.getEventDesign(eventId)
      .then(setDesign)
      .catch(() => {
        setDesign(null)
        note('Design Studio is temporarily unavailable. Your event settings and guest data are safe.', true)
      })
    api.designOutputs(eventId).then((r) => setOutputs(r.outputs || [])).catch(() => setOutputs([]))
  }, [eventId])

  const currentEvent = useMemo(() => events.find((e) => e.id === eventId) || null, [events, eventId])

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (filters.category && t.categoryKey !== filters.category && t.category !== filters.category) return false
      if (filters.style && t.styleKey !== filters.style && t.style !== filters.style) return false
      if (filters.free !== '' && t.isFree !== (filters.free === 'true')) return false
      if (filters.surface && !(t.surfaces || []).includes(filters.surface)) return false
      return true
    })
  }, [templates, filters])

  const selectedTpl = useMemo(
    () => templates.find((t) => t.id === design?.selected_template_id) || null,
    [templates, design],
  )

  const selectedFlyerTpl = useMemo(
    () => templates.find((t) => t.id === design?.selected_flyer_template_id) || selectedTpl,
    [templates, design, selectedTpl],
  )

  const baseColors = selectedTpl?.defaultColors || {}
  const colors = { ...baseColors, ...(design?.theme_config?.colors || {}) }
  const coverImageUrl = design?.asset_config?.cover_image_url || currentEvent?.invite_cover_image || ''
  const flyerCoverImageUrl = design?.asset_config?.flyer_image_url || ''
  const imagePosition = {
    x: Number(design?.asset_config?.image_position?.x ?? 50),
    y: Number(design?.asset_config?.image_position?.y ?? 50),
    zoom: Number(design?.asset_config?.image_position?.zoom ?? 115),
  }
  const defaultWords = {
    inviteLabel: "You're invited to",
    eventTitle: currentEvent?.name || 'Electron Jubilee',
    eventSubtitle: 'Celebrate with us',
    hostName: currentEvent?.host_name || currentEvent?.couples_name || 'Electron',
    date: fmtEventDate(currentEvent?.event_date) || 'Tuesday, August 18, 2026',
    time: fmtEventTime(currentEvent?.event_date) || '6:00 PM',
    venue: currentEvent?.venue_name || 'The Electron Place',
    address: currentEvent?.venue_address || '655 Faiwt Wa, Jaty, TX',
    rsvpBy: 'Kindly reply by July 7, 2026',
    rsvpNote: 'Kindly RSVP by July 7.',
    phone: '(281) 123-4567',
    email: 'events@festio.events',
    dressCode: 'Elegant evening attire',
    admissionNote: currentEvent?.admission_note || 'Show your personal Festio Pass at the entrance.',
    parkingNote: 'Parking and arrival details will be shared before the event.',
    customMessage: currentEvent?.description || currentEvent?.invite_message || 'Join us for a night of food, music, memories, and celebration.',
    footerMessage: "I can't wait to celebrate with you.",
    footerNote: 'Powered by Festio',
  }
  const wording = Object.fromEntries(
    WORDING_FIELDS.map(([key, , fallback]) => [key, normalizeText(design?.wording_config?.[key], defaultWords[key] || fallback)]),
  )

  async function patch(partial, successText = '') {
    if (!eventId) return note('Pick an event first.', true)
    setBusy(true)
    try {
      const merged = {
        selected_template_id: design?.selected_template_id,
        selected_flyer_template_id: design?.selected_flyer_template_id,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        ...partial,
      }
      const saved = await api.saveEventDesign(eventId, merged)
      setDesign(saved)
      if (successText) note(successText)
      return saved
    } catch (e) {
      note(e.message || 'Save failed', true)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function chooseTemplate(t) {
    await patch(
      {
        selected_template_id: t.id,
        selected_flyer_template_id: design?.selected_flyer_template_id || t.id,
        theme_config: {
          ...(design?.theme_config || {}),
          colors: { ...(design?.theme_config?.colors || {}) },
          fontPairing: design?.theme_config?.fontPairing || t.fontPairing,
          buttonStyle: design?.theme_config?.buttonStyle || t.buttonStyle,
        },
      },
      `Selected ${t.name}.`,
    )
  }

  async function chooseFlyerTemplate(t) {
    await patch({ selected_flyer_template_id: t.id }, `Flyer template set to ${t.name}.`)
  }

  const setColor = (key, value) => patch({ theme_config: { ...(design?.theme_config || {}), colors: { ...colors, [key]: value } } })
  const setThemeSetting = (key, value) => patch({ theme_config: { ...(design?.theme_config || {}), [key]: value } })
  const setWord = (key, value) => setDesign((d) => ({ ...(d || { event_id: eventId }), wording_config: { ...(d?.wording_config || {}), [key]: value } }))
  const setImagePosition = (key, value) => {
    const next = { ...imagePosition, [key]: Number(value) }
    setDesign((d) => ({ ...(d || { event_id: eventId }), asset_config: { ...(d?.asset_config || {}), image_position: next } }))
  }

  async function saveWording() {
    await patch({ wording_config: Object.fromEntries(WORDING_FIELDS.map(([key]) => [key, wording[key]])) }, 'Wording saved.')
  }

  async function saveFlyerSettings() {
    await patch(
      {
        wording_config: Object.fromEntries(WORDING_FIELDS.map(([key]) => [key, wording[key]])),
        asset_config: { ...(design?.asset_config || {}), image_position: imagePosition },
      },
      'Flyer settings saved.',
    )
  }

  async function upload(e) {
    const file = e.target.files?.[0]
    if (!file || !eventId) return
    setBusy(true)
    try {
      const meta = await api.uploadDesignAsset(eventId, file)
      await patch({ asset_config: { ...(design?.asset_config || {}), cover_image_url: meta.public_url } }, 'Image uploaded and set as the Design Studio cover.')
    } catch (err) {
      note(err.message || 'Upload failed', true)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  async function useCoverOnEventPage() {
    if (!eventId || !coverImageUrl) return
    setBusy(true)
    try {
      const updated = await api.updateInviteSettings(eventId, { invite_cover_image: coverImageUrl })
      setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)))
      note('Cover image applied to the live RSVP page settings.')
    } catch (e) {
      note(e.message || 'Could not update RSVP cover image.', true)
    } finally {
      setBusy(false)
    }
  }

  async function renderFlyer(fmt, useAsCover = false) {
    if (!eventId) return note('Pick an event first.', true)
    setBusy(true)
    try {
      await api.saveEventDesign(eventId, {
        wording_config: wording,
        asset_config: { ...(design?.asset_config || {}), image_position: imagePosition },
      })
      const result = await api.renderFlyer(eventId, {
        size: flyer.size,
        format: fmt || (['a5', 'a4'].includes(flyer.size) ? 'pdf' : 'png'),
        template_id: selectedFlyerTpl?.id,
        colors,
        wording,
        cover_image_url: coverImageUrl || undefined,
        image_position: imagePosition,
        qr_enabled: flyer.qr,
        qr_position: flyer.qrPosition,
        qr_data: flyer.qr && flyer.rsvpLink ? `https://festio.events/invite/${eventId}` : null,
      })
      if (useAsCover && result?.outputUrl) {
        const saved = await api.saveEventDesign(eventId, {
          asset_config: { ...(design?.asset_config || {}), image_position: imagePosition, flyer_image_url: result.outputUrl },
        })
        setDesign(saved)
        const updated = await api.updateInviteSettings(eventId, { invite_cover_image: result.outputUrl })
        setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)))
      }
      api.designOutputs(eventId).then((r) => setOutputs(r.outputs || [])).catch(() => {})
      note(useAsCover ? 'Flyer rendered, downloaded, and applied as the RSVP cover.' : 'Flyer rendered and downloaded.')
    } catch (err) {
      note(err.message || 'Render failed', true)
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!eventId) return note('Pick an event first.', true)
    setBusy(true)
    try {
      await api.saveEventDesign(eventId, { wording_config: wording })
      const published = await api.publishEventDesign(eventId)
      if (coverImageUrl) {
        const updated = await api.updateInviteSettings(eventId, { invite_cover_image: coverImageUrl })
        setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)))
      }
      setDesign((d) => ({ ...(d || {}), is_published: published.is_published, published_version: published.published_version, published_at: published.published_at }))
      note('Design published to RSVP pages, Guest Hub, Festio Passes, and the event cover used by emails.')
    } catch (e) {
      note(e.message || 'Publish failed', true)
    } finally {
      setBusy(false)
    }
  }

  const templateForPreview = previewTemplate || selectedTpl

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_340px] lg:p-7">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">Festio Design Studio</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Beautiful event pages, flyers, passes, and emails.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Pick a template family, upload your flyer or photo, edit wording, choose colors, preview every guest surface, then publish without changing RSVP, QR, Guest Hub, scanner, or messaging logic.
            </p>
            <div className="mt-5 grid gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 sm:grid-cols-3 lg:max-w-3xl">
              {['1. Choose a design', '2. Customize details', '3. Preview and publish'].map((step) => (
                <div key={step} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">{step}</div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <label className={label}>Current event</label>
            <select value={eventId || ''} onChange={(e) => setEventId(e.target.value)} className={input}>
              <option value="">Select an event</option>
              {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-white/5">
                <div className="text-xl font-black text-slate-950 dark:text-white">{templates.length || 100}+</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Templates</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-white/5">
                <div className="text-xl font-black text-slate-950 dark:text-white">20</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Categories</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-white/5">
                <div className="text-xl font-black text-slate-950 dark:text-white">5</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Surfaces</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {flash && (
        <div className={`mb-4 rounded-2xl px-4 py-3 text-sm font-semibold ${flash.err ? 'border border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-950/40 dark:text-red-200' : 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
          {flash.text}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-white/10">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`min-h-11 rounded-xl px-4 py-2 text-sm font-extrabold transition ${tab === name ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'}`}
          >
            {name}
          </button>
        ))}
      </div>

      {!eventId && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-500 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
          Select an event to start designing.
        </div>
      )}

      {eventId && tab === 'Templates' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <SectionTitle
              eyebrow="Choose a design"
              title="Start with one template family for the full guest experience."
              copy="Each family styles the RSVP page, downloadable flyer, Guest Hub, Festio Pass, and email theme together."
            />
            <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900 md:grid-cols-5">
              <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={input}>
                <option value="">All categories</option>
                {CATEGORY_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </select>
              <select value={filters.style} onChange={(e) => setFilters((f) => ({ ...f, style: e.target.value }))} className={input}>
                <option value="">All styles</option>
                {STYLE_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </select>
              <select value={filters.free} onChange={(e) => setFilters((f) => ({ ...f, free: e.target.value }))} className={input}>
                <option value="">Free & premium</option>
                <option value="true">Free</option>
                <option value="false">Premium</option>
              </select>
              <select value={filters.surface} onChange={(e) => setFilters((f) => ({ ...f, surface: e.target.value }))} className={input}>
                <option value="">All surfaces</option>
                <option value="event_page">RSVP page</option>
                <option value="flyer">Flyer</option>
                <option value="guest_hub">Guest Hub</option>
                <option value="festio_pass">Festio Pass</option>
                <option value="email">Email</option>
              </select>
              <button type="button" onClick={() => setFilters({ category: '', style: '', free: '', surface: '' })} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                Reset
              </button>
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{filteredTemplates.length} matching template families</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((template) => (
                <TemplatePreviewBlock
                  key={template.id}
                  template={template}
                  selected={template.id === selectedTpl?.id}
                  onSelect={() => chooseTemplate(template)}
                  onPreview={() => setPreviewTemplate(template)}
                />
              ))}
            </div>
          </section>
          <aside className="xl:sticky xl:top-24 xl:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <SectionTitle eyebrow="Preview" title={templateForPreview?.name || 'Select a template'} />
              {templateForPreview ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl p-4" style={{ background: `linear-gradient(145deg, ${templateForPreview.defaultColors.background}, ${templateForPreview.defaultColors.surface})` }}>
                    <div className="text-2xl font-black" style={{ color: templateForPreview.defaultColors.primary }}>{templateForPreview.name}</div>
                    <div className="mt-1 text-sm font-bold" style={{ color: templateForPreview.defaultColors.accent }}>{templateForPreview.style}</div>
                  </div>
                  <ThemeSwatches colors={templateForPreview.defaultColors} />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5"><strong>Layout</strong><br />{templateForPreview.layout?.eventPage}</div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5"><strong>Flyer</strong><br />{templateForPreview.layout?.flyer}</div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5"><strong>Pass</strong><br />{templateForPreview.layout?.pass}</div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5"><strong>Email</strong><br />{templateForPreview.layout?.email}</div>
                  </div>
                  <button type="button" onClick={() => chooseTemplate(templateForPreview)} className="min-h-12 w-full rounded-xl bg-teal-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-teal-300">
                    Use this family
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Preview a card to see its surfaces, colors, and layout rules.</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {eventId && tab === 'Flyer' && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="space-y-6">
            <SectionTitle
              eyebrow="Flyer Studio"
              title="Create a downloadable flyer without a blank canvas."
              copy="Use fixed zones, editable text, replaceable images, controlled colors, and optional RSVP QR/link output."
            />
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
              <label className={label}>Flyer template</label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTemplates.slice(0, 6).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => chooseFlyerTemplate(template)}
                    className={`rounded-xl border p-3 text-left ${selectedFlyerTpl?.id === template.id ? 'border-teal-400 bg-teal-50 dark:bg-teal-400/10' : 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5'}`}
                  >
                    <div className="text-sm font-black text-slate-950 dark:text-white">{template.name}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{template.layout?.flyer}</div>
                  </button>
                ))}
              </div>
              {selectedFlyerTpl?.flyerDefinition && (
                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-white/5">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Template layers</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(selectedFlyerTpl.flyerDefinition.layers || []).map((layer) => (
                        <span key={layer} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm dark:bg-slate-950 dark:text-slate-200">
                          {layer.replaceAll('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-white/5">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Editable zones</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(selectedFlyerTpl.flyerDefinition.editableZones || selectedFlyerTpl.textZones || []).slice(0, 14).map((zone) => (
                        <span key={zone} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm dark:bg-slate-950 dark:text-slate-200">
                          {zone.replaceAll('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900 md:grid-cols-2">
              <div>
                <label className={label}>Upload main photo</label>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="block w-full text-sm text-slate-600 dark:text-slate-300" />
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">JPG, PNG, or WEBP. The photo is placed inside the selected template mask/frame and can be repositioned below.</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" disabled={busy || !coverImageUrl} onClick={useCoverOnEventPage} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                  Use photo as RSVP cover
                </button>
                <button type="button" disabled={busy || !selectedFlyerTpl} onClick={() => renderFlyer('png', true)} className="min-h-11 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 hover:bg-teal-300 disabled:opacity-50">
                  Use rendered flyer as RSVP cover
                </button>
                {coverImageUrl && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Cover ready</span>}
                {flyerCoverImageUrl && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Rendered flyer cover ready</span>}
              </div>
              <div className="md:col-span-2">
                <label className={label}>Photo crop and position</label>
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    ['x', 'Horizontal', 0, 100],
                    ['y', 'Vertical', 0, 100],
                    ['zoom', 'Zoom', 100, 180],
                  ].map(([key, text, min, max]) => (
                    <label key={key} className="rounded-xl border border-slate-200 p-3 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-slate-300">
                      <span className="flex items-center justify-between gap-2">
                        <span>{text}</span>
                        <span>{imagePosition[key]}</span>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={imagePosition[key]}
                        onChange={(e) => setImagePosition(key, e.target.value)}
                        className="mt-3 w-full accent-teal-500"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
              <label className={label}>Edit invitation wording</label>
              <div className="grid gap-3 md:grid-cols-2">
                {WORDING_FIELDS.map(([key, text]) => (
                  <div key={key} className={key === 'customMessage' || key === 'admissionNote' ? 'md:col-span-2' : ''}>
                    <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">{text}</label>
                    {key === 'customMessage' || key === 'admissionNote' ? (
                      <textarea className={`${input} min-h-24`} value={wording[key] || ''} onChange={(e) => setWord(key, e.target.value)} />
                    ) : (
                      <input className={input} value={wording[key] || ''} onChange={(e) => setWord(key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
              <button type="button" disabled={busy} onClick={saveWording} className="mt-4 min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
                Save wording
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
              <label className={label}>Colors and typography</label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {COLOR_FIELDS.map(([key, text]) => (
                  <label key={key} className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    {text}
                    <input type="color" value={colors[key] || '#000000'} onChange={(e) => setColor(key, e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white p-1 dark:border-white/10" />
                  </label>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label}>Font style</label>
                  <select className={input} value={design?.theme_config?.fontPairing || selectedTpl?.fontPairing || 'modern-sans'} onChange={(e) => setThemeSetting('fontPairing', e.target.value)}>
                    {FONT_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Flyer format</label>
                  <select className={input} value={flyer.size} onChange={(e) => setFlyer((f) => ({ ...f, size: e.target.value }))}>
                    {FLYER_SIZES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold dark:border-white/10">
                  <input type="checkbox" checked={flyer.qr} onChange={(e) => setFlyer((f) => ({ ...f, qr: e.target.checked }))} className="h-4 w-4 accent-teal-500" />
                  Include RSVP QR
                </label>
                <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold dark:border-white/10">
                  <input type="checkbox" checked={flyer.rsvpLink} onChange={(e) => setFlyer((f) => ({ ...f, rsvpLink: e.target.checked }))} className="h-4 w-4 accent-teal-500" />
                  Use RSVP link
                </label>
                <select className={input} value={flyer.qrPosition} onChange={(e) => setFlyer((f) => ({ ...f, qrPosition: e.target.value }))}>
                  {QR_POSITIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy || !selectedFlyerTpl} onClick={() => renderFlyer('png')} className="min-h-12 rounded-xl bg-teal-500 px-5 py-3 text-sm font-black text-slate-950 hover:bg-teal-300 disabled:opacity-50">
                Download PNG
              </button>
              <button type="button" disabled={busy || !selectedFlyerTpl} onClick={() => renderFlyer('pdf')} className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                Download PDF
              </button>
              <button type="button" disabled={busy || !selectedFlyerTpl} onClick={() => renderFlyer('png', true)} className="min-h-12 rounded-xl border border-teal-400 px-5 py-3 text-sm font-black text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-200 dark:hover:bg-teal-400/10">
                Download PNG + use as cover
              </button>
              <button type="button" disabled={busy} onClick={saveFlyerSettings} className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                Save flyer settings
              </button>
            </div>

            {!!outputs.length && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
                <label className={label}>Recent rendered files</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {outputs.slice(0, 4).map((output) => (
                    <a key={output.url} href={output.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 dark:border-white/10 dark:text-teal-300 dark:hover:bg-white/5">
                      {output.filename}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <FlyerPreview
              template={selectedFlyerTpl}
              colors={colors}
              wording={wording}
              coverImageUrl={coverImageUrl}
              imagePosition={imagePosition}
              qrEnabled={flyer.qr}
              qrPosition={flyer.qrPosition}
            />
          </aside>
        </div>
      )}

      {eventId && tab === 'Event Page' && (
        <div className="space-y-6">
          <SectionTitle
            eyebrow="RSVP and Guest Hub preview"
            title="Preview how guests see the published event design."
            copy="The selected family, colors, cover image, and wording apply to the RSVP page and Guest Hub while existing RSVP behavior remains unchanged."
          />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <EventPagePreview colors={colors} wording={wording} coverImageUrl={coverImageUrl} />
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
              <h3 className="text-lg font-black text-slate-950 dark:text-white">Guest Hub preview</h3>
              <div className="mt-4 rounded-2xl p-4 text-white" style={{ background: `linear-gradient(145deg, ${colors.background || '#0f172a'}, ${colors.surface || '#111827'})` }}>
                <div className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: colors.accent || '#14b8a6' }}>Guest Hub</div>
                <div className="mt-2 text-2xl font-black" style={{ color: colors.primary || '#fff' }}>{wording.eventTitle}</div>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="rounded-xl bg-white/10 p-3">Event update: Doors open at 5:30 PM.</div>
                  <div className="rounded-xl bg-white/10 p-3">Message host: Available after RSVP acceptance.</div>
                  <div className="rounded-xl bg-white/10 p-3">Menu choice: Jollof rice bowl saved.</div>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                <button type="button" onClick={() => setTab('Flyer')} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                  Edit wording and colors
                </button>
                <button type="button" disabled={busy || !coverImageUrl} onClick={useCoverOnEventPage} className="min-h-11 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 hover:bg-teal-300 disabled:opacity-50">
                  Use cover on RSVP page
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className={label}>Mobile preview</label>
            <EventPagePreview colors={colors} wording={wording} coverImageUrl={coverImageUrl} mode="mobile" />
          </div>
        </div>
      )}

      {eventId && tab === 'Festio Pass' && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="space-y-6">
            <SectionTitle
              eyebrow="Festio Pass"
              title="Style the QR pass without touching QR logic."
              copy="Only visual presentation changes here. QR tokens, verification, admission states, and scanner behavior remain unchanged."
            />
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
              <label className={label}>Pass wording</label>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ['admissionNote', 'Admission wording'],
                  ['footerNote', 'Footer note'],
                  ['customMessage', 'Guest Hub intro'],
                ].map(([key, text]) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">{text}</label>
                    <textarea className={`${input} min-h-24`} value={wording[key] || ''} onChange={(e) => setWord(key, e.target.value)} />
                  </div>
                ))}
              </div>
              <button type="button" disabled={busy} onClick={saveWording} className="mt-4 min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950">
                Save pass wording
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {['Show table assignment', 'Show seat number', 'Show Guest Hub button'].map((text) => (
                <label key={text} className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200">
                  <input type="checkbox" defaultChecked className="h-4 w-4 accent-teal-500" />
                  {text}
                </label>
              ))}
            </div>
          </section>
          <aside>
            <PassPreview colors={colors} wording={wording} coverImageUrl={coverImageUrl} />
          </aside>
        </div>
      )}

      {eventId && tab === 'Email Preview' && (
        <div className="space-y-6">
          <SectionTitle
            eyebrow="Email visual integration"
            title="Preview the event design inside transactional emails."
            copy="Messaging can request this theme payload for invitations, RSVP confirmations, Festio Pass emails, reminders, broadcasts, and check-in confirmations. If design-service is unavailable, default Festio email styling is used."
          />
          <EmailPreview colors={colors} wording={wording} coverImageUrl={coverImageUrl} activeType={emailType} setActiveType={setEmailType} />
        </div>
      )}

      {eventId && tab === 'Publish' && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-6">
            <SectionTitle
              eyebrow="Publish"
              title="Review the design package before it goes live."
              copy="Publishing applies this design across public event surfaces through the design-service payload. Core RSVP, QR, messaging, scanner, seating, orders, registry, and delivery workflows are not changed."
            />
            <div className="grid gap-5 md:grid-cols-2">
              <EventPagePreview colors={colors} wording={wording} coverImageUrl={coverImageUrl} mode="mobile" />
              <PassPreview colors={colors} wording={wording} coverImageUrl={coverImageUrl} />
            </div>
          </section>
          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900 lg:sticky lg:top-24 lg:self-start">
            <div className="text-sm text-slate-500 dark:text-slate-400">Selected family</div>
            <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{selectedTpl?.name || 'No template selected'}</div>
            <div className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedTpl?.category} - {selectedTpl?.style}</div>
            <div className="mt-4">
              <ThemeSwatches colors={colors} />
            </div>
            <div className="mt-5">
              <PublishChecklist selectedTemplate={selectedTpl} design={design} colors={colors} wording={wording} coverImageUrl={coverImageUrl} />
            </div>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm dark:bg-white/5">
              <div><span className="font-bold">Status:</span> {design?.is_published ? `Published v${design.published_version}` : 'Draft'}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Last saved: {design?.updated_at ? new Date(design.updated_at).toLocaleString() : 'Not saved yet'}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Last published: {design?.published_at ? new Date(design.published_at).toLocaleString() : 'Not published yet'}</div>
            </div>
            <button type="button" disabled={busy || !selectedTpl} onClick={publish} className="mt-5 min-h-12 w-full rounded-xl bg-teal-500 px-5 py-3 text-sm font-black text-slate-950 hover:bg-teal-300 disabled:opacity-50">
              Publish to event
            </button>
          </aside>
        </div>
      )}
    </div>
  )
}
