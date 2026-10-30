import test from 'node:test'
import assert from 'node:assert/strict'
import { marketingGroups, marketingTab, MARKETING_NAV_GROUPS } from '../src/pages/marketingNavigation.mjs'
test('grouping retains every tool exactly once and does not introduce hidden admin tools', () => {
  const ids = MARKETING_NAV_GROUPS.flatMap(group => group.ids)
  const legacy=['dashboard','leads','handoffs','tags','segments','sequences','campaigns','content','referrals','tasks','experiments','forms','analytics','preferences','help','social-settings','access','audit']
  for(const id of legacy) assert.ok(ids.includes(id),`Missing existing tool: ${id}`)
  assert.deepEqual(MARKETING_NAV_GROUPS.map(group=>group.label),['Today','People','Messages','Follow-ups','Results','Settings'])
  assert.equal(ids.length, new Set(ids).size)
  const tabs = ids.filter(id => !['access','audit','social-settings'].includes(id)).map(id => [id,id])
  const grouped = marketingGroups(tabs).flatMap(group => group.tabs)
  assert.deepEqual(grouped.map(([id]) => id).sort(), tabs.map(([id]) => id).sort())
  assert.equal(grouped.some(([id]) => id === 'access'), false)
})
test('existing deep links survive and unknown tabs use the onboarding overview', () => {
  const tabs = MARKETING_NAV_GROUPS.flatMap(group => group.ids).map(id => [id,id])
  for (const [id] of tabs) assert.equal(marketingTab(id,tabs), id)
  assert.equal(marketingTab('unsupported',tabs), 'dashboard')
  assert.equal(marketingTab('access',[['dashboard','Overview']]), 'dashboard')
})
