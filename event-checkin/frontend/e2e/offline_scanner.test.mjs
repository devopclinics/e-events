import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/offlineExperienceQueue.js', import.meta.url), 'utf8')
const offline = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
globalThis.window = { dispatchEvent() {} }
globalThis.CustomEvent = class { constructor(type) { this.type = type } }
const manifest = (extra = {}) => ({ version: 2, event_id: 'event-a', event_status: 'active', manual_checkin_enabled: true, generated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1800000).toISOString(), guests: [{ id: 'guest-a', first_name: 'Demo', last_name: 'Guest', qr_token: 'pass-a', admitted: false, rsvp_status: 'confirmed' }], ...extra })
const scan = (value = manifest()) => offline.recordOfflineScan({ eventId: 'event-a', token: 'pass-a', manifest: value })
beforeEach(() => storage.clear())

test('local check-in, repeat scan and cache refresh retain one pending admission', () => {
  assert.equal(scan().result.status, 'offline_queued')
  assert.equal(scan().result.status, 'already_admitted')
  const saved = offline.saveOfflineManifest('event-a', manifest())
  assert.equal(saved.guests[0].admitted, true)
  assert.equal(offline.offlineAdmissionCount('event-a'), 1)
})
for (const [label, value] of [
  ['another event', { event_id: 'event-b' }], ['old schema', { version: 1 }],
  ['missing expiry', { expires_at: undefined }], ['invalid expiry', { expires_at: 'invalid' }],
  ['expired', { expires_at: '2020-01-01T00:00:00Z' }], ['inactive', { event_status: 'ended' }],
  ['consent check', { offline_admission_block_reason: 'Consent requires online verification.' }],
]) test(`refuses offline admission with ${label}`, () => {
  assert.equal(scan(manifest(value)).result.status, 'invalid')
  assert.equal(offline.offlineAdmissionCount(), 0)
})
test('cancelled pass and live seating cannot be bypassed', () => {
  for (const extra of [{ rsvp_status: 'declined' }, { offline_admission_block_reason: 'Seat requires online assignment.' }]) {
    const value = manifest(); Object.assign(value.guests[0], extra)
    assert.equal(scan(value).result.status, 'invalid')
  }
  assert.equal(offline.offlineAdmissionCount(), 0)
})
test('guardian handoff cannot be queued', () => {
  const response = offline.recordOfflineScan({ eventId: 'event-a', token: 'pass-a', manifest: manifest({ junior_guardian_handoff_enabled: true }), mode: 'zone', zoneId: 'junior' })
  assert.match(response.result.message, /Guardian handoffs require/)
  assert.equal(offline.offlineAdmissionCount(), 0)
})
test('manual lookup uses only the prepared event and obeys the manual setting', () => {
  offline.saveOfflineManifest('event-a', manifest())
  assert.equal(offline.searchOfflineGuests('event-a', 'Demo')[0].full_name, 'Demo Guest')
  assert.throws(() => offline.searchOfflineGuests('event-b', 'Demo'), /Prepare/)
  offline.saveOfflineManifest('event-a', manifest({ manual_checkin_enabled: false }))
  assert.throws(() => offline.searchOfflineGuests('event-a', 'Demo'), /disabled/)
})
test('HTTP 200 denial stays visible; automatic retry skips it; explicit retry resolves it', async () => {
  scan()
  let calls = 0
  const api = { scan: async () => { calls++; return { status: 'pending_required_step', message: 'Complete consent' } } }
  await offline.drainOfflineAdmissions(api, 'event-a')
  assert.equal(offline.offlineAdmissionItems('event-a')[0].syncStatus, 'needs_review')
  assert.equal(offline.offlineAdmissionItems('event-a')[0].lastError, 'Complete consent')
  assert.equal(scan().result.status, 'invalid')
  assert.match(scan().result.message, /needs staff review/)
  await offline.drainOfflineAdmissions(api, 'event-a')
  assert.equal(calls, 1)
  await offline.drainOfflineAdmissions({ scan: async () => ({ status: 'already_admitted' }) }, 'event-a', { retryRejected: true })
  assert.equal(offline.offlineAdmissionCount(), 0)
})
test('scans added during an upload survive; simultaneous drains send only once', async () => {
  scan()
  let finish, calls = 0
  const api = { scan: () => { calls++; return new Promise((resolve) => { finish = resolve }) } }
  const first = offline.drainOfflineAdmissions(api, 'event-a')
  const second = offline.drainOfflineAdmissions(api, 'event-a')
  offline.enqueueOfflineAdmission({ eventId: 'event-a', token: 'pass-b', guestId: 'guest-b', guestName: 'Second Guest' })
  finish({ status: 'admitted' })
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.deepEqual(offline.offlineAdmissionItems('event-a').map((item) => item.token), ['pass-b'])
})
test('network interruption retains records; retry is event scoped', async () => {
  scan()
  offline.enqueueOfflineAdmission({ eventId: 'event-b', token: 'other-pass' })
  await offline.drainOfflineAdmissions({ scan: async () => { throw new TypeError('Failed to fetch') } }, 'event-a')
  assert.equal(offline.offlineAdmissionItems('event-a')[0].syncStatus, 'pending')
  const uploaded = []
  await offline.drainOfflineAdmissions({ scan: async (token) => { uploaded.push(token); return { status: 'admitted' } } }, 'event-a')
  assert.deepEqual(uploaded, ['pass-a'])
  assert.equal(offline.offlineAdmissionCount('event-b'), 1)
})
test('storage exhaustion never returns a successful offline admission', () => {
  const original = localStorage.setItem
  localStorage.setItem = () => { throw new Error('Quota exceeded') }
  try { assert.throws(() => scan(), /Quota exceeded/) }
  finally { localStorage.setItem = original }
  assert.equal(offline.offlineAdmissionCount(), 0)
})
test('zone acknowledgement accepts the existing ok response and preserves denials', async () => {
  offline.enqueueOfflineAccessScan({ eventId: 'event-a', token: 'pass-a', mode: 'zone', zoneId: 'zone-a', direction: 'in' })
  await offline.drainOfflineAdmissions({ scanZone: async () => ({ status: 'ok', denied: false }) }, 'event-a')
  assert.equal(offline.offlineAdmissionCount(), 0)
  offline.enqueueOfflineAccessScan({ eventId: 'event-a', token: 'pass-a', mode: 'zone', zoneId: 'zone-a', direction: 'in' })
  await offline.drainOfflineAdmissions({ scanZone: async () => ({ status: 'denied', denied: true, deny_reason: 'Zone full' }) }, 'event-a')
  assert.equal(offline.offlineAdmissionItems('event-a')[0].lastError, 'Zone full')
})

test('experience actions updated during synchronization are not discarded', async () => {
  const action = { eventId: 'event-a', guestId: 'guest-a', stepId: 'step', payload: { status: 'completed' } }
  offline.enqueueExperienceStep(action)
  let finish
  const drain = offline.drainExperienceQueue({ updateGuestExperienceStep: () => new Promise((resolve) => { finish = resolve }) }, 'event-a')
  offline.enqueueExperienceStep({ ...action, payload: { status: 'pending' } })
  finish({ status: 'completed' })
  await drain
  assert.equal(offline.experienceQueueCount('event-a'), 1)
  const remaining = []
  await offline.drainExperienceQueue({ updateGuestExperienceStep: async (...args) => { remaining.push(args[3]); return { status: 'pending' } } }, 'event-a')
  assert.deepEqual(remaining, [{ status: 'pending' }])
  assert.equal(offline.experienceQueueCount('event-a'), 0)
})
