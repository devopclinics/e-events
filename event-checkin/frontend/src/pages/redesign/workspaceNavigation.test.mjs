import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceNavigation } from './workspaceNavigation.mjs'
const links = [
  { id: 'events', to: '/events-redesign' }, { id: 'setup', to: '/admin-redesign' },
  { id: 'design', to: '/design-studio-redesign' }, { id: 'guesthub', to: '/design-studio-redesign?surface=hub' },
  { id: 'website', to: '/design-studio-redesign/website' }, { id: 'checkin', to: '/scanner-redesign' },
  { id: 'org', to: '/billing-redesign?tab=org' }, { id: 'help', to: '/help-redesign' },
]
test('GuestHub query selects guest experience instead of Design Studio', () => {
  const result = workspaceNavigation(links, { pathname: '/design-studio-redesign', search: '?surface=hub' }, 'design')
  assert.equal(result.activeId, 'guesthub'); assert.equal(result.activeGroup.id, 'guest')
})
test('website route belongs to guest experience and studio to event workspace', () => {
  assert.equal(workspaceNavigation(links, { pathname: '/design-studio-redesign/website' }, 'design').activeGroup.id, 'guest')
  assert.equal(workspaceNavigation(links, { pathname: '/design-studio-redesign' }, 'design').activeGroup.id, 'workspace')
})
test('grouping preserves pre-authorized destinations and account links', () => {
  const allowed = links.filter(link => !['design','guesthub','website'].includes(link.id))
  const result = workspaceNavigation(allowed, { pathname: '/scanner-redesign' }, 'checkin')
  assert.ok(!result.groups.some(group => group.id === 'guest'))
  assert.deepEqual(result.groups.flatMap(group => group.links).concat(result.accountLinks).map(link => link.id).sort(), allowed.map(link => link.id).sort())
  assert.deepEqual(result.accountLinks.map(link => link.id), ['org', 'help'])
})
test('organisation route does not select an event workspace', () => {
  const result = workspaceNavigation(links, { pathname: '/billing-redesign', search: '?tab=org' }, 'org')
  assert.equal(result.activeGroup, undefined); assert.equal(result.activeId, 'org')
})
