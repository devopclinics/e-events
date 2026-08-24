import { chromium } from 'playwright'

const base = process.env.E2E_BASE_URL || 'https://staging.festio.events'
const joinCode = process.env.FESTIO_LIVE_JOIN_CODE || '4F8WKC'
const personalGuestUrl = process.env.PERSONAL_GUEST_URL || ''
const output = process.env.OUTPUT_DIR || '/home/dev/events/mockups'
const marker = Date.now().toString(36).toUpperCase()
const pendingQuestion = `E2E ${marker} · Will my submitted question remain visible?`

async function join(page, name) {
  await page.goto(`${base}/live/join/${joinCode}`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('Your name (optional)').fill(name)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await page.getByText('MBF Live · Civic Engagement Q&A', { exact: true }).waitFor()
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 430, height: 932 } })
const author = await context.newPage()

await join(author, `Q&A regression ${marker}`)
await author.getByText('MBF Live · Civic Engagement Q&A', { exact: true }).click()
await author.getByPlaceholder('Ask a question…').fill(pendingQuestion)
await author.getByRole('button', { name: 'Ask', exact: true }).click()
await author.getByText('Question submitted — it will appear to everyone after the moderator features it.', { exact: true }).waitFor()
await author.locator('div.flex-1').filter({ hasText: pendingQuestion }).waitFor()
await author.getByText('Awaiting moderation', { exact: true }).waitFor()
await author.getByRole('button', { name: 'Ask', exact: true }).waitFor()
await author.screenshot({ path: `${output}/festio-live-qna-pending-fixed.png`, fullPage: true })

await author.getByRole('button', { name: 'All activities', exact: false }).click()
await author.getByText('MBF Live · Opening Hopes', { exact: true }).click()
await author.getByPlaceholder('Type your answer…').fill(`ready-${marker.toLowerCase()}`)
await author.getByRole('button', { name: 'Submit', exact: true }).click()
await author.getByText('Thanks — your response is in.', { exact: true }).waitFor()
await author.screenshot({ path: `${output}/festio-live-word-cloud-open-fixed.png`, fullPage: true })

const observerContext = await browser.newContext({ viewport: { width: 430, height: 932 } })
const observer = await observerContext.newPage()
await join(observer, `Privacy regression ${marker}`)
await observer.getByText('MBF Live · Civic Engagement Q&A', { exact: true }).click()
await observer.getByPlaceholder('Ask a question…').waitFor()
if (await observer.locator('div.flex-1').filter({ hasText: pendingQuestion }).count()) {
  throw new Error('Another guest could see a private pending Q&A submission')
}

let personalGuestCanAnswerWordCloud = null
if (personalGuestUrl) {
  const personalContext = await browser.newContext({ viewport: { width: 430, height: 932 } })
  const personal = await personalContext.newPage()
  await personal.goto(personalGuestUrl, { waitUntil: 'networkidle' })
  await personal.getByText('MBF Live · Opening Hopes', { exact: true }).click()
  await personal.getByPlaceholder('Type your answer…').waitFor()
  personalGuestCanAnswerWordCloud = true
}

console.log(JSON.stringify({
  release: '2.3.317',
  qnaSubmissionPersistedForAuthor: true,
  pendingQuestionHiddenFromOtherGuest: true,
  wordCloudAcceptedNewResponse: true,
  personalGuestCanAnswerWordCloud,
  retainedSyntheticQuestion: pendingQuestion,
}))

await browser.close()
