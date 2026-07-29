import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const syntheticSuperadmin = {
  id: 'e2e-superadmin',
  name: 'Synthetic E2E Operator',
  email: 'synthetic-operator@example.test',
  role: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  is_platform_superadmin: true,
  is_org_admin: true,
}

async function installSyntheticSuperadminProfile(page) {
  // Auth still uses the temporary Firebase staging identity. Only the profile
  // response on this page load is intercepted so Console authorization can be
  // exercised without granting a real/staging user platform privileges.
  await page.route('**/api/auth/me', (route) => json(route, syntheticSuperadmin))
}

test.describe('Stage C superadmin Console — intercepted contracts', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('renders live overview, accounts, usage, and trials contracts', async ({ page }) => {
    await installSyntheticSuperadminProfile(page)
    const seen = []
    await page.route('**/api/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      seen.push(path)
      if (path.endsWith('/overview')) return json(route, [])
      if (path.endsWith('/plans')) return json(route, [])
      if (path.endsWith('/accounts/summary')) return json(route, [])
      if (path.endsWith('/accounts')) return json(route, [{ id: 'qa-org', name: 'Synthetic QA Org', is_active: true, event_count: 1, members: [] }])
      if (path.endsWith('/usage-report')) return json(route, { orgs: [] })
      if (path.endsWith('/trial-requests')) return json(route, [])
      return json(route, [])
    })

    await page.goto('/superadmin-redesign?tab=console')
    await expect(page.getByRole('heading', { name: 'Operator Console' })).toBeVisible()
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    await expect(page.locator('main').getByText('Synthetic QA Org', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await page.getByRole('button', { name: 'Trial requests', exact: true }).click()
    expect(seen).toEqual(expect.arrayContaining([
      '/api/admin/overview', '/api/admin/accounts', '/api/admin/usage-report', '/api/admin/trial-requests',
    ]))
  })

  test('account suspension requires confirmation and waits for the API', async ({ page }) => {
    await installSyntheticSuperadminProfile(page)
    let mutationCount = 0
    await page.route('**/api/admin/accounts', (route) => json(route, [{ id: 'qa-org', name: 'Synthetic QA Org', is_active: true, event_count: 0, members: [] }]))
    await page.route('**/api/admin/orgs/qa-org/active', async (route) => {
      mutationCount += 1
      expect(route.request().method()).toBe('PATCH')
      expect(route.request().postDataJSON()).toEqual({ active: false })
      await json(route, { id: 'qa-org', is_active: false })
    })
    await page.route('**/api/admin/overview', (route) => json(route, []))
    await page.route('**/api/admin/plans', (route) => json(route, []))

    await page.goto('/superadmin-redesign?tab=console')
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      expect(dialog.message()).toContain('Synthetic QA Org')
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: 'Suspend', exact: true }).click()
    expect(mutationCount).toBe(0)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Suspend', exact: true }).click()
    await expect.poll(() => mutationCount).toBe(1)
    await expect(page.getByText('Org suspended.', { exact: true })).toBeVisible()
  })

  test('pricing and affiliate writes use existing admin contracts only', async ({ page }) => {
    await installSyntheticSuperadminProfile(page)
    const writes = []
    await page.route('**/api/admin/overview', (route) => json(route, []))
    await page.route('**/api/admin/plans', (route) => json(route, [{ key: 'qa-tier', kind: 'tier', label: 'QA Tier', guest_cap: 10, credits: 10, usd: 100, ngn: 1000, active: true, sort_order: 1 }]))
    await page.route('**/api/admin/credit-rates/global', (route) => json(route, []))
    await page.route('**/api/admin/affiliate-stores', (route) => json(route, [{ id: 'qa-store', domain: 'example.test', label: 'QA Store', param_key: 'ref', param_value: 'qa', active: true, sort_order: 0 }]))
    await page.route('**/api/admin/plans/qa-tier', async (route) => { writes.push(['plan', route.request().postDataJSON()]); await json(route, {}) })
    await page.route('**/api/admin/affiliate-stores/qa-store', async (route) => { writes.push(['store', route.request().postDataJSON()]); await json(route, {}) })

    await page.goto('/superadmin-redesign?tab=console')
    await page.getByRole('button', { name: 'Pricing', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).first().click()
    await expect(page.getByText('Saved qa-tier.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Affiliate stores', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).first().click()
    await expect.poll(() => writes.length).toBe(2)
    expect(writes.map(([kind]) => kind).sort()).toEqual(['plan', 'store'])
  })
})
