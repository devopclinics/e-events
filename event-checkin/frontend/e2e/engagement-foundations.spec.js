import { test, expect } from '@playwright/test'

const fixtureChat = `<!doctype html><html><body><p>Local chat fixture</p><script>
  window.received = [];
  window.addEventListener('message', event => {
    if (typeof event.data === 'string' && event.data.startsWith('chatwoot-widget:')) window.received.push(JSON.parse(event.data.slice(16)));
  });
  window.parent.postMessage('chatwoot-widget:' + JSON.stringify({ event: 'loaded', config: { authToken: 'fixture-private-session' } }), '*');
</script></body></html>`

async function setup(page) {
  const requests = { signup: [], chat: [] }
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (['sales.chat.test', 'support.chat.test'].includes(url.hostname)) {
      requests.chat.push({ url: url.toString(), headers: request.headers() })
      return route.fulfill({ contentType: 'text/html', body: fixtureChat })
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
  expect(JSON.stringify(sent)).not.toMatch(/tenant-secret|old-support-session|identifier|org_name|email/)
  expect(requests.chat[0].url).toBe('https://sales.chat.test/widget?website_token=sales-fixture-inbox')
  expect(requests.chat[0].headers.referer).toBeUndefined()
  expect(await page.evaluate(() => window.fixtureIdentifyCalls || 0)).toBe(0)
  expect(await page.evaluate(() => window.fixtureSettingsCalls || 0)).toBe(0)
  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(sales).toBeFocused()
  await sales.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(requests.chat).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
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
