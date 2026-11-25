import test from 'node:test'
import assert from 'node:assert/strict'
import {CONTENT} from '../src/guideContent.mjs'
import {JUNIOR_HELP_TOPICS} from '../src/juniorHelpContent.mjs'
import {readFileSync,existsSync} from 'node:fs'
test('Juniors help is shared with organizer and staff without changing guest guidance',()=>{
 for(const role of ['organizer','staff']) for(const topic of JUNIOR_HELP_TOPICS) assert.ok(CONTENT[role].topics.some(t=>t.id.endsWith(topic.id)&&t.title===topic.title))
 assert.ok(!CONTENT.guest.topics.some(t=>t.id.includes('juniors')))
 const catalog=JSON.parse(readFileSync(new URL('../../backend/app/services/support_help_catalog.json',import.meta.url),'utf8'))
 assert.ok(JSON.stringify(catalog).includes('Resolve No authorized adult collector'))
 for(const topic of JUNIOR_HELP_TOPICS) for(const link of topic.links||[]) if(link.href.startsWith('/juniors/guide/')) assert.ok(existsSync(new URL('../public'+link.href,import.meta.url)),link.href)
})
test('Help preserves daily confirmation, independent support needs and complete return cycles',()=>{
 const all=JSON.stringify(JUNIOR_HELP_TOPICS)
 for(const phrase of ['does not automatically authorize pickup','never treat missing information as No','Both needs mean three bands','Clinic, Other or Outing','Practice']) assert.ok(all.includes(phrase),phrase)
})
