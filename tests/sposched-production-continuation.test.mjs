import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionSecondRoundAppend} from '../sposched-production-continuation.mjs';
const ids=[1,2,3,4].map(n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12));
const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const snapshot={eventId,matches:ids.map((matchId,i)=>({seq:i+1,matchId,status:i<2?'finished':'scheduled'}))};
const workerJob={inspection_only:true,execution_active:false,inspection_contract:'event-inspect-v1',environment:'PRODUCTION',event_id:eventId,request_id:requestId,layout_mode:'four-knockout-staged-v1',status:'awaiting_second_round',phase:'preparing',cursor:2,total:2,completed:2,fixture_ids:{1:ids[0],2:ids[1]}};
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

test('rejects stale or actively executing production inspection',()=>{
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob:{...workerJob,inspection_only:false},operations}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob:{...workerJob,execution_active:true},operations}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob:{...workerJob,inspection_contract:'unexpected'},operations}));
});

test('accepts a goal followed by the two official second-round finishes',()=>{
 const withGoal=[{seq:3,action:'create',team:'A',scorer:'Player A',assist:'',expected_match_id:ids[2]},...operations];
 const result=buildProductionSecondRoundAppend({snapshot,workerJob,operations:withGoal});
 assert.deepEqual(result.operations,withGoal);
 assert.equal(result.operations.some(op=>op.seq<=2),false);
});
test('rejects an append if the saved job is incomplete or fixture IDs change',()=>{
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob:{...workerJob,completed:1},operations}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob:{...workerJob,fixture_ids:{1:ids[1],2:ids[0]}},operations}));
 assert.throws(()=>buildProductionSecondRoundAppend({snapshot,workerJob,operations:[operations[1],operations[0]]}));
});

test('refuses second-round writes until both fixtures are scheduled and not finished',()=>{
 for(const status of ['waiting','finished','running']){
  const changed={...snapshot,matches:snapshot.matches.map(m=>m.seq===3?{...m,status}:m)};
  assert.throws(()=>buildProductionSecondRoundAppend({snapshot:changed,workerJob,operations}));
 }
});
