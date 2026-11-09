import test from 'node:test'
import assert from 'node:assert/strict'
import {scannerPresentedResult} from '../src/lib/scannerPresentation.mjs'
const event={setup_preferences:{scanner_presentation:{focused:true,admission_step_ids:['welcome'],zone_step_ids:{conference:[],dinner:[]}},session_attendance_steps:{conference:'conf',dinner:'gala'}}}
const steps=[{id:'welcome',type:'custom'},{id:'conf',type:'session_attendance'},{id:'gala',type:'session_attendance'},{id:'feedback',type:'custom'},{id:'waiver',required:true,blocks_checkin:true}].map(step=>({step}))
test('only the selected point actions are shown',()=>{
 for(const [zone,expected] of [['conference',['conf']],['dinner',['gala']]])assert.deepEqual(scannerPresentedResult({status:'ok',scanner_context:{zone_id:zone,direction:'in'},experience_next_steps:steps},event).experience_next_steps.map(x=>x.step.id),expected)
 assert.deepEqual(scannerPresentedResult({status:'admitted',experience_next_steps:steps},event).experience_next_steps.map(x=>x.step.id),['welcome'])
})
test('denials and exits suppress actions; blocking prerequisites remain',()=>{
 assert.deepEqual(scannerPresentedResult({status:'denied',denied:true,experience_next_steps:steps},event).experience_next_steps,[])
 assert.deepEqual(scannerPresentedResult({scanner_context:{direction:'out'},experience_next_steps:steps},event).experience_next_steps,[])
 assert.deepEqual(scannerPresentedResult({status:'pending_required_step',experience_next_steps:steps},event).experience_next_steps.map(x=>x.step.id),['welcome','waiver'])
})
test('legacy events unchanged; original result preserved',()=>{const result={experience_next_steps:steps};assert.equal(scannerPresentedResult(result,{}),result);scannerPresentedResult(result,event);assert.equal(result.experience_next_steps.length,5)})
