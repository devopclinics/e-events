import { Link } from 'react-router-dom'
import RedesignShell from './redesign/RedesignShell'
const destinations = [
  ['Organisation details', 'Profile, account settings and shared organisation configuration.', '/billing-redesign?tab=org'],
  ['People & permissions', 'Organisation membership and roles. Event assignments are managed in the event’s Team workspace.', '/billing-redesign?tab=org#org-team'],
  ['Event access & messaging wallet', 'Choose an event to review its Event Pass and messaging activity. The credit ledger states whether the available balance belongs to the organisation or event.', '/billing-redesign?tab=billing'],
  ['Integrations & subscription', 'Recurring integration access and read-write API keys for this organisation. This subscription does not purchase an Event Pass.', '/billing-redesign?tab=org#org-subscription'],
]
export default function OrganisationOverview() {
  return <RedesignShell topActive="org"><header className="rr-pagehead"><div><div className="rr-title-row"><h1>Organisation</h1></div><p>Manage the organisation behind your events. Each purchase and permission below has a specific scope.</p></div></header><div className="guest-surface-grid">{destinations.map(([name, description, to]) => <article key={to}><h2>{name}</h2><p>{description}</p><Link to={to}>Open {name.toLowerCase()} →</Link></article>)}</div></RedesignShell>
}
