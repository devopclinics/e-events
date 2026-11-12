import { test } from 'node:test'
import assert from 'node:assert/strict'
import { occupancyPresentation, summaryMetrics, utcDate, eventTime } from '../src/pages/redesign/results/resultsSummary.mjs'
test('a zone without exit tracking does not inherit event-wide tracking',()=>{
  const p=occupancyPresentation({on_site:55,occupancy_mode:'historical',exit_tracking_recorded:false},{exit_tracking_recorded:true},'Africa/Lagos')
  assert.equal(p.value,null);assert.equal(p.usable,false);assert.match(p.label,/unverified/)
})
test('historical zero stays zero; future null never becomes attendance',()=>{
  const p=occupancyPresentation({on_site:0,occupancy_mode:'historical',occupancy_as_of:'2026-11-11T23:00:00Z',exit_tracking_recorded:true},{},'Africa/Lagos')
  assert.equal(p.value,0);assert.equal(p.label,'Recorded inside at close')
  assert.equal(occupancyPresentation({on_site:null,checked_in:90,occupancy_mode:'future'},{}).value,null)
})
test('confirmed cohort is not divided using all arrivals',()=>{
  const metrics=summaryMetrics({rsvp:{guests:134,confirmed:110,checked_in:101,confirmed_arrived:77,confirmed_not_arrived:33,other_arrivals:24}})
  assert.equal(metrics[2][1],101);assert.equal(metrics[3][1],77);assert.match(metrics[3][2],/70%/)
})
test('naive API timestamps are UTC, and event clock uses the event timezone',()=>{
  assert.equal(utcDate('2026-11-11T09:00:00').toISOString(),'2026-11-11T09:00:00.000Z')
  assert.equal(utcDate('2026-11-11T10:00:00+01:00').toISOString(),'2026-11-11T09:00:00.000Z')
  assert.match(eventTime('2026-11-11T09:00:00','Africa/Lagos'),/10:00/)
})
