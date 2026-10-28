import { FONTS, imagePresentation } from '../design-studio/model.mjs'
import { Fragment, useEffect, useRef, useState } from 'react'
import './WelcomeLanding.css'
import './RegistrationExperience.css'
import { welcomeColors } from './themeContrast.mjs'
import RsvpFormatHero from './RsvpFormatHero'
import { rsvpFormat } from './rsvpFormats.mjs'
import './RsvpFormats.css'
import './RsvpPresentation.css'
import { presentation, sectionStyle } from './presentation.mjs'
import { useEventWebsite } from '../guesthub/EventWebsiteLink'

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
const screenFromHash = () => window.location.hash === '#/rsvp/register' ? 'register' : window.location.hash === '#/more' ? 'more' : 'event'

// Only the public presentation changes. All RSVP, ticketing and eligibility
// controls are supplied by InvitePage and retain their existing implementations.
export default function WelcomeLanding({ event, title, dateLabel, timeLabel, venue, host, hostWebsite, about, designTheme, registration, deadline, returningGuest, previewMock = false, ticketing = false }) {
  const [screen, setScreen] = useState(screenFromHash)
  const [wideCover, setWideCover] = useState(false)
  const [recover, setRecover] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [recoveryState, setRecoveryState] = useState('idle')
  const [recoveryError, setRecoveryError] = useState('')
  const dialog = useRef(null)
  const main = useRef(null)
  const wording = designTheme?.wording || {}
  const config = designTheme?.page_config || {}
  const rawHighlights = config.about?.highlights
  const highlights = (Array.isArray(rawHighlights) ? rawHighlights : typeof rawHighlights === 'string' ? rawHighlights.split(/\n|\|/) : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 6)
  const hotelUrl = external(wording.hotelBookingUrl) || (event.hotel_address ? map(event.hotel_address) : '')
  const websiteUrl = useEventWebsite(event.id, previewMock, event.external_website_url)
  const moreUrl = external(config.about?.ctaUrl || wording.aboutWebsite) || hostWebsite
  const venuePending = !venue || /^(venue\s*(to be confirmed|tba|tbd)|to be confirmed|tba|tbd)$/i.test(venue.trim())
  const hasDirections = !venuePending && !!(event.venue_address || venue)
  const coverPresentation = imagePresentation(designTheme,'rsvp')
  const rawCover = designTheme?.cover_image_url || event.invite_cover_image
  const cover = coverPresentation.visible ? (typeof rawCover === 'string' && /^\/(?!\/)(?:api\/uploads\/|api\/v1\/design\/files\/|site-assets\/)/.test(rawCover) && !/[\\\s]/.test(rawCover) ? rawCover : external(rawCover)) : ''
  const paragraphs = typeof about === 'string' ? about.split(/\n\s*\n/).filter(x => x.trim()) : []
  const longIntroduction = paragraphs.length > 2 || (typeof about === 'string' && about.length > 650)
  const format = rsvpFormat(designTheme)
  const settings = presentation(config.presentation)
  const colors = designTheme?.colors || {}
  const heroStyle = sectionStyle(settings, 'hero')
  const style = { ...welcomeColors(colors), ...(heroStyle.background ? {'--rw-custom-hero-bg':heroStyle.background,'--rw-custom-hero-ink':heroStyle.color} : {}), '--rw-heading-font': FONTS[designTheme?.font_pairing] || 'Georgia,serif' }
  const registerLabel = returningGuest ? 'View my RSVP →' : 'Register / RSVP Now →'
  const showAbout = config.about?.show !== false
  const showVenue = config.details?.showVenue !== false && venue
  const showHotel = config.details?.showHotel !== false && hotelUrl

  useEffect(() => {
    const update = () => { setScreen(screenFromHash()); setRecover(false) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => { if (screen === 'more') document.getElementById('rw-more')?.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0); main.current?.focus({ preventScroll: true }) }, [screen])
  useEffect(() => { if (recover) dialog.current?.showModal(); else dialog.current?.close() }, [recover])
  function navigate(next) { window.location.hash = next === 'register' ? '/rsvp/register' : next === 'more' ? '/more' : '/rsvp/event'; setScreen(next) }
  async function requestGuestHub(e) {
    e.preventDefault()
    if (recoveryState === 'sending') return
    setRecoveryState('sending')
    setRecoveryError('')
    try {
      const response = await fetch(`/api/invite/${encodeURIComponent(event.id)}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail.trim(), first_name: firstName.trim(), last_name: lastName.trim() }),
      })
      if (!response.ok) {
        const message = response.status === 429 ? 'Please wait a few minutes before requesting another email.'
          : response.status === 422 ? 'Check your email address and try again.'
          : response.status === 410 ? 'This event has ended. Contact the organizer for help.'
          : 'We couldn’t request your link. Please try again in a few minutes.'
        throw new Error(message)
      }
      setRecoveryState('sent')
    } catch (error) {
      setRecoveryError(error instanceof TypeError ? 'Unable to connect. Check your connection and try again.' : error.message)
      setRecoveryState('idle')
    }
  }
  function scrollTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  const sections = {
    overview: (<section data-section="overview" data-custom-color={!!settings.sectionColors.overview} style={sectionStyle(settings,'overview')} className="rw-section rw-overview" id="rw-more" aria-label="Event information">{showAbout && <article className="rw-about-card"><span className="rw-eyebrow">ABOUT THE EVENT</span><h2>{wording.aboutHeading || 'Discover the event.'}</h2>{wording.rsvpNote && <p>{wording.rsvpNote}</p>}{websiteUrl && <a className="rw-btn rw-outline" href={websiteUrl} target="_blank" rel="noopener noreferrer">Visit event website ↗</a>}{!wording.rsvpNote && !websiteUrl && <p>Explore the available event information below, or register to access your personal event services.</p>}</article>}<aside className="rw-arrival"><span className="rw-eyebrow">ALREADY REGISTERED?</span><h2>Your event, in your pocket.</h2><p>Open your personal GuestHub to view the services and event details available to you.</p><button className="rw-btn rw-gold" onClick={() => returningGuest ? navigate('register') : setRecover(true)}>Open my GuestHub →</button></aside></section>),
    highlights: (showAbout && highlights.length > 0 && <section data-section="highlights" data-custom-color={!!settings.sectionColors.highlights} style={sectionStyle(settings,'highlights')} className="rw-section"><div className="rw-heading"><span className="rw-eyebrow">COME FOR THE EXPERIENCE</span><h2>{wording.aboutHeading || 'Find your moment.'}</h2></div><div className="rw-highlights">{highlights.map((text, i) => <article key={`${i}:${text}`}><span className="rw-tile"><Icon name={['book', 'people', 'star', 'chat'][i % 4]} /></span><h3>{text}</h3></article>)}</div>{moreUrl && <a className="rw-text" href={moreUrl} target="_blank" rel="noopener noreferrer">Learn more about this event ↗</a>}</section>),
    programme: (event.live_program_enabled && <section data-section="programme" data-custom-color={!!settings.sectionColors.programme} style={sectionStyle(settings,'programme')} className="rw-section"><div className="rw-programme"><div><span className="rw-eyebrow">YOUR PROGRAMME</span><h2>Plan the moments that matter.</h2><p>Your personal programme is available in GuestHub after registration. It brings together the sessions and event updates available to you.</p></div><button className="rw-btn" onClick={() => navigate('register')}>Register to view your programme →</button></div></section>),
    travel: ((showVenue || showHotel || event.rsvp_multi_invitee_enabled || (event.registry_enabled && event.registry_token)) && <section data-section="travel" data-custom-color={!!settings.sectionColors.travel} style={sectionStyle(settings,'travel')} className="rw-section" id="rw-plan"><div className="rw-heading"><span className="rw-eyebrow">A LITTLE PLANNING GOES A LONG WAY</span><h2>Plan your visit.</h2></div><div className="rw-travel">{showHotel && <article><span className="rw-tile"><Icon name="hotel" /></span><h3>{event.hotel_name || 'Your stay'}</h3><p>{event.hotel_address || 'Explore the organizer’s hotel information.'}</p><a className="rw-text" href={hotelUrl} target="_blank" rel="noopener noreferrer">{wording.hotelButton || 'View hotel information'} ↗</a></article>}{showVenue && <article><span className="rw-tile"><Icon name="pin" /></span><h3>{venuePending ? 'Venue details are on the way.' : 'Getting here'}</h3><p>{venuePending ? 'The organizer will announce the confirmed venue. Directions will appear once a location is available.' : venue}</p>{hasDirections && <a className="rw-text" href={map(event.venue_address || venue)} target="_blank" rel="noopener noreferrer">Open directions ↗</a>}</article>}{event.rsvp_multi_invitee_enabled && <article><span className="rw-tile"><Icon name="people" /></span><h3>Coming with family?</h3><p>Add each person attending with you. Individual passes depend on confirmation and the event’s registration rules.</p><button className="rw-text" onClick={() => navigate('register')}>Register your party →</button></article>}{event.registry_enabled && event.registry_token && <article><span className="rw-tile"><Icon name="star" /></span><h3>Gift list</h3><p>Explore the organizer’s gifts and ways to support.</p><a className="rw-text" href={`/registry/${encodeURIComponent(event.registry_token)}`}>Open gift list →</a></article>}</div></section>),
    faq: (<section data-section="faq" data-custom-color={!!settings.sectionColors.faq} style={sectionStyle(settings,'faq')} className="rw-section rw-bottom"><div><span className="rw-eyebrow">BEFORE YOU REGISTER</span><h2>A few helpful details.</h2>{wording.whoCanAttend && <details open><summary>Who can attend?</summary><p>{wording.whoCanAttend}</p></details>}{config.details?.showAdmission !== false && (wording.admissionNote || event.admission_note) && <details open><summary>Registration information</summary><p>{wording.admissionNote || event.admission_note}</p></details>}<details><summary>Where will I find my pass?</summary><p>Use your personal GuestHub link after registration is confirmed. Pending approval, waitlisted or declined responses do not grant admission.</p></details>{event.rsvp_multi_invitee_enabled && <details><summary>Can I register my family together?</summary><p>Add each attendee in the Family / Guests step. The organizer’s guest limits, required questions and junior guardian requirements still apply.</p></details>}<details><summary>I already registered. What should I do?</summary><p>Open your personal link from your confirmation email, or choose My GuestHub above to request it again using your registration email. Verification is by email only.</p></details></div></section>),
  }
  return <div className={`rsvp-welcome rw-format-${format} ${screen === 'register' ? 'rw-register-page' : ''}`} data-wide-cover={wideCover && settings.imagePlacement === 'theme' && settings.shape === 'theme'} data-long-title={title.length > 45} data-custom-hero={!!settings.sectionColors.hero} data-registration-kind={ticketing ? 'tickets' : 'rsvp'} data-rsvp-format={format} data-spacing={settings.spacing} data-cards={settings.cards} data-shape={settings.shape} data-image-placement={settings.imagePlacement} style={style}>
    <div className="rw-site">
      <header className="rw-topbar"><div className="rw-brand">{(designTheme?.logo_image_url || event.logo_url) ? <img src={designTheme?.logo_image_url || event.logo_url} alt="" /> : <span className="rw-brand-mark">{title.split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</span>}<div><strong>{title}</strong><small>Powered by Festio</small></div></div><nav aria-label="Event navigation">{screen !== 'register' && <button className="rw-text rw-desktop" onClick={() => navigate('more')}>Event information</button>}<button className={`rw-btn rw-outline ${screen !== 'register' ? 'rw-desktop' : ''}`} onClick={() => returningGuest ? navigate('register') : setRecover(true)}>My GuestHub ↗</button>{screen !== 'register' && <button className="rw-btn rw-gold rw-top-register" onClick={() => navigate('register')}>{returningGuest ? 'My RSVP ↗' : 'Register ↗'}</button>}</nav></header>
      <main ref={main} tabIndex={-1}>
        {screen === 'register' ? <section className="rw-registration"><aside className="rw-registration-story"><button className="rw-registration-back" onClick={() => navigate('event')}>← Back to the event</button><div className="rw-registration-intro"><span className="rw-registration-kicker">AN INVITATION TO COME TOGETHER</span><h1>{returningGuest ? 'Welcome back.' : <>Your presence.<br/><em>A new chapter.</em></>}</h1><p>{title}</p></div><div className="rw-registration-art" aria-hidden="true"><div className="rw-registration-arch"><span>✧</span><i/><b>{(host || title).split(/\s+/).slice(0,2).map(w=>w[0]).join('')}</b></div><span className="rw-registration-art-caption">A MOMENT WORTH SHARING</span></div><div className="rw-registration-facts"><div><Icon name="calendar"/><span><small>WHEN WE GATHER</small><strong>{dateLabel}</strong>{timeLabel&&<span>{timeLabel}</span>}</span></div>{showVenue&&!venuePending&&<div><Icon name="pin"/><span><small>THE SETTING</small><strong>{venue}</strong></span></div>}</div><div className="rw-registration-note"><span>01 / YOUR INVITATION</span><p>A few details today.<br/>Everything you need, in one place.</p></div></aside><div className="rw-registration-workspace"><div className="rw-registration-welcome"><span>MAKE IT A DATE</span><h2>{returningGuest ? 'Your registration' : 'Let’s make it happen.'}</h2><p>Choose your place, add your details, and join us.</p></div><div className="rw-registration-content">{registration}</div></div></section> : <>
          {format !== 'compact' ? <RsvpFormatHero format={format} title={title} dateLabel={dateLabel} timeLabel={timeLabel} venueLabel={showVenue ? (venuePending ? 'Venue announcement coming soon' : venue) : ''} host={host} about={longIntroduction ? paragraphs[0] || about : about} config={config} cover={cover} coverPresentation={coverPresentation} registerLabel={registerLabel} deadline={deadline} onRegister={() => navigate('register')} onMore={() => navigate('more')} Icon={Icon}/> : <section className={`rw-hero rw-compact-hero ${cover ? 'rw-with-artwork' : 'rw-without-artwork'}`}><div>{config.hero?.showHost !== false && <span className="rw-eyebrow">{host || 'YOU’RE INVITED'}</span>}{config.hero?.showTitle !== false && <h1>{title}</h1>}{showAbout && <p className="rw-lead">{longIntroduction ? paragraphs[0] || about : about}</p>}<div className="rw-facts"><div><Icon name="calendar" /><span>{dateLabel}{timeLabel && <small>{timeLabel}</small>}</span></div>{showVenue && <div><Icon name="pin" /><span>{venuePending ? 'Venue announcement coming soon' : venue}</span></div>}</div><div className="rw-hero-actions"><button className="rw-btn rw-gold" onClick={() => navigate('register')}>{registerLabel}</button><button className="rw-text" onClick={() => navigate('more')}>Explore the event ↓</button></div>{deadline && <p className="rw-compact-deadline">RSVP deadline: {deadline}</p>}</div>{cover && <img className="rw-cover" onLoad={e => setWideCover(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight > 2)} src={cover} alt={coverPresentation.alt} style={coverPresentation.style} />}</section>}
          {showAbout && longIntroduction && <section className="rw-section rw-invitation-details"><details><summary>Read the full invitation</summary><p className="rw-lead">{about}</p></details></section>}
          {settings.sectionOrder.map(id => <Fragment key={id}>{sections[id]}</Fragment>)}

        </>}
      </main><footer className="rw-footer">{title} · Powered by Festio</footer>
      {screen !== 'register' && <nav className="rw-mobile-actions" aria-label="Registration actions"><button className="rw-btn rw-outline" onClick={() => returningGuest ? navigate('register') : setRecover(true)}>My GuestHub</button><button className="rw-btn rw-gold" onClick={() => navigate('register')}>{returningGuest ? 'My RSVP →' : 'Register →'}</button></nav>}
    </div>
    <dialog ref={dialog} onCancel={() => setRecover(false)} aria-labelledby="rw-dialog-title">
      <div className="rw-dialog-head"><h2 id="rw-dialog-title">Open your GuestHub</h2><button className="rw-close" aria-label="Close GuestHub dialog" onClick={() => setRecover(false)}>×</button></div>
      {recoveryState === 'sent' ? <div className="rw-recovery-success" role="status">
        <h3>Check your email</h3><p>If a registration matches, we’ll email its personal GuestHub link to the address saved on it. Check your inbox and spam folder.</p>
        <p>For a family registration, use the email of the person who registered you.</p>
        <button className="rw-btn rw-outline" onClick={() => { setRecoveryState('idle'); setRecoveryError('') }}>Use a different email</button>
      </div> : <>
        <p>Enter the email used for registration. We’ll send your personal GuestHub link there so you can open it securely.</p>
        <form onSubmit={requestGuestHub} aria-busy={recoveryState === 'sending'}>
          <label htmlFor="rw-recovery-email">Registration email</label>
          <input id="rw-recovery-email" type="email" autoComplete="email" maxLength={255} required value={recoveryEmail} disabled={recoveryState === 'sending'} onChange={e => setRecoveryEmail(e.target.value)} placeholder="you@example.com" />
          <details className="rw-recovery-names"><summary>Add your name to help find your registration (optional)</summary>
            <label htmlFor="rw-first-name">First name (optional)</label><input id="rw-first-name" autoComplete="given-name" maxLength={100} value={firstName} disabled={recoveryState === 'sending'} onChange={e => setFirstName(e.target.value)} />
            <label htmlFor="rw-last-name">Last name (optional)</label><input id="rw-last-name" autoComplete="family-name" maxLength={100} value={lastName} disabled={recoveryState === 'sending'} onChange={e => setLastName(e.target.value)} />
          </details>
          {recoveryError && <p role="alert">{recoveryError}</p>}
          <button className="rw-btn" type="submit" disabled={recoveryState === 'sending'}>{recoveryState === 'sending' ? 'Requesting link…' : 'Email my GuestHub link →'}</button>
        </form>
        <p className="rw-small">Verification is by email only. A name alone cannot open GuestHub. For a family registration, use the registrant’s email and name.</p>
      </>}
      <p className="rw-small">No access to your registration email? Contact the organizer using your invitation details.</p>
    </dialog>
  </div>
}
