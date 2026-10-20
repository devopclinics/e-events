import test from 'node:test'
import assert from 'node:assert/strict'
import { queuedAction,replayBody,queueId } from '../src/lib/guestServiceOffline.mjs'
test('offline payload excludes pass credentials and contact details',()=>{
 const guest={id:'guest',table_id:'table',admitted:true,can_manage_meals:true,qr_token:'private-pass',email:'private@example.invalid',phone:'private-phone',name:'Private name'}
 const service={id:'meal',record_updated_at:'2026-10-20T10:00:00',selection_key:'reviewed-choices'}
 const queued=queuedAction('served',guest,service,()=> 'unique-offline-action',()=>new Date('2026-10-20T11:00:00Z'))
 assert.equal(queued.expected_selection_key,'reviewed-choices')
 assert.equal(queued.expected_record_updated_at,'2026-10-20T10:00:00')
 assert.doesNotMatch(JSON.stringify(queued),/private|Private/)
 assert.deepEqual(replayBody({...queued,state:'review',issue:'Shift expired'}),queued)
 assert.notEqual(queueId('actor-a','event'),queueId('actor-b','event'))
})
test('offline recording never queues admission, corrections, unknown guests or meals without permission',()=>{
 const guest={id:'guest',table_id:'table',admitted:true,can_manage_meals:false}
 assert.throws(()=>queuedAction('checkin',guest))
 assert.throws(()=>queuedAction('seated',{...guest,admitted:false}))
 assert.throws(()=>queuedAction('served',guest,{id:'meal'}))
 assert.throws(()=>queuedAction('attendance',{...guest,can_manage_meals:true},null))
})
