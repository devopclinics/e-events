import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// ── Content (data-driven so it stays comprehensive + easy to edit) ───────────
// roles → topics → steps. `img` (optional) is a /guide/*.png screenshot.

const CONTENT = {
  organizer: {
    label: 'Organizer',
    icon: '🗂️',
    blurb: 'Create an event, invite guests, and run check-in on the day.',
    topics: [
      { id: 'org-start', icon: '🚀', title: 'Get started', steps: [
        'Open the site and choose Get Started → sign in with Google or email.',
        'You land in the Admin panel with your own organization, ready to go.',
      ]},
      { id: 'org-create', icon: '📅', title: 'Create your event', img: '/guide/admin-overview.png', steps: [
        'Admin → New Event.',
        'Enter the event name, couple/host name, date & time, and base URL.',
        'Save. Open the event to see its tabs: Overview, Guests, Team, Invite.',
      ]},
      { id: 'org-guests', icon: '👥', title: 'Add your guest list', img: '/guide/admin-guests.png', steps: [
        'Overview tab → upload a CSV/Excel, or paste a Google Sheets / OneDrive link.',
        'Columns expected: first_name, last_name, email, phone.',
        'Or add people one at a time in the Guests tab.',
        'Free events allow up to 25 guests — an Event Pass raises the limit.',
      ]},
      { id: 'org-rsvp', icon: '✉️', title: 'Set up RSVP & invite page', img: '/guide/admin-invite.png', steps: [
        'Invite tab → "Invite Page & RSVP".',
        'Pick Open (one shared link) or Closed (a unique private link per guest).',
        'Optional: RSVP deadline, require approval, custom questions, cover image, message.',
        'Use "Preview invite page" to see exactly what guests will get.',
      ]},
      { id: 'org-send', icon: '📤', title: 'Send invitations', steps: [
        'Open mode: share the event link, or use Manual invite for specific people.',
        'Closed mode: use Bulk RSVP invites — Send to not-yet-invited, Remind no-reply, or Resend to all.',
        'Email is always free; SMS/WhatsApp require an Event Pass + message credits.',
      ]},
      { id: 'org-track', icon: '✅', title: 'Track RSVPs & approvals', steps: [
        'Guests tab shows each person: Attending / Declined / Pending / No reply, plus check-in status.',
        'If approval is on, approve or reject pending RSVPs (or Approve all).',
      ]},
      { id: 'org-broadcast', icon: '📣', title: 'Broadcast an update', steps: [
        'Invite tab → Broadcast Message.',
        'Pick a target: All, RSVP Attending/Declined/No-reply, Checked-in, or Not checked-in.',
        'Send via email / SMS / WhatsApp.',
      ]},
      { id: 'org-seating', icon: '🍽️', title: 'Seating & menu (paid)', steps: [
        'Overview → Features → turn on Seating / Menu (requires an Event Pass).',
        'Seating tab: create tables, auto-assign or place guests, reserve seats.',
        'Menu tab: add categories/items; guests pick meals; track catering.',
      ]},
      { id: 'org-team', icon: '🧑‍🤝‍🧑', title: 'Add your team', img: '/guide/admin-team.png', steps: [
        'Team tab → "Add a teammate" → enter email + role (Staff to scan, Admin to manage).',
        'They sign in with that email and the account links automatically.',
        'Assign staff to the specific event so they can scan it.',
      ]},
      { id: 'org-checkin', icon: '🎟️', title: 'Check-in day', steps: [
        'Check-in needs an Event Pass. Set the event to Active (Overview).',
        'You or your staff open Scanner and scan each guest’s QR — admission is instant.',
        'Watch it live on the Dashboard.',
      ]},
      { id: 'org-upgrade', icon: '💳', title: 'Upgrade & credits', img: '/guide/pricing.png', steps: [
        'Invite tab → Event Pass. Free = email-only, 25 guests, branding, no seating/menu/check-in.',
        'Buy a pass to unlock SMS/WhatsApp, more guests, seating & menu, check-in, and remove branding.',
        'Low on messages? Buy a credit top-up in the same panel. See all plans at /pricing.',
      ]},
    ],
  },
  staff: {
    label: 'Staff / Scanner',
    icon: '📷',
    blurb: 'Check guests in at the door.',
    topics: [
      { id: 'staff-join', icon: '🔑', title: 'Join & sign in', steps: [
        'Your organizer adds you by email — sign in with that exact email.',
        'They assign you to the event you’ll be working.',
      ]},
      { id: 'staff-scan', icon: '📷', title: 'Check guests in', img: '/guide/scanner.png', steps: [
        'Open Scanner → Start Camera → point at each guest’s QR.',
        'No app to install — it runs right in the browser.',
      ]},
      { id: 'staff-results', icon: 'ℹ️', title: 'Reading the result', steps: [
        'Welcome — admitted successfully.',
        'Already admitted — the ticket was used before.',
        'Not assigned / needs pass — ask the organizer.',
      ]},
    ],
  },
  guest: {
    label: 'Guest',
    icon: '🎉',
    blurb: 'You received an invite.',
    topics: [
      { id: 'guest-open', icon: '🔗', title: 'Open your invite', img: '/guide/invite-page.png', steps: [
        'Tap the link in your email, SMS, or WhatsApp.',
      ]},
      { id: 'guest-rsvp', icon: '📝', title: 'RSVP', steps: [
        'Fill in the form and any questions → Confirm (or Can’t make it).',
        'On a personal link you can change your answer until the deadline.',
      ]},
      { id: 'guest-ticket', icon: '🎟️', title: 'Get your ticket', steps: [
        'Once confirmed, your ticket QR is emailed to you.',
        'On the day, show the QR (phone or printed) at the entrance.',
      ]},
    ],
  },
  operator: {
    label: 'Operator',
    icon: '🛠️',
    blurb: 'Run the EventQR platform.',
    topics: [
      { id: 'op-open', icon: '🛠️', title: 'Open the Console', steps: [
        'Operators see a Console link in the nav (/console).',
      ]},
      { id: 'op-grant', icon: '🎁', title: 'Comp events & credits', steps: [
        'Console → Overview lists every organization and its events.',
        'Comp an event onto a tier, or add message credits — one click, no payment.',
      ]},
      { id: 'op-pricing', icon: '💲', title: 'Edit pricing', steps: [
        'Console → Pricing: edit tiers/credit packs (price, credits, caps, active).',
        'Changes reflect on the live pricing page and checkout immediately.',
      ]},
      { id: 'op-operators', icon: '👤', title: 'Manage operators', steps: [
        'Console → Operators: add an operator by email, or revoke one (not yourself).',
      ]},
    ],
  },
}

