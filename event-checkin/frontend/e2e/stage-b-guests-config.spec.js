import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, fieldNear, firebaseAccessToken, openGuestActions, signIn } from './helpers.js'

// Minimal valid 1x1 PNG, matches the fixture used to live-verify uploadCoverImage this session.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test.describe.configure({ mode: 'serial' })

async function openGuests(page) {
  await signIn(page)
  await page.goto('/guests-redesign')
  await expectQaEventLoaded(page)
}

async function addSyntheticGuest(page, firstName, lastName) {
  const name = `${firstName} ${lastName}`
  await page.getByRole('button', { name: 'Add guest', exact: true }).first().click()
  const dialog = page.locator('.rr-modal').filter({ has: page.getByText('Add guest', { exact: true }) })
  await dialog.locator('input').nth(0).fill(firstName)
  await dialog.locator('input').nth(1).fill(lastName)
  await dialog.getByRole('button', { name: 'Add guest', exact: true }).click()
  await expect(page.getByText(`${name} added`, { exact: false })).toBeVisible()
  return name
}

async function removeSyntheticGuest(page, name) {
  await page.getByPlaceholder('Search guests by name…').fill(name)
  if (await page.getByText(name, { exact: true }).count() === 0) return
  await openGuestActions(page, name)
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
  await expect(page.getByText(`${name} removed`, { exact: false })).toBeVisible()
}

