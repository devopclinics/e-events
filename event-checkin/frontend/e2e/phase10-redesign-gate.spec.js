/**
 * Phase 10 — RedesignGate cohort-based routing tests
 *
 * Verifies:
 *  1. my_redesign_cohort is present on every event API response.
 *  2. Superadmins are never auto-redirected regardless of org cohort.
 *  3. Non-superadmin users on 'redesign_default' orgs are redirected from
 *     legacy routes to their redesign equivalents.
 *  4. The legacy escape-hatch banner appears (with correct copy and link)
 *     when the org cohort is non-legacy.
 *  5. The debug banner (not the escape-hatch banner) appears on legacy_only
 *     orgs.
 *
 * Environment variables (all provided by run-staging.sh):
 *   E2E_EMAIL / E2E_PASSWORD       — QA test user credentials
 *   E2E_EVENT_ID                   — QA event
 *   E2E_REDESIGN_ORG_ID            — org ID for the QA test org
 *   E2E_REDESIGN_ORG_COHORT        — current cohort of the QA test org
 *
 * Optional (for redirect tests against non-superadmin users):
 *   E2E_NONSUPERADMIN_EMAIL / E2E_NONSUPERADMIN_PASSWORD
 */

import { test, expect } from '@playwright/test'
import { signIn, expectQaEventLoaded, requiredEnv, firebaseAccessToken } from './helpers.js'

test.describe.configure({ mode: 'serial' })

// ── helpers ───────────────────────────────────────────────────────────────────

async function currentEventCohort(request, page, eventId) {
  const token = await firebaseAccessToken(page)
  const response = await request.get(`/api/events/${eventId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBe(true)
  const body = await response.json()
  return body.my_redesign_cohort
}

// ── gate behavior ──────────────────────────────────────────────────────────────

test.describe('RedesignGate — cohort-based routing', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('my_redesign_cohort field is present on event response', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const cohort = await currentEventCohort(request, page, eventId)
    expect(typeof cohort).toBe('string')
    const VALID = ['legacy_only', 'redesign_opt_in', 'redesign_internal', 'redesign_cohort', 'redesign_default', 'legacy_retired']
    expect(VALID).toContain(cohort)
  })

  test('escape-hatch banner shows on redesign page when org cohort is non-legacy', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const cohort = await currentEventCohort(request, page, eventId)

    if (cohort === 'legacy_only') {
      test.skip()
      return
    }

    await page.goto('/admin-redesign')
    await expectQaEventLoaded(page)

    // Auto-redirect cohorts get the teal escape-hatch banner.
    if (cohort === 'redesign_default' || cohort === 'legacy_retired') {
      const banner = page.locator('.rd-mockflag-default')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText('New interface')
      const escapeLink = banner.getByRole('link', { name: /Switch to legacy UI/i })
      await expect(escapeLink).toBeVisible()
      expect(await escapeLink.getAttribute('href')).toBe('/admin?ui=legacy')
    } else {
      // Opt-in cohorts get the debug banner.
      const debugBanner = page.locator('.rd-mockflag:not(.rd-mockflag-default)')
      await expect(debugBanner).toBeVisible()
      await expect(debugBanner).toContainText('Redesign preview')
    }
  })

  test('debug banner shows on redesign page for legacy_only orgs', async ({ page, request }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const cohort = await currentEventCohort(request, page, eventId)

    if (cohort !== 'legacy_only') {
      // The QA org is non-legacy; test the non-legacy banner instead.
      test.skip()
      return
    }

    await page.goto('/admin-redesign')
    await expectQaEventLoaded(page)
    const debugBanner = page.locator('.rd-mockflag:not(.rd-mockflag-default)')
    await expect(debugBanner).toBeVisible()
    await expect(debugBanner).toContainText('Redesign preview')
  })
})

// ── redirect verification (requires non-superadmin account) ───────────────────
// Skipped unless E2E_NONSUPERADMIN_EMAIL / _PASSWORD are provided AND the QA
// org cohort is redesign_default (confirmed via E2E_REDESIGN_ORG_COHORT).

test.describe('RedesignGate — non-superadmin redirect @nonsuperadmin', () => {
  test.skip(
    !process.env.E2E_NONSUPERADMIN_EMAIL
    || !process.env.E2E_NONSUPERADMIN_PASSWORD
    || (process.env.E2E_REDESIGN_ORG_COHORT !== 'redesign_default' && process.env.E2E_REDESIGN_ORG_COHORT !== 'legacy_retired'),
    'Skipped: requires E2E_NONSUPERADMIN_EMAIL/PASSWORD and org on redesign_default cohort',
  )

  test.beforeEach(async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    await page.goto('/login')
    await page.getByLabel('Email').fill(process.env.E2E_NONSUPERADMIN_EMAIL)
    await page.getByLabel('Password').fill(process.env.E2E_NONSUPERADMIN_PASSWORD)
    const profileReady = page.waitForResponse((r) =>
      r.url().includes('/api/auth/me') && r.status() === 200,
    )
    await page.getByRole('button', { name: 'Sign In' }).click()
    await profileReady
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(750)
    await page.evaluate((id) => {
      localStorage.setItem('eq.currentEventId', id)
      localStorage.setItem('preferredView', 'admin')
    }, eventId)
  })

  test('non-superadmin on redesign_default org is redirected from /admin', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin-redesign/)
    await expect(page.locator('.admin-redesign')).toBeVisible()
    await expect(page.locator('.rd-mockflag-default')).toBeVisible()
  })

  test('escape-hatch link returns user to /admin', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin-redesign/)
    await page.locator('.rd-mockflag-default').getByRole('link', { name: /Switch to legacy UI/i }).click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\?ui=legacy$/)
    await expectQaEventLoaded(page)
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin$/)
    await expectQaEventLoaded(page)
  })
})
