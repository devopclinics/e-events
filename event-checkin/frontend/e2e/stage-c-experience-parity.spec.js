import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, firebaseAccessToken, requiredEnv, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test('Experience redesign exposes legacy step settings and preserves untouched config', async ({ page }) => {
  const eventId = requiredEnv('E2E_EVENT_ID')
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const workflowName = `E2E Experience Parity ${suffix}`
  await signIn(page)
  const token = await firebaseAccessToken(page)
  const headers = { Authorization: `Bearer ${token}` }

  const createdResponse = await page.request.post(`/api/events/${eventId}/experience/workflows`, {
    headers,
    data: {
      name: workflowName,
      steps: [
        { key: 'arrival', type: 'check_in', title: 'Arrival', sort_order: 10, required: true, enabled: true },
        {
          key: 'complex_session',
          type: 'session_attendance',
          title: 'Complex Session',
          description: 'Parity fixture',
          sort_order: 20,
          required: false,
          enabled: true,
          is_segment: true,
          starts_offset_seconds: 600,
          duration_seconds: 1800,
          conditions: { ticket_type: 'vip' },
          config: {
            depends_on: ['arrival'],
            custom_legacy: { keep: 'yes' },
            messages: { guest: 'Guest copy', staff: 'Staff copy', complete: 'Complete copy' },
            session: { topic: 'Operations', date: '2026-08-01', start_time: '10:00', end_time: '10:30', room: 'Hall A', speaker: 'Host', capacity: 80, checkin_window_minutes: 45 },
            program: { category: 'Main stage' },
            announce: { enabled: true, title: 'Starting now', body: 'Take your seats' },
          },
        },
        {
          key: 'room_step',
          type: 'room_assignment',
          title: 'Room Assignment',
          sort_order: 30,
          required: false,
          enabled: true,
          config: { room_assignment: { assignment_mode: 'scoped', scoped: true, scope: 'luncheon', room: 'Hall B', table_group: 'VIP' } },
        },
        {
          key: 'feedback_step',
          type: 'feedback',
          title: 'Feedback',
          sort_order: 40,
          required: false,
          enabled: true,
          config: {
            owner: 'guest',
            feedback: {
              audience: 'session',
              session_step_id: 'complex_session',
              anonymous: true,
              status: 'open',
              allow_edit: true,
              questions: [{ id: 'rating', type: 'rating', prompt: 'How was it?', required: true }],
            },
          },
        },
      ],
    },
  })
  const workflow = await createdResponse.json()
  expect(createdResponse.ok(), JSON.stringify(workflow)).toBeTruthy()

  try {
    await page.goto('/experience-redesign')
    await expectQaEventLoaded(page)
    const workflowCard = page.locator('.ex-wf-card').filter({ hasText: workflowName })
    await expect(workflowCard).toBeVisible()
    const selectButton = workflowCard.getByRole('button', { name: 'Select', exact: true })
    if (await selectButton.isVisible()) await selectButton.click()
    await page.getByRole('button', { name: 'Workflow', exact: true }).click()

    await page.getByRole('button', { name: 'Edit Complex Session', exact: true }).click()
    const editor = page.locator('.ex-step-editor')
    await expect(editor).toBeVisible()
    await expect(editor.getByLabel('Sort order')).toHaveValue('20')
    await expect(editor.getByLabel('Check-in opens (minutes before)')).toHaveValue('45')
    await expect(editor.getByLabel('Start offset (seconds)')).toHaveValue('600')
    await expect(editor.getByLabel('Duration (seconds)')).toHaveValue('1800')
    await expect(editor.getByLabel('Conditions JSON')).toContainText('"ticket_type": "vip"')
    await editor.getByLabel('Step title').fill('Complex Session Updated')
    await editor.getByLabel('Staff scanner prompt').fill('Updated staff copy')
    await editor.getByRole('button', { name: 'Save step', exact: true }).click()
    await expect(page.getByText('Step updated.', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Edit Room Assignment', exact: true }).click()
    await expect(editor.getByLabel('Assignment mode')).toHaveValue('scoped')
    await expect(editor.getByLabel('Assignment scope')).toHaveValue('luncheon')
    await editor.getByRole('button', { name: 'Close ✕', exact: true }).click()

    await page.getByRole('button', { name: 'Edit Feedback', exact: true }).click()
    await expect(editor.getByLabel('Audience', { exact: true })).toHaveValue('session')
    await expect(editor.getByDisplayValue('How was it?')).toBeVisible()

    const workflowsResponse = await page.request.get(`/api/events/${eventId}/experience/workflows`, { headers })
    expect(workflowsResponse.ok()).toBeTruthy()
    const persisted = (await workflowsResponse.json()).find((item) => item.id === workflow.id)
    const session = persisted.steps.find((step) => step.key === 'complex_session')
    expect(session).toMatchObject({
      title: 'Complex Session Updated',
      sort_order: 20,
      is_segment: true,
      starts_offset_seconds: 600,
      duration_seconds: 1800,
      conditions: { ticket_type: 'vip' },
    })
    expect(session.config).toMatchObject({
      depends_on: ['arrival'],
      custom_legacy: { keep: 'yes' },
      messages: { guest: 'Guest copy', staff: 'Updated staff copy', complete: 'Complete copy' },
      session: { topic: 'Operations', checkin_window_minutes: 45 },
      program: { category: 'Main stage' },
      announce: { enabled: true, title: 'Starting now', body: 'Take your seats' },
    })
  } finally {
    await page.request.delete(`/api/events/${eventId}/experience/workflows/${workflow.id}`, { headers }).catch(() => {})
    await page.request.patch(`/api/events/${eventId}/features`, {
      headers,
      data: { experience_enabled: true },
    }).catch(() => {})
  }
})
