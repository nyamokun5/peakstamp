import test from 'node:test';
import assert from 'node:assert/strict';
import {journalKey,pendingAttempts,beginAttempt,clearAttempt,inspectAttempt,recoveryDecisionPolicy,retiredMatchRecoveryPolicy,archiveRetiredAttempt,retiredArchiveKey}
 from '../sposched-write-journal.mjs';
import {selectBatchOperations,previewReviewedBatch,executeReviewedBatch,BatchStopped}
 from '../sposched-staging-batch.mjs';
const E='5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
const M='4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const G='2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b';
const H='3f4a5b6c-7d8e-4a0b-9c1d-2e3f4a5b6c7d';
const A='7c1e2a4b-5d6f-4a8b-9c0d-1e2f3a4b5c6d';
const B='0a9b8c7d-6e5f-4d3c-2b1a-0f9e8d7c6b5a';
const C='8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e';
const K='SS手動入力::3f4a5b6c-7d8e-4a0b-9c1d-2e3f4a5b6c7d';
const st=()=>({items:new Map(),getItem(key){return this.items.get(key)||null},
 setItem(key,value){this.items.set(key,String(value))}});
const goal=(id,scorer=A,assist=B,side='left')=>({
 goal_id:id,side,scorer:{player_id:scorer},assist:assist?{player_id:assist}:null});
const official=(goals=[])=>({event_id:E,match_id:M,goals});
const action=(scorer=A,assist=B)=>({action:'create',match_id:M,side:'left',
 scorer_id:scorer,assist_id:assist});
