import MarketingEmailConsent from '../components/MarketingEmailConsent'
import {
  marketingConsent,
  DEMO_REQUEST_RECEIVED,
  demoRequestAttempt,
} from '../lib/marketingConsent.mjs'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import './LandingRedesignPage.css'
import './HomepageExperience.css'

const CONTACT_EMAIL = 'events@festio.events'

// This page showcases the redesign specifically, so its own CTAs bypass the
// org redesign_cohort gate that /admin, /setup, etc. normally go through
// (RedesignGate) and go straight to the redesign pages, unlike getPreferredView
// (App.jsx) which every other legacy entry point still relies on.
function redesignHome(role) {
  return role === 'admin' || role === 'event_manager'
    ? '/admin-redesign'
    : '/scanner-redesign'
}

function scrollToHomepageHash(focus = false) {
  let id
  try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
  if (!id) return
  const target = document.getElementById(id)
  target?.scrollIntoView({ block: 'start', behavior: 'instant' })
  if (focus) target?.focus({ preventScroll: true })
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
    <svg
      width="17"
      height="17"
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="17"
      height="17"
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

const PRICING_TIERS = [
  {
    tier: 'Free',
    title: 'Explore Festio',
    body: 'For testing the guest experience and planning small gatherings.',
    cta: 'Create free event',
    to: '/register?redesign=1',
  },
  {
    tier: 'Event Pass',
    title: 'Run your event',
    body: 'Compare paid plans, guest limits, message credits, and available add-ons on our pricing page.',
    cta: 'See pricing',
    to: '/pricing',
    featured: true,
  },
  {
    tier: 'Enterprise',
    title: 'Scale operations',
    body: 'Talk to our team about requirements for larger or more complex events.',
    cta: 'Talk to us',
    to: '#contact',
  },
]

function DemoContactForm() {
  const [form, setForm] = useState({
    contact_name: '',
    email: '',
    phone: '',
    organization: '',
    event_name: '',
    guest_count: '',
    preferred_time: defaultDemoTime(),
    message: '',
  })
  const [marketingEmail, setMarketingEmail] = useState(false)
  const attempt = useRef(null)
  const submitting = useRef(false)
  const [status, setStatus] = useState('idle') // idle | loading | success
  const [error, setError] = useState('')

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setStatus('loading')
    setError('')
    try {
      const body = {
        ...form,
        ...marketingConsent(marketingEmail),
        guest_count: form.guest_count ? Number(form.guest_count) : null,
        preferred_time: new Date(form.preferred_time).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        phone: form.phone || null,
        organization: form.organization || null,
        event_name: form.event_name || null,
        message: form.message || null,
      }
      attempt.current = demoRequestAttempt(attempt.current, body)
      const result = await api.submitDemoRequest(body, attempt.current.key)
      if (result?.ok !== true || result.status !== 'requested')
        throw new Error(
          'We could not confirm receipt of your demo request. Please try again.',
        )
      attempt.current = null
      setStatus('success')
    } catch (err) {
      setError(err.message || 'Could not send your request.')
      setStatus('idle')
    } finally {
      submitting.current = false
    }
  }

  if (status === 'success') {
    return (
      <div className="lr-contact-form lr-contact-success">
        <div
          className="lr-p-status ok"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 18,
          }}
        >
          &#10003;
        </div>
        <h3>Request received</h3>
        <p>{DEMO_REQUEST_RECEIVED}</p>
      </div>
    )
  }

  return (
    <form className="lr-contact-form" onSubmit={submit}>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Name</span>
          <input
            required
            value={form.contact_name}
            onChange={(e) => setField('contact_name', e.target.value)}
            placeholder="Your name"
          />
        </label>
        <label className="lr-field">
          <span>Email</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            placeholder="you@example.com"
          />
        </label>
      </div>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Phone</span>
          <input
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            placeholder="+1 555 000 0000"
          />
        </label>
        <label className="lr-field">
          <span>Organization</span>
          <input
            value={form.organization}
            onChange={(e) => setField('organization', e.target.value)}
            placeholder="Company, venue, or host"
          />
        </label>
      </div>
      <div className="lr-contact-row">
        <label className="lr-field">
          <span>Event</span>
          <input
            value={form.event_name}
            onChange={(e) => setField('event_name', e.target.value)}
            placeholder="Event name or type"
          />
        </label>
        <label className="lr-field">
          <span>Guests</span>
          <input
            min="1"
            type="number"
            value={form.guest_count}
            onChange={(e) => setField('guest_count', e.target.value)}
            placeholder="150"
          />
        </label>
      </div>
      <label className="lr-field">
        <span>Preferred time</span>
        <input
          required
          type="datetime-local"
          value={form.preferred_time}
          onChange={(e) => setField('preferred_time', e.target.value)}
        />
      </label>
      <label className="lr-field">
        <span>What should we cover?</span>
        <textarea
          value={form.message}
          onChange={(e) => setField('message', e.target.value)}
          placeholder="RSVP, QR passes, check-in, seating, venue access..."
        />
      </label>
      <MarketingEmailConsent checked={marketingEmail}
        onChange={setMarketingEmail}
        disabled={status === 'loading'}
      />
      {error && <p className="lr-contact-error">{error}</p>}
      <button
        className="lr-btn primary lg"
        disabled={status === 'loading'}
        type="submit"
      >
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
  const [preview, setPreview] = useState('invite')
  const [menuOpen, setMenuOpen] = useState(false)
  const navigation = useRef(null)
  const menuToggle = useRef(null)
  const previewFocus = useRef(false)
  const previewPanel = useRef(null)

  function changePreview(next, focus = false) {
    previewFocus.current = focus
    setPreview(next)
  }

  useEffect(() => {
    if (!previewFocus.current) return
    previewFocus.current = false
    const panel = previewPanel.current?.querySelector(
      '[data-preview-panel]:not([hidden])',
    )
    ;(panel?.querySelector('button') || panel)?.focus({ preventScroll: true })
  }, [preview])

  useEffect(() => {
    let frame
    function scrollToSection() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => scrollToHomepageHash(true))
      setMenuOpen(false)
    }
    scrollToSection()
    window.addEventListener('hashchange', scrollToSection)
    window.addEventListener('popstate', scrollToSection)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('hashchange', scrollToSection)
      window.removeEventListener('popstate', scrollToSection)
    }
  }, [])

  // Event cards arrive asynchronously and can move the sections below them.
  // Restore the anchor after their layout commits without moving keyboard focus.
  useEffect(() => {
    if (!publicEvents.length) return
    const frame = requestAnimationFrame(() => scrollToHomepageHash())
    return () => cancelAnimationFrame(frame)
  }, [publicEvents.length])

  useEffect(() => {
    if (!menuOpen) return
    navigation.current?.querySelector('#homepage-navigation a')?.focus()
    function dismiss(event) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        setMenuOpen(false)
        menuToggle.current?.focus()
      } else if (
        event.type === 'pointerdown' &&
        !navigation.current?.contains(event.target)
      ) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', dismiss)
    return () => {
      document.removeEventListener('keydown', dismiss)
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [menuOpen])
  useEffect(() => {
    fetch('/api/ticketing/public/events', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setPublicEvents((data.events || []).slice(0, 6)))
      .catch(() => setPublicEvents([]))
  }, [])

  function renderPreview() {
    return (
      <>
        <div
          className="preview-panel"
          data-preview-panel="invite"
          hidden={preview !== 'invite'}
        >
          <div className="eyebrow">A moment worth sharing</div>
          <h3>
            Some evenings become
            <br />
            your favourite memories.
          </h3>
          <button
            type="button"
            className="envelope"
            aria-label="Open sample invitation"
            onClick={() => changePreview('rsvp', true)}
          />
          <button
            type="button"
            className="open-button"
            onClick={() => changePreview('rsvp', true)}
          >
            Open your invitation ↗
          </button>
        </div>
        <div
          className="pass preview-panel"
          data-preview-panel="rsvp"
          hidden={preview !== 'rsvp'}
        >
          <div className="eyebrow">The annual gathering</div>
          <h3>We saved you a place.</h3>
          <p>Amara, will you be joining us?</p>
          <button
            type="button"
            className="btn"
            onClick={() => changePreview('pass', true)}
          >
            Joyfully accept ↗
          </button>
          <p className="preview-note">
            Interactive sample · Nothing is submitted
          </p>
        </div>
        <div
          className="pass preview-panel"
          data-preview-panel="pass"
          hidden={preview !== 'pass'}
          tabIndex={-1}
          aria-label="Sample guest pass"
        >
          <div className="eyebrow">Your personal guest pass</div>
          <h3>Welcome, Amara.</h3>
          <p>The annual gathering</p>
          <div className="qr" aria-hidden="true" />
          <div>Table 08 · Seat 03</div>
          <p className="preview-note">Sample pass · Not valid for entry</p>
        </div>
      </>
    )
  }

  return (
    <div className="landing-redesign fh-home">
      <nav className="lr-nav" aria-label="Main navigation" ref={navigation}>
        <div className="lr-shell lr-nav-inner">
          <a className="lr-brand" href="#top">
            <span className="lr-brand-mark">F</span>Festio
          </a>
          <div
            className={`lr-nav-links${menuOpen ? ' is-open' : ''}`}
            id="homepage-navigation"
            onClick={() => setMenuOpen(false)}
          >
            <a href="#journey">Product</a>
            <a href="#design-studio">Design Studio</a>
            <a href="#tools">For organizers</a>
            <a href="#occasions">Your kind of event</a>
            <Link to="/tickets">Find events</Link>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="lr-nav-actions">
            <button
              type="button"
              className="fh-menu-toggle"
              ref={menuToggle}
              aria-expanded={menuOpen}
              aria-controls="homepage-navigation"
              aria-label={
                menuOpen ? 'Close navigation menu' : 'Open navigation menu'
              }
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path
                  d={
                    menuOpen
                      ? 'M6 6l12 12M6 18L18 6'
                      : 'M4 6h16M4 12h16M4 18h16'
                  }
                />
              </svg>
            </button>
            <button
              type="button"
              className="lr-theme-btn"
              onClick={toggle}
              aria-label="Toggle theme"
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            {user ? (
              <Link className="lr-btn primary" to={appHome}>
                Open app
              </Link>
            ) : (
              <>
                <Link className="lr-signin" to="/login">
                  Sign in
                </Link>
                <Link className="lr-btn primary" to="/register?redesign=1">
                  Create free event
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="fh-main">
        <header className="hero" id="top" tabIndex={-1}>
          <div>
            <div className="eyebrow">
              For the moments that bring us together
            </div>
            <h1>
              Great events.
              <br />
              Beautiful details.
              <br />
              <em>Everyone belongs.</em>
            </h1>
            <p className="intro">
              From the first invitation to the last guest welcomed. Bring your
              people, your plans, and your entire event together.
            </p>
            <div className="cta">
              <Link className="btn" to={appHome || '/register?redesign=1'}>
                {user ? 'Open your workspace ↗' : 'Create your event free ↗'}
              </Link>
              <a className="btn light" href="#journey">
                Explore the experience
              </a>
            </div>
            <div className="fine">
              No credit card to start. Make it yours as you grow.
            </div>
          </div>
          <div>
            <div className="scene">
              <div className="float one">
                <span className="dot">●</span> A welcome, made personal
                <strong>Dear Amara, you're invited.</strong>Your invitation.
                Your private link.
              </div>
              <div className="float two">
                THE LITTLE DETAILS<strong>One connected journey ↗</strong>Invite
                · RSVP · Pass · Welcome
              </div>
              <div className="invitation" id="preview" tabIndex={-1} ref={previewPanel}>
                {renderPreview()}
              </div>
            </div>
            <div
              className="tabs"
              role="group"
              aria-label="Guest journey preview"
            >
              {['Invitation', 'RSVP', 'Guest pass'].map((label, index) => (
                <button
                  type="button"
                  key={label}
                  className={
                    preview === ['invite', 'rsvp', 'pass'][index]
                      ? 'active'
                      : ''
                  }
                  aria-pressed={preview === ['invite', 'rsvp', 'pass'][index]}
                  onClick={() =>
                    changePreview(['invite', 'rsvp', 'pass'][index])
                  }
                >
                  0{index + 1} {label}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div className="trust">
          <div className="eyebrow">
            Thoughtfully connected.
            <br />
            From start to celebration.
          </div>
          <span>Personal invitations</span>
          <span>Effortless RSVPs</span>
          <span>Individual passes</span>
          <span>A warmer welcome</span>
        </div>
        <section id="journey" tabIndex={-1}>
          <div className="section-head">
            <div>
              <div className="eyebrow">Every guest. Every little detail.</div>
              <h2>
                One event.
                <br />A beautifully connected experience.
              </h2>
            </div>
            <p>
              No scattered guest lists or disconnected tools. Just a clear path
              from “you're invited” to “so glad you're here.”
            </p>
          </div>
          <div className="journey">
            <article className="card">
              <div className="visual">
                <div className="mini">
                  <small>THE ANNUAL GATHERING</small>
                  <strong>You're on the list.</strong>
                  <p>An invitation that feels like you.</p>
                  <div className="row">
                    Personal wording <span>✦</span>
                  </div>
                  <div className="row">
                    Colours & opening styles <span>↗</span>
                  </div>
                </div>
              </div>
              <div className="card-copy">
                <small>01 / MAKE IT PERSONAL</small>
                <h3>An invitation to remember.</h3>
                <p>
                  Beautiful event websites and invitation openings, with your
                  colours, your words, and your guest's name.
                </p>
                <a
                  className="text-link"
                  href="#preview"
                  onClick={() => changePreview('invite')}
                >
                  Open an invitation ↗
                </a>
              </div>
            </article>
            <article className="card">
              <div className="visual mint">
                <div className="mini" style={{ transform: 'rotate(3deg)' }}>
                  <small>YOUR PARTY · 3 GUESTS</small>
                  <strong>Room for everyone.</strong>
                  <div className="row">
                    Amara Solaru <span className="pill">Confirmed</span>
                  </div>
                  <div className="row">
                    Tunde Solaru <span className="pill">Confirmed</span>
                  </div>
                  <div className="row">
                    Zainab Solaru <span className="pill">Confirmed</span>
                  </div>
                </div>
              </div>
              <div className="card-copy">
                <small>02 / BRING EVERYONE TOGETHER</small>
                <h3>A yes, without the fuss.</h3>
                <p>
                  Welcome individuals, couples, and families. Collect the
                  answers you need and keep every person organized.
                </p>
                <a
                  className="text-link"
                  href="#preview"
                  onClick={() => changePreview('rsvp')}
                >
                  Try the RSVP preview ↗
                </a>
              </div>
            </article>
            <article className="card">
              <div className="visual peach">
                <div className="mini">
                  <small>FESTIO PASS</small>
                  <strong>Welcome, Amara.</strong>
                  <div className="row">
                    Table 08 <span>Seat 03</span>
                  </div>
                  <div className="row">
                    Admission <span className="pill">Ready to scan</span>
                  </div>
                  <p>Your event details, all in one place.</p>
                </div>
              </div>
              <div className="card-copy">
                <small>03 / WELCOME THEM WELL</small>
                <h3>A smooth arrival.</h3>
                <p>
                  Give each guest their own pass and event hub. Scan them in and
                  keep your team informed as the room fills.
                </p>
                <a
                  className="text-link"
                  href="#preview"
                  onClick={() => changePreview('pass')}
                >
                  See a guest pass ↗
                </a>
              </div>
            </article>
          </div>
        </section>
        <section id="design-studio" tabIndex={-1} className="fh-design-section">
          <div className="section-head">
            <div>
              <div className="eyebrow">Your event, unmistakably yours</div>
              <h2>
                A little personality.
                <br />
                In every detail.
              </h2>
            </div>
            <p>
              Choose your look, personalize your wording, and preview the
              experience before you publish.
            </p>
          </div>
          <div className="fh-design-grid">
            <article className="card">
              <div
                className="fh-design-art fh-design-invite"
                aria-hidden="true"
              >
                <span>A PERSONAL INVITATION</span>
                <strong>
                  Together,
                  <br />a beautiful evening.
                </strong>
                <i>A & J</i>
              </div>
              <div className="card-copy">
                <h3>Invitation openings</h3>
                <p>
                  Set the mood with envelope styles, colours, and personal
                  wording.
                </p>
                <a
                  className="text-link"
                  href="#preview"
                  onClick={() => changePreview('invite')}
                >
                  Preview an invitation ↗
                </a>
              </div>
            </article>
            <article className="card">
              <div
                className="fh-design-art fh-design-website"
                aria-hidden="true"
              >
                <span>THE ANNUAL GATHERING</span>
                <strong>
                  Meet you
                  <br />
                  under the stars.
                </strong>
                <i>Your event · Your story</i>
              </div>
              <div className="card-copy">
                <h3>Event websites</h3>
                <p>
                  Bring your event details together in a website that reflects
                  your occasion.
                </p>
                <Link
                  className="text-link"
                  to={appHome || '/register?redesign=1'}
                >
                  Create your event ↗
                </Link>
              </div>
            </article>
            <article className="card">
              <div className="fh-design-art fh-design-pass" aria-hidden="true">
                <span>YOUR FESTIO PASS</span>
                <strong>
                  Welcome,
                  <br />
                  Amara.
                </strong>
                <i>Table 08 · Seat 03</i>
              </div>
              <div className="card-copy">
                <h3>Passes & GuestHub</h3>
                <p>
                  Carry your event’s look into the guest pass and personal event
                  hub.
                </p>
                <a
                  className="text-link"
                  href="#preview"
                  onClick={() => changePreview('pass')}
                >
                  Preview a guest pass ↗
                </a>
              </div>
            </article>
          </div>
        </section>
        <section className="band" id="tools" tabIndex={-1}>
          <div className="band-copy">
            <div className="eyebrow">
              Beautiful for guests. Powerful for you.
            </div>
            <h2>
              Behind every effortless event,
              <br />a plan that works.
            </h2>
            <p>
              Arrange the room. Coordinate your team. Sell tickets, send
              updates, and keep the moving parts in view.
            </p>
            <p>
              Planner & budgets · Seating & floor plans
              <br />
              Ticketing · Messaging · Live check-in
            </p>
            <Link className="btn" to="/pricing">
              Explore plans & tools ↗
            </Link>
          </div>
          <div className="floor" aria-label="Illustrative floor plan">
            <div className="stage">THE STAGE</div>
            <div className="table">01</div>
            <div className="table">02</div>
            <div className="table">03</div>
            <div className="table">04</div>
            <div className="table">05</div>
            <div className="table">06</div>
            <div className="table">07</div>
            <div className="table">08</div>
            <div
              className="stage"
              style={{ margin: '0', background: '#ffffff15', color: 'white' }}
            >
              A place for everyone. A clear view for your team.
            </div>
          </div>
        </section>
        <section id="occasions" tabIndex={-1} className="fh-occasions">
          <div className="closing">
            <div className="eyebrow">Your people. Your occasion.</div>
            <h2>Whatever brings you together.</h2>
            <p>Make it feel like your event, from the first hello.</p>
          </div>
          <div className="fh-occasion-grid">
            {[
              {
                name: 'Conferences & conventions',
                kind: 'conference',
                heading: 'Ideas worth sharing.',
                detail: 'Speakers · Programme · Guest passes',
                body: 'Keep registration, speakers, schedules, and arrivals connected.',
                cta: 'Plan a conference',
              },
              {
                name: 'Celebrations & weddings',
                kind: 'celebration',
                heading: 'A day to remember.',
                detail: 'Invitations · Families · Seating',
                body: 'Personal invitations, family RSVPs, meal choices, and thoughtful seating.',
                cta: 'Plan a celebration',
              },
              {
                name: 'Fundraisers & galas',
                kind: 'fundraiser',
                heading: 'Together, for a cause.',
                detail: 'Event website · Tickets · Giving',
                body: 'Share your cause, welcome supporters, and coordinate the evening.',
                cta: 'Plan a fundraiser',
              },
              {
                name: 'Community gatherings',
                kind: 'community',
                heading: 'Better, together.',
                detail: 'Your people · One shared experience',
                body: 'Bring your group together with clear invitations, updates, and guest passes.',
                cta: 'Plan a gathering',
              },
            ].map((occasion) => (
              <article className="card" key={occasion.kind}>
                <div
                  className={`fh-occasion-art ${occasion.kind}`}
                  aria-hidden="true"
                >
                  <span>{occasion.detail}</span>
                  <strong>{occasion.heading}</strong>
                  <div className="fh-art-motif">
                    {occasion.kind === 'celebration'
                      ? 'A & J'
                      : occasion.kind === 'conference'
                        ? '01 / 02 / 03'
                        : occasion.kind === 'fundraiser'
                          ? 'A little kindness. A lasting difference.'
                          : 'A place for everyone.'}
                  </div>
                  <small>Illustrative preview</small>
                </div>
                <div className="card-copy">
                  <h3>{occasion.name}</h3>
                  <p>{occasion.body}</p>
                  <Link
                    className="text-link"
                    to={appHome || '/register?redesign=1'}
                  >
                    {occasion.cta} ↗
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="lr-events">
          <div className="lr-shell">
            <div className="lr-events-head">
              <div>
                <span className="lr-eyebrow">
                  <i /> Festio Tickets
                </span>
                <h2>Find your next event.</h2>
                <p>
                  Official event pages, secure tickets and unique QR admission.
                </p>
              </div>
              <Link className="lr-btn ghost" to="/tickets">
                Find events →
              </Link>
            </div>
            {publicEvents.length > 0 && (
              <div className="lr-events-grid">
                {publicEvents.map((event) => (
                  <Link
                    className="lr-event-card"
                    to={`/tickets/e/${event.id}`}
                    key={event.id}
                  >
                    <div
                      style={
                        event.cover_image
                          ? {
                              backgroundImage: `linear-gradient(180deg,transparent,rgba(9,29,27,.75)),url("${event.cover_image}")`,
                            }
                          : {}
                      }
                    >
                      <span>
                        {event.timing === 'current'
                          ? 'Happening now'
                          : 'Upcoming'}
                      </span>
                    </div>
                    <section>
                      <small>
                        {new Date(event.event_date).toLocaleDateString(
                          undefined,
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </small>
                      <h3>{event.name}</h3>
                      <p>
                        {event.venue_name ||
                          event.venue_address ||
                          'Details from the organizer'}
                      </p>
                    </section>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <section className="lr-section" id="pricing" tabIndex={-1}>
        <div className="lr-shell">
          <div className="lr-section-head center">
            <span className="lr-eyebrow" style={{ justifyContent: 'center' }}>
              <i /> Simple, flexible pricing
            </span>
            <h2>Start simple. Add what your event needs.</h2>
            <p>
              Create your event free, then choose the guest tools that match its
              size and complexity.
            </p>
          </div>
          <div className="lr-price-grid">
            {PRICING_TIERS.map((t) => (
              <article
                className={`lr-price-card${t.featured ? ' featured' : ''}`}
                key={t.tier}
              >
                {t.featured && (
                  <span className="lr-price-badge">Pay per event</span>
                )}
                <span className="lr-price-tier">{t.tier}</span>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
                {t.to.startsWith('mailto:') || t.to.startsWith('#') ? (
                  <a className="lr-price-cta" href={t.to}>
                    {t.cta} <span>&#8599;</span>
                  </a>
                ) : (
                  <Link className="lr-price-cta" to={t.to}>
                    {t.cta} <span>&#8599;</span>
                  </Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lr-section tight" id="contact" tabIndex={-1}>
        <div className="lr-shell lr-contact">
          <div>
            <span className="lr-eyebrow">
              <i /> Talk to an event specialist
            </span>
            <h2>See Festio on your event.</h2>
            <p className="lr-lead" style={{ maxWidth: 'none' }}>
              Tell us what you&apos;re planning and suggest a preferred time.
              This is a request, not a confirmed booking. Our team will contact
              you to arrange a time.
            </p>
          </div>
          <DemoContactForm />
        </div>
      </section>

      <section className="lr-final-cta">
        <div className="lr-shell">
          <span className="lr-eyebrow" style={{ justifyContent: 'center' }}>
            <i /> Your next event starts here
          </span>
          <h2>Your next great event starts with a little Festio.</h2>
          <p>
            Build the invitation, organize the details, and welcome every single
            person with confidence.
          </p>
          <div className="lr-hero-ctas">
            <Link className="lr-btn primary lg" to="/register?redesign=1">
              Create your event free
            </Link>
            <a className="lr-btn ghost lg" href="#contact">
              Request a demo
            </a>
          </div>
        </div>
      </section>

      <footer className="lr-footer">
        <div className="lr-shell">
          <div className="lr-foot-grid">
            <div className="lr-foot-brand">
              <a className="lr-brand" href="#top">
                <span className="lr-brand-mark">F</span>Festio
              </a>
              <p>
                Invitations, individual guest passes, and live check-in, all
                connected to one guest record.
              </p>
              <p>
                <strong>
                  FestioEvents is an event-management platform operated by FOHMA
                  Solutions LLC.
                </strong>
              </p>
            </div>
            <div className="lr-foot-cols">
              <div className="lr-foot-col">
                <strong>Product</strong>
                <a href="#journey">Guest journey</a>
                <a href="#design-studio">Design Studio</a>
                <a href="#tools">Organizer tools</a>
                <Link to="/pricing">Pricing</Link>
              </div>
              <div className="lr-foot-col">
                <strong>Company</strong>
                <a href="#contact">Contact</a>
                {user ? (
                  <Link to={appHome}>Open app</Link>
                ) : (
                  <Link to="/login">Sign in</Link>
                )}
              </div>
              <div className="lr-foot-col">
                <strong>Legal</strong>
                <Link to="/privacy">Privacy</Link>
                <Link to="/terms">Terms</Link>
                <Link to="/sms-policy">SMS terms</Link>
              </div>
            </div>
          </div>
          <div className="lr-foot-bottom">
            <span>
              &copy; {new Date().getFullYear()} FestioEvents. Operated by FOHMA
              Solutions LLC.
            </span>
            <span>{CONTACT_EMAIL}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
