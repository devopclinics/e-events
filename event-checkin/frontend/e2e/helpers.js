import { expect } from '@playwright/test'

export const QA_EVENT_NAME = 'Redesign QA Test Event'

export function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for authenticated staging E2E tests`)
  return value
}

export async function signIn(page) {
  const email = requiredEnv('E2E_EMAIL')
  const password = requiredEnv('E2E_PASSWORD')
  const eventId = requiredEnv('E2E_EVENT_ID')

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  const profileReady = page.waitForResponse((response) =>
    response.url().includes('/api/auth/me') && response.status() === 200
  )
  await page.getByRole('button', { name: 'Sign In' }).click()
  await profileReady
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
  // LoginPage and AuthProvider each reconcile /auth/me and may both navigate.
  // Wait for those redirects to settle before opening the route under test.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(750)

  await page.evaluate((id) => {
    localStorage.setItem('eq.currentEventId', id)
    localStorage.setItem('preferredView', 'admin')
  }, eventId)
}

export async function expectQaEventLoaded(page) {
  await expect(page.getByText(QA_EVENT_NAME, { exact: true }).first()).toBeAttached()
}

export async function firebaseAccessToken(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('firebaseLocalStorageDb')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction('firebaseLocalStorage', 'readonly')
        .objectStore('firebaseLocalStorage').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return rows.find((row) => row?.value?.stsTokenManager?.accessToken)
      ?.value?.stsTokenManager?.accessToken || ''
  })
}

export async function openGuestActions(page, guestName) {
  await page.getByRole('button', { name: `Actions for ${guestName}` }).click()
}

// Several redesign forms render `<label class="rd-field-label">Text</label>`
// immediately followed by its control rather than an `htmlFor`/wrapping
// association, so `page.getByLabel()` can't resolve them. This targets the
// same markup directly via the DOM adjacency instead. Scope narrows the
// search when the same label text appears in more than one open form.
export function fieldNear(page, labelText, scope) {
  const root = scope || page
  return root.locator(`label.rd-field-label:text-is("${labelText}") + input, label.rd-field-label:text-is("${labelText}") + select`)
}
