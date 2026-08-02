import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

test.describe('Stage C Design Studio FestioHub style — isolated staging fixture', () => {
  test('selecting a hub style saves theme_config.hubStyle through the real design contract', async ({ page }) => {
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
      // Scoped to the tab strip for the same reason as the Flyer/Event Page
      // tabs — template cards' surface chips can share an accessible name
      // with a tab button once the real catalog has loaded.
      await page.locator('.rr-tabs').getByRole('button', { name: 'FestioHub', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Hub layout style' })).toBeVisible()

      const putPromise = page.waitForResponse((response) =>
        response.url().includes(`/api/events/${eventId}/design`) && response.request().method() === 'PUT')
      await page.locator('.ds-hub-card', { hasText: 'Timeline' }).getByRole('button', { name: 'Use this style' }).click()
      const putResponse = await putPromise
      expect(putResponse.ok()).toBeTruthy()
      const saved = await putResponse.json()
      expect(saved.theme_config.hubStyle).toBe('timeline')
      await expect(page.locator('.rd-toast')).toContainText('Timeline saved')

      // The card now reads "Selected" and the live-preview iframe (the real
      // /invite/{id}?studio-preview=1 page, not a hand-drawn mockup) picks up
      // the new draft — proving the choice round-tripped, not just a local
      // click state.
      await expect(page.locator('.ds-hub-card', { hasText: 'Timeline' }).getByRole('button', { name: 'Selected' })).toBeVisible()
      const frame = page.frameLocator('.ds-page-preview-frame')
      await expect(frame.locator('.fh-hub-style-timeline')).toBeVisible({ timeout: 15000 })

      const refetch = await page.request.get(`/api/events/${eventId}/design`, { headers: { Authorization: authorization } })
      expect((await refetch.json()).theme_config.hubStyle).toBe('timeline')
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
