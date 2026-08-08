import { test, expect } from '@playwright/test'
import {
  firebaseAccessToken,
  requiredEnv,
  signIn,
} from './helpers.js'

// Scoped to kitchen fulfillment for this pass -- both legacy (KitchenPage.jsx)
// and redesign (RealOperationsContent.jsx) call the exact same
// PATCH .../guests/{id}/meal-served endpoint with an identical flat guest
// list, making it the highest-confidence, lowest-risk comparison of the
// three operations workflows. Delivery/logistics and registry claims are
// deferred to a follow-up pass.

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

function servedContract(guest) {
  return { meal_served: !!guest.meal_served }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test.describe('Phase 9 operations parity', () => {
  test('kitchen mark-served persists the same contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    const legacyGuest = await (await request.post(`/api/events/${eventId}/guests`, {
      headers, data: { first_name: `ParityKitchen-Legacy-${run}`, last_name: 'Synthetic' },
    })).json()
    const redesignGuest = await (await request.post(`/api/events/${eventId}/guests`, {
      headers, data: { first_name: `ParityKitchen-Redesign-${run}`, last_name: 'Synthetic' },
    })).json()

    try {
      await page.goto('/kitchen')
      const legacyRow = page.getByText(`${legacyGuest.first_name} ${legacyGuest.last_name}`, { exact: false })
        .locator('xpath=ancestor::div[contains(@class,"items-start")]')
      const legacyResponse = page.waitForResponse((r) =>
        r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/guests/${legacyGuest.id}/meal-served`))
      await legacyRow.getByRole('button', { name: 'Mark served', exact: true }).click()
      expect((await (await legacyResponse).json()).ok).toBe(true)

      await page.goto('/kitchen-redesign')
      await expect(page.getByRole('heading', { name: 'Kitchen Display' })).toBeVisible()
      const redesignCard = page.locator('.kn-order-card').filter({ hasText: `${redesignGuest.first_name} ${redesignGuest.last_name}` })
      const redesignResponse = page.waitForResponse((r) =>
        r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/guests/${redesignGuest.id}/meal-served`))
      await redesignCard.getByRole('button', { name: 'Mark served', exact: true }).click()
      expect((await (await redesignResponse).json()).ok).toBe(true)

      // The PATCH response itself is just {ok: true} -- verify the actual
      // persisted contract by re-reading the guest records, matching the
      // established phase9-parity-core.spec.js pattern.
      const guests = await (await request.get(`/api/events/${eventId}/guests`, { headers })).json()
      const legacyResult = guests.find((g) => g.id === legacyGuest.id)
      const redesignResult = guests.find((g) => g.id === redesignGuest.id)

      expect(servedContract(legacyResult)).toEqual({ meal_served: true })
      expect(servedContract(redesignResult)).toEqual({ meal_served: true })
    } finally {
      await request.delete(`/api/events/${eventId}/guests/${legacyGuest.id}`, { headers })
      await request.delete(`/api/events/${eventId}/guests/${redesignGuest.id}`, { headers })
    }
  })
})
