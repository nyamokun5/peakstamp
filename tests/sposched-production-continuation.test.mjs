import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionSecondRoundAppend} from '../sposched-production-continuation.mjs';
const ids=[1,2,3,4].map(n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12));
const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const snapshot={eventId,matches:ids.map((matchId,i)=>({seq:i+1,matchId,status:i<2?'finished':'scheduled'}))};
const workerJob={environment:'PRODUCTION',event_id:eventId,request_id:requestId,layout_mode:'four-knockout-staged-v1',status:'awaiting_second_round',phase:'preparing',cursor:2,total:2,completed:2,fixture_ids:{1:ids[0],2:ids[1]}};
const operations=[{seq:3,action:'finish',winner:'left',expected_match_id:ids[2]},{seq:4,action:'finish',winner:'draw',expected_match_id:ids[3]}];
test('builds production append without replaying semifinals',()=>{
 const result=buildProductionSecondRoundAppend({snapshot,workerJob,operations});
 assert.equal(result.confirm,'PRODUCTION EVENT BATCH APPEND');
 assert.deepEqual(result.operations,operations);
});
test('rejects staging, unfinished semifinals and mismatched official fixture',()=>{
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob:{...workerJob,environment:'STAGING'},operations}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot:{...snapshot,matches:snapshot.matches.map((m,i)=>i===0?{...m,status:'scheduled'}:m)},workerJob,operations}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob,operations:[{...operations[0],expected_match_id:ids[0]},operations[1]]}));
});
test('rejects repeated or missing second-round finishes',()=>{
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob,operations:[operations[0],operations[0]]}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob,operations:[operations[0]]}));
});
