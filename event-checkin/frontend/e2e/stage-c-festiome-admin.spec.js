import { test, expect } from '@playwright/test'
import { firebaseAccessToken, requiredEnv, signIn, signInAs } from './helpers.js'

test('FestioMe redesign loads organizer groups and confirms group creation', async ({ page }) => {
  await signIn(page)
  let groups = [{ id: 'g1', name: 'QA Community', join_policy: 'open' }]
  let channels = []
  let createdGroupBody
  let createdChannelBody
  await page.route('**/api/events/*/festiome/status', (route) => route.fulfill({ json: { configured: true, available: true, enabled: true } }))
  await page.route('**/api/events/*/festiome/groups', async (route) => {
    if (route.request().method() === 'POST') {
      const body = await route.request().postDataJSON()
      createdGroupBody = body
      const created = { id: 'g2', ...body }
      groups = [...groups, created]
      return route.fulfill({ status: 201, json: created })
    }
    return route.fulfill({ json: groups })
  })
  await page.route('**/api/events/*/festiome/groups/*/join-requests**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/festiome/**', async (route) => {
    const url = route.request().url()
    if (url.endsWith('/channels') && route.request().method() === 'POST') {
      createdChannelBody = await route.request().postDataJSON()
      const created = { id: 'c1', name: 'qa-channel', kind: 'discussion', is_private: false, unread_count: 0 }
      channels = [created]
      return route.fulfill({ status: 201, json: created })
    }
    if (url.endsWith('/channels')) return route.fulfill({ json: channels })
    if (url.includes('/channels/')) return route.fulfill({ json: { messages: [] } })
    return route.fulfill({ json: [] })
  })

  await page.goto('/festiome-redesign')
  await expect(page.getByRole('heading', { name: 'FestioMe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'QA Community' })).toBeVisible()
  await page.getByRole('button', { name: 'Create group' }).click()
  await page.getByPlaceholder('e.g. Photography Team').fill('QA Moderators')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Group created', { exact: true })).toBeVisible()
  expect(createdGroupBody).toMatchObject({ join_policy: 'open', visibility: 'listed' })
  await expect(page.getByRole('button', { name: 'QA Moderators' })).toBeVisible()
  await page.getByTitle('Create channel').click()
  await page.getByPlaceholder('channel-name').fill('qa-channel')
  await page.locator('.fm-create-channel').getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Channel created', { exact: true })).toBeVisible()
  expect(createdChannelBody).toMatchObject({ kind: 'discussion', is_private: false, member_ids: [] })
  await expect(page.getByRole('button', { name: /qa-channel/ })).toBeVisible()
})

test('FestioMe real service supports group, invitation, member, channel, and message end to end', async ({ browser, context, page }) => {
  test.setTimeout(120000)
  const eventId = requiredEnv('E2E_EVENT_ID')
  const secondEmail = requiredEnv('E2E_SECOND_EMAIL')
  const suffix = Date.now().toString(36)
  const groupName = `E2E Community ${suffix}`
  const channelName = `updates-${suffix}`
  const privateChannelName = `team-${suffix}`
  const message = `Real FestioMe message ${suffix}`
  let groupId = ''

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page)
  const statusResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && response.url().endsWith(`/api/events/${eventId}/festiome/status`)
  )
  await page.goto('/festiome-redesign')
  await expect(page.getByRole('heading', { name: 'FestioMe' })).toBeVisible()
  expect((await statusResponse).status()).toBe(200)
  await expect(page.getByText('Loading FestioMe…', { exact: true })).toHaveCount(0)

  const enable = page.getByRole('button', { name: 'Enable FestioMe' })
  if (await enable.isVisible()) {
    await enable.click()
    await expect(page.getByText('FestioMe enabled', { exact: true })).toBeVisible()
  }

  // The event's primary group and its real General channel must be available,
  // not only separately created subgroups.
  await expect(page.getByRole('button', { name: 'Redesign QA Test Event' })).toBeVisible()
  await page.getByRole('button', { name: 'Redesign QA Test Event' }).click()
  await expect(page.getByRole('button', { name: /General/ })).toBeVisible()

  try {
    await page.getByRole('button', { name: 'Create group' }).click()
    await page.getByPlaceholder('e.g. Photography Team').fill(groupName)
    const groupResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && /\/api\/events\/[^/]+\/festiome\/groups$/.test(new URL(response.url()).pathname)
    )
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    const groupResponse = await groupResponsePromise
    expect(groupResponse.status()).toBe(201)
    groupId = (await groupResponse.json()).id
    await expect(page.getByText('Group created', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: groupName })).toBeVisible()
    await expect(page.getByRole('button', { name: /General/ })).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept(secondEmail))
    const invitationResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && response.url().includes(`/api/festiome/v1/groups/${groupId}/invitations`)
    )
    await page.getByRole('button', { name: 'Invite member' }).click()
    const invitationResponse = await invitationResponsePromise
    expect(invitationResponse.status()).toBe(201)
    const invitation = await invitationResponse.json()
    expect(invitation.token).toBeTruthy()
    await expect(page.getByText(/Member invitation created/)).toBeVisible()

    const secondContext = await browser.newContext()
    const secondPage = await secondContext.newPage()
    try {
      await signInAs(
        secondPage,
        secondEmail,
        requiredEnv('E2E_SECOND_PASSWORD'),
        eventId,
      )
      const secondFirebaseToken = await firebaseAccessToken(secondPage)
      expect(secondFirebaseToken).toBeTruthy()
      const session = await secondPage.request.post('/api/auth/festiome-token', {
        headers: { Authorization: `Bearer ${secondFirebaseToken}` },
      })
      expect(session.status()).toBe(200)
      const secondFestioMeToken = (await session.json()).token
      const accepted = await secondPage.request.post(
        `/api/festiome/v1/invitations/${invitation.token}/accept`,
        { headers: { Authorization: `Bearer ${secondFestioMeToken}` } },
      )
      expect(accepted.status()).toBe(200)
    } finally {
      await secondContext.close()
    }

    await page.reload()
    await page.getByRole('button', { name: groupName }).click()
    await expect(page.getByText('Redesign E2E (staff)', { exact: true }).first()).toBeVisible()

    await page.getByTitle('Create channel').click()
    await page.getByPlaceholder('channel-name').fill(channelName)
    const publicChannelResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && response.url().includes(`/api/festiome/v1/groups/${groupId}/channels`)
    )
    await page.locator('.fm-create-channel').getByRole('button', { name: 'Create' }).click()
    expect((await publicChannelResponse).status()).toBe(201)
    await expect(page.getByText('Channel created', { exact: true })).toBeVisible()

    await page.getByPlaceholder(/Message #/).fill(message)
    const messageResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && /\/api\/festiome\/v1\/channels\/[^/]+\/messages$/.test(new URL(response.url()).pathname)
    )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    expect((await messageResponse).status()).toBe(201)
    await expect(page.getByText(message, { exact: true })).toBeVisible()

    await page.getByTitle('Create channel').click()
    await page.getByPlaceholder('channel-name').fill(privateChannelName)
    await page.getByText('Private (choose members)', { exact: true }).click()
    await page.locator('.fm-channel-member-picker').getByText('Redesign E2E (staff)', { exact: true }).click()
    const privateChannelResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && response.url().includes(`/api/festiome/v1/groups/${groupId}/channels`)
    )
    await page.locator('.fm-create-channel').getByRole('button', { name: 'Create' }).click()
    expect((await privateChannelResponse).status()).toBe(201)
    await expect(page.getByRole('button', { name: new RegExp(privateChannelName) })).toBeVisible()
  } finally {
    if (groupId) {
      const firebaseToken = await firebaseAccessToken(page)
      const archived = await page.request.patch(
        `/api/events/${eventId}/festiome/groups/${groupId}`,
        {
          headers: { Authorization: `Bearer ${firebaseToken}` },
          data: { archived: true },
        },
      )
      expect(archived.status()).toBe(200)
    }
  }
})

