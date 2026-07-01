import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'

const DEMO_URL = ''
const CONTACT_EMAIL = 'info@devopclinics.com'
const demoHref = DEMO_URL || `mailto:${CONTACT_EMAIL}?subject=Book%20a%20demo%20%E2%80%94%20Festio`
const demoProps = DEMO_URL ? { href: DEMO_URL, target: '_blank', rel: 'noopener noreferrer' } : { href: demoHref }

function SunIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

function ArrowIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  )
}

function CheckIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      })
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'} ${className}`}
    >
      {children}
    </div>
  )
}

function PrimaryCta({ children = 'Create Free Event', to = '/register', className = '' }) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-teal-500 px-6 py-3 text-sm font-extrabold text-slate-950 shadow-lg shadow-teal-950/20 transition hover:-translate-y-0.5 hover:bg-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${className}`}
    >
      {children}
      <ArrowIcon />
    </Link>
  )
}

function SecondaryCta({ children = 'Book a Demo', className = '' }) {
  return (
    <a
      {...demoProps}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/70 px-6 py-3 text-sm font-extrabold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-400 hover:bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 dark:focus:ring-offset-slate-950 ${className}`}
    >
      {children}
    </a>
  )
}

function LogoMark({ size = 'h-9 w-9', text = 'text-sm' }) {
  return (
    <span className={`${size} ${text} grid place-items-center rounded-xl bg-gradient-to-br from-teal-400 via-emerald-400 to-amber-300 font-black text-slate-950 shadow-sm`}>
      F
    </span>
  )
}

const trustChips = [
  'RSVP', 'Guest Management', 'Seating', 'Messaging', 'QR Passes',
  'Check-In', 'Live Dashboard', 'Design Studio', 'Orders', 'Gift List', 'Registry', 'Deliveries',
]

const problemCards = [
  'Guest lists get messy',
  'RSVPs are hard to track',
  'Invite links get forwarded',
  'Tables and seats cause confusion',
  'Staff keep calling the organizer',
  'Meal choices live in separate forms',
  'Gift claims and deliveries are tracked manually',
  'Guest questions are scattered',
  'No live view of attendance or access',
  'VIPs and restricted areas are hard to control',
]

const pillars = [
  {
    title: 'Create & Manage Events',
    copy: 'Create events, manage lifecycle, configure details, and control feature toggles.',
    items: ['Multi-event workspace', 'Draft, Active, Ended, Reopen', 'Venue and host details'],
  },
  {
    title: 'Invite & RSVP',
    copy: 'Public/private RSVP pages, personal links, deadlines, limits, approvals, and questions.',
    items: ['Open or closed RSVP', 'Capacity controls', 'Approval workflows'],
  },
  {
    title: 'Guest Management',
    copy: 'Manual entry, CSV/XLSX upload, sync, duplicate handling, tags, profiles, and status.',
    items: ['Import templates', 'Guest profiles', 'RSVP answers'],
  },
  {
    title: 'Seating & Access',
    copy: 'Tables, seats, sections, auto-assignment, partner pairing, zones, gates, and VIP rules.',
    items: ['Table groups', 'Zone permissions', 'Capacity rules'],
  },
  {
    title: 'Messaging & Guest Hub',
    copy: 'Templates, email/SMS/WhatsApp/MMS, broadcasts, announcements, guest chat, and inbox.',
    items: ['Editable templates', 'Message Host', 'Admin moderation'],
  },
  {
    title: 'Check-In & Live Operations',
    copy: 'QR scanning, search, walk-ins, self check-in, denied reasons, occupancy, and staff roles.',
    items: ['Phone scanner', 'Duplicate protection', 'Live operations'],
  },
  {
    title: 'Meals, Gifts & Logistics',
    copy: 'Menu selections, kitchen views, table totals, registry, shipments, vendors, and exports.',
    items: ['Guest menu orders', 'Gift list/registry', 'Deliveries and vendor exports'],
  },
]

const addOnHighlights = [
  {
    id: 'orders',
    title: 'Orders',
    copy: 'Collect meal choices, group items by category, see table totals, and track what has been served.',
    points: ['Menu categories', 'Guest selections', 'Kitchen view', 'Served tracking'],
  },
  {
    id: 'gift-list',
    title: 'Gift List & Registry',
    copy: 'Publish gift options, track item claims, manage cash funds, and keep registry activity tied to the guest list.',
    points: ['Gift items', 'Registry message', 'Cash funds', 'Claim tracking'],
  },
  {
    id: 'deliveries',
    title: 'Deliveries',
    copy: 'Manage shipments, packing status, vendor share pages, shipping addresses, and fulfillment exports.',
    points: ['Shipment items', 'Vendor page', 'Packing status', 'XLSX exports'],
  },
]

const designStudioBullets = [
  '100+ starter template families',
  '20 event categories',
  '5 styles per category',
  'Upload your own flyer or image',
  'Edit wording and colors',
  'Preview mobile and desktop',
  'Download PNG/PDF flyers',
  'Reuse design across RSVP, Guest Hub, Festio Passes, and emails',
]

