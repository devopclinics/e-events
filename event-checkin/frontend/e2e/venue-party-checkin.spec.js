import { test, expect } from '@playwright/test'
const TOKEN = 'synthetic-personal-token-for-venue'
async function fixture(page, rejectLocation = false, lookup = false, code = 'QA2026') {
  const rows = [{ id: 'lead', name: 'Primary Attendee', admitted: false }, { id: 'arrived', name: 'Arrived Companion', admitted: false }, { id: 'later', name: 'Later Companion', admitted: false }]
  const submissions = [], errors = [], searches = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/e/${code}`) return route.fulfill({ json: { status: 'ok', name: code === 'iedpu26' ? 'IEDPU USA 3rd Biennial Convention' : 'QA Venue Event', location_required: true, party_enabled: true, personal_link_required: !lookup, lookup_enabled: lookup, venue_name: 'QA Hotel' } })
    if (path === `/api/e/${code}/lookup`) {
      const body = route.request().postDataJSON(); searches.push(body)
      return route.fulfill({ json: { matches: body.query === 'Nobody' ? [] : [{ name: 'Primary Attendee', lookup_token: 'lookup.fixture.9999999999.signature' }], message: body.query === 'Nobody' ? 'No matching registration found. Try another name, phone number or email.' : null } })
    }
    if (path === `/api/e/${code}/party`) {
      expect(route.request().postDataJSON().token).toBe(lookup ? 'lookup.fixture.9999999999.signature' : TOKEN)
      return route.fulfill({ json: { viewer_id: 'lead', members: rows } })
    }
    if (path === `/api/e/${code}/party/checkin`) {
      const body = route.request().postDataJSON(); submissions.push(body)
      if (rejectLocation) return route.fulfill({ status: 403, json: { detail: 'You need to be at the venue to check in.' } })
      rows.forEach(m => { if (body.guest_ids.includes(m.id)) m.admitted = true })
      return route.fulfill({ json: body.guest_ids.map(id => ({ status: 'admitted', admitted_guest: rows.find(m => m.id === id).name, message: 'Checked in. Welcome!', table_name: 'A', seat_number: '2' })) })
    }
    return route.fulfill({ status: 404, json: { detail: 'Fixture has no such endpoint' } })
  })
  return { submissions, errors, searches }
}
for (const path of ['/e/QA2026', '/selfcheckin-redesign/QA2026']) {
  test(`selected arrivals and fresh location on ${path}`, async ({ page }) => {
    const { submissions, errors } = await fixture(page)
    await page.goto(`${path}#token=${TOKEN}`)
    await expect(page.getByRole('heading', { name: 'QA Venue Event' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /Primary Attendee/ })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Check in 1 guest', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: /Arrived Companion/ }).check()
    await expect(page.getByRole('checkbox', { name: /Later Companion/ })).not.toBeChecked()
    await page.getByRole('checkbox', { name: /I confirm everyone selected/ }).check()
    await page.getByRole('button', { name: 'Check in 2 guests' }).click()
    await expect(page.getByRole('heading', { name: 'Check-in results' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /Arrived Companion/ })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: /Later Companion/ })).toBeEnabled()
    expect(submissions).toHaveLength(1)
    expect(submissions[0].guest_ids).toEqual(['lead', 'arrived'])
    expect(submissions[0].confirm_arrived).toBe(true)
    expect(submissions[0].location.latitude).toBeCloseTo(32.835620)
    expect(Date.now() - Date.parse(submissions[0].location.captured_at)).toBeLessThan(90000)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}
test('outside venue denial retains selection', async ({ page }) => {
  const { submissions } = await fixture(page, true)
  await page.goto(`/e/QA2026#token=${TOKEN}`)
  await page.getByRole('checkbox', { name: /I confirm everyone selected/ }).check()
  await page.getByRole('button', { name: 'Check in 1 guest', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('You need to be at the venue')
  await expect(page.getByRole('checkbox', { name: /Primary Attendee/ })).toBeEnabled()
  expect(submissions).toHaveLength(1)
  await expect(page.getByRole('heading', { name: 'Check-in results' })).toHaveCount(0)
})
test('denied phone location never submits admission', async ({ page }) => {
  const { submissions } = await fixture(page)
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 }) })
  await page.goto(`/e/QA2026#token=${TOKEN}`)
  await page.getByRole('checkbox', { name: /I confirm everyone selected/ }).check()
  await page.getByRole('button', { name: 'Check in 1 guest', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Allow location access')
  expect(submissions).toHaveLength(0)
})
test('venue QR needs personal invitation before exposing party', async ({ page }) => {
  const { submissions } = await fixture(page)
  await page.goto('/e/QA2026')
  await expect(page.getByRole('textbox', { name: 'Your personal invitation link' })).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Your personal invitation link' }).fill(`https://festio.events/r/${TOKEN}#guest-hub`)
  await page.getByRole('button', { name: 'Find my registration' }).click()
  await expect(page.getByRole('checkbox', { name: /Primary Attendee/ })).toBeVisible()
  expect(submissions).toHaveLength(0)
})

