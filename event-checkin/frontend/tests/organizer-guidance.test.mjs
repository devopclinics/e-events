import test from 'node:test'
import assert from 'node:assert/strict'
import {contextualGuidance,safeOrganizerDestination,authenticatedOrganizerReturn} from '../src/pages/organizerGuidance.mjs'
const event={id:'event',org_id:'org',event_date:'2026-10-19T08:00:00',timezone:'America/Los_Angeles'}
test('CTA validates current tenant, internal destination and event identity',()=>{
  for(const path of ['//evil.test','https://evil.test','/admin-redesign?returnTo=https://evil.test','/admin-redesign?event_id=other','/admin-redesign\\evil'])
    assert.equal(safeOrganizerDestination(path,event.id,[event],'org'),null)
  assert.equal(safeOrganizerDestination('/admin-redesign',event.id,[event],'other-org'),null)
  assert.equal(safeOrganizerDestination('/admin-redesign','other',[event],'org'),null)
  assert.equal(safeOrganizerDestination('/admin-redesign?tab=guests',event.id,[event],'org'),'/admin-redesign?tab=guests&event=event')
  assert.equal(authenticatedOrganizerReturn('/setup-redesign?event=event&view=guide',[event]),'/setup-redesign?event=event&view=guide')
  assert.equal(authenticatedOrganizerReturn('/setup-redesign?event=other',[event]),null)
  assert.equal(authenticatedOrganizerReturn('//evil.test',[]),null)
})
test('event-local day changes the next task and cancellation never prompts invitations',()=>{
  const late={...event,event_date:'2026-10-19T01:00:00Z'}
  const args={event:late,accessibleEvents:[late],now:new Date('2026-10-19T10:00:00Z'),recipes:[{id:'invitation',route:'/admin-redesign'}]}
  const result=contextualGuidance(args)
  assert.equal(result.timing,'past')
  assert.equal(result.next[0].id,'closeout')
  assert.equal(contextualGuidance({...args,event:{...late,cancelled:true}}).next[0].id,'closeout')
})
test('next steps reuse checklists and use event timezone without inferring completion',()=>{
  const result=contextualGuidance({event,accessibleEvents:[event],now:new Date('2026-10-19T01:00:00Z'),recipes:[
    {id:'rsvp',route:'/admin-redesign',complete:false},{id:'checkin',route:'/admin-redesign',complete:true}]})
  assert.equal(result.timing,'upcoming')
  assert.equal(result.localDate,'2026-10-18')
  assert.equal(result.next.length,1)
  assert.match(result.next[0].checklist[0],/controlled RSVP/)
  assert.equal(contextualGuidance({event,accessibleEvents:[]}).next.length,0)
  assert.equal(contextualGuidance({event:{...event,timezone:'invalid'},accessibleEvents:[event]}).timing,'unknown')
})
