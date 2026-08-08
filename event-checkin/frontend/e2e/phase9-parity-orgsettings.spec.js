import { test, expect } from '@playwright/test'
import {
  firebaseAccessToken,
  signIn,
} from './helpers.js'

// Org Settings (API keys + outbound webhooks) is NOT a tab inside
// AdminPage.jsx — it's org-scoped (not event-scoped), so it lives on its own
// route: legacy = OrgSettingsPage.jsx at /org-settings, redesign = the "Org
// Settings" sub-tab of BillingRedesignPage.jsx at /billing-redesign?tab=org
// (confirmed by reading both files directly; AdminPage.jsx only contains a
// one-line pointer to "Org Settings -> API Keys", no actual UI). /org-settings
// is wrapped in <RedesignGate redesignRoute="/billing-redesign">, and this QA
// org is on a redesign-default cohort, so it must be visited with the
// `?ui=legacy` escape hatch (see RedesignGate.jsx) or it silently redirects
// to the redesign route before any legacy markup ever renders.
//
// Both API keys and webhooks are minted per-organization, independent of any
// specific event, so this file never touches E2E_EVENT_ID data at all. Note
// this also means the usual helpers.js `expectQaEventLoaded` check does NOT
// apply here (confirmed by running first, not assumed): neither
// OrgSettingsPage.jsx nor BillingRedesignPage.jsx's org tab render the
// current event's name anywhere -- both replace/omit the event-name
// breadcrumb since the page isn't about any one event. This file uses its
// own page-loaded assertions (the panel headings) instead.

test.describe.configure({ mode: 'serial' })

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

// API keys are a security-audit-trail resource: DELETE /api-keys/{id} is a
// soft "revoke" (sets revoked_at) with no hard-delete endpoint anywhere in
// the backend (grepped api_keys.py and every other router) -- the same
// pattern GitHub/Stripe use for personal access tokens. The full secret is
// deliberately shown only once, at creation, and never again, so it isn't
// part of the "same persisted contract" comparison; what's comparable and
// stable across both UIs is scope, prefix format, created_at presence, and
// revoked state.
function apiKeyContract(key) {
  return {
    scope: key.scope,
    keyPrefixLooksValid: typeof key.key_prefix === 'string'
      && key.key_prefix.startsWith('fk_live_')
      && key.key_prefix.length === 16,
    hasCreatedAt: !!key.created_at,
    revoked: !!key.revoked_at,
  }
}

function webhookContract(hook) {
  return {
    eventTypes: [...(hook.event_types || [])].sort(),
    isActive: !!hook.is_active,
    hasCreatedAt: !!hook.created_at,
  }
}

