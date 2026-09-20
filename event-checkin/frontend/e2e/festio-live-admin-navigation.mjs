// Offline browser regression for the real admin page. Only the network API,
// application shell, and Experience panel are replaced; no event data is sent
// to a server. Run: node e2e/festio-live-admin-navigation.mjs
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, expect } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const scratch = await mkdtemp(join(tmpdir(), 'festio-admin-navigation-'))
const virtual = (name) => `\0festio-admin-test:${name}`
const mocks = `
export const api = new Proxy({}, { get(_, method) { return async (...args) => {
  const test = window.__liveTest;
  test.calls.push({ method, args });
  if (method === 'listEvents') return ['event-one','event-two'].map(id => ({ id, name: id, engagement_enabled: true, experience_enabled: true }));
  if (method === 'liveActivities') return structuredClone(test.activities);
  if (method === 'liveDisplays') return structuredClone(test.displays);
  if (method === 'liveSettings') return {};
  if (method === 'liveJoinInfo') return { url: '/join/test', code: 'TEST' };
  if (method === 'liveGetActivity') {
    if (test.holdActivity === args[1]) await new Promise(resolve => { test.releaseActivity = resolve; });
    return structuredClone(test.activities.find(item => item.id === args[1]));
  }
  if (method === 'liveUpdateDisplay') {
    const display = test.displays.find(item => item.id === args[1]);
    Object.assign(display, { ...args[2], settings: { ...display.settings, ...args[2].settings } });
    return structuredClone(display);
  }
  if (method === 'liveDisconnectDisplay') {
    const display = test.displays.find(item => item.id === args[1]);
    display.devices = args[2] ? display.devices.filter(device => device.client_id !== args[2]) : [];
    display.connected_count = display.devices.length; display.connected = !!display.devices.length;
    return structuredClone(display);
  }
  return [];
} }});
`
const server = await createServer({
  root, configFile: false, cacheDir: join(scratch, 'vite'),
  logLevel: 'error', server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [{
    name: 'offline-admin-fixture',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:admin-entry') return virtual('entry')
      if (id === '../api') return virtual('api')
      if (id === './redesign/RedesignShell') return virtual('shell')
      if (id === '../components/live/ExperienceWorkflowsPanel') return virtual('experience')
    },
    load(id) {
      if (id === virtual('api')) return mocks
      if (id.endsWith('/src/api.js')) return mocks
      if (id.endsWith('/src/pages/redesign/RedesignShell.jsx')) return 'export const Icon = () => null; export default function Shell({children}) { return children; }'
      if (id.endsWith('/src/components/live/ExperienceWorkflowsPanel.jsx')) return 'import React from "react"; export default function Experience(props) { return React.createElement("pre", {"data-testid": "experience-context"}, JSON.stringify(props)); }'
      if (id === virtual('shell')) return 'export const Icon = () => null; export default function Shell({children}) { return children; }'
      if (id === virtual('experience')) return 'import React from "react"; export default function Experience(props) { return React.createElement("pre", {"data-testid": "experience-context"}, JSON.stringify(props)); }'
      if (id === virtual('entry')) return `
        import React, { useEffect } from 'react';
        import { createRoot } from 'react-dom/client';
        import Page from '/src/pages/FestioLiveRedesignPage.jsx';
        import { useCurrentEvent } from '/src/hooks/useCurrentEvent.js';
        import '/src/pages/redesign/RedesignShell.css';
        function Fixture() { const [, setEvent] = useCurrentEvent(); useEffect(() => { window.__switchEvent = setEvent; }, [setEvent]); return React.createElement(Page); }
        createRoot(document.getElementById('root')).render(React.createElement(Fixture));
      `
    },
    configureServer(vite) {
      vite.middlewares.use('/admin-test', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/admin-test', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:admin-entry"></script></body></html>'))
      })
    },
  }, react()],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const errors = []
