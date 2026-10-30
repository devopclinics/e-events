import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { marketingConsent, signupAttributionHeader, DEMO_REQUEST_RECEIVED, demoRequestAttempt, leadAutomationStatus } from '../src/lib/marketingConsent.mjs'
import { chatWidgetConfig, selectChatSession, widgetUrl, validSupportIdentity, connectChatFrame } from '../src/lib/chatWidget.mjs'

const env = {
  VITE_CHATWOOT_BASE_URL: 'https://support.example.test',
  VITE_CHATWOOT_WEBSITE_TOKEN: 'organizer-inbox',
  VITE_SALES_CHAT_BASE_URL: 'https://sales.example.test',
  VITE_SALES_CHAT_WEBSITE_TOKEN: 'public-sales-inbox',
  VITE_SALES_CHAT_ENABLED: 'true',
  VITE_SALES_CHAT_INBOX_VALIDATED: 'true',
}
const config = chatWidgetConfig(env, 'https://festio.example.test')
const sales = { mode: 'sales', ...config.sales }
const support = { mode: 'support', ...config.support }
const identity = { identifier: 'organizer-1', identifier_hash: 'signed-test-hash', name: 'Test Organizer', email: 'organizer@example.test', org_name: 'Private Org', plan: 'Private Plan' }

test('consent defaults off and only a checked boolean opts into email', () => {
  for (const value of [undefined, null, false, 'true', 'false', 1, {}, []]) {
    assert.deepEqual(marketingConsent(value), { consent_email: false })
  }
  assert.deepEqual(marketingConsent(true), { consent_email: true })
  assert.deepEqual(JSON.parse(decodeURIComponent(signupAttributionHeader(true))), marketingConsent(true))
  assert.deepEqual(JSON.parse(decodeURIComponent(signupAttributionHeader())), marketingConsent(false))
  assert.equal(Object.hasOwn(marketingConsent(true), 'consent_whatsapp'), false)
  assert.equal(Object.hasOwn(marketingConsent(false), 'consent_sms'), false)
})

test('idempotency keys survive unchanged retries but rotate after a payload change', () => {
  let generated = 0
  const newKey = () => `request-${++generated}`
  const body = { email: 'visitor@example.test', consent_email: false }
  const first = demoRequestAttempt(null, body, newKey)
  assert.equal(demoRequestAttempt(first, { ...body }, newKey), first)
  assert.notEqual(demoRequestAttempt(first, { ...body, consent_email: true }, newKey).key, first.key)
  assert.equal(generated, 2)
})

test('CRM prioritizes suppression and human review over misleading ongoing status', () => {
  const lead = { automation: { step: 1, total_steps: 4 }, next_follow_up_at: '2026-12-10T10:00:00Z' }
  for (const blocked of [{ automation_paused: true }, { suppression_reason: 'whatsapp_inbound' }, { handoff_requested_at: '2026-12-09T10:00:00Z' }, { unsubscribed: true }]) {
    assert.equal(leadAutomationStatus({ ...lead, ...blocked }), 'Needs human review')
  }
  assert.equal(leadAutomationStatus({ ...lead, next_follow_up_at: null }), 'No follow-up scheduled')
  assert.match(leadAutomationStatus(lead), /^Scheduled/)
  assert.equal(leadAutomationStatus({ automation: { complete: true } }), 'Complete')
  assert.equal(leadAutomationStatus({}), 'Not enrolled')
})

