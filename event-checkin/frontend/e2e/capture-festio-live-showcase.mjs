import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const base = process.env.E2E_BASE_URL || 'http://host.docker.internal:4000'
const eventId = process.env.EVENT_ID
const customToken = process.env.CUSTOM_TOKEN
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}')
const output = process.env.OUTPUT_DIR || '/output'
if (!eventId || !customToken || !firebaseConfig.apiKey) throw new Error('EVENT_ID, CUSTOM_TOKEN and FIREBASE_CONFIG are required')

const browser = await chromium.launch({ headless: true })
const axeSource = readFileSync(new URL('./vendor/axe.min.js', import.meta.url), 'utf8')

async function assertAccessible(page, label) {
  await page.addScriptTag({ content: axeSource })
  const violations = await page.evaluate(async () => (await axe.run(document)).violations.filter((item) => ['serious', 'critical'].includes(item.impact))) // eslint-disable-line no-undef
  if (violations.length) throw new Error(`${label} accessibility violations: ${violations.map((item) => `${item.id} [${item.nodes.map((node) => node.target.join(' ')).join('; ')}]`).join(', ')}`)
}

async function assertNoPageOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
  }))
  if (dimensions.document > dimensions.viewport + 2) throw new Error(`${label} horizontal overflow: ${dimensions.document}px document in ${dimensions.viewport}px viewport`)
}

async function authenticate(page) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ config, token, selectedEvent }) => {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js')
    const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
    await signInWithCustomToken(getAuth(initializeApp(config)), token)
    localStorage.setItem('eq.currentEventId', selectedEvent)
    localStorage.setItem('theme', 'light')
  }, { config: firebaseConfig, token: customToken, selectedEvent: eventId })
}

const admin = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
await authenticate(admin)
await admin.goto(`${base}/live-redesign`, { waitUntil: 'networkidle' })
await admin.locator('.fl-hero').waitFor()
await assertAccessible(admin, 'Organizer overview')
for (const [width, height] of [[768, 1024], [1024, 768], [1366, 768], [1920, 1080]]) {
  await admin.setViewportSize({ width, height })
  await assertNoPageOverflow(admin, `Organizer ${width}x${height}`)
}
await admin.setViewportSize({ width: 1680, height: 1050 })
await admin.screenshot({ path: `${output}/festio-live-showcase-overview.png`, fullPage: true })

await admin.locator('.fl-tabs').getByRole('button', { name: 'Question Bank', exact: true }).click()
await admin.getByRole('button', { name: 'Import CSV', exact: true }).waitFor()
if (await admin.getByText('E2E · Which format should open the next event?', { exact: true }).count() === 0) {
  await admin.locator('input[type="file"][accept*="csv"]').setInputFiles({
    name: 'festio-live-question-bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('prompt,question_type,description,category,tags,options,correct_options\n"E2E · Which format should open the next event?",single_choice,"Imported through the organizer UI",CSV Imports,"csv|showcase","Live demo|Audience poll|Story|Team challenge","Audience poll"\n'),
  })
  await admin.getByText('1 question imported.', { exact: true }).waitFor()
}
await admin.screenshot({ path: `${output}/festio-live-showcase-question-bank.png`, fullPage: true })

await admin.locator('.fl-tabs').getByRole('button', { name: 'Responses', exact: true }).click()
const feedbackResponse = admin.getByText('E2E · Closing Feedback', { exact: true }).locator('xpath=../..')
await feedbackResponse.getByRole('button', { name: 'Review', exact: true }).click()
await admin.getByText('Public text moderation', { exact: true }).waitFor()
await admin.screenshot({ path: `${output}/festio-live-showcase-moderation.png`, fullPage: true })

await admin.locator('.fl-tabs').getByRole('button', { name: 'Live Control', exact: true }).click()
await admin.locator('.fl-control-hero').waitFor()
await admin.screenshot({ path: `${output}/festio-live-showcase-control.png`, fullPage: true })

await admin.locator('.fl-tabs').getByRole('button', { name: 'Analytics', exact: true }).click()
await admin.locator('.fl-analytics-detail').waitFor()
const reportDownload = admin.waitForEvent('download')
await admin.getByRole('button', { name: 'Download report', exact: true }).click()
const downloadedReport = await reportDownload
if (downloadedReport.suggestedFilename() !== 'festio-live-event-analytics.csv') throw new Error('Event analytics report did not download as CSV')
await admin.screenshot({ path: `${output}/festio-live-showcase-analytics.png`, fullPage: true })

await admin.locator('.fl-tabs').getByRole('button', { name: 'Displays', exact: true }).click()
const mainStage = admin.locator('.fl-display-card').filter({ hasText: 'E2E · Main Stage' })
await mainStage.waitFor()
const projectorUrl = await mainStage.locator('iframe').getAttribute('src')
if (!projectorUrl) throw new Error('Main Stage projector link was not rendered')

const projector = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await projector.goto(projectorUrl, { waitUntil: 'networkidle' })
await projector.locator('.flb-root').waitFor()
for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]]) {
  await projector.setViewportSize({ width, height })
  await assertNoPageOverflow(projector, `Projector ${width}x${height}`)
}
await projector.setViewportSize({ width: 1920, height: 1080 })
await projector.screenshot({ path: `${output}/festio-live-showcase-projector.png` })

const guest = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 })
await guest.goto(base, { waitUntil: 'domcontentloaded' })
await guest.evaluate((selectedEvent) => {
  localStorage.setItem(`festio_live_anon:${selectedEvent}`, 'festio-showcase-guest-01')
  localStorage.setItem('theme', 'light')
}, eventId)
await guest.goto(`${base}/live/guest?event=${eventId}`, { waitUntil: 'networkidle' })
await guest.getByPlaceholder('Your name (optional)').fill('Amina Yusuf')
await guest.getByRole('button', { name: 'Join', exact: true }).click()
await guest.getByRole('button', { name: 'E2E · Opening Pulse' }).waitFor()
await guest.screenshot({ path: `${output}/festio-live-showcase-guest-list.png`, fullPage: true })
await guest.getByRole('button', { name: 'E2E · Opening Pulse' }).click()
await guest.getByText('Results revealed', { exact: true }).waitFor()
await assertAccessible(guest, 'Guest revealed results')
for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768]]) {
  await guest.setViewportSize({ width, height })
  await assertNoPageOverflow(guest, `Guest ${width}x${height}`)
}
await guest.setViewportSize({ width: 430, height: 932 })
await guest.screenshot({ path: `${output}/festio-live-showcase-guest-activity.png`, fullPage: true })

console.log(JSON.stringify({ organizer: true, questionBank: true, csvImport: true, moderation: true, control: true, analytics: true, reportDownload: true, projector: true, guest: true, accessibility: true, responsive: true }))
await browser.close()
