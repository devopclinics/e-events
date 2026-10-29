import test from 'node:test'
import assert from 'node:assert/strict'
import {CERTIFICATE_TYPES,CERTIFICATE_LAYOUTS,applyCertificateType} from './certificateDesigns.mjs'
test('six certificate purposes retain artwork, style and signature when wording changes',()=>{
 const current={title:'Original',layout:'editorial',logo_url:'/logo',background_url:'/paper',signature_name:'Academy',primary_color:'#194e3d'}
 for(const type of CERTIFICATE_TYPES){const next=applyCertificateType(current,type.id);assert.equal(next.kind,type.id);assert.equal(next.title,type.title);assert.equal(next.layout,'editorial');assert.equal(next.logo_url,'/logo');assert.equal(next.background_url,'/paper');assert.equal(next.signature_name,'Academy');assert.equal(current.title,'Original')}
 assert.equal(CERTIFICATE_TYPES.length,6);assert.equal(CERTIFICATE_LAYOUTS.length,3)
})
test('custom wording remains intact',()=>{assert.deepEqual(applyCertificateType({title:'My own title',body:'My own words'},'custom'),{title:'My own title',body:'My own words',kind:'custom'})})
