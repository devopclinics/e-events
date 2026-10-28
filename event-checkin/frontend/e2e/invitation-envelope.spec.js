import { test, expect } from '@playwright/test'

const appearance = { style: 'wax', palette: 'ivory', paper: '', seal: 'gold', initials: 'MA' }
const event = { id: 'envelope-event', name: 'Envelope compatibility gathering', event_date: '2026-12-13T14:00:00Z', rsvp_enabled: true, invite_mode: 'open', guest_hub_layout: 'classic', rsvp_collect_email: true, rsvp_collect_phone: false, rsvp_multi_invitee_enabled: false, rsvp_invitee_type_options: [] }

async function mockInvite(page, { layout = 'classic', enabled = true, frequency = 'once', style = 'wax', failedTheme = false, responded = false } = {}) {
  await page.route('**/api/**', route => {
    const url = route.request().url()
    if (url.includes('/public-theme')) {
      if (failedTheme) return route.fulfill({ status: 503, json: {} })
      return route.fulfill({ json: { event_id: event.id, is_default: true, colors: {}, wording: {}, layout: {}, envelope_config: { enabled, frequency, appearance: { ...appearance, style } } } })
    }
    if (url.includes('/api/invite/token/')) return route.fulfill({ json: { event: { ...event, guest_hub_layout: layout }, guest: { rsvp_status: 'declined' }, already_responded: responded } })
    if (url.includes('/api/invite/')) return route.fulfill({ json: { ...event, guest_hub_layout: layout } })
    return route.fulfill({ json: [] })
  })
}

test('opening and skipping remember the first visit; preview replays without changing the link', async ({ page }) => {
  await mockInvite(page)
  await page.goto('/invite/envelope-event?utm_source=test')
  await page.getByRole('button', { name: 'Go straight to the invitation' }).click()
  await expect(page.getByRole('heading', { name: event.name, exact: true }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: event.name, exact: true }).first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Your invitation' })).toHaveCount(0)
  await page.goto('/invite/envelope-event?envelope-preview=1&utm_source=test')
  await expect(page.getByRole('dialog', { name: 'Your invitation' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/utm_source=test/)
})

for (const layout of ['classic', 'companion', 'journey', 'complete', 'app']) {
  test(`envelope preserves existing ${layout} invitation layout`, async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await mockInvite(page, { layout, frequency: 'always' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/rsvp/example-shared-link')
    await page.getByRole('button', { name: 'Open your invitation', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Your invitation' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: event.name, exact: true }).first()).toBeVisible()
    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Your invitation' })).toBeVisible()
    expect(errors).toEqual([])
  })
}

for (const scenario of ['disabled', 'unavailable theme', 'unavailable storage', 'returning guest']) {
  test(`direct entry for ${scenario}`, async ({ page }) => {
    await mockInvite(page, { enabled: scenario !== 'disabled', failedTheme: scenario === 'unavailable theme', responded: scenario === 'returning guest' })
    if (scenario === 'unavailable storage') await page.addInitScript(() => { Storage.prototype.setItem = () => { throw Error('Storage unavailable') } })
    await page.goto(scenario === 'returning guest' ? '/r/personal-token' : '/invite/envelope-event')
    await expect(page.getByRole('heading', { name: event.name, exact: true }).first()).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Your invitation' })).toHaveCount(0)
  })
}

test('all styles open on mobile with keyboard access @mobile', async ({ page }) => {
  for (const style of ['wax', 'classic', 'pocket']) {
    await page.unroute('**/api/**')
    await mockInvite(page, { style, frequency: 'always' })
    await page.goto('/invite/envelope-event')
    const opening = page.getByRole('dialog', { name: 'Your invitation' })
    await expect(opening).toHaveAttribute('data-style', style)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await page.getByRole('button', { name: 'Open your invitation', exact: true }).press('Enter')
    await expect(opening).toHaveCount(0)
  }
})

test('opening does not submit an RSVP; the existing form still submits guest fields', async ({ page }) => {
  await mockInvite(page)
  const submissions = []
  await page.route('**/api/invite/envelope-event/rsvp', route => {
    submissions.push(route.request().postDataJSON())
    return route.fulfill({ status: 400, json: { detail: 'Synthetic RSVP validation response' } })
  })
  await page.goto('/invite/envelope-event')
  await page.getByRole('button', { name: 'Go straight to the invitation' }).click()
  expect(submissions).toEqual([])
  await page.getByRole('button', { name: /Yes, I'll be there/ }).click()
  await page.getByPlaceholder('Jane', { exact: true }).fill('Amina')
  await page.getByPlaceholder('Smith', { exact: true }).fill('Example')
  await page.getByPlaceholder('jane@example.com', { exact: true }).fill('amina@example.com')
  await page.locator('form button[type=submit]').click()
  await expect.poll(() => submissions.length).toBe(1)
  expect(submissions[0]).toMatchObject({ first_name: 'Amina', last_name: 'Example', email: 'amina@example.com' })
})

test('a stalled theme falls back to the invitation', async ({ page }) => {
  await mockInvite(page)
  await page.route('**/public-theme?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 5500))
    await route.fulfill({ json: { envelope_config: { enabled: true, frequency: 'always', appearance } } }).catch(() => {})
  })
  await page.goto('/invite/envelope-event')
  await expect(page.getByRole('heading', { name: event.name, exact: true }).first()).toBeVisible({ timeout: 6000 })
  await page.waitForTimeout(1700)
  await expect(page.getByRole('dialog', { name: 'Your invitation' })).toHaveCount(0)
})