const journey = [
  ['Create the event', 'Set event name, host, date, venue, address, description, and public event settings.'],
  ['Add or import guests', 'Upload spreadsheets, sync lists, remove duplicates, and assign pass types, tags, tables, and groups.'],
  ['Collect RSVPs', 'Use public or private RSVP pages, approval workflows, deadlines, custom questions, and capacity limits.'],
  ['Send Festio Passes', 'Send personalized QR passes by email, SMS, WhatsApp, or MMS after approval or confirmation.'],
  ['Engage guests', 'Use Guest Hub, announcements, message host, chat, reminders, and notification preferences.'],
  ['Manage event details', 'Handle seating, menu choices, orders, gifts, deliveries, vendors, and staff roles.'],
  ['Scan and operate live', 'Staff scan guests, manage gates and zones, approve walk-ins, prevent duplicates, and view live dashboards.'],
  ['Export and review', 'Export guest lists, attendance, table reports, catering summaries, vendor reports, and event records.'],
]

const detailSections = [
  {
    id: 'command-center',
    eyebrow: 'Organizer command center',
    title: 'A command center for every event you manage.',
    copy: 'Festio gives organizers one workspace to manage events, teams, roles, guests, feature toggles, message credits, paid unlocks, and live operations without jumping between tools.',
    points: ['Organization workspace', 'Multi-event management', 'Draft/Active/Ended/Reopen lifecycle', 'Team roles', 'Staff assignment', 'Staff permissions', 'Event pass unlocks', 'Message credit balance', 'Trial request flow'],
    alt: 'Festio event setup workspace showing event controls',
  },
  {
    id: 'guest-database',
    eyebrow: 'Guest database',
    title: 'Turn your guest list into a live event database.',
    copy: 'Import, clean, segment, approve, tag, seat, message, and track every guest from one place.',
    points: ['Manual guest add', 'CSV/XLSX upload', 'Import template', 'Export guest list', 'Google Sheets/OneDrive sync', 'Duplicate handling', 'RSVP status', 'Guest profiles', 'RSVP answers', 'Check-in history', 'Ticket types', 'Tags', 'Table groups', 'Personal invite links', 'Resend invites'],
    alt: 'Festio guest database with RSVP status and guest records',
  },
  {
    id: 'rsvp',
    eyebrow: 'RSVP and invitations',
    title: 'RSVPs that match how your event actually works.',
    copy: 'Run open or private RSVPs, set deadlines, control capacity, approve guests, collect custom answers, and automatically issue QR passes only when guests are accepted.',
    points: ['Public RSVP page', 'Personal invite links', 'Open/shared RSVP link', 'Closed/private RSVP mode', 'RSVP deadline', 'Max RSVP capacity', 'Approval-required RSVP mode', 'Custom RSVP questions', 'Cover/flyer image', 'RSVP theme/message', 'Attending/declined flow', 'RSVP update before deadline', 'No-reply reminders', 'Broadcasts to guest segments'],
    alt: 'Festio invitation and RSVP setup screen',
  },
  {
    id: 'messaging',
    eyebrow: 'Messaging and templates',
    title: 'Every message, under your control.',
    copy: 'Customize invitations, reminders, QR pass emails, RSVP confirmations, approval messages, broadcasts, admission alerts, and check-in confirmations across email, SMS, WhatsApp, and MMS.',
    points: ['Editable templates', 'Template preview', 'Test send', 'Reset to default', 'Variable helper list', 'Template audit history', 'Plain-text fallback', 'SMS/WhatsApp/MMS support', 'Notification consent preferences'],
    alt: 'Festio messaging and invite tools',
  },
  {
    id: 'guest-hub',
    eyebrow: 'Guest pass and Guest Hub',
    title: 'Give guests one beautiful place for everything.',
    copy: 'Each confirmed guest can access a personal pass page with their QR pass, event details, menu choices, partner pairing, notification preferences, updates, host messages, and chat when enabled.',
    points: ['Public pass page by QR token', 'QR code display', 'Pass status', 'Event details', 'Menu/order selection', 'Partner/plus-one pairing', 'Guest Hub', 'Event updates', 'Message host', 'Guest chat', 'Attending-only chat', 'Admin moderation'],
    alt: 'Festio guest pass and event invite page',
  },
  {
    id: 'seating',
    eyebrow: 'Seating',
    title: 'Seat guests without confusion.',
    copy: 'Create tables, set capacity, assign seats manually or automatically, reserve seats, group tables by section, pair partners, and prevent double-booking or over-capacity mistakes.',
    points: ['Tables', 'Capacity', 'Seating chart', 'Manual assignment', 'Auto assignment', 'Seat reservation', 'Table groups/sections', 'Bulk assignment', 'Partner pairing', 'Double-booking prevention', 'Staff section assignment'],
    alt: 'Festio seating and orders workspace',
  },
  {
    id: 'check-in',
    eyebrow: 'Access and check-in',
    title: 'Scan, verify, and guide guests instantly.',
    copy: 'Use phone-based scanning, manual search, self check-in, walk-in registration, gate rules, zones, pass permissions, and duplicate protection to manage entry with confidence.',
    points: ['Browser scanner', 'Camera QR scanning', 'Manual check-in/search', 'Admitted, already admitted, denied, invalid', 'Active-event requirement', 'Duplicate-scan protection', 'Admission notifications', 'Walk-in registration', 'Self check-in', 'Staff scanner permissions', 'Section/gate/zone scanning', 'Access denied reasons'],
    alt: 'Festio mobile QR pass scanner for event check-in',
  },
  {
    id: 'access-rules',
    eyebrow: 'Venue access rules',
    title: 'Access control for real venues.',
    copy: 'Create zones, gates, pass permissions, tag requirements, capacity rules, entry/exit modes, and live occupancy tracking for complex venues and VIP areas.',
    points: ['Zones/areas', 'Zone capacity', 'Entry/exit/both direction modes', 'Ticket type permissions', 'Guest tag requirements', 'Gate scan mode', 'Live occupancy', 'Peak arrival analytics', 'Zone flow analytics', 'Guest journey history'],
    alt: 'Festio venue access areas and gate rules',
  },
  {
    id: 'orders',
    eyebrow: 'Orders and menu',
    title: 'Meals and service, connected to the guest list.',
    copy: 'Let guests choose meals, manage menu categories and combinations, track orders by table, generate kitchen views, and mark meals served.',
    points: ['Menu categories', 'Menu items', 'Menu combinations', 'Guest menu choices', 'Public guest menu selection', 'Menu deadline behavior', 'Orders dashboard', 'Per-table order totals', 'Kitchen/orders view', 'Mark meal served'],
    alt: 'Festio orders view with meal totals by table',
  },
  {
    id: 'gift-list',
    eyebrow: 'Gift list and registry',
    title: 'Gift lists that stay tied to guests.',
    copy: 'Publish registry options, track item claims, manage cash funds, add store links, and keep gift activity connected to the guest record.',
    points: ['Gift registry', 'Registry message/settings', 'Store link unfurling', 'Cash funds', 'Guest item claims', 'Admin claim tracking', 'Claim reports', 'Registry exports'],
    alt: 'Festio gift list and registry claim tracking workspace',
  },
  {
    id: 'deliveries',
    eyebrow: 'Deliveries and fulfillment',
    title: 'Coordinate shipments, vendors, and pickup details.',
    copy: 'Manage delivery add-ons, shipment items, guest shipping addresses, vendor share pages, packing status, and exportable fulfillment reports.',
    points: ['Deliveries add-on', 'Shipments', 'Shipment items', 'Guest shipping addresses', 'Vendor share page', 'Packing status', 'Vendor XLSX export', 'Admin XLSX export'],
    alt: 'Festio delivery and vendor fulfillment workspace',
  },
  {
    id: 'analytics',
    eyebrow: 'Live dashboard and analytics',
    title: 'Know what is happening while it is happening.',
    copy: 'Track RSVPs, invite delivery, contact completeness, check-ins, VIP arrivals, pending guests, table reports, catering summaries, occupancy, and guest flow live.',
    points: ['Total guest count', 'RSVP breakdown', 'Confirmed/declined/pending/no-reply', 'Checked-in count', 'Recent admitted guests', 'Pending guests', 'Invite delivery stats', 'Contact completeness', 'Check-in timeline', 'VIP stats', 'Ticket-type breakdown', 'Table-group breakdown', 'Per-table reports', 'Catering/order summary', 'Live auto-refresh/SSE', 'Venue occupancy analytics'],
    alt: 'Festio live event dashboard and attendance analytics',
  },
]

