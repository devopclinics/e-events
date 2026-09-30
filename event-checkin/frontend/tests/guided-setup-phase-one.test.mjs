import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseOneReadiness, selectedOutcomeIds } from '../src/pages/guidedSetupPhaseOneModel.mjs'

test('selected outcomes are derived only from completed server progress', () => {
  assert.deepEqual(selectedOutcomeIds({ outcome_rsvp: 'completed', outcome_live: 'skipped', unrelated: 'completed' }), ['rsvp'])
})

test('new event without outcomes is blocked at outcome selection', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago', venue_name: 'Hall', is_paid: false }, progress: {}, members: [] })
  assert.equal(result.next, 'outcomes')
  assert.equal(result.blockers, 1)
  assert.equal(result.completed, 2)
})

test('paid outcome on unpaid event surfaces capability blocker', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago', venue_name: 'Hall', is_paid: false }, progress: { outcome_live: 'completed' }, members: [{ id: 'member' }] })
  assert.equal(result.entitlementBlocked, true)
  assert.deepEqual(result.gatedSelections, ['live'])
  assert.equal(result.next, 'capabilities')
})

test('ready paid event proceeds to first selected workspace', () => {
  const result = phaseOneReadiness({ event: { name: 'Demo', event_date: '2026-12-01T18:00:00Z', timezone: 'America/Chicago', venue_address: '1 Main St', is_paid: true }, progress: { outcome_live: 'completed' }, members: [{ id: 'member' }], eventPass: { active: true } })
  assert.equal(result.blockers, 0)
  assert.equal(result.next, 'workspace')
  assert.equal(result.completed, 4)
})
