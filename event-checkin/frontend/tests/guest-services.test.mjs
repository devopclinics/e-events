import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import React from 'react'
import { CONTENT } from '../src/guideContent.mjs'
import { create, act } from 'react-test-renderer'
const require = createRequire(import.meta.url)
function harness(api, selection = 'event-a') {
  let selected = selection, refreshCallback
  const queueModule = { exports: {} }
  runInNewContext(transformSync(readFileSync(new URL('../src/components/MealRequestQueue.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code,{module:queueModule,exports:queueModule.exports,require:name=>name.endsWith('.css')?{}:require(name),Map,Set,JSON})
  const attendanceModule={exports:{}}
  runInNewContext(transformSync(readFileSync(new URL('../src/components/MealAttendancePanel.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code,{module:attendanceModule,exports:attendanceModule.exports,require:name=>name.endsWith('.css')?{}:name==='./QrCameraScanner'?()=>null:require(name),URL})
  const activityModule = { exports: {} }
  runInNewContext(transformSync(readFileSync(new URL('../src/components/GuestServiceActivity.jsx', import.meta.url), 'utf8'), {loader:'jsx',format:'cjs',jsx:'automatic'}).code, {module:activityModule,exports:activityModule.exports,require:name=>name==='../api'?{api}:require(name),URL,Blob:globalThis.Blob,setTimeout,clearTimeout})
  const modules = {
    '../hooks/useGuestServiceOffline': ()=>({online:true,rows:[],syncing:false,storageError:'',actor:null,cache:async()=>{},cached:async()=>null}),
    '../components/GuestServiceOfflinePanel': ()=>null,
    '../lib/guestServiceOffline.mjs':{queuedAction:()=>({})},
    '../components/GuestServiceActivity': activityModule.exports,
    '../components/MealAttendancePanel':attendanceModule.exports,
    '../components/MealRequestQueue': queueModule.exports,
    '../api': { api },
    '../guideContent.mjs': { CONTENT },
    '../hooks/useCurrentEvent': { useCurrentEvent: () => [selected] },
    './redesign/RedesignShell': ({ children }) => React.createElement('div', null, children),
    '../components/QrCameraScanner': () => null,
    'react-router-dom': { Link: ({ children }) => React.createElement('a', null, children) },
    './GuestServicesPage.css': {},
  }
  const module = { exports: {} }
  const code = transformSync(readFileSync(new URL('../src/pages/GuestServicesPage.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code
  const document = { body: { style: {} }, hidden: false, addEventListener() {}, removeEventListener() {} }
  runInNewContext(code, { document, module, exports: module.exports, require: name => modules[name] ?? require(name), URL, Date, Map, Object, setTimeout, clearTimeout, crypto: { randomUUID: () => 'synthetic-request-key' }, setInterval: callback => { refreshCallback = callback; return 1 }, clearInterval() {} })
  return { Page: module.exports.default, passToken: module.exports.passToken, select: id => { selected = id }, hide: value => { document.hidden = value }, refresh: () => refreshCallback() }
}
const base = () => ({ event_id: 'event-a', event_name: 'Conference', is_supervisor: false, can_configure: false, assignments: [{ id: 'assignment', table_id: 'table-a', name: 'Table A', active: true }], zones: [], menu_categories: [], request_assignees: [], guests: [{ id: 'guest-a', name: 'Ada', table_id: 'table-a', table_name: 'Table A', admitted: true, seated_at: null, can_checkin: false, can_manage_meals: false, choices: [], meal_services: [] }] })
const text = node => node.children.map(c => typeof c === 'string' ? c : text(c)).join('')
const button = (root, label) => root.root.findAllByType('button').find(b => text(b).replace(/^[＋?] /, '') === label)
const change = async (element, value) => act(async () => element.props.onChange({ target: { value } }))

test('staff sees assigned workspace and seating action uses its existing guest identity', async () => {
  const data = base(), calls = []
  const h = harness({ guestServices: async () => data, markGuestSeated: async (...args) => { calls.push(args); data.guests[0].seated_at = '2026-10-19T10:00:00' } })
  let root; await act(async () => { root = create(React.createElement(h.Page)) })
  assert.equal(button(root, 'Assign staff'), undefined)
  await act(async () => button(root, 'Guests1').props.onClick())
  await act(async () => button(root, 'Open guest →').props.onClick())
  await act(async () => button(root, 'Mark seated').props.onClick())
  assert.deepEqual(calls, [['event-a', 'guest-a', true]])
  assert.ok(button(root, 'Correct seating confirmation'))
  await act(async () => root.unmount())
})

test('organiser can save multiple table assignments without creating tasks', async () => {
  const data = { ...base(), is_supervisor: true, can_configure: true, team: [{ id: 'member-a', name: 'Host', event_role: 'staff', scoped: true, updated_at: '2026-10-19T10:00:00', assignments: [] }], locations: { tables: [{ id: 'table-a', name: 'Table A' }, { id: 'table-b', name: 'Table B' }], zones: [] } }
  const calls = [], h = harness({ guestServices: async () => data, configureGuestServices: async (...args) => calls.push(args) })
  let root; await act(async () => { root = create(React.createElement(h.Page)) })
  await act(async () => button(root, 'Assign staff').props.onClick())
  await change(root.root.findByProps({'aria-label':'Team member'}), 'member-a')
  await act(async () => button(root, 'Add table or room').props.onClick())
  await act(async () => button(root, 'Add table or room').props.onClick())
  await change(root.root.findByProps({ 'aria-label': 'Location 1' }), 'table:table-a')
  await change(root.root.findByProps({ 'aria-label': 'Location 2' }), 'table:table-b')
  await act(async () => root.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2].scoped, true)
  assert.deepEqual(Array.from(calls[0][2].assignments, r => r.table_id), ['table-a', 'table-b'])
  assert.equal(calls[0][2].assignments[0].can_checkin, false)
  await act(async () => root.unmount())
})

test('failed help request retries with the same idempotency key and uses canonical task API', async () => {
  const data = base(), calls = []; let fail = true
  const h = harness({ guestServices: async () => data, guestServiceRequest: async (...args) => { calls.push(args); if (fail) throw new Error('Temporary error'); return { task_id: 'canonical-task' } } })
  let root; await act(async () => { root = create(React.createElement(h.Page)) })
  await act(async () => button(root, 'Requests').props.onClick())
  await act(async () => button(root, 'Request assistance').props.onClick())
  const forms = () => root.root.findAllByType('form'), form = () => forms().at(-1)
  const selects = form().findAllByType('select'); await change(selects[0], 'assignment')
  await change(form().findByType('input'), 'Water needed')
  await act(async () => form().props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.length, 1)
  assert.equal(root.root.findByProps({ role: 'alert' }).children[0], 'Temporary error')
  fail = false
  await act(async () => form().props.onSubmit({ preventDefault() {} }))
  assert.equal(calls.length, 2)
  assert.equal(calls[0][1].request_key, calls[1][1].request_key)
  assert.equal(calls[1][1].assignment_id, 'assignment')
  await act(async () => root.unmount())
})

test('late response from a previous event never replaces the selected event roster', async () => {
  const pending = []
  const h = harness({ guestServices: id => new Promise(resolve => pending.push({ id, resolve })) })
  let root; await act(async () => { root = create(React.createElement(h.Page)) })
  h.select('event-b'); await act(async () => root.update(React.createElement(h.Page)))
  await act(async () => pending.find(p => p.id === 'event-b').resolve({ ...base(), event_id: 'event-b', guests: [] }))
  await act(async () => pending.find(p => p.id === 'event-a').resolve(base()))
  assert.equal(button(root, 'Mark seated'), undefined)
  await act(async () => root.unmount())
})

test('in-page help reuses the shared instructions and shows setup only to organisers',async()=>{
  const data=base(),h=harness({guestServices:async()=>data});let root
  await act(async()=>{root=create(React.createElement(h.Page))})
  await act(async()=>button(root,'Quick guide').props.onClick())
  assert.ok(root.root.findByProps({'aria-label':'Guest Services help'}))
  assert.ok(root.root.findAllByType('summary').some(n=>text(n)==='Staff steps: arrival, meals and requests'))
  assert.ok(!root.root.findAllByType('summary').some(n=>text(n).startsWith('Organiser setup')))
  const content=text(root.root.findByProps({'aria-label':'Guest Services help'}))
  assert.ok(content.includes(CONTENT.staff.topics.find(t=>t.id==='staff-guest-services').steps[0]))
  await act(async()=>root.unmount())
})

test('served menu is read-only while a later meal remains editable',async()=>{
 const data=base(),calls=[]
 data.menu_categories=[{id:'lunch',name:'Lunch',is_required:true,selection_type:'single',items:[{id:'rice',name:'Rice'}]},{id:'dinner',name:'Dinner',is_required:false,selection_type:'single',items:[{id:'plate',name:'Dinner plate'}]}]
 Object.assign(data.guests[0],{can_manage_meals:true,locked_category_ids:['lunch'],menu_selections_locked:false,choices:[{category_id:'lunch',item_id:'rice',name:'Rice'}]})
 const h=harness({guestServices:async()=>data,assistGuestMenu:async(...args)=>calls.push(args)});let root
 await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Guests1').props.onClick())
 await act(async()=>button(root,'Open guest →').props.onClick())
 await act(async()=>button(root,'Help choose menu').props.onClick())
 assert.equal(root.root.findAllByProps({'aria-label':'Lunch'}).length,0)
 await change(root.root.findByProps({'aria-label':'Dinner'}),'plate')
 const agreed=root.root.findAllByType('input').find(n=>n.props.required&&n.props.type==='checkbox')
 await act(async()=>agreed.props.onChange({target:{checked:true}}))
 const form=root.root.findAllByType('form').find(f=>f.findAllByType('h3').some(h=>text(h)==='Help Ada choose'))
 await act(async()=>form.props.onSubmit({preventDefault(){}}))
 assert.equal(calls[0][2].single.dinner,'plate');assert.equal(calls[0][2].single.lunch,undefined);assert.equal(calls[0][2].guest_agreed,true)
 await act(async()=>root.unmount())
})

test('clearing an optional menu choice explicitly tells the server to remove it',async()=>{
 const data=base(),calls=[]
 data.menu_categories=[{id:'dessert',name:'Dessert',is_required:false,selection_type:'single',items:[{id:'cake',name:'Cake'}]}]
 Object.assign(data.guests[0],{can_manage_meals:true,choices:[{category_id:'dessert',item_id:'cake',name:'Cake'}]})
 const h=harness({guestServices:async()=>data,assistGuestMenu:async(...args)=>calls.push(args)});let root
 await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Guests1').props.onClick())
 await act(async()=>button(root,'Open guest →').props.onClick())
 await act(async()=>button(root,'Help choose menu').props.onClick())
 await change(root.root.findByProps({'aria-label':'Dessert'}),'')
 const agreed=root.root.findAllByType('input').find(n=>n.props.required&&n.props.type==='checkbox');await act(async()=>agreed.props.onChange({target:{checked:true}}))
 const form=root.root.findAllByType('form').find(f=>f.findAllByType('h3').some(h=>text(h)==='Help Ada choose'));await act(async()=>form.props.onSubmit({preventDefault(){}}))
 assert.deepEqual(Array.from(calls[0][2].clear_categories),['dessert']);assert.equal(calls[0][2].single.dessert,undefined)
 await act(async()=>root.unmount())
})

test('board and canvas include empty assigned tables and provide direct table editing',async()=>{
 const data={...base(),is_supervisor:true,can_configure:true,team:[],tables:[{id:'table-a',name:'Table A',capacity:8},{id:'empty',name:'Empty Table',capacity:10}],locations:{tables:[{id:'table-a',name:'Table A',capacity:8,category:'VIP',sort_order:4,updated_at:'table-version'},{id:'empty',name:'Empty Table',capacity:10,category:null,sort_order:0,updated_at:'empty-version'}],zones:[]}}
 const calls=[],h=harness({guestServices:async()=>data,updateTable:async(...args)=>calls.push(args)});let root
 await act(async()=>{root=create(React.createElement(h.Page))})
 assert.equal(root.root.findAllByType('article').filter(n=>n.props.className?.includes('gs-table-card')).length,2)
 await act(async()=>button(root,'Floor canvas').props.onClick())
 assert.ok(root.root.findByProps({'aria-label':'Open Empty Table'}))
 await act(async()=>button(root,'Board').props.onClick())
 await act(async()=>root.root.findByProps({'aria-label':'Edit Table A'}).props.onClick())
 const form=root.root.findByType('form'),inputs=form.findAllByType('input');await change(inputs[0],'Community East');await change(inputs.find(i=>i.props.type==='number'),'12')
 await act(async()=>form.props.onSubmit({preventDefault(){}}))
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['event-a','table-a',{name:'Community East',capacity:12,category:'VIP',service_section:null,sort_order:4},'table-version']])
 await act(async()=>root.unmount())
})

test('editing a member preserves mixed per-location grants, leads and shift bounds',async()=>{
 const assignments=[{id:'one',table_id:'table-a',zone_id:null,name:'Table A',active:true,is_lead:true,can_checkin:true,can_manage_meals:false,can_scan_zone:false,starts_at:null,ends_at:null},{id:'two',zone_id:'room',table_id:null,name:'Room',active:true,is_lead:false,can_checkin:false,can_manage_meals:false,can_scan_zone:true,starts_at:'2026-10-19T12:00:00',ends_at:'2026-10-19T13:00:00'}]
 const member={id:'m',name:'Staff',event_role:'staff',scoped:true,updated_at:'version',assignments},data={...base(),is_supervisor:true,can_configure:true,team:[member],locations:{tables:[{id:'table-a',name:'Table A'}],zones:[{id:'room',name:'Room'}]}}
 const calls=[],h=harness({guestServices:async()=>data,configureGuestServices:async(...args)=>calls.push(args)});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Assign staff').props.onClick());await change(root.root.findByProps({'aria-label':'Team member'}),'m')
 await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}))
 const rows=calls[0][2].assignments;assert.equal(rows[0].can_manage_meals,false);assert.equal(rows[0].can_checkin,true);assert.equal(rows[0].is_lead,true);assert.equal(rows[1].can_scan_zone,true);assert.equal(rows[1].is_lead,false);assert.equal(rows[1].starts_at,'2026-10-19T12:00:00.000Z');assert.equal(rows[1].ends_at,'2026-10-19T13:00:00.000Z')
 await act(async()=>root.unmount())
})

test('placeholder editing uses canonical identity version and is hidden for real staff',async()=>{
 const member={id:'m',name:'Placeholder',event_role:'staff',scoped:true,updated_at:'version',can_rename_placeholder:true,assignments:[]},data={...base(),is_supervisor:true,can_configure:true,team:[member,{...member,id:'real',name:'Real staff',can_rename_placeholder:false}],locations:{tables:[],zones:[]}}
 const calls=[],h=harness({guestServices:async()=>data,renameGuestServicePlaceholder:async(...args)=>calls.push(args)});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Staff2').props.onClick());assert.equal(root.root.findAllByType('button').filter(n=>text(n)==='Edit name').length,1)
 await act(async()=>button(root,'Edit name').props.onClick());const form=root.root.findByType('form');await change(form.findByType('input'),'Amina Yusuf');await act(async()=>form.props.onSubmit({preventDefault(){}}));assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['event-a','m',{name:'Amina Yusuf',if_unmodified_since:'version'}]])
 await act(async()=>root.unmount())
})

test('room scan opens the existing scanner with the selected zone and direction',async()=>{
 const data={...base(),zones:[{id:'room',name:'Hall A',can_scan:true,inside:[]}]},calls=[],h=harness({guestServices:async()=>data,guestServiceScan:async(...args)=>{calls.push(args);return{status:'ok'}}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Rooms1').props.onClick());await act(async()=>button(root,'Open room →').props.onClick());await act(async()=>button(root,'Scan exit').props.onClick())
 const form=root.root.findByType('form');await change(form.findByType('input'),'guest-pass');await act(async()=>form.props.onSubmit({preventDefault(){}}));assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['event-a',{token:'guest-pass',zone_id:'room',direction:'out'}]])
 await act(async()=>root.unmount())
})

test('acknowledged task stays saved when the following roster refresh fails',async()=>{
 const data=base(),calls=[];let failRefresh=false
 const h=harness({guestServices:async()=>{if(failRefresh)throw new Error('Network unavailable');return data},guestServiceRequest:async(...args)=>{calls.push(args);failRefresh=true;return{task_id:'saved-task'}}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Requests').props.onClick());await act(async()=>button(root,'Request assistance').props.onClick());const form=root.root.findByType('form');await change(form.findAllByType('select')[0],'assignment');await change(form.findByType('input'),'Water needed');await act(async()=>form.props.onSubmit({preventDefault(){}}))
 assert.equal(calls.length,1);assert.equal(root.root.findAllByProps({role:'dialog'}).length,0);assert.ok(text(root.root.findByProps({role:'status'})).includes('Request added to team Tasks'));assert.ok(text(root.root.findByProps({role:'alert'})).includes('Saved successfully'));assert.ok(text(root.root).includes('View saved task →'))
 failRefresh=false;await act(async()=>button(root,'Refresh').props.onClick());assert.equal(calls.length,1);await act(async()=>root.unmount())
})

test('polling authorization loss clears the roster and closes operational drawers',async()=>{
 let revoked=false;const h=harness({guestServices:async()=>{if(revoked)throw Object.assign(new Error('Forbidden'),{status:403});return base()}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Guests1').props.onClick());await act(async()=>button(root,'Open guest →').props.onClick());revoked=true;await act(async()=>h.refresh())
 assert.equal(root.root.findAllByProps({role:'dialog'}).length,0);assert.ok(!text(root.root).includes('Ada'));assert.equal(button(root,'Mark seated'),undefined);await act(async()=>root.unmount())
})

test('network-stale snapshot disables mutations but its drawer remains closable and refreshable',async()=>{
 let offline=false;const h=harness({guestServices:async()=>{if(offline)throw new Error('Offline');return base()}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Guests1').props.onClick());await act(async()=>button(root,'Open guest →').props.onClick());offline=true;await act(async()=>h.refresh());assert.equal(button(root,'Mark seated').props.disabled,true);assert.equal(root.root.findByProps({'aria-label':'Close panel'}).props.disabled,false)
 offline=false;await act(async()=>button(root,'Refresh workspace').props.onClick());assert.equal(button(root,'Mark seated').props.disabled,false);await act(async()=>root.unmount())
})

test('guardian pass is forwarded with the original junior, zone and direction',async()=>{
 const data={...base(),zones:[{id:'room',name:'Hall',can_scan:true,inside:[]}],manual_guardian_verification_enabled:false},calls=[]
 const h=harness({guestServices:async()=>data,guestServiceScan:async(...args)=>{calls.push(args);return calls.length===1?{status:'guardian_required',guest_name:'Junior',guardian_candidates:[]}:{status:'ok'}}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Rooms1').props.onClick());await act(async()=>button(root,'Open room →').props.onClick());await act(async()=>button(root,'Scan exit').props.onClick());let form=root.root.findByType('form');await change(form.findByType('input'),'junior-pass');await act(async()=>form.props.onSubmit({preventDefault(){}}));assert.ok(root.root.findByProps({'aria-label':'Guardian verification'}))
 form=root.root.findByType('form');await change(form.findByType('input'),'adult-pass');await act(async()=>form.props.onSubmit({preventDefault(){}}));assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),['event-a',{token:'junior-pass',zone_id:'room',direction:'out',guardian_token:'adult-pass',guardian_guest_id:null}]);assert.equal(root.root.findAllByProps({'aria-label':'Guardian verification'}).length,0);await act(async()=>root.unmount())
})

test('manual guardian verification requires enabled policy and explicit identity confirmation',async()=>{
 const data={...base(),zones:[{id:'room',name:'Hall',can_scan:true,inside:[]}],manual_guardian_verification_enabled:true},calls=[]
 const h=harness({guestServices:async()=>data,guestServiceScan:async(...args)=>{calls.push(args);return calls.length===1?{status:'guardian_required',guest_name:'Junior',guardian_candidates:[{guardian_guest_id:'adult',name:'Mary',relationship:'Parent'}]}:{status:'ok'}}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Rooms1').props.onClick());await act(async()=>button(root,'Open room →').props.onClick());await act(async()=>button(root,'Scan entry').props.onClick());const form=root.root.findByType('form');await change(form.findByType('input'),'junior');await act(async()=>form.props.onSubmit({preventDefault(){}}));const confirm=()=>button(root,'Confirm Mary · Parent');assert.equal(confirm().props.disabled,true)
 const identity=root.root.findAllByType('input').find(i=>i.props.type==='checkbox');await act(async()=>identity.props.onChange({target:{checked:true}}));await act(async()=>confirm().props.onClick());assert.equal(calls[1][1].guardian_guest_id,'adult');assert.equal(calls[1][1].guardian_token,null);await act(async()=>root.unmount())
})

test('future and full meal services are disabled and excluded from actionable attention',async()=>{
 const data=base();Object.assign(data.guests[0],{seated_at:'2026-01-01',can_manage_meals:true,meal_services:[{id:'later',name:'Dinner',status:'open',eligible:true,served:false,can_serve:false,availability_reason:'Collection has not started'},{id:'full',name:'Lunch',status:'open',eligible:true,served:false,can_serve:false,availability_reason:'Collection is full'}]})
 const h=harness({guestServices:async()=>data});let root;await act(async()=>{root=create(React.createElement(h.Page))});assert.equal(text(root.root.findByProps({className:'gs-summary'}).findAllByType('strong')[3]),'0');await act(async()=>button(root,'Guests1').props.onClick());await act(async()=>button(root,'Open guest →').props.onClick());assert.ok(root.root.findAllByType('button').filter(b=>text(b)==='Mark served').every(b=>b.props.disabled));assert.ok(text(root.root).includes('Collection has not started'));await act(async()=>root.unmount())
})

test('guests who have not arrived are not counted as needing attention and counts are singular',async()=>{
 const data={...base(),is_supervisor:true,can_configure:true,tables:[{id:'table-a',name:'Table A',capacity:8}],locations:{tables:[{id:'table-a',name:'Table A',capacity:8}],zones:[]},team:[]};data.guests[0].admitted=false
 const h=harness({guestServices:async()=>data});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 assert.equal(text(root.root.findByProps({className:'gs-summary'}).findAllByType('strong')[3]),'0')
 assert.ok(text(root.root).includes('1 table · Page 1 of 1'));assert.ok(!text(root.root).includes('1 tables'))
 await act(async()=>root.unmount())
})

test('unmatched room and staff searches explain the empty state and can be cleared',async()=>{
 const data={...base(),is_supervisor:true,can_configure:true,team:[{id:'staff',name:'Amina',event_role:'staff',scoped:true,assignments:[]}],locations:{tables:[],zones:[]},zones:[{id:'room',name:'Hall A',can_scan:true,inside:[]}]},h=harness({guestServices:async()=>data});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Rooms1').props.onClick());await change(root.root.findByProps({'aria-label':'Search workspace'}),'nonexistent');assert.ok(text(root.root).includes('No matching rooms'));await act(async()=>button(root,'Clear search').props.onClick());assert.equal(root.root.findAllByProps({className:'gs-room-card'}).length,1)
 await act(async()=>button(root,'Staff1').props.onClick());await change(root.root.findByProps({'aria-label':'Search workspace'}),'nonexistent');assert.ok(text(root.root).includes('No matching staff'));await act(async()=>root.unmount())
})

test('an action eligibility denial refreshes scope without falsely revoking event membership',async()=>{
 const data=base();Object.assign(data.guests[0],{can_manage_meals:true,meal_services:[{id:'meal',name:'Lunch',status:'open',eligible:true,served:false,can_serve:true}]})
 const h=harness({guestServices:async()=>data,serveGuestMeal:async()=>{data.guests[0].meal_services[0].eligible=false;data.guests[0].meal_services[0].can_serve=false;throw Object.assign(new Error('Guest is not eligible'),{status:403})}});let root
 await act(async()=>{root=create(React.createElement(h.Page))});await act(async()=>button(root,'Guests1').props.onClick());await act(async()=>button(root,'Open guest →').props.onClick());await act(async()=>button(root,'Mark served').props.onClick());assert.ok(text(root.root).includes('Ada'));assert.ok(text(root.root.findByProps({role:'alert'})).includes('Guest is not eligible'));assert.equal(button(root,'Mark served').props.disabled,true);await act(async()=>root.unmount())
})

test('100 tables default to compact pages and section/search filters reset pagination',async()=>{
 const tables=Array.from({length:100},(_,i)=>({id:`table-${i+1}`,name:`Table ${i+1}`,capacity:8,service_section:i<50?'East':'West'}));const data={...base(),is_supervisor:true,can_configure:true,guests:[],tables,team:[],locations:{tables,zones:[]}}
 const h=harness({guestServices:async()=>data});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 const rows=()=>root.root.findAllByType('article').filter(n=>n.props.className==='gs-table-list-row')
 assert.equal(rows().length,24);assert.ok(text(rows()[0]).includes('Table 1'))
 await act(async()=>button(root,'Next tables').props.onClick());assert.ok(text(rows()[0]).includes('Table 25'))
 await change(root.root.findByProps({'aria-label':'Table section'}),'West');assert.equal(rows().length,24);assert.ok(text(rows()[0]).includes('Table 51'))
 await change(root.root.findByProps({'aria-label':'Search workspace'}),'Table 100');assert.equal(rows().length,1);assert.equal(button(root,'Next tables').props.disabled,true)
 await act(async()=>root.unmount())
})
const mealRow=(id='one',status='pending')=>({id,guest_id:'guest-a',guest_name:'Ada',table_id:'table-a',table_name:'Table A',service_id:'lunch',service_name:'Lunch',choices:['Rice'],selection_key:'a'.repeat(64),status,status_label:({pending:'New',preparing:'Preparing',ready:'Ready',served:'Delivered'})[status],next_status:({pending:'preparing',preparing:'ready',ready:'served'})[status],can_progress:status!=='served',availability_reason:'Ready for collection'})
test('meal queue advances the canonical guest/service and alerts only after new scoped data arrives',async()=>{
 let data={...base(),meal_requests:[mealRow()]};const calls=[];const h=harness({guestServices:async()=>data,progressGuestMeal:async(...args)=>{calls.push(args);data={...data,meal_requests:[mealRow('one','preparing')]}}});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 assert.equal(root.root.findAllByProps({'aria-label':'Dismiss meal updates'}).length,0)
 await act(async()=>button(root,'Meal requests1').props.onClick());await act(async()=>button(root,'Start preparing').props.onClick());assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['event-a','guest-a','lunch',{status:'preparing',expected_status:'pending',selection_key:'a'.repeat(64)}]])
 data={...data,meal_requests:[mealRow('one','ready'),mealRow('two')]};await act(async()=>h.refresh());assert.ok(button(root,'View meal requests'));assert.ok(text(root.root).includes('2 meal updates'))
 await act(async()=>button(root,'Dismiss').props.onClick());await act(async()=>h.refresh());assert.equal(root.root.findAllByProps({'aria-label':'Dismiss meal updates'}).length,0)
 await act(async()=>root.unmount())
})
test('meal queue paginates requests and disables unavailable preparation',async()=>{
 const rows=Array.from({length:60},(_,i)=>({...mealRow(String(i)),can_progress:false,availability_reason:'Collection has not started'}));const h=harness({guestServices:async()=>({...base(),meal_requests:rows})});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Meal requests60').props.onClick());assert.equal(root.root.findAllByType('li').length,25);assert.equal(button(root,'Start preparing').props.disabled,true)
 await act(async()=>button(root,'Next requests').props.onClick());assert.equal(root.root.findAllByType('li').length,25)
 await change(root.root.findByProps({'aria-label':'Meal stage'}),'ready');assert.equal(root.root.findAllByType('li').length,0)
 await act(async()=>root.unmount())
})

const attendanceService=(mode='both',canConfigure=true)=>({id:'meal-one',name:'Saturday Lunch',tracking_mode:mode,scope:'Assigned tables',can_configure:canConfigure,can_scan:mode!=='orders',expected:3,attended:1,not_yet_attended:2,ordered:2,preparing:1,ready:0,delivered:1,attended_without_order:1,recent_attendees:[]})
test('meal attendance has explicit per-service mode and separately displays headcount and order totals',async()=>{
 let data={...base(),meal_services:[attendanceService('orders')]};const calls=[],h=harness({guestServices:async()=>data,configureMealTracking:async(...args)=>{calls.push(args);data={...data,meal_services:[attendanceService('both')]}}});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Meal attendance').props.onClick());assert.equal(button(root,'Record meal attendance'),undefined)
 await change(root.root.findByProps({'aria-label':'Meal tracking'}),'both');await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['event-a','meal-one',{tracking_mode:'both',expected_mode:'orders'},true]])
 const metrics=root.root.findByProps({className:'ma-metrics'});assert.ok(text(metrics).includes('1Attended'));assert.ok(text(metrics).includes('2Placed selections'));assert.ok(text(metrics).includes('1Delivered'))
 await act(async()=>root.unmount())
})
test('headcount pass scans use attendance API only and clearly acknowledge duplicate scans',async()=>{
 const data={...base(),meal_services:[attendanceService('headcount',false)]},calls=[];const h=harness({guestServices:async()=>data,scanMealAttendance:async(...args)=>{calls.push(args);return {guest_name:'Ada',already_counted:true,message:'Already counted for this meal'}}});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Meal attendance').props.onClick());assert.equal(root.root.findAllByProps({'aria-label':'Meal tracking'}).length,0)
 assert.ok(!text(root.root.findByProps({className:'ma-metrics'})).includes('Delivered'))
 await change(root.root.findByProps({'aria-label':'Meal attendance pass'}),'https://festio.events/rsvp/guest-pass#/home');await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['event-a','meal-one','guest-pass',true]])
 assert.ok(text(root.root).includes('Ada: Already counted for this meal'));assert.equal(root.root.findByProps({'aria-label':'Meal attendance pass'}).props.value,'')
 await act(async()=>root.unmount())
})
test('failed attendance correction retains reason and stale timestamp until acknowledged',async()=>{
 const service={...attendanceService(),recent_attendees:[{guest_id:'guest-a',name:'Ada',table_name:'Table A',attended_at:'2026-10-20T12:00:00',can_correct:true}]};let fail=true;const calls=[],h=harness({guestServices:async()=>({...base(),meal_services:[service]}),correctMealAttendance:async(...args)=>{calls.push(args);if(fail)throw new Error('Refresh required');return {corrected:true,message:'Attendance corrected'}}});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Meal attendance').props.onClick());await act(async()=>root.root.findByProps({'aria-label':'Correct attendance for Ada'}).props.onClick());await change(root.root.findByType('textarea'),'Wrong meal scanned at the door')
 const correctionForm=()=>root.root.findAllByType('form').find(f=>f.props.className==='ma-correction')
 await act(async()=>correctionForm().props.onSubmit({preventDefault(){}}));assert.ok(correctionForm());assert.equal(root.root.findByType('textarea').props.value,'Wrong meal scanned at the door')
 fail=false;await act(async()=>correctionForm().props.onSubmit({preventDefault(){}}));assert.equal(correctionForm(),undefined);assert.equal(calls[0][3].expected_attended_at,'2026-10-20T12:00:00')
 await act(async()=>root.unmount())
})

test('switching meal occurrence hides the previous scan receipt and irrelevant table search',async()=>{
 const services=[attendanceService('headcount',false),{...attendanceService('headcount',false),id:'meal-two',name:'Sunday Lunch'}];const h=harness({guestServices:async()=>({...base(),meal_services:services}),scanMealAttendance:async()=>({service_id:'meal-one',guest_name:'Ada',message:'Meal attendance recorded'})});let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Meal attendance').props.onClick());assert.equal(root.root.findAllByProps({'aria-label':'Search workspace'}).length,0)
 await change(root.root.findByProps({'aria-label':'Meal attendance pass'}),'guest-pass');await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.ok(text(root.root).includes('Ada: Meal attendance recorded'))
 await change(root.root.findByProps({'aria-label':'Attendance meal service'}),'meal-two');assert.ok(!text(root.root).includes('Ada: Meal attendance recorded'))
 await act(async()=>root.unmount())
})

test('hidden Guest Services tabs pause automatic workspace downloads', async () => {
  let calls=0
  const h=harness({guestServices:async()=>{calls++;return base()}})
  let root;await act(async()=>{root=create(React.createElement(h.Page))})
  assert.equal(calls,1)
  h.hide(true);await act(async()=>h.refresh());assert.equal(calls,1)
  h.hide(false);await act(async()=>h.refresh());assert.equal(calls,2)
  await act(async()=>root.unmount())
})

test('supervisor can open activity and filter its server-paged records', async () => {
  const data={...base(),is_supervisor:true,team:[],tables:[]}, calls=[]
  const h=harness({guestServices:async()=>data,guestServiceActivity:async(id,params)=>{calls.push([id,params]);return {total:1,rows:[{id:'entry',action:'scan_attempt',actor_name:'Table host',guest_name:'Ada',created_at:'2026-10-20T12:00:00',detail:{zone_id:'hall'}}]}}})
  let root;await act(async()=>{root=create(React.createElement(h.Page))})
  await act(async()=>button(root,'Activity').props.onClick())
  assert.match(JSON.stringify(root.toJSON()),/Table host/)
  assert.equal(calls[0][1].limit,50)
  const input=root.root.findAllByType('input').find(n=>n.props.placeholder==='e.g. meal_served')
  await change(input,'scan_attempt');assert.equal(calls.at(-1)[1].action,'scan_attempt')
  await act(async()=>root.unmount())
})

test('supervisor requests assistance by location without a personal assignment',async()=>{
 const data={...base(),is_supervisor:true,can_configure:true,assignments:[],team:[],locations:{tables:[{id:'table-a',name:'Table A',capacity:8}],zones:[{id:'room-a',name:'Hall'}]}}
 const calls=[],h=harness({guestServices:async()=>data,guestServiceRequest:async(...args)=>{calls.push(args);return {task_id:'help-task'}}})
 let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Requests').props.onClick());await act(async()=>button(root,'Request assistance').props.onClick())
 const form=root.root.findAllByType('form').at(-1)
 await change(form.findAllByType('select')[0],'zone:room-a');await change(form.findByType('input'),'Projector help')
 await act(async()=>form.props.onSubmit({preventDefault(){}}))
 assert.equal(calls.length,1);assert.equal(calls[0][1].zone_id,'room-a');assert.equal(calls[0][1].assignment_id,undefined)
 await act(async()=>root.unmount())
})

test('server pages preserve full-scope counters and do not slice page two twice',async()=>{
 const calls=[],data={...base(),pagination:{view:'guests',page:1,total:60,page_size:24},metrics:{assigned:60,admitted:50,delivered:42,attention:7},guests:[{...base().guests[0],name:'Second page guest'}]}
 const h=harness({guestServices:async(id,params)=>{calls.push(params);return {...data,pagination:{...data.pagination,page:params.page,view:params.view}}}})
 let root;await act(async()=>{root=create(React.createElement(h.Page))})
 await act(async()=>button(root,'Guests60').props.onClick())
 await act(async()=>button(root,'Next guests').props.onClick())
 assert.equal(calls.at(-1).paged,true);assert.equal(calls.at(-1).page,2)
 assert.ok(text(root.root).includes('Second page guest'))
 const counters=root.root.findByProps({className:'gs-summary'}).findAllByType('strong').map(n=>text(n))
 assert.deepEqual(counters.slice(1),['50','42','7'])
 await act(async()=>root.unmount())
})
