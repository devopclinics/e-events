import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseTwoReadiness, selectedPhaseTwoRecipes } from '../src/pages/guidedSetupPhaseTwoModel.mjs'

test('phase two shows only recipes needed by selected outcomes', () => {
  assert.deepEqual(selectedPhaseTwoRecipes(['tickets']).map((row) => row.id), ['tickets', 'pass'])
  assert.deepEqual(selectedPhaseTwoRecipes(['communicate']).map((row) => row.id), ['channels', 'automation'])
})

test('RSVP remains blocked until an audience exists', () => {
  const result = phaseTwoReadiness({ event: { rsvp_enabled: true, rsvp_token: 'abc' }, progress: {}, selectedOutcomes: ['rsvp'] })
  assert.equal(result.recipes.find((row) => row.id === 'rsvp').blocked, true)
  assert.equal(result.next.id, 'audience')
})

test('ticket sales requires enabled config, active product, verified payout and test', () => {
  const result = phaseTwoReadiness({ selectedOutcomes: ['tickets'], progress: { phase2_ticket_test: 'completed' }, ticketConfig: { config: { enabled: true } }, ticketProducts: [{ active: true }], payoutAccounts: [{ status: 'verified' }] })
  assert.equal(result.recipes.find((row) => row.id === 'tickets').complete, true)
})

test('provider configuration without controlled test is not reported complete', () => {
  const result = phaseTwoReadiness({ event: { notify_email: true, channel_policy: { invitations: ['email'] } }, selectedOutcomes: ['communicate'], schedules: [{}] })
  assert.equal(result.recipes.find((row) => row.id === 'channels').complete, false)
  assert.equal(result.recipes.find((row) => row.id === 'automation').complete, false)
})

test('completed communication flow requires tests and live configuration', () => {
  const result = phaseTwoReadiness({ event: { notify_email: true, channel_policy: { invitations: ['email'] } }, selectedOutcomes: ['communicate'], schedules: [{}], progress: { phase2_channel_test: 'completed', phase2_automation_test: 'completed' } })
  assert.equal(result.complete, 2)
  assert.equal(result.blocked, 0)
})
