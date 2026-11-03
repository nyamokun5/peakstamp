import test from 'node:test';
import assert from 'node:assert/strict';
import {previewIndependentFixtures} from '../sposched-independent-preview.mjs';
const E='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const fixture=n=>({seq:n,matchId:'11111111-2222-4111-8111-11111111111'+n,status:'scheduled'});
const input=n=>({snapshot:{eventId:E,matches:Array.from({length:n},(_,i)=>fixture(i+1)),
 playerTeam:new Map([['A','Red'],['B','Red']])},rows:[{include:true,seq:n,
 scorer:'A',team:'Red',assistMode:'named',assist:'B'}],decisions:[{state:'ready'}]});
test('independent preview reuses reviewed goals with ordered finish actions for 1, 3 and 4 fixtures',()=>{
 for(const count of [1,3,4]){
  const plan=previewIndependentFixtures(input(count));
  assert.equal(plan.layout_mode,'independent-fixtures-v1');
  assert.equal(plan.fixture_count,count);
  assert.equal(plan.operations.length,count+1);
  assert.deepEqual(plan.operations.filter(o=>o.action==='finish').map(o=>o.seq),
   Array.from({length:count},(_,i)=>i+1));
  assert.equal(plan.operations.at(-2).action,'create');
 }
});
test('independent preview blocks changed official IDs and already started fixtures',()=>{
 const x=input(2);x.snapshot.matches[1].matchId=x.snapshot.matches[0].matchId;
 assert.throws(()=>previewIndependentFixtures(x),/番号・ID/);
 x.snapshot.matches[1]=fixture(2);x.snapshot.matches[1].status='finished';
 assert.throws(()=>previewIndependentFixtures(x),/未開始/);
});
test('independent preview blocks wrong player team and unreviewed goals',()=>{
 const x=input(2);x.rows[0].team='Blue';
 assert.throws(()=>previewIndependentFixtures(x),/所属チーム/);
 x.rows[0].team='Red';x.decisions[0].state='waiting';
 assert.throws(()=>previewIndependentFixtures(x),/個別確認/);
});

test('same scorer can legitimately score multiple goals in one fixture',()=>{
 const x=input(1);
 x.rows.push({...x.rows[0]});
 x.decisions.push({state:'ready'});
 const plan=previewIndependentFixtures(x);
 assert.equal(plan.operations.filter(op=>op.action==='create').length,2);
 assert.equal(plan.operations.filter(op=>op.action==='finish').length,1);
});
