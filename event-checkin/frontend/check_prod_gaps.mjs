import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', err => console.log('page error:', err.message))

// 1. Contact form -> real backend
await page.goto('https://festio.events/landing-preview', { waitUntil: 'networkidle' })
await page.fill('#contact input[placeholder="Your name"]', 'Prod QA')
await page.fill('#contact input[placeholder="you@example.com"]', 'prod-qa@example.com')
const [resp] = await Promise.all([
  page.waitForResponse(r => r.url().includes('/demo-requests') && r.request().method() === 'POST'),
  page.click('#contact button[type="submit"]'),
])
console.log('demo-requests POST status:', resp.status())

// 2. Signup -> redesign setup
await page.goto('https://festio.events/landing-preview', { waitUntil: 'networkidle' })
await page.click('text=Create your event free')
await page.waitForURL('**/register**')
console.log('register url:', page.url())
const email = `redesign-prod-e2e-${Date.now()}@festio.events`
await page.fill('#register-name', 'Redesign Prod QA')
await page.fill('#register-email', email)
await page.fill('#register-password', 'Sup3rSecret!Pass')
await page.click('button[type="submit"]')
await page.waitForURL('**/setup-redesign**', { timeout: 20000 })
console.log('landed on:', page.url())

await browser.close()
console.log('done')
