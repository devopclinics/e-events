import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'

// ── Config ──────────────────────────────────────────────────────────────────────
// Set DEMO_URL to a scheduler link (Calendly / Cal.com) to make "Book a Demo" open
// it in a new tab; until then the button opens an email.
const DEMO_URL = ''
const CONTACT_EMAIL = 'info@devopclinics.com'
const demoHref = DEMO_URL || `mailto:${CONTACT_EMAIL}?subject=Book%20a%20demo%20%E2%80%94%20EventQR`
const demoProps = DEMO_URL ? { href: DEMO_URL, target: '_blank', rel: 'noopener noreferrer' } : { href: demoHref }

// ── Icons ─────────────────────────────────────────────────────────────────────
function SunIcon() {
  return (<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" /></svg>)
}
function MoonIcon() {
  return (<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>)
}
function Arrow({ className = 'w-4 h-4' }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>)
}
function Check({ className = 'w-5 h-5' }) {
  return (<svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" /></svg>)
}

// ── Scroll reveal ───────────────────────────────────────────────────────────────
function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect() } })
    }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}>
      {children}
    </div>
  )
}

// ── Data ────────────────────────────────────────────────────────────────────────
const problems = [
  'Long lines while staff hunt through paper lists and spreadsheets',
  'Guests arrive with screenshots, forwarded invites, or misspelled names',
  'Duplicate and shared invites slip through',
  'Table and seat assignments cause confusion at the door',
  'Staff keep calling and messaging the organizer',
  'No live view of who has actually arrived',
]

const steps = [
  { n: '1', title: 'Add your guests', desc: 'Upload a spreadsheet, sync a Google Sheet, or add guests by hand. Assign tables, seats, groups, VIP tags, or access zones.', img: '/media/help-guests.png', alt: 'EventQR guest list with tables, groups and VIP tags' },
  { n: '2', title: 'Send personal QR tickets', desc: 'Every guest gets a unique QR ticket by email, SMS, WhatsApp — or an MMS ticket card. No app to install.', img: '/media/help-invites-rsvp.png', alt: 'Sending personalized QR invitations by email, SMS and WhatsApp' },
  { n: '3', title: 'Scan and welcome', desc: 'At the door, staff scan the QR with any phone. The guest is verified instantly with their table, seat and access.', img: '/media/help-check-in.png', alt: 'Staff scanning a guest QR code to check them in' },
]

const features = [
  { t: 'Unique QR tickets', d: 'Every guest gets a personal, unguessable QR ticket — never a shared link.' },
  { t: 'Fast mobile check-in', d: 'Scan with any phone browser. Admission in under a second. No app to install.' },
  { t: 'Tables & seat assignment', d: 'Place guests at the right table and seat — shown the instant they scan.' },
  { t: 'Guest groups & tags', d: 'Family, sponsors, press, staff — tag guests and group their tables.' },
  { t: 'VIP & restricted access', d: 'Zones, gates and ticket rules decide who gets into each area.' },
  { t: 'Duplicate entry blocked', d: 'Forwarded or re-used tickets are caught — "already admitted" on the spot.' },
  { t: 'Real-time dashboard', d: 'Watch invited, admitted, pending and VIP arrivals update live at the door.' },
  { t: 'Custom event messages', d: 'Edit every email, SMS, WhatsApp and MMS — preview and test before you send.' },
  { t: 'Staff-friendly scanner', d: 'A clean scan view with clear allow / deny results anyone can use.' },
  { t: 'Exportable guest records', d: 'Download the full guest list and attendance after the event.' },
]

const moreFeatures = ['Manual check-in (no QR)', 'Self check-in by event code', 'Walk-in registration', 'RSVP & approvals', 'Broadcasts', 'Deliveries & gifts', 'Gift registry', 'Team roles']

