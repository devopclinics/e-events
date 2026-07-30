import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, requiredEnv, signIn } from './helpers.js'

// Check-in behavior (Guest check-out / Walk-in guests / Section scanning) —
// ported from AdminPage.jsx's CheckoutToggle/WalkInToggle into
// CommunicationsRedesignPage's "Features & Channels" settings tab, which had
// none of these three before this pass.
test.describe('Check-in behavior settings — isolated staging fixture', () => {
  test('guest check-out and walk-in toggles persist through the real contract', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    const groupName = `E2E Section ${Date.now()}`
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)
    const group = await (await page.request.post(`/api/events/${eventId}/table-groups`, {
      headers: { Authorization: authorization }, data: { name: groupName },
    })).json()

    const before = await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json()
    const originalEvent = before.find((e) => e.id === eventId)

    try {
      await page.goto('/communications-redesign?tab=settings')
      await expectQaEventLoaded(page)
      const toast = page.locator('.rd-toast')

      // Guest check-out — simple on/off round trip.
      const checkoutCard = page.locator('.cm-settings-card').filter({ hasText: 'Guest check-out' })
      await expect(checkoutCard).toBeVisible()
      await checkoutCard.locator('.rd-switch').click()
      await expect(toast).toContainText(/Check-out (enabled|disabled)/)
      const checkoutAfterToggle = !originalEvent.checkout_enabled
      await page.reload()
      await expectQaEventLoaded(page)
      const reloadedCheckoutCard = page.locator('.cm-settings-card').filter({ hasText: 'Guest check-out' })
      if (checkoutAfterToggle) await expect(reloadedCheckoutCard.locator('input[type="checkbox"]')).toBeChecked()
      else await expect(reloadedCheckoutCard.locator('input[type="checkbox"]')).not.toBeChecked()

      // Walk-in guests — toggle on, then set the auto-assign group, both through real endpoints.
      const walkInCard = page.locator('.cm-settings-card').filter({ hasText: 'Walk-in guests' })
      await expect(walkInCard).toBeVisible()
      const walkInCheckbox = walkInCard.locator('input[type="checkbox"]')
      if (!(await walkInCheckbox.isChecked())) {
        await walkInCard.locator('.rd-switch').click()
        await expect(toast).toContainText('Walk-in registration enabled')
      }
      await expect(walkInCard.locator('select')).toBeVisible()
      await expect(walkInCard.locator('select option', { hasText: groupName })).toHaveCount(1)
      const groupPatch = page.waitForResponse((r) => r.url().includes('/walk-in-group') && r.request().method() === 'PATCH')
      await walkInCard.locator('select').selectOption({ label: groupName })
      const patchResult = await (await groupPatch).json()
      expect(patchResult.walk_in_table_group_id, `PATCH /walk-in-group response: ${JSON.stringify(patchResult)}`).toBe(group.id)

      const afterWalkIn = await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json()
      const eventNow = afterWalkIn.find((e) => e.id === eventId)
      expect(eventNow.walk_in_enabled).toBe(true)
      expect(eventNow.walk_in_table_group_id).toBe(group.id)
    } finally {
      // Restore exactly what this test changed, using the real contract directly
      // rather than re-driving the UI (mirrors the established restore pattern).
      await page.request.patch(`/api/events/${eventId}/features`, {
        headers: { Authorization: authorization },
        data: { checkout_enabled: !!originalEvent.checkout_enabled },
      }).catch(() => {})
      await page.request.patch(`/api/events/${eventId}/walk-in`, {
        headers: { Authorization: authorization },
        data: { active: !!originalEvent.walk_in_enabled },
      }).catch(() => {})
      await page.request.patch(`/api/events/${eventId}/walk-in-group`, {
        headers: { Authorization: authorization },
        data: { table_group_id: originalEvent.walk_in_table_group_id || null },
      }).catch(() => {})
      await page.request.delete(`/api/events/${eventId}/table-groups/${group.id}`, { headers: { Authorization: authorization } }).catch(() => {})
    }
  })

  test('seating term rename persists through the real contract', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const term = `Crew${Date.now().toString().slice(-4)}`
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)
    const before = await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json()
    const original = before.find((e) => e.id === eventId).seating_term || ''

    try {
      await page.goto('/communications-redesign?tab=settings')
      await expectQaEventLoaded(page)
      const card = page.locator('.rr-panel').filter({ has: page.getByText('What should we call it?', { exact: true }) })
      await expect(card).toBeVisible()
      await card.locator('input').fill(term)
      await expect(card.locator('input'), 'the input must actually hold the new value before Save can be clicked').toHaveValue(term)
      await card.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.locator('.rd-toast')).toContainText(`Now shown as "${term}"`)

      await page.reload()
      await expectQaEventLoaded(page)
      const reloadedCard = page.locator('.rr-panel').filter({ has: page.getByText('What should we call it?', { exact: true }) })
      await expect(reloadedCard.locator('input')).toHaveValue(term)
    } finally {
      await page.request.patch(`/api/events/${eventId}/features`, {
        headers: { Authorization: authorization }, data: { seating_term: original },
      }).catch(() => {})
    }
  })
})
