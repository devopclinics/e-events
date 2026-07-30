import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useCurrentEvent } from '../../hooks/useCurrentEvent'
import { api } from '../../api'
import { RedesignShellBoundary, RedesignRouteBoundary } from './RedesignErrorBoundaries'
import { logFallbackToLegacy, logRenderError } from './redesignTelemetry'
import './RedesignShell.css'

// ── shared dialog primitives, used across every redesign page ──────────
// Real app mostly uses plain window.confirm() for destructive actions
// (AdminPage.jsx has ~35 such call sites) rather than bespoke modals —
// ConfirmDialog mirrors that low weight rather than over-building it.

export function Modal({ title, children, onClose, width = 480 }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="rr-modal-backdrop" onClick={onClose}>
      <div className="rr-panel rr-modal" style={{ width: `min(${width}px, 92vw)` }} onClick={(e) => e.stopPropagation()}>
        <div className="rd-panel-head rr-modal-head">
          <h3>{title}</h3>
          <button className="rr-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rd-panel-body">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({ title = 'Are you sure?', message, danger = true, confirmLabel = 'Delete', requireTypedWord, checklist, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState(() => new Set())
  const wordOk = !requireTypedWord || typed.trim().toUpperCase() === requireTypedWord.toUpperCase()
  const anyChecked = !checklist || checked.size > 0
  const canConfirm = wordOk && anyChecked

  function toggleItem(key) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <p className="rr-confirm-message">{message}</p>
      {checklist && (
        <div className="rr-confirm-checklist">
          {checklist.map((item) => (
            <label key={item.key} className="gr-required-check">
              <input type="checkbox" checked={checked.has(item.key)} onChange={() => toggleItem(item.key)} /> {item.label}
              {item.hint && <small className="rd-rowlink"> — {item.hint}</small>}
            </label>
          ))}
        </div>
      )}
      {requireTypedWord && (
        <>
          <label className="rd-field-label" style={{ marginTop: 10 }}>Type {requireTypedWord} to confirm</label>
          <input className="rd-field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireTypedWord} />
        </>
      )}
      <div className="rd-row2" style={{ marginTop: 12 }}>
        <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onCancel}>Cancel</button>
        <button className={`rr-btn ${danger ? 'danger' : 'primary'}`} style={{ flex: 1, justifyContent: 'center' }} disabled={!canConfirm} onClick={() => onConfirm([...checked])}>{confirmLabel}</button>
      </div>
    </Modal>
  )
}

const CHANNEL_FRAME_META = {
  email: { label: 'Email', icon: 'mail' },
  sms: { label: 'SMS', icon: 'message' },
  whatsapp: { label: 'WhatsApp', icon: 'whatsapp' },
  mms: { label: 'MMS', icon: 'image' },
}

export function ChannelPreviewFrame({ channel = 'email', body }) {
  const meta = CHANNEL_FRAME_META[channel] || CHANNEL_FRAME_META.email
  return (
    <div className={`rr-chan-frame rr-chan-frame-${channel}`}>
      <div className="rr-chan-frame-head"><Icon name={meta.icon} size={13} /> {meta.label} preview</div>
      <div className={`rr-chan-frame-body rr-chan-frame-body-${channel}`}>{body}</div>
    </div>
  )
}

