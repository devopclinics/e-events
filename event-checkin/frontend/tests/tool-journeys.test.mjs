import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {CUSTOMER_TOOLS,toolAccess} from '../src/pages/customerJourneyModel.mjs'
import {TOOL_GUIDES,toolForLocation,toolWorkspaceHref} from '../src/components/setup/toolGuides.mjs'
import {toolChecks,toolPreviewUrl,safePreviewUrl,toolRevision} from '../src/components/setup/toolReadiness.mjs'
const origin='https://staging.festio.events',api=readFileSync(new URL('../src/api.js',import.meta.url),'utf8')
for(const tool of CUSTOMER_TOOLS)test(`${tool.id}: API and route coverage`,()=>{const guide=TOOL_GUIDES[tool.id];assert.equal(guide.steps.length,3);for(const method of guide.methods)assert.match(api,new RegExp('\\b'+method+':'));const url=new URL(toolWorkspaceHref(tool),origin);assert.equal(toolForLocation(url.pathname,url.search).id,tool.id);assert.doesNotThrow(()=>toolChecks(tool,{},{}))})
test('unrelated route cannot inherit a guide',()=>assert.equal(toolForLocation('/unknown','?toolGuide=tickets'),null))
test('shared editors retain correct subtab',()=>{assert.equal(toolForLocation('/experience-redesign','?tab=workflow').id,'programme');assert.equal(toolForLocation('/experience-redesign','?tab=consent').id,'forms');assert.equal(toolForLocation('/guests-redesign','?tab=guests&toolGuide=passes').id,'passes')})
test('failed reads are unknown',()=>{const checks=toolChecks({id:'seating',flag:'seating_enabled'},{seating_enabled:true},{},[{key:'listTables'}]);assert.equal(checks[0].passed,true);assert.equal(checks[1].passed,null)})
test('draft catalog does not imply paid readiness',()=>{const checks=toolChecks({id:'tickets'},{},{ticketingConfig:{config:{currency:'NGN',enabled:false},go_live:{ready:false,checks:[]}},ticketingProducts:[{}]});assert.equal(checks[0].passed,true);assert.equal(checks.at(-1).passed,false)})
test('published programme still needs visibility',()=>{const checks=toolChecks({id:'programme'},{live_program_enabled:false},{listExperienceWorkflows:[{status:'published'}],liveProgramSessions:[{}]});assert.equal(checks[0].passed,true);assert.equal(checks[1].passed,false)})
test('giving uses saved enabled state and durable token',()=>{const t={preview:'giving'};assert.equal(toolPreviewUrl(t,{}, {donationCampaign:{enabled:false,public_token:'stable'}},null,origin),'');assert.equal(toolPreviewUrl(t,{}, {donationCampaign:{enabled:true,public_token:'stable',public_url:'/give/mutable'}},null,origin),origin+'/give/stable')})
test('private preview needs selected credential',()=>{assert.equal(toolPreviewUrl({preview:'guest'},{id:'event'},{},null,origin),'');assert.equal(toolPreviewUrl({preview:'guest',guestTab:'pass'},{},{},{invite_token:'personal'},origin),origin+'/r/personal#/pass')})
test('unsafe preview URLs rejected',()=>{for(const u of ['javascript:alert(1)','data:text/html,x','http://external.example/x','https://user:secret@example.com'])assert.equal(safePreviewUrl(u,origin),'');assert.equal(safePreviewUrl('/published',origin),origin+'/published')})
test('revision detects configuration change and excludes private credentials',()=>{const tool={id:'seating'},event={id:'event'};assert.notEqual(toolRevision(tool,event,{tables:[{capacity:10}]}),toolRevision(tool,event,{tables:[{capacity:12}]}));assert.equal(toolRevision(tool,event,{email:'a',qr_token:'one'}),toolRevision(tool,event,{email:'b',qr_token:'two'}))})

test('restricted workspaces never claim generally available access',()=>{for(const id of ['marketing','academy'])assert.equal(toolAccess(CUSTOMER_TOOLS.find(t=>t.id===id),{},{}).state,'Approved access required')})
