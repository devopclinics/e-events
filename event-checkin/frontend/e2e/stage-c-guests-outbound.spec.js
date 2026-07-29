import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, signIn } from './helpers.js'

test('guest invitation send uses send-batch and claims success only from its response', async ({ page }) => {
  await signIn(page)
  let body
  await page.route('**/api/events/*/guests/send-batch', async (route) => {
    body = await route.request().postDataJSON()
    await route.fulfill({ json: { queued: 2, force: false, scope: 'all' } })
  })
  await page.goto('/guests-redesign?tab=invite')
  await expectQaEventLoaded(page)
  await page.getByText('Send first invitations', { exact: true }).click()
  await page.getByRole('button', { name: /Send to .* guests/ }).click()
  await expect(page.getByText('Invitations sent!', { exact: true })).toBeVisible()
  await expect(page.getByText('Sending to 2 guests', { exact: false })).toHaveCount(0)
  expect(body).toEqual({ guest_ids: [], force: false })
})

test('guest invitation fail-closed response never advances to success', async ({ page }) => {
  await signIn(page)
  await page.route('**/api/events/*/guests/send-batch', (route) => route.fulfill({
    status: 403,
    json: { detail: 'Recipient is not in the outbound safety allowlist' },
  }))
  await page.goto('/guests-redesign?tab=invite')
  await expectQaEventLoaded(page)
  await page.getByText('Send first invitations', { exact: true }).click()
  await page.getByRole('button', { name: /Send to .* guests/ }).click()
  await expect(page.getByText('Recipient is not in the outbound safety allowlist', { exact: false })).toBeVisible()
  await expect(page.getByText('Invitations sent!', { exact: true })).toHaveCount(0)
})
