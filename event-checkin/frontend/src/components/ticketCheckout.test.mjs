import test from 'node:test';import assert from 'node:assert/strict';import {ticketQuantity,checkoutSummary} from './ticketCheckout.mjs';
const ticket={id:'general',price:5000,available:200,max_per_order:10,product_type:'ticket'};
test('$50 multi-ticket totals include the configured buyer fee',()=>{for(const n of [1,2,4,10])assert.deepEqual(checkoutSummary({tickets:[ticket],fee:{bps:500,paid_by:'buyer'}},{general:n}),{subtotal:5000*n,fee:250*n,tax:0,total:5250*n});});
test('quantity respects stock, order limits and whole ticket counts',()=>{assert.equal(ticketQuantity(999,ticket),10);assert.equal(ticketQuantity(4.8,ticket),4);assert.equal(ticketQuantity(-2,ticket),0);assert.equal(ticketQuantity(8,{...ticket,available:3}),3);});
test('organizer-paid fees are not added to the buyer total',()=>assert.equal(checkoutSummary({tickets:[ticket],fee:{bps:500,paid_by:'organizer'}},{general:2}).total,10000));
