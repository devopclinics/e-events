import { test, expect } from '@playwright/test'

// Regression test for a real bug found on a live event: a flyer template's
// stock preview thumbnail (asset_config.flyer_image_url, set just by picking
// a template — see chooseFlyerTemplate in the legacy Design Studio) always
// outranked an organizer's own uploaded photo (asset_config.cover_image_url)
// in designCover(), so an uploaded photo could never actually appear on the
// live guest page. Read-only against the public /invite page via the same
// studio-preview sessionStorage handoff used elsewhere — no design record
// writes, so the shared QA fixture is untouched.
//
// The hero used to render the cover photo as a poster <img> in a two-column
// layout; it's now a full-bleed banner on .gh-hero (the whole GuestHub page
// was extended to carry the flyer as a banner, not just a separate card) —
// a blurred cover-fill backdrop plus the uncropped photo on top (avoids
// cutting off subjects when the photo's aspect ratio doesn't match a wide
// short banner), both as background-image on child divs, not on .gh-hero
// itself. Assert the second (foreground, uncropped) layer's src.
test.describe('Stage C guest hero — cover photo vs. flyer image priority', () => {
  const eventId = process.env.E2E_EVENT_ID

  test('an uploaded cover photo wins over a flyer_image_url placeholder, and restores the title overlay', async ({ page }) => {
    await page.goto(`/invite/${eventId}`)
    await page.evaluate(({ id }) => {
      sessionStorage.setItem(`festio:design-preview:${id}`, JSON.stringify({
        event_id: id,
        theme: {
          event_id: id,
          is_default: false,
          colors: {},
          wording: { eventTitle: 'Cover Priority QA' },
          cover_image_url: 'https://picsum.photos/seed/cover-priority-qa/800/1000',
          flyer_image_url: 'https://picsum.photos/seed/flyer-placeholder-qa/800/1000',
        },
        saved_at: Date.now(),
      }))
    }, { id: eventId })
    await page.goto(`/invite/${eventId}?studio-preview=1`)

    const hero = page.locator('.gh-hero')
    await expect(hero).toBeVisible()
    const photoLayer = hero.locator('div').nth(1)
    await expect(photoLayer).toHaveCSS('background-image', /cover-priority-qa/)
    await expect(photoLayer).toHaveCSS('background-size', 'contain')
    // flyerLedHero must be false here (cover_image_url present) — the real
    // <h1> title renders instead of the sr-only fallback flyer-led mode uses.
    await expect(page.getByRole('heading', { name: 'Cover Priority QA', level: 1 })).toBeVisible()
  })
})
