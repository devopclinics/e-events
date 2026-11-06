import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {transformSync} from 'esbuild'
import React from 'react'
import {create,act} from 'react-test-renderer'
import {STAFF_FEATURES,canSeeStaffFeature,staffRouteFeature} from '../src/lib/staffFeatures.js'
const require=createRequire(import.meta.url)
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):''
function setup(){
 let member={id:'link',user:{id:'staff',name:'Test Staff',email:'staff@example.test'},event_role:'staff',access_level:'edit',feature_permissions:{},section_group_ids:[],updated_at:'2026-11-06T10:00:00'}
 const writes=[]
 const api={listMembers:async()=>[structuredClone(member)],listOrgMembers:async()=>[],listTableGroups:async()=>[],updateMemberPermissions:async(event,user,patch,version)=>{writes.push({event,user,patch,version});member={...member,...patch,updated_at:'2026-11-06T10:01:00'}}}
 const shell={__esModule:true,default:({children})=>React.createElement('main',{},children),Icon:()=>null,ConfirmDialog:()=>null}
 const modules={'../components/StaffAccessGuide':{__esModule:true,default:()=>null},react:React,'react-router-dom':{useSearchParams:()=>[new URLSearchParams('tab=team'),()=>{}]},'../api':{api},'./redesign/RedesignShell':shell,'../lib/staffFeatures':{STAFF_FEATURES},'./redesign/RedesignPrimitives':{LoadingSkeleton:()=>null,EmptyState:()=>null,ErrorRetryState:()=>null},'../hooks/useCurrentEvent':{useCurrentEvent:()=>['event']},'../hooks/useEventDetails':{useEventDetails:()=>({event:{name:'Test Event',my_access_role:'org_admin'},loading:false})},'../hooks/useEventResources':{useTasks:()=>({data:[],loading:false})}}
 const source=readFileSync(new URL('../src/pages/TeamRedesignPage.jsx',import.meta.url),'utf8')
 const code=transformSync(source,{loader:'jsx',jsx:'automatic',format:'cjs'}).code,module={exports:{}}
 runInNewContext(code,{module,exports:module.exports,window:{setTimeout(){}},require:n=>n.endsWith('.css')?{}:modules[n]??require(n),URLSearchParams})
 return {Page:module.exports.default,writes}
}
test('actual staff editor saves only the selected feature and concurrency version',async()=>{
 const {Page,writes}=setup();let tree
 await act(async()=>{tree=create(React.createElement(Page))})
 assert.match(text(tree.toJSON()),/No features enabled/)
 const edit=tree.root.findAllByType('button').find(b=>text(b.children)==='Edit access')
 await act(async()=>{edit.props.onClick()})
 const guest=tree.root.findAllByType('select').find(s=>s.props['aria-label']==='Guest list access for Test Staff')
 assert.ok(guest)
 await act(async()=>{await guest.props.onChange({target:{value:'view'}})})
 assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{event:'event',user:'staff',patch:{feature_permissions:{guests:'view'}},version:'2026-11-06T10:00:00'})
 await act(async()=>{tree.unmount()})
})
test('navigation and deep links distinguish guest exports, messaging and event selection',()=>{
 const event={my_feature_permissions:{export:'view',scanner:'manage'}}
 assert.equal(staffRouteFeature('/guest-export'),'export')
 assert.equal(staffRouteFeature('/guests-redesign','?tab=invite'),'messages')
 assert.equal(canSeeStaffFeature(event,staffRouteFeature('/guest-export')),true)
 assert.equal(canSeeStaffFeature(event,staffRouteFeature('/guests-redesign')),false)
 assert.equal(canSeeStaffFeature(event,staffRouteFeature('/events-redesign')),true)
})
test('event manager invitation does not grant an organization administrator role',()=>{
 const source=readFileSync(new URL('../src/pages/TeamRedesignPage.jsx',import.meta.url),'utf8')
 assert.ok(source.includes("api.inviteOrgMember(eventId, { email, role: 'staff' })"))
 assert.ok(!source.includes("role === 'manager' ? 'admin'"))
})
