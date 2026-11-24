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
runInNewContext(code,{module,exports:module.exports,require:n=>n==='react'?React:require(n)})
const Component=module.exports.default
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):''
const config={classrooms:['Room A'],practice_mode:true,read_only:false}
test('Classroom draft survives a background settings refresh; save submits only classrooms and confirms persistence',async()=>{
 const writes=[];let reloads=0,tree
 const props={config,call:async(...args)=>{writes.push(args);return {classrooms:['Room A','Room B']}},reload:async()=>{reloads++},busy:false}
 await act(async()=>{tree=create(React.createElement(Component,props))})
 await act(async()=>{tree.root.findByType('textarea').props.onChange({target:{value:'Room A\nRoom B\nRoom B'}})})
 await act(async()=>{tree.update(React.createElement(Component,{...props,config:{...config,staff:{someone:'scanner'}}}))})
 assert.equal(tree.root.findByType('textarea').props.value,'Room A\nRoom B\nRoom B')
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[['/classrooms','PUT',{classrooms:['Room A','Room B'],expected_classrooms:['Room A']}]])
 assert.equal(reloads,1);assert.match(text(tree.toJSON()),/2 classrooms saved for this event/)
 await act(async()=>tree.unmount())
})
test('Conflict retains draft and explains that saved rooms changed',async()=>{
 let tree;const props={config,call:async()=>{throw new Error('Classrooms changed elsewhere')},reload:async()=>{},busy:false}
 await act(async()=>{tree=create(React.createElement(Component,props))})
 await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'Room A\nMy new room'}}))
 await act(async()=>tree.update(React.createElement(Component,{...props,config:{...config,classrooms:['Room A','Another room']}})))
 assert.equal(tree.root.findByType('textarea').props.value,'Room A\nMy new room')
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 assert.match(text(tree.toJSON()),/Classrooms changed elsewhere/)
 assert.equal(tree.root.findByType('textarea').props.value,'Room A\nMy new room')
 await act(async()=>tree.unmount())
})
test('Unedited list follows saved settings and view-only access cannot save',async()=>{
 let writes=0,tree;const props={config,call:async()=>{writes++},reload:async()=>{},busy:false}
 await act(async()=>{tree=create(React.createElement(Component,props))})
 await act(async()=>tree.update(React.createElement(Component,{...props,config:{...config,classrooms:['Room A','Room C'],read_only:true}})))
 assert.equal(tree.root.findByType('textarea').props.value,'Room A\nRoom C')
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})})
 assert.equal(writes,0);assert.equal(tree.root.findByType('textarea').props.disabled,true)
 await act(async()=>tree.unmount())
})
