import test from 'node:test';
import assert from 'node:assert/strict';
import {startInlineBatchOnce} from '../sposched-inline-dispatch.mjs';
const event_id='11111111-1111-4111-8111-111111111111';
const request_id='22222222-2222-4222-8222-222222222222';
const plan={event_id,request_id,confirm:'TEST-ONLY BATCH WRITE',operations:[{seq:1,action:'finish'}]};
const makeStorage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}};
test('persists request before exactly one send',async()=>{
 const storage=makeStorage();let sends=0;
 const response=await startInlineBatchOnce({plan,storage,inspect:async()=>null,
  send:async()=>{sends++;assert.match(storage.getItem('peakstamp:test:worker-batch:'+event_id),/sending/);return {event_id,request_id,status:'running'}}});
 assert.equal(response.status,'running');assert.equal(sends,1);
});
test('lost response prevents another write',async()=>{
 const storage=makeStorage();let sends=0;
 const args={plan,storage,inspect:async()=>null,send:async()=>{sends++;throw Error('timeout')}};
 await assert.rejects(startInlineBatchOnce(args),/再送せず/);
 await assert.rejects(startInlineBatchOnce(args),/再送せず|再送できません|登録ジョブ/);
 assert.equal(sends,1);
});
test('existing Worker job blocks a send',async()=>{
 let sends=0;
 await assert.rejects(startInlineBatchOnce({plan,storage:makeStorage(),
  inspect:async()=>({event_id,request_id,status:'completed'}),
  send:async()=>{sends++}}),/登録ジョブ/);
 assert.equal(sends,0);
});
test('storage failure prevents any write',async()=>{
 let sends=0;
 await assert.rejects(startInlineBatchOnce({plan,storage:{getItem:()=>null,setItem:()=>{throw Error('quota')}},
  inspect:async()=>null,send:async()=>{sends++}}),/保存できません/);
 assert.equal(sends,0);
});
