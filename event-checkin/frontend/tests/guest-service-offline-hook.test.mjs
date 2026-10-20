import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
const require=createRequire(import.meta.url)
test('account switches never render the previous queue and unmounted pages cannot refill signed-out caches',async()=>{
 let actor='actor-a',value;const renders=[],saved=[]
 const modules={'../api':{api:{}},'../context/AuthContext':{useAuth:()=>({user:{id:actor}})},'../lib/guestServiceOffline.mjs':{
  queueId:(id,event)=>id+':'+event,readRecord:async key=>[{client_key:key,guest_id:key}],syncQueue:async()=>[],savePage:async(...args)=>saved.push(args),clearGuestServiceCaches:async()=>{}
 }}
 const module={exports:{}},code=transformSync(readFileSync(new URL('../src/hooks/useGuestServiceOffline.js',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'}).code
 runInNewContext(code,{module,exports:module.exports,require:name=>modules[name]||require(name),navigator:{onLine:false},window:{addEventListener(){},removeEventListener(){}},Date,Promise,setInterval:()=>1,clearInterval(){}})
 const Probe=()=>{value=module.exports.default('event');renders.push({actor,rows:value.rows.map(r=>r.guest_id)});return React.createElement('span',null,actor)}
 let root;await act(async()=>{root=create(React.createElement(Probe))})
 assert.equal(value.rows[0].guest_id,'actor-a:event')
 actor='actor-b';await act(async()=>root.update(React.createElement(Probe)))
 assert.ok(renders.filter(row=>row.actor==='actor-b').every(row=>!row.rows.includes('actor-a:event')))
 const lateCache=value.cache
 await act(async()=>root.unmount())
 await lateCache('page',{event_id:'event'});assert.equal(saved.length,0)
})
