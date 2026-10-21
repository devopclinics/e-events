import { marketingGroups, marketingTab } from '../src/pages/marketingNavigation.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
const require=createRequire(import.meta.url)
const source=readFileSync(new URL('../src/pages/MarketingPage.jsx',import.meta.url),'utf8').replace('function Dashboard(', 'export function Dashboard(')
const module={exports:{}}
const mocks={'../context/ThemeContext':{useTheme:()=>null},'./marketingNavigation.mjs':{marketingGroups,marketingTab},'../lib/marketingConsent.mjs':{},'react-router-dom':{Link:({children})=>React.createElement('a',null,children)},'../api':{api:{}},'./OrganizerHandoffs':()=>null}
runInNewContext(transformSync(source,{loader:'jsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require:id=>id.endsWith('.css')?{}:mocks[id]||require(id),Date,setInterval,clearInterval})
for(const state of ['paused','blocked','running'])test(`dashboard reports actual ${state} runtime`,async()=>{
 let root;const runtime={state,scheduler_running:state==='running',blockers:state==='blocked'?['Pending source captures']:[],conversion:{enrolled:4,first_event_created:1,rate:25},last_run:{checked_at:'2026-10-21T12:00:00Z'}}
 await act(async()=>{root=create(React.createElement(module.exports.Dashboard,{data:{automation:{runtime}},run:()=>{},navigate:()=>{}}))})
 const text=JSON.stringify(root.toJSON())
 assert.ok(text.includes(state));assert.ok(text.includes('first events'))
 assert.equal(text.includes('Automation checks every 15 min'),false)
 if(state==='blocked')assert.ok(text.includes('Pending source captures'))
 await act(async()=>root.unmount())
})
