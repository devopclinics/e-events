import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEventReport } from '../src/pages/redesign/results/eventReport.mjs'
test('report separates credentials, unique recipients and email requests; escapes event content',()=>{
 const html=buildEventReport({event:{name:'<img src=x onerror=alert(1)>',timezone:'UTC'},command:{event_summary:{rsvp:{guests:3,checked_in:0}}},certificates:{summary:{issued:3,emailed:2},rows:[{status:'issued',guest_id:'a'},{status:'issued',guest_id:'a'},{status:'issued',guest_id:'b'},{status:'revoked',guest_id:'c'}]}})
 assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.match(html,/2 distinct registered/);assert.match(html,/1 registration records remain/);assert.match(html,/not confirmed inbox delivery/);assert.match(html,/>0<\/strong>/)
})
test('missing sections stay unmeasured, with explicit source limitations',()=>{
 const html=buildEventReport({event:{name:'Another event'},command:{},unavailable:['Certificates']})
 assert.match(html,/Not measured/);assert.match(html,/Unavailable sections: Certificates/);assert.ok(!html.includes('PAMCON'));assert.equal((html.match(/<section class="page/g)||[]).length,7)
})
