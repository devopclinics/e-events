export const OUTCOME_PREFIX = 'outcome_'

export const PHASE_ONE_OUTCOMES = [
  { id: 'rsvp', icon: 'send', label: 'Collect RSVPs', description: 'Invite guests, collect responses and manage approvals.', phase: 2, route: '/guests-redesign?tab=invite' },
  { id: 'tickets', icon: 'ticket', label: 'Sell tickets', description: 'Configure paid admission, checkout, passes and orders.', phase: 2, route: '/ticketing-redesign' },
  { id: 'website', icon: 'palette', label: 'Publish an event website', description: 'Create a branded public home for this event.', phase: 3, route: '/design-studio-redesign/website' },
  { id: 'communicate', icon: 'message', label: 'Communicate with guests', description: 'Set up channels, invitations, reminders and broadcasts.', phase: 2, route: '/communications-redesign?tab=settings' },
  { id: 'guesthub', icon: 'layers', label: 'Launch GuestHub', description: 'Give registered guests one place for their pass and event.', phase: 3, route: '/design-studio-redesign?tab=guesthub' },
  { id: 'community', icon: 'chat', label: 'Build a guest community', description: 'Configure FestioMe groups, conversations and discovery.', phase: 3, route: '/festiome-redesign' },
  { id: 'speakers', icon: 'users', label: 'Manage speakers', description: 'Create reusable speaker profiles, assignments and public listings.', phase: 3, route: '/addons-redesign?tab=speakers' },
  { id: 'partners', icon: 'users', label: 'Manage partners and exhibitors', description: 'Coordinate sponsors, exhibitors, deliverables and public listings.', phase: 3, route: '/addons-redesign?tab=partners' },
  { id: 'reminders', icon: 'clock', label: 'Schedule reminders', description: 'Prepare event reminders, follow-ups and delivery schedules.', phase: 2, route: '/communications-redesign?tab=scheduler' },
  { id: 'team', icon: 'team', label: 'Manage the event team', description: 'Invite collaborators, assign roles, permissions, ownership and tasks.', phase: 4, route: '/team-redesign?tab=team' },
  { id: 'operations', icon: 'book', label: 'Plan event operations', description: 'Coordinate budget, vendors, tasks, timeline and runsheet.', phase: 4, route: '/planner-redesign' },
  { id: 'experience', icon: 'barchart', label: 'Build guest experiences', description: 'Create programme workflows, journeys, consent and staff actions.', phase: 4, route: '/experience-redesign?tab=workflow' },
  { id: 'logistics', icon: 'upload', label: 'Manage logistics and deliveries', description: 'Track vendors, packing lists, dispatch and delivery status.', phase: 4, route: '/addons-redesign?tab=logistics' },
  { id: 'seating', icon: 'chair', label: 'Plan seating and meals', description: 'Create floor plans, tables, assignments and order choices.', phase: 4, route: '/addons-redesign?tab=seating' },
  { id: 'orders', icon: 'card', label: 'Manage meals and orders', description: 'Configure guest selections, kitchen operations and fulfillment.', phase: 4, route: '/kitchen-redesign' },
  { id: 'checkin', icon: 'ticket', label: 'Run check-in and access', description: 'Prepare passes, zones, gates, devices and walk-ins.', phase: 4, route: '/checkin-redesign' },
  { id: 'access', icon: 'ticket', label: 'Control venue access', description: 'Configure access zones, gates, credentials and capacity rules.', phase: 4, route: '/checkin-redesign?tab=zones' },
  { id: 'giving', icon: 'image', label: 'Collect gifts or donations', description: 'Publish giving options and reconcile contributions.', phase: 4, route: '/addons-redesign?tab=registry' },
  { id: 'conference', icon: 'mic', label: 'Build a conference programme', description: 'Manage calls, tracks, sessions, speakers and exhibitors.', phase: 5, route: '/conference-center' },
  { id: 'live', icon: 'barchart', label: 'Run Festio Live', description: 'Create activities, prepare presenters and operate displays.', phase: 5, route: '/live-redesign' },
  { id: 'certificates', icon: 'file', label: 'Issue certificates', description: 'Design, qualify, issue and verify digital certificates.', phase: 5, route: '/live-redesign?tab=certificates' },
]

