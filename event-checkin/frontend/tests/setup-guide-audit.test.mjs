import test from 'node:test'
import assert from 'node:assert/strict'
import {phaseTwoReadiness} from '../src/pages/guidedSetupPhaseTwoModel.mjs'
import {phaseFiveReadiness} from '../src/pages/guidedSetupPhaseFiveModel.mjs'
import {phaseOneReadiness} from '../src/pages/guidedSetupPhaseOneModel.mjs'
import {eventCalendarDays,eventCalendarLabel} from '../src/pages/eventCalendar.mjs'
import {requiredServices,selectedRecipes,taskRevision,effectiveProgress} from '../src/pages/guideStageConfig.mjs'
import {guideHref,saveGuideResume,readGuideResume} from '../src/pages/guideNavigation.mjs'
const ticket={selectedOutcomes:['tickets'],ticketConfig:{enabled:true,provider:'stripe',provider_account_id:'selected'},ticketProducts:[{active:true,price:0}]}
const recipe=(s,id)=>s.recipes.find(r=>r.id===id)
test('free-only checkout ignores unavailable payout service; custom/paid prices need selected provider account',()=>{
 assert.equal(recipe(phaseTwoReadiness({...ticket,dataFailures:[{key:'payoutAccounts',label:'Payout accounts'}]}),'tickets').blocked,false)
 assert.equal(recipe(phaseTwoReadiness({...ticket,dataFailures:[{key:'payoutAccounts',label:'Payout accounts'}]}),'tickets').unknown,false)
 for(const product of [{price:20},{price:0,allow_custom_amount:true},{price:undefined}]){
  const data={...ticket,ticketProducts:[product],payoutAccounts:[{provider:'stripe',provider_account_id:'other',status:'verified'}]}
  assert.equal(recipe(phaseTwoReadiness(data),'tickets').blocked,true)
  data.payoutAccounts[0].provider_account_id='selected'
  assert.equal(recipe(phaseTwoReadiness(data),'tickets').blocked,false)
 }
})
test('public RSVP has no circular audience prerequisite; closed RSVP still requires invitees',()=>{
 const data={selectedOutcomes:['rsvp'],event:{rsvp_enabled:true,rsvp_token:'demo',invite_mode:'open'}}
 assert.equal(recipe(phaseTwoReadiness(data),'rsvp').blocked,false)
 assert.equal(recipe(phaseTwoReadiness({...data,event:{...data.event,invite_mode:'closed'}}),'rsvp').blocked,true)
 assert.equal(recipe(phaseTwoReadiness({...data,event:{invite_mode:'open'}}),'rsvp').blocked,true)
})
test('recommendation skips blocked tasks, and all-blocked recommendation names prerequisite',()=>{
 const s=phaseTwoReadiness({...ticket,ticketProducts:[],selectedOutcomes:['tickets','communicate'],event:{notify_email:true}})
 assert.equal(s.next.id,'channels')
 const blocked=phaseFiveReadiness({selectedOutcomes:['conference']})
 assert.equal(blocked.next.title,'Create a conference track')
 assert.equal(blocked.next.route,'/conference-center?tab=tracks')
})
test('named failures affect dependent checks only; unrelated services are not requested',()=>{
 const s=phaseTwoReadiness({...ticket,selectedOutcomes:['tickets','communicate'],event:{notify_email:true},dataFailures:[{key:'ticketConfig',label:'Ticket configuration',message:'Unavailable'}]})
 assert.equal(recipe(s,'tickets').unknown,true)
 assert.equal(recipe(s,'channels').unknown,false)
 assert.equal(s.next.id,'pass')
 const services=requiredServices(2,selectedRecipes(2,['communicate']),['communicate']).map(([key])=>key)
 assert.deepEqual(services,['schedules'])
 assert.equal(requiredServices(2,selectedRecipes(2,['rsvp']),['rsvp']).some(([key])=>key==='ticketProducts'),false)
})
test('stale display heartbeat and draft workflow cannot establish operational readiness',()=>{
 const base={selectedOutcomes:['live'],progress:{phase5_control_rehearsal:'completed'},displays:[{last_seen_at:'2020-01-01',connected:false}],workflows:[{status:'draft'}]}
 assert.equal(recipe(phaseFiveReadiness(base),'control').complete,false)
 assert.equal(recipe(phaseFiveReadiness({...base,displays:[{connected:true}]}),'control').complete,false)
 assert.equal(recipe(phaseFiveReadiness({...base,displays:[{connected:true}],workflows:[{status:'published'}]}),'control').complete,true)
})
test('evidence is scoped, requires current configuration and never trusts legacy completed alone',()=>{
 const data={event:{id:'a'},progress:{phase5_certificate_test:'completed'},certificateTemplates:[{id:'t',eligibility:{minimum_sessions:1,require_event_checkin:true}}],evidence:[]}
 assert.equal(effectiveProgress(5,data).phase5_certificate_test,'pending')
 const revision=taskRevision(5,'certificates',data)
 data.evidence=[{step_key:'phase5_certificate_test',result:'passed',config_revision:revision}]
 assert.equal(effectiveProgress(5,data).phase5_certificate_test,'completed')
 data.certificates=[{id:'new-issue'}]
 assert.equal(taskRevision(5,'certificates',data),revision)
 data.certificateTemplates[0].eligibility.minimum_sessions=3
 assert.equal(effectiveProgress(5,data).phase5_certificate_test,'pending')
 data.evidence.unshift({...data.evidence[0],result:'partial',config_revision:taskRevision(5,'certificates',data)})
 assert.equal(effectiveProgress(5,data).phase5_certificate_test,'pending')
})
test('local dates count two Chicago calendar days, handle DST and preserve date-only values',()=>{
 assert.equal(eventCalendarDays('2026-11-14T15:00:00','2026-11-16T04:00:00','America/Chicago'),2)
 assert.equal(eventCalendarDays('2026-03-08T06:00:00Z','2026-03-09T04:00:00Z','America/Chicago'),1)
 assert.equal(eventCalendarDays('2026-11-01','2026-11-02','America/Chicago'),2)
 assert.equal(eventCalendarDays('garbage','2026-11-02','America/Chicago'),null)
 assert.equal(eventCalendarDays('2026-11-02','2026-11-01','UTC'),null)
 assert.notEqual(eventCalendarLabel('2026-11-14T02:00:00','America/Chicago'),eventCalendarLabel('2026-11-14T02:00:00','UTC'))
})
test('resume locations isolate event and user; routes carry stage and task',()=>{
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)}
 saveGuideResume('a','u','live','conference');saveGuideResume('b','u','audience','tickets')
 assert.equal(guideHref('a','u'),'/setup-redesign?view=live&task=conference')
 assert.equal(readGuideResume('b','u').view,'audience');assert.equal(readGuideResume('a','other'),null)
 saveGuideResume('a','u','invalid');assert.equal(readGuideResume('a','u').view,'live')
})
test('foundation denominator covers exactly four checks; venue has an actionable next step',()=>{
 const data={event:{name:'a',event_date:'2026-11-14',timezone:'UTC'},progress:{outcome_rsvp:'completed'},members:[{}],billing:{configured:true},eventPass:{status:'active'},userRole:'admin'}
 const s=phaseOneReadiness(data);assert.equal(s.total,4);assert.equal(s.completed,3);assert.equal(s.next,'venue')
})

