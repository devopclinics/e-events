import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
import * as programme from '../src/juniorProgramme.mjs'
import * as juniorHelp from '../src/juniorHelpContent.mjs'
const overview={exports:{}};runInNewContext(transformSync(readFileSync(new URL('../src/components/JuniorWorkflowOverview.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code,{module:overview,exports:overview.exports,require:n=>n==='../juniorProgramme.mjs'?programme:n==='../juniorHelpContent.mjs'?juniorHelp:createRequire(import.meta.url)(n)})
const req=createRequire(import.meta.url),guide=JSON.parse(readFileSync(new URL('../src/content/juniorGuide.json',import.meta.url),'utf8'))
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):''
async function render(){const mod={exports:{}},frames=[],navigated=[],prints=[];let tree
runInNewContext(transformSync(readFileSync(new URL('../src/components/JuniorVolunteerGuide.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code,{module:mod,exports:mod.exports,requestAnimationFrame:fn=>frames.push(fn),window:{print:()=>prints.push(tree.root.findAllByProps({className:'jvg-card'}).length)},require:n=>n==='../juniorProgramme.mjs'?programme:n==='./JuniorWorkflowOverview'?overview.exports:n.endsWith('.css')?{}:n==='../content/juniorGuide.json'?guide:req(n)})
await act(async()=>{tree=create(React.createElement(mod.exports.default,{eventName:'Training event',onNavigate:id=>navigated.push(id)}))});return{tree,frames,navigated,prints}}
test('Task filters preserve navigation and comprehensive printing restores all topics first',async()=>{const{tree,frames,navigated,prints}=await render();const buttons=()=>tree.root.findAllByType('button'),find=label=>buttons().find(b=>text(b.children)===label)
assert.equal(tree.root.findAllByProps({className:'jvg-card'}).length,guide.sections.length);await act(async()=>find('Support').props.onClick());assert.equal(tree.root.findAllByProps({className:'jvg-card'}).length,1);await act(async()=>find('Open support desks →').props.onClick());assert.deepEqual(navigated,['referrals']);await act(async()=>find('Print visual guide / Save PDF').props.onClick());assert.equal(tree.root.findAllByProps({className:'jvg-card'}).length,guide.sections.length);frames.forEach(fn=>fn());assert.deepEqual(prints,[guide.sections.length]);await act(async()=>tree.unmount())})
test('Every guide download points to a real versioned training artifact',async()=>{const{tree}=await render();const links=tree.root.findAllByType('a');assert.equal(links.length,19);for(const link of links){assert.ok(link.props.href.startsWith('/juniors/guide/'));const url=new URL('../public'+link.props.href,import.meta.url);assert.ok(existsSync(url),link.props.href);assert.ok(readFileSync(url).length>200)}assert.equal(tree.root.findAllByType('img').length,4);await act(async()=>tree.unmount())})
