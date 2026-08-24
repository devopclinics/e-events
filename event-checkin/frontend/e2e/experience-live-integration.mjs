import { chromium } from 'playwright'

const base = process.env.E2E_BASE_URL || 'http://host.docker.internal:4000'
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
const syncSummary = page.locator('.ex-live-sync-summary')
await syncSummary.waitFor()
await syncSummary.getByText('3 program sessions synchronized', { exact: true }).waitFor()
await page.getByText('E2E · Experience + Live Program', { exact: false }).first().waitFor()
await page.screenshot({ path: `${output}/festio-experience-live-sync.png`, fullPage: true })

await page.goto(`${base}/live-redesign`, { waitUntil: 'networkidle' })
await page.locator('.fl-tabs').getByRole('button', { name: 'Activities', exact: true }).click()
await page.getByText('3 synchronized sessions', { exact: false }).waitFor()
for (const title of [
  'Opening Keynote · The Future of Events',
  'Leadership Lab · Ideas Into Action',
  'Networking Finale · Audience Choice',
  'E2E · Opening Pulse',
  'E2E · Future of Events Quiz',
  'E2E · Audience Choice Survey',
]) {
  await page.getByText(title, { exact: true }).first().waitFor()
}
if (await page.locator('.fl-program-group').count() < 3) throw new Error('Program session groups were not rendered')
await page.screenshot({ path: `${output}/festio-live-program-groups.png`, fullPage: true })

await page.locator('.fl-tabs').getByRole('button', { name: 'Displays', exact: true }).click()
const display = page.locator('.fl-display-card').filter({ hasText: 'E2E · Experience Agenda' })
await display.waitFor()
const projectorUrl = await display.locator('iframe').getAttribute('src')
if (!projectorUrl) throw new Error('Projector URL was not rendered')

const projector = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await projector.goto(projectorUrl, { waitUntil: 'networkidle' })
await projector.locator('.flb-root').waitFor()
await projector.getByText('Opening Keynote · The Future of Events', { exact: true }).waitFor()
await projector.getByText('Leadership Lab · Ideas Into Action', { exact: true }).waitFor()
await projector.getByText('Networking Finale · Audience Choice', { exact: true }).waitFor()
await projector.screenshot({ path: `${output}/festio-live-synced-projector.png` })

console.log(JSON.stringify({
  experienceSync: true,
  synchronizedSessions: 3,
  linkedActivitiesVerified: 3,
  projector: true,
  screenshots: 3,
}))
await browser.close()
