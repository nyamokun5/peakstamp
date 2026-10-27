import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toStagingAction,writeableReviewOperations,assertCurrentNumberedFixture} from '../sposched-staging-client.mjs';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
const eventId='5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
const matchId='4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const goalId='2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b';
const a='7c1e2a4b-5d6f-4a8b-9c0d-1e2f3a4b5c6d';
const b='0a9b8c7d-6e5f-4d3c-2b1a-0f9e8d7c6b5a';
const c='8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e';
const snapshot={eventId};
const match=()=>({event_id:eventId,match_id:matchId,status:'scheduled',
 left:{name:'チーム1',players:[{player_id:a,name:'テスト 太郎'},{player_id:b,name:'テスト 花子'}],helpers:[]},
 right:{name:'チーム2',players:[{player_id:c,name:'テスト 次郎'}],helpers:[]},
 goals:[{goal_id:goalId,side:'left',scorer:{player_id:a,name:'テスト 太郎'},
 assist:{player_id:b,name:'テスト 花子'},own_goal:false,scored_at:'2026-10-26T20:00:00+08:00'}]});
test('create maps team and confirmed exact player names to UUIDs',()=>{
 const op={action:'record_goal',args:{event_id:eventId,seq:1,team:'チーム1',scorer:'テスト 太郎',assist:'テスト 花子'}};
 assert.deepEqual(toStagingAction(snapshot,op,match()),{
  action:'create',match_id:matchId,side:'left',scorer_id:a,assist_id:b});
});
test('create uses other side when explicitly selected',()=>{
 const op={action:'record_goal',args:{team:'チーム2',scorer:'テスト 次郎'}};
 assert.deepEqual(toStagingAction(snapshot,op,match()),{
  action:'create',match_id:matchId,side:'right',scorer_id:c,assist_id:null});
});
test('name ambiguities, guests, missing roster entries, own-team assists and mismatched teams fail closed',()=>{
 const base={action:'record_goal',args:{team:'チーム1',scorer:'テスト 太郎',assist:'テスト 花子'}};
 const m=match();m.left.players.push({player_id:c,name:'テスト 太郎'});
 assert.throws(()=>toStagingAction(snapshot,base,m),/一意/);
 assert.throws(()=>toStagingAction(snapshot,{...base,args:{...base.args,guest:true}},match()),/対象外/);
 assert.throws(()=>toStagingAction(snapshot,{...base,args:{...base.args,assist:'テスト 次郎'}},match()),/一意/);
 assert.throws(()=>toStagingAction(snapshot,{...base,args:{...base.args,team:'関係ないチーム'}},match()),/得点チーム/);
 assert.throws(()=>toStagingAction(snapshot,{...base,args:{...base.args,scorer:'テストタロウ'}},match()),/一意/);
});
test('does not accept a match from another event or mismatched official match id',()=>{
 const op={action:'record_goal',args:{team:'チーム1',scorer:'テスト 太郎',match_id:matchId}};
 const wrong=match();wrong.event_id='6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f';
 assert.throws(()=>toStagingAction(snapshot,op,wrong),/一致しません/);
 assert.throws(()=>toStagingAction(snapshot,{...op,args:{...op.args,match_id:goalId}},match()),/一致しません/);
});
test('PATCH retains original side and maps new scorer and assist to strict IDs',()=>{
 const op={action:'patch_goal',args:{match_id:matchId,goal_id:goalId,patch:{assist:null}},
  expected:{team:'チーム1',scorer:'テスト 太郎',assist:'テスト 花子',own_goal:false}};
 assert.deepEqual(toStagingAction(snapshot,op,match()),{
  action:'patch',match_id:matchId,goal_id:goalId,scorer_id:a,assist_id:null});
});
test('PATCH rejects changed original goal, wrong scorer, no-op and own goals',()=>{
 const op={action:'patch_goal',args:{match_id:matchId,goal_id:goalId,patch:{assist:null}},
  expected:{team:'チーム1',scorer:'テスト 太郎',assist:'テスト 花子',own_goal:false}};
 const modified=match();modified.goals[0].assist=null;
 assert.throws(()=>toStagingAction(snapshot,op,modified),/変わっています/);
 const noOp={...op,args:{...op.args,patch:{assist:{name:'テスト 花子'}}}};
 assert.throws(()=>toStagingAction(snapshot,noOp,match()),/同一です/);
 const own=match();own.goals[0].own_goal=true;
 assert.throws(()=>toStagingAction(snapshot,op,own),/対象外/);
 const outsider={...op,args:{...op.args,patch:{scorer:{name:'テスト 次郎'}}}};
 assert.throws(()=>toStagingAction(snapshot,outsider,match()),/一意/);
});
test('review list explicitly disables score result writes and unrelated operations',()=>{
 const ops={operations:[{action:'record_goal',args:{seq:1,scorer:'テスト 太郎'}},
 {action:'record_match',args:{seq:1}},{action:'patch_goal',args:{seq:2}}]};
 const shown=writeableReviewOperations(ops);
 assert.deepEqual(shown.map(x=>x.enabled),[true,false,true]);
 assert.throws(()=>toStagingAction(snapshot,ops.operations[1],match()),/行いません/);
});

