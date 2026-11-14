import {test} from 'node:test'
import assert from 'node:assert/strict'
import {featureCatalog,searchFeatures} from '../src/pages/redesign/featureSearch.mjs'
const top=[{id:'live',label:'Festio Live',to:'/live-redesign'},{id:'results',label:'Results',to:'/event-results-redesign'},{id:'events',label:'Events',to:'/events-redesign'}]
test('finds service synonyms and exact deep links',()=>{
 const entries=featureCatalog(top,[],{hasEvent:true})
 assert.equal(searchFeatures(entries,'fundraising')[0].to,'/live-redesign?tab=Donations')
 assert.equal(searchFeatures(entries,'certificate')[0].label,'Certificates')
 assert.equal(searchFeatures(entries,'presentation')[0].to,'/live-redesign?tab=Experiences')
 assert.equal(searchFeatures(entries,'pdf')[0].label,'Generate event report')
 assert.equal(searchFeatures(entries,'projector')[0].to,'/live-redesign?tab=Displays')
})
test('restricted parent and destination cannot be discovered through deep links',()=>{
 const entries=featureCatalog(top.filter(x=>x.id!=='live'),[],{hasEvent:true,canAccess:to=>!to.includes('results')})
 assert.deepEqual(searchFeatures(entries,'certificate'),[])
 assert.deepEqual(searchFeatures(entries,'donations'),[])
})
test('without an event only global destinations are returned; settings discovery remains searchable',()=>{
 assert.deepEqual(featureCatalog(top,[]).map(x=>x.id),['events'])
 const side=['seating','planner'].map(id=>({id,label:id,to:'/communications-redesign?tab=settings',description:'Enable '+id}))
 const entries=featureCatalog(top,side,{hasEvent:true})
 assert.equal(searchFeatures(entries,'seating')[0].id,'seating')
 assert.equal(searchFeatures(entries,'planner')[0].id,'planner')
})
test('matches all query words case-insensitively and gives empty results for unmatched queries',()=>{
 const entries=featureCatalog(top,[],{hasEvent:true})
 assert.equal(searchFeatures(entries,'CERTIFICATE RESULTS')[0].id,'certificate-results')
 assert.deepEqual(searchFeatures(entries,'notafestiofeature'),[])
})
