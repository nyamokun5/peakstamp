import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProductionSubmission,storeProductionSubmission,readProductionSubmission,
 verifyProductionSubmission,reconcileProductionManualGoals,productionSubmissionKey}
 from '../sposched-production-submission.mjs';
const id=n=>'21234567-89ab-4cde-8abc-'+String(n).padStart(12,'0');
const E=id(90),R=id(91),G=id(92);
const review={seq:1,team:'Blue',scorer:'A',assist:'B',assistMode:'named',include:true,guest:false};
const goal=()=>({id:G,manual:true,sent:false,source:{name:'SS手動入力'},review:{...review}});
const plan=()=>({event_id:E,request_id:R,confirm:'PRODUCTION EVENT BATCH WRITE',
 layout_mode:'independent-fixtures-v1',fixture_count:2,operations:[
  {seq:1,action:'create',expected_match_id:id(1),team:'Blue',scorer:'A',assist:'B'},
  {seq:1,action:'finish',expected_match_id:id(1),winner:'auto'},
  {seq:2,action:'finish',expected_match_id:id(2),winner:'auto'}]});
const make=()=>makeProductionSubmission({teamId:id(89),plan:plan(),rows:[{...review,key:'SS手動入力::'+G,goal:goal()}]});
const state=()=>({environment:'PRODUCTION',event_id:E,request_id:R,status:'completed'});
const fresh=()=>({eventId:E,matches:[
 {seq:1,matchId:id(1),status:'finished',leftTeam:'Blue',rightTeam:'Red',leftScore:1,rightScore:0,
  existingGoals:[{scorer:'A',assist:'B',team:'Blue',ownGoal:false}]},
 {seq:2,matchId:id(2),status:'finished',leftTeam:'Green',rightTeam:'White',leftScore:0,rightScore:0,existingGoals:[]}]});
test('submission freezes reviewed identities independently of later row/plan mutations and survives reload',()=>{
 const rows=[{...review,key:'SS手動入力::'+G,goal:goal()}],p=plan();
 const receipt=makeProductionSubmission({teamId:id(89),plan:p,rows});
 p.operations[0].scorer='Other';rows[0].scorer='Other';
 assert.equal(receipt.plan.operations[0].scorer,'A');assert.equal(receipt.manual[0].review.scorer,'A');
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 storeProductionSubmission(storage,receipt);
 assert.deepEqual(readProductionSubmission(storage,E,R),receipt);
 assert.throws(()=>readProductionSubmission(storage,E,id(99)));
 assert.equal(readProductionSubmission(storage,id(99),R),null);
 data.set(productionSubmissionKey(E),'malformed');assert.throws(()=>readProductionSubmission(storage,E,R));
});
test('only submitted unchanged drafts are completed; added, edited, deleted and already sent drafts are preserved',()=>{
 const receipt=make(),submitted=goal(),added={...goal(),id:id(98)};
 const done=reconcileProductionManualGoals([submitted,added],receipt,E,R);
 assert.equal(done.goals[0].sent,true);assert.equal(done.goals[1].sent,false);
 assert.deepEqual(done.completedKeys,['SS手動入力::'+G]);
 for(const change of [g=>g.review.scorer='Other',g=>g.review.assist='',g=>g.review.team='Other',g=>g.review.seq=2,g=>g.review.include=false]){
  const g=goal();change(g);assert.deepEqual(reconcileProductionManualGoals([g],receipt,E,R).completedKeys,[]);
 }
 assert.deepEqual(reconcileProductionManualGoals([],receipt,E,R).completedKeys,[]);
 assert.deepEqual(reconcileProductionManualGoals([{...goal(),sent:true}],receipt,E,R).completedKeys,[]);
 assert.deepEqual(reconcileProductionManualGoals([goal()],null,E,R).completedKeys,[]);
 assert.throws(()=>reconcileProductionManualGoals([goal()],receipt,id(99),R));
});
test('completed flag alone cannot finalize drafts: official UUID, goals, scorer, assist, team and score must match',()=>{
 assert.equal(verifyProductionSubmission(make(),state(),fresh()),true);
 for(const change of [x=>x.eventId=id(99),x=>x.matches[0].matchId=id(99),x=>x.matches[0].status='scheduled',
  x=>x.matches[0].leftScore=2,x=>x.matches[0].existingGoals[0].scorer='Other',
  x=>x.matches[0].existingGoals[0].assist='',x=>x.matches[0].existingGoals[0].team='Red',
  x=>x.matches[0].existingGoals[0].ownGoal=true,x=>x.matches[0].existingGoals=[],
  x=>x.matches[0].existingGoals.push({...x.matches[0].existingGoals[0]})]){
  const x=fresh();change(x);assert.throws(()=>verifyProductionSubmission(make(),state(),x));
 }
 assert.throws(()=>verifyProductionSubmission(make(),{...state(),status:'running'},fresh()));
 assert.throws(()=>verifyProductionSubmission(make(),{...state(),request_id:id(99)},fresh()));
 const corrupt=make();corrupt.plan.operations[0].scorer='Other';
 assert.throws(()=>verifyProductionSubmission(corrupt,state(),fresh()));
});

test('manual identities are never accepted for an unsupported knockout contract',()=>{
 const p=plan();delete p.layout_mode;
 assert.throws(()=>makeProductionSubmission({teamId:id(89),plan:p,rows:[{...review,key:'SS手動入力::'+G,goal:goal()}]}));
});
