import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export const QA_EVENT_NAME = 'Redesign QA Test Event'

// Vendored (not npm-installed: this host has no npm/yarn/pnpm) from
// https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js
// __dirname (not import.meta.url) because Playwright compiles this file to
// CommonJS when the nearest package.json has no "type": "module".
const AXE_SOURCE = readFileSync(path.join(__dirname, 'vendor/axe.min.js'), 'utf-8')

// Injects axe-core into the current page and runs a scan, returning only
// serious/critical violations (moderate/minor findings are excluded to keep
// this a regression gate, not a full audit backlog). Call after the page has
// reached the state you want scanned.
export async function axeSeriousViolations(page) {
  await page.addScriptTag({ content: AXE_SOURCE })
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return axe.run(document, { resultTypes: ['violations'] })
  })
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

export function formatAxeViolations(violations) {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`).join('\n')
}

export function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for authenticated staging E2E tests`)
  return value
}

export async function signInAs(page, email, password, eventId) {
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

export async function signIn(page) {
  await signInAs(page, requiredEnv('E2E_EMAIL'), requiredEnv('E2E_PASSWORD'), requiredEnv('E2E_EVENT_ID'))
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

// Runs the same workflow once against the legacy route and once against the
// redesign route, generalizing the legacy/redesign branch that
// phase9-parity-core.spec.js's createTaskFromCurrentPage() first established
// inline. `action(page, { legacy })` performs the workflow and returns the
// captured result (e.g. a created record's JSON); the two results are
// returned as [legacyResult, redesignResult] for the caller to compare.
export async function runLegacyThenRedesign(page, { legacyPath, redesignPath, action }) {
  await page.goto(legacyPath)
  await expectQaEventLoaded(page)
  const legacyResult = await action(page, { legacy: true })

  await page.goto(redesignPath)
  await expectQaEventLoaded(page)
  const redesignResult = await action(page, { legacy: false })

  return [legacyResult, redesignResult]
}

// Wraps a parity test body with the create-then-delete cleanup pattern every
// phase9-parity-core.spec.js test repeats: `fn` receives a mutable
// `createdIds` array to push synthetic-record ids onto as it creates them,
// and every pushed id is passed to `deleteFn` afterward, even on failure.
export async function withCleanup(deleteFn, fn) {
  const createdIds = []
  try {
    return await fn(createdIds)
  } finally {
    for (const id of createdIds) {
      await deleteFn(id)
    }
  }
}
