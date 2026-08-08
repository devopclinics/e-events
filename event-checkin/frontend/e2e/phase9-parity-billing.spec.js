import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  runLegacyThenRedesign,
  signIn,
} from './helpers.js'

// Bounded to checkout SESSION-CREATION parity (the exact request Festio sends
// to start a hosted checkout), not payment completion: staging's Stripe
// integration returns a 400 on /api/billing/checkout today regardless of
// which UI calls it (a pre-existing, unrelated staging config issue), so full
// completion parity isn't testable in either UI right now. This mirrors the
// existing stage-c-billing.spec.js technique of intercepting the checkout
// call itself rather than depending on the real payment provider.

test.describe.configure({ mode: 'serial' })

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

async function interceptCheckout(page) {
  let submittedBody
  await page.route('**/api/billing/checkout', async (route) => {
    submittedBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'stripe', url: 'about:blank' }),
    })
  })
  return () => submittedBody
}

test.describe('Phase 9 billing parity', () => {
  test('credit-pack checkout submits the same session-creation request', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)
    const headers = await authHeaders(page)

    const tiersResponse = await request.get(`/api/billing/tiers/${eventId}`, { headers })
    expect(tiersResponse.ok()).toBeTruthy()
    const billing = await tiersResponse.json()
    test.skip(!billing.is_paid, 'Credit packs require the isolated QA event to already have an active Event Pass.')
    expect(billing.packs?.length, 'billing catalog must contain an active credit pack').toBeGreaterThan(0)
    const pack = billing.packs[0]

    async function buyCredits(page, { legacy }) {
      const getBody = await interceptCheckout(page)
      if (legacy) {
        await page.getByRole('button', { name: /Billing/ }).click()
        // billing.packs[0] renders first in DOM order (no per-pack DOM hook
        // exists in the legacy panel), so position 0 is deterministic here.
        await page.getByRole('button', { name: 'Buy credits', exact: true }).first().click()
      } else {
        const buyButton = page.locator(`button[data-plan-key="${pack.key}"]`).filter({ hasText: 'Buy credits' })
        await expect(buyButton).toBeVisible()
        await buyButton.click()
        const modalSubmit = page.getByTestId('hosted-checkout-submit')
        await modalSubmit.click()
      }
      await expect.poll(() => getBody(), { message: 'checkout request should have been captured' }).toBeTruthy()
      const body = getBody()
      await page.unroute('**/api/billing/checkout')
      // Both legacy and redesign do `window.location.href = url` after the
      // checkout response resolves. With url mocked to about:blank, wait for
      // that navigation to actually land before the caller issues its next
      // page.goto -- otherwise the two navigations race and Playwright
      // aborts one with "interrupted by another navigation".
      await page.waitForURL('about:blank', { timeout: 3000 }).catch(() => {})
      return body
    }

    const [legacyBody, redesignBody] = await runLegacyThenRedesign(page, {
      legacyPath: '/admin',
      redesignPath: '/billing-redesign',
      action: buyCredits,
    })

    expect(redesignBody).toEqual({ event_id: eventId, tier: pack.key })
    expect(legacyBody).toEqual({ event_id: eventId, tier: pack.key })
  })
})
