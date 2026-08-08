import { test, expect } from '@playwright/test'
import {
  expectQaEventLoaded,
  firebaseAccessToken,
  signIn,
} from './helpers.js'
import { zonedWallTimeToUtcISOString } from '../src/timeutil.js'

// Unlike the other phase9-parity-*.spec.js files, this one is NOT scoped to
// the shared "Redesign QA Test Event" (E2E_EVENT_ID) at all -- it exercises
// event *creation* itself: the legacy "New Event" wizard (SetupWizardPage.jsx,
// reached via AdminPage's "New Event" button -> /setup) versus the redesign
// wizard (SetupRedesignPage.jsx -> /setup-redesign). Both ultimately call the
// same api.createEvent() -> POST /api/events endpoint. Every event created
// here is a brand-new, uniquely-named, synthetic row that gets deleted in a
// `finally` block, so this file never touches the shared QA event/org fixture
// data that sibling spec files depend on.

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

// This shared staging org's free-event cap (backend/app/routers/events.py
// create_event) only blocks a new event when the org has ZERO historically
// paid events -- the QA org's fixture event is permanently paid, so it never
// should trip here. But this org is a live shared fixture other concurrently
// running phase9-parity-*.spec.js processes also read/write billing state on,
// so an in-flight sibling billing mutation can transiently flip that flag for
// an instant. A brief retry rides out that window without masking a real cap
// regression (which would keep failing across every attempt).
async function submitEventForm(page, buttonLocator, { maxAttempts = 3 } = {}) {
  let json = null
  let status = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && response.url().endsWith('/api/events')
    )
    await buttonLocator.click()
    const response = await responsePromise
    status = response.status()
    json = await response.json()
    if (status === 402 && attempt < maxAttempts) {
      await page.waitForTimeout(2000)
      continue
    }
    break
  }
  return { json, status }
}

// Stable field subset both wizards should produce identically for
// functionally-equivalent input. Deliberately excludes id/name/timestamps
// (each side uses a distinct synthetic name) and the fields covered by the
// dedicated discrepancy assertions below (rsvp_capacity, description,
// event_date), whose divergence is a real, reproducible product gap rather
// than test noise.
function eventContract(event) {
  return {
    couples_name: event.couples_name || '',
    event_type: event.event_type,
    timezone: event.timezone,
    venue_name: event.venue_name || null,
    venue_address: event.venue_address || null,
    notify_sms: !!event.notify_sms,
    notify_whatsapp: !!event.notify_whatsapp,
    status: event.status,
    is_paid: !!event.is_paid,
    seating_enabled: !!event.seating_enabled,
    menu_enabled: !!event.menu_enabled,
    rsvp_enabled: !!event.rsvp_enabled,
  }
}

