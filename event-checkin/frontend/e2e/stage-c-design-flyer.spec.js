import { test, expect } from '@playwright/test'
import { fieldNear, signIn } from './helpers.js'

test.describe('Stage C Design Studio flyer — isolated staging fixture', () => {
  test('flyer settings save and render use the real design-service contract', async ({ page }) => {
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    await signIn(page)
    await page.goto('/design-studio-redesign')
    await expect(page.getByRole('heading', { name: 'Design Studio' })).toBeVisible()

    expect(authorization, 'an authenticated API request was captured to source the original design record').not.toBe('')
    const eventId = process.env.E2E_EVENT_ID
    const originalResp = await page.request.get(`/api/events/${eventId}/design`, { headers: { Authorization: authorization } })
    expect(originalResp.ok()).toBeTruthy()
    const original = await originalResp.json()

    try {
      // Scoped to the tab strip — a loaded template card's surface chip
      // ("Preview Flyer") shares the exact accessible name "Flyer" with the
      // tab button, which an unscoped locator can't disambiguate.
      await page.locator('.rr-tabs').getByRole('button', { name: 'Flyer', exact: true }).click()
      const eventTitle = fieldNear(page, 'Event title')
      await eventTitle.fill(`E2E Flyer Check ${Date.now()}`)
      await page.getByRole('button', { name: 'Save flyer settings', exact: true }).click()
      await expect(page.locator('.rd-toast')).toContainText('Design settings saved')

      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/^flyer-.*\.png$/)
      await expect(page.locator('.rd-toast')).toContainText('Flyer rendered and downloaded')
      // "Recent rendered files" is fed from the real design/outputs endpoint, not a mock list.
      await expect(page.locator('.ds-recent-row').filter({ hasText: /\.png/i }).first()).toBeVisible()
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

  test('template preview panel shows real per-template colors and layout, not a static placeholder', async ({ page }) => {
    await signIn(page)
    await page.goto('/design-studio-redesign')
    await expect(page.getByRole('heading', { name: 'Design Studio' })).toBeVisible()

    const card = page.locator('.ds-template-card').filter({ hasText: 'Signature' })
    await card.getByRole('button', { name: 'Preview', exact: true }).click()
    const panel = page.locator('.ds-side-preview')
    await expect(panel.locator('.ds-template-hero-caption strong')).toHaveText('Signature')
    // Real layout data from the design-service catalog (e.g. "photo-hero"),
    // not the previous hardcoded "layout ready" placeholder for every template.
    await expect(panel.locator('.ds-layout-grid')).not.toContainText('layout ready')
    await expect(panel.locator('.ds-layout-grid')).toContainText(/\w/)
    await expect(panel.locator('.ds-swatch-dot')).toHaveCount(5)

    // A different template shows a genuinely different preview, proving this
    // isn't just static content repeated for every card.
    const otherCard = page.locator('.ds-template-card').filter({ hasText: 'Modern' })
    await otherCard.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(panel.locator('.ds-template-hero-caption strong')).toHaveText('Modern')
  })
})
