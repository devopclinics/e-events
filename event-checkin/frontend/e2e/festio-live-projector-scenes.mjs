import { chromium } from 'playwright'

const base = process.env.E2E_BASE_URL || 'https://staging.festio.events'
const token = process.env.ENGAGEMENT_TOKEN
if (!token) throw new Error('ENGAGEMENT_TOKEN is required')

const scenes = [
  'welcome', 'join', 'agenda', 'question', 'responding', 'results',
  'correct_answer', 'leaderboard', 'team_battle', 'rating', 'feedback',
  'word_cloud', 'q_and_a', 'room_pulse', 'ai_insight', 'idea_galaxy',
  'announcement', 'break', 'countdown', 'celebration', 'custom_message',
]
const sizes = [[1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]]

async function engagement(path, options = {}) {
  const response = await fetch(`${base}/api/engagement/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}`)
  return response.status === 204 ? null : response.json()
}

const displays = await engagement('/displays')
if (displays.length < 2) throw new Error('At least two retained displays are required for isolation validation')
const target = displays[0]
const control = displays[1]
const original = { scene: target.scene, settings: target.settings, assigned_activity_id: target.assigned_activity_id }
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

try {
  for (const scene of scenes) {
    await engagement(`/displays/${target.id}`, { method: 'PATCH', body: JSON.stringify({ scene }) })
    await page.goto(`${base}/live/${target.display_code}?token=${encodeURIComponent(target.access_token)}`, { waitUntil: 'networkidle' })
    await page.locator('.flb-root').waitFor()
    // The deliberately low-profile "Present" button belongs to the audience
    // display itself.  Projector pages must never expose organizer inputs or
    // any other action controls.
    if (await page.locator('input,select,textarea,button:not(.flb-present)').count()) throw new Error(`${scene} exposed an interactive admin control`)
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height })
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - document.documentElement.clientWidth)
      if (overflow > 2) throw new Error(`${scene} overflowed by ${overflow}px at ${width}x${height}`)
    }
    const latest = await engagement('/displays')
    const other = latest.find((display) => display.id === control.id)
    if (!other || other.scene !== control.scene || other.assigned_activity_id !== control.assigned_activity_id) throw new Error(`${scene} leaked state into another display`)
  }
} finally {
  await engagement(`/displays/${target.id}`, { method: 'PATCH', body: JSON.stringify(original) })
  await browser.close()
}

console.log(JSON.stringify({ projectorScenes: 'pass', scenes: scenes.length, resolutions: sizes.map(([w, h]) => `${w}x${h}`), displayIsolation: true, restored: true }))
