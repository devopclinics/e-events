import assert from 'node:assert/strict'
import test from 'node:test'
import {phaseFourReadiness,selectedPhaseFourRecipes} from '../src/pages/guidedSetupPhaseFourModel.mjs'
test('phase four selects recipes by requested operations',()=>{assert.deepEqual(selectedPhaseFourRecipes(['checkin']).map(x=>x.id),['access','checkin']);assert.deepEqual(selectedPhaseFourRecipes(['giving']).map(x=>x.id),['gifts','giving','finance'])})
test('venue access requires zones gates and credential rehearsal',()=>{const r=phaseFourReadiness({selectedOutcomes:['checkin'],zones:[{}],gates:[{}],progress:{phase4_access_test:'completed'}});assert.equal(r.recipes.find(x=>x.id==='access').complete,true)})
test('check-in is not complete without pass credentials and multi-device rehearsal',()=>{const r=phaseFourReadiness({selectedOutcomes:['checkin'],guests:[{qr_token:'qr'}]});assert.equal(r.recipes.find(x=>x.id==='checkin').complete,false)})
test('giving requires a campaign channel and verified test contribution',()=>{const r=phaseFourReadiness({selectedOutcomes:['giving'],campaign:{enabled:true,payment_channels:[{type:'zelle'}]},progress:{phase4_giving_test:'completed'}});assert.equal(r.recipes.find(x=>x.id==='giving').complete,true)})
test('finance distinguishes confirmed contributions from pledges',()=>{const r=phaseFourReadiness({selectedOutcomes:['giving'],contributions:[{status:'verified'},{status:'pledged'}],donationAudit:[{}],progress:{phase4_finance_review:'completed'}});const row=r.recipes.find(x=>x.id==='finance');assert.equal(row.complete,true);assert.match(row.evidence,/1 confirmed · 1 pending/)})

test('standalone team experience logistics orders and access outcomes select their procedures',()=>{const ids=selectedPhaseFourRecipes(['team','experience','logistics','orders','access']).map(x=>x.id);assert.deepEqual(ids,['team','tasks','orders','logistics','access','journey'])})
test('team readiness uses assigned members and a recorded permission review',()=>{const r=phaseFourReadiness({selectedOutcomes:['team'],members:[{id:'m1'}],progress:{phase4_team_review:'completed'}});assert.equal(r.recipes.find(x=>x.id==='team').complete,true)})
