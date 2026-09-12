// Runs ONLY against the disposable local Live stack. No production credentials.
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.LIVE_TEST_BASE || 'http://live-test-frontend:5173'
if (!['frontend', 'live-test-frontend', '127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('This fixture must run against an isolated local stack')
const secret = 'isolated-live-reliability-test-key-20260910'
const eventId = `live-reliability-${randomUUID()}`
const orgId = 'isolated-live-reliability-org'
function token(subject, role = 'owner') {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject, name: subject, org_id: orgId, event_id: eventId, role, identity_kind: role === 'guest' ? 'guest' : 'staff', capabilities: role === 'presenter' ? ['control'] : [], iss: 'guesthub', aud: 'engagement', iat: now, exp: now + 3600 })}`
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`
}
const admin = token('isolated-owner')
async function api(method, path, body, auth = admin) {
  const response = await fetch(`${base}/api/engagement/v1${path}`, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`)
  return response.status === 204 ? null : response.json()
}
async function activity(name) {
  const a = await api('POST', '/activities', { title: name, type: 'poll', config: { live_results_enabled: true } })
  const q = await api('POST', `/activities/${a.id}/questions`, { prompt: `${name}: Choose A or B`, question_type: 'single_choice', options: [{ label: 'A' }, { label: 'B' }] })
  await api('POST', `/activities/${a.id}/status`, { status: 'live' })
  await api('POST', `/questions/${q.id}/live-state`, { state: 'open' })
  return { ...a, question: q }
}
async function until(check, label, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)) }
  throw new Error(`Timed out: ${label}`)
}
const report = { environment: 'isolated-local', eventId, assertions: [], screens: 4 }
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const contexts = []
const errors = []
let reads = 0
let joins = 0
async function screen(display, observer = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  contexts.push(context)
  await context.route('**/api/events/**/live/public-join-info', (route) => { joins++; return route.fulfill({ json: { code: 'LOCALTEST', url: '/live/join/LOCALTEST' } }) })
  await context.route('**/api/events/**/live/join-qr.png', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }))
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (/\/api\/engagement\/v1\/live\/[^/]+\?/.test(request.url())) reads++ })
  await page.goto(`${base}/live/${display.display_code}?token=${display.access_token}${observer ? '&observer=true' : ''}`)
  return page
}
try {
  const a = await activity('Stage A question')
  const b = await activity('Room B question')
  const first = await api('POST', '/displays', { name: 'Main stage', assigned_activity_id: a.id, scene: 'question', settings: { follow_activity: false } })
  const second = await api('POST', '/displays', { name: 'Breakout room', assigned_activity_id: b.id, scene: 'question', settings: { follow_activity: false } })
  const preview = await screen(first, true)
  await preview.getByText(a.question.prompt, { exact: true }).waitFor()
  let list = await api('GET', '/displays')
  assert.equal(list.find((d) => d.id === first.id).connected_count, 0)
  report.assertions.push('Preview does not consume a physical screen slot')

  const screens = await Promise.all([screen(first), screen(first), screen(first), screen(second)])
  await Promise.all(screens.map((page, index) => page.getByText(index === 3 ? b.question.prompt : a.question.prompt, { exact: true }).waitFor()))
  await until(async () => { const ds = await api('GET', '/displays'); return ds.find((d) => d.id === first.id).connected_count === 3 && ds.find((d) => d.id === second.id).connected_count === 1 }, 'three mirrored TVs and one independent TV')
  report.assertions.push('Three TVs mirror one activity while a fourth shows a different activity')
  const beforeReads = reads
  const beforeJoins = joins
  const latencies = []
  const started = Date.now()
  const voteCount = Number(process.env.LIVE_TEST_GUESTS || 200)
  for (let offset = 0; offset < voteCount; offset += 20) {
    await Promise.all(Array.from({ length: Math.min(20, voteCount - offset) }, async (_, index) => {
      const begin = Date.now()
      await api('POST', `/activities/${a.id}/respond`, { question_id: a.question.id, selected_option_ids: [a.question.options[0].id], idempotency_key: `answer-${offset + index}` }, token(`guest-${offset + index}`, 'guest'))
      latencies.push(Date.now() - begin)
    }))
  }
  const results = await api('GET', `/activities/${a.id}/results`)
  assert.equal(results.response_count, voteCount)
  await new Promise((r) => setTimeout(r, 2000))
  assert.equal(joins - beforeJoins, 0, 'Votes must not refetch stable join information')
  assert.ok(reads - beforeReads < voteCount, `Display reads ${reads - beforeReads} must be below answer count ${voteCount}`)
  latencies.sort((a, b) => a - b)
  report.load = { guests: voteCount, elapsed_ms: Date.now() - started, answer_p95_ms: latencies[Math.floor(latencies.length * .95)], display_reads: reads - beforeReads, join_refetches: joins - beforeJoins, persisted_answers: results.response_count }
  report.assertions.push('Answer burst persists every answer with bounded screen refreshes and no repeated join-code fetches')

  await api('PATCH', `/displays/${first.id}`, { assigned_activity_id: b.id, scene: 'question', settings: { follow_activity: false } })
  await Promise.all(screens.slice(0, 3).map((page) => page.getByText(b.question.prompt, { exact: true }).waitFor()))
  await api('PATCH', `/displays/${first.id}`, { assigned_activity_id: a.id, scene: 'question' })
  await Promise.all(screens.slice(0, 3).map((page) => page.getByText(a.question.prompt, { exact: true }).waitFor()))
  assert.equal((await api('GET', `/activities/${a.id}/results`)).response_count, voteCount)
  report.assertions.push('Activity A to B to A switches every target TV and preserves recorded answers')

  const removedClient = await screens[0].evaluate(() => sessionStorage.getItem('festioDisplayClientId'))
  await api('POST', `/displays/${first.id}/disconnect`, { client_id: removedClient })
  await screens[0].getByRole('button', { name: 'Reconnect this screen' }).waitFor({ timeout: 15000 })
  await new Promise((r) => setTimeout(r, 6500))
  assert.equal((await api('GET', '/displays')).find((d) => d.id === first.id).connected_count, 2)
  await screens[1].getByText(a.question.prompt, { exact: true }).waitFor()
  await screens[0].getByRole('button', { name: 'Reconnect this screen' }).click()
  await screens[0].getByText(a.question.prompt, { exact: true }).waitFor()
  await new Promise((r) => setTimeout(r, 6500))
  assert.equal((await api('GET', '/displays')).find((d) => d.id === first.id).connected_count, 3, 'Reconnected screen must retain its lease through renewal')
  report.assertions.push('Disconnect removes only the selected TV, remains disconnected, and explicit reconnect works')

  await contexts[2].setOffline(true)
  await api('PATCH', `/displays/${first.id}`, { assigned_activity_id: b.id, scene: 'question' })
  await contexts[2].setOffline(false)
  await screens[1].getByText(b.question.prompt, { exact: true }).waitFor({ timeout: 20000 })
  report.assertions.push('Network recovery catches up to current content')
  await api('PATCH', `/displays/${first.id}`, { assigned_activity_id: null, scene: 'welcome' })
  await until(async () => !(await screens[0].getByText(b.question.prompt, { exact: true }).count()), 'clear content reaches TV')
  report.assertions.push('Clear content reaches TVs without disconnecting them')

  // Presenter uses the real activity API and must render a current question without crashing.
  const context = await browser.newContext(); contexts.push(context)
  const presenter = await context.newPage()
  presenter.on('pageerror', (error) => errors.push(error.message))
  await presenter.goto(`${base}/live-control?token=${token('presenter', 'presenter')}&role=presenter&activity=${a.id}`)
  await presenter.getByText(a.question.prompt, { exact: true }).first().waitFor()
  assert.ok(!errors.some((error) => /secondsRemaining|ReferenceError/.test(error)), errors.join('\n'))
  report.assertions.push('Presenter current-question view renders without the timer ReferenceError')
  await screens[3].screenshot({ path: '/tmp/live-independent-screen.png' })
  assert.deepEqual(errors, [], 'Browser exceptions')
  report.browser_errors = errors
  mkdirSync('/tmp/live-reliability-results', { recursive: true })
  writeFileSync('/tmp/live-reliability-results/browser.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await Promise.all(contexts.map((context) => context.close()))
  await browser.close()
}