const eventTypes = [
  ['Weddings & Nikkah/Aqdu', 'Manage family lists, approvals, table groups, partner pairing, meals, QR passes, and a calm guest arrival.'],
  ['Galas & banquets', 'Coordinate VIP guests, reserved tables, sponsors, catered service, access areas, and live arrival reporting.'],
  ['Conferences & seminars', 'Run check-in, sessions, pass types, staff roles, attendee messaging, and exportable attendance records.'],
  ['Community & religious events', 'Handle large guest lists, RSVPs, self check-in, volunteers, seating sections, and announcements.'],
  ['Fundraisers & award nights', 'Track donors, nominees, VIPs, table assignments, guest communication, and attendance in one dashboard.'],
  ['Private parties', 'Create a polished invite, collect RSVPs, send QR passes, message guests, and avoid door confusion.'],
  ['Corporate events', 'Control registrations, access, teams, check-in records, messaging, and event reporting with operational clarity.'],
  ['Multi-zone venue events', 'Use zones, gates, pass permissions, tag requirements, capacity limits, and occupancy analytics.'],
  ['Catered events', 'Collect menu choices, manage combinations, view per-table totals, and track served meals.'],
  ['Vendor-supported events', 'Coordinate deliveries, packing lists, vendor share pages, registry claims, and fulfillment exports.'],
]

const comparisonRows = [
  ['Branded RSVP page', true, false, true],
  ['Guest import/sync', false, false, true],
  ['Approval workflow', 'Some', false, true],
  ['QR passes', false, true, true],
  ['Seating/table assignment', false, false, true],
  ['Guest messaging', 'Basic', false, true],
  ['Guest Hub/chat', false, false, true],
  ['Zone/gate access rules', false, 'Basic', true],
  ['Menu/orders', false, false, true],
  ['Registry/deliveries', false, false, true],
  ['Live analytics', false, 'Basic', true],
  ['Team/staff roles', false, 'Basic', true],
]

