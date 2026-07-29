import { Component, lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { api } from './api'
import { useCurrentEvent } from './hooks/useCurrentEvent'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import SupportWidget from './components/SupportWidget'
import RedesignGate from './pages/redesign/RedesignGate'

// Route pages are intentionally lazy: declaring both legacy and redesign routes
// must not make users download both implementations at startup.
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ScannerPage = lazy(() => import('./pages/ScannerPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ResultsPage = lazy(() => import('./pages/ResultsPage'))
const ScanAutoPage = lazy(() => import('./pages/ScanAutoPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const VendorPage = lazy(() => import('./pages/VendorPage'))
const RegistryPage = lazy(() => import('./pages/RegistryPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const FloorPlanPage = lazy(() => import('./pages/FloorPlanPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const SetupWizardPage = lazy(() => import('./pages/SetupWizardPage'))
const GuidedSetupPage = lazy(() => import('./pages/GuidedSetupPage'))
const RefundPolicyPage = lazy(() => import('./pages/RefundPolicyPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const SmsPolicyPage = lazy(() => import('./pages/SmsPolicyPage'))
const DesignStudioPage = lazy(() => import('./pages/DesignStudioPage'))
const ConsolePage = lazy(() => import('./pages/ConsolePage'))
const KitchenPage = lazy(() => import('./pages/KitchenPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const MediaPage = lazy(() => import('./pages/MediaPage'))
const SelfCheckinPage = lazy(() => import('./pages/SelfCheckinPage'))
const FestioMePage = lazy(() => import('./pages/FestioMePage'))
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'))
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'))
const ApiDocsPage = lazy(() => import('./pages/ApiDocsPage'))
const ApiExplorerPage = lazy(() => import('./pages/ApiExplorerPage'))

const AdminRedesignPage = lazy(() => import('./pages/AdminRedesignPage'))
const GuestsRedesignPage = lazy(() => import('./pages/GuestsRedesignPage'))
const CommunicationsRedesignPage = lazy(() => import('./pages/CommunicationsRedesignPage'))
const BillingRedesignPage = lazy(() => import('./pages/BillingRedesignPage'))
const AddonsRedesignPage = lazy(() => import('./pages/AddonsRedesignPage'))
const TeamRedesignPage = lazy(() => import('./pages/TeamRedesignPage'))
const ExperienceRedesignPage = lazy(() => import('./pages/ExperienceRedesignPage'))
const CheckinRedesignPage = lazy(() => import('./pages/CheckinRedesignPage'))
const SuperadminRedesignPage = lazy(() => import('./pages/SuperadminRedesignPage'))
const DesignStudioRedesignPage = lazy(() => import('./pages/DesignStudioRedesignPage'))
const EventResultsRedesignPage = lazy(() => import('./pages/EventResultsRedesignPage'))
const FestioMeRedesignPage = lazy(() => import('./pages/FestioMeRedesignPage'))
const HelpRedesignPage = lazy(() => import('./pages/HelpRedesignPage'))
const ScannerRedesignPage = lazy(() => import('./pages/ScannerRedesignPage'))
const KitchenRedesignPage = lazy(() => import('./pages/KitchenRedesignPage'))
const SelfCheckinRedesignPage = lazy(() => import('./pages/SelfCheckinRedesignPage'))
const FloorPlanRedesignPage = lazy(() => import('./pages/FloorPlanRedesignPage'))
const SetupRedesignPage = lazy(() => import('./pages/SetupRedesignPage'))
const ApiExplorerRedesignPage = lazy(() => import('./pages/ApiExplorerRedesignPage'))
const PublicPagesRedesignPage = lazy(() => import('./pages/PublicPagesRedesignPage'))

// ── Preferred-view helpers ────────────────────────────────────────────────────

export function getPreferredView(role) {
  const stored = localStorage.getItem('preferredView')
  if (stored === 'setup' && (role === 'admin' || role === 'event_manager')) return '/setup'
  if (stored === 'admin' && role === 'admin') return '/admin'
  if (stored === 'admin' && role === 'event_manager') return '/admin'
  if (stored === 'dashboard') return '/dashboard'
  if (stored === 'scanner') return '/scanner'
  return role === 'admin' || role === 'event_manager' ? '/admin' : '/scanner'
}

export function setPreferredView(view) {
  localStorage.setItem('preferredView', view)
}

// ── Theme toggle button ───────────────────────────────────────────────────────

function ThemeToggle({ className = '' }) {
  const { dark, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-lg transition-colors ${className}`}
      aria-label="Toggle theme"
    >
      {dark ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
      )}
    </button>
  )
}

// ── Mobile-friendly Nav ───────────────────────────────────────────────────────

function Nav({ hasMenu, eventName, canUseDesignStudio, hasFestioMe, canManageCurrentEvent, hasGuestDirectory }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const activeLink = 'bg-teal-50 text-teal-800 dark:bg-teal-400/10 dark:text-teal-100 font-semibold'
  const idleLink = 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white'
  const linkCls = ({ isActive }) =>
    `px-3 py-2 rounded-md text-sm transition-colors ${isActive ? activeLink : idleLink}`

  function signOut() {
    logout()
    navigate('/login')
  }

  const links = [
    ...(((!eventName && ['admin', 'event_manager'].includes(user?.role)) || canManageCurrentEvent || hasGuestDirectory)
      ? [{ to: '/admin', label: hasGuestDirectory && !canManageCurrentEvent ? 'Guests' : 'Event Setup', end: true }]
      : []),
    ...(user?.role === 'admin' && canUseDesignStudio ? [{ to: '/design-studio', label: 'Design Studio' }] : []),
    { to: '/dashboard', label: 'Results' },
    { to: '/my-tasks', label: 'My Tasks' },
    ...(user?.role === 'admin' ? [{ to: '/org-settings', label: 'Org Settings' }] : []),
    ...(hasFestioMe ? [{ to: '/festiome', label: 'FestioMe' }] : []),
    { to: '/scanner', label: 'Check-in' },
    ...(hasMenu ? [{ to: '/kitchen', label: 'Orders' }] : []),
    ...(user?.is_platform_superadmin ? [{ to: '/console', label: 'Console' }] : []),
    ...(user?.is_platform_superadmin ? [{ to: '/media-library', label: 'Media' }] : []),
    // Help is a paid perk: visible only when the selected event is paid
    // (same flag as Design Studio). Superadmins always see it.
    ...(user?.role !== 'event_manager' && (canUseDesignStudio || user?.is_platform_superadmin)
      ? [{ to: '/help', label: 'Help' }] : []),
  ]

  return (
    <nav className="app-nav sticky top-0 z-50 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-3">
        <NavLink
          to="/"
          className="flex items-center gap-2 text-slate-950 dark:text-white font-bold text-lg mr-2 tracking-tight rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
          aria-label="Go to Festio home"
        >
          <span className="grid h-8 w-8 place-items-center rounded-md bg-teal-600 text-white text-sm">F</span>
          Festio
        </NavLink>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-1">
          {links.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={linkCls}>{label}</NavLink>
          ))}
        </div>

        {/* Current-event breadcrumb — the shared context, click to manage */}
        {eventName && (
          <NavLink to="/admin" title="Current event — manage"
            className="hidden md:flex items-center gap-1.5 max-w-[14rem] truncate px-3 py-1.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/50">
            <span>📅</span><span className="truncate">{eventName}</span>
          </NavLink>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* User info — desktop */}
          {user && (
            <div className="hidden sm:block text-right">
              <div className="text-slate-900 dark:text-white text-sm font-medium leading-none">{user.name}</div>
              <div className="text-slate-500 dark:text-slate-400 text-xs mt-0.5 capitalize">{user.role}</div>
            </div>
          )}
          {user && (
            <div className="w-8 h-8 rounded-full bg-slate-900 dark:bg-slate-700 flex items-center justify-center text-white font-semibold text-sm shrink-0">
              {user.name[0].toUpperCase()}
            </div>
          )}

          {/* Theme toggle */}
          <ThemeToggle className="text-slate-500 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/5" />

          {/* Sign out — desktop */}
          {user && (
            <button onClick={signOut}
              className="hidden sm:block text-slate-500 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white text-xs font-medium px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
              Sign out
            </button>
          )}

          {/* Hamburger — mobile */}
          {user && (
            <button onClick={() => setOpen((v) => !v)}
              className="sm:hidden flex flex-col gap-1.5 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
              aria-label="Menu">
              <span className={`block w-5 h-0.5 bg-slate-800 dark:bg-white transition-all ${open ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block w-5 h-0.5 bg-slate-800 dark:bg-white transition-all ${open ? 'opacity-0' : ''}`} />
              <span className={`block w-5 h-0.5 bg-slate-800 dark:bg-white transition-all ${open ? '-rotate-45 -translate-y-2' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Mobile drawer */}
      {open && user && (
        <div className="sm:hidden absolute top-16 inset-x-0 bg-white dark:bg-slate-950 shadow-xl border-t border-slate-200 dark:border-slate-800 py-3 px-4 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 text-xs px-3 py-1 mb-2">{user.name} · {user.role}</div>
          {links.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? activeLink : idleLink}`}>
              {label}
            </NavLink>
          ))}
          <button onClick={signOut}
            className="block w-full text-left px-4 py-3 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors mt-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            Sign out
          </button>
        </div>
      )}
    </nav>
  )
}

// ── Mobile day-of bottom bar ───────────────────────────────────────────────────
function MobileTabBar({ user, hasMenu, hasFestioMe, canManageCurrentEvent, hasGuestDirectory }) {
  if (!user) return null
  const items = [
    ...((canManageCurrentEvent || hasGuestDirectory)
      ? [{ to: '/admin', label: hasGuestDirectory && !canManageCurrentEvent ? 'Guests' : 'Setup', icon: '🗂️' }]
      : []),
    { to: '/dashboard', label: 'Results', icon: '📊' },
    ...(hasFestioMe ? [{ to: '/festiome', label: 'FestioMe', icon: '💬' }] : []),
    { to: '/scanner', label: 'Check-in', icon: '🎟️' },
    ...(hasMenu ? [{ to: '/kitchen', label: 'Orders', icon: '☑' }] : []),
  ]
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 flex">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end
          className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}>
          <span className="text-lg leading-none">{it.icon}</span>{it.label}
        </NavLink>
      ))}
    </nav>
  )
}

// Authenticated shell: nav + content + mobile bottom bar. Fetches the user's
// menu access once and shares it with both nav surfaces.
function AuthedLayout({ children }) {
  const { user } = useAuth()
  const [hasMenu, setHasMenu] = useState(false)
  const [currentEventId] = useCurrentEvent()
  const [eventName, setEventName] = useState('')
  const [canUseDesignStudio, setCanUseDesignStudio] = useState(false)
  const [hasFestioMe, setHasFestioMe] = useState(false)
  const [canManageCurrentEvent, setCanManageCurrentEvent] = useState(false)
  const [hasGuestDirectory, setHasGuestDirectory] = useState(false)

  useEffect(() => {
    if (!user) { setHasMenu(false); return }
    api.myMenuEvents().then((evs) => setHasMenu((evs || []).length > 0)).catch(() => setHasMenu(false))
  }, [user])

  // Resolve the current event's name for the top-bar breadcrumb (live).
  useEffect(() => {
    if (!user || !currentEventId) {
      setEventName('')
      setCanUseDesignStudio(false)
      setHasFestioMe(false)
      setCanManageCurrentEvent(false)
      setHasGuestDirectory(false)
      return
    }
    api.listEvents().then((evs) => {
      const current = evs.find((e) => e.id === currentEventId)
      setEventName(current?.name || '')
      setCanUseDesignStudio(!!current?.is_paid)
      setHasFestioMe(!!current?.festiome_addon_enabled)
      setCanManageCurrentEvent(!!current?.my_can_manage_event)
      setHasGuestDirectory(!!current?.my_can_view_guests)
    }).catch(() => {
      setEventName('')
      setCanUseDesignStudio(false)
      setHasFestioMe(false)
      setCanManageCurrentEvent(false)
      setHasGuestDirectory(false)
    })
  }, [user, currentEventId])

  return (
    <>
      <Nav hasMenu={hasMenu} eventName={eventName} canUseDesignStudio={canUseDesignStudio} hasFestioMe={hasFestioMe}
        canManageCurrentEvent={canManageCurrentEvent} hasGuestDirectory={hasGuestDirectory} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 pb-24 sm:pb-8">{children}</main>
      <MobileTabBar user={user} hasMenu={hasMenu} hasFestioMe={hasFestioMe}
        canManageCurrentEvent={canManageCurrentEvent} hasGuestDirectory={hasGuestDirectory} />
      <SupportWidget />
    </>
  )
}

// ── Routes ────────────────────────────────────────────────────────────────────

function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="min-h-[45vh] grid place-items-center px-4 text-sm text-slate-500 dark:text-slate-400">
      Loading page…
    </div>
  )
}

class RouteChunkBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="min-h-[45vh] grid place-items-center px-4">
        <div className="max-w-md rounded-xl border border-amber-200 bg-white p-5 text-center shadow-sm dark:border-amber-900 dark:bg-slate-800">
          <h1 className="font-bold text-slate-900 dark:text-white">This page could not be loaded</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">The application may have been updated while this tab was open.</p>
          <button className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    )
  }
}

function AppRoutes() {
  return (
    <RouteChunkBoundary>
      <Suspense fallback={<RouteLoading />}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/scan/:token" element={<ScanAutoPage />} />
      {/* Public self check-in — no auth required */}
      <Route path="/e/:code" element={<SelfCheckinPage />} />
      {/* Public invite page — no auth required */}
      <Route path="/invite/:eventId" element={<InvitePage />} />
      <Route path="/rsvp/:rsvpToken" element={<InvitePage />} />
      {/* Personalised (closed-mode) invite link — no auth required */}
      <Route path="/r/:token" element={<InvitePage />} />
      {/* Confirmed guests exchange their Festio pass for a scoped FestioMe session. */}
      <Route path="/festiome/guest" element={<FestioMePage />} />
      {/* Public vendor packing list — no auth required */}
      <Route path="/vendor/:token" element={<VendorPage />} />
      {/* Public gift registry — no auth required (unguessable token) */}
      <Route path="/registry/:token" element={<RegistryPage />} />
      {/* Public/private Event Calendar — no auth required; the backend
          resolves either a public share_token or a private per-contact token */}
      <Route path="/calendar/:token" element={<CalendarPage />} />
      {/* Client floor-plan share link — view or edit token, no auth required */}
      <Route path="/floor/:token" element={<FloorPlanPage />} />
      {/* Public marketing pages — no auth required */}
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/refund-policy" element={<RefundPolicyPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/sms-policy" element={<SmsPolicyPage />} />
      {/* Public API reference — readable before you have a key, no account needed */}
      <Route path="/api-docs" element={<ApiDocsPage />} />
      {/* Unlisted public help — shareable with prospects, no account needed */}

      {/* Landing page: public marketing page — logged-in users keep their session */}
      <Route path="/" element={<LandingPage />} />

      {/* Admin redesign routes must not mount until Firebase has restored the
          session; otherwise their initial API reads receive 401 and bounce a
          valid user back through /login to the legacy admin. */}
      <Route path="/admin-redesign" element={<ProtectedRoute><AdminRedesignPage /></ProtectedRoute>} />
      <Route path="/guests-redesign" element={<ProtectedRoute><GuestsRedesignPage /></ProtectedRoute>} />
      <Route path="/communications-redesign" element={<ProtectedRoute><CommunicationsRedesignPage /></ProtectedRoute>} />
      <Route path="/billing-redesign" element={<ProtectedRoute><BillingRedesignPage /></ProtectedRoute>} />
      <Route path="/addons-redesign" element={<ProtectedRoute><AddonsRedesignPage /></ProtectedRoute>} />
      <Route path="/team-redesign" element={<ProtectedRoute><TeamRedesignPage /></ProtectedRoute>} />
      <Route path="/experience-redesign" element={<ProtectedRoute><ExperienceRedesignPage /></ProtectedRoute>} />
      <Route path="/checkin-redesign" element={<ProtectedRoute><CheckinRedesignPage /></ProtectedRoute>} />
      <Route path="/superadmin-redesign" element={<ProtectedRoute><SuperadminRedesignPage /></ProtectedRoute>} />
      <Route path="/design-studio-redesign" element={<ProtectedRoute><DesignStudioRedesignPage /></ProtectedRoute>} />
      <Route path="/event-results-redesign" element={<ProtectedRoute><EventResultsRedesignPage /></ProtectedRoute>} />
      <Route path="/festiome-redesign" element={<ProtectedRoute><FestioMeRedesignPage /></ProtectedRoute>} />
      <Route path="/help-redesign" element={<ProtectedRoute><HelpRedesignPage /></ProtectedRoute>} />
      <Route path="/scanner-redesign" element={<ProtectedRoute><ScannerRedesignPage /></ProtectedRoute>} />
      <Route path="/kitchen-redesign" element={<ProtectedRoute><KitchenRedesignPage /></ProtectedRoute>} />
      <Route path="/selfcheckin-redesign" element={<SelfCheckinRedesignPage />} />
      <Route path="/selfcheckin-redesign/:code" element={<SelfCheckinRedesignPage />} />
      <Route path="/floorplan-redesign" element={<FloorPlanRedesignPage />} />
      <Route path="/setup-redesign" element={<ProtectedRoute><SetupRedesignPage /></ProtectedRoute>} />
      <Route path="/api-explorer-redesign" element={<ProtectedRoute><ApiExplorerRedesignPage /></ProtectedRoute>} />
      <Route path="/public-pages-redesign" element={<PublicPagesRedesignPage />} />

      {/* Authenticated app with Nav */}
      <Route
        path="*"
        element={
          <AuthedLayout>
            <Routes>
              {/* RedesignGate silently redirects redesign_default/legacy_retired orgs
                  to the redesign route. Superadmins are never redirected so they can
                  test both UIs. All original legacy routes remain untouched. */}
              <Route path="/admin" element={<ProtectedRoute><RedesignGate redesignRoute="/admin-redesign"><AdminPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/setup" element={<ProtectedRoute setupOnly><RedesignGate redesignRoute="/setup-redesign"><SetupWizardPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/setup/guided" element={<ProtectedRoute setupOnly><RedesignGate redesignRoute="/setup-redesign"><GuidedSetupPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/design-studio" element={<ProtectedRoute adminOnly paidOnly><RedesignGate redesignRoute="/design-studio-redesign"><DesignStudioPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/floor-plan/:eventId" element={<ProtectedRoute adminOnly><RedesignGate redesignRoute="/floorplan-redesign"><FloorPlanPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><RedesignGate redesignRoute="/event-results-redesign"><DashboardPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/results" element={<ProtectedRoute><RedesignGate redesignRoute="/event-results-redesign"><ResultsPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/my-tasks" element={<ProtectedRoute><RedesignGate redesignRoute="/team-redesign"><MyTasksPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/org-settings" element={<ProtectedRoute><RedesignGate redesignRoute="/billing-redesign"><OrgSettingsPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/api-explorer" element={<ProtectedRoute><RedesignGate redesignRoute="/api-explorer-redesign"><ApiExplorerPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/festiome" element={<ProtectedRoute><RedesignGate redesignRoute="/festiome-redesign"><FestioMePage /></RedesignGate></ProtectedRoute>} />
              <Route path="/scanner" element={<ProtectedRoute><RedesignGate redesignRoute="/scanner-redesign"><ScannerPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/kitchen" element={<ProtectedRoute><RedesignGate redesignRoute="/kitchen-redesign"><KitchenPage /></RedesignGate></ProtectedRoute>} />
              <Route path="/console" element={<ProtectedRoute><ConsolePage /></ProtectedRoute>} />
              <Route path="/media-library" element={<ProtectedRoute><MediaPage /></ProtectedRoute>} />
              <Route path="/help" element={<ProtectedRoute paidOnly><RedesignGate redesignRoute="/help-redesign"><HelpPage /></RedesignGate></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthedLayout>
        }
      />
      </Routes>
      </Suspense>
    </RouteChunkBoundary>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <div className="app-shell min-h-screen flex flex-col antialiased">
          <AppRoutes />
        </div>
      </AuthProvider>
    </ThemeProvider>
  )
}
