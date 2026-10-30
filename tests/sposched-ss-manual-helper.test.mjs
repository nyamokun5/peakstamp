import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {quickGoalDecisions,ssManualHelperGoal,editQuickGoalField} from '../sposched-quick-review.mjs';
import {prepareWorkerTournament} from '../sposched-worker-batch.mjs';

const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDS=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const source={name:'IMG_0287.MOV'};
const fresh=registered=>normalizeSpoSnapshot({event_id:E,
 roster:{'チーム1':['橋本 泰成'],'チーム2':['山田'],
  'チーム3':['Hiroyuki Kawata','川田二郎'],'チーム4':['田中']},
 matches:IDS.map((id,i)=>({seq:i+1,match_id:id,status:i<2?'scheduled':'waiting',
  title:'試合 #'+(i+1),
  left_team:i===1?'チーム3':i===0?'チーム1':'',
  right_team:i===1?'チーム4':i===0?'チーム2':'',
  left_score:0,right_score:0,
  goals:i===1&&registered?[{goal_id:'55555555-5555-4555-8555-555555555555',
   scorer:'Hiroyuki Kawata',assist:'橋本 泰成',side:'left',team:'チーム3'}]:[]
 }))});
const review=s=>{
 const rows=prepareGoalRows({goals:[{id:'g1',source,scorer:'Hiroyuki Kawata',
  assist:'橋本 泰成',assistStatus:'named',matchSeq:2,
  matchLabel:'チーム3 vs チーム4'}]},s);
 assert.equal(rows[0].team,'チーム3');
 assert.equal(rows[0].assist,'橋本 泰成');
 return rows;
};
const plan=(snapshot,rows,decisions)=>prepareWorkerTournament({
 snapshot,rows,decisions,requestId:'77777777-7777-4777-8777-777777777777'
});
test('cross-team ASSIST is automatically enrolled before goal, preserving official assist ID and result',()=>{
 const snapshot=fresh(false),rows=review(snapshot),row=rows[0],decisions=quickGoalDecisions(snapshot,rows);
 assert.equal(row.include,true,'source goal stays visible and retains its assist');
 assert.equal(row.assist,'橋本 泰成');
 assert.equal(row.assistMode,'named');
 assert.equal(decisions[0].state,'ready');
 assert.equal(decisions[0].helperPlan.helpers[0].name,'橋本 泰成');
 assert.equal(snapshot.playerTeam.get('橋本 泰成'),'チーム1',
  'event roster home team must never change');
 const job=plan(snapshot,rows,decisions);
 assert.deepEqual(job.operations.map(op=>[op.action,op.seq]),[
  ['finish',1],['helper',2],['create',2],['finish',2],['finish',3],['finish',4]
 ]);
 assert.deepEqual(job.operations.find(op=>op.action==='create'),
  {seq:2,action:'create',team:'チーム3',scorer:'Hiroyuki Kawata',
   assist:'橋本 泰成',expected_match_id:IDS[1]});
 assert.throws(()=>plan(snapshot,rows,[{...decisions[0],helperPlan:null}]),
  /助っ人の登録計画/);
});
test('officially read-back manually entered helper goal is excluded from the Worker job',()=>{
 const snapshot=fresh(true),rows=review(snapshot),decisions=quickGoalDecisions(snapshot,rows);
 assert.equal(decisions[0].state,'manual-ss');
 assert.equal(decisions[0].registeredInSS,true);
 const job=plan(snapshot,rows,decisions);
 assert.deepEqual(job.operations.map(op=>[op.action,op.seq]),
  [['finish',1],['finish',2],['finish',3],['finish',4]]);
 assert.equal(job.operations.some(op=>op.action==='create'),false);
});
test('AI correction to an actually same-team assist returns goal to automatic registration',()=>{
 const snapshot=fresh(false),rows=review(snapshot),row=rows[0];
 editQuickGoalField(snapshot,row,'assist','川田二郎');
 assert.equal(ssManualHelperGoal(snapshot,row),null);
 const decisions=quickGoalDecisions(snapshot,rows);
 assert.equal(decisions[0].state,'ready');
 const job=plan(snapshot,rows,decisions);
 const goal=job.operations.find(op=>op.action==='create');
 assert.equal(goal.assist,'川田二郎');
 assert.equal(goal.team,'チーム3');
});
test('uncertain AI evidence stays in correction, never silently excluded as a helper',()=>{
 const snapshot=fresh(false),rows=review(snapshot);
 rows[0].assistGuess.confidence='low';
 assert.equal(ssManualHelperGoal(snapshot,rows[0]),null);
 assert.equal(quickGoalDecisions(snapshot,rows)[0].state,'attention');
 assert.throws(()=>plan(snapshot,rows,quickGoalDecisions(snapshot,rows)),/候補を確認|アシスト者と得点チーム/);
});
test('nonexistent fixture and inconsistent scorer team are not silently marked helper for wrong event',()=>{
 const snapshot=fresh(false),rows=review(snapshot);
 rows[0].seq=10;
 assert.equal(ssManualHelperGoal(snapshot,rows[0]),null);
 assert.throws(()=>plan(snapshot,rows,quickGoalDecisions(snapshot,rows)),/試合番号/);
});
test('UI highlights the SS manual-only exclusion and blocks finalizing until official readback',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/SSアプリで手動登録してください/);
 assert.match(html,/SSでこのイベントを開いて登録する/);
 assert.match(html,/SSで手動登録後に最新情報を再取得/);
 assert.match(html,/manualPending\.length/);
 assert.match(html,/未登録のまま試合は終了しません/);
 assert.match(html,/アシスト要追記/);
 assert.match(html,/Workerがその試合の助っ人として登録/);
});

