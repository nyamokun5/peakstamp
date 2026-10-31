import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
import {prepareIndependentProductionBatch} from '../sposched-production-independent.mjs';
const id=n=>'21234567-89ab-4cde-8abc-'+String(n).padStart(12,'0');
const raw=()=>({kind:'peakstamp-sposched-snapshot',version:1,
 source:'SpoSched Match API v1.3',roster_source:'official-current-event-teams',
 event_id:id(99),event:{name:'League',status:'target'},
 roster:{Blue:['Alice','Assist'],Red:['Bob']},
 matches:[1,2].map(seq=>({seq,match_id:id(seq),title:'League',status:'scheduled',
  left_team:'Blue',right_team:'Red',left_score:0,right_score:0,goals:[]}))});
const plan=snapshot=>prepareIndependentProductionBatch({snapshot,requestId:id(98),
 rows:[],decisions:[]});
test('official snapshot roster evidence survives normalization and reaches the independent production planner',()=>{
 const snapshot=normalizeSpoSnapshot(raw());
 assert.equal(snapshot.rosterSource,'official-current-event-teams');
 assert.equal(snapshot.playerTeam.get('Alice'),'Blue');
 assert.deepEqual(snapshot.matches.map(m=>m.matchId),[id(1),id(2)]);
 const result=plan(snapshot);
 assert.equal(result.fixture_count,2);
 assert.equal(result.layout_mode,'independent-fixtures-v1');
 assert.equal(result.confirm,'PRODUCTION EVENT BATCH WRITE');
});
test('roster contents, stale evidence and malformed producer metadata cannot infer a current roster',()=>{
 for(const change of [x=>delete x.roster_source,x=>x.roster_source='stale',
  x=>x.roster_source={source:'official-current-event-teams'},x=>delete x.kind,
  x=>x.version=2,x=>x.source='imported',x=>x.roster=[],
  x=>x.roster={Blue:'Alice'},x=>x.roster={Blue:[{}]}]){
  const value=raw();change(value);
  const snapshot=normalizeSpoSnapshot(value);
  assert.equal(snapshot.rosterSource,null);
  assert.throws(()=>plan(snapshot));
 }
});
test('wrapped snapshots preserve only their own evidence and never inherit wrapper approval',()=>{
 for(const wrapper of [x=>({result:x}),x=>({match_results:x}),x=>({result:{match_results:x}})]){
  assert.equal(normalizeSpoSnapshot(wrapper(raw())).rosterSource,'official-current-event-teams');
  const stale=raw();delete stale.roster_source;
  assert.equal(normalizeSpoSnapshot({...raw(),...wrapper(stale),matches:undefined}).rosterSource,null);
 }
});
