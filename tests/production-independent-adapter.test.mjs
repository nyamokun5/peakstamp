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
