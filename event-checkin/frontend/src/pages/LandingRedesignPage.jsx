import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import './LandingRedesignPage.css'

const CONTACT_EMAIL = 'events@festio.events'

// This page showcases the redesign specifically, so its own CTAs bypass the
// org redesign_cohort gate that /admin, /setup, etc. normally go through
// (RedesignGate) and go straight to the redesign pages, unlike getPreferredView
// (App.jsx) which every other legacy entry point still relies on.
function redesignHome(role) {
  return role === 'admin' || role === 'event_manager' ? '/admin-redesign' : '/scanner-redesign'
}

function defaultDemoTime() {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  d.setHours(10, 0, 0, 0)
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SunIcon() {
  return (
    <svg width="17" height="17" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="17" height="17" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

const HERO_SLIDES = [
  {
    eyebrow: 'Plan with confidence', title: <>Every detail, <em>perfectly in place.</em></>,
    body: 'Build timelines, manage vendors, track budgets, and keep your whole team moving together—from first idea to event day.',
    primary: 'Start planning free', primaryTo: '/register?redesign=1', secondary: 'Explore planning', secondaryTo: '/planner-redesign',
    visual: ['01-create-manage-events.png', 780, 158, 587, 441],
    url: 'festio.events/admin', label: 'Founders Weekend', sublabel: 'Convention · Day 2',
    metrics: [['Events', '12'], ['Tasks done', '28 / 42'], ['Days to go', '14']],
    rows: [['Run of show', 'On track'], ['Vendor arrivals', '9 confirmed'], ['Team assignments', '6 active']],
  },
  {
    eyebrow: 'Invite with style', title: <>Every invitation <em>feels personal.</em></>,
    body: 'Create beautiful invitations, collect RSVPs, manage plus-ones, and give every guest one private link for their whole journey.',
    primary: 'Create your invitation', primaryTo: '/register?redesign=1', secondary: 'See RSVP tools', secondaryTo: '/guests-redesign?tab=invite',
    visual: ['02-invite-rsvp.png', 734, 161, 696, 431],
    url: 'festio.events/invitations', label: 'Invitation campaign', sublabel: 'Founders Weekend',
    metrics: [['Delivered', '824'], ['Opened', '731'], ['RSVP yes', '618']],
    rows: [['Awaiting reply', '106'], ['Additional guests', '84'], ['Approval queue', '12']],
  },
  {
    eyebrow: 'Know every guest', title: <>Every guest, <em>beautifully organized.</em></>,
    body: 'Keep profiles, households, preferences, notes, and attendance history together—so your team always knows who needs what.',
    primary: 'Manage your guests', primaryTo: '/guests-redesign', secondary: 'Explore guest tools', secondaryTo: '#platform',
    visual: ['03-guest-management.png', 734, 161, 696, 441],
    url: 'festio.events/guests', label: 'Guest management', sublabel: '842 guest records',
    metrics: [['Guests', '842'], ['Invited', '824'], ['Admitted', '618']],
    rows: [['Households', '286'], ['Table groups', '18'], ['Pending approval', '12']],
  },
  {
    eyebrow: 'Seat with clarity', title: <>Every seat, <em>thoughtfully placed.</em></>,
    body: 'Design tables, assign guests, manage sections, and control venue access with a live view your whole team can trust.',
    primary: 'Build your floor plan', primaryTo: '/floorplan-redesign', secondary: 'Explore access tools', secondaryTo: '/checkin-redesign',
    visual: ['04-seating-access.png', 724, 160, 706, 448],
    url: 'festio.events/floor-plan', label: 'Main Hall', sublabel: 'Live seating & access',
    metrics: [['Tables', '42'], ['Assigned', '618'], ['Sections', '4']],
    rows: [['Main Hall', '312 / 400'], ['Exhibit Floor', '204 / 260'], ['VIP Lounge', '48 / 60']],
  },
  {
    eyebrow: 'Stay close', title: <>Every message reaches <em>the right person.</em></>,
    body: 'Send invitations, updates, reminders, and private FestioHub conversations across email, SMS, and WhatsApp.',
    primary: 'Start a conversation', primaryTo: '/communications-redesign', secondary: 'Explore messaging', secondaryTo: '#community',
    visual: ['05-messaging-festiohub.png', 639, 159, 805, 452],
    url: 'festio.events/communications', label: 'Communications', sublabel: 'Email · SMS · WhatsApp',
    metrics: [['Sent', '24,680'], ['Delivered', '23,842'], ['Opened', '12,985']],
    rows: [['Arrival reminder', 'Delivered'], ['Speaker update', 'Sending'], ['Volunteer channel', '12 new']],
  },
  {
    eyebrow: 'Run it live', title: <>Every arrival <em>feels effortless.</em></>,
    body: 'Scan passes in seconds, monitor occupancy live, resolve exceptions, and keep every entrance moving with confidence.',
    primary: 'Open live operations', primaryTo: '/checkin-redesign', secondary: 'See check-in tools', secondaryTo: '#ops', pass: true,
    visual: ['06-checkin-live-operations.png', 586, 164, 857, 447],
    url: 'festio.events/live-ops', label: 'Convention · Day 2', sublabel: 'Live operations',
    metrics: [['Registered', '842'], ['Checked in', '618'], ['Occupancy', '73%']],
    rows: [['Main Hall', '312 in'], ['Exhibit Floor', '204 in'], ['Exceptions', '3 open']],
  },
  {
    eyebrow: 'Sell with confidence', title: <>Every ticket, <em>from sale to scan.</em></>,
    body: 'Create ticket types, accept secure payments, deliver passes, manage refunds, and follow every order through check-in.',
    primary: 'Start selling tickets', primaryTo: '/tickets', secondary: 'Explore ticketing', secondaryTo: '#business', pass: true,
    visual: ['01-ticketing.png', 665, 153, 828, 469],
    url: 'festio.events/ticketing', label: 'Ticketing overview', sublabel: 'Sales update live',
    metrics: [['Gross collected', '$124.8K'], ['Tickets sold', '2,341'], ['Refunds', '$3,912']],
    rows: [['Organizer proceeds', '$98,642'], ['General admission', '1,254 sold'], ['Recent orders', '48 today']],
  },
  {
    eyebrow: 'Plan every detail', title: <>Every moving part, <em>under control.</em></>,
    body: 'Manage budgets, vendors, milestones, timelines, run sheets, documents, quotes, and change orders in one shared workspace.',
    primary: 'Open your planner', primaryTo: '/planner-redesign', secondary: 'Explore planning', secondaryTo: '#business',
    visual: ['02-planner.png', 658, 142, 742, 510],
    url: 'festio.events/planner', label: 'Event planner', sublabel: 'Budget · vendors · run sheet',
    metrics: [['Allocated', '$98,642'], ['Actual', '$88,214'], ['Used', '89.4%']],
    rows: [['Final guest count', 'In 2 days'], ['Vendor quotes', '3 received'], ['Run sheet', '12 items']],
  },
  {
    eyebrow: 'Serve without guesswork', title: <>Every order, ready <em>at the right moment.</em></>,
    body: 'Collect guest meal choices, organize preparation by item and table, and mark each course served from a live kitchen queue.',
    primary: 'Open menu orders', primaryTo: '/kitchen-redesign', secondary: 'See kitchen tools', secondaryTo: '#platform',
    visual: ['03-menu-orders.png', 657, 142, 741, 510],
    url: 'festio.events/menu-orders', label: 'Kitchen order queue', sublabel: 'By order · tally · table',
    metrics: [['Orders', '618'], ['Ready', '126'], ['Served', '442']],
    rows: [['Starters outstanding', '14'], ['Mains outstanding', '11'], ['Desserts outstanding', '9']],
  },
  {
    eyebrow: 'Delight every guest', title: <>Every gift, <em>packed and delivered.</em></>,
    body: 'Organize gift bags and merchandise, build vendor-ready packing lists, and track fulfillment from preparation to delivery.',
    primary: 'Plan guest gifts', primaryTo: '/addons-redesign?tab=logistics', secondary: 'Explore fulfillment', secondaryTo: '#platform',
    visual: ['04-gifts-fulfillment.png', 595, 151, 804, 508],
    url: 'festio.events/logistics', label: 'Gifts & fulfillment', sublabel: 'Packing and shipments',
    metrics: [['Batches', '12'], ['Packed', '214'], ['Delivered', '168']],
    rows: [['Welcome gift bags', 'Ready to pack'], ['Speaker kits', 'Packed'], ['VIP merchandise', 'Shipped']],
  },
  {
    eyebrow: 'Celebrate together', title: <>Every gift, remembered <em>with gratitude.</em></>,
    body: 'Create gift items, cash funds, and external registry links—then track reservations, purchases, pledges, and thank-you status.',
    primary: 'Create your gift list', primaryTo: '/addons-redesign?tab=registry', secondary: 'Explore registry', secondaryTo: '#platform',
    visual: ['05-gift-registry.png', 595, 140, 817, 523],
    url: 'festio.events/gift-list', label: 'Gift list', sublabel: 'Record-only registry',
    metrics: [['Items', '12'], ['Claimed', '7'], ['Cash raised', '$2,050']],
    rows: [['Honeymoon fund', '41% funded'], ['Gift activity', '18 records'], ['Thank-you sent', '6']],
  },
]

function HeroProductPanel({ slide }) {
  const [file, x, y, width, height] = slide.visual
  const cropStyle = {
    '--crop-x': x,
    '--crop-y': y,
    '--crop-width': width,
    '--crop-height': height,
  }
  return (
    <div className="lr-stage" key={file}>
      <div className="lr-product-crop" style={cropStyle}>
        <img src={`/hero-mockups/${file}`} alt={`${slide.eyebrow} product interface`} />
      </div>
    </div>
  )
}

const JOURNEY_STEPS = [
  {
    step: '01', icon: '◈', title: 'Create & invite', to: '/guests-redesign',
    body: 'Launch a branded event page, import your guest list, and send personalized invitations by email, SMS, or WhatsApp.',
    checks: ['Beautiful event pages', 'Smart guest import'],
  },
  {
    step: '02', icon: '◎', title: 'Collect accurate RSVPs', to: '/guests-redesign?tab=invite',
    body: 'Register individuals, couples, families, and additional guests with exactly the details your event needs.',
    checks: ['Custom, conditional questions', 'Approval rules'],
  },
  {
    step: '03', icon: '▦', title: 'Prepare every guest', featured: true, to: '/floorplan-redesign',
    body: 'Assign tables, confirm meals, share updates, and issue an individual Festio Pass to each attendee.',
    checks: ['Seating and table groups', 'Email, SMS & WhatsApp'],
  },
  {
    step: '04', icon: '⍁', title: 'Run the event live', to: '/checkin-redesign',
    body: 'Scan passes, welcome walk-ins, control zone access, and watch attendance update in real time.',
    checks: ['Fast QR check-in', 'Live occupancy and flow'],
  },
]

const PEOPLE_STACK = [
  { initials: 'AS', name: 'Amara Solaru', role: 'Primary registrant', status: 'ok' },
  { initials: 'TS', name: 'Tunde Solaru', role: 'Spouse', status: 'ok' },
  { initials: 'ZS', name: 'Zainab Solaru', role: 'Child', status: 'ok' },
  { initials: 'KB', name: 'Kemi Bello', role: 'Invited guest', status: 'pending' },
]

const COMMUNITY_CARDS = [
  { initials: 'SC', title: 'Staff broadcast', sub: 'To all attendees', body: 'Shuttle to the gala leaves the lobby at 6:45pm sharp. See you there.' },
  { initials: 'FW', title: 'Volunteers channel', sub: 'Private group', body: 'Registration desk needs two more hands for the 9am rush tomorrow.' },
  { initials: 'RG', title: 'Gift registry', sub: 'Add-on', body: '3 items marked as taken. Guests can still add cash gifts from their hub.' },
  { initials: 'LG', title: 'Logistics', sub: 'Add-on', body: 'Gift shipment packed for 214 guests. Vendor pickup list is ready.' },
  { initials: 'SP', title: 'Speaker showcase', sub: 'Add-on', body: 'A public page for your guest speakers — bios, photos, and social links, linked from your ticket page and each guest’s hub.' },
  { initials: 'PT', title: 'Partner showcase', sub: 'Add-on', body: 'Give sponsors and partners their own page, grouped into your own categories, linked from your ticket page.' },
  { initials: 'RM', title: 'Automated reminders', sub: 'Add-on', body: 'Schedule a series of email, SMS, and WhatsApp reminders by day offset, each targeted to a specific RSVP audience — no manual resends.' },
]

const BUSINESS_FEATURES = [
  {
    label: 'Ticket Sales',
    title: 'Sell tickets from your own event page',
    body: 'Publish ticket types, take secure payments, issue unique QR tickets, manage promo codes, and handle refunds from one organizer workspace.',
    points: ['Public event listings', 'Secure checkout', 'QR ticket delivery', 'Sales and payout reporting'],
    to: '/tickets',
    cta: 'Browse ticketed events',
  },
  {
    label: 'Planner',
    title: 'Keep the plan beside the guest list',
    body: 'Track budgets, vendors, timelines, documents, and the work behind the event without moving between spreadsheets and group chats.',
    points: ['Budget tracking', 'Vendor workspace', 'Timeline and run sheet', 'Shared documents', 'Vendor e-signature contracts'],
    to: '/pricing',
    cta: 'See plans and add-ons',
  },
]

const PRICING_TIERS = [
  { tier: 'Free', title: 'Explore Festio', body: 'For testing the guest experience and planning small gatherings.', cta: 'Create free event', to: '/register?redesign=1' },
  { tier: 'Essential', title: 'Run your event', body: 'Invitations, passes, messaging, and check-in for complete guest management.', cta: 'See pricing', to: '/pricing', featured: true },
  { tier: 'Professional', title: 'Scale operations', body: 'Venue access intelligence, seating workflows, and reporting for complex events.', cta: 'Talk to us', to: '#contact' },
]

function DemoContactForm() {
  const [form, setForm] = useState({
    contact_name: '', email: '', phone: '', organization: '',
    event_name: '', guest_count: '', preferred_time: defaultDemoTime(), message: '',
  })
  const [status, setStatus] = useState('idle') // idle | loading | success
  const [error, setError] = useState('')

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setStatus('loading')
    setError('')
    try {
      await api.submitDemoRequest({
        ...form,
        guest_count: form.guest_count ? Number(form.guest_count) : null,
        preferred_time: new Date(form.preferred_time).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        phone: form.phone || null,
        organization: form.organization || null,
        event_name: form.event_name || null,
        message: form.message || null,
      })
      setStatus('success')
    } catch (err) {
      setError(err.message || 'Could not send your request.')
      setStatus('idle')
    }
  }

  if (status === 'success') {
    return (
      <div className="lr-contact-form lr-contact-success">
        <div className="lr-p-status ok" style={{ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 18 }}>&#10003;</div>
        <h3>Request received</h3>
        <p>Check your inbox for confirmation. We&apos;ll follow up shortly with a meeting link.</p>
      </div>
    )
  }

  return (
    <form className="lr-contact-form" onSubmit={submit}>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Name</span>
          <input required value={form.contact_name} onChange={(e) => setField('contact_name', e.target.value)} placeholder="Your name" />
        </label>
        <label className="lr-field">
          <span>Email</span>
          <input required type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="you@example.com" />
        </label>
      </div>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Phone</span>
          <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+1 555 000 0000" />
        </label>
        <label className="lr-field">
          <span>Organization</span>
          <input value={form.organization} onChange={(e) => setField('organization', e.target.value)} placeholder="Company, venue, or host" />
        </label>
      </div>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Event</span>
          <input value={form.event_name} onChange={(e) => setField('event_name', e.target.value)} placeholder="Event name or type" />
        </label>
        <label className="lr-field">
          <span>Guests</span>
          <input min="1" type="number" value={form.guest_count} onChange={(e) => setField('guest_count', e.target.value)} placeholder="150" />
        </label>
      </div>
      <label className="lr-field">
        <span>Preferred time</span>
        <input required type="datetime-local" value={form.preferred_time} onChange={(e) => setField('preferred_time', e.target.value)} />
      </label>
      <label className="lr-field">
        <span>What should we cover?</span>
        <textarea value={form.message} onChange={(e) => setField('message', e.target.value)} placeholder="RSVP, QR passes, check-in, seating, venue access..." />
      </label>
      {error && <p className="lr-contact-error">{error}</p>}
      <button className="lr-btn primary lg" disabled={status === 'loading'} type="submit">
        {status === 'loading' ? 'Sending...' : 'Send request'}
      </button>
    </form>
  )
}

export default function LandingRedesignPage() {
  const { dark, toggle } = useTheme()
  const { user } = useAuth()
  const appHome = user ? redesignHome(user.role) : null
  const [publicEvents, setPublicEvents] = useState([])
  const [heroIndex, setHeroIndex] = useState(0)
  const heroSlide = HERO_SLIDES[heroIndex]
  useEffect(() => {
    fetch('/api/ticketing/public/events', {cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject())
      .then(data=>setPublicEvents((data.events||[]).slice(0,6))).catch(()=>setPublicEvents([]))
  }, [])
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = window.setInterval(() => {
      if (!document.hidden) setHeroIndex((current) => (current + 1) % HERO_SLIDES.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="landing-redesign">
      <nav className="lr-nav">
        <div className="lr-shell lr-nav-inner">
          <a className="lr-brand" href="#top"><span className="lr-brand-mark">F</span>Festio</a>
          <div className="lr-nav-links">
            <a href="#journey">Product</a>
            <a href="#configurable">Design Studio</a>
            <a href="#ops">Live Ops</a>
            <a href="#community">Community</a>
            <Link to="/tickets">Find events</Link>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="lr-nav-actions">
            <button type="button" className="lr-theme-btn" onClick={toggle} aria-label="Toggle theme">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            {user ? (
              <Link className="lr-btn primary" to={appHome}>Open app</Link>
            ) : (
              <>
                <Link className="lr-signin" to="/login">Sign in</Link>
                <Link className="lr-btn primary" to="/register?redesign=1">Create free event</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <header className="lr-hero" id="top">
        <div className="lr-shell lr-hero-grid">
          <div className="lr-hero-copy" key={heroSlide.eyebrow}>
            <span className="lr-eyebrow"><i /> {heroSlide.eyebrow}</span>
            <h1>{heroSlide.title}</h1>
            <p className="lr-lead">{heroSlide.body}</p>
            <div className="lr-hero-ctas">
              <Link className="lr-btn primary lg" to={heroSlide.primaryTo}>{heroSlide.primary}</Link>
              {heroSlide.secondaryTo.startsWith('#')
                ? <a className="lr-btn ghost lg" href={heroSlide.secondaryTo}>{heroSlide.secondary}</a>
                : <Link className="lr-btn ghost lg" to={heroSlide.secondaryTo}>{heroSlide.secondary}</Link>}
            </div>
            <div className="lr-trust-row">
              <span>No credit card</span>
              <span>Live in minutes</span>
              <span>Built for real crowds</span>
            </div>
          </div>
          <HeroProductPanel slide={heroSlide} />
        </div>
        <div className="lr-hero-pagination" aria-label="Featured Festio capabilities">
          {HERO_SLIDES.map((slide, index) => (
            <button type="button" key={slide.eyebrow} className={index === heroIndex ? 'active' : ''} onClick={() => setHeroIndex(index)} aria-label={`Show ${slide.eyebrow}`} aria-current={index === heroIndex ? 'true' : undefined} />
          ))}
        </div>
      </header>

      <div className="lr-strip">
        <div className="lr-shell lr-strip-grid">
          <div><strong>50K+</strong><span>guest experiences run</span></div>
          <div><strong>99.9%</strong><span>pass scan reliability</span></div>
          <div><strong>&lt;3s</strong><span>average check-in time</span></div>
          <div><strong>25</strong><span>guest hub styles to choose from</span></div>
        </div>
      </div>

      {/* ── Platform capability ticker ─────────────────────────────────── */}
      <div className="lr-ticker-wrap" aria-label="Platform capabilities">
        <div className="lr-ticker-track">
          {[
            { n: '01', title: 'Create & manage events', icon: '📅' },
            { n: '02', title: 'Invite & RSVP', icon: '✉️' },
            { n: '03', title: 'Guest management', icon: '👥' },
            { n: '04', title: 'Seating & access', icon: '🪑' },
            { n: '05', title: 'Messaging & FestioHub', icon: '💬' },
            { n: '06', title: 'Check-in & live ops', icon: '🎟️' },
            { n: '07', title: 'Meals, gifts & logistics', icon: '🍽️' },
            { n: '08', title: 'Event calendars', icon: '📆' },
            { n: '09', title: 'Design studio', icon: '🎨' },
            { n: '10', title: 'Results & analytics', icon: '📊' },
          /* duplicate for seamless loop */
            { n: '01', title: 'Create & manage events', icon: '📅' },
            { n: '02', title: 'Invite & RSVP', icon: '✉️' },
            { n: '03', title: 'Guest management', icon: '👥' },
            { n: '04', title: 'Seating & access', icon: '🪑' },
            { n: '05', title: 'Messaging & FestioHub', icon: '💬' },
            { n: '06', title: 'Check-in & live ops', icon: '🎟️' },
            { n: '07', title: 'Meals, gifts & logistics', icon: '🍽️' },
            { n: '08', title: 'Event calendars', icon: '📆' },
            { n: '09', title: 'Design studio', icon: '🎨' },
            { n: '10', title: 'Results & analytics', icon: '📊' },
          ].map((item, i) => (
            <span className="lr-ticker-item" key={i}>
              <span className="lr-ticker-num">{item.n}</span>
              <span className="lr-ticker-icon">{item.icon}</span>
              <span className="lr-ticker-label">{item.title}</span>
            </span>
          ))}
        </div>
      </div>

      <section className="lr-events">
        <div className="lr-shell"><div className="lr-events-head"><div><span className="lr-eyebrow"><i /> Festio Tickets</span><h2>Find your next event.</h2><p>Official event pages, secure tickets and unique QR admission.</p></div><Link className="lr-btn ghost" to="/tickets">Find events →</Link></div>{publicEvents.length>0&&<div className="lr-events-grid">{publicEvents.map(event=><Link className="lr-event-card" to={`/tickets/e/${event.id}`} key={event.id}><div style={event.cover_image?{backgroundImage:`linear-gradient(180deg,transparent,rgba(9,29,27,.75)),url("${event.cover_image}")`}:{}}><span>{event.timing==='current'?'Happening now':'Upcoming'}</span></div><section><small>{new Date(event.event_date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</small><h3>{event.name}</h3><p>{event.venue_name||event.venue_address||'Details from the organizer'}</p></section></Link>)}</div>}</div>
      </section>

      {/* ── Platform overview grid ────────────────────────────────────── */}
      <section className="lr-section lr-platform-overview" id="platform">
        <div className="lr-shell">
          <div className="lr-section-head center">
            <span className="lr-eyebrow" style={{ justifyContent: 'center' }}><i /> Platform overview</span>
            <h2>One platform for the full guest journey.</h2>
            <p className="lr-lead-sm">Plan, invite, seat, message, admit, serve, and track every guest — without stitching together five separate tools.</p>
          </div>
          <div className="lr-overview-grid">
            {[
              { n: '01', title: 'Create & Manage Events', body: 'Create events, manage lifecycle, configure details, and control feature toggles.', tags: ['Multi-event workspace', 'Draft, Active, Ended, Archived', 'Venue and host details'] },
              { n: '02', title: 'Invite & RSVP', body: 'Public/private RSVP pages, personal links, deadlines, limits, approvals, and questions.', tags: ['Open or closed RSVP', 'Capacity controls', 'Approval workflows'] },
              { n: '03', title: 'Guest Management', body: 'Manual entry, CSV/XLSX upload, sync, duplicate handling, tags, profiles, and status.', tags: ['Import templates', 'Guest profiles', 'RSVP answers'] },
              { n: '04', title: 'Seating & Access', body: 'Tables, seats, sections, auto-assignment, partner pairing, zones, gates, and VIP rules.', tags: ['Table groups', 'Zone permissions', 'Capacity rules'] },
              { n: '05', title: 'Messaging & FestioHub', body: 'Templates, email/SMS/WhatsApp/MMS, broadcasts, announcements, guest chat, and inbox.', tags: ['Multi-channel sends', 'Broadcast & schedule', 'Guest hub'] },
              { n: '06', title: 'Check-In & Live Ops', body: 'QR scanning, search, walk-ins, self check-in, denied reasons, and live occupancy.', tags: ['Instant QR scan', 'Self check-in kiosk', 'Live dashboard'] },
              { n: '07', title: 'Meals, Gifts & Logistics', body: 'Menu selections, kitchen views, table totals, registry, shipments, vendors, and exports.', tags: ['Kitchen display', 'Gift registry', 'Delivery tracking'] },
              { n: '08', title: 'Design Studio', body: 'Brand your event pass, guest hub, flyer, and invite page with real-time preview and publish.', tags: ['10+ hub themes', 'Custom flyers', 'One-click publish'] },
            ].map((f) => (
              <article className="lr-overview-card" key={f.n}>
                <span className="lr-overview-num">{f.n}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <div className="lr-overview-tags">
                  {f.tags.map((t) => <span key={t}>{t}</span>)}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-section lr-business-features" id="business">
        <div className="lr-shell">
          <div className="lr-section-head center">
            <span className="lr-eyebrow" style={{ justifyContent: 'center' }}><i /> Sell and plan in Festio</span>
            <h2>More than invitations and check-in.</h2>
            <p>Sell admission, organize the work, and keep every operational detail connected to the event.</p>
          </div>
          <div className="lr-business-grid">
            {BUSINESS_FEATURES.map((feature) => (
              <article className="lr-business-card" key={feature.label}>
                <span>{feature.label}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <ul>{feature.points.map((point) => <li key={point}>{point}</li>)}</ul>
                <Link to={feature.to}>{feature.cta} <b>&#8599;</b></Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-section" id="journey">
        <div className="lr-shell">
          <div className="lr-journey-head">
            <div>
              <span className="lr-eyebrow"><i /> The connected guest journey</span>
              <h2>From &ldquo;you&apos;re invited&rdquo;<br />to &ldquo;welcome in.&rdquo;</h2>
            </div>
            <p>Festio replaces scattered forms, spreadsheets, group chats, and scanning apps with one guest record that stays useful from the first invitation to the final report.</p>
          </div>

          <div className="lr-journey-grid">
            {JOURNEY_STEPS.map((s) => (
              <article className={`lr-jcard${s.featured ? ' featured' : ''}`} key={s.step}>
                <span className="lr-jc-step">{s.step}</span>
                <div className="lr-jc-icon">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <ul className="lr-jc-checklist">
                  {s.checks.map((c) => <li key={c}>{c}</li>)}
                </ul>
                <Link className="lr-jc-more" to={s.to}>Explore feature <span>&#8599;</span></Link>
              </article>
            ))}
          </div>

          <div className="lr-people-panel">
            <div className="lr-people-panel-copy">
              <span className="lr-pp-label">One RSVP, one party</span>
              <p>A single submission from Amara Solaru becomes four separate guest records, each with its own pass, table, and status.</p>
            </div>
            <div className="lr-people-stack">
              {PEOPLE_STACK.map((p) => (
                <div className="lr-person" key={p.name}>
                  <span className="lr-p-ava">{p.initials}</span>
                  <div className="lr-p-body"><b>{p.name}</b><small>{p.role}</small></div>
                  <em className={`lr-p-status ${p.status}`}>{p.status === 'ok' ? 'Confirmed' : 'Pending'}</em>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="configurable">
        <div className="lr-shell">
          <div className="lr-flex-feature">
            <div>
              <span className="lr-eyebrow">Design Studio</span>
              <h2>Nothing about your RSVP form is hardcoded.</h2>
              <p className="lr-lead">Most platforms ship one fixed form and make you fit your event into it. Festio flips that: your colors, your wording, your questions, and your rules, all set by you, not by us.</p>
              <ul className="lr-check-list">
                <li><span className="lr-dot">&#10003;</span><div><b>Conditional questions.</b> Ask &ldquo;Which chapter?&rdquo; only when the answer to &ldquo;Membership type&rdquo; is Member. Any question can depend on any other.</div></li>
                <li><span className="lr-dot">&#10003;</span><div><b>Configurable guest types.</b> Define your own categories (Member, Spouse, Child, Guest) and decide which ones skip contact-info requirements.</div></li>
                <li><span className="lr-dot">&#10003;</span><div><b>25 guest hub styles.</b> Pick a look and every guest page inherits your colors, fonts, and wording automatically.</div></li>
              </ul>
            </div>
            <div className="lr-flex-mock">
              <div className="lr-fm-row"><span>Membership type</span><span className="lr-fm-cond">Always shown</span></div>
              <div className="lr-fm-row"><span>Branch or chapter</span><span className="lr-fm-cond">Shown if Member</span></div>
              <div className="lr-fm-row"><span>Dietary needs</span><span className="lr-fm-cond">Always shown</span></div>
              <div className="lr-fm-row"><span>Guest type: Child</span><span className="lr-fm-cond"><b>Contact info skipped</b></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section" id="ops">
        <div className="lr-shell">
          <div className="lr-section-head">
            <span className="lr-eyebrow"><i /> Day of the event</span>
            <h2>Operations that hold up under a real crowd.</h2>
            <p>Multiple entrances, ticketed zones, hundreds of people arriving at once. Festio was built to keep up, not just to look good in a demo.</p>
          </div>
          <div className="lr-ops-grid">
            <div className="lr-ops-panel">
              <div className="lr-ops-zone">
                <span className="lr-oz-icon">&#9636;</span>
                <div className="lr-oz-body"><strong>Section-based scanning</strong><span>Each device routes to its own table group, guests always resolve to their own section</span></div>
                <div className="lr-oz-num"><b>4</b><small>entrances live</small></div>
              </div>
              <div className="lr-ops-zone">
                <span className="lr-oz-icon">&#8635;</span>
                <div className="lr-oz-body"><strong>Multi-zone access</strong><span>Track in and out across zones, not just a single front-door scan</span></div>
                <div className="lr-oz-num"><b>7</b><small>zones tracked</small></div>
              </div>
              <div className="lr-ops-zone">
                <span className="lr-oz-icon">&#9638;</span>
                <div className="lr-oz-body"><strong>Live occupancy and flow</strong><span>Peak times, journey paths, and real-time counts as they happen</span></div>
                <div className="lr-oz-num"><b>96%</b><small>capture rate</small></div>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 16 }}>Built to give organizers of ticketed, multi-zone events the kind of access intelligence that used to require dedicated hardware: who&apos;s in, who&apos;s out, where the lines are forming, in real time.</p>
              <Link className="lr-btn ghost" to="/checkin-redesign">See venue access intelligence</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="community">
        <div className="lr-shell">
          <div className="lr-section-head">
            <span className="lr-eyebrow"><i /> After check-in</span>
            <h2>The event doesn&apos;t end when the doors open.</h2>
            <p>Keep the group connected before, during, and after with private channels, direct messages, and staff broadcasts, all inside the same guest hub.</p>
          </div>
          <div className="lr-community-strip">
            {COMMUNITY_CARDS.map((c) => (
              <div className="lr-msg-bubble" key={c.title}>
                <div className="lr-mb-head"><span className="lr-mb-ava">{c.initials}</span><div><strong>{c.title}</strong><span>{c.sub}</span></div></div>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-story-wrap" id="story">
        <div className="lr-shell lr-story">
          <div>
            <span className="lr-eyebrow"><i /> Real event, real scale</span>
            <blockquote>&ldquo;We tracked families, individual passes, and check-in across a 3-day convention without going back to a single spreadsheet.&rdquo;</blockquote>
            <cite>Convention organizing committee</cite>
          </div>
          <div className="lr-story-stage">
            <div className="lr-story-art">
              <div className="lr-dot" />
              <div className="lr-mark">F</div>
              <div className="lr-cap"><b>842 guests</b><span>3-day convention</span></div>
            </div>
            <div className="lr-story-result">
              <small>Check-in completion</small>
              <strong>96%</strong>
              <div className="lr-sv-bar"><i style={{ width: '96%' }} /></div>
              <p>Guests welcomed across 4 entrances</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section" id="pricing">
        <div className="lr-shell">
          <div className="lr-section-head center">
            <span className="lr-eyebrow" style={{ justifyContent: 'center' }}><i /> Simple, flexible pricing</span>
            <h2>Start simple. Add what your event needs.</h2>
            <p>Create your event free, then choose the guest tools that match its size and complexity.</p>
          </div>
          <div className="lr-price-grid">
            {PRICING_TIERS.map((t) => (
              <article className={`lr-price-card${t.featured ? ' featured' : ''}`} key={t.tier}>
                {t.featured && <span className="lr-price-badge">Most popular</span>}
                <span className="lr-price-tier">{t.tier}</span>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
                {t.to.startsWith('mailto:') || t.to.startsWith('#') ? (
                  <a className="lr-price-cta" href={t.to}>{t.cta} <span>&#8599;</span></a>
                ) : (
                  <Link className="lr-price-cta" to={t.to}>{t.cta} <span>&#8599;</span></Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="contact">
        <div className="lr-shell lr-contact">
          <div>
            <span className="lr-eyebrow"><i /> Talk to an event specialist</span>
            <h2>See Festio on your event.</h2>
            <p className="lr-lead" style={{ maxWidth: 'none' }}>Tell us what you&apos;re planning and pick a preferred time. We&apos;ll send a calendar hold and follow up with the meeting link.</p>
          </div>
          <DemoContactForm />
        </div>
      </section>

      <section className="lr-final-cta">
        <div className="lr-shell">
          <span className="lr-eyebrow" style={{ justifyContent: 'center' }}><i /> Your next event starts here</span>
          <h2>Make every guest feel expected.</h2>
          <p>Build the invitation, organize the details, and welcome every single person with confidence.</p>
          <div className="lr-hero-ctas">
            <Link className="lr-btn primary lg" to="/register?redesign=1">Create your event free</Link>
            <a className="lr-btn ghost lg" href="#contact">Talk to us</a>
          </div>
        </div>
      </section>

      <footer className="lr-footer">
        <div className="lr-shell">
          <div className="lr-foot-grid">
            <div className="lr-foot-brand">
              <a className="lr-brand" href="#top"><span className="lr-brand-mark">F</span>Festio</a>
              <p>Invitations, individual guest passes, and live check-in, all connected to one guest record.</p>
            </div>
            <div className="lr-foot-cols">
              <div className="lr-foot-col">
                <strong>Product</strong>
                <a href="#journey">Guest journey</a>
                <a href="#configurable">Design Studio</a>
                <a href="#ops">Live operations</a>
                <Link to="/pricing">Pricing</Link>
              </div>
              <div className="lr-foot-col">
                <strong>Company</strong>
                <a href="#contact">Contact</a>
                {user ? <Link to={appHome}>Open app</Link> : <Link to="/login">Sign in</Link>}
              </div>
              <div className="lr-foot-col">
                <strong>Legal</strong>
                <Link to="/privacy">Privacy</Link>
                <Link to="/sms-policy">SMS terms</Link>
              </div>
            </div>
          </div>
          <div className="lr-foot-bottom">
            <span>&copy; {new Date().getFullYear()} Festio. Operated by FOHMA Solutions LLC.</span>
            <span>{CONTACT_EMAIL}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
