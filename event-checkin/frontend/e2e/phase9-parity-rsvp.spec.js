import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  requiredEnv,
  runLegacyThenRedesign,
  signIn,
  withCleanup,
} from './helpers.js'

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

function settingsContract(evt) {
  return { rsvp_capacity: Number(evt.rsvp_capacity) }
}

function questionContract(q) {
  return { question_type: q.question_type, is_required: !!q.is_required }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

test.describe('Phase 9 RSVP parity', () => {
  test('invitation settings save persists the same contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    const original = await (await request.get('/api/events', { headers })).json()
    const originalEvent = original.find((e) => e.id === eventId)
    const originalCapacity = originalEvent.rsvp_capacity
    const originalMessage = originalEvent.invite_message

    try {
      async function saveSettings(page, { legacy }) {
        const capacity = String(7000 + Number(run.slice(-3).replace(/\D/g, '') || 1) + (legacy ? 0 : 1))
        await page.getByRole('button', { name: 'Invites & RSVP' }).click()
        if (legacy) {
          await page.getByPlaceholder('e.g. 100').fill(capacity)
          await page.getByPlaceholder('Add a personal message to your guests…').fill(`Parity legacy ${run}`)
          const response = page.waitForResponse((r) =>
            r.request().method() === 'PUT' && r.url().endsWith(`/api/events/${eventId}/invite-settings`))
          await page.getByRole('button', { name: 'Save invitation page', exact: true }).click()
          return (await response).json()
        }
        const withRsvpCard = page.locator('.gr-mode-card').filter({ hasText: 'With RSVP' })
        if (!(await withRsvpCard.locator('input').isChecked())) await withRsvpCard.click()
        const panel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Invitation page' }) })
        await panel.locator('input[type="number"]').fill(capacity)
        await panel.locator('textarea').fill(`Parity redesign ${run}`)
        const response = page.waitForResponse((r) =>
          r.request().method() === 'PUT' && r.url().endsWith(`/api/events/${eventId}/invite-settings`))
        await page.getByRole('button', { name: 'Save invitation settings', exact: true }).click()
        return (await response).json()
      }

      const [legacySettings, redesignSettings] = await runLegacyThenRedesign(page, {
        legacyPath: '/admin',
        redesignPath: '/guests-redesign?tab=invite',
        action: saveSettings,
      })
      expect(settingsContract(redesignSettings).rsvp_capacity).not.toBeNaN()
      expect(settingsContract(legacySettings).rsvp_capacity).not.toBeNaN()
    } finally {
      await request.put(`/api/events/${eventId}/invite-settings`, {
        headers,
        data: { rsvp_capacity: originalCapacity, invite_message: originalMessage },
      })
    }
  })

  test('RSVP question creation persists the same contract', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    await withCleanup(
      (id) => request.delete(`/api/events/${eventId}/rsvp-questions/${id}`, { headers }),
      async (createdIds) => {
        async function addQuestion(page, { legacy }) {
          const questionText = `Parity ${legacy ? 'legacy' : 'redesign'} question ${run}?`
          await page.getByRole('button', { name: 'Invites & RSVP' }).click()
          if (legacy) {
            await page.getByPlaceholder('Question to ask guests...').fill(questionText)
            const response = page.waitForResponse((r) =>
              r.request().method() === 'POST' && r.url().endsWith(`/api/events/${eventId}/rsvp-questions`))
            await page.getByRole('button', { name: 'Add question', exact: true }).click()
            return (await response).json()
          }
          await page.getByRole('button', { name: 'Add question', exact: true }).click()
          const form = page.locator('.gr-question-form')
          await form.getByPlaceholder('e.g. Will you need parking?').fill(questionText)
          await form.locator('select').nth(1).selectOption({ label: 'Short answer' })
          const response = page.waitForResponse((r) =>
            r.request().method() === 'POST' && r.url().endsWith(`/api/events/${eventId}/rsvp-questions`))
          await form.getByRole('button', { name: 'Save question', exact: true }).click()
          return (await response).json()
        }

        const [legacyQuestion, redesignQuestion] = await runLegacyThenRedesign(page, {
          legacyPath: '/admin',
          redesignPath: '/guests-redesign?tab=invite',
          action: addQuestion,
        })
        createdIds.push(legacyQuestion.id, redesignQuestion.id)

        expect(questionContract(redesignQuestion)).toEqual(questionContract(legacyQuestion))
        expect(questionContract(legacyQuestion)).toEqual({ question_type: 'text', is_required: false })
      },
    )
  })

  async function withApprovalRequired(request, eventId, headers, fn) {
    const original = await (await request.get('/api/events', { headers })).json()
    const originalEvent = original.find((e) => e.id === eventId)
    const settingsResponse = await request.put(`/api/events/${eventId}/invite-settings`, {
      headers,
      data: { rsvp_enabled: true, invite_mode: 'open', rsvp_require_approval: true },
    })
    expect(settingsResponse.ok()).toBeTruthy()
    const rsvpToken = (await settingsResponse.json()).rsvp_token
    try {
      await fn(rsvpToken)
    } finally {
      await request.put(`/api/events/${eventId}/invite-settings`, {
        headers,
        data: {
          rsvp_enabled: originalEvent.rsvp_enabled,
          invite_mode: originalEvent.invite_mode,
          rsvp_require_approval: originalEvent.rsvp_require_approval,
        },
      })
    }
  }

  async function submitPendingGuest(request, rsvpToken, firstName) {
    const submit = await request.post(`/api/invite/link/${rsvpToken}/rsvp`, {
      data: { first_name: firstName, last_name: 'Synthetic', email: `${firstName.toLowerCase()}@example.com` },
    })
    expect(submit.ok(), `public RSVP submission for ${firstName} must be accepted`).toBeTruthy()
  }

  test('RSVP approval persists the same guest status', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const names = { legacy: `PartyLegacyApprove${run}`, redesign: `PartyRedesignApprove${run}` }
    const createdIds = []

    await withApprovalRequired(request, eventId, headers, async (rsvpToken) => {
      try {
        for (const name of Object.values(names)) await submitPendingGuest(request, rsvpToken, name)

        await page.goto('/admin')
        await expectQaEventLoaded(page)
        await page.getByRole('button', { name: /Guests/ }).click()
        await page.getByPlaceholder('Search guests by name').fill(names.legacy)
        const legacyRow = page.locator('tr').filter({ hasText: names.legacy })
        const legacyResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/approve'))
        await legacyRow.getByRole('button', { name: 'Approve', exact: true }).click()
        await legacyResponse

        await page.goto('/guests-redesign?tab=guests')
        await expectQaEventLoaded(page)
        const redesignRow = page.locator('.gr-approval-queue-row').filter({ hasText: names.redesign })
        const redesignResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/approve'))
        await redesignRow.getByRole('button', { name: 'Approve', exact: true }).click()
        await page.locator('.rr-modal').getByRole('button', { name: 'Approve', exact: true }).click()
        await redesignResponse

        const guests = await (await request.get(`/api/events/${eventId}/guests`, { headers })).json()
        for (const name of Object.values(names)) {
          const guest = guests.find((g) => g.first_name === name)
          if (guest) createdIds.push(guest.id)
          expect(guest?.rsvp_status, `${name} should be confirmed`).toBe('confirmed')
        }
      } finally {
        for (const id of createdIds) await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
    })
  })

  test('RSVP decline persists the same guest status', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const names = { legacy: `PartyLegacyDecline${run}`, redesign: `PartyRedesignDecline${run}` }
    const createdIds = []

    await withApprovalRequired(request, eventId, headers, async (rsvpToken) => {
      try {
        for (const name of Object.values(names)) await submitPendingGuest(request, rsvpToken, name)

        await page.goto('/admin')
        await expectQaEventLoaded(page)
        await page.getByRole('button', { name: /Guests/ }).click()
        await page.getByPlaceholder('Search guests by name').fill(names.legacy)
        const legacyRow = page.locator('tr').filter({ hasText: names.legacy })
        page.once('dialog', (dialog) => dialog.accept())
        const legacyResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/reject'))
        await legacyRow.getByRole('button', { name: 'Reject', exact: true }).click()
        await legacyResponse

        await page.goto('/guests-redesign?tab=guests')
        await expectQaEventLoaded(page)
        const redesignRow = page.locator('.gr-approval-queue-row').filter({ hasText: names.redesign })
        const redesignResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/reject'))
        await redesignRow.getByRole('button', { name: 'Decline', exact: true }).click()
        await page.locator('.rr-modal').getByRole('button', { name: 'Decline', exact: true }).click()
        await redesignResponse

        const guests = await (await request.get(`/api/events/${eventId}/guests`, { headers })).json()
        for (const name of Object.values(names)) {
          const guest = guests.find((g) => g.first_name === name)
          if (guest) createdIds.push(guest.id)
          expect(guest?.rsvp_status, `${name} should be declined`).toBe('declined')
        }
      } finally {
        for (const id of createdIds) await request.delete(`/api/events/${eventId}/guests/${id}`, { headers })
      }
    })
  })
})
