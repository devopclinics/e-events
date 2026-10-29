import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const actor=uid=>({uid,getIdToken:async()=>`firebase-${uid}`})
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
test('actual Planner API enforces actor isolation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'planner-api-')),file=join(dir,'api.mjs'),oldFetch=globalThis.fetch
 globalThis.__plannerTestAuth={currentUser:actor('a')}
 t.after(async()=>{globalThis.fetch=oldFetch;delete globalThis.__plannerTestAuth;await rm(dir,{recursive:true,force:true})})
 await build({entryPoints:['src/api.js'],bundle:true,platform:'node',format:'esm',outfile:file,define:{'import.meta.env':'{}'},plugins:[{name:'firebase-fixture',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth=globalThis.__plannerTestAuth',loader:'js'}))}}]})
 const {api}=await import(pathToFileURL(file));const tokens=[]
 const mint=opts=>{tokens.push(opts.headers.Authorization);return new Response(JSON.stringify({token:`scoped-${opts.headers.Authorization}`,expires_in:900}))}
 await t.test('portfolio requests an explicit event and never fetches an unscoped list',async()=>{
  const urls=[];globalThis.fetch=async url=>{urls.push(url);return new Response('[]')}
  assert.deepEqual(await api.listPlannerEvents(),[]);assert.equal(urls.length,0)
  assert.deepEqual(await api.listPlannerEvents('event a/?'),[])
  assert.deepEqual(urls,['/api/events/me/planner-events?event_id=event%20a%2F%3F'])
 })
 await t.test('same event after account switch exchanges a new token',async()=>{
  const used=[];globalThis.fetch=async(url,opts)=>url.includes('/planner-token')?mint(opts):(used.push(opts.headers.Authorization),new Response('{}'))
  await api.plannerDashboard('event');globalThis.__plannerTestAuth.currentUser=actor('b');await api.plannerDashboard('event');assert.deepEqual(tokens,['Bearer firebase-a','Bearer firebase-b']);assert.notEqual(used[0],used[1])
 })
 await t.test('a late private API response is rejected after account switch',async()=>{
  const pending=deferred(),started=deferred();globalThis.fetch=async(url,opts)=>url.includes('/planner-token')?mint(opts):(started.resolve(),pending.promise)
  const result=api.plannerDashboard('event');await started.promise;globalThis.__plannerTestAuth.currentUser=actor('c');pending.resolve(new Response(JSON.stringify({private:'previous actor data'})));await assert.rejects(result,/account changed/)
 })
 await t.test('a late document download does not open under another account',async()=>{
  const pending=deferred(),started=deferred();globalThis.fetch=async(url,opts)=>url.includes('/planner-token')?mint(opts):{ok:true,blob:()=>{started.resolve();return pending.promise}}
  const result=api.plannerDownloadDocument('event','/api/planner/event/documents/files/private.pdf','private.pdf');await started.promise;globalThis.__plannerTestAuth.currentUser=actor('d');pending.resolve(new Blob(['private']));await assert.rejects(result,/account changed/)
 })
})
