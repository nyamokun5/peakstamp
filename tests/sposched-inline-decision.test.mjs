import test from 'node:test';
import assert from 'node:assert/strict';
import {drawDecisionPlan,sendDrawDecisionOnce} from '../sposched-inline-decision.mjs';
const fixture=(seq=3)=>{
 const snapshot={eventId:'event',matches:[1,2,3,4].map(seq=>({seq,matchId:'m'+seq,status:'scheduled',leftScore:seq===3?1:0,rightScore:seq===3?1:0}))};
 const job={event_id:'event',request_id:'job',status:'needs_decision',phase:'preparing',cursor:6,fixture_ids:{1:'m1',2:'m2',3:'m3',4:'m4'},decision:{seq,match_id:'m'+seq,left_score:seq===3?1:0,right_score:seq===3?1:0,choices:['left','right','draw']}};
 return {job,snapshot};
};
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('later draws finish only the waiting operation without goals',()=>{for(const seq of [3,4]){const {job,snapshot}=fixture(seq);assert.deepEqual(drawDecisionPlan(job,snapshot),{event_id:'event',request_id:'job',seq,winner:'draw',confirm:'TEST-ONLY BATCH DECISION'});}});
test('reject stale identity, non-tie, nonwaiting and forbidden draw',()=>{
 for(const mutate of [x=>x.snapshot.eventId='other',x=>x.snapshot.matches[0].matchId='old',x=>x.snapshot.matches[2].rightScore=2,x=>x.job.status='running',x=>x.job.decision.choices=['left'],x=>x.job.decision.seq=1,x=>x.job.decision.match_id='old']){const x=fixture();mutate(x);assert.throws(()=>drawDecisionPlan(x.job,x.snapshot));}
});
test('readback then one write, lost response persists lock across later calls',async()=>{
 const x=fixture(),saved=storage();let writes=0;
 const args={...x,storage:saved,inspect:async()=>x.job,refreshOfficial:async()=>x.snapshot,verifyCurrent:()=>{},send:async()=>{writes++;throw Error('lost response')}};
 await assert.rejects(sendDrawDecisionOnce(args));await assert.rejects(sendDrawDecisionOnce(args));assert.equal(writes,1);
});
test('job changes or event selection changes never write',async()=>{
 for(const variant of ['job','selection']){
 const x=fixture();let writes=0;
 await assert.rejects(sendDrawDecisionOnce({...x,storage:storage(),inspect:async()=>({...x.job,request_id:variant==='job'?'new':'job'}),refreshOfficial:async()=>x.snapshot,verifyCurrent:()=>{throw Error('changed')},send:async()=>{writes++}}));assert.equal(writes,0);
 }
});
test('successful acknowledgment and mismatched response are distinguished',async()=>{
 for(const match of [true,false]){const x=fixture(),saved=storage();const args={...x,storage:saved,inspect:async()=>x.job,refreshOfficial:async()=>x.snapshot,verifyCurrent:()=>{},send:async()=>({event_id:'event',request_id:match?'job':'other'})};
 if(match){await sendDrawDecisionOnce(args);assert.equal(saved.getItem('peakstamp:test:decision-pending:job:3'),undefined);}else{await assert.rejects(sendDrawDecisionOnce(args));assert.ok(saved.getItem('peakstamp:test:decision-pending:job:3'));}}
});
