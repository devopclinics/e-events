import { useState } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminPage from './pages/AdminPage'
import ScannerPage from './pages/ScannerPage'
import DashboardPage from './pages/DashboardPage'
import ScanAutoPage from './pages/ScanAutoPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import LandingPage from './pages/LandingPage'
import InvitePage from './pages/InvitePage'

// ── Preferred-view helpers ────────────────────────────────────────────────────

export function getPreferredView(role) {
  const stored = localStorage.getItem('preferredView')
  if (stored === 'admin' && role === 'admin') return '/admin'
  if (stored === 'dashboard') return '/dashboard'
  if (stored === 'scanner') return '/scanner'
  return role === 'admin' ? '/admin' : '/scanner'
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

function Nav() {
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
    ...(user?.role === 'admin' ? [{ to: '/admin', label: 'Admin', end: true }] : []),
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/scanner', label: 'Scanner' },
  ]

  return (
    <nav className="app-nav sticky top-0 z-50 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-3">
        <span className="flex items-center gap-2 text-slate-950 dark:text-white font-bold text-lg mr-2 tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-teal-600 text-white text-sm">EQ</span>
          EventQR
        </span>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-1">
          {links.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={linkCls}>{label}</NavLink>
          ))}
        </div>

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

// ── Routes ────────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/scan/:token" element={<ScanAutoPage />} />
      {/* Public invite page — no auth required */}
      <Route path="/e/:eventId" element={<InvitePage />} />
      {/* Personalised (closed-mode) invite link — no auth required */}
      <Route path="/r/:token" element={<InvitePage />} />

      {/* Landing page: show to guests, redirect logged-in users */}
      <Route path="/"
        element={user ? <Navigate to={getPreferredView(user.role)} replace /> : <LandingPage />}
      />

      {/* Authenticated app with Nav */}
      <Route
        path="*"
        element={
          <>
            <Nav />
            <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8">
              <Routes>
                <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
                <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
                <Route path="/scanner" element={<ProtectedRoute><ScannerPage /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </>
        }
      />
    </Routes>
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