test('write attempt is persisted before POST, never stores a token, and locks concurrent retry',()=>{
 const store=st(),before=official(),a=action();
 const attempt=beginAttempt(store,E,K,a,before,1793041200000);
 assert.equal(attempt.goalKey,K);
 assert.equal(attempt.beforeGoalIds.length,0);
 assert.equal(pendingAttempts(store,E).length,1);
 const json=store.getItem(journalKey(E));
 assert.doesNotMatch(json,/BRIDGE_TOKEN|spk_|preview_token|TEST-ONLY WRITE/);
 assert.throws(()=>beginAttempt(store,E,K,a,before),/未確認/);
});
test('lost POST response stays locked across reload, fresh matching goal is only possible evidence',()=>{
 const store=st(),a=action(),original=official([goal(G,C,null)]);
 const attempt=beginAttempt(store,E,K,a,original);
 const reloaded=pendingAttempts(store,E)[0];
 assert.deepEqual(reloaded.beforeGoalIds,[G]);
 const identicalPrior=inspectAttempt(reloaded,original);
 assert.equal(identicalPrior.state,'not_observed');
 const after=official([goal(G,C,null),goal(H,A,B)]);
 const evidence=inspectAttempt(reloaded,after);
 assert.equal(evidence.state,'possible_created');
 assert.deepEqual(evidence.goalIds,[H]);
 assert.throws(()=>beginAttempt(store,E,'video::2',a,after),/未確認/);
 clearAttempt(store,E,K);
 assert.deepEqual(pendingAttempts(store,E),[]);
});
test('an old matching scorer is not claimed as proof of a newly sent goal',()=>{
 const store=st(),before=official([goal(G,A,B)]);
 const attempt=beginAttempt(store,E,K,action(),before);
 assert.equal(inspectAttempt(attempt,before).state,'not_observed');
 assert.equal(inspectAttempt(attempt,official([...before.goals,goal(H,C,null)])).state,'other_changes');
});
test('patch evidence matches the exact existing goal UUID and requested player IDs',()=>{
 const store=st(),patch={action:'patch',match_id:M,goal_id:G,scorer_id:A,assist_id:null};
 const prior=official([goal(G,A,B)]);
 const entry=beginAttempt(store,E,K,patch,prior);
 assert.equal(inspectAttempt(entry,prior).state,'not_applied');
 assert.equal(inspectAttempt(entry,official([goal(G,A,null)])).state,'possible_applied');
 assert.equal(inspectAttempt(entry,official([])).state,'target_missing');
});
test('failed local journal write stops before any network POST',()=>{
 const store={getItem:()=>null,setItem:()=>{throw Error('quota')}};
 assert.throws(()=>beginAttempt(store,E,K,action(),official()),/書き込みを停止/);
 assert.throws(()=>journalKey('invalid'),/イベントID/);
 const corrupt=st();corrupt.setItem(journalKey(E),'invalid-json');
 assert.throws(()=>pendingAttempts(corrupt,E),/破損/);
 const wrong=st();wrong.setItem(journalKey(E),JSON.stringify([{goalKey:K}]));
 assert.throws(()=>pendingAttempts(wrong,E),/形式/);
 const broken=beginAttempt(st(),E,K,action(),official());
 assert.throws(()=>inspectAttempt(broken,{...official(),event_id:'another'}),/一致/);
});
test('sequential batch writes journal before each POST, clears only after readback',async()=>{
 const s=st(),source={operations:[
  {action:'record_goal',args:{seq:1,scorer:'a',team:'1'}},
  {action:'record_goal',args:{seq:1,scorer:'b',team:'1'}}]};
 const selected=selectBatchOperations(source,[0,1]);
 const resolve=op=>action(op.args.scorer==='a'?A:C,op.args.scorer==='a'?B:null);
 const preview=async a=>({environment:'STAGING ONLY',
  team_id:'dbb50f85-9d9a-408c-9482-497abbca399c',preview_token:'signed',
  plan:{action:'create',match_id:M,side:'left',before:null,
    after:{scorer:a.scorer_id,assist:a.assist_id}}});
 const entries=await previewReviewedBatch({selected,
  resolveAction:async op=>resolve(op),previewAction:preview});
 const calls=[];
 const completed=await executeReviewedBatch({entries,
  resolveAction:async op=>resolve(op),previewAction:preview,
  beforeExecute:async(item,a)=>{
   beginAttempt(s,E,'video::'+item.index,a,official());
   calls.push('before '+item.index);
  },
  executeAction:async()=>{
   assert.equal(pendingAttempts(s,E).length,1,'journal must exist before POST');
   calls.push('POST');return {write_sent:true,readback:{verified:true}};
  },
  afterExecute:async item=>{
   clearAttempt(s,E,'video::'+item.index);
   calls.push('cleared '+item.index);
  }});
 assert.equal(completed.length,2);
 assert.deepEqual(calls,['before 0','POST','cleared 0','before 1','POST','cleared 1']);
 assert.equal(pendingAttempts(s,E).length,0);
});
test('uncertain network error stops batch after first POST and blocks new attempts',async()=>{
 const s=st(),source={operations:[{action:'record_goal',args:{seq:1,scorer:'a',team:'1'}},
  {action:'record_goal',args:{seq:1,scorer:'b',team:'1'}}]};
 const selected=selectBatchOperations(source,[0,1]);
 const resolve=op=>action(op.args.scorer==='a'?A:C,null);
 const preview=async a=>({environment:'STAGING ONLY',
  team_id:'dbb50f85-9d9a-408c-9482-497abbca399c',preview_token:'signed',
  plan:{action:'create',match_id:M,side:'left',before:null,
   after:{scorer:a.scorer_id,assist:null}}});
 const entries=await previewReviewedBatch({selected,
  resolveAction:async op=>resolve(op),previewAction:preview});
 let posts=0;
 await assert.rejects(executeReviewedBatch({entries,
  resolveAction:async op=>resolve(op),previewAction:preview,
  beforeExecute:async(item,a)=>beginAttempt(s,E,'video::'+item.index,a,official()),
  executeAction:async()=>{posts++;throw Error('network lost')},
  afterExecute:async item=>clearAttempt(s,E,'video::'+item.index)
 }),err=>{
  assert.ok(err instanceof BatchStopped);
  assert.equal(err.completed.length,0);
  assert.equal(err.failedIndex,0);return true
 });
 assert.equal(posts,1);
 assert.equal(pendingAttempts(s,E).length,1);
 await assert.rejects(executeReviewedBatch({entries,
  resolveAction:async op=>resolve(op),previewAction:preview,
  beforeExecute:async(item,a)=>beginAttempt(s,E,'video::'+item.index,a,official()),
  executeAction:async()=>{posts++;return {write_sent:true,readback:{verified:true}}}
 }),/未確認/);
 assert.equal(posts,1,'must not send again after ambiguous previous response');
});

