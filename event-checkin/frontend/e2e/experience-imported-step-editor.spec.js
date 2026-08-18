import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, firebaseAccessToken, requiredEnv, signIn } from './helpers.js'

// Regression test for a crash where opening the step editor for any
// session_attendance step (e.g. everything created via "Import sessions")
// threw `ReferenceError: realEvent is not defined` — ExperienceStepEditor is
// a sibling component, not a closure over ExperienceRedesignPage's state, so
// referencing realEvent/eventSpeakers directly (instead of as props) crashed
// the whole route via RedesignRouteBoundary.
test('Edit settings on an imported session step does not crash the route', async ({ page }) => {
  const eventId = requiredEnv('E2E_EVENT_ID')
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message))

  await signIn(page)
  const token = await firebaseAccessToken(page)
  const headers = { Authorization: `Bearer ${token}` }

  const workflowName = `Repro ${Date.now()}`
  const created = await page.request.post(`/api/events/${eventId}/experience/workflows`, {
    headers, data: { name: workflowName, steps: [] },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const workflow = await created.json()

  try {
    await page.goto('/experience-redesign')
    await expectQaEventLoaded(page)
    const workflowCard = page.locator('.ex-wf-card').filter({ hasText: workflowName })
    await expect(workflowCard).toBeVisible()
    const selectButton = workflowCard.getByRole('button', { name: 'Select', exact: true })
    if (await selectButton.isVisible().catch(() => false)) await selectButton.click()
    await page.getByRole('button', { name: 'Workflow', exact: true }).click()
    await page.waitForTimeout(500)

    const importBtn = page.getByRole('button', { name: 'Import sessions', exact: true })
    await expect(importBtn).toBeVisible({ timeout: 10000 })
    await importBtn.click()
    const importPayload = JSON.stringify([
      {
        topic: 'Onboarding/Cabin Allocation/Dinner/Networking/Magrib-Ishai\nSpeaker(s): Azeez Oladejo, Raheem Adams',
        date: '2026-09-04', start_time: '18:00', end_time: '19:30',
        room: 'Carolina Creek Camps & Retreat Center', speaker: '', capacity: null,
      },
    ])
    await page.locator('textarea').last().fill(importPayload)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.waitForTimeout(1500)

    const editBtn = page.locator('button[title="Edit settings"]').first()
    await expect(editBtn).toBeVisible({ timeout: 10000 })
    await editBtn.click()

    const editor = page.locator('.ex-step-editor')
    await expect(editor).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('This page hit a snag', { exact: false })).not.toBeVisible()
    const crash = [...pageErrors, ...consoleErrors].find((e) => e.includes('is not defined'))
    expect(crash, JSON.stringify({ pageErrors, consoleErrors })).toBeUndefined()
  } finally {
    await page.request.delete(`/api/events/${eventId}/experience/workflows/${workflow.id}`, { headers }).catch(() => {})
  }
})