test('both signup providers use the optional checkbox and normal login does not send signup consent', () => {
  const source = readFileSync(new URL('../src/pages/RegisterPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /\[marketingEmail, setMarketingEmail\] = useState\(false\)/)
  assert.equal(source.match(/signupAttributionHeader\(marketingEmail\)/g).length, 2)
  assert.match(source, /<MarketingEmailConsent checked=\{marketingEmail\}/)
  assert.doesNotMatch(source, /consent_email:\s*true/)
  const context = readFileSync(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(context, /signupAttributionHeader|consent_email|consent_whatsapp/)
})

test('demo forms send explicit opt-in and describe a request, not a booking', () => {
  assert.match(DEMO_REQUEST_RECEIVED, /not confirmed yet/)
  for (const name of ['LandingPage', 'LandingRedesignPage']) {
    const source = readFileSync(new URL(`../src/pages/${name}.jsx`, import.meta.url), 'utf8')
    assert.match(source, /marketingConsent\(marketingEmail\)/)
    assert.match(source, /<MarketingEmailConsent checked=\{marketingEmail\}/)
    assert.match(source, /\{DEMO_REQUEST_RECEIVED\}/)
    assert.doesNotMatch(source, /send a calendar hold|inbox for (the Festio )?confirmation/)
  }
})

test('sales requires both explicit gates and never falls back to the support inbox', () => {
  assert.equal(chatWidgetConfig().sales, null)
  for (const key of ['VITE_SALES_CHAT_ENABLED', 'VITE_SALES_CHAT_INBOX_VALIDATED', 'VITE_SALES_CHAT_BASE_URL', 'VITE_SALES_CHAT_WEBSITE_TOKEN']) {
    assert.equal(chatWidgetConfig({ ...env, [key]: '' }).sales, null, key)
  }
  assert.equal(chatWidgetConfig({ ...env, VITE_SALES_CHAT_ENABLED: 'TRUE' }).sales, null)
  assert.equal(chatWidgetConfig({ ...env, VITE_SALES_CHAT_WEBSITE_TOKEN: env.VITE_CHATWOOT_WEBSITE_TOKEN }).sales, null)
  assert.equal(chatWidgetConfig({ ...env, VITE_SALES_CHAT_BASE_URL: env.VITE_CHATWOOT_BASE_URL }).sales, null)
  assert.equal(chatWidgetConfig({ ...env, VITE_SALES_CHAT_ENABLED: 'false' }).support.websiteToken, env.VITE_CHATWOOT_WEBSITE_TOKEN)
  assert.equal(config.sales.websiteToken, env.VITE_SALES_CHAT_WEBSITE_TOKEN)
})

test('scoped release build environment preserves authenticated support with public sales hard-disabled', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.scoped-release', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const buildArgs = Object.fromEntries([...dockerfile.matchAll(/^ARG (\w+)$/gm)].map(([, name]) => [name, env[name] || 'synthetic-public-value']))
  const compiledEnv = {}
  // Resolve the actual Dockerfile's build-time ENV contract using only public
  // synthetic inputs, with no dotenv, npm configuration, or real inbox access.
  for (const [, assignments] of dockerfile.replace(/\\\n\s*/g, ' ').matchAll(/^ENV (.+)$/gm)) {
    for (const assignment of assignments.split(/\s+/)) {
      const [name, value] = assignment.split('=')
      compiledEnv[name] = value.startsWith('$') ? buildArgs[value.slice(1)] : value
    }
  }
  const releaseConfig = chatWidgetConfig(compiledEnv, 'https://festio.example.test')
  assert.deepEqual(releaseConfig.support, config.support)
  assert.equal(releaseConfig.sales, null)
  assert.equal(compiledEnv.VITE_SALES_CHAT_ENABLED, 'false')
  assert.equal(compiledEnv.VITE_SALES_CHAT_INBOX_VALIDATED, 'false')
  for (const key of ['VITE_SALES_CHAT_BASE_URL', 'VITE_SALES_CHAT_WEBSITE_TOKEN']) assert.equal(Object.hasOwn(buildArgs, key), false)
  const choose = (user, pathname, loading = false) => selectChatSession({ user, pathname, loading, config: releaseConfig })
  assert.deepEqual(choose({ id: 'organizer-1' }, '/admin'), support)
  assert.equal(choose({ id: 'organizer-1' }, '/admin', true), null)
  for (const pathname of ['/', '/pricing', '/login', '/register', '/admin', '/rsvp/private-token']) assert.equal(choose(null, pathname), null)
  for (const pathname of ['/', '/login', '/rsvp/private-token']) assert.equal(choose({ id: 'organizer-1' }, pathname), null)
})

test('authenticated support never falls back to a configured anonymous sales inbox', () => {
  for (const key of ['VITE_CHATWOOT_BASE_URL', 'VITE_CHATWOOT_WEBSITE_TOKEN']) {
    const missingSupport = chatWidgetConfig({ ...env, [key]: '' }, 'https://festio.example.test')
    assert.equal(missingSupport.support, null)
    assert.equal(missingSupport.sales.websiteToken, env.VITE_SALES_CHAT_WEBSITE_TOKEN)
    assert.equal(selectChatSession({ user: { id: 'organizer-1' }, pathname: '/admin', loading: false, config: missingSupport }), null)
  }
})

test('scoped workflow rejects invalid support configuration with the exact frontend parser before publication', () => {
  const workflow = readFileSync(new URL('../../../.github/disabled-workflows/release-engagement.yml', import.meta.url), 'utf8')
  const [, script] = workflow.match(/node --input-type=module -e '([^'\n]+chatWidgetConfig[^'\n]+)'/)
  const cases = [
    [env, true],
    [{ ...env, VITE_CHATWOOT_BASE_URL: '' }, false],
    [{ ...env, VITE_CHATWOOT_WEBSITE_TOKEN: '' }, false],
    [{ ...env, VITE_CHATWOOT_WEBSITE_TOKEN: 'short' }, false],
    ...['http://support.example.test', 'https://support.example.test/path', 'https://[v1.local]',
      'https://xn--a.example.test', 'https://xn--abc.example.test'].map((value) => [{ ...env, VITE_CHATWOOT_BASE_URL: value }, false]),
    [{ ...env, VITE_CHATWOOT_BASE_URL: 'https://xn--caf-dma.example.test' }, true],
  ]
  for (const [syntheticEnv, valid] of cases) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../../../', import.meta.url), env: syntheticEnv, encoding: 'utf8',
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status === 0, valid)
    if (!valid) assert.match(result.stderr, /Missing or invalid public support chat config/)
  }
})

