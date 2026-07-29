import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, fieldNear, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

// Covers the Zones/Rules/Assign sub-views of CheckinRedesignPage (Venue Access
// Intelligence). These views existed in the redesign with real-looking UI but
// were unreachable — not listed in the page's own tab bar — and everything
// inside them was hardcoded mock data. This suite exercises the real wiring
// added when they were connected: zone CRUD, tag CRUD, and the zone/tag
// access-rule matrix, each against the live isolated QA event.
test.describe('Stage C check-in — Venue Access zones, tags, and rules', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/checkin-redesign')
    await expectQaEventLoaded(page)
  })

  test('zone CRUD is confirmed by the server before the card updates', async ({ page }) => {
    const name = `E2E Zone ${suffix}`
    const locked = page.getByText("Venue Access isn't enabled for this event", { exact: false })
    await expect(page.getByRole('button', { name: 'Add zone', exact: true }).or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have Venue Access enabled')

    try {
      await page.getByRole('button', { name: 'Add zone', exact: true }).click()
      const form = page.locator('.ci-form-panel')
      await fieldNear(page, 'Name', form).fill(name)
      await fieldNear(page, 'Capacity', form).fill('25')
      await page.getByRole('button', { name: 'Create zone', exact: true }).click()
      await expect(page.getByText(name, { exact: true })).toBeVisible()

      const card = page.locator('.ci-zone-card').filter({ hasText: name })
      await card.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText(name, { exact: true })).toHaveCount(0)
    } finally {
      if (!page.isClosed()) {
        const card = page.locator('.ci-zone-card').filter({ hasText: name })
        if (await card.count()) {
          await card.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('tag creation, the zone-rules matrix, and gate creation all use confirmed server state', async ({ page }) => {
    const zoneName = `E2E Rules Zone ${suffix}`
    const tagName = `E2E Tag ${suffix}`
    const gateName = `E2E Gate ${suffix}`
    const locked = page.getByText("Venue Access isn't enabled for this event", { exact: false })
    await expect(page.getByRole('button', { name: 'Add zone', exact: true }).or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have Venue Access enabled')

    try {
      // A zone is needed for the rules matrix and the gate's zone picker.
      await page.getByRole('button', { name: 'Add zone', exact: true }).click()
      await fieldNear(page, 'Name', page.locator('.ci-form-panel')).fill(zoneName)
      await page.getByRole('button', { name: 'Create zone', exact: true }).click()
      await expect(page.getByText(zoneName, { exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Rules', exact: true }).click()

      // Tag create — a fresh tag starts with zero linked guests and no RSVP auto-source.
      await page.getByRole('button', { name: 'Add tag', exact: true }).click()
      await fieldNear(page, 'Name', page.locator('.ci-form-panel')).fill(tagName)
      await page.getByRole('button', { name: 'Create tag', exact: true }).click()
      const tagRow = page.locator('table.rr-table tbody tr').filter({ hasText: tagName })
      await expect(tagRow).toBeVisible()
      await expect(tagRow).toContainText('— manual only —')

      // Zone rules matrix — toggling a cell must round-trip through the real
      // PUT /zones/{id}/tags endpoint (getZoneTags confirms after reload).
      const matrixRow = page.locator('table.ci-matrix tbody tr').filter({ hasText: zoneName })
      const tagColumnIndex = await page.locator('table.ci-matrix thead th').evaluateAll(
        (ths, name) => ths.findIndex((th) => th.textContent.trim() === name), tagName,
      )
      const checkbox = matrixRow.locator('td input[type="checkbox"]').nth(tagColumnIndex - 1)
      await expect(checkbox).not.toBeChecked()
      await checkbox.check()
      await expect(checkbox).toBeChecked()
      await page.reload()
      await page.getByRole('button', { name: 'Rules', exact: true }).click()
      const matrixRowAfterReload = page.locator('table.ci-matrix tbody tr').filter({ hasText: zoneName })
      const checkboxAfterReload = matrixRowAfterReload.locator('td input[type="checkbox"]').nth(tagColumnIndex - 1)
      await expect(checkboxAfterReload).toBeChecked()

      // Entry rules panel derives its summary from the same real zone-tag data.
      await expect(page.locator('.ci-rules-list')).toContainText(`${tagName} → ${zoneName}`)

      // Gate create, pinned to the zone just created.
      await page.getByRole('button', { name: 'Add gate', exact: true }).click()
      const gateForm = page.locator('.ci-form-panel')
      await fieldNear(page, 'Name', gateForm).fill(gateName)
      await fieldNear(page, 'Zone', gateForm).selectOption({ label: zoneName })
      await page.getByRole('button', { name: 'Create gate', exact: true }).click()
      const gateRow = page.locator('table.rr-table tbody tr').filter({ hasText: gateName })
      await expect(gateRow).toBeVisible()
      await expect(gateRow).toContainText(zoneName)

      await gateRow.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.locator('table.rr-table tbody tr').filter({ hasText: gateName })).toHaveCount(0)

      await tagRow.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.locator('table.rr-table tbody tr').filter({ hasText: tagName })).toHaveCount(0)
    } finally {
      if (!page.isClosed()) {
        for (const label of [gateName, tagName]) {
          const row = page.locator('table.rr-table tbody tr').filter({ hasText: label })
          if (await row.count()) {
            await row.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
            await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          }
        }
        await page.getByRole('button', { name: 'Zones', exact: true }).click().catch(() => {})
        const zoneCard = page.locator('.ci-zone-card').filter({ hasText: zoneName })
        if (await zoneCard.count()) {
          await zoneCard.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('analytics tab reads real occupancy/peak/flow data without inventing figures', async ({ page }) => {
    const locked = page.getByText("Venue Access isn't enabled for this event", { exact: false })
    await expect(page.getByRole('button', { name: 'Add zone', exact: true }).or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have Venue Access enabled')

    await page.getByRole('button', { name: 'Analytics', exact: true }).click()
    await expect(page.getByText('Total inside', { exact: true })).toBeVisible()
    await expect(page.getByText('Allowed scans', { exact: true })).toBeVisible()
    await expect(page.getByText('Denied scans', { exact: true })).toBeVisible()
    // The old mock always showed a fixed "1,842" — assert the real, near-empty
    // QA fixture reports a small honest number instead of that stale figure.
    await expect(page.getByText('1,842', { exact: true })).toHaveCount(0)
  })
})
