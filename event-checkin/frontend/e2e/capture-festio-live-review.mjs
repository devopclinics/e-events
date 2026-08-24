import { chromium } from 'playwright'

const base = process.env.E2E_BASE_URL || 'http://host.docker.internal:4000'
const eventId = process.env.EVENT_ID
const customToken = process.env.CUSTOM_TOKEN
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}')
const output = process.env.OUTPUT_DIR || '/output'

if (!eventId || !customToken || !firebaseConfig.apiKey) throw new Error('EVENT_ID, CUSTOM_TOKEN and FIREBASE_CONFIG are required')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 })
await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(async ({ config, token, selectedEvent }) => {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js')
  const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
  const app = initializeApp(config)
  await signInWithCustomToken(getAuth(app), token)
  localStorage.setItem('eq.currentEventId', selectedEvent)
  localStorage.setItem('theme', 'light')
}, { config: firebaseConfig, token: customToken, selectedEvent: eventId })

await page.goto(`${base}/live-redesign`, { waitUntil: 'networkidle' })
await page.locator('.fl-hero').waitFor()
await page.screenshot({ path: `${output}/festio-live-overview-2.3.302.png`, fullPage: true })
await page.getByRole('button', { name: 'Displays', exact: true }).click()
await page.locator('.fl-display-card').first().waitFor()
await page.screenshot({ path: `${output}/festio-live-displays-2.3.302.png`, fullPage: true })
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await page.locator('.fl-settings-grid').waitFor()
await page.screenshot({ path: `${output}/festio-live-settings-2.3.302.png`, fullPage: true })

const answerChanges = page.locator('.fl-setting-row').filter({ hasText: 'Answer changes' })
const initialToggle = await answerChanges.locator('i').getAttribute('class')
await answerChanges.click()
await page.getByRole('button', { name: 'Save changes', exact: true }).click()
await page.getByRole('button', { name: '✓ Saved', exact: true }).waitFor()
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.fl-tabs').getByRole('button', { name: 'Settings', exact: true }).click()
await page.locator('.fl-settings-grid').waitFor()
const persistedToggle = await page.locator('.fl-setting-row').filter({ hasText: 'Answer changes' }).locator('i').getAttribute('class')
if (persistedToggle === initialToggle) throw new Error('Event settings did not persist after reload')
await page.locator('.fl-setting-row').filter({ hasText: 'Answer changes' }).click()
await page.getByRole('button', { name: 'Save changes', exact: true }).click()
await page.getByRole('button', { name: '✓ Saved', exact: true }).waitFor()

for (const tab of ['Overview', 'Activities', 'Question Bank', 'Live Control', 'Responses', 'Analytics']) {
  await page.locator('.fl-tabs').getByRole('button', { name: tab, exact: true }).click()
  await page.waitForTimeout(250)
  if (!(await page.locator('.fl-app').isVisible())) throw new Error(`${tab} did not render`)
}

console.log(JSON.stringify({ title: await page.title(), url: page.url(), screenshots: 3, tabsVerified: 8, settingsPersistence: true }))
await browser.close()
