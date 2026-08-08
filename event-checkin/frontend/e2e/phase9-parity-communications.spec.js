import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  runLegacyThenRedesign,
  signIn,
  withCleanup,
} from './helpers.js'

// Scoped to the "send unsent invitations" workflow (both legacy and redesign
// ultimately post to the same /guests/send-batch endpoint -- see
// backend/app/routers/guests.py:2091). Resend-to-all and broadcast are
// deferred: legacy resend-all routes through a native window.confirm() with
// a different redesign counterpart, and broadcast parity would inherit the
// pre-existing flaky "Send broadcast" button interaction already tracked in
// stage-c-communications-provider-safety.spec.js's known baseline failure.
// Real sends are never allowed to reach a provider -- every request is
// intercepted and fulfilled locally, matching stage-c-guests-outbound.spec.js.

test.describe.configure({ mode: 'serial' })

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

// The backend treats guest_ids=null and guest_ids=[] identically ("all
// unsent" -- `body.get("guest_ids") or []`), but the two frontends encode an
// omitted selection differently on the wire. Normalize before comparing so
// the test asserts effective-request parity, not incidental JSON shape.
function sendBatchContract(body) {
  return { guest_ids: body.guest_ids || [], force: !!body.force }
}

test.describe('Phase 9 communications parity', () => {
  test('sending unsent invitations submits the same effective request', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    await withCleanup(
      (id) => request.delete(`/api/events/${eventId}/guests/${id}`, { headers }),
      async (createdIds) => {
        const guestResponse = await request.post(`/api/events/${eventId}/guests`, {
          headers,
          data: { first_name: `ParityInvite-${run}`, last_name: 'Synthetic', email: `parity-invite-${run}@example.test` },
        })
        expect(guestResponse.ok()).toBeTruthy()
        const guest = await guestResponse.json()
        createdIds.push(guest.id)

        async function sendUnsent(page, { legacy }) {
          let body
          await page.route('**/api/events/*/guests/send-batch', async (route) => {
            body = await route.request().postDataJSON()
            await route.fulfill({ json: { queued: 1, force: false, scope: 'all' } })
          })
          if (legacy) {
            await page.getByRole('button', { name: /Guests/ }).click()
            await page.getByRole('button', { name: /Send invitations \(\d+\)/ }).click()
          } else {
            await page.goto('/guests-redesign?tab=invite')
            await expectQaEventLoaded(page)
            await page.getByText('Send first invitations', { exact: true }).click()
            await page.getByRole('button', { name: /Send to .* guests/ }).click()
          }
          await expect.poll(() => body, { message: 'send-batch request should have been captured' }).toBeTruthy()
          await page.unroute('**/api/events/*/guests/send-batch')
          return body
        }

        const [legacyBody, redesignBody] = await runLegacyThenRedesign(page, {
          legacyPath: '/admin',
          redesignPath: '/guests-redesign?tab=invite',
          action: sendUnsent,
        })

        expect(sendBatchContract(redesignBody)).toEqual(sendBatchContract(legacyBody))
        expect(sendBatchContract(legacyBody)).toEqual({ guest_ids: [], force: false })
      },
    )
  })
})

function suffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}
