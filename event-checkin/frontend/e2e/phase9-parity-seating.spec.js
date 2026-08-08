import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  runLegacyThenRedesign,
  signIn,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

function seatContract(guest) {
  return { table_id: guest.table_id, seat_number: guest.seat_number }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

async function makeFixture(request, headers, eventId, name) {
  const table = await (await request.post(`/api/events/${eventId}/tables`, {
    headers, data: { name: `ParitySeat-${name}`, capacity: 2 },
  })).json()
  const guest = await (await request.post(`/api/events/${eventId}/guests`, {
    headers, data: { first_name: `ParitySeatGuest-${name}`, last_name: 'Synthetic' },
  })).json()
  return { table, guest }
}

async function removeFixture(request, headers, eventId, fixture) {
  await request.delete(`/api/events/${eventId}/guests/${fixture.guest.id}`, { headers })
  await request.delete(`/api/events/${eventId}/tables/${fixture.table.id}`, { headers })
}

test.describe('Phase 9 seating parity', () => {
  test('seat assignment persists the same contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    const legacyFixture = await makeFixture(request, headers, eventId, `Legacy${run}`)
    const redesignFixture = await makeFixture(request, headers, eventId, `Redesign${run}`)

    try {
      async function assignSeat(page, { legacy }) {
        const fixture = legacy ? legacyFixture : redesignFixture
        const guestName = `${fixture.guest.first_name} ${fixture.guest.last_name}`
        if (legacy) {
          await page.getByRole('button', { name: /Seating/ }).click()
          await page.getByRole('button', { name: /Show Seating Chart/ }).click()
          const card = page.getByText(fixture.table.name, { exact: true })
            .locator('xpath=ancestor::div[contains(@class,"overflow-hidden")]').last()
          await card.getByRole('button', { name: '+ reserve' }).first().click()
          await page.getByPlaceholder('Search by name or email…').fill(guestName)
          const response = page.waitForResponse((r) =>
            r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/guests/${fixture.guest.id}/seat`))
          await page.getByRole('button', { name: guestName, exact: false }).click()
          return (await response).json()
        }
        await page.goto('/addons-redesign?tab=seating')
        await expectQaEventLoaded(page)
        await page.getByRole('button', { name: 'Show Seating Chart', exact: false }).click()
        const card = page.locator('.ad-chart-card').filter({ hasText: fixture.table.name })
        await card.locator('.ad-chart-seat.empty').first().click()
        await page.getByPlaceholder('Search by name or email…').fill(guestName)
        const response = page.waitForResponse((r) =>
          r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/guests/${fixture.guest.id}/seat`))
        await page.getByRole('button', { name: guestName, exact: false }).click()
        return (await response).json()
      }

      const [legacyAssigned, redesignAssigned] = await runLegacyThenRedesign(page, {
        legacyPath: '/admin',
        redesignPath: '/addons-redesign?tab=seating',
        action: assignSeat,
      })

      expect(seatContract(legacyAssigned)).toEqual({ table_id: legacyFixture.table.id, seat_number: '1' })
      expect(seatContract(redesignAssigned)).toEqual({ table_id: redesignFixture.table.id, seat_number: '1' })
    } finally {
      await removeFixture(request, headers, eventId, legacyFixture)
      await removeFixture(request, headers, eventId, redesignFixture)
    }
  })

  test('seat unassignment persists the same contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    const legacyFixture = await makeFixture(request, headers, eventId, `LegacyUn${run}`)
    const redesignFixture = await makeFixture(request, headers, eventId, `RedesignUn${run}`)
    // Pre-assign via the same API contract the UI itself uses, so this test
    // isolates the unassignment step rather than re-deriving assignment.
    await request.patch(`/api/events/${eventId}/guests/${legacyFixture.guest.id}/seat`, {
      headers, data: { table_id: legacyFixture.table.id, seat_number: '1' },
    })
    await request.patch(`/api/events/${eventId}/guests/${redesignFixture.guest.id}/seat`, {
      headers, data: { table_id: redesignFixture.table.id, seat_number: '1' },
    })

    try {
      async function unassignSeat(page, { legacy }) {
        const fixture = legacy ? legacyFixture : redesignFixture
        const guestName = `${fixture.guest.first_name} ${fixture.guest.last_name}`
        if (legacy) {
          await page.getByRole('button', { name: /Seating/ }).click()
          await page.getByRole('button', { name: /Show Seating Chart/ }).click()
          page.once('dialog', (dialog) => dialog.accept())
          const response = page.waitForResponse((r) =>
            r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/guests/${fixture.guest.id}/seat`))
          await page.getByRole('button', { name: guestName, exact: false }).click()
          return (await response).json()
        }
        await page.goto('/addons-redesign?tab=seating')
        await expectQaEventLoaded(page)
        await page.getByRole('button', { name: 'Show Seating Chart', exact: false }).click()
        const card = page.locator('.ad-chart-card').filter({ hasText: fixture.table.name })
        const response = page.waitForResponse((r) =>
          r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/guests/${fixture.guest.id}/seat`))
        await card.locator('.ad-chart-seat.filled').filter({ hasText: guestName }).click()
        await page.locator('.rr-modal').getByRole('button', { name: 'Unassign', exact: true }).click()
        return (await response).json()
      }

      const [legacyUnassigned, redesignUnassigned] = await runLegacyThenRedesign(page, {
        legacyPath: '/admin',
        redesignPath: '/addons-redesign?tab=seating',
        action: unassignSeat,
      })

      expect(seatContract(legacyUnassigned)).toEqual({ table_id: null, seat_number: null })
      expect(seatContract(redesignUnassigned)).toEqual({ table_id: null, seat_number: null })
    } finally {
      await removeFixture(request, headers, eventId, legacyFixture)
      await removeFixture(request, headers, eventId, redesignFixture)
    }
  })
})
