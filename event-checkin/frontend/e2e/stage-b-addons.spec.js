import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

async function openAddonsTab(page, tab, readyAction) {
  await page.goto(`/addons-redesign?tab=${tab}`)
  await expectQaEventLoaded(page)
  const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
  const available = page.getByRole('button', { name: readyAction, exact: true })
  // Event feature flags load after the shell, so wait for the tab to settle into
  // either its real content or its entitlement gate before evaluating readiness.
  await expect(available.or(locked)).toBeVisible()
  test.skip(
    await locked.isVisible(),
    `The isolated QA event must have the ${tab} add-on enabled before CRUD parity can run`,
  )
}

function modalWithTitle(page, title) {
  return page.locator('.rr-modal').filter({ has: page.getByText(title, { exact: true }) })
}

function shipmentRow(page, name) {
  return page.locator('table.rr-table tbody tr').filter({ has: page.getByText(name, { exact: true }) })
}

function registryCard(page, title) {
  // The title shares a wrapping span with the kind badge, so there is no DOM
  // element whose complete text is exactly the title.
  return page.locator('.ad-registry-item').filter({ hasText: title })
}

async function deleteShipmentIfPresent(page, name) {
  const row = shipmentRow(page, name)
  if (await row.count()) {
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirm = modalWithTitle(page, 'Delete shipment')
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(row).toHaveCount(0)
  }
}

async function deleteRegistryItemIfPresent(page, title) {
  const card = registryCard(page, title)
  if (await card.count()) {
    await card.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirm = modalWithTitle(page, 'Delete registry item')
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(card).toHaveCount(0)
  }
}

test.describe('Stage B add-ons CRUD — isolated staging fixture', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create, edit, and delete a synthetic delivery workflow', async ({ page }) => {
    const originalName = `E2E Shipment ${suffix}`
    const editedName = `E2E Shipment Edited ${suffix}`

    await openAddonsTab(page, 'logistics', 'New shipment')
    try {
      await page.getByRole('button', { name: 'New shipment', exact: true }).click()
      const createModal = modalWithTitle(page, 'New shipment')
      await createModal.locator('input').nth(0).fill(originalName)
      await createModal.locator('select').selectOption('post')
      await createModal.locator('input').nth(1).fill('E2E Synthetic Vendor')
      await createModal.locator('textarea').fill('Synthetic staging parity record')
      await createModal.getByRole('button', { name: 'Save shipment', exact: true }).click()

      await expect(page.getByText('Shipment created', { exact: true })).toBeVisible()
      const originalRow = shipmentRow(page, originalName)
      await expect(originalRow).toBeVisible()
      await expect(originalRow.getByText('Post-event', { exact: true })).toBeVisible()
      await expect(originalRow.getByText('E2E Synthetic Vendor', { exact: true })).toBeVisible()

      await originalRow.getByRole('button', { name: 'Edit', exact: true }).click()
      const editModal = modalWithTitle(page, `Edit ${originalName}`)
      await editModal.locator('input').nth(0).fill(editedName)
      await editModal.locator('select').selectOption('pre')
      await editModal.getByRole('button', { name: 'Save shipment', exact: true }).click()

      await expect(page.getByText('Shipment updated', { exact: true })).toBeVisible()
      const editedRow = shipmentRow(page, editedName)
      await expect(editedRow).toBeVisible()
      await expect(editedRow.getByText('Pre-event', { exact: true })).toBeVisible()

      await deleteShipmentIfPresent(page, editedName)
      await expect(page.getByText('Shipment deleted', { exact: true })).toBeVisible()
    } finally {
      // Cleanup is best-effort so it cannot hide the actionable assertion that
      // originally failed (and Playwright may already have closed a timed-out page).
      if (!page.isClosed()) {
        await deleteShipmentIfPresent(page, editedName).catch(() => {})
        await deleteShipmentIfPresent(page, originalName).catch(() => {})
      }
    }
  })

  for (const scenario of [
    { kind: 'item', button: 'Add item', type: 'Physical item', extra: '3' },
    { kind: 'fund', button: 'Add cash fund', type: 'Cash fund', extra: '125.50' },
    { kind: 'link', button: 'Add link', type: 'External link', extra: 'https://example.com/e2e-registry' },
  ]) {
    test(`create, edit, and delete a synthetic registry ${scenario.kind}`, async ({ page }) => {
      const originalTitle = `E2E ${scenario.kind} ${suffix}`
      const editedTitle = `E2E ${scenario.kind} Edited ${suffix}`

      await openAddonsTab(page, 'registry', scenario.button)
      try {
        await page.getByRole('button', { name: scenario.button, exact: true }).click()
        const createModal = modalWithTitle(page, 'Add registry item')
        await expect(createModal.locator('select')).toHaveValue(scenario.kind)
        await createModal.locator('input').nth(0).fill(originalTitle)
        await createModal.locator('textarea').fill('Synthetic staging parity record')
        await createModal.locator('input').nth(1).fill(scenario.extra)
        await createModal.getByRole('button', { name: 'Save item', exact: true }).click()

        await expect(page.getByText('Registry item created', { exact: true })).toBeVisible()
        const originalCard = registryCard(page, originalTitle)
        await expect(originalCard).toBeVisible()
        await expect(originalCard.getByText(scenario.kind, { exact: true })).toBeVisible()

        await originalCard.getByRole('button', { name: 'Edit', exact: true }).click()
        const editModal = modalWithTitle(page, `Edit ${originalTitle}`)
        await editModal.locator('input').nth(0).fill(editedTitle)
        await editModal.getByRole('button', { name: 'Save item', exact: true }).click()

        await expect(page.getByText('Registry item updated', { exact: true })).toBeVisible()
        await expect(registryCard(page, editedTitle)).toBeVisible()

        await deleteRegistryItemIfPresent(page, editedTitle)
        await expect(page.getByText('Registry item deleted', { exact: true })).toBeVisible()
      } finally {
        if (!page.isClosed()) {
          await deleteRegistryItemIfPresent(page, editedTitle).catch(() => {})
          await deleteRegistryItemIfPresent(page, originalTitle).catch(() => {})
        }
      }
    })
  }
})
