import { test, expect } from '@playwright/test'
import { axeSeriousViolations, expectQaEventLoaded, formatAxeViolations, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Stage B team task CRUD — isolated staging fixture', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const originalTitle = `E2E task ${suffix}`
  const editedTitle = `E2E task edited ${suffix}`
  const subtaskTitle = `E2E subtask ${suffix}`

  async function openTasks(page) {
    await page.goto('/team-redesign?tab=tasks')
    await expectQaEventLoaded(page)
    await expect(page.getByRole('button', { name: 'Task', exact: true })).toBeVisible()
  }

  function taskRow(page, title) {
    return page.locator('tbody tr').filter({
      has: page.getByRole('button', { name: title, exact: true }),
    })
  }

  async function removeTaskIfPresent(page, title) {
    const row = taskRow(page, title)
    if (await row.count() === 0) return
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const dialog = page.locator('.rr-modal').filter({
      has: page.getByText('Delete task', { exact: true }),
    })
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(row).toHaveCount(0)
  }

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await openTasks(page)
  })

  test.afterEach(async ({ page }) => {
    // Deleting the parent also removes its synthetic subtask and activity.
    // Try both names so cleanup works if the test failed midway through editing.
    const closeDetail = page.getByRole('button', { name: 'Close ✕', exact: true })
    if (await closeDetail.isVisible().catch(() => false)) await closeDetail.click()
    await openTasks(page).catch(() => {})
    await removeTaskIfPresent(page, editedTitle).catch(() => {})
    await removeTaskIfPresent(page, originalTitle).catch(() => {})
  })

  test('redesign team/tasks page has no serious/critical accessibility violations', async ({ page }) => {
    const violations = await axeSeriousViolations(page)
    expect(violations, formatAxeViolations(violations)).toEqual([])
  })

  test('create, update status, add/complete a subtask, edit, and delete a synthetic task', async ({ page }) => {
    await page.getByRole('button', { name: 'Task', exact: true }).click()
    await page.getByPlaceholder('Task title').fill(originalTitle)
    await page.getByPlaceholder('Notes (optional)').fill('Synthetic Playwright release-gate task; safe to delete.')
    await page.getByRole('button', { name: 'Create task', exact: true }).click()

    await expect(page.getByText('Task created.', { exact: true })).toBeVisible()
    let row = taskRow(page, originalTitle)
    await expect(row).toHaveCount(1)

    const taskStatus = row.getByRole('combobox', { name: `Status for ${originalTitle}` })
    await taskStatus.selectOption('in_progress')
    await expect(taskStatus).toHaveValue('in_progress')

    await row.getByRole('button', { name: originalTitle, exact: true }).click()
    const detail = page.locator('.tm-detail')
    await expect(detail.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible()
    await detail.getByPlaceholder('New subtask').fill(subtaskTitle)
    await detail.getByRole('button', { name: 'Add', exact: true }).click()

    const subtask = detail.getByText(subtaskTitle, { exact: true })
    await expect(subtask).toBeVisible()
    const subtaskCheckbox = detail.locator('label.tm-subtask-row', { hasText: subtaskTitle }).getByRole('checkbox')
    // This is a server-confirmed controlled checkbox: its checked state changes
    // only after PATCH + detail refetch completes, so Playwright's `check()`
    // immediate-state assertion is intentionally too strict here.
    await subtaskCheckbox.click()
    await expect(subtaskCheckbox).toBeChecked()
    await expect(subtask).toHaveClass(/tm-subtask-done/)

    await detail.getByRole('button', { name: 'Close ✕', exact: true }).click()
    row = taskRow(page, originalTitle)
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByPlaceholder('Task title').fill(editedTitle)
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()

    await expect(page.getByText('Task updated.', { exact: true })).toBeVisible()
    row = taskRow(page, editedTitle)
    await expect(row).toHaveCount(1)
    await expect(taskRow(page, originalTitle)).toHaveCount(0)

    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const dialog = page.locator('.rr-modal').filter({
      has: page.getByText('Delete task', { exact: true }),
    })
    await expect(dialog.getByText(`Delete task "${editedTitle}"? All attachments and comments will be removed.`, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Task deleted.', { exact: true })).toBeVisible()
    await expect(taskRow(page, editedTitle)).toHaveCount(0)
  })
})