test('scorer from outside both fixture teams is SS-manual even when scoring side cannot be guessed',()=>{
 const snapshot=fresh(false);
 const rows=prepareGoalRows({goals:[{id:'scorer-helper',source,
  scorer:'橋本 泰成',assistStatus:'none',matchSeq:2,matchLabel:'チーム3 vs チーム4'}]},snapshot);
 assert.equal(rows[0].team,'','no scoring side may be guessed from a helper home team');
 const manual=ssManualHelperGoal(snapshot,rows[0]);
 assert.equal(manual.team,'','manual SS entry must choose the scoring side');
 assert.equal(manual.mismatches[0].role,'得点者');
 assert.equal(quickGoalDecisions(snapshot,rows)[0].state,'manual-ss');
 assert.throws(()=>plan(snapshot,rows,quickGoalDecisions(snapshot,rows)),/SSで直接登録後/);
 const official=fresh(false);
 official.matches[1].existingGoals=[{id:'77777777-7777-4777-8777-777777777777',
  scorer:'橋本 泰成',assist:'',team:'チーム3',ownGoal:false}];
 const after=prepareGoalRows({goals:[{id:'scorer-helper',source,
  scorer:'橋本 泰成',assistStatus:'none',matchSeq:2,matchLabel:'チーム3 vs チーム4'}]},official);
 assert.equal(ssManualHelperGoal(official,after[0]).registered,true);
 assert.equal(plan(official,after,quickGoalDecisions(official,after)).operations.filter(x=>x.action==='create').length,0);
});

test('official existing helper-assisted goal and repeated helper-assisted drafts remain protected from duplicates',()=>{
 const snapshot=fresh(false),rows=review(snapshot);
 snapshot.matches[1].existingGoals=[{scorer:'Hiroyuki Kawata',assist:'橋本 泰成',team:'チーム3'}];
 assert.equal(quickGoalDecisions(snapshot,rows)[0].state,'manual-ss',
  'an already registered helper-assisted goal is explicitly excluded from any new write');
 assert.equal(quickGoalDecisions(snapshot,rows)[0].registeredInSS,true);
 snapshot.matches[1].existingGoals=[];
 const two=prepareGoalRows({goals:[
  {id:'repeat-helper-a',source,scorer:'Hiroyuki Kawata',assist:'橋本 泰成',assistStatus:'named',matchSeq:2,matchLabel:'チーム3 vs チーム4'},
  {id:'repeat-helper-b',source,scorer:'Hiroyuki Kawata',assist:'橋本 泰成',assistStatus:'named',matchSeq:2,matchLabel:'チーム3 vs チーム4'}
 ]},snapshot);
 const decisions=quickGoalDecisions(snapshot,two);
 assert.deepEqual(decisions.map(d=>d.state),['attention','attention'],
  'duplicate planned scorer and assistant cannot be sent twice');
 assert.throws(()=>plan(snapshot,two,decisions),/一括候補内に同一|個別確認/);
});
