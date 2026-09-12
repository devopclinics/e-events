#!/usr/bin/env node
// Doc-drift gate — run in CI, or manually before a release, to catch the
// exact kind of staleness a 2026-09 audit found by hand: help topics
// pointing at screenshot files that no longer exist (renamed help-*.png ->
// help2-*.png without updating guideContent.mjs), media-library entries
// pointing at files that were moved/renamed, and old "EventQR"/"vsgs.io"
// branding creeping back into customer-facing content. Exits non-zero (and
// prints every problem found, not just the first) without modifying
// anything.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..')
const mediaDir = path.join(frontendRoot, 'public', 'media')

const BANNED_STRINGS = ['EventQR', 'events.vsgs.io']
// Files where "Event QR" is a legitimate feature name (a self-check-in mode),
// not the old product brand -- never flag those two words together there.
const BANNED_STRING_ALLOWLIST = new Set([
  path.join('src', 'pages', 'ScannerPage.jsx'),
  path.join('src', 'pages', 'ScannerRedesignPage.jsx'),
  path.join('src', 'api.js'), // defensive legacy-URL redirect check, not a claim
])

const problems = []

function checkMediaFileExists(relHref, sourceDescription) {
  if (!relHref.startsWith('/media/')) return
  const filePath = path.join(mediaDir, relHref.slice('/media/'.length))
  if (!existsSync(filePath)) {
    problems.push(`Broken media reference: ${relHref} (from ${sourceDescription}) has no matching file in public/media/`)
  }
}

// ---- 1. guideContent.mjs: every img/imgs path must exist ----
const { CONTENT } = await import(path.join(frontendRoot, 'src', 'guideContent.mjs'))
for (const [roleKey, role] of Object.entries(CONTENT)) {
  for (const topic of role.topics || []) {
    const imgs = topic.imgs || (topic.img ? [topic.img] : [])
    for (const img of imgs) {
      checkMediaFileExists(img, `guideContent.mjs topic "${roleKey}.${topic.id}"`)
    }
  }
}

// ---- 2. MediaPage.jsx: every href into /media/ must exist ----
const mediaPageSrc = readFileSync(path.join(frontendRoot, 'src', 'pages', 'MediaPage.jsx'), 'utf8')
for (const match of mediaPageSrc.matchAll(/href:\s*'(\/media\/[^']+)'/g)) {
  checkMediaFileExists(match[1], 'MediaPage.jsx')
}
for (const match of mediaPageSrc.matchAll(/\['[^\]]*?',\s*'(\/media\/[^']+)'\]/g)) {
  checkMediaFileExists(match[1], 'MediaPage.jsx SCREENSHOTS')
}

// ---- 3. Banned old-brand strings in customer-facing content ----
function scanForBannedStrings(filePath) {
  const rel = path.relative(frontendRoot, filePath)
  if (BANNED_STRING_ALLOWLIST.has(rel)) return
  const text = readFileSync(filePath, 'utf8')
  for (const banned of BANNED_STRINGS) {
    if (text.includes(banned)) {
      const line = text.slice(0, text.indexOf(banned)).split('\n').length
      problems.push(`Old branding "${banned}" found in ${rel}:${line} -- should be "Festio" / "festio.events"`)
    }
  }
}

const filesToScan = [
  path.join(frontendRoot, 'src', 'guideContent.mjs'),
  path.join(frontendRoot, 'src', 'pages', 'HelpPage.jsx'),
  path.join(frontendRoot, 'src', 'pages', 'HelpRedesignPage.jsx'),
  path.join(frontendRoot, 'src', 'pages', 'LandingRedesignPage.jsx'),
  path.join(frontendRoot, 'public', 'media', 'getting-started.html'),
]
for (const f of filesToScan) {
  if (existsSync(f)) scanForBannedStrings(f)
}

// ---- Report ----
if (problems.length) {
  console.error(`\nhelp-content-drift: ${problems.length} problem(s) found:\n`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  process.exit(1)
}
console.log('help-content-drift: OK -- no broken media references or old branding found.')
