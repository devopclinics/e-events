import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('https://staging.festio.events/landing-preview', { waitUntil: 'networkidle' })
await page.click('nav >> text=Pricing')
await page.waitForURL('**/pricing-redesign')
console.log('nav pricing ->', page.url())
