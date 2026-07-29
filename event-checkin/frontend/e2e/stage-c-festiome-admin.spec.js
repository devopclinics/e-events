import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

test('FestioMe redesign loads organizer groups and confirms group creation', async ({ page }) => {
  await signIn(page)
  let groups = [{ id: 'g1', name: 'QA Community', join_policy: 'open' }]
  let channels = []
  await page.route('**/api/events/*/festiome/status', (route) => route.fulfill({ json: { configured: true, available: true, enabled: true } }))
  await page.route('**/api/events/*/festiome/groups', async (route) => {
    if (route.request().method() === 'POST') {
      const body = await route.request().postDataJSON()
      const created = { id: 'g2', ...body }
      groups = [...groups, created]
      return route.fulfill({ status: 201, json: created })
    }
    return route.fulfill({ json: groups })
  })
  await page.route('**/api/events/*/festiome/groups/*/join-requests**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/festiome/**', (route) => {
    const url = route.request().url()
    if (url.endsWith('/channels') && route.request().method() === 'POST') {
      const created = { id: 'c1', name: 'qa-channel', kind: 'discussion', type: 'discussion', private: false }
      channels = [created]
      return route.fulfill({ status: 201, json: created })
    }
    if (url.endsWith('/channels')) return route.fulfill({ json: channels })
    if (url.includes('/channels/')) return route.fulfill({ json: { messages: [] } })
    return route.fulfill({ json: [] })
  })

  await page.goto('/festiome-redesign')
  await expect(page.getByRole('heading', { name: 'FestioMe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'QA Community' })).toBeVisible()
  await page.getByRole('button', { name: 'Create group' }).click()
  await page.getByPlaceholder('e.g. Photography Team').fill('QA Moderators')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Group created', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'QA Moderators' })).toBeVisible()
  await page.getByTitle('Create channel').click()
  await page.getByPlaceholder('channel-name').fill('qa-channel')
  await page.locator('.fm-create-channel').getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Channel created', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /qa-channel/ })).toBeVisible()
})
