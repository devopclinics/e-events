import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, signIn } from './helpers.js'

test.describe('Results live operations overview', () => {
  test('renders the real-time command center and supports refresh control', async ({ page }) => {
    await signIn(page)

    const commandCenter = page.waitForResponse((response) =>
      response.url().includes('/api/results/events/')
      && response.url().includes('/command-center')
      && response.status() === 200
    )
    await page.goto('/event-results-redesign')
    await commandCenter
    await expectQaEventLoaded(page)

    await expect(page.locator('.er-ops-hero')).toBeVisible()
    await expect(page.locator('.er-ops-metric')).toHaveCount(6)
    await expect(page.getByRole('heading', { name: 'Arrival pulse' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Action queue' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'RSVP conversion funnel' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Communications delivery' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live activity' })).toBeVisible()

    const refresh = page.getByRole('checkbox', { name: 'Auto refresh' })
    await expect(refresh).toBeChecked()
    await refresh.uncheck()
    await expect(refresh).not.toBeChecked()

    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 2
    ), 'The command center must not overflow horizontally.').toBe(true)
  })
})
