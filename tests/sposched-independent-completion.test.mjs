import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCompletedIndependentSnapshot,hasRecreatedIndependentFixtures} from '../sposched-independent-completion.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const id=n=>'11111111-2222-4111-8111-11111111111'+n;
const snapshot=(n,status)=>({eventId:E,matches:Array.from({length:n},(_,i)=>({seq:i+1,matchId:id(i+1),status}))});
test('completed independent jobs require exact official finished fixture IDs',()=>{
 for(const n of [1,3,4]){
  const job={event_id:E,status:'completed',layout_mode:'independent-fixtures-v1',
   fixture_count:n,fixture_ids:Object.fromEntries(Array.from({length:n},(_,i)=>[i+1,id(i+1)]))};
  assert.equal(verifyCompletedIndependentSnapshot(job,snapshot(n,'finished'),snapshot(n,'scheduled')),true);
  const changed=snapshot(n,'finished');changed.matches[0].matchId=id(9);
  assert.throws(()=>verifyCompletedIndependentSnapshot(job,changed,snapshot(n,'scheduled')),/正式ID/);
  assert.throws(()=>verifyCompletedIndependentSnapshot(job,snapshot(n,'scheduled'),snapshot(n,'scheduled')),/終了状態/);
 }
});

test('independent recreation requires a completed old generation and entirely new official IDs',()=>{
 for(const count of [1,2,3]){
  const old=snapshot(count,'finished');
  const job={event_id:E,status:'completed',layout_mode:'independent-fixtures-v1',
   fixture_count:count,fixture_ids:Object.fromEntries(old.matches.map(m=>[m.seq,m.matchId]))};
  const current={eventId:E,matches:old.matches.map(m=>({...m,matchId:id(m.seq+5),status:'scheduled'}))};
  assert.equal(hasRecreatedIndependentFixtures(job,current),true);
  assert.equal(hasRecreatedIndependentFixtures({...job,status:'running'},current),false);
  assert.equal(hasRecreatedIndependentFixtures(job,{...current,eventId:id(9)}),false);
  assert.equal(hasRecreatedIndependentFixtures(job,{...current,matches:current.matches.slice(1)}),false);
  assert.equal(hasRecreatedIndependentFixtures(job,{...current,matches:current.matches.map((m,i)=>i?m:{...m,matchId:old.matches[0].matchId})}),false);
  assert.equal(hasRecreatedIndependentFixtures(job,{...current,matches:current.matches.map((m,i)=>i?m:{...m,status:'finished'})}),false);
 }
});

const completedJob=()=>({event_id:E,status:'completed',layout_mode:'independent-fixtures-v1',
 fixture_count:2,fixture_ids:{1:id(1),2:id(2)}});
test('stable replacement fixtures identify a saved-job mismatch without claiming completion',()=>{
 const job=completedJob(),current=snapshot(2,'finished');
 current.matches[0].matchId=id(8);current.matches[1].matchId=id(9);
 assert.throws(()=>verifyCompletedIndependentSnapshot(job,current,current),error=>{
  assert.match(error.message,/保存済みジョブと現在の公式試合の正式IDが異なります/);
  assert.match(error.message,/現在の公式試合は終了済み/);
  assert.match(error.message,/照合は未完了/);
  for(const value of [E,id(1),id(8),id(9)])assert.ok(!error.message.includes(value));
  return true;
 });
 assert.equal(hasRecreatedIndependentFixtures(job,current),false);
});
test('snapshot changes are distinguished from a stable old-job mismatch',()=>{
 const fresh=snapshot(2,'finished');fresh.matches[0].matchId=id(9);
 assert.throws(()=>verifyCompletedIndependentSnapshot(completedJob(),fresh,snapshot(2,'finished')),/読み取り前後で公式試合の正式IDが変わりました/);
});
test('matching IDs with unfinished official status retain an end-state error',()=>{
 assert.throws(()=>verifyCompletedIndependentSnapshot(completedJob(),snapshot(2,'scheduled'),snapshot(2,'scheduled')),/公式試合の終了状態を確認できません/);
});
test('replacement unfinished fixtures are not described as finished',()=>{
 const current=snapshot(2,'scheduled');current.matches[0].matchId=id(9);
 assert.throws(()=>verifyCompletedIndependentSnapshot(completedJob(),current,current),error=>{
  assert.match(error.message,/保存済みジョブと現在の公式試合の正式IDが異なります/);
  assert.doesNotMatch(error.message,/現在の公式試合は終了済み/);
  return true;
 });
});
test('duplicate or missing sequence numbers are distinguished from ID mismatch',()=>{
 const current=snapshot(2,'finished');current.matches[1].seq=1;
 assert.throws(()=>verifyCompletedIndependentSnapshot(completedJob(),current,current),/公式試合番号が重複、または欠落/);
});
test('incomplete ID evidence cannot expose malformed input in the message',()=>{
 const current=snapshot(2,'finished');current.matches[0].matchId='private-payload';
 assert.throws(()=>verifyCompletedIndependentSnapshot(completedJob(),current,current),error=>{
  assert.match(error.message,/正式IDの証跡が不完全/);
  assert.doesNotMatch(error.message,/private-payload/);
  return true;
 });
});
test('one official ID assigned to multiple fixture numbers remains rejected',()=>{
 const job=completedJob();job.fixture_ids[2]=id(1);
 const current=snapshot(2,'finished');current.matches[1].matchId=id(1);
 assert.throws(()=>verifyCompletedIndependentSnapshot(job,current,current),/複数の試合番号で正式IDが重複/);
});
