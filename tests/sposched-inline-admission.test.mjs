import test from 'node:test';
import assert from 'node:assert/strict';
import {decideInlineBatchAdmission} from '../sposched-inline-admission.mjs';
const eventId='event-1';
test('allows a first batch when no job is known',()=>{
 assert.equal(decideInlineBatchAdmission({eventId}).allowed,true);
});
for(const status of ['running','paused','needs_decision','blocked','completed']){
 test('blocks repeat request when worker job is '+status,()=>{
  const r=decideInlineBatchAdmission({eventId,workerJob:{event_id:eventId,request_id:'job-1',status}});
  assert.equal(r.allowed,false);assert.equal(r.requestId,'job-1');
 });
}
test('blocks repeat request when local job has an uncertain outcome',()=>{
 const r=decideInlineBatchAdmission({eventId,localJob:{event_id:eventId,request_id:'job-1'}});
 assert.equal(r.allowed,false);
});
test('does not confuse a different event job with this event',()=>{
 assert.equal(decideInlineBatchAdmission({eventId,workerJob:{event_id:'other',request_id:'job-1',status:'completed'}}).allowed,true);
});
