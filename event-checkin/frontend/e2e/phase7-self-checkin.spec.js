import { test, expect } from '@playwright/test'

test.describe('Phase 7 public self check-in contracts', () => {
  test('valid search, confirmed admission, and re-entry result', async ({ page }) => {
    let admissionCount = 0
    await page.route('**/api/e/QA2026', (route) => route.fulfill({ json: { status: 'ok', name: 'QA Public Event' } }))
    await page.route('**/api/e/QA2026/search', (route) => route.fulfill({ json: { status: 'ok', guests: [{ id: 'synthetic-guest', name: 'Synthetic Guest' }] } }))
    await page.route('**/api/e/QA2026/checkin/synthetic-guest', (route) => {
      admissionCount += 1
      return route.fulfill({ json: admissionCount === 1
        ? { status: 'admitted', message: 'Synthetic Guest admitted.', admitted_guest: 'Synthetic Guest', table_name: 'QA 1', seat_number: '2', seating_term: 'Table' }
        : { status: 'already_admitted', message: 'Synthetic Guest was already admitted.', admitted_guest: 'Synthetic Guest' } })
    })

    await page.goto('/selfcheckin-redesign?code=QA2026')
    await expect(page.getByRole('heading', { name: 'QA Public Event' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Name or phone' }).fill('Synthetic')
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('button', { name: /Synthetic Guest/ }).click()
    await page.getByRole('button', { name: "Yes, that's me" }).click()
    await expect(page.getByRole('status')).toContainText('Synthetic Guest admitted')
    await expect(page.getByRole('status')).toContainText('Table QA 1, Seat 2')

    await page.getByRole('button', { name: 'Check in another guest' }).click()
    await page.getByRole('textbox', { name: 'Name or phone' }).fill('Synthetic')
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('button', { name: /Synthetic Guest/ }).click()
    await page.getByRole('button', { name: "Yes, that's me" }).click()
    await expect(page.getByRole('status')).toContainText(/already admitted/i)
  })

  test('invalid and inactive codes do not expose search', async ({ page }) => {
    await page.route('**/api/e/REVOKED', (route) => route.fulfill({ json: { status: 'invalid', message: 'This check-in link isn’t valid.' } }))
    await page.goto('/selfcheckin-redesign?code=REVOKED')
    await expect(page.getByRole('alert')).toContainText('Invalid check-in link')
    await expect(page.getByRole('textbox', { name: 'Name or phone' })).toHaveCount(0)
  })

  test('poor connectivity preserves a retry path @mobile', async ({ page }) => {
    let attempts = 0
    await page.route('**/api/e/OFFLINE', async (route) => {
      attempts += 1
      if (attempts === 1) return route.abort('failed')
      return route.fulfill({ json: { status: 'ok', name: 'Recovered Event' } })
    })
    await page.goto('/selfcheckin-redesign?code=OFFLINE')
    await expect(page.getByRole('alert')).toContainText('Connection problem')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Recovered Event' })).toBeVisible()
    const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(width).toBeTruthy()
  })
})
