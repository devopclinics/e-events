import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import RedesignShell from './redesign/RedesignShell'
import { safeWebsiteLink, designPublication, websitePublication } from './guestSurfaceStatus.mjs'
export default function GuestExperienceOverview() {
  const [eventId] = useCurrentEvent()
  const { event } = useEventDetails(eventId)
  const [state, setState] = useState({ eventId: null, loading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    if (!eventId) return
    setState({ eventId, loading: true })
    Promise.allSettled([api.getEventDesign(eventId), api.website(eventId)]).then(([design, website]) => {
      if (alive) setState({ eventId, loading: false, design: design.status === 'fulfilled' ? design.value : null, website: website.status === 'fulfilled' ? website.value : null, designError: design.status === 'rejected' ? design.reason.message : '', websiteError: website.status === 'rejected' ? website.reason.message : '' })
    })
    return () => { alive = false }
  }, [eventId, retry])
  const current = state.eventId === eventId ? state : { loading: true }
  const external = safeWebsiteLink(event?.external_website_url)
  const hosted = safeWebsiteLink(current.website?.public_url)
  return <RedesignShell topActive="guestoverview" eventScoped><header className="rr-pagehead"><div><div className="rr-title-row"><h1>Guest experience overview</h1></div><p>Choose the surface to edit, preview or share. Each guest receives a personal GuestHub link; a public website link is different.</p></div></header>{!eventId ? <p>Select an event to view its guest experience.</p> : current.loading ? <p role="status">Loading saved publication status…</p> : <><div className="guest-surface-grid"><article><h2>Event website</h2><p>Public information for visitors and prospective guests.</p><p className="guest-surface-status">{external ? 'External website connected · Festio does not publish changes to that site' : websitePublication(current.website)}</p>{current.websiteError && <p role="status">Hosted website status could not load: {current.websiteError}</p>}<nav><Link to="/design-studio-redesign/website">Manage website</Link>{(external || hosted) && <a href={external || hosted} target="_blank" rel="noopener noreferrer">Open {external ? 'external' : 'published'} website ↗</a>}</nav></article><article><h2>Registration / RSVP</h2><p>The page where prospective or invited guests respond. Ticket purchases follow the event’s configured registration flow.</p><p className="guest-surface-status">{designPublication(current.design)}</p>{current.designError && <p role="status">Design status could not load: {current.designError}</p>}<nav><Link to="/design-studio-redesign">Edit registration design</Link><Link to="/guests-redesign?tab=invite">Invitations & registration</Link></nav></article><article><h2>Personal GuestHub</h2><p>Passes, party members, programme, messages and enabled services for an individual guest. Share the guest’s invitation link, not someone else’s personal link.</p><p className="guest-surface-status">Uses the published event design · {designPublication(current.design)}</p><nav><Link to="/design-studio-redesign?surface=hub">Edit GuestHub design</Link><Link to="/guests-redesign?tab=guests">Manage guest links</Link></nav></article></div><section className="rr-panel guest-publication-checklist" style={{ padding: 22, marginTop: 20 }}><h2>Before sharing an update</h2><ol><li>Confirm this event’s date, time, timezone and venue.</li><li>Save and publish the guest design for registration and GuestHub.</li><li>Review source changes in the website editor, keep intentional custom edits, then publish the website separately.</li><li>Open the actual guest-facing pages on desktop and phone. Check the registration or payment action as well as its wording.</li></ol><button className="rr-btn secondary" onClick={() => setRetry(v => v + 1)}>Refresh publication status</button></section></>}</RedesignShell>
}
