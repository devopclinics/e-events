import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'
const require = createRequire(import.meta.url)
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.children ? text(n.children) : ''
const fixture = () => ({zones:[{id:'conf',name:'Conference',restricted:true},{id:'dinner',name:'Dinner',restricted:true},{id:'registration',name:'Registration',restricted:false}],guests:[{id:'guest',name:'Test Guest',email:'test@example.test'}],decisions:[{guest_id:'guest',zone_id:'conf',decision:'allow'},{guest_id:'guest',zone_id:'dinner',decision:'block'}]})
function setup(api) {
 const module = {exports:{}}
 const code = transformSync(readFileSync(new URL('../src/components/SessionAccessPanel.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code
 runInNewContext(code,{module,exports:module.exports,window:{confirm:()=>true},require:n=>n.endsWith('.css')?{}:n==='../api'?{api}:require(n)})
 return module.exports.default
}
test('matrix preserves decisions on failed save and filters blocked guests',async()=>{
 const data=fixture(),writes=[]
 const Panel=setup({sessionAccess:async()=>structuredClone(data),setSessionAccess:async(...args)=>{writes.push(args);throw Error('Save rejected')}})
 let tree;await act(async()=>{tree=create(React.createElement(Panel,{eventId:'event'}))})
 let dinner=tree.root.findByProps({'aria-label':'Test Guest: Dinner access'})
 assert.equal(dinner.props.value,'block')
 await act(async()=>{await dinner.props.onChange({target:{value:'allow'}})})
 assert.equal(tree.root.findByProps({'aria-label':'Test Guest: Dinner access'}).props.value,'block')
 assert.match(text(tree.toJSON()),/Save rejected/)
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[['event','dinner',['guest'],'allow']])
 await act(async()=>tree.root.findByProps({'aria-label':'Filter session access'}).props.onChange({target:{value:'block'}}))
 assert.ok(tree.root.findByProps({'aria-label':'Select Test Guest'}))
 assert.equal(tree.root.findAllByType('th').length,4)
 await act(async()=>tree.unmount())
})
test('old event response cannot replace the newly selected event',async()=>{
 let finishOld
 const Panel=setup({sessionAccess:id=>id==='old'?new Promise(resolve=>{finishOld=resolve}):Promise.resolve({...fixture(),guests:[{id:'new',name:'New Guest'}],decisions:[]})})
 let tree;await act(async()=>{tree=create(React.createElement(Panel,{eventId:'old'}))})
 await act(async()=>tree.update(React.createElement(Panel,{eventId:'new'})))
 await act(async()=>finishOld(fixture()))
 assert.match(text(tree.toJSON()),/New Guest/)
 assert.doesNotMatch(text(tree.toJSON()),/Test Guest/)
 await act(async()=>tree.unmount())
})
test('successful session change refreshes the displayed decision',async()=>{
 const data=fixture()
 const Panel=setup({sessionAccess:async()=>structuredClone(data),setSessionAccess:async(e,z,ids,decision)=>{data.decisions.find(d=>d.zone_id===z).decision=decision}})
 let tree;await act(async()=>{tree=create(React.createElement(Panel,{eventId:'event'}))})
 await act(async()=>tree.root.findByProps({'aria-label':'Test Guest: Dinner access'}).props.onChange({target:{value:'allow'}}))
 assert.equal(tree.root.findByProps({'aria-label':'Test Guest: Dinner access'}).props.value,'allow')
 await act(async()=>tree.unmount())
})
