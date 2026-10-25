// Run against the fixture served by local Vite only. All client operations mocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined,
  headless: true
});
const page = await browser.newPage({
  viewport: {
    width: 1440,
    height: 1100
  }
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// No fixture request is allowed to reach an external service.
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
await fs.mkdir('test-results/meetings', {
  recursive: true
});
try {
  await page.goto(base + '/e2e/meetings-harness.html');
  await page.getByRole('button', {
    name: /Project catch-up/
  }).click();
  await page.getByRole('button', {
    name: 'Save draft',
    exact: true
  }).click();
  await page.getByRole('status').filter({
    hasText: 'Draft saved'
  }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.meetingCalls), ['save']);
  await page.getByRole('button', {
    name: 'Preview invitation',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Send now',
    exact: true
  }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.meetingCalls), ['save', 'save', 'preview']);
  await page.screenshot({
    path: 'test-results/meetings/desktop-preview.png',
    fullPage: true
  });
  await page.getByRole('button', {
    name: 'Send now',
    exact: true
  }).click();
  await page.getByText('Mock provider rejection', {
    exact: true
  }).waitFor();
  await page.getByRole('button', {
    name: 'Retry failed delivery',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Cancel meeting',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Confirm cancellation',
    exact: true
  }).click();
  await page.getByText('This meeting is cancelled. Its response links are closed.').waitFor();
  assert((await page.evaluate(() => window.meetingCalls)).includes('cancel'));
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await page.goto(base + '/e2e/meetings-harness.html');
  await page.getByRole('button', {
    name: /Project catch-up/
  }).click();
  await page.getByRole('button', {
    name: 'Preview invitation',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Send now',
    exact: true
  }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({
    path: 'test-results/meetings/mobile-preview.png',
    fullPage: true
  });
  // Vite fallback uses main application; navigate fixture then replace history so
  // fixture router renders the actual response component without auth/network.
  await page.goto(base + '/e2e/meetings-harness.html');
  await page.evaluate(() => {
    history.pushState({}, '', '/meeting-response/local');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('button', {
    name: 'Accept',
    exact: true
  }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.meetingCalls), ['read']);
  await page.getByRole('button', {
    name: 'Accept',
    exact: true
  }).click();
  await page.getByRole('status').filter({
    hasText: 'Your response: Accepted'
  }).waitFor();
  await page.getByRole('button', {
    name: 'Stop SMS notifications',
    exact: true
  }).click();
  assert(await page.getByRole('button', {
    name: 'SMS stopped',
    exact: true
  }).isDisabled());
  assert.deepEqual(await page.evaluate(() => window.preferenceCalls), ['sms']);
  await page.screenshot({
    path: 'test-results/meetings/mobile-response.png',
    fullPage: true
  });
  await page.evaluate(() => {
    history.pushState({}, '', '/meeting-response/expired');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('alert').filter({
    hasText: 'expired'
  }).waitFor();
  await page.goto(base + '/e2e/meetings-harness.html');
  await page.getByRole('button', {
    name: /Project catch-up/
  }).click();
  await page.getByLabel('Attendee 1 phone', {
    exact: true
  }).fill('+14155550123');
  await page.getByLabel('Attendee 1 SMS', {
    exact: true
  }).check();
  await page.getByLabel('This attendee agreed to receive SMS meeting notifications.', {
    exact: true
  }).check();
  await page.getByLabel('Attendee 1 WhatsApp', {
    exact: true
  }).check();
  await page.getByLabel('This attendee agreed to receive WhatsApp meeting notifications.', {
    exact: true
  }).check();
  await page.getByLabel('Approved WhatsApp template', {
    exact: true
  }).selectOption('approved-meeting');
  await page.getByRole('button', {
    name: 'Preview invitation',
    exact: true
  }).click();
  assert(await page.getByRole('button', {
    name: 'Send now',
    exact: true
  }).isDisabled());
  await page.getByLabel(/I confirm these phone recipients/).check();
  await page.screenshot({
    path: 'test-results/meetings/mobile-channels.png',
    fullPage: true
  });
  await page.getByRole('button', {
    name: 'Send now',
    exact: true
  }).click();
  await page.getByText('Mock provider rejection', {
    exact: true
  }).first().waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  await page.goto(base + '/e2e/meetings-harness.html');
  await page.getByRole('button', { name: /Project catch-up/ }).click();
  assert(await page.getByRole('button', { name: 'Send now', exact: true }).isDisabled());
  await page.getByRole('radio', { name: /Schedule send/ }).check();
  await page.getByLabel('Send invitations on', { exact: true }).fill('2026-10-27T09:00');
  await page.getByRole('button', { name: 'Preview invitation', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule invitations', exact: true }).click();
  await page.getByText('◷ Invitations scheduled', { exact: true }).waitFor();
  assert((await page.evaluate(() => window.meetingCalls)).includes('schedule'));
  await page.getByRole('button', { name: 'Cancel scheduled send', exact: true }).click();
  assert((await page.evaluate(() => window.meetingCalls)).includes('unschedule'));
  await page.getByRole('button', { name: /Cobalt/ }).click();
  await page.getByRole('button', { name: 'Preview invitation', exact: true }).click();
  await page.getByTitle('Email invitation preview', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: mocked draft/preview/send/retry/cancel, safe GET response, explicit RSVP, expired link, desktop/mobile layout; no external requests');
} finally {
  await browser.close();
}
