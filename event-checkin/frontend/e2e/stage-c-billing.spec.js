import { test, expect } from '@playwright/test'
import { axeSeriousViolations, expectQaEventLoaded, formatAxeViolations, requiredEnv, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Stage C billing — provider-safe hosted handoff', () => {
  test('redesign billing page has no serious/critical accessibility violations', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)
    const tiersReady = page.waitForResponse((response) =>
      response.url().includes(`/api/billing/tiers/${eventId}`) && response.status() === 200
    )
    await page.goto('/billing-redesign?tab=billing')
    await expectQaEventLoaded(page)
    await tiersReady
    const violations = await axeSeriousViolations(page)
    expect(violations, formatAxeViolations(violations)).toEqual([])
  })

  test('ledger and capability catalog are interactive', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)

    const tiersReady = page.waitForResponse((response) =>
      response.url().includes(`/api/billing/tiers/${eventId}`) && response.status() === 200
    )
    await page.goto('/billing-redesign?tab=billing')
    await expectQaEventLoaded(page)
    const billing = await (await tiersReady).json()

    const ledgerToggle = page.getByRole('button', { name: /Credit ledger/ })
    await expect(ledgerToggle).toHaveAttribute('aria-expanded', 'false')
    await ledgerToggle.click()
    await expect(ledgerToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: 'All activity', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /SMS.*View ledger/i }).click()
    await expect(page.getByRole('button', { name: 'SMS', exact: true })).toHaveClass(/active/)

    const operationsCapability = billing.catalog?.addons?.operations?.[0]
    expect(operationsCapability, 'billing catalog must expose operations capabilities').toBeTruthy()
    await page.getByRole('button', { name: new RegExp(String(operationsCapability).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    await expect(page.locator('.rr-modal')).toContainText(String(operationsCapability))
    await page.getByRole('button', { name: 'Open event operations', exact: true }).click()
    await expect(page).toHaveURL(/\/addons-redesign$/)
  })

  test('submits the exact live catalog tier key and leaves Festio for hosted checkout', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)

    const tiersReady = page.waitForResponse((response) =>
      response.url().includes(`/api/billing/tiers/${eventId}`) && response.status() === 200
    )
    await page.goto('/billing-redesign')
    await expectQaEventLoaded(page)
    const billing = await (await tiersReady).json()
    expect(billing.tiers?.length, 'isolated QA billing catalog must contain an active Event Pass tier').toBeGreaterThan(0)
    expect(['stripe', 'paystack']).toContain(billing.provider)

    const selectedTier = billing.tiers[0]
    const hostedOrigin = billing.provider === 'stripe' ? 'https://checkout.stripe.com' : 'https://checkout.paystack.com'
    const hostedUrl = `${hostedOrigin}/e2e-safe-handoff?provider=${billing.provider}`
    let submittedBody
    await page.route('**/api/billing/checkout', async (route) => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: billing.provider,
          url: hostedUrl,
        }),
      })
    })
    await page.route(`${hostedOrigin}/**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Provider-safe E2E handoff</title><h1>Hosted checkout</h1>' })
    })

    const buyButton = page.locator(`button[data-plan-key="${selectedTier.key}"]`).filter({ hasText: /Buy Event Pass|Buy this pass again/ })
    await expect(buyButton).toBeVisible()
    if (!billing.configured) {
      await expect(buyButton).toBeDisabled()
      test.skip(true, `${billing.provider} is not configured on isolated staging; hosted checkout is correctly unavailable.`)
    }
    await buyButton.click()

    const modalSubmit = page.getByTestId('hosted-checkout-submit')
    await expect(modalSubmit).toHaveAttribute('data-plan-key', selectedTier.key)
    await expect(page.getByText(/Card details are entered only on the provider's hosted page/i)).toBeVisible()

    await Promise.all([
      page.waitForURL(new RegExp(`${hostedOrigin.replaceAll('.', '\\.')}\\/e2e-safe-handoff\\?`)),
      modalSubmit.click(),
    ])

    expect(submittedBody).toEqual({ event_id: eventId, tier: selectedTier.key })
    await expect(page).toHaveURL(new RegExp(`provider=${billing.provider}`))
  })

  test('credit pack purchase uses the same provider-safe hosted handoff as an Event Pass', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)

    const tiersReady = page.waitForResponse((response) =>
      response.url().includes(`/api/billing/tiers/${eventId}`) && response.status() === 200
    )
    await page.goto('/billing-redesign')
    await expectQaEventLoaded(page)
    const billing = await (await tiersReady).json()
    test.skip(!billing.is_paid, 'Credit packs require the isolated QA event to already have an active Event Pass')
    expect(billing.packs?.length, 'isolated QA billing catalog must contain an active credit pack').toBeGreaterThan(0)

    const selectedPack = billing.packs[0]
    const hostedOrigin = billing.provider === 'stripe' ? 'https://checkout.stripe.com' : 'https://checkout.paystack.com'
    const hostedUrl = `${hostedOrigin}/e2e-safe-handoff?provider=${billing.provider}&kind=credits`
    let submittedBody
    await page.route('**/api/billing/checkout', async (route) => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: billing.provider, url: hostedUrl }) })
    })
    await page.route(`${hostedOrigin}/**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Provider-safe E2E handoff</title><h1>Hosted checkout</h1>' })
    })

    const buyButton = page.locator(`button[data-plan-key="${selectedPack.key}"]`).filter({ hasText: 'Buy credits' })
    await expect(buyButton).toBeVisible()
    if (!billing.configured) {
      await expect(buyButton).toBeDisabled()
      test.skip(true, `${billing.provider} is not configured on isolated staging; hosted checkout is correctly unavailable.`)
    }
    await buyButton.click()

    const modalSubmit = page.getByTestId('hosted-checkout-submit')
    await expect(modalSubmit).toHaveAttribute('data-plan-key', selectedPack.key)

    await Promise.all([
      page.waitForURL(new RegExp(`${hostedOrigin.replaceAll('.', '\\.')}\\/e2e-safe-handoff\\?`)),
      modalSubmit.click(),
    ])

    expect(submittedBody).toEqual({ event_id: eventId, tier: selectedPack.key })
    await expect(page).toHaveURL(new RegExp(`provider=${billing.provider}`))
  })

  test('add-on purchase uses the live add-on catalog and hosted checkout', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)

    const tiersReady = page.waitForResponse((response) =>
      response.url().includes(`/api/billing/tiers/${eventId}`) && response.status() === 200
    )
    await page.goto('/billing-redesign')
    await expectQaEventLoaded(page)
    const billing = await (await tiersReady).json()
    test.skip(!billing.is_paid, 'Add-ons require an active Event Pass')
    const selectedAddon = billing.addon_plans?.find((addon) => !(billing.purchased_addons || []).includes(addon.key))
    test.skip(!selectedAddon, 'The isolated QA event has no unpurchased active add-on')

    const hostedOrigin = billing.provider === 'stripe' ? 'https://checkout.stripe.com' : 'https://checkout.paystack.com'
    const hostedUrl = `${hostedOrigin}/e2e-safe-handoff?provider=${billing.provider}&kind=addon`
    let submittedBody
    await page.route('**/api/billing/checkout', async (route) => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: billing.provider, url: hostedUrl }) })
    })
    await page.route(`${hostedOrigin}/**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Provider-safe E2E handoff</title><h1>Hosted checkout</h1>' })
    })

    const buyButton = page.locator(`button[data-plan-key="${selectedAddon.key}"]`).filter({ hasText: 'Buy add-on' })
    await expect(buyButton).toBeVisible()
    if (!billing.configured) {
      await expect(buyButton).toBeDisabled()
      test.skip(true, `${billing.provider} is not configured on isolated staging; hosted checkout is correctly unavailable.`)
    }
    await buyButton.click()

    const modalSubmit = page.getByTestId('hosted-checkout-submit')
    await expect(modalSubmit).toHaveAttribute('data-plan-key', selectedAddon.key)
    await expect(page.locator('.rr-modal')).toContainText(`Add ${selectedAddon.name || selectedAddon.label}`)

    await Promise.all([
      page.waitForURL(new RegExp(`${hostedOrigin.replaceAll('.', '\\.')}\\/e2e-safe-handoff\\?`)),
      modalSubmit.click(),
    ])

    expect(submittedBody).toEqual({ event_id: eventId, tier: selectedAddon.key })
    await expect(page).toHaveURL(new RegExp('kind=addon'))
  })
})
