import test from 'node:test'
import assert from 'node:assert/strict'
import { acquisitionFields } from '../src/lib/acquisitionAttribution.mjs'
import { createAcquisitionHarness, requestAttribution } from './helpers/signup-acquisition-harness.mjs'

const href = 'https://festio.example.test/register?utm_source=partner&utm_medium=email&utm_campaign=autumn'
const referrer = 'https://partner.example.test/events'
const acquisition = { source: 'partner', medium: 'email', campaign: 'autumn', referrer, landing_page: href }

for (const provider of ['password', 'google']) for (const order of ['listener-first', 'signup-first']) for (const optIn of [false, true]) {
  test(`${provider} ${order}: both initial auth requests retain acquisition; only checkbox request carries consent ${optIn}`, async () => {
    const h = createAcquisitionHarness({ href, referrer, order, stored: { consent_email: !optIn, consent_whatsapp: true } })
    await h.signup(provider, optIn)
    const authRequests = h.requests.filter(request => request.url === '/api/auth/me')
    assert.equal(authRequests.length, 2)
    assert.deepEqual(authRequests.map(request => request.headers.Authorization), order === 'listener-first'
      ? ['Bearer listener-token', 'Bearer signup-token'] : ['Bearer signup-token', 'Bearer listener-token'])
    for (const request of authRequests) {
      assert.deepEqual(requestAttribution(request), request.headers.Authorization === 'Bearer signup-token'
        ? { ...acquisition, consent_email: optIn } : acquisition)
    }
    // A later ordinary API request cannot replay the checkbox, nor replace the
    // immutable registration's acquisition with the destination page URL.
    h.hostWindow.location = new URL('https://festio.example.test/admin?utm_source=other')
    await h.apiRequest()
    assert.deepEqual(requestAttribution(h.requests.at(-1)), acquisition)
    assert.equal(JSON.parse(h.storage.getItem('festioMarketingAttribution')).consent_email, undefined)
  })
}

for (const provider of ['password', 'google', 'sso']) for (const order of ['listener-first', 'signup-first']) {
  test(`${provider} ordinary login ${order} never replays stored consent`, async () => {
    const h = createAcquisitionHarness({
      href: 'https://festio.example.test/login', order,
      stored: { ...acquisition, consent_email: true, consent_sms: true, consent_whatsapp: true, private_data: 'ignored' },
    })
    await h.login(provider)
    await h.apiRequest()
    assert.equal(h.requests.filter(request => request.url === '/api/auth/me').length, 2)
    assert.ok(h.requests.every(request => JSON.stringify(requestAttribution(request)) === JSON.stringify(acquisition)))
  })
}

test('prior landing data reaches auth before api.js loads, and signup checkbox overrides stored consent', async () => {
  const h = createAcquisitionHarness({ stored: { ...acquisition, consent_email: true, consent_whatsapp: true } })
  await h.signup('password', false)
  assert.deepEqual(requestAttribution(h.requests[0]), acquisition)
  assert.deepEqual(requestAttribution(h.requests[1]), { ...acquisition, consent_email: false })
  await h.apiRequest()
  assert.deepEqual(requestAttribution(h.requests[2]), acquisition)
})

test('blocked storage does not lose current landing attribution or break auth', async () => {
  const h = createAcquisitionHarness({ href, referrer, storageUnavailable: true })
  await h.signup('google', true)
  await h.apiRequest()
  assert.deepEqual(h.requests.map(requestAttribution), [acquisition, { ...acquisition, consent_email: true }, acquisition])
})

for (const stored of ['{broken', 'null', '[]', 'true', '{"consent_email":true}', '{"source":5,"campaign":[],"medium":null}']) {
  test(`malformed or consent-only storage (${stored}) never grants consent or breaks normal requests`, async () => {
    const h = createAcquisitionHarness({ stored })
    await h.emitUser()
    await h.apiRequest()
    assert.ok(h.requests.every(request => !Object.hasOwn(request.headers, 'X-Festio-Attribution')))
    await h.signup('google', false)
    assert.deepEqual(requestAttribution(h.requests.at(-1)), { consent_email: false })
  })
}

test('partial stored attribution preserves only present, valid acquisition fields', async () => {
  const h = createAcquisitionHarness({ stored: { campaign: 'autumn', referrer, source: 5, medium: '', consent_email: true } })
  await h.signup('password', true)
  assert.deepEqual(h.requests.map(requestAttribution), [
    { campaign: 'autumn', referrer }, { campaign: 'autumn', referrer, consent_email: true },
  ])
})

for (const query of ['utm_medium=social', 'utm_campaign=launch', 'ref=partner-code']) {
  test(`partial landing ${query} is captured before auth`, async () => {
    const url = `https://festio.example.test/register?${query}`
    const h = createAcquisitionHarness({ href: url })
    await h.emitUser()
    const fields = requestAttribution(h.requests[0])
    assert.equal(fields.source, query.startsWith('ref=') ? 'referral' : 'website')
    assert.equal(fields.landing_page, url)
    assert.equal(Object.hasOwn(fields, 'consent_email'), false)
  })
}

test('acquisition fields match Marketing limits and ignore non-string, unknown, and consent fields', () => {
  const raw = Object.fromEntries(['source', 'medium', 'campaign', 'referrer', 'landing_page'].map(key => [key, 'x'.repeat(600)]))
  const fields = acquisitionFields({ ...raw, consent_email: true, consent_sms: false, unknown: 'ignored' })
  assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.length])), {
    source: 100, medium: 100, campaign: 160, referrer: 500, landing_page: 500,
  })
  for (const input of [null, [], true, 'invalid']) assert.deepEqual(acquisitionFields(input), {})
})

test('Unicode and malformed surrogate values stay within backend header budget, including explicit consent', async () => {
  const stored = Object.fromEntries(['source', 'medium', 'campaign', 'referrer', 'landing_page'].map(key => [key, '😀'.repeat(600)]))
  const h = createAcquisitionHarness({ stored })
  await h.signup('google', true)
  for (const request of h.requests) {
    assert.ok(request.headers['X-Festio-Attribution'].length < 10000)
    const fields = requestAttribution(request)
    assert.equal(Array.from(fields.source).length, 100)
    assert.equal(Array.from(fields.campaign).length, 160)
  }
  const malformed = createAcquisitionHarness({ stored: { source: '\uD800', campaign: '\uDC00'.repeat(600) } })
  await malformed.signup('google', false)
  assert.equal(requestAttribution(malformed.requests[1]).consent_email, false)
})
