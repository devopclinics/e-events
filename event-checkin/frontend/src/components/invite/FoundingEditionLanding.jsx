import { useEffect, useRef, useState } from 'react'
import './FoundingEditionLanding.css'

/** Opt-in artwork-led invitation; registration remains the event's real RSVP flow. */
export default function FoundingEditionLanding({ event, config, registration, response, preview = false }) {
  const dialog = useRef(null)
  const [open, setOpen] = useState(false)
  const completed = !!response && ['confirmed', 'pending', 'waitlisted', 'declined'].includes(response.rsvp_status)
  const pendingDate = config.datePending !== false
  const email = config.contactEmail || 'support@nigerianhub.com'

  useEffect(() => {
    const element = dialog.current
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  useEffect(() => {
    const previous = document.title
    document.title = `${event.name} · Free RSVP`
    return () => { document.title = previous }
  }, [event.name])

  const responseTitle = response?.rsvp_status === 'waitlisted' ? "You're on the waitlist."
    : response?.rsvp_status === 'pending' ? 'Your RSVP has been received.'
      : response?.rsvp_status === 'declined' ? 'Your response has been saved.'
        : "You're on the guest list."

  return <main className="founding-page">
    <article className="founding-artwork" aria-label={`${event.name} invitation`}>
      <header className="founding-heading">
        <div className="founding-rule" aria-hidden="true" />
        <p className="founding-edition">{config.edition || 'Houston / Founding Edition'}</p>
        <h1>{config.titleLine1 || 'Nigerian Hub'}<br />{config.titleLine2 || 'Connections'}</h1>
        <p className="founding-tagline">{config.tagline || 'Meet. Engage. Discover. Connect.'}</p>
        <p className="founding-intro">{config.intro || 'Our first in-person networking event in Greater Houston'}</p>
      </header>
      <img className="founding-photo" src={event.invite_cover_image || '/events/nigerian-hub/houston-connections.png'}
        alt="Five Nigerian professionals connecting at a Houston networking gathering" fetchPriority="high" />
      <section className="founding-details" aria-label="Event details">
        <div className="founding-cta-row">
          <h2>{config.invitation || 'Be one of the first 50'}</h2>
          <button type="button" className="founding-rsvp" onClick={() => setOpen(true)}>{completed ? 'YOUR RSVP' : 'FREE RSVP'}</button>
        </div>
        <p className="founding-programme">{config.programme || '90 minutes of guided conversation, then open networking.'}</p>
        <p className="founding-schedule">{pendingDate ? 'Date & venue announced soon.' : config.schedule}<br />{config.updates || 'Watch this group for updates.'}</p>
      </section>
      <footer className="founding-vendor">
        <h2>Interested in showcasing your business as a vendor?</h2>
        <p>Message a group admin or email <a href={`mailto:${email}`}>{email}</a></p>
      </footer>
    </article>
    <dialog className="founding-dialog" ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-labelledby="founding-rsvp-heading">
      <button className="founding-close" type="button" onClick={() => setOpen(false)} aria-label="Close RSVP form">×</button>
      <p className="founding-dialog-edition">Houston / Founding Edition</p>
      <h2 id="founding-rsvp-heading">{completed ? responseTitle : 'Reserve your place'}</h2>
      <p className="founding-dialog-intro">{event.name} · Free RSVP</p>
      {pendingDate && <p className="founding-date-note">Date & venue announced soon. Watch this group for updates.</p>}
      {completed && pendingDate ? <div className="founding-response" role="status">
        <p>Thank you{response.first_name ? `, ${response.first_name}` : ''}. {response.rsvp_status === 'waitlisted' ? 'The first 50 places have been claimed. Your waitlist response has been saved.' : response.rsvp_status === 'declined' ? 'We appreciate you letting us know.' : 'Your response has been saved for the Houston founding edition.'}</p>
        <p>For questions, contact <a href={`mailto:${email}`}>{email}</a>.</p>
        <button type="button" className="founding-done" onClick={() => setOpen(false)}>Done</button>
      </div> : preview ? <p className="founding-response" role="status">Design preview. RSVPs are disabled in this preview.</p> : registration}
    </dialog>
  </main>
}