test('unsafe or same-origin widget URLs are rejected before loading', () => {
  for (const url of ['javascript:alert(1)', 'http://chat.example.test', 'https://u:p@chat.example.test', 'https://chat.example.test/path', 'https://chat.example.test/?token=private', 'https://chat.example.test/#data', 'https://festio.example.test']) {
    assert.equal(chatWidgetConfig({ ...env, VITE_SALES_CHAT_BASE_URL: url }, 'https://festio.example.test').sales, null, url)
  }
  assert.equal(chatWidgetConfig({ ...env, VITE_SALES_CHAT_WEBSITE_TOKEN: '"/><script>' }).sales, null)
})

test('only anonymous marketing visitors get public sales, never auth-loading or guest-link routes', () => {
  const choose = (user, pathname, loading = false) => selectChatSession({ user, pathname, loading, config })
  for (const path of ['/', '/pricing', '/register', '/login', '/landing-legacy']) assert.equal(choose(null, path).mode, 'sales')
  assert.equal(choose(null, '/', true), null)
  assert.equal(choose({ id: 'one' }, '/'), null)
  for (const path of ['/scan/private-token', '/rsvp/private-token', '/festiome/guest', '/live/guest', '/tickets', '/unknown']) {
    assert.equal(choose(null, path), null)
    assert.equal(choose({ id: 'one' }, path), null)
  }
  assert.equal(choose(null, '/admin'), null)
  assert.equal(choose({ id: 'one' }, '/admin').mode, 'support')
  assert.equal(choose({ id: 'one' }, '/floor-plan/event-one').mode, 'support')
})

test('every explicit protected App route retains organizer support, including redesign routes', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const paths = [...source.matchAll(/<Route path="([^"]+)" element=\{<ProtectedRoute/g)].map(match => match[1].replace(':eventId', 'event-one'))
  assert.ok(paths.includes('/admin-redesign'))
  assert.ok(paths.includes('/superadmin-redesign'))
  for (const pathname of paths) assert.equal(selectChatSession({ user: { id: 'one' }, loading: false, pathname, config })?.mode, 'support', pathname)
})

