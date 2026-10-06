import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProgramme } from '../src/components/guesthub/programmeAudience.mjs';
const session = (id, people, hour) => ({ step_id: id, audience_guest_ids: people, starts_at: `2026-12-24T${hour}:00:00Z`, state: 'upcoming' });
const shared = session('shared', ['adult','child'], '09');
const junior = session('junior', ['child'], '10');
const adult = session('adult', ['adult'], '13');
const program = { viewer_id:'adult', audiences:[{guest_id:'adult',is_self:true},{guest_id:'child'}], days:[{date:'2026-12-24',segments:[shared,junior,session('other1',[],'11'),session('other2',[],'12'),adult]},{date:'2026-12-25',segments:[]}], current_segments:[junior], next_segments:[shared,junior] };
test('default selects own and shared sessions, including upcoming beyond old first three', () => {
 const result=filterProgramme(program);
 assert.deepEqual(result.days[0].segments.map(s=>s.step_id),['shared','adult']);
 assert.deepEqual(result.next_segments.map(s=>s.step_id),['shared','adult']);
 assert.deepEqual(result.current_segments,[]);
 assert.equal(result.days.length,2);
});
test('parent selects child; All restores every group',()=>{
 assert.deepEqual(filterProgramme(program,'child').days[0].segments.map(s=>s.step_id),['shared','junior']);
 assert.equal(filterProgramme(program,'all').days[0].segments.length,5);
 assert.deepEqual(filterProgramme(program,'child').current_segments,[junior]);
});
test('unknown profile falls back to viewer and original data remains unchanged',()=>{
 const before=JSON.stringify(program);
 assert.deepEqual(filterProgramme(program,'stranger'),filterProgramme(program));
 filterProgramme(program,'child');assert.equal(JSON.stringify(program),before);
});
test('legacy payload remains compatible',()=>{
 const old={days:program.days};assert.equal(filterProgramme(old),old);
 assert.equal(filterProgramme(null),null);
});