test('recovery forbids retry when SS already shows a likely write or concurrent changes',()=>{
 for(const state of ['possible_created','possible_applied','other_changes','target_missing']){
  const policy=recoveryDecisionPolicy({state});
  assert.equal(policy.allowReturnToReview,false,'must fail closed: '+state);
  assert.equal(policy.allowMarkSent,true);
 }
 for(const state of ['not_observed','not_applied']){
  const policy=recoveryDecisionPolicy({state});
  assert.equal(policy.allowReturnToReview,true);
  assert.match(policy.reason,/未登録と確認/);
 }
 assert.equal(recoveryDecisionPolicy(null).allowReturnToReview,false);
});

test('retired TEST match with pending historical DO can be archived only after two 404s and unchanged new UUIDs',()=>{
 const store=st(),entry=beginAttempt(store,E,K,action(),official(),1793041200000);
 const newer='d0e0f0a0-1111-4111-8111-111111111111';
 const verified={currentMatchIds:[newer],oldMatchHttpStatus:404,batchJobActive:false};
 const policy=(ids,status,code,extra=verified)=>
  retiredMatchRecoveryPolicy(entry,E,ids,code,status,extra);
 assert.equal(policy([newer],'pending',404).allowArchive,true);
 assert.equal(policy([newer],'verified',404).allowArchive,true);
 assert.equal(policy([newer],'idle',404).allowArchive,true);
 assert.equal(policy([newer],'unknown',404).allowArchive,false);
 assert.equal(policy([newer],'pending',503).allowArchive,false);
 assert.equal(policy([M],'pending',404).allowArchive,false);
 assert.equal(policy([],'pending',404).allowArchive,false);
 assert.equal(retiredMatchRecoveryPolicy(entry,'another',[newer],404,'pending',verified).allowArchive,false);
 assert.equal(policy([newer],'pending',404,{...verified,oldMatchHttpStatus:500}).allowArchive,false);
 assert.equal(policy([newer],'pending',404,{...verified,currentMatchIds:[M]}).allowArchive,false);
 assert.equal(policy([newer],'pending',404,{...verified,batchJobActive:true}).allowArchive,false);
 assert.equal(policy([newer],'pending',404,null).allowArchive,false);
 assert.throws(()=>archiveRetiredAttempt(store,E,K,policy([newer],'pending',404,null)),/一致/);
 assert.equal(pendingAttempts(store,E).length,1);
 const permission=policy([newer],'pending',404);
 assert.equal(permission.old_write_outcome,'unknown');
 archiveRetiredAttempt(store,E,K,permission,1793041300000);
 assert.deepEqual(pendingAttempts(store,E),[]);
 const audit=JSON.parse(store.getItem(retiredArchiveKey(E)));
 assert.equal(audit.length,1);
 assert.equal(audit[0].match_id,M);
 assert.equal(audit[0].resolution,'old_official_match_404_manual_archive_no_write');
 assert.equal(audit[0].worker_gate_status,'pending');
 assert.equal(audit[0].archived_at,1793041300000);
 assert.doesNotMatch(JSON.stringify(audit),/BRIDGE_TOKEN|preview_token/);
});
test('archival storage failure preserves the original uncertain TEST journal',()=>{
 const store=st(),entry=beginAttempt(store,E,K,action(),official());
 const newer='d0e0f0a0-1111-4111-8111-111111111111';
 const permission=retiredMatchRecoveryPolicy(entry,E,[newer],404,'verified',{
  currentMatchIds:[newer],oldMatchHttpStatus:404,batchJobActive:false});
 const oldSet=store.setItem.bind(store);
 store.setItem=(key,val)=>{
  if(key===retiredArchiveKey(E))throw Error('storage full');
  return oldSet(key,val);
 };
 assert.throws(()=>archiveRetiredAttempt(store,E,K,permission),/保管できません/);
 assert.equal(pendingAttempts(store,E).length,1);
});
