import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
test('guest editing and guarded table editing use distinct API contracts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'guest-api-')),file=join(dir,'api.mjs'),original=globalThis.fetch,requests=[]
 t.after(async()=>{globalThis.fetch=original;await rm(dir,{recursive:true,force:true})})
 await build({entryPoints:['src/api.js'],bundle:true,platform:'node',format:'esm',outfile:file,define:{'import.meta.env':'{}'},plugins:[{name:'auth',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth={currentUser:null}',loader:'js'}))}}]})
 const {api}=await import(pathToFileURL(file));globalThis.fetch=async(url,opts)=>{requests.push({url,opts});return new Response('{}')}
 await api.updateGuest('event','guest',{first_name:'Updated'})
 assert.equal(requests.at(-1).url,'/api/events/event/guests/guest');assert.equal(requests.at(-1).opts.method,'PATCH')
 const timestamp='2026-11-02T10:00:00+01:00';await api.updateGuest('event','guest',{table_id:'table'},timestamp)
 assert.equal(new URL(requests.at(-1).url,'https://example.com').searchParams.get('if_unmodified_since'),timestamp)
 await api.updateTable('event','table',{capacity:10},timestamp,true)
 const params=new URL(requests.at(-1).url,'https://example.com').searchParams
 assert.equal(params.get('protect_assigned'),'true');assert.equal(params.get('if_unmodified_since'),timestamp)
 await api.updateTable('event','table',{rotation:45});assert.equal(requests.at(-1).url,'/api/events/event/tables/table')
})
