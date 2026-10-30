import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
import {prepareWorkerIndependent,verifyIndependentWorkerCompletion} from '../sposched-worker-independent.mjs';
const eventId='01234567-89ab-4cde-8abc-0123456789ab',requestId='11234567-89ab-4cde-8abc-0123456789ab';
const mid=i=>'21234567-89ab-4cde-8abc-'+String(i).padStart(12,'0');
const make=(count,overrides={})=>normalizeSpoSnapshot({event_id:eventId,
 matches:Array.from({length:count},(_,i)=>({
  seq:i+1,match_id:mid(i+1),title:count===5?'#'+(1+Math.floor(i/2))+' Pitch'+(1+i%2):'リーグ #'+(i+1),
  left_team:i%2?'Red':'White',right_team:i%2?'White':'Red',
  status:'scheduled',left_score:0,right_score:0,goals:[],
  ...overrides[i+1]
 })),
 roster:{White:['Aki','Sora'],Red:['Mika']}});
const build=(snapshot,rows=[],decisions=[])=>prepareWorkerIndependent({snapshot,rows,decisions,requestId});
test('SS one, three, five and eight independent fixtures use the exact official UUIDs',()=>{
 for(const n of [1,3,5,8]){
  const s=make(n),p=build(s);
  assert.equal(p.layout_mode,'independent-fixtures-v1');assert.equal(p.fixture_count,n);
  assert.equal(p.operations.length,n);
  assert.deepEqual(p.operations.map(x=>x.expected_match_id),Array.from({length:n},(_,i)=>mid(i+1)));
  assert.deepEqual(p.operations.map(x=>x.seq),Array.from({length:n},(_,i)=>i+1));
 }
});
test('reviewed goal is bound to official seq and unique match ID',()=>{
 const s=make(3);
 const row={include:true,seq:2,scorer:'Mika',team:'Red',assistMode:'named',assist:'Sora',
  goal:{}};
 assert.throws(()=>build(s,[row],[{state:'ready'}]),/所属/);
 row.assistMode='none';row.assist='';
 const p=build(s,[row],[{state:'ready'}]);
 assert.deepEqual(p.operations.slice(1,3),[
  {seq:2,action:'create',scorer:'Mika',team:'Red',assist:'',expected_match_id:mid(2)},
  {seq:2,action:'finish',winner:'auto',expected_match_id:mid(2)}
 ]);
});
test('unsafe fixtures and unreviewed goals stop before planning',()=>{
 for(const snapshot of [
  make(3,{2:{status:'waiting'}}),make(3,{3:{status:'finished'}}),
  make(3,{1:{left_score:2}}),make(3,{1:{match_id:''}}),
  make(3,{2:{title:'#2 決勝'}}),make(3,{2:{left_team:'White',right_team:'White'}}),
  make(3,{2:{goals:[{goal_id:mid(22),scorer:'Mika',team:'Red'}]}})
 ])assert.throws(()=>build(snapshot));
 const s=make(3),row={include:true,seq:1,scorer:'Aki',team:'White',
  assistMode:'none',goal:{}};
 for(const decision of [{state:'attention',reason:'名前が不明'}, {state:'waiting'},
  {state:'ready',helperPlan:{team:'White'}}])
  assert.throws(()=>build(s,[row],[decision]));
});
test('independent completion requires the same event and all fresh exact finished IDs',()=>{
 const s=make(3),state={event_id:eventId,status:'completed',
  layout_mode:'independent-fixtures-v1',fixture_count:3,
  fixture_ids:{'1':mid(1),'2':mid(2),'3':mid(3)}};
 const fresh=make(3,{1:{status:'finished'},2:{status:'finished'},3:{status:'finished'}});
 assert.equal(verifyIndependentWorkerCompletion(state,fresh,s),true);
 for(const bad of [make(2),make(3,{2:{status:'waiting'}}),
   make(3,{2:{status:'finished',match_id:mid(21)}})])
  assert.throws(()=>verifyIndependentWorkerCompletion(state,bad,s));
});
