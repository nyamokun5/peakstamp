import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {makeManualGoal} from '../sposched-manual-goals.mjs';
import {quickGoalDecisions} from '../sposched-quick-review.mjs';
import {prepareWorkerIndependent} from '../sposched-worker-independent.mjs';
import {summarizeManualFixtureEntry,manualTieKey,manualFinishWinner} from '../sposched-manual-entry.mjs';
const eventId='01234567-89ab-4cde-8abc-0123456789ab';
const req='11234567-89ab-4cde-8abc-0123456789ab';
const mid=n=>'21234567-89ab-4cde-8abc-'+String(n).padStart(12,'0');
const gid=n=>'31234567-89ab-4cde-8abc-'+String(n).padStart(12,'0');
const make=(count=3,changes={})=>normalizeSpoSnapshot({
 event_id:eventId,roster_source:'official-current-event-teams',
 matches:Array.from({length:count},(_,i)=>({
  seq:i+1,match_id:mid(i+1),left_team:'White',right_team:'Red',
  title:'練習試合 #'+(i+1),status:'scheduled',left_score:0,right_score:0,goals:[],
  ...(changes[i+1]||{})
 })),
 roster:{White:['Aki','Sora','Yuki'],Red:['Mika','Nana']}
});
const manual=(snapshot,id,seq,scorer,assist='')=>{
 const [r]=prepareGoalRows({goals:[makeManualGoal(gid(id))]},snapshot);
 return {...r,seq,scorer,team:snapshot.playerTeam.get(scorer)||'',
  assistMode:assist?'named':'none',assist,confirmed:false};
};
const plan=(snap,rows,winners=new Map())=>prepareWorkerIndependent({
 snapshot:snap,rows,decisions:quickGoalDecisions(snap,rows),
 requestId:req,winnerFor:f=>manualFinishWinner(snap.eventId,f,winners)
});

test('mobile manual one-step forms count four goals for three separate official matches automatically',()=>{
 const snap=make();
 const rows=[manual(snap,1,1,'Aki','Sora'),manual(snap,2,1,'Mika'),
  manual(snap,3,2,'Nana'),manual(snap,4,3,'Yuki')];
 const summary=summarizeManualFixtureEntry(snap,rows,quickGoalDecisions(snap,rows));
 assert.equal(summary.manualCount,4);
 assert.equal(summary.acceptedCount,4);
 assert.deepEqual(summary.issues,[]);
 assert.deepEqual(summary.fixtures.map(x=>[x.left,x.right]),[[1,1],[0,1],[1,0]]);
 assert.deepEqual(summary.fixtures.map(x=>x.goals.length),[2,1,1]);
 const winner=new Map([[manualTieKey(eventId,summary.fixtures[0]),'draw']]);
 const p=plan(snap,rows,winner);
 assert.equal(p.operations.filter(x=>x.action==='create').length,4);
 assert.deepEqual(p.operations.filter(x=>x.action==='finish').map(x=>[x.seq,x.winner]),[
  [1,'draw'],[2,'auto'],[3,'auto']
 ]);
 assert.deepEqual(p.operations.filter(x=>x.action==='create').map(x=>x.expected_match_id),
  [mid(1),mid(1),mid(2),mid(3)]);
});

test('a tied 1-1 score selects draw automatically and explicit left PK win is sent in the single initial plan',()=>{
 const snap=make(2),rows=[manual(snap,1,1,'Aki'),manual(snap,2,1,'Mika')];
 const s=summarizeManualFixtureEntry(snap,rows,quickGoalDecisions(snap,rows));
 assert.deepEqual(s.fixtures.map(x=>[x.left,x.right]),[[1,1],[0,0]]);
 assert.deepEqual(plan(snap,rows).operations.filter(x=>x.action==='finish').map(x=>x.winner),
  ['draw','draw']);
 const choice=new Map([[manualTieKey(eventId,s.fixtures[0]),'left']]);
 assert.deepEqual(plan(snap,rows,choice).operations.filter(x=>x.action==='finish').map(x=>x.winner),
  ['left','draw']);
 // A rescheduled match UUID or changed projected score never inherits PK winner.
 const fresh=make(2,{1:{match_id:mid(41)}});
 assert.equal(manualFinishWinner(eventId,{...s.fixtures[0],matchId:mid(41)},choice),'draw');
 assert.equal(manualFinishWinner(eventId,{...s.fixtures[0],left:2},choice),'auto');
 assert.equal(manualFinishWinner(eventId,s.fixtures[0],choice),'left');
});

test('a second manual goal is accepted without per-goal check; invalid or duplicate drafts stay blocked at final review',()=>{
 const snap=make(2),a=manual(snap,1,1,'Aki'),b=manual(snap,2,1,'Sora');
 assert.equal(a.confirmed,false);
 assert.equal(plan(snap,[a,b]).operations.filter(x=>x.action==='create').length,2);
 for(const mutation of [
  {...b,scorer:'',team:''},{...b,seq:null},
  {...b,assistMode:'unknown'}, {...b,team:'Red'},
  {...b,assistMode:'named',assist:'Aki',team:'White',scorer:'Aki'},
  {...b,guest:true}, {...b,fixtureIdentityChanged:true},
  {...b,goal:{...b.goal,sent:true,manual:true}}
 ]){
  const summary=summarizeManualFixtureEntry(snap,[a,mutation],quickGoalDecisions(snap,[a,mutation]));
  assert.ok(summary.issues.length||mutation.goal.sent===true,
   'invalid manual row must not become valid with no per-row checkbox');
  assert.throws(()=>plan(snap,[a,mutation]),undefined);
 }
 const duplicate=manual(snap,3,1,'Aki');
 assert.equal(summarizeManualFixtureEntry(snap,[a,duplicate]).issues.length,1);
 assert.throws(()=>plan(snap,[a,duplicate]),/重複/);
});

test('new goal scores never mutate existing official scores, finished games or production',()=>{
 const s=make(2),before=JSON.stringify(s.matches);
 const row=manual(s,1,2,'Mika');
 const summary=summarizeManualFixtureEntry(s,[row],quickGoalDecisions(s,[row]));
 assert.deepEqual(summary.fixtures.map(x=>[x.left,x.right]),[[0,0],[0,1]]);
 assert.equal(JSON.stringify(s.matches),before,'preview is pure; no score writes');
 assert.throws(()=>plan(make(2,{1:{status:'finished'}}),[row]),/終了済み/);
 assert.throws(()=>plan({...s,rosterSource:'unverified-refresh-failed'},[row]),
  /現在のチーム名簿/);
});
