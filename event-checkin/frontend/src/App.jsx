import { Routes, Route, NavLink } from 'react-router-dom'
import AdminPage from './pages/AdminPage'
import ScannerPage from './pages/ScannerPage'
import DashboardPage from './pages/DashboardPage'
import ScanAutoPage from './pages/ScanAutoPage'

function Nav() {
  const link = ({ isActive }) =>
    `px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
      isActive ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-700'
    }`
  return (
    <nav className="bg-indigo-600 shadow-lg">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-2 h-14">
        <span className="text-white font-bold text-lg mr-6">EventQR</span>
        <NavLink to="/" end className={link}>Admin</NavLink>
        <NavLink to="/scanner" className={link}>Scanner</NavLink>
        <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Routes>
        <Route path="/scan/:token" element={<ScanAutoPage />} />
        <Route
          path="*"
          element={
            <>
              <Nav />
              <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
                <Routes>
                  <Route path="/" element={<AdminPage />} />
                  <Route path="/scanner" element={<ScannerPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                </Routes>
              </main>
            </>
          }
        />
      </Routes>
    </div>
  )
}
