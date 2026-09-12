import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedJoinCode, createLiveRefresh, reconnectDelay } from '../src/lib/liveRefresh.mjs'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a burst of 100 answers produces one refresh', async () => {
  let calls = 0
  const pump = createLiveRefresh(async () => { calls++ }, { delayMs: 10 })
  for (let i = 0; i < 100; i++) pump.request()
  await sleep(40)
  assert.equal(calls, 1)
  pump.dispose()
})

test('host command invalidates slow results and queues an immediate fresh read without overlap', async () => {
  let unblock
  let calls = 0
  let active = 0
  let peak = 0
  const rendered = []
  const pump = createLiveRefresh(async ({ isCurrent }) => {
    const id = ++calls
    peak = Math.max(peak, ++active)
    if (id === 1) await new Promise((resolve) => { unblock = resolve })
    if (isCurrent()) rendered.push(id)
    active--
  }, { delayMs: 200 })
  pump.request(true)
  await sleep(10)
  for (let i = 0; i < 100; i++) pump.request()
  pump.request(true)
  unblock()
  await sleep(30)
  assert.equal(peak, 1)
  assert.deepEqual(rendered, [2])
  pump.dispose()
})

test('disposal prevents late state writes and queued refreshes', async () => {
  let finish
  let rendered = false
  const pump = createLiveRefresh(async ({ isCurrent }) => {
    await new Promise((resolve) => { finish = resolve })
    rendered = isCurrent()
  })
  pump.request(true)
  await sleep(10)
  pump.request()
  pump.dispose()
  finish()
  await sleep(10)
  assert.equal(rendered, false)
})

test('failed read recovers and does not leave the scheduler locked', async () => {
  let calls = 0
  let errors = 0
  const pump = createLiveRefresh(async () => { if (++calls === 1) throw new Error('offline') }, { delayMs: 5, onError: () => { errors++ } })
  pump.request(true); await sleep(15)
  pump.request(true); await sleep(15)
  assert.equal(calls, 2); assert.equal(errors, 1)
  pump.dispose()
})

test('event join code shares in-flight fetch and remains scoped per event', async () => {
  let calls = 0
  const fetcher = async (url) => { calls++; await sleep(5); return { ok: true, json: async () => ({ code: url.includes('event-a') ? 'AAA' : 'BBB' }) } }
  const codes = await Promise.all(Array.from({ length: 50 }, () => cachedJoinCode('event-a', fetcher)))
  assert.ok(codes.every((code) => code === 'AAA'))
  assert.equal(calls, 1)
  assert.equal(await cachedJoinCode('event-b', fetcher), 'BBB')
  assert.equal(calls, 2)
})

test('retries increase and are bounded, with jitter', () => {
  assert.equal(reconnectDelay(0, () => 0.5), 1000)
  assert.equal(reconnectDelay(4, () => 0.5), 16000)
  assert.equal(reconnectDelay(100, () => 0.5), 30000)
  assert.notEqual(reconnectDelay(2, () => 0), reconnectDelay(2, () => 1))
})
