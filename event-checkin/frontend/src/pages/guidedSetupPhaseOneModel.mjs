export const OUTCOME_PREFIX = 'outcome_'

export const PHASE_ONE_OUTCOMES = [
  { id: 'rsvp', icon: 'send', label: 'Collect RSVPs', description: 'Invite guests, collect responses and manage approvals.', phase: 2, route: '/guests-redesign?tab=invite' },
  { id: 'tickets', icon: 'ticket', label: 'Sell tickets', description: 'Configure paid admission, checkout, passes and orders.', phase: 2, route: '/ticketing-redesign' },
  { id: 'website', icon: 'palette', label: 'Publish an event website', description: 'Create a branded public home for this event.', phase: 3, route: '/design-studio-redesign/website' },
  { id: 'communicate', icon: 'message', label: 'Communicate with guests', description: 'Set up channels, invitations, reminders and broadcasts.', phase: 2, route: '/communications-redesign?tab=settings' },
  { id: 'guesthub', icon: 'layers', label: 'Launch GuestHub', description: 'Give registered guests one place for their pass and event.', phase: 3, route: '/design-studio-redesign?tab=guesthub' },
  { id: 'community', icon: 'chat', label: 'Build a guest community', description: 'Configure FestioMe groups, conversations and discovery.', phase: 3, route: '/festiome-redesign' },
  { id: 'operations', icon: 'book', label: 'Plan event operations', description: 'Coordinate budget, vendors, tasks, timeline and runsheet.', phase: 4, route: '/planner-redesign' },
  { id: 'seating', icon: 'chair', label: 'Plan seating and meals', description: 'Create floor plans, tables, assignments and order choices.', phase: 4, route: '/addons-redesign?tab=seating' },
  { id: 'checkin', icon: 'ticket', label: 'Run check-in and access', description: 'Prepare passes, zones, gates, devices and walk-ins.', phase: 4, route: '/checkin-redesign' },
  { id: 'giving', icon: 'image', label: 'Collect gifts or donations', description: 'Publish giving options and reconcile contributions.', phase: 4, route: '/addons-redesign?tab=registry' },
  { id: 'conference', icon: 'mic', label: 'Build a conference programme', description: 'Manage calls, tracks, sessions, speakers and exhibitors.', phase: 5, route: '/conference-center' },
  { id: 'live', icon: 'barchart', label: 'Run Festio Live', description: 'Create activities, prepare presenters and operate displays.', phase: 5, route: '/live-redesign' },
  { id: 'certificates', icon: 'file', label: 'Issue certificates', description: 'Design, qualify, issue and verify digital certificates.', phase: 5, route: '/live-redesign?tab=certificates' },
]

export const PAID_OUTCOME_IDS = new Set(['website', 'community', 'operations', 'seating', 'checkin', 'giving', 'conference', 'live', 'certificates'])

export function selectedOutcomeIds(steps = {}) {
  return PHASE_ONE_OUTCOMES
    .filter((item) => steps[`${OUTCOME_PREFIX}${item.id}`] === 'completed')
    .map((item) => item.id)
}

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== ''

export function phaseOneReadiness({ event, progress = {}, members = [], eventPass = null, optionalFailures = 0 }) {
  const selected = selectedOutcomeIds(progress)
  const foundationComplete = hasValue(event?.name) && hasValue(event?.event_date) && hasValue(event?.timezone)
  const venueComplete = hasValue(event?.venue_name) || hasValue(event?.venue_address)
  const teamComplete = Array.isArray(members) && members.length > 0
  const outcomesComplete = selected.length > 0
  const gatedSelections = selected.filter((id) => PAID_OUTCOME_IDS.has(id))
  const entitlementBlocked = gatedSelections.length > 0 && !event?.is_paid
  const facts = [foundationComplete, venueComplete, teamComplete, outcomesComplete]
  const completed = facts.filter(Boolean).length
  const blockers = Number(!foundationComplete) + Number(!outcomesComplete) + Number(entitlementBlocked)
  const next = !foundationComplete ? 'event'
    : !outcomesComplete ? 'outcomes'
      : !teamComplete ? 'team'
        : entitlementBlocked ? 'capabilities'
          : 'workspace'
  return { selected, foundationComplete, venueComplete, teamComplete, outcomesComplete, gatedSelections, entitlementBlocked, completed, total: facts.length, blockers, next, organizationReadable: !!eventPass && optionalFailures === 0 }
}
