import { test, expect } from '@playwright/test'
import { axeSeriousViolations, expectQaEventLoaded, formatAxeViolations, requiredEnv, signIn } from './helpers.js'

test.describe.configure({ mode: 'serial' })
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

test.describe('Stage C operations — isolated staging fixture', () => {
  test.beforeEach(async ({ page }) => { await signIn(page) })

  test('redesign seating/operations page has no serious/critical accessibility violations', async ({ page }) => {
    await page.goto('/addons-redesign?tab=seating')
    await expectQaEventLoaded(page)
    const violations = await axeSeriousViolations(page)
    expect(violations, formatAxeViolations(violations)).toEqual([])
  })

  test('seating uses confirmed table CRUD and floor-plan handoff', async ({ page }) => {
    const name = `E2E Table ${suffix}`
    const editedName = `${name} Edited`
    await page.goto('/addons-redesign?tab=seating')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    const add = page.getByRole('button', { name: 'Table', exact: true })
    await expect(add.or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have seating enabled')

    try {
      await add.click()
      await page.getByLabel('Table name').fill(name)
      await page.getByLabel('Capacity').fill('4')
      await page.getByLabel('Category').fill('Synthetic QA')
      await page.getByRole('button', { name: 'Create table', exact: true }).click()
      await expect(page.getByText('Table saved', { exact: true })).toBeVisible()
      await expect(page.getByText(name, { exact: true })).toBeVisible()

      let card = page.locator('.ad-table-command-card').filter({ hasText: name })
      await card.getByRole('button', { name: 'Edit table', exact: true }).click()
      await card.getByLabel('Table name').fill(editedName)
      await card.getByLabel('Table order').fill('7')
      await card.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(page.getByText('Table saved', { exact: true })).toBeVisible()
      card = page.locator('.ad-table-command-card').filter({ hasText: editedName })
      await expect(card).toBeVisible()
      await expect(card.locator('.ad-table-order')).toHaveText('#7')

      await card.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText(editedName, { exact: true })).toHaveCount(0)
    } finally {
      if (!page.isClosed()) {
        for (const tableName of [editedName, name]) {
          const card = page.locator('.ad-table-command-card').filter({ hasText: tableName })
          if (await card.count()) {
            await card.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
            await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          }
        }
      }
    }
  })

  test('seating chart assigns and unassigns guests to specific seats, including a new VVIP', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const tableName = `E2E Chart Table ${suffix}`
    const guestName = `E2E Chart Guest ${suffix}`
    const vvipLastName = `VVIP ${suffix}`
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    await page.goto('/addons-redesign?tab=seating')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    test.skip(await locked.isVisible(), 'The isolated QA event must have seating enabled')
    expect(authorization).toMatch(/^Bearer /)

    const table = await (await page.request.post(`/api/events/${eventId}/tables`, {
      headers: { Authorization: authorization }, data: { name: tableName, capacity: 2 },
    })).json()
    const [firstName, ...rest] = guestName.split(' ')
    const guest = await (await page.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: authorization }, data: { first_name: firstName, last_name: rest.join(' ') },
    })).json()
    let vvipGuestId = null

    try {
      await page.reload()
      await expectQaEventLoaded(page)
      await page.getByRole('button', { name: 'Show Seating Chart', exact: false }).click()
      const card = page.locator('.ad-chart-card').filter({ hasText: tableName })
      await expect(card).toBeVisible()
      const toast = page.locator('.rd-toast')

      // Reserve a seat for the existing synthetic guest via the search picker.
      await card.locator('.ad-chart-seat.empty').first().click()
      await page.getByPlaceholder('Search by name or email…').fill(guestName)
      await page.getByRole('button', { name: guestName, exact: false }).click()
      await expect(toast).toContainText('Seat assigned')
      await expect(card.locator('.ad-chart-seat.filled').filter({ hasText: guestName })).toBeVisible()

      // Unassign requires confirmation.
      await card.locator('.ad-chart-seat.filled').filter({ hasText: guestName }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Unassign', exact: true }).click()
      await expect(toast).toContainText('Guest unassigned from seat')
      await expect(card.locator('.ad-chart-seat.filled')).toHaveCount(0)

      // "+ Add VVIP" creates a brand-new guest and seats them in one action.
      await card.locator('.ad-chart-seat.empty').first().click()
      await page.getByRole('button', { name: '+ Add VVIP', exact: true }).click()
      await page.getByPlaceholder('First name *').fill('E2E')
      await page.getByPlaceholder('Last name *').fill(vvipLastName)
      await page.getByRole('button', { name: /Reserve .* Seat/ }).click()
      await expect(toast).toContainText('added & seated')
      await expect(card.locator('.ad-chart-seat.filled').filter({ hasText: vvipLastName })).toBeVisible()

      const allGuests = await (await page.request.get(`/api/events/${eventId}/guests`, { headers: { Authorization: authorization } })).json()
      vvipGuestId = allGuests.find((g) => g.last_name === vvipLastName)?.id
      expect(vvipGuestId, 'the VVIP guest must have been created by the modal').toBeTruthy()
    } finally {
      if (vvipGuestId) await page.request.delete(`/api/events/${eventId}/guests/${vvipGuestId}`, { headers: { Authorization: authorization } }).catch(() => {})
      await page.request.delete(`/api/events/${eventId}/guests/${guest.id}`, { headers: { Authorization: authorization } }).catch(() => {})
      await page.request.delete(`/api/events/${eventId}/tables/${table.id}`, { headers: { Authorization: authorization } }).catch(() => {})
    }
  })

  test('table groups use confirmed create, edit, and delete', async ({ page }) => {
    const original = `E2E Group ${suffix}`
    const edited = `${original} Edited`
    await page.goto('/addons-redesign?tab=seating')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    const add = page.getByRole('button', { name: 'Table Group', exact: true })
    await expect(add.or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have seating enabled')

    try {
      await add.click()
      await page.getByLabel('Group name').fill(original)
      await page.getByLabel('Group tag').fill(`e2e-${suffix}`)
      await page.getByRole('button', { name: 'Save group', exact: true }).click()
      await expect(page.getByText('Table group saved', { exact: true })).toBeVisible()
      const card = page.locator('.ad-group-card').filter({ hasText: original })
      await card.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByLabel('Group name').fill(edited)
      await page.getByRole('button', { name: 'Save group', exact: true }).click()
      await expect(page.locator('.ad-group-card').filter({ hasText: edited })).toBeVisible()
      await page.locator('.ad-group-card').filter({ hasText: edited }).getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Table group deleted', { exact: true })).toBeVisible()
      await expect(page.locator('.ad-group-card').filter({ hasText: edited })).toHaveCount(0)
    } finally {
      if (!page.isClosed()) {
        for (const name of [edited, original]) {
          const card = page.locator('.ad-group-card').filter({ hasText: name })
          if (await card.count()) await card.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('menu items use confirmed create, edit, and delete', async ({ page }) => {
    const categoryName = `E2E Category ${suffix}`
    const original = `E2E Item ${suffix}`
    const edited = `${original} Edited`
    await page.goto('/addons-redesign?tab=orders')
    await expectQaEventLoaded(page)
    const locked = page.getByRole('button', { name: 'Upgrade to enable', exact: true })
    const addCategory = page.getByRole('button', { name: 'Category', exact: true })
    await expect(addCategory.or(locked)).toBeVisible()
    test.skip(await locked.isVisible(), 'The isolated QA event must have orders enabled')

    try {
      await addCategory.click()
      await page.getByLabel('Category name').fill(categoryName)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Order category saved', { exact: true })).toBeVisible()
      const category = page.locator('.ad-cat-panel').filter({ hasText: categoryName })
      const add = category.getByRole('button', { name: '+ Item', exact: true })
      await add.click()
      await page.getByLabel('Item name').fill(original)
      await page.getByLabel('Item description').fill('Synthetic staging item')
      await page.getByRole('button', { name: 'Save item', exact: true }).click()
      await expect(page.getByText('Order item saved', { exact: true })).toBeVisible()
      const row = page.locator('.ad-cat-item').filter({ hasText: original })
      await row.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByLabel('Item name').fill(edited)
      await page.getByRole('button', { name: 'Save item', exact: true }).click()
      const editedRow = page.locator('.ad-cat-item').filter({ hasText: edited })
      await expect(editedRow).toBeVisible()
      await editedRow.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Order item deleted', { exact: true })).toBeVisible()
      await expect(editedRow).toHaveCount(0)
      await category.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Order category deleted', { exact: true })).toBeVisible()
    } finally {
      if (!page.isClosed()) {
        for (const name of [edited, original]) {
          const row = page.locator('.ad-cat-item').filter({ hasText: name })
          if (await row.count()) {
            await row.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
            await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          }
        }
        const category = page.locator('.ad-cat-panel').filter({ hasText: categoryName })
        if (await category.count()) {
          await category.getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
          await page.locator('.rr-modal').getByRole('button', { name: 'Delete', exact: true }).click().catch(() => {})
        }
      }
    }
  })

  test('kitchen reads the real dashboard without invented workflow states', async ({ page }) => {
    await page.goto('/kitchen-redesign')
    await expect(page.getByRole('heading', { name: 'Kitchen Display' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Order queue' })).toBeVisible()
    await expect(page.getByText('Preparing', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(0)
  })

  test('kitchen marks a guest served through the real fulfillment endpoint', async ({ page }) => {
    const eventId = requiredEnv('E2E_EVENT_ID')
    const lastName = `Kitchen Guest ${suffix}`
    let authorization = ''
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization
    })

    await page.goto('/kitchen-redesign')
    await expect(page.getByRole('heading', { name: 'Kitchen Display' })).toBeVisible()
    expect(authorization).toMatch(/^Bearer /)

    const guest = await (await page.request.post(`/api/events/${eventId}/guests`, {
      headers: { Authorization: authorization }, data: { first_name: 'E2E', last_name: lastName },
    })).json()

    try {
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Kitchen Display' })).toBeVisible()
      const card = page.locator('.kn-order-card').filter({ hasText: `E2E ${lastName}` })
      await expect(card).toBeVisible()
      await expect(card.getByText('Pending', { exact: true })).toBeVisible()

      await card.getByRole('button', { name: 'Mark served', exact: true }).click()
      // The "Pending" filter (default view) drops the card the instant it's
      // served, so switch to "Served" to see its new state in the DOM.
      await page.getByRole('button', { name: 'Served', exact: true }).click()
      const servedCard = page.locator('.kn-order-card').filter({ hasText: `E2E ${lastName}` })
      await expect(servedCard.locator('.kn-served-badge')).toBeVisible()
      await expect(servedCard.getByRole('button', { name: 'Mark served', exact: true })).toHaveCount(0)

      const guests = await (await page.request.get(`/api/events/${eventId}/guests`, {
        headers: { Authorization: authorization },
      })).json()
      const updated = guests.find((g) => g.id === guest.id)
      expect(updated?.meal_served).toBe(true)
    } finally {
      await page.request.delete(`/api/events/${eventId}/guests/${guest.id}`, {
        headers: { Authorization: authorization },
      }).catch(() => {})
    }
  })

  test('floor-plan redesign entry opens the production editor for the selected event', async ({ page }) => {
    await page.goto('/floorplan-redesign')
    await expect(page).toHaveURL(/\/floorplan-redesign\/[^/]+$/)
    expect(new URL(page.url()).pathname).not.toBe('/floorplan-redesign')
    await expect(page.getByText(/Floor plan/i).first()).toBeVisible()
  })
})
