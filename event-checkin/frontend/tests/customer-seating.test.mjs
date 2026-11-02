import test from 'node:test'
import assert from 'node:assert/strict'
import {seatingPlan,hasPlannedTables,plannedTableNames} from '../src/pages/customerSeatingModel.mjs'
const create=patch=>seatingPlan({mode:'guests',guests:200,tables:20,seatsPerTable:10,...patch})
test('200 guests and ten seats suggest twenty tables',()=>{const p=create({});assert.equal(p.tableCount,20);assert.equal(p.totalSeats,200);assert.equal(p.spare,0)})
test('rounds up instead of leaving guests without seats',()=>{const p=create({guests:201});assert.equal(p.tableCount,21);assert.equal(p.spare,9)})
test('uses existing capacity and adds only the missing tables',()=>{const p=create({existingTables:[{capacity:10},{capacity:10}]});assert.equal(p.tableCount,18);assert.equal(p.totalSeats,200)})
test('does not propose more tables when existing seats suffice',()=>{const p=create({guests:5,existingTables:[{capacity:10}]});assert.equal(p.tableCount,0);assert.equal(p.spare,5)})
test('table-count planning accepts unknown guest count',()=>{const p=create({mode:'tables',guests:'',tables:20});assert.equal(p.tableCount,20);assert.equal(p.totalSeats,200);assert.equal(p.targetGuests,null)})
test('table-count mode shows a real shortfall',()=>{const p=create({mode:'tables',tables:19});assert.equal(p.shortfall,10);assert.equal(p.totalSeats,190)})
test('invalid capacities and fractional counts cannot be submitted',()=>{for(const seats of [0,-1,101,1.2,''])assert.ok(create({seatsPerTable:seats}).error);for(const guests of [0,-1,2.5,''])assert.ok(create({guests}).error)})
test('respects the existing server batch limit',()=>assert.ok(create({guests:2001}).error))
test('single table remains available without a guest estimate',()=>{const p=create({mode:'single',guests:''});assert.equal(p.tableCount,1);assert.equal(p.newSeats,10)})
test('duplicate batch detection is case insensitive and checks full names',()=>{assert.deepEqual(plannedTableNames(' Guest tables ',2),['Guest tables 1','Guest tables 2']);assert.equal(hasPlannedTables([{name:'GUEST TABLES 1'}],'Guest tables',20),true);assert.equal(hasPlannedTables([{name:'Guest tables 100'}],'Guest tables',20),false)})
