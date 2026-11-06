import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIndependentWorkerPreflight} from '../sposched-independent-preflight.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const id=n=>'11111111-2222-4111-8111-11111111111'+n;
const pair=n=>({
 plan:{event_id:E,layout_mode:'independent-fixtures-v1',fixture_count:n,
  operations:Array.from({length:n},(_,i)=>({seq:i+1,action:'finish',winner:'auto',expected_match_id:id(i+1)}))},
 official:{environment:'PRODUCTION',event_id:E,
  matches:Array.from({length:n},(_,i)=>({seq:i+1,match_id:id(i+1),status:'scheduled'}))}
});
test('independent preflight accepts exact official fixtures for 1, 3 and 4 matches',()=>{
 for(const n of [1,3,4]){const {plan,official}=pair(n);
  assert.equal(verifyIndependentWorkerPreflight(plan,official),true);
 }
});
test('independent preflight rejects changed IDs, finished fixtures, missing finish and extra official fixtures',()=>{
 const a=pair(3);a.official.matches[1].match_id=id(9);
 assert.throws(()=>verifyIndependentWorkerPreflight(a.plan,a.official),/一致しません/);
 const b=pair(3);b.official.matches[0].status='finished';
 assert.throws(()=>verifyIndependentWorkerPreflight(b.plan,b.official),/未開始状態/);
 const c=pair(3);c.plan.operations.pop();
 assert.throws(()=>verifyIndependentWorkerPreflight(c.plan,c.official),/終了操作/);
 const d=pair(3);d.official.matches.push({seq:4,match_id:id(4),status:'scheduled'});
 assert.throws(()=>verifyIndependentWorkerPreflight(d.plan,d.official),/件数/);
});
