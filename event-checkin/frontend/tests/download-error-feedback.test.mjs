import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('guest downloads retain permission and server errors without creating a download', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'download-errors-')), file = join(dir, 'api.mjs')
  const oldFetch = globalThis.fetch
  globalThis.__downloadTestAuth = { currentUser: { getIdToken: async () => 'fixture-token' } }
  t.after(async () => { globalThis.fetch = oldFetch; delete globalThis.__downloadTestAuth; await rm(dir, { recursive: true, force: true }) })
  await build({ entryPoints: ['src/api.js'], bundle: true, platform: 'node', format: 'esm', outfile: file, define: { 'import.meta.env': '{}' }, plugins: [{ name: 'firebase-fixture', setup(b) {
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'firebase', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const auth=globalThis.__downloadTestAuth', loader: 'js' }))
  } }] })
  const { api } = await import(pathToFileURL(file))
  for (const [status, body, message] of [
    [403, { detail: "You don't have permission to manage guests for this event." }, /permission to manage guests/],
    [403, { detail: { message: 'Event access is restricted' } }, /Event access is restricted/],
    [403, {}, /permission to download/],
    [401, {}, /session has expired/],
    [404, { detail: 'Event not found' }, /Event not found/],
    [502, '<html>Gateway failure</html>', /HTTP 502/],
    [500, { detail: '  ' }, /HTTP 500/],
  ]) await t.test(`${status}: ${message}`, async () => {
    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/guests\/export\?fmt=xlsx/)
      assert.equal(options.headers.Authorization, 'Bearer fixture-token')
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }
    await assert.rejects(api.downloadGuestList('fixture-event', 'xlsx', 'guests'), error => error.status === status && message.test(error.message))
  })
})