async function fixture({ mobile = false, query = '?tab=Displays' } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route((url) => new URL(url).pathname.startsWith('/live/'), route => route.fulfill({ contentType: 'text/html', body: '<p>Screen preview</p>' }))
  await page.route((url) => new URL(url).pathname.startsWith('/live-display/'), route => route.fulfill({ contentType: 'text/html', body: '<p>Activity preview</p>' }))
  await page.addInitScript(() => {
    localStorage.setItem('eq.currentEventId', 'event-one')
    const activity = (id, title) => ({ id, title, type: 'poll', status: 'live', participant_count: 4, response_count: 3, config: { display_token: `token-${id}` }, questions: [{ id: `q-${id}`, question_type: 'single_choice', prompt: `${title} question`, status: 'active', options: [{ id: 'yes', label: 'Yes' }] }] })
    const display = (id, name) => ({ id, name, display_code: id, access_token: `token-${id}`, assigned_activity_id: 'activity-one', assigned_session_id: null, scene: 'join', settings: {}, status: 'active', connected: true, connected_count: 2, connection_limit: 2, connection_status_available: true, devices: [{ client_id: 'device-one', last_seen_at: new Date().toISOString() }, { client_id: 'device-two', last_seen_at: new Date().toISOString() }] })
    window.__liveTest = { calls: [], activities: [activity('activity-one', 'Opening poll'), activity('activity-two', 'Closing poll')], displays: [display('display-one', 'Main stage'), display('display-two', 'Lobby')] }
  })
  await page.goto(`${base}/admin-test${query}`)
  await expect(page.getByRole('combobox', { name: 'Target display', exact: true })).toHaveValue('display-one')
  return { page, context }
}
const tab = (page, name) => page.getByRole('navigation', { name: 'Festio Live sections' }).getByRole('button', { name, exact: true })
const card = (page, name = 'Main stage') => page.locator('.fl-display-card').filter({ has: page.getByText(name, { exact: true }) })

