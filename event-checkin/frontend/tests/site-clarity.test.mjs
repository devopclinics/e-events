import test from 'node:test'
import assert from 'node:assert/strict'
import { safeWebsiteLink, designPublication, websitePublication } from '../src/pages/guestSurfaceStatus.mjs'
import { workspaceContext } from '../src/pages/redesign/workspaceContext.mjs'
import { createAcquisitionHarness } from './helpers/signup-acquisition-harness.mjs'

test('website destinations reject unsafe protocols, control characters, credentials and scheme-relative URLs', () => {
  for (const value of ['javascript:alert(1)', '//evil.test', 'https://user:password@host.test', 'https://safe.test/\npath', '/site/\\evil']) assert.equal(safeWebsiteLink(value), null, value)
  assert.equal(safeWebsiteLink('/site/my-event'), '/site/my-event')
  assert.equal(safeWebsiteLink('https://organizer.example/event'), 'https://organizer.example/event')
})
test('publication status distinguishes unavailable, draft, published and outdated source', () => {
  assert.match(designPublication(null), /unavailable/)
  assert.equal(designPublication({ is_published: false }), 'Not published')
  assert.match(designPublication({ is_published: true, published_version: 4 }), /version 4/)
  assert.match(websitePublication({ published_release_id: 'release', published_version: 3, live_release_outdated: true }), /source changes/)
})
test('organisation settings never claim to be selected-event billing', () => {
  assert.equal(workspaceContext('/billing-redesign', '?tab=org')[0], 'Organisation')
  assert.equal(workspaceContext('/billing-redesign', '?tab=billing')[0], 'Billing')
  assert.match(workspaceContext('/guest-services')[2], /separate records/)
})
function allText(tree) { return JSON.stringify(tree) }
for (const resetError of [null, 'auth/user-not-found']) test(`password reset keeps account existence private: ${resetError}`, async () => {
  const h = createAcquisitionHarness({ href: 'https://festio.example.test/login', resetError })
  const result = await h.recoverPassword('person@example.test')
  assert.deepEqual(h.passwordResets, ['person@example.test'])
  assert.match(allText(result), /If this address has an email\/password account/)
  assert.equal(h.requests.length, 0)
})
test('password recovery surfaces a retryable failure rather than pretending delivery', async () => {
  const h = createAcquisitionHarness({ href: 'https://festio.example.test/login', resetError: 'auth/network-request-failed' })
  const result = await h.recoverPassword('person@example.test')
  assert.match(allText(result), /reset request could not be completed/)
})

import { legacyDestination } from '../src/pages/redesign/legacyDestination.mjs'
test('legacy redirects retain event/tab context and canonical task destination', () => {
  assert.equal(legacyDestination('/team-redesign?tab=mytasks', '?event=A&tab=team&returnTo=https://evil.test&action=delete', '#task'), '/team-redesign?tab=mytasks&event=A#task')
  assert.equal(legacyDestination('/guests-redesign', '?event=A&tab=invite'), '/guests-redesign?event=A&tab=invite')
  assert.equal(legacyDestination('/admin-redesign', '?event=A&event=B'), '/admin-redesign?event=A&event=B')
})
