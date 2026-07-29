import { test, expect } from '@playwright/test'
import { expectQaEventLoaded, openGuestActions, signIn } from './helpers.js'

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
      await page.locator('.gr-bulkbar select').selectOption({ label: editedHouseholdName })
      await expect(page.getByText('Household assignment updated', { exact: true })).toBeVisible()
      await expect(guestRow.getByText(editedHouseholdName, { exact: true })).toBeVisible()

      await guestRow.locator('input[type="checkbox"]').check()
      await page.locator('.gr-bulkbar select').selectOption('none')
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
    await expect(page.getByRole('heading', { name: 'Public RSVP link' })).toBeVisible()

    const settingsPanel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Public RSVP link' }) })
    const capacity = settingsPanel.locator('input[type="number"]')
    const message = settingsPanel.locator('textarea')
    const originalCapacity = await capacity.inputValue()
    const originalMessage = await message.inputValue()
    const syntheticCapacity = String(7000 + Number(suffix.slice(-3).replace(/\D/g, '') || 1))

    try {
      await capacity.fill(syntheticCapacity)
      await message.fill(syntheticMessage)
      await page.getByRole('button', { name: 'Save RSVP settings', exact: true }).click()
      await expect(page.getByText('RSVP settings saved', { exact: true })).toBeVisible()

      await page.reload()
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Invites & RSVP', exact: true }).click()
      const reloadedSettingsPanel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Public RSVP link' }) })
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
      const restorePanel = page.locator('.rr-panel').filter({ has: page.getByRole('heading', { name: 'Public RSVP link' }) })
      await restorePanel.locator('input[type="number"]').fill(originalCapacity)
      await restorePanel.locator('textarea').fill(originalMessage)
      await page.getByRole('button', { name: 'Save RSVP settings', exact: true }).click()
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
    await expect(page.getByRole('heading', { name: 'Public RSVP link' })).toBeVisible()

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
})
