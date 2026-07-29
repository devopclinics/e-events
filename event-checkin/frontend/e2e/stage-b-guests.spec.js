import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, openGuestActions, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Stage B guest CRUD — isolated staging fixture', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const firstName = `E2E-${suffix}`
  const editedFirstName = `E2E-Edited-${suffix}`
  const lastName = 'Synthetic'
  const originalName = `${firstName} ${lastName}`
  const editedName = `${editedFirstName} ${lastName}`

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/guests-redesign')
    await expectQaEventLoaded(page)
  })

  test('add, edit, and remove a synthetic guest with confirmed UI state', async ({ page }) => {
    await page.getByRole('button', { name: 'Add guest', exact: true }).first().click()
    const dialog = page.locator('.rr-modal').filter({ has: page.getByText('Add guest', { exact: true }) })
    await dialog.locator('input').nth(0).fill(firstName)
    await dialog.locator('input').nth(1).fill(lastName)
    await dialog.getByRole('button', { name: 'Add guest', exact: true }).click()

    await expect(page.getByText(`${originalName} added`, { exact: false })).toBeVisible()
    await page.getByPlaceholder('Search guests by name…').fill(originalName)
    await expect(page.getByText(originalName, { exact: true })).toBeVisible()

    await openGuestActions(page, originalName)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editDialog = page.locator('.rr-modal').filter({ has: page.getByText(`Edit: ${originalName}`, { exact: true }) })
    await editDialog.locator('input').nth(0).fill(editedFirstName)
    await editDialog.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(page.getByText(`${editedName} updated`, { exact: false })).toBeVisible()
    await page.getByPlaceholder('Search guests by name…').fill(editedName)
    await expect(page.getByText(editedName, { exact: true })).toBeVisible()

    await openGuestActions(page, editedName)
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click()

    await expect(page.getByText(`${editedName} removed`, { exact: false })).toBeVisible()
    await expect(page.getByText(editedName, { exact: true })).toHaveCount(0)
  })

  test('CSV import uses the real upload contract and the imported guest is confirmed by the server', async ({ page }) => {
    const importFirstName = `E2E-Import-${suffix}`
    const importName = `${importFirstName} Synthetic`
    const csv = `first_name,last_name,email,phone\n${importFirstName},Synthetic,,\n`

    await page.getByRole('button', { name: 'Import guests', exact: true }).click()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-guests.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
    })
    await page.getByRole('button', { name: 'Continue to import', exact: true }).click()

    const uploadResponse = page.waitForResponse((response) =>
      /\/guests\/upload$/.test(response.url()) && response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Validate & import', exact: true }).click()
    const response = await uploadResponse
    expect(response.status()).toBeLessThan(300)

    await expect(page.getByRole('heading', { name: 'Import complete', exact: true }).first()).toBeVisible()
    await expect(page.getByText('Imported', { exact: true })).toBeVisible()
    const importedRow = page.locator('table.rr-table tr').filter({ has: page.getByRole('cell', { name: 'Imported', exact: true }) })
    await expect(importedRow.locator('strong')).toHaveText('1')
    await page.getByRole('button', { name: 'Done', exact: true }).click()

    await page.getByPlaceholder('Search guests by name…').fill(importName)
    await expect(page.getByText(importName, { exact: true })).toBeVisible()

    await openGuestActions(page, importName)
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
    await expect(page.getByText(`${importName} removed`, { exact: false })).toBeVisible()
  })
})
