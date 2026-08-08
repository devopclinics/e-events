import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  runLegacyThenRedesign,
  signIn,
  withCleanup,
} from './helpers.js'

// The isolated QA fixture event has venue_access_enabled=true, so the
// standard QR-scan path (legacy /scanner and redesign /scanner-redesign)
// routes through the zone-scan contract (ScanZoneResult), not the simpler
// admitted/already_admitted contract. Manual check-in is a separate backend
// path (guests/{id}/checkin) that is NOT zone-aware and always returns the
// simple admitted/already_admitted contract regardless of venue_access_enabled
// -- see backend/app/routers/scanner.py. Both paths are covered below.

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

function zoneScanContract(result) {
  return {
    status: result.status,
    denied: !!result.denied,
    direction: result.direction,
  }
}

function admissionContract(result) {
  return {
    status: result.status,
    admitted: !!result.guest?.admitted,
  }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test.describe('Phase 9 check-in parity', () => {
  test('zone-based QR scan produces the same persisted contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    const eventResponse = await request.get('/api/events', { headers })
    const event = (await eventResponse.json()).find((item) => item.id === eventId)
    expect(event).toBeTruthy()
    let restoreStatus = null
    if (event.status !== 'active') {
      restoreStatus = event.status
      const activate = await request.patch(`/api/events/${eventId}/status`, { headers, data: { status: 'active' } })
      expect(activate.ok()).toBeTruthy()
    }

    const zoneResponse = await request.post(`/api/events/${eventId}/zones`, {
      headers,
      data: { name: `Parity Zone ${run}`, direction_mode: 'both', capacity: 50 },
    })
    expect(zoneResponse.ok()).toBeTruthy()
    const zone = await zoneResponse.json()

    try {
      await withCleanup(
        (id) => request.delete(`/api/events/${eventId}/guests/${id}`, { headers }),
        async (createdIds) => {
          const legacyGuestResponse = await request.post(`/api/events/${eventId}/guests`, {
            headers,
            data: { first_name: `ParityZone-Legacy-${run}`, last_name: 'Synthetic' },
          })
          expect(legacyGuestResponse.ok()).toBeTruthy()
          const legacyGuest = await legacyGuestResponse.json()
          createdIds.push(legacyGuest.id)

          const redesignGuestResponse = await request.post(`/api/events/${eventId}/guests`, {
            headers,
            data: { first_name: `ParityZone-Redesign-${run}`, last_name: 'Synthetic' },
          })
          expect(redesignGuestResponse.ok()).toBeTruthy()
          const redesignGuest = await redesignGuestResponse.json()
          createdIds.push(redesignGuest.id)

          async function scanValid(page, { legacy }) {
            const guestToken = legacy ? legacyGuest.qr_token : redesignGuest.qr_token
            if (legacy) {
              const zoneSelect = page.locator('label:text-is("Entry / exit area") + select')
              await zoneSelect.selectOption({ value: zone.id })
              const response = page.waitForResponse((r) =>
                r.request().method() === 'POST' && r.url().endsWith(`/api/scan/${guestToken}/zone`))
              await page.locator('input[name="token"]').fill(guestToken)
              await page.getByRole('button', { name: 'Check in', exact: true }).click()
              return (await response).json()
            }
            const zoneSelect = page.getByRole('combobox', { name: 'Zone' })
            await zoneSelect.selectOption({ value: zone.id })
            const response = page.waitForResponse((r) =>
              r.request().method() === 'POST' && r.url().endsWith(`/api/scan/${guestToken}/zone`))
            await page.getByRole('textbox', { name: 'Pass token' }).fill(guestToken)
            await page.getByRole('button', { name: 'Record scan' }).click()
            return (await response).json()
          }

          const [legacyResult, redesignResult] = await runLegacyThenRedesign(page, {
            legacyPath: '/scanner',
            redesignPath: '/scanner-redesign',
            action: scanValid,
          })

          expect(zoneScanContract(redesignResult)).toEqual(zoneScanContract(legacyResult))
          expect(legacyResult.status).toBe('ok')

          async function scanInvalid(page, { legacy }) {
            const invalidToken = `invalid-${run}-${legacy ? 'legacy' : 'redesign'}`
            if (legacy) {
              const zoneSelect = page.locator('label:text-is("Entry / exit area") + select')
              await zoneSelect.selectOption({ value: zone.id })
              const response = page.waitForResponse((r) =>
                r.request().method() === 'POST' && r.url().includes(`/api/scan/${invalidToken}/zone`))
              await page.locator('input[name="token"]').fill(invalidToken)
              await page.getByRole('button', { name: 'Check in', exact: true }).click()
              return (await response).status()
            }
            const zoneSelect = page.getByRole('combobox', { name: 'Zone' })
            await zoneSelect.selectOption({ value: zone.id })
            const response = page.waitForResponse((r) =>
              r.request().method() === 'POST' && r.url().includes(`/api/scan/${invalidToken}/zone`))
            await page.getByRole('textbox', { name: 'Pass token' }).fill(invalidToken)
            await page.getByRole('button', { name: 'Record scan' }).click()
            return (await response).status()
          }

          const [legacyInvalidStatus, redesignInvalidStatus] = await runLegacyThenRedesign(page, {
            legacyPath: '/scanner',
            redesignPath: '/scanner-redesign',
            action: scanInvalid,
          })
          expect(legacyInvalidStatus).toBe(404)
          expect(redesignInvalidStatus).toBe(404)
        },
      )
    } finally {
      await request.delete(`/api/events/${eventId}/zones/${zone.id}`, { headers })
      if (restoreStatus) {
        await request.patch(`/api/events/${eventId}/status`, { headers, data: { status: restoreStatus } })
      }
    }
  })

  test('manual check-in produces the same persisted admission contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    const eventResponse = await request.get('/api/events', { headers })
    const event = (await eventResponse.json()).find((item) => item.id === eventId)
    test.skip(!event?.manual_checkin_enabled, 'manual_checkin_enabled is off on the isolated QA event.')

    await withCleanup(
      (id) => request.delete(`/api/events/${eventId}/guests/${id}`, { headers }),
      async (createdIds) => {
        const legacyGuestResponse = await request.post(`/api/events/${eventId}/guests`, {
          headers,
          data: { first_name: `ParityManual-Legacy-${run}`, last_name: 'Synthetic' },
        })
        expect(legacyGuestResponse.ok()).toBeTruthy()
        const legacyGuest = await legacyGuestResponse.json()
        createdIds.push(legacyGuest.id)

        const redesignGuestResponse = await request.post(`/api/events/${eventId}/guests`, {
          headers,
          data: { first_name: `ParityManual-Redesign-${run}`, last_name: 'Synthetic' },
        })
        expect(redesignGuestResponse.ok()).toBeTruthy()
        const redesignGuest = await redesignGuestResponse.json()
        createdIds.push(redesignGuest.id)

        async function manualCheckin(page, { legacy }) {
          const guest = legacy ? legacyGuest : redesignGuest
          const fullName = `${guest.first_name} ${guest.last_name}`
          await page.getByRole('button', { name: 'Manual search', exact: true }).click()
          const search = legacy
            ? page.getByPlaceholder('Search name or phone…')
            : page.getByPlaceholder('Search by name or phone…')
          await search.fill(guest.first_name)
          const response = page.waitForResponse((r) =>
            r.request().method() === 'POST'
            && r.url().endsWith(`/api/events/${eventId}/guests/${guest.id}/checkin`))
          if (legacy) {
            await page.locator('button', { hasText: fullName }).first().click()
            await page.getByRole('button', { name: 'Confirm check-in', exact: true }).click()
          } else {
            await page.locator('.sc-guest-row', { hasText: fullName }).getByRole('button', { name: 'Check in', exact: true }).click()
          }
          return (await response).json()
        }

        const [legacyResult, redesignResult] = await runLegacyThenRedesign(page, {
          legacyPath: '/scanner',
          redesignPath: '/scanner-redesign',
          action: manualCheckin,
        })

        expect(admissionContract(redesignResult)).toEqual(admissionContract(legacyResult))
        expect(legacyResult.status).toBe('admitted')

        const persisted = await request.get(`/api/events/${eventId}/guests`, { headers })
        const rows = await persisted.json()
        expect(rows.find((g) => g.id === legacyGuest.id)?.admitted).toBe(true)
        expect(rows.find((g) => g.id === redesignGuest.id)?.admitted).toBe(true)
      },
    )
  })
})
