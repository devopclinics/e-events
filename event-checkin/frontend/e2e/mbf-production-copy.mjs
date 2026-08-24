import { chromium } from 'playwright'

const base = process.env.E2E_BASE_URL || 'https://staging.festio.events'
const eventId = process.env.EVENT_ID
const customToken = process.env.CUSTOM_TOKEN
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}')
const output = process.env.OUTPUT_DIR || '/output'

if (!eventId || !customToken || !firebaseConfig.apiKey) {
  throw new Error('EVENT_ID, CUSTOM_TOKEN and FIREBASE_CONFIG are required')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(async ({ config, token, selectedEvent }) => {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js')
  const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
  await signInWithCustomToken(getAuth(initializeApp(config)), token)
  localStorage.setItem('eq.currentEventId', selectedEvent)
  localStorage.setItem('theme', 'light')
}, { config: firebaseConfig, token: customToken, selectedEvent: eventId })

await page.goto(`${base}/experience-redesign`, { waitUntil: 'networkidle' })
await page.locator('.ex-live-sync-summary').getByText('33 program sessions synchronized', { exact: true }).waitFor()
await page.getByText('MBF_Programs · Production Copy', { exact: false }).first().waitFor()
await page.locator('.rr-tabs').getByRole('button', { name: 'Workflow', exact: true }).click()
await page.getByText("Session 1: Khutbah and Salatu Jumu'ah", { exact: true }).waitFor()
await page.getByText('Session 9: Tech Session -- AI & Tech Show', { exact: true }).waitFor()
await page.screenshot({ path: `${output}/mbf-experience-production-copy.png`, fullPage: true })

await page.goto(`${base}/live-redesign`, { waitUntil: 'networkidle' })
await page.locator('.fl-tabs').getByRole('button', { name: 'Activities', exact: true }).click()
await page.getByText('33 synchronized sessions', { exact: false }).waitFor()
for (const title of [
  'MBF Live · Opening Hopes',
  'MBF Live · Summit Opening Pulse',
  'MBF Live · Civic Engagement Q&A',
  'MBF Live · Passing the Torch Quiz',
  'MBF Live · Variety Night Audience Choice',
  'MBF Live · Wellness Check-in',
  'MBF Live · AI & Tech Pulse',
  'MBF Live · Summit Closing Feedback',
]) {
  await page.getByText(title, { exact: true }).waitFor()
}
await page.screenshot({ path: `${output}/mbf-live-session-activities.png`, fullPage: true })

await page.locator('.fl-tabs').getByRole('button', { name: 'Displays', exact: true }).click()
const display = page.locator('.fl-display-card').filter({ hasText: 'MBF · Program Agenda' })
await display.waitFor()
const projectorUrl = await display.locator('iframe').getAttribute('src')
if (!projectorUrl) throw new Error('MBF agenda projector URL was not rendered')

const projector = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await projector.goto(projectorUrl, { waitUntil: 'networkidle' })
await projector.locator('.flb-root').waitFor()
await projector.getByText("Session 1: Khutbah and Salatu Jumu'ah", { exact: true }).waitFor()
await projector.getByText('Transportation to Camp Carolina', { exact: true }).waitFor()
await projector.getByText('Onboarding, Cabin Allocation, Dinner, Networking, Maghrib-Isha', { exact: true }).waitFor()
await projector.screenshot({ path: `${output}/mbf-live-program-agenda.png` })

console.log(JSON.stringify({
  productionReadOnly: true,
  stagingWorkflowSteps: 33,
  synchronizedSessions: 33,
  linkedLiveActivities: 8,
  projector: true,
  screenshots: 3,
}))
await browser.close()
