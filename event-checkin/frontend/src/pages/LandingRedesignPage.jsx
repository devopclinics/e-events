import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import './LandingRedesignPage.css'

const CONTACT_EMAIL = 'events@festio.events'

// This page showcases the redesign specifically, so its own CTAs bypass the
// org redesign_cohort gate that /admin, /setup, etc. normally go through
// (RedesignGate) and go straight to the redesign pages, unlike getPreferredView
// (App.jsx) which every other legacy entry point still relies on.
function redesignHome(role) {
  return role === 'admin' || role === 'event_manager' ? '/admin-redesign' : '/scanner-redesign'
}

function defaultDemoTime() {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  d.setHours(10, 0, 0, 0)
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SunIcon() {
  return (
    <svg width="17" height="17" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="17" height="17" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

const PASS_QR_ON = [
  true, true, false, true, false, false, true, true, true, true, false, false, true, false, true, true,
  false, false, true, false, false, true, false, false, true, false, false, true, true, false, true, false,
  false, true, false, true, true, false, false, true, false, false, true, false, false, true, false, false,
  true, false, false, true, true, false, true, false, false, true, true, true, true, false, false, true,
  false, true, true,
]

const JOURNEY_STEPS = [
  {
    step: '01', icon: '◈', title: 'Create & invite', to: '/guests-redesign',
    body: 'Launch a branded event page, import your guest list, and send personalized invitations by email, SMS, or WhatsApp.',
    checks: ['Beautiful event pages', 'Smart guest import'],
  },
  {
    step: '02', icon: '◎', title: 'Collect accurate RSVPs', to: '/guests-redesign?tab=invite',
    body: 'Register individuals, couples, families, and additional guests with exactly the details your event needs.',
    checks: ['Custom, conditional questions', 'Approval rules'],
  },
  {
    step: '03', icon: '▦', title: 'Prepare every guest', featured: true, to: '/floorplan-redesign',
    body: 'Assign tables, confirm meals, share updates, and issue an individual Festio Pass to each attendee.',
    checks: ['Seating and table groups', 'Email, SMS & WhatsApp'],
  },
  {
    step: '04', icon: '⍁', title: 'Run the event live', to: '/checkin-redesign',
    body: 'Scan passes, welcome walk-ins, control zone access, and watch attendance update in real time.',
    checks: ['Fast QR check-in', 'Live occupancy and flow'],
  },
]

const PEOPLE_STACK = [
  { initials: 'AS', name: 'Amara Solaru', role: 'Primary registrant', status: 'ok' },
  { initials: 'TS', name: 'Tunde Solaru', role: 'Spouse', status: 'ok' },
  { initials: 'ZS', name: 'Zainab Solaru', role: 'Child', status: 'ok' },
  { initials: 'KB', name: 'Kemi Bello', role: 'Invited guest', status: 'pending' },
]

const COMMUNITY_CARDS = [
  { initials: 'SC', title: 'Staff broadcast', sub: 'To all attendees', body: 'Shuttle to the gala leaves the lobby at 6:45pm sharp. See you there.' },
  { initials: 'FW', title: 'Volunteers channel', sub: 'Private group', body: 'Registration desk needs two more hands for the 9am rush tomorrow.' },
  { initials: 'RG', title: 'Gift registry', sub: 'Add-on', body: '3 items marked as taken. Guests can still add cash gifts from their hub.' },
  { initials: 'LG', title: 'Logistics', sub: 'Add-on', body: 'Gift shipment packed for 214 guests. Vendor pickup list is ready.' },
]

const PRICING_TIERS = [
  { tier: 'Free', title: 'Explore Festio', body: 'For testing the guest experience and planning small gatherings.', cta: 'Create free event', to: '/register?redesign=1' },
  { tier: 'Essential', title: 'Run your event', body: 'Invitations, passes, messaging, and check-in for complete guest management.', cta: 'See pricing', to: '/pricing', featured: true },
  { tier: 'Professional', title: 'Scale operations', body: 'Venue access intelligence, seating workflows, and reporting for complex events.', cta: 'Talk to us', to: '#contact' },
]

function DemoContactForm() {
  const [form, setForm] = useState({
    contact_name: '', email: '', phone: '', organization: '',
    event_name: '', guest_count: '', preferred_time: defaultDemoTime(), message: '',
  })
  const [status, setStatus] = useState('idle') // idle | loading | success
  const [error, setError] = useState('')

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setStatus('loading')
    setError('')
    try {
      await api.submitDemoRequest({
        ...form,
        guest_count: form.guest_count ? Number(form.guest_count) : null,
        preferred_time: new Date(form.preferred_time).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        phone: form.phone || null,
        organization: form.organization || null,
        event_name: form.event_name || null,
        message: form.message || null,
      })
      setStatus('success')
    } catch (err) {
      setError(err.message || 'Could not send your request.')
      setStatus('idle')
    }
  }

  if (status === 'success') {
    return (
      <div className="lr-contact-form lr-contact-success">
        <div className="lr-p-status ok" style={{ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 18 }}>&#10003;</div>
        <h3>Request received</h3>
        <p>Check your inbox for confirmation. We&apos;ll follow up shortly with a meeting link.</p>
      </div>
    )
  }

  return (
    <form className="lr-contact-form" onSubmit={submit}>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Name</span>
          <input required value={form.contact_name} onChange={(e) => setField('contact_name', e.target.value)} placeholder="Your name" />
        </label>
        <label className="lr-field">
          <span>Email</span>
          <input required type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="you@example.com" />
        </label>
      </div>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Phone</span>
          <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+1 555 000 0000" />
        </label>
        <label className="lr-field">
          <span>Organization</span>
          <input value={form.organization} onChange={(e) => setField('organization', e.target.value)} placeholder="Company, venue, or host" />
        </label>
      </div>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Event</span>
          <input value={form.event_name} onChange={(e) => setField('event_name', e.target.value)} placeholder="Event name or type" />
        </label>
        <label className="lr-field">
          <span>Guests</span>
          <input min="1" type="number" value={form.guest_count} onChange={(e) => setField('guest_count', e.target.value)} placeholder="150" />
        </label>
      </div>
      <label className="lr-field">
        <span>Preferred time</span>
        <input required type="datetime-local" value={form.preferred_time} onChange={(e) => setField('preferred_time', e.target.value)} />
      </label>
      <label className="lr-field">
        <span>What should we cover?</span>
        <textarea value={form.message} onChange={(e) => setField('message', e.target.value)} placeholder="RSVP, QR passes, check-in, seating, venue access..." />
      </label>
      {error && <p className="lr-contact-error">{error}</p>}
      <button className="lr-btn primary lg" disabled={status === 'loading'} type="submit">
        {status === 'loading' ? 'Sending...' : 'Send request'}
      </button>
    </form>
  )
}

export default function LandingRedesignPage() {
  const { dark, toggle } = useTheme()
  const { user } = useAuth()
  const appHome = user ? redesignHome(user.role) : null
  const [publicEvents, setPublicEvents] = useState([])
  useEffect(() => {
    fetch('/api/ticketing/public/events', {cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject())
      .then(data=>setPublicEvents((data.events||[]).slice(0,6))).catch(()=>setPublicEvents([]))
  }, [])

  return (
    <div className="landing-redesign">
      <nav className="lr-nav">
        <div className="lr-shell lr-nav-inner">
          <a className="lr-brand" href="#top"><span className="lr-brand-mark">F</span>Festio</a>
          <div className="lr-nav-links">
            <a href="#journey">Product</a>
            <a href="#configurable">Design Studio</a>
            <a href="#ops">Live Ops</a>
            <a href="#community">Community</a>
            <Link to="/tickets">Find events</Link>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="lr-nav-actions">
            <button type="button" className="lr-theme-btn" onClick={toggle} aria-label="Toggle theme">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            {user ? (
              <Link className="lr-btn primary" to={appHome}>Open app</Link>
            ) : (
              <>
                <Link className="lr-signin" to="/login">Sign in</Link>
                <Link className="lr-btn primary" to="/register?redesign=1">Create free event</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <header className="lr-hero" id="top">
        <div className="lr-shell lr-hero-grid">
          <div>
            <span className="lr-eyebrow"><i /> One platform, one guest record</span>
            <h1>Every guest gets <em>their own event.</em></h1>
            <p className="lr-lead">Send one link. Festio turns it into a personal invitation, an individual QR pass, and a private guest hub for every person on your list, from the primary registrant to the last plus-one.</p>
            <div className="lr-hero-ctas">
              <Link className="lr-btn primary lg" to="/register?redesign=1">Create your event free</Link>
              <a className="lr-btn ghost lg" href="#journey">See how it works</a>
            </div>
            <div className="lr-trust-row">
              <span>No credit card</span>
              <span>Live in minutes</span>
              <span>Built for real crowds</span>
            </div>
          </div>

          <div className="lr-stage">
            <div className="lr-panel">
              <div className="lr-panel-bar">
                <span className="lr-panel-dot" /><span className="lr-panel-dot" /><span className="lr-panel-dot" />
                <span className="lr-panel-url">festio.events/admin</span>
              </div>
              <div className="lr-panel-body">
                <div className="lr-panel-head">
                  <div><small>Founders Weekend</small><strong>Convention &middot; Day 2</strong></div>
                  <span className="lr-pill live"><i /> Live</span>
                </div>
                <div className="lr-kpis">
                  <div className="lr-kpi"><span>Registered</span><strong>842</strong></div>
                  <div className="lr-kpi"><span>Checked in</span><strong>618</strong></div>
                  <div className="lr-kpi"><span>Occupancy</span><strong>73%</strong></div>
                </div>
                <div className="lr-zone-row"><span className="lr-z-name"><i /> Main Hall</span><span className="lr-z-count">312 in</span></div>
                <div className="lr-zone-row"><span className="lr-z-name"><i /> Exhibit Floor</span><span className="lr-z-count">204 in</span></div>
                <div className="lr-bars">
                  {[38, 52, 44, 66, 60, 78, 70, 90, 84, 100].map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="lr-pass-float">
              <div className="lr-pf-top"><span className="lr-pf-brand">Festio Pass</span><span style={{ fontSize: 9, color: 'var(--faint)' }}>&bull;&bull;&bull;&bull;</span></div>
              <div className="lr-pf-name">Amara Solaru</div>
              <div className="lr-pf-sub">Invited Guest &middot; Table 14</div>
              <div className="lr-pf-qr">
                {PASS_QR_ON.map((on, i) => <i key={i} className={on ? '' : 'off'} />)}
              </div>
              <div className="lr-pf-meta"><span>PASS<b>FST-2841</b></span><span style={{ textAlign: 'right' }}>SEAT<b>14C</b></span></div>
            </div>
          </div>
        </div>
      </header>

      <div className="lr-strip">
        <div className="lr-shell lr-strip-grid">
          <div><strong>50K+</strong><span>guest experiences run</span></div>
          <div><strong>99.9%</strong><span>pass scan reliability</span></div>
          <div><strong>&lt;3s</strong><span>average check-in time</span></div>
          <div><strong>25</strong><span>guest hub styles to choose from</span></div>
        </div>
      </div>

      <section className="lr-events">
        <div className="lr-shell"><div className="lr-events-head"><div><span className="lr-eyebrow"><i /> Festio Tickets</span><h2>Find your next event.</h2><p>Official event pages, secure tickets and unique QR admission.</p></div><Link className="lr-btn ghost" to="/tickets">Find events →</Link></div>{publicEvents.length>0&&<div className="lr-events-grid">{publicEvents.map(event=><Link className="lr-event-card" to={`/tickets/e/${event.id}`} key={event.id}><div style={event.cover_image?{backgroundImage:`linear-gradient(180deg,transparent,rgba(9,29,27,.75)),url("${event.cover_image}")`}:{}}><span>{event.timing==='current'?'Happening now':'Upcoming'}</span></div><section><small>{new Date(event.event_date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</small><h3>{event.name}</h3><p>{event.venue_name||event.venue_address||'Details from the organizer'}</p></section></Link>)}</div>}</div>
      </section>

      <section className="lr-section" id="journey">
        <div className="lr-shell">
          <div className="lr-journey-head">
            <div>
              <span className="lr-eyebrow"><i /> The connected guest journey</span>
              <h2>From &ldquo;you&apos;re invited&rdquo;<br />to &ldquo;welcome in.&rdquo;</h2>
            </div>
            <p>Festio replaces scattered forms, spreadsheets, group chats, and scanning apps with one guest record that stays useful from the first invitation to the final report.</p>
          </div>

          <div className="lr-journey-grid">
            {JOURNEY_STEPS.map((s) => (
              <article className={`lr-jcard${s.featured ? ' featured' : ''}`} key={s.step}>
                <span className="lr-jc-step">{s.step}</span>
                <div className="lr-jc-icon">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <ul className="lr-jc-checklist">
                  {s.checks.map((c) => <li key={c}>{c}</li>)}
                </ul>
                <Link className="lr-jc-more" to={s.to}>Explore feature <span>&#8599;</span></Link>
              </article>
            ))}
          </div>

          <div className="lr-people-panel">
            <div className="lr-people-panel-copy">
              <span className="lr-pp-label">One RSVP, one party</span>
              <p>A single submission from Amara Solaru becomes four separate guest records, each with its own pass, table, and status.</p>
            </div>
            <div className="lr-people-stack">
              {PEOPLE_STACK.map((p) => (
                <div className="lr-person" key={p.name}>
                  <span className="lr-p-ava">{p.initials}</span>
                  <div className="lr-p-body"><b>{p.name}</b><small>{p.role}</small></div>
                  <em className={`lr-p-status ${p.status}`}>{p.status === 'ok' ? 'Confirmed' : 'Pending'}</em>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="configurable">
        <div className="lr-shell">
          <div className="lr-flex-feature">
            <div>
              <span className="lr-eyebrow">Design Studio</span>
              <h2>Nothing about your RSVP form is hardcoded.</h2>
              <p className="lr-lead">Most platforms ship one fixed form and make you fit your event into it. Festio flips that: your colors, your wording, your questions, and your rules, all set by you, not by us.</p>
              <ul className="lr-check-list">
                <li><span className="lr-dot">&#10003;</span><div><b>Conditional questions.</b> Ask &ldquo;Which chapter?&rdquo; only when the answer to &ldquo;Membership type&rdquo; is Member. Any question can depend on any other.</div></li>
                <li><span className="lr-dot">&#10003;</span><div><b>Configurable guest types.</b> Define your own categories (Member, Spouse, Child, Guest) and decide which ones skip contact-info requirements.</div></li>
                <li><span className="lr-dot">&#10003;</span><div><b>25 guest hub styles.</b> Pick a look and every guest page inherits your colors, fonts, and wording automatically.</div></li>
              </ul>
            </div>
            <div className="lr-flex-mock">
              <div className="lr-fm-row"><span>Membership type</span><span className="lr-fm-cond">Always shown</span></div>
              <div className="lr-fm-row"><span>Branch or chapter</span><span className="lr-fm-cond">Shown if Member</span></div>
              <div className="lr-fm-row"><span>Dietary needs</span><span className="lr-fm-cond">Always shown</span></div>
              <div className="lr-fm-row"><span>Guest type: Child</span><span className="lr-fm-cond"><b>Contact info skipped</b></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section" id="ops">
        <div className="lr-shell">
          <div className="lr-section-head">
            <span className="lr-eyebrow"><i /> Day of the event</span>
            <h2>Operations that hold up under a real crowd.</h2>
            <p>Multiple entrances, ticketed zones, hundreds of people arriving at once. Festio was built to keep up, not just to look good in a demo.</p>
          </div>
          <div className="lr-ops-grid">
            <div className="lr-ops-panel">
              <div className="lr-ops-zone">
                <span className="lr-oz-icon">&#9636;</span>
                <div className="lr-oz-body"><strong>Section-based scanning</strong><span>Each device routes to its own table group, guests always resolve to their own section</span></div>
                <div className="lr-oz-num"><b>4</b><small>entrances live</small></div>
              </div>
              <div className="lr-ops-zone">
                <span className="lr-oz-icon">&#8635;</span>
                <div className="lr-oz-body"><strong>Multi-zone access</strong><span>Track in and out across zones, not just a single front-door scan</span></div>
                <div className="lr-oz-num"><b>7</b><small>zones tracked</small></div>
              </div>
              <div className="lr-ops-zone">
                <span className="lr-oz-icon">&#9638;</span>
                <div className="lr-oz-body"><strong>Live occupancy and flow</strong><span>Peak times, journey paths, and real-time counts as they happen</span></div>
                <div className="lr-oz-num"><b>96%</b><small>capture rate</small></div>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 16 }}>Built to give organizers of ticketed, multi-zone events the kind of access intelligence that used to require dedicated hardware: who&apos;s in, who&apos;s out, where the lines are forming, in real time.</p>
              <Link className="lr-btn ghost" to="/checkin-redesign">See venue access intelligence</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="community">
        <div className="lr-shell">
          <div className="lr-section-head">
            <span className="lr-eyebrow"><i /> After check-in</span>
            <h2>The event doesn&apos;t end when the doors open.</h2>
            <p>Keep the group connected before, during, and after with private channels, direct messages, and staff broadcasts, all inside the same guest hub.</p>
          </div>
          <div className="lr-community-strip">
            {COMMUNITY_CARDS.map((c) => (
              <div className="lr-msg-bubble" key={c.title}>
                <div className="lr-mb-head"><span className="lr-mb-ava">{c.initials}</span><div><strong>{c.title}</strong><span>{c.sub}</span></div></div>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-story-wrap" id="story">
        <div className="lr-shell lr-story">
          <div>
            <span className="lr-eyebrow"><i /> Real event, real scale</span>
            <blockquote>&ldquo;We tracked families, individual passes, and check-in across a 3-day convention without going back to a single spreadsheet.&rdquo;</blockquote>
            <cite>Convention organizing committee</cite>
          </div>
          <div className="lr-story-stage">
            <div className="lr-story-art">
              <div className="lr-dot" />
              <div className="lr-mark">F</div>
              <div className="lr-cap"><b>842 guests</b><span>3-day convention</span></div>
            </div>
            <div className="lr-story-result">
              <small>Check-in completion</small>
              <strong>96%</strong>
              <div className="lr-sv-bar"><i style={{ width: '96%' }} /></div>
              <p>Guests welcomed across 4 entrances</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lr-section" id="pricing">
        <div className="lr-shell">
          <div className="lr-section-head center">
            <span className="lr-eyebrow" style={{ justifyContent: 'center' }}><i /> Simple, flexible pricing</span>
            <h2>Start simple. Add what your event needs.</h2>
            <p>Create your event free, then choose the guest tools that match its size and complexity.</p>
          </div>
          <div className="lr-price-grid">
            {PRICING_TIERS.map((t) => (
              <article className={`lr-price-card${t.featured ? ' featured' : ''}`} key={t.tier}>
                {t.featured && <span className="lr-price-badge">Most popular</span>}
                <span className="lr-price-tier">{t.tier}</span>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
                {t.to.startsWith('mailto:') || t.to.startsWith('#') ? (
                  <a className="lr-price-cta" href={t.to}>{t.cta} <span>&#8599;</span></a>
                ) : (
                  <Link className="lr-price-cta" to={t.to}>{t.cta} <span>&#8599;</span></Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="contact">
        <div className="lr-shell lr-contact">
          <div>
            <span className="lr-eyebrow"><i /> Talk to an event specialist</span>
            <h2>See Festio on your event.</h2>
            <p className="lr-lead" style={{ maxWidth: 'none' }}>Tell us what you&apos;re planning and pick a preferred time. We&apos;ll send a calendar hold and follow up with the meeting link.</p>
          </div>
          <DemoContactForm />
        </div>
      </section>

      <section className="lr-final-cta">
        <div className="lr-shell">
          <span className="lr-eyebrow" style={{ justifyContent: 'center' }}><i /> Your next event starts here</span>
          <h2>Make every guest feel expected.</h2>
          <p>Build the invitation, organize the details, and welcome every single person with confidence.</p>
          <div className="lr-hero-ctas">
            <Link className="lr-btn primary lg" to="/register?redesign=1">Create your event free</Link>
            <a className="lr-btn ghost lg" href="#contact">Talk to us</a>
          </div>
        </div>
      </section>

      <footer className="lr-footer">
        <div className="lr-shell">
          <div className="lr-foot-grid">
            <div className="lr-foot-brand">
              <a className="lr-brand" href="#top"><span className="lr-brand-mark">F</span>Festio</a>
              <p>Invitations, individual guest passes, and live check-in, all connected to one guest record.</p>
            </div>
            <div className="lr-foot-cols">
              <div className="lr-foot-col">
                <strong>Product</strong>
                <a href="#journey">Guest journey</a>
                <a href="#configurable">Design Studio</a>
                <a href="#ops">Live operations</a>
                <Link to="/pricing">Pricing</Link>
              </div>
              <div className="lr-foot-col">
                <strong>Company</strong>
                <a href="#contact">Contact</a>
                {user ? <Link to={appHome}>Open app</Link> : <Link to="/login">Sign in</Link>}
              </div>
              <div className="lr-foot-col">
                <strong>Legal</strong>
                <Link to="/privacy">Privacy</Link>
                <Link to="/sms-policy">SMS terms</Link>
              </div>
            </div>
          </div>
          <div className="lr-foot-bottom">
            <span>&copy; {new Date().getFullYear()} Festio. Operated by FOHMA Solutions LLC.</span>
            <span>{CONTACT_EMAIL}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
