import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  runLegacyThenRedesign,
  signIn,
} from './helpers.js'

// Reuses the single second QA identity run-staging.sh seeds as an org member
// (for phase5-team-permissions-matrix.spec.js) -- it is not yet assigned to
// this event. Since only one such identity exists, the legacy and redesign
// phases assign it sequentially (unassigning in between), matching the
// serial single-worker model this suite already runs under. Event-role and
// granular-permission comparisons are deferred to the Milestone 3 permission
// matrix work, which needs this same reuse pattern anyway and is a better
// place to do it carefully.

test.describe.configure({ mode: 'serial' })

function assignContract(member) {
  return { user_id: member.user.id }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test.describe('Phase 9 team parity', () => {
  test('member assignment persists the same contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const secondEmail = requiredEnv('E2E_SECOND_EMAIL')
    await signIn(page)
    const headers = await authHeaders(page)

    async function secondIdentityUserId() {
      const orgMembers = await (await request.get(`/api/events/${eventId}/org-members`, { headers })).json()
      const user = orgMembers.map((om) => om.user).find((u) => u.email === secondEmail)
      expect(user, `${secondEmail} should be a discoverable org member`).toBeTruthy()
      return user.id
    }

    async function unassignSecondIdentity() {
      const userId = await secondIdentityUserId()
      await request.delete(`/api/events/${eventId}/members/${userId}`, { headers })
    }

    await unassignSecondIdentity()

    try {
      async function assignSecondIdentity(page, { legacy }) {
        const userId = await secondIdentityUserId()
        if (legacy) {
          await page.getByRole('button', { name: /Team/ }).click()
          const select = page.locator('select').filter({ has: page.getByText('assign a teammate', { exact: false }) })
          await select.selectOption({ value: userId })
          const response = page.waitForResponse((r) =>
            r.request().method() === 'POST' && r.url().endsWith(`/api/events/${eventId}/members`))
          await page.getByRole('button', { name: 'Assign', exact: true }).click()
          return (await response).json()
        }

        await unassignSecondIdentity()
        await page.goto('/team-redesign?tab=team')
        await expectQaEventLoaded(page)
        await page.getByRole('button', { name: 'Add teammate', exact: false }).click()
        const select = page.locator('select').filter({ has: page.getByText('Choose a teammate', { exact: false }) })
        await select.selectOption({ value: userId })
        const response = page.waitForResponse((r) =>
          r.request().method() === 'POST' && r.url().endsWith(`/api/events/${eventId}/members`))
        await page.getByRole('button', { name: 'Assign to event', exact: true }).click()
        return (await response).json()
      }

      const [legacyAssigned, redesignAssigned] = await runLegacyThenRedesign(page, {
        legacyPath: '/admin',
        redesignPath: '/team-redesign?tab=team',
        action: assignSecondIdentity,
      })

      expect(assignContract(legacyAssigned).user_id).toBe(assignContract(redesignAssigned).user_id)
      expect(legacyAssigned.user.email).toBe(secondEmail)
      expect(redesignAssigned.user.email).toBe(secondEmail)
      expect(redesignAssigned.event_role).toBe(legacyAssigned.event_role)
    } finally {
      await unassignSecondIdentity()
    }
  })
})