test('widget URL contains only the public inbox token, no organizer or conversation context', () => {
  const url = new URL(widgetUrl({ ...sales, ...identity, cw_conversation: 'private-session' }))
  assert.equal(url.pathname, '/widget')
  assert.deepEqual([...url.searchParams], [['website_token', 'public-sales-inbox']])
})

function harness(session = sales, extra = {}) {
  const listeners = new Set()
  const sent = []
  let ready = 0
  let closed = 0
  const frame = { contentWindow: { postMessage: (payload, origin) => sent.push({ message: JSON.parse(payload.slice('chatwoot-widget:'.length)), origin }) } }
  const hostWindow = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  const connection = connectChatFrame({ frame, session, hostWindow, onReady: () => ready++, onClose: () => closed++, ...extra })
  const emit = (message, override = {}) => {
    const event = { data: `chatwoot-widget:${JSON.stringify(message)}`, origin: session.baseUrl, source: frame.contentWindow, ...override }
    for (const receive of listeners) receive(event)
  }
  return { sent, emit, dispose: connection.disconnect, setOpen: connection.setOpen, listeners, frame, ready: () => ready, closed: () => closed }
}

test('anonymous bridge never forwards identity, attributes, cookies, or location even if supplied', () => {
  const h = harness(sales, { identity })
  h.setOpen(true)
  h.emit({ event: 'loaded', config: { authToken: 'private-session' } })
  h.emit({ event: 'setAuthCookie', data: { widgetAuthToken: 'private-session' } })
  h.emit({ event: 'set-user', ...identity })
  assert.deepEqual(h.sent.map(({ message }) => message.event), ['config-set', 'toggle-open'])
  assert.deepEqual(h.sent.at(-1).message, { event: 'toggle-open', isOpen: true })
  assert.ok(h.sent.every(({ origin }) => origin === sales.baseUrl))
  assert.doesNotMatch(JSON.stringify(h.sent), /private-session|organizer-1|Private Org|identifier|email|change-url|referrer/i)
  assert.equal(h.ready(), 1)
  h.dispose()
})

test('support bridge uses only the signed identity and expected organizer fields', () => {
  const h = harness(support, { identity: { ...identity, token: 'firebase-private-token' } })
  h.setOpen(true)
  h.emit({ event: 'loaded' })
  assert.deepEqual(h.sent.map(({ message }) => message.event), ['config-set', 'set-user', 'set-custom-attributes', 'toggle-open'])
  assert.deepEqual(h.sent[1].message, { event: 'set-user', identifier: identity.identifier, user: { identifier_hash: identity.identifier_hash, name: identity.name, email: identity.email } })
  assert.doesNotMatch(JSON.stringify(h.sent), /firebase-private-token/)
  assert.equal(validSupportIdentity({ ...identity, identifier_hash: '' }), false)
  h.dispose()
  const unsigned = harness(support)
  unsigned.setOpen(true)
  unsigned.emit({ event: 'loaded' })
  assert.equal(unsigned.sent.length, 0)
  assert.equal(unsigned.listeners.size, 0)
  unsigned.dispose()
})

const visibility = (h) => h.sent.filter(({ message }) => message.event === 'toggle-open').map(({ message }) => message.isOpen)

test('a newly loaded iframe defaults closed unless the host explicitly opened it', () => {
  const h = harness()
  h.emit({ event: 'loaded' })
  assert.deepEqual(visibility(h), [false])
  h.setOpen(true)
  assert.deepEqual(visibility(h), [false, true])
  h.dispose()
})

test('close before provider load sends the latest hidden state, not the initial launch intent', () => {
  const h = harness()
  h.setOpen(true)
  h.setOpen(false)
  assert.equal(h.sent.length, 0)
  h.emit({ event: 'loaded' })
  assert.deepEqual(visibility(h), [false])
  h.setOpen(true)
  h.emit({ event: 'loaded' })
  assert.deepEqual(visibility(h), [false, true])
  assert.equal(h.ready(), 1)
  assert.equal(h.sent.filter(({ message }) => message.event === 'config-set').length, 1)
  h.dispose()
})

