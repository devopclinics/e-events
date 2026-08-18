import { useEffect, useState } from 'react'
import PublicTicketCheckout from '../components/PublicTicketCheckout'
import './PilgrimagePage.css'

// One-off campaign landing page for the Festio Umrah 2027 (Ramadan) package --
// same pattern and shared CSS as HajjPage.jsx, different content/data.
const EVENT_ID = '3b24c063-d0c3-4704-8eb2-59d4e7abfae5'
const TONE = { panelStrong: '#1c1815', border: 'rgba(201,162,74,.35)', text: '#f6f0e2', muted: '#cabfa8', accent: '#e4c876' }
// Pinned to en-NG (not the visitor's own locale) so NGN renders as the naira symbol.
const money = (n, c) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n || 0) / 100)

function scrollToTickets() {
  document.getElementById('tickets')?.scrollIntoView({ behavior: 'smooth' })
}

export default function UmrahPage() {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Festio Umrah 2027'
    fetch('/api/ticketing/public/events', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setEvent((d.events || []).find(e => e.id === EVENT_ID) || null))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="hj-loading">Loading…</div>
  if (!event) return <div className="hj-loading">This package isn't available right now.</div>

  const price = money(event.from_price, event.currency)

  return (
    <main className="hj-page">
      <div className="hj-wrap">
        <div className="hj-topbar">
          <div className="hj-brand"><span className="hj-mark">F</span> Festio Hajj &amp; Umrah</div>
          <a className="hj-findevents" href="/tickets">Find events</a>
        </div>
      </div>

      <section className="hj-hero">
        <div className="hj-star-field" aria-hidden="true"></div>
        <div className="hj-wrap" style={{ position: 'relative' }}>
          <span className="hj-eyebrow">2027 / 1448 A.H. · Ramadan Umrah</span>
          <h1>The Lesser Hajj,<br /><em>fully guided</em>, start to finish.</h1>
          <p className="hj-lede">One all-inclusive Ramadan Umrah package — accommodation close to the Haram, daily feeding, guided ziyarah, and spiritual guidance throughout.</p>
          <div className="hj-price-badge"><span className="hj-amt">{price}</span><span className="hj-sub">all-inclusive<br />per pilgrim</span></div>
          <div className="hj-cta-row">
            <button className="hj-btn hj-btn-primary" onClick={scrollToTickets}>Reserve Your Place</button>
            <a className="hj-btn hj-btn-secondary" href="#included">See What's Included</a>
          </div>
          <div className="hj-paystack-note">Secure checkout via <b>Paystack</b> · Limited places each season</div>
        </div>
      </section>

      <div className="hj-marquee"><div className="hj-marquee-track">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i}>PRIORITY FROM START TO FINISH ·</span>
        ))}
      </div></div>

      <section className="hj-block" id="included">
        <div className="hj-wrap">
          <div className="hj-block-head">
            <div className="hj-k">The Package</div>
            <h2>Everything arranged, nothing left to chance.</h2>
          </div>
          <div className="hj-groups">
            <div className="hj-group">
              <div className="hj-gnum">01</div>
              <h3>Stay &amp; Travel</h3>
              <ul>
                <li><span className="hj-dot"></span><span><b>Accommodation</b> closer to the Haram</span></li>
                <li><span className="hj-dot"></span><span><b>Comfortable local transportation</b> throughout</span></li>
                <li><span className="hj-dot"></span><span><b>Daily feeding</b> — breakfast and dinner in local delicacies</span></li>
              </ul>
            </div>
            <div className="hj-group">
              <div className="hj-gnum">02</div>
              <h3>Guidance &amp; Care</h3>
              <ul>
                <li><span className="hj-dot"></span><span><b>Ziyarah</b> — guided visits to historical sites in Makkah and Madinah</span></li>
                <li><span className="hj-dot"></span><span><b>Spiritual counseling &amp; guidance</b> throughout the journey</span></li>
                <li><span className="hj-dot"></span><span><b>Medical and health benefits</b> for every pilgrim</span></li>
              </ul>
            </div>
          </div>
          <p style={{ maxWidth: 560, margin: '40px auto 0', textAlign: 'center', fontStyle: 'italic', color: 'var(--cream-dim)', fontFamily: 'var(--serif)', fontSize: 16, lineHeight: 1.7 }}>
            "Indeed, as-Safa and al-Marwa are among the symbols of Allah. So, whoever makes Hajj to the House or performs Umrah — there is no blame upon him for walking between them. And whoever volunteers good — then indeed Allah is appreciative and knowing."
            <br /><span style={{ fontStyle: 'normal', color: 'var(--gold-dim)', fontSize: 13 }}>Qur'an 2:158</span>
          </p>
        </div>
      </section>

      <section className="hj-block" style={{ paddingTop: 0 }}>
        <div className="hj-wrap">
          <div className="hj-block-head">
            <div className="hj-k">Your Travel Window</div>
            <h2>Tell us when you'd like to go.</h2>
          </div>
          <div className="hj-dates-card">
            <p className="hj-note">Ramadan Umrah travel is coordinated around flight and visa allocations each season, so exact dates can't be promised — but tell us your preferred window when you reserve below and our team will do everything possible to secure it.</p>
            <div className="hj-best-effort">Best-effort confirmation during the Ramadan season</div>
            <div className="hj-arrow-down" onClick={scrollToTickets}>↓ Enter your dates below</div>
          </div>
        </div>
      </section>

      <section className="hj-priority-banner">
        <div className="hj-wrap">
          <h3>Choose Festio, and you're <span className="hj-em">first</span> — from reservation to return.</h3>
          <p>Priority handling on documentation, accommodation, and every step of the journey — pilgrims who travel with us are looked after first, not last.</p>
        </div>
      </section>

      <section className="hj-block">
        <div className="hj-wrap">
          <div className="hj-pricing-card">
            <div className="hj-rel">
              <div className="hj-k">2027 Package</div>
              <div className="hj-amt">{price}</div>
              <div className="hj-per">One flat price. Nothing added later.</div>
              <div className="hj-incl">All inclusions above, bundled — see <b>What's Included</b></div>
              <button className="hj-btn hj-btn-primary" onClick={scrollToTickets}>Reserve Your Place — Pay via Paystack</button>
            </div>
          </div>
        </div>
      </section>

      <section className="hj-checkout-shell">
        <div className="hj-wrap">
          <div className="hj-block-head">
            <div className="hj-k">Reserve Your Place</div>
            <h2>Secure checkout.</h2>
          </div>
        </div>
        <PublicTicketCheckout eventId={EVENT_ID} tone={TONE} />
      </section>

      <footer className="hj-footer">Powered by <a href="/">Festio</a> · Secure checkout · Unique QR admission</footer>
    </main>
  )
}