// ── UI ───────────────────────────────────────────────────────────────────────

function Topic({ t, open, onToggle, query }) {
  const hl = (s) => {
    if (!query) return s
    const i = s.toLowerCase().indexOf(query.toLowerCase())
    if (i < 0) return s
    return <>{s.slice(0, i)}<mark className="bg-yellow-200 dark:bg-yellow-500/40 rounded px-0.5">{s.slice(i, i + query.length)}</mark>{s.slice(i + query.length)}</>
  }
  return (
    <div id={t.id} className="scroll-mt-24 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
        <span className="text-xl leading-none">{t.icon}</span>
        <span className="font-semibold text-slate-900 dark:text-white flex-1">{hl(t.title)}</span>
        <svg className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4">
          <ol className="space-y-3">
            {t.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{hl(s)}</span>
              </li>
            ))}
          </ol>
          {t.img && (
            <a href={t.img} target="_blank" rel="noopener noreferrer" className="block">
              <img src={t.img} alt={t.title} loading="lazy"
                className="rounded-xl border border-slate-200 dark:border-slate-700 w-full hover:opacity-95 transition-opacity" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export default function HelpPage() {
  const { user } = useAuth()
  const isSuper = !!user?.is_platform_superadmin
  const isAdmin = user?.role === 'admin'

  const roles = useMemo(() => {
    const r = []
    if (isAdmin || isSuper) r.push('organizer')
    r.push('staff', 'guest')
    if (isSuper) r.push('operator')
    return r
  }, [isAdmin, isSuper])

  const [role, setRole] = useState(roles[0] || 'guest')
  const [query, setQuery] = useState('')
  const data = CONTENT[role]

  const topics = useMemo(() => {
    if (!query.trim()) return data.topics
    const q = query.toLowerCase()
    return data.topics.filter((t) =>
      t.title.toLowerCase().includes(q) || t.steps.some((s) => s.toLowerCase().includes(q)))
  }, [data, query])

  // open topics: all open when searching, else first open
  const [openSet, setOpenSet] = useState(() => new Set([data.topics[0]?.id]))
  const isOpen = (id) => (query.trim() ? true : openSet.has(id))
  const toggle = (id) => setOpenSet((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  function pickRole(r) {
    setRole(r); setQuery('')
    setOpenSet(new Set([CONTENT[r].topics[0]?.id]))
  }
  function jump(id) {
    setOpenSet((prev) => new Set(prev).add(id))
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-700 text-white p-7 sm:p-9 mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold">Help &amp; How-To</h1>
        <p className="mt-2 text-white/85 text-sm sm:text-base max-w-2xl">
          Step-by-step instructions for everything in EventQR. Pick your role, or search.
        </p>
        {/* Role switcher */}
        <div className="mt-5 flex flex-wrap gap-2">
          {roles.map((r) => (
            <button key={r} onClick={() => pickRole(r)}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                role === r ? 'bg-white text-teal-700' : 'bg-white/15 text-white hover:bg-white/25'}`}>
              {CONTENT[r].label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="w-5 h-5 absolute left-3 top-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search the ${data.label.toLowerCase()} guide…`}
          className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      <div className="grid lg:grid-cols-[210px_1fr] gap-6">
        {/* Sticky TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{data.label}</div>
            {data.topics.map((t) => (
              <button key={t.id} onClick={() => jump(t.id)}
                className="block w-full text-left text-sm text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-300 py-1">
                <span className="mr-2">{t.icon}</span>{t.title}
              </button>
            ))}
          </div>
        </aside>

        {/* Topics */}
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{data.blurb}</p>
          {topics.length === 0 && <p className="text-sm text-slate-400">No matches for “{query}”.</p>}
          {topics.map((t) => (
            <Topic key={t.id} t={t} open={isOpen(t.id)} onToggle={() => toggle(t.id)} query={query} />
          ))}
          {role !== 'guest' && (
            <p className="text-xs text-slate-400 dark:text-slate-500 pt-2">
              Need more? <Link to="/pricing" className="text-teal-600 hover:underline">See pricing</Link> ·
              {' '}<a href="mailto:info@devopclinics.com" className="text-teal-600 hover:underline">Contact support</a>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
