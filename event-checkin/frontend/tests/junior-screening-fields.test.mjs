import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
const req=createRequire(import.meta.url),mod={exports:{}}
runInNewContext(transformSync(readFileSync(new URL('../src/components/JuniorScreeningFields.jsx',import.meta.url),'utf8'),{loader:'jsx',jsx:'automatic',format:'cjs'}).code,{module:mod,exports:mod.exports,require:req})
const Component=mod.exports.default
for(const [title,profile,expected] of [['Registration answers prefill explicit Yes and No',{allergy:{value:true,source:'registration'},accommodation:{value:false,source:'registration'}},['allergy:yes','accommodation:no']],['Missing and unknown answers remain unselected',{allergy:{value:null,source:'missing'},accommodation:{value:null,source:'registration'}},[]],['Previous screening prefills without assuming a daily confirmation',{allergy:{value:false,source:'previous_screening'},accommodation:{value:true,source:'previous_screening'}},['allergy:no','accommodation:yes']]])test(title,async()=>{let tree;await act(async()=>{tree=create(React.createElement(Component,{profile}))});const inputs=tree.root.findAllByType('input');assert.deepEqual(inputs.filter(i=>i.props.type==='radio'&&i.props.defaultChecked).map(i=>i.props.name+':'+i.props.value),expected);assert.ok(inputs.every(i=>i.props.required));const confirmation=inputs.find(i=>i.props.name==='screening_confirmed');assert.equal(confirmation.props.defaultChecked,undefined);assert.equal(confirmation.props.type,'checkbox');await act(async()=>tree.unmount())})
