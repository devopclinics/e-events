import { test, expect } from '@playwright/test'

const fixtureChat = ({ deferLoaded = false } = {}) => `<!doctype html><html><body><p>Local chat fixture</p><script>
  window.received = [];
  window.widgetOpen = false;
  window.readReplies = [];
  window.unreadReplies = [];
  // Mirror the relevant provider rule: incoming messages are marked seen only
  // while its own open state is true, not based on the host panel's CSS.
  window.fixtureAgentReply = id => (window.widgetOpen ? window.readReplies : window.unreadReplies).push(id);
  window.fixtureSend = message => window.parent.postMessage('chatwoot-widget:' + JSON.stringify(message), 'http://127.0.0.1:4178');
  window.fixtureLoaded = () => window.fixtureSend({ event: 'loaded', config: { authToken: 'fixture-private-session' } });
  window.addEventListener('message', event => {
    if (event.origin !== 'http://127.0.0.1:4178' || event.source !== window.parent) return;
    if (typeof event.data === 'string' && event.data.startsWith('chatwoot-widget:')) {
      const message = JSON.parse(event.data.slice(16));
      window.received.push(message);
      if (message.event === 'toggle-open') window.widgetOpen = message.isOpen;
    }
  });
  ${deferLoaded ? '' : 'window.fixtureLoaded();'}
</script></body></html>`

async function setup(page, { deferChatLoaded = false } = {}) {
  const requests = { signup: [], chat: [] }
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (['sales.chat.test', 'support.chat.test'].includes(url.hostname)) {
      requests.chat.push({ url: url.toString(), headers: request.headers() })
      return route.fulfill({ contentType: 'text/html', body: fixtureChat({ deferLoaded: deferChatLoaded }) })
    }
    // A strict no-network boundary: only the local fixture app may be accessed.
    if (url.origin !== 'http://127.0.0.1:4178') return route.abort()
    if (url.pathname === '/api/auth/me') {
      requests.signup.push(request.headers())
      return route.fulfill({ json: { id: 'organizer-1', role: 'official' } })
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { events: [] } })
    return route.continue()
  })
  await page.goto('/__engagement-test')
  await expect(page.getByRole('navigation', { name: 'Fixture navigation' })).toBeVisible()
  return requests
}
const navigate = (page, name) => page.getByRole('navigation', { name: 'Fixture navigation' }).getByRole('link', { name, exact: true }).click()
const chatFrame = (page, host) => page.frames().find(frame => frame.url().startsWith(`https://${host}/widget`))
const frameVisibility = (frame) => frame.evaluate(() => window.received.filter(message => message.event === 'toggle-open').map(message => message.isOpen))

