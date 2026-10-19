import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'
const require = createRequire(import.meta.url)
function harness(api, selection = 'event-a') {
  let selected = selection
  const modules = {
    '../api': { api },
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
