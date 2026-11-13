import test from 'node:test'
import assert from 'node:assert/strict'
import { ACADEMY_EVENT_ID, ACADEMY_GIVING_TOKEN, academyCampaign, givingProgress } from '../src/components/academy/academyExperience.mjs'
test('academy experience is scoped to the intended event and stable campaign aliases',()=>{
 assert.equal(academyCampaign({event_id:ACADEMY_EVENT_ID}),true)
 assert.equal(academyCampaign({event_name:'Mumineen Academy Annual Fundraising Event'},ACADEMY_GIVING_TOKEN),true)
 assert.equal(academyCampaign({event_name:'Another school'},ACADEMY_GIVING_TOKEN),false)
 assert.equal(academyCampaign({event_name:'Mumineen Academy Annual Fundraising Event'},'other-campaign'),false)
})
test('confirmed money alone determines progress and milestones, without counting pledges',()=>{
 assert.deepEqual(givingProgress({confirmed_minor:5000,pledged_minor:3400000,goal_minor:30000000}),{confirmed:5000,goal:30000000,percent:5000/30000000*100,remaining:29995000,milestone:7500000,milestoneRemaining:7495000})
 const over=givingProgress({confirmed_minor:35000000,goal_minor:30000000});assert.equal(over.percent,100);assert.equal(over.remaining,0);assert.equal(over.milestoneRemaining,0)
 assert.equal(givingProgress({confirmed_minor:5000}).percent,0)
})
