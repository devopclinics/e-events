import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import * as programme from '../src/juniorProgramme.mjs'
import * as summary from '../src/pages/redesign/results/resultsSummary.mjs'
const req=createRequire(import.meta.url),mod={exports:{}}
runInNewContext(transformSync(readFileSync(new URL('../src/pages/redesign/results/WholeEventOverview.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code,{module:mod,exports:mod.exports,require:n=>n==='../../../juniorProgramme.mjs'?programme:n==='./resultsSummary.mjs'?summary:req(n)})
const render=event=>renderToStaticMarkup(React.createElement(mod.exports.default,{event,data:{},setActiveTab(){},setOverviewLayout(){}}))
test('NCNMO results provides accurate Platform wording and a link to the separate child dashboard',()=>{
 const html=render({id:'9f0326d7-bcac-4cb1-a273-4115abc4983d',name:'Old practice label'})
 assert.ok(html.includes('Festio × NCNMO'))
 assert.ok(html.includes('NCNMO Junior Platform 2026 · Practice — Overview'))
 assert.ok(html.includes('/juniors/?event=9f0326d7-bcac-4cb1-a273-4115abc4983d'))
 assert.ok(html.includes('Platform attendance, seating, communications and follow-up in one view.'))
})
test('Other event results retain their existing heading, description and actions',()=>{
 const html=render({id:'another-event',name:'Example conference'})
 assert.ok(html.includes('Example conference at a glance'))
 assert.ok(html.includes('Event totals, zone arrivals, seating, communications, and follow-up in one accountable view.'))
 assert.ok(!html.includes('Open JP dashboard'))
 assert.ok(!html.includes('Festio × NCNMO'))
})
