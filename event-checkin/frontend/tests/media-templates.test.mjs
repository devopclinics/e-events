import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { MEDIA_TEMPLATES, DEFAULT_BRIEF, buildMediaDocument, mediaLink } from '../src/components/media-library/templates.mjs'

test('reusable media exports all three complete, independent formats', () => {
  for (const item of MEDIA_TEMPLATES) {
    const html = buildMediaDocument(item.id, { client: 'Academy', title: 'A new occasion', palette: 'emerald' })
    assert.match(html, /<!doctype html>/)
    assert.match(html, /Academy/)
    assert.match(html, /A new occasion/)
    assert.match(html, /class="emerald"/)
    assert.equal((html.match(/<section class="sheet/g) || []).length, item.id === 'presentation' ? 6 : 1)
    assert.doesNotMatch(html, /<script|<iframe|src="https:/)
  }
  assert.equal(DEFAULT_BRIEF.client, '')
})
test('downloaded media escapes user content and rejects unsafe URL schemes', () => {
  const html = buildMediaDocument('overview', { title: '<img src=x onerror=alert(1)>', client: 'A & B', url: 'javascript:alert(1)', palette: '"><script>bad()</script>' })
  assert.match(html, /&lt;img/)
  assert.match(html, /A &amp; B/)
  assert.doesNotMatch(html, /<img|<script|javascript:|onerror="/)
  assert.equal(mediaLink('http://example.com'), '')
  assert.equal(mediaLink('https://example.com'), 'https://example.com/')
})
test('existing media catalog references files that exist', () => {
  const source=readFileSync(new URL('../src/pages/MediaPage.jsx',import.meta.url),'utf8')
  const hrefs=[...source.matchAll(/['"](\/media\/[^'"\s]+)['"]/g)].map(m=>m[1])
  assert.ok(hrefs.length > 40)
  for(const href of hrefs)assert.ok(existsSync(new URL('../public'+href,import.meta.url)),href)
})
