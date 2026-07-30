import { chromium, test, expect } from '@playwright/test'
import { requiredEnv, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

async function firebaseAccessToken(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('firebaseLocalStorageDb')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const auth = rows.find((row) => row?.value?.stsTokenManager?.accessToken)
    return auth?.value?.stsTokenManager?.accessToken || ''
  })
}

test.describe('Stage C check-in — isolated staging fixture', () => {
  test('server-confirmed admission, duplicate, invalid scan, and cleanup', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const guestName = `E2E-Checkin-${suffix}`
    let guest
    let accessZone

    await signIn(page)
    const token = await firebaseAccessToken(page)
    expect(token, 'Firebase browser session must expose an access token').toBeTruthy()
    const headers = { Authorization: `Bearer ${token}` }

    const eventsResponse = await request.get('/api/events', { headers })
    expect(eventsResponse.ok()).toBeTruthy()
    const event = (await eventsResponse.json()).find((item) => item.id === eventId)
    expect(event?.name).toBe('Redesign QA Test Event')

    try {
      const createResponse = await request.post(`/api/events/${eventId}/guests`, {
        headers,
        data: { first_name: guestName, last_name: 'Synthetic', phone: null },
      })
      expect(createResponse.ok()).toBeTruthy()
      guest = await createResponse.json()
      expect(guest.qr_token).toBeTruthy()

      if (event.status !== 'active') {
        const activateResponse = await request.patch(`/api/events/${eventId}/status`, {
          headers,
          data: { status: 'active' },
        })
        expect(activateResponse.ok()).toBeTruthy()
      }
      if (event.venue_access_enabled) {
        const zoneResponse = await request.post(`/api/events/${eventId}/zones`, {
          headers,
          data: { name: `E2E Zone ${suffix}`, direction_mode: 'both', capacity: 20 },
        })
        expect(zoneResponse.ok()).toBeTruthy()
        accessZone = await zoneResponse.json()
      }

      await page.goto('/scanner-redesign')
      const gateSelect = page.getByRole('combobox', { name: 'Gate' })
      const zoneSelect = page.getByRole('combobox', { name: 'Zone' })
      async function selectAccessTarget() {
        if (!event.venue_access_enabled) return
        await expect(gateSelect.or(zoneSelect).first()).toBeVisible()
        if (await gateSelect.count()) await gateSelect.selectOption({ index: 1 })
        else await zoneSelect.selectOption({ index: 1 })
      }
      await selectAccessTarget()
      const startCamera = page.getByRole('button', { name: 'Start camera' })
      await expect(startCamera).toBeVisible()
      expect(await startCamera.evaluate((button) => {
        const box = button.getBoundingClientRect()
        return document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        ) === button
      }), 'The decorative scanner frame must not intercept camera-button clicks.').toBe(true)
      await page.getByRole('textbox', { name: 'Pass token' }).fill(guest.qr_token)
      await page.getByRole('button', { name: 'Record scan' }).click()
      await expect(page.getByTestId('scan-result')).toContainText(event.venue_access_enabled ? /allowed|admitted|in ·/i : /admitted/i)
      await expect(page.getByTestId('scan-result')).toContainText(guestName)

      await selectAccessTarget()
      await page.getByRole('textbox', { name: 'Pass token' }).fill(guest.qr_token)
      await page.getByRole('button', { name: 'Record scan' }).click()
      await expect(page.getByTestId('scan-result')).toContainText(event.venue_access_enabled ? /allowed|in ·/i : /already admitted/i)

      await selectAccessTarget()
      await page.getByRole('textbox', { name: 'Pass token' }).fill(`invalid-${suffix}`)
      await page.getByRole('button', { name: 'Record scan' }).click()
      await expect(page.getByTestId('scan-result')).toContainText(/invalid|not found|could not/i)

      if (event.manual_checkin_enabled) {
        await page.getByRole('button', { name: 'Manual search' }).click()
        await page.getByPlaceholder('Search by name or phone…').fill(guestName)
        await expect(page.getByText(`${guestName} Synthetic`, { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Review' }).click()
        await expect(page.getByTestId('scan-result')).toContainText(/already admitted/i)
      }
    } finally {
      if (guest?.id) {
        const removeResponse = await request.delete(`/api/events/${eventId}/guests/${guest.id}`, { headers })
        expect([200, 204, 404]).toContain(removeResponse.status())
      }
      if (accessZone?.id) {
        const removeZoneResponse = await request.delete(`/api/events/${eventId}/zones/${accessZone.id}`, { headers })
        expect([200, 204, 404]).toContain(removeZoneResponse.status())
      }
      if (event?.status && event.status !== 'active') {
        const restoreResponse = await request.patch(`/api/events/${eventId}/status`, {
          headers,
          data: { status: event.status },
        })
        expect(restoreResponse.ok()).toBeTruthy()
      }
    }
  })

  test('manual check-in fixture gate is explicit', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await signIn(page)
    const headers = { Authorization: `Bearer ${await firebaseAccessToken(page)}` }
    const response = await request.get('/api/events', { headers })
    const event = (await response.json()).find((item) => item.id === eventId)
    test.skip(!event?.manual_checkin_enabled, 'Enable manual_checkin_enabled on the isolated QA event with the superadmin fixture before running manual mutation coverage.')

    await page.goto('/scanner-redesign')
    await page.getByRole('button', { name: 'Manual search' }).click()
    await expect(page.getByPlaceholder('Search by name or phone…')).toBeVisible()
  })

  test('camera control starts a browser media stream', async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    })
    const context = await browser.newContext({ permissions: ['camera'] })
    const page = await context.newPage()
    try {
      await signIn(page)
      await page.goto('/scanner-redesign')
      const startCamera = page.getByRole('button', { name: 'Start camera' })
      await expect(startCamera).toBeVisible()
      if (!(await startCamera.isEnabled())) {
        const accessTarget = page.locator('select[aria-label="Gate"], select[aria-label="Zone"]').first()
        await expect(accessTarget).toBeVisible()
        await accessTarget.selectOption({ index: 1 })
      }
      await expect(startCamera).toBeEnabled()
      await startCamera.click()
      await expect(page.locator('.sc-camera-reader video')).toBeVisible({ timeout: 20_000 })
    } finally {
      await browser.close()
    }
  })
})