for (const query of ['Primary Attendee', '(832) 555-0123', 'primary@example.test']) {
  test(`find registration using ${query} without personal link`, async ({ page }) => {
    const { searches, submissions } = await fixture(page, false, true)
    await page.goto('/e/QA2026')
    await expect(page.getByRole('textbox', { name: 'Your personal invitation link' })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Name, phone number or email' }).fill(query)
    await page.getByRole('button', { name: 'Find my registration' }).click()
    await page.getByRole('button', { name: 'Primary Attendee', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Who has arrived?' })).toBeVisible()
    expect(searches).toHaveLength(1)
    expect(searches[0].query).toBe(query)
    expect(searches[0].location.latitude).toBeCloseTo(32.835620)
    await page.getByRole('checkbox', { name: /I confirm everyone selected/ }).check()
    await page.getByRole('button', { name: 'Check in 1 guest', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check-in results' })).toBeVisible()
    expect(submissions[0].token).toBe('lookup.fixture.9999999999.signature')
    await page.getByRole('button', { name: 'Find another registration' }).click()
    await expect(page.getByRole('textbox', { name: 'Name, phone number or email' })).toBeVisible()
  })
}
test('location denial stops lookup before names are returned', async ({ page }) => {
  const { searches } = await fixture(page, false, true)
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 }) })
  await page.goto('/e/QA2026')
  await page.getByRole('textbox', { name: 'Name, phone number or email' }).fill('Primary')
  await page.getByRole('button', { name: 'Find my registration' }).click()
  await expect(page.getByRole('alert')).toContainText('Allow location access')
  expect(searches).toHaveLength(0)
})
test('no match provides a clear recovery message', async ({ page }) => {
  await fixture(page, false, true)
  await page.goto('/e/QA2026')
  await page.getByRole('textbox', { name: 'Name, phone number or email' }).fill('Nobody')
  await page.getByRole('button', { name: 'Find my registration' }).click()
  await expect(page.getByRole('status')).toContainText('No matching registration found')
  await expect(page.getByRole('group', { name: 'Who has arrived?' })).toHaveCount(0)
})


test('Ilorin welcome is branded, readable and keeps the arrival flow working', async ({ page }, testInfo) => {
  const { submissions, errors } = await fixture(page, false, true, 'iedpu26')
  await page.goto('/e/iedpu26')
  await expect(page.getByRole('heading', { name: 'Welcome to Dallas ’26.' })).toBeVisible()
  const photo = page.getByRole('img', { name: 'The golden domes and minarets of Ilorin Central Mosque' })
  await expect(photo).toBeVisible()
  await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('img', { name: 'IEDPU USA', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Check-in progress' })).toContainText('Find registration')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.getByRole('textbox', { name: 'Name, phone number or email' }).evaluate(el => getComputedStyle(el).fontSize)).toBe('16px')
  await page.screenshot({ path: testInfo.outputPath('ilorin-welcome.png'), fullPage: true })
  await page.getByRole('textbox', { name: 'Name, phone number or email' }).fill('Primary Attendee')
  await page.getByRole('button', { name: 'Find my registration' }).click()
  await page.getByRole('button', { name: 'Primary Attendee', exact: true }).click()
  await page.getByRole('checkbox', { name: /Arrived Companion/ }).check()
  await page.getByRole('checkbox', { name: /I confirm everyone selected/ }).check()
  await page.screenshot({ path: testInfo.outputPath('ilorin-party.png'), fullPage: true })
  await page.getByRole('button', { name: 'Check in 2 guests' }).click()
  await expect(page.getByRole('heading', { name: 'Check-in results' })).toBeVisible()
  expect(submissions[0].guest_ids).toEqual(['lead', 'arrived'])
  await expect(page.getByRole('checkbox', { name: /Later Companion/ })).toBeEnabled()
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
