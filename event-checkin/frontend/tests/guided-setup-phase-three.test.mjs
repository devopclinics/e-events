import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseThreeReadiness, selectedPhaseThreeRecipes } from '../src/pages/guidedSetupPhaseThreeModel.mjs'

test('phase three selects only relevant guest experience recipes', () => {
  assert.deepEqual(selectedPhaseThreeRecipes(['community']).map((row) => row.id), ['design', 'community'])
  assert.deepEqual(selectedPhaseThreeRecipes(['guesthub']).map((row) => row.id), ['design', 'guesthub'])
})

test('website is not complete while draft is newer than live release', () => {
  const result = phaseThreeReadiness({ selectedOutcomes: ['website'], design: { selected_template_id: 'modern' }, website: { published_release_id: 'release-1', draft_is_newer: true }, releases: [{}] })
  assert.equal(result.recipes.find((row) => row.id === 'website').complete, false)
})

test('published website reuses speaker and partner records', () => {
  const result = phaseThreeReadiness({ selectedOutcomes: ['website'], design: { selected_template_id: 'modern' }, progress: { phase3_design_review: 'completed' }, website: { published_release_id: 'release-1' }, speakers: [{ id: 's1' }], speakerSettings: { speaker_token: 'speaker-page' }, partners: [{ id: 'p1' }], partnerSettings: { partner_token: 'partner-page' } })
  assert.equal(result.recipes.find((row) => row.id === 'website').complete, true)
  assert.equal(result.recipes.find((row) => row.id === 'speakers').complete, true)
  assert.equal(result.recipes.find((row) => row.id === 'partners').complete, true)
})

test('GuestHub requires enablement and registered guest preview evidence', () => {
  const pending = phaseThreeReadiness({ selectedOutcomes: ['guesthub'], guestHubSettings: { guest_hub_enabled: true } })
  assert.equal(pending.recipes.find((row) => row.id === 'guesthub').complete, false)
  const complete = phaseThreeReadiness({ selectedOutcomes: ['guesthub'], guestHubSettings: { guest_hub_enabled: true }, progress: { phase3_guesthub_test: 'completed' } })
  assert.equal(complete.recipes.find((row) => row.id === 'guesthub').complete, true)
})

test('FestioMe requires an enabled event, a group and preview evidence', () => {
  const result = phaseThreeReadiness({ selectedOutcomes: ['community'], festiomeStatus: { enabled: true }, festiomeGroups: [{}], progress: { phase3_community_test: 'completed' } })
  assert.equal(result.recipes.find((row) => row.id === 'community').complete, true)
})

test('speakers and partners can be guided without an event website',()=>{assert.deepEqual(selectedPhaseThreeRecipes(['speakers','partners']).map(x=>x.id),['speakers','partners'])})
