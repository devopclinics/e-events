import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
const require=createRequire(import.meta.url),module={exports:{}}
const code=transformSync(readFileSync(new URL('../src/components/JuniorVolunteerEntryTable.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code
runInNewContext(code,{module,exports:module.exports,crypto:globalThis.crypto,require:n=>n==='react'?React:n.endsWith('.css')?{}:require(n)})
const Component=module.exports.default,text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):''
const input=(tree,name)=>tree.root.findAllByType('input').find(i=>i.props['aria-label']===name)
const button=(tree,label)=>tree.root.findAllByType('button').find(b=>text(b.children)===label)
test('Rows save individual contacts, roles and classrooms; empty added rows are ignored',async()=>{
 let tree;const writes=[];await act(async()=>{tree=create(React.createElement(Component,{classrooms:['Room A'],onSave:async(...args)=>{writes.push(args);return true}}))})
 await act(async()=>input(tree,'Volunteer 1 name').props.onChange({target:{value:'Amina'}}));await act(async()=>input(tree,'Volunteer 1 email').props.onChange({target:{value:'amina@example.com'}}));await act(async()=>input(tree,'Volunteer 1 classroom Room A').props.onChange())
 await act(async()=>button(tree,'+ Add volunteer row').props.onClick());await act(async()=>input(tree,'Volunteer 2 name').props.onChange({target:{value:'Musa'}}));await act(async()=>input(tree,'Volunteer 2 email').props.onChange({target:{value:'musa@example.com'}}));await act(async()=>tree.root.findAllByType('select')[1].props.onChange({target:{value:'support'}}));await act(async()=>button(tree,'+ Add volunteer row').props.onClick())
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[[[{name:'Amina',email:'amina@example.com',phone:null,role:'scanner',classrooms:['Room A']},{name:'Musa',email:'musa@example.com',phone:null,role:'support',classrooms:[]}],true]])
 assert.equal(input(tree,'Volunteer 1 name').props.value,'');await act(async()=>tree.unmount())
})
test('Rejected bulk save retains row values and removing a row preserves its neighbour',async()=>{
 let tree;await act(async()=>{tree=create(React.createElement(Component,{classrooms:[],onSave:async()=>false}))});await act(async()=>input(tree,'Volunteer 1 name').props.onChange({target:{value:'First'}}));await act(async()=>input(tree,'Volunteer 1 email').props.onChange({target:{value:'first@example.com'}}));await act(async()=>button(tree,'+ Add volunteer row').props.onClick());await act(async()=>input(tree,'Volunteer 2 name').props.onChange({target:{value:'Second'}}));await act(async()=>input(tree,'Volunteer 2 email').props.onChange({target:{value:'second@example.com'}}))
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(input(tree,'Volunteer 2 name').props.value,'Second')
 await act(async()=>tree.root.findAllByType('button').find(b=>b.props['aria-label']==='Remove volunteer row 1').props.onClick());assert.equal(input(tree,'Volunteer 1 name').props.value,'Second');await act(async()=>tree.unmount())
})
test('Case-insensitive duplicate emails block the batch before any notification is queued',async()=>{
 let tree,writes=0;await act(async()=>{tree=create(React.createElement(Component,{classrooms:[],onSave:async()=>{writes++}}))});await act(async()=>input(tree,'Volunteer 1 email').props.onChange({target:{value:'same@example.com'}}));await act(async()=>button(tree,'+ Add volunteer row').props.onClick());await act(async()=>input(tree,'Volunteer 2 email').props.onChange({target:{value:'SAME@example.com'}}));await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes,0);assert.match(text(tree.toJSON()),/only once/);await act(async()=>tree.unmount())
})
