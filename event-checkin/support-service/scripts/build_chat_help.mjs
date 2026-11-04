// Public Help only. Operator material must never enter customer chat.
import {CONTENT,GUIDE_REVISED_AT} from '../../frontend/src/guideContent.mjs'
import {readFileSync,writeFileSync} from 'node:fs'
const topics=['organizer','staff','guest'].flatMap(role=>(CONTENT[role]?.topics||[]).map(t=>({id:t.id,role,title:t.title,intro:t.intro||'',before:t.before||'',steps:t.steps||[],check:t.check||'',url:'/guide.html#'+t.id})))
const text=JSON.stringify({source:'frontend/src/guideContent.mjs',revised_at:GUIDE_REVISED_AT,topics},null,2)+'\n'
const target=new URL('../../backend/app/services/support_help_catalog.json',import.meta.url)
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==text)throw Error('Chat Help catalog is out of date. Run support-service/scripts/build_chat_help.mjs');console.log('Chat Help matches the public Help source.')}else{writeFileSync(target,text);console.log('Generated public chat Help catalog:',topics.length,'articles.')}
