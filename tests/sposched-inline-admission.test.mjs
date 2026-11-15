import test from 'node:test';
import assert from 'node:assert/strict';
import {decideInlineBatchAdmission} from '../sposched-inline-admission.mjs';
const eventId='event-1';
test('allows first batch after Worker confirms there is no job',()=>{
 assert.equal(decideInlineBatchAdmission({eventId,workerJob:null}).allowed,true);
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
test('rejects a mismatched event in the Worker response',()=>{
 const r=decideInlineBatchAdmission({eventId,workerJob:{event_id:'other',request_id:'job-1',status:'completed'}});
 assert.equal(r.allowed,false);
 assert.match(r.reason,/別イベント/);
});

test('fails closed when Worker status has not been queried',()=>{
 const result=decideInlineBatchAdmission({eventId});
 assert.equal(result.allowed,false);
 assert.match(result.reason,/未確認/);
});

test('fails closed for an unrecognized Worker job status',()=>{
 const result=decideInlineBatchAdmission({eventId,workerJob:{event_id:eventId,request_id:'job-1',status:'unexpected'}});
 assert.equal(result.allowed,false);
});
