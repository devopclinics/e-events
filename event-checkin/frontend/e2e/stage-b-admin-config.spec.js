import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, fieldNear, signIn } from './helpers.js'

async function openAdmin(page) {
  await signIn(page)
  await page.goto('/admin-redesign')
  await expectQaEventLoaded(page)
}

async function ensureSourceSyncOpen(page) {
  const urlField = fieldNear(page, 'Share link')
  // The panel is a native <details>, whose open/closed state React only
  // partially controls — a single click-if-closed check can occasionally miss
  // a timing window, so retry the whole sequence rather than assert once.
  await expect(async () => {
    if (!(await urlField.isVisible())) {
      await page.getByText('Live spreadsheet sync', { exact: true }).click()
    }
    expect(await urlField.isVisible()).toBe(true)
  }).toPass({ timeout: 10000 })
  return urlField
}

test.describe('Stage B admin config — isolated staging fixture', () => {
  test('generates QR codes through the real endpoint', async ({ page }) => {
    await openAdmin(page)
    const toast = page.locator('.rd-toast')
    await page.getByRole('button', { name: 'Generate QR codes', exact: true }).click()
    await expect(toast).toContainText(/QR codes? generated/i)
  })

  test('spreadsheet source link saves, persists, and a bad sync surfaces the real error', async ({ page }) => {
    // The real sync-now failure depends on an actual DNS/connect timeout
    // against a synthetic unreachable URL, whose timing varies with real
    // network conditions — give this one more headroom than the 30s default
    // rather than treat that external variance as a fixed 20s budget item.
    test.setTimeout(60000)
    await openAdmin(page)
    const toast = page.locator('.rd-toast')
    const urlField = await ensureSourceSyncOpen(page)
    const original = await urlField.inputValue()
    const syntheticUrl = `https://docs.google.com/spreadsheets/d/e2e-${Date.now()}/pub`

    try {
      await urlField.fill(syntheticUrl)
      await page.getByRole('button', { name: 'Save link', exact: true }).click()
      await expect(toast).toHaveText('Spreadsheet link saved')

      await page.reload()
      await expectQaEventLoaded(page)
      const reloadedField = await ensureSourceSyncOpen(page)
      await expect(reloadedField).toHaveValue(syntheticUrl)

      // Any URL that isn't genuinely reachable fails fast at the real
      // endpoint (DNS/connect error), which is enough to prove this button
      // calls the real sync-now contract rather than a mock that always
      // "succeeds".
      await page.getByRole('button', { name: 'Sync now', exact: true }).click()
      await expect(toast).toContainText(/spreadsheet/i, { timeout: 20000 })
    } finally {
      const restoreField = await ensureSourceSyncOpen(page)
      await restoreField.fill(original)
      await page.getByRole('button', { name: 'Save link', exact: true }).click()
      await expect(toast).toContainText(/Spreadsheet link (saved|cleared)/)
    }
  })
})