const eventTypes = [
  { icon: '💍', t: 'Weddings & Nikkah', d: 'Seat families together with table groups and plus-one pairing.' },
  { icon: '🥂', t: 'Galas & banquets', d: 'VIP access, reserved tables, and live arrivals at a glance.' },
  { icon: '🎤', t: 'Conferences & seminars', d: 'Badges, entry zones and gates for sessions and halls.' },
  { icon: '🕌', t: 'Community & religious', d: 'Welcome large crowds fast — manual, self and walk-in check-in.' },
  { icon: '🏆', t: 'Fundraisers & awards', d: 'Track donors and honorees with VIP tags and live attendance.' },
  { icon: '🎉', t: 'Private parties', d: 'Beautiful invites and a guest list that runs itself at the door.' },
  { icon: '🏢', t: 'Corporate events', d: 'Controlled access, team roles, and exportable attendance records.' },
]

const tabs = [
  { key: 'checkin', label: 'Check-in', img: '/media/help-check-in.png', alt: 'EventQR mobile scanner verifying a guest',
    title: 'Table & seat-aware check-in', body: 'When a guest is scanned, staff instantly see their name, RSVP status, table, seat and access permission — duplicates blocked. Built for weddings, galas and formal events, not just a QR reader.' },
  { key: 'access', label: 'Tables & access', img: '/media/help-entry-areas.png', alt: 'Entry areas, zones and ticket rules in EventQR',
    title: 'Control where every guest belongs', body: 'Assign guests to tables, seats, family groups, VIP areas or vendor zones. On scan, staff see exactly where the guest goes — and whether they’re allowed in.' },
  { key: 'dashboard', label: 'Live dashboard', img: '/media/help-results.png', alt: 'Real-time attendance dashboard in EventQR',
    title: 'Know what is happening at the door', body: 'Total invited, checked-in, pending, VIP arrivals and table-level attendance — updating live as guests walk in.' },
  { key: 'messaging', label: 'Messaging', img: '/media/help-invites-rsvp.png', alt: 'Personalized invitations and message templates in EventQR',
    title: 'Reach every guest, your way', body: 'Send personal QR tickets by email, SMS, WhatsApp or MMS. Edit every message, preview it, and test before the whole list goes out.' },
]

