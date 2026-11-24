import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
const require=createRequire(import.meta.url)
const source=readFileSync(new URL('../src/components/JuniorClassroomSettings.jsx',import.meta.url),'utf8')
const code=transformSync(source,{loader:'jsx',jsx:'automatic',format:'cjs'}).code,module={exports:{}}
runInNewContext(code,{module,exports:module.exports,crypto:globalThis.crypto,require:n=>n==='react'?React:n.endsWith('.css')?{}:require(n)})
const Component=module.exports.default
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):''
const config={classrooms:['Room A'],practice_mode:true,read_only:false}
const button=(tree,label)=>tree.root.findAllByType('button').find(b=>text(b.children)===label)
async function addRoom(tree,name){await act(async()=>button(tree,'+ Add classroom row').props.onClick());await act(async()=>tree.root.findAllByType('input').at(-1).props.onChange({target:{value:name}}))}
test('Classroom table draft survives settings refresh; scoped save confirms persistence',async()=>{
 const writes=[];let reloads=0,tree
 const props={config,call:async(...args)=>{writes.push(args);return {classrooms:['Room A','Room B']}},reload:async()=>{reloads++},busy:false}
 await act(async()=>{tree=create(React.createElement(Component,props))});await addRoom(tree,'Room B')
 await act(async()=>{tree.update(React.createElement(Component,{...props,config:{...config,staff:{someone:'scanner'}}}))})
 assert.deepEqual(tree.root.findAllByType('input').map(i=>i.props.value),['Room A','Room B'])
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[['/classrooms','PUT',{classrooms:['Room A','Room B'],expected_classrooms:['Room A']}]])
 assert.equal(reloads,1);assert.match(text(tree.toJSON()),/2 classrooms saved for this event/);await act(async()=>tree.unmount())
})
test('Conflict retains each classroom row and reset loads the current saved list',async()=>{
 let tree;const props={config,call:async()=>{throw new Error('Classrooms changed elsewhere')},reload:async()=>{},busy:false}
 await act(async()=>{tree=create(React.createElement(Component,props))});await addRoom(tree,'My new room')
 await act(async()=>tree.update(React.createElement(Component,{...props,config:{...config,classrooms:['Room A','Another room']}})))
 assert.deepEqual(tree.root.findAllByType('input').map(i=>i.props.value),['Room A','My new room'])
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 assert.match(text(tree.toJSON()),/Classrooms changed elsewhere/)
 await act(async()=>button(tree,'Reset to saved').props.onClick());assert.deepEqual(tree.root.findAllByType('input').map(i=>i.props.value),['Room A','Another room']);await act(async()=>tree.unmount())
})
test('View-only classroom table follows saved settings and cannot submit',async()=>{
 let writes=0,tree;const props={config,call:async()=>{writes++},reload:async()=>{},busy:false}
 await act(async()=>{tree=create(React.createElement(Component,props))})
 await act(async()=>tree.update(React.createElement(Component,{...props,config:{...config,classrooms:['Room A','Room C'],read_only:true}})))
 assert.deepEqual(tree.root.findAllByType('input').map(i=>i.props.value),['Room A','Room C'])
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 assert.equal(writes,0);assert.ok(tree.root.findAllByType('input').every(i=>i.props.disabled));await act(async()=>tree.unmount())
})
test('Duplicate classroom rows are explained and never silently merged on submit',async()=>{
 let writes=0,tree;await act(async()=>{tree=create(React.createElement(Component,{config,call:async()=>{writes++},reload:async()=>{},busy:false}))});await addRoom(tree,'Room A')
 assert.match(text(tree.toJSON()),/unique name/);assert.equal(button(tree,'Save classrooms').props.disabled,true)
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})});assert.equal(writes,0);await act(async()=>tree.unmount())
})
