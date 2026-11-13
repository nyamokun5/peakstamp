import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectInlineBatchJob} from '../sposched-inline-inspect.mjs';
test('returns existing authoritative Worker job',async()=>{
 const job=await inspectInlineBatchJob({eventId:'11111111-1111-4111-8111-111111111111',postInspect:async()=>({status:200,body:{inspection_only:true,event_id:'11111111-1111-4111-8111-111111111111',request_id:'22222222-2222-4222-8222-222222222222',status:'running'}})});
 assert.equal(job.request_id,'22222222-2222-4222-8222-222222222222');
});
test('404 with explicit not_found is only safe empty result',async()=>{
 assert.equal(await inspectInlineBatchJob({eventId:'11111111-1111-4111-8111-111111111111',postInspect:async()=>({status:404,body:{error:{code:'not_found'}}})}),null);
});
for(const status of [401,409,500]){
 test('rejects '+status+' without treating it as empty',async()=>{
  await assert.rejects(inspectInlineBatchJob({eventId:'11111111-1111-4111-8111-111111111111',postInspect:async()=>({status,body:{}})}),/検証できません/);
 });
}
test('rejects network failure',async()=>{
 await assert.rejects(inspectInlineBatchJob({eventId:'11111111-1111-4111-8111-111111111111',postInspect:async()=>{throw Error('timeout');}}),/再送せず/);
});

test('rejects malformed successful Worker response',async()=>{
 const eventId='11111111-1111-4111-8111-111111111111';
 await assert.rejects(inspectInlineBatchJob({eventId,postInspect:async()=>({status:200,body:{inspection_only:true,event_id:eventId,request_id:'bad',status:'running'}})}),/検証できません/);
});

test('accepts verified staged semifinal completion for automatic continuation',async()=>{
 const eventId='11111111-1111-4111-8111-111111111111';
 const job=await inspectInlineBatchJob({eventId,postInspect:async()=>({
  status:200,body:{inspection_only:true,event_id:eventId,
   request_id:'22222222-2222-4222-8222-222222222222',
   layout_mode:'four-knockout-staged-v1',status:'awaiting_second_round',
   phase:'preparing',cursor:2,total:2,completed:2}
 })});
 assert.equal(job.status,'awaiting_second_round');
});
