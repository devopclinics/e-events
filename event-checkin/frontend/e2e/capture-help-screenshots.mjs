// Re-captures the help2-*.png screenshot set used by both the customer Help
// Guide (frontend/src/guideContent.mjs) and the operator Media Library
// (frontend/src/pages/MediaPage.jsx SCREENSHOTS). Run this whenever the
// redesign UI changes enough that these go stale again.
//
// Uses the same reusable fixture as the original 2026-07 refresh (see
// project_help_landing_refresh memory): Firebase account
// help-screenshots@devopclinics.com + staging demo event "Demo — Graduation
// & Awards Night" (paid tier300, all add-ons on, seeded data). The account's
// password isn't persisted anywhere — reset it via Firebase Admin first:
//
//   docker exec event-checkin-backend-1 python -c "
//   from firebase_admin import auth as firebase_auth
//   from app.auth import _ensure_firebase
//   _ensure_firebase()
//   firebase_auth.update_user('bWwrytuUz5StIMXbIxNA4Ked26w1', password='<new password>')
//   "
//
// Then run (from frontend/, with node on PATH):
//   SHOT_PASSWORD='<new password>' E2E_BASE_URL='http://127.0.0.1:4000' node e2e/capture-help-screenshots.mjs
//
// Set SKIP_ADMIN=1 to only re-run the 3 guest-facing captures (faster
// iteration when only those are broken).

import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4000'
const EMAIL = 'help-screenshots@devopclinics.com'
const PASSWORD = process.env.SHOT_PASSWORD
const EVENT_ID = '0a948baf-3062-41fd-8d51-94a09d1f24f0'
const OUT_DIR = 'public/media'

if (!PASSWORD) throw new Error('SHOT_PASSWORD env var required')

// Admin-side pages — one screenshot per redesign route/tab.
const shots = [
  { file: 'help2-event-setup.png', path: '/admin-redesign' },
  { file: 'help2-guests.png', path: '/guests-redesign?tab=guests' },
  { file: 'help2-invites-rsvp.png', path: '/guests-redesign?tab=invite' },
  { file: 'help2-seating.png', path: '/addons-redesign?tab=seating' },
  { file: 'help2-menu-fields.png', path: '/addons-redesign?tab=orders' },
  { file: 'help2-orders.png', path: '/kitchen-redesign' },
  { file: 'help2-entry-areas.png', path: '/checkin-redesign?tab=zones' },
  { file: 'help2-team.png', path: '/team-redesign?tab=team' },
  { file: 'help2-checkin.png', path: '/scanner-redesign' },
  { file: 'help2-results.png', path: '/event-results-redesign' },
  { file: 'help2-event-pass.png', path: '/billing-redesign?tab=billing' },
  { file: 'help2-deliveries.png', path: '/addons-redesign?tab=logistics' },
  { file: 'help2-gift-list.png', path: '/addons-redesign?tab=registry' },
]

