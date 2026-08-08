import { test, expect } from '@playwright/test'
import { axeSeriousViolations, expectQaEventLoaded, fieldNear, formatAxeViolations, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })

test.describe('Stage C communications — provider-safe redesign controls', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/communications-redesign?tab=messages')
    await expectQaEventLoaded(page)
  })

  test('redesign communications page has no serious/critical accessibility violations', async ({ page }) => {
    const violations = await axeSeriousViolations(page)
    expect(violations, formatAxeViolations(violations)).toEqual([])
  })

  test('loads real templates and renders a server preview without sending', async ({ page }) => {
    const outbound = []
    page.on('request', (request) => {
      if (/\/(broadcast|test-send|send-invites)(?:\/|$)/.test(request.url())) outbound.push(request.url())
    })

    const templateCard = page.locator('.cm-template-card').first()
    await expect(templateCard).toBeVisible()
    await templateCard.getByRole('button', { name: 'Preview' }).click()
    await expect(page.locator('.rr-modal')).toBeVisible()
    await expect(page.locator('.rr-modal')).not.toContainText('{{first_name}}')
    expect(outbound).toEqual([])
  })

  test('template test-send uses the exact contract and shows a fail-closed server error', async ({ page }) => {
    let sentBody
    await page.route('**/api/events/*/templates/*/test-send', async (route) => {
      sentBody = await route.request().postDataJSON()
      await route.fulfill({ status: 403, json: { detail: 'Recipient is not in the outbound safety allowlist' } })
    })
    await page.locator('.cm-template-card').first().getByRole('button', { name: 'Test send' }).click()
    const modal = page.locator('.rr-modal')
    await expect(modal.getByRole('listbox', { name: 'Test recipients' })).toBeVisible()
    await modal.getByPlaceholder('name@example.com').fill('blocked-recipient@example.invalid')
    await modal.getByRole('button', { name: /Send .* test/ }).click()
    await expect(page.getByText('Recipient is not in the outbound safety allowlist', { exact: false })).toBeVisible()
    expect(sentBody.to).toBe('blocked-recipient@example.invalid')
    expect(sentBody.channel).toBeTruthy()
    await expect(page.getByText(/send confirmed/i)).toHaveCount(0)
  })

  test('long message sections collapse independently while template search filters live', async ({ page }) => {
    const broadcastButton = page.getByRole('button', { name: 'Collapse broadcast center' })
    await expect(broadcastButton).toHaveAttribute('aria-expanded', 'true')
    await broadcastButton.click()
    await expect(page.locator('#broadcast-center-content')).toHaveCount(0)

    const deliveryButton = page.getByRole('button', { name: 'Expand delivery by channel' })
    await expect(deliveryButton).toHaveAttribute('aria-expanded', 'false')
    await deliveryButton.click()
    await expect(page.locator('#delivery-by-channel-content')).toBeVisible()

    const templatesButton = page.getByRole('button', { name: 'Collapse templates' })
    await expect(templatesButton).toHaveAttribute('aria-expanded', 'true')
    const search = page.getByRole('textbox', { name: 'Search templates' })
    await search.fill('post-event thank-you')
    await expect(page.locator('.cm-template-card')).toHaveCount(1)
    await expect(page.locator('.cm-template-card')).toContainText('Post-event thank-you')
    await templatesButton.click()
    await expect(page.locator('#message-templates-content')).toHaveCount(0)

    const auditButton = page.getByRole('button', { name: 'Expand recent template changes' })
    await expect(auditButton).toHaveAttribute('aria-expanded', 'false')
    await auditButton.click()
    await expect(page.locator('#recent-template-changes-content')).toBeVisible()
  })

  test('broadcast uses the existing contract and reports only confirmed server counts', async ({ page }) => {
    let body
    await page.route('**/api/events/*/broadcast', async (route) => {
      body = await route.request().postDataJSON()
      await route.fulfill({ json: { queued: 1, skipped_no_contact: 2, skipped_no_consent: 3, skipped_no_credits: 4 } })
    })
    page.on('dialog', (dialog) => dialog.accept())

    const composer = page.locator('.cm-composer')
    await expect(composer.getByRole('heading', { name: 'Broadcast message' })).toBeVisible()
    await expect(composer.getByPlaceholder('Search by name, email or phone…')).toBeVisible()
    await page.getByPlaceholder('e.g. Doors open at 7pm. Parking is available on Main Street.').fill('Synthetic Stage C broadcast')
    await page.getByRole('button', { name: 'Send broadcast', exact: true }).click()
    await expect(page.getByText('Broadcast confirmed — queued: 1', { exact: false })).toBeVisible()
    expect(body.message).toBe('Synthetic Stage C broadcast')
    expect(body.target).toBe('all')
    expect(body.channels).toEqual(['sms'])
  })

  // Regression: the "Send to" dropdown's option labels once didn't match the
  // internal target lookup map, so choosing anything but "Everyone" silently
  // fell through to broadcasting to all guests instead of the selected
  // audience. This exercises every non-default option explicitly.
  test('each broadcast audience option maps to its own distinct real target value', async ({ page }) => {
    const seenTargets = []
    await page.route('**/api/events/*/broadcast', async (route) => {
      const body = await route.request().postDataJSON()
      seenTargets.push(body.target)
      await route.fulfill({ json: { queued: 0, skipped_no_contact: 0, skipped_no_consent: 0, skipped_no_credits: 0 } })
    })
    page.on('dialog', (dialog) => dialog.accept())

    const options = [
      ['RSVP: Attending', 'confirmed'],
      ['RSVP: Declined', 'declined'],
      ['RSVP: No reply', 'no_reply'],
      ['Checked in', 'admitted'],
      ['Not yet checked in', 'not_admitted'],
      ['No one else — just the recipients above', 'none'],
    ]
    for (const [label, expectedTarget] of options) {
      await page.getByPlaceholder('e.g. Doors open at 7pm. Parking is available on Main Street.').fill(`Synthetic target check: ${label}`)
      await fieldNear(page, 'Send to').selectOption({ label })
      if (expectedTarget === 'none') {
        await page.getByPlaceholder('Name (required)').fill('Synthetic Recipient')
        await page.getByPlaceholder('Email or phone', { exact: true }).fill('synthetic-recipient@example.invalid')
        await page.getByRole('button', { name: '+ Add' }).click()
      }
      await page.getByRole('button', { name: 'Send broadcast', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Broadcast confirmed')
      expect(seenTargets.at(-1)).toBe(expectedTarget)
    }
    expect(new Set(seenTargets).size).toBe(options.length)
  })
})

test('live staging rejects a non-allowlisted broadcast recipient without a success claim', async ({ page }) => {
  let authorization = ''
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/me')) authorization = request.headers().authorization || authorization
  })
  await signIn(page)
  expect(authorization).toMatch(/^Bearer /)
  const eventId = process.env.E2E_EVENT_ID
  const result = await page.evaluate(async ({ id, auth }) => {
    const response = await fetch(`/api/events/${id}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        message: 'Synthetic fail-closed safety probe',
        target: 'none',
        extra_recipients: [{ name: 'Blocked QA Recipient', email: 'blocked.qa.recipient@gmail.com' }],
        channels: ['email'],
      }),
    })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }, { id: eventId, auth: authorization })
  expect(result.status).toBeGreaterThanOrEqual(400)
  expect(JSON.stringify(result.body.detail || result.body)).toMatch(/allowlist|recipient[\s_-]*safety|outbound[\s_-]*safety|not permitted/i)
  await expect(page.getByText(/Broadcast confirmed|send confirmed/i)).toHaveCount(0)
})
