import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'venue-party-checkin.spec.js', workers: 1,
  reporter: 'list', outputDir: 'test-results/venue-party',
  use: { baseURL: 'http://127.0.0.1:4189', headless: true, serviceWorkers: 'block',
    geolocation: { latitude: 32.835620, longitude: -97.014700, accuracy: 15 },
    permissions: ['geolocation'], screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4189 --strictPort', url: 'http://127.0.0.1:4189', reuseExistingServer: false },
})
