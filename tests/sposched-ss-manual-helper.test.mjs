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
test('cross-team assist is automatically excluded and cannot silently finalize an unregistered SS goal',()=>{
 const snapshot=fresh(false),rows=review(snapshot),row=rows[0],decisions=quickGoalDecisions(snapshot,rows);
 assert.equal(row.include,true,'original candidate stays visible for corrections');
 assert.equal(decisions[0].state,'manual-ss');
 assert.equal(decisions[0].registeredInSS,false);
 assert.match(decisions[0].reason,/SSのこの試合.*直接記録/);
 assert.equal(ssManualHelperGoal(snapshot,row).mismatches[0].person,'橋本 泰成');
 assert.equal(snapshot.playerTeam.get('橋本 泰成'),'チーム1',
  'SS roster home team is never changed');
 assert.throws(()=>plan(snapshot,rows,decisions),/SSで直接登録後/);
 assert.throws(()=>plan(snapshot,rows,[{...decisions[0],registeredInSS:true}]),/登録状態が変わりました/);
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
 assert.throws(()=>plan(snapshot,rows,quickGoalDecisions(snapshot,rows)),/候補を確認/);
});
test('nonexistent fixture and inconsistent scorer team are not silently marked helper for wrong event',()=>{
 const snapshot=fresh(false),rows=review(snapshot);
 rows[0].seq=10;
 assert.equal(ssManualHelperGoal(snapshot,rows[0]),null);
 assert.throws(()=>plan(snapshot,rows,quickGoalDecisions(snapshot,rows)),/試合番号/);
});
test('UI highlights the SS manual-only exclusion and blocks finalizing until official readback',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/SSで手動登録（自動送信しません）/);
 assert.match(html,/SSでこのイベントを開いて登録する/);
 assert.match(html,/SSで手動登録後に最新情報を再取得/);
 assert.match(html,/manualPending\.length/);
 assert.match(html,/未登録のまま試合は終了しません/);
});
