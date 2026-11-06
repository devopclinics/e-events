import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import {canSeeStaffFeature} from '../src/lib/staffFeatures.js'
const module={exports:{}}
runInNewContext(transformSync(readFileSync(new URL('../src/lib/guestAuxiliary.js',import.meta.url),'utf8'),{format:'cjs'}).code,{module,exports:module.exports,require:()=>({canSeeStaffFeature})})
const {loadGuestAuxiliary}=module.exports
function setup(){const calls=[];const api=Object.fromEntries(['listTableGroups','listTables','listTicketTypes','listRSVPQuestions'].map(method=>[method,async id=>{calls.push([method,id]);return [method]}]));return {api,calls}}
test('guest manager does not request ungranted seating or RSVP design resources',async()=>{
 const {api,calls}=setup();const result=await loadGuestAuxiliary(api,'event',{id:'event',my_feature_permissions:{guests:'manage',scanner:'manage'}})
 assert.equal(calls.length,0);assert.deepEqual(JSON.parse(JSON.stringify(result)),{groups:[],tables:[],ticketTypes:[],questions:[]})
})
test('allowed supporting features are loaded independently',async()=>{
 const {api,calls}=setup();const result=await loadGuestAuxiliary(api,'event',{id:'event',my_feature_permissions:{guests:'manage',seating:'view'}})
 assert.deepEqual(calls,[['listTableGroups','event'],['listTables','event']]);assert.equal(result.groups[0],'listTableGroups');assert.equal(result.questions.length,0)
})
test('legacy role denial of optional resources does not break guest page',async()=>{
 const {api}=setup();api.listRSVPQuestions=async()=>{throw Object.assign(new Error('Permission denied'),{status:403})}
 const result=await loadGuestAuxiliary(api,'event',{id:'event'});assert.equal(result.questions.length,0);assert.equal(result.tables.length,1)
})
test('old event metadata cannot authorize requests for another event',async()=>{
 const {api,calls}=setup();await loadGuestAuxiliary(api,'new',{id:'old'});assert.equal(calls.length,0)
})
