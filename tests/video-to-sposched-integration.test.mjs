// Cross-module integration: video-audio transcript -> confirmed PeakStamp goal ->
// human-reviewed SS TEST operation -> UUID resolver -> explicitly approved send.
// No HTTP calls, tokens, or writes to a live SpoSched organization occur here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  goalSourceKey,createGoalDrafts,saveGoalDrafts,confirmedGoalExport
} from '../goal-stats.mjs';
import {
  normalizeSpoSnapshot,prepareGoalRows,buildReviewPayload
} from '../sposched-review-core.mjs';
import {toStagingAction} from '../sposched-staging-client.mjs';
import {
  TEST_TEAM_ID,selectBatchOperations,previewReviewedBatch,executeReviewedBatch
} from '../sposched-staging-batch.mjs';

const EVENT='5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
const MATCH='4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const SCORER='7c1e2a4b-5d6f-4a8b-9c0d-1e2f3a4b5c6d';
const ASSIST='0a9b8c7d-6e5f-4d3c-2b1a-0f9e8d7c6b5a';
const OTHER='8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e';
const source={file:{name:'SundayMatch_01.MOV',size:582141125,lastModified:1792897200000}};
const memory=()=>({
  cache:new Map(),
  getItem(k){return this.cache.get(k)||null;},
  setItem(k,v){this.cache.set(k,v)}
});
const snapshot=()=>normalizeSpoSnapshot({
  event_id:EVENT,event:'SS TEST',
  matches:[{seq:1,match_id:MATCH,title:'Match #1',left_team:'チーム1',
    right_team:'チーム2',left_score:2,right_score:2,
    goals:[{goal_id:'2ff908ce-70a2-4930-8c2a-e5fce089179b',
      scorer:'橋本',assist:null,team:'チーム2'}]}],
  roster:{'チーム1':['西村','佐藤'],'チーム2':['橋本']}
});
const official=()=>({
  match_id:MATCH,event_id:EVENT,status:'scheduled',
  left:{name:'チーム1',score:2,players:[
    {player_id:SCORER,name:'西村'},{player_id:ASSIST,name:'佐藤'}],helpers:[]},
  right:{name:'チーム2',score:2,players:[{player_id:OTHER,name:'橋本'}],helpers:[]},
  goals:[]
});
function videoTranscript(store){
  store.setItem('peakstamp_callout_pilot_v2:'+goalSourceKey(source)+'::whole',
    JSON.stringify({utterances:[
      {kind:'match_start',time_seconds:5,quote:'チーム1対チーム2',
        match_label:'1対2',team_a:'1',team_b:'2'},
      {kind:'goal_call',time_seconds:110,quote:'佐藤さんアシストで西村さんゴール',
        scorer:'西村さん',assist:'佐藤さん'}
    ]}));
}
function reviewedVideo(){
  const store=memory();videoTranscript(store);
  const draft=createGoalDrafts(source,store).items;
  assert.equal(draft.length,1);
  assert.equal(draft[0].status,'draft');
  const unconfirmed=confirmedGoalExport([source],store);
  assert.equal(unconfirmed.goals.length,0,
    'an audio-detected goal is NOT sent to SS without human confirmation');
  draft[0].status='confirmed';
  draft[0].confirmedAt='2026-10-27T00:00:00.000Z';
  assert.equal(saveGoalDrafts(source,store,draft),true);
  const exported=confirmedGoalExport([source],store);
  assert.equal(exported.goals.length,1);
  assert.equal(exported.goals[0].source.name,source.file.name);
  assert.equal(exported.goals[0].matchLabel,'1対2');
  assert.equal(exported.goals[0].reactionTimeSeconds,110);
  const snap=snapshot();
  const [row]=prepareGoalRows(exported,snap);
  assert.equal(row.seq,1);
  assert.equal(row.scorer,'西村');
  assert.equal(row.assist,'佐藤');
  assert.equal(row.confirmed,false,'AI suggestions are never human approval');
  row.team='チーム1';
  row.assistMode='named';
  row.confirmed=true;
  return {snap,row,exported};
}

test('reviewed video goal retains source/time and maps into strict TEST UUID operation',()=>{
  const {snap,row,exported}=reviewedVideo();
  const payload=buildReviewPayload(snap,[row]);
  assert.equal(payload.status,'human-reviewed-NOT-SENT');
  assert.equal(payload.operations.length,1);
  const op=payload.operations[0];
  assert.equal(op.action,'record_goal');
  assert.equal(op.fromPeakStamp.source,source.file.name);
  assert.equal(op.fromPeakStamp.goalId,exported.goals[0].id);
  assert.equal(op.fromPeakStamp.goalTimeSeconds,exported.goals[0].goalTimeSeconds);
  assert.deepEqual(toStagingAction(snap,op,official()),{
    action:'create',match_id:MATCH,side:'left',
    scorer_id:SCORER,assist_id:ASSIST
  });
});

test('no TEST write before explicit batch approval, with one readback-verified send',async()=>{
  const {snap,row}=reviewedVideo();
  const payload=buildReviewPayload(snap,[row]);
  const selected=selectBatchOperations(payload,[0]);
  let calls=0;
  const resolveAction=async op=>toStagingAction(snap,op,official());
  const previewAction=async action=>({
    environment:'STAGING ONLY',team_id:TEST_TEAM_ID,
    preview_token:'local-fake-signature-not-a-real-token',
    plan:{action:'create',match_id:action.match_id,goal_id:null,
      side:action.side,before:null,after:{scorer:'西村',assist:'佐藤'}}
  });
  const entries=await previewReviewedBatch({selected,resolveAction,previewAction});
  assert.equal(calls,0,'preview must not transmit a goal');
  assert.equal(entries.length,1);
  const completed=await executeReviewedBatch({
    entries,resolveAction,previewAction,
    executeAction:async action=>{
      calls++;
      assert.equal(action.confirm,'TEST-ONLY WRITE');
      assert.equal(action.preview_token,'local-fake-signature-not-a-real-token');
      assert.equal(action.scorer_id,SCORER);
      assert.equal(action.assist_id,ASSIST);
      return {environment:'STAGING ONLY',write_sent:true,
        readback:{verified:true,goal_id:'2ff908ce-70a2-4930-8c2a-e5fce089179b'}};
    }
  });
  assert.equal(calls,1);
  assert.equal(completed.length,1);
});

test('video-derived duplicate is blocked during SS review without a send',()=>{
  const {snap,row}=reviewedVideo();
  snap.matches[0].existingGoals.push({
    id:'2ff908ce-70a2-4930-8c2a-e5fce089179b',
    scorer:'西村',assist:'佐藤',team:'チーム1'
  });
  assert.throws(()=>buildReviewPayload(snap,[row]),/同じ得点者・アシスト/);
});

test('official mismatch and duplicated player identity prevent video-derived writes',()=>{
  const {snap,row}=reviewedVideo();
  const [op]=buildReviewPayload(snap,[row]).operations;
  const mismatched=official();mismatched.event_id='6b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
  assert.throws(()=>toStagingAction(snap,op,mismatched),/一致しません/);
  const duplicateName=official();duplicateName.left.players.push({
    player_id:OTHER,name:'西村'
  });
  assert.throws(()=>toStagingAction(snap,op,duplicateName),/一意/);
});
