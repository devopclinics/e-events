import { test, expect } from '@playwright/test'

// These exercise the actual production render path in InvitePage.jsx —
// isStudioPreview, GuestHub's previewMock sample data, and the per-hubStyle
// tab order/CSS — via the same sessionStorage handoff Design Studio's
// syncDraftPreviewStorage() uses. No design record is written, so the shared
// QA fixture (E2E_EVENT_ID) is never touched: this is read-only against the
// public /invite page.
test.describe('Stage C FestioHub style — real guest-facing render', () => {
  const eventId = process.env.E2E_EVENT_ID

  async function previewWithStyle(page, hubStyle) {
    // Land on the event's own origin first so sessionStorage is set for the
    // right page before the studio-preview reload reads it back.
    await page.goto(`/invite/${eventId}`)
    await page.evaluate(({ id, style }) => {
      sessionStorage.setItem(`festio:design-preview:${id}`, JSON.stringify({
        event_id: id,
        theme: { event_id: id, is_default: false, colors: {}, wording: {}, hub_style: style },
        saved_at: Date.now(),
      }))
    }, { id: eventId, style: hubStyle })
    await page.goto(`/invite/${eventId}?studio-preview=1`)
  }

  test('renders with sample data and no real RSVP for every style, each with a distinct real arrangement', async ({ page }) => {
    await previewWithStyle(page, 'wallet-pass')
    await expect(page.getByRole('heading', { name: 'FestioHub' })).toBeVisible()
    await expect(page.getByRole('tab').first()).toHaveText(/Pass/)

    await previewWithStyle(page, 'story-feed')
    await expect(page.getByRole('tab').first()).toHaveText(/Activity/)

    // Non-tabbed styles render every section at once (no tab gating), so the
    // Pass module's sample data is always visible here — the clearest place
    // to prove the preview uses previewMock sample data, not a real guest.
    await previewWithStyle(page, 'card-dashboard')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.locator('.fh-hub-style-card-dashboard')).toBeVisible()
    await expect(page.getByText('Ada Guest')).toBeVisible()

    await previewWithStyle(page, 'timeline')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.locator('.fh-hub-style-timeline')).toBeVisible()

    await previewWithStyle(page, 'minimal-list')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.locator('.fh-hub-style-minimal-list')).toBeVisible()
  })
})
