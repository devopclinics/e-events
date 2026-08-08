import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, firebaseAccessToken, requiredEnv, signIn } from './helpers.js'

// Real mobile-viewport interaction coverage (tap/fill/submit), not just the
// layout-overflow checks stage-b-readiness.spec.js and phase7-self-checkin.spec.js
// already do. Runs under playwright.config.js's mobile-chromium project (Pixel 7).
// Reuses fixtures/techniques already built for the Milestone 2 checkin and RSVP
// parity specs rather than duplicating setup.

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test('check-in scan via manual token entry works on a mobile viewport @mobile', async ({ page, request }) => {
  const eventId = requiredEnv('E2E_EVENT_ID')
  const run = suffix()
  await signIn(page)
  const headers = await authHeaders(page)

  const zoneResponse = await request.post(`/api/events/${eventId}/zones`, {
    headers, data: { name: `MobileZone-${run}`, direction_mode: 'both', capacity: 50 },
  })
  expect(zoneResponse.ok()).toBeTruthy()
  const zone = await zoneResponse.json()
  const guestResponse = await request.post(`/api/events/${eventId}/guests`, {
    headers, data: { first_name: `MobileScan-${run}`, last_name: 'Synthetic' },
  })
  expect(guestResponse.ok()).toBeTruthy()
  const guest = await guestResponse.json()

  try {
    await page.goto('/scanner-redesign')
    await expectQaEventLoaded(page)
    const zoneSelect = page.getByRole('combobox', { name: 'Zone' })
    await zoneSelect.selectOption({ value: zone.id })
    const response = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().endsWith(`/api/scan/${guest.qr_token}/zone`))
    await page.getByRole('textbox', { name: 'Pass token' }).tap()
    await page.getByRole('textbox', { name: 'Pass token' }).fill(guest.qr_token)
    await page.getByRole('button', { name: 'Record scan' }).tap()
    const result = await (await response).json()
    expect(result.status).toBe('ok')
    await expect(page.getByTestId('scan-result')).toContainText(guest.first_name)
  } finally {
    await request.delete(`/api/events/${eventId}/guests/${guest.id}`, { headers })
    await request.delete(`/api/events/${eventId}/zones/${zone.id}`, { headers })
  }
})

test('guest RSVP submission via the public link works on a mobile viewport @mobile', async ({ page, request }) => {
  const eventId = requiredEnv('E2E_EVENT_ID')
  const run = suffix()
  await signIn(page)
  const headers = await authHeaders(page)

  const original = await (await request.get('/api/events', { headers })).json()
  const originalEvent = original.find((e) => e.id === eventId)
  const settingsResponse = await request.put(`/api/events/${eventId}/invite-settings`, {
    headers, data: { rsvp_enabled: true, invite_mode: 'open', rsvp_require_approval: false },
  })
  expect(settingsResponse.ok()).toBeTruthy()
  const rsvpToken = (await settingsResponse.json()).rsvp_token

  const firstName = `MobileRsvp${run}`
  let createdGuestId

  try {
    await page.goto(`/rsvp/${rsvpToken}`)
    await expect(page.getByRole('heading', { name: 'Will you be attending?' })).toBeVisible()
    await page.getByText("Yes, I'll be there", { exact: false }).tap()
    await page.getByPlaceholder('Jane', { exact: true }).fill(firstName)
    await page.getByPlaceholder('Smith', { exact: true }).fill('Synthetic')
    await page.getByPlaceholder('jane@example.com', { exact: true }).fill(`${firstName.toLowerCase()}@example.com`)
    const response = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes(`/api/invite/link/${rsvpToken}/rsvp`))
    await page.locator('#rsvp').getByRole('button', { name: 'Confirm My RSVP', exact: true }).tap()
    const created = await (await response).json()
    createdGuestId = created.guest?.id || created.id

    const guests = await (await request.get(`/api/events/${eventId}/guests`, { headers })).json()
    const persisted = guests.find((g) => g.first_name === firstName)
    expect(persisted, 'the mobile RSVP submission should have created a real guest record').toBeTruthy()
    expect(persisted.rsvp_status).toBe('confirmed')
    createdGuestId = persisted.id
  } finally {
    if (createdGuestId) await request.delete(`/api/events/${eventId}/guests/${createdGuestId}`, { headers })
    await request.put(`/api/events/${eventId}/invite-settings`, {
      headers,
      data: {
        rsvp_enabled: originalEvent.rsvp_enabled,
        invite_mode: originalEvent.invite_mode,
        rsvp_require_approval: originalEvent.rsvp_require_approval,
      },
    })
  }
})

test('self check-in search-and-confirm flow works on a mobile viewport @mobile', async ({ page }) => {
  // Mocked routes, matching the established pattern for this public,
  // unauthenticated page (see phase7-self-checkin.spec.js) -- the page's own
  // correctness doesn't depend on live backend state, only on how it renders
  // and reacts to the same contract shapes the real API returns.
  let admissionCount = 0
  await page.route('**/api/e/MOBILEQA', (route) => route.fulfill({ json: { status: 'ok', name: 'Mobile QA Event' } }))
  await page.route('**/api/e/MOBILEQA/search', (route) => route.fulfill({
    json: { status: 'ok', guests: [{ id: 'synthetic-mobile-guest', name: 'Synthetic Mobile Guest' }] },
  }))
  await page.route('**/api/e/MOBILEQA/checkin/synthetic-mobile-guest', (route) => {
    admissionCount += 1
    return route.fulfill({ json: { status: 'admitted', message: 'Synthetic Mobile Guest admitted.', admitted_guest: 'Synthetic Mobile Guest' } })
  })

  await page.goto('/selfcheckin-redesign?code=MOBILEQA')
  await expect(page.getByRole('heading', { name: 'Mobile QA Event' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Name or phone' }).tap()
  await page.getByRole('textbox', { name: 'Name or phone' }).fill('Synthetic')
  await page.getByRole('button', { name: 'Search' }).tap()
  await page.getByRole('button', { name: /Synthetic Mobile Guest/ }).tap()
  await page.getByRole('button', { name: "Yes, that's me" }).tap()
  await expect(page.getByRole('status')).toContainText('Synthetic Mobile Guest admitted')
  expect(admissionCount).toBe(1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
