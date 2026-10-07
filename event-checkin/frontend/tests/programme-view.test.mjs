import test from 'node:test';
import assert from 'node:assert/strict';
import {dayHighlights,activityHref,readSavedSessions} from '../src/components/guesthub/programmeView.mjs';
import {appHash,readAppRoute} from '../src/components/guesthub/appModel.mjs';
const now=Date.parse('2026-12-24T15:30:00Z');
const first={step_id:'a',starts_at:'2026-12-24T15:00:00Z',ends_at:'2026-12-24T16:00:00Z'};
test('overlapping sessions remain current and next is actually upcoming',()=>{const parallel={...first,step_id:'b'},next={step_id:'c',starts_at:'2026-12-24T17:00:00Z',ends_at:'2026-12-24T18:00:00Z'};assert.equal(dayHighlights([next,first,parallel],now).current.length,2);assert.equal(dayHighlights([next,first,parallel],now).next,next)});
test('closed activities never generate response links',()=>{for(const status of ['scheduled','closed','paused','completed'])assert.equal(activityHref('e','token',{id:'a',session_id:'s',status}),'')});
test('links preserve exact activity event and guest',()=>{const link=activityHref('e','a+b',{id:'q',session_id:'s',status:'live'});const p=new URL(link,'https://festio.events').searchParams;assert.equal(p.get('pass'),'a+b');assert.equal(p.get('activity'),'q');assert.equal(p.get('session'),'s');assert.equal(p.get('event'),'e')});
test('malformed or inaccessible bookmark storage fails safely',()=>{global.localStorage={getItem:()=>'{bad'};assert.deepEqual(readSavedSessions('test'),[]);global.localStorage={getItem:()=>{throw Error('blocked')}};assert.deepEqual(readSavedSessions('test'),[])});
test('target consent route retains authorized attendee and exact form',()=>{const route={screen:'experience',member:'g',form:'f'};assert.equal(readAppRoute(appHash(route)).form,'f');assert.equal(readAppRoute(appHash(route)).member,'g')});

test('before the event, next skips all sessions at the featured start time',()=>{const parallel={...first,step_id:'parallel'},later={...first,step_id:'later',starts_at:'2026-12-24T17:00:00Z'};assert.equal(dayHighlights([first,parallel,later],now-86400000).next,later);assert.equal(dayHighlights([first,parallel],now-86400000).next,undefined)});

import {programmePeriod,programmePeriods} from '../src/components/guesthub/programmeView.mjs';
test('programme sections use the event timezone across day boundaries',()=>{
 assert.equal(programmePeriod('2026-12-25T00:30:00Z','America/Indiana/Indianapolis'),'Evening');
 assert.equal(programmePeriod('2026-12-24T17:00:00Z','America/Indiana/Indianapolis'),'Afternoon');
 assert.equal(programmePeriod('2026-12-24T16:59:00Z','America/Indiana/Indianapolis'),'Morning');
 assert.equal(programmePeriod('2026-07-24T16:00:00Z','America/Indiana/Indianapolis'),'Afternoon');
 assert.equal(programmePeriod('bad','UTC'),'Time to be announced');
});
test('visual periods preserve every parallel session in chronological time groups',()=>{
 const rows=Array.from({length:80},(_,i)=>({step_id:String(i),starts_at:new Date(Date.UTC(2026,11,24,13,30*Math.floor(i/5))).toISOString()}));
 const periods=programmePeriods(rows,'America/Indiana/Indianapolis');
 assert.equal(periods.flatMap(p=>p.groups.flatMap(g=>g.sessions)).length,80);
 assert.equal(periods.flatMap(p=>p.groups).length,16);
 assert.deepEqual(periods.map(p=>p.label),['Morning','Afternoon']);
 assert.equal(periods[0].groups[0].sessions.length,5);
});