test.describe('Phase 9 setup/event-creation parity', () => {
  test('creating a new event persists the same core contract via legacy vs redesign', async ({ page, request }) => {
    // Default 30s can be tight once the 402 retry headroom above is counted.
    test.setTimeout(60000)
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)

    // Asia/Dubai has a fixed UTC+4 offset with no DST, and is present in both
    // wizards' timezone pickers -- a deterministic choice for the event_date
    // timezone-math discrepancy demonstrated below.
    const TZ = 'Asia/Dubai'
    const WALL_DATE = '2027-03-20'
    const WALL_TIME = '12:00'
    const GUEST_COUNT = 80

    let legacyEvent = null
    let redesignEvent = null
    let legacyDeleted = false

    try {
      // ── Legacy: AdminPage "New Event" button -> /setup (SetupWizardPage.jsx) ──
      await page.goto('/admin')
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'New Event', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Create your draft event' })).toBeVisible()

      const legacyName = `Parity Setup Legacy ${run}`
      await page.getByPlaceholder('Aisha & Omar Aqdu').fill(legacyName)
      await page.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('Wedding')
      await page.getByRole('textbox', { name: 'Date and time', exact: true }).fill(`${WALL_DATE}T${WALL_TIME}`)
      await page.getByRole('combobox', { name: /^Timezone/ }).selectOption(TZ)
      await page.getByPlaceholder('The Grand Hall').fill('Parity Venue')
      await page.getByPlaceholder('City, state or full address').fill('Parity Address')
      await page.getByPlaceholder('150').fill(String(GUEST_COUNT))

      const legacyResult = await submitEventForm(
        page, page.getByRole('button', { name: 'Create draft event', exact: true }),
      )
      expect(legacyResult.status, `legacy create failed: ${JSON.stringify(legacyResult.json)}`).toBe(201)
      legacyEvent = legacyResult.json
      expect(legacyEvent.name).toBe(legacyName)

      const legacyPersisted = await request.get('/api/events', { headers })
      expect(legacyPersisted.ok()).toBeTruthy()
      expect((await legacyPersisted.json()).some((event) => event.id === legacyEvent.id)).toBeTruthy()

      // Delete the legacy event immediately (rather than holding it open
      // until the shared `finally` below) -- this is the only creation-order
      // lever available to shrink the free-event-cap collision window with
      // concurrently running sibling specs described above.
      await request.delete(`/api/events/${legacyEvent.id}`, { headers })
      legacyDeleted = true

      // ── Redesign: /setup-redesign (SetupRedesignPage.jsx WizardPhase) ──
      await page.goto('/setup-redesign')
      await expect(page.getByRole('heading', { name: 'Create your event' })).toBeVisible()

      const redesignName = `Parity Setup Redesign ${run}`
      await page.getByPlaceholder("Women's Convention 2026").fill(redesignName)
      await page.locator('label.rd-field-label:text-is("Type") + select').selectOption('Wedding')
      await page.getByPlaceholder('500').fill(String(GUEST_COUNT))
      await page.getByPlaceholder('Eko Convention Centre').fill('Parity Venue')
      await page.getByPlaceholder('Plot 1415, Adetokunbo Ademola, VI').fill('Parity Address')
      await page.locator('input[type="date"].rd-field').fill(WALL_DATE)
      await page.locator('label.rd-field-label:text-is("Timezone *") + select').selectOption(TZ)

      const redesignResult = await submitEventForm(
        page, page.getByRole('button', { name: /Create event.*continue setup/ }),
      )
      expect(redesignResult.status, `redesign create failed: ${JSON.stringify(redesignResult.json)}`).toBe(201)
      redesignEvent = redesignResult.json
      expect(redesignEvent.name).toBe(redesignName)

      // ── Core contract: everything that should be identical regardless of
      //    which wizard was used ──
      expect(eventContract(redesignEvent)).toEqual(eventContract(legacyEvent))

      // ── Discrepancy 1 (real product gap): the legacy wizard's "Estimated
      //    guests" field only feeds the client-side plan-recommendation copy --
      //    SetupWizardPage.jsx never includes it in the api.createEvent()
      //    payload at all, so legacy-created events always persist
      //    rsvp_capacity: null even when a guest count was entered. The
      //    redesign wizard wires the equivalent field through correctly. ──
      expect(legacyEvent.rsvp_capacity).toBeNull()
      expect(redesignEvent.rsvp_capacity).toBe(GUEST_COUNT)

      // ── Discrepancy 2 (cosmetic): the legacy wizard explicitly sends
      //    description: '' while the redesign wizard omits the key entirely,
      //    so it falls back to the schema default of null. Both represent
      //    "no description" but the persisted value differs. ──
      expect(legacyEvent.description).toBe('')
      expect(redesignEvent.description).toBeNull()

      // ── Discrepancy 3 (real product gap, timezone-correctness): the legacy
      //    wizard converts the wall-clock date/time in the chosen event
      //    timezone to the correct UTC instant via zonedWallTimeToUtcISOString
      //    (frontend/src/timeutil.js). The redesign wizard sends
      //    `${date}T12:00:00` as a bare, timezone-less string -- for
      //    Asia/Dubai (UTC+4) this persists 4 hours "later" than the
      //    equivalent wall-clock noon the legacy flow would have stored. ──
      const expectedLegacyUtc = zonedWallTimeToUtcISOString(`${WALL_DATE}T${WALL_TIME}`, TZ)
      expect(legacyEvent.event_date.slice(0, 19)).toBe(expectedLegacyUtc.slice(0, 19))
      expect(redesignEvent.event_date.slice(0, 19)).toBe(`${WALL_DATE}T${WALL_TIME}:00`)
      expect(redesignEvent.event_date).not.toBe(legacyEvent.event_date)

      // ── Sanity: the redesign row is really persisted, independent of the
      //    create response itself (the legacy row's persistence was already
      //    verified above, before it was deleted) ──
      const persisted = await request.get('/api/events', { headers })
      expect(persisted.ok()).toBeTruthy()
      expect((await persisted.json()).some((event) => event.id === redesignEvent.id)).toBeTruthy()
    } finally {
      if (legacyEvent?.id && !legacyDeleted) await request.delete(`/api/events/${legacyEvent.id}`, { headers })
      if (redesignEvent?.id) await request.delete(`/api/events/${redesignEvent.id}`, { headers })
    }
  })

  test('legacy and redesign event-creation routes enforce the same unauthenticated boundary', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await page.goto('/setup-redesign')
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
  })
})