// These are mocked browser integration checks, not a live Chatwoot/Firebase test.
test('anonymous chat is isolated, lazy, closeable, and reset across routes and auth changes', async ({ page }) => {
  const requests = await setup(page)
  await page.evaluate(() => { document.cookie = 'cw_conversation=old-support-session; path=/'; localStorage.setItem('private-fixture', 'tenant-secret') })
  await navigate(page, 'Home')
  const sales = page.getByRole('button', { name: 'Chat with Festio sales', exact: true })
  await expect(sales).toBeVisible()
  expect(requests.chat).toHaveLength(0)
  await sales.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Connecting' })).toHaveCount(0)
  await expect.poll(() => chatFrame(page, 'sales.chat.test')?.evaluate(() => window.received.length)).toBe(2)
  const sent = await chatFrame(page, 'sales.chat.test').evaluate(() => window.received)
  expect(sent.map(message => message.event)).toEqual(['config-set', 'toggle-open'])
  expect(sent.at(-1)).toEqual({ event: 'toggle-open', isOpen: true })
  expect(JSON.stringify(sent)).not.toMatch(/tenant-secret|old-support-session|identifier|org_name|email/)
  expect(requests.chat[0].url).toBe('https://sales.chat.test/widget?website_token=sales-fixture-inbox')
  expect(requests.chat[0].headers.referer).toBeUndefined()
  expect(await page.evaluate(() => window.fixtureIdentifyCalls || 0)).toBe(0)
  expect(await page.evaluate(() => window.fixtureSettingsCalls || 0)).toBe(0)
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(sales).toBeFocused()
  const retainedFrame = chatFrame(page, 'sales.chat.test')
  await expect.poll(() => frameVisibility(retainedFrame)).toEqual([true, false])
  await retainedFrame.evaluate(() => window.fixtureAgentReply('hidden-reply'))
  expect(await retainedFrame.evaluate(() => window.readReplies)).toEqual([])
  expect(await retainedFrame.evaluate(() => window.unreadReplies)).toEqual(['hidden-reply'])
  await sales.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => frameVisibility(retainedFrame)).toEqual([true, false, true])
  expect(requests.chat).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(sales).toBeFocused()
  await expect.poll(() => frameVisibility(retainedFrame)).toEqual([true, false, true, false])
  await sales.click()
  await expect.poll(() => frameVisibility(retainedFrame)).toEqual([true, false, true, false, true])
  // The launcher is also a toggle, not just the initial open action.
  await sales.click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(() => frameVisibility(retainedFrame)).toEqual([true, false, true, false, true, false])
  await navigate(page, 'Guest')
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(sales).toHaveCount(0)
  await page.goBack()
  await expect(sales).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await sales.click()
  await page.evaluate(() => window.fixtureSetUser({ id: 'organizer-1' }))
  await expect(page.locator('iframe')).toHaveCount(0)
  await navigate(page, 'Admin')
  await page.getByRole('button', { name: 'Festio support', exact: true }).click()
  await expect.poll(() => chatFrame(page, 'support.chat.test')?.evaluate(() => window.received.length)).toBe(4)
  expect((await chatFrame(page, 'support.chat.test').evaluate(() => window.received)).map(message => message.event)).toEqual(['config-set', 'set-user', 'set-custom-attributes', 'toggle-open'])
  await page.evaluate(() => window.fixtureSetUser(null))
  await expect(page.locator('iframe')).toHaveCount(0)
  await navigate(page, 'Home')
  await sales.click()
  await expect.poll(() => chatFrame(page, 'sales.chat.test')?.evaluate(() => window.received.length)).toBe(2)
  expect(JSON.stringify(await chatFrame(page, 'sales.chat.test').evaluate(() => window.received))).not.toMatch(/organizer-1|Private Organization|identifier/)
})

test('closing before the provider loaded keeps it unread until reopening the retained frame', async ({ page }) => {
  const requests = await setup(page, { deferChatLoaded: true })
  await navigate(page, 'Home')
  const sales = page.getByRole('button', { name: 'Chat with Festio sales', exact: true })
  await sales.click()
  await expect(page.getByRole('status').filter({ hasText: 'Connecting' })).toBeVisible()
  await expect.poll(() => chatFrame(page, 'sales.chat.test')?.evaluate(() => typeof window.fixtureLoaded)).toBe('function')
  const frame = chatFrame(page, 'sales.chat.test')
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await frame.evaluate(() => window.fixtureLoaded())
  await expect.poll(() => frameVisibility(frame)).toEqual([false])
  await frame.evaluate(() => window.fixtureAgentReply('reply-while-loading-hidden'))
  expect(await frame.evaluate(() => window.readReplies)).toEqual([])
  expect(await frame.evaluate(() => window.unreadReplies)).toEqual(['reply-while-loading-hidden'])
  await sales.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => frameVisibility(frame)).toEqual([false, true])
  await frame.evaluate(() => window.fixtureAgentReply('visible-reply'))
  expect(await frame.evaluate(() => window.readReplies)).toEqual(['visible-reply'])
  expect(requests.chat).toHaveLength(1)
  expect(await page.evaluate(() => window.fixtureIdentifyCalls || 0)).toBe(0)
  expect(await page.evaluate(() => window.fixtureSettingsCalls || 0)).toBe(0)
})

