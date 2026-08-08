import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  openGuestActions,
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

function householdContract(household) {
  return {
    name: household.name,
    description: household.description || null,
    sort_order: Number(household.sort_order) || 0,
    default_table_group_id: household.default_table_group_id || null,
    default_table_id: household.default_table_id || null,
    member_count: Number(household.member_count) || 0,
  }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test.describe('Phase 9 legacy/redesign persisted-state parity — guests extra', () => {
  test('guest edit produces the same persisted contract', async ({ page, request }) => {
    test.setTimeout(60000)
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []
    const targetPhone = '+14155550199'

    try {
      const legacyName = `EditLegacy-${run}`
      const legacyCreate = await request.post(`/api/events/${eventId}/guests`, {
        headers,
        data: { first_name: legacyName, last_name: 'Synthetic' },
      })
      expect(legacyCreate.ok()).toBeTruthy()
      const legacyGuest = await legacyCreate.json()
      createdIds.push(legacyGuest.id)

      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Guests/ }).click()
      await page.getByPlaceholder('Search guests by name').fill(`${legacyName} Synthetic`)
      const legacyRow = page.locator('table tbody tr').filter({ hasText: legacyName })
      await legacyRow.getByRole('button', { name: 'Edit', exact: true }).click()
      const legacyDialog = page.getByRole('heading', { name: 'Edit guest', exact: true })
        .locator('xpath=ancestor::div[contains(@class,"fixed")]')
      await legacyDialog.locator('input').nth(3).fill(targetPhone)
      const legacyResponse = page.waitForResponse((response) =>
        response.request().method() === 'PATCH'
        && response.url().endsWith(`/api/events/${eventId}/guests/${legacyGuest.id}`)
      )
      await legacyDialog.getByRole('button', { name: 'Save changes', exact: true }).click()
      const legacyUpdated = await (await legacyResponse).json()

      const redesignName = `EditRedesign-${run}`
      const redesignCreate = await request.post(`/api/events/${eventId}/guests`, {
        headers,
        data: { first_name: redesignName, last_name: 'Synthetic' },
      })
      expect(redesignCreate.ok()).toBeTruthy()
      const redesignGuest = await redesignCreate.json()
      createdIds.push(redesignGuest.id)

      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      const redesignFullName = `${redesignName} Synthetic`
      await page.getByPlaceholder('Search guests by name…').fill(redesignFullName)
      await openGuestActions(page, redesignFullName)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const redesignDialog = page.locator('.rr-modal').filter({
        has: page.getByText(`Edit: ${redesignFullName}`, { exact: true }),
      })
      await redesignDialog.locator('input').nth(3).fill(targetPhone)
      // The redesign edit modal sends back the guest's last-seen updated_at as
      // ?if_unmodified_since=... (optimistic-concurrency guard the legacy UI
      // doesn't send — see update_guest() in guests.py), so the PATCH URL
      // carries a query string here and endsWith() would never match.
      const redesignResponse = page.waitForResponse((response) =>
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === `/api/events/${eventId}/guests/${redesignGuest.id}`
      )
      await redesignDialog.getByRole('button', { name: 'Save', exact: true }).click()
      const redesignUpdated = await (await redesignResponse).json()

      // Both edits target the same phone value, so the persisted field itself
      // — not just a normalized shape — must be byte-identical between UIs.
      expect(legacyUpdated.phone).toBe(targetPhone)
      expect(redesignUpdated.phone).toBe(targetPhone)

      const comparable = { first_name: 'Comparable', last_name: 'Comparable' }
      expect(guestContract({ ...redesignUpdated, ...comparable }))
        .toEqual(guestContract({ ...legacyUpdated, ...comparable }))

      const persisted = await request.get(`/api/events/${eventId}/guests`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.find((guest) => guest.id === legacyGuest.id)?.phone).toBe(targetPhone)
      expect(rows.find((guest) => guest.id === redesignGuest.id)?.phone).toBe(targetPhone)
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
    }
  })

  test('guest delete produces the same persisted state', async ({ page, request }) => {
    test.setTimeout(60000)
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    try {
      const legacyName = `DeleteLegacy-${run}`
      const legacyCreate = await request.post(`/api/events/${eventId}/guests`, {
        headers,
        data: { first_name: legacyName, last_name: 'Synthetic' },
      })
      expect(legacyCreate.ok()).toBeTruthy()
      const legacyGuest = await legacyCreate.json()
      createdIds.push(legacyGuest.id)

      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Guests/ }).click()
      await page.getByPlaceholder('Search guests by name').fill(`${legacyName} Synthetic`)
      const legacyRow = page.locator('table tbody tr').filter({ hasText: legacyName })
      page.once('dialog', (dialog) => dialog.accept())
      const legacyDeleteResponse = page.waitForResponse((response) =>
        response.request().method() === 'DELETE'
        && response.url().endsWith(`/api/events/${eventId}/guests/${legacyGuest.id}`)
      )
      await legacyRow.getByRole('button', { name: 'Remove', exact: true }).click()
      const legacyStatus = (await legacyDeleteResponse).status()

      const redesignName = `DeleteRedesign-${run}`
      const redesignCreate = await request.post(`/api/events/${eventId}/guests`, {
        headers,
        data: { first_name: redesignName, last_name: 'Synthetic' },
      })
      expect(redesignCreate.ok()).toBeTruthy()
      const redesignGuest = await redesignCreate.json()
      createdIds.push(redesignGuest.id)

      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      const redesignFullName = `${redesignName} Synthetic`
      await page.getByPlaceholder('Search guests by name…').fill(redesignFullName)
      await openGuestActions(page, redesignFullName)
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      const redesignDeleteResponse = page.waitForResponse((response) =>
        response.request().method() === 'DELETE'
        && response.url().endsWith(`/api/events/${eventId}/guests/${redesignGuest.id}`)
      )
      await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
      const redesignStatus = (await redesignDeleteResponse).status()

      expect(legacyStatus).toBe(204)
      expect(redesignStatus).toBe(legacyStatus)

      const persisted = await request.get(`/api/events/${eventId}/guests`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.some((guest) => guest.id === legacyGuest.id)).toBe(false)
      expect(rows.some((guest) => guest.id === redesignGuest.id)).toBe(false)
    } finally {
      // Both guests were removed by the tested workflow itself; this is a
      // harmless no-op backstop (404) if the assertions above ever fail early.
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
    }
  })

  test('CSV guest import produces the same persisted contract', async ({ page, request }) => {
    test.setTimeout(60000)
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    try {
      const legacyFirst = `CsvLegacy-${run}`
      const legacyCsv = `first_name,last_name,email,phone\n${legacyFirst},Synthetic,,\n`
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      const legacyUploadResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/guests/upload`)
      )
      await page.locator('input[type="file"]').setInputFiles({
        name: 'e2e-parity-legacy.csv', mimeType: 'text/csv', buffer: Buffer.from(legacyCsv),
      })
      const legacyResult = await (await legacyUploadResponse).json()
      expect(legacyResult.added).toBe(1)

      const redesignFirst = `CsvRedesign-${run}`
      const redesignCsv = `first_name,last_name,email,phone\n${redesignFirst},Synthetic,,\n`
      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Import guests', exact: true }).click()
      await page.locator('input[type="file"]').setInputFiles({
        name: 'e2e-parity-redesign.csv', mimeType: 'text/csv', buffer: Buffer.from(redesignCsv),
      })
      await page.getByRole('button', { name: 'Continue to import', exact: true }).click()
      const redesignUploadResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/guests/upload`)
      )
      await page.getByRole('button', { name: 'Validate & import', exact: true }).click()
      const redesignResult = await (await redesignUploadResponse).json()
      expect(redesignResult.added).toBe(1)
      await page.getByRole('button', { name: 'Done', exact: true }).click()

      // Neither upload response carries the created guest — both endpoints
      // return only an import summary — so confirm the real persisted rows.
      const persisted = await request.get(`/api/events/${eventId}/guests`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      const legacyGuest = rows.find((guest) => guest.first_name === legacyFirst)
      const redesignGuest = rows.find((guest) => guest.first_name === redesignFirst)
      expect(legacyGuest, 'legacy CSV import should have created a guest').toBeTruthy()
      expect(redesignGuest, 'redesign CSV import should have created a guest').toBeTruthy()
      createdIds.push(legacyGuest.id, redesignGuest.id)

      const comparable = { first_name: 'Comparable' }
      expect(guestContract({ ...redesignGuest, ...comparable }))
        .toEqual(guestContract({ ...legacyGuest, ...comparable }))
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
    }
  })

  test('household creation produces the same persisted contract', async ({ page, request }) => {
    test.setTimeout(60000)
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    try {
      const legacyName = `HH-Legacy-${run}`
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Guests/ }).click()
      await page.getByRole('button', { name: '+ Household', exact: true }).click()
      const legacyForm = page.locator('form').filter({ has: page.getByPlaceholder('The Smith Family') })
      await legacyForm.locator('input').nth(0).fill(legacyName)
      // Force sort_order to 0 explicitly — the legacy form defaults this to
      // the current household count in this shared fixture, which would
      // otherwise make the two sides incomparable for reasons unrelated to
      // the workflow under test.
      await legacyForm.locator('input').nth(1).fill('0')
      await legacyForm.locator('input').nth(2).fill('Synthetic parity household')
      const legacyResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/households`)
      )
      await legacyForm.getByRole('button', { name: 'Create', exact: true }).click()
      const legacyHousehold = await (await legacyResponse).json()
      createdIds.push(legacyHousehold.id)

      const redesignName = `HH-Redesign-${run}`
      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Household', exact: true }).click()
      const redesignDialog = page.locator('.rr-modal').filter({
        has: page.getByText('Create household', { exact: true }),
      })
      await redesignDialog.locator('input').fill(redesignName)
      await redesignDialog.locator('textarea').fill('Synthetic parity household')
      const redesignResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/households`)
      )
      await redesignDialog.getByRole('button', { name: 'Save household', exact: true }).click()
      const redesignHousehold = await (await redesignResponse).json()
      createdIds.push(redesignHousehold.id)

      const comparable = { name: 'Comparable Household' }
      expect(householdContract({ ...redesignHousehold, ...comparable }))
        .toEqual(householdContract({ ...legacyHousehold, ...comparable }))

      const persisted = await request.get(`/api/events/${eventId}/households`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.some((household) => household.id === legacyHousehold.id)).toBeTruthy()
      expect(rows.some((household) => household.id === redesignHousehold.id)).toBeTruthy()
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/events/${eventId}/households/${id}`, { headers })
      }
    }
  })

  test('bulk-assigning guests to a household produces the same persisted contract', async ({ page, request }) => {
    test.setTimeout(60000)
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdGuestIds = []
    const createdHouseholdIds = []

    async function createGuest(name) {
      const response = await request.post(`/api/events/${eventId}/guests`, {
        headers, data: { first_name: name, last_name: 'Synthetic' },
      })
      expect(response.ok()).toBeTruthy()
      const guest = await response.json()
      createdGuestIds.push(guest.id)
      return guest
    }

    async function createHousehold(name) {
      const response = await request.post(`/api/events/${eventId}/households`, {
        headers, data: { name },
      })
      expect(response.ok()).toBeTruthy()
      const household = await response.json()
      createdHouseholdIds.push(household.id)
      return household
    }

    try {
      const legacyGuestName = `BulkLegacy-${run}`
      const legacyGuest = await createGuest(legacyGuestName)
      const legacyHouseholdName = `BulkHH Legacy ${run}`
      const legacyHousehold = await createHousehold(legacyHouseholdName)

      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Guests/ }).click()
      await page.getByPlaceholder('Search guests by name').fill(`${legacyGuestName} Synthetic`)
      await page.getByRole('checkbox', { name: `Select ${legacyGuestName} Synthetic` }).check()
      const legacyAssignResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/guests/bulk-assign-household`)
      )
      await page.locator('select').filter({ hasText: 'Assign household' })
        .selectOption({ label: legacyHouseholdName })
      const legacyAssignResult = await (await legacyAssignResponse).json()
      expect(legacyAssignResult.household_id).toBe(legacyHousehold.id)

      const redesignGuestName = `BulkRedesign-${run}`
      const redesignGuest = await createGuest(redesignGuestName)
      const redesignHouseholdName = `BulkHH Redesign ${run}`
      const redesignHousehold = await createHousehold(redesignHouseholdName)

      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      const redesignFullName = `${redesignGuestName} Synthetic`
      await page.getByPlaceholder('Search guests by name…').fill(redesignFullName)
      const redesignRow = page.locator('.gr-guest-table tbody tr').filter({ hasText: redesignFullName })
      await redesignRow.locator('input[type="checkbox"]').check()
      const redesignAssignResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().endsWith(`/api/events/${eventId}/guests/bulk-assign-household`)
      )
      await page.getByLabel('Assign household').selectOption({ label: redesignHouseholdName })
      const redesignAssignResult = await (await redesignAssignResponse).json()
      expect(redesignAssignResult.household_id).toBe(redesignHousehold.id)

      // The bulk-assign response itself is just a summary ({ok, updated,
      // household_id}), not the guest — so the real assertion is the
      // guest's persisted household_id, fetched fresh from the server.
      expect(redesignAssignResult.ok).toBe(legacyAssignResult.ok)
      expect(redesignAssignResult.updated).toBe(legacyAssignResult.updated)

      const persisted = await request.get(`/api/events/${eventId}/guests`, { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.find((guest) => guest.id === legacyGuest.id)?.household_id).toBe(legacyHousehold.id)
      expect(rows.find((guest) => guest.id === redesignGuest.id)?.household_id).toBe(redesignHousehold.id)
    } finally {
      // Guests must be deleted (or unassigned) before their households —
      // delete_household 409s while any guest still belongs to it.
      for (const id of createdGuestIds) {
        await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
      for (const id of createdHouseholdIds) {
        await request.delete(`/api/events/${eventId}/households/${id}`, { headers })
      }
    }
  })
})
