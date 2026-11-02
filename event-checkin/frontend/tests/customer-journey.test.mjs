import test from 'node:test'
import assert from 'node:assert/strict'
import {registrationReadiness,toolAccess,invitationPath,destinationFingerprint,CUSTOMER_TOOLS} from '../src/pages/customerJourneyModel.mjs'
const base={id:'event-1',status:'active',rsvp_enabled:true,invite_mode:'open',rsvp_token:'unguessable'}
test('draft design is not open registration',()=>assert.equal(registrationReadiness({...base,status:'draft'}).ready,false))
test('ended and archived events are not silently reopened',()=>{for(const status of ['ended','archived'])assert.equal(registrationReadiness({...base,status}).ready,false)})
test('RSVP switch and active lifecycle are independently required',()=>assert.equal(registrationReadiness({...base,rsvp_enabled:false}).ready,false))
test('private invitations cannot become a public share link',()=>assert.equal(registrationReadiness({...base,invite_mode:'closed'}).ready,false))
test('external registration stays externally managed',()=>assert.equal(registrationReadiness({...base,external_registration_url:'https://example.com/register'}).external,true))
test('expired deadline blocks sharing but future deadline does not',()=>{assert.equal(registrationReadiness({...base,rsvp_deadline:'2026-01-01'},Date.parse('2026-02-01')).ready,false);assert.equal(registrationReadiness({...base,rsvp_deadline:'2026-03-01'},Date.parse('2026-02-01')).ready,true)})
test('open registration remains subject to capacity and approval rules',()=>assert.equal(registrationReadiness({...base,rsvp_require_approval:true,rsvp_capacity:20}).ready,true))
test('included and enabled are distinct',()=>{const tool=CUSTOMER_TOOLS[0];assert.deepEqual(toolAccess(tool,base,{available_addons:['addon_seating']}),{state:'Included · not enabled',included:true});assert.equal(toolAccess(tool,{...base,seating_enabled:true},{available_addons:['addon_seating']}).state,'Enabled · review setup')})
test('missing entitlement response does not pretend included access',()=>assert.equal(toolAccess(CUSTOMER_TOOLS[0],base,null).included,null))
test('explicit exclusion leads to review access',()=>assert.equal(toolAccess(CUSTOMER_TOOLS[0],base,{available_addons:[]}).included,false))
test('ordinary workspaces are not advertised as paid add-ons',()=>assert.equal(toolAccess(CUSTOMER_TOOLS.find(t=>t.id==='tickets'),base,null).included,null))
test('quick invitation paths preserve custom aliases and old links',()=>{assert.equal(invitationPath({...base,setup_preferences:{quick_invite:{share_slug:'my-event'}}}),'/i/my-event');assert.equal(invitationPath({...base,setup_preferences:{quick_invite:{}}}),'/i/unguessable');assert.equal(invitationPath(base),'/rsvp/unguessable')})
test('link validation invalidates on event change and registration changes',()=>{for(const patch of [{id:'other'},{status:'draft'},{rsvp_enabled:false},{rsvp_deadline:'2027-01-01'},{rsvp_token:'rotated'},{invite_mode:'closed'},{external_registration_url:'https://example.com'}])assert.notEqual(destinationFingerprint(base),destinationFingerprint({...base,...patch}))})
test('unrelated design does not overwrite link state',()=>assert.equal(destinationFingerprint(base),destinationFingerprint({...base,setup_preferences:{quick_invite:{style:'arch',colour:'mint'}}})))
