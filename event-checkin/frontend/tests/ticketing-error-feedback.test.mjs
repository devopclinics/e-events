import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

test('actual ticketing client always supplies visible failure feedback',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ticketing-errors-')),file=join(dir,'api.mjs'),oldFetch=globalThis.fetch
 globalThis.__ticketingTestAuth={currentUser:{uid:'operator',getIdToken:async()=> 'synthetic-firebase'}}
 t.after(async()=>{globalThis.fetch=oldFetch;delete globalThis.__ticketingTestAuth;await rm(dir,{recursive:true,force:true})})
 await build({entryPoints:['src/api.js'],bundle:true,platform:'node',format:'esm',outfile:file,define:{'import.meta.env':'{}'},plugins:[{name:'firebase-fixture',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth=globalThis.__ticketingTestAuth',loader:'js'}))}}]})
 const {api}=await import(pathToFileURL(file))
 for(const [name,body,expected] of [
  ['empty HTTP/2 gateway response','',/HTTP 502/],
  ['HTML gateway page','<html>Bad gateway</html>',/HTTP 502/],
  ['empty JSON detail','{"detail":"  "}',/HTTP 502/],
  ['unexpected JSON detail','{"detail":{"message":"unexpected"}}',/HTTP 502/],
  ['provider explanation','{"detail":"Stripe Connect setup required (req_Fixture123)"}',/Stripe Connect setup required \(req_Fixture123\)/],
 ])await t.test(name,async()=>{
  globalThis.fetch=async url=>url.includes('/ticketing-token')?new Response(JSON.stringify({token:'synthetic-scoped',expires_in:900})):new Response(body,{status:502,statusText:''})
  await assert.rejects(api.createStripePayoutAccount('event',{business_name:'Academy',email:'owner@example.com',country:'US'}),error=>error.status===502 && expected.test(error.message))
 })
})
