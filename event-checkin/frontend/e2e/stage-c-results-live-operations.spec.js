import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, firebaseAccessToken, requiredEnv, signIn } from './helpers.js'

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

    const eventPicker = page.getByRole('button', { name: 'Choose event' })
    await eventPicker.click()
    const eventMenu = page.getByRole('listbox', { name: 'Events' })
    await expect(eventMenu).toBeVisible()
    await expect(eventMenu.getByRole('option', { selected: true })).toContainText('Redesign QA Test Event')
    expect(await eventPicker.evaluate((element) => element.tagName)).toBe('BUTTON')
    await eventMenu.getByRole('option', { selected: true }).click()
    await expect(eventMenu).toBeHidden()

    const refresh = page.getByRole('checkbox', { name: 'Auto refresh' })
    await expect(refresh).toBeChecked()
    await refresh.uncheck()
    await expect(refresh).not.toBeChecked()

    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 2
    ), 'The command center must not overflow horizontally.').toBe(true)
  })

  test('opens an affected guest directly from the action queue', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const firstName = `E2E-Alert-${suffix}`
    const fullName = `${firstName} NoContact`
    let guest

    await signIn(page)
    const headers = { Authorization: `Bearer ${await firebaseAccessToken(page)}` }

    try {
      const created = await request.post(`/api/events/${eventId}/guests`, {
        headers,
        data: { first_name: firstName, last_name: 'NoContact', email: null, phone: null },
      })
      expect(created.ok()).toBeTruthy()
      guest = await created.json()

      await page.goto('/event-results-redesign')
      await expectQaEventLoaded(page)
      const alert = page.locator('.er-ops-alert').filter({ hasText: 'no contact info' })
      await expect(alert).toBeVisible()
      await alert.click()

      await expect(page.getByRole('heading', { name: /guest.*no contact info/i })).toBeVisible()
      const guestRecord = page.getByRole('button', { name: `Open guest record for ${fullName}` })
      await expect(guestRecord).toBeVisible()
      await guestRecord.click()

      await expect(page).toHaveURL(new RegExp(`/guests-redesign\\?.*guest=${guest.id}`))
      await expect(page.getByRole('heading', { name: `Guest: ${fullName}` })).toBeVisible()
    } finally {
      if (guest?.id) {
        const removed = await request.delete(`/api/events/${eventId}/guests/${guest.id}`, { headers })
        expect([200, 204, 404]).toContain(removed.status())
      }
    }
  })
})
