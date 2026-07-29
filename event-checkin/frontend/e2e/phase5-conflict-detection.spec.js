import { test, expect } from '@playwright/test'
import { requiredEnv, signIn } from './helpers.js'

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
})
