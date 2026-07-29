import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

test.describe('Stage C operations — isolated staging fixture', () => {
  test.beforeEach(async ({ page }) => { await signIn(page) })

  test('seating uses confirmed table CRUD and floor-plan handoff', async ({ page }) => {
    const name = `E2E Table ${suffix}`
    await page.goto('/addons-redesign?tab=seating')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    const add = page.getByRole('button', { name: 'Table', exact: true })
    await expect(add.or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have seating enabled')

    try {
      await add.click()
      await page.getByLabel('Table name').fill(name)
      await page.getByLabel('Capacity').fill('4')
      await page.getByLabel('Category').fill('Synthetic QA')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Table saved', { exact: true })).toBeVisible()
      await expect(page.getByText(name, { exact: true })).toBeVisible()

      const row = page.locator('table.rr-table tbody tr').filter({ hasText: name })
      await row.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText(name, { exact: true })).toHaveCount(0)
    } finally {
      if (!page.isClosed()) {
        const row = page.locator('table.rr-table tbody tr').filter({ hasText: name })
        if (await row.count()) {
          await row.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('table groups use confirmed create, edit, and delete', async ({ page }) => {
    const original = `E2E Group ${suffix}`
    const edited = `${original} Edited`
    await page.goto('/addons-redesign?tab=seating')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    const add = page.getByRole('button', { name: 'Table Group', exact: true })
    await expect(add.or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have seating enabled')

    try {
      await add.click()
      await page.getByLabel('Group name').fill(original)
      await page.getByLabel('Group tag').fill(`e2e-${suffix}`)
      await page.getByRole('button', { name: 'Save group', exact: true }).click()
      await expect(page.getByText('Table group saved', { exact: true })).toBeVisible()
      const card = page.locator('.ad-group-card').filter({ hasText: original })
      await card.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByLabel('Group name').fill(edited)
      await page.getByRole('button', { name: 'Save group', exact: true }).click()
      await expect(page.locator('.ad-group-card').filter({ hasText: edited })).toBeVisible()
      await page.locator('.ad-group-card').filter({ hasText: edited }).getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Table group deleted', { exact: true })).toBeVisible()
      await expect(page.locator('.ad-group-card').filter({ hasText: edited })).toHaveCount(0)
    } finally {
      if (!page.isClosed()) {
        for (const name of [edited, original]) {
          const card = page.locator('.ad-group-card').filter({ hasText: name })
          if (await card.count()) await card.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('menu items use confirmed create, edit, and delete', async ({ page }) => {
    const categoryName = `E2E Category ${suffix}`
    const original = `E2E Item ${suffix}`
    const edited = `${original} Edited`
    await page.goto('/addons-redesign?tab=orders')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    const addCategory = page.getByRole('button', { name: 'Category', exact: true })
    await expect(addCategory.or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have orders enabled')

    try {
      await addCategory.click()
      await page.getByLabel('Category name').fill(categoryName)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Order category saved', { exact: true })).toBeVisible()
      const category = page.locator('.ad-cat-panel').filter({ hasText: categoryName })
      const add = category.getByRole('button', { name: '+ Item', exact: true })
      await add.click()
      await page.getByLabel('Item name').fill(original)
      await page.getByLabel('Item description').fill('Synthetic staging item')
      await page.getByRole('button', { name: 'Save item', exact: true }).click()
      await expect(page.getByText('Order item saved', { exact: true })).toBeVisible()
      const row = page.locator('.ad-cat-item').filter({ hasText: original })
      await row.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByLabel('Item name').fill(edited)
      await page.getByRole('button', { name: 'Save item', exact: true }).click()
      const editedRow = page.locator('.ad-cat-item').filter({ hasText: edited })
      await expect(editedRow).toBeVisible()
      await editedRow.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Order item deleted', { exact: true })).toBeVisible()
      await expect(editedRow).toHaveCount(0)
      await category.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Order category deleted', { exact: true })).toBeVisible()
    } finally {
      if (!page.isClosed()) {
        for (const name of [edited, original]) {
          const row = page.locator('.ad-cat-item').filter({ hasText: name })
          if (await row.count()) {
            await row.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
            await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          }
        }
        const category = page.locator('.ad-cat-panel').filter({ hasText: categoryName })
        if (await category.count()) {
          await category.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('kitchen reads the real dashboard without invented workflow states', async ({ page }) => {
    await page.goto('/kitchen-redesign')
    await expect(page.getByRole('heading', { name: 'Kitchen Display' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Order queue' })).toBeVisible()
    await expect(page.getByText('Preparing', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(0)
  })

  test('floor-plan redesign entry opens the production editor for the selected event', async ({ page }) => {
    await page.goto('/floorplan-redesign')
    await expect(page).toHaveURL(/\/floor-plan\/[^/]+$/)
    expect(new URL(page.url()).pathname).not.toBe('/floorplan-redesign')
    await expect(page.getByText(/Floor plan/i).first()).toBeVisible()
  })
})
