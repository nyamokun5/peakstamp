import test from 'node:test';
import assert from 'node:assert/strict';
import {makeManualGoal,manualStoreKey,restoreManualGoals,storeManualGoals,
 markManualCompleted,unsentManualGoals,applyManualRowEdits} from '../sposched-manual-goals.mjs';
import {normalizeSpoSnapshot,prepareGoalRows,buildReviewPayload} from '../sposched-review-core.mjs';
import {selectBatchOperations} from '../sposched-staging-batch.mjs';
import {toStagingAction} from '../sposched-staging-client.mjs';
const E='5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
const M='4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const A='7c1e2a4b-5d6f-4a8b-9c0d-1e2f3a4b5c6d';
const B='0a9b8c7d-6e5f-4d3c-2b1a-0f9e8d7c6b5a';
const C='8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e';
const I='3f4a5b6c-7d8e-4a0b-9c1d-2e3f4a5b6c7d';
const J='6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c';
const K='7e8f9a0b-1c2d-4e3f-9a5b-6c7d8e9f0a1b';
const store=()=>({m:new Map(),getItem(k){return this.m.get(k)||null},
 setItem(k,v){this.m.set(k,String(v))}});
const snapshot=()=>normalizeSpoSnapshot({event_id:E,event:'テスト日曜',roster:{
 'チーム1':['太郎','花子'],'チーム2':['次郎']},
 matches:[{seq:1,match_id:M,left_team:'チーム1',right_team:'チーム2',
 left_score:0,right_score:0,goals:[]}]});
const official=()=>({match_id:M,event_id:E,status:'scheduled',goals:[],
 left:{name:'チーム1',players:[{name:'太郎',player_id:A},{name:'花子',player_id:B}],helpers:[]},
 right:{name:'チーム2',players:[{name:'次郎',player_id:C}],helpers:[]}});
const review=(g,s)=>prepareGoalRows({goals:[g]},s)[0];
test('no video/AI source: blank manual goal is editable but not prematurely sendable',()=>{
 const s=snapshot(),g=makeManualGoal(I),row=review(g,s);
 assert.equal(g.manual,true);assert.equal(g.source.name,'SS手動入力');
 assert.equal(row.confirmed,false);assert.equal(row.assistMode,'unknown');
 assert.throws(()=>buildReviewPayload(s,[row]),/確認が必要/);
});
test('manual-only new registration uses the existing validated goal pipeline',()=>{
 const s=snapshot(),g=makeManualGoal(I),row=review(g,s);
 Object.assign(row,{seq:1,scorer:'太郎',assist:'花子',assistMode:'named',
  team:'チーム1',confirmed:true});
 const draft=buildReviewPayload(s,[row]);
 assert.equal(draft.operations.length,1);
 assert.equal(draft.operations[0].action,'record_goal');
 assert.equal(draft.operations[0].fromPeakStamp.source,'SS手動入力');
 const action=toStagingAction(s,draft.operations[0],official());
 assert.deepEqual(action,{action:'create',match_id:M,side:'left',scorer_id:A,assist_id:B});
});
test('two video-free manual entries can appear in a reviewed TEST-only batch',()=>{
 const s=snapshot(),gs=[makeManualGoal(I),makeManualGoal(J)];
 const rows=prepareGoalRows({goals:gs},s);
 Object.assign(rows[0],{seq:1,scorer:'太郎',assistMode:'none',team:'チーム1',confirmed:true});
 Object.assign(rows[1],{seq:1,scorer:'次郎',assistMode:'none',team:'チーム2',confirmed:true});
 const plan=buildReviewPayload(s,rows);
 assert.deepEqual(selectBatchOperations(plan,[0,1]).map(i=>i.operation.action),['record_goal','record_goal']);
});
test('manual drafts persist by event, preserve form selections, and never persist token',()=>{
 const st=store(),g=makeManualGoal(I);
 g.review={seq:1,scorer:'太郎',assist:'花子',assistMode:'named',
  team:'チーム1',guest:false,include:true};
 storeManualGoals(st,'staging',E,[g]);
 const raw=st.getItem(manualStoreKey('staging',E));
 assert.ok(!raw.includes('BRIDGE_TOKEN'));
 assert.ok(!raw.includes('spk_'));
 const saved=restoreManualGoals(st,'staging',E);
 assert.equal(saved[0].review.scorer,'太郎');
 const s=snapshot();
 const row=applyManualRowEdits([review(saved[0],s)],saved,s)[0];
 assert.equal(row.scorer,'太郎');
 assert.equal(row.assist,'花子');
 assert.equal(row.seq,1);
 assert.equal(row.confirmed,false);
 assert.deepEqual(restoreManualGoals(st,'staging',K),[]);
 assert.deepEqual(restoreManualGoals(st,'production',E),[]);
});
test('stale unknown scorer/assist or missing match is cleared when restoring',()=>{
 const g=makeManualGoal(I);g.review={seq:999,scorer:'不明',assist:'不明',
  assistMode:'named',team:'チーム1',guest:false,include:true};
 const s=snapshot(),row=applyManualRowEdits([review(g,s)],[g],s)[0];
 assert.equal(row.seq,null);
 assert.equal(row.scorer,'');
 assert.equal(row.assist,'');
 assert.equal(row.team,'');
});
test('completed manual goal is not added twice even after page reload',()=>{
 const st=store(),gs=[makeManualGoal(I),makeManualGoal(J)];
 const done=markManualCompleted(gs,['SS手動入力::'+I]);
 assert.deepEqual(unsentManualGoals(done).map(g=>g.id),[J]);
 storeManualGoals(st,'staging',E,done);
 const again=restoreManualGoals(st,'staging',E);
 assert.deepEqual(unsentManualGoals(again).map(g=>g.id),[J]);
 assert.equal(again[0].sent,true);
});
test('reject malformed manual entries and invalid SS event identifiers',()=>{
 assert.throws(()=>makeManualGoal('id'),/ID/);
 assert.throws(()=>manualStoreKey('other',E),/接続先/);
 assert.throws(()=>manualStoreKey('staging','not-a-uuid'),/イベント/);
 const st=store();
 st.setItem(manualStoreKey('staging',E),JSON.stringify([
  {...makeManualGoal(I),id:'x'},makeManualGoal(J),makeManualGoal(J),
  {...makeManualGoal(K),sent:'YES'}]));
 assert.deepEqual(restoreManualGoals(st,'staging',E).map(g=>g.id),[J]);
});
