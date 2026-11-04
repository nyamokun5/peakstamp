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
