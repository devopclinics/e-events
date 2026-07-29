import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  signIn,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

function guestContract(guest) {
  return {
    first_name: guest.first_name,
    last_name: guest.last_name,
    email: guest.email || null,
    phone: guest.phone || null,
    is_vip: !!guest.is_vip,
    admitted: !!guest.admitted,
    rsvp_status: guest.rsvp_status,
  }
}

function tableContract(table) {
  return {
    name: table.name,
    capacity: Number(table.capacity),
    category: table.category || null,
    sort_order: Number(table.sort_order) || 0,
    assigned_count: Number(table.assigned_count) || 0,
  }
}

function taskContract(task) {
  return {
    title: task.title,
    description: task.description || null,
    status: task.status,
    priority: task.priority,
    due_at: task.due_at || null,
    assigned_to_user_id: task.assigned_to_user_id || null,
  }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test.describe('Phase 9 legacy/redesign persisted-state parity', () => {
  test('guest creation produces the same persisted contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    const headers = await (async () => {
      await signIn(page)
      return authHeaders(page)
    })()
    const createdIds = []

    try {
      const legacyFirst = `Parity-Legacy-${run}`
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Guests/ }).click()
      await page.getByRole('button', { name: '+ Add guest', exact: true }).first().click()
      const legacyDialog = page.getByRole('heading', { name: 'Add guest', exact: true })
        .locator('xpath=ancestor::div[contains(@class,"fixed")]')
      await legacyDialog.locator('input').nth(0).fill(legacyFirst)
      await legacyDialog.locator('input').nth(1).fill('Parity')
      await legacyDialog.locator('input').nth(2).fill(`${legacyFirst.toLowerCase()}@example.test`)
      const legacyResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/guests`)
      )
      await legacyDialog.getByRole('button', { name: 'Add guest', exact: true }).click()
      const legacyGuest = await (await legacyResponse).json()
      createdIds.push(legacyGuest.id)

      const redesignFirst = `Parity-Redesign-${run}`
      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Add guest', exact: true }).first().click()
      const redesignDialog = page.locator('.rr-modal').filter({
        has: page.getByText('Add guest', { exact: true }),
      })
      await redesignDialog.locator('input').nth(0).fill(redesignFirst)
      await redesignDialog.locator('input').nth(1).fill('Parity')
      await redesignDialog.locator('input').nth(2).fill(`${redesignFirst.toLowerCase()}@example.test`)
      const redesignResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/guests`)
      )
      await redesignDialog.getByRole('button', { name: 'Add guest', exact: true }).click()
      const redesignGuest = await (await redesignResponse).json()
      createdIds.push(redesignGuest.id)

      const comparable = { first_name: 'Parity-Comparable', email: 'parity@example.test' }
      const legacyState = guestContract({ ...legacyGuest, ...comparable })
      const redesignState = guestContract({ ...redesignGuest, ...comparable })
      expect(redesignState).toEqual(legacyState)

      const persisted = await request.get(`/api/events/${eventId}/guests`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.some((guest) => guest.id === legacyGuest.id)).toBeTruthy()
      expect(rows.some((guest) => guest.id === redesignGuest.id)).toBeTruthy()
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
    }
  })

  test('table creation produces the same persisted seating contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    try {
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Seating/ }).click()
      await page.getByRole('button', { name: '+ Table', exact: true }).click()
      const legacyName = `Parity Legacy Table ${run}`
      await page.getByPlaceholder('Table 1').fill(legacyName)
      const legacyForm = page.locator('form').filter({ has: page.getByPlaceholder('Table 1') })
      await legacyForm.locator('input').nth(1).fill('Parity')
      await legacyForm.locator('input').nth(2).fill('12')
      await legacyForm.locator('input').nth(3).fill('7')
      const legacyResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/tables`)
      )
      await legacyForm.getByRole('button', { name: 'Add', exact: true }).click()
      const legacyTable = await (await legacyResponse).json()
      createdIds.push(legacyTable.id)

      await page.goto('/addons-redesign?tab=seating')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Table', exact: true }).first().click()
      const redesignName = `Parity Redesign Table ${run}`
      await page.getByLabel('Table name').fill(redesignName)
      await page.getByLabel('Capacity').fill('12')
      await page.getByLabel('Category').fill('Parity')
      await page.getByLabel('Sort order').fill('7')
      const redesignResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/tables`)
      )
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      const redesignTable = await (await redesignResponse).json()
      createdIds.push(redesignTable.id)

      expect(tableContract({ ...redesignTable, name: 'Parity Comparable' }))
        .toEqual(tableContract({ ...legacyTable, name: 'Parity Comparable' }))

      const persisted = await request.get(`/api/events/${eventId}/tables`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.some((table) => table.id === legacyTable.id)).toBeTruthy()
      expect(rows.some((table) => table.id === redesignTable.id)).toBeTruthy()
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/tables/${id}`, { headers })
      }
    }
  })

  test('task creation produces the same persisted workflow contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    async function createTaskFromCurrentPage(title, buttonName, legacy = false) {
      await page.getByRole('button', { name: buttonName, exact: true }).click()
      if (legacy) {
        await page.getByPlaceholder('Confirm florist').fill(title)
        await page.getByPlaceholder('Optional').fill('Phase 9 isolated parity fixture')
      } else {
        await page.getByPlaceholder('Task title').fill(title)
        await page.getByPlaceholder('Notes (optional)').fill('Phase 9 isolated parity fixture')
      }
      const response = page.waitForResponse((candidate) =>
        candidate.request().method() === 'POST'
        && candidate.url().endsWith(`/api/events/${eventId}/tasks`)
      )
      await page.getByRole('button', { name: legacy ? 'Create' : 'Create task', exact: true }).click()
      const task = await (await response).json()
      createdIds.push(task.id)
      return task
    }

    try {
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Tasks/ }).click()
      const legacyTask = await createTaskFromCurrentPage(`Parity legacy task ${run}`, '+ Task', true)

      await page.goto('/team-redesign?tab=tasks')
      await expectQaEventLoaded(page)
      const redesignTask = await createTaskFromCurrentPage(`Parity redesign task ${run}`, 'Task')

      const comparable = { title: 'Parity comparable task' }
      expect(taskContract({ ...redesignTask, ...comparable }))
        .toEqual(taskContract({ ...legacyTask, ...comparable }))

      const persisted = await request.get(`/api/events/${eventId}/tasks`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.some((task) => task.id === legacyTask.id)).toBeTruthy()
      expect(rows.some((task) => task.id === redesignTask.id)).toBeTruthy()
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/tasks/${id}`, { headers })
      }
    }
  })

  test('event lifecycle transitions persist identically', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)
    const headers = await authHeaders(page)
    const eventsResponse = await request.get('/api/events', { headers })
    const original = (await eventsResponse.json()).find((event) => event.id === eventId)
    expect(original).toBeTruthy()

    async function setStatus(status) {
      const currentResponse = await request.get('/api/events', { headers })
      const current = (await currentResponse.json()).find((event) => event.id === eventId)
      if (current?.status === status) return
      const response = await request.patch(`/api/events/${eventId}/status`, {
        headers,
        data: { status },
      })
      expect(response.ok()).toBeTruthy()
    }

    try {
      await setStatus('active')
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      const legacyResponse = page.waitForResponse((candidate) =>
        candidate.request().method() === 'PATCH'
        && candidate.url().endsWith(`/api/events/${eventId}/status`)
      )
      await page.getByRole('button', { name: /Stop check-in/ }).click()
      const legacyState = await (await legacyResponse).json()
      expect(legacyState.status).toBe('draft')

      await setStatus('active')
      await page.goto('/admin-redesign')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Active/ }).first().click()
      await page.getByRole('button', { name: /Draft/ }).click()
      const redesignResponse = page.waitForResponse((candidate) =>
        candidate.request().method() === 'PATCH'
        && candidate.url().endsWith(`/api/events/${eventId}/status`)
      )
      await page.getByRole('button', { name: 'Set Draft', exact: true }).click()
      const redesignState = await (await redesignResponse).json()

      expect(redesignState.status).toBe(legacyState.status)
      const persisted = await request.get('/api/events', { headers })
      expect((await persisted.json()).find((event) => event.id === eventId)?.status).toBe('draft')
    } finally {
      const latestResponse = await request.get('/api/events', { headers })
      const latest = (await latestResponse.json()).find((event) => event.id === eventId)
      if (latest?.status !== original.status) {
        if (original.status === 'ended' && latest?.status !== 'active') {
          await setStatus('active')
        }
        await setStatus(original.status)
      }
    }
  })

  test('legacy and redesign routes enforce the same unauthenticated boundary', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await page.goto('/admin-redesign')
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
  })
})
