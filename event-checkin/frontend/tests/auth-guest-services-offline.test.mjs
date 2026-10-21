import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
const require=createRequire(import.meta.url)
function harness({online=false,path='/guest-services',saved={uid:'known-user',profile:{id:'cached-actor',role:'staff'}}}={}){
 let listener,context
 const storage=new Map(saved?[['festio:gs-offline-profile',JSON.stringify(saved)]]:[]),cleared=[]
 const modules={'../lib/marketingConsent.mjs':{verifiedSignupConsent:()=>({}),clearSignupConsent:()=>{}},'../firebase':{auth:{}},'firebase/auth':{onAuthStateChanged:(_,fn)=>{listener=fn;return()=>{}},signOut:async()=>{}},'../lib/acquisitionAttribution.mjs':{acquisitionAttributionHeaders:()=>({})},'../lib/guestServiceOffline.mjs':{clearGuestServiceCaches:async id=>cleared.push(id)}}
 const module={exports:{}},code=transformSync(readFileSync(new URL('../src/context/AuthContext.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code
 runInNewContext(code,{module,exports:module.exports,require:name=>modules[name]||require(name),navigator:{onLine:online},location:{pathname:path},window:{setTimeout:()=>1,clearTimeout(){}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},localStorage:{getItem:()=>null},fetch:async()=>({ok:true,json:async()=>({id:'verified-actor',role:'staff'})}),JSON})
 const Probe=()=>{context=module.exports.useAuth();return React.createElement('span',null,context.user?.id||'signedout')}
 return {mount:()=>create(React.createElement(module.exports.AuthProvider,null,React.createElement(Probe))),fire:user=>listener(user),value:()=>context,storage,cleared}
}
test('offline Guest Services restores only the matching established identity without token refresh',async()=>{
 const h=harness();let root,calls=0;await act(async()=>{root=h.mount()})
 await act(async()=>h.fire({uid:'known-user',getIdToken:async()=>{calls++;throw new Error('No network')}}))
 assert.equal(h.value().user.id,'cached-actor');assert.equal(calls,0)
 await act(async()=>h.value().logout());assert.deepEqual(h.cleared,['cached-actor']);assert.equal(h.storage.has('festio:gs-offline-profile'),false)
 await act(async()=>root.unmount())
})
test('cached profile never signs in a different Firebase identity or unlocks unrelated routes offline',async()=>{
 for(const options of [{},{path:'/admin-redesign'}]){
  const h=harness(options);let root;await act(async()=>{root=h.mount()})
  await act(async()=>h.fire({uid:options.path?'known-user':'another-user',getIdToken:async()=>{throw new Error('No network')}}))
  assert.equal(h.value().user,null);await act(async()=>root.unmount())
 }
})
test('online Guest Services uses fresh authenticated profile rather than stored permissions',async()=>{
 const h=harness({online:true});let root;await act(async()=>{root=h.mount()})
 await act(async()=>h.fire({uid:'known-user',getIdToken:async()=> 'synthetic-token'}))
 assert.equal(h.value().user.id,'verified-actor');await act(async()=>root.unmount())
})