// ── Animated "live scan" hero demo ──────────────────────────────────────────────
function LiveScanDemo() {
  // 0 idle → 1 scanning → 2 verified → 3 seated, then loop.
  const [step, setStep] = useState(0)
  const [count, setCount] = useState(317)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setStep(3); return }
    const seq = [1200, 1100, 1400, 1600] // ms per step
    let i = 0
    let timer
    const tick = () => {
      i = (i + 1) % 4
      setStep(i)
      if (i === 2) setCount((c) => c + 1)
      timer = setTimeout(tick, seq[i])
    }
    timer = setTimeout(tick, seq[0])
    return () => clearTimeout(timer)
  }, [])

  const verified = step >= 2

  return (
    <div className="relative">
      {/* glow */}
      <div className="absolute -inset-6 bg-gradient-to-tr from-teal-400/20 via-emerald-300/10 to-amber-300/20 blur-3xl rounded-[2rem]" aria-hidden="true" />
      <div className="relative grid sm:grid-cols-[auto_1fr] gap-4 items-stretch">
        {/* Phone scanner */}
        <div className="mx-auto w-[210px] rounded-[2rem] border-[6px] border-slate-900 dark:border-slate-700 bg-slate-950 shadow-2xl overflow-hidden">
          <div className="h-6 bg-slate-950 flex items-center justify-center">
            <div className="w-16 h-1.5 rounded-full bg-slate-700" />
          </div>
          <div className="relative bg-slate-900 px-4 pt-4 pb-5">
            <div className="text-[10px] uppercase tracking-wider text-teal-300 font-semibold text-center mb-3">EventQR Scanner</div>
            {/* QR target */}
            <div className="relative mx-auto w-36 h-36 rounded-xl bg-white p-2.5 shadow-inner">
              <div className="grid h-full w-full grid-cols-5 gap-1">
                {Array.from({ length: 25 }).map((_, i) => (
                  <span key={i} className={`rounded-[2px] ${[0,1,2,4,5,9,10,12,14,15,19,20,22,23,24,6,18].includes(i) ? 'bg-slate-950' : 'bg-slate-200'}`} />
                ))}
              </div>
              {/* scan sweep */}
              <div className={`pointer-events-none absolute inset-x-2 h-0.5 bg-teal-400 shadow-[0_0_12px_2px_rgba(45,212,191,0.8)] transition-opacity ${step === 1 ? 'opacity-100 animate-[scan_1.1s_ease-in-out_infinite]' : 'opacity-0'}`} style={{ top: '0.6rem' }} />
              {/* corners */}
              {['top-1 left-1 border-t-2 border-l-2','top-1 right-1 border-t-2 border-r-2','bottom-1 left-1 border-b-2 border-l-2','bottom-1 right-1 border-b-2 border-r-2'].map((c) => (
                <span key={c} className={`absolute w-4 h-4 border-teal-400 ${c}`} />
              ))}
            </div>
            <div className={`mt-3 text-center text-xs font-semibold transition-colors ${verified ? 'text-emerald-400' : 'text-slate-400'}`}>
              {step === 1 ? 'Scanning…' : verified ? '✓ Verified' : 'Point at QR code'}
            </div>
          </div>
        </div>

        {/* Result card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-5 flex flex-col justify-center min-h-[230px]">
          <div className={`transition-all duration-500 ${verified ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-11 h-11 rounded-full bg-emerald-500 text-white shrink-0">
                <Check />
              </span>
              <div>
                <div className="text-lg font-bold text-slate-950 dark:text-white leading-tight">Amara Okafor</div>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Admitted · just now</div>
              </div>
            </div>
            <div className={`mt-4 flex flex-wrap gap-2 transition-all duration-500 ${step >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
              {[['Table', 'VIP-2'], ['Seat', '4'], ['Group', 'Family'], ['Access', 'Main hall']].map(([k, v]) => (
                <span key={k} className="text-xs rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-slate-700 dark:text-slate-200">
                  {k}: <strong className="text-slate-950 dark:text-white">{v}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-2xl font-extrabold text-slate-950 dark:text-white tabular-nums">{count}<span className="text-sm font-medium text-slate-400"> / 426</span></div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Checked in · live</div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Device frame for real screenshots ───────────────────────────────────────────
function Shot({ src, alt, className = '' }) {
  return (
    <div className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
        <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
      </div>
      <img src={src} alt={alt} loading="lazy"
        className="w-full block bg-white dark:opacity-95" />
    </div>
  )
}

// ── CTAs ────────────────────────────────────────────────────────────────────────
function PrimaryCta({ children = 'Create Free Event', className = '' }) {
  return (
    <Link to="/register"
      className={`inline-flex items-center justify-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-teal-700 transition-colors shadow-lg shadow-teal-900/20 ${className}`}>
      {children} <Arrow />
    </Link>
  )
}
function SecondaryCta({ children = 'Book a Demo', className = '' }) {
  return (
    <a {...demoProps}
      className={`inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 px-6 py-3 rounded-xl font-semibold text-sm hover:bg-white dark:hover:bg-slate-900 transition-colors ${className}`}>
      {children}
    </a>
  )
}

export default function LandingPage() {
  const { dark, toggle } = useTheme()
  const [tab, setTab] = useState('checkin')
  const active = tabs.find((t) => t.key === tab) || tabs[0]

  return (
    <div className="app-shell min-h-screen text-slate-900 dark:text-white">
      {/* keyframes for the scan sweep */}
      <style>{`@keyframes scan{0%{top:0.6rem}50%{top:7.4rem}100%{top:0.6rem}}`}</style>

      {/* Nav */}
      <header className="app-nav sticky top-0 z-50 backdrop-blur border-b border-slate-200/70 dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <a href="#top" className="flex items-center gap-2 mr-auto">
            <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow">EQ</div>
            <span className="font-bold text-lg tracking-tight text-slate-950 dark:text-white">EventQR</span>
          </a>
          <nav className="hidden md:flex items-center gap-6 mr-2">
            {[['#problem', 'Why'], ['#features', 'Features'], ['#event-types', 'Event types'], ['#showcase', 'Demo']].map(([href, label]) => (
              <a key={href} href={href} className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">{label}</a>
            ))}
            <Link to="/pricing" className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">Pricing</Link>
          </nav>
          <button onClick={toggle} className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors" aria-label="Toggle theme">
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link to="/login" className="hidden sm:inline text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">Sign In</Link>
          <Link to="/register" className="text-sm font-semibold bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors">Create Free Event</Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section id="top" className="relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-teal-50/70 via-white to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-20 lg:py-24">
          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-200 text-xs font-semibold px-3 py-1.5 rounded-full border border-teal-200/80 dark:border-teal-800/80 mb-6 shadow-sm">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Create · Invite · Seat · Check in
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-950 dark:text-white leading-[1.05]">
                Event check-in without the <span className="bg-gradient-to-r from-teal-600 to-emerald-500 bg-clip-text text-transparent">crowd at the door.</span>
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
                Send QR tickets, manage RSVPs, assign tables and seats, and let your staff check guests in from any phone.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <PrimaryCta />
                <SecondaryCta />
              </div>
              <p className="mt-6 text-sm text-slate-500 dark:text-slate-400 max-w-md">
                Free for small events. Built for weddings, galas, community programs, and private ceremonies.
              </p>
            </div>
            <LiveScanDemo />
          </div>
        </div>
      </section>

      {/* ── Problem ── */}
      <section id="problem" className="py-20 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <Reveal className="text-center max-w-2xl mx-auto">
            <p className="text-sm font-semibold uppercase tracking-wide text-rose-500">Before EventQR</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">The entrance should not be the most stressful part of your event.</h2>
          </Reveal>
          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            {problems.map((p, i) => (
              <Reveal key={p} delay={i * 60}>
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                  <span className="grid place-items-center w-7 h-7 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-500 shrink-0 mt-0.5 font-bold text-sm">✕</span>
                  <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed">{p}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Solution ── */}
      <section className="py-20 bg-slate-950 text-white relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-30 bg-[radial-gradient(40rem_20rem_at_50%_-10%,rgba(45,212,191,0.4),transparent)]" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-400">After EventQR</p>
            <h2 className="mt-2 text-3xl sm:text-5xl font-bold">One QR code. One scan. Full control.</h2>
            <p className="mt-5 text-lg text-slate-300 leading-relaxed">
              Every guest gets a unique QR ticket. Staff verify them in a second — table, seat, group and access appear instantly, duplicates are blocked, and you watch every arrival live.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {['No more paper lists', 'No more confusion at the door', 'See attendance live'].map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur">{t}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="py-20 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Reveal className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">From guest list to welcome in three steps</h2>
          </Reveal>
          <div className="grid lg:grid-cols-3 gap-8">
            {steps.map(({ n, title, desc, img, alt }, i) => (
              <Reveal key={n} delay={i * 100}>
                <div className="h-full flex flex-col">
                  <Shot src={img} alt={alt} className="mb-5" />
                  <div className="flex items-center gap-3 mb-2">
                    <span className="grid place-items-center w-8 h-8 rounded-full bg-teal-600 text-white font-bold text-sm shrink-0">{n}</span>
                    <h3 className="font-bold text-lg text-slate-950 dark:text-white">{title}</h3>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Interactive showcase (carousel) ── */}
      <section id="showcase" className="scroll-mt-16 py-20 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Reveal className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">See EventQR in action</h2>
            <p className="mt-3 text-slate-500 dark:text-slate-400 text-lg">The real product — check-in, tables, dashboard and messaging.</p>
          </Reveal>
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${tab === t.key ? 'bg-teal-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-teal-400'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-8 items-center">
            <Shot key={active.key} src={active.img} alt={active.alt} />
            <div>
              <h3 className="text-2xl font-bold text-slate-950 dark:text-white">{active.title}</h3>
              <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">{active.body}</p>
              <div className="mt-6"><SecondaryCta>Book a Demo</SecondaryCta></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Reveal className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">Everything you need at the door</h2>
            <p className="mt-3 text-slate-500 dark:text-slate-400 text-lg max-w-xl mx-auto">Built for real events, not just online RSVPs.</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map(({ t, d }, i) => (
              <Reveal key={t} delay={(i % 3) * 80}>
                <div className="h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                  <div className="w-11 h-11 rounded-lg bg-teal-50 dark:bg-teal-950/50 grid place-items-center mb-4 text-teal-600 dark:text-teal-300">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-slate-950 dark:text-white mb-1.5">{t}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8 flex flex-wrap justify-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400 mr-1 self-center">And more:</span>
            {moreFeatures.map((m) => (
              <span key={m} className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">{m}</span>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Table & access control (differentiator) ── */}
      <section className="py-20 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">The differentiator</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">Control where every guest belongs.</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300 leading-relaxed">
              Assign guests to tables, seats, family groups, VIP areas, vendor sections or reserved zones. When a guest is scanned, staff immediately see where they should go — and whether they’re allowed into that area.
            </p>
            <ul className="mt-6 space-y-3">
              {['Table groups & tag-based seating', 'VIP and restricted zones with gates', 'Plus-one pairing keeps couples together', 'Out-of-zone guests are flagged on scan'].map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120}><Shot src="/media/help-entry-areas.png" alt="EventQR entry areas, zones and ticket access rules" /></Reveal>
        </div>
      </section>

      {/* ── Real-time dashboard ── */}
      <section className="py-20 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal className="lg:order-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-400">Live visibility</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">Know what is happening at the door.</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300 leading-relaxed">
              Monitor total invited guests, checked-in guests, pending arrivals, VIP arrivals and table-level attendance in real time — from anywhere.
            </p>
            <div className="mt-8"><PrimaryCta /></div>
          </Reveal>
          <Reveal delay={120} className="lg:order-1"><Shot src="/media/help-results.png" alt="EventQR real-time attendance dashboard" /></Reveal>
        </div>
      </section>

      {/* ── Guest experience ── */}
      <section className="py-20 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Guest experience</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">Make guests feel expected.</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300 leading-relaxed">
              No searching for names or asking question after question. Staff greet each guest confidently with their verified details, table information and admission status — in seconds.
            </p>
          </Reveal>
          <Reveal delay={120}><Shot src="/media/help-guest-invite.png" alt="A guest's personal QR ticket in EventQR" /></Reveal>
        </div>
      </section>

      {/* ── Event types ── */}
      <section id="event-types" className="py-20 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Reveal className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-950 dark:text-white">Made for every kind of event</h2>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {eventTypes.map(({ icon, t, d }, i) => (
              <Reveal key={t} delay={(i % 3) * 80}>
                <div className="h-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:shadow-lg transition-shadow">
                  <div className="text-3xl mb-3">{icon}</div>
                  <h3 className="font-semibold text-slate-950 dark:text-white mb-1.5">{t}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust & proof — hidden until we have real stats / testimonials / client logos.
           Re-enable this section (and fill in real numbers, quotes, and logo images) when available.
      <section className="py-20 bg-slate-950 text-white relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 opacity-25 bg-[radial-gradient(40rem_18rem_at_50%_0%,rgba(16,185,129,0.4),transparent)]" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
          <Reveal className="grid grid-cols-3 gap-4 text-center mb-14">
            {[['50k+', 'Guests checked in'], ['1,000+', 'Events run'], ['<1s', 'Per scan']].map(([n, l]) => (
              <div key={l}>
                <div className="text-3xl sm:text-5xl font-extrabold bg-gradient-to-r from-teal-400 to-emerald-300 bg-clip-text text-transparent">{n}</div>
                <div className="mt-1 text-xs sm:text-sm text-slate-400">{l}</div>
              </div>
            ))}
          </Reveal>
          <Reveal>
            <figure className="max-w-2xl mx-auto text-center">
              <blockquote className="text-xl sm:text-2xl font-medium leading-relaxed">
                EventQR helped us manage guest entry smoothly and reduced confusion at the door.
              </blockquote>
              <figcaption className="mt-4 text-sm text-slate-400">Event organizer</figcaption>
            </figure>
          </Reveal>
          <Reveal className="mt-12">
            <p className="text-center text-xs uppercase tracking-wide text-slate-500 mb-4">Trusted by event teams</p>
            <div className="flex flex-wrap justify-center items-center gap-3 opacity-70">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 w-28 rounded-lg bg-white/5 border border-white/10 grid place-items-center text-[10px] text-slate-500">Your logo</div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>
      */}

      {/* ── Tailored solution ── */}
      <section className="py-20 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-slate-950 text-white p-8 sm:p-12">
              <div aria-hidden="true" className="absolute inset-0 opacity-40 bg-[radial-gradient(36rem_18rem_at_85%_-20%,rgba(45,212,191,0.45),transparent)]" />
              <div className="relative grid lg:grid-cols-[1.5fr_1fr] gap-8 items-center">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-teal-400">Tailored solutions</p>
                  <h2 className="mt-2 text-3xl sm:text-4xl font-bold">We have a tailored solution for your needs. Let’s talk.</h2>
                  <p className="mt-4 text-slate-300 leading-relaxed max-w-xl">
                    Large weddings, multi-day conferences, community programs, custom access rules, branding, special seating, or an integration — tell us how your event runs and we’ll set EventQR up around it, with you.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {['Custom access & VIP rules', 'Bulk guest onboarding', 'Branding & messaging', 'Hands-on setup support'].map((t) => (
                      <span key={t} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-3 lg:items-end">
                  <a href={`mailto:${CONTACT_EMAIL}?subject=Tailored%20solution%20%E2%80%94%20EventQR`}
                    className="inline-flex items-center justify-center gap-2 bg-teal-500 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-teal-400 transition-colors shadow-lg shadow-teal-900/30">
                    Let’s talk <Arrow />
                  </a>
                  <a {...demoProps}
                    className="inline-flex items-center justify-center gap-2 border border-white/25 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-white/10 transition-colors">
                    Book a Demo
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <Reveal>
            <h2 className="text-3xl sm:text-5xl font-bold text-slate-950 dark:text-white">Ready to make check-in the easiest part of your event?</h2>
            <p className="mt-5 text-lg text-slate-600 dark:text-slate-400">Create. Invite. Seat. Check in. One simple platform to manage your guests from RSVP to entrance — free for small events.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <PrimaryCta className="px-8 py-4 text-base" />
              <SecondaryCta className="px-8 py-4 text-base" />
            </div>
            <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">
              Questions? <a className="text-teal-600 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg grid place-items-center text-white text-xs font-bold">EQ</div>
            <span className="font-semibold text-slate-900 dark:text-white">EventQR</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-slate-500 dark:text-slate-400">
            <Link to="/pricing" className="hover:text-teal-600">Pricing</Link>
            <Link to="/login" className="hover:text-teal-600">Sign in</Link>
            <a {...demoProps} className="hover:text-teal-600">Book a demo</a>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">© {new Date().getFullYear()} EventQR. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
