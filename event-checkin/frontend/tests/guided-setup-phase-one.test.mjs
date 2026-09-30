import assert from 'node:assert/strict'
import test from 'node:test'
import { OUTCOME_ENTITLEMENTS, PHASE_ONE_OUTCOMES, phaseOneReadiness, selectedOutcomeIds } from '../src/pages/guidedSetupPhaseOneModel.mjs'

const activeAccess = (addons = []) => ({ eventPass: { status: 'active' }, billing: { is_paid: true, configured: true, available_addons: addons }, userRole: 'admin' })

test('selected outcomes are derived only from completed server progress', () => {
  assert.deepEqual(selectedOutcomeIds({ outcome_rsvp: 'completed', outcome_live: 'skipped', unrelated: 'completed' }), ['rsvp'])
})

test('new event without outcomes is blocked at outcome selection', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago', venue_name: 'Hall' }, progress: {}, members: [], ...activeAccess() })
  assert.equal(result.next, 'outcomes')
  assert.equal(result.blockers, 1)
  assert.equal(result.completed, 2)
})

test('paid outcome without its authoritative add-on surfaces capability blocker', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago', venue_name: 'Hall' }, progress: { outcome_live: 'completed' }, members: [{ id: 'member' }], ...activeAccess() })
  assert.equal(result.entitlementBlocked, true)
  assert.deepEqual(result.blockedCapabilities, [{ id: 'live', addon: 'addon_engagement', allowed: false }])
  assert.equal(result.next, 'capabilities')
})

test('ready paid event with selected add-on proceeds to first workspace', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago', venue_address: '1 Main St' }, progress: { outcome_live: 'completed' }, members: [{ id: 'member' }], ...activeAccess(['addon_engagement']) })
  assert.equal(result.blockers, 0)
  assert.equal(result.next, 'workspace')
  assert.equal(result.completed, 4)
})

test('organization readiness blocks missing permission and unavailable provider', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago' }, progress: { outcome_live: 'completed' }, members: [], eventPass: { status: 'inactive' }, billing: { is_paid: false, configured: false, available_addons: [] }, userRole: 'guest' })
  assert.equal(result.organizationBlocked, true)
  assert.match(result.organizationReasons.join(' '), /role cannot manage/i)
  assert.match(result.organizationReasons.join(' '), /Billing is not configured/i)
})

test('outcomes use backend-compatible per-feature entitlement keys', () => {
  assert.equal(OUTCOME_ENTITLEMENTS.live, 'addon_engagement')
  assert.equal(OUTCOME_ENTITLEMENTS.experience, 'addon_experience')
  assert.equal(OUTCOME_ENTITLEMENTS.giving, 'addon_registry')
  assert.equal(OUTCOME_ENTITLEMENTS.website, null)
})

test('standalone service outcomes are selectable and route to their owning workspaces', () => {
  const byId = Object.fromEntries(PHASE_ONE_OUTCOMES.map((item) => [item.id, item]))
  for (const id of ['team', 'experience', 'live', 'speakers', 'partners', 'reminders', 'logistics', 'orders', 'access']) assert.ok(byId[id], `${id} outcome missing`)
  assert.equal(byId.experience.route, '/experience-redesign?tab=workflow')
  assert.equal(byId.orders.route, '/kitchen-redesign')
})