export function Icon({ name, size = 18, className }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    ticket: <><path d="M2 9a3 3 0 0 0 0 6v4h20v-4a3 3 0 0 0 0-6V5H2Z"/><path d="M13 5v2M13 11v2M13 17v2"/></>,
    chair: <><path d="M6 11V6a3 3 0 0 1 6 0v5M4 11h10a2 2 0 0 1 2 2v3H2v-3a2 2 0 0 1 2-2ZM4 16v4M14 16v4"/></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></>,
    team: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6M19 14a5 5 0 0 1 3 5v2"/></>,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.55-1H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-1.55V3h4v.08a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1H21v4h-.08a1.7 1.7 0 0 0-1.52 1Z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M14 21h-4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    trend: <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>,
    external: <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    upload: <><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></>,
    cloud: <><path d="M17 8V6a4 4 0 0 0-4-4h-1a4 4 0 0 0-4 4v2"/><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M8 12h8M8 16h5"/></>,
    api: <><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></>,
    whatsapp: <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.4L3 20l1.2-5.4A8.5 8.5 0 1 1 21 11.5Z"/>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>,
    barchart: <><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></>,
    help: <><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 2-3 4"/><path d="M12 17h.01"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    chevrondown: <path d="m6 9 6 6 6-6"/>,
    info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    palette: <><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="13.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.2" fill="currentColor" stroke="none"/><path d="M12 21a2 2 0 0 1-2-2c0-1 1-1 1-2a1.5 1.5 0 0 0-1.5-1.5H8a4 4 0 0 1-4-4 9 9 0 0 1 9-9"/></>,
    chat: <><path d="M8 10h8M8 14h5"/><path d="M21 12a8 8 0 1 1-3.2-6.4"/><path d="M21 3v6h-6"/></>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  }
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

// Mirrors the real top nav (App.jsx Nav, :85-203). Destinations point at the
// mockup routes closest to each real page; where the real link goes to a
// different surface entirely (Check-in -> /scanner live camera tool,
// Orders -> /kitchen live fulfillment display) we point at the admin-side
// management mockup instead, since the live field tools aren't in scope here.
//
// `gate(ctx)` mirrors the exact visibility rules in the real Nav component
// (App.jsx :104-136) — ctx is { user, event }. No gate = always shown.
const TOP_LINKS = [
  { id: 'setup', label: 'Event Setup', to: '/admin-redesign', icon: 'calendar' },
  {
    id: 'design', label: 'Design Studio', to: '/design-studio-redesign', icon: 'palette',
    gate: ({ user, event }) => user?.role === 'admin' && !!event?.is_paid,
  },
  { id: 'results', label: 'Results', to: '/event-results-redesign', icon: 'barchart' },
  { id: 'mytasks', label: 'My Tasks', to: '/team-redesign?tab=mytasks', icon: 'file' },
  {
    id: 'org', label: 'Org Settings', to: '/billing-redesign?tab=org', icon: 'settings',
    gate: ({ user }) => user?.role === 'admin',
  },
  {
    id: 'festiome', label: 'FestioMe', to: '/festiome-redesign', icon: 'chat',
    gate: ({ event }) => !!event?.festiome_addon_enabled,
  },
  { id: 'checkin', label: 'Check-in', to: '/scanner', icon: 'ticket' },
  {
    id: 'orders', label: 'Orders', to: '/kitchen-redesign', icon: 'card',
    gate: ({ event }) => !!event?.menu_enabled,
  },
  {
    id: 'console', label: 'Console', to: '/superadmin-redesign?tab=console', icon: 'shield',
    gate: ({ user }) => !!user?.is_platform_superadmin,
  },
  {
    id: 'media', label: 'Media', to: '/superadmin-redesign?tab=media', icon: 'file',
    gate: ({ user }) => !!user?.is_platform_superadmin,
  },
  {
    id: 'help', label: 'Help', to: '/help-redesign', icon: 'help',
    gate: ({ user, event }) => user?.role !== 'event_manager' && (!!event?.is_paid || !!user?.is_platform_superadmin),
  },
]

const SIDEBAR_NAV = [
  ['grp', 'Setup Progress'],
  ['calendar', 'Start here', '/admin-redesign', 'overview'],
  ['users', 'Guests', '/guests-redesign?tab=guests', 'guests'],
  ['send', 'Invites & RSVP', '/guests-redesign?tab=invite', 'invite'],
  ['ticket', 'Check-in', '/scanner', 'access', null, 'venueAccess'],
  ['message', 'Guest Communication', '/communications-redesign?tab=hub', 'communication'],
  ['card', 'Billing', '/billing-redesign?tab=billing', 'billing'],
  ['grp', 'Add-ons'],
  ['chair', 'Seating', '/addons-redesign?tab=seating', 'seating', null, 'seating'],
  ['card', 'Orders', '/kitchen-redesign', 'menu', null, 'orders'],
  ['upload', 'Deliveries', '/addons-redesign?tab=logistics', 'logistics', null, 'logistics'],
  ['image', 'Gift list', '/addons-redesign?tab=registry', 'registry', null, 'registry'],
  ['grp', 'Team & Settings'],
  ['team', 'Team', '/team-redesign?tab=team', 'team'],
  ['file', 'Tasks', '/team-redesign?tab=tasks', 'tasks'],
  ['barchart', 'Experience', '/experience-redesign', 'experience'],
  ['message', 'Messages', '/communications-redesign?tab=messages', 'messages'],
  ['settings', 'Features & messaging', '/communications-redesign?tab=settings', 'features'],
]

