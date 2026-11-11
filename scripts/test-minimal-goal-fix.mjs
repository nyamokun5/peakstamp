import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMinimalGoalOperation} from '../sposched-simple-goal-fix.mjs';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';

const E='11111111-1111-4111-8111-111111111111';
const M='22222222-2222-4222-8222-222222222222';
const G='33333333-3333-4333-8333-333333333333';
const m=(left=0,right=0,winner='left',goals=[])=>({
 number:2,match_id:M,left_team:'チーム3',right_team:'チーム4',
 status:'finished',left_score:left,right_score:right,winner,goals
});
const snapshot=(match=m())=>normalizeSpoSnapshot({
 event_id:E,roster_source:'official-current-event-teams',
 matches:[match],roster:{チーム3:['芦川','達夫'],チーム4:['田中']},
 roster_players:[
  {name:'芦川',team:'チーム3',player_id:'44444444-4444-4444-8444-444444444444'},
  {name:'達夫',team:'チーム3',player_id:'55555555-5555-4555-8555-555555555555'},
  {name:'田中',team:'チーム4',player_id:'66666666-6666-4666-8666-666666666666'}
 ]
});
const op=({snap=snapshot(),scorer='芦川',assist='達夫',goalId='',row=null}={})=>
 makeMinimalGoalOperation({snapshot:snap,seq:2,scorer,assist,goalId,row});

test('minimal TEST correction adds one real team3 goal to 0-0 finished match with team3 as winner',()=>{
 const result=op();
 assert.equal(result.action,'record_goal');
 assert.deepEqual(result.args,{event_id:E,seq:2,scorer:'芦川',team:'チーム3',assist:'達夫'});
 assert.equal(result.fromPeakStamp.goalId,'goal-fix');
});
test('cannot add to a finished match when the addition contradicts the official winner',()=>{
 assert.throws(()=>op({scorer:'田中',assist:''}),/勝敗が変わります/);
});
test('finished match must have verified winner; no guessing a shootout result from 0-0',()=>{
 assert.throws(()=>op({snap:snapshot(m(0,0,null))}),/勝者を検証できません/);
});
test('cannot use roster from a different event or wrong team',()=>{
 const s=snapshot();s.rosterSource='event-embedded-fallback';
 assert.throws(()=>op({snap:s}),/公式名簿/);
 assert.throws(()=>op({scorer:'未知の選手'}),/現在の試合名簿/);
 assert.throws(()=>op({scorer:'芦川',assist:'田中'}),/得点側/);
 assert.throws(()=>op({scorer:'芦川',assist:'芦川'}),/得点側/);
});
test('same scorer and assist can only be changed via exact existing goal ID',()=>{
 const existing={goal_id:G,scorer:'芦川',assist:'達夫',team:'チーム3',own_goal:false};
 const s=snapshot(m(1,0,'left',[existing]));
 assert.throws(()=>op({snap:s}),/登録済み/);
 const patch=op({snap:s,scorer:'芦川',assist:'',goalId:G});
 assert.equal(patch.action,'patch_goal');
 assert.deepEqual(patch.args.patch,{assist:null});
 assert.equal(patch.args.goal_id,G);
 assert.throws(()=>op({snap:s,goalId:G}),/同じ内容/);
});
test('changing the scoring side cannot be disguised as a patch',()=>{
 const s=snapshot(m(0,1,'right',[{goal_id:G,scorer:'田中',assist:null,team:'チーム4'}]));
 assert.throws(()=>op({snap:s,goalId:G}),/得点チームの変更/);
});
test('reject waiting/scheduled fixtures and erroneous match identities before any write',()=>{
 const scheduled=snapshot({...m(),status:'scheduled'});
 assert.throws(()=>op({snap:scheduled}),/終了済み試合/);
 const waiting=snapshot({...m(),status:'waiting'});
 assert.throws(()=>op({snap:waiting}),/終了済み試合/);
 const wrong=snapshot({...m(),match_id:'bogus'});
 assert.throws(()=>op({snap:wrong}),/終了済み試合/);
});
