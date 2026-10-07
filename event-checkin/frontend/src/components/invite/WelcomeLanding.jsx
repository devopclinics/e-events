import { useEffect, useRef, useState } from 'react'
import './WelcomeLanding.css'

const shapes = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5h3" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  book: <path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2Z" />,
  people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>,
  star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" />,
  hotel: <path d="M4 21V3h16v18M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1" />,
  chat: <><path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z" /><path d="M8 10h8m-8 4h5" /></>,
}
const Icon = ({ name }) => <svg viewBox="0 0 24 24" aria-hidden="true">{shapes[name] || shapes.star}</svg>
const external = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '' } catch { return '' } }
const map = address => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
const screenFromHash = () => window.location.hash === '#/rsvp/register' ? 'register' : 'event'

// Only the public presentation changes. All RSVP, ticketing and eligibility
// controls are supplied by InvitePage and retain their existing implementations.
export default function WelcomeLanding({ event, title, dateLabel, timeLabel, venue, host, hostWebsite, about, designTheme, registration, deadline, returningGuest }) {
  const [screen, setScreen] = useState(screenFromHash)
  const [recover, setRecover] = useState(false)
  const [accessLink, setAccessLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const dialog = useRef(null)
  const main = useRef(null)
  const wording = designTheme?.wording || {}
  const config = designTheme?.page_config || {}
  const rawHighlights = config.about?.highlights
  const highlights = (Array.isArray(rawHighlights) ? rawHighlights : typeof rawHighlights === 'string' ? rawHighlights.split(/\n|\|/) : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 6)
  const hotelUrl = external(wording.hotelBookingUrl) || (event.hotel_address ? map(event.hotel_address) : '')
  const moreUrl = external(config.about?.ctaUrl || wording.aboutWebsite) || hostWebsite
  const cover = external(designTheme?.cover_image_url || event.invite_cover_image)
  const colors = designTheme?.colors || {}
  const safeColor = (value, fallback) => /^#[a-f\d]{6}$/i.test(value || '') ? value : fallback
  const style = { '--rw-primary': safeColor(colors.primary, '#194e3e'), '--rw-accent': safeColor(colors.accent, '#e9c968'), '--rw-paper': safeColor(colors.background, '#f8f7f1') }
  const registerLabel = returningGuest ? 'View my RSVP →' : 'Register / RSVP Now →'
  const showAbout = config.about?.show !== false
  const showVenue = config.details?.showVenue !== false && venue
  const showHotel = config.details?.showHotel !== false && hotelUrl

  useEffect(() => {
    const update = () => { setScreen(screenFromHash()); setRecover(false) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => { window.scrollTo(0, 0); main.current?.focus({ preventScroll: true }) }, [screen])
  useEffect(() => { if (recover) dialog.current?.showModal(); else dialog.current?.close() }, [recover])
  function navigate(next) { window.location.hash = next === 'register' ? '/rsvp/register' : '/rsvp/event'; setScreen(next) }
  function openGuestHub(e) {
    e.preventDefault()
    try {
      // Do not send a pasted capability to an external site or arbitrary path.
      const url = new URL(accessLink.trim(), window.location.origin)
      if (url.origin !== window.location.origin || !/^\/r\/[^/]+\/?$/.test(url.pathname) || url.username || url.password) throw new Error()
      window.location.assign(url.pathname + url.search + url.hash)
    } catch { setLinkError('Use the personal GuestHub link from your Festio confirmation email (ending in /r/your-link).') }
  }
  function scrollTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return <div className="rsvp-welcome" style={style}>
    <div className="rw-site">
      <header className="rw-topbar"><div className="rw-brand">{event.logo_url ? <img src={event.logo_url} alt="" /> : <span className="rw-brand-mark">{title.split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</span>}<div><strong>{title}</strong><small>Powered by Festio</small></div></div><nav aria-label="Event navigation">{screen === 'event' && <button className="rw-text rw-desktop" onClick={() => scrollTo('rw-plan')}>Plan your visit</button>}<button className="rw-btn rw-outline" onClick={() => returningGuest ? navigate('register') : setRecover(true)}>My GuestHub ↗</button></nav></header>
      <main ref={main} tabIndex={-1}>
        {screen === 'register' ? <section className="rw-registration"><button className="rw-text" onClick={() => navigate('event')}>← Event details</button><h1>{returningGuest ? 'Your RSVP' : 'Your event starts here.'}</h1><p>{title}</p><div className="rw-registration-content">{registration}</div></section> : <>
          <section className="rw-hero"><div><span className="rw-eyebrow">{host || 'YOU’RE INVITED'}</span><h1>{title}</h1>{showAbout && <p className="rw-lead">{about}</p>}<div className="rw-facts"><div><Icon name="calendar" /><span>{dateLabel}{timeLabel && <small>{timeLabel}</small>}</span></div>{showVenue && <div><Icon name="pin" /><span>{venue}</span></div>}</div>{cover && <img className="rw-cover" src={cover} alt="" />}</div><aside className="rw-arrival"><span className="rw-eyebrow">LET’S GET YOU READY</span><h2>{returningGuest ? 'Welcome back.' : 'Be part of the experience.'}</h2><p>{event.rsvp_multi_invitee_enabled ? 'Register yourself and the family or guests attending with you.' : 'View the registration details and respond to your invitation.'}</p><div className="rw-date"><Icon name="calendar" /><span>{dateLabel}</span></div><button className="rw-btn rw-gold" onClick={() => navigate('register')}>{registerLabel}</button><button className="rw-btn rw-secondary" onClick={() => returningGuest ? navigate('register') : setRecover(true)}>Already registered? My GuestHub →</button>{deadline && <p className="rw-deadline">RSVP deadline: {deadline}</p>}{!deadline && <p className="rw-deadline">Your pass and event services follow registration confirmation.</p>}</aside></section>
          {showAbout && highlights.length > 0 && <section className="rw-section"><div className="rw-heading"><span className="rw-eyebrow">COME FOR THE EXPERIENCE</span><h2>{wording.aboutHeading || 'Find your moment.'}</h2></div><div className="rw-highlights">{highlights.map((text, i) => <article key={`${i}:${text}`}><span className="rw-tile"><Icon name={['book', 'people', 'star', 'chat'][i % 4]} /></span><h3>{text}</h3></article>)}</div>{moreUrl && <a className="rw-text" href={moreUrl} target="_blank" rel="noopener noreferrer">Learn more about this event ↗</a>}</section>}
          {event.live_program_enabled && <section className="rw-section"><div className="rw-programme"><div><span className="rw-eyebrow">YOUR PROGRAMME</span><h2>Plan the moments that matter.</h2><p>Your personal programme is available in GuestHub after registration. It brings together the sessions and event updates available to you.</p></div><button className="rw-btn" onClick={() => navigate('register')}>Register to view your programme →</button></div></section>}
          <section className="rw-section" id="rw-plan"><div className="rw-heading"><span className="rw-eyebrow">A LITTLE PLANNING GOES A LONG WAY</span><h2>Plan your visit.</h2></div><div className="rw-travel">{showHotel && <article><span className="rw-tile"><Icon name="hotel" /></span><h3>{event.hotel_name || 'Your stay'}</h3><p>{event.hotel_address || 'Explore the organizer’s hotel information.'}</p><a className="rw-text" href={hotelUrl} target="_blank" rel="noopener noreferrer">{wording.hotelButton || 'View hotel information'} ↗</a></article>}{showVenue && <article><span className="rw-tile"><Icon name="pin" /></span><h3>Getting here</h3><p>{venue}</p><a className="rw-text" href={map(event.venue_address || venue)} target="_blank" rel="noopener noreferrer">Open directions ↗</a></article>}{event.rsvp_multi_invitee_enabled && <article><span className="rw-tile"><Icon name="people" /></span><h3>Coming with family?</h3><p>Add each person attending with you. Individual passes depend on confirmation and the event’s registration rules.</p><button className="rw-text" onClick={() => navigate('register')}>Register your party →</button></article>}{event.registry_enabled && event.registry_token && <article><span className="rw-tile"><Icon name="star" /></span><h3>Gift list</h3><p>Explore the organizer’s gifts and ways to support.</p><a className="rw-text" href={`/registry/${encodeURIComponent(event.registry_token)}`}>Open gift list →</a></article>}</div></section>
          <section className="rw-section rw-bottom"><div><span className="rw-eyebrow">BEFORE YOU REGISTER</span><h2>A few helpful details.</h2>{wording.whoCanAttend && <details open><summary>Who can attend?</summary><p>{wording.whoCanAttend}</p></details>}{(wording.admissionNote || event.admission_note) && <details open><summary>Registration information</summary><p>{wording.admissionNote || event.admission_note}</p></details>}<details><summary>Where will I find my pass?</summary><p>Use your personal GuestHub link after registration is confirmed. Pending approval, waitlisted or declined responses do not grant admission.</p></details>{event.rsvp_multi_invitee_enabled && <details><summary>Can I register my family together?</summary><p>Add each attendee in the Family / Guests step. The organizer’s guest limits, required questions and junior guardian requirements still apply.</p></details>}<details><summary>I already registered. What should I do?</summary><p>Open the personal GuestHub link in your confirmation email. You can also paste that link using My GuestHub above.</p></details></div><aside className="rw-help"><span className="rw-tile"><Icon name="chat" /></span><h2>Need a little help?</h2><p>Use your invitation’s contact details to speak with the organizer about your registration or arrival.</p>{hostWebsite && <a className="rw-btn rw-outline" href={hostWebsite} target="_blank" rel="noopener noreferrer">Visit the organizer’s website ↗</a>}<button className="rw-text" onClick={() => returningGuest ? navigate('register') : setRecover(true)}>Already registered? Open GuestHub →</button></aside></section>
          <section className="rw-closing"><div><h2>We look forward to seeing you.</h2><p>{dateLabel}</p></div><button className="rw-btn" onClick={() => navigate('register')}>{registerLabel}</button></section>
        </>}
      </main><footer className="rw-footer">{title} · Powered by Festio</footer>
      {screen === 'event' && <nav className="rw-mobile-actions" aria-label="Registration actions"><button className="rw-btn rw-outline" onClick={() => returningGuest ? navigate('register') : setRecover(true)}>My GuestHub</button><button className="rw-btn" onClick={() => navigate('register')}>{returningGuest ? 'My RSVP →' : 'Register →'}</button></nav>}
    </div>
    <dialog ref={dialog} onCancel={() => setRecover(false)} aria-labelledby="rw-dialog-title"><div className="rw-dialog-head"><h2 id="rw-dialog-title">Open your GuestHub</h2><button className="rw-close" aria-label="Close GuestHub dialog" onClick={() => setRecover(false)}>×</button></div><p>Open the personal link in your Festio confirmation email, or paste it below. Keep your personal link private.</p><form onSubmit={openGuestHub}><label htmlFor="rw-access-link">Your personal GuestHub link</label><input id="rw-access-link" type="text" inputMode="url" autoComplete="off" required value={accessLink} onChange={e => { setAccessLink(e.target.value); setLinkError('') }} placeholder="https://festio.events/r/…" />{linkError && <p role="alert">{linkError}</p>}<button className="rw-btn" type="submit">Open My GuestHub →</button></form><p className="rw-small">Can’t find your email? Contact the organizer using your invitation details.</p></dialog>
  </div>
}
