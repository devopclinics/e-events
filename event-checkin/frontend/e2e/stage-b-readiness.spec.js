import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, signIn } from './helpers.js'

const stageBRoutes = [
  ['/admin-redesign', 'Event Setup'],
  ['/guests-redesign', 'Guest Engagement'],
  ['/communications-redesign', 'Guest Communication'],
  ['/addons-redesign', 'Add-ons'],
  ['/team-redesign', 'Team & Tasks'],
  ['/experience-redesign', 'Guest Experience'],
]

test('authenticated Stage B routes render real QA event without page errors', async ({ page }) => {
  await signIn(page)
  for (const [route, heading] of stageBRoutes) {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(route)
    await expectQaEventLoaded(page)
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible()
    expect(errors, `${route} emitted browser errors`).toEqual([])
  }
})

test('@mobile core Stage B pages do not overflow horizontally', async ({ page }) => {
  await signIn(page)
  for (const route of ['/admin-redesign', '/guests-redesign', '/communications-redesign']) {
    await page.goto(route)
    await expectQaEventLoaded(page)
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(dimensions.content, `${route} horizontal overflow`).toBeLessThanOrEqual(dimensions.viewport + 2)
  }
})

test('unauthenticated API mutation is rejected and redesign redirects to sign-in', async ({ page, request }) => {
  const eventId = process.env.E2E_EVENT_ID
  if (!eventId) throw new Error('E2E_EVENT_ID is required')
  const response = await request.post(`/api/events/${eventId}/guests`, {
    data: { first_name: 'MustNotExist', last_name: 'Unauthorized' },
  })
  expect(response.status()).toBe(401)

  await page.goto('/guests-redesign')
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
})
