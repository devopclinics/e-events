import { useEffect, useState } from 'react'
import PublicTicketCheckout from '../components/PublicTicketCheckout'
import './PilgrimagePage.css'

// One-off campaign landing page for the Festio Hajj & Umrah 2027 package --
// not a generic template. Real ticket data (price/currency) comes from the
// live event; the real Paystack purchase flow is the same PublicTicketCheckout
// every organizer's ticket page uses, just re-themed to match here.
const EVENT_ID = '81603ff8-8d33-4422-b2cf-ed4d40e44f85'
const TONE = { panelStrong: '#1c1815', border: 'rgba(201,162,74,.35)', text: '#f6f0e2', muted: '#cabfa8', accent: '#e4c876' }
// Pinned to en-NG (not the visitor's own locale) so NGN renders as the
// naira symbol -- this page's audience is specifically Nigerian, and the
// approved design shows "₦9,000,000", not the ISO fallback "NGN 9,000,000".
const money = (n, c) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n || 0) / 100)

function scrollToTickets() {
  document.getElementById('tickets')?.scrollIntoView({ behavior: 'smooth' })
}

export default function HajjPage() {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Festio Hajj & Umrah 2027'
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
          <span className="hj-eyebrow">2027 · Sponsored Group Departure</span>
          <h1>Answer the call,<br /><em>fully guided</em>, start to finish.</h1>
          <p className="hj-lede">One all-inclusive package covering accommodation, feeding, transport, rites guidance, and preparation — for pilgrims across all 21 local government areas.</p>
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
              <h3>Travel &amp; Stay</h3>
              <ul>
                <li><span className="hj-dot"></span><span><b>Accommodation</b> in Madinah and Makkah</span></li>
                <li><span className="hj-dot"></span><span><b>Return transport</b> — flights and ground transfers</span></li>
                <li><span className="hj-dot"></span><span><b>Luggage allowance</b> — two 23kg bags, one 8kg bag, and a sling bag</span></li>
              </ul>
            </div>
            <div className="hj-group">
              <div className="hj-gnum">02</div>
              <h3>Rites &amp; Guidance</h3>
              <ul>
                <li><span className="hj-dot"></span><span>Complete <b>guidance through every Hajj rite</b></span></li>
                <li><span className="hj-dot"></span><span>Guided visits to <b>historical sites</b></span></li>
                <li><span className="hj-dot"></span><span><b>Sacrificial ram (Hady)</b> arranged and covered</span></li>
              </ul>
            </div>
            <div className="hj-group">
              <div className="hj-gnum">03</div>
              <h3>Provisions &amp; Comfort</h3>
              <ul>
                <li><span className="hj-dot"></span><span><b>Full feeding</b> throughout the journey</span></li>
                <li><span className="hj-dot"></span><span><b>Ihram cloth</b> cost refunded</span></li>
                <li><span className="hj-dot"></span><span><b>Free medical screening</b> before departure</span></li>
                <li><span className="hj-dot"></span><span><b>$500 BTA</b> (Basic Travel Allowance)</span></li>
                <li><span className="hj-dot"></span><span><b>12 yards of uniform Ankara</b> — two designs, 6 yards each</span></li>
              </ul>
            </div>
            <div className="hj-group">
              <div className="hj-gnum">04</div>
              <h3>Community &amp; Preparation</h3>
              <ul>
                <li><span className="hj-dot"></span><span><b>Pre-departure lectures</b> — four weekends, across all 21 local government areas</span></li>
                <li><span className="hj-dot"></span><span>A <b>Grand Seminar &amp; send-forth celebration</b>, one day before departure</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="hj-block" style={{ paddingTop: 0 }}>
        <div className="hj-wrap">
          <div className="hj-block-head">
            <div className="hj-k">Your Travel Window</div>
            <h2>Tell us when you'd like to go.</h2>
          </div>
          <div className="hj-dates-card">
            <p className="hj-note">Hajj travel is coordinated around flight and visa allocations each season, so exact dates can't be promised — but tell us your preferred window when you reserve below and our team will do everything possible to secure it.</p>
            <div className="hj-best-effort">Best-effort confirmation during the Hajj season</div>
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
        <PublicTicketCheckout eventId={EVENT_ID} tone={TONE} requirePhone />
      </section>

      <footer className="hj-footer">Powered by <a href="/">Festio</a> · Secure checkout · Documentation prepared by our team</footer>
    </main>
  )
}