for (const event of ['closeWindow', 'closeChat']) {
  test(`provider ${event} closes React state and reopening resynchronizes the same anonymous frame`, async ({ page }) => {
    const requests = await setup(page)
    await navigate(page, 'Pricing')
    const sales = page.getByRole('button', { name: 'Chat with Festio sales', exact: true })
    await sales.click()
    await expect.poll(() => chatFrame(page, 'sales.chat.test')?.evaluate(() => window.widgetOpen)).toBe(true)
    const frame = chatFrame(page, 'sales.chat.test')
    // A same-origin claim with the wrong source cannot control the panel.
    await page.evaluate(event => window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://sales.chat.test', source: window,
      data: 'chatwoot-widget:' + JSON.stringify({ event }),
    })), event)
    await expect(sales).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('dialog')).toBeVisible()
    await frame.evaluate(event => window.fixtureSend({ event }), event)
    await expect(sales).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(sales).toBeFocused()
    await expect.poll(() => frameVisibility(frame)).toEqual([true, false])
    await frame.evaluate(() => window.fixtureAgentReply('hidden-provider-reply'))
    expect(await frame.evaluate(() => window.readReplies)).toEqual([])
    await sales.click()
    await expect.poll(() => frameVisibility(frame)).toEqual([true, false, true])
    expect(requests.chat).toHaveLength(1)
    expect((await frame.evaluate(() => window.received)).filter(message => message.event === 'config-set')).toHaveLength(1)
    expect(await page.evaluate(() => window.fixtureIdentifyCalls || 0)).toBe(0)
    expect(await page.evaluate(() => window.fixtureSettingsCalls || 0)).toBe(0)
  })
}

test('route teardown before provider load leaves no frame or late-ready bridge and Back creates a fresh session', async ({ page }) => {
  const requests = await setup(page, { deferChatLoaded: true })
  await navigate(page, 'Pricing')
  const sales = page.getByRole('button', { name: 'Chat with Festio sales', exact: true })
  await sales.click()
  await expect.poll(() => chatFrame(page, 'sales.chat.test')?.evaluate(() => typeof window.fixtureLoaded)).toBe('function')
  await navigate(page, 'Guest')
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
    origin: 'https://sales.chat.test', source: window,
    data: 'chatwoot-widget:' + JSON.stringify({ event: 'loaded' }),
  })))
  await expect(sales).toHaveCount(0)
  await page.goBack()
  await expect(sales).toBeVisible()
  await expect(sales).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('iframe')).toHaveCount(0)
  await sales.click()
  await expect.poll(() => chatFrame(page, 'sales.chat.test')?.evaluate(() => typeof window.fixtureLoaded)).toBe('function')
  const frame = chatFrame(page, 'sales.chat.test')
  expect(await frame.evaluate(() => window.received)).toEqual([])
  await frame.evaluate(() => window.fixtureLoaded())
  await expect.poll(() => frameVisibility(frame)).toEqual([true])
  expect(requests.chat).toHaveLength(2)
})

