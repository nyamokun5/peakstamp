import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResetGoalRebinding} from '../sposched-reset-fixture-review.mjs';
const EVENT='11111111-1111-4111-8111-111111111111';
const ids=[1,2,3,4].map(i=>'22222222-2222-4222-8222-22222222222'+i);
const fixture=(matchId,seq)=>({seq,matchId,status:seq<=2?'scheduled':'waiting',
 leftScore:0,rightScore:0,existingGoals:[]});
const snapshot=()=>({eventId:EVENT,matches:ids.map((id,i)=>fixture(id,i+1))});
const row=(i)=>({goal:{matchSeq:i},seq:i,fixtureIdentityChanged:true,
 matchGuess:{seq:i,fixtureMatchId:ids[i-1],confidence:'high',
  ambiguous:false,conflict:false},scorer:'OHNO',team:'チーム1'});
test('acknowledges a reset only for stable matching TEST numbered fixture identities',()=>{
 const original=snapshot(),fresh=snapshot(),rows=[row(1),row(2),row(3),row(4)];
 const before=structuredClone(rows);
 const r=validateResetGoalRebinding(original,fresh,rows);
 assert.equal(r.count,4);assert.deepEqual(r.indices,[0,1,2,3]);
 assert.deepEqual(rows,before,'validation may not mutate any goal');
});
test('rejects a fixture changed while checking, duplicate ID or finished/registered match',()=>{
 const s=snapshot(),rows=[row(1)];
 for(const change of [
  x=>x.matches[0].matchId='33333333-3333-4333-8333-333333333333',
  x=>x.matches[0].matchId=x.matches[1].matchId,
  x=>x.matches[0].status='finished',
  x=>x.matches[0].leftScore=1,
  x=>x.matches[0].existingGoals=[{id:'existing'}],
  x=>x.matches.pop(),
  x=>x.eventId='11111111-1111-4111-8111-111111111112'
 ]){
  const altered=structuredClone(s);change(altered);
  assert.throws(()=>validateResetGoalRebinding(s,altered,rows));
 }
});
test('rejects moving video goal to a different match, missing identity and unsafe edits',()=>{
 const s=snapshot();
 for(const mutate of [
  r=>r.goal.matchSeq=2,r=>r.matchGuess.seq=2,r=>r.matchGuess.fixtureMatchId=ids[1],
  r=>r.matchGuess.conflict=true,r=>r.matchGuess.ambiguous=true,
  r=>r.goal.manual=true,r=>r.guest=true,r=>r.updateGoalId='old-goal',
  r=>r.seq=null
 ]){
  const r=row(1);mutate(r);
  assert.throws(()=>validateResetGoalRebinding(s,s,[r]));
 }
});
test('does not bulk approve normal goals that have no reset warning',()=>{
 const s=snapshot(),r=row(1);r.fixtureIdentityChanged=false;
 assert.throws(()=>validateResetGoalRebinding(s,s,[r]));
});
