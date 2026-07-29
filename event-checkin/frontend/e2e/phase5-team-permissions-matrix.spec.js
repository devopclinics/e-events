import { test, expect } from '@playwright/test'
import { requiredEnv, signIn, signInAs } from './helpers.js'

// Team permissions matrix — deferred earlier this session because the isolated
// QA org had zero non-owner members, so there was no fixture to test per-member
// permission toggles against. run-staging.sh now bootstraps a second throwaway
// identity (org role "staff", no event assignment) alongside the primary owner
// specifically for this. Verifies require_guest_manage_access's real
// enforcement: an assigned member without EventUser.can_manage_guests is
// rejected (403) from guest mutations, and the exact same request succeeds
// once the owner grants it through the real permissions endpoint.
test.describe('Phase 5 team permissions matrix — isolated staging fixture', () => {
  test('a staff member without can_manage_guests is blocked from guest mutations, and unblocked once granted', async ({ page, browser }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const secondEmail = requiredEnv('E2E_SECOND_EMAIL')
    const secondPassword = requiredEnv('E2E_SECOND_PASSWORD')

    let ownerAuth = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) ownerAuth = request.headers().authorization
    })
    await signIn(page)
    expect(ownerAuth).toMatch(/^Bearer /)

    const secondContext = await browser.newContext()
    const secondPage = await secondContext.newPage()
    let secondAuth = ''
    secondPage.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) secondAuth = request.headers().authorization
    })

    try {
      await signInAs(secondPage, secondEmail, secondPassword, eventId)
      expect(secondAuth).toMatch(/^Bearer /)
      const secondMe = await (await secondPage.request.get('/api/auth/me', { headers: { Authorization: secondAuth } })).json()

      const assign = await page.request.post(`/api/events/${eventId}/members`, {
        headers: { Authorization: ownerAuth }, data: { user_id: secondMe.id },
      })
      expect(assign.ok(), 'owner must be able to assign the second identity to the event').toBeTruthy()

      try {
        const blocked = await secondPage.request.post(`/api/events/${eventId}/guests`, {
          headers: { Authorization: secondAuth },
          data: { first_name: 'Matrix', last_name: 'Blocked' },
        })
        expect(blocked.status()).toBe(403)
        expect((await blocked.json()).detail).toMatch(/manage guests/i)

        const grant = await page.request.patch(`/api/events/${eventId}/members/${secondMe.id}/permissions`, {
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
      } finally {
        await page.request.delete(`/api/events/${eventId}/members/${secondMe.id}`, { headers: { Authorization: ownerAuth } })
      }
    } finally {
      await secondContext.close()
    }
  })
})
