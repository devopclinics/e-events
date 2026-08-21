import { useEffect, useState } from 'react'
import PublicTicketCheckout from '../components/PublicTicketCheckout'
import './IEDPURegistrationPage.css'

// One-off registration page for the IEDPU USA 3rd Biannual Convention --
// free to attend (a $0 ticket product, so checkout completes instantly with
// no payment step -- see ticketing-service's create_order). Deliberately
// shows no price and never says "free"; framed as a reservation, not a
// transaction. Matches the approved design-review mockup.
const EVENT_ID = '8882c06c-9cd4-425d-902c-ac5833121454'
const TONE = { panelStrong: '#0c4433', border: 'rgba(201,162,39,.35)', text: '#f7f2e2', muted: '#c9d6cd', accent: '#e8c85a' }

function scrollToRegister() {
  document.getElementById('tickets')?.scrollIntoView({ behavior: 'smooth' })
}

export default function IEDPURegistrationPage() {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'IEDPU USA Convention Registration'
    fetch('/api/ticketing/public/events', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setEvent((d.events || []).find(e => e.id === EVENT_ID) || null))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="iedpu-loading">Loading…</div>
  if (!event) return <div className="iedpu-loading">Registration isn't available right now.</div>

  return (
    <main className="iedpu-page">
      <div className="iedpu-wrap">
        <div className="iedpu-topbar">
          <div className="iedpu-brand"><img src="/iedpu-brand/logo.png" alt="IEDPU" /> IEDPU USA</div>
          <a className="iedpu-findevents" href="/tickets">Find events</a>
        </div>
      </div>

      <section className="iedpu-hero">
        <div className="iedpu-wrap">
          <div className="iedpu-logo-badge"><img src="/iedpu-brand/logo.png" alt="IEDPU" /></div>
          <div className="iedpu-eyebrow">IEDPU USA &middot; 3rd Biannual Convention</div>
          <h1>Reserve Your Convention Registration</h1>
          <div className="meta">November 26&ndash;28, 2026 &middot; Wyndham Hotel, Irving, TX</div>
        </div>
      </section>

      <section className="iedpu-block">
        <div className="iedpu-wrap">
          <div className="iedpu-block-head">
            <div className="k">Registration</div>
            <h2>One pass, the whole convention.</h2>
          </div>
          <div className="iedpu-pass-card">
            <div className="rel">
              <div className="name">Convention Registration</div>
              <div className="sub">Secure your place — one registration per attendee.</div>
              <ul>
                <li><b>Access</b> to all convention sessions &amp; programs</li>
                <li><b>Convention badge</b> &amp; welcome materials</li>
                <li><b>Priority check-in</b> at the entrance</li>
              </ul>
              <button className="iedpu-btn" onClick={scrollToRegister}>Reserve Your Registration</button>
            </div>
          </div>
        </div>
      </section>

      <section className="iedpu-checkout-shell">
        <div className="iedpu-wrap">
          <div className="iedpu-block-head">
            <div className="k">Reserve Your Place</div>
            <h2>Complete your registration.</h2>
          </div>
        </div>
        <PublicTicketCheckout eventId={EVENT_ID} tone={TONE} requirePhone />
      </section>

      <footer className="iedpu-footer">Powered by <a href="/">Festio</a> · Your pass is sent immediately after registering</footer>
    </main>
  )
}
