import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, requiredEnv, signIn, signInAs } from './helpers.js'

// Team permissions matrix — deferred earlier this session because the isolated
// QA org had zero non-owner members, so there was no fixture to test per-member
// permission toggles against. run-staging.sh now bootstraps a second throwaway
// identity (org role "staff", no event assignment) alongside the primary owner
// specifically for this. Verifies each EventUser-level permission flag's real
// backend enforcement, not just its stored value: an assigned member without
// the flag is rejected (403) from the guarded endpoint, and the exact same
// request succeeds once the owner grants it through the real permissions
// endpoint. Originally covered only can_manage_guests; extended to the other
// four independent flags (Event_users has five total, plus event_role/
// access_level which are a separate axis, not covered here).

test.describe.configure({ mode: 'serial' })

test.describe('Phase 5 team permissions matrix — isolated staging fixture', () => {
  let eventId
  let ownerAuth = ''
  let secondPage
  let secondContext
  let secondAuth = ''
  let secondUserId

  test.beforeEach(async ({ page, browser }) => {
    eventId = requiredEnv('E2E_EVENT_ID')
    const secondEmail = requiredEnv('E2E_SECOND_EMAIL')
    const secondPassword = requiredEnv('E2E_SECOND_PASSWORD')

    ownerAuth = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) ownerAuth = request.headers().authorization
    })
    await signIn(page)
    expect(ownerAuth).toMatch(/^Bearer /)

    secondContext = await browser.newContext()
    secondPage = await secondContext.newPage()
    secondAuth = ''
    secondPage.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) secondAuth = request.headers().authorization
    })
    await signInAs(secondPage, secondEmail, secondPassword, eventId)
    expect(secondAuth).toMatch(/^Bearer /)
    const secondMe = await (await secondPage.request.get('/api/auth/me', { headers: { Authorization: secondAuth } })).json()
    secondUserId = secondMe.id

    const assign = await page.request.post(`/api/events/${eventId}/members`, {
      headers: { Authorization: ownerAuth }, data: { user_id: secondUserId },
    })
    expect(assign.ok(), 'owner must be able to assign the second identity to the event').toBeTruthy()
  })

  test.afterEach(async ({ page }) => {
    await page.request.delete(`/api/events/${eventId}/members/${secondUserId}`, { headers: { Authorization: ownerAuth } }).catch(() => {})
    await secondContext.close()
  })

  test('a staff member without can_manage_guests is blocked from guest mutations, and unblocked once granted', async ({ page }) => {
    const blocked = await secondPage.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: secondAuth },
      data: { first_name: 'Matrix', last_name: 'Blocked' },
    })
    expect(blocked.status()).toBe(403)
    expect((await blocked.json()).detail).toMatch(/manage guests/i)

    const grant = await page.request.patch(`/api/events/${eventId}/members/${secondUserId}/permissions`, {
      headers: { Authorization: ownerAuth }, data: { can_manage_guests: true },
    })
    expect(grant.ok()).toBeTruthy()

    const allowed = await secondPage.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: secondAuth },
      data: { first_name: 'Matrix', last_name: 'Allowed' },
    })
    expect(allowed.ok(), 'the exact same request must succeed once can_manage_guests is granted').toBeTruthy()
    const createdGuest = await allowed.json()
    await page.request.delete(`/api/events/${eventId}/guests/${createdGuest.id}`, { headers: { Authorization: ownerAuth } })
  })

  test('a staff member without can_view_guests is blocked from reading the guest list, and unblocked once granted', async ({ page }) => {
    const blocked = await secondPage.request.get(`/api/events/${eventId}/guests`, { headers: { Authorization: secondAuth } })
    expect(blocked.status()).toBe(403)

    const grant = await page.request.patch(`/api/events/${eventId}/members/${secondUserId}/permissions`, {
      headers: { Authorization: ownerAuth }, data: { can_view_guests: true },
    })
    expect(grant.ok()).toBeTruthy()

    const allowed = await secondPage.request.get(`/api/events/${eventId}/guests`, { headers: { Authorization: secondAuth } })
    expect(allowed.ok(), 'the exact same request must succeed once can_view_guests is granted').toBeTruthy()
  })

  test('a staff member without can_view_dashboard is blocked from the event dashboard, and unblocked once granted', async ({ page }) => {
    const blocked = await secondPage.request.get(`/api/events/${eventId}/dashboard`, { headers: { Authorization: secondAuth } })
    expect(blocked.status()).toBe(403)

    const grant = await page.request.patch(`/api/events/${eventId}/members/${secondUserId}/permissions`, {
      headers: { Authorization: ownerAuth }, data: { can_view_dashboard: true },
    })
    expect(grant.ok()).toBeTruthy()

    const allowed = await secondPage.request.get(`/api/events/${eventId}/dashboard`, { headers: { Authorization: secondAuth } })
    expect(allowed.ok(), 'the exact same request must succeed once can_view_dashboard is granted').toBeTruthy()
  })

  test('a staff member without can_manage_menu is blocked from creating a menu category, and unblocked once granted', async ({ page }) => {
    const blocked = await secondPage.request.post(`/api/events/${eventId}/menu-categories`, {
      headers: { Authorization: secondAuth },
      data: { name: 'Matrix Blocked Category' },
    })
    expect(blocked.status()).toBe(403)

    const grant = await page.request.patch(`/api/events/${eventId}/members/${secondUserId}/permissions`, {
      headers: { Authorization: ownerAuth }, data: { can_manage_menu: true },
    })
    expect(grant.ok()).toBeTruthy()

    const allowed = await secondPage.request.post(`/api/events/${eventId}/menu-categories`, {
      headers: { Authorization: secondAuth },
      data: { name: 'Matrix Allowed Category' },
    })
    expect(allowed.ok(), 'the exact same request must succeed once can_manage_menu is granted').toBeTruthy()
    const createdCategory = await allowed.json()
    await page.request.delete(`/api/events/${eventId}/menu-categories/${createdCategory.id}`, { headers: { Authorization: ownerAuth } })
  })

  test('a staff member without can_reassign_seats is blocked from assigning a guest seat, and unblocked once granted', async ({ page }) => {
    const guestResponse = await page.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: ownerAuth },
      data: { first_name: 'Matrix', last_name: 'SeatFixture' },
    })
    expect(guestResponse.ok()).toBeTruthy()
    const guest = await guestResponse.json()
    const tableResponse = await page.request.post(`/api/events/${eventId}/tables`, {
      headers: { Authorization: ownerAuth },
      data: { name: 'Matrix Seat Table', capacity: 2 },
    })
    expect(tableResponse.ok()).toBeTruthy()
    const table = await tableResponse.json()

    try {
      const blocked = await secondPage.request.patch(`/api/events/${eventId}/guests/${guest.id}/seat`, {
        headers: { Authorization: secondAuth },
        data: { table_id: table.id, seat_number: '1' },
      })
      expect(blocked.status()).toBe(403)

      const grant = await page.request.patch(`/api/events/${eventId}/members/${secondUserId}/permissions`, {
        headers: { Authorization: ownerAuth }, data: { can_reassign_seats: true },
      })
      expect(grant.ok()).toBeTruthy()

      const allowed = await secondPage.request.patch(`/api/events/${eventId}/guests/${guest.id}/seat`, {
        headers: { Authorization: secondAuth },
        data: { table_id: table.id, seat_number: '1' },
      })
      expect(allowed.ok(), 'the exact same request must succeed once can_reassign_seats is granted').toBeTruthy()
    } finally {
      await page.request.delete(`/api/events/${eventId}/guests/${guest.id}`, { headers: { Authorization: ownerAuth } })
      await page.request.delete(`/api/events/${eventId}/tables/${table.id}`, { headers: { Authorization: ownerAuth } })
    }
  })

  // The five tests above verify the backend guard directly. This one drives
  // the actual grant through TeamRedesignPage.jsx's UI instead of a raw API
  // call, so a UI regression that silently no-ops the permission toggle (the
  // kind of bug Phase 9 exists to catch) would fail here even though the
  // backend enforcement itself is sound.
  test('granting can_manage_guests through the redesign UI produces the same real unblock as the direct API grant', async ({ page }) => {
    const blocked = await secondPage.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: secondAuth },
      data: { first_name: 'Matrix', last_name: 'UiBlocked' },
    })
    expect(blocked.status()).toBe(403)

    await page.goto('/team-redesign?tab=team')
    await expectQaEventLoaded(page)
    const card = page.locator('.tm-member-card').filter({ hasText: 'redesign-e2e-2nd-' })
    await card.getByRole('button', { name: 'Edit access', exact: true }).click()
    const guestAccessSelect = page.locator('.tm-member-editor select')
      .filter({ has: page.getByRole('option', { name: 'Manage guests' }) })
    const permResponse = page.waitForResponse((r) =>
      r.request().method() === 'PATCH' && r.url().endsWith(`/api/events/${eventId}/members/${secondUserId}/permissions`))
    await guestAccessSelect.selectOption('manage')
    expect((await (await permResponse).json()).ok).toBe(true)
    const members = await (await page.request.get(`/api/events/${eventId}/members`, { headers: { Authorization: ownerAuth } })).json()
    expect(members.find((m) => m.user.id === secondUserId)?.can_manage_guests).toBe(true)

    const allowed = await secondPage.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: secondAuth },
      data: { first_name: 'Matrix', last_name: 'UiAllowed' },
    })
    expect(allowed.ok(), 'the exact same request must succeed once the redesign UI grants can_manage_guests').toBeTruthy()
    const createdGuest = await allowed.json()
    await page.request.delete(`/api/events/${eventId}/guests/${createdGuest.id}`, { headers: { Authorization: ownerAuth } })
  })
})
