import { finalizeReadiness } from './guideReadiness.mjs'
export const PHASE_SIX_PROGRESS_PREFIX = 'phase6_'

export const PHASE_SIX_RECIPES = [
  { id: 'results', number: '6.1', title: 'Review unified results', route: '/event-results-redesign', action: 'Open event results', description: 'Review registration, revenue, delivery, attendance, programme, engagement, operations, giving, feedback and exceptions before sharing or exporting.' },
  { id: 'closeout', number: '6.2', title: 'Close out the event', route: '/admin-redesign', action: 'Open event administration', description: 'Stop intake, close live operations, reconcile finance, complete delivery, send follow-up, export records and apply the public-page retention policy.' },
  { id: 'reuse', number: '6.3', title: 'Reuse a proven event', route: '/admin-redesign', action: 'Open event actions', description: 'Duplicate a source event with explicit dates, inspect copied modules, remove private data and run readiness on the new draft.' },
  { id: 'help', number: '6.4', title: 'Verify Help and Academy handoff', route: '/help-redesign', action: 'Open contextual Help', description: 'Confirm each procedure explains the action, expected result, common errors, next step and deeper learning without losing setup progress.' },
  { id: 'integrations', number: '6.5', title: 'Validate integrations', route: '/api-explorer-redesign', action: 'Open Integration Center', description: 'Review ownership and direction, least-privilege access, field mapping, connection health, sync history, retry and safe disable behavior.' },
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
    integrations: { notApplicable: integrationsConfigured === 0 && !dataFailures.some(f=>['apiKeys','webhooks'].includes(typeof f==='number'?['results','apiKeys','webhooks'][f]:f.key)), complete: checked(progress, 'integration_test'), blocked: false, evidence: `${keyRows.length} API key${keyRows.length === 1 ? '' : 's'} · ${webhookRows.length} webhook${webhookRows.length === 1 ? '' : 's'} · ${integrationsConfigured ? 'configured connection evidence available' : 'no external connection configured'} · ${checked(progress, 'integration_test') ? 'connection lifecycle tested' : 'test pending'}` },
  }
  const recipes = PHASE_SIX_RECIPES.map((recipe) => ({ ...recipe, ...states[recipe.id] }))
  const complete = recipes.filter((recipe) => recipe.complete).length
  const blocked = recipes.filter((recipe) => recipe.blocked).length
  return { ...finalizeReadiness(6, recipes, dataFailures) }
}
