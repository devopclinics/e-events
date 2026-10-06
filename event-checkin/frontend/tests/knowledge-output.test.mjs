import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { CONTENT } from '../src/guideContent.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
test('generated guides preserve every public procedure and safety warning', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'festio-knowledge-'))
  try {
    for (const p of ['frontend/src/guideContent.mjs', 'frontend/scripts/gen-guide-html.mjs', 'support-service/scripts/build_knowledge_base.mjs', 'support-service/docs/QA_RELEASE_CERTIFICATION_RUNBOOK.md']) {
      mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); cpSync(path.join(root, p), path.join(dir, p))
    }
    for (const p of ['frontend/dist', 'frontend/src/generated', 'support-service/app']) mkdirSync(path.join(dir, p), { recursive: true })
    execFileSync(process.execPath, [path.join(dir, 'frontend/scripts/gen-guide-html.mjs')])
    execFileSync(process.execPath, [path.join(dir, 'support-service/scripts/build_knowledge_base.mjs')])
    const html = readFileSync(path.join(dir, 'frontend/dist/guide.html'), 'utf8')
    const kb = readFileSync(path.join(dir, 'support-service/app/knowledge_base.md'), 'utf8')
    assert.equal(kb, readFileSync(path.join(root, 'support-service/app/knowledge_base.md'), 'utf8'), 'Regenerate the checked-in support KB')
    assert.equal(readFileSync(path.join(dir, 'frontend/src/generated/internalMediaDocs.mjs'), 'utf8'), readFileSync(path.join(root, 'frontend/src/generated/internalMediaDocs.mjs'), 'utf8'), 'Regenerate Media Library copies')
    for (const role of ['organizer', 'staff', 'guest']) for (const t of CONTENT[role].topics) {
      assert.ok(html.includes(`id="${t.id}"`), t.id)
      for (const text of [t.intro, t.tip, t.warn, ...(t.steps || [])].filter(Boolean)) {
        assert.ok(html.includes(escape(text)), `${t.id}: lost public instruction`)
        assert.ok(kb.includes(text), `${t.id}: lost support instruction`)
      }
    }
    for (const t of CONTENT.operator.topics) assert.ok(!html.includes(`id="${t.id}"`), 'Operator topic exposed in public guide')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
