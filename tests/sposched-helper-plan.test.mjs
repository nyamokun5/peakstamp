import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {proposedMatchHelpers,waitingHelperScoringSideIssue} from '../sposched-helper-plan.mjs';
import {quickGoalDecisions,editQuickGoalField} from '../sposched-quick-review.mjs';
import {prepareWorkerTournament} from '../sposched-worker-batch.mjs';
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ids=[1,2,3,4].map(n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`);
const snap=()=>normalizeSpoSnapshot({event_id:E,roster:{
 チーム1:['橋本 泰成','T1'],チーム2:['T2'],
 チーム3:['Hiroyuki Kawata','T3'],チーム4:['T4']
},matches:ids.map((match_id,i)=>({
 seq:i+1,match_id,title:i<2?'準決勝':i===2?'3位決定戦':'決勝',
 status:i<2?'scheduled':'waiting',
 left_team:i===0?'チーム1':i===1?'チーム3':'',
 right_team:i===0?'チーム2':i===1?'チーム4':'',
 left_score:0,right_score:0,goals:[]
}))});
const video=(id,seq,scorer,assist)=>({id,source:{name:'IMG_0287.MOV'},
 matchSeq:seq,scorer,assist:assist||null,assistStatus:assist?'named':'none'});
const job=(snapshot,rows,decisions)=>prepareWorkerTournament({
 snapshot,rows,decisions,requestId:R
});
test('cross-team assistant joins official team BEFORE goal; no assist is dropped',()=>{
 const s=snap(),rows=prepareGoalRows({goals:[video('g2',2,'Hiroyuki Kawata','橋本 泰成')]},s);
 assert.equal(rows[0].team,'チーム3');
 const decisions=quickGoalDecisions(s,rows);
 assert.equal(decisions[0].state,'ready');
 assert.deepEqual(decisions[0].helperPlan?.helpers.map(h=>h.name),['橋本 泰成']);
 const ops=job(s,rows,decisions).operations;
 assert.deepEqual(ops.map(o=>[o.seq,o.action]),[
  [1,'finish'],[2,'helper'],[2,'create'],[2,'finish'],[3,'finish'],[4,'finish']
 ]);
 assert.deepEqual(ops[1],{seq:2,action:'helper',team:'チーム3',
  name:'橋本 泰成',expected_match_id:ids[1]});
 assert.equal(ops[2].assist,'橋本 泰成');
 assert.equal(ops[2].scorer,'Hiroyuki Kawata');
 assert.equal(ops[2].team,'チーム3');
});
test('cross-team scorer requires explicit scoring team; only then inserts helper before goal',()=>{
 const s=snap(),rows=prepareGoalRows({goals:[video('g2',2,'橋本 泰成',null)]},s);
 assert.equal(rows[0].team,'');
 assert.equal(proposedMatchHelpers(s,rows[0]),null);
 editQuickGoalField(s,rows[0],'team','チーム3');
 const decisions=quickGoalDecisions(s,rows);
 assert.equal(decisions[0].state,'ready');
 assert.equal(decisions[0].helperPlan.helpers[0].name,'橋本 泰成');
 const ops=job(s,rows,decisions).operations;
 assert.deepEqual(ops.slice(1,3).map(x=>x.action),['helper','create']);
 assert.equal(ops[2].scorer,'橋本 泰成');
});
test('third-place helper registration is queued AFTER both semifinal finish steps',()=>{
 const s=snap(),rows=prepareGoalRows({goals:[video('third',3,'T2','橋本 泰成')]},s);
 const decisions=quickGoalDecisions(s,rows);
 assert.equal(decisions[0].state,'waiting');
 assert.equal(decisions[0].helperPlan?.team,'チーム2');
 const ops=job(s,rows,decisions).operations;
 assert.deepEqual(ops.map(o=>[o.seq,o.action]),[
  [1,'finish'],[2,'finish'],[3,'helper'],[3,'create'],[3,'finish'],[4,'finish']
 ]);
 assert.equal(ops[2].expected_match_id,ids[2]);
 assert.equal(ops[3].assist,'橋本 泰成');
});
test('the same temporary helper on two goals is registered only once',()=>{
 const s=snap(),rows=prepareGoalRows({goals:[
  video('a',2,'Hiroyuki Kawata','橋本 泰成'),
  video('b',2,'T3','橋本 泰成')
 ]},s);
 const ops=job(s,rows,quickGoalDecisions(s,rows)).operations;
 assert.equal(ops.filter(o=>o.action==='helper').length,1);
 assert.equal(ops.filter(o=>o.action==='create').length,2);
});
test('unverified client helper plan is rejected before anything can be submitted',()=>{
 const s=snap(),rows=prepareGoalRows({goals:[video('a',2,'Hiroyuki Kawata','橋本 泰成')]},s);
 const decisions=quickGoalDecisions(s,rows);
 assert.throws(()=>job(s,rows,[{...decisions[0],helperPlan:null}]),/助っ人の登録計画/);
 rows[0].scorerGuess.confidence='low';
 assert.equal(proposedMatchHelpers(s,rows[0]),null);
});
test('iPhone UI keeps a single TEST batch click and clearly shows helper enrollment',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/SS助っ人登録予定/);
 assert.match(html,/準決勝終了後の正式な対戦確認が条件/);
 assert.match(html,/helperEnrollment>0/);
 assert.match(html,/Workerがその試合の助っ人として登録/);
});

test('third-place video pair excludes scorer home team: require ONE scoring-team selection before any helper write',()=>{
 const snapshot=snap(),goal=video('third-helper-scorer',3,'橋本 泰成',null);
 goal.teamA='チーム2';goal.teamB='チーム3';goal.matchLabel='チーム2 vs チーム3';
 const rows=prepareGoalRows({goals:[goal]},snapshot);
 assert.equal(rows[0].team,'');
 assert.match(waitingHelperScoringSideIssue(snapshot,rows[0]),/実際に得点したチームを選んでください/);
 assert.equal(proposedMatchHelpers(snapshot,rows[0]),null);
 const undecided=quickGoalDecisions(snapshot,rows)[0];
 assert.equal(undecided.state,'attention');
 assert.match(undecided.reason,/助っ人得点/);
 assert.throws(()=>job(snapshot,rows,[undecided]),/得点したチーム/);
 assert.throws(()=>editQuickGoalField(snapshot,rows[0],'team','チーム9'),/名簿/);
 editQuickGoalField(snapshot,rows[0],'team','チーム2');
 assert.equal(waitingHelperScoringSideIssue(snapshot,rows[0]),null);
 const decided=quickGoalDecisions(snapshot,rows);
 assert.equal(decided[0].state,'waiting');
 assert.deepEqual(decided[0].helperPlan?.helpers.map(h=>h.name),['橋本 泰成']);
 const operations=job(snapshot,rows,decided).operations;
 assert.deepEqual(operations.map(op=>[op.seq,op.action]),[
  [1,'finish'],[2,'finish'],[3,'helper'],[3,'create'],[3,'finish'],[4,'finish']
 ]);
 assert.equal(operations[2].team,'チーム2');
 assert.equal(operations[3].team,'チーム2');
 assert.equal(operations[3].scorer,'橋本 泰成');
});
test('waiting knockout scorer who belongs to stated video pair requires NO extra side decision',()=>{
 const snapshot=snap(),goal=video('third-usual',3,'T2',null);
 goal.matchLabel='チーム2 vs チーム3';
 const rows=prepareGoalRows({goals:[goal]},snapshot);
 assert.equal(waitingHelperScoringSideIssue(snapshot,rows[0]),null);
 assert.equal(quickGoalDecisions(snapshot,rows)[0].state,'waiting');
 assert.equal(job(snapshot,rows,quickGoalDecisions(snapshot,rows)).operations.some(
  o=>o.action==='helper'),false);
});