test('same-account profile refresh retains the initialized bridge but organization changes reset it', async ({ page }) => {
  const requests = await setup(page)
  await page.evaluate(() => window.fixtureSetUser({ id: 'organizer-1', org_id: 'organization-1' }))
  await navigate(page, 'Admin')
  const support = page.getByRole('button', { name: 'Festio support', exact: true })
  await support.click()
  await expect.poll(() => chatFrame(page, 'support.chat.test')?.evaluate(() => window.widgetOpen)).toBe(true)
  const frame = chatFrame(page, 'support.chat.test')
  await page.evaluate(async () => {
    window.fixtureSetUser({ id: 'organizer-1', org_id: 'organization-1', name: 'Updated fixture profile' })
    // Allow the context update and committed layout effects to finish.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  expect(await frameVisibility(frame)).toEqual([true])
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await expect.poll(() => frameVisibility(frame)).toEqual([true, false])
  await support.click()
  await expect.poll(() => frameVisibility(frame)).toEqual([true, false, true])
  expect(requests.chat).toHaveLength(1)
  expect((await frame.evaluate(() => window.received)).filter(message => message.event === 'config-set')).toHaveLength(1)
  await page.evaluate(() => window.fixtureSetUser({ id: 'organizer-1', org_id: 'organization-2' }))
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(support).toHaveAttribute('aria-expanded', 'false')
  await support.click()
  await expect.poll(() => chatFrame(page, 'support.chat.test')?.evaluate(() => window.widgetOpen)).toBe(true)
  expect(requests.chat).toHaveLength(2)
  expect(await frameVisibility(chatFrame(page, 'support.chat.test'))).toEqual([true])
})

test('support respects the kill switch and ignores late identity after logout', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { window.fixtureSupportEnabled = false; window.fixtureSetUser({ id: 'organizer-1' }) })
  await navigate(page, 'Admin')
  await expect(page.getByRole('button', { name: 'Festio support', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.fixtureIdentifyCalls || 0)).toBe(0)
  await navigate(page, 'Home')
  await page.evaluate(() => { window.fixtureSupportEnabled = true; window.fixtureDeferIdentity = true })
  await navigate(page, 'Admin')
  await expect.poll(() => page.evaluate(() => typeof window.fixtureResolveIdentity)).toBe('function')
  await page.evaluate(() => window.fixtureSetUser(null))
  await page.evaluate(() => window.fixtureResolveIdentity())
  await expect(page.getByRole('button', { name: 'Festio support', exact: true })).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
})

for (const provider of ['password', 'google']) for (const optIn of [false, true]) {
  test(`${provider} signup sends explicit email ${optIn ? 'opt-in' : 'non-consent'} and never opts into phone channels`, async ({ page }) => {
    const requests = await setup(page)
    await navigate(page, 'Signup')
    const checkbox = page.getByRole('checkbox', { name: /Email me Festio/ })
    await expect(checkbox).not.toBeChecked()
    if (optIn) await checkbox.check()
    if (provider === 'password') {
      await page.getByLabel('Full Name').fill('Test Person')
      await page.getByLabel('Email', { exact: true }).fill('person@example.test')
      await page.getByLabel('Password', { exact: true }).fill('local-test-only')
      await page.getByRole('button', { name: 'Create Account', exact: true }).click()
    } else await page.getByRole('button', { name: 'Sign up with Google', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome to Festio!' })).toBeVisible()
    expect(requests.signup).toHaveLength(1)
    expect(JSON.parse(decodeURIComponent(requests.signup[0]['x-festio-attribution']))).toEqual({ consent_email: optIn })
    expect(await page.evaluate(() => window.fixtureSignupProvider)).toBe(provider)
    expect(await page.evaluate(() => (window.fixtureVerificationCalls || []).length)).toBe(provider === 'password' ? 1 : 0)
    if (provider === 'password') {
      await expect(page.getByRole('status')).toContainText('We sent an email verification link')
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('festio:signup-consent:fixture-password-user')).optedIn)).toBe(optIn)
    } else expect(await page.evaluate(() => localStorage.getItem('festio:signup-consent:fixture-google-user'))).toBeNull()
  })
}

for (const route of ['Home', 'Legacy']) {
  test(`${route} demo request keeps retry key, rotates after an edit, and never promises a booking`, async ({ page }) => {
    await setup(page)
    await navigate(page, route)
    const checkbox = page.getByRole('checkbox', { name: /Email me Festio/ })
    await expect(checkbox).not.toBeChecked()
    await page.getByPlaceholder('Your name').fill('Demo Visitor')
    await page.getByPlaceholder('you@example.com').fill('visitor@example.test')
    await page.evaluate(() => window.fixtureDemoFailures = 2)
    const submit = page.getByRole('button', { name: route === 'Home' ? 'Send request' : 'Send demo request', exact: true })
    await submit.click()
    await expect(page.getByText('Temporary network failure')).toBeVisible()
    await submit.click()
    await expect.poll(() => page.evaluate(() => window.fixtureDemoRequests.length)).toBe(2)
    await page.getByPlaceholder('Your name').fill('Updated Visitor')
    await checkbox.check()
    await submit.click()
    await expect(page.getByText(/Your preferred time is not confirmed yet/)).toBeVisible()
    const attempts = await page.evaluate(() => window.fixtureDemoRequests)
    expect(attempts).toHaveLength(3)
    expect(attempts[0].key).toBe(attempts[1].key)
    expect(attempts[2].key).not.toBe(attempts[1].key)
    expect(attempts[0].body.consent_email).toBe(false)
    expect(attempts[2].body.consent_email).toBe(true)
    expect(attempts.every(({ body }) => !Object.hasOwn(body, 'consent_sms') && !Object.hasOwn(body, 'consent_whatsapp'))).toBe(true)
    await expect(submit).toHaveCount(0)
  })
}

test('chat fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await setup(page)
  await navigate(page, 'Pricing')
  await page.getByRole('button', { name: 'Chat with Festio sales', exact: true }).click()
  const panel = await page.getByRole('dialog').boundingBox()
  expect(panel.x).toBeGreaterThanOrEqual(0)
  expect(panel.y).toBeGreaterThanOrEqual(0)
  expect(panel.x + panel.width).toBeLessThanOrEqual(375)
  expect(panel.y + panel.height).toBeLessThanOrEqual(667)
})

