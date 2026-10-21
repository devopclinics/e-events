export const CONTEXTS = {
  "/admin-redesign": [
    "Event",
    "Event overview",
    "Review this event and continue its setup checklist. Use Events to choose a different event."
  ],
  "/setup-redesign": [
    "Event",
    "Setup checklist",
    "Create the event once, then return here to complete outstanding tasks. Configuration pages save the same event; they do not create another event."
  ],
  "/design-studio-redesign": [
    "Event",
    "Guest design",
    "RSVP is the registration page; GuestHub is personal to each guest; My Pass contains admission details. Save keeps a draft. Publish design updates the selected guest surfaces, not the independently published website."
  ],
  "/design-studio-redesign/website": [
    "Event",
    "Public event website",
    "This website has its own draft and published version. After changing source event details, review source changes and publish the website separately. Custom website edits are preserved until you choose to replace them."
  ],
  "/guest-experience": [
    "Event",
    "Guest experience",
    "Check the audience, destination and publication state of each guest-facing surface before sharing links."
  ],
  "/guests-redesign": [
    "Event",
    "Guests and registration",
    "Manage the shared guest list and invitations. Registration or RSVP records a response; admission is recorded separately at check-in."
  ],
  "/kitchen-redesign": [
    "Event-day operations",
    "Kitchen orders",
    "Use this queue to prepare and deliver orders. Configure menus separately. A meal attendance mark counts a guest; it does not create an order or mark one delivered."
  ],
  "/guest-services": [
    "Event-day operations",
    "Guest Services",
    "Table managers work with assigned tables and guests. Event admission, room entry, meal attendance and order delivery are separate records; choose the action that matches the service."
  ],
  "/scanner-redesign": [
    "Event-day operations",
    "Admission scanner",
    "Event admission checks a guest into the event. Room entry/exit updates room occupancy. Use Guest Services for meal attendance; those marks are separate from entrance and room scans. Confirm the scan purpose before using a pass."
  ],
  "/checkin-redesign": [
    "Event configuration",
    "Venue access settings",
    "Configure room and zone access here. Open the live scanner to record entry and exit; those scans are separate from event admission and meal headcounts."
  ],
  "/conference-center": [
    "Event configuration",
    "Conference operations",
    "Manage submissions, tracks and operational coordination here. Speakers and partners are shared event records; review imports in the website editor before republishing public profiles or programme details."
  ],
  "/addons-redesign": [
    "Event configuration",
    "Services setup",
    "Configure the services enabled for this event. Guest Services and Kitchen orders are the event-day workspaces for delivering those services."
  ],
  "/communications-redesign": [
    "Event",
    "Guest communications",
    "These messages go to this event\u2019s guests. Festio client-onboarding emails are managed separately by the authorised Marketing team."
  ],
  "/team-redesign": [
    "Event",
    "Team and tasks",
    "Team and event tasks apply to the selected event. My Tasks shows your assigned work across events; it does not grant additional event access."
  ],
  "/help-redesign": [
    "Help",
    "Help and reference",
    "Find task instructions here. Setup checklist guides your current event; Academy provides training. Reading an article does not change your product permissions."
  ],
  "/training": [
    "Learning",
    "Academy",
    "Learn and practise event workflows here. Use Help for feature reference and Setup checklist to configure your actual event."
  ],
  "/event-results-redesign": [
    "Event",
    "Results and closeout",
    "Review RSVP, admission and service records separately. A guest\u2019s admission does not prove that a meal or other service was delivered."
  ],
  "/events-redesign": [
    "Organisation",
    "Your events",
    "Choose an event before changing its guests, content or operations. Organisation settings and shared integrations are managed separately."
  ],
  "/superadmin-redesign": [
    "Platform",
    "Platform administration",
    "Platform-wide tools are restricted to authorised administrators. Check the target organisation and event before applying a change."
  ],
  "/media-redesign": [
    "Platform",
    "Platform media",
    "Manage platform presentation assets here. Event artwork belongs in that event\u2019s Design Studio."
  ]
}
export function workspaceContext(pathname, search = '') {
  if (pathname === '/organisation') return ['Organisation', 'Organisation overview', 'Choose profile, people, event access and wallet, or integration subscription. These are separate destinations with different scopes.']
  if (pathname === '/team-redesign' && new URLSearchParams(search).get('tab') === 'mytasks') return ['Personal', 'My Tasks', 'Your assigned tasks across events. Open a task to work in its event context; assignments do not grant additional permissions.']
  if (pathname === '/billing-redesign') return new URLSearchParams(search).get('tab') === 'org'
    ? ['Organisation', 'Organisation settings', 'Team, API access and the integration subscription apply to the organisation. The integration subscription is separate from Event Passes and messaging credits.']
    : ['Billing', 'Event access and messaging', 'An Event Pass activates this event. Messaging credits use the wallet scope shown in the ledger. An integration subscription is a separate recurring organisation purchase.']
  return CONTEXTS[pathname] || null
}
