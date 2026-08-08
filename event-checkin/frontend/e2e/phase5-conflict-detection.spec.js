import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, fieldNear, openGuestActions, requiredEnv, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

// Phase 5 (concurrency/stale-edit detection). Task and Event previously had
// no version/timestamp field at all, so two operators editing the same task
// or changing an event's lifecycle status concurrently could silently
// clobber each other — there was no way to even detect it server-side. This
// verifies the added if_unmodified_since optimistic-concurrency guard: a
// stale write is rejected with 409 (never applied), and the exact same
// write succeeds once the caller has the current updated_at.
test.describe('Phase 5 conflict detection — isolated staging fixture', () => {
  test('task update rejects a stale if_unmodified_since and accepts the current one', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const created = await (await page.request.post(`/api/events/${eventId}/tasks`, {
      headers: { Authorization: authorization },
      data: { title: 'Phase 5 conflict-check task' },
    })).json()

    try {
      const stale = await page.request.put(`/api/events/${eventId}/tasks/${created.id}?if_unmodified_since=2020-01-01T00:00:00`, {
        headers: { Authorization: authorization },
        data: { title: 'Should be rejected' },
      })
      expect(stale.status()).toBe(409)
      expect((await stale.json()).detail).toMatch(/another operator/i)

      const fresh = await page.request.get(`/api/events/${eventId}/tasks`, { headers: { Authorization: authorization } })
      const current = (await fresh.json()).find((t) => t.id === created.id)
      expect(current.title).toBe('Phase 5 conflict-check task') // the rejected write never applied

      const accepted = await page.request.put(`/api/events/${eventId}/tasks/${created.id}?if_unmodified_since=${encodeURIComponent(current.updated_at)}`, {
        headers: { Authorization: authorization },
        data: { title: 'Applied with the current version' },
      })
      expect(accepted.ok()).toBeTruthy()
      expect((await accepted.json()).title).toBe('Applied with the current version')
    } finally {
      await page.request.delete(`/api/events/${eventId}/tasks/${created.id}`, { headers: { Authorization: authorization } })
    }
  })

  test('event status change rejects a stale if_unmodified_since and accepts the current one', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const before = await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json()
    const originalStatus = before.find((e) => e.id === eventId).status
    const next = originalStatus === 'active' ? 'draft' : 'active'
    const revert = originalStatus

    try {
      // First transition — real, populates/refreshes updated_at.
      const first = await page.request.patch(`/api/events/${eventId}/status`, {
        headers: { Authorization: authorization }, data: { status: next },
      })
      expect(first.ok()).toBeTruthy()
      const afterFirst = await first.json()
      expect(afterFirst.status).toBe(next)

      // Stale attempt using an obviously-wrong prior version — rejected.
      const stale = await page.request.patch(`/api/events/${eventId}/status`, {
        headers: { Authorization: authorization },
        data: { status: revert, if_unmodified_since: '2020-01-01T00:00:00.000000' },
      })
      expect(stale.status()).toBe(409)
      expect((await stale.json()).detail).toMatch(/another operator/i)

      // Same transition with the real current updated_at — accepted.
      const accepted = await page.request.patch(`/api/events/${eventId}/status`, {
        headers: { Authorization: authorization },
        data: { status: revert, if_unmodified_since: afterFirst.updated_at },
      })
      expect(accepted.ok()).toBeTruthy()
      expect((await accepted.json()).status).toBe(revert)
    } finally {
      const restore = await page.request.get('/api/events', { headers: { Authorization: authorization } })
      const currentStatus = (await restore.json()).find((e) => e.id === eventId).status
      if (currentStatus !== originalStatus) {
        await page.request.patch(`/api/events/${eventId}/status`, {
          headers: { Authorization: authorization }, data: { status: originalStatus },
        })
      }
    }
  })

  test('guest update rejects a stale if_unmodified_since and accepts the current one', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const created = await (await page.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: authorization },
      data: { first_name: 'Phase5', last_name: 'ConflictGuest' },
    })).json()

    try {
      const stale = await page.request.patch(`/api/events/${eventId}/guests/${created.id}?if_unmodified_since=2020-01-01T00:00:00`, {
        headers: { Authorization: authorization },
        data: { first_name: 'ShouldBeRejected' },
      })
      expect(stale.status()).toBe(409)
      expect((await stale.json()).detail).toMatch(/another operator/i)

      const accepted = await page.request.patch(`/api/events/${eventId}/guests/${created.id}?if_unmodified_since=${encodeURIComponent(created.updated_at)}`, {
        headers: { Authorization: authorization },
        data: { first_name: 'AppliedCorrectly' },
      })
      expect(accepted.ok()).toBeTruthy()
      expect((await accepted.json()).first_name).toBe('AppliedCorrectly')
    } finally {
      await page.request.delete(`/api/events/${eventId}/guests/${created.id}`, { headers: { Authorization: authorization } })
    }
  })

  test('member permission update rejects a stale if_unmodified_since and accepts the current one', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const me = await (await page.request.get('/api/auth/me', { headers: { Authorization: authorization } })).json()
    const assigned = await page.request.post(`/api/events/${eventId}/members`, {
      headers: { Authorization: authorization }, data: { user_id: me.id },
    })
    expect(assigned.ok(), 'the isolated E2E identity must have real org membership to self-assign').toBeTruthy()
    const member = await assigned.json()

    try {
      const stale = await page.request.patch(`/api/events/${eventId}/members/${me.id}/permissions`, {
        headers: { Authorization: authorization },
        data: { can_manage_guests: true, if_unmodified_since: '2020-01-01T00:00:00' },
      })
      expect(stale.status()).toBe(409)
      expect((await stale.json()).detail).toMatch(/another operator/i)

      const accepted = await page.request.patch(`/api/events/${eventId}/members/${me.id}/permissions`, {
        headers: { Authorization: authorization },
        data: { can_manage_guests: true, if_unmodified_since: member.updated_at },
      })
      expect(accepted.ok()).toBeTruthy()
    } finally {
      await page.request.delete(`/api/events/${eventId}/members/${me.id}`, { headers: { Authorization: authorization } })
    }
  })

  test('seating table update rejects a stale if_unmodified_since and accepts the current one', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const created = await (await page.request.post(`/api/events/${eventId}/tables`, {
      headers: { Authorization: authorization },
      data: { name: 'Phase5 Conflict Table', capacity: 4 },
    })).json()

    try {
      const stale = await page.request.put(`/api/events/${eventId}/tables/${created.id}?if_unmodified_since=2020-01-01T00:00:00`, {
        headers: { Authorization: authorization },
        data: { name: 'Should be rejected', capacity: 4 },
      })
      expect(stale.status()).toBe(409)
      expect((await stale.json()).detail).toMatch(/another operator/i)

      const fresh = await page.request.get(`/api/events/${eventId}/tables`, { headers: { Authorization: authorization } })
      const current = (await fresh.json()).find((t) => t.id === created.id)
      expect(current.name).toBe('Phase5 Conflict Table') // the rejected write never applied

      const accepted = await page.request.put(`/api/events/${eventId}/tables/${created.id}?if_unmodified_since=${encodeURIComponent(current.updated_at)}`, {
        headers: { Authorization: authorization },
        data: { name: 'Applied with the current version', capacity: 4 },
      })
      expect(accepted.ok()).toBeTruthy()
      expect((await accepted.json()).name).toBe('Applied with the current version')
    } finally {
      await page.request.delete(`/api/events/${eventId}/tables/${created.id}`, { headers: { Authorization: authorization } })
    }
  })

  // The tests above prove the backend guard works. These two prove the
  // REDESIGN UI actually surfaces a live conflict to the user and recovers
  // cleanly, rather than silently applying a stale write. Legacy-only:
  // AdminPage.jsx's guest-edit save (`api.updateGuest(selectedId, guestId,
  // data)`) and its status-change save (`api.changeStatus(event.id, next)`)
  // both omit the `if_unmodified_since` argument entirely, so legacy never
  // sends it and can never receive a 409 from its own save -- it always
  // silently overwrites concurrent edits. That's a real, pre-existing gap
  // in legacy (redesign is the one that added this protection), not
  // something a legacy-vs-redesign comparison applies to, so there's no
  // legacy counterpart to these two tests.
  test('redesign guest edit surfaces a live conflict instead of silently overwriting', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const name = `Conflict UI Guest ${suffix}`
    const created = await (await page.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: authorization },
      data: { first_name: name, last_name: 'Synthetic' },
    })).json()

    try {
      await page.goto('/guests-redesign')
      await expectQaEventLoaded(page)
      await openGuestActions(page, name)
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const modal = page.locator('.rr-modal').filter({ hasText: `Edit: ${name}` })
      await expect(modal).toBeVisible()

      // Simulate "another operator" saving first, while this edit modal
      // (holding the pre-edit updated_at) sits open.
      const concurrentEdit = await page.request.patch(
        `/api/events/${eventId}/guests/${created.id}?if_unmodified_since=${encodeURIComponent(created.updated_at)}`,
        { headers: { Authorization: authorization }, data: { first_name: 'ChangedByAnotherOperator' } },
      )
      expect(concurrentEdit.ok()).toBeTruthy()

      await fieldNear(page, 'Last name', modal).fill('StaleEditAttempt')
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Changed by another operator', { exact: false })).toBeVisible()
      await expect(modal).toHaveCount(0) // the conflict closes the modal rather than leaving a stale form open

      const guests = await (await page.request.get(`/api/events/${eventId}/guests`, { headers: { Authorization: authorization } })).json()
      const finalGuest = guests.find((g) => g.id === created.id)
      expect(finalGuest.first_name).toBe('ChangedByAnotherOperator') // the concurrent edit stuck
      expect(finalGuest.last_name).not.toBe('StaleEditAttempt') // the stale UI save never applied
    } finally {
      await page.request.delete(`/api/events/${eventId}/guests/${created.id}`, { headers: { Authorization: authorization } })
    }
  })

  test('redesign event status change surfaces a live conflict instead of silently overwriting', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })
    await signIn(page)
    expect(authorization).toMatch(/^Bearer /)

    const before = await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json()
    const originalStatus = before.find((e) => e.id === eventId).status

    async function setStatus(status) {
      const current = (await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json())
        .find((e) => e.id === eventId)
      if (current.status === status) return
      const response = await page.request.patch(`/api/events/${eventId}/status`, {
        headers: { Authorization: authorization }, data: { status },
      })
      expect(response.ok()).toBeTruthy()
    }

    try {
      await setStatus('active')
      await page.goto('/admin-redesign')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: /Active/ }).first().click()
      await page.getByRole('button', { name: /Draft/ }).click()
      // This screen already has the event's pre-change updated_at captured;
      // change status underneath it before confirming, to force a conflict.
      const concurrent = await page.request.patch(`/api/events/${eventId}/status`, {
        headers: { Authorization: authorization }, data: { status: 'ended' },
      })
      expect(concurrent.ok()).toBeTruthy()

      await page.getByRole('button', { name: 'Set Draft', exact: true }).click()
      await expect(page.getByText('Changed by another operator', { exact: false })).toBeVisible()

      const persisted = await (await page.request.get('/api/events', { headers: { Authorization: authorization } })).json()
      expect(persisted.find((e) => e.id === eventId)?.status).toBe('ended') // the concurrent change stuck, the stale draft change never applied
    } finally {
      await setStatus(originalStatus)
    }
  })
})
