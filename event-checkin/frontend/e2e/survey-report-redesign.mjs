// Offline visual regression for the staff-only survey report. It uses a
// representative fixture so print layout is checked without event data.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, expect } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const scratch = await mkdtemp(join(tmpdir(), 'festio-survey-report-'))
const output = process.env.OUTPUT_DIR
const virtual = '\0survey-report-test:entry'

const report = {
  title: 'Help Shape the Next MBF Summit',
  description: 'MBF Summit 2026 has wrapped up. This report turns participant feedback into a planning brief for the next gathering.',
  type: 'survey',
  participant_count: 66,
  response_count: 885,
  survey_summary: { completion_rate: 85, avg_completion_seconds: 3251 },
  questions: [
    { question_id: 'overall', question_type: 'rating_5', prompt: 'Overall, how would you rate the 2026 MBF Summit?', response_count: 61, average_rating: 4.0, value_counts: { 5: 14, 4: 37, 3: 7, 2: 2, 1: 1 } },
    { question_id: 'speakers', question_type: 'rating_5', prompt: 'How would you rate: Speakers and workshops?', response_count: 61, average_rating: 4.41, value_counts: { 5: 29, 4: 22, 3: 8, 2: 2 } },
    { question_id: 'accommodation', question_type: 'rating_5', prompt: 'How would you rate: Accommodation and cabins for elders, families, and physically challenged guests?', response_count: 61, average_rating: 2.97, value_counts: { 5: 4, 4: 12, 3: 21, 2: 17, 1: 7 } },
    { question_id: 'attended', question_type: 'yes_no', prompt: 'Did you attend the 2026 MBF Summit at Carolina Creek?', response_count: 62, option_labels: { yes: 'Yes, I attended', no: "No, I couldn't attend" }, option_counts: { yes: 61, no: 1 } },
    { question_id: 'more', question_type: 'multiple_choice', prompt: 'What would you like more of at the next MBF Summit?', response_count: 53, option_labels: { career: 'Career and professional development', brotherhood: 'Brotherhood and networking', spiritual: 'Islamic knowledge and spiritual growth', marriage: 'Marriage and relationships', technology: 'Technology and AI', wellness: 'Health and wellness' }, option_counts: { career: 27, brotherhood: 26, spiritual: 26, marriage: 25, technology: 22, wellness: 21 } },
    { question_id: 'venue', question_type: 'ranking', prompt: 'Rank the qualities that should guide the next venue choice.', response_count: 43, option_labels: { lodging: 'Comfortable, accessible accommodation', location: 'Convenient location and travel time', food: 'Reliable meal quality and dietary choices', outdoors: 'Outdoor space and activity options' }, ranking_scores: { lodging: 156, location: 144, food: 118, outdoors: 94 } },
    { question_id: 'cloud', question_type: 'word_cloud', prompt: 'Describe the summit in a word or short phrase.', response_count: 31, word_cloud: [{ word: 'Brotherhood', count: 14 }, { word: 'Inspiring', count: 11 }, { word: 'Growth', count: 9 }, { word: 'Community', count: 7 }] },
    { question_id: 'improve', question_type: 'long_text', prompt: 'What is the one thing we should improve for the next MBF Summit?', response_count: 44, text_samples: ['Create special accommodation for the physically challenged and elders.', 'The program arrangements are too close. More breathing room would improve the weekend.', 'More food options and a clearer arrival plan.'] },
    { question_id: 'price', question_type: 'number', prompt: 'What price per person would feel reasonable for a full weekend?', response_count: 21, numeric_values: [150, 175, 200, 225, 250, 175, 150, 200] },
    { question_id: 'map', question_type: 'image_click', prompt: 'Which arrival and venue areas need the most attention?', response_count: 0, points: [] },
  ],
}

const server = await createServer({
  root,
  configFile: false,
  cacheDir: join(scratch, 'vite'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [{
    name: 'survey-report-fixture',
    enforce: 'pre',
    resolveId(id) { return id === 'virtual:survey-report-entry' ? virtual : null },
    load(id) {
      if (id !== virtual) return null
      return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter, Route, Routes } from 'react-router-dom';
        import Page from '/src/pages/SurveyReportPage.jsx';
        createRoot(document.getElementById('root')).render(
          React.createElement(MemoryRouter, { initialEntries: ['/live/survey-report/activity-1?token=staff-token'] },
            React.createElement(Routes, null, React.createElement(Route, { path: '/live/survey-report/:activityId', element: React.createElement(Page) }))
          )
        );
      `
    },
    configureServer(vite) {
      vite.middlewares.use('/survey-report-test', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/survey-report-test', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:survey-report-entry"></script></body></html>'))
      })
    },
  }, react()],
})

await server.listen()
const browser = await chromium.launch({ headless: true })
const base = `http://127.0.0.1:${server.httpServer.address().port}`
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route((url) => new URL(url).pathname === '/api/engagement/v1/activities/activity-1/report', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(report) }))
  await page.goto(`${base}/survey-report-test`, { waitUntil: 'networkidle' })
  await page.locator('.flb-report-ready').waitFor({ state: 'attached' })

  await expect(page.getByText('What should guide planning now', { exact: true })).toBeVisible()
  await expect(page.getByText('Career and professional development', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Comfortable, accessible accommodation', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Staff-visible response excerpts', { exact: true })).toBeVisible()
  assert.equal(await page.locator('.question-card').count(), report.questions.length, 'Every question renders in the appendix')
  assert.equal(await page.getByText('No responses were recorded for this question.', { exact: true }).count(), 1, 'Zero-response questions have an explicit state')
  assert.deepEqual(errors, [], 'The report rendered without browser errors')

  const layout = await page.evaluate(() => ({
    ellipsis: document.body.innerText.includes('…'),
    overflowingLabels: [...document.querySelectorAll('.bar-copy span')].filter((element) => element.scrollWidth > element.clientWidth + 1).length,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: document.documentElement.clientWidth,
  }))
  assert.equal(layout.ellipsis, false, 'Report labels are not truncated with ellipses')
  assert.equal(layout.overflowingLabels, 0, 'Long report labels wrap within their columns')
  assert.ok(layout.documentWidth <= layout.viewportWidth + 2, 'The report has no horizontal overflow')

  if (output) {
    await mkdir(output, { recursive: true })
    await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
    await page.screenshot({ path: join(output, 'festio-guest-report-redesign-implementation.png'), fullPage: true })
    await page.pdf({ path: join(output, 'festio-guest-report-redesign-implementation.pdf'), format: 'A4', landscape: true, printBackground: true, margin: { top: '16mm', bottom: '20mm', left: '14mm', right: '14mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;font-size:8px;color:#637086;font-family:Arial,sans-serif;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' })
  }
  await page.close()
  console.log('Survey report redesign: fixture, labels, multiple-choice appendix, and print layout passed')
} finally {
  await browser.close()
  await server.close()
  await rm(scratch, { recursive: true, force: true })
}
