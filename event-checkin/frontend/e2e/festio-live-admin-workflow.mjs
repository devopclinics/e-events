import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const base = process.env.E2E_BASE_URL || 'https://staging.festio.events'
const eventId = process.env.EVENT_ID
const customToken = process.env.CUSTOM_TOKEN
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}')
if (!eventId || !customToken || !firebaseConfig.apiKey) throw new Error('EVENT_ID, CUSTOM_TOKEN and FIREBASE_CONFIG are required')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const axeSource = readFileSync(new URL('./vendor/axe.min.js', import.meta.url), 'utf8')

async function assertAccessible(label) {
  if (!await page.evaluate(() => typeof window.axe !== 'undefined')) await page.addScriptTag({ content: axeSource })
  const violations = await page.evaluate(async () => (await axe.run(document)).violations.filter((item) => ['serious', 'critical'].includes(item.impact))) // eslint-disable-line no-undef
  if (violations.length) throw new Error(`${label} accessibility violations: ${violations.map((item) => `${item.id} [${item.nodes.map((node) => node.target.join(' ')).join('; ')}]`).join(', ')}`)
}

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(async ({ config, token, selectedEvent }) => {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js')
  const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
  await signInWithCustomToken(getAuth(initializeApp(config)), token)
  localStorage.setItem('eq.currentEventId', selectedEvent)
  localStorage.setItem('theme', 'light')
}, { config: firebaseConfig, token: customToken, selectedEvent: eventId })

// Inject script-like stored content at the normal API boundary. React must
// render it as text, never as markup, without writing a malicious fixture to
// staging.
const xssCanary = '<img src=x onerror="window.__festioStoredXss=1">'
await page.route('**/api/engagement/v1/activities', async (route) => {
  const response = await route.fetch()
  const rows = await response.json()
  await route.fulfill({ response, json: [{ ...rows[0], id: 'qa-client-xss-canary', title: xssCanary }, ...rows] })
})
await page.goto(`${base}/live-redesign`, { waitUntil: 'networkidle' })
await page.getByText(xssCanary, { exact: true }).waitFor()
if (await page.evaluate(() => window.__festioStoredXss === 1) || await page.locator('img[src="x"]').count()) throw new Error('Stored XSS canary executed')
await page.unroute('**/api/engagement/v1/activities')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const originalTitle = `QA UI · Admin workflow · ${stamp}`
const editedTitle = `${originalTitle} · edited`
const originalQuestion = 'QA UI · Is the control workflow clear?'
const editedQuestion = 'QA UI · Is the live control workflow clear?'

await page.goto(`${base}/live-redesign`, { waitUntil: 'networkidle' })
await page.locator('.fl-hero').waitFor()
await assertAccessible('Overview')
await page.keyboard.press('Tab')
const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, visible: !!document.activeElement?.getClientRects().length }))
if (!focus.visible || focus.tag === 'BODY') throw new Error('Keyboard focus did not enter a visible control')

await page.locator('.fl-tabs').getByRole('button', { name: 'Activities', exact: true }).click()
await page.getByRole('button', { name: '+ New Activity', exact: true }).click()
const createPanel = page.locator('.fl-section-panel')
await createPanel.getByRole('combobox').first().selectOption('poll')
await page.getByPlaceholder('e.g. Leadership Poll').fill(originalTitle)
await page.getByPlaceholder('What guests will experience').fill('Retained browser CRUD and live-state acceptance evidence.')
await createPanel.getByRole('button', { name: 'Create', exact: true }).click()
await page.getByRole('heading', { name: originalTitle, exact: true }).waitFor()

await page.getByRole('button', { name: 'Edit details', exact: true }).click()
await page.getByLabel('Activity title').fill(editedTitle)
await page.getByLabel('Activity description').fill('Retained and edited through the authenticated organizer UI.')
await page.getByRole('button', { name: 'Save details', exact: true }).click()
await page.getByRole('heading', { name: editedTitle, exact: true }).waitFor()

await page.getByPlaceholder('Question prompt').fill(originalQuestion)
await page.getByPlaceholder('Option 1').fill('Very clear')
await page.getByPlaceholder('Option 2').fill('Needs practice')
await page.getByRole('button', { name: 'Add Question', exact: true }).click()
await page.getByText(originalQuestion).waitFor()
await page.getByRole('button', { name: 'Edit question', exact: true }).click()
await page.getByLabel('Edit question 1').fill(editedQuestion)
await page.getByRole('button', { name: 'Save question', exact: true }).click()
await page.getByText(editedQuestion).waitFor()

await page.reload({ waitUntil: 'networkidle' })
await page.locator('.fl-hero').waitFor()
await page.locator('.fl-tabs').getByRole('button', { name: 'Activities', exact: true }).click()
await page.getByText(editedTitle, { exact: true }).click()
await page.getByText(editedQuestion).waitFor()

for (const [tab, marker] of [
  ['Question Bank', 'Reusable content library'], ['Live Control', 'Pressure-ready control room'],
  ['Displays', 'Festio Broadcast'], ['Responses', 'Response explorer'],
  ['Analytics', 'Engagement Analytics'], ['Settings', 'Festio Live Settings'],
]) {
  await page.locator('.fl-tabs').getByRole('button', { name: tab, exact: true }).click()
  await page.getByText(marker, { exact: true }).first().waitFor()
  await assertAccessible(tab)
}

await page.locator('.fl-tabs').getByRole('button', { name: 'Activities', exact: true }).click()
await page.getByRole('button', { name: 'Go Live', exact: true }).click()
await page.getByText('Question closed — not accepting responses', { exact: true }).waitFor()
await page.locator('.fl-live-state').getByRole('button', { name: 'Open question', exact: true }).click()
await page.getByText('Question open — accepting responses', { exact: true }).waitFor()
await page.getByRole('button', { name: 'Close voting', exact: true }).click()
await page.getByRole('button', { name: 'Reopen question', exact: true }).click()
await page.getByText('Question open — accepting responses', { exact: true }).waitFor()
await page.getByRole('button', { name: 'Close voting', exact: true }).click()
await page.getByRole('button', { name: 'Close', exact: true }).click()
await page.getByText('closed', { exact: true }).first().waitFor()
page.once('dialog', (dialog) => dialog.accept())
await page.getByRole('button', { name: 'End activity', exact: true }).click()
await page.getByText('completed', { exact: true }).first().waitFor()

await assertAccessible('Completed activity')

console.log(JSON.stringify({
  authenticatedAdmin: 'pass', create: true, open: true, edit: true, refresh: true,
  navigateAwayAndReturn: true, run: true, close: true, reopenQuestion: true,
  persistedActivity: editedTitle, retained: true, keyboardFocus: true, accessibility: true,
  storedXssInert: true,
  sections: ['Activities', 'Question Bank', 'Live Control', 'Displays', 'Responses', 'Analytics', 'Settings'],
}))
await browser.close()
