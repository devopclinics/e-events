import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AuthProvider } from 'fixture-auth'
import { ThemeProvider } from '../../src/context/ThemeContext'
import SupportWidget from '../../src/components/SupportWidget'
import RegisterPage from '../../src/pages/RegisterPage'
import LandingPage from '../../src/pages/LandingPage'
import LandingRedesignPage from '../../src/pages/LandingRedesignPage'
import '../../src/index.css'

function Fixture() {
  return <BrowserRouter><ThemeProvider><AuthProvider>
    <nav aria-label="Fixture navigation" style={{ position: 'fixed', top: 0, left: 0, zIndex: 100, padding: 4, background: 'white' }}>
      {[['/', 'Home'], ['/pricing', 'Pricing'], ['/admin-redesign', 'Admin'], ['/register', 'Signup'], ['/scan/private-token', 'Guest'], ['/landing-legacy', 'Legacy']].map(([to, text]) => <Link key={to} to={to} style={{ margin: 6 }}>{text}</Link>)}
    </nav>
    <Routes>
      <Route path="/" element={<LandingRedesignPage />} />
      <Route path="/landing-legacy" element={<LandingPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<div style={{ padding: 70 }}>Fixture page</div>} />
    </Routes>
    <SupportWidget />
  </AuthProvider></ThemeProvider></BrowserRouter>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