for (const width of [390, 1440]) test(`Marketing grouped navigation and shared themes at ${width}px`, async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width, height: 1000 })
  await navigate(page, 'Marketing')
  await expect(page.getByRole('heading', { name: 'Automatic client onboarding: running', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch to dark theme', exact: true })).toBeVisible()
  if (width === 390) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Marketing workspace navigation' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#marketing-navigation')).not.toBeVisible()
  }
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Review email journey', exact: true }).click()
  await expect(page).toHaveURL(/tab=sequences/)
  await page.getByRole('button', { name: 'Open studio →', exact: true }).click()
  await expect(page.locator('.mk-sequence-studio')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Automatic client onboarding: running', exact: true })).toBeVisible()
})

for (const width of [390, 1440]) test(`Marketing client cards and case selection at ${width}px`, async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width, height: 1000 })
  await navigate(page, 'Marketing')
  await page.getByRole('button', { name: 'Explore clients →', exact: true }).click()
  await expect(page.locator('.mk-client-cards')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sample organiser', exact: true })).toBeVisible()
  await page.goBack()
  await page.getByRole('button', { name: 'Open replies & follow-up →', exact: true }).click()
  await page.getByRole('button', { name: /case-two/ }).click()
  await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /case-one/ }).click()
  await expect(page.getByRole('link', { name: 'Open source conversation' })).toHaveAttribute('href', 'https://example.test/conversation')
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  expect(await page.evaluate(() => window.fixtureHandoffActions)).toEqual([{ id: 'case-one', action: 'acknowledge' }])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

// Real homepage interactions, with setup() keeping providers and API calls local.
test('homepage preview repeats mouse and keyboard journeys without losing focus', async ({ page }) => {
  await setup(page)
  await navigate(page, 'Home')
  const invitation = page.getByRole('button', { name: '01 Invitation', exact: true })
  const open = page.getByRole('button', { name: 'Open sample invitation', exact: true })
  const accept = page.getByRole('button', { name: 'Joyfully accept ↗', exact: true })
  const pass = page.locator('[data-preview-panel="pass"]')
  for (let i = 0; i < 5; i++) {
    await invitation.click()
    await open.click()
    await expect(accept).toBeFocused()
    await accept.click()
    await expect(pass).toBeVisible()
    await expect(pass).toBeFocused()
  }
  await invitation.click()
  await open.focus()
  await page.keyboard.press('Enter')
  await expect(accept).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(pass).toBeFocused()
  expect(await page.evaluate(() => window.fixtureDemoRequests || [])).toEqual([])
})

test('homepage direct section links land correctly after a fresh mount', async ({ page }) => {
  await setup(page)
  for (const id of ['journey', 'design-studio', 'tools', 'occasions', 'pricing', 'contact']) {
    await page.goto(`/?section=${id}#${id}`)
    const section = page.locator(`#${id}`)
    await expect(section).toBeVisible()
    await expect.poll(async () => Math.round((await section.boundingBox()).y)).toBe(110)
  }
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link', { name: 'Product', exact: true })).toHaveAttribute('href', '#journey')
  await expect(nav.getByRole('link', { name: 'Design Studio', exact: true })).toHaveAttribute('href', '#design-studio')
  await expect(page.locator('.lr-price-tier')).toHaveText(['Free', 'Event Pass', 'Enterprise'])
  await expect(page.locator('.fh-occasion-grid a')).toHaveCount(4)
  for (const link of await page.locator('.fh-occasion-grid a').all()) await expect(link).toHaveAttribute('href', '/register?redesign=1')
})

