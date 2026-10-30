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
import ConsolePage from '../../src/pages/ConsolePage'
import MediaLibrary from '../../src/components/media-library/MediaLibrary'
import { SharedMediaPicker } from '../../src/components/media-library/SharedMedia'
import MeetingSharePanel from '../../src/components/MeetingSharePanel'
import MeetingInvitationDocument from '../../src/components/MeetingInvitationDocument'
import '../../src/pages/MeetingsPage.css'
import '../../src/index.css'

function MeetingShareFixture() {
  const [status, setStatus] = React.useState('draft')
  const meeting = { id: 'sample-meeting', status, draft: { video_url: 'https://meet.example.test/team' }, attendees: [{ id: 'ada', name: 'Ada', email: 'ada@example.test', active: true }, { id: 'sam', name: 'Sam', email: 'sam@example.test', active: true }] }
  return <main className="mt-workspace" style={{ paddingTop: 70 }}>
    {['draft', 'scheduled', 'cancelled'].map(value => <button key={value} onClick={() => setStatus(value)}>{value}</button>)}
    <MeetingSharePanel key={status} meeting={meeting} client={{ meetingSharedLink: async () => ({url:'https://example.test/meeting-invitation/shared'}), meetingAttendeeLink: async (id, attendee) => {
      (window.fixtureMeetingLinks ||= []).push({ id, attendee })
      return { url: `https://example.test/meeting-response/${attendee}-private` }
    } }} />
  </main>
}
function InvitationDocumentFixture() {
  return <main style={{maxWidth:650,margin:'50px auto'}}><MeetingInvitationDocument html={'<!doctype html><html><body style="margin:0"><div style="padding:30px;background:#183e3a;color:white"><h1>Project catch-up</h1><p>Hello Ada,</p><a href="https://meet.example.test/team" target="_blank" rel="noopener noreferrer">JOIN ONLINE</a><p style="height:600px">Your invitation</p><a href="#meeting-reply">View invitation &amp; respond</a></div><script>parent.fixtureUnsafeScriptRan=true</script></body></html>'} /><section id="meeting-reply" tabIndex={-1}><h2>Will you attend, Ada?</h2><button>Accept</button></section></main>
}
function SharedPickerFixture(){const [selected,setSelected]=React.useState('');return <main style={{padding:80}}><SharedMediaPicker eventId="event-two" onSelect={asset=>setSelected(asset.url)}/><p role="status">{selected}</p></main>}
function Fixture() {
  return <BrowserRouter><ThemeProvider><AuthProvider>
    <nav aria-label="Fixture navigation" style={{ position: 'fixed', top: 0, left: 0, zIndex: 100, padding: 4, background: 'white' }}>
      {[['/', 'Home'], ['/pricing', 'Pricing'], ['/admin-redesign', 'Admin'], ['/register', 'Signup'], ['/marketing', 'Marketing'], ['/scan/private-token', 'Guest'], ['/landing-legacy', 'Legacy'], ['/tickets', 'Discover'], ['/platform-operations', 'Operations'], ['/media-studio', 'Media']].map(([to, text]) => <Link key={to} to={to} style={{ margin: 6 }}>{text}</Link>)}
    </nav>
    <Routes>
      <Route path="/" element={<LandingRedesignPage />} />
      <Route path="/invitation-document" element={<InvitationDocumentFixture />} />
      <Route path="/meeting-share" element={<MeetingShareFixture />} />
      <Route path="/shared-media-picker" element={<SharedPickerFixture />} />
      <Route path="/media-studio" element={<MediaLibrary />} />
      <Route path="/platform-operations" element={<ConsolePage operations />} />
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