test('official final fixture number must match PS-assigned seq before a TEST write',()=>{
 const op={action:'record_goal',args:{
  event_id:eventId,seq:6,team:'チーム1',scorer:'テスト 太郎'}};
 const correct=match();correct.number=6;correct.title='決勝戦';
 assert.equal(toStagingAction(snapshot,op,correct).match_id,matchId);
 const swapped=match();swapped.number=5;swapped.title='3位決定戦';
 assert.throws(()=>toStagingAction(snapshot,op,swapped),/試合番号/);
 const waiting=match();waiting.number=6;waiting.status='waiting';
 waiting.left.name='';waiting.right.name='';
 assert.throws(()=>toStagingAction(snapshot,op,waiting),/対戦相手/);
});

test('reject any official number or seq disagreement before TEST mutation',()=>{
 const draft={action:'record_goal',args:{
  event_id:eventId,seq:6,team:'チーム1',scorer:'テスト 太郎'}};
 const bySeq=match();bySeq.seq=6;
 assert.equal(toStagingAction(snapshot,draft,bySeq).match_id,matchId);
 const both=match();both.number=6;both.seq=6;
 assert.equal(toStagingAction(snapshot,draft,both).match_id,matchId);
 const badSeq=match();badSeq.seq=5;
 assert.throws(()=>toStagingAction(snapshot,draft,badSeq),/試合番号/);
 const conflicting=match();conflicting.number=6;conflicting.seq=5;
 assert.throws(()=>toStagingAction(snapshot,draft,conflicting),/試合番号/);
 const malformed=match();malformed.number='6';
 assert.throws(()=>toStagingAction(snapshot,draft,malformed),/試合番号/);
});

test('fresh event-wide seq to UUID mapping is verified before TEST preview and each write',()=>{
 const make=(fixtures,event=eventId)=>normalizeSpoSnapshot({
  event_id:event,
  matches:fixtures.map(([seq,id,left,right,status])=>({
   seq,match_id:id,left_team:left,right_team:right,status:status||'scheduled'
  }))
 });
 const loaded=make([[3,goalId,'Team2','Team3'],[4,matchId,'Team1','Team4']]);
 const fresh=make([[3,goalId,'チーム2','チーム3'],[4,matchId,'チーム1','チーム4']]);
 assert.equal(assertCurrentNumberedFixture(loaded,fresh,3),goalId);
 assert.equal(assertCurrentNumberedFixture(loaded,fresh,4),matchId);
 const swapped=make([[3,matchId,'Team2','Team3'],[4,goalId,'Team1','Team4']]);
 assert.throws(()=>assertCurrentNumberedFixture(loaded,swapped,4),/match_id/);
 const altered=make([[3,goalId,'Team2','Team3'],[4,matchId,'Team2','Team4']]);
 assert.throws(()=>assertCurrentNumberedFixture(loaded,altered,4),/対戦チーム/);
 const waiting=make([[3,goalId,'Team2','Team3'],[4,matchId,'','','waiting']]);
 assert.throws(()=>assertCurrentNumberedFixture(loaded,waiting,4),/確定待ち/);
 assert.throws(()=>assertCurrentNumberedFixture(loaded,make([[3,goalId,'Team2','Team3']]),4),/削除・変更/);
 assert.throws(()=>assertCurrentNumberedFixture(loaded,make([[3,goalId,'Team2','Team3'],[4,matchId,'Team1','Team4']],goalId),4),/イベントID/);
});
test('staging goal preview fetches newest event-wide SS match map before single-match lookup',()=>{
 const html=readFileSync(
  new URL('../sposched-review.html',import.meta.url),'utf8');
 const resolver=html.slice(html.indexOf('function resolveReviewedAction(operation){'),
  html.indexOf("$('batchApprove').addEventListener"));
 assert.match(resolver,/const latest=normalizeSpoSnapshot\(await fetchSS\(/);
 assert.match(resolver,/\/snapshot\?event_id=/);
 assert.match(resolver,/assertCurrentNumberedFixture\(snapshot,latest,seq\)/);
 assert.ok(resolver.indexOf('assertCurrentNumberedFixture')<resolver.indexOf("'/match?match_id="));
 assert.match(html,/assertCurrentNumberedFixture.*from '\.\/sposched-staging-client\.mjs/);
});
