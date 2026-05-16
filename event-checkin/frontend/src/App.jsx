import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminPage from './pages/AdminPage'
import ScannerPage from './pages/ScannerPage'
import DashboardPage from './pages/DashboardPage'
import ScanAutoPage from './pages/ScanAutoPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AuthCallbackPage from './pages/AuthCallbackPage'

function Nav() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const link = ({ isActive }) =>
    `px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
      isActive ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-700'
    }`

  return (
    <nav className="bg-indigo-600 shadow-lg">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-2 h-14">
        <span className="text-white font-bold text-lg mr-4">EventQR</span>

        {user?.role === 'admin' && (
          <>
            <NavLink to="/" end className={link}>Admin</NavLink>
            <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
          </>
        )}
        {user && (
          <NavLink to="/scanner" className={link}>Scanner</NavLink>
        )}

        <div className="ml-auto flex items-center gap-3">
          {user && (
            <>
              <div className="text-right hidden sm:block">
                <div className="text-white text-sm font-medium leading-none">{user.name}</div>
                <div className="text-indigo-200 text-xs mt-0.5 capitalize">{user.role}</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-semibold text-sm">
                {user.name[0].toUpperCase()}
              </div>
              <button
                onClick={() => { logout(); navigate('/login') }}
                className="text-indigo-200 hover:text-white text-xs font-medium px-2 py-1 rounded hover:bg-indigo-700 transition-colors"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/scan/:token" element={<ScanAutoPage />} />

      {/* Protected */}
      <Route
        path="*"
        element={
          <>
            <Nav />
            <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
              <Routes>
                <Route path="/" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
                <Route path="/dashboard" element={<ProtectedRoute adminOnly><DashboardPage /></ProtectedRoute>} />
                <Route path="/scanner" element={<ProtectedRoute><ScannerPage /></ProtectedRoute>} />
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
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <AppRoutes />
      </div>
    </AuthProvider>
  )
}
