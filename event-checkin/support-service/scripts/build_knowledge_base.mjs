// Build-time generator: flattens the SAME structured content that powers the
// in-app Help guide and /guide.html (frontend/src/guideContent.mjs) into a
// single markdown knowledge base for support-service's AI drafting prompt.
// No paywall redaction — HelpPage.jsx already renders all topic content
// (including "Paid" badge topics) as plain unrestricted text.
//
// Regenerate and commit the output whenever guideContent.mjs changes:
//   node support-service/scripts/build_knowledge_base.mjs
import { writeFileSync } from 'node:fs'
import { CONTENT } from '../../frontend/src/guideContent.mjs'

const ROLES = ['organizer', 'staff', 'guest', 'operator']

function topicMarkdown(t) {
  const lines = [`### ${t.title}`, '']
  if (t.intro) lines.push(t.intro, '')
  if (t.steps?.length) {
    lines.push(...t.steps.map((s, i) => `${i + 1}. ${s}`), '')
  }
  if (t.tip) lines.push(`Tip: ${t.tip}`, '')
  if (t.warn) lines.push(`Warning: ${t.warn}`, '')
  return lines.join('\n')
}

function roleMarkdown(key) {
  const r = CONTENT[key]
  if (!r) return ''
  return [
    `## ${r.label}`,
    '',
    r.blurb || '',
    '',
    ...r.topics.map(topicMarkdown),
  ].join('\n')
}

const doc = [
  '# Festio product documentation',
  '',
  'Generated from frontend/src/guideContent.mjs — do not edit by hand, run',
  'support-service/scripts/build_knowledge_base.mjs to regenerate.',
  '',
  ...ROLES.map(roleMarkdown),
].join('\n')

writeFileSync(new URL('../app/knowledge_base.md', import.meta.url), doc)
console.log(`wrote knowledge_base.md (${doc.length} chars)`)