function ThemeToggle() {
  const theme = useTheme()
  if (!theme) return null
  const { dark, toggle } = theme
  return (
    <button className="rr-theme-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      <Icon name={dark ? 'sun' : 'moon'} size={15} />
    </button>
  )
}

export default function RedesignShell({ topActive, withEventSidebar = false, eventActive, children }) {
  const location = useLocation()
  const { user } = useAuth()
  const [currentEventId, setCurrentEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!user) { setEvents([]); return }
    let cancelled = false
    api.listEvents()
      .then((evs) => { if (!cancelled) setEvents(evs) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [user])

  const event = events.find((e) => e.id === currentEventId) || null

  // Real per-event add-on entitlements — same fields the legacy sidebar
  // gates on (AdminPage.jsx). Falls back to all-hidden while no event is
  // selected/loaded, matching how the real app behaves with no current event.
  const flags = {
    venueAccess: !!event?.venue_access_enabled,
    seating: !!event?.seating_enabled,
    orders: !!event?.menu_enabled,
    logistics: !!event?.logistics_enabled,
    registry: !!event?.registry_enabled,
  }

  const eventName = event?.name || (currentEventId ? 'Loading…' : 'No event selected')
  const visibleTopLinks = TOP_LINKS.filter((l) => !l.gate || l.gate({ user, event }))

  function handleShellError(error, errorInfo) {
    logRenderError({ module: 'shell', error: error?.message, errorInfo: errorInfo?.componentStack })
  }

  function handleRouteError(error, errorInfo) {
    logRenderError({ module: topActive || eventActive, error: error?.message, errorInfo: errorInfo?.componentStack })
  }

  return (
    <RedesignShellBoundary onError={handleShellError}>

    <div className="admin-redesign rr">
      <header className="rr-topbar">
        <div className="rr-topbar-inner">
          <Link to="/admin-redesign" className="rr-topbar-brand">
            <span className="rr-topbar-mark">F</span> Festio
          </Link>

          <nav className="rr-topbar-links">
            {visibleTopLinks.map((l) => (
              <Link key={l.id} to={l.to} className={topActive === l.id ? 'active' : ''}>
                {l.label}
              </Link>
            ))}
          </nav>

          {withEventSidebar && (
            events.length > 0 ? (
              <label className="rr-topbar-event" title="Switch event">
                <Icon name="calendar" size={12} />
                <select
                  className="rr-topbar-event-select"
                  value={currentEventId || ''}
                  onChange={(e) => setCurrentEventId(e.target.value)}
                >
                  {!currentEventId && <option value="">Choose an event…</option>}
                  {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
            ) : (
              <span className="rr-topbar-event">
                <Icon name="calendar" size={12} /> <span>{eventName}</span>
              </span>
            )
          )}

          <div className="rr-topbar-right">
            {user && (
              <div className="rr-topbar-user">
                <div><strong>{user.name}</strong><span>{user.role}</span></div>
                <div className="rr-topbar-avatar">{user.name?.[0]?.toUpperCase() || '?'}</div>
              </div>
            )}
            <ThemeToggle />
            <button className="rr-menu" onClick={() => setMenu((v) => !v)} aria-label="Menu">☰</button>
          </div>
        </div>
        {menu && !withEventSidebar && (
          <div className="rr-topbar-drawer">
            {visibleTopLinks.map((l) => (
              <Link key={l.id} to={l.to} onClick={() => setMenu(false)} className={topActive === l.id ? 'active' : ''}>
                <Icon name={l.icon} size={15} /> {l.label}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className={`rr-body ${withEventSidebar ? 'has-sidebar' : ''}`}>
        {withEventSidebar && (
          <>
            <aside className={`rr-sidebar ${menu ? 'is-open' : ''}`}>
              <div className="rr-sidebar-head">
                <Icon name="calendar" size={16} /><strong>Event Setup</strong>
                <button className="rr-sidebar-close" onClick={() => setMenu(false)}>×</button>
              </div>
              <nav>
                <div className="rr-sidebar-mobile-global">
                  {visibleTopLinks.map((l) => (
                    <Link key={l.id} to={l.to} onClick={() => setMenu(false)} className={topActive === l.id ? 'active' : ''}>
                      <Icon name={l.icon} size={15} /><span>{l.label}</span>
                    </Link>
                  ))}
                </div>
                {SIDEBAR_NAV.map(([icon, label, to, id, count, gate], i) => {
                  if (icon === 'grp') return <small key={label + i}>{label.toUpperCase()}</small>
                  if (gate && !flags[gate]) return null
                  return (
                    <Link key={label} to={to} className={eventActive === id ? 'active' : ''}>
                      <Icon name={icon} size={15} /><span>{label}</span>
                      {count != null && <b>{count}</b>}
                    </Link>
                  )
                })}
              </nav>
            </aside>
          </>
        )}

        <main className={`rr-main ${withEventSidebar ? '' : 'rr-main-wide'}`}>
          <RedesignRouteBoundary onError={handleRouteError}>
            {children}
          </RedesignRouteBoundary>
        </main>
      </div>

      <RedesignStatusBanner cohort={event?.my_redesign_cohort} location={location} />
    </div>
    </RedesignShellBoundary>
  )
}

// ── Cohort-aware status banner ────────────────────────────────────────────────
// Shown at the bottom of every redesign page so users always know which UI
// they're on and — for auto-redirected cohorts — how to get back to legacy.
function RedesignStatusBanner({ cohort, location }) {
  const AUTO_REDIRECT = cohort === 'redesign_default' || cohort === 'legacy_retired'
  const legacyPath = REDESIGN_TO_LEGACY[location.pathname] || '/admin'
  const legacyHref = `${legacyPath}?ui=legacy`

  return (
    <div className={`rd-mockflag ${AUTO_REDIRECT ? 'rd-mockflag-default' : ''}`}>
      {AUTO_REDIRECT ? (
        <>
          <b>New interface</b> — your organisation is on the redesign preview.{' '}
          <a href={legacyHref} className="rr-link-btn" style={{ fontWeight: 600 }} onClick={() => logFallbackToLegacy({ route: location.pathname, module: 'shell', reason: 'user_escape_hatch' })}>
            Switch to legacy UI →
          </a>
        </>
      ) : (
        <>
          <b>Redesign preview</b> — connected to your real account and selected event.
          Route: {location.pathname}{location.search}
        </>
      )}
    </div>
  )
}

// Maps each redesign route back to its legacy equivalent for the escape link.
const REDESIGN_TO_LEGACY = {
  '/admin-redesign': '/admin',
  '/guests-redesign': '/admin',
  '/communications-redesign': '/admin',
  '/addons-redesign': '/admin',
  '/checkin-redesign': '/admin',
  '/billing-redesign': '/org-settings',
  '/team-redesign': '/admin',
  '/experience-redesign': '/admin',
  '/design-studio-redesign': '/design-studio',
  '/event-results-redesign': '/dashboard',
  '/festiome-redesign': '/festiome',
  '/superadmin-redesign': '/console',
  '/help-redesign': '/help',
  '/scanner-redesign': '/scanner',
  '/kitchen-redesign': '/kitchen',
  '/setup-redesign': '/setup',
  '/api-explorer-redesign': '/api-explorer',
  '/floorplan-redesign': '/admin',
}
