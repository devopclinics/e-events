import { test, expect } from '@playwright/test'

test.describe('Phase 7 public token surfaces', () => {
  test('calendar preserves the server re-entry URL and public RSVP state', async ({ page }) => {
    await page.route('**/api/calendars/calendar-token', (route) => route.fulfill({ json: {
      title: 'QA Calendar',
      description: 'Synthetic public calendar',
      events: [{ id: 'event-1', name: 'QA Ceremony', event_date: '2026-08-01T16:00:00Z', rsvp_status: 'confirmed', register_url: '/rsvp/re-entry-token' }],
    } }))
    await page.goto('/public-pages-redesign?tab=calendar&calendarToken=calendar-token')
    await expect(page.getByRole('heading', { name: 'QA Calendar' })).toBeVisible()
    const event = page.getByRole('link', { name: /QA Ceremony/ })
    await expect(event).toContainText('confirmed')
    await expect(event).toHaveAttribute('href', '/rsvp/re-entry-token')
  })

  test('registry claim waits for server confirmation and refreshes remaining state', async ({ page }) => {
    let remaining = 1
    let claimBody
    await page.route('**/api/registry/registry-token', (route) => route.fulfill({ json: {
      event_name: 'QA Registry',
      items: [{ id: 'gift-1', kind: 'item', title: 'Synthetic Gift', remaining }],
    } }))
    await page.route('**/api/registry/registry-token/items/gift-1/claim', async (route) => {
      claimBody = await route.request().postDataJSON()
      remaining = 0
      await route.fulfill({ json: { ok: true } })
    })
    await page.goto('/public-pages-redesign?tab=registry&registryToken=registry-token')
    await page.getByRole('button', { name: 'Reserve', exact: true }).click()
    await page.locator('.pp-modal').getByRole('textbox').first().fill('Synthetic Guest')
    await page.locator('.pp-modal').getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('status')).toContainText('gift was recorded')
    expect(claimBody).toMatchObject({ claimer_name: 'Synthetic Guest', quantity: 1 })
  })

  test('expired vendor token shows recoverable failure and retries', async ({ page }) => {
    let attempts = 0
    await page.route('**/api/vendor/expired-token', (route) => {
      attempts += 1
      return attempts === 1
        ? route.fulfill({ status: 404, json: { detail: 'Vendor link expired' } })
        : route.fulfill({ json: { shipment_name: 'Recovered List', event_name: 'QA Event', lines: [] } })
    })
    await page.goto('/public-pages-redesign?tab=vendor&vendorToken=expired-token')
    await expect(page.getByRole('alert')).toContainText('Vendor link expired')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Recovered List' })).toBeVisible()
  })

  test('mobile navigation exposes canonical invite and floor token routes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/public-pages-redesign?tab=invite&inviteToken=invite-token&floorToken=floor-token')
    await expect(page.getByRole('link', { name: /Open invitation/ })).toHaveAttribute('href', '/rsvp/invite-token')
    await page.getByRole('button', { name: /Floor plan/ }).click()
    await expect(page.getByRole('link', { name: /Open shared floor plan/ })).toHaveAttribute('href', '/floor/floor-token')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
