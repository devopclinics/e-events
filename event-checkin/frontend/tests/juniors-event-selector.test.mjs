import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {readFileSync} from 'node:fs'
import{createRequire}from'node:module'
import{runInNewContext}from'node:vm'
import{transformSync}from'esbuild'
import{isNCNMO,juniorEventName}from'../src/juniorProgramme.mjs'
const req=createRequire(import.meta.url),code=transformSync(readFileSync(new URL('../src/components/JuniorsAppShell.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code
const rows=[{id:'qa-unrelated',name:'QA ABC',junior_program_enabled:false},{id:'practice',name:'Practice',junior_program_enabled:true}]
async function render(eventId){const mod={exports:{}},navigation=[];runInNewContext(code,{module:mod,exports:mod.exports,navigator:{onLine:true},document:{title:'Test',querySelector:()=>null},window:{matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){}},require:n=>n==='react'?React:n==='react-router-dom'?{useNavigate:()=>value=>navigation.push(value)}:n==='../api'?{api:{listEvents:async()=>rows}}:n==='../hooks/useCurrentEvent'?{useCurrentEvent:()=>[eventId]}:n==='../context/AuthContext'?{useAuth:()=>({user:{name:'QA'},logout(){}})}:n==='../juniorProgramme.mjs'?{isNCNMO,juniorEventName}:n==='../pages/redesign/RedesignShell'?{Icon:()=>null}:n==='./JuniorsThemeSwitch'?{__esModule:true,default:()=>null}:req(n)});let tree;await act(async()=>{tree=create(React.createElement(mod.exports.default,null,'Workspace'))});return{tree,select:tree.root.findByType('select'),navigation}}
test('Disabled selected event remains visible rather than falsely displaying an enabled event',async()=>{const{tree,select,navigation}=await render('qa-unrelated');assert.equal(select.props.value,'qa-unrelated');const option=select.findAllByType('option').find(n=>n.props.value==='qa-unrelated');assert.equal(option.props.disabled,true);assert.match(option.children.join(''),/QA ABC.*Juniors not enabled/);assert.equal(navigation.length,0);await act(async()=>tree.unmount())})
test('Unknown or revoked current event uses the placeholder, never another event',async()=>{const{tree,select,navigation}=await render('revoked-event');assert.equal(select.props.value,'');assert.equal(navigation.length,0);await act(async()=>tree.unmount())})
test('Enabled current event remains selected and event changes use the authorized query route',async()=>{const{tree,select,navigation}=await render('practice');assert.equal(select.props.value,'practice');await act(async()=>select.props.onChange({target:{value:'practice'}}));assert.equal(navigation[0],'/juniors/?event=practice');assert.equal(select.findAllByType('option').filter(n=>!n.props.disabled).length,1);await act(async()=>tree.unmount())})
