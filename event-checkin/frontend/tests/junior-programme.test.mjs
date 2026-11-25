import test from 'node:test'
import assert from 'node:assert/strict'
import {isNCNMO,juniorEventName} from '../src/juniorProgramme.mjs'
test('NCNMO programme names are scoped to the two assigned event identities',()=>{
 assert.equal(juniorEventName({id:'cefc5699-da7e-4610-9598-74a9423f0ea0',name:'Old name'}),'NCNMO Junior Platform 2026')
 assert.equal(juniorEventName({id:'9f0326d7-bcac-4cb1-a273-4115abc4983d',name:'Old practice'}),'NCNMO Junior Platform 2026 · Practice')
 assert.equal(juniorEventName({id:'other-event',name:'Another programme'}),'Another programme')
 assert.equal(isNCNMO('other-event'),false)
 assert.equal(isNCNMO(undefined),false)
})
