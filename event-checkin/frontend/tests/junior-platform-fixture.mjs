// Browser harness: real component and shell, local synthetic identity and API only.
import {build} from 'esbuild'
import fs from 'node:fs'
const out=process.env.JUNIOR_PREVIEW_DIR
if(!out)throw new Error('JUNIOR_PREVIEW_DIR required')
fs.mkdirSync(out,{recursive:true})
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Page from './src/pages/JuniorPlatformPage';import './src/pages/redesign/RedesignShell.css';localStorage.setItem('eq.currentEventId','junior-qa-event');createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);`,resolveDir:process.cwd(),loader:'jsx'},
  outfile:out+'/app.js',bundle:true,jsx:'automatic',loader:{'.css':'css','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},
  plugins:[{name:'local-only-api-and-identity',setup(b){
    b.onResolve({filter:/\/api$/},()=>({path:'api',namespace:'junior-fixture'}))
    b.onResolve({filter:/context\/AuthContext$/},()=>({path:'auth',namespace:'junior-fixture'}))
    b.onLoad({filter:/.*/,namespace:'junior-fixture'},args=>({loader:'js',contents:args.path==='auth'?`const user={id:'junior-qa-user',name:'QA supervisor',role:'admin',is_platform_superadmin:true};export function useAuth(){return{user,logout(){}}}`:
      `async function req(path,method='GET',body){const response=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>null);if(!response.ok){const err=new Error(typeof data?.detail==='string'?data.detail:JSON.stringify(data?.detail));err.status=response.status;throw err}return data}export const api={listEvents:()=>req('/events'),junior:(id,path,method,body)=>req('/events/'+id+'/junior'+path,method,body)};export const PUBLIC_BASE_URL=location.origin;export function publicBaseUrl(){return location.origin}` }))
  }}]})
fs.writeFileSync(out+'/index.html','<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:0}a{color:inherit}</style><div id="root"></div><script>localStorage.setItem("eq.currentEventId","junior-qa-event")</script><script src="/app.js"></script></html>')
