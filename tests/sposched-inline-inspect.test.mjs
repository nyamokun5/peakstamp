import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectInlineBatchJob} from '../sposched-inline-inspect.mjs';
test('returns existing authoritative Worker job',async()=>{
 const job=await inspectInlineBatchJob({eventId:'event',postInspect:async()=>({status:200,body:{inspection_only:true,event_id:'event',request_id:'job',status:'running'}})});
 assert.equal(job.request_id,'job');
});
test('404 with explicit not_found is only safe empty result',async()=>{
 assert.equal(await inspectInlineBatchJob({eventId:'event',postInspect:async()=>({status:404,body:{error:{code:'not_found'}}})}),null);
});
for(const status of [401,409,500]){
 test('rejects '+status+' without treating it as empty',async()=>{
  await assert.rejects(inspectInlineBatchJob({eventId:'event',postInspect:async()=>({status,body:{}})}),/検証できません/);
 });
}
test('rejects network failure',async()=>{
 await assert.rejects(inspectInlineBatchJob({eventId:'event',postInspect:async()=>{throw Error('timeout');}}),/再送せず/);
});
