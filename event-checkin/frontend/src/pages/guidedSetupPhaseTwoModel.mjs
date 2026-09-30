export const PHASE_TWO_PROGRESS_PREFIX = 'phase2_'

export const PHASE_TWO_RECIPES = [
  { id: 'audience', number: '2.1', title: 'Build the audience', outcome: 'rsvp', route: '/guests-redesign?tab=guests', action: 'Open audience workspace', description: 'Add guests manually or import a file, then resolve duplicates and warnings before sending anything.' },
  { id: 'rsvp', number: '2.2', title: 'Launch RSVP', outcome: 'rsvp', route: '/guests-redesign?tab=invite', action: 'Configure RSVP', description: 'Set access, deadline, capacity, questions and additional-guest rules, then preview and test the response.' },
  { id: 'tickets', number: '2.3', title: 'Launch ticket sales', outcome: 'tickets', route: '/ticketing-redesign', action: 'Open Ticket Sales', description: 'Connect payouts, create an active product, preview checkout and verify one controlled test order.' },
  { id: 'pass', number: '2.4', title: 'Issue Festio Passes', outcomes: ['rsvp', 'tickets'], route: '/design-studio-redesign?tab=Festio%20Pass', action: 'Design and test passes', description: 'Choose the pass design and delivery channels, then verify a named guest can open a valid QR pass.' },
  { id: 'channels', number: '2.5', title: 'Connect communication channels', outcome: 'communicate', route: '/communications-redesign?tab=settings', action: 'Review channel readiness', description: 'Enable only connected channels and send controlled tests before using them for event traffic.' },
  { id: 'automation', number: '2.6', title: 'Communicate with guests', outcomes: ['communicate', 'reminders'], route: '/communications-redesign?tab=scheduler', action: 'Configure communication', description: 'Prepare invitations, confirmations, reminders and follow-ups with routing, consent and schedules.' },
]

const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : [])
const done = (progress, key) => progress?.[`${PHASE_TWO_PROGRESS_PREFIX}${key}`] === 'completed'

export function selectedPhaseTwoRecipes(selectedOutcomes = []) {
  return PHASE_TWO_RECIPES.filter((recipe) => recipe.outcome
    ? selectedOutcomes.includes(recipe.outcome)
    : recipe.outcomes.some((outcome) => selectedOutcomes.includes(outcome)))
}

export function phaseTwoReadiness({ event = {}, progress = {}, selectedOutcomes = [], guests = [], questions = [], ticketConfig = null, ticketProducts = [], payoutAccounts = [], schedules = [], dataFailures = [] }) {
  const guestRows = rows(guests)
  const questionRows = rows(questions)
  const productRows = rows(ticketProducts)
  const payoutRows = rows(payoutAccounts)
  const scheduleRows = rows(schedules)
  const recipes = selectedPhaseTwoRecipes(selectedOutcomes)
  const hasAudience = guestRows.length > 0
  const duplicateCount = guestRows.filter((guest) => guest.duplicate_of_id || guest.possible_duplicate).length
  const rsvpConfigured = !!event.rsvp_enabled && !!event.rsvp_token
  const rsvpTested = done(progress, 'rsvp_test')
  const config = ticketConfig?.config || ticketConfig || {}
  const activeProducts = productRows.filter((product) => product.active !== false)
  const verifiedPayouts = payoutRows.filter((account) => ['verified', 'active', 'enabled', 'connected'].includes(String(account.status || '').toLowerCase()) || account.verified === true)
  const ticketConfigured = !!config.enabled && activeProducts.length > 0 && verifiedPayouts.length > 0
  const ticketTested = done(progress, 'ticket_test')
  const guestsWithPass = guestRows.filter((guest) => guest.qr_token || guest.invite_token || guest.ticket_token).length
  const passTested = done(progress, 'pass_test')
  const enabledChannels = ['email', 'sms', 'whatsapp'].filter((channel) => !!event[`notify_${channel}`])
  const channelTested = done(progress, 'channel_test')
  const routingConfigured = !!event.channel_policy && Object.keys(event.channel_policy).length > 0
  const automationConfigured = routingConfigured || scheduleRows.length > 0
  const automationTested = done(progress, 'automation_test')

  const stateById = {
    audience: { complete: hasAudience && duplicateCount === 0, blocked: false, evidence: hasAudience ? `${guestRows.length} guest${guestRows.length === 1 ? '' : 's'} · ${duplicateCount ? `${duplicateCount} possible duplicate${duplicateCount === 1 ? '' : 's'} to review` : 'no duplicate flags'}` : 'No audience records yet' },
    rsvp: { complete: rsvpConfigured && rsvpTested, blocked: !hasAudience, evidence: `${rsvpConfigured ? `Public link ready · ${questionRows.length} custom question${questionRows.length === 1 ? '' : 's'}` : 'RSVP settings or public link incomplete'} · ${rsvpTested ? 'test verified' : 'test pending'}` },
    tickets: { complete: ticketConfigured && ticketTested, blocked: !config.enabled || !verifiedPayouts.length, evidence: `${activeProducts.length} active product${activeProducts.length === 1 ? '' : 's'} · ${verifiedPayouts.length} verified payout account${verifiedPayouts.length === 1 ? '' : 's'} · ${ticketTested ? 'test verified' : 'test pending'}` },
    pass: { complete: guestsWithPass > 0 && passTested, blocked: !hasAudience && !activeProducts.length, evidence: `${guestsWithPass} guest${guestsWithPass === 1 ? '' : 's'} with pass credentials · ${passTested ? 'delivery verified' : 'delivery test pending'}` },
    channels: { complete: enabledChannels.length > 0 && channelTested, blocked: enabledChannels.length === 0, evidence: `${enabledChannels.length ? enabledChannels.join(', ') : 'No delivery channel enabled'} · ${channelTested ? 'controlled test verified' : 'controlled test pending'}` },
    automation: { complete: automationConfigured && automationTested, blocked: enabledChannels.length === 0, evidence: `${routingConfigured ? 'routing saved' : 'routing not saved'} · ${scheduleRows.length} scheduled communication${scheduleRows.length === 1 ? '' : 's'} · ${automationTested ? 'test verified' : 'test pending'}` },
  }
  const visible = recipes.map((recipe) => ({ ...recipe, ...stateById[recipe.id] }))
  const complete = visible.filter((recipe) => recipe.complete).length
  const blocked = visible.filter((recipe) => recipe.blocked).length
  const next = visible.find((recipe) => !recipe.complete) || null
  return { recipes: visible, complete, total: visible.length, blocked, next, enabledChannels, dataFailures }
}
