import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

test.describe('Stage C Design Studio publishing', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.route('**/api/v1/design/templates**', (route) => route.fulfill({
      json: {
        count: 2,
        templates: [
          { id: 'qa-one', name: 'QA One', category: 'Community', style: 'Minimal', isFree: true, surfaces: ['Event Page'] },
          { id: 'qa-two', name: 'QA Two', category: 'Celebration', style: 'Warm', isFree: true, surfaces: ['Event Page', 'Email'] },
        ],
      },
    }))
  })

  test('confirms server save before switching the active template', async ({ page }) => {
    let selected = 'qa-one'
    await page.route('**/api/events/*/design', async (route) => {
      if (route.request().method() === 'PUT') selected = (await route.request().postDataJSON()).selected_template_id
      await route.fulfill({ json: {
        event_id: 'qa-event',
        selected_template_id: selected,
        theme_config: {}, wording_config: {}, asset_config: {}, page_config: {},
        is_published: false, updated_at: new Date().toISOString(),
      } })
    })
    await page.route('**/api/events/*/design/outputs', (route) => route.fulfill({ json: { outputs: [] } }))

    await page.goto('/design-studio-redesign')
    await expect(page.getByRole('heading', { name: 'Design Studio' })).toBeVisible()
    const card = page.locator('.ds-template-card').filter({ hasText: 'QA Two' })
    await card.getByRole('button', { name: 'Select' }).click()
    await expect(page.getByText('QA Two saved as the active template', { exact: false })).toBeVisible()
    await expect(card.getByText('Active', { exact: true })).toBeVisible()
  })

  test('requires confirmation, publishes through the real contract, and makes no rollback claim', async ({ page }) => {
    await page.route('**/api/events/*/design', (route) => route.fulfill({ json: {
      event_id: 'qa-event', selected_template_id: 'qa-one',
      theme_config: {}, wording_config: {}, asset_config: {}, page_config: {},
      is_published: false, updated_at: new Date().toISOString(),
    } }))
    await page.route('**/api/events/*/design/outputs', (route) => route.fulfill({ json: { outputs: [] } }))
    let publishes = 0
    await page.route('**/api/events/*/design/publish', (route) => {
      publishes += 1
      return route.fulfill({ json: { event_id: 'qa-event', is_published: true, published_version: 3, published_at: new Date().toISOString() } })
    })

    await page.goto('/design-studio-redesign')
    await expect(page.getByRole('heading', { name: 'Design Studio' })).toBeVisible()
    await page.getByRole('button', { name: 'Publish' }).click()
    await page.getByRole('button', { name: 'Publish design' }).click()
    expect(publishes).toBe(0)
    await page.getByRole('button', { name: 'Confirm publish' }).click()
    await expect(page.getByText('Design published as version 3', { exact: false })).toBeVisible()
    await expect(page.getByText('Rollback is unavailable', { exact: false })).toBeVisible()
    expect(publishes).toBe(1)
  })

  test('page sections save the real per-section page_config contract, not a flat modules map', async ({ page }) => {
    let savedBody = null
    await page.route('**/api/events/*/design', async (route) => {
      if (route.request().method() === 'PUT') savedBody = await route.request().postDataJSON()
      await route.fulfill({ json: {
        event_id: 'qa-event', selected_template_id: 'qa-one',
        theme_config: {}, wording_config: {}, asset_config: {},
        page_config: savedBody?.page_config || {},
        is_published: false, updated_at: new Date().toISOString(),
      } })
    })
    await page.route('**/api/events/*/design/outputs', (route) => route.fulfill({ json: { outputs: [] } }))

    await page.goto('/design-studio-redesign')
    await expect(page.getByRole('heading', { name: 'Design Studio' })).toBeVisible()
    await page.getByRole('button', { name: 'Event Page' }).click()

    await page.locator('.rd-toggle-row', { hasText: 'Welcome label' }).locator('label.rd-switch').click()
    await page.getByPlaceholder('Label, e.g. Organized by').fill('Hosted by')
    await page.getByPlaceholder('CTA label, e.g. Learn more').fill('Learn more')
    await page.getByPlaceholder('CTA URL').fill('https://example.org')
    await page.getByRole('button', { name: 'Save page settings' }).click()
    await expect(page.getByText('Page settings saved', { exact: false })).toBeVisible()

    expect(savedBody.page_config.modules).toBeUndefined()
    expect(savedBody.page_config.hero.showWelcomeLabel).toBe(false)
    expect(savedBody.page_config.organizer.label).toBe('Hosted by')
    expect(savedBody.page_config.about.ctaLabel).toBe('Learn more')
    expect(savedBody.page_config.about.ctaUrl).toBe('https://example.org')
  })
})