test('mixed and inactive paid products are distinguished and missing product price is not free',()=>{
 const free={price:0,active:true},paid={price:50,active:true}
 assert.equal(recipe(phaseTwoReadiness({...ticket,ticketProducts:[free,paid]}),'tickets').blocked,true)
 assert.equal(recipe(phaseTwoReadiness({...ticket,ticketProducts:[free,{...paid,active:false}]}),'tickets').blocked,false)
 assert.equal(recipe(phaseTwoReadiness({...ticket,ticketProducts:[{price:null}]}),'tickets').blocked,true)
 assert.equal(recipe(phaseTwoReadiness({...ticket,ticketProducts:[]}),'tickets').blocked,true)
})
test('local calendar handles midnight, Lagos, invalid timezone and same-day times',()=>{
 assert.equal(eventCalendarDays('2026-11-14T23:30:00Z','2026-11-15T01:00:00Z','Africa/Lagos'),1)
 assert.equal(eventCalendarDays('2026-11-14T22:00:00Z','2026-11-14T23:00:00Z','Africa/Lagos'),2)
 assert.equal(eventCalendarDays('2026-11-14T22:00:00Z','2026-11-14T23:00:00Z','Invalid/Zone'),null)
})

test('website, speaker settings and Live outages never leave affected tasks complete', async()=>{
 const {phaseThreeReadiness}=await import('../src/pages/guidedSetupPhaseThreeModel.mjs')
 const base={selectedOutcomes:['website','speakers'],design:{selected_template_id:'design'},website:{published_release_id:'release'},speakers:[{id:'speaker'}],speakerSettings:{speaker_token:'token'}}
 let state=phaseThreeReadiness({...base,dataFailures:[{key:'speakerSettings',label:'Speaker publishing'}]})
 assert.equal(recipe(state,'speakers').unknown,true);assert.equal(recipe(state,'website').complete,true)
 state=phaseThreeReadiness({...base,dataFailures:[{key:'website',label:'Website draft'}]})
 assert.equal(recipe(state,'website').complete,false);assert.equal(recipe(state,'website').unknown,true);assert.equal(recipe(state,'speakers').complete,true)
 const live=phaseFiveReadiness({selectedOutcomes:['live'],activities:[{id:'poll'}],displays:[{connected:true}],workflows:[{status:'published'}],progress:{phase5_control_rehearsal:'completed'},dataFailures:[{key:'displays',label:'Live displays'}]})
 assert.equal(recipe(live,'control').unknown,true);assert.equal(recipe(live,'control').complete,false);assert.equal(recipe(live,'activities').unknown,false)
})