// Two sub-sections within the Invite tab, not separate pages — scrolled to
// by heading text rather than a route.
const inviteSubsections = [
  { file: 'help2-rsvp-fields.png', text: 'RSVP form fields' },
  { file: 'help2-categories.png', text: 'Category invitee limits & table-category mapping' },
]

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()

  await page.goto(BASE + '/login')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  const profileReady = page.waitForResponse((r) => r.url().includes('/api/auth/me') && r.status() === 200)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await profileReady
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(750)

  await page.evaluate((id) => {
    localStorage.setItem('eq.currentEventId', id)
    localStorage.setItem('theme', 'dark')
  }, EVENT_ID)

  // The redesign-preview status banner ("Switch to legacy UI") is internal
  // operator chrome — must never leak into customer-facing Help Guide docs.
  await page.addStyleTag({ content: '.rd-mockflag { display: none !important; }' })

  // Guest-facing pages need a real guest's tokens — fetched the same way the
  // admin's own browser session already legitimately has them (an
  // authenticated call to the real guests endpoint), not a DB extraction.
  const guestLinks = await page.evaluate(async (eventId) => {
    const token = await new Promise((resolve) => {
      const req = indexedDB.open('firebaseLocalStorageDb')
      req.onsuccess = () => {
        const tx = req.result.transaction('firebaseLocalStorage', 'readonly')
        tx.objectStore('firebaseLocalStorage').getAll().onsuccess = (e) => {
          resolve(e.target.result.find((r) => r?.value?.stsTokenManager?.accessToken)?.value?.stsTokenManager?.accessToken || '')
        }
      }
    })
    const res = await fetch(`/api/events/${eventId}/guests`, { headers: { Authorization: `Bearer ${token}` } })
    const guests = await res.json()
    const withQr = guests.find((g) => g.qr_token && g.rsvp_status === 'confirmed') || guests.find((g) => g.qr_token) || guests[0]
    return { qr_token: withQr?.qr_token || '', invite_token: withQr?.invite_token || '' }
  }, EVENT_ID)
  console.log('guest links:', guestLinks)

  const guestShots = [
    { file: 'help2-guest-invite.png', path: `/invite/${EVENT_ID}` },
  ]
  if (guestLinks.qr_token) guestShots.push({ file: 'help2-festio-pass.png', path: `/scan/${guestLinks.qr_token}` })
  if (guestLinks.invite_token) guestShots.push({ file: 'help2-festiohub.png', path: `/r/${guestLinks.invite_token}#guest-hub` })

  for (const sub of (process.env.SKIP_ADMIN ? [] : inviteSubsections)) {
    console.log('capturing (subsection)', sub.file)
    try {
      await page.goto(BASE + '/guests-redesign?tab=invite', { waitUntil: 'networkidle', timeout: 30000 })
      await page.addStyleTag({ content: '.rd-mockflag { display: none !important; }' })
      await page.waitForTimeout(1500)
      await page.getByText(sub.text).first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT_DIR}/${sub.file}` })
      console.log('  ok')
    } catch (e) {
      console.log('  FAILED:', e.message)
    }
  }

  for (const shot of (process.env.SKIP_ADMIN ? [] : shots)) {
    console.log('capturing', shot.file, shot.path)
    try {
      await page.goto(BASE + shot.path, { waitUntil: 'networkidle', timeout: 30000 })
      await page.addStyleTag({ content: '.rd-mockflag { display: none !important; }' })
      // Team page's member count briefly shows "Loading..." even after
      // networkidle — known minor cosmetic issue, not worth chasing further
      // here; the extra wait reduces but doesn't eliminate it.
      await page.waitForTimeout(shot.file.includes('team') ? 2500 : 1200)
      await page.screenshot({ path: `${OUT_DIR}/${shot.file}` })
      console.log('  ok')
    } catch (e) {
      console.log('  FAILED:', e.message)
    }
  }

  // Taller viewport for guest pages — the Festio Pass has a sticky "jump to
  // food menu" bar that triggers near the bottom of a short viewport and
  // overlaps the page footer in a single static screenshot.
  await page.setViewportSize({ width: 1600, height: 1300 })

  for (const shot of guestShots) {
    console.log('capturing (guest-facing)', shot.file, shot.path)
    try {
      await page.goto(BASE + shot.path, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(shot.file.includes('festio-pass') ? 2800 : 1500)
      // #guest-hub only auto-scrolls in Design Studio's own preview context
      // (InvitePage.jsx ~1333) — a plain page load with the hash already in
      // the URL misses the browser's one-shot native anchor-scroll because
      // the section isn't in the DOM yet when it fires. Do it ourselves.
      if (shot.file.includes('festiohub')) {
        await page.evaluate(() => document.getElementById('guest-hub')?.scrollIntoView({ block: 'start' }))
        await page.waitForTimeout(800)
      }
      await page.screenshot({ path: `${OUT_DIR}/${shot.file}` })
      console.log('  ok')
    } catch (e) {
      console.log('  FAILED:', e.message)
    }
  }

  await browser.close()
}

main()
