import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAutoGoalRead} from '../sposched-auto-goal-read.mjs';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
import {assertCurrentNumberedFixture,toStagingAction} from '../sposched-staging-client.mjs';
const E='11111111-1111-4111-8111-111111111111',
 M='22222222-2222-4222-8222-222222222221',
 P='33333333-3333-4333-8333-333333333331';
const raw=(id=M)=>({event_id:E,matches:[{
 match_id:id,seq:1,status:'scheduled',left_team:'チーム1',right_team:'チーム2',
 left_score:0,right_score:0,goals:[]
}],roster:{'チーム1':['太郎'],'チーム2':['次郎']}});
const match=(over={})=>({
 match_id:M,event_id:E,seq:1,number:1,status:'scheduled',
 left:{name:'チーム1',players:[{name:'太郎',player_id:P}]},
 right:{name:'チーム2',players:[]},goals:[],...over
});
const op={action:'record_goal',args:{event_id:E,seq:1,team:'チーム1',scorer:'太郎'}};
const args=(patch={})=>({
 snapshot:normalizeSpoSnapshot(raw()),operation:op,
 readSnapshot:async()=>raw(),readMatch:async()=>match(),
 normalizeSnapshot:normalizeSpoSnapshot,assertNumbered:assertCurrentNumberedFixture,
 toAction:toStagingAction,...patch
});
test('start independent official bracket and match reads concurrently',async()=>{
 const calls=[];let release;
 const waiting=new Promise(ok=>{release=ok});
 const p=resolveAutoGoalRead(args({
  readSnapshot:async()=>{calls.push('snapshot GET');await waiting;return raw()},
  readMatch:async()=>{calls.push('match GET');await waiting;return match()}
 }));
 await Promise.resolve();
 assert.deepEqual(calls,['snapshot GET','match GET']);
 release();
 const result=await p;
 assert.deepEqual(result.action,{action:'create',match_id:M,side:'left',
  scorer_id:P,assist_id:null});
 assert.equal(result.before.match_id,M);
 assert.equal(calls.length,2);
});
test('fail before write if slot UUID or team mapping drifts',async()=>{
 await assert.rejects(resolveAutoGoalRead(args({
  readSnapshot:async()=>raw('44444444-4444-4444-8444-444444444444')
 })),/match_id/);
 await assert.rejects(resolveAutoGoalRead(args({
  readMatch:async()=>match({left:{name:'WRONG',players:[]}})
 })),/対戦相手/);
 await assert.rejects(resolveAutoGoalRead(args({
  readMatch:async()=>match({status:'finished'})
 })),/状態/);
});
test('reject unknown or non-goal operation before any API request',async()=>{
 let calls=0;
 await assert.rejects(resolveAutoGoalRead(args({
  operation:{action:'patch_goal',args:{seq:1}},
  readSnapshot:async()=>{calls++;return raw()},
  readMatch:async()=>{calls++;return match()}
 })),/TEST新規ゴール/);
 assert.equal(calls,0);
});
