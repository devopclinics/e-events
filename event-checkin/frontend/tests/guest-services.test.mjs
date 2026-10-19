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
  let selected = selection
  const modules = {
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
  runInNewContext(code, { module, exports: module.exports, require: name => modules[name] ?? require(name), URL, Date, Map, Object, crypto: { randomUUID: () => 'synthetic-request-key' }, setInterval: () => 1, clearInterval() {} })
  return { Page: module.exports.default, passToken: module.exports.passToken, select: id => { selected = id } }
}
const base = () => ({ event_id: 'event-a', event_name: 'Conference', is_supervisor: false, can_configure: false, assignments: [{ id: 'assignment', table_id: 'table-a', name: 'Table A', active: true }], zones: [], menu_categories: [], request_assignees: [], guests: [{ id: 'guest-a', name: 'Ada', table_id: 'table-a', table_name: 'Table A', admitted: true, seated_at: null, can_checkin: false, can_manage_meals: false, choices: [], meal_services: [] }] })
const text = node => node.children.map(c => typeof c === 'string' ? c : text(c)).join('')
const button = (root, label) => root.root.findAllByType('button').find(b => text(b) === label)
const change = async (element, value) => act(async () => element.props.onChange({ target: { value } }))

test('staff sees assigned workspace and seating action uses its existing guest identity', async () => {
  const data = base(), calls = []
  const h = harness({ guestServices: async () => data, markGuestSeated: async (...args) => { calls.push(args); data.guests[0].seated_at = '2026-10-19T10:00:00' } })
  let root; await act(async () => { root = create(React.createElement(h.Page)) })
  assert.equal(button(root, 'Assign staff'), undefined)
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
  await change(root.root.findAllByType('select')[0], 'member-a')
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
 await act(async()=>button(root,'Help choose menu').props.onClick())
 await change(root.root.findByProps({'aria-label':'Dessert'}),'')
 const agreed=root.root.findAllByType('input').find(n=>n.props.required&&n.props.type==='checkbox');await act(async()=>agreed.props.onChange({target:{checked:true}}))
 const form=root.root.findAllByType('form').find(f=>f.findAllByType('h3').some(h=>text(h)==='Help Ada choose'));await act(async()=>form.props.onSubmit({preventDefault(){}}))
 assert.deepEqual(Array.from(calls[0][2].clear_categories),['dessert']);assert.equal(calls[0][2].single.dessert,undefined)
 await act(async()=>root.unmount())
})
