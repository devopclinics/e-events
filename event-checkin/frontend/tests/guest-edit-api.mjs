import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
const temp=mkdtempSync(`${tmpdir()}/guest-edit-api-`);const output=`${temp}/api.mjs`;
await build({entryPoints:[fileURLToPath(new URL('../src/api.js',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:output,define:{'import.meta.env':'{}'},plugins:[{name:'auth',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth={currentUser:{getIdToken:async()=>"fixture"}}'}))}}]});
const calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,status:200,json:async()=>({id:'g'})}};
const {api}=await import(pathToFileURL(output).href);await api.updateGuest('event','g',{first_name:'Rebecca'});await api.updateGuest('event','g',{email:'r@example.com'},'2026-11-10T00:00:00');
if(calls[0].url!=='/api/events/event/guests/g'||!calls[1].url.includes('if_unmodified_since=')||calls.some(c=>c.opts.method!=='PATCH'))throw Error('Guest patch regression');console.log('Guest edits and optimistic concurrency both generate PATCH requests; no network sends.');

rmSync(temp,{recursive:true,force:true});
