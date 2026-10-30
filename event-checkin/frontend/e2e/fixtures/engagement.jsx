import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AuthProvider } from 'fixture-auth'
import { ThemeProvider } from '../../src/context/ThemeContext'
import SupportWidget from '../../src/components/SupportWidget'
import MarketingPage from '../../src/pages/MarketingPage'
import RegisterPage from '../../src/pages/RegisterPage'
import LandingPage from '../../src/pages/LandingPage'
import LandingRedesignPage from '../../src/pages/LandingRedesignPage'
import PublicTicketsPage from '../../src/pages/PublicTicketsPage'
import MeetingSharePanel from '../../src/components/MeetingSharePanel'
import '../../src/pages/MeetingsPage.css'
import '../../src/index.css'

function MeetingShareFixture() {
  const [status, setStatus] = React.useState('draft')
  const meeting = { id: 'sample-meeting', status, draft: { video_url: 'https://meet.example.test/team' }, attendees: [{ id: 'ada', name: 'Ada', email: 'ada@example.test', active: true }, { id: 'sam', name: 'Sam', email: 'sam@example.test', active: true }] }
  return <main className="mt-workspace" style={{ paddingTop: 70 }}>
    {['draft', 'scheduled', 'cancelled'].map(value => <button key={value} onClick={() => setStatus(value)}>{value}</button>)}
    <MeetingSharePanel key={status} meeting={meeting} client={{ meetingAttendeeLink: async (id, attendee) => {
      (window.fixtureMeetingLinks ||= []).push({ id, attendee })
      return { url: `https://example.test/meeting-response/${attendee}-private` }
    } }} />
  </main>
}
function Fixture() {
  return <BrowserRouter><ThemeProvider><AuthProvider>
    <nav aria-label="Fixture navigation" style={{ position: 'fixed', top: 0, left: 0, zIndex: 100, padding: 4, background: 'white' }}>
      {[['/', 'Home'], ['/pricing', 'Pricing'], ['/admin-redesign', 'Admin'], ['/register', 'Signup'], ['/marketing', 'Marketing'], ['/scan/private-token', 'Guest'], ['/landing-legacy', 'Legacy'], ['/tickets', 'Discover']].map(([to, text]) => <Link key={to} to={to} style={{ margin: 6 }}>{text}</Link>)}
    </nav>
    <Routes>
      <Route path="/" element={<LandingRedesignPage />} />
      <Route path="/meeting-share" element={<MeetingShareFixture />} />
      <Route path="/tickets" element={<PublicTicketsPage />} />
      <Route path="/landing-legacy" element={<LandingPage />} />
      <Route path="/marketing" element={<MarketingPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<div style={{ padding: 70 }}>Fixture page</div>} />
    </Routes>
    <SupportWidget />
  </AuthProvider></ThemeProvider></BrowserRouter>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