test('subscription-aware shell hides disabled add-ons but keeps Guest Communication', async ({ page }) => {
  await signIn(page)
  const eventId = requiredEnv('E2E_EVENT_ID')
  await page.route(/\/api\/events(?:\?.*)?$/, (route) => route.fulfill({
    json: [{
      id: eventId,
      name: 'Entitlement visibility test',
      is_paid: true,
      venue_access_enabled: false,
      seating_enabled: false,
      menu_enabled: false,
      logistics_enabled: false,
      registry_enabled: false,
      festiome_addon_enabled: false,
      experience_enabled: false,
    }],
  }))

  await page.goto('/admin-redesign')
  const sidebar = page.locator('.rr-sidebar')
  await expect(sidebar.getByRole('link', { name: 'Guest Communication' })).toBeVisible()
  await expect(sidebar.getByText('ADD-ONS', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'Venue Access' })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'FestioMe' })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'Experience' })).toHaveCount(0)
  await expect(page.locator('.rr-topbar-links').getByRole('link', { name: 'FestioMe' })).toHaveCount(0)
  await expect(page.locator('.rr-topbar-links').getByRole('link', { name: 'Orders' })).toHaveCount(0)
  // Check-in remains a core event-day tool; Venue Access is the gated add-on.
  await expect(page.locator('.rr-topbar-links').getByRole('link', { name: 'Check-in' })).toBeVisible()
})