function HeroVisual() {
  const stats = [
    ['RSVP yes', '318'],
    ['Checked in', '146'],
    ['VIP inside', '42'],
  ]
  return (
    <div className="relative" aria-label="Festio organizer dashboard, QR pass, seating, messaging, and orders preview">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-teal-300/30 via-amber-200/20 to-purple-300/25 blur-3xl" aria-hidden="true" />
      <div className="relative rounded-[1.75rem] border border-white/50 bg-white/85 p-4 shadow-2xl shadow-slate-950/15 backdrop-blur dark:border-white/10 dark:bg-slate-900/85">
        <div className="rounded-2xl bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-teal-300">Live Command Center</div>
              <div className="mt-1 text-lg font-black">Electron Jubilee</div>
            </div>
            <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200">Active</div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white/10 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-xl bg-white p-3 text-slate-950">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wider text-slate-500">Guest list</div>
                <div className="text-xs font-bold text-teal-700">Sync OK</div>
              </div>
              {[
                ['Am Ami', 'Attending', 'VIP', 'Table A2'],
                ['Mina Bello', 'Pending', 'Press', 'Review'],
                ['Tobi Khan', 'Checked in', 'Family', 'Seat 8'],
              ].map((row) => (
                <div key={row[0]} className="grid grid-cols-[1.2fr_0.9fr_0.7fr_0.9fr] items-center gap-2 border-t border-slate-100 py-2 text-[11px]">
                  {row.map((cell, index) => (
                    <span key={cell} className={index === 0 ? 'font-black' : 'text-slate-600'}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-gradient-to-br from-teal-300 to-emerald-300 p-3 text-slate-950">
              <div className="text-xs font-black uppercase tracking-wider">Festio Pass</div>
              <div className="mt-2 rounded-lg bg-white p-3">
                <div className="grid aspect-square grid-cols-5 gap-1">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <span key={i} className={`rounded-sm ${[0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 16, 19, 20, 21, 23, 24].includes(i) ? 'bg-slate-950' : 'bg-slate-200'}`} />
                  ))}
                </div>
              </div>
              <div className="mt-2 text-sm font-black">Am Ami</div>
              <div className="text-xs font-bold">VIP Gate · Table A2</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Seating</div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span key={i} className={`h-6 rounded ${i < 9 ? 'bg-teal-300' : 'bg-white/20'}`} />
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Guest Hub</div>
              <div className="mt-2 rounded-lg bg-white/10 p-2 text-xs text-slate-200">Announcement sent: Doors open at 5:30 PM.</div>
              <div className="mt-2 rounded-lg bg-teal-300/20 p-2 text-xs text-teal-100">3 guest questions waiting</div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Orders</div>
              <div className="mt-2 space-y-2 text-xs">
                <div className="flex justify-between"><span>Jollof</span><strong>96</strong></div>
                <div className="flex justify-between"><span>Veg plate</span><strong>32</strong></div>
                <div className="flex justify-between"><span>Served</span><strong>58%</strong></div>
              </div>
            </div>
            <div className="rounded-xl bg-white/10 p-3 md:col-span-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['Gift List', '38 claims', '12 registry items'],
                  ['Deliveries', '4 shipments', 'Vendor shared'],
                  ['Guest orders', '128 choices', 'By table'],
                ].map(([label, value, note]) => (
                  <div key={label} className="rounded-lg bg-white/[0.07] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                    <div className="mt-1 text-sm font-black text-white">{value}</div>
                    <div className="text-xs text-slate-300">{note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DesignStudioVisual() {
  const families = [
    ['Luxury Birthday', '#050816', '#D4AF37'],
    ['Modern Nikkah', '#F8FAFC', '#0E7C5A'],
    ['Photo Gala', '#0B1220', '#14B8A6'],
  ]
  return (
    <div className="relative" aria-label="Festio Design Studio preview showing template families, flyer editor, and guest surfaces">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-teal-300/25 via-amber-200/20 to-rose-300/25 blur-3xl" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/55 bg-white/90 p-4 shadow-2xl shadow-slate-950/15 backdrop-blur dark:border-white/10 dark:bg-slate-900/90">
        <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-300">Design Studio</div>
                <div className="mt-1 text-lg font-black">Choose a design</div>
              </div>
              <div className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold">100+ families</div>
            </div>
            <div className="mt-4 space-y-3">
              {families.map(([name, bg, accent], index) => (
                <div key={name} className={`rounded-xl border p-3 ${index === 0 ? 'border-teal-300 bg-white/10' : 'border-white/10 bg-white/[0.04]'}`}>
                  <div className="h-20 rounded-lg p-3" style={{ background: `linear-gradient(135deg, ${bg}, ${accent})` }}>
                    <div className="text-sm font-black" style={{ color: index === 1 ? '#0f172a' : '#fff' }}>{name}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: index === 1 ? '#334155' : '#e2e8f0' }}>RSVP + Flyer + Pass + Email</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-[#fbf7ef] p-4 dark:border-white/10 dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">Flyer editor</div>
                  <div className="mt-1 text-lg font-black text-slate-950 dark:text-white">Electron Jubilee</div>
                </div>
                <div className="rounded-full bg-teal-100 px-3 py-1 text-[10px] font-black text-teal-800">PNG/PDF</div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                <div className="aspect-[4/5] rounded-xl bg-gradient-to-br from-slate-950 via-slate-800 to-amber-400 p-4 text-white">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-teal-200">You're invited</div>
                  <div className="mt-2 text-xl font-black leading-tight text-amber-200">Electron Jubilee</div>
                  <div className="mt-auto pt-12 text-[10px] font-bold">Aug 18 · 6:00 PM</div>
                </div>
                <div className="space-y-2">
                  {['Event title', 'Venue', 'Admission note'].map((field) => (
                    <div key={field} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">{field}</div>
                  ))}
                  <div className="grid grid-cols-4 gap-1.5 pt-2">
                    {['#D4AF37', '#14B8A6', '#050816', '#FFFFFF'].map((color) => (
                      <span key={color} className="h-8 rounded-lg border border-slate-200" style={{ background: color }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['RSVP Page', 'Mobile + desktop preview'],
                ['Festio Pass', 'QR-safe ticket card'],
                ['Email Theme', 'Branded invitation'],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
                  <div className="text-sm font-black text-slate-950 dark:text-white">{title}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{copy}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const mockups = {
  'command-center': {
    title: 'Event Setup',
    status: '4 of 5 ready',
    stats: [['Active', '2'], ['Draft', '1'], ['Credits', '840']],
    listTitle: 'Get this event ready',
    rows: [['Import guests', 'Done', '✓'], ['Turn on RSVP', 'Done', '✓'], ['Enable check-in', 'Event Pass', '→']],
    panelTitle: 'Team & settings',
    panel: ['Owner', 'Admin', 'Staff', 'Per-staff access'],
  },
  'guest-database': {
    title: 'Guest Database',
    status: 'Synced',
    stats: [['Guests', '526'], ['Attending', '318'], ['Pending', '24']],
    listTitle: 'Guest records',
    rows: [['Am Ami', 'Attending', 'VIP'], ['Mina Bello', 'Pending', 'Press'], ['Tobi Khan', 'Checked in', 'Family']],
    panelTitle: 'Segments',
    panel: ['VIP', 'Family', 'Press', 'No reply'],
  },
  rsvp: {
    title: 'RSVP Studio',
    status: 'Open',
    stats: [['Capacity', '420'], ['RSVP yes', '318'], ['Declined', '32']],
    listTitle: 'Invite flow',
    rows: [['Public page', 'Enabled', 'Live'], ['Approval', 'Required', 'On'], ['Deadline', 'Jul 7', '8 days']],
    panelTitle: 'Festio Pass',
    panel: ['Issued after approval', 'QR ready', 'Email + WhatsApp'],
  },
  messaging: {
    title: 'Message Center',
    status: 'Ready',
    stats: [['Templates', '12'], ['Sent', '1,248'], ['Credits', '840']],
    listTitle: 'Message templates',
    rows: [['Festio Pass email', 'Email', 'Default'], ['RSVP reminder', 'SMS', 'Edited'], ['Event update', 'WhatsApp', 'Broadcast']],
    panelTitle: 'Channels',
    panel: ['Email', 'SMS', 'WhatsApp', 'MMS ticket card'],
  },
  'guest-hub': {
    title: 'Guest Pass',
    status: 'Admitted',
    stats: [['Table', 'VIP-2'], ['Seat', '4'], ['Status', 'Valid']],
    listTitle: 'Your ticket',
    rows: [['QR pass', 'Ready', 'Valid'], ['Menu choice', 'Jollof', 'Saved'], ['Plus-one', 'Linked', 'Seated together']],
    panelTitle: 'On your pass',
    panel: ['View QR code', 'Pick your meal', 'Link your plus-one', 'SMS updates: on'],
  },
  seating: {
    title: 'Seating Plan',
    status: 'Auto-assigned',
    stats: [['Tables', '42'], ['Seated', '318'], ['Open seats', '84']],
    listTitle: 'Table groups',
    rows: [['Family A', '12 tables', '98% full'], ['VIP', '5 tables', 'Reserved'], ['Friends', '18 tables', 'Auto-fill']],
    panelTitle: 'Seat map',
    panel: ['A1', 'A2', 'A3', 'B1'],
  },
  'check-in': {
    title: 'Live Check-In',
    status: 'Scanning',
    stats: [['Admitted', '146'], ['Denied', '5'], ['Walk-ins', '12']],
    listTitle: 'Scan results',
    rows: [['Am Ami', 'Admitted', 'VIP Gate'], ['Noah Bennett', 'Already in', 'Main'], ['Zara Okafor', 'Denied', 'Wrong zone']],
    panelTitle: 'Phone scanner',
    panel: ['QR pass', 'Manual search', 'Walk-in', 'Self check-in'],
  },
  'access-rules': {
    title: 'Venue Access',
    status: 'Rules active',
    stats: [['Zones', '6'], ['Gates', '9'], ['Inside', '146']],
    listTitle: 'Zone rules',
    rows: [['Main Hall', 'GA + VIP', '92 inside'], ['VIP Lounge', 'VIP only', '42 inside'], ['Backstage', 'Staff tag', '12 inside']],
    panelTitle: 'Analytics',
    panel: ['Live occupancy', 'Peak arrivals', 'Zone flow', 'Guest journey'],
  },
  orders: {
    title: 'Orders Dashboard',
    status: 'Kitchen live',
    stats: [['Jollof', '96'], ['Veg plate', '32'], ['Served', '58%']],
    listTitle: 'Per-table totals',
    rows: [['Table 1', '2 guests', '1 served'], ['Table 2', '1 guest', 'Pending'], ['Unassigned', '2 guests', '0 served']],
    panelTitle: 'Menu choices',
    panel: ['Meals', 'Drinks', 'Gift pickup', 'Combinations'],
  },
  'gift-list': {
    title: 'Gift List & Registry',
    status: 'Claims live',
    stats: [['Gift items', '12'], ['Claims', '38'], ['Cash funds', '2']],
    listTitle: 'Registry activity',
    rows: [['Welcome tote', 'Reserved', '5 guests'], ['Speaker set', 'Claimed', 'Am Ami'], ['Cash fund', '$1,240', 'Open']],
    panelTitle: 'Registry tools',
    panel: ['Gift item', 'Cash fund', 'Store link', 'Claim report'],
  },
  deliveries: {
    title: 'Deliveries',
    status: 'Vendor shared',
    stats: [['Shipments', '4'], ['Items', '86'], ['Packed', '72%']],
    listTitle: 'Shipment tracking',
    rows: [['Aso-ebi', '48 guests', 'In progress'], ['Welcome tote', '20 boxes', 'Packed'], ['Vendor pickup', 'Friday', 'Scheduled']],
    panelTitle: 'Fulfillment',
    panel: ['Vendor page', 'Addresses', 'Packing list', 'XLSX export'],
  },
  analytics: {
    title: 'Live Results',
    status: 'Auto-refresh',
    stats: [['Total', '526'], ['Checked in', '146'], ['VIP', '42']],
    listTitle: 'Dashboard',
    rows: [['RSVP breakdown', 'Live', 'Updated'], ['Invite delivery', 'Tracked', '98%'], ['Table report', 'Ready', 'Exportable']],
    panelTitle: 'Insights',
    panel: ['Timeline', 'Occupancy', 'Flow', 'Catering'],
  },
}

function ProductMockup({ type, alt, className = '' }) {
  const data = mockups[type] || mockups['command-center']
  return (
    <div
      role="img"
      aria-label={alt}
      className={`overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/10 dark:border-white/10 dark:bg-slate-900 ${className}`}
    >
      <div className="rounded-2xl bg-slate-950 p-4 text-white">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <LogoMark size="h-8 w-8" text="text-xs" />
            <div>
              <div className="text-sm font-black">Festio</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-300">{data.title}</div>
            </div>
          </div>
          <span className="rounded-full bg-teal-300/15 px-3 py-1 text-xs font-black text-teal-200">{data.status}</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {data.stats.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/10 p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
              <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl bg-white p-3 text-slate-950">
            <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">{data.listTitle}</div>
            {data.rows.map((row) => (
              <div key={row.join('-')} className="grid grid-cols-[1.2fr_0.8fr_0.8fr] items-center gap-2 border-t border-slate-100 py-2 text-[11px]">
                {row.map((cell, index) => (
                  <span key={cell} className={index === 0 ? 'font-black' : 'text-slate-600'}>{cell}</span>
                ))}
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-gradient-to-br from-teal-300 to-emerald-300 p-3 text-slate-950">
            <div className="text-xs font-black uppercase tracking-wider">{data.panelTitle}</div>
            <div className="mt-3 grid gap-2">
              {data.panel.map((item, index) => (
                <div key={item} className={`rounded-lg px-3 py-2 text-xs font-black ${index === 0 ? 'bg-slate-950 text-white' : 'bg-white/75 text-slate-950'}`}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ eyebrow, title, copy, center = false }) {
  return (
    <div className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      {eyebrow && <p className="text-sm font-black uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">{eyebrow}</p>}
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl lg:text-5xl">{title}</h2>
      {copy && <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300 sm:text-lg">{copy}</p>}
    </div>
  )
}

function PointList({ points, compact = false }) {
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'mt-5' : 'mt-7'}`}>
      {points.map((point) => (
        <span key={point} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
          {point}
        </span>
      ))}
    </div>
  )
}

function ValueIcon({ label }) {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-50 text-sm font-black text-teal-800 dark:bg-teal-400/10 dark:text-teal-200">
      {label}
    </span>
  )
}

function ComparisonCell({ value, highlight = false }) {
  if (value === true) {
    return <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${highlight ? 'bg-teal-400 text-slate-950' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'}`}><CheckIcon className="h-4 w-4" /></span>
  }
  if (value === false) {
    return <span className="text-xl font-black text-slate-300 dark:text-slate-700">-</span>
  }
  return <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{value}</span>
}

export default function LandingPage() {
  const { dark, toggle } = useTheme()

  return (
    <div className="min-h-screen bg-[#fbf7ef] text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="sticky top-0 z-50 border-b border-slate-900/10 bg-[#fbf7ef]/90 backdrop-blur dark:border-white/10 dark:bg-slate-950/90">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <a href="#top" className="mr-auto flex items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950" aria-label="Festio home">
            <LogoMark />
            <span className="text-lg font-black tracking-tight">Festio</span>
          </a>
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
            <a href="#features" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Features</a>
            <a href="#design-studio" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Design Studio</a>
            <a href="#addons" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Add-ons</a>
            <a href="#guest-journey" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Guest Journey</a>
            <a href="#event-types" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Event Types</a>
            <Link to="/pricing" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Pricing</Link>
            <a href="#demo" className="text-sm font-bold text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">Demo</a>
          </nav>
          <button onClick={toggle} className="rounded-lg p-2 text-slate-500 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Toggle theme">
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link to="/login" className="hidden text-sm font-extrabold text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white sm:inline">Sign In</Link>
          <PrimaryCta className="min-h-10 px-4 py-2 shadow-none">Create Free Event</PrimaryCta>
        </div>
      </header>

      <main>
        <section id="top" className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_80%_5%,rgba(45,212,191,.24),transparent),radial-gradient(38rem_28rem_at_10%_5%,rgba(245,158,11,.16),transparent)]" aria-hidden="true" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:py-24">
            <Reveal>
              <p className="inline-flex rounded-full border border-teal-200 bg-white/80 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-teal-800 shadow-sm dark:border-teal-400/20 dark:bg-white/5 dark:text-teal-200">
                The guest operating system for modern events
              </p>
              <h1 className="mt-7 max-w-4xl text-5xl font-black tracking-tight text-slate-950 dark:text-white sm:text-6xl lg:text-7xl">
                Run every guest moment from invite to exit.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 dark:text-slate-300 sm:text-xl">
                Festio helps organizers create events, manage guests, collect RSVPs, send QR passes, assign seats, message attendees, control access, manage meals, and track attendance live from one simple dashboard.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <PrimaryCta className="px-7 py-4 text-base" />
                <SecondaryCta className="px-7 py-4 text-base" />
              </div>
              <div className="mt-8 flex max-w-2xl flex-wrap gap-2" aria-label="Festio product capabilities">
                {trustChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                    {chip}
                  </span>
                ))}
              </div>
            </Reveal>
            <Reveal delay={120}>
              <HeroVisual />
            </Reveal>
          </div>
        </section>

        <section id="problem" className="border-y border-slate-900/10 bg-white py-20 dark:border-white/10 dark:bg-slate-900/35">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Before Festio"
                title="Your event should not run on spreadsheets, screenshots, and group chats."
                copy="When the guest data is scattered, every small change becomes a staff question, a host interruption, or a slow line at the door."
              />
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {problemCards.map((problem, index) => (
                <Reveal key={problem} delay={(index % 3) * 70}>
                  <div className="h-full rounded-2xl border border-slate-200 bg-[#fbf7ef] p-5 shadow-sm dark:border-white/10 dark:bg-slate-950">
                    <div className="mb-4 grid h-9 w-9 place-items-center rounded-full bg-rose-100 text-sm font-black text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">!</div>
                    <h3 className="text-base font-black text-slate-950 dark:text-white">{problem}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Festio connects this workflow back to the same live guest record.</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Platform overview"
                title="One platform for the full guest journey."
                copy="Plan, invite, seat, message, admit, serve, and track every guest without stitching together five separate tools."
              />
            </Reveal>
            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {pillars.map((pillar, index) => (
                <Reveal key={pillar.title} delay={(index % 4) * 70}>
                  <article className={`h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-slate-900 ${index === 0 || index === 6 ? 'xl:col-span-2' : ''}`}>
                    <ValueIcon label={`0${index + 1}`} />
                    <h3 className="mt-5 text-xl font-black text-slate-950 dark:text-white">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{pillar.copy}</p>
                    <PointList points={pillar.items} compact />
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="design-studio" className="border-y border-slate-900/10 bg-white py-20 dark:border-white/10 dark:bg-slate-900/35">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <Reveal>
              <SectionHeader
                eyebrow="Design Studio"
                title="Beautiful pages and flyers, without design stress."
                copy="Choose from template families, upload your own flyer, customize the wording, match your event colors, and publish a polished RSVP page, Guest Hub, Festio Pass, email style, and downloadable flyer in minutes."
              />
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {designStudioBullets.map((point) => (
                  <div key={point} className="flex gap-3 rounded-2xl border border-slate-200 bg-[#fbf7ef] p-4 dark:border-white/10 dark:bg-slate-950">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                    <span className="text-sm font-bold leading-6 text-slate-700 dark:text-slate-200">{point}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <PrimaryCta to="/register?intent=design">Create Free Event</PrimaryCta>
                <SecondaryCta>Book a Demo</SecondaryCta>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <DesignStudioVisual />
            </Reveal>
          </div>
        </section>

        <section id="addons" className="border-y border-slate-900/10 bg-white py-20 dark:border-white/10 dark:bg-slate-900/35">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Orders, gifts, registry, and deliveries"
                title="Festio manages the details that usually live outside the guest list."
                copy="Meals, gift claims, registry activity, shipments, vendor fulfillment, and table service all stay connected to the same event workspace."
              />
            </Reveal>
            <div className="mt-12 grid gap-8 lg:grid-cols-3">
              {addOnHighlights.map((item, index) => (
                <Reveal key={item.id} delay={index * 80}>
                  <article className="h-full rounded-2xl border border-slate-200 bg-[#fbf7ef] p-5 shadow-sm dark:border-white/10 dark:bg-slate-950">
                    <ProductMockup type={item.id} alt={`Festio ${item.title} preview`} />
                    <h3 className="mt-6 text-2xl font-black text-slate-950 dark:text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.copy}</p>
                    <PointList points={item.points} compact />
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="guest-journey" className="border-y border-slate-900/10 bg-slate-950 py-20 text-white dark:border-white/10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Guest journey"
                title="From first invite to final arrival, every step is connected."
                copy="A guest RSVP can become a pass, a table assignment, a meal order, a message thread, an access rule, and a live dashboard update."
              />
            </Reveal>
            <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {journey.map(([title, copy], index) => (
                <Reveal key={title} delay={(index % 4) * 70}>
                  <article className="relative h-full rounded-2xl border border-white/10 bg-white/[0.06] p-5">
                    <div className="mb-5 grid h-10 w-10 place-items-center rounded-full bg-teal-300 text-sm font-black text-slate-950">{index + 1}</div>
                    <h3 className="text-lg font-black">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{copy}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <div id="demo">
          {detailSections.map((section, index) => (
            <section key={section.id} id={section.id} className={`scroll-mt-20 py-20 ${index % 2 ? 'bg-white dark:bg-slate-900/35' : ''}`}>
              <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
                <Reveal className={index % 2 ? 'lg:order-2' : ''}>
                  <SectionHeader eyebrow={section.eyebrow} title={section.title} copy={section.copy} />
                  <PointList points={section.points} />
                  {index === 2 && (
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                      <PrimaryCta to="/register?intent=rsvp">Create RSVP Page</PrimaryCta>
                      <SecondaryCta>Book a Demo</SecondaryCta>
                    </div>
                  )}
                </Reveal>
                <Reveal delay={120} className={index % 2 ? 'lg:order-1' : ''}>
                  <ProductMockup type={section.id} alt={section.alt} />
                </Reveal>
              </div>
            </section>
          ))}
        </div>

        <section id="event-types" className="border-y border-slate-900/10 bg-white py-20 dark:border-white/10 dark:bg-slate-900/35">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Event types"
                title="Built for events that need more than a basic RSVP form."
                copy="Festio works for social, cultural, corporate, community, catered, and venue-based events where guest operations matter."
              />
            </Reveal>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {eventTypes.map(([title, copy], index) => (
                <Reveal key={title} delay={(index % 3) * 70}>
                  <article className="h-full rounded-2xl border border-slate-200 bg-[#fbf7ef] p-6 shadow-sm dark:border-white/10 dark:bg-slate-950">
                    <h3 className="text-lg font-black text-slate-950 dark:text-white">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Comparison"
                title="More than invites. More than check-in."
                copy="Basic tools handle one slice of the event. Festio connects the guest record across the full operation."
              />
            </Reveal>
            <Reveal className="mt-12 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950/60">
                      <th scope="col" className="px-5 py-4 text-sm font-black text-slate-950 dark:text-white">Capability</th>
                      <th scope="col" className="px-5 py-4 text-center text-sm font-black text-slate-600 dark:text-slate-300">Basic RSVP tools</th>
                      <th scope="col" className="px-5 py-4 text-center text-sm font-black text-slate-600 dark:text-slate-300">QR check-in tools</th>
                      <th scope="col" className="px-5 py-4 text-center text-sm font-black text-teal-700 dark:text-teal-300">Festio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map(([capability, rsvp, checkin, festio]) => (
                      <tr key={capability} className="border-b border-slate-100 last:border-0 dark:border-white/10">
                        <th scope="row" className="px-5 py-4 text-sm font-bold text-slate-800 dark:text-slate-100">{capability}</th>
                        <td className="px-5 py-4 text-center"><ComparisonCell value={rsvp} /></td>
                        <td className="px-5 py-4 text-center"><ComparisonCell value={checkin} /></td>
                        <td className="px-5 py-4 text-center"><ComparisonCell value={festio} highlight /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-y border-slate-900/10 bg-slate-950 py-20 text-white dark:border-white/10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal>
              <SectionHeader
                center
                eyebrow="Trust"
                title="Built for real event operations."
                copy="Festio is designed for the moments when guests are arriving, staff need answers, and the organizer needs one reliable source of truth."
              />
            </Reveal>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                ['Real event screenshots', 'Use product views for guest lists, RSVP setup, scan results, entry rules, orders, and dashboard proof.'],
                ['Customer testimonials', '"Festio helped us manage RSVPs, seating, check-in, and guest communication without the usual confusion at the door."'],
                ['Security and control', 'Unique QR passes, role-based access, staff permissions, private links, audit history, and exportable records.'],
              ].map(([title, copy]) => (
                <Reveal key={title}>
                  <article className="h-full rounded-2xl border border-white/10 bg-white/[0.06] p-6">
                    <h3 className="text-lg font-black">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{copy}</p>
                  </article>
                </Reveal>
              ))}
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {['Guests processed', 'Events managed', 'Organizer quotes'].map((label) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-center">
                  <div className="text-3xl font-black text-teal-300">Add data</div>
                  <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <Reveal>
              <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-950/5 dark:border-white/10 dark:bg-slate-900 sm:p-12">
                <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">Pricing</p>
                    <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">Start simple. Add power when your event needs it.</h2>
                    <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
                      Use Festio for small events, then unlock advanced features like messaging credits, access rules, seating, orders, registry, deliveries, and premium support as your event grows.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Link to="/pricing" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
                      View Pricing <ArrowIcon />
                    </Link>
                    <PrimaryCta />
                    <SecondaryCta />
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-t border-slate-900/10 py-24 dark:border-white/10">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <Reveal>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl">Ready to run your event with less confusion and more control?</h2>
              <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
                Create your event, invite your guests, manage the details, and see everything live with Festio.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <PrimaryCta className="px-8 py-4 text-base" />
                <SecondaryCta className="px-8 py-4 text-base" />
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-900/10 bg-white py-10 dark:border-white/10 dark:bg-slate-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <LogoMark size="h-8 w-8" text="text-xs" />
            <div>
              <div className="font-black text-slate-950 dark:text-white">Festio</div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Guest management for modern events</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm font-bold text-slate-500 dark:text-slate-400" aria-label="Footer">
            <a href="#features" className="hover:text-teal-700 dark:hover:text-teal-300">Features</a>
            <a href="#design-studio" className="hover:text-teal-700 dark:hover:text-teal-300">Design Studio</a>
            <a href="#guest-journey" className="hover:text-teal-700 dark:hover:text-teal-300">Guest Journey</a>
            <Link to="/pricing" className="hover:text-teal-700 dark:hover:text-teal-300">Pricing</Link>
            <Link to="/login" className="hover:text-teal-700 dark:hover:text-teal-300">Sign in</Link>
            <a {...demoProps} className="hover:text-teal-700 dark:hover:text-teal-300">Book a demo</a>
          </nav>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500">© {new Date().getFullYear()} Festio. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
