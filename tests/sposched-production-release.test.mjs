import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProductionBatch,validateProductionReleaseEvidence,productionBatchStorageKey}
 from '../sposched-production-release.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',T='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const ids=[1,2,3,4].map(n=>'11111111-1111-4111-8111-11111111111'+n);
const snapshot={eventId:E,matches:ids.map((matchId,i)=>({
 seq:i+1,matchId,status:i<2?'scheduled':'waiting',
 leftTeam:'Team '+(i+1),rightTeam:'Team '+(i+2)
})),playerTeam:new Map(),players:[]};
const inspect={environment:'PRODUCTION',mode:'read-only',team_pinned:true,
 write_allowed:false,release_approved:false,event_id:E,team_id:T,
 event_date:'2026-11-01',
 matches:ids.map((match_id,i)=>({seq:i+1,match_id,status:i<2?'scheduled':'waiting'}))};
const release={environment:'PRODUCTION',event_id:E,target_event_id:E,
 scope:'current-target',release_ready:true};

test('production requires independent matching tenant and immutable four-fixture IDs',()=>{
 const r=validateProductionReleaseEvidence(snapshot,inspect,release);
 assert.equal(r.event_id,E);assert.equal(r.team_id,T);
 assert.deepEqual(r.fixture_ids,ids);
});
test('disabled release, mismatched event and duplicate fixture IDs all block',()=>{
 for(const [s,i,l] of [
  [snapshot,inspect,{...release,release_ready:false}],
  [snapshot,inspect,{...release,target_event_id:T}],
  [snapshot,inspect,{...release,scope:'single-event'}],
  [snapshot,{...inspect,event_id:T},release],
  [snapshot,{...inspect,write_allowed:true},release],
  [snapshot,{...inspect,team_pinned:false},release],
  [snapshot,{...inspect,matches:inspect.matches.map((m,j)=>j===3?{...m,match_id:ids[0]}:m)},release],
  [snapshot,{...inspect,matches:inspect.matches.map((m,j)=>j===2?{...m,status:'finished'}:m)},release]
 ])assert.throws(()=>validateProductionReleaseEvidence(s,i,l));
});
test('production adapter reuses the existing four-match planner but never its TEST confirmation',()=>{
 const job=prepareProductionBatch({snapshot,rows:[],decisions:[],
  requestId:'22222222-2222-4222-8222-222222222222'});
 assert.equal(job.confirm,'PRODUCTION EVENT BATCH WRITE');
 assert.equal(job.event_id,E);
 assert.equal(job.operations.length,4);
 assert.ok(job.operations.every(o=>o.action==='finish'));
 assert.match(productionBatchStorageKey(E),/production/);
});

test('official #3 and #4 waiting without UUID are accepted only as non-write placeholders',()=>{
 const pendingSnapshot={...snapshot,matches:snapshot.matches.map((m,i)=>i>=2?{...m,matchId:''}:m)};
 const pendingInspect={...inspect,matches:inspect.matches.map((m,i)=>i>=2?{...m,match_id:''}:m)};
 assert.deepEqual(validateProductionReleaseEvidence(pendingSnapshot,pendingInspect,release).fixture_ids,
  [ids[0],ids[1],'','']);
 assert.throws(()=>validateProductionReleaseEvidence(pendingSnapshot,{
  ...pendingInspect,matches:pendingInspect.matches.map((m,i)=>i===2?{...m,status:'scheduled'}:m)
 },release));
});