test.describe('Stage B guest households and RSVP configuration — isolated staging fixture', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

  test('creates, edits, bulk-assigns, clears, and deletes a synthetic household', async ({ page }) => {
    const guestFirstName = `E2E-Household-${suffix}`
    const guestLastName = 'Synthetic'
    const guestName = `${guestFirstName} ${guestLastName}`
    const householdName = `E2E Household ${suffix}`
    const editedHouseholdName = `E2E Household Edited ${suffix}`
    let guestCreated = false
    let householdCreated = false

    await openGuests(page)
    try {
      await addSyntheticGuest(page, guestFirstName, guestLastName)
      guestCreated = true

      await page.getByRole('button', { name: 'Household', exact: true }).click()
      const createDialog = page.locator('.rr-modal').filter({ has: page.getByText('Create household', { exact: true }) })
      await createDialog.locator('input').fill(householdName)
      await createDialog.locator('textarea').fill('Synthetic Playwright household')
      await createDialog.getByRole('button', { name: 'Save household', exact: true }).click()
      await expect(page.getByText('Household created', { exact: true })).toBeVisible()
      householdCreated = true

      await page.getByRole('button', { name: 'Show', exact: true }).click()
      let householdRow = page.locator('.gr-households tbody tr').filter({ hasText: householdName })
      await expect(householdRow).toBeVisible()
      await householdRow.getByRole('button', { name: 'Edit', exact: true }).click()
      const editDialog = page.locator('.rr-modal').filter({ has: page.getByText(`Edit household: ${householdName}`, { exact: true }) })
      await editDialog.locator('input').fill(editedHouseholdName)
      await editDialog.getByRole('button', { name: 'Save household', exact: true }).click()
      await expect(page.getByText('Household updated', { exact: true })).toBeVisible()

      await page.getByPlaceholder('Search guests by name…').fill(guestName)
      const guestRow = page.locator('.gr-guest-table tbody tr').filter({ hasText: guestName })
      await guestRow.locator('input[type="checkbox"]').check()
      await page.getByLabel('Assign household').selectOption({ label: editedHouseholdName })
      await expect(page.getByText('Household assignment updated', { exact: true })).toBeVisible()
      await expect(guestRow.getByText(editedHouseholdName, { exact: true })).toBeVisible()

      await guestRow.locator('input[type="checkbox"]').check()
      await page.getByLabel('Assign household').selectOption('none')
      await expect(page.getByText('Household assignment updated', { exact: true })).toBeVisible()
      await expect(guestRow.getByText(editedHouseholdName, { exact: true })).toHaveCount(0)

      householdRow = page.locator('.gr-households tbody tr').filter({ hasText: editedHouseholdName })
      await householdRow.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
      await expect(page.getByText('Household deleted', { exact: true })).toBeVisible()
      await expect(householdRow).toHaveCount(0)
      householdCreated = false
    } finally {
      if (householdCreated) {
        const row = page.locator('.gr-households tbody tr').filter({ hasText: /E2E Household/ }).filter({ hasText: suffix })
        if (await row.count()) {
          await row.getByRole('button', { name: 'Delete', exact: true }).click()
          await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
        }
      }
      if (guestCreated) await removeSyntheticGuest(page, guestName)
    }
  })

  test('saves and restores RSVP settings and creates/deletes a custom question', async ({ page }) => {
    const question = `E2E parking question ${suffix}?`
    const syntheticMessage = `Synthetic RSVP settings check ${suffix}`
    let questionCreated = false
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) {
        authorization = request.headers().authorization
      }
    })

    await openGuests(page)
    await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
    const withRsvpCard = page.locator('.gr-mode-card').filter({ hasText: 'With RSVP' })
    const withRsvp = withRsvpCard.locator('input')
    const originallyEnabled = await withRsvp.isChecked()
    if (!originallyEnabled) await withRsvpCard.click()
    await expect(page.getByRole('heading', { name: 'Invitation page' })).toBeVisible()

    const settingsPanel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Invitation page' }) })
    const capacity = settingsPanel.locator('input[type="number"]')
    const message = settingsPanel.locator('textarea')
    const originalCapacity = await capacity.inputValue()
    const originalMessage = await message.inputValue()
    const syntheticCapacity = String(7000 + Number(suffix.slice(-3).replace(/\D/g, '') || 1))

    try {
      await capacity.fill(syntheticCapacity)
      await message.fill(syntheticMessage)
      await page.getByRole('button', { name: 'Save invitation settings', exact: true }).click()
      await expect(page.getByText('RSVP settings saved', { exact: true })).toBeVisible()

      await page.reload()
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
      const reloadedSettingsPanel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Invitation page' }) })
      await expect(reloadedSettingsPanel.locator('input[type="number"]')).toHaveValue(syntheticCapacity)
      await expect(reloadedSettingsPanel.locator('textarea')).toHaveValue(syntheticMessage)

      await page.getByRole('button', { name: 'Add question', exact: true }).click()
      const form = page.locator('.gr-question-form')
      await form.getByPlaceholder('e.g. Will you need parking?').fill(question)
      await form.locator('select').nth(1).selectOption({ label: 'Short answer' })
      await form.getByLabel('Required').check()
      await form.getByRole('button', { name: 'Save question', exact: true }).click()
      await expect(page.getByText(`Question added: "${question}"`, { exact: true })).toBeVisible()
      questionCreated = true

      const questionRow = page.locator('.gr-question-row').filter({ hasText: question })
      await expect(questionRow).toContainText('Short answer · Required')
      await questionRow.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText(`Question deleted: "${question}"`, { exact: true })).toBeVisible()
      await expect(questionRow).toHaveCount(0)
      questionCreated = false
    } finally {
      if (questionCreated) {
        const row = page.locator('.gr-question-row').filter({ hasText: question })
        if (await row.count()) await row.getByRole('button', { name: 'Delete', exact: true }).click()
      }
      const restorePanel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Invitation page' }) })
      await restorePanel.locator('input[type="number"]').fill(originalCapacity)
      await restorePanel.locator('textarea').fill(originalMessage)
      await page.getByRole('button', { name: 'Save invitation settings', exact: true }).click()
      await expect(page.getByText('RSVP settings saved', { exact: true })).toBeVisible()
      if (!originallyEnabled) {
        // Turning RSVP off hides the save button, so the original disabled state
        // cannot be restored through the current UI. Use the same authenticated
        // contract solely for teardown, then verify the restored state in the UI.
        expect(authorization, 'an authenticated API request was captured for teardown').not.toBe('')
        const response = await page.request.put(`/api/events/${process.env.E2E_EVENT_ID}/invite-settings`, {
          headers: { Authorization: authorization },
          data: { rsvp_enabled: false },
        })
        expect(response.ok()).toBeTruthy()
        await page.reload()
        await expectQaEventLoaded(page)
        await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
        await expect(page.locator('.gr-mode-card').filter({ hasText: 'Skip RSVP' }).locator('input')).toBeChecked()
      }
    }
  })

  test('RSVP approval and rejection use confirmed server state, not optimistic UI', async ({ page }) => {
    const approveName = `E2E Approve ${suffix}`
    const declineName = `E2E Decline ${suffix}`
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    await openGuests(page)
    await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
    const withRsvpCard = page.locator('.gr-mode-card').filter({ hasText: 'With RSVP' })
    const originallyEnabled = await withRsvpCard.locator('input').isChecked()
    if (!originallyEnabled) await withRsvpCard.click()
    await expect(page.getByRole('heading', { name: 'Invitation page' })).toBeVisible()

    // "Require host approval" isn't reachable through this build's UI yet, so
    // flip it directly through the same real contract the (currently-mock)
    // toggle would call, then verify its effect through genuine UI behavior.
    expect(authorization, 'an authenticated API request was captured to source the update contract').not.toBe('')
    const eventId = process.env.E2E_EVENT_ID
    const settingsResponse = await page.request.put(`/api/events/${eventId}/invite-settings`, {
      headers: { Authorization: authorization },
      data: { rsvp_enabled: true, rsvp_require_approval: true },
    })
    expect(settingsResponse.ok()).toBeTruthy()
    const rsvpToken = (await settingsResponse.json()).rsvp_token

    try {
      for (const name of [approveName, declineName]) {
        const [first, ...rest] = name.split(' ')
        const submitResponse = await page.request.post(`/api/invite/link/${rsvpToken}/rsvp`, {
          data: { first_name: first, last_name: rest.join(' '), email: `${name.replaceAll(' ', '-').toLowerCase()}@example.com` },
        })
        expect(submitResponse.ok(), `public RSVP submission for ${name} must be accepted: ${submitResponse.status()} ${await submitResponse.text()}`).toBeTruthy()
      }

      await page.goto('/guests-redesign?tab=guests')
      await expectQaEventLoaded(page)
      await expect(page.getByText(/RSVPs? awaiting your approval/)).toBeVisible()

      const approveRow = page.locator('.gr-approval-queue-row').filter({ hasText: approveName })
      await expect(approveRow).toBeVisible()
      await approveRow.getByRole('button', { name: 'Approve', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(page.getByText(`${approveName}'s RSVP approved`, { exact: false })).toBeVisible()
      await expect(page.locator('.gr-approval-queue-row').filter({ hasText: approveName })).toHaveCount(0)
      await page.getByPlaceholder('Search guests by name…').fill(approveName)
      await expect(page.locator('table.rr-table tbody tr').filter({ hasText: approveName })).toContainText('Confirmed')

      const declineRow = page.locator('.gr-approval-queue-row').filter({ hasText: declineName })
      await expect(declineRow).toBeVisible()
      await declineRow.getByRole('button', { name: 'Decline', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Decline', exact: true }).click()
      await expect(page.getByText(`${declineName}'s RSVP declined`, { exact: false })).toBeVisible()
      await expect(page.locator('.gr-approval-queue-row').filter({ hasText: declineName })).toHaveCount(0)
      await page.getByPlaceholder('Search guests by name…').fill(declineName)
      await expect(page.locator('table.rr-table tbody tr').filter({ hasText: declineName })).toContainText('Declined')
    } finally {
      if (!page.isClosed()) {
        for (const name of [approveName, declineName]) await removeSyntheticGuest(page, name)
      }
      const revert = await page.request.put(`/api/events/${eventId}/invite-settings`, {
        headers: { Authorization: authorization },
        data: { rsvp_require_approval: false, rsvp_enabled: originallyEnabled },
      })
      expect(revert.ok()).toBeTruthy()
    }
  })

  test('invite theme selection actually persists through the save contract', async ({ page }) => {
    await openGuests(page)
    await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
    const withRsvpCard = page.locator('.gr-mode-card').filter({ hasText: 'With RSVP' })
    const originallyEnabled = await withRsvpCard.locator('input').isChecked()
    if (!originallyEnabled) await withRsvpCard.click()
    const themeSelect = fieldNear(page, 'Invite page theme')
    await expect(themeSelect).toBeVisible()
    const original = await themeSelect.inputValue()
    const next = original === 'gold' ? 'rose' : 'gold'

    try {
      await themeSelect.selectOption(next)
      await page.getByRole('button', { name: 'Save invitation settings', exact: true }).click()
      await expect(page.getByText('RSVP settings saved', { exact: true })).toBeVisible()

      await page.reload()
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
      // Regression check for the bug found this session: the select used to update
      // local UI state and show a toast without ever including invite_theme in the
      // save payload, so the choice silently never reached the server.
      await expect(fieldNear(page, 'Invite page theme')).toHaveValue(next)
    } finally {
      await fieldNear(page, 'Invite page theme').selectOption(original)
      await page.getByRole('button', { name: 'Save invitation settings', exact: true }).click()
      await expect(page.getByText('RSVP settings saved', { exact: true })).toBeVisible()
      if (!originallyEnabled) {
        await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
        await page.locator('.gr-mode-card').filter({ hasText: 'Skip RSVP' }).click()
      }
    }
  })

  test('cover image upload and removal use the real event contract', async ({ page }) => {
    await openGuests(page)
    await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
    const withRsvpCard = page.locator('.gr-mode-card').filter({ hasText: 'With RSVP' })
    const originallyEnabled = await withRsvpCard.locator('input').isChecked()
    if (!originallyEnabled) await withRsvpCard.click()

    // "Use as RSVP cover" below writes into the shared fixture's real design
    // record — capture its current asset_config so the finally block can put
    // it back exactly, not just blank it (this fixture's asset_config may
    // carry real state from other Design Studio tests).
    const designToken = await firebaseAccessToken(page)
    const designHeaders = { Authorization: `Bearer ${designToken}` }
    const originalDesignResp = await page.request.get(`/api/events/${process.env.E2E_EVENT_ID}/design`, { headers: designHeaders })
    const originalAssetConfig = originalDesignResp.ok() ? (await originalDesignResp.json()).asset_config || {} : {}

    try {
      await page.locator('input[type="file"]').setInputFiles({
        name: 'e2e-cover.png', mimeType: 'image/png', buffer: ONE_PX_PNG,
      })
      const uploadResponse = page.waitForResponse((response) =>
        /\/upload-cover$/.test(response.url()) && response.request().method() === 'POST'
      )
      await uploadResponse
      const preview = page.locator('.gr-cover-banner img')
      await expect(preview).toBeVisible()
      await expect(preview).toHaveAttribute('src', /.+/)
      const uploadedUrl = await preview.getAttribute('src')

      // "Use as RSVP cover" — writes this upload into the design record's
      // asset_config.cover_image_url (see designCover() in InvitePage.jsx),
      // since that outranks the plain invite_cover_image on the live guest
      // page. Regression coverage for a real bug: an uploaded photo here
      // could never actually reach the guest page while Design Studio had
      // any flyer_image_url set, even just a template's stock preview.
      const applyResponse = page.waitForResponse((response) =>
        response.url().includes(`/api/events/${process.env.E2E_EVENT_ID}/design`) && response.request().method() === 'PUT'
      )
      await page.getByRole('button', { name: 'Use as RSVP cover', exact: true }).click()
      const applied = await (await applyResponse).json()
      expect(applied.asset_config.cover_image_url).toBe(uploadedUrl)
      await expect(page.getByText('✓ Currently the RSVP cover')).toBeVisible()

      // Replacing the photo while it's already applied must re-apply
      // automatically. Regression for the bug reported live: uploading a new
      // image left the OLD one still showing as the RSVP cover until
      // "Use as RSVP cover" was clicked again by hand.
      const reuploadResponse = page.waitForResponse((response) =>
        /\/upload-cover$/.test(response.url()) && response.request().method() === 'POST'
      )
      const reapplyResponse = page.waitForResponse((response) =>
        response.url().includes(`/api/events/${process.env.E2E_EVENT_ID}/design`) && response.request().method() === 'PUT'
      )
      await page.locator('input[type="file"]').setInputFiles({
        name: 'e2e-cover-2.png', mimeType: 'image/png', buffer: ONE_PX_PNG,
      })
      await reuploadResponse
      const reapplied = await (await reapplyResponse).json()
      const replacedUrl = await preview.getAttribute('src')
      expect(replacedUrl).not.toBe(uploadedUrl)
      expect(reapplied.asset_config.cover_image_url).toBe(replacedUrl)
      await expect(page.getByText('✓ Currently the RSVP cover')).toBeVisible()

      const resetResponse = page.waitForResponse((response) =>
        response.url().includes(`/api/events/${process.env.E2E_EVENT_ID}/design`) && response.request().method() === 'PUT'
      )
      await page.getByRole('button', { name: 'Reset to default', exact: true }).click()
      const reset = await (await resetResponse).json()
      expect(reset.asset_config.cover_image_url).toBe('')
      await expect(page.getByRole('button', { name: 'Use as RSVP cover', exact: true })).toBeVisible()

      const removeResponse = page.waitForResponse((response) =>
        /\/upload-cover$/.test(response.url()) && response.request().method() === 'DELETE'
      )
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      await removeResponse
      await expect(page.locator('.gr-cover-banner img')).toHaveCount(0)
    } finally {
      if (!originallyEnabled) {
        await page.locator('.gr-mode-card').filter({ hasText: 'Skip RSVP' }).click()
      }
      const restore = await page.request.put(`/api/events/${process.env.E2E_EVENT_ID}/design`, {
        headers: designHeaders,
        data: { asset_config: originalAssetConfig },
      })
      expect(restore.ok()).toBeTruthy()
    }
  })
})
