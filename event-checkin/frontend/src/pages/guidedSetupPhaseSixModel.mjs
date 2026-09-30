export const PHASE_SIX_PROGRESS_PREFIX = 'phase6_'

export const PHASE_SIX_RECIPES = [
  { id: 'results', number: '6.1', title: 'Review unified results', route: '/event-results-redesign', action: 'Open event results', description: 'Review registration, revenue, delivery, attendance, programme, engagement, operations, giving, feedback and exceptions before sharing or exporting.' },
  { id: 'closeout', number: '6.2', title: 'Close out the event', route: '/admin-redesign', action: 'Open event administration', description: 'Stop intake, close live operations, reconcile finance, complete delivery, send follow-up, export records and apply the public-page retention policy.' },
  { id: 'reuse', number: '6.3', title: 'Reuse a proven event', route: '/admin-redesign', action: 'Open event actions', description: 'Duplicate a source event with explicit dates, inspect copied modules, remove private data and run readiness on the new draft.' },
  { id: 'help', number: '6.4', title: 'Verify Help and Academy handoff', route: '/help-redesign', action: 'Open contextual Help', description: 'Confirm each procedure explains the action, expected result, common errors, next step and deeper learning without losing setup progress.' },
  { id: 'integrations', number: '6.5', title: 'Validate integrations', route: '/api-explorer-redesign', action: 'Open Integration Center', description: 'Review ownership and direction, least-privilege access, field mapping, connection health, sync history, retry and safe disable behavior.' },
  { id: 'platform', number: '6.6', title: 'Review platform operations', route: '/superadmin-redesign', action: 'Open platform operations', description: 'Verify organization access, plans, add-ons, operators, audit history, support access and guarded administrative actions.' },
  { id: 'media', number: '6.7', title: 'Audit reusable media', route: '/media-redesign', action: 'Open media library', description: 'Verify upload validation, organization ownership, usage references, safe replacement, archive behavior and reuse across supported surfaces.' },
  { id: 'analytics', number: '6.8', title: 'Review setup analytics', route: '/superadmin-redesign', action: 'Open platform analytics', description: 'Review time to first event, test and publish; recipe drop-off; blocker frequency; support demand; and test-to-live conversion.' },
  { id: 'rollout', number: '6.9', title: 'Complete controlled rollout review', route: '/superadmin-redesign', action: 'Open rollout controls', description: 'Verify tenant feature controls, monitoring, regression evidence, rollback rehearsal and pilot approval before wider production activation.' },
]

const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : [])
const checked = (progress, key) => progress?.[`${PHASE_SIX_PROGRESS_PREFIX}${key}`] === 'completed'
const hasResults = (results) => !!results && typeof results === 'object' && Object.keys(results).length > 0

export function phaseSixReadiness({ event, progress = {}, events = [], results = null, apiKeys = [], webhooks = [], dataFailures = [] }) {
  const eventRows = rows(events)
  const keyRows = rows(apiKeys)
  const webhookRows = rows(webhooks)
  const closed = ['ended', 'archived'].includes(String(event?.status || '').toLowerCase())
  const duplicateCandidateCount = eventRows.filter((item) => item.id !== event?.id).length
  const integrationsConfigured = keyRows.length + webhookRows.length
  const states = {
    results: { complete: hasResults(results) && checked(progress, 'results_review'), blocked: !hasResults(results), evidence: `${hasResults(results) ? 'Unified result data available' : 'No unified result snapshot available'} · ${checked(progress, 'results_review') ? 'review and export verified' : 'review pending'}` },
    closeout: { complete: closed && checked(progress, 'closeout_review'), blocked: !closed, evidence: `${event?.status || 'unknown'} event status · ${checked(progress, 'closeout_review') ? 'closeout checklist verified' : 'closeout checklist pending'}` },
    reuse: { complete: duplicateCandidateCount > 0 && checked(progress, 'reuse_test'), blocked: eventRows.length === 0, evidence: `${duplicateCandidateCount} other event${duplicateCandidateCount === 1 ? '' : 's'} available for comparison · ${checked(progress, 'reuse_test') ? 'safe duplication tested' : 'duplication test pending'}` },
    help: { complete: checked(progress, 'help_review'), blocked: false, evidence: checked(progress, 'help_review') ? 'procedure, errors and next-step handoff reviewed' : 'contextual Help review pending' },
    integrations: { complete: checked(progress, 'integration_test'), blocked: false, evidence: `${keyRows.length} API key${keyRows.length === 1 ? '' : 's'} · ${webhookRows.length} webhook${webhookRows.length === 1 ? '' : 's'} · ${integrationsConfigured ? 'configured connection evidence available' : 'no external connection configured'} · ${checked(progress, 'integration_test') ? 'connection lifecycle tested' : 'test pending'}` },
    platform: { complete: checked(progress, 'platform_review'), blocked: false, evidence: checked(progress, 'platform_review') ? 'privileged operations and audit controls reviewed' : 'superadmin review required' },
    media: { complete: checked(progress, 'media_review'), blocked: false, evidence: checked(progress, 'media_review') ? 'ownership, references and replacement tested' : 'media safety review pending' },
    analytics: { complete: checked(progress, 'analytics_review'), blocked: false, evidence: checked(progress, 'analytics_review') ? 'setup funnel and blocker metrics reviewed' : 'platform analytics review pending' },
    rollout: { complete: checked(progress, 'rollout_review'), blocked: false, evidence: checked(progress, 'rollout_review') ? 'monitoring, rollback and pilot approval recorded' : 'production rollout gate remains closed' },
  }
  const recipes = PHASE_SIX_RECIPES.map((recipe) => ({ ...recipe, ...states[recipe.id] }))
  const complete = recipes.filter((recipe) => recipe.complete).length
  const blocked = recipes.filter((recipe) => recipe.blocked).length
  return { recipes, complete, total: recipes.length, blocked, next: recipes.find((recipe) => !recipe.complete) || null, dataFailures }
}
