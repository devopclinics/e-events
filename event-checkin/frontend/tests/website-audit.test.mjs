import test from 'node:test'
import assert from 'node:assert/strict'
import {draftIssues,sourceRefresh,applyRefresh,friendlyWebsiteError} from '../src/pages/websiteDraft.mjs'
test('incomplete draft rows have friendly guidance',()=>{
 const issues=draftIssues({stats:[{label:'Days',value:''}],faqs:[{question:'Where?',answer:''}]})
 assert.equal(issues.length,2);assert.match(issues[0].message,/At-a-glance cards 1/)
 assert.equal(draftIssues({faqs:[{question:'Where?',answer:'Here'}]}).length,0)
 assert.match(friendlyWebsiteError(new Error('content.stats.0.value String should have at least 1 character')),/At-a-glance cards 1 — value Please complete/)
})
test('reviewed refresh retains editorial fields and requires conflict approval',()=>{
 const old=[{source_id:'one',title:'Custom title',time:'10 AM',featured:true,image_url:'art',display_summary:'My copy',source_baseline:{title:'Original',time:'10 AM'}}]
 const next=[{source_id:'one',title:'New source',time:'11 AM'},{source_id:'two',title:'Added'}]
 const changes=sourceRefresh(old,next,'sessions')
 assert.equal(changes.find(c=>c.field==='title').conflict,true)
 assert.equal(changes.find(c=>c.field==='time').conflict,false)
 const rows=applyRefresh(old,next,'sessions',changes,changes.flatMap((c,i)=>c.conflict?[]:[i]))
 assert.equal(rows[0].title,'Custom title');assert.equal(rows[0].time,'11 AM')
 assert.equal(rows[0].featured,true);assert.equal(rows[0].image_url,'art');assert.equal(rows[0].display_summary,'My copy');assert.equal(rows.length,2)
 assert.equal(old[0].time,'10 AM')
})
test('older imports and removed source rows require explicit review',()=>{
 const rows=[{source_id:'one',title:'Old'},{source_id:'removed',title:'Keep'}]
 const next=[{source_id:'one',title:'Changed'}]
 const changes=sourceRefresh(rows,next,'sessions')
 assert(changes.every(c=>c.conflict))
 assert.equal(applyRefresh(rows,next,'sessions',changes,[])[1].title,'Keep')
})
