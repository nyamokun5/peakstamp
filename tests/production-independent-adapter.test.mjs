import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareIndependentProductionBatch,validateIndependentProductionEvidence} from '../sposched-production-independent.mjs';
const id=n=>'21234567-89ab-4cde-8abc-'+String(n).padStart(12,'0');
test('production independent evidence fails closed without official target approval',()=>{
 const eventId=id(99);
 const snapshot={eventId,matches:[1,2].map(seq=>({seq,matchId:id(seq),status:'scheduled',
  leftTeam:'A',rightTeam:'B',leftScore:0,rightScore:0,existingGoals:[]}))};
 assert.throws(()=>validateIndependentProductionEvidence(snapshot,{},{}));
});
test('production independent planner does not authorize writes on invalid roster',()=>{
 assert.throws(()=>prepareIndependentProductionBatch({
  snapshot:{eventId:id(99),rosterSource:'stale',matches:[]},
  rows:[],decisions:[],requestId:id(100)
 }));
});

test('production adapter validates matching current-target independent fixtures without a write',()=>{
 const eventId=id(99);
 const snapshot={eventId,matches:[1,2,3].map(seq=>({seq,matchId:id(seq),status:'scheduled',
  leftTeam:'Blue '+seq,rightTeam:'Red '+seq,leftScore:0,rightScore:0,existingGoals:[]}))};
 const inspect={environment:'PRODUCTION',mode:'read-only',team_pinned:true,
  write_allowed:false,release_approved:false,event_id:eventId,team_id:id(98),
  event_date:'2026-11-01',matches:[1,2,3].map(seq=>({
   seq,match_id:id(seq),status:'scheduled'
  }))};
 const release={environment:'PRODUCTION',release_ready:true,scope:'current-target',
  target_event_id:eventId,event_id:eventId};
 const result=validateIndependentProductionEvidence(snapshot,inspect,release);
 assert.equal(result.fixture_count,3);
 assert.equal(result.layout_mode,'independent-fixtures-v1');
 assert.deepEqual(result.fixture_ids,[id(1),id(2),id(3)]);
 assert.throws(()=>validateIndependentProductionEvidence(snapshot,{
  ...inspect,matches:inspect.matches.map((m,i)=>i===1?{...m,match_id:id(1)}:m)
 },release));
});