async function authHeaders(page) {
  const token = await firebaseAccessToken(page)
  expect(token, 'Firebase session should expose an access token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

// Every panel on OrgSettingsPage.jsx (ApiKeysPanel/WebhooksPanel/etc.) shares
// the exact same wrapper className, so a heading alone doesn't disambiguate
// between panels -- walk up from the (unique) heading text to the nearest
// ancestor carrying that wrapper's specific class combination instead.
function legacyPanel(page, headingText) {
  return page.getByRole('heading', { name: headingText, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl") and contains(@class,"shadow") and contains(@class,"p-6")]')
}

function redesignPanel(page, headingText) {
  return page.locator('.rr-panel').filter({
    has: page.getByRole('heading', { name: headingText, exact: true }),
  }).first()
}

// Org Settings is org-scoped, not event-scoped -- expectQaEventLoaded (which
// checks for the current event's name) doesn't apply here (verified live:
// neither page renders it). Assert the page-specific h1 instead.
async function expectLegacyOrgSettingsLoaded(page) {
  await expect(page.getByRole('heading', { name: 'Organization Settings', exact: true })).toBeVisible()
}
async function expectRedesignOrgSettingsLoaded(page) {
  await expect(page.getByRole('heading', { name: 'Org Settings' })).toBeVisible()
}

test.describe('Phase 9 legacy/redesign persisted-state parity — Org Settings (API keys + webhooks)', () => {
  test('API key creation and revocation produce the same persisted contract', async ({ page, request }) => {
    test.setTimeout(60000)
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    try {
      // ── Legacy: create ──────────────────────────────────────────────
      await page.goto('/org-settings?ui=legacy')
      await expectLegacyOrgSettingsLoaded(page)
      const legacyKeyName = `Parity Legacy Key ${run}`
      const legacyKeysPanel = legacyPanel(page, 'API Keys')
      await legacyKeysPanel.getByPlaceholder('e.g. Zapier integration').fill(legacyKeyName)
      const legacyCreateResponse = page.waitForResponse((r) =>
        r.request().method() === 'POST'
        && r.url().endsWith('/api/organizations/me/api-keys')
      )
      await legacyKeysPanel.getByRole('button', { name: 'Create key', exact: true }).click()
      const legacyKey = await (await legacyCreateResponse).json()
      createdIds.push(legacyKey.id)
      expect(legacyKey.key, 'legacy create response should reveal the full key once').toMatch(/^fk_live_/)

      // ── Redesign: create ─────────────────────────────────────────────
      await page.goto('/billing-redesign?tab=org')
      await expectRedesignOrgSettingsLoaded(page)
      const redesignKeyName = `Parity Redesign Key ${run}`
      const redesignKeysPanel = redesignPanel(page, 'API Keys')
      await redesignKeysPanel.getByRole('button', { name: 'Create new key', exact: true }).click()
      await redesignKeysPanel.getByPlaceholder('e.g. Zapier integration').fill(redesignKeyName)
      const redesignCreateResponse = page.waitForResponse((r) =>
        r.request().method() === 'POST'
        && r.url().endsWith('/api/organizations/me/api-keys')
      )
      await redesignKeysPanel.getByRole('button', { name: 'Create key', exact: true }).click()
      const redesignKey = await (await redesignCreateResponse).json()
      createdIds.push(redesignKey.id)
      expect(redesignKey.key, 'redesign create response should reveal the full key once').toMatch(/^fk_live_/)

      expect(apiKeyContract(redesignKey)).toEqual(apiKeyContract(legacyKey))

      // ── Legacy: revoke (native window.confirm(), not a modal) ────────
      await page.goto('/org-settings?ui=legacy')
      await expectLegacyOrgSettingsLoaded(page)
      const legacyRow = legacyPanel(page, 'API Keys').getByText(legacyKeyName, { exact: false })
        .locator('xpath=ancestor::div[contains(@class,"py-2.5") and contains(@class,"flex")]')
      await expect(legacyRow).toBeVisible()
      page.once('dialog', (dialog) => dialog.accept())
      const legacyRevokeResponse = page.waitForResponse((r) =>
        r.request().method() === 'DELETE'
        && r.url().endsWith(`/api/organizations/me/api-keys/${legacyKey.id}`)
      )
      await legacyRow.getByRole('button', { name: 'Revoke', exact: true }).click()
      expect((await legacyRevokeResponse).status()).toBe(204)
      // Legacy's own re-render: no dedicated "Revoked" badge, just a
      // " · revoked" suffix appended inline to the existing meta line.
      await expect(legacyRow.getByText('revoked', { exact: false })).toBeVisible()

      // ── Redesign: revoke (in-app ConfirmDialog modal) ─────────────────
      await page.goto('/billing-redesign?tab=org')
      await expectRedesignOrgSettingsLoaded(page)
      const redesignRow = page.locator('.bl-list-row').filter({ hasText: redesignKeyName })
      await expect(redesignRow).toBeVisible()
      await redesignRow.getByRole('button', { name: 'Revoke', exact: true }).click()
      const redesignRevokeResponse = page.waitForResponse((r) =>
        r.request().method() === 'DELETE'
        && r.url().endsWith(`/api/organizations/me/api-keys/${redesignKey.id}`)
      )
      await page.locator('.rr-modal').getByRole('button', { name: 'Revoke', exact: true }).click()
      expect((await redesignRevokeResponse).status()).toBe(204)
      await expect(redesignRow.getByText('Revoked', { exact: true })).toBeVisible()

      // ── Persisted-state verification (DELETE returns 204/no body, so
      // re-fetch the list the way phase9-parity-core.spec.js does) ──────
      const persisted = await request.get('/api/organizations/me/api-keys', { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      const persistedLegacy = rows.find((k) => k.id === legacyKey.id)
      const persistedRedesign = rows.find((k) => k.id === redesignKey.id)
      expect(persistedLegacy, 'legacy key should still exist, now revoked').toBeTruthy()
      expect(persistedRedesign, 'redesign key should still exist, now revoked').toBeTruthy()
      expect(persistedLegacy.revoked_at).toBeTruthy()
      expect(persistedRedesign.revoked_at).toBeTruthy()
      expect(apiKeyContract(persistedRedesign)).toEqual(apiKeyContract(persistedLegacy))
    } finally {
      // Revoke is the only lifecycle-terminal action the product exposes for
      // API keys (by design -- no hard-delete endpoint exists). The UI steps
      // above already revoke both fixtures; these calls are a belt-and-braces
      // guarantee that happens even if an assertion above threw first, so no
      // *active* synthetic key is ever left behind. The revoked row itself is
      // expected to persist permanently as an audit record, same as a
      // revoked GitHub/Stripe token -- that is not "leftover data", it's the
      // intended terminal state.
      for (const id of createdIds) {
        await request.delete(`/api/organizations/me/api-keys/${id}`, { headers })
      }
    }
  })

  test('webhook creation and deletion produce the same persisted contract', async ({ page, request }) => {
    test.setTimeout(60000)
    const run = suffix()
    await signIn(page)
    const headers = await authHeaders(page)
    const createdIds = []

    try {
      // ── Legacy: create ──────────────────────────────────────────────
      const legacyUrl = `https://example.test/parity-webhook-legacy-${run}`
      await page.goto('/org-settings?ui=legacy')
      await expectLegacyOrgSettingsLoaded(page)
      const legacyWebhooksPanel = legacyPanel(page, 'Webhooks')
      await legacyWebhooksPanel.getByRole('button', { name: '+ Add webhook', exact: true }).click()
      await legacyWebhooksPanel.getByPlaceholder('https://your-app.example.com/webhooks/festio').fill(legacyUrl)
      // Legacy starts with zero event types selected (redesign pre-selects
      // the first one) -- must explicitly pick one or the submit is disabled.
      await legacyWebhooksPanel.getByRole('button', { name: 'guest.created', exact: true }).click()
      const legacyCreateResponse = page.waitForResponse((r) =>
        r.request().method() === 'POST'
        && r.url().endsWith('/api/organizations/me/webhooks')
      )
      await legacyWebhooksPanel.getByRole('button', { name: 'Create', exact: true }).click()
      const legacyHook = await (await legacyCreateResponse).json()
      createdIds.push(legacyHook.id)
      expect(legacyHook.secret, 'legacy create response should reveal the signing secret once').toBeTruthy()

      // ── Redesign: create ─────────────────────────────────────────────
      const redesignUrl = `https://example.test/parity-webhook-redesign-${run}`
      await page.goto('/billing-redesign?tab=org')
      await expectRedesignOrgSettingsLoaded(page)
      const redesignWebhooksPanel = redesignPanel(page, 'Webhooks')
      await redesignWebhooksPanel.getByRole('button', { name: 'Add webhook', exact: true }).click()
      await redesignWebhooksPanel.getByPlaceholder('https://your-app.com/webhooks/festio').fill(redesignUrl)
      // Redesign's form defaults with WEBHOOK_EVENT_TYPES[0] ("guest.created")
      // already checked, so no explicit event-type selection needed here.
      const redesignCreateResponse = page.waitForResponse((r) =>
        r.request().method() === 'POST'
        && r.url().endsWith('/api/organizations/me/webhooks')
      )
      await redesignWebhooksPanel.getByRole('button', { name: 'Create webhook', exact: true }).click()
      const redesignHook = await (await redesignCreateResponse).json()
      createdIds.push(redesignHook.id)
      expect(redesignHook.secret, 'redesign create response should reveal the signing secret once').toBeTruthy()

      expect(webhookContract(redesignHook)).toEqual(webhookContract(legacyHook))

      // ── Legacy: view deliveries (empty), then delete via native confirm() ──
      await page.goto('/org-settings?ui=legacy')
      await expectLegacyOrgSettingsLoaded(page)
      const legacyRow = legacyPanel(page, 'Webhooks').getByText(legacyUrl, { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"py-2.5")]').first()
      await expect(legacyRow).toBeVisible()
      await legacyRow.getByRole('button', { name: 'View deliveries', exact: true }).click()
      await expect(legacyRow.getByText('No deliveries yet.', { exact: true })).toBeVisible()
      page.once('dialog', (dialog) => dialog.accept())
      const legacyDeleteResponse = page.waitForResponse((r) =>
        r.request().method() === 'DELETE'
        && r.url().endsWith(`/api/organizations/me/webhooks/${legacyHook.id}`)
      )
      await legacyRow.getByRole('button', { name: 'Delete', exact: true }).click()
      expect((await legacyDeleteResponse).status()).toBe(204)
      await expect(legacyPanel(page, 'Webhooks').getByText(legacyUrl, { exact: true })).toHaveCount(0)

      // ── Redesign: view deliveries (empty), then delete via modal ─────
      await page.goto('/billing-redesign?tab=org')
      await expectRedesignOrgSettingsLoaded(page)
      const redesignRow = page.locator('.bl-list-row').filter({ hasText: redesignUrl })
      await expect(redesignRow).toBeVisible()
      await redesignRow.getByRole('button', { name: 'View deliveries', exact: true }).click()
      await expect(redesignRow.getByText('No deliveries yet', { exact: true })).toBeVisible()
      await redesignRow.getByRole('button', { name: 'Delete', exact: true }).click()
      const redesignDeleteResponse = page.waitForResponse((r) =>
        r.request().method() === 'DELETE'
        && r.url().endsWith(`/api/organizations/me/webhooks/${redesignHook.id}`)
      )
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      expect((await redesignDeleteResponse).status()).toBe(204)
      await expect(page.getByText(`Deleted webhook ${redesignUrl}`, { exact: true })).toBeVisible()

      // ── Persisted-state verification: both hard-deleted, neither in the list ──
      const persisted = await request.get('/api/organizations/me/webhooks', { headers })
      expect(persisted.ok()).toBeTruthy()
      const rows = await persisted.json()
      expect(rows.some((w) => w.id === legacyHook.id)).toBeFalsy()
      expect(rows.some((w) => w.id === redesignHook.id)).toBeFalsy()
    } finally {
      for (const id of createdIds) {
        await request.delete(`/api/organizations/me/webhooks/${id}`, { headers })
      }
    }
  })
})
