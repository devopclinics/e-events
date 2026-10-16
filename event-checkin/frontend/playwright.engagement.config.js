import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: 'engagement-foundations.spec.js', workers: 1,
  reporter: 'list', outputDir: 'test-results/engagement',
  use: {
    baseURL: 'http://127.0.0.1:4178', headless: true, reducedMotion: 'reduce',
    // Use the matching Playwright Chromium build, never an unsandboxed fallback.
    launchOptions: { chromiumSandbox: true },
    // Service workers must not bypass the fixture's strict request interception.
    serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: { command: 'node e2e/engagement-fixture-server.mjs', url: 'http://127.0.0.1:4178/__engagement-test', reuseExistingServer: false },
})
