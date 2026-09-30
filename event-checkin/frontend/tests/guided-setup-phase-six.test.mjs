import test from 'node:test'
import assert from 'node:assert/strict'
import { PHASE_SIX_RECIPES, phaseSixReadiness } from '../src/pages/guidedSetupPhaseSixModel.mjs'

const base = { event: { id: 'event-1', status: 'active' }, progress: {}, events: [{ id: 'event-1', status: 'active' }], results: null, apiKeys: [], webhooks: [] }

test('phase six exposes the organizer closeout sequence only', () => {
  const state = phaseSixReadiness(base)
  assert.equal(state.total, 5)
  assert.deepEqual(state.recipes.map((item) => item.number), ['6.1', '6.2', '6.3', '6.4', '6.5'])
  assert.equal(PHASE_SIX_RECIPES.at(-1).id, 'integrations')
  assert.equal(state.recipes.some((item) => ['platform', 'media', 'analytics', 'rollout'].includes(item.id)), false)
})

test('results require live result data and an explicit review', () => {
  assert.equal(phaseSixReadiness(base).recipes[0].blocked, true)
  const state = phaseSixReadiness({ ...base, results: { attendance: { confirmed: 10 } }, progress: { phase6_results_review: 'completed' } })
  assert.equal(state.recipes[0].complete, true)
})

test('event closeout requires ended or archived status', () => {
  const active = phaseSixReadiness({ ...base, progress: { phase6_closeout_review: 'completed' } }).recipes.find((item) => item.id === 'closeout')
  assert.equal(active.complete, false)
  assert.equal(active.blocked, true)
  const ended = phaseSixReadiness({ ...base, event: { id: 'event-1', status: 'ended' }, progress: { phase6_closeout_review: 'completed' } }).recipes.find((item) => item.id === 'closeout')
  assert.equal(ended.complete, true)
})

test('reuse reports comparison evidence without duplicating event records', () => {
  const state = phaseSixReadiness({ ...base, events: [...base.events, { id: 'event-2', status: 'draft' }], progress: { phase6_reuse_test: 'completed' } })
  const reuse = state.recipes.find((item) => item.id === 'reuse')
  assert.equal(reuse.complete, true)
  assert.match(reuse.evidence, /1 other event/)
})

test('integration review reports API keys and webhooks independently', () => {
  const state = phaseSixReadiness({ ...base, apiKeys: [{ id: 'key-1' }], webhooks: [{ id: 'hook-1' }], progress: { phase6_integration_test: 'completed' } })
  const integrations = state.recipes.find((item) => item.id === 'integrations')
  assert.equal(integrations.complete, true)
  assert.match(integrations.evidence, /1 API key/)
  assert.match(integrations.evidence, /1 webhook/)
})