test('homepage mobile menu exposes all links and closes accessibly', async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width: 360, height: 844 })
  await navigate(page, 'Home')
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  const toggle = nav.getByRole('button', { name: 'Open navigation menu' })
  await toggle.click()
  await expect(nav.getByRole('link', { name: 'Product', exact: true })).toBeFocused()
  for (const label of ['Product', 'Design Studio', 'Plan & run events', 'Your kind of event', 'Find events', 'Pricing']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await nav.getByRole('link', { name: 'Your kind of event', exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#occasions')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await toggle.click()
  await page.mouse.click(4, 800)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('homepage anchor survives event cards arriving after initial layout', async ({ page }) => {
  await setup(page)
  await page.route('**/api/ticketing/public/events', async route => {
    await new Promise(resolve => setTimeout(resolve, 300))
    await route.fulfill({ json: { events: [{ id: 'fixture-public-event', name: 'Local event preview', event_date: '2027-02-08T12:00:00Z', venue_name: 'Fixture venue', timing: 'upcoming' }] } })
  })
  await page.goto('/?delayed-events=1#pricing')
  await expect(page.getByRole('link').filter({ hasText: 'Local event preview' })).toBeVisible()
  await expect.poll(async () => Math.round((await page.locator('#pricing').boundingBox()).y)).toBe(110)
})

const discoveryEvents = [
  { id: 'late-event', name: 'Autumn Gathering', event_date: '2099-10-20T12:00:00Z', timezone: 'UTC', venue_name: 'Garden Hall', organizer_name: 'Community Team', event_type: 'Community', currency: 'USD', from_price: 2500, sales_url: '/tickets/e/late-event', timing: 'upcoming' },
  { id: 'early-event', name: 'Spring Concert', event_date: '2099-04-10T12:00:00Z', timezone: 'UTC', venue_name: 'River Stage', organizer_name: 'Music Collective', event_type: 'Music', currency: 'NGN', from_price: 750000, sales_url: '/tickets/e/early-event', timing: 'upcoming' },
  { id: 'current-event', name: 'Open Studio', event_date: '2099-01-01T12:00:00Z', timezone: 'UTC', venue_name: 'Arts House', organizer_name: 'Local Artists', event_type: 'Art', currency: 'USD', from_price: 0, sales_url: '/tickets/e/current-event', timing: 'current' },
]

test('event discovery filters real listings, sorts dates and preserves event links and currencies', async ({ page }) => {
  await setup(page)
  await page.route('**/api/ticketing/public/events', route => route.fulfill({ json: { events: discoveryEvents } }))
  await navigate(page, 'Discover')
  await expect(page).toHaveTitle('Discover events & experiences | Festio')
  await expect(page.locator('.ptd-card h3')).toHaveText(['Open Studio', 'Spring Concert', 'Autumn Gathering'])
  await expect(page.locator('.ptd-card').filter({ hasText: 'Spring Concert' }).getByRole('link')).toHaveAttribute('href', '/tickets/e/early-event')
  await expect(page.locator('.ptd-card').filter({ hasText: 'Spring Concert' }).locator('strong')).toContainText('7,500.00')
  await expect(page.locator('.ptd-card').filter({ hasText: 'Spring Concert' }).locator('strong')).toContainText(/NGN|₦/)
  await page.getByRole('button', { name: 'Coming up', exact: true }).click()
  await expect(page.locator('.ptd-card h3')).toHaveText(['Spring Concert', 'Autumn Gathering'])
  await page.getByLabel('Sort events').selectOption('latest')
  await expect(page.locator('.ptd-card h3')).toHaveText(['Autumn Gathering', 'Spring Concert'])
  await page.getByLabel('Search events').fill('Music Collective')
  await expect(page.locator('.ptd-card h3')).toHaveText(['Spring Concert'])
  await page.getByLabel('Search events').fill('nothing-matches')
  await expect(page.getByRole('heading', { name: 'A different search, perhaps?' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search & filters' }).click()
  await page.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('Art')
  await expect(page.locator('.ptd-card h3')).toHaveText(['Open Studio'])
  expect(await page.evaluate(() => window.fixtureDemoRequests || [])).toEqual([])
})

test('event discovery distinguishes retryable errors from an empty catalog and works on mobile', async ({ page }) => {
  await setup(page)
  let fail = true
  await page.route('**/api/ticketing/public/events', route => fail ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.fulfill({ json: { events: [] } }))
  await navigate(page, 'Discover')
  await expect(page.getByRole('alert')).toContainText('We couldn’t load the events right now.')
  await expect(page.getByRole('heading', { name: 'Good things are on the way.' })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Good things are on the way.' })).toBeVisible()
  await page.setViewportSize({ width: 360, height: 844 })
  await expect(page.getByRole('link', { name: 'Create event', exact: false }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