test('several pre-load visibility changes coalesce to the last committed state', () => {
  const h = harness()
  for (const open of [true, false, true, false, true]) h.setOpen(open)
  assert.equal(h.sent.length, 0)
  h.emit({ event: 'loaded' })
  assert.deepEqual(visibility(h), [true])
  h.dispose()
})

test('retained iframe receives close/reopen transitions without reinitializing or sharing identity', () => {
  const h = harness()
  h.setOpen(true)
  h.emit({ event: 'loaded' })
  for (const open of [true, false, false, true, false, true]) h.setOpen(open)
  assert.deepEqual(visibility(h), [true, false, true, false, true])
  assert.equal(h.sent.filter(({ message }) => message.event === 'config-set').length, 1)
  assert.ok(h.sent.every(({ origin }) => origin === sales.baseUrl))
  assert.doesNotMatch(JSON.stringify(h.sent), /identifier|email|org_name|plan|cookie|token|referrer/i)
  h.dispose()
})

for (const event of ['closeWindow', 'closeChat']) {
  test(`provider ${event} callback can commit closed state and reopen the same iframe`, () => {
    let h
    let closed = 0
    h = harness(sales, { onClose: () => { closed++; h.setOpen(false) } })
    h.setOpen(true)
    h.emit({ event: 'loaded' })
    h.emit({ event }, { origin: 'https://attacker.example.test' })
    h.emit({ event }, { source: {} })
    assert.equal(closed, 0)
    assert.deepEqual(visibility(h), [true])
    h.emit({ event })
    assert.equal(closed, 1)
    assert.deepEqual(visibility(h), [true, false])
    h.setOpen(true)
    assert.deepEqual(visibility(h), [true, false, true])
    h.dispose()
  })
}

test('forged, malformed and repeated messages cannot initialize or control another frame', () => {
  const h = harness()
  h.emit({ event: 'loaded' }, { origin: 'https://attacker.example.test' })
  h.emit({ event: 'loaded' }, { source: {} })
  h.emit({}, { data: 'chatwoot-widget:{broken' })
  h.emit({}, { data: 'chatwoot-widget:' + 'x'.repeat(70000) })
  h.emit({ event: 'closeWindow' })
  assert.equal(h.sent.length, 0)
  assert.equal(h.closed(), 0)
  h.emit({ event: 'loaded' })
  h.emit({ event: 'loaded' })
  assert.equal(h.sent.length, 2)
  assert.equal(h.ready(), 1)
  h.emit({ event: 'closeWindow' })
  assert.equal(h.closed(), 1)
  h.dispose()
})

test('route/logout disposal removes handlers and rejects late or previous-session messages', () => {
  const previous = harness(support, { identity })
  previous.setOpen(true)
  previous.dispose()
  previous.emit({ event: 'loaded' })
  assert.equal(previous.listeners.size, 0)
  assert.equal(previous.sent.length, 0)
  const next = harness()
  next.emit({ event: 'loaded' }, { source: previous.frame.contentWindow })
  assert.equal(next.sent.length, 0)
  next.emit({ event: 'loaded' })
  assert.equal(next.sent.length, 2)
  next.dispose()
})

test('disposing an open initialized frame closes it once and rejects even captured stale callbacks', () => {
  const h = harness()
  h.setOpen(true)
  h.emit({ event: 'loaded' })
  const [receive] = h.listeners
  h.dispose()
  assert.deepEqual(visibility(h), [true, false])
  const sentBeforeLateEvents = h.sent.length
  for (const event of ['loaded', 'closeWindow', 'closeChat']) receive({
    origin: sales.baseUrl, source: h.frame.contentWindow, data: `chatwoot-widget:${JSON.stringify({ event })}`,
  })
  h.setOpen(true)
  h.dispose()
  assert.equal(h.sent.length, sentBeforeLateEvents)
  assert.equal(h.closed(), 0)
  assert.equal(h.ready(), 1)
  assert.equal(h.listeners.size, 0)
})

test('disposing an already hidden frame does not resend visibility or keep a listener', () => {
  const h = harness()
  h.emit({ event: 'loaded' })
  h.dispose()
  assert.deepEqual(visibility(h), [false])
  assert.equal(h.listeners.size, 0)
})