try {
  {
    const { page, context } = await fixture()
    const main = card(page)
    await expect(page.locator('iframe')).toHaveCount(0)
    await main.getByRole('combobox', { name: 'Activity for Main stage', exact: true }).selectOption('activity-two')
    await main.getByTitle('Current result', { exact: true }).click()
    await tab(page, 'Live Control').click()
    await expect(page.locator('iframe')).toHaveCount(0)
    await tab(page, 'Displays').click()
    await expect(main.getByRole('combobox', { name: 'Activity for Main stage', exact: true })).toHaveValue('activity-two')
    await expect(main.getByTitle('Current result', { exact: true })).toHaveClass('active')
    await main.getByRole('button', { name: 'Preview pending change', exact: true }).click()
    await expect(main.locator('iframe')).toHaveCount(1)
    assert.match(await main.locator('iframe').getAttribute('src'), /observer=true/)
    await main.getByRole('button', { name: 'Preview current screen', exact: true }).click()
    await expect(main.locator('iframe')).toHaveCount(1)
    assert.match(await main.locator('iframe').getAttribute('src'), /observer=true/)
    await tab(page, 'Activities').click()
    await expect(page.locator('iframe')).toHaveCount(0)
    await tab(page, 'Displays').click()
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(main.getByRole('combobox', { name: 'Activity for Main stage', exact: true })).toHaveValue('activity-two')
    assert.equal(await page.evaluate(() => window.__liveTest.calls.filter(call => call.method === 'liveUpdateDisplay').length), 0)
    await main.getByRole('combobox', { name: 'Activity for Main stage', exact: true }).selectOption('')
    await main.getByRole('button', { name: 'Clear activity on Main stage', exact: true }).click()
    await expect(main.getByRole('status')).toContainText('Main stage updated')
    const call = await page.evaluate(() => window.__liveTest.calls.find(call => call.method === 'liveUpdateDisplay'))
    assert.equal(call.args[2].assigned_activity_id, null)
    assert.equal(call.args[2].scene, 'welcome')
    assert.equal(call.args[2].settings.auto_follow_program, false)
    assert.equal(call.args[2].settings.follow_activity, false)
    await context.close()
    console.log('PASS: opt-in observer preview, one iframe, draft persistence, clear activity')
  }
  {
    const { page, context } = await fixture({ mobile: true, query: '?tab=Activities' })
    await page.evaluate(() => { window.__liveTest.holdActivity = 'activity-one' })
    await page.getByRole('combobox', { name: 'Switch activity', exact: true }).selectOption('activity-one')
    await expect(page.getByText('Loading activity controls…')).toBeVisible()
    await page.getByRole('combobox', { name: 'Switch activity', exact: true }).selectOption('activity-two')
    await expect(page.getByRole('heading', { name: 'Closing poll', exact: true })).toBeVisible()
    await page.evaluate(() => window.__liveTest.releaseActivity())
    await expect(page.getByRole('combobox', { name: 'Switch activity', exact: true })).toHaveValue('activity-two')
    await page.getByRole('combobox', { name: 'Target display', exact: true }).selectOption('display-two')
    await page.getByRole('button', { name: 'Send activity to screen', exact: true }).click()
    await expect(page.getByText('Closing poll sent to Lobby.', { exact: true })).toBeVisible()
    const calls = await page.evaluate(() => window.__liveTest.calls.filter(call => call.method === 'liveUpdateDisplay'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].args[1], 'display-two')
    assert.equal(calls[0].args[2].assigned_activity_id, 'activity-two')
    assert.equal(calls[0].args[2].settings.follow_activity, true)
    const controls = page.getByRole('region', { name: 'Live operator controls' })
    const bounds = await controls.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Operator controls fit the mobile viewport')
    await page.screenshot({ path: join(scratch, 'admin-mobile.png') })
    await context.close()
    console.log('PASS: direct mobile activity/display switching and stale activity request protection')
  }
  {
    const { page, context } = await fixture()
    const main = card(page)
    await main.getByText('Connected screens (2)', { exact: true }).click()
    page.on('dialog', dialog => dialog.accept())
    await main.getByRole('button', { name: 'Disconnect screen vice-one', exact: true }).click()
    await expect(main.getByText('Connected screens (1)', { exact: true })).toBeVisible()
    const call = await page.evaluate(() => window.__liveTest.calls.find(call => call.method === 'liveDisconnectDisplay'))
    assert.equal(call.args[2], 'device-one')
    assert.equal(await main.getByRole('button', { name: 'Disconnect screen vice-two', exact: true }).count(), 1)
    await context.close()
    console.log('PASS: disconnect one device while keeping the other connected')
  }
  {
    const { page, context } = await fixture({ query: '?present=1&event=event-two&workflow=workflow-two&run=run-two&display=display-one' })
    await expect(page.getByTestId('experience-context')).toContainText('"eventId":"event-two"')
    await expect(page.getByTestId('experience-context')).toContainText('"requestedWorkflowId":"workflow-two"')
    await expect(page.getByTestId('experience-context')).toContainText('"requestedRunId":"run-two"')
    assert.equal(await page.evaluate(() => localStorage.getItem('eq.currentEventId')), 'event-two')
    await page.getByRole('combobox', { name: 'Switch activity', exact: true }).selectOption('activity-two')
    await expect(page.getByRole('heading', { name: 'Closing poll', exact: true })).toBeVisible()
    await page.evaluate(() => window.__switchEvent('event-one'))
    await expect(page.getByRole('combobox', { name: 'Switch activity', exact: true })).toHaveValue('')
    await expect(page.getByTestId('experience-context')).toContainText('"eventId":"event-one"')
    await context.close()
    console.log('PASS: contextual presenter event/run links and event state isolation')
  }
  assert.deepEqual(errors, [], 'Browser raised no runtime errors')
  console.log('Festio Live admin navigation: 4 offline browser scenarios passed')
} finally {
  await browser.close()
  await server.close()
  await rm(scratch, { recursive: true, force: true })
}