export const PAID_OUTCOME_IDS = new Set(['website', 'community', 'speakers', 'partners', 'operations', 'experience', 'logistics', 'seating', 'orders', 'checkin', 'access', 'giving', 'conference', 'live', 'certificates'])

// Keep this mapping aligned with backend/app/entitlements.py FEATURE_ADDON.
// A null value means the outcome needs an active Event Pass but no separate
// add-on. Outcomes absent from the map are available without paid access.
export const OUTCOME_ENTITLEMENTS = {
  website: null,
  community: 'addon_festiome',
  speakers: 'addon_speakers',
  partners: 'addon_partners',
  operations: 'addon_planner',
  experience: 'addon_experience',
  logistics: 'addon_logistics',
  seating: 'addon_seating',
  orders: 'addon_menu',
  checkin: null,
  access: 'addon_venue_access',
  giving: 'addon_registry',
  conference: null,
  live: 'addon_engagement',
  certificates: 'addon_engagement',
}

export function selectedOutcomeIds(steps = {}) {
  return PHASE_ONE_OUTCOMES
    .filter((item) => steps[`${OUTCOME_PREFIX}${item.id}`] === 'completed')
    .map((item) => item.id)
}

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== ''

export function phaseOneReadiness({ event, progress = {}, members = [], eventPass = null, billing = null, userRole = '', optionalFailures = 0 }) {
  const selected = selectedOutcomeIds(progress)
  const foundationComplete = hasValue(event?.name) && hasValue(event?.event_date) && hasValue(event?.timezone)
  const venueComplete = hasValue(event?.venue_name) || hasValue(event?.venue_address)
  const teamComplete = Array.isArray(members) && members.length > 0
  const outcomesComplete = selected.length > 0
  const gatedSelections = selected.filter((id) => PAID_OUTCOME_IDS.has(id))
  const availableAddons = new Set(billing?.available_addons || [])
  const passActive = billing?.is_paid === true && (!eventPass?.status || eventPass.status === 'active')
  const capabilityChecks = gatedSelections.map((id) => {
    const addon = OUTCOME_ENTITLEMENTS[id]
    return { id, addon, allowed: passActive && (addon === null || availableAddons.has(addon)) }
  })
  const blockedCapabilities = capabilityChecks.filter((check) => !check.allowed)
  const entitlementBlocked = blockedCapabilities.length > 0
  const roleAllowed = ['admin', 'event_manager'].includes(userRole)
  const providerReady = billing?.configured === true
  const organizationReasons = []
  if (!roleAllowed) organizationReasons.push('Your role cannot manage event setup.')
  if (!eventPass || !billing) organizationReasons.push('Billing and Event Pass status could not be verified.')
  if (blockedCapabilities.length > 0 && !providerReady) organizationReasons.push('Billing is not configured to activate missing capabilities.')
  if (optionalFailures > 0) organizationReasons.push('One or more readiness services could not be reached.')
  const organizationBlocked = organizationReasons.length > 0
  const facts = [foundationComplete, venueComplete, teamComplete, outcomesComplete]
  const completed = facts.filter(Boolean).length
  const blockers = Number(!foundationComplete) + Number(!outcomesComplete) + Number(entitlementBlocked) + Number(organizationBlocked)
  const next = !foundationComplete ? 'event'
    : !outcomesComplete ? 'outcomes'
      : !teamComplete ? 'team'
        : entitlementBlocked ? 'capabilities'
          : 'workspace'
  return { selected, foundationComplete, venueComplete, teamComplete, outcomesComplete, gatedSelections, capabilityChecks, blockedCapabilities, entitlementBlocked, passActive, providerReady, organizationReasons, organizationBlocked, completed, total: facts.length, blockers, next, organizationReadable: !organizationBlocked }
}
