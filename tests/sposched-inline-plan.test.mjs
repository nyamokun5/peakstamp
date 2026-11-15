import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInlineWorkerPlan} from '../sposched-inline-plan.mjs';
test('fails closed without official four-match fixture snapshot',()=>{
 assert.throws(()=>buildInlineWorkerPlan({snapshot:{eventId:'x',matches:[]},rows:[],requestId:'x'}));
});
test('does not permit empty snapshot to produce a write plan',()=>{
 assert.throws(()=>buildInlineWorkerPlan({snapshot:null,rows:[],requestId:'x'}));
});
