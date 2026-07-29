import { test, expect } from '@playwright/test'
import { signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Stage B organization settings — isolated staging fixture', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/billing-redesign?tab=org')
    await expect(page.getByRole('heading', { name: 'Org Settings' })).toBeVisible()
  })

  test('contact-list/contact and calendar CRUD', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const listName = `E2E Contacts ${suffix}`
    const calendarName = `E2E Calendar ${suffix}`
    const editedCalendarName = `${calendarName} Edited`

    const listsPanel = page.locator('.rr-panel').filter({
      has: page.getByRole('heading', { name: 'Contact Lists', exact: true }),
    }).first()
    await listsPanel.getByPlaceholder('New list name').fill(listName)
    await listsPanel.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Contact list created', { exact: true })).toBeVisible()

    const listRow = page.locator('.bl-list-row-block').filter({ hasText: listName })
    await expect(listRow).toBeVisible()
    await listRow.getByRole('button', { name: 'View', exact: true }).click()
    await listRow.getByPlaceholder('First name').fill('E2E')
    await listRow.getByPlaceholder('Last name').fill('Contact')
    await listRow.getByPlaceholder('Email').fill(`e2e-${suffix}@example.com`)
    await listRow.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Contact added', { exact: true })).toBeVisible()
    await expect(listRow.getByText('E2E Contact', { exact: true })).toBeVisible()
    await listRow.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText('Contact removed', { exact: true })).toBeVisible()

    const calendarsPanel = page.locator('.rr-panel').filter({
      has: page.getByRole('heading', { name: 'Calendars', exact: true }),
    }).first()
    await calendarsPanel.getByRole('button', { name: 'New calendar', exact: true }).click()
    let modal = page.locator('.rr-modal').filter({
      has: page.getByText('New calendar', { exact: true }),
    })
    await modal.locator('input.rd-field').fill(calendarName)
    await modal.getByRole('button', { name: 'Save calendar', exact: true }).click()
    await expect(page.getByText('Calendar saved', { exact: true })).toBeVisible()

    let calendarRow = page.locator('.bl-list-row').filter({ hasText: calendarName })
    await calendarRow.getByRole('button', { name: 'Edit', exact: true }).click()
    modal = page.locator('.rr-modal')
    await modal.locator('input.rd-field').fill(editedCalendarName)
    await modal.getByRole('button', { name: 'Save calendar', exact: true }).click()
    await expect(page.getByText(editedCalendarName, { exact: true })).toBeVisible()

    calendarRow = page.locator('.bl-list-row').filter({ hasText: editedCalendarName })
    await calendarRow.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Calendar deleted', { exact: true })).toBeVisible()

    await listRow.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Contact list deleted', { exact: true })).toBeVisible()
  })

  test('API-key lifecycle and webhook lifecycle', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const keyName = `E2E Key ${suffix}`
    const webhookUrl = `https://example.invalid/festio-e2e/${suffix}`

    const keysPanel = page.locator('.rr-panel').filter({
      has: page.getByRole('heading', { name: 'API Keys', exact: true }),
    }).first()
    await keysPanel.getByRole('button', { name: 'Create new key', exact: true }).click()
    await keysPanel.getByPlaceholder('e.g. Zapier integration').fill(keyName)
    await keysPanel.getByRole('button', { name: 'Create key', exact: true }).click()
    await expect(page.getByText('Your new API key', { exact: false })).toBeVisible()
    const keyRow = page.locator('.bl-list-row').filter({ hasText: keyName })
    await expect(keyRow).toBeVisible()
    await keyRow.getByRole('button', { name: 'Revoke', exact: true }).click()
    await page.locator('.rr-modal').getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(keyRow.getByText('Revoked', { exact: true })).toBeVisible()

    const webhookPanel = page.locator('.rr-panel').filter({
      has: page.getByRole('heading', { name: 'Webhooks', exact: true }),
    }).first()
    await webhookPanel.getByRole('button', { name: 'Add webhook', exact: true }).click()
    await webhookPanel.getByPlaceholder('https://your-app.com/webhooks/festio').fill(webhookUrl)
    await webhookPanel.getByRole('button', { name: 'Create webhook', exact: true }).click()
    await expect(page.getByText('Webhook signing secret', { exact: false })).toBeVisible()
    const webhookRow = page.locator('.bl-list-row').filter({ hasText: webhookUrl })
    await expect(webhookRow).toBeVisible()
    await webhookRow.getByRole('button', { name: 'View deliveries', exact: true }).click()
    await expect(webhookRow.getByText('No deliveries yet', { exact: true })).toBeVisible()
    await webhookRow.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText(`Deleted webhook ${webhookUrl}`, { exact: true })).toBeVisible()
  })
})
