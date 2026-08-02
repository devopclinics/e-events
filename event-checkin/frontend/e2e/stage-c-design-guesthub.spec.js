import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

test.describe('Stage C Design Studio GuestHub tab — isolated staging fixture', () => {
  test('"Use this template" applies the full bundle (hubStyle + colors + font) from the GuestHub tab', async ({ page }) => {
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    await signIn(page)
    await page.goto('/design-studio-redesign')
    await expect(page.getByRole('heading', { name: 'Design Studio' })).toBeVisible()

    const eventId = process.env.E2E_EVENT_ID
    const originalResp = await page.request.get(`/api/events/${eventId}/design`, { headers: { Authorization: authorization } })
    const original = await originalResp.json()

    try {
      await page.locator('.rr-tabs').getByRole('button', { name: 'GuestHub', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'GuestHub templates' })).toBeVisible()

      // "Use this template" fires two sequential saves under the hood
      // (selectHubStyle, then applyHubColorPreset) — the button already
      // flips to "Applied" after the first, so wait for the toast that
      // marks the second (the one that actually saves colors/font) landing.
      const card = page.locator('.ds-gh-card', { hasText: 'Coastal Club' })
      await card.getByRole('button', { name: 'Use this template' }).click()
      await expect(card.getByRole('button', { name: '✓ Applied' })).toBeVisible()
      await expect(page.locator('.rd-toast')).toContainText('Coastal Club palette applied')

      const savedResp = await page.request.get(`/api/events/${eventId}/design`, { headers: { Authorization: authorization } })
      const saved = await savedResp.json()
      expect(saved.theme_config.hubStyle).toBe('coastal-club')
      expect(saved.theme_config.colors.accent).toBe('#b8912a')
      expect(saved.theme_config.fontPairing).toBe('modern-sans')

      // The live preview here is the whole page (no #guest-hub anchor) —
      // that's the point of this tab vs. FestioHub's card-only preview.
      // Assert the hero <h1> is present (the page, not just the card) AND
      // the FestioHub card further down carries the matching theme class.
      const frame = page.frameLocator('.ds-page-preview-frame')
      await expect(frame.locator('h1')).toBeVisible({ timeout: 15000 })
      await expect(frame.locator('.fh-hub-style-coastal-club')).toBeVisible({ timeout: 15000 })
    } finally {
      const reset = await page.request.put(`/api/events/${eventId}/design`, {
        headers: { Authorization: authorization },
        data: {
          selected_template_id: original.selected_template_id,
          selected_flyer_template_id: original.selected_flyer_template_id,
          theme_config: original.theme_config || {},
          wording_config: original.wording_config || {},
          asset_config: original.asset_config || {},
          page_config: original.page_config || {},
        },
      })
      expect(reset.ok()).toBeTruthy()
    }
  })
})
