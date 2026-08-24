import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const base = process.env.E2E_BASE_URL || 'https://staging.festio.events'
const eventId = process.env.EVENT_ID
if (!eventId) throw new Error('EVENT_ID is required')

const browser = await chromium.launch({ headless: true })
const axeSource = readFileSync(new URL('./vendor/axe.min.js', import.meta.url), 'utf8')
const cases = [
  ['502', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' })],
  ['503', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' })],
  ['timeout', (route) => route.abort('timedout')],
  ['dns/upstream', (route) => route.abort('connectionrefused')],
  ['network interruption', (route) => route.abort('internetdisconnected')],
]

for (const [label, fail] of cases) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/api/engagement/v1/activities/live', fail)
  await page.goto(`${base}/live/guest?event=${encodeURIComponent(eventId)}`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('Your name (optional)').fill(`Failure check ${label}`)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByRole('heading', { name: 'Festio Live is temporarily unavailable' }).waitFor()
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Back to Event', exact: true }).waitFor()
  const text = await page.locator('body').innerText()
  for (const forbidden of ['Bad Gateway', 'Service Unavailable', '502', '503', 'nginx', 'stack trace']) {
    if (text.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`${label} exposed infrastructure text: ${forbidden}`)
  }
  await page.addScriptTag({ content: axeSource })
  const violations = await page.evaluate(async () => (await axe.run(document)).violations.filter((item) => ['serious', 'critical'].includes(item.impact))) // eslint-disable-line no-undef
  if (violations.length) throw new Error(`${label} fallback accessibility violations: ${violations.map((item) => item.id).join(', ')}`)
  await page.close()
}

console.log(JSON.stringify({ guestFailureExperience: 'pass', cases: cases.map(([label]) => label) }))
await browser.close()
