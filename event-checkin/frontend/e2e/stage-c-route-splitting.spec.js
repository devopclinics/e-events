import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, signIn } from './helpers.js'

test.describe('Phase 8 route-level code splitting', () => {
  test('public entry does not eagerly download legacy or redesign admin pages', async ({ page }) => {
    const scripts = []
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(new URL(response.url()).pathname)
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Every guest gets/i })).toBeVisible()
    expect(scripts.some((path) => /AdminPage-|AdminRedesignPage-/.test(path))).toBe(false)
  })

  test('redesign route downloads its page without downloading legacy AdminPage', async ({ page }) => {
    await signIn(page)
    const scripts = []
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(new URL(response.url()).pathname)
    })
    await page.goto('/admin-redesign')
    await expectQaEventLoaded(page)
    expect(scripts.some((path) => /AdminRedesignPage-/.test(path))).toBe(true)
    expect(scripts.some((path) => /\/AdminPage-/.test(path))).toBe(false)
  })

  test('shows an accessible loading fallback while a route chunk is pending', async ({ page }) => {
    await page.route('**/assets/PricingRedesignPage-*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    })
    const navigation = page.goto('/pricing')
    await expect(page.getByRole('status')).toContainText('Loading page')
    await navigation
    await expect(page.getByRole('heading', { name: /pricing/i }).first()).toBeVisible()
  })

  test('offers reload recovery when a route chunk fails', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('festio:chunk-reload-state', JSON.stringify({ count: 8, startedAt: Date.now() }))
    })
    await page.route('**/assets/PricingRedesignPage-*.js', (route) => route.abort('failed'))
    await page.goto('/pricing')
    await expect(page.getByRole('alert')).toContainText('This page could not be loaded')
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible()
  })

  test('automatically recovers when a route chunk fails during a rollout', async ({ page }) => {
    let attempts = 0
    await page.route('**/assets/PricingRedesignPage-*.js', (route) => {
      attempts += 1
      if (attempts === 1) return route.abort('failed')
      return route.continue()
    })
    await page.goto('/pricing')
    await expect(page.getByRole('status')).toContainText('reconnecting automatically')
    await expect(page.getByRole('heading', { name: /pricing/i }).first()).toBeVisible({ timeout: 15000 })
    expect(attempts).toBeGreaterThanOrEqual(2)
  })
})
